/**
 * Dungeon Crawlers — Headless Balance Simulator (entry point).
 *
 * Runs REAL game combat (via HeadlessGame) for Monte-Carlo balance testing.
 * Uses the existing herogen.mjs for party generation/leveling/gearing and
 * replaces the abstract combat_sim.mjs with the actual game engine.
 *
 * Usage:
 *   node sim/run_headless.mjs [--parties N] [--partySize N] [--maxLevel N]
 *                            [--encounters N] [--seed N] [--quiet]
 *
 * ~250 parties to L20 takes ~2-5 minutes (CPU-bound, no rendering).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { installSeededRandom } from './rng.mjs';
import { makeParty, levelPartyTo } from './herogen.mjs';
import { spawnMonster, crForDungeonLevel, CLASSES } from '../src/game/srd.js';
import { createArenaRoom, HeadlessGame } from './headless_game.mjs';

/* ───────────────────────────────────────────────────────────────────────── */
/* CLI args                                                                  */
/* ───────────────────────────────────────────────────────────────────────── */
function parseArgs(argv) {
  const cfg = {
    parties: 100,
    partySize: 4,
    maxLevel: 20,      // full 1-20 sweep
    encountersPerLevel: 4,
    seed: 1337,
    quiet: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--parties') cfg.parties = +next();
    else if (a === '--partySize') cfg.partySize = +next();
    else if (a === '--maxLevel') cfg.maxLevel = +next();
    else if (a === '--encounters') cfg.encountersPerLevel = +next();
    else if (a === '--seed') cfg.seed = +next();
    else if (a === '--quiet') cfg.quiet = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else console.warn(`(ignoring unknown arg: ${a})`);
  }
  return cfg;
}

function printHelp() {
  console.log(`Dungeon Crawlers headless balance simulator
  --parties N       randomized parties (default 100)
  --partySize N     heroes per party (default 4)
  --maxLevel N      level cap (default 8; use 20 for full sweep)
  --encounters N    encounters per level (default 4)
  --seed N          RNG seed (default 1337)
  --quiet           suppress progress`);
}

/* ───────────────────────────────────────────────────────────────────────── */
/* Stats helpers                                                             */
/* ───────────────────────────────────────────────────────────────────────── */
function initStats(h) {
  h._sim = {
    class: h.classKey,
    race: h.raceKey,
    name: h.name,
    encounters: 0,
    dmgDealt: 0, dmgTaken: 0, overkill: 0,
    healingDone: 0,
    kills: 0, downs: 0, deaths: 0,
    attacks: 0, hits: 0, misses: 0, crits: 0,
    byLevel: {},
  };
  // Temporary storage for per-encounter tracking
  h._enc = { startHp: h.hp };
}

function levelBucket(h) {
  const s = h._sim;
  const lvl = h.level || 1;
  if (!s.byLevel[lvl]) {
    s.byLevel[lvl] = { encounters: 0, dmgDealt: 0, dmgTaken: 0, healingDone: 0, kills: 0, downs: 0, deaths: 0 };
  }
  return s.byLevel[lvl];
}

