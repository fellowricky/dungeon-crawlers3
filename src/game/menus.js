/**
 * Menu system — a single pausing overlay with four tabs:
 *   — Equipment & Bag — per-hero gear slots, derived stats, shared inventory
 *   — Skills          — spend banked level-up points on ability scores + class skills
 *   — Skills (5e)     — read-only 5e skill modifiers
 *   — AI Priorities   — per-hero behaviour knobs (targeting, abilities, potions, movement)
 * Plus a top nav bar to open them. All DOM; reads/writes game state through the
 * controller's menu-action methods.
 */
import { CLASSES, RACES, ABILITIES, ABILITY_LABEL, mod, fmtMod,
         canEquip, pendingPoints, classSkill, cantripDice,
         SUBCLASSES, SUBCLASS_UNLOCK, RECHARGE_LABEL, subclassOf, needsSubclass, SKILLS, SKILL_RANK_MAX, XP_TABLE,
         CLASS_SAVES, profBonus, WILD_SHAPE_FORMS,
         MONSTER_THEMES, MONSTERS_ALL, monsterSpawnsIn, crBandIndex, gearProficiencies
} from './srd.js';
import { listUnlockedFeatureLabels, totalSlots, slotBreakdown,
  chargeDef, chargesLeft } from './features.js';
import { isIdentityColorBalance, loadBalancedCanvas } from './color_balance.js';
import { iconHtml } from './icons.js';
import {
  SLOTS, SLOT_LABEL, slotsFor, bonusText, perkText, ilvlText,
  RARITIES, getBaseStatsText, migrateItem, previewBonuses, effectiveIlvl, itemCategory,
  itemPoints, compareItemStats, weaponTags, itemReqText, bonusLabel, qtyOf,
  isRune, runeFitsItem, itemRunes, runeSlotsFor, canInscribeRune
} from './items.js';
import { drawHeroPortrait } from './sprite_animator.js';
import { refreshWorldMapPanel } from './worldmap.js';
import { DYEABLE_SLOTS } from './inventory.js';
import { EFFECTS } from './conditions.js';
import { SPELLS, activeDancingLights, clearDancingLights } from './spells.js';
import { BESTIARY_UNLOCK } from './constants.js';
import { openOptions } from './options_ui.js';
import { openHelp } from './help_ui.js';
import { heroRole } from './turn_planner.js';

const CLASS_ICON = { 
  fighter:'⚔️', rogue:'🏹', cleric:'✨', wizard:'🔮',
  barbarian:'🪓', bard:'🎵', druid:'🌿', monk:'🥋',
  paladin:'🛡️', ranger:'🏹', sorcerer:'🔮', warlock:'💀'
};

/* Bag category tabs — itemCategory() (items.js) maps every item.slot value to
   one of these. 'all' shows the full bag (preserves the legacy view). */
const BAG_CATS = [
  { key:'all',       label:'All',         icon:'🎒' },
  { key:'weapon',    label:'Weapons',     icon:'⚔️' },
  { key:'armor',     label:'Armor',       icon:'🛡️' },
  { key:'accessory', label:'Accessories', icon:'💍' },
  { key:'consumable',label:'Consumables', icon:'🧪' },
  { key:'other',     label:'Other',       icon:'🧰' }
];
const BAG_CAT_LABEL = Object.fromEntries(BAG_CATS.map(c=>[c.key,c.label]));
const BAG_CAT_EMPTY = { all:'', weapon:'weapons', armor:'armor', accessory:'accessories', consumable:'scrolls, potions or torches', other:'other items' };

let G = null;              // game controller
let selHero = 0;           // selected hero index
let tab = 'equip';         // 'equip' | 'skills' | 'srdSkills' | 'ai'
let selItem = null;        // selected bag item
let open = false;
let bagFilter = 'all';     // active bag category tab
let bagMinPS = 0;          // junk floor: hide bag items below this power score (0 = show all)
let dragCtx = null;        // drag-and-drop context { kind:'bag'|'slot', index?, slot? }
let toastTimer = null;     // cs-toast hide timer

const $ = id => document.getElementById(id);
const hex = n => '#'+n.toString(16).padStart(6,'0');

export function initMenus(game){
  G = game;

  /* The two nav buttons live in opposite top corners (see the #hud-top-left /
     #hud-top-right anchors in index.html), so they are built and placed
     separately rather than as one bar. Falling back to <body> keeps the
     headless/stubbed-DOM tests working when the anchors are absent. */

  /* One Party button covers gear AND level-ups — the character screen's own tabs
     already switch between them, so a separate Level Up button was a second door
     into the same room. It keeps the pending-points badge and pulse. */
  const partyBtn = document.createElement('button');
  partyBtn.id = 'nav-party';
  partyBtn.className = 'hud-nav-btn';
  partyBtn.title = 'Equipment, inventory & level-up points';
  partyBtn.innerHTML = `🎒 <span>Party</span><span id="nav-party-badge" class="badge" style="display:none">0</span>`;
  (document.getElementById('hud-top-left') || document.body).appendChild(partyBtn);

  /* Options is icon-only — the gear reads on its own and the top-right corner
     is shared with the floor readout. */
  const optionsBtn = document.createElement('button');
  optionsBtn.id = 'nav-options';
  optionsBtn.className = 'hud-nav-btn hud-nav-icon';
  optionsBtn.title = 'Options — volume, combat log & automation';
  optionsBtn.setAttribute('aria-label', 'Options');
  optionsBtn.textContent = '⚙️';
  (document.getElementById('hud-top-right') || document.body).appendChild(optionsBtn);

  const helpBtn = document.createElement('button');
  helpBtn.id = 'nav-help';
  helpBtn.className = 'hud-nav-btn hud-nav-icon';
  helpBtn.title = 'How to play — the loop, combat rules and keys';
  helpBtn.setAttribute('aria-label', 'How to play');
  helpBtn.textContent = '❓';
  (document.getElementById('hud-top-right') || document.body).appendChild(helpBtn);
  helpBtn.addEventListener('click', () => openHelp('loop'));

  const ov = document.createElement('div');
  ov.id = 'charscreen';
  ov.innerHTML = `
    <div class="cs-frame">
      <div class="cs-header">
        <div class="cs-tabs">
          <button class="cs-tab" data-tab="equip">Equipment</button>
          <button class="cs-tab" data-tab="skills">attributes</button>
          <button class="cs-tab" data-tab="srdSkills">skills</button>
          <button class="cs-tab" data-tab="ai">AI Priorities</button>
          <button class="cs-tab" data-tab="quests">Quests</button>
          <button class="cs-tab" data-tab="bestiary">Bestiary</button>
        </div>
        <div class="cs-gold">🪙 <b id="cs-gold">0</b></div>
        <button class="cs-close" id="cs-close">✕</button>
      </div>
      <div class="cs-body">
        <div class="cs-rail" id="cs-rail"></div>
        <div class="cs-main" id="cs-main"></div>
      </div>
      <div id="cs-toast"></div>
    </div>`;
  document.body.appendChild(ov);

  /* floating comparison tooltip for hovered bag items */
  const tip = document.createElement('div');
  tip.id = 'cs-tooltip';
  document.body.appendChild(tip);

  /* Points pending → open straight onto the attributes tab, since that's what
     the badge is telling the player to go and spend. */
  $('nav-party').addEventListener('click', ()=>{
    const pending = G.heroes.filter(h => !h.companion && !h.temp).reduce((n,h)=>n+pendingPoints(h.data),0);
    openMenu(pending > 0 ? 'skills' : 'equip');
  });
  $('nav-options').addEventListener('click', openOptions);
  $('cs-close').addEventListener('click', closeMenu);
  ov.addEventListener('click', e=>{ if(e.target===ov) closeMenu(); });
  ov.querySelectorAll('.cs-tab').forEach(b=>b.addEventListener('click', ()=>{ tab=b.dataset.tab; selItem=null; render(); }));
  addEventListener('keydown', e=>{
    const menuState = G.state==='crawl' || G.state==='worldmap';
    if(e.key==='Escape' && open) closeMenu();
    else if((e.key==='i'||e.key==='I') && !open && menuState) openMenu('equip');
    else if((e.key==='k'||e.key==='K') && !open && menuState) openMenu('skills');
  });
}

export function refreshMenus(game = G){
  if (!game || !game.heroes) return;
  const total = game.heroes.filter(h => !h.companion && !h.temp).reduce((n,h)=>n+pendingPoints(h.data),0);
  const badge = $('nav-party-badge');
  if(badge){ badge.textContent = total; badge.style.display = total>0?'':'none'; }
  const wmBadge = $('wm-party-badge');
  if(wmBadge){ wmBadge.textContent = total; wmBadge.style.display = total>0?'':'none'; }
  const nav = $('nav-party');
  if(nav) nav.classList.toggle('pulse', total>0);
  if(open) render();
}

export function openMenu(which){
  if(!G || G.heroes.length===0) return;
  /* Point selHero to a rail-eligible hero (roster member or temp quest ally) if it
     currently points to a summoned companion, or is otherwise out of range. */
  const realIdx = G.heroes.findIndex(h => !h.companion);
  if (realIdx >= 0 && (selHero < 0 || selHero >= G.heroes.length || G.heroes[selHero]?.companion)) {
    selHero = realIdx;
  }
  tab = which; open = true; selItem = null; bagFilter = 'all'; bagMinPS = 0;
  G.setPaused(true);
  $('charscreen').classList.add('show');
  render();
}
function closeMenu(){
  open = false;
  /* Over the world map the game stays paused; only crawl resumes. */
  G.setPaused(G.state==='worldmap');
  $('charscreen').classList.remove('show');
  hideTooltip();
  if(G.state==='worldmap') refreshWorldMapPanel();
}
function hideTooltip(){ const t = $('cs-tooltip'); if(t) t.style.display = 'none'; }

function disenchantYieldHTML(preview){
  if (!preview) return '';
  const dust = `+${preview.dust} dust`;
  const ess = preview.essencePool
    ? `+1 ${preview.essencePool.join(' / ')} essence`
    : 'no essence';
  return `<div class="tt-yield">Disenchant · ${dust} · ${ess}</div>`;
}
export { hideTooltip as hideItemTooltip };

function ensureTooltip(){
  let tip = $('cs-tooltip');
  if (tip) return tip;
  tip = document.createElement('div');
  tip.id = 'cs-tooltip';
  document.body.appendChild(tip);
  return tip;
}

/** Bag-item hover. Pass `{ compare:true }` for the party-screen two-card view. */
export function bindItemHoverTooltip(el, getItem, opts = {}){
  if (!el) return;
  el.addEventListener('mouseenter', () => {
    const it = typeof getItem === 'function' ? getItem() : getItem;
    if (!it) return;
    const tip = ensureTooltip();
    const hero = G?.heroes?.find(h => h && !h.companion)?.data;
    const compare = opts.compare === true && hero;
    tip.classList.toggle('compact', !compare);
    let html = compare
      ? compareTooltipHTML(it, hero)
      : itemTipBlock(it, '', it.color || '#cfd8dc', hero?.level);
    if (opts.disenchant && G?.guild && typeof G.guild.getDisenchantPreview === 'function') {
      html += disenchantYieldHTML(G.guild.getDisenchantPreview(it));
    }
    tip.innerHTML = html;
    tip.style.display = 'block';
  });
  el.addEventListener('mousemove', e => positionTooltip(e));
  el.addEventListener('mouseleave', hideTooltip);
}

/* ---------------- rendering ---------------- */
function render(){
  if(!open) return;
  $('cs-gold').textContent = G.gold;
  document.querySelectorAll('.cs-tab').forEach(b=>b.classList.toggle('on', b.dataset.tab===tab));
  /* Quests & Bestiary are party-wide, not per-hero — hide the hero rail. */
  const wide = (tab === 'quests' || tab === 'bestiary');
  $('cs-rail').style.display = wide ? 'none' : '';
  if (wide) {
    if (tab === 'quests') { $('cs-main').innerHTML = questsHTML(); }
    else { $('cs-main').innerHTML = bestiaryHTML(); wireBestiary(); }
    return;
  }
  renderRail();
  if (tab === 'equip') {
    $('cs-main').innerHTML = equipHTML();
    wireEquip();
  } else if (tab === 'skills') {
    $('cs-main').innerHTML = skillsHTML();
    wireSkills();
    const tc = $('cs-main').querySelector('.title-canvas');
    if(tc) drawHeroPortrait(tc, G.heroes[selHero].data);
  } else if (tab === 'srdSkills') {
    $('cs-main').innerHTML = srdSkillsHTML();
    wireSrdSkills();
    const tc = $('cs-main').querySelector('.title-canvas');
    if(tc) drawHeroPortrait(tc, G.heroes[selHero].data);
  } else if (tab === 'ai') {
    $('cs-main').innerHTML = aiPrioritiesHTML();
    wireAIPriorities();
    const tc = $('cs-main').querySelector('.title-canvas');
    if(tc) drawHeroPortrait(tc, G.heroes[selHero].data);
  }
}

function renderRail(){
  const rail = $('cs-rail');
  const real = G.heroes.map((h,i)=>({h,i})).filter(e => !e.h.companion);
  /* If the selected index points to a summoned companion, reset to the first eligible hero */
  if (!real.some(e => e.i === selHero) && real.length > 0) selHero = real[0].i;
  rail.innerHTML = real.map(({h,i})=>{
    const d = h.data, cls = CLASSES[d.classKey];
    const pend = pendingPoints(d);
    return `<button class="rail-hero ${i===selHero?'on':''}" data-i="${i}">
      <span class="rail-ico" style="background:${hex(cls.color)}22;border-color:${hex(cls.color)}">
        <canvas class="rail-canvas" width="64" height="64" data-i="${i}"></canvas>
      </span>
      <span class="rail-meta"><b>${d.name}</b><i>Lv ${d.level} ${cls.label}${h.temp?' (Ally)':''}</i></span>
      ${pend?`<span class="rail-badge">${pend}</span>`:''}
    </button>`;
  }).join('');
  rail.querySelectorAll('.rail-hero').forEach(b=>b.addEventListener('click', ()=>{ selHero=+b.dataset.i; selItem=null; render(); }));
  rail.querySelectorAll('.rail-canvas').forEach(canvas=>{
    const idx = +canvas.dataset.i;
    drawHeroPortrait(canvas, G.heroes[idx].data);
  });
}

/* damage display string for a hero's attack — driven by the equipped weapon
   profile (casters also show their cantrip option since they alternate). */
function dmgString(d){
  const wpn = d.weaponProfile;
  const cantrip = d.cantripProfile;
  const parts = [];
  if (wpn) {
    const flat = mod(d.effStats[wpn.ability]) + d.dmgBonus;
    parts.push(`${wpn.dmg[0]}d${wpn.dmg[1]}${flat ? fmtMod(flat) : ''}`);
  }
  if (cantrip) {
    const dice = cantripDice(d.level);
    const flat = d.dmgBonus;
    parts.push(`${dice}d${cantrip.dmg[1]}${flat ? fmtMod(flat) : ''} ${cantrip.name}`);
  }
  if (!parts.length) {
    const a = CLASSES[d.classKey].attack;
    return `${a.dmg[0]}d${a.dmg[1]}`;
  }
  return parts.join(' · ');
}

