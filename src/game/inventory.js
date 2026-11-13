/**
 * Inventory, gear, potions, level-up spends, and save/load.
 * Mixed onto Game — menus.js / shop.js call these methods.
 */
import {
  recalc, canEquip, spendAbilityPoint, spendSkillPoint, spendSkillRank, pickSubclass, SUBCLASSES, roll, potionHealAmount
} from './srd.js';
import { resolveChoice } from './features.js';
import { slotsFor, migrateItem, migrateInventory, itemCategory, itemPoints,
  addToInventory, takeFromInventory, coalesceInventory, qtyOf, isRune } from './items.js';
import { drawBar, makeFloatText } from './entities.js';
import { log, updatePartyFrames, updateResources } from './ui.js';
import { SAVE_KEY } from './constants.js';
import { saveSlotRaw, loadSlotRaw, getActiveSlot, setActiveSlot } from './save_slots.js';

/* Seconds the periodic autosave stays quiet after localStorage refused a save. */
const SAVE_QUOTA_BACKOFF_SEC = 60;

/* A hero record is mutated in place by combat, and two of those writes are
   runtime mirrors that must never reach the save:
     data.conc     = { key, targets: [entities], zone }   (combat.js concentrate)
     data._effects = { key: { source: entity, dotSrc: entity, ... } }
   An entity carries .ent -> THREE meshes -> materials -> textures, and
   JSON.stringify calls Object3D.toJSON on it, which serialises every sprite
   sheet as a data URL. A caster holding Moonbeam turned a 150 KB save into
   several megabytes — a half-second stringify every autosave, and then a
   QuotaExceededError so nothing was written at all. The party frames read
   data.conc.key and persisting effects (drained/corroded) survive a load, so
   both fields are kept in name-only form rather than dropped. */
const entityName = (x) => (x == null ? null : typeof x === 'string' ? x : (x.data?.name ?? x.name ?? null));

