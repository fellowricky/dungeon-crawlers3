import { describe, it, expect } from 'vitest';
import { THEMES } from '../src/dungeon/dungeon_generator.js';

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

describe('Sporewood Tree Rework', () => {
  it('defines rich fungal colors and textures for the Sporewood theme', () => {
    const sporewood = THEMES.sporewood;
    expect(sporewood).toBeDefined();

    // Verify dark fungal bark wall color (not pale white 0x6a5a72)
    expect(sporewood.wall).toBe(0x2a2233);

    // Verify bioluminescent emerald/teal cap & canopy tint
    expect(sporewood.cap).toBe(0x287d52);
    expect(sporewood.canopyTint).toBe(0x59d68f);
  });

  it('assigns textured materials to bark and leaf rendering', async () => {
    const { matBark, matLeaf } = await import('../src/render/dungeon_materials.js');
    expect(matBark).toBeDefined();
    expect(matBark.map).toBeDefined();
    expect(matLeaf).toBeDefined();
    expect(matLeaf.map).toBeDefined();
  });
});
