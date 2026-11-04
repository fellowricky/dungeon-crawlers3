/**
 * Class feature progression, feats, fighting styles, and spell learning.
 *
 * Idle-friendly adaptation of 5e-style leveling:
 *  - Auto features unlock immediately (Extra Attack, Rage, etc.)
 *  - Choices bank as pendingChoices (fighting style, ASI/feat, spells)
 *  - Subclass remains a special choice at level 3
 *  - Ability score bumps only come from ASI choices (not every level)
 *
 * Combat reads feature keys via hasFeature() and knownSpells via SPELLS.
 */

/* Intentionally no import from srd.js — that module imports us (avoid cycles). */
import { SPELLS, SPELL_POOLS } from './spells.js';
/* srd.js imports this module back — the cycle is fine because CLASSES is only
   read inside functions, never at module evaluation. Without this import the
   reference below resolves only by accident inside the bundled build and
   throws a ReferenceError under native ESM (dev server, tests). */
import { CLASSES, WILD_SHAPE_FORMS, profBonus } from './srd.js';
import { ROUND_SECONDS } from './conditions.js';   // leaf module — no cycle
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABILITY_LABEL = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };
const MELEE_CLASSES = new Set(['fighter', 'barbarian', 'monk', 'paladin', 'rogue', 'bard']);
/* Skill points banked per level-up, spent on the 5e skill checks (see SKILLS in
   srd.js, which re-exports this). Defined here because srd.js imports us. */
export const SKILL_POINTS_PER_LEVEL = 1;

/* ================================================================
   Fighting styles (Fighter L1, Ranger L2, Paladin L2, etc.)
   ================================================================ */
/* `pb` here is only the part of a style that is unconditional (Defense's AC).
   Everything else is evaluated per attack by styleAttackBonus / styleDamage
   below, so Archery cannot buff a sword and Dueling cannot buff a bow — which
   is exactly what happened when these were flat pb bonuses. */
export const FIGHTING_STYLES = {
  archery:  { label: 'Archery',  desc: '+2 to attack rolls with ranged weapons.', pb: {}, rangedOnly: true },
  defense:  { label: 'Defense',  desc: '+1 AC while wearing armor.', pb: { ac: 1 } },
  dueling:  { label: 'Dueling',  desc: '+2 damage when wielding a one-handed melee weapon and nothing in the other hand.', pb: {}, meleeOnly: true },
  greatWeapon: { label: 'Great Weapon Fighting', desc: 'Two-handed melee weapons: reroll damage dice that show a 1 or 2.', pb: {}, meleeOnly: true },
  protection: { label: 'Protection', desc: 'Reaction, with a shield: an attack against an ally next to you is made at disadvantage.', pb: {} },
  twoWeapon: { label: 'Two-Weapon Fighting', desc: 'Your off-hand attack adds your ability modifier to its damage.', pb: {}, meleeOnly: true }
};

const PHYSICAL_TYPES = new Set(['bludgeoning', 'piercing', 'slashing']);
/** Is the hero wielding a shield (shields live in the offhand slot)? */
export function hasShieldEquipped(h) {
  const oh = h && h.equipment && h.equipment.offhand;
  return !!(oh && oh.slot === 'shield');
}
/** Attack-roll bonus from the fighting style for THIS profile. */
export function styleAttackBonus(h, profile) {
  if (!h || !h.fightingStyle || !profile) return 0;
  if (h.fightingStyle === 'archery' && profile.source === 'weapon' && profile.melee === false && !profile.thrown) return 2;
  return 0;
}
/** Flat damage bonus from the fighting style for THIS profile (Dueling). */
export function styleDamageBonus(h, profile) {
  if (!h || !h.fightingStyle || !profile) return 0;
  if (h.fightingStyle === 'dueling' && profile.source === 'weapon' && profile.melee && !profile.offhand) {
    const oh = h.equipment && h.equipment.offhand;
    const otherWeapon = !!(oh && oh.slot === 'weapon');
    if (!profile.twoHanded && !otherWeapon) return 2;
  }
  return 0;
}
/** Great Weapon Fighting: reroll 1s and 2s on a two-handed melee weapon's dice. */
export function styleRerollsLowDice(h, profile) {
  if (!h || h.fightingStyle !== 'greatWeapon' || !profile || profile.source !== 'weapon' || !profile.melee) return false;
  return !!profile.twoHanded;
}

/* ================================================================
   Feats — pickable at ASI levels instead of a raw +2 ability
   ================================================================ */
export const FEATS = {
  tough: {
    label: 'Tough',
    desc: '+2 max HP per level (scales as you grow).',
    pb: {}, // applied specially in recalc via level
    hpPerLevel: 2
  },
  resilient: {
    label: 'Resilient (Constitution)',
    desc: '+1 CON and proficiency in Constitution saving throws.',
    pb: { con: 1 },
    saveProficiency: 'con'
  },
  weaponMaster: {
    label: 'Weapon Master',
    desc: '+1 DEX and proficiency with all martial weapons.',
    pb: { dex: 1 },
    grantWeapon: 'martial'
  },
  mobile: {
    label: 'Mobile',
    desc: '+10 ft Move (2 tiles). A creature you hit in melee this turn cannot make opportunity attacks against you.',
    pb: { move: 10 },
    noOAFromMeleeTargets: true
  },
  alert: {
    label: 'Alert',
    desc: "+5 to initiative. Attackers you can't see gain no advantage against you.",
    pb: {},
    initiativeBonus: 5
  },
  mageSlayer: {
    label: 'Mage Slayer',
    desc: 'Advantage on saves against spells cast by an adjacent creature, and a reaction melee attack when an adjacent creature casts a spell.',
    pb: {},
    mageSlayer: true
  },
  healer: {
    label: 'Healer',
    desc: '+3 to all healing you perform.',
    pb: { heal: 3 }
  },
  warCaster: {
    label: 'War Caster',
    desc: 'Advantage on the Constitution save to keep concentration when you take damage; casters only.',
    pb: {},
    castersOnly: true,
    concentrationAdvantage: true
  },
  elementalAdept: {
    label: 'Elemental Adept',
    desc: "Your spells ignore resistance to your class's element (fire for wizards and druids, radiant for clerics, necrotic for sorcerers, force for warlocks).",
    pb: {},
    castersOnly: true,
    ignoreResistance: 'classElement'
  },
  savageAttacker: {
    label: 'Savage Attacker',
    desc: 'Once per turn, reroll a melee weapon hit\'s damage dice and take the higher result.',
    pb: {},
    meleeOnly: true,
    rerollDamage: true
  },
  lucky: {
    label: 'Lucky',
    desc: 'Once per short rest, turn a miss into a hit (combat hook).',
    pb: {},
    luckyMiss: true
  },
  durable: {
    label: 'Durable',
    desc: '+1 CON and +1 max HP per level (hardy constitution).',
    pb: { con: 1 },
    hpPerLevel: 1
  },

  /* ---- Equipment-proficiency feats ------------------------------------
     These GRANT the ability to equip gear otherwise locked by class. The
     armor line is a ladder: each rung is only offered once you already have
     the tier below it (see buildAsiFeatOptions / equipmentGrants), so a
     wizard climbs light → medium → heavy across three separate feat picks. */
  lightlyArmored: {
    label: 'Lightly Armored',
    desc: 'Gain proficiency with light armor. (+1 DEX)',
    pb: { dex: 1 },
    grantArmor: 'light'
  },
  moderatelyArmored: {
    label: 'Moderately Armored',
    desc: 'Gain proficiency with medium armor and shields. (+1 STR)',
    pb: { str: 1 },
    grantArmor: 'medium',
    grantShield: true
  },
  heavilyArmored: {
    label: 'Heavily Armored',
    desc: 'Gain proficiency with heavy armor. (+1 STR)',
    pb: { str: 1 },
    grantArmor: 'heavy'
  },
  martialTraining: {
    label: 'Martial Weapon Training',
    desc: 'Gain proficiency with all martial weapons. (+1 STR)',
    pb: { str: 1 },
    grantWeapon: 'martial'
  },

  /* ---- Offensive combat feats -----------------------------------------
     Combat.js reads the typed hooks below (bonusDmg / extraAttack / onHit)
     through the feat* helpers further down — feats stay pure data. */
  greatWeaponMaster: {
    label: 'Great Weapon Master',
    desc: 'Heavy weapons: a bonus-action attack after a critical hit or a kill, and you may take -5 to hit for +10 damage when the odds favour it.',
    pb: {}, meleeOnly: true,
    powerAttack: { when: 'heavy' },
    bonusAttackOn: 'critOrKill'
  },
  sharpshooter: {
    label: 'Sharpshooter',
    desc: 'Ranged weapons: no penalty at long range, and you may take -5 to hit for +10 damage when the odds favour it.',
    pb: {}, rangedOnly: true,
    powerAttack: { when: 'ranged' }
  },
  crossbowExpert: {
    label: 'Crossbow Expert',
    desc: 'Crossbows: no disadvantage at point-blank range, and a bonus-action crossbow shot each turn.',
    pb: {}, rangedOnly: true,
    bonusAttack: { when: 'crossbow' }
  },
  polearmMaster: {
    label: 'Polearm Master',
    desc: 'Polearms: a bonus-action butt-end strike (1d4 + ability) each turn.',
    pb: {}, meleeOnly: true,
    bonusAttack: { when: 'polearm', dmg: [1, 4], dmgType: 'bludgeoning' }
  },
  charger: {
    label: 'Charger',
    desc: 'After moving at least 10 ft (2 tiles) toward a foe this turn, a bonus-action melee attack for +5 damage.',
    pb: {}, meleeOnly: true,
    bonusAttack: { when: 'charged', extraDmg: 5 }
  },
  sentinel: {
    label: 'Sentinel',
    desc: 'Your opportunity attacks root the target (speed 0) for the round, Disengage does not stop them, and you get a reaction attack when an adjacent enemy attacks someone else.',
    pb: {}, meleeOnly: true,
    sentinel: true
  },
  shieldMaster: {
    label: 'Shield Master',
    desc: 'With a shield: a bonus-action shove that knocks a foe prone, +2 on DEX saves against spells, and no damage when you pass a DEX save for half.',
    pb: {}, meleeOnly: true,
    shieldMaster: true
  },
  grappler: {
    label: 'Grappler',
    desc: '+1 STR. On-hit chance to grapple (slow); +2 damage vs slowed or prone foes.',
    pb: { str: 1 }, meleeOnly: true,
    onHit: { when: 'melee', effect: 'slowed', chance: 0.20, rounds: 1 },
    bonusDmg: { when: 'vsImpaired', flat: 2 }
  },
  tavernBrawler: {
    label: 'Tavern Brawler',
    desc: '+1 STR; your blows can stagger (slow) foes.',
    pb: { str: 1 },
    onHit: { when: 'melee', effect: 'slowed', chance: 0.15, rounds: 1 }
  },
  martialAdept: {
    label: 'Martial Adept',
    desc: 'Trip Attack: critical hits deal +1d8 and knock the foe prone.',
    pb: {},
    onHit: { when: 'crit', effect: 'prone', chance: 1, rounds: 1, dmg: [1, 8] }
  },
  spellSniper: {
    label: 'Spell Sniper',
    desc: 'Casters: your attack cantrip has double range.',
    pb: {}, castersOnly: true,
    cantripRangeMul: 2
  },
  skulker: {
    label: 'Skulker',
    desc: '+1 DEX. Ranged: your opening shot deals +1 damage per level. You can Hide in dim light or darkness, dim light never hinders your Perception, and missing from hiding keeps you hidden.',
    pb: { dex: 1 }, rangedOnly: true,
    bonusDmg: { when: 'firstStrikeRanged', perLevel: 1 }
  },

  /* ---- Defensive feats ------------------------------------------------ */
  heavyArmorMaster: {
    label: 'Heavy Armor Master',
    desc: '+1 STR. While in heavy armor, nonmagical bludgeoning, piercing and slashing damage you take is reduced by 3.',
    pb: { str: 1 },
    incomingDR: { flat: 3, when: 'heavyArmor', physicalOnly: true }
  },
  mediumArmorMaster: {
    label: 'Medium Armor Master',
    desc: '+1 DEX and +1 AC while wearing medium armor.',
    pb: { dex: 1 },
    acBonus: { flat: 1, when: 'mediumArmor' }
  },
  dualWielder: {
    label: 'Dual Wielder',
    desc: '+1 AC while wielding two weapons, and you can dual-wield heavier weapons.',
    pb: {},
    acBonus: { flat: 1, when: 'dualWield' },
    dualWield: true
  },
  defensiveDuelist: {
    label: 'Defensive Duelist',
    desc: 'Reaction, with a finesse weapon: add your proficiency bonus to AC against one melee attack that would hit you.',
    pb: {},
    parryReaction: true
  },
  inspiringLeader: {
    label: 'Inspiring Leader',
    desc: '+1 CHA. At the start of each fight, the whole party gains temporary HP.',
    pb: { cha: 1 },
    combatStart: { partyTempHp: { perLevel: 1, plusMod: 'cha' } }
  },

  /* ---- Utility half-feats --------------------------------------------- */
  athlete: {
    label: 'Athlete',
    desc: '+1 STR and +5 ft Move (1 tile).',
    pb: { str: 1, move: 5 }
  },
  observant: {
    label: 'Observant',
    desc: '+1 WIS and a keen edge on skill challenges.',
    pb: { wis: 1 },
    skillBonus: 2
  },
  skilled: {
    label: 'Skilled',
    desc: 'Broad training: a solid bonus to every skill challenge.',
    pb: {},
    skillBonus: 3
  },
  actor: {
    label: 'Actor',
    desc: '+1 CHA and a silver tongue on social skill challenges.',
    pb: { cha: 1 },
    skillBonus: 1
  },
  keenMind: {
    label: 'Keen Mind',
    desc: '+1 INT and a sharp eye for weak points (+1 spell damage).',
    pb: { int: 1 },
    bonusDmg: { when: 'spell', flat: 1 }
  },
  linguist: {
    label: 'Linguist',
    desc: '+1 INT and a knack for lore-based skill challenges.',
    pb: { int: 1 },
    skillBonus: 1
  },
  dungeonDelver: {
    label: 'Dungeon Delver',
    desc: 'Ever-watchful: +5 ft Move (1 tile), sharper on skill challenges, and dim light never hinders your Perception.',
    pb: { move: 5 },
    skillBonus: 1
  }
};

