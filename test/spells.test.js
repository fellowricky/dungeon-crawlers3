import { describe, it, expect } from 'vitest';
import { SPELLS, SPELL_POOLS } from '../src/game/spells.js';
import { combatMethods } from '../src/game/combat.js';

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
          expect(SPELLS[spellKey].level).toBeGreaterThanOrEqual(1);
          expect(SPELLS[spellKey].cantrip).toBeFalsy();
        }
      }
    }
  });

  it('should support dynamic target selection and metadata for multi-projectile spells', () => {
    expect(SPELLS.magicMissile.ai.targetType).toBe('execute');
    expect(SPELLS.fireball.ai.aoeRadius).toBe(4.0);
    expect(SPELLS.fireball.ai.minTargets).toBe(2);
    expect(SPELLS.scorchingRay.ai.targetType).toBe('singleBurst');
  });

  it('should conserve spell slots based on the Ability & Spell Budget directive', () => {
    const fakeHero = {
      data: {
        name: 'Gandalff',
        hp: 30, maxHp: 30, level: 7,
        knownSpells: ['magicMissile', 'fireball'],
        slots: { 1: 4, 2: 3, 3: 2 },
        aiPrefs: { abilityUsage: 'balanced' }
      }
    };
    const fakeFoe = { x: 5, z: 5, data: { hp: 20, maxHp: 20 } };
    const fakeContext = {
      _scoreSpellForTarget: () => 10,
      monsterEliteRoom: () => false,
      canUseSpellRecharge: () => true,
      _equippedScroll: () => null,
      _equippedPotion: () => null
    };

    /* Conservative (weight 0): no limited-resource spell should ever be picked. */
    fakeHero.data.aiPrefs.abilityUsage = 'conservative';
    const zeroPick = combatMethods._pickKnownSpell.call(fakeContext, fakeHero, fakeFoe, [fakeHero], () => true);
    expect(zeroPick).toBeNull();

    /* Balanced (weight 0.5): non-emergency slot spells are gated by a coin flip
       against the weight, so roughly half of the attempts should conserve. */
    fakeHero.data.aiPrefs.abilityUsage = 'balanced';
    let castCount = 0;
    for (let i = 0; i < 1000; i++) {
      const pick = combatMethods._pickKnownSpell.call(fakeContext, fakeHero, fakeFoe, [fakeHero], () => true);
      if (pick) castCount++;
    }
    // Expected ~500 casts out of 1000 trials (allow reasonable variance)
    expect(castCount).toBeGreaterThanOrEqual(400);
    expect(castCount).toBeLessThanOrEqual(600);

    // Unleash (weight 1): limited resource spells are cast freely 100% of the time
    fakeHero.data.aiPrefs.abilityUsage = 'unleash';
    const fullPick = combatMethods._pickKnownSpell.call(fakeContext, fakeHero, fakeFoe, [fakeHero], () => true);
    expect(fullPick.key).toBe('magicMissile');
    expect(fullPick.viaScroll).toBe(false);
  });
});

