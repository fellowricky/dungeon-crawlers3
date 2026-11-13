import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createFrame, createFx, composite } from '../src/vendor/pixelfx/core/index.js';
import * as birdFx from '../src/vendor/pixelfx/fx/critters/bird.js';
import * as batFx from '../src/vendor/pixelfx/fx/critters/bat.js';
import { coatOf, PECK_NOD_AT } from '../src/vendor/pixelfx/fx/critters/bird.js';
import { cameraBasisFromYawPitch } from '../src/game/span_ribbon.js';
import { FLOOR } from '../src/game/constants.js';
import { crittersFor, WATER_SPAWN_CHANCE, ambientThreats } from '../src/render/ambient_critters.js';
import {
  BIRD_BODY_PX, BIRD_BODY_FRAC, BIRD_PX_PER_UNIT, BIRD_FOOT_PX,
  BAT_BODY_PX, BAT_BODY_FRAC, BAT_PX_PER_UNIT,
  FLYER_MIN_SPAN, FLY_ARC, PERCH_NUDGE, BIRD_SPEED, BIRD_REST_MIN,
  BIRD_PECK_MIN, BIRD_GROUND_LIFT, FLEE_TILES, BAT_HANG_DROP,
  pickTreeFlyers, makeFlyer, stepFlyer, sitOf, flightWeave,
  branchGrips, limbWorld, collectPerches,
} from '../src/render/ambient_flyers.js';

const RIGHT = cameraBasisFromYawPitch(Math.PI / 4, 0.64).right;
const HERO = 1.125;

function paint(mod, opts, time) {
  const [W, H] = mod.meta.size;
  const [ox, oy] = mod.meta.origin;
  const frame = createFrame(W, H);
  const fx = createFx(mod, { x: ox, y: oy, ...opts });
  if (time) fx.update(time);
  fx.draw(frame);
  const out = new Uint8ClampedArray(W * H * 4);
  composite(frame, out, null);
  return { W, H, ox, oy, out };
}

