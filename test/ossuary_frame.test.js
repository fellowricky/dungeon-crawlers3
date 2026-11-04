/* The ossuary posts are chamferBox pieces. That helper stands on y = 0 and
   grows upward, but the posts were first placed by the centre of the shelf.
   A 1.5-tall post centred at 0.81 then ran from 0.81 to 2.31, so its middle
   sat on the lintel and the sides stuck out the top. */
import { describe, it, expect } from 'vitest';
import { GEO } from '../src/render/dungeon_geo.js';

describe('ossuary frame', () => {
  it('stands the side posts on the sill instead of centering them on the lintel', () => {
    const g = GEO.ossuaryFrame;
    g.computeBoundingBox();
    const { min, max } = g.boundingBox;
    expect(min.y).toBeGreaterThanOrEqual(-0.001);
    expect(min.y).toBeLessThan(0.02);
    expect(max.y).toBeGreaterThan(1.5);
    expect(max.y).toBeLessThan(1.75);
  });
});
