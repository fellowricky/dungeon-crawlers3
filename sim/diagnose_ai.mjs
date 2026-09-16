/**
 * AI decision diagnostics.
 *
 * Runs real fights with the decision trace on and reports, per class, WHY turns
 * ended without the hero doing anything. The aggregate metrics in
 * run_headless.mjs tell you *that* a hero wasted its turn; this tells you which
 * branch of the AI made the call and what it was looking at.
 *
 * Usage:
 *   node sim/diagnose_ai.mjs                     # all classes
 *   node sim/diagnose_ai.mjs --class paladin     # one class, with sample turns
 *   node sim/diagnose_ai.mjs --class paladin --samples 12
 */
import { installSeededRandom } from './rng.mjs';
import { makeParty, levelPartyTo } from './herogen.mjs';
import { spawnMonster, crForDungeonLevel } from '../src/game/srd.js';
import { createArenaRoom, HeadlessGame } from './headless_game.mjs';
import { Trace } from '../src/game/ai_trace.js';

function parseArgs(argv) {
  const cfg = { parties: 12, partySize: 4, maxLevel: 8, encounters: 3, seed: 99, cls: null, samples: 6 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--parties') cfg.parties = +next();
    else if (a === '--maxLevel') cfg.maxLevel = +next();
    else if (a === '--encounters') cfg.encounters = +next();
    else if (a === '--seed') cfg.seed = +next();
    else if (a === '--class') cfg.cls = next();
    else if (a === '--samples') cfg.samples = +next();
  }
  return cfg;
}

const cfg = parseArgs(process.argv);
installSeededRandom(cfg.seed);
const rng = Math.random;

Trace.enable(true);
Trace.max = 200000;

/* Classify an idle turn by the last decision the AI logged. */
function classify(turn) {
  const last = turn.steps[turn.steps.length - 1];
  if (!last) return 'no decision recorded';
  if (last.event === 'hold') return 'held: out of movement, still out of reach';
  if (last.event === 'move') {
    return last.data && last.data.reachable === false
      ? 'walked: NO PATH to target'
      : 'walked: still closing, ran out of turn';
  }
  if (last.event === 'disengage') return 'disengaged';
  if (last.event === 'dodge') return 'dodged';
  if (last.event === 'target') return 'picked a target, then did nothing';
  return `ended on: ${last.event}`;
}

const byClass = new Map();
const samples = new Map();

for (let p = 0; p < cfg.parties; p++) {
  const party = makeParty(rng, cfg.partySize);
  for (let level = 1; level <= cfg.maxLevel; level++) {
    levelPartyTo(party, level, rng);
    const arena = createArenaRoom(24, 18);
    const game = new HeadlessGame(arena, party, { dungeonLevel: level });
    for (const h of game.heroes) { h.data.hp = h.data.maxHp; if (h.data.slotsMax) h.data.slots = { ...h.data.slotsMax }; }

    for (let e = 0; e < cfg.encounters; e++) {
      game.monsters = [];
      const monsters = [];
      const n = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) monsters.push(spawnMonster(crForDungeonLevel(level, rng), level, rng, null, null));
      game.spawnMonsters(monsters);
      Trace.clear();
      game.runUntilResolved();

      for (const turn of Trace.turns()) {
        if (!turn.cls) continue;
        const rec = byClass.get(turn.cls) || { total: 0, idle: 0, reasons: new Map() };
        rec.total++;
        const productive = turn.steps.some(s =>
          s.event === 'attack' || s.event === 'cast' || s.event === 'heal'
          || s.event === 'skip' || s.event === 'shift');
        if (!productive) {
          rec.idle++;
          const why = classify(turn);
          rec.reasons.set(why, (rec.reasons.get(why) || 0) + 1);
          if (cfg.cls && turn.cls === cfg.cls) {
            const list = samples.get(why) || [];
            if (list.length < cfg.samples) {
              list.push(`── ${turn.name} (${turn.cls}) hp ${turn.hp} · round ${turn.round}\n`
                + turn.steps.map(s => `     ${s.event.padEnd(9)} ${s.why}`).join('\n'));
              samples.set(why, list);
            }
          }
        }
        byClass.set(turn.cls, rec);
      }
    }
  }
}

const rows = [...byClass.entries()]
  .filter(([cls]) => !cfg.cls || cls === cfg.cls)
  .sort((a, b) => (b[1].idle / b[1].total) - (a[1].idle / a[1].total));

console.log('\nIdle-turn rate by class (turns with no attack and no spell)\n');
console.log('class        turns   idle    rate');
for (const [cls, r] of rows) {
  console.log(`${cls.padEnd(12)} ${String(r.total).padStart(5)} ${String(r.idle).padStart(6)}  ${(100 * r.idle / r.total).toFixed(1).padStart(5)}%`);
}
/* Per-class counts are noisy — any code change shifts the RNG stream, so the
   parties themselves differ run to run. The total is the number to track. */
const tot = rows.reduce((a, [, r]) => ({ total: a.total + r.total, idle: a.idle + r.idle }), { total: 0, idle: 0 });
console.log('-'.repeat(38));
console.log(`${'ALL'.padEnd(12)} ${String(tot.total).padStart(5)} ${String(tot.idle).padStart(6)}  ${(100 * tot.idle / tot.total).toFixed(1).padStart(5)}%`);

const allReasons = new Map();
for (const [, r] of rows) for (const [why, n] of r.reasons) allReasons.set(why, (allReasons.get(why) || 0) + n);
console.log('\nWhy turns went idle (all classes)\n');
for (const [why, n] of [...allReasons].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(5)}  ${why}`);
}

console.log('\nWhy those turns went idle, by class\n');
for (const [cls, r] of rows) {
  if (!r.idle) continue;
  console.log(`${cls}:`);
  for (const [why, n] of [...r.reasons].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(5)}  ${why}`);
  }
}

if (cfg.cls && samples.size) {
  console.log(`\n── Sample ${cfg.cls} turns ──`);
  for (const [why, list] of samples) {
    console.log(`\n### ${why}\n`);
    for (const s of list) console.log(s + '\n');
  }
}