/* Equipment proficiencies granted purely by feats (class grants are handled
   separately in canEquip). Returns the best armor rank, martial-weapon flag,
   and shield flag the hero's feats confer. */
const ARMOR_GRANT_RANK = { light: 1, medium: 2, heavy: 3 };
export function equipmentGrants(h) {
  let armorRank = 0, weaponMartial = false, shield = false;
  for (const key of h.feats || []) {
    const f = FEATS[key];
    if (!f) continue;
    if (f.grantArmor) armorRank = Math.max(armorRank, ARMOR_GRANT_RANK[f.grantArmor] || 0);
    if (f.grantWeapon === 'martial') weaponMartial = true;
    if (f.grantShield) shield = true;
  }
  return { armorRank, weaponMartial, shield };
}

/* ================================================================
   Feat combat hooks — pure functions. Combat.js supplies the live
   context (profile, foe state) and applies any returned effects, so
   features.js never needs to import combat/effect code.
   ================================================================ */
const _dsum = (n, s) => { let t = 0; for (let i = 0; i < n; i++) t += 1 + Math.floor(Math.random() * s); return t; };

/** Conditional bonus damage from feats for one landed attack.
 *  ctx = { profile, weapon, foeElite, foeFullHp, foeImpaired } */
export function featBonusDamage(h, ctx) {
  const p = ctx.profile || {};
  const wpn = ctx.weapon;
  const lvl = h.level || 1;
  const ranged = p.source === 'weapon' && p.melee === false;
  const spell = p.source === 'cantrip';
  let bonus = 0;
  for (const key of h.feats || []) {
    const f = FEATS[key];
    if (!f || !f.bonusDmg) continue;
    const bd = f.bonusDmg;
    const amt = (bd.flat || 0) + Math.floor((bd.perLevel || 0) * lvl);
    switch (bd.when) {
      case 'twoHanded':         if (p.melee && wpn && wpn.twoHanded) bonus += amt; break;
      case 'ranged':            if (ranged) bonus += amt; break;
      case 'spell':             if (spell) bonus += amt; break;
      case 'vsElite':           if (ctx.foeElite) bonus += amt; break;
      case 'vsImpaired':        if (ctx.foeImpaired) bonus += amt; break;
      case 'firstStrike':       if (p.melee && ctx.foeFullHp) bonus += amt; break;
      case 'firstStrikeRanged': if (ranged && ctx.foeFullHp) bonus += amt; break;
    }
  }
  return bonus;
}

/** The bonus-action attack a feat grants this turn, or null.
 *  ctx = { movedCells, weaponProfile, lastHitCrit, lastHitKilled }
 *  Returns { profile, extraDmg, label } — the caller owns the bonus action. */
export function featBonusActionAttack(h, ctx = {}) {
  const wp = ctx.weaponProfile || h.weaponProfile;
  if (!wp) return null;
  const vw = wp.visualWeapon || (h.equipment && h.equipment.weapon && h.equipment.weapon.visualWeapon) || '';
  for (const key of h.feats || []) {
    const f = FEATS[key];
    if (!f) continue;
    const ba = f.bonusAttack;
    if (ba) {
      if (ba.when === 'crossbow' && vw.includes('crossbow') && wp.melee === false)
        return { profile: wp, extraDmg: 0, label: 'Crossbow Expert' };
      if (ba.when === 'polearm' && vw.startsWith('polearm/') && wp.melee)
        return { profile: { ...wp, name: 'Butt-end', dmg: ba.dmg.slice(), dmgType: ba.dmgType || wp.dmgType }, extraDmg: 0, label: 'Polearm Master' };
      if (ba.when === 'charged' && wp.melee && (ctx.movedCells || 0) >= 2)
        return { profile: wp, extraDmg: ba.extraDmg || 5, label: 'Charger' };
    }
    if (f.bonusAttackOn === 'critOrKill' && wp.melee && wp.heavy && (ctx.lastHitCrit || ctx.lastHitKilled))
      return { profile: wp, extraDmg: 0, label: 'Great Weapon Master' };
  }
  return null;
}

/** -5 to hit / +10 damage (Great Weapon Master, Sharpshooter) — available for
 *  this profile? The caller decides whether the trade is worth it. */
export function featPowerAttackAvailable(h, profile) {
  if (!profile || profile.source !== 'weapon') return false;
  for (const key of h.feats || []) {
    const pa = FEATS[key] && FEATS[key].powerAttack;
    if (!pa) continue;
    if (pa.when === 'heavy' && profile.melee && profile.heavy) return true;
    if (pa.when === 'ranged' && profile.melee === false && !profile.thrown) return true;
  }
  return false;
}

/** Feat-granted initiative bonus (Alert). */
export function featInitiativeBonus(h) {
  let b = 0;
  for (const key of h.feats || []) { const f = FEATS[key]; if (f && f.initiativeBonus) b += f.initiativeBonus; }
  return b;
}

/** Ability the hero's feats make save-proficient (Resilient), or null. */
export function featSaveProficiencies(h) {
  const out = [];
  for (const key of h.feats || []) { const f = FEATS[key]; if (f && f.saveProficiency) out.push(f.saveProficiency); }
  return out;
}

/** Multiplier on the attack cantrip's range (Spell Sniper). */
export function featCantripRangeMul(h) {
  let m = 1;
  for (const key of h.feats || []) { const f = FEATS[key]; if (f && f.cantripRangeMul) m *= f.cantripRangeMul; }
  return m;
}

/** Savage Attacker: reroll this melee weapon hit's dice and keep the higher? */
export function featRerollsDamage(h, profile) {
  if (!profile || profile.source !== 'weapon' || !profile.melee) return false;
  return (h.feats || []).some(k => FEATS[k] && FEATS[k].rerollDamage);
}

/** On-hit riders (status effects + bonus damage) for a landed hit.
 *  ctx = { melee, crit, hasShield }. Returns effect descriptors for
 *  combat.js to apply, plus any bonus damage total. */
export function featOnHit(h, ctx) {
  const out = { effects: [], bonusDmg: 0 };
  for (const key of h.feats || []) {
    const f = FEATS[key];
    if (!f || !f.onHit) continue;
    const oh = f.onHit;
    if (oh.when === 'melee'  && !ctx.melee) continue;
    if (oh.when === 'shield' && !(ctx.melee && ctx.hasShield)) continue;
    if (oh.when === 'crit'   && !ctx.crit) continue;
    if (Math.random() >= (oh.chance == null ? 1 : oh.chance)) continue;
    /* `rounds` is a whole number of combat rounds; the effect system wants it
       in combat-clock seconds (ROUND_SECONDS per round). */
    if (oh.effect) out.effects.push({ key: oh.effect, duration: ROUND_SECONDS * (oh.rounds || 1) });
    if (oh.dmg) out.bonusDmg += _dsum(oh.dmg[0], oh.dmg[1]);
  }
  return out;
}

/** Reduce incoming damage by feat flat DR (Heavy Armor Master: nonmagical
 *  bludgeoning / piercing / slashing only). A missing dmgType is treated as a
 *  plain weapon blow. */
export function featIncomingDamage(h, dmg, dmgType = null, magical = false) {
  let d = dmg;
  const armor = h.equipment && h.equipment.armor;
  const heavy = !!armor && armor.prof === 'heavy';
  const physical = !magical && (dmgType == null || PHYSICAL_TYPES.has(dmgType));
  for (const key of h.feats || []) {
    const f = FEATS[key];
    if (!f || !f.incomingDR) continue;
    if (f.incomingDR.when === 'heavyArmor' && !heavy) continue;
    if (f.incomingDR.physicalOnly && !physical) continue;
    d -= (f.incomingDR.flat || 0);
  }
  return Math.max(0, d);
}

/** Conditional AC from feats (Dual Wielder / Medium Armor Master). */
export function featACBonus(h) {
  const eqp = h.equipment || {};
  const armor = eqp.armor;
  const twoWeapons = !!(eqp.weapon && eqp.offhand && eqp.offhand.slot === 'weapon');
  const finesse = !!(eqp.weapon && eqp.weapon.finesse);
  let ac = 0;
  for (const key of h.feats || []) {
    const f = FEATS[key];
    if (!f || !f.acBonus) continue;
    const w = f.acBonus.when;
    if (w === 'mediumArmor' && !(armor && armor.prof === 'medium')) continue;
    if (w === 'dualWield' && !twoWeapons) continue;
    if (w === 'finesse' && !finesse) continue;
    ac += f.acBonus.flat || 0;
  }
  return ac;
}

/** Temp HP this hero contributes to the party at start of combat (Inspiring Leader). */
export function featCombatStartTempHp(h) {
  let best = 0;
  for (const key of h.feats || []) {
    const f = FEATS[key];
    if (!f || !f.combatStart || !f.combatStart.partyTempHp) continue;
    const t = f.combatStart.partyTempHp;
    const abilMod = t.plusMod ? Math.floor(((h.effStats?.[t.plusMod] ?? 10) - 10) / 2) : 0;
    best = Math.max(best, Math.max(1, (h.level || 1) * (t.perLevel || 0) + abilMod));
  }
  return best;
}

/** Flat bonus to skill-challenge rolls (Observant / Skilled / …). */
export function featSkillBonus(h) {
  let b = 0;
  for (const key of h.feats || []) {
    const f = FEATS[key];
    if (f && f.skillBonus) b += f.skillBonus;
  }
  return b;
}

/** Whether the hero's feats relax the two-weapon-fighting light requirement. */
export function hasDualWielder(h) {
  return (h.feats || []).includes('dualWielder');
}


/* ================================================================
   Passive feature definitions (auto-unlocked keys)
   ================================================================ */
