import { describe, it, expect } from 'vitest';
import { createFrame, clearFrame, createFx, composite } from '../src/vendor/pixelfx/core/index.js';
import * as snakeFx from '../src/vendor/pixelfx/fx/critters/snake.js';
import { cameraBasisFromYawPitch } from '../src/game/span_ribbon.js';
import { FLOOR, POOL } from '../src/game/constants.js';
import { generateOverland, QUEST_OVERLAND_MAP } from '../src/dungeon/dungeon_generator.js';
import { buildSolidProps } from '../src/game/pathfinding.js';
import {
  HERO_SPRITE_QUAD,
  SNAKE_LEN_PX,
  SNAKE_LEN_FRAC,
  SNAKE_PX_PER_UNIT,
  SNAKE_COUNT_MIN,
  SNAKE_COUNT_MAX,
  SNAKE_REST_MIN,
  SNAKE_REST_MAX,
  SNAKE_STEP_MIN,
  SNAKE_STEP_MAX,
  SNAKE_SPEED,
  pickMoorSnakeCells,
  pickSnakeCells,
  crittersFor,
  planSnakeCrawl,
  planSnakeFlee,
  makeSnake,
  stepSnake,
} from '../src/render/ambient_critters.js';

const RIGHT = cameraBasisFromYawPitch(Math.PI / 4, 0.64).right;

function moor(seed = 7) {
  const W = 40, H = 48, n = W * H;
  return {
    themeKey: 'moor',
    seed,
    W, H,
    grid: new Uint8Array(n).fill(FLOOR),
    roadDist: new Int16Array(n).fill(8),
    solidProps: new Uint8Array(n),
    entrance: 0,
    rooms: [{ cx: 20, cy: 24 }],
  };
}

function at(d, x, y) {
  return y * d.W + x;
}

function paint(opts) {
  const [W, H] = snakeFx.meta.size;
  const [ox, oy] = snakeFx.meta.origin;
  const frame = createFrame(W, H);
  const fx = createFx(snakeFx, { x: ox, y: oy, seed: 1, slither: 0, flick: 0, ...opts });
  clearFrame(frame);
  fx.draw(frame, 'front');
  const out = new Uint8ClampedArray(W * H * 4);
  composite(frame, out);
  return { W, H, out };
}

function alphaDiff(a, b) {
  let n = 0;
  for (let i = 3; i < a.length; i += 4) if ((a[i] > 40) !== (b[i] > 40)) n++;
  return n;
}

function regionEmpty(buf, W, H, pred) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!pred(x, y)) continue;
      if (buf[(y * W + x) * 4 + 3] > 0) return false;
    }
  }
  return true;
}

