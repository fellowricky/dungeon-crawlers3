/**
 * World Map / Quest selection overlay, now with Shop and Tavern tabs.
 */
import { generateQuests } from './quests.js';
import { showLoadingScreenPainted, hideLoadingScreen } from '../ui/loading_screen.js';
import { prologueSummary } from './overland_prologue.js';
import { WORLD, HUB } from './world_regions.js';
import { THEMES } from '../dungeon/dungeon_generator.js';
import { storyMissionState, makeStoryQuest } from './story.js';
import { showBriefing } from './story_dialog.js';
import { getSequelOffers } from './quest_events.js';
import { rollItem, itemPoints, makeDye, perkText, bonusText, ilvlText, migrateItem, addToInventory, qtyOf, weaponKindOf, isSalvageable } from './items.js';
import { SPELLS } from './spells.js';
import { EFFECTS } from './conditions.js';
import { makeHero, normalizeHero, RACES, CLASSES, PLAYABLE_RACES, PLAYABLE_CLASSES,
         ABILITIES, XP_TABLE, grantXp, getDefaultProficiencies } from './srd.js';
import { drawHeroPortrait } from './sprite_animator.js';
import { HAIR_VALUES, HAIR_EXTENSION_VALUES, FACIAL_HAIR_VALUES, HAIR_COLORS,
         skinColorsFor, getRaceDefaults } from './appearance.js';
import { log, updateResources } from './ui.js';
import { playNarration, stopNarration } from './audio.js';
import { refreshMenus, openMenu, bindItemHoverTooltip, hideItemTooltip } from './menus.js';
import { FACILITY_DEFINITIONS,
         TECH_TREE, RUNE_RECIPES, SLAYING_ORDERS, BATTLE_DOCTRINES, EXPEDITION_TEMPLATES,
         TRAINING_GEAR, trainingFloorsForGain } from './guild.js';
import { showSaveSlotsModal } from './ui_save_slots.js';
import { getActiveSlot } from './save_slots.js';
import { firstRunTip } from './help_ui.js';

let G = null;
let open = false;
let quests = [];
let selected = null;

let currentTab = 'map';
let selStory = null;
let selShopItem = null;
let activeShopFilter = 'all';
let selTavernHero = null;
let selTavernHeroType = null; // 'active' | 'stored' | 'hire'
let craftSelectedSlot = 'weapon';
let craftSelectedBase = null; // base name, or null = smith's choice
let craftTargetPS = 30;
let selSalvageItem = null;
let salvagePSThreshold = 30;

const $ = id => document.getElementById(id);
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

function partyLevel() {
  if (!G?.heroes?.length) return 1;
  return Math.max(1, Math.round(
    G.heroes.reduce((s, h) => s + (h.data.level || 1), 0) / G.heroes.length
  ));
}

function itemIconHTML(icon, className="") {
  if (icon && icon.includes('/')) {
    const cls = className ? `item-ico ${className}` : 'item-ico';
    return `<img class="${cls}" src="./${icon}" style="image-rendering:pixelated;vertical-align:middle;margin-right:4px;" />`;
  }
  return icon || '';
}

export function initWorldMap(game) {
  G = game;
  const btn = $('wm-embark-btn');
  if (btn) btn.addEventListener('click', embarkSelected);

  const storyBtn = $('wm-story-embark-btn');
  if (storyBtn) storyBtn.addEventListener('click', embarkStory);

  const partyBtn = $('wm-party-btn');
  if (partyBtn) partyBtn.addEventListener('click', () => openMenu('equip'));

  initSystemMenu();

  // Set up tab event listeners
  const tabs = document.querySelectorAll('.wm-tab');
  tabs.forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabBtn.classList.add('active');

      const panels = document.querySelectorAll('.wm-panel');
      panels.forEach(p => p.classList.remove('active'));

      const activeTab = tabBtn.dataset.tab;
      const targetPanel = $('wm-panel-' + activeTab);
      if (targetPanel) targetPanel.classList.add('active');

      renderActiveTab(activeTab);
    });
  });

  // Set up shop filter event listeners
  const filterBar = $('wm-shop-filter-bar');
  if (filterBar) {
    const filterBtns = filterBar.querySelectorAll('.wm-filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeShopFilter = btn.dataset.filter;
        renderShopPanel();
      });
    });
  }
}

/* ===== System menu (save / options / quit to title) ===== */
function initSystemMenu() {
  const menu = $('wm-sysmenu');
  const openBtn = $('wm-menu-btn');
  if (!menu || !openBtn) return;

  const toast = $('sys-menu-toast');

  let toastTimer = null;
  const flash = msg => {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
  };

  const closeMenu = () => menu.classList.remove('show');

  /* Volume lives in the Options panel now (the ⚙ Options button in this menu). */
  openBtn.addEventListener('click', () => {
    if (toast) toast.classList.remove('show');
    const slotNameEl = $('sys-active-slot-name');
    if (slotNameEl) {
      const activeId = G?.activeSaveSlot || getActiveSlot();
      slotNameEl.textContent = `Slot ${activeId}`;
    }
    menu.classList.add('show');
  });

  const saveBtn = $('sys-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', () => {
    if (G) { G.saveGame(); flash('Game saved.'); }
  });

  const slotsBtn = $('sys-slots-btn');
  if (slotsBtn) slotsBtn.addEventListener('click', () => {
    closeMenu();
    showSaveSlotsModal({
      mode: 'load',
      onSelect: (slotId, isNew) => {
        if (isNew) {
          if (G && typeof G.startNewPartyInSlot === 'function') {
            G.startNewPartyInSlot(slotId);
          } else {
            location.reload();
          }
        } else {
          if (G && typeof G.loadAndSwitchSlot === 'function') {
            G.loadAndSwitchSlot(slotId);
          } else {
            location.reload();
          }
        }
      },
      onCancel: () => {
        menu.classList.add('show');
      }
    });
  });

  const resumeBtn = $('sys-resume-btn');
  if (resumeBtn) resumeBtn.addEventListener('click', closeMenu);

  const quitBtn = $('sys-quit-btn');
  if (quitBtn) quitBtn.addEventListener('click', () => {
    if (G) G.saveGame();
    /* reload boots back into the title/setup screen; the save we just wrote
       lights up its Continue button. */
    location.reload();
  });

  /* click the dimmed backdrop (outside the panel) to dismiss */
  menu.addEventListener('click', e => { if (e.target === menu) closeMenu(); });
  /* Escape closes the menu if it's open */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && menu.classList.contains('show')) {
      e.stopPropagation();
      closeMenu();
    }
  });
}

export function showWorldMap(opts = {}) {
  if (!G) return;
  open = true;
  selected = null;
  selShopItem = null;
  selTavernHero = null;
  selTavernHeroType = null;
  G.setPaused(true);

  const refresh = opts.refresh !== false;

  // 1. Generate quests — 6 offers with a level-band contract:
  //    1 below party level, 4 at level, 1 above. Chain sequels (max 2)
  //    consume the band slot matching their own level so the contract
  //    holds as closely as possible across the full offering.
  if (refresh || !quests.length) {
    const pl = partyLevel();
    const QUEST_OFFER_COUNT = 6;
    const bands = [-1, 1, 0, 0, 0, 0];
    const sequels = getSequelOffers(G, pl).slice(0, 2);
    for (const s of sequels) {
      const off = Math.max(-1, Math.min(1, (s.level || pl) - pl));
      const idx = bands.indexOf(off);
      bands.splice(idx >= 0 ? idx : bands.indexOf(0), 1);
    }
    quests = [
      ...sequels,
      ...generateQuests(pl, QUEST_OFFER_COUNT - sequels.length, {
        excludePositions: sequels.map(s => s.mapLocation).filter(p => p && typeof p.x === 'number' && typeof p.y === 'number'),
        levelOffsets: bands,
        legendaryPity: G.legendaryPity | 0
      })
    ];
  }

  // 2. Generate town shop stock
  if (refresh || !G.townShopInventory || !G.townShopInventory.length) {
    const pLevel = partyLevel();
    const shopInventory = [];
    shopInventory.push({ type: 'potion', kind: 'heal', name: 'Healing Potion', icon: '🧪', price: 100, desc: 'Heals the most wounded hero (2d4+2)' });
    shopInventory.push({ type: 'potion', kind: 'greater', name: 'Greater Healing Potion', icon: '⚗️', price: 350, desc: 'Greater healing (4d4+4)' });

    const RARITY_MARKUP = { common: 4, uncommon: 7, rare: 12, epic: 20, legendary: 35 };
    const numItems = 24 + Math.floor(Math.random() * 7);
    for (let i = 0; i < numItems; i++) {
      const item = rollItem(pLevel, Math.random, null, { source: 'chest' });
      /* Consumables (scrolls/potions) are bought to be USED, so they get a thin
         fixed markup instead of the gear rarity multiplier. */
      const markup = item.slot === 'trinket' ? 1.8 : (RARITY_MARKUP[item.rarity] || 4);
      shopInventory.push({ type: 'gear', item: item, price: Math.round(item.value * markup) });
    }
    /* Weapon guarantee: the random slot spread averages only ~3-4 weapons per
       restock, which feels bad for martial classes shopping for an upgrade.
       Top up to a minimum of 10 weapons on the shelf by force-rolling the
       weapon slot until the count is met. */
    const MIN_WEAPONS = 10;
    const weaponCount = shopInventory.filter(o => o.type === 'gear' && o.item && o.item.slot === 'weapon').length;
    for (let i = weaponCount; i < MIN_WEAPONS; i++) {
      const item = rollItem(pLevel, Math.random, 'weapon', { source: 'chest' });
      const markup = RARITY_MARKUP[item.rarity] || 4;
      shopInventory.push({ type: 'gear', item: item, price: Math.round(item.value * markup) });
    }
    /* …and within those, a floor on ranged weapons and wands. Nine of the
       fifty weapon bases are ranged, so a ten-weapon shelf routinely had no
       bow at all — and a ranger who sold theirs had nowhere to buy one. */
    const MIN_BY_KIND = { ranged: 3, focus: 2 };
    for (const [kind, min] of Object.entries(MIN_BY_KIND)) {
      const have = shopInventory.filter(o => o.type === 'gear' && o.item && o.item.slot === 'weapon' && weaponKindOf(o.item) === kind).length;
      for (let i = have; i < min; i++) {
        const item = rollItem(pLevel, Math.random, 'weapon', { source: 'chest', weaponKind: kind });
        if (!item) break;
        const markup = RARITY_MARKUP[item.rarity] || 4;
        shopInventory.push({ type: 'gear', item: item, price: Math.round(item.value * markup) });
      }
    }
    /* 6-8 dyes on the shelf — cosmetic recolors for equipped gear */
    const numDyes = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numDyes; i++) {
      const dye = makeDye();
      shopInventory.push({ type: 'gear', item: dye, price: dye.value * 3 });
    }
    G.townShopInventory = shopInventory;
  }

  // 3. Generate town tavern hire pool
  if (refresh || !G.townTavernHirePool || !G.townTavernHirePool.length) {
    const pLevel = partyLevel();
    const hirePool = [];
    for (let i = 0; i < 3; i++) {
      const hireLevel = Math.max(1, pLevel - 1 + Math.floor(Math.random() * 2));
      hirePool.push(generateRandomHeroForHire(hireLevel));
    }
    G.townTavernHirePool = hirePool;
  }

  const screen = $('worldmapscreen');
  if (screen) screen.classList.add('show');

  // Go to Quests tab by default
  const tabs = document.querySelectorAll('.wm-tab');
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'map'));

  const panels = document.querySelectorAll('.wm-panel');
  panels.forEach(p => p.classList.toggle('active', p.id === 'wm-panel-map'));

  renderActiveTab('map');

  /* The map is the landing pad for every non-dungeon entry point (new party
     after the intro crawl, resuming a save that is between quests). Those
     paths raise the loading curtain but have no floor load to lower it, so
     drop it here now that the map is built. No-ops when nothing raised it. */
  hideLoadingScreen();
}

export function hideWorldMap() {
  open = false;
  stopNarration();   // cut any mission-briefing voice-over
  const screen = $('worldmapscreen');
  if (screen) screen.classList.remove('show');
  if (G) G.setPaused(false);
}

/** Re-render the active map tab (e.g. after gear changed in the character
 *  menu while it was open over the world map — keeps the sell grid fresh). */
export function refreshWorldMapPanel() {
  if (open) renderActiveTab(currentTab);
}

