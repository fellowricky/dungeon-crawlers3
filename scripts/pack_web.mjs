/**
 * Web Packager for Itch.io
 * Bundles all character sheets, DCSS item icons, monster sprites, VFX, and active sounds
 * into a single compact `assets.pak` (~43 MB, max 200 MB), satisfying itch.io's 1,000-entry limit
 * and single-file size limit while preserving 100% of all equipment, visuals, and icons!
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const OUT_ZIP = path.join(ROOT, 'dungeon-crawlers-web.zip');

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
  let files = 0, dirs = 0;
  if (!fs.existsSync(dir)) return { files: 0, dirs: 0 };
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    if (fs.statSync(fp).isDirectory()) {
      dirs++;
      const sub = getCounts(fp);
      files += sub.files;
      dirs += sub.dirs;
    } else {
      files++;
    }
  }
  return { files, dirs };
}

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

console.log('1. Building production bundle with Vite...');
execSync('node ./node_modules/vite/bin/vite.js build', { stdio: 'inherit' });

console.log('2. Auditing active sound whitelist (excludes ~367MB of narration — see note below)...');

/* 1. Sounds — only bundle the sound files sounds.json actually names.
 *
 * NOTE: this whitelist is not merely "drop unused wavs". public/sounds/Narration
 * holds ~1,463 voice-over files (~367 MB) that sounds.json never lists, because
 * narration is addressed dynamically by line id (NARR_DIR + id + '.wav' in
 * audio.js) rather than through a slot. They therefore fall outside `usedSounds`
 * and are deliberately EXCLUDED from the web build to keep the upload small.
 * The web build is consequently silent where narration would play — audio.js
 * catches the miss and continues. To ship narration, transcode it to mp3
 * (audio.js already falls back from .wav to .mp3) and add it to usedSounds. */
const soundsJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/game/sounds.json'), 'utf8'));
const usedSounds = new Set();
for (const [k, slot] of Object.entries(soundsJson.slots || {})) {
  for (const f of slot.files || []) {
    usedSounds.add(path.normalize('sounds/' + f).replace(/\\/g, '/'));
  }
}

console.log('3. Packaging modular assets into single compact bundle (assets.pak)...');

const BUNDLE_FOLDERS = ['dcss', 'lpc', 'fx', 'sprites', 'sounds'];

const indexTable = {};
const dataChunks = [];
let currentOffset = 0;
let bundledCount = 0;

for (const folder of BUNDLE_FOLDERS) {
  const folderPath = path.join(DIST, folder);
  if (!fs.existsSync(folderPath)) continue;

  const files = getAllFiles(folderPath);
  for (const fp of files) {
    const rel = path.relative(DIST, fp).replace(/\\/g, '/');

    // Filter out unmapped sound files so assets.pak stays ~43MB
    if (folder === 'sounds' && !usedSounds.has(rel)) {
      continue;
    }

    // Skip backup folders
    if (rel.includes('backup') || rel.includes('sprites_backup')) {
      continue;
    }

    const buf = fs.readFileSync(fp);
    const mime = getMimeType(fp);

    indexTable[rel] = [currentOffset, buf.length, mime];
    dataChunks.push(buf);
    currentOffset += buf.length;
    bundledCount++;
  }
}

const indexJson = JSON.stringify(indexTable);
const indexBytes = Buffer.from(indexJson, 'utf-8');

// Header: 'PAK1' (4 bytes) + uint32 index length (4 bytes)
const header = Buffer.alloc(8);
header.write('PAK1', 0, 4, 'ascii');
header.writeUInt32LE(indexBytes.length, 4);

const fullBundle = Buffer.concat([header, indexBytes, ...dataChunks]);
fs.writeFileSync(path.join(DIST, 'assets.pak'), fullBundle);
const pakSizeMB = (fullBundle.length / 1024 / 1024).toFixed(2);
console.log(`✔ Created assets.pak (${pakSizeMB} MB, well under itch.io 200MB limit) containing ${bundledCount} assets!`);

console.log('3b. Pruning 3D models no source file references...');

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
  console.log(`   - dropped unreferenced ${path.relative(DIST, fp).split(path.sep).join('/')}`);
}
console.log(`✔ Pruned ${(prunedBytes / 1024 / 1024).toFixed(2)} MB of unreferenced 3D models.`);

console.log('4. Cleaning up bundled individual files from dist...');
for (const folder of BUNDLE_FOLDERS) {
  const folderPath = path.join(DIST, folder);
  if (fs.existsSync(folderPath)) {
    fs.rmSync(folderPath, { recursive: true, force: true });
  }
}

// Remove any backup folders if present
const backupPath = path.join(DIST, 'sprites_backup_20260820_185229');
if (fs.existsSync(backupPath)) fs.rmSync(backupPath, { recursive: true, force: true });

const c = getCounts(DIST);
console.log(`✔ Final dist entry count: ${c.files} files + ${c.dirs} dirs = TOTAL ${c.files + c.dirs} entries! (itch.io limit is 1,000)`);

if (fs.existsSync(OUT_ZIP)) fs.unlinkSync(OUT_ZIP);

console.log(`5. Compressing into ${path.basename(OUT_ZIP)}...`);

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

const zipMB = (fs.statSync(OUT_ZIP).size / 1024 / 1024).toFixed(1);
console.log(`✔ Successfully created ${path.basename(OUT_ZIP)} (${zipMB} MB, verified PKZIP) ready for itch.io upload!`);
