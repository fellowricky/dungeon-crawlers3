/**
 * Dragonflies and butterflies. Ambiance only: no combat, no click, no collision.
 * A dragonfly hovers, darts, and glides, and often sits on a grass top.
 * A butterfly has its own flight: a slow chaotic loiter, then a weaving drift,
 * and a leaf only now and then. A living hero or monster within five tiles
 * sends either away. An in-progress flee is not retargeted. Water is open air.
 * A dry map uses open floor.
 */
import * as THREE from 'three';
import { TAU } from '../vendor/pixelfx/core/index.js';
import * as dragonflyFx from '../vendor/pixelfx/fx/critters/dragonfly.js';
import * as butterflyFx from '../vendor/pixelfx/fx/critters/butterfly.js';
import { spawnLivePixelFx, dropLivePixelFx } from './pixelfx_live.js';
import { groundY } from '../dungeon/elevation.js';
import { FLOOR, POOL } from '../game/constants.js';
import { nearestThreat } from './ambient_flyers.js';

const HERO_SPRITE_QUAD = 1.125;
/** Opaque height of a gliding dragonfly, wingtip to wingtip, in art pixels. */
export const DRAGONFLY_SPAN_PX = 36;
/** Wingspan as a fraction of a hero sprite. The abdomen is narrower than this. */
export const DRAGONFLY_SPAN_FRAC = 0.22;
export const DRAGONFLY_PX_PER_UNIT = DRAGONFLY_SPAN_PX / (HERO_SPRITE_QUAD * DRAGONFLY_SPAN_FRAC);

export const DRAGONFLY_COUNT_MIN = 2;
export const DRAGONFLY_COUNT_MAX = 3;
const COUNT_CAP = 24;
const GAP = 14;

/** Seconds spent buzzing in place between darts. */
export const HOVER_MIN = 5;
export const HOVER_MAX = 11;
/** Tiles of one dart. */
export const DART_MIN = 3;
export const DART_MAX = 6;
/** Tiles per second. Quicker than a bird's crossing. */
export const DART_SPEED = 4.5;
/** The end of a dart is a glide: wings open, still moving. */
export const GLIDE_TIME = 0.22;
/** Casual darts stay inside this radius of the spot where it spawned. */
export const HOME_R = 7;
/** Thorax height above the ground, in world units. */
export const HOVER_Y = 0.62;
const HOVER_BOB = 0.035;
/** Extra height at the middle of a dart. */
export const DART_ARC = 0.16;
/** Chance a finished hover ends on a grass tuft instead of an open dart. */
export const PERCH_CHANCE = 0.5;
/** Seconds sitting still on a grass top. About a minute. */
export const PERCH_MIN = 50;
export const PERCH_MAX = 70;
/**
 * Grass tips sit above the authored blade height. The tuft's tallest blades
 * reach about 1.25 of that height; 1.15 lands among those tips.
 */
export const GRASS_TIP = 1.15;
/** Thorax clearance above the tip, so the body sits on the grass. */
export const PERCH_LIFT = 0.03;
const GRASS_H = { swampgrass: 0.68, swampgrass2: 0.58, swampgrass3: 0.78 };

/** Opaque width of an open butterfly, wingtip to wingtip, in art pixels. */
export const BUTTERFLY_SPAN_PX = 36;
/** Wingspan as a fraction of a hero sprite. */
export const BUTTERFLY_SPAN_FRAC = 0.22;
export const BUTTERFLY_PX_PER_UNIT = BUTTERFLY_SPAN_PX / (HERO_SPRITE_QUAD * BUTTERFLY_SPAN_FRAC);
export const BUTTERFLY_COUNT_MIN = 2;
export const BUTTERFLY_COUNT_MAX = 3;
/** Seconds of chaotic loitering between drifts. This is the idle flight. */
export const BUTTERFLY_LOITER_MIN = 10;
export const BUTTERFLY_LOITER_MAX = 18;
/** Tiles of one lazy drift. */
export const BUTTERFLY_DRIFT_MIN = 2.5;
export const BUTTERFLY_DRIFT_MAX = 5.5;
/** Tiles per second. A float, much slower than a dragonfly dart. */
export const BUTTERFLY_SPEED = 1.15;
/** A flee is still a float, only a little more urgent. */
export const BUTTERFLY_FLEE_SPEED = 1.75;
/** The end of a drift holds the wings open while it keeps weaving. */
export const BUTTERFLY_GLIDE = 1.35;
/** Casual drifts stay inside this radius of the spot where it spawned. */
export const BUTTERFLY_HOME_R = 9;
/** Body height above the ground while it is in the air. */
export const BUTTERFLY_HOVER_Y = 0.84;
/** Chance a finished loiter ends on a leaf. Most outings stay in the air. */
export const BUTTERFLY_PERCH_CHANCE = 0.2;
/** Seconds sitting still. Short enough that the air time wins. */
export const BUTTERFLY_PERCH_MIN = 12;
export const BUTTERFLY_PERCH_MAX = 22;

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DEFAULT_RIGHT = [Math.SQRT1_2, 0, -Math.SQRT1_2];