function renderActiveTab(tab) {
  currentTab = tab;
  // Update header gold for all screens
  const goldVal = $('wm-header-gold-val');
  if (goldVal) goldVal.textContent = G.gold;

  if (tab === 'map') {
    renderNodes();
    if (selected) renderDetail(selected);
    else showPlaceholder();
  } else if (tab === 'story') {
    renderStoryPanel();
  } else if (tab === 'shop') {
    renderShopPanel();
  } else if (tab === 'guild' || tab === 'tavern') {
    renderGuildPanel();
  }
}

/* The guild's own marker on the map, at the heart of the painted holdfast
   (world_regions.HUB). Every quest's road starts here; clicking it opens the
   Guild tab. */
function hubNodeHTML() {
  return `<div class="wm-hub-node" id="wm-hub-node" style="left:${HUB.x}%; top:${HUB.y}%;" title="The Guildhall — every road starts here">
    <div class="wm-hub-icon">⌂</div>
    <div class="wm-hub-label">The Guildhall</div>
  </div>`;
}

/**
 * Draw the selected quest's road on the map: one dashed stretch per day,
 * tinted by the biome that day's overland floor uses, with a camp dot where
 * each day ends. Quests without a route (saved before the painted map) draw nothing.
 */
function renderRoute(q) {
  const svg = $('wm-route-layer');
  if (!svg) return;
  svg.setAttribute('viewBox', `0 0 ${WORLD.cols} ${WORLD.rows}`);
  const route = q && q.route;
  if (!route || !Array.isArray(route.path) || route.path.length < 4) { svg.innerHTML = ''; return; }
  const pts = [];
  for (let i = 0; i < route.path.length; i += 2) pts.push([route.path[i] + 0.5, route.path[i + 1] + 0.5]);
  const ends = [...(route.camps || []), pts.length - 1];
  let html = '', start = 0;
  ends.forEach((end, d) => {
    const colour = THEMES[route.legs[d]]?.accent || '#d7c18f';
    const seg = pts.slice(start, end + 1).map(p => p.join(',')).join(' ');
    html += `<polyline class="wm-route-day" points="${seg}" stroke="${colour}" />`;
    start = end;
  });
  for (const k of route.camps || []) {
    const [x, y] = pts[k];
    html += `<circle class="wm-route-camp" cx="${x}" cy="${y}" r="0.45" fill="#e2cc97" />`;
  }
  svg.innerHTML = html;
}

function renderNodes() {
  const root = $('wm-quest-nodes');
  if (!root) return;
  const stage = $('wm-map-stage');
  if (stage) stage.style.setProperty('--map-aspect', String(WORLD.art.w / WORLD.art.h));
  renderRoute(selected);
  root.innerHTML = hubNodeHTML() + quests.map((q, i) => {
    const loc = (q && q.mapLocation && typeof q.mapLocation.x === 'number' && typeof q.mapLocation.y === 'number')
      ? q.mapLocation
      : { x: 20 + (i * 12) % 60, y: 30 + (i * 15) % 40 };
    const leg = q.isLegendaryReward ? ' legendary-quest' : '';
    const chain = q.chain ? ' chain-quest' : '';
    const chainTag = q.chain ? (q.chain.part === 2 ? 'Ⅱ ' : 'Ⅲ ') : '';
    return `<div class="quest-node theme-${q.theme}${leg}${chain}${selected === q ? ' active' : ''}"
      data-i="${i}" style="left:${loc.x}%; top:${loc.y}%;">
      <div class="quest-node-pulse"></div>
      <div class="quest-node-pin"></div>
      <div class="quest-node-label">${chainTag}${q.isLegendaryReward ? '★ ' : ''}${(q.name || '').replace(/^The /, '')}</div>
    </div>`;
  }).join('');

  root.querySelectorAll('.quest-node').forEach(el => {
    el.addEventListener('click', () => {
      selected = quests[+el.dataset.i];
      renderNodes();
      renderDetail(selected);
    });
  });
  const hub = $('wm-hub-node');
  if (hub) hub.addEventListener('click', () => document.querySelector('.wm-tab[data-tab="guild"]')?.click());
}

function showPlaceholder() {
  const ph = $('wm-detail-placeholder');
  const content = $('wm-detail-content');
  if (ph) ph.style.display = 'flex';
  if (content) content.style.display = 'none';
}

function renderDetail(q) {
  const ph = $('wm-detail-placeholder');
  const content = $('wm-detail-content');
  if (!q || !content) return;
  if (ph) ph.style.display = 'none';
  content.style.display = 'block';

  $('wm-quest-name').textContent = q.name;
  $('wm-quest-desc').textContent = q.description;

  /* Chain chapter banner, phase rumors, and optional-objective previews */
  let extras = $('wm-quest-extras');
  if (!extras) {
    extras = document.createElement('div');
    extras.id = 'wm-quest-extras';
    $('wm-quest-desc').insertAdjacentElement('afterend', extras);
  }
  let xhtml = '';
  if (q.chain) {
    xhtml += `<div class="wm-chain-banner">📜 Chapter ${q.chain.part} of 3 — ${q.chain.arcTitle}</div>`;
  }
  /* The road: one overland floor per day, in the country crossed most that day. */
  if (q.route && Array.isArray(q.route.legs)) {
    xhtml += `<div class="wm-rumor-head">THE ROAD</div>`
      + `<div class="wm-route-days">${q.route.legs.map((b, d) =>
        `<span style="color:${THEMES[b]?.accent || '#d7c18f'}">Day ${d + 1}: ${cap(b)}</span>`).join(' → ')}</div>`;
  }
  if (q.phases && q.phases.length) {
    xhtml += `<div class="wm-rumor-head">RUMORS</div>`
      + q.phases.map(p => `<div class="wm-rumor">“${p.rumor}”</div>`).join('');
  }
  if (q.sideObjectives && q.sideObjectives.length) {
    xhtml += `<div class="wm-obj-head">OPTIONAL</div>`
      + q.sideObjectives.map(so =>
        `<div class="wm-objective">◈ ${so.label} (+${so.rewardGold}g, +${so.rewardXp} XP)</div>`).join('');
  }
  extras.innerHTML = xhtml;
  $('wm-quest-theme').textContent = cap(q.theme);
  $('wm-quest-theme').className = 'q-theme theme-' + q.theme;
  /* "10 · 2 overland floors → 8 below" — tells the player the run opens above
     ground before they commit. */
  const pro = prologueSummary(q);
  $('wm-quest-floors').textContent = pro ? `${q.floors} · ${pro}` : String(q.floors);
  $('wm-quest-level').textContent = `Level ${q.level}`;
  $('wm-quest-reward-gold').textContent = String(q.rewardGold);
  $('wm-quest-reward-xp').textContent = String(q.rewardXp);

  const row = $('wm-quest-reward-item-row');
  const span = $('wm-quest-reward-item');
  const it = q.rewardItem;
  if (row && span && it) {
    row.style.display = 'block';
    const legClass = it.rarity === 'legendary' ? ' reward-legendary' : '';
    row.className = 'q-reward-item' + legClass;
    const perk = perkText(it);
    const stats = bonusText(it);
    span.innerHTML = `
      <div class="q-reward-when">Awarded when the final floor boss falls</div>
      <span class="q-reward-gear" style="color:${it.color}">
        ${itemIconHTML(it.icon)}
        <strong>${it.name}</strong>
      </span>
      <div class="q-reward-meta">${cap(it.rarity)} · ${ilvlText(it)}</div>
      ${stats ? `<div class="q-reward-stats">${stats}</div>` : ''}
      ${perk ? `<div class="q-reward-perk">${perk}</div>` : ''}
    `;
  } else if (row) {
    row.style.display = 'none';
  }
}

/* ================= story tab ================= */

function renderStoryPanel() {
  const root = $('wm-story-list');
  if (!root) return;
  const states = storyMissionState(G);
  root.innerHTML = states.map((s, i) => `
    <div class="wm-story-card${s.unlocked ? '' : ' locked'}${s.completed ? ' completed' : ''}${selStory === i ? ' active' : ''}" data-i="${i}">
      <div class="wm-story-chapter">Chapter ${s.mission.chapter}</div>
      <div class="wm-story-title">${s.unlocked ? s.mission.name : '???'}</div>
      <div class="wm-story-status">${s.completed ? '✔ Completed — replayable' : s.unlocked ? '● Available' : '🔒 Locked'}</div>
    </div>`).join('')
    + `<div class="wm-story-card locked">
        <div class="wm-story-chapter">Chapter ${STORY_CHAPTER_NEXT(states)}</div>
        <div class="wm-story-title">???</div>
        <div class="wm-story-status">🔒 To be continued…</div>
      </div>`;

  root.querySelectorAll('.wm-story-card[data-i]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = +el.dataset.i;
      const changed = selStory !== idx;
      selStory = idx;
      renderStoryPanel();
      /* narrated mission briefing text on select (unlocked missions only) */
      const st = storyMissionState(G)[idx];
      if (changed && st && st.unlocked) playNarration(`${st.mission.id}_desc`);
    });
  });
  renderStoryDetail(states);
}

const STORY_CHAPTER_NEXT = states =>
  (states.length ? states[states.length - 1].mission.chapter : 0) + 1;

function renderStoryDetail(states) {
  const ph = $('wm-story-placeholder');
  const content = $('wm-story-content');
  const s = (selStory !== null && states[selStory]) ? states[selStory] : null;
  if (!s || !content) {
    if (ph) ph.style.display = 'flex';
    if (content) content.style.display = 'none';
    return;
  }
  if (ph) ph.style.display = 'none';
  content.style.display = 'block';
  const m = s.mission;
  $('wm-story-name').textContent = `Chapter ${m.chapter} — ${s.unlocked ? m.name : '???'}`;
  $('wm-story-desc').textContent = s.unlocked
    ? m.description
    : 'Complete the previous chapter to unlock this mission.';
  $('wm-story-region').textContent = s.unlocked ? m.place : '???';
  $('wm-story-mapkind').textContent = m.mapKind === 'overland' ? 'Overland' : 'Dungeon';
  $('wm-story-level').textContent = `Level ${m.level}`;
  $('wm-story-gold').textContent = String(m.rewardGold);
  $('wm-story-xp').textContent = String(m.rewardXp);
  const btn = $('wm-story-embark-btn');
  if (btn) {
    btn.disabled = !s.unlocked;
    btn.textContent = s.completed ? 'REPLAY MISSION' : 'BEGIN MISSION';
  }
}

function embarkStory() {
  if (!G || selStory === null) return;
  const states = storyMissionState(G);
  const s = states[selStory];
  if (!s || !s.unlocked) return;
  if (typeof stopNarration === 'function') stopNarration();
  const q = makeStoryQuest(s.mission);
  /* Briefing dialogue first (if the mission has one); the map only forges
     once the player picks a set-out choice. Backing out returns to the map. */
  if (s.mission.briefing) {
    showBriefing(G, s.mission, {
      onBegin: flags => { q.storyFlags = flags; launchStoryQuest(q); },
      onCancel: () => {}
    });
  } else {
    launchStoryQuest(q);
  }
}

async function launchStoryQuest(q) {
  hideWorldMap();
  /* startQuest() forges the floor synchronously — show the curtain and let it
     paint first so embarking acknowledges the click immediately. */
  await showLoadingScreenPainted({
    title: q.name || 'EMBARKING', subtitle: 'The party sets out...',
    party: G && G.heroes
  });
  G.startQuest(q);
  log(`📖 Chapter ${q.chapter}: ${q.name} — the party sets out for ${q.place}.`, 'sys');
  if (q.embarkText) {
    log(q.embarkText, 'story');
    playNarration(`${q.id}_embark`);
  }
  updateResources(G);
}

/** Embark on the tutorial quest (tutorial.js) — from the new-party offer or
 *  a replay from How to Play. Same curtain-then-forge order as a story quest. */
export async function launchTutorialQuest(q) {
  hideWorldMap();
  await showLoadingScreenPainted({
    title: q.name || 'EMBARKING', subtitle: 'The party sets out...',
    party: G && G.heroes
  });
  G.startQuest(q);
  log(`📘 Tutorial: ${q.name} — the party sets out for ${q.place}.`, 'sys');
  if (q.embarkText) log(q.embarkText, 'story');
  updateResources(G);
}

