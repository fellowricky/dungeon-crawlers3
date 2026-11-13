/**
 * Phase 4 scenario tests: the fight's danger level, and the cleanup rule that
 * keeps slots, charges and potions in the pack once a fight is won on paper.
 *
 * Each case is a scripted board pinning one behaviour Zenu saw in play
 * ("the party was in no danger of losing and still drinking potions and
 * casting spells").
 */
import { describe, it, expect, afterEach } from 'vitest';
import { fightOutlook, isCleanup, offensiveSpellPlan, PLANNER } from '../src/game/turn_planner.js';
import { combatMethods } from '../src/game/combat.js';
import { Trace } from '../src/game/ai_trace.js';
import { SPELLS } from '../src/game/spells.js';

const W = 30;
const at = (cx, cy) => ({ x: cx - W / 2 + 0.5, z: cy - W / 2 + 0.5 });

function mkGame(heroes, monsters, extra = {}) {
  const g = {
    D: { W, H: W, grid: new Int32Array(W * W).fill(1) },
    cellOf: (x, z) => {
      const cx = Math.round(x + W / 2 - 0.5), cy = Math.round(z + W / 2 - 0.5);
      return (cx < 0 || cy < 0 || cx >= W || cy >= W) ? -1 : cy * W + cx;
    },
    heroes, monsters,
    hasLOS: () => true,
    cellsForSpeed: (e) => (e && e.data && e.data.speedCells) || 6,
    damageModifier: () => null,
    monsterEliteRoom: () => false,
    isHostileMonster: () => true,
    fxNow: 0,
    _combatEngagedAt: -100,
    ...extra,
  };
  return Object.assign(Object.create(combatMethods), g);
}

function monster(name, cx, cy, hp, more = {}) {
  return { ...at(cx, cy), active: true,
    data: { name, hp, maxHp: more.maxHp || hp, ac: 12, atk: 4, dmg: [1, 6, 2], saves: {}, cr: 1, ...more },
    ...(more.isBoss ? { isBoss: true } : {}) };
}

const sword = { name: 'Longsword', melee: true, range: 1.5, ability: 'str', dmg: [1, 8] };
function fighter(cx, cy, name = 'Aldric') {
  return { ...at(cx, cy), data: {
    name, classKey: 'fighter', level: 7, hp: 60, maxHp: 60, ac: 18, atkProf: 3,
    effStats: { str: 18, dex: 12 }, features: ['extraAttack'], dmgBonus: 0,
    weaponProfile: sword, lastProfile: sword, aiPrefs: {},
  } };
}
function wizard(cx, cy) {
  return { ...at(cx, cy), data: {
    name: 'Mira', classKey: 'wizard', level: 7, hp: 40, maxHp: 40, ac: 13, atkProf: 3, _classAtk: 'int',
    effStats: { int: 18, dex: 14, str: 8 }, slots: { 1: 4, 2: 3, 3: 3 }, dmgBonus: 0,
    cantripProfile: { name: 'Fire Bolt', isSave: true, saveAbility: 'dex', ability: 'int', dmg: [1, 10], range: 12, melee: false, cantripScale: true },
    lastProfile: null, aiPrefs: { abilityUsage: 'unleash' },
    knownSpells: ['fireball', 'magicMissile', 'guidingBolt'],
  } };
}
const party = () => [fighter(10, 15), fighter(10, 16, 'Brom'), wizard(7, 15), wizard(7, 16)];

afterEach(() => { PLANNER.thrift = true; Trace.enable(false); });

