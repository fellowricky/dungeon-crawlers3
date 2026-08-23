/* One-shot data patch runner for monsters.json.
 *
 * Reads every `scripts/monster_ability_patches/*.mjs` batch file. Each batch
 * exports a plain object keyed by monster id with any of:
 *   flags: { field: value, ... }           → set scalar fields (merge)
 *   abilities: { key: [entry, ...] }        → REPLACE the monster's abilities array
 *   append:   { key: [entry, ...] }         → APPEND entries to existing abilities
 *
 * Usage: node scripts/apply_monster_ability_patches.mjs
 * Backs up monsters.json to monsters.backup.json first (as the repo convention
 * already keeps). Idempotent: re-running only re-applies the same values.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'src/game/monsters.json');
const PATCH_DIR = path.join(ROOT, 'scripts/monster_ability_patches');

const monsters = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const byId = new Map(monsters.map(m => [m.id, m]));

const batchFiles = fs.readdirSync(PATCH_DIR).filter(f => f.endsWith('.mjs')).sort();
let appliedFlags = 0;
let appliedAbilities = 0;
const touched = new Set();

for (const file of batchFiles) {
  const patch = (await import(pathToFileURL(path.join(PATCH_DIR, file)).href)).default;
  for (const [id, op] of Object.entries(patch)) {
    const m = byId.get(id);
    if (!m) throw new Error(`[${file}] unknown monster id: ${id}`);
    if (op.flags) {
      for (const [k, v] of Object.entries(op.flags)) {
        if (m[k] !== v) { m[k] = v; appliedFlags++; }
      }
    }
    if (op.abilities) {
      const entries = Array.isArray(op.abilities) ? op.abilities : [op.abilities];
      if (JSON.stringify(m.abilities) !== JSON.stringify(entries)) {
        m.abilities = entries;
        appliedAbilities++;
      }
    }
    if (op.append) {
      const entries = Array.isArray(op.append) ? op.append : [op.append];
      if (!m.abilities) m.abilities = [];
      const before = JSON.stringify(m.abilities);
      for (const e of entries) {
        if (!m.abilities.some(a => a.key === e.key)) m.abilities.push(e);
      }
      if (JSON.stringify(m.abilities) !== before) appliedAbilities++;
    }
    touched.add(id);
  }
}

/* stable ordering: keep abilities array sorted by trigger order for readability */
const TRIGGER_ORDER = { onHit: 0, aura: 1, onDamaged: 2, onKill: 3, onBloodied: 4, cycle: 5, onDeath: 6 };
for (const id of touched) {
  const m = byId.get(id);
  if (Array.isArray(m.abilities)) {
    m.abilities.sort((a, b) =>
      (TRIGGER_ORDER[a.trigger] ?? 9) - (TRIGGER_ORDER[b.trigger] ?? 9));
  }
}

fs.writeFileSync(DATA, JSON.stringify(monsters, null, 2) + '\n', 'utf8');
const coverage = monsters.filter(m => m.abilities && m.abilities.length).length;
console.log(`Applied ${appliedFlags} flag fields and ${appliedAbilities} ability sets across ${touched.size} monsters.`);
console.log(`Monsters with abilities now: ${coverage}/${monsters.length} (${(coverage / monsters.length * 100).toFixed(1)}%).`);
