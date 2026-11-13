import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeHero, recalc, SUBCLASSES, pickSubclass } from '../src/game/srd.js';
import {
  seedNewHeroProgression, applyLevelGrants, resolveChoice, migrateProgression, wardMaxFor
} from '../src/game/features.js';
import { applyShortRestToHero, applyLongRestToHero } from '../src/game/rest.js';
import { rollSaveDetail } from '../src/game/conditions.js';
import { SPELLS } from '../src/game/spells.js';
import { abjurationMethods, canCounterspell } from '../src/game/abjuration.js';

afterEach(() => vi.restoreAllMocks());

function wiz(lv, sub = 'abjurer') {
  const h = makeHero('A', 'human', 'wizard', { str: 8, dex: 14, con: 14, int: 16, wis: 10, cha: 10 }, {});
  seedNewHeroProgression(h);
  for (let l = 2; l <= lv; l++) {
    h.level = l;
    if (l === 3) pickSubclass(h, sub);
    applyLevelGrants(h, l, null, { autosOnly: false });
    let g = 0;
    while (h.pendingChoices.length && g++ < 80) {
      const c = h.pendingChoices[0];
      if (!c.options || !c.options.length) { h.pendingChoices.shift(); continue; }
      resolveChoice(h, c.id, c.options[0].key);
    }
  }
  recalc(h);
  return h;
}

const ent = (data, x = 0) => ({ x, z: 0, active: true, data });

/* Just enough of the game for the abjuration methods. */
function fakeGame(heroes, monsters = []) {
  const log = [];
  return {
    ...abjurationMethods, heroes, monsters, log, fxNow: 0,
    monsterEliteRoom: () => false,
    playAbilityFx() {}, fxText() {}, fxLog(m) { log.push(m); }, _v3: () => null,
    refreshHud() {}, refreshAbilityHud() {}
  };
}

describe('the subclass', () => {
  it('has Projected Ward as its active, not Magic Missile', () => {
    const sc = SUBCLASSES.wizard.abjurer;
    expect(sc.active.key).toBe('projectedWard');
    expect(sc.passiveKey).toBe('arcaneWard');
  });

  it('sizes the ward at 2 × level + INT, 3 × level at 18', () => {
    const h = wiz(5);
    expect(h.wardMax).toBe(2 * 5 + 3);
    expect(h.wardHp).toBe(h.wardMax);
    expect(wardMaxFor(wiz(18))).toBe(3 * 18 + 3);
    expect(wiz(5, 'evoker').wardMax).toBeUndefined();
  });

  it('renames an old save’s milestones', () => {
    const h = {
      name: 'Old', classKey: 'wizard', level: 14, subclass: 'abjurer', progressionVersion: 1,
      stats: { str: 8, dex: 12, con: 14, int: 16, wis: 10, cha: 10 }, features: [],
      knownSpells: [], resolvedChoices: [], pendingChoices: [], feats: [], skillRanks: {},
      subclassMilestones: [{ level: 6, label: 'Projected Ward', pb: {} }, { level: 14, label: 'Greater Abjuration', pb: {} }]
    };
    migrateProgression(h);
    expect(h.subclassMilestones.map(m => m.label)).toEqual(['Warding Recovery', 'Spell Resistance']);
  });
});

describe('the ward pool', () => {
  it('lasts between fights and recharges by 2 × slot level', () => {
    const h = ent(wiz(5));
    const g = fakeGame([h]);
    h.data.wardHp = 0;
    expect(g.abjurerAfterSlot(h, 3)).toBe(6);
    expect(h.data.wardHp).toBe(6);
    g.abjurerAfterSlot(h, 9);
    expect(h.data.wardHp).toBe(h.data.wardMax);        // never over the cap
  });

  it('soaks the abjurer’s damage until it is spent', () => {
    const h = ent(wiz(5));
    const g = fakeGame([h]);
    const mit = {};
    expect(g.absorbArcaneWard(h, 5, mit)).toBe(0);
    expect(mit.wardAbsorbed).toBe(5);
    expect(g.absorbArcaneWard(h, 20)).toBe(20 - (h.data.wardMax - 5));
    expect(h.data.wardHp).toBe(0);
  });

  it('fills on a long rest; from level 6 a short rest gives half back', () => {
    const lo = wiz(5), hi = wiz(8);
    lo.wardHp = 0; hi.wardHp = 0;
    applyShortRestToHero(lo); applyShortRestToHero(hi);
    expect(lo.wardHp).toBe(0);
    expect(hi.wardHp).toBe(Math.ceil(hi.wardMax / 2));
    applyLongRestToHero(lo);
    expect(lo.wardHp).toBe(lo.wardMax);
  });
});

