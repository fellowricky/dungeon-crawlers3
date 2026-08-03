/**
 * Shop System — an overlay shown between dungeon floors.
 */
import { log, updateResources } from './ui.js';
import { refreshMenus } from './menus.js';

const IDLE_MS = 30000;  // auto-descend after this long with no interaction

let G = null;
let open = false;
let shopInventory = [];
let selItem = null;
let idleDeadline = 0;
let idleInterval = null;

const $ = id => document.getElementById(id);

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
        <div class="shop-idle" id="shop-idle"></div>
      </div>
    </div>`;
  document.body.appendChild(ov);

  $('shop-descend').addEventListener('click', closeShopAndDescend);
  // Any interaction inside the shop resets the inactivity countdown.
  ov.addEventListener('pointerdown', bumpIdle);
}

export function showShop() {
  if (!G) return;
  open = true;
  selItem = null;
  G.setPaused(true);

  // Skill-check boons that affect this visit
  const buffs = G._floorBuffs || [];
  const hasDiscount = buffs.some(b => b.type === 'merchantDiscount');
  const priceMult = hasDiscount ? 0.85 : 1;

  // The between-floor merchant is a camp restock: potions only. Gear shopping
  // lives in the town shop (world map) so mid-crawl stops stay quick.
  shopInventory = [
    { type: 'potion', kind: 'heal',     name: 'Healing Potion',          icon: '🧪', price: Math.round(100 * priceMult), desc: 'Heals the most wounded hero (2d4+2)' },
    { type: 'potion', kind: 'greater',  name: 'Greater Healing Potion',  icon: '⚗️', price: Math.round(350 * priceMult), desc: 'Greater healing (4d4+4)' },
    { type: 'potion', kind: 'superior', name: 'Superior Healing Potion', icon: '🍶', price: Math.round(800 * priceMult), desc: 'Superior healing (8d4+8)' },
  ];

  if (hasDiscount) log(`💰 Merchant's favour — all prices reduced 15% this visit.`, 'treasure');

  $('shopscreen').classList.add('show');
  $('shop-next-floor').textContent = G.dungeonLevel;
  renderShop();
  armIdle();
}

function closeShopAndDescend() {
  if (!open) return;
  open = false;
  disarmIdle();
  G.setPaused(false);
  $('shopscreen').classList.remove('show');
  G.onShopExit();
}

/* ---- inactivity auto-descend ---- */
function armIdle() {
  disarmIdle();
  idleDeadline = performance.now() + IDLE_MS;
  idleInterval = setInterval(tickIdle, 250);
  tickIdle();
}
function disarmIdle() {
  if (idleInterval) { clearInterval(idleInterval); idleInterval = null; }
}
function bumpIdle() {
  if (open) idleDeadline = performance.now() + IDLE_MS;
}
function tickIdle() {
  if (!open) { disarmIdle(); return; }
  const remain = idleDeadline - performance.now();
  const el = $('shop-idle');
  if (el) el.textContent = remain > 0 ? `Descending in ${Math.ceil(remain / 1000)}s…` : '';
  if (remain <= 0) closeShopAndDescend();
}

function renderShop() {
  if (!open) return;

  $('shop-gold').textContent = G.gold;

  const grid = $('shop-grid');
  grid.innerHTML = shopInventory.map((shopObj, i) => {
    return `<div class="bag-item ${selItem === shopObj ? 'sel' : ''}" data-i="${i}" style="border-color:#ccc">
      <span class="bag-ico">${shopObj.icon}</span>
      <span class="bag-r" style="background:#ccc"></span>
    </div>`;
  }).join('');

  grid.querySelectorAll('.bag-item').forEach(el => {
    el.addEventListener('click', () => {
      selItem = shopInventory[+el.dataset.i];
      renderShop();
    });
  });

  const detail = $('shop-detail');
  if (selItem) {
    const affordable = G.gold >= selItem.price;

    detail.innerHTML = `
      <div class="item-detail" style="margin-top: 0">
        <div class="id-name">${selItem.icon} ${selItem.name}</div>
        <div class="id-bonus">${selItem.desc}</div>
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
          G.potions[selItem.kind]++;
          log(`🛒 Bought ${selItem.name} for ${selItem.price}g.`, 'sys');

          updateResources(G);
          refreshMenus(G);
          G.saveGame();
          renderShop();
        }
      });
    }
  } else {
    detail.innerHTML = '<div class="item-detail" style="margin-top:0; text-align:center; color:#6a6558; padding:20px 0;">Select an item to view details.</div>';
  }

  const descendBtn = $('shop-descend');
  if (descendBtn) {
    /* questFloor is incremented before the shop opens, so it already IS the next floor */
    if (G.activeQuest) {
      descendBtn.innerHTML = `Descend to Floor <span id="shop-next-floor">${G.questFloor}</span> of ${G.activeQuest.floors}`;
    } else {
      descendBtn.innerHTML = `Descend to Floor <span id="shop-next-floor">${G.dungeonLevel}</span>`;
    }
  }
}
