import { describe, it, expect } from 'vitest';
import { createFrame, clearFrame, createFx, composite } from '../src/vendor/pixelfx/core/index.js';
import * as dragonflyFx from '../src/vendor/pixelfx/fx/critters/dragonfly.js';
import { posedWing, sweptWing } from '../src/vendor/pixelfx/fx/critters/insect.js';
import { cameraBasisFromYawPitch } from '../src/game/span_ribbon.js';
import { FLOOR, POOL } from '../src/game/constants.js';
import { crittersFor } from '../src/render/ambient_critters.js';
import {
  DRAGONFLY_SPAN_PX,
  DRAGONFLY_SPAN_FRAC,
  DRAGONFLY_PX_PER_UNIT,
  DRAGONFLY_COUNT_MIN,
  DRAGONFLY_COUNT_MAX,
  HOVER_MIN,
  DART_MIN,
  DART_SPEED,
  GLIDE_TIME,
  HOME_R,
  HOVER_Y,
  DART_ARC,
  pickDragonflyCells,
  planDragonflyDart,
  planDragonflyFlee,
  planInsectPerch,
  PERCH_MIN,
  PERCH_LIFT,
  makeDragonfly,
  stepDragonfly,
  dragonflyAltitude,
} from '../src/render/ambient_insects.js';

const HERO = 1.125;
const RIGHT = cameraBasisFromYawPitch(Math.PI / 4, 0.64).right;

function map(seed = 3) {
  const W = 40, H = 48, n = W * H;
  return {
    themeKey: 'moor',
    seed,
    W, H,
    grid: new Uint8Array(n).fill(FLOOR),
    solidProps: new Uint8Array(n),
  };
}

function pond(d, cx, cy) {
  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 1; x <= cx + 1; x++) d.grid[y * d.W + x] = POOL;
  }
}

function paint(opts) {
  const [W, H] = dragonflyFx.meta.size;
  const [ox, oy] = dragonflyFx.meta.origin;
  const frame = createFrame(W, H);
  const fx = createFx(dragonflyFx, { x: ox, y: oy, seed: 1, beat: 0, ...opts });
  fx.update(opts && opts.t != null ? opts.t : 0.2);
  clearFrame(frame);
  fx.draw(frame, 'front');
  const out = new Uint8ClampedArray(W * H * 4);
  composite(frame, out);
  return { W, H, ox, oy, out };
}

