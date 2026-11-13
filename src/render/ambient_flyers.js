/**
 * Birds and bats. Ambiance only: no combat, no click, no collision.
 * Each one claims a clearing that has two trees far enough apart, rests in
 * one, then flies to the other. The line between the trees is the spine.
 * A bird bends off it in one smooth curve. A bat darts across it. A bird sits on the branch with its wings
 * folded, and between crossings it drops to the ground and pecks. A bat
 * hangs under the branch and does not peck. A living hero or monster
 * within five tiles sends either one to another tree in the clearing.
 *
 * Perches are recorded while the level mesh is built (belt trees, the
 * procedural stand-in, and tree props). A mesh with a real limb puts the
 * bird on top of that limb and the bat on its underside. A belt tree stands
 * on a wall cell, so its clearing is the nearest floor room.
 */
import * as THREE from 'three';
import { FLOOR } from '../game/constants.js';
import { groundY } from '../dungeon/elevation.js';
import * as birdFx from '../vendor/pixelfx/fx/critters/bird.js';
import * as batFx from '../vendor/pixelfx/fx/critters/bat.js';
import { spawnLivePixelFx, dropLivePixelFx } from './pixelfx_live.js';

/** A standard hero billboard is 1.125 world units for a 64px cell. */
const HERO_SPRITE_QUAD = 1.125;

/** Opaque span of a perched bird, crown to the lowest toe, in art pixels. */
export const BIRD_BODY_PX = 16;
/** Sitting height as a fraction of a hero sprite. Under a quarter, so a bird reads as a speck in the crown. */
export const BIRD_BODY_FRAC = 0.16;
export const BIRD_PX_PER_UNIT = BIRD_BODY_PX / (HERO_SPRITE_QUAD * BIRD_BODY_FRAC);
/** Lowest perched pixel below the body pivot. The mesh sits this far above the branch so the toes land on it. */
export const BIRD_FOOT_PX = 7;

/** Opaque span of a roosting bat, toes to the ear tips, in art pixels. */
export const BAT_BODY_PX = 14;
/** Hanging height as a fraction of a hero sprite. */
export const BAT_BODY_FRAC = 0.18;
export const BAT_PX_PER_UNIT = BAT_BODY_PX / (HERO_SPRITE_QUAD * BAT_BODY_FRAC);

export const FLYER_COUNT_MIN = 2;
export const FLYER_COUNT_MAX = 3;
/** World units between the two trees of a crossing. */
export const FLYER_MIN_SPAN = 8;
/** How far a wall tree may look for the floor it belongs to. */
const ROOM_REACH = 6;
const COUNT_CAP = 24;

export const BIRD_REST_MIN = 10;
export const BIRD_REST_MAX = 20;
/** How long a bird pecks once it has landed, in seconds. */
export const BIRD_PECK_MIN = 4;
export const BIRD_PECK_MAX = 8;
/** Toes this far above the ground mesh, so they do not fight the floor. */
export const BIRD_GROUND_LIFT = 0.02;
/** A living hero or monster this close, in tiles, makes a bird or a bat leave. Frogs and snakes share the reach. */
export const FLEE_TILES = 5;
/** Ground cells this far from the trunk, in tiles, are where a bird pecks. */
const PECK_NEAR = 2;
const PECK_FAR = 4;
/** Chance a departure is a peck, and the chance a bird starts on the ground. */
const PECK_CHANCE = 0.5;
export const BAT_REST_MIN = 16;
export const BAT_REST_MAX = 28;
/** Tiles per second. A bird crosses faster than a bat. */
export const BIRD_SPEED = 3.2;
export const BAT_SPEED = 2.2;
/** Peak of the flight, in world units above the straight line. */
export const FLY_ARC = 0.9;
/** How far a bird drifts off the crossing, in world units. One smooth bend. */
export const BIRD_WEAVE = 1.15;
/** How far a bat darts off the crossing, in world units. */
export const BAT_WEAVE = 2.2;
/**
 * Sit this far off the trunk, toward +x and +z, when the mesh has no limb to
 * sample. That is the side the default camera occupies (yaw π/4). A sampled
 * limb ignores this and uses the wood.
 */
