import { describe, it, expect } from 'vitest';
import { createFrame, clearFrame, createFx, composite } from '../src/vendor/pixelfx/core/index.js';
import * as frogFx from '../src/vendor/pixelfx/fx/critters/frog.js';
import { shift } from '../src/vendor/pixelfx/fx/critters/_lib.js';
import { cameraBasisFromYawPitch } from '../src/game/span_ribbon.js';
import { FLOOR, WALL, POOL } from '../src/game/constants.js';
import { generateOverland, QUEST_OVERLAND_MAP } from '../src/dungeon/dungeon_generator.js';
import { buildSolidProps } from '../src/game/pathfinding.js';
import {
  HERO_SPRITE_QUAD,
  FROG_BODY_PX,
  FROG_BODY_FRAC,
  FROG_PX_PER_UNIT,
  FROG_LOOP,
  T_CROUCH,
  T_UP,
  T_LAND,
  HOME_R,
  HOP_MIN,
  frogPhase,
  phaseCrossed,
  worldOf,
  cellIndex,
  WATER_SPAWN_CHANCE,
  crittersFor,
  pickFrogCells,
  pickMoorFrogCells,
  screenRightOf,
  planFrogHop,
  planFrogFlee,
  makeFrog,
  stepFrog,
} from '../src/render/ambient_critters.js';

const RIGHT = cameraBasisFromYawPitch(Math.PI / 4, 0.64).right;

function moor(seed = 7) {
  const W = 40, H = 40, n = W * H;
  return {
    themeKey: 'moor',
    seed,
    W, H,
    grid: new Uint8Array(n).fill(FLOOR),
    roadDist: new Int16Array(n).fill(8),
    solidProps: new Uint8Array(n),
    entrance: 0,
    rooms: [{ cx: 20, cy: 20 }],
  };
}

function at(d, x, y) {
  return y * d.W + x;
}

function paint(mod, t, flip) {
  const [W, H] = mod.meta.size;
  const [ox, oy] = mod.meta.origin;
  const frame = createFrame(W, H);
  const fx = createFx(mod, { x: ox, y: oy, seed: 1, flip: !!flip });
  fx.update(t);
  clearFrame(frame);
  fx.draw(frame, 'front');
  const out = new Uint8ClampedArray(W * H * 4);
  composite(frame, out);
  return { W, H, ox, oy, out };
}

function centroidX(buf, W, H) {
  let w = 0, sx = 0, n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = buf[(y * W + x) * 4 + 3];
      if (a < 40) continue;
      w += a;
      sx += a * x;
      n++;
    }
  }
  return { x: w ? sx / w : 0, n };
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

