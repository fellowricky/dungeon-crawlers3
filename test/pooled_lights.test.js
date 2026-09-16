import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

/* Beams paint a canvas gradient texture; the same stub the camp test uses. */
if (typeof globalThis.document === 'undefined') {
  const dummyCtx = new Proxy({
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    getImageData: () => ({ data: new Uint8Array(4) })
  }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const dummyEl = { style: {}, getContext: () => dummyCtx, setAttribute: () => {}, appendChild: () => {} };
  globalThis.document = { createElement: () => dummyEl, getElementById: () => null, body: dummyEl };
}

const {
  ensureFlashLightPool, spawnAoEVisual, removeAoEVisual, spawnBeamEffect,
  spawnFlashLight, updateProjectiles, clearEffects
} = await import('../src/game/entities.js');

/* Three.js bakes the point-light count into every lit shader, so a change in
   the count mid-level recompiles the scene's materials — a multi-second stall.
   Every transient effect light therefore has to come from the fixed pool that
   is already in the scene. These pin that invariant: spawning and tearing
   down effects never changes how many PointLights the scene holds. */

function countLights(scene) {
  let n = 0;
  scene.traverse(o => { if (o.isPointLight) n++; });
  return n;
}

function pooledScene() {
  const scene = new THREE.Scene();
  ensureFlashLightPool(scene);
  return scene;
}

describe('pooled effect lights', () => {
  it('an AoE zone borrows a pooled light and hands it back on removal', () => {
    const scene = pooledScene();
    const base = countLights(scene);
    expect(base).toBeGreaterThan(0);

    const v = spawnAoEVisual(scene, { x: 1, z: 2 }, 0xffaa30, 1.2);
    expect(v).toBeTruthy();
    expect(v.lights.length).toBe(1);
    expect(countLights(scene)).toBe(base);          // borrowed, not created
    expect(v.lights[0].intensity).toBeGreaterThan(0);

    removeAoEVisual(scene, v);
    expect(countLights(scene)).toBe(base);          // returned, not disposed
    expect(v.lights[0].parent).toBe(scene);
    expect(v.lights[0].intensity).toBe(0);
  });

  it('spawnAoEVisual takes (scene, pos, color, size) — the order every caller uses', () => {
    const scene = pooledScene();
    const v = spawnAoEVisual(scene, { x: 0, z: 0 }, 0xffaa30, 1.2);
    expect(v.size).toBe(1.2);
    expect(v.innerMat.color.getHex()).toBe(0xffaa30);
    removeAoEVisual(scene, v);
  });

  it('lightning and laser beams borrow pooled lights and release them on expiry', () => {
    const scene = pooledScene();
    const base = countLights(scene);
    const from = new THREE.Vector3(0, 0.7, 0), to = new THREE.Vector3(4, 0.7, 0);

    spawnBeamEffect(scene, from, to, { type: 'lightning', duration: 0.2 });
    spawnBeamEffect(scene, from, to, { type: 'laser', duration: 0.2 });
    expect(countLights(scene)).toBe(base);

    updateProjectiles(scene, 0.5);                   // both beams expire
    expect(countLights(scene)).toBe(base);
    expect(scene.children.filter(c => c.type === 'Group').length).toBe(0);
  });

  it('runs unlit rather than allocating when the pool is exhausted', () => {
    const scene = pooledScene();
    const base = countLights(scene);
    const zones = [];
    for (let i = 0; i < base + 4; i++) zones.push(spawnAoEVisual(scene, { x: i, z: 0 }, 0x3fd0bb, 1));
    expect(countLights(scene)).toBe(base);
    expect(zones.filter(z => z.lights.length === 0).length).toBeGreaterThan(0);
    for (const z of zones) removeAoEVisual(scene, z);
    expect(countLights(scene)).toBe(base);
  });

  it('clearEffects returns every light to the pool and keeps the pool in the scene', () => {
    const scene = pooledScene();
    const base = countLights(scene);
    spawnAoEVisual(scene, { x: 0, z: 0 }, 0x3fd0bb, 1);
    spawnFlashLight(scene, { x: 0, y: 0, z: 0 });
    spawnBeamEffect(scene, new THREE.Vector3(0, 0.7, 0), new THREE.Vector3(2, 0.7, 0), { type: 'lightning', duration: 1 });

    clearEffects(scene);
    expect(countLights(scene)).toBe(base);
    scene.traverse(o => { if (o.isPointLight) { expect(o.parent).toBe(scene); expect(o.intensity).toBe(0); } });

    /* And the whole pool is available again. */
    const v = spawnAoEVisual(scene, { x: 0, z: 0 }, 0x3fd0bb, 1);
    expect(v.lights.length).toBe(1);
    removeAoEVisual(scene, v);
  });
});
