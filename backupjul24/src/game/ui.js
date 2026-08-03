/**
 * Game HUD + party setup screen. All DOM, no three.js.
 */
import { RACES, CLASSES, PLAYABLE_RACES, PLAYABLE_CLASSES,
         ABILITIES, ABILITY_LABEL, rollStat, mod, fmtMod, XP_TABLE, MAX_LEVEL, HERO_NAMES,
         subclassOf, SKILLS, getDefaultProficiencies, STARTER_GEAR } from './srd.js';
import { SPELLS } from './spells.js';
import { totalSlots, hasSlotFor, slotBreakdown, hasFeature } from './features.js';
import { getAvailableAttackOptions } from './combat.js';
import { ROUND_SECONDS } from './conditions.js';   // leaf module — no cycle
import { openOptions } from './options_ui.js';
import { HAIR_GROUPS, HAIR_EXTENSION_GROUPS, FACIAL_HAIR_GROUPS,
         HAIR_VALUES, HAIR_EXTENSION_VALUES, FACIAL_HAIR_VALUES,
         HAIR_COLORS, EYE_COLORS, SKIN_PALETTES, skinColorsFor,
         getRaceDefaults, labelFor, recolorPixels, isCharacterLayer,
         LAYER_ORDER, buildLayerPaths, layerTint } from './appearance.js';
import { makeStarterItem } from './items.js';

/* Headless-safe: unit tests and the balance sim import game modules (and so
   this one) in plain node, where there is no document. Every caller already
   handles a null element, so returning null is the whole fix. */
const $ = id => (typeof document === 'undefined' ? null : document.getElementById(id));

/* ---------------- combat log ---------------- */
const LOG_MAX = 90;
/* kinds that count as "combat" for the log filter tabs */
const COMBAT_KINDS = new Set(['roll','miss','kill','crit','heal','down','boss','elite','buff']);

let currentLoggedGame = null;

export function setLogGameInstance(game) {
  currentLoggedGame = game;
}

