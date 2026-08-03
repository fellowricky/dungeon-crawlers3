/**
 * Dungeon Crawlers — gear affix / perk VALUATION harness.
 *
 * Answers "what is +1 of X actually worth?" so the loot budget system can price
 * every bonus in one currency instead of by feel.
 *
 * METHOD — paired A/B trials with common random numbers:
 *   For each candidate bonus, a party is built from a seed, levelled, and run
 *   through a gauntlet TWICE — once clean, once with the candidate injected as a
 *   synthetic equipped item. Both arms rebuild from the same seed and reset the
 *   RNG to the same combat stream, so the two runs share their rolls until the
 *   candidate itself causes divergence. That variance reduction is what makes
 *   small effects (a single +1) measurable without absurd sample counts.
 *
 * TWO METRICS, measured in SEPARATE MODES so they can't contaminate each other:
 *
 *   O (offense) — a normal gauntlet. O = party damage dealt per hero-round.
 *
 *   D (defense) — a "punching bag" encounter whose monsters have their HP
 *     inflated so far they cannot die. D = the number of monster attacks the
 *     party absorbs before it wipes.
 *
 *     The separate mode is not incidental, it is the whole point. An earlier
 *     version measured defense inside the normal gauntlet and normalised damage
 *     taken per monster attack; that still leaked, because killing faster ends
 *     the fight sooner and shifts the mix of incoming attacks away from bosses.
 *     +1 atk consequently scored ~half the defensive gain of +1 AC, which made
 *     the anchor equation degenerate (denominator ≈ 0) and blew the solved
 *     weight up to ~142. With immortal monsters, offence cannot shorten the
 *     fight, so ΔD for a pure-offence bonus is ~0 and the solve is stable.
 *     Mitigation, HP, healing and lifesteal all still register.
 *
 * THE EXCHANGE RATE IS NOT INVENTED HERE. The design fixes two anchors by
 * decree — +1 atk = 10 points and +1 AC = 20 points. The harness measures ΔO
 * and ΔD for both, then SOLVES for the single weight `w` in
 *     value = ΔO% + w · ΔD%
 * that makes those two anchors come out at 10 and 20. Every other bonus is then
 * priced with that same w. So the offense/defense exchange rate is the designer's
 * call, and everything else is measured consistently against it.
 *
 * Usage:
 *   node sim/value.mjs                                  # default sweep
 *   node sim/value.mjs --trials 60 --levels 3,7,12,17
 *   node sim/value.mjs --only atk,ac,cleave --quiet
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { installSeededRandom } from './rng.mjs';
import { makeParty, levelPartyTo } from './herogen.mjs';
import {
  initHeroStats, makeEncounter, runEncounter, shortRest, longRest, simCounters,
} from './combat_sim.mjs';
import { recalc } from '../src/game/srd.js';
import { PERKS, PERK_MAGS } from '../src/game/items.js';

/* ------------------------------------------------------------------ */
/* Candidates under test                                               */
/* ------------------------------------------------------------------ */
/* `bonuses` are injected exactly as an item's bonuses block, so they flow
   through the real aggregateEquipment → recalc path. `perk` injects a proc perk
   at the trial's level. */
