/**
 * Loot & Item Development Kit — Application Logic
 * Interactive Loot Editor, Visual Inspector, Perk/Affix Manager, and Drop Simulator.
 */

import DEFAULT_ITEMS_DATA from './game/items.json' with { type: 'json' };
import {
  SLOTS,
  SLOT_LABEL,
  SKILL_LABEL,
  RARITIES,
  RARITY_ORDER,
  TIER,
  BASES,
  rollItem,
  getBase,
  itemPoints,
  itemSpend,
  bonusText,
  recomputeItemBonuses
} from './game/items.js';
import { initBalanceAndLadder, renderLadder } from './loot_editor_balance.js';
import {
  baseCost, earliestIlvl, itemBudget, getTuning,
  ABILITY_KEYS, saveAbilityOf, elemTypeOf, slotLevelOf
} from './game/budget.js';

/**
 * Earliest item level a base can drop at, DERIVED from what it costs.
 *
 * There is no stored minimum-floor any more — the old hand-maintained
 * `minFloors` table was deleted with the budget rework. A base simply cannot
 * roll at an ilvl whose budget can't afford it, so this is read-only: it
 * reports a consequence of the base's stats, it is not a knob.
 */
function unlockIlvl(slot, base) {
  const lvl = earliestIlvl(slot, base, 'common');
  return lvl == null ? null : lvl;
}
function unlockLabel(slot, base) {
  const lvl = unlockIlvl(slot, base);
  return lvl == null ? 'never (common)' : 'ilvl ' + lvl;
}

// Local Storage Keys
const DRAFT_STORAGE_KEY = 'dc_loot_editor_draft_v1';
const NOTES_STORAGE_KEY = 'dc_loot_editor_notes_v1';
const TUNING_STORAGE_KEY = 'dc_loot_editor_tuning_v1';

// Preset Color Palettes (LPC Metals & Cloths)
const PRESET_COLORS = [
  '#b08a36', '#a26118', '#b54936', '#52414a', '#726b7e', '#c8d4db', '#e8c25a', '#8fd4e8', '#252025',
  '#a32020', '#2e7d32', '#1565c0', '#6a1b9a', '#8d5524', '#3e2723', '#f5f5f5', '#212121'
];

// Common DCSS Icons Database for Icon Picker Modal
const COMMON_DCSS_ICONS = [
  // Weapons
  'dcss/item/weapon/club.png', 'dcss/item/weapon/dagger_old.png', 'dcss/item/weapon/dagger.png',
  'dcss/item/weapon/short_sword_1.png', 'dcss/item/weapon/long_sword_1.png', 'dcss/item/weapon/greatsword_1.png',
  'dcss/item/weapon/rapier_1.png', 'dcss/item/weapon/mace_1.png', 'dcss/item/weapon/war_hammer.png',
  'dcss/item/weapon/spear.png', 'dcss/item/weapon/axe.png', 'dcss/item/weapon/ranged/shortbow_1.png',
  'dcss/item/weapon/ranged/longbow.png', 'dcss/item/wand/gem_wood.png', 'dcss/item/wand/wand_silver.png',
  'dcss/item/weapon/quarterstaff.png', 'dcss/item/weapon/katana.png', 'dcss/item/weapon/sabre_1_silver.png',
  'dcss/item/weapon/scimitar_1.png', 'dcss/item/weapon/giant_club.png', 'dcss/item/weapon/spear_2.png',
  'dcss/item/weapon/hammer_1.png', 'dcss/item/weapon/ranged/sling_1.png', 'dcss/item/weapon/ranged/crossbow_1.png',
  'dcss/item/weapon/morningstar_1.png', 'dcss/item/weapon/eveningstar_1.png', 'dcss/item/weapon/trident_1.png',
  'dcss/item/weapon/bullwhip.png', 'dcss/item/weapon/glaive_1.png', 'dcss/item/weapon/battle_axe_3.png',
  'dcss/item/weapon/mace_large_1.png', 'dcss/item/weapon/hand_crossbow.png', 'dcss/item/weapon/ranged/arbalest_1.png',
  'dcss/item/weapon/cutlass_1.png', 'dcss/item/weapon/falchion_2.png', 'dcss/item/weapon/scythe_1.png', 'dcss/item/weapon/claymore.png',
  // Shields & Armor
  'dcss/item/armor/shields/buckler_1.png', 'dcss/item/armor/shields/shield_2_kite.png', 'dcss/item/armor/shields/large_shield_1.png',
  'dcss/item/armor/shields/shield_1.png', 'dcss/item/armor/shields/buckler_2.png', 'dcss/item/armor/shields/dwarven_buckler_1.png',
  'dcss/item/armor/shields/shield_3_round.png', 'dcss/item/armor/headgear/cap_1.png', 'dcss/item/armor/headgear/elven_leather_helm.png',
  'dcss/item/armor/headgear/wizard_hat_1.png', 'dcss/item/armor/headgear/hat_1.png', 'dcss/item/armor/headgear/helmet_3.png',
  'dcss/item/armor/headgear/helmet_4.png', 'dcss/item/armor/headgear/helmet_2.png', 'dcss/item/armor/headgear/crested_helmet.png',
  'dcss/item/armor/headgear/helmet_5.png', 'dcss/item/armor/headgear/plumed_helmet.png', 'dcss/item/armor/headgear/helmet_1.png',
  'dcss/item/armor/headgear/wizard_hat_2.png', 'dcss/item/armor/headgear/helmet_ego_1.png', 'dcss/item/armor/headgear/cap_jester.png',
  'dcss/item/armor/torso/robe_1_old.png', 'dcss/item/armor/torso/animal_skin_1.png', 'dcss/item/armor/torso/robe_2.png',
  'dcss/item/armor/torso/robe_1.png', 'dcss/item/armor/torso/leather_armor_1.png', 'dcss/item/armor/torso/chain_mail_1.png',
  'dcss/item/armor/torso/chain_mail_2.png', 'dcss/item/armor/torso/plate_1.png', 'dcss/item/armor/torso/robe_3.png',
  'dcss/item/armor/torso/studded_leather_armor.png', 'dcss/item/armor/torso/scale_mail_1.png', 'dcss/item/armor/torso/banded_mail_1.png',
  'dcss/item/armor/torso/plate_mail_1.png', 'dcss/item/armor/torso/ring_mail_1.png', 'dcss/item/armor/torso/splint_mail_1.png',
  'dcss/item/armor/torso/green_dragon_scale_mail.png',
  // Gloves, Boots, Jewelry, Kits
  'dcss/item/armor/hands/glove_1.png', 'dcss/item/armor/hands/gauntlet_1.png', 'dcss/item/armor/hands/glove_3.png',
  'dcss/item/armor/feet/boots_4_green.png', 'dcss/item/armor/feet/boots_1_brown_new.png', 'dcss/item/armor/feet/boots_2_jackboots.png',
  'dcss/item/armor/feet/boots_iron_2.png', 'dcss/item/ring/iron.png', 'dcss/item/ring/gold.png', 'dcss/item/ring/emerald.png',
  'dcss/item/ring/ruby.png', 'dcss/item/ring/diamond.png', 'dcss/item/ring/ring_engagement.png', 'dcss/item/ring/jade.png',
  'dcss/item/ring/granite.png', 'dcss/item/ring/moonstone.png', 'dcss/item/amulet/crystal_red.png', 'dcss/item/amulet/celtic_red.png',
  'dcss/item/amulet/celtic_yellow.png', 'dcss/item/amulet/eye_cyan.png', 'dcss/item/amulet/face_1_gold.png', 'dcss/item/misc/misc_box.png',
  'dcss/item/misc/key.png', 'dcss/item/misc/misc_crystal.png', 'dcss/item/book/misc_book.png', 'dcss/item/misc/misc_lantern.png'
];

