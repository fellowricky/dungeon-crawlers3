import { describe, it, expect } from 'vitest';
import { generateDungeon } from '../src/dungeon/dungeon_generator.js';

if (typeof globalThis.document === 'undefined') {
  globalThis.innerWidth = 1920;
  globalThis.innerHeight = 1080;
  const dummyCtx = new Proxy({
    font: '', measureText: () => ({ width: 10 }),
    getImageData: (w, h) => ({ data: new Uint8Array(4) }),
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

describe('Camera Initialization & Snapping', () => {
  it('buildScene initializes camTarget directly on the entrance room', async () => {
    const { buildScene, camTarget } = await import('../src/render/dungeon_scene.js');
    const d = generateDungeon(42, { roomCount: 16, themeKey: 'ancient' });
    buildScene(d);

    const er = d.rooms[d.entrance];
    expect(er).toBeDefined();

    // Floor origin with half-cell center offset: wx(x) = x - W/2 + 0.5
    const expectedX = er.cx - d.W * 0.5 + 0.5;
    const expectedZ = er.cy - d.H * 0.5 + 0.5;

    expect(camTarget.x).toBeCloseTo(expectedX, 1);
    expect(camTarget.z).toBeCloseTo(expectedZ, 1);
    expect(camTarget.y).toBe(0);
  });

  it('game.updateCameraDirector runs smoothly during combat with active clash without throwing', async () => {
    const { game } = await import('../src/game/game.js');
    const { camTarget } = await import('../src/render/dungeon_scene.js');
    game.engine = {
      camTarget,
      updateCam: () => {}
    };
    game.combat = true;
    game.heroes = [
      { x: 0, z: 0, data: { hp: 10, maxHp: 10 }, lungeT: 0.2, target: { x: 2, z: 0 } }
    ];
    game.monsters = [
      { x: 2, z: 0, active: true, data: { hp: 10, maxHp: 10 } }
    ];
    expect(() => {
      game.updateCameraDirector(1 / 30, game.heroes);
    }).not.toThrow();
  });
});