export function heroSaveRecord(d) {
  if (!d || typeof d !== 'object') return d;
  const out = { ...d };
  delete out._queuedAction;   // a manual-mode intent, meaningless after reload
  delete out._lightState;     // re-read from the scene every frame
  out.conc = d.conc && d.conc.key ? { key: d.conc.key } : null;
  if (d._effects && typeof d._effects === 'object') {
    out._effects = {};
    for (const k of Object.keys(d._effects)) {
      const ef = d._effects[k];
      out._effects[k] = { ...ef, source: entityName(ef.source), dotSrc: entityName(ef.dotSrc) };
    }
  }
  return out;
}
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
    const amt = potionHealAmount(kind, worst.data);   // Alchemist % of the drinker
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
    if (isRune(item)) {
      return { ok: false, reason: 'Drag the rune onto a piece of gear to inscribe it.' };
    }
    if (!canEquip(hero, item)) return { ok: false, reason: 'Not proficient with that.' };
    migrateItem(item);

    /* two-handed weapon: auto-unequip offhand slot */
    if (item.slot === 'weapon' && item.twoHanded && hero.equipment.offhand) {
      addToInventory(this.inventory, hero.equipment.offhand);
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
    /* One unit leaves the bag: a stack of scrolls equips a single scroll and
       keeps the rest. An item that was never in the bag equips as itself. */
    const unit = takeFromInventory(this.inventory, item, 1) || item;
    hero.equipment[slot] = unit;
    if (displaced) addToInventory(this.inventory, displaced);
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

    takeFromInventory(this.inventory, dyeItem, 1);
    log(`🎨 ${it.name} is dyed ${dyeItem.name.replace(/ Dye$/, '')}.`, 'treasure');
    this.afterGearChange(hero);
    return { ok: true };
  },

  /** Spend a bag rune on equipped gear in `slotKey`. */
  applyRuneToSlot(hero, slotKey, runeItem) {
    if (!this.guild || typeof this.guild.applyRuneToItem !== 'function') {
      return { ok: false, reason: 'The Enchanter is not available.' };
    }
    const it = hero && hero.equipment && hero.equipment[slotKey];
    if (!it) return { ok: false, reason: 'Nothing equipped there to inscribe.' };
    const r = this.guild.applyRuneToItem(it, runeItem);
    if (r.ok) {
      log(`✨ ${runeItem.name} inscribed on ${it.name}.`, 'treasure');
      this.afterGearChange(hero);
    }
    return r;
  },

  /** Spend a bag rune on another bag item (unequipped gear). */
  applyRuneToBagItem(gearItem, runeItem) {
    if (!this.guild || typeof this.guild.applyRuneToItem !== 'function') {
      return { ok: false, reason: 'The Enchanter is not available.' };
    }
    const r = this.guild.applyRuneToItem(gearItem, runeItem);
    if (r.ok) log(`✨ ${runeItem.name} inscribed on ${gearItem.name}.`, 'treasure');
    return r;
  },

  unequipItem(hero, slot) {
    const it = hero.equipment[slot];
    if (!it) return;
    delete hero.equipment[slot];
    addToInventory(this.inventory, it);
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

  /** Sell `n` units of a bag item (one by default; `Infinity` for the whole
   *  stack). Gear is always a single unit. */
  sellItem(item, n = 1) {
    if (!item || item.locked) return;
    const have = qtyOf(item);
    const count = n === Infinity ? have : Math.max(1, Math.min(have, n | 0));
    if (!takeFromInventory(this.inventory, item, count)) return;
    const total = (item.value | 0) * count;
    this.gold += total;
    log(`💰 Sold ${count > 1 ? `${count}× ` : ''}${item.name} for ${total}g.`, 'treasure');
    updateResources(this);
  },

  /** Sort inventory by power score, rarity, or name.
   *
   *  PS is the honest measure of an item's strength — rarity only says how many
   *  affix rolls it got, so a well-rolled rare routinely beats a badly-rolled
   *  epic. Rarity ties are broken by PS and vice versa, so either ordering is
   *  stable rather than falling back on an arbitrary name sort. */
  sortInventory(order) {
    const RANK = { legendary: 5, epic: 4, rare: 3, uncommon: 2, common: 1 };
    const rank = (it) => RANK[it.rarity] || 0;
    const byName = (a, b) => a.name.localeCompare(b.name);
    if (order === 'ps-desc') {
      this.inventory.sort((a, b) => itemPoints(b) - itemPoints(a) || rank(b) - rank(a) || byName(a, b));
    } else if (order === 'ps-asc') {
      this.inventory.sort((a, b) => itemPoints(a) - itemPoints(b) || rank(a) - rank(b) || byName(a, b));
    } else if (order === 'rarity-desc') {
      this.inventory.sort((a, b) => rank(b) - rank(a) || itemPoints(b) - itemPoints(a) || byName(a, b));
    } else if (order === 'rarity-asc') {
      this.inventory.sort((a, b) => rank(a) - rank(b) || itemPoints(a) - itemPoints(b) || byName(a, b));
    } else if (order === 'name') {
      this.inventory.sort(byName);
    }
    this.saveGame();
  },

  /** Sell every item of a given rarity. Returns the count sold.
   *  Locked items (it.locked === true) are protected and skipped.
   *  Legendaries require explicit confirmation (quest prizes).
   *  `category` (optional) restricts the sale to the active bag tab.
   *  `psRange` (optional) `{min, max}` restricts it to the bag's power-score
   *  filter, so "hide the best gear, sell the rest" sells exactly what the grid
   *  is showing. This MUST use the same predicate the grid does — if the button
   *  counts one set and the sale takes another, it silently sells gear the
   *  player deliberately filtered out of view. */
  sellByRarity(rarity, category = null, psRange = null) {
    const lo = psRange && psRange.min != null ? psRange.min : -Infinity;
    const hi = psRange && psRange.max != null ? psRange.max : Infinity;
    const inRange = (it) => {
      if (lo === -Infinity && hi === Infinity) return true;
      const ps = itemPoints(it) || 0;
      return ps >= lo && ps <= hi;
    };
    const pool = this.inventory.filter(it =>
      !it.locked && it.rarity === rarity
      && (!category || itemCategory(it) === category)
      && inRange(it));
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
    let total = 0, units = 0;
    for (const it of items) { total += (it.value | 0) * qtyOf(it); units += qtyOf(it); }
    this.inventory = this.inventory.filter(it => !soldIds.has(it));
    this.gold += total;
    log(`💰 Sold ${units} ${rarity} item(s) for ${total}g.`, 'treasure');
    updateResources(this);
    this.saveGame();
    return items.length;
  },

  /* Dump everything weaker than `threshold` power score - the mid-dungeon
     "clear the junk" action. Locked items are spared, and so are legendaries:
     they are quest rewards that dungeon drops cannot replace, so a one-click
     bulk action must never be able to eat one, however low it scores. */
  sellBelowPS(threshold, category = null) {
    const items = this.inventory.filter(it =>
      !it.locked
      && it.rarity !== 'legendary'
      && (!category || itemCategory(it) === category)
      && (itemPoints(it) || 0) < threshold);
    if (items.length === 0) return 0;
    const soldIds = new Set(items);
    let total = 0, units = 0;
    for (const it of items) { total += (it.value | 0) * qtyOf(it); units += qtyOf(it); }
    this.inventory = this.inventory.filter(it => !soldIds.has(it));
    this.gold += total;
    log(`💰 Sold ${units} item(s) under PS ${threshold} for ${total}g.`, 'treasure');
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
      if (opt.kind === 'asi') log(`📈 ${hero.name} gains ${opt.amount} ability point${opt.amount === 1 ? '' : 's'} to allot.`, 'level');
      else log(`🏅 ${hero.name} takes the ${opt.label} feat!`, 'level');
    } else if (choice.pick === 'fightingStyle') {
      log(`⚔ ${hero.name} adopts the ${opt.label} fighting style.`, 'level');
    } else if (choice.pick === 'spell') {
      log(`📜 ${hero.name} learns ${opt.label}!`, 'level');
    } else if (choice.pick === 'wildShapeForm') {
      log(`🌿 ${hero.name} selects ${opt.label} for Wild Shape!`, 'level');
    } else if (choice.pick === 'metamagic') {
      log(`✴️ ${hero.name} masters ${opt.label}!`, 'level');
    }
    recalc(hero);
    this.afterGearChange(hero);
    this.announceLevelUp();
    return true;
  },

  saveGame(targetSlotId) {
    /* A save that no longer fits localStorage fails on EVERY autosave — and
       serialising the whole game state just to throw it away is the half-
       second hitch that made the failure visible. After a quota failure the
       periodic autosave stands down for a while; explicit saves (floor
       change, shop, quest) still try, since the player may have freed room. */
    if (targetSlotId == null && this._saveQuotaFailedAt != null
        && (this.elapsed || 0) - this._saveQuotaFailedAt < SAVE_QUOTA_BACKOFF_SEC) return;
    try {
      const slotId = targetSlotId != null ? targetSlotId : (this.activeSaveSlot || getActiveSlot());
      this.activeSaveSlot = slotId;
      saveSlotRaw(slotId, {
        /* h.temp = one-floor quest ally, h.companion = summoned companion —
           neither is persisted inside `heroes` (companions are saved in their
           own slot below so they survive load). */
        heroes: this.heroes.filter(h => !h.temp && !h.companion).map(h => heroSaveRecord(h.data)),
        companions: this.summons
          ? this.summons.serialize().map(c => ({ ...c, data: heroSaveRecord(c.data) }))
          : [],
        leaderIdx: this.leaderIdx || 0,
        storedHeroes: (this.storedHeroes || []).map(heroSaveRecord),
        townShopInventory: this.townShopInventory || [],
        townTavernHirePool: this.townTavernHirePool || [],
        inventory: this.inventory,
        gold: this.gold, potions: this.potions, dungeonLevel: this.dungeonLevel,
        activeQuest: this.activeQuest || null,
        questFloor: this.questFloor || 0,
        questChains: this.questChains || { active: [], log: [] },
        legendaryPity: this.legendaryPity || 0,
        storyProgress: this.storyProgress || {},
        controlMode: this.controlMode || 'auto',
        bestiary: this.bestiary || {},
        guildData: this.guild ? this.guild.serialize() : null,
        runStats: serializeRunStats(this)
      });
      this._saveQuotaFailedAt = null;
    } catch (e) {
      /* storage full/blocked — play on, but say so once: a silent failure
         here is lost progress the player only discovers on reload. */
      if (e && e.quota) {
        this._saveQuotaFailedAt = this.elapsed || 0;
        if (!this._saveQuotaWarned) {
          this._saveQuotaWarned = true;
          log('⚠ Save failed — browser storage is full. Progress is NOT being saved (see console for what is using the space).', 'sys');
        }
      }
    }
  },

  loadSave(targetSlotId) {
    try {
      const slotId = targetSlotId != null ? targetSlotId : (this.activeSaveSlot || getActiveSlot());
      const data = loadSlotRaw(slotId);
      if (!data) return null;
      this.activeSaveSlot = slotId;
      if (data.inventory) {
        migrateInventory(data.inventory);
        /* Saves from before stacking hold one record per dye and scroll. */
        data.inventory = coalesceInventory(data.inventory);
      }
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
