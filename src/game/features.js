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
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABILITY_LABEL = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };
const MELEE_CLASSES = new Set(['fighter', 'barbarian', 'monk', 'paladin', 'rogue', 'bard']);

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
  }
};

/* ================================================================
   Spells — learned by casters; auto-cast by idle AI tags
   ai.when: 'hurtAlly' | 'cluster' | 'eliteOrBoss' | 'selfHurt' | 'any'
   recharge: 'slot' | 'short' | 'day'
   ================================================================ */
export const SPELLS = {
  /* --- shared / wizard --- */
  magicMissile: {
    label: 'Magic Missile', level: 1,
    desc: '3 unerring darts of force (1d4+1 each). Great vs elites.',
    recharge: 'slot',
    ai: { when: 'eliteOrBoss', priority: 6 },
    color: 0xb08cff
  },
  shield: {
    label: 'Shield', level: 1,
    desc: 'When bloodied, gain +5 AC for 6 seconds.',
    recharge: 'slot',
    ai: { when: 'selfHurt', priority: 8, hpFrac: 0.4 },
    color: 0x88aaff
  },
  scorchingRay: {
    label: 'Scorching Ray', level: 2,
    desc: 'Three rays of fire; solid single-target burst.',
    recharge: 'slot',
    ai: { when: 'eliteOrBoss', priority: 7 },
    color: 0xff7a30
  },
  fireball: {
    label: 'Fireball', level: 3,
    desc: '8d6 blast when foes cluster together.',
    recharge: 'slot',
    ai: { when: 'cluster', priority: 9, minTargets: 3 },
    color: 0xff7a30
  },
  haste: {
    label: 'Haste', level: 3,
    desc: 'Hasten yourself: +40% speed and +2 AC for 8s.',
    recharge: 'slot',
    ai: { when: 'selfHurt', priority: 5, hpFrac: 0.55 },
    color: 0xa0e0ff
  },

  /* --- cleric --- */
  bless: {
    label: 'Bless', level: 1,
    desc: 'Party-wide +2 to attack rolls for 8 seconds.',
    recharge: 'slot',
    ai: { when: 'any', priority: 4 },
    color: 0xffe08a
  },
  spiritualWeapon: {
    label: 'Spiritual Weapon', level: 2,
    desc: 'Force weapon strikes the foe for 1d8 + WIS.',
    recharge: 'slot',
    ai: { when: 'eliteOrBoss', priority: 6 },
    color: 0xbfe0ff
  },
  spiritGuardians: {
    label: 'Spirit Guardians', level: 3,
    desc: 'Damaging aura: 3d8 to nearby enemies once.',
    recharge: 'slot',
    ai: { when: 'cluster', priority: 8, minTargets: 2 },
    color: 0xd0c0ff
  },

  /* --- druid --- */
  entangle: {
    label: 'Entangle', level: 1,
    desc: 'Roots nearby foes briefly and chips damage.',
    recharge: 'slot',
    ai: { when: 'cluster', priority: 5, minTargets: 2 },
    color: 0x4cae4c
  },
  moonbeam: {
    label: 'Moonbeam', level: 2,
    desc: 'Silver fire burns a target for 2d10.',
    recharge: 'slot',
    ai: { when: 'eliteOrBoss', priority: 7 },
    color: 0xc0e8ff
  },
  callLightning: {
    label: 'Call Lightning', level: 3,
    desc: 'Bolt the pack: 3d10 to clustered foes.',
    recharge: 'slot',
    ai: { when: 'cluster', priority: 8, minTargets: 2 },
    color: 0x7090ff
  },

  /* --- bard --- */
  healingWord: {
    label: 'Healing Word', level: 1,
    desc: 'Bonus heal on a wounded ally (1d4 + CHA).',
    recharge: 'slot',
    ai: { when: 'hurtAlly', priority: 8, hpFrac: 0.5 },
    color: 0xe8a8ff
  },
  shatter: {
    label: 'Shatter', level: 2,
    desc: 'Thunderous burst: 3d8 to a cluster.',
    recharge: 'slot',
    ai: { when: 'cluster', priority: 7, minTargets: 3 },
    color: 0xd0a0ff
  },

  /* --- sorcerer --- */
  chaosBolt: {
    label: 'Chaos Bolt', level: 1,
    desc: 'Unstable bolt: 2d8 + CHA, crits more often.',
    recharge: 'slot',
    ai: { when: 'any', priority: 5 },
    color: 0xff8844
  },
  dragonBreathSpell: {
    label: 'Burning Hands', level: 1,
    desc: 'Cone of fire: 3d6 to nearby enemies.',
    recharge: 'slot',
    ai: { when: 'cluster', priority: 6, minTargets: 2 },
    color: 0xff6020
  },

  /* --- warlock --- */
  hex: {
    label: 'Hex', level: 1,
    desc: 'Curse a foe: +1d6 damage on your hits for 8s.',
    recharge: 'short',
    ai: { when: 'eliteOrBoss', priority: 7 },
    color: 0x9b59b6
  },
  armsOfHadar: {
    label: 'Arms of Hadar', level: 1,
    desc: 'Dark tentacles: 2d6 to nearby foes.',
    recharge: 'slot',
    ai: { when: 'cluster', priority: 6, minTargets: 2 },
    color: 0x6a3080
  },

  /* --- paladin / ranger half-casters --- */
  thunderousSmite: {
    label: 'Thunderous Smite', level: 1,
    desc: 'Next melee hit deals +2d6 thunder.',
    recharge: 'slot',
    ai: { when: 'eliteOrBoss', priority: 7 },
    color: 0xf1c40f
  },
  huntersMark: {
    label: 'Hunter\'s Mark', level: 1,
    desc: 'Mark prey: +1d6 damage for 8s.',
    recharge: 'slot',
    ai: { when: 'eliteOrBoss', priority: 7 },
    color: 0x1abc9c
  }
};

