/**
 * Dungeon probe — the same AI-quality metrics as run_headless.mjs, but fought
 * on GENERATED dungeon floors (corridors, doors, odd room shapes) instead of
 * the open arena. Movement bugs like "walks out, Dashes, walks back" only show
 * up where the geometry gets in the way.
 *
 *   node sim/dungeon_probe.mjs [--floors N] [--level N] [--seed N] [--noPlanner] [--samples]
 *
 * --samples prints a few walk-out-and-back turns with the decisions behind them.
 */
import { installSeededRandom, mulberry32, withStream } from './rng.mjs';
import { makeParty, levelPartyTo } from './herogen.mjs';
import { spawnMonster, crForDungeonLevel } from '../src/game/srd.js';
import { generateDungeon, THEME_KEYS } from '../src/dungeon/dungeon_generator.js';
import { HeadlessGame } from './headless_game.mjs';
import { attachAiMetrics, makeAiStats, mergeAiStats, formatAiMetrics } from './ai_metrics.mjs';
import { PLANNER } from '../src/game/turn_planner.js';

const cfg = { floors: 24, level: 6, seed: 7, samples: false };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--floors') cfg.floors = +process.argv[++i];
  else if (a === '--level') cfg.level = +process.argv[++i];
  else if (a === '--seed') cfg.seed = +process.argv[++i];
  else if (a === '--noPlanner') PLANNER.on = false;
  else if (a === '--noPhase2') PLANNER.phase2 = false;
  else if (a === '--noMonsterMoves') PLANNER.monsterMoves = false;
  else if (a === '--noThrift') PLANNER.thrift = false;
  else if (a === '--off') for (const k of process.argv[++i].split(',')) PLANNER[k] = false;   // e.g. --off triage,formation
  else if (a === '--samples') cfg.samples = true;
}

const quiet = console.log; const warn = console.warn;
console.warn = () => {};
const realLog = console.log;
console.log = (...a) => { if (typeof a[0] === 'string' && /^\[(motion|reservation)\]/.test(a[0])) return; realLog(...a); };

installSeededRandom(cfg.seed);
const content = mulberry32(cfg.seed * 7919 + 1);
const gen = (fn) => withStream(content, fn);
const totals = makeAiStats();
const samples = [];

for (let f = 0; f < cfg.floors; f++) {
  const themeKey = THEME_KEYS[f % THEME_KEYS.length];
  const seed = 1000 + f * 37 + cfg.seed;
  const d = gen(() => generateDungeon(seed, { seed, roomCount: 18, themeKey }));
  const ent = d.rooms[d.entrance];
  if (!ent) continue;
  /* nearest few rooms that have spawns, by BFS depth from the entrance */
  const byRoom = new Map();
  for (const sp of d.spawns) { if (!byRoom.has(sp.roomId)) byRoom.set(sp.roomId, []); byRoom.get(sp.roomId).push(sp); }
  const rooms = [...byRoom.keys()].filter(r => r !== d.entrance)
    .sort((a, b) => Math.hypot(d.rooms[a].cx - ent.cx, d.rooms[a].cy - ent.cy) - Math.hypot(d.rooms[b].cx - ent.cx, d.rooms[b].cy - ent.cy))
    .slice(0, 3);
  const party = gen(() => makeParty(content, 4));
  gen(() => levelPartyTo(party, cfg.level, content));
  for (const r of rooms) {
    const dd = { ...d, entrance: { x: ent.cx, y: ent.cy } };
    const game = new HeadlessGame(dd, party, { dungeonLevel: cfg.level });
    attachAiMetrics(game);
    if (cfg.samples) { game.__traceTurns(); game.__backtrackSamples = samples; game.__sampleAllReversals = true; }
    for (const h of game.heroes) { h.data.hp = h.data.maxHp; if (h.data.slotsMax) h.data.slots = { ...h.data.slotsMax }; }
    /* place the party in the entrance room on real floor */
    game.heroes.forEach((h, i) => {
      const c = game.getUnoccupiedCellNear ? game.getUnoccupiedCellNear(ent.cy * d.W + ent.cx, h, 3) : ent.cy * d.W + ent.cx;
      h.x = game.wx(c % d.W) + 0; h.z = game.wz(Math.floor(c / d.W));
    });
    const sps = byRoom.get(r).slice(0, 4);
    const mons = gen(() => sps.map(() => spawnMonster(crForDungeonLevel(cfg.level, content), cfg.level, content, null, null)));
    sps.forEach((sp, i) => game.addMonster(mons[i], game.wx(sp.x), game.wz(sp.y)));
    const out = game.runUntilResolved(20000);
    game._flushAiTurn();
    game.aiStats.encounters++;
    if (out === 'victory') game.aiStats.victories++; else if (out === 'wipe') game.aiStats.wipes++; else game.aiStats.timeouts++;
    mergeAiStats(totals, game.aiStats);
  }
}
realLog(`Dungeon probe: ${cfg.floors} floors, level ${cfg.level}, planner ${PLANNER.on ? 'ON' : 'OFF'}, phase 2 ${PLANNER.phase2 ? 'ON' : 'OFF'}`);
realLog(formatAiMetrics(totals).join('\n'));
if (cfg.samples) {
  for (const s of samples) {
    realLog(`\n--- ${s.side} ${s.name}: out ${s.maxD} tiles, ended ${s.net} from start${s.dashed ? ' (DASHED)' : ''}`);
    for (const t of s.trace) realLog('   ' + t);
  }
}