export const PERCH_NUDGE = 0.45;
/** Pale claws sit this many art pixels above the bat pivot. */
const BAT_TOE_PX = 2;
/** Drop the roost by that much so the claws meet the underside of the limb. */
export const BAT_HANG_DROP = BAT_TOE_PX / BAT_PX_PER_UNIT;

/** Screen-right of the default dungeon camera (yaw π/4). Live ticks pass the camera matrix instead. */
const DEFAULT_RIGHT = [Math.SQRT1_2, 0, -Math.SQRT1_2];

const flyers = [];

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

function saltOf(kind) {
  return kind === 'bat' ? 0xBA7 : 0xB12D;
}

function pickRng(d, kind) {
  return mulberry32(((d.seed >>> 0) ^ saltOf(kind)) >>> 0);
}

function flyerRng(floorSeed, n, kind) {
  return mulberry32(((floorSeed >>> 0) ^ Math.imul(n, 0x9E3779B9) ^ saltOf(kind)) >>> 0);
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

function spanOf(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function withPartner(trees) {
  return trees.filter((t) => trees.some((o) => o !== t && spanOf(t, o) >= FLYER_MIN_SPAN));
}

/** Nearest floor room. Room 0 counts; a missing id does not. */
function roomNear(d, cx, cy) {
  if (!d || !d.grid || !d.roomId || !d.W) return -1;
  const { W, H } = d;
  let best = -1;
  let bestD = Infinity;
  for (let dy = -ROOM_REACH; dy <= ROOM_REACH; dy++) {
    for (let dx = -ROOM_REACH; dx <= ROOM_REACH; dx++) {
      if (dx * dx + dy * dy > ROOM_REACH * ROOM_REACH) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const c = y * W + x;
      if (d.grid[c] !== FLOOR) continue;
      const r = d.roomId[c];
      if (r == null || r < 0) continue;
      const dist = dx * dx + dy * dy;
      if (dist < bestD) {
        bestD = dist;
        best = r;
      }
    }
  }
  return best;
}

function roomOf(d, p) {
  if (p.room != null && p.room >= 0) return p.room;
  return roomNear(d, p.cx | 0, p.cy | 0);
}

/** Perches with a clearing. A wall tree borrows the nearest floor's room. */
export function collectPerches(d) {
  if (!d || !d.perches) return [];
  const out = [];
  for (const p of d.perches) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    const room = roomOf(d, p);
    if (room < 0) continue;
    const rec = {
      cx: p.cx | 0,
      cy: p.cy | 0,
      x: p.x,
      z: p.z,
      y: Number.isFinite(p.y) ? p.y : 0,
      room,
    };
    if (p.limb && Number.isFinite(p.hx) && Number.isFinite(p.hy) && Number.isFinite(p.hz)) {
      rec.limb = 1;
      rec.hx = p.hx;
      rec.hy = p.hy;
      rec.hz = p.hz;
    }
    out.push(rec);
  }
  return out;
}

/**
 * Where the critter rests. Both ends of a flight use this, so the landing
 * does not slide. A bird's toes are below the pivot; a bat's pivot is the grip.
 * A sampled limb puts the bird on top of the wood and the bat under it.
 * Anything else keeps the camera-side nudge.
 */
export function sitOf(perch, kind) {
  const foot = kind === 'bird' ? BIRD_FOOT_PX / BIRD_PX_PER_UNIT : 0;
  if (perch && perch.limb && kind === 'bat' && Number.isFinite(perch.hy)) {
    return { x: perch.hx, y: perch.hy - BAT_HANG_DROP, z: perch.hz };
  }
  if (perch && perch.limb && kind === 'bird') {
    return { x: perch.x, y: perch.y + foot, z: perch.z };
  }
  const n = PERCH_NUDGE * Math.SQRT1_2;
  return { x: perch.x + n, y: perch.y + foot, z: perch.z + n };
}

/* Limb search. Geometry is Y-up with the trunk base at the origin, which is
   how treeGeometry hands a model over after the exporter's +90° X. */
const GRIP_BAND_LO = 0.42;
const GRIP_BAND_HI = 0.78;
const GRIP_SECTORS = 8;
const GRIP_CORE_MUL = 2.2;
const GRIP_MIN_PTS = 4;
const _gripE = new THREE.Euler();
const _gripQ = new THREE.Quaternion();
const _gripP = new THREE.Vector3();

function gripAverage(pts, pred) {
  let wsum = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;
  for (const p of pts) {
    if (!pred(p)) continue;
    const w = p.r;
    wsum += w;
    x += p.x * w;
    y += p.y * w;
    z += p.z * w;
    n += 1;
  }
  if (!n || !(wsum > 0)) return null;
  return { x: x / wsum, y: y / wsum, z: z / wsum };
}

/* A bird stands on the highest wood in the cluster. A bat hangs from the lowest. */
function gripSurface(pts, pred, lowest) {
  const sel = [];
  for (const p of pts) if (pred(p)) sel.push(p);
  if (!sel.length) return null;
  let ySurf = sel[0].y;
  let span = 0;
  for (const p of sel) {
    if (lowest ? p.y < ySurf : p.y > ySurf) ySurf = p.y;
  }
  for (const p of sel) span = Math.max(span, Math.abs(p.y - ySurf));
  const band = Math.max(0.015, span * 0.35);
  return gripAverage(sel, (p) => Math.abs(p.y - ySurf) <= band);
}

/**
 * Rest points in model space. `pos` is a position attribute (getX/getY/getZ).
 * The fullest limb in the mid crown wins: its top is where a bird stands,
 * its underside is where a bat hangs. A bare pole returns null.
 */
export function branchGrips(pos) {
  if (!pos || !(pos.count >= 12) || typeof pos.getX !== 'function') return null;
  const n = pos.count;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const height = maxY - minY;
  if (!(height > 0.05)) return null;

  const footTop = minY + height * 0.15;
  let radSum = 0;
  let radN = 0;
  for (let i = 0; i < n; i++) {
    if (pos.getY(i) > footTop) continue;
    radSum += Math.hypot(pos.getX(i), pos.getZ(i));
    radN += 1;
  }
  const trunkR = radN ? radSum / radN : 0;
  const core = Math.max(trunkR * GRIP_CORE_MUL, height * 0.06);
  const y0 = minY + height * GRIP_BAND_LO;
  const y1 = minY + height * GRIP_BAND_HI;
  const sectors = Array.from({ length: GRIP_SECTORS }, () => []);
  for (let i = 0; i < n; i++) {
    const y = pos.getY(i);
    if (y < y0 || y > y1) continue;
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (!(r > core)) continue;
    /* Half-sector offset: atan2 0 (+x) would otherwise land on a bin edge,
       and a limb aimed along an axis would split in half. */
    let bin = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * GRIP_SECTORS + 0.5);
    if (bin < 0) bin = 0;
    if (bin >= GRIP_SECTORS) bin = 0;
    sectors[bin].push({ x, y, z, r });
  }

  const consider = (pts, best) => {
    if (pts.length < GRIP_MIN_PTS) return best;
    let sum = 0;
    let minR = Infinity;
    let maxR = 0;
    for (const p of pts) {
      sum += p.r;
      if (p.r < minR) minR = p.r;
      if (p.r > maxR) maxR = p.r;
    }
    const spread = maxR - minR;
    if (!(spread > Math.max(0.05, core * 0.25))) return best;
    const mean = sum / pts.length;
    const score = mean * spread;
    if (!best || score > best.score) return { pts, score };
    return best;
  };
  let best = null;
  for (let i = 0; i < GRIP_SECTORS; i++) {
    best = consider(sectors[i], best);
    const nxt = sectors[(i + 1) % GRIP_SECTORS];
    if (sectors[i].length && nxt.length) best = consider(sectors[i].concat(nxt), best);
  }
  if (!best) return null;

  let lo = Infinity;
  let hi = -Infinity;
  for (const p of best.pts) {
    if (p.y < lo) lo = p.y;
    if (p.y > hi) hi = p.y;
  }
  const span = hi - lo;
  const topCut = span > 1e-4 ? hi - span * 0.3 : hi;
  const botCut = span > 1e-4 ? lo + span * 0.3 : lo;
  const stand = gripSurface(best.pts, (p) => p.y >= topCut - 1e-6, false);
  const hang = gripSurface(best.pts, (p) => p.y <= botCut + 1e-6, true);
  if (!stand || !hang) return null;
  return { stand, hang };
}

