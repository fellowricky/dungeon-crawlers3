/**
 * Menu system — a single pausing overlay with two tabs:
 *   • Equipment & Bag — per-hero gear slots, derived stats, shared inventory
 *   • Skills          — spend banked level-up points on ability scores + class skills
 * Plus a top nav bar to open them. All DOM; reads/writes game state through the
 * controller's menu-action methods.
 */
import { CLASSES, RACES, ABILITIES, ABILITY_LABEL, mod, fmtMod,
         canEquip, pendingPoints, classSkill, cantripDice,
         SUBCLASSES, SUBCLASS_UNLOCK, RECHARGE_LABEL, subclassOf, needsSubclass } from './srd.js';
import { SLOTS, SLOT_LABEL, slotsFor, bonusText, RARITIES } from './items.js';

const CLASS_ICON = { fighter:'⚔️', rogue:'🏹', cleric:'✨', wizard:'🔮' };

let G = null;              // game controller
let selHero = 0;           // selected hero index
let tab = 'equip';         // 'equip' | 'skills'
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
          <button class="cs-tab" data-tab="equip">Equipment &amp; Bag</button>
          <button class="cs-tab" data-tab="skills">Skills</button>
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
}

/* ---------------- rendering ---------------- */
function render(){
  if(!open) return;
  $('cs-gold').textContent = G.gold;
  document.querySelectorAll('.cs-tab').forEach(b=>b.classList.toggle('on', b.dataset.tab===tab));
  renderRail();
  $('cs-main').innerHTML = tab==='equip' ? equipHTML() : skillsHTML();
  if(tab==='equip') wireEquip(); else wireSkills();
}

function renderRail(){
  const rail = $('cs-rail');
  rail.innerHTML = G.heroes.map((h,i)=>{
    const d = h.data, cls = CLASSES[d.classKey];
    const pend = pendingPoints(d);
    return `<button class="rail-hero ${i===selHero?'on':''}" data-i="${i}">
      <span class="rail-ico" style="background:${hex(cls.color)}22;border-color:${hex(cls.color)}">${CLASS_ICON[d.classKey]}</span>
      <span class="rail-meta"><b>${d.name}</b><i>Lv ${d.level} ${cls.label}</i></span>
      ${pend?`<span class="rail-badge">${pend}</span>`:''}
    </button>`;
  }).join('');
  rail.querySelectorAll('.rail-hero').forEach(b=>b.addEventListener('click', ()=>{ selHero=+b.dataset.i; selItem=null; render(); }));
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
    <div class="stat-row"><span>Crit</span><b>${d.critRange}–20</b></div>
    <div class="stat-row"><span>HP</span><b>${d.hp} / ${d.maxHp}</b></div>
    <div class="stat-row"><span>Armor Class</span><b>${d.ac}</b></div>
    <div class="stat-row"><span>Move Speed</span><b>${Math.round(d.speedMult*100)}%</b></div>
    ${cls.healer?`<div class="stat-row"><span>Heal / cast</span><b>1d8+${mod(d.effStats.wis)+d.healBonus}</b></div>`:''}
    <div class="cs-abils">${ab}</div>
    <div class="cs-feature">${CLASS_ICON[d.classKey]} ${cls.attack.name} · ${cls.acDesc}<br>${cls.feature}
    ${d.subclass?`<br>🌟 ${subclassOf(d).label}: ${subclassOf(d).passive}`:''}<br><i>${race.trait}</i></div>
  </div>`;
}

function equipHTML(){
  const d = G.heroes[selHero].data;
  /* equipment slots */
  const slots = SLOTS.map(s=>{
    const it = d.equipment[s.key];
    if(it){
      return `<div class="eq-slot filled" data-slot="${s.key}" style="border-color:${it.color}"
        title="${it.name}\n${bonusText(it)}">
        <span class="eq-ico">${it.icon}</span>
        <span class="eq-slotlabel" style="color:${it.color}">${SLOT_LABEL[s.key]}</span></div>`;
    }
    return `<div class="eq-slot" data-slot="${s.key}"><span class="eq-ph">${s.icon}</span>
      <span class="eq-slotlabel">${s.label}</span></div>`;
  }).join('');

  /* bag grid */
  const bag = G.inventory.length
    ? G.inventory.map((it,i)=>`<div class="bag-item ${selItem===it?'sel':''}" data-i="${i}"
        style="border-color:${it.color}" title="${it.name}">
        <span class="bag-ico">${it.icon}</span>
        <span class="bag-r" style="background:${it.color}"></span></div>`).join('')
    : `<div class="bag-empty">Your bag is empty. Loot some chests!</div>`;

  /* selected-item detail / actions */
  let detail = '';
  if(selItem){
    const eqOk = canEquip(d, selItem);
    detail = `<div class="item-detail">
      <div class="id-name" style="color:${selItem.color}">${selItem.icon} ${selItem.name}</div>
      <div class="id-slot">${cap(selItem.slot)} · ${cap(selItem.rarity)}</div>
      <div class="id-bonus">${bonusText(selItem)||'No bonuses'}</div>
      <div class="id-actions">
        <button id="id-equip" ${eqOk?'':'disabled'} title="${eqOk?'':'Class not proficient'}">Equip on ${d.name}</button>
        <button id="id-sell">Sell · ${selItem.value}g</button>
      </div>
      ${eqOk?'':`<div class="id-warn">${CLASSES[d.classKey].label} can't use this armor.</div>`}
    </div>`;
  }

  const cls = CLASSES[d.classKey];
  return `
    <div class="cs-portrait">
      <div class="pt-art" style="background:radial-gradient(circle at 50% 35%, ${hex(cls.color)}33, transparent 70%)">
        <span class="pt-ico">${CLASS_ICON[d.classKey]}</span>
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
    </div>`;
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
      Sell all ${r} (${counts[r]}) · ${totalVal}g</button>`;
  });
  if(!rows.length) return '';
  return `<div class="bulk-sell"><div class="bulk-sell-title">Sell by rarity</div><div class="bulk-sell-btns">${rows.join('')}</div></div>`;
}