export const FEATURES = {
  secondWind: {
    label: 'Second Wind',
    desc: 'Once per short rest, self-heal when badly hurt.',
    combat: 'secondWind'
  },
  actionSurgeClass: {
    label: 'Action Surge',
    desc: 'Once per short rest, make an extra attack (all Fighters).',
    combat: 'actionSurge'
  },
  extraAttack: {
    label: 'Extra Attack',
    desc: 'Attack twice whenever you take the Attack action.',
    combat: 'extraAttack'
  },
  extraAttack2: {
    label: 'Improved Extra Attack',
    desc: 'Attack three times per turn.',
    combat: 'extraAttack2'
  },
  indomitable: {
    label: 'Indomitable',
    desc: 'Once per long rest, turn a miss into a hit.',
    combat: 'indomitable'
  },
  sneakAttack: {
    label: 'Sneak Attack',
    desc: 'Bonus damage when an ally flanks the target.',
    combat: 'sneakAttack'
  },
  cunningActionClass: {
    label: 'Cunning Action',
    desc: 'Bonus action every turn: Dash and Disengage (double movement, no opportunity attacks).',
    combat: 'cunningAction'
  },
  uncannyDodge: {
    label: 'Uncanny Dodge',
    desc: 'Halve the first hit you take each combat exchange.',
    combat: 'uncannyDodge'
  },
  evasion: {
    label: 'Evasion',
    desc: 'Against effects that allow a DEX save for half damage, you take none on a success and half on a failure.',
    pb: {}
  },
  rage: {
    label: 'Rage',
    desc: 'Once per long rest, when hurt enter Rage: +2 melee dmg, +2 AC, half damage taken.',
    combat: 'rage'
  },
  recklessAttack: {
    label: 'Reckless Attack',
    desc: 'While raging, advantage on your attacks.',
    combat: 'reckless'
  },
  brutalCritical: {
    label: 'Brutal Critical',
    desc: 'Melee crits deal +1 damage die.',
    combat: 'brutalCrit'
  },
  brutalCritical2: {
    label: 'Brutal Critical II',
    desc: '+1 damage; 2 extra crit dice.',
    pb: { dmg: 1 }
  },
  brutalCritical3: {
    label: 'Brutal Critical III',
    desc: '+1 damage; 3 extra crit dice.',
    pb: { dmg: 1 }
  },
  flurryOfBlows: {
    label: 'Flurry of Blows',
    desc: 'Spend 1 Ki after attacking to make two unarmed strikes as a bonus action.',
    combat: 'flurry'
  },
  patientDefense: {
    label: 'Patient Defense',
    desc: 'Spend 1 Ki as a bonus action to Dodge (+5 AC).',
    combat: 'patientDefense'
  },
  stepOfTheWind: {
    label: 'Step of the Wind',
    desc: 'Spend 1 Ki as a bonus action to Dash or Disengage (+50% speed).',
    combat: 'stepOfTheWind'
  },
  stunningStrike: {
    label: 'Stunning Strike',
    desc: 'Spend 1 Ki on a melee hit to force a CON save vs Stun.',
    combat: 'stunningStrike'
  },
  martialArts: {
    label: 'Martial Arts',
    desc: '+1 AC, unarmed strike scales with level, and free bonus unarmed strike.',
    pb: { ac: 1, dmg: 1 }
  },
  divineSmite: {
    label: 'Divine Smite',
    desc: 'On a melee hit, spend a spell slot for +2d8 radiant (+1d8 per slot level above 1st, +1d8 vs undead and fiends).',
    combat: 'divineSmite'
  },
  layOnHands: {
    label: 'Lay on Hands',
    desc: 'Pool of healing (5 × level) usable on wounded allies.',
    combat: 'layOnHands'
  },
  auraProtection: {
    label: 'Aura of Protection',
    desc: '+1 AC to yourself (aura of resolve).',
    pb: { ac: 1 }
  },
  favoredEnemy: {
    label: 'Favored Enemy',
    desc: '+2 damage against all monsters.',
    pb: { dmg: 2 }
  },
  colossusSlayerClass: {
    label: "Hunter's Prey",
    desc: '+1d8 damage vs wounded foes (once per turn).',
    combat: 'colossusSlayer'
  },
  bardicInspiration: {
    label: 'Bardic Inspiration',
    desc: 'Bonus action: give one ally an inspiration die (d6, d8 at 5, d10 at 10, d12 at 15) to add to their next attack roll.',
    combat: 'bardicInspiration'
  },
  songOfRest: {
    label: 'Song of Rest',
    desc: 'Passive: the party heals 10% of max HP at the end of each fight.',
    combat: 'songOfRest'
  },
  wildShapeClass: {
    label: 'Wild Shape',
    desc: 'Once per short rest: take a beast form with its own HP pool and claw strikes.',
    combat: 'wildShape'
  },
  tidesOfChaos: {
    label: 'Tides of Chaos',
    desc: 'Once per long rest: advantage on an attack roll.',
    combat: 'tidesOfChaos'
  },
  metamagic: {
    label: 'Metamagic: Empowered',
    desc: '+1 spell damage (always on).',
    pb: { dmg: 1 }
  },
  eldritchBlast: {
    label: 'Eldritch Blast',
    desc: 'Your cantrip is Eldritch Blast; +1 beam at level 5.',
    combat: 'eldritchBlast'
  },
  arcaneRecovery: {
    label: 'Arcane Recovery',
    desc: 'On a short rest, recover half your spell slots (rounded up).',
    combat: 'arcaneRecovery'
  },
  channelDivinity: {
    label: 'Channel Divinity',
    desc: 'Your domain active recharges more reliably (flavor + short rest ready).',
    combat: 'channelDivinity'
  },
  jackOfAllTrades: {
    label: 'Jack of All Trades',
    desc: '+1 to attack rolls (broad training).',
    pb: { atk: 1 }
  },
  fontOfMagic: {
    label: 'Font of Magic',
    desc: '+1 spell slot maximum.',
    slotBonus: 1
  },
  pactMagic: {
    label: 'Pact Magic',
    desc: 'Warlock slots recharge on short rest.',
    combat: 'pactMagic'
  },
  ki: {
    label: 'Ki',
    desc: 'Pool of Ki points equal to your Monk level. Recharges on short rest.',
    combat: 'ki'
  },
  stillMind: {
    label: 'Still Mind',
    desc: '+1 AC from mental discipline.',
    pb: { ac: 1 }
  },
  divineHealth: {
    label: 'Divine Health',
    desc: '+4 max HP; pure constitution of faith.',
    pb: { hp: 4 }
  },
  naturalExplorer: {
    label: 'Natural Explorer',
    desc: '+5 ft Move (1 tile) in the wilds (everywhere, here).',
    pb: { move: 5 }
  },
  primevalAwareness: {
    label: 'Primeval Awareness',
    desc: '+1 to attack rolls (sense prey).',
    pb: { atk: 1 }
  },
  /* subclass milestone autos (granted at 6 / 10 when subclass chosen) */
  subclass6: { label: 'Subclass Feature', desc: 'Your path deepens.', pb: {} },
  subclass10: { label: 'Subclass Mastery', desc: 'Your path reaches a peak.', pb: {} },

  /* ===== Barbarian L11-20 ===== */
  relentlessRage: {
    label: 'Relentless Rage',
    desc: 'When downed while raging, CON save to stay at 1 HP.',
    pb: { str: 1 },
    combat: 'relentlessRage'
  },
  persistentRage: {
    label: 'Persistent Rage',
    desc: 'Rage only ends on death or by choice; +1 AC.',
    pb: { ac: 1 }
  },
  indomitableMight: {
    label: 'Indomitable Might',
    desc: '+2 STR; your raw power is unstoppable.',
    pb: { str: 2 }
  },
  primalChampion: {
    label: 'Primal Champion',
    desc: '+2 STR, +2 CON, +10 HP. Maximum STR/CON raised to 24.',
    pb: { str: 2, con: 2, hp: 10 }
  },

  /* ===== Fighter L11-20 ===== */
  extraAttack3: {
    label: 'Extra Attack (x4)',
    desc: 'Attack four times per turn.',
    combat: 'extraAttack3'
  },
  actionSurge2: {
    label: 'Action Surge II',
    desc: 'Use Action Surge twice between rests.',
    combat: 'actionSurge2'
  },
  indomitable2: {
    label: 'Indomitable II',
    desc: '+1 AC; your will is iron.',
    pb: { ac: 1 }
  },

  /* ===== Rogue L11-20 ===== */
  reliableTalent: {
    label: 'Reliable Talent',
    desc: '+1 attack; your skills never fail you.',
    pb: { atk: 1 }
  },
  blindsense: {
    label: 'Blindsense',
    desc: '+1 attack; you sense hidden foes nearby.',
    pb: { atk: 1 }
  },
  slipperyMind: {
    label: 'Slippery Mind',
    desc: '+1 AC; your mind slips free of influence.',
    pb: { ac: 1 }
  },
  elusive: {
    label: 'Elusive',
    desc: '+2 AC; attackers never have advantage against you.',
    pb: { ac: 2 }
  },
  strokeOfLuck: {
    label: 'Stroke of Luck',
    desc: 'Once per short rest, turn a miss into a hit.',
    combat: 'strokeOfLuck'
  },

  /* ===== Cleric L11-20 ===== */
  destroyUndeadGreater: {
    label: 'Destroy Undead (Greater)',
    desc: '+2 damage; divine wrath burns the unholy.',
    pb: { dmg: 2 }
  },
  divineInterventionImproved: {
    label: 'Divine Intervention',
    desc: '+3 heal, +1 AC; your deity answers without delay.',
    pb: { heal: 3, ac: 1 }
  },

  /* ===== Wizard L11-20 ===== */
  spellMastery: {
    label: 'Spell Mastery',
    desc: '+2 spell damage; free 1st-/2nd-level spell once per short rest.',
    pb: { dmg: 2 },
    combat: 'spellMastery'
  },
  signatureSpells: {
    label: 'Signature Spells',
    desc: '+3 spell damage; free 3rd-level spell once per short rest.',
    pb: { dmg: 3 }
  },

  /* ===== Bard L11-20 ===== */
  inspiredPerformance: {
    label: 'Inspired Performance',
    desc: '+1 attack, +1 heal; your art reaches its peak.',
    pb: { atk: 1, heal: 1 }
  },
  superiorInspiration: {
    label: 'Superior Inspiration',
    desc: 'Begin combat with 1 Bardic Inspiration charge.',
    combat: 'superiorInspiration'
  },

  /* ===== Druid L11-20 ===== */
  beastSpells: {
    label: 'Beast Spells',
    desc: '+2 damage; cast spells while in Wild Shape.',
    pb: { dmg: 2 }
  },
  archdruid: {
    label: 'Archdruid',
    desc: '+2 dmg, +1 AC, +2 heal. Unlimited Wild Shapes.',
    pb: { dmg: 2, ac: 1, heal: 2 }
  },

  /* ===== Monk L11-20 ===== */
  tongueSunMoon: {
    label: 'Tongue of the Sun and Moon',
    desc: '+1 attack; transcendent understanding of all.',
    pb: { atk: 1 }
  },
  diamondSoul: {
    label: 'Diamond Soul',
    desc: '+1 AC, +4 HP; proficiency in all saving throws.',
    pb: { ac: 1, hp: 4 }
  },
  emptyBody: {
    label: 'Empty Body',
    desc: '+2 AC; become invisible and half all damage briefly.',
    pb: { ac: 2 },
    combat: 'emptyBody'
  },
  perfectSelf: {
    label: 'Perfect Self',
    desc: 'Regain 4 Ki points when combat begins.',
    combat: 'perfectSelf'
  },

  /* ===== Paladin L11-20 ===== */
  improvedDivineSmite: {
    label: 'Improved Divine Smite',
    desc: '+2 damage; every melee hit sears with radiant light.',
    pb: { dmg: 2 }
  },
  cleansingTouch: {
    label: 'Cleansing Touch',
    desc: '+2 heal; end harmful spells with a touch.',
    pb: { heal: 2 }
  },
  auraImproved: {
    label: 'Aura of Devotion',
    desc: '+1 AC; your protective aura stretches to 30 ft.',
    pb: { ac: 1 }
  },
  oathCapstone: {
    label: 'Sacred Oath Champion',
    desc: '+2 damage, +1 attack; you embody your oath.',
    pb: { dmg: 2, atk: 1 }
  },

  /* ===== Ranger L11-20 ===== */
  vanish: {
    label: 'Vanish',
    desc: '+5 ft Move (1 tile), +1 AC; hide as a bonus action.',
    pb: { move: 5, ac: 1 }
  },
  feralSenses: {
    label: 'Feral Senses',
    desc: '+2 attack; no disadvantage vs unseen enemies.',
    pb: { atk: 2 }
  },
  foeSlayer: {
    label: 'Foe Slayer',
    desc: '+3 damage; relentless enemy of your quarry.',
    pb: { dmg: 3 }
  },

  /* ===== Sorcerer L11-20 ===== */
  metamagicExpert: {
    label: 'Metamagic Expert',
    desc: '+2 spell damage; third metamagic option unlocked.',
    pb: { dmg: 2 }
  },
  sorcerousRestoration: {
    label: 'Sorcerous Restoration',
    desc: '+2 spell dmg, +1 atk. Regain 4 SP on short rest.',
    pb: { dmg: 2, atk: 1 }
  },

  /* ===== Warlock L11-20 ===== */
  eldritchMaster: {
    label: 'Eldritch Master',
    desc: '+2 damage, +6 HP. Regain all pact slots 1/long rest.',
    pb: { dmg: 2, hp: 6 },
    combat: 'eldritchMaster'
  }
};

/* ================================================================
   Eldritch Invocations — warlock-only picks, chosen (never handed out) at
   levels 2 (x2), 5, 7, 9, 12, 15, 18, matching the SRD invocations-known
   curve of 2/3/4/5/6/7/8.

   These live in their own map rather than FEATURES because they are stored on
   h.invocations, not h.features. hasFeature() already reads both arrays, so
   anything keyed off a `combat` tag keeps working unchanged.

   SRD invocations that are purely narrative (Beast Speech, Eyes of the Rune
   Keeper, Mask of Many Faces, ...) are deliberately omitted: there is no
   mechanic behind them in a dungeon crawler, and a dead option in a level-up
   list reads as a trap. `minLevel` gates the two that the SRD gates.
   ================================================================ */
