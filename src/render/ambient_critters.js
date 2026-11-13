/**
 * Ambient critters. They are not creatures: no combat, no click, no collision.
 * The party walks through them. Moor frogs, a few moor snakes, moor
 * dragonflies, forest birds, boneyard bats, ash and ruin skinks, and
 * snowfield squirrels.
 *
 * The frog picture is the vendored pixelfx frog: throat puff, blink, crouch,
 * leap. The fly, the tongue, and the dust puffs are left out of that copy.
 * Frogs sit on the banks of moor water and slide during that leap.
 *
 * The snake picture keeps the forked tongue flicking on its own clock. The
 * body lies flat until the snake crawls, and only then do the humps roll.
 *
 * A living hero or monster within five tiles sends a frog hopping away at
 * its next crouch, a snake crawling away, a dragonfly or butterfly darting
 * away, a bat to another tree, and a skink or squirrel dashing away. A bird
 * already leaves the same way. Other critters are not threats.
 *
 * onDungeon spawns them after clearEffects. That call drops every live
 * pixelfx sprite, so a frog created while the level mesh is built would vanish.
 * The dungeon editor forges through the same spawn, so a retune shows where
 * they landed. Moor turns on the frogs, the snakes, and the dragonflies.
 * The forest turns on the birds and the butterflies, and the boneyard turns
 * on the bats. Ash and the ruins turn on the skinks. The snowfield turns on
 * the squirrels. Every other theme stays empty until its Critters tab says
 * otherwise. Saved rates live on the theme as `critters`.
 */
import * as THREE from 'three';
import { wrap, TAU } from '../vendor/pixelfx/core/index.js';
import * as frogFx from '../vendor/pixelfx/fx/critters/frog.js';
import * as snakeFx from '../vendor/pixelfx/fx/critters/snake.js';
import { spawnLivePixelFx, dropLivePixelFx } from './pixelfx_live.js';
import { groundY } from '../dungeon/elevation.js';
import { THEMES } from '../dungeon/dungeon_generator.js';
import { FLOOR, POOL } from '../game/constants.js';
import { cameraBasisFromMatrix } from '../game/span_ribbon.js';
import {
  FLYER_COUNT_MIN, FLYER_COUNT_MAX,
  planAmbientFlyers, mountAmbientFlyers, tickAmbientFlyers,
  clearAmbientFlyers, ambientFlyerCounts, shadeAmbientFlyers,
  nearestThreat,
} from './ambient_flyers.js';
import {
  DRAGONFLY_COUNT_MIN, DRAGONFLY_COUNT_MAX,
  BUTTERFLY_COUNT_MIN, BUTTERFLY_COUNT_MAX,
  pickDragonflyCells, pickButterflyCells, mountAmbientInsects, tickAmbientInsects,
  clearAmbientInsects, ambientInsectCounts, shadeAmbientInsects,
} from './ambient_insects.js';
import {
  SKINK_COUNT_MIN, SKINK_COUNT_MAX,
  SQUIRREL_COUNT_MIN, SQUIRREL_COUNT_MAX,
  pickSkinkCells, pickSquirrelSpots, skinkCoat, openGround,
  mountGroundlings, tickGroundlings, clearGroundlings,
  ambientGroundlingCounts, shadeGroundlings,
} from './ambient_groundlings.js';

/** A standard hero billboard is 1.125 world units for a 64px cell. */
export const HERO_SPRITE_QUAD = 1.125;
/** Sitting body, feet to the top of the head, in the frog's art pixels. */
export const FROG_BODY_PX = 24;
/**
 * Body height as a fraction of a hero sprite. The hop sits in the same canvas;
 * sizing the whole 112×88 frame would shrink the frog to a speck.
 */
export const FROG_BODY_FRAC = 0.22;
export const FROG_PX_PER_UNIT = FROG_BODY_PX / (HERO_SPRITE_QUAD * FROG_BODY_FRAC);

/** Each pool on a moor rolls this chance to get one frog on its bank. */
export const WATER_SPAWN_CHANCE = 0.1;
export const FROG_LOOP = frogFx.meta.duration;
export const T_CROUCH = 0.95;
export const T_UP = 1.2;
export const T_LAND = 1.62;
export const HOP_MIN = 0.35;
export const HOP_MAX = 0.55;
export const HOME_R = 2.4;
export const STAY_CHANCE = 0.35;

/** Opaque length of the snake, tail to snout, in art pixels. The tongue sticks out past this. */
export const SNAKE_LEN_PX = 84;
/**
 * Length as a fraction of a hero sprite. Long enough that the tongue still
 * reads, short of a hero. The body is only a few pixels thick.
 */
