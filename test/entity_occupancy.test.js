import { describe, it, expect } from 'vitest';
import { pathfindingMethods } from '../src/game/pathfinding.js';
import { turnEngineMethods } from '../src/game/turn_engine.js';
import { reservationMethods } from '../src/game/reservation.js';
import { FLOOR, WALL } from '../src/game/constants.js';

/* Two creatures must never come to rest on the same tile.
 *
 * Occupancy used to be enforced in exactly one place — the reservation on a
 * path's ENDPOINT — while the per-frame movement probe (`blocked`) knew only
 * about walls, props and doors. Nothing stopped a body walking onto another
 * body, `findPath` ignored same-team bodies entirely, and `snapToTileCenter`
 * would then centre both of them on the identical point. These lock the three
 * layers that close it. */

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
    initiative: { active: false },
    cellOf(x, z) {
      const cx = Math.floor(x), cy = Math.floor(z);
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return -1;
      return cy * W + cx;
    },
    wx: (cx) => cx + 0.5,
    wz: (cy) => cy + 0.5,
    isCombatActive: () => false,
  };
  Object.assign(g, pathfindingMethods, reservationMethods, turnEngineMethods);
  return g;
}

const body = (x, z, hp = 10) => ({ x, z, data: { hp, maxHp: hp }, active: true, path: null, pathI: 0 });

