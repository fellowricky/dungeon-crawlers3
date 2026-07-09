/**
 * Inventory, gear, potions, level-up spends, and save/load.
 * Mixed onto Game — menus.js / shop.js call these methods.
 */
import {
  recalc, canEquip, spendAbilityPoint, spendSkillPoint, pickSubclass, SUBCLASSES, roll
} from './srd.js';
import { resolveChoice } from './features.js';
import { slotsFor, bondLegendaryOnEquip, migrateItem, migrateInventory } from './items.js';
import { drawBar, makeFloatText } from './entities.js';
import { log, updatePartyFrames, updateResources } from './ui.js';
import { SAVE_KEY } from './constants.js';
import { _v } from './shared.js';

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
    const amt = kind === 'greater' ? roll(4, 4, 4) : roll(2, 4, 2);
    worst.data.hp = Math.min(worst.data.maxHp, worst.data.hp + amt);
    makeFloatText(this.engine.scene, '+' + amt, _v.set(worst.x, 1.3, worst.z), '#6ae0ff');
    log(`🧪 You toss ${worst.data.name} a potion (+${amt}).`, 'heal');
    drawBar(worst.ent.bar, worst.data.hp / worst.data.maxHp);
    updatePartyFrames(this.heroes.map(x => x.data));
    updateResources(this);
  },

  /** Equip an inventory item onto a hero. `preferSlot` picks between ring slots. */
  equipItem(hero, item, preferSlot = null) {
    if (!canEquip(hero, item)) return { ok: false, reason: 'Not proficient with that.' };
    migrateItem(item);
    bondLegendaryOnEquip(item, hero.level);
    const opts = slotsFor(item.slot);
    const slot = preferSlot && opts.includes(preferSlot) ? preferSlot
      : (opts.find(s => !hero.equipment[s]) || opts[0]);
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

  unequipItem(hero, slot) {
    const it = hero.equipment[slot];
    if (!it) return;
    delete hero.equipment[slot];
    this.inventory.push(it);
    recalc(hero);
    hero.hp = Math.min(hero.hp, hero.maxHp);
    this.afterGearChange(hero);
  },

  sellItem(item) {
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
   *  Legendaries require explicit confirmation (quest prizes). */
  sellByRarity(rarity) {
    if (rarity === 'legendary') {
      const n = this.inventory.filter(it => it.rarity === 'legendary').length;
      if (n === 0) return 0;
      if (typeof window !== 'undefined' && !window.confirm(`Sell ALL ${n} legendary item(s)? These are quest rewards and cannot be replaced by dungeon drops.`)) {
        return 0;
      }
    }
    const items = this.inventory.filter(it => it.rarity === rarity);
    if (items.length === 0) return 0;
    let total = 0;
    for (const it of items) total += it.value;
    this.inventory = this.inventory.filter(it => it.rarity !== rarity);
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
        wrap.ent.anim.loadState('walk');
        wrap.ent.anim.loadState('slash');
        wrap.ent.anim.loadState('hurt');
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

  allocateSkill(hero, skillKey) {
    if (spendSkillPoint(hero, skillKey)) { this.afterGearChange(hero); this.announceLevelUp(); return true; }
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
      if (opt.kind === 'asi') log(`📈 ${hero.name} improves ${opt.label}.`, 'level');
      else log(`🏅 ${hero.name} takes the ${opt.label} feat!`, 'level');
    } else if (choice.pick === 'fightingStyle') {
      log(`⚔ ${hero.name} adopts the ${opt.label} fighting style.`, 'level');
    } else if (choice.pick === 'spell') {
      log(`📜 ${hero.name} learns ${opt.label}!`, 'level');
    }
    recalc(hero);
    this.afterGearChange(hero);
    this.announceLevelUp();
    return true;
  },

  saveGame() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        heroes: this.heroes.map(h => h.data),
        inventory: this.inventory,
        gold: this.gold, potions: this.potions, dungeonLevel: this.dungeonLevel,
        activeQuest: this.activeQuest || null,
        questFloor: this.questFloor || 0
      }));
    } catch (e) { /* storage full/blocked — play on without saves */ }
  },

  loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data.inventory) migrateInventory(data.inventory);
      return data;
    } catch (e) { return null; }
  }
};