export const SNAKE_LEN_FRAC = 0.56;
export const SNAKE_PX_PER_UNIT = SNAKE_LEN_PX / (HERO_SPRITE_QUAD * SNAKE_LEN_FRAC);
/** How many snakes a moor rolls. One roll for the whole map. */
export const SNAKE_COUNT_MIN = 2;
export const SNAKE_COUNT_MAX = 3;
const CRITTER_COUNT_CAP = 24;

/**
 * Kind defaults, then the theme row, then THEMES[key].critters. A theme with
 * no row keeps every kind off, so a dungeon stays empty until the editor
 * enables one. Moor matches the frog, snake, and dragonfly rates above.
 * Forest birds and butterflies, and boneyard bats, use the same two-or-three count.
 * Ash and ruin skinks, and snowfield squirrels, do too.
 */
const CRITTER_DEFAULTS = {
  frog: { enabled: false, chance: WATER_SPAWN_CHANCE },
  snake: { enabled: false, min: SNAKE_COUNT_MIN, max: SNAKE_COUNT_MAX },
  dragonfly: { enabled: false, min: DRAGONFLY_COUNT_MIN, max: DRAGONFLY_COUNT_MAX },
  butterfly: { enabled: false, min: BUTTERFLY_COUNT_MIN, max: BUTTERFLY_COUNT_MAX },
  bird: { enabled: false, min: FLYER_COUNT_MIN, max: FLYER_COUNT_MAX },
  bat: { enabled: false, min: FLYER_COUNT_MIN, max: FLYER_COUNT_MAX },
  skink: { enabled: false, min: SKINK_COUNT_MIN, max: SKINK_COUNT_MAX },
  squirrel: { enabled: false, min: SQUIRREL_COUNT_MIN, max: SQUIRREL_COUNT_MAX },
};
const CRITTER_THEME_DEFAULTS = {
  moor: {
    frog: { enabled: true, chance: WATER_SPAWN_CHANCE },
    snake: { enabled: true, min: SNAKE_COUNT_MIN, max: SNAKE_COUNT_MAX },
    dragonfly: { enabled: true, min: DRAGONFLY_COUNT_MIN, max: DRAGONFLY_COUNT_MAX },
  },
  forest: {
    bird: { enabled: true, min: FLYER_COUNT_MIN, max: FLYER_COUNT_MAX },
    butterfly: { enabled: true, min: BUTTERFLY_COUNT_MIN, max: BUTTERFLY_COUNT_MAX },
  },
  boneyard: {
    bat: { enabled: true, min: FLYER_COUNT_MIN, max: FLYER_COUNT_MAX },
  },
  ashfield: {
    skink: { enabled: true, min: SKINK_COUNT_MIN, max: SKINK_COUNT_MAX },
  },
  ruinfield: {
    skink: { enabled: true, min: SKINK_COUNT_MIN, max: SKINK_COUNT_MAX },
  },
  snowfield: {
    squirrel: { enabled: true, min: SQUIRREL_COUNT_MIN, max: SQUIRREL_COUNT_MAX },
  },
};

function clampChance(n, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function clampCount(n, fallback) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return fallback;
  if (x < 0) return 0;
  if (x > CRITTER_COUNT_CAP) return CRITTER_COUNT_CAP;
  return x;
}

function pickBool(over, base, fallback) {
  if (over != null) return !!over;
  if (base != null) return !!base;
  return fallback;
}

function countKind(over, base, defaults) {
  let min = over.min != null ? over.min : (base.min != null ? base.min : defaults.min);
  let max = over.max != null ? over.max : (base.max != null ? base.max : defaults.max);
  min = clampCount(min, defaults.min);
  max = clampCount(max, defaults.max);
  if (min > max) max = min;
  return {
    enabled: pickBool(over.enabled, base.enabled, defaults.enabled),
    min,
    max,
  };
}

/** Resolved critter settings for one theme. `override` wins per field. */
export function crittersFor(themeKey, override) {
  const base = CRITTER_THEME_DEFAULTS[themeKey] || {};
  const over = override && typeof override === 'object' ? override : {};
  const frogBase = base.frog || {};
  const frogOver = over.frog || {};
  const frogChance = frogOver.chance != null ? frogOver.chance
    : (frogBase.chance != null ? frogBase.chance : CRITTER_DEFAULTS.frog.chance);
  const kind = (name) => countKind(over[name] || {}, base[name] || {}, CRITTER_DEFAULTS[name]);
  return {
    frog: {
      enabled: pickBool(frogOver.enabled, frogBase.enabled, CRITTER_DEFAULTS.frog.enabled),
      chance: clampChance(frogChance, CRITTER_DEFAULTS.frog.chance),
    },
    snake: kind('snake'),
    dragonfly: kind('dragonfly'),
    butterfly: kind('butterfly'),
    bird: kind('bird'),
    bat: kind('bat'),
    skink: kind('skink'),
    squirrel: kind('squirrel'),
  };
}
/** Seconds spent still, tongue flicking, between crawls. */
export const SNAKE_REST_MIN = 18;
export const SNAKE_REST_MAX = 34;
/** Tiles to the next patch of grass. */
export const SNAKE_STEP_MIN = 4;
export const SNAKE_STEP_MAX = 5;
/** Tiles per second while crawling. A crossing takes a few body-waves. */
export const SNAKE_SPEED = 0.9;
const SEPARATION = 4;
const SNAKE_GAP = 16;
const ROAD_KEEP = 2;
const FEET_Y = 0.02;
/** Screen-right of the default dungeon camera (yaw π/4). */
const DEFAULT_RIGHT = [Math.SQRT1_2, 0, -Math.SQRT1_2];

