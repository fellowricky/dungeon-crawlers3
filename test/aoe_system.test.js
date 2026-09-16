import { describe, it, expect, vi } from 'vitest';
import { PersistentAoEZoneManager } from '../src/game/aoe_system.js';

describe('PersistentAoEZoneManager', () => {
  it('should spawn, move, and remove persistent AoE zones', () => {
    const manager = new PersistentAoEZoneManager();
    const setPos = vi.fn();

    const mockGame = {
      activeAoEZones: [],
      fxAoEVisual: vi.fn().mockReturnValue({ group: { position: { set: setPos } } }),
      fxRemoveAoEVisual: vi.fn()
    };

    const caster = { _side: 'hero', x: 0, z: 0, data: { hp: 30 }, active: true };

    // 1. Spawn Zone
    const zone = manager.spawnZone(mockGame, caster, 'moonbeam', 2.0, 4.0, 1.8, {
      cylinderBeam: true,
      color: 0xc0e8ff
    });

    expect(zone).toBeDefined();
    expect(zone.x).toBe(2.0);
    expect(zone.z).toBe(4.0);
    expect(zone.radius).toBe(1.8);
    expect(mockGame.activeAoEZones).toContain(zone);

    // 2. Move Zone (Smooth Glide)
    manager.moveZone(zone, 6.0, 8.0, 0.5);
    expect(zone.isMoving).toBe(true);
    expect(zone.targetX).toBe(6.0);
    expect(zone.targetZ).toBe(8.0);

    // Simulate update step over 0.6s
    manager.updateZones(mockGame, 0.6);
    expect(zone.isMoving).toBe(false);
    expect(zone.x).toBe(6.0);
    expect(zone.z).toBe(8.0);
    expect(setPos).toHaveBeenCalledWith(6.0, 0, 8.0);
    expect(zone.y).toBe(0);

    // 3. Remove Zone
    manager.removeZone(mockGame, zone);
    expect(mockGame.activeAoEZones).not.toContain(zone);
    expect(mockGame.fxRemoveAoEVisual).toHaveBeenCalledWith(zone.visual);
  });

  it('should reset per-turn save records on processTurnZones', () => {
    const manager = new PersistentAoEZoneManager();
    const mockGame = {
      activeAoEZones: [],
      resolveMoonbeamDamage: vi.fn()
    };

    const caster = { _side: 'hero', x: 0, z: 0, data: { hp: 30 }, active: true };
    const foe = { _side: 'mon', x: 2, z: 2, data: { hp: 20 }, active: true };

    const zone = {
      caster,
      spellKey: 'moonbeam',
      x: 2,
      z: 2,
      radius: 1.8,
      savesThisTurn: new Set([foe])
    };

    mockGame.activeAoEZones = [zone];
    manager.processTurnZones(mockGame, foe);

    expect(zone.savesThisTurn.has(foe)).toBe(true);
    expect(mockGame.resolveMoonbeamDamage).toHaveBeenCalledWith(zone, foe);
  });

  it('updates sparkleFx zones safely when wireMat is null', async () => {
    const THREE = await import('three');
    const { updateProjectiles } = await import('../src/game/entities.js');
    const mockScene = new THREE.Scene();
    const activeAoEVisuals = [{
      group: new THREE.Group(),
      t: 0.5,
      dur: 10,
      sparkleFx: {
        fxGroup: new THREE.Group(),
        wireMat: null,
        sparks: [
          {
            mesh: new THREE.Sprite(),
            mat: new THREE.SpriteMaterial(),
            base: new THREE.Vector3(0, 0, 0),
            rise: 1.0,
            speed: 0.5,
            phase: 0.2
          }
        ]
      }
    }];

    expect(() => {
      updateProjectiles(0.016, mockScene, activeAoEVisuals);
    }).not.toThrow();
  });

  it('triggers Spirit Guardians damage when an enemy moves into the aura', () => {
    const manager = new PersistentAoEZoneManager();
    const mockGame = {
      D: { W: 10 },
      wx: c => c,
      wz: c => c,
      activeAoEZones: [],
      spellSave: vi.fn().mockReturnValue(false),
      spellDamage: vi.fn(),
      fxLog: vi.fn()
    };

    const caster = { _side: 'hero', x: 5, z: 5, data: { hp: 30, dmgBonus: 2 }, active: true };
    const foe = { _side: 'mon', x: 8, z: 5, data: { hp: 20, name: 'Goblin' }, active: true };

    const zone = {
      caster,
      spellKey: 'spiritGuardians',
      movement: 'attached',
      x: 5,
      z: 5,
      radius: 3.0,
      savesThisTurn: new Set()
    };
    mockGame.activeAoEZones = [zone];

    // Enemy steps from (8, 5) cell 58 to (6, 5) cell 56 (inside radius 3 of caster at 5,5)
    manager.processStepZones(mockGame, foe, 58, 56);

    expect(zone.savesThisTurn.has(foe)).toBe(true);
    expect(mockGame.spellDamage).toHaveBeenCalledWith(
      foe,
      expect.any(Number),
      caster,
      false,
      expect.objectContaining({ dmgType: 'radiant', magical: true })
    );
  });

  it('triggers Spirit Guardians damage when the caster moves towards an enemy', () => {
    const manager = new PersistentAoEZoneManager();
    const mockGame = {
      D: { W: 10 },
      wx: c => c,
      wz: c => c,
      activeAoEZones: [],
      monsters: [],
      spellSave: vi.fn().mockReturnValue(false),
      spellDamage: vi.fn(),
      fxLog: vi.fn()
    };

    const caster = { _side: 'hero', x: 2, z: 5, data: { hp: 30, dmgBonus: 2 }, active: true };
    const foe = { _side: 'mon', x: 5, z: 5, data: { hp: 20, name: 'Orc' }, active: true };
    mockGame.monsters = [foe];

    const zone = {
      caster,
      spellKey: 'spiritGuardians',
      movement: 'attached',
      x: 2,
      z: 5,
      radius: 3.0,
      savesThisTurn: new Set()
    };
    mockGame.activeAoEZones = [zone];

    // Caster steps from (2, 5) cell 52 to (3, 5) cell 53.
    // Foe at (5, 5) was distance 3.0 away, now within distance 2.0 <= 3.0!
    manager.processStepZones(mockGame, caster, 52, 53);

    expect(zone.savesThisTurn.has(foe)).toBe(true);
    expect(mockGame.spellDamage).toHaveBeenCalledWith(
      foe,
      expect.any(Number),
      caster,
      false,
      expect.objectContaining({ dmgType: 'radiant', magical: true })
    );
  });

  it('triggers Spirit Guardians damage at start of caster turn for standing enemies', () => {
    const manager = new PersistentAoEZoneManager();
    const mockGame = {
      activeAoEZones: [],
      monsters: [],
      spellSave: vi.fn().mockReturnValue(false),
      spellDamage: vi.fn(),
      fxLog: vi.fn()
    };

    const caster = { _side: 'hero', x: 5, z: 5, data: { hp: 30, dmgBonus: 2 }, active: true };
    const foe = { _side: 'mon', x: 6, z: 5, data: { hp: 20, name: 'Skeleton' }, active: true };
    mockGame.monsters = [foe];

    const zone = {
      caster,
      spellKey: 'spiritGuardians',
      movement: 'attached',
      x: 5,
      z: 5,
      radius: 3.0,
      savesThisTurn: new Set()
    };
    mockGame.activeAoEZones = [zone];

    // Caster starts their turn
    manager.processTurnZones(mockGame, caster);

    expect(zone.savesThisTurn.has(foe)).toBe(true);
    expect(mockGame.spellDamage).toHaveBeenCalledWith(
      foe,
      expect.any(Number),
      caster,
      false,
      expect.objectContaining({ dmgType: 'radiant', magical: true })
    );
  });

  it('marks Spirit Guardians as difficult terrain', () => {
    const manager = new PersistentAoEZoneManager();
    const mockGame = {
      D: { W: 10 },
      wx: c => c,
      wz: c => c,
      activeAoEZones: []
    };

    const caster = { _side: 'hero', x: 5, z: 5, data: { hp: 30 }, active: true };
    const zone = {
      caster,
      spellKey: 'spiritGuardians',
      movement: 'attached',
      x: 5,
      z: 5,
      radius: 3.0
    };
    mockGame.activeAoEZones = [zone];

    // Cell (5, 5) -> cell index 55
    expect(manager.isDifficultTerrain(mockGame, 55)).toBe(true);
    // Cell (0, 0) -> cell index 0 (far away)
    expect(manager.isDifficultTerrain(mockGame, 0)).toBe(false);
  });
});
