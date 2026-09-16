/* ───────────────────── Getting around elevated ground ─────────────────────
 * Two rules keep raised terrain interesting rather than tedious, and both are
 * easy to regress silently because neither shows up as an error — you just
 * find yourself walking the long way round.
 *
 *  1. Stairs are REDUNDANT. carveStairs stops the instant a room is connected,
 *     which leaves one staircase per tier boundary: connected, but every route
 *     across the room funnels through the same square and one prop or one body
 *     coming the other way turns a short walk into a lap.
 *  2. Out of combat a body FREE CLIMBS up to FREE_CLIMB levels. In combat it is
 *     stairs or nothing, so height keeps costing something when it matters.
 */
import { describe, it, expect } from 'vitest';
import { generateDungeon, THEME_KEYS, FLOOR } from '../src/dungeon/dungeon_generator.js';
import { canStep, FREE_CLIMB } from '../src/dungeon/elevation.js';
import { pathfindingMethods, buildSolidProps } from '../src/game/pathfinding.js';

describe('canStep — free-climb allowance', () => {
  const d = { height: new Int8Array([0, 0, 1, 2, 3]), ramp: new Uint8Array(5) };

  it('is stairs-only by default', () => {
    expect(canStep(d, 0, 1)).toBe(true);        // flat
    expect(canStep(d, 1, 2)).toBe(false);       // one level, no stair
    expect(canStep(d, 2, 3)).toBe(false);       // ditto
  });

  it('crosses up to `climb` levels unaided, in both directions', () => {
    expect(canStep(d, 1, 2, FREE_CLIMB)).toBe(true);    // +1 up
    expect(canStep(d, 2, 1, FREE_CLIMB)).toBe(true);    // -1 down
    expect(canStep(d, 1, 3, FREE_CLIMB)).toBe(true);    // +2 up
    expect(canStep(d, 3, 1, FREE_CLIMB)).toBe(true);    // -2 down
  });

  it('still refuses a drop taller than the allowance', () => {
    expect(canStep(d, 1, 4, FREE_CLIMB)).toBe(false);   // 3 levels
    expect(canStep(d, 4, 1, FREE_CLIMB)).toBe(false);
  });
});

describe('findPath — climbing is always legal, and priced in combat', () => {
  /* A hall split down the middle by a two-level face. `stairAt` optionally
     puts one staircase in the bottom row, so the same map can ask both "is
     there a way across at all" and "does it prefer the steps". */
  const W = 12, H = 5;
  const make = (inCombat, stairAt) => {
    const grid = new Uint8Array(W * H).fill(FLOOR);
    const height = new Int8Array(W * H);
    const ramp = new Uint8Array(W * H);
    /* One level, so a single flight of steps can bridge it. */
    for (let y = 0; y < H; y++) for (let x = 6; x < W; x++) height[y * W + x] = 1;
    if (stairAt != null) ramp[stairAt] = 1;
    return Object.assign({}, pathfindingMethods, {
      D: { W, H, grid, height, ramp, wallAdj: null, chokepoint: null, solidProps: null },
      heroes: [], monsters: [], _reservedCells: null, activeAoEZones: [],
      isCombatActive: () => inCombat,
      isCellReserved: () => false
    });
  };
  const from = 0 * W + 2, to = 0 * W + 9;

  it('routes over an unstaired ledge out of combat', () => {
    expect(make(false).findPath(from, to)).toBeTruthy();
  });

  it('routes over an unstaired ledge IN combat too', () => {
    /* The lockup this replaced: with the climb banned outright, a party caught
       below a face with no usable steps had no legal move at all. Terrain
       being connected under the stairs-only rule is a claim about EMPTY
       terrain, and combat is when the terrain is not empty. */
    expect(make(true).findPath(from, to)).toBeTruthy();
  });

  it('detours to the stairs in combat when they are close', () => {
    const stair = 4 * W + 5;                     // low side of the face, 4 rows down
    const path = make(true, stair).findPath(from, to);
    expect(path).toBeTruthy();
    expect(path, 'walked straight over the face with steps right there')
      .toContain(stair);
  });

  it('ignores far-off stairs while exploring — the climb is free', () => {
    const stair = 4 * W + 5;
    const path = make(false, stair).findPath(from, to);
    expect(path).toBeTruthy();
    expect(path, 'took a detour it had no reason to take').not.toContain(stair);
  });
});

describe('Stair redundancy — no tier hangs off a single staircase', () => {
  it('leaves most staircases individually removable', () => {
    /* The property that "doubling the stairs" actually buys: knock any one
       staircase out and the level is still whole. Not every stair can be
       spared (a boundary too small or too cluttered to hold a second set has
       to keep its only one), so this asks for a comfortable majority rather
       than all of them. Before the redundancy pass this sat near zero — every
       stair carved was, by construction, load-bearing. */
    const results = [];
    for (const themeKey of THEME_KEYS) {
      const seed = 24757;
      const d = generateDungeon(seed, { seed, roomCount: 40, themeKey });
      const solid = buildSolidProps(d);
      const { W, H, grid, height, ramp } = d;
      const walkable = (c) => grid[c] === FLOOR && !solid[c];

      const whole = () => {
        let start = -1, need = 0;
        for (let c = 0; c < grid.length; c++) if (walkable(c)) { need++; if (start < 0) start = c; }
        if (start < 0) return true;
        const seen = new Uint8Array(grid.length);
        const st = [start]; seen[start] = 1;
        let n = 1;
        while (st.length) {
          const c = st.pop(), x = c % W, y = (c / W) | 0;
          for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const nx = x + ox, ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const nc = ny * W + nx;
            if (seen[nc] || !walkable(nc)) continue;
            if (ox && oy && (!walkable(y * W + nx) || !walkable(ny * W + x))) continue;
            const dh = height[nc] - height[c];
            if (dh !== 0 && (Math.abs(dh) !== 1 || !(ramp[c] || ramp[nc]))) continue;
            seen[nc] = 1; n++; st.push(nc);
          }
        }
        return n === need;
      };

      let total = 0, sparable = 0;
      for (let c = 0; c < ramp.length; c++) {
        if (!ramp[c]) continue;
        total++;
        ramp[c] = 0;
        if (whole()) sparable++;
        ramp[c] = 1;
      }
      if (total) results.push({ themeKey, frac: sparable / total, total });
    }

    expect(results.length, 'no theme produced any stairs at all').toBeGreaterThan(0);
    for (const r of results) {
      expect(r.frac,
        `${r.themeKey}: only ${(r.frac * 100).toFixed(0)}% of ${r.total} stairs are spare`
      ).toBeGreaterThan(0.6);
    }
  }, 120000);
});
