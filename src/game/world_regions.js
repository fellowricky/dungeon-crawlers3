/**
 * WORLD REGIONS — what the painted world map says about a point on it.
 *
 * The map art is covered by a grid of cells (world_biomes.json), one biome
 * letter per cell, painted by hand in world_map_editor.html. Points are in art
 * percent (0–100 on each axis), the same frame quest pins use.
 *
 * A dungeon can sit wherever one of its site biomes (DUNGEON_SITES) is
 * painted: ashfield ground holds molten dungeons; ruinfield, forest and
 * sporewood hold ancient ones; mire holds grim and verdant; and so on. Moor
 * and holdfast are travel country only. Sea, lake and peaks are impassable: never a pin, never a
 * travel leg.
 *
 * Pure data + math, no DOM, so node tests can read it.
 */

import WORLD from './world_biomes.json' with { type: 'json' };
import { THRESHOLD_THEME, DUNGEON_SITES } from './threshold_themes.js';

export { WORLD, DUNGEON_SITES };
export const IMPASSABLE = new Set(['sea', 'lake', 'peaks']);

/* Below this many painted site cells a dungeon theme starts stacking its
   pins; the painter warns before it gets there. */
export const MIN_DOORSTEP_CELLS = 12;

/** Biome -> the dungeon themes that can sit on it ([] for travel-only ground). */
export const THEMES_ON_GROUND = (() => {
  const out = {};
  for (const [theme, sites] of Object.entries(DUNGEON_SITES)) {
    for (const b of sites) (out[b] ||= []).push(theme);
  }
  return out;
})();

/** Biome key of cell (c, r); null off the grid. */
export function biomeOfCell(c, r, world = WORLD) {
  if (c < 0 || r < 0 || c >= world.cols || r >= world.rows) return null;
  return world.legend[world.cells[r][c]] ?? null;
}

/** Cell under a map point in art %; null off-map. */
export function cellAt(x, y, world = WORLD) {
  if (!(x >= 0 && x <= 100 && y >= 0 && y <= 100)) return null;
  return {
    c: Math.min(world.cols - 1, Math.floor(x / 100 * world.cols)),
    r: Math.min(world.rows - 1, Math.floor(y / 100 * world.rows))
  };
}

/** Centre of cell (c, r) in art %. */
export function cellCentre(c, r, world = WORLD) {
  return { x: (c + 0.5) / world.cols * 100, y: (r + 0.5) / world.rows * 100 };
}

/** Biome key at a map point in art %; null off-map. */
export function biomeAt(x, y, world = WORLD) {
  const cell = cellAt(x, y, world);
  return cell ? biomeOfCell(cell.c, cell.r, world) : null;
}

export function isPassable(x, y, world = WORLD) {
  const b = biomeAt(x, y, world);
  return b !== null && !IMPASSABLE.has(b);
}

/** Every cell painted as one of `theme`'s site biomes, as {c, r, b} (b = biome). */
export function cellsFor(theme, world = WORLD) {
  const sites = new Set(DUNGEON_SITES[theme] || [THRESHOLD_THEME[theme]]);
  const out = [];
  for (let r = 0; r < world.rows; r++) {
    for (let c = 0; c < world.cols; c++) {
      const b = biomeOfCell(c, r, world);
      if (sites.has(b)) out.push({ c, r, b });
    }
  }
  return out;
}

/** Cell count per biome key, every legend biome present (0 when unpainted). */
export function biomeCounts(world = WORLD) {
  const counts = Object.fromEntries(Object.values(world.legend).map(b => [b, 0]));
  for (const row of world.cells) for (const ch of row) counts[world.legend[ch]]++;
  return counts;
}

/* ================= travel: hub, distance, routes ================= */

/* Time to cross one cell, relative to open moor. Roads through settled
   holdfast country are quickest; bog and snow are a slog. Distance is measured
   in this travel time, not straight-line art %, so a quest behind a mire is
   farther than one the same distance across open grass. */
export const TRAVEL_COST = {
  holdfast: 0.7, moor: 1.0, boneyard: 1.1, ruinfield: 1.2,
  forest: 1.4, ashfield: 1.4, sporewood: 1.6, mire: 1.8, snowfield: 1.8
};

/* The farthest reachable doorstep is exactly this many days out; every other
   quest scales to it. Each day on the road is one overland floor. */
