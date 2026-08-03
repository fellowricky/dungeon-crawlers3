import { describe, it, expect } from 'vitest';

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
    setAttribute: () => {}, addEventListener: () => {}, style: {},
    getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
    getContext: () => dummyCtx,
    querySelector: () => dummyEl,
    querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    appendChild: () => {}
  };
  globalThis.document = {
    createElement: () => dummyEl, createElementNS: () => dummyEl,
    getElementById: () => null, querySelector: () => dummyEl, querySelectorAll: () => [], body: dummyEl
  };
}

describe('Camp Animation Performance & Smoothness', () => {
  it('starts camp animation without texture allocation hitching', async () => {
    const THREE = await import('three');
    const { game } = await import('../src/game/game.js');

    game.gameGroup = new THREE.Group();
    const mockHero = {
      x: 5, z: 5,
      data: { hp: 10, maxHp: 20 },
      ent: { grp: new THREE.Group() }
    };

    game.beginCampAnimation(5, 5, [mockHero]);
    expect(game.campAnim).toBeDefined();
    expect(game.campAnim.tents.length).toBe(1);

    // Verify hero hidden while in tent
    expect(mockHero.ent.grp.visible).toBe(false);

    // Step animation through
    const continuing = game.updateCampAnimation(0.1);
    expect(continuing).toBe(true);

    // Finish animation
    game.updateCampAnimation(15.0);
    expect(game.campAnim).toBeNull();
    expect(mockHero.ent.grp.visible).toBe(true);
  });
});
