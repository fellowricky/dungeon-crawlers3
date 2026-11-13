/**
 * Skinks and squirrels. Ambiance only: no combat, no click, no collision.
 * A skink basks on open stone in the ash and the ruins, then scuttles a few
 * tiles. A squirrel sits at the foot of a snowfield tree, then dashes to
 * another. A living hero or monster within five tiles sends either away.
 * An in-progress flee is not retargeted.
 */
import * as THREE from 'three';
import { TAU } from '../vendor/pixelfx/core/index.js';
import * as skinkFx from '../vendor/pixelfx/fx/critters/skink.js';
import * as squirrelFx from '../vendor/pixelfx/fx/critters/squirrel.js';
import { spawnLivePixelFx, dropLivePixelFx } from './pixelfx_live.js';
import { groundY } from '../dungeon/elevation.js';
import { FLOOR, POOL } from '../game/constants.js';
import { nearestThreat } from './ambient_flyers.js';

const HERO_SPRITE_QUAD = 1.125;
/** Opaque length of a basking skink, tail to snout. */
export const SKINK_LEN_PX = 32;
/** Length as a fraction of a hero sprite. Low and short of a snake. */
export const SKINK_LEN_FRAC = 0.26;
export const SKINK_PX_PER_UNIT = SKINK_LEN_PX / (HERO_SPRITE_QUAD * SKINK_LEN_FRAC);
export const SKINK_COUNT_MIN = 2;
export const SKINK_COUNT_MAX = 3;
/** Seconds spent basking between scuttles. */
export const SKINK_BASK_MIN = 16;
export const SKINK_BASK_MAX = 28;
/** Tiles of one scuttle. */
export const SKINK_STEP_MIN = 3;
export const SKINK_STEP_MAX = 4;
/** Tiles per second. A short lizard dart. */
export const SKINK_SPEED = 1.6;

/** Sitting height of a squirrel, feet to the top of the curled tail. */
export const SQUIRREL_BODY_PX = 17;
/** Height as a fraction of a hero sprite. */
export const SQUIRREL_BODY_FRAC = 0.2;
export const SQUIRREL_PX_PER_UNIT = SQUIRREL_BODY_PX / (HERO_SPRITE_QUAD * SQUIRREL_BODY_FRAC);
export const SQUIRREL_COUNT_MIN = 2;
export const SQUIRREL_COUNT_MAX = 3;
/** Seconds spent sitting between dashes. */
export const SQUIRREL_SIT_MIN = 8;
export const SQUIRREL_SIT_MAX = 16;
/** Tiles of one dash. */
export const SQUIRREL_DASH_MIN = 4;
export const SQUIRREL_DASH_MAX = 7;
/** Tiles per second. Quicker than the skink, still on the ground. */
export const SQUIRREL_SPEED = 2.4;

const COUNT_CAP = 24;
const GAP = 16;
const ROAD_KEEP = 2;
const FEET_Y = 0.02;
const DEFAULT_RIGHT = [Math.SQRT1_2, 0, -Math.SQRT1_2];
const FOOT_OFFSETS = [[0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]];

const skinks = [];
const squirrels = [];

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

function cellIndex(d, x, z) {
  const cx = Math.round(x + d.W / 2 - 0.5);
  const cy = Math.round(z + d.H / 2 - 0.5);
  if (cx < 0 || cy < 0 || cx >= d.W || cy >= d.H) return -1;
  return cy * d.W + cx;
}

function isOpenCell(d, c) {
  if (!d.grid || d.grid[c] !== FLOOR) return false;
  if (d.lakeMask && d.lakeMask[c]) return false;
  if (d.grid[c] === POOL) return false;
  if (d.solidProps && d.solidProps[c]) return false;
  const rd = d.roadDist;
  if (rd && rd[c] >= 0 && rd[c] <= ROAD_KEEP) return false;
  return true;
}

/** 'open' is floor off the road. Water, walls, and props are not a landing. */
export function openGround(d, x, z) {
  if (!d || !d.grid) return 'out';
  const c = cellIndex(d, x, z);
  if (c < 0) return 'out';
  if (d.solidProps && d.solidProps[c]) return 'solid';
  if (d.grid[c] === POOL || (d.lakeMask && d.lakeMask[c])) return 'pool';
  if (d.grid[c] !== FLOOR) return 'wall';
  const rd = d.roadDist;
  if (rd && rd[c] >= 0 && rd[c] <= ROAD_KEEP) return 'road';
  return 'open';
}

