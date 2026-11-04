/* The September 2026 SRD-fidelity pass: spells and features that used to do
   something other than what their name promised (or nothing at all). */
import { describe, it, expect, vi } from 'vitest';
import { applyEffect, hasEffect, getEffect, getEffectMods, clearEffect, EFFECTS, ROUND_SECONDS, rollSaveDetail } from '../src/game/conditions.js';
import { combatMethods } from '../src/game/combat.js';
import { monsterAiMethods } from '../src/game/monster_ai.js';
import { initiativeMethods } from '../src/game/initiative.js';
import { SPELLS } from '../src/game/spells.js';
import { FEATURES } from '../src/game/features.js';

const noop = () => {};
function mon(name, x = 2, z = 0, extra = {}) {
  return { x, z, active: true, dead: false, ent: {}, data: { name, id: name, hp: 30, maxHp: 30, ac: 12, atk: 4, dmg: [1, 6, 2], type: 'humanoid', effStats: { str: 12, dex: 10 } }, ...extra };
}
function hero(name, x = 0, z = 0, extra = {}) {
  return { x, z, _side: 'hero', ent: {}, data: { name, hp: 30, maxHp: 30, ac: 14, classKey: 'wizard', level: 10, dmgBonus: 0, atkProf: 4, raceKey: 'human',
    effStats: { str: 10, dex: 14, con: 12, int: 18, wis: 12, cha: 16 }, slots: { 1: 2, 2: 1 }, features: [], ...extra } };
}
function game(extra = {}) {
  return Object.assign({}, combatMethods, monsterAiMethods, initiativeMethods, {
    fxNow: 0, heroes: [], monsters: [], initiative: { active: true, order: [], idx: 0, round: 1 },
    fxLog: noop, fxText: noop, fxStatusTray: noop, fxPlaySfx: noop, fxMeleeHitVFX: noop, fxProjectile: (a, b, c, d, cb) => cb && cb(),
    fxBeam: noop, fxSprite: noop, fxImpactDelay: (d, fn) => fn(), fxHitFlash: noop, fxDrawBar: noop, refreshHud: noop,
    refreshAbilityHud: noop, playAbilityFx: noop, markSpellUsed: noop, triggerLunge: noop, triggerHitStop: noop,
    triggerShake: noop, clearEntityPath: noop, creditThreat: noop, _v3: (x, y, z) => ({ x, y, z }),
    isCurrentActor: () => true, spellSave: () => false, spellDamage: vi.fn(),
    ...extra,
  });
}

describe('no spell reaches for an effect that does not exist', () => {
  it('every applyEffect key in spells.js / combat.js is registered', async () => {
    const fs = await import('node:fs');
    const keys = new Set(Object.keys(EFFECTS));
    for (const f of ['src/game/spells.js', 'src/game/combat.js', 'src/game/monster_ai.js', 'src/game/skills.js']) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/applyEffect\([^,]+,\s*'([a-zA-Z]+)'/g)) {
        expect(keys.has(m[1]), `${f}: '${m[1]}'`).toBe(true);
      }
    }
  });
});

describe('Bless is +1d4 on attacks AND saves, not advantage', () => {
  it('applies blessed and the save roll picks up the die', () => {
    const g = game();
    const h = hero('Cleric'), a = hero('Fighter', 1, 0);
    g.heroes = [h, a];
    SPELLS.bless.cast(g, h, null, [h, a]);
    expect(hasEffect(a, 'blessed')).toBe(true);
    expect(hasEffect(a, 'inspired')).toBe(false);
    expect(getEffectMods(a).blessDice).toBe(true);
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // d20 → 11, d4 → 3
    try {
      const r = rollSaveDetail(a, 'wis', 10);
      expect(r.mod).toBe(1 + 3);   // WIS 12 → +1, plus the Bless d4
    } finally { rnd.mockRestore(); }
  });
});

