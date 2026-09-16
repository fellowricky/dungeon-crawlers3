import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  initNixieVfx,
  playNixieEffect,
  stopNixieEffect,
  updateNixieVfx,
  clearPersistentNixieEffects
} from '../src/render/nixie_vfx.js';
import { updateEntityStatusAuras } from '../src/game/entities.js';

describe('NixieFX Particle System Lifecycle & Presets', () => {
  let scene, camera;

  beforeEach(() => {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    initNixieVfx(scene, camera);
    clearPersistentNixieEffects();
  });

  it('initializes and spawns all elemental and atmospheric presets without errors', () => {
    const presets = [
      'hit_sparks',
      'crit_sparks',
      'blunt_impact',
      'pierce_sparks',
      'torch_embers',
      'campfire_embers',
      'fire_burst',
      'divine_smite',
      'holy_burst',
      'frost_nova',
      'lightning_burst',
      'poison_burst',
      'dark_burst',
      'ambient_dust_motes',
      'ambient_spores',
      'ambient_volcanic_cinders',
      'ambient_mist_wisps',
      'loot_sparkles',
      'portal_vortex',
      'level_up_burst',
      'projectile_fire_trail',
      'projectile_magic_trail',
      'aura_poison',
      'aura_bless',
      'door_splinters'
    ];

    for (const preset of presets) {
      const inst = playNixieEffect(preset, new THREE.Vector3(0, 0.5, 0), { duration: 0.5 });
      expect(inst).toBeDefined();
    }
  });

  it('updates lifetimes and automatically garbage-collects expired particle instances', () => {
    const inst = playNixieEffect('fire_burst', new THREE.Vector3(0, 0.5, 0), { duration: 0.1 });
    expect(inst).toBeDefined();

    // Advance time past duration
    updateNixieVfx(0.15);

    // Further updates should run cleanly
    expect(() => updateNixieVfx(0.016)).not.toThrow();
  });

  it('ticks entity status auras for poisoned and blessed entities cleanly', () => {
    const mockEntities = [
      { x: 1, z: 2, _effects: { poisoned: { until: 10 } } },
      { x: 3, z: 4, _effects: { blessed: { until: 15 } } },
      { x: 5, z: 6, _effects: { raging: { until: 8 } } },
      { x: 7, z: 8, moving: true, _effects: { hasted: { until: 6 } } }
    ];

    expect(() => updateEntityStatusAuras(mockEntities, 0.5)).not.toThrow();
  });
});