// App State
let appData = null;
let activeSlot = 'all';
let activeCategory = 'all';
let activeSearchQuery = '';
let activeStatusFilter = 'all';
let activeSelectedItem = null; // { slot, index, base }
let activeTab = 'item-editor';

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  loadAppData();
  initUI();
  renderItemList();
  renderPerksAndAffixes();
  renderSimulator();
  /* Budget & Costs + Ladder tabs. Any knob edit there re-renders the simulator
     so every view in the editor agrees on the same numbers. */
  initBalanceAndLadder({ onChange: renderSimulator });
});

// Load App Data from Draft or Default JSON
function loadAppData() {
  const savedDraft = localStorage.getItem(DRAFT_STORAGE_KEY);
  if (savedDraft) {
    try {
      appData = JSON.parse(savedDraft);
    } catch (e) {
      console.error('Failed to parse saved draft loot data:', e);
      appData = JSON.parse(JSON.stringify(DEFAULT_ITEMS_DATA));
    }
  } else {
    appData = JSON.parse(JSON.stringify(DEFAULT_ITEMS_DATA));
  }
}

// Save Local Draft
function saveDraft() {
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(appData));
  updateHeaderBadges();
}

// Toast helper
function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}

// Global UI Setup
function initUI() {
  updateHeaderBadges();

  // Search & Filter listeners
  document.getElementById('search-input').addEventListener('input', (e) => {
    activeSearchQuery = e.target.value.toLowerCase().trim();
    renderItemList();
  });

  document.getElementById('filter-slot').addEventListener('change', (e) => {
    activeSlot = e.target.value;
    renderItemList();
  });

  document.getElementById('filter-status').addEventListener('change', (e) => {
    activeStatusFilter = e.target.value;
    renderItemList();
  });

  // Category Rail
  const catRail = document.getElementById('category-rail');
  catRail.querySelectorAll('.cat-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      catRail.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeCategory = tab.getAttribute('data-cat');
      renderItemList();
    });
  });

  // Workspace Tabs Navigation
  document.querySelectorAll('.ws-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ws-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.getAttribute('data-tab');

      document.querySelectorAll('.tab-pane').forEach(pane => pane.style.display = 'none');
      document.getElementById(`tab-${activeTab}`).style.display = 'block';
    });
  });

  // Header Actions
  document.getElementById('btn-new-item').addEventListener('click', handleCreateNewItem);
  document.getElementById('btn-save-project').addEventListener('click', handleSaveToProject);
  document.getElementById('btn-export-json').addEventListener('click', handleExportJSON);
  document.getElementById('btn-import-json').addEventListener('click', handleImportJSON);
  document.getElementById('btn-reset-defaults').addEventListener('click', handleResetDefaults);

  // Form Change Events for Selected Item
  setupFormBinders();

  // Color Swatches
  renderColorSwatches();

  // Allowed-affix bulk toggles
  document.getElementById('btn-affix-allow-all').addEventListener('click', () => setAllAffixAllow(true));
  document.getElementById('btn-affix-allow-none').addEventListener('click', () => setAllAffixAllow(false));

  // Icon Picker Modal
  document.getElementById('btn-browse-icons').addEventListener('click', openIconPickerModal);
  document.getElementById('btn-close-icon-modal').addEventListener('click', closeIconPickerModal);
  document.getElementById('icon-search-input').addEventListener('input', renderIconGrid);

  // LPC Sprite Layer Picker Modal
  document.getElementById('btn-browse-lpc-sprites').addEventListener('click', openLpcPickerModal);
  document.getElementById('btn-close-lpc-modal').addEventListener('click', closeLpcPickerModal);
  document.getElementById('lpc-search-input').addEventListener('input', renderLpcGrid);
  document.getElementById('lpc-category-select').addEventListener('change', renderLpcGrid);

  // Custom Sprite Upload
  document.getElementById('btn-upload-sprite').addEventListener('click', handleSpriteUpload);

  // Perks Manager Actions
  document.getElementById('btn-add-perk').addEventListener('click', handleAddPerk);

  // Simulator Actions
  const simRange = document.getElementById('sim-floor-range');
  simRange.addEventListener('input', (e) => {
    document.getElementById('sim-floor-label').textContent = `Tier ${e.target.value}`;
    updateSimulatorChart();
  });

  document.getElementById('btn-roll-1').addEventListener('click', () => runSimRolls(1));
  document.getElementById('btn-roll-20').addEventListener('click', () => runSimRolls(20));
  document.getElementById('btn-roll-100').addEventListener('click', () => runSimRolls(100));

  // Designer Notes
  const notesArea = document.getElementById('designer-notes-textarea');
  notesArea.value = localStorage.getItem(NOTES_STORAGE_KEY) || '';
  notesArea.addEventListener('input', (e) => {
    localStorage.setItem(NOTES_STORAGE_KEY, e.target.value);
    document.getElementById('notes-save-status').textContent = 'Saved notes to storage';
    setTimeout(() => { document.getElementById('notes-save-status').textContent = ''; }, 2000);
  });
}

// Update Header Statistics Badges
function updateHeaderBadges() {
  let totalCount = 0;
  let editedCount = 0;
  let customCount = 0;
  let kitCount = 0;

  for (const slot in appData.bases) {
    const list = appData.bases[slot] || [];
    totalCount += list.length;
    list.forEach(b => {
      if (b._edited) editedCount++;
      if (b._custom) customCount++;
      if (slot === 'kit') kitCount++;
    });
  }

  const perkCount = Object.keys(appData.perks || {}).length;

  document.getElementById('badge-total').textContent = `Bases: ${totalCount}`;
  document.getElementById('badge-edited').textContent = `Modified: ${editedCount}`;
  document.getElementById('badge-custom').textContent = `Custom: ${customCount}`;
  document.getElementById('badge-perks').textContent = `Perks: ${perkCount}`;
  document.getElementById('badge-kits').textContent = `Kits: ${kitCount}`;
}

// Render Item Sidebar List
function renderItemList() {
  const container = document.getElementById('item-list-container');
  container.innerHTML = '';

  const items = [];

  for (const slot in appData.bases) {
    if (activeSlot !== 'all' && activeSlot !== slot) continue;
    if (activeCategory !== 'all' && activeCategory !== slot) {
      if (activeCategory === 'weapon' && slot !== 'weapon') continue;
      if (activeCategory === 'shield' && slot !== 'shield') continue;
      if (activeCategory === 'helm' && slot !== 'helm') continue;
      if (activeCategory === 'armor' && slot !== 'armor') continue;
      if (activeCategory === 'gloves' && slot !== 'gloves') continue;
      if (activeCategory === 'boots' && slot !== 'boots') continue;
      if (activeCategory === 'ring' && slot !== 'ring') continue;
      if (activeCategory === 'amulet' && slot !== 'amulet') continue;
      if (activeCategory === 'kit' && slot !== 'kit') continue;
    }

    const list = appData.bases[slot] || [];
    list.forEach((base, idx) => {
      // Status Filter
      if (activeStatusFilter === 'edited' && !base._edited) return;
      if (activeStatusFilter === 'custom' && !base._custom) return;
      if (activeStatusFilter === 'default' && (base._edited || base._custom)) return;

      // Search Query Filter
      if (activeSearchQuery) {
        const nameMatch = base.name.toLowerCase().includes(activeSearchQuery);
        const slotMatch = slot.toLowerCase().includes(activeSearchQuery);
        if (!nameMatch && !slotMatch) return;
      }

      items.push({ slot, index: idx, base });
    });
  }

  if (items.length === 0) {
    container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">No items match current filters.</div>`;
    return;
  }

  items.forEach(itemObj => {
    const { slot, index, base } = itemObj;
    const isSelected = activeSelectedItem && activeSelectedItem.slot === slot && activeSelectedItem.index === index;

    const div = document.createElement('div');
    div.className = `item-list-entry ${isSelected ? 'selected' : ''}`;

    const unlock = unlockIlvl(slot, base);

    div.innerHTML = `
      <div class="item-entry-icon">
        <img src="${base.icon || 'dcss/item/weapon/club.png'}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\'><text y=\'20\' font-size=\'18\'>⚔️</text></svg>'">
      </div>
      <div class="item-entry-info">
        <div class="item-entry-name">${base.name}</div>
        <div class="item-entry-meta">
          <span>${SLOT_LABEL[slot] || slot}</span>
          <span class="item-tag tag-minfloor" title="Earliest item level this base can drop at — derived from its point cost, not stored">${unlock == null ? 'i—' : 'i' + unlock}</span>
          ${base._custom ? '<span class="item-tag tag-custom">NEW</span>' : (base._edited ? '<span class="item-tag tag-edited">EDITED</span>' : '')}
        </div>
      </div>
    `;

    div.addEventListener('click', () => {
      activeSelectedItem = { slot, index, base };
      document.querySelectorAll('.item-list-entry').forEach(e => e.classList.remove('selected'));
      div.classList.add('selected');
      bindSelectedItemToEditor();
    });

    container.appendChild(div);
  });

  // Select first item if none selected
  if (!activeSelectedItem && items.length > 0) {
    activeSelectedItem = items[0];
    bindSelectedItemToEditor();
  }
}

