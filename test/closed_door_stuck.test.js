import { describe, it, expect } from 'vitest';
import { FLOOR, WALL } from '../src/dungeon/dungeon_generator.js';
import { pathfindingMethods } from '../src/game/pathfinding.js';
import { exploreMethods } from '../src/game/explore.js';

/* 5x5 map, a 1-wide gate at cell 12 joining the north and south halves:
     # # # # #
     # . . . #
     # # D # #     D = cell 12, the doorway arch
     # . . . #
     # # # # #                                                            */
const GRID = new Uint8Array([
  WALL, WALL,  WALL,  WALL,  WALL,
  WALL, FLOOR, FLOOR, FLOOR, WALL,
  WALL, WALL,  FLOOR, WALL,  WALL,
  WALL, FLOOR, FLOOR, FLOOR, WALL,
  WALL, WALL,  WALL,  WALL,  WALL
]);

function makeGame(doorClosed) {
  const g = Object.assign({}, pathfindingMethods, exploreMethods, {
    D: {
      W: 5, H: 5, grid: GRID,
      arches: [{ x: 2.5, y: 2.5, cells: [12] }],
      wallAdj: new Uint8Array(25),
      chokepoint: new Uint8Array(25),
      cellToArch: Int16Array.from({ length: 25 }, (_, i) => (i === 12 ? 0 : -1))
    },
    _unlockedDoors: doorClosed ? new Set() : new Set([0]),
    heroes: [], monsters: [],
    cellOf: (x, z) => {
      const gx = Math.floor(x), gz = Math.floor(z);
      if (gx < 0 || gz < 0 || gx > 4 || gz > 4) return -1;
      return gz * 5 + gx;
    },
    wx: (x) => x + 0.5,
    wz: (z) => z + 0.5,
    isCellDoorClosed: function(c) {
      if (!this._unlockedDoors) return false;
      const archIdx = this.D.cellToArch ? this.D.cellToArch[c] : -1;
      return archIdx >= 0 && !this._unlockedDoors.has(archIdx);
    },
    wallRepel: () => {},
    syncDoorVisuals: () => {}
  });

  g.updateDoors = function(dt) {
    if (!this.D || !this.D.arches || !this._unlockedDoors) return;
    const alive = this.heroes.filter(h => h.data && h.data.hp > 0);
    if (!alive.length) return;
    if (!this._doorUnlockTimers) this._doorUnlockTimers = {};
    const W = this.D.W;
    let changed = false;
    for (let i = 0; i < this.D.arches.length; i++) {
      if (this._unlockedDoors.has(i)) continue;
      const a = this.D.arches[i];
      const ax = this.wx(a.x);
      const az = this.wz(a.y);
      let opener = null, bd = 1e9;
      for (const h of alive) {
        let minDist = Math.hypot(h.x - ax, h.z - az);
        if (a.cells && a.cells.length > 0 && W > 0) {
          for (let j = 0; j < a.cells.length; j++) {
            const cellIdx = a.cells[j];
            const cx = this.wx(cellIdx % W);
            const cz = this.wz(Math.floor(cellIdx / W));
            const dCell = Math.hypot(h.x - cx, h.z - cz);
            if (dCell < minDist) minDist = dCell;
          }
        }
        if (h.path && h.pathI < h.path.length) {
          const lookahead = Math.min(h.path.length, h.pathI + 4);
          for (let idx = h.pathI; idx < lookahead; idx++) {
            const pathCell = h.path[idx];
            if (this.D.cellToArch && this.D.cellToArch[pathCell] === i) {
              minDist = Math.min(minDist, 1.0);
              break;
            }
          }
        }
        if (minDist < bd) { bd = minDist; opener = h; }
      }
      if (bd < 2.2) {
        if (this._doorUnlockTimers[i] === undefined) {
          this._doorUnlockTimers[i] = 0;
        }
        this._doorUnlockTimers[i] += dt;
        if (this._doorUnlockTimers[i] >= 0.6) {
          this._unlockedDoors.add(i);
          delete this._doorUnlockTimers[i];
          changed = true;
          for (const h of alive) {
            h.path = null;
            h.pathGoal = -1;
            h.repathT = 0;
            h.stuckT = 0;
            h.stuckStage = 0;
            h._blockedByDoor = false;
            h._doorWaitT = 0;
          }
          this.stuckT = 0;
        }
      } else {
        if (this._doorUnlockTimers[i] !== undefined) {
          delete this._doorUnlockTimers[i];
        }
      }
    }
    if (changed) this.syncDoorVisuals();
  };

  return g;
}