const flies = [];

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

function flyRng(floorSeed, n) {
  return mulberry32(((floorSeed >>> 0) ^ Math.imul(n, 0x9E3779B9) ^ 0xD4A60) >>> 0);
}

function clampCount(n, fallback) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return fallback;
  if (x < 0) return 0;
  if (x > COUNT_CAP) return COUNT_CAP;
  return x;
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

function isPad(d, c) {
  if (!d.grid || d.grid[c] !== FLOOR) return false;
  if (d.lakeMask && d.lakeMask[c]) return false;
  if (d.solidProps && d.solidProps[c]) return false;
  return true;
}

function touchesWater(d, c) {
  const { W, H } = d;
  const x = c % W;
  const y = (c / W) | 0;
  for (const [ox, oy] of NEIGHBOURS) {
    const nx = x + ox;
    const ny = y + oy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const n = ny * W + nx;
    if (d.grid[n] === POOL) return true;
    if (d.lakeMask && d.lakeMask[n]) return true;
  }
  return false;
}

/**
 * `opts.min`–`opts.max` dragonflies. Banks of water come first. A map with
 * no water uses open floor. Same seed, same cells.
 */
export function pickDragonflyCells(d, opts) {
  if (!d || !d.grid || !d.W || !d.H) return [];
  const lo = opts && opts.min != null ? clampCount(opts.min, DRAGONFLY_COUNT_MIN) : DRAGONFLY_COUNT_MIN;
  let hi = opts && opts.max != null ? clampCount(opts.max, DRAGONFLY_COUNT_MAX) : DRAGONFLY_COUNT_MAX;
  if (lo > hi) hi = lo;
  const { W, H } = d;
  const rng = mulberry32((d.seed >>> 0) ^ 0xD4A60);
  const want = lo + ((rng() * (hi - lo + 1)) | 0);
  if (want <= 0) return [];
  const banks = [];
  const pads = [];
  for (let c = 0; c < d.grid.length; c++) {
    if (!isPad(d, c)) continue;
    pads.push(c);
    if (touchesWater(d, c)) banks.push(c);
  }
  const pool = banks.length ? banks : pads;
  if (!pool.length) return [];
  const vertical = H >= W;
  const span = vertical ? H : W;
  const bands = Array.from({ length: want }, () => []);
  for (const c of pool) {
    const along = vertical ? ((c / W) | 0) : (c % W);
    const band = Math.min(want - 1, Math.floor(along * want / span));
    bands[band].push(c);
  }
  const chosen = [];
  const separated = (c) => chosen.every((o) => {
    const dx = (c % W) - (o % W);
    const dy = ((c / W) | 0) - ((o / W) | 0);
    return dx * dx + dy * dy >= GAP * GAP;
  });
  const take = (list) => {
    for (const n of shuffled(list, rng)) if (separated(n)) return n;
    return -1;
  };
  for (const band of bands) {
    let n = take(band);
    if (n < 0) n = take(pool);
    if (n >= 0) chosen.push(n);
  }
  return chosen.map((c) => ({ cx: c % W, cy: (c / W) | 0 }));
}

/**
 * `opts.min`–`opts.max` butterflies. Floor beside a grass tuft comes first.
 * A map with no grass uses open floor. Same seed, same cells.
 */
