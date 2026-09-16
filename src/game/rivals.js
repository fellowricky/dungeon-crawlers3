/**
 * =============================================================================
 * RIVAL ADVENTURERS SYSTEM
 * =============================================================================
 * Generates a rival adventuring party (4 heroes: Frontline, Skirmisher, Healer,
 * Caster) scaled to dungeon level with class-appropriate randomized equipment,
 * full LPC layered visuals, and player-equivalent spells and class skills.
 * =============================================================================
 */

import { makeHero, grantXp, recalc, canEquip, XP_TABLE } from './srd.js';
import { rollItem } from './items.js';
import { getRaceDefaults } from './appearance.js';

const COMPANY_ADJECTIVES = [
  'Iron', 'Crimson', 'Shadow', 'Gilded', 'Black', 'Silver', 'Bloody',
  'Dread', 'Silent', 'Ashen', 'Sovereign', 'Cursed', 'Ebon', 'Scarlet'
];

const COMPANY_NOUNS = [
  'Crows', 'Vipers', 'Blades', 'Syndicate', 'Company', 'Hounds',
  'Wolves', 'Ravens', 'Fangs', 'Guard', 'Brotherhood', 'Marauders', 'Legion'
];

const RIVAL_ARCHETYPES = [
  {
    role: 'tank',
    classKey: 'fighter',
    races: ['human', 'dwarf', 'dragonborn'],
    weapons: ['longsword', 'greatsword', 'battleaxe', 'warhammer'],
    armors: ['heavy', 'medium'],
    useShieldWith1H: true,
    stats: { str: 16, dex: 12, con: 15, int: 8, wis: 12, cha: 10 },
    title: 'the Vanguard'
  },
  {
    role: 'skirmisher',
    classKey: 'rogue',
    races: ['elf', 'halfling', 'human'],
    weapons: ['shortbow', 'rapier', 'dagger'],
    armors: ['light'],
    useShieldWith1H: false,
    stats: { str: 8, dex: 16, con: 13, int: 12, wis: 10, cha: 14 },
    title: 'the Shadow'
  },
  {
    role: 'healer',
    classKey: 'cleric',
    races: ['human', 'dwarf', 'elf'],
    weapons: ['mace', 'warhammer', 'staff'],
    armors: ['medium', 'heavy'],
    useShieldWith1H: true,
    stats: { str: 14, dex: 10, con: 14, int: 10, wis: 16, cha: 12 },
    title: 'the Devout'
  },
  {
    role: 'caster',
    classKey: 'wizard',
    races: ['elf', 'gnome', 'human'],
    weapons: ['staff', 'dagger', 'wand'],
    armors: ['none'],
    useShieldWith1H: false,
    stats: { str: 8, dex: 14, con: 13, int: 16, wis: 12, cha: 10 },
    title: 'the Arcanist'
  }
];

const FIRST_NAMES = {
  male: ['Alden', 'Boran', 'Cassian', 'Dain', 'Garrick', 'Kaelen', 'Lorcan', 'Marek', 'Orin', 'Raff', 'Torin', 'Vane'],
  female: ['Aria', 'Brina', 'Caelia', 'Dara', 'Elysia', 'Kallie', 'Lyra', 'Morwen', 'Nyx', 'Riona', 'Sariel', 'Vesper']
};

/**
 * Generate a procedural company name.
 */
export function generateCompanyName() {
  const adj = COMPANY_ADJECTIVES[Math.floor(Math.random() * COMPANY_ADJECTIVES.length)];
  const noun = COMPANY_NOUNS[Math.floor(Math.random() * COMPANY_NOUNS.length)];
  return `The ${adj} ${noun}`;
}

/**
 * Create LPC visual specification for a rival hero.
 */
function createRivalVisual(raceKey, gender) {
  const raceDefs = getRaceDefaults(raceKey);
  const hairStyles = gender === 'female'
    ? ['long_tied/adult', 'ponytail/adult', 'braid/adult', 'pixie/adult']
    : ['short/adult', 'parted/adult', 'messy/adult', 'buzzcut/adult'];
  const hairColors = ['#2b1d0c', '#5a3d28', '#8a6240', '#d4af37', '#800000', '#1c1c1c', '#a0a0a0'];
  const skinColors = ['#f0c896', '#e0b080', '#c89060', '#8d5524', '#ffdbac'];
  const eyeColors = ['#3a72a0', '#4a8505', '#634e3a', '#85332e', '#41285c'];

  return {
    gender,
    head: raceDefs.head || '',
    skinColor: skinColors[Math.floor(Math.random() * skinColors.length)],
    hair: hairStyles[Math.floor(Math.random() * hairStyles.length)],
    hairExtension: 'none',
    facialHair: gender === 'male' && Math.random() < 0.4 ? 'beard/adult' : 'none',
    hairColor: hairColors[Math.floor(Math.random() * hairColors.length)],
    hairExtColor: '',
    eyeColor: eyeColors[Math.floor(Math.random() * eyeColors.length)],
    ears: raceDefs.ears || 'none',
    horns: raceDefs.horns || 'none',
    spriteScaleX: raceDefs.spriteScaleX || 1.0,
    spriteScaleY: raceDefs.spriteScaleY || 1.0
  };
}

