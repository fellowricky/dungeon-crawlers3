import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { combatMethods } from '../src/game/combat.js';

describe('D&D 5e Compliant Moonbeam Spell', () => {
  it('should define Moonbeam as a 2nd level concentration spell', () => {
    expect(SPELLS.moonbeam).toBeDefined();
    expect(SPELLS.moonbeam.level).toBe(2);
    expect(SPELLS.moonbeam.concentration).toBe(true);
  });

  it('should create persistent AoEZone and establish concentration when cast', () => {
    let concentrated = null;
    let spawnedZone = null;
    let logged = [];

    const mockGame = {
      _side: 'hero',
      monsters: [],
      heroes: [],
      markSpellUsed: vi.fn(),
      playAbilityFx: vi.fn(),
      fxLog: (msg) => logged.push(msg),
      fxBeam: vi.fn(),
      _v3: (x, y, z) => ({ x, y, z }),
      fxAoEVisual: vi.fn().mockReturnValue({ group: { position: { set: vi.fn() } } }),
      activeAoEZones: [],
      spawnAoEZone(caster, spellKey, x, z, radius, options) {
        spawnedZone = combatMethods.spawnAoEZone.call(this, caster, spellKey, x, z, radius, options);
        return spawnedZone;
      },
      concentrate(h, key, targets, zone) {
        h.conc = { key, targets, zone };
        concentrated = h.conc;
      },
      resolveMoonbeamDamage: vi.fn()
    };

    const hero = { _side: 'hero', data: { name: 'Druid', hp: 30, dmgBonus: 0 } };
    const foe = { _side: 'mon', x: 5, z: 5, data: { name: 'Goblin', hp: 10 } };
    mockGame.monsters = [foe];

    const result = SPELLS.moonbeam.cast(mockGame, hero, foe, [foe], 2);

    expect(result).toBe(true);
    expect(mockGame.markSpellUsed).toHaveBeenCalledWith(hero, SPELLS.moonbeam);
    expect(spawnedZone).toBeDefined();
    expect(spawnedZone.spellKey).toBe('moonbeam');
    expect(spawnedZone.options.cylinderBeam).toBe(true);
    expect(concentrated).toBeDefined();
    expect(concentrated.key).toBe('moonbeam');
    expect(mockGame.resolveMoonbeamDamage).toHaveBeenCalledWith(spawnedZone, foe);
  });

  it('should support moveAoEZone and useMoveMoonbeam to relocate the cylinder', () => {
    let logged = [];
    const mockGame = {
      ...combatMethods,
      _side: 'hero',
      monsters: [],
      heroes: [],
      activeAoEZones: [],
      playAbilityFx: vi.fn(),
      fxLog: (msg) => logged.push(msg),
      fxBeam: vi.fn(),
      refreshAbilityHud: vi.fn(),
      _v3: (x, y, z) => ({ x, y, z }),
      resolveMoonbeamDamage: vi.fn(),
      moveAoEZone: combatMethods.moveAoEZone
    };

    const setPos = vi.fn();
    const hero = {
      _side: 'hero',
      x: 0,
      z: 0,
      data: { name: 'Druid', hp: 30 },
      active: true
    };
    const zone = {
      caster: hero,
      x: 2,
      z: 2,
      radius: 1.8,
      visual: { group: { position: { set: setPos } } },
      savesThisTurn: new Set()
    };
    hero.conc = { key: 'moonbeam', zone };

    const foe = { _side: 'mon', x: 8, z: 8, data: { name: 'Orc', hp: 20 }, active: true };
    mockGame.monsters = [foe];

    const moveResult = mockGame.useMoveMoonbeam(hero, { x: 8, z: 8 });

    expect(moveResult).toBe(true);
    expect(zone.isMoving).toBe(true);
    expect(zone.targetX).toBe(8);
    expect(zone.targetZ).toBe(8);

    // Simulate 0.5s lerp pass
    mockGame.activeAoEZones = [zone];
    mockGame.updateAoEZones(0.6);

    expect(zone.isMoving).toBe(false);
    expect(zone.x).toBe(8);
    expect(zone.z).toBe(8);
    expect(setPos).toHaveBeenCalledWith(8, 0, 8);
    expect(hero.actUsed).toBe(true);
    expect(mockGame.resolveMoonbeamDamage).toHaveBeenCalledWith(zone, foe);
  });

  it('should revert shape-shifted target when failing Moonbeam CON save', () => {
    const mockGame = {
      ...combatMethods,
      spellSave: vi.fn().mockReturnValue(false), // Save failed
      spellDamage: vi.fn(),
      revertWildShape: vi.fn(),
      fxLog: vi.fn()
    };

    const zone = {
      caster: { data: { name: 'Druid', dmgBonus: 0 } },
      slotLevel: 2
    };

    const shapeShiftedFoe = {
      data: { name: 'Shape-shifted Enemy', hp: 25, inWildShape: true }
    };

    mockGame.resolveMoonbeamDamage(zone, shapeShiftedFoe);

    expect(mockGame.spellDamage).toHaveBeenCalled();
    expect(mockGame.revertWildShape).toHaveBeenCalledWith(shapeShiftedFoe);
  });
});
