/**
 * XP floor census — builds real floors with the game's own generator and
 * counts what the party would be paid for clearing them, so the XP balancer
 * works from measured numbers instead of a hand-written model.
 *
 *   node sim/xp_floor_census.mjs [--seeds N] [--out sim/reports/xp_census.json]
 *
 * Rerun it after changing room counts or spawn budgets; xp_balancer.html reads
 * the output.
 *
 * Per quest level 1..20 it records, for dungeon floor depth 1..10 and for an
 * overland (travel) floor:
 *   normal  – spawns outside elite rooms (each pays 1 x level per hero)
 *   elite   – spawns in elite rooms        (each pays 3 x level per hero)
 * Bosses (10 x level) and quest / side-objective rewards are added by the
 * balancer from the formulas, since they are not spawn points.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { installSeededRandom } from './rng.mjs';
import { generateDungeon, THEME_KEYS, THEMES } from '../src/dungeon/dungeon_generator.js';
import { overlandSpawnLevel } from '../src/game/overland_prologue.js';

const cfg = { seeds: 10, out: 'sim/reports/xp_census.json' };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--seeds') cfg.seeds = +process.argv[++i];
  else if (a === '--out') cfg.out = process.argv[++i];
}

console.warn = () => {};
const realLog = console.log;
console.log = () => {};
installSeededRandom(4242);

/* Same gradient as Game._loadFloor. */
function roomCountFor(level, depth) {
  const MIN_ROOMS = 12, MAX_ROOMS = 70;
  const lvlT = Math.min(1, Math.max(0, (level - 1) / 19));
  const floorT = Math.min(1, Math.max(0, (depth - 1) / 9));
  return Math.min(MAX_ROOMS, Math.round(MIN_ROOMS + (MAX_ROOMS - MIN_ROOMS) * (0.70 * lvlT + 0.30 * floorT)));
}

function tally(d) {
  const rooms = d.rooms || [];
  let normal = 0, elite = 0, bossRoom = 0;
  for (const sp of d.spawns || []) {
    const r = rooms[sp.roomId] || rooms.find(x => x.id === sp.roomId);
    if (r && (r.type === 'rival' || r.rival)) continue;
    if (sp.roomId === d.boss) bossRoom++;
    if (r && r.type === 'elite') elite++; else normal++;
  }
  return { normal, elite, bossRoom };
}

const dungeonThemes = THEME_KEYS.filter(k => !THEMES[k]?.overland);
const overlandThemes = Object.keys(THEMES).filter(k => THEMES[k]?.overland);
const avg = (xs, k) => +(xs.reduce((s, x) => s + x[k], 0) / Math.max(1, xs.length)).toFixed(2);

const out = { generated: new Date().toISOString(), seeds: cfg.seeds, levels: {} };
for (let L = 1; L <= 20; L++) {
  const depths = [];
  for (let depth = 1; depth <= 10; depth++) {
    const rows = [];
    for (let s = 0; s < cfg.seeds; s++) {
      const seed = 7000 + L * 131 + depth * 17 + s * 7919;
      const themeKey = dungeonThemes[s % dungeonThemes.length];
      try {
        const d = generateDungeon(seed, { seed, roomCount: roomCountFor(L, depth), themeKey, level: L, threatMult: 1 });
        rows.push(tally(d));
      } catch (e) { /* a theme that needs the browser; skip */ }
    }
    depths.push({ depth, normal: avg(rows, 'normal'), elite: avg(rows, 'elite'), bossRoom: avg(rows, 'bossRoom'), n: rows.length });
  }
  const orows = [];
  const spawnLevel = overlandSpawnLevel(L);
  for (let s = 0; s < cfg.seeds; s++) {
    const seed = 9100 + L * 53 + s * 104729;
    const themeKey = overlandThemes[s % overlandThemes.length];
    try {
      const d = generateDungeon(seed, { seed, themeKey, level: spawnLevel, threatMult: 1 });
      orows.push(tally(d));
    } catch (e) { /* skip */ }
  }
  out.levels[L] = {
    dungeon: depths,
    overland: { normal: avg(orows, 'normal'), elite: avg(orows, 'elite'), n: orows.length, spawnLevel }
  };
  realLog(`L${String(L).padStart(2)}  depth1 ${depths[0].normal}+${depths[0].elite}e  depth10 ${depths[9].normal}+${depths[9].elite}e  overland ${out.levels[L].overland.normal}+${out.levels[L].overland.elite}e (n=${orows.length})`);
}
mkdirSync(dirname(cfg.out), { recursive: true });
writeFileSync(cfg.out, JSON.stringify(out, null, 1));
realLog(`wrote ${cfg.out}`);
