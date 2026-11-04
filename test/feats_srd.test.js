/* Feats and fighting styles do what the SRD says, not a stat bump wearing
   the name (September 2026 pass). */
import { describe, it, expect, vi } from 'vitest';
import { applyEffect, hasEffect, getEffectMods, rollSaveDetail, EFFECTS, ROUND_SECONDS } from '../src/game/conditions.js';
import { combatMethods } from '../src/game/combat.js';
import { monsterAiMethods } from '../src/game/monster_ai.js';
import { turnEngineMethods } from '../src/game/turn_engine.js';
import {
  FEATS, FIGHTING_STYLES, styleAttackBonus, styleDamageBonus, styleRerollsLowDice,
  featBonusActionAttack, featPowerAttackAvailable, featIncomingDamage, featInitiativeBonus,
  featSaveProficiencies, hasShieldEquipped, featureBonuses
} from '../src/game/features.js';
import { heroDamage, makeHero, recalc } from '../src/game/srd.js';

const noop = () => {};
const sword  = { slot: 'weapon', name: 'Longsword', dmg: [1, 8], melee: true, baseKey: 'Longsword' };
const bow    = { slot: 'weapon', name: 'Longbow', dmg: [1, 8], melee: false, range: 8, visualWeapon: 'ranged/bow' };
const xbow   = { slot: 'weapon', name: 'Crossbow', dmg: [1, 8], melee: false, range: 8, visualWeapon: 'ranged/crossbow' };
const maul   = { slot: 'weapon', name: 'Maul', dmg: [2, 6], melee: true, twoHanded: true, heavy: true };
const spear  = { slot: 'weapon', name: 'Halberd', dmg: [1, 10], melee: true, twoHanded: true, heavy: true, visualWeapon: 'polearm/halberd' };
const rapier = { slot: 'weapon', name: 'Rapier', dmg: [1, 8], melee: true, finesse: true };
const shield = { slot: 'shield', name: 'Shield', acBase: 2 };

function heroData(over = {}) {
  return { name: 'H', level: 5, classKey: 'fighter', raceKey: 'human', dmgBonus: 0, atkProf: 3, hp: 40, maxHp: 40,
    effStats: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10 }, feats: [], features: [], equipment: {}, ...over };
}
const prof = (item, extra = {}) => ({ source: 'weapon', melee: item.melee !== false, dmg: item.dmg, ability: 'str', thrown: false,
  twoHanded: !!item.twoHanded, heavy: !!item.heavy, visualWeapon: item.visualWeapon || null, ...extra });

describe('fighting styles are gated on the attack actually being made', () => {
  it('Archery only helps ranged weapons; Dueling only a lone one-hander; GWF only two-handers', () => {
    const d = heroData({ fightingStyle: 'archery', equipment: { weapon: bow } });
    expect(styleAttackBonus(d, prof(bow))).toBe(2);
    expect(styleAttackBonus(d, prof(sword))).toBe(0);
    expect(styleAttackBonus(d, { source: 'cantrip', melee: false })).toBe(0);

    const du = heroData({ fightingStyle: 'dueling', equipment: { weapon: sword } });
    expect(styleDamageBonus(du, prof(sword))).toBe(2);
    du.equipment.offhand = { ...sword };                       // two blades: no Dueling
    expect(styleDamageBonus(du, prof(sword))).toBe(0);
    du.equipment = { weapon: maul };
    expect(styleDamageBonus(du, prof(maul))).toBe(0);

    const gw = heroData({ fightingStyle: 'greatWeapon', equipment: { weapon: maul } });
    expect(styleRerollsLowDice(gw, prof(maul))).toBe(true);
    expect(styleRerollsLowDice(gw, prof(sword))).toBe(false);
    /* and none of them leaks into the flat pb aggregate any more */
    for (const k of ['archery', 'dueling', 'greatWeapon', 'twoWeapon', 'protection']) {
      expect(featureBonuses(heroData({ fightingStyle: k })).atk || 0).toBe(0);
      expect(featureBonuses(heroData({ fightingStyle: k })).dmg || 0).toBe(0);
    }
  });

  it('Great Weapon Fighting rerolls 1s and 2s in heroDamage', () => {
    const gw = heroData({ fightingStyle: 'greatWeapon', equipment: { weapon: maul } });
    /* every die comes up 1 first, 6 on the reroll → 2d6 = 12 + STR 3 */
    const seq = [0, 0.99, 0, 0.99];
    const rnd = vi.spyOn(Math, 'random').mockImplementation(() => seq.shift() ?? 0.99);
    try { expect(heroDamage(gw, false, prof(maul))).toBe(12 + 3); } finally { rnd.mockRestore(); }
    const plain = heroData({ equipment: { weapon: maul } });
    const rnd2 = vi.spyOn(Math, 'random').mockReturnValue(0);
    try { expect(heroDamage(plain, false, prof(maul))).toBe(2 + 3); } finally { rnd2.mockRestore(); }
  });

  it('Two-Weapon Fighting lets the off hand add its ability modifier', () => {
    const a = makeHero('A', 'human', 'fighter', { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10 });
    a.equipment.weapon = { ...sword, light: true };
    a.equipment.offhand = { ...sword, name: 'Shortsword', light: true };
    recalc(a);
    expect(a.offhandProfile).toBeTruthy();
    expect(a.offhandProfile.noAbilityMod).toBe(true);
    a.fightingStyle = 'twoWeapon';
    recalc(a);
    expect(a.offhandProfile.noAbilityMod).toBe(false);
  });
});

