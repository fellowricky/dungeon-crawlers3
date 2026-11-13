import { describe, it, expect, afterEach } from 'vitest';
import { CLASSES, makeHero, recalc, spendSkillPoint } from '../src/game/srd.js';
import { chargeMax, hasFeature, migrateProgression } from '../src/game/features.js';
import { SAVE_HOOKS, rollSaveDetail } from '../src/game/conditions.js';
import { SPELL_ROLL } from '../src/game/spells.js';
import { classTalentMethods } from '../src/game/class_talents.js';

const STATS = { str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14 };

/* A game with just enough surface for the talent methods: positions on a
   grid (gridDist reads cellOf + D.W), an initiative clock, and a log. */
function fakeGame(heroes = [], monsters = []) {
  const g = {
    D: { W: 64, H: 64 }, heroes, monsters, fxNow: 0, logs: [],
    initiative: { active: true, round: 1, idx: 0, order: [] },
    cellOf(x, z) { return Math.floor(z) * 64 + Math.floor(x); },
    isCurrentActor(e) { return this.initiative.order[this.initiative.idx] === e; },
    fxText() {}, fxLog(t) { this.logs.push(t); }, _v3: () => ({}), playAbilityFx() {},
    refreshAbilityHud() {}, isHostileMonster: () => true,
    ...classTalentMethods
  };
  return g;
}
function hero(cls, x = 5, z = 5, skills = {}) {
  const d = makeHero('H-' + cls, 'human', cls, STATS);
  d.skills = { ...skills };
  recalc(d);
  return { data: d, x: x + 0.5, z: z + 0.5, _side: 'hero' };
}
function mon(x, z, hp = 20) {
  return { data: { name: 'Goblin', hp, maxHp: hp, type: 'humanoid' }, x: x + 0.5, z: z + 0.5, active: true };
}

afterEach(() => { SAVE_HOOKS.bonus = null; SAVE_HOOKS.afterFail = null; SPELL_ROLL.empower = null; });

describe('class talent trees', () => {
  it('every class has five talents, with a temp HP node and class-specific nodes', () => {
    for (const [k, c] of Object.entries(CLASSES)) {
      if (c.internal) continue;
      expect(c.skills.length, k).toBe(5);
      expect(c.skills.filter(s => s.b && s.b.fightTempHp).length, k).toBe(1);
      const keys = new Set(c.skills.map(s => s.key));
      expect(keys.size, k).toBe(5);
    }
  });

  it('ranks in a removed talent are refunded on load', () => {
    const d = makeHero('Old', 'human', 'fighter', STATS);
    d.skills = { brute: 3, weaponMaster: 1 };
    d.pendingSkill = 0;
    recalc(d);
    expect(d.skills.brute).toBeUndefined();
    expect(d.skills.weaponMaster).toBe(1);
    expect(d.pendingSkill).toBe(3);
  });
});

describe('barbarian', () => {
  it('Deep Fury adds one Rage use per rank, up to four', () => {
    const d = makeHero('B', 'human', 'barbarian', STATS);
    const base = chargeMax('rage', d);
    d.skills.deepFury = 3;
    expect(chargeMax('rage', d)).toBe(base + 3);
    d.skills.deepFury = 9;
    expect(chargeMax('rage', d)).toBe(base + 4);
  });

  it('buying Deep Fury adds the use right away', () => {
    const d = makeHero('B', 'human', 'barbarian', STATS);
    d.charges = { rage: 1 }; d.pendingSkill = 1;
    expect(spendSkillPoint(d, 'deepFury')).toBe(true);
    expect(d.charges.rage).toBe(2);
  });

  it('Bloodied Fury adds damage only below half HP, doubled while raging', () => {
    const h = hero('barbarian', 5, 5, { bloodiedFury: 3 });
    const g = fakeGame([h]);
    const prof = { melee: true };
    expect(g.talentAttackDamage(h, mon(6, 5), prof, false)).toBe(0);
    h.data.hp = Math.floor(h.data.maxHp / 2) - 1;
    expect(g.talentAttackDamage(h, mon(6, 5), prof, false)).toBe(3);
    h._effects = { raging: { until: null } };
    expect(g.talentAttackDamage(h, mon(6, 5), prof, false)).toBe(6);
  });
});

