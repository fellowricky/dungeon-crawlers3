import { describe, it, expect } from 'vitest';
import { createFrame, clearFrame, createFx, composite } from '../src/vendor/pixelfx/core/index.js';
import {
  LOADING_WIPES,
  pickLoadingWipe,
  punchBurnCover,
  burnKeepLoops,
  loopsContain,
} from '../src/ui/loading_wipe.js';

const W = 320;
const H = 180;

function alphaAt(buf, x, y) {
  return buf[(y * W + x) * 4 + 3];
}

function frameAt(mod, t) {
  const frame = createFrame(W, H);
  const fx = createFx(mod, {});
  const out = new Uint8ClampedArray(W * H * 4);
  const steps = Math.max(1, Math.round(t / (1 / 120)));
  const dt = t / steps;
  for (let i = 0; i < steps; i++) fx.update(dt);
  clearFrame(frame);
  fx.draw(frame);
  composite(frame, out);
  return { fx, out };
}

function solid(out) {
  for (const [x, y] of [[2, 2], [160, 100], [318, 178], [160, 2], [2, 90], [318, 90]]) {
    if (alphaAt(out, x, y) !== 255) return false;
  }
  return true;
}

describe('loading wipes', () => {
  it('picks each transition, and only those three', () => {
    const ids = LOADING_WIPES.map((w) => w.id);
    expect(ids).toEqual(['iris', 'burn-away', 'slash-wipe']);
    const seen = [0, 1, 2].map((i) => pickLoadingWipe(() => i / 3).id);
    expect(seen).toEqual(ids);
    expect(pickLoadingWipe(() => 0.999).id).toBe('slash-wipe');
  });

  it('each wipe is open, then solid, then empty', () => {
    for (const wipe of LOADING_WIPES) {
      const early = frameAt(wipe.mod, 1 / 60);
      expect(solid(early.out)).toBe(false);

      const shut = frameAt(wipe.mod, wipe.cover + 0.04);
      expect(solid(shut.out)).toBe(true);

      const done = frameAt(wipe.mod, wipe.mod.meta.duration + 0.05);
      expect(done.fx.done()).toBe(true);
      expect(alphaAt(done.out, 2, 2)).toBe(0);
      expect(alphaAt(done.out, 160, 100)).toBe(0);
      expect(alphaAt(done.out, 318, 178)).toBe(0);
    }
  });

  it('punches only the flat burn cover', () => {
    const data = new Uint8ClampedArray([
      11, 10, 16, 255,
      255, 80, 20, 255,
      0, 0, 0, 0,
    ]);
    const keep = new Uint8Array(3);
    expect(punchBurnCover(data, keep)).toBe(1);
    expect(data[3]).toBe(0);
    expect(keep[0]).toBe(0);
    expect(data[7]).toBe(255);
    expect(data[4]).toBe(255);
    expect(keep[1]).toBe(1);
    expect(data[11]).toBe(0);
    expect(keep[2]).toBe(1);
  });

  function mismatches(keep, loops, w, h) {
    let bad = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const inside = loopsContain(loops, x + 0.5, y + 0.5);
        if (inside !== (keep[y * w + x] === 1)) bad++;
      }
    }
    return bad;
  }

  it('keeps the loading art in the middle of the burn', () => {
    const full = new Uint8Array(W * H);
    full.fill(1);
    const fullLoops = burnKeepLoops(full, W, H);
    expect(loopsContain(fullLoops, 0.5, 0.5)).toBe(true);
    expect(loopsContain(fullLoops, 160.5, 90.5)).toBe(true);
    expect(loopsContain(fullLoops, -1, -1)).toBe(false);
    expect(mismatches(full, fullLoops, W, H)).toBe(0);

    const disk = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (Math.hypot(x - 160, y - 90) < 50) disk[y * W + x] = 1;
      }
    }
    const diskLoops = burnKeepLoops(disk, W, H);
    expect(loopsContain(diskLoops, 160.5, 90.5)).toBe(true);
    expect(loopsContain(diskLoops, 2.5, 2.5)).toBe(false);
    expect(mismatches(disk, diskLoops, W, H)).toBe(0);

    const hole = new Uint8Array(7 * 7);
    hole.fill(1);
    hole[3 * 7 + 3] = 0;
    const holeLoops = burnKeepLoops(hole, 7, 7);
    expect(loopsContain(holeLoops, 0.5, 0.5)).toBe(true);
    expect(loopsContain(holeLoops, 3.5, 3.5)).toBe(false);
    expect(mismatches(hole, holeLoops, 7, 7)).toBe(0);

    const burn = LOADING_WIPES.find((w) => w.id === 'burn-away');
    for (const t of [1 / 60, 0.45, 0.7]) {
      const frame = frameAt(burn.mod, t);
      const keep = new Uint8Array(W * H);
      const data = new Uint8ClampedArray(frame.out);
      punchBurnCover(data, keep);
      const loops = burnKeepLoops(keep, W, H);
      expect(keep[90 * W + 160]).toBe(1);
      expect(loopsContain(loops, 160.5, 90.5)).toBe(true);
      expect(mismatches(keep, loops, W, H)).toBe(0);
    }
  });
});