/**
 * Model-space limb point into the instance's world.
 * Same compose as writeInstances: scale, then XYZ euler, then translation.
 * rotation.y = π/2 sends local +x to world −z.
 */
export function limbWorld(local, px, py, pz, sx, sy, sz, rx, ry, rz) {
  _gripE.set(rx || 0, ry || 0, rz || 0, 'XYZ');
  _gripQ.setFromEuler(_gripE);
  _gripP.set(local.x * sx, local.y * sy, local.z * sz).applyQuaternion(_gripQ);
  return { x: px + _gripP.x, y: py + _gripP.y, z: pz + _gripP.z };
}

function restSpan(kind) {
  return kind === 'bat'
    ? [BAT_REST_MIN, BAT_REST_MAX]
    : [BIRD_REST_MIN, BIRD_REST_MAX];
}

function nextRest(rng, kind) {
  const [lo, hi] = restSpan(kind);
  return lo + rng() * (hi - lo);
}

function speedOf(kind) {
  return kind === 'bat' ? BAT_SPEED : BIRD_SPEED;
}

/**
 * One flyer per clearing that has two trees at least FLYER_MIN_SPAN apart,
 * spread along the map. `opts.min`/`opts.max` default to two or three.
 * Same seed, same choice. A map with no such pair returns [].
 */
