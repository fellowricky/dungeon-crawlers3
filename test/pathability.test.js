/* ───────────────────────── Pathability guarantee ──────────────────────────
 * "Every square that is meant to be traversable must actually be reachable."
 *
 * This exists because two separate guards each passed while the level was
 * broken. The elevation pass proves every floor cell is reachable — but floods
 * with props ignored. buildSolidProps guards against a prop sealing a room —
 * but flooded FLAT and 4-WAY, so it could not see a pillar standing on the one
 * staircase off a terrace, and its room-level test was satisfied as long as the
 * ground floor was still reachable. A unit that walked up was stranded.
 *
 * Neither guard was wrong on its own terms. What was missing was a check
 * against the model the game ACTUALLY moves under, which is the conjunction of
 * all of them:
 *
 *     walkable = FLOOR  and  not solidProp
 *     a step is legal if it is 8-way, does not cut a corner,
 *     and obeys canStep (same level, or one level across a stair)
 *
 * That is exactly what findPath does, and it is what this test floods with.
 */
import { describe, it, expect } from 'vitest';
import { generateDungeon, THEME_KEYS, FLOOR } from '../src/dungeon/dungeon_generator.js';
import { buildSolidProps } from '../src/game/pathfinding.js';
import { FREE_CLIMB } from '../src/dungeon/elevation.js';

const SEEDS = [1000, 8919, 24757, 40595, 64352];

/** Reachable set under the real movement model, seeded from the entrance. */
function reachable(d, solid) {
  const { W, H, grid, height, ramp } = d;
  const walkable = (c) => grid[c] === FLOOR && !solid[c];
  const canStep = (a, b) => {
    const dh = height[b] - height[a];
    if (dh === 0) return true;
    if (dh !== 1 && dh !== -1) return false;
    return !!(ramp[a] || ramp[b]);
  };

  const er = d.rooms[d.entrance];
  let start = er ? er.cy * W + er.cx : -1;
  if (start < 0 || !walkable(start)) {
    start = -1;
    for (let c = 0; c < grid.length; c++) if (walkable(c)) { start = c; break; }
  }
  const seen = new Uint8Array(grid.length);
  if (start < 0) return seen;

  const st = [start];
  seen[start] = 1;
  while (st.length) {
    const c = st.pop();
    const x = c % W, y = (c / W) | 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = x + ox, ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (seen[n] || !walkable(n)) continue;
      /* no corner cutting — matches findPath's diagonal guard */
      if (ox && oy && (!walkable(y * W + nx) || !walkable(ny * W + x))) continue;
      if (!canStep(c, n)) continue;
      seen[n] = 1; st.push(n);
    }
  }
  return seen;
}

describe('Pathability — every walkable square is reachable', () => {
  it('strands nothing under the real movement model (floor + props + heights)', () => {
    const failures = [];
    for (const themeKey of THEME_KEYS) {
      for (const seed of SEEDS) {
        const d = generateDungeon(seed, { seed, roomCount: 40, themeKey });
        const solid = buildSolidProps(d);
        const seen = reachable(d, solid);
        let stranded = 0;
        for (let c = 0; c < d.grid.length; c++) {
          if (d.grid[c] !== FLOOR || solid[c]) continue;
          if (!seen[c]) stranded++;
        }
        if (stranded) failures.push(`${themeKey}/${seed}: ${stranded} stranded`);
      }
    }
    expect(failures, `${failures.length} level(s) with unreachable ground`).toEqual([]);
  }, 120000);

  it('leaves no island that only a staircase can reach', () => {
    /* The stairs-only guarantee above is a claim about EMPTY terrain, and the
       moment it matters most — combat — the terrain is not empty. A party that
       walked up a tier whose one staircase then had a monster standing on it
       had no legal move at all; that is the lock-up Zenu hit.
       So the real requirement is stronger: ignore EVERY staircase and the
       level must still be whole under a FREE_CLIMB scramble alone. Then no
       arrangement of bodies can trap anyone, because the way out never
       depended on a particular square in the first place. */
    const failures = [];
    for (const themeKey of THEME_KEYS) {
      for (const seed of SEEDS) {
        const d = generateDungeon(seed, { seed, roomCount: 40, themeKey });
        const solid = buildSolidProps(d);
        const { W, H, grid, height } = d;
        const walkable = (c) => grid[c] === FLOOR && !solid[c];
        let start = -1, need = 0;
        for (let c = 0; c < grid.length; c++) if (walkable(c)) { need++; if (start < 0) start = c; }
        if (start < 0) continue;
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
            if (Math.abs(height[nc] - height[c]) > FREE_CLIMB) continue;  // no stairs at all
            seen[nc] = 1; n++; st.push(nc);
          }
        }
        if (n < need) failures.push(`${themeKey}/${seed}: ${need - n} cell(s) need a staircase`);
      }
    }
    expect(failures, `${failures.length} level(s) with stair-dependent ground`).toEqual([]);
  }, 120000);

  it('never leaves a prop standing on a staircase', () => {
    /* A staircase is the only way between two tiers. Elevation runs after prop
       placement, so it can carve one straight under a pillar — which is how a
       unit ended up stuck on a terrace with no way down. */
    for (const themeKey of THEME_KEYS) {
      for (const seed of SEEDS) {
        const d = generateDungeon(seed, { seed, roomCount: 40, themeKey });
        const occupied = new Uint8Array(d.W * d.H);
        for (const p of d.props) {
          const x = Math.round(p.x), y = Math.round(p.y);
          if (x < 0 || y < 0 || x >= d.W || y >= d.H) continue;
          occupied[y * d.W + x] = 1;
        }
        for (let c = 0; c < d.ramp.length; c++) {
          if (!d.ramp[c]) continue;
          expect(occupied[c],
            `${themeKey}/${seed}: prop on the staircase at ${c % d.W},${(c / d.W) | 0}`).toBe(0);
        }
      }
    }
  }, 120000);

  it('a staircase is never marked solid, whatever stands near it', () => {
    /* Belt and braces on the pathfinding side: even if a prop does end up on a
       stair, sealing it must not be possible. */
    for (const themeKey of THEME_KEYS) {
      for (const seed of SEEDS.slice(0, 3)) {
        const d = generateDungeon(seed, { seed, roomCount: 40, themeKey });
        const solid = buildSolidProps(d);
        for (let c = 0; c < d.ramp.length; c++) {
          if (!d.ramp[c]) continue;
          expect(solid[c], `${themeKey}/${seed}: staircase marked solid`).toBe(0);
        }
      }
    }
  }, 120000);
});
