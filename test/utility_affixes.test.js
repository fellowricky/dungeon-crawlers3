import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  rollItem, AFFIXES, affixSlotRule, getBase, partyLootFind, applyGoldFind, magicFindLuck, bonusText
} from '../src/game/items.js';
import { bonusesCost, BANE_TYPES, STEADFAST_GROUPS } from '../src/game/budget.js';
import { makeHero, recalc, baneBonusVs, potionHealAmount, creatureTypeOf, wardCap } from '../src/game/srd.js';
import { rollSaveDetail, steadfastBonus } from '../src/game/conditions.js';
import { mulberry32 } from '../src/game/quests.js';

/* The Nov 2026 utility affixes: Magic Find, Gold Find, Alchemist, Vigilance,
   Potency (spell DC), Focus, Farshot, Bloodthirst, Sentinel, Warding,
   Steadfast and Bane. These pin the rules they carry and the plumbing each
   one rides on. */

afterEach(() => vi.restoreAllMocks());

const NEW_KEYS = ['magicFind', 'goldFind', 'potionHeal', 'init', 'spellDC', 'concentration',
  'range', 'bloodthirst', 'oaDmg'];
const def = (k) => AFFIXES.find(a => a.key === k);

/** A fighter wearing one ring that carries exactly `b`. */
function wearing(b, raceKey = 'human') {
  const h = makeHero('T', raceKey, 'fighter', { str: 14, dex: 14, con: 14 });
  h.equipment = { ...(h.equipment || {}), ring1: { slot: 'ring', baseKey: 'x', bonuses: b } };
  recalc(h);
  return h;
}

describe('affix data', () => {
  it('every new affix is priced', () => {
    for (const k of NEW_KEYS) expect(bonusesCost(def(k).b), k).toBeGreaterThan(0);
    for (const a of AFFIXES.filter(a => a.family)) expect(bonusesCost(a.b), a.key).toBeGreaterThan(0);
  });

  it('there is a bane for every creature type, all in one family', () => {
    const banes = AFFIXES.filter(a => a.family === 'bane').map(a => Object.keys(a.b)[0]);
    expect(banes).toHaveLength(BANE_TYPES.length);
  });

  it('percent affixes print as percentages', () => {
    expect(bonusText({ slot: 'ring', bonuses: { magicFind: 10 } })).toContain('+10% Magic Find');
  });
});

describe('fixed slot rules', () => {
  const sword = getBase('weapon', 'Longsword');
  const staff = getBase('weapon', 'Staff');
  const bow = getBase('weapon', 'Longbow');

  it('Spell DC and Focus roll only on staves and wands among weapons', () => {
    for (const k of ['spellDC', 'concentration']) {
      expect(affixSlotRule(def(k), 'weapon', sword), k).toBe(false);
      expect(affixSlotRule(def(k), 'weapon', staff), k).toBe(true);
    }
  });

  it('Farshot rolls only on weapons that shoot', () => {
    expect(affixSlotRule(def('range'), 'weapon', sword)).toBe(false);
    expect(affixSlotRule(def('range'), 'weapon', bow)).toBe(true);
  });
});

describe('families', () => {
  it('an item never carries two members of one family', () => {
    const rng = mulberry32(77);
    const famOf = Object.fromEntries(AFFIXES.map(a => [a.key, a.family]));
    let sawFamily = 0;
    for (let i = 0; i < 6000; i++) {
      const it = rollItem(4 + (i % 10), rng, null, { forceRarity: ['rare', 'epic'][i % 2] });
      const seen = new Set();
      for (const a of it.affixes || []) {
        const f = famOf[a.key];
        if (!f) continue;
        sawFamily++;
        expect(seen.has(f), `${it.name} has two ${f}`).toBe(false);
        seen.add(f);
      }
    }
    expect(sawFamily).toBeGreaterThan(0);
  });
});

