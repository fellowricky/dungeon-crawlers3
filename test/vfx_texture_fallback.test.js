import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

if (typeof globalThis.document === 'undefined') {
  const dummyCtx = {
    clearRect: () => {},
    fillRect: () => {},
    getImageData: () => ({ data: new Uint8Array(4) }),
    createImageData: () => ({ data: new Uint8Array(4) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} })
  };
  const dummyEl = {
    width: 1, height: 1,
    getContext: () => dummyCtx,
    setAttribute: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    style: {}
  };
  globalThis.document = {
    createElement: () => dummyEl,
    createElementNS: () => dummyEl
  };
}

describe('VFX Texture Fallback & Transparency', () => {
  it('assigns transparent 1x1 fallback canvas when loading or on missing texture error', async () => {
    const { getOrLoadSpriteTexture } = await import('../src/game/entities.js');

    const tex = getOrLoadSpriteTexture('non_existent_spell_effect_test.png');
    expect(tex).toBeDefined();
    expect(tex.image).toBeDefined();
    // Image should be the 1x1 transparent canvas fallback, not null/empty which defaults to white in WebGL
    expect(tex.image.width).toBe(1);
    expect(tex.image.height).toBe(1);
  });

  it('initializes spawnSpriteEffect material with opacity 0 to prevent 1-frame white flash', async () => {
    const { spawnSpriteEffect } = await import('../src/game/entities.js');
    const mockScene = { add: () => {}, remove: () => {} };
    const entry = spawnSpriteEffect(mockScene, 'dcss/effect/flame_0.png', new THREE.Vector3(0, 0, 0), 1.0, 0.4);

    expect(entry).toBeDefined();
    expect(entry.mat.opacity).toBe(0);
    expect(entry.mat.transparent).toBe(true);
    // alphaTest stays 0 so soft-glow sprites keep their feathered edges instead of
    // being chopped into a hard square (the old alphaTest: 0.04 caused the
    // "bright white square / edges cut off" artifacts on spell-save & aura FX).
    expect(entry.mat.alphaTest || 0).toBe(0);
  });

  it('never leaves a single-frame frames array without a texture (white-quad bug)', async () => {
    const { spawnSpriteEffect } = await import('../src/game/entities.js');
    const mockScene = { add: () => {}, remove: () => {} };
    // spawnRichAbilityVFX passes { frames: [oneSprite] } for monster abilities
    // like the Dire Wolf's Takedown — the old code skipped the frames path for
    // length-1 arrays and fell through to an undefined sprite, leaving the
    // SpriteMaterial with no map, which renders as a solid white square.
    const entry = spawnSpriteEffect(mockScene, { frames: ['dcss/effect/sandblast_0.png'], frameInterval: 0.05 }, new THREE.Vector3(0, 0, 0), 1.6, 0.45);
    expect(entry).toBeDefined();
    expect(entry.tex).toBeTruthy();
    expect(entry.mat.map).toBe(entry.tex);
  });
});
