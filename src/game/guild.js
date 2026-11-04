/**
 * Guild Manager & Facilities System
 * Handles guild structure upgrades, facility levels, hero assignments, idle mechanics,
 * expeditions, research, runecrafting, and tactical war preparations.
 */

import { grantXp, XP_TABLE, recalc } from './srd.js';
import { rollItem, itemPoints, addToInventory, takeFromInventory, BASES, weaponKindOf,
         isBrewablePotion, makeConsumableFromBase, makeRuneItem, isRune, runeFitsItem,
         canInscribeRune, promoteItemRarity, itemRunes, isSalvageable } from './items.js';

/* Forge categories that are really the weapon slot narrowed to a kind, so a
   ranger who sold their only bow can always make another one. */
const CRAFT_WEAPON_KINDS = { ranged: 'ranged', focus: 'focus' };

/** Armory storage slots granted per facility level (level 10 → 120 slots). */
export const ARMORY_SLOTS_PER_LEVEL = 12;

/** Stored-hero bunks: 6 base + 2 per Living Quarters level (level 1 → 8, level 10 → 26). */
export function storedHeroCap(level) {
  return 6 + Math.max(0, level | 0) * 2;
}

export const FACILITY_DEFINITIONS = {
  living_quarters: {
    id: 'living_quarters',
    name: 'Living Quarters',
    icon: '🏰',
    description: 'Expands stored hero capacity and provides Well-Rested morale bonuses.',
    baseCost: 200,
    costMultiplier: 1.8,
    maxLevel: 10,
    getEffectText: (lvl) => `Max Stored Heroes: ${storedHeroCap(lvl)} · Rested XP Bonus: +${lvl * 2}%`
  },
  armory: {
    id: 'armory',
    name: 'The Armory',
    icon: '🗄️',
    description: 'Store gear the party isn\'t carrying. Stored items survive every delve.',
    baseCost: 250,
    costMultiplier: 1.7,
    maxLevel: 10,
    assignable: false,
    getEffectText: (lvl) => `Storage Slots: ${lvl * ARMORY_SLOTS_PER_LEVEL}`
  },
  training_grounds: {
    id: 'training_grounds',
    name: 'Training Grounds',
    icon: '⚔️',
    description: 'Buy training gear, assign a hero to each piece, and raise their ability scores.',
    baseCost: 350,
    costMultiplier: 2.0,
    maxLevel: 1,
    assignable: false,
    getEffectText: () => `Stations raise STR · DEX · CON · INT · WIS · CHA (cap 20)`
  },
  blacksmith: {
    id: 'blacksmith',
    name: 'The Blacksmith',
    icon: '⚒️',
    description: 'Craft targeted equipment based on Power Score (PS) and salvage unneeded gear into materials.',
    baseCost: 500,
    costMultiplier: 2.2,
    maxLevel: 10,
    getEffectText: (lvl) => `Max Craftable PS: ${15 + lvl * 20} · Forge Discount: ${lvl * 3}%`
  },
  apothecary: {
    id: 'apothecary',
    name: 'The Apothecary',
    icon: '🧪',
    description: 'Craft combat potions, battle flasks, and elixirs from harvested reagents.',
    baseCost: 450,
    costMultiplier: 2.1,
    maxLevel: 10,
    getEffectText: (lvl) => `Brewing Discount: ${lvl * 4}% · Auto-Brew: ${Math.min(5, 2 + Math.floor(lvl * 0.3))} flasks/10 fl · Recipe tier ${lvl}`
  },
  enchanter: {
    id: 'enchanter',
    name: 'Enchanter\'s Spire',
    icon: '🔮',
    description: 'Disenchant magical items into Essences and inscribe Runes onto gear.',
    baseCost: 800,
    costMultiplier: 2.4,
    maxLevel: 10,
    getEffectText: (lvl) => `Recipe tier ${lvl} · Disenchant Dust Yield: +${lvl * 10}%`
  },
  academy: {
    id: 'academy',
    name: 'The Academy',
    icon: '📜',
    description: 'Research permanent technological perks across Military, Arcane, and Logistics trees.',
    baseCost: 1000,
    costMultiplier: 2.5,
    maxLevel: 10,
    getEffectText: (lvl) => `Research Speed: +${lvl * 10}% · Scholar Tome Generation: ${lvl >= 3 ? 'Active' : 'Locked'}`
  },
  cartographer: {
    id: 'cartographer',
    name: 'Cartographer\'s Guild',
    icon: '🗺️',
    description: 'Pre-scouts uncharted dungeon floors and dispatches idle squads on bounties & expeditions.',
    baseCost: 750,
    costMultiplier: 2.3,
    maxLevel: 10,
    getEffectText: (lvl) => `Dungeon Pre-Scouted Rooms: ${Math.min(5, 1 + Math.floor(lvl * 0.4))} · Max Expeditions: ${Math.min(3, 1 + Math.floor(lvl * 0.3))}`
  },
  war_room: {
    id: 'war_room',
    name: 'The War Room',
    icon: '🛡️',
    description: 'Issue Monster Slaying Orders and enact Battle Formation Doctrines.',
    baseCost: 900,
    costMultiplier: 2.4,
    maxLevel: 10,
    getEffectText: (lvl) => `Slaying Order Bonus: +${10 + lvl * 2}% Dmg/Def vs Target Family`
  }
};

/* ── Academy Research Tree ───────────────────────────────────────────── */
export const TECH_TREE = {
  // Branch: Military (Tiers 1-4)
  m1_vitality: {
    id: 'm1_vitality', branch: 'military', tier: 1, minPartyLevel: 3, name: 'Martial Conditioning', icon: '❤️',
    desc: '+8% Global Party Max HP', costGold: 2000, costTomes: 2, reqs: [], key: 'hpBonus', val: 0.08
  },
  m2_striking: {
    id: 'm2_striking', branch: 'military', tier: 2, minPartyLevel: 7, name: 'Lethal Precision', icon: '🎯',
    desc: '+6% Critical Strike Chance & +10% Critical Damage', costGold: 10000, costTomes: 4, reqs: ['m1_vitality'], key: 'critBonus', val: 0.06
  },
  m3_warlord: {
    id: 'm3_warlord', branch: 'military', tier: 3, minPartyLevel: 12, name: 'Vanguard Mastery', icon: '⚔️',
    desc: '+12% Physical Weapon Damage & +1 Armor Class', costGold: 45000, costTomes: 10, reqs: ['m2_striking'], key: 'physDmgBonus', val: 0.12
  },
  m4_legend: {
    id: 'm4_legend', branch: 'military', tier: 4, minPartyLevel: 16, name: 'Ascendant Warlord', icon: '👑',
    desc: '+1 Additional Weapon Attack per round & +15% Physical Resistance', costGold: 150000, costTomes: 20, reqs: ['m3_warlord'], key: 'extraAttacks', val: 1
  },

  // Branch: Arcane (Tiers 1-4)
  a1_alchemy: {
    id: 'a1_alchemy', branch: 'arcane', tier: 1, minPartyLevel: 3, name: 'Potent Concoctions', icon: '🧪',
    desc: '+30% Healing Potion & Battle Flask effectiveness', costGold: 2000, costTomes: 2, reqs: [], key: 'potionEfficacy', val: 0.30
  },
  a2_attunement: {
    id: 'a2_attunement', branch: 'arcane', tier: 2, minPartyLevel: 7, name: 'Arcane Overchannel', icon: '✨',
    desc: '+1 Spell Save DC & +12% Spell Damage', costGold: 10000, costTomes: 4, reqs: ['a1_alchemy'], key: 'spellDmgBonus', val: 0.12
  },
  a3_resilience: {
    id: 'a3_resilience', branch: 'arcane', tier: 3, minPartyLevel: 12, name: 'Prismatic Aegis', icon: '🛡️',
    desc: '+15% Elemental Resistance & +1 Spell Slot to all levels', costGold: 45000, costTomes: 10, reqs: ['a2_attunement'], key: 'eleResist', val: 0.15
  },
  a4_archmage: {
    id: 'a4_archmage', branch: 'arcane', tier: 4, minPartyLevel: 16, name: "Archmage's Singularity", icon: '🌌',
    desc: '25% Chance to refund spell slots & +20% Spell Penetration', costGold: 150000, costTomes: 20, reqs: ['a3_resilience'], key: 'freeSpellChance', val: 0.25
  },

  // Branch: Logistics (Tiers 1-4)
  l1_treasury: {
    id: 'l1_treasury', branch: 'logistics', tier: 1, minPartyLevel: 3, name: 'Treasure Accounting', icon: '🪙',
    desc: '+20% Gold found in dungeons & quest rewards', costGold: 1800, costTomes: 1, reqs: [], key: 'goldBonus', val: 0.20
  },
  l2_barter: {
    id: 'l2_barter', branch: 'logistics', tier: 2, minPartyLevel: 7, name: 'Merchant Syndicate', icon: '⚖️',
    desc: '20% Shop Purchase Discount & +25% Item Sell Value', costGold: 9000, costTomes: 3, reqs: ['l1_treasury'], key: 'shopDiscount', val: 0.20
  },
  l3_expansion: {
    id: 'l3_expansion', branch: 'logistics', tier: 3, minPartyLevel: 12, name: 'Grand Quartermaster', icon: '🗄️',
    desc: '+24 Armory Storage Slots & +4 Tavern Recruitment Pool', costGold: 40000, costTomes: 8, reqs: ['l2_barter'], key: 'extraSlots', val: 24
  },
  l4_monopoly: {
    id: 'l4_monopoly', branch: 'logistics', tier: 4, minPartyLevel: 16, name: 'Guild Imperial Treasury', icon: '💎',
    desc: '+40% Global Gold Yield & Equip 1 Additional Ancestral Relic', costGold: 140000, costTomes: 18, reqs: ['l3_expansion'], key: 'goldBonus', val: 0.40
  },

  // Branch: Exploration (Tiers 1-4)
  e1_pathfinding: {
    id: 'e1_pathfinding', branch: 'exploration', tier: 1, minPartyLevel: 3, name: 'Swift Trailblazing', icon: '🦶',
    desc: '+15% Party Movement Speed during dungeon exploration', costGold: 1800, costTomes: 1, reqs: [], key: 'speedBonus', val: 0.15
  },
  e2_scouting: {
    id: 'e2_scouting', branch: 'exploration', tier: 2, minPartyLevel: 7, name: 'Eagle Eye Cartography', icon: '👁️',
    desc: '+2 Extra Dungeon Rooms charted by Cartographer on every floor', costGold: 9000, costTomes: 3, reqs: ['e1_pathfinding'], key: 'scoutBonus', val: 2
  },
  e3_dungeoneering: {
    id: 'e3_dungeoneering', branch: 'exploration', tier: 3, minPartyLevel: 12, name: 'Secret Dowsing', icon: '🗝️',
    desc: '+35% Chance to find bonus loot & potions when searching rooms', costGold: 40000, costTomes: 8, reqs: ['e2_scouting'], key: 'searchBonus', val: 0.35
  },
  e4_omniscience: {
    id: 'e4_omniscience', branch: 'exploration', tier: 4, minPartyLevel: 16, name: 'Omniscient Mapping', icon: '🧭',
    desc: 'Reveals Boss Room and Shrines immediately upon entering floor', costGold: 140000, costTomes: 18, reqs: ['e3_dungeoneering'], key: 'fullMapVision', val: 1
  }
};