describe('feat data', () => {
  it('Mounted Combatant is gone and nothing else carries a dead flag', () => {
    expect(FEATS.mountedCombatant).toBeUndefined();
    for (const f of Object.values(FEATS)) {
      expect(f.eliteBonusDmg).toBeUndefined();
      expect(f.extraAttack).toBeUndefined();
    }
    expect(FEATS.evasion).toBeUndefined();
  });
  it('Resilient, Alert, Weapon Master, Durable, Spell Sniper carry SRD payloads', () => {
    expect(featSaveProficiencies(heroData({ feats: ['resilient'] }))).toEqual(['con']);
    expect(featInitiativeBonus(heroData({ feats: ['alert'] }))).toBe(5);
    expect(FEATS.weaponMaster.grantWeapon).toBe('martial');
    expect(FEATS.durable.pb.con).toBe(1);
    expect(FEATS.durable.pb.ac).toBeUndefined();
    expect(FEATS.spellSniper.cantripRangeMul).toBe(2);
    expect(FEATS.spellSniper.bonusDmg).toBeUndefined();
    expect(FEATS.mobile.pb.ac).toBeUndefined();
    expect(FEATS.shieldMaster.pb.ac).toBeUndefined();
  });
  it('Resilient shows up as a proficient CON save after recalc', () => {
    const a = makeHero('A', 'human', 'wizard', { str: 10, dex: 10, con: 14, int: 16, wis: 10, cha: 10 });
    recalc(a);
    const before = a.saves.con;
    a.feats = ['resilient']; recalc(a);
    expect(a.saves.con).toBeGreaterThan(before ?? -1);
    expect(a.saves.con).toBe(Math.floor((a.effStats.con - 10) / 2) + 2 /* prof at level 1 */);
  });
});

describe('Heavy Armor Master only blunts nonmagical physical damage', () => {
  it('reduces a sword blow, not a fire bolt', () => {
    const d = heroData({ feats: ['heavyArmorMaster'], equipment: { armor: { prof: 'heavy', armorBase: 16 } } });
    expect(featIncomingDamage(d, 10, 'slashing', false)).toBe(7);
    expect(featIncomingDamage(d, 10, null, false)).toBe(7);          // an untyped weapon blow
    expect(featIncomingDamage(d, 10, 'fire', true)).toBe(10);
    expect(featIncomingDamage(d, 10, 'slashing', true)).toBe(10);    // magical weapon
  });
});

describe('bonus-action and power-attack feats', () => {
  it('Crossbow Expert / Polearm Master / Charger / GWM each hand back the right bonus attack', () => {
    const cx = heroData({ feats: ['crossbowExpert'], equipment: { weapon: xbow }, weaponProfile: prof(xbow) });
    expect(featBonusActionAttack(cx).label).toBe('Crossbow Expert');
    const pm = heroData({ feats: ['polearmMaster'], equipment: { weapon: spear }, weaponProfile: prof(spear) });
    const ba = featBonusActionAttack(pm);
    expect(ba.label).toBe('Polearm Master');
    expect(ba.profile.dmg).toEqual([1, 4]);
    const ch = heroData({ feats: ['charger'], equipment: { weapon: sword }, weaponProfile: prof(sword) });
    expect(featBonusActionAttack(ch, { movedCells: 1 })).toBeNull();
    expect(featBonusActionAttack(ch, { movedCells: 2 }).extraDmg).toBe(5);
    const gwm = heroData({ feats: ['greatWeaponMaster'], equipment: { weapon: maul }, weaponProfile: prof(maul) });
    expect(featBonusActionAttack(gwm, {})).toBeNull();
    expect(featBonusActionAttack(gwm, { lastHitCrit: true }).label).toBe('Great Weapon Master');
    expect(featBonusActionAttack(gwm, { lastHitKilled: true }).label).toBe('Great Weapon Master');
    /* no chance rolls anywhere in it */
    expect(featBonusActionAttack.toString()).not.toMatch(/Math\.random/);
  });

  it('-5/+10 is taken against low AC and declined against high AC', () => {
    const g = Object.assign({}, combatMethods, { fxLog: noop });
    const d = heroData({ feats: ['greatWeaponMaster'], equipment: { weapon: maul } });
    expect(featPowerAttackAvailable(d, prof(maul))).toBe(true);
    expect(featPowerAttackAvailable(d, prof(sword))).toBe(false);
    const h = { data: d };
    const soft = { data: { ac: 10, hp: 50 } }, hard = { data: { ac: 24, hp: 50 } };
    const o1 = {}; expect(g.applyPowerAttack(h, soft, prof(maul), o1)).toBe(true);
    expect(o1.atkBonus).toBe(-5); expect(o1.extraDmg).toBe(10);
    const o2 = {}; expect(g.applyPowerAttack(h, hard, prof(maul), o2)).toBe(false);
    expect(o2.atkBonus).toBeUndefined();
  });
});