function harvestStats(game, party) {
  let lastSpellCaster = null;

  for (const ev of game.eventLog) {
    const msg = ev.msg || '';

    // ── Track who is casting a spell for ↳ attribution ──
    const casterMatch = msg.match(/^\s*(?:⚔|✨|🐉|🎵|🌈|😈|🧚|😤|🌑|🌀|❄|🔊|✨|💚)\s*(\S+)\s+casts?\s/);
    if (casterMatch) {
      const h = party.find(x => x.name === casterMatch[1]);
      lastSpellCaster = h || null;
    }

    // ── Weapon damage: "Fighter → Goblin: hit, X dmg"  or  "💥 Fighter crits Goblin! — X dmg" ──
    let dmgMatch = msg.match(/^(?:💥\s*)?(\S+)\s*(?:→|crits|hits)\s+.+?(\d+)\s*dmg/);
    // ── Spell damage: "   ↳ X type to Target" ──
    if (!dmgMatch) dmgMatch = msg.match(/^\s*↳\s+(\d+)\s+\w+\s+to\s+/);
    // ── Monster damage to hero: "Monster hits Hero for X" ──
    if (!dmgMatch) dmgMatch = msg.match(/^\s*(\S+(?:\s\S+)*?)\s+hits\s+(\S+)\s+for\s+(\d+)/);

    if (dmgMatch) {
      if (msg.includes('↳')) {
        // Spell damage: attribute to last caster
        if (lastSpellCaster && lastSpellCaster._sim) {
          const d = parseInt(dmgMatch[1], 10);
          lastSpellCaster._sim.dmgDealt += d;
          levelBucket(lastSpellCaster).dmgDealt += d;
        }
      } else if (msg.includes('hits') && !msg.includes('→') && !msg.includes('crits')) {
        // Monster damage to hero: "Monster hits Hero for X"
        const heroName = dmgMatch[2];
        const h = party.find(x => x.name === heroName);
        if (h && h._sim) {
          const d = parseInt(dmgMatch[3], 10);
          h._sim.dmgTaken += d;
          levelBucket(h).dmgTaken += d;
        }
      } else {
        // Hero weapon damage
        const heroName = dmgMatch[1];
        const d = parseInt(dmgMatch[dmgMatch.length - 1], 10);
        const h = party.find(x => x.name === heroName);
        if (h && h._sim) {
          h._sim.dmgDealt += d;
          levelBucket(h).dmgDealt += d;
        }
      }
    }

    // ── Healing: "🧪 Cleric drinks a potion (+X)" or "catches a second wind (+X)" ──
    const healMatch = msg.match(/(?:potion|second wind|heal|ward|HP)\s*\(?(?:\+|-)?(\d+)\)?/i);
    if (healMatch && (msg.includes('potion') || msg.includes('second wind') || msg.includes('heal') || msg.includes('ward'))) {
      const heroNameMatch = msg.match(/^[🧪💊🛡️✨📣]*\s*(\S+)\s/);
      if (heroNameMatch) {
        const h = party.find(x => x.name === heroNameMatch[1]);
        if (h && h._sim) {
          const amt = parseInt(healMatch[1], 10);
          h._sim.healingDone += amt;
          levelBucket(h).healingDone += amt;
        }
      }
    }
    // ── Self-heal: "Fighter catches a second wind (+X)" ──
    const selfHeal = msg.match(/^(\S+)\s+catches a second wind\s*\(\+(\d+)\)/);
    if (selfHeal) {
      const h = party.find(x => x.name === selfHeal[1]);
      if (h && h._sim) {
        const amt = parseInt(selfHeal[2], 10);
        h._sim.healingDone += amt;
        levelBucket(h).healingDone += amt;
      }
    }

    // ── Kill: "Fighter slays the Goblin." ──
    const killMatch = msg.match(/^(\S+)\s+slays\s+the\s+/);
    if (killMatch) {
      const h = party.find(x => x.name === killMatch[1]);
      if (h && h._sim) { h._sim.kills++; levelBucket(h).kills++; }
    }

    // ── Down: "💀 Fighter goes down!" ──
    const downMatch = msg.match(/💀\s*(\S+)\s+goes down/);
    if (downMatch) {
      const h = party.find(x => x.name === downMatch[1]);
      if (h && h._sim) { h._sim.downs++; levelBucket(h).downs++; }
    }
  }

  // Track remaining damage taken from HP delta and encounter counts
  for (const heroEnt of game.heroes) {
    const h = heroEnt.data;
    if (!h._sim) continue;
    h._sim.encounters++;
    const b = levelBucket(h);
    b.encounters++;
    const startHp = h._enc?.startHp ?? h.maxHp;
    const endHp = Math.max(0, h.hp);
    const delta = Math.max(0, startHp - endHp);
    // Don't double-count — only add HP delta that wasn't already from event log
    // Use the delta as a sanity floor
    if (delta > 0 && h._sim.dmgTaken === 0) {
      h._sim.dmgTaken += delta;
      b.dmgTaken += delta;
    }
    if (h.hp <= 0) { h._sim.deaths++; b.deaths++; }
    h._enc = { startHp: h.hp };
  }
}

function longRest(game) {
  for (const heroEnt of game.heroes) {
    const h = heroEnt.data;
    h.hp = h.maxHp;
    if (h.slotsMax) h.slots = { ...h.slotsMax };
    h.abilityUsed = { short: false, long: false };
    if (CLASSES[h.classKey]?.secondWind) h.secondWind = true;
  }
}

/* ───────────────────────────────────────────────────────────────────────── */
/* One party's career (synchronous — HeadlessGame is CPU-bound, no async)    */
/* ───────────────────────────────────────────────────────────────────────── */
function simulatePartyCareer(rng, cfg) {
  const party = makeParty(rng, cfg.partySize);
  for (const h of party) initStats(h);

  for (let level = 1; level <= cfg.maxLevel; level++) {
    levelPartyTo(party, level, rng);

    const arena = createArenaRoom(24, 18);
    const game = new HeadlessGame(arena, party, { dungeonLevel: level });
    longRest(game);

    for (let e = 0; e < cfg.encountersPerLevel; e++) {
      game.monsters = [];
      const isBoss = e === cfg.encountersPerLevel - 1;
      const monsterCount = isBoss ? cfg.partySize : (2 + Math.floor(rng() * 3));
      const monsters = [];
      for (let i = 0; i < monsterCount; i++) {
        const cr = crForDungeonLevel(level, rng);
        const m = spawnMonster(cr, level, rng, null, null);
        if (isBoss) m.isBoss = true;
        monsters.push(m);
      }
      game.spawnMonsters(monsters);

      game.runUntilResolved();
      harvestStats(game, party);

      if (!isBoss) longRest(game);
    }
  }
  return party;
}