export const INVOCATIONS = {
  agonizingBlast: {
    label: 'Agonizing Blast',
    desc: 'Add your CHA modifier to each Eldritch Blast beam that hits.',
    combat: 'agonizingBlast'
  },
  repellingBlast: {
    label: 'Repelling Blast',
    desc: 'Eldritch Blast pushes its target 10 feet back on hit.',
    combat: 'repellingBlast'
  },
  graspOfHadar: {
    label: 'Grasp of Hadar',
    desc: 'Eldritch Blast pulls its target 10 feet closer on hit.',
    combat: 'graspOfHadar'
  },
  lanceOfLethargy: {
    label: 'Lance of Lethargy',
    desc: 'Eldritch Blast cuts the target speed by 10 ft on hit.',
    combat: 'lanceOfLethargy'
  },
  eldritchSpear: {
    label: 'Eldritch Spear',
    desc: 'Eldritch Blast reaches far further (+20 ft range).',
    combat: 'eldritchSpear'
  },
  armorOfShadows: {
    label: 'Armor of Shadows',
    desc: 'Mage armor at will: +1 AC.',
    pb: { ac: 1 }
  },
  fiendishVigor: {
    label: 'Fiendish Vigor',
    desc: 'False life at will: +5 maximum HP.',
    pb: { hp: 5 }
  },
  devilsSight: {
    label: "Devil's Sight",
    /* light_rules.js senseRanges: 24 tiles, and it pierces magical Darkness */
    desc: 'See normally in darkness, even magical Darkness, out to 120 ft.',
    pb: {}
  },
  beguilingInfluence: {
    label: 'Beguiling Influence',
    desc: 'Supernatural presence: +1 Charisma.',
    pb: { cha: 1 }
  },
  thirstingBlade: {
    label: 'Thirsting Blade',
    desc: 'Attack twice, instead of once, when you attack with a weapon.',
    minLevel: 5,
    combat: 'thirstingBlade'
  },
  lifedrinker: {
    label: 'Lifedrinker',
    desc: 'Your pact-charged strikes deal +3 damage.',
    minLevel: 12,
    pb: { dmg: 3 }
  }
};

/* Subclass passive boosts at L6 / L10 / L14 / L18 (on top of L3 pick) */
export const SUBCLASS_MILESTONES = {
  fighter: {
    champion: { 6: { pb: { crit: 1 }, label: 'Superior Critical' }, 10: { pb: { dmg: 2 }, label: 'Survivor' },
                14: { pb: { crit: 1, dmg: 2 }, label: 'Champion Ascendant' }, 18: { pb: { dmg: 3, hp: 10 }, label: 'Legendary Champion' } },
    guardian: { 6: { pb: { ac: 1, hp: 4 }, label: 'Hold the Line' }, 10: { pb: { ac: 1 }, label: 'Bulwark' },
                14: { pb: { ac: 1, hp: 8 }, label: 'Iron Bulwark' }, 18: { pb: { ac: 2, hp: 12 }, label: 'Living Wall' } }
  },
  rogue: {
    thief: { 6: { pb: { move: 5 }, label: 'Supreme Sneak' }, 10: { pb: { ac: 1, dmg: 1 }, label: 'Use Magic Device' },
             14: { pb: { move: 5, dmg: 2 }, label: 'Master Infiltrator' }, 18: { pb: { dmg: 3, ac: 1 }, label: 'Ghost in the Dark' } },
    nightblade: { 6: { pb: { crit: 1 }, label: 'Assassinate' }, 10: { pb: { dmg: 2 }, label: 'Death Strike+' },
                  14: { pb: { crit: 1, dmg: 2 }, label: 'Death Mark' }, 18: { pb: { dmg: 4 }, label: 'Executioner' } }
  },
  cleric: {
    life: { 6: { pb: { heal: 3 }, label: 'Blessed Healer' }, 10: { pb: { heal: 2, ac: 1 }, label: 'Supreme Healing' },
            14: { pb: { heal: 3, hp: 6 }, label: 'Divine Restoration' }, 18: { pb: { heal: 4, ac: 1 }, label: 'Avatar of Life' } },
    war: { 6: { pb: { atk: 1, dmg: 1 }, label: 'War Priest' }, 10: { pb: { dmg: 2 }, label: 'Avatar of Battle' },
           14: { pb: { atk: 1, dmg: 3 }, label: 'Scourge of Heretics' }, 18: { pb: { dmg: 4, ac: 1 }, label: 'Vessel of War' } }
  },
  wizard: {
    evoker: { 6: { pb: { dmg: 2 }, label: 'Potent Cantrip' }, 10: { pb: { dmg: 2 }, label: 'Overchannel' },
              14: { pb: { dmg: 3, atk: 1 }, label: 'Unstable Overchannel' }, 18: { pb: { dmg: 4 }, label: 'Archmage of Evocation' } },
    abjurer: { 6: { pb: { ac: 1, hp: 6 }, label: 'Projected Ward' }, 10: { pb: { ac: 1 }, label: 'Spell Resistance' },
               14: { pb: { ac: 1, hp: 8 }, label: 'Greater Abjuration' }, 18: { pb: { ac: 2, hp: 12 }, label: 'Wardmaster' } }
  },
  barbarian: {
    berserker: { 6: { pb: { dmg: 2 }, label: 'Mindless Rage' }, 10: { pb: { atk: 1, dmg: 1 }, label: 'Intimidating Presence' },
                 14: { pb: { dmg: 3, str: 1 }, label: 'Furious Rampage' }, 18: { pb: { dmg: 4, atk: 1 }, label: 'Unstoppable Fury' } },
    totem: { 6: { pb: { ac: 1, hp: 6 }, label: 'Aspect of the Eagle' }, 10: { pb: { ac: 1 }, label: 'Totemic Attunement' },
             14: { pb: { ac: 1, hp: 8 }, label: 'Spirit Guardian' }, 18: { pb: { ac: 2, hp: 14 }, label: 'Totem Incarnate' } }
  },
  bard: {
    lore: { 6: { pb: { atk: 1 }, label: 'Additional Magical Secrets' }, 10: { pb: { dmg: 1, heal: 2 }, label: 'Peerless Skill' },
            14: { pb: { atk: 1, heal: 3 }, label: 'Font of Inspiration' }, 18: { pb: { dmg: 2, heal: 3 }, label: 'Legend of Lore' } },
    valor: { 6: { pb: { ac: 1, dmg: 1 }, label: 'Combat Training' }, 10: { pb: { atk: 1 }, label: 'Battle Magic' },
             14: { pb: { ac: 1, dmg: 2 }, label: 'War Chant' }, 18: { pb: { atk: 2, dmg: 2 }, label: 'Saga of Valor' } }
  },
  druid: {
    land: { 6: { pb: { atk: 1 }, label: "Land's Stride" }, 10: { pb: { dmg: 2 }, label: "Nature's Ward" },
            14: { pb: { dmg: 2, atk: 1 }, label: "Nature's Sanctuary" }, 18: { pb: { dmg: 3, hp: 10 }, label: 'Archdruid of the Land' } },
    moon: { 6: { pb: { dmg: 1, hp: 6 }, label: 'Primal Strike' }, 10: { pb: { dmg: 2 }, label: 'Elemental Wild Shape' },
            14: { pb: { dmg: 2, hp: 10 }, label: 'Thousand Forms' }, 18: { pb: { dmg: 4, ac: 1 }, label: 'Primal Avatar' } }
  },
  monk: {
    openhand: { 6: { pb: { dmg: 1 }, label: 'Wholeness of Body' }, 10: { pb: { ac: 1, move: 5 }, label: 'Quivering Palm Ready' },
                14: { pb: { dmg: 2, ac: 1 }, label: 'Tranquility' }, 18: { pb: { dmg: 3, move: 5 }, label: 'Grandmaster' } },
    shadow: { 6: { pb: { ac: 1 }, label: 'Shadow Step+' }, 10: { pb: { dmg: 2 }, label: 'Opportunist' },
              14: { pb: { ac: 1, dmg: 2 }, label: 'Cloak of Shadows' }, 18: { pb: { dmg: 3, ac: 1 }, label: 'Shadow Master' } }
  },
  paladin: {
    devotion: { 6: { pb: { atk: 1 }, label: 'Aura of Devotion' }, 10: { pb: { ac: 1, heal: 2 }, label: 'Holy Nimbus' },
                14: { pb: { atk: 1, heal: 3 }, label: 'Cleansing Touch' }, 18: { pb: { ac: 2, heal: 3 }, label: 'Angel of Devotion' } },
    vengeance: { 6: { pb: { dmg: 2 }, label: 'Relentless Avenger' }, 10: { pb: { atk: 1, dmg: 1 }, label: 'Soul of Vengeance' },
                 14: { pb: { dmg: 3, atk: 1 }, label: 'Avenging Angel' }, 18: { pb: { dmg: 4, atk: 1 }, label: 'Scourge of Vengeance' } }
  },
  ranger: {
    hunter: { 6: { pb: { dmg: 1 }, label: 'Multiattack Defense' }, 10: { pb: { atk: 1, dmg: 1 }, label: 'Superior Hunter' },
              14: { pb: { dmg: 2, atk: 1 }, label: 'Apex Predator' }, 18: { pb: { dmg: 3, atk: 1 }, label: 'Legendary Hunter' } },
    beastmaster: { 6: { pb: { ac: 1 }, label: 'Exceptional Training' }, 10: { pb: { dmg: 2 }, label: 'Bestial Fury' },
                   14: { pb: { dmg: 2, hp: 8 }, label: 'Shared Fury' }, 18: { pb: { dmg: 3, ac: 1 }, label: 'Pack Alpha' } }
  },
  sorcerer: {
    draconic: { 6: { pb: { dmg: 2 }, label: 'Elemental Affinity' }, 10: { pb: { ac: 1, hp: 4 }, label: 'Dragon Wings' },
                14: { pb: { dmg: 2, ac: 1 }, label: 'Dragon Fear' }, 18: { pb: { dmg: 4, hp: 6 }, label: 'Draconic Ascension' } },
    wildmagic: { 6: { pb: { atk: 1 }, label: 'Bend Luck' }, 10: { pb: { dmg: 2 }, label: 'Controlled Chaos' },
                 14: { pb: { dmg: 2, atk: 1 }, label: 'Spell Bombardment' }, 18: { pb: { dmg: 4 }, label: 'Chaos Ascendant' } }
  },
  warlock: {
    fiend: { 6: { pb: { dmg: 1, hp: 4 }, label: "Dark One's Own Luck" }, 10: { pb: { dmg: 2 }, label: 'Fiendish Resilience' },
             14: { pb: { dmg: 2, hp: 6 }, label: 'Hurl Through Hell' }, 18: { pb: { dmg: 4 }, label: 'Fiendish Ascendancy' } },
    archfey: { 6: { pb: { ac: 1 }, label: 'Misty Escape' }, 10: { pb: { atk: 1, ac: 1 }, label: 'Beguiling Defenses' },
               14: { pb: { ac: 1, dmg: 2 }, label: 'Dark Delirium' }, 18: { pb: { dmg: 3, ac: 1 }, label: 'Archfey Presence' } }
  }
};

/* ================================================================
   Per-class level tables (levels 1–10)
   ================================================================ */

const FS_MARTIAL = ['archery', 'defense', 'dueling', 'greatWeapon', 'protection'];
const FS_MELEE = ['defense', 'dueling', 'greatWeapon', 'twoWeapon'];
const FS_RANGED = ['archery', 'defense', 'dueling'];

function auto(feature) { return { type: 'auto', feature }; }
function subclass() { return { type: 'subclass' }; }
function asi(level) {
  return { type: 'choice', pick: 'asiOrFeat', id: `asi_${level}`, title: `Level ${level}: ASI or Feat` };
}
function fightingStyle(id, styles) {
  return { type: 'choice', pick: 'fightingStyle', id, title: 'Fighting Style', styles };
}
function learnSpell(id, classKey, tier, title) {
  return { type: 'choice', pick: 'spell', id, title: title || `Learn a spell`, classKey, tier };
}
function invocation(id) {
  return { type: 'choice', pick: 'invocation', id, title: 'Choose an Eldritch Invocation' };
}
/* Mystic Arcanum: a warlock spell of the given level that is cast once per long
   rest off its own charge, never off a pact slot (which never exceeds 5th). */
function arcanum(id, tier) {
  const ord = { 6: '6th', 7: '7th', 8: '8th', 9: '9th' }[tier] || `${tier}th`;
  return { type: 'choice', pick: 'arcanum', id, classKey: 'warlock', tier,
           title: `Mystic Arcanum (${ord})` };
}
function wildShapeFormChoice() {
  return { type: 'choice', pick: 'wildShapeForm', id: 'wild_shape_form', title: 'Choose Wild Shape Form' };
}
function milestone(level) {
  return { type: 'subclassMilestone', level };
}

