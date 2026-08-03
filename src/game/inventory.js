/**
 * Inventory, gear, potions, level-up spends, and save/load.
 * Mixed onto Game — menus.js / shop.js call these methods.
 */
import {
  recalc, canEquip, spendAbilityPoint, spendSkillPoint, spendSkillRank, pickSubclass, SUBCLASSES, roll
} from './srd.js';
import { resolveChoice } from './features.js';
import { slotsFor, migrateItem, migrateInventory, itemCategory } from './items.js';
import { drawBar, makeFloatText } from './entities.js';
import { log, updatePartyFrames, updateResources } from './ui.js';
import { SAVE_KEY } from './constants.js';
import { serializeRunStats } from './run_stats.js';
import { clearCombatEffects } from './conditions.js';
import { _v } from './shared.js';

/* Equip slots whose sprite layers honor item.visualColor (sprite_animator.js) */
export const DYEABLE_SLOTS = new Set(['helm', 'armor', 'weapon', 'offhand', 'gloves', 'amulet', 'boots']);

export const inventoryMethods = {
  drinkPotion(kind) {
    if (this.state !== 'crawl' || this.potions[kind] <= 0) return;
    let worst = null, wf = 1;
    for (const h of this.heroes) {
      if (h.data.hp <= 0) continue;
      const f = h.data.hp / h.data.maxHp;
      if (f < wf) { wf = f; worst = h; }
    }
    if (!worst || wf >= 1) return;
    this.potions[kind]--;
    const amt = kind === 'superior' ? roll(8, 4, 8) : kind === 'greater' ? roll(4, 4, 4) : roll(2, 4, 2);
    worst.data.hp = Math.min(worst.data.maxHp, worst.data.hp + amt);
    makeFloatText(this.engine.scene, '+' + amt, _v.set(worst.x, 1.3, worst.z), '#6ae0ff');
    log(`🧪 You toss ${worst.data.name} a potion (+${amt}).`, 'heal');
    drawBar(worst.ent.bar, worst.data.hp / worst.data.maxHp);
    updatePartyFrames(this.heroes.map(x => x.data));
    updateResources(this);
  },

  /** Set a per-hero AI priority knob (called from the AI Priorities tab). */
  setAIPref(heroIdx, key, val) {
    const hero = this.heroes[heroIdx];
    if (!hero || !hero.data) return;
    if (!hero.data.aiPrefs) hero.data.aiPrefs = { targeting:'nearest', movementStyle:'standard', abilityUsage:'balanced', potionTrigger:'emergency' };
    hero.data.aiPrefs[key] = val;
    this.saveGame();
  },

  /** Equip an inventory item onto a hero. `preferSlot` picks between ring slots,
   *  or between main-weapon and off-hand for a light weapon (Two-Weapon Fighting). */
  equipItem(hero, item, preferSlot = null) {
    if (item && item.slot === 'dye') {
      return { ok: false, reason: 'Drag the dye onto an equipped item to apply it.' };
    }
    if (!canEquip(hero, item)) return { ok: false, reason: 'Not proficient with that.' };
    migrateItem(item);

    /* two-handed weapon: auto-unequip offhand slot */
    if (item.slot === 'weapon' && item.twoHanded && hero.equipment.offhand) {
      this.inventory.push(hero.equipment.offhand);
      delete hero.equipment.offhand;
    }

    /* prevent equipping an offhand item while wielding a two-handed weapon */
    if (item.slot === 'shield' && hero.equipment.weapon && hero.equipment.weapon.twoHanded) {
      return { ok: false, reason: 'Cannot equip offhand with a two-handed weapon.' };
    }

    /* Two-Weapon Fighting (5e): a light weapon may occupy either the weapon
       slot or the offhand slot. Default placement: if the main hand already
       holds a light, non-two-handed weapon and the offhand is free, the new
       light weapon goes offhand to enable TWF. Otherwise it goes main hand. */
    let opts = slotsFor(item.slot);
    let slot;
    if (item.slot === 'weapon' && item.light) {
      opts = ['weapon', 'offhand'];
      const main = hero.equipment.weapon;
      if (preferSlot && opts.includes(preferSlot)) {
        slot = preferSlot;
      } else if (main && main.light && !main.twoHanded && !hero.equipment.offhand) {
        slot = 'offhand';
      } else {
        slot = opts.find(s => !hero.equipment[s]) || opts[0];
      }
    } else {
      slot = preferSlot && opts.includes(preferSlot) ? preferSlot
        : (opts.find(s => !hero.equipment[s]) || opts[0]);
    }
    const displaced = hero.equipment[slot] || null;
    hero.equipment[slot] = item;
    const idx = this.inventory.indexOf(item);
    if (idx >= 0) this.inventory.splice(idx, 1);
    if (displaced) this.inventory.push(displaced);
    recalc(hero);
    hero.hp = Math.min(hero.hp, hero.maxHp);
    this.afterGearChange(hero);
    return { ok: true };
  },

  /** Apply a dye from the bag to an equipped item. Only slots the sprite
   *  pipeline actually tints are dyeable (see tintSlotFor / layerTint in
   *  sprite_animator.js). The item's first color is banked in originalColor
   *  for a future "remove dye" feature. */
  applyDye(hero, slotKey, dyeItem) {
    if (!dyeItem || dyeItem.slot !== 'dye') return { ok: false, reason: 'Not a dye.' };
    if (!DYEABLE_SLOTS.has(slotKey)) return { ok: false, reason: 'That slot can\'t be dyed.' };
    const it = hero.equipment[slotKey];
    if (!it) return { ok: false, reason: 'Nothing equipped there to dye.' };

    if (it.originalColor === undefined) it.originalColor = it.visualColor ?? null;
    it.visualColor = dyeItem.dyeColor;
    /* magic weapons: recolor the crystal too, so the dye visibly lands */
    if (it.crystalColor) it.crystalColor = dyeItem.dyeColor;

    const idx = this.inventory.indexOf(dyeItem);
    if (idx >= 0) this.inventory.splice(idx, 1);
    log(`🎨 ${it.name} is dyed ${dyeItem.name.replace(/ Dye$/, '')}.`, 'treasure');
    this.afterGearChange(hero);
    return { ok: true };
  },

  unequipItem(hero, slot) {
    const it = hero.equipment[slot];
    if (!it) return;
    delete hero.equipment[slot];
    this.inventory.push(it);
    recalc(hero);
    hero.hp = Math.min(hero.hp, hero.maxHp);
    this.afterGearChange(hero);
  },

  /** Move an already-equipped item from one slot to another on the same hero
   *  (e.g. ring1 -> ring2). If the destination is occupied the two items swap.
   *  Used by the drag-and-drop "slot -> slot" interaction in the Equipment tab. */
  moveEquipmentSlot(hero, fromSlot, toSlot) {
    const it = hero.equipment[fromSlot];
    if (!it || fromSlot === toSlot) return { ok: false, reason: 'Nothing to move.' };
    migrateItem(it);
    if (!slotsFor(it.slot).includes(toSlot)) {
      return { ok: false, reason: 'That item can\'t go in this slot.' };
    }
    /* honor the two-handed / offhand exclusion rules used by equipItem */
    if (toSlot === 'offhand' && it.slot === 'weapon' && it.twoHanded) {
      return { ok: false, reason: 'Two-handed weapons can\'t go offhand.' };
    }
    if (toSlot === 'weapon' && it.slot === 'shield' && hero.equipment.offhand === it) {
      /* a shield has no business moving to the weapon slot */
      return { ok: false, reason: 'That item can\'t go in this slot.' };
    }
    const occupied = hero.equipment[toSlot] || null;
    /* a swap must also be legal for the displaced item's source slot */
    if (occupied && !slotsFor(occupied.slot).includes(fromSlot)) {
      return { ok: false, reason: 'Swap not allowed between those slots.' };
    }
    hero.equipment[toSlot] = it;
    delete hero.equipment[fromSlot];
    if (occupied) hero.equipment[fromSlot] = occupied; /* swap */
    recalc(hero);
    hero.hp = Math.min(hero.hp, hero.maxHp);
    this.afterGearChange(hero);
    return { ok: true };
  },

  sellItem(item) {
    if (!item || item.locked) return;
    const idx = this.inventory.indexOf(item);
    if (idx < 0) return;
    this.inventory.splice(idx, 1);
    this.gold += item.value;
    log(`💰 Sold ${item.name} for ${item.value}g.`, 'treasure');
    updateResources(this);
  },

  /** Sort inventory by rarity or name. */
  sortInventory(order) {
    const RANK = { legendary: 5, epic: 4, rare: 3, uncommon: 2, common: 1 };
    if (order === 'rarity-desc') {
      this.inventory.sort((a, b) => (RANK[b.rarity] || 0) - (RANK[a.rarity] || 0) || a.name.localeCompare(b.name));
    } else if (order === 'rarity-asc') {
      this.inventory.sort((a, b) => (RANK[a.rarity] || 0) - (RANK[b.rarity] || 0) || a.name.localeCompare(b.name));
    } else if (order === 'name') {
      this.inventory.sort((a, b) => a.name.localeCompare(b.name));
    }
    this.saveGame();
  },

  /** Sell every item of a given rarity. Returns the count sold.
   *  Locked items (it.locked === true) are protected and skipped.
   *  Legendaries require explicit confirmation (quest prizes).
   *  `category` (optional) restricts the sale to the active bag tab. */
  sellByRarity(rarity, category = null) {
    const pool = this.inventory.filter(it =>
      !it.locked && it.rarity === rarity && (!category || itemCategory(it) === category));
    if (rarity === 'legendary') {
      const n = pool.length;
      if (n === 0) return 0;
      const scope = category ? ` ${category}s` : '';
      if (typeof window !== 'undefined' && !window.confirm(`Sell ALL ${n} legendary${scope} item(s)? These are quest rewards and cannot be replaced by dungeon drops.`)) {
        return 0;
      }
    }
    const items = pool;
    if (items.length === 0) return 0;
    const soldIds = new Set(items);
    let total = 0;
    for (const it of items) total += it.value;
    this.inventory = this.inventory.filter(it => !soldIds.has(it));
    this.gold += total;
    log(`💰 Sold ${items.length} ${rarity} item(s) for ${total}g.`, 'treasure');
    updateResources(this);
    this.saveGame();
    return items.length;
  },

  afterGearChange(hero) {
    if (hero === undefined) return;
    const wrap = this.heroes.find(h => h.data === hero);
    if (wrap && wrap.ent) {
      drawBar(wrap.ent.bar, Math.max(0, hero.hp / hero.maxHp));
      if (wrap.ent.anim) {
        wrap.ent.anim.reloadAll();
      }
    }
    updatePartyFrames(this.heroes.map(x => x.data));
    updateResources(this);
    this.saveGame();
  },

  allocateAbility(hero, ability) {
    if (spendAbilityPoint(hero, ability)) { this.afterGearChange(hero); this.announceLevelUp(); return true; }
    return false;
  },

  /* class talent tree */
  allocateSkill(hero, skillKey) {
    if (spendSkillPoint(hero, skillKey)) { this.afterGearChange(hero); this.announceLevelUp(); return true; }
    return false;
  },

  /* 5e skill checks (Athletics, Investigation, …) */
  allocateSkillRank(hero, skillKey) {
    if (spendSkillRank(hero, skillKey)) { this.afterGearChange(hero); this.announceLevelUp(); return true; }
    return false;
  },

  chooseSubclass(hero, key) {
    if (!pickSubclass(hero, key)) return false;
    const sc = SUBCLASSES[hero.classKey][key];
    log(`🌟 ${hero.name} becomes a ${sc.label}! (${sc.active.name})`, 'level');
    this.afterGearChange(hero);
    this.announceLevelUp();
    return true;
  },

  /** Resolve a pending feature choice (ASI/feat, fighting style, spell). */
  chooseFeature(hero, choiceId, optionKey) {
    const res = resolveChoice(hero, choiceId, optionKey);
    if (!res.ok) return false;
    const { choice, opt } = res;
    if (choice.pick === 'asiOrFeat') {
      if (opt.kind === 'asi') log(`📈 ${hero.name} gains ${opt.amount} ability points to allot.`, 'level');
      else log(`🏅 ${hero.name} takes the ${opt.label} feat!`, 'level');
    } else if (choice.pick === 'fightingStyle') {
      log(`⚔ ${hero.name} adopts the ${opt.label} fighting style.`, 'level');
    } else if (choice.pick === 'spell') {
      log(`📜 ${hero.name} learns ${opt.label}!`, 'level');
    } else if (choice.pick === 'wildShapeForm') {
      log(`🌿 ${hero.name} selects ${opt.label} for Wild Shape!`, 'level');
    }
    recalc(hero);
    this.afterGearChange(hero);
    this.announceLevelUp();
    return true;
  },

  saveGame() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        /* h.temp = one-floor quest ally, h.companion = summoned companion —
           neither is persisted inside `heroes` (companions are saved in their
           own slot below so they survive load). */
        heroes: this.heroes.filter(h => !h.temp && !h.companion).map(h => h.data),
        companions: this.summons ? this.summons.serialize() : [],
        leaderIdx: this.leaderIdx || 0,
        storedHeroes: this.storedHeroes || [],
        townShopInventory: this.townShopInventory || [],
        townTavernHirePool: this.townTavernHirePool || [],
        inventory: this.inventory,
        gold: this.gold, potions: this.potions, dungeonLevel: this.dungeonLevel,
        activeQuest: this.activeQuest || null,
        questFloor: this.questFloor || 0,
        questChains: this.questChains || { active: [], log: [] },
        legendaryPity: this.legendaryPity || 0,
        storyProgress: this.storyProgress || {},
        bestiary: this.bestiary || {},
        guildData: this.guild ? this.guild.serialize() : null,
        runStats: serializeRunStats(this)
      }));
    } catch (e) { /* storage full/blocked — play on without saves */ }
  },

  loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data.inventory) migrateInventory(data.inventory);
      /* Armory contents are gear too — migrate them to the current item schema
         or stored legacy loot would come back out broken. */
      if (data.guildData && Array.isArray(data.guildData.storedItems)) {
        migrateInventory(data.guildData.storedItems);
      }
      /* Hero data carries a mirror of `_effects` (applyEffect writes through to
         e.data), so a save can contain buffs/debuffs with `until` stamps from a
         combat clock that starts over at 0 next session — they'd never expire.
         Combat effects don't outlive a fight anyway, so drop them on load;
         clearCombatEffects keeps the until-rest ones (drained / corroded). */
      if (Array.isArray(data.heroes)) for (const h of data.heroes) clearCombatEffects(h);
      return data;
    } catch (e) { return null; }
  }
};