/* ───────────────────────────────────────────────────────────────────────── */
/* Aggregation & reporting                                                  */
/* ───────────────────────────────────────────────────────────────────────── */
function aggregate(allHeroes) {
  const byClass = {};
  for (const h of allHeroes) {
    if (!h._sim) continue;
    const s = h._sim;
    const key = s.class;
    if (!byClass[key]) byClass[key] = [];
    byClass[key].push(s);
  }

  const summary = {};
  for (const [cls, sims] of Object.entries(byClass)) {
    const n = sims.length;
    const avg = arr => arr.reduce((a, b) => a + b, 0) / n;
    summary[cls] = {
      count: n,
      avgDmgDealt: avg(sims.map(s => s.dmgDealt)),
      avgDmgTaken: avg(sims.map(s => s.dmgTaken)),
      avgHealing: avg(sims.map(s => s.healingDone)),
      avgKills: avg(sims.map(s => s.kills)),
      avgDowns: avg(sims.map(s => s.downs)),
      avgDeaths: avg(sims.map(s => s.deaths)),
      avgEncounters: avg(sims.map(s => s.encounters)),
    };
  }
  return { byClass, summary };
}

function renderReport(agg, cfg) {
  let s = '# Headless Balance Report\n\n';
  s += `- **Parties:** ${cfg.parties}\n`;
  s += `- **Party size:** ${cfg.partySize}\n`;
  s += `- **Max level:** ${cfg.maxLevel}\n`;
  s += `- **Encounters per level:** ${cfg.encountersPerLevel}\n`;
  s += `- **Seed:** ${cfg.seed}\n\n`;

  s += '## Class Summary\n\n';
  s += '| Class | Heroes | Dmg/Enc | Taken/Enc | Heal/Enc | Kills/Enc | Downs/Enc |\n';
  s += '|-------|--------|---------|-----------|----------|-----------|----------|\n';

  const sorted = Object.entries(agg.summary).sort((a, b) => b[1].avgDmgDealt - a[1].avgDmgDealt);
  for (const [cls, sum] of sorted) {
    const enc = sum.avgEncounters || 1;
    s += `| ${cls} | ${sum.count} | ${(sum.avgDmgDealt / enc).toFixed(0)} | ${(sum.avgDmgTaken / enc).toFixed(0)} | ${(sum.avgHealing / enc).toFixed(0)} | ${(sum.avgKills / enc).toFixed(2)} | ${(sum.avgDowns / enc).toFixed(2)} |\n`;
  }
  return s;
}

/* ───────────────────────────────────────────────────────────────────────── */
/* main                                                                     */
/* ───────────────────────────────────────────────────────────────────────── */
function main() {
  const cfg = parseArgs(process.argv);
  installSeededRandom(cfg.seed);
  const rng = Math.random;

  const t0 = Date.now();
  const allHeroes = [];

  for (let p = 0; p < cfg.parties; p++) {
    const party = simulatePartyCareer(rng, cfg);
    allHeroes.push(...party);
    if (!cfg.quiet && (p + 1) % Math.max(1, Math.floor(cfg.parties / 10)) === 0) {
      process.stdout.write(`\r  simulated ${p + 1}/${cfg.parties} parties…`);
    }
  }
  if (!cfg.quiet) process.stdout.write('\n');

  const agg = aggregate(allHeroes);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  if (!cfg.quiet) {
    console.log('\n' + renderReport(agg, cfg));
  }
  console.log(`\n✔ Simulated ${allHeroes.length} hero-runs in ${secs}s.`);

  // Write reports
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const mdPath = path.join(dir, `headless_${ts}.md`);
  const jsonPath = path.join(dir, `headless_${ts}.json`);
  fs.writeFileSync(mdPath, renderReport(agg, cfg));
  fs.writeFileSync(jsonPath, JSON.stringify(agg, null, 2));

  // Also write as latest
  fs.writeFileSync(path.join(dir, 'headless_latest.md'), renderReport(agg, cfg));
  fs.writeFileSync(path.join(dir, 'headless_latest.json'), JSON.stringify(agg, null, 2));

  console.log(`  Report:  ${path.relative(process.cwd(), mdPath)}`);
  console.log(`  JSON:    ${path.relative(process.cwd(), jsonPath)}`);
}

main();