async function embarkSelected() {
  if (!selected || !G) return;
  const q = selected;
  hideWorldMap();
  await showLoadingScreenPainted({
    title: q.name || 'EMBARKING', subtitle: 'The party sets out...',
    party: G && G.heroes
  });
  G.startQuest(q);
  log(`🗺️ The party embarks on ${q.name} (${q.floors} floor${q.floors > 1 ? 's' : ''}, Lv ${q.level}).`, 'sys');
  if (q.embarkText) log(q.embarkText, 'story');
  if (q.isLegendaryReward) {
    log(`★ A fabled relic is rumored among the rewards…`, 'treasure');
  }
  updateResources(G);
}

function itemMatchesFilter(shopObj, filter) {
  if (filter === 'all') return true;
  if (shopObj.type === 'potion') {
    return filter === 'potion';
  }
  const item = shopObj.item;
  if (!item) return false;
  if (item.slot === 'dye' || (item.name && item.name.includes('Dye'))) {
    return filter === 'dye';
  }
  if (filter === 'weapon') {
    return item.slot === 'weapon';
  }
  if (filter === 'ranged') {
    return item.slot === 'weapon' && item.melee === false;   // bows, crossbows, slings and wands
  }
  if (filter === 'armor') {
    return item.slot === 'armor';
  }
  if (filter === 'helm') {
    return item.slot === 'helm';
  }
  if (filter === 'boots') {
    return item.slot === 'boots';
  }
  if (filter === 'shield') {
    return item.slot === 'shield';
  }
  if (filter === 'other') {
    return ['glove', 'amulet', 'ring', 'kit', 'trinket'].includes(item.slot);
  }
  return false;
}

// ===== Town Shop Panel Logic =====
function renderShopPanel() {
  const buyGrid = $('wm-shop-buy-grid');
  const sellGrid = $('wm-shop-sell-grid');
  const detail = $('wm-shop-detail-content');

  if (!buyGrid || !sellGrid || !detail) return;

  // Sync active states on filter buttons
  const filterBar = $('wm-shop-filter-bar');
  if (filterBar) {
    filterBar.querySelectorAll('.wm-filter-btn').forEach(btn => {
      if (btn.dataset.filter === activeShopFilter) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // Render buy items
  buyGrid.innerHTML = G.townShopInventory.map((shopObj, i) => {
    if (!itemMatchesFilter(shopObj, activeShopFilter)) {
      return '';
    }
    if (shopObj.sold) {
      return `<div class="bag-item sold">
        <span class="bag-ico">❌</span>
      </div>`;
    }
    let color = '#ccc';
    let icon = '';
    if (shopObj.type === 'potion') {
      icon = shopObj.icon;
    } else {
      icon = shopObj.item.icon;
      color = shopObj.item.color;
    }
    const isSel = selShopItem && selShopItem.type === 'buy' && selShopItem.shopObj === shopObj;
    return `<div class="bag-item ${isSel ? 'sel' : ''}" data-i="${i}" style="border-color:${color}">
      <span class="bag-ico">${itemIconHTML(icon)}</span>
      <span class="bag-r" style="background:${color}"></span>
    </div>`;
  }).join('');

  // Set event listeners for buy items
  buyGrid.querySelectorAll('.bag-item:not(.sold)').forEach(el => {
    el.addEventListener('click', () => {
      const idx = +el.dataset.i;
      const shopObj = G.townShopInventory[idx];
      selShopItem = { type: 'buy', shopObj, index: idx };
      renderShopPanel();
    });
  });

  // Render sell items (player inventory)
  if (G.inventory.length === 0) {
    sellGrid.innerHTML = `<div class="bag-empty">Your inventory is empty.</div>`;
  } else {
    sellGrid.innerHTML = G.inventory.map((item, i) => {
      const color = item.color || '#ccc';
      const isSel = selShopItem && selShopItem.type === 'sell' && selShopItem.item === item;
      const q = qtyOf(item);
      return `<div class="bag-item ${isSel ? 'sel' : ''}" data-i="${i}" style="border-color:${color}" title="${item.name}${q > 1 ? ` ×${q}` : ''}">
        <span class="bag-ico">${itemIconHTML(item.icon)}</span>
        ${q > 1 ? `<span class="bag-qty">×${q}</span>` : ''}
        <span class="bag-r" style="background:${color}"></span>
      </div>`;
    }).join('');

    // Set event listeners for sell items
    sellGrid.querySelectorAll('.bag-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = +el.dataset.i;
        const item = G.inventory[idx];
        selShopItem = { type: 'sell', item, index: idx };
        renderShopPanel();
      });
    });
  }

  // Render detail pane
  if (selShopItem) {
    let content = '';
    let btnText = '';
    let btnClass = 'btn primary';
    let allowed = false;
    let clickHandler = null;

    if (selShopItem.type === 'buy') {
      const shopObj = selShopItem.shopObj;
      const affordable = G.gold >= shopObj.price;
      allowed = affordable;

      if (shopObj.type === 'potion') {
        content = `
          <div class="id-name">${itemIconHTML(shopObj.icon)} ${shopObj.name}</div>
          <div class="id-slot">Consumable</div>
          <div class="id-bonus" style="margin-top:10px">${shopObj.desc}</div>
        `;
      } else {
        const it = shopObj.item;
        migrateItem(it);
        const pLine = perkText(it);
        let bonus = bonusText(it) || 'No bonuses';
        if (it.scroll || it.potion) {
          let what = '';
          if (it.scroll && it.spellKey) {
            const sp = SPELLS[it.spellKey];
            what = sp ? `${sp.label}${sp.level ? ' (Lv ' + sp.level + ')' : ''} — ${sp.desc}` : it.spellKey;
          } else if (it.potion && it.buffKey) {
            const eff = EFFECTS[it.buffKey];
            what = eff ? `${eff.label} — ${eff.desc}` : it.buffKey;
          }
          bonus = `${what}\n${it.charges} charge${it.charges === 1 ? '' : 's'} remaining`;
        }
        content = `
          <div class="id-name" style="color:${it.color}">${itemIconHTML(it.icon)} ${it.name}</div>
          <div class="id-slot">${cap(it.slot)} — ${cap(it.rarity)} · ${ilvlText(it)}</div>
          <div class="id-bonus" style="margin-top:10px">${bonus}</div>
          ${pLine ? `<div class="id-perk" style="margin-top:5px; color:#e8a83f;">${pLine}</div>` : ''}
        `;
      }

      btnText = `Buy for ${shopObj.price}g`;
      clickHandler = () => {
        if (G.gold >= shopObj.price) {
          G.gold -= shopObj.price;
          if (shopObj.type === 'potion') {
            G.potions[shopObj.kind]++;
            log(`🛒 Bought ${shopObj.name} for ${shopObj.price}g.`, 'sys');
          } else {
            addToInventory(G.inventory, shopObj.item, G);
            shopObj.sold = true;
            log(`🛒 Bought ${shopObj.item.name} for ${shopObj.price}g.`, 'sys');
          }
          updateResources(G);
          refreshMenus(G);
          G.saveGame();

          // Reset selection
          selShopItem = null;
          // Refresh gold in header
          const goldVal = $('wm-header-gold-val');
          if (goldVal) goldVal.textContent = G.gold;
          renderShopPanel();
        }
      };

    } else { // sell
      const item = selShopItem.item;
      migrateItem(item);
      const pLine = perkText(item);
      allowed = true;

      content = `
        <div class="id-name" style="color:${item.color}">${itemIconHTML(item.icon)} ${item.name}</div>
        <div class="id-slot">${cap(item.slot)} — ${cap(item.rarity)} · ${ilvlText(item)}</div>
        <div class="id-bonus" style="margin-top:10px">${bonusText(item) || 'No bonuses'}</div>
        ${pLine ? `<div class="id-perk" style="margin-top:5px; color:#e8a83f;">${pLine}</div>` : ''}
      `;

      btnText = qtyOf(item) > 1 ? `Sell one for ${item.value}g (${qtyOf(item)} held)` : `Sell for ${item.value}g`;
      clickHandler = () => {
        if (G.inventory.includes(item)) {
          G.sellItem(item, 1);
          updateResources(G);
          refreshMenus(G);
          G.saveGame();

          selShopItem = null;
          const goldVal = $('wm-header-gold-val');
          if (goldVal) goldVal.textContent = G.gold;
          renderShopPanel();
        }
      };
    }

    detail.innerHTML = `
      <div class="wm-shop-detail-card">
        <div>
          ${content}
        </div>
        <div style="margin-top:20px;">
          <button id="wm-shop-action-btn" class="${btnClass}" ${allowed ? '' : 'disabled'} style="width:100%; padding:10px;">${btnText}</button>
          ${!allowed && selShopItem.type === 'buy' ? '<div style="color:#e0483a; font-size:14px; text-align:center; margin-top:6px;">Not enough gold.</div>' : ''}
        </div>
      </div>
    `;

    $('wm-shop-action-btn').addEventListener('click', clickHandler);

  } else {
    detail.innerHTML = `<div style="text-align:center; color:#5a6474; font-size:16px; margin-top:40px;">Select an item from Buy or Sell stock to view details.</div>`;
  }
}

let currentGuildSubTab = 'roster';
let guildSubtabsBound = false;
let selForgeItem = null;

function initGuildSubtabs() {
  if (guildSubtabsBound) return;
  const bar = $('guild-subtabs-bar');
  if (!bar) return;
  guildSubtabsBound = true;

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('.guild-subtab');
    if (!btn) return;
    currentGuildSubTab = btn.dataset.subtab;
    renderGuildPanel();
  });
}

function renderGuildPanel() {
  firstRunTip('guild');
  initGuildSubtabs();
  if (G?.guild && typeof G.guild.stripUnassignableJobs === 'function') {
    G.guild.stripUnassignableJobs();
  }
  const rosterPanel = $('guild-subpanel-roster');
  const facilityPanel = $('guild-subpanel-facility');
  if (!rosterPanel || !facilityPanel) return;

  // Sync subtab active state buttons
  document.querySelectorAll('.guild-subtab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.subtab === currentGuildSubTab);
  });

  if (currentGuildSubTab === 'roster') {
    rosterPanel.style.display = 'block';
    facilityPanel.style.display = 'none';
    renderTavernPanel();
  } else {
    rosterPanel.style.display = 'none';
    facilityPanel.style.display = 'block';
    renderFacilityView(currentGuildSubTab);
  }
}

