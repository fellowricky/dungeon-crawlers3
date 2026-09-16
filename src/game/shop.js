/**
 * Shop System — an overlay shown between dungeon floors.
 */
import { rollItem, bonusText, ilvlText, migrateItem, slotsFor, compareItemStats, addToInventory } from './items.js';
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

  // The between-floor merchant is a camp restock: potions plus a couple of
  // scrolls/potion trinkets rolled at the party's tier. Gear shopping lives in
  // the town shop (world map) so mid-crawl stops stay quick.
  shopInventory = [
    { type: 'potion', kind: 'heal',     name: 'Healing Potion',          icon: '🧪', price: Math.round(100 * priceMult), desc: 'Heals the most wounded hero (2d4+2)' },
    { type: 'potion', kind: 'greater',  name: 'Greater Healing Potion',  icon: '⚗️', price: Math.round(350 * priceMult), desc: 'Greater healing (4d4+4)' },
    { type: 'potion', kind: 'superior', name: 'Superior Healing Potion', icon: '🍶', price: Math.round(800 * priceMult), desc: 'Superior healing (8d4+8)' },
  ];

  const tier = G.partyLevel ? G.partyLevel() : 1;
  for (let i = 0; i < 2; i++) {
    const it = rollItem(tier, Math.random, 'trinket', { source: 'chest' });
    if (it) shopInventory.push({ type: 'gear', item: it, price: Math.round(it.value * 2 * priceMult) });
  }

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

  const renderIcon = icon => (icon && icon.includes('/'))
    ? `<img src="./${icon}" style="width:28px;height:28px;image-rendering:pixelated;vertical-align:middle;" />`
    : (icon || '');

  const grid = $('shop-grid');
  grid.innerHTML = shopInventory.map((shopObj, i) => {
    const isGear = shopObj.type === 'gear';
    const icon = isGear ? shopObj.item.icon : shopObj.icon;
    const color = isGear ? shopObj.item.color : '#ccc';
    return `<div class="bag-item ${selItem === shopObj ? 'sel' : ''}" data-i="${i}" style="border-color:${color}">
      <span class="bag-ico">${renderIcon(icon)}</span>
      <span class="bag-r" style="background:${color}"></span>
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
    const isGear = selItem.type === 'gear';
    let name = selItem.name, desc = selItem.desc || '', slotLine = '';
    if (isGear) {
      migrateItem(selItem.item);
      const it = selItem.item;
      name = it.name;
      slotLine = `<div class="id-slot">${it.slot} — ${it.rarity} · ${ilvlText(it)}</div>`;
      if (it.scroll || it.potion) {
        desc = (it.scroll ? 'Casts its spell while equipped, consuming one charge per cast.' : 'Drinkable buff — consumes a charge.')
          + ` ${it.charges} charge${it.charges === 1 ? '' : 's'}.`;
      } else {
        desc = bonusText(it) || 'No bonuses';
      }
    }

    let compHTML = '';
    if (isGear) {
      const leaderHero = G.heroes?.find(h => !h.temp && h.data?.hp > 0)?.data || G.heroes?.[0]?.data;
      if (leaderHero && selItem.item.slot !== 'dye') {
        const opts = slotsFor(selItem.item.slot);
        const equipped = opts.map(s => leaderHero.equipment?.[s]).find(Boolean) || null;
        const diffs = compareItemStats(selItem.item, equipped, leaderHero.level);
        if (diffs.length > 0) {
          const tags = diffs.map(d => `<span class="diff-tag ${d.isPositive ? 'pos' : (d.isNegative ? 'neg' : 'neutral')}">${d.text}</span>`).join(' ');
          const eqName = equipped ? equipped.name : '(Empty slot)';
          compHTML = `
            <div class="id-compare">
              <div class="id-compare-header">
                <span class="id-compare-label">vs ${leaderHero.name} (${eqName}):</span>
              </div>
              <div class="id-compare-diffs">${tags}</div>
            </div>
          `;
        }
      }
    }

    detail.innerHTML = `
      <div class="item-detail" style="margin-top: 0">
        <div class="id-name">${renderIcon(isGear ? selItem.item.icon : selItem.icon)} ${name}</div>
        ${slotLine}
        <div class="id-bonus">${desc}</div>
        ${compHTML}
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
          if (selItem.type === 'gear') {
            addToInventory(G.inventory, selItem.item, G);
            log(`🛒 Bought ${selItem.item.name} for ${selItem.price}g.`, 'sys');
          } else {
            G.potions[selItem.kind]++;
            log(`🛒 Bought ${selItem.name} for ${selItem.price}g.`, 'sys');
          }

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