// Bind Selected Item to Editor Forms & Live Preview Card
function bindSelectedItemToEditor() {
  if (!activeSelectedItem) return;

  const { slot, base } = activeSelectedItem;

  // Basic identification
  document.getElementById('inp-item-name').value = base.name;
  document.getElementById('inp-item-slot').value = slot;
  renderDerivedUnlock(slot, base);

  // Chassis (base items carry no stat bonuses)
  document.getElementById('inp-ac-base').value = base.acBase || '';

  // 5e Weapon Attributes
  const wForm = document.getElementById('form-weapon-props');
  const wFlags = document.getElementById('form-weapon-flags');
  const aForm = document.getElementById('form-armor-props');
  const kForm = document.getElementById('form-kit-skills');

  if (slot === 'weapon') {
    wForm.style.display = 'grid';
    wFlags.style.display = 'flex';
    aForm.style.display = 'none';
    kForm.style.display = 'none';

    document.getElementById('inp-weapon-type').value = base.weaponType || 'simple';
    document.getElementById('inp-weapon-melee').value = base.melee !== false ? 'true' : 'false';
    document.getElementById('inp-weapon-dmgtype').value = base.dmgType || 'slashing';
    document.getElementById('inp-dmg-dice-count').value = (base.dmg && base.dmg[0]) || 1;
    document.getElementById('inp-dmg-dice-sides').value = (base.dmg && base.dmg[1]) || 6;
    document.getElementById('inp-weapon-range').value = base.range != null ? base.range : 1.5;

    document.getElementById('chk-finesse').checked = !!base.finesse;
    document.getElementById('chk-light').checked = !!base.light;
    document.getElementById('chk-heavy').checked = !!base.heavy;
    document.getElementById('chk-versatile').checked = !!base.versatile;
    document.getElementById('chk-twoHanded').checked = !!base.twoHanded;
    document.getElementById('chk-reach').checked = !!base.reach;
    document.getElementById('chk-thrown').checked = !!base.thrown;
    document.getElementById('chk-focus').checked = !!base.focus;
    document.getElementById('chk-loading').checked = !!base.loading;
  } else if (slot === 'armor') {
    wForm.style.display = 'none';
    wFlags.style.display = 'none';
    aForm.style.display = 'grid';
    kForm.style.display = 'none';

    document.getElementById('inp-armor-base').value = base.armorBase != null ? base.armorBase : '';
    document.getElementById('inp-armor-prof').value = base.prof || 'none';
  } else if (slot === 'kit') {
    wForm.style.display = 'none';
    wFlags.style.display = 'none';
    aForm.style.display = 'none';
    kForm.style.display = 'block';
    renderKitSkillCheckboxes(base.toolSkills || []);
  } else {
    wForm.style.display = 'none';
    wFlags.style.display = 'none';
    aForm.style.display = 'none';
    kForm.style.display = 'none';
  }

  // Which affixes this base is allowed to roll
  renderAffixAllowCheckboxes(slot, base);

  // Visual Assets & Layers
  document.getElementById('inp-icon-path').value = base.icon || '';
  document.getElementById('inp-vis-weapon').value = base.visualWeapon || '';
  document.getElementById('inp-vis-shield').value = base.visualShield || '';
  document.getElementById('inp-vis-helm').value = base.visualHelm || '';
  document.getElementById('inp-vis-torso').value = base.visualTorso || '';
  document.getElementById('inp-vis-color-text').value = base.visualColor || '';
  if (base.visualColor && base.visualColor.startsWith('#')) {
    document.getElementById('inp-vis-color-hex').value = base.visualColor;
  }

  // Refresh Preview Card
  updateLivePreviewCard();
}

// Render Kit Skill Checkboxes
function renderKitSkillCheckboxes(selectedSkills) {
  const container = document.getElementById('kit-skills-checkboxes');
  container.innerHTML = '';

  for (const sk in SKILL_LABEL) {
    const isChecked = selectedSkills.includes(sk);
    const label = document.createElement('label');
    label.style.fontSize = '11px';
    label.style.color = 'var(--text-main)';
    label.innerHTML = `<input type="checkbox" data-skill="${sk}" ${isChecked ? 'checked' : ''}> ${SKILL_LABEL[sk]}`;
    label.querySelector('input').addEventListener('change', () => {
      if (!activeSelectedItem) return;
      const base = activeSelectedItem.base;
      const skills = [];
      container.querySelectorAll('input:checked').forEach(c => skills.push(c.getAttribute('data-skill')));
      base.toolSkills = skills;
      base._edited = true;
      saveDraft();
      updateLivePreviewCard();
    });
    container.appendChild(label);
  }
}

/* ── Per-base affix whitelist ──────────────────────────────────────────────
   A base may narrow which affixes it rolls via `base.affixAllow`. Absent means
   "no restriction", which is why the property is DELETED rather than written out
   in full when every box is ticked: a stored full list would silently exclude
   any affix added to the game later. */

/** Which panel group an affix belongs to, from the bonus it grants. */
function affixGroupOf(aff) {
  const key = Object.keys(aff.b || {})[0] || '';
  if (key === 'skills') return 'Skills';
  if (saveAbilityOf(key)) return 'Saving throws';
  if (elemTypeOf(key)) return 'Elemental damage';
  if (slotLevelOf(key)) return 'Spell slots';
  if (ABILITY_KEYS.includes(key)) return 'Abilities';
  if (key === 'move' || key === 'speed') return 'Movement';
  if (['ac', 'atk', 'dmg', 'crit', 'hp', 'heal'].includes(key)) return 'Combat';
  return 'Other';
}
const AFFIX_GROUP_ORDER = ['Combat', 'Abilities', 'Movement', 'Saving throws',
  'Elemental damage', 'Spell slots', 'Skills', 'Other'];

/* Plain names for the checkbox list. The affix's own `label` is flavour ("of
   Endurance") — fine on an item in-game, useless when you're ticking boxes and
   need to know it grants CON. */
const PLAIN_BONUS_NAME = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
  ac: 'Armor Class', atk: 'Attack', dmg: 'Damage', crit: 'Crit Chance',
  hp: 'Hit Points', heal: 'Healing',
  speed: 'Exploration Speed', move: 'Combat Movement',
};

/** What an affix actually grants, in plain language: "Constitution +1". */
function plainAffixLabel(aff) {
  const parts = [];
  for (const key in (aff.b || {})) {
    const v = aff.b[key];
    let name = PLAIN_BONUS_NAME[key];
    if (!name) {
      const save = saveAbilityOf(key);
      const elem = elemTypeOf(key);
      const lvl = slotLevelOf(key);
      if (save) name = (PLAIN_BONUS_NAME[save] || save) + ' Save';
      else if (elem) name = elem.charAt(0).toUpperCase() + elem.slice(1) + ' Damage';
      else if (lvl) name = `Level ${lvl} Spell Slot`;
      else name = key;
    }
    parts.push(`${name} +${v}`);
  }
  return parts.join(', ') || aff.key;
}

