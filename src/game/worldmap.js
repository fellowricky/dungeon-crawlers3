/**
 * World Map / Quest selection overlay, now with Shop and Tavern tabs.
 */
import { generateQuests } from './quests.js';
import { getSequelOffers } from './quest_events.js';
import { rollItem, perkText, bonusText, ilvlText, migrateItem } from './items.js';
import { makeHero, normalizeHero, RACES, CLASSES, ABILITIES, XP_TABLE, grantXp, getDefaultProficiencies } from './srd.js';
import { drawHeroPortrait } from './sprite_animator.js';
import { log, updateResources } from './ui.js';
import { refreshMenus } from './menus.js';

let G = null;
let open = false;
let quests = [];
let selected = null;

let currentTab = 'map';
let selShopItem = null;
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

  // 1. Generate quests
  if (refresh || !quests.length) {
    const sequels = getSequelOffers(G, partyLevel()).slice(0, 2);
    const randomCount = Math.max(1, 3 - sequels.length);
    quests = [
      ...sequels,
      ...generateQuests(partyLevel(), randomCount, {
        excludePositions: sequels.map(s => s.mapLocation)
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
    const numItems = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numItems; i++) {
      const item = rollItem(pLevel);
      const markup = RARITY_MARKUP[item.rarity] || 4;
      shopInventory.push({ type: 'gear', item: item, price: Math.round(item.value * markup) });
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
  const screen = $('worldmapscreen');
  if (screen) screen.classList.remove('show');
  if (G) G.setPaused(false);
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
  } else if (tab === 'shop') {
    renderShopPanel();
  } else if (tab === 'tavern') {
    renderTavernPanel();
  }
}

function renderNodes() {
  const root = $('wm-quest-nodes');
  if (!root) return;
  root.innerHTML = quests.map((q, i) => {
    const leg = q.isLegendaryReward ? ' legendary-quest' : '';
    const chain = q.chain ? ' chain-quest' : '';
    const chainTag = q.chain ? (q.chain.part === 2 ? 'Ⅱ ' : 'Ⅲ ') : '';
    return `<div class="quest-node theme-${q.theme}${leg}${chain}${selected === q ? ' active' : ''}"
      data-i="${i}" style="left:${q.mapLocation.x}%; top:${q.mapLocation.y}%;">
      <div class="quest-node-pulse"></div>
      <div class="quest-node-pin"></div>
      <div class="quest-node-label">${chainTag}${q.isLegendaryReward ? '★ ' : ''}${q.name.replace(/^The /, '')}</div>
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
  $('wm-quest-floors').textContent = String(q.floors);
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

// ===== Town Shop Panel Logic =====
function renderShopPanel() {
  const buyGrid = $('wm-shop-buy-grid');
  const sellGrid = $('wm-shop-sell-grid');
  const detail = $('wm-shop-detail-content');

  if (!buyGrid || !sellGrid || !detail) return;

  // Render buy items
  buyGrid.innerHTML = G.townShopInventory.map((shopObj, i) => {
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
          ${!allowed && selShopItem.type === 'buy' ? '<div style="color:#e0483a; font-size:11px; text-align:center; margin-top:6px;">Not enough gold.</div>' : ''}
        </div>
      </div>
    `;

    $('wm-shop-action-btn').addEventListener('click', clickHandler);

  } else {
    detail.innerHTML = `<div style="text-align:center; color:#5a6474; font-size:12px; margin-top:40px;">Select an item from Buy or Sell stock to view details.</div>`;
  }
}

// ===== Town Tavern Panel Logic =====
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
    storedList.innerHTML = `<div style="text-align:center; color:#5a6474; font-size:11px; padding: 20px 0;">No stored heroes in tavern. Swap active heroes here to store them.</div>`;
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
    hireList.innerHTML = `<div style="text-align:center; color:#5a6474; font-size:11px; padding: 20px 0;">All heroes hired.</div>`;
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
      allowed = G.heroes.length > 1; // Must have at least 1 hero active
      if (!allowed) warnMsg = 'Cannot store the last active hero.';

      clickHandler = () => {
        const wrap = G.heroes.find(h => h.data === selTavernHero);
        if (wrap) {
          G.heroes = G.heroes.filter(h => h !== wrap);
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
      allowed = G.heroes.length < 4; // Max 4 active
      if (!allowed) warnMsg = 'Active party is full (maximum 4).';

      clickHandler = () => {
        const idx = G.storedHeroes.indexOf(selTavernHero);
        if (idx >= 0 && G.heroes.length < 4) {
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
          if (G.heroes.length < 4) {
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

        <div style="margin-top:auto;">
          <button id="wm-tavern-action-btn" class="${btnClass}" ${allowed ? '' : 'disabled'} style="width:100%; padding:10px;">${btnText}</button>
          ${warnMsg ? `<div style="color:#e0483a; font-size:11px; text-align:center; margin-top:6px;">${warnMsg}</div>` : ''}
        </div>
      </div>
    `;

    // Draw portrait for detail hero
    const detailCanvas = $('canvas-detail-hero');
    if (detailCanvas) drawHeroPortrait(detailCanvas, selTavernHero);

    $('wm-tavern-action-btn').addEventListener('click', clickHandler);

  } else {
    detail.innerHTML = `<div style="text-align:center; color:#5a6474; font-size:12px; margin-top:40px;">Select a hero from any roster to view stats and manage them.</div>`;
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
  const races = Object.keys(RACES);
  const classes = Object.keys(CLASSES);
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

  // Visuals
  const VISUAL_OPTS = {
    skinColor: ['#ffddcc', '#f1c27d', '#e0ac69', '#8d5524', '#c68642', '#3e2723', '#7cb342', '#bb4444', '#aabbaa', '#dd5566', '#ffeeee'],
    hair: ['none', 'bangs/adult', 'long/adult', 'page/adult', 'messy1/adult', 'pixie/adult', 'bob/adult', 'curly_long/adult', 'dreadlocks_long/adult', 'spiked/adult', 'loose/adult', 'swoop/adult', 'parted/adult', 'mop/adult'],
    hairColor: ['#000000', '#111111', '#663311', '#8a4a20', '#ddbb55', '#e8c965', '#cc4422', '#ff6633', '#eeeeee', '#e0e0e0', '#66aacc', '#cc66aa', '#dda0dd'],
    eyeColor: ['#000000', '#4477ff', '#228822', '#884422', '#aa2222', '#ffffff']
  };

  const getRaceDefaults = (rKey) => {
    switch(rKey) {
      case 'halforc': return { head: 'orc/male', skinColor: '#8fae7a', hairColor: '#111111', ears: 'none', horns: 'none', facialHair: 'none', eyeColor: '#5a1010', spriteScaleX: 1.0, spriteScaleY: 1.0 };
      case 'elf': return { head: '', skinColor: '#ffeeee', hairColor: '#eedd77', ears: 'elven', horns: 'none', facialHair: 'none', eyeColor: '#203a3a', spriteScaleX: 1.0, spriteScaleY: 1.0 };
      case 'dwarf': return { head: '', skinColor: '#ffddbb', hairColor: '#bbaa55', ears: 'none', horns: 'none', facialHair: 'beard/medium', eyeColor: '#3a2010', spriteScaleX: 1.15, spriteScaleY: 0.85 };
      case 'halfling': return { head: '', skinColor: '#eeddbb', hairColor: '#664422', ears: 'none', horns: 'none', facialHair: 'none', eyeColor: '#3a2010', spriteScaleX: 0.82, spriteScaleY: 0.82 };
      case 'dragonborn': return { head: 'lizard/male', skinColor: '#7fa25a', hairColor: '#000000', ears: 'dragon', horns: 'curl', facialHair: 'none', eyeColor: '#ffcc00', spriteScaleX: 1.0, spriteScaleY: 1.0 };
      case 'gnome': return { head: '', skinColor: '#eeddbb', hairColor: '#a3e635', ears: 'elven', horns: 'none', facialHair: 'none', eyeColor: '#3a2010', spriteScaleX: 0.88, spriteScaleY: 0.88 };
      case 'halfelf': return { head: '', skinColor: '#ffeeee', hairColor: '#eedd77', ears: 'elven', horns: 'none', facialHair: 'none', eyeColor: '#203a3a', spriteScaleX: 1.0, spriteScaleY: 1.0 };
      case 'tiefling': return { head: '', skinColor: '#dd5566', hairColor: '#111111', ears: 'elven', horns: 'backwards', facialHair: 'none', eyeColor: '#ffcc00', spriteScaleX: 1.0, spriteScaleY: 1.0 };
      default: return { head: '', skinColor: '#ffddcc', hairColor: '#663311', ears: 'none', horns: 'none', facialHair: 'none', eyeColor: '#000000', spriteScaleX: 1.0, spriteScaleY: 1.0 };
    }
  };

  const rd = getRaceDefaults(raceKey);
  const visual = {
    gender,
    head: rd.head,
    skinColor: rd.skinColor,
    hair: VISUAL_OPTS.hair[Math.floor(Math.random() * VISUAL_OPTS.hair.length)],
    facialHair: rd.facialHair,
    hairColor: rd.hairColor,
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
