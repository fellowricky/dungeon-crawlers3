import { describe, it, expect, vi } from 'vitest';
import { createFamiliarCompanion } from '../src/game/srd.js';
import { COMPANIONS } from '../src/game/summons.js';
import { SPELLS } from '../src/game/spells.js';

describe('Find Familiar Companion System', () => {
  it('should generate valid familiar data records for Owl, Imp, and Viper', () => {
    const owl = createFamiliarCompanion('owl', 3);
    expect(owl.name).toBe('Owl Familiar');
    expect(owl.isFamiliar).toBe(true);
    expect(owl.classKey).toBe('familiar');
    expect(owl.raceKey).toBe('familiar');
    expect(owl.knownSpells).toEqual([]);
    expect(owl.visual.spriteSheet).toBe('sprites/giant_owl.png');
    expect(owl.equipment.weapon.name).toBe('Talon');
    expect(owl.equipment.weapon.melee).toBe(true);
    expect(owl.equipment.weapon.range).toBe(1.5);
    /* 'melee' was never one of the four Combat Positioning options
       (hold/standard/kite/flank) — it fell through to the same weight as
       'standard', so this pins the valid value with identical behaviour. */
    expect(owl.aiPrefs.movementStyle).toBe('standard');

    const imp = createFamiliarCompanion('imp', 5);
    expect(imp.name).toBe('Imp Familiar');
    expect(imp.classKey).toBe('familiar');
    expect(imp.knownSpells).toEqual([]);
    expect(imp.visual.spriteSheet).toBe('sprites/imp.png');
    expect(imp.equipment.weapon.name).toBe('Sting');
    expect(imp.equipment.weapon.melee).toBe(true);
    expect(imp.equipment.weapon.range).toBe(1.5);
    expect(imp.equipment.weapon.dmgType).toBe('fire');

    const viper = createFamiliarCompanion('viper', 2);
    expect(viper.name).toBe('Viper Familiar');
    expect(viper.classKey).toBe('familiar');
    expect(viper.knownSpells).toEqual([]);
    expect(viper.visual.spriteSheet).toBe('sprites/viper.png');
    expect(viper.equipment.weapon.name).toBe('Venom Bite');
    expect(viper.equipment.weapon.melee).toBe(true);
    expect(viper.equipment.weapon.range).toBe(1.5);
    expect(viper.equipment.weapon.dmgType).toBe('poison');
  });

  it('should register owlFamiliar, impFamiliar, and viperFamiliar in COMPANIONS registry', () => {
    expect(COMPANIONS.owlFamiliar).toBeDefined();
    expect(COMPANIONS.impFamiliar).toBeDefined();
    expect(COMPANIONS.viperFamiliar).toBeDefined();
    expect(COMPANIONS.owlFamiliar.icon).toBe('🦉');
    expect(COMPANIONS.impFamiliar.icon).toBe('👿');
    expect(COMPANIONS.viperFamiliar.icon).toBe('🐍');
  });

  it('should spawn selected familiar when casting Find Familiar', () => {
    const mockGame = {
      markSpellUsed: vi.fn(),
      playAbilityFx: vi.fn(),
      fxLog: vi.fn(),
      summons: {
        spawn: vi.fn().mockReturnValue({ data: { name: 'Owl Familiar' } })
      }
    };

    const wizard = { x: 0, z: 0, data: { name: 'Gandalf', classKey: 'wizard' } };

    SPELLS.findFamiliar.cast(mockGame, wizard, null, [], 1, null, 'owlFamiliar');

    expect(mockGame.summons.spawn).toHaveBeenCalledWith(wizard, 'owlFamiliar');
    expect(mockGame.fxLog).toHaveBeenCalledWith(expect.stringContaining('Owl 🦉'), 'buff');
  });

  it('should honor familiarChoice on hero data when casting without explicit choice', () => {
    const mockGame = {
      markSpellUsed: vi.fn(),
      playAbilityFx: vi.fn(),
      fxLog: vi.fn(),
      summons: {
        spawn: vi.fn().mockReturnValue({ data: { name: 'Imp Familiar' } })
      }
    };

    const warlock = { x: 0, z: 0, data: { name: 'Malakor', classKey: 'warlock', familiarChoice: 'impFamiliar' } };

    SPELLS.findFamiliar.cast(mockGame, warlock, null, [], 1, null, null);

    expect(mockGame.summons.spawn).toHaveBeenCalledWith(warlock, 'impFamiliar');
    expect(mockGame.fxLog).toHaveBeenCalledWith(expect.stringContaining('Imp 👿'), 'buff');
  });

  it('should prevent casting Find Familiar if familiar is already active', () => {
    const warlock = { x: 0, z: 0, data: { name: 'Malakor', classKey: 'warlock' } };
    const activeFamiliar = {
      companion: true,
      kind: 'impFamiliar',
      summonerName: 'Malakor',
      summonerClassKey: 'warlock',
      data: { name: 'Imp Familiar', hp: 15, maxHp: 15 }
    };

    const mockGame = {
      heroes: [warlock, activeFamiliar],
      markSpellUsed: vi.fn(),
      playAbilityFx: vi.fn(),
      fxLog: vi.fn(),
      summons: {
        spawn: vi.fn()
      }
    };

    const result = SPELLS.findFamiliar.cast(mockGame, warlock, null, [], 1, null, null);

    expect(result).toBe(false);
    expect(mockGame.markSpellUsed).not.toHaveBeenCalled();
    expect(mockGame.summons.spawn).not.toHaveBeenCalled();
    expect(mockGame.fxLog).toHaveBeenCalledWith(expect.stringContaining('already has an active familiar'), 'sys');
  });

  it('should allow casting Find Familiar again once previous familiar is defeated or gone', () => {
    const warlock = { x: 0, z: 0, data: { name: 'Malakor', classKey: 'warlock' } };
    const deadFamiliar = {
      companion: true,
      kind: 'impFamiliar',
      summonerName: 'Malakor',
      summonerClassKey: 'warlock',
      data: { name: 'Imp Familiar', hp: 0, maxHp: 15 }
    };

    const mockGame = {
      heroes: [warlock, deadFamiliar],
      markSpellUsed: vi.fn(),
      playAbilityFx: vi.fn(),
      fxLog: vi.fn(),
      summons: {
        spawn: vi.fn().mockReturnValue({ data: { name: 'Imp Familiar', hp: 15 } })
      }
    };

    const result = SPELLS.findFamiliar.cast(mockGame, warlock, null, [], 1, null, 'impFamiliar');

    expect(result).toBe(true);
    expect(mockGame.markSpellUsed).toHaveBeenCalled();
    expect(mockGame.summons.spawn).toHaveBeenCalledWith(warlock, 'impFamiliar');
  });
});
