/**
 * Game HUD + party setup screen. All DOM, no three.js.
 */
import { RACES, CLASSES, ABILITIES, ABILITY_LABEL, rollStat, mod, fmtMod, XP_TABLE, MAX_LEVEL, HERO_NAMES,
         subclassOf, SKILLS, getDefaultProficiencies } from './srd.js';
import { SPELLS } from './spells.js';
import { totalSlots, hasSlotFor, slotBreakdown } from './features.js';

const $ = id => document.getElementById(id);

/* ---------------- combat log ---------------- */
const LOG_MAX = 90;
/* kinds that count as "combat" for the log filter tabs */
const COMBAT_KINDS = new Set(['roll','miss','kill','crit','heal','down','boss','elite']);
export function log(msg, kind=''){
  const box = $('gamelog');
  if(!box) return;
  const div = document.createElement('div');
  div.className = 'logline ' + kind + (COMBAT_KINDS.has(kind) ? ' is-combat' : '');
  div.textContent = msg;
  box.appendChild(div);
  while(box.children.length > LOG_MAX) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;

  const panel = $('logpanel');
  if (panel && panel.classList.contains('minimized')) {
    const trayBtn = $('log-tray-btn');
    if (trayBtn) trayBtn.classList.add('unread');
  }
}

/* ---------------- initiative turn tracker ---------------- */
export function updateInitiativeTracker(game){
  const el = $('initiative');
  if(!el) return;
  const init = game.initiative;
  const alive = e => e._side === 'hero' ? e.data.hp > 0 : (e.active && e.data.hp > 0);
  if(!init || !init.active || !init.order.length){
    el.classList.remove('show'); el.innerHTML = ''; return;
  }
  const cur = init.order[init.idx];
  const rows = init.order.filter(alive).map(e => {
    const on = e === cur ? ' on' : '';
    const side = e._side === 'hero' ? 'hero' : 'mon';
    const name = (e.data && e.data.name) || (e._side === 'hero' ? 'Hero' : 'Monster');
    const val = e._init != null ? e._init : '';
    return `<div class="init-row ${side}${on}">`
         + `<span class="init-pip"></span>`
         + `<span class="init-name">${name}</span>`
         + `<span class="init-val">${val}</span></div>`;
  }).join('');
  el.innerHTML = `<div class="init-round">⚔ Round ${init.round}</div>`
               + `<div class="init-list">${rows}</div>`;
  el.classList.add('show');
}

/* Wire the log filter tabs (All / Combat / Other). Called once at boot. */
export function initGameLog(){
  const box = $('gamelog');
  if(!box) return;
  box.classList.add('filter-all');
  const tabs = document.querySelectorAll('#logpanel .log-tab');
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(x => x.classList.remove('on'));
    t.classList.add('on');
    box.classList.remove('filter-all','filter-combat','filter-other');
    box.classList.add('filter-' + t.dataset.filter);
    box.scrollTop = box.scrollHeight;
  }));

  const panel = $('logpanel');
  const handle = $('log-resize-handle');
  const minBtn = $('log-min-btn');
  const trayBtn = $('log-tray-btn');

  // Resizing logic
  if(panel && handle){
    let isDragging = false;
    const startResize = e => {
      isDragging = true;
      e.preventDefault();
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
    };

    const resize = (clientX, clientY) => {
      const minW = 280;
      const maxW = window.innerWidth - 24;
      const minH = 100;
      const maxH = window.innerHeight - 80;

      let w = window.innerWidth - 12 - clientX;
      w = Math.max(minW, Math.min(maxW, w));
      panel.style.width = w + 'px';

      let h = window.innerHeight - 14 - clientY - 36;
      h = Math.max(minH, Math.min(maxH, h));
      box.style.maxHeight = h + 'px';
      box.style.height = h + 'px';
      box.scrollTop = box.scrollHeight;
    };

    const onMouseMove = e => { if(isDragging) resize(e.clientX, e.clientY); };
    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    const onTouchMove = e => {
      if(isDragging && e.touches.length > 0) {
        resize(e.touches[0].clientX, e.touches[0].clientY);
        e.preventDefault();
      }
    };
    const onTouchEnd = () => {
      isDragging = false;
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };

    handle.addEventListener('mousedown', startResize);
    handle.addEventListener('touchstart', startResize);
  }

  // Minimize logic
  if(minBtn && panel && trayBtn){
    minBtn.addEventListener('click', () => {
      panel.classList.add('minimized');
      trayBtn.style.display = 'block';
    });
    trayBtn.addEventListener('click', () => {
      panel.classList.remove('minimized');
      trayBtn.style.display = 'none';
      trayBtn.classList.remove('unread');
      // Scroll to bottom when restored to ensure latest messages are seen
      box.scrollTop = box.scrollHeight;
    });
  }
}

