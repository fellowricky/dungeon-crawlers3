/**
 * World Map / Quest selection overlay, now with Shop and Tavern tabs.
 */
import { generateQuests } from './quests.js';
import { prologueSummary } from './overland_prologue.js';
import { storyMissionState, makeStoryQuest } from './story.js';
import { showBriefing } from './story_dialog.js';
import { getSequelOffers } from './quest_events.js';
import { rollItem, makeDye, perkText, bonusText, ilvlText, migrateItem } from './items.js';
import { makeHero, normalizeHero, RACES, CLASSES, PLAYABLE_RACES, PLAYABLE_CLASSES,
         ABILITIES, XP_TABLE, grantXp, getDefaultProficiencies } from './srd.js';
import { drawHeroPortrait } from './sprite_animator.js';
import { HAIR_VALUES, HAIR_EXTENSION_VALUES, FACIAL_HAIR_VALUES, HAIR_COLORS,
         skinColorsFor, getRaceDefaults } from './appearance.js';
import { log, updateResources } from './ui.js';
import { playNarration, stopNarration } from './audio.js';
import { refreshMenus, openMenu } from './menus.js';
import { FACILITY_DEFINITIONS, getApothecaryBrewOutput, INJURY_TYPES, ANCESTRAL_RELICS } from './guild.js';

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
    return `<img class="${className}" src="./${icon}" style="width:28px;height:28px;image-rendering:pixelated;vertical-align:middle;margin-right:4px;" />`;
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
    menu.classList.add('show');
  });

  const saveBtn = $('sys-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', () => {
    if (G) { G.saveGame(); flash('Game saved.'); }
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
      const markup = RARITY_MARKUP[item.rarity] || 4;
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

function renderNodes() {
  const root = $('wm-quest-nodes');
  if (!root) return;
  root.innerHTML = quests.map((q, i) => {
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

function launchStoryQuest(q) {
  hideWorldMap();
  G.startQuest(q);
  log(`📖 Chapter ${q.chapter}: ${q.name} — the party sets out for ${q.place}.`, 'sys');
  if (q.embarkText) {
    log(q.embarkText, 'story');
    playNarration(`${q.id}_embark`);
  }
  updateResources(G);
}

function embarkSelected() {
  if (!selected || !G) return;
  const q = selected;
  hideWorldMap();
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
    return ['glove', 'amulet', 'ring', 'kit'].includes(item.slot);
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
      return `<div class="bag-item ${isSel ? 'sel' : ''}" data-i="${i}" style="border-color:${color}">
        <span class="bag-ico">${itemIconHTML(item.icon)}</span>
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
        content = `
          <div class="id-name" style="color:${it.color}">${itemIconHTML(it.icon)} ${it.name}</div>
          <div class="id-slot">${cap(it.slot)} — ${cap(it.rarity)} · ${ilvlText(it)}</div>
          <div class="id-bonus" style="margin-top:10px">${bonusText(it) || 'No bonuses'}</div>
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
            G.inventory.push(shopObj.item);
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

      btnText = `Sell for ${item.value}g`;
      clickHandler = () => {
        const idx = G.inventory.indexOf(item);
        if (idx >= 0) {
          G.inventory.splice(idx, 1);
          G.gold += item.value;
          log(`💰 Sold ${item.name} for ${item.value}g.`, 'treasure');
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
  initGuildSubtabs();
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
    actionHtml = `
      <div style="background: rgba(220, 53, 69, 0.15); border: 2px solid #dc3545; padding: 16px; border-radius: 4px; text-align: center;">
        <h4 style="color: #ff6b6b; margin-top: 0;">🔒 Facility Locked (Level 0)</h4>
        <p style="color: #b0bec5; font-size: 13px; margin-bottom: 14px;">Build and unlock ${fac.name} to assign heroes and access facility features.</p>
        <button class="btn primary btn-upgrade-fac-lg" style="padding: 10px 20px; font-size: 13px;" ${canAfford ? '' : 'disabled'}>
          Build / Unlock Facility (🪙 ${cost}g)
        </button>
      </div>
    `;
  } else {
    let featureHtml = '';

    if (facilityId === 'blacksmith') {
      const invItems = (G.inventory || []).filter(i => i && i.kind !== 'potion' && i.kind !== 'dye' && i.slot);
      const discount = G.guild.getEquipmentDiscountPercent();

      const itemsGridHtml = invItems.length === 0 ? `
        <div style="color: #8a9ba8; font-size: 12px; grid-column: 1 / -1; text-align: center; padding: 20px;">
          No unequipped gear in inventory to enhance.
        </div>
      ` : invItems.map((item, idx) => {
        const color = item.color || '#ccc';
        const isSel = selForgeItem === item;
        const enhanceLvl = item.enhanceLevel ? `+${item.enhanceLevel}` : '';
        return `
          <div class="bag-item ${isSel ? 'sel' : ''}" data-forge-idx="${idx}" style="border-color:${color}; position: relative;">
            <span class="bag-ico">${itemIconHTML(item.icon)}</span>
            ${enhanceLvl ? `<span style="position: absolute; top: 2px; right: 4px; font-size: 10px; color: #4caf50; font-weight: bold;">${enhanceLvl}</span>` : ''}
            <span class="bag-r" style="background:${color}"></span>
          </div>
        `;
      }).join('');

      let selectedDetailsHtml = `<div style="color: #8a9ba8; font-size: 12px; text-align: center; padding: 20px;">Click an item from your inventory grid to enhance or re-roll it.</div>`;

      if (selForgeItem) {
        const enhanceCost = Math.max(50, Math.floor(150 * (1 - discount)));
        const canEnhance = G.gold >= enhanceCost;

        selectedDetailsHtml = `
          <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--px-border, #444); padding: 12px; border-radius: 4px; display: flex; flex-direction: column; gap: 8px;">
            <div style="font-weight: bold; color: ${selForgeItem.color || '#fff'}; font-size: 14px;">
              ${selForgeItem.name} ${selForgeItem.enhanceLevel ? `(+${selForgeItem.enhanceLevel})` : ''}
            </div>
            <div style="font-size: 12px; color: #cfd8dc;">
              <strong>Slot:</strong> ${selForgeItem.slot || selForgeItem.kind || 'Gear'} | 
              <strong>Rarity:</strong> ${selForgeItem.rarity || 'common'}
            </div>
            <div style="font-size: 11px; color: #8a9ba8;">
              Base Stats: ${selForgeItem.atk ? `+${selForgeItem.atk} ATK ` : ''}${selForgeItem.def ? `+${selForgeItem.def} DEF ` : ''}
            </div>
            <div style="display: flex; gap: 8px; margin-top: 6px;">
              <button id="btn-forge-enhance" class="btn primary" style="flex: 1; padding: 8px;" ${canEnhance ? '' : 'disabled'}>
                ⚒️ Enhance (+1 Stat) (🪙 ${enhanceCost}g)
              </button>
            </div>
          </div>
        `;
      }

      featureHtml = `
        <div class="facility-interactive-box">
          <h4 style="color: var(--px-gold); margin: 0 0 4px 0;">⚒️ Equipment Forge & Inventory</h4>
          <p style="font-size: 11px; color: #b0bec5; margin: 0 0 10px 0;">Select an item from your inventory to enhance stat bonuses (Discount: ${Math.round(discount * 100)}%).</p>
          
          <div style="display: grid; grid-template-columns: 1fr 300px; gap: 16px; flex: 1; min-height: 0; height: 100%;">
            <div style="display: flex; flex-direction: column; min-height: 0; height: 100%;">
              <h5 style="color: #8a9ba8; margin: 0 0 8px 0; font-size: 12px;">Inventory Equipment:</h5>
              <div class="forge-inventory-grid" id="forge-inventory-grid">
                ${itemsGridHtml}
              </div>
            </div>
            <div style="display: flex; flex-direction: column; min-height: 0; height: 100%;">
              <h5 style="color: #8a9ba8; margin: 0 0 8px 0; font-size: 12px;">Selected Equipment Details:</h5>
              ${selectedDetailsHtml}
              <div id="blacksmith-action-feedback" style="margin-top: 8px; font-size: 12px; color: #4caf50;"></div>
            </div>
          </div>
        </div>
      `;
    } else if (facilityId === 'armory') {
      /* Two grids side by side: unequipped party gear on the left, the Armory's
         contents on the right. Clicking an item moves it across — no drag, no
         confirm, matching how the Blacksmith grid already behaves. */
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
        ? empty('No unequipped gear to store.')
        : invGear.map((it, i) => cell(it, i, 'data-armory-dep')).join('');
      const storedGridHtml = stored.length === 0
        ? empty('The Armory is empty.')
        : stored.map((it, i) => cell(it, i, 'data-armory-wd')).join('');

      featureHtml = `
        <div class="facility-interactive-box">
          <h4 style="color: var(--px-gold); margin: 0 0 4px 0;">🗄️ Armory Storage</h4>
          <p style="font-size: 11px; color: #b0bec5; margin: 0 0 10px 0;">
            Click gear to move it in or out of storage. Stored gear persists across every delve.
            <strong style="color:${free === 0 ? '#e0483a' : '#4caf50'};">${stored.length} / ${cap} slots used</strong>
          </p>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; flex: 1; min-height: 0; height: 100%;">
            <div style="display: flex; flex-direction: column; min-height: 0; height: 100%;">
              <h5 style="color: #8a9ba8; margin: 0 0 8px 0; font-size: 12px;">Party Inventory → deposit:</h5>
              <div class="bag-grid" id="armory-inv-grid" style="overflow-y: auto; flex: 1; min-height: 0;">${invGridHtml}</div>
              <button id="btn-armory-deposit-all" class="btn" style="margin-top: 8px; padding: 6px; font-size: 11px;" ${invGear.length && free ? '' : 'disabled'}>
                ⬇ Deposit All Gear
              </button>
            </div>
            <div style="display: flex; flex-direction: column; min-height: 0; height: 100%;">
              <h5 style="color: #8a9ba8; margin: 0 0 8px 0; font-size: 12px;">Armory → withdraw:</h5>
              <div class="bag-grid" id="armory-stored-grid" style="overflow-y: auto; flex: 1; min-height: 0;">${storedGridHtml}</div>
              <div id="armory-action-feedback" style="margin-top: 8px; font-size: 12px; color: #e0483a; min-height: 16px;"></div>
            </div>
          </div>
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

      const brewInfo = getApothecaryBrewOutput(lvl, heroInt, 10);
      const floorsProgress = G.guild.apothecaryFloors || 0;
      const progressPercent = Math.min(100, Math.round((floorsProgress / 10) * 100));

      featureHtml = `
        <div class="facility-interactive-box" style="margin-top: 12px; gap: 10px;">
          <h4 style="color: var(--px-gold); margin-top: 0;">🧪 Automated Potion Alchemy</h4>
          <p style="font-size: 12px; color: #b0bec5; margin-bottom: 8px;">
            Assigned Alchemist brews potions automatically every <strong>10 dungeon floors cleared</strong> based on Apothecary Level (Lvl ${lvl}) and Hero Intelligence (${heroInt} INT).
          </p>

          <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 4px; border: 1px solid #333; display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; justify-content: space-between; font-size: 12px;">
              <span><strong>Alchemist:</strong> ${heroNameDisplay}</span>
              <span style="color: #4caf50; font-weight: bold;">Next Batch Yield: ${brewInfo.quantityPer10}x ${brewInfo.tierLabel}</span>
            </div>

            <div>
              <div style="display: flex; justify-content: space-between; font-size: 11px; color: #8a9ba8; margin-bottom: 4px;">
                <span>Floor Progress:</span>
                <span>${floorsProgress} / 10 Floors</span>
              </div>
              <div style="background: #101418; border: 1px solid #333; height: 14px; border-radius: 7px; overflow: hidden;">
                <div style="background: linear-gradient(90deg, #2e7d32, #4caf50); height: 100%; width: ${progressPercent}%; transition: width 0.3s ease;"></div>
              </div>
            </div>
          </div>
        </div>
      `;
    } else if (facilityId === 'infirmary') {
      const assignedHeroName = assignedHeroes[0];
      let chirurgeonWis = 10;
      let chirurgeonNameDisplay = 'None Assigned';

      if (assignedHeroName) {
        const heroObj = (G.storedHeroes || []).find(h => h.name === assignedHeroName) ||
                        (G.heroes || []).map(h => h.data).find(h => h.name === assignedHeroName);
        if (heroObj) {
          chirurgeonWis = heroObj.stats?.wis || heroObj.stats?.WIS || 10;
          chirurgeonNameDisplay = `${heroObj.name} (WIS: ${chirurgeonWis})`;
        }
      }

      const activeTreatments = G.guild.infirmaryTreatments || {};
      const activeTreatmentsList = Object.entries(activeTreatments).map(([hName, tData]) => {
        const def = INJURY_TYPES[tData.injuryId] || { name: tData.injuryId, penaltyText: '', healCost: 100 };
        const salveCost = Math.max(30, Math.floor(def.healCost * (1 - lvl * 0.05)));
        const canAffordSalve = G.gold >= salveCost;
        return `
          <div style="background: rgba(0,0,0,0.3); border: 1px solid #444; padding: 10px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div>
              <strong style="color: #ff6b6b;">${hName}</strong> — <span style="color: #cfd8dc;">${def.name} (${def.penaltyText})</span>
              <div style="font-size: 11px; color: #4caf50; margin-top: 2px;">Floors Remaining in Bed: ${tData.floorsRemaining} floors</div>
            </div>
            <button class="btn primary btn-miracle-salve" data-hero="${hName}" data-injury="${tData.injuryId}" style="padding: 6px 12px; font-size: 11px;" ${canAffordSalve ? '' : 'disabled'}>
              🧪 Miracle Salve (🪙 ${salveCost}g)
            </button>
          </div>
        `;
      }).join('');

      featureHtml = `
        <div class="facility-interactive-box">
          <h4 style="color: var(--px-gold); margin: 0 0 4px 0;">🩺 Head Chirurgeon Triage & Recovery Beds</h4>
          <p style="font-size: 11px; color: #b0bec5; margin: 0 0 10px 0;">
            Head Chirurgeon: <strong>${chirurgeonNameDisplay}</strong>. Assigned beds passively heal trauma over dungeon floor clears, or use Miracle Salves for instant recovery.
          </p>

          <div style="flex: 1; overflow-y: auto; min-height: 0;">
            <h5 style="color: #8a9ba8; margin: 0 0 8px 0; font-size: 12px;">Active Patient Recovery Beds:</h5>
            ${activeTreatmentsList || '<div style="color: #8a9ba8; font-size: 12px; text-align: center; padding: 20px;">No heroes currently in treatment beds. Injured heroes can be assigned here for recovery.</div>'}
          </div>
          <div id="infirmary-action-feedback" style="margin-top: 8px; font-size: 12px; color: #4caf50;"></div>
        </div>
      `;
    } else if (facilityId === 'crypt') {
      const activeRelic = G.guild.activeAncestralRelic || 'tomb_guard';
      const soulTokens = G.soulTokens || 0;
      const tokenCost = Math.max(100, 250 - lvl * 15);
      const canAffordToken = G.gold >= tokenCost;

      const relicOptionsHtml = Object.values(ANCESTRAL_RELICS).map(rel => {
        const isSelected = activeRelic === rel.id;
        return `
          <div class="relic-card ${isSelected ? 'selected' : ''}" data-relic="${rel.id}" style="background: ${isSelected ? 'rgba(232, 194, 90, 0.15)' : 'rgba(0,0,0,0.3)'}; border: 1px solid ${isSelected ? '#e8c25a' : '#444'}; padding: 10px; border-radius: 4px; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong style="color: ${isSelected ? '#e8c25a' : '#fff'}; font-size: 13px;">${rel.name}</strong>
              <div style="font-size: 11px; color: #8a9ba8;">${rel.statBonus}</div>
            </div>
            ${isSelected ? '<span style="color: #e8c25a; font-size: 11px; font-weight: bold;">[ACTIVE RELIC]</span>' : '<button class="btn primary btn-select-relic" data-relic="' + rel.id + '" style="padding: 4px 8px; font-size: 10px;">Equip</button>'}
          </div>
        `;
      }).join('');

      featureHtml = `
        <div class="facility-interactive-box">
          <h4 style="color: var(--px-gold); margin: 0 0 4px 0;">🪦 Ancestral Reliquary & Soul Tokens</h4>
          <p style="font-size: 11px; color: #b0bec5; margin: 0 0 10px 0;">
            Equip ancestral relic blessings for your active party and craft mid-run Soul Resurrect Tokens.
          </p>

          <div style="display: grid; grid-template-columns: 1fr 280px; gap: 16px; flex: 1; min-height: 0;">
            <div style="display: flex; flex-direction: column; gap: 8px; overflow-y: auto; min-height: 0;">
              <h5 style="color: #8a9ba8; margin: 0; font-size: 12px;">Active Party Ancestral Relics:</h5>
              ${relicOptionsHtml}
            </div>

            <div style="background: rgba(0,0,0,0.3); border: 1px solid #444; padding: 12px; border-radius: 4px; display: flex; flex-direction: column; gap: 10px; justify-content: space-between;">
              <div>
                <h5 style="color: var(--px-gold); margin: 0 0 6px 0; font-size: 13px;">🔮 Soul Resurrect Tokens</h5>
                <div style="font-size: 12px; color: #cfd8dc;">Owned Tokens: <strong style="color: #4caf50;">${soulTokens}</strong></div>
                <div style="font-size: 11px; color: #8a9ba8; margin-top: 4px;">Soul tokens allow 1 mid-dungeon party revive when wiped.</div>
              </div>

              <button id="btn-craft-soul-token" class="btn primary" style="padding: 8px; font-size: 11px;" ${canAffordToken ? '' : 'disabled'}>
                Forge Soul Token (🪙 ${tokenCost}g)
              </button>
            </div>
          </div>
          <div id="crypt-action-feedback" style="margin-top: 8px; font-size: 12px; color: #4caf50;"></div>
        </div>
      `;
    } else if (facilityId === 'training_grounds') {
      featureHtml = `
        <div class="facility-interactive-box" style="margin-top: 16px;">
          <h4 style="color: var(--px-gold); margin-top: 0;">⚔️ Active Training Overview</h4>
          <p style="font-size: 12px; color: #b0bec5;">Assigned heroes passively gain <strong>25% of all active dungeon party XP</strong>.</p>
          <div style="font-size: 12px; color: #4caf50;">
            Currently Training (${assignedHeroes.length} heroes): ${assignedHeroes.length > 0 ? assignedHeroes.join(', ') : 'None'}
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
          <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px;">
            <label style="font-size: 11px; color: var(--px-gold); font-weight: bold;">Assigned Hero:</label>
            <select id="fac-hero-assign-select" style="padding: 4px 8px; background: #14181d; color: #fff; border: 1px solid #444; font-size: 11px; max-width: 240px;">
              <option value="">-- Unassigned --</option>
              ${availableStoredHeroes.map(h => `<option value="${h.name}" ${assignedHeroes.includes(h.name) ? 'selected' : ''}>${h.name} (Lv ${h.level})</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="facility-status-box">
          <div>
            <div style="font-size: 15px; font-weight: bold; color: var(--px-gold);">Level ${lvl} / ${fac.maxLevel}</div>
            <div style="font-size: 12px; color: #4caf50; font-weight: bold; margin-top: 2px;">${fac.getEffectText(lvl)}</div>
          </div>
          <button class="btn primary btn-upgrade-fac-lg" style="padding: 8px 16px; font-size: 11px;" ${canAfford ? '' : 'disabled'}>
            ${maxed ? 'MAX LEVEL' : `Upgrade Facility (🪙 ${cost}g)`}
          </button>
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

  // Bind Armory deposit / withdraw. The grids index into freshly-filtered
  // snapshots, so every handler re-resolves the item from the same lists the
  // markup was built from and lets the GuildManager reject stale clicks.
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

  // Bind Forge enhance button
  const enhanceBtn = container.querySelector('#btn-forge-enhance');
  if (enhanceBtn && selForgeItem) {
    enhanceBtn.addEventListener('click', () => {
      const feedback = container.querySelector('#blacksmith-action-feedback');
      const discount = G.guild.getEquipmentDiscountPercent();
      const cost = Math.max(50, Math.floor(150 * (1 - discount)));

      if (G.gold < cost) {
        if (feedback) feedback.textContent = 'Not enough gold!';
        return;
      }
      G.gold -= cost;
      selForgeItem.enhanceLevel = (selForgeItem.enhanceLevel || 0) + 1;
      if (selForgeItem.atk) selForgeItem.atk += 1;
      if (selForgeItem.def) selForgeItem.def += 1;

      const goldVal = $('wm-header-gold-val');
      if (goldVal) goldVal.textContent = G.gold;

      log(`⚒️ Blacksmith enhanced ${selForgeItem.name} to +${selForgeItem.enhanceLevel}!`, 'gold');
      G.saveGame();
      renderFacilityView('blacksmith');
    });
  }

  // Bind Infirmary Miracle Salve buttons
  container.querySelectorAll('.btn-miracle-salve').forEach(btn => {
    btn.addEventListener('click', () => {
      const heroName = btn.dataset.hero;
      const injuryId = btn.dataset.injury;
      if (G.guild.cureWithMiracleSalve(heroName, injuryId)) {
        log(`🩺 Head Chirurgeon applied Miracle Salve to cure ${heroName}!`, 'gold');
        const goldVal = $('wm-header-gold-val');
        if (goldVal) goldVal.textContent = G.gold;
        renderFacilityView('infirmary');
      }
    });
  });

  // Bind Crypt Ancestral Relic selection
  container.querySelectorAll('.btn-select-relic').forEach(btn => {
    btn.addEventListener('click', () => {
      const relicId = btn.dataset.relic;
      G.guild.activeAncestralRelic = relicId;
      log(`🪦 Equipped Ancestral Relic: ${ANCESTRAL_RELICS[relicId]?.name}`, 'gold');
      G.saveGame();
      renderFacilityView('crypt');
    });
  });

  // Bind Crypt Soul Token craft button
  const soulTokenBtn = container.querySelector('#btn-craft-soul-token');
  if (soulTokenBtn) {
    soulTokenBtn.addEventListener('click', () => {
      if (G.guild.craftSoulToken()) {
        log(`🔮 Forged 1x Soul Resurrect Token at the Crypt!`, 'gold');
        const goldVal = $('wm-header-gold-val');
        if (goldVal) goldVal.textContent = G.gold;
        G.saveGame();
        renderFacilityView('crypt');
      }
    });
  }
}

// ===== Town Guild & Hero Roster Logic =====
function renderTavernPanel() {
  const activeList = $('wm-tavern-active-list');
  const storedList = $('wm-tavern-stored-list');
  const hireList = $('wm-tavern-hire-list');
  const detail = $('wm-tavern-detail-content');
  const activeCount = $('wm-tavern-active-count');

  if (!activeList || !storedList || !hireList || !detail || !activeCount) return;

  activeCount.textContent = G.heroes.length;

  // Render Active Party
  activeList.innerHTML = G.heroes.map((h, i) => {
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
  G.heroes.forEach((h, i) => {
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
      allowed = G.realHeroes().length > 1; // Must have at least 1 real hero active
      if (!allowed) warnMsg = 'Cannot store the last active hero.';

      clickHandler = () => {
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
      allowed = G.gold >= price;
      if (!allowed) warnMsg = 'Not enough gold.';

      clickHandler = () => {
        const idx = G.townTavernHirePool.indexOf(selTavernHero);
        if (idx >= 0 && G.gold >= price) {
          G.gold -= price;
          G.townTavernHirePool.splice(idx, 1);

          // Add directly to active party if there is room, otherwise stored
          if (G.realHeroes().length < 4) {
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
              ${Object.values(FACILITY_DEFINITIONS).map(fac => {
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
        renderGuildFacilities();
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