/** Editor slot key → the slot name affixes use in their `slots` list. */
function affixSlotKey(slot) { return slot === 'offhand' ? 'shield' : slot; }

/** Does this affix's own slot rule permit the base's slot at all? */
function affixAppliesToSlot(aff, slot) {
  return !aff.slots || aff.slots.includes(affixSlotKey(slot));
}

function renderAffixAllowCheckboxes(slot, base) {
  const host = document.getElementById('affix-allow-groups');
  if (!host) return;
  host.innerHTML = '';

  const allow = base.affixAllow;
  const restricted = Array.isArray(allow);
  const groups = new Map();
  for (const aff of appData.affixes) {
    const g = affixGroupOf(aff);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(aff);
  }

  const order = [...AFFIX_GROUP_ORDER.filter(g => groups.has(g)),
                 ...[...groups.keys()].filter(g => !AFFIX_GROUP_ORDER.includes(g))];

  for (const g of order) {
    const wrap = document.createElement('div');
    wrap.className = 'affix-allow-group';
    const head = document.createElement('div');
    head.className = 'affix-allow-head';
    head.textContent = g;
    wrap.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'affix-allow-grid';
    for (const aff of groups.get(g)) {
      const applies = affixAppliesToSlot(aff, slot);
      const checked = !restricted || allow.includes(aff.key);
      const label = document.createElement('label');
      label.className = 'affix-allow-item' + (applies ? '' : ' is-na');
      /* Flavour name lives in the tooltip — it's what the player sees in-game,
         so it's still worth being able to look up from here. */
      const flavour = `${aff.key} · "${aff.label || aff.key}"`;
      label.title = applies
        ? flavour
        : `${flavour} — never rolls on ${SLOT_LABEL[slot] || slot} regardless of this setting`;
      label.innerHTML =
        `<input type="checkbox" data-affix="${aff.key}" ${checked ? 'checked' : ''}>` +
        `<span>${plainAffixLabel(aff)}</span>`;
      label.querySelector('input').addEventListener('change', commitAffixAllow);
      grid.appendChild(label);
    }
    wrap.appendChild(grid);
    host.appendChild(wrap);
  }

  updateAffixAllowWarning(slot, base);
}

/** Tick or clear every box, then commit. */
function setAllAffixAllow(on) {
  if (!activeSelectedItem) return;
  document.querySelectorAll('#affix-allow-groups input[data-affix]')
    .forEach(b => { b.checked = on; });
  commitAffixAllow();
}

/** Read the checkbox grid back into `base.affixAllow`. */
function commitAffixAllow() {
  if (!activeSelectedItem) return;
  const base = activeSelectedItem.base;
  const host = document.getElementById('affix-allow-groups');
  const boxes = [...host.querySelectorAll('input[data-affix]')];
  const ticked = boxes.filter(b => b.checked).map(b => b.getAttribute('data-affix'));

  if (ticked.length === boxes.length) delete base.affixAllow;   // no restriction
  else base.affixAllow = ticked;

  base._edited = true;
  saveDraft();
  updateAffixAllowWarning(activeSelectedItem.slot, base);
  updateLivePreviewCard();
}

/**
 * Warn when the whitelist has been narrowed so far that the base can't spend its
 * budget: an item with only one or two rollable lines will underspend and read
 * as weak for its item level, which looks like a bug rather than a choice.
 */
function updateAffixAllowWarning(slot, base) {
  const el = document.getElementById('affix-allow-warn');
  if (!el) return;
  const allow = base.affixAllow;
  if (!Array.isArray(allow)) { el.style.display = 'none'; return; }

  const usable = appData.affixes.filter(a =>
    allow.includes(a.key) && affixAppliesToSlot(a, slot)).length;
  if (usable >= 3) {
    el.style.display = 'block';
    el.textContent = `Restricted to ${usable} rollable affixes on this slot.`;
    return;
  }
  el.style.display = 'block';
  el.textContent = usable === 0
    ? '⚠ No affix can roll on this base — it will always drop with its chassis only, at any item level.'
    : `⚠ Only ${usable} affix${usable === 1 ? '' : 'es'} can roll here. High item levels will underspend their budget and feel weak.`;
}

// Bind Form Inputs to State
function setupFormBinders() {
  const onFieldChange = () => {
    if (!activeSelectedItem) return;

    const base = activeSelectedItem.base;
    const oldName = base.name;
    const newName = document.getElementById('inp-item-name').value.trim() || base.name;

    base.name = newName;
    base._edited = true;

    // Slot change
    const newSlot = document.getElementById('inp-item-slot').value;
    if (newSlot !== activeSelectedItem.slot) {
      // Move item between slot arrays
      const oldSlotList = appData.bases[activeSelectedItem.slot];
      oldSlotList.splice(activeSelectedItem.index, 1);

      if (!appData.bases[newSlot]) appData.bases[newSlot] = [];
      appData.bases[newSlot].push(base);

      activeSelectedItem.slot = newSlot;
      activeSelectedItem.index = appData.bases[newSlot].length - 1;
    }

    /* Base items carry NO stat bonuses — `prim` is kept as an empty object only
       so older code paths that read it stay safe. All stats come from affixes. */
    base.prim = {};

    /* Chassis AC: a shield's or helm's own protection. Priced like body armour's
       armorBase and read directly by recalc, never routed through `bonuses`. */
    const acBaseVal = parseInt(document.getElementById('inp-ac-base').value);
    if (!isNaN(acBaseVal) && acBaseVal > 0) base.acBase = acBaseVal;
    else delete base.acBase;

    // 5e Weapon Attributes
    if (activeSelectedItem.slot === 'weapon') {
      base.weaponType = document.getElementById('inp-weapon-type').value;
      base.melee = document.getElementById('inp-weapon-melee').value === 'true';
      base.dmgType = document.getElementById('inp-weapon-dmgtype').value;

      const diceCount = parseInt(document.getElementById('inp-dmg-dice-count').value) || 1;
      const diceSides = parseInt(document.getElementById('inp-dmg-dice-sides').value) || 6;
      base.dmg = [diceCount, diceSides];

      const rangeVal = parseFloat(document.getElementById('inp-weapon-range').value);
      base.range = !isNaN(rangeVal) ? rangeVal : 1.5;

      base.finesse = document.getElementById('chk-finesse').checked;
      base.light = document.getElementById('chk-light').checked;
      base.heavy = document.getElementById('chk-heavy').checked;
      base.versatile = document.getElementById('chk-versatile').checked;
      base.twoHanded = document.getElementById('chk-twoHanded').checked;
      base.reach = document.getElementById('chk-reach').checked;
      base.thrown = document.getElementById('chk-thrown').checked;
      base.focus = document.getElementById('chk-focus').checked;
      base.loading = document.getElementById('chk-loading').checked;
    } else if (activeSelectedItem.slot === 'armor') {
      const ab = parseInt(document.getElementById('inp-armor-base').value);
      if (!isNaN(ab)) base.armorBase = ab;
      else delete base.armorBase;

      base.prof = document.getElementById('inp-armor-prof').value;
    }

    // Visual assets
    base.icon = document.getElementById('inp-icon-path').value.trim();
    base.visualWeapon = document.getElementById('inp-vis-weapon').value.trim() || undefined;
    base.visualShield = document.getElementById('inp-vis-shield').value.trim() || undefined;
    base.visualHelm = document.getElementById('inp-vis-helm').value.trim() || undefined;
    base.visualTorso = document.getElementById('inp-vis-torso').value.trim() || undefined;

    const colText = document.getElementById('inp-vis-color-text').value.trim();
    base.visualColor = colText || undefined;

    saveDraft();
    renderItemList();
    updateLivePreviewCard();
  };

  const inputs = [
    'inp-item-name', 'inp-item-slot',
    'inp-ac-base',
    'inp-weapon-type', 'inp-weapon-melee', 'inp-weapon-dmgtype',
    'inp-dmg-dice-count', 'inp-dmg-dice-sides', 'inp-weapon-range',
    'inp-armor-base', 'inp-armor-prof',
    'inp-icon-path', 'inp-vis-weapon', 'inp-vis-shield', 'inp-vis-helm', 'inp-vis-torso', 'inp-vis-color-text'
  ];

  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', onFieldChange);
  });

  const checkboxes = ['chk-finesse', 'chk-light', 'chk-heavy', 'chk-versatile', 'chk-twoHanded', 'chk-reach', 'chk-thrown', 'chk-focus', 'chk-loading'];
  checkboxes.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', onFieldChange);
  });

  // Hex color picker sync
  document.getElementById('inp-vis-color-hex').addEventListener('input', (e) => {
    document.getElementById('inp-vis-color-text').value = e.target.value;
    onFieldChange();
  });

  // Delete Item Action
  document.getElementById('btn-delete-item').addEventListener('click', handleDeleteSelectedItem);
}