const frogs = [];
const snakes = [];
let dungeon = null;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function frogRng(floorSeed, n) {
  return mulberry32(((floorSeed >>> 0) ^ Math.imul(n, 0x9E3779B9) ^ 0xF4065) >>> 0);
}

function snakeRng(floorSeed, n) {
  return mulberry32(((floorSeed >>> 0) ^ Math.imul(n, 0x9E3779B9) ^ 0x5A4E5) >>> 0);
}

/** Same phase the frog effect paints: seed 1 is the authored loop, later seeds slip. */
export function frogPhase(clock, seed) {
  return wrap(clock + (seed - 1) * 0.618 * FROG_LOOP, FROG_LOOP);
}

/** True when forward playback, including a loop wrap, passes `mark`. */
export function phaseCrossed(prev, phase, mark) {
  if (phase >= prev) return prev < mark && phase >= mark;
  return prev < mark || phase >= mark;
}

export function worldOf(d, cx, cy) {
  return { x: cx - d.W / 2 + 0.5, z: cy - d.H / 2 + 0.5 };
}

/** Inverse of worldOf. Matches Game.cellOf in game.js. */
export function cellIndex(d, x, z) {
  const cx = Math.round(x + d.W / 2 - 0.5);
  const cy = Math.round(z + d.H / 2 - 0.5);
  if (cx < 0 || cy < 0 || cx >= d.W || cy >= d.H) return -1;
  return cy * d.W + cx;
}

