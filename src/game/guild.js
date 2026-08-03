/**
 * Guild Manager & Facilities System
 * Handles guild structure upgrades, facility levels, hero assignments, and idle mechanics.
 */

/** Armory storage slots granted per facility level (level 10 → 120 slots). */
export const ARMORY_SLOTS_PER_LEVEL = 12;

export const FACILITY_DEFINITIONS = {
  living_quarters: {
    id: 'living_quarters',
    name: 'Living Quarters',
    icon: '🏰',
    description: 'Expands the capacity of stored heroes in the Guild.',
    baseCost: 200,
    costMultiplier: 1.8,
    maxLevel: 10,
    getEffectText: (lvl) => `Max Stored Heroes: ${6 + lvl * 2}`
  },
  armory: {
    id: 'armory',
    name: 'The Armory',
    icon: '🗄️',
    description: 'Store gear the party isn\'t carrying. Stored items survive every delve.',
    baseCost: 250,
    costMultiplier: 1.7,
    maxLevel: 10,
    /* Capacity is the whole point of the facility, so it doubles as the
       upgrade incentive — see GuildManager.getArmoryCapacity. */
    getEffectText: (lvl) => `Storage Slots: ${lvl * ARMORY_SLOTS_PER_LEVEL}`
  },
  training_grounds: {
    id: 'training_grounds',
    name: 'Training Grounds',
    icon: '⚔️',
    description: 'Assigned idle heroes receive 25% of all XP earned by the active dungeon party.',
    baseCost: 350,
    costMultiplier: 2.0,
    maxLevel: 10,
    getEffectText: (lvl) => `Training Slots: ${Math.min(6, 1 + Math.floor(lvl * 0.5))} (XP Rate: 25% + ${(lvl - 1) * 2}% bonus)`
  },
  blacksmith: {
    id: 'blacksmith',
    name: 'The Blacksmith',
    icon: '⚒️',
    description: 'Enhance gear stats and lower equipment upgrade costs.',
    baseCost: 500,
    costMultiplier: 2.2,
    maxLevel: 10,
    getEffectText: (lvl) => `Equipment Upgrade Discount: ${lvl * 3}%`
  },
  apothecary: {
    id: 'apothecary',
    name: 'The Apothecary',
    icon: '🧪',
    description: 'Craft combat potions and consumables at a discount.',
    baseCost: 450,
    costMultiplier: 2.1,
    maxLevel: 10,
    getEffectText: (lvl) => `Potion Cost Discount: ${lvl * 4}%`
  },
  infirmary: {
    id: 'infirmary',
    name: 'The Infirmary',
    icon: '🩺',
    description: 'Treat injured heroes returning from dungeon wipes or intensive training.',
    baseCost: 400,
    costMultiplier: 2.0,
    maxLevel: 10,
    getEffectText: (lvl) => `Recovery Speed: +${lvl * 15}%`
  },
  crypt: {
    id: 'crypt',
    name: 'The Crypt',
    icon: '🪦',
    description: 'Pay burial rites to fallen heroes to grant permanent global resolve to your roster.',
    baseCost: 600,
    costMultiplier: 2.5,
    maxLevel: 10,
    getEffectText: (lvl) => `Global Roster Max HP: +${lvl * 2}%`
  },
  enchanter: {
    id: 'enchanter',
    name: 'Enchanter\'s Spire',
    icon: '🔮',
    description: 'Imbue gear with magical runes and modifier slots.',
    baseCost: 800,
    costMultiplier: 2.4,
    maxLevel: 10,
    getEffectText: (lvl) => `Enchantment Power: +${lvl * 5}%`
  },
  academy: {
    id: 'academy',
    name: 'The Academy',
    icon: '📜',
    description: 'Research global passive bonuses for your adventuring party.',
    baseCost: 1000,
    costMultiplier: 2.5,
    maxLevel: 10,
    getEffectText: (lvl) => `Global Bonus XP & Gold: +${lvl * 2}%`
  },
  cartographer: {
    id: 'cartographer',
    name: 'Cartographer\'s Guild',
    icon: '🗺️',
    description: 'Fund scouting expeditions to reveal hidden dungeons and high-reward bounties.',
    baseCost: 750,
    costMultiplier: 2.3,
    maxLevel: 10,
    getEffectText: (lvl) => `Bounty Reward Bonus: +${lvl * 5}%`
  },
  war_room: {
    id: 'war_room',
    name: 'The War Room',
    icon: '🛡️',
    description: 'Analyze monster tactics to gain family damage and defense bonuses.',
    baseCost: 900,
    costMultiplier: 2.4,
    maxLevel: 10,
    getEffectText: (lvl) => `Damage vs Bosses/Monsters: +${lvl * 3}%`
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

/**
 * Calculates brewing output for Apothecary based on:
 * - Apothecary Level (1 to 10)
 * - Hero Intelligence Score (e.g. 10 to 20+)
 * - Floors Cleared (default 10)
 */
export function getApothecaryBrewOutput(apothecaryLevel, heroInt, floors = 10) {
  const lvlRatio = Math.min(1.0, Math.max(0.1, apothecaryLevel / 10));
  const intRatio = Math.min(1.0, Math.max(0.5, heroInt / 20));

  // Combined power score (0.30 to 1.00+)
  const powerScore = (lvlRatio * 0.5) + (intRatio * 0.5);

  // Quantity per 10 floors: 2 at min (0.30) -> 5 at max (1.00)
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

  return {
    powerScore,
    potionTier,
    tierLabel,
    quantity: totalQuantity,
    quantityPer10
  };
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
    
    for (const key of Object.keys(FACILITY_DEFINITIONS)) {
      // Default to level 0 (locked), except Living Quarters which is unlocked at level 1 by default
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
      storedItems: [ ...this.storedItems ]
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
  }

  /* ── Armory ──────────────────────────────────────────────────────────
   * Gear the party isn't carrying, parked between delves. Capacity comes off
   * the facility level, so expanding storage is a gold sink like every other
   * guild upgrade. A locked Armory (level 0) has no slots at all. */

  getArmoryCapacity() {
    return this.getFacilityLevel('armory') * ARMORY_SLOTS_PER_LEVEL;
  }

  getArmoryFreeSlots() {
    return Math.max(0, this.getArmoryCapacity() - this.storedItems.length);
  }

  /**
   * Move one item from the party inventory into storage.
   * Refuses when the Armory is full or the item isn't actually in inventory,
   * so a stale UI click can't duplicate or vanish gear.
   * Returns { ok } or { ok:false, reason }.
   */
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

  /**
   * Move one item from storage back into the party inventory.
   * Returns { ok } or { ok:false, reason }.
   */
  withdrawItem(item) {
    if (!item) return { ok: false, reason: 'Nothing to withdraw.' };
    const idx = this.storedItems.indexOf(item);
    if (idx < 0) return { ok: false, reason: 'That item is no longer in the Armory.' };
    this.storedItems.splice(idx, 1);
    if (!this.game.inventory) this.game.inventory = [];
    this.game.inventory.push(item);
    return { ok: true };
  }

  /** Deposit everything unequipped that will fit. Returns the number stored. */
  depositAllGear() {
    const inv = this.game.inventory || [];
    /* Same filter the Blacksmith uses for "gear": real equipment only, no
       potions or dyes. Copy first — depositItem splices the live array. */
    const gear = inv.filter(i => i && i.slot && i.kind !== 'potion' && i.kind !== 'dye');
    let n = 0;
    for (const item of gear) {
      if (this.getArmoryFreeSlots() <= 0) break;
      if (this.depositItem(item).ok) n++;
    }
    return n;
  }

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
    if (level === 0) return def.baseCost; // Cost to unlock (Level 0 -> 1)
    return Math.floor(def.baseCost * Math.pow(def.costMultiplier, level));
  }

  canUpgrade(facilityId) {
    const cost = this.getUpgradeCost(facilityId);
    return this.game.gold >= cost && this.getFacilityLevel(facilityId) < FACILITY_DEFINITIONS[facilityId].maxLevel;
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
    if (!this.isUnlocked(facilityId)) return false; // Cannot assign hero to locked facility
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

  /**
   * Called whenever active dungeon party clears a floor.
   * Increments floor counter for Apothecary and recovers heroes in Infirmary beds.
   */
  onFloorCleared() {
    // 1. Apothecary brewing
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

    // 2. Infirmary Bed Injury Recovery
    if (this.isUnlocked('infirmary') && this.infirmaryTreatments) {
      for (const [heroName, tData] of Object.entries(this.infirmaryTreatments)) {
        if (!tData || tData.floorsRemaining <= 0) continue;
        tData.floorsRemaining -= 1;
        if (tData.floorsRemaining <= 0) {
          // Fully recovered
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

  /**
   * Called when active dungeon party receives XP.
   * Dispatches 25% (plus facility level bonus) to idle heroes assigned to Training Grounds.
   */
  dispatchDungeonXp(totalXpGained) {
    if (!this.isUnlocked('training_grounds')) return;
    const trainingLevel = this.getFacilityLevel('training_grounds');
    const xpPercent = 0.25 + (trainingLevel - 1) * 0.02;
    const idleXp = Math.max(1, Math.round(totalXpGained * xpPercent));

    const assignedHeroNames = this.getAssignedHeroes('training_grounds');
    if (assignedHeroNames.length === 0 || !this.game.storedHeroes) return;

    for (const storedHero of this.game.storedHeroes) {
      const identifier = storedHero.name || storedHero.id;
      if (assignedHeroNames.includes(identifier)) {
        if (typeof storedHero.addXp === 'function') {
          storedHero.addXp(idleXp);
        } else {
          storedHero.xp = (storedHero.xp || 0) + idleXp;
          const nextLevelXp = (storedHero.level || 1) * 100;
          if (storedHero.xp >= nextLevelXp) {
            storedHero.level = (storedHero.level || 1) + 1;
          }
        }
      }
    }
  }

  getGlobalHpBonusPercent() {
    if (!this.isUnlocked('crypt')) return 0;
    return this.getFacilityLevel('crypt') * 0.02;
  }

  getGlobalXpBonusPercent() {
    if (!this.isUnlocked('academy')) return 0;
    return this.getFacilityLevel('academy') * 0.02;
  }

  getEquipmentDiscountPercent() {
    if (!this.isUnlocked('blacksmith')) return 0;
    return this.getFacilityLevel('blacksmith') * 0.03;
  }

  getPotionDiscountPercent() {
    if (!this.isUnlocked('apothecary')) return 0;
    return this.getFacilityLevel('apothecary') * 0.04;
  }
}