export const CLASS_PROGRESSION = {
  fighter: {
    1: [auto('secondWind'), fightingStyle('fs_fighter', FS_MARTIAL)],
    2: [auto('actionSurgeClass')],
    3: [subclass()],
    4: [asi(4)],
    5: [auto('extraAttack')],
    6: [milestone(6)],
    7: [auto('indomitable')],
    8: [asi(8)],
      9: [],
      10: [asi(10), milestone(10)],
      11: [auto('extraAttack2')],
      12: [asi(12)],
      13: [auto('indomitable2')],
      14: [asi(14), milestone(14)],
      15: [],
      16: [asi(16)],
      17: [auto('actionSurge2')],
      18: [asi(18), milestone(18)],
      19: [],
      20: [asi(20), auto('extraAttack3')]
  },
  rogue: {
    1: [auto('sneakAttack')],
    2: [auto('cunningActionClass')],
    3: [subclass()],
    4: [asi(4)],
    5: [auto('uncannyDodge')],
    6: [milestone(6)],
     7: [auto('evasion')],
     8: [asi(8)],
      9: [],
      10: [asi(10), milestone(10)],
      11: [auto('reliableTalent')],
      12: [asi(12)],
      13: [],
      14: [asi(14), milestone(14), auto('blindsense')],
      15: [auto('slipperyMind')],
      16: [asi(16)],
      17: [],
      18: [asi(18), milestone(18), auto('elusive')],
      19: [],
      20: [asi(20), auto('strokeOfLuck')]
  },
  cleric: {
    1: [learnSpell('cleric_sp1', 'cleric', 1, 'Domain spell')],
    2: [auto('channelDivinity')],
    3: [subclass(), learnSpell('cleric_sp2', 'cleric', 2)],
    4: [asi(4)],
    5: [learnSpell('cleric_sp3', 'cleric', 3)],
    6: [milestone(6)],
    7: [learnSpell('cleric_sp4', 'cleric', 4, 'Learn a 4th-level spell')],
    8: [asi(8)],
    9: [learnSpell('cleric_sp5', 'cleric', 5, 'Learn a 5th-level spell')],
    10: [asi(10), milestone(10)],
    11: [learnSpell('cleric_sp6', 'cleric', 6, 'Learn a 6th-level prayer')],
    12: [asi(12)],
    13: [learnSpell('cleric_sp7', 'cleric', 7, 'Learn a 7th-level prayer')],
    14: [asi(14), milestone(14), auto('destroyUndeadGreater')],
    15: [learnSpell('cleric_sp8', 'cleric', 8, 'Learn an 8th-level prayer')],
    16: [asi(16)],
    17: [learnSpell('cleric_sp9', 'cleric', 9, 'Divine Miracle: 9th-level prayer')],
    18: [asi(18), milestone(18)],
    19: [learnSpell('cleric_sp9b', 'cleric', 9, 'Divine Miracle: high-tier prayer')],
    20: [asi(20), auto('divineInterventionImproved')]
  },
  wizard: {
    1: [learnSpell('wiz_sp1', 'wizard', 1, 'Learn a 1st-level spell'), auto('arcaneRecovery')],
    2: [learnSpell('wiz_sp1b', 'wizard', 1, 'Learn another spell')],
    3: [subclass(), learnSpell('wiz_sp2', 'wizard', 2)],
    4: [asi(4)],
    5: [learnSpell('wiz_sp3', 'wizard', 3)],
    6: [milestone(6)],
    7: [learnSpell('wiz_sp4', 'wizard', 4, 'Learn a 4th-level spell')],
    8: [asi(8)],
    9: [learnSpell('wiz_sp5', 'wizard', 5, 'Learn a 5th-level spell')],
    10: [asi(10), milestone(10)],
    11: [learnSpell('wiz_sp6', 'wizard', 6, 'Learn a 6th-level spell')],
    12: [asi(12)],
    13: [learnSpell('wiz_sp7', 'wizard', 7, 'Learn a 7th-level spell')],
    14: [asi(14), milestone(14)],
    15: [learnSpell('wiz_sp8', 'wizard', 8, 'Learn an 8th-level spell')],
    16: [asi(16)],
    17: [learnSpell('wiz_sp9', 'wizard', 9, 'Mastery: 9th-level spell')],
    18: [asi(18), milestone(18), auto('spellMastery')],
    19: [learnSpell('wiz_sp9b', 'wizard', 9, 'Mastery: high-tier spell')],
    20: [asi(20), auto('signatureSpells')]
  },
  barbarian: {
    1: [auto('rage')],
    2: [auto('recklessAttack')],
    3: [subclass()],
    4: [asi(4)],
    5: [auto('extraAttack')],
    6: [milestone(6)],
    7: [auto('brutalCritical')],
    8: [asi(8)],
    9: [],
    10: [asi(10), milestone(10)],
    11: [auto('relentlessRage')],
    12: [asi(12)],
    13: [auto('brutalCritical2')],
    14: [asi(14), milestone(14)],
    15: [auto('persistentRage')],
    16: [asi(16)],
    17: [auto('brutalCritical3')],
    18: [asi(18), auto('indomitableMight'), milestone(18)],
    19: [],
    20: [asi(20), auto('primalChampion')]
  },
  bard: {
    /* Only three picks at level 1: healer classes are handed Cure Wounds for
       free (grantHealerCureWounds), and that free spell counts toward the
       SRD's four-spells-known. */
    1: [auto('bardicInspiration'),
        learnSpell('brd_kn1a', 'bard', 1), learnSpell('brd_kn1b', 'bard', 1),
        learnSpell('brd_kn1c', 'bard', 1)],
    2: [auto('jackOfAllTrades'), auto('songOfRest'), learnSpell('brd_kn2', 'bard', 1)],
    3: [subclass(), learnSpell('brd_kn3', 'bard', 2)],
    4: [asi(4), learnSpell('brd_kn4', 'bard', 2)],
    5: [learnSpell('brd_kn5', 'bard', 3)],
    6: [milestone(6), learnSpell('brd_kn6', 'bard', 3)],
    7: [learnSpell('brd_kn7', 'bard', 4)],
    8: [asi(8), learnSpell('brd_kn8', 'bard', 4)],
    9: [learnSpell('brd_kn9', 'bard', 5)],
    10: [asi(10), milestone(10),
         learnSpell('brd_kn10a', 'bard', 5), learnSpell('brd_kn10b', 'bard', 5)],
    11: [learnSpell('brd_kn11', 'bard', 6)],
    12: [asi(12)],
    13: [learnSpell('brd_kn13', 'bard', 7)],
    14: [asi(14), milestone(14),
         learnSpell('brd_kn14a', 'bard', 7), learnSpell('brd_kn14b', 'bard', 7)],
    15: [auto('inspiredPerformance'), learnSpell('brd_kn15', 'bard', 8)],
    16: [asi(16)],
    17: [learnSpell('brd_kn17', 'bard', 9)],
    18: [asi(18), milestone(18),
         learnSpell('brd_kn18a', 'bard', 9), learnSpell('brd_kn18b', 'bard', 9)],
    19: [],
    20: [asi(20), auto('superiorInspiration')]
  },
  druid: {
    1: [wildShapeFormChoice(), learnSpell('druid_sp1', 'druid', 1)],
    2: [auto('wildShapeClass')],
    3: [subclass(), learnSpell('druid_sp2', 'druid', 2)],
    4: [asi(4)],
    5: [learnSpell('druid_sp3', 'druid', 3)],
    6: [milestone(6)],
    7: [learnSpell('druid_sp4', 'druid', 4, 'Learn a 4th-level spell')],
    8: [asi(8)],
    9: [learnSpell('druid_sp5', 'druid', 5, 'Learn a 5th-level spell')],
    10: [asi(10), milestone(10)],
    11: [learnSpell('druid_sp6', 'druid', 6, 'Learn a 6th-level spell')],
    12: [asi(12)],
    13: [learnSpell('druid_sp7', 'druid', 7, 'Learn a 7th-level spell')],
    14: [asi(14), milestone(14)],
    15: [learnSpell('druid_sp8', 'druid', 8, 'Learn an 8th-level spell')],
    16: [asi(16)],
    17: [learnSpell('druid_sp9', 'druid', 9, 'Archdruid: 9th-level spell')],
    18: [asi(18), milestone(18), auto('beastSpells')],
    19: [learnSpell('druid_sp9b', 'druid', 9, 'Archdruid: high-tier spell')],
    20: [asi(20), auto('archdruid')]
  },
  monk: {
    1: [auto('martialArts'), auto('ki')],
    2: [auto('flurryOfBlows'), auto('patientDefense'), auto('stepOfTheWind')],
    3: [subclass()],
    4: [asi(4)],
    5: [auto('extraAttack'), auto('stunningStrike')],
    6: [milestone(6)],
    7: [auto('stillMind')],
    8: [asi(8)],
    9: [],
    10: [asi(10), milestone(10)],
    11: [],
    12: [asi(12)],
    13: [auto('tongueSunMoon')],
    14: [asi(14), milestone(14), auto('diamondSoul')],
    15: [],
    16: [asi(16)],
    17: [],
    18: [asi(18), milestone(18), auto('emptyBody')],
    19: [],
    20: [asi(20), auto('perfectSelf')]
  },
  paladin: {
    1: [auto('divineSmite'), auto('layOnHands')],
    2: [fightingStyle('fs_paladin', FS_MELEE), learnSpell('pal_sp1', 'paladin', 1, 'Learn a 1st-level prayer'), learnSpell('pal_sp1b', 'paladin', 1, 'Learn another 1st-level prayer')],
    3: [subclass(), learnSpell('pal_sp1c', 'paladin', 1, 'Learn a 1st-level prayer')],
    4: [asi(4)],
    5: [auto('extraAttack'), learnSpell('pal_sp2', 'paladin', 2, 'Learn a 2nd-level prayer')],
    6: [auto('auraProtection'), milestone(6)],
    7: [auto('divineHealth'), learnSpell('pal_sp2b', 'paladin', 2, 'Learn a 2nd-level prayer')],
    8: [asi(8)],
    9: [learnSpell('pal_sp3', 'paladin', 3, 'Learn a 3rd-level prayer')],
    10: [asi(10), milestone(10)],
    11: [auto('improvedDivineSmite'), learnSpell('pal_sp3b', 'paladin', 3, 'Higher prayer')],
    12: [asi(12)],
    13: [learnSpell('pal_sp4', 'paladin', 4, 'Learn a 4th-level prayer')],
    14: [asi(14), milestone(14), auto('cleansingTouch')],
    15: [learnSpell('pal_sp4b', 'paladin', 4, 'Learn a 4th-level prayer')],
    16: [asi(16)],
    17: [learnSpell('pal_sp5', 'paladin', 5, 'Learn a 5th-level prayer')],
    18: [asi(18), milestone(18), auto('auraImproved')],
    19: [learnSpell('pal_sp5b', 'paladin', 5, 'Learn a 5th-level prayer')],
    20: [asi(20), auto('oathCapstone')]
  },
  ranger: {
    1: [auto('favoredEnemy'), auto('naturalExplorer')],
    2: [fightingStyle('fs_ranger', FS_RANGED), learnSpell('rng_sp1', 'ranger', 1, 'Learn a 1st-level spell'), learnSpell('rng_sp1b', 'ranger', 1, 'Learn another 1st-level spell')],
    3: [subclass(), learnSpell('rng_sp1c', 'ranger', 1, 'Learn a 1st-level spell')],
    4: [asi(4)],
    5: [auto('extraAttack'), learnSpell('rng_sp2', 'ranger', 2, 'Learn a 2nd-level spell')],
    6: [milestone(6)],
    7: [auto('primevalAwareness'), learnSpell('rng_sp2b', 'ranger', 2, 'Learn a 2nd-level spell')],
    8: [asi(8)],
    9: [learnSpell('rng_sp3', 'ranger', 3, 'Learn a 3rd-level spell')],
    10: [asi(10), milestone(10), auto('colossusSlayerClass')],
    11: [learnSpell('rng_sp3b', 'ranger', 3, 'Learn a 3rd-level spell')],
    12: [asi(12)],
    13: [learnSpell('rng_sp4', 'ranger', 4, 'Learn a 4th-level spell')],
    14: [asi(14), milestone(14), auto('vanish')],
    15: [learnSpell('rng_sp4b', 'ranger', 4, 'Learn a 4th-level spell')],
    16: [asi(16)],
    17: [learnSpell('rng_sp5', 'ranger', 5, 'Learn a 5th-level spell')],
    18: [asi(18), milestone(18), auto('feralSenses')],
    19: [learnSpell('rng_sp5b', 'ranger', 5, 'Learn a 5th-level spell')],
    20: [asi(20), auto('foeSlayer')]
  },
  sorcerer: {
    1: [auto('tidesOfChaos'),
        learnSpell('sor_kn1a', 'sorcerer', 1), learnSpell('sor_kn1b', 'sorcerer', 1)],
    2: [auto('fontOfMagic'), learnSpell('sor_kn2', 'sorcerer', 1)],
    3: [subclass(), auto('metamagic'), learnSpell('sor_kn3', 'sorcerer', 2)],
    4: [asi(4), learnSpell('sor_kn4', 'sorcerer', 2)],
    5: [learnSpell('sor_kn5', 'sorcerer', 3)],
    6: [milestone(6), learnSpell('sor_kn6', 'sorcerer', 3)],
    7: [learnSpell('sor_kn7', 'sorcerer', 4)],
    8: [asi(8), learnSpell('sor_kn8', 'sorcerer', 4)],
    9: [learnSpell('sor_kn9', 'sorcerer', 5, 'Learn a 5th-level spell')],
    10: [asi(10), milestone(10), learnSpell('sor_kn10', 'sorcerer', 5)],
    11: [],
    12: [asi(12), learnSpell('sor_kn12', 'sorcerer', 6, 'Learn a 6th-level spell')],
    13: [],
    14: [asi(14), milestone(14), learnSpell('sor_kn14', 'sorcerer', 7, 'Learn a 7th-level spell')],
    15: [],
    16: [asi(16), learnSpell('sor_kn16', 'sorcerer', 8, 'Learn an 8th-level spell')],
    17: [auto('metamagicExpert')],
    18: [asi(18), milestone(18), learnSpell('sor_kn18', 'sorcerer', 9, 'Mastery: 9th-level spell')],
    19: [],
    20: [asi(20), auto('sorcerousRestoration')]
  },
  /* Spells known follow the SRD warlock curve exactly: 2 at level 1, then one
     per level to 9, then one every other level (11/13/15/17/19) — 15 by 20.
     The tier tracks the pact slot level (1st at L1-2, 2nd at L3-4, 3rd at
     L5-6, 4th at L7-8, 5th from L9), so every spell learned is castable.
     Invocations and Mystic Arcanum are picks, never handouts. */
  warlock: {
    1: [auto('pactMagic'), auto('eldritchBlast'),
        learnSpell('wlk_kn1a', 'warlock', 1), learnSpell('wlk_kn1b', 'warlock', 1)],
    2: [invocation('wlk_inv2a'), invocation('wlk_inv2b'), learnSpell('wlk_kn2', 'warlock', 1)],
    3: [subclass(), learnSpell('wlk_kn3', 'warlock', 2)],
    4: [asi(4), learnSpell('wlk_kn4', 'warlock', 2)],
    5: [invocation('wlk_inv5'), learnSpell('wlk_kn5', 'warlock', 3)],
    6: [milestone(6), learnSpell('wlk_kn6', 'warlock', 3)],
    7: [invocation('wlk_inv7'), learnSpell('wlk_kn7', 'warlock', 4)],
    8: [asi(8), learnSpell('wlk_kn8', 'warlock', 4)],
    9: [invocation('wlk_inv9'), learnSpell('wlk_kn9', 'warlock', 5)],
    10: [asi(10), milestone(10)],
    11: [arcanum('wlk_arc6', 6), learnSpell('wlk_kn11', 'warlock', 5)],
    12: [asi(12), invocation('wlk_inv12')],
    13: [arcanum('wlk_arc7', 7), learnSpell('wlk_kn13', 'warlock', 5)],
    14: [asi(14), milestone(14)],
    15: [arcanum('wlk_arc8', 8), invocation('wlk_inv15'), learnSpell('wlk_kn15', 'warlock', 5)],
    16: [asi(16)],
    17: [arcanum('wlk_arc9', 9), learnSpell('wlk_kn17', 'warlock', 5)],
    18: [asi(18), milestone(18), invocation('wlk_inv18')],
    19: [learnSpell('wlk_kn19', 'warlock', 5)],
    20: [asi(20), auto('eldritchMaster')]
  }
};