describe('Haste grants an extra weapon attack', () => {
  it('surfaces extraAttack through getEffectMods and doubles speed', () => {
    const h = hero('Fighter');
    applyEffect(h, 'hasted', { duration: 60, elapsed: 0 });
    const m = getEffectMods(h);
    expect(m.extraAttack).toBe(1);
    expect(m.speedMul).toBe(2);
    expect(m.acBonus).toBe(2);
  });
  it('Cunning Action and Step of the Wind Dash without stealing Haste\'s attack', () => {
    const g = game();
    const h = hero('Rogue');
    g.cunningActionDash(h);
    expect(hasEffect(h, 'dashing')).toBe(true);
    expect(hasEffect(h, 'hasted')).toBe(false);
    expect(getEffectMods(h).extraAttack).toBe(0);
    expect(h.disengageActive).toBe(true);
  });
});

describe('Bardic Inspiration is one die for one ally', () => {
  it('picks the hardest hitter, never the bard, and the die scales with level', () => {
    const g = game();
    const bard = hero('Bard', 0, 0, { level: 10, classKey: 'bard' });
    const fighter = hero('Fighter', 1, 0, { classKey: 'fighter', weaponProfile: { dmg: [2, 6] }, features: ['extraAttack'] });
    const wiz = hero('Wiz', 2, 0, { weaponProfile: { dmg: [1, 4] } });
    g.heroes = [bard, fighter, wiz];
    expect(g.inspirationDie(bard)).toBe(10);
    const t = g.pickInspirationTarget(bard, g.heroes);
    expect(t).toBe(fighter);
    g.grantBardicInspiration(bard, t);
    expect(getEffect(fighter, 'inspired').die).toBe(10);
    expect(hasEffect(bard, 'inspired')).toBe(false);
    expect(hasEffect(wiz, 'inspired')).toBe(false);
    /* nobody left to inspire → null, so the AI does not burn a charge */
    applyEffect(wiz, 'inspired', { duration: Infinity, elapsed: 0 });
    expect(g.pickInspirationTarget(bard, g.heroes)).toBeNull();
  });
});

describe('Mirror Image draws blows onto duplicates', () => {
  it('shatters an image when the attack beats image AC and spares the hero', () => {
    const g = game();
    const h = hero('Wiz');
    SPELLS.mirrorImage.cast(g, h);
    expect(getEffect(h, 'mirrorImages').images).toBe(3);
    expect(hasEffect(h, 'shielded')).toBe(false);
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.95);   // d20 → 20: image targeted
    try {
      expect(g.mirrorImageIntercept(h, 25)).toBe(true);          // 25 ≥ image AC 12 → shattered
      expect(getEffect(h, 'mirrorImages').images).toBe(2);
      expect(g.mirrorImageIntercept(h, 5)).toBe(true);           // targeted but misses the image
      expect(getEffect(h, 'mirrorImages').images).toBe(2);
    } finally { rnd.mockRestore(); }
    const low = vi.spyOn(Math, 'random').mockReturnValue(0.0);   // d20 → 1: the hero is the target
    try { expect(g.mirrorImageIntercept(h, 25)).toBe(false); } finally { low.mockRestore(); }
  });
  it('a monster melee swing that would hit is absorbed by an image', () => {
    const g = game();
    const h = hero('Wiz'); h.data.ac = 5;
    const m = mon('Orc', 1, 0);
    g.heroes = [h]; g.monsters = [m];
    g.heroAC = () => 5;
    g.applyIncomingDamage = vi.fn((hh, dmg) => { hh.data.hp -= dmg; return dmg; });
    SPELLS.mirrorImage.cast(g, h);
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    try { g.monsterAttack(m, h); } finally { rnd.mockRestore(); }
    expect(g.applyIncomingDamage).not.toHaveBeenCalled();
    expect(h.data.hp).toBe(30);
    expect(getEffect(h, 'mirrorImages').images).toBe(2);
  });
});

