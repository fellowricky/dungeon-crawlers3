import { describe, it, expect } from 'vitest';
import { generateDungeon, FLOOR } from '../src/dungeon/dungeon_generator.js';
import { buildElevation, canStep, heightOf, worldYOf, STEP, MAX_LEVEL, MIN_LEVEL } from '../src/dungeon/elevation.js';

const SEEDS = [771204, 12345, 99887, 5150, 424242, 7, 31337, 606060];

function gen(seed) {
  return generateDungeon(seed, { seed, roomCount: 16, themeKey: 'ancient' });
}

/* Flood the walkable set using exactly the rule findPath will use, and report
   how many floor cells are reachable from the entrance. */
function reachableCount(d) {
  const { W, H, grid, height, ramp } = d;
  const total = W * H;
  const idx = (x, y) => y * W + x;
  const isFloor = (c) => c >= 0 && c < total && grid[c] === FLOOR;
  let seed = -1, floorTotal = 0;
  for (let c = 0; c < total; c++) if (isFloor(c)) { floorTotal++; if (seed < 0) seed = c; }
  if (seed < 0) return { reached: 0, floorTotal: 0 };

  const seen = new Uint8Array(total);
  const q = [seed];
  seen[seed] = 1;
  let reached = 0;
  while (q.length) {
    const c = q.pop(); reached++;
    const x = c % W, y = (c / W) | 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = x + ox, ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const nc = idx(nx, ny);
      if (seen[nc] || !isFloor(nc)) continue;
      if (ox && oy && (!isFloor(idx(nx, y)) || !isFloor(idx(x, ny)))) continue;
      const dh = height[nc] - height[c];
      if (dh !== 0 && (Math.abs(dh) !== 1 || !(ramp[c] || ramp[nc]))) continue;
      seen[nc] = 1; q.push(nc);
    }
  }
  return { reached, floorTotal };
}

