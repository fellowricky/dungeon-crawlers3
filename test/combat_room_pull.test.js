/* ───────────── A gate opening mid-fight must not recruit the next room ─────────────
 *
 * This bug is the product of two separate fixes, each correct on its own:
 *
 *   1. combat_door_lock.test.js — doors keep opening DURING combat, because
 *      suspending them soft-locked any fight across a shut gate.
 *   2. constants.js — AGGRO_RANGE was widened 8.5 -> 12 on the reasoning that
 *      "the LOS gate (walls/closed doors) now bounds aggro, so range can be
 *      generous".
 *
 * Together: a hero in melee drifts within 2.2 of a gate, updateDoors unlocks it
 * 0.6s later, the LOS gate that justified the wide range evaporates, and 12
 * units of aggro reach through the empty doorway — where activateRoomMonsters
 * wakes the ENTIRE far room, including monsters past 12 units that were never
 * seen. Chain it at the next gate and a two-room fight becomes a four-room one.
 *
 * Neither fix may be reverted to fix the other. This file pins BOTH ends so the
 * next person to touch either one finds out immediately.
 */
import { describe, it, expect } from 'vitest';
import { pathfindingMethods } from '../src/game/pathfinding.js';
import { monsterAiMethods } from '../src/game/monster_ai.js';
import { FLOOR, WALL, AGGRO_RANGE, COMBAT_JOIN_RANGE } from '../src/game/constants.js';

/* Two rooms, 31x9, split by a wall whose single gap at (15,4) is a gate. */
const W = 31, H = 9, DOORX = 15, DOORZ = 4, DOOR = DOORZ * W + DOORX;

function scene({ doorOpen, inCombat }) {
  const grid = new Uint8Array(W * H).fill(FLOOR);
  for (let z = 0; z < H; z++) if (z !== DOORZ) grid[z * W + DOORX] = WALL;
  for (let x = 0; x < W; x++) { grid[x] = WALL; grid[(H - 1) * W + x] = WALL; }
  for (let z = 0; z < H; z++) { grid[z * W] = WALL; grid[z * W + W - 1] = WALL; }
  const cellToArch = new Int32Array(W * H).fill(-1);
  cellToArch[DOOR] = 0;

  const wx = (x) => x - W / 2 + 0.5;
  const wz = (y) => y - H / 2 + 0.5;

  const g = Object.assign({}, pathfindingMethods, monsterAiMethods, {
    D: { W, H, grid, cellToArch, wallAdj: null, chokepoint: null, solidProps: null },
    wx, wz,
    cellOf: (x, z) => {
      const cx = Math.round(x + W / 2 - 0.5), cy = Math.round(z + H / 2 - 0.5);
      return (cx < 0 || cy < 0 || cx >= W || cy >= H) ? -1 : cy * W + cx;
    },
    _unlockedDoors: doorOpen ? new Set([0]) : new Set(),
    visitedRooms: { 0: true, 1: true },
    revealed: {},
    isCombatActive: () => inCombat,
    isDoorClosed(i) { return !this._unlockedDoors.has(i); },
    isCellDoorClosed(c) {
      const a = this.D.cellToArch[c];
      return a >= 0 && this.isDoorClosed(a);
    },
    heroes: [], monsters: [],
  });

  /* A hero fighting two cells short of the gate — i.e. inside the 2.2 radius
     at which updateDoors unlocks it. */
  const hero = { x: wx(DOORX - 2), z: wz(DOORZ), data: { hp: 40, maxHp: 40, name: 'Hero' } };
  /* Room B, asleep, strung out beyond the gate at 4 / 7 / 10 / 13 units. */
  const mk = (dx, name) => ({
    x: wx(DOORX + dx), z: wz(DOORZ), roomId: 1, active: false,
    ent: { grp: { visible: false } }, data: { hp: 20, maxHp: 20, name }
  });
  const mobs = [mk(2, 'B1'), mk(5, 'B2'), mk(8, 'B3'), mk(11, 'B4')];
  g.heroes = [hero];
  g.monsters = mobs;
  return { g, hero, mobs };
}

const wake = (opts) => {
  const { g, hero, mobs } = scene(opts);
  for (const m of mobs) g.tryActivateMonster(m, [hero]);
  return mobs.filter(m => m.active).map(m => m.data.name);
};

describe('a gate opening during a fight', () => {
  it('does not pull the far room in wholesale', () => {
    /* THE BUG: this returned all four, B4 included — 13 units away, past
       AGGRO_RANGE entirely, woken purely by activateRoomMonsters. */
    const woke = wake({ doorOpen: true, inCombat: true });
    expect(woke).not.toContain('B4');
    expect(woke).not.toContain('B3');
    expect(woke.length).toBeLessThan(4);
  });

  it('still lets a monster standing in the doorway join', () => {
    /* The fix must not make the far side inert — something right on top of the
       party has every business joining. */
    expect(wake({ doorOpen: true, inCombat: true })).toContain('B1');
  });

  it('wakes nobody at all while the gate is still shut', () => {
    expect(wake({ doorOpen: false, inCombat: true })).toEqual([]);
  });
});

describe('exploration is untouched', () => {
  it('still wakes a room as a unit when the party walks in on it', () => {
    /* Rooms fighting as a unit is the intended feel — it is only being
       recruited into someone else's fight that is not. */
    expect(wake({ doorOpen: true, inCombat: false }).sort())
      .toEqual(['B1', 'B2', 'B3', 'B4']);
  });

  it('still respects a shut gate out of combat', () => {
    expect(wake({ doorOpen: false, inCombat: false })).toEqual([]);
  });
});

describe('the two fixes this bug sits between', () => {
  it('keeps the join leash tighter than the exploration leash', () => {
    /* If these ever equalise, the wide range is reaching through open gates
       again and the bug is back. */
    expect(COMBAT_JOIN_RANGE).toBeLessThan(AGGRO_RANGE);
  });

  it('keeps ROUTING through a shut gate legal mid-fight, even though OPENING one is not', () => {
    /* Doors no longer open during combat at all (combat_door_opening.test.js).
       Pathfinding is a separate question and is deliberately unchanged: a
       closed door is a cost to a hero, not a wall, so routes still cross it.
       Turning it into a wall here would resurrect the fight-across-a-shut-gate
       soft-lock from the other side. What resolves an unreachable fight now is
       _breakCombatStall retiring the monsters nobody can get to — not a gate
       swinging open mid-swing. */
    const { g } = scene({ doorOpen: false, inCombat: true });
    const from = 1 * W + (DOORX - 2);
    const to = 1 * W + (DOORX + 2);
    const path = g.findPath(from, to);
    expect(path, 'heroes can no longer route through a shut gate mid-fight').toBeTruthy();
    expect(path).toContain(DOOR);
  });

  it('still stops a monster, which cannot open a door', () => {
    const { g } = scene({ doorOpen: false, inCombat: true });
    const from = 1 * W + (DOORX - 2);
    const to = 1 * W + (DOORX + 2);
    expect(g.findPath(from, to, { avoidClosedDoors: true })).toBeNull();
  });
});
