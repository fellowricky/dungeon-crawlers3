import { describe, it, expect } from 'vitest';
import { getSparkEffectForDamageType } from '../src/game/entities.js';

describe('Damage Type Elemental Spark VFX', () => {
  it('maps physical and elemental damage types to their dedicated particle spark effects', () => {
    // Physical types
    expect(getSparkEffectForDamageType('slashing')).toBe('hit_sparks');
    expect(getSparkEffectForDamageType('piercing')).toBe('pierce_sparks');
    expect(getSparkEffectForDamageType('bludgeoning')).toBe('blunt_impact');
    expect(getSparkEffectForDamageType('slashing_magical')).toBe('hit_sparks');
    expect(getSparkEffectForDamageType('piercing_magical')).toBe('pierce_sparks');
    expect(getSparkEffectForDamageType('bludgeoning_magical')).toBe('blunt_impact');

    // Elemental types
    expect(getSparkEffectForDamageType('fire')).toBe('fire_sparks');
    expect(getSparkEffectForDamageType('cold')).toBe('frost_sparks');
    expect(getSparkEffectForDamageType('frost')).toBe('frost_sparks');
    expect(getSparkEffectForDamageType('acid')).toBe('acid_sparks');
    expect(getSparkEffectForDamageType('poison')).toBe('poison_sparks');
    expect(getSparkEffectForDamageType('lightning')).toBe('lightning_sparks');
    expect(getSparkEffectForDamageType('radiant')).toBe('holy_sparks');
    expect(getSparkEffectForDamageType('holy')).toBe('holy_sparks');
    expect(getSparkEffectForDamageType('necrotic')).toBe('dark_sparks');
    expect(getSparkEffectForDamageType('dark')).toBe('dark_sparks');
    expect(getSparkEffectForDamageType('force')).toBe('force_sparks');
    expect(getSparkEffectForDamageType('psychic')).toBe('psychic_sparks');
    expect(getSparkEffectForDamageType('thunder')).toBe('lightning_sparks');

    // Fallback
    expect(getSparkEffectForDamageType(null)).toBe('hit_sparks');
    expect(getSparkEffectForDamageType(undefined)).toBe('hit_sparks');
    expect(getSparkEffectForDamageType('unknown_type')).toBe('hit_sparks');
  });
});