/**
 * Equip a rival with randomized, class-appropriate gear suited for their level.
 */
export function equipClassAppropriateGear(hero, dungeonLevel) {
  const lvl = Math.max(1, dungeonLevel || 1);
  const slots = ['weapon', 'armor', 'helm', 'boots', 'gloves', 'amulet', 'ring'];
  
  // 1. Roll main weapon
  let weapon = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const it = rollItem(lvl, Math.random, 'weapon', { source: 'chest' });
    if (it && canEquip(hero, it)) {
      weapon = it;
      break;
    }
  }
  if (weapon) hero.equipment.weapon = weapon;

  // 2. Roll shield if frontline/cleric and not two-handed weapon
  const isTwoHanded = weapon && weapon.weaponProps && weapon.weaponProps.includes('twoHanded');
  if (!isTwoHanded && (hero.classKey === 'fighter' || hero.classKey === 'cleric' || hero.classKey === 'paladin')) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const shield = rollItem(lvl, Math.random, 'shield', { source: 'chest' });
      if (shield && canEquip(hero, shield)) {
        hero.equipment.shield = shield;
        break;
      }
    }
  }

  // 3. Roll body armor
  if (hero.classKey !== 'wizard' && hero.classKey !== 'sorcerer') {
    for (let attempt = 0; attempt < 10; attempt++) {
      const armor = rollItem(lvl, Math.random, 'armor', { source: 'chest' });
      if (armor && canEquip(hero, armor)) {
        hero.equipment.armor = armor;
        break;
      }
    }
  }

  // 4. Roll accessories (helm, boots, gloves, ring, amulet)
  for (const slot of ['helm', 'boots', 'gloves', 'amulet', 'ring']) {
    if (Math.random() < 0.85) {
      const it = rollItem(lvl, Math.random, slot, { source: 'chest' });
      if (it && canEquip(hero, it)) {
        hero.equipment[slot] = it;
      }
    }
  }

  // Recalculate stats based on equipment
  recalc(hero);
}

/**
 * Configure tactical AI abilities matching player spells and skills.
 */
function buildRivalAbilities(hero, level) {
  const abilities = [];
  const lvl = Math.max(1, level || 1);

  if (hero.classKey === 'fighter') {
    // Second Wind: emergency heal when bloodied
    abilities.push({
      key: 'secondWind',
      label: 'Second Wind',
      trigger: 'cycle',
      every: 3,
      maxUses: 1,
      heal: [1, 10, lvl],
      selfOnly: true,
      color: 0x59d68f
    });
    // Action Surge: extra combat strike burst
    abilities.push({
      key: 'actionSurge',
      label: 'Action Surge',
      trigger: 'cycle',
      every: 4,
      maxUses: 1,
      dice: [1, 8, Math.floor(hero.effStats.str / 2) - 5],
      dmgType: 'slashing',
      color: 0xffaa33
    });
  } else if (hero.classKey === 'rogue') {
    // Sneak Attack: extra d6 burst damage
    const sneakD6 = Math.max(1, Math.ceil(lvl / 2));
    abilities.push({
      key: 'sneakAttack',
      label: `Sneak Attack (+${sneakD6}d6)`,
      trigger: 'cycle',
      every: 2,
      dice: [sneakD6, 6, 2],
      dmgType: 'piercing',
      color: 0x38bdf8
    });
    // Poison strike
    abilities.push({
      key: 'poisonStrike',
      label: 'Poisoned Blade',
      trigger: 'cycle',
      every: 3,
      dice: [2, 6, 0],
      dmgType: 'poison',
      effect: { key: 'poisoned', dur: 4 },
      color: 0x22c55e
    });
  } else if (hero.classKey === 'cleric') {
    // Cure Wounds: support spell to heal injured rival comrades
    abilities.push({
      key: 'cureWounds',
      label: 'Cure Wounds',
      trigger: 'cycle',
      every: 2,
      heal: [2, 8, Math.max(2, Math.floor(hero.effStats.wis / 2) - 5)],
      color: 0x3fd0bb,
      sprite: 'heal_0'
    });
    // Guiding Bolt: high single-target radiant blast
    abilities.push({
      key: 'guidingBolt',
      label: 'Guiding Bolt',
      trigger: 'cycle',
      every: 3,
      dice: [4, 6, 0],
      dmgType: 'radiant',
      color: 0xfde047,
      sprite: 'zap_2'
    });
  } else if (hero.classKey === 'wizard') {
    // High level: Fireball (AoE)
    if (lvl >= 5) {
      abilities.push({
        key: 'fireball',
        label: 'Fireball',
        trigger: 'cycle',
        every: 3,
        aoe: 2.6,
        dice: [8, 6, 0],
        dmgType: 'fire',
        save: { ab: 'dex', dc: 8 + Math.floor((lvl - 1) / 4) + 2 + 3, half: true },
        color: 0xff7a30,
        sprite: 'cloud_fire_2'
      });
    } else {
      // Scorching Ray / Burning Hands
      abilities.push({
        key: 'scorchingRay',
        label: 'Scorching Ray',
        trigger: 'cycle',
        every: 2,
        dice: [3, 6, 2],
        dmgType: 'fire',
        color: 0xff7a30,
        sprite: 'cloud_fire_1'
      });
    }
    // Magic Missile: reliable force damage
    abilities.push({
      key: 'magicMissile',
      label: 'Magic Missile',
      trigger: 'cycle',
      every: 2,
      dice: [3, 4, 3],
      dmgType: 'force',
      color: 0x818cf8,
      sprite: 'cloud_chaos_4'
    });
    // Misty Step: reposition
    abilities.push({
      key: 'mistyStep',
      label: 'Misty Step',
      trigger: 'cycle',
      every: 4,
      blink: { range: 4 },
      color: 0xc084fc
    });
  }

  return abilities;
}