/* ---------------- party frames ---------------- */
const ABILITY_ICON = {
  actionSurge:'⚔', actionSurgeClass:'⚔', rallyingCry:'📣', cunningAction:'💨',
  cunningActionClass:'💨', deathstrike:'🗡', preserveLife:'✨', guidedStrike:'⚡',
  fireball:'🔥', magicMissile:'✴', frenzy:'🪓', bearTotem:'🐻', cuttingWords:'💬',
  combatInspiration:'🎵', entangle:'🌿', wildShape:'🐺', wildShapeClass:'🐺',
  quiveringPalm:'🫱', shadowStep:'👥', sacredWeapon:'✨', vowOfEnmity:'🎯',
  colossusSlayer:'🏹', companionStrike:'🐺', dragonBreath:'🐲', wildSurge:'🔮',
  fiendishBlessing:'😈', feyPresence:'🌸', flurryOfBlows:'👊', rage:'😡',
  divineSmite:'💫', tidesOfChaos:'🌀', bardicInspiration:'🎵', indomitable:'🛡',
  layOnHands:'🙏', shield:'🛡', scorchingRay:'🔥', haste:'⚡', bless:'✨',
  spiritualWeapon:'⚔', spiritGuardians:'👻', moonbeam:'🌙', callLightning:'⚡',
  healingWord:'💬', shatter:'💥', chaosBolt:'🌈', dragonBreathSpell:'🔥',
  hex:'🔮', armsOfHadar:'🦑', thunderousSmite:'⚡', huntersMark:'🎯',
  remarkableAthlete:'🏃', fastHands:'💨'
};

/* Class features that appear on the HUD with ready/spent state */
const REST_TIP = {
  short: { ready: 'ready · short rest (shrine / rest skill)', spent: 'spent · short rest to recover' },
  long:  { ready: 'ready · long rest (clear floor)', spent: 'spent · long rest to recover' }
};

const HUD_FEATURES = [
  { key:'secondWind', ico:'🌀', label:'Second Wind', recharge:'short',
    spent: h => !!h.secondWindUsed,
    has: h => !!(h.secondWind || (h.features && h.features.includes('secondWind'))) },
  { key:'actionSurgeClass', ico:'⚔', label:'Action Surge', recharge:'short',
    has: h => h.features && h.features.includes('actionSurgeClass') },
  { key:'flurryOfBlows', ico:'👊', label:'Flurry of Blows', recharge:'short',
    has: h => h.features && h.features.includes('flurryOfBlows') },
  { key:'cunningActionClass', ico:'💨', label:'Cunning Action', recharge:'short',
    has: h => h.features && h.features.includes('cunningActionClass') },
  { key:'rage', ico:'😡', label:'Rage', recharge:'long',
    spent: h => !!h.rageUsed,
    has: h => h.features && h.features.includes('rage') },
  { key:'divineSmite', ico:'💫', label:'Divine Smite', recharge:'short',
    spent: h => !!h.smiteUsed,
    has: h => h.features && h.features.includes('divineSmite') },
  { key:'tidesOfChaos', ico:'🌀', label:'Tides of Chaos', recharge:'short',
    spent: h => !!h.tidesUsed,
    has: h => h.features && h.features.includes('tidesOfChaos') },
  { key:'bardicInspiration', ico:'🎵', label:'Bardic Inspiration', recharge:'short',
    has: h => h.features && h.features.includes('bardicInspiration') },
  { key:'wildShapeClass', ico:'🐺', label:'Wild Shape', recharge:'short',
    has: h => h.features && h.features.includes('wildShapeClass') },
  { key:'indomitable', ico:'🛡', label:'Indomitable', recharge:'long',
    has: h => h.features && h.features.includes('indomitable') },
  { key:'channelDivinity', ico:'✝', label:'Channel Divinity', recharge:'short',
    has: h => h.features && h.features.includes('channelDivinity') }
];