/** Spell pools offered when a class learns a spell at a given spell-level tier. */
export const SPELL_POOLS = {
  wizard: {
    1: ['magicMissile', 'shield'],
    2: ['scorchingRay', 'magicMissile', 'shield'],
    3: ['fireball', 'haste', 'scorchingRay']
  },
  cleric: {
    1: ['bless', 'healingWord'],
    2: ['spiritualWeapon', 'bless'],
    3: ['spiritGuardians', 'spiritualWeapon']
  },
  druid: {
    1: ['entangle', 'healingWord'],
    2: ['moonbeam', 'entangle'],
    3: ['callLightning', 'moonbeam']
  },
  bard: {
    1: ['healingWord', 'bless'],
    2: ['shatter', 'healingWord'],
    3: ['shatter', 'haste']
  },
  sorcerer: {
    1: ['chaosBolt', 'dragonBreathSpell', 'shield'],
    2: ['scorchingRay', 'chaosBolt'],
    3: ['fireball', 'haste']
  },
  warlock: {
    1: ['hex', 'armsOfHadar', 'magicMissile'],
    2: ['hex', 'scorchingRay'],
    3: ['armsOfHadar', 'hex']
  },
  paladin: {
    1: ['thunderousSmite', 'bless'],
    2: ['thunderousSmite', 'bless']
  },
  ranger: {
    1: ['huntersMark', 'entangle'],
    2: ['huntersMark', 'healingWord']
  }
};

/* ================================================================
   Passive feature definitions (auto-unlocked keys)
   ================================================================ */