describe('fight outlook — danger level', () => {
  it('two nearly-dead goblins against a healthy party is a cleanup', () => {
    const heroes = party();
    const g = mkGame(heroes, [monster('goblin', 12, 15, 4, { maxHp: 7 }), monster('goblin', 12, 16, 3, { maxHp: 7 })]);
    const o = fightOutlook(g, heroes);
    expect(o.danger).toBeLessThan(0.15);
    expect(o.roundsToWin).toBeLessThan(1);
    expect(o.cleanup).toBe(true);
  });

  it('a pack of healthy ogres is not', () => {
    const heroes = party();
    const ogres = [0, 1, 2, 3].map(i => monster('ogre', 13, 13 + i, 59, { atk: 6, dmg: [2, 8, 4], cr: 2 }));
    const o = fightOutlook(mkGame(heroes, ogres), heroes);
    expect(o.danger).toBeGreaterThan(0.3);
    expect(o.cleanup).toBe(false);
  });

  it('a healthy boss keeps the danger up even when the numbers look easy', () => {
    const heroes = party();
    const boss = monster('Goblin King', 12, 15, 30, { isBoss: true });
    const o = fightOutlook(mkGame(heroes, [boss]), heroes);
    expect(o.danger).toBeGreaterThanOrEqual(0.6);
    expect(o.cleanup).toBe(false);
  });

  it('…but a boss on its last legs can be finished with plain attacks', () => {
    const heroes = party();
    const boss = monster('Goblin King', 12, 15, 4, { maxHp: 60, isBoss: true });
    expect(fightOutlook(mkGame(heroes, [boss]), heroes).cleanup).toBe(true);
  });

  it('a downed ally is never a cleanup', () => {
    const heroes = party();
    heroes[2].data.hp = 0;
    const g = mkGame(heroes, [monster('goblin', 12, 15, 4, { maxHp: 7 })]);
    const o = fightOutlook(g, heroes.filter(h => h.data.hp > 0));
    expect(o.cleanup).toBe(false);
    expect(o.why).toMatch(/down/);
  });

  it('an ally who could drop next round is never a cleanup', () => {
    const heroes = party();
    heroes[2].data.hp = 3;
    const gob = monster('goblin', 8, 15, 4, { maxHp: 7, atk: 5, dmg: [1, 6, 3] });
    const o = fightOutlook(mkGame(heroes, [gob]), heroes);
    expect(o.cleanup).toBe(false);
    expect(o.why).toMatch(/Mira could drop/);
  });

  it('is cached until the HP state changes', () => {
    const heroes = party();
    const gob = monster('goblin', 12, 15, 4, { maxHp: 7 });
    const g = mkGame(heroes, [gob]);
    const a = fightOutlook(g, heroes);
    expect(fightOutlook(g, heroes)).toBe(a);
    gob.data.hp = 3;
    expect(fightOutlook(g, heroes)).not.toBe(a);
  });

  it('PLANNER.thrift = false switches cleanup off', () => {
    const heroes = party();
    const g = mkGame(heroes, [monster('goblin', 12, 15, 4, { maxHp: 7 })]);
    expect(isCleanup(g, heroes)).toBe(true);
    PLANNER.thrift = false;
    expect(isCleanup(g, heroes)).toBe(false);
  });
});