function facesLeft(dx, dz, right) {
  return dx * right[0] + dz * right[2] < 0;
}

function pathClear(x0, z0, x1, z1, openAt) {
  const dist = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.max(1, Math.ceil(dist * 2));
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    if (openAt(x0 + (x1 - x0) * u, z0 + (z1 - z0) * u) !== 'open') return false;
  }
  return true;
}

function pickSpread(d, opts, loDef, hiDef, salt) {
  if (!d || !d.grid || !d.W || !d.H) return [];
  const lo = opts && opts.min != null ? clampCount(opts.min, loDef) : loDef;
  let hi = opts && opts.max != null ? clampCount(opts.max, hiDef) : hiDef;
  if (lo > hi) hi = lo;
  const rng = mulberry32((d.seed >>> 0) ^ salt);
  const want = lo + ((rng() * (hi - lo + 1)) | 0);
  if (want <= 0) return [];
  const pads = [];
  for (let c = 0; c < d.grid.length; c++) if (isOpenCell(d, c)) pads.push(c);
  if (!pads.length) return [];
  const { W, H } = d;
  const vertical = H >= W;
  const span = vertical ? H : W;
  const bands = Array.from({ length: want }, () => []);
  for (const c of pads) {
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
    if (n < 0) n = take(pads);
    if (n >= 0) chosen.push(n);
  }
  return chosen.map((c) => ({ cx: c % W, cy: (c / W) | 0 }));
}

/** Ash and ruin stone. Two or three on open floor, off the road, never on lava or water. */
export function pickSkinkCells(d, opts) {
  return pickSpread(d, opts, SKINK_COUNT_MIN, SKINK_COUNT_MAX, 0x5A11C);
}

export function skinkCoat(themeKey) {
  return themeKey === 'ashfield' ? 'ash' : 'ruin';
}

function worldOf(d, cx, cy) {
  return { x: cx - d.W / 2 + 0.5, z: cy - d.H / 2 + 0.5 };
}

function treePoints(d) {
  if (!d || !d.perches) return [];
  const out = [];
  for (const p of d.perches) {
    if (!p) continue;
    if (Number.isFinite(p.x) && Number.isFinite(p.z)) out.push({ x: p.x, z: p.z });
    else if (Number.isFinite(p.cx) && Number.isFinite(p.cy)) out.push(worldOf(d, p.cx, p.cy));
  }
  return out;
}

function footBeside(d, tree) {
  for (const [dx, dz] of FOOT_OFFSETS) {
    const x = tree.x + dx;
    const z = tree.z + dz;
    if (openGround(d, x, z) === 'open') return { x, z };
  }
  return null;
}

/**
 * Two or three squirrels at the foot of a snowfield tree. A map with fewer
 * than two usable trees falls back to open snow.
 */
export function pickSquirrelSpots(d, opts) {
  if (!d || !d.grid || !d.W || !d.H) return [];
  const lo = opts && opts.min != null ? clampCount(opts.min, SQUIRREL_COUNT_MIN) : SQUIRREL_COUNT_MIN;
  let hi = opts && opts.max != null ? clampCount(opts.max, SQUIRREL_COUNT_MAX) : SQUIRREL_COUNT_MAX;
  if (lo > hi) hi = lo;
  const rng = mulberry32((d.seed >>> 0) ^ 0x5A911);
  const want = lo + ((rng() * (hi - lo + 1)) | 0);
  if (want <= 0) return [];
  const feet = [];
  for (const tree of treePoints(d)) {
    const foot = footBeside(d, tree);
    if (foot) feet.push(foot);
  }
  const chosen = [];
  const separated = (spot) => chosen.every((o) => {
    const dx = spot.x - o.x;
    const dz = spot.z - o.z;
    return dx * dx + dz * dz >= GAP * GAP;
  });
  if (feet.length >= 2) {
    for (const spot of shuffled(feet, rng)) {
      if (chosen.length >= want) break;
      if (separated(spot)) chosen.push(spot);
    }
  }
  if (chosen.length < want) {
    const cells = pickSpread(d, { min: want, max: want }, want, want, 0x5A912 ^ ((d.seed >>> 0) & 0xffff));
    for (const cell of cells) {
      if (chosen.length >= want) break;
      const at = worldOf(d, cell.cx, cell.cy);
      if (separated(at)) chosen.push(at);
    }
  }
  return chosen.slice(0, want);
}

