import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  initAmbientFX,
  updateAmbientFX,
  clearAmbientFX,
  triggerLiquidSplashFX
} from '../src/render/ambient_fx.js';
import { initNixieVfx } from '../src/render/nixie_vfx.js';

describe('Ambient & Atmospheric Particle Engine', () => {
  let scene, camera;

  beforeEach(() => {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    initNixieVfx(scene, camera);
    clearAmbientFX();
  });

  it('initializes atmosphere across different dungeon biome themes', () => {
    expect(() => initAmbientFX(scene, camera, 'Dungeon')).not.toThrow();
    clearAmbientFX();

    expect(() => initAmbientFX(scene, camera, 'Sporewood')).not.toThrow();
    clearAmbientFX();

    expect(() => initAmbientFX(scene, camera, 'Molten')).not.toThrow();
    clearAmbientFX();

    expect(() => initAmbientFX(scene, camera, 'Sewers')).not.toThrow();
    clearAmbientFX();
  });

  it('updates localized torch embers within party proximity and culls distant torches', () => {
    initAmbientFX(scene, camera, 'Dungeon');

    const partyPos = new THREE.Vector3(5, 0, 5);
    const mockTorches = [
      { x: 6, y: 1.2, z: 6 },  // close (< 14 units)
      { x: 8, y: 1.2, z: 7 },  // close (< 14 units)
      { x: 30, y: 1.2, z: 30 } // distant (> 14 units)
    ];

    expect(() => updateAmbientFX(partyPos, mockTorches, 0.016)).not.toThrow();
  });

  it('triggers liquid splash ripples without error', () => {
    expect(() => triggerLiquidSplashFX(new THREE.Vector3(2, 0, 3), 'water')).not.toThrow();
    expect(() => triggerLiquidSplashFX(new THREE.Vector3(2, 0, 3), 'lava')).not.toThrow();
    expect(() => triggerLiquidSplashFX(new THREE.Vector3(2, 0, 3), 'acid')).not.toThrow();
  });
});
