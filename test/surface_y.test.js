import { describe, it, expect } from 'vitest';
import { surfaceY, groundY, STEP } from '../src/dungeon/elevation.js';
import { FLOOR } from '../src/dungeon/dungeon_generator.js';

/* a 5x1 strip: flat, flat, a stair climbing east, a level up, a level up */
function strip(props = []) {
  return {
    W: 5, H: 1,
    grid: new Array(5).fill(FLOOR),
    height: [0, 0, 0, 1, 1],
    ramp: [0, 0, 1, 0, 0],
    props,
  };
}
/* world x of a point `along` (0..1) the cell at grid column cx */
const wx = (d, cx, along = 0.5) => cx - d.W / 2 + along;

describe('surfaceY', () => {
  it('is the level on plain floor', () => {
    const d = strip();
    expect(surfaceY(d, wx(d, 0), 0)).toBe(0);
    expect(surfaceY(d, wx(d, 4), 0)).toBeCloseTo(STEP);
  });

  it('does not lean a flat cell toward the stair beside it, as groundY does', () => {
    const d = strip();
    const x = wx(d, 3, 0.1);          // the flat top, just past the last tread
    expect(groundY(d, x, 0)).toBeLessThan(STEP);
    expect(surfaceY(d, x, 0)).toBeCloseTo(STEP);
  });

  it('climbs a stair in three treads', () => {
    const d = strip();
    const at = (a) => surfaceY(d, wx(d, 2, a), 0);
    expect(at(0.1)).toBeCloseTo(STEP / 4);
    expect(at(0.5)).toBeCloseTo(STEP / 2);
    expect(at(0.9)).toBeCloseTo((STEP * 3) / 4);
  });

  it('rides up onto both tiers of a boss dais', () => {
    const d = { W: 11, H: 11, grid: new Array(121).fill(FLOOR), height: new Array(121).fill(0), ramp: new Array(121).fill(0),
      props: [{ kind: 'sepulcherDais', x: 5, y: 5, scale: 1 }] };
    expect(surfaceY(d, 0, 0)).toBeCloseTo(0.22);
    expect(surfaceY(d, 2.1, 0)).toBeCloseTo(0.1);
    expect(surfaceY(d, 4, 0)).toBe(0);
  });
});
