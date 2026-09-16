import { describe, it, expect } from 'vitest';
import { Motion, describeActor } from '../src/game/motion_debug.js';

describe('Motion debug', () => {
  it('describeActor reports cell offset, moving flags and lunge', () => {
    const e = {
      x: 3.9, z: 5.5,
      data: { name: 'Valen', hp: 10, maxHp: 10 },
      moving: true, actUsed: true, moveLeft: 4,
      path: [1, 2, 3], pathI: 1,
      lungeT: 0.12, knockT: 0,
    };
    const game = {
      D: { W: 12 },
      cellOf: (x, z) => Math.floor(z) * 12 + Math.floor(x),
      wx: (c) => c + 0.5,
      wz: (c) => c + 0.5,
    };
    const d = describeActor(game, e);
    expect(d.name).toBe('Valen');
    expect(d.moving).toBe(true);
    expect(d.actUsed).toBe(true);
    expect(d.pathLeft).toBe(2);
    expect(d.dCenter).toBeCloseTo(0.4, 5);
    expect(d.lungeT).toBeCloseTo(0.12, 5);
  });

  it('flags a logical reversal between two systems', () => {
    Motion.clear();
    Motion.on = false;
    const e = { x: 3.5, z: 5.5, data: { name: 'Valen' } };
    const game = { elapsed: 1, D: { W: 12 }, cellOf: () => 0, wx: () => 0.5, wz: () => 0.5 };
    Motion.after(game, e, 'stepAlong');
    e.x = 3.7;
    Motion.after(game, e, 'stepAlong');
    e.x = 3.52;
    Motion.after(game, e, 'snapToTileCenter');
    expect(Motion.reversals.length).toBeGreaterThan(0);
    expect(Motion.reversals[0].prevSrc).toBe('stepAlong');
    expect(Motion.reversals[0].src).toBe('snapToTileCenter');
    Motion.clear();
  });
});
