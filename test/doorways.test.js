/**
 * Themed doorways.
 *
 * Every theme used to share one chamfered-box threshold tinted from TH.wall.
 * Each theme now names its own post/lintel silhouette and tints, resolved
 * through DOORWAY_THEMES the same way the spawn portals resolve SPAWN_THEMES.
 * These tests guard the wiring: a theme with a typo'd geo name would silently
 * fall back to the generic door, which is exactly the bug being fixed.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { THEMES, DOORWAY_THEMES } from '../src/dungeon/dungeon_generator.js';
import { GEO } from '../src/render/dungeon_geo.js';

const DUNGEON = ['ancient', 'molten', 'frost', 'grim', 'verdant'];

describe('doorway themes — wiring', () => {
  it('every theme has a doorway entry', () => {
    const missing = Object.keys(THEMES).filter(k => !DOORWAY_THEMES[k]);
    expect(missing, `themes with no doorway styling: ${missing.join(', ')}`).toEqual([]);
  });

  it('every named geometry actually exists (no silent fallback)', () => {
    for (const [theme, cfg] of Object.entries(DOORWAY_THEMES)) {
      expect(GEO[cfg.postGeoName], `${theme}: postGeoName "${cfg.postGeoName}"`).toBeDefined();
      expect(GEO[cfg.lintelGeoName], `${theme}: lintelGeoName "${cfg.lintelGeoName}"`).toBeDefined();
    }
  });

  it('names a material from the pool the renderer knows how to resolve', () => {
    for (const [theme, cfg] of Object.entries(DOORWAY_THEMES)) {
      expect(['stone', 'ice', 'bark'], `${theme}: matName`).toContain(cfg.matName);
    }
  });

  it('each of the five dungeon themes gets its own silhouette, not a shared one', () => {
    const posts = DUNGEON.map(t => DOORWAY_THEMES[t].postGeoName);
    expect(new Set(posts).size, `dungeon post geos: ${posts.join(', ')}`).toBe(DUNGEON.length);
    const lintels = DUNGEON.map(t => DOORWAY_THEMES[t].lintelGeoName);
    expect(new Set(lintels).size, `dungeon lintel geos: ${lintels.join(', ')}`).toBe(DUNGEON.length);
  });

  it('overland biomes get a threshold marker distinct from every dungeon door', () => {
    const overland = Object.keys(THEMES).filter(k => THEMES[k].overland);
    expect(overland.length).toBeGreaterThan(0);
    const dungeonPosts = new Set(DUNGEON.map(t => DOORWAY_THEMES[t].postGeoName));
    for (const t of overland) {
      expect(dungeonPosts.has(DOORWAY_THEMES[t].postGeoName), `${t} reuses a dungeon door`).toBe(false);
    }
  });
});

describe('doorway themes — geometry fits the opening', () => {
  const size = geo => {
    geo.computeBoundingBox();
    const v = new THREE.Vector3();
    geo.boundingBox.getSize(v);
    return v;
  };

  it('posts stay short enough and narrow enough to frame a one-cell door', () => {
    for (const [theme, cfg] of Object.entries(DOORWAY_THEMES)) {
      const s = size(GEO[cfg.postGeoName]);
      /* the arch loop seats posts ~0.52 either side of centre; a post wider
         than ~0.5 would close the visual gap entirely */
      expect(s.x, `${theme}: post width`).toBeLessThan(0.5);
      expect(s.z, `${theme}: post depth`).toBeLessThan(0.5);
      /* the lintel sits at y=1.62 — a much taller post would spear through it */
      expect(s.y, `${theme}: post height`).toBeGreaterThan(1.0);
      expect(s.y, `${theme}: post height`).toBeLessThan(2.0);
    }
  });

  it('lintels are one unit wide so the renderer can scale them to the opening', () => {
    for (const [theme, cfg] of Object.entries(DOORWAY_THEMES)) {
      const s = size(GEO[cfg.lintelGeoName]);
      expect(s.x, `${theme}: lintel width must be 1 for len scaling`).toBeCloseTo(1, 1);
      expect(s.y, `${theme}: lintel height`).toBeLessThan(0.8);
    }
  });
});
