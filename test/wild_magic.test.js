import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeHero, recalc, SUBCLASSES, pickSubclass } from '../src/game/srd.js';
import {
  seedNewHeroProgression, applyLevelGrants, resolveChoice, migrateProgression,
  hasCharge, spendCharge, sorceryPointsLeft
} from '../src/game/features.js';
import { SPELLS, SPELL_ROLL } from '../src/game/spells.js';
import { wildMagicMethods, WILD_SURGES, isWildMage, hasTides } from '../src/game/wild_magic.js';

afterEach(() => { vi.restoreAllMocks(); SPELL_ROLL.bombard = null; });

function wild(lv) {
  const h = makeHero('W', 'human', 'sorcerer', { str: 8, dex: 14, con: 14, int: 10, wis: 10, cha: 16 }, {});
  seedNewHeroProgression(h);
  for (let l = 2; l <= lv; l++) {
    h.level = l;
    if (l === 3) pickSubclass(h, 'wildmagic');
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

/* A cell grid of 1-unit tiles, 30 wide, so gridDist works. */
function fakeGame(heroes, monsters) {
  const log = [];
  return {
    ...wildMagicMethods, heroes, monsters, log, fxNow: 0,
    initiative: { active: true, round: 1, idx: 0 },
    D: { W: 30 }, cellOf: (x, z) => Math.round(z) * 30 + Math.round(x),
    spellDamage(m, dmg) { m.data.hp -= dmg; return dmg; },
    healHero(a, amt) { a.data.hp = Math.min(a.data.maxHp, a.data.hp + amt); },
    applyIncomingDamage(a, dmg) { a.data.hp -= dmg; return dmg; },
    playAbilityFx() {}, fxText() {}, fxLog(m) { log.push(m); }, _v3: () => null,
    refreshHud() {}, refreshAbilityHud() {}
  };
}
const ent = (data, x = 0) => ({ x, z: 0, active: true, data });
const mob = (x, hp = 30) => ent({ name: 'm' + x, hp, maxHp: hp }, x);

describe('the subclass', () => {
  it('has Tides of Chaos as its active and no party heal', () => {
    const sc = SUBCLASSES.sorcerer.wildmagic;
    expect(sc.active.key).toBe('tidesOfChaos');
    expect(sc.passiveKey).toBe('wildMagicSurge');
    const h = wild(3);
    expect(isWildMage(h)).toBe(true);
    expect(hasTides(h)).toBe(true);
    expect(hasCharge(h, 'tidesOfChaos')).toBe(true);
  });

  it('renames an old save’s level-18 milestone', () => {
    const h = {
      name: 'Old', classKey: 'sorcerer', level: 18, subclass: 'wildmagic', progressionVersion: 1,
      stats: { str: 8, dex: 12, con: 14, int: 10, wis: 10, cha: 16 }, features: ['tidesOfChaos'],
      knownSpells: [], resolvedChoices: [], pendingChoices: [], feats: [], skillRanks: {},
      subclassMilestones: [{ level: 18, label: 'Chaos Ascendant', pb: {} }]
    };
    migrateProgression(h);
    expect(h.subclassMilestones[0].label).toBe('Tamed Surge');
  });
});

describe('the surge table', () => {
  it('is a d20: 11 boons, 6 backfires, 3 oddities', () => {
    expect(WILD_SURGES.length).toBe(20);
    const count = k => WILD_SURGES.filter(s => s.kind === k).length;
    expect([count('good'), count('bad'), count('odd')]).toEqual([11, 6, 3]);
  });

  it('every entry resolves without throwing', () => {
    for (const s of WILD_SURGES) {
      const h = ent(wild(8), 0);
      const ally = ent({ name: 'A', hp: 30, maxHp: 30 }, 1);
      const g = fakeGame([h, ally], [mob(1), mob(3)]);
      expect(typeof s.run(g, h)).toBe('string');
    }
  });
});

describe('when a surge happens', () => {
  it('only on a natural 1', () => {
    const h = ent(wild(5));
    const g = fakeGame([h], [mob(2)]);
    const surge = vi.spyOn(g, 'rollWildSurge').mockImplementation(() => null);
    vi.spyOn(Math, 'random').mockReturnValue(0.05);      // d20 → 2
    g.wildMagicAfterSlot(h, SPELLS.fireball);
    expect(surge).not.toHaveBeenCalled();
    Math.random.mockReturnValue(0.0);                    // d20 → 1
    g.wildMagicAfterSlot(h, SPELLS.fireball);
    expect(surge).toHaveBeenCalledTimes(1);
  });

  it('for certain once Tides is spent, and gives Tides back', () => {
    const h = ent(wild(5));
    const g = fakeGame([h], [mob(2)]);
    const surge = vi.spyOn(g, 'rollWildSurge').mockImplementation(() => null);
    spendCharge(h.data, 'tidesOfChaos');
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    g.wildMagicAfterSlot(h, SPELLS.fireball);
    expect(surge).toHaveBeenCalledWith(h, true);
    expect(hasCharge(h.data, 'tidesOfChaos')).toBe(true);
  });

  it('never for cantrips or a sorcerer of another subclass', () => {
    const h = ent(wild(5));
    const g = fakeGame([h], [mob(2)]);
    const surge = vi.spyOn(g, 'rollWildSurge').mockImplementation(() => null);
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    g.wildMagicAfterSlot(h, { level: 0 });
    h.data.subclass = 'draconic';
    g.wildMagicAfterSlot(h, SPELLS.fireball);
    expect(surge).not.toHaveBeenCalled();
  });
});

describe('the milestones', () => {
  it('Tamed Surge turns a backfire into a boon once per long rest', () => {
    const h = ent(wild(18));
    const g = fakeGame([h], [mob(2)]);
    const bad = WILD_SURGES.findIndex(s => s.kind === 'bad');
    /* both Controlled Chaos rolls land on the same backfire */
    vi.spyOn(Math, 'random').mockReturnValue((bad + 0.5) / WILD_SURGES.length);
    expect(g.rollWildSurge(h).kind).toBe('good');
    expect(g.rollWildSurge(h).kind).toBe('bad');
  });

  it('Bend Luck takes a point to turn an attack on an ally', () => {
    const s = ent(wild(6), 0);
    const ally = ent({ name: 'A', hp: 30, maxHp: 30 }, 2);
    const m = mob(3);
    const g = fakeGame([s, ally], [m]);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);     // d4 → 4
    const before = sorceryPointsLeft(s.data);
    expect(g.bendLuckAttack(m, ally, 15, 14, false)).toBe(11);
    expect(sorceryPointsLeft(s.data)).toBe(before - 1);
    /* once a round */
    expect(g.bendLuckAttack(m, ally, 15, 14, false)).toBe(15);
  });

  it('Bend Luck needs level 6', () => {
    const s = ent(wild(5), 0);
    const ally = ent({ name: 'A', hp: 30, maxHp: 30 }, 2);
    const g = fakeGame([s, ally], [mob(3)]);
    expect(g.bendLuckAttack(mob(3), ally, 15, 14, false)).toBe(15);
  });

  it('Tides rerolls the sorcerer’s own failed save', () => {
    const s = ent(wild(5));
    const g = fakeGame([s], []);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);     // the reroll is a 20
    const r = g.wildSaveAfterFail(s, { saved: false, d20: 3, mod: 2, total: 5, dc: 15 });
    expect(r.saved).toBe(true);
    expect(hasCharge(s.data, 'tidesOfChaos')).toBe(false);
  });

  it('Spell Bombardment rolls a top-face die again, once', () => {
    const s = ent(wild(14));
    const g = fakeGame([s], []);
    g.armSpellBombardment(s);
    expect(SPELL_ROLL.bombard).toBeTruthy();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);     // every die lands on 6
    /* the fireball cast's own roll(): 8 sixes + one extra six */
    const foe = mob(1, 999);
    const fg = { ...g, monsters: [foe], fxLog() {}, spellSave: () => false,
      spellDamage: (m, dmg) => { foe.dealt = dmg; return dmg; },
      playAbilityFx: (_h, _k, o) => o && o.onImpact && o.onImpact(),
      markSpellUsed() {}, fxGroundY: () => 0, _v3: (x, y, z) => ({ x, y, z }) };
    s.data.dmgBonus = 0;
    SPELLS.fireball.cast(fg, s, foe, [s], 3, { x: 1, z: 0 });
    expect(foe.dealt).toBe(54);
  });
});