function statsPanelHTML(d){
  const cls = CLASSES[d.classKey], race = RACES[d.raceKey];
  const ab = ABILITIES.map(k=>{
    const base = d.stats[k], eff = d.effStats[k], diff = eff-base;
    return `<div class="stat-ab"><span>${ABILITY_LABEL[k]}</span>
      <b>${eff}${diff?`<i class="up">(+${diff})</i>`:''}</b>
      <em>${fmtMod(mod(eff))}</em></div>`;
  }).join('');
  return `<div class="cs-stats">
    <h3>Hero Stats</h3>
    <div class="stat-body">
    <div class="stat-list">
    <div class="stat-row"><span>Attack</span><b>${fmtMod(d.atkBonus)} to hit</b></div>
    <div class="stat-row"><span>Damage</span><b>${dmgString(d)}</b></div>
    <div class="stat-row"><span>Crit</span><b>${d.critRange}—20</b></div>
    <div class="stat-row"><span>HP</span><b>${d.hp} / ${d.maxHp}</b></div>
    <div class="stat-row"><span>Armor Class</span><b>${d.ac}</b></div>
    <div class="stat-row"><span>Combat Move</span><b>${d.speedFt || 30} ft (${Math.floor((d.speedFt || 30)/5)} tiles)</b></div>
    <div class="stat-row"><span>Explore Speed</span><b>${Math.round(d.speedMult*100)}%</b></div>
    ${cls.healer?`<div class="stat-row"><span>Heal / cast</span><b>1d8+${mod(d.effStats[cls.attack.ability])+d.healBonus}</b></div>`:''}
    </div>
    <div class="cs-abils">${ab}</div>
    </div>
  </div>`;
}

/* Class kit, class feature and racial trait. This used to trail the stats panel
   on the Equipment tab; it is prose about the build rather than a live number,
   so it reads better next to the other build choices on Attributes. */
function classFeatureHTML(d){
  const cls = CLASSES[d.classKey], race = RACES[d.raceKey];
  return `<div class="cs-feature sk-feature">
    ${iconHtml('class', d.classKey, CLASS_ICON[d.classKey])} ${(d.weaponProfile || d.cantripProfile || cls.attack).name} — ${cls.acDesc}<br>${cls.feature}<br><i>${race.trait}</i></div>`;
}

function equipHTML(){
  const d = G.heroes[selHero].data;

  /* equipment slots — filled slots are draggable so they can be dragged off
     (unequip) or rearranged (e.g. ring1 -> ring2). The doll lays them out by
     key rather than in SLOTS order, so build one at a time and look them up. */
  const slotHTML = (key) => {
    const s = SLOTS.find(x=>x.key===key);
    if(!s) return '';
    const it = d.equipment[s.key];
    if(it){
      migrateItem(it);
      const leg = it.rarity === 'legendary' ? ' legendary-slot' : '';
      const chargeBadge = (it.charges != null) ? `<span class="eq-charges" title="${it.charges} charge${it.charges === 1 ? '' : 's'} remaining">×${it.charges}</span>` : '';
      /* hover shows the full item card (wired with the slot events), not a native title */
      return `<div class="eq-slot filled${leg}" data-slot="${s.key}" draggable="true" style="border-color:${it.color}">
        <span class="eq-ico">${itemIconHTML(it.icon)}</span>
        ${chargeBadge}
        <span class="eq-slotlabel" style="color:${it.color}">${SLOT_LABEL[s.key]}</span></div>`;
    }
    return `<div class="eq-slot" data-slot="${s.key}"><span class="eq-ph">${itemIconHTML(s.icon)}</span>
      <span class="eq-slotlabel">${s.label}</span></div>`;
  };
  /* Paper-doll columns: worn-on-the-body down the left, held/carried down the
     right, and the paired slots (rings, kits) in a rank beneath the portrait.
     Four rows a side means the portrait cell is tall enough to be a portrait
     without pushing the panel past the frame height. */
  const dollLeft  = ['helm','amulet','armor','gloves'].map(slotHTML).join('');
  const dollRight = ['weapon','offhand','boots','trinket'].map(slotHTML).join('');
  const dollFoot  = ['ring1','ring2','kit1','kit2'].map(slotHTML).join('');

  /* category-filtered bag. data-i stays indexed against the FULL inventory so
     equip/sell address the right item regardless of the active tab. */
  const shown = bagFilter==='all' ? G.inventory.slice() : G.inventory.filter(it=>itemCategory(it)===bagFilter);
  /* The PS slider narrows the GRID only. `shown` stays category-only because
     the bulk-sell panel is built from it, and sellByRarity re-filters by
     category alone — if the slider trimmed that list the buttons would promise
     one count and sell a larger one. */
  const psOf = (it) => itemPoints(it) || 0;
  const maxPS = shown.reduce((m,it)=>Math.max(m, psOf(it)), 0);
  const inPS = (it) => psOf(it) >= bagMinPS;
  const visible = shown.filter(inPS);
  const hiddenByPS = shown.length - visible.length;
  let bag;
  if(G.inventory.length===0){
    bag = `<div class="bag-empty">Your bag is empty. Loot some chests!</div>`;
  } else if(shown.length===0){
    bag = `<div class="bag-empty">No ${BAG_CAT_EMPTY[bagFilter]} here.</div>`;
  } else if(visible.length===0){
    bag = `<div class="bag-empty">Everything here scores under PS ${bagMinPS}. Lower the junk floor to see it.</div>`;
  } else {
    bag = G.inventory.map((it,i)=>{
      if(bagFilter!=='all' && itemCategory(it)!==bagFilter) return '';
      if(!inPS(it)) return '';
      migrateItem(it);
      const leg = it.rarity === 'legendary' ? ' legendary-item' : '';
      const lockBadge = it.locked ? '<span class="bag-lock-badge" title="Locked (Protected from sell-all)">🔒</span>' : '';
      const qty = qtyOf(it);
      const qtyBadge = qty > 1 ? `<span class="bag-qty">×${qty}</span>` : '';
      return `<div class="bag-item${leg} ${selItem===it?'sel':''}" data-i="${i}" draggable="true"
        style="border-color:${it.color}" title="${it.name}${qty > 1 ? ` ×${qty}` : ''}${it.locked ? ' (Locked)' : ''}">
        <span class="bag-ico">${itemIconHTML(it.icon)}</span>
        ${lockBadge}${qtyBadge}
        <span class="bag-r" style="background:${it.slot==='dye' ? it.dyeColor : it.color}"></span></div>`;
    }).join('');
  }

  /* category tab bar with per-tab counts */
  const catCounts = { all:G.inventory.length };
  for(const it of G.inventory){ const c=itemCategory(it); catCounts[c]=(catCounts[c]||0)+1; }
  const bagTabs = BAG_CATS.map(c=>{
    const n = catCounts[c.key]||0;
    return `<button class="bag-tab${bagFilter===c.key?' on':''}" data-filter="${c.key}" title="Show ${c.label.toLowerCase()}">${c.icon} ${c.label}<span class="bag-tab-n">${n}</span></button>`;
  }).join('');

  const cls = CLASSES[d.classKey];
  return `
    <div class="cs-hero">
      <div class="cs-doll">
        <div class="eq-col">${dollLeft}</div>
        <div class="cs-portrait">
          <div class="pt-art" style="background:radial-gradient(circle at 50% 40%, ${hex(cls.color)}33, transparent 70%)">
            <canvas class="pt-canvas" width="64" height="64"></canvas>
          </div>
          <div class="pt-name">${d.name}</div>
          <div class="pt-sub">Lv ${d.level} ${RACES[d.raceKey].label} ${cls.label}</div>
        </div>
        <div class="eq-col">${dollRight}</div>
        <div class="eq-row">${dollFoot}</div>
      </div>
      <div class="cs-equip-foot">
        <label class="eq-cosmetic" title="Hides the headgear sprite on this hero only. The helm stays equipped and keeps all of its bonuses.">
          <input type="checkbox" id="eq-hide-helm"${d.visual && d.visual.hideHelm ? ' checked' : ''}>
          <span>Hide this hero's hat</span>
        </label>
        <div class="eq-hint">Click an equipped item to remove · Double-click or drag bag items to equip · Drag a rune onto gear to inscribe it.</div>
      </div>
      ${statsPanelHTML(d)}
      ${activeEffectsHTML(d)}
    </div>
    <div class="cs-bag">
      <h3>Bag <span class="bag-count">${G.inventory.length}</span>
        <span class="bag-sort">
          <button class="sort-btn" data-sort="ps-desc" title="Sort: strongest first (power score)">⚔🔽</button>
          <button class="sort-btn" data-sort="ps-asc" title="Sort: weakest first (power score)">⚔🔼</button>
          <button class="sort-btn" data-sort="rarity-desc" title="Sort: best rarity first">🔽</button>
          <button class="sort-btn" data-sort="rarity-asc" title="Sort: worst rarity first">🔼</button>
          <button class="sort-btn" data-sort="name" title="Sort: by name">🔤</button>
        </span>
      </h3>
      <div class="bag-tabs">${bagTabs}</div>
      ${psFilterHTML(maxPS, hiddenByPS)}
      <div class="bag-grid">${bag}</div>
      ${bulkSellHTML(visible)}
      <div class="cs-bag-foot">${detailHTML(d)}</div>
    </div>`;
}

function inlineComparisonHTML(hero, item) {
  if (!hero || !item || item.slot === 'dye' || isRune(item)) return '';
  const opts = slotsFor(item.slot);
  if (!opts || !opts.length) return '';
  const equippedList = opts.map(s => hero.equipment?.[s]).filter(Boolean);
  let equipped = null;
  if (equippedList.length > 1) {
    equipped = equippedList.reduce((min, eq) => itemPoints(eq) < itemPoints(min) ? eq : min, equippedList[0]);
  } else if (equippedList.length === 1) {
    equipped = equippedList[0];
  }
  const diffs = compareItemStats(item, equipped, hero.level);
  if (!diffs.length && !equipped) return '';

  const eqText = equipped
    ? `<span style="color:${equipped.color}">${itemIconHTML(equipped.icon)} ${equipped.name}</span>`
    : `<span style="color:#8a8474"><i>(Empty slot)</i></span>`;

  let diffsHTML = '';
  if (diffs.length > 0) {
    diffsHTML = diffs.map(d => {
      const cls = d.isPositive ? 'pos' : (d.isNegative ? 'neg' : 'neutral');
      return `<span class="diff-tag ${cls}">${d.text}</span>`;
    }).join(' ');
  } else {
    diffsHTML = `<span class="diff-tag neutral">Equal stats</span>`;
  }

  return `
    <div class="id-compare">
      <div class="id-compare-header">
        <span class="id-compare-label">vs Equipped:</span>
        <span class="id-compare-eq">${eqText}</span>
      </div>
      <div class="id-compare-diffs">${diffsHTML}</div>
    </div>
  `;
}

/* Selected-item detail + Equip/Sell actions. Extracted so the single-click
   selection handler can refresh just this region (via .cs-bag-foot) without
   rebuilding the bag grid — which would destroy the .bag-item element mid
   double-click and mid-drag, breaking both interactions. */
