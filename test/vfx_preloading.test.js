import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { getOrLoadSpriteTexture, preloadAllSpellAndCombatVFX, spawnSpriteEffect } from '../src/game/entities.js';

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

describe('VFX Texture Caching & Preloading', () => {
  it('caches sprite textures so repeated calls return identical texture instances', () => {
    const path = 'dcss/effect/flame_0.png';
    const tex1 = getOrLoadSpriteTexture(path);
    const tex2 = getOrLoadSpriteTexture(path);

    expect(tex1).toBeDefined();
    expect(tex1).toBe(tex2); // Cached texture instance reused
  });

  it('preloadAllSpellAndCombatVFX pre-populates common spell and combat effect textures', () => {
    const compileSpy = vi.fn();
    const initTexSpy = vi.fn();
    const mockRenderer = {
      compile: compileSpy,
      initTexture: initTexSpy
    };
    const mockScene = new THREE.Scene();
    const mockCam = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

    preloadAllSpellAndCombatVFX(mockRenderer, mockScene, mockCam);

    const slashTex = getOrLoadSpriteTexture('dcss/effect/kny_slash_0.png');
    const boltTex = getOrLoadSpriteTexture('dcss/effect/magic_bolt_1.png');

    expect(slashTex).toBeDefined();
    expect(boltTex).toBeDefined();
    expect(compileSpy).toHaveBeenCalled();
  });

  it('spawnSpriteEffect reuses cached textures on first cast', () => {
    const scene = new THREE.Scene();
    const pos = new THREE.Vector3(0, 0, 0);

    // Call spawnSpriteEffect
    spawnSpriteEffect(scene, 'dcss/effect/flame_0.png', pos, 1.5, 0.4);

    expect(scene.children.length).toBe(1);
    const sprite = scene.children[0];
    expect(sprite.isSprite).toBe(true);
    expect(sprite.material.map).toBe(getOrLoadSpriteTexture('dcss/effect/flame_0.png'));
  });
});
