import { describe, it, expect } from 'vitest';
import { makeHero, recalc } from '../src/game/srd.js';
import {
  seedNewHeroProgression, applyLevelGrants, resolveChoice, migrateProgression,
  hasFeature, hasMetamagic, sorceryPointsLeft, spendSorceryPoints, flexSlotLevelFor,
  createSlotFromPoints, convertSlotToPoints, FLEX_SLOT_COST, METAMAGIC
} from '../src/game/features.js';
import { applyShortRestToHero, applyLongRestToHero } from '../src/game/rest.js';
import { SPELLS } from '../src/game/spells.js';
import { isTwinnable, metamagicFits, metamagicCost, metamagicMethods } from '../src/game/metamagic.js';

function levelTo(h, target) {
  const drain = () => {
    let guard = 0;
    while (h.pendingChoices.length && guard++ < 80) {
      const c = h.pendingChoices[0];
      if (!c.options || !c.options.length) { h.pendingChoices.shift(); continue; }
      resolveChoice(h, c.id, c.options[0].key);
    }
  };
  drain();
  for (let lv = 2; lv <= target; lv++) {
    h.level = lv;
    applyLevelGrants(h, lv, null, { autosOnly: false });
    drain();
  }
  recalc(h);
}

const sorc = (lv = 1) => {
  const h = makeHero('S', 'human', 'sorcerer', { str: 8, dex: 14, con: 14, int: 10, wis: 10, cha: 16 }, {});
  seedNewHeroProgression(h);
  levelTo(h, lv);
  return h;
};

describe('Font of Magic', () => {
  it('replaces Tides of Chaos at level 1 with a 2-point pool', () => {
    const h = sorc(1);
    expect(hasFeature(h, 'fontOfMagic')).toBe(true);
    expect(hasFeature(h, 'tidesOfChaos')).toBe(false);
    expect(h.sorcPointsMax).toBe(2);
    expect(sorceryPointsLeft(h)).toBe(2);
  });

  it('grows with level and no longer adds a level-1 slot', () => {
    const h = sorc(7);
    expect(h.sorcPointsMax).toBe(7);
    expect(h.slotsMax[1]).toBe(4);           // the SRD full-caster table, nothing extra
  });

  it('turns points into a slot when the sorcerer is dry, and a slot back into points', () => {
    const h = sorc(5);
    h.slots = { 1: 0, 2: 0, 3: 0 };
    expect(flexSlotLevelFor(h, 2)).toBe(2);
    expect(createSlotFromPoints(h, 2)).toBe(true);
    expect(h.slots[2]).toBe(1);
    expect(sorceryPointsLeft(h)).toBe(5 - FLEX_SLOT_COST[2]);
    h.slots[3] = 1;
    expect(convertSlotToPoints(h, 3)).toBe(3);
    expect(h.slots[3]).toBe(0);
    expect(sorceryPointsLeft(h)).toBe(5);
    /* points never overflow the pool */
    h.slots[1] = 1;
    expect(convertSlotToPoints(h, 1)).toBe(0);
    expect(h.slots[1]).toBe(1);
  });

  it('cannot flex past 5th level', () => {
    const h = sorc(20);
    expect(flexSlotLevelFor(h, 6)).toBe(0);
  });
});

describe('Metamagic picks', () => {
  it('offers two at level 2, then one at 10 and 17', () => {
    const h = sorc(1);
    h.level = 2;
    applyLevelGrants(h, 2, null, { autosOnly: false });
    const mm = h.pendingChoices.filter(c => c.pick === 'metamagic');
    expect(mm.length).toBe(2);
    expect(mm[0].options.map(o => o.key).sort()).toEqual(Object.keys(METAMAGIC).sort());
    resolveChoice(h, mm[0].id, 'twinned');
    const left = h.pendingChoices.find(c => c.pick === 'metamagic');
    expect(left.options.map(o => o.key)).not.toContain('twinned');
    expect(hasMetamagic(h, 'twinned')).toBe(true);
    const h20 = sorc(20);
    expect(h20.metamagic.length).toBe(4);
  });
});

describe('Sorcerous Restoration', () => {
  it('a short rest gives half the level back once per long rest; a long rest refills', () => {
    const h = sorc(8);
    spendSorceryPoints(h, 8);
    applyShortRestToHero(h);
    expect(sorceryPointsLeft(h)).toBe(4);
    applyShortRestToHero(h);
    expect(sorceryPointsLeft(h)).toBe(4);
    applyLongRestToHero(h);
    expect(sorceryPointsLeft(h)).toBe(8);
  });

  it('a level-4 sorcerer gets nothing back on a short rest', () => {
    const h = sorc(4);
    spendSorceryPoints(h, 2);
    applyShortRestToHero(h);
    expect(sorceryPointsLeft(h)).toBe(2);
  });
});