function bounds(shot) {
  let minX = shot.W, maxX = 0, minY = shot.H, maxY = 0, n = 0;
  for (let y = 0; y < shot.H; y++) {
    for (let x = 0; x < shot.W; x++) {
      if (shot.out[(y * shot.W + x) * 4 + 3] < 20) continue;
      n += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { n, minX, maxX, minY, maxY, h: maxY - minY + 1 };
}

describe('moor dragonflies', () => {
  it('sizes the wingspan under a quarter of a hero', () => {
    expect(DRAGONFLY_SPAN_FRAC).toBeLessThanOrEqual(0.25);
    expect(DRAGONFLY_PX_PER_UNIT).toBeCloseTo(DRAGONFLY_SPAN_PX / (HERO * DRAGONFLY_SPAN_FRAC), 5);
    expect(DRAGONFLY_SPAN_PX / DRAGONFLY_PX_PER_UNIT).toBeCloseTo(HERO * DRAGONFLY_SPAN_FRAC, 5);
  });

  it('turns dragonflies on in the moor and leaves other themes off', () => {
    const moor = crittersFor('moor');
    expect(moor.dragonfly.enabled).toBe(true);
    expect(moor.dragonfly.min).toBe(DRAGONFLY_COUNT_MIN);
    expect(moor.dragonfly.max).toBe(DRAGONFLY_COUNT_MAX);
    expect(crittersFor('forest').dragonfly.enabled).toBe(false);
    expect(crittersFor('ancient').dragonfly.enabled).toBe(false);
    const bumped = crittersFor('forest', { dragonfly: { enabled: true, min: 5, max: 1 } });
    expect(bumped.dragonfly).toEqual({ enabled: true, min: 5, max: 5 });
  });

  it('places them on banks, and on open floor when the map is dry', () => {
    const wet = map();
    pond(wet, 8, 8);
    pond(wet, 8, 32);
    const cells = pickDragonflyCells(wet, { min: 2, max: 2 });
    expect(cells).toHaveLength(2);
    expect(pickDragonflyCells(wet, { min: 2, max: 2 })).toEqual(cells);
    for (const cell of cells) {
      expect(wet.grid[cell.cy * wet.W + cell.cx]).toBe(FLOOR);
      const near = Math.abs(cell.cx - 8) <= 2 && (Math.abs(cell.cy - 8) <= 2 || Math.abs(cell.cy - 32) <= 2);
      expect(near).toBe(true);
    }
    expect(Math.abs(cells[0].cy - cells[1].cy)).toBeGreaterThanOrEqual(14);

    const dry = map(9);
    const pads = pickDragonflyCells(dry, { min: 2, max: 2 });
    expect(pads).toHaveLength(2);
    expect(pickDragonflyCells(dry, { min: 0, max: 0 })).toEqual([]);

    const sea = map(4);
    sea.grid.fill(POOL);
    expect(pickDragonflyCells(sea, { min: 2, max: 2 })).toEqual([]);
  });

  it('hovers, then darts, and glides at the end of the dart', () => {
    const fly = makeDragonfly(1, 0, 0, () => 0);
    expect(fly.hover).toBe(HOVER_MIN);
    stepDragonfly(fly, 1, RIGHT, () => 'floor');
    expect(fly.x).toBe(0);
    expect(fly.travel).toBeNull();
    expect(fly.beat).toBe(1);

    fly.hover = 0;
    fly.rng = () => 0;
    stepDragonfly(fly, 0.05, RIGHT, () => 'floor');
    expect(fly.x).toBe(0);
    expect(fly.travel.toX).toBeCloseTo(DART_MIN, 5);
    expect(fly.travel.flee).toBeFalsy();
    expect(fly.flip).toBe(false);
    expect(fly.beat).toBe(1);
    const dur = fly.travel.dur;
    expect(dur).toBeCloseTo(DART_MIN / DART_SPEED, 5);

    stepDragonfly(fly, dur - GLIDE_TIME - 0.05, RIGHT, () => 'floor');
    expect(fly.beat).toBe(1);
    expect(fly.x).toBeGreaterThan(0.4);
    stepDragonfly(fly, 0.1, RIGHT, () => 'floor');
    expect(fly.beat).toBe(0);
    expect(fly.travel).toBeTruthy();

    stepDragonfly(fly, dur, RIGHT, () => 'floor');
    expect(fly.travel).toBeNull();
    expect(fly.x).toBeCloseTo(DART_MIN, 5);
    expect(fly.beat).toBe(1);
    expect(fly.hover).toBeGreaterThanOrEqual(HOVER_MIN);

    const mid = makeDragonfly(1, 0, 0, () => 0);
    mid.travel = { fromX: 0, fromZ: 0, toX: DART_MIN, toZ: 0, age: dur / 2, dur, flee: false };
    expect(dragonflyAltitude(mid, 2)).toBeCloseTo(2 + HOVER_Y + DART_ARC, 5);
    mid.travel = null;
    mid.clock = 0;
    expect(dragonflyAltitude(mid, 2)).toBeCloseTo(2 + HOVER_Y, 5);
  });

  it('darts away from anything living within five tiles', () => {
    const fly = makeDragonfly(1, 0, 0, () => 0);
    fly.hover = 10;
    fly.rng = () => 0;
    stepDragonfly(fly, 0.05, RIGHT, () => 'floor', [{ x: 2, y: 9, z: 0 }]);
    expect(fly.travel.flee).toBe(true);
    expect(fly.travel.toX).toBeCloseTo(-DART_MIN, 5);
    expect(fly.x).toBe(0);
    expect(fly.flip).toBe(true);
    expect(fly.hover).toBe(0);
    expect(planDragonflyFlee(fly, () => 0, RIGHT, () => 'floor', { x: 2, z: 0 }).x).toBeCloseTo(-DART_MIN, 5);

    const held = fly.travel.toX;
    stepDragonfly(fly, 0.05, RIGHT, () => 'floor', [{ x: -1, z: 0 }]);
    expect(fly.travel.toX).toBe(held);
    expect(fly.x).toBeLessThan(0);

    const calm = makeDragonfly(1, 0, 0, () => 0);
    calm.hover = 10;
    calm.rng = () => 0;
    stepDragonfly(calm, 0.05, RIGHT, () => 'floor', [{ x: 5.01, z: 0 }]);
    expect(calm.travel).toBeNull();
    expect(calm.hover).toBeCloseTo(9.95, 5);

    const edge = makeDragonfly(1, 0, 0, () => 0);
    edge.hover = 4;
    edge.rng = () => 0;
    stepDragonfly(edge, 0.05, RIGHT, () => 'floor', [{ x: 5, z: 0 }]);
    expect(edge.travel.flee).toBe(true);
    expect(edge.travel.toX).toBeLessThan(0);

    const stuck = makeDragonfly(1, 0, 0, () => 0);
    stuck.hover = 10;
    stuck.rng = () => 0;
    stepDragonfly(stuck, 0.05, RIGHT, () => 'wall', [{ x: 2, z: 0 }]);
    expect(stuck.travel).toBeNull();
    expect(stuck.x).toBe(0);
    expect(stuck.hover).toBe(10);

    const gone = makeDragonfly(1, 9, 0, () => 0);
    gone.homeX = 0;
    gone.homeZ = 0;
    gone.hover = 0;
    gone.rng = () => 0;
    const back = planDragonflyDart(gone, gone.rng, RIGHT, () => 'floor');
    expect(back.x).toBeLessThan(9);
    expect(Math.hypot(back.x, back.z)).toBeLessThanOrEqual(HOME_R);

    const rim = makeDragonfly(1, 6, 0, () => 0);
    rim.homeX = 0;
    rim.homeZ = 0;
    rim.rng = () => 0;
    const kept = planDragonflyDart(rim, rim.rng, RIGHT, () => 'floor');
    expect(Math.hypot(kept.x, kept.z)).toBeLessThanOrEqual(HOME_R);
  });

  it('sits still on a grass top for about a minute, then lifts off', () => {
    const tuft = { x: 4, z: 0, top: 0.7 };
    const fly = makeDragonfly(1, 0, 0, () => 0);
    fly.perches = [tuft];
    fly.hover = 0;
    stepDragonfly(fly, 0.05, RIGHT, () => 'floor');
    expect(fly.x).toBe(0);
    expect(fly.travel.perch).toBe(true);
    expect(fly.travel.toX).toBe(4);
    expect(fly.beat).toBe(1);

    stepDragonfly(fly, fly.travel.dur, RIGHT, () => 'floor');
    expect(fly.travel).toBeNull();
    expect(fly.x).toBe(4);
    expect(fly.z).toBe(0);
    expect(fly.rest).toBe(PERCH_MIN);
    expect(fly.beat).toBe(0);
    expect(dragonflyAltitude(fly, 2)).toBeCloseTo(2 + tuft.top + PERCH_LIFT, 5);

    stepDragonfly(fly, 1, RIGHT, () => 'floor');
    expect(fly.x).toBe(4);
    expect(fly.rest).toBeCloseTo(PERCH_MIN - 1, 5);
    expect(fly.beat).toBe(0);

    const spooked = makeDragonfly(1, 4, 0, () => 0);
    spooked.rest = 20;
    spooked.perchTop = 0.7;
    spooked.hover = 0;
    stepDragonfly(spooked, 0.05, RIGHT, () => 'floor', [{ x: 6, z: 0 }]);
    expect(spooked.travel.flee).toBe(true);
    expect(spooked.rest).toBe(0);
    expect(spooked.x).toBe(4);

    const stuck = makeDragonfly(1, 4, 0, () => 0);
    stuck.rest = 20;
    stuck.perchTop = 0.7;
    stepDragonfly(stuck, 0.05, RIGHT, () => 'wall', [{ x: 6, z: 0 }]);
    expect(stuck.travel).toBeNull();
    expect(stuck.rest).toBe(20);
    expect(stuck.beat).toBe(0);

    const done = makeDragonfly(1, 4, 0, () => 0);
    done.rest = 0.02;
    done.perchTop = 0.7;
    stepDragonfly(done, 0.05, RIGHT, () => 'floor');
    expect(done.rest).toBe(0);
    expect(done.travel).toBeNull();
    expect(done.x).toBe(4);
    expect(done.beat).toBe(1);
    expect(done.hover).toBeGreaterThanOrEqual(HOVER_MIN);

    const skip = makeDragonfly(1, 0, 0, () => 0);
    let n = 0;
    skip.rng = () => (n++ === 0 ? 0.9 : 0);
    skip.perches = [tuft];
    skip.hover = 0;
    stepDragonfly(skip, 0.05, RIGHT, () => 'floor');
    expect(skip.travel.perch).toBeFalsy();
    expect(skip.travel.toX).toBeCloseTo(DART_MIN, 5);
    expect(planInsectPerch(skip, () => 0.9, RIGHT, () => 'floor')).toBeNull();
  });

  it('paints a long body and four wings, and a flip turns the head', () => {
    const wing = [[0, 0], [0, -10]];
    expect(posedWing(wing, 1)[1][1]).toBeCloseTo(-10, 5);
    expect(posedWing(wing, 0.5)[1][1]).toBeCloseTo(-5, 5);
    // A point above the hinge swings toward screen-right on a positive turn.
    expect(sweptWing(wing, Math.PI / 2)[1][0]).toBeCloseTo(10, 5);

    const glide = paint({ beat: 0, t: 0.2 });
    const box = bounds(glide);
    expect(box.n).toBeGreaterThan(80);
    expect(box.h).toBe(DRAGONFLY_SPAN_PX);
    expect(glide.out[3]).toBe(0);
    expect(glide.out[(glide.W - 1) * 4 + 3]).toBe(0);
    for (let i = 0; i < glide.out.length; i += 4) {
      const bright = glide.out[i] > 250 && glide.out[i + 1] > 250 && glide.out[i + 2] > 250;
      expect(bright).toBe(false);
    }

    const flipped = paint({ beat: 0, t: 0.2, flip: true });
    expect(bounds(flipped).maxX).toBeGreaterThan(box.maxX);

    const buzz = paint({ beat: 1, t: 0.05 });
    let differ = 0;
    for (let i = 3; i < glide.out.length; i += 4) if (glide.out[i] !== buzz.out[i]) differ += 1;
    expect(differ).toBeGreaterThan(8);

    // Three quarters through a beat is the deep clap. The silhouette is much shorter than the open glide.
    const clap = paint({ beat: 1, t: dragonflyFx.BEAT * 0.75 });
    expect(box.h - bounds(clap).h).toBeGreaterThanOrEqual(10);

    const sit = paint({ beat: 1, rest: 1, t: 0.2 });
    expect(box.h - bounds(sit).h).toBeGreaterThanOrEqual(10);

    const steel = paint({ beat: 0, t: 0.2, seed: 2 });
    let recolored = 0;
    for (let i = 0; i < glide.out.length; i += 4) {
      if (glide.out[i + 3] < 20 || steel.out[i + 3] < 20) continue;
      if (glide.out[i] !== steel.out[i]) recolored += 1;
    }
    expect(recolored).toBeGreaterThan(10);
  });
});
