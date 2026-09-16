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
  hasEffect: vi.fn(() => false),
  rollSaveDetail: vi.fn(() => ({ saved: false, total: 10, d20: 10 }))
}));

describe('Persistent AoE Zones Engine', () => {
  const createMockGame = () => {
    const game = {
      activeAoEZones: [],
      monsters: [],
      elapsed: 0,
      engine: { scene: new THREE.Scene() },
      fxAoEVisual: () => ({ group: new THREE.Group() }),
      fxRemoveAoEVisual: () => {},
      fxLog: () => {},
      fxHitFlash: () => {},
      fxText: () => {},
      fxSprite: () => {},
      _v3: (x, y, z) => new THREE.Vector3(x, y, z),
      creditThreat: () => {},
      playAbilityFx: vi.fn(),
      damageMonster: vi.fn(() => ({ dealt: 10, modLabel: '' })),
    };
    Object.assign(game, combatMethods);
    game.spellDamage = vi.fn();
    game.spellSave = vi.fn(() => false);
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

  it('should correctly evaluate point in line segment and cone geometries', async () => {
    const { isPointInLineSegment, isPointInCone, isPointInAoEZone } = await import('../src/game/aoe_system.js');

    // 1. Line segment from (0, 0) to (10, 0) with half-width 0.5
    expect(isPointInLineSegment(5, 0.2, 0, 0, 10, 0, 0.5)).toBe(true);
    expect(isPointInLineSegment(5, 1.2, 0, 0, 10, 0, 0.5)).toBe(false);
    expect(isPointInLineSegment(12, 0, 0, 0, 10, 0, 0.5)).toBe(false);
    expect(isPointInLineSegment(-2, 0, 0, 0, 10, 0, 0.5)).toBe(false);

    // 2. Cone from (0, 0) pointing towards (+1, 0) with range 6
    expect(isPointInCone(3, 0.5, 0, 0, 1, 0, 6, 0.55)).toBe(true);
    expect(isPointInCone(3, 4.0, 0, 0, 1, 0, 6, 0.55)).toBe(false);
    expect(isPointInCone(-2, 0, 0, 0, 1, 0, 6, 0.55)).toBe(false);
    expect(isPointInCone(8, 0, 0, 0, 1, 0, 6, 0.55)).toBe(false);

    // 3. AoE Zone with shape: 'line'
    const lineZone = {
      shape: 'line',
      startX: 0,
      startZ: 0,
      endX: 12,
      endZ: 0,
      width: 1.0
    };
    expect(isPointInAoEZone(6, 0.3, lineZone)).toBe(true);
    expect(isPointInAoEZone(6, 2.0, lineZone)).toBe(false);
    expect(isPointInAoEZone(15, 0, lineZone)).toBe(false);
  });

  it('should damage monsters in a directional Wall of Fire line zone on turn processing', () => {
    const game = createMockGame();
    const caster = { data: { hp: 10, dmgBonus: 2 }, active: true, _side: 'hero' };
    const zone = game.spawnAoEZone(caster, 'wallOfFire', 6, 0, 6.0, {
      shape: 'line',
      startX: 0,
      startZ: 0,
      endX: 12,
      endZ: 0,
      width: 1.0,
      dur: 60
    });

    const monsterInLine = { data: { hp: 30, name: 'Orc' }, active: true, _side: 'mon', x: 6, z: 0.2 };
    const monsterOutsideLine = { data: { hp: 30, name: 'Goblin' }, active: true, _side: 'mon', x: 6, z: 3.5 };
    game.monsters = [monsterInLine, monsterOutsideLine];

    // Real-time update does NOT tick damage on arbitrary timers
    game.updateAoEZones(1.1);
    expect(game.spellDamage).not.toHaveBeenCalled();

    // Turn processing resolves damage when actor takes its turn
    game.processTurnZones(monsterInLine);

    expect(game.spellDamage).toHaveBeenCalledWith(
      monsterInLine,
      expect.any(Number),
      caster,
      false,
      expect.objectContaining({ dmgType: 'fire' })
    );

    game.processTurnZones(monsterOutsideLine);
    expect(game.spellDamage).not.toHaveBeenCalledWith(
      monsterOutsideLine,
      expect.any(Number),
      caster,
      false,
      expect.anything()
    );
  });

  it('should mark cells in Entangle as difficult terrain and apply double move cost', () => {
    const game = createMockGame();
    game.D = { W: 10, H: 10 };
    game.wx = (x) => x + 0.5;
    game.wz = (z) => z + 0.5;

    const caster = { data: { hp: 10 }, active: true, _side: 'hero' };
    const zone = game.spawnAoEZone(caster, 'entangle', 5.5, 5.5, 2.0, {
      difficultTerrain: true,
      dur: 60
    });

    // Cell at (5, 5) is at center of zone (5.5, 5.5) -> difficult terrain
    const cellInside = 5 * 10 + 5;
    expect(game.isDifficultTerrain(cellInside)).toBe(true);

    // Cell at (0, 0) is far outside -> normal terrain
    const cellOutside = 0;
    expect(game.isDifficultTerrain(cellOutside)).toBe(false);
  });

  it('should trigger Entangle saving throw and restrain monster entering the zone', async () => {
    const { applyEffect } = await import('../src/game/conditions.js');
    const game = createMockGame();
    game.D = { W: 10, H: 10 };
    game.wx = (x) => x + 0.5;
    game.wz = (z) => z + 0.5;

    const caster = { data: { hp: 10, wis: 16, pb: 2 }, active: true, _side: 'hero', conc: { targets: [] } };
    const zone = game.spawnAoEZone(caster, 'entangle', 5.5, 5.5, 2.0, {
      difficultTerrain: true,
      dur: 60
    });

    const monster = {
      data: { hp: 20, name: 'Goblin' },
      active: true,
      _side: 'mon',
      x: 1.5,
      z: 5.5,
      moveLeft: 6,
      path: [15, 25, 35, 45, 55],
      pathI: 1
    };

    // Failed save when stepping into cell (4, 5) -> cell index 54
    game.spellSave = vi.fn(() => false);
    game.clearEntityPath = vi.fn((e) => { e.path = null; e.pathI = 0; });

    const fromCell = 5 * 10 + 2; // (2, 5) -> outside
    const toCell = 5 * 10 + 5;   // (5, 5) -> inside zone

    game.processStepZones(monster, fromCell, toCell);

    expect(game.spellSave).toHaveBeenCalled();
    expect(applyEffect).toHaveBeenCalledWith(monster, 'restrained', expect.any(Object));
    expect(monster.moveLeft).toBe(0);
    expect(game.clearEntityPath).toHaveBeenCalledWith(monster);
  });

  it('triggers Entangle on an ally walking into the zone, not just enemies', async () => {
    const { applyEffect } = await import('../src/game/conditions.js');
    const game = createMockGame();
    game.D = { W: 10, H: 10 };
    game.wx = (x) => x + 0.5;
    game.wz = (z) => z + 0.5;

    const caster = { data: { hp: 10, wis: 16, pb: 2 }, active: true, _side: 'hero', conc: { targets: [] } };
    game.spawnAoEZone(caster, 'entangle', 5.5, 5.5, 2.0, { difficultTerrain: true, dur: 60 });

    const ally = {
      data: { hp: 20, name: 'Valen' },
      active: true,
      _side: 'hero',
      x: 1.5, z: 5.5,
      moveLeft: 6
    };
    game.spellSave = vi.fn(() => false);
    game.clearEntityPath = vi.fn((e) => { e.path = null; e.pathI = 0; });

    game.processStepZones(ally, 5 * 10 + 2, 5 * 10 + 5);

    expect(game.spellSave).toHaveBeenCalled();
    expect(applyEffect).toHaveBeenCalledWith(ally, 'restrained', expect.any(Object));
    expect(ally.moveLeft).toBe(0);
  });
});