describe('legacy sorcerer saves', () => {
  it('swap Tides of Chaos for Font of Magic and owe their Metamagic picks', () => {
    const h = {
      name: 'Old', classKey: 'sorcerer', level: 12, progressionVersion: 1,
      stats: { str: 8, dex: 12, con: 14, int: 10, wis: 10, cha: 16 },
      features: ['tidesOfChaos', 'fontOfMagic', 'metamagic'], knownSpells: [], resolvedChoices: [],
      pendingChoices: [], feats: [], subclassMilestones: [], skillRanks: {}
    };
    migrateProgression(h);
    expect(h.features).not.toContain('tidesOfChaos');
    expect(h.features).toContain('sorcerousRestoration');
    expect(h.pendingChoices.filter(c => c.pick === 'metamagic').length).toBe(3);
    migrateProgression(h);   // idempotent
    expect(h.pendingChoices.filter(c => c.pick === 'metamagic').length).toBe(3);
  });

  it('a wild-magic sorcerer keeps Tides of Chaos for now', () => {
    const h = {
      name: 'Old', classKey: 'sorcerer', level: 3, subclass: 'wildmagic', progressionVersion: 1,
      stats: { str: 8, dex: 12, con: 14, int: 10, wis: 10, cha: 16 },
      features: ['tidesOfChaos'], knownSpells: [], resolvedChoices: [],
      pendingChoices: [], feats: [], subclassMilestones: [], skillRanks: {}
    };
    migrateProgression(h);
    expect(h.features).toContain('tidesOfChaos');
    expect(h.features).toContain('fontOfMagic');
  });
});

describe('which spells each option fits', () => {
  it('twins single-target spells only', () => {
    for (const k of ['chromaticOrb', 'blindness', 'blight', 'disintegrate']) expect(isTwinnable(k, SPELLS[k])).toBe(true);
    for (const k of ['fireball', 'holdPerson', 'scorchingRay', 'haste', 'shield', 'counterspell']) expect(isTwinnable(k, SPELLS[k])).toBe(false);
  });
  it('heightens only spells that force a save; twins cost the spell level', () => {
    expect(metamagicFits('heightened', 'fireball', SPELLS.fireball)).toBe(true);
    expect(metamagicFits('heightened', 'chromaticOrb', SPELLS.chromaticOrb)).toBe(false);
    expect(metamagicCost('twinned', SPELLS.blight)).toBe(4);
    expect(metamagicCost('quickened', SPELLS.blight)).toBe(2);
  });
});

describe('the AI plan', () => {
  const fakeGame = (monsters) => ({
    ...metamagicMethods, monsters, initiative: { active: true, round: 1, idx: 0 }, fxNow: 0,
    monsterEliteRoom: () => false, fxLog() {}, fxText() {}, _v3: () => null, refreshAbilityHud() {}
  });
  const mob = (x, extra = {}) => {
    const { data, ...rest } = extra;
    return { x, z: 0, active: true, ...rest, data: { name: 'm' + x, hp: 10, ...data } };
  };

  it('twins onto a second foe and pays the spell level', () => {
    const h = { x: 0, z: 0, data: sorc(10) };
    h.data.metamagic = ['twinned'];
    const a = mob(2), b = mob(4);
    const g = fakeGame([a, b]);
    const plan = g.planMetamagic(h, 'blight', SPELLS.blight, a);
    expect(plan.primary).toBe('twinned');
    expect(plan.partner).toBe(b);
    g.applyMetamagicPre(h, 'blight', SPELLS.blight, a, plan);
    expect(sorceryPointsLeft(h.data)).toBe(6);
  });

  it('goes subtle when a counterspeller is in reach', () => {
    const h = { x: 0, z: 0, data: sorc(10) };
    h.data.metamagic = ['subtle', 'twinned'];
    const mage = mob(3, { data: { knownSpells: ['counterspell'], slots: { 3: 1 } } });
    const g = fakeGame([mage, mob(5)]);
    const plan = g.planMetamagic(h, 'blight', SPELLS.blight, mage);
    expect(plan.primary).toBe('subtle');
  });

  it('heightens the save against a boss, and never spends what it lacks', () => {
    const h = { x: 0, z: 0, data: sorc(10) };
    h.data.metamagic = ['heightened'];
    const boss = mob(3, { isBoss: true });
    const g = fakeGame([boss]);
    expect(g.planMetamagic(h, 'holdPerson', SPELLS.holdPerson, boss).primary).toBe('heightened');
    spendSorceryPoints(h.data, 9);
    expect(g.planMetamagic(h, 'holdPerson', SPELLS.holdPerson, boss)).toBe(null);
  });
});