function renderFacilityView(facilityId) {
  const container = $('guild-facility-content');
  if (!container || !G || !G.guild) return;

  const fac = FACILITY_DEFINITIONS[facilityId];
  if (!fac) return;

  const lvl = G.guild.getFacilityLevel(facilityId);
  const isUnlocked = G.guild.isUnlocked(facilityId);
  const maxed = lvl >= fac.maxLevel;
  const cost = G.guild.getUpgradeCost(facilityId);
  const canAfford = G.gold >= cost && !maxed;

  const assignedHeroes = G.guild.getAssignedHeroes(facilityId);
  const availableStoredHeroes = G.storedHeroes || [];

  let actionHtml = '';

  if (!isUnlocked) {
    const unlockHint = fac.assignable === false
      ? `Build and unlock ${fac.name} to access its features.`
      : `Build and unlock ${fac.name} to assign heroes and access facility features.`;
    actionHtml = `
      <div style="background: rgba(220, 53, 69, 0.15); border: 2px solid #dc3545; padding: 16px; border-radius: 4px; text-align: center;">
        <h4 style="color: #ff6b6b; margin-top: 0;">🔒 Facility Locked (Level 0)</h4>
        <p style="color: #b0bec5; font-size: 13px; margin-bottom: 14px;">${unlockHint}</p>
        <button class="btn primary btn-upgrade-fac-lg" style="padding: 10px 20px; font-size: 13px;" ${canAfford ? '' : 'disabled'}>
          Build / Unlock Facility (🪙 ${cost}g)
        </button>
      </div>
    `;
  } else {
    let featureHtml = '';

    if (facilityId === 'cartographer') {
      const scoutedRoomsCount = Math.min(5, 1 + Math.floor(lvl * 0.4)) + (G.guild.hasTech('e2_scouting') ? 1 : 0);
      const expeditions = G.guild.getAvailableExpeditions();
      const activeCount = G.guild.activeExpeditions.length;
      const maxExp = Math.min(3, 1 + Math.floor(lvl * 0.3));

      const expListHtml = expeditions.map(exp => {
        if (exp.active && exp.expeditionData) {
          const d = exp.expeditionData;
          const isDone = d.floorsRemaining <= 0 || d.completed;
          const pct = Math.min(100, Math.round(((d.totalFloors - d.floorsRemaining) / d.totalFloors) * 100));
          return `
            <div style="background: rgba(0,0,0,0.35); border: 1px solid ${isDone ? '#4caf50' : '#444'}; padding: 12px; border-radius: 4px; margin-bottom: 10px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong style="color: var(--px-gold); font-size: 13px;">${exp.icon} ${exp.name}</strong>
                <span style="font-size: 11px; color: ${isDone ? '#4caf50' : '#8a9ba8'}; font-weight: bold;">
                  ${isDone ? '✨ EXPEDITION COMPLETE' : `⏳ In Progress (${d.floorsRemaining} fl left)`}
                </span>
              </div>
              <div style="font-size: 11px; color: #cfd8dc; margin: 4px 0;">Squad: ${d.heroes.join(', ')}</div>
              <div style="background: #101418; border: 1px solid #333; height: 10px; border-radius: 5px; overflow: hidden; margin: 6px 0;">
                <div style="background: linear-gradient(90deg, #0288d1, #26c6da); height: 100%; width: ${pct}%;"></div>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px;">
                <span style="font-size: 11px; color: #8a9ba8;">Rewards: 🪙${exp.rewards.gold || 0}g · Materials & Dust</span>
                ${isDone ? `<button class="btn primary btn-claim-expedition" data-exp-id="${d.id}" style="padding: 4px 12px; font-size: 11px;">🎁 Claim Loot</button>` : ''}
              </div>
            </div>
          `;
        } else {
          return `
            <div style="background: rgba(0,0,0,0.25); border: 1px solid #333; padding: 12px; border-radius: 4px; margin-bottom: 10px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong style="color: #fff; font-size: 13px;">${exp.icon} ${exp.name}</strong>
                <span style="font-size: 11px; color: #8a9ba8;">Duration: ${exp.durationFloors} Floors (Req: Lv ${exp.recommendedLevel}+)</span>
              </div>
              <p style="font-size: 11px; color: #b0bec5; margin: 4px 0 8px 0;">${exp.desc}</p>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 11px; color: #4caf50;">Yield: 🪙${exp.rewards.gold || 0}g, Dust, Lore & Reagents</span>
                <button class="btn primary btn-dispatch-expedition" data-template-id="${exp.id}" style="padding: 4px 12px; font-size: 11px;" ${activeCount >= maxExp || availableStoredHeroes.length < exp.minHeroes ? 'disabled' : ''}>
                  🗺️ Dispatch Squad (${exp.minHeroes}-${exp.maxHeroes} heroes)
                </button>
              </div>
            </div>
          `;
        }
      }).join('');

      featureHtml = `
        <div class="facility-interactive-box">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <h4 style="color: var(--px-gold); margin: 0;">🗺️ Dungeon Cartography & Expedition Dispatch Board</h4>
            <span style="background: rgba(2,136,209,0.2); border: 1px solid #0288d1; padding: 4px 8px; border-radius: 4px; font-size: 11px; color: #29b6f6;">
              🧭 Pre-Charts ${scoutedRoomsCount} Rooms Ahead on Every Dungeon Floor
            </span>
          </div>
          <p style="font-size: 11px; color: #b0bec5; margin: 0 0 10px 0;">
            Send off-duty stored heroes on autonomous scouting & bounty expeditions while your main party delves into dungeons.
            (Active: ${activeCount} / ${maxExp} squads).
          </p>
          <div style="flex: 1; overflow-y: auto; min-height: 0;">
            ${expListHtml}
          </div>
          <div id="cartographer-action-feedback" style="margin-top: 6px; font-size: 12px; color: #4caf50;"></div>
        </div>
      `;
    } else if (facilityId === 'academy') {
      const branches = [
        { id: 'military', name: '⚔️ Military & Tactics', keys: ['m1_vitality', 'm2_striking', 'm3_warlord', 'm4_legend'] },
        { id: 'arcane', name: '✨ Arcane & Alchemy', keys: ['a1_alchemy', 'a2_attunement', 'a3_resilience', 'a4_archmage'] },
        { id: 'logistics', name: '🪙 Logistics & Economy', keys: ['l1_treasury', 'l2_barter', 'l3_expansion', 'l4_monopoly'] },
        { id: 'exploration', name: '🗺️ Exploration & Dungeoneering', keys: ['e1_pathfinding', 'e2_scouting', 'e3_dungeoneering', 'e4_omniscience'] }
      ];

      const tomes = G.guild.tomes || 0;

      const techTreeHtml = branches.map(b => {
        const nodesHtml = b.keys.map(tKey => {
          const tech = TECH_TREE[tKey];
          if (!tech) return '';
          const isResearched = G.guild.hasTech(tKey);
          const canUnlock = G.guild.canUnlockTech(tKey);

          return `
            <div style="background: ${isResearched ? 'rgba(76, 175, 80, 0.15)' : 'rgba(0,0,0,0.3)'}; border: 1px solid ${isResearched ? '#4caf50' : '#444'}; padding: 8px; border-radius: 4px; margin-bottom: 6px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong style="color: ${isResearched ? '#4caf50' : '#fff'}; font-size: 12px;">${tech.icon} ${tech.name}</strong>
                <span style="font-size: 10px; color: ${isResearched ? '#4caf50' : '#8a9ba8'};">Tier ${tech.tier} (Lv ${tech.minPartyLevel || 1}+)</span>
              </div>
              <div style="font-size: 11px; color: #b0bec5; margin: 3px 0;">${tech.desc}</div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                <span style="font-size: 10px; color: #ffb74d;">🪙${(tech.costGold / 1000).toFixed(tech.costGold >= 10000 ? 0 : 1)}k · 📚${tech.costTomes} Tomes</span>
                ${isResearched
                  ? '<span style="color: #4caf50; font-size: 11px; font-weight: bold;">✓ Researched</span>'
                  : `<button class="btn primary btn-unlock-tech" data-tech-id="${tech.id}" style="padding: 2px 8px; font-size: 10px;" ${canUnlock ? '' : 'disabled'}>Research</button>`
                }
              </div>
            </div>
          `;
        }).join('');

        return `
          <div style="background: rgba(0,0,0,0.2); border: 1px solid #333; padding: 10px; border-radius: 4px; display: flex; flex-direction: column;">
            <h5 style="color: var(--px-gold); margin: 0 0 8px 0; font-size: 12px;">${b.name}</h5>
            ${nodesHtml}
          </div>
        `;
      }).join('');

      featureHtml = `
        <div class="facility-interactive-box">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <h4 style="color: var(--px-gold); margin: 0;">📜 Guild Academy Research Tree</h4>
            <span style="font-size: 12px; color: #fff;">
              📚 Knowledge Tomes: <strong style="color: #64b5f6;">${tomes}</strong> | 🪙 Gold: <strong style="color: #ffd54f;">${G.gold}</strong>
            </span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; flex: 1; min-height: 0; overflow-y: auto;">
            ${techTreeHtml}
          </div>
          <div id="academy-action-feedback" style="margin-top: 6px; font-size: 12px; color: #4caf50;"></div>
        </div>
      `;
    } else if (facilityId === 'enchanter') {
      const ess = G.guild.essences || {};
      const invGear = (G.inventory || []).filter(i => i && i.slot && i.kind !== 'potion' && i.kind !== 'dye' && i.slot !== 'rune' && i.kind !== 'rune');

      const recipes = G.guild.listRuneRecipes();
      const runesListHtml = recipes.map(r => {
        const canCraft = r.unlocked && G.gold >= r.goldCost && (ess.dust || 0) >= r.dustCost && (ess[r.essenceKey] || 0) >= r.essenceCost;
        const slot = r.slotType === 'weapon' ? 'weapon' : r.slotType === 'worn' ? 'worn' : 'armor';
        return `
          <div class="rune-row${r.unlocked ? '' : ' locked'}">
            <span class="rune-ico">${r.icon}</span>
            <div class="rune-body">
              <div class="rune-name">${r.name}</div>
              <div class="rune-desc">${r.unlocked ? r.desc : `Unlocks at Enchanter ${r.minLevel}`}</div>
            </div>
            <div class="rune-cost">${r.unlocked ? `${r.goldCost}g · ${r.dustCost} dust · ${r.essenceCost} ${r.essenceKey}` : slot}</div>
            <button class="btn primary btn-craft-rune" data-rune-key="${r.id}" ${canCraft ? '' : 'disabled'}>
              ${r.unlocked ? 'Craft' : `Lv ${r.minLevel}`}
            </button>
          </div>
        `;
      }).join('');

      const disenchantGridHtml = invGear.length === 0 ? '<div style="color:#8a9ba8; font-size:12px; padding:10px;">No unequipped gear to disenchant.</div>' : invGear.map((item, idx) => `
        <div class="bag-item" data-disenchant-idx="${idx}" style="border-color:${item.color || '#ccc'}; cursor: pointer;">
          <span class="bag-ico">${itemIconHTML(item.icon)}</span>
          <span class="bag-r" style="background:${item.color || '#ccc'}"></span>
        </div>
      `).join('');

      featureHtml = `
        <div class="facility-interactive-box">
          <div style="background: rgba(0,0,0,0.3); padding: 6px 12px; border-radius: 4px; border: 1px solid #444; margin-bottom: 8px; font-size: 11px; color: #fff; display: flex; gap: 12px; flex-wrap: wrap;">
            <span>✨ Dust: <strong style="color:#bb86fc;">${ess.dust || 0}</strong></span>
            <span>🔥 Fire: <strong style="color:#ff7043;">${ess.fire || 0}</strong></span>
            <span>❄️ Frost: <strong style="color:#29b6f6;">${ess.frost || 0}</strong></span>
            <span>⚡ Lightning: <strong style="color:#ffd54f;">${ess.lightning || 0}</strong></span>
            <span>🩸 Shadow: <strong style="color:#ab47bc;">${ess.shadow || 0}</strong></span>
            <span>🛡️ Radiant: <strong style="color:#fff176;">${ess.radiant || 0}</strong></span>
          </div>
          <p class="armory-hint" style="margin:0 0 8px">Crafted runes go to your bag. Open Party (I) and drag a rune onto gear to inscribe it.</p>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; flex: 1; min-height: 0;">
            <div style="display: flex; flex-direction: column; min-height: 0;">
              <h5 style="color: var(--px-gold); margin: 0 0 6px 0; font-size: 12px;">🔮 Runecrafting Recipes:</h5>
              <div style="overflow-y: auto; flex: 1;">${runesListHtml}</div>
            </div>

            <div style="display: flex; flex-direction: column; min-height: 0;">
              <h5 style="color: var(--px-gold); margin: 0 0 6px 0; font-size: 12px;">✨ Disenchant Gear (Click Item):</h5>
              <div class="bag-grid" id="disenchant-grid" style="overflow-y: auto; flex: 1;">${disenchantGridHtml}</div>
            </div>
          </div>
          <div id="enchanter-action-feedback" style="margin-top: 6px; font-size: 12px; color: #4caf50;"></div>
        </div>
      `;
    } else if (facilityId === 'war_room') {
      const currentOrder = G.guild.activeSlayingOrder || 'undead_purge';
      const currentDoctrine = G.guild.activeDoctrine || 'phalanx';

      const ordersHtml = Object.values(SLAYING_ORDERS).map(ord => {
        const isSel = currentOrder === ord.id;
        return `
          <div style="background: ${isSel ? 'rgba(232, 194, 90, 0.15)' : 'rgba(0,0,0,0.3)'}; border: 1px solid ${isSel ? '#e8c25a' : '#444'}; padding: 10px; border-radius: 4px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong style="color: ${isSel ? '#e8c25a' : '#fff'}; font-size: 13px;">${ord.icon} ${ord.name}</strong>
              <div style="font-size: 11px; color: #b0bec5;">${ord.desc}</div>
              <div style="font-size: 10px; color: #4caf50; margin-top: 2px;">Bonus: +${10 + lvl * 2}% Dmg & Defense</div>
            </div>
            ${isSel ? '<span style="color: #e8c25a; font-weight: bold; font-size: 11px;">[ACTIVE ORDER]</span>' : `<button class="btn primary btn-set-slaying-order" data-order-id="${ord.id}" style="padding: 4px 10px; font-size: 11px;">Issue Order</button>`}
          </div>
        `;
      }).join('');

      const doctrinesHtml = Object.values(BATTLE_DOCTRINES).map(doc => {
        const isSel = currentDoctrine === doc.id;
        return `
          <div style="background: ${isSel ? 'rgba(33, 150, 243, 0.15)' : 'rgba(0,0,0,0.3)'}; border: 1px solid ${isSel ? '#2196f3' : '#444'}; padding: 10px; border-radius: 4px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong style="color: ${isSel ? '#64b5f6' : '#fff'}; font-size: 13px;">${doc.icon} ${doc.name}</strong>
              <div style="font-size: 11px; color: #b0bec5;">${doc.desc}</div>
            </div>
            ${isSel ? '<span style="color: #64b5f6; font-weight: bold; font-size: 11px;">[ACTIVE DOCTRINE]</span>' : `<button class="btn primary btn-set-doctrine" data-doc-id="${doc.id}" style="padding: 4px 10px; font-size: 11px;">Enact</button>`}
          </div>
        `;
      }).join('');

      featureHtml = `
        <div class="facility-interactive-box">
          <h4 style="color: var(--px-gold); margin: 0 0 4px 0;">🛡️ Tactical Bestiary Orders & Battle Doctrines</h4>
          <p style="font-size: 11px; color: #b0bec5; margin: 0 0 10px 0;">Issue strategic focus orders to empower your party against specific monster families.</p>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; flex: 1; min-height: 0;">
            <div style="display: flex; flex-direction: column; min-height: 0;">
              <h5 style="color: var(--px-gold); margin: 0 0 6px 0; font-size: 12px;">🎯 Monster Slaying Orders:</h5>
              <div style="overflow-y: auto; flex: 1;">${ordersHtml}</div>
            </div>

            <div style="display: flex; flex-direction: column; min-height: 0;">
              <h5 style="color: var(--px-gold); margin: 0 0 6px 0; font-size: 12px;">⚔️ Battle Formation Doctrines:</h5>
              <div style="overflow-y: auto; flex: 1;">${doctrinesHtml}</div>
            </div>
          </div>
          <div id="war-room-action-feedback" style="margin-top: 6px; font-size: 12px; color: #4caf50;"></div>
        </div>
      `;
    } else if (facilityId === 'blacksmith') {
      const mats = G.guild.materials || { iron: 0, leather: 0 };
      const maxCraftablePS = G.guild.getMaxCraftablePS();
      const clampedPS = Math.max(15, Math.min(maxCraftablePS, craftTargetPS));
      craftTargetPS = clampedPS;

      const costs = G.guild.getCraftingCosts(craftSelectedSlot, craftTargetPS);
      const heroBonus = G.guild.getAssignedBlacksmithBonus();
      const canAffordCraft = G.gold >= costs.goldCost && (mats.iron || 0) >= costs.ironCost && (mats.leather || 0) >= costs.leatherCost;

      const slots = [
        { id: 'weapon', label: 'Weapon' },
        { id: 'ranged', label: 'Ranged' },
        { id: 'focus', label: 'Focus' },
        { id: 'armor', label: 'Armor' },
        { id: 'shield', label: 'Shield' },
        { id: 'helm', label: 'Helm' },
        { id: 'boots', label: 'Boots' },
        { id: 'gloves', label: 'Gloves' },
        { id: 'ring', label: 'Ring' },
        { id: 'amulet', label: 'Amulet' }
      ];
      const slotLabel = slots.find(s => s.id === craftSelectedSlot)?.label || 'Gear';

      const catalog = G.guild.listCraftBases(craftSelectedSlot);
      if (craftSelectedBase && !catalog.some(b => b.name === craftSelectedBase)) {
        craftSelectedBase = null;
      }

      const slotButtonsHtml = slots.map(s => `
        <button class="btn btn-select-craft-slot smith-slot-btn ${craftSelectedSlot === s.id ? 'primary' : ''}" data-slot="${s.id}">
          ${s.label}
        </button>
      `).join('');

      const baseChipsHtml = `
        <button class="smith-base ${craftSelectedBase ? '' : 'sel'}" data-base="">Any ${slotLabel.toLowerCase()}</button>
        ${catalog.map(b => `
          <button class="smith-base ${craftSelectedBase === b.name ? 'sel' : ''}" data-base="${b.name}" title="${b.name}">
            ${itemIconHTML(b.icon, 'smith-base-ico')}
            <span class="smith-base-name">${b.name}</span>
          </button>
        `).join('')}
      `;

      const invItems = (G.inventory || []).filter(isSalvageable);
      const scrapCount = invItems.filter(i => !i.locked && (itemPoints(i) || 0) <= salvagePSThreshold).length;
      const itemsGridHtml = invItems.length === 0 ? `
        <div class="armory-hint" style="padding:16px;text-align:center">No unequipped gear to salvage.</div>
      ` : invItems.map((item, idx) => {
        const color = item.color || '#ccc';
        const isSel = selSalvageItem === item;
        return `
          <div class="bag-item ${isSel ? 'sel' : ''}" data-salvage-idx="${idx}" style="border-color:${color}; position: relative;" title="${item.name || 'Gear'}">
            <span class="bag-ico">${itemIconHTML(item.icon)}</span>
            <span class="bag-r" style="background:${color}"></span>
          </div>
        `;
      }).join('');

      const forgeLabel = craftSelectedBase || `any ${slotLabel.toLowerCase()}`;

      featureHtml = `
        <div class="facility-interactive-box smith-box">
          <div class="smith-mats">
            <div class="smith-mat">
              <span class="smith-mat-label">Iron</span>
              <span class="smith-mat-val">${mats.iron || 0}</span>
            </div>
            <div class="smith-mat">
              <span class="smith-mat-label">Leather</span>
              <span class="smith-mat-val">${mats.leather || 0}</span>
            </div>
            <div class="smith-mat">
              <span class="smith-mat-label">Gold</span>
              <span class="smith-mat-val">${G.gold}</span>
            </div>
          </div>

          <div class="armory-panes smith-panes">
            <div class="armory-pane smith-pane-forge">
              <h5>Forge</h5>
              <div class="smith-slots">${slotButtonsHtml}</div>
              <div class="smith-base-list">${baseChipsHtml}</div>
              <div class="smith-quality">
                <div class="smith-quality-row">
                  <span>Quality</span>
                  <strong>PS ${craftTargetPS} <em>/ ${maxCraftablePS}</em></strong>
                </div>
                <input id="craft-ps-slider" type="range" min="15" max="${maxCraftablePS}" value="${craftTargetPS}">
              </div>
              <div class="smith-artisan">
                ${heroBonus.heroName
                  ? `${heroBonus.heroName} at the anvil · +${heroBonus.bonusPS} PS`
                  : 'No artisan assigned · +0 PS'}
              </div>
              <div class="smith-forge-foot">
                <div class="smith-cost">
                  <span>${costs.goldCost}g</span>
                  <span>${costs.ironCost} iron</span>
                  <span>${costs.leatherCost} leather</span>
                </div>
                <button id="btn-forge-craft" class="btn primary" ${canAffordCraft ? '' : 'disabled'}>
                  Forge ${forgeLabel}
                </button>
              </div>
            </div>

            <div class="armory-pane smith-pane-salvage">
              <h5>Salvage</h5>
              <div class="smith-quality">
                <div class="smith-quality-row">
                  <span>Scrap unlocked gear ≤</span>
                  <strong>PS ${salvagePSThreshold}</strong>
                </div>
                <input id="salvage-ps-slider" type="range" min="10" max="${Math.max(100, maxCraftablePS)}" value="${salvagePSThreshold}">
                <button id="btn-bulk-salvage-ps" class="btn" ${scrapCount ? '' : 'disabled'}>
                  Scrap ${scrapCount} item${scrapCount === 1 ? '' : 's'}
                </button>
              </div>
              <div class="bag-grid" id="forge-inventory-grid">${itemsGridHtml}</div>
              <div class="smith-salvage-sel">
                ${selSalvageItem ? `
                  <span style="color:${selSalvageItem.color || '#fff'}">${selSalvageItem.name} · PS ${itemPoints(selSalvageItem)}</span>
                  <button id="btn-forge-salvage" class="btn">Salvage this</button>
                ` : `<span class="armory-hint">Click a piece to scrap it alone.</span>`}
              </div>
              <div id="blacksmith-action-feedback" class="armory-feedback" style="color:#4caf50"></div>
            </div>
          </div>
        </div>
      `;
    } else if (facilityId === 'armory') {
      const invGear = (G.inventory || []).filter(i => i && i.slot && i.kind !== 'potion' && i.kind !== 'dye');
      const stored = G.guild.storedItems || [];
      const cap = G.guild.getArmoryCapacity();
      const free = G.guild.getArmoryFreeSlots();

      const cell = (item, idx, attr) => {
        const color = item.color || '#ccc';
        const enh = item.enhanceLevel ? `+${item.enhanceLevel}` : '';
        return `
          <div class="bag-item" ${attr}="${idx}" title="${item.name || 'Gear'}" style="border-color:${color}; position: relative;">
            <span class="bag-ico">${itemIconHTML(item.icon)}</span>
            ${enh ? `<span style="position: absolute; top: 2px; right: 4px; font-size: 10px; color: #4caf50; font-weight: bold;">${enh}</span>` : ''}
            <span class="bag-r" style="background:${color}"></span>
          </div>`;
      };
      const empty = msg => `<div style="color: #8a9ba8; font-size: 12px; grid-column: 1 / -1; text-align: center; padding: 20px;">${msg}</div>`;

      const invGridHtml = invGear.length === 0
        ? empty('No unequipped gear to stash.')
        : invGear.map((it, i) => cell(it, i, 'data-armory-dep')).join('');
      const storedCells = [];
      for (let i = 0; i < cap; i++) {
        const it = stored[i];
        storedCells.push(it
          ? cell(it, i, 'data-armory-wd')
          : `<div class="bag-item armory-slot-empty" title="Empty slot"></div>`);
      }

      featureHtml = `
        <div class="facility-interactive-box armory-box">
          <div class="armory-toolbar">
            <span class="armory-count${free === 0 ? ' is-full' : ''}">${stored.length} / ${cap} slots</span>
            <button id="btn-armory-deposit-all" class="btn" ${invGear.length && free ? '' : 'disabled'}>
              Stash all gear
            </button>
          </div>
          <div class="armory-panes">
            <div class="armory-pane armory-pane-inv">
              <h5>Party Inventory</h5>
              <p class="armory-hint">Click an item to stash it</p>
              <div class="bag-grid" id="armory-inv-grid">${invGridHtml}</div>
            </div>
            <div class="armory-pane armory-pane-store">
              <h5>Armory Vault</h5>
              <p class="armory-hint">Click an item to withdraw it</p>
              <div class="bag-grid" id="armory-stored-grid">${storedCells.join('')}</div>
            </div>
          </div>
          <div id="armory-action-feedback" class="armory-feedback"></div>
        </div>
      `;
    } else if (facilityId === 'apothecary') {
      const assignedHeroName = assignedHeroes[0];
      let heroInt = 10;
      let heroNameDisplay = 'None Assigned';

      if (assignedHeroName) {
        const heroObj = (G.storedHeroes || []).find(h => h.name === assignedHeroName) ||
                        (G.heroes || []).map(h => h.data).find(h => h.name === assignedHeroName);
        if (heroObj) {
          heroInt = heroObj.stats?.int || heroObj.stats?.INT || 10;
          heroNameDisplay = `${heroObj.name} (INT: ${heroInt})`;
        }
      }

      const still = G.guild.getStillPreview();
      const floorsProgress = still.floors;
      const needed = still.duration;
      const progressPercent = Math.min(100, Math.round((floorsProgress / Math.max(1, needed)) * 100));
      const pots = G.potions || {};
      const recipes = G.guild.listBrewRecipes();
      const hasAlch = !!assignedHeroName;

      const recipeHtml = recipes.map(r => {
        const blurb = r.unlocked
          ? `${r.quantity}× every ${r.duration} floors`
          : `Unlocks at Apothecary ${r.minLevel}`;
        const btn = !r.unlocked ? `Lv ${r.minLevel}` : r.selected ? 'On the still' : 'Set still';
        return `
          <div class="apo-recipe${r.unlocked ? '' : ' locked'}${r.selected ? ' sel' : ''}">
            <div class="apo-recipe-ico">${itemIconHTML(r.icon, 'apo-recipe-img')}</div>
            <div class="apo-recipe-body">
              <div class="apo-recipe-name">${r.name}</div>
              <div class="apo-recipe-meta">${blurb}</div>
            </div>
            <button class="btn${r.selected ? ' primary' : ''} btn-apo-still" data-base="${r.baseKey}" ${r.unlocked ? '' : 'disabled'}>
              ${btn}
            </button>
          </div>`;
      }).join('');

      featureHtml = `
        <div class="facility-interactive-box apo-box">
          <div class="smith-mats">
            <div class="smith-mat">
              <span class="smith-mat-label">Heal</span>
              <span class="smith-mat-val">${pots.heal || 0}</span>
            </div>
            <div class="smith-mat">
              <span class="smith-mat-label">Greater</span>
              <span class="smith-mat-val">${pots.greater || 0}</span>
            </div>
            <div class="smith-mat">
              <span class="smith-mat-label">Superior</span>
              <span class="smith-mat-val">${pots.superior || 0}</span>
            </div>
          </div>

          <div class="apo-still">
            <div class="apo-still-row">
              <span>Still · ${heroNameDisplay}</span>
              <strong>${still.quantity}× ${still.baseKey} / ${needed} floors</strong>
            </div>
            <div class="apo-still-bar">
              <div class="apo-still-fill" style="width:${progressPercent}%"></div>
            </div>
            <div class="apo-still-hint">${
              hasAlch
                ? `${floorsProgress} / ${needed} floors · yield scales with still level and alchemist INT`
                : 'Assign an alchemist — the still is cold until someone works it'
            }</div>
          </div>

          <div class="apo-recipes">${recipeHtml}</div>
          <div id="apothecary-action-feedback" class="armory-feedback" style="color:#4caf50"></div>
        </div>
      `;
    } else if (facilityId === 'training_grounds') {
      const stored = G.storedHeroes || [];
      const stations = G.guild.trainingStations || [];
      const STAT_LABEL = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };

      const stationHtml = stations.length === 0
        ? `<div class="armory-hint" style="padding:12px;text-align:center">The yard is empty. Buy a piece of gear below.</div>`
        : stations.map(st => {
            const def = TRAINING_GEAR[st.key];
            if (!def) return '';
            const heroName = G.guild.stationAssignments[st.id] || '';
            const hero = heroName ? stored.find(h => h.name === heroName) : null;
            const cur = hero?.stats?.[def.stat] || (hero ? 10 : 0);
            const needed = hero ? trainingFloorsForGain(cur, st.level || 1) : 0;
            const prog = G.guild.stationProgress[st.id] || 0;
            const pct = hero && cur < 20 ? Math.min(100, Math.round((prog / Math.max(1, needed)) * 100)) : 0;
            const maxed = hero && cur >= 20;
            const upCost = def.upgradeCost * (st.level || 1);
            const canUp = (st.level || 1) < 5 && G.gold >= upCost;
            const opts = [`<option value="">— empty —</option>`]
              .concat(stored.map(h => {
                const busy = G.guild.stationAssignments && Object.entries(G.guild.stationAssignments).find(([sid, n]) => n === h.name && sid !== st.id);
                const label = busy ? `${h.name} (busy)` : h.name;
                return `<option value="${h.name}" ${h.name === heroName ? 'selected' : ''}>${label} · ${STAT_LABEL[def.stat]} ${h.stats?.[def.stat] || 10}</option>`;
              }));
            return `
              <div class="tg-station">
                <div class="tg-station-head">
                  <div>
                    <div class="apo-recipe-name">${def.name} <span class="tg-stat">${STAT_LABEL[def.stat]}</span></div>
                    <div class="apo-recipe-meta">Lv ${st.level} · ${def.desc}</div>
                  </div>
                  <button class="btn btn-tg-upgrade" data-id="${st.id}" ${(st.level || 1) >= 5 ? 'disabled' : ''}>
                    ${(st.level || 1) >= 5 ? 'Masterwork' : canUp ? `Upgrade ${upCost}g` : `${upCost}g`}
                  </button>
                </div>
                <select class="tg-station-assign" data-id="${st.id}">${opts.join('')}</select>
                <div class="apo-still-bar"><div class="apo-still-fill" style="width:${pct}%"></div></div>
                <div class="apo-still-hint">${
                  !hero ? 'Assign a hero to begin.'
                  : maxed ? `${heroName}'s ${STAT_LABEL[def.stat]} is capped at 20.`
                  : `${heroName} ${STAT_LABEL[def.stat]} ${cur} → ${cur + 1} · ${prog}/${needed} floors`
                }</div>
              </div>`;
          }).join('');

      const catalogHtml = Object.values(TRAINING_GEAR).map(def => {
        const can = G.gold >= def.cost && stations.length < 8;
        return `
          <button class="btn btn-tg-buy" data-key="${def.id}" ${can ? '' : 'disabled'}>
            ${def.name} · ${STAT_LABEL[def.stat]} · ${def.cost}g
          </button>`;
      }).join('');

      featureHtml = `
        <div class="facility-interactive-box tg-box">
          <div class="smith-mats">
            <div class="smith-mat">
              <span class="smith-mat-label">Gold</span>
              <span class="smith-mat-val">${G.gold}</span>
            </div>
            <div class="smith-mat">
              <span class="smith-mat-label">Stations</span>
              <span class="smith-mat-val">${stations.length}/8</span>
            </div>
          </div>
          <div class="tg-stations">${stationHtml}</div>
          <div class="tg-section">
            <h5>Buy equipment</h5>
            <div class="tg-row">${catalogHtml}</div>
          </div>
          <div id="training-action-feedback" class="armory-feedback" style="color:#4caf50"></div>
        </div>
      `;
    } else if (facilityId === 'living_quarters') {
      featureHtml = `
        <div class="facility-interactive-box" style="margin-top: 16px;">
          <h4 style="color: var(--px-gold); margin-top: 0;">🏰 Living Quarters & Comfort Tiers</h4>
          <p style="font-size: 12px; color: #b0bec5;">
            Upgraded quarters provide restful lodging for your guild roster, granting heroes a <strong>+${lvl * 2}% Rested XP Bonus</strong> on their next dungeon venture.
          </p>
          <div style="font-size: 12px; color: #4caf50;">
            Current Capacity: ${6 + lvl * 2} Stored Heroes
          </div>
        </div>
      `;
    }

    actionHtml = `
      <div class="facility-dashboard-grid">
        <div class="facility-info-box">
          <div class="facility-header-inline">
            <span class="facility-icon-lg">${fac.icon}</span>
            <div>
              <div class="facility-title-lg">${fac.name}</div>
              <div class="facility-desc-lg">${fac.description}</div>
            </div>
          </div>
          ${fac.assignable === false || fac.assignable === 'multi' ? '' : `
          <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px;">
            <label style="font-size: 11px; color: var(--px-gold); font-weight: bold;">Assigned Hero:</label>
            <select id="fac-hero-assign-select" style="padding: 4px 8px; background: #14181d; color: #fff; border: 1px solid #444; font-size: 11px; max-width: 240px;">
              <option value="">-- Unassigned --</option>
              ${availableStoredHeroes.map(h => `<option value="${h.name}" ${assignedHeroes.includes(h.name) ? 'selected' : ''}>${h.name} (Lv ${h.level})</option>`).join('')}
            </select>
          </div>`}
        </div>

        <div class="facility-status-box">
          <div>
            <div style="font-size: 15px; font-weight: bold; color: var(--px-gold);">Level ${lvl} / ${fac.maxLevel}</div>
            <div style="font-size: 12px; color: #4caf50; font-weight: bold; margin-top: 2px;">${fac.getEffectText(lvl)}</div>
          </div>
          ${facilityId === 'training_grounds' ? '' : `
          <button class="btn primary btn-upgrade-fac-lg" style="padding: 8px 16px; font-size: 11px;" ${canAfford ? '' : 'disabled'}>
            ${maxed ? 'MAX LEVEL' : `Upgrade Facility (🪙 ${cost}g)`}
          </button>`}
        </div>
      </div>

      ${featureHtml}
    `;
  }

  container.innerHTML = `
    <div class="facility-view-card">
      ${actionHtml}
    </div>
  `;

  // Bind forge inventory grid item selection
  const forgeGrid = container.querySelector('#forge-inventory-grid');
  if (forgeGrid) {
    const invItems = (G.inventory || []).filter(i => i && i.kind !== 'potion');
    forgeGrid.querySelectorAll('.bag-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = +el.dataset.forgeIdx;
        selForgeItem = invItems[idx];
        renderFacilityView('blacksmith');
      });
    });
  }

  // Bind Armory deposit / withdraw
  if (facilityId === 'armory') {
    const invGear = (G.inventory || []).filter(i => i && i.slot && i.kind !== 'potion' && i.kind !== 'dye');
    const stored = G.guild.storedItems || [];
    const feedback = container.querySelector('#armory-action-feedback');
    const report = res => {
      if (!res.ok && feedback) feedback.textContent = res.reason;
      if (res.ok) { G.saveGame(); renderFacilityView('armory'); }
    };

    container.querySelectorAll('[data-armory-dep]').forEach(el => {
      el.addEventListener('click', () => {
        const item = invGear[+el.dataset.armoryDep];
        const res = G.guild.depositItem(item);
        if (res.ok) log(`🗄️ Stored ${item.name} in the Armory.`, 'sys');
        report(res);
      });
    });
    container.querySelectorAll('[data-armory-wd]').forEach(el => {
      el.addEventListener('click', () => {
        const item = stored[+el.dataset.armoryWd];
        const res = G.guild.withdrawItem(item);
        if (res.ok) log(`🎒 Withdrew ${item.name} from the Armory.`, 'sys');
        report(res);
      });
    });

    const depAll = container.querySelector('#btn-armory-deposit-all');
    if (depAll) depAll.addEventListener('click', () => {
      const n = G.guild.depositAllGear();
      if (n > 0) {
        log(`🗄️ Stored ${n} item${n > 1 ? 's' : ''} in the Armory.`, 'sys');
        report({ ok: true });
      } else {
        report({ ok: false, reason: 'Nothing could be stored — the Armory may be full.' });
      }
    });
  }

  // Bind upgrade button
  const upBtn = container.querySelector('.btn-upgrade-fac-lg');
  if (upBtn) {
    upBtn.addEventListener('click', () => {
      if (G.guild.upgradeFacility(facilityId)) {
        log(`🏰 Upgraded ${fac.name} to Level ${G.guild.getFacilityLevel(facilityId)}!`, 'gold');
        renderGuildPanel();
        const goldVal = $('wm-header-gold-val');
        if (goldVal) goldVal.textContent = G.gold;
      }
    });
  }

  // Bind hero assignment dropdown
  const assignSelect = container.querySelector('#fac-hero-assign-select');
  if (assignSelect) {
    assignSelect.addEventListener('change', () => {
      const heroName = assignSelect.value;
      assignedHeroes.forEach(h => G.guild.assignHero(h, null));
      if (heroName) G.guild.assignHero(heroName, facilityId);
      G.saveGame();
      renderFacilityView(facilityId);
    });
  }

  // Bind Blacksmith Crafting Slot Selection
  container.querySelectorAll('.btn-select-craft-slot').forEach(btn => {
    btn.addEventListener('click', () => {
      craftSelectedSlot = btn.dataset.slot;
      craftSelectedBase = null;
      renderFacilityView('blacksmith');
    });
  });

  container.querySelectorAll('.smith-base').forEach(btn => {
    btn.addEventListener('click', () => {
      craftSelectedBase = btn.dataset.base || null;
      renderFacilityView('blacksmith');
    });
  });

  // Bind Target PS slider
  const psSlider = container.querySelector('#craft-ps-slider');
  if (psSlider) {
    psSlider.addEventListener('input', () => {
      craftTargetPS = parseInt(psSlider.value, 10);
      renderFacilityView('blacksmith');
    });
  }

  // Bind Craft Equipment button
  const craftBtn = container.querySelector('#btn-forge-craft');
  if (craftBtn) {
    craftBtn.addEventListener('click', () => {
      const res = G.guild.craftEquipment(craftSelectedSlot, craftTargetPS, craftSelectedBase);
      const feedback = container.querySelector('#blacksmith-action-feedback');
      if (res.ok) {
        log(`⚒️ Blacksmith forged [${res.item.name}] (${res.item.rarity.toUpperCase()} · PS ${res.finalPS})!`, 'treasure');
        if (feedback) feedback.textContent = `✓ Forged ${res.item.name} (PS ${res.finalPS})! Added to inventory.`;
        const goldVal = $('wm-header-gold-val');
        if (goldVal) goldVal.textContent = G.gold;
        G.saveGame();
        renderFacilityView('blacksmith');
      } else {
        if (feedback) feedback.textContent = res.reason || 'Crafting failed.';
      }
    });
  }

  // Bind Salvage selection and action
  const salvageSlider = container.querySelector('#salvage-ps-slider');
  if (salvageSlider) {
    salvageSlider.addEventListener('input', () => {
      salvagePSThreshold = parseInt(salvageSlider.value, 10);
      renderFacilityView('blacksmith');
    });
  }

  const bulkSalvageBtn = container.querySelector('#btn-bulk-salvage-ps');
  if (bulkSalvageBtn) {
    bulkSalvageBtn.addEventListener('click', () => {
      const res = G.guild.salvageByPowerScore(salvagePSThreshold);
      const feedback = container.querySelector('#blacksmith-action-feedback');
      if (res.ok) {
        log(`⚒️ Bulk salvaged ${res.count} items (≤ PS ${res.threshold}) for +${res.iron} Iron and +${res.leather} Leather!`, 'gold');
        if (feedback) feedback.textContent = `✓ Salvaged ${res.count} items! (+${res.iron} Iron, +${res.leather} Leather)`;
        selSalvageItem = null;
        G.saveGame();
        renderFacilityView('blacksmith');
      } else {
        if (feedback) feedback.textContent = res.reason || 'Bulk salvage failed.';
      }
    });
  }

  container.querySelectorAll('.bag-item[data-salvage-idx]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.salvageIdx, 10);
      const invItems = (G.inventory || []).filter(isSalvageable);
      selSalvageItem = invItems[idx] || null;
      renderFacilityView('blacksmith');
    });
  });

  const salvageBtn = container.querySelector('#btn-forge-salvage');
  if (salvageBtn && selSalvageItem) {
    salvageBtn.addEventListener('click', () => {
      const res = G.guild.salvageItem(selSalvageItem);
      if (res.ok) {
        log(`⚒️ Salvaged ${selSalvageItem.name} for ${res.iron} Iron Ingots and ${res.leather} Leather!`, 'gold');
        selSalvageItem = null;
        G.saveGame();
        renderFacilityView('blacksmith');
      }
    });
  }

  // Bind Cartographer Expedition Buttons
  container.querySelectorAll('.btn-dispatch-expedition').forEach(btn => {
    btn.addEventListener('click', () => {
      const templateId = btn.dataset.templateId;
      const stored = G.storedHeroes || [];
      if (stored.length === 0) return;
      const squad = stored.slice(0, 3).map(h => h.name);
      const res = G.guild.dispatchExpedition(templateId, squad);
      if (res.ok) {
        log(`🗺️ Dispatched strike team [${squad.join(', ')}] on expedition!`, 'treasure');
        G.saveGame();
        renderFacilityView('cartographer');
      }
    });
  });

  container.querySelectorAll('.btn-claim-expedition').forEach(btn => {
    btn.addEventListener('click', () => {
      const expId = btn.dataset.expId;
      const res = G.guild.claimExpedition(expId);
      if (res.ok) {
        log(`🎁 Claimed expedition bounty! +${res.rewards.gold || 0}g, Materials & Essences.`, 'gold');
        const goldVal = $('wm-header-gold-val');
        if (goldVal) goldVal.textContent = G.gold;
        G.saveGame();
        renderFacilityView('cartographer');
      }
    });
  });

  // Bind Academy Research Buttons
  container.querySelectorAll('.btn-unlock-tech').forEach(btn => {
    btn.addEventListener('click', () => {
      const techId = btn.dataset.techId;
      if (G.guild.unlockTech(techId)) {
        const tech = TECH_TREE[techId];
        log(`📜 Researched ${tech?.name} at the Academy!`, 'gold');
        const goldVal = $('wm-header-gold-val');
        if (goldVal) goldVal.textContent = G.gold;
        G.saveGame();
        renderFacilityView('academy');
      }
    });
  });

  // Bind Enchanter Disenchant, Craft Rune and Inscribe Buttons
  const disenchantGrid = container.querySelector('#disenchant-grid');
  if (disenchantGrid) {
    const invGear = (G.inventory || []).filter(i => i && i.slot && i.kind !== 'potion' && i.kind !== 'dye');
    disenchantGrid.querySelectorAll('[data-disenchant-idx]').forEach(el => {
      bindItemHoverTooltip(el, () => invGear[+el.dataset.disenchantIdx], { compare: false, disenchant: true });
      el.addEventListener('click', () => {
        const item = invGear[+el.dataset.disenchantIdx];
        const res = G.guild.disenchantItem(item);
        if (res.ok) {
          hideItemTooltip();
          log(`🔮 Disenchanted ${item.name} into +${res.dust} Arcane Dust${res.essence ? ` and +1 ${res.essence} essence` : ''}!`, 'gold');
          G.saveGame();
          renderFacilityView('enchanter');
        }
      });
    });
  }

  container.querySelectorAll('.btn-craft-rune').forEach(btn => {
    btn.addEventListener('click', () => {
      const runeKey = btn.dataset.runeKey;
      const res = G.guild.craftRune(runeKey);
      if (res.ok) {
        log(`🔮 Crafted ${res.rune.name} — it's in your bag. Drag it onto gear in the Party screen.`, 'gold');
        const goldVal = $('wm-header-gold-val');
        if (goldVal) goldVal.textContent = G.gold;
        G.saveGame();
        renderFacilityView('enchanter');
      }
    });
  });



  // Bind War Room Orders and Doctrines
  container.querySelectorAll('.btn-set-slaying-order').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.dataset.orderId;
      if (G.guild.setSlayingOrder(orderId)) {
        log(`🛡️ Issued Slaying Order: ${SLAYING_ORDERS[orderId]?.name}`, 'gold');
        G.saveGame();
        renderFacilityView('war_room');
      }
    });
  });

  container.querySelectorAll('.btn-set-doctrine').forEach(btn => {
    btn.addEventListener('click', () => {
      const docId = btn.dataset.docId;
      if (G.guild.setBattleDoctrine(docId)) {
        log(`⚔️ Enacted Battle Doctrine: ${BATTLE_DOCTRINES[docId]?.name}`, 'gold');
        G.saveGame();
        renderFacilityView('war_room');
      }
    });
  });

  container.querySelectorAll('.btn-tg-buy').forEach(btn => {
    btn.addEventListener('click', () => {
      const res = G.guild.buyTrainingGear(btn.dataset.key);
      const feedback = container.querySelector('#training-action-feedback');
      if (res.ok) {
        const def = TRAINING_GEAR[btn.dataset.key];
        log(`⚔️ Installed a ${def?.name || 'training piece'} in the yard.`, 'sys');
        const goldVal = $('wm-header-gold-val');
        if (goldVal) goldVal.textContent = G.gold;
        G.saveGame();
        renderFacilityView('training_grounds');
      } else if (feedback) {
        feedback.textContent = res.reason || 'Could not buy that.';
      }
    });
  });

  container.querySelectorAll('.btn-tg-upgrade').forEach(btn => {
    btn.addEventListener('click', () => {
      const res = G.guild.upgradeTrainingGear(btn.dataset.id);
      const feedback = container.querySelector('#training-action-feedback');
      if (res.ok) {
        log(`⚔️ Training gear improved to level ${res.level}.`, 'sys');
        const goldVal = $('wm-header-gold-val');
        if (goldVal) goldVal.textContent = G.gold;
        G.saveGame();
        renderFacilityView('training_grounds');
      } else if (feedback) {
        feedback.textContent = res.reason || 'Could not upgrade.';
      }
    });
  });

  container.querySelectorAll('.tg-station-assign').forEach(sel => {
    sel.addEventListener('change', () => {
      const res = G.guild.assignToStation(sel.dataset.id, sel.value || null);
      const feedback = container.querySelector('#training-action-feedback');
      if (res.ok) {
        G.saveGame();
        renderFacilityView('training_grounds');
      } else if (feedback) {
        feedback.textContent = res.reason || 'Could not assign.';
      }
    });
  });

  // Bind Apothecary still recipe
  container.querySelectorAll('.btn-apo-still').forEach(btn => {
    btn.addEventListener('click', () => {
      const res = G.guild.setBrewRecipe(btn.dataset.base);
      const feedback = container.querySelector('#apothecary-action-feedback');
      if (res.ok && !res.unchanged) {
        log(`🧪 The still is now brewing ${btn.dataset.base}.`, 'sys');
        G.saveGame();
        renderFacilityView('apothecary');
      } else if (!res.ok && feedback) {
        feedback.textContent = res.reason || 'Could not set the still.';
      }
    });
  });

}