const CANDIDATES = [
  { key: 'atk',    label: '+1 Attack',        bonuses: { atk: 1 } },
  { key: 'ac',     label: '+1 AC',            bonuses: { ac: 1 } },
  { key: 'dmg',    label: '+1 Damage',        bonuses: { dmg: 1 } },
  { key: 'hp5',    label: '+5 HP',            bonuses: { hp: 5 } },
  { key: 'crit',   label: '+1 Crit range',    bonuses: { crit: 1 } },
  { key: 'heal2',  label: '+2 Heal',          bonuses: { heal: 2 } },
  /* The abstract combat model has no positions or movement, so `speed` has
     nothing to act on. Kept in the sweep to make that explicit — it reports as
     UNMODELED rather than silently pricing at zero. */
  { key: 'speed',  label: '+5% Speed',        bonuses: { speed: 0.05 }, unmodeled: true },
  /* Ability scores are measured at +1 AND +2 on purpose: gear grants raw
     SCORES today, so a +1 landing on an odd score does nothing. If +2 is worth
     much more than twice +1, that asymmetry is the odd/even problem, quantified. */
  { key: 'str1',   label: '+1 STR (score)',   bonuses: { str: 1 } },
  { key: 'str2',   label: '+2 STR (score)',   bonuses: { str: 2 } },
  { key: 'dex1',   label: '+1 DEX (score)',   bonuses: { dex: 1 } },
  { key: 'dex2',   label: '+2 DEX (score)',   bonuses: { dex: 2 } },
  { key: 'con1',   label: '+1 CON (score)',   bonuses: { con: 1 } },
  { key: 'con2',   label: '+2 CON (score)',   bonuses: { con: 2 } },
  { key: 'int1',   label: '+1 INT (score)',   bonuses: { int: 1 } },
  { key: 'int2',   label: '+2 INT (score)',   bonuses: { int: 2 } },
  { key: 'wis1',   label: '+1 WIS (score)',   bonuses: { wis: 1 } },
  { key: 'wis2',   label: '+2 WIS (score)',   bonuses: { wis: 2 } },
  { key: 'cha1',   label: '+1 CHA (score)',   bonuses: { cha: 1 } },
  { key: 'cha2',   label: '+2 CHA (score)',   bonuses: { cha: 2 } },
];

/* Every proc perk in items.json (passives are priced as their stat block, so
   they're excluded — PERK_MAGS is exactly the set of proc perks). */