export function pickTreeFlyers(d, opts) {
  if (!d) return [];
  const kind = (opts && opts.kind) || 'bird';
  const lo = opts && opts.min != null ? clampCount(opts.min, FLYER_COUNT_MIN) : FLYER_COUNT_MIN;
  let hi = opts && opts.max != null ? clampCount(opts.max, FLYER_COUNT_MAX) : FLYER_COUNT_MAX;
  if (lo > hi) hi = lo;
  const rng = pickRng(d, kind);
  const want = lo + ((rng() * (hi - lo + 1)) | 0);
  if (want <= 0) return [];

  const byRoom = new Map();
  for (const p of collectPerches(d)) {
    if (!byRoom.has(p.room)) byRoom.set(p.room, []);
    byRoom.get(p.room).push(p);
  }
  const eligible = [];
  for (const [room, trees] of byRoom) {
    if (!withPartner(trees).length) continue;
    let x = 0;
    let z = 0;
    for (const t of trees) {
      x += t.x;
      z += t.z;
    }
    eligible.push({ room, trees, ax: x / trees.length, az: z / trees.length });
  }
  if (!eligible.length) return [];

  const vertical = (d.H || 0) >= (d.W || 0);
  const along = (e) => (vertical ? e.az : e.ax);
  let loA = Infinity;
  let hiA = -Infinity;
  for (const e of eligible) {
    const a = along(e);
    if (a < loA) loA = a;
    if (a > hiA) hiA = a;
  }
  const span = (hiA - loA) || 1;
  const bands = Array.from({ length: want }, () => []);
  for (const e of eligible) {
    const band = Math.min(want - 1, Math.floor(((along(e) - loA) / span) * want));
    bands[band].push(e);
  }
  const used = new Set();
  const chosen = [];
  const take = (list) => {
    for (const e of shuffled(list, rng)) {
      if (!used.has(e.room)) return e;
    }
    return null;
  };
  for (const band of bands) {
    const e = take(band) || take(eligible);
    if (!e) break;
    used.add(e.room);
    chosen.push(e);
  }
  return chosen.map((e, i) => {
    const homes = withPartner(e.trees);
    const home = homes[Math.floor(rng() * homes.length)];
    return { kind, seed: i + 1, home, trees: e.trees, ax: e.ax, az: e.az };
  });
}

