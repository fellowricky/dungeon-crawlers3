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
         SUBCLASSES, SUBCLASS_UNLOCK, RECHARGE_LABEL, subclassOf, needsSubclass, SKILLS } from './srd.js';
import { listUnlockedFeatureLabels, totalSlots, slotBreakdown } from './features.js';
import {
  SLOTS, SLOT_LABEL, slotsFor, bonusText, perkText, ilvlText,
  RARITIES, getBaseStatsText, migrateItem, previewBonuses, effectiveIlvl
} from './items.js';
import { drawHeroPortrait } from './sprite_animator.js';
import { EFFECTS } from './conditions.js';
import MONSTERS_ALL from './monsters.json' with { type: 'json' };
import { BESTIARY_UNLOCK } from './constants.js';

const CLASS_ICON = { 
  fighter:'⚔️', rogue:'🏹', cleric:'✨', wizard:'🔮',
  barbarian:'🪓', bard:'🎵', druid:'🌿', monk:'🥋',
  paladin:'🛡️', ranger:'🏹', sorcerer:'🔮', warlock:'💀'
};

let G = null;              // game controller
let selHero = 0;           // selected hero index
let tab = 'equip';         // 'equip' | 'skills' | 'srdSkills' | 'ai'
let selItem = null;        // selected bag item
let open = false;

const $ = id => document.getElementById(id);
const hex = n => '#'+n.toString(16).padStart(6,'0');

export function initMenus(game){
  G = game;

  const nav = document.createElement('div');
  nav.id = 'topnav';
  nav.innerHTML = `
    <button id="nav-party" title="Manage equipment & inventory">🎒 <span>Party</span></button>
    <button id="nav-levelup" title="Spend level-up points">⭐ <span>Level&nbsp;Up</span><span id="nav-levelup-badge" class="badge" style="display:none">0</span></button>`;
  document.body.appendChild(nav);

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
    </div>`;
  document.body.appendChild(ov);

  /* floating comparison tooltip for hovered bag items */
  const tip = document.createElement('div');
  tip.id = 'cs-tooltip';
  document.body.appendChild(tip);

  $('nav-party').addEventListener('click', ()=>openMenu('equip'));
  $('nav-levelup').addEventListener('click', ()=>openMenu('skills'));
  $('cs-close').addEventListener('click', closeMenu);
  ov.addEventListener('click', e=>{ if(e.target===ov) closeMenu(); });
  ov.querySelectorAll('.cs-tab').forEach(b=>b.addEventListener('click', ()=>{ tab=b.dataset.tab; selItem=null; render(); }));
  addEventListener('keydown', e=>{
    if(e.key==='Escape' && open) closeMenu();
    else if((e.key==='i'||e.key==='I') && !open && G.state==='crawl') openMenu('equip');
    else if((e.key==='k'||e.key==='K') && !open && G.state==='crawl') openMenu('skills');
  });
}

export function refreshMenus(game){
  const total = game.heroes.reduce((n,h)=>n+pendingPoints(h.data),0);
  const badge = $('nav-levelup-badge');
  if(badge){ badge.textContent = total; badge.style.display = total>0?'':'none'; }
  const nav = $('nav-levelup');
  if(nav) nav.classList.toggle('pulse', total>0);
  if(open) render();
}

function openMenu(which){
  if(!G || G.heroes.length===0) return;
  tab = which; open = true; selItem = null;
  G.setPaused(true);
  $('charscreen').classList.add('show');
  render();
}
function closeMenu(){
  open = false;
  G.setPaused(false);
  $('charscreen').classList.remove('show');
  hideTooltip();
}
function hideTooltip(){ const t = $('cs-tooltip'); if(t) t.style.display = 'none'; }

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
  rail.innerHTML = G.heroes.map((h,i)=>{
    const d = h.data, cls = CLASSES[d.classKey];
    const pend = pendingPoints(d);
    return `<button class="rail-hero ${i===selHero?'on':''}" data-i="${i}">
      <span class="rail-ico" style="background:${hex(cls.color)}22;border-color:${hex(cls.color)}">
        <canvas class="rail-canvas" width="64" height="64" data-i="${i}"></canvas>
      </span>
      <span class="rail-meta"><b>${d.name}</b><i>Lv ${d.level} ${cls.label}</i></span>
      ${pend?`<span class="rail-badge">${pend}</span>`:''}
    </button>`;
  }).join('');
  rail.querySelectorAll('.rail-hero').forEach(b=>b.addEventListener('click', ()=>{ selHero=+b.dataset.i; selItem=null; render(); }));
  rail.querySelectorAll('.rail-canvas').forEach(canvas=>{
    const idx = +canvas.dataset.i;
    drawHeroPortrait(canvas, G.heroes[idx].data);
  });
}

/* damage display string for a hero's attack */
function dmgString(d){
  const a = CLASSES[d.classKey].attack;
  const dice = a.cantripScale ? cantripDice(d.level) : a.dmg[0];
  const flat = (a.cantripScale ? 0 : mod(d.effStats[a.ability])) + d.dmgBonus;
  return `${dice}d${a.dmg[1]}${flat?fmtMod(flat):''}`;
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
    <div class="stat-row"><span>Attack</span><b>${fmtMod(d.atkBonus)} to hit</b></div>
    <div class="stat-row"><span>Damage</span><b>${dmgString(d)}</b></div>
    <div class="stat-row"><span>Crit</span><b>${d.critRange}—20</b></div>
    <div class="stat-row"><span>HP</span><b>${d.hp} / ${d.maxHp}</b></div>
    <div class="stat-row"><span>Armor Class</span><b>${d.ac}</b></div>
    <div class="stat-row"><span>Move Speed</span><b>${Math.round(d.speedMult*100)}%</b></div>
    ${cls.healer?`<div class="stat-row"><span>Heal / cast</span><b>1d8+${mod(d.effStats[cls.attack.ability])+d.healBonus}</b></div>`:''}
    <div class="cs-abils">${ab}</div>
    <div class="cs-feature">${CLASS_ICON[d.classKey]} ${cls.attack.name} — ${cls.acDesc}<br>${cls.feature}
    ${d.subclass?`<br>🌟 ${subclassOf(d).label}: ${subclassOf(d).passive}`:''}<br><i>${race.trait}</i></div>
  </div>`;
}