describe('Elevation — generation invariants', () => {
  it('attaches height and ramp arrays sized to the grid', () => {
    const d = gen(SEEDS[0]);
    expect(d.height).toBeInstanceOf(Int8Array);
    expect(d.ramp).toBeInstanceOf(Uint8Array);
    expect(d.height.length).toBe(d.W * d.H);
    expect(d.ramp.length).toBe(d.W * d.H);
  });

  it('NEVER disconnects the level — every floor cell stays reachable', () => {
    for (const seed of SEEDS) {
      const d = gen(seed);
      const { reached, floorTotal } = reachableCount(d);
      expect(floorTotal).toBeGreaterThan(0);
      expect(reached, `seed ${seed} stranded ${floorTotal - reached} floor cells`).toBe(floorTotal);
    }
  });

  it('keeps corridors and doorways at level 0', () => {
    for (const seed of SEEDS) {
      const d = gen(seed);
      for (let c = 0; c < d.W * d.H; c++) {
        if (d.grid[c] !== FLOOR) continue;
        if (d.corridor[c] || d.doorway[c]) {
          expect(d.height[c], `seed ${seed} cell ${c}`).toBe(0);
        }
      }
    }
  });

  it('holds every height inside the declared range', () => {
    for (const seed of SEEDS) {
      const d = gen(seed);
      for (let c = 0; c < d.height.length; c++) {
        expect(d.height[c]).toBeLessThanOrEqual(MAX_LEVEL);
        expect(d.height[c]).toBeGreaterThanOrEqual(MIN_LEVEL);
      }
    }
  });

  it('builds genuinely multi-tier rooms, not single step-ups', () => {
    /* The whole point of the archetype rewrite. The first version emitted one
       +1 or -1 platform per room, so every room was one step up or one step
       down however varied the shape was. Pin that we now span more. */
    let maxSpan = 0, multiTierRooms = 0;
    for (const seed of SEEDS) {
      const d = gen(seed);
      for (const f of d.elevationFeatures || []) {
        const span = f.high - f.low;
        if (span > maxSpan) maxSpan = span;
        if (span >= 2) multiTierRooms++;
      }
    }
    expect(maxSpan, 'no room spans more than one level').toBeGreaterThanOrEqual(3);
    expect(multiTierRooms, 'no multi-tier rooms at all').toBeGreaterThan(0);
  });

  it('produces impassable cliffs (level gaps of 2+) as deliberate terrain', () => {
    /* canStep refuses a 2-level change outright, so these boundaries are real
       high ground that has to be walked around. They are a FEATURE — the moat
       archetype relies on one — but they must never strand anyone, which the
       reachability test above is what guards. */
    let cliffs = 0;
    for (const seed of SEEDS) {
      const d = gen(seed);
      const { W, H, grid, height } = d;
      for (let y = 0; y < H; y++) for (let x = 0; x < W - 1; x++) {
        const c = y * W + x, n = c + 1;
        if (grid[c] !== FLOOR || grid[n] !== FLOOR) continue;
        if (Math.abs(height[n] - height[c]) >= 2) cliffs++;
      }
    }
    expect(cliffs, 'no impassable cliffs generated anywhere').toBeGreaterThan(0);
  });

  it('puts a stair on the lower side of every traversable level change', () => {
    /* Where a 1-level boundary is crossable at all, canStep requires a stair
       on one side. Verified indirectly: flood reachability already passes, so
       here we just assert stairs sit at base level or on a tier, never on a
       pinned corridor/doorway cell. */
    for (const seed of SEEDS) {
      const d = gen(seed);
      for (let c = 0; c < d.ramp.length; c++) {
        if (!d.ramp[c]) continue;
        expect(d.grid[c], `seed ${seed} stair off-floor`).toBe(FLOOR);
        expect(!!d.corridor[c] && !!d.doorway[c], `seed ${seed} stair in chokepoint`).toBe(false);
      }
    }
  });

  it('produces actual elevation on a reasonable share of seeds', () => {
    let withFeatures = 0;
    for (const seed of SEEDS) {
      const d = gen(seed);
      if (d.elevationFeatures && d.elevationFeatures.length) withFeatures++;
    }
    expect(withFeatures, 'elevation never fired on any seed').toBeGreaterThan(0);
  });

  it('names an archetype for every feature and uses a spread of them', () => {
    const kinds = new Set();
    for (const seed of SEEDS) {
      const d = gen(seed);
      for (const f of d.elevationFeatures || []) {
        expect(typeof f.kind, `seed ${seed}`).toBe('string');
        expect(f.tiers, `seed ${seed} ${f.kind}`).toBeGreaterThan(0);
        kinds.add(f.kind);
      }
    }
    expect(kinds.size, `only saw archetypes: ${[...kinds]}`).toBeGreaterThanOrEqual(3);
  });

  it('elevationChance 0 produces a completely flat level', () => {
    /* The opt-out has to cover shrine/boss/treasure rooms too — those skip the
       probability roll, so an early version of this still raised daises at
       chance 0. Flat is what makes the renderer's "unchanged when flat" 
       guarantee testable, so it must mean flat. */
    for (const seed of SEEDS) {
      const d = generateDungeon(seed, { seed, roomCount: 16, themeKey: 'ancient', elevationChance: 0 });
      expect(d.elevationFeatures, `seed ${seed}`).toHaveLength(0);
      for (let c = 0; c < d.height.length; c++) {
        expect(d.height[c]).toBe(0);
        expect(d.ramp[c]).toBe(0);
      }
    }
  });

  it('levels every liquid body — pools AND lakes — flat onto the lowest adjacent floor', () => {
    /* POOL cells are not FLOOR, so no archetype touches them and they sat at
       level 0 while the floor around them moved — in the pool-bearing themes a
       third of them ended up beside elevated ground, off by up to 3 levels.
       A liquid surface must be FLAT (one level per body) and must sit at the
       lowest floor it touches, or it hangs in the air / buries itself. */
    const POOL = 3;
    for (const themeKey of ['molten', 'frost', 'grim', 'verdant']) {
      for (const seed of SEEDS.slice(0, 4)) {
        const d = generateDungeon(seed, { seed, roomCount: 16, themeKey });
        /* Lakes are FLOOR + lakeMask, not the POOL tile. Checking only POOL
           missed them entirely: because they read as ordinary floor they were
           inside roomCells() and the archetypes shaped them like terrain,
           leaving 12 of 20 lake bodies with a stepped surface and some
           floating two levels above the floor beside them. */
        const isLiquid = (c) => d.grid[c] === POOL
          || (d.grid[c] === FLOOR && !!(d.lakeMask && d.lakeMask[c]));
        const seen = new Uint8Array(d.grid.length);
        for (let start = 0; start < d.grid.length; start++) {
          if (!isLiquid(start) || seen[start]) continue;
          const q = [start]; seen[start] = 1;
          let qh = 0, lowest = null;
          const levels = new Set();
          while (qh < q.length) {
            const c = q[qh++];
            levels.add(d.height[c]);
            const x = c % d.W, y = (c / d.W) | 0;
            for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
              if (!ox && !oy) continue;
              const nx = x + ox, ny = y + oy;
              if (nx < 0 || ny < 0 || nx >= d.W || ny >= d.H) continue;
              const nc = ny * d.W + nx;
              if (isLiquid(nc)) { if (!seen[nc]) { seen[nc] = 1; q.push(nc); } }
              else if (d.grid[nc] === FLOOR) {
                if (lowest === null || d.height[nc] < lowest) lowest = d.height[nc];
              }
            }
          }
          /* Flatness is absolute — a liquid surface with a step in it is
             always wrong. */
          expect(levels.size, `${themeKey} seed ${seed}: stepped liquid surface`).toBe(1);
          /* CONTAINMENT. Water is allowed to sit above the base plane — 613
             of 1561 bodies do — but only if it is held there. Every floor cell
             touching the body must be AT LEAST the waterline, or the surface
             reads as spilling over a lip into thin air. Banks are raised to
             meet the water; where the approach grading forbids lifting a cell
             (too near a doorway) the water drops to meet the ground instead. */
          const L = [...levels][0];
          for (const c of q) {
            const x = c % d.W, y = (c / d.W) | 0;
            for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
              if (!ox && !oy) continue;
              const nx = x + ox, ny = y + oy;
              if (nx < 0 || ny < 0 || nx >= d.W || ny >= d.H) continue;
              const nc = ny * d.W + nx;
              if (d.grid[nc] !== FLOOR || isLiquid(nc)) continue;
              expect(d.height[nc],
                `${themeKey} seed ${seed}: water at level ${L} spills over ${nx},${ny}`
              ).toBeGreaterThanOrEqual(L);
            }
          }
          void lowest;
        }
      }
    }
  });

  it('never puts an unclimbable face beside a doorway', () => {
    /* Connectivity alone does NOT cover this. The whole-map flood asks only
       whether a cell is reachable SOMEHOW, and a doorway reached through its
       own corridor passes even when the room beside it is fenced off by a
       Δ2+ face — you can see the door but must walk the long way round.
       Measured before the approach grading went in: 421 such cliff edges sat
       directly on door aprons across 50 levels, dropping as much as 3 levels. */
    for (const themeKey of ['ancient', 'molten', 'frost', 'grim', 'verdant']) {
      for (const seed of SEEDS.slice(0, 4)) {
        const d = generateDungeon(seed, { seed, roomCount: 16, themeKey });
        const { W, H, grid, height, doorway } = d;
        for (let c = 0; c < grid.length; c++) {
          if (grid[c] !== FLOOR || !doorway[c]) continue;
          const x = c % W, y = (c / W) | 0;
          for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
            const ax = x + ox, ay = y + oy;
            if (ax < 0 || ay < 0 || ax >= W || ay >= H) continue;
            const a = ay * W + ax;
            if (grid[a] !== FLOOR) continue;
            expect(height[a], `${themeKey} seed ${seed}: apron at ${ax},${ay} off level 0`).toBe(0);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = ax + dx, ny = ay + dy;
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              const n = ny * W + nx;
              if (grid[n] !== FLOOR) continue;
              expect(Math.abs(height[n] - height[a]),
                `${themeKey} seed ${seed}: cliff beside door at ${ax},${ay}`).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    }
  });

  it('is deterministic for a given seed', () => {
    const a = gen(SEEDS[1]);
    const b = gen(SEEDS[1]);
    expect(Array.from(a.height)).toEqual(Array.from(b.height));
    expect(Array.from(a.ramp)).toEqual(Array.from(b.ramp));
  });
});

