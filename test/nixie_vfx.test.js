import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  initNixieVfx,
  playNixieEffect,
  updateNixieVfx,
  stopNixieEffect,
  registerPersistentNixieEffect,
  clearPersistentNixieEffects
} from '../src/render/nixie_vfx.js';
import { GEO } from '../src/render/dungeon_geo.js';

describe('NixieFX Three.js Integration & Presets', () => {
  let scene, camera;

  beforeEach(() => {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  });

  it('Initializes ThreeVfxRenderer attached to scene and camera', () => {
    const renderer = initNixieVfx(scene, camera);
    expect(renderer).toBeDefined();
    expect(typeof renderer.update).toBe('function');
  });

  it('Spawns and updates attack impact presets (hit_sparks, crit_sparks, blunt_impact, pierce_sparks)', () => {
    initNixieVfx(scene, camera);

    const presets = ['hit_sparks', 'crit_sparks', 'blunt_impact', 'pierce_sparks', 'aura_rage'];
    const instances = [];

    for (const p of presets) {
      const inst = playNixieEffect(p, { x: 1, y: 0.5, z: 2 }, { scale: 1.0, duration: 0.5 });
      expect(inst).toBeDefined();
      instances.push(inst);
    }

    expect(() => {
      updateNixieVfx(0.016);
      updateNixieVfx(0.016);
    }).not.toThrow();

    for (const inst of instances) {
      stopNixieEffect(inst);
    }
  });

  it('Spawns and manages continuous torch and campfire embers', () => {
    initNixieVfx(scene, camera);

    clearPersistentNixieEffects();
    const torchInst = registerPersistentNixieEffect('torch_embers', { x: 3, y: 1.5, z: 4 });
    const campInst = registerPersistentNixieEffect('campfire_embers', { x: 0, y: 0.35, z: 0 });

    expect(torchInst).toBeDefined();
    expect(campInst).toBeDefined();

    expect(() => {
      updateNixieVfx(0.016);
      updateNixieVfx(0.016);
    }).not.toThrow();

    expect(() => {
      clearPersistentNixieEffects();
    }).not.toThrow();
  });

  it('Spawn pad geometry is low-profile to prevent clipping party feet', () => {
    expect(GEO.platform).toBeDefined();
    expect(GEO.ring).toBeDefined();
    expect(GEO.portal).toBeDefined();

    GEO.platform.computeBoundingBox();
    const size = new THREE.Vector3();
    GEO.platform.boundingBox.getSize(size);
    // Platform height should be ultra low-profile (<= 0.05 units)
    expect(size.y).toBeLessThanOrEqual(0.05);
  });
});
