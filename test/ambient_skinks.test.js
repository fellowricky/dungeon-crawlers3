import { describe, it, expect } from 'vitest';
import { createFrame, clearFrame, createFx, composite } from '../src/vendor/pixelfx/core/index.js';
import * as skinkFx from '../src/vendor/pixelfx/fx/critters/skink.js';
import { cameraBasisFromYawPitch } from '../src/game/span_ribbon.js';
import { FLOOR, WALL, POOL } from '../src/game/constants.js';
import { generateOverland, QUEST_OVERLAND_MAP } from '../src/dungeon/dungeon_generator.js';
import { buildSolidProps } from '../src/game/pathfinding.js';
import { crittersFor, HERO_SPRITE_QUAD } from '../src/render/ambient_critters.js';
import {
  SKINK_LEN_PX,
  SKINK_LEN_FRAC,
  SKINK_PX_PER_UNIT,
  SKINK_COUNT_MIN,
  SKINK_COUNT_MAX,
  SKINK_BASK_MIN,
  SKINK_BASK_MAX,
  SKINK_STEP_MIN,
  SKINK_STEP_MAX,
  SKINK_SPEED,
  openGround,
  pickSkinkCells,
  skinkCoat,
  planSkinkScuttle,
  planSkinkFlee,
  makeSkink,
  stepSkink,
} from '../src/render/ambient_groundlings.js';

const RIGHT = cameraBasisFromYawPitch(Math.PI / 4, 0.64).right;

function field(seed = 1) {
  const W = 64, H = 48, n = W * H;
  return {
    themeKey: 'ashfield',
    seed,
    W, H,
    grid: new Uint8Array(n).fill(FLOOR),
    roadDist: new Int16Array(n).fill(8),
    solidProps: new Uint8Array(n),
    lakeMask: new Uint8Array(n),
  };
}