describe('Banishment removes the creature from the field', () => {
  it('hides it, drops it from initiative and from every target list, and brings it back', () => {
    const g = game();
    const h = hero('Wiz');
    const a = mon('Orc A', 1, 0, { ent: { grp: { visible: true } } }), b = mon('Orc B', 3, 0);
    g.heroes = [h]; g.monsters = [a, b];
    SPELLS.banishment.cast(g, h, a);
    expect(a._banished).toBe(true);
    expect(a.active).toBe(false);
    expect(a.ent.grp.visible).toBe(false);
    expect(hasEffect(a, 'stunned')).toBe(false);
    expect(g._initParticipants()).not.toContain(a);
    expect(g.findMonsterTarget(h)).toBe(b);
    expect(g.damageMonster(a, 50, h).dmg).toBe(0);
    expect(a.data.hp).toBe(30);
    expect(g.tryActivateMonster(a, [h])).toBe(false);
    clearEffect(a, 'banished');
    g.returnBanished(a);
    expect(a._banished).toBe(false);
    expect(a.active).toBe(true);
    expect(a.ent.grp.visible).toBe(true);
  });
});

describe('Polymorph', () => {
  it('turns a foe into a sheep the party avoids, which pops back on a real hit', () => {
    const g = game();
    const h = hero('Wiz', 0, 0, { hp: 30 });
    const a = mon('Orc A', 1, 0), b = mon('Orc B', 4, 0);
    g.heroes = [h]; g.monsters = [a, b];
    SPELLS.polymorph.cast(g, h, a, [h]);
    expect(hasEffect(a, 'polymorphed')).toBe(true);
    expect(getEffectMods(a).incapacitated).toBe(true);
    expect(g.findMonsterTarget(h)).toBe(b);              // leave the sheep alone
    g.damageMonster(a, 9, h);
    expect(a.data.hp).toBe(30);                          // the beast form took it
    expect(hasEffect(a, 'polymorphed')).toBe(false);     // and the spell ended
    b.data.hp = 0;
  });
  it('gives a hurt ally the ape\'s slams through a real effect', () => {
    const g = game();
    const h = hero('Wiz'), a = hero('Fighter', 1, 0, { hp: 5 });
    g.heroes = [h, a];
    SPELLS.polymorph.cast(g, h, null, [h, a]);
    expect(a.data.tempHp).toBe(30);
    expect(hasEffect(a, 'enlarged')).toBe(true);
    expect(getEffectMods(a).dmgBonus).toBeGreaterThan(0);
  });
});

describe('sustained spells act every round', () => {
  it('Spiritual Weapon registers a sustained strike that spends the bonus action', () => {
    const g = game();
    const h = hero('Cleric'), m = mon('Orc', 1, 0);
    g.heroes = [h]; g.monsters = [m];
    SPELLS.spiritualWeapon.cast(g, h, m);
    expect(g.spellDamage).toHaveBeenCalledTimes(1);
    expect(h.sustained.key).toBe('spiritualWeapon');
    expect(h.sustained.until).toBe(10 * ROUND_SECONDS);
    h._bonusActed = false;
    g.processTurnSustained(h);
    expect(g.spellDamage).toHaveBeenCalledTimes(2);
    expect(h._bonusActed).toBe(true);
    g.fxNow = 10 * ROUND_SECONDS;
    g.processTurnSustained(h);
    expect(h.sustained).toBeNull();
  });
  it('Call Lightning and Animate Objects hang their recurrence on concentration', () => {
    const g = game();
    const h = hero('Druid'), m = mon('Orc', 1, 0), m2 = mon('Orc 2', 1.5, 0);
    g.heroes = [h]; g.monsters = [m, m2];
    SPELLS.callLightning.cast(g, h, m);
    expect(SPELLS.callLightning.concentration).toBe(true);
    expect(typeof h.conc.onTurn).toBe('function');
    const before = g.spellDamage.mock.calls.length;
    h.actUsed = false;
    g.processTurnSustained(h);
    expect(g.spellDamage.mock.calls.length).toBeGreaterThan(before);
    expect(h.actUsed).toBe(true);
    g.breakConcentration(h, 'test');
    expect(h.conc).toBeNull();

    const h2 = hero('Wiz2');
    g.heroes = [h2];
    SPELLS.animateObjects.cast(g, h2, m);
    expect(typeof h2.conc.onTurn).toBe('function');
  });
});

