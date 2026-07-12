/*
 * Narration extractor
 * --------------------
 * Reads the CHALLENGES array out of src/game/skills.js and emits, into
 * scripts/narration/out/:
 *
 *   narration-manifest.json  — [{ id, text }]  (machine-readable, consumed by check.mjs
 *                              and mirrored by the game's slug() at runtime)
 *   narration-script.txt     — numbered human sheet: for each line, the exact
 *                              filename to save and the text to narrate
 *   narration-lines.csv      — id,text  (handy if you'd rather batch it)
 *
 * Emits, per challenge:
 *   {base}              — the `desc` (situation) line
 *   {base}_a{i}_act     — approach i's `label` (the action on the card)
 *   {base}_a{i}_win     — approach i's success outcome
 *   {base}_a{i}_lose    — approach i's failure outcome
 * where base = a collision-safe slug of the challenge name.
 *
 * Run:  node scripts/narration/extract.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const SKILLS = join(repoRoot, 'src', 'game', 'skills.js');
const OUT = join(here, 'out');

/* Keep this slug() identical to the one in src/game/audio.js so filenames
   the game requests at runtime match what the extractor writes here. */
export function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/* Pull the array literal `const CHALLENGES = [ ... ];` out of the source and
   evaluate it. The array is pure data (verified: no calcDC/TIERS/SKILLS/arrow
   fns/template literals inside), so eval of the literal is safe & dependency-free. */
function loadChallenges() {
  const src = readFileSync(SKILLS, 'utf8');
  return [
    ...evalArray(src, 'const CHALLENGES = ['),
    ...evalArray(src, 'const CHALLENGES_DYNAMIC = ['),   // chest/shrine/pre-boss (defined in trigger fns)
  ];
}

/* Locate `<marker> ... ]` (bracket-matched) and eval the array literal. The
   arrays are pure data (no fn refs — the dynamic challenges keep onResolved out
   of CHALLENGES_DYNAMIC), so eval is safe & dependency-free. */
function evalArray(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`Could not find \`${marker}\` in skills.js`);
  const open = src.indexOf('[', start);
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) throw new Error(`Unbalanced brackets while scanning ${marker}`);
  // eslint-disable-next-line no-eval
  return eval('(' + src.slice(open, end + 1) + ')');
}

const challenges = loadChallenges();

/* Assign each challenge a collision-safe `base` id first, then derive the desc
   and per-approach line ids from it so every id for one challenge shares a stem. */
const seen = new Map();
const rows = [];
const push = (id, name, text) => {
  if (typeof text === 'string' && text.trim()) rows.push({ id, name, text: text.trim() });
};
for (const ch of challenges) {
  if (!ch || typeof ch.name !== 'string') continue;
  /* `nid` (narration id override) wins over the name slug — keeps the two
     "Locked Chest"s distinct and matches narrBase() in skills.js. */
  let base = ch.nid ? slug(ch.nid) : slug(ch.name);
  const n = (seen.get(base) || 0) + 1;
  seen.set(base, n);
  if (n > 1) base = `${base}_${n}`;

  push(base, ch.name, ch.desc);                       // situation line
  (ch.approaches || []).forEach((a, i) => {
    if (!a) return;
    push(`${base}_a${i}_act`,  `${ch.name} — ${a.label || 'approach ' + i}`, a.label);
    push(`${base}_a${i}_win`,  `${ch.name} — ${a.label || i} (success)`,     a.win);
    push(`${base}_a${i}_lose`, `${ch.name} — ${a.label || i} (failure)`,     a.lose);
  });
}

mkdirSync(OUT, { recursive: true });

const manifest = rows.map(({ id, text }) => ({ id, text }));
writeFileSync(join(OUT, 'narration-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const csv = ['id,text', ...rows.map(r => `${r.id},"${r.text.replace(/"/g, '""')}"`)].join('\n') + '\n';
writeFileSync(join(OUT, 'narration-lines.csv'), csv);

const sheet = rows.map((r, i) =>
  `${String(i + 1).padStart(3, ' ')}. [${r.name}]\n` +
  `     save as:  public/sounds/Narration/${r.id}.wav\n` +
  `     narrate:  ${r.text}\n`
).join('\n');
writeFileSync(join(OUT, 'narration-script.txt'),
  `Dungeon Crawlers — skill-challenge narration script (desc + approach act/win/lose)\n` +
  `${rows.length} lines. Save each as a .wav (or .mp3) named exactly as shown, into public/sounds/Narration/\n` +
  `${'='.repeat(72)}\n\n${sheet}`);

console.log(`Extracted ${rows.length} lines -> ${join('scripts', 'narration', 'out')}/`);
console.log(`  narration-manifest.json   (game/check reference)`);
console.log(`  narration-script.txt      (record from this)`);
console.log(`  narration-lines.csv       (optional batch input)`);