describe('monk', () => {
  it('Pressure Points: hits after the first on the same foe this turn deal more', () => {
    const h = hero('monk', 5, 5, { pressurePoints: 2 });
    const g = fakeGame([h]);
    const foe = mon(6, 5), other = mon(5, 6);
    expect(g.talentAttackDamage(h, foe, { melee: true }, false)).toBe(0);
    expect(g.talentAttackDamage(h, foe, { melee: true }, false)).toBe(2);
    expect(g.talentAttackDamage(h, other, { melee: true }, false)).toBe(0);   // new foe restarts
    g.initiative.idx = 1;                                                    // a new turn restarts
    expect(g.talentAttackDamage(h, other, { melee: true }, false)).toBe(0);
  });

  it('Ki Siphon gives back Ki on a kill, once per fight per rank', () => {
    const h = hero('monk', 5, 5, { kiSiphon: 1 });
    h.data.kiMax = 5; h.data.ki = 2;
    const g = fakeGame([h]);
    g.talentCombatStart([h]);
    g.talentOnKill(h, mon(6, 5, 0));
    g.talentOnKill(h, mon(6, 5, 0));
    expect(h.data.ki).toBe(3);
  });

  it('Deflect Missiles is a level 3 feature, and old saves get it', () => {
    const d = makeHero('M', 'human', 'monk', STATS);
    d.level = 4; d.features = (d.features || []).filter(f => f !== 'deflectMissiles');
    d.progressionVersion = 1;
    migrateProgression(d);
    expect(hasFeature(d, 'deflectMissiles')).toBe(true);
    const h = { data: d, x: 5.5, z: 5.5 };
    const g = fakeGame([h]);
    const left = g.deflectMissiles(h, 30);
    expect(left).toBeLessThan(30);
    expect(g.deflectMissiles(h, 30)).toBe(30);   // once per round
  });
});

describe('fighter', () => {
  it('Counterstrike swings back once per round, rank times per fight', () => {
    const h = hero('fighter', 5, 5, { counterstrike: 2 });
    h.data.weaponProfile = { melee: true };
    const m = mon(6, 5);
    const g = fakeGame([h], [m]);
    let swings = 0;
    g.heroAttackRoll = () => { swings++; };
    g.talentCombatStart([h]);
    expect(g.counterstrike(m, h)).toBe(true);
    expect(g.counterstrike(m, h)).toBe(false);   // same round
    g.initiative.round = 2;
    expect(g.counterstrike(m, h)).toBe(true);
    g.initiative.round = 3;
    expect(g.counterstrike(m, h)).toBe(false);   // out of uses
    expect(swings).toBe(2);
  });

  it('Cleave follows a melee kill into an adjacent foe, once per turn', () => {
    const h = hero('fighter', 5, 5, { cleave: 1 });
    h.data.weaponProfile = h.data.lastProfile = { melee: true };
    const dead = mon(6, 5, 0), next = mon(5, 6);
    const g = fakeGame([h], [dead, next]);
    const hit = [];
    g.heroAttackRoll = (a, b) => hit.push(b);
    g.talentOnKill(h, dead);
    g.talentOnKill(h, dead);
    expect(hit).toEqual([next]);
  });
});

describe('bard', () => {
  it('Jarring Chord only fires when a d6 could turn the hit, once per round', () => {
    const b = hero('bard', 5, 5, { jarringChord: 3 });
    const ally = hero('fighter', 8, 5);
    const g = fakeGame([b, ally]);
    g.talentCombatStart([b, ally]);
    const m = mon(9, 5);
    expect(g.jarringChord(m, ally, 25, 15, false)).toBe(25);    // too far over
    expect(g.jarringChord(m, ally, 16, 15, true)).toBe(16);     // crits are untouched
    const after = g.jarringChord(m, ally, 16, 15, false);
    expect(after).toBeLessThan(16);
    expect(g.jarringChord(m, ally, 16, 15, false)).toBe(16);    // reaction spent this round
  });

  it('Rousing Overture: the party gets the best bard rank to hit for a round', () => {
    const b = hero('bard', 5, 5, { rousingOverture: 2 });
    const f = hero('fighter', 6, 5);
    const g = fakeGame([b, f]);
    g.talentCombatStart([b, f]);
    expect(g.talentAttackBonus(f, mon(7, 5), {})).toBe(2);
    g.fxNow = 7;
    expect(g.talentAttackBonus(f, mon(7, 5), {})).toBe(0);
  });
});