export const FEATURES = {
  secondWind: {
    label: 'Second Wind',
    desc: 'Once per floor, self-heal when badly hurt.',
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
    desc: 'Once per day, turn a miss into a hit.',
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
    desc: 'When hurt, enter Rage: +2 melee dmg, +2 AC, half damage taken.',
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
    desc: 'Once per short rest, grant all allies +2 to hit for 8s.',
    combat: 'bardicInspiration'
  },
  songOfRest: {
    label: 'Song of Rest',
    desc: 'After combat, allies heal a little extra (short rest).',
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
    desc: 'Add CHA mod to Eldritch Blast damage.',
    combat: 'agonizingBlast'
  },
  arcaneRecovery: {
    label: 'Arcane Recovery',
    desc: 'Recover 1 spell slot after each combat (short rest).',
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
  subclass10: { label: 'Subclass Mastery', desc: 'Your path reaches a peak.', pb: {} }
};

/* Subclass passive boosts at L6 / L10 (on top of L3 pick) */
export const SUBCLASS_MILESTONES = {
  fighter: {
    champion: { 6: { pb: { crit: 1 }, label: 'Superior Critical' }, 10: { pb: { dmg: 2 }, label: 'Survivor' } },
    guardian: { 6: { pb: { ac: 1, hp: 4 }, label: 'Hold the Line' }, 10: { pb: { ac: 1 }, label: 'Bulwark' } }
  },
  rogue: {
    thief: { 6: { pb: { speed: 0.1 }, label: 'Supreme Sneak' }, 10: { pb: { ac: 1, dmg: 1 }, label: 'Use Magic Device' } },
    nightblade: { 6: { pb: { crit: 1 }, label: 'Assassinate' }, 10: { pb: { dmg: 2 }, label: 'Death Strike+' } }
  },
  cleric: {
    life: { 6: { pb: { heal: 3 }, label: 'Blessed Healer' }, 10: { pb: { heal: 2, ac: 1 }, label: 'Supreme Healing' } },
    war: { 6: { pb: { atk: 1, dmg: 1 }, label: 'War Priest' }, 10: { pb: { dmg: 2 }, label: 'Avatar of Battle' } }
  },
  wizard: {
    evoker: { 6: { pb: { dmg: 2 }, label: 'Potent Cantrip' }, 10: { pb: { dmg: 2 }, label: 'Overchannel' } },
    abjurer: { 6: { pb: { ac: 1, hp: 6 }, label: 'Projected Ward' }, 10: { pb: { ac: 1 }, label: 'Spell Resistance' } }
  },
  barbarian: {
    berserker: { 6: { pb: { dmg: 2 }, label: 'Mindless Rage' }, 10: { pb: { atk: 1, dmg: 1 }, label: 'Intimidating Presence' } },
    totem: { 6: { pb: { ac: 1, hp: 6 }, label: 'Aspect of the Eagle' }, 10: { pb: { ac: 1 }, label: 'Totemic Attunement' } }
  },
  bard: {
    lore: { 6: { pb: { atk: 1 }, label: 'Additional Magical Secrets' }, 10: { pb: { dmg: 1, heal: 2 }, label: 'Peerless Skill' } },
    valor: { 6: { pb: { ac: 1, dmg: 1 }, label: 'Combat Training' }, 10: { pb: { atk: 1 }, label: 'Battle Magic' } }
  },
  druid: {
    land: { 6: { pb: { atk: 1 }, label: "Land's Stride" }, 10: { pb: { dmg: 2 }, label: "Nature's Ward" } },
    moon: { 6: { pb: { dmg: 1, hp: 6 }, label: 'Primal Strike' }, 10: { pb: { dmg: 2 }, label: 'Elemental Wild Shape' } }
  },
  monk: {
    openhand: { 6: { pb: { dmg: 1 }, label: 'Wholeness of Body' }, 10: { pb: { ac: 1, speed: 0.1 }, label: 'Quivering Palm Ready' } },
    shadow: { 6: { pb: { ac: 1 }, label: 'Shadow Step+' }, 10: { pb: { dmg: 2 }, label: 'Opportunist' } }
  },
  paladin: {
    devotion: { 6: { pb: { atk: 1 }, label: 'Aura of Devotion' }, 10: { pb: { ac: 1, heal: 2 }, label: 'Holy Nimbus' } },
    vengeance: { 6: { pb: { dmg: 2 }, label: 'Relentless Avenger' }, 10: { pb: { atk: 1, dmg: 1 }, label: 'Soul of Vengeance' } }
  },
  ranger: {
    hunter: { 6: { pb: { dmg: 1 }, label: 'Multiattack Defense' }, 10: { pb: { atk: 1, dmg: 1 }, label: 'Superior Hunter' } },
    beastmaster: { 6: { pb: { ac: 1 }, label: 'Exceptional Training' }, 10: { pb: { dmg: 2 }, label: 'Bestial Fury' } }
  },
  sorcerer: {
    draconic: { 6: { pb: { dmg: 2 }, label: 'Elemental Affinity' }, 10: { pb: { ac: 1, hp: 4 }, label: 'Dragon Wings' } },
    wildmagic: { 6: { pb: { atk: 1 }, label: 'Bend Luck' }, 10: { pb: { dmg: 2 }, label: 'Controlled Chaos' } }
  },
  warlock: {
    fiend: { 6: { pb: { dmg: 1, hp: 4 }, label: "Dark One's Own Luck" }, 10: { pb: { dmg: 2 }, label: 'Fiendish Resilience' } },
    archfey: { 6: { pb: { ac: 1 }, label: 'Misty Escape' }, 10: { pb: { atk: 1, ac: 1 }, label: 'Beguiling Defenses' } }
  }
};

/* ================================================================
   Per-class level tables (levels 1–10)
   ================================================================ */

const FS_MARTIAL = ['archery', 'defense', 'dueling', 'greatWeapon', 'protection'];
const FS_MELEE = ['defense', 'dueling', 'greatWeapon', 'twoWeapon'];
const FS_RANGED = ['archery', 'defense', 'dueling'];

function auto(feature) { return { type: 'auto', feature }; }
function skillPoint() { return { type: 'skillPoint' }; }
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
function milestone(level) {
  return { type: 'subclassMilestone', level };
}

export const CLASS_PROGRESSION = {
  fighter: {
    1: [auto('secondWind'), fightingStyle('fs_fighter', FS_MARTIAL)],
    2: [auto('actionSurgeClass'), skillPoint()],
    3: [subclass()],
    4: [asi(4)],
    5: [auto('extraAttack')],
    6: [skillPoint(), milestone(6)],
    7: [auto('indomitable')],
    8: [asi(8)],
    9: [skillPoint()],
    10: [asi(10), auto('extraAttack2')]
  },
  rogue: {
    1: [auto('sneakAttack')],
    2: [auto('cunningActionClass'), skillPoint()],
    3: [subclass()],
    4: [asi(4)],
    5: [auto('uncannyDodge')],
    6: [skillPoint(), milestone(6)],
    7: [auto('evasion')],
    8: [asi(8)],
    9: [skillPoint()],
    10: [asi(10)]
  },
  cleric: {
    1: [learnSpell('cleric_sp1', 'cleric', 1, 'Domain spell')],
    2: [auto('channelDivinity'), skillPoint()],
    3: [subclass(), learnSpell('cleric_sp2', 'cleric', 2)],
    4: [asi(4)],
    5: [learnSpell('cleric_sp3', 'cleric', 3)],
    6: [skillPoint(), milestone(6)],
    7: [learnSpell('cleric_sp3b', 'cleric', 3, 'Additional spell')],
    8: [asi(8)],
    9: [skillPoint()],
    10: [asi(10)]
  },
  wizard: {
    1: [learnSpell('wiz_sp1', 'wizard', 1, 'Learn a 1st-level spell'), auto('arcaneRecovery')],
    2: [skillPoint(), learnSpell('wiz_sp1b', 'wizard', 1, 'Learn another spell')],
    3: [subclass(), learnSpell('wiz_sp2', 'wizard', 2)],
    4: [asi(4)],
    5: [learnSpell('wiz_sp3', 'wizard', 3)],
    6: [skillPoint(), milestone(6)],
    7: [learnSpell('wiz_sp3b', 'wizard', 3, 'Additional spell')],
    8: [asi(8)],
    9: [skillPoint()],
    10: [asi(10)]
  },
  barbarian: {
    1: [auto('rage')],
    2: [auto('recklessAttack'), skillPoint()],
    3: [subclass()],
    4: [asi(4)],
    5: [auto('extraAttack')],
    6: [skillPoint(), milestone(6)],
    7: [auto('brutalCritical')],
    8: [asi(8)],
    9: [skillPoint()],
    10: [asi(10)]
  },
  bard: {
    1: [auto('bardicInspiration'), learnSpell('bard_sp1', 'bard', 1)],
    2: [auto('jackOfAllTrades'), auto('songOfRest'), skillPoint()],
    3: [subclass(), learnSpell('bard_sp2', 'bard', 2)],
    4: [asi(4)],
    5: [learnSpell('bard_sp3', 'bard', 3)],
    6: [skillPoint(), milestone(6)],
    7: [learnSpell('bard_sp3b', 'bard', 3)],
    8: [asi(8)],
    9: [skillPoint()],
    10: [asi(10)]
  },
  druid: {
    1: [learnSpell('druid_sp1', 'druid', 1)],
    2: [auto('wildShapeClass'), skillPoint()],
    3: [subclass(), learnSpell('druid_sp2', 'druid', 2)],
    4: [asi(4)],
    5: [learnSpell('druid_sp3', 'druid', 3)],
    6: [skillPoint(), milestone(6)],
    7: [learnSpell('druid_sp3b', 'druid', 3)],
    8: [asi(8)],
    9: [skillPoint()],
    10: [asi(10)]
  },
  monk: {
    1: [auto('martialArts'), auto('ki')],
    2: [auto('flurryOfBlows'), skillPoint()],
    3: [subclass()],
    4: [asi(4)],
    5: [auto('extraAttack')],
    6: [skillPoint(), milestone(6)],
    7: [auto('stillMind')],
    8: [asi(8)],
    9: [skillPoint()],
    10: [asi(10)]
  },
  paladin: {
    1: [auto('divineSmite'), auto('layOnHands')],
    2: [fightingStyle('fs_paladin', FS_MELEE), skillPoint(), learnSpell('pal_sp1', 'paladin', 1)],
    3: [subclass()],
    4: [asi(4)],
    5: [auto('extraAttack')],
    6: [auto('auraProtection'), skillPoint(), milestone(6)],
    7: [auto('divineHealth')],
    8: [asi(8)],
    9: [skillPoint(), learnSpell('pal_sp2', 'paladin', 2)],
    10: [asi(10)]
  },
  ranger: {
    1: [auto('favoredEnemy'), auto('naturalExplorer')],
    2: [fightingStyle('fs_ranger', FS_RANGED), skillPoint(), learnSpell('rng_sp1', 'ranger', 1)],
    3: [subclass()],
    4: [asi(4)],
    5: [auto('extraAttack')],
    6: [skillPoint(), milestone(6)],
    7: [auto('primevalAwareness')],
    8: [asi(8)],
    9: [skillPoint(), learnSpell('rng_sp2', 'ranger', 2)],
    10: [asi(10), auto('colossusSlayerClass')]
  },
  sorcerer: {
    1: [learnSpell('sorc_sp1', 'sorcerer', 1), auto('tidesOfChaos')],
    2: [auto('fontOfMagic'), skillPoint()],
    3: [subclass(), auto('metamagic'), learnSpell('sorc_sp2', 'sorcerer', 2)],
    4: [asi(4)],
    5: [learnSpell('sorc_sp3', 'sorcerer', 3)],
    6: [skillPoint(), milestone(6)],
    7: [learnSpell('sorc_sp3b', 'sorcerer', 3)],
    8: [asi(8)],
    9: [skillPoint()],
    10: [asi(10)]
  },
  warlock: {
    1: [auto('pactMagic'), auto('eldritchBlast'), learnSpell('wlk_sp1', 'warlock', 1)],
    2: [auto('agonizingBlast'), skillPoint()],
    3: [subclass(), learnSpell('wlk_sp2', 'warlock', 2)],
    4: [asi(4)],
    5: [learnSpell('wlk_sp3', 'warlock', 3)],
    6: [skillPoint(), milestone(6)],
    7: [learnSpell('wlk_sp3b', 'warlock', 3)],
    8: [asi(8)],
    9: [skillPoint()],
    10: [asi(10)]
  }
};

/* ================================================================
   Spell slot table by caster progression
   ================================================================ */
export function spellSlotsFor(classKey, level) {
  const full = ['wizard', 'cleric', 'druid', 'bard', 'sorcerer'];
  const half = ['paladin', 'ranger'];
  if (classKey === 'warlock') return level >= 5 ? 2 : (level >= 1 ? 1 : 0);
  if (full.includes(classKey)) return Math.min(6, 1 + Math.floor(level / 2));
  if (half.includes(classKey)) return level < 2 ? 0 : Math.min(4, Math.floor((level + 1) / 3));
  return 0;
}

export function isCasterClass(classKey) {
  return spellSlotsFor(classKey, 10) > 0;
}

/* ================================================================
   Hero helpers
   ================================================================ */
export function hasFeature(h, key) {
  return !!(h.features && h.features.includes(key));
}

export function hasFeat(h, key) {
  return !!(h.feats && h.feats.includes(key));
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
  if (h.progressionVersion === undefined) h.progressionVersion = 0;
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
  }
  h.pendingChoices.push(choice);
}

