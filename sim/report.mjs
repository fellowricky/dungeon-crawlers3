/**
 * Aggregation + report rendering for the balance simulator.
 *
 * Takes the flat list of every simulated hero (each carrying an `_sim` record)
 * and rolls it up per class, computes cross-class z-scores to flag outliers
 * ("which class runs away from the pack"), builds a per-level power curve, and
 * renders a readable Markdown report plus a machine-readable JSON dump.
 */
import { CLASSES } from '../src/game/srd.js';
import fs from 'node:fs';
import path from 'node:path';

const CLASS_ORDER = Object.keys(CLASSES);

/* ------------------------------------------------------------------ */
/* small stats helpers                                                 */
/* ------------------------------------------------------------------ */
const sum = a => a.reduce((s, x) => s + x, 0);
const mean = a => (a.length ? sum(a) / a.length : 0);
function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map(x => (x - m) ** 2)));
}
const safe = (n, d) => (d ? n / d : 0);
const r1 = n => Math.round(n * 10) / 10;
const r2 = n => Math.round(n * 100) / 100;
const pct = n => (n * 100).toFixed(1) + '%';

/* ------------------------------------------------------------------ */
/* aggregation                                                         */
/* ------------------------------------------------------------------ */

/** Roll up per-class metrics from the flat hero list. */
export function aggregate(heroes) {
  const byClass = {};
  for (const key of CLASS_ORDER) byClass[key] = [];
  for (const h of heroes) (byClass[h.classKey] ||= []).push(h._sim);

  const rows = [];
  for (const key of CLASS_ORDER) {
    const list = byClass[key];
    if (!list.length) continue;
    const A = {
      class: key, label: CLASSES[key].label, n: list.length,
      encounters: sum(list.map(s => s.encounters)),
      rounds: sum(list.map(s => s.rounds)),
      dmgDealt: sum(list.map(s => s.dmgDealt)),
      dmgTaken: sum(list.map(s => s.dmgTaken)),
      mitigated: sum(list.map(s => s.mitigated)),
      healingDone: sum(list.map(s => s.healingDone)),
      attacks: sum(list.map(s => s.attacks)),
      hits: sum(list.map(s => s.hits)),
      crits: sum(list.map(s => s.crits)),
      kills: sum(list.map(s => s.kills)),
      downs: sum(list.map(s => s.downs)),
      deaths: sum(list.map(s => s.deaths)),
    };
    A.dpr = safe(A.dmgDealt, A.rounds);
    A.dmgPerEnc = safe(A.dmgDealt, A.encounters);
    A.takenPerEnc = safe(A.dmgTaken, A.encounters);
    A.healPerEnc = safe(A.healingDone, A.encounters);
    A.killsPerEnc = safe(A.kills, A.encounters);
    A.hitRate = safe(A.hits, A.attacks);
    A.critRate = safe(A.crits, A.attacks);
    A.downRate = safe(A.downs, A.encounters);
    A.deathRate = safe(A.deaths, A.encounters);
    rows.push(A);
  }

  /* cross-class z-scores on the two axes we care about for balance */
  const dprs = rows.map(r => r.dpr);
  const takens = rows.map(r => r.takenPerEnc);
  const mDpr = mean(dprs), sDpr = stdev(dprs) || 1;
  const mTaken = mean(takens), sTaken = stdev(takens) || 1;
  for (const r of rows) {
    r.zOffense = (r.dpr - mDpr) / sDpr;
    r.zDefense = (mTaken - r.takenPerEnc) / sTaken;   // higher = takes LESS = tankier
  }

  /* per-level DPR curve: level -> class -> dpr */
  const curve = {};
  for (const h of heroes) {
    for (const lvl of Object.keys(h._sim.byLevel)) {
      const b = h._sim.byLevel[lvl];
      const L = (curve[lvl] ||= {});
      const C = (L[h.classKey] ||= { dmgDealt: 0, rounds: 0, taken: 0, encounters: 0 });
      C.dmgDealt += b.dmgDealt; C.rounds += b.rounds;
      C.taken += b.dmgTaken; C.encounters += b.encounters;
    }
  }

  rows.sort((a, b) => b.dpr - a.dpr);
  return { rows, curve, baseline: { mDpr, sDpr, mTaken, sTaken } };
}

/* ------------------------------------------------------------------ */
/* markdown rendering                                                  */
/* ------------------------------------------------------------------ */

