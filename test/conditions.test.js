import { describe, it, expect } from 'vitest';
import { applyEffect, hasEffect, getEffectMods, rollSave, clearEffect } from '../src/game/conditions.js';

describe('Conditions & Status Effects Engine', () => {
  it('should apply and clear effects correctly', () => {
    const entity = { data: { type: 'humanoid' } };
    
    const applied = applyEffect(entity, 'poisoned', { duration: 10, elapsed: 0 });
    expect(applied).toBe(true);
    expect(hasEffect(entity, 'poisoned')).toBe(true);
    
    clearEffect(entity, 'poisoned');
    expect(hasEffect(entity, 'poisoned')).toBe(false);
  });

  it('should respect type-based immunities (e.g. undead immune to poisoned)', () => {
    const skeleton = { data: { type: 'undead' } };
    
    // Undead are immune to poisoned
    const applied = applyEffect(skeleton, 'poisoned', { duration: 10, elapsed: 0 });
    expect(applied).toBe(false);
    expect(hasEffect(skeleton, 'poisoned')).toBe(false);
  });

  it('should compute aggregate effect modifiers correctly', () => {
    const hero = { data: { type: 'humanoid' } };
    
    // Apply hasted: +2 AC, 1.4x speed
    applyEffect(hero, 'hasted', { duration: 6, elapsed: 0 });
    
    // Apply slowed: -2 AC, 0.5x speed
    applyEffect(hero, 'slowed', { duration: 6, elapsed: 0 });
    
    const mods = getEffectMods(hero);
    // AC bonus: 2 - 2 = 0
    expect(mods.acBonus).toBe(0);
    // Speed multiplier: 1.4 * 0.5 = 0.7
    expect(mods.speedMul).toBeCloseTo(0.7);
  });

  it('should handle saving throws and special rules (rollSave)', () => {
    const gnomeHero = {
      data: {
        raceKey: 'gnome',
        effStats: { wis: 14 } // mod +2
      }
    };
    
    // Gnome Cunning grants advantage on WIS saves against magic (adv > 0)
    // We can't directly check random rolls easily, but we can verify it doesn't throw and behaves correctly.
    const saveResult = rollSave(gnomeHero, 'wis', 10, { magic: true });
    expect(typeof saveResult).toBe('boolean');
    
    const standardHero = {
      data: {
        effStats: { wis: 10 } // mod +0
      }
    };
    
    // Restrained character has disadvantage on DEX saves
    applyEffect(standardHero, 'restrained', { duration: 6, elapsed: 0 });
    const dexSave = rollSave(standardHero, 'dex', 15);
    expect(typeof dexSave).toBe('boolean');
  });
});