// ===== Town Guild & Hero Roster Logic =====
function renderTavernPanel() {
  const activeList = $('wm-tavern-active-list');
  const storedList = $('wm-tavern-stored-list');
  const hireList = $('wm-tavern-hire-list');
  const detail = $('wm-tavern-detail-content');
  const activeCount = $('wm-tavern-active-count');
  const storedCount = $('wm-tavern-stored-count');
  const storedCapEl = $('wm-tavern-stored-cap');
  const storedHeading = $('wm-tavern-stored-heading');

  if (!activeList || !storedList || !hireList || !detail || !activeCount) return;

  const bunkCap = G.guild && typeof G.guild.getStoredHeroCap === 'function'
    ? G.guild.getStoredHeroCap()
    : 8;
  const bunkUsed = (G.storedHeroes || []).length;
  const bunksFull = bunkUsed >= bunkCap;
  if (storedCount) storedCount.textContent = bunkUsed;
  if (storedCapEl) storedCapEl.textContent = bunkCap;
  if (storedHeading) storedHeading.classList.toggle('is-full', bunksFull);

  /* Companions that survived the delve ride along in G.heroes; the tavern
     roster is for the people, so they are neither counted nor listed. */
  const roster = G.heroes.map((h, i) => ({ h, i })).filter(e => !e.h.companion);
  activeCount.textContent = roster.length;

  // Render Active Party
  activeList.innerHTML = roster.map(({ h, i }) => {
    const isSel = selTavernHero === h.data && selTavernHeroType === 'active';
    const cls = CLASSES[h.data.classKey];
    return `
      <div class="wm-tavern-card ${isSel ? 'selected' : ''}" data-type="active" data-i="${i}">
        <canvas class="wm-tavern-card-canvas" id="canvas-active-${i}"></canvas>
        <div class="wm-tavern-card-info">
          <div class="wm-tavern-card-name">${h.data.name}</div>
          <div class="wm-tavern-card-meta">Lv ${h.data.level} ${cls.label}</div>
        </div>
      </div>
    `;
  }).join('');

  // Draw canvases for active party
  roster.forEach(({ h, i }) => {
    const canvas = document.getElementById(`canvas-active-${i}`);
    if (canvas) drawHeroPortrait(canvas, h.data);
  });

  // Render Stored Heroes
  if (G.storedHeroes.length === 0) {
    storedList.innerHTML = `<div style="text-align:center; color:#5a6474; font-size:14px; padding: 20px 0;">No stored heroes in tavern. Swap active heroes here to store them.</div>`;
  } else {
    storedList.innerHTML = G.storedHeroes.map((h, i) => {
      const isSel = selTavernHero === h && selTavernHeroType === 'stored';
      const cls = CLASSES[h.classKey];
      return `
        <div class="wm-tavern-card ${isSel ? 'selected' : ''}" data-type="stored" data-i="${i}">
          <canvas class="wm-tavern-card-canvas" id="canvas-stored-${i}"></canvas>
          <div class="wm-tavern-card-info">
            <div class="wm-tavern-card-name">${h.name}</div>
            <div class="wm-tavern-card-meta">Lv ${h.level} ${cls.label}</div>
          </div>
        </div>
      `;
    }).join('');

    // Draw canvases for stored heroes
    G.storedHeroes.forEach((h, i) => {
      const canvas = document.getElementById(`canvas-stored-${i}`);
      if (canvas) drawHeroPortrait(canvas, h);
    });
  }

  // Render Hire Pool
  if (G.townTavernHirePool.length === 0) {
    hireList.innerHTML = `<div style="text-align:center; color:#5a6474; font-size:14px; padding: 20px 0;">All heroes hired.</div>`;
  } else {
    hireList.innerHTML = G.townTavernHirePool.map((h, i) => {
      const isSel = selTavernHero === h && selTavernHeroType === 'hire';
      const cls = CLASSES[h.classKey];
      const price = 100 + (h.level - 1) * 75;
      return `
        <div class="wm-tavern-card ${isSel ? 'selected' : ''}" data-type="hire" data-i="${i}">
          <canvas class="wm-tavern-card-canvas" id="canvas-hire-${i}"></canvas>
          <div class="wm-tavern-card-info">
            <div class="wm-tavern-card-name">${h.name}</div>
            <div class="wm-tavern-card-meta">Lv ${h.level} ${cls.label}</div>
          </div>
          <div class="wm-tavern-card-price">🪙 ${price}g</div>
        </div>
      `;
    }).join('');

    // Draw canvases for hire pool
    G.townTavernHirePool.forEach((h, i) => {
      const canvas = document.getElementById(`canvas-hire-${i}`);
      if (canvas) drawHeroPortrait(canvas, h);
    });
  }

  // Add click handlers for all tavern cards
  const cards = document.querySelectorAll('.wm-tavern-card');
  cards.forEach(card => {
    card.addEventListener('click', () => {
      const type = card.dataset.type;
      const idx = +card.dataset.i;

      if (type === 'active') {
        selTavernHero = G.heroes[idx].data;
      } else if (type === 'stored') {
        selTavernHero = G.storedHeroes[idx];
      } else if (type === 'hire') {
        selTavernHero = G.townTavernHirePool[idx];
      }
      selTavernHeroType = type;
      renderTavernPanel();
    });
  });

  // Render Detail card
  if (selTavernHero) {
    const cls = CLASSES[selTavernHero.classKey];
    const race = RACES[selTavernHero.raceKey];
    const price = 100 + (selTavernHero.level - 1) * 75;

    let btnText = '';
    let btnClass = 'btn primary';
    let allowed = false;
    let clickHandler = null;
    let warnMsg = '';

    if (selTavernHeroType === 'active') {
      btnText = 'Send to Stored (Tavern)';
      const lastHero = G.realHeroes().length <= 1;
      const noBunk = G.guild && typeof G.guild.canStoreHero === 'function' && !G.guild.canStoreHero();
      allowed = !lastHero && !noBunk;
      if (lastHero) warnMsg = 'Cannot store the last active hero.';
      else if (noBunk) warnMsg = 'Bunks are full.';

      clickHandler = () => {
        if (G.guild && typeof G.guild.canStoreHero === 'function' && !G.guild.canStoreHero()) return;
        const wrap = G.heroes.find(h => h.data === selTavernHero);
        if (wrap) {
          /* keep the leader designation pinned to the same hero across the
             roster reshuffle (indices shift when someone is stored) */
          const ldr = G.heroes[G.leaderIdx || 0];
          G.heroes = G.heroes.filter(h => h !== wrap);
          G.leaderIdx = (ldr && ldr !== wrap) ? Math.max(0, G.heroes.indexOf(ldr)) : 0;
          G.storedHeroes.push(selTavernHero);
          log(`🍻 Stored ${selTavernHero.name} in the tavern.`, 'sys');
          G.saveGame();

          selTavernHero = null;
          selTavernHeroType = null;
          renderTavernPanel();
        }
      };

    } else if (selTavernHeroType === 'stored') {
      btnText = 'Add to Active Party';
      allowed = G.realHeroes().length < 4; // Max 4 active
      if (!allowed) warnMsg = 'Active party is full (maximum 4).';

      clickHandler = () => {
        const idx = G.storedHeroes.indexOf(selTavernHero);
        if (idx >= 0 && G.realHeroes().length < 4) {
          G.storedHeroes.splice(idx, 1);
          G.heroes.push({ data: selTavernHero });
          log(`🍻 ${selTavernHero.name} joined the active party.`, 'sys');
          G.saveGame();

          selTavernHero = null;
          selTavernHeroType = null;
          renderTavernPanel();
        }
      };

    } else if (selTavernHeroType === 'hire') {
      btnText = `Hire for ${price}g`;
      const needsBunk = G.realHeroes().length >= 4;
      const noBunk = needsBunk && G.guild && typeof G.guild.canStoreHero === 'function' && !G.guild.canStoreHero();
      allowed = G.gold >= price && !noBunk;
      if (G.gold < price) warnMsg = 'Not enough gold.';
      else if (noBunk) warnMsg = 'Bunks are full.';

      clickHandler = () => {
        const idx = G.townTavernHirePool.indexOf(selTavernHero);
        if (idx >= 0 && G.gold >= price) {
          const partyFull = G.realHeroes().length >= 4;
          if (partyFull && G.guild && typeof G.guild.canStoreHero === 'function' && !G.guild.canStoreHero()) return;
          G.gold -= price;
          G.townTavernHirePool.splice(idx, 1);

          // Add directly to active party if there is room, otherwise stored
          if (!partyFull) {
            G.heroes.push({ data: selTavernHero });
            log(`🍻 Hired ${selTavernHero.name} (joined the active party).`, 'sys');
          } else {
            G.storedHeroes.push(selTavernHero);
            log(`🍻 Hired ${selTavernHero.name} (stored in the tavern).`, 'sys');
          }

          updateResources(G);
          G.saveGame();

          selTavernHero = null;
          selTavernHeroType = null;

          // Refresh gold in header
          const goldVal = $('wm-header-gold-val');
          if (goldVal) goldVal.textContent = G.gold;

          renderTavernPanel();
        }
      };
    }

    const statsHTML = ABILITIES.map(ab => {
      const val = selTavernHero.stats[ab] || 8;
      return `
        <div class="wm-tavern-stat-box">
          <div class="wm-tavern-stat-label">${ab}</div>
          <div class="wm-tavern-stat-val">${val}</div>
        </div>
      `;
    }).join('');

    detail.innerHTML = `
      <div class="wm-tavern-detail-card">
        <div class="wm-tavern-detail-header">
          <canvas class="wm-tavern-detail-canvas" id="canvas-detail-hero"></canvas>
          <div class="wm-tavern-card-info">
            <div class="wm-tavern-detail-name">${selTavernHero.name}</div>
            <div class="wm-tavern-detail-meta">Lv ${selTavernHero.level} ${cls.label} · ${race.label}</div>
          </div>
        </div>

        <div class="wm-tavern-stats-grid">
          ${statsHTML}
        </div>

        <div class="wm-tavern-desc-box">
          <strong>Racial Trait:</strong> ${race.trait}<br>
          <strong style="margin-top:6px; display:inline-block;">Class:</strong> ${cls.feature}
        </div>

        ${selTavernHeroType === 'stored' && G.guild ? `
          <div style="margin: 10px 0; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px; border: 1px solid var(--px-border, #333);">
            <label style="font-size: 11px; color: var(--px-gold); display: block; margin-bottom: 4px;">Assign to Guild Facility:</label>
            <select id="guild-facility-select" style="width: 100%; background: #1a1e24; color: #fff; border: 1px solid #444; padding: 4px; font-family: inherit; font-size: 12px;">
              <option value="">None (Unassigned)</option>
              ${Object.values(FACILITY_DEFINITIONS).filter(fac => fac.assignable !== false).map(fac => {
                const isAssigned = G.guild.heroAssignments[selTavernHero.name] === fac.id;
                return `<option value="${fac.id}" ${isAssigned ? 'selected' : ''}>${fac.icon} ${fac.name}</option>`;
              }).join('')}
            </select>
          </div>
        ` : ''}

        <div style="margin-top:auto;">
          <button id="wm-tavern-action-btn" class="${btnClass}" ${allowed ? '' : 'disabled'} style="width:100%; padding:10px;">${btnText}</button>
          ${warnMsg ? `<div style="color:#e0483a; font-size:14px; text-align:center; margin-top:6px;">${warnMsg}</div>` : ''}
        </div>
      </div>
    `;

    // Draw portrait for detail hero
    const detailCanvas = $('canvas-detail-hero');
    if (detailCanvas) drawHeroPortrait(detailCanvas, selTavernHero);

    $('wm-tavern-action-btn').addEventListener('click', clickHandler);

    const facSelect = $('guild-facility-select');
    if (facSelect) {
      facSelect.addEventListener('change', () => {
        const val = facSelect.value;
        G.guild.assignHero(selTavernHero.name, val);
        log(`🏰 Assigned ${selTavernHero.name} to ${val ? FACILITY_DEFINITIONS[val].name : 'no facility'}.`, 'sys');
        G.saveGame();
        renderTavernPanel();
      });
    }

  } else {
    detail.innerHTML = `<div style="text-align:center; color:#5a6474; font-size:16px; margin-top:40px;">Select a hero from any roster to view stats and manage them.</div>`;
  }
}

