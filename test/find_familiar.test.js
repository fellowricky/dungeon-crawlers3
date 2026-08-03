import { describe, it, expect, vi } from 'vitest';
import { createFamiliarCompanion } from '../src/game/srd.js';
import { COMPANIONS } from '../src/game/summons.js';
import { SPELLS } from '../src/game/spells.js';

describe('Find Familiar Companion System', () => {
  it('should generate valid familiar data records for Owl, Imp, and Viper', () => {
    const owl = createFamiliarCompanion('owl', 3);
    expect(owl.name).toBe('Owl Familiar');
    expect(owl.isFamiliar).toBe(true);
    expect(owl.equipment.weapon.name).toBe('Talon');

    const imp = createFamiliarCompanion('imp', 5);
    expect(imp.name).toBe('Imp Familiar');
    expect(imp.equipment.weapon.dmgType).toBe('fire');

    const viper = createFamiliarCompanion('viper', 2);
    expect(viper.name).toBe('Viper Familiar');
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
});