// Render Swatch Palette
function renderColorSwatches() {
  const container = document.getElementById('preset-color-swatches');
  container.innerHTML = '';

  PRESET_COLORS.forEach(color => {
    const s = document.createElement('div');
    s.className = 'swatch';
    s.style.backgroundColor = color;
    s.addEventListener('click', () => {
      document.getElementById('inp-vis-color-text').value = color;
      document.getElementById('inp-vis-color-hex').value = color;
      if (activeSelectedItem) {
        activeSelectedItem.base.visualColor = color;
        activeSelectedItem.base._edited = true;
        saveDraft();
        updateLivePreviewCard();
      }
    });
    container.appendChild(s);
  });
}

// Update Live Item Card Preview
function updateLivePreviewCard() {
  if (!activeSelectedItem) return;

  const { slot, base } = activeSelectedItem;

  document.getElementById('card-title').textContent = base.name;
  document.getElementById('card-subtitle').textContent = `${SLOT_LABEL[slot] || slot} · unlocks ${unlockLabel(slot, base)}`;
  document.getElementById('card-icon-img').src = base.icon || 'dcss/item/weapon/club.png';
  document.getElementById('card-min-floor').textContent = unlockLabel(slot, base);
  renderDerivedUnlock(slot, base);

  // 5e Profile Description
  let profileText = '';
  if (slot === 'weapon') {
    const typeLabel = base.weaponType ? base.weaponType.toUpperCase() : 'SIMPLE';
    const meleeLabel = base.melee !== false ? 'Melee' : 'Ranged';
    const diceStr = base.dmg ? `${base.dmg[0]}d${base.dmg[1]}` : '1d6';
    const dmgTypeStr = base.dmgType || 'slashing';
    profileText = `5e Weapon: ${typeLabel} ${meleeLabel} ${diceStr} ${dmgTypeStr}`;
  } else if (slot === 'armor') {
    const profLabel = base.prof ? base.prof.toUpperCase() : 'NONE';
    profileText = `5e Armor: ${profLabel} (Base AC ${base.armorBase || 11})`;
  } else if (slot === 'kit') {
    profileText = `Adventuring Kit: ${(base.toolSkills || []).map(s => SKILL_LABEL[s] || s).join(', ') || 'General'}`;
  } else {
    profileText = `Equipment Slot: ${SLOT_LABEL[slot] || slot}`;
  }

  document.getElementById('card-5e-profile').textContent = profileText;

  /* Chassis list. Base items carry no stat bonuses, so this shows what the item
     physically IS — the only things charged against its budget. Everything else
     an item ends up with comes from affixes rolled at drop time. */
  const bonusesContainer = document.getElementById('card-bonuses-list');
  bonusesContainer.innerHTML = '';

  const chassis = [];
  if (base.dmg) chassis.push([`${base.dmg[0]}d${base.dmg[1]}`, base.dmgType || 'damage']);
  if (base.armorBase) chassis.push([`AC ${base.armorBase}`, base.prof || 'none']);
  if (base.acBase) chassis.push([`+${base.acBase} AC`, 'shield']);
  if (slot === 'kit' && base.toolSkills) {
    chassis.push([(base.toolSkills.map(s => SKILL_LABEL[s] || s).join(', ')), 'tool']);
  }

  if (!chassis.length) {
    bonusesContainer.innerHTML =
      `<div class="bonus-pill"><span>No chassis</span><span class="bonus-val">0 pts</span></div>`;
  } else {
    chassis.forEach(([what, detail]) => {
      const pill = document.createElement('div');
      pill.className = 'bonus-pill';
      pill.innerHTML = `<span>${what}</span><span class="bonus-val">${detail}</span>`;
      bonusesContainer.appendChild(pill);
    });
  }

  // Estimated value, straight off the item's real point cost
  const G = getTuning().gold;
  const estVal = Math.round(G.flat + baseCost(slot, base) * G.perPoint);
  document.getElementById('card-est-value').textContent = `${estVal}g`;

  // Render Paper-Doll Canvas Sprite Preview
  renderItemSpriteCanvas(base, slot);
}

// Create New Item Base
function handleCreateNewItem() {
  const name = prompt('Enter name for new item base:', 'Custom Artifact');
  if (!name) return;

  const slot = activeSlot !== 'all' ? activeSlot : 'weapon';

  const newBase = {
    name,
    icon: 'dcss/item/weapon/dagger.png',
    prim: { atk: 1, dmg: 1 },
    _custom: true,
    _edited: true
  };

  if (slot === 'weapon') {
    newBase.weaponType = 'simple';
    newBase.melee = true;
    newBase.dmg = [1, 6];
    newBase.dmgType = 'slashing';
  }

  if (!appData.bases[slot]) appData.bases[slot] = [];
  appData.bases[slot].push(newBase);

  activeSelectedItem = { slot, index: appData.bases[slot].length - 1, base: newBase };
  saveDraft();
  renderItemList();
  bindSelectedItemToEditor();
  showToast(`Created new item base: ${name}`);
}

// Delete Selected Item Base
function handleDeleteSelectedItem() {
  if (!activeSelectedItem) return;
  const { slot, index, base } = activeSelectedItem;
  if (!confirm(`Are you sure you want to delete '${base.name}'?`)) return;

  appData.bases[slot].splice(index, 1);

  activeSelectedItem = null;
  saveDraft();
  renderItemList();
  showToast(`Deleted item base: ${base.name}`);
}

// Image Cache for Canvas Sprite Rendering
const imageCache = {};