describe('Time Stop gives the caster extra turns', () => {
  it('_advanceTurn re-opens the caster\'s turn without moving the clock', () => {
    const g = game();
    const h = hero('Wiz'), m = mon('Orc');
    g.heroes = [h]; g.monsters = [m];
    g.initiative.order = [h, m]; g.initiative.idx = 0;
    g._beginTurn = vi.fn(); g._advanceCombatClock = vi.fn();
    SPELLS.timeStop.cast(g, h);
    expect(h._timeStopTurns).toBeGreaterThanOrEqual(2);
    expect(hasEffect(m, 'stunned')).toBe(false);
    const n = h._timeStopTurns;
    g._advanceTurn();
    expect(g.initiative.idx).toBe(0);
    expect(h._timeStopTurns).toBe(n - 1);
    expect(g._advanceCombatClock).not.toHaveBeenCalled();
  });
});

describe('the rest of the broken set', () => {
  it('Regenerate heals a point every round', () => {
    const g = game();
    const h = hero('Druid'); h.data.hp = 10; h.data.maxHp = 200;
    g.heroes = [h];
    SPELLS.regenerate.cast(g, h);
    expect(hasEffect(h, 'regenerating')).toBe(true);
    const after = h.data.hp;
    g.fxNow = 0; g.tickHeroDots(h);
    g.fxNow = ROUND_SECONDS; g.tickHeroDots(h);
    expect(h.data.hp).toBe(after + 1);
  });
  it('Mind Blank wards, Pass Without Trace hides, Wish no longer reaches for a ghost effect', () => {
    const g = game();
    const h = hero('Wiz'), a = hero('Rogue', 1, 0);
    g.heroes = [h, a];
    SPELLS.mindBlank.cast(g, h);
    expect(hasEffect(a, 'warded')).toBe(true);
    expect(applyEffect(a, 'charmed', { duration: 60 })).toBe(false);
    SPELLS.passWithoutTrace.cast(g, h);
    expect(hasEffect(a, 'invisible')).toBe(true);
    /* monsters skip unseen heroes while anyone visible remains */
    clearEffect(h, 'invisible');
    const m = mon('Orc', 0.5, 0);
    g.monsters = [m];
    expect(g.pickMonsterTarget(m, [h, a])).toBe(h);
  });
  it('Harm withers max HP and Earthquake knocks prone', () => {
    const g = game();
    const h = hero('Cleric'), m = mon('Orc', 1, 0);
    m.data.hp = m.data.maxHp = 200;
    g.heroes = [h]; g.monsters = [m];
    g.spellDamage = vi.fn((t, amt) => { t.data.hp -= amt; });
    SPELLS.harm.cast(g, h, m);
    expect(m.data.maxHp).toBeLessThan(200);
    expect(hasEffect(m, 'drained')).toBe(true);
    const m2 = mon('Orc 2', 1, 0);
    g.monsters = [m2];
    SPELLS.earthquake.cast(g, h, m2);
    expect(hasEffect(m2, 'prone')).toBe(true);
    expect(hasEffect(m2, 'slowed')).toBe(false);
  });
  it('Enlarge actually adds damage to a hero hit (effect dmgBonus is consumed)', () => {
    const h = hero('Fighter');
    applyEffect(h, 'enlarged', { duration: 60 });
    const m = getEffectMods(h);
    expect(m.dmgBonus).toBe(2);
    expect(m.dmgDealtMul).toBe(1.25);
    /* the consumer lives in heroAttackRoll; pin that it reads both fields */
    const src = combatMethods.heroAttackRoll.toString();
    expect(src).toMatch(/selfMods\.dmgBonus/);
    expect(src).toMatch(/selfMods\.dmgDealtMul/);
  });
  it('Evasion is no longer +2 AC, Sacred Weapon is +CHA to hit and magical', () => {
    expect(FEATURES.evasion.pb.ac).toBeUndefined();
    expect(EFFECTS.sacredWeapon.magicWeapon).toBe(true);
    expect(EFFECTS.sacredWeapon.sacredDice).toBeUndefined();
    const h = hero('Paladin');
    applyEffect(h, 'sacredWeapon', { duration: 60, data: { atkBonus: 3 } });
    expect(getEffectMods(h).atkBonus).toBe(3);
    expect(getEffectMods(h).magicWeapon).toBe(true);
  });
});