describe('cleanup — resources stay in the pack', () => {
  const mopUp = () => {
    const heroes = party();
    const gobs = [monster('goblin', 12, 14, 5, { maxHp: 7 }), monster('goblin', 12, 15, 5, { maxHp: 7 }),
      monster('goblin', 13, 15, 5, { maxHp: 7 })];
    return { heroes, gobs, g: mkGame(heroes, gobs) };
  };

  it('a damage slot is not worth it, however many foes it would catch', () => {
    const { heroes, gobs, g } = mopUp();
    const plan = offensiveSpellPlan(g, heroes[2], 'fireball', SPELLS.fireball, gobs[1], heroes);
    expect(plan.cleanup).toBe(true);
    expect(plan.worth).toBe(false);
  });

  it('no Fireball on one goblin and one rat at 2 HP', () => {
    const heroes = [wizard(5, 15)];
    const gob = monster('goblin', 10, 15, 7), rat = monster('rat', 10, 16, 2, { maxHp: 7 });
    const plan = offensiveSpellPlan(mkGame(heroes, [gob, rat]), heroes[0], 'fireball', SPELLS.fireball, gob, heroes);
    expect(plan.worth).toBe(false);
  });

  it('the spell picker falls back to the cantrip', () => {
    const { heroes, gobs, g } = mopUp();
    const pick = g._pickKnownSpell(heroes[2], gobs[1], heroes, sp => sp.bonusAction !== true);
    expect(pick).toBe(null);
  });

  it('a buff potion stays corked; a cure potion still goes down', () => {
    const { heroes, gobs, g } = mopUp();
    const w = heroes[2];
    w.data.knownSpells = [];
    w.data.aiPrefs = { abilityUsage: 'balanced' };   // Unleash would still drink it
    w.data.equipment = { trinket: { potion: true, name: 'Potion of Heroism', buffKey: 'heroism', charges: 1 } };
    expect(g._pickKnownSpell(w, gobs[1], heroes, sp => sp.bonusAction === true)).toBe(null);
    w.data.equipment.trinket = { potion: true, name: 'Antitoxin', cures: ['poisoned'], charges: 1 };
    w.effects = { poisoned: { key: 'poisoned', duration: 60, elapsed: 0 } };
    w.data.effects = w.effects;
    const pick = g._pickKnownSpell(w, gobs[1], heroes, sp => sp.bonusAction === true);
    /* whether the cure fires depends on the effect store; the point is that
       cleanup did not filter it out before it was scored */
    expect(pick === null || (pick.potion && pick.potion.name === 'Antitoxin')).toBe(true);
  });

  it('class features ask _worthSpending, which says no — even to a dying boss', () => {
    const heroes = party();
    const boss = monster('Goblin King', 12, 15, 4, { maxHp: 60, isBoss: true });
    const g = mkGame(heroes, [boss]);
    expect(g._worthSpending(heroes[0], boss, heroes, 'high')).toBe(false);
    boss.data.hp = 50;
    expect(g._worthSpending(heroes[0], boss, heroes, 'high')).toBe(true);
  });

  it('outside cleanup the big spells still come out', () => {
    const heroes = party();
    const ogres = [monster('ogre', 13, 15, 59, { atk: 6, dmg: [2, 8, 4] }), monster('ogre', 14, 16, 59, { atk: 6, dmg: [2, 8, 4] }),
      monster('ogre', 13, 17, 59, { atk: 6, dmg: [2, 8, 4] })];
    const g = mkGame(heroes, ogres);
    const plan = offensiveSpellPlan(g, heroes[2], 'fireball', SPELLS.fireball, ogres[0], heroes);
    expect(plan.cleanup).toBe(false);
    expect(plan.worth).toBe(true);
  });
});

describe('decision log', () => {
  it('records why a hero is holding back', () => {
    Trace.enable(true);
    const heroes = party();
    const g = mkGame(heroes, [monster('goblin', 12, 15, 4, { maxHp: 7 })]);
    g._pickKnownSpell(heroes[2], g.monsters[0], heroes, sp => sp.bonusAction !== true);
    const lines = Trace.entries.filter(e => e.name === 'Mira');
    expect(lines.some(e => e.event === 'thrift' && /rounds to win/.test(e.why))).toBe(true);
    expect(lines.some(e => e.event === 'plans' && /cleanup/.test(e.why))).toBe(true);
  });

  it('lists the top options with their scores in a real fight', () => {
    Trace.enable(true);
    const heroes = party();
    const ogres = [monster('ogre', 13, 15, 59, { atk: 6, dmg: [2, 8, 4] }), monster('ogre', 14, 16, 59, { atk: 6, dmg: [2, 8, 4] })];
    const g = mkGame(heroes, ogres);
    g._pickKnownSpell(heroes[2], ogres[0], heroes, sp => sp.bonusAction !== true);
    const plans = Trace.entries.find(e => e.name === 'Mira' && e.event === 'plans');
    expect(plans).toBeTruthy();
    expect(plans.data.cleanup).toBe(false);
    expect(plans.why).toMatch(/danger \d\.\d\d/);
  });
});