export function pickButterflyCells(d, opts) {
  if (!d || !d.grid || !d.W || !d.H) return [];
  const lo = opts && opts.min != null ? clampCount(opts.min, BUTTERFLY_COUNT_MIN) : BUTTERFLY_COUNT_MIN;
  let hi = opts && opts.max != null ? clampCount(opts.max, BUTTERFLY_COUNT_MAX) : BUTTERFLY_COUNT_MAX;
  if (lo > hi) hi = lo;
  const { W, H } = d;
  const rng = mulberry32((d.seed >>> 0) ^ 0xB077E7);
  const want = lo + ((rng() * (hi - lo + 1)) | 0);
  if (want <= 0) return [];
  const near = new Uint8Array(d.grid.length);
  if (d.props) {
    for (const p of d.props) {
      if (!GRASS_H[p.kind]) continue;
      const cx = Math.round(p.x);
      const cy = Math.round(p.y);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const x = cx + ox;
          const y = cy + oy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          near[y * W + x] = 1;
        }
      }
    }
  }
  const beds = [];
  const pads = [];
  for (let c = 0; c < d.grid.length; c++) {
    if (!isPad(d, c)) continue;
    pads.push(c);
    if (near[c]) beds.push(c);
  }
  const pool = beds.length ? beds : pads;
  if (!pool.length) return [];
  const vertical = H >= W;
  const span = vertical ? H : W;
  const bands = Array.from({ length: want }, () => []);
  for (const c of pool) {
    const along = vertical ? ((c / W) | 0) : (c % W);
    const band = Math.min(want - 1, Math.floor(along * want / span));
    bands[band].push(c);
  }
  const chosen = [];
  const separated = (c) => chosen.every((o) => {
    const dx = (c % W) - (o % W);
    const dy = ((c / W) | 0) - ((o / W) | 0);
    return dx * dx + dy * dy >= GAP * GAP;
  });
  const take = (list) => {
    for (const n of shuffled(list, rng)) if (separated(n)) return n;
    return -1;
  };
  for (const band of bands) {
    let n = take(band);
    if (n < 0) n = take(pool);
    if (n >= 0) chosen.push(n);
  }
  return chosen.map((c) => ({ cx: c % W, cy: (c / W) | 0 }));
}

/** Grass tuft tips in world tiles. The body sits on `top`. */
export function grassPerches(d) {
  if (!d || !d.props || !d.W || !d.H) return [];
  const out = [];
  for (const p of d.props) {
    const h = GRASS_H[p.kind];
    if (!h) continue;
    out.push({
      x: p.x - d.W / 2 + 0.5,
      z: p.y - d.H / 2 + 0.5,
      top: h * (p.scale || 1) * GRASS_TIP,
    });
  }
  return out;
}

function facesLeft(dx, dz, right) {
  return dx * right[0] + dz * right[2] < 0;
}

function airClear(x0, z0, x1, z1, cellAt) {
  const dist = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.max(1, Math.ceil(dist * 2));
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    const kind = cellAt(x0 + (x1 - x0) * u, z0 + (z1 - z0) * u);
    if (kind !== 'floor' && kind !== 'pool') return false;
  }
  return true;
}

function keepsHome(fly, x, z) {
  const home = HOME_R * HOME_R;
  const dx = x - fly.homeX;
  const dz = z - fly.homeZ;
  const there = dx * dx + dz * dz;
  if (there <= home) return true;
  const hx = fly.x - fly.homeX;
  const hz = fly.z - fly.homeZ;
  const here = hx * hx + hz * hz;
  return here > home && there < here;
}

function aim(fly, rng, screenRight, cellAt, ang0, accept) {
  const dist = DART_MIN + rng() * (DART_MAX - DART_MIN);
  let ang = ang0;
  const right = screenRight || DEFAULT_RIGHT;
  for (let i = 0; i < 8; i++) {
    const x = fly.x + Math.cos(ang) * dist;
    const z = fly.z + Math.sin(ang) * dist;
    if (accept(x, z) && airClear(fly.x, fly.z, x, z, cellAt)) {
      return {
        x, z, angle: ang, dist,
        flip: facesLeft(x - fly.x, z - fly.z, right),
      };
    }
    ang += 0.8;
  }
  return null;
}

/**
 * A dart of three to six tiles through open air, or null when every try
 * hits a wall or a prop. Inside home the landing stays inside home. Past
 * home, it may land closer to home. Art faces screen-right.
 */
export function planDragonflyDart(fly, rng, screenRight, cellAt) {
  const hx = fly.homeX - fly.x;
  const hz = fly.homeZ - fly.z;
  const outside = hx * hx + hz * hz > HOME_R * HOME_R;
  const ang0 = outside ? Math.atan2(hz, hx) : rng() * TAU;
  return aim(fly, rng, screenRight, cellAt, ang0, (x, z) => keepsHome(fly, x, z));
}

