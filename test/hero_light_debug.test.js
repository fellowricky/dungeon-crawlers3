import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateOverland, generateDungeon, FLOOR } from '../src/dungeon/dungeon_generator.js';

if (typeof globalThis.document === 'undefined') {
  globalThis.innerWidth = 1920;
  globalThis.innerHeight = 1080;
  const dummyCtx = new Proxy({
    font: '', measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8Array(4) }),
    createImageData: (w = 100, h = 100) => ({ data: new Uint8Array(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} })
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {};
    }
  });
  const dummyEl = {
    setAttribute: () => {}, addEventListener: () => {}, style: { setProperty: () => {} },
    getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
    getContext: () => dummyCtx,
    querySelector: () => dummyEl,
    querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    appendChild: () => {}
  };
  globalThis.document = {
    createElement: () => dummyEl, createElementNS: () => dummyEl,
    getElementById: () => null, querySelector: () => dummyEl, querySelectorAll: () => [], body: dummyEl,
    documentElement: dummyEl
  };
}

describe('hero-held light sources and debug mode', async () => {
  const S = await import('../src/render/dungeon_scene.js');
  const SL = await import('../src/render/sprite_lighting.js');
  const LS = await import('../src/game/light_sources.js');
  const { game } = await import('../src/game/game.js');

  it('classifyLight resists float32 precision loss across custom theme thresholds', () => {
    const origB = LS.LIGHT_LEVELS.bright, origD = LS.LIGHT_LEVELS.dim;
    try {
      // Holdfast night: 0.41 (in float32: 0.4099999964237213)
      LS.LIGHT_LEVELS.bright = 0.41;
      LS.LIGHT_LEVELS.dim = 0.32;
      const f32Val = new Float32Array([0.41])[0];
      expect(f32Val < 0.41).toBe(true);
      expect(LS.classifyLight(f32Val)).toBe('bright');

      // Ruinfield night: 0.22 (in float32: 0.2199999988079071)
      LS.LIGHT_LEVELS.bright = 0.22;
      LS.LIGHT_LEVELS.dim = 0.15;
      const f32Ruin = new Float32Array([0.22])[0];
      expect(f32Ruin < 0.22).toBe(true);
      expect(LS.classifyLight(f32Ruin)).toBe('bright');

      // Snowfield night: 0.12 (in float32: 0.11999999731779099)
      LS.LIGHT_LEVELS.bright = 0.12;
      LS.LIGHT_LEVELS.dim = 0.08;
      const f32Snow = new Float32Array([0.12])[0];
      expect(f32Snow < 0.12).toBe(true);
      expect(LS.classifyLight(f32Snow)).toBe('bright');
    } finally {
      LS.LIGHT_LEVELS.bright = origB;
      LS.LIGHT_LEVELS.dim = origD;
    }
  });

  it('hero torch creates bright debug aura and stark overland lighting across all themes', () => {
    for (const themeKey of ['ancient', 'forest', 'moor', 'mire', 'holdfast', 'boneyard']) {
      const isOverland = themeKey !== 'ancient';
      const d = isOverland
        ? generateOverland({ themeKey, seed: 12345, timeOfDay: 'night', weather: 'clear' })
        : generateDungeon(42, { roomCount: 16, themeKey: 'ancient' });
      d.themeKey = themeKey;
      d.params = { themeKey };
      S.buildScene(d);

      const W = d.W, H = d.H;
      let hx = 0, hz = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (d.grid[y * W + x] === FLOOR) {
            hx = x - W / 2 + 0.5;
            hz = y - H / 2 + 0.5;
            break;
          }
        }
        if (hx !== 0 || hz !== 0) break;
      }

      const hero = {
        x: hx, z: hz,
        data: {
          name: 'Valen', hp: 20, maxHp: 20,
          equipment: {
            trinket: { name: 'Torch', lightSource: 'torch', charges: 10 }
          }
        }
      };

      game.state = 'crawl';
      game.heroes = [hero];
      game.leaderIdx = 0;
      game.D = d;
      game.visitedRooms = {};
      game.revealed = new Uint8Array(W * H).fill(1);
      game.losVisible = new Uint8Array(W * H).fill(1);

      S.liveUpdate(1.0, 1.0, 0.016);

      SL.setLightDebug(true);
      SL.updateSpriteLighting([hero], 0.016);

      const pl = S.partyLights[0];
      expect(pl).toBeDefined();
      expect(pl.intensity).toBeGreaterThan(0);

      if (isOverland) {
        // Stark overland lighting: boosted reach and stark intensity multiplier
        expect(pl.distance).toBeCloseTo(6 * 1.45, 1);
        expect(pl.intensity).toBeGreaterThan(30);
      } else {
        expect(pl.distance).toBe(6);
      }

      const tiles = SL.lightDebugTiles();
      const heroTileIdx = tiles.findIndex(t => Math.hypot(t.x - hx, t.z - hz) < 0.1);
      expect(heroTileIdx).toBeGreaterThanOrEqual(0);
      const heroTile = tiles[heroTileIdx];

      // Must be classified as bright in F4 debug overlay
      expect(heroTile.state).toBe('bright');

      S.disposeLevel();
    }
  });
});

