/**
 * Guild Manager & Facilities System
 * Handles guild structure upgrades, facility levels, hero assignments, idle mechanics,
 * expeditions, research, runecrafting, and tactical war preparations.
 */

import { grantXp, XP_TABLE } from './srd.js';
import { rollItem, itemPoints, addToInventory } from './items.js';

/* Forge categories that are really the weapon slot narrowed to a kind, so a
   ranger who sold their only bow can always make another one. */
const CRAFT_WEAPON_KINDS = { ranged: 'ranged', focus: 'focus' };

/** Armory storage slots granted per facility level (level 10 → 120 slots). */
export const ARMORY_SLOTS_PER_LEVEL = 12;

export const FACILITY_DEFINITIONS = {
  living_quarters: {
    id: 'living_quarters',
    name: 'Living Quarters',
    icon: '🏰',
    description: 'Expands stored hero capacity and provides Well-Rested morale bonuses.',
    baseCost: 200,
    costMultiplier: 1.8,
    maxLevel: 10,
    getEffectText: (lvl) => `Max Stored Heroes: ${6 + lvl * 2} · Rested XP Bonus: +${lvl * 2}%`
  },
  armory: {
    id: 'armory',
    name: 'The Armory',
    icon: '🗄️',
    description: 'Store gear the party isn\'t carrying. Stored items survive every delve.',
    baseCost: 250,
    costMultiplier: 1.7,
    maxLevel: 10,
    getEffectText: (lvl) => `Storage Slots: ${lvl * ARMORY_SLOTS_PER_LEVEL}`
  },
  training_grounds: {
    id: 'training_grounds',
    name: 'Training Grounds',
    icon: '⚔️',
    description: 'Assigned idle heroes passively train to catch up to the active party level.',
    baseCost: 350,
    costMultiplier: 2.0,
    maxLevel: 10,
    getEffectText: (lvl) => `Catch-up XP Rate: ${5 + lvl}% of dungeon XP (Capped at Party Level)`
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
    getEffectText: (lvl) => `Brewing Discount: ${lvl * 4}% · Auto-Brew Yield: ${Math.min(5, 2 + Math.floor(lvl * 0.3))} potions/10 fl`
  },
  infirmary: {
    id: 'infirmary',
    name: 'The Infirmary',
    icon: '🩺',
    description: 'Treat injured heroes returning from dungeon wipes or trauma.',
    baseCost: 400,
    costMultiplier: 2.0,
    maxLevel: 10,
    getEffectText: (lvl) => `Recovery Speed: +${lvl * 15}% · Miracle Salve Discount: ${lvl * 5}%`
  },
  crypt: {
    id: 'crypt',
    name: 'The Crypt',
    icon: '🪦',
    description: 'Memorialize fallen heroes and attune to powerful Ancestral Relics.',
    baseCost: 600,
    costMultiplier: 2.5,
    maxLevel: 10,
    getEffectText: (lvl) => `Global Roster Max HP: +${lvl * 2}% · Soul Token Discount: ${lvl * 6}%`
  },
  enchanter: {
    id: 'enchanter',
    name: 'Enchanter\'s Spire',
    icon: '🔮',
    description: 'Disenchant magical items into Essences and inscribe Runes onto gear.',
    baseCost: 800,
    costMultiplier: 2.4,
    maxLevel: 10,
    getEffectText: (lvl) => `Runic Power: +${lvl * 5}% · Disenchant Dust Yield: +${lvl * 10}%`
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

export const INJURY_TYPES = {
  fractured_rib: { id: 'fractured_rib', name: 'Fractured Rib', penaltyText: '-1 CON', baseFloors: 10, healCost: 120 },
  severed_tendon: { id: 'severed_tendon', name: 'Severed Tendon', penaltyText: '-2 DEX', baseFloors: 12, healCost: 150 },
  concussion: { id: 'concussion', name: 'Brain Concussion', penaltyText: '-2 INT', baseFloors: 10, healCost: 140 },
  gash_wound: { id: 'gash_wound', name: 'Deep Gash Wound', penaltyText: '-10% Max HP', baseFloors: 8, healCost: 100 }
};

export const ANCESTRAL_RELICS = {
  tomb_guard: { id: 'tomb_guard', name: 'Tomb of the Iron Guard', statBonus: '+10% Armor Defense', key: 'armorBonus', val: 0.10 },
  tomb_shadow: { id: 'tomb_shadow', name: 'Tomb of the Shadow', statBonus: '+8% Evasion / Dodge', key: 'dodgeBonus', val: 0.08 },
  tomb_warlock: { id: 'tomb_warlock', name: 'Tomb of the Spellweaver', statBonus: '+12% Arcane Damage', key: 'spellBonus', val: 0.12 },
  tomb_slayer: { id: 'tomb_slayer', name: 'Tomb of the Slayer', statBonus: '+10% Critical Strike Chance', key: 'critBonus', val: 0.10 }
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

/* ── Enchanter Runes ─────────────────────────────────────────────────── */
export const RUNE_RECIPES = {
  rune_flame: {
    id: 'rune_flame', name: 'Rune of Searing Flame', slotType: 'weapon', icon: '🔥',
    desc: '+1d6 Bonus Fire Damage on hit', dustCost: 6, essenceKey: 'fire', essenceCost: 2, goldCost: 150
  },
  rune_frost: {
    id: 'rune_frost', name: 'Rune of Bitter Frost', slotType: 'weapon', icon: '❄️',
    desc: '+1d4 Cold Damage & 20% Chance to slow targets on hit', dustCost: 6, essenceKey: 'frost', essenceCost: 2, goldCost: 150
  },
  rune_thunder: {
    id: 'rune_thunder', name: 'Rune of Crackling Thunder', slotType: 'weapon', icon: '⚡',
    desc: '+1d6 Lightning Damage & 10% Chance to stun on hit', dustCost: 6, essenceKey: 'lightning', essenceCost: 2, goldCost: 150
  },
  rune_vampire: {
    id: 'rune_vampire', name: 'Rune of the Bloodfeeder', slotType: 'weapon', icon: '🩸',
    desc: '+6% Lifesteal on physical attacks', dustCost: 10, essenceKey: 'shadow', essenceCost: 3, goldCost: 250
  },
  rune_titan: {
    id: 'rune_titan', name: 'Rune of the Colossus', slotType: 'armor', icon: '🗿',
    desc: '+25 Maximum HP when equipped', dustCost: 8, essenceKey: 'radiant', essenceCost: 2, goldCost: 200
  },
  rune_warding: {
    id: 'rune_warding', name: 'Rune of the Aegis Ward', slotType: 'armor', icon: '🛡️',
    desc: '+2 Armor Class & +10% Resistance to magical damage', dustCost: 10, essenceKey: 'radiant', essenceCost: 3, goldCost: 250
  }
};

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

export function getApothecaryBrewOutput(apothecaryLevel, heroInt, floors = 10) {
  const lvlRatio = Math.min(1.0, Math.max(0.1, apothecaryLevel / 10));
  const intRatio = Math.min(1.0, Math.max(0.5, heroInt / 20));
  const powerScore = (lvlRatio * 0.5) + (intRatio * 0.5);

  const quantityPer10 = Math.max(2, Math.min(5, Math.round(2 + ((powerScore - 0.30) / 0.70) * 3)));
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
    this.infirmaryTreatments = {}; // { heroName: { injuryId, floorsRemaining } }
    this.consecratedTombs = []; // [{ heroName, classKey, relicId }]
    this.activeAncestralRelic = 'tomb_guard';
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
      infirmaryTreatments: { ...this.infirmaryTreatments },
      consecratedTombs: [ ...this.consecratedTombs ],
      activeAncestralRelic: this.activeAncestralRelic || 'tomb_guard',
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
    }
    if (data.heroAssignments) {
      this.heroAssignments = { ...data.heroAssignments };
    }
    if (typeof data.apothecaryFloors === 'number') {
      this.apothecaryFloors = data.apothecaryFloors;
    }
    if (data.infirmaryTreatments) {
      this.infirmaryTreatments = { ...data.infirmaryTreatments };
    }
    if (data.consecratedTombs) {
      this.consecratedTombs = [ ...data.consecratedTombs ];
    }
    if (data.activeAncestralRelic) {
      this.activeAncestralRelic = data.activeAncestralRelic;
    }
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
    if (Array.isArray(data.craftedRunes)) {
      this.craftedRunes = [ ...data.craftedRunes ];
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
      return true;
    }
    if (!this.isUnlocked(facilityId)) return false;
    this.heroAssignments[heroNameOrId] = facilityId;
    return true;
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
  disenchantItem(item) {
    if (!this.isUnlocked('enchanter')) return { ok: false, reason: 'Enchanter is locked.' };
    if (!item) return { ok: false, reason: 'No item selected.' };

    const inv = this.game.inventory || [];
    const idx = inv.indexOf(item);
    if (idx < 0) return { ok: false, reason: 'Item not in inventory.' };

    inv.splice(idx, 1);

    const rarity = item.rarity || 'common';
    let dustGain = 3;
    let essenceKey = null;

    if (rarity === 'uncommon') dustGain = 6;
    else if (rarity === 'rare') { dustGain = 12; essenceKey = ['fire', 'frost', 'lightning'][Math.floor(Math.random() * 3)]; }
    else if (rarity === 'epic') { dustGain = 24; essenceKey = ['shadow', 'radiant', 'fire', 'frost'][Math.floor(Math.random() * 4)]; }
    else if (rarity === 'legendary') { dustGain = 50; essenceKey = ['shadow', 'radiant'][Math.floor(Math.random() * 2)]; }

    const enchLvl = this.getFacilityLevel('enchanter');
    dustGain = Math.round(dustGain * (1 + enchLvl * 0.10));

    this.essences.dust = (this.essences.dust || 0) + dustGain;
    if (essenceKey) {
      this.essences[essenceKey] = (this.essences[essenceKey] || 0) + 1;
    }

    return { ok: true, dust: dustGain, essence: essenceKey };
  }

  craftRune(runeKey) {
    if (!this.isUnlocked('enchanter')) return { ok: false, reason: 'Enchanter is locked.' };
    const recipe = RUNE_RECIPES[runeKey];
    if (!recipe) return { ok: false, reason: 'Invalid rune recipe.' };

    if (this.game.gold < recipe.goldCost) return { ok: false, reason: 'Not enough gold.' };
    if ((this.essences.dust || 0) < recipe.dustCost) return { ok: false, reason: 'Not enough Arcane Dust.' };
    if ((this.essences[recipe.essenceKey] || 0) < recipe.essenceCost) return { ok: false, reason: `Not enough ${recipe.essenceKey} essence.` };

    this.game.gold -= recipe.goldCost;
    this.essences.dust -= recipe.dustCost;
    this.essences[recipe.essenceKey] -= recipe.essenceCost;

    const runeObj = {
      id: `${runeKey}_${Date.now()}`,
      runeKey,
      name: recipe.name,
      icon: recipe.icon,
      slotType: recipe.slotType,
      desc: recipe.desc
    };
    this.craftedRunes.push(runeObj);
    return { ok: true, rune: runeObj };
  }

  applyRuneToItem(item, runeId) {
    if (!this.isUnlocked('enchanter')) return { ok: false, reason: 'Enchanter is locked.' };
    const rIdx = this.craftedRunes.findIndex(r => r.id === runeId);
    if (rIdx < 0) return { ok: false, reason: 'Rune not in inventory.' };
    const rune = this.craftedRunes[rIdx];

    const isWeapon = item.slot === 'weapon' || item.kind === 'weapon';
    const isArmor = ['armor', 'shield', 'head', 'boots', 'glove'].includes(item.slot);

    if (rune.slotType === 'weapon' && !isWeapon) {
      return { ok: false, reason: 'This rune can only be inscribed on weapons.' };
    }
    if (rune.slotType === 'armor' && !isArmor) {
      return { ok: false, reason: 'This rune can only be inscribed on armor/shields.' };
    }

    item.inscribedRune = { ...rune };
    this.craftedRunes.splice(rIdx, 1);
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

  craftEquipment(slot, targetPS) {
    if (!this.isUnlocked('blacksmith')) return { ok: false, reason: 'Blacksmith is locked.' };
    const maxPS = this.getMaxCraftablePS();
    if (targetPS > maxPS) return { ok: false, reason: `Target PS ${targetPS} exceeds Blacksmith limit (${maxPS}). Upgrade Blacksmith to forge higher tiers.` };

    const costs = this.getCraftingCosts(slot, targetPS);
    if (this.game.gold < costs.goldCost) return { ok: false, reason: `Not enough gold! (Need 🪙${costs.goldCost}g)` };
    if ((this.materials.iron || 0) < costs.ironCost) return { ok: false, reason: `Not enough Iron Ingots! (Need 🔩${costs.ironCost})` };
    if ((this.materials.leather || 0) < costs.leatherCost) return { ok: false, reason: `Not enough Hardened Leather! (Need 🪵${costs.leatherCost})` };

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
    const weaponKind = CRAFT_WEAPON_KINDS[slot] || null;
    const rollSlot = weaponKind ? 'weapon' : slot;
    const rolled = rollItem(effectiveTier, Math.random, rollSlot, { source: 'boss', luck: 1.5, weaponKind });
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

    // Filter items to salvage: must have slot, not potion/dye, not locked, and itemPoints(item) <= threshold
    const toSalvage = [];
    for (let i = 0; i < inv.length; i++) {
      const item = inv[i];
      if (!item || !item.slot || item.kind === 'potion' || item.kind === 'dye' || item.locked) continue;
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
    // 1. Apothecary auto-brewing
    if (this.isUnlocked('apothecary')) {
      const assignedNames = this.getAssignedHeroes('apothecary');
      if (assignedNames.length > 0) {
        this.apothecaryFloors = (this.apothecaryFloors || 0) + 1;
        if (this.apothecaryFloors >= 10) {
          const heroName = assignedNames[0];
          const heroObj = (this.game.storedHeroes || []).find(h => h.name === heroName) ||
                          (this.game.heroes || []).map(h => h.data).find(h => h.name === heroName);

          const heroInt = heroObj?.stats?.int || heroObj?.stats?.INT || 10;
          const apLvl = this.getFacilityLevel('apothecary');
          const brew = getApothecaryBrewOutput(apLvl, heroInt, 10);

          this.game.potions[brew.potionTier] = (this.game.potions[brew.potionTier] || 0) + brew.quantity;
          this.apothecaryFloors -= 10;

          if (typeof window !== 'undefined' && window.log) {
            window.log(`🧪 ${heroName} brewed ${brew.quantity}x ${brew.tierLabel} at the Apothecary!`, 'item');
          }
        }
      }
    }

    // 2. Infirmary recovery beds
    if (this.isUnlocked('infirmary') && this.infirmaryTreatments) {
      for (const [heroName, tData] of Object.entries(this.infirmaryTreatments)) {
        if (!tData || tData.floorsRemaining <= 0) continue;
        tData.floorsRemaining -= 1;
        if (tData.floorsRemaining <= 0) {
          delete this.infirmaryTreatments[heroName];
          const heroObj = (this.game.storedHeroes || []).find(h => h.name === heroName) ||
                          (this.game.heroes || []).map(h => h.data).find(h => h.name === heroName);
          if (heroObj && heroObj.injuries) {
            heroObj.injuries = heroObj.injuries.filter(i => i.id !== tData.injuryId);
          }
          if (typeof window !== 'undefined' && window.log) {
            window.log(`🩺 ${heroName} has fully recovered from their injury at the Infirmary!`, 'gold');
          }
        }
      }
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

  assignInfirmaryBed(heroName, injuryId) {
    if (!this.isUnlocked('infirmary')) return false;
    const def = INJURY_TYPES[injuryId];
    if (!def) return false;
    const infLvl = this.getFacilityLevel('infirmary');
    const chirurgeonHeroName = this.getAssignedHeroes('infirmary')[0];
    let wisBonus = 0;
    if (chirurgeonHeroName) {
      const cHero = (this.game.storedHeroes || []).find(h => h.name === chirurgeonHeroName);
      wisBonus = Math.floor(((cHero?.stats?.wis || 10) - 10) / 2);
    }
    const floorsNeeded = Math.max(3, def.baseFloors - Math.floor(infLvl * 0.8) - wisBonus);
    this.infirmaryTreatments[heroName] = { injuryId, floorsRemaining: floorsNeeded };
    return true;
  }

  cureWithMiracleSalve(heroName, injuryId) {
    const def = INJURY_TYPES[injuryId];
    if (!def) return false;
    const infLvl = this.getFacilityLevel('infirmary');
    const cost = Math.max(30, Math.floor(def.healCost * (1 - infLvl * 0.05)));
    if (this.game.gold < cost) return false;

    this.game.gold -= cost;
    delete this.infirmaryTreatments[heroName];

    const heroObj = (this.game.storedHeroes || []).find(h => h.name === heroName) ||
                    (this.game.heroes || []).map(h => h.data).find(h => h.name === heroName);
    if (heroObj && heroObj.injuries) {
      heroObj.injuries = heroObj.injuries.filter(i => i.id !== injuryId);
    }
    return true;
  }

  consecrateTomb(heroName, classKey, relicId) {
    if (!this.isUnlocked('crypt')) return false;
    if (!ANCESTRAL_RELICS[relicId]) return false;
    this.consecratedTombs.push({ heroName, classKey, relicId, date: Date.now() });
    this.activeAncestralRelic = relicId;
    return true;
  }

  craftSoulToken() {
    if (!this.isUnlocked('crypt')) return false;
    const cryptLvl = this.getFacilityLevel('crypt');
    const cost = Math.max(100, 250 - cryptLvl * 15);
    if (this.game.gold < cost) return false;
    this.game.gold -= cost;
    this.game.soulTokens = (this.game.soulTokens || 0) + 1;
    return true;
  }

  dispatchDungeonXp(totalXpGained) {
    if (!this.isUnlocked('training_grounds')) return;
    if (!totalXpGained || totalXpGained <= 0) return;

    const trainingLevel = this.getFacilityLevel('training_grounds');
    const xpPercent = 0.05 + (trainingLevel * 0.01); // 6% at lvl 1, scaling to 15% at lvl 10
    const idleXp = Math.floor(totalXpGained * xpPercent);
    if (idleXp <= 0) return;

    const assignedHeroNames = this.getAssignedHeroes('training_grounds');
    if (assignedHeroNames.length === 0 || !this.game.storedHeroes) return;

    // Cap: Idle heroes in Training Grounds cannot exceed the active party's max/average level
    const maxAllowedLevel = this.game.heroes && this.game.heroes.length > 0
      ? Math.max(...this.game.heroes.map(h => h.data?.level || 1))
      : (typeof this.game.partyLevel === 'function' ? this.game.partyLevel() : (this.game.effectiveLevel || 1));

    for (const storedHero of this.game.storedHeroes) {
      const identifier = storedHero.name || storedHero.id;
      if (assignedHeroNames.includes(identifier)) {
        const curLevel = storedHero.level || 1;
        if (curLevel >= maxAllowedLevel) continue; // Capped at party level

        const capXp = (XP_TABLE && XP_TABLE[maxAllowedLevel]) ? XP_TABLE[maxAllowedLevel] : 999999;
        const curXp = storedHero.xp || 0;
        const xpToGrant = Math.min(idleXp, Math.max(0, capXp - curXp));

        if (xpToGrant > 0) {
          if (typeof grantXp === 'function') {
            grantXp(storedHero, xpToGrant, null);
          } else {
            storedHero.xp = curXp + xpToGrant;
            while (storedHero.level < maxAllowedLevel && XP_TABLE && storedHero.xp >= (XP_TABLE[storedHero.level + 1] || Infinity)) {
              storedHero.level = (storedHero.level || 1) + 1;
            }
          }
          if (storedHero.level > maxAllowedLevel) {
            storedHero.level = maxAllowedLevel;
          }
        }
      }
    }
  }

  getGlobalHpBonusPercent() {
    let total = 0;
    if (this.isUnlocked('crypt')) total += this.getFacilityLevel('crypt') * 0.02;
    total += this.getTechBonus('hpBonus');
    return total;
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

  getPotionDiscountPercent() {
    if (!this.isUnlocked('apothecary')) return 0;
    return this.getFacilityLevel('apothecary') * 0.04;
  }
}

