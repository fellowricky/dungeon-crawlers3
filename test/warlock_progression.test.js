import { describe, it, expect } from 'vitest';
import { makeHero } from '../src/game/srd.js';
import {
  applyLevelGrants, resolveChoice, migrateProgression, chargeDef, chargesLeft,
  spendCharge, hasFeature, isArcanum, featureBonuses, INVOCATIONS
} from '../src/game/features.js';
import { SPELLS } from '../src/game/spells.js';

/** Level a warlock to `target`, always taking the first offered option. */
function levelTo(h, target) {
  const drain = () => {
    let guard = 0;
    while (h.pendingChoices.length && guard++ < 60) {
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
}

const newWarlock = () =>
  makeHero('Vex', 'human', 'warlock', { str: 8, dex: 12, con: 14, int: 10, wis: 10, cha: 16 }, {});

describe('Warlock progression follows the SRD', () => {
  /* SRD 5.1 warlock: spells known 2,3,4,...,10 at L9, then every other level. */
  const SRD_SPELLS = [null, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15];
  /* Invocations known: 2 at L2, then 3/4/5/6/7/8 at L5/7/9/12/15/18. */
  const SRD_INVOCATIONS = [null, 0, 2, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8];

  it('matches the SRD spells-known and invocations-known curves at every level', () => {
    const h = newWarlock();
    for (let lv = 1; lv <= 20; lv++) {
      levelTo(h, lv);
      const ordinary = h.knownSpells.filter(k => !h.arcana.includes(k)).length;
      expect(`L${lv} spells=${ordinary}`).toBe(`L${lv} spells=${SRD_SPELLS[lv]}`);
      expect(`L${lv} invoc=${h.invocations.length}`).toBe(`L${lv} invoc=${SRD_INVOCATIONS[lv]}`);
    }
  });

  it('knows 7 spells at level 6, not 3 (the old table stopped at levels 1/3/5)', () => {
    const h = newWarlock();
    levelTo(h, 6);
    expect(h.knownSpells.filter(k => !h.arcana.includes(k)).length).toBe(7);
  });

  it('never learns a spell it has no slot to cast', () => {
    const h = newWarlock();
    for (let lv = 1; lv <= 20; lv++) {
      levelTo(h, lv);
      /* pact slots cap at 5th level; anything above that must be an arcanum */
      for (const key of h.knownSpells) {
        if (h.arcana.includes(key)) continue;
        expect((SPELLS[key].level || 0) <= 5).toBe(true);
      }
    }
  });
});

describe('Eldritch Invocations are chosen, not handed out', () => {
  it('offers a real list of options and auto-grants none', () => {
    const h = newWarlock();
    levelTo(h, 1);
    expect(h.invocations).toHaveLength(0);
    expect(h.features).not.toContain('agonizingBlast');

    h.level = 2;
    applyLevelGrants(h, 2, null, { autosOnly: false });
    const picks = h.pendingChoices.filter(c => c.pick === 'invocation');
    expect(picks).toHaveLength(2);
    expect(picks[0].options.length).toBeGreaterThan(3);
    expect(picks[0].options.map(o => o.key)).toContain('agonizingBlast');

    resolveChoice(h, picks[0].id, 'repellingBlast');
    expect(h.invocations).toEqual(['repellingBlast']);
    /* combat reads invocations through hasFeature, so the pick must land there */
    expect(hasFeature(h, 'repellingBlast')).toBe(true);
    expect(hasFeature(h, 'agonizingBlast')).toBe(false);
  });

  it('does not offer the same invocation twice for two picks at one level', () => {
    const h = newWarlock();
    levelTo(h, 1);
    h.level = 2;
    applyLevelGrants(h, 2, null, { autosOnly: false });
    const picks = h.pendingChoices.filter(c => c.pick === 'invocation');
    resolveChoice(h, picks[0].id, 'agonizingBlast');

    const second = h.pendingChoices.find(c => c.pick === 'invocation');
    expect(second.options.map(o => o.key)).not.toContain('agonizingBlast');

    resolveChoice(h, second.id, second.options[0].key);
    expect(h.invocations).toHaveLength(2);
    expect(new Set(h.invocations).size).toBe(2);
  });

  it('gates level-restricted invocations until the hero qualifies', () => {
    const h = newWarlock();
    levelTo(h, 1);
    h.level = 2;
    applyLevelGrants(h, 2, null, { autosOnly: false });
    const keys = h.pendingChoices.find(c => c.pick === 'invocation').options.map(o => o.key);
    expect(INVOCATIONS.thirstingBlade.minLevel).toBe(5);
    expect(keys).not.toContain('thirstingBlade');
    expect(keys).not.toContain('lifedrinker');
  });

  it('applies invocation passive bonuses', () => {
    const h = newWarlock();
    levelTo(h, 1);
    h.invocations = ['armorOfShadows', 'fiendishVigor'];
    const pb = featureBonuses(h);
    expect(pb.ac).toBe(1);
    expect(pb.hp).toBe(5);
  });
});

describe('Mystic Arcanum uses its own resource', () => {
  it('grants one arcanum each at levels 11, 13, 15 and 17', () => {
    const h = newWarlock();
    levelTo(h, 20);
    expect(h.arcana).toHaveLength(4);
    for (const key of h.arcana) {
      expect(h.knownSpells).toContain(key);
      /* the whole point: above anything a pact slot could ever pay for */
      expect(SPELLS[key].level).toBeGreaterThanOrEqual(6);
    }
  });

  it('bills a once-per-long-rest charge, not a pact slot', () => {
    const h = newWarlock();
    levelTo(h, 11);
    const arc = h.arcana[0];
    expect(isArcanum(h, arc)).toBe(true);

    expect(chargeDef('arcanum:' + arc, h)).toEqual({ max: 1, recharge: 'long' });
    expect(chargesLeft(h, 'arcanum:' + arc)).toBe(1);
    expect(spendCharge(h, 'arcanum:' + arc)).toBe(true);
    expect(chargesLeft(h, 'arcanum:' + arc)).toBe(0);
    expect(spendCharge(h, 'arcanum:' + arc)).toBe(false);
  });
});

describe('Legacy warlock saves migrate without loss or double-dipping', () => {
  const legacy = (level, extra = {}) => ({
    name: 'Old', classKey: 'warlock', level, progressionVersion: 1,
    stats: { str: 8, dex: 12, con: 14, int: 10, wis: 10, cha: 16 },
    features: ['pactMagic', 'eldritchBlast', 'agonizingBlast', 'repellingBlast'],
    knownSpells: ['hex', 'scorchingRay', 'vampiricTouch'],
    resolvedChoices: ['wlk_sp1', 'wlk_sp2', 'wlk_sp3', 'asi_4'],
    pendingChoices: [], feats: [], subclassMilestones: [], skillRanks: {},
    ...extra
  });

  it('keeps invocations already earned and queues only the shortfall', () => {
    const h = legacy(6);
    migrateProgression(h);
    /* the two it was handed move out of `features` and into `invocations` */
    expect(h.invocations).toEqual(['agonizingBlast', 'repellingBlast']);
    expect(h.features).not.toContain('agonizingBlast');
    /* SRD owes a level-6 warlock 3 invocations, so exactly one pick is due */
    expect(h.pendingChoices.filter(c => c.pick === 'invocation')).toHaveLength(1);
  });

  it('tops a level-6 warlock up from 3 spells known to the 7 the SRD owes', () => {
    const h = legacy(6);
    migrateProgression(h);
    const owed = h.pendingChoices.filter(c => c.pick === 'spell').length;
    expect(h.knownSpells.length + owed).toBe(7);
  });

  it('reclassifies already-known 6th+ spells as arcana instead of dead weight', () => {
    const h = legacy(13, {
      knownSpells: ['hex', 'scorchingRay', 'vampiricTouch', 'blight', 'disintegrate', 'fingerOfDeath'],
      resolvedChoices: ['wlk_sp1', 'wlk_sp2', 'wlk_sp3', 'wlk_sp4', 'wlk_mystic6', 'wlk_mystic7']
    });
    migrateProgression(h);
    expect(h.arcana).toEqual(['disintegrate', 'fingerOfDeath']);
    /* and it must not hand them a fresh arcanum pick for ones they already own */
    expect(h.pendingChoices.filter(c => c.pick === 'arcanum')).toHaveLength(0);
  });

  it('does not let arcana eat the ordinary spell picks a warlock is owed', () => {
    const h = legacy(13, {
      knownSpells: ['hex', 'scorchingRay', 'vampiricTouch', 'blight', 'disintegrate', 'fingerOfDeath'],
      resolvedChoices: ['wlk_sp1', 'wlk_sp2', 'wlk_sp3', 'wlk_sp4', 'wlk_mystic6', 'wlk_mystic7']
    });
    migrateProgression(h);
    const ordinary = h.knownSpells.filter(k => !h.arcana.includes(k)).length;
    const owed = h.pendingChoices.filter(c => c.pick === 'spell').length;
    expect(ordinary + owed).toBe(12);
  });
});