/* ================================================================
   Spell slots by caster progression — SRD 5.1 leveled slot tables.
   Slots are objects keyed by spell level: { 1:4, 2:3, 3:2 }.
   No upcasting: casting consumes the lowest slot ≥ the spell's level.
   ================================================================ */
const FULL_CASTER_SLOTS = [
  null,
  { 1:2 },                                              // 1
  { 1:3 },                                              // 2
  { 1:4, 2:2 },                                         // 3
  { 1:4, 2:3 },                                         // 4
  { 1:4, 2:3, 3:2 },                                    // 5
  { 1:4, 2:3, 3:3 },                                    // 6
  { 1:4, 2:3, 3:3, 4:1 },                               // 7
  { 1:4, 2:3, 3:3, 4:2 },                               // 8
  { 1:4, 2:3, 3:3, 4:3, 5:1 },                          // 9
  { 1:4, 2:3, 3:3, 4:3, 5:2 },                          // 10
  { 1:4, 2:3, 3:3, 4:3, 5:2, 6:1 },                     // 11
  { 1:4, 2:3, 3:3, 4:3, 5:2, 6:1 },                     // 12
  { 1:4, 2:3, 3:3, 4:3, 5:2, 6:1, 7:1 },                // 13
  { 1:4, 2:3, 3:3, 4:3, 5:2, 6:1, 7:1 },                // 14
  { 1:4, 2:3, 3:3, 4:3, 5:2, 6:1, 7:1, 8:1 },           // 15
  { 1:4, 2:3, 3:3, 4:3, 5:2, 6:1, 7:1, 8:1 },           // 16
  { 1:4, 2:3, 3:3, 4:3, 5:2, 6:1, 7:1, 8:1, 9:1 },      // 17
  { 1:4, 2:3, 3:3, 4:3, 5:3, 6:1, 7:1, 8:1, 9:1 },      // 18
  { 1:4, 2:3, 3:3, 4:3, 5:3, 6:2, 7:1, 8:1, 9:1 },      // 19
  { 1:4, 2:3, 3:3, 4:3, 5:3, 6:2, 7:2, 8:1, 9:1 },      // 20
];

/** Warlock Pact Magic: all slots share one level; recharge on short rest. */
function pactSlotsFor(level) {
  const count = level >= 17 ? 4 : (level >= 11 ? 3 : (level >= 2 ? 2 : 1));
  const slotLevel = level >= 9 ? 5 : (level >= 7 ? 4 : (level >= 5 ? 3 : (level >= 3 ? 2 : 1)));
  return { [slotLevel]: count };
}

/** Leveled slots for a class at a level. Empty object for non-casters. */
export function spellSlotsFor(classKey, level) {
  const full = ['wizard', 'cleric', 'druid', 'bard', 'sorcerer'];
  const half = ['paladin', 'ranger'];
  if (classKey === 'warlock') return pactSlotsFor(level);
  if (full.includes(classKey)) return { ...FULL_CASTER_SLOTS[Math.max(1, Math.min(20, level))] };
  if (half.includes(classKey)) {
    if (level < 2) return {};
    return { ...FULL_CASTER_SLOTS[Math.max(1, Math.min(20, Math.ceil(level / 2)))] };
  }
  return {};
}

/* ── slot-pool helpers (tolerate legacy numeric pools, e.g. boss fake-casters) ── */

/** Total slots across all levels (works on slots or slotsMax). */
export function totalSlots(s) {
  if (!s) return 0;
  if (typeof s === 'number') return s;
  let t = 0;
  for (const k in s) t += s[k];
  return t;
}

/** True if a slot of level ≥ lvl is available. */
export function hasSlotFor(d, lvl = 1) {
  const s = d.slots;
  if (!s) return false;
  if (typeof s === 'number') return s > 0;
  for (const k in s) if (+k >= lvl && s[k] > 0) return true;
  return false;
}

/** Spend the LOWEST available slot of level ≥ lvl (high slots are conserved
 *  for high spells). Returns the slot level spent, or 0 if none. */
export function spendSlotFor(d, lvl = 1) {
  const s = d.slots;
  if (typeof s === 'number') { if (s > 0) { d.slots = s - 1; return lvl; } return 0; }
  if (!s) return 0;
  let best = 0;
  for (const k in s) {
    const kl = +k;
    if (kl >= lvl && s[k] > 0 && (best === 0 || kl < best)) best = kl;
  }
  if (!best) return 0;
  s[best]--;
  return best;
}

/** Recover up to n expended slots, lowest level first. Returns count restored. */
export function recoverSlots(d, n = 1) {
  if (!d.slotsMax || typeof d.slotsMax === 'number') return 0;
  if (!d.slots || typeof d.slots === 'number') { d.slots = { ...d.slotsMax }; return n; }
  let restored = 0;
  const lvls = Object.keys(d.slotsMax).map(Number).sort((a, b) => a - b);
  for (const lv of lvls) {
    while (restored < n && (d.slots[lv] || 0) < d.slotsMax[lv]) {
      d.slots[lv] = (d.slots[lv] || 0) + 1;
      restored++;
    }
    if (restored >= n) break;
  }
  return restored;
}

/** Display string like "L1 3/4 · L2 2/3" for tooltips / menus. */
export function slotBreakdown(slots, slotsMax) {
  if (!slotsMax || typeof slotsMax === 'number') return '';
  const lvls = Object.keys(slotsMax).map(Number).sort((a, b) => a - b);
  return lvls.map(lv => `L${lv} ${(slots && slots[lv]) || 0}/${slotsMax[lv]}`).join(' · ');
}

export function isCasterClass(classKey) {
  return totalSlots(spellSlotsFor(classKey, 20)) > 0;
}

/* ── per-feature charge pools ──────────────────────────────────────────────
   Every limited-use feature owns a pool keyed by its feature key, stored on
   h.charges. Before this, all short-rest features shared a single
   `abilityUsed.short` boolean, so a druid who Wild Shaped also greyed out
   Flurry, Bardic Inspiration and every short-rest spell — the HUD drew N
   independent-looking icons for what was really one charge.

   Anything not listed defaults to one use per short rest, which is what the
   old shared flag already promised per feature. */
const CHARGE_DEFS = {
  rage:               { max: 'pb', recharge: 'long' },
  wildShapeClass:     { max: 'pb', recharge: 'short' },
  /* Flurry of Blows and Patient Defense deliberately share one pool — the
     game's simplified ki model (see runCombatReflexes in combat.js). */
  flurryOfBlows:      { max: 'pb', recharge: 'short' },
  bardicInspiration:  { max: 'pb', recharge: 'short' },
  indomitable:        { max: 1, recharge: 'long' },
  rallyingCry:        { max: 1, recharge: 'long' },
  preserveLife:       { max: 1, recharge: 'long' },
  tidesOfChaos:       { max: 1, recharge: 'long' },
  lucky:              { max: 3, recharge: 'long' },
  fiendishBlessing:   { max: 1, recharge: 'short' },
  feyPresence:        { max: 1, recharge: 'short' },
  dragonBreath:       { max: 1, recharge: 'short' },
  wildSurge:          { max: 1, recharge: 'short' },
  combatInspiration:  { max: 1, recharge: 'short' },
  cuttingWords:       { max: 1, recharge: 'short' },
  bearTotem:          { max: 1, recharge: 'short' },
  quiveringPalm:      { max: 1, recharge: 'short' },
  shadowStep:         { max: 1, recharge: 'short' },
  radiantFlare:       { max: 1, recharge: 'short' },
  blindingFlash:      { max: 1, recharge: 'short' },
  sacredWeapon:       { max: 1, recharge: 'short' },
  vowOfEnmity:        { max: 1, recharge: 'short' },
  colossusSlayer:     { max: 1, recharge: 'short' },
  summonCompanion:    { max: 1, recharge: 'short' },
  frenzy:             { max: 1, recharge: 'short' },
  entangle:           { max: 1, recharge: 'short' },
  actionSurgeClass:   { max: 1, recharge: 'short' },
  secondWindClass:    { max: 1, recharge: 'short' },
  fastHands:          { max: 1, recharge: 'short' },
  remarkableAthlete:  { max: 1, recharge: 'short' },
  deathstrike:        { max: 1, recharge: 'short' },
  guidedStrike:       { max: 1, recharge: 'short' }
};

const DEFAULT_CHARGE = { max: 1, recharge: 'short' };

/** Pool shape for a charge key. `spell:<key>` inherits the spell's recharge. */
export function chargeDef(key, hero) {
  const level = hero ? (hero.level || (hero.data && hero.data.level) || 1) : 1;
  const pb = profBonus(level);

  let def = CHARGE_DEFS[key];
  if (!def) {
    /* Mystic Arcanum: one casting per long rest, per arcanum, on its own pool
       — deliberately not a pact slot, which caps at 5th level forever. */
    if (typeof key === 'string' && key.startsWith('arcanum:')) {
      return { max: 1, recharge: 'long' };
    }
    if (typeof key === 'string' && key.startsWith('spell:')) {
      const sp = SPELLS[key.slice(6)];
      const long = sp && (sp.recharge === 'long' || sp.recharge === 'day');
      return { max: long ? 1 : pb, recharge: long ? 'long' : 'short' };
    }
    def = DEFAULT_CHARGE;
  }

  const max = def.max === 'pb' ? pb : (typeof def.max === 'number' ? def.max : pb);
  return { max, recharge: def.recharge };
}

export function chargeMax(key, hero) {
  return chargeDef(key, hero).max;
}

/** Remaining charges, lazily seeding the pool at full on first read. */
export function chargesLeft(h, key) {
  if (!h) return 0;
  const d = h.data || h;
  if (!d.charges) d.charges = {};
  const max = chargeMax(key, d);
  if (d.charges[key] === undefined) d.charges[key] = max;
  return Math.max(0, Math.min(d.charges[key], max));
}

