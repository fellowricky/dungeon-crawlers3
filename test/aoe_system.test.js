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
    expect(setPos).toHaveBeenCalledWith(6.0, 0.33, 8.0);

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
});
