/**
 * Game HUD + party setup screen. All DOM, no three.js.
 */
import { RACES, CLASSES, ABILITIES, ABILITY_LABEL, rollStat, mod, fmtMod, XP_TABLE, MAX_LEVEL, HERO_NAMES,
         subclassOf, SKILLS, getDefaultProficiencies } from './srd.js';

const $ = id => document.getElementById(id);

/* ---------------- combat log ---------------- */
const LOG_MAX = 90;
export function log(msg, kind=''){
  const box = $('gamelog');
  if(!box) return;
  const div = document.createElement('div');
  div.className = 'logline ' + kind;
  div.textContent = msg;
  box.appendChild(div);
  while(box.children.length > LOG_MAX) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

/* ---------------- party frames ---------------- */
const ABILITY_ICON = {
  actionSurge:'⚔', rallyingCry:'📣', cunningAction:'💨', deathstrike:'🗡',
  preserveLife:'✨', guidedStrike:'⚡', fireball:'🔥', magicMissile:'✴',
  frenzy:'🪓', bearTotem:'🐻', cuttingWords:'💬', combatInspiration:'🎵',
  entangle:'🌿', wildShape:'🐺', quiveringPalm:'🫱', shadowStep:'👥',
  sacredWeapon:'✨', vowOfEnmity:'🎯', colossusSlayer:'🏹', companionStrike:'🐺',
  dragonBreath:'🐲', wildSurge:'🔮', fiendishBlessing:'😈', feyPresence:'🌸'
};

/* one small icon per class/subclass ability, lit when ready / dim when spent;
   slot-pool abilities show a count badge instead */
function abilityIconsHTML(h){
  const cls = CLASSES[h.classKey];
  const icons = [];
  if(h.secondWind)
    icons.push({ ico:'🌀', ready:!h.secondWindUsed,
      tip:`Second Wind — self-heal when badly hurt (${h.secondWindUsed?'spent · recharges at shrines/floors':'ready'})` });
  if(cls.healer)
    icons.push({ ico:'✚', count:h.healSlots ?? h.healSlotsMax ?? 0,
      tip:'Cure Wounds — heal slots (refresh at shrines/floors)' });
  const sc = subclassOf(h);
  if(sc){
    const a = sc.active;
    if(a.recharge==='slot')
      icons.push({ ico:ABILITY_ICON[a.key]||'★', count:h.slots ?? 0,
        tip:`${a.name} — spell slots (refresh at shrines/floors)` });
    else {
      const spent = a.recharge==='day' ? h.abilityUsed?.day : h.abilityUsed?.short;
      icons.push({ ico:ABILITY_ICON[a.key]||'★', ready:!spent,
        tip:`${a.name} — ${a.recharge==='day'?'1/day (recharges next floor)':'1/short rest (recharges after combat)'} — ${spent?'spent':'ready'}` });
    }
  }
  return icons.map(ic=>{
    const state = ic.count!==undefined ? (ic.count>0?'ready':'spent') : (ic.ready?'ready':'spent');
    return `<span class="pf-abil ${state}" title="${ic.tip}">${ic.ico}${ic.count!==undefined?`<b>${ic.count}</b>`:''}</span>`;
  }).join('');
}

export function buildPartyFrames(heroes){
  const wrap = $('partyframes');
  wrap.innerHTML = '';
  heroes.forEach((h,i)=>{
    const cls = CLASSES[h.classKey];
    const f = document.createElement('div');
    f.className = 'pframe';
    f.id = 'pframe'+i;
    f.innerHTML = `
      <div class="pf-top">
        <span class="pf-dot" style="background:#${cls.color.toString(16).padStart(6,'0')}"></span>
        <span class="pf-name">${h.name}</span>
        <span class="pf-lvl">Lv <b id="pf${i}-lvl">${h.level}</b></span>
      </div>
      <div class="pf-sub" id="pf${i}-sub">${RACES[h.raceKey].label} ${cls.label} — AC ${h.ac}</div>
      <div class="pf-hpbar"><div class="pf-hpfill" id="pf${i}-hp"></div><span class="pf-hptext" id="pf${i}-hpt"></span></div>
      <div class="pf-abils" id="pf${i}-ab"></div>
      <div class="pf-xpbar"><div class="pf-xpfill" id="pf${i}-xp"></div></div>`;
    wrap.appendChild(f);
  });
  updatePartyFrames(heroes);
}
export function updatePartyFrames(heroes){
  heroes.forEach((h,i)=>{
    const hpEl = $('pf'+i+'-hp');
    if(!hpEl) return;
    const frac = Math.max(0, h.hp/h.maxHp);
    hpEl.style.width = (frac*100)+'%';
    hpEl.style.background = h.hp<=0 ? '#555' : (frac>0.5 ? '#4ade4a' : frac>0.25 ? '#e8b23f' : '#e0483a');
    $('pf'+i+'-hpt').textContent = h.hp<=0 ? 'DOWN' : `${h.hp}/${h.maxHp}`;
    $('pf'+i+'-lvl').textContent = h.level;
    const sub = subclassOf(h);
    $('pf'+i+'-sub').textContent =
      `${RACES[h.raceKey].label} ${sub?sub.label:CLASSES[h.classKey].label} — AC ${h.ac}`;
    $('pf'+i+'-ab').innerHTML = abilityIconsHTML(h);
    const lo = XP_TABLE[h.level], hi = XP_TABLE[Math.min(h.level+1, MAX_LEVEL)];
    $('pf'+i+'-xp').style.width = (h.level>=MAX_LEVEL ? 100 : 100*(h.xp-lo)/Math.max(1,hi-lo))+'%';
    const frame = $('pframe'+i);
    frame.classList.toggle('down', h.hp<=0);
  });
}

/* ---------------- resources (gold, potions) ---------------- */
export function updateResources(state){
  $('goldval').textContent = state.gold;
  $('potheal-n').textContent = state.potions.heal;
  $('potgreater-n').textContent = state.potions.greater;
  $('potheal').classList.toggle('empty', state.potions.heal<=0);
  $('potgreater').classList.toggle('empty', state.potions.greater<=0);
  if (state.activeQuest) {
    $('floorval').textContent = `${state.questFloor || 1}/${state.activeQuest.floors} · d${state.dungeonLevel}`;
  } else {
    $('floorval').textContent = state.dungeonLevel;
  }
}

export function showBanner(text, sub=''){
  const b = $('banner');
  b.innerHTML = `<div class="banner-main">${text}</div>${sub?`<div class="banner-sub">${sub}</div>`:''}`;
  b.classList.add('show');
  setTimeout(()=>b.classList.remove('show'), 3400);
}

/* ---------------- party setup screen ---------------- */
const DEFAULT_BUILDS = [
  { classKey:'fighter', raceKey:'halforc' },
  { classKey:'rogue',   raceKey:'halfling' },
  { classKey:'cleric',  raceKey:'dwarf' },
  { classKey:'wizard',  raceKey:'elf' }
];

export function showSetup(hasSave, onEmbark, onContinue){
  const ov = $('setup');
  ov.classList.add('show');
  const slots = [];
  const usedNames = new Set();
  const pickName = ()=>{
    let n; let guard=0;
    do { n = HERO_NAMES[Math.floor(Math.random()*HERO_NAMES.length)]; } while(usedNames.has(n) && guard++<30);
    usedNames.add(n); return n;
  };

  const VISUAL_OPTS = {
    gender: ['male', 'female'],
    skinColor: ['#ffddcc', '#f1c27d', '#e0ac69', '#8d5524', '#c68642', '#3e2723', '#7cb342', '#bb4444', '#aabbaa', '#dd5566', '#ffeeee'],
    hair: ['none', 'bangs/adult', 'braid/adult', 'long/adult', 'page/adult', 'messy1/adult', 'pixie/adult', 'bob/adult', 'curly_long/adult', 'dreadlocks_long/adult', 'ponytail/adult', 'spiked/adult', 'loose/adult', 'swoop/adult', 'parted/adult', 'mop/adult'],
    facialHair: ['none', 'beard/basic', 'beard/medium', 'beard/5oclock_shadow', 'mustache/basic'],
    hairColor: ['#000000', '#663311', '#ddbb55', '#cc4422', '#eeeeee', '#66aacc', '#cc66aa'],
    eyeColor: ['#000000', '#4477ff', '#228822', '#884422', '#aa2222', '#ffffff']
  };

  /* non-human head sprites baked into LPC (value = folder path, '' = human).
     A custom head replaces the human face/eyes/ears/hair/beard entirely. */
  const HEAD_OPTS = [
    ['', 'Human'],
    ['lizard/male', 'Draconic'],
    ['orc/male', 'Orcish'],
    ['goblin/adult', 'Goblin'],
    ['minotaur/male', 'Minotaur'],
    ['wolf/male', 'Wolfkin'],
    ['troll/adult', 'Troll'],
    ['rat/adult', 'Ratfolk'],
    ['alien/adult', 'Alien'],
    ['frankenstein/adult', 'Flesh Golem']
  ];

  /* Per-race defaults. `head` assigns a distinctive LPC head where one fits
     the race (dragonborn→lizard, half-orc→orc); the rest read as human and
     differentiate via ears / beard / skin. (LPC in this checkout has no
     horns/tails/wings assets, so tieflings rely on red skin + pointed ears.) */
  const getRaceDefaults = (raceKey) => {
    switch(raceKey) {
      case 'halforc': return { head: 'orc/male', skinColor: '#8fae7a', hairColor: '#111111', ears: 'none', facialHair: 'none', eyeColor: '#5a1010' };
      case 'elf': return { head: '', skinColor: '#ffeeee', hairColor: '#eedd77', ears: 'elven', facialHair: 'none', eyeColor: '#203a3a' };
      case 'dwarf': return { head: '', skinColor: '#ffddbb', hairColor: '#bbaa55', ears: 'none', facialHair: 'beard/medium', eyeColor: '#3a2010' };
      case 'halfling': return { head: '', skinColor: '#eeddbb', hairColor: '#664422', ears: 'none', facialHair: 'none', eyeColor: '#3a2010' };
      case 'dragonborn': return { head: 'lizard/male', skinColor: '#7fa25a', hairColor: '#000000', ears: 'none', facialHair: 'none', eyeColor: '#ffcc00' };
      case 'gnome': return { head: '', skinColor: '#eeddbb', hairColor: '#a3e635', ears: 'elven', facialHair: 'none', eyeColor: '#3a2010' };
      case 'halfelf': return { head: '', skinColor: '#ffeeee', hairColor: '#eedd77', ears: 'elven', facialHair: 'none', eyeColor: '#203a3a' };
      case 'tiefling': return { head: '', skinColor: '#dd5566', hairColor: '#111111', ears: 'elven', facialHair: 'none', eyeColor: '#ffcc00' };
      default: return { head: '', skinColor: '#ffddcc', hairColor: '#663311', ears: 'none', facialHair: 'none', eyeColor: '#000000' };
    }
  };

  /* Skin swatches are race-dependent: the body (and beast heads) are recoloured
     by a multiply tint, so each race only offers colours that read correctly
     over its base art (tinting a green orc/lizard head with pink just muddies
     it). Each palette's FIRST entry is that race's default skin. */
  const SKIN_PALETTES = {
    human:    ['#ffeeee','#ffddcc','#ffddbb','#eeddbb','#f1c27d','#e0ac69','#c68642','#8d5524','#5a3a20','#3e2723'],
    orc:      ['#8fae7a','#7a9a5a','#6a8a4a','#9ab98a','#57794a','#8a9a8a','#67787a','#4a5a3a'],
    draconic: ['#7fa25a','#5f8a45','#4a7040','#b0824a','#9a6a3a','#7a8a9a','#4a5a6a','#3a3a3a','#b0a850'],
    tiefling: ['#dd5566','#c0455a','#a03a4a','#8a3550','#dd7788','#b05070','#7a3a5a','#5a2a3a']
  };
  const RACE_SKIN = { halforc:'orc', dragonborn:'draconic', tiefling:'tiefling' };
  const skinColorsFor = raceKey => SKIN_PALETTES[RACE_SKIN[raceKey] || 'human'];

  DEFAULT_BUILDS.forEach((def,i)=>{
    const raceDefs = getRaceDefaults(def.raceKey);
    slots.push({ 
      name:pickName(), raceKey:def.raceKey, classKey:def.classKey,
      baseStats: { str:8, dex:8, con:8, int:8, wis:8, cha:8 }, // Point buy default
      proficiencies: getDefaultProficiencies(def.raceKey, def.classKey),
      visual: {
        gender: Math.random()>0.5 ? 'male' : 'female',
        head: raceDefs.head || '',
        skinColor: raceDefs.skinColor,
        hair: VISUAL_OPTS.hair[1 + Math.floor(Math.random()*(VISUAL_OPTS.hair.length-1))], // avoid none
        facialHair: raceDefs.facialHair,
        hairColor: raceDefs.hairColor,
        eyeColor: raceDefs.eyeColor,
        ears: raceDefs.ears
      }
    });
  });

  const slotWrap = $('setup-slots');
  let currentSlotIdx = 0;

  const ASSETS_ROOT = './lpc/';
  const imageCache = {};
  
  function loadImage(src) {
    if (imageCache[src]) return Promise.resolve(imageCache[src]);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { imageCache[src] = img; resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }

  function drawTintedLayer(ctx, img, tintColor) {
    if (!tintColor) {
      ctx.drawImage(img, 0, 128, 64, 64, 0, 0, 64, 64);
      return;
    }
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 64; tempCanvas.height = 64;
    const tctx = tempCanvas.getContext('2d');
    
    // Draw only the specific frame we want to tint (walk, front, row 2)
    tctx.drawImage(img, 0, 128, 64, 64, 0, 0, 64, 64);
    tctx.globalCompositeOperation = 'multiply';
    tctx.fillStyle = tintColor;
    tctx.fillRect(0, 0, 64, 64);
    
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(img, 0, 128, 64, 64, 0, 0, 64, 64);
    
    ctx.drawImage(tempCanvas, 0, 0);
  }

  async function drawPreview(canvas, slot) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const visual = slot.visual;
    const g = visual.gender;
    const isMonster = (g === 'skeleton' || g === 'zombie');
    const customHead = visual.head;                 // '' / undefined = human

    let w = null;
    let t = 'clothes/shortsleeve/shortsleeve'; // default
    let l = 'pants'; // default

    if (slot.classKey === 'fighter') { w = 'sword/longsword'; t = 'chainmail'; }
    else if (slot.classKey === 'rogue') { w = 'sword/dagger'; t = 'armour/leather'; }
    else if (slot.classKey === 'cleric') { w = 'blunt/mace'; t = 'chainmail'; }
    else if (slot.classKey === 'wizard') { w = 'sword/dagger'; t = 'clothes/longsleeve/longsleeve'; }

    const paths = {
      body: `body/bodies/${g}`,
      head: customHead ? `head/heads/${customHead}` : (isMonster ? null : `head/heads/human/${g}`),
      eyes: (isMonster || customHead) ? null : `eyes/human/adult`,
      ears: (!isMonster && !customHead && visual.ears === 'elven') ? `head/ears/elven/adult` : null,
      legs: isMonster ? null : `legs/${l}/${l === 'armour/plate' ? 'male' : g}`,
      torso: isMonster ? null : `torso/${t}/${g}`,
      feet: isMonster ? null : `feet/${l === 'armour/plate' ? 'armour/plate' : 'shoes/basic'}/${g==='male'?'male':'thin'}`,
      facialHair: (isMonster || customHead || !visual.facialHair || visual.facialHair === 'none') ? null : `beards/${visual.facialHair}`,
      hair: (isMonster || customHead || visual.hair==='none') ? null : `hair/${visual.hair}`,
      weapon: w ? `weapon/${w}` : null
    };
    
    const LAYER_ORDER = ['body', 'head', 'eyes', 'legs', 'torso', 'feet', 'ears', 'facialHair', 'hair', 'weapon'];
    
    for (const layer of LAYER_ORDER) {
      if (!paths[layer]) continue;
      try {
        const img = await loadImage(ASSETS_ROOT + paths[layer] + '/walk.png');
        if (layer === 'body' || layer === 'head' || layer === 'ears') {
          drawTintedLayer(ctx, img, visual.skinColor);
        } else if (layer === 'hair' || layer === 'facialHair') {
          drawTintedLayer(ctx, img, visual.hairColor);
        } else if (layer === 'eyes' && visual.eyeColor) {
          drawTintedLayer(ctx, img, visual.eyeColor);
        } else {
          ctx.drawImage(img, 0, 128, 64, 64, 0, 0, 64, 64);
        }
      } catch (e) {
        // ignore missing layers
      }
    }
  }

  /* left-side party roster: every hero with a live sprite + basic info,
     click to edit. Kept in sync whenever a hero changes. */
  function renderRoster(){
    const rosterWrap = $('setup-roster');
    if(!rosterWrap) return;
    rosterWrap.innerHTML = `<div class="roster-title">Your Party</div>` + slots.map((s,i)=>{
      const c = CLASSES[s.classKey], r = RACES[s.raceKey];
      const stats = ABILITIES.map(ab=>{
        const total = (s.baseStats[ab]||8) + (r.bonus[ab]||0);
        return `<span class="rstat"><em>${ABILITY_LABEL[ab]}</em><b>${total}</b></span>`;
      }).join('');
      return `<button type="button" class="roster-hero ${i===currentSlotIdx?'on':''}" data-i="${i}">
        <canvas class="roster-sprite" width="64" height="64"></canvas>
        <span class="roster-meta">
          <b id="roster-name-${i}">${s.name}</b>
          <i class="roster-race">${r.label}</i>
          <i class="roster-class">${c.label}</i>
          <span class="roster-stats">${stats}</span>
        </span>
      </button>`;
    }).join('');
    rosterWrap.querySelectorAll('.roster-hero').forEach(btn=>{
      const i = +btn.dataset.i;
      btn.addEventListener('click', ()=>{ currentSlotIdx = i; renderSlot(); });
      drawPreview(btn.querySelector('.roster-sprite'), slots[i]);
    });
  }

  function renderSlot() {
    const slot = slots[currentSlotIdx];
    const cls = CLASSES[slot.classKey], race = RACES[slot.raceKey];
    
    const colorSwatches = (key, current, listOverride) => {
      return `<div style="display:flex; gap:4px; flex-wrap:wrap;">` +
        (listOverride || VISUAL_OPTS[key]).map(c =>
          `<div class="swatch ${key}" data-val="${c}" style="width:16px; height:16px; border-radius:50%; background-color:${c}; border: 2px solid ${c===current ? '#fff' : '#444'}; cursor:pointer;"></div>`
        ).join('') + 
        `</div>`;
    };

    slotWrap.innerHTML = `
      <div class="editor-title">Editing <b>${slot.name}</b> — Hero ${currentSlotIdx + 1} of ${slots.length}</div>
      <div class="slot" style="margin: 0; padding: 16px;">
        <div class="slot-header" style="display:flex;gap:16px;align-items:center;">
          <canvas class="slot-preview" width="64" height="64" style="background:#1a1c23;border-radius:4px;image-rendering:pixelated;width:128px;height:128px;flex-shrink:0;"></canvas>
          <div style="flex:1; display:flex; flex-direction:column; gap:8px;">
            <input class="slot-name" value="${slot.name}" maxlength="12" style="font-size:18px; padding:6px; background:#111; color:#fff; border:1px solid #444;">
            <div style="display:flex;gap:6px">
              <select class="slot-class" style="flex:1; padding:4px;">${Object.entries(CLASSES).map(([k,c])=>`<option value="${k}" ${k===slot.classKey?'selected':''}>${c.label}</option>`).join('')}</select>
              <select class="slot-race" style="flex:1; padding:4px;">${Object.entries(RACES).map(([k,r])=>`<option value="${k}" ${k===slot.raceKey?'selected':''}>${r.label}</option>`).join('')}</select>
            </div>
          </div>
        </div>
        
        <div class="slot-visuals" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0;font-size:14px;">
          <label style="display:flex; justify-content:space-between; align-items:center;">Head: <select class="vis-head" style="width:110px; padding:2px;">${HEAD_OPTS.map(([v,l])=>`<option value="${v}" ${v===(slot.visual.head||'')?'selected':''}>${l}</option>`).join('')}</select></label>
          <label style="display:flex; justify-content:space-between; align-items:center;">Gender: <select class="vis-gender" style="width:110px; padding:2px;">${VISUAL_OPTS.gender.map(v=>`<option value="${v}" ${v===slot.visual.gender?'selected':''}>${v}</option>`).join('')}</select></label>
          <label style="display:flex; justify-content:space-between; align-items:center;">Ears: <select class="vis-ears" style="width:110px; padding:2px;"><option value="none" ${slot.visual.ears==='none'?'selected':''}>Human</option><option value="elven" ${slot.visual.ears==='elven'?'selected':''}>Elven</option></select></label>
          <label style="display:flex; justify-content:space-between; align-items:center;">Hair: <select class="vis-hair" style="width:110px; padding:2px;">${VISUAL_OPTS.hair.map(v=>`<option value="${v}" ${v===slot.visual.hair?'selected':''}>${v.split('/')[0]}</option>`).join('')}</select></label>
          <label style="display:flex; justify-content:space-between; align-items:center;">Facial Hair: <select class="vis-facialHair" style="width:110px; padding:2px;">${VISUAL_OPTS.facialHair.map(v=>`<option value="${v}" ${v===slot.visual.facialHair?'selected':''}>${v.split('/').pop()}</option>`).join('')}</select></label>
          <div style="display:flex; justify-content:space-between; align-items:center;"><span>Skin:</span> ${colorSwatches('skinColor', slot.visual.skinColor, skinColorsFor(slot.raceKey))}</div>
          <div style="display:flex; justify-content:space-between; align-items:center;"><span>Hair:</span> ${colorSwatches('hairColor', slot.visual.hairColor)}</div>
          <div style="display:flex; justify-content:space-between; align-items:center; grid-column: 1 / -1;">
            <div style="display:flex; justify-content:space-between; align-items:center; width:calc(50% - 6px);"><span>Eyes:</span> ${colorSwatches('eyeColor', slot.visual.eyeColor)}</div>
            <button id="btn-random-hair" style="padding:4px 8px; cursor:pointer;">🎲 Randomize Hair</button>
          </div>
        </div>
        
        <div class="slot-stats" id="active-stats" style="margin-bottom: 8px; display:flex; flex-direction:column; gap:4px; padding:8px; background:#181818; border-radius:4px;"></div>
        <div style="display:flex; gap:8px; margin-bottom: 12px;">
          <button id="btn-recommend-stats" style="flex:1; padding:4px; cursor:pointer;">Recommend</button>
          <button id="btn-random-stats" style="flex:1; padding:4px; cursor:pointer;">🎲 Randomize</button>
        </div>

        <div id="setup-skills-section" style="margin-bottom: 12px; padding: 10px; background: #181818; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);"></div>

        <div class="slot-traits" id="active-traits" style="margin-top:12px; font-size:13px; color:#aaa; line-height:1.4;"></div>
      </div>
    `;

    const canvas = slotWrap.querySelector('.slot-preview');
    
    const getCost = (val) => {
      if(val<=13) return val-8;
      if(val===14) return 7;
      if(val===15) return 9;
      return 0;
    };
    
    const updateStats = ()=>{
      let totalCost = 0;
      ABILITIES.forEach(ab => totalCost += getCost(slot.baseStats[ab]));
      let ptsLeft = 27 - totalCost;
      
      let statsHtml = `<div style="display:flex; justify-content:space-between; margin-bottom:8px; font-weight:bold;"><span>Point Buy (Max 15)</span><span>Points: <span style="color:${ptsLeft===0?'#4ade4a':(ptsLeft<0?'#e0483a':'#fff')}">${ptsLeft}</span>/27</span></div>`;
      
      ABILITIES.forEach(ab=>{
        const isKey = ab===cls.statPriority[0];
        const base = slot.baseStats[ab];
        const rac = race.bonus[ab] || 0;
        const total = base + rac;
        statsHtml += `
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px;">
            <span style="width:40px; ${isKey?'color:#e8b23f; font-weight:bold;':''}">${ABILITY_LABEL[ab]}</span>
            <div>
              <button class="pb-btn pb-sub" data-ab="${ab}" style="padding:0 6px; cursor:pointer;" ${base<=8?'disabled':''}>-</button>
              <span style="display:inline-block; width:20px; text-align:center;">${base}</span>
              <button class="pb-btn pb-add" data-ab="${ab}" style="padding:0 6px; cursor:pointer;" ${base>=15?'disabled':''}>+</button>
            </div>
            <span style="width:40px; text-align:right; color:#888;">${rac>0?'+'+rac:''}</span>
            <span style="width:40px; text-align:right; font-weight:bold;">${total}</span>
            <span style="width:30px; text-align:right; color:#ccc;"><i>${fmtMod(mod(total))}</i></span>
          </div>
        `;
      });
      $('active-stats').innerHTML = statsHtml;
      
      // Bind point buy buttons
      slotWrap.querySelectorAll('.pb-btn').forEach(btn => {
        btn.onclick = (e) => {
          const ab = e.target.dataset.ab;
          if (e.target.classList.contains('pb-add') && slot.baseStats[ab] < 15) {
            slot.baseStats[ab]++;
          } else if (e.target.classList.contains('pb-sub') && slot.baseStats[ab] > 8) {
            slot.baseStats[ab]--;
          }
          updateStats();
        };
      });

      $('btn-recommend-stats').onclick = () => {
        const standardArray = [15, 14, 13, 12, 10, 8];
        cls.statPriority.forEach((ab, i) => {
          slot.baseStats[ab] = standardArray[i];
        });
        updateStats();
      };

      $('btn-random-stats').onclick = () => {
        const stats = {str:8, dex:8, con:8, int:8, wis:8, cha:8};
        let pts = 27;
        const costDiff = (val) => val >= 13 ? 2 : 1;
        while(pts > 0) {
          const ab = ABILITIES[Math.floor(Math.random()*ABILITIES.length)];
          const diff = costDiff(stats[ab]);
          if (stats[ab] < 15 && pts >= diff) {
            stats[ab]++;
            pts -= diff;
          }
        }
        slot.baseStats = stats;
        updateStats();
      };
      
      $('btn-random-hair').onclick = () => {
        slot.visual.hair = VISUAL_OPTS.hair[Math.floor(Math.random()*VISUAL_OPTS.hair.length)];
        slot.visual.facialHair = VISUAL_OPTS.facialHair[Math.floor(Math.random()*VISUAL_OPTS.facialHair.length)];
        slot.visual.hairColor = VISUAL_OPTS.hairColor[Math.floor(Math.random()*VISUAL_OPTS.hairColor.length)];
        renderSlot();
      };

      $('active-traits').innerHTML =
        `<div>⚔ ${cls.attack.name} — ${cls.acDesc}</div><div style="margin-top:4px;">✨ ${cls.feature}</div><div style="margin-top:4px;">🧬 ${race.trait}</div>`;

      /* keep the active roster card's stat readout live as points are spent */
      const rs = document.querySelector('.roster-hero.on .roster-stats');
      if(rs){
        rs.innerHTML = ABILITIES.map(ab=>{
          const total = (slot.baseStats[ab]||8) + (race.bonus[ab]||0);
          return `<span class="rstat"><em>${ABILITY_LABEL[ab]}</em><b>${total}</b></span>`;
        }).join('');
      }

      drawPreview(canvas, slot);
    };

    const renderSkills = () => {
      const activeSkillsSection = $('setup-skills-section');
      if (!activeSkillsSection) return;

      const classChoices = cls.skillChoices || { count: 2, list: [] };
      const racialSkills = race.skills || [];
      
      if (!slot.proficiencies) {
        slot.proficiencies = getDefaultProficiencies(slot.raceKey, slot.classKey);
      }

      // Count selected class skills (excluding those granted by race)
      const selectedClassSkills = slot.proficiencies.filter(p => classChoices.list.includes(p) && !racialSkills.includes(p));
      const slotsLeft = classChoices.count - selectedClassSkills.length;

      let skillsHtml = `
        <div class="setup-skill-head">
          <span>Choose Class Skills</span>
          <span class="setup-skill-count" style="color:${slotsLeft===0 ? '#4ade80' : (slotsLeft<0 ? '#e0483a' : '#888')}">
            Selected ${selectedClassSkills.length}/${classChoices.count}
          </span>
        </div>
        <div class="setup-skill-grid">
      `;

      classChoices.list.forEach(sKey => {
        const skill = SKILLS[sKey];
        const isRacial = racialSkills.includes(sKey);
        const isChecked = slot.proficiencies.includes(sKey);

        skillsHtml += `
          <label class="setup-skill-item ${isRacial ? 'racial' : ''}" title="${skill.label}${isRacial ? ' (Granted by Race)' : ''}">
            <input type="checkbox" class="setup-skill-cb" data-skill="${sKey}"
              ${isChecked ? 'checked' : ''} ${isRacial ? 'disabled' : ''} />
            <span>${skill.label}${isRacial ? ' <i class="race-tag">(Race)</i>' : ''}</span>
          </label>
        `;
      });

      skillsHtml += `</div>`;
      activeSkillsSection.innerHTML = skillsHtml;

      // Bind events to checkboxes
      activeSkillsSection.querySelectorAll('.setup-skill-cb').forEach(cb => {
        cb.onchange = (e) => {
          const sKey = e.target.dataset.skill;
          if (e.target.checked) {
            const currentSelected = slot.proficiencies.filter(p => classChoices.list.includes(p) && !racialSkills.includes(p));
            if (currentSelected.length < classChoices.count) {
              if (!slot.proficiencies.includes(sKey)) {
                slot.proficiencies.push(sKey);
              }
            } else {
              e.target.checked = false; // Block selecting more
            }
          } else {
            slot.proficiencies = slot.proficiencies.filter(p => p !== sKey);
          }
          renderSkills();
        };
      });
    };

    updateStats();
    renderSkills();
    renderRoster();

    slotWrap.querySelector('.slot-name').addEventListener('input', e=>{
      slot.name = e.target.value.trim() || slot.name;
      const rn = $('roster-name-'+currentSlotIdx); if(rn) rn.textContent = slot.name;
    });
    slotWrap.querySelector('.slot-class').addEventListener('change', e=>{ 
      slot.classKey = e.target.value; 
      slot.proficiencies = getDefaultProficiencies(slot.raceKey, slot.classKey);
      renderSlot(); 
    });
    slotWrap.querySelector('.slot-race').addEventListener('change', e=>{ 
      slot.raceKey = e.target.value; 
      slot.proficiencies = getDefaultProficiencies(slot.raceKey, slot.classKey);
      const raceDefs = getRaceDefaults(slot.raceKey);
      slot.visual.head = raceDefs.head || '';
      slot.visual.skinColor = raceDefs.skinColor;
      slot.visual.hairColor = raceDefs.hairColor;
      slot.visual.eyeColor = raceDefs.eyeColor;
      slot.visual.ears = raceDefs.ears;
      slot.visual.facialHair = raceDefs.facialHair;
      renderSlot();
    });

    /* visual selects re-render the whole slot so the roster sprite updates too */
    ['head', 'gender', 'hair', 'facialHair', 'ears'].forEach(key => {
      const el = slotWrap.querySelector('.vis-'+key);
      if(!el) return;
      el.addEventListener('change', e=>{
        slot.visual[key] = e.target.value;
        renderSlot();
      });
    });
    ['skinColor', 'hairColor', 'eyeColor'].forEach(key => {
      slotWrap.querySelectorAll('.swatch.'+key).forEach(sw => {
        sw.onclick = (e) => {
          slot.visual[key] = e.target.dataset.val;
          renderSlot(); // Re-render to update the selection highlight
        };
      });
    });
  }

  renderSlot();

  $('setup-continue').style.display = hasSave ? '' : 'none';
  $('setup-continue').onclick = ()=>{ ov.classList.remove('show'); onContinue(); };
  $('setup-embark').onclick = ()=>{ ov.classList.remove('show'); onEmbark(slots); };
}