/**
 * A dart straight away from one living threat. Later tries use the same
 * fan as a casual dart. The end has to be farther from the threat.
 */
export function planDragonflyFlee(fly, rng, screenRight, cellAt, threat) {
  const here = Math.hypot(fly.x - threat.x, fly.z - threat.z);
  const ang0 = Math.atan2(fly.z - threat.z, fly.x - threat.x);
  return aim(fly, rng, screenRight, cellAt, ang0, (x, z) => (
    Math.hypot(x - threat.x, z - threat.z) > here
  ));
}

function nextHover(rng) {
  return HOVER_MIN + rng() * (HOVER_MAX - HOVER_MIN);
}

function nextRest(rng) {
  return PERCH_MIN + rng() * (PERCH_MAX - PERCH_MIN);
}

/**
 * A dart onto one grass tuft inside the usual dart reach, or null when the
 * roll says to keep flying or no tuft is open. The tuft has to keep the
 * insect inside home, the same rule as a casual dart.
 */
export function planInsectPerch(fly, rng, screenRight, cellAt) {
  const perches = fly.perches;
  if (!perches || !perches.length) return null;
  if (rng() >= PERCH_CHANCE) return null;
  const open = cellAt || (() => 'floor');
  const right = screenRight || DEFAULT_RIGHT;
  const picks = [];
  for (const p of perches) {
    const dx = p.x - fly.x;
    const dz = p.z - fly.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.35 || dist > DART_MAX) continue;
    if (!keepsHome(fly, p.x, p.z)) continue;
    if (!airClear(fly.x, fly.z, p.x, p.z, open)) continue;
    picks.push({ p, dist, dx, dz });
  }
  if (!picks.length) return null;
  const hit = picks[Math.min(picks.length - 1, Math.floor(rng() * picks.length))];
  const ang = Math.atan2(hit.dz, hit.dx);
  return {
    x: hit.p.x, z: hit.p.z, angle: ang, dist: hit.dist,
    flip: facesLeft(hit.dx, hit.dz, right),
    perch: true,
    top: hit.p.top,
  };
}

function beginDart(fly, plan, flee) {
  fly.travel = {
    fromX: fly.x, fromZ: fly.z, toX: plan.x, toZ: plan.z,
    age: 0, dur: plan.dist / DART_SPEED, flee: !!flee,
    perch: !flee && !!plan.perch,
    top: plan.top || 0,
  };
  fly.angle = plan.angle;
  fly.flip = plan.flip;
  fly.hover = 0;
  fly.beat = 1;
  fly.rest = 0;
}

export function makeDragonfly(seed, x, z, rng) {
  return {
    seed, x, z, homeX: x, homeZ: z,
    angle: 0,
    clock: 0,
    hover: nextHover(rng),
    travel: null,
    beat: 1,
    flip: false,
    rng,
    handle: null,
  };
}

/** Thorax height. A dart adds a shallow arc. A hover bobs. A perch sits on the grass tip. */
export function dragonflyAltitude(fly, ground) {
  if (fly.rest > 0) return (ground || 0) + (fly.perchTop || 0) + PERCH_LIFT;
  const base = (ground || 0) + HOVER_Y;
  const tr = fly.travel;
  if (tr && tr.dur > 0 && tr.age > 0) {
    const u = Math.min(1, tr.age / tr.dur);
    return base + Math.sin(Math.PI * u) * DART_ARC;
  }
  return base + Math.sin(fly.clock * 3.2) * HOVER_BOB;
}

function syncBeat(fly) {
  const tr = fly.travel;
  if (!tr) {
    fly.beat = fly.rest > 0 ? 0 : 1;
    return;
  }
  fly.beat = tr.dur - tr.age > GLIDE_TIME ? 1 : 0;
}

/**
 * Hover, then dart. With grass tufts on the insect, about half of those
 * darts land on a tip and it sits still for about a minute. A living threat
 * within five tiles starts a dart away on this step, including off a perch.
 * The body does not move until the next one. No open air away leaves it
 * where it is, so the next step can try again.
 */