describe('Projected Ward', () => {
  const ally = (x, hp = 30) => ent({ name: 'Ally', hp, maxHp: 30 }, x);

  it('soaks a heavy hit on a nearby ally with the abjurer’s reaction', () => {
    const a = ent(wiz(5), 0), b = ally(3);
    const g = fakeGame([a, b]);
    expect(g.projectArcaneWard(b, 10)).toBe(0);
    expect(a.data.wardHp).toBe(a.data.wardMax - 10);
    expect(a.reactionUsed).toBe(true);
    /* one reaction a round */
    expect(g.projectArcaneWard(b, 10)).toBe(10);
  });

  it('ignores scratches, allies out of reach, and the abjurer’s own hits', () => {
    const a = ent(wiz(5), 0);
    const g = fakeGame([a, ally(3), ally(9)]);
    expect(g.projectArcaneWard(g.heroes[1], 3)).toBe(3);      // under a fifth of 30
    expect(g.projectArcaneWard(g.heroes[2], 10)).toBe(10);    // 9 tiles off
    expect(g.projectArcaneWard(a, 10)).toBe(10);
    expect(a.reactionUsed).toBeFalsy();
  });

  it('always steps in when the hit would drop the ally', () => {
    const a = ent(wiz(5), 0), b = ally(2, 4);
    const g = fakeGame([a, b]);
    expect(g.projectArcaneWard(b, 4)).toBe(0);
  });
});

describe('Spell Resistance', () => {
  it('halves spell damage and gives advantage on saves vs spells at 14', () => {
    const lo = ent(wiz(13)), hi = ent(wiz(14));
    const g = fakeGame([lo, hi]);
    expect(g.abjurerSpellResist(lo, 20, true)).toBe(20);
    expect(g.abjurerSpellResist(hi, 20, true)).toBe(10);
    expect(g.abjurerSpellResist(hi, 20, false)).toBe(20);
    const r = vi.spyOn(Math, 'random');
    r.mockReturnValueOnce(0.0).mockReturnValueOnce(0.99);    // 1 and 20 → takes the 20
    expect(rollSaveDetail(hi.data, 'wis', 15, { magic: true }).d20).toBe(20);
  });
});

describe('Counterspell', () => {
  const caster = (extra = {}) => ({ x: 4, z: 0, active: true, data: { name: 'Mage', hp: 30, maxHp: 30 }, ...extra });
  const fx = { dice: [8, 6], aoe: 3 };

  it('is never cast as an action any more', () => {
    expect(SPELLS.counterspell.ai.when).toBe('never');
  });

  it('a hero who knows it stops a monster spell up to 3rd level, for a slot', () => {
    const w = ent(wiz(5, 'evoker'));
    w.data.knownSpells.push('counterspell');
    const g = fakeGame([w]);
    const before = w.data.slots[3];
    expect(g.heroCounterspell(caster(), 'fireball', fx, 'Fireball')).toBe(true);
    expect(w.data.slots[3]).toBe(before - 1);
    expect(w.reactionUsed).toBe(true);
  });

  it('a hero who does not know it, or has no 3rd-level slot, can’t', () => {
    const w = ent(wiz(5, 'evoker'));
    expect(canCounterspell(w)).toBe(false);
    w.data.knownSpells.push('counterspell');
    w.data.slots[3] = 0;
    expect(canCounterspell(w)).toBe(false);
  });

  it('skips spells not worth a slot', () => {
    const w = ent(wiz(5, 'evoker'));
    w.data.knownSpells.push('counterspell');
    const g = fakeGame([w]);
    expect(g.heroCounterspell(caster(), 'fireBolt', { dice: [1, 10] }, 'Fire Bolt')).toBe(false);
    expect(g.heroCounterspell(caster(), 'magicMissile', { dice: [3, 4, 3] }, 'Magic Missile')).toBe(false);
    expect(w.reactionUsed).toBeFalsy();
  });

  it('Spell Breaker: known at 10, +proficiency on the check, keeps the slot on a miss', () => {
    const w = ent(wiz(10));
    expect(w.data.knownSpells).not.toContain('counterspell');
    expect(canCounterspell(w)).toBe(true);
    const g = fakeGame([w]);
    const before = w.data.slots[3];
    vi.spyOn(Math, 'random').mockReturnValue(0.0);           // a natural 1: 1 + 3 + 4 < 17
    expect(g.heroCounterspell(caster(), 'disintegrate', { dice: [10, 6, 40] }, 'Disintegrate')).toBe(false);
    expect(w.data.slots[3]).toBe(before);
    Math.random.mockReturnValue(0.5);                       // 11 + 3 + 4 = 18 ≥ 16 (level 6)
    w.reactionUsed = false;
    expect(g.heroCounterspell(caster(), 'disintegrate', { dice: [10, 6, 40] }, 'Disintegrate')).toBe(true);
  });

  it('a countered spell refills the abjurer’s ward', () => {
    const w = ent(wiz(10));
    w.data.wardHp = 0;
    const g = fakeGame([w]);
    g.heroCounterspell(caster(), 'fireball', fx, 'Fireball');
    expect(w.data.wardHp).toBe(6);
  });
});
