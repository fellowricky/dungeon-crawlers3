/**
 * Dungeon Crawlers — class balance simulator (entry point).
 *
 * Generates many randomized parties, levels each one 1 → maxLevel with proper
 * choices and level-appropriate gear, fights a floor of encounters at every
 * level, gathers rich combat statistics, and writes a readable balance report.
 *
 * Usage:
 *   node sim/run.mjs [--parties N] [--partySize N] [--maxLevel N]
 *                    [--encounters N] [--seed N] [--quiet]
 *
 * Examples:
 *   node sim/run.mjs                          # default sweep
 *   node sim/run.mjs --parties 400 --seed 7   # bigger, reproducible sweep
 *   node sim/run.mjs --maxLevel 20 --encounters 8
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { installSeededRandom } from './rng.mjs';
import { makeParty, levelPartyTo } from './herogen.mjs';
import {
  initHeroStats, makeEncounter, runEncounter, shortRest, longRest,
} from './combat_sim.mjs';
import { aggregate, writeReports, renderMarkdown } from './report.mjs';

/* ------------------------------------------------------------------ */
/* CLI args                                                            */
/* ------------------------------------------------------------------ */
function parseArgs(argv) {
  const cfg = {
    parties: 150,
    partySize: 4,
    maxLevel: 20,
    encountersPerLevel: 6,   // one "floor" of fights per level
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
  console.log(`Dungeon Crawlers balance simulator
  --parties N       number of randomized parties to simulate (default 150)
  --partySize N     heroes per party (default 4)
  --maxLevel N      level to raise each party to (default 20)
  --encounters N    encounters per level / "floor" (default 6)
  --seed N          RNG seed for a reproducible run (default 1337)
  --quiet           suppress progress output`);
}

/* ------------------------------------------------------------------ */
/* one party's full 1 -> maxLevel career                               */
/* ------------------------------------------------------------------ */
function simulatePartyCareer(rng, cfg) {
  const party = makeParty(rng, cfg.partySize);
  for (const h of party) initHeroStats(h);

  for (let level = 1; level <= cfg.maxLevel; level++) {
    // bring the party to this level (resolves choices + re-gears)
    levelPartyTo(party, level, rng);
    longRest(party);            // fresh floor: full HP, abilities reset

    // a "floor" = a run of encounters, capped by a boss, with short rests between
    for (let e = 0; e < cfg.encountersPerLevel; e++) {
      const isLast = e === cfg.encountersPerLevel - 1;
      const kind = isLast ? 'boss' : (rng() < 0.2 ? 'elite' : 'normal');
      const encounter = makeEncounter(level, cfg.partySize, kind, rng);
      runEncounter(party, encounter);
      if (!isLast) shortRest(party);      // short rest between fights
    }
  }
  return party;
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */
function main() {
  const cfg = parseArgs(process.argv);
  installSeededRandom(cfg.seed);   // make the whole run reproducible
  const rng = Math.random;         // seeded stream

  const t0 = Date.now();
  const allHeroes = [];
  for (let p = 0; p < cfg.parties; p++) {
    const party = simulatePartyCareer(rng, cfg);
    allHeroes.push(...party);
    if (!cfg.quiet && (p + 1) % Math.max(1, Math.floor(cfg.parties / 20)) === 0) {
      process.stdout.write(`\r  simulated ${p + 1}/${cfg.parties} parties…`);
    }
  }
  if (!cfg.quiet) process.stdout.write('\n');

  const agg = aggregate(allHeroes);
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'reports');
  const paths = writeReports(agg, cfg, dir);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  if (!cfg.quiet) {
    // print the markdown to the console too for quick reading
    console.log('\n' + renderMarkdown(agg, cfg));
  }
  console.log(`\n✔ Simulated ${allHeroes.length} hero-runs in ${secs}s.`);
  console.log(`  Report:  ${path.relative(process.cwd(), paths.latestMd)}`);
  console.log(`  JSON:    ${path.relative(process.cwd(), paths.latestJson)}`);
}

main();
