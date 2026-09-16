/* ─────────────────── Closed doors and who they stop ───────────────────
 * This file used to assert the opposite of what it asserts now: that a closed
 * door was an impassable wall for EVERYONE during combat, and that the
 * force-open helpers refused to act mid-fight. Together those produced a soft
 * lock — a fight across a shut gate that neither side could reach, in which
 * the door could never open because door-opening was suspended until the fight
 * ended, and the fight could not end. See test/combat_door_lock.test.js.
 *
 * It also carried local re-implementations of updateDoors, forceDoorsAlongPath
 * and forceOpenAllDoors, so three of its tests exercised copies living in this
 * file rather than the shipping methods on Game. They passed unchanged while
 * the real functions were rewritten underneath them. Those are gone: a test
 * against a copy of the code is not a test.
 *
 * The rule that remains, and that findPath really implements: a closed door
 * stops whoever cannot open one. Monsters say so by passing avoidClosedDoors.
 * For heroes it is a cost — they unlock gates by walking up to them — and that
 * is as true inside a fight as outside one.
 */
import { describe, it, expect } from 'vitest';
import { FLOOR, WALL } from '../src/dungeon/dungeon_generator.js';
import { pathfindingMethods } from '../src/game/pathfinding.js';
import { exploreMethods } from '../src/game/explore.js';

/* 5x5 map, a 1-wide gate at cell 12 joining north and south halves:
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

function makeGame(doorClosed, inCombat = false) {
  return Object.assign({}, pathfindingMethods, exploreMethods, {
    D: {
      W: 5, H: 5, grid: GRID,
      arches: [{ x: 2.5, y: 2.5, cells: [12] }],
      wallAdj: new Uint8Array(25),
      chokepoint: new Uint8Array(25),
      cellToArch: Int16Array.from({ length: 25 }, (_, i) => (i === 12 ? 0 : -1))
    },
    _unlockedDoors: doorClosed ? new Set() : new Set([0]),
    heroes: [], monsters: [],
    combat: inCombat,
    initiative: { active: inCombat },
    cellOf: (x, z) => {
      const gx = Math.floor(x), gz = Math.floor(z);
      if (gx < 0 || gz < 0 || gx > 4 || gz > 4) return -1;
      return gz * 5 + gx;
    },
    wx: (x) => x + 0.5,
    wz: (z) => z + 0.5,
    isCombatActive: function() {
      return !!(this.combat || (this.initiative && this.initiative.active));
    },
    isDoorClosed: function(archIndex) {
      if (!this._unlockedDoors) return false;
      return !this._unlockedDoors.has(archIndex);
    },
    isCellDoorClosed: function(c) {
      if (!this.D || !this.D.cellToArch || c < 0 || c >= this.D.cellToArch.length) return false;
      const archIdx = this.D.cellToArch[c];
      if (archIdx < 0) return false;
      return this.isDoorClosed(archIdx);
    },
    wallRepel: () => {},
    syncDoorVisuals: () => {}
  });
}

describe('closed doors during combat', () => {
  it('routes a hero through a closed door during combat, at a cost', () => {
    const g = makeGame(true, true);           // door closed, combat active
    const path = g.findPath(7, 17);           // (2,1) -> (2,3), door is cell 12
    expect(path, 'no route through the only gate mid-fight').not.toBeNull();
    expect(path).toContain(12);
  });

  it('routes a hero through a closed door outside combat too', () => {
    const g = makeGame(true, false);
    const path = g.findPath(7, 17);
    expect(path).not.toBeNull();
    expect(path).toContain(12);
  });

  it('stops a mover that asks to avoid closed doors, in or out of combat', () => {
    /* Monsters pass this flag: they cannot work a latch, so for them the gate
       really is a wall. Nothing about being in a fight changes that either. */
    expect(makeGame(true, true).findPath(7, 17, { avoidClosedDoors: true })).toBeNull();
    expect(makeGame(true, false).findPath(7, 17, { avoidClosedDoors: true })).toBeNull();
  });

  it('lets everyone through once the door is open', () => {
    const g = makeGame(false, true);
    expect(g.findPath(7, 17, { avoidClosedDoors: true })).toContain(12);
  });
});
