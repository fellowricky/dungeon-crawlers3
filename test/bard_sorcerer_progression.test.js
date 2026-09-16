import { describe, it, expect } from 'vitest';
import { makeHero } from '../src/game/srd.js';
import {
  seedNewHeroProgression, applyLevelGrants, resolveChoice, migrateProgression,
  spellSlotsFor, CLASS_PROGRESSION
} from '../src/game/features.js';
import { SPELLS, SPELL_POOLS } from '../src/game/spells.js';

/** Play a hero to `target`, always taking the first option offered. */
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
}

const hero = (cls) => {
  const h = makeHero('T', 'human', cls, { str: 8, dex: 12, con: 14, int: 14, wis: 12, cha: 16 }, {});
  seedNewHeroProgression(h);
  return h;
};

/* SRD 5.1 spells-known tables. */
const SRD = {
  bard:     [null, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22],
  sorcerer: [null, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15],
};

describe.each(['bard', 'sorcerer'])('%s spells known follow the SRD', (cls) => {
  it('matches the SRD curve at every level', () => {
    const h = hero(cls);
    for (let lv = 1; lv <= 20; lv++) {
      levelTo(h, lv);
      expect(`${cls} L${lv}=${h.knownSpells.length}`).toBe(`${cls} L${lv}=${SRD[cls][lv]}`);
    }
  });

  it('never learns the same spell twice', () => {
    const h = hero(cls);
    levelTo(h, 20);
    expect(new Set(h.knownSpells).size).toBe(h.knownSpells.length);
  });

  it('never learns a spell it has no slot to cast', () => {
    const h = hero(cls);
    for (let lv = 1; lv <= 20; lv++) {
      levelTo(h, lv);
      const maxSlot = Math.max(0, ...Object.keys(spellSlotsFor(cls, lv)).map(Number));
      for (const k of h.knownSpells) expect(SPELLS[k].level).toBeLessThanOrEqual(maxSlot);
    }
  });

  it('leaves no pick silently dropped for want of options', () => {
    const h = hero(cls);
    levelTo(h, 20);
    expect(h.pendingChoices).toHaveLength(0);
  });
});

it('bard level 1 accounts for the free Cure Wounds healers are handed', () => {
  const h = hero('bard');
  levelTo(h, 1);
  expect(h.knownSpells).toContain('cureWounds');
  /* 3 picks + the free spell = the SRD's 4 */
  expect(h.knownSpells).toHaveLength(4);
});

describe('every tier has more spells than the picks that draw from it', () => {
  it('holds for all casters, so no level-up quietly offers nothing', () => {
    for (const cls of Object.keys(SPELL_POOLS)) {
      const table = CLASS_PROGRESSION[cls];
      if (!table) continue;
      const draws = {};
      for (let lv = 1; lv <= 20; lv++)
        for (const g of (table[lv] || []))
          if (g.type === 'choice' && (g.pick === 'spell' || g.pick === 'arcanum'))
            draws[g.tier] = (draws[g.tier] || 0) + 1;
      for (const [tier, n] of Object.entries(draws)) {
        const size = new Set((SPELL_POOLS[cls][tier] || []).filter(k => SPELLS[k])).size;
        /* compared as strings so a failure names the class and tier */
        expect(`${cls} t${tier}: ${size} spells >= ${n} picks`)
          .toBe(`${cls} t${tier}: ${Math.max(size, n)} spells >= ${n} picks`);
      }
    }
  });
});

describe('legacy bard and sorcerer saves are topped up, not reset', () => {
  const legacy = (cls, level, known, resolved) => ({
    name: 'Old', classKey: cls, level, progressionVersion: 1,
    stats: { str: 8, dex: 12, con: 14, int: 14, wis: 12, cha: 16 },
    features: [], knownSpells: [...known], resolvedChoices: [...resolved],
    pendingChoices: [], feats: [], subclassMilestones: [], skillRanks: {}
  });

  it('keeps a level-6 bard’s spells and queues the rest of the 9 it is owed', () => {
    const h = legacy('bard', 6, ['healingWord', 'bless', 'haste'],
      ['bard_sp1', 'bard_sp2', 'bard_sp3', 'asi_4']);
    migrateProgression(h);
    const owed = h.pendingChoices.filter(c => c.pick === 'spell').length;
    expect(h.knownSpells.length + owed).toBe(9);
    for (const k of ['healingWord', 'bless', 'haste']) expect(h.knownSpells).toContain(k);
  });

  it('tops a level-10 sorcerer up to the 11 the SRD owes', () => {
    const h = legacy('sorcerer', 10, ['fireball', 'shield', 'haste', 'blight', 'coneOfCold'],
      ['sorc_sp1', 'sorc_sp2', 'sorc_sp3', 'sorc_sp4', 'sorc_sp5']);
    migrateProgression(h);
    const owed = h.pendingChoices.filter(c => c.pick === 'spell').length;
    expect(h.knownSpells.length + owed).toBe(11);
  });

  it('never re-offers a spell the hero already knows', () => {
    const h = legacy('sorcerer', 10, ['fireball', 'shield', 'haste', 'blight', 'coneOfCold'],
      ['sorc_sp1', 'sorc_sp2']);
    migrateProgression(h);
    for (const c of h.pendingChoices)
      for (const o of (c.options || []))
        expect(h.knownSpells).not.toContain(o.key);
  });
});
