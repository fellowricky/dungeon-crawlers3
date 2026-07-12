/*
 * Narration coverage check
 * -------------------------
 * Cross-references narration-manifest.json against the recorded audio files in
 * public/sounds/Narration/ and reports which lines still need a voice file.
 * Accepts .wav or .mp3.  Run:  node scripts/narration/check.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const manifestPath = join(here, 'out', 'narration-manifest.json');
const narrDir = join(repoRoot, 'public', 'sounds', 'Narration');

if (!existsSync(manifestPath)) {
  console.error('No manifest. Run `node scripts/narration/extract.mjs` first.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const have = new Set(existsSync(narrDir) ? readdirSync(narrDir) : []);
const has = id => have.has(id + '.wav') || have.has(id + '.mp3');

const missing = manifest.filter(m => !has(m.id));
const done = manifest.length - missing.length;

console.log(`Narration coverage: ${done}/${manifest.length} recorded\n`);
if (missing.length) {
  console.log(`Still needed (${missing.length}):`);
  for (const m of missing) console.log(`  ${m.id}.wav   —  ${m.text}`);
} else {
  console.log('All lines recorded. 🎙️');
}

/* Flag orphan audio files that match no manifest id (typo'd filename, etc.) */
const ids = new Set(manifest.map(m => m.id));
const orphans = [...have].filter(f => /\.(wav|mp3)$/i.test(f) && !ids.has(f.replace(/\.(wav|mp3)$/i, '')));
if (orphans.length) {
  console.log(`\n⚠ Audio files matching no line id (check the filename):`);
  for (const o of orphans) console.log(`  ${o}`);
}
