/**
 * Shop System — an overlay shown between dungeon floors.
 */
import { rollItem, bonusText, perkText, ilvlText, migrateItem } from './items.js';
import { log, updateResources } from './ui.js';
import { refreshMenus } from './menus.js';

let G = null;
let open = false;
let shopInventory = [];
let selItem = null;

const $ = id => document.getElementById(id);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function itemIconHTML(icon, className="") {
  if (icon && icon.includes('/')) {
    return `<img class="${className}" src="./${icon}" style="width:28px;height:28px;image-rendering:pixelated;vertical-align:middle;margin-right:4px;" />`;
  }
  return icon || '';
}

export function initShop(game) {
  G = game;

  const ov = document.createElement('div');
  ov.id = 'shopscreen';
  ov.innerHTML = `
    <div class="cs-frame shop-frame">
      <div class="cs-header">
        <div class="cs-tabs">
          <button class="cs-tab on">Merchant Camp</button>
        </div>
        <div class="cs-gold">🪙 <b id="shop-gold">0</b></div>
      </div>
      <div class="cs-body shop-body">
        <div class="shop-grid" id="shop-grid"></div>
        <div class="shop-detail" id="shop-detail"></div>
      </div>
      <div class="shop-footer">
        <button id="shop-descend">Descend to Floor <span id="shop-next-floor"></span></button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  $('shop-descend').addEventListener('click', closeShopAndDescend);
}

export function showShop() {
  if (!G) return;
  open = true;
  selItem = null;
  G.setPaused(true);

  // Generate inventory
  shopInventory = [];

  // Always stock potions
  shopInventory.push({ type: 'potion', kind: 'heal', name: 'Healing Potion', icon: '🧪', price: 100, desc: 'Heals the most wounded hero (2d4+2)' });
  shopInventory.push({ type: 'potion', kind: 'greater', name: 'Greater Healing Potion', icon: '⚗️', price: 350, desc: 'Greater healing (4d4+4)' });

  // Rarity-scaled shop markup: higher rarities cost exponentially more.
  // Players can afford commons easily, but rares+ are aspirational purchases.
  const RARITY_MARKUP = { common: 4, uncommon: 7, rare: 12, epic: 20, legendary: 35 };

  // 4-6 random gear items scaled to the *next* floor
  const numItems = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < numItems; i++) {
    const item = rollItem(G.dungeonLevel);
    const markup = RARITY_MARKUP[item.rarity] || 4;
    shopInventory.push({ type: 'gear', item: item, price: Math.round(item.value * markup) });
  }

  $('shopscreen').classList.add('show');
  $('shop-next-floor').textContent = G.dungeonLevel;
  renderShop();
}

function closeShopAndDescend() {
  open = false;
  G.setPaused(false);
  $('shopscreen').classList.remove('show');
  G.onShopExit();
}

function renderShop() {
  if (!open) return;

  $('shop-gold').textContent = G.gold;

  const grid = $('shop-grid');
  grid.innerHTML = shopInventory.map((shopObj, i) => {
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

    return `<div class="bag-item ${selItem === shopObj ? 'sel' : ''}" data-i="${i}" style="border-color:${color}">
      <span class="bag-ico">${itemIconHTML(icon)}</span>
      <span class="bag-r" style="background:${color}"></span>
    </div>`;
  }).join('');

  grid.querySelectorAll('.bag-item:not(.sold)').forEach(el => {
    el.addEventListener('click', () => {
      selItem = shopInventory[+el.dataset.i];
      renderShop();
    });
  });

  const detail = $('shop-detail');
  if (selItem) {
    const affordable = G.gold >= selItem.price;
    let content = '';
    if (selItem.type === 'potion') {
      content = `
        <div class="id-name">${itemIconHTML(selItem.icon)} ${selItem.name}</div>
        <div class="id-bonus">${selItem.desc}</div>
      `;
    } else {
      const it = selItem.item;
      migrateItem(it);
      const pLine = perkText(it);
      content = `
        <div class="id-name" style="color:${it.color}">${itemIconHTML(it.icon)} ${it.name}</div>
        <div class="id-slot">${cap(it.slot)} — ${cap(it.rarity)} · ${ilvlText(it)}</div>
        <div class="id-bonus">${bonusText(it) || 'No bonuses'}</div>
        ${pLine ? `<div class="id-perk">${pLine}</div>` : ''}
      `;
    }

    detail.innerHTML = `
      <div class="item-detail" style="margin-top: 0">
        ${content}
        <div class="id-actions" style="margin-top:10px">
          <button id="shop-buy" ${affordable ? '' : 'disabled'}>Buy for ${selItem.price}g</button>
        </div>
        ${!affordable ? '<div class="id-warn">Not enough gold.</div>' : ''}
      </div>
    `;

    const buyBtn = $('shop-buy');
    if (buyBtn) {
      buyBtn.addEventListener('click', () => {
        if (G.gold >= selItem.price) {
          G.gold -= selItem.price;

          if (selItem.type === 'potion') {
            G.potions[selItem.kind]++;
            log(`🛒 Bought ${selItem.name} for ${selItem.price}g.`, 'sys');
          } else {
            G.inventory.push(selItem.item);
            selItem.sold = true;
            log(`🛒 Bought ${selItem.item.name} for ${selItem.price}g.`, 'sys');
          }

          updateResources(G);
          refreshMenus(G);
          G.saveGame();

          if (selItem.type === 'gear') {
            selItem = null;
          }

          renderShop();
        }
      });
    }
  } else {
    detail.innerHTML = '<div class="item-detail" style="margin-top:0; text-align:center; color:#6a6558; padding:20px 0;">Select an item to view details.</div>';
  }

  const descendBtn = $('shop-descend');
  if (descendBtn) {
    if (G.currentQuest) {
      if (G.currentFloorInQuest < G.currentQuest.floors) {
        descendBtn.innerHTML = `Descend to Floor <span id="shop-next-floor">${G.currentFloorInQuest + 1}</span> of ${G.currentQuest.floors}`;
      } else {
        descendBtn.innerHTML = `Complete Quest &amp; Return to Map`;
      }
    } else {
      descendBtn.innerHTML = `Descend to Floor <span id="shop-next-floor">${G.dungeonLevel}</span>`;
    }
  }
}