export function hasCharge(h, key) {
  return chargesLeft(h, key) > 0;
}

/** Spend one charge. Returns false (and spends nothing) when the pool is dry. */
export function spendCharge(h, key) {
  if (!h) return false;
  const d = h.data || h;
  if (!hasCharge(d, key)) return false;
  d.charges[key]--;
  return true;
}

/** Refill pools on rest: a short rest refills short pools, a long rest all. */
export function restoreCharges(h, bucket) {
  if (!h) return;
  const d = h.data || h;
  if (!d.charges) { d.charges = {}; return; }
  for (const key of Object.keys(d.charges)) {
    const def = chargeDef(key, d);
    if (bucket === 'long' || def.recharge === 'short') d.charges[key] = def.max;
  }
}

/* ── Ki Points Pool (Monk = level >= 2, short/long rest recharge) ── */

/** Remaining Ki points. */
export function kiLeft(h) {
  if (!h) return 0;
  const d = h.data || h;
  if (d.ki === undefined) {
    d.ki = d.kiMax !== undefined ? d.kiMax : (d.level >= 2 ? d.level : 0);
  }
  return Math.max(0, d.ki || 0);
}

export function hasKi(h, cost = 1) {
  return kiLeft(h) >= cost;
}

export function spendKi(h, cost = 1) {
  if (!h) return false;
  const d = h.data || h;
  if (!hasKi(d, cost)) return false;
  d.ki = (d.ki || 0) - cost;
  return true;
}

export function restoreKi(h, amount) {
  if (!h) return 0;
  const d = h.data || h;
  const max = d.kiMax !== undefined ? d.kiMax : (d.level >= 2 ? d.level : 0);
  const before = d.ki || 0;
  d.ki = amount !== undefined ? Math.min(max, (d.ki || 0) + amount) : max;
  return d.ki - before;
}

/* ================================================================
   Hero helpers
   ================================================================ */
export function hasFeature(h, key) {
  if (!h) return false;
  const d = h.data || h;
  return !!((d.features && d.features.includes(key)) || (d.invocations && d.invocations.includes(key)));
}

export function hasFeat(h, key) {
  if (!h) return false;
  const d = h.data || h;
  return !!(d.feats && d.feats.includes(key));
}

/** Aggregate passive bonuses from features, feats, fighting style, subclass milestones. */
export function featureBonuses(h) {
  const total = {};
  const add = (pb) => {
    if (!pb) return;
    for (const k in pb) total[k] = (total[k] || 0) + pb[k];
  };

  for (const key of h.features || []) {
    /* legacy saves can still carry an invocation key in `features` — it was an
       automatic grant before invocations became a pick */
    const f = FEATURES[key] || INVOCATIONS[key];
    if (f) add(f.pb);
  }
  for (const key of h.invocations || []) {
    const inv = INVOCATIONS[key];
    if (inv) add(inv.pb);
  }
  for (const key of h.feats || []) {
    const f = FEATS[key];
    if (f) {
      add(f.pb);
      if (f.hpPerLevel) total.hp = (total.hp || 0) + f.hpPerLevel * h.level;
    }
  }
  if (h.fightingStyle && FIGHTING_STYLES[h.fightingStyle]) {
    add(FIGHTING_STYLES[h.fightingStyle].pb);
  }
  /* subclass milestone passives stored as feature keys sc6_* / sc10_* */
  if (h.subclassMilestones) {
    for (const m of h.subclassMilestones) add(m.pb);
  }
  return total;
}

export function initProgressionFields(h) {
  if (!h.features) h.features = [];
  if (!h.feats) h.feats = [];
  if (!h.knownSpells) h.knownSpells = [];
  if (!h.invocations) h.invocations = [];
  if (!h.arcana) h.arcana = [];
  if (!h.pendingChoices) h.pendingChoices = [];
  if (!h.resolvedChoices) h.resolvedChoices = [];
  if (!h.subclassMilestones) h.subclassMilestones = [];
  if (h.fightingStyle === undefined) h.fightingStyle = null;
  if (h.spellCd === undefined) h.spellCd = {};
  if (!h.skillRanks) h.skillRanks = {};
  if (h.pendingSkillRank === undefined) h.pendingSkillRank = 0;
  if (h.pendingSkill === undefined) h.pendingSkill = 0;
  if (h.progressionVersion === undefined) h.progressionVersion = 0;
  if (!h.charges) h.charges = {};
  grantHealerCureWounds(h);
}

/* Healer classes know Cure Wounds for free from level 1. It used to be a
   bespoke `healSlots` pool (WIS-mod casts, spent in its own combat branch)
   running alongside the identically-named level-1 slot spell — two Cure
   Wounds on two currencies, which is what made the HUD counts disagree. Now
   there is only the spell, so healers must actually start with it rather than
   waiting to draw it from a choice pool. queueChoice already filters out
   known spells, so this costs them no pick. */
export function grantHealerCureWounds(h) {
  if (!h || !CLASSES[h.classKey]?.healer) return;
  if (!h.knownSpells) h.knownSpells = [];
  if (!h.knownSpells.includes('cureWounds') && SPELLS['cureWounds']) {
    h.knownSpells.push('cureWounds');
  }
}

function unlockFeature(h, key, log = null) {
  initProgressionFields(h);
  if (h.features.includes(key)) return;
  h.features.push(key);
  const feat = FEATURES[key];
  if (log && feat) log(`✨ ${h.name} unlocked feature: ${feat.label}`, 'feature');
  if (key === 'secondWind') h.secondWind = true;
}

function queueChoice(h, grant) {
  /* don't double-queue the same choice id or re-queue already resolved choice */
  if (h.resolvedChoices && h.resolvedChoices.includes(grant.id)) return;
  if (h.pendingChoices.some(c => c.id === grant.id)) return;
  const choice = { ...grant };
  choice.options = buildChoiceOptions(h, grant);
  /* a pick with nothing left to offer is not a pick */
  if (choice.options && choice.options.length === 0) return;
  h.pendingChoices.push(choice);
}

/* Options for a grant, against the hero's CURRENT state. Must be recomputed
   whenever that state changes: a level granting two picks from one pool (the
   warlock's two level-1 spells, its two level-2 invocations) would otherwise
   show the second pick a list still containing what the first one just took,
   and picking it twice would quietly burn the pick. */
function buildChoiceOptions(h, grant) {
  if (grant.pick === 'asiOrFeat') {
    return buildAsiFeatOptions(h);
  }
  if (grant.pick === 'fightingStyle') {
    return (grant.styles || Object.keys(FIGHTING_STYLES)).map(k => ({
      key: k,
      label: FIGHTING_STYLES[k].label,
      desc: FIGHTING_STYLES[k].desc
    }));
  }
  if (grant.pick === 'spell') {
    return spellOptions(h, grant.classKey, grant.tier);
  }
  if (grant.pick === 'invocation') {
    const level = Math.max(1, h.level || 1);
    return Object.entries(INVOCATIONS)
      .filter(([k, inv]) => !(h.invocations || []).includes(k)
                         && !(h.features || []).includes(k)
                         && level >= (inv.minLevel || 1))
      .map(([k, inv]) => ({ key: k, label: inv.label, desc: inv.desc }));
  }
  if (grant.pick === 'arcanum') {
    /* Arcanum draws from exactly its own tier — the whole point is a spell far
       above what a 5th-level pact slot could ever pay for. */
    const pool = (SPELL_POOLS[grant.classKey] && SPELL_POOLS[grant.classKey][grant.tier]) || [];
    return pool
      .filter(k => SPELLS[k] && !h.knownSpells.includes(k) && !(h.arcana || []).includes(k))
      .map(k => ({
        key: k,
        label: SPELLS[k].label,
        desc: `L${SPELLS[k].level} — ${SPELLS[k].desc} (once per long rest)`
      }));
  }
  if (grant.pick === 'wildShapeForm') {
    return Object.values(WILD_SHAPE_FORMS).map(wf => ({
      key: wf.key,
      label: `${wf.icon} ${wf.label}`,
      desc: wf.desc
    }));
  }
  return null;
}

/* Re-materialize every still-pending pick against current state, dropping any
   that no longer has anything to offer. */
function refreshPendingOptions(h) {
  const kept = [];
  for (const c of h.pendingChoices) {
    const opts = buildChoiceOptions(h, c);
    if (opts && opts.length === 0) {
      if (!h.resolvedChoices.includes(c.id)) h.resolvedChoices.push(c.id);
      continue;
    }
    if (opts) c.options = opts;
    kept.push(c);
  }
  h.pendingChoices = kept;
}

/* Spells a hero may still learn at a tier. A tier pool can run dry — the
   warlock's 5th-tier list is a single spell but is drawn from five times — and
   an empty option list makes queueChoice drop the pick silently, quietly
   eating a level-up reward. So fall back through the lower tiers, which is
   also just SRD-legal: you may always learn a spell below your maximum. */
function spellOptions(h, classKey, tier) {
  const byClass = SPELL_POOLS[classKey] || {};
  const seen = new Set();
  const opts = [];
  for (let t = tier; t >= 1; t--) {
    for (const k of (byClass[t] || [])) {
      if (seen.has(k) || !SPELLS[k]) continue;
      if (h.knownSpells.includes(k)) continue;
      seen.add(k);
      opts.push({ key: k, label: SPELLS[k].label, desc: `L${SPELLS[k].level} — ${SPELLS[k].desc}` });
    }
    /* Only reach down a tier when this one had nothing left to offer. */
    if (opts.length) break;
  }
  return opts;
}

function buildAsiFeatOptions(h) {
  const opts = [];
  /* Single ASI option: banks 2 ability points the player allots however they
     like on the character sheet's stat tab (the existing pendingAbility UI).
     Only offered while at least one stat is still below the cap of 20. */
  if (ABILITIES.some(ab => h.stats[ab] < 20)) {
    opts.push({
      key: 'asi',
      label: 'Ability Score Improvement',
      desc: 'Gain 2 ability points to allot among your stats (cap 20).',
      kind: 'asi',
      /* Two, per the SRD: an ASI is +2 to one score or +1 to two. Banking the
         pair and letting spendAbilityPoint apply them one at a time covers both
         splits without a separate UI. This read 1, against the comment directly
         above it, so every ASI level was worth half of what it should be. */
      amount: 2
    });
  }
  /* Effective equipment tiers = best of class (stamped on the hero in recalc)
     and any feats already taken. Used to gate the proficiency-feat ladder. */
  const grants = equipmentGrants(h);
  const effArmor = Math.max(h._baseArmorRank || 0, grants.armorRank);
  const effMartial = !!h._baseWeaponMartial || grants.weaponMartial;

  for (const [key, feat] of Object.entries(FEATS)) {
    if (h.feats.includes(key)) continue;
    if (feat.castersOnly && !isCasterClass(h.classKey)) continue;
    if (feat.meleeOnly && !MELEE_CLASSES.has(h.classKey)) continue;
    /* Armor ladder: only offer the rung exactly one above the current tier
       (none→light→medium→heavy), so it can never be redundant or skipped. */
    if (feat.grantArmor && ARMOR_GRANT_RANK[feat.grantArmor] !== effArmor + 1) continue;
    /* Weapon proficiency: only offer if not already martial-proficient. */
    if (feat.grantWeapon === 'martial' && effMartial) continue;
    opts.push({
      key: `feat_${key}`,
      label: feat.label,
      desc: feat.desc,
      kind: 'feat',
      feat: key
    });
  }
  return opts;
}

function applySubclassMilestone(h, level, log) {
  if (!h.subclass) return;
  const table = SUBCLASS_MILESTONES[h.classKey];
  if (!table || !table[h.subclass] || !table[h.subclass][level]) return;
  const m = table[h.subclass][level];
  /* avoid duplicates */
  if (h.subclassMilestones.some(x => x.level === level)) return;
  h.subclassMilestones.push({ level, label: m.label, pb: m.pb || {} });
  if (log) log(`🌟 ${h.name}'s path deepens: ${m.label}!`, 'level');
}

/**
 * Does this class level hand out a talent point?  Every odd level does.  Even
 * levels normally carry a choice (ASI/feat, spell, fighting style, invocation,
 * subclass) — when the class table has nothing but auto features or a silent
 * subclass milestone (e.g. martial L2, most classes at L6), the talent tree is
 * the fallback so no level-up ever passes without a decision to make.
 */
export function levelGrantsTalent(classKey, level) {
  if (level % 2 === 1) return true;
  const grants = (CLASS_PROGRESSION[classKey] && CLASS_PROGRESSION[classKey][level]) || [];
  return !grants.some(g => g.type === 'choice' || g.type === 'subclass');
}

/** Total talent points a hero of this class should have earned by `level`. */
export function talentPointsThrough(classKey, level) {
  let n = 0;
  for (let lv = 1; lv <= Math.max(1, level); lv++) if (levelGrantsTalent(classKey, lv)) n++;
  return n;
}