describe('hero plumbing', () => {
  it('recalc caches every utility stat', () => {
    const h = wearing({ init: 2, potionHeal: 20, bloodthirst: 4, oaDmg: 2, concentration: 2,
      magicFind: 10, goldFind: 20, wardFire: 2, baneUndead: 4, steadMind: 1 });
    expect(h.initBonus).toBe(2);
    expect(h.potionHealPct).toBe(20);
    expect(h.bloodthirst).toBe(4);
    expect(h.oaDmgBonus).toBe(2);
    expect(h.concentrationBonus).toBe(2);
    expect(h.ward.fire).toBe(2);
    expect(h.bane.undead).toBe(4);
    expect(h.steadfast.steadMind).toBe(1);
  });

  it('Warding is capped', () => {
    expect(wearing({ wardCold: 40 }).ward.cold).toBe(wardCap());
  });

  it('Potency raises the spell DC bonus', () => {
    expect(wearing({ spellDC: 2 }).spellDCBonus).toBe(2);
  });

  it('Bane matches the creature type, swarms count as beasts', () => {
    const h = wearing({ baneBeast: 3 });
    expect(baneBonusVs(h, { data: { type: 'swarm of tiny beasts' } })).toBe(3);
    expect(baneBonusVs(h, { data: { type: 'undead' } })).toBe(0);
    expect(creatureTypeOf({ data: { type: 'Undead' } })).toBe('undead');
  });

  it('Alchemist scales potion healing', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);   // max rolls: 2d4+2 = 10
    expect(potionHealAmount('heal', { potionHealPct: 0 })).toBe(10);
    expect(potionHealAmount('heal', { potionHealPct: 30 })).toBe(13);
  });
});

describe('Steadfast', () => {
  it('adds to saves against its group only', () => {
    const d = { steadfast: { steadMind: 3 } };
    expect(steadfastBonus(d, 'frightened')).toBe(3);
    expect(steadfastBonus(d, 'poisoned')).toBe(0);
    expect(Object.keys(STEADFAST_GROUPS)).toHaveLength(3);
  });

  it('reaches the real save roll when the condition is named', () => {
    const h = wearing({ steadMind: 3 });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const plain = rollSaveDetail(h, 'wis', 15).total;
    const vsFear = rollSaveDetail(h, 'wis', 15, { vs: 'frightened' }).total;
    expect(vsFear - plain).toBe(3);
  });
});

describe('Magic Find / Gold Find', () => {
  const party = (mf, gf, n = 2) => Array.from({ length: n }, () => ({ data: { hp: 10, magicFind: mf, goldFind: gf } }));

  it('sums living heroes and caps', () => {
    expect(partyLootFind(party(10, 20)).magicFind).toBe(20);
    expect(partyLootFind(party(80, 100)).magicFind).toBe(100);
    expect(partyLootFind(party(80, 100)).goldFind).toBe(150);
    expect(partyLootFind([{ data: { hp: 0, magicFind: 50 } }]).magicFind).toBe(0);
  });

  it('scales combat gold and rarity luck', () => {
    expect(applyGoldFind(100, party(0, 25))).toBe(150);
    expect(magicFindLuck(party(25, 0), 4)).toBeCloseTo(6);
  });
});

describe('drop mix and gear tags', () => {
  it('weapons drop more than shields, and trinkets stay near their 10% branch', () => {
    const rng = mulberry32(11);
    const c = {};
    const N = 12000;
    for (let i = 0; i < N; i++) {
      const it = rollItem(3, rng, null, { source: 'trash' });
      const k = it.lightSource ? 'light' : it.slot;
      c[k] = (c[k] || 0) + 1;
    }
    expect(c.weapon).toBeGreaterThan(c.helm * 1.3);
    expect(c.shield).toBeLessThan(c.helm * 0.7);
    expect(c.trinket / N).toBeLessThan(0.13);
  });

  it('every helm without AC is clothing, wearable by any class', () => {
    for (const name of ['Rag Hood', 'Cap', 'Tricorne Hat', "Jester's Cap", 'Feathered Hat', 'Wizard Hat']) {
      expect(getBase('helm', name).prof, name).toBe('none');
    }
  });
});