export const MAX_TRAVEL_DAYS = 4;

const NEIGHBOURS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

function costOf(world, c, r) {
  const b = biomeOfCell(c, r, world);
  return b && !IMPASSABLE.has(b) ? (TRAVEL_COST[b] ?? 1) : Infinity;
}

/* Smallest binary heap of [priority, index] — Dijkstra and A* over ~6k cells. */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(p, i) {
    const a = this.a; a.push([p, i]);
    let k = a.length - 1;
    while (k > 0) {
      const up = (k - 1) >> 1;
      if (a[up][0] <= a[k][0]) break;
      [a[up], a[k]] = [a[k], a[up]]; k = up;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]]; k = m;
      }
    }
    return top;
  }
}

/** One step's travel time: the mean of the two cells' costs over the step length. */
function stepTime(world, c0, r0, c1, r1, len) {
  return len * (costOf(world, c0, r0) + costOf(world, c1, r1)) / 2;
}

/**
 * The guild hub: the cell nearest the centre of the largest connected patch
 * of painted holdfast (the settled heartland). Repainting moves it.
 */
export function findHub(world = WORLD) {
  const { cols, rows } = world;
  const seen = new Uint8Array(cols * rows);
  let best = [];
  for (let i = 0; i < cols * rows; i++) {
    if (seen[i] || biomeOfCell(i % cols, (i / cols) | 0, world) !== 'holdfast') continue;
    const comp = [], stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const k = stack.pop(), c = k % cols, r = (k / cols) | 0;
      comp.push(k);
      for (const [dc, dr] of NEIGHBOURS) {
        const nc = c + dc, nr = r + dr, n = nr * cols + nc;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows || seen[n]) continue;
        if (biomeOfCell(nc, nr, world) !== 'holdfast') continue;
        seen[n] = 1; stack.push(n);
      }
    }
    if (comp.length > best.length) best = comp;
  }
  // No holdfast painted at all: fall back to the passable cell nearest the middle.
  if (!best.length) {
    for (let i = 0; i < cols * rows; i++) if (costOf(world, i % cols, (i / cols) | 0) < Infinity) best.push(i);
  }
  const mc = best.reduce((s, k) => s + k % cols, 0) / best.length;
  const mr = best.reduce((s, k) => s + ((k / cols) | 0), 0) / best.length;
  let hub = best[0], hd = Infinity;
  for (const k of best) {
    const d = (k % cols - mc) ** 2 + (((k / cols) | 0) - mr) ** 2;
    if (d < hd) { hd = d; hub = k; }
  }
  const c = hub % cols, r = (hub / cols) | 0;
  return { c, r, ...cellCentre(c, r, world) };
}

/** Travel time from (c0, r0) to every cell (Infinity where unreachable). */
export function travelTimes(c0, r0, world = WORLD) {
  const { cols, rows } = world;
  const t = new Float64Array(cols * rows).fill(Infinity);
  const heap = new Heap();
  t[r0 * cols + c0] = 0;
  heap.push(0, r0 * cols + c0);
  while (heap.size) {
    const [d, k] = heap.pop();
    if (d > t[k]) continue;
    const c = k % cols, r = (k / cols) | 0;
    for (const [dc, dr, len] of NEIGHBOURS) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const nd = d + stepTime(world, c, r, nc, nr, len);
      const n = nr * cols + nc;
      if (nd < t[n]) { t[n] = nd; heap.push(nd, n); }
    }
  }
  return t;
}

export const HUB = findHub();
const HUB_TIMES = travelTimes(HUB.c, HUB.r);

/* Length of one day on the road: the farthest doorstep any dungeon can sit on
   is MAX_TRAVEL_DAYS of these from the hub. */
const DAY_TIME = (() => {
  let far = 0;
  for (const theme of Object.keys(THRESHOLD_THEME)) {
    for (const { c, r } of cellsFor(theme)) {
      const t = HUB_TIMES[r * WORLD.cols + c];
      if (t < Infinity && t > far) far = t;
    }
  }
  return far / MAX_TRAVEL_DAYS || 1;
})();

/** Travel time from the hub to cell (c, r); Infinity if it can't be reached. */
export function hubTime(c, r) {
  return HUB_TIMES[r * WORLD.cols + c];
}