/* ── Enchanter Runes ───────────────────────────────────────────────────
   One effect each. Gold 2k / 6k / 18k by tier. Spire level gates the shelf. */
const _RG = [0, 2000, 6000, 18000];
const _RD = [0, 6, 12, 24];
const _RE = [0, 2, 3, 5];
const _RN = ['', 'I', 'II', 'III'];

export const RUNE_RECIPES = (() => {
  const out = {};
  const add = (r) => { out[r.id] = r; };

  const dmg = (id, name, icon, elem, ess, tier, minLevel) => add({
    id, name: `${name} ${_RN[tier]}`, icon, slotType: 'weapon', minLevel,
    goldCost: _RG[tier], dustCost: _RD[tier], essenceKey: ess, essenceCost: _RE[tier],
    effect: { type: 'elemDice', elem, dice: [1, [0, 4, 6, 8][tier]] },
    desc: `+1d${[0, 4, 6, 8][tier]} ${elem} on hit`
  });
  dmg('flame_1', 'Searing Flame', '🔥', 'fire', 'fire', 1, 1);
  dmg('flame_2', 'Searing Flame', '🔥', 'fire', 'fire', 2, 4);
  dmg('flame_3', 'Searing Flame', '🔥', 'fire', 'fire', 3, 7);
  dmg('frost_1', 'Bitter Frost', '❄️', 'cold', 'frost', 1, 1);
  dmg('frost_2', 'Bitter Frost', '❄️', 'cold', 'frost', 2, 4);
  dmg('frost_3', 'Bitter Frost', '❄️', 'cold', 'frost', 3, 7);
  dmg('thunder_1', 'Crackling Thunder', '⚡', 'lightning', 'lightning', 1, 1);
  dmg('thunder_2', 'Crackling Thunder', '⚡', 'lightning', 'lightning', 2, 4);
  dmg('thunder_3', 'Crackling Thunder', '⚡', 'lightning', 'lightning', 3, 7);
  dmg('venom_1', 'Venom', '☠️', 'poison', 'shadow', 1, 1);
  dmg('venom_2', 'Venom', '☠️', 'poison', 'shadow', 2, 4);
  dmg('venom_3', 'Venom', '☠️', 'poison', 'shadow', 3, 7);

  const proc = (id, name, icon, ess, cond, tier, minLevel) => add({
    id, name: `${name} ${_RN[tier]}`, icon, slotType: 'weapon', minLevel,
    goldCost: _RG[tier], dustCost: _RD[tier], essenceKey: ess, essenceCost: _RE[tier],
    effect: { type: 'saveProc', save: 'con', dc: [0, 12, 14, 16][tier], condition: cond },
    desc: `On hit, CON save DC ${[0, 12, 14, 16][tier]} or ${cond} 1 round`
  });
  proc('numbing_1', 'Numbing', '❄️', 'frost', 'slowed', 1, 3);
  proc('numbing_2', 'Numbing', '❄️', 'frost', 'slowed', 2, 8);
  proc('numbing_3', 'Numbing', '❄️', 'frost', 'slowed', 3, 10);
  proc('shocking_1', 'Shocking', '⚡', 'lightning', 'stunned', 1, 3);
  proc('shocking_2', 'Shocking', '⚡', 'lightning', 'stunned', 2, 8);
  proc('shocking_3', 'Shocking', '⚡', 'lightning', 'stunned', 3, 10);

  const feed = (id, tier, minLevel) => add({
    id, name: `Bloodfeeder ${_RN[tier]}`, icon: '🩸', slotType: 'weapon', minLevel,
    goldCost: _RG[tier], dustCost: _RD[tier], essenceKey: 'shadow', essenceCost: _RE[tier],
    effect: { type: 'healDice', dice: [1, [0, 4, 6, 8][tier]] },
    desc: `On hit, heal 1d${[0, 4, 6, 8][tier]}`
  });
  feed('blood_1', 1, 6);
  feed('blood_2', 2, 9);
  feed('blood_3', 3, 10);

  const col = (id, n, tier, minLevel) => add({
    id, name: `Colossus ${_RN[tier]}`, icon: '🗿', slotType: 'armor', minLevel,
    goldCost: _RG[tier], dustCost: _RD[tier], essenceKey: 'radiant', essenceCost: _RE[tier],
    effect: { type: 'hp', n },
    desc: `+${n} maximum HP`
  });
  col('colossus_1', 10, 1, 1);
  col('colossus_2', 20, 2, 7);
  col('colossus_3', 30, 3, 10);

  const aegis = (id, n, tier, minLevel) => add({
    id, name: `Aegis ${_RN[tier]}`, icon: '🛡️', slotType: 'armor', minLevel,
    goldCost: _RG[tier], dustCost: _RD[tier], essenceKey: 'radiant', essenceCost: _RE[tier],
    effect: { type: 'ac', n },
    desc: `+${n} Armor Class`
  });
  aegis('aegis_1', 1, 1, 1);
  aegis('aegis_2', 2, 2, 7);
  aegis('aegis_3', 3, 3, 10);

  const swift = (id, ft, tier, minLevel) => add({
    id, name: `Swift ${_RN[tier]}`, icon: '💨', slotType: 'worn', minLevel,
    goldCost: _RG[tier], dustCost: _RD[tier], essenceKey: 'lightning', essenceCost: _RE[tier],
    effect: { type: 'move', n: ft },
    desc: `+${ft} ft movement`
  });
  swift('swift_1', 5, 1, 3);
  swift('swift_2', 10, 2, 6);
  swift('swift_3', 15, 3, 10);

  const stats = [
    ['might', 'Might', '💪', 'str', 'fire'],
    ['grace', 'Grace', '🪶', 'dex', 'lightning'],
    ['ironhide', 'Ironhide', '🪨', 'con', 'radiant'],
    ['wit', 'Wit', '📘', 'int', 'frost'],
    ['sight', 'Sight', '👁', 'wis', 'frost'],
    ['presence', 'Presence', '👑', 'cha', 'radiant']
  ];
  for (const [id, name, icon, stat, ess] of stats) {
    add({
      id: `${id}_1`, name: `${name} I`, icon, slotType: 'worn', minLevel: 2,
      goldCost: _RG[1], dustCost: _RD[1], essenceKey: ess, essenceCost: _RE[1],
      effect: { type: 'stat', stat, n: 1 },
      desc: `+1 ${stat.toUpperCase()}`
    });
    add({
      id: `${id}_2`, name: `${name} II`, icon, slotType: 'worn', minLevel: 9,
      goldCost: _RG[2], dustCost: _RD[2], essenceKey: ess, essenceCost: _RE[2],
      effect: { type: 'stat', stat, n: 2 },
      desc: `+2 ${stat.toUpperCase()}`
    });
  }

  const wards = [
    ['fire', '🔥', 'fire', 5],
    ['cold', '❄️', 'frost', 5],
    ['lightning', '⚡', 'lightning', 5],
    ['acid', '🧪', 'shadow', 5],
    ['poison', '☠️', 'shadow', 5],
    ['bludgeoning', '🔨', 'radiant', 8],
    ['slashing', '⚔️', 'radiant', 8],
    ['piercing', '🏹', 'radiant', 8],
    ['necrotic', '💀', 'shadow', 9],
    ['radiant', '✨', 'radiant', 9]
  ];
  for (const [dmgType, icon, ess, minLevel] of wards) {
    add({
      id: `ward_${dmgType}`, name: `Ward of ${dmgType[0].toUpperCase()}${dmgType.slice(1)}`,
      icon, slotType: 'worn', minLevel,
      goldCost: 3500, dustCost: 10, essenceKey: ess, essenceCost: 3,
      effect: { type: 'resist', dmgType },
      desc: `Resistance to ${dmgType} (half damage)`
    });
  }

  /* Old save keys still resolve for inscribed gear from before the rework. */
  out.rune_flame = out.flame_1;
  out.rune_frost = out.frost_1;
  out.rune_thunder = out.thunder_1;
  out.rune_vampire = out.blood_1;
  out.rune_titan = out.colossus_1;
  out.rune_warding = out.aegis_2;
  return out;
})();

