/**
 * Web Packager for itch.io — ships the COMPLETE game.
 *
 * itch.io's HTML5 limits (https://itch.io/docs/creators/html5): at most 1,000
 * extracted entries, 500 MB extracted in total, and no single file over 200 MB.
 * The raw `public/` tree is ~1 GB in ~9,000 files, so getting everything in
 * takes four moves, all of them build-time only (the sources stay untouched):
 *
 *   1. Narration  1,463 .wav (367 MB)  -> mono 64k .mp3 (~65 MB), packed lazily
 *   2. Music      30 x 320k .mp3 (145 MB) -> 128k (~58 MB), left loose for <audio>
 *   3. Guild art  112 PNG (175 MB)     -> WebP q90 (~17 MB), manifest rewritten
 *   4. 3D         raw .glb masters dropped, only referenced .opt.glb ship (~37 MB)
 *
 * Everything the game reaches through fetch()/<img src> (sprites, icons, SFX,
 * VFX, narration) is folded into `assets-N.pak` parts described by
 * `assets.manifest.json`, which src/game/asset_pack.js serves from memory.
 * Parts are capped well under the 200 MB single-file limit; narration goes in
 * its own lazy part so it is only downloaded once a line actually plays.
 *
 * Transcodes are cached under .cache/web/ and only redone when the source is
 * newer, so a rebuild after a code change takes seconds, not minutes.
 *
 * Needs: ffmpeg (libmp3lame) and python with Pillow on PATH — or set FFMPEG /
 * PYTHON to the binaries.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync, spawn, spawnSync } from 'child_process';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const CACHE = path.join(ROOT, '.cache', 'web');
const OUT_ZIP = path.join(ROOT, 'dungeon-crawlers-web.zip');

const MB = 1024 * 1024;
const LIMITS = { entries: 1000, totalBytes: 500 * MB, fileBytes: 200 * MB };
const PART_CAP = 180 * MB;          // headroom under the 200 MB single-file cap

const NARRATION_BITRATE = '64k';    // 24 kHz mono speech; transparent at this rate
const MUSIC_BITRATE = '128k';       // sources are 320k; halves the folder, still clean
const GUILD_WEBP_QUALITY = 90;

/* ── tool discovery ──────────────────────────────────────────────────── */

function onPath(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

function findFfmpeg() {
  const candidates = [
    process.env.FFMPEG,
    onPath('ffmpeg'),
    // The ComfyUI venv bundles a static ffmpeg; use it when nothing else is installed.
    'E:\\ComfyUi\\Data\\Packages\\ComfyUI\\venv\\Lib\\site-packages\\ffmpeg\\bin\\ffmpeg.exe'
  ].filter(Boolean);
  for (const c of candidates) {
    if (!fs.existsSync(c) && !onPath(c)) continue;
    const r = spawnSync(c, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.includes('libmp3lame')) return c;
  }
  throw new Error('ffmpeg with libmp3lame not found — install it or set FFMPEG=<path>.');
}

function findPython() {
  const candidates = [process.env.PYTHON, onPath('python'), onPath('python3')].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ['-c', 'from PIL import features; assert features.check("webp")'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  throw new Error('python with Pillow (WebP support) not found — install it or set PYTHON=<path>.');
}

/* ── helpers ─────────────────────────────────────────────────────────── */

function getAllFiles(dir) {
  let res = [];
  if (!fs.existsSync(dir)) return res;
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    if (fs.statSync(fp).isDirectory()) res = res.concat(getAllFiles(fp));
    else res.push(fp);
  }
  return res;
}

function getCounts(dir) {
  let files = 0, dirs = 0, bytes = 0, largest = { size: 0, file: '' };
  if (!fs.existsSync(dir)) return { files, dirs, bytes, largest };
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    const st = fs.statSync(fp);
    if (st.isDirectory()) {
      dirs++;
      const sub = getCounts(fp);
      files += sub.files; dirs += sub.dirs; bytes += sub.bytes;
      if (sub.largest.size > largest.size) largest = sub.largest;
    } else {
      files++; bytes += st.size;
      if (st.size > largest.size) largest = { size: st.size, file: path.relative(DIST, fp) };
    }
  }
  return { files, dirs, bytes, largest };
}