/** Days on the road (= overland floors) from the hub to cell (c, r), 1..MAX_TRAVEL_DAYS. */
export function travelDays(c, r) {
  const t = hubTime(c, r);
  if (!(t < Infinity)) return MAX_TRAVEL_DAYS;
  return Math.max(1, Math.min(MAX_TRAVEL_DAYS, Math.ceil(t / DAY_TIME - 1e-9)));
}

/** Doorstep cells of `theme` the party can actually walk to from the hub. */
export function reachableCellsFor(theme) {
  return cellsFor(theme).filter(({ c, r }) => hubTime(c, r) < Infinity);
}

/* Seeded smooth noise in [0.7, 1.4]: one random value every NOISE_STEP cells,
   bilinearly blended. It bends each quest's road a different way through the
   same country, so two quests to one valley don't share a ruler-straight line. */
const NOISE_STEP = 6;
function noiseField(rng, world) {
  const gw = Math.ceil(world.cols / NOISE_STEP) + 2, gh = Math.ceil(world.rows / NOISE_STEP) + 2;
  const g = Array.from({ length: gw * gh }, () => 0.7 + rng() * 0.7);
  return (c, r) => {
    const fx = c / NOISE_STEP, fy = r / NOISE_STEP;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const v = (x, y) => g[y * gw + x];
    return (v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx) * (1 - ty)
      + (v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx) * ty;
  };
}

/**
 * The road from the hub to cell (c1, r1), seeded so a quest keeps its road.
 * A* over the cell grid with each cell's travel cost bent by seeded noise.
 * Returns the cells walked, hub first, or null if the cell can't be reached.
 */
export function findPath(c1, r1, rng, world = WORLD) {
  const { cols, rows } = world;
  const c0 = HUB.c, r0 = HUB.r;
  if (costOf(world, c1, r1) === Infinity) return null;
  const noise = noiseField(rng, world);
  const minStep = Math.min(...Object.values(TRAVEL_COST)) * 0.7;
  const h = (c, r) => {                         // octile distance at the cheapest possible cost: admissible
    const dx = Math.abs(c - c1), dy = Math.abs(r - r1);
    return minStep * (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy));
  };
  const g = new Float64Array(cols * rows).fill(Infinity);
  const from = new Int32Array(cols * rows).fill(-1);
  const heap = new Heap();
  const start = r0 * cols + c0, goal = r1 * cols + c1;
  g[start] = 0;
  heap.push(h(c0, r0), start);
  while (heap.size) {
    const [, k] = heap.pop();
    if (k === goal) break;
    const c = k % cols, r = (k / cols) | 0;
    for (const [dc, dr, len] of NEIGHBOURS) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const step = stepTime(world, c, r, nc, nr, len) * noise(nc, nr);
      if (step === Infinity) continue;
      const n = nr * cols + nc, nd = g[k] + step;
      if (nd < g[n]) { g[n] = nd; from[n] = k; heap.push(nd + h(nc, nr), n); }
    }
  }
  if (g[goal] === Infinity) return null;
  const path = [];
  for (let k = goal; k !== -1; k = from[k]) path.push([k % cols, (k / cols) | 0]);
  return path.reverse();
}

/**
 * Plan the journey to a quest pin for dungeon `theme`.
 *
 * The number of days comes from the hub-to-pin travel time (travelDays). The
 * road is cut into that many equal stretches of travel TIME, and each day's
 * overland floor is the biome the party spends most of that day in, holdfast
 * only if the day never leaves it. The last day always ends at the dungeon, so
 * it is the ground the pin sits on (one of the theme's DUNGEON_SITES): the
 * floor that has to sell the dungeon below it.
 *
 * Returns { days, legs: [biome per overland floor], path: [c0, r0, c1, r1, …],
 *           camps: [path index where each day but the last ends] }, or null
 * when the pin can't be reached.
 */