/* ── War Room Slaying Orders & Doctrines ──────────────────────────────── */
export const SLAYING_ORDERS = {
  undead_purge: { id: 'undead_purge', name: 'Undead Purge', family: 'undead', icon: '💀', desc: 'Focus tactics against Skeletons, Zombies, Ghosts, and Liches.' },
  fiendbane: { id: 'fiendbane', name: 'Fiendbane Crusade', family: 'fiend', icon: '😈', desc: 'Focus tactics against Imps, Cultists, Hell Hounds, and Fiends.' },
  dragon_hunt: { id: 'dragon_hunt', name: 'Dragon Hunt', family: 'dragon', icon: '🐉', desc: 'Focus tactics against Wyrmlings, Drakes, and Dragons.' },
  beast_cull: { id: 'beast_cull', name: 'Wild Beast Cull', family: 'beast', icon: '🐺', desc: 'Focus tactics against Wolves, Spiders, Owlbears, and Beasts.' },
  aberration_ward: { id: 'aberration_ward', name: 'Aberration Ward', family: 'aberration', icon: '👁️', desc: 'Focus tactics against Mind Flayers, Beholders, and Slimes.' }
};

export const BATTLE_DOCTRINES = {
  phalanx: { id: 'phalanx', name: 'Phalanx Wall', icon: '🛡️', desc: 'Frontline heroes gain +2 Armor Class when adjacent to an ally.' },
  ambush: { id: 'ambush', name: 'Ambush Drill', icon: '🗡️', desc: 'First-turn attacks have +25% Critical Hit chance.' },
  triage: { id: 'triage', name: 'Combat Triage', icon: '🩹', desc: 'Short rests heal +30% additional HP for the entire party.' }
};

/* ── Cartographer Expedition Templates ───────────────────────────────── */
export const EXPEDITION_TEMPLATES = [
  {
    id: 'forage_forest', name: 'Verdant Timber & Herb Foraging', type: 'gathering', icon: '🌲',
    desc: 'Scout forest foothills for crafting iron, hardened leather, and alchemy reagents.',
    durationFloors: 4, minHeroes: 1, maxHeroes: 3, recommendedLevel: 1,
    rewards: { gold: 120, iron: 4, leather: 4, dust: 2 }
  },
  {
    id: 'cull_bounty', name: 'Goblin Ambush Squad Bounty', type: 'bounty', icon: '👺',
    desc: 'Eliminate a marauding band of raiders threatening trade routes.',
    durationFloors: 6, minHeroes: 2, maxHeroes: 4, recommendedLevel: 2,
    rewards: { gold: 280, iron: 6, dust: 4, tomes: 1 }
  },
  {
    id: 'ruins_recon', name: 'Sunken Crypt Reconnaissance', type: 'recon', icon: '🏛️',
    desc: 'Chart ancient tomb catacombs and salvage arcane essences from sealed reliquaries.',
    durationFloors: 8, minHeroes: 2, maxHeroes: 4, recommendedLevel: 3,
    rewards: { gold: 450, dust: 8, essences: 3, tomes: 2 }
  },
  {
    id: 'deep_hunt', name: 'Subterranean Beast Extermination', type: 'hunt', icon: '🐉',
    desc: 'High-threat expedition to slay deep dungeon predators and claim ancient spoils.',
    durationFloors: 10, minHeroes: 3, maxHeroes: 4, recommendedLevel: 4,
    rewards: { gold: 750, iron: 12, leather: 12, essences: 5, tomes: 3 }
  }
];

/** Pieces of yard gear. Buy each one, park a hero, raise that ability. */
export const TRAINING_GEAR = {
  pell:   { id: 'pell',   name: 'Pell Post',      stat: 'str', cost: 200, upgradeCost: 160, desc: 'A striking dummy. Builds Strength.' },
  track:  { id: 'track',  name: 'Sand Track',     stat: 'dex', cost: 220, upgradeCost: 170, desc: 'Sprints and footwork. Builds Dexterity.' },
  stones: { id: 'stones', name: 'Burden Stones',  stat: 'con', cost: 240, upgradeCost: 180, desc: 'Haul and hold. Builds Constitution.' },
  slate:  { id: 'slate',  name: 'Drill Slate',    stat: 'int', cost: 260, upgradeCost: 190, desc: 'Forms and counts. Builds Intelligence.' },
  shrine: { id: 'shrine', name: 'Quiet Shrine',   stat: 'wis', cost: 260, upgradeCost: 190, desc: 'Stillness and breath. Builds Wisdom.' },
  ring:   { id: 'ring',   name: 'Sparring Ring',  stat: 'cha', cost: 240, upgradeCost: 180, desc: 'Presence under eyes. Builds Charisma.' }
};
export const TRAINING_STAT_CAP = 20;
export const TRAINING_GEAR_MAX_LEVEL = 5;
export const TRAINING_MAX_STATIONS = 8;

/** Floors to gain +1 in `statValue` on a piece of level `gearLevel`. */
export function trainingFloorsForGain(statValue, gearLevel = 1) {
  const stat = Math.max(1, statValue | 0);
  const lvl = Math.max(1, Math.min(TRAINING_GEAR_MAX_LEVEL, gearLevel | 0));
  return Math.max(6, 8 + (stat - 10) * 3 - (lvl - 1) * 2);
}

/** Apothecary facility level required to brew this trinket base. */
export function brewUnlockLevel(base) {
  if (!base) return 99;
  if (base.potionPool === 'heal') return 1;
  if (base.potionPool === 'greater') return 4;
  if (base.potionPool === 'superior') return 8;
  return Math.max(1, Math.min(10, (base.minIlvl | 0) || 1));
}

export function brewPowerScore(apothecaryLevel, heroInt) {
  const lvlRatio = Math.min(1.0, Math.max(0.1, apothecaryLevel / 10));
  const intRatio = Math.min(1.0, Math.max(0.5, (heroInt || 10) / 20));
  return (lvlRatio * 0.5) + (intRatio * 0.5);
}