function aimStep(critter, rng, screenRight, openAt, min, max, ang0, accept) {
  const dist = min + rng() * (max - min);
  let ang = ang0;
  const right = screenRight || DEFAULT_RIGHT;
  for (let i = 0; i < 8; i++) {
    const x = critter.x + Math.cos(ang) * dist;
    const z = critter.z + Math.sin(ang) * dist;
    if (accept(x, z) && pathClear(critter.x, critter.z, x, z, openAt)) {
      return {
        x, z, angle: ang, dist,
        flip: facesLeft(x - critter.x, z - critter.z, right),
      };
    }
    ang += 0.8;
  }
  return null;
}

/** A scuttle of three or four tiles across open stone, or null. */
export function planSkinkScuttle(skink, rng, screenRight, openAt) {
  const ang0 = rng() * TAU;
  return aimStep(skink, rng, screenRight, openAt, SKINK_STEP_MIN, SKINK_STEP_MAX, ang0, () => true);
}

/** A scuttle away from one living threat. The end has to be farther. */
export function planSkinkFlee(skink, rng, screenRight, openAt, threat) {
  const here = Math.hypot(skink.x - threat.x, skink.z - threat.z);
  const ang0 = Math.atan2(skink.z - threat.z, skink.x - threat.x);
  return aimStep(skink, rng, screenRight, openAt, SKINK_STEP_MIN, SKINK_STEP_MAX, ang0, (x, z) => (
    Math.hypot(x - threat.x, z - threat.z) > here
  ));
}

function beginRun(critter, plan, speed, flee) {
  critter.travel = {
    fromX: critter.x, fromZ: critter.z, toX: plan.x, toZ: plan.z,
    age: 0, dur: plan.dist / speed, flee: !!flee,
  };
  critter.angle = plan.angle;
  critter.flip = plan.flip;
  critter.rest = 0;
}

export function makeSkink(seed, x, z, rng) {
  return {
    kind: 'skink',
    seed, x, z,
    angle: 0,
    blink: 0,
    step: 0,
    rest: SKINK_BASK_MIN + rng() * (SKINK_BASK_MAX - SKINK_BASK_MIN),
    travel: null,
    flip: false,
    rng,
    handle: null,
  };
}

/**
 * The blink clock always advances. The legs stay still until a scuttle.
 * A living threat within five tiles starts a scuttle away on this step.
 * The body does not move until the next one.
 */
export function stepSkink(skink, dt, screenRight, openAt, threats) {
  if (!(dt > 0)) return skink;
  skink.blink += dt;
  const right = screenRight || DEFAULT_RIGHT;
  const open = openAt || (() => 'open');
  if (!(skink.travel && skink.travel.flee)) {
    const threat = nearestThreat(skink.x, skink.z, threats);
    if (threat) {
      const plan = planSkinkFlee(skink, skink.rng, right, open, threat);
      if (plan) {
        beginRun(skink, plan, SKINK_SPEED, true);
        return skink;
      }
      if (!skink.travel) return skink;
    }
  }
  if (skink.travel) {
    const tr = skink.travel;
    const step = Math.min(dt, tr.dur - tr.age);
    tr.age += step;
    skink.step += step;
    const u = tr.dur > 0 ? tr.age / tr.dur : 1;
    const s = u * u * (3 - 2 * u);
    skink.x = tr.fromX + (tr.toX - tr.fromX) * s;
    skink.z = tr.fromZ + (tr.toZ - tr.fromZ) * s;
    skink.flip = facesLeft(tr.toX - tr.fromX, tr.toZ - tr.fromZ, right);
    if (tr.age >= tr.dur - 1e-8) {
      skink.x = tr.toX;
      skink.z = tr.toZ;
      skink.travel = null;
      skink.rest = SKINK_BASK_MIN + skink.rng() * (SKINK_BASK_MAX - SKINK_BASK_MIN);
    }
    return skink;
  }
  skink.rest -= dt;
  if (skink.rest <= 0) {
    const plan = planSkinkScuttle(skink, skink.rng, right, open);
    if (!plan) skink.rest = SKINK_BASK_MIN;
    else beginRun(skink, plan, SKINK_SPEED, false);
  }
  return skink;
}

function footInRange(squirrel, min, max, accept) {
  const feet = squirrel.feet || [];
  const picks = [];
  for (const foot of feet) {
    const dist = Math.hypot(foot.x - squirrel.x, foot.z - squirrel.z);
    if (dist < min || dist > max) continue;
    if (!accept(foot.x, foot.z)) continue;
    picks.push({ ...foot, dist });
  }
  return picks;
}

