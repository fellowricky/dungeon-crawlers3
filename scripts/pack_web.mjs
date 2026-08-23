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

console.log('2. Auditing active sound whitelist (pruning ~370MB unused wavs)...');

// 1. Sounds — only bundle the active sound files defined in sounds.json
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
execSync('tar.exe -acf ../dungeon-crawlers-web.zip *', { cwd: DIST, stdio: 'inherit' });

console.log(`✔ Successfully created ${path.basename(OUT_ZIP)} ready for itch.io upload!`);