/** Floors a batch takes. Higher still / smarter alchemist finishes sooner. */
export function getBrewDuration(base, apothecaryLevel, heroInt) {
  const rarityFloors = { common: 8, uncommon: 10, rare: 12, epic: 16 };
  let baseFloors = rarityFloors[base?.rarity] || 10;
  if (base?.potionPool === 'heal') baseFloors = 10;
  else if (base?.potionPool === 'greater') baseFloors = 12;
  else if (base?.potionPool === 'superior') baseFloors = 14;
  const speed = Math.floor((apothecaryLevel || 1) * 0.4)
    + Math.max(0, Math.floor(((heroInt || 10) - 10) / 4));
  return Math.max(4, baseFloors - speed);
}

/** How many bottles a finished batch yields. */
export function getBrewQuantity(base, apothecaryLevel, heroInt) {
  const ps = brewPowerScore(apothecaryLevel, heroInt);
  if (base?.potionPool) {
    return Math.max(2, Math.min(5, Math.round(2 + ((ps - 0.30) / 0.70) * 3)));
  }
  return Math.max(1, Math.min(3, Math.round(1 + ps * 2)));
}

export function getApothecaryBrewOutput(apothecaryLevel, heroInt, floors = 10) {
  const powerScore = brewPowerScore(apothecaryLevel, heroInt);
  const quantityPer10 = getBrewQuantity({ potionPool: 'heal' }, apothecaryLevel, heroInt);
  const totalQuantity = Math.floor(quantityPer10 * (floors / 10));

  let potionTier = 'heal';
  let tierLabel = 'Health Potion';

  if (powerScore >= 0.85) {
    potionTier = 'superior';
    tierLabel = 'Superior Potion';
  } else if (powerScore >= 0.55) {
    potionTier = 'greater';
    tierLabel = 'Greater Potion';
  }

  return { powerScore, potionTier, tierLabel, quantity: totalQuantity, quantityPer10 };
}

export class GuildManager {
  constructor(game) {
    this.game = game;
    this.facilityLevels = {};
    this.heroAssignments = {}; // { heroName: facilityId }
    this.apothecaryFloors = 0;
    this.apothecaryRecipe = 'Potion of Healing';
    this.trainingStations = []; // [{ id, key, level }]
    this.stationAssignments = {}; // { stationId: heroName }
    this.stationProgress = {}; // { stationId: floors }
    this._stationSeq = 1;
    this.storedItems = [];      // Armory: gear parked between delves

    // Resource Economy
    this.materials = { iron: 10, leather: 10 };
    this.essences = { dust: 15, fire: 3, frost: 3, lightning: 3, shadow: 2, radiant: 2 };
    this.tomes = 2;

    // Academy Research Tree
    this.unlockedTechs = new Set(['m1_vitality']);

    // Runecrafting & Inventory
    this.craftedRunes = []; // [{ id, runeKey, date }]

    // War Room
    this.activeSlayingOrder = 'undead_purge';
    this.activeDoctrine = 'phalanx';

    // Cartographer Expeditions
    this.activeExpeditions = []; // [{ templateId, name, heroes: [], floorsRemaining, totalFloors, rewards, progress }]

    for (const key of Object.keys(FACILITY_DEFINITIONS)) {
      this.facilityLevels[key] = key === 'living_quarters' ? 1 : 0;
    }
  }

  serialize() {
    return {
      facilityLevels: { ...this.facilityLevels },
      heroAssignments: { ...this.heroAssignments },
      apothecaryFloors: this.apothecaryFloors || 0,
      apothecaryRecipe: this.apothecaryRecipe || 'Potion of Healing',
      trainingStations: (this.trainingStations || []).map(s => ({ ...s })),
      stationAssignments: { ...this.stationAssignments },
      stationProgress: { ...this.stationProgress },
      storedItems: [ ...this.storedItems ],
      materials: { ...this.materials },
      essences: { ...this.essences },
      tomes: this.tomes || 0,
      unlockedTechs: Array.from(this.unlockedTechs || []),
      craftedRunes: [ ...this.craftedRunes ],
      activeSlayingOrder: this.activeSlayingOrder || 'undead_purge',
      activeDoctrine: this.activeDoctrine || 'phalanx',
      activeExpeditions: [ ...this.activeExpeditions ]
    };
  }

  deserialize(data) {
    if (!data) return;
    if (data.facilityLevels) {
      this.facilityLevels = { ...this.facilityLevels, ...data.facilityLevels };
      for (const k of Object.keys(this.facilityLevels)) {
        if (!FACILITY_DEFINITIONS[k]) delete this.facilityLevels[k];
      }
    }
    if (data.heroAssignments) {
      this.heroAssignments = { ...data.heroAssignments };
    }
    this.stripUnassignableJobs();
    if (typeof data.apothecaryFloors === 'number') {
      this.apothecaryFloors = data.apothecaryFloors;
    }
    if (data.apothecaryRecipe) {
      this.apothecaryRecipe = data.apothecaryRecipe;
    }
    if (Array.isArray(data.trainingStations)) {
      this.trainingStations = data.trainingStations.filter(s => s && TRAINING_GEAR[s.key]).map(s => ({
        id: s.id, key: s.key, level: Math.max(1, s.level | 0)
      }));
      this._stationSeq = this.trainingStations.reduce((n, s) => {
        const m = /^tg_(\d+)$/.exec(s.id || '');
        return m ? Math.max(n, (+m[1]) + 1) : n;
      }, this._stationSeq || 1);
    }
    if (data.stationAssignments) this.stationAssignments = { ...data.stationAssignments };
    if (data.stationProgress) this.stationProgress = { ...data.stationProgress };
    if (Array.isArray(data.storedItems)) {
      this.storedItems = data.storedItems.filter(Boolean);
    }
    if (data.materials) {
      this.materials = { ...this.materials, ...data.materials };
    }
    if (data.essences) {
      this.essences = { ...this.essences, ...data.essences };
    }
    if (typeof data.tomes === 'number') {
      this.tomes = data.tomes;
    }
    if (Array.isArray(data.unlockedTechs)) {
      this.unlockedTechs = new Set(data.unlockedTechs);
    }
    if (Array.isArray(data.craftedRunes) && data.craftedRunes.length) {
      if (!this.game.inventory) this.game.inventory = [];
      for (const rn of data.craftedRunes) {
        const recipe = RUNE_RECIPES[rn.runeKey] || rn;
        const item = makeRuneItem(recipe);
        if (item) addToInventory(this.game.inventory, item);
      }
      this.craftedRunes = [];
    }
    if (data.activeSlayingOrder) {
      this.activeSlayingOrder = data.activeSlayingOrder;
    }
    if (data.activeDoctrine) {
      this.activeDoctrine = data.activeDoctrine;
    }
    if (Array.isArray(data.activeExpeditions)) {
      this.activeExpeditions = [ ...data.activeExpeditions ];
    }
  }

  /* ── Facility Levels & Upgrades ────────────────────────────────────── */
  getFacilityLevel(facilityId) {
    return this.facilityLevels[facilityId] ?? 0;
  }

  isUnlocked(facilityId) {
    return this.getFacilityLevel(facilityId) > 0;
  }

  /* ── Living Quarters bunks ─────────────────────────────────────────── */
  getStoredHeroCap() {
    return storedHeroCap(this.getFacilityLevel('living_quarters'));
  }

  getStoredHeroFreeSlots() {
    const used = (this.game.storedHeroes || []).length;
    return Math.max(0, this.getStoredHeroCap() - used);
  }

  canStoreHero() {
    return this.getStoredHeroFreeSlots() > 0;
  }

  getUpgradeCost(facilityId) {
    const def = FACILITY_DEFINITIONS[facilityId];
    if (!def) return Infinity;
    const level = this.getFacilityLevel(facilityId);
    if (level >= def.maxLevel) return Infinity;
    if (level === 0) return def.baseCost;
    return Math.floor(def.baseCost * Math.pow(def.costMultiplier, level));
  }

  canUpgrade(facilityId) {
    const cost = this.getUpgradeCost(facilityId);
    return this.game.gold >= cost && this.getFacilityLevel(facilityId) < (FACILITY_DEFINITIONS[facilityId]?.maxLevel || 10);
  }

  upgradeFacility(facilityId) {
    if (!this.canUpgrade(facilityId)) return false;
    const cost = this.getUpgradeCost(facilityId);
    this.game.gold -= cost;
    this.facilityLevels[facilityId] = (this.facilityLevels[facilityId] || 0) + 1;
    return true;
  }

  assignHero(heroNameOrId, facilityId) {
    if (!facilityId) {
      delete this.heroAssignments[heroNameOrId];
      this._clearHeroStations(heroNameOrId);
      return true;
    }
    if (FACILITY_DEFINITIONS[facilityId]?.assignable === false) return false;
    if (!this.isUnlocked(facilityId)) return false;
    if (facilityId !== 'training_grounds') this._clearHeroStations(heroNameOrId);
    this.heroAssignments[heroNameOrId] = facilityId;
    return true;
  }

