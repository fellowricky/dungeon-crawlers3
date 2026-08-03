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
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABILITY_LABEL = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };
const MELEE_CLASSES = new Set(['fighter', 'barbarian', 'monk', 'paladin', 'rogue', 'bard']);
/* Skill points banked per level-up, spent on the 5e skill checks (see SKILLS in
   srd.js, which re-exports this). Defined here because srd.js imports us. */
export const SKILL_POINTS_PER_LEVEL = 2;

/* ================================================================
   Fighting styles (Fighter L1, Ranger L2, Paladin L2, etc.)
   ================================================================ */
export const FIGHTING_STYLES = {
  archery:  { label: 'Archery',  desc: '+2 to ranged attack rolls.', pb: { atk: 2 }, rangedOnly: true },
  defense:  { label: 'Defense',  desc: '+1 AC while wearing armor.', pb: { ac: 1 } },
  dueling:  { label: 'Dueling',  desc: '+2 damage with a one-handed melee weapon.', pb: { dmg: 2 }, meleeOnly: true },
  greatWeapon: { label: 'Great Weapon Fighting', desc: '+1 attack and +1 damage with two-handed weapons.', pb: { atk: 1, dmg: 1 }, meleeOnly: true },
  protection: { label: 'Protection', desc: '+1 AC; allies near you gain a soft shield feel.', pb: { ac: 1 } },
  twoWeapon: { label: 'Two-Weapon Fighting', desc: '+1 attack; nimble dual-wield tempo.', pb: { atk: 1 }, meleeOnly: true }
};

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
    label: 'Resilient',
    desc: '+1 AC and +4 max HP.',
    pb: { ac: 1, hp: 4 }
  },
  weaponMaster: {
    label: 'Weapon Master',
    desc: '+1 to attack rolls and weapon damage.',
    pb: { atk: 1, dmg: 1 }
  },
  mobile: {
    label: 'Mobile',
    desc: '+15% move speed and +1 AC while moving through danger.',
    pb: { speed: 0.15, ac: 1 }
  },
  alert: {
    label: 'Alert',
    desc: '+1 to attack rolls; harder for ambushes to land.',
    pb: { atk: 1 }
  },
  mageSlayer: {
    label: 'Mage Slayer',
    desc: '+1 damage; +2 damage vs elites and bosses (combat hook).',
    pb: { dmg: 1 },
    eliteBonusDmg: 2
  },
  healer: {
    label: 'Healer',
    desc: '+3 to all healing you perform.',
    pb: { heal: 3 }
  },
  warCaster: {
    label: 'War Caster',
    desc: '+1 spell attack and +1 spell damage; casters only.',
    pb: { atk: 1, dmg: 1 },
    castersOnly: true
  },
  elementalAdept: {
    label: 'Elemental Adept',
    desc: '+2 spell damage; your bolts hit harder.',
    pb: { dmg: 2 },
    castersOnly: true
  },
  savageAttacker: {
    label: 'Savage Attacker',
    desc: '+2 weapon damage on melee hits.',
    pb: { dmg: 2 },
    meleeOnly: true
  },
  lucky: {
    label: 'Lucky',
    desc: 'Once per short rest, turn a miss into a hit (combat hook).',
    pb: {},
    luckyMiss: true
  },
  durable: {
    label: 'Durable',
    desc: '+6 max HP and Second Wind-style grit (+1 AC).',
    pb: { hp: 6, ac: 1 }
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
    desc: 'Heavy two-handed swings hit harder (+1 damage per 2 levels).',
    pb: {}, meleeOnly: true,
    bonusDmg: { when: 'twoHanded', perLevel: 0.5 }
  },
  sharpshooter: {
    label: 'Sharpshooter',
    desc: '+3 damage on ranged weapon attacks.',
    pb: {}, rangedOnly: true,
    bonusDmg: { when: 'ranged', flat: 3 }
  },
  crossbowExpert: {
    label: 'Crossbow Expert',
    desc: 'Ranged weapons: a chance at a bonus shot each turn.',
    pb: {}, rangedOnly: true,
    extraAttack: { when: 'ranged', chance: 0.35 }
  },
  polearmMaster: {
    label: 'Polearm Master',
    desc: 'Polearms: a chance at a bonus butt-end strike each turn.',
    pb: {}, meleeOnly: true,
    extraAttack: { when: 'polearm', chance: 0.40 }
  },
  charger: {
    label: 'Charger',
    desc: 'Your opening strike on a fresh foe deals +1 damage per level.',
    pb: {}, meleeOnly: true,
    bonusDmg: { when: 'firstStrike', perLevel: 1 }
  },
  sentinel: {
    label: 'Sentinel',
    desc: 'Melee hits have a chance to root the foe in place.',
    pb: {}, meleeOnly: true,
    onHit: { when: 'melee', effect: 'slowed', chance: 0.25, duration: 3 }
  },
  shieldMaster: {
    label: 'Shield Master',
    desc: '+1 AC; with a shield equipped, melee hits can shove foes prone.',
    pb: { ac: 1 }, meleeOnly: true,
    onHit: { when: 'shield', effect: 'prone', chance: 0.20, duration: 4 }
  },
  grappler: {
    label: 'Grappler',
    desc: '+1 STR. On-hit chance to grapple (slow); +2 damage vs slowed or prone foes.',
    pb: { str: 1 }, meleeOnly: true,
    onHit: { when: 'melee', effect: 'slowed', chance: 0.20, duration: 2.5 },
    bonusDmg: { when: 'vsImpaired', flat: 2 }
  },
  tavernBrawler: {
    label: 'Tavern Brawler',
    desc: '+1 STR; your blows can stagger (slow) foes.',
    pb: { str: 1 },
    onHit: { when: 'melee', effect: 'slowed', chance: 0.15, duration: 2 }
  },
  martialAdept: {
    label: 'Martial Adept',
    desc: 'Critical hits unleash a maneuver: bonus damage and knock the foe prone.',
    pb: {},
    onHit: { when: 'crit', effect: 'prone', chance: 1, duration: 3, dmg: [1, 8] }
  },
  mountedCombatant: {
    label: 'Mounted Combatant',
    desc: 'Charging momentum: +1 damage per level vs elites and bosses.',
    pb: {},
    bonusDmg: { when: 'vsElite', perLevel: 1 }
  },
  spellSniper: {
    label: 'Spell Sniper',
    desc: 'Casters: +2 spell damage and your spells crit more easily.',
    pb: { crit: 1 }, castersOnly: true,
    bonusDmg: { when: 'spell', flat: 2 }
  },
  skulker: {
    label: 'Skulker',
    desc: '+1 DEX. Ranged: your opening shot deals +1 damage per level.',
    pb: { dex: 1 }, rangedOnly: true,
    bonusDmg: { when: 'firstStrikeRanged', perLevel: 1 }
  },

  /* ---- Defensive feats ------------------------------------------------ */
  heavyArmorMaster: {
    label: 'Heavy Armor Master',
    desc: '+1 STR. While in heavy armor, reduce all incoming damage by 3.',
    pb: { str: 1 },
    incomingDR: { flat: 3, when: 'heavyArmor' }
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
    desc: '+3 AC while wielding a finesse weapon (parrying stance).',
    pb: {},
    acBonus: { flat: 3, when: 'finesse' }
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
    desc: '+1 STR and quicker on your feet.',
    pb: { str: 1, speed: 0.1 }
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
    desc: 'Ever-watchful: quicker on your feet and sharper on skill challenges.',
    pb: { speed: 0.1 },
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

/** How many bonus attacks feats grant this swing (rolled here). */
export function featExtraAttacks(h) {
  const wpn = h.equipment && h.equipment.weapon;
  const vw = (wpn && wpn.visualWeapon) || '';
  let count = 0;
  for (const key of h.feats || []) {
    const f = FEATS[key];
    if (!f || !f.extraAttack) continue;
    const ea = f.extraAttack;
    let ok = false;
    if (ea.when === 'polearm') ok = vw.startsWith('polearm/');
    else if (ea.when === 'ranged') ok = !!wpn && wpn.melee === false;
    if (ok && Math.random() < ea.chance) count++;
  }
  return count;
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
    if (oh.effect) out.effects.push({ key: oh.effect, duration: oh.duration || 3 });
    if (oh.dmg) out.bonusDmg += _dsum(oh.dmg[0], oh.dmg[1]);
  }
  return out;
}