/**
 * Apply all grants for a single level.
 * @param {object} h hero data
 * @param {number} level
 * @param {function|null} log
 * @param {{ autosOnly?: boolean }} opts  autosOnly = migrate old saves without flooding choices
 */
export function applyLevelGrants(h, level, log = null, opts = {}) {
  initProgressionFields(h);
  const table = CLASS_PROGRESSION[h.classKey];
  const grants = (table && table[level]) || [];

  /* Every level-up (not initial creation at level 1) grants skill points for the
     5e skill checks — Athletics, Investigation, Animal Handling, … — regardless
     of class. Migration/re-apply must not double-bank points. */
  if (level > 1 && !opts.autosOnly) {
    h.pendingSkillRank = (h.pendingSkillRank || 0) + SKILL_POINTS_PER_LEVEL;
    if (log) log(`📘 ${h.name} gained ${SKILL_POINTS_PER_LEVEL === 1 ? '1 skill point' : `${SKILL_POINTS_PER_LEVEL} skill points`}.`, 'level');
  }

  /* Class talents: 1 point on every odd level (including level 1), plus any
     even level where the class table offers no choice — see levelGrantsTalent. */
  if (!opts.autosOnly && levelGrantsTalent(h.classKey, level)) {
    h.pendingSkill = (h.pendingSkill || 0) + 1;
    if (log) log(`⭐ ${h.name} gained a talent point.`, 'level');
  }

  if (!grants.length) return;
  for (const grant of grants) {
    if (grant.type === 'auto') {
      unlockFeature(h, grant.feature, log);
    } else if (grant.type === 'subclass') {
      /* handled by needsSubclass / pickSubclass — just notify */
      if (log && !h.subclass && !opts.autosOnly) log(`🌟 ${h.name} may choose a subclass!`, 'level');
    } else if (grant.type === 'subclassMilestone') {
      applySubclassMilestone(h, grant.level, log);
    } else if (grant.type === 'choice') {
      if (!opts.autosOnly) queueChoice(h, grant);
    }
  }
}

/** Seed progression for a brand-new level-1 hero (includes L1 choices). */
export function seedNewHeroProgression(h, log = null) {
  initProgressionFields(h);
  applyLevelGrants(h, 1, log, { autosOnly: false });
  h.progressionVersion = 1;
}

/**
 * Count total spell choice grants configured for a class up through a given level.
 */
export function countSpellGrantsUpTo(classKey, maxLevel) {
  const table = CLASS_PROGRESSION[classKey];
  if (!table) return 0;
  let count = 0;
  for (let lv = 1; lv <= maxLevel; lv++) {
    const grants = table[lv] || [];
    for (const g of grants) {
      if (g.type === 'choice' && g.pick === 'spell') count++;
    }
  }
  return count;
}

/**
 * Synchronize any missing leveled spell choices for heroes (such as Rangers/Paladins
 * who leveled up under earlier progression tables that had fewer spell grants).
 */
export function syncMissingSpellChoices(h) {
  initProgressionFields(h);
  const table = CLASS_PROGRESSION[h.classKey];
  if (!table) return;

  const currentLevel = Math.max(1, h.level || 1);
  for (let lv = 1; lv <= currentLevel; lv++) {
    const grants = table[lv] || [];
    for (const g of grants) {
      if (g.type === 'choice' && g.pick === 'spell') {
        if (!h.resolvedChoices) h.resolvedChoices = [];
        if (h.resolvedChoices.includes(g.id)) continue;
        if (h.pendingChoices.some(c => c.id === g.id)) continue;

        const totalGrantsSoFar = countSpellGrantsUpTo(h.classKey, lv);
        /* Some knownSpells were never paid for by a grant and must not be
           counted against the entitlement, or they silently swallow picks the
           hero is owed: Mystic Arcanum (its own grants) and the free Cure
           Wounds every healer class starts with (grantHealerCureWounds). */
        const arcana = h.arcana || [];
        const freebies = CLASSES[h.classKey]?.healer ? ['cureWounds'] : [];
        const knownCount = (h.knownSpells || [])
          .filter(k => !arcana.includes(k) && !freebies.includes(k)).length;
        const currentTotal = knownCount + (h.pendingChoices?.filter(c => c.pick === 'spell').length || 0);
        if (currentTotal < totalGrantsSoFar) {
          queueChoice(h, g);
        } else {
          h.resolvedChoices.push(g.id);
        }
      }
    }
  }
}

/** True when this spell is one of the hero's Mystic Arcanum castings. */
export function isArcanum(h, key) {
  if (!h) return false;
  const d = h.data || h;
  return !!(d.arcana && d.arcana.includes(key));
}

/**
 * Count invocation grants configured for a class up through a given level.
 */
export function countInvocationGrantsUpTo(classKey, maxLevel) {
  const table = CLASS_PROGRESSION[classKey];
  if (!table) return 0;
  let count = 0;
  for (let lv = 1; lv <= maxLevel; lv++) {
    for (const g of (table[lv] || [])) {
      if (g.type === 'choice' && g.pick === 'invocation') count++;
    }
  }
  return count;
}

/**
 * Bring a hero built under the old warlock table onto the new one.
 *
 * Invocations used to be automatic grants living in `features`; they are now
 * picks living in `invocations`. Move any the hero already earned across so
 * nothing is lost, then queue only the shortfall — a level-6 warlock who was
 * handed Agonizing Blast and Repelling Blast keeps both and picks the one the
 * SRD says they are still owed, rather than being handed three or reset to
 * zero.
 */
export function syncMissingInvocations(h) {
  initProgressionFields(h);
  const table = CLASS_PROGRESSION[h.classKey];
  if (!table) return;

  /* legacy auto-grants: features that are really invocations */
  for (const key of [...h.features]) {
    if (!INVOCATIONS[key]) continue;
    if (!h.invocations.includes(key)) h.invocations.push(key);
    h.features.splice(h.features.indexOf(key), 1);
  }

  const currentLevel = Math.max(1, h.level || 1);
  for (let lv = 1; lv <= currentLevel; lv++) {
    for (const g of (table[lv] || [])) {
      if (!(g.type === 'choice' && g.pick === 'invocation')) continue;
      if (h.resolvedChoices.includes(g.id)) continue;
      if (h.pendingChoices.some(c => c.id === g.id)) continue;

      const owed = countInvocationGrantsUpTo(h.classKey, lv);
      const have = h.invocations.length
                 + h.pendingChoices.filter(c => c.pick === 'invocation').length;
      if (have < owed) queueChoice(h, g);
      else h.resolvedChoices.push(g.id);
    }
  }
}

/* Old Mystic Arcanum ids were ordinary spell picks; the new ones are their own
   pick type. Without this map a level-13 warlock would be re-offered arcana
   they already chose. */
const LEGACY_ARCANUM_IDS = {
  wlk_arc6: 'wlk_mystic6', wlk_arc7: 'wlk_mystic7',
  wlk_arc8: 'wlk_mystic8', wlk_arc9: 'wlk_mystic9'
};

/**
 * Reclassify already-known high-level warlock spells as Mystic Arcanum. Before
 * this they were learned as ordinary spells and were flatly uncastable: pact
 * slots stop at 5th level, so nothing could ever pay for a 6th+ spell.
 */
export function syncMissingArcana(h) {
  initProgressionFields(h);
  if (h.classKey !== 'warlock') return;

  for (const key of h.knownSpells) {
    const sp = SPELLS[key];
    if (sp && (sp.level || 0) >= 6 && !h.arcana.includes(key)) h.arcana.push(key);
  }
  for (const [newId, oldId] of Object.entries(LEGACY_ARCANUM_IDS)) {
    if (h.resolvedChoices.includes(oldId) && !h.resolvedChoices.includes(newId)) {
      h.resolvedChoices.push(newId);
    }
  }
  /* the level-19 duplicate arcanum is gone; its spell stays known */
  if (h.resolvedChoices.includes('wlk_mystic9b') && !h.resolvedChoices.includes('wlk_kn19')) {
    h.resolvedChoices.push('wlk_kn19');
  }
}

/**
 * Migrate legacy heroes: unlock auto features for levels already gained,
 * do not dump every historical choice on them.
 */
export function migrateProgression(h) {
  initProgressionFields(h);
  /* arcana first: it reclassifies known spells, and the spell-choice sync
     counts knownSpells minus arcana to decide what is still owed */
  syncMissingArcana(h);
  syncMissingInvocations(h);
  syncMissingSpellChoices(h);
  /* A pending pick keeps a SNAPSHOT of its options (label + desc) from the
     moment it was queued, and that snapshot lives in the save. Rebuild it on
     every load so a feat that was renamed, rewritten or removed since the
     hero last levelled is shown as it is now, not as it was. */
  refreshPendingOptions(h);
  if (h.progressionVersion >= 1) return;
  for (let lv = 1; lv <= h.level; lv++) {
    applyLevelGrants(h, lv, null, { autosOnly: true });
    /* still apply subclass milestones if they have a subclass */
    if (h.subclass) {
      const grants = (CLASS_PROGRESSION[h.classKey] || {})[lv] || [];
      for (const g of grants) {
        if (g.type === 'subclassMilestone') applySubclassMilestone(h, g.level, null);
      }
    }
  }
  /* fighters always had second wind flag */
  if (CLASSES[h.classKey]?.secondWind) unlockFeature(h, 'secondWind', null);
  h.progressionVersion = 1;
}

/**
 * Resolve a pending choice. Returns { ok, reason? }.
 * optionKey is the option's `key` field.
 */
export function resolveChoice(h, choiceId, optionKey) {
  initProgressionFields(h);
  const idx = h.pendingChoices.findIndex(c => c.id === choiceId);
  if (idx < 0) return { ok: false, reason: 'Choice not found.' };
  const choice = h.pendingChoices[idx];
  const opt = (choice.options || []).find(o => o.key === optionKey);
  if (!opt) return { ok: false, reason: 'Invalid option.' };

  if (choice.pick === 'asiOrFeat') {
    if (opt.kind === 'asi') {
      h.pendingAbility = (h.pendingAbility || 0) + opt.amount;
    } else if (opt.kind === 'feat') {
      if (!h.feats.includes(opt.feat)) h.feats.push(opt.feat);
    }
  } else if (choice.pick === 'fightingStyle') {
    h.fightingStyle = opt.key;
  } else if (choice.pick === 'spell') {
    if (!h.knownSpells.includes(opt.key)) h.knownSpells.push(opt.key);
  } else if (choice.pick === 'invocation') {
    if (!h.invocations) h.invocations = [];
    if (!h.invocations.includes(opt.key)) h.invocations.push(opt.key);
  } else if (choice.pick === 'arcanum') {
    if (!h.arcana) h.arcana = [];
    if (!h.arcana.includes(opt.key)) h.arcana.push(opt.key);
    /* Also a known spell so it shows up in the caster UI; the arcanum list is
       what tells the cast path to bill it to a charge instead of a slot. */
    if (!h.knownSpells.includes(opt.key)) h.knownSpells.push(opt.key);
    if (h.charges) delete h.charges['arcanum:' + opt.key];
  } else if (choice.pick === 'wildShapeForm') {
    h.wildShapeForm = opt.key;
  } else {
    return { ok: false, reason: 'Unknown choice type.' };
  }

  if (!h.resolvedChoices) h.resolvedChoices = [];
  if (!h.resolvedChoices.includes(choiceId)) h.resolvedChoices.push(choiceId);

  h.pendingChoices.splice(idx, 1);
  refreshPendingOptions(h);
  return { ok: true, choice, opt };
}

export function pendingChoiceCount(h) {
  return (h.pendingChoices || []).length;
}

export function listUnlockedFeatureLabels(h) {
  const out = [];
  for (const key of h.features || []) {
    const f = FEATURES[key] || INVOCATIONS[key];
    if (f) out.push({ key, label: f.label, desc: f.desc });
  }
  for (const key of h.invocations || []) {
    const inv = INVOCATIONS[key];
    if (inv) out.push({ key, label: `Invocation: ${inv.label}`, desc: inv.desc });
  }
  if (h.fightingStyle && FIGHTING_STYLES[h.fightingStyle]) {
    const fs = FIGHTING_STYLES[h.fightingStyle];
    out.push({ key: 'fs', label: `Style: ${fs.label}`, desc: fs.desc });
  }
  for (const key of h.feats || []) {
    const f = FEATS[key];
    if (f) out.push({ key, label: `Feat: ${f.label}`, desc: f.desc });
  }
  for (const m of h.subclassMilestones || []) {
    out.push({ key: `sc${m.level}`, label: m.label, desc: 'Subclass milestone' });
  }
  for (const sp of h.knownSpells || []) {
    const s = SPELLS[sp];
    if (!s) continue;
    if ((h.arcana || []).includes(sp)) {
      out.push({ key: sp, label: `Arcanum: ${s.label}`, desc: `${s.desc} (once per long rest)` });
    } else {
      out.push({ key: sp, label: `Spell: ${s.label}`, desc: s.desc });
    }
  }
  return out;
}