describe('paladin and warlock saves', () => {
  it('Aura of Protection adds the rank to saves within 2 tiles', () => {
    const p = hero('paladin', 5, 5, { protectiveAura: 2 });
    const near = hero('wizard', 7, 5), far = hero('rogue', 10, 5);
    const g = fakeGame([p, near, far]);
    g.installTalentSaveHooks();
    expect(g.talentSaveBonus(near)).toBe(2);
    expect(g.talentSaveBonus(p)).toBe(2);
    expect(g.talentSaveBonus(far)).toBe(0);
  });

  it("Dark One's Luck adds 1d10 to a failed save, once per fight per rank", () => {
    const w = hero('warlock', 5, 5, { darkOnesLuck: 1 });
    const g = fakeGame([w]);
    g.talentCombatStart([w]);
    const r1 = g.talentSaveAfterFail(w, { saved: false, total: 10, mod: 2, dc: 14, d20: 8 });
    expect(r1.total).toBeGreaterThan(10);
    const r2 = g.talentSaveAfterFail(w, { saved: false, total: 10, mod: 2, dc: 14, d20: 8 });
    expect(r2.total).toBe(10);
    /* the hook reaches every rolled save */
    SAVE_HOOKS.bonus = () => 100;
    expect(rollSaveDetail(w, 'wis', 50).saved).toBe(true);
  });
});

describe('sorcerer, wizard, warlock', () => {
  it('Empowered Spell is spent once per fight per rank and only lives for that turn', () => {
    const s = hero('sorcerer', 5, 5, { empoweredSpell: 1 });
    const g = fakeGame([s]);
    g.initiative.order = [s];
    g.talentCombatStart([s]);
    g.empowerSpell(s, { level: 1, label: 'Burning Hands' });
    expect(SPELL_ROLL.empower && SPELL_ROLL.empower.live()).toBe(true);
    g.initiative.idx = 1;
    expect(SPELL_ROLL.empower.live()).toBe(false);
    SPELL_ROLL.empower = null;
    g.empowerSpell(s, { level: 1, label: 'Burning Hands' });   // out of uses
    expect(SPELL_ROLL.empower).toBe(null);
    g.empowerSpell(s, { level: 0, label: 'cantrip' });
    expect(SPELL_ROLL.empower).toBe(null);
  });

  it('Storm-Touched adds its rank to fire, lightning and cold only', () => {
    const s = hero('sorcerer', 5, 5, { stormTouched: 2 });
    const g = fakeGame([s]);
    expect(g.stormTouched(s, { dmgType: 'lightning' })).toBe(2);
    expect(g.stormTouched(s, { dmgType: 'necrotic' })).toBe(0);
  });

  it('Arcane Recovery restores the highest spent slot up to the rank', () => {
    const w = hero('wizard', 5, 5, { arcaneRecovery: 2 });
    w.data.slotsMax = { 1: 4, 2: 3, 3: 2 };
    w.data.slots = { 1: 1, 2: 1, 3: 0 };
    const g = fakeGame([w]);
    g.talentsFightEnd();
    expect(w.data.slots).toEqual({ 1: 1, 2: 2, 3: 0 });
  });

  it('Hungering Hex feeds the warlock and moves the Hex to the nearest foe', () => {
    const w = hero('warlock', 5, 5, { hungeringHex: 2 });
    const dead = mon(8, 5, 0), near = mon(9, 5), far = mon(20, 20);
    dead._effects = { hexMarked: { source: w, until: 999 } };
    w.conc = { key: 'hex', targets: [{ e: dead, key: 'hexMarked' }] };
    const g = fakeGame([w], [dead, near, far]);
    g.hungeringHex(dead);
    expect(w.data.tempHp).toBe(4);
    expect(near._effects && near._effects.hexMarked).toBeTruthy();
    expect(w.conc.targets[0].e).toBe(near);
  });
});
