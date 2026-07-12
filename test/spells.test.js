import { describe, it, expect } from 'vitest';
import { SPELLS, SPELL_POOLS } from '../src/game/spells.js';

describe('Spells Registry', () => {
  it('should export a valid SPELLS registry', () => {
    expect(SPELLS).toBeDefined();
    expect(typeof SPELLS).toBe('object');
    
    // Check some iconic spells
    expect(SPELLS.magicMissile).toBeDefined();
    expect(SPELLS.magicMissile.level).toBe(1);
    expect(typeof SPELLS.magicMissile.cast).toBe('function');

    expect(SPELLS.shield).toBeDefined();
    expect(SPELLS.shield.level).toBe(1);
    expect(typeof SPELLS.shield.cast).toBe('function');

    expect(SPELLS.scorchingRay).toBeDefined();
    expect(SPELLS.scorchingRay.level).toBe(2);

    expect(SPELLS.holdMonster).toBeDefined();
    expect(SPELLS.holdMonster.level).toBe(5);
    expect(SPELLS.holdMonster.concentration).toBe(true);
  });

  it('should export valid SPELL_POOLS for each caster class', () => {
    expect(SPELL_POOLS).toBeDefined();
    expect(typeof SPELL_POOLS).toBe('object');
    
    // Caster classes check
    const classes = ['wizard', 'cleric', 'druid', 'bard', 'sorcerer', 'warlock', 'paladin', 'ranger'];
    for (const cls of classes) {
      expect(SPELL_POOLS[cls]).toBeDefined();
      // Verify pool contains arrays of valid spell keys
      for (const tier in SPELL_POOLS[cls]) {
        const pool = SPELL_POOLS[cls][tier];
        expect(Array.isArray(pool)).toBe(true);
        for (const spellKey of pool) {
          expect(SPELLS[spellKey]).toBeDefined();
        }
      }
    }
  });
});
