/* Deterministic doorway-threading test.
   Imports the REAL pathfinding methods and drives 4 agents from a bottom room,
   through a single 1-wide doorway, into a top room — with separation active —
   to see whether they thread single-file or wedge. */
import { pathfindingMethods, buildChokepoints, buildWallAdj } from '../src/game/pathfinding.js';
import { FLOOR, WALL } from '../src/game/constants.js';

const W = 7, H = 11;
const grid = new Uint8Array(W * H).fill(WALL);
const set = (x, z) => { grid[z * W + x] = FLOOR; };
// top room  z 1..3, x 1..5
for (let z = 1; z <= 3; z++) for (let x = 1; x <= 5; x++) set(x, z);
// SINGLE-tile doorway in the dividing wall at x=3, z=4
set(3, 4);
// bottom room z 5..9, x 1..5  (agents start here and funnel up through the 1 door)
for (let z = 5; z <= 9; z++) for (let x = 1; x <= 5; x++) set(x, z);

const chokepoint = buildChokepoints(grid, W, H);
const wallAdj = buildWallAdj(grid, W, H);

function mkEnt(x, z, name) {
  return { x, z, data: { hp: 10, maxHp: 10, speedMult: 1, name, scale: 1 },
    ent: { grp: { rotation: { y: 0 } } }, path: null, pathI: 0, active: true,
    moving: false, stuckT: 0, stuckStage: 0 };
}

const heroes = [ mkEnt(2.5, 6.5, 'A'), mkEnt(3.5, 6.5, 'B'),
                 mkEnt(2.5, 5.5, 'C'), mkEnt(3.5, 5.5, 'D') ];

const game = {
  D: { W, H, grid, chokepoint, wallAdj },
  state: 'crawl',
  heroes, monsters: [],
  wx: (i) => i + 0.5, wz: (i) => i + 0.5,
  cellOf(x, z) { const cx = Math.floor(x), cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= W || cz >= H) return -1; return cz * W + cx; },
  activeAoEZones: [],
};
Object.assign(game, pathfindingMethods);

const goalCell = 2 * W + 3;               // top room centre
const HERO_SPEED = 3.2, dt = 1 / 60;
const done = (h) => Math.floor(h.z) <= 3;  // reached top room

for (const h of heroes) { h._lastZ = h.z; h._noProg = 0; h._maxNoProg = 0; }
let frame = 0, allDone = false, firstDone = null;
for (; frame < 1800; frame++) {
  for (const h of heroes) {
    if (done(h)) { h.moving = false; continue; }
    if (!h.path || h.pathI >= h.path.length) {
      h.path = game.findPath(game.cellOf(h.x, h.z), goalCell);
      h.pathI = 0;
    }
    h.moving = game.stepAlong(h, HERO_SPEED, dt);
  }
  game.applySeparation(heroes, dt);
  for (const h of heroes) {
    if (done(h)) continue;
    if (Math.abs(h.z - h._lastZ) > 0.01) { h._noProg = 0; } else { h._noProg += dt; h._maxNoProg = Math.max(h._maxNoProg, h._noProg); }
    h._lastZ = h.z;
  }
  if (heroes.every(done)) { allDone = true; break; }
  if (firstDone === null && heroes.some(done)) firstDone = frame;
}

const report = heroes.map(h => `${h.data.name}: (${h.x.toFixed(2)},${h.z.toFixed(2)}) ${done(h)?"THROUGH":"STUCK"} maxNoProgress=${h._maxNoProg.toFixed(1)}s`);
console.log(`frames=${frame} (${(frame*dt).toFixed(1)}s) allThrough=${allDone} firstThrough@${firstDone}`);
console.log(report.join('\n'));