/** A dash to another tree foot, or across open snow when no foot is in reach. */
export function planSquirrelDash(squirrel, rng, screenRight, openAt) {
  const right = screenRight || DEFAULT_RIGHT;
  const picks = footInRange(squirrel, SQUIRREL_DASH_MIN, SQUIRREL_DASH_MAX, (x, z) => (
    pathClear(squirrel.x, squirrel.z, x, z, openAt)
  ));
  if (picks.length) {
    const hit = picks[Math.min(picks.length - 1, Math.floor(rng() * picks.length))];
    const ang = Math.atan2(hit.z - squirrel.z, hit.x - squirrel.x);
    return {
      x: hit.x, z: hit.z, angle: ang, dist: hit.dist,
      flip: facesLeft(hit.x - squirrel.x, hit.z - squirrel.z, right),
    };
  }
  const ang0 = rng() * TAU;
  return aimStep(squirrel, rng, screenRight, openAt, SQUIRREL_DASH_MIN, SQUIRREL_DASH_MAX, ang0, () => true);
}

/** A dash away from one living threat. A tree foot in that direction wins. */
export function planSquirrelFlee(squirrel, rng, screenRight, openAt, threat) {
  const here = Math.hypot(squirrel.x - threat.x, squirrel.z - threat.z);
  const right = screenRight || DEFAULT_RIGHT;
  const picks = footInRange(squirrel, SQUIRREL_DASH_MIN, SQUIRREL_DASH_MAX + 2, (x, z) => (
    Math.hypot(x - threat.x, z - threat.z) > here
    && pathClear(squirrel.x, squirrel.z, x, z, openAt)
  ));
  if (picks.length) {
    const hit = picks[Math.min(picks.length - 1, Math.floor(rng() * picks.length))];
    const ang = Math.atan2(hit.z - squirrel.z, hit.x - squirrel.x);
    return {
      x: hit.x, z: hit.z, angle: ang, dist: hit.dist,
      flip: facesLeft(hit.x - squirrel.x, hit.z - squirrel.z, right),
    };
  }
  const ang0 = Math.atan2(squirrel.z - threat.z, squirrel.x - threat.x);
  return aimStep(squirrel, rng, screenRight, openAt, SQUIRREL_DASH_MIN, SQUIRREL_DASH_MAX, ang0, (x, z) => (
    Math.hypot(x - threat.x, z - threat.z) > here
  ));
}

export function makeSquirrel(seed, x, z, rng, feet) {
  return {
    kind: 'squirrel',
    seed, x, z,
    feet: feet || [],
    angle: 0,
    flick: 0,
    rest: SQUIRREL_SIT_MIN + rng() * (SQUIRREL_SIT_MAX - SQUIRREL_SIT_MIN),
    travel: null,
    flip: false,
    rng,
    handle: null,
  };
}

/**
 * The tail clock always advances. The body stays sat until a dash.
 * A living threat within five tiles starts a dash away on this step.
 * The body does not move until the next one.
 */
export function stepSquirrel(squirrel, dt, screenRight, openAt, threats) {
  if (!(dt > 0)) return squirrel;
  squirrel.flick += dt;
  const right = screenRight || DEFAULT_RIGHT;
  const open = openAt || (() => 'open');
  if (!(squirrel.travel && squirrel.travel.flee)) {
    const threat = nearestThreat(squirrel.x, squirrel.z, threats);
    if (threat) {
      const plan = planSquirrelFlee(squirrel, squirrel.rng, right, open, threat);
      if (plan) {
        beginRun(squirrel, plan, SQUIRREL_SPEED, true);
        return squirrel;
      }
      if (!squirrel.travel) return squirrel;
    }
  }
  if (squirrel.travel) {
    const tr = squirrel.travel;
    const step = Math.min(dt, tr.dur - tr.age);
    tr.age += step;
    const u = tr.dur > 0 ? tr.age / tr.dur : 1;
    const s = u * u * (3 - 2 * u);
    squirrel.x = tr.fromX + (tr.toX - tr.fromX) * s;
    squirrel.z = tr.fromZ + (tr.toZ - tr.fromZ) * s;
    squirrel.flip = facesLeft(tr.toX - tr.fromX, tr.toZ - tr.fromZ, right);
    if (tr.age >= tr.dur - 1e-8) {
      squirrel.x = tr.toX;
      squirrel.z = tr.toZ;
      squirrel.travel = null;
      squirrel.rest = SQUIRREL_SIT_MIN + squirrel.rng() * (SQUIRREL_SIT_MAX - SQUIRREL_SIT_MIN);
    }
    return squirrel;
  }
  squirrel.rest -= dt;
  if (squirrel.rest <= 0) {
    const plan = planSquirrelDash(squirrel, squirrel.rng, right, open);
    if (!plan) squirrel.rest = SQUIRREL_SIT_MIN;
    else beginRun(squirrel, plan, SQUIRREL_SPEED, false);
  }
  return squirrel;
}