function equipHTML(){
  const d = G.heroes[selHero].data;
  /* equipment slots */
  const slots = SLOTS.map(s=>{
    const it = d.equipment[s.key];
    if(it){
      migrateItem(it);
      const leg = it.rarity === 'legendary' ? ' legendary-slot' : '';
      const tipPerk = perkText(it);
      return `<div class="eq-slot filled${leg}" data-slot="${s.key}" style="border-color:${it.color}"
        title="${it.name}\n${ilvlText(it, d.level)}\n${bonusText(it, d.level)}${tipPerk ? '\n' + tipPerk : ''}">
        <span class="eq-ico">${itemIconHTML(it.icon)}</span>
        <span class="eq-slotlabel" style="color:${it.color}">${SLOT_LABEL[s.key]}</span></div>`;
    }
    return `<div class="eq-slot" data-slot="${s.key}"><span class="eq-ph">${s.icon}</span>
      <span class="eq-slotlabel">${s.label}</span></div>`;
  }).join('');

  /* bag grid */
  const bag = G.inventory.length
    ? G.inventory.map((it,i)=>{
        migrateItem(it);
        const leg = it.rarity === 'legendary' ? ' legendary-item' : '';
        return `<div class="bag-item${leg} ${selItem===it?'sel':''}" data-i="${i}"
          style="border-color:${it.color}" title="${it.name}">
          <span class="bag-ico">${itemIconHTML(it.icon)}</span>
          <span class="bag-r" style="background:${it.color}"></span></div>`;
      }).join('')
    : `<div class="bag-empty">Your bag is empty. Loot some chests!</div>`;

  /* selected-item detail / actions */
  let detail = '';
  if(selItem){
    migrateItem(selItem);
    const eqOk = canEquip(d, selItem);
    const pLine = perkText(selItem);
    detail = `<div class="item-detail${selItem.rarity==='legendary'?' legendary-detail':''}">
      <div class="id-name" style="color:${selItem.color}">${itemIconHTML(selItem.icon)} ${selItem.name}</div>
      <div class="id-slot">${cap(selItem.slot)} — ${cap(selItem.rarity)} · ${ilvlText(selItem, d.level)}</div>
      <div class="id-bonus">${bonusText(selItem, d.level)||'No bonuses'}</div>
      ${pLine ? `<div class="id-perk">${pLine}</div>` : ''}
      <div class="id-actions">
        <button id="id-equip" ${eqOk?'':'disabled'} title="${eqOk?'':'Class not proficient'}">Equip on ${d.name}</button>
        <button id="id-sell">Sell — ${selItem.value}g</button>
      </div>
      ${eqOk?'':`<div class="id-warn">${CLASSES[d.classKey].label} can't use ${selItem.slot==='shield'?'shields':'this armor'}.</div>`}
      ${selItem.rarity==='legendary' ? `<div class="id-hint">Quest reward · grows with the wearer</div>` : ''}
    </div>`;
  }

  const cls = CLASSES[d.classKey];
  return `
    <div class="cs-portrait">
      <div class="pt-art" style="background:radial-gradient(circle at 50% 40%, ${hex(cls.color)}33, transparent 70%)">
        <canvas class="pt-canvas" width="64" height="64"></canvas>
      </div>
      <div class="pt-name">${d.name}</div>
      <div class="pt-sub">Lv ${d.level} ${RACES[d.raceKey].label} ${cls.label}</div>
    </div>
    <div class="cs-equip">
      <div class="eq-grid">${slots}</div>
      <div class="eq-hint">Click an equipped item to remove it.</div>
    </div>
    ${statsPanelHTML(d)}
    <div class="cs-bag">
      <h3>Bag <span class="bag-count">${G.inventory.length}</span>
        <span class="bag-sort">
          <button class="sort-btn" data-sort="rarity-desc" title="Sort: best rarity first">🔽</button>
          <button class="sort-btn" data-sort="rarity-asc" title="Sort: worst rarity first">🔼</button>
          <button class="sort-btn" data-sort="name" title="Sort: by name">🔤</button>
        </span>
      </h3>
      <div class="bag-grid">${bag}</div>
      ${detail}
      ${bulkSellHTML()}
    </div>
    ${activeEffectsHTML(d)}`;
}

/** Count items per rarity and render bulk-sell buttons. */
function bulkSellHTML(){
  const RARITY_ORDER = ['legendary','epic','rare','uncommon','common'];
  const counts = {};
  for(const it of G.inventory) counts[it.rarity] = (counts[it.rarity]||0) + 1;
  const rows = RARITY_ORDER.filter(r => counts[r]).map(r => {
    const totalVal = G.inventory.filter(it => it.rarity === r).reduce((s,it) => s + it.value, 0);
    const c = RARITIES[r].color;
    return `<button class="sell-rarity-btn" data-rarity="${r}" style="border-color:${c}; color:${c}">
      Sell all ${r} (${counts[r]}) — ${totalVal}g</button>`;
  });
  if(!rows.length) return '';
  return `<div class="bulk-sell"><div class="bulk-sell-title">Sell by rarity</div><div class="bulk-sell-btns">${rows.join('')}</div></div>`;
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
  faerieFire:'🧚', hexMarked:'🔮', huntersMarked:'🎯'
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

    const icon = EFFECT_ICONS[key] || '•';
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

  main.querySelectorAll('.eq-slot.filled').forEach(el=>{
    el.addEventListener('click', ()=>{ G.unequipItem(G.heroes[selHero].data, el.dataset.slot); render(); });
  });
  main.querySelectorAll('.bag-item').forEach(el=>{
    el.addEventListener('click', ()=>{ selItem = G.inventory[+el.dataset.i]; render(); });
    el.addEventListener('dblclick', ()=>{
      const it = G.inventory[+el.dataset.i];
      const r = G.equipItem(G.heroes[selHero].data, it);
      if(r.ok){ selItem = null; render(); }
    });
    /* hover: compare the bag item against what's equipped in that slot */
    el.addEventListener('mouseenter', ()=>{
      const it = G.inventory[+el.dataset.i];
      if(!it) return;
      const tip = $('cs-tooltip');
      tip.innerHTML = compareTooltipHTML(it, G.heroes[selHero].data);
      tip.style.display = 'block';
    });
    el.addEventListener('mousemove', e=>positionTooltip(e));
    el.addEventListener('mouseleave', hideTooltip);
  });
  const eq = $('id-equip');
  if(eq) eq.addEventListener('click', ()=>{
    const r = G.equipItem(G.heroes[selHero].data, selItem);
    if(r.ok) selItem = null;
    render();
  });
  const sell = $('id-sell');
  if(sell) sell.addEventListener('click', ()=>{ G.sellItem(selItem); selItem = null; render(); });
  /* sort buttons */
  main.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => { G.sortInventory(btn.dataset.sort); selItem = null; render(); });
  });
  /* bulk sell by rarity */
  main.querySelectorAll('.sell-rarity-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      G.sellByRarity(btn.dataset.rarity);
      selItem = null;
      render();
    });
  });
}

/* --- icon renderer helper --- */
function itemIconHTML(icon, className="") {
  if (icon && icon.includes('/')) {
    return `<img class="${className}" src="./${icon}" style="width:28px;height:28px;image-rendering:pixelated;vertical-align:middle;margin-right:4px;" />`;
  }
  return icon || '';
}

/* --- bag hover comparison tooltip --- */
function itemTipBlock(it, heading, headColor, heroLevel=null){
  if(!it) return `<div class="tt-block empty"><div class="tt-head">${heading}</div><i>— empty —</i></div>`;
  migrateItem(it);
  let bText = bonusText(it, heroLevel);
  if(!bText){
    const baseStats = getBaseStatsText(it.slot, it.name);
    bText = baseStats || 'No bonuses';
  }
  const pLine = perkText(it);
  return `<div class="tt-block">
    <div class="tt-head" style="color:${headColor}">${heading}</div>
    <div class="tt-name" style="color:${it.color}">${itemIconHTML(it.icon)} ${it.name}</div>
    <div class="tt-sub">${cap(it.slot)} — ${cap(it.rarity)} · ${ilvlText(it, heroLevel)}</div>
    <div class="tt-bonus">${bText}</div>
    ${pLine ? `<div class="tt-perk">${pLine}</div>` : ''}
  </div>`;
}
function compareTooltipHTML(item, hero){
  migrateItem(item);
  const opts = slotsFor(item.slot);
  const equipped = opts.map(s=>hero.equipment[s]).find(Boolean) || null;
  if (equipped) migrateItem(equipped);
  const eqOk = canEquip(hero, item);
  const delta = equipped ? bonusDeltaHTML(item, equipped, hero.level) : '';
  return `
    ${itemTipBlock(item, 'In bag', '#8fb0d8', hero.level)}
    <div class="tt-vs">vs. equipped</div>
    ${itemTipBlock(equipped, 'Equipped', '#c8b06a', hero.level)}
    ${delta}
    ${eqOk?'':`<div class="tt-warn">${CLASSES[hero.classKey].label} can't use this.</div>`}`;
}

/** Green/red stat deltas between bag item and equipped piece. */
function bonusDeltaHTML(bag, eq, heroLevel){
  const keys = ['ac','atk','dmg','hp','crit','heal','str','dex','con','int','wis','cha','speed'];
  const label = { ac:'AC', atk:'Hit', dmg:'Dmg', hp:'HP', crit:'Crit', heal:'Heal',
    str:'STR', dex:'DEX', con:'CON', int:'INT', wis:'WIS', cha:'CHA', speed:'Spd' };
  const bagB = previewBonuses(bag, effectiveIlvl(bag, heroLevel));
  const eqB = previewBonuses(eq, effectiveIlvl(eq, heroLevel));
  const parts = [];
  for (const k of keys) {
    const d = (bagB[k]||0) - (eqB[k]||0);
    if (!d) continue;
    const sign = d > 0 ? '+' : '';
    const col = d > 0 ? '#5fd46a' : '#e0705a';
    const txt = k === 'speed'
      ? `${sign}${Math.round(d*100)}% ${label[k]}`
      : `${sign}${d} ${label[k]}`;
    parts.push(`<span style="color:${col}">${txt}</span>`);
  }
  if (bag.perk && !eq.perk) parts.push(`<span style="color:#e8a83f">+perk</span>`);
  else if (!bag.perk && eq.perk) parts.push(`<span style="color:#e0705a">−perk</span>`);
  if (!parts.length) return '';
  return `<div class="tt-delta">${parts.join(' · ')}</div>`;
}
function positionTooltip(e){
  const tip = $('cs-tooltip');
  if(!tip || tip.style.display==='none') return;
  const pad = 16, r = tip.getBoundingClientRect();
  let x = e.clientX + pad, y = e.clientY + pad;
  if(x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
  if(y + r.height > innerHeight - 8) y = Math.max(8, innerHeight - r.height - 8);
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}

function skillsHTML(){
  const d = G.heroes[selHero].data;
  const cls = CLASSES[d.classKey];
  const abils = ABILITIES.map(k=>{
    const eff = d.effStats[k];
    const canAdd = d.pendingAbility>0 && d.stats[k]<20;
    return `<div class="sk-ab">
      <span class="sk-ab-l">${ABILITY_LABEL[k]}</span>
      <span class="sk-ab-v">${d.stats[k]}${eff>d.stats[k]?`<i class="up">→${eff}</i>`:''} <em>${fmtMod(mod(eff))}</em></span>
      <button class="sk-plus" data-ab="${k}" ${canAdd?'':'disabled'}>＋</button>
    </div>`;
  }).join('');

  const skills = (cls.skills||[]).map(s=>{
    const rank = d.skills[s.key]||0;
    const canAdd = d.pendingSkill>0 && rank<s.max;
    const pips = Array.from({length:s.max},(_,i)=>`<span class="pip ${i<rank?'on':''}"></span>`).join('');
    return `<div class="sk-skill">
      <div class="sk-s-top"><b>${s.name}</b><span class="sk-pips">${pips}</span>
        <button class="sk-plus" data-skill="${s.key}" ${canAdd?'':'disabled'}>＋</button></div>
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
  if(needsSubclass(d)){
    const cards = Object.entries(SUBCLASSES[d.classKey]).map(([key,sc])=>`
      <div class="sc-card">
        <div class="sc-name">${sc.label}${sc.srd?' <i class="sc-srd">SRD</i>':''}</div>
        <div class="sc-passive">${sc.passive}</div>
        <div class="sc-active"><b>${sc.active.name}</b> <span class="sc-tier">${RECHARGE_LABEL[sc.active.recharge]}</span><br>${sc.active.desc}</div>
        <button class="sc-pick" data-sc="${key}">Choose ${sc.label}</button>
      </div>`).join('');
    subclassHTML = `<div class="sk-subclass">
      <h3>🌟 Choose a Subclass <i>permanent — pick wisely</i></h3>
      <div class="sc-cards">${cards}</div>
    </div>`;
  } else if(d.subclass){
    const sc = subclassOf(d);
    let status;
    if(sc.active.recharge==='slot') status = `${slotBreakdown(d.slots, d.slotsMax)} slots`;
    else if(sc.active.recharge==='long' || sc.active.recharge==='day')
      status = d.abilityUsed?.long ? 'spent — long rest (clear floor)' : 'ready · long rest';
    else status = d.abilityUsed?.short ? 'spent — short rest (shrine / skill)' : 'ready · short rest';
    subclassHTML = `<div class="sk-subclass chosen">
      <div class="sc-name">${sc.label}</div>
      <div class="sc-passive">${sc.passive}</div>
      <div class="sc-active"><b>${sc.active.name}</b> <span class="sc-tier">${RECHARGE_LABEL[sc.active.recharge]}</span>
        <span class="sc-status ${status==='ready'||sc.active.recharge==='slot'?'ok':''}">${status}</span></div>
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
        ${slotsHTML}
      </div>
    </div>
    ${choicesHTML}
    ${subclassHTML}
    ${featListHTML}
    <div class="sk-cols">
      <div class="sk-abils">
        <h3>Ability Scores <i>raise via ASI choices (L4/8/10)</i></h3>
        ${abils}
      </div>
      <div class="sk-skills">
        <h3>${cls.label} Talents</h3>
        ${skills}
      </div>
    </div>
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
      const val = d.skillsDerived[sKey] ?? (abMod + (isProf ? profBonusVal : 0));
      const valStr = (val >= 0 ? '+' : '') + val;
      const dotSymbol = isProf ? '●' : '○';
      const profTooltip = isProf 
        ? `Proficient (+${profBonusVal} bonus)` 
        : 'Not proficient';

      return `
        <div class="srd-skill-row ${isProf ? 'proficient' : ''}" title="${skill.label}: ${valStr} (${abModStr} ${abKey.toUpperCase()}${isProf ? ` + ${profBonusVal} Prof` : ''})">
          <div class="srd-skill-name-wrap">
            <span class="srd-prof-dot" title="${profTooltip}">${dotSymbol}</span>
            <span>${skill.label}</span>
          </div>
          <span class="srd-skill-val">${valStr}</span>
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

  return `
    <div class="sk-head">
      <div class="sk-hero">
        <canvas class="title-canvas" width="64" height="64"></canvas>
        <span>🛡️ <b>${d.name}</b> — 5e Skill Modifiers (Proficiency Bonus: <b>+${profBonusVal}</b>)</span>
      </div>
    </div>
    <div class="srd-skills-grid">
      ${cardsHTML}
    </div>
  `;
}

/* ---------------- AI Priorities tab ---------------- */

/* The four per-hero behaviour knobs. `low`/`high` describe the slider ends. */
const AI_KNOBS = [
  { key: 'targetPref', icon: '🎯', label: 'Target Priority',
    low: 'Weakest foe first — clear trash', high: 'Strongest foe first — engage the boss' },
  { key: 'abilityUse', icon: '✨', label: 'Ability Use',
    low: 'No abilities — basic attacks only', high: 'Liberal — spend spells & heals freely' },
  { key: 'potionThreshold', icon: '🧪', label: 'Potion Threshold',
    low: 'Never drinks', high: 'Drinks preemptively at high HP' },
  { key: 'combatMovement', icon: '🏃', label: 'Combat Movement',
    low: 'Hold position — plant & attack', high: 'Highly mobile — chase & reposition' },
];

/* One-click presets that set every knob at once. */
const AI_PRESETS = {
  aggressive:   { targetPref: 1.0, abilityUse: 1.0, potionThreshold: 0.2, combatMovement: 1.0,
                  label: '⚔️ Aggressive',  desc: 'Engage the biggest threat, spend freely, hold potions, roam the field.' },
  balanced:     { targetPref: 0.5, abilityUse: 0.5, potionThreshold: 0.5, combatMovement: 0.5,
                  label: '⚖️ Balanced',    desc: 'Default behaviour — a middle mix of every knob.' },
  defensive:    { targetPref: 0.0, abilityUse: 0.3, potionThreshold: 0.8, combatMovement: 0.2,
                  label: '🛡️ Defensive',   desc: 'Pick off the weak, conserve resources, drink early, hold position.' },
  conservative: { targetPref: 0.3, abilityUse: 0.0, potionThreshold: 0.7, combatMovement: 0.3,
                  label: '🎯 Conservative', desc: 'No abilities — basic attacks only, drink early, stay put.' },
};

function aiValLabel(key, v) {
  const pct = Math.round(v * 100);
  if (key === 'potionThreshold') return v <= 0 ? 'Never' : `Below ${pct}% HP`;
  return `${pct}%`;
}

function aiPrioritiesHTML(){
  const d = G.heroes[selHero].data;
  const cls = CLASSES[d.classKey];
  const prefs = d.aiPrefs || {};

  const presetButtons = Object.entries(AI_PRESETS).map(([key, p]) =>
    `<button class="ai-preset" data-preset="${key}" title="${p.desc}">${p.label}</button>`
  ).join('');

  /* highlight any preset whose values exactly match the hero's current knobs */
  const activePreset = Object.entries(AI_PRESETS).find(([_, p]) =>
    AI_KNOBS.every(k => Math.abs((prefs[k.key] != null ? prefs[k.key] : 0.5) - p[k.key]) < 0.005));

  const knobs = AI_KNOBS.map(k => {
    const v = prefs[k.key] != null ? prefs[k.key] : 0.5;
    return `<div class="ai-knob">
      <div class="ai-k-head">
        <span class="ai-k-label">${k.icon} ${k.label}</span>
        <span class="ai-k-val" data-knob="${k.key}">${aiValLabel(k.key, v)}</span>
      </div>
      <input type="range" class="ai-slider" min="0" max="1" step="0.01" value="${v}" data-knob="${k.key}">
      <div class="ai-k-ends"><span>${k.low}</span><span>${k.high}</span></div>
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
      <h3>Presets</h3>
      <div class="ai-preset-row">
        ${Object.entries(AI_PRESETS).map(([key, p]) =>
          `<button class="ai-preset${activePreset && activePreset[0] === key ? ' on' : ''}" data-preset="${key}" title="${p.desc}">${p.label}</button>`
        ).join('')}
      </div>
    </div>
    <div class="ai-knobs">${knobs}</div>
    <div class="ai-note">Each hero remembers their own settings. Sliders take effect immediately and survive saves.</div>`;
}

function wireAIPriorities(){
  const main = $('cs-main');
  main.querySelectorAll('.ai-slider').forEach(s => {
    const key = s.dataset.knob;
    const valEl = main.querySelector(`.ai-k-val[data-knob="${key}"]`);
    /* live-update the readout while dragging; persist once on release */
    s.addEventListener('input', () => { valEl.textContent = aiValLabel(key, parseFloat(s.value)); });
    s.addEventListener('change', () => {
      G.setAIPref(selHero, key, parseFloat(s.value));
      refreshPresetHighlight();
    });
  });
  main.querySelectorAll('.ai-preset').forEach(b => {
    b.addEventListener('click', () => {
      const p = AI_PRESETS[b.dataset.preset];
      for (const k of AI_KNOBS) G.setAIPref(selHero, k.key, p[k.key]);
      render();
    });
  });
}

/* re-check which preset (if any) matches after a slider release */
function refreshPresetHighlight(){
  const d = G.heroes[selHero].data;
  const prefs = d.aiPrefs || {};
  const active = Object.entries(AI_PRESETS).find(([_, p]) =>
    AI_KNOBS.every(k => Math.abs((prefs[k.key] != null ? prefs[k.key] : 0.5) - p[k.key]) < 0.005));
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
const TIER_ORDER = { 1:1, 2:2, 3:3, 4:4, 5:5, boss:6 };
const crStr = cr => cr===0.125 ? '1/8' : cr===0.25 ? '1/4' : cr===0.5 ? '1/2' : String(cr);
const sensLabel = (k,v) => k==='passivePerception'
  ? `passive Perception ${v}`
  : `${cap(k.replace(/([A-Z])/g,' $1'))} ${v} ft.`;
let selMonster = null;

function bestiaryHTML(){
  const best = G.bestiary || {};
  const unlockedCount = MONSTERS_ALL.filter(m => (best[m.id]||0) >= BESTIARY_UNLOCK).length;
  const totalKills = Object.values(best).reduce((a,b)=>a+b, 0);

  const list = [...MONSTERS_ALL].sort((a,b) =>
    (TIER_ORDER[a.tier]||9) - (TIER_ORDER[b.tier]||9) || a.cr - b.cr || a.name.localeCompare(b.name));

  let rows = '', lastTier = null;
  for(const m of list){
    if(m.tier !== lastTier){
      lastTier = m.tier;
      rows += `<div class="best-tier">${m.tier==='boss' ? '☠ Bosses' : 'Tier '+m.tier}</div>`;
    }
    const kills = best[m.id] || 0;
    if(kills >= BESTIARY_UNLOCK){
      rows += `<button class="best-row unlocked${selMonster===m.id?' sel':''}" data-id="${m.id}">
        <span class="best-ico" style="background:${hex(m.color)}33;border-color:${hex(m.color)}">${TYPE_ICON[m.type]||'❔'}</span>
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

  return `<div class="bestiary">
    <div class="best-listwrap">
      <div class="best-summary">📖 Discovered <b>${unlockedCount}</b> / ${MONSTERS_ALL.length} · ${totalKills} slain</div>
      <div class="best-list">${rows}</div>
    </div>
    <div class="best-detail">${detail}</div>
  </div>`;
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
  const langs = sb.languages && sb.languages !== '—' ? line('Languages', sb.languages) : '';
  const traits = (sb.traits||[]).map(t=>`<div class="ms-trait"><b>${t.name}.</b> ${t.desc}</div>`).join('');
  const actions = (sb.actions||[]).map(a=>`<div class="ms-trait"><b>${a.name}.</b> ${a.desc}</div>`).join('');
  const dmgStr = `${m.dmg[0]}d${m.dmg[1]}${m.dmg[2]?fmtMod(m.dmg[2]):''}`;
  return `<div class="ms">
    <div class="ms-head">
      <span class="ms-ico" style="background:${hex(m.color)}33;border-color:${hex(m.color)}">${TYPE_ICON[m.type]||'❔'}</span>
      <div class="ms-title"><h2>${m.name}</h2>
        <div class="ms-sub">${cap(m.size)} ${m.type} · CR ${crStr(m.cr)} · ${m.xp} XP${sb.source==='synth'?' · <i class="ms-synth">homebrew</i>':''}</div></div>
      <div class="ms-kills">☠ ${kills}</div>
    </div>
    <div class="ms-core">
      ${line('Armor Class', m.ac)}
      ${line('Hit Points', m.hp[0]+'–'+m.hp[1])}
      ${line('Speed', m.speed)}
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
}