  _clearHeroStations(heroName) {
    for (const [sid, name] of Object.entries(this.stationAssignments || {})) {
      if (name === heroName) delete this.stationAssignments[sid];
    }
  }

  /** Drop jobs on buildings that no longer take a worker (e.g. Armory). */
  stripUnassignableJobs() {
    let n = 0;
    for (const [hero, fac] of Object.entries(this.heroAssignments)) {
      const def = FACILITY_DEFINITIONS[fac];
      if (!def || def.assignable === false) {
        delete this.heroAssignments[hero];
        n++;
      }
    }
    return n;
  }

  getAssignedHeroes(facilityId) {
    const list = [];
    for (const [heroId, assignedFac] of Object.entries(this.heroAssignments)) {
      if (assignedFac === facilityId) {
        list.push(heroId);
      }
    }
    return list;
  }

  /* ── Armory ────────────────────────────────────────────────────────── */
  getArmoryCapacity() {
    return this.getFacilityLevel('armory') * ARMORY_SLOTS_PER_LEVEL + (this.hasTech('l3_expansion') ? 12 : 0);
  }

  getArmoryFreeSlots() {
    return Math.max(0, this.getArmoryCapacity() - this.storedItems.length);
  }

  depositItem(item) {
    if (!item) return { ok: false, reason: 'Nothing to store.' };
    if (this.getArmoryFreeSlots() <= 0) {
      return { ok: false, reason: 'The Armory is full — upgrade it for more slots.' };
    }
    const inv = this.game.inventory || [];
    const idx = inv.indexOf(item);
    if (idx < 0) return { ok: false, reason: 'That item is no longer in your inventory.' };
    inv.splice(idx, 1);
    this.storedItems.push(item);
    return { ok: true };
  }

  withdrawItem(item) {
    if (!item) return { ok: false, reason: 'Nothing to withdraw.' };
    const idx = this.storedItems.indexOf(item);
    if (idx < 0) return { ok: false, reason: 'That item is no longer in the Armory.' };
    this.storedItems.splice(idx, 1);
    if (!this.game.inventory) this.game.inventory = [];
    addToInventory(this.game.inventory, item);
    return { ok: true };
  }

  depositAllGear() {
    const inv = this.game.inventory || [];
    const gear = inv.filter(i => i && i.slot && i.kind !== 'potion' && i.kind !== 'dye');
    let n = 0;
    for (const item of gear) {
      if (this.getArmoryFreeSlots() <= 0) break;
      if (this.depositItem(item).ok) n++;
    }
    return n;
  }

  /* ── Cartographer Pre-Scouting & Expeditions ───────────────────────── */

  /**
   * Called when entering a new dungeon floor.
   * Returns an array of room IDs that should be pre-charted / visible on the floor map.
   */
  getDungeonPreScoutedRooms(dungeon) {
    if (!dungeon || !dungeon.rooms || dungeon.rooms.length === 0) return [];
    if (!this.isUnlocked('cartographer')) return [];

    const lvl = this.getFacilityLevel('cartographer');
    let numRoomsToScout = Math.min(dungeon.rooms.length, 1 + Math.floor(lvl * 0.4));

    // Tech boost: Eagle Eye Scouting
    if (this.hasTech('e2_scouting')) numRoomsToScout += 1;

    // Assigned scout hero boost (Ranger or Rogue)
    const assigned = this.getAssignedHeroes('cartographer')[0];
    if (assigned) {
      const hero = (this.game.storedHeroes || []).find(h => h.name === assigned);
      if (hero && (hero.classKey === 'ranger' || hero.classKey === 'rogue')) {
        numRoomsToScout += 1;
      }
    }

    const scouted = [];
    // Prioritize special rooms (treasure, shrine) if cartographer level >= 4
    if (lvl >= 4) {
      for (let i = 0; i < dungeon.rooms.length; i++) {
        const r = dungeon.rooms[i];
        if (r && (r.type === 'treasure' || r.type === 'shrine') && !scouted.includes(i)) {
          scouted.push(i);
          if (scouted.length >= numRoomsToScout) break;
        }
      }
    }

    // Fill remaining scout count with random unvisited rooms (excluding boss until level 7)
    for (let i = 0; i < dungeon.rooms.length; i++) {
      if (scouted.length >= numRoomsToScout) break;
      if (i === dungeon.boss && lvl < 7) continue;
      if (!scouted.includes(i)) scouted.push(i);
    }

    return scouted;
  }

  getAvailableExpeditions() {
    return EXPEDITION_TEMPLATES.map(t => {
      const active = this.activeExpeditions.find(e => e.templateId === t.id);
      return {
        ...t,
        active: !!active,
        expeditionData: active || null
      };
    });
  }

  dispatchExpedition(templateId, heroNames) {
    if (!this.isUnlocked('cartographer')) return { ok: false, reason: 'Cartographer is locked.' };
    const maxExp = Math.min(3, 1 + Math.floor(this.getFacilityLevel('cartographer') * 0.3));
    if (this.activeExpeditions.length >= maxExp) {
      return { ok: false, reason: `Max simultaneous expeditions (${maxExp}) reached.` };
    }
    const template = EXPEDITION_TEMPLATES.find(t => t.id === templateId);
    if (!template) return { ok: false, reason: 'Invalid expedition template.' };
    if (!heroNames || heroNames.length < template.minHeroes) {
      return { ok: false, reason: `Requires at least ${template.minHeroes} heroes.` };
    }

    this.activeExpeditions.push({
      id: `${templateId}_${Date.now()}`,
      templateId,
      name: template.name,
      heroes: [ ...heroNames ],
      floorsRemaining: template.durationFloors,
      totalFloors: template.durationFloors,
      rewards: { ...template.rewards },
      completed: false
    });

    return { ok: true };
  }

  claimExpedition(expeditionId) {
    const idx = this.activeExpeditions.findIndex(e => e.id === expeditionId);
    if (idx < 0) return { ok: false, reason: 'Expedition not found.' };
    const exp = this.activeExpeditions[idx];
    if (exp.floorsRemaining > 0 && !exp.completed) {
      return { ok: false, reason: 'Expedition is still in progress.' };
    }

    // Award rewards
    const r = exp.rewards;
    if (r.gold) this.game.gold += r.gold;
    if (r.iron) this.materials.iron = (this.materials.iron || 0) + r.iron;
    if (r.leather) this.materials.leather = (this.materials.leather || 0) + r.leather;
    if (r.dust) this.essences.dust = (this.essences.dust || 0) + r.dust;
    if (r.tomes) this.tomes = (this.tomes || 0) + r.tomes;
    if (r.essences) {
      const keys = ['fire', 'frost', 'lightning', 'shadow', 'radiant'];
      const chosen = keys[Math.floor(Math.random() * keys.length)];
      this.essences[chosen] = (this.essences[chosen] || 0) + r.essences;
    }

    // Award XP to expedition squad heroes
    const xpEach = Math.round((r.gold || 100) * 1.5);
    for (const hName of exp.heroes) {
      const hero = (this.game.storedHeroes || []).find(h => h.name === hName);
      if (hero) {
        hero.xp = (hero.xp || 0) + xpEach;
        const nextLvlXp = (hero.level || 1) * 100;
        if (hero.xp >= nextLvlXp) hero.level = (hero.level || 1) + 1;
      }
    }

    this.activeExpeditions.splice(idx, 1);
    return { ok: true, rewards: r };
  }

  /* ── Academy Research Tree ─────────────────────────────────────────── */
  hasTech(techId) {
    return this.unlockedTechs && this.unlockedTechs.has(techId);
  }

  canUnlockTech(techId) {
    if (!this.isUnlocked('academy')) return false;
    const tech = TECH_TREE[techId];
    if (!tech) return false;
    if (this.hasTech(techId)) return false;

    // Check Party Level requirement if available
    const pLvl = typeof this.game.partyLevel === 'function' ? this.game.partyLevel() : (this.game.effectiveLevel || 1);
    if (tech.minPartyLevel && pLvl < tech.minPartyLevel) return false;

    // Check prerequisites
    for (const req of tech.reqs) {
      if (!this.hasTech(req)) return false;
    }

    return this.game.gold >= tech.costGold && (this.tomes || 0) >= tech.costTomes;
  }

  unlockTech(techId) {
    if (!this.canUnlockTech(techId)) return false;
    const tech = TECH_TREE[techId];
    this.game.gold -= tech.costGold;
    this.tomes -= tech.costTomes;
    this.unlockedTechs.add(techId);
    return true;
  }

