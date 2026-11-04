/* The boss-arena dais is a wide cylinder. Its cap used to stretch one stone
   image across the whole disc, so the ashlar was several times larger than
   the floor tiles around the throne. */
import { describe, it, expect } from 'vitest';
import { GEO } from '../src/render/dungeon_geo.js';

describe('sepulcher dais', () => {
  it('repeats the stone about once per world unit across the disc', () => {
    const g = GEO.sepulcherDais;
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    let a = -1, b = -1;
    for (let i = 0; i < p.count; i++) {
      if (n.getY(i) < 0.9) continue;
      if (a < 0 || p.getX(i) < p.getX(a)) a = i;
      if (b < 0 || p.getX(i) > p.getX(b)) b = i;
    }
    const dx = p.getX(b) - p.getX(a);
    const du = uv.getX(b) - uv.getX(a);
    expect(dx).toBeGreaterThan(4);
    expect(Math.abs(du / dx)).toBeCloseTo(1.3, 2);
    expect(du).toBeGreaterThan(4);
  });
});
