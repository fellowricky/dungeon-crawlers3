/**
 * Multi-tile liquid bodies.
 *
 * Liquids used to be single POOL tiles; they now grow into pools, rivers and
 * lava flows. POOL is not walkable, so the property that actually matters is
 * that a body never STRANDS floor — the tests below generate each map twice
 * (once with liquids disabled) and diff reachability from the entrance.
 */
import { describe, it, expect } from 'vitest';
import { generateDungeon, THEMES, FLOOR, POOL } from '../src/dungeon/dungeon_generator.js';

const DUNGEON_THEMES = ['molten', 'frost', 'grim', 'verdant'];
const OVERLAND = Object.keys(THEMES).filter(k => THEMES[k].overland);
const SEEDS = [7919, 15838, 23757];

const isOverland = k => !!THEMES[k].overland;
const build = (themeKey, seed) => isOverland(themeKey)
  ? generateDungeon({ seed, themeKey, mapW: 71, mapH: 113, zones: 8 })
  : generateDungeon({ seed, themeKey, roomCount: 40 });

/** FLOOR cells reachable from `start` (4-way). */
function flood(grid, W, start) {
  const seen = new Uint8Array(grid.length);
  if (start < 0 || grid[start] !== FLOOR) return seen;
  const st = [start];
  seen[start] = 1;
  while (st.length) {
    const c = st.pop();
    const x = c % W;
    for (const nb of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
      if (nb < 0 || nb >= grid.length || seen[nb] || grid[nb] !== FLOOR) continue;
      seen[nb] = 1; st.push(nb);
    }
  }
  return seen;
}

const entranceCell = d => d.rooms[d.entrance].cy * d.W + d.rooms[d.entrance].cx;

/** Same map with every liquid source switched off, for use as a control. */
function buildWithoutLiquids(themeKey, seed) {
  const th = THEMES[themeKey];
  const amt = th.pools ? th.pools.amount : undefined;
  const pits = th.pools ? th.pools.pits : undefined;
  const liq = th.oc ? th.oc.liquid : undefined;
  if (th.pools) { th.pools.amount = 0; th.pools.pits = 0; }
  if (th.oc) th.oc.liquid = undefined;
  try {
    return build(themeKey, seed);
  } finally {
    if (th.pools) { th.pools.amount = amt; th.pools.pits = pits; }
    if (th.oc) th.oc.liquid = liq;
  }
}

/** Sizes of the connected POOL bodies on a map. */
function bodySizes(d) {
  const { grid, W } = d;
  const seen = new Set();
  const sizes = [];
  for (const p of d.pools) {
    const c = p.y * W + p.x;
    if (seen.has(c)) continue;
    let n = 0;
    const st = [c];
    seen.add(c);
    while (st.length) {
      const k = st.pop(); n++;
      for (const nb of [k + 1, k - 1, k + W, k - W]) {
        if (nb < 0 || nb >= grid.length || seen.has(nb) || grid[nb] !== POOL) continue;
        seen.add(nb); st.push(nb);
      }
    }
    sizes.push(n);
  }
  return sizes;
}

describe('liquids — multi-tile bodies', () => {
  it('dungeon themes generate bodies several tiles across, not single tiles', () => {
    for (const theme of DUNGEON_THEMES) {
      const sizes = SEEDS.flatMap(s => bodySizes(build(theme, s)));
      expect(sizes.length, `${theme}: generated no liquid at all`).toBeGreaterThan(0);
      const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      expect(avg, `${theme}: average body size`).toBeGreaterThan(2);
      expect(Math.max(...sizes), `${theme}: largest body`).toBeGreaterThan(4);
    }
  });

  it('every overland biome gets liquid bodies (it had none before)', () => {
    for (const theme of OVERLAND) {
      const sizes = SEEDS.flatMap(s => bodySizes(build(theme, s)));
      expect(sizes.length, `${theme}: generated no liquid at all`).toBeGreaterThan(0);
      const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      expect(avg, `${theme}: average body size`).toBeGreaterThan(3);
    }
  });

  it('bodies never fall below the theme-configured minimum size', () => {
    /* a lone tile means growth silently failed and we regressed to the old
       single-tile behaviour */
    for (const theme of [...DUNGEON_THEMES, ...OVERLAND]) {
      const singles = SEEDS.flatMap(s => bodySizes(build(theme, s))).filter(n => n === 1);
      expect(singles.length, `${theme}: ${singles.length} single-tile pools`).toBe(0);
    }
  });
});

describe('liquids — connectivity', () => {
  /* The dangerous case: liquid is not walkable, so a body across a room or a
     road can fence the party off from the stairs. */
  it('never strands floor that was reachable without liquids', () => {
    for (const theme of [...DUNGEON_THEMES, ...OVERLAND]) {
      for (const seed of SEEDS) {
        const ctrl = buildWithoutLiquids(theme, seed);
        const live = build(theme, seed);
        const baseSeen = flood(ctrl.grid, ctrl.W, entranceCell(ctrl));
        const liveSeen = flood(live.grid, live.W, entranceCell(live));

        let stranded = 0;
        for (let i = 0; i < live.grid.length; i++) {
          if (!baseSeen[i]) continue;              // wasn't reachable anyway
          if (live.grid[i] === POOL) continue;     // consumed by a body — expected
          if (!liveSeen[i]) stranded++;
        }
        expect(stranded, `${theme} seed ${seed}: ${stranded} cells cut off by liquid`).toBe(0);
      }
    }
  });

  it('leaves the entrance and the boss room walkable', () => {
    for (const theme of [...DUNGEON_THEMES, ...OVERLAND]) {
      for (const seed of SEEDS) {
        const d = build(theme, seed);
        const ent = d.rooms[d.entrance], boss = d.rooms[d.boss];
        expect(d.grid[ent.cy * d.W + ent.cx], `${theme} seed ${seed}: entrance`).toBe(FLOOR);
        expect(d.grid[boss.cy * d.W + boss.cx], `${theme} seed ${seed}: boss`).toBe(FLOOR);
      }
    }
  });
});