/* one small icon per class/subclass ability, lit when ready / dim when spent;
   resource pools show a count badge instead */
function abilityIconsHTML(h){
  const cls = CLASSES[h.classKey];
  const icons = [];
  const seen = new Set();

  const pushReady = (key, ico, label, ready, tipExtra) => {
    if (seen.has(key)) return;
    seen.add(key);
    icons.push({
      ico, ready, tip: `${label} — ${tipExtra || (ready ? 'ready' : 'spent')}`
    });
  };
  const pushCount = (key, ico, label, count, tip) => {
    if (seen.has(key)) return;
    seen.add(key);
    icons.push({ ico, count, tip: tip || `${label} (${count})` });
  };

  /* Resource pools first — always visible when the hero has them */
  if (cls.healer || (h.healSlotsMax != null && h.healSlotsMax > 0)) {
    pushCount('healSlots', '✚', 'Cure Wounds', h.healSlots ?? h.healSlotsMax ?? 0,
      'Cure Wounds — heal slots (+1 short rest · full long rest)');
  }
  if (totalSlots(h.slotsMax) > 0) {
    const detail = slotBreakdown(h.slots, h.slotsMax);
    const slotTip = h.classKey === 'warlock'
      ? `Pact slots ${detail} (full on short or long rest)`
      : `Spell slots ${detail} (recover lowest on short rest · full on long rest)`;
    pushCount('spellSlots', '✦', 'Spell slots', totalSlots(h.slots), slotTip);
  }
  if (h.features && h.features.includes('layOnHands')) {
    pushCount('layOnHands', '🙏', 'Lay on Hands', h.layOnHands ?? h.layOnHandsMax ?? 0,
      `Lay on Hands — ${h.layOnHands ?? 0}/${h.layOnHandsMax ?? 0} (half short · full long)`);
  }

  /* Class combat features */
  for (const f of HUD_FEATURES) {
    if (!f.has(h)) continue;
    const bucket = f.recharge === 'long' ? 'long' : 'short';
    let spent;
    if (f.spent) spent = f.spent(h);
    else if (bucket === 'long') spent = !!h.abilityUsed?.long;
    else spent = !!h.abilityUsed?.short;
    const tips = REST_TIP[bucket];
    pushReady(f.key, f.ico, f.label, !spent, spent ? tips.spent : tips.ready);
  }

  /* Known spells (learned via progression) */
  for (const key of (h.knownSpells || [])) {
    const sp = SPELLS[key];
    if (!sp) continue;
    const ico = ABILITY_ICON[key] || '★';
    let ready = true;
    let tipExtra = sp.desc || '';
    if (sp.recharge === 'slot') {
      ready = hasSlotFor(h, sp.level || 1);
      tipExtra = `${sp.label} — costs a level-${sp.level || 1}+ spell slot (${ready ? 'ready' : 'no slots'})`;
    } else if (sp.recharge === 'short') {
      ready = !h.abilityUsed?.short;
      tipExtra = `${sp.label} — ${ready ? REST_TIP.short.ready : REST_TIP.short.spent}`;
    } else if (sp.recharge === 'long' || sp.recharge === 'day') {
      ready = !h.abilityUsed?.long;
      tipExtra = `${sp.label} — ${ready ? REST_TIP.long.ready : REST_TIP.long.spent}`;
    } else {
      tipExtra = `${sp.label} — ready`;
    }
    pushReady('spell:' + key, ico, sp.label, ready, tipExtra);
  }

  /* Subclass active (if not already covered by a feature/spell key) */
  const sc = subclassOf(h);
  if (sc) {
    const a = sc.active;
    /* Avoid duplicate icons when class feature + subclass share the same ability */
    const aliases = {
      actionSurge: 'actionSurgeClass',
      cunningAction: 'cunningActionClass',
      wildShape: 'wildShapeClass',
      colossusSlayer: 'colossusSlayerClass'
    };
    const alias = aliases[a.key];
    if (!seen.has(a.key) && !seen.has('spell:' + a.key) && !(alias && seen.has(alias))) {
      if (a.recharge === 'slot') {
        pushCount(a.key, ABILITY_ICON[a.key] || '★', a.name, totalSlots(h.slots),
          `${a.name} — spell slots (${slotBreakdown(h.slots, h.slotsMax)})`);
      } else {
        const bucket = (a.recharge === 'long' || a.recharge === 'day') ? 'long' : 'short';
        const spent = bucket === 'long' ? h.abilityUsed?.long : h.abilityUsed?.short;
        const tips = REST_TIP[bucket];
        pushReady(a.key, ABILITY_ICON[a.key] || '★', a.name, !spent,
          spent ? tips.spent : tips.ready);
      }
    }
  }

  return icons.map(ic => {
    const state = ic.count !== undefined ? (ic.count > 0 ? 'ready' : 'spent') : (ic.ready ? 'ready' : 'spent');
    const badge = ic.count !== undefined ? `<b>${ic.count}</b>` : '';
    return `<span class="pf-abil ${state}" title="${ic.tip.replace(/"/g, '&quot;')}">${ic.ico}${badge}</span>`;
  }).join('');
}

