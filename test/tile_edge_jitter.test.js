import { describe, it, expect } from 'vitest';
import { pathfindingMethods } from '../src/game/pathfinding.js';
import { turnEngineMethods } from '../src/game/turn_engine.js';
import { reservationMethods } from '../src/game/reservation.js';
import { exploreMethods } from '../src/game/explore.js';
import { FLOOR, WALL } from '../src/game/constants.js';

/* Combat is a grid: a body that has finished moving belongs on a tile centre.
   The walk itself is a float interpolation between those centres. The jitter
   bug was those two layers fighting: a blocked step sits on the Voronoi edge
   between two tiles, snapToTileCenter pulls back toward the current centre,
   and the live path walks forward again next frame. */

function mkGrid(W, H) {
  const grid = new Int32Array(W * H).fill(FLOOR);
  for (let x = 0; x < W; x++) { grid[x] = WALL; grid[(H - 1) * W + x] = WALL; }
  for (let y = 0; y < H; y++) { grid[y * W] = WALL; grid[y * W + W - 1] = WALL; }
  return grid;
}

function mkGame(W = 12, H = 12) {
  const g = {
    D: { W, H, grid: mkGrid(W, H), rooms: [], roomId: new Int32Array(W * H).fill(0) },
    heroes: [], monsters: [],
    initiative: { active: true },
    controlMode: 'auto',
    isCurrentActor: () => true,
    cellOf(x, z) {
      const cx = Math.floor(x), cy = Math.floor(z);
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return -1;
      return cy * W + cx;
    },
    wx: (cx) => cx + 0.5,
    wz: (cy) => cy + 0.5,
    isCombatActive: () => true,
  };
  Object.assign(g, pathfindingMethods, reservationMethods, turnEngineMethods, exploreMethods);
  return g;
}

const body = (x, z, extra = {}) => ({
  x, z, data: { hp: 10, maxHp: 10, speedMult: 1 }, active: true,
  path: null, pathI: 0, moving: false, moveLeft: 6, diagCount: 0,
  _side: 'hero', ent: { grp: { rotation: { y: 0 } } },
  ...extra,
});

describe('tile-edge jitter after a blocked step', () => {
  it('does not pull a live path back toward the current centre when the next cell is occupied', () => {
    const g = mkGame();
    const mover = body(3.5, 5.5);
    const squatter = body(4.5, 5.5);
    g.heroes = [mover];
    g.monsters = [squatter];

    const from = g.cellOf(3.5, 5.5);
    const to = g.cellOf(4.5, 5.5);
    g.setEntityPath(mover, [from, to]);

    const xs = [];
    for (let i = 0; i < 45; i++) {
      g.moveStep(mover, 2.0, 0.016);
      g.snapStationaryToTiles(g.heroes, 0.016);
      xs.push(mover.x);
    }

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    /* Oscillation across the 4.0 tile edge is the bug: walk forward, snap back. */
    expect(maxX - minX).toBeLessThan(0.2);
    expect(g.cellOf(mover.x, mover.z)).toBe(from);
  });

  it('snapStationaryToTiles leaves an in-transit body alone', () => {
    const g = mkGame();
    const mover = body(3.8, 5.5, { moving: false });
    g.heroes = [mover];
    g.setEntityPath(mover, [g.cellOf(3.5, 5.5), g.cellOf(5.5, 5.5)]);
    mover.pathI = 1;

    const before = mover.x;
    g.snapStationaryToTiles(g.heroes, 0.016);
    expect(mover.x).toBe(before);
  });

  it('still settles onto the tile centre once the path is finished', () => {
    const g = mkGame();
    const mover = body(3.2, 5.5, { moveLeft: 0 });
    g.heroes = [mover];
    mover.path = null;
    mover.moving = false;

    for (let i = 0; i < 40; i++) g.snapStationaryToTiles(g.heroes, 0.016);
    expect(mover.x).toBeCloseTo(3.5, 2);
    expect(mover.z).toBeCloseTo(5.5, 2);
  });

  it('does not snap a current actor who still has movement after the path is cleared', () => {
    /* Kobold Shaman log: pathLeft 0 then 10, snapToTileCenter vs stepAlong
       on the tile edge (dCenter ≈ 0.5). The actor still had moveLeft and
       was about to pick a new square — snapping in that hole is the jitter. */
    const g = mkGame();
    const e = body(3.99, 5.5, { moveLeft: 3, moving: false });
    g.heroes = [e];
    const x0 = e.x;
    g.snapStationaryToTiles(g.heroes, 0.016);
    expect(e.x).toBe(x0);
    g.moveStep(e, 2.0, 0.016);
    expect(e.x).toBe(x0);
  });

  it('setEntityPath starts on the next cell, not the one the body is already on', () => {
    const g = mkGame();
    const e = body(3.5, 5.5);
    g.heroes = [e];
    g.setEntityPath(e, [g.cellOf(3.5, 5.5), g.cellOf(4.5, 5.5)]);
    expect(e.pathI).toBe(1);
  });

  it('does not snap back to the current centre when the same path is reissued', () => {
    /* Giant Rat log: pathLeft flipped 2↔1 every frame because chase re-set
       the path (pathI=0, node 0 = current cell) and stepAlong captured it
       by snapping x back to the tile centre. */
    const g = mkGame();
    const e = body(3.5, 5.5);
    g.heroes = [e];
    const from = g.cellOf(3.5, 5.5);
    const to = g.cellOf(4.5, 5.5);
    g.setEntityPath(e, [from, to]);
    g.stepAlong(e, 2.0, 0.016);
    const xAfterFirstStep = e.x;
    expect(xAfterFirstStep).toBeGreaterThan(3.5);

    g.setEntityPath(e, [from, to]);
    g.stepAlong(e, 2.0, 0.016);
    expect(e.x).toBeGreaterThanOrEqual(xAfterFirstStep - 0.001);
  });

  it('commitPath will not replace a live combat walk', () => {
    const g = mkGame();
    const e = body(3.5, 5.5);
    g.heroes = [e];
    const a = [g.cellOf(3.5, 5.5), g.cellOf(6.5, 5.5)];
    const b = [g.cellOf(3.5, 5.5), g.cellOf(3.5, 8.5)];
    g.setEntityPath(e, a);
    const dest = e.path[e.path.length - 1];
    expect(g.commitPath(e, b)).toBe(false);
    expect(e.path[e.path.length - 1]).toBe(dest);
  });

  it('does not sidestep a combatant standing alone on an empty tile', () => {
    const g = mkGame();
    g.isCombatActive = () => true;
    const e = body(3.5, 5.5);
    g.heroes = [e];
    /* 1.0 s is past the 0.6 s sidestep threshold and short of the 2.5 s teleport. */
    for (let i = 0; i < 20; i++) g.handleStuck(e, e, 0.05);
    expect(e.x).toBeCloseTo(3.5, 5);
    expect(e.z).toBeCloseTo(5.5, 5);
    expect(e._posTween).toBeFalsy();
  });
});
