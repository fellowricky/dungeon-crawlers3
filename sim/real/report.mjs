/**
 * Turn real-game run records into a readable summary.
 *
 *   node sim/real/report.mjs sim/reports/real_L5_dungeon_....jsonl [more.jsonl ...]
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const pct = (n, d) => d ? (100 * n / d).toFixed(0) + '%' : '–';
const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const f1 = x => (Math.round(x * 10) / 10).toFixed(1);
const f2 = x => (Math.round(x * 100) / 100).toFixed(2);

function table(head, rows) {
  return ['| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|', ...rows.map(r => '| ' + r.join(' | ') + ' |')].join('\n');
}

/** Group runs by something each run has several of (classes, picks, …). */
function byKey(runs, keysOf, minRuns = 1) {
  const m = new Map();
  for (const r of runs) {
    for (const k of new Set(keysOf(r))) {
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
  }
  return [...m.entries()].filter(([, v]) => v.length >= minRuns).sort((a, b) => b[1].length - a[1].length);
}
const line = (k, rs) => [k, rs.length, pct(rs.filter(r => r.outcome === 'wipe').length, rs.length), f2(avg(rs.map(r => r.downs || 0))), pct(avg(rs.map(r => r.endHp || 0)) * 100, 100)];

export function summarize(all, cfg = {}) {
  const runs = all.filter(r => r && (r.outcome === 'cleared' || r.outcome === 'wipe' || r.outcome === 'timeout'));
  const bad = all.filter(r => !runs.includes(r));
  const fights = runs.flatMap(r => r.fights || []);
  const out = [];
  out.push(`# Real-game balance run — level ${cfg.level ?? '?'}, floor "${cfg.floor ?? '?'}"`);
  out.push('');
  out.push(`${all.length} runs` + (cfg.wallMin ? ` in ${f1(cfg.wallMin)} real minutes on ${cfg.workers} browsers` : '') + `. ` +
    `${runs.length} usable, ${bad.length} failed (${bad.map(r => r.outcome).join(', ') || 'none'}).`);
  if (!runs.length) return out.join('\n');
  const gameMin = runs.reduce((a, r) => a + (r.gameMin || 0), 0);
  out.push(`${f1(gameMin)} minutes of game time` + (cfg.wallMin ? ` (${f1(gameMin / cfg.wallMin)}× real time overall, ${f1(avg(runs.map(r => r.speed || 0)))}× per browser while stepping)` : '') + '.');
  out.push('');
  out.push('## Floors');
  out.push(table(['Outcome', 'Runs', 'Share'], ['cleared', 'wipe', 'timeout'].map(o => [o, runs.filter(r => r.outcome === o).length, pct(runs.filter(r => r.outcome === o).length, runs.length)])));
  out.push('');
  out.push(table(['Per floor', 'Average'], [
    ['Fights', f1(avg(runs.map(r => (r.fights || []).length)))],
    ['Knockdowns', f2(avg(runs.map(r => r.downs || 0)))],
    ['Potions used', f2(avg(runs.map(r => r.potsUsed || 0)))],
    ['Party HP at the end', pct(avg(runs.map(r => r.endHp || 0)) * 100, 100)],
    ['Game minutes', f1(avg(runs.map(r => r.gameMin || 0)))],
    ['Monsters on the floor', f1(avg(runs.map(r => r.monstersTotal || 0)))],
  ]));
  out.push('');
  out.push('## Fights');
  out.push(table(['Per fight', 'Value'], [
    ['Fights recorded', fights.length],
    ['Ended in a wipe', pct(fights.filter(f => f.wipe).length, fights.length)],
    ['With at least one knockdown', pct(fights.filter(f => f.downs > 0).length, fights.length)],
    ['Rounds', f1(avg(fights.map(f => f.rounds || 0)))],
    ['Monsters', f1(avg(fights.map(f => (f.foes || []).length)))],
    ['Total monster CR', f1(avg(fights.map(f => f.crSum || 0)))],
    ['Party HP lost', pct(avg(fights.map(f => Math.max(0, (f.hp0 || 0) - (f.hp1 || 0)))) * 100, 100)],
    ['Spell slots spent', f2(avg(fights.map(f => f.slotsSpent || 0)))],
  ]));
  const head = ['', 'Runs', 'Wipes', 'Knockdowns / floor', 'End HP'];
  out.push('');
  out.push('## By class in the party');
  out.push(table(['Class', ...head.slice(1)], byKey(runs, r => (r.party || []).map(h => h.cls)).map(([k, rs]) => line(k, rs))));
  const picks = r => Object.values(r.picks || {}).flat().filter(p => ['subclass', 'feat', 'fightingStyle'].includes(p.kind)).map(p => `${p.kind}: ${p.key}`);
  const pk = byKey(runs, picks, 3);
  if (pk.length) {
    out.push('');
    out.push('## By build pick (3 or more runs)');
    out.push(table(['Pick', ...head.slice(1)], pk.map(([k, rs]) => line(k, rs))));
  }
  const biome = byKey(runs, r => [(r.quest && (r.quest.biome || r.quest.theme)) || '?']);
  out.push('');
  out.push('## By biome');
  out.push(table(['Biome', ...head.slice(1)], biome.map(([k, rs]) => line(k, rs))));
  if (bad.length) {
    out.push('');
    out.push('## Failed runs');
    for (const r of bad) out.push(`- job ${r.id}: ${r.outcome} — ${((r.errors || [])[0] || '').slice(0, 200)}`);
  }
  const errs = runs.filter(r => (r.errors || []).length);
  if (errs.length) {
    out.push('');
    out.push(`## Script errors during usable runs (${errs.length})`);
    for (const r of errs.slice(0, 8)) out.push(`- job ${r.id}: ${r.errors[0].slice(0, 200)}`);
  }
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: node sim/real/report.mjs <records.jsonl> [...]'); process.exit(1); }
  const all = files.flatMap(f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
  console.log(summarize(all, { level: all[0] && all[0].job && all[0].job.level, floor: all[0] && all[0].job && all[0].job.floor }));
}