function detailHTML(d){
  /* Nothing selected renders nothing at all — inspection is the hover tooltip's
     job, so reserving a card's worth of height for it just cost bag rows. The
     card still appears on selection because Equip / Sell / Lock live in it, and
     it sits BELOW the sell row so appearing pushes nothing around. */
  if(!selItem) return '';
  migrateItem(selItem);
  const isLocked = !!selItem.locked;
  /* dyes: swatch + apply instructions, sell only (never equippable) */
  if(selItem.slot==='dye'){
    return `<div class="item-detail">
        <div class="id-name" style="color:${selItem.color}">${itemIconHTML(selItem.icon)} ${selItem.name}
          <span class="dye-swatch" style="display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:middle;margin-left:6px;background:${selItem.dyeColor};border:1px solid rgba(255,255,255,0.35)"></span></div>
        <div class="id-slot">Dye — ${cap(selItem.rarity)}${qtyLine(selItem)}</div>
        <div class="id-bonus">Drag onto an equipped item to recolor it (helm, armor, weapon, shield, gloves, amulet, boots).</div>
        <div class="id-actions">
          <button id="id-lock">${isLocked ? '🔒 Locked' : '🔓 Lock'}</button>
          ${sellButtons(selItem, isLocked)}
        </div>
      </div>`;
  }
  if(isRune(selItem)){
    const onto = selItem.runeSlotType === 'weapon' ? 'a weapon' : 'armor, helm, gloves, boots, or a shield';
    return `<div class="item-detail">
        <div class="id-name" style="color:${selItem.color}">${itemIconHTML(selItem.icon)} ${selItem.name}</div>
        <div class="id-slot">Rune — ${onto}${qtyLine(selItem)}</div>
        <div class="id-bonus">${selItem.desc || 'Inscribe onto gear.'}</div>
        <div class="id-hint">Drag onto a matching piece of gear (equipped or in the bag) to inscribe it.</div>
        <div class="id-actions">
          <button id="id-lock">${isLocked ? '🔒 Locked' : '🔓 Lock'}</button>
          ${sellButtons(selItem, isLocked)}
        </div>
      </div>`;
  }
  const eqOk = canEquip(d, selItem);
  const compHTML = inlineComparisonHTML(d, selItem);
  /* Trinkets (scrolls/potions) carry a spell or buff instead of stat bonuses —
     show that plus their charge count. */
  if(selItem.scroll || selItem.potion){
    const tLine = trinketLine(selItem);
    const eqWarn = !eqOk
      ? (selItem.casterOnly ? 'Only spellcasters can use this scroll.' : `${CLASSES[d.classKey].label} can't use this.`)
      : '';
    return `<div class="item-detail">
      <div class="id-name" style="color:${selItem.color}">${itemIconHTML(selItem.icon)} ${selItem.name} ${isLocked ? '🔒' : ''}</div>
      <div class="id-slot">${cap(selItem.slot)} — ${cap(selItem.rarity)} · ${ilvlText(selItem, d.level)}${qtyLine(selItem)}</div>
      <div class="id-bonus">${tLine || 'No bonuses'}</div>
      <div class="id-perk">${selItem.charges} charge${selItem.charges === 1 ? '' : 's'} each</div>
      ${compHTML}
      <div class="id-actions">
        <button id="id-equip" ${eqOk?'':'disabled'} title="${eqOk?'':(selItem.casterOnly ? 'Caster classes only' : 'Not proficient')}">Equip ${qtyOf(selItem) > 1 ? 'one ' : ''}on ${d.name}</button>
        <button id="id-lock">${isLocked ? '🔒 Locked' : '🔓 Lock'}</button>
        ${sellButtons(selItem, isLocked)}
      </div>
      ${eqWarn ? `<div class="id-warn">${eqWarn}</div>` : ''}
      <div class="id-hint">${selItem.thrown ? 'Thrown in combat by whoever carries it — no magic needed. One charge per throw.' : selItem.scroll ? 'Casts the spell while equipped, consuming one charge per cast.' : 'Drink while equipped (uses a charge).'} When the last charge goes, the next one in the bag is readied automatically. Double-click or drag to a slot to equip.</div>
    </div>`;
  }
  const pLine = perkText(selItem);
  return `<div class="item-detail${selItem.rarity==='legendary'?' legendary-detail':''}">
      <div class="id-name" style="color:${selItem.color}">${itemIconHTML(selItem.icon)} ${selItem.name} ${isLocked ? '🔒' : ''}</div>
      <div class="id-slot">${cap(selItem.slot)} — ${cap(selItem.rarity)} · ${ilvlText(selItem, d.level)} · <span style="color:#5fd46a; font-weight:600;">PS ${itemPoints(selItem)}</span></div>
      <div class="id-bonus">${bonusText(selItem, d.level)||'No bonuses'}</div>
      ${pLine ? `<div class="id-perk">${pLine}</div>` : ''}
      ${compHTML}
      <div class="id-actions">
        <button id="id-equip" ${eqOk?'':'disabled'} title="${eqOk?'':'Class not proficient'}">Equip on ${d.name}</button>
        <button id="id-lock">${isLocked ? '🔒 Locked' : '🔓 Lock'}</button>
        <button id="id-sell" ${isLocked ? 'disabled title="Unlock item to sell"' : ''}>Sell — ${selItem.value}g</button>
      </div>
      ${eqOk?'':`<div class="id-warn">${CLASSES[d.classKey].label} can't use ${selItem.slot==='shield'?'shields':'this armor'}.</div>`}
      <div class="id-hint">${selItem.rarity==='legendary' ? 'Quest reward · grows with the wearer · ' : ''}Double-click or drag to a slot to equip.</div>
    </div>`;
}

/* Stack readouts for the detail panel. Stacks sell one unit per click by
   default — the whole-stack button is separate and says its total, so a
   fat stack of rare dyes is never a single misclick from gone. */
function qtyLine(it){
  const q = qtyOf(it);
  return q > 1 ? ` · <b>×${q}</b> in bag` : '';
}
function sellButtons(it, isLocked){
  const q = qtyOf(it);
  const dis = isLocked ? 'disabled title="Unlock item to sell"' : '';
  const one = `<button id="id-sell" ${dis}>Sell${q > 1 ? ' one' : ''} — ${it.value}g</button>`;
  const all = q > 1 ? `<button id="id-sell-all" ${dis}>Sell all ×${q} — ${(it.value | 0) * q}g</button>` : '';
  return one + all;
}

/**
 * Minimum-power-score filter for the bag grid.
 *
 * Rarity says how many affix rolls an item got; PS says how much it is actually
 * worth wearing, so this is the axis worth filtering on when the bag fills up
 * with well-rolled commons and badly-rolled epics. Hidden only — nothing is
 * sold or discarded, and the bulk-sell panel is unaffected.
 *
 * Rendered only when the current tab holds something with a PS at all, so it
 * does not appear over dyes and potions (which score 0 and would all vanish the
 * moment the slider left zero).
 */
function psFilterHTML(maxPS, hiddenByPS) {
  if (!(maxPS > 0)) return '';
  /* One floor, not two sliders. A max-PS cap meant hiding your best finds,
     which nobody wants, and dragging a range to a precise number is the wrong
     input for what players actually do here: knock out the junk and move on.
     The presets come off the bag's own spread so the numbers mean something
     relative to what you are carrying rather than being absolute PS trivia. */
  const steps = [...new Set([0.25, 0.5, 0.75]
    .map(f => Math.max(5, Math.round(maxPS * f / 5) * 5))
    .filter(v => v > 0 && v <= maxPS))];
  const chip = (val, label, tip) => `
    <button class="ps-chip${bagMinPS === val ? ' on' : ''}" data-psfloor="${val}" title="${tip}">${label}</button>`;
  const chips = chip(0, 'All', 'Show every item in the bag')
    + steps.map(v => chip(v, `&lt;${v}`, `Hide bag items under ${v} power score`)).join('');
  const sell = (bagMinPS > 0 && hiddenByPS > 0)
    ? `<button class="ps-sell" data-pssell="${bagMinPS}"
        title="Sell the ${hiddenByPS} hidden item(s) under PS ${bagMinPS}. Locked and legendary items are never sold.">
        Sell ${hiddenByPS} junk</button>`
    : '';
  const hint = bagMinPS > 0
    ? `<span class="ps-hidden">${hiddenByPS} hidden</span>`
    : '<span class="ps-hidden dim">showing all</span>';
  return `<div class="ps-filter">
    <span class="ps-filter-label" title="Power score floor">Junk</span>
    <span class="ps-chips">${chips}</span>
    ${hint}${sell}
  </div>`;
}

/** Count items per rarity and render bulk-sell buttons.
 *  `pool` is the (already category-filtered) bag list — bulk-sell operates only
 *  on the active tab's UNLOCKED items. */
function bulkSellHTML(pool){
  const RARITY_ORDER = ['legendary','epic','rare','uncommon','common'];
  const unlocked = pool.filter(it => !it.locked);
  const counts = {};
  for(const it of unlocked) counts[it.rarity] = (counts[it.rarity]||0) + qtyOf(it);
  const rows = RARITY_ORDER.filter(r => counts[r]).map(r => {
    const c = RARITIES[r].color;
    const totalVal = unlocked.filter(it => it.rarity === r).reduce((s,it) => s + (it.value | 0) * qtyOf(it), 0);
    /* Chip per rarity on one line. The gold total moved to the tooltip: it was
       five stacked full-width rows of it, and the number is confirmation
       detail, not something you scan for. */
    return `<button class="sell-rarity-btn" data-rarity="${r}" style="border-color:${c}; color:${c}"
      title="Sell all ${r} items shown (${counts[r]}) for ${totalVal}g">${cap(r)} <b>${counts[r]}</b></button>`;
  });
  if(!rows.length) return '';
  const scope = bagFilter!=='all' ? ` · ${BAG_CAT_LABEL[bagFilter]}` : '';
  /* Say the PS window out loud. These buttons destroy items, and they now sell
     exactly what the filter is showing — the player has to be able to see that
     the sale is narrowed without inferring it from the counts. */
  const psActive = bagMinPS > 0;
  const psScope = psActive ? ` · PS ${bagMinPS}+` : '';
  const note = psActive
    ? `<div class="bulk-sell-note" style="font-size:15px; opacity:0.75;">Only items shown by the power-score filter are sold.</div>`
    : '';
  return `<div class="bulk-sell">
    <div class="bulk-sell-row">
      <span class="bulk-sell-title">Sell all${scope}${psScope}</span>
      <span class="bulk-sell-btns">${rows.join('')}</span>
    </div>${note}</div>`;
}

/**
 * Builds the "Active Status Effects" panel shown at the bottom of the
 * Equipment tab. Reads hero._effects, cross-references EFFECTS registry for
 * the full mechanical breakdown, and formats remaining duration.
 */
const EFFECT_ICONS = {
  raging:'😡', hasted:'⚡', inspired:'✨', shielded:'🛡️', sacredWeapon:'⚔️',
  bearTotem:'🐻', wildShape:'🐺', phaseStep:'👥', remarkableAthlete:'🏃',
  deathWarded:'👼', blinded:'👁️', charmed:'💜', frightened:'😱',
  poisoned:'🤢', paralyzed:'🌀', stunned:'💫', restrained:'🕸️',
  slowed:'⏳', burning:'🔥', prone:'🛌', deafened:'🔇',
  incapacitated:'✖️', unconscious:'💤', weakenedDmg:'🥀', baned:'📉',
  faerieFire:'🧚', guided:'✦', hexMarked:'🔮', huntersMarked:'🎯',
  bloodlust:'🩸', patientDefense:'🛡️',
  silenced:'🤫', warded:'🔰', crusadersMantle:'✝️', dominated:'🧠',
  blessed:'🙏', dashing:'💨', regenerating:'🌿', mirrorImages:'🪞', polymorphed:'🐑', banished:'🌀'
};

function buildMechanicsLine(def) {
  const parts = [];
  const ac = (def.acBonus||0) - (def.acPenalty||0);
  if (ac > 0) parts.push(`+${ac} AC`);
  if (ac < 0) parts.push(`${ac} AC`);
  const atk = (def.atkBonus||0) - (def.atkPenalty||0);
  if (atk > 0) parts.push(`+${atk} to hit`);
  if (atk < 0) parts.push(`${atk} to hit`);
  if (def.dmgBonus > 0) parts.push(`+${def.dmgBonus} damage`);
  if (def.dmgTakenMul != null && def.dmgTakenMul !== 1)
    parts.push(`${Math.round(def.dmgTakenMul*100)}% damage taken`);
  if (def.dmgMul != null && def.dmgMul !== 1)
    parts.push(`${Math.round(def.dmgMul*100)}% damage dealt`);
  if (def.speedMul != null && def.speedMul !== 1)
    parts.push(`${Math.round(def.speedMul*100)}% speed`);
  if (def.incapacitated) parts.push('Cannot act');
  if (def.defAdvantage) parts.push('Enemies hit with advantage');
  if (def.atkDisadvantage) parts.push('Attacks at disadvantage');
  if (def.autoCritMelee) parts.push('Melee hits auto-crit');
  if (def.cantAttackSource) parts.push('Cannot attack source');
  if (def.blessDice) parts.push('+1d4 to attacks');
  if (def.sacredDice) parts.push('+1d8 damage');
  if (def.wildShapeDmg) parts.push('+2d6 melee damage');
  if (def.hexEffect) parts.push('+1d6 from caster');
  if (def.markEffect) parts.push('+1d6 from ranger');
  if (def.dotData) parts.push('Ongoing fire damage');
  return parts;
}

function activeEffectsHTML(d) {
  const effects = d._effects;
  if (!effects || Object.keys(effects).length === 0) return '';

  const elapsed = G.elapsed || 0;
  const rows = Object.entries(effects).map(([key, inst]) => {
    const def = EFFECTS[key];
    if (!def) return '';

    const icon = iconHtml('status', key, EFFECT_ICONS[key] || '•');
    const color = def.color ? '#' + def.color.toString(16).padStart(6,'0') : '#aaa';
    const catClass = def.category === 'buff' ? 'ae-buff'
                   : def.category === 'dot'  ? 'ae-dot'
                   : 'ae-debuff';
    const catLabel = def.category === 'buff' ? 'BUFF'
                   : def.category === 'dot'  ? 'DOT'
                   : 'DEBUFF';

    // Remaining duration
    let durLine = '';
    if (inst.until != null) {
      const remaining = Math.max(0, inst.until - elapsed);
      const secs = Math.ceil(remaining);
      durLine = `<span class="ae-dur">⏱ ${secs}s remaining</span>`;
    } else {
      durLine = `<span class="ae-dur ae-perm">Persistent</span>`;
    }

    // Mechanical breakdown pills
    const mechanics = buildMechanicsLine(def);
    const mechHTML = mechanics.length
      ? `<div class="ae-mechs">${mechanics.map(m => `<span class="ae-mech">${m}</span>`).join('')}</div>`
      : '';

    return `
      <div class="ae-row" style="--ae-color:${color}">
        <div class="ae-icon">${icon}</div>
        <div class="ae-body">
          <div class="ae-header-row">
            <span class="ae-name" style="color:${color}">${def.label}</span>
            <span class="ae-cat ${catClass}">${catLabel}</span>
            ${durLine}
          </div>
          <div class="ae-desc">${def.desc}</div>
          ${mechHTML}
        </div>
      </div>`;
  }).filter(Boolean).join('');

  if (!rows) return '';
  return `
    <div class="cs-active-effects">
      <h3 class="ae-title">⚡ Active Status Effects</h3>
      <div class="ae-list">${rows}</div>
    </div>`;
}

function wireEquip(){
  const main = $('cs-main');
  /* render the hero's sprite (with current gear) into the portrait */
  const pc = main.querySelector('.pt-canvas');
  if(pc) drawHeroPortrait(pc, G.heroes[selHero].data);

  /* equipped slots: click to unequip; draggable for rearrange / drag-off.
     dragend is global-scope cleanup so a canceled drag can't leave dragCtx set. */
  main.querySelectorAll('.eq-slot.filled').forEach(el=>{
    el.addEventListener('click', ()=>{ hideTooltip(); G.unequipItem(G.heroes[selHero].data, el.dataset.slot); render(); });
    /* hover: the same item card the bag shows (stats, perk, runes, Power Score) */
    el.addEventListener('mouseenter', ()=>{
      const hd = G.heroes[selHero].data;
      const it = hd.equipment[el.dataset.slot];
      if(!it) return;
      const tip = $('cs-tooltip');
      tip.classList.add('compact');
      tip.innerHTML = itemTipBlock(it, `Equipped · ${SLOT_LABEL[el.dataset.slot] || ''}`, it.color || '#cfd8dc', hd.level);
      tip.style.display = 'block';
    });
    el.addEventListener('mousemove', e=>positionTooltip(e));
    el.addEventListener('mouseleave', hideTooltip);
    el.addEventListener('dragstart', e=>{
      hideTooltip();
      dragCtx = { kind:'slot', slot:el.dataset.slot };
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', el.dataset.slot); } catch(_) {}
    });
    el.addEventListener('dragend', ()=>{ dragCtx = null; clearDropHighlights(); });
  });

  /* bag items: in-place select (NOT a full render, so dblclick/drag keep their
     target element), double-click to equip, drag to equip, hover for tooltip. */
  main.querySelectorAll('.bag-item').forEach(el=>{
    el.addEventListener('click', ()=>{ selectBagItem(+el.dataset.i); });
    el.addEventListener('dblclick', ()=>{
      const it = G.inventory[+el.dataset.i];
      if(!it) return;
      if(isRune(it)){
        flashNotice('Drag the rune onto a piece of gear to inscribe it.');
        return;
      }
      const r = G.equipItem(G.heroes[selHero].data, it);
      if(r.ok){ selItem = null; render(); }
      else if(r.reason){ flashNotice(r.reason); }
    });
    el.addEventListener('dragstart', e=>{
      dragCtx = { kind:'bag', index:+el.dataset.i };
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', el.dataset.i); } catch(_) {}
    });
    el.addEventListener('dragend', ()=>{ el.classList.remove('dragging'); dragCtx = null; clearDropHighlights(); });
    /* hover: compare the bag item against what's equipped in that slot */
    el.addEventListener('mouseenter', ()=>{
      const it = G.inventory[+el.dataset.i];
      if(!it) return;
      const tip = $('cs-tooltip');
      tip.classList.remove('compact');   // an equipped-slot hover may have left the single-card width on
      tip.innerHTML = compareTooltipHTML(it, G.heroes[selHero].data);
      tip.style.display = 'block';
    });
    /* the bag sits on the right of the screen: always open toward the left, so
       the card doesn't flip sides as the cursor crosses the bag */
    el.addEventListener('mousemove', e=>positionTooltip(e, 'left'));
    el.addEventListener('mouseleave', hideTooltip);
    el.addEventListener('dragover', e=>{
      if(!dragCtx || dragCtx.kind!=='bag') return;
      const rune = G.inventory[dragCtx.index];
      const target = G.inventory[+el.dataset.i];
      if(!isRune(rune) || !target || target === rune) return;
      if(runeFitsItem(rune, target) && canInscribeRune(target)){
        e.preventDefault(); e.dataTransfer.dropEffect='move';
        el.classList.add('drop-valid');
      }
    });
    el.addEventListener('dragleave', ()=> el.classList.remove('drop-valid','drop-invalid'));
    el.addEventListener('drop', e=>{
      e.preventDefault();
      el.classList.remove('drop-valid','drop-invalid');
      if(!dragCtx || dragCtx.kind!=='bag') return;
      const rune = G.inventory[dragCtx.index];
      const target = G.inventory[+el.dataset.i];
      if(!isRune(rune) || !target || target === rune) return;
      const r = G.applyRuneToBagItem(target, rune);
      if(r.ok){ selItem = null; render(); } else if(r.reason) flashNotice(r.reason);
    });
  });

  /* per-hero cosmetic: hide the headgear sprite without unequipping it */
  const hideHelm = main.querySelector('#eq-hide-helm');
  if(hideHelm) hideHelm.addEventListener('change', ()=>{
    const d = G.heroes[selHero].data;
    if(!d.visual) d.visual = {};
    d.visual.hideHelm = hideHelm.checked;
    G.afterGearChange(d);        /* reloads the sprite layers + saves */
    if(pc) drawHeroPortrait(pc, d);
  });

  /* drop targets */
  main.querySelectorAll('.eq-slot').forEach(el=> wireSlotDrop(el));   /* bag->slot, slot->slot */
  const portrait = main.querySelector('.cs-portrait');
  if(portrait) wirePortraitDrop(portrait);                            /* bag->auto-equip */
  const bag = main.querySelector('.cs-bag');
  if(bag) wireBagDrop(bag);                                           /* slot->unequip */

  wireDetail();   /* Equip/Sell buttons in the detail panel */

  /* category tabs */
  main.querySelectorAll('.bag-tab').forEach(btn => {
    btn.addEventListener('click', () => { bagFilter = btn.dataset.filter; selItem = null; render(); });
  });
  /* sort buttons */
  main.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => { G.sortInventory(btn.dataset.sort); selItem = null; render(); });
  });
  /* junk floor: pick a threshold, then optionally dump what it hides */
  main.querySelectorAll('.ps-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      bagMinPS = Math.max(0, parseInt(btn.dataset.psfloor, 10) || 0);
      selItem = null;
      render();
    });
  });
  const psSell = main.querySelector('.ps-sell');
  if (psSell) psSell.addEventListener('click', () => {
    const floor = Math.max(0, parseInt(psSell.dataset.pssell, 10) || 0);
    if (!floor) return;
    const n = G.sellBelowPS(floor, bagFilter === 'all' ? null : bagFilter);
    if (!n) flashNotice('Nothing to sell there — the rest is locked or legendary.');
    selItem = null;
    render();
  });
  /* bulk sell by rarity (respects the active category tab) */
  main.querySelectorAll('.sell-rarity-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      G.sellByRarity(btn.dataset.rarity, bagFilter==='all' ? null : bagFilter,
        { min: bagMinPS, max: null });
      selItem = null;
      render();
    });
  });
}

/* In-place bag selection: toggle the .sel ring and refresh ONLY the detail
   panel (.cs-bag-foot), leaving the .bag-grid intact. This is the fix for the
   broken double-click: a full render() used to destroy the .bag-item element
   between the two clicks, so the browser never fired dblclick. Keeping the
   grid stable also means dragstart listeners survive across selections. */
function selectBagItem(i){
  const it = G.inventory[i];
  if(!it) return;
  selItem = it;
  const main = $('cs-main');
  main.querySelectorAll('.bag-item.sel').forEach(e=>e.classList.remove('sel'));
  const cell = main.querySelector(`.bag-item[data-i="${i}"]`);
  if(cell) cell.classList.add('sel');
  const foot = main.querySelector('.cs-bag-foot');
  if(foot){ foot.innerHTML = detailHTML(G.heroes[selHero].data); wireDetail(); }
}

/* Wire the Equip/Sell buttons inside the detail panel. Called on full render
   and after every in-place selection refresh (the buttons are recreated each
   time, so there's no double-binding). */
function wireDetail(){
  const main = $('cs-main');
  const eq = main.querySelector('#id-equip');
  if(eq) eq.addEventListener('click', ()=>{
    if(!selItem) return;
    const r = G.equipItem(G.heroes[selHero].data, selItem);
    if(r.ok) selItem = null; else if(r.reason) flashNotice(r.reason);
    render();
  });
  const lock = main.querySelector('#id-lock');
  if(lock) lock.addEventListener('click', ()=>{
    if(!selItem) return;
    selItem.locked = !selItem.locked;
    render();
  });
  const sell = main.querySelector('#id-sell');
  if(sell) sell.addEventListener('click', ()=>{
    if(!selItem || selItem.locked) return;
    G.sellItem(selItem, 1);
    if(!G.inventory.includes(selItem)) selItem = null;
    render();
  });
  const sellAll = main.querySelector('#id-sell-all');
  if(sellAll) sellAll.addEventListener('click', ()=>{ if(!selItem || selItem.locked) return; G.sellItem(selItem, Infinity); selItem = null; render(); });
}

/* Whether a bag item can land on this equipment slot. Mirrors equipItem()'s
   slot-resolution + exclusion rules so the drop highlight matches reality. */
function slotAcceptsItem(slotKey, item, hero){
  if(!item) return false;
  if(item.slot==='dye' || isRune(item)) return false; /* dyes/runes apply via drag, never equip */
  let candidates = slotsFor(item.slot);
  if(item.slot==='weapon' && item.light) candidates = candidates.concat(['offhand']); /* Two-Weapon Fighting */
  if(!candidates.includes(slotKey)) return false;
  if(slotKey==='offhand' && item.slot==='weapon' && item.twoHanded) return false;
  if(item.slot==='shield' && hero.equipment.weapon && hero.equipment.weapon.twoHanded) return false;
  if(!canEquip(hero, item)) return false;
  return true;
}

/* Per-slot drop target. Accepts bag->slot (equip with preferSlot) and
   slot->slot (rearrange/swap). Highlights green when the drop will succeed,
   red when it's the right slot type but blocked by a rule. */
function wireSlotDrop(el){
  el.addEventListener('dragover', e=>{
    if(!dragCtx) return;
    const hero = G.heroes[selHero].data;
    const slotKey = el.dataset.slot;
    let valid = false, candidate = false;
    if(dragCtx.kind==='bag'){
      const item = G.inventory[dragCtx.index];
      if(item && item.slot==='dye'){
        /* dye onto an equipped, tintable piece of gear */
        candidate = DYEABLE_SLOTS.has(slotKey);
        valid = candidate && !!hero.equipment[slotKey];
      } else if(item && isRune(item)){
        const worn = hero.equipment[slotKey];
        candidate = !!worn && runeFitsItem(item, worn);
        valid = candidate && canInscribeRune(worn);   // a full or Fabled piece shows red
      } else if(item){
        candidate = slotsFor(item.slot).includes(slotKey) || (item.slot==='weapon' && item.light && slotKey==='offhand');
        valid = candidate && slotAcceptsItem(slotKey, item, hero);
      }
    } else if(dragCtx.kind==='slot' && dragCtx.slot !== slotKey){
      const item = hero.equipment[dragCtx.slot];
      if(item){
        candidate = slotsFor(item.slot).includes(slotKey) || (item.slot==='weapon' && item.light && slotKey==='offhand');
        valid = candidate; /* moveEquipmentSlot re-validates swap legality on drop */
      }
    }
    el.classList.remove('drop-valid','drop-invalid');
    if(candidate){ e.preventDefault(); e.dataTransfer.dropEffect='move'; el.classList.add(valid?'drop-valid':'drop-invalid'); }
  });
  el.addEventListener('dragleave', ()=> el.classList.remove('drop-valid','drop-invalid'));
  el.addEventListener('drop', e=>{
    e.preventDefault();
    el.classList.remove('drop-valid','drop-invalid');
    if(!dragCtx) return;
    const hero = G.heroes[selHero].data;
    const slotKey = el.dataset.slot;
    if(dragCtx.kind==='bag'){
      const item = G.inventory[dragCtx.index];
      if(!item) return;
      const r = item.slot==='dye'
        ? G.applyDye(hero, slotKey, item)
        : isRune(item)
          ? G.applyRuneToSlot(hero, slotKey, item)
          : G.equipItem(hero, item, slotKey);
      if(r.ok){ selItem = null; render(); } else if(r.reason) flashNotice(r.reason);
    } else if(dragCtx.kind==='slot'){
      const r = G.moveEquipmentSlot(hero, dragCtx.slot, slotKey);
      if(r.ok){ selItem = null; render(); } else if(r.reason) flashNotice(r.reason);
    }
  });
}

/* Drop on the portrait: bag item -> auto-slot equip (same as double-click). */
function wirePortraitDrop(portrait){
  portrait.addEventListener('dragover', e=>{
    if(dragCtx && dragCtx.kind==='bag'){
      const item = G.inventory[dragCtx.index];
      if(item && item.slot!=='dye' && !isRune(item) && canEquip(G.heroes[selHero].data, item)){
        e.preventDefault(); e.dataTransfer.dropEffect='move'; portrait.classList.add('drop-target');
      }
    }
  });
  portrait.addEventListener('dragleave', ()=> portrait.classList.remove('drop-target'));
  portrait.addEventListener('drop', e=>{
    e.preventDefault(); portrait.classList.remove('drop-target');
    if(!dragCtx || dragCtx.kind!=='bag') return;
    const item = G.inventory[dragCtx.index];
    if(!item) return;
    const r = G.equipItem(G.heroes[selHero].data, item); /* no preferSlot -> auto */
    if(r.ok){ selItem = null; render(); } else if(r.reason) flashNotice(r.reason);
  });
}

/* Drop on the bag area: equipped slot -> unequip back to inventory. */
function wireBagDrop(bag){
  bag.addEventListener('dragover', e=>{
    if(dragCtx && dragCtx.kind==='slot' && G.heroes[selHero].data.equipment[dragCtx.slot]){
      e.preventDefault(); e.dataTransfer.dropEffect='move'; bag.classList.add('drop-target');
    }
  });
  bag.addEventListener('dragleave', ()=> bag.classList.remove('drop-target'));
  bag.addEventListener('drop', e=>{
    e.preventDefault(); bag.classList.remove('drop-target');
    if(!dragCtx || dragCtx.kind!=='slot') return;
    const hero = G.heroes[selHero].data;
    if(!hero.equipment[dragCtx.slot]) return;
    G.unequipItem(hero, dragCtx.slot);
    selItem = null; render();
  });
}

function clearDropHighlights(){
  const main = $('cs-main');
  if(!main) return;
  main.querySelectorAll('.drop-valid,.drop-invalid,.drop-target').forEach(e=>
    e.classList.remove('drop-valid','drop-invalid','drop-target'));
}

/* Brief non-blocking notice inside the menu overlay (e.g. a blocked equip). */
function flashNotice(msg){
  const t = $('cs-toast');
  if(!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> t.classList.remove('show'), 1800);
}

/* --- icon renderer helper --- */
/* Size lives in CSS (.item-ico), not an inline style — an inline width beats
   every selector, so a 28px icon could not grow to fill the big equip slots. */
function itemIconHTML(icon, className="") {
  if (icon && icon.includes('/')) {
    return `<img class="item-ico ${className}" src="./${icon}" />`;
  }
  return icon || '';
}

/* Display line for a trinket (scroll/potion): the spell or buff it carries. */
function trinketLine(it){
  if(!it) return '';
  if(it.scroll && it.spellKey){
    const sp = SPELLS[it.spellKey];
    if(sp) return `${sp.label}${sp.level ? ' (Lv ' + sp.level + ')' : ''} — ${sp.desc}`;
    return it.spellKey;
  }
  if(it.potion && it.buffKey){
    const eff = EFFECTS[it.buffKey];
    const extra = it.tempHp > 0 ? ` +${it.tempHp} temporary HP.` : '';
    if(eff) return `${eff.label} — ${eff.desc}${extra}`;
    return it.buffKey;
  }
  if(it.potion && it.cures && it.cures.length){
    return `Cures ${it.cures.map(c => (EFFECTS[c] && EFFECTS[c].label) || c).join(', ')}.`;
  }
  return '';
}

/* --- bag hover comparison tooltip ---------------------------------------
   Two cards side by side rather than one stacked above the other, so a
   comparison is read across a row instead of up and down. Within a card the
   order is: what it is (name + what you must be proficient in), what it
   fundamentally does (the damage die / AC base, on its own line), then the
   affixes rolled on top of that, then the perk, then the score. The old
   version ran the base die and every affix together into one em-dash
   separated sentence, which is what made it unreadable at a glance. */

/* Fixed row order so nothing shuffles between renders. Keys not listed here
   are appended afterwards, sorted. */
const TT_STAT_ORDER = ['ac','atk','dmg','hp','crit','heal',
  'str','dex','con','int','wis','cha','move','speed'];

const TT_PCT_KEYS = ['magicFind', 'goldFind', 'potionHeal'];   // budget.js PCT_KEYS
function ttStatText(k, v){
  const sign = v > 0 ? '+' : '';
  if (k === 'speed') return sign + Math.round(v * 100) + '%';
  if (TT_PCT_KEYS.includes(k)) return sign + v + '%';
  if (k === 'range') return sign + v + (Math.abs(v) === 1 ? ' tile' : ' tiles');
  if (k === 'move')  return sign + v + ' ft';
  return sign + v;
}

/** Flatten an item's bonuses to a {key: value} map, kit skills included. */
function ttBonusMap(it, heroLevel){
  if (!it) return {};
  const b = previewBonuses(it, effectiveIlvl(it, heroLevel)) || {};
  const out = {};
  for (const k in b){
    if (k === 'skills'){
      for (const sk in b.skills) if (b.skills[sk]) out['skill:' + sk] = b.skills[sk];
      continue;
    }
    if (b[k]) out[k] = b[k];
  }
  return out;
}

function ttLabel(k){
  if (k.indexOf('skill:') === 0) return SKILLS[k.slice(6)]?.label || k.slice(6);
  return bonusLabel(k);
}

/** Union of the two items' stat keys, in display order. */
function ttOrderedKeys(...maps){
  const seen = new Set();
  for (const m of maps) for (const k in m) if (k !== '__ps') seen.add(k);
  const ordered = TT_STAT_ORDER.filter(k => seen.has(k));
  const rest = [...seen].filter(k => !TT_STAT_ORDER.includes(k)).sort();
  return [...ordered, ...rest];
}

/** The headline stat: the reason the item exists, on its own line. */
function ttPrimaryHTML(it){
  if (it.slot === 'weapon' && it.dmg){
    const tags = weaponTags(it);
    const die = `${it.dmg[0]}d${it.dmg[1]}${it.dmgType ? ' ' + it.dmgType : ''}`;
    return `<div class="tt-primary">${die}</div>`
      + (tags.length ? `<div class="tt-tags">${tags.join(' \u00b7 ')}</div>` : '');
  }
  if (it.armorBase) return `<div class="tt-primary">AC ${it.armorBase}</div>`;
  if (it.acBase)    return `<div class="tt-primary">+${it.acBase} AC</div>`;
  return '';
}

/** One card. `keys` is the shared row set, so both cards line up row for row. */
function ttCard(it, heading, headColor, heroLevel, keys, cmpMap){
  if (!it){
    return `<div class="tt-card empty">
      <div class="tt-head">${heading}</div>
      <div class="tt-none">nothing equipped</div></div>`;
  }
  migrateItem(it);
  const sub = [cap(it.rarity), itemReqText(it)].filter(Boolean).join(' \u00b7 ');

  if (it.scroll || it.potion){
    return `<div class="tt-card">
      <div class="tt-head" style="color:${headColor}">${heading}</div>
      <div class="tt-name" style="color:${it.color}">${itemIconHTML(it.icon)} ${it.name}</div>
      <div class="tt-sub">${sub}</div>
      <div class="tt-primary">${trinketLine(it) || 'Consumable'}</div>
      <div class="tt-rows"><div class="tt-row"><b>${it.charges}</b><span>Charges</span></div></div>
    </div>`;
  }

  const mine = ttBonusMap(it, heroLevel);
  const rows = (keys || []).map(k => {
    const v = mine[k];
    const has = v !== undefined;
    /* A stat this item does NOT carry is still a delta when the thing being
       replaced carried it \u2014 that is a loss on equip, and the most important
       number in the tooltip. Compute the difference before deciding how to
       draw the row, treating "absent" as zero rather than skipping it. */
    let d = '';
    if (cmpMap){
      const diff = (has ? v : 0) - (cmpMap[k] || 0);
      if (diff) d = `<i class="tt-d ${diff > 0 ? 'pos' : 'neg'}">${ttStatText(k, diff)}</i>`;
    }
    if (!has){
      return `<div class="tt-row none"><b>\u2014</b><span>${ttLabel(k)}</span>${d}</div>`;
    }
    /* value first: it sits right against its label instead of across the card */
    return `<div class="tt-row"><b>${ttStatText(k, v)}</b><span>${ttLabel(k)}</span>${d}</div>`;
  }).join('');

  const perk = perkText(it);
  const runes = runeRowsHTML(it);
  const ps = itemPoints(it);
  let psD = '';
  if (cmpMap){
    const diff = ps - (cmpMap.__ps || 0);
    if (diff) psD = `<i class="tt-d ${diff > 0 ? 'pos' : 'neg'}">${diff > 0 ? '+' : ''}${diff}</i>`;
  }
  return `<div class="tt-card">
    <div class="tt-head" style="color:${headColor}">${heading}</div>
    <div class="tt-name" style="color:${it.color}">${itemIconHTML(it.icon)} ${it.name}</div>
    <div class="tt-sub">${sub}${heroLevel != null ? ' \u00b7 ' + ilvlText(it, heroLevel) : ''}</div>
    ${ttPrimaryHTML(it)}
    ${rows ? `<div class="tt-rows">${rows}</div>` : ''}
    ${perk ? `<div class="tt-perk">${perk}</div>` : ''}
    ${runes}
    <div class="tt-foot"><span>Power Score</span><b>${ps}</b>${psD}</div>
  </div>`;
}

/* Inscribed runes and the slots left. Their bonuses (AC, HP, on-hit dice) are
   applied by recalc / the attack code, not folded into the stat rows above,
   so without this an inscribed rune was invisible on the item. */
function runeRowsHTML(it){
  const slots = runeSlotsFor(it);
  const runes = itemRunes(it);
  if (!slots && !runes.length) return '';
  /* tt-rune: name then description, since the description is a phrase */
  const lines = runes.map(r => `<div class="tt-row tt-rune"><span>${itemIconHTML(r.icon || '')} ${r.name || 'Rune'}</span><b>${r.desc || ''}</b></div>`);
  for (let i = runes.length; i < slots; i++) lines.push('<div class="tt-row tt-rune none"><span>Empty rune slot</span><b>—</b></div>');
  const head = slots ? `Runes ${runes.length}/${slots}` : 'Runes';
  return `<div class="tt-rows"><div class="tt-row tt-rune"><span><b>${head}</b></span></div>${lines.join('')}</div>`;
}

/* Single-card hover (an equipped slot, with nothing to compare against). */
export function itemTipBlock(it, heading, headColor, heroLevel=null, compareWith=undefined){
  const keys = ttOrderedKeys(ttBonusMap(it, heroLevel));
  const cmp = compareWith === undefined ? null
    : Object.assign(ttBonusMap(compareWith, heroLevel),
                    { __ps: compareWith ? itemPoints(compareWith) : 0 });
  return ttCard(it, heading, headColor, heroLevel, keys, cmp);
}

/* Dyes and runes aren't gear: no stat rows to compare, just what they are and how to use them.
   `heading` (optional) is the small caps line over the name. */
function nonGearCardHTML(item, heading = '', headColor = ''){
  const head = heading ? `<div class="tt-head" style="color:${headColor}">${heading}</div>` : '';
  if(item.slot==='dye'){
    return `
      <div class="tt-card">${head}
        <div class="tt-name" style="color:${item.color}">${itemIconHTML(item.icon)} ${item.name}
          <span style="display:inline-block;width:12px;height:12px;vertical-align:middle;margin-left:5px;background:${item.dyeColor};border:1px solid rgba(255,255,255,0.35)"></span></div>
        <div class="tt-sub">Dye \u00b7 ${cap(item.rarity)}</div>
        <div class="tt-primary">Drag onto equipped gear to recolor it.</div>
      </div>`;
  }
  if(isRune(item)){
    const onto = item.runeSlotType === 'weapon' ? 'weapons' : 'armor, helm, gloves, boots, or a shield';
    return `
      <div class="tt-card">${head}
        <div class="tt-name" style="color:${item.color}">${itemIconHTML(item.icon)} ${item.name}</div>
        <div class="tt-sub">Rune \u00b7 ${onto}</div>
        <div class="tt-primary">${item.desc || 'Drag onto matching gear to inscribe it.'}</div>
      </div>`;
  }
  return null;
}

/** The inventory's item card for any item, on its own (no comparison): what the
 *  loot reveal shows on a card's face, so a find reads exactly as it will in the bag.
 *  Wrap it in an element with class `item-card` for the tooltip's styling. */
export function itemCardHTML(item, heading = '', headColor = ''){
  if(!item) return '';
  migrateItem(item);
  return nonGearCardHTML(item, heading, headColor) || itemTipBlock(item, heading, headColor);
}

/* ── Shop / reveal: an item against any party member's gear ──────────────────
   A row of party chips, each with what the item would do to that hero's Power
   Score in the slot it fills (or "can't use"), and under it the inventory's own
   side-by-side comparison against the chosen hero. `pick` is the chosen index;
   null picks whoever gains the most. Returns { html, pick } (the index used).
   Wrap the html in an element with class `item-card` for the card styling;
   chips carry data-cmp-hero for the caller to wire. */
export function partyCompareHTML(item, heroes, pick = null){
  if(!item) return { html: '', pick: null };
  migrateItem(item);
  const party = (heroes || []).map(h => h && (h.data || h)).filter(d => d && d.equipment && !d.temp);
  const comparable = party.length && item.slot && item.slot !== 'dye' && !isRune(item) && slotsFor(item.slot).length;
  if(!comparable) return { html: itemCardHTML(item), pick: null };
  const rows = party.map((d, i) => {
    const ok = canEquip(d, item);
    const eqList = slotsFor(item.slot).map(s => d.equipment[s]).filter(Boolean);
    const worst = eqList.length ? eqList.reduce((a, b) => itemPoints(b) < itemPoints(a) ? b : a) : null;
    const gain = itemPoints(item) - (worst ? itemPoints(worst) : 0);
    return { d, i, ok, gain };
  });
  if(pick == null || !rows[pick]){
    const usable = rows.filter(r => r.ok);
    pick = (usable.length ? usable.reduce((a, b) => b.gain > a.gain ? b : a) : rows[0]).i;
  }
  const chips = rows.map(r => {
    const tag = !r.ok ? `<i class="pc-no">can't use</i>`
      : `<i class="${r.gain > 0 ? 'pc-up' : r.gain < 0 ? 'pc-down' : 'pc-same'}">${r.gain > 0 ? '+' : ''}${r.gain} PS</i>`;
    return `<button class="pc-chip${r.i === pick ? ' on' : ''}${r.ok ? '' : ' cant'}" data-cmp-hero="${r.i}" title="Compare with ${r.d.name}'s gear">
      <span class="pc-name">${r.d.name}</span>${tag}</button>`;
  }).join('');
  return {
    html: `<div class="pc-row">${chips}</div>${compareTooltipHTML(item, rows[pick].d)}`,
    pick,
  };
}