  getTechBonus(key) {
    let total = 0;
    if (!this.unlockedTechs) return total;
    for (const techId of this.unlockedTechs) {
      const t = TECH_TREE[techId];
      if (t && t.key === key) total += t.val;
    }
    return total;
  }

  /* ── Enchanter Disenchanting & Runecrafting ─────────────────────────── */
  getDisenchantPreview(item) {
    const rarity = item?.rarity || 'common';
    let dust = 3;
    let essencePool = null;
    if (rarity === 'uncommon') dust = 6;
    else if (rarity === 'rare') { dust = 12; essencePool = ['fire', 'frost', 'lightning']; }
    else if (rarity === 'epic') { dust = 24; essencePool = ['shadow', 'radiant', 'fire', 'frost']; }
    else if (rarity === 'legendary') { dust = 50; essencePool = ['shadow', 'radiant']; }
    const enchLvl = this.getFacilityLevel('enchanter');
    dust = Math.round(dust * (1 + enchLvl * 0.10));
    return { dust, essencePool };
  }

  disenchantItem(item) {
    if (!this.isUnlocked('enchanter')) return { ok: false, reason: 'Enchanter is locked.' };
    if (!item) return { ok: false, reason: 'No item selected.' };

    const inv = this.game.inventory || [];
    const idx = inv.indexOf(item);
    if (idx < 0) return { ok: false, reason: 'Item not in inventory.' };

    const preview = this.getDisenchantPreview(item);
    inv.splice(idx, 1);

    const essenceKey = preview.essencePool
      ? preview.essencePool[Math.floor(Math.random() * preview.essencePool.length)]
      : null;

    this.essences.dust = (this.essences.dust || 0) + preview.dust;
    if (essenceKey) {
      this.essences[essenceKey] = (this.essences[essenceKey] || 0) + 1;
    }

    return { ok: true, dust: preview.dust, essence: essenceKey };
  }

  runeEffect(runeKey) {
    return RUNE_RECIPES[runeKey]?.effect || null;
  }