export function stepDragonfly(fly, dt, screenRight, cellAt, threats) {
  if (!(dt > 0)) return fly;
  fly.clock += dt;
  const right = screenRight || DEFAULT_RIGHT;
  const open = cellAt || (() => 'floor');
  if (!(fly.travel && fly.travel.flee)) {
    const threat = nearestThreat(fly.x, fly.z, threats);
    if (threat) {
      const plan = planDragonflyFlee(fly, fly.rng, right, open, threat);
      if (plan) beginDart(fly, plan, true);
      syncBeat(fly);
      return fly;
    }
  }
  if (fly.travel) {
    const tr = fly.travel;
    const step = Math.min(dt, tr.dur - tr.age);
    tr.age += step;
    const u = tr.dur > 0 ? tr.age / tr.dur : 1;
    const s = u * u * (3 - 2 * u);
    fly.x = tr.fromX + (tr.toX - tr.fromX) * s;
    fly.z = tr.fromZ + (tr.toZ - tr.fromZ) * s;
    fly.flip = facesLeft(tr.toX - tr.fromX, tr.toZ - tr.fromZ, right);
    if (tr.age >= tr.dur - 1e-8) {
      fly.x = tr.toX;
      fly.z = tr.toZ;
      fly.travel = null;
      if (tr.perch) {
        fly.rest = nextRest(fly.rng);
        fly.perchTop = tr.top;
        fly.hover = 0;
        fly.beat = 0;
      } else {
        fly.hover = nextHover(fly.rng);
        fly.beat = 1;
        fly.rest = 0;
        fly.perchTop = 0;
      }
    } else {
      syncBeat(fly);
    }
    return fly;
  }
  if (fly.rest > 0) {
    fly.rest -= dt;
    fly.beat = 0;
    if (fly.rest <= 0) {
      fly.rest = 0;
      fly.perchTop = 0;
      fly.hover = nextHover(fly.rng);
      fly.beat = 1;
    }
    return fly;
  }
  fly.hover -= dt;
  fly.beat = 1;
  if (fly.hover <= 0) {
    const perch = planInsectPerch(fly, fly.rng, right, open);
    const plan = perch || planDragonflyDart(fly, fly.rng, right, open);
    if (!plan) fly.hover = 0;
    else beginDart(fly, plan, false);
  }
  return fly;
}

function nextLoiter(rng) {
  return BUTTERFLY_LOITER_MIN + rng() * (BUTTERFLY_LOITER_MAX - BUTTERFLY_LOITER_MIN);
}

function nextButterflyRest(rng) {
  return BUTTERFLY_PERCH_MIN + rng() * (BUTTERFLY_PERCH_MAX - BUTTERFLY_PERCH_MIN);
}

function phaseOf(seed) {
  const n = Math.abs(seed | 0) + 1;
  return ((n * 0.6180339887) % 1) * TAU;
}

/** Idle flutter around the loiter anchor. Several rates, so it is not one bob. */
function loiterOffset(fly) {
  const t = fly.clock;
  const p = fly.phase || 0;
  return {
    x: Math.sin(t * 1.15 + p) * 0.85
      + Math.sin(t * 2.35 + p * 1.7) * 0.4
      + Math.sin(t * 0.47 + p * 0.3) * 0.45,
    z: Math.cos(t * 0.95 + p * 1.3) * 0.8
      + Math.sin(t * 2.05 + p * 2.4) * 0.42
      + Math.sin(t * 3.4 + p) * 0.22,
  };
}

function floatLift(t, phase) {
  return Math.sin(t * 0.85 + phase) * 0.26
    + Math.sin(t * 2.2 + phase * 1.4) * 0.12
    + Math.cos(t * 1.35 + phase * 0.5) * 0.1;
}

/**
 * Point on a drift. The weave is zero at both ends, so it leaves and arrives
 * on the chord. In between, two swings push it off the line.
 */
export function butterflyDriftPoint(tr, u, phase) {
  const s = u * u * (3 - 2 * u);
  const env = Math.sin(Math.PI * u);
  const dx = tr.toX - tr.fromX;
  const dz = tr.toZ - tr.fromZ;
  const len = Math.hypot(dx, dz) || 1;
  const side = (
    Math.sin(u * TAU + phase) * 1.1
    + Math.sin(u * TAU * 3 + phase * 2) * 0.55
  ) * env;
  return {
    x: tr.fromX + dx * s + (-dz / len) * side,
    z: tr.fromZ + dz * s + (dx / len) * side,
  };
}