/**
 * Generate a complete 4-hero Rival Adventuring Party for the specified dungeon level.
 */
export function generateRivalParty(dungeonLevel, companyName = null) {
  const lvl = Math.max(1, dungeonLevel || 1);
  const company = companyName || generateCompanyName();
  const rivals = [];

  for (let i = 0; i < RIVAL_ARCHETYPES.length; i++) {
    const arch = RIVAL_ARCHETYPES[i];
    const gender = Math.random() < 0.5 ? 'male' : 'female';
    const raceKey = arch.races[Math.floor(Math.random() * arch.races.length)];
    const names = FIRST_NAMES[gender];
    const firstName = names[Math.floor(Math.random() * names.length)];
    const heroName = `${firstName} ${arch.title}`;

    const visual = createRivalVisual(raceKey, gender);
    const hero = makeHero(heroName, raceKey, arch.classKey, arch.stats, visual);

    // Scale to dungeon level
    if (lvl > 1) {
      const targetXp = XP_TABLE[lvl] || 0;
      if (targetXp > hero.xp) grantXp(hero, targetXp - hero.xp);
    }

    // Equip randomized class gear
    equipClassAppropriateGear(hero, lvl);

    // Tag and configure rival attributes
    hero.isRival = true;
    hero.id = `rival-${arch.classKey}-${lvl}`;
    hero.companyName = company;
    hero.role = arch.role;
    hero.abilities = buildRivalAbilities(hero, lvl);

    // Monster data shape adapter so combat AI and target selection treat rival as a formidable enemy
    hero.ac = hero.ac || 14;
    hero.maxHp = hero.maxHp || (10 + lvl * 7);
    hero.hp = hero.maxHp;
    hero.scale = 1.0;
    hero.speed = 3.2;
    hero.speedCells = 6;
    hero.cr = Math.max(1, lvl);
    hero.gold = Math.floor(25 * lvl + Math.random() * 30);

    // Attack bonus and damage dice
    const pb = Math.floor((lvl - 1) / 4) + 2;
    const statKey = arch.classKey === 'rogue' ? 'dex' : (arch.classKey === 'cleric' ? 'wis' : (arch.classKey === 'wizard' ? 'int' : 'str'));
    const mainMod = Math.floor(((hero.effStats && hero.effStats[statKey]) || 14) - 10) / 2;
    hero.atk = pb + Math.max(1, Math.floor(mainMod));

    const wep = hero.equipment.weapon;
    hero.ranged = (wep && wep.baseKey && (wep.baseKey.includes('bow') || wep.baseKey.includes('crossbow'))) || arch.classKey === 'wizard';
    hero.rngRange = hero.ranged ? 6.5 : 1.5;
    hero.range = hero.rngRange;

    // Appropriate weapon damage dice
    let dieSides = 8;
    let dieCount = 1;
    if (wep && wep.baseKey) {
      if (wep.baseKey.includes('great')) { dieSides = 6; dieCount = 2; }
      else if (wep.baseKey.includes('dagger') || wep.baseKey.includes('shortbow')) { dieSides = 6; }
      else if (wep.baseKey.includes('greataxe')) { dieSides = 12; }
    } else if (arch.classKey === 'wizard') {
      dieSides = 6;
    }
    hero.dmg = [dieCount, dieSides, Math.max(1, Math.floor(mainMod))];
    hero.attacksPerTurn = (lvl >= 5 && (arch.classKey === 'fighter' || arch.classKey === 'paladin')) ? 2 : 1;
    hero.rangedDmgType = arch.classKey === 'wizard' ? 'magic' : 'piercing';
    if (arch.classKey === 'wizard') hero.cantripClass = 'fire';
    hero.color = 0xe0483a;

    rivals.push(hero);
  }

  return { company, rivals };
}
