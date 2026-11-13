import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { drapeGeometry } from '../src/render/drape.js';

/* floor at 0, with a step up to 1 from x = 0 on */
const floor = (x) => (x >= 0 ? 1 : 0);
const sheet = () => new THREE.PlaneGeometry(4, 4, 40, 40).rotateX(-Math.PI / 2);
const heightsAlong = (geo) => {
  const p = geo.attributes.position, out = new Map();
  for (let i = 0; i < p.count; i++) out.set(+p.getX(i).toFixed(2), p.getY(i));
  return out;
};

describe('drapeGeometry', () => {
  it('sits each vertex just above the floor under it', () => {
    const h = heightsAlong(drapeGeometry(sheet(), 0, 0, 0, floor, 0.03));
    expect(h.get(-2)).toBeCloseTo(0.03);
    expect(h.get(2)).toBeCloseTo(1.03);
  });

  it('lifts before a step, so the sheet clears its corner', () => {
    const h = heightsAlong(drapeGeometry(sheet(), 0, 0, 0, floor, 0.03));
    expect(h.get(-0.2)).toBeCloseTo(0.03);
    /* a vertex at -0.1 is more than the reach away; one within it has already risen */
    const g = new THREE.PlaneGeometry(0.1, 0.1, 1, 1).rotateX(-Math.PI / 2);
    drapeGeometry(g, -0.05, 0, 0, floor, 0);
    expect(g.attributes.position.getY(1)).toBeCloseTo(1);
  });

  it('measures from the mesh\'s own origin', () => {
    const g = sheet();
    drapeGeometry(g, 10, 0, 1, floor, 0);
    expect(g.attributes.position.getY(0)).toBeCloseTo(0);
  });
});