function keepsButterflyHome(fly, x, z) {
  const home = BUTTERFLY_HOME_R * BUTTERFLY_HOME_R;
  const dx = x - fly.homeX;
  const dz = z - fly.homeZ;
  const there = dx * dx + dz * dz;
  if (there <= home) return true;
  const hx = fly.x - fly.homeX;
  const hz = fly.z - fly.homeZ;
  return hx * hx + hz * hz > home && there < hx * hx + hz * hz;
}

function aimButterfly(fly, rng, screenRight, cellAt, ang0, accept) {
  const dist = BUTTERFLY_DRIFT_MIN + rng() * (BUTTERFLY_DRIFT_MAX - BUTTERFLY_DRIFT_MIN);
  let ang = ang0;
  const right = screenRight || DEFAULT_RIGHT;
  for (let i = 0; i < 8; i++) {
    const x = fly.x + Math.cos(ang) * dist;
    const z = fly.z + Math.sin(ang) * dist;
    if (accept(x, z) && airClear(fly.x, fly.z, x, z, cellAt)) {
      return {
        x, z, angle: ang, dist,
        flip: facesLeft(x - fly.x, z - fly.z, right),
      };
    }
    ang += 0.8;
  }
  return null;
}

/** A slow drift through open air, or null when every try is blocked. */
export function planButterflyDrift(fly, rng, screenRight, cellAt) {
  const hx = fly.homeX - fly.x;
  const hz = fly.homeZ - fly.z;
  const outside = hx * hx + hz * hz > BUTTERFLY_HOME_R * BUTTERFLY_HOME_R;
  const ang0 = outside ? Math.atan2(hz, hx) : rng() * TAU;
  return aimButterfly(fly, rng, screenRight, cellAt, ang0, (x, z) => keepsButterflyHome(fly, x, z));
}

/** A drift away from one living threat. The end has to be farther away. */
export function planButterflyFlee(fly, rng, screenRight, cellAt, threat) {
  const here = Math.hypot(fly.x - threat.x, fly.z - threat.z);
  const ang0 = Math.atan2(fly.z - threat.z, fly.x - threat.x);
  return aimButterfly(fly, rng, screenRight, cellAt, ang0, (x, z) => (
    Math.hypot(x - threat.x, z - threat.z) > here
  ));
}

/** A drift onto one grass tip, or null when this outing stays in the air. */
export function planButterflyPerch(fly, rng, screenRight, cellAt) {
  const perches = fly.perches;
  if (!perches || !perches.length) return null;
  if (rng() >= BUTTERFLY_PERCH_CHANCE) return null;
  const open = cellAt || (() => 'floor');
  const right = screenRight || DEFAULT_RIGHT;
  const picks = [];
  for (const p of perches) {
    const dx = p.x - fly.x;
    const dz = p.z - fly.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.35 || dist > BUTTERFLY_DRIFT_MAX) continue;
    if (!keepsButterflyHome(fly, p.x, p.z)) continue;
    if (!airClear(fly.x, fly.z, p.x, p.z, open)) continue;
    picks.push({ p, dist, dx, dz });
  }
  if (!picks.length) return null;
  const hit = picks[Math.min(picks.length - 1, Math.floor(rng() * picks.length))];
  const ang = Math.atan2(hit.dz, hit.dx);
  return {
    x: hit.p.x, z: hit.p.z, angle: ang, dist: hit.dist,
    flip: facesLeft(hit.dx, hit.dz, right),
    perch: true,
    top: hit.p.top,
  };
}

function beginLoiter(fly, rng) {
  const off = loiterOffset(fly);
  fly.anchorX = fly.x - off.x;
  fly.anchorZ = fly.z - off.z;
  fly.hover = nextLoiter(rng);
  fly.beat = 1;
  fly.rest = 0;
  fly.perchTop = 0;
}

function beginFloat(fly, plan, flee) {
  fly.travel = {
    fromX: fly.x, fromZ: fly.z, toX: plan.x, toZ: plan.z,
    age: 0,
    dur: plan.dist / (flee ? BUTTERFLY_FLEE_SPEED : BUTTERFLY_SPEED),
    flee: !!flee,
    perch: !flee && !!plan.perch,
    top: plan.top || 0,
  };
  fly.angle = plan.angle;
  fly.flip = plan.flip;
  fly.hover = 0;
  fly.beat = 1;
  fly.rest = 0;
}

