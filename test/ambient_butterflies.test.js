import { describe, it, expect } from 'vitest';
import { createFrame, clearFrame, createFx, composite } from '../src/vendor/pixelfx/core/index.js';
import * as butterflyFx from '../src/vendor/pixelfx/fx/critters/butterfly.js';
import { cameraBasisFromYawPitch } from '../src/game/span_ribbon.js';
import { FLOOR } from '../src/game/constants.js';
import { crittersFor } from '../src/render/ambient_critters.js';
import {
  BUTTERFLY_SPAN_PX,
  BUTTERFLY_SPAN_FRAC,
  BUTTERFLY_PX_PER_UNIT,
  BUTTERFLY_COUNT_MIN,
  BUTTERFLY_COUNT_MAX,
  BUTTERFLY_LOITER_MIN,
  BUTTERFLY_LOITER_MAX,
  BUTTERFLY_DRIFT_MIN,
  BUTTERFLY_DRIFT_MAX,
  BUTTERFLY_SPEED,
  BUTTERFLY_FLEE_SPEED,
  BUTTERFLY_GLIDE,
  BUTTERFLY_PERCH_CHANCE,
  BUTTERFLY_PERCH_MIN,
  BUTTERFLY_PERCH_MAX,
  BUTTERFLY_HOVER_Y,
  DART_SPEED,
  GRASS_TIP,
  PERCH_LIFT,
  pickButterflyCells,
  grassPerches,
  makeButterfly,
  stepButterfly,
  butterflyAltitude,
  butterflyDriftPoint,
} from '../src/render/ambient_insects.js';

const RIGHT = cameraBasisFromYawPitch(Math.PI / 4, 0.64).right;

const HERO = 1.125;

function map(seed = 3) {
  const W = 40, H = 48, n = W * H;
  return {
    themeKey: 'forest',
    seed,
    W, H,
    grid: new Uint8Array(n).fill(FLOOR),
    solidProps: new Uint8Array(n),
    props: [],
  };
}

function paint(opts) {
  const [W, H] = butterflyFx.meta.size;
  const [ox, oy] = butterflyFx.meta.origin;
  const frame = createFrame(W, H);
  const fx = createFx(butterflyFx, { x: ox, y: oy, seed: 1, beat: 1, ...opts });
  fx.update(opts && opts.t != null ? opts.t : 0.4);
  clearFrame(frame);
  fx.draw(frame, 'front');
  const out = new Uint8ClampedArray(W * H * 4);
  composite(frame, out);
  return { W, H, out };
}