function wireEquip(){
  const main = $('cs-main');
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
    if(sc.active.recharge==='slot') status = `${d.slots}/${d.slotsMax} slots`;
    else if(sc.active.recharge==='day') status = d.abilityUsed.day ? 'spent — recharges next floor' : 'ready';
    else status = d.abilityUsed.short ? 'spent — recharges after combat' : 'ready';
    subclassHTML = `<div class="sk-subclass chosen">
      <div class="sc-name">${sc.label}</div>
      <div class="sc-passive">${sc.passive}</div>
      <div class="sc-active"><b>${sc.active.name}</b> <span class="sc-tier">${RECHARGE_LABEL[sc.active.recharge]}</span>
        <span class="sc-status ${status==='ready'||sc.active.recharge==='slot'?'ok':''}">${status}</span></div>
    </div>`;
  } else if(d.level < SUBCLASS_UNLOCK){
    subclassHTML = `<div class="sk-subclass locked">Subclass unlocks at level ${SUBCLASS_UNLOCK}.</div>`;
  }

  return `
    <div class="sk-head">
      <div class="sk-hero">${CLASS_ICON[d.classKey]} <b>${d.name}</b> — Lv ${d.level} ${cls.label}${d.subclass?` (${subclassOf(d).label})`:''}</div>
      <div class="sk-points">
        <span class="pt-pill ${d.pendingAbility>0?'hot':''}">${d.pendingAbility} ability</span>
        <span class="pt-pill ${d.pendingSkill>0?'hot':''}">${d.pendingSkill} skill</span>
      </div>
    </div>
    ${subclassHTML}
    <div class="sk-cols">
      <div class="sk-abils">
        <h3>Ability Scores <i>+1 each, cap 20</i></h3>
        ${abils}
      </div>
      <div class="sk-skills">
        <h3>${cls.label} Skills</h3>
        ${skills}
      </div>
    </div>
    ${pendingPoints(d)===0?`<div class="sk-none">No points to spend — level up to earn more.</div>`:''}`;
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
}

const cap = s => s.charAt(0).toUpperCase()+s.slice(1);