/** A shop's own consumable (a potion stack, not an item): the same card look. */
export function consumableCardHTML(icon, name, desc){
  return `<div class="tt-card"><div class="tt-head" style="color:#9cc4f0">Consumable</div>
    <div class="tt-name" style="color:#d4d8dc">${itemIconHTML(icon)} ${name}</div>
    <div class="tt-primary">${desc}</div></div>`;
}

export function compareTooltipHTML(item, hero){
  migrateItem(item);
  const special = nonGearCardHTML(item);
  if(special) return special;
  const opts = slotsFor(item.slot);
  const equippedList = opts.map(s=>hero.equipment?.[s]).filter(Boolean);
  let equipped = null;
  if (equippedList.length > 1) {
    equipped = equippedList.reduce((min, eq) => itemPoints(eq) < itemPoints(min) ? eq : min, equippedList[0]);
  } else if (equippedList.length === 1) {
    equipped = equippedList[0];
  }
  if (equipped) migrateItem(equipped);
  const eqOk = canEquip(hero, item);

  /* One row set across both cards: a stat only one of them carries still gets a
     line on the other side showing a dash. That alignment is what makes the
     comparison readable without parsing two independent lists. */
  const bagMap = ttBonusMap(item, hero.level);
  const eqMap  = ttBonusMap(equipped, hero.level);
  const keys   = ttOrderedKeys(bagMap, eqMap);
  const cmp    = Object.assign({}, eqMap, { __ps: equipped ? itemPoints(equipped) : 0 });

  return `
    <div class="tt-compare">
      ${/* equipped on the left, bag on the right: the same sides the gear and
           the bag sit on in the character screen */ ''}
      ${ttCard(equipped, 'Equipped', '#c8b06a', hero.level, keys, null)}
      ${ttCard(item, 'In bag', '#8fb0d8', hero.level, keys, cmp)}
    </div>
    ${eqOk?'':`<div class="tt-warn">${item.casterOnly ? 'Only spellcasters can use this.' : `${CLASSES[hero.classKey].label} can't use this.`}</div>`}`;
}