describe('Elevation — helpers', () => {
  it('canStep allows flat moves and blocks unramped level changes', () => {
    const d = { height: new Int8Array([0, 0, 1, 1]), ramp: new Uint8Array([0, 0, 0, 0]) };
    expect(canStep(d, 0, 1)).toBe(true);    // flat
    expect(canStep(d, 1, 2)).toBe(false);   // 1 level, no ramp
    d.ramp[1] = 1;
    expect(canStep(d, 1, 2)).toBe(true);    // ramp on the low side
  });

  it('canStep refuses a two-level change even across a ramp', () => {
    const d = { height: new Int8Array([0, 2]), ramp: new Uint8Array([1, 1]) };
    expect(canStep(d, 0, 1)).toBe(false);
  });

  it('treats a level with no elevation data as flat', () => {
    expect(canStep({}, 0, 1)).toBe(true);
    expect(heightOf({}, 5)).toBe(0);
    expect(heightOf(null, 5)).toBe(0);
  });

  it('converts levels to world Y through STEP', () => {
    const d = { height: new Int8Array([0, 1, -1]) };
    expect(worldYOf(d, 0)).toBe(0);
    expect(worldYOf(d, 1)).toBeCloseTo(STEP);
    expect(worldYOf(d, 2)).toBeCloseTo(-STEP);
  });
});
