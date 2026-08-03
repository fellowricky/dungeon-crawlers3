/* Harder doorway test: a single agent must turn a CORNER through a 1-wide door
   (L-shaped route), and approaches the door off-axis so the straight step clips
   the jamb — the case the axis-slide fallback is meant to thread. */
import { pathfindingMethods, buildChokepoints, buildWallAdj } from '../src/game/pathfinding.js';
import { FLOOR, WALL } from '../src/game/constants.js';

const W = 11, H = 11;
const grid = new Uint8Array(W * H).fill(WALL);
const set = (x, z) => { grid[z * W + x] = FLOOR; };
// Left room (x1..3, z1..3)
for (let z = 1; z <= 3; z++) for (let x = 1; x <= 3; x++) set(x, z);
// horizontal 1-wide corridor at z=2, x=4..6  -> door at x=6,z=2
for (let x = 4; x <= 6; x++) set(x, 2);
// vertical 1-wide corridor at x=6, z=3..6 (turn downward through door x6,z2->z3)
for (let z = 3; z <= 6; z++) set(6, z);
// bottom-right room x5..7, z7..9
for (let z = 7; z <= 9; z++) for (let x = 5; x <= 7; x++) set(x, z);

const chokepoint = buildChokepoints(grid, W, H);
const wallAdj = buildWallAdj(grid, W, H);

const game = {
  D: { W, H, grid, chokepoint, wallAdj }, state: 'crawl',
  heroes: [], monsters: [], activeAoEZones: [],
  wx: (i) => i + 0.5, wz: (i) => i + 0.5,
  cellOf(x, z){ const cx=Math.floor(x),cz=Math.floor(z); if(cx<0||cz<0||cx>=W||cz>=H) return -1; return cz*W+cx; },
};
Object.assign(game, pathfindingMethods);

const e = { x: 1.5, z: 1.5, data:{hp:10,maxHp:10,speedMult:1,name:'E'}, ent:{grp:{rotation:{y:0}}}, path:null, pathI:0 };
game.heroes = [e];
const goal = 8 * W + 6;   // bottom-right room
const dt = 1/60, SPEED = 3.2;
const done = () => Math.floor(e.z) >= 7 && Math.floor(e.x) >= 5;

let frame=0, maxStall=0, still=0, lastX=e.x, lastZ=e.z;
for (; frame<1200; frame++) {
  if (!e.path || e.pathI>=e.path.length) { e.path = game.findPath(game.cellOf(e.x,e.z), goal); e.pathI=0; }
  const moved = game.stepAlong(e, SPEED, dt);
  const d = Math.hypot(e.x-lastX, e.z-lastZ);
  if (d>0.01) still=0; else { still+=dt; maxStall=Math.max(maxStall,still); }
  lastX=e.x; lastZ=e.z;
  if (done()) break;
}
console.log(`corner-door: frames=${frame} (${(frame*dt).toFixed(1)}s) reached=${done()} pos=(${e.x.toFixed(2)},${e.z.toFixed(2)}) maxStall=${maxStall.toFixed(2)}s pathLen=${e.path?e.path.length:0}`);