// ===== Hirable Hero Generator Helpers =====
function generateBaseStatsForClass(classKey) {
  const priority = CLASSES[classKey].statPriority;
  const values = [15, 14, 13, 12, 10, 8];
  const stats = {};
  priority.forEach((ab, idx) => {
    stats[ab] = values[idx];
  });
  return stats;
}

function generateRandomHeroForHire(level) {
  /* Playable lists only — the wolf race/class pair is the ranger companion's
     stat block and must never turn up as a hero for hire. */
  const races = PLAYABLE_RACES.map(([k]) => k);
  const classes = PLAYABLE_CLASSES.map(([k]) => k);
  const raceKey = races[Math.floor(Math.random() * races.length)];
  const classKey = classes[Math.floor(Math.random() * classes.length)];

  // Pick a random gender & name
  const gender = Math.random() > 0.5 ? 'male' : 'female';

  // Choose names based on race
  const RACE_NAMES = {
    human:     ['Aldric','Bram','Kira','Garrick','Isolde','Lyra','Fenn','Magda','Vessa','Piotr','Elara','Caelum'],
    dwarf:     ['Thoradin','Brunhilda','Durak','Helga','Torvi','Brynhild','Mardred','Odin','Freya','Gimli','Hilda','Borin'],
    elf:       ['Sariel','Wren','Aelar','Elara','Finrod','Lúthien','Celeborn','Galadriel','Legolas','Arwen','Theron','Aelindra'],
    halfling:  ['Toby','Doric','Nyx','Cade','Poppy','Rosie','Frodo','Bilbo','Merry','Pippin','Lila','Cori'],
    halforc:   ['Garosh','Thrak','Mog','Ugga','Korr','Hagra','Drok','Orok','Zug','Grisha','Draka','Ruk'],
    dragonborn:['Dracarys','Vermithrax','Krayt','Bahamut','Tiamat','Ignis','Arid','Sul','Keth','Sizzix','Nazir','Ragnar'],
    gnome:     ['Fizzwick','Tinka','Nackle','Gimble','Namfoodle','Wixy','Zook','Bibble','Lilli','Bimp','Pip','Nix'],
    halfelf:   ['Sylvan','Kael','Thalia','Ilyana','Caelen','Seraphine','Aldris','Mira','Orin','Lira','Vael','Mira'],
    tiefling:  ['Zariel','Mephis','Lilith','Raziel','Shadow','Ember','Mort','Hellrider','Nyx','Vex','Korr','Sable']
  };
  const pool = RACE_NAMES[raceKey] || ['Hero'];
  const baseName = pool[Math.floor(Math.random() * pool.length)];
  const lastName = ['Shadow', 'Stone', 'Bright', 'Iron', 'Whisper', 'Swift', 'Oaken', 'Flame', 'Gloom', 'Storm'][Math.floor(Math.random() * 10)];
  const name = `${baseName} ${lastName}`;


  const rd = getRaceDefaults(raceKey);
  const visual = {
    gender,
    head: rd.head,
    /* half the time the recruit strays off their race's default skin tone,
       but always within that race's own palette */
    skinColor: Math.random() < 0.5
      ? rd.skinColor
      : skinColorsFor(raceKey)[Math.floor(Math.random() * skinColorsFor(raceKey).length)],
    /* Tavern recruits draw from the same catalogue the character creator
       offers, so a hired hero can look like anything the player can build. */
    hair: HAIR_VALUES[1 + Math.floor(Math.random() * (HAIR_VALUES.length - 1))],
    hairExtension: Math.random() < 0.2
      ? HAIR_EXTENSION_VALUES[1 + Math.floor(Math.random() * (HAIR_EXTENSION_VALUES.length - 1))]
      : 'none',
    hairExtColor: '',
    facialHair: rd.facialHair !== 'none' || Math.random() > 0.3
      ? rd.facialHair
      : FACIAL_HAIR_VALUES[1 + Math.floor(Math.random() * (FACIAL_HAIR_VALUES.length - 1))],
    hairColor: Math.random() < 0.5 ? rd.hairColor : HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)],
    eyeColor: rd.eyeColor,
    ears: rd.ears,
    horns: rd.horns || 'none',
    spriteScaleX: rd.spriteScaleX || 1.0,
    spriteScaleY: rd.spriteScaleY || 1.0
  };

  const baseStats = generateBaseStatsForClass(classKey);
  const hero = makeHero(name, raceKey, classKey, baseStats, visual);

  if (level > 1) {
    const xpNeeded = XP_TABLE[level] || 0;
    grantXp(hero, xpNeeded, null);
    hero.hp = hero.maxHp;
  }

  return hero;
}