function paint(opts) {
  const [W, H] = skinkFx.meta.size;
  const [ox, oy] = skinkFx.meta.origin;
  const frame = createFrame(W, H);
  const fx = createFx(skinkFx, { x: ox, y: oy, seed: 1, coat: 'ash', blink: 0, scuttle: 0, step: 0, ...opts });
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

describe('ash and ruin skinks', () => {
  it('stays a short lizard, well under a hero', () => {
    const length = SKINK_LEN_PX / SKINK_PX_PER_UNIT;
    expect(length / HERO_SPRITE_QUAD).toBeCloseTo(SKINK_LEN_FRAC, 5);
    expect(SKINK_LEN_FRAC).toBeGreaterThan(0.2);
    expect(SKINK_LEN_FRAC).toBeLessThanOrEqual(0.26);
  });

  it('turns skinks on for ash and the ruins, and leaves other themes off', () => {
    const ash = crittersFor('ashfield');
    const ruin = crittersFor('ruinfield');
    expect(ash.skink).toEqual({ enabled: true, min: SKINK_COUNT_MIN, max: SKINK_COUNT_MAX });
    expect(ruin.skink).toEqual({ enabled: true, min: 2, max: 3 });
    expect(ash.squirrel.enabled).toBe(false);
    expect(crittersFor('snowfield').skink.enabled).toBe(false);
    expect(crittersFor('forest').skink.enabled).toBe(false);
    expect(crittersFor('ancient').skink.enabled).toBe(false);
    expect(crittersFor('moor', { skink: { enabled: true, min: 5, max: 1 } }).skink).toEqual({ enabled: true, min: 5, max: 5 });
    expect(skinkCoat('ashfield')).toBe('ash');
    expect(skinkCoat('ruinfield')).toBe('ruin');
  });

  it('places two or three on open stone, off the road and off lava or water', () => {
    const counts = new Set();
    for (let seed = 1; seed <= 24; seed++) {
      const d = field(seed);
      const cells = pickSkinkCells(d);
      counts.add(cells.length);
      expect(cells.length).toBeGreaterThanOrEqual(SKINK_COUNT_MIN);
      expect(cells.length).toBeLessThanOrEqual(SKINK_COUNT_MAX);
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i].cy * d.W + cells[i].cx;
        expect(d.grid[c]).toBe(FLOOR);
        expect(openGround(d, cells[i].cx - d.W / 2 + 0.5, cells[i].cy - d.H / 2 + 0.5)).toBe('open');
        for (let j = i + 1; j < cells.length; j++) {
          const dx = cells[i].cx - cells[j].cx;
          const dy = cells[i].cy - cells[j].cy;
          expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(16 * 16);
        }
      }
    }
    expect(counts.has(2)).toBe(true);
    expect(counts.has(3)).toBe(true);

    const road = field();
    road.roadDist.fill(0);
    expect(pickSkinkCells(road)).toEqual([]);
    const wet = field();
    wet.grid.fill(POOL);
    expect(pickSkinkCells(wet)).toEqual([]);
    const lake = field();
    lake.lakeMask.fill(1);
    expect(pickSkinkCells(lake)).toEqual([]);
    expect(openGround(lake, 0.5, 0.5)).toBe('pool');
    const blocked = field();
    blocked.solidProps.fill(1);
    expect(pickSkinkCells(blocked)).toEqual([]);
    const wall = field();
    wall.grid.fill(WALL);
    expect(pickSkinkCells(wall)).toEqual([]);
    expect(pickSkinkCells(field(4))).toEqual(pickSkinkCells(field(4)));
  });

  it('keeps a generated ash field\'s skinks off the road and off the lava', () => {
    const d = generateOverland({ seed: 11, themeKey: 'ashfield', level: 3, ...QUEST_OVERLAND_MAP });
    d.solidProps = buildSolidProps(d);
    const cells = pickSkinkCells(d);
    expect(cells.length).toBeGreaterThanOrEqual(2);
    expect(cells.length).toBeLessThanOrEqual(3);
    const ys = cells.map((c) => c.cy);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(16);
    for (const c of cells) {
      const idx = c.cy * d.W + c.cx;
      expect(d.grid[idx]).toBe(FLOOR);
      expect(d.lakeMask && d.lakeMask[idx]).toBeFalsy();
      if (d.roadDist) expect(d.roadDist[idx] > 2 || d.roadDist[idx] < 0).toBe(true);
    }
  });

  it('basks with the blink clock running, and the body stays put', () => {
    const skink = makeSkink(1, 1, 2, () => 0);
    expect(skink.rest).toBe(SKINK_BASK_MIN);
    expect(skink.rest).toBeLessThanOrEqual(SKINK_BASK_MAX);
    stepSkink(skink, 5, RIGHT, () => 'open');
    expect(skink.x).toBe(1);
    expect(skink.z).toBe(2);
    expect(skink.blink).toBeCloseTo(5, 5);
    expect(skink.step).toBe(0);
    expect(skink.travel).toBeNull();
  });

  it('scuttles three or four tiles, and the start frame does not move', () => {
    const skink = makeSkink(1, 0, 0, () => 0);
    let calls = 0;
    skink.rng = () => { calls += 1; return 0; };
    skink.rest = 0;
    stepSkink(skink, 0.05, RIGHT, () => 'open');
    expect(calls).toBe(2);
    expect(skink.travel).toBeTruthy();
    expect(skink.travel.flee).toBe(false);
    expect(skink.x).toBe(0);
    expect(skink.travel.toX).toBeCloseTo(SKINK_STEP_MIN, 5);
    expect(skink.travel.toZ).toBeCloseTo(0, 5);
    expect(skink.flip).toBe(false);
    const dur = skink.travel.dur;
    expect(dur).toBeCloseTo(SKINK_STEP_MIN / SKINK_SPEED, 5);
    stepSkink(skink, dur / 2, RIGHT, () => 'open');
    expect(skink.x).toBeCloseTo(SKINK_STEP_MIN * 0.5, 2);
    expect(skink.step).toBeCloseTo(dur / 2, 5);
    stepSkink(skink, dur / 2 + 0.05, RIGHT, () => 'open');
    expect(skink.travel).toBeNull();
    expect(skink.x).toBeCloseTo(SKINK_STEP_MIN, 5);
    expect(skink.z).toBeCloseTo(0, 5);
    expect(skink.rest).toBe(SKINK_BASK_MIN);
  });

  it('refuses a blocked scuttle and leaves the bask where it was', () => {
    const skink = makeSkink(1, 0, 0, () => 0);
    skink.rest = 0;
    stepSkink(skink, 0.05, RIGHT, () => 'pool');
    expect(skink.travel).toBeNull();
    expect(skink.x).toBe(0);
    expect(skink.rest).toBe(SKINK_BASK_MIN);
    const plan = planSkinkScuttle(makeSkink(1, 0, 0, () => 0), () => 0, RIGHT, () => 'open');
    expect(plan.dist).toBeGreaterThanOrEqual(SKINK_STEP_MIN);
    expect(plan.dist).toBeLessThanOrEqual(SKINK_STEP_MAX);
  });

  it('scuttles away from anything living within five tiles, and does not retarget', () => {
    const skink = makeSkink(1, 0, 0, () => 0);
    skink.rest = 12;
    let calls = 0;
    skink.rng = () => { calls += 1; return 0; };
    stepSkink(skink, 0.05, RIGHT, () => 'open', [{ x: 2, z: 0 }]);
    expect(calls).toBe(1);
    expect(skink.travel.flee).toBe(true);
    expect(skink.travel.toX).toBeCloseTo(-SKINK_STEP_MIN, 5);
    expect(skink.x).toBe(0);
    expect(skink.flip).toBe(true);
    expect(skink.blink).toBeCloseTo(0.05, 5);
    expect(planSkinkFlee(skink, () => 0, RIGHT, () => 'open', { x: 2, z: 0 }).x).toBeCloseTo(-SKINK_STEP_MIN, 5);

    const held = skink.travel.toX;
    stepSkink(skink, 0.05, RIGHT, () => 'open', [{ x: -1, z: 0 }]);
    expect(skink.travel.toX).toBe(held);
    expect(skink.x).toBeLessThan(0);

    const calm = makeSkink(1, 0, 0, () => 0);
    calm.rest = 12;
    stepSkink(calm, 0.05, RIGHT, () => 'open', [{ x: 5.01, z: 0 }]);
    expect(calm.travel).toBeNull();
    expect(calm.rest).toBeCloseTo(11.95, 5);

    const stuck = makeSkink(1, 0, 0, () => 0);
    stuck.rest = 12;
    stepSkink(stuck, 0.05, RIGHT, () => 'pool', [{ x: 2, z: 0 }]);
    expect(stuck.travel).toBeNull();
    expect(stuck.x).toBe(0);
    expect(stuck.rest).toBe(12);

    const run = makeSkink(1, 0, 0, () => 0);
    run.rest = 0;
    stepSkink(run, 0.05, RIGHT, () => 'open');
    expect(run.travel.toX).toBeCloseTo(SKINK_STEP_MIN, 5);
    stepSkink(run, 0.05, RIGHT, () => 'open', [{ x: 1, z: 0 }]);
    expect(run.travel.flee).toBe(true);
    expect(run.travel.toX).toBeCloseTo(-SKINK_STEP_MIN, 5);
    expect(run.x).toBe(0);
  });

  it('wears a rust stripe on ash and a pale shoulder in the ruins, and blinks', () => {
    const bask = paint({ coat: 'ash', blink: 1, scuttle: 0 });
    const blink = paint({ coat: 'ash', blink: 4.2, scuttle: 0 });
    const run = paint({ coat: 'ash', blink: 0.2, scuttle: 1, step: 0.4 });
    const ruin = paint({ coat: 'ruin', blink: 0.4, scuttle: 0 });
    for (const shot of [bask, blink, run, ruin]) {
      expect(shot.edge).toBe(0);
      expect(shot.white).toBe(0);
      expect(shot).toMatchObject({ w: 32, h: 11, minX: 10, maxX: 41, minY: 25, maxY: 35 });
    }
    expect(bask.n).toBe(163);
    expect(blink.n).toBe(162);
    expect(run.n).toBe(158);
    expect(ruin.n).toBe(157);
    expect(rgbDiff(bask.out, ruin.out)).toBeGreaterThan(20);
    expect(rgbDiff(bask.out, blink.out)).toBeGreaterThan(0);
    expect(rgbDiff(bask.out, run.out)).toBeGreaterThan(0);
  });
});