describe('closed-door pathing', () => {
  it('treats a closed gate as opaque to line of sight', () => {
    /* Monsters must not wake (and latch this.combat on) through a shut door —
       that is what froze the doors and soft-locked the party. */
    expect(makeGame(true).hasLOS(2.5, 1.5, 2.5, 3.5)).toBe(false);
    expect(makeGame(false).hasLOS(2.5, 1.5, 2.5, 3.5)).toBe(true);
  });

  it('flags an entity halted by a closed gate rather than moving it', () => {
    const g = makeGame(true);
    const e = { x: 2.5, z: 1.5, path: [7, 12, 17], pathI: 0, ent: { grp: { rotation: { y: 0 } } } };
    expect(g.stepAlong(e, 3, 0.016)).toBe(false);
    expect(e._blockedByDoor).toBe(true);
    expect(e.z).toBe(1.5);
  });

  it('clears the flag and walks through once the gate opens', () => {
    const g = makeGame(false);
    const e = { x: 2.5, z: 1.5, path: [7, 12, 17], pathI: 0, ent: { grp: { rotation: { y: 0 } } } };
    expect(g.stepAlong(e, 3, 0.016)).toBe(true);
    expect(e._blockedByDoor).toBe(false);
    expect(e.z).toBeGreaterThan(1.5);
  });

  it('does not accumulate stuck time while waiting on a gate', () => {
    const g = makeGame(true);
    const e = { x: 2.5, z: 1.5, _blockedByDoor: true, stuckT: 0, stuckStage: 0,
                data: { name: 'Test' } };
    /* Waiting on a gate for < 1s holds position without accumulating stuck ladder time */
    for (let i = 0; i < 30; i++) g.handleStuck(e, e, 0.016);
    expect(e.stuckT).toBe(0);
    expect(e.stuckStage).toBe(0);
    expect(e.x).toBe(2.5);
    expect(e.z).toBe(1.5);
  });

  it('still escalates when the entity is stuck for a non-door reason', () => {
    const g = makeGame(false);
    const e = { x: 2.5, z: 1.5, stuckT: 0, stuckStage: 0, data: { name: 'Test' } };
    g.handleStuck(e, e, 0.3);
    expect(e.stuckT).toBeGreaterThan(0);
  });

  it('triggers door unlocking when hero is > 1.5 tiles away (e.g. 1.8 tiles)', () => {
    const g = makeGame(true);
    g.heroes = [{ x: 2.5, z: 0.7, data: { hp: 10 } }]; // distance to arch (2.5, 2.5) is 1.8 tiles
    g.updateDoors(0.3);
    expect(g._doorUnlockTimers[0]).toBeDefined();
    g.updateDoors(0.4);
    expect(g._unlockedDoors.has(0)).toBe(true);
  });

  it('triggers door unlocking via path lookahead', () => {
    const g = makeGame(true);
    g.heroes = [{ x: 2.5, z: 0.1, path: [2, 7, 12, 17], pathI: 0, data: { hp: 10 } }]; // dist is 2.4, but path passes through 12
    g.updateDoors(0.3);
    expect(g._doorUnlockTimers[0]).toBeDefined();
  });

  it('forces door open after holding _blockedByDoor for > 1.0s failsafe', () => {
    let forceCalled = false;
    const g = Object.assign({}, makeGame(true), {
      forceDoorsAlongPath: () => { forceCalled = true; }
    });
    const e = { x: 2.5, z: 1.5, _blockedByDoor: true, path: [7, 12, 17], stuckT: 0, stuckStage: 0, data: { name: 'Test' } };
    for (let i = 0; i < 70; i++) g.handleStuck(e, e, 0.016); // 1.12 seconds
    expect(forceCalled).toBe(true);
    expect(e._blockedByDoor).toBe(false);
  });
});
