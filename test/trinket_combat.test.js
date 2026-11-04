import { describe, it, expect, vi } from 'vitest';
import Game from '../src/game/combat.js';
import { SPELLS } from '../src/game/spells.js';
import { makeHero } from '../src/game/srd.js';
import { hasEffect } from '../src/game/conditions.js';

function mockGame(overrides = {}) {
  const game = {
    fxNow: 0,
    heroes: [],
    monsters: [],
    fxLog: vi.fn(),
    playAbilityFx: vi.fn(),
    refreshHud: vi.fn(),
    refreshAbilityHud: vi.fn(),
    fxUpdateInitTracker: vi.fn(),
    fxUpdateManualBar: vi.fn(),
    _combatRound: () => 999,
    monsterEliteRoom: () => false,
    ...overrides
  };
  return game;
}

describe('Trinket scrolls & potions in combat', () => {
  it('a scroll-only spell joins the AI cast pool via the trinket slot', () => {
    const hero = { data: makeHero('Sariel', 'human', 'wizard', { str: 8, dex: 15, con: 12, int: 15, wis: 13, cha: 10 }) };
    hero.data.knownSpells = [];
    hero.data.aiPrefs.abilityUsage = 'unleash'; // cast scrolls freely — no conservation gate
    hero.data.equipment.trinket = { name: 'Scroll of Fireball', slot: 'trinket', scroll: true, spellKey: 'fireball', charges: 2 };

    const m1 = { x: 0, z: 0, data: { hp: 50, maxHp: 50 }, isBoss: false, active: true };
    const m2 = { x: 1, z: 1, data: { hp: 40, maxHp: 40 }, isBoss: false, active: true };
    const game = mockGame({ monsters: [m1, m2], getAbilityUseWeight: () => 1 });
    game._pickKnownSpell = Game._pickKnownSpell.bind(game);
    game._scoreSpellForTarget = Game._scoreSpellForTarget.bind(game);
    game.canUseSpellRecharge = Game.canUseSpellRecharge.bind(game);
    game._equippedScroll = Game._equippedScroll.bind(game);
    game._equippedPotion = Game._equippedPotion.bind(game);
    game._scorePotion = Game._scorePotion.bind(game);
    game._combatStable = Game._combatStable.bind(game);
    game.aoeRadiusOf = Game.aoeRadiusOf.bind(game);

    const pick = game._pickKnownSpell(hero, m1, [], sp => sp.bonusAction !== true);
    expect(pick).toMatchObject({ key: 'fireball', viaScroll: true, potion: null });
  });

  it('a known spell is NOT marked as a scroll cast', () => {
    const hero = { data: makeHero('Sariel', 'human', 'wizard', { str: 8, dex: 15, con: 12, int: 15, wis: 13, cha: 10 }) };
    hero.data.knownSpells = ['fireball'];
    hero.data.aiPrefs.abilityUsage = 'unleash'; // cast spells freely — no conservation gate
    hero.data.equipment.trinket = { name: 'Scroll of Fireball', slot: 'trinket', scroll: true, spellKey: 'fireball', charges: 2 };

    const m1 = { x: 0, z: 0, data: { hp: 50, maxHp: 50 }, isBoss: false, active: true };
    const m2 = { x: 1, z: 1, data: { hp: 40, maxHp: 40 }, isBoss: false, active: true };
    const game = mockGame({ monsters: [m1, m2], getAbilityUseWeight: () => 1 });
    game._pickKnownSpell = Game._pickKnownSpell.bind(game);
    game._scoreSpellForTarget = Game._scoreSpellForTarget.bind(game);
    game.canUseSpellRecharge = Game.canUseSpellRecharge.bind(game);
    game._equippedScroll = Game._equippedScroll.bind(game);
    game._equippedPotion = Game._equippedPotion.bind(game);
    game._scorePotion = Game._scorePotion.bind(game);
    game._combatStable = Game._combatStable.bind(game);
    game.aoeRadiusOf = Game.aoeRadiusOf.bind(game);

    const pick = game._pickKnownSpell(hero, m1, [], sp => sp.bonusAction !== true);
    expect(pick.viaScroll).toBe(false);
    expect(pick.key).toBe('fireball');
  });

  it('an equipped potion is offered as a bonus-action trinket use', () => {
    const hero = { data: makeHero('Aldric', 'human', 'fighter', { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 }) };
    hero.data.knownSpells = [];
    hero.data.equipment.trinket = { name: 'Potion of Hill Giant Strength', slot: 'trinket', potion: true, buffKey: 'giantStrength', buffDuration: 60, charges: 1, rarity: 'rare' };

    const game = mockGame({
      monsters: [{ x: 0, z: 0, data: { hp: 50, maxHp: 50 }, active: true }],
      getAbilityUseWeight: () => 1
    });
    game._pickKnownSpell = Game._pickKnownSpell.bind(game);
    game._scoreSpellForTarget = Game._scoreSpellForTarget.bind(game);
    game.canUseSpellRecharge = Game.canUseSpellRecharge.bind(game);
    game._equippedScroll = Game._equippedScroll.bind(game);
    game._equippedPotion = Game._equippedPotion.bind(game);
    game._scorePotion = Game._scorePotion.bind(game);
    game._combatStable = Game._combatStable.bind(game);
    game.aoeRadiusOf = Game.aoeRadiusOf.bind(game);
    game._worthSpending = () => true;

    const pick = game._pickKnownSpell(hero, null, [{ data: { hp: 40, maxHp: 40 } }], sp => sp.bonusAction === true);
    expect(pick.potion).toBeTruthy();
  });

  it('the potion is NOT offered on the action pass', () => {
    const hero = { data: makeHero('Aldric', 'human', 'fighter', { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 }) };
    hero.data.knownSpells = [];
    hero.data.equipment.trinket = { name: 'Potion of Hill Giant Strength', slot: 'trinket', potion: true, buffKey: 'giantStrength', buffDuration: 60, charges: 1, rarity: 'rare' };

    const game = mockGame({
      monsters: [{ x: 0, z: 0, data: { hp: 50, maxHp: 50 }, active: true }],
      getAbilityUseWeight: () => 1
    });
    game._pickKnownSpell = Game._pickKnownSpell.bind(game);
    game._scoreSpellForTarget = Game._scoreSpellForTarget.bind(game);
    game.canUseSpellRecharge = Game.canUseSpellRecharge.bind(game);
    game._equippedScroll = Game._equippedScroll.bind(game);
    game._equippedPotion = Game._equippedPotion.bind(game);
    game._scorePotion = Game._scorePotion.bind(game);
    game._combatStable = Game._combatStable.bind(game);
    game.aoeRadiusOf = Game.aoeRadiusOf.bind(game);
    game._worthSpending = () => true;

    const pick = game._pickKnownSpell(hero, null, [{ data: { hp: 40, maxHp: 40 } }], sp => sp.bonusAction !== true);
    expect(pick).toBeNull();
  });

  it('markSpellUsed consumes a scroll charge and destroys the scroll at 0', () => {
    const hero = { data: makeHero('Sariel', 'human', 'wizard', { str: 8, dex: 15, con: 12, int: 15, wis: 13, cha: 10 }) };
    hero.data.equipment.trinket = { name: 'Scroll of Magic Missile', slot: 'trinket', scroll: true, spellKey: 'magicMissile', charges: 1 };
    const game = mockGame();
    game.markSpellUsed = Game.markSpellUsed.bind(game);
    game.spendSlot = vi.fn();
    game._consumeScrollFor = Game._consumeScrollFor.bind(game);
    game._reloadTrinketFromBag = Game._reloadTrinketFromBag.bind(game);
    game._equippedScroll = Game._equippedScroll.bind(game);
    game._equippedPotion = Game._equippedPotion.bind(game);

    hero._scrollCastKey = 'magicMissile'; // cast came from the scroll
    game.markSpellUsed(hero, SPELLS.magicMissile);
    expect(hero.data.equipment.trinket).toBeUndefined();
    expect(game.fxLog).toHaveBeenCalledWith(expect.stringContaining('crumbles to dust'), 'sys');
    expect(game.spendSlot).not.toHaveBeenCalled();
  });

  it('markSpellUsed decrements charges without destroying until zero', () => {
    const hero = { data: makeHero('Sariel', 'human', 'wizard', { str: 8, dex: 15, con: 12, int: 15, wis: 13, cha: 10 }) };
    hero.data.equipment.trinket = { name: 'Scroll of Magic Missile', slot: 'trinket', scroll: true, spellKey: 'magicMissile', charges: 2 };
    const game = mockGame();
    game.markSpellUsed = Game.markSpellUsed.bind(game);
    game.spendSlot = vi.fn();
    game._consumeScrollFor = Game._consumeScrollFor.bind(game);
    game._reloadTrinketFromBag = Game._reloadTrinketFromBag.bind(game);
    game._equippedScroll = Game._equippedScroll.bind(game);
    game._equippedPotion = Game._equippedPotion.bind(game);

    hero._scrollCastKey = 'magicMissile';
    game.markSpellUsed(hero, SPELLS.magicMissile);
    expect(hero.data.equipment.trinket.charges).toBe(1);
    expect(hero.data.equipment.trinket).toBeDefined();
  });

  it('markSpellUsed falls back to the scroll when a known spell is out of slots', () => {
    const hero = { data: makeHero('Sariel', 'human', 'wizard', { str: 8, dex: 15, con: 12, int: 15, wis: 13, cha: 10 }) };
    hero.data.knownSpells = ['magicMissile'];
    hero.data.slots = {}; // all spent
    hero.data.equipment.trinket = { name: 'Scroll of Magic Missile', slot: 'trinket', scroll: true, spellKey: 'magicMissile', charges: 1 };
    const game = mockGame();
    game.markSpellUsed = Game.markSpellUsed.bind(game);
    game.spendSlot = () => false;
    game._consumeScrollFor = Game._consumeScrollFor.bind(game);
    game._reloadTrinketFromBag = Game._reloadTrinketFromBag.bind(game);
    game._equippedScroll = Game._equippedScroll.bind(game);
    game._equippedPotion = Game._equippedPotion.bind(game);

    game.markSpellUsed(hero, SPELLS.magicMissile);
    expect(hero.data.equipment.trinket).toBeUndefined();
  });

  it('a scroll provides the spell power even without an available slot', () => {
    const hero = { data: makeHero('Sariel', 'human', 'wizard', { str: 8, dex: 15, con: 12, int: 15, wis: 13, cha: 10 }) };
    hero.data.slots = {}; // no slots
    hero.data.equipment.trinket = { name: 'Scroll of Magic Missile', slot: 'trinket', scroll: true, spellKey: 'magicMissile', charges: 1 };
    const game = mockGame();
    game.canUseSpellRecharge = Game.canUseSpellRecharge.bind(game);
    game._equippedScroll = Game._equippedScroll.bind(game);
    game._equippedPotion = Game._equippedPotion.bind(game);

    expect(game.canUseSpellRecharge(hero, SPELLS.magicMissile)).toBe(true);
  });

  it('_usePotion applies the buff and consumes the charge', () => {
    const hero = { data: makeHero('Aldric', 'human', 'fighter', { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 }) };
    hero.data.equipment.trinket = { name: 'Potion of Hill Giant Strength', slot: 'trinket', potion: true, buffKey: 'giantStrength', buffDuration: 60, charges: 1 };
    const game = mockGame();
    game._usePotion = Game._usePotion.bind(game);
    game._reloadTrinketFromBag = Game._reloadTrinketFromBag.bind(game);

    const ok = game._usePotion(hero, hero.data.equipment.trinket);
    expect(ok).toBe(true);
    expect(hero.data.equipment.trinket).toBeUndefined();
    expect(hasEffect(hero, 'giantStrength')).toBe(true);
  });
});