  listRuneRecipes() {
    const seen = new Set();
    const list = [];
    const lvl = this.getFacilityLevel('enchanter');
    for (const r of Object.values(RUNE_RECIPES)) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      list.push({
        ...r,
        unlocked: lvl >= (r.minLevel || 1),
        goldCost: this.getRuneGoldCost(r)
      });
    }
    list.sort((a, b) => (a.minLevel || 1) - (b.minLevel || 1) || a.name.localeCompare(b.name));
    return list;
  }

  getRuneGoldCost(recipe) {
    const list = recipe.goldCost || 0;
    const mage = this.getAssignedHeroes('enchanter')[0];
    let int = 10;
    if (mage) {
      const hero = this.findHeroRecord(mage);
      int = hero?.stats?.int || hero?.stats?.INT || 10;
    }
    const intMod = Math.max(0, Math.floor((int - 10) / 2));
    return Math.max(Math.ceil(list * 0.5), list - 10 * intMod);
  }

  craftRune(runeKey) {
    if (!this.isUnlocked('enchanter')) return { ok: false, reason: 'Enchanter is locked.' };
    const recipe = RUNE_RECIPES[runeKey];
    if (!recipe) return { ok: false, reason: 'Invalid rune recipe.' };
    const minLevel = recipe.minLevel || 1;
    if (this.getFacilityLevel('enchanter') < minLevel) {
      return { ok: false, reason: `Requires Enchanter level ${minLevel}.` };
    }

    const goldCost = this.getRuneGoldCost(recipe);
    if (this.game.gold < goldCost) return { ok: false, reason: 'Not enough gold.' };
    if ((this.essences.dust || 0) < recipe.dustCost) return { ok: false, reason: 'Not enough Arcane Dust.' };
    if ((this.essences[recipe.essenceKey] || 0) < recipe.essenceCost) return { ok: false, reason: `Not enough ${recipe.essenceKey} essence.` };

    this.game.gold -= goldCost;
    this.essences.dust -= recipe.dustCost;
    this.essences[recipe.essenceKey] -= recipe.essenceCost;

    const runeItem = makeRuneItem(recipe);
    if (!this.game.inventory) this.game.inventory = [];
    addToInventory(this.game.inventory, runeItem);
    return { ok: true, rune: runeItem };
  }

  applyRuneToItem(item, runeRef) {
    if (!this.isUnlocked('enchanter')) return { ok: false, reason: 'Enchanter is locked.' };
    if (!item) return { ok: false, reason: 'No item selected.' };
    if (!canInscribeRune(item)) {
      return { ok: false, reason: 'That piece cannot take another rune (Ancient or Fabled).' };
    }
    const inv = this.game.inventory || [];
    let runeItem = null;
    if (typeof runeRef === 'string') {
      runeItem = inv.find(i => i && isRune(i) && (i.id === runeRef || i.runeKey === runeRef)) || null;
    } else if (isRune(runeRef)) {
      runeItem = runeRef;
    }
    if (!runeItem || !inv.includes(runeItem)) {
      return { ok: false, reason: 'Rune not in inventory.' };
    }
    if (!runeFitsItem(runeItem, item)) {
      const t = runeItem.runeSlotType;
      const want = t === 'weapon' ? 'a weapon'
        : t === 'worn' ? 'worn gear'
        : 'armor, a helm, gloves, boots, or a shield';
      return { ok: false, reason: `This rune can only be inscribed on ${want}.` };
    }

    const spent = takeFromInventory(inv, runeItem, 1);
    if (!spent) return { ok: false, reason: 'Rune not in inventory.' };

    const entry = {
      runeKey: spent.runeKey,
      name: spent.name,
      icon: spent.icon,
      slotType: spent.runeSlotType,
      desc: spent.desc,
      effect: spent.effect || this.runeEffect(spent.runeKey)
    };
    const existing = itemRunes(item);
    item.inscribedRunes = existing.concat([entry]);
    delete item.inscribedRune;
    promoteItemRarity(item);
    return { ok: true };
  }

  /* ── War Room Doctrines & Orders ───────────────────────────────────── */
  setSlayingOrder(orderId) {
    if (!this.isUnlocked('war_room')) return false;
    if (!SLAYING_ORDERS[orderId]) return false;
    this.activeSlayingOrder = orderId;
    return true;
  }

  setBattleDoctrine(doctrineId) {
    if (!this.isUnlocked('war_room')) return false;
    if (!BATTLE_DOCTRINES[doctrineId]) return false;
    this.activeDoctrine = doctrineId;
    return true;
  }

  /* ── Blacksmith Crafting & Salvage ─────────────────────────────────── */
  getMaxCraftablePS() {
    if (!this.isUnlocked('blacksmith')) return 0;
    const lvl = this.getFacilityLevel('blacksmith');
    return 15 + lvl * 20; // Lvl 1: 35, Lvl 2: 55, Lvl 3: 75, Lvl 5: 115, Lvl 10: 215
  }

  getAssignedBlacksmithBonus() {
    const assignedNames = this.getAssignedHeroes('blacksmith');
    if (assignedNames.length === 0) return { bonusPS: 0, heroName: null };
    const heroName = assignedNames[0];
    const heroObj = (this.game.storedHeroes || []).find(h => h.name === heroName) ||
                    (this.game.heroes || []).map(h => h.data).find(h => h && h.name === heroName);
    if (!heroObj) return { bonusPS: 0, heroName: null };

    // Bonus based on Hero STR/INT and hero level
    const statVal = Math.max(heroObj.stats?.str || 10, heroObj.stats?.int || 10, heroObj.stats?.STR || 10);
    const statMod = Math.max(0, Math.floor((statVal - 10) / 2));
    const bonusPS = Math.round(statMod * 2 + (heroObj.level || 1) * 1.5);
    return { bonusPS, heroName, statVal, heroLevel: heroObj.level || 1 };
  }

  /** Bases the forge can pin for a craft category (`weapon` = melee, etc.). */
  listCraftBases(slot) {
    const kind = slot === 'weapon' ? 'melee' : (CRAFT_WEAPON_KINDS[slot] || null);
    const rollSlot = kind ? 'weapon' : slot;
    const list = BASES[rollSlot] || [];
    const filtered = kind ? list.filter(b => weaponKindOf(b) === kind) : list;
    return filtered.map(b => ({
      name: b.name,
      icon: b.icon,
      slot: rollSlot,
      kind: kind || weaponKindOf(b),
      dmg: b.dmg || null,
      twoHanded: !!b.twoHanded,
      prof: b.prof || null
    }));
  }

  getCraftingCosts(slot, targetPS) {
    const discount = this.getEquipmentDiscountPercent();
    const ps = Math.max(10, targetPS || 20);
    /* bows, slings and wands are wood and leather, not iron */
    const isMetal = slot === 'weapon' || slot === 'armor' || slot === 'shield' || slot === 'helm';

    const goldCost = Math.max(50, Math.floor(ps * 15 * (1 - discount)));
    const ironCost = isMetal ? Math.max(2, Math.floor(ps / 5)) : Math.max(1, Math.floor(ps / 12));
    const leatherCost = !isMetal ? Math.max(2, Math.floor(ps / 5)) : Math.max(1, Math.floor(ps / 12));

    return { goldCost, ironCost, leatherCost, isMetal };
  }

  craftEquipment(slot, targetPS, baseKey = null) {
    if (!this.isUnlocked('blacksmith')) return { ok: false, reason: 'Blacksmith is locked.' };
    const maxPS = this.getMaxCraftablePS();
    if (targetPS > maxPS) return { ok: false, reason: `Target PS ${targetPS} exceeds Blacksmith limit (${maxPS}). Upgrade Blacksmith to forge higher tiers.` };

    const costs = this.getCraftingCosts(slot, targetPS);
    if (this.game.gold < costs.goldCost) return { ok: false, reason: `Not enough gold! (Need 🪙${costs.goldCost}g)` };
    if ((this.materials.iron || 0) < costs.ironCost) return { ok: false, reason: `Not enough Iron Ingots! (Need 🔩${costs.ironCost})` };
    if ((this.materials.leather || 0) < costs.leatherCost) return { ok: false, reason: `Not enough Hardened Leather! (Need 🪵${costs.leatherCost})` };

    const catalog = this.listCraftBases(slot);
    if (baseKey && !catalog.some(b => b.name === baseKey)) {
      return { ok: false, reason: `${baseKey} is not in this forge category.` };
    }

    // Deduct costs
    this.game.gold -= costs.goldCost;
    this.materials.iron -= costs.ironCost;
    this.materials.leather -= costs.leatherCost;

    // Calculate effective item tier (tier maps to item power level)
    const baseTier = Math.max(1, Math.round(targetPS / 14));
    const smithBonus = this.getAssignedBlacksmithBonus();
    const bonusTier = Math.max(0, Math.round(smithBonus.bonusPS / 12));
    const effectiveTier = baseTier + bonusTier;

    // Roll the crafted item
    const weaponKind = slot === 'weapon' ? 'melee' : (CRAFT_WEAPON_KINDS[slot] || null);
    const rollSlot = weaponKind ? 'weapon' : slot;
    const rolled = rollItem(effectiveTier, Math.random, rollSlot, {
      source: 'boss', luck: 1.5, weaponKind, baseKey: baseKey || undefined
    });
    if (!rolled) {
      return { ok: false, reason: 'Crafting failed to generate an item.' };
    }

    const finalPS = itemPoints(rolled);
    rolled.craftedBy = smithBonus.heroName || 'Master Blacksmith';

    // Add to player inventory
    this.game.inventory = this.game.inventory || [];
    addToInventory(this.game.inventory, rolled);

    return {
      ok: true,
      item: rolled,
      finalPS,
      bonusPS: smithBonus.bonusPS,
      heroName: smithBonus.heroName,
      costs
    };
  }

  salvageItem(item) {
    if (!this.isUnlocked('blacksmith')) return { ok: false, reason: 'Blacksmith is locked.' };
    if (!item) return { ok: false, reason: 'No item selected.' };
    if (item.locked) return { ok: false, reason: 'Cannot salvage a locked item.' };
    if (!isSalvageable(item)) return { ok: false, reason: 'Only weapons, armor and accessories can be salvaged.' };

    const inv = this.game.inventory || [];
    const idx = inv.indexOf(item);
    if (idx < 0) return { ok: false, reason: 'Item not in inventory.' };
    inv.splice(idx, 1);

    const isMetal = item.slot === 'weapon' || item.slot === 'armor' || item.slot === 'shield' || item.slot === 'helm';
    const ironYield = isMetal ? 3 + Math.floor(Math.random() * 3) : 1;
    const leatherYield = !isMetal ? 3 + Math.floor(Math.random() * 3) : 1;

    this.materials.iron = (this.materials.iron || 0) + ironYield;
    this.materials.leather = (this.materials.leather || 0) + leatherYield;

    return { ok: true, iron: ironYield, leather: leatherYield };
  }

  salvageByPowerScore(maxPS) {
    if (!this.isUnlocked('blacksmith')) return { ok: false, reason: 'Blacksmith is locked.' };
    const inv = this.game.inventory || [];
    const threshold = Math.max(0, maxPS | 0);

    let totalIron = 0;
    let totalLeather = 0;
    let salvagedCount = 0;

    // Filter items to salvage: weapons/armor/accessories only, not locked, and itemPoints(item) <= threshold
    const toSalvage = [];
    for (let i = 0; i < inv.length; i++) {
      const item = inv[i];
      if (!isSalvageable(item) || item.locked) continue;
      const ps = typeof itemPoints === 'function' ? itemPoints(item) : 0;
      if (ps <= threshold) {
        toSalvage.push(item);
      }
    }

    if (toSalvage.length === 0) {
      return { ok: false, reason: `No unlocked gear found with PS ≤ ${threshold}.`, count: 0, iron: 0, leather: 0 };
    }

    for (const item of toSalvage) {
      const idx = inv.indexOf(item);
      if (idx >= 0) {
        inv.splice(idx, 1);
        const isMetal = item.slot === 'weapon' || item.slot === 'armor' || item.slot === 'shield' || item.slot === 'helm';
        const ironYield = isMetal ? 3 + Math.floor(Math.random() * 3) : 1;
        const leatherYield = !isMetal ? 3 + Math.floor(Math.random() * 3) : 1;

        totalIron += ironYield;
        totalLeather += leatherYield;
        salvagedCount++;
      }
    }

    this.materials.iron = (this.materials.iron || 0) + totalIron;
    this.materials.leather = (this.materials.leather || 0) + totalLeather;

    return {
      ok: true,
      count: salvagedCount,
      iron: totalIron,
      leather: totalLeather,
      threshold
    };
  }

  /* ── Dungeon Floor Progression Hook ────────────────────────────────── */
  onFloorCleared() {
    // 1. Apothecary still
    if (this.isUnlocked('apothecary')) {
      this.tickApothecaryStill();
    }

    // 2. Training Grounds stations
    if (this.isUnlocked('training_grounds')) {
      this.tickTrainingStations();
    }

    // 3. Cartographer Expeditions Progress
    if (this.activeExpeditions && this.activeExpeditions.length > 0) {
      for (const exp of this.activeExpeditions) {
        if (exp.floorsRemaining > 0) {
          exp.floorsRemaining -= 1;
          if (exp.floorsRemaining <= 0) {
            exp.completed = true;
            if (typeof window !== 'undefined' && window.log) {
              window.log(`🗺️ Expedition Completed: "${exp.name}" has returned! Claim your rewards at the Cartographer.`, 'treasure');
            }
          }
        }
      }
    }

    // 4. Academy Scholar Tome Generation (Level >= 3)
    if (this.isUnlocked('academy') && this.getFacilityLevel('academy') >= 3) {
      const assigned = this.getAssignedHeroes('academy')[0];
      if (assigned && Math.random() < 0.20) {
        this.tomes = (this.tomes || 0) + 1;
        if (typeof window !== 'undefined' && window.log) {
          window.log(`📜 Scholar ${assigned} deciphered an ancient Knowledge Tome for the Academy!`, 'sys');
        }
      }
    }
  }

  dispatchDungeonXp(_totalXpGained) {
    /* Catch-up drip retired — the yard trains ability scores on stations. */
  }

  getGlobalHpBonusPercent() {
    return this.getTechBonus('hpBonus');
  }

  getGlobalXpBonusPercent() {
    let total = 0;
    if (this.isUnlocked('academy')) total += this.getFacilityLevel('academy') * 0.02;
    return total;
  }

  getEquipmentDiscountPercent() {
    let total = 0;
    if (this.isUnlocked('blacksmith')) total += this.getFacilityLevel('blacksmith') * 0.03;
    total += this.getTechBonus('shopDiscount');
    return total;
  }

  findHeroRecord(name) {
    return (this.game.storedHeroes || []).find(h => h.name === name) ||
           (this.game.heroes || []).map(h => h.data).find(h => h && h.name === name) ||
           null;
  }

  buyTrainingGear(key) {
    if (!this.isUnlocked('training_grounds')) return { ok: false, reason: 'Training Grounds are locked.' };
    const def = TRAINING_GEAR[key];
    if (!def) return { ok: false, reason: 'Unknown equipment.' };
    if ((this.trainingStations || []).length >= TRAINING_MAX_STATIONS) {
      return { ok: false, reason: `The yard is full (${TRAINING_MAX_STATIONS} pieces).` };
    }
    if ((this.game.gold || 0) < def.cost) {
      return { ok: false, reason: `Not enough gold! (Need 🪙${def.cost}g)` };
    }
    this.game.gold -= def.cost;
    const id = `tg_${this._stationSeq++}`;
    this.trainingStations.push({ id, key, level: 1 });
    this.stationProgress[id] = 0;
    return { ok: true, id };
  }

  upgradeTrainingGear(stationId) {
    const st = (this.trainingStations || []).find(s => s.id === stationId);
    if (!st) return { ok: false, reason: 'No such equipment.' };
    const def = TRAINING_GEAR[st.key];
    if (!def) return { ok: false, reason: 'Unknown equipment.' };
    if ((st.level || 1) >= TRAINING_GEAR_MAX_LEVEL) return { ok: false, reason: 'Already masterwork.' };
    const cost = def.upgradeCost * (st.level || 1);
    if ((this.game.gold || 0) < cost) {
      return { ok: false, reason: `Not enough gold! (Need 🪙${cost}g)` };
    }
    this.game.gold -= cost;
    st.level = (st.level || 1) + 1;
    return { ok: true, level: st.level };
  }

  assignToStation(stationId, heroName) {
    if (!this.isUnlocked('training_grounds')) return { ok: false, reason: 'Training Grounds are locked.' };
    const st = (this.trainingStations || []).find(s => s.id === stationId);
    if (!st) return { ok: false, reason: 'No such equipment.' };
    if (!heroName) {
      const prev = this.stationAssignments[stationId];
      delete this.stationAssignments[stationId];
      if (prev && !Object.values(this.stationAssignments).includes(prev)) {
        if (this.heroAssignments[prev] === 'training_grounds') delete this.heroAssignments[prev];
      }
      return { ok: true };
    }
    const hero = this.findHeroRecord(heroName);
    if (!hero) return { ok: false, reason: 'No such hero.' };
    this._clearHeroStations(heroName);
    this.stationAssignments[stationId] = heroName;
    this.heroAssignments[heroName] = 'training_grounds';
    this.stationProgress[stationId] = this.stationProgress[stationId] || 0;
    return { ok: true };
  }

  tickTrainingStations() {
    const results = [];
    for (const st of this.trainingStations || []) {
      const name = this.stationAssignments[st.id];
      if (!name) continue;
      const hero = this.findHeroRecord(name);
      if (!hero) continue;
      const def = TRAINING_GEAR[st.key];
      if (!def) continue;
      if (!hero.stats) hero.stats = {};
      const stat = def.stat;
      const cur = hero.stats[stat] || 10;
      if (cur >= TRAINING_STAT_CAP) continue;

      this.stationProgress[st.id] = (this.stationProgress[st.id] || 0) + 1;
      const needed = trainingFloorsForGain(cur, st.level || 1);
      if (this.stationProgress[st.id] < needed) continue;
      this.stationProgress[st.id] -= needed;
      hero.stats[stat] = cur + 1;
      if (hero.classKey && typeof recalc === 'function') recalc(hero);
      results.push({ name, stat, value: hero.stats[stat], gear: def.name });
      if (typeof window !== 'undefined' && window.log) {
        window.log(`⚔️ ${name}'s ${stat.toUpperCase()} rose to ${hero.stats[stat]} at the ${def.name}.`, 'level');
      }
    }
    return results;
  }

  applyTrainingBuffsOnEmbark(heroes) {
    for (const wrap of heroes || []) {
      const h = wrap?.data || wrap;
      if (!h?.drillBuff) continue;
      h.drillBuff.active = true;
      h.drillBuff.ready = false;
      if (h.drillBuff.tempHp) {
        h.tempHp = Math.max(h.tempHp || 0, h.drillBuff.tempHp);
      }
      if (h.classKey && typeof recalc === 'function') recalc(h);
    }
  }

  consumeTrainingBuffs(heroes) {
    for (const wrap of heroes || []) {
      const h = wrap?.data || wrap;
      if (!h?.drillBuff?.active) continue;
      delete h.drillBuff;
      if (h.classKey && typeof recalc === 'function') recalc(h);
    }
  }

  getPotionDiscountPercent() {
    if (!this.isUnlocked('apothecary')) return 0;
    return this.getFacilityLevel('apothecary') * 0.04;
  }

  /* ── Apothecary still ──────────────────────────────────────────────── */
  getAssignedAlchemist() {
    const name = this.getAssignedHeroes('apothecary')[0];
    if (!name) return null;
    const hero = (this.game.storedHeroes || []).find(h => h.name === name) ||
                 (this.game.heroes || []).map(h => h.data).find(h => h && h.name === name);
    const int = hero?.stats?.int || hero?.stats?.INT || 10;
    return { name, int, hero };
  }

  getStillPreview(baseKey = this.apothecaryRecipe) {
    const base = (BASES.trinket || []).find(b => b.name === baseKey);
    const alch = this.getAssignedAlchemist();
    const apLvl = this.getFacilityLevel('apothecary');
    const heroInt = alch?.int || 10;
    return {
      base,
      baseKey: baseKey || 'Potion of Healing',
      duration: getBrewDuration(base, apLvl, heroInt),
      quantity: getBrewQuantity(base, apLvl, heroInt),
      floors: this.apothecaryFloors || 0,
      alchemist: alch
    };
  }

  listBrewRecipes() {
    const lvl = this.getFacilityLevel('apothecary');
    const alch = this.getAssignedAlchemist();
    const heroInt = alch?.int || 10;
    const list = (BASES.trinket || []).filter(isBrewablePotion);
    return list.map(b => {
      const minLevel = brewUnlockLevel(b);
      return {
        baseKey: b.name,
        name: b.name,
        icon: b.icon,
        rarity: b.rarity || 'common',
        minLevel,
        unlocked: lvl >= minLevel,
        selected: (this.apothecaryRecipe || 'Potion of Healing') === b.name,
        duration: getBrewDuration(b, lvl, heroInt),
        quantity: getBrewQuantity(b, lvl, heroInt),
        potionPool: b.potionPool || null,
        buffKey: b.buffKey || null,
        cures: b.cures || null
      };
    }).sort((a, b) => a.minLevel - b.minLevel || a.name.localeCompare(b.name));
  }

  setBrewRecipe(baseKey) {
    if (!this.isUnlocked('apothecary')) return { ok: false, reason: 'Apothecary is locked.' };
    const rec = this.listBrewRecipes().find(r => r.baseKey === baseKey);
    if (!rec) return { ok: false, reason: 'Unknown recipe.' };
    if (!rec.unlocked) {
      return { ok: false, reason: `Requires Apothecary level ${rec.minLevel}.` };
    }
    if (this.apothecaryRecipe === baseKey) return { ok: true, unchanged: true };
    this.apothecaryRecipe = baseKey;
    this.apothecaryFloors = 0;
    return { ok: true };
  }

  tickApothecaryStill() {
    const alch = this.getAssignedAlchemist();
    if (!alch) return null;
    const key = this.apothecaryRecipe || 'Potion of Healing';
    const base = (BASES.trinket || []).find(b => b.name === key);
    if (!base || !isBrewablePotion(base)) return null;
    if (brewUnlockLevel(base) > this.getFacilityLevel('apothecary')) return null;

    this.apothecaryFloors = (this.apothecaryFloors || 0) + 1;
    const apLvl = this.getFacilityLevel('apothecary');
    const needed = getBrewDuration(base, apLvl, alch.int);
    if (this.apothecaryFloors < needed) return null;

    this.apothecaryFloors -= needed;
    const qty = getBrewQuantity(base, apLvl, alch.int);
    if (!this.game.inventory) this.game.inventory = [];
    let lastItem = null;
    for (let i = 0; i < qty; i++) {
      const item = makeConsumableFromBase(base, apLvl);
      if (!item) continue;
      lastItem = addToInventory(this.game.inventory, item, this.game);
    }
    if (typeof window !== 'undefined' && window.log) {
      window.log(`🧪 ${alch.name} brewed ${qty}× ${base.name} at the Apothecary!`, 'item');
    }
    return { quantity: qty, name: base.name, item: lastItem };
  }
}