describe('moor frogs', () => {
  it('keeps the sitting body under a quarter of a hero sprite', () => {
    const body = FROG_BODY_PX / FROG_PX_PER_UNIT;
    expect(body / HERO_SPRITE_QUAD).toBeCloseTo(FROG_BODY_FRAC, 5);
    expect(body / HERO_SPRITE_QUAD).toBeLessThanOrEqual(0.25);
  });

  it('uses the same phase offset as the vendored frog', () => {
    expect(frogPhase(0, 1)).toBe(0);
    expect(frogPhase(0, 2)).toBeCloseTo(shift(0, FROG_LOOP, 2), 8);
    expect(frogPhase(1.25, 4)).toBeCloseTo(shift(1.25, FROG_LOOP, 4), 8);
    expect(frogPhase(1.25 + FROG_LOOP, 4)).toBeCloseTo(shift(1.25, FROG_LOOP, 4), 8);
    expect(frogPhase(0, 1)).not.toBeCloseTo(frogPhase(0, 2), 2);
  });

  it('notices a crouch mark and ignores a wrap that misses it', () => {
    expect(phaseCrossed(0.9, 1.0, T_CROUCH)).toBe(true);
    expect(phaseCrossed(0.9, 0.94, T_CROUCH)).toBe(false);
    expect(phaseCrossed(2.5, 0.05, T_CROUCH)).toBe(false);
    expect(phaseCrossed(0.9, 0.05, T_CROUCH)).toBe(true);
  });

  it('round-trips a cell through the same world mapping as the game', () => {
    const d = { W: 10, H: 8 };
    const w = worldOf(d, 3, 2);
    expect(w).toEqual({ x: 3 - 5 + 0.5, z: 2 - 4 + 0.5 });
    expect(cellIndex(d, w.x, w.z)).toBe(2 * 10 + 3);
    expect(cellIndex(d, -100, 0)).toBe(-1);
  });

  it('gives every pool one frog on its bank when the roll always hits', () => {
    const d = moor();
    const pools = [[8, 8], [8, 28], [30, 8], [30, 28], [18, 18]];
    for (const [x, y] of pools) d.grid[at(d, x, y)] = POOL;
    const cells = pickMoorFrogCells(d, 1);
    expect(cells).toHaveLength(pools.length);
    for (const c of cells) {
      const touch = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => d.grid[at(d, c.cx + ox, c.cy + oy)] === POOL);
      expect(touch).toBe(true);
      expect(d.grid[at(d, c.cx, c.cy)]).toBe(FLOOR);
    }
    const ys = cells.map((c) => c.cy);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(15);
    expect(pickMoorFrogCells(d, 1)).toEqual(cells);
    expect(pickMoorFrogCells(d, 0)).toEqual([]);
  });

  it('skips a walled-in pool, a solid bank, and other themes', () => {
    const d = moor();
    d.grid[at(d, 10, 10)] = POOL;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) d.solidProps[at(d, 10 + ox, 10 + oy)] = 1;
    d.grid[at(d, 30, 30)] = POOL;
    const cells = pickMoorFrogCells(d, 1);
    expect(cells).toHaveLength(1);
    expect(Math.hypot(cells[0].cx - 30, cells[0].cy - 30)).toBe(1);

    expect(pickMoorFrogCells({ ...d, themeKey: 'forest' }, 1)).toEqual([]);
    const dry = moor();
    expect(pickMoorFrogCells(dry, 1)).toEqual([]);
  });

  it('treats a lake mask as water and hits about one pool in ten', () => {
    expect(WATER_SPAWN_CHANCE).toBe(0.1);
    const d = moor();
    d.lakeMask = new Uint8Array(d.W * d.H);
    d.lakeMask[at(d, 12, 12)] = 1;
    const byLake = pickMoorFrogCells(d, 1);
    expect(byLake).toHaveLength(1);
    expect(Math.abs(byLake[0].cx - 12) + Math.abs(byLake[0].cy - 12)).toBe(1);

    const wide = moor(1);
    wide.W = 80;
    wide.H = 80;
    wide.grid = new Uint8Array(80 * 80).fill(FLOOR);
    wide.solidProps = new Uint8Array(80 * 80);
    const pools = [];
    for (let i = 0; i < 40; i++) {
      const x = 4 + (i % 8) * 9;
      const y = 4 + Math.floor(i / 8) * 14;
      wide.grid[y * 80 + x] = POOL;
      pools.push([x, y]);
    }
    let frogs = 0;
    for (let seed = 1; seed <= 40; seed++) {
      wide.seed = seed;
      frogs += pickMoorFrogCells(wide).length;
    }
    const rate = frogs / (40 * pools.length);
    expect(rate).toBeGreaterThan(0.06);
    expect(rate).toBeLessThan(0.15);
  });

  it('faces screen-left when the hop goes screen-left', () => {
    const camera = { matrixWorld: { elements: new Array(16).fill(0) } };
    camera.matrixWorld.elements[0] = RIGHT[0];
    camera.matrixWorld.elements[1] = RIGHT[1];
    camera.matrixWorld.elements[2] = RIGHT[2];
    camera.matrixWorld.elements[10] = 1;
    camera.matrixWorld.elements[15] = 1;
    const right = screenRightOf(camera);
    expect(right[0]).toBeCloseTo(RIGHT[0], 5);
    expect(right[2]).toBeCloseTo(RIGHT[2], 5);

    const floor = () => 'floor';
    const east = planFrogHop(makeFrog(1, 0, 0, 0, () => 0), () => 0, right, floor);
    const north = planFrogHop(makeFrog(1, 0, 0, Math.PI / 2, () => 0), () => 0, right, floor);
    const west = planFrogHop(makeFrog(1, 0, 0, Math.PI, () => 0), () => 0, right, floor);
    expect(east.x).toBeGreaterThan(0.3);
    expect(east.flip).toBe(false);
    expect(north.z).toBeGreaterThan(0.3);
    expect(north.flip).toBe(true);
    expect(west.x).toBeLessThan(-0.3);
    expect(west.flip).toBe(true);
  });

  it('refuses a pool, a wall, and a landing outside home', () => {
    const right = RIGHT;
    const zero = () => 0;
    expect(planFrogHop(makeFrog(1, 0, 0, 0, zero), zero, right, () => 'pool')).toBeNull();
    expect(planFrogHop(makeFrog(1, 0, 0, 0, zero), zero, right, () => 'wall')).toBeNull();
    const rim = makeFrog(1, 2.2, 0, 0, zero);
    rim.homeX = 0;
    rim.homeZ = 0;
    const trapped = planFrogHop(rim, zero, right, (x, z) => (
      Math.hypot(x, z) <= HOME_R ? 'pool' : 'floor'
    ));
    expect(trapped).toBeNull();
    const around = planFrogHop(makeFrog(1, 0, 0, 0, zero), zero, right, (x) => (x > 0.1 ? 'pool' : 'floor'));
    expect(around.x).toBeLessThan(0);

    const gone = makeFrog(1, 3, 0, Math.PI, zero);
    gone.homeX = 0;
    gone.homeZ = 0;
    const back = planFrogHop(gone, zero, right, () => 'floor');
    expect(back).toBeTruthy();
    expect(Math.hypot(back.x, back.z)).toBeLessThan(3);
  });

  it('stays put to croak, and hops only while the sprite is in the air', () => {
    const stay = makeFrog(1, 1, 2, 0, () => 0);
    for (let i = 0; i < 180; i++) stepFrog(stay, 1 / 60, RIGHT, () => 'floor');
    expect(stay.x).toBe(1);
    expect(stay.z).toBe(2);

    const frog = makeFrog(1, 0, 0, 0, () => 0.99);
    frog.clock = 0.94;
    frog.phase = frogPhase(0.94, 1);
    stepFrog(frog, 0.02, RIGHT, () => 'floor');
    expect(frog.hop).toBeTruthy();
    expect(frog.x).toBe(0);
    const target = frog.hop.toX;
    const mid = (T_UP + T_LAND) / 2;
    stepFrog(frog, mid - frog.clock, RIGHT, () => 'floor');
    expect(frog.x).toBeCloseTo(target * 0.5, 2);
    stepFrog(frog, (T_LAND + 0.02) - frog.clock, RIGHT, () => 'floor');
    expect(frog.hop).toBeNull();
    expect(frog.x).toBeCloseTo(target, 5);
    expect(frog.flip).toBe(false);

    const moved = makeFrog(1, 0, 0, 0, () => 0.99);
    for (let i = 0; i < 120; i++) stepFrog(moved, 1 / 60, RIGHT, () => 'floor');
    expect(Math.hypot(moved.x, moved.z)).toBeGreaterThan(0.3);
  });

  it('hops away from anything living within five tiles', () => {
    const spook = (threats) => {
      const frog = makeFrog(1, 0, 0, 0, () => 0);
      frog.clock = 0.94;
      frog.phase = frogPhase(0.94, 1);
      stepFrog(frog, 0.02, RIGHT, () => 'floor', threats);
      return frog;
    };
    const near = spook([{ x: 1, y: 9, z: 0 }]);
    expect(near.hop).toBeTruthy();
    expect(near.hop.toX).toBeCloseTo(-HOP_MIN, 5);
    expect(near.x).toBe(0);
    expect(planFrogFlee(near, () => 0, RIGHT, () => 'floor', { x: 1, z: 0 }).x).toBeCloseTo(-HOP_MIN, 5);

    const far = spook([{ x: 6, z: 0 }]);
    expect(far.hop).toBeNull();
    expect(far.x).toBe(0);

    const edge = spook([{ x: 5, z: 0 }]);
    expect(edge.hop.toX).toBeLessThan(0);
    expect(edge.x).toBe(0);
  });

  it('paints a frog with no fly or dust, and a flip puts the eye on the other side', () => {
    const sitting = paint(frogFx, 0.2, false);
    const flipped = paint(frogFx, 0.2, true);
    const leap = paint(frogFx, 1.35, false);
    const a = centroidX(sitting.out, sitting.W, sitting.H);
    expect(a.n).toBeGreaterThan(40);
    expect(leap.out.some((v, i) => i % 4 === 3 && v > 40)).toBe(true);
    const px = (buf, x, y) => buf[(y * sitting.W + x) * 4 + 3];
    // The eye sits to the frog's right. A flip parks that same pixel on the left.
    expect(px(sitting.out, 63, 63)).toBeGreaterThan(200);
    expect(px(sitting.out, 48, 63)).toBe(0);
    expect(px(flipped.out, 63, 63)).toBe(0);
    expect(px(flipped.out, 48, 63)).toBeGreaterThan(200);
    // The old fly hovered here, above a sitting frog.
    expect(px(sitting.out, 77, 40)).toBe(0);
    expect(px(sitting.out, 34, 40)).toBe(0);
    const side = (x) => x < 20 || x > 100;
    for (const t of [0.2, T_UP, T_LAND, 1.72]) {
      const frame = t === 0.2 ? sitting : paint(frogFx, t, false);
      // Mid-leap the body rises into the top of the canvas. On the ground it stays below y 50.
      expect(regionEmpty(frame.out, frame.W, frame.H, (_x, y) => y < 50)).toBe(true);
      expect(regionEmpty(frame.out, frame.W, frame.H, side)).toBe(true);
    }
    expect(regionEmpty(leap.out, leap.W, leap.H, side)).toBe(true);
  });

  it('puts frogs on water banks across a generated moor', () => {
    const seeds = [11, 22, 33, 44];
    let total = 0;
    let widest = 0;
    let pastTheSpawn = false;
    let sample = null;
    for (const seed of seeds) {
      const d = generateOverland({ seed, themeKey: 'moor', level: 3, ...QUEST_OVERLAND_MAP });
      d.solidProps = buildSolidProps(d);
      sample = d;
      const ent = d.rooms[d.entrance];
      const cells = pickMoorFrogCells(d);
      total += cells.length;
      if (cells.length) {
        const ys = cells.map((c) => c.cy);
        widest = Math.max(widest, Math.max(...ys) - Math.min(...ys));
      }
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        const idx = c.cy * d.W + c.cx;
        expect(d.grid[idx]).toBe(FLOOR);
        expect(d.solidProps[idx]).toBe(0);
        const water = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => {
          const nx = c.cx + ox, ny = c.cy + oy;
          if (nx < 0 || ny < 0 || nx >= d.W || ny >= d.H) return false;
          const n = ny * d.W + nx;
          return d.grid[n] === POOL || !!(d.lakeMask && d.lakeMask[n]);
        });
        expect(water).toBe(true);
        if (Math.hypot(c.cx - ent.cx, c.cy - ent.cy) > 18) pastTheSpawn = true;
        for (let j = i + 1; j < cells.length; j++) {
          expect(Math.hypot(c.cx - cells[j].cx, c.cy - cells[j].cy)).toBeGreaterThanOrEqual(4);
        }
      }
    }
    expect(total).toBeGreaterThan(4);
    expect(pastTheSpawn).toBe(true);
    expect(widest).toBeGreaterThan(40);
    const forest = { ...sample, themeKey: 'forest', params: { ...(sample.params || {}), themeKey: 'forest' } };
    expect(pickMoorFrogCells(forest)).toEqual([]);
  });

  it('places frogs on any theme once the caller asks, and keeps the moor gate', () => {
    const forest = moor();
    forest.themeKey = 'forest';
    forest.grid[at(forest, 8, 8)] = POOL;
    expect(pickMoorFrogCells(forest, 1)).toEqual([]);
    const cells = pickFrogCells(forest, 1);
    expect(cells).toHaveLength(1);
    expect(Math.abs(cells[0].cx - 8) + Math.abs(cells[0].cy - 8)).toBe(1);
  });

  it('reads moor defaults, leaves other themes off, and lets an override win', () => {
    const moorCfg = crittersFor('moor');
    expect(moorCfg.frog.enabled).toBe(true);
    expect(moorCfg.frog.chance).toBe(WATER_SPAWN_CHANCE);
    expect(moorCfg.snake.enabled).toBe(true);
    expect(moorCfg.snake.min).toBe(2);
    expect(moorCfg.snake.max).toBe(3);

    const ancient = crittersFor('ancient');
    expect(ancient.frog.enabled).toBe(false);
    expect(ancient.snake.enabled).toBe(false);

    const tuned = crittersFor('forest', { frog: { enabled: true, chance: 1.4 } });
    expect(tuned.frog.enabled).toBe(true);
    expect(tuned.frog.chance).toBe(1);
    expect(tuned.snake.enabled).toBe(false);

    const quiet = crittersFor('moor', { frog: { enabled: false }, snake: { min: 5, max: 1 } });
    expect(quiet.frog.enabled).toBe(false);
    expect(quiet.frog.chance).toBe(WATER_SPAWN_CHANCE);
    expect(quiet.snake.enabled).toBe(true);
    expect(quiet.snake.min).toBe(5);
    expect(quiet.snake.max).toBe(5);

    expect(crittersFor('moor', { frog: { chance: -0.2 } }).frog.chance).toBe(0);
  });
});