export function planRoute(x, y, theme, rng, world = WORLD) {
  const cell = cellAt(x, y, world);
  if (!cell) return null;
  const path = findPath(cell.c, cell.r, rng, world);
  if (!path) return null;
  const days = travelDays(cell.c, cell.r);

  // Time spent in each biome along the road, step by step: half a step in each cell's country.
  const steps = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const [c0, r0] = path[i - 1], [c1, r1] = path[i];
    const len = (c0 !== c1 && r0 !== r1) ? Math.SQRT2 : 1;
    const a = len * costOf(world, c0, r0) / 2, b = len * costOf(world, c1, r1) / 2;
    steps.push({ i, start: total, a, b, ba: biomeOfCell(c0, r0, world), bb: biomeOfCell(c1, r1, world) });
    total += a + b;
  }

  const legs = [], camps = [];
  for (let d = 0; d < days; d++) {
    const t0 = total * d / days, t1 = total * (d + 1) / days;
    const spent = {};
    for (const s of steps) {
      // Overlap of [t0, t1] with each half-step's time span.
      const ha = Math.max(0, Math.min(t1, s.start + s.a) - Math.max(t0, s.start));
      const hb = Math.max(0, Math.min(t1, s.start + s.a + s.b) - Math.max(t0, s.start + s.a));
      if (ha) spent[s.ba] = (spent[s.ba] || 0) + ha;
      if (hb) spent[s.bb] = (spent[s.bb] || 0) + hb;
    }
    /* Holdfast is the roads and the hub's home country, the fastest ground,
       so routes hug it. A day only counts as holdfast when it never leaves it;
       otherwise it is the wilder country the road passes through that day. */
    const wild = Object.entries(spent).filter(([b]) => b !== 'holdfast');
    const top = (wild.length ? wild : Object.entries(spent)).sort((p, q) => q[1] - p[1])[0];
    legs.push(top ? top[0] : 'holdfast');           // a zero-length road (pin on the hub) stays home
    if (d < days - 1) {
      const s = steps.find(st => st.start + st.a + st.b >= t1);
      camps.push(s ? s.i : path.length - 1);
    }
  }
  /* The last day is the ground the dungeon sits on: its doorstep, or for a
     theme with several sites (ancient in a forest) that forest. */
  const ground = biomeOfCell(cell.c, cell.r, world);
  legs[days - 1] = (DUNGEON_SITES[theme] || []).includes(ground)
    ? ground
    : (THRESHOLD_THEME[theme] || legs[days - 1]);

  return { days, legs, path: path.flat(), camps };
}

function shuffleWith(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Pick a pin for a dungeon of `theme`: a random reachable site cell at least
 * `minSep` cells from every taken pin (relaxed if the board is crowded),
 * jittered inside its cell. Returns {x, y} in art % or null if the theme has
 * no reachable site at all.
 *
 * A theme with several site biomes picks the biome first, evenly, then a cell
 * in it. Otherwise area decides: ancient's sites include the whole forest, which
 * would outvote its ruinfield three to one.
 */
export function pickPin(theme, rng, taken = [], minSep = 7, world = WORLD) {
  const byBiome = {};
  for (const cell of reachableCellsFor(theme)) (byBiome[cell.b] ||= []).push(cell);
  const biomes = shuffleWith(Object.keys(byBiome), rng);
  if (!biomes.length) return null;
  // Preferred biome's cells first; the others only if spacing rules them all out.
  const cells = biomes.flatMap(b => shuffleWith(byBiome[b], rng));
  const takenCells = taken.map(p => cellAt(p.x, p.y, world)).filter(Boolean);
  const clear = sep => cells.find(({ c, r }) => takenCells.every(t => Math.hypot(t.c - c, t.r - r) >= sep));
  const pick = clear(minSep) || clear(minSep / 2) || cells[0];
  const ctr = cellCentre(pick.c, pick.r, world);
  const jx = (rng() - 0.5) * 0.7 * 100 / world.cols, jy = (rng() - 0.5) * 0.7 * 100 / world.rows;
  return { x: +(ctr.x + jx).toFixed(2), y: +(ctr.y + jy).toFixed(2) };
}

/** Nearest reachable site point for `theme` to (x, y) — re-homes pins saved before the painted map. */
export function snapPin(theme, x, y, world = WORLD) {
  const here = cellAt(x, y, world);
  if (here && reachableCellsFor(theme).some(({ c, r }) => c === here.c && r === here.r)) return { x, y };
  let best = null, bd = Infinity;
  for (const { c, r } of reachableCellsFor(theme)) {
    const p = cellCentre(c, r, world);
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { x: +best.x.toFixed(2), y: +best.y.toFixed(2) } : null;
}