function bounds(shot) {
  let minX = shot.W, maxX = 0, minY = shot.H, maxY = 0, n = 0, soft = 0;
  for (let y = 0; y < shot.H; y++) {
    for (let x = 0; x < shot.W; x++) {
      const a = shot.out[(y * shot.W + x) * 4 + 3];
      if (a > 0 && a < 250) soft += 1;
      if (a < 20) continue;
      n += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { n, minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1, soft };
}

describe('forest butterflies', () => {
  it('sizes the wingspan under a quarter of a hero', () => {
    expect(BUTTERFLY_SPAN_FRAC).toBeLessThanOrEqual(0.25);
    expect(BUTTERFLY_PX_PER_UNIT).toBeCloseTo(BUTTERFLY_SPAN_PX / (HERO * BUTTERFLY_SPAN_FRAC), 5);
    expect(BUTTERFLY_SPAN_PX / BUTTERFLY_PX_PER_UNIT).toBeCloseTo(HERO * BUTTERFLY_SPAN_FRAC, 5);
  });

  it('turns butterflies on in the forest and leaves other themes off', () => {
    const forest = crittersFor('forest');
    expect(forest.butterfly.enabled).toBe(true);
    expect(forest.butterfly.min).toBe(BUTTERFLY_COUNT_MIN);
    expect(forest.butterfly.max).toBe(BUTTERFLY_COUNT_MAX);
    expect(forest.bird.enabled).toBe(true);
    expect(crittersFor('moor').butterfly.enabled).toBe(false);
    expect(crittersFor('ancient').butterfly.enabled).toBe(false);
    const bumped = crittersFor('moor', { butterfly: { enabled: true, min: 5, max: 1 } });
    expect(bumped.butterfly).toEqual({ enabled: true, min: 5, max: 5 });
  });

  it('prefers floor beside grass and records the tuft tips', () => {
    const wet = map(3);
    wet.props = [
      { kind: 'swampgrass', x: 8, y: 8, scale: 1 },
      { kind: 'swampgrass3', x: 8, y: 32, scale: 2 },
    ];
    const cells = pickButterflyCells(wet, { min: 2, max: 2 });
    expect(cells).toHaveLength(2);
    expect(pickButterflyCells(wet, { min: 2, max: 2 })).toEqual(cells);
    for (const cell of cells) {
      const near = Math.abs(cell.cx - 8) <= 2 && (Math.abs(cell.cy - 8) <= 2 || Math.abs(cell.cy - 32) <= 2);
      expect(near).toBe(true);
    }
    expect(Math.abs(cells[0].cy - cells[1].cy)).toBeGreaterThanOrEqual(14);

    const tops = grassPerches(wet);
    expect(tops).toHaveLength(2);
    expect(tops[0].x).toBeCloseTo(8 - wet.W / 2 + 0.5, 5);
    expect(tops[0].z).toBeCloseTo(8 - wet.H / 2 + 0.5, 5);
    expect(tops[0].top).toBeCloseTo(0.68 * GRASS_TIP, 5);
    expect(tops[1].top).toBeCloseTo(0.78 * 2 * GRASS_TIP, 5);

    const dry = map(9);
    expect(pickButterflyCells(dry, { min: 2, max: 2 })).toHaveLength(2);
    expect(pickButterflyCells(dry, { min: 0, max: 0 })).toEqual([]);
    expect(grassPerches(dry)).toEqual([]);
  });

  it('flaps, holds the wings open to glide, and folds them when it rests', () => {
    const open = paint({ beat: 0, t: 0.4 });
    const box = bounds(open);
    expect(box.n).toBeGreaterThan(80);
    expect(box.w).toBe(BUTTERFLY_SPAN_PX);
    expect(box.soft).toBe(0);
    expect(open.out[3]).toBe(0);
    expect(open.out[(open.W - 1) * 4 + 3]).toBe(0);

    const flap = paint({ beat: 1, t: 0.08 });
    expect(box.w - bounds(flap).w).toBeGreaterThanOrEqual(10);

    const rest = paint({ beat: 1, rest: 1, t: 0.4 });
    const folded = bounds(rest);
    expect(box.w - folded.w).toBeGreaterThanOrEqual(10);
    expect(folded.soft).toBe(0);
  });

  it('loiters in a chaotic flutter instead of bobbing in place', () => {
    const fly = makeButterfly(1, 0, 0, () => 0);
    expect(fly.hover).toBe(BUTTERFLY_LOITER_MIN);
    expect(fly.kind).toBe('butterfly');
    stepButterfly(fly, 0.8, RIGHT, () => 'floor');
    const ax = fly.x;
    const az = fly.z;
    stepButterfly(fly, 1.6, RIGHT, () => 'floor');
    expect(Math.hypot(fly.x - ax, fly.z - az)).toBeGreaterThan(0.35);
    expect(fly.travel).toBeNull();
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t <= 4; t += 0.25) {
      fly.clock = t;
      const y = butterflyAltitude(fly, 0);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    expect(hi - lo).toBeGreaterThan(0.25);
  });

  it('drifts slowly off the straight line and arrives on the spot', () => {
    expect(BUTTERFLY_SPEED).toBeLessThan(DART_SPEED / 2);
    const air = (BUTTERFLY_LOITER_MIN + BUTTERFLY_LOITER_MAX) / 2
      + ((BUTTERFLY_DRIFT_MIN + BUTTERFLY_DRIFT_MAX) / 2) / BUTTERFLY_SPEED;
    const leaf = BUTTERFLY_PERCH_CHANCE * (BUTTERFLY_PERCH_MIN + BUTTERFLY_PERCH_MAX) / 2;
    expect(air).toBeGreaterThan(leaf * 2);

    const fly = makeButterfly(1, 0, 0, () => 0);
    fly.hover = 0;
    stepButterfly(fly, 0.05, RIGHT, () => 'floor');
    expect(fly.travel.perch).toBeFalsy();
    const tr = fly.travel;
    expect(tr.toX - tr.fromX).toBeCloseTo(BUTTERFLY_DRIFT_MIN, 5);
    expect(tr.dur).toBeCloseTo(BUTTERFLY_DRIFT_MIN / BUTTERFLY_SPEED, 5);
    const chord = butterflyDriftPoint(
      { fromX: 0, fromZ: 0, toX: BUTTERFLY_DRIFT_MIN, toZ: 0 },
      0.5,
      fly.phase,
    );
    expect(Math.abs(chord.z)).toBeGreaterThan(0.4);
    const ends = butterflyDriftPoint(
      { fromX: 0, fromZ: 0, toX: BUTTERFLY_DRIFT_MIN, toZ: 0 },
      1,
      fly.phase,
    );
    expect(ends.x).toBeCloseTo(BUTTERFLY_DRIFT_MIN, 5);
    expect(ends.z).toBeCloseTo(0, 5);

    const dur = tr.dur;
    stepButterfly(fly, dur - BUTTERFLY_GLIDE - 0.02, RIGHT, () => 'floor');
    expect(fly.travel).toBeTruthy();
    expect(fly.beat).toBe(1);
    stepButterfly(fly, 0.08, RIGHT, () => 'floor');
    expect(fly.travel).toBeTruthy();
    expect(fly.beat).toBe(0);

    stepButterfly(fly, dur, RIGHT, () => 'floor');
    expect(fly.travel).toBeNull();
    expect(fly.x).toBeCloseTo(tr.toX, 5);
    expect(fly.z).toBeCloseTo(tr.toZ, 5);
    expect(fly.beat).toBe(1);
  });

  it('sits on a leaf less often, and a threat floats it away', () => {
    const tuft = { x: 4, z: 0, top: 0.7 };
    const fly = makeButterfly(1, 0, 0, () => 0);
    fly.perches = [tuft];
    fly.hover = 0;
    stepButterfly(fly, 0.05, RIGHT, () => 'floor');
    expect(fly.travel.perch).toBe(true);
    expect(fly.travel.toX).toBe(4);
    stepButterfly(fly, fly.travel.dur, RIGHT, () => 'floor');
    expect(fly.x).toBe(4);
    expect(fly.rest).toBe(BUTTERFLY_PERCH_MIN);
    expect(fly.rest).toBeLessThan(30);
    expect(fly.beat).toBe(0);
    expect(butterflyAltitude(fly, 2)).toBeCloseTo(2 + tuft.top + PERCH_LIFT, 5);
    stepButterfly(fly, 1, RIGHT, () => 'floor');
    expect(fly.x).toBe(4);
    expect(fly.rest).toBeCloseTo(BUTTERFLY_PERCH_MIN - 1, 5);

    const skip = makeButterfly(1, 0, 0, () => 0);
    let n = 0;
    skip.rng = () => (n++ === 0 ? 0.5 : 0);
    skip.perches = [tuft];
    skip.hover = 0;
    stepButterfly(skip, 0.05, RIGHT, () => 'floor');
    expect(skip.travel.perch).toBeFalsy();
    expect(skip.travel.dur).toBeCloseTo(BUTTERFLY_DRIFT_MIN / BUTTERFLY_SPEED, 5);

    const spooked = makeButterfly(1, 0, 0, () => 0);
    spooked.hover = 8;
    spooked.rng = () => 0;
    stepButterfly(spooked, 0.05, RIGHT, () => 'floor', [{ x: 2, z: 0 }]);
    expect(spooked.travel.flee).toBe(true);
    expect(spooked.travel.toX).toBeCloseTo(-BUTTERFLY_DRIFT_MIN, 5);
    expect(spooked.travel.dur).toBeCloseTo(BUTTERFLY_DRIFT_MIN / BUTTERFLY_FLEE_SPEED, 5);
    expect(spooked.x).toBe(0);
    const held = spooked.travel.toX;
    stepButterfly(spooked, 0.05, RIGHT, () => 'floor', [{ x: -1, z: 0 }]);
    expect(spooked.travel.toX).toBe(held);
    expect(spooked.x).not.toBe(0);
  });
});