const CONDITION_ICONS = {
  raging: '😡',
  hasted: '⚡',
  inspired: '✨',
  shielded: '🛡️',
  sacredWeapon: '⚔️',
  bearTotem: '🐻',
  wildShape: '🐺',
  phaseStep: '👥',
  remarkableAthlete: '🏃',
  deathWarded: '👼',
  blinded: '👁️',
  charmed: '💜',
  frightened: '😱',
  poisoned: '🤢',
  paralyzed: '🌀',
  stunned: '💫',
  restrained: '🕸️',
  slowed: '⏳',
  burning: '🔥',
  prone: '🛌',
  deafened: '🔇',
  incapacitated: '✖️',
  unconscious: '💤',
  weakenedDmg: '🥀',
  baned: '📉',
  faerieFire: '🧚',
  hexMarked: '🔮',
  huntersMarked: '🎯'
};

const CONDITION_NAMES = {
  raging: 'Raging',
  hasted: 'Hasted',
  inspired: 'Inspired (Bardic Inspiration)',
  shielded: 'Shielded (Shield spell)',
  sacredWeapon: 'Sacred Weapon',
  bearTotem: 'Bear Totem Aspect',
  wildShape: 'Wild Shape',
  phaseStep: 'Phase Step',
  remarkableAthlete: 'Remarkable Athlete',
  deathWarded: 'Death Warded',
  blinded: 'Blinded',
  charmed: 'Charmed',
  frightened: 'Frightened',
  poisoned: 'Poisoned',
  paralyzed: 'Paralyzed',
  stunned: 'Stunned',
  restrained: 'Restrained',
  slowed: 'Slowed',
  burning: 'Burning',
  prone: 'Prone',
  deafened: 'Deafened',
  incapacitated: 'Incapacitated',
  unconscious: 'Unconscious',
  weakenedDmg: 'Weakened Damage',
  baned: 'Baned',
  faerieFire: 'Faerie Fire',
  hexMarked: 'Hex Marked',
  huntersMarked: "Hunter's Marked"
};

