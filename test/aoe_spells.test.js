import { describe, it, expect, vi } from 'vitest';
import { combatMethods } from '../src/game/combat.js';
import * as THREE from 'three';

// Mock THREE.Scene and spawn functions
vi.mock('../src/game/entities.js', () => ({
  spawnAoEVisual: () => ({ group: new THREE.Group() }),
  removeAoEVisual: () => {}
}));

// Mock conditions/srd imports that are loaded transitively
vi.mock('../src/game/conditions.js', () => ({
  applyEffect: vi.fn(() => true),
  clearEffect: vi.fn(),
  hasEffect: vi.fn(() => false)
}));

describe('Persistent AoE Zones Engine', () => {
  const createMockGame = () => {
    const game = {
      activeAoEZones: [],
      monsters: [],
      elapsed: 0,
      engine: { scene: new THREE.Scene() },
      spellSave: vi.fn(() => false), // force save failure to apply conditions
      spellDamage: vi.fn(),
      playAbilityFx: vi.fn(),
      damageMonster: vi.fn(() => ({ dealt: 10, modLabel: '' })),
      // Hook stubs (real implementations come from game_hooks.js in the browser)
      fxAoEVisual: () => ({ group: new THREE.Group() }),
      fxRemoveAoEVisual: () => {},
      fxLog: () => {},
    };
    Object.assign(game, combatMethods);
    return game;
  };

  it('should register and deregister AoE zones', () => {
    const game = createMockGame();
    const caster = { data: { hp: 10 }, active: true };
    const zone = game.spawnAoEZone(caster, 'faerieFire', 0, 0, 2.5, { color: 0xb08cff, dur: 60 });

    expect(game.activeAoEZones.length).toBe(1);
    expect(game.activeAoEZones[0]).toBe(zone);

    game.removeAoEZone(zone);
    expect(game.activeAoEZones.length).toBe(0);
  });

  it('should clean up zone on caster death', () => {
    const game = createMockGame();
    const caster = { data: { hp: 10 }, active: true };
    game.spawnAoEZone(caster, 'faerieFire', 0, 0, 2.5, { dur: 60 });

    expect(game.activeAoEZones.length).toBe(1);

    // Caster dies
    caster.data.hp = 0;
    game.updateAoEZones(0.5);

    expect(game.activeAoEZones.length).toBe(0);
  });

  it('should auto-expire zone after duration', () => {
    const game = createMockGame();
    const caster = { data: { hp: 10 }, active: true };
    game.spawnAoEZone(caster, 'faerieFire', 0, 0, 2.5, { dur: 2 });

    expect(game.activeAoEZones.length).toBe(1);

    // Advance time
    game.updateAoEZones(1.5);
    expect(game.activeAoEZones.length).toBe(1);

    game.updateAoEZones(1.5);
    expect(game.activeAoEZones.length).toBe(0);
  });
});
