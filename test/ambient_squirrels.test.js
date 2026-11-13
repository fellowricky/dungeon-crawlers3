import { describe, it, expect } from 'vitest';
import { createFrame, clearFrame, createFx, composite } from '../src/vendor/pixelfx/core/index.js';
import * as squirrelFx from '../src/vendor/pixelfx/fx/critters/squirrel.js';
import { cameraBasisFromYawPitch } from '../src/game/span_ribbon.js';
import { FLOOR, WALL, POOL } from '../src/game/constants.js';
import { crittersFor, HERO_SPRITE_QUAD } from '../src/render/ambient_critters.js';
import {
  SQUIRREL_BODY_PX,
  SQUIRREL_BODY_FRAC,
  SQUIRREL_PX_PER_UNIT,
  SQUIRREL_COUNT_MIN,
  SQUIRREL_COUNT_MAX,
  SQUIRREL_SIT_MIN,
  SQUIRREL_SIT_MAX,
  SQUIRREL_DASH_MIN,
  SQUIRREL_DASH_MAX,
  SQUIRREL_SPEED,
  openGround,
  pickSquirrelSpots,
  planSquirrelDash,
  planSquirrelFlee,
  makeSquirrel,
  stepSquirrel,
} from '../src/render/ambient_groundlings.js';

const RIGHT = cameraBasisFromYawPitch(Math.PI / 4, 0.64).right;

function field(seed = 1) {
  const W = 64, H = 48, n = W * H;
  return {
    themeKey: 'snowfield',
    seed,
    W, H,
    grid: new Uint8Array(n).fill(FLOOR),
    roadDist: new Int16Array(n).fill(8),
    solidProps: new Uint8Array(n),
    lakeMask: new Uint8Array(n),
    perches: [],
  };
}

function worldOf(d, cx, cy) {
  return { x: cx - d.W / 2 + 0.5, z: cy - d.H / 2 + 0.5 };
}

function paint(opts) {
  const [W, H] = squirrelFx.meta.size;
  const [ox, oy] = squirrelFx.meta.origin;
  const frame = createFrame(W, H);
  const fx = createFx(squirrelFx, { x: ox, y: oy, seed: 1, run: 0, flick: 0, ...opts });
  fx.update(0.2);
  clearFrame(frame);
  fx.draw(frame, 'front');
  const out = new Uint8ClampedArray(W * H * 4);
  composite(frame, out);
  let minX = W, maxX = 0, minY = H, maxY = 0, n = 0, edge = 0, white = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const a = out[i + 3];
      if (a > 20 && out[i] > 250 && out[i + 1] > 250 && out[i + 2] > 250) white += 1;
      if (a < 20) continue;
      n += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge += 1;
    }
  }
  return { W, H, out, n, minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1, edge, white };
}

function rgbDiff(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] < 20 && b[i + 3] < 20) continue;
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n += 1;
  }
  return n;
}