const CONDITION_COLORS = {
  raging: '#4ade4a', // green
  hasted: '#38bdf8', // cyan
  inspired: '#fbbf24', // gold
  shielded: '#38bdf8',
  sacredWeapon: '#fbbf24',
  bearTotem: '#4ade4a',
  wildShape: '#4ade4a',
  phaseStep: '#38bdf8',
  remarkableAthlete: '#4ade4a',
  deathWarded: '#fbbf24',
  blinded: '#e0483a', // red
  charmed: '#c084fc', // purple
  frightened: '#e0483a',
  poisoned: '#4ade4a',
  paralyzed: '#e8b23f', // yellow-orange
  stunned: '#e8b23f',
  restrained: '#e0483a',
  slowed: '#e0483a',
  burning: '#e0483a',
  prone: '#64748b', // gray
  deafened: '#64748b',
  incapacitated: '#e0483a',
  unconscious: '#64748b',
  weakenedDmg: '#e0483a',
  baned: '#e0483a',
  faerieFire: '#c084fc',
  hexMarked: '#c084fc',
  huntersMarked: '#e0483a'
};

function buildEffectsHTML(h) {
  if (!h._effects) return '';
  const elapsed = window.__elapsedTime || 0;
  const list = Object.entries(h._effects).sort((a, b) => a[0].localeCompare(b[0]));
  if (list.length === 0) return '';

  return list.map(([key, eff]) => {
    const ico = CONDITION_ICONS[key] || '⭐';
    const name = CONDITION_NAMES[key] || (key.charAt(0).toUpperCase() + key.slice(1));
    const color = CONDITION_COLORS[key] || '#fbbf24';

    let remainingText = '';
    let frac = 1.0;

    if (eff.until != null) {
      const remain = Math.max(0, eff.until - elapsed);
      remainingText = `${remain.toFixed(1)}s`;
      const dur = Math.max(1, eff.until - eff.applied);
      frac = Math.max(0, Math.min(1, remain / dur));
    } else {
      remainingText = 'Indefinite';
      frac = 1.0;
    }

    const strokeDashoffset = (62.8 * (1 - frac)).toFixed(2);

    return `
      <span class="pf-effect" title="${name} (${remainingText})">
        <span class="pf-effect-emoji">${ico}</span>
        <svg class="status-circle" width="24" height="24">
          <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.12)" stroke-width="1.8" fill="none" />
          <circle cx="12" cy="12" r="10" stroke="${color}" stroke-width="1.8" fill="none"
                  stroke-dasharray="62.8" stroke-dashoffset="${strokeDashoffset}"
                  transform="rotate(-90 12 12)" />
        </svg>
      </span>
    `;
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
      <div class="pf-effects" id="pf${i}-eff"></div>
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
    const effEl = $('pf'+i+'-eff');
    if (effEl) {
      effEl.innerHTML = buildEffectsHTML(h);
    }
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
  /* Race-specific fantasy name pools — first entry is each race's most
     common default, fallback to HERO_NAMES if no pool defined. */
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
  const usedNames = new Set();
  const pickName = (raceKey)=>{
    const pool = RACE_NAMES[raceKey] || HERO_NAMES;
    let n; let guard=0;
    do { n = pool[Math.floor(Math.random()*pool.length)]; } while(usedNames.has(n) && guard++<30);
    usedNames.add(n); return n;
  };

  const VISUAL_OPTS = {
    gender: ['male', 'female'],
    skinColor: ['#ffddcc', '#f1c27d', '#e0ac69', '#8d5524', '#c68642', '#3e2723', '#7cb342', '#bb4444', '#aabbaa', '#dd5566', '#ffeeee'],
    hair: ['none', 'bangs/adult', 'long/adult', 'page/adult', 'messy1/adult', 'pixie/adult', 'bob/adult', 'curly_long/adult', 'dreadlocks_long/adult', 'spiked/adult', 'loose/adult', 'swoop/adult', 'parted/adult', 'mop/adult'],
    facialHair: ['none', 'beard/basic', 'beard/medium', 'beard/5oclock_shadow', 'mustache/basic'],
    hairColor: ['#000000', '#111111', '#663311', '#8a4a20', '#ddbb55', '#e8c965', '#cc4422', '#ff6633', '#eeeeee', '#e0e0e0', '#66aacc', '#cc66aa', '#dda0dd'],
    eyeColor: ['#000000', '#4477ff', '#228822', '#884422', '#aa2222', '#ffffff']
  };

  /* Per-race defaults. `head` assigns a distinctive LPC head where one fits
     the race (dragonborn→lizard, half-orc→orc); the rest read as human and
     differentiate via ears / horns / beard / skin / sprite scaling. */
  const getRaceDefaults = (raceKey) => {
    switch(raceKey) {
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

  /* Skin swatches are race-dependent: the body (and beast heads) are recoloured
     by a multiply tint, so each race only offers colours that read correctly
     over its base art (tinting a green orc/lizard head with pink just muddies
     it). Each palette's FIRST entry is that race's default skin. */
  const SKIN_PALETTES = {
    human:    ['#ffeeee','#ffddcc','#ffddbb','#eeddbb','#f1c27d','#e0ac69','#c68642','#8d5524','#5a3a20','#3e2723'],
    orc:      ['#8fae7a','#7a9a5a','#6a8a4a','#9ab98a','#57794a','#8a9a8a','#67787a','#4a5a3a'],
    /* Dragonborn scale colours inspired by the chromatic and metallic
       dragons of the SRD. First colour is the default draconic green. */
    draconic: ['#7fa25a','#cc3333','#d4a017','#338833','#2a52be','#1a1a1a','#e8e8e8','#b0b0b0','#cd7f32','#b5a642','#b87333','#5f8a45','#4a7040','#b0824a','#7a8a9a','#4a5a6a'],
    /* Tiefling skin tones inspired by infernal bloodlines — deep crimsons,
       purples, blues, and ashen hues with a few pale/earthy options. */
    tiefling: ['#dd5566','#cc3355','#8833aa','#3344aa','#7a7a8a','#eebbcc','#6a1528','#996699','#553366','#223355','#c0455a','#a03a4a','#b05070']
  };
  const RACE_SKIN = { halforc:'orc', dragonborn:'draconic', tiefling:'tiefling' };
  const skinColorsFor = raceKey => SKIN_PALETTES[RACE_SKIN[raceKey] || 'human'];

  const slots = [];
  DEFAULT_BUILDS.forEach((def,i)=>{
    const raceDefs = getRaceDefaults(def.raceKey);
    slots.push({
      name:pickName(def.raceKey), raceKey:def.raceKey, classKey:def.classKey,
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
        ears: raceDefs.ears,
        horns: raceDefs.horns || 'none',
        spriteScaleX: raceDefs.spriteScaleX || 1.0,
        spriteScaleY: raceDefs.spriteScaleY || 1.0
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

  /* ---- HSL color utilities for proper sprite recolor ---- */
  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return [r, g, b];
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (mx === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
      Math.round(hue2rgb(p, q, h + 1/3) * 255),
      Math.round(hue2rgb(p, q, h) * 255),
      Math.round(hue2rgb(p, q, h - 1/3) * 255)
    ];
  }

  /* Recolour a sprite frame using HSL replacement: preserves the original
     shading (luminosity) but applies the tint's hue and saturation. Works on
     both neutral (grayscale) and pre-coloured sprites, unlike multiply which
     only looks good on grayscale bases. */
  function drawSkinTintedLayer(ctx, img, tintColor) {
    if (!tintColor) {
      ctx.drawImage(img, 0, 128, 64, 64, 0, 0, 64, 64);
      return;
    }
    const tc = document.createElement('canvas');
    tc.width = 64; tc.height = 64;
    const t = tc.getContext('2d');
    t.drawImage(img, 0, 128, 64, 64, 0, 0, 64, 64);
    const id = t.getImageData(0, 0, 64, 64);
    const d = id.data;
    const [tr, tg, tb] = hexToRgb(tintColor);
    const [th, ts] = rgbToHsl(tr, tg, tb);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const [, , l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      const [cr, cg, cb] = hslToRgb(th, ts, l);
      d[i] = cr; d[i+1] = cg; d[i+2] = cb;
    }
    t.putImageData(id, 0, 0);
    ctx.drawImage(tc, 0, 0);
  }

  async function drawPreview(canvas, slot) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const visual = slot.visual;
    const g = visual.gender;
    const isMonster = (g === 'skeleton' || g === 'zombie');
    const customHead = visual.head;                 // '' / undefined = human
    const clothG = (g === 'muscular' || g === 'teen' || g === 'child') ? 'male' : g;
    const sx = visual.spriteScaleX || 1.0;
    const sy = visual.spriteScaleY || 1.0;

    /* Apply race body scaling (dwarf = wider, halfling = smaller) anchored
       at bottom-centre so the sprite doesn't float above the ground. */
    if (sx !== 1.0 || sy !== 1.0) {
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height);
      ctx.scale(sx, sy);
      ctx.translate(-canvas.width / 2, -canvas.height);
    }

    let w = null;
    let t = 'clothes/shortsleeve/shortsleeve'; // default
    let l = 'pants'; // default

    if (slot.classKey === 'fighter') { w = 'sword/longsword'; t = 'chainmail'; }
    else if (slot.classKey === 'rogue') { w = 'sword/dagger'; t = 'armour/leather'; }
    else if (slot.classKey === 'cleric') { w = 'blunt/mace'; t = 'chainmail'; }
    else if (slot.classKey === 'wizard') { w = 'sword/dagger'; t = 'clothes/longsleeve/longsleeve'; }

    const paths = {
      body: `body/bodies/${g}`,
      head: customHead ? `head/heads/${customHead}` : (isMonster ? null : `head/heads/human/${clothG}`),
      eyes: (isMonster || customHead) ? null : `eyes/human/adult/default`,
      ears: (!isMonster && visual.ears && visual.ears !== 'none'
             && (!customHead || visual.ears === 'dragon')) ? `head/ears/${visual.ears}/adult` : null,
      horns: (!isMonster && visual.horns && visual.horns !== 'none') ? `head/horns/${visual.horns}` : null,
      legs: isMonster ? null : `legs/${l}/${l === 'armour/plate' ? 'male' : clothG}`,
      torso: isMonster ? null : `torso/${t}/${clothG}`,
      feet: isMonster ? null : `feet/${l === 'armour/plate' ? 'armour/plate' : 'shoes/basic'}/${clothG === 'male' ? 'male' : 'thin'}`,
      facialHair: (isMonster || customHead || !visual.facialHair || visual.facialHair === 'none') ? null : `beards/${visual.facialHair}`,
      hair: (isMonster || customHead || visual.hair==='none') ? null : `hair/${visual.hair}`,
      weapon: w ? `weapon/${w}` : null
    };

    const LAYER_ORDER = ['body', 'head', 'eyes', 'legs', 'torso', 'feet', 'ears', 'horns', 'facialHair', 'hair', 'weapon'];

    for (const layer of LAYER_ORDER) {
      if (!paths[layer]) continue;
      try {
        const img = await loadImage(ASSETS_ROOT + paths[layer] + '/walk.png');
        if (layer === 'body' || layer === 'head' || layer === 'ears' || layer === 'horns') {
          drawSkinTintedLayer(ctx, img, visual.skinColor);
        } else if (layer === 'hair' || layer === 'facialHair') {
          drawSkinTintedLayer(ctx, img, visual.hairColor);
        } else if (layer === 'eyes' && visual.eyeColor) {
          drawSkinTintedLayer(ctx, img, visual.eyeColor);
        } else {
          ctx.drawImage(img, 0, 128, 64, 64, 0, 0, 64, 64);
        }
      } catch (e) {
        // ignore missing layers
      }
    }

    if (sx !== 1.0 || sy !== 1.0) {
      ctx.restore();
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
            <div style="display:flex;gap:6px;align-items:center;">
              <input class="slot-name" value="${slot.name}" maxlength="12" style="flex:1; font-size:18px; padding:6px; background:#111; color:#fff; border:1px solid #444;">
              <button id="btn-random-name" style="padding:4px 8px; cursor:pointer; font-size:14px;" title="Randomize name">🎲</button>
            </div>
            <div style="display:flex;gap:6px">
              <select class="slot-class" style="flex:1; padding:4px;">${Object.entries(CLASSES).map(([k,c])=>`<option value="${k}" ${k===slot.classKey?'selected':''}>${c.label}</option>`).join('')}</select>
              <select class="slot-race" style="flex:1; padding:4px;">${Object.entries(RACES).map(([k,r])=>`<option value="${k}" ${k===slot.raceKey?'selected':''}>${r.label}</option>`).join('')}</select>
            </div>
          </div>
        </div>

        <div class="slot-visuals" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0;font-size:14px;">
          <label style="display:flex; justify-content:space-between; align-items:center;">Gender: <select class="vis-gender" style="width:110px; padding:2px;">${VISUAL_OPTS.gender.map(v=>`<option value="${v}" ${v===slot.visual.gender?'selected':''}>${v}</option>`).join('')}</select></label>
          <label style="display:flex; justify-content:space-between; align-items:center;">Ears: <select class="vis-ears" style="width:110px; padding:2px;"><option value="none" ${slot.visual.ears==='none'?'selected':''}>Human</option><option value="elven" ${slot.visual.ears==='elven'?'selected':''}>Elven</option><option value="dragon" ${slot.visual.ears==='dragon'?'selected':''}>Dragon</option></select></label>
          <label style="display:flex; justify-content:space-between; align-items:center;">Horns: <select class="vis-horns" style="width:110px; padding:2px;"><option value="none" ${(slot.visual.horns||'none')==='none'?'selected':''}>None</option><option value="backwards" ${slot.visual.horns==='backwards'?'selected':''}>Backwards</option><option value="curl" ${slot.visual.horns==='curl'?'selected':''}>Curl</option></select></label>
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
      slot.visual.horns = raceDefs.horns || 'none';
      slot.visual.facialHair = raceDefs.facialHair;
      slot.visual.spriteScaleX = raceDefs.spriteScaleX || 1.0;
      slot.visual.spriteScaleY = raceDefs.spriteScaleY || 1.0;
      renderSlot();
    });

    /* random name button */
    const rnBtn = $('btn-random-name');
    if (rnBtn) {
      rnBtn.onclick = () => {
        slot.name = pickName(slot.raceKey);
        const inp = slotWrap.querySelector('.slot-name');
        if (inp) inp.value = slot.name;
        const rn = $('roster-name-'+currentSlotIdx); if(rn) rn.textContent = slot.name;
        renderSlot();
      };
    }

    /* visual selects re-render the whole slot so the roster sprite updates too */
    ['gender', 'hair', 'facialHair', 'ears', 'horns'].forEach(key => {
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

