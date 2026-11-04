import { describe, it, expect } from 'vitest';
import { combatMethods } from '../src/game/combat.js';

/* Nothing acts before initiative is rolled. The hole this closes: on the frame
   a monster wakes, updateInitiative has already run (it only counts monsters
   that were active before it), so `initiative.active` is still false. The old
   hero gate — `active && !isCurrentActor` — passed, and a hero got a free
   swing or spell before anyone rolled. */
function world({ active, heroTurn = false }) {
  const hero = { x: 0, z: 0, data: { name: 'Hero', classKey: 'fighter', hp: 10, maxHp: 10 } };
  const foe = { x: 1, z: 0, data: { name: 'Kobold', hp: 5, maxHp: 5 } };
  const game = {
    initiative: { active },
    isCurrentActor: e => active && heroTurn && e === hero,
    getAbilityUseWeight: () => 1,
    getCombatMovementWeight: () => 1,
    controlMode: 'auto',
    fxNow: 5      // so a stamp past the gate is visible (undefined would hide it)
  };
  return { game, hero, foe };
}

describe('initiative gate', () => {
  it('a hero with a foe in reach does nothing before initiative is rolled', () => {
    const { game, hero, foe } = world({ active: false });
    combatMethods.heroCombat.call(game, hero, foe, [hero], 1 / 60);
    /* the first thing past the gate stamps the engagement clock */
    expect(game._combatEngagedAt).toBeUndefined();
  });

  it('nor off its own turn once initiative is running', () => {
    const { game, hero, foe } = world({ active: true, heroTurn: false });
    combatMethods.heroCombat.call(game, hero, foe, [hero], 1 / 60);
    expect(game._combatEngagedAt).toBeUndefined();
  });

  it('a charmed hero is held by the same gate', () => {
    const { game, hero } = world({ active: false });
    expect(() => combatMethods.charmedHeroUpdate.call(game, hero, [hero], 1 / 60)).not.toThrow();
    expect(hero.moving).toBeUndefined();
  });
});