function facesLeft(dx, dz, right) {
  return dx * right[0] + dz * right[2] < 0;
}

function perchFlip(flyer, right) {
  const dx = flyer.ax - flyer.x;
  const dz = flyer.az - flyer.z;
  if (dx * dx + dz * dz < 1e-8) return !!flyer.flip;
  return facesLeft(dx, dz, right);
}

function perchCell(d, perch) {
  if (Number.isFinite(perch.cx) && Number.isFinite(perch.cy)) {
    return { cx: perch.cx | 0, cy: perch.cy | 0 };
  }
  return {
    cx: Math.round(perch.x + d.W / 2 - 0.5),
    cy: Math.round(perch.z + d.H / 2 - 0.5),
  };
}

/** Floor cells a couple of tiles out from the trunk. Same clearing first. */
function peckSpots(d, perch, sameRoom) {
  if (!d || !d.grid || !d.W || !d.H || !perch) return [];
  const { cx, cy } = perchCell(d, perch);
  const { W, H, grid } = d;
  const spots = [];
  for (let dy = -PECK_FAR; dy <= PECK_FAR; dy++) {
    for (let dx = -PECK_FAR; dx <= PECK_FAR; dx++) {
      const dist = Math.hypot(dx, dy);
      if (dist < PECK_NEAR || dist > PECK_FAR) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const c = y * W + x;
      if (grid[c] !== FLOOR) continue;
      if (d.lakeMask && d.lakeMask[c]) continue;
      if (d.solidProps && d.solidProps[c]) continue;
      if (sameRoom && d.roomId && perch.room != null && d.roomId[c] !== perch.room) continue;
      const wx = x - W / 2 + 0.5;
      const wz = y - H / 2 + 0.5;
      spots.push({
        x: wx,
        z: wz,
        y: groundY(d, wx, wz) + BIRD_FOOT_PX / BIRD_PX_PER_UNIT + BIRD_GROUND_LIFT,
      });
    }
  }
  return spots;
}

function pickPeckSpot(d, perch, rng) {
  let spots = peckSpots(d, perch, true);
  if (!spots.length) spots = peckSpots(d, perch, false);
  if (!spots.length) return null;
  return spots[Math.floor(rng() * spots.length)];
}

function clearance(x, z, threats) {
  let best = Infinity;
  if (!threats) return best;
  for (const t of threats) {
    if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.z)) continue;
    const dist = Math.hypot(x - t.x, z - t.z);
    if (dist < best) best = dist;
  }
  return best;
}

/**
 * The nearest living hero or monster within `reach` tiles, or null.
 * Height is ignored. A distance of exactly `reach` still counts.
 */
export function nearestThreat(x, z, threats, reach = FLEE_TILES) {
  if (!threats || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  let best = null;
  let bestDist = reach;
  for (const t of threats) {
    if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.z)) continue;
    const dist = Math.hypot(x - t.x, z - t.z);
    if (dist <= bestDist) {
      bestDist = dist;
      best = t;
    }
  }
  return best;
}

function spooked(flyer, threats) {
  return !!(flyer && nearestThreat(flyer.x, flyer.z, threats));
}