export function makeButterfly(seed, x, z, rng) {
  const fly = {
    kind: 'butterfly',
    seed, x, z, homeX: x, homeZ: z,
    anchorX: x, anchorZ: z,
    phase: phaseOf(seed),
    angle: 0,
    clock: 0,
    hover: nextLoiter(rng),
    travel: null,
    beat: 1,
    flip: false,
    rest: 0,
    perchTop: 0,
    rng,
    handle: null,
  };
  const off = loiterOffset(fly);
  fly.anchorX = x - off.x;
  fly.anchorZ = z - off.z;
  return fly;
}

/** Height while aloft. A drift adds a second uneven lift. A perch sits on the tip. */
export function butterflyAltitude(fly, ground) {
  if (fly.rest > 0) return (ground || 0) + (fly.perchTop || 0) + PERCH_LIFT;
  const base = (ground || 0) + BUTTERFLY_HOVER_Y + floatLift(fly.clock, fly.phase || 0);
  const tr = fly.travel;
  if (tr && tr.dur > 0 && tr.age > 0) {
    const u = Math.min(1, tr.age / tr.dur);
    const env = Math.sin(Math.PI * u);
    const lift = (
      Math.sin(u * TAU * 1.6 + (fly.phase || 0)) * 0.28
      + Math.sin(u * TAU * 3.3 + (fly.phase || 0) * 1.7) * 0.16
    ) * env;
    return base + lift;
  }
  return base;
}

function syncButterflyBeat(fly) {
  const tr = fly.travel;
  if (!tr) {
    fly.beat = fly.rest > 0 ? 0 : 1;
    return;
  }
  fly.beat = tr.dur - tr.age > BUTTERFLY_GLIDE ? 1 : 0;
}

function applyLoiter(fly, right, open) {
  const off = loiterOffset(fly);
  const nx = fly.anchorX + off.x;
  const nz = fly.anchorZ + off.z;
  const kind = open(nx, nz);
  if (kind !== 'floor' && kind !== 'pool') return;
  fly.flip = facesLeft(nx - fly.x, nz - fly.z, right);
  fly.x = nx;
  fly.z = nz;
}

/**
 * Loiter in a chaotic flutter, then drift. A leaf is the rare outing.
 * A living threat within five tiles starts a drift away on this step.
 * The body does not move until the next one. No open air leaves it loitering.
 */
export function stepButterfly(fly, dt, screenRight, cellAt, threats) {
  if (!(dt > 0)) return fly;
  fly.clock += dt;
  const right = screenRight || DEFAULT_RIGHT;
  const open = cellAt || (() => 'floor');
  if (!(fly.travel && fly.travel.flee)) {
    const threat = nearestThreat(fly.x, fly.z, threats);
    if (threat) {
      const plan = planButterflyFlee(fly, fly.rng, right, open, threat);
      if (plan) beginFloat(fly, plan, true);
      syncButterflyBeat(fly);
      return fly;
    }
  }
  if (fly.travel) {
    const tr = fly.travel;
    const step = Math.min(dt, tr.dur - tr.age);
    tr.age += step;
    const u = tr.dur > 0 ? Math.min(1, tr.age / tr.dur) : 1;
    const at = butterflyDriftPoint(tr, u, fly.phase || 0);
    fly.x = at.x;
    fly.z = at.z;
    fly.flip = facesLeft(tr.toX - tr.fromX, tr.toZ - tr.fromZ, right);
    if (tr.age >= tr.dur - 1e-8) {
      fly.x = tr.toX;
      fly.z = tr.toZ;
      fly.travel = null;
      if (tr.perch) {
        fly.rest = nextButterflyRest(fly.rng);
        fly.perchTop = tr.top;
        fly.hover = 0;
        fly.beat = 0;
      } else {
        beginLoiter(fly, fly.rng);
      }
    } else {
      syncButterflyBeat(fly);
    }
    return fly;
  }
  if (fly.rest > 0) {
    fly.rest -= dt;
    fly.beat = 0;
    if (fly.rest <= 0) {
      fly.rest = 0;
      fly.perchTop = 0;
      beginLoiter(fly, fly.rng);
    }
    return fly;
  }
  applyLoiter(fly, right, open);
  fly.hover -= dt;
  fly.beat = 1;
  if (fly.hover <= 0) {
    const perch = planButterflyPerch(fly, fly.rng, right, open);
    const plan = perch || planButterflyDrift(fly, fly.rng, right, open);
    if (!plan) fly.hover = 0;
    else beginFloat(fly, plan, false);
  }
  return fly;
}