function table(headers, aligns, rowsOfCells) {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${aligns.map(a => (a === 'r' ? '---:' : a === 'c' ? ':---:' : ':---')).join(' | ')} |`;
  const body = rowsOfCells.map(c => `| ${c.join(' | ')} |`).join('\n');
  return [head, sep, body].join('\n');
}

export function renderMarkdown(agg, config) {
  const { rows, curve } = agg;
  const out = [];
  out.push(`# Dungeon Crawlers — Class Balance Report`);
  out.push('');
  out.push(`Generated: ${new Date().toISOString()}`);
  out.push('');
  out.push(`**Config:** seed \`${config.seed}\` · ${config.parties} parties × ${config.partySize} heroes `
    + `· levels 1–${config.maxLevel} · ${config.encountersPerLevel} encounters/level `
    + `· ${rows.reduce((n, r) => n + r.n, 0)} hero-runs sampled`);
  out.push('');

  /* ---- headline balance table ---- */
  out.push(`## Class Summary (sorted by damage-per-round)`);
  out.push('');
  out.push(table(
    ['Class', 'N', 'DPR', 'z⚔', 'Dmg/Enc', 'Taken/Enc', 'z🛡', 'Heal/Enc', 'Kills/Enc', 'Hit%', 'Crit%', 'Down/Enc', 'KOs'],
    ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
    rows.map(r => [
      r.label, r.n, r1(r.dpr), fmtZ(r.zOffense), r1(r.dmgPerEnc), r1(r.takenPerEnc),
      fmtZ(r.zDefense), r1(r.healPerEnc), r2(r.killsPerEnc), pct(r.hitRate), pct(r.critRate),
      r2(r.downRate), r.deaths,
    ])
  ));
  out.push('');
  out.push('> `z⚔` = offense (DPR) standard-deviations from the cross-class mean; '
    + '`z🛡` = defense (higher means takes *less* damage than average). '
    + '`|z| ≥ 1.5` is flagged below.');
  out.push('');

  /* ---- outliers ---- */
  out.push(`## Outliers — who runs away from the pack?`);
  out.push('');
  const hotOff = rows.filter(r => r.zOffense >= 1.5);
  const coldOff = rows.filter(r => r.zOffense <= -1.5);
  const tanky = rows.filter(r => r.zDefense >= 1.5);
  const fragile = rows.filter(r => r.zDefense <= -1.5);
  const line = (label, list, metric) => list.length
    ? `- **${label}:** ${list.map(r => `${r.label} (${metric(r)})`).join(', ')}`
    : `- **${label}:** none`;
  out.push(line('🔥 Over-performing damage (z⚔ ≥ 1.5)', hotOff, r => `DPR ${r1(r.dpr)}, z ${fmtZ(r.zOffense)}`));
  out.push(line('🥶 Under-performing damage (z⚔ ≤ -1.5)', coldOff, r => `DPR ${r1(r.dpr)}, z ${fmtZ(r.zOffense)}`));
  out.push(line('🛡 Unusually durable (z🛡 ≥ 1.5)', tanky, r => `${r1(r.takenPerEnc)} taken/enc`));
  out.push(line('💀 Unusually fragile (z🛡 ≤ -1.5)', fragile, r => `${r1(r.takenPerEnc)} taken/enc, ${r.deaths} floor-KOs`));
  out.push('');
  const spread = rows.length
    ? `${r1(rows[0].dpr)} (${rows[0].label}) → ${r1(rows[rows.length - 1].dpr)} (${rows[rows.length - 1].label})`
    : 'n/a';
  const ratio = rows.length ? r2(safe(rows[0].dpr, rows[rows.length - 1].dpr)) : 0;
  out.push(`**DPR spread:** ${spread} — top class does **${ratio}×** the bottom class's damage-per-round.`);
  out.push('');

  /* ---- per-level DPR curve ---- */
  out.push(`## Damage-per-round by level`);
  out.push('');
  const levels = Object.keys(curve).map(Number).sort((a, b) => a - b);
  const classCols = rows.map(r => r.class);
  out.push(table(
    ['Lvl', ...rows.map(r => r.label.slice(0, 6))],
    ['r', ...classCols.map(() => 'r')],
    levels.map(L => {
      const cell = curve[L] || {};
      return [L, ...classCols.map(c => {
        const d = cell[c];
        return d && d.rounds ? r1(safe(d.dmgDealt, d.rounds)) : '·';
      })];
    })
  ));
  out.push('');

  /* ---- methodology ---- */
  out.push(`## Methodology & fidelity`);
  out.push('');
  out.push([
    '- **Character math is the real game\'s.** Heroes are built with `makeHero`, leveled through the real `grantXp`/`applyLevelGrants` ladder (features, Extra Attack, subclass milestones, spell slots), and re-geared from real `rollItem` loot they can actually equip (`canEquip`). Damage uses `heroDamage` + `featBonusDamage`; monster offense mirrors `monster_ai.js`.',
    '- **Combat is abstracted, not spatial.** The real combat loop is real-time and THREE.js-coupled, so this harness models it as clean rounds (one action each per round, shared cadence). Positioning, pathfinding, and cooldown clocks are removed.',
    '- **Modeled feature layer:** Extra Attack, off-hand, Action Surge, Flurry, sneak attack, rage, divine smite, favored enemy, Second Wind, healer casting, and a few conditional subclass procs. Flat subclass/skill/gear bonuses flow automatically through `recalc`. Extend `FEATURE_LAYER` blocks in `combat_sim.mjs` as the game grows.',
    '- **Controls:** monsters pick targets uniformly at random (no positional aggro) so survivability differences trace to AC/HP/mitigation; every class is built with the same "recommended" policy (standard array by stat priority, ASIs over feats) so the comparison is chassis-vs-chassis.',
    '- **Sneak attack** assumes a flanking ally whenever the party has another living member.',
    '- **Metrics:** `DPR` = damage per round while engaged (the cleanest speed-of-kill measure). `Down/Enc` = times knocked to 0 HP per encounter. `KOs` = distinct floors where the hero was knocked out (revived on the long rest between floors — the sim has no permadeath).',
  ].join('\n'));
  out.push('');
  return out.join('\n');
}

function fmtZ(z) {
  const s = (z >= 0 ? '+' : '') + z.toFixed(2);
  return z >= 1.5 || z <= -1.5 ? `**${s}**` : s;
}

/* ------------------------------------------------------------------ */
/* file output                                                         */
/* ------------------------------------------------------------------ */

export function writeReports(agg, config, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const md = renderMarkdown(agg, config);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const mdPath = path.join(dir, `balance_${stamp}.md`);
  const jsonPath = path.join(dir, `balance_${stamp}.json`);
  const latestMd = path.join(dir, `balance_latest.md`);
  const latestJson = path.join(dir, `balance_latest.json`);
  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(latestMd, md);
  const jsonPayload = JSON.stringify({ config, ...agg }, null, 2);
  fs.writeFileSync(jsonPath, jsonPayload);
  fs.writeFileSync(latestJson, jsonPayload);
  return { mdPath, jsonPath, latestMd, latestJson };
}