function bounds(p) {
  let minX = p.W, maxX = -1, minY = p.H, maxY = -1;
  for (let y = 0; y < p.H; y++) {
    for (let x = 0; x < p.W; x++) {
      if (p.out[(y * p.W + x) * 4 + 3] <= 40) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

function hasHex(buf, hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  for (let i = 0; i < buf.length; i += 4) {
    if (buf[i + 3] > 20 && buf[i] === r && buf[i + 1] === g && buf[i + 2] === b) return true;
  }
  return false;
}

function beakBottom(p) {
  let maxY = -1;
  for (let y = 0; y < p.H; y++) {
    for (let x = 0; x < p.W; x++) {
      const i = (y * p.W + x) * 4;
      if (p.out[i + 3] < 20) continue;
      if (p.out[i] === 0xf0 && p.out[i + 1] === 0xb0 && p.out[i + 2] === 0x30 && y > maxY) maxY = y;
    }
  }
  return maxY;
}

function seq(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

/** Open floor around cell (10, 10), so the first peck cell is four tiles north. */
function peckDungeon(room = 3) {
  const W = 20;
  const H = 20;
  const grid = new Uint8Array(W * H);
  const roomId = new Int16Array(W * H);
  grid.fill(FLOOR);
  roomId.fill(room);
  return { W, H, grid, roomId };
}

function colorDiff(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  }
  return n;
}

function pair(room, x, z) {
  return [
    { cx: Math.round(x), cy: Math.round(z), x, z, y: 3, room },
    { cx: Math.round(x + 10), cy: Math.round(z), x: x + 10, z, y: 3.4, room },
  ];
}

function map(perches, seed = 4) {
  return { seed, W: 120, H: 30, perches };
}

describe('forest birds and boneyard bats', () => {
  it('sizes the body under a quarter of a hero', () => {
    expect(BIRD_PX_PER_UNIT).toBeCloseTo(BIRD_BODY_PX / (HERO * BIRD_BODY_FRAC), 5);
    expect(BAT_PX_PER_UNIT).toBeCloseTo(BAT_BODY_PX / (HERO * BAT_BODY_FRAC), 5);
    expect(BIRD_BODY_FRAC).toBeLessThanOrEqual(0.25);
    expect(BAT_BODY_FRAC).toBeLessThanOrEqual(0.25);
    expect(BIRD_BODY_FRAC).toBeLessThan(0.22);
  });

  it('turns birds on in the forest and bats on in the boneyard', () => {
    const forest = crittersFor('forest');
    expect(forest.bird.enabled).toBe(true);
    expect(forest.bird.min).toBe(2);
    expect(forest.bird.max).toBe(3);
    expect(forest.bat.enabled).toBe(false);
    expect(forest.frog.enabled).toBe(false);
    expect(forest.snake.enabled).toBe(false);

    const bone = crittersFor('boneyard');
    expect(bone.bat.enabled).toBe(true);
    expect(bone.bat.min).toBe(2);
    expect(bone.bat.max).toBe(3);
    expect(bone.bird.enabled).toBe(false);

    const moor = crittersFor('moor');
    expect(moor.frog.enabled).toBe(true);
    expect(moor.frog.chance).toBe(WATER_SPAWN_CHANCE);
    expect(moor.snake.min).toBe(2);
    expect(moor.snake.max).toBe(3);
    expect(moor.bird.enabled).toBe(false);
    expect(moor.bat.enabled).toBe(false);

    const ancient = crittersFor('ancient');
    expect(ancient.bird.enabled).toBe(false);
    expect(ancient.bat.enabled).toBe(false);

    const bumped = crittersFor('forest', { bird: { min: 5, max: 1 } });
    expect(bumped.bird.min).toBe(5);
    expect(bumped.bird.max).toBe(5);
    expect(bumped.bat.enabled).toBe(false);
  });

  it('puts one flyer in each clearing that has two distant trees', () => {
    const perches = [
      ...pair(0, 0, 0),
      ...pair(1, 50, 0),
      ...pair(2, 100, 0),
      { cx: 4, cy: 4, x: 4, z: 20, y: 2, room: 9 },
      { cx: 6, cy: 4, x: 7, z: 21, y: 2, room: 9 },
    ];
    const d = map(perches);
    expect(pickTreeFlyers(d, { min: 0, max: 0, kind: 'bird' })).toEqual([]);
    expect(pickTreeFlyers(map([]), { min: 2, max: 2, kind: 'bird' })).toEqual([]);
    expect(pickTreeFlyers(map(perches.slice(-2)), { min: 2, max: 3, kind: 'bat' })).toEqual([]);

    const two = pickTreeFlyers(d, { min: 2, max: 2, kind: 'bird' });
    expect(two).toHaveLength(2);
    expect(new Set(two.map((p) => p.home.room)).size).toBe(2);
    for (const plan of two) {
      expect(plan.home.room).not.toBe(9);
      expect(plan.trees.every((t) => t.room === plan.home.room)).toBe(true);
      expect(plan.trees.some((t) => Math.hypot(t.x - plan.home.x, t.z - plan.home.z) >= FLYER_MIN_SPAN)).toBe(true);
    }
    expect(JSON.stringify(pickTreeFlyers(d, { min: 2, max: 2, kind: 'bird' }))).toBe(JSON.stringify(two));

    const bumped = pickTreeFlyers(d, { min: 4, max: 1, kind: 'bat' });
    expect(bumped).toHaveLength(3);
    expect(new Set(bumped.map((p) => p.home.room)).size).toBe(3);
  });

  it('borrows room 0 from the nearest floor when the tree stands on a wall', () => {
    const W = 24, H = 12;
    const grid = new Uint8Array(W * H);
    const roomId = new Int16Array(W * H).fill(-1);
    for (let x = 0; x < W; x++) {
      grid[5 * W + x] = FLOOR;
      roomId[5 * W + x] = 0;
    }
    const d = {
      seed: 9, W, H, grid, roomId,
      perches: [
        { cx: 2, cy: 2, x: 2, z: 2, y: 4, room: -1 },
        { cx: 14, cy: 2, x: 14, z: 2, y: 4.5, room: -1 },
      ],
    };
    const plans = pickTreeFlyers(d, { min: 1, max: 1, kind: 'bird' });
    expect(plans).toHaveLength(1);
    expect(plans[0].home.room).toBe(0);
    expect(Math.hypot(plans[0].trees[0].x - plans[0].trees[1].x, plans[0].trees[0].z - plans[0].trees[1].z)).toBeGreaterThanOrEqual(FLYER_MIN_SPAN);
  });

  it('flies to the other tree of the same clearing and sits again', () => {
    const home = { x: 0, z: 0, y: 2, room: 1 };
    const dest = { x: 12, z: 0, y: 2, room: 1 };
    const flyer = makeFlyer({
      kind: 'bird', seed: 1, home, trees: [home, dest], ax: 6, az: 0,
    }, () => 0);
    const n = PERCH_NUDGE * Math.SQRT1_2;
    expect(flyer.x).toBeCloseTo(home.x + n, 5);
    expect(flyer.z).toBeCloseTo(home.z + n, 5);
    expect(flyer.y).toBeCloseTo(home.y + BIRD_FOOT_PX / BIRD_PX_PER_UNIT, 5);
    expect(flyer.pose).toBe(1);
    expect(flyer.flip).toBe(false);
    expect(flyer.rest).toBe(BIRD_REST_MIN);

    flyer.rest = 0;
    stepFlyer(flyer, 0.05, RIGHT);
    expect(flyer.travel).toBeTruthy();
    expect(flyer.pose).toBe(0);
    expect(flyer.flip).toBe(false);
    expect(flyer.travel.dur).toBeCloseTo(12 / BIRD_SPEED, 5);
    const dur = flyer.travel.dur;
    stepFlyer(flyer, dur / 2, RIGHT);
    expect(flyer.x).toBeGreaterThan(1);
    expect(flyer.y).toBeCloseTo(sitOf(home, 'bird').y + FLY_ARC, 4);
    stepFlyer(flyer, dur / 2, RIGHT);
    expect(flyer.travel).toBeNull();
    expect(flyer.pose).toBe(1);
    expect(flyer.perch).toBe(dest);
    expect(flyer.x).toBeCloseTo(sitOf(dest, 'bird').x, 5);
    expect(flyer.z).toBeCloseTo(sitOf(dest, 'bird').z, 5);
    expect(flyer.rest).toBeGreaterThanOrEqual(BIRD_REST_MIN);

    const north = makeFlyer({
      kind: 'bat', seed: 2, home, trees: [home, { x: 0, z: 12, y: 2, room: 1 }], ax: 0, az: 6,
    }, () => 0);
    expect(north.y).toBeCloseTo(home.y, 5);
    north.rest = 0;
    stepFlyer(north, 0.05, RIGHT);
    expect(north.flip).toBe(true);
    expect(north.pose).toBe(0);
  });

  it('stays put when the other trees are too close', () => {
    const home = { x: 0, z: 0, y: 1, room: 0 };
    const near = { x: 3, z: 0, y: 1, room: 0 };
    const flyer = makeFlyer({ kind: 'bird', seed: 1, home, trees: [home, near], ax: 1, az: 0 }, () => 0);
    flyer.rest = 0;
    stepFlyer(flyer, 0.05, RIGHT);
    expect(flyer.travel).toBeNull();
    expect(flyer.pose).toBe(1);
    expect(flyer.x).toBeCloseTo(sitOf(home, 'bird').x, 5);
  });

  it('folds the bird and hangs the bat, and keeps the coats apart', () => {
    const perch = bounds(paint(birdFx, { seed: 1, perch: 1 }, 0));
    const up = bounds(paint(birdFx, { seed: 1, perch: 0 }, 0.05));
    expect(perch.h).toBeLessThan(up.h - 2);
    expect(perch.w).toBeLessThan(up.w);

    const robin = paint(birdFx, { seed: 1, perch: 1 }, 0);
    const sparrow = paint(birdFx, { seed: 2, perch: 1 }, 0);
    expect(coatOf(1).name).toBe('robin');
    expect(coatOf(2).name).toBe('sparrow');
    expect(colorDiff(robin.out, sparrow.out)).toBeGreaterThan(20);

    const roost = paint(batFx, { seed: 1, roost: 1 }, 0);
    const flap = paint(batFx, { seed: 1, roost: 0 }, 0);
    const roostBox = bounds(roost);
    const flapBox = bounds(flap);
    expect(roostBox.w).toBeLessThan(flapBox.w - 6);
    expect(roostBox.maxY).toBeGreaterThan(roost.oy + 6);
    expect(roostBox.minY).toBeLessThan(roost.oy);
    for (const hex of ['#ff3b30', '#ffb04a', '#fff0c0']) {
      expect(hasHex(roost.out, hex)).toBe(false);
      expect(hasHex(flap.out, hex)).toBe(false);
    }
    for (let i = 0; i < roost.out.length; i += 4) {
      if (roost.out[i + 3] < 20) continue;
      expect(roost.out[i] > 220 && roost.out[i + 1] < 80 && roost.out[i + 2] < 80).toBe(false);
    }
  });

  it('drops to the ground, pecks, then flies back up', () => {
    const home = { cx: 10, cy: 10, x: 0.5, z: 0.5, y: 2, room: 3 };
    const dest = { cx: 22, cy: 10, x: 12.5, z: 0.5, y: 2, room: 3 };
    const flyer = makeFlyer({
      kind: 'bird', seed: 1, home, trees: [home, dest], ax: 6, az: 0,
    }, () => 0);
    expect(flyer.pose).toBe(1);
    flyer.rng = seq([0.9, 0, 0]);
    flyer.rest = 0;
    const world = { d: peckDungeon() };
    stepFlyer(flyer, 0.05, RIGHT, world);
    expect(flyer.pose).toBe(0);
    expect(flyer.travel.ground).toBe(true);
    expect(flyer.travel.toX).toBeCloseTo(0.5, 5);
    expect(flyer.travel.toZ).toBeCloseTo(-3.5, 5);
    expect(flyer.travel.toY).toBeCloseTo(BIRD_FOOT_PX / BIRD_PX_PER_UNIT + BIRD_GROUND_LIFT, 5);
    const dur = flyer.travel.dur;
    stepFlyer(flyer, dur, RIGHT, world);
    expect(flyer.travel).toBeNull();
    expect(flyer.pose).toBe(2);
    expect(flyer.x).toBeCloseTo(0.5, 5);
    expect(flyer.z).toBeCloseTo(-3.5, 5);
    expect(flyer.y).toBeCloseTo(BIRD_FOOT_PX / BIRD_PX_PER_UNIT + BIRD_GROUND_LIFT, 5);
    expect(flyer.peck).toBeCloseTo(BIRD_PECK_MIN, 5);

    flyer.peck = 0;
    flyer.rng = () => 0;
    stepFlyer(flyer, 0.05, RIGHT, world);
    expect(flyer.pose).toBe(0);
    expect(flyer.travel.ground).toBeFalsy();
    expect(flyer.travel.dest).toBe(dest);

    const upright = paint(birdFx, { seed: 1, peck: 1 }, 0);
    const dipped = paint(birdFx, { seed: 1, peck: 1 }, PECK_NOD_AT);
    const flying = paint(birdFx, { seed: 1, perch: 0 }, 0.05);
    expect(beakBottom(dipped)).toBeGreaterThan(beakBottom(upright) + 1);
    expect(bounds(upright).maxY).toBe(bounds(dipped).maxY);
    expect(bounds(dipped).w).toBeLessThan(bounds(flying).w);
  });

  it('starts some birds already pecking', () => {
    const home = { cx: 10, cy: 10, x: 0.5, z: 0.5, y: 2, room: 3 };
    const flyer = makeFlyer({
      kind: 'bird', seed: 1, home, trees: [home, { x: 12.5, z: 0.5, y: 2, room: 3 }], ax: 6, az: 0,
    }, seq([0.9, 0, 0, 0]), { d: peckDungeon() });
    expect(flyer.pose).toBe(2);
    expect(flyer.x).toBeCloseTo(0.5, 5);
    expect(flyer.z).toBeCloseTo(-3.5, 5);
    expect(flyer.peck).toBeCloseTo(BIRD_PECK_MIN, 5);
  });

  it('flies away from a living hero or monster within five tiles', () => {
    const home = { x: 0, z: 0, y: 2, room: 1 };
    const east = { x: 12, z: 0, y: 2, room: 1 };
    const north = { x: 0, z: 12, y: 2, room: 1 };
    const flyer = makeFlyer({
      kind: 'bird', seed: 1, home, trees: [home, east, north], ax: 4, az: 4,
    }, () => 0);
    const rest = flyer.rest;
    stepFlyer(flyer, 0.05, RIGHT, { threats: [{ x: flyer.x + FLEE_TILES + 0.01, z: flyer.z }] });
    expect(flyer.travel).toBeNull();
    expect(flyer.pose).toBe(1);
    expect(flyer.rest).toBeCloseTo(rest - 0.05, 5);

    stepFlyer(flyer, 0.05, RIGHT, { threats: [{ x: flyer.x + FLEE_TILES, z: flyer.z, y: 40 }] });
    expect(flyer.pose).toBe(0);
    expect(flyer.travel.flee).toBe(true);
    expect(flyer.travel.dest).toBe(north);
    expect(flyer.travel.age).toBe(0);

    stepFlyer(flyer, 0.05, RIGHT, { threats: [{ x: north.x, z: north.z }] });
    expect(flyer.travel.dest).toBe(north);
    expect(flyer.travel.age).toBeCloseTo(0.05, 5);

    const bat = makeFlyer({
      kind: 'bat', seed: 2, home, trees: [home, east], ax: 6, az: 0,
    }, () => 0);
    stepFlyer(bat, 0.05, RIGHT, { threats: [{ x: bat.x, z: bat.z }] });
    expect(bat.pose).toBe(0);
    expect(bat.travel.flee).toBe(true);
    expect(bat.travel.dest).toBe(east);
    expect(bat.travel.age).toBe(0);

    const threats = ambientThreats({
      heroes: [
        { x: 1, z: 2, data: { hp: 5 } },
        { x: 3, z: 4, data: { hp: 0 } },
        { z: 1, data: { hp: 5 } },
      ],
      monsters: [
        { x: 8, z: 9, active: true, data: { hp: 3 } },
        { x: 5, z: 5, active: false, data: { hp: 3 } },
        { x: 6, z: 6, dead: true, data: { hp: 3 } },
      ],
    });
    expect(threats).toEqual([{ x: 1, z: 2 }, { x: 8, z: 9 }]);
  });

  it('sits a bird on a limb and hangs a bat under it', () => {
    const plain = { x: 1, y: 2, z: 3 };
    const n = PERCH_NUDGE * Math.SQRT1_2;
    expect(sitOf(plain, 'bat').x).toBeCloseTo(1 + n, 5);
    expect(sitOf(plain, 'bat').z).toBeCloseTo(3 + n, 5);
    expect(sitOf(plain, 'bird').y).toBeCloseTo(2 + BIRD_FOOT_PX / BIRD_PX_PER_UNIT, 5);

    const limb = { x: 5, y: 4, z: 6, room: 1, limb: 1, hx: 5.1, hy: 3.7, hz: 6.2 };
    const bird = sitOf(limb, 'bird');
    expect(bird.x).toBeCloseTo(5, 5);
    expect(bird.z).toBeCloseTo(6, 5);
    expect(bird.y).toBeCloseTo(4 + BIRD_FOOT_PX / BIRD_PX_PER_UNIT, 5);
    const bat = sitOf(limb, 'bat');
    expect(bat.x).toBeCloseTo(5.1, 5);
    expect(bat.z).toBeCloseTo(6.2, 5);
    expect(bat.y).toBeCloseTo(3.7 - BAT_HANG_DROP, 5);
    expect(bat.y).toBeLessThan(limb.hy);

    const perched = makeFlyer({
      kind: 'bat', seed: 1, home: limb, trees: [limb], ax: 0, az: 0,
    }, () => 0);
    expect(perched.x).toBeCloseTo(bat.x, 5);
    expect(perched.y).toBeCloseTo(bat.y, 5);
    expect(perched.z).toBeCloseTo(bat.z, 5);

    const kept = collectPerches({
      perches: [
        limb,
        { cx: 2, cy: 2, x: 8, z: 9, y: 1, room: 1 },
      ],
    });
    expect(kept[0].hx).toBeCloseTo(5.1, 5);
    expect(kept[0].hy).toBeCloseTo(3.7, 5);
    expect(kept[0].hz).toBeCloseTo(6.2, 5);
    expect(kept[0].limb).toBe(1);
    expect(kept[1].limb).toBeUndefined();
  });

  it('finds the top and the underside of a side branch', () => {
    const pole = [];
    for (let i = 0; i < 16; i++) {
      const y = i / 15;
      for (let a = 0; a < 12; a++) {
        const t = (a / 12) * Math.PI * 2;
        pole.push([Math.cos(t) * 0.05, y, Math.sin(t) * 0.05]);
      }
    }
    const attr = (pts) => ({
      count: pts.length,
      getX: (i) => pts[i][0],
      getY: (i) => pts[i][1],
      getZ: (i) => pts[i][2],
    });
    expect(branchGrips(attr(pole))).toBeNull();

    const branched = pole.slice();
    for (const x of [0.20, 0.24, 0.28, 0.32, 0.36, 0.40, 0.44, 0.48]) {
      for (const y of [0.58, 0.60, 0.64, 0.66]) {
        for (const z of [-0.02, 0, 0.02]) branched.push([x, y, z]);
      }
    }
    const g = branchGrips(attr(branched));
    expect(g.stand.x).toBeGreaterThan(0.3);
    expect(g.hang.x).toBeGreaterThan(0.3);
    expect(g.stand.y).toBeGreaterThan(g.hang.y);
    expect(Math.abs(g.stand.z)).toBeLessThan(0.05);
    expect(Math.abs(g.hang.z)).toBeLessThan(0.05);

    const turned = limbWorld({ x: 1, y: 0, z: 0 }, 0, 0, 0, 1, 1, 1, 0, Math.PI / 2, 0);
    expect(turned.x).toBeCloseTo(0, 5);
    expect(turned.y).toBeCloseTo(0, 5);
    expect(turned.z).toBeCloseTo(-1, 5);

    const local = { x: 0.4, y: 0.6, z: -0.1 };
    const got = limbWorld(local, 3, 1, -2, 2, 3, 4, 0.04, 1.2, -0.05);
    const v = new THREE.Vector3(local.x, local.y, local.z).applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(3, 1, -2),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.04, 1.2, -0.05, 'XYZ')),
        new THREE.Vector3(2, 3, 4),
      ),
    );
    expect(got.x).toBeCloseTo(v.x, 5);
    expect(got.y).toBeCloseTo(v.y, 5);
    expect(got.z).toBeCloseTo(v.z, 5);
  });

  it('darts a bat and bends a bird, and both leave and arrive on the line', () => {
    for (const kind of ['bird', 'bat']) {
      for (const u of [0, 1]) {
        const w = flightWeave(kind, u, 0.37, 12);
        expect(w.side).toBeCloseTo(0, 5);
        expect(w.lift).toBeCloseTo(0, 5);
        expect(w.surge).toBeCloseTo(0, 5);
      }
    }
    const crest = flightWeave('bird', 0.5, 0.8, 12);
    expect(crest.side).toBeCloseTo(0, 5);
    expect(crest.lift).toBeCloseTo(0, 5);
    expect(crest.surge).toBe(0);
    expect(Math.abs(flightWeave('bird', 0.25, 0.2, 12).side)).toBeGreaterThan(0.5);

    let flips = 0;
    let prev = 0;
    let peak = 0;
    for (let i = 1; i < 32; i++) {
      const side = flightWeave('bat', i / 32, 0.2, 14).side;
      if (Math.abs(side) > peak) peak = Math.abs(side);
      if (prev && side && Math.sign(side) !== Math.sign(prev)) flips += 1;
      prev = side;
    }
    expect(flips).toBeGreaterThanOrEqual(2);
    expect(peak).toBeGreaterThan(Math.abs(flightWeave('bird', 0.25, 0.2, 14).side));

    const other = flightWeave('bat', 0.33, 0.72, 16);
    const one = flightWeave('bat', 0.33, 0.15, 16);
    expect(Math.abs(one.side - other.side) + Math.abs(one.lift - other.lift)).toBeGreaterThan(0.2);

    const home = { x: 0, z: 0, y: 2, room: 1 };
    const dest = { x: 12, z: 0, y: 2, room: 1 };
    const bat = makeFlyer({
      kind: 'bat', seed: 4, home, trees: [home, dest], ax: 6, az: 0,
    }, () => 0);
    bat.rest = 0;
    stepFlyer(bat, 0.05, RIGHT);
    const tr = bat.travel;
    tr.age = 0;
    const u = 0.37;
    stepFlyer(bat, tr.dur * u, RIGHT);
    const dx = tr.toX - tr.fromX;
    const dz = tr.toZ - tr.fromZ;
    const span = Math.hypot(dx, dz);
    const s = u * u * (3 - 2 * u);
    const w = flightWeave('bat', u, tr.phase, tr.dist);
    expect(bat.x).toBeCloseTo(tr.fromX + dx * s + (-dz / span) * w.side + (dx / span) * w.surge, 4);
    expect(bat.z).toBeCloseTo(tr.fromZ + dz * s + (dx / span) * w.side + (dz / span) * w.surge, 4);
    expect(Math.abs(w.side) + Math.abs(w.lift)).toBeGreaterThan(0.3);
    stepFlyer(bat, tr.dur, RIGHT);
    expect(bat.travel).toBeNull();
    expect(bat.x).toBeCloseTo(sitOf(dest, 'bat').x, 5);
    expect(bat.z).toBeCloseTo(sitOf(dest, 'bat').z, 5);
  });
});