function loadImage(src) {
  if (imageCache[src]) return Promise.resolve(imageCache[src]);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageCache[src] = img;
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Render Paper-Doll Canvas Sprite Preview
async function renderItemSpriteCanvas(base, slot) {
  const canvas = document.getElementById('card-sprite-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);

  // 1. Draw Base Character Male Body (front-facing, row 2 frame 0)
  const bodyImg = await loadImage('lpc/body/bodies/male/walk.png');
  if (bodyImg) {
    ctx.drawImage(bodyImg, 0, 128, 64, 64, 0, 0, 64, 64);
  }

  // 2. Resolve equipment sprite layer path
  let layerPath = null;
  if (slot === 'weapon' && base.visualWeapon) {
    layerPath = `lpc/weapon/${base.visualWeapon}/walk.png`;
  } else if (slot === 'shield' && base.visualShield) {
    layerPath = `lpc/shield/${base.visualShield}/walk.png`;
  } else if (slot === 'helm' && base.visualHelm) {
    layerPath = `lpc/hat/${base.visualHelm}/walk.png`;
  } else if (slot === 'armor' && base.visualTorso) {
    layerPath = `lpc/torso/${base.visualTorso}/walk.png`;
  } else if (slot === 'boots' && base.visualShoes) {
    layerPath = `lpc/feet/${base.visualShoes}/walk.png`;
  } else if (slot === 'gloves' && base.visualGloves) {
    layerPath = `lpc/${base.visualGloves}/walk.png`;
  }

  const spriteTag = document.getElementById('card-sprite-layer-tag');
  if (spriteTag) {
    const layerName = base.visualWeapon || base.visualShield || base.visualHelm || base.visualTorso || base.visualShoes || base.visualGloves || 'None';
    spriteTag.textContent = `Sprite: ${layerName}`;
    spriteTag.title = `Sprite Layer Path: ${layerPath || 'None'}`;
  }

  if (!layerPath) return;

  let layerImg = await loadImage(layerPath);
  if (!layerImg && slot === 'armor' && base.visualTorso) {
    layerImg = await loadImage(`lpc/torso/${base.visualTorso}/male/walk.png`);
  }
  if (!layerImg && slot === 'helm' && base.visualHelm) {
    layerImg = await loadImage(`lpc/hat/${base.visualHelm}/adult/walk.png`);
  }
  if (!layerImg && slot === 'shield' && base.visualShield) {
    layerImg = await loadImage(`lpc/shield/${base.visualShield}/male/walk.png`);
  }

  if (layerImg) {
    if (base.visualColor && base.visualColor.startsWith('#')) {
      const offCanvas = document.createElement('canvas');
      offCanvas.width = 64;
      offCanvas.height = 64;
      const offCtx = offCanvas.getContext('2d');

      offCtx.drawImage(layerImg, 0, 128, 64, 64, 0, 0, 64, 64);
      offCtx.globalCompositeOperation = 'source-at-top';
      offCtx.fillStyle = base.visualColor;
      offCtx.fillRect(0, 0, 64, 64);
      offCtx.globalCompositeOperation = 'multiply';
      offCtx.drawImage(layerImg, 0, 128, 64, 64, 0, 0, 64, 64);

      ctx.drawImage(offCanvas, 0, 0);
    } else {
      ctx.drawImage(layerImg, 0, 128, 64, 64, 0, 0, 64, 64);
    }
  }
}

// Icon Picker Modal
/* Every icon on disk, fetched once from the dev server. Until it loads (or if it
   fails — a static build has no API) the picker falls back to the shortlist. */
let ICON_LIBRARY = null;

async function loadIconLibrary() {
  if (ICON_LIBRARY) return ICON_LIBRARY;
  try {
    const res = await fetch('/api/list-icons');
    const data = await res.json();
    if (data.success && data.icons.length) ICON_LIBRARY = data.icons;
  } catch { /* static build — shortlist it is */ }
  if (!ICON_LIBRARY) ICON_LIBRARY = COMMON_DCSS_ICONS;
  return ICON_LIBRARY;
}

function openIconPickerModal() {
  document.getElementById('icon-picker-modal').style.display = 'flex';
  renderIconGrid();
  /* Swap the shortlist for the full library as soon as it arrives. */
  if (!ICON_LIBRARY) loadIconLibrary().then(renderIconGrid);
}

function closeIconPickerModal() {
  document.getElementById('icon-picker-modal').style.display = 'none';
}

function renderIconGrid() {
  const query = document.getElementById('icon-search-input').value.toLowerCase().trim();
  const grid = document.getElementById('icon-picker-grid');
  grid.innerHTML = '';

  const all = ICON_LIBRARY || COMMON_DCSS_ICONS;
  const matched = all.filter(path => !query || path.toLowerCase().includes(query));
  /* The full library is ~1200 tiles; render a page of them and let the search
     box narrow it rather than hanging the browser on every open. */
  const LIMIT = 400;
  const icons = matched.slice(0, LIMIT);

  const count = document.getElementById('icon-picker-count');
  if (count) {
    count.textContent = matched.length > LIMIT
      ? `Showing ${LIMIT} of ${matched.length} icons — search to narrow`
      : `${matched.length} icon${matched.length === 1 ? '' : 's'}`;
  }

  icons.forEach(path => {
    const item = document.createElement('div');
    item.className = 'icon-grid-item';
    item.innerHTML = `<img src="${path}" title="${path}">`;
    item.addEventListener('click', () => {
      document.getElementById('inp-icon-path').value = path;
      if (activeSelectedItem) {
        activeSelectedItem.base.icon = path;
        activeSelectedItem.base._edited = true;
        saveDraft();
        updateLivePreviewCard();
        renderItemList();
      }
      closeIconPickerModal();
    });
    grid.appendChild(item);
  });
}

// LPC Sprite Layer Picker Modal
const KNOWN_LPC_LAYERS = [
  // Weapons
  { cat: 'weapon', name: 'Longsword', key: 'sword/longsword', path: 'lpc/weapon/sword/longsword/walk.png' },
  { cat: 'weapon', name: 'Dagger', key: 'sword/dagger', path: 'lpc/weapon/sword/dagger/walk.png' },
  { cat: 'weapon', name: 'Rapier', key: 'sword/rapier', path: 'lpc/weapon/sword/rapier/walk.png' },
  { cat: 'weapon', name: 'Katana', key: 'sword/katana', path: 'lpc/weapon/sword/katana/walk.png' },
  { cat: 'weapon', name: 'Saber', key: 'sword/saber', path: 'lpc/weapon/sword/saber/walk.png' },
  { cat: 'weapon', name: 'Scimitar', key: 'sword/scimitar', path: 'lpc/weapon/sword/scimitar/walk.png' },
  { cat: 'weapon', name: 'Arming Sword', key: 'sword/arming', path: 'lpc/weapon/sword/arming/walk.png' },
  { cat: 'weapon', name: 'Mace', key: 'blunt/mace', path: 'lpc/weapon/blunt/mace/walk.png' },
  { cat: 'weapon', name: 'Hammer', key: 'blunt/hammer', path: 'lpc/weapon/blunt/hammer/walk.png' },
  { cat: 'weapon', name: 'Waraxe', key: 'blunt/waraxe', path: 'lpc/weapon/blunt/waraxe/walk.png' },
  { cat: 'weapon', name: 'Flail', key: 'blunt/flail', path: 'lpc/weapon/blunt/flail/walk.png' },
  { cat: 'weapon', name: 'Spear', key: 'polearm/spear', path: 'lpc/weapon/polearm/spear/walk.png' },
  { cat: 'weapon', name: 'Halberd', key: 'polearm/halberd', path: 'lpc/weapon/polearm/halberd/walk.png' },
  { cat: 'weapon', name: 'Scythe', key: 'polearm/scythe', path: 'lpc/weapon/polearm/scythe/walk.png' },
  { cat: 'weapon', name: 'Bow', key: 'ranged/bow', path: 'lpc/weapon/ranged/bow/walk.png' },
  { cat: 'weapon', name: 'Crossbow', key: 'ranged/crossbow', path: 'lpc/weapon/ranged/crossbow/walk.png' },
  { cat: 'weapon', name: 'Wand', key: 'magic/wand', path: 'lpc/weapon/magic/wand/walk.png' },
  // Shields
  { cat: 'shield', name: 'Round Shield', key: 'round', path: 'lpc/shield/round/walk.png' },
  { cat: 'shield', name: 'Kite Shield', key: 'kite', path: 'lpc/shield/kite/walk.png' },
  { cat: 'shield', name: 'Heater Shield', key: 'heater', path: 'lpc/shield/heater/walk.png' },
  { cat: 'shield', name: 'Tower Shield', key: 'crusader/fg', path: 'lpc/shield/crusader/fg/male/walk.png' },
  // Helms
  { cat: 'helm', name: 'Barbuta', key: 'helmet/barbuta', path: 'lpc/hat/helmet/barbuta/walk.png' },
  { cat: 'helm', name: 'Bascinet', key: 'helmet/bascinet', path: 'lpc/hat/helmet/bascinet/walk.png' },
  { cat: 'helm', name: 'Kettle Helm', key: 'helmet/kettle', path: 'lpc/hat/helmet/kettle/walk.png' },
  { cat: 'helm', name: 'Horned Helm', key: 'helmet/horned', path: 'lpc/hat/helmet/horned/walk.png' },
  { cat: 'helm', name: 'Spangenhelm', key: 'helmet/spangenhelm', path: 'lpc/hat/helmet/spangenhelm/walk.png' },
  { cat: 'helm', name: 'Armet', key: 'helmet/armet', path: 'lpc/hat/helmet/armet/walk.png' },
  { cat: 'helm', name: 'Greathelm', key: 'helmet/greathelm', path: 'lpc/hat/helmet/greathelm/walk.png' },
  { cat: 'helm', name: 'Mail Coif', key: 'helmet/mail', path: 'lpc/hat/helmet/mail/walk.png' },
  { cat: 'helm', name: 'Leather Cap', key: 'cloth/leather_cap', path: 'lpc/hat/cloth/leather_cap/walk.png' },
  { cat: 'helm', name: 'Wizard Hat', key: 'magic/large', path: 'lpc/hat/magic/large/walk.png' },
  { cat: 'helm', name: 'Tricorne', key: 'pirate/tricorne/basic', path: 'lpc/hat/pirate/tricorne/basic/walk.png' },
  // Torsos / Armor
  { cat: 'torso', name: 'Plate Armor', key: 'armour/plate', path: 'lpc/torso/armour/plate/walk.png' },
  { cat: 'torso', name: 'Leather Armor', key: 'armour/leather', path: 'lpc/torso/armour/leather/walk.png' },
  { cat: 'torso', name: 'Chainmail', key: 'chainmail', path: 'lpc/torso/chainmail/walk.png' },
  { cat: 'torso', name: 'Legion Armor', key: 'armour/legion', path: 'lpc/torso/armour/legion/walk.png' },
  { cat: 'torso', name: 'Robe', key: 'clothes/robe', path: 'lpc/torso/clothes/robe/walk.png' },
  { cat: 'torso', name: 'Sleeveless Tunic', key: 'clothes/sleeveless', path: 'lpc/torso/clothes/sleeveless/walk.png' },
  { cat: 'torso', name: 'Leather Vest', key: 'clothes/vest', path: 'lpc/torso/clothes/vest/walk.png' },
  // Shoes / Feet
  { cat: 'shoes', name: 'Basic Boots', key: 'shoes/basic', path: 'lpc/feet/shoes/basic/walk.png' },
  { cat: 'shoes', name: 'Rimmed Boots', key: 'boots/rimmed', path: 'lpc/feet/boots/rimmed/walk.png' },
  { cat: 'shoes', name: 'Folded Boots', key: 'boots/fold', path: 'lpc/feet/boots/fold/walk.png' },
  { cat: 'shoes', name: 'Sandals', key: 'sandals', path: 'lpc/feet/sandals/walk.png' },
  { cat: 'shoes', name: 'Plate Greaves', key: 'armour/plate', path: 'lpc/feet/armour/plate/walk.png' },
  // Gloves
  { cat: 'gloves', name: 'Leather Gloves', key: 'arms/hands/gloves', path: 'lpc/arms/hands/gloves/male/walk.png' },
  { cat: 'gloves', name: 'Leather Bracers', key: 'arms/bracers', path: 'lpc/arms/bracers/male/walk.png' },
  { cat: 'gloves', name: 'Plate Gauntlets', key: 'arms/armour/plate', path: 'lpc/arms/armour/plate/male/walk.png' }
];

function openLpcPickerModal() {
  document.getElementById('lpc-picker-modal').style.display = 'flex';
  renderLpcGrid();
}

function closeLpcPickerModal() {
  document.getElementById('lpc-picker-modal').style.display = 'none';
}

function renderLpcGrid() {
  const query = document.getElementById('lpc-search-input').value.toLowerCase().trim();
  const catFilter = document.getElementById('lpc-category-select').value;
  const grid = document.getElementById('lpc-picker-grid');
  grid.innerHTML = '';

  const layers = KNOWN_LPC_LAYERS.filter(item => {
    if (catFilter !== 'all' && item.cat !== catFilter) return false;
    if (query && !item.name.toLowerCase().includes(query) && !item.key.toLowerCase().includes(query)) return false;
    return true;
  });

  layers.forEach(item => {
    const card = document.createElement('div');
    card.style.background = 'var(--bg-card)';
    card.style.border = '1px solid var(--border)';
    card.style.borderRadius = '6px';
    card.style.padding = '8px';
    card.style.cursor = 'pointer';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.alignItems = 'center';

    card.innerHTML = `
      <div style="width:48px;height:48px;background:var(--bg-input);border-radius:4px;overflow:hidden;margin-bottom:6px;display:flex;align-items:center;justify-content:center">
        <canvas class="lpc-thumb-canvas" width="64" height="64" style="width:48px;height:48px;image-rendering:pixelated"></canvas>
      </div>
      <span style="font-size:11px;font-weight:600;color:var(--text-main);text-align:center;word-break:break-word">${item.name}</span>
      <span style="font-size:9px;color:var(--text-muted);margin-top:2px">${item.key}</span>
    `;

    const cvs = card.querySelector('.lpc-thumb-canvas');
    if (cvs) {
      const ctx = cvs.getContext('2d');
      loadImage('lpc/body/bodies/male/walk.png').then(bodyImg => {
        if (bodyImg) ctx.drawImage(bodyImg, 0, 128, 64, 64, 0, 0, 64, 64);
        loadImage(item.path).then(lImg => {
          if (lImg) ctx.drawImage(lImg, 0, 128, 64, 64, 0, 0, 64, 64);
        });
      });
    }

    card.addEventListener('click', () => {
      if (!activeSelectedItem) return;
      const base = activeSelectedItem.base;

      if (item.cat === 'weapon') {
        base.visualWeapon = item.key;
        document.getElementById('inp-vis-weapon').value = item.key;
      } else if (item.cat === 'shield') {
        base.visualShield = item.key;
        document.getElementById('inp-vis-shield').value = item.key;
      } else if (item.cat === 'helm') {
        base.visualHelm = item.key;
        document.getElementById('inp-vis-helm').value = item.key;
      } else if (item.cat === 'torso') {
        base.visualTorso = item.key;
        document.getElementById('inp-vis-torso').value = item.key;
      } else if (item.cat === 'shoes') {
        base.visualShoes = item.key;
      } else if (item.cat === 'gloves') {
        base.visualGloves = item.key;
      }

      base._edited = true;
      saveDraft();
      updateLivePreviewCard();
      closeLpcPickerModal();
      showToast(`Selected sprite layer: ${item.key}`);
    });

    grid.appendChild(card);
  });
}

// Custom Sprite Uploader
async function handleSpriteUpload() {
  const fileInput = document.getElementById('inp-upload-file');
  const file = fileInput.files[0];
  if (!file) {
    alert('Please select an image file to upload.');
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    try {
      const res = await fetch('/api/upload-sprite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, dataUrl })
      });
      const data = await res.json();
      if (data.success) {
        document.getElementById('inp-icon-path').value = data.spritePath;
        if (activeSelectedItem) {
          activeSelectedItem.base.icon = data.spritePath;
          activeSelectedItem.base._edited = true;
          saveDraft();
          updateLivePreviewCard();
          renderItemList();
        }
        showToast('Uploaded sprite successfully!');
      } else {
        alert(`Upload error: ${data.error}`);
      }
    } catch (err) {
      alert(`Failed to upload sprite: ${err.message}`);
    }
  };
  reader.readAsDataURL(file);
}

// Render Perks & Affixes Manager
function renderPerksAndAffixes() {
  const perksContainer = document.getElementById('perks-list-container');
  perksContainer.innerHTML = '';

  for (const perkId in appData.perks) {
    const perk = appData.perks[perkId];
    const div = document.createElement('div');
    div.style.background = 'var(--bg-card)';
    div.style.border = '1px solid var(--border)';
    div.style.borderRadius = '8px';
    div.style.padding = '12px';

    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <strong style="color:var(--violet);font-size:14px">${perk.name}</strong>
        <span style="font-size:11px;color:var(--text-muted)">${(perk.slots || []).join(', ')}</span>
      </div>
      <p style="font-size:12px;color:var(--text-main);margin-bottom:8px">${perk.desc}</p>
      <div style="display:flex;gap:6px">
        <button class="btn btn-xs" data-edit-perk="${perkId}">Edit Perk</button>
      </div>
    `;

    div.querySelector(`[data-edit-perk="${perkId}"]`).addEventListener('click', () => {
      const newDesc = prompt(`Edit description for perk '${perk.name}':`, perk.desc);
      if (newDesc !== null) {
        perk.desc = newDesc;
        saveDraft();
        renderPerksAndAffixes();
        showToast(`Updated perk: ${perk.name}`);
      }
    });

    perksContainer.appendChild(div);
  }

  // Affixes list
  const affixesContainer = document.getElementById('affixes-list-container');
  affixesContainer.innerHTML = '';

  (appData.affixes || []).forEach(aff => {
    const div = document.createElement('div');
    div.style.background = 'var(--bg-card)';
    div.style.border = '1px solid var(--border)';
    div.style.borderRadius = '6px';
    div.style.padding = '8px 12px';
    div.style.display = 'flex';
    div.style.justifyContent = 'space-between';
    div.style.alignItems = 'center';
    div.style.fontSize = '12px';

    const statKey = Object.keys(aff.b || {})[0] || 'stat';
    const statVal = aff.b[statKey];

    div.innerHTML = `
      <span><strong style="color:var(--gold)">${aff.label}</strong> (+${statVal} ${statKey.toUpperCase()})</span>
      <span style="font-size:10px;color:var(--text-muted);background:var(--bg-input);padding:2px 6px;border-radius:4px">Key: ${aff.key}</span>
    `;

    affixesContainer.appendChild(div);
  });
}

function handleAddPerk() {
  const name = prompt('Enter new Legendary Perk name:', 'Soul Siphon');
  if (!name) return;

  const id = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const desc = prompt('Enter perk description:', 'Heal 5% HP on spell kill.');

  appData.perks[id] = {
    id,
    name,
    desc: desc || '',
    hooks: ['onHit'],
    slots: ['weapon']
  };

  saveDraft();
  renderPerksAndAffixes();
  showToast(`Added custom perk: ${name}`);
}

// Drop Simulator Functions
function renderSimulator() {
  updateSimulatorChart();
  runSimRolls(12);
}

function updateSimulatorChart() {
  const tier = parseInt(document.getElementById('sim-floor-range').value) || 1;
  const luck = parseFloat(document.getElementById('sim-floor-boost').value) || 1;

  const container = document.getElementById('sim-rarity-bars');
  container.innerHTML = '';

  // Roll sample items to compute rarity distribution
  const counts = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
  const SAMPLES = 500;

  for (let i = 0; i < SAMPLES; i++) {
    const item = rollItem(tier, Math.random, null, { source: 'chest', luck });
    if (item && counts[item.rarity] !== undefined) counts[item.rarity]++;
  }

  RARITY_ORDER.forEach(rKey => {
    const count = counts[rKey] || 0;
    const pct = ((count / SAMPLES) * 100).toFixed(1);
    const rDef = RARITIES[rKey] || { name: rKey, color: '#fff' };

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '10px';
    row.style.fontSize = '12px';

    row.innerHTML = `
      <span style="width:90px;font-weight:600;color:${rDef.color}">${rKey.toUpperCase()}</span>
      <div style="flex:1;height:12px;background:var(--bg-input);border-radius:6px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${rDef.color};transition:width 0.3s"></div>
      </div>
      <span style="width:50px;text-align:right;color:var(--text-muted)">${pct}%</span>
    `;

    container.appendChild(row);
  });
}

function runSimRolls(count = 12) {
  const tier = parseInt(document.getElementById('sim-floor-range').value) || 1;
  const luck = parseFloat(document.getElementById('sim-floor-boost').value) || 1;
  const grid = document.getElementById('sim-results-grid');
  grid.innerHTML = '';

  for (let i = 0; i < count; i++) {
    const item = rollItem(tier, Math.random, null, { source: 'chest', luck });
    if (!item) continue;

    const rDef = RARITIES[item.rarity] || { color: '#fff' };
    const card = document.createElement('div');
    card.className = 'sim-card';
    card.style.borderColor = rDef.color;

    const bonusSummary = bonusText(item);
    const budget = itemBudget(item.slot, item.ilvl, item.rarity);
    const spend = itemSpend(item);

    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <img src="${item.icon || 'dcss/item/weapon/club.png'}" style="width:28px;height:28px;object-fit:contain;image-rendering:pixelated">
        <strong style="color:${rDef.color};font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.name}</strong>
      </div>
      <div style="font-size:11px;color:var(--text-muted)">ilvl ${item.ilvl} · ${item.slot.toUpperCase()} · <span style="color:${spend > budget ? 'var(--red)' : 'var(--text-muted)'}">${spend}/${budget} pts</span></div>
      <div style="font-size:11px;color:var(--gold);margin-top:4px">${bonusSummary || 'Standard Stats'}</div>
      ${item.perk ? `<div style="font-size:10px;color:var(--violet);margin-top:4px">★ ${item.perk.name}: ${item.perk.desc}</div>` : ''}
      <div style="font-size:10px;color:var(--cyan);margin-top:6px;text-align:right">Value: ${item.value || 0}g</div>
    `;

    grid.appendChild(card);
  }
}

// Server Save API Call (/api/save-items)
async function handleSaveToProject() {
  try {
    const res = await fetch('/api/save-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(appData)
    });
    const data = await res.json();
    if (data.success) {
      showToast('💾 Saved items.json directly to project codebase!');
    } else {
      alert(`Save error: ${data.error}`);
    }
  } catch (err) {
    alert(`Failed to save to project: ${err.message}`);
  }
}

