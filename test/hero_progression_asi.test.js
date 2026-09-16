import { describe, it, expect } from 'vitest';
import { makeHero, spendAbilityPoint } from '../src/game/srd.js';
import { applyLevelGrants, resolveChoice } from '../src/game/features.js';

/* An Ability Score Improvement is +2 to one score or +1 to two (SRD 5.1).
 * It is modelled by banking 2 points that spendAbilityPoint applies one at a
 * time, so both splits work without a separate UI. This granted 1 — half an
 * ASI — while the comment beside it already said it should bank 2. */
describe('Ability Score Improvement Points', () => {
  const fighter = () => {
    const hero = makeHero('Valeros', 'human', 'fighter',
      { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, {});
    hero.level = 4;
    applyLevelGrants(hero, 4, null, { autosOnly: false });
    return hero;
  };
  const takeAsi = (hero) => {
    const choice = hero.pendingChoices.find(c => c.pick === 'asiOrFeat');
    expect(choice).toBeDefined();
    const res = resolveChoice(hero, choice.id, 'asi');
    expect(res.ok).toBe(true);
    return choice;
  };

  it('offers an ASI worth 2 ability points at level 4', () => {
    const hero = fighter();
    const choice = hero.pendingChoices.find(c => c.pick === 'asiOrFeat');
    const asi = choice.options.find(o => o.kind === 'asi');

    expect(asi).toBeDefined();
    expect(asi.amount).toBe(2);
    expect(asi.desc).toContain('2 ability points');
  });

  it('banks 2 points when the ASI is taken', () => {
    const hero = fighter();
    takeAsi(hero);
    expect(hero.pendingAbility).toBe(2);
  });

  it('spends both on one score: +2 to a single ability', () => {
    const hero = fighter();
    takeAsi(hero);
    const before = hero.stats.str;               // 16 base + 1 human bonus

    expect(spendAbilityPoint(hero, 'str')).toBe(true);
    expect(spendAbilityPoint(hero, 'str')).toBe(true);

    expect(hero.stats.str).toBe(before + 2);
    expect(hero.pendingAbility).toBe(0);
    // Nothing left to spend.
    expect(spendAbilityPoint(hero, 'str')).toBe(false);
  });

  it('splits the pair: +1 to each of two abilities', () => {
    const hero = fighter();
    takeAsi(hero);
    const str = hero.stats.str, con = hero.stats.con;

    expect(spendAbilityPoint(hero, 'str')).toBe(true);
    expect(spendAbilityPoint(hero, 'con')).toBe(true);

    expect(hero.stats.str).toBe(str + 1);
    expect(hero.stats.con).toBe(con + 1);
    expect(hero.pendingAbility).toBe(0);
  });

  it('still refuses to push a score past the cap of 20', () => {
    const hero = fighter();
    takeAsi(hero);
    hero.stats.str = 19;

    expect(spendAbilityPoint(hero, 'str')).toBe(true);
    expect(hero.stats.str).toBe(20);
    // The second banked point cannot go here — it has to go elsewhere.
    expect(spendAbilityPoint(hero, 'str')).toBe(false);
    expect(hero.pendingAbility).toBe(1);
    expect(spendAbilityPoint(hero, 'dex')).toBe(true);
    expect(hero.pendingAbility).toBe(0);
  });
});