export function clearGroundlings() {
  for (const skink of skinks) dropLivePixelFx(skink.handle && skink.handle.mesh);
  for (const squirrel of squirrels) dropLivePixelFx(squirrel.handle && squirrel.handle.mesh);
  skinks.length = 0;
  squirrels.length = 0;
}

export function ambientGroundlingCounts() {
  return { skinks: skinks.length, squirrels: squirrels.length };
}

export function mountGroundlings(scene, plans, d) {
  if (!scene || !plans || !plans.length) return 0;
  const feet = [];
  for (const tree of treePoints(d)) {
    const foot = d ? footBeside(d, tree) : null;
    if (foot) feet.push(foot);
  }
  for (const plan of plans) {
    const squirrel = plan.kind === 'squirrel';
    const rng = mulberry32(((d && d.seed) >>> 0) ^ Math.imul(plan.seed, 0x9E3779B9) ^ (squirrel ? 0x5A911 : 0x5A11C));
    const critter = squirrel
      ? makeSquirrel(plan.seed, plan.x, plan.z, rng, feet)
      : makeSkink(plan.seed, plan.x, plan.z, rng);
    const y = (d ? groundY(d, plan.x, plan.z) : 0) + FEET_Y;
    const handle = spawnLivePixelFx(scene, squirrel ? squirrelFx : skinkFx, {
      pos: new THREE.Vector3(plan.x, y, plan.z),
      pxPerUnit: squirrel ? SQUIRREL_PX_PER_UNIT : SKINK_PX_PER_UNIT,
      renderOrder: 9,
      fadeIn: 0,
      options: squirrel
        ? { seed: plan.seed, run: 0, flick: 0, flip: false }
        : { seed: plan.seed, coat: plan.coat || 'ruin', blink: 0, scuttle: 0, step: 0, flip: false },
    });
    handle.mesh.raycast = () => {};
    handle.mesh.name = squirrel ? 'ambient-squirrel' : 'ambient-skink';
    critter.handle = handle;
    if (squirrel) squirrels.push(critter);
    else skinks.push(critter);
  }
  return plans.length;
}

export function tickGroundlings(dt, right, world) {
  if (!(dt > 0) || (!skinks.length && !squirrels.length)) return;
  const openAt = (world && world.openAt) || (() => 'open');
  const groundAt = (world && world.groundAt) || (() => 0);
  const threats = world && world.threats;
  const r = right || DEFAULT_RIGHT;
  for (const skink of skinks) {
    stepSkink(skink, dt, r, openAt, threats);
    const mesh = skink.handle && skink.handle.mesh;
    if (!mesh) continue;
    mesh.position.set(skink.x, groundAt(skink.x, skink.z) + FEET_Y, skink.z);
    const opt = skink.handle.options;
    if (!opt) continue;
    opt.flip = skink.flip;
    opt.blink = skink.blink;
    opt.scuttle = skink.travel ? 1 : 0;
    opt.step = skink.step;
    opt.coat = opt.coat || 'ruin';
  }
  for (const squirrel of squirrels) {
    stepSquirrel(squirrel, dt, r, openAt, threats);
    const mesh = squirrel.handle && squirrel.handle.mesh;
    if (!mesh) continue;
    mesh.position.set(squirrel.x, groundAt(squirrel.x, squirrel.z) + FEET_Y, squirrel.z);
    const opt = squirrel.handle.options;
    if (!opt) continue;
    opt.flip = squirrel.flip;
    opt.flick = squirrel.flick;
    opt.run = squirrel.travel ? 1 : 0;
  }
}

export function shadeGroundlings(shade, dt) {
  if (typeof shade !== 'function') return;
  const visit = (list) => {
    for (const critter of list) {
      const mesh = critter.handle && critter.handle.mesh;
      if (!mesh) continue;
      shade(mesh, mesh.position.x, mesh.position.y, mesh.position.z, dt);
    }
  };
  visit(skinks);
  visit(squirrels);
}
