import { describe, it, expect } from 'vitest';
import { resetChallengeState } from '../src/game/skills.js';
import { partyLongRest } from '../src/game/rest.js';
import { applyEffect } from '../src/game/conditions.js';

describe('Merchant & Camp Boon Persistence Across Floor Change', () => {
  it('preserves floorBuffs and skill-tagged hero effects across floor transitions', () => {
    const hero = {
      data: { hp: 20, maxHp: 20, level: 1, classKey: 'fighter', abilityUsed: {} },
      _effects: {},
      _effectCache: null
    };

    const game = {
      heroes: [hero],
      dungeonLevel: 1,
      _floorBuffs: [{ type: 'merchantDiscount', source: 'camp' }],
      _floorDebuffs: []
    };

    // Grant a combat boon with tag: 'skill'
    applyEffect(hero, 'shielded', { duration: 25, tag: 'skill' });
    expect(hero._effects.shielded).toBeDefined();

    // 1. Long rest at floor clear
    partyLongRest(game, { reason: 'floor cleared' });
    expect(game._floorBuffs.length).toBe(1);
    expect(hero._effects.shielded).toBeDefined();

    // 2. Floor transition reset (resetChallengeState with default opts / newQuest: false)
    resetChallengeState(game, { newQuest: false });

    // Merchant boon and skill-tagged effect survive the floor change
    expect(game._floorBuffs.length).toBe(1);
    expect(game._floorBuffs[0].type).toBe('merchantDiscount');
    expect(hero._effects.shielded).toBeDefined();
  });

  it('resets floorBuffs and skill-tagged hero effects when embarking on a new quest', () => {
    const hero = {
      data: { hp: 20, maxHp: 20, level: 1, classKey: 'fighter', abilityUsed: {} },
      _effects: {},
      _effectCache: null
    };

    const game = {
      heroes: [hero],
      dungeonLevel: 1,
      _floorBuffs: [{ type: 'merchantDiscount', source: 'camp' }],
      _floorDebuffs: []
    };

    applyEffect(hero, 'shielded', { duration: 25, tag: 'skill' });
    expect(hero._effects.shielded).toBeDefined();

    // Reset state for a new quest
    resetChallengeState(game, { newQuest: true });

    // Boons reset for a new quest
    expect(game._floorBuffs.length).toBe(0);
    expect(hero._effects.shielded).toBeUndefined();
  });
});
