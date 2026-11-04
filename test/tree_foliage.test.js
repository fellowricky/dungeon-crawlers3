import { describe, it, expect } from 'vitest';
import { canopyPoints, FOLIAGE } from '../src/render/tree_foliage.js';

/* A stick tree: a vertical trunk 0..1 with four branches fanning out above 0.5. */
function stickTree() {
  const pts = [];
  for (let y = 0; y <= 1; y += 0.01) pts.push(0, y, 0);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let t = 0; t <= 1; t += 0.02) pts.push(dx * 0.3 * t, 0.5 + 0.4 * t, dz * 0.3 * t);
  }
  return new Float32Array(pts);
}

describe('tree foliage', () => {
  it('places clusters in the crown only, never on the bare lower trunk', () => {
    const { points, H, y0 } = canopyPoints(stickTree(), { minH: 0.3 });
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) expect((p[1] - y0) / H).toBeGreaterThanOrEqual(0.3 - 1e-6);
  });

  it('reaches the branch ends', () => {
    const { points } = canopyPoints(stickTree(), { minH: 0.3 });
    // Every branch tip (0.3 out at y 0.9) has a cluster within a voxel or two.
    for (const [x, z] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) {
      const near = points.some(p => Math.hypot(p[0] - x, p[1] - 0.9, p[2] - z) < 0.06);
      expect(near, `tip ${x},${z}`).toBe(true);
    }
  });

  it('is deterministic and honours an explicit cluster count', () => {
    const a = canopyPoints(stickTree(), { clusters: 10 });
    const b = canopyPoints(stickTree(), { clusters: 10 });
    expect(a.points).toHaveLength(10);
    expect(a.points).toEqual(b.points);
  });

  it('every FOLIAGE entry has the fields the geometry builder reads', () => {
    for (const [k, f] of Object.entries(FOLIAGE)) {
      for (const field of ['tint', 'size', 'minH', 'cards', 'push']) expect(f[field], `${k}.${field}`).toBeDefined();
    }
  });
});