// Export JSON Backup File
function handleExportJSON() {
  const jsonStr = JSON.stringify(appData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `dungeon_crawlers_items_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported items JSON backup!');
}

// Import JSON Backup File
function handleImportJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';

  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (imported.bases) {
          appData = imported;
          saveDraft();
          renderItemList();
          renderPerksAndAffixes();
          renderSimulator();
          showToast('Successfully imported item dataset!');
        } else {
          alert('Invalid items JSON structure.');
        }
      } catch (err) {
        alert(`JSON parse error: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  input.click();
}

// Reset to Defaults
function handleResetDefaults() {
  if (!confirm('Are you sure you want to discard all local changes and reset loot data back to project defaults?')) return;
  localStorage.removeItem(DRAFT_STORAGE_KEY);
  appData = JSON.parse(JSON.stringify(DEFAULT_ITEMS_DATA));
  activeSelectedItem = null;
  renderItemList();
  renderPerksAndAffixes();
  renderSimulator();
  showToast('Reset all loot items back to defaults.');
}

/**
 * Read-only "what this base costs and when it unlocks" readout, replacing the
 * old editable MIN DROP FLOOR field.
 *
 * Under the budget system a base has no stored unlock level. Its cost is
 * charged against the item budget, so the level it starts appearing at is a
 * CONSEQUENCE of its stats — raise its damage die or its `prim` block and it
 * drops later, all by itself. Showing it as an editable number would imply a
 * knob that no longer exists.
 */
function renderDerivedUnlock(slot, base) {
  const host = document.getElementById('derived-unlock');
  if (!host) return;
  const cost = baseCost(slot, base);
  const lvl = unlockIlvl(slot, base);
  const budgetAt = lvl == null ? null : itemBudget(slot, lvl, 'common');
  host.innerHTML =
    '<div class="derived-row"><span>Base cost</span><b>' + cost + ' pts</b></div>'
    + '<div class="derived-row"><span>Unlocks at</span><b>'
    + (lvl == null
        ? '<span style="color:var(--red)">never as common</span>'
        : 'ilvl ' + lvl + ' <span style="opacity:.6">(budget ' + budgetAt + ')</span>')
    + '</b></div>';
}