describe('cell occupancy', () => {
  it('isCellBodyOccupied sees a live body, ignores the excluded one and corpses', () => {
    const g = mkGame();
    const a = body(3.5, 3.5), b = body(3.5, 3.5);
    g.heroes = [a, b];
    const cell = g.cellOf(3.5, 3.5);

    expect(g.isCellBodyOccupied(cell, a)).toBe(true);    // b is there
    expect(g.isCellBodyOccupied(cell, null)).toBe(true);
    b.data.hp = 0;
    expect(g.isCellBodyOccupied(cell, a)).toBe(false);   // a corpse blocks nothing
  });

  it('blockedForEntity refuses a tile another body is standing on', () => {
    const g = mkGame();
    const mover = body(3.5, 3.5), squatter = body(4.5, 3.5);
    g.heroes = [mover]; g.monsters = [squatter];

    expect(g.blocked(4.5, 3.5)).toBe(false);                    // no wall there
    expect(g.blockedForEntity(4.5, 3.5, mover)).toBe(true);     // but a body is
  });

  it('never blocks an entity from its own square', () => {
    const g = mkGame();
    const mover = body(3.5, 3.5);
    g.heroes = [mover, body(3.5, 3.5)];   // already overlapping
    expect(g.blockedForEntity(3.6, 3.6, mover)).toBe(false);
  });

  it('findPath routes around a body standing in the way, not through it', () => {
    const g = mkGame();
    const mover = body(1.5, 5.5);
    /* Wall the corridor down to one row apart from the blocker's tile so the
       route has to visibly detour. */
    const blocker = body(5.5, 5.5);
    g.heroes = [mover]; g.monsters = [blocker];

    const path = g.findPath(g.cellOf(1.5, 5.5), g.cellOf(9.5, 5.5), { mover });
    expect(path).not.toBeNull();
    expect(path).not.toContain(g.cellOf(5.5, 5.5));
  });

  it('findPath may pass THROUGH an ally but will not END on them', () => {
    const g = mkGame();
    /* 1-wide east-west corridor so the only legal route is through the ally. */
    const W = g.D.W, H = g.D.H;
    for (let y = 1; y < H - 1; y++) {
      if (y === 5) continue;
      for (let x = 1; x < W - 1; x++) g.D.grid[y * W + x] = WALL;
    }
    const mover = body(1.5, 5.5);
    const ally = body(5.5, 5.5);
    g.heroes = [mover, ally];

    const through = g.findPath(g.cellOf(1.5, 5.5), g.cellOf(9.5, 5.5), { mover });
    expect(through).not.toBeNull();
    expect(through).toContain(g.cellOf(5.5, 5.5));
    expect(g.findPath(g.cellOf(1.5, 5.5), g.cellOf(5.5, 5.5), { mover })).toBeNull();
  });

  it('findPath will not pass through a hostile', () => {
    const g = mkGame();
    const W = g.D.W, H = g.D.H;
    for (let y = 1; y < H - 1; y++) {
      if (y === 5) continue;
      for (let x = 1; x < W - 1; x++) g.D.grid[y * W + x] = WALL;
    }
    const mover = body(1.5, 5.5);
    const foe = body(5.5, 5.5);
    g.heroes = [mover];
    g.monsters = [foe];

    expect(g.findPath(g.cellOf(1.5, 5.5), g.cellOf(9.5, 5.5), { mover })).toBeNull();
  });

  it('will not path ONTO an occupied goal, even as the destination', () => {
    const g = mkGame();
    const mover = body(1.5, 5.5);
    const squatter = body(9.5, 5.5);
    g.heroes = [mover]; g.monsters = [squatter];

    expect(g.findPath(g.cellOf(1.5, 5.5), g.cellOf(9.5, 5.5), { mover })).toBeNull();
  });

  it('approachCellNear never hands back an occupied tile', () => {
    const g = mkGame();
    const mover = body(1.5, 1.5);
    const target = body(5.5, 5.5);
    /* Pack the whole ring-1 around the target. */
    const ring = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        ring.push(body(5.5 + dx, 5.5 + dz));
      }
    }
    g.heroes = [mover]; g.monsters = [target, ...ring];

    const cell = g.approachCellNear(g.cellOf(5.5, 5.5), mover);
    expect(g.isCellBodyOccupied(cell, mover)).toBe(false);
  });

  it('snapToTileCenter steps the farther body aside and leaves the owner on the centre', () => {
    const g = mkGame();
    const owner = body(3.5, 3.5);      // already on the centre
    const extra = body(3.7, 3.6);      // same cell, off-centre
    g.heroes = [owner, extra];
    expect(g.cellOf(owner.x, owner.z)).toBe(g.cellOf(extra.x, extra.z));

    g.snapToTileCenter(owner, 1, false);
    expect(owner.x).toBeCloseTo(3.5, 5);
    expect(owner.z).toBeCloseTo(3.5, 5);

    g.snapToTileCenter(extra, 1, false);
    expect(g.cellOf(extra.x, extra.z)).not.toBe(g.cellOf(owner.x, owner.z));
  });

  it('stepAlong walks through an ally but will not walk through a hostile', () => {
    const g = mkGame();
    g.initiative = { active: true };
    const mover = body(3.5, 5.5);
    mover.ent = { grp: { rotation: { y: 0 } } };
    const ally = body(4.5, 5.5);
    const foe = body(6.5, 5.5);
    g.heroes = [mover, ally];
    g.monsters = [foe];

    g.setEntityPath(mover, [g.cellOf(3.5, 5.5), g.cellOf(4.5, 5.5), g.cellOf(5.5, 5.5)]);
    for (let i = 0; i < 80; i++) g.stepAlong(mover, 4.0, 0.016);
    expect(g.cellOf(mover.x, mover.z)).toBe(g.cellOf(5.5, 5.5));
    expect(g.cellOf(ally.x, ally.z)).toBe(g.cellOf(4.5, 5.5));

    mover.x = 5.5; mover.z = 5.5;
    g.setEntityPath(mover, [g.cellOf(5.5, 5.5), g.cellOf(6.5, 5.5)]);
    for (let i = 0; i < 40; i++) g.stepAlong(mover, 4.0, 0.016);
    expect(g.cellOf(mover.x, mover.z)).toBe(g.cellOf(5.5, 5.5));
    expect(g.cellOf(foe.x, foe.z)).toBe(g.cellOf(6.5, 5.5));
  });

  it('leaves a lone body on its own tile centre', () => {
    const g = mkGame();
    const a = body(3.2, 3.4);
    g.heroes = [a];
    g.snapToTileCenter(a, 1, false);
    expect(a.x).toBeCloseTo(3.5, 5);
    expect(a.z).toBeCloseTo(3.5, 5);
  });
});