function rel(fp) { return path.relative(DIST, fp).split(path.sep).join('/'); }
function mb(n) { return (n / MB).toFixed(1); }

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.wav': return 'audio/wav';
    case '.mp3': return 'audio/mpeg';
    case '.ogg': return 'audio/ogg';
    case '.json': return 'application/json';
    case '.wasm': return 'application/wasm';
    default: return 'application/octet-stream';
  }
}

/* Only redo work when the source is newer than the cached output. */
function isStale(src, out) {
  if (!fs.existsSync(out)) return true;
  return fs.statSync(src).mtimeMs > fs.statSync(out).mtimeMs;
}

/* Run `jobs` (each a () => Promise) with at most `n` in flight. */
async function runPool(jobs, n) {
  let i = 0, failed = 0;
  async function worker() {
    while (i < jobs.length) {
      const job = jobs[i++];
      try { await job(); } catch (err) { failed++; console.warn(`   ! ${err.message}`); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker));
  if (failed) throw new Error(`${failed} transcode(s) failed`);
}

function ffmpegJob(ffmpeg, src, out, args) {
  return () => new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const tmp = out + '.part.mp3';
    const p = spawn(ffmpeg, ['-v', 'error', '-y', '-i', src, ...args, tmp], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => {
      if (code === 0) { fs.renameSync(tmp, out); resolve(); }
      else { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); reject(new Error(`${path.basename(src)}: ${err.trim() || 'ffmpeg exit ' + code}`)); }
    });
  });
}

/* ── 1. vite ─────────────────────────────────────────────────────────── */

const FFMPEG = findFfmpeg();
const PYTHON = findPython();
const WORKERS = Math.max(2, Math.min(8, os.cpus().length));
console.log(`Tools: ffmpeg=${FFMPEG}  python=${PYTHON}  workers=${WORKERS}`);

console.log('1. Building production bundle with Vite...');
execSync('node ./node_modules/vite/bin/vite.js build', { stdio: 'inherit' });

/* ── 2. SFX whitelist ────────────────────────────────────────────────── */

console.log('2. Auditing SFX whitelist...');

/* Only bundle the sound files sounds.json actually names. Narration is NOT
   addressed through a slot (audio.js builds NARR_DIR + id at runtime), so it
   is handled separately in step 3 rather than by this list. */
const soundsJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/game/sounds.json'), 'utf8'));
const usedSounds = new Set();
for (const slot of Object.values(soundsJson.slots || {})) {
  for (const f of slot.files || []) {
    usedSounds.add(path.normalize('sounds/' + f).replace(/\\/g, '/'));
  }
}

/* ── 3. narration -> mp3 ─────────────────────────────────────────────── */

console.log('3. Transcoding narration to mp3 (cached)...');

const NARR_SRC = path.join(ROOT, 'public/sounds/Narration');
const NARR_CACHE = path.join(CACHE, 'narration');
const narrationJobs = [];
const narrationOut = [];
for (const fp of getAllFiles(NARR_SRC)) {
  if (!/\.wav$/i.test(fp)) continue;
  const out = path.join(NARR_CACHE, path.basename(fp, path.extname(fp)) + '.mp3');
  narrationOut.push(out);
  if (isStale(fp, out)) {
    narrationJobs.push(ffmpegJob(FFMPEG, fp, out, ['-codec:a', 'libmp3lame', '-b:a', NARRATION_BITRATE, '-ac', '1']));
  }
}
console.log(`   ${narrationOut.length} lines, ${narrationJobs.length} to (re)encode`);
await runPool(narrationJobs, WORKERS);
const narrBytes = narrationOut.reduce((s, f) => s + fs.statSync(f).size, 0);
console.log(`✔ Narration: ${mb(narrBytes)} MB as mp3`);

/* ── 4. music -> 128k ────────────────────────────────────────────────── */

console.log('4. Re-encoding music (cached)...');

