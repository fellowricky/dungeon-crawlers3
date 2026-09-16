import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

if (typeof globalThis.document === 'undefined') {
  const dummyCtx = {
    font: '', measureText: () => ({ width: 10 }), strokeText: () => {},
    fillText: () => {}, clearRect: () => {}, fillRect: () => {},
    beginPath: () => {}, arc: () => {}, fill: () => {}
  };
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

import { getOrLoadSpriteTexture, spawnSpriteEffect, updateWorldFx } from '../src/game/entities.js';

describe('VFX Texture Cache & Non-Disposal', () => {
  it('preserves cached sprite textures when sprite effects expire and are removed', () => {
    const scene = new THREE.Scene();
    const testPath = 'dcss/effect/kny_star_0.png';

    // 1. Load texture and spawn first effect
    const tex1 = getOrLoadSpriteTexture(testPath);
    expect(tex1).toBeDefined();
    expect(tex1.isTexture).toBe(true);

    const pos = new THREE.Vector3(0, 0, 0);
    spawnSpriteEffect(scene, testPath, pos, 1.5, 0.2);

    // Fast-forward past effect duration
    updateWorldFx(scene, 0.3);

    // 2. Load texture again for subsequent ability / saving throw
    const tex2 = getOrLoadSpriteTexture(testPath);
    expect(tex2).toBe(tex1);
    expect(tex2.image).toBeDefined();

    // Spawn second effect with the cached texture and verify it doesn't crash
    const effect2 = spawnSpriteEffect(scene, testPath, pos, 1.5, 0.2);
    expect(effect2.mat.map).toBe(tex2);
  });

  it('safely handles multi-frame animated sprite effects without disposing frame textures', () => {
    const scene = new THREE.Scene();
    const frames = [
      'dcss/effect/kny_slash_0.png',
      'dcss/effect/kny_slash_1.png',
      'dcss/effect/kny_slash_2.png'
    ];

    const frameTex0 = getOrLoadSpriteTexture(frames[0]);
    spawnSpriteEffect(scene, { frames, frameInterval: 0.05 }, new THREE.Vector3(1, 0, 1), 1.8, 0.15);

    // Let the animation complete and clean up
    updateWorldFx(scene, 0.25);

    // Frame texture must still be cached and intact
    const cachedTex0 = getOrLoadSpriteTexture(frames[0]);
    expect(cachedTex0).toBe(frameTex0);
    expect(cachedTex0.image).toBeDefined();
  });
});