describe('reaction feats and styles', () => {
  function game() {
    return Object.assign({}, combatMethods, monsterAiMethods, turnEngineMethods, {
      fxNow: 0, heroes: [], monsters: [], initiative: { active: true },
      fxLog: noop, fxText: noop, fxPlaySfx: noop, fxMeleeHitVFX: noop, fxImpactDelay: (d, fn) => fn(),
      fxHitFlash: noop, fxDrawBar: noop, refreshHud: noop, playAbilityFx: noop, triggerLunge: noop, fxRichAbilityVFX: noop, fxTelegraph: noop, fxSprite: noop,
      triggerHitStop: noop, triggerShake: noop, _v3: (x, y, z) => ({ x, y, z }), creditThreat: noop,
      heroAttackRoll: vi.fn(), applyIncomingDamage: vi.fn((hh, dmg) => { hh.data.hp -= dmg; return dmg; }),
    });
  }
  const mon = (x, z) => ({ x, z, active: true, dead: false, ent: {}, data: { name: 'Orc', hp: 30, maxHp: 30, ac: 12, atk: 4, dmg: [1, 6, 2], effStats: { str: 14, dex: 10 } } });

  it('Protection: an adjacent shield-bearer imposes disadvantage once per round', () => {
    const g = game();
    const guard = { x: 0, z: 0, data: heroData({ fightingStyle: 'protection', equipment: { weapon: sword, offhand: shield } }) };
    const ally = { x: 1, z: 0, data: heroData() };
    const m = mon(2, 0);
    g.heroes = [guard, ally]; g.monsters = [m];
    expect(hasShieldEquipped(guard.data)).toBe(true);
    expect(g.monsterAttackAdv(m, ally)).toBe(-1);
    expect(guard.reactionUsed).toBe(true);
    expect(g.monsterAttackAdv(m, ally)).toBe(0);           // reaction spent
  });

  it('Defensive Duelist parries exactly the hit it can turn into a miss', () => {
    const g = game();
    const h = { x: 0, z: 0, data: heroData({ feats: ['defensiveDuelist'], equipment: { weapon: rapier } }) };
    expect(g.defensiveDuelistParry(h, 16, 15)).toBe(3);   // would hit by 1, prof +3 makes it miss
    expect(h.reactionUsed).toBe(true);
    h.reactionUsed = false;
    expect(g.defensiveDuelistParry(h, 14, 15)).toBe(0);   // already a miss
    expect(g.defensiveDuelistParry(h, 19, 15)).toBe(0);   // hits even with +3
  });

  it('Sentinel: reaction attack when an adjacent enemy attacks someone else; OA through Disengage', () => {
    const g = game();
    const guard = { x: 0, z: 0, data: heroData({ feats: ['sentinel'], equipment: { weapon: sword }, weaponProfile: prof(sword) }) };
    const ally = { x: 2, z: 0, data: heroData() };
    const m = mon(1, 0);
    g.heroes = [guard, ally]; g.monsters = [m];
    g.heroAC = () => 30;
    g.monsterAttack(m, ally);
    expect(g.heroAttackRoll).toHaveBeenCalledWith(guard, m, expect.anything(), expect.objectContaining({ opportunity: true }));
    expect(guard.reactionUsed).toBe(true);
    /* a rooted target cannot move */
    applyEffect(m, 'rooted', { duration: ROUND_SECONDS });
    expect(getEffectMods(m).speedMul).toBe(0);
    /* Disengage does not shake a Sentinel */
    guard.reactionUsed = false;
    m.disengageActive = true;
    g.threatenedCells = () => new Set([5]);
    g.heroAttackRoll.mockClear();
    g.resolveOpportunityAttacks(m, 5, 6);
    expect(g.heroAttackRoll).toHaveBeenCalledTimes(1);
    const plain = { x: 0, z: 0, data: heroData({ equipment: { weapon: sword }, weaponProfile: prof(sword) }) };
    g.heroes = [plain]; g.heroAttackRoll.mockClear();
    g.resolveOpportunityAttacks(m, 5, 6);
    expect(g.heroAttackRoll).not.toHaveBeenCalled();
  });

  it('Mobile: no opportunity attack from a creature you hit in melee this turn', () => {
    const g = game();
    const h = { x: 0, z: 0, _side: 'hero', data: heroData({ feats: ['mobile'], weaponProfile: prof(sword) }) };
    const m = mon(1, 0);
    g.heroes = [h]; g.monsters = [m];
    g.threatenedCells = () => new Set([5]);
    expect(g.oaHostiles(h).map(o => o.entity)).toEqual([m]);
    h._meleeTargets = new Set([m]);
    expect(g.oaHostiles(h)).toEqual([]);
  });

  it('Shield Master: +2 DEX saves vs spells, no damage on a passed DEX save, and a shove', () => {
    const g = game();
    const h = { x: 0, z: 0, data: heroData({ feats: ['shieldMaster'], equipment: { weapon: sword, offhand: shield } }) };
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      expect(rollSaveDetail(h.data, 'dex', 10, { magic: true }).mod).toBe(2 + 2);
      expect(rollSaveDetail(h.data, 'dex', 10, { magic: false }).mod).toBe(2);
    } finally { rnd.mockRestore(); }
    const m = mon(1, 0);
    g.monsters = [m]; g.heroes = [h];
    g.hurtHero = vi.fn();
    const rnd2 = vi.spyOn(Math, 'random').mockReturnValue(0.99);   // saves
    try { g._resolveAbilityOnHero(m, h, { save: { ab: 'dex', dc: 10, half: true }, dice: [4, 6], magic: true }, 'Fireball'); }
    finally { rnd2.mockRestore(); }
    expect(g.hurtHero).not.toHaveBeenCalled();
    /* the shove */
    const rnd3 = vi.spyOn(Math, 'random').mockReturnValueOnce(0.99).mockReturnValueOnce(0.0);
    try { expect(g.shieldMasterShove(h, m)).toBe(true); } finally { rnd3.mockRestore(); }
    expect(hasEffect(m, 'prone')).toBe(true);
    expect(h._bonusActed).toBe(true);
  });

  it('Mage Slayer: reaction attack on an adjacent caster', () => {
    const g = game();
    const h = { x: 0, z: 0, data: heroData({ feats: ['mageSlayer'], weaponProfile: prof(sword) }) };
    const m = mon(1, 0);
    g.heroes = [h]; g.monsters = [m];
    g.mageSlayerReaction(m);
    expect(g.heroAttackRoll).toHaveBeenCalledWith(h, m, expect.anything(), expect.anything());
    expect(h.reactionUsed).toBe(true);
  });

  it('Elemental Adept ignores resistance to the class element only', () => {
    const g = Object.assign({}, combatMethods);
    const wiz = { data: heroData({ classKey: 'wizard', feats: ['elementalAdept'], cantripProfile: { dmgType: 'fire' } }) };
    expect(g.elementalAdeptIgnores(wiz, { spell: true, dmgType: 'fire' })).toBe(true);
    expect(g.elementalAdeptIgnores(wiz, { spell: true, dmgType: 'cold' })).toBe(false);
    expect(g.elementalAdeptIgnores(wiz, { dmgType: 'fire' })).toBe(false);   // a fire sword is not a spell
  });
});

describe('pending feat picks are re-materialised on load', () => {
  it('a saved ASI/feat choice drops removed feats and picks up new descriptions', async () => {
    const { migrateProgression, FEATS: F } = await import('../src/game/features.js');
    const h = makeHero('A', 'human', 'fighter', { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10 });
    h.level = 4;
    h.pendingChoices = [{
      id: 'asi_4', pick: 'asiOrFeat', options: [
        { key: 'feat_mountedCombatant', label: 'Mounted Combatant', desc: 'Charging momentum', kind: 'feat', feat: 'mountedCombatant' },
        { key: 'feat_savageAttacker', label: 'Savage Attacker', desc: '+2 weapon damage on melee hits.', kind: 'feat', feat: 'savageAttacker' },
      ]
    }];
    migrateProgression(h);
    const opts = h.pendingChoices[0].options;
    expect(opts.some(o => o.feat === 'mountedCombatant')).toBe(false);
    const sa = opts.find(o => o.feat === 'savageAttacker');
    expect(sa).toBeTruthy();
    expect(sa.desc).toBe(F.savageAttacker.desc);
  });
});