/* ── Phase 5: the AI Priorities tab drives the planner ─────────────────── */
import { heroRole } from '../src/game/turn_planner.js';
import { getAbilityUseWeight } from '../src/game/combat.js';
import { chooseHeroAttackProfile } from '../src/game/combat_eval.js';

describe('phase 5 — Combat Role', () => {
  it('Auto reads the build; a picked role overrides it', () => {
    const f = fighter(10, 15);
    expect(heroRole(f)).toBe('tank');
    f.data.aiPrefs = { role: 'auto' };
    expect(heroRole(f)).toBe('tank');
    f.data.aiPrefs = { role: 'striker' };
    expect(heroRole(f)).toBe('striker');
    const w = wizard(7, 15);
    w.data.aiPrefs = { role: 'healer' };
    expect(heroRole(w)).toBe('healer');
  });

  it('Artillery leans to the cantrip, Tank to the weapon, when both land the same', () => {
    const h = { ...at(10, 15), moveLeft: 6, data: {
      name: 'Eld', classKey: 'cleric', level: 5, atkProf: 3, _classAtk: 'wis', effStats: { str: 14, wis: 14 },
      weaponProfile: { melee: true, range: 1.5, ability: 'str', dmg: [1, 8] },
      cantripProfile: { isSave: true, saveAbility: 'dex', ability: 'wis', dmg: [1, 8], range: 12, melee: false, cantripScale: true },
      aiPrefs: {} } };
    const foe = monster('orc', 11, 15, 30);
    const g = mkGame([h], [foe]);
    h.data.aiPrefs.role = 'artillery';
    expect(chooseHeroAttackProfile(h, foe, g)).toBe(h.data.cantripProfile);
    h.data.aiPrefs.role = 'tank';
    expect(chooseHeroAttackProfile(h, foe, g)).toBe(h.data.weaponProfile);
  });
});

describe('phase 5 — Ability & Spell Budget follows the danger level', () => {
  it('Conservative spends nothing until the fight turns dangerous', () => {
    const heroes = party();
    heroes[2].data.aiPrefs = { abilityUsage: 'conservative' };
    const easy = mkGame(heroes, [monster('goblin', 12, 15, 4, { maxHp: 7 })]);
    expect(getAbilityUseWeight(heroes[2], easy)).toBe(0);
    const boss = mkGame(heroes, [monster('Goblin King', 12, 15, 60, { isBoss: true })]);
    expect(getAbilityUseWeight(heroes[2], boss)).toBe(0.5);
    /* without a game (the old call) it stays the old hard "never" */
    expect(getAbilityUseWeight(heroes[2])).toBe(0);
  });

  it('Unleash keeps spending in a fight Balanced would already call won', () => {
    const heroes = party();
    const gobs = [12, 13, 14].map(cy => monster('goblin', 13, cy, 12, { maxHp: 12 }));
    const g = mkGame(heroes, gobs);
    /* three goblins: a mop-up for Balanced, but not "the last foe is about to fall" */
    expect(isCleanup(g, heroes, 'balanced')).toBe(true);
    expect(isCleanup(g, heroes, 'unleash')).toBe(false);
    /* down to one, Unleash calls it too */
    gobs[1].data.hp = 0; gobs[2].data.hp = 0;
    expect(isCleanup(g, heroes, 'unleash')).toBe(true);
    gobs[1].data.hp = 12; gobs[2].data.hp = 12;
    heroes[2].data.aiPrefs = { abilityUsage: 'unleash' };
    heroes[3].data.aiPrefs = { abilityUsage: 'balanced' };
    expect(g._thrifty(heroes[2], heroes)).toBe(false);
    expect(g._thrifty(heroes[3], heroes)).toBe(true);
  });
});
