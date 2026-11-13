import { describe, it, expect } from 'vitest';
import { makeHero, recalc, weaponSwingCap, isSmallRace, versatileDie } from '../src/game/srd.js';
import { rollItem, weaponTags } from '../src/game/items.js';
import { heroAttackEv } from '../src/game/combat_eval.js';
import { mulberry32 } from '../src/game/quests.js';
import { baseChassisCost } from '../src/game/budget.js';
import { getBase } from '../src/game/items.js';

/* The 5e weapon properties `versatile`, `loading` and `heavy` used to be
   cosmetic tags: they sat on the item, printed in the tooltip, and nothing in
   combat read them. These pin the rules they now carry. */

const weapon = (baseKey) => rollItem(1, mulberry32(1), 'weapon', { baseKey, forceRarity: 'common' });
const shield = () => rollItem(1, mulberry32(2), 'shield', { forceRarity: 'common' });

function armed(raceKey, mainHand, offHand = null) {
  const h = makeHero('T', raceKey, 'fighter', { str: 16, dex: 14, con: 14 });
  h.equipment = { ...(h.equipment || {}), weapon: mainHand, offhand: offHand };
  recalc(h);
  return h;
}

describe('versatile', () => {
  it('steps the die up with an empty off-hand', () => {
    const h = armed('human', weapon('Longsword'));
    expect(h.weaponProfile.dmg).toEqual([1, 10]);
    expect(h.weaponProfile.twoHandGrip).toBe(true);
  });

  it('keeps the one-handed die when a shield is carried', () => {
    const h = armed('human', weapon('Longsword'), shield());
    expect(h.weaponProfile.dmg).toEqual([1, 8]);
  });

  it('never applies to a weapon that is already two-handed (staves)', () => {
    const h = armed('human', weapon('Staff'));
    expect(h.weaponProfile.dmg).toEqual([1, 6]);
  });

  it('caps at d12', () => {
    expect(versatileDie([1, 12])).toEqual([1, 12]);
    expect(versatileDie([1, 10])).toEqual([1, 12]);
  });

  it('is priced: a versatile d8 costs more than a plain d8, staves do not', () => {
    const cost = (n) => baseChassisCost('weapon', getBase('weapon', n));
    expect(cost('Longsword')).toBeGreaterThan(cost('Falchion'));
    expect(cost('Longsword')).toBeLessThan(cost('Falchion') + 12);   // a share of the step, not all of it
    const staff = getBase('weapon', 'Staff');                        // 2H + versatile: never gets the step
    expect(cost('Staff')).toBe(baseChassisCost('weapon', { ...staff, versatile: false }));
  });

  it('shows the two-handed die in the tooltip tag', () => {
    expect(weaponTags(weapon('Longsword'))).toContain('versatile (1d10 two-handed)');
  });
});

describe('loading', () => {
  it('caps a crossbow at one shot even with Extra Attack', () => {
    const h = armed('human', weapon('Light Crossbow'));
    expect(weaponSwingCap(h, h.weaponProfile, 2)).toBe(1);
  });

  it('Crossbow Expert ignores loading', () => {
    const h = armed('human', weapon('Light Crossbow'));
    h.feats = [...(h.feats || []), 'crossbowExpert'];
    expect(weaponSwingCap(h, h.weaponProfile, 2)).toBe(2);
  });

  it('leaves bows alone', () => {
    const h = armed('human', weapon('Longbow'));
    expect(weaponSwingCap(h, h.weaponProfile, 2)).toBe(2);
  });
});

describe('heavy', () => {
  it('only halflings and gnomes count as Small', () => {
    expect(isSmallRace('halfling')).toBe(true);
    expect(isSmallRace('gnome')).toBe(true);
    expect(isSmallRace('dwarf')).toBe(false);
    expect(isSmallRace('human')).toBe(false);
  });

  it('a Small hero expects less from a heavy weapon than a Medium one', () => {
    const foe = { data: { ac: 15, hp: 50, maxHp: 50 } };
    const human = armed('human', weapon('Greataxe'));
    const halfling = armed('halfling', weapon('Greataxe'));
    halfling.effStats = { ...human.effStats };       // same numbers, only size differs
    halfling.atkProf = human.atkProf;
    const ev = (d) => heroAttackEv({ data: d }, d.weaponProfile, foe, null);
    expect(ev(halfling)).toBeLessThan(ev(human));
  });
});