/** Reduce incoming damage by feat flat DR (Heavy Armor Master). */
export function featIncomingDamage(h, dmg) {
  let d = dmg;
  const armor = h.equipment && h.equipment.armor;
  const heavy = !!armor && armor.prof === 'heavy';
  for (const key of h.feats || []) {
    const f = FEATS[key];
    if (!f || !f.incomingDR) continue;
    if (f.incomingDR.when === 'heavyArmor' && !heavy) continue;
    d -= (f.incomingDR.flat || 0);
  }
  return Math.max(0, d);
}

/** Conditional AC from feats (Dual Wielder / Medium Armor Master / Defensive Duelist). */
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
    desc: 'When bloodied, dash clear: +4 AC and +40% speed briefly.',
    combat: 'cunningAction'
  },
  uncannyDodge: {
    label: 'Uncanny Dodge',
    desc: 'Halve the first hit you take each combat exchange.',
    combat: 'uncannyDodge'
  },
  evasion: {
    label: 'Evasion',
    desc: '+2 AC (you slip blasts and swings).',
    pb: { ac: 2 }
  },
  rage: {
    label: 'Rage',
    desc: 'Once per long rest, when hurt enter Rage: +2 melee dmg, +2 AC, half damage taken.',
    combat: 'rage'
  },
  recklessAttack: {
    label: 'Reckless Attack',
    desc: 'While raging, +2 to hit.',
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
    desc: 'Once per short rest, strike a third time.',
    combat: 'flurry'
  },
  martialArts: {
    label: 'Martial Arts',
    desc: '+1 AC and +1 damage with unarmed strikes.',
    pb: { ac: 1, dmg: 1 }
  },
  divineSmite: {
    label: 'Divine Smite',
    desc: 'Once per short rest, add +2d8 radiant on a hit vs elite/boss.',
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
    desc: 'Once per short rest, grant all allies advantage on their next attack (does not expire).',
    combat: 'bardicInspiration'
  },
  songOfRest: {
    label: 'Song of Rest',
    desc: 'Passive: the party heals 10% of max HP at the end of each fight.',
    combat: 'songOfRest'
  },
  wildShapeClass: {
    label: 'Wild Shape',
    desc: 'Once per short rest: +15 temp HP and claw strikes briefly.',
    combat: 'wildShape'
  },
  tidesOfChaos: {
    label: 'Tides of Chaos',
    desc: 'Once per short rest: +5 to hit on an attack.',
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
  agonizingBlast: {
    label: 'Agonizing Blast',
    desc: 'Add CHA mod to Eldritch Blast damage for each beam that hits.',
    combat: 'agonizingBlast'
  },
  repellingBlast: {
    label: 'Repelling Blast',
    desc: 'Eldritch Blast pushes target 10 feet back on hit.',
    combat: 'repellingBlast'
  },
  graspOfHadar: {
    label: 'Grasp of Hadar',
    desc: 'Eldritch Blast pulls target 10 feet closer on hit.',
    combat: 'graspOfHadar'
  },
  lanceOfLethargy: {
    label: 'Lance of Lethargy',
    desc: 'Eldritch Blast reduces target speed by 10 ft on hit.',
    combat: 'lanceOfLethargy'
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
    desc: 'Ki-powered techniques (Flurry and more).',
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
    desc: '+8% move speed in the wilds (everywhere, here).',
    pb: { speed: 0.08 }
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
    desc: '+10% speed, +1 AC; hide as a bonus action.',
    pb: { speed: 0.1, ac: 1 }
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

/* Subclass passive boosts at L6 / L10 / L14 / L18 (on top of L3 pick) */
export const SUBCLASS_MILESTONES = {
  fighter: {
    champion: { 6: { pb: { crit: 1 }, label: 'Superior Critical' }, 10: { pb: { dmg: 2 }, label: 'Survivor' },
                14: { pb: { crit: 1, dmg: 2 }, label: 'Champion Ascendant' }, 18: { pb: { dmg: 3, hp: 10 }, label: 'Legendary Champion' } },
    guardian: { 6: { pb: { ac: 1, hp: 4 }, label: 'Hold the Line' }, 10: { pb: { ac: 1 }, label: 'Bulwark' },
                14: { pb: { ac: 1, hp: 8 }, label: 'Iron Bulwark' }, 18: { pb: { ac: 2, hp: 12 }, label: 'Living Wall' } }
  },
  rogue: {
    thief: { 6: { pb: { speed: 0.1 }, label: 'Supreme Sneak' }, 10: { pb: { ac: 1, dmg: 1 }, label: 'Use Magic Device' },
             14: { pb: { speed: 0.1, dmg: 2 }, label: 'Master Infiltrator' }, 18: { pb: { dmg: 3, ac: 1 }, label: 'Ghost in the Dark' } },
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
    openhand: { 6: { pb: { dmg: 1 }, label: 'Wholeness of Body' }, 10: { pb: { ac: 1, speed: 0.1 }, label: 'Quivering Palm Ready' },
                14: { pb: { dmg: 2, ac: 1 }, label: 'Tranquility' }, 18: { pb: { dmg: 3, speed: 0.1 }, label: 'Grandmaster' } },
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
      11: [learnSpell('cleric_sp4b', 'cleric', 4, 'Additional domain spell')],
      12: [asi(12)],
      13: [learnSpell('cleric_sp5b', 'cleric', 5, 'Higher-tier spell')],
      14: [asi(14), milestone(14), auto('destroyUndeadGreater')],
      15: [],
      16: [asi(16)],
      17: [learnSpell('cleric_sp5c', 'cleric', 5, 'Mastery spell')],
      18: [asi(18), milestone(18)],
      19: [],
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
      11: [learnSpell('wiz_sp4b', 'wizard', 4, 'Additional spell')],
      12: [asi(12)],
      13: [learnSpell('wiz_sp5b', 'wizard', 5, 'Higher-tier spell')],
      14: [asi(14), milestone(14)],
      15: [],
      16: [asi(16)],
      17: [learnSpell('wiz_sp5c', 'wizard', 5, 'Mastery spell')],
      18: [asi(18), milestone(18), auto('spellMastery')],
      19: [],
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
    1: [auto('bardicInspiration'), learnSpell('bard_sp1', 'bard', 1)],
    2: [auto('jackOfAllTrades'), auto('songOfRest')],
    3: [subclass(), learnSpell('bard_sp2', 'bard', 2)],
    4: [asi(4)],
    5: [learnSpell('bard_sp3', 'bard', 3)],
    6: [milestone(6)],
    7: [learnSpell('bard_sp4', 'bard', 4, 'Learn a 4th-level spell')],
    8: [asi(8)],
     9: [learnSpell('bard_sp5', 'bard', 5, 'Learn a 5th-level spell')],
      10: [asi(10), milestone(10)],
      11: [learnSpell('bard_sp4b', 'bard', 4, 'Additional spell')],
      12: [asi(12)],
      13: [learnSpell('bard_sp5b', 'bard', 5, 'Higher-tier spell')],
      14: [asi(14), milestone(14)],
      15: [auto('inspiredPerformance')],
      16: [asi(16)],
      17: [],
      18: [asi(18), milestone(18)],
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
      11: [learnSpell('druid_sp4b', 'druid', 4, 'Additional spell')],
      12: [asi(12)],
      13: [learnSpell('druid_sp5b', 'druid', 5, 'Higher-tier spell')],
      14: [asi(14), milestone(14)],
      15: [],
      16: [asi(16)],
      17: [],
      18: [asi(18), milestone(18), auto('beastSpells')],
      19: [],
      20: [asi(20), auto('archdruid')]
  },
  monk: {
    1: [auto('martialArts'), auto('ki')],
    2: [auto('flurryOfBlows')],
    3: [subclass()],
    4: [asi(4)],
    5: [auto('extraAttack')],
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
    2: [fightingStyle('fs_paladin', FS_MELEE), learnSpell('pal_sp1', 'paladin', 1)],
    3: [subclass()],
    4: [asi(4)],
    5: [auto('extraAttack')],
    6: [auto('auraProtection'), milestone(6)],
    7: [auto('divineHealth')],
    8: [asi(8)],
      9: [learnSpell('pal_sp2', 'paladin', 2)],
      10: [asi(10), milestone(10)],
      11: [auto('improvedDivineSmite'), learnSpell('pal_sp3', 'paladin', 3, 'Higher prayer')],
      12: [asi(12)],
      13: [],
      14: [asi(14), milestone(14), auto('cleansingTouch')],
      15: [],
      16: [asi(16)],
      17: [],
      18: [asi(18), milestone(18), auto('auraImproved')],
      19: [],
      20: [asi(20), auto('oathCapstone')]
  },
  ranger: {
    1: [auto('favoredEnemy'), auto('naturalExplorer')],
    2: [fightingStyle('fs_ranger', FS_RANGED), learnSpell('rng_sp1', 'ranger', 1)],
    3: [subclass()],
    4: [asi(4)],
    5: [auto('extraAttack')],
    6: [milestone(6)],
    7: [auto('primevalAwareness')],
    8: [asi(8)],
      9: [learnSpell('rng_sp2', 'ranger', 2)],
      10: [asi(10), milestone(10), auto('colossusSlayerClass')],
      11: [],
      12: [asi(12)],
      13: [],
      14: [asi(14), milestone(14), auto('vanish')],
      15: [],
      16: [asi(16)],
      17: [],
      18: [asi(18), milestone(18), auto('feralSenses')],
      19: [],
      20: [asi(20), auto('foeSlayer')]
  },
  sorcerer: {
    1: [learnSpell('sorc_sp1', 'sorcerer', 1), auto('tidesOfChaos')],
    2: [auto('fontOfMagic')],
    3: [subclass(), auto('metamagic'), learnSpell('sorc_sp2', 'sorcerer', 2)],
    4: [asi(4)],
    5: [learnSpell('sorc_sp3', 'sorcerer', 3)],
    6: [milestone(6)],
    7: [learnSpell('sorc_sp4', 'sorcerer', 4, 'Learn a 4th-level spell')],
    8: [asi(8)],
      9: [learnSpell('sorc_sp5', 'sorcerer', 5, 'Learn a 5th-level spell')],
      10: [asi(10), milestone(10)],
      11: [learnSpell('sorc_sp4b', 'sorcerer', 4, 'Additional spell')],
      12: [asi(12)],
      13: [learnSpell('sorc_sp5b', 'sorcerer', 5, 'Higher-tier spell')],
      14: [asi(14), milestone(14)],
      15: [],
      16: [asi(16)],
      17: [auto('metamagicExpert')],
      18: [asi(18), milestone(18)],
      19: [],
      20: [asi(20), auto('sorcerousRestoration')]
  },
  warlock: {
    1: [auto('pactMagic'), auto('eldritchBlast'), learnSpell('wlk_sp1', 'warlock', 1)],
    2: [auto('agonizingBlast')],
    3: [subclass(), learnSpell('wlk_sp2', 'warlock', 2)],
    4: [asi(4)],
    5: [auto('repellingBlast'), learnSpell('wlk_sp3', 'warlock', 3)],
    6: [milestone(6)],
    7: [auto('graspOfHadar'), learnSpell('wlk_sp4', 'warlock', 4, 'Learn a 4th-level spell')],
    8: [asi(8)],
    9: [auto('lanceOfLethargy')],
      10: [asi(10), milestone(10)],
      11: [learnSpell('wlk_sp4b', 'warlock', 4, 'Mystic Arcanum')],
      12: [asi(12)],
      13: [learnSpell('wlk_mystic7', 'warlock', 5, 'Mystic Arcanum (7th)')],
      14: [asi(14), milestone(14)],
      15: [learnSpell('wlk_mystic8', 'warlock', 5, 'Mystic Arcanum (8th)')],
      16: [asi(16)],
      17: [learnSpell('wlk_mystic9', 'warlock', 5, 'Mystic Arcanum (9th)')],
      18: [asi(18), milestone(18)],
      19: [],
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
  rage:           { max: 'pb', recharge: 'long' },
  wildShapeClass: { max: 'pb', recharge: 'short' },
  /* Flurry of Blows and Patient Defense deliberately share one pool — the
     game's simplified ki model (see runCombatReflexes in combat.js). */
  flurryOfBlows:  { max: 'pb', recharge: 'short' },
  indomitable:    { max: 1, recharge: 'long' },
  rallyingCry:    { max: 1, recharge: 'long' },
  preserveLife:   { max: 1, recharge: 'long' }
};

const DEFAULT_CHARGE = { max: 'pb', recharge: 'short' };

/** Pool shape for a charge key. `spell:<key>` inherits the spell's recharge. */
export function chargeDef(key, hero) {
  const level = hero ? (hero.level || (hero.data && hero.data.level) || 1) : 1;
  const pb = profBonus(level);

  let def = CHARGE_DEFS[key];
  if (!def) {
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
    const f = FEATURES[key];
    if (f) add(f.pb);
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
  if (!h.pendingChoices) h.pendingChoices = [];
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
  if (!h.knownSpells.includes('cureWounds')) h.knownSpells.push('cureWounds');
}

function unlockFeature(h, key, log) {
  if (!key || hasFeature(h, key)) return;
  h.features.push(key);
  const f = FEATURES[key];
  if (log && f) log(`✨ ${h.name} gains ${f.label}: ${f.desc}`, 'level');
  /* class flags used by older combat code */
  if (key === 'secondWind') h.secondWind = true;
}

function queueChoice(h, grant) {
  /* don't double-queue the same choice id */
  if (h.pendingChoices.some(c => c.id === grant.id)) return;
  const choice = { ...grant };
  /* materialize options for UI */
  if (grant.pick === 'asiOrFeat') {
    choice.options = buildAsiFeatOptions(h);
  } else if (grant.pick === 'fightingStyle') {
    choice.options = (grant.styles || Object.keys(FIGHTING_STYLES)).map(k => ({
      key: k,
      label: FIGHTING_STYLES[k].label,
      desc: FIGHTING_STYLES[k].desc
    }));
  } else if (grant.pick === 'spell') {
    const pool = (SPELL_POOLS[grant.classKey] && SPELL_POOLS[grant.classKey][grant.tier]) || [];
    choice.options = pool
      .filter(k => !h.knownSpells.includes(k) && SPELLS[k])
      .map(k => ({
        key: k,
        label: SPELLS[k].label,
        desc: `L${SPELLS[k].level} — ${SPELLS[k].desc}`
      }));
    /* if nothing left to learn, skip */
    if (choice.options.length === 0) return;
  } else if (grant.pick === 'wildShapeForm') {
    choice.options = Object.values(WILD_SHAPE_FORMS).map(wf => ({
      key: wf.key,
      label: `${wf.icon} ${wf.label}`,
      desc: wf.desc
    }));
  }
  h.pendingChoices.push(choice);
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
    if (log) log(`📘 ${h.name} gained ${SKILL_POINTS_PER_LEVEL} skill points.`, 'level');
  }

  /* Class talents are the stopgap for dead levels: if this level's progression
     table is empty, the level would otherwise grant nothing, so bank a talent
     point instead. (Fighter 9/15/19, rogue 9/13/17/19, and so on.) */
  if (level > 1 && !opts.autosOnly && grants.length === 0) {
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
 * Migrate legacy heroes: unlock auto features for levels already gained,
 * do not dump every historical choice on them.
 */
export function migrateProgression(h) {
  initProgressionFields(h);
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
  } else if (choice.pick === 'wildShapeForm') {
    h.wildShapeForm = opt.key;
  } else {
    return { ok: false, reason: 'Unknown choice type.' };
  }

  h.pendingChoices.splice(idx, 1);
  return { ok: true, choice, opt };
}

export function pendingChoiceCount(h) {
  return (h.pendingChoices || []).length;
}

export function listUnlockedFeatureLabels(h) {
  const out = [];
  for (const key of h.features || []) {
    const f = FEATURES[key];
    if (f) out.push({ key, label: f.label, desc: f.desc });
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
    if (s) out.push({ key: sp, label: `Spell: ${s.label}`, desc: s.desc });
  }
  return out;
}