const MUSIC_SRC = path.join(ROOT, 'public/music');
const MUSIC_CACHE = path.join(CACHE, 'music');
const musicJobs = [];
const musicOut = [];
for (const fp of getAllFiles(MUSIC_SRC)) {
  if (!/\.mp3$/i.test(fp)) continue;
  const out = path.join(MUSIC_CACHE, path.basename(fp));
  musicOut.push([fp, out]);
  if (isStale(fp, out)) {
    musicJobs.push(ffmpegJob(FFMPEG, fp, out, ['-codec:a', 'libmp3lame', '-b:a', MUSIC_BITRATE]));
  }
}
console.log(`   ${musicOut.length} tracks, ${musicJobs.length} to (re)encode`);
await runPool(musicJobs, WORKERS);
// Music streams through an <audio> element, which the pak hook cannot serve,
// so it stays loose in dist/music — just swapped for the smaller encode.
for (const [src, out] of musicOut) {
  fs.copyFileSync(out, path.join(DIST, 'music', path.basename(src)));
}
const musicBytes = musicOut.reduce((s, [, f]) => s + fs.statSync(f).size, 0);
console.log(`✔ Music: ${mb(musicBytes)} MB at ${MUSIC_BITRATE}`);

/* ── 5. guild art -> webp ────────────────────────────────────────────── */

console.log('5. Converting guild art to WebP (cached)...');

