import { describe, it, expect, vi } from 'vitest';

/* dungeon_materials.js builds canvases and loads textures as it is imported. */
vi.hoisted(() => {
  if (typeof globalThis.document !== 'undefined') return;
  globalThis.innerWidth = 1920;
  globalThis.innerHeight = 1080;
  const ctx = new Proxy({
    measureText: () => ({ width: 10 }),
    getImageData: (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createImageData: (w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} })
  }, { get: (t, p) => (p in t ? t[p] : () => {}) });
  const el = {
    setAttribute: () => {}, addEventListener: () => {}, removeEventListener: () => {}, style: {},
    getContext: () => ctx, appendChild: () => {}, querySelector: () => el, querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {} }
  };
  globalThis.document = {
    createElement: () => el, createElementNS: () => el, getElementById: () => null,
    querySelector: () => el, querySelectorAll: () => [], body: el
  };
});

import { existsSync, readFileSync } from 'node:fs';
import { THEMES } from '../src/dungeon/dungeon_generator.js';
import * as THREE from 'three';
import { canopyPoints, copseNoise, foliageGeometry, FOLIAGE, TREE_SCALE } from '../src/render/tree_foliage.js';
import { SOLID_PROP_KINDS, SIGHT_BLOCKING_KINDS } from '../src/game/pathfinding.js';

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

  describe('weeping willow ribbons', () => {
    function willow() {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(stickTree(), 3));
      return foliageGeometry(geo, FOLIAGE.swamptree);
    }
    /* each ribbon is two vertices per row, roots first */
    const rows = FOLIAGE.swamptree.segs + 1;

    it('builds one ribbon per cluster within the triangle budget', () => {
      const g = willow();
      const ribbons = g.getAttribute('position').count / (rows * 2);
      expect(Number.isInteger(ribbons)).toBe(true);
      expect(ribbons).toBeGreaterThan(20);
      expect(ribbons).toBeLessThanOrEqual(FOLIAGE.swamptree.clusters);
      expect(FOLIAGE.swamptree.clusters * FOLIAGE.swamptree.segs * 2).toBeLessThanOrEqual(1600);
      expect(g.index.count / 3).toBe(ribbons * FOLIAGE.swamptree.segs * 2);
    });

    it('hangs: every ribbon ends well below its root, inside the curtain radius', () => {
      const g = willow(), pos = g.getAttribute('position'), uv = g.getAttribute('uv');
      const per = rows * 2;
      for (let r = 0; r < pos.count / per; r++) {
        const root = r * per, tip = root + per - 2;
        expect(uv.getY(root)).toBe(0);
        expect(uv.getY(tip)).toBe(1);
        expect(pos.getY(tip)).toBeLessThan(pos.getY(root) - 0.1);
      }
      const reach = FOLIAGE.swamptree.radius + FOLIAGE.swamptree.size;   // plus half a ribbon either side
      for (let i = 0; i < pos.count; i++) expect(Math.hypot(pos.getX(i), pos.getZ(i))).toBeLessThan(reach);
    });

    it('carries baked shade and is deterministic', () => {
      const a = willow(), b = willow();
      expect(a.getAttribute('color').count).toBe(a.getAttribute('position').count);
      expect(Array.from(a.getAttribute('position').array)).toEqual(Array.from(b.getAttribute('position').array));
    });

    it('is wired in everywhere a tree kind has to be listed', () => {
      for (const k of ['swamptree', 'sporewillow']) {
        expect(FOLIAGE[k].style).toBe('willow');
        expect(TREE_SCALE[k]).toBeGreaterThan(1);
        expect(SOLID_PROP_KINDS.has(k), `${k} blocks movement`).toBe(true);
        expect(SIGHT_BLOCKING_KINDS.has(k), `${k} blocks sight`).toBe(true);
      }
    });

    it('stays in the same brightness family as the trees beside it', () => {
      /* It first shipped at 0x98a84e, about 2.3x the moor's other trees when
         measured under moor light, and looked pale and out of place in game. */
      const lum = hex => {
        const c = new THREE.Color(hex);
        return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      };
      expect(lum(FOLIAGE.swamptree.tint)).toBeLessThan(lum(FOLIAGE.elm.tint) * 1.25);
    });

    it('the moor mixes every living species, more thinly', () => {
      const scene = readFileSync('src/render/dungeon_scene.js', 'utf8');
      const list = scene.match(/const MOOR_TREES = \[([^\]]*)\]/)[1];
      for (const k of ['swamptree', 'pine', 'spruce', 'fir', 'oak', 'elm', 'birch', 'hawthorn', 'pollarded']) {
        expect(list, k).toContain(`'${k}'`);
      }
      /* the broadleaf models live in another folder: it has to load with the moor */
      expect(scene).toMatch(/moor: \['Forest', 'Holdfast'\]/);
      expect(THEMES.moor.treeDensity).toBeLessThan(1);
    });

    it('the moor gathers its trees into copses over mostly bare ground', () => {
      const { size, above, lone } = THEMES.moor.treeCopses;
      const scene = readFileSync('src/render/dungeon_scene.js', 'utf8');
      expect(scene).toContain('copseNoise(x, y,');
      for (const seed of [1, 7, 42]) {
        const n = 300, inside = new Uint8Array(n * n);
        let count = 0;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          const v = copseNoise(x, y, seed, size);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
          if (v >= above) { inside[y * n + x] = 1; count++; }
        }
        const cover = count / (n * n);
        expect(cover, `seed ${seed} cover`).toBeGreaterThan(0.12);
        expect(cover, `seed ${seed} cover`).toBeLessThan(0.32);
        /* Stands, not speckle: most copse cells have copse on all four sides. */
        let solid = 0;
        for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
          const c = y * n + x;
          if (inside[c] && inside[c - 1] && inside[c + 1] && inside[c - n] && inside[c + n]) solid++;
        }
        expect(solid / count, `seed ${seed} clumping`).toBeGreaterThan(0.5);
      }
      expect(lone).toBeLessThan(0.1);
    });

    it('ships the model where the game loads it from', () => {
      expect(existsSync('public/3d/Moor/willow_clean.opt.glb')).toBe(true);
    });
  });

  it('every FOLIAGE entry has the fields the geometry builder reads', () => {
    for (const [k, f] of Object.entries(FOLIAGE)) {
      for (const field of ['tint', 'size', 'minH', 'cards', 'push']) expect(f[field], `${k}.${field}`).toBeDefined();
    }
  });
});