describe('moor snakes', () => {
  it('stays a small snake, long enough that the tongue is a few pixels', () => {
    const length = SNAKE_LEN_PX / SNAKE_PX_PER_UNIT;
    expect(length / HERO_SPRITE_QUAD).toBeCloseTo(SNAKE_LEN_FRAC, 5);
    expect(length / HERO_SPRITE_QUAD).toBeLessThanOrEqual(0.6);
    expect(length / HERO_SPRITE_QUAD).toBeGreaterThan(0.5);
  });

  it('places two or three snakes on grass, spread along the moor', () => {
    const counts = new Set();
    for (let seed = 1; seed <= 24; seed++) {
      const cells = pickMoorSnakeCells(moor(seed));
      counts.add(cells.length);
      expect(cells.length).toBeGreaterThanOrEqual(SNAKE_COUNT_MIN);
      expect(cells.length).toBeLessThanOrEqual(SNAKE_COUNT_MAX);
      const d = moor(seed);
      for (let i = 0; i < cells.length; i++) {
        expect(d.grid[at(d, cells[i].cx, cells[i].cy)]).toBe(FLOOR);
        for (let j = i + 1; j < cells.length; j++) {
          const dx = cells[i].cx - cells[j].cx, dy = cells[i].cy - cells[j].cy;
          expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(16 * 16);
        }
      }
      const ys = cells.map((c) => c.cy);
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(10);
    }
    expect(counts.has(2)).toBe(true);
    expect(counts.has(3)).toBe(true);
    const d = moor(4);
    expect(pickMoorSnakeCells(d)).toEqual(pickMoorSnakeCells(d));
  });

  it('skips the track, water, solid ground, and other themes', () => {
    const road = moor();
    road.roadDist.fill(0);
    expect(pickMoorSnakeCells(road)).toEqual([]);

    const wet = moor();
    wet.grid.fill(POOL);
    expect(pickMoorSnakeCells(wet)).toEqual([]);

    const blocked = moor();
    blocked.solidProps.fill(1);
    expect(pickMoorSnakeCells(blocked)).toEqual([]);

    const d = moor();
    expect(pickMoorSnakeCells({ ...d, themeKey: 'forest' })).toEqual([]);
  });

  it('puts a generated moor\'s snakes on grass, not all in the spawn room', () => {
    const d = generateOverland({ seed: 11, themeKey: 'moor', level: 3, ...QUEST_OVERLAND_MAP });
    d.solidProps = buildSolidProps(d);
    const ent = d.rooms[d.entrance];
    const cells = pickMoorSnakeCells(d);
    expect(cells.length).toBeGreaterThanOrEqual(2);
    expect(cells.length).toBeLessThanOrEqual(3);
    let far = false;
    for (const c of cells) {
      const idx = c.cy * d.W + c.cx;
      expect(d.grid[idx]).toBe(FLOOR);
      expect(d.solidProps[idx]).toBe(0);
      expect(d.grid[idx] === POOL).toBe(false);
      if (d.roadDist) expect(d.roadDist[idx] > 2 || d.roadDist[idx] < 0).toBe(true);
      if (Math.hypot(c.cx - ent.cx, c.cy - ent.cy) > 30) far = true;
    }
    const ys = cells.map((c) => c.cy);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(40);
    expect(far).toBe(true);
    const forest = { ...d, themeKey: 'forest', params: { ...(d.params || {}), themeKey: 'forest' } };
    expect(pickMoorSnakeCells(forest)).toEqual([]);
  });

  it('places a requested count on any theme, and none when the count is zero', () => {
    const n = 30 * 120;
    const grass = {
      themeKey: 'forest',
      seed: 3,
      W: 30,
      H: 120,
      grid: new Uint8Array(n).fill(FLOOR),
      roadDist: new Int16Array(n).fill(8),
      solidProps: new Uint8Array(n),
    };
    expect(pickMoorSnakeCells(grass)).toEqual([]);
    expect(pickSnakeCells(grass, { min: 4, max: 4 })).toHaveLength(4);
    expect(pickSnakeCells(grass, { min: 0, max: 0 })).toEqual([]);
    const counted = crittersFor('forest', { snake: { enabled: true, min: 1, max: 1 } });
    expect(counted.snake).toEqual({ enabled: true, min: 1, max: 1 });
    expect(pickSnakeCells(grass, counted.snake)).toHaveLength(1);
  });

  it('holds still and keeps the tongue clock running until it crawls', () => {
    const snake = makeSnake(1, 1, 2, 0, () => 0);
    expect(snake.rest).toBeGreaterThanOrEqual(SNAKE_REST_MIN);
    expect(snake.rest).toBeLessThanOrEqual(SNAKE_REST_MAX);
    stepSnake(snake, 5, RIGHT, () => 'grass');
    expect(snake.x).toBe(1);
    expect(snake.z).toBe(2);
    expect(snake.slither).toBe(0);
    expect(snake.wave).toBe(0);
    expect(snake.flick).toBeCloseTo(5, 5);
    expect(snake.travel).toBeNull();
  });

  it('crawls four or five tiles of grass, and the body clock runs only then', () => {
    const snake = makeSnake(1, 0, 0, 0, () => 0);
    let n = 0;
    snake.rng = () => (n++ === 0 ? 0 : 0);
    snake.rest = 0;
    stepSnake(snake, 0.05, RIGHT, () => 'grass');
    expect(snake.travel).toBeTruthy();
    expect(snake.x).toBe(0);
    expect(snake.travel.toX).toBeCloseTo(SNAKE_STEP_MIN, 5);
    expect(snake.flip).toBe(false);
    expect(snake.slither).toBe(0);
    expect(snake.wave).toBe(0);
    const dur = snake.travel.dur;
    expect(dur).toBeCloseTo(SNAKE_STEP_MIN / SNAKE_SPEED, 5);
    stepSnake(snake, dur / 2, RIGHT, () => 'grass');
    expect(snake.x).toBeCloseTo(SNAKE_STEP_MIN * 0.5, 2);
    expect(snake.slither).toBeCloseTo(dur / 2, 5);
    expect(snake.wave).toBe(1);
    expect(snake.flick).toBeGreaterThan(dur / 2);
    stepSnake(snake, dur / 2 + 0.05, RIGHT, () => 'grass');
    expect(snake.travel).toBeNull();
    expect(snake.x).toBeCloseTo(SNAKE_STEP_MIN, 5);
    expect(snake.z).toBeCloseTo(0, 5);
    expect(snake.slither).toBeCloseTo(dur, 4);
    expect(snake.wave).toBe(0);
    expect(snake.rest).toBeGreaterThanOrEqual(SNAKE_REST_MIN);
  });

  it('faces screen-left when the crawl goes screen-left, and refuses a blocked path', () => {
    const east = makeSnake(1, 0, 0, 0, () => 0);
    east.rng = () => 0;
    const rightPlan = planSnakeCrawl(east, east.rng, RIGHT, () => 'grass');
    expect(rightPlan.x).toBeGreaterThan(SNAKE_STEP_MIN - 0.01);
    expect(rightPlan.x).toBeLessThanOrEqual(SNAKE_STEP_MAX);
    expect(rightPlan.flip).toBe(false);

    const north = makeSnake(1, 0, 0, 0, () => 0);
    let n = 0;
    north.rng = () => (n++ === 0 ? 0 : 0.25);
    const northPlan = planSnakeCrawl(north, north.rng, RIGHT, () => 'grass');
    expect(northPlan.z).toBeGreaterThan(3);
    expect(northPlan.flip).toBe(true);

    const trapped = makeSnake(1, 0, 0, 0, () => 0);
    trapped.rest = 0;
    trapped.rng = () => 0;
    stepSnake(trapped, 0.05, RIGHT, () => 'pool');
    expect(trapped.travel).toBeNull();
    expect(trapped.x).toBe(0);
    expect(trapped.slither).toBe(0);
    expect(trapped.rest).toBe(SNAKE_REST_MIN);
  });

  it('crawls away from anything living within five tiles', () => {
    const snake = makeSnake(1, 0, 0, 0, () => 0);
    snake.rest = 10;
    stepSnake(snake, 0.05, RIGHT, () => 'grass', [{ x: 2, z: 0 }]);
    expect(snake.travel.flee).toBe(true);
    expect(snake.travel.toX).toBeCloseTo(-SNAKE_STEP_MIN, 5);
    expect(snake.x).toBe(0);
    expect(snake.wave).toBe(0);
    expect(planSnakeFlee(snake, () => 0, RIGHT, () => 'grass', { x: 2, z: 0 }).x).toBeCloseTo(-SNAKE_STEP_MIN, 5);

    const held = snake.travel.toX;
    stepSnake(snake, 0.05, RIGHT, () => 'grass', [{ x: -1, z: 0 }]);
    expect(snake.travel.toX).toBe(held);
    expect(snake.x).toBeLessThan(0);

    const calm = makeSnake(1, 0, 0, 0, () => 0);
    calm.rest = 10;
    stepSnake(calm, 0.05, RIGHT, () => 'grass', [{ x: 5.01, z: 0 }]);
    expect(calm.travel).toBeNull();
    expect(calm.rest).toBeCloseTo(9.95, 5);

    const stuck = makeSnake(1, 0, 0, 0, () => 0);
    stuck.rest = 10;
    stepSnake(stuck, 0.05, RIGHT, () => 'pool', [{ x: 2, z: 0 }]);
    expect(stuck.travel).toBeNull();
    expect(stuck.x).toBe(0);
    expect(stuck.rest).toBe(10);

    const crawl = makeSnake(1, 0, 0, 0, () => 0);
    crawl.rest = 0;
    stepSnake(crawl, 0.05, RIGHT, () => 'grass');
    expect(crawl.travel.toX).toBeCloseTo(SNAKE_STEP_MIN, 5);
    stepSnake(crawl, 0.05, RIGHT, () => 'grass', [{ x: 1, z: 0 }]);
    expect(crawl.travel.flee).toBe(true);
    expect(crawl.travel.toX).toBeCloseTo(-SNAKE_STEP_MIN, 5);
    expect(crawl.x).toBe(0);
    expect(crawl.wave).toBe(0);
  });

  it('lies flat until it crawls, and the tongue keeps flicking', () => {
    const resting = paint({ slither: 0.1, wave: 0, flick: 0.08 });
    const otherPhase = paint({ slither: 0.7, wave: 0, flick: 0.08 });
    const tucked = paint({ slither: 0.1, wave: 0, flick: 0.22 });
    const crawling = paint({ slither: 0.45, wave: 1, flick: 0.08 });
    const flipped = paint({ slither: 0.1, wave: 0, flick: 0.08, flip: true });
    const px = (buf, x, y) => buf[(y * resting.W + x) * 4 + 3];
    expect(alphaDiff(resting.out, otherPhase.out)).toBe(0);
    expect(alphaDiff(resting.out, tucked.out)).toBeGreaterThan(0);
    expect(alphaDiff(resting.out, tucked.out)).toBeLessThan(24);
    expect(alphaDiff(resting.out, crawling.out)).toBeGreaterThan(80);
    const topOf = (buf) => {
      for (let y = 0; y < resting.H; y++) {
        for (let x = 40; x <= 70; x++) if (buf[(y * resting.W + x) * 4 + 3] > 40) return y;
      }
      return resting.H;
    };
    expect(topOf(crawling.out)).toBeLessThan(topOf(resting.out));
    expect(px(resting.out, 113, 38)).toBeGreaterThan(200);
    expect(px(tucked.out, 113, 38)).toBe(0);
    expect(px(resting.out, 100, 40)).toBeGreaterThan(200);
    expect(px(flipped.out, 100, 40)).toBe(0);
    expect(px(flipped.out, 35, 40)).toBeGreaterThan(200);
    const margin = (x) => x < 20 || x > 120;
    expect(regionEmpty(resting.out, resting.W, resting.H, margin)).toBe(true);
    expect(regionEmpty(crawling.out, crawling.W, crawling.H, margin)).toBe(true);
    expect(regionEmpty(resting.out, resting.W, resting.H, (_x, y) => y < 28)).toBe(true);
  });
});
