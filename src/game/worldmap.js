/**
 * World Map / quest selection overlay.
 * Shows generated quests, reward previews (including legendaries), and embarks.
 */
import { generateQuests } from './quests.js';
import { perkText, bonusText, ilvlText } from './items.js';
import { log, updateResources } from './ui.js';

let G = null;
let open = false;
let quests = [];
let selected = null;

const $ = id => document.getElementById(id);
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

function partyLevel() {
  if (!G?.heroes?.length) return 1;
  return Math.max(1, Math.round(
    G.heroes.reduce((s, h) => s + (h.data.level || 1), 0) / G.heroes.length
  ));
}

function itemIconHTML(icon) {
  if (icon && icon.includes('/')) {
    return `<img src="./${icon}" style="width:22px;height:22px;image-rendering:pixelated;vertical-align:middle;" />`;
  }
  return icon || '🎁';
}

export function initWorldMap(game) {
  G = game;
  const btn = $('wm-embark-btn');
  if (btn) btn.addEventListener('click', embarkSelected);
}

export function showWorldMap(opts = {}) {
  if (!G) return;
  open = true;
  selected = null;
  G.setPaused(true);

  const refresh = opts.refresh !== false;
  if (refresh || !quests.length) {
    quests = generateQuests(partyLevel(), 3);
  }

  const screen = $('worldmapscreen');
  if (screen) screen.classList.add('show');

  renderNodes();
  showPlaceholder();
}

export function hideWorldMap() {
  open = false;
  const screen = $('worldmapscreen');
  if (screen) screen.classList.remove('show');
  if (G) G.setPaused(false);
}

function renderNodes() {
  const root = $('wm-quest-nodes');
  if (!root) return;
  root.innerHTML = quests.map((q, i) => {
    const leg = q.isLegendaryReward ? ' legendary-quest' : '';
    return `<div class="quest-node theme-${q.theme}${leg}${selected === q ? ' active' : ''}"
      data-i="${i}" style="left:${q.mapLocation.x}%; top:${q.mapLocation.y}%;">
      <div class="quest-node-pulse"></div>
      <div class="quest-node-pin"></div>
      <div class="quest-node-label">${q.isLegendaryReward ? '★ ' : ''}${q.name.replace(/^The /, '')}</div>
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
  if (q.isLegendaryReward) {
    log(`★ A fabled relic is rumored among the rewards…`, 'treasure');
  }
  updateResources(G);
}

/* Quest gold / XP / item are granted in Game.grantQuestRewardsAtDungeonEnd()
   when the final floor boss is defeated — not when embarking or opening the map. */