export function clearAmbientInsects() {
  for (const fly of flies) dropLivePixelFx(fly.handle && fly.handle.mesh);
  flies.length = 0;
}

export function ambientInsectCounts() {
  let dragonflies = 0;
  let butterflies = 0;
  for (const fly of flies) {
    if (fly.kind === 'butterfly') butterflies += 1;
    else dragonflies += 1;
  }
  return { dragonflies, butterflies };
}

function settleOnGrass(fly, rng, chance = 0.45, restFor = nextRest) {
  if (!fly.perches || !fly.perches.length) return;
  if (rng() >= chance) return;
  let best = null;
  let bestD = 2.5;
  for (const p of fly.perches) {
    const dist = Math.hypot(p.x - fly.x, p.z - fly.z);
    if (dist < bestD) {
      best = p;
      bestD = dist;
    }
  }
  if (!best) return;
  fly.x = best.x;
  fly.z = best.z;
  fly.rest = restFor(rng);
  fly.perchTop = best.top;
  fly.beat = 0;
  fly.hover = 0;
}

const INSECT_FX = {
  dragonfly: { mod: dragonflyFx, px: DRAGONFLY_PX_PER_UNIT, name: 'ambient-dragonfly' },
  butterfly: { mod: butterflyFx, px: BUTTERFLY_PX_PER_UNIT, name: 'ambient-butterfly' },
};

/** Plans are `{ x, z, seed, kind }` in world tiles. */
export function mountAmbientInsects(scene, plans, floorSeed, d) {
  if (!scene || !plans || !plans.length) return 0;
  const perches = grassPerches(d);
  for (const plan of plans) {
    const kind = plan.kind === 'butterfly' ? 'butterfly' : 'dragonfly';
    const spec = INSECT_FX[kind];
    const rng = flyRng(floorSeed, plan.seed);
    const fly = kind === 'butterfly'
      ? makeButterfly(plan.seed, plan.x, plan.z, rng)
      : makeDragonfly(plan.seed, plan.x, plan.z, rng);
    fly.kind = kind;
    fly.perches = perches;
    if (kind === 'butterfly') settleOnGrass(fly, rng, 0.12, nextButterflyRest);
    else settleOnGrass(fly, rng);
    const ground = d ? groundY(d, fly.x, fly.z) : 0;
    const height = kind === 'butterfly' ? butterflyAltitude(fly, ground) : dragonflyAltitude(fly, ground);
    const handle = spawnLivePixelFx(scene, spec.mod, {
      pos: new THREE.Vector3(fly.x, height, fly.z),
      pxPerUnit: spec.px,
      renderOrder: 9,
      fadeIn: 0,
      options: { seed: plan.seed, beat: fly.beat, flip: false, rest: fly.rest > 0 ? 1 : 0 },
    });
    handle.mesh.raycast = () => {};
    handle.mesh.name = spec.name;
    fly.handle = handle;
    flies.push(fly);
  }
  return plans.length;
}

export function tickAmbientInsects(dt, right, world) {
  if (!(dt > 0) || !flies.length) return;
  const cellAt = (world && world.cellAt) || (() => 'floor');
  const groundAt = (world && world.groundAt) || (() => 0);
  const threats = world && world.threats;
  const r = right || DEFAULT_RIGHT;
  for (const fly of flies) {
    const butterfly = fly.kind === 'butterfly';
    if (butterfly) stepButterfly(fly, dt, r, cellAt, threats);
    else stepDragonfly(fly, dt, r, cellAt, threats);
    const mesh = fly.handle && fly.handle.mesh;
    if (!mesh) continue;
    const ground = groundAt(fly.x, fly.z);
    const y = butterfly ? butterflyAltitude(fly, ground) : dragonflyAltitude(fly, ground);
    mesh.position.set(fly.x, y, fly.z);
    const opt = fly.handle.options;
    if (!opt) continue;
    opt.flip = fly.flip;
    opt.beat = fly.beat;
    opt.rest = fly.rest > 0 ? 1 : 0;
    opt.seed = fly.seed;
  }
}

export function shadeAmbientInsects(shade, dt) {
  if (typeof shade !== 'function') return;
  for (const fly of flies) {
    const mesh = fly.handle && fly.handle.mesh;
    if (!mesh) continue;
    shade(mesh, mesh.position.x, mesh.position.y, mesh.position.z, dt);
  }
}