const GUILD_SRC = path.join(ROOT, 'public/art/guild');
const GUILD_DIST = path.join(DIST, 'art/guild');
const GUILD_CACHE = path.join(CACHE, 'guild');
const guildPairs = [];   // [srcPng, cachedWebp, distPng]
for (const fp of getAllFiles(GUILD_SRC)) {
  if (!/\.png$/i.test(fp)) continue;
  const relPng = path.relative(GUILD_SRC, fp);
  const out = path.join(GUILD_CACHE, relPng.replace(/\.png$/i, '.webp'));
  guildPairs.push([fp, out, path.join(GUILD_DIST, relPng)]);
}
const guildStale = guildPairs.filter(([src, out]) => isStale(src, out));
console.log(`   ${guildPairs.length} images, ${guildStale.length} to (re)convert`);
if (guildStale.length) {
  for (const [, out] of guildStale) fs.mkdirSync(path.dirname(out), { recursive: true });
  const script = `
import json, sys
from PIL import Image
jobs = json.load(sys.stdin)
for src, out in jobs:
    Image.open(src).save(out, 'WEBP', quality=${GUILD_WEBP_QUALITY}, method=4)
`;
  const r = spawnSync(PYTHON, ['-c', script], { input: JSON.stringify(guildStale.map(([s, o]) => [s, o])), encoding: 'utf8' });
  if (r.status !== 0) throw new Error('WebP conversion failed:\n' + r.stderr);
}
// Swap the PNGs in dist for the WebPs and point the manifest at them.
for (const [, out, distPng] of guildPairs) {
  if (fs.existsSync(distPng)) fs.unlinkSync(distPng);
  fs.copyFileSync(out, distPng.replace(/\.png$/i, '.webp'));
}
const manifestPath = path.join(GUILD_DIST, 'manifest.json');
const guildManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
let rewritten = 0;
for (const entry of Object.values(guildManifest)) {
  const tiers = entry.tiers || [];
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    if (typeof t === 'string' && /\.png$/i.test(t)) { tiers[i] = t.replace(/\.png$/i, '.webp'); rewritten++; }
    else if (t && typeof t === 'object' && /\.png$/i.test(t.file || '')) { t.file = t.file.replace(/\.png$/i, '.webp'); rewritten++; }
  }
}
fs.writeFileSync(manifestPath, JSON.stringify(guildManifest));
for (const entry of Object.values(guildManifest)) {
  for (const tier of entry.tiers || []) {
    const f = tier && typeof tier === 'object' ? tier.file : tier;
    if (typeof f === 'string' && !fs.existsSync(path.join(DIST, f.replace(/^\.\//, '')))) {
      throw new Error(`guild manifest points at a file missing from dist: ${f}`);
    }
  }
}
const guildBytes = guildPairs.reduce((s, [, f]) => s + fs.statSync(f).size, 0);
console.log(`✔ Guild art: ${mb(guildBytes)} MB as WebP, ${rewritten} manifest paths rewritten`);

/* ── 5b. prop normal maps -> webp, packed under their .png keys ──────── */

/* The prop normal sidecars are 1024² RGB PNGs, ~1 MB each (80 MB in all).
   Lossy WebP at q95 is ~12 MB with a 1.3° mean / 6° p99 angular error, which
   the pixel shader's grid snap swallows. dungeon_scene.js builds the URL as
   `art/prop_normals/<id>.png`, so instead of rewriting code the WebP bytes go
   into the pak under that .png key with an image/webp mime; the <img> hook
   hands out a blob URL and the extension never matters. Eager, since
   TextureLoader goes through img.src and can't await a lazy part. */
console.log('5b. Converting prop normal maps to WebP (cached)...');
const NORMALS_SRC = path.join(ROOT, 'public/art/prop_normals');
const NORMALS_CACHE = path.join(CACHE, 'prop_normals');
const NORMALS_WEBP_QUALITY = 95;
const normalPairs = [];   // [srcPng, cachedWebp, pakKey]
for (const fp of fs.existsSync(NORMALS_SRC) ? getAllFiles(NORMALS_SRC) : []) {
  if (!/\.png$/i.test(fp)) continue;
  const relPng = path.relative(NORMALS_SRC, fp).split(path.sep).join('/');
  normalPairs.push([fp, path.join(NORMALS_CACHE, relPng.replace(/\.png$/i, '.webp')), 'art/prop_normals/' + relPng]);
}
const normalStale = normalPairs.filter(([src, out]) => isStale(src, out));
console.log(`   ${normalPairs.length} maps, ${normalStale.length} to (re)convert`);
if (normalStale.length) {
  for (const [, out] of normalStale) fs.mkdirSync(path.dirname(out), { recursive: true });
  const script = `
import json, sys
from PIL import Image
for src, out in json.load(sys.stdin):
    Image.open(src).convert('RGB').save(out, 'WEBP', quality=${NORMALS_WEBP_QUALITY}, method=6)
`;
  const r = spawnSync(PYTHON, ['-c', script], { input: JSON.stringify(normalStale.map(([s, o]) => [s, o])), encoding: 'utf8' });
  if (r.status !== 0) throw new Error('Normal-map WebP conversion failed:\n' + r.stderr);
}
fs.rmSync(path.join(DIST, 'art/prop_normals'), { recursive: true, force: true });
const normalBytes = normalPairs.reduce((s, [, f]) => s + fs.statSync(f).size, 0);
console.log(`✔ Prop normals: ${mb(normalBytes)} MB as WebP (packed under .png keys)`);

/* ── 6. prune ────────────────────────────────────────────────────────── */

console.log('6. Pruning 3D models no source file references...');

// dist/3d ships every model in public/3d, including raw uncompressed variants
// that were superseded by a `.opt.glb` and one-off editor uploads. Nothing
// rewrites those references at build time, so decide by basename: read the
// game's sources, and drop any model whose filename never appears in them.
function readSourceText(dir) {
  let text = '';
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    if (fs.statSync(fp).isDirectory()) text += readSourceText(fp);
    else if (/\.(js|mjs|json|html)$/i.test(f)) text += fs.readFileSync(fp, 'utf8');
  }
  return text;
}

const sourceText = readSourceText(path.join(ROOT, 'src')) + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let prunedBytes = 0;
for (const fp of getAllFiles(path.join(DIST, '3d'))) {
  const base = path.basename(fp);
  if (sourceText.includes(base)) continue;
  prunedBytes += fs.statSync(fp).size;
  fs.rmSync(fp);
  console.log(`   - dropped unreferenced ${rel(fp)}`);
}
console.log(`✔ Pruned ${mb(prunedBytes)} MB of unreferenced 3D models.`);

/* The dev server also serves the project root, so a model that only exists in
   the top-level 3d/ (where the optimiser writes it) loads fine in dev and is
   silently absent from a build. That is how the web build shipped without
   chests, barrels and crates for months. Refuse to package until every
   referenced .opt.glb has been copied into public/3d/. */
const missingModels = [];
for (const fp of getAllFiles(path.join(ROOT, '3d'))) {
  if (!/\.opt\.glb$/i.test(fp)) continue;
  const relPath = path.relative(path.join(ROOT, '3d'), fp).split(path.sep).join('/');
  if (sourceText.includes(path.basename(fp)) && !fs.existsSync(path.join(DIST, '3d', relPath))) missingModels.push(relPath);
}
if (missingModels.length) {
  throw new Error('Referenced models exist only in 3d/, not public/3d/ (dev serves them, the build cannot):\n   '
    + missingModels.map(m => `cp 3d/${m} public/3d/${m}`).join('\n   '));
}

console.log('6b. Pruning working files that live under public/ but are not game assets...');
// Whole folders: animation-picker output and dated sprite backups.
for (const name of fs.readdirSync(DIST)) {
  /* lpc_128 is the LPC upgrader prototype's output (tools/lpc_upgrader); the
     game never loads it, and its ~1,900 files alone break the entry cap. */
  if (name === 'scratch_picker' || name === 'lpc_128' || /^sprites_backup/.test(name)) {
    fs.rmSync(path.join(DIST, name), { recursive: true, force: true });
    console.log(`   - dropped ${name}/`);
  }
}
// Editor droppings anywhere in the tree, plus the PNG world map the page never
// loads (index.html uses the .jpg).
let junkBytes = 0;
for (const fp of getAllFiles(DIST)) {
  const base = path.basename(fp);
  if (/~$/.test(base) || /-autosave\.kra$/i.test(base) || base.startsWith('.') || rel(fp) === 'world_map.png') {
    junkBytes += fs.statSync(fp).size;
    fs.rmSync(fp);
  }
}
console.log(`✔ Pruned ${mb(junkBytes)} MB of editor backups and unreferenced files.`);

/* ── 7. pack ─────────────────────────────────────────────────────────── */

console.log('7. Packing fetch()/<img>-loaded assets into pak parts...');

const BUNDLE_FOLDERS = ['dcss', 'lpc', 'fx', 'sprites', 'sounds'];

// entries: { key, file, lazy }
const entries = [];
for (const folder of BUNDLE_FOLDERS) {
  const folderPath = path.join(DIST, folder);
  if (!fs.existsSync(folderPath)) continue;
  for (const fp of getAllFiles(folderPath)) {
    const key = rel(fp);
    // Narration .wav is replaced wholesale by the mp3 set below.
    if (key.startsWith('sounds/Narration/')) continue;
    // Filter out unmapped sound files.
    if (folder === 'sounds' && !usedSounds.has(key)) continue;
    // Skip backup folders
    if (key.includes('backup') || key.includes('sprites_backup')) continue;
    entries.push({ key, file: fp, lazy: false });
  }
}
for (const out of narrationOut) {
  entries.push({ key: 'sounds/Narration/' + path.basename(out), file: out, lazy: true });
}
for (const [, out, key] of normalPairs) entries.push({ key, file: out, lazy: false });

/* Greedy fill: eager entries first (they gate boot, so keep them together),
   then lazy ones in their own part(s). A part is closed when the next file
   would push it over PART_CAP. */
const parts = [];        // { file, lazy, chunks: Buffer[], bytes }
const index = {};        // key -> [part, offset, size, mime]
function openPart(lazy) {
  const p = { file: `assets-${parts.length}.pak`, lazy, chunks: [], bytes: 0 };
  parts.push(p);
  return p;
}
let current = null;
for (const e of entries.sort((a, b) => (a.lazy - b.lazy) || a.key.localeCompare(b.key))) {
  const buf = fs.readFileSync(e.file);
  if (buf.length > PART_CAP) throw new Error(`${e.key} alone is ${mb(buf.length)} MB — over the single-file cap.`);
  if (!current || current.lazy !== e.lazy || current.bytes + buf.length > PART_CAP) current = openPart(e.lazy);
  index[e.key] = [parts.indexOf(current), current.bytes, buf.length, getMimeType(e.file)];
  current.chunks.push(buf);
  current.bytes += buf.length;
}
for (const p of parts) {
  fs.writeFileSync(path.join(DIST, p.file), Buffer.concat(p.chunks));
  console.log(`   · ${p.file}: ${mb(p.bytes)} MB${p.lazy ? ' (lazy)' : ''}`);
  p.chunks = null;
}
const manifest = {
  version: 2,
  parts: parts.map(p => ({ file: p.file, bytes: p.bytes, lazy: p.lazy })),
  index
};
fs.writeFileSync(path.join(DIST, 'assets.manifest.json'), JSON.stringify(manifest));
// A stale single-part pak from an older build must not shadow the manifest.
if (fs.existsSync(path.join(DIST, 'assets.pak'))) fs.unlinkSync(path.join(DIST, 'assets.pak'));
console.log(`✔ Packed ${entries.length} assets into ${parts.length} part(s).`);

console.log('7b. Removing the now-bundled individual files from dist...');
for (const folder of BUNDLE_FOLDERS) {
  fs.rmSync(path.join(DIST, folder), { recursive: true, force: true });
}

/* ── 8. audit against itch.io limits ─────────────────────────────────── */

console.log('8. Auditing against itch.io limits...');
const c = getCounts(DIST);
const problems = [];
if (c.files + c.dirs > LIMITS.entries) problems.push(`${c.files + c.dirs} entries > ${LIMITS.entries}`);
if (c.bytes > LIMITS.totalBytes) problems.push(`${mb(c.bytes)} MB extracted > ${mb(LIMITS.totalBytes)} MB`);
if (c.largest.size > LIMITS.fileBytes) problems.push(`${c.largest.file} is ${mb(c.largest.size)} MB > ${mb(LIMITS.fileBytes)} MB`);
console.log(`   entries: ${c.files} files + ${c.dirs} dirs = ${c.files + c.dirs} (limit ${LIMITS.entries})`);
console.log(`   extracted: ${mb(c.bytes)} MB (limit ${mb(LIMITS.totalBytes)} MB)`);
console.log(`   largest file: ${c.largest.file} at ${mb(c.largest.size)} MB (limit ${mb(LIMITS.fileBytes)} MB)`);
for (const name of fs.readdirSync(DIST)) {
  const fp = path.join(DIST, name);
  const s = fs.statSync(fp).isDirectory() ? getCounts(fp).bytes : fs.statSync(fp).size;
  if (s > MB) console.log(`   ${mb(s).padStart(7)} MB  ${name}`);
}
if (problems.length) throw new Error('Build exceeds itch.io limits:\n   ' + problems.join('\n   '));
console.log('✔ Within limits.');

/* ── 9. zip ──────────────────────────────────────────────────────────── */

if (fs.existsSync(OUT_ZIP)) fs.unlinkSync(OUT_ZIP);

console.log(`9. Compressing into ${path.basename(OUT_ZIP)}...`);

/* itch.io needs a real PKZIP archive. A bare `tar.exe` is NOT safe here: on a
   machine with Git/MSYS on PATH it resolves to GNU tar, which cannot write zip
   at all — given a .zip suffix it just writes an uncompressed tar under that
   name, and itch rejects the upload with "not a valid zip file". Windows ships
   bsdtar at a fixed path and that one does write zip, so call it explicitly and
   keep PowerShell as the fallback. */
const BSDTAR = 'C:\\Windows\\System32\\tar.exe';
const zipStrategies = [
  {
    name: 'bsdtar',
    available: () => fs.existsSync(BSDTAR),
    run: () => execSync(`"${BSDTAR}" -a -c -f "${OUT_ZIP}" *`, { cwd: DIST, stdio: 'inherit' })
  },
  {
    name: 'PowerShell Compress-Archive',
    available: () => true,
    run: () => execSync(
      `powershell.exe -NoProfile -NonInteractive -Command "Compress-Archive -Path '${DIST}\\*' -DestinationPath '${OUT_ZIP}' -Force"`,
      { stdio: 'inherit' }
    )
  }
];

/* Trust nothing: confirm the bytes on disk actually start with the PKZIP local
   file header, so a tool that silently produced the wrong format can never ship
   again. */
function isRealZip(file) {
  if (!fs.existsSync(file)) return false;
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(4);
  fs.readSync(fd, head, 0, 4, 0);
  fs.closeSync(fd);
  return head[0] === 0x50 && head[1] === 0x4b;   // 'PK'
}

let zipped = false;
for (const s of zipStrategies) {
  if (!s.available()) continue;
  try {
    if (fs.existsSync(OUT_ZIP)) fs.unlinkSync(OUT_ZIP);
    s.run();
  } catch (err) {
    console.warn(`   ! ${s.name} failed: ${err.message}`);
    continue;
  }
  if (isRealZip(OUT_ZIP)) { console.log(`   · archived with ${s.name}`); zipped = true; break; }
  console.warn(`   ! ${s.name} did not produce a PKZIP archive — trying next method.`);
}

if (!zipped) {
  if (fs.existsSync(OUT_ZIP)) fs.unlinkSync(OUT_ZIP);
  throw new Error('Could not produce a valid .zip — no working archiver found.');
}

const zipMB = mb(fs.statSync(OUT_ZIP).size);
console.log(`✔ Successfully created ${path.basename(OUT_ZIP)} (${zipMB} MB, verified PKZIP) ready for itch.io upload!`);