function themeOf(d) {
  return (d && (d.params?.themeKey || d.themeKey)) || '';
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function isWater(d, c) {
  if (d.grid[c] === POOL) return true;
  return !!(d.lakeMask && d.lakeMask[c]);
}

function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/**
 * One frog on the bank of each pool that rolls under `chance` (default 10%).
 * Pools anywhere on the map qualify: peat, lake, or any other water cell.
 * Same seed, same cells. The theme gate lives in pickMoorFrogCells; this
 * places frogs on whatever map the caller hands it.
 */
export function pickFrogCells(d, chance = WATER_SPAWN_CHANCE) {
  if (!d || !d.grid || !d.W || !d.H) return [];
  const roll = clampChance(chance, WATER_SPAWN_CHANCE);
  const { W, H, grid } = d;
  const solid = d.solidProps;
  const seen = new Uint8Array(grid.length);
  const bodies = [];
  for (let c = 0; c < grid.length; c++) {
    if (seen[c] || !isWater(d, c)) continue;
    const body = [];
    const stack = [c];
    seen[c] = 1;
    while (stack.length) {
      const cur = stack.pop();
      body.push(cur);
      const x = cur % W;
      const y = (cur / W) | 0;
      for (const [ox, oy] of NEIGHBOURS) {
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (seen[n] || !isWater(d, n)) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    bodies.push(body);
  }
  const rng = mulberry32((d.seed >>> 0) ^ 0xF4065);
  const chosen = [];
  const separated = (c) => chosen.every((o) => {
    const dx = (c % W) - (o % W), dy = ((c / W) | 0) - ((o / W) | 0);
    return dx * dx + dy * dy >= SEPARATION * SEPARATION;
  });
  for (const body of bodies) {
    if (rng() >= roll) continue;
    const banks = [];
    const marked = new Uint8Array(grid.length);
    for (const c of body) {
      const x = c % W, y = (c / W) | 0;
      for (const [ox, oy] of NEIGHBOURS) {
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (marked[n]) continue;
        marked[n] = 1;
        if (isWater(d, n) || grid[n] !== FLOOR) continue;
        if (solid && solid[n]) continue;
        banks.push(n);
      }
    }
    for (const n of shuffled(banks, rng)) {
      if (!separated(n)) continue;
      chosen.push(n);
      break;
    }
  }
  return chosen.map((c) => ({ cx: c % W, cy: (c / W) | 0 }));
}

/** Moor only. Other themes return []. */
export function pickMoorFrogCells(d, chance = WATER_SPAWN_CHANCE) {
  if (themeOf(d) !== 'moor') return [];
  return pickFrogCells(d, chance);
}

/** Floor that is not water, not a solid prop, and not the track itself. */
function isGrass(d, c) {
  if (!d.grid || d.grid[c] !== FLOOR) return false;
  if (isWater(d, c)) return false;
  if (d.solidProps && d.solidProps[c]) return false;
  const rd = d.roadDist;
  if (rd && rd[c] >= 0 && rd[c] <= ROAD_KEEP) return false;
  return true;
}

/**
 * `opts.min`–`opts.max` snakes, spread along the map, each on open grass.
 * Omitted bounds roll two or three. Same seed, same cells. A map with no
 * grass returns []. The theme gate lives in pickMoorSnakeCells.
 */
export function pickSnakeCells(d, opts) {
  if (!d || !d.grid || !d.W || !d.H) return [];
  const lo = opts && opts.min != null ? clampCount(opts.min, SNAKE_COUNT_MIN) : SNAKE_COUNT_MIN;
  let hi = opts && opts.max != null ? clampCount(opts.max, SNAKE_COUNT_MAX) : SNAKE_COUNT_MAX;
  if (lo > hi) hi = lo;
  const { W, H } = d;
  const rng = mulberry32((d.seed >>> 0) ^ 0x5A4E5);
  const spanCount = hi - lo + 1;
  const want = lo + ((rng() * spanCount) | 0);
  if (want <= 0) return [];
  const grass = [];
  for (let c = 0; c < d.grid.length; c++) if (isGrass(d, c)) grass.push(c);
  if (!grass.length) return [];
  const vertical = H >= W;
  const span = vertical ? H : W;
  const bands = Array.from({ length: want }, () => []);
  for (const c of grass) {
    const along = vertical ? ((c / W) | 0) : (c % W);
    const band = Math.min(want - 1, Math.floor(along * want / span));
    bands[band].push(c);
  }
  const chosen = [];
  const separated = (c) => chosen.every((o) => {
    const dx = (c % W) - (o % W), dy = ((c / W) | 0) - ((o / W) | 0);
    return dx * dx + dy * dy >= SNAKE_GAP * SNAKE_GAP;
  });
  const take = (list) => {
    for (const n of shuffled(list, rng)) if (separated(n)) return n;
    return -1;
  };
  for (const band of bands) {
    let n = take(band);
    if (n < 0) n = take(grass);
    if (n >= 0) chosen.push(n);
  }
  return chosen.map((c) => ({ cx: c % W, cy: (c / W) | 0 }));
}

/** Moor only. Other themes return []. */
export function pickMoorSnakeCells(d) {
  if (themeOf(d) !== 'moor') return [];
  return pickSnakeCells(d);
}

/** Screen-right of the dungeon camera, so a billboard frog faces its hop. */
export function screenRightOf(camera) {
  if (camera && camera.matrixWorld && camera.matrixWorld.elements) {
    if (typeof camera.updateMatrixWorld === 'function') camera.updateMatrixWorld();
    const right = cameraBasisFromMatrix(camera.matrixWorld.elements).right;
    if (Math.hypot(right[0], right[2]) > 1e-4) return right;
  }
  return DEFAULT_RIGHT;
}

function facesLeft(dx, dz, right) {
  return dx * right[0] + dz * right[2] < 0;
}

/** Squared distance from the frog's bank. */
function homeDist2(frog, x, z) {
  const dx = x - frog.homeX;
  const dz = z - frog.homeZ;
  return dx * dx + dz * dz;
}

/**
 * A landing on floor is kept when it stays inside home. A frog that has
 * already hopped past the bank may also land closer to home.
 */
function hopKeepsHome(frog, x, z) {
  const home = HOME_R * HOME_R;
  const there = homeDist2(frog, x, z);
  if (there <= home) return true;
  const here = homeDist2(frog, frog.x, frog.z);
  return here > home && there < here;
}

/**
 * A short hop, or null when every try lands in a pool, a wall, or a prop.
 * `cellAt` returns 'floor' or anything else. Art faces screen-right, so
 * flip when the hop goes screen-left.
 */
export function planFrogHop(frog, rng, screenRight, cellAt) {
  const dist = HOP_MIN + rng() * (HOP_MAX - HOP_MIN);
  let ang = frog.angle;
  const right = screenRight || DEFAULT_RIGHT;
  for (let i = 0; i < 5; i++) {
    const x = frog.x + Math.cos(ang) * dist;
    const z = frog.z + Math.sin(ang) * dist;
    if (hopKeepsHome(frog, x, z) && cellAt(x, z) === 'floor') {
      return {
        x, z, angle: ang, dist,
        flip: facesLeft(x - frog.x, z - frog.z, right),
      };
    }
    ang += 1.25;
  }
  return null;
}

/**
 * A hop away from one living threat. The first try is straight away
 * (atan2 of the ground offset). Later tries fan by the same step as a
 * casual hop, and only a floor landing that ends farther away is kept.
 * Home is ignored, so the frog can leave the bank.
 */
export function planFrogFlee(frog, rng, screenRight, cellAt, threat) {
  const dist = HOP_MIN + rng() * (HOP_MAX - HOP_MIN);
  let ang = Math.atan2(frog.z - threat.z, frog.x - threat.x);
  const right = screenRight || DEFAULT_RIGHT;
  const here = Math.hypot(frog.x - threat.x, frog.z - threat.z);
  for (let i = 0; i < 5; i++) {
    const x = frog.x + Math.cos(ang) * dist;
    const z = frog.z + Math.sin(ang) * dist;
    const there = Math.hypot(x - threat.x, z - threat.z);
    if (there > here && cellAt(x, z) === 'floor') {
      return {
        x, z, angle: ang, dist,
        flip: facesLeft(x - frog.x, z - frog.z, right),
      };
    }
    ang += 1.25;
  }
  return null;
}

export function makeFrog(seed, x, z, angle, rng) {
  return {
    seed, x, z, homeX: x, homeZ: z, angle,
    clock: 0,
    phase: frogPhase(0, seed),
    hop: null,
    flip: false,
    rng,
    handle: null,
  };
}

function cellKind(d, x, z) {
  if (!d || !d.grid) return 'out';
  const c = cellIndex(d, x, z);
  if (c < 0) return 'out';
  if (d.solidProps && d.solidProps[c]) return 'solid';
  const g = d.grid[c];
  if (g === POOL) return 'pool';
  if (g === FLOOR) return 'floor';
  return 'wall';
}

function moveHop(frog, prev, phase) {
  const hop = frog.hop;
  if (!hop) return;
  const wrapped = phase < prev;
  if (!wrapped && phase >= T_UP && phase < T_LAND) {
    const q = (phase - T_UP) / (T_LAND - T_UP);
    const s = q * q * (3 - 2 * q);
    frog.x = hop.fromX + (hop.toX - hop.fromX) * s;
    frog.z = hop.fromZ + (hop.toZ - hop.fromZ) * s;
    return;
  }
  const reached = !wrapped && phase >= T_LAND;
  const jumpedPast = wrapped && prev >= T_UP;
  if (reached || jumpedPast) {
    frog.x = hop.toX;
    frog.z = hop.toZ;
    frog.hop = null;
    frog.angle += 0.9;
  }
}

/**
 * One critter step. `cellAt(x, z)` classifies the landing. A living threat
 * within five tiles skips the croak and aims the next hop away. The slide
 * still waits for the leap in the sprite, so this crouch does not move it.
 */
export function stepFrog(frog, dt, screenRight, cellAt, threats) {
  if (!(dt > 0)) return frog;
  const prev = frog.phase;
  frog.clock += dt;
  const phase = frogPhase(frog.clock, frog.seed);
  frog.phase = phase;
  if (phaseCrossed(prev, phase, T_CROUCH)) {
    const threat = nearestThreat(frog.x, frog.z, threats);
    if (threat) {
      const plan = planFrogFlee(frog, frog.rng, screenRight, cellAt, threat);
      if (plan) {
        frog.hop = { fromX: frog.x, fromZ: frog.z, toX: plan.x, toZ: plan.z };
        frog.angle = plan.angle;
        frog.flip = plan.flip;
      } else {
        frog.hop = null;
      }
    } else if (frog.rng() < STAY_CHANCE) {
      frog.hop = null;
    } else {
      const plan = planFrogHop(frog, frog.rng, screenRight, cellAt);
      if (plan) {
        frog.hop = { fromX: frog.x, fromZ: frog.z, toX: plan.x, toZ: plan.z };
        frog.angle = plan.angle;
        frog.flip = plan.flip;
      } else {
        frog.hop = null;
        frog.angle += 1.25;
      }
    }
  }
  moveHop(frog, prev, phase);
  // The picture is a camera-facing card. Re-aim it if the camera orbits mid-hop.
  if (frog.hop) {
    frog.flip = facesLeft(
      frog.hop.toX - frog.hop.fromX,
      frog.hop.toZ - frog.hop.fromZ,
      screenRight || DEFAULT_RIGHT,
    );
  }
  return frog;
}

/** 'grass' is open floor. The track, water, walls, and props are not a patch of grass. */
export function snakeGround(d, x, z) {
  const kind = cellKind(d, x, z);
  if (kind !== 'floor') return kind;
  const c = cellIndex(d, x, z);
  const rd = d && d.roadDist;
  if (rd && rd[c] >= 0 && rd[c] <= ROAD_KEEP) return 'road';
  return 'grass';
}

function crawlClear(x0, z0, x1, z1, groundAt) {
  const dist = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.max(1, Math.ceil(dist * 2));
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    if (groundAt(x0 + (x1 - x0) * u, z0 + (z1 - z0) * u) !== 'grass') return false;
  }
  return true;
}

/**
 * A straight crawl of four or five tiles onto grass, or null when every try
 * crosses the track, water, a wall, or a prop. Art faces screen-right.
 */
export function planSnakeCrawl(snake, rng, screenRight, groundAt) {
  const dist = SNAKE_STEP_MIN + rng() * (SNAKE_STEP_MAX - SNAKE_STEP_MIN);
  let ang = rng() * TAU;
  const right = screenRight || DEFAULT_RIGHT;
  for (let i = 0; i < 8; i++) {
    const x = snake.x + Math.cos(ang) * dist;
    const z = snake.z + Math.sin(ang) * dist;
    if (crawlClear(snake.x, snake.z, x, z, groundAt)) {
      return {
        x, z, angle: ang, dist,
        flip: facesLeft(x - snake.x, z - snake.z, right),
      };
    }
    ang += 0.8;
  }
  return null;
}

/**
 * A crawl of four or five tiles straight away from one living threat.
 * Later tries use the same fan as a casual crawl. The path has to be grass,
 * and the end has to be farther from the threat.
 */
export function planSnakeFlee(snake, rng, screenRight, groundAt, threat) {
  const dist = SNAKE_STEP_MIN + rng() * (SNAKE_STEP_MAX - SNAKE_STEP_MIN);
  let ang = Math.atan2(snake.z - threat.z, snake.x - threat.x);
  const right = screenRight || DEFAULT_RIGHT;
  const here = Math.hypot(snake.x - threat.x, snake.z - threat.z);
  for (let i = 0; i < 8; i++) {
    const x = snake.x + Math.cos(ang) * dist;
    const z = snake.z + Math.sin(ang) * dist;
    const there = Math.hypot(x - threat.x, z - threat.z);
    if (there > here && crawlClear(snake.x, snake.z, x, z, groundAt)) {
      return {
        x, z, angle: ang, dist,
        flip: facesLeft(x - snake.x, z - snake.z, right),
      };
    }
    ang += 0.8;
  }
  return null;
}

function nextRest(rng) {
  return SNAKE_REST_MIN + rng() * (SNAKE_REST_MAX - SNAKE_REST_MIN);
}

/** Seconds to ease the body from flat into a slither, and back down as it arrives. */
const WAVE_EASE = 0.35;

function crawlWave(snake) {
  const tr = snake.travel;
  if (!tr) return 0;
  const into = Math.min(1, tr.age / WAVE_EASE);
  const left = Math.max(0, tr.dur - tr.age);
  const out = Math.min(1, left / WAVE_EASE);
  return Math.min(into, out);
}

export function makeSnake(seed, x, z, angle, rng) {
  return {
    seed, x, z, angle,
    slither: 0,
    wave: 0,
    flick: 0,
    rest: nextRest(rng),
    travel: null,
    flip: facesLeft(Math.cos(angle), Math.sin(angle), DEFAULT_RIGHT),
    rng,
    handle: null,
  };
}

/**
 * Tongue time always advances. The body lies flat until a crawl, then the
 * humps ease in. A living threat within five tiles starts a crawl away on
 * this step. The body does not move until the next one, and a flee already
 * underway is not retargeted. No open grass away leaves the snake where it
 * is, so the next step can try again.
 */
export function stepSnake(snake, dt, screenRight, groundAt, threats) {
  if (!(dt > 0)) return snake;
  snake.flick += dt;
  const right = screenRight || DEFAULT_RIGHT;
  if (!(snake.travel && snake.travel.flee)) {
    const threat = nearestThreat(snake.x, snake.z, threats);
    if (threat) {
      const plan = planSnakeFlee(snake, snake.rng, right, groundAt, threat);
      if (plan) {
        snake.travel = {
          fromX: snake.x, fromZ: snake.z, toX: plan.x, toZ: plan.z,
          age: 0, dur: plan.dist / SNAKE_SPEED, flee: true,
        };
        snake.angle = plan.angle;
        snake.flip = plan.flip;
        snake.rest = 0;
        snake.wave = crawlWave(snake);
        return snake;
      }
      if (!snake.travel) {
        snake.wave = 0;
        return snake;
      }
    }
  }
  if (snake.travel) {
    const tr = snake.travel;
    const step = Math.min(dt, tr.dur - tr.age);
    tr.age += step;
    snake.slither += step;
    const u = tr.dur > 0 ? tr.age / tr.dur : 1;
    const s = u * u * (3 - 2 * u);
    snake.x = tr.fromX + (tr.toX - tr.fromX) * s;
    snake.z = tr.fromZ + (tr.toZ - tr.fromZ) * s;
    snake.flip = facesLeft(tr.toX - tr.fromX, tr.toZ - tr.fromZ, right);
    if (tr.age >= tr.dur - 1e-8) {
      snake.x = tr.toX;
      snake.z = tr.toZ;
      snake.travel = null;
      snake.rest = nextRest(snake.rng);
    }
  } else {
    snake.rest -= dt;
    if (snake.rest <= 0) {
      const plan = planSnakeCrawl(snake, snake.rng, right, groundAt);
      if (!plan) {
        snake.rest = SNAKE_REST_MIN;
      } else {
        snake.travel = {
          fromX: snake.x, fromZ: snake.z, toX: plan.x, toZ: plan.z,
          age: 0, dur: plan.dist / SNAKE_SPEED,
        };
        snake.angle = plan.angle;
        snake.flip = plan.flip;
        snake.rest = 0;
      }
    }
  }
  snake.wave = crawlWave(snake);
  return snake;
}

/** Drop the critters. Their sprites are disposed here so a later live-fx clear cannot free them twice. */
export function clearAmbientCritters() {
  for (const frog of frogs) dropLivePixelFx(frog.handle && frog.handle.mesh);
  for (const snake of snakes) dropLivePixelFx(snake.handle && snake.handle.mesh);
  clearAmbientFlyers();
  clearAmbientInsects();
  clearGroundlings();
  frogs.length = 0;
  snakes.length = 0;
  dungeon = null;
}

/** How many ambient critters are in the scene right now. */
export function ambientCritterCounts() {
  const fly = ambientFlyerCounts();
  const bugs = ambientInsectCounts();
  const ground = ambientGroundlingCounts();
  return {
    frogs: frogs.length,
    snakes: snakes.length,
    dragonflies: bugs.dragonflies,
    butterflies: bugs.butterflies,
    birds: fly.birds,
    bats: fly.bats,
    skinks: ground.skinks,
    squirrels: ground.squirrels,
  };
}

/**
 * Frogs on water banks, snakes on grass, birds or bats in the trees, skinks
 * on open stone, and squirrels at a tree foot, for themes that enable them.
 * A theme override on THEMES[key].critters wins, which is how the editor
 * retunes a rate without rebuilding the module.
 */
export function spawnAmbientCritters(scene, d) {
  clearAmbientCritters();
  if (!scene || !d) return 0;
  const key = themeOf(d);
  const cfg = crittersFor(key, THEMES[key] && THEMES[key].critters);
  const frogCells = cfg.frog.enabled ? pickFrogCells(d, cfg.frog.chance) : [];
  const snakeCells = cfg.snake.enabled ? pickSnakeCells(d, cfg.snake) : [];
  const bugCells = cfg.dragonfly.enabled ? pickDragonflyCells(d, cfg.dragonfly) : [];
  const wingCells = cfg.butterfly.enabled ? pickButterflyCells(d, cfg.butterfly) : [];
  const skinkCells = cfg.skink.enabled ? pickSkinkCells(d, cfg.skink) : [];
  const squirrelSpots = cfg.squirrel.enabled ? pickSquirrelSpots(d, cfg.squirrel) : [];
  const plans = planAmbientFlyers(d, cfg);
  const groundPlans = [];
  for (let i = 0; i < skinkCells.length; i++) {
    const at = worldOf(d, skinkCells[i].cx, skinkCells[i].cy);
    groundPlans.push({ x: at.x, z: at.z, seed: i + 1, kind: 'skink', coat: skinkCoat(key) });
  }
  for (let i = 0; i < squirrelSpots.length; i++) {
    const spot = squirrelSpots[i];
    groundPlans.push({ x: spot.x, z: spot.z, seed: i + 1, kind: 'squirrel' });
  }
  if (!frogCells.length && !snakeCells.length && !bugCells.length && !wingCells.length && !plans.length && !groundPlans.length) return 0;
  dungeon = d;
  for (let i = 0; i < frogCells.length; i++) {
    const seed = i + 1;
    const { x, z } = worldOf(d, frogCells[i].cx, frogCells[i].cy);
    const rng = frogRng(d.seed, seed);
    const frog = makeFrog(seed, x, z, rng() * TAU, rng);
    const handle = spawnLivePixelFx(scene, frogFx, {
      pos: new THREE.Vector3(x, groundY(d, x, z) + FEET_Y, z),
      pxPerUnit: FROG_PX_PER_UNIT,
      renderOrder: 9,
      fadeIn: 0,
      options: { seed },
    });
    handle.mesh.raycast = () => {};
    handle.mesh.name = 'ambient-frog';
    frog.handle = handle;
    frogs.push(frog);
  }
  for (let i = 0; i < snakeCells.length; i++) {
    const seed = i + 1;
    const { x, z } = worldOf(d, snakeCells[i].cx, snakeCells[i].cy);
    const rng = snakeRng(d.seed, seed);
    const snake = makeSnake(seed, x, z, rng() * TAU, rng);
    const handle = spawnLivePixelFx(scene, snakeFx, {
      pos: new THREE.Vector3(x, groundY(d, x, z) + FEET_Y, z),
      pxPerUnit: SNAKE_PX_PER_UNIT,
      renderOrder: 9,
      fadeIn: 0,
      options: { seed, slither: snake.slither, wave: snake.wave, flick: snake.flick },
    });
    handle.mesh.raycast = () => {};
    handle.mesh.name = 'ambient-snake';
    snake.handle = handle;
    snakes.push(snake);
  }
  const bugPlans = bugCells.map((cell, i) => {
    const at = worldOf(d, cell.cx, cell.cy);
    return { x: at.x, z: at.z, seed: i + 1, kind: 'dragonfly' };
  });
  const wingPlans = wingCells.map((cell, i) => {
    const at = worldOf(d, cell.cx, cell.cy);
    return { x: at.x, z: at.z, seed: i + 1, kind: 'butterfly' };
  });
  mountAmbientInsects(scene, bugPlans.concat(wingPlans), d.seed, d);
  mountAmbientFlyers(scene, plans, d.seed, d);
  mountGroundlings(scene, groundPlans, d);
  return frogs.length + snakes.length + bugPlans.length + wingPlans.length + plans.length + groundPlans.length;
}

/** Living heroes and monsters. A downed body does not send a critter away. */
export function ambientThreats(actors) {
  const out = [];
  if (!actors) return out;
  const take = (list, monster) => {
    if (!list) return;
    for (const e of list) {
      if (!e || !Number.isFinite(e.x) || !Number.isFinite(e.z)) continue;
      if (monster && e.active === false) continue;
      if (e.dead) continue;
      if (e.data && !(e.data.hp > 0)) continue;
      out.push({ x: e.x, z: e.z });
    }
  };
  take(actors.heroes, false);
  take(actors.monsters, true);
  return out;
}

/** Slide and turn the critters, then the live-fx redraw paints the new frame. */
export function tickAmbientCritters(dt, camera, actors) {
  const fly = ambientFlyerCounts();
  const bugs = ambientInsectCounts();
  const ground = ambientGroundlingCounts();
  if (!(dt > 0) || (!frogs.length && !snakes.length && !bugs.dragonflies && !bugs.butterflies && !fly.birds && !fly.bats && !ground.skinks && !ground.squirrels)) return;
  const right = screenRightOf(camera);
  const threats = ambientThreats(actors);
  for (const frog of frogs) {
    stepFrog(frog, dt, right, (x, z) => cellKind(dungeon, x, z), threats);
    const mesh = frog.handle && frog.handle.mesh;
    if (!mesh) continue;
    mesh.position.set(frog.x, (dungeon ? groundY(dungeon, frog.x, frog.z) : 0) + FEET_Y, frog.z);
    if (frog.handle.options) frog.handle.options.flip = frog.flip;
  }
  for (const snake of snakes) {
    stepSnake(snake, dt, right, (x, z) => snakeGround(dungeon, x, z), threats);
    const mesh = snake.handle && snake.handle.mesh;
    if (!mesh) continue;
    mesh.position.set(snake.x, (dungeon ? groundY(dungeon, snake.x, snake.z) : 0) + FEET_Y, snake.z);
    if (snake.handle.options) {
      snake.handle.options.flip = snake.flip;
      snake.handle.options.slither = snake.slither;
      snake.handle.options.wave = snake.wave;
      snake.handle.options.flick = snake.flick;
    }
  }
  tickAmbientInsects(dt, right, {
    cellAt: (x, z) => cellKind(dungeon, x, z),
    groundAt: (x, z) => (dungeon ? groundY(dungeon, x, z) : 0),
    threats,
  });
  tickAmbientFlyers(dt, right, { d: dungeon, threats });
  tickGroundlings(dt, right, {
    openAt: (x, z) => openGround(dungeon, x, z),
    groundAt: (x, z) => (dungeon ? groundY(dungeon, x, z) : 0),
    threats,
  });
}

/**
 * Tint frogs, snakes, dragonflies, butterflies, birds, bats, skinks, and squirrels with the same light as a hero.
 * The game registers this walker. This file does not import the lighting
 * module, so the critter tests stay free of the scene.
 */
export function shadeAmbientCritters(shade, dt) {
  if (typeof shade !== 'function') return;
  const visit = (list) => {
    for (const critter of list) {
      const mesh = critter.handle && critter.handle.mesh;
      if (!mesh) continue;
      shade(mesh, mesh.position.x, mesh.position.y, mesh.position.z, dt);
    }
  };
  visit(frogs);
  visit(snakes);
  shadeAmbientInsects(shade, dt);
  shadeAmbientFlyers(shade, dt);
  shadeGroundlings(shade, dt);
}