for (const id of Object.keys(PERK_MAGS)) {
  CANDIDATES.push({ key: id, label: `Perk: ${PERKS[id]?.name || id}`, perk: id, isPerk: true });
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */
function parseArgs(argv) {
  const cfg = {
    trials: 40,
    partySize: 4,
    levels: [3, 7, 12, 17],
    encounters: 6,
    defenseBouts: 4,
    defenseRoundCap: 30,
    seed: 4242,
    only: null,
    quiet: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--trials') cfg.trials = +next();
    else if (a === '--partySize') cfg.partySize = +next();
    else if (a === '--levels') cfg.levels = next().split(',').map(Number);
    else if (a === '--encounters') cfg.encounters = +next();
    else if (a === '--defenseBouts') cfg.defenseBouts = +next();
    else if (a === '--defenseRoundCap') cfg.defenseRoundCap = +next();
    else if (a === '--seed') cfg.seed = +next();
    else if (a === '--only') cfg.only = new Set(next().split(','));
    else if (a === '--quiet') cfg.quiet = true;
    else if (a === '--help' || a === '-h') {
      console.log(`Dungeon Crawlers affix valuation harness
  --trials N      paired trials per candidate per level (default 40)
  --partySize N   heroes per party (default 4)
  --levels a,b,c  character levels to sample (default 3,7,12,17)
  --encounters N  encounters per gauntlet (default 6)
  --defenseBouts N  punching-bag wipes per defense arm (default 4)
  --seed N        base RNG seed (default 4242)
  --only k1,k2    only measure these candidate keys
  --quiet         suppress the console report`);
      process.exit(0);
    } else console.warn(`(ignoring unknown arg: ${a})`);
  }
  return cfg;
}

/* ------------------------------------------------------------------ */
/* Candidate injection                                                 */
/* ------------------------------------------------------------------ */

/**
 * Attach the candidate to every hero as a synthetic equipped item in a pseudo
 * slot. `aggregateEquipment` iterates equipment keys generically, and
 * `_migrated: true` makes migrateItem pass the bonuses through untouched — so
 * this exercises the real stat pipeline without needing a real base item.
 */
function applyCandidate(party, cand, level) {
  for (const h of party) {
    h.equipment.__test = {
      _migrated: true,
      id: '__test',
      slot: 'ring',
      baseKey: '__test',
      name: '__test',
      rarity: 'common',
      ilvl: level,
      affixKeys: [],
      prof: 'none',
      value: 0,
      perk: cand.perk ? { id: cand.perk } : null,
      bonuses: cand.bonuses ? { ...cand.bonuses } : {},
    };
    recalc(h);
    h.hp = h.maxHp;
  }
}

/* ------------------------------------------------------------------ */
/* One arm of a paired trial                                           */
/* ------------------------------------------------------------------ */

function buildParty(seed, level, size) {
  installSeededRandom(seed);
  const rng = Math.random;
  const party = makeParty(rng, size);
  for (const h of party) initHeroStats(h);
  levelPartyTo(party, level, rng);
  return party;
}

/** Offense arm: a normal gauntlet. Returns party damage dealt per hero-round. */
function runOffenseArm(seed, level, size, cand, cfg) {
  const party = buildParty(seed, level, size);
  if (cand) applyCandidate(party, cand, level);
  for (const h of party) initHeroStats(h);      // fresh stats for the gauntlet only

  /* Identical combat stream in both arms (common random numbers). */
  installSeededRandom(seed * 7919 + 13);
  simCounters.monsterActions = 0;
  longRest(party);

  for (let e = 0; e < cfg.encounters; e++) {
    const isLast = e === cfg.encounters - 1;
    const kind = isLast ? 'boss' : (Math.random() < 0.2 ? 'elite' : 'normal');
    const enc = makeEncounter(level, size, kind, Math.random);
    runEncounter(party, enc);
    if (!isLast) shortRest(party);
  }
  let dealt = 0, rounds = 0;
  for (const h of party) { dealt += h._sim.dmgDealt; rounds += h._sim.rounds; }
  return rounds > 0 ? dealt / rounds : 0;
}

/**
 * Defense arm: one encounter against monsters that cannot die, run until the
 * party wipes. Returns the number of monster attacks absorbed.
 *
 * Inflating monster HP (rather than adding an `immortal` branch to combat_sim)
 * keeps the combat model untouched — heroes still attack normally, so lifesteal,
 * Thorns and Riposte all still contribute exactly as they would in a real fight.
 */
function runDefenseArm(seed, level, size, cand, cfg) {
  const party = buildParty(seed, level, size);
  if (cand) applyCandidate(party, cand, level);
  for (const h of party) initHeroStats(h);

  installSeededRandom(seed * 7919 + 13);
  simCounters.monsterActions = 0;

  /* Several independent wipes per trial. Time-to-wipe is a high-variance
     stopping statistic, and a pure-offense bonus only shows ΔD ≈ 0 once that
     variance is averaged down — otherwise RNG divergence between the two arms
     leaks straight into the solved weight. */
  for (let b = 0; b < cfg.defenseBouts; b++) {
    longRest(party);
    const enc = makeEncounter(level, size, 'boss', Math.random);
    for (const m of enc.monsters) { m.maxHp *= 1e9; m.hp = m.maxHp; }
    /* Bounded so a sustain effect can't score infinitely — see maxRounds in
       runEncounter. Survival past the cap is censored, which is why sustain
       perks are reported as a LOWER BOUND rather than a price. */
    enc.maxRounds = cfg.defenseRoundCap;
    runEncounter(party, enc);
  }
  return simCounters.monsterActions;
}

/* ------------------------------------------------------------------ */
/* Measurement                                                         */
/* ------------------------------------------------------------------ */

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const stderr = a => {
  if (a.length < 2) return 0;
  const m = mean(a);
  const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
  return Math.sqrt(v / a.length);
};

/**
 * Measure one candidate: returns mean ΔO% and ΔD% (and their standard errors)
 * pooled across the sampled levels, plus the per-level breakdown.
 */
function measure(cand, cfg) {
  const dO = [], dD = [];
  const byLevel = {};
  for (const level of cfg.levels) {
    const lO = [], lD = [];
    for (let t = 0; t < cfg.trials; t++) {
      const seed = cfg.seed + level * 100003 + t * 7717;
      const baseO = runOffenseArm(seed, level, cfg.partySize, null, cfg);
      const testO = runOffenseArm(seed, level, cfg.partySize, cand, cfg);
      if (baseO > 0) lO.push(testO / baseO - 1);
      const baseD = runDefenseArm(seed, level, cfg.partySize, null, cfg);
      const testD = runDefenseArm(seed, level, cfg.partySize, cand, cfg);
      if (baseD > 0) lD.push(testD / baseD - 1);
    }
    byLevel[level] = { dO: mean(lO), dD: mean(lD) };
    dO.push(...lO);
    dD.push(...lD);
  }
  return {
    key: cand.key, label: cand.label, isPerk: !!cand.isPerk, unmodeled: !!cand.unmodeled,
    dO: mean(dO), dD: mean(dD),
    seO: stderr(dO), seD: stderr(dD),
    byLevel,
  };
}

/* ------------------------------------------------------------------ */
/* Pricing                                                             */
/* ------------------------------------------------------------------ */

/* Design decree: these two anchors set the whole scale. */
const ANCHOR_ATK = 10;
const ANCHOR_AC = 20;

/**
 * Solve the offense/defense weight `w` from the two anchors, then price
 * everything with it.
 *
 *   value(X) = ΔO(X) + w · ΔD(X)
 *   want:  value(ac) / value(atk) = ANCHOR_AC / ANCHOR_ATK  ( = 2 )
 *
 * Expanding and solving for w:
 *   ΔO_ac + w·ΔD_ac = r·(ΔO_atk + w·ΔD_atk)
 *   w = (r·ΔO_atk − ΔO_ac) / (ΔD_ac − r·ΔD_atk)
 */
function priceAll(results) {
  const atk = results.find(r => r.key === 'atk');
  const ac = results.find(r => r.key === 'ac');
  if (!atk || !ac) throw new Error('atk and ac must both be measured — they set the scale');

  const r = ANCHOR_AC / ANCHOR_ATK;
  const denom = ac.dD - r * atk.dD;

  /* Conditioning check. The solve is only trustworthy while the anchors are
     defensively distinguishable — i.e. the denominator is a healthy fraction of
     the AC arm's own defensive gain. When defence leaks into the offence anchor,
     `denom` collapses toward 0 and `w` runs away (this is exactly what happened
     before defence got its own punching-bag mode). Surfaced rather than
     silently producing plausible-looking nonsense. */
  const conditioning = ac.dD !== 0 ? Math.abs(denom / ac.dD) : 0;
  if (Math.abs(denom) < 1e-9) throw new Error('degenerate anchors: cannot solve for w');

  const w = (r * atk.dO - ac.dO) / denom;
  const valueOf = x => x.dO + w * x.dD;
  const unit = valueOf(atk) / ANCHOR_ATK;      // value per point

  for (const x of results) {
    x.value = valueOf(x);
    x.points = (unit !== 0 && !x.unmodeled) ? x.value / unit : null;
  }
  return { w, unit, conditioning };
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

function pct(x) { return (x * 100).toFixed(2) + '%'; }

function renderMarkdown(results, calib, cfg) {
  const L = [];
  L.push('# Gear Valuation Report');
  L.push('');
  L.push(`Trials: **${cfg.trials}** paired runs × levels **${cfg.levels.join(', ')}** ` +
         `· party size ${cfg.partySize} · ${cfg.encounters} encounters/gauntlet · seed ${cfg.seed}`);
  L.push('');
  L.push(`Offense/defense weight solved from the anchors (+1 atk = ${ANCHOR_ATK}, ` +
         `+1 AC = ${ANCHOR_AC}): **w = ${calib.w.toFixed(3)}** ` +
         `(conditioning ${(calib.conditioning * 100).toFixed(0)}% — ` +
         `${calib.conditioning > 0.5 ? 'healthy' : 'WEAK, treat costs with suspicion'})`);
  L.push('');
  L.push('`ΔO` = damage dealt per hero-round, measured in a normal gauntlet. ' +
         '`ΔD` = monster attacks absorbed before a wipe, measured against ' +
         'monsters that cannot die so offense cannot shorten the fight. ' +
         '`±` are standard errors — a bonus whose ΔO and ΔD both sit inside their ' +
         'error bars is measuring noise, not value.');
  L.push('');

  const rows = (list, title) => {
    if (!list.length) return;
    L.push(`## ${title}`);
    L.push('');
    L.push('| Bonus | ΔO | ± | ΔD | ± | **Points** |');
    L.push('|---|---:|---:|---:|---:|---:|');
    for (const x of list) {
      /* Costs are whole numbers — the budget system spends integers, and a
         tenth of a point is well inside the measurement error anyway. */
      const pts = x.points == null ? '_unmodeled_' : `**${Math.round(x.points)}**`;
      L.push(`| ${x.label} | ${pct(x.dO)} | ${pct(x.seO)} | ${pct(x.dD)} | ${pct(x.seD)} | ${pts} |`);
    }
    L.push('');
  };

  const byPoints = (a, b) => (b.points ?? -Infinity) - (a.points ?? -Infinity);
  const stats = results.filter(x => !x.isPerk).sort(byPoints);
  const perks = results.filter(x => x.isPerk).sort(byPoints);
  rows(stats, 'Stat bonuses');
  rows(perks, 'Proc perks');

  L.push('## Points by level');
  L.push('');
  L.push('Where a bonus is worth more or less over a career — a flat row means it ' +
         'scales with the game, a falling row means it decays into irrelevance.');
  L.push('');
  L.push(`| Bonus | ${cfg.levels.map(l => 'L' + l).join(' | ')} |`);
  L.push(`|---|${cfg.levels.map(() => '---:').join('|')}|`);
  const unit = calib.unit;
  for (const x of [...stats, ...perks]) {
    const cells = cfg.levels.map(l => {
      const b = x.byLevel[l];
      if (!b || x.points == null || unit === 0) return '—';
      return String(Math.round((b.dO + calib.w * b.dD) / unit));
    });
    L.push(`| ${x.label} | ${cells.join(' | ')} |`);
  }
  L.push('');
  return L.join('\n');
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */
function main() {
  const cfg = parseArgs(process.argv);
  let list = CANDIDATES;
  if (cfg.only) {
    /* the two anchors must always run — they define the scale */
    list = CANDIDATES.filter(c => cfg.only.has(c.key) || c.key === 'atk' || c.key === 'ac');
  }

  const t0 = Date.now();
  const results = [];
  for (const cand of list) {
    if (!cfg.quiet) process.stdout.write(`\r  measuring ${cand.key}…`.padEnd(40));
    results.push(measure(cand, cfg));
  }
  if (!cfg.quiet) process.stdout.write('\r'.padEnd(40) + '\r');

  const calib = priceAll(results);
  const md = renderMarkdown(results, calib, cfg);

  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const mdPath = path.join(dir, 'value_latest.md');
  const jsonPath = path.join(dir, 'value_latest.json');
  fs.writeFileSync(mdPath, md, 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify({
    config: cfg.only ? { ...cfg, only: [...cfg.only] } : cfg,
    weight: calib.w,
    anchors: { atk: ANCHOR_ATK, ac: ANCHOR_AC },
    results,
  }, null, 2), 'utf8');

  if (!cfg.quiet) console.log('\n' + md);
  console.log(`\n✔ Valued ${results.length} candidates in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  console.log(`  Report: ${path.relative(process.cwd(), mdPath)}`);
  console.log(`  JSON:   ${path.relative(process.cwd(), jsonPath)}`);
}

main();
