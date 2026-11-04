import { describe, it, expect } from 'vitest';
import { combatMethods } from '../src/game/combat.js';
import { hasEffect, applyEffect } from '../src/game/conditions.js';

describe('Bardic Inspiration & Buff Spellcasting AI', () => {
  const createTestGame = () => {
    const game = {
      ...combatMethods,
      heroes: [],
      monsters: [],
      fxNow: 5.0,
      _combatStartFxTime: 0,
      playAbilityFx: () => {},
      fxLog: () => {},
      refreshAbilityHud: () => {},
      _combatStable: () => true,
      canUseSpellRecharge: () => true,
      getAbilityUseWeight: () => 1.0,
      monsterEliteRoom: () => false,
      _worthSpending: () => true,
      aoeRadiusOf: () => 2.5,
    };
    return game;
  };

  it('does not re-cast Bardic Inspiration if all allies already have the inspired buff', () => {
    const game = createTestGame();
    const bard = {
      x: 0, z: 0,
      data: {
        id: 'hero_bard',
        name: 'Lute Master',
        classKey: 'bard',
        hp: 20, maxHp: 30,
        features: ['bardicInspiration'],
        charges: { bardicInspiration: 3 }
      }
    };
    const ally = {
      x: 1, z: 0,
      data: {
        id: 'hero_fighter',
        name: 'Ironclad',
        classKey: 'fighter',
        hp: 15, maxHp: 40
      }
    };

    game.heroes = [bard, ally];

    // First cycle: everyone is uninspired and ally is hurt (<60% HP)
    bard._abilityUsedThisCycle = false;
    bard._bonusActed = false;
    game.runCombatReflexes(bard, [bard, ally], null);

    expect(bard.data.charges.bardicInspiration).toBe(2);
    /* 5e: ONE ally gets the die — never the bard themself */
    expect(hasEffect(bard, 'inspired')).toBe(false);
    expect(hasEffect(ally, 'inspired')).toBe(true);
    expect(ally._effects.inspired.die).toBe(6);   // a level-1 bard's d6

    // Next turn/cycle: the only ally is already inspired
    bard._abilityUsedThisCycle = false;
    bard._bonusActed = false;
    game.runCombatReflexes(bard, [bard, ally], null);

    // Should NOT spend another charge or cast again
    expect(bard.data.charges.bardicInspiration).toBe(2);
    expect(bard._abilityUsedThisCycle).toBe(false);
  });

  it('rejects casting redundant party buffs in _scoreSpellForTarget when everyone has the buff', () => {
    const game = createTestGame();
    const cleric = {
      x: 0, z: 0,
      data: {
        id: 'hero_cleric',
        name: 'Healer',
        classKey: 'cleric',
        hp: 30, maxHp: 30,
        slots: { 1: 3 },
        knownSpells: ['bless']
      }
    };
    const ally = {
      x: 1, z: 0,
      data: {
        id: 'hero_paladin',
        name: 'Knight',
        classKey: 'paladin',
        hp: 35, maxHp: 35
      }
    };
    const foe = {
      x: 2, z: 0,
      data: { hp: 50, maxHp: 50, type: 'humanoid' }
    };

    game.heroes = [cleric, ally];
    game.monsters = [foe];

    // Initially nobody is inspired, bless score should be positive
    const score1 = game._scoreSpellForTarget(cleric, 'bless', foe, [cleric, ally]);
    expect(score1).toBeGreaterThan(0);

    // Now everyone has the inspired buff
    applyEffect(cleric, 'inspired', { duration: 60, elapsed: 0 });
    applyEffect(ally, 'inspired', { duration: 60, elapsed: 0 });

    const score2 = game._scoreSpellForTarget(cleric, 'bless', foe, [cleric, ally]);
    expect(score2).toBe(-1);
  });
});