/* side 'left' pins the card to the cursor's left (clamped to the screen edge)
   instead of flipping whenever it would run off the right edge. */
function positionTooltip(e, side){
  const tip = $('cs-tooltip');
  if(!tip || tip.style.display==='none') return;
  const pad = 16, r = tip.getBoundingClientRect();
  let x = e.clientX + pad, y = e.clientY + pad;
  if(side === 'left') x = Math.max(8, e.clientX - r.width - pad);
  else if(x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
  if(y + r.height > innerHeight - 8) y = Math.max(8, innerHeight - r.height - 8);
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}

function skillsHTML(){
  const d = G.heroes[selHero].data;
  const cls = CLASSES[d.classKey];

  const currentLevelMinXp = XP_TABLE[d.level] || 0;
  const nextLevelXp = XP_TABLE[d.level + 1];
  const levelXpProgress = d.xp - currentLevelMinXp;
  const levelXpRequired = nextLevelXp ? (nextLevelXp - currentLevelMinXp) : 0;
  const pct = levelXpRequired > 0 ? Math.min(100, Math.max(0, (levelXpProgress / levelXpRequired) * 100)) : 100;

  /* One row, not three: label, bar and counts share a line so the XP strip
     costs ~40px instead of ~110 and the rest of the tab fits without scrolling. */
  const xpBarHTML = `
    <div class="sk-xp-row">
      <span class="xp-label">XP</span>
      <span class="xp-track"><span class="xp-fill" style="width:${pct}%"></span></span>
      <span class="xp-nums">${nextLevelXp
        ? `${levelXpProgress} / ${levelXpRequired} &middot; ${Math.round(pct)}% to Lv ${d.level + 1}`
        : `${d.xp} XP &middot; Max Level`}</span>
    </div>
  `;


  /* Saving throws. recalc() stores the TOTAL bonus in d.saves for every ability
     the class is proficient in (and any the gear touches); everything else is
     just the bare ability mod. */
  const profSaves = CLASS_SAVES[d.classKey] || [];
  const pb = profBonus(d.level);

  /* Only show the ＋ column while the hero actually has points banked. */
  const spendAbility = d.pendingAbility > 0;
  const abils = ABILITIES.map(k=>{
    const eff = d.effStats[k];
    const canAdd = d.pendingAbility>0 && d.stats[k]<20;
    const save = d.saves?.[k] != null ? d.saves[k] : mod(eff);
    const isProf = profSaves.includes(k);
    const saveTip = `${ABILITY_LABEL[k]} saving throw ${fmtMod(save)}`
      + (isProf ? ` — proficient (${fmtMod(mod(eff))} mod ${fmtMod(pb)} prof)` : ' — not proficient');
    return `<div class="sk-ab">
      <span class="sk-ab-l">${ABILITY_LABEL[k]}</span>
      <span class="sk-ab-v">${d.stats[k]}${eff>d.stats[k]?`<i class="up">→${eff}</i>`:''}</span>
      <span class="sk-ab-m">${fmtMod(mod(eff))}</span>
      <span class="sk-ab-save ${isProf?'prof':''}" title="${saveTip}">
        <span class="sv-pip"></span><b>SAVE</b> <em>${fmtMod(save)}</em></span>
      ${spendAbility ? `<button class="sk-plus" data-ab="${k}" ${canAdd?'':'disabled'}>＋</button>` : ''}
    </div>`;
  }).join('');

  const spendSkill = d.pendingSkill > 0;
  const skills = (cls.skills||[]).map(s=>{
    const rank = d.skills[s.key]||0;
    const canAdd = d.pendingSkill>0 && rank<s.max;
    const pips = Array.from({length:s.max},(_,i)=>`<span class="pip ${i<rank?'on':''}"></span>`).join('');
    return `<div class="sk-skill">
      <div class="sk-s-top"><b>${s.name}</b><span class="sk-pips">${pips}</span>
        ${spendSkill ? `<button class="sk-plus" data-skill="${s.key}" ${canAdd?'':'disabled'}>＋</button>` : ''}</div>
      <div class="sk-s-desc">${s.desc}</div>
    </div>`;
  }).join('');

  /* pending feature choices (ASI/feat, fighting style, spells) */
  let choicesHTML = '';
  const pending = d.pendingChoices || [];
  if (pending.length) {
    choicesHTML = pending.map(ch => {
      const opts = (ch.options || []).map(o => `
        <button class="fc-opt" data-choice="${ch.id}" data-opt="${o.key}" title="${o.desc || ''}">
          <b>${o.label}</b>
          <span>${o.desc || ''}</span>
        </button>`).join('');
      return `<div class="sk-choice">
        <h3>📜 ${ch.title || 'Choose a feature'}</h3>
        <div class="fc-opts">${opts}</div>
      </div>`;
    }).join('');
  }

  /* subclass: chooser at level 3, status card once chosen */
  let subclassHTML = '';
  /* The chooser is drawn full width under the XP bar, not in the narrow Path
     column, so each subclass's text fits without scrolling. */
  let subclassPickHTML = '';
  if(needsSubclass(d)){
    const cards = Object.entries(SUBCLASSES[d.classKey]).map(([key,sc])=>`
      <div class="sc-card">
        <div class="sc-name">${sc.label}${sc.srd?' <i class="sc-srd">SRD</i>':''}</div>
        <div class="sc-passive">${sc.passive}</div>
        <div class="sc-active"><b>${sc.active.name}</b> <span class="sc-tier">${RECHARGE_LABEL[sc.active.recharge]}</span><br>${sc.active.desc}</div>
        <button class="sc-pick" data-sc="${key}">Choose ${sc.label}</button>
      </div>`).join('');
    subclassPickHTML = `<div class="sk-subclass sk-subclass-pick">
      <h3>🌟 Choose a Subclass <i>permanent — pick wisely</i></h3>
      <div class="sc-cards">${cards}</div>
    </div>`;
  } else if(d.subclass){
    const sc = subclassOf(d);
    let status;
    if(sc.active.recharge==='slot') status = `${slotBreakdown(d.slots, d.slotsMax)} slots`;
    else if(sc.active.recharge==='ward') status = `${Math.max(0, d.wardHp ?? d.wardMax ?? 0)}/${d.wardMax || 0} ward`;
    else {
      const long = sc.active.recharge==='long' || sc.active.recharge==='day';
      const left = chargesLeft(d, sc.active.key), max = chargeDef(sc.active.key).max;
      status = left > 0
        ? (max > 1 ? `ready · ${left}/${max} uses` : `ready · ${long ? 'long' : 'short'} rest`)
        : (long ? 'spent — long rest (clear floor)' : 'spent — short rest (shrine / skill)');
    }
    subclassHTML = `<div class="sk-subclass chosen">
      <div class="sc-name">${sc.label}</div>
      <div class="sc-passive">${sc.passive}</div>
      <div class="sc-active"><b>${sc.active.name}</b> <span class="sc-tier">${RECHARGE_LABEL[sc.active.recharge]}</span>
        <span class="sc-status ${status==='ready'||sc.active.recharge==='slot'||sc.active.recharge==='ward'?'ok':''}">${status}</span>
        <br>${sc.active.desc}</div>
    </div>`;
  } else if(d.level < SUBCLASS_UNLOCK){
    subclassHTML = `<div class="sk-subclass locked">Subclass unlocks at level ${SUBCLASS_UNLOCK}.</div>`;
  }

  /* unlocked features / spells summary */
  const unlocked = listUnlockedFeatureLabels(d);
  const featListHTML = unlocked.length
    ? `<div class="sk-unlocked">
        <h3>Unlocked Features</h3>
        <div class="fu-list">${unlocked.map(f =>
          `<div class="fu-item" title="${f.desc}"><b>${f.label}</b><span>${f.desc}</span></div>`
        ).join('')}</div>
      </div>`
    : '';

  const slotsHTML = (totalSlots(d.slotsMax) > 0)
    ? `<span class="pt-pill" title="${slotBreakdown(d.slots, d.slotsMax)}">✦ ${totalSlots(d.slots)}/${totalSlots(d.slotsMax)} slots</span>`
    : '';

  let wildShapeFormHTML = '';
  if (d.classKey === 'druid') {
    const curForm = d.wildShapeForm || 'bear';
    const formCards = Object.values(WILD_SHAPE_FORMS).map(wf => `
      <button class="ws-form-card ${curForm === wf.key ? 'chosen' : ''}" data-wsform="${wf.key}" style="flex:1; padding:8px; border:1px solid ${curForm === wf.key ? '#2ecc71' : '#4a4238'}; background:${curForm === wf.key ? 'rgba(46,204,113,0.15)' : 'rgba(20,20,25,0.6)'}; color:#fff; cursor:pointer; border-radius:4px; text-align:left;">
        <div style="font-weight:bold; color:#2ecc71;">${wf.icon} ${wf.label}</div>
        <div style="font-size:16px; opacity:0.85; margin-top:4px;">${wf.desc}</div>
      </button>`).join('');
    /* Drop Wild Shape + the "only when out of slots" policy live here, in the
       druid's own panel. `dropWildShape` already existed as a manual-combat
       bonus action, but that bar only renders on a hero's turn in manual
       control mode — in auto mode (the default) there was no way to reach it,
       and the policy flag had a reader in combat.js and no writer anywhere, so
       it was permanently off. */
    const inForm = !!d.inWildShape;
    const onlySlots = !!d.wildShapeOnlyOutOfSlots;
    wildShapeFormHTML = `<div class="sk-subclass chosen" style="margin-top:10px;">
      <h3>🌿 Wild Shape Form <i>click to select active form</i></h3>
      <div class="ws-form-cards" style="display:flex; gap:8px; margin-top:8px;">${formCards}</div>
      <div class="ws-controls" style="display:flex; gap:10px; align-items:center; margin-top:10px; flex-wrap:wrap;">
        <button class="ws-drop" ${inForm ? '' : 'disabled'}
          title="${inForm ? 'Revert to natural form now' : 'Only available while transformed'}"
          style="padding:7px 12px; border:1px solid ${inForm ? '#2ecc71' : '#3a352e'}; border-radius:4px;
                 background:${inForm ? 'rgba(46,204,113,0.15)' : 'rgba(20,20,25,0.5)'};
                 color:${inForm ? '#fff' : '#6d675e'}; cursor:${inForm ? 'pointer' : 'default'};">
          🌿 Drop Wild Shape
        </button>
        <label class="ws-only-slots" title="Auto-combat keeps casting while slots remain, and only transforms once they are spent."
          style="display:flex; align-items:center; gap:6px; font-size:18px; color:#cfc7b8; cursor:pointer;">
          <input type="checkbox" data-wsonlyslots ${onlySlots ? 'checked' : ''} style="cursor:pointer;">
          Wild Shape only when out of spell slots
        </label>
      </div>
    </div>`;
  }

  /* The familiar is no longer picked here: it is a one-time level-up choice
     queued when the hero learns Find Familiar (features.js syncFamiliarChoice),
     so it shows up with the other pending choices and is fixed once made. */
  const familiarChoiceHTML = '';

  /* Dancing Lights is cast from here, out of combat: the spell menu only
     exists during a fight. Only a hero who took the cantrip sees the card. */
  /* The Light cantrip is on by default; a hero can put it out to stay hidden
     in the dark (light_sources.js heroLightSource reads d.lightOff). */
  let lightToggleHTML = '';
  if ((d.knownSpells || []).includes('light')) {
    const on = !d.lightOff;
    lightToggleHTML = `<button class="pt-pill light-toggle-btn ${on ? 'hot' : ''}"
      title="${on ? 'On — a torch-strength light. Click to put it out and hide in the shadows.' : 'Off — you are unlit. Click to light it again.'}">💡 Light: ${on ? 'On' : 'Off'}</button>`;
  }

  let dancingLightsHTML = '';
  if ((d.knownSpells || []).includes('dancingLights')) {
    const hero = (G.heroes || []).find(h => h.data === d);
    const up = !!(hero && activeDancingLights(hero));
    const canCast = !!(hero && hero.ent && G.state === 'crawl' && !G.isCombatActive());
    const note = up ? 'Three gold wisps are following you until the floor ends.'
      : G.isCombatActive() ? 'Not during a fight.'
      : canCast ? 'Three gold wisps of dim light follow you until the floor ends.'
      : 'Only on a dungeon floor.';
    /* A small on/off pill in the header row, not a full-width card. */
    const tip = (up ? 'On — click to dismiss. ' : canCast ? 'Off — click to cast. ' : '') + note;
    dancingLightsHTML = `<button class="pt-pill dancing-lights-btn ${up ? 'hot' : ''}" data-dancinglights="${up ? 'dismiss' : 'cast'}"
      ${up || canCast ? '' : 'disabled'} title="${tip}">✨ Dancing Lights: ${up ? 'On' : 'Off'}</button>`;
  }


  return `
    <div class="sk-head">
      <div class="sk-hero">
        <canvas class="title-canvas" width="64" height="64"></canvas>
        <span><b>${d.name}</b> — Lv ${d.level} ${cls.label}${d.subclass?` (${subclassOf(d).label})`:''}</span>
      </div>
      <div class="sk-points">
        <span class="pt-pill ${pending.length>0?'hot':''}">${pending.length} choice${pending.length===1?'':'s'}</span>
        <span class="pt-pill ${d.pendingAbility>0?'hot':''}">${d.pendingAbility} ability</span>
        <span class="pt-pill ${d.pendingSkill>0?'hot':''}">${d.pendingSkill} talent</span>
        <span class="pt-pill ${(d.pendingSkillRank||0)>0?'hot':''}" title="Spend these on the Skills tab">${d.pendingSkillRank||0} skill</span>
        ${slotsHTML}
        ${lightToggleHTML}
        ${dancingLightsHTML}
      </div>
    </div>
    ${xpBarHTML}
    ${subclassPickHTML}
    ${choicesHTML}
    ${wildShapeFormHTML}
    ${familiarChoiceHTML}
    <div class="sk-cols">
      <div class="sk-build">
        <h3>${cls.label} Path</h3>
        ${subclassHTML}
        ${classFeatureHTML(d)}
      </div>
      <div class="sk-abils">
        <h3>Ability Scores</h3>
        ${abils}
        <div class="sk-ab-legend">● proficient save — ability mod ${fmtMod(pb)} proficiency${profSaves.length?` (${profSaves.map(a=>ABILITY_LABEL[a]).join(', ')})`:''}</div>
      </div>
      <div class="sk-skills">
        <h3>${cls.label} Talents</h3>
        ${skills}
      </div>
    </div>
    ${featListHTML}
    ${pendingPoints(d)===0?`<div class="sk-none">No choices to make — level up for new features.</div>`:''}`;
}

function wireSkills(){
  const main = $('cs-main');
  const d = G.heroes[selHero].data;
  main.querySelectorAll('.sk-plus[data-ab]').forEach(b=>{
    b.addEventListener('click', ()=>{ G.allocateAbility(d, b.dataset.ab); render(); });
  });
  main.querySelectorAll('.sk-plus[data-skill]').forEach(b=>{
    b.addEventListener('click', ()=>{ G.allocateSkill(d, b.dataset.skill); render(); });
  });
  main.querySelectorAll('.sc-pick').forEach(b=>{
    b.addEventListener('click', ()=>{ G.chooseSubclass(d, b.dataset.sc); render(); });
  });
  main.querySelectorAll('.ws-form-card').forEach(b=>{
    b.addEventListener('click', ()=>{ d.wildShapeForm = b.dataset.wsform; render(); });
  });
  main.querySelectorAll('.ws-drop').forEach(b=>{
    b.addEventListener('click', ()=>{
      const h = G.heroes[selHero];
      if (!h || !h.data.inWildShape || typeof G.revertWildShape !== 'function') return;
      G.revertWildShape(h, 0, { voluntary: true });
      render();
    });
  });
  main.querySelectorAll('[data-wsonlyslots]').forEach(cb=>{
    cb.addEventListener('change', ()=>{ d.wildShapeOnlyOutOfSlots = cb.checked; render(); });
  });
  main.querySelectorAll('.light-toggle-btn').forEach(b=>{
    b.addEventListener('click', ()=>{
      d.lightOff = !d.lightOff;
      const hero = (G.heroes || []).find(h => h.data === d);
      if (hero) G.fxLog(`💡 ${d.name} ${d.lightOff ? 'puts out their light' : 'lights their way again'}.`, 'sys');
      render();
    });
  });
  main.querySelectorAll('.dancing-lights-btn').forEach(b=>{
    b.addEventListener('click', ()=>{
      const hero = (G.heroes || []).find(h => h.data === d);
      if (!hero) return;
      if (b.dataset.dancinglights === 'dismiss') clearDancingLights(hero);
      else {
        const sp = SPELLS.dancingLights;
        G.fxWithSpellCharge(hero, sp.color, () => sp.cast(G, hero));
      }
      render();
    });
  });
  main.querySelectorAll('.fc-opt').forEach(b=>{
    b.addEventListener('click', ()=>{
      G.chooseFeature(d, b.dataset.choice, b.dataset.opt);
      render();
    });
  });
}

const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

function srdSkillsHTML(){
  const d = G.heroes[selHero].data;
  const profBonusVal = 2 + Math.floor((d.level-1)/4);
  const banked = d.pendingSkillRank || 0;

  const groups = {
    str: { label: 'Strength', skills: ['athletics'] },
    dex: { label: 'Dexterity', skills: ['acrobatics', 'sleightOfHand', 'stealth'] },
    int: { label: 'Intelligence', skills: ['arcana', 'history', 'investigation', 'nature', 'religion'] },
    wis: { label: 'Wisdom', skills: ['animalHandling', 'insight', 'medicine', 'perception', 'survival'] },
    cha: { label: 'Charisma', skills: ['deception', 'intimidation', 'performance', 'persuasion'] }
  };

  const cardsHTML = Object.entries(groups).map(([abKey, group]) => {
    const eff = d.effStats[abKey];
    const abMod = Math.floor((eff - 10) / 2);
    const abModStr = (abMod >= 0 ? '+' : '') + abMod;
    
    const skillsHTML = group.skills.map(sKey => {
      const skill = SKILLS[sKey];
      const isProf = d.proficiencies && d.proficiencies.includes(sKey);
      const rank = (d.skillRanks || {})[sKey] || 0;
      const val = d.skillsDerived[sKey] ?? (abMod + (isProf ? profBonusVal : 0) + rank);
      const valStr = (val >= 0 ? '+' : '') + val;
      const dotSymbol = isProf ? '●' : '○';
      const profTooltip = isProf
        ? `Proficient (+${profBonusVal} bonus)`
        : 'Not proficient';
      const canAdd = banked > 0 && rank < SKILL_RANK_MAX;
      const pips = Array.from({ length: SKILL_RANK_MAX },
        (_, i) => `<span class="pip ${i < rank ? 'on' : ''}"></span>`).join('');

      return `
        <div class="srd-skill-row ${isProf ? 'proficient' : ''}" title="${skill.label}: ${valStr} (${abModStr} ${abKey.toUpperCase()}${isProf ? ` + ${profBonusVal} Prof` : ''}${rank ? ` + ${rank} ranks` : ''})">
          <div class="srd-skill-name-wrap">
            <span class="srd-prof-dot" title="${profTooltip}">${dotSymbol}</span>
            <span>${skill.label}</span>
          </div>
          <span class="srd-rank-pips" title="${rank} / ${SKILL_RANK_MAX} ranks">${pips}</span>
          <span class="srd-skill-val">${valStr}</span>
          <button class="sk-plus" data-skillrank="${sKey}" ${canAdd ? '' : 'disabled'}
            title="${rank >= SKILL_RANK_MAX ? 'Maxed out' : 'Spend a skill point (+1)'}">＋</button>
        </div>
      `;
    }).join('');

    return `
      <div class="srd-skill-card">
        <div class="srd-skill-card-header">
          <span class="ability-name">${group.label}</span>
          <span class="ability-mod">${eff} (${abModStr})</span>
        </div>
        <div class="srd-skill-list">
          ${skillsHTML}
        </div>
      </div>
    `;
  }).join('');

  /* What this hero can wear and wield: the same rule equipping uses (class baseline,
     raised by feats; srd.js gearProficiencies), each a clear yes / no. */
  const gp = gearProficiencies(d);
  const mark = (on, label, feat) => `<span class="gp-tag ${on ? 'on' : 'off'}" title="${on ? (feat ? 'Proficient (from a feat)' : 'Proficient') : 'Not proficient'}">`
    + `<b>${on ? '✓' : '✕'}</b>${label}${on && feat ? '<i>feat</i>' : ''}</span>`;
  const profPanel = `
    <div class="gp-panel">
      <div class="gp-row"><span class="gp-head">Armor</span>
        ${mark(gp.armor.light, 'Light', gp.fromFeat.light)}${mark(gp.armor.medium, 'Medium', gp.fromFeat.medium)}${mark(gp.armor.heavy, 'Heavy', gp.fromFeat.heavy)}${mark(gp.shields, 'Shields', gp.fromFeat.shields)}
      </div>
      <div class="gp-row"><span class="gp-head">Weapons</span>
        ${mark(gp.weapons.simple, 'Simple', false)}${mark(gp.weapons.martial, 'Martial', gp.fromFeat.martial)}
        ${gp.specific.length ? `<span class="gp-also">also ${gp.specific.join(', ')}</span>` : ''}
      </div>
    </div>`;

  return `
    <div class="sk-head">
      <div class="sk-hero">
        <canvas class="title-canvas" width="64" height="64"></canvas>
        <span>🛡️ <b>${d.name}</b> — 5e Skill Modifiers (Proficiency Bonus: <b>+${profBonusVal}</b>)</span>
      </div>
      <div class="sk-points">
        <span class="pt-pill ${banked > 0 ? 'hot' : ''}">${banked} skill point${banked === 1 ? '' : 's'}</span>
      </div>
    </div>
    ${profPanel}
    <div class="srd-skills-grid">
      ${cardsHTML}
    </div>
    ${banked > 0
      ? `<div class="sk-hint">Spend points with ＋ — each rank is a flat +1, up to ${SKILL_RANK_MAX} per skill.</div>`
      : ''}
  `;
}

function wireSrdSkills(){
  const main = $('cs-main');
  const d = G.heroes[selHero].data;
  main.querySelectorAll('.sk-plus[data-skillrank]').forEach(b=>{
    b.addEventListener('click', ()=>{ G.allocateSkillRank(d, b.dataset.skillrank); render(); });
  });
}

/* ---------------- AI Priorities tab ---------------- */

/* The per-hero Tactical Directives configuration. */
const TACTICAL_DIRECTIVES = {
  role: {
    key: 'role',
    icon: '🎭',
    label: 'Combat Role',
    desc: 'The job this hero does for the party. Auto reads it from class, gear and spells.',
    options: [
      { key: 'auto', label: '🔄 Auto', desc: 'Read the role from this hero’s build.' },
      { key: 'tank', label: '🛡️ Tank', desc: 'Hold the line: intercept whatever is heading for the casters, and stay near them.' },
      { key: 'striker', label: '⚔️ Striker', desc: 'Get stuck in and deal damage up close.' },
      { key: 'artillery', label: '🏹 Artillery', desc: 'Fight from range, from the safest firing spot. The tank guards this hero.' },
      { key: 'healer', label: '💚 Healer', desc: 'Keep allies up: heal sooner. The tank guards this hero.' },
    ]
  },
  targeting: {
    key: 'targeting',
    icon: '🎯',
    label: 'Target Focus',
    desc: 'Determines which enemy this hero prioritizes during combat.',
    options: [
      { key: 'nearest', label: '⚔️ Nearest Threat', desc: 'Attack whatever is closest. Never run past active enemies.' },
      { key: 'focus_low', label: '🩸 Focus Wounded', desc: 'Finish off low-HP foes within reasonable range.' },
      { key: 'guard_backline', label: '🛡️ Guard Allies', desc: 'Protect fragile allies by targeting their attackers.' },
      { key: 'boss_caster', label: '👑 Boss / Caster', desc: 'Prioritize Elites, Bosses, and enemy spellcasters.' },
    ]
  },
  movementStyle: {
    key: 'movementStyle',
    icon: '🏃',
    label: 'Combat Positioning',
    desc: 'Controls how mobile this hero is on the battlefield.',
    options: [
      { key: 'hold', label: '⚓ Hold Ground', desc: 'Stand firm; attack only what comes into reach.' },
      { key: 'standard', label: '⚔️ Standard', desc: 'Advance to weapon reach and adjust position as needed.' },
      { key: 'kite', label: '🏹 Tactical Kite', desc: 'Maintain distance; disengage if cornered in melee.' },
      { key: 'flank', label: '⚡ Flank & Roam', desc: 'Maneuver aggressively for tactical positioning.' },
    ]
  },
  abilityUsage: {
    key: 'abilityUsage',
    icon: '✨',
    label: 'Ability & Spell Budget',
    desc: 'Dictates how liberally spell slots and abilities are spent.',
    options: [
      { key: 'conservative', label: '🛑 Conservative', desc: 'Basic attacks only, until the fight turns dangerous (someone about to drop, a strong boss, a fight the party could lose). Then spend like Balanced.' },
      { key: 'balanced', label: '⚖️ Balanced', desc: 'Use abilities on Elites, Bosses, or clusters of enemies. Once a fight is won on paper, finish it with plain attacks.' },
      { key: 'unleash', label: '🔥 Unleash Power', desc: 'Cast spells and use special abilities freely, until the last foe is about to fall.' },
    ]
  },
  potionTrigger: {
    key: 'potionTrigger',
    icon: '🧪',
    label: 'Auto-Potion Trigger',
    desc: 'Controls when the hero drinks healing potions from the party stash.',
    options: [
      { key: 'off', label: '🚫 Off (Never)', desc: 'Do not auto-drink; player manages potions manually.' },
      { key: 'emergency', label: '🚑 Emergency (< 25%)', desc: 'Drink potion when near death.' },
      { key: 'proactive', label: '🩺 Proactive (< 50%)', desc: 'Drink potion when below half HP.' },
      { key: 'early', label: '💖 Early Care (< 75%)', desc: 'Drink potion as soon as lightly injured.' },
    ]
  }
};

/* One-click presets that configure all four directives at once. */
const AI_PRESETS = {
  tank: {
    label: '🛡️ Guardian Tank',
    desc: 'Hold position, protect squishy allies, spend spells on key threats, drink when bloodied.',
    prefs: { targeting: 'guard_backline', movementStyle: 'hold', abilityUsage: 'balanced', potionTrigger: 'emergency' }
  },
  striker: {
    label: '⚔️ Aggressive Striker',
    desc: 'Finish wounded foes, flank freely, unleash powerful abilities, drink in emergency.',
    prefs: { targeting: 'focus_low', movementStyle: 'flank', abilityUsage: 'unleash', potionTrigger: 'emergency' }
  },
  kiter: {
    label: '🏹 Kiting Marksman',
    desc: 'Focus high-value targets, keep distance, use abilities on clusters, drink early.',
    prefs: { targeting: 'boss_caster', movementStyle: 'kite', abilityUsage: 'balanced', potionTrigger: 'proactive' }
  },
  saver: {
    label: '🎯 Conservative Saver',
    desc: 'Hit nearest target, hold position, basic attacks only, save potions.',
    prefs: { targeting: 'nearest', movementStyle: 'hold', abilityUsage: 'conservative', potionTrigger: 'off' }
  }
};

function aiPresetMatches(prefs, p) {
  return Object.entries(p.prefs).every(([k, val]) => (prefs[k] || getDirectiveDefault(k)) === val);
}

function getDirectiveDefault(categoryKey) {
  if (categoryKey === 'role') return 'auto';
  if (categoryKey === 'targeting') return 'nearest';
  if (categoryKey === 'movementStyle') return 'standard';
  if (categoryKey === 'abilityUsage') return 'balanced';
  if (categoryKey === 'potionTrigger') return 'emergency';
  return '';
}

function aiPrioritiesHTML(){
  const d = G.heroes[selHero].data;
  const cls = CLASSES[d.classKey];
  const prefs = d.aiPrefs || {};

  const activePreset = Object.entries(AI_PRESETS).find(([_, p]) => aiPresetMatches(prefs, p));

  const directiveCards = Object.values(TACTICAL_DIRECTIVES).map(cat => {
    const activeVal = prefs[cat.key] || getDirectiveDefault(cat.key);
    const activeOpt = cat.options.find(o => o.key === activeVal) || cat.options[0];
    /* Auto role: say what the build reads as right now */
    let activeDesc = activeOpt.desc;
    if (cat.key === 'role' && activeVal === 'auto') {
      const auto = heroRole({ data: { ...d, aiPrefs: { ...prefs, role: 'auto' } } });
      const opt = cat.options.find(o => o.key === auto);
      activeDesc = `Reads as <b>${opt ? opt.label : auto}</b> from this build. ${opt ? opt.desc : ''}`;
    }
    
    const chips = cat.options.map(opt => {
      const isOn = opt.key === activeVal;
      return `<button class="ai-chip${isOn ? ' on' : ''}" data-cat="${cat.key}" data-val="${opt.key}" title="${opt.desc}">
        ${opt.label}
      </button>`;
    }).join('');

    return `<div class="ai-card">
      <div class="ai-card-head">
        <div class="ai-card-title">${cat.icon} ${cat.label}</div>
        <div class="ai-card-sub">${cat.desc}</div>
      </div>
      <div class="ai-chip-row">${chips}</div>
      <div class="ai-card-active-desc"><b>Selected:</b> ${activeDesc}</div>
    </div>`;
  }).join('');

  return `
    <div class="ai-head">
      <div class="sk-hero">
        <canvas class="title-canvas" width="64" height="64"></canvas>
        <span><b>${d.name}</b> — Lv ${d.level} ${cls.label}${d.subclass ? ` (${subclassOf(d).label})` : ''}</span>
      </div>
    </div>
    <div class="ai-presets">
      <h3>Tactical Presets</h3>
      <div class="ai-preset-row">
        ${Object.entries(AI_PRESETS).map(([key, p]) =>
          `<button class="ai-preset${activePreset && activePreset[0] === key ? ' on' : ''}" data-preset="${key}" title="${p.desc}">${p.label}</button>`
        ).join('')}
      </div>
    </div>
    <div class="ai-directives">${directiveCards}</div>
    <div class="ai-note">Each hero remembers their own Tactical Directives. Changes take effect immediately and survive saves.</div>`;
}

function wireAIPriorities(){
  const main = $('cs-main');
  main.querySelectorAll('.ai-chip').forEach(b => {
    b.addEventListener('click', () => {
      const cat = b.dataset.cat;
      const val = b.dataset.val;
      G.setAIPref(selHero, cat, val);
      render();
    });
  });

  main.querySelectorAll('.ai-preset').forEach(b => {
    b.addEventListener('click', () => {
      const p = AI_PRESETS[b.dataset.preset];
      if (p && p.prefs) {
        for (const [k, v] of Object.entries(p.prefs)) {
          G.setAIPref(selHero, k, v);
        }
      }
      render();
    });
  });
}

/* re-check which preset (if any) matches after a slider release */
function refreshPresetHighlight(){
  const d = G.heroes[selHero].data;
  const prefs = d.aiPrefs || {};
  const active = Object.entries(AI_PRESETS).find(([_, p]) => aiPresetMatches(prefs, p));
  document.querySelectorAll('.ai-preset').forEach(b =>
    b.classList.toggle('on', !!(active && active[0] === b.dataset.preset)));
}

/* ================================================================
   Quests tab — the active map quest + what's been found this delve
   ================================================================ */


function questsHTML(){
  const q = G.activeQuest;
  if(!q){
    return `<div class="quest-panel">
      <div class="q-empty">📜 No active quest.<br><span>Choose a quest from the world map to begin a delve.</span></div>
    </div>`;
  }
  const floor = G.questFloor || 1;
  const pct = Math.max(0, Math.min(100, Math.round((floor - 1) / q.floors * 100)));
  const chainBadge = q.chain ? `<span class="q-chain">Chapter ${q.chain.part}</span>` : '';

  let situ = '';
  const p = G.floorPhase;
  if(p && !p.resolved){
    const L = {
      ambush:'⚔ Ambush ahead — all elites, doubled spoils',
      puzzle:(G.puzzleState && G.puzzleState.solved) ? '🔓 The warded seal is broken' : '🔒 A warded seal bars the boss chamber',
      ally:'🤝 A stranger walks with the party',
      gauntlet:'🔥 Gauntlet — no merchant camp after this floor',
      foreshadow:'🔎 A listening floor — secrets to overhear'
    };
    if(L[p.type]) situ = `<div class="q-situ">${L[p.type]}</div>`;
  }

  const rw = [];
  if(q.rewardGold) rw.push(`<span class="q-rw">🪙 ${q.rewardGold}g</span>`);
  if(q.rewardXp)   rw.push(`<span class="q-rw">✦ ${q.rewardXp} XP</span>`);
  if(q.rewardItem) rw.push(`<span class="q-rw${q.isLegendaryReward?' leg':''}">🎁 ${q.rewardItem.name}</span>`);

  const boss = q.finalBossName
    ? `<div class="q-boss">☠ Final boss: <b>${q.finalBossName}</b>${q.bossIntel?' <span class="q-intel">· intel gathered</span>':''}</div>`
    : '';

  const objs = q.sideObjectives || [];
  const objHTML = objs.length
    ? objs.map(so => so.done
        ? `<div class="q-obj done">✓ ${so.label} — claimed</div>`
        : `<div class="q-obj">◈ ${so.label} <b>${so.have}/${so.need}</b></div>`).join('')
    : `<div class="q-obj none">Nothing found yet — explore the dungeon to uncover side objectives.</div>`;

  return `<div class="quest-panel">
    <div class="q-card">
      <div class="q-card-head"><h2>${q.name}</h2>${chainBadge}</div>
      <div class="q-loc">📍 ${q.place || 'the deep'}${q.theme?` · ${cap(q.theme)}`:''}</div>
      <p class="q-desc">${q.description || q.embarkText || ''}</p>
      <div class="q-progress">
        <div class="q-progress-bar"><span style="width:${pct}%"></span></div>
        <div class="q-progress-lbl">Floor ${floor} of ${q.floors}</div>
      </div>
      ${situ}${boss}
      <div class="q-rewards"><span class="q-sec">Rewards</span>${rw.join('') || '<span class="q-rw">—</span>'}</div>
    </div>
    <div class="q-section">
      <div class="q-sec">🔎 Found in the dungeon</div>
      ${objHTML}
    </div>
  </div>`;
}

/* ================================================================
   Bestiary tab — compendium; each entry unlocks at BESTIARY_UNLOCK kills
   ================================================================ */
const TYPE_ICON = {
  beast:'🐾', humanoid:'🧍', undead:'💀', fiend:'😈', monstrosity:'🐲',
  fey:'🧚', elemental:'🔥', giant:'🗿', ooze:'🫧', construct:'🗿',
  dragon:'🐉', aberration:'👁', celestial:'😇'
};
/* Bestiary grouping by CR band. Bands mirror crBandIndex. */
const BEST_SECTION = m => crBandIndex(m.cr);
const BEST_SECTION_LABELS = [
  'CR 0 – ½', 'CR ½ – 2', 'CR 2 – 4½', 'CR 4½ – 8', 'CR 8+'
];
const crStr = cr => cr===0.125 ? '1/8' : cr===0.25 ? '1/4' : cr===0.5 ? '1/2' : String(cr);
const sensLabel = (k,v) => k==='passivePerception'
  ? `passive Perception ${v}`
  : `${cap(k.replace(/([A-Z])/g,' $1'))} ${v} ft.`;
let selMonster = null;
let bestTheme = 'all';     // active dungeon-type sub-tab

/* Sub-tabs mirror the dungeon themes; the filter uses the same per-creature
   `dungeons` whitelist the spawner uses, so a tab shows exactly the monsters
   that can appear in that dungeon type. */
const DUNGEON_TABS = [
  { key:'all',     label:'All Creatures', ico:'📖' },
  { key:'ancient', label:'Ancient Ruins', ico:'🏛' },
  { key:'verdant', label:'Verdant Wilds', ico:'🌿' },
  { key:'frost',   label:'Frostfell',     ico:'❄' },
  { key:'grim',    label:'Grim Crypts',   ico:'🕯' },
  { key:'molten',  label:'Molten Depths', ico:'🌋' },
];
let _famOf = null; // monster id -> MONSTER_THEMES family index
function famOf(){
  if(_famOf) return _famOf;
  _famOf = {};
  MONSTER_THEMES.forEach((fam, i) => {
    for(const id of fam.monsters) _famOf[id] = i;
  });
  return _famOf;
}

function bestiaryHTML(){
  const best = G.bestiary || {};

  let pool = [...MONSTERS_ALL];
  if(bestTheme !== 'all'){
    /* Show exactly what can appear in that dungeon type: creatures explicitly
       whitelisted for the theme (per-creature `dungeons` picks from the bestiary). */
    pool = pool.filter(m => monsterSpawnsIn(m, bestTheme));
  }
  const unlockedCount = pool.filter(m => (best[m.id]||0) >= BESTIARY_UNLOCK).length;
  const totalKills = pool.reduce((a,m)=>a+(best[m.id]||0), 0);

  const list = pool.sort((a,b) =>
    BEST_SECTION(a) - BEST_SECTION(b) || a.cr - b.cr || a.name.localeCompare(b.name));

  let rows = '', lastSection = null;
  for(const m of list){
    const sect = BEST_SECTION(m);
    if(sect !== lastSection){
      lastSection = sect;
      rows += `<div class="best-tier">${BEST_SECTION_LABELS[sect]}</div>`;
    }
    const kills = best[m.id] || 0;
    if(kills >= BESTIARY_UNLOCK){
      rows += `<button class="best-row unlocked${selMonster===m.id?' sel':''}" data-id="${m.id}">
        <span class="best-ico" style="background:${hex(m.color)}33;border-color:${hex(m.color)}">${iconHtml('ctype', m.type, TYPE_ICON[m.type] || '❔')}</span>
        <span class="best-nm">${m.name}</span>
        <span class="best-cr">CR ${crStr(m.cr)}</span></button>`;
    } else {
      const p = Math.round(kills / BESTIARY_UNLOCK * 100);
      rows += `<div class="best-row locked" title="Defeat ${BESTIARY_UNLOCK-kills} more to unlock">
        <span class="best-ico locked">❔</span>
        <span class="best-nm">???</span>
        <span class="best-prog"><span class="best-prog-bar"><span style="width:${p}%"></span></span><em>${kills}/${BESTIARY_UNLOCK}</em></span></div>`;
    }
  }

  const sel = selMonster ? MONSTERS_ALL.find(m=>m.id===selMonster) : null;
  const detail = (sel && (best[sel.id]||0) >= BESTIARY_UNLOCK)
    ? monsterStatHTML(sel, best[sel.id])
    : `<div class="best-detail-empty">📖 Select an unlocked creature to read its stat block.<br><span>Entries unlock after ${BESTIARY_UNLOCK} kills.</span></div>`;

  const tabs = DUNGEON_TABS.map(t =>
    `<button class="best-tab${bestTheme===t.key?' on':''}" data-theme="${t.key}">${t.ico} ${t.label}</button>`).join('');

  return `<div class="bestiary">
    <div class="best-tabs">${tabs}</div>
    <div class="best-listwrap">
      <div class="best-summary">📖 Discovered <b>${unlockedCount}</b> / ${pool.length} · ${totalKills} slain</div>
      <div class="best-list">${rows || '<div class="best-empty">No creatures of this kind are known.</div>'}</div>
    </div>
    <div class="best-detail">${detail}</div>
  </div>`;
}

/* Same rule makeMonsterMesh uses: a bare filename is a DCSS monster tile,
   anything already rooted is taken as-is. The codex used to prefix
   unconditionally, which 404'd every ANIMATED creature — their `sprite` is
   their idle spritesheet, which already lives under sprites/. */
function codexSpritePath(raw){
  const s = raw || 'orc.png';
  return /^(dcss\/|sprites\/|\.\/|\/|https?:|data:)/.test(s) ? s : 'dcss/monster/' + s;
}

/** A creature with sheets gets a live portrait — idle, then attack, on a loop.
 *  Everything else keeps the still image (which is also what `tintCodexSprites`
 *  recolours; sheet art is already final and needs no balance pass). */
function codexPortrait(m){
  const flip = m.flipX ? 'transform:scaleX(-1);' : '';
  const a = m.animations;
  const usable = c => c && c.sprite && (c.cols | 0) > 0 && (c.rows == null || c.rows === 1);
  if (a && usable(a.idle)) {
    return `<span class="ms-anim" data-mon="${m.id}" style="${flip}"></span>`;
  }
  return `<img class="ms-sprite" data-mon="${m.id}" src="${codexSpritePath(m.sprite)}" alt="${m.name}" style="${flip}">`;
}

function monsterStatHTML(m, kills){
  const sb = m.statblock || {};
  const abil = ['str','dex','con','int','wis','cha'].map(k=>{
    const s = (m.effStats && m.effStats[k]) || 10;
    return `<div class="ms-ab"><span>${k.toUpperCase()}</span><b>${s}</b><em>${fmtMod(mod(s))}</em></div>`;
  }).join('');
  const line = (lbl,val) => `<div class="ms-line"><span>${lbl}</span><b>${val}</b></div>`;
  const saves = m.saves && Object.keys(m.saves).length
    ? line('Saving Throws', Object.entries(m.saves).map(([k,v])=>k.toUpperCase()+' '+fmtMod(v)).join(', ')) : '';
  const skills = sb.skills && Object.keys(sb.skills).length
    ? line('Skills', Object.entries(sb.skills).map(([k,v])=>cap(k)+' '+fmtMod(v)).join(', ')) : '';
  const senses = sb.senses && Object.keys(sb.senses).length
    ? line('Senses', Object.entries(sb.senses).map(([k,v])=>sensLabel(k,v)).join(', ')) : '';
  const dmg = (lbl,arr) => arr && arr.length ? line(lbl, arr.join(', ')) : '';
  const cond = sb.condImmune && sb.condImmune.length ? line('Condition Immunities', sb.condImmune.join(', ')) : '';
  const formatTraitText = (text) => {
    if (!text) return '';
    return text.replace(/DC (\d+)\s+([A-Za-z]+)\s+saving throw/gi, (match, dcStr, statName) => {
      const abKey = statName.toLowerCase().slice(0, 3);
      if (['str','dex','con','int','wis','cha'].includes(abKey)) {
        const prof = sb.prof || Math.max(2, Math.floor(((m.cr || 1) - 1) / 4) + 2);
        const statVal = (m.effStats && m.effStats[abKey]) || 10;
        const statMod = Math.floor((statVal - 10) / 2);
        const calcDC = 8 + prof + statMod;
        return `DC ${calcDC} ${cap(statName)} saving throw`;
      }
      return match;
    });
  };
  const langs = sb.languages && sb.languages !== '—' ? line('Languages', sb.languages) : '';
  const traits = (sb.traits||[]).map(t=>`<div class="ms-trait"><b>${t.name}.</b> ${formatTraitText(t.desc)}</div>`).join('');
  const actions = (sb.actions||[]).map(a=>`<div class="ms-trait"><b>${a.name}.</b> ${formatTraitText(a.desc)}</div>`).join('');
  const dmgStr = `${m.dmg[0]}d${m.dmg[1]}${m.dmg[2]?fmtMod(m.dmg[2]):''}`;
  const hpAvg = Math.floor(m.hp[0] * (m.hp[1] + 1) / 2 + (m.hp[2] || 0));
  const hpStr = `${hpAvg} (${m.hp[0]}d${m.hp[1]}${m.hp[2] ? fmtMod(m.hp[2]) : ''})`;
  const fam = MONSTER_THEMES[famOf()[m.id]];
  return `<div class="ms">
    <div class="ms-head">
      <span class="ms-sprite-wrap" style="background:${hex(m.color)}22;border-color:${hex(m.color)}88">
        ${codexPortrait(m)}
      </span>
      <div class="ms-title"><h2>${m.name}</h2>
        <div class="ms-sub">${cap(m.size)} ${m.type} · CR ${crStr(m.cr)} · ${m.xp} XP${fam?' · '+fam.name:''}${sb.source==='synth'?' · <i class="ms-synth">homebrew</i>':''}</div></div>
      <div class="ms-kills" title="times slain">☠ ${kills}</div>
    </div>
    <div class="ms-core">
      ${line('Armor Class', m.ac)}
      ${line('Hit Points', hpStr)}
      ${line('Speed', `${m.speedFt || Math.round(((m.speed || 3) * 10) / 5) * 5} ft.`)}
      ${line('Attack', fmtMod(m.atk)+' to hit · '+dmgStr+' dmg')}
    </div>
    <div class="ms-abils">${abil}</div>
    ${saves}${skills}${senses}
    ${dmg('Damage Resistances', sb.resist)}
    ${dmg('Damage Immunities', sb.immune)}
    ${dmg('Damage Vulnerabilities', sb.vulnerable)}
    ${cond}${langs}
    ${traits ? `<div class="ms-sec">Traits</div>${traits}` : ''}
    ${actions ? `<div class="ms-sec">Actions</div>${actions}` : ''}
  </div>`;
}

function wireBestiary(){
  $('cs-main').querySelectorAll('.best-row.unlocked').forEach(b =>
    b.addEventListener('click', ()=>{ selMonster = b.dataset.id; render(); }));
  $('cs-main').querySelectorAll('.best-tab').forEach(b =>
    b.addEventListener('click', ()=>{ bestTheme = b.dataset.theme; render(); }));
  tintCodexSprites();
  startCodexAnim();
}

/* ── codex portrait animation ────────────────────────────────────────────
   Plays the creature's idle sheet through once, then its attack sheet, then
   repeats — so the statblock shows both of the poses it actually uses in a
   fight rather than a frozen frame.

   Driven by background-position on a single element rather than a canvas: the
   sheets are one row of equal cells, which is exactly the case the CSS sprite
   trick handles, and it costs no texture upload. Only one statblock is on
   screen at a time, so there is only ever one of these running. */
let _codexAnim = null;

function stopCodexAnim(){
  if (_codexAnim && _codexAnim.raf && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(_codexAnim.raf);
  }
  _codexAnim = null;
}

function startCodexAnim(){
  stopCodexAnim();
  if (typeof requestAnimationFrame !== 'function') return;
  const host = $('cs-main');
  const el = host && host.querySelector('.ms-anim[data-mon]');
  if (!el) return;
  const m = MONSTERS_ALL.find(x => x.id === el.dataset.mon);
  const a = m && m.animations;
  if (!a) return;

  /* Attack is optional — a creature with only an idle sheet just loops idle. */
  const clips = [a.idle, a.attack].filter(c => c && c.sprite && (c.cols | 0) > 0);
  if (!clips.length) return;

  let clipI = 0, frame = 0, acc = 0, last = performance.now();

  const showClip = (c) => {
    el.style.backgroundImage = `url("${c.sprite}")`;
    el.style.backgroundSize = `${(c.cols | 0) * 100}% 100%`;
  };
  const showFrame = (c, f) => {
    const cols = c.cols | 0;
    el.style.backgroundPosition = cols > 1 ? `${(f / (cols - 1)) * 100}% 0` : '0 0';
  };

  showClip(clips[0]);
  showFrame(clips[0], 0);

  const step = (now) => {
    /* The panel is rebuilt wholesale on every render, so a stale loop would go
       on animating a detached node forever. */
    if (!el.isConnected) { stopCodexAnim(); return; }
    acc += now - last;
    last = now;
    let guard = 0;
    let spf = 1000 / (clips[clipI].fps || 12);
    while (acc >= spf && guard++ < 60) {
      acc -= spf;
      frame++;
      if (frame >= (clips[clipI].cols | 0)) {
        frame = 0;
        clipI = (clipI + 1) % clips.length;
        showClip(clips[clipI]);
        spf = 1000 / (clips[clipI].fps || 12);
      }
    }
    showFrame(clips[clipI], frame);
    _codexAnim.raf = requestAnimationFrame(step);
  };

  _codexAnim = { el, raf: requestAnimationFrame(step) };
}

/* Bake the bestiary editor's colour balance into the codex portrait, so the
   statblock matches the mini the player actually fights. */
function tintCodexSprites(){
  $('cs-main').querySelectorAll('.ms-sprite[data-mon]').forEach(img => {
    const m = MONSTERS_ALL.find(x => x.id === img.dataset.mon);
    if (!m || isIdentityColorBalance(m.colorBalance)) return;
    loadBalancedCanvas(img.getAttribute('src'), m.colorBalance, (canvas) => {
      try { img.src = canvas.toDataURL(); }
      catch (e) { /* tainted canvas — leave the untinted portrait */ }
    });
  });
}