function fleeTree(flyer, threats) {
  let best = null;
  let bestScore = -Infinity;
  for (const t of flyer.trees) {
    if (t === flyer.perch || spanOf(t, flyer.perch) < FLYER_MIN_SPAN) continue;
    const sit = sitOf(t, flyer.kind);
    const score = clearance(sit.x, sit.z, threats) * 1000 + spanOf(sit, flyer);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/**
 * Offset from the straight crossing, in world units. `side` is to the
 * right of travel. Both kinds leave the perch and arrive on it: the
 * offset is zero at the ends. A bird makes one smooth S. A bat stacks
 * several darts so the middle of the flight keeps changing direction.
 * A bird's extra lift is also zero at the crest, so the arc peak stays put.
 */
export function flightWeave(kind, u, phase, dist) {
  const t = Math.min(1, Math.max(0, u));
  const cap = kind === 'bat' ? BAT_WEAVE : BIRD_WEAVE;
  const gain = kind === 'bat' ? 0.14 : 0.08;
  const reach = Math.min(cap, Math.max(0.35, (dist > 0 ? dist : 0) * gain));
  const env = Math.sin(Math.PI * t);
  if (kind === 'bat') {
    const a = (phase || 0) * Math.PI * 2;
    const side = (
      Math.sin(t * Math.PI * 2 * 3 + a) * 0.62
      + Math.sin(t * Math.PI * 2 * 5.3 + a * 1.7) * 0.38
      + Math.sin(t * Math.PI * 2 * 8.1 + a * 0.6) * 0.24
    );
    const lift = (
      Math.sin(t * Math.PI * 2 * 4.2 + a * 1.3) * 0.55
      + Math.sin(t * Math.PI * 2 * 7.4 + a * 2.2) * 0.32
    );
    const surge = Math.sin(t * Math.PI * 2 * 3.6 + a * 0.8) * 0.28;
    return {
      side: side * env * reach,
      lift: lift * env * reach * 0.42,
      surge: surge * env * reach,
    };
  }
  const sign = (phase || 0) < 0.5 ? 1 : -1;
  return {
    side: Math.sin(t * Math.PI * 2) * reach * sign,
    lift: Math.sin(t * Math.PI * 4) * env * reach * 0.28,
    surge: 0,
  };
}

function beginTravel(flyer, to, dest, right, flags) {
  const dist = Math.hypot(to.x - flyer.x, to.z - flyer.z) || 0.001;
  flyer.hops = (flyer.hops || 0) + 1;
  const phase = (((flyer.seed | 0) * 0.173 + flyer.hops * 0.6180339887) % 1 + 1) % 1;
  flyer.travel = {
    fromX: flyer.x, fromY: flyer.y, fromZ: flyer.z,
    toX: to.x, toY: to.y, toZ: to.z,
    dest: dest || null,
    ground: !!(flags && flags.ground),
    flee: !!(flags && flags.flee),
    age: 0,
    dur: dist / speedOf(flyer.kind),
    phase,
    dist,
  };
  flyer.pose = 0;
  flyer.rest = 0;
  flyer.peck = 0;
  flyer.flip = facesLeft(to.x - flyer.x, to.z - flyer.z, right);
}

function beginTree(flyer, right) {
  const dests = flyer.trees.filter((t) => t !== flyer.perch && spanOf(t, flyer.perch) >= FLYER_MIN_SPAN);
  if (!dests.length) {
    if (flyer.pose === 2 && flyer.perch) {
      beginTravel(flyer, sitOf(flyer.perch, flyer.kind), flyer.perch, right, null);
      return;
    }
    flyer.rest = restSpan(flyer.kind)[0];
    flyer.pose = 1;
    return;
  }
  const dest = dests[Math.floor(flyer.rng() * dests.length)];
  beginTravel(flyer, sitOf(dest, flyer.kind), dest, right, null);
}

/** A flyer at rest on `plan.home`. `world.d` lets a bird start already pecking. */
export function makeFlyer(plan, rng = Math.random, world = null) {
  const sit = sitOf(plan.home, plan.kind);
  const roll = plan.kind === 'bird' ? rng() : 1;
  const flyer = {
    kind: plan.kind,
    seed: plan.seed,
    rng,
    perch: plan.home,
    trees: plan.trees,
    ax: plan.ax,
    az: plan.az,
    x: sit.x,
    y: sit.y,
    z: sit.z,
    pose: 1,
    flip: false,
    rest: nextRest(rng, plan.kind),
    peck: 0,
    travel: null,
  };
  flyer.flip = perchFlip(flyer, DEFAULT_RIGHT);
  if (roll >= 1 - PECK_CHANCE && world && world.d) {
    const spot = pickPeckSpot(world.d, plan.home, rng);
    if (spot) {
      flyer.x = spot.x;
      flyer.y = spot.y;
      flyer.z = spot.z;
      flyer.pose = 2;
      flyer.peck = BIRD_PECK_MIN + rng() * (BIRD_PECK_MAX - BIRD_PECK_MIN);
      flyer.flip = perchFlip(flyer, DEFAULT_RIGHT);
    }
  }
  return flyer;
}

/**
 * Rest, then fly to another tree in the same clearing. A bird also drops to
 * the ground to peck. Either kind leaves early when something living is
 * within FLEE_TILES. An in-progress flee is not retargeted. `pose` is 1 on
 * the branch, 2 on the ground, and 0 in the air. Art faces screen-right, so
 * flip when the crossing goes screen-left. While it sits, it faces the
 * middle of the clearing.
 *
 * `world` is `{ d, threats }`. Threats are `{ x, z }` of living heroes and
 * monsters. Without it, a flyer only crosses between trees.
 */
export function stepFlyer(flyer, dt, right, world) {
  const r = right || DEFAULT_RIGHT;
  const threats = world && world.threats;
  if (!(flyer.travel && flyer.travel.flee) && spooked(flyer, threats)) {
    const dest = fleeTree(flyer, threats);
    if (dest) {
      beginTravel(flyer, sitOf(dest, flyer.kind), dest, r, { flee: true });
      return flyer;
    }
    if (flyer.pose === 2 && flyer.perch) {
      beginTravel(flyer, sitOf(flyer.perch, flyer.kind), flyer.perch, r, { flee: true });
      return flyer;
    }
  }
  if (flyer.travel) {
    const tr = flyer.travel;
    tr.age += dt;
    const u = tr.dur > 0 ? Math.min(1, tr.age / tr.dur) : 1;
    const s = u * u * (3 - 2 * u);
    const arc = Math.sin(Math.PI * u) * FLY_ARC;
    const dx = tr.toX - tr.fromX;
    const dz = tr.toZ - tr.fromZ;
    const span = Math.hypot(dx, dz) || 1;
    const w = flightWeave(flyer.kind, u, tr.phase, tr.dist || span);
    flyer.x = tr.fromX + dx * s + (-dz / span) * w.side + (dx / span) * w.surge;
    flyer.z = tr.fromZ + dz * s + (dx / span) * w.side + (dz / span) * w.surge;
    flyer.y = tr.fromY + (tr.toY - tr.fromY) * s + arc + w.lift;
    flyer.pose = 0;
    flyer.flip = facesLeft(tr.toX - tr.fromX, tr.toZ - tr.fromZ, r);
    if (tr.age >= tr.dur - 1e-8) {
      flyer.x = tr.toX;
      flyer.y = tr.toY;
      flyer.z = tr.toZ;
      flyer.travel = null;
      if (tr.ground) {
        flyer.pose = 2;
        flyer.peck = BIRD_PECK_MIN + flyer.rng() * (BIRD_PECK_MAX - BIRD_PECK_MIN);
      } else {
        flyer.perch = tr.dest;
        flyer.pose = 1;
        flyer.rest = nextRest(flyer.rng, flyer.kind);
      }
      flyer.flip = perchFlip(flyer, r);
    }
    return flyer;
  }
  if (flyer.pose === 2) {
    flyer.flip = perchFlip(flyer, r);
    flyer.peck -= dt;
    if (flyer.peck <= 0) beginTree(flyer, r);
    return flyer;
  }
  flyer.pose = 1;
  flyer.flip = perchFlip(flyer, r);
  flyer.rest -= dt;
  if (flyer.rest <= 0) {
    const peck = flyer.kind === 'bird' && flyer.rng() >= 1 - PECK_CHANCE;
    if (peck) {
      const spot = world && pickPeckSpot(world.d, flyer.perch, flyer.rng);
      if (spot) {
        beginTravel(flyer, spot, null, r, { ground: true });
        return flyer;
      }
    }
    beginTree(flyer, r);
  }
  return flyer;
}

/** Plans for the kinds this theme has turned on. */
export function planAmbientFlyers(d, cfg) {
  const out = [];
  if (cfg && cfg.bird && cfg.bird.enabled) out.push(...pickTreeFlyers(d, { ...cfg.bird, kind: 'bird' }));
  if (cfg && cfg.bat && cfg.bat.enabled) out.push(...pickTreeFlyers(d, { ...cfg.bat, kind: 'bat' }));
  return out;
}

export function clearAmbientFlyers() {
  for (const flyer of flyers) dropLivePixelFx(flyer.handle && flyer.handle.mesh);
  flyers.length = 0;
}

export function ambientFlyerCounts() {
  let birds = 0;
  let bats = 0;
  for (const flyer of flyers) {
    if (flyer.kind === 'bat') bats += 1;
    else birds += 1;
  }
  return { birds, bats };
}

/** Put the plans in the scene, already perched. */
export function mountAmbientFlyers(scene, plans, floorSeed, d) {
  if (!scene || !plans) return 0;
  for (const plan of plans) {
    const rng = flyerRng(floorSeed, plan.seed, plan.kind);
    const flyer = makeFlyer(plan, rng, d ? { d } : null);
    const bat = plan.kind === 'bat';
    const handle = spawnLivePixelFx(scene, bat ? batFx : birdFx, {
      pos: new THREE.Vector3(flyer.x, flyer.y, flyer.z),
      pxPerUnit: bat ? BAT_PX_PER_UNIT : BIRD_PX_PER_UNIT,
      renderOrder: 9,
      fadeIn: 0,
      options: bat
        ? { seed: plan.seed, roost: flyer.pose ? 1 : 0, flip: flyer.flip }
        : {
          seed: plan.seed,
          perch: flyer.pose === 1 ? 1 : 0,
          peck: flyer.pose === 2 ? 1 : 0,
          flip: flyer.flip,
        },
    });
    handle.mesh.raycast = () => {};
    handle.mesh.name = bat ? 'ambient-bat' : 'ambient-bird';
    flyer.handle = handle;
    flyers.push(flyer);
  }
  return plans.length;
}

/** Advance the flights. The live-fx redraw paints the pose this just wrote. */
export function tickAmbientFlyers(dt, right, world) {
  if (!(dt > 0) || !flyers.length) return;
  for (const flyer of flyers) {
    stepFlyer(flyer, dt, right || DEFAULT_RIGHT, world);
    const mesh = flyer.handle && flyer.handle.mesh;
    if (!mesh) continue;
    mesh.position.set(flyer.x, flyer.y, flyer.z);
    const opt = flyer.handle.options;
    if (!opt) continue;
    opt.flip = flyer.flip;
    if (flyer.kind === 'bat') opt.roost = flyer.pose ? 1 : 0;
    else {
      opt.perch = flyer.pose === 1 ? 1 : 0;
      opt.peck = flyer.pose === 2 ? 1 : 0;
    }
  }
}

/** Hand each flyer card to the sprite light pass. Positions are already current. */
export function shadeAmbientFlyers(shade, dt) {
  if (typeof shade !== 'function') return;
  for (const flyer of flyers) {
    const mesh = flyer.handle && flyer.handle.mesh;
    if (!mesh) continue;
    shade(mesh, mesh.position.x, mesh.position.y, mesh.position.z, dt);
  }
}