function buildAsiFeatOptions(h) {
  const opts = [];
  for (const ab of ABILITIES) {
    if (h.stats[ab] >= 20) continue;
    const room = 20 - h.stats[ab];
    const bump = Math.min(2, room);
    opts.push({
      key: `asi_${ab}`,
      label: `+${bump} ${ABILITY_LABEL[ab]}`,
      desc: `Raise ${ABILITY_LABEL[ab]} by ${bump} (cap 20).`,
      kind: 'asi',
      ability: ab,
      amount: bump
    });
  }
  for (const [key, feat] of Object.entries(FEATS)) {
    if (h.feats.includes(key)) continue;
    if (feat.castersOnly && !isCasterClass(h.classKey)) continue;
    if (feat.meleeOnly && !MELEE_CLASSES.has(h.classKey)) continue;
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
  if (!table || !table[level]) return;
  for (const grant of table[level]) {
    if (grant.type === 'auto') {
      unlockFeature(h, grant.feature, log);
    } else if (grant.type === 'skillPoint') {
      if (opts.autosOnly) continue; // migration / re-apply must not double-bank points
      h.pendingSkill = (h.pendingSkill || 0) + 1;
      if (log) log(`📘 ${h.name} gained a class skill point.`, 'level');
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
      h.stats[opt.ability] = Math.min(20, h.stats[opt.ability] + opt.amount);
    } else if (opt.kind === 'feat') {
      if (!h.feats.includes(opt.feat)) h.feats.push(opt.feat);
    }
  } else if (choice.pick === 'fightingStyle') {
    h.fightingStyle = opt.key;
  } else if (choice.pick === 'spell') {
    if (!h.knownSpells.includes(opt.key)) h.knownSpells.push(opt.key);
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