export function formatLogMessage(msg, gameOverride = null) {
  if (typeof msg !== 'string' || !msg.trim()) return msg || '';

  // If msg already contains HTML tags (e.g. <span), don't double escape
  const hasHtml = /<[a-z][\s\S]*>/i.test(msg);
  let safeText = hasHtml ? msg : msg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const g = gameOverride || currentLoggedGame || (typeof window !== 'undefined' ? window.__game : null);

  // Gather friendly names (heroes, companions)
  const friendlySet = new Set([
    'Valeros', 'Seelah', 'Kyra', 'Ezren', 'Merisiel', 'Harsk', 'Lem', 'Soni',
    'Theron', 'Gideon', 'Varis', 'Kaelen',
    'Alpha Wolf', 'Loyal Guard', 'Wolf Companion', 'Wolf', 'the party', 'The party'
  ]);
  if (g && g.heroes) {
    g.heroes.forEach(h => { if (h.data?.name) friendlySet.add(h.data.name); });
  }
  if (g && g.party) {
    g.party.forEach(h => { if (h.data?.name) friendlySet.add(h.data.name); });
  }

  // Gather enemy names (monsters)
  const enemySet = new Set([
    'Goblin', 'Goblin Boss', 'Goblin Archer', 'Skeleton', 'Skeleton Archer', 'Zombie', 'Zombie Brute',
    'Orc', 'Orc Warlord', 'Bugbear', 'Beholder', 'Gazer', 'Kobold', 'Red Dragon', 'Young Red Dragon',
    'Adult Red Dragon', 'Ancient Red Dragon', 'Lich', 'Mind Flayer', 'Ogre', 'Gelatinous Cube',
    'Mimic', 'Wraith', 'Vampire', 'Demon', 'Devil', 'Harpy', 'Minotaur', 'Shadow', 'Spectre',
    'Wight', 'Wight King', 'Cultist', 'Bandit', 'Gnoll', 'Troll', 'Spider', 'Giant Spider',
    'Rat', 'Giant Rat', 'Gargoyle', 'Golem', 'Basilisk', 'Manticore', 'Wyvern', 'Hellhound',
    'Hellion', 'Cacodemon', 'Mummy Lord', 'Shadow Dragon', 'Ettercap', 'Medusa', 'Fire Elemental',
    'Salamander', 'Magmin', 'Rust Monster', 'Ghoul', 'Cloud Giant', 'Green Hag'
  ]);
  if (g && g.monsters) {
    g.monsters.forEach(m => {
      if (m.data?.name) enemySet.add(m.data.name);
    });
  }

  // Remove overlap
  friendlySet.forEach(name => enemySet.delete(name));

  const friendlyNames = Array.from(friendlySet).sort((a, b) => b.length - a.length);
  const enemyNames = Array.from(enemySet).sort((a, b) => b.length - a.length);

  const abilities = [
    'Cure Wounds', 'Healing Word', 'Fireball', 'Magic Missile', 'Shield', 'Flurry of Blows',
    'Action Surge', 'Frenzy', 'Second Wind', 'Lay on Hands', 'Divine Smite', 'Smite',
    'Sneak Attack', 'Bardic Inspiration', 'Ray of Frost', 'Guiding Bolt', 'Sacred Flame',
    'Thunderwave', 'Hold Person', 'Haste', 'Counterspell', 'Bless', 'Bane', 'Wild Shape',
    'Death Burst', 'Kill Buff', 'Enrage', 'Breath Weapon', 'Multiattack', 'Miracle Salve'
  ].sort((a, b) => b.length - a.length);

  const statuses = [
    'poisoned', 'stunned', 'paralyzed', 'frightened', 'blinded', 'cowed',
    'inspired', 'rattled', 'blessed', 'restrained', 'weakened'
  ].sort((a, b) => b.length - a.length);

  const placeholders = [];
  function addPlaceholder(html) {
    const idx = placeholders.length;
    placeholders.push(html);
    return `___LOG_PH_${idx}___`;
  }

  // 1. Roll math & parentheses details
  safeText = safeText.replace(/\((d20[^)]+)\)/gi, (m, inner) => {
    return `(${addPlaceholder(`<span class="log-roll-detail">${inner}</span>`)})`;
  });
  safeText = safeText.replace(/\((saved for half|crit!|critical hit!)\)/gi, (m, inner) => {
    if (/crit/i.test(inner)) {
      return `(${addPlaceholder(`<span class="log-crit-tag">${inner}</span>`)})`;
    }
    return `(${addPlaceholder(`<span class="log-roll-detail">${inner}</span>`)})`;
  });
  safeText = safeText.replace(/\b(DC\s*\d+\s*(?:STR|DEX|CON|INT|WIS|CHA)?\s*save)\b/gi, (m) => {
    return addPlaceholder(`<span class="log-roll-detail">${m}</span>`);
  });

  // 2. Abilities & Spells
  abilities.forEach(ab => {
    const re = new RegExp(`\\b(${ab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'gi');
    safeText = safeText.replace(re, (m) => addPlaceholder(`<span class="log-ability">${m}</span>`));
  });

  // 3. Enemy names (Dark/Vivid Red)
  enemyNames.forEach(name => {
    const re = new RegExp(`\\b(${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'g');
    safeText = safeText.replace(re, (m) => addPlaceholder(`<span class="log-enemy">${m}</span>`));
  });

  // 4. Friendly names (Light Green)
  friendlyNames.forEach(name => {
    const re = new RegExp(`\\b(${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'g');
    safeText = safeText.replace(re, (m) => addPlaceholder(`<span class="log-friendly">${m}</span>`));
  });

  // 5. Healing values
  safeText = safeText.replace(/(\+\d+\s*(?:HP|hp)?)\b/g, (m) => {
    return addPlaceholder(`<span class="log-heal-val">${m}</span>`);
  });

  // 6. Damage values
  safeText = safeText.replace(/(\b\d+\s+(?:slashing|piercing|bludgeoning|fire|cold|lightning|acid|poison|radiant|necrotic|force|psychic)?\s*damage\b)/gi, (m) => {
    return addPlaceholder(`<span class="log-dmg">${m}</span>`);
  });
  safeText = safeText.replace(/(\bfor\s+\d+\b)/gi, (m) => {
    return addPlaceholder(`<span class="log-dmg">${m}</span>`);
  });

  // 7. Status conditions
  statuses.forEach(st => {
    const re = new RegExp(`\\b(${st})\\b`, 'gi');
    safeText = safeText.replace(re, (m) => addPlaceholder(`<span class="log-status">${m}</span>`));
  });

  // Restore placeholders
  for (let i = 0; i < placeholders.length; i++) {
    safeText = safeText.replace(`___LOG_PH_${i}___`, placeholders[i]);
  }

  return safeText;
}

export function updateLogPauseBtn(isPaused) {
  const btn = $('log-pause-btn');
  if (!btn) return;
  if (isPaused) {
    btn.classList.add('paused');
    btn.innerHTML = '▶️ Resume';
    btn.title = 'Resume game (Space)';
  } else {
    btn.classList.remove('paused');
    btn.innerHTML = '⏸️ Pause';
    btn.title = 'Pause game (Space)';
  }
}

/**
 * Verbosity category per log `kind`. The Options menu hides whole categories
 * with CSS (see settings.applyLogClasses), so a line only needs to carry the
 * right class — no filtering happens here, which is what lets a toggle apply
 * retroactively to lines already on screen.
 *
 * Kinds absent from this table are never suppressed: system messages, story
 * beats, and `down` (a hero dropping is not something to hide).
 */
const LOG_CATEGORY = {
  roll:  'lg-hitmiss',   // attack results (hits, save outcomes)
  miss:  'lg-hitmiss',
  crit:  'lg-hitmiss',
  heal:  'lg-heal',
  buff:  'lg-effect',    // buff / debuff application
  kill:  'lg-death',     // enemy deaths
  boss:  'lg-death',
  elite: 'lg-death',
};

/**
 * Append a line to the combat log.
 *
 *   kind        styling + verbosity category (see LOG_CATEGORY)
 *   opts.detail roll math ("14+7 vs AC 15") shown in parentheses only while
 *               the "roll details" setting is on. Pass it separately rather
 *               than baking it into `msg` so it can be hidden without losing
 *               the readable summary.
 *   opts.cat    override the category when `kind` doesn't describe the line
 *               (e.g. a buff logged with the 'heal' style).
 */
export function log(msg, kind='', opts={}){
  const box = $('gamelog');
  if(!box) return;
  const div = document.createElement('div');
  const cat = opts.cat ? `lg-${opts.cat}` : LOG_CATEGORY[kind];
  div.className = 'logline ' + kind + (COMBAT_KINDS.has(kind) ? ' is-combat' : '') +
    (cat ? ' ' + cat : '');
  div.innerHTML = formatLogMessage(msg);
  if (opts.detail) {
    const span = document.createElement('span');
    span.className = 'lg-detail';
    span.innerHTML = ' ' + formatLogMessage(String(opts.detail));
    div.appendChild(span);
  }

  // Scroll pinning check: only auto-scroll if user is currently near bottom
  const isAtBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 35;

  box.appendChild(div);
  while(box.children.length > LOG_MAX) box.removeChild(box.firstChild);

  if (isAtBottom) {
    box.scrollTop = box.scrollHeight;
  }

  const panel = $('logpanel');
  if (panel && panel.classList.contains('minimized')) {
    const trayBtn = $('log-tray-btn');
    if (trayBtn) trayBtn.classList.add('unread');
  }
}

/* Right-rail vertical stacking: floor badge → quest tracker → initiative.
   The quest tracker's height varies with objectives/phases, so anchor the
   initiative tracker just below whichever element above it is visible. */
export function layoutRightRail(){
  const init = $('initiative');
  if(!init || typeof init.getBoundingClientRect !== 'function') return; // headless / stubbed DOM
  const gap = 8;
  const badge = $('floorbadge');
  const qt = $('questtracker');
  let top = badge ? badge.getBoundingClientRect().bottom + gap : 52;
  if(qt && qt.style.display !== 'none'){
    top = qt.getBoundingClientRect().bottom + gap;
  }
  init.style.top = Math.round(top) + 'px';
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
  layoutRightRail();
  updateManualCombatBar(game);
}

/* Wire the log filter tabs (All / Combat / Other). Called once at boot. */
export function initGameLog(game = null){
  if (game) setLogGameInstance(game);
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

  const pauseBtn = $('log-pause-btn');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      const g = game || currentLoggedGame || (typeof window !== 'undefined' ? window.__game : null);
      if (g && typeof g.setPaused === 'function') {
        g.setPaused(!g.paused);
      }
    });
  }

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
  colossusSlayer:'🏹', summonCompanion:'🐺', dragonBreath:'🐲', wildSurge:'🔮',
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
          `${a.name} — ${a.desc} (${slotBreakdown(h.slots, h.slotsMax)})`);
      } else {
        const bucket = (a.recharge === 'long' || a.recharge === 'day') ? 'long' : 'short';
        const spent = bucket === 'long' ? h.abilityUsed?.long : h.abilityUsed?.short;
        const tips = REST_TIP[bucket];
        pushReady(a.key, ABILITY_ICON[a.key] || '★', a.name, !spent,
          `${a.name} — ${a.desc} · ${spent ? tips.spent : tips.ready}`);
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
  /* Countdowns run on the combat clock, so they read out in rounds — the unit
     the player actually plans around now that combat is turn-based. */
  const now = window.__effectClock || 0;
  const list = Object.entries(h._effects).sort((a, b) => a[0].localeCompare(b[0]));
  if (list.length === 0) return '';

  return list.map(([key, eff]) => {
    const ico = CONDITION_ICONS[key] || '⭐';
    const name = CONDITION_NAMES[key] || (key.charAt(0).toUpperCase() + key.slice(1));
    const color = CONDITION_COLORS[key] || '#fbbf24';

    let remainingText = '';
    let frac = 1.0;

    if (eff.until != null) {
      const remain = Math.max(0, eff.until - now);
      const rounds = Math.ceil(remain / ROUND_SECONDS);
      remainingText = `${rounds} round${rounds === 1 ? '' : 's'}`;
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

/* Party-frame leader selection: game binds a hook so frames can show the
   current leader and switch it on click without ui.js importing game. */
let _leaderHook = null;
export function bindPartyLeaderUI(hook){ _leaderHook = hook; }

/* Companion badge lookup — kept decoupled from the game instance the same way
   _leaderHook is. game.js binds a `for(heroData)` that returns a companion
   summary (icon/label/hp/maxHp/down) or null, so each owner's frame can show a
   small "minion" indicator instead of the companion getting its own frame. */
let _companionHook = null;
export function bindCompanionUI(hook){ _companionHook = hook; }

export function buildPartyFrames(heroes){
  const wrap = $('partyframes');
  wrap.innerHTML = '';
  heroes = heroes.filter(h => !h.companion);   // companions badge onto their owner
  heroes.forEach((h,i)=>{
    const cls = CLASSES[h.classKey];
    const f = document.createElement('div');
    f.className = 'pframe';
    f.id = 'pframe'+i;
    f.title = 'Click to make party leader';
    f.innerHTML = `
      <div class="pf-top">
        <span class="pf-dot" style="background:#${cls.color.toString(16).padStart(6,'0')}"></span>
        <span class="pf-name">${h.name}</span>
        <span class="pf-leader" title="Party leader">👑</span>
        <span class="pf-lvl">Lv <b id="pf${i}-lvl">${h.level}</b></span>
        <span class="pf-comp-slot" id="pf${i}-comp"></span>
      </div>
      <div class="pf-sub" id="pf${i}-sub">${RACES[h.raceKey].label} ${cls.label} — AC ${h.ac}</div>
      <div class="pf-hpbar"><div class="pf-hpfill" id="pf${i}-hp"></div><div class="pf-tempfill" id="pf${i}-tmp"></div><span class="pf-hptext" id="pf${i}-hpt"></span></div>
      <div class="pf-abils" id="pf${i}-ab"></div>
      <div class="pf-effects" id="pf${i}-eff"></div>
      <div class="pf-xpbar"><div class="pf-xpfill" id="pf${i}-xp"></div></div>`;
    f.addEventListener('click', (e)=>{
      if(e.target.closest && e.target.closest('.pf-abil,.pf-effect')) return;
      if(_leaderHook) _leaderHook.setLeader(i);
    });
    wrap.appendChild(f);
  });
  updatePartyFrames(heroes);
}
export function updatePartyFrames(heroes){
  heroes = heroes.filter(h => !h.companion);   // keep frame indices in sync with buildPartyFrames
  heroes.forEach((h,i)=>{
    const hpEl = $('pf'+i+'-hp');
    if(!hpEl) return;
    const frac = Math.max(0, h.hp/h.maxHp);
    hpEl.style.width = (frac*100)+'%';
    hpEl.style.background = h.hp<=0 ? '#4a4238'
      : (frac>0.5 ? 'linear-gradient(180deg,#72d160,#419e39 55%,#2f7d2b)'
      : frac>0.25 ? 'linear-gradient(180deg,#eec25a,#c08a2a 55%,#9c6a1c)'
      : 'linear-gradient(180deg,#e86a52,#c04434 55%,#992e22)');
    /* Temp HP: translucent blue band overlaid from the left, width = tempHp
       share of max HP (a shield sheen over the health), with the count in text. */
    const tmp = Math.max(0, h.tempHp || 0);
    const tmpEl = $('pf'+i+'-tmp');
    if (tmpEl) {
      const tmpFrac = h.hp>0 ? Math.min(1, tmp / h.maxHp) : 0;
      tmpEl.style.width = (tmpFrac*100)+'%';
      tmpEl.style.display = tmpFrac>0 ? 'block' : 'none';
    }
    $('pf'+i+'-hpt').textContent = h.hp<=0 ? 'DOWN'
      : (tmp>0 ? `${h.hp}/${h.maxHp} +${tmp}` : `${h.hp}/${h.maxHp}`);
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
    frame.classList.toggle('leader', !!_leaderHook && _leaderHook.getLeader() === i);

    /* Companion badge: a small circular icon (the companion's own sprite
       glyph) with an HP-coloured ring, shown inside the owner's frame. */
    const compEl = $('pf'+i+'-comp');
    if (compEl) {
      const c = _companionHook && _companionHook.for ? _companionHook.for(h) : null;
      if (c) {
        const frac = c.maxHp > 0 ? Math.max(0, c.hp / c.maxHp) : 0;
        const ring = c.down ? '#4a4238'
          : frac > 0.5 ? '#4ade4a'
          : frac > 0.25 ? '#eec25a' : '#e86a52';
        compEl.innerHTML =
          `<span class="pf-comp-icon${c.down ? ' down' : ''}" style="border-color:${ring}"` +
          ` title="${c.label} — ${c.down ? 'DOWN' : c.hp + '/' + c.maxHp}">${c.icon}</span>`;
      } else {
        compEl.innerHTML = '';
      }
    }
  });
}

/* ---------------- resources (gold, potions) ---------------- */
export function updateResources(state){
  if (!state) return;
  const gVal = $('goldval'); if (gVal) gVal.textContent = state.gold;
  const wmGold = $('wm-header-gold-val'); if (wmGold) wmGold.textContent = state.gold;
  const pH = $('potheal-n'); if (pH) pH.textContent = state.potions?.heal ?? 0;
  const pG = $('potgreater-n'); if (pG) pG.textContent = state.potions?.greater ?? 0;
  const pS = $('potsuperior-n'); if (pS) pS.textContent = state.potions?.superior ?? 0;
  const btnH = $('potheal'); if (btnH) btnH.classList.toggle('empty', (state.potions?.heal || 0) <= 0);
  const btnG = $('potgreater'); if (btnG) btnG.classList.toggle('empty', (state.potions?.greater || 0) <= 0);
  const btnS = $('potsuperior'); if (btnS) btnS.classList.toggle('empty', (state.potions?.superior || 0) <= 0);
  const fVal = $('floorval');
  if (fVal) {
    if (state.activeQuest) {
      fVal.textContent = `${state.questFloor || 1}/${state.activeQuest.floors} · d${state.dungeonLevel}`;
    } else {
      fVal.textContent = state.dungeonLevel;
    }
  }
}

export function showBanner(text, sub='', styleClass=''){
  const b = $('banner');
  if (!b) return;
  b.className = 'show' + (styleClass ? ' ' + styleClass : '');
  b.innerHTML = `<div class="banner-main">${text}</div>${sub?`<div class="banner-sub">${sub}</div>`:''}`;
  if (b._bannerTimer) clearTimeout(b._bannerTimer);
  b._bannerTimer = setTimeout(()=>{ b.className = ''; }, 3800);
}

/* ---------------- title screen / main menu ---------------- */

/**
 * Boot screen: the title card with New Game / Continue / Settings / Exit.
 * `onNew` hands off to the party setup screen, `onContinue` loads the save
 * (its button is disabled when there isn't one).
 */
export function showTitle(hasSave, { onNew, onContinue }){
  const ts = $('titlescreen');
  if(!ts) { onNew(); return; }
  ts.classList.add('show');
  document.body.classList.add('title-open');

  const close = ()=>{
    ts.classList.remove('show');
    document.body.classList.remove('title-open');
  };

  $('ts-new').onclick = ()=>{ close(); onNew(); };

  const contBtn = $('ts-continue');
  contBtn.disabled = !hasSave;
  contBtn.title = hasSave ? 'Resume your saved game' : 'No saved game found';
  contBtn.onclick = ()=>{ if(!hasSave) return; close(); onContinue(); };

  /* Settings opens the one shared Options panel — volume, combat log and
     automation all live there now (options_ui.js owns its own Escape/backdrop
     dismissal, so there is nothing to bind here). */
  $('ts-settings').onclick = openOptions;

  /* Exit: closes the Electron window. In a plain browser tab window.close()
     is a no-op unless we opened the tab, so fall back to a parting message. */
  $('ts-exit').onclick = ()=>{
    window.close();
    setTimeout(()=>{
      if(!document.hidden) ts.querySelector('.ts-note').textContent =
        'Close the tab or window when you are ready — your progress is saved.';
    }, 300);
  };
}

/* ---------------- party setup screen ---------------- */
const DEFAULT_BUILDS = [
  { classKey:'fighter', raceKey:'halforc' },
  { classKey:'rogue',   raceKey:'halfling' },
  { classKey:'cleric',  raceKey:'dwarf' },
  { classKey:'wizard',  raceKey:'elf' }
];

export function showSetup(onEmbark, onBack){
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
    skinColor: SKIN_PALETTES.human,
    hair: HAIR_VALUES,
    hairExtension: HAIR_EXTENSION_VALUES,
    facialHair: FACIAL_HAIR_VALUES,
    hairColor: HAIR_COLORS,
    hairExtColor: HAIR_COLORS,
    eyeColor: EYE_COLORS
  };
  const EARS_OPTS  = [['none','Human'], ['elven','Elven'], ['dragon','Dragon']];
  const HORNS_OPTS = [['none','None'], ['backwards','Backswept'], ['curl','Curled']];

  /* <optgroup>-backed picker for the big style catalogues. */
  const styleSelect = (cls, groups, current, noneLabel = 'None') => `
    <select class="${cls}">
      <option value="none" ${current === 'none' || !current ? 'selected' : ''}>${noneLabel}</option>
      ${groups.map(g => `<optgroup label="${g.label}">${
        g.styles.map(([k]) => {
          const v = cls === 'vis-facialHair' ? k : `${k}/adult`;
          return `<option value="${v}" ${v === current ? 'selected' : ''}>${labelFor(v)}</option>`;
        }).join('')
      }</optgroup>`).join('')}
    </select>`;

  const pick = list => list[Math.floor(Math.random() * list.length)];
  /* Randomisers skip index 0 ('none') so a dice roll actually shows something. */
  const pickStyle = list => list[1 + Math.floor(Math.random() * (list.length - 1))];


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
        hair: pickStyle(VISUAL_OPTS.hair),
        hairExtension: 'none',
        facialHair: raceDefs.facialHair,
        hairColor: raceDefs.hairColor,
        hairExtColor: '',      // '' = match the main hair colour
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

  /* The editor is taller than most screens in one piece, so it's split into
     steps: the portrait, name, class and race stay pinned at the top and only
     the step body swaps. Adding a step is a matter of adding an entry here
     plus a branch in the renderSlot template. */
  const STEPS = [
    { key: 'look',  label: 'Appearance' },
    { key: 'build', label: 'Abilities & Skills' }
  ];
  let currentStep = 0;

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

  /* LPC walk sheets are 9 columns x 4 rows (up, left, down, right). The
     preview picks a row so the player can turn the hero around — long hair and
     braids only read properly from the back and side. */
  const PREVIEW_DIRS = [
    { key: 'down',  row: 2, label: 'Front' },
    { key: 'left',  row: 1, label: 'Left'  },
    { key: 'up',    row: 0, label: 'Back'  },
    { key: 'right', row: 3, label: 'Right' }
  ];
  let previewDirIdx = 0;

  /* Recolour a sprite frame using HSL replacement: preserves the original
     shading (luminosity) but applies the tint's hue and saturation. Works on
     both neutral (grayscale) and pre-coloured sprites, unlike multiply which
     only looks good on grayscale bases. */
  function drawTintedLayer(ctx, img, tintColor, matchLightness = false) {
    /* Walk sheets are 4 rows tall; oversize sheets (128px weapon sweeps) get
       centre-cropped so every layer lines up on the 64px preview frame. */
    const cell = Number.isInteger(img.height / 4) ? img.height / 4 : 64;
    const sxSrc = (cell - 64) / 2;
    const sySrc = PREVIEW_DIRS[previewDirIdx].row * cell + (cell - 64) / 2;
    if (!tintColor) {
      ctx.drawImage(img, sxSrc, sySrc, 64, 64, 0, 0, 64, 64);
      return;
    }
    const tc = document.createElement('canvas');
    tc.width = 64; tc.height = 64;
    const t = tc.getContext('2d');
    t.drawImage(img, sxSrc, sySrc, 64, 64, 0, 0, 64, 64);
    const id = t.getImageData(0, 0, 64, 64);
    recolorPixels(id.data, tintColor, matchLightness);
    t.putImageData(id, 0, 0);
    ctx.drawImage(tc, 0, 0);
  }

  /* The kit a hero of this class will actually embark in. Built once per class
     and cached — makeStarterItem allocates an id, and the preview redraws on
     every keystroke. The preview used to hand-roll its own gear table, which
     had drifted into promising fighters chainmail and a longsword they never
     receive; now it renders exactly what walks into the first dungeon. */
  const starterKitCache = {};
  function starterKit(classKey) {
    if (!starterKitCache[classKey]) {
      const st = STARTER_GEAR[classKey];
      starterKitCache[classKey] = st
        ? { weapon: makeStarterItem('weapon', st.weapon),
            armor:  makeStarterItem('armor', st.armor, st.look) }
        : {};
    }
    return starterKitCache[classKey];
  }

  async function drawPreview(canvas, slot) {
    const ctx = canvas.getContext('2d');
    const visual = slot.visual;
    const sx = visual.spriteScaleX || 1.0;
    const sy = visual.spriteScaleY || 1.0;

    const paths = buildLayerPaths(visual, starterKit(slot.classKey));

    /* Load everything before touching the canvas: drawPreview is called on
       every edit, and interleaving two in-flight draws on the same canvas used
       to composite half of the old look on top of the new one. */
    const token = (canvas._previewToken = (canvas._previewToken || 0) + 1);
    const imgs = await Promise.all(LAYER_ORDER.map(layer =>
      paths[layer] ? loadImage(ASSETS_ROOT + paths[layer] + '/walk.png').catch(() => null)
                   : Promise.resolve(null)
    ));
    if (canvas._previewToken !== token) return;   // a newer draw superseded us

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    /* Apply race body scaling (dwarf = wider, halfling = smaller) anchored
       at bottom-centre so the sprite doesn't float above the ground. */
    if (sx !== 1.0 || sy !== 1.0) {
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height);
      ctx.scale(sx, sy);
      ctx.translate(-canvas.width / 2, -canvas.height);
    }

    const kit = starterKit(slot.classKey);
    LAYER_ORDER.forEach((layer, i) => {
      const img = imgs[i];
      if (!img) return;
      /* matchLightness only for skin/hair/eyes — gear keeps its painted
         shading and takes just the dye's hue. See recolorPixels. */
      drawTintedLayer(ctx, img, layerTint(layer, visual, kit), isCharacterLayer(layer));
    });

    if (sx !== 1.0 || sy !== 1.0) {
      ctx.restore();
    }
  }

  /* ---- point buy ---- */
  const POINT_POOL = 27;
  const getCost = (val) => {
    if(val<=13) return val-8;
    if(val===14) return 7;
    if(val===15) return 9;
    return 0;
  };
  const pointsLeft = s => POINT_POOL - ABILITIES.reduce((n, ab) => n + getCost(s.baseStats[ab]), 0);

  /* How many class skills a hero has picked beyond their allowance. Racial
     proficiencies are free and don't count against the class budget. */
  function skillsOver(s){
    const choices = CLASSES[s.classKey].skillChoices;
    if(!choices) return 0;
    const racial = RACES[s.raceKey].skills || [];
    const picked = (s.proficiencies || [])
      .filter(p => choices.list.includes(p) && !racial.includes(p));
    return picked.length - choices.count;
  }

  /* Footer: Next walks the steps, Embark only appears on the last one and is
     blocked while any hero is over budget — the +/- buttons and the skill
     checkboxes guard against it, but a race or class swap can still leave a
     hero in the red, and letting that through is a free stat/skill. */
  function updateEmbark(){
    const btn = $('setup-embark'), next = $('setup-next'), prev = $('setup-prev');
    if(!btn) return;
    const last = currentStep === STEPS.length - 1;
    btn.style.display  = last ? '' : 'none';
    if (next) next.style.display = last ? 'none' : '';
    if (prev) prev.style.display = currentStep > 0 ? '' : 'none';

    const overPts = slots.find(s => pointsLeft(s) < 0);
    const overSkills = slots.find(s => skillsOver(s) > 0);
    btn.disabled = !!(overPts || overSkills);
    btn.title = overPts
      ? `${overPts.name} has spent more than ${POINT_POOL} ability points.`
      : overSkills
        ? `${overSkills.name} has more class skills selected than ${CLASSES[overSkills.classKey].label}s may take.`
        : '';
  }

  const goStep = d => {
    currentStep = Math.min(STEPS.length - 1, Math.max(0, currentStep + d));
    renderSlot();
  };

  /* ---- full-look randomiser ----
     Stays inside the race's own palettes and keeps the racial silhouette
     (ears, horns, beast head, body scale) so a rolled half-orc still reads as
     a half-orc. Beards land on ~35% of heroes, extensions on ~25%. */
  function randomizeAppearance(slot){
    const v = slot.visual;
    const raceDefs = getRaceDefaults(slot.raceKey);
    v.gender = pick(VISUAL_OPTS.gender);
    v.skinColor = pick(skinColorsFor(slot.raceKey));
    v.hair = Math.random() < 0.06 ? 'none' : pickStyle(VISUAL_OPTS.hair);
    v.hairColor = pick(VISUAL_OPTS.hairColor);
    v.hairExtension = Math.random() < 0.25 ? pickStyle(VISUAL_OPTS.hairExtension) : 'none';
    /* mostly matched, occasionally a dyed streak */
    v.hairExtColor = (v.hairExtension !== 'none' && Math.random() < 0.35) ? pick(VISUAL_OPTS.hairExtColor) : '';
    v.facialHair = Math.random() < 0.35 ? pickStyle(VISUAL_OPTS.facialHair) : 'none';
    v.eyeColor = pick(VISUAL_OPTS.eyeColor);
    v.ears = raceDefs.ears;
    v.horns = raceDefs.horns || 'none';
    v.head = raceDefs.head || '';
  }

  /* left-side party roster: every hero with a live sprite + basic info,
     click to edit. Kept in sync whenever a hero changes. */
  function renderRoster(){
    const rosterWrap = $('setup-roster');
    if(!rosterWrap) return;
    rosterWrap.innerHTML = `<div class="roster-head">
        <span class="roster-title">Your Party</span>
        <button type="button" id="btn-random-party" class="cc-icon-btn" title="Randomize every hero's appearance">🎲</button>
      </div>` + slots.map((s,i)=>{
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
    $('btn-random-party').onclick = ()=>{
      slots.forEach(randomizeAppearance);
      renderSlot();
    };
  }

  function renderSlot() {
    const slot = slots[currentSlotIdx];
    const cls = CLASSES[slot.classKey], race = RACES[slot.raceKey];
    
    const colorSwatches = (key, current, listOverride) => {
      const list = listOverride || VISUAL_OPTS[key];
      /* '' on an extension colour means "inherit the hair colour" — offered as
         a leading link swatch so it can be got back to after picking a tint. */
      const inherit = key === 'hairExtColor'
        ? `<button type="button" class="swatch swatch-inherit ${key} ${current ? '' : 'on'}" data-val="" title="Match hair colour">⛓</button>`
        : '';
      return `<div class="swatch-row">` + inherit + list.map(c =>
        `<button type="button" class="swatch ${key} ${c === current ? 'on' : ''}" data-val="${c}"
           style="--sw:${c}" title="${c}"></button>`
      ).join('') + `</div>`;
    };

    const dir = PREVIEW_DIRS[previewDirIdx];

    slotWrap.innerHTML = `
      <div class="editor-title">Editing <b>${slot.name}</b> — Hero ${currentSlotIdx + 1} of ${slots.length}</div>
      <div class="slot cc-slot">
        <div class="cc-header">
          <div class="cc-stage">
            <canvas class="slot-preview cc-preview" width="64" height="64"></canvas>
            <div class="cc-stage-ctrls">
              <button type="button" id="btn-turn-left" class="cc-icon-btn" title="Turn left">◀</button>
              <span class="cc-facing">${dir.label}</span>
              <button type="button" id="btn-turn-right" class="cc-icon-btn" title="Turn right">▶</button>
            </div>
          </div>
          <div class="cc-ident">
            <div class="cc-row">
              <input class="slot-name" value="${slot.name}" maxlength="12" aria-label="Hero name">
              <button type="button" id="btn-random-name" class="cc-icon-btn" title="Random name">🎲</button>
            </div>
            <div class="cc-row">
              <select class="slot-class" aria-label="Class">${PLAYABLE_CLASSES.map(([k,c])=>`<option value="${k}" ${k===slot.classKey?'selected':''}>${c.label}</option>`).join('')}</select>
              <select class="slot-race" aria-label="Race">${PLAYABLE_RACES.map(([k,r])=>`<option value="${k}" ${k===slot.raceKey?'selected':''}>${r.label}</option>`).join('')}</select>
            </div>
            <button type="button" id="btn-random-look" class="cc-wide-btn">🎲 Randomize Appearance</button>
          </div>
        </div>

        <div class="cc-steps" role="tablist">
          ${STEPS.map((st,i)=>`<button type="button" class="cc-step ${i===currentStep?'on':''}" data-step="${i}"
             role="tab" aria-selected="${i===currentStep}">${i+1} · ${st.label}</button>`).join('')}
        </div>

        ${currentStep !== 0 ? '' : `
        <div class="cc-section">
          <div class="cc-grid">
            <label class="cc-field"><span>Build</span>
              <select class="vis-gender">${VISUAL_OPTS.gender.map(v=>`<option value="${v}" ${v===slot.visual.gender?'selected':''}>${v[0].toUpperCase()+v.slice(1)}</option>`).join('')}</select>
            </label>
            <label class="cc-field"><span>Ears</span>
              <select class="vis-ears">${EARS_OPTS.map(([v,l])=>`<option value="${v}" ${v===(slot.visual.ears||'none')?'selected':''}>${l}</option>`).join('')}</select>
            </label>
            <label class="cc-field"><span>Horns</span>
              <select class="vis-horns">${HORNS_OPTS.map(([v,l])=>`<option value="${v}" ${v===(slot.visual.horns||'none')?'selected':''}>${l}</option>`).join('')}</select>
            </label>
            <label class="cc-field"><span>Facial Hair</span>
              ${styleSelect('vis-facialHair', FACIAL_HAIR_GROUPS, slot.visual.facialHair, 'Clean Shaven')}
            </label>
            <div class="cc-field cc-field-wide"><span>Hair</span>
              ${styleSelect('vis-hair', HAIR_GROUPS, slot.visual.hair, 'Bald')}
              <button type="button" id="btn-random-hair" class="cc-icon-btn" title="Random hair">🎲</button>
            </div>
            <label class="cc-field cc-field-wide"><span>Extension</span>
              ${styleSelect('vis-hairExtension', HAIR_EXTENSION_GROUPS, slot.visual.hairExtension, 'None')}
            </label>
            <div class="cc-field cc-field-wide"><span>Skin</span>
              ${colorSwatches('skinColor', slot.visual.skinColor, skinColorsFor(slot.raceKey))}
            </div>
            <div class="cc-field cc-field-wide"><span>Hair Colour</span>
              ${colorSwatches('hairColor', slot.visual.hairColor)}
            </div>
            ${slot.visual.hairExtension && slot.visual.hairExtension !== 'none' ? `
            <div class="cc-field cc-field-wide"><span>Ext. Colour</span>
              ${colorSwatches('hairExtColor', slot.visual.hairExtColor)}
            </div>` : ''}
            <div class="cc-field cc-field-wide"><span>Eyes</span>
              ${colorSwatches('eyeColor', slot.visual.eyeColor)}
            </div>
          </div>
        </div>`}

        ${currentStep !== 1 ? '' : `
        <div class="cc-columns">
          <div class="cc-section">
            <div class="cc-section-head"><span>Abilities</span></div>
            <div class="slot-stats" id="active-stats"></div>
            <div class="cc-row cc-row-btns">
              <button type="button" id="btn-recommend-stats" class="cc-wide-btn">Recommend</button>
              <button type="button" id="btn-random-stats" class="cc-wide-btn">🎲 Rand</button>
              <button type="button" id="btn-reset-stats" class="cc-wide-btn">↺ Reset</button>
            </div>
          </div>
          <div class="cc-section" id="setup-skills-section"></div>
        </div>

        <div class="slot-traits" id="active-traits"></div>`}
      </div>
    `;

    const canvas = slotWrap.querySelector('.slot-preview');

    /* Renders the point-buy table when the Abilities step is showing, and in
       every case refreshes the things that live outside it — the roster card,
       the portrait and the embark gate. */
    const updateStats = ()=>{
      const statsEl = $('active-stats');
      const ptsLeft = pointsLeft(slot);
      if (!statsEl) { syncRosterStats(); updateEmbark(); drawPreview(canvas, slot); return; }

      let statsHtml = `<div class="pb-head"><span>Point Buy (Max 15)</span>
        <span>Points <b class="${ptsLeft === 0 ? 'ok' : (ptsLeft < 0 ? 'over' : '')}">${ptsLeft}</b>/27</span></div>`;

      ABILITIES.forEach(ab=>{
        const isKey = ab===cls.statPriority[0];
        const base = slot.baseStats[ab];
        const rac = race.bonus[ab] || 0;
        const total = base + rac;
        /* The + button also has to respect the remaining budget — without it
           the pool could be overspent all the way to 54 points. */
        const canAfford = ptsLeft >= (base >= 13 ? 2 : 1);
        statsHtml += `
          <div class="pb-row">
            <span class="pb-ab ${isKey?'key':''}" title="${isKey ? 'Key ability for '+cls.label : ''}">${ABILITY_LABEL[ab]}</span>
            <span class="pb-ctrl">
              <button type="button" class="pb-btn pb-sub" data-ab="${ab}" ${base<=8?'disabled':''}>−</button>
              <span class="pb-val">${base}</span>
              <button type="button" class="pb-btn pb-add" data-ab="${ab}" ${(base>=15 || !canAfford)?'disabled':''}>+</button>
            </span>
            <span class="pb-race">${rac>0?'+'+rac:''}</span>
            <span class="pb-total">${total}</span>
            <span class="pb-mod">${fmtMod(mod(total))}</span>
          </div>
        `;
      });
      statsEl.innerHTML = statsHtml;

      // Bind point buy buttons
      slotWrap.querySelectorAll('.pb-btn').forEach(btn => {
        btn.onclick = (e) => {
          const b = e.currentTarget;
          const ab = b.dataset.ab;
          if (b.classList.contains('pb-add') && slot.baseStats[ab] < 15) {
            slot.baseStats[ab]++;
          } else if (b.classList.contains('pb-sub') && slot.baseStats[ab] > 8) {
            slot.baseStats[ab]--;
          }
          updateStats();
        };
      });

      const traits = $('active-traits');
      if (traits) traits.innerHTML =
        `<div>⚔ ${cls.attack.name} — ${cls.acDesc}</div><div>✨ ${cls.feature}</div><div>🧬 ${race.trait}</div>`;

      syncRosterStats();
      updateEmbark();
      drawPreview(canvas, slot);
    };

    /* keep the active roster card's stat readout live as points are spent */
    function syncRosterStats(){
      const rs = document.querySelector('.roster-hero.on .roster-stats');
      if(!rs) return;
      rs.innerHTML = ABILITIES.map(ab=>{
        const total = (slot.baseStats[ab]||8) + (race.bonus[ab]||0);
        return `<span class="rstat"><em>${ABILITY_LABEL[ab]}</em><b>${total}</b></span>`;
      }).join('');
    }

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
          updateEmbark();
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
      /* Only the traits bound to the race's own art are reset — the skin
         palette, beast head, ears, horns and body scale. Hair, beard and eye
         colour are the player's choices and survive a race swap. */
      const raceDefs = getRaceDefaults(slot.raceKey);
      slot.visual.head = raceDefs.head || '';
      slot.visual.skinColor = raceDefs.skinColor;
      slot.visual.ears = raceDefs.ears;
      slot.visual.horns = raceDefs.horns || 'none';
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

    /* Step bodies swap, so every per-step control is bound defensively. */
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };

    on('btn-recommend-stats', () => {
      const standardArray = [15, 14, 13, 12, 10, 8];
      cls.statPriority.forEach((ab, i) => { slot.baseStats[ab] = standardArray[i]; });
      updateStats();
    });

    on('btn-random-stats', () => {
      const stats = {str:8, dex:8, con:8, int:8, wis:8, cha:8};
      let pts = POINT_POOL;
      const costDiff = (val) => val >= 13 ? 2 : 1;
      /* Bail out once nothing affordable is left, or a party of 15s with 1
         point spare would spin here forever. */
      let guard = 500;
      while(pts > 0 && guard-- > 0) {
        const ab = ABILITIES[Math.floor(Math.random()*ABILITIES.length)];
        const diff = costDiff(stats[ab]);
        if (stats[ab] < 15 && pts >= diff) { stats[ab]++; pts -= diff; }
        else if (ABILITIES.every(a => stats[a] >= 15 || pts < costDiff(stats[a]))) break;
      }
      slot.baseStats = stats;
      updateStats();
    });

    on('btn-reset-stats', () => {
      slot.baseStats = { str:8, dex:8, con:8, int:8, wis:8, cha:8 };
      updateStats();
    });

    on('btn-random-hair', () => {
      slot.visual.hair = pickStyle(VISUAL_OPTS.hair);
      slot.visual.hairColor = pick(VISUAL_OPTS.hairColor);
      renderSlot();
    });

    on('btn-random-look', () => {
      randomizeAppearance(slot);
      /* jump to the look step so the reroll is actually visible */
      currentStep = 0;
      renderSlot();
    });

    /* step tabs */
    slotWrap.querySelectorAll('.cc-step').forEach(btn => {
      btn.onclick = () => { currentStep = +btn.dataset.step; renderSlot(); };
    });

    /* turn the preview so long hair, braids and capes can be checked from
       every angle before embarking */
    const turn = step => {
      previewDirIdx = (previewDirIdx + step + PREVIEW_DIRS.length) % PREVIEW_DIRS.length;
      renderSlot();
    };
    on('btn-turn-left',  () => turn(-1));
    on('btn-turn-right', () => turn(1));

    /* visual selects re-render the whole slot so the roster sprite updates too */
    ['gender', 'hair', 'hairExtension', 'facialHair', 'ears', 'horns'].forEach(key => {
      const el = slotWrap.querySelector('.vis-'+key);
      if(!el) return;
      el.addEventListener('change', e=>{
        slot.visual[key] = e.target.value;
        renderSlot();
      });
    });
    ['skinColor', 'hairColor', 'hairExtColor', 'eyeColor'].forEach(key => {
      slotWrap.querySelectorAll('.swatch.'+key).forEach(sw => {
        sw.onclick = () => {
          slot.visual[key] = sw.dataset.val;
          renderSlot(); // Re-render to update the selection highlight
        };
      });
    });
  }

  renderSlot();
  updateEmbark();

  $('setup-back').onclick = ()=>{ ov.classList.remove('show'); onBack(); };
  $('setup-next').onclick = ()=> goStep(1);
  $('setup-prev').onclick = ()=> goStep(-1);
  $('setup-embark').onclick = ()=>{
    if(slots.some(s => pointsLeft(s) < 0 || skillsOver(s) > 0)) return;
    ov.classList.remove('show');
    onEmbark(slots);
  };
}

/* ---------------- manual combat UI bar ---------------- */
let _activeSubmenu = null; // 'action' | 'bonus' | null
let _levelSelectSpellKey = null;
let _branchCategory = null; // 'attack' | 'spells' | 'features' | null
let _branchSpellLevel = null; // 0 | 1 | 2 | 3 | null
let _lastBarStateKey = '';

function getAvailableSlotLevels(h, spellKey) {
  const sp = SPELLS[spellKey];
  if (!sp || sp.level === 0 || sp.recharge === 'long' || sp.recharge === 'short') return [];
  const minLvl = sp.level || 1;
  const slots = h?.data?.slots || {};
  const available = [];
  for (let l = minLvl; l <= 9; l++) {
    if ((slots[l] || 0) > 0) {
      available.push(l);
    }
  }
  return available;
}

export function updateManualCombatBar(game) {
  const bar = $('manual-combat-bar');
  if (!bar) return;

  const inCombat = game.initiative && game.initiative.active;
  const cur = inCombat ? game._currentActor() : null;
  const isHeroTurn = inCombat && cur && cur._side === 'hero' && game.controlMode === 'manual';

  if (!isHeroTurn || !cur || !cur.data) {
    bar.style.display = 'none';
    _lastBarStateKey = null;
    return;
  }

  const moveLeft = cur.moveLeft != null ? cur.moveLeft : game.cellsForSpeed(cur);
  const maxMove = game.cellsForSpeed(cur);
  const actUsed = !!cur.actUsed;
  const bonusUsed = !!(cur.bonusUsed || cur._bonusActed);
  const heroName = cur.data.name || 'Hero';
  const hp = cur.data.hp || 0;

  /* State key comparison */
  const stateKey = `${heroName}_${hp}_${moveLeft}_${maxMove}_${actUsed}_${bonusUsed}_${_activeSubmenu}_${_levelSelectSpellKey}_${_branchCategory}_${_branchSpellLevel}`;
  if (stateKey === _lastBarStateKey && bar.style.display === 'flex') {
    return;
  }
  _lastBarStateKey = stateKey;

  bar.style.display = 'flex';

  const moveFt = moveLeft * 5;
  const maxFt = maxMove * 5;
  const movePct = Math.max(0, Math.min(100, Math.round((moveLeft / maxMove) * 100)));

  const classKey = (cur.data.classKey || 'hero').toUpperCase();
  const maxHp = cur.data.maxHp || 1;
  const initial = heroName.charAt(0).toUpperCase();

  /* Action submenu items */
  const knownSpells = cur.data.knownSpells || [];
  const actionSpells = knownSpells.filter(k => {
    const s = SPELLS[k];
    return s && s.castingTime !== 'bonus' && s.bonusAction !== true;
  });

  const bonusSpells = knownSpells.filter(k => {
    const s = SPELLS[k];
    return s && (s.castingTime === 'bonus' || s.bonusAction === true);
  });

  /* Action Abilities */
  const d = cur.data;
  const sc = subclassOf(d);
  const actionAbilities = [];
  if ((hasFeature(d, 'actionSurgeClass') || (sc && sc.active.key === 'actionSurge')) && !d.abilityUsed?.short) {
    actionAbilities.push({ key: 'actionSurge', label: 'Action Surge', desc: 'Attack again' });
  }
  if (sc && sc.active.key === 'fastHands' && !d.abilityUsed?.short) {
    actionAbilities.push({ key: 'fastHands', label: 'Smoke Bomb (Fast Hands)', desc: 'Blind foes in 4m' });
  }

  /* Bonus Action Abilities */
  const bonusAbilities = [];
  if ((d.secondWind || hasFeature(d, 'secondWind')) && !d.secondWindUsed) {
    bonusAbilities.push({ key: 'secondWind', label: 'Second Wind', desc: 'Heal 1d10 + level' });
  }
  if (d.offhandProfile) {
    bonusAbilities.push({ key: 'offhand', label: 'Off-Hand Attack', desc: 'Swing secondary weapon' });
  }
  if (hasFeature(d, 'rage') && !d.rageUsed) {
    bonusAbilities.push({ key: 'rage', label: 'Rage', desc: 'Enter raging stance' });
  }
  if (hasFeature(d, 'cunningActionClass') || (sc && sc.active.key === 'cunningAction')) {
    bonusAbilities.push({ key: 'cunningAction', label: 'Cunning Action', desc: 'Haste / Dash / Disengage' });
  }
  if (hasFeature(d, 'flurryOfBlows') && !d.abilityUsed?.short) {
    bonusAbilities.push({ key: 'flurry', label: 'Flurry of Blows', desc: 'Extra martial strike' });
  }
  if (hasFeature(d, 'bardicInspiration') && !d.abilityUsed?.short) {
    bonusAbilities.push({ key: 'bardicInspiration', label: 'Bardic Inspiration', desc: 'Inspire allies (+1d4)' });
  }

  const atkOpts = getAvailableAttackOptions(cur);

  let html = `
    <div class="mbar-hero">
      <div class="mbar-hero-avatar">${initial}</div>
      <div class="mbar-hero-info">
        <div class="mbar-hero-name">${heroName} <span style="font-size:11px;color:#d8aa46;">(${classKey})</span></div>
        <div class="mbar-hero-hp">❤️ ${hp}/${maxHp} HP</div>
      </div>
    </div>

    <div class="mbar-section mbar-move-box">
      <div class="mbar-sec-title">Movement</div>
      <div class="mbar-move-val">🦶 ${moveFt} / ${maxFt} ft</div>
      <div class="mbar-move-track"><div class="mbar-move-fill" style="width:${movePct}%;"></div></div>
    </div>

    <div class="mbar-btn-wrap">
      <button id="mbar-act-btn" class="mbar-btn ${actUsed ? 'spent disabled' : ''}" ${actUsed ? 'disabled' : ''}>
        ⚔️ Action ${actUsed ? '(Spent)' : (_activeSubmenu === 'action' ? '▲' : '▼')}
      </button>

      <!-- Level 1 Category Menu -->
      <div class="mbar-submenu ${_activeSubmenu === 'action' ? 'show' : ''}">
        <div class="mbar-sub-header">Action Categories</div>
        <button class="mbar-branch-btn ${_branchCategory === 'attack' ? 'active' : ''}" data-branch="attack">
          <span>⚔️ Attack Options</span>
          <span class="mbar-sub-item-sub">▶</span>
        </button>
        ${actionSpells.length ? `
          <button class="mbar-branch-btn ${_branchCategory === 'spells' ? 'active' : ''}" data-branch="spells">
            <span>✨ Spells & Magic</span>
            <span class="mbar-sub-item-sub">▶</span>
          </button>
        ` : ''}
        ${actionAbilities.length ? `
          <button class="mbar-branch-btn ${_branchCategory === 'features' ? 'active' : ''}" data-branch="features">
            <span>⚡ Class Features</span>
            <span class="mbar-sub-item-sub">▶</span>
          </button>
        ` : ''}
        <div class="mbar-sub-header">Common Actions</div>
        <button class="mbar-sub-item" data-act="common" data-type="dash">
          <span>🏃 Dash</span>
          <span class="mbar-sub-item-sub">+Move Speed</span>
        </button>
        <button class="mbar-sub-item" data-act="common" data-type="dodge">
          <span>🛡️ Dodge</span>
          <span class="mbar-sub-item-sub">+5 AC</span>
        </button>
        <button class="mbar-sub-item" data-act="common" data-type="disengage">
          <span>💨 Disengage</span>
          <span class="mbar-sub-item-sub">No Opp Attacks</span>
        </button>
      </div>

      <!-- Level 2 Branch Popover: Attack Options -->
      ${(_activeSubmenu === 'action' && _branchCategory === 'attack') ? `
        <div class="mbar-branch-panel level-2 show">
          <div class="mbar-sub-header">Select Attack Type</div>
          ${atkOpts.map(opt => `
            <button class="mbar-sub-item attack-opt-btn" data-opt-key="${opt.key}" data-type="${opt.type}">
              <span>${opt.label}</span>
              <span class="mbar-sub-item-sub">${opt.sub}</span>
            </button>
          `).join('')}
        </div>
      ` : ''}

      <!-- Level 2 Branch Popover: Spell Slots -->
      ${(_activeSubmenu === 'action' && _branchCategory === 'spells') ? (() => {
        const slots = cur.data?.slots || {};
        const maxSlots = cur.data?.maxSlots || {};
        const cantripList = actionSpells.filter(k => SPELLS[k] && (!SPELLS[k].level || SPELLS[k].level === 0));
        const lvl1List = actionSpells.filter(k => SPELLS[k] && SPELLS[k].level === 1);
        const lvl2List = actionSpells.filter(k => SPELLS[k] && SPELLS[k].level > 0 && SPELLS[k].level <= 2);
        const lvl3List = actionSpells.filter(k => SPELLS[k] && SPELLS[k].level > 0 && SPELLS[k].level <= 3);

        return `
          <div class="mbar-branch-panel level-2 show">
            <div class="mbar-sub-header">Select Spell Tier</div>
            ${cantripList.length ? `
              <button class="mbar-branch-btn ${_branchSpellLevel === 0 ? 'active' : ''}" data-spell-level="0">
                <span>🔹 Cantrips (At-Will)</span>
                <span class="mbar-sub-item-sub">▶</span>
              </button>
            ` : ''}
            ${lvl1List.length ? `
              <button class="mbar-branch-btn ${_branchSpellLevel === 1 ? 'active' : ''}" data-spell-level="1">
                <span>🔮 Level 1 Slots</span>
                <span class="mbar-sub-item-sub">${slots[1] || 0}/${maxSlots[1] || 0} ▶</span>
              </button>
            ` : ''}
            ${lvl2List.length ? `
              <button class="mbar-branch-btn ${_branchSpellLevel === 2 ? 'active' : ''}" data-spell-level="2">
                <span>🔮 Level 2 Slots</span>
                <span class="mbar-sub-item-sub">${slots[2] || 0}/${maxSlots[2] || 0} ▶</span>
              </button>
            ` : ''}
            ${lvl3List.length ? `
              <button class="mbar-branch-btn ${_branchSpellLevel === 3 ? 'active' : ''}" data-spell-level="3">
                <span>🔮 Level 3 Slots</span>
                <span class="mbar-sub-item-sub">${slots[3] || 0}/${maxSlots[3] || 0} ▶</span>
              </button>
            ` : ''}
          </div>
        `;
      })() : ''}

      <!-- Level 3 Branch Popover: Spell Selection -->
      ${(_activeSubmenu === 'action' && _branchCategory === 'spells' && _branchSpellLevel !== null) ? (() => {
        const targetLvl = _branchSpellLevel;
        const matchingSpells = actionSpells.filter(k => {
          const sp = SPELLS[k];
          if (!sp) return false;
          if (targetLvl === 0) return !sp.level || sp.level === 0;
          return sp.level > 0 && sp.level <= targetLvl;
        });

        return `
          <div class="mbar-branch-panel level-3 show">
            <div class="mbar-sub-header">${targetLvl === 0 ? 'Cantrips' : 'Level ' + targetLvl + ' Spells'}</div>
            ${matchingSpells.map(k => {
              const sp = SPELLS[k];
              const isUpcast = sp && sp.level > 0 && sp.level < targetLvl;
              return `
                <button class="spell-cast-btn" data-spell="${k}" data-level="${targetLvl || 1}">
                  <span>✨ ${sp ? sp.label : k} ${isUpcast ? '<small style="color:#d8aa46;">(Upcast)</small>' : ''}</span>
                  <span class="mbar-sub-item-sub">${sp && sp.school ? sp.school : 'Magic'}</span>
                </button>
              `;
            }).join('')}
          </div>
        `;
      })() : ''}

      <!-- Level 2 Branch Popover: Features -->
      ${(_activeSubmenu === 'action' && _branchCategory === 'features') ? `
        <div class="mbar-branch-panel level-2 show">
          <div class="mbar-sub-header">Class Features</div>
          ${actionAbilities.map(a => `
            <button class="mbar-sub-item" data-act="action-ability" data-key="${a.key}">
              <span>⚡ ${a.label}</span>
              <span class="mbar-sub-item-sub">${a.desc}</span>
            </button>
          `).join('')}
        </div>
      ` : ''}
    </div>

    <div class="mbar-btn-wrap">
      <button id="mbar-bonus-btn" class="mbar-btn ${bonusUsed ? 'spent disabled' : ''}" ${bonusUsed ? 'disabled' : ''}>
        ⚡ Bonus ${bonusUsed ? '(Spent)' : (_activeSubmenu === 'bonus' ? '▲' : '▼')}
      </button>
      <div class="mbar-submenu ${_activeSubmenu === 'bonus' ? 'show' : ''}">
        ${bonusSpells.length ? `<div class="mbar-sub-header">Bonus Spells</div>` : ''}
        ${bonusSpells.map(k => {
          const sp = SPELLS[k];
          return `<button class="spell-cast-btn" data-spell="${k}" data-level="${sp?.level || 1}">
            <span>✨ ${sp ? sp.label : k}</span>
            <span class="mbar-sub-item-sub">${sp && sp.level ? 'Lv' + sp.level : 'Cantrip'}</span>
          </button>`;
        }).join('')}
        ${bonusAbilities.length ? `<div class="mbar-sub-header">Bonus Features</div>` : ''}
        ${bonusAbilities.map(a => `<button class="mbar-sub-item" data-act="bonus-ability" data-key="${a.key}">
          <span>⚡ ${a.label}</span>
          <span class="mbar-sub-item-sub">${a.desc}</span>
        </button>`).join('')}
        ${(!bonusSpells.length && !bonusAbilities.length) ? `<div style="padding:8px;font-size:12px;color:#8f95a8;">No bonus actions available</div>` : ''}
      </div>
    </div>

    <button id="mbar-endturn-btn" class="mbar-btn endturn-btn">
      ⏭️ End Turn
    </button>
  `;

  bar.innerHTML = html;

  /* Event Listeners */
  const actBtn = $('mbar-act-btn');
  if (actBtn) {
    actBtn.onclick = (e) => {
      e.stopPropagation();
      _levelSelectSpellKey = null;
      _activeSubmenu = _activeSubmenu === 'action' ? null : 'action';
      if (!_activeSubmenu) { _branchCategory = null; _branchSpellLevel = null; }
      updateManualCombatBar(game);
    };
  }

  const bonusBtn = $('mbar-bonus-btn');
  if (bonusBtn) {
    bonusBtn.onclick = (e) => {
      e.stopPropagation();
      _levelSelectSpellKey = null;
      _branchCategory = null;
      _branchSpellLevel = null;
      _activeSubmenu = _activeSubmenu === 'bonus' ? null : 'bonus';
      updateManualCombatBar(game);
    };
  }

  const endBtn = $('mbar-endturn-btn');
  if (endBtn) {
    endBtn.onclick = () => {
      _activeSubmenu = null;
      _levelSelectSpellKey = null;
      _branchCategory = null;
      _branchSpellLevel = null;
      if (game && game.manualEndTurn) game.manualEndTurn();
    };
  }

  /* Branch Category buttons */
  bar.querySelectorAll('.mbar-branch-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      if (btn.dataset.branch !== undefined) {
        _branchCategory = _branchCategory === btn.dataset.branch ? null : btn.dataset.branch;
        _branchSpellLevel = null;
      } else if (btn.dataset.spellLevel !== undefined) {
        const lvl = parseInt(btn.dataset.spellLevel, 10);
        _branchSpellLevel = _branchSpellLevel === lvl ? null : lvl;
      }
      updateManualCombatBar(game);
    };
  });

  /* Attack Option clicks */
  bar.querySelectorAll('.attack-opt-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const type = btn.dataset.type;
      _activeSubmenu = null;
      _branchCategory = null;
      _branchSpellLevel = null;

      if (type === 'cantrip') {
        const cantripKey = cur.data?.cantripProfile?.nameKey || 'fireBolt';
        game.manualPerformSpell(cur, cantripKey, null, null, 0);
      } else if (type === 'thrown') {
        const w = cur.data?.weaponProfile;
        game.manualPerformAttack(cur, null, { thrown: true, range: w?.range || 6 });
      } else {
        game.manualPerformAttack(cur);
      }
    };
  });

  /* Spell Cast clicks */
  bar.querySelectorAll('.spell-cast-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const spellKey = btn.dataset.spell;
      const level = parseInt(btn.dataset.level, 10);
      _activeSubmenu = null;
      _branchCategory = null;
      _branchSpellLevel = null;
      game.manualPerformSpell(cur, spellKey, null, null, level);
    };
  });

  /* Submenu item clicks */
  bar.querySelectorAll('.mbar-sub-item').forEach(item => {
    item.onclick = (e) => {
      e.stopPropagation();
      const act = item.dataset.act;
      if (act === 'common') {
        _activeSubmenu = null;
        _branchCategory = null;
        _branchSpellLevel = null;
        game.manualPerformCommonAction(cur, item.dataset.type);
      } else if (act === 'action-ability' || act === 'bonus-ability') {
        _activeSubmenu = null;
        _branchCategory = null;
        _branchSpellLevel = null;
        if (act === 'bonus-ability') game.manualPerformBonusAbility(cur, item.dataset.key);
        else if (act === 'action-ability') { /* handle as needed */ }
      }
    };
  });
}

if (typeof window !== 'undefined') {
  window.__updateManualBar = () => {
    if (window.__game) updateManualCombatBar(window.__game);
  };
}