describe('snowfield squirrels', () => {
  it('sits under a quarter of a hero', () => {
    const height = SQUIRREL_BODY_PX / SQUIRREL_PX_PER_UNIT;
    expect(height / HERO_SPRITE_QUAD).toBeCloseTo(SQUIRREL_BODY_FRAC, 5);
    expect(SQUIRREL_BODY_FRAC).toBeLessThanOrEqual(0.25);
    expect(SQUIRREL_BODY_FRAC).toBeGreaterThan(0.15);
  });

  it('turns squirrels on for the snowfield and leaves other themes off', () => {
    const snow = crittersFor('snowfield');
    expect(snow.squirrel).toEqual({ enabled: true, min: SQUIRREL_COUNT_MIN, max: SQUIRREL_COUNT_MAX });
    expect(snow.skink.enabled).toBe(false);
    expect(crittersFor('ashfield').squirrel.enabled).toBe(false);
    expect(crittersFor('ruinfield').squirrel.enabled).toBe(false);
    expect(crittersFor('forest').squirrel.enabled).toBe(false);
    expect(crittersFor('ancient').squirrel.enabled).toBe(false);
    expect(crittersFor('moor', { squirrel: { enabled: true, min: 5, max: 1 } }).squirrel).toEqual({ enabled: true, min: 5, max: 5 });
  });

  it('stands at the foot of a tree, off the trunk', () => {
    const d = field(4);
    const a = worldOf(d, 12, 20);
    const b = worldOf(d, 44, 20);
    d.grid[20 * d.W + 12] = WALL;
    d.grid[20 * d.W + 44] = WALL;
    d.perches = [
      { x: a.x, z: a.z, cx: 12, cy: 20 },
      { x: b.x, z: b.z, cx: 44, cy: 20 },
    ];
    const spots = pickSquirrelSpots(d, { min: 2, max: 2 });
    expect(spots).toHaveLength(2);
    const feet = [
      { x: a.x + 0.7, z: a.z },
      { x: b.x + 0.7, z: b.z },
    ];
    for (const spot of spots) {
      expect(feet.some((f) => Math.hypot(spot.x - f.x, spot.z - f.z) < 0.05)).toBe(true);
      expect(openGround(d, spot.x, spot.z)).toBe('open');
    }
    const dx = spots[0].x - spots[1].x;
    const dz = spots[0].z - spots[1].z;
    expect(dx * dx + dz * dz).toBeGreaterThanOrEqual(16 * 16);
  });

  it('falls back to open snow when the map has fewer than two trees', () => {
    const one = field(3);
    const trunk = worldOf(one, 12, 20);
    one.grid[20 * one.W + 12] = WALL;
    one.perches = [{ x: trunk.x, z: trunk.z, cx: 12, cy: 20 }];
    const spots = pickSquirrelSpots(one, { min: 2, max: 2 });
    expect(spots).toHaveLength(2);
    for (const spot of spots) {
      expect(openGround(one, spot.x, spot.z)).toBe('open');
      expect(Math.hypot(spot.x - trunk.x, spot.z - trunk.z)).toBeGreaterThan(0.2);
    }

    const counts = new Set();
    for (let seed = 1; seed <= 24; seed++) {
      const d = field(seed);
      const placed = pickSquirrelSpots(d);
      counts.add(placed.length);
      expect(placed.length).toBeGreaterThanOrEqual(SQUIRREL_COUNT_MIN);
      expect(placed.length).toBeLessThanOrEqual(SQUIRREL_COUNT_MAX);
    }
    expect(counts.has(2)).toBe(true);
    expect(counts.has(3)).toBe(true);

    const road = field();
    road.roadDist.fill(1);
    expect(pickSquirrelSpots(road)).toEqual([]);
    const wet = field();
    wet.grid.fill(POOL);
    expect(pickSquirrelSpots(wet)).toEqual([]);
    const lake = field();
    lake.lakeMask.fill(1);
    expect(pickSquirrelSpots(lake)).toEqual([]);
  });

  it('sits with the tail clock running, and the body stays put', () => {
    const squirrel = makeSquirrel(1, 1, 2, () => 0, []);
    expect(squirrel.rest).toBe(SQUIRREL_SIT_MIN);
    expect(squirrel.rest).toBeLessThanOrEqual(SQUIRREL_SIT_MAX);
    stepSquirrel(squirrel, 1, RIGHT, () => 'open');
    expect(squirrel.x).toBe(1);
    expect(squirrel.z).toBe(2);
    expect(squirrel.flick).toBeCloseTo(1, 5);
    expect(squirrel.travel).toBeNull();
  });

  it('dashes to another tree, and the start frame does not move', () => {
    const squirrel = makeSquirrel(1, 0, 0, () => 0, [{ x: 5, z: 0 }, { x: -8, z: 0 }]);
    let calls = 0;
    squirrel.rng = () => { calls += 1; return 0; };
    squirrel.rest = 0;
    stepSquirrel(squirrel, 0.05, RIGHT, () => 'open');
    expect(calls).toBe(1);
    expect(squirrel.travel.flee).toBe(false);
    expect(squirrel.x).toBe(0);
    expect(squirrel.travel.toX).toBeCloseTo(5, 5);
    expect(squirrel.travel.dur).toBeCloseTo(5 / SQUIRREL_SPEED, 5);
    expect(squirrel.flip).toBe(false);
    const dur = squirrel.travel.dur;
    stepSquirrel(squirrel, dur / 2, RIGHT, () => 'open');
    expect(squirrel.x).toBeCloseTo(2.5, 2);
    stepSquirrel(squirrel, dur / 2 + 0.05, RIGHT, () => 'open');
    expect(squirrel.travel).toBeNull();
    expect(squirrel.x).toBeCloseTo(5, 5);
    expect(squirrel.rest).toBe(SQUIRREL_SIT_MIN);
  });

  it('dashes across open snow when no tree foot is in reach', () => {
    const squirrel = makeSquirrel(1, 0, 0, () => 0, []);
    let calls = 0;
    squirrel.rng = () => { calls += 1; return 0; };
    squirrel.rest = 0;
    stepSquirrel(squirrel, 0.05, RIGHT, () => 'open');
    expect(calls).toBe(2);
    expect(squirrel.x).toBe(0);
    expect(squirrel.travel.toX).toBeCloseTo(SQUIRREL_DASH_MIN, 5);
    expect(squirrel.travel.dur).toBeCloseTo(SQUIRREL_DASH_MIN / SQUIRREL_SPEED, 5);
    const span = planSquirrelDash(makeSquirrel(1, 0, 0, () => 0, []), () => 0.99, RIGHT, () => 'open');
    expect(span.dist).toBeGreaterThanOrEqual(SQUIRREL_DASH_MIN - 0.01);
    expect(span.dist).toBeLessThanOrEqual(SQUIRREL_DASH_MAX + 0.01);

    const stuck = makeSquirrel(1, 0, 0, () => 0, []);
    stuck.rest = 0;
    stepSquirrel(stuck, 0.05, RIGHT, () => 'wall');
    expect(stuck.travel).toBeNull();
    expect(stuck.x).toBe(0);
    expect(stuck.rest).toBe(SQUIRREL_SIT_MIN);
  });

  it('dashes away from anything living within five tiles, and does not retarget', () => {
    const squirrel = makeSquirrel(1, 0, 0, () => 0, [{ x: -6, z: 0 }, { x: 5, z: 0 }]);
    squirrel.rest = 10;
    stepSquirrel(squirrel, 0.05, RIGHT, () => 'open', [{ x: 2, z: 0 }]);
    expect(squirrel.travel.flee).toBe(true);
    expect(squirrel.travel.toX).toBeCloseTo(-6, 5);
    expect(squirrel.x).toBe(0);
    expect(squirrel.flip).toBe(true);
    expect(planSquirrelFlee(squirrel, () => 0, RIGHT, () => 'open', { x: 2, z: 0 }).x).toBeCloseTo(-6, 5);

    const held = squirrel.travel.toX;
    stepSquirrel(squirrel, 0.05, RIGHT, () => 'open', [{ x: -1, z: 0 }]);
    expect(squirrel.travel.toX).toBe(held);
    expect(squirrel.x).toBeLessThan(0);

    const open = makeSquirrel(1, 0, 0, () => 0, []);
    open.rest = 10;
    stepSquirrel(open, 0.05, RIGHT, () => 'open', [{ x: 2, z: 0 }]);
    expect(open.x).toBe(0);
    expect(open.travel.toX).toBeCloseTo(-SQUIRREL_DASH_MIN, 5);

    const calm = makeSquirrel(1, 0, 0, () => 0, []);
    calm.rest = 10;
    stepSquirrel(calm, 0.05, RIGHT, () => 'open', [{ x: 5.01, z: 0 }]);
    expect(calm.travel).toBeNull();
    expect(calm.rest).toBeCloseTo(9.95, 5);

    const stuck = makeSquirrel(1, 0, 0, () => 0, []);
    stuck.rest = 10;
    stepSquirrel(stuck, 0.05, RIGHT, () => 'pool', [{ x: 2, z: 0 }]);
    expect(stuck.travel).toBeNull();
    expect(stuck.x).toBe(0);
    expect(stuck.rest).toBe(10);
  });

  it('curls its tail while sitting, stretches when it runs, and wears two coats', () => {
    const sit = paint({ seed: 1, run: 0, flick: 0.2 });
    const flick = paint({ seed: 1, run: 0, flick: 0.7 });
    const run = paint({ seed: 1, run: 1, flick: 0.4 });
    const dusk = paint({ seed: 2, run: 0, flick: 0.2 });
    const again = paint({ seed: 3, run: 0, flick: 0.2 });
    for (const shot of [sit, flick, run, dusk]) {
      expect(shot.edge).toBe(0);
      expect(shot.white).toBe(0);
    }
    expect(sit).toMatchObject({ n: 131, w: 14, h: 17, minX: 28, maxX: 41, minY: 25, maxY: 41 });
    expect(flick).toMatchObject({ n: 143, w: 14, h: 19 });
    expect(run).toMatchObject({ n: 177, w: 32, h: 10, minX: 14, maxX: 45, minY: 32, maxY: 41 });
    expect(dusk.minX).toBe(sit.minX);
    expect(dusk.maxX).toBe(sit.maxX);
    expect(dusk.minY).toBe(sit.minY);
    expect(dusk.maxY).toBe(sit.maxY);
    expect(rgbDiff(sit.out, dusk.out)).toBeGreaterThan(20);
    expect(rgbDiff(sit.out, again.out)).toBe(0);
    expect(rgbDiff(sit.out, flick.out)).toBeGreaterThan(0);
    expect(rgbDiff(sit.out, run.out)).toBeGreaterThan(20);
  });
});
