/**
 * Bestiary & Monster Visual/Stat Editor Module
 * Standalone tool for reviewing monsters, editing stats, scale, and granular Color Balance
 * (Shadows/Lows, Midtones/Mediums, Highlights/Highs), testing sprites, and exporting monsters.json.
 * Includes live expanded In-Game Room Combat Arena preview with generated walls & scatter terrain.
 */

import { MONSTERS_RAW, MONSTERS_ALL, applyCRScalingToMonster, fmtMod, getThemeForMonster, MONSTER_THEMES, DUNGEON_MONSTER_MAP, BOSS_ENCOUNTERS_RAW, getCuratedBossEncounters, TACTICAL_ROOMS_RAW, getCuratedTacticalRooms, PLAYABLE_RACES } from './game/srd.js';
import { STORY_MISSIONS_BASE } from './game/story.js';
import {
  storyLanes, storyPoolIds, storySpawnCost, defaultStoryBudget, planStoryFloorCast
} from './game/srd.js';
import { BOSS_SPELLS, BOSS_SPELL_FX } from './game/monster_ai.js';
import { playSfx, spellSfx } from './game/audio.js';
import {
  CR_SCALING_TABLE, crForDungeonLevel, baseCrForDungeonLevel, maxCrForDungeonLevel, crUpChanceForDungeonLevel, crToCost, crBandIndex
} from './game/constants.js';
import CR_SCALING_FACTORY from './game/cr_scaling.default.json' with { type: 'json' };
import {
  SPAWN_BUDGET, getSpawnBudget, spawnLevelRow, makeRng, THEMES,
  buyRoomSpawns, roomSpawnBudget, roomSpawnCap
} from './dungeon/dungeon_generator.js';
import SPAWN_BUDGET_FACTORY from './game/spawn_budget.default.json' with { type: 'json' };
import { getDefaultColorBalance, applyColorBalanceToPixel, loadBalancedCanvas } from './game/color_balance.js';
import { getRaceDefaults } from './game/appearance.js';
import { drawHeroPortrait } from './game/sprite_animator.js';

/* Ensure crCostOverrides is present and mutable on the live budget object.
   JSON module imports may not let us add brand-new top-level keys later. */
if (!SPAWN_BUDGET.crCostOverrides) SPAWN_BUDGET.crCostOverrides = {};
const sbCrCostOverrides = SPAWN_BUDGET.crCostOverrides;

/* Local crToCost that reads from our mutable overrides instead of relying
   on constants.js which has its own frozen import of the same JSON file. */
function sbCrToCost(cr) {
  const c = Math.max(0, cr || 0);
  const scale = SPAWN_BUDGET.crCostScale ?? 1;
  // Exact match
  const key = String(c);
  if (sbCrCostOverrides[key] != null) {
    return Math.max(1, Math.round(sbCrCostOverrides[key] * scale));
  }
  // Interpolation
  const keys = Object.keys(sbCrCostOverrides).map(Number).filter(k => isFinite(k)).sort((a, b) => a - b);
  if (keys.length >= 2) {
    if (c <= keys[0]) return Math.max(1, Math.round(sbCrCostOverrides[String(keys[0])] * scale));
    if (c >= keys[keys.length - 1]) return Math.max(1, Math.round(sbCrCostOverrides[String(keys[keys.length - 1])] * scale));
    let lo = 0;
    while (keys[lo + 1] < c) lo++;
    const crLo = keys[lo], crHi = keys[lo + 1];
    const t = (c - crLo) / (crHi - crLo);
    const cost = sbCrCostOverrides[String(crLo)] + t * (sbCrCostOverrides[String(crHi)] - sbCrCostOverrides[String(crLo)]);
    return Math.max(1, Math.round(cost * scale));
  }
  // Fallback to formula
  return Math.max(1, Math.round((8 + 13 * Math.pow(c, 0.8)) * scale));
}

// Local Storage Keys
const NOTES_KEY_PREFIX = 'dc_bestiary_note_';
const FLAGS_KEY = 'dc_bestiary_flags';
const EDITS_KEY = 'dc_bestiary_monster_edits';

// State Management
let baseMonsters = [];
let allMonsters = []; // Effective monsters (base + user edits merged)
let filteredMonsters = [];
let currentIndex = 0;
let userFlags = {}; // { [monsterId]: { needsRedo: boolean, verified: boolean } }
let userEdits = {}; // { [monsterId]: { scale, colorBalance, color, sprite, name, ac, hp, ... } }

let currentZoom = 6; // Default 6x zoom (tripled size)
let bgMode = 'checkerboard'; // 'checkerboard', 'dark', 'light'
let autoFitZoom = false; // Auto zoom out if monster scale clips container
let testSpriteOverride = null; // Custom uploaded sprite file URL
let showCRScaled = true; // Scale monster stats in statblock display according to CR table

// Hero Scale Comparison Reference & Ground Alignment State
let showHeroRef = true;
let heroRefRace = 'human';
let snapToGround = true;
let currentYOffset = 0;

/* ---------------- Hero scale reference ----------------
   The figure standing next to the monster is the real in-game hero: the same
   LPC layer stack HeroSprite composes, drawn front-facing by drawHeroPortrait,
   and sized by the race's own spriteScaleX/Y out of appearance.js. Reading the
   scales from there rather than a copy here means a race rebalance shows up in
   this tool without a second edit.

   The two figures have to be sized off one shared rule. A monster is drawn at
   `imgPx * zoom * mon.scale`, and in game its billboard is
   (imgPx / 32) * 1.125 * mon.scale world units — so the canvas shows
   (32 / 1.125) px per world unit per zoom step. A hero billboard is
   1.125 * spriteScale world units whatever its frame size, which comes out at
   32 * spriteScale * zoom px: the 64px LPC frame draws at half its native
   pixels. A 1.0x hero therefore occupies exactly the 32px the old DCSS
   reference did, so existing monster scales stay calibrated. */
const HERO_FRAME_PX = 64;
const HERO_FRAME_TO_PX = 32 / HERO_FRAME_PX;

/* One composed portrait per race, built lazily. drawHeroPortrait resolves once
   every layer has been drawn; until then the canvas is blank, so the first
   draw for a race repaints when it settles. */
const heroRefCanvases = {};
function getHeroRefCanvas(raceKey, onReady) {
  const cached = heroRefCanvases[raceKey];
  if (cached) return cached;

  const defs = getRaceDefaults(raceKey);
  const canvas = document.createElement('canvas');
  canvas.width = HERO_FRAME_PX;
  canvas.height = HERO_FRAME_PX;
  canvas._ready = false;
  heroRefCanvases[raceKey] = canvas;

  drawHeroPortrait(canvas, {
    visual: {
      gender: 'male',
      head: defs.head || '',
      skinColor: defs.skinColor,
      hair: 'plain/adult',
      hairColor: defs.hairColor,
      hairExtension: 'none',
      facialHair: defs.facialHair,
      eyeColor: defs.eyeColor,
      ears: defs.ears,
      horns: defs.horns
    },
    /* A plain shirt so the reference reads as an adventurer rather than a
       body sheet; legs and feet fall back to pants/shoes on their own. */
    equipment: { armor: { visualTorso: 'clothes/longsleeve/longsleeve', visualColor: '#6f7d92' } }
  }).then(() => {
    canvas._ready = true;
    if (onReady) onReady();
  });

  return canvas;
}

const heroRaceLabel = key => {
  const entry = PLAYABLE_RACES.find(([k]) => k === key);
  return entry ? entry[1].label : key;
};

/* The picker is built from the game's own playable-race list, so a race added
   there shows up here without touching this file. */
function populateHeroRefSelect() {
  const sel = document.getElementById('hero-ref-select');
  if (!sel) return;
  sel.innerHTML = PLAYABLE_RACES.map(([key, race]) => {
    const d = getRaceDefaults(key);
    const sx = d.spriteScaleX || 1.0, sy = d.spriteScaleY || 1.0;
    const scale = sx === sy ? `${sy.toFixed(2)}x` : `${sx.toFixed(2)}×${sy.toFixed(2)}`;
    return `<option value="${key}">${race.label} (${scale})</option>`;
  }).join('');
  sel.value = heroRefRace;
}

/* ---------------- Spawnable Dungeon Types ----------------
   The dungeon list is derived live from the generator's THEMES table, so new
   dungeon styles added to the game appear here automatically. A creature's
   `dungeons` array is the strict whitelist of dungeon-theme keys it may spawn
   in; missing/empty means it spawns nowhere themed. */

const DUNGEON_OPTIONS = Object.keys(THEMES).map(key => {
  const t = THEMES[key] || {};
  const raw = t.label || key;
  const label = raw.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  return { key, label, accent: t.accent || '#d9a441' };
});

/* Dungeon themes this creature's creature-type family already maps to — the
   seed default shown in the editor when a creature has no saved picks yet. */
function derivedDungeonsForMonster(m) {
  const themeName = getThemeForMonster(m);
  const idx = MONSTER_THEMES.findIndex(t => t.name === themeName);
  const out = [];
  for (const key of Object.keys(THEMES)) {
    const fams = DUNGEON_MONSTER_MAP[key];
    if (fams && idx !== -1 && fams.includes(idx)) out.push(key);
  }
  return out;
}

function renderDungeonGrid() {
  const grid = document.getElementById('dungeon-checkbox-grid');
  if (!grid) return;
  grid.innerHTML = DUNGEON_OPTIONS.map(d => `
    <label class="dungeon-chip" data-key="${d.key}" title="Spawnable in ${d.label}">
      <span class="dungeon-accent" style="background:${d.accent}"></span>
      <input type="checkbox" data-key="${d.key}">
      <span>${d.label}</span>
    </label>
  `).join('');
}

function populateDungeonGrid(monster) {
  const grid = document.getElementById('dungeon-checkbox-grid');
  if (!grid) return;
  const saved = Array.isArray(monster.dungeons) ? monster.dungeons : null;
  const checked = saved || derivedDungeonsForMonster(monster);
  grid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    const on = checked.includes(cb.dataset.key);
    cb.checked = on;
    cb.closest('.dungeon-chip')?.classList.toggle('on', on);
  });
}

function applyDungeonSelection() {
  const m = getCurrentMonster();
  if (!m) return;
  const grid = document.getElementById('dungeon-checkbox-grid');
  const keys = [];
  grid?.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
    keys.push(cb.dataset.key);
  });
  applyLiveVisualEdit({ dungeons: keys });
}

// Default Color Balance (Shadows, Midtones, Highlights) lives in
// game/color_balance.js — the game bakes the same math into monster sprites.

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  setupUIEventListeners();
  setupTabs();
  setupCRScalingTab();
  setupSpawnBudgetTab();
  setupBossEncountersTab();
  setupStoryQuestsTab();
  setupDungeonRostersTab();
  setupTacticalRoomsTab();
  setupKeyboardNavigation();
  renderDungeonGrid();
  applyFilters();
  renderCurrentMonster();
  updateGlobalStats();
  window.addEventListener('resize', () => {
    updateSpriteDisplay();
  });
});

function loadData() {
  baseMonsters = [...MONSTERS_RAW];

  // Load Flags
  try {
    const savedFlags = localStorage.getItem(FLAGS_KEY);
    if (savedFlags) userFlags = JSON.parse(savedFlags);
  } catch (e) {
    console.warn("Failed to load bestiary flags from localStorage", e);
    userFlags = {};
  }

  // Load User Edits
  try {
    const savedEdits = localStorage.getItem(EDITS_KEY);
    if (savedEdits) userEdits = JSON.parse(savedEdits);
    /* Drop the retired `isBoss` flag out of saved edits on load, so browsers
       carrying it from an older session stop resurrecting it into the editor
       (and into every subsequent save). Rewrite the stored copy only when
       something was actually removed. */
    let purged = 0;
    for (const id of Object.keys(userEdits)) {
      if (userEdits[id] && 'isBoss' in userEdits[id]) { delete userEdits[id].isBoss; purged++; }
    }
    if (purged) {
      localStorage.setItem(EDITS_KEY, JSON.stringify(userEdits));
      console.info(`bestiary: cleared retired isBoss flag from ${purged} saved edit(s)`);
    }
  } catch (e) {
    console.warn("Failed to load monster edits from localStorage", e);
    userEdits = {};
  }

  mergeUserEditsIntoMonsters();
}

function mergeUserEditsIntoMonsters() {
  laneOptionsCache = null; // creature names/CRs feed the story-tab pickers
  allMonsters = baseMonsters.map(baseM => {
    if (userEdits[baseM.id]) {
      return { ...baseM, ...userEdits[baseM.id], _isEdited: true };
    }
    return { ...baseM, _isEdited: false };
  });
}

function saveUserEdits() {
  try {
    localStorage.setItem(EDITS_KEY, JSON.stringify(userEdits));
  } catch (e) {
    console.error("Failed to save monster edits to localStorage", e);
  }
  mergeUserEditsIntoMonsters();
  updateGlobalStats();
}

function saveFlags() {
  try {
    localStorage.setItem(FLAGS_KEY, JSON.stringify(userFlags));
  } catch (e) {
    console.error("Failed to save bestiary flags", e);
  }
  updateGlobalStats();
}

function getMonsterNote(id) {
  try {
    return localStorage.getItem(NOTES_KEY_PREFIX + id) || '';
  } catch (e) {
    return '';
  }
}

function saveMonsterNote(id, noteText) {
  try {
    if (noteText.trim()) {
      localStorage.setItem(NOTES_KEY_PREFIX + id, noteText);
    } else {
      localStorage.removeItem(NOTES_KEY_PREFIX + id);
    }
  } catch (e) {
    console.error("Failed to save monster note", e);
  }
  updateGlobalStats();
}

function getMonsterFlags(id) {
  if (!userFlags[id]) {
    userFlags[id] = { needsRedo: false, verified: false };
  }
  return userFlags[id];
}

function updateGlobalStats() {
  let noteCount = 0;
  let redoCount = 0;
  let verifiedCount = 0;
  const editedCount = Object.keys(userEdits).length;

  for (const m of allMonsters) {
    const note = getMonsterNote(m.id);
    if (note && note.trim()) noteCount++;

    const flags = userFlags[m.id];
    if (flags) {
      if (flags.needsRedo) redoCount++;
      if (flags.verified) verifiedCount++;
    }
  }

  const statBadges = document.getElementById('global-stats-bar');
  if (statBadges) {
    statBadges.innerHTML = `
      <span class="badge badge-total">Total: ${allMonsters.length} Monsters</span>
      <span class="badge badge-edited" title="Monsters with custom edits">✏️ Edited: ${editedCount}</span>
      <span class="badge badge-redo">🎨 Sprite Redo: ${redoCount}</span>
      <span class="badge badge-verified">✅ Verified: ${verifiedCount}</span>
      <span class="badge badge-notes">📝 Notes: ${noteCount}</span>
    `;
  }
}

function setupUIEventListeners() {
  // Search & Filters
  document.getElementById('search-input')?.addEventListener('input', applyFilters);
  document.getElementById('tier-filter')?.addEventListener('change', applyFilters);
  document.getElementById('type-filter')?.addEventListener('change', applyFilters);
  document.getElementById('cr-filter')?.addEventListener('change', applyFilters);
  document.getElementById('status-filter')?.addEventListener('change', applyFilters);
  document.getElementById('sort-by')?.addEventListener('change', applyFilters);

  // Navigation
  document.getElementById('prev-btn')?.addEventListener('click', () => navigate(-1));
  document.getElementById('next-btn')?.addEventListener('click', () => navigate(1));

  // Zoom Controls
  document.querySelectorAll('.zoom-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.zoom-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentZoom = parseFloat(e.target.dataset.zoom);
      updateSpriteDisplay();
    });
  });

  // Background Toggle
  document.querySelectorAll('.bg-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.bg-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      const currentBg = e.target.dataset.bg;
      const viewport = document.getElementById('sprite-viewport');
      if (viewport) {
        viewport.className = 'sprite-viewport bg-' + currentBg;
      }
    });
  });

  // Hero Scale Reference & Ground Alignment Controls
  document.getElementById('show-hero-ref-toggle')?.addEventListener('change', (e) => {
    showHeroRef = e.target.checked;
    updateSpriteDisplay();
  });

  populateHeroRefSelect();
  document.getElementById('hero-ref-select')?.addEventListener('change', (e) => {
    heroRefRace = e.target.value;
    updateSpriteDisplay();
  });

  document.getElementById('snap-to-ground-toggle')?.addEventListener('change', (e) => {
    snapToGround = e.target.checked;
    updateSpriteDisplay();
  });

  document.getElementById('auto-fit-zoom-toggle')?.addEventListener('change', (e) => {
    autoFitZoom = e.target.checked;
    updateSpriteDisplay();
  });

  // Vertical Ground Y-Offset Slider
  const yOffsetSlider = document.getElementById('edit-y-offset-slider');
  const yOffsetNum = document.getElementById('edit-y-offset-num');

  yOffsetSlider?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10) || 0;
    if (yOffsetNum) yOffsetNum.value = val;
    const label = document.getElementById('y-offset-val-label');
    if (label) label.textContent = val + 'px';
    applyLiveVisualEdit({ yOffset: val });
  });

  yOffsetNum?.addEventListener('change', (e) => {
    const val = parseInt(e.target.value, 10) || 0;
    if (yOffsetSlider) yOffsetSlider.value = val;
    const label = document.getElementById('y-offset-val-label');
    if (label) label.textContent = val + 'px';
    applyLiveVisualEdit({ yOffset: val });
  });

  // Live Arena Room Preview Modal Triggers
  document.getElementById('open-arena-btn')?.addEventListener('click', openArenaModal);
  document.getElementById('open-arena-card-btn')?.addEventListener('click', openArenaModal);
  document.getElementById('arena-close-btn')?.addEventListener('click', closeArenaModal);

  document.getElementById('arena-theme-select')?.addEventListener('change', (e) => {
    arenaTheme = e.target.value;
  });

  document.getElementById('arena-reroll-terrain-btn')?.addEventListener('click', () => {
    const canvas = document.getElementById('arena-canvas');
    if (canvas) generateArenaTerrainProps(canvas.width, canvas.height);
    showToast("🎲 Generated new dungeon room scatter terrain!");
  });

  document.getElementById('arena-fullscreen-btn')?.addEventListener('click', () => {
    const content = document.querySelector('.arena-modal-content');
    const btn = document.getElementById('arena-fullscreen-btn');
    if (content) {
      const isFull = content.classList.toggle('is-fullscreen');
      if (btn) btn.textContent = isFull ? '🗗 Windowed' : '🗖 Fullscreen';
    }
  });

  document.getElementById('arena-open-newtab-btn')?.addEventListener('click', () => {
    const monster = getCurrentMonster();
    if (monster) {
      window.open(buildTestSkillsUrl(monster), '_blank');
    }
  });

  document.getElementById('arena-auto-cycle-btn')?.addEventListener('click', () => {
    arenaAutoCycle = !arenaAutoCycle;
    const btn = document.getElementById('arena-auto-cycle-btn');
    if (btn) btn.textContent = `▶️ Auto-Cycle Loop: ${arenaAutoCycle ? 'ON' : 'OFF'}`;
  });

  document.getElementById('arena-attack-btn')?.addEventListener('click', () => {
    arenaAutoCycle = false;
    const btn = document.getElementById('arena-auto-cycle-btn');
    if (btn) btn.textContent = '▶️ Auto-Cycle Loop: OFF';
    triggerArenaAction('attack');
  });

  document.getElementById('arena-spell-btn')?.addEventListener('click', () => {
    arenaAutoCycle = false;
    const btn = document.getElementById('arena-auto-cycle-btn');
    if (btn) btn.textContent = '▶️ Auto-Cycle Loop: OFF';
    triggerArenaAction('spell');
  });

  document.getElementById('arena-move-btn')?.addEventListener('click', () => {
    arenaAutoCycle = false;
    const btn = document.getElementById('arena-auto-cycle-btn');
    if (btn) btn.textContent = '▶️ Auto-Cycle Loop: OFF';
    triggerArenaAction('move');
  });

  document.getElementById('arena-reset-party-btn')?.addEventListener('click', resetArenaParty);

  document.querySelectorAll('.arena-speed-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.arena-speed-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      arenaSpeed = parseFloat(e.target.dataset.speed) || 1.0;
    });
  });

  document.getElementById('arena-full-vfx-btn')?.addEventListener('click', () => {
    const m = getCurrentMonster();
    if (m) {
      window.open(buildTestSkillsUrl(m), '_blank');
    } else {
      window.open('test-skills.html', '_blank');
    }
  });

  /* ---------------- LIVE SPRITE & VISUAL EDITOR CONTROLS ---------------- */

  // Scale Controls
  const scaleSlider = document.getElementById('edit-scale-slider');
  const scaleNum = document.getElementById('edit-scale-num');

  scaleSlider?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (scaleNum) scaleNum.value = val.toFixed(2);
    applyLiveVisualEdit({ scale: val });
  });

  scaleNum?.addEventListener('change', (e) => {
    const val = Math.max(0.1, Math.min(4.0, parseFloat(e.target.value) || 1.0));
    if (scaleSlider) scaleSlider.value = val;
    applyLiveVisualEdit({ scale: val });
  });

  /* Horizontal flip. The engine treats sprite art as left-facing and mirrors it when
     a monster walks right, so art drawn facing right reads backwards forever. This
     stores a flipX flag on the monster rather than rewriting the PNG, keeping it
     reversible and shared by the dungeon renderer and this preview. */
  const flipToggle = document.getElementById('flip-x-toggle');
  flipToggle?.addEventListener('change', (e) => {
    applyLiveVisualEdit({ flipX: !!e.target.checked });
    updateFlipLabel(!!e.target.checked);
  });

  /* Bulk flip. Almost every sprite in the from-scratch batch was generated facing
     right, so flipping them one checkbox at a time would mean hundreds of clicks.
     Scope is whatever the list filters currently show, and it writes the same
     per-monster flag, so any individual monster can still be corrected after. */
  document.getElementById('flip-bulk-btn')?.addEventListener('click', () => {
    const targets = filteredMonsters.slice();
    if (!targets.length) return;
    const already = targets.filter(m => m.flipX).length;
    const turnOn = already < targets.length;
    const verb = turnOn ? 'Flip' : 'Un-flip';
    if (!confirm(`${verb} all ${targets.length} monsters currently listed?` +
                 (already ? `

${already} of them are already flipped.` : '') +
                 `

This edits the flipX flag only; remember to Save monsters.json afterwards.`)) return;
    targets.forEach(m => {
      if (!userEdits[m.id]) userEdits[m.id] = {};
      userEdits[m.id].flipX = turnOn;
      m.flipX = turnOn;
      m._isEdited = true;
    });
    saveUserEdits();
    renderMonsterList();
    const cur = getCurrentMonster();
    if (cur) {
      const el = document.getElementById('flip-x-toggle');
      if (el) el.checked = !!cur.flipX;
      updateFlipLabel(!!cur.flipX);
      updateSpriteDisplay();
    }
    showToast(`${verb}ped ${targets.length} monsters — save monsters.json to persist.`);
  });

  /* ---------------- GRANULAR COLOR BALANCE CONTROLS ---------------- */

  const cbChannels = [
    { id: 'cb-shadow-r', tone: 'shadows', channel: 'r', numId: 'cb-num-shadow-r' },
    { id: 'cb-shadow-g', tone: 'shadows', channel: 'g', numId: 'cb-num-shadow-g' },
    { id: 'cb-shadow-b', tone: 'shadows', channel: 'b', numId: 'cb-num-shadow-b' },
    { id: 'cb-midtone-r', tone: 'midtones', channel: 'r', numId: 'cb-num-midtone-r' },
    { id: 'cb-midtone-g', tone: 'midtones', channel: 'g', numId: 'cb-num-midtone-g' },
    { id: 'cb-midtone-b', tone: 'midtones', channel: 'b', numId: 'cb-num-midtone-b' },
    { id: 'cb-highlight-r', tone: 'highlights', channel: 'r', numId: 'cb-num-highlight-r' },
    { id: 'cb-highlight-g', tone: 'highlights', channel: 'g', numId: 'cb-num-highlight-g' },
    { id: 'cb-highlight-b', tone: 'highlights', channel: 'b', numId: 'cb-num-highlight-b' },
  ];

  cbChannels.forEach(ch => {
    const slider = document.getElementById(ch.id);
    const numEl = document.getElementById(ch.numId);
    slider?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (numEl) numEl.textContent = (val > 0 ? '+' : '') + val;
      updateColorBalanceFromUI();
    });
  });

  document.getElementById('cb-preserve-lum')?.addEventListener('change', updateColorBalanceFromUI);

  // Reset Tone Buttons
  document.getElementById('cb-reset-shadows-btn')?.addEventListener('click', () => {
    resetColorBalanceSection('shadows');
  });
  document.getElementById('cb-reset-midtones-btn')?.addEventListener('click', () => {
    resetColorBalanceSection('midtones');
  });
  document.getElementById('cb-reset-highlights-btn')?.addEventListener('click', () => {
    resetColorBalanceSection('highlights');
  });
  document.getElementById('cb-reset-all-btn')?.addEventListener('click', () => {
    resetColorBalanceSection('all');
  });

  // Sprite Path Input
  document.getElementById('edit-sprite-input')?.addEventListener('change', (e) => {
    const val = e.target.value.trim();
    if (val) {
      applyLiveVisualEdit({ sprite: val });
    }
  });

  // ---------------- Animated Sprite Atlas Editor ----------------
  const animFieldIds = [
    'anim-idle-enabled', 'anim-idle-sprite', 'anim-idle-fw', 'anim-idle-fh',
    'anim-idle-cols', 'anim-idle-rows', 'anim-idle-fps', 'anim-idle-frames', 'anim-idle-loop',
    'anim-attack-enabled', 'anim-attack-sprite', 'anim-attack-fw', 'anim-attack-fh',
    'anim-attack-cols', 'anim-attack-rows', 'anim-attack-fps', 'anim-attack-frames', 'anim-attack-loop'
  ];
  animFieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      syncAnimPanelToggles();
      applyAnimEdits();
      updateAnimPreview('idle');
      updateAnimPreview('attack');
    });
    if (el.type === 'number') {
      // live-preview while scrubbing numbers (persist happens on change)
      el.addEventListener('input', () => updateAnimPreview(el.id.split('-')[1]));
    }
  });

  document.getElementById('anim-remove-btn')?.addEventListener('click', () => {
    applyLiveVisualEdit({ animations: {} });
    const m = getCurrentMonster();
    if (m) populateAnimEditor(m);
    showToast("Removed animation config — falling back to the static sprite.");
  });

  // ---------------- Sprite Sheet Browser Modal ----------------
  document.querySelectorAll('.sheet-browse-btn').forEach(btn => {
    btn.addEventListener('click', () => openSheetPicker(btn.dataset.target));
  });
  document.getElementById('sheet-picker-close')?.addEventListener('click', closeSheetPicker);
  document.getElementById('sheet-picker-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'sheet-picker-modal') closeSheetPicker();
  });
  document.getElementById('sheet-picker-search')?.addEventListener('input', renderSheetGrid);

  // Speed & Threat Editors
  document.getElementById('edit-speed-slider')?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    const numEl = document.getElementById('edit-speed-num');
    if (numEl) numEl.value = val;
    applyLiveVisualEdit({ speed: val });
  });

  document.getElementById('edit-threat-input')?.addEventListener('change', (e) => {
    const val = parseInt(e.target.value, 10) || 10;
    applyLiveVisualEdit({ threat: val });
  });

  /* ---------------- STATBLOCK FORM EDITOR ---------------- */

  document.getElementById('save-stat-form-btn')?.addEventListener('click', () => {
    const m = getCurrentMonster();
    if (!m) return;

    const updated = {
      name: document.getElementById('edit-name')?.value.trim() || m.name,
      cr: parseFloat(document.getElementById('edit-cr')?.value || m.cr),
      type: document.getElementById('edit-type')?.value || m.type,
      size: document.getElementById('edit-size')?.value || m.size,
      ac: parseInt(document.getElementById('edit-ac')?.value, 10) ?? m.ac,
      atk: parseInt(document.getElementById('edit-atk')?.value, 10) ?? m.atk,
      xp: parseInt(document.getElementById('edit-xp')?.value, 10) ?? m.xp,
      hp: [
        parseInt(document.getElementById('edit-hp-count')?.value, 10) || 1,
        parseInt(document.getElementById('edit-hp-sides')?.value, 10) || 6,
        parseInt(document.getElementById('edit-hp-bonus')?.value, 10) || 0
      ],
      dmg: [
        parseInt(document.getElementById('edit-dmg-count')?.value, 10) || 1,
        parseInt(document.getElementById('edit-dmg-sides')?.value, 10) || 6,
        parseInt(document.getElementById('edit-dmg-bonus')?.value, 10) || 0
      ]
    };

    applyLiveVisualEdit(updated);
    showToast(`Saved statblock changes for ${updated.name}`);
  });

  document.getElementById('revert-monster-btn')?.addEventListener('click', () => {
    const m = getCurrentMonster();
    if (!m) return;
    delete userEdits[m.id];
    saveUserEdits();

    const idx = currentIndex;
    applyFilters();
    selectMonsterIndex(idx);
    showToast(`Reverted ${m.name} to default JSON values`);
  });

  document.getElementById('reset-all-edits-btn')?.addEventListener('click', () => {
    if (confirm("Reset ALL monster edits back to factory default?")) {
      userEdits = {};
      saveUserEdits();
      applyFilters();
      renderCurrentMonster();
      showToast("Reset all monster edits to default!");
    }
  });

  // Export / Save Complete Modified monsters.json File
  document.getElementById('export-monsters-json-btn')?.addEventListener('click', saveMonstersDirectly);

  // Custom Sprite File Upload & Tester
  document.getElementById('upload-sprite-btn')?.addEventListener('click', () => {
    document.getElementById('upload-sprite-file-input')?.click();
  });
  document.getElementById('upload-sprite-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) uploadCustomSprite(file);
  });

  document.getElementById('test-sprite-btn')?.addEventListener('click', () => {
    const input = document.getElementById('custom-sprite-input');
    if (input && input.value.trim()) {
      testSpriteOverride = input.value.trim();
      updateSpriteDisplay();
    }
  });

  document.getElementById('reset-sprite-btn')?.addEventListener('click', () => {
    testSpriteOverride = null;
    const input = document.getElementById('custom-sprite-input');
    if (input) input.value = '';
    updateSpriteDisplay();
  });

  document.getElementById('copy-json-btn')?.addEventListener('click', () => {
    const monster = getCurrentMonster();
    if (!monster) return;
    const spritePath = testSpriteOverride || monster.sprite;
    const jsonSnippet = `"sprite": "${spritePath}"`;
    navigator.clipboard.writeText(jsonSnippet).then(() => {
      showToast("Copied sprite JSON: " + jsonSnippet);
    });
  });

  document.getElementById('copy-anim-json-btn')?.addEventListener('click', () => {
    const monster = getCurrentMonster();
    if (!monster) return;
    const idle = readAnimPanel('idle');
    const attack = readAnimPanel('attack');
    const animations = {};
    if (idle) animations.idle = idle;
    if (attack) animations.attack = attack;
    if (!Object.keys(animations).length) {
      showToast("No animations configured for this monster yet.");
      return;
    }
    const jsonSnippet = `"animations": ${JSON.stringify(animations, null, 2).replace(/\n/g, '\n  ')}`;
    navigator.clipboard.writeText(jsonSnippet).then(() => {
      showToast("Copied animations JSON snippet");
    });
  });

  document.getElementById('copy-full-json-btn')?.addEventListener('click', () => {
    const monster = getCurrentMonster();
    if (!monster) return;
    const exportable = cleanMonsterForExport(monster);
    navigator.clipboard.writeText(JSON.stringify(exportable, null, 2)).then(() => {
      showToast("Copied full statblock JSON for " + monster.name);
    });
  });

  // CR Scaled Stats Toggle
  document.getElementById('cr-scaled-toggle')?.addEventListener('change', (e) => {
    showCRScaled = e.target.checked;
    renderMonsterStats();
  });

  // Flags & Notes
  document.getElementById('flag-redo')?.addEventListener('change', (e) => {
    const m = getCurrentMonster();
    if (!m) return;
    const flags = getMonsterFlags(m.id);
    flags.needsRedo = e.target.checked;
    saveFlags();
    updateMonsterListItem(m.id);
  });

  document.getElementById('flag-verified')?.addEventListener('change', (e) => {
    const m = getCurrentMonster();
    if (!m) return;
    const flags = getMonsterFlags(m.id);
    flags.verified = e.target.checked;
    saveFlags();
    updateMonsterListItem(m.id);
  });

  const notesArea = document.getElementById('monster-notes');
  if (notesArea) {
    let saveTimeout;
    notesArea.addEventListener('input', (e) => {
      const m = getCurrentMonster();
      if (!m) return;
      clearTimeout(saveTimeout);
      const indicator = document.getElementById('notes-save-indicator');
      if (indicator) indicator.textContent = 'Saving...';
      saveTimeout = setTimeout(() => {
        saveMonsterNote(m.id, e.target.value);
        if (indicator) indicator.textContent = 'Saved ✓';
        updateMonsterListItem(m.id);
      }, 400);
    });
  }

  document.getElementById('clear-notes-btn')?.addEventListener('click', () => {
    const m = getCurrentMonster();
    if (!m) return;
    const notesArea = document.getElementById('monster-notes');
    if (notesArea) notesArea.value = '';
    saveMonsterNote(m.id, '');
    const indicator = document.getElementById('notes-save-indicator');
    if (indicator) indicator.textContent = 'Cleared ✓';
    updateMonsterListItem(m.id);
  });

  // Data Export / Import
  document.getElementById('export-data-btn')?.addEventListener('click', exportData);
  document.getElementById('import-data-btn')?.addEventListener('click', () => {
    document.getElementById('import-file-input')?.click();
  });
  document.getElementById('import-file-input')?.addEventListener('change', importData);

  /* ---------------- SPAWNABLE DUNGEON TYPES ---------------- */

  const dungeonGrid = document.getElementById('dungeon-checkbox-grid');
  dungeonGrid?.addEventListener('change', (e) => {
    const cb = e.target;
    if (!cb.matches('input[type="checkbox"]')) return;
    cb.closest('.dungeon-chip')?.classList.toggle('on', cb.checked);
    applyDungeonSelection();
  });

  document.getElementById('dungeon-seed-btn')?.addEventListener('click', () => {
    const m = getCurrentMonster();
    if (!m) return;
    const derived = derivedDungeonsForMonster(m);
    dungeonGrid?.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      const on = derived.includes(cb.dataset.key);
      cb.checked = on;
      cb.closest('.dungeon-chip')?.classList.toggle('on', on);
    });
    applyDungeonSelection();
    showToast(`Seeded dungeon picks from ${m.name}'s creature-type family.`);
  });

  document.getElementById('dungeon-clear-btn')?.addEventListener('click', () => {
    const m = getCurrentMonster();
    if (!m) return;
    dungeonGrid?.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = false;
      cb.closest('.dungeon-chip')?.classList.remove('on');
    });
    applyDungeonSelection();
    showToast(`Cleared all dungeon spawns for ${m.name} — it will not appear in themed rooms.`);
  });

  document.getElementById('dungeon-bulk-seed-btn')?.addEventListener('click', () => {
    const unconfigured = allMonsters.filter(m => !Array.isArray(m.dungeons));
    if (unconfigured.length === 0) {
      showToast("Every creature already has explicit dungeon picks.");
      return;
    }
    if (!confirm(`Seed ${unconfigured.length} creature(s) that have no dungeon picks yet from their creature-type family? This writes an explicit list so they keep spawning where they already did.`)) return;
    for (const m of unconfigured) {
      if (!userEdits[m.id]) userEdits[m.id] = {};
      userEdits[m.id].dungeons = derivedDungeonsForMonster(m);
    }
    saveUserEdits();
    applyFilters();
    renderCurrentMonster();
    showToast(`Seeded ${unconfigured.length} creature(s) from their type family. Save to Codebase to persist.`);
  });
}

function updateColorBalanceFromUI() {
  const cb = {
    shadows: {
      r: parseInt(document.getElementById('cb-shadow-r')?.value || 0, 10),
      g: parseInt(document.getElementById('cb-shadow-g')?.value || 0, 10),
      b: parseInt(document.getElementById('cb-shadow-b')?.value || 0, 10),
    },
    midtones: {
      r: parseInt(document.getElementById('cb-midtone-r')?.value || 0, 10),
      g: parseInt(document.getElementById('cb-midtone-g')?.value || 0, 10),
      b: parseInt(document.getElementById('cb-midtone-b')?.value || 0, 10),
    },
    highlights: {
      r: parseInt(document.getElementById('cb-highlight-r')?.value || 0, 10),
      g: parseInt(document.getElementById('cb-highlight-g')?.value || 0, 10),
      b: parseInt(document.getElementById('cb-highlight-b')?.value || 0, 10),
    },
    preserveLuminosity: document.getElementById('cb-preserve-lum')?.checked ?? true
  };

  const representativeRgb = computeRepresentativeColorFromBalance(cb);
  const colorHexInt = rgbToHexInt(representativeRgb[0], representativeRgb[1], representativeRgb[2]);
  const hexStr = hexIntToHexStr(colorHexInt);

  const hexSummary = document.getElementById('cb-hex-summary');
  if (hexSummary) {
    hexSummary.textContent = `Tint Hex: ${hexStr} (${colorHexInt})`;
  }

  applyLiveVisualEdit({ colorBalance: cb, color: colorHexInt });
}

function resetColorBalanceSection(section) {
  if (section === 'shadows' || section === 'all') {
    setSliderVal('cb-shadow-r', 'cb-num-shadow-r', 0);
    setSliderVal('cb-shadow-g', 'cb-num-shadow-g', 0);
    setSliderVal('cb-shadow-b', 'cb-num-shadow-b', 0);
  }
  if (section === 'midtones' || section === 'all') {
    setSliderVal('cb-midtone-r', 'cb-num-midtone-r', 0);
    setSliderVal('cb-midtone-g', 'cb-num-midtone-g', 0);
    setSliderVal('cb-midtone-b', 'cb-num-midtone-b', 0);
  }
  if (section === 'highlights' || section === 'all') {
    setSliderVal('cb-highlight-r', 'cb-num-highlight-r', 0);
    setSliderVal('cb-highlight-g', 'cb-num-highlight-g', 0);
    setSliderVal('cb-highlight-b', 'cb-num-highlight-b', 0);
  }
  if (section === 'all') {
    const lumCb = document.getElementById('cb-preserve-lum');
    if (lumCb) lumCb.checked = true;
  }

  updateColorBalanceFromUI();
}

function setSliderVal(sliderId, numId, val) {
  const slider = document.getElementById(sliderId);
  const numEl = document.getElementById(numId);
  if (slider) slider.value = val;
  if (numEl) numEl.textContent = (val > 0 ? '+' : '') + val;
}

function computeRepresentativeColorFromBalance(cb) {
  return applyColorBalanceToPixel(128, 128, 128, cb);
}

function applyLiveVisualEdit(fields) {
  const m = getCurrentMonster();
  if (!m) return;

  if (!userEdits[m.id]) {
    userEdits[m.id] = {};
  }
  Object.assign(userEdits[m.id], fields);
  saveUserEdits();

  Object.assign(m, fields);
  m._isEdited = true;

  updateMonsterListItem(m.id);
  updateSpriteDisplay();
  renderMonsterStats();

  const nameEl = document.getElementById('detail-name');
  if (nameEl) nameEl.textContent = m.name;
}

/* ---------------- ANIMATED SPRITE ATLAS EDITOR ---------------- */

/* Parse a "Frames" text field into an ordered sheet-index array.
   Accepts ranges ("0-7"), comma/space lists ("0,2,4" / "1 3 5"), or a mix.
   Blank returns null → the whole sheet plays in order. */
function parseFramesInput(str) {
  const s = (str || '').trim();
  if (!s) return null;
  const parts = s.split(/[\s,;]+/).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(p);
    if (range) {
      const a = parseInt(range[1], 10);
      const b = parseInt(range[2], 10);
      const step = a <= b ? 1 : -1;
      for (let v = a; (step > 0 ? v <= b : v >= b); v += step) out.push(v);
    } else if (/^\d+$/.test(p)) {
      out.push(parseInt(p, 10));
    }
  }
  return out.length ? out : null;
}

/* Reverse: compact array → "0-7" when sequential, else a comma list. */
function framesToCompactString(frames) {
  if (!frames || !frames.length) return '';
  if (frames.length === 1) return String(frames[0]);
  let seq = true;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i] !== frames[i - 1] + 1) { seq = false; break; }
  }
  return seq ? `${frames[0]}-${frames[frames.length - 1]}` : frames.join(',');
}

/* Read one panel (idle | attack) into an animations config (or null when
   disabled). Fields only present when they differ from a plain default. */
function readAnimPanel(key) {
  const enabled = document.getElementById(`anim-${key}-enabled`)?.checked;
  if (!enabled) return null;
  const sprite = (document.getElementById(`anim-${key}-sprite`)?.value || '').trim();
  const frameWidth = parseInt(document.getElementById(`anim-${key}-fw`)?.value, 10) || 96;
  const frameHeight = parseInt(document.getElementById(`anim-${key}-fh`)?.value, 10) || 96;
  const cols = parseInt(document.getElementById(`anim-${key}-cols`)?.value, 10) || 8;
  const rows = parseInt(document.getElementById(`anim-${key}-rows`)?.value, 10) || 1;
  const fps = parseFloat(document.getElementById(`anim-${key}-fps`)?.value) || 8;
  const frames = parseFramesInput(document.getElementById(`anim-${key}-frames`)?.value);
  const loop = document.getElementById(`anim-${key}-loop`)?.checked ?? true;

  const cfg = {
    frameWidth: Math.max(1, frameWidth),
    frameHeight: Math.max(1, frameHeight),
    cols: Math.max(1, cols),
    rows: Math.max(1, rows),
    fps: Math.max(0.1, fps),
    loop
  };
  if (sprite) cfg.sprite = sprite;
  if (frames) cfg.frames = frames;
  return cfg;
}

/* Read both panels and persist the animations block via applyLiveVisualEdit. */
function applyAnimEdits() {
  const m = getCurrentMonster();
  if (!m) return;
  const animations = {};
  const idle = readAnimPanel('idle');
  const attack = readAnimPanel('attack');
  if (idle) animations.idle = idle;
  if (attack) animations.attack = attack;
  applyLiveVisualEdit({ animations });
}

/* Enable checkbox ↔ field enable/disable visual state + panel highlight. */
function syncAnimPanelToggles() {
  for (const key of ['idle', 'attack']) {
    const enabled = document.getElementById(`anim-${key}-enabled`)?.checked;
    const panel = document.getElementById(`anim-panel-${key}`);
    const fields = document.getElementById(`anim-${key}-fields`);
    if (panel) panel.classList.toggle('enabled', !!enabled);
    if (fields) fields.classList.toggle('disabled', !enabled);
  }
}

/* Populate the editor panels from the current monster's animations block. */
function populateAnimEditor(monster) {
  const anims = monster.animations || {};
  for (const key of ['idle', 'attack']) {
    const cfg = anims[key] || null;
    document.getElementById(`anim-${key}-enabled`).checked = !!cfg;
    document.getElementById(`anim-${key}-sprite`).value = (cfg && cfg.sprite) || '';
    document.getElementById(`anim-${key}-fw`).value = (cfg && cfg.frameWidth) || 96;
    document.getElementById(`anim-${key}-fh`).value = (cfg && cfg.frameHeight) || 96;
    document.getElementById(`anim-${key}-cols`).value = (cfg && cfg.cols) || (key === 'idle' ? 8 : 6);
    document.getElementById(`anim-${key}-rows`).value = (cfg && cfg.rows) || 1;
    document.getElementById(`anim-${key}-fps`).value = (cfg && cfg.fps) || (key === 'idle' ? 8 : 12);
    document.getElementById(`anim-${key}-frames`).value = framesToCompactString(cfg && cfg.frames);
    document.getElementById(`anim-${key}-loop`).checked = cfg ? cfg.loop !== false : key === 'idle';
  }
  syncAnimPanelToggles();
  updateAnimPreview('idle');
  updateAnimPreview('attack');
}

const animPreviewRAF = { idle: null, attack: null };

/* Live preview: plays one panel's atlas (with the monster's colour balance
   baked in) on its canvas, sat on a ground line. */
function updateAnimPreview(key) {
  cancelAnimationFrame(animPreviewRAF[key]);
  const canvas = document.getElementById(`anim-${key}-preview`);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const meta = document.getElementById(`anim-${key}-meta`);
  const monster = getCurrentMonster();

  /* Keep the drawing buffer in sync with the canvas's CSS size so the preview
     is never stretched/squished by layout — the frame math below uses the
     buffer dims, so if they lag the on-screen box the sprite gets distorted. */
  const syncCanvasSize = () => {
    const cw = canvas.clientWidth || 288;
    const ch = canvas.clientHeight || 176;
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
  };

  const drawEmpty = (msg) => {
    syncCanvasSize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0b0e1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#5a6279';
    ctx.font = '11px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(msg, canvas.width / 2, canvas.height / 2);
    if (meta) meta.textContent = '—';
  };

  if (!monster) { drawEmpty('Select a monster'); return; }

  const cfg = readAnimPanel(key);
  if (!cfg) { drawEmpty('Disabled'); return; }

  const path = cfg.sprite || monster.sprite || 'orc.png';
  const url = resolveSpriteUrl(path);
  const cb = monster.colorBalance || getDefaultColorBalance();

  loadBalancedCanvas(url, cb, (sheet) => {
    if (!sheet) { drawEmpty('Image not found'); return; }

    const cols = cfg.cols;
    const rows = cfg.rows;
    const fw = Math.max(1, Math.min(cfg.frameWidth, Math.floor(sheet.width / cols)));
    const fh = Math.max(1, Math.min(cfg.frameHeight, Math.floor(sheet.height / rows)));
    if (fw * cols > sheet.width || fh * rows > sheet.height) {
      drawEmpty(`Sheet smaller than ${cols}×${rows} × ${cfg.frameWidth}px frames`);
      return;
    }

    const seq = cfg.frames && cfg.frames.length ? cfg.frames : null;
    const count = seq ? seq.length : cols * rows;
    if (count <= 0) { drawEmpty('No frames'); return; }

    if (meta) {
      meta.textContent = `${count} frame${count === 1 ? '' : 's'} · ${sheet.width}×${sheet.height} sheet · ${fw}×${fh} cell`;
    }

    const start = performance.now();
    const step = (now) => {
      if (document.getElementById(`anim-${key}-enabled`)?.checked === false) {
        drawEmpty('Disabled');
        return;
      }
      const t = (now - start) / 1000;
      const idx = Math.floor(t * cfg.fps);
      let f;
      if (cfg.loop) {
        f = idx % count;
      } else if (idx >= count) {
        f = count - 1;
      } else {
        f = idx;
      }
      const fi = seq ? seq[f] : f;
      const col = fi % cols;
      const row = Math.floor(fi / cols);

      syncCanvasSize();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0b0e1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = 'rgba(217, 164, 65, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(8, canvas.height - 16);
      ctx.lineTo(canvas.width - 8, canvas.height - 16);
      ctx.stroke();
      ctx.setLineDash([]);

      const maxW = canvas.width - 24;
      const maxH = canvas.height - 44;
      const sc = Math.min(maxW / fw, maxH / fh);
      const dw = fw * sc;
      const dh = fh * sc;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sheet, col * fw, row * fh, fw, fh,
        (canvas.width - dw) / 2, (canvas.height - 16) - dh, dw, dh);

      animPreviewRAF[key] = requestAnimationFrame(step);
    };
    animPreviewRAF[key] = requestAnimationFrame(step);
  }, () => { drawEmpty('Image not found'); });
}

/* ---------------- SPRITE SHEET BROWSER ---------------- */

let SPRITE_SHEET_LIBRARY = null;   // cached disk listing from the dev server
let sheetPickerTarget = null;      // input id a picked sheet will fill

async function loadSpriteSheetLibrary() {
  if (SPRITE_SHEET_LIBRARY) return SPRITE_SHEET_LIBRARY;
  try {
    const res = await fetch('/api/list-sprite-sheets');
    const data = await res.json();
    if (data.success && data.files.length) SPRITE_SHEET_LIBRARY = data.files;
  } catch { /* static build — no disk listing */ }
  if (!SPRITE_SHEET_LIBRARY) SPRITE_SHEET_LIBRARY = [];
  return SPRITE_SHEET_LIBRARY;
}

function openSheetPicker(targetId) {
  sheetPickerTarget = targetId;
  const modal = document.getElementById('sheet-picker-modal');
  if (!modal) return;
  const search = document.getElementById('sheet-picker-search');
  if (search) search.value = '';
  modal.style.display = 'flex';
  renderSheetGrid();
  /* Swap the empty grid for the full library as soon as it arrives. */
  if (!SPRITE_SHEET_LIBRARY) loadSpriteSheetLibrary().then(renderSheetGrid);
}

function closeSheetPicker() {
  const modal = document.getElementById('sheet-picker-modal');
  if (modal) modal.style.display = 'none';
  sheetPickerTarget = null;
}

function renderSheetGrid() {
  const grid = document.getElementById('sheet-picker-grid');
  if (!grid) return;
  const query = (document.getElementById('sheet-picker-search')?.value || '').toLowerCase().trim();

  const all = SPRITE_SHEET_LIBRARY || [];
  const matched = all.filter(p => !query || p.toLowerCase().includes(query));
  /* ~1.5k DCSS monsters + uploads; render a page and let search narrow it. */
  const LIMIT = 300;
  const files = matched.slice(0, LIMIT);

  const count = document.getElementById('sheet-picker-count');
  if (count) {
    count.textContent = all.length === 0
      ? 'Run `npm run dev` to browse sheets from disk'
      : matched.length > LIMIT
        ? `Showing ${LIMIT} of ${matched.length} sheets — search to narrow`
        : `${matched.length} sheet${matched.length === 1 ? '' : 's'}`;
  }

  grid.innerHTML = '';
  files.forEach(p => {
    const item = document.createElement('div');
    item.className = 'sheet-grid-item';
    item.title = p;
    item.innerHTML = `<img src="./${p}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><span class="sheet-name">${p}</span>`;
    /* Wide sheets (many frames on one row) span extra columns so the strip is
       big enough to identify, instead of a squashed sliver in a square tile. */
    const img = item.querySelector('img');
    if (img) {
      const spanForRatio = () => {
        const w = img.naturalWidth || 0;
        const h = img.naturalHeight || 0;
        if (!w || !h) return;
        const ratio = w / h;
        if (ratio > 3.5) item.classList.add('sheet-grid-item--span3');
        else if (ratio > 1.8) item.classList.add('sheet-grid-item--span2');
      };
      if (img.complete) spanForRatio();
      else img.addEventListener('load', spanForRatio);
    }
    item.addEventListener('click', () => {
      const target = document.getElementById(sheetPickerTarget);
      if (target) {
        target.value = p;
        if (sheetPickerTarget === 'custom-sprite-input') {
          testSpriteOverride = p;
          updateSpriteDisplay();
        } else {
          /* let the input's own change handler persist + refresh */
          target.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      closeSheetPicker();
    });
    grid.appendChild(item);
  });
}

function setupKeyboardNavigation() {
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      return;
    }
    // Monster stepping only makes sense while the bestiary tab is showing.
    if (activeTab !== 'bestiary' && !arenaActive) return;
    if (e.key === 'Escape' && arenaActive) {
      closeArenaModal();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      navigate(-1);
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      navigate(1);
    } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      navigate(-1);
    } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
      e.preventDefault();
      navigate(1);
    }
  });
}

function applyFilters() {
  const searchTerm = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
  const tierVal = document.getElementById('tier-filter')?.value || 'all';
  const typeVal = document.getElementById('type-filter')?.value || 'all';
  const crVal = document.getElementById('cr-filter')?.value || 'all';
  const statusVal = document.getElementById('status-filter')?.value || 'all';
  const sortBy = document.getElementById('sort-by')?.value || 'name-asc';

  filteredMonsters = allMonsters.filter(m => {
    if (searchTerm) {
      const matchName = m.name.toLowerCase().includes(searchTerm);
      const matchId = m.id.toLowerCase().includes(searchTerm);
      const matchType = (m.type || '').toLowerCase().includes(searchTerm);
      const matchTag = (m.tags || []).some(t => t.toLowerCase().includes(searchTerm));
      const matchNote = getMonsterNote(m.id).toLowerCase().includes(searchTerm);
      if (!matchName && !matchId && !matchType && !matchTag && !matchNote) return false;
    }

    if (tierVal !== 'all') {
      /* Tier filter selects CR bands (option value 1-5 -> band 0-4). */
      if (String(crBandIndex(m.cr)) !== String(Number(tierVal) - 1)) return false;
    }

    if (typeVal !== 'all' && m.type !== typeVal) return false;

    if (crVal !== 'all') {
      const cr = m.cr || 0;
      if (crVal === '0-0.5' && (cr < 0 || cr > 0.5)) return false;
      if (crVal === '1-4' && (cr < 1 || cr > 4)) return false;
      if (crVal === '5-10' && (cr < 5 || cr > 10)) return false;
      if (crVal === '11+' && cr < 11) return false;
    }

    if (statusVal !== 'all') {
      const flags = getMonsterFlags(m.id);
      const note = getMonsterNote(m.id);
      if (statusVal === 'edited' && !m._isEdited) return false;
      if (statusVal === 'redo' && !flags.needsRedo) return false;
      if (statusVal === 'verified' && !flags.verified) return false;
      if (statusVal === 'notes' && (!note || !note.trim())) return false;
      if (statusVal === 'unverified' && flags.verified) return false;
    }

    return true;
  });

  filteredMonsters.sort((a, b) => {
    if (sortBy === 'name-asc') return a.name.localeCompare(b.name);
    if (sortBy === 'name-desc') return b.name.localeCompare(a.name);
    if (sortBy === 'cr-asc') return (a.cr || 0) - (b.cr || 0);
    if (sortBy === 'cr-desc') return (b.cr || 0) - (a.cr || 0);
    if (sortBy === 'threat-desc') return (b.threat || 0) - (a.threat || 0);
    if (sortBy === 'tier-asc') return crBandIndex(a.cr) - crBandIndex(b.cr) || (a.cr||0) - (b.cr||0);
    return 0;
  });

  currentIndex = 0;
  renderMonsterList();
  renderCurrentMonster();
}

/* Inner markup for a monster list thumbnail. Monsters with an animation block
   often point `sprite` at a spritesheet, so drawing it whole gives a strip of
   specks — crop to the first frame of the idle (or attack) atlas instead, and
   flag the entry as animated. */
const THUMB_BOX = 58;

function monsterThumbInnerHTML(m) {
  const anim = (m.animations && (m.animations.idle || m.animations.attack)) || null;

  if (!anim) {
    return `<img src="${resolveSpriteUrl(m.sprite)}" alt="${m.name}" loading="lazy"${m.flipX ? ' style="transform:scaleX(-1)"' : ''} onerror="this.src='./dcss/monster/orc.png'">`;
  }

  const fw = Math.max(1, anim.frameWidth || 96);
  const fh = Math.max(1, anim.frameHeight || 96);
  const cols = Math.max(1, anim.cols || 1);
  const rows = Math.max(1, anim.rows || 1);
  const first = Array.isArray(anim.frames) && anim.frames.length ? anim.frames[0] : 0;
  const col = first % cols;
  const row = Math.floor(first / cols) % rows;
  const s = THUMB_BOX / Math.max(fw, fh);
  const flip = m.flipX ? ' scaleX(-1)' : '';
  const fallback = "this.onerror=null;this.removeAttribute('style');this.parentElement.removeAttribute('style');this.src='./dcss/monster/orc.png'";

  return `
        <div class="monster-item-frame" style="width:${fw * s}px;height:${fh * s}px;transform:none${flip}">
          <img src="${resolveSpriteUrl(anim.sprite || m.sprite)}" alt="${m.name}" loading="lazy"
               style="width:${cols * fw * s}px;height:${rows * fh * s}px;margin-left:${-col * fw * s}px;margin-top:${-row * fh * s}px"
               onerror="${fallback}">
        </div>
        <span class="monster-item-anim" title="Has animated sprite">▶</span>`;
}

function renderMonsterList() {
  const listContainer = document.getElementById('monster-list');
  const countLabel = document.getElementById('monster-count-label');
  if (!listContainer) return;

  if (countLabel) {
    countLabel.textContent = `Showing ${filteredMonsters.length} of ${allMonsters.length}`;
  }

  if (filteredMonsters.length === 0) {
    listContainer.innerHTML = '<div class="no-results">No monsters match criteria</div>';
    return;
  }

  listContainer.innerHTML = filteredMonsters.map((m, idx) => {
    const isSelected = idx === currentIndex;
    const flags = getMonsterFlags(m.id);
    const note = getMonsterNote(m.id);

    const badges = [];
    if (m._isEdited) badges.push('<span class="mini-tag tag-edited" title="Custom Edit Saved">✏️ Edit</span>');
    if (flags.needsRedo) badges.push('<span class="mini-tag tag-redo" title="Needs Sprite Redo">🎨 Redo</span>');
    if (flags.verified) badges.push('<span class="mini-tag tag-verified" title="Abilities Verified">✅ Verified</span>');
    if (note && note.trim()) badges.push('<span class="mini-tag tag-note" title="Has Notes">📝 Note</span>');

    const hexColor = hexIntToHexStr(m.color);

    return `
      <div class="monster-item ${isSelected ? 'selected' : ''}" data-index="${idx}" data-id="${m.id}">
        <div class="monster-item-thumb${m.animations && (m.animations.idle || m.animations.attack) ? ' has-anim' : ''}" style="border-color: ${hexColor}">
          ${monsterThumbInnerHTML(m)}
        </div>
        <div class="monster-item-info">
          <div class="monster-item-name">${m.name}</div>
          <div class="monster-item-sub">
            <span class="cr-pill">CR ${formatCR(m.cr)}</span>
            <span class="type-pill">${m.type || 'creature'}</span>
          </div>
          ${badges.length ? `<div class="monster-item-badges">${badges.join('')}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  listContainer.querySelectorAll('.monster-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.index, 10);
      selectMonsterIndex(idx);
    });
  });

  scrollToSelectedListItem();
}

function scrollToSelectedListItem() {
  const selectedEl = document.querySelector('.monster-item.selected');
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function updateMonsterListItem(id) {
  const m = allMonsters.find(it => it.id === id);
  const el = document.querySelector(`.monster-item[data-id="${id}"]`);
  if (!el || !m) return;
  const flags = getMonsterFlags(id);
  const note = getMonsterNote(id);
  const badges = [];

  if (m._isEdited) badges.push('<span class="mini-tag tag-edited" title="Custom Edit Saved">✏️ Edit</span>');
  if (flags.needsRedo) badges.push('<span class="mini-tag tag-redo" title="Needs Sprite Redo">🎨 Redo</span>');
  if (flags.verified) badges.push('<span class="mini-tag tag-verified" title="Abilities Verified">✅ Verified</span>');
  if (note && note.trim()) badges.push('<span class="mini-tag tag-note" title="Has Notes">📝 Note</span>');

  const nameEl = el.querySelector('.monster-item-name');
  if (nameEl) nameEl.textContent = m.name;

  const thumbEl = el.querySelector('.monster-item-thumb');
  if (thumbEl) {
    thumbEl.style.borderColor = hexIntToHexStr(m.color);
    thumbEl.classList.toggle('has-anim', !!(m.animations && (m.animations.idle || m.animations.attack)));
    thumbEl.innerHTML = monsterThumbInnerHTML(m);
  }

  let badgeContainer = el.querySelector('.monster-item-badges');
  if (badges.length) {
    if (!badgeContainer) {
      badgeContainer = document.createElement('div');
      badgeContainer.className = 'monster-item-badges';
      el.querySelector('.monster-item-info').appendChild(badgeContainer);
    }
    badgeContainer.innerHTML = badges.join('');
  } else if (badgeContainer) {
    badgeContainer.remove();
  }
}

function navigate(delta) {
  if (filteredMonsters.length === 0) return;
  let newIdx = currentIndex + delta;
  if (newIdx < 0) newIdx = filteredMonsters.length - 1;
  if (newIdx >= filteredMonsters.length) newIdx = 0;
  selectMonsterIndex(newIdx);
}

function selectMonsterIndex(idx) {
  currentIndex = idx;
  testSpriteOverride = null;
  const input = document.getElementById('custom-sprite-input');
  if (input) input.value = '';

  document.querySelectorAll('.monster-item').forEach((el, i) => {
    if (i === idx) el.classList.add('selected');
    else el.classList.remove('selected');
  });

  renderCurrentMonster();
  scrollToSelectedListItem();
}

function getCurrentMonster() {
  if (filteredMonsters.length === 0) return null;
  return filteredMonsters[currentIndex] || filteredMonsters[0];
}

function renderCurrentMonster() {
  const monster = getCurrentMonster();
  if (!monster) return;

  const flags = getMonsterFlags(monster.id);
  const note = getMonsterNote(monster.id);

  // Update Header Elements
  const nameEl = document.getElementById('detail-name');
  if (nameEl) nameEl.textContent = monster.name;

  const idTagEl = document.getElementById('detail-id');
  if (idTagEl) idTagEl.textContent = monster.id;

  const metaEl = document.getElementById('detail-meta-badges');
  if (metaEl) {
    metaEl.innerHTML = `
      <span class="meta-badge badge-cr">CR ${formatCR(monster.cr)}</span>
      <span class="meta-badge badge-type">${(monster.size || 'medium').toUpperCase()} ${(monster.type || 'creature').toUpperCase()}</span>
      ${monster.tags && monster.tags.length ? monster.tags.map(t => `<span class="meta-badge badge-tag">${t}</span>`).join('') : ''}
      ${monster._isEdited ? '<span class="meta-badge badge-edited">✏️ MODIFIED</span>' : ''}
    `;
  }

  // Update Checkboxes
  const redoCb = document.getElementById('flag-redo');
  if (redoCb) redoCb.checked = !!flags.needsRedo;

  const verifiedCb = document.getElementById('flag-verified');
  if (verifiedCb) verifiedCb.checked = !!flags.verified;

  // Update Notes Area
  const notesArea = document.getElementById('monster-notes');
  if (notesArea) notesArea.value = note;
  const indicator = document.getElementById('notes-save-indicator');
  if (indicator) indicator.textContent = note ? 'Saved ✓' : '';

  // Populate Live Editor Form Controls
  populateEditorFormControls(monster);

  // Update Sprite & Stats View
  updateSpriteDisplay();
  renderMonsterStats();
  renderMonsterAbilities();
}

function populateEditorFormControls(monster) {
  // Scale
  const scaleSlider = document.getElementById('edit-scale-slider');
  const scaleNum = document.getElementById('edit-scale-num');
  const sc = monster.scale ?? 1.0;
  if (scaleSlider) scaleSlider.value = sc;
  if (scaleNum) scaleNum.value = sc.toFixed(2);

  // Y-Offset
  const yOffsetSlider = document.getElementById('edit-y-offset-slider');
  const yOffsetNum = document.getElementById('edit-y-offset-num');
  const yo = monster.yOffset ?? 0;
  currentYOffset = yo;
  if (yOffsetSlider) yOffsetSlider.value = yo;
  if (yOffsetNum) yOffsetNum.value = yo;
  const label = document.getElementById('y-offset-val-label');
  if (label) label.textContent = yo + 'px';

  // Color Balance Controls (Shadows, Midtones, Highlights)
  const cb = monster.colorBalance || getDefaultColorBalance();
  populateColorBalanceUI(cb, monster.color);

  // Sprite Path
  const spriteInput = document.getElementById('edit-sprite-input');
  if (spriteInput) spriteInput.value = monster.sprite || '';

  // Facing
  const flipEl = document.getElementById('flip-x-toggle');
  if (flipEl) flipEl.checked = !!monster.flipX;
  updateFlipLabel(!!monster.flipX);

  // Speed & Threat
  const speedSlider = document.getElementById('edit-speed-slider');
  const speedNum = document.getElementById('edit-speed-num');
  const spd = monster.speed ?? 3;
  if (speedSlider) speedSlider.value = spd;
  if (speedNum) speedNum.value = spd;

  const threatInput = document.getElementById('edit-threat-input');
  if (threatInput) threatInput.value = monster.threat ?? 10;

  // Statblock Form
  const editName = document.getElementById('edit-name');
  if (editName) editName.value = monster.name || '';

  const editCr = document.getElementById('edit-cr');
  if (editCr) editCr.value = monster.cr ?? 0.25;

  const editType = document.getElementById('edit-type');
  if (editType) editType.value = monster.type || 'beast';

  const editSize = document.getElementById('edit-size');
  if (editSize) editSize.value = monster.size || 'medium';

  const editAc = document.getElementById('edit-ac');
  if (editAc) editAc.value = monster.ac ?? 12;

  const editAtk = document.getElementById('edit-atk');
  if (editAtk) editAtk.value = monster.atk ?? 4;

  const editXp = document.getElementById('edit-xp');
  if (editXp) editXp.value = monster.xp ?? 50;

  // HP
  const hp = monster.hp || [2, 6, 2];
  document.getElementById('edit-hp-count').value = hp[0] ?? 1;
  document.getElementById('edit-hp-sides').value = hp[1] ?? 6;
  document.getElementById('edit-hp-bonus').value = hp[2] ?? 0;

  // Damage
  const dmg = monster.dmg || [1, 6, 2];
  document.getElementById('edit-dmg-count').value = dmg[0] ?? 1;
  document.getElementById('edit-dmg-sides').value = dmg[1] ?? 6;
  document.getElementById('edit-dmg-bonus').value = dmg[2] ?? 0;

  // Spawnable Dungeon Types
  populateDungeonGrid(monster);

  // Animated Sprite Atlas Editor
  populateAnimEditor(monster);
}

function populateColorBalanceUI(cb, colorHexInt) {
  setSliderVal('cb-shadow-r', 'cb-num-shadow-r', cb.shadows?.r ?? 0);
  setSliderVal('cb-shadow-g', 'cb-num-shadow-g', cb.shadows?.g ?? 0);
  setSliderVal('cb-shadow-b', 'cb-num-shadow-b', cb.shadows?.b ?? 0);

  setSliderVal('cb-midtone-r', 'cb-num-midtone-r', cb.midtones?.r ?? 0);
  setSliderVal('cb-midtone-g', 'cb-num-midtone-g', cb.midtones?.g ?? 0);
  setSliderVal('cb-midtone-b', 'cb-num-midtone-b', cb.midtones?.b ?? 0);

  setSliderVal('cb-highlight-r', 'cb-num-highlight-r', cb.highlights?.r ?? 0);
  setSliderVal('cb-highlight-g', 'cb-num-highlight-g', cb.highlights?.g ?? 0);
  setSliderVal('cb-highlight-b', 'cb-num-highlight-b', cb.highlights?.b ?? 0);

  const lumCb = document.getElementById('cb-preserve-lum');
  if (lumCb) lumCb.checked = cb.preserveLuminosity ?? true;

  const hexStr = hexIntToHexStr(colorHexInt ?? 0x888888);
  const hexSummary = document.getElementById('cb-hex-summary');
  if (hexSummary) hexSummary.textContent = `Tint Hex: ${hexStr}`;
}

/* ---------------- CANVAS SPRITE RECOLOR & VIEWPORT ---------------- */

function updateFlipLabel(flipped) {
  const el = document.getElementById('flip-x-label');
  if (el) el.textContent = flipped ? 'flipped — art faces right' : 'art faces left';
}

function updateSpriteDisplay() {
  const monster = getCurrentMonster();
  if (!monster) return;

  const activeSpritePath = testSpriteOverride || monster.sprite;
  const spriteUrl = resolveSpriteUrl(activeSpritePath);

  const pathLabel = document.getElementById('sprite-path-label');
  const scaleLabel = document.getElementById('sprite-scale-label');
  const dimLabel = document.getElementById('sprite-dim-label');

  if (pathLabel) pathLabel.textContent = activeSpritePath;
  if (scaleLabel) scaleLabel.textContent = (monster.scale || 1.0).toFixed(2) + 'x';

  const cb = monster.colorBalance || getDefaultColorBalance();

  renderSpriteCanvas(spriteUrl, cb, monster.color, monster.scale || 1.0, currentZoom, (w, h, err) => {
    if (dimLabel) {
      if (err) dimLabel.textContent = `Image Not Found`;
      else dimLabel.textContent = `${w} × ${h} px (Native)`;
    }
  }, !!monster.flipX);
}

const imageCache = {};

function renderSpriteCanvas(src, colorBalance, fallbackColorInt, scaleMultiplier, zoomFactor, callback, flipX = false) {
  const canvas = document.getElementById('sprite-viewport-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const drawFallback = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (callback) callback(0, 0, true);
  };

  const processAndDraw = (img) => {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    if (!w || !h) {
      drawFallback();
      return;
    }

    canvas.width = canvas.parentElement.clientWidth || 800;
    canvas.height = canvas.parentElement.clientHeight || 660;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;

    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const octx = offscreen.getContext('2d');
    octx.imageSmoothingEnabled = false;
    octx.drawImage(img, 0, 0);

    let monsterBounds = { top: 0, bottom: h - 1, left: 0, right: w - 1, contentWidth: w, contentHeight: h, bottomPadding: 0, topPadding: 0 };
    const cb = colorBalance || getDefaultColorBalance();

    try {
      const imgData = octx.getImageData(0, 0, w, h);
      const data = imgData.data;

      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a < 10) continue;

        const [nr, ng, nb] = applyColorBalanceToPixel(data[i], data[i + 1], data[i + 2], cb);
        data[i] = nr;
        data[i + 1] = ng;
        data[i + 2] = nb;
      }
      octx.putImageData(imgData, 0, 0);
      monsterBounds = getPixelBounds(imgData, w, h);
    } catch (e) {
      console.warn("Could not process pixel data for recoloring/bounds", e);
    }

    /* Mirror the working buffer so every downstream draw uses the flipped art.
       Done after getPixelBounds because that only feeds ground-snapping and content
       size, which a horizontal mirror does not change. */
    if (flipX) {
      const flipped = document.createElement('canvas');
      flipped.width = w;
      flipped.height = h;
      const fctx = flipped.getContext('2d');
      fctx.imageSmoothingEnabled = false;
      fctx.translate(w, 0);
      fctx.scale(-1, 1);
      fctx.drawImage(offscreen, 0, 0);
      octx.clearRect(0, 0, w, h);
      octx.drawImage(flipped, 0, 0);
    }

    const groundY = Math.floor(canvas.height * 0.78);
    const heroDefs = getRaceDefaults(heroRefRace);
    const heroScaleX = heroDefs.spriteScaleX || 1.0;
    const heroScaleY = heroDefs.spriteScaleY || 1.0;
    const yOffset = currentYOffset || 0;

    // Auto-Fit Zoom Calculation
    let effectiveZoom = zoomFactor;
    if (autoFitZoom) {
      const paddingX = 60;
      const paddingY = 80;

      const maxCanvasW = canvas.width - paddingX;
      const maxCanvasH = canvas.height - paddingY;

      const heroUnscaledW = 32 * heroScaleX;
      const heroUnscaledH = 32 * heroScaleY;

      const monsterUnscaledW = (snapToGround ? monsterBounds.contentWidth : w) * scaleMultiplier;
      const monsterUnscaledH = (snapToGround ? monsterBounds.contentHeight : h) * scaleMultiplier;

      const gap = 32;
      const neededW = showHeroRef ? (heroUnscaledW + monsterUnscaledW + gap) : monsterUnscaledW;
      const neededH = showHeroRef ? Math.max(heroUnscaledH, monsterUnscaledH) : monsterUnscaledH;

      const maxFitZoomW = maxCanvasW / (neededW || 1);
      const maxFitZoomH = maxCanvasH / (neededH || 1);

      effectiveZoom = Math.min(zoomFactor, maxFitZoomW, maxFitZoomH);
      effectiveZoom = Math.max(0.5, effectiveZoom);
    }

    // Draw Ground Line
    ctx.strokeStyle = 'rgba(217, 164, 65, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(15, groundY);
    ctx.lineTo(canvas.width - 15, groundY);
    ctx.stroke();
    ctx.setLineDash([]);

    if (showHeroRef) {
      const drawBoth = (heroImg) => {
        const heroW = heroImg.naturalWidth || heroImg.width || HERO_FRAME_PX;
        const heroH = heroImg.naturalHeight || heroImg.height || HERO_FRAME_PX;

        let heroBottomPadding = 0;
        try {
          const hoctx = document.createElement('canvas').getContext('2d');
          hoctx.canvas.width = heroW;
          hoctx.canvas.height = heroH;
          hoctx.drawImage(heroImg, 0, 0);
          const hdata = hoctx.getImageData(0, 0, heroW, heroH);
          const hbounds = getPixelBounds(hdata, heroW, heroH);
          heroBottomPadding = hbounds.bottomPadding;
        } catch (e) {
          heroBottomPadding = 0;
        }

        const heroDisplayW = heroW * HERO_FRAME_TO_PX * effectiveZoom * heroScaleX;
        const heroDisplayH = heroH * HERO_FRAME_TO_PX * effectiveZoom * heroScaleY;
        const heroBottomPadDisp = heroBottomPadding * HERO_FRAME_TO_PX * effectiveZoom * heroScaleY;

        const monsterDisplayW = w * effectiveZoom * scaleMultiplier;
        const monsterDisplayH = h * effectiveZoom * scaleMultiplier;
        const monsterBottomPadDisp = (snapToGround ? monsterBounds.bottomPadding : 0) * effectiveZoom * scaleMultiplier;
        const monsterYOffsetDisp = yOffset * effectiveZoom * 0.5;

        const gap = 32;
        const totalW = heroDisplayW + monsterDisplayW + gap;
        const startX = Math.max(20, (canvas.width - totalW) / 2);

        const heroX = startX;
        const heroY = groundY - heroDisplayH + heroBottomPadDisp;

        const monsterX = startX + heroDisplayW + gap;
        const monsterY = groundY - monsterDisplayH + monsterBottomPadDisp - monsterYOffsetDisp;

        // Draw Hero Sprite
        ctx.drawImage(heroImg, heroX, heroY, heroDisplayW, heroDisplayH);

        // Hero Tag & Badge
        ctx.fillStyle = '#60a5fa';
        ctx.font = 'bold 11px Outfit, sans-serif';
        ctx.textAlign = 'center';
        const heroScaleLabel = heroScaleX === heroScaleY
          ? `${heroScaleY.toFixed(2)}x`
          : `${heroScaleX.toFixed(2)}×${heroScaleY.toFixed(2)}`;
        ctx.fillText(`🧍 ${heroRaceLabel(heroRefRace)} (${heroScaleLabel})`, heroX + heroDisplayW / 2, Math.max(20, heroY - 8));

        // Draw Monster Sprite
        ctx.drawImage(offscreen, monsterX, monsterY, monsterDisplayW, monsterDisplayH);

        // Monster Tag & Badge
        ctx.fillStyle = '#fcd34d';
        ctx.fillText(`👾 Monster (${scaleMultiplier.toFixed(2)}x)`, monsterX + monsterDisplayW / 2, Math.max(20, monsterY - 8));
      };

      const heroCanvas = getHeroRefCanvas(heroRefRace, () => updateSpriteDisplay());
      if (heroCanvas._ready) {
        drawBoth(heroCanvas);
      } else {
        /* Portrait layers still loading — draw the monster alone this pass; the
           onReady callback above re-runs the display once it has composed. */
        {
          const displayW = w * effectiveZoom * scaleMultiplier;
          const displayH = h * effectiveZoom * scaleMultiplier;
          const bottomPad = (snapToGround ? monsterBounds.bottomPadding : 0) * effectiveZoom * scaleMultiplier;
          const monsterYOffsetDisp = yOffset * effectiveZoom * 0.5;
          ctx.drawImage(offscreen, (canvas.width - displayW) / 2, groundY - displayH + bottomPad - monsterYOffsetDisp, displayW, displayH);
        }
      }
    } else {
      // Draw Monster Alone
      const displayW = w * effectiveZoom * scaleMultiplier;
      const displayH = h * effectiveZoom * scaleMultiplier;
      const bottomPad = (snapToGround ? monsterBounds.bottomPadding : 0) * effectiveZoom * scaleMultiplier;
      const monsterYOffsetDisp = yOffset * effectiveZoom * 0.5;

      const x = (canvas.width - displayW) / 2;
      const y = groundY - displayH + bottomPad - monsterYOffsetDisp;

      ctx.drawImage(offscreen, x, y, displayW, displayH);

      ctx.fillStyle = '#fcd34d';
      ctx.font = 'bold 11px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`👾 Monster (${scaleMultiplier.toFixed(2)}x)`, canvas.width / 2, Math.max(20, y - 8));
    }

    if (callback) callback(w, h, false);
  };

  if (imageCache[src]) {
    processAndDraw(imageCache[src]);
    return;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    imageCache[src] = img;
    processAndDraw(img);
  };
  img.onerror = drawFallback;
  img.src = src;
}

function getPixelBounds(imgData, w, h) {
  let top = h, bottom = -1, left = w, right = -1;
  const data = imgData.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const alpha = data[(y * w + x) * 4 + 3];
      if (alpha > 15) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }

  if (bottom === -1) {
    return { top: 0, bottom: h - 1, left: 0, right: w - 1, contentWidth: w, contentHeight: h, bottomPadding: 0, topPadding: 0 };
  }

  return {
    top,
    bottom,
    left,
    right,
    contentWidth: right - left + 1,
    contentHeight: bottom - top + 1,
    bottomPadding: h - 1 - bottom,
    topPadding: top
  };
}

/* ---------------- LIVE EXPANDED DUNGEON COMBAT ROOM ARENA SIMULATOR ---------------- */
let arenaActive = false;
let arenaAnimFrame = null;
let arenaAutoCycle = true;
let arenaSpeed = 1.0;
let arenaPhaseTimer = 0;
let arenaCurrentPhase = 0; // 0: Idle, 1: Walk/Move, 2: Melee Attack, 3: Fire Breath / Ability
let arenaBannerText = 'Action: Idle Stance';
let arenaTheme = 'ancient';
let arenaProps = []; // Generated scatter terrain props

const ARENA_THEME_PALETTES = {
  ancient: {
    floor: '#0c0f1d',
    tileGrid: 'rgba(255, 255, 255, 0.05)',
    wall: '#171c2f',
    wallTop: '#252d47',
    torchGlow: 'rgba(245, 158, 11, 0.22)',
    pillar: '#222942',
    propBorder: '#384366'
  },
  necropolis: {
    floor: '#071018',
    tileGrid: 'rgba(56, 189, 248, 0.06)',
    wall: '#0f1d2c',
    wallTop: '#193047',
    torchGlow: 'rgba(34, 211, 238, 0.25)',
    pillar: '#17283c',
    propBorder: '#1e3e5c'
  },
  inferno: {
    floor: '#160a0a',
    tileGrid: 'rgba(239, 68, 68, 0.07)',
    wall: '#281212',
    wallTop: '#3e1c1c',
    torchGlow: 'rgba(249, 115, 22, 0.3)',
    pillar: '#301616',
    propBorder: '#542020'
  },
  overgrown: {
    floor: '#09140c',
    tileGrid: 'rgba(34, 197, 94, 0.06)',
    wall: '#122416',
    wallTop: '#1e3b24',
    torchGlow: 'rgba(132, 204, 22, 0.22)',
    pillar: '#19331e',
    propBorder: '#294f30'
  }
};

let arenaMonsterPos = { x: 750, y: 320, targetX: 750, targetY: 320, vx: 0, vy: 0 };
let arenaMonsterScale = 1.0;
let arenaMonsterRecolored = null;
let arenaMonsterName = '';

let arenaParty = [
  { name: 'Fighter', icon: '🛡️', color: '#38bdf8', sprite: 'human.png', x: 220, y: 260, hp: 65, maxHp: 65 },
  { name: 'Rogue', icon: '🗡️', color: '#10b981', sprite: 'elf.png', x: 260, y: 380, hp: 45, maxHp: 45 },
  { name: 'Cleric', icon: '✨', color: '#f59e0b', sprite: 'dwarf.png', x: 140, y: 320, hp: 55, maxHp: 55 },
  { name: 'Wizard', icon: '🔥', color: '#c084fc', sprite: 'human.png', x: 100, y: 200, hp: 38, maxHp: 38 }
];

let arenaParticles = [];
let arenaFloaters = [];
let arenaShake = 0;

function generateArenaTerrainProps(w, h) {
  arenaProps = [];
  const minX = 140, maxX = w - 140;
  const minY = 100, maxY = h - 100;

  // Add 4 Stone Pillars in room corners / tactical positions
  arenaProps.push({ type: 'pillar', x: minX + 80, y: minY + 60, r: 22 });
  arenaProps.push({ type: 'pillar', x: maxX - 80, y: minY + 60, r: 22 });
  arenaProps.push({ type: 'pillar', x: minX + 80, y: maxY - 60, r: 22 });
  arenaProps.push({ type: 'pillar', x: maxX - 80, y: maxY - 60, r: 22 });

  // Add Scatter Props (Crates, Barrels, Treasure Chests, Urns)
  const types = ['crate', 'barrel', 'barrel', 'chest', 'urn', 'crate', 'urn'];
  for (let i = 0; i < 7; i++) {
    const px = Math.floor(Math.random() * (maxX - minX - 220)) + minX + 110;
    const py = Math.floor(Math.random() * (maxY - minY - 100)) + minY + 50;
    const pType = types[i % types.length];

    if (Math.abs(px - (w - 250)) < 110 && Math.abs(py - (h / 2)) < 110) continue;

    arenaProps.push({ type: pType, x: px, y: py, w: 28, h: 28 });
  }
}

/* Build the test-skills arena URL for a monster. Carries the editor's LIVE
   `animations` block (idle/attack atlas configs) so the preview animates
   exactly as configured, without depending on the iframe's localStorage
   copy of monsters.json catching up. */
function buildTestSkillsUrl(monster, embed = false) {
  if (!monster) return 'test-skills.html';
  const params = new URLSearchParams();
  if (monster.id) params.set('monster', monster.id);
  if (monster.name) params.set('name', monster.name);
  params.set('scale', monster.scale || 1.0);
  const sprite = testSpriteOverride || monster.sprite;
  if (sprite) params.set('sprite', sprite);
  const anims = monster.animations && (monster.animations.idle || monster.animations.attack)
    ? monster.animations
    : null;
  if (anims) params.set('animations', JSON.stringify(anims));
  if (embed) params.set('embed', '1');
  return `test-skills.html?${params.toString()}`;
}

function openArenaModal() {
  const monster = getCurrentMonster();
  if (!monster) return;

  const modal = document.getElementById('arena-modal');
  if (modal) modal.style.display = 'flex';

  const nameEl = document.getElementById('arena-monster-name');
  if (nameEl) nameEl.textContent = `${monster.name} — 3D Dungeon Skill & Animation Arena`;

  const iframe = document.getElementById('arena-3d-iframe');
  if (iframe) {
    iframe.src = buildTestSkillsUrl(monster, true);
  }
}

function closeArenaModal() {
  const modal = document.getElementById('arena-modal');
  if (modal) modal.style.display = 'none';
  const iframe = document.getElementById('arena-3d-iframe');
  if (iframe) iframe.src = 'about:blank';
}

function triggerArenaAction(actionType) {
  if (!arenaActive) return;

  if (actionType === 'attack') {
    arenaCurrentPhase = 2;
    arenaBannerText = 'Action: ⚔️ Melee Strike';
    executeArenaMeleeAttack();
  } else if (actionType === 'spell') {
    arenaCurrentPhase = 3;
    arenaBannerText = 'Action: 🔥 Fire Breath / Special Ability';
    executeArenaSpellAttack();
  } else if (actionType === 'move') {
    arenaCurrentPhase = 1;
    arenaBannerText = 'Action: 🏃 Pathfinding / Move';
    executeArenaMove();
  }
}

function executeArenaMove() {
  const canvas = document.getElementById('arena-canvas');
  if (!canvas) return;
  arenaMonsterPos.targetX = Math.random() * (canvas.width * 0.35) + canvas.width * 0.45;
  arenaMonsterPos.targetY = Math.random() * (canvas.height * 0.5) + canvas.height * 0.25;
}

function executeArenaMeleeAttack() {
  const targetHero = arenaParty.find(h => h.hp > 0) || arenaParty[0];
  if (!targetHero) return;

  arenaMonsterPos.targetX = targetHero.x + 95;
  arenaMonsterPos.targetY = targetHero.y;

  setTimeout(() => {
    arenaShake = 14;
    const dmg = Math.floor(Math.random() * 22) + 16;
    targetHero.hp = Math.max(0, targetHero.hp - dmg);

    spawnArenaParticles(targetHero.x, targetHero.y, '#ef4444', 20);
    arenaFloaters.push({ text: `-${dmg} HP!`, x: targetHero.x, y: targetHero.y - 20, color: '#ef4444', life: 1.0 });

    try { playSfx('swordHit'); } catch (e) {}
  }, 350);
}

function executeArenaSpellAttack() {
  arenaShake = 20;
  const startX = arenaMonsterPos.x - 30;
  const startY = arenaMonsterPos.y;

  for (let i = 0; i < 70; i++) {
    setTimeout(() => {
      const angle = (Math.random() - 0.5) * 0.65 + Math.PI;
      const speed = Math.random() * 10 + 4;
      arenaParticles.push({
        x: startX,
        y: startY + (Math.random() - 0.5) * 45,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: Math.random() > 0.3 ? '#f97316' : '#f59e0b',
        size: Math.random() * 14 + 6,
        life: 1.0,
        decay: Math.random() * 0.02 + 0.015
      });
    }, i * 14);
  }

  setTimeout(() => {
    arenaParty.forEach(hero => {
      if (hero.hp > 0) {
        const dmg = Math.floor(Math.random() * 32) + 26;
        hero.hp = Math.max(0, hero.hp - dmg);
        spawnArenaParticles(hero.x, hero.y, '#f97316', 18);
        arenaFloaters.push({ text: `-${dmg} FIRE DMG!`, x: hero.x, y: hero.y - 25, color: '#fcd34d', life: 1.2 });
      }
    });
    try { playSfx(spellSfx('fireball')); } catch (e) {}
  }, 450);
}

function resetArenaParty() {
  arenaParty.forEach(h => {
    h.hp = h.maxHp;
  });
}

function spawnArenaParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 6 + 2;
    arenaParticles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      size: Math.random() * 6 + 3,
      life: 1.0,
      decay: Math.random() * 0.04 + 0.02
    });
  }
}

function startArenaLoop() {
  const canvas = document.getElementById('arena-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let lastTime = performance.now();

  const renderLoop = (time) => {
    if (!arenaActive) return;
    const dt = Math.min((time - lastTime) / 1000, 0.1) * arenaSpeed;
    lastTime = time;

    canvas.width = canvas.parentElement.clientWidth || 1200;
    canvas.height = canvas.parentElement.clientHeight || 750;
    ctx.imageSmoothingEnabled = false;

    const palette = ARENA_THEME_PALETTES[arenaTheme] || ARENA_THEME_PALETTES.ancient;

    // Handle Auto-Cycle Timer
    if (arenaAutoCycle && (time - arenaPhaseTimer) > (4000 / arenaSpeed)) {
      arenaPhaseTimer = time;
      arenaCurrentPhase = (arenaCurrentPhase + 1) % 4;

      if (arenaCurrentPhase === 0) {
        arenaBannerText = 'Action: Idle Stance';
        const canvasW = canvas.width;
        arenaMonsterPos.targetX = canvasW - 280;
        arenaMonsterPos.targetY = canvas.height / 2;
      } else if (arenaCurrentPhase === 1) {
        arenaBannerText = 'Action: 🏃 Pathfinding / Move';
        executeArenaMove();
      } else if (arenaCurrentPhase === 2) {
        arenaBannerText = 'Action: ⚔️ Melee Strike';
        executeArenaMeleeAttack();
      } else if (arenaCurrentPhase === 3) {
        arenaBannerText = 'Action: 🔥 Fire Breath / Special Ability';
        executeArenaSpellAttack();
      }

      const bannerEl = document.getElementById('arena-action-banner');
      if (bannerEl) bannerEl.textContent = arenaBannerText;
    }

    // Smoothly Interpolate Monster Position
    arenaMonsterPos.x += (arenaMonsterPos.targetX - arenaMonsterPos.x) * 0.08 * (arenaSpeed || 1);
    arenaMonsterPos.y += (arenaMonsterPos.targetY - arenaMonsterPos.y) * 0.08 * (arenaSpeed || 1);

    // Apply Screen Shake Offset
    ctx.save();
    if (arenaShake > 0.01) {
      const sx = (Math.random() - 0.5) * arenaShake;
      const sy = (Math.random() - 0.5) * arenaShake;
      ctx.translate(sx, sy);
      arenaShake *= 0.88;
    }

    // 1. Draw Dungeon Room Floor & Grid
    ctx.fillStyle = palette.floor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const tileSize = 48;
    ctx.strokeStyle = palette.tileGrid;
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += tileSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += tileSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    // 2. Render Outer Perimeter Dungeon Walls
    const wallThick = 36;
    ctx.fillStyle = palette.wall;
    ctx.fillRect(0, 0, canvas.width, wallThick); // Top Wall
    ctx.fillRect(0, canvas.height - wallThick, canvas.width, wallThick); // Bottom Wall
    ctx.fillRect(0, 0, wallThick, canvas.height); // Left Wall
    ctx.fillRect(canvas.width - wallThick, 0, wallThick, canvas.height); // Right Wall

    // Wall Trim Caps
    ctx.fillStyle = palette.wallTop;
    ctx.fillRect(0, wallThick - 6, canvas.width, 6);
    ctx.fillRect(0, canvas.height - wallThick, canvas.width, 6);

    // Wall Bricks Pattern
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.5;
    for (let x = wallThick; x < canvas.width - wallThick; x += 60) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, wallThick - 6); ctx.stroke();
    }

    // Torch Sconces & Light Glow
    const torchCount = 4;
    const torchStep = (canvas.width - wallThick * 2) / (torchCount + 1);
    for (let i = 1; i <= torchCount; i++) {
      const tx = wallThick + torchStep * i;
      const ty = wallThick - 4;

      const torchGlow = ctx.createRadialGradient(tx, ty, 5, tx, ty, 240);
      torchGlow.addColorStop(0, palette.torchGlow);
      torchGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = torchGlow;
      ctx.fillRect(tx - 240, ty - 240, 480, 480);

      // Sconce Icon & Flame
      ctx.fillStyle = '#33261a';
      ctx.fillRect(tx - 4, ty - 10, 8, 12);
      ctx.fillStyle = Math.random() > 0.4 ? '#f59e0b' : '#ef4444';
      ctx.beginPath();
      ctx.arc(tx, ty - 12 + (Math.random() - 0.5) * 2, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Render Scatter Terrain Props (Pillars, Crates, Barrels, Chests, Urns)
    arenaProps.forEach(prop => {
      const px = prop.x;
      const py = prop.y;

      if (prop.type === 'pillar') {
        // Stone Pillar Base Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.ellipse(px, py + 18, prop.r, prop.r * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();

        // Pillar Body
        ctx.fillStyle = palette.pillar;
        ctx.fillRect(px - prop.r, py - 30, prop.r * 2, 45);

        // Pillar Capital Top
        ctx.fillStyle = palette.wallTop;
        ctx.fillRect(px - prop.r - 4, py - 35, (prop.r + 4) * 2, 8);
        ctx.strokeStyle = palette.propBorder;
        ctx.strokeRect(px - prop.r, py - 30, prop.r * 2, 45);
      } else if (prop.type === 'crate') {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(px - 14, py + 8, 28, 8);

        ctx.fillStyle = '#654321';
        ctx.fillRect(px - 14, py - 14, 28, 28);
        ctx.strokeStyle = '#3d2813';
        ctx.lineWidth = 2;
        ctx.strokeRect(px - 14, py - 14, 28, 28);

        // Cross Braces
        ctx.beginPath(); ctx.moveTo(px - 14, py - 14); ctx.lineTo(px + 14, py + 14); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px + 14, py - 14); ctx.lineTo(px - 14, py + 14); ctx.stroke();
      } else if (prop.type === 'barrel') {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.ellipse(px, py + 10, 14, 5, 0, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = '#8b5a2b';
        ctx.beginPath(); ctx.ellipse(px, py, 13, 16, 0, 0, Math.PI * 2); ctx.fill();

        // Metal Bands
        ctx.strokeStyle = '#4a5568';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py - 6, 12, 0, Math.PI); ctx.stroke();
        ctx.beginPath(); ctx.arc(px, py + 6, 12, 0, Math.PI); ctx.stroke();
      } else if (prop.type === 'chest') {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(px - 16, py + 6, 32, 8);

        ctx.fillStyle = '#78350f';
        ctx.fillRect(px - 16, py - 10, 32, 20);

        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 2;
        ctx.strokeRect(px - 16, py - 10, 32, 20);

        // Gold Latch
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(px - 3, py - 2, 6, 6);
      } else if (prop.type === 'urn') {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.ellipse(px, py + 8, 10, 4, 0, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = '#b45309';
        ctx.beginPath(); ctx.ellipse(px, py - 2, 10, 14, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#78350f';
        ctx.fillRect(px - 6, py - 16, 12, 4);
      }
    });

    // 4. Render Hero Party
    arenaParty.forEach(hero => {
      const hImg = imageCache['./dcss/monster/' + hero.sprite];
      const hx = hero.x;
      const hy = hero.y;

      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(hx, hy + 20, 16, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      if (hImg) {
        ctx.drawImage(hImg, hx - 16, hy - 24, 32, 32);
      } else {
        ctx.fillStyle = hero.color;
        ctx.fillRect(hx - 12, hy - 24, 24, 24);
      }

      ctx.fillStyle = '#fff';
      ctx.font = '600 10px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${hero.icon} ${hero.name}`, hx, hy - 32);

      const barW = 32;
      const barH = 4;
      const hpPct = Math.max(0, hero.hp / hero.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(hx - barW / 2, hy - 28, barW, barH);
      ctx.fillStyle = hpPct > 0.5 ? '#10b981' : (hpPct > 0.25 ? '#f59e0b' : '#ef4444');
      ctx.fillRect(hx - barW / 2, hy - 28, barW * hpPct, barH);
    });

    // 5. Render Monster (Red Dragon / Monster)
    const mImg = arenaMonsterRecolored;
    const mx = arenaMonsterPos.x;
    const my = arenaMonsterPos.y;
    const bob = Math.sin(time * 0.003) * 6;

    const mw = (mImg?.width || 64) * 4 * arenaMonsterScale;
    const mh = (mImg?.height || 64) * 4 * arenaMonsterScale;

    // Monster Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(mx, my + (mh / 2) - 10, mw * 0.35, mh * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();

    // Draw Monster Sprite
    if (mImg) {
      ctx.drawImage(mImg, mx - mw / 2, my - mh / 2 + bob, mw, mh);
    } else {
      ctx.fillStyle = '#d9a441';
      ctx.fillRect(mx - mw / 2, my - mh / 2, mw, mh);
    }

    // Monster Name Tag
    ctx.fillStyle = '#fcd34d';
    ctx.font = 'bold 12px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`👾 ${arenaMonsterName} (${arenaMonsterScale.toFixed(2)}x)`, mx, my - mh / 2 - 12 + bob);

    // 6. Render Particles
    for (let i = arenaParticles.length - 1; i >= 0; i--) {
      const p = arenaParticles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay || 0.03;

      if (p.life <= 0) {
        arenaParticles.splice(i, 1);
        continue;
      }

      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.life;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }

    // 7. Render Floating Damage Text
    for (let i = arenaFloaters.length - 1; i >= 0; i--) {
      const f = arenaFloaters[i];
      f.y -= 1.2;
      f.life -= 0.02;

      if (f.life <= 0) {
        arenaFloaters.splice(i, 1);
        continue;
      }

      ctx.fillStyle = f.color;
      ctx.globalAlpha = f.life;
      ctx.font = 'bold 14px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1.0;
    }

    ctx.restore();

    arenaAnimFrame = requestAnimationFrame(renderLoop);
  };

  arenaAnimFrame = requestAnimationFrame(renderLoop);
}

function renderMonsterStats() {
  const rawMonster = getCurrentMonster();
  if (!rawMonster) return;

  const monster = showCRScaled ? applyCRScalingToMonster(rawMonster) : rawMonster;

  const statsContainer = document.getElementById('stats-grid-container');
  if (!statsContainer) return;

  const hpAvg = monster.hp ? Math.floor(monster.hp[0] * ((monster.hp[1] || 6) + 1) / 2 + (monster.hp[2] || 0)) : '—';
  const hpFormula = monster.hp ? `${monster.hp[0]}d${monster.hp[1] || 6}${monster.hp[2] ? fmtMod(monster.hp[2]) : ''}` : '—';
  const dmgFormula = monster.dmg ? `${monster.dmg[0]}d${monster.dmg[1]}${monster.dmg[2] ? fmtMod(monster.dmg[2]) : ''}` : '—';

  const sb = monster.statblock || {};

  statsContainer.innerHTML = `
    <div class="stat-card">
      <div class="stat-card-title">Hit Points</div>
      <div class="stat-card-val">${hpAvg}</div>
      <div class="stat-card-sub">${hpFormula}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-title">Armor Class</div>
      <div class="stat-card-val">${monster.ac ?? '—'}</div>
      <div class="stat-card-sub">Base AC</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-title">Attack Bonus</div>
      <div class="stat-card-val">${fmtMod(monster.atk ?? 0)}</div>
      <div class="stat-card-sub">To Hit</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-title">Damage Roll</div>
      <div class="stat-card-val">${dmgFormula}</div>
      <div class="stat-card-sub">Base Melee</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-title">XP Value</div>
      <div class="stat-card-val">${monster.xp ?? 0}</div>
      <div class="stat-card-sub">Reward</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-title">Threat Rating</div>
      <div class="stat-card-val">${monster.threat ?? 0}</div>
      <div class="stat-card-sub">Budget Cost</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-title">Move Speed</div>
      <div class="stat-card-val">${monster.speed ?? 3}</div>
      <div class="stat-card-sub">${Math.round(((monster.speed || 3) * 10) / 5) * 5} ft/round</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-title">Scale Factor</div>
      <div class="stat-card-val">${(monster.scale ?? 1.0).toFixed(2)}x</div>
      <div class="stat-card-sub">Mesh Scale</div>
    </div>
  `;

  // Render Effective Statblock (STR, DEX, CON, INT, WIS, CHA)
  const effStatsContainer = document.getElementById('ability-scores-container');
  if (effStatsContainer) {
    const stats = monster.effStats || (sb.stats) || { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    const statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

    effStatsContainer.innerHTML = `
      <div class="ability-scores-row">
        ${statKeys.map(k => {
          const score = stats[k] ?? 10;
          const modVal = Math.floor((score - 10) / 2);
          const saveVal = monster.saves?.[k] ?? modVal;
          return `
            <div class="ability-score-cell">
              <div class="ab-label">${k.toUpperCase()}</div>
              <div class="ab-score">${score}</div>
              <div class="ab-mod">${fmtMod(modVal)}</div>
              <div class="ab-save" title="Saving Throw">Save: ${fmtMod(saveVal)}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // Render Defense Traits & Immunities
  const defenseContainer = document.getElementById('defense-traits-container');
  if (defenseContainer) {
    const items = [];
    if (sb.resist && sb.resist.length) items.push(`<strong>Resistances:</strong> ${sb.resist.join(', ')}`);
    if (sb.immune && sb.immune.length) items.push(`<strong>Immunities:</strong> ${sb.immune.join(', ')}`);
    if (sb.vulnerable && sb.vulnerable.length) items.push(`<strong>Vulnerabilities:</strong> ${sb.vulnerable.join(', ')}`);
    if (sb.condImmune && sb.condImmune.length) items.push(`<strong>Condition Immunities:</strong> ${sb.condImmune.join(', ')}`);
    if (sb.languages && sb.languages !== '—') items.push(`<strong>Languages:</strong> ${sb.languages}`);
    if (sb.senses) items.push(`<strong>Senses:</strong> ${sb.senses}`);

    defenseContainer.innerHTML = items.length
      ? items.map(it => `<div class="defense-item">${it}</div>`).join('')
      : '<div class="text-muted">Standard SRD Defenses</div>';
  }
}

function renderMonsterAbilities() {
  const monster = getCurrentMonster();
  const abilitiesContainer = document.getElementById('monster-abilities-container');
  if (!monster || !abilitiesContainer) return;

  const abList = [];

  const dmgFormula = monster.dmg ? `${monster.dmg[0]}d${monster.dmg[1]}${monster.dmg[2] ? fmtMod(monster.dmg[2]) : ''}` : '—';
  abList.push(`
    <div class="ability-card primary-attack">
      <div class="ability-card-header">
        <span class="ability-name">⚔️ Primary Melee Attack</span>
        <span class="ability-type-badge">Standard Action</span>
      </div>
      <div class="ability-desc">
        Makes a melee attack at <strong>${fmtMod(monster.atk ?? 0)} to hit</strong>, dealing <strong>${dmgFormula} damage</strong> on hit.
      </div>
    </div>
  `);

  const spellIds = BOSS_SPELLS[monster.id] || [];
  if (spellIds.length > 0) {
    spellIds.forEach(spId => {
      const fx = BOSS_SPELL_FX[spId] || {};
      const label = fx.label || spId;
      const dmgStr = fx.dice ? `${fx.dice[0]}d${fx.dice[1]}${fx.dice[2] ? fmtMod(fx.dice[2]) : ''} ${fx.dmgType || ''}` : 'No Direct Damage';
      const saveStr = fx.save ? `${fx.save.ab.toUpperCase()} DC ${fx.save.dc} ${fx.save.half ? '(Half on save)' : '(Negate effect)'}` : 'None';
      const aoeStr = fx.aoe ? `AOE Radius: ${fx.aoe} units` : 'Single Target';
      const effectStr = fx.effect ? `Applies condition: <strong>${fx.effect.key}</strong> (${fx.effect.dur}s)` : null;
      const healStr = fx.heal ? `Heals: ${fx.heal[0]}d${fx.heal[1]}+${fx.heal[2]}` : null;

      abList.push(`
        <div class="ability-card boss-spell">
          <div class="ability-card-header">
            <span class="ability-name">✨ Boss Spell: ${label}</span>
            <span class="ability-type-badge spell-badge">Cast Every 3 Cycles</span>
          </div>
          <div class="ability-desc">
            <div><strong>Damage / Effect:</strong> ${dmgStr}</div>
            <div><strong>Saving Throw:</strong> ${saveStr}</div>
            <div><strong>Target Area:</strong> ${aoeStr}</div>
            ${effectStr ? `<div><strong>Condition:</strong> ${effectStr}</div>` : ''}
            ${healStr ? `<div><strong>Healing:</strong> ${healStr}</div>` : ''}
            ${fx.sprite ? `<div class="spell-sprite-info">Visual Effect Sprite: <code>dcss/effect/${fx.sprite}.png</code></div>` : ''}
          </div>
        </div>
      `);
    });
  }

  const sb = monster.statblock || {};
  if (sb.traits && sb.traits.length) {
    sb.traits.forEach(t => {
      abList.push(`
        <div class="ability-card trait-card">
          <div class="ability-card-header">
            <span class="ability-name">🛡️ Trait: ${t.name}</span>
            <span class="ability-type-badge trait-badge">Passive Trait</span>
          </div>
          <div class="ability-desc">${t.desc}</div>
        </div>
      `);
    });
  }

  if (sb.actions && sb.actions.length) {
    sb.actions.forEach(a => {
      abList.push(`
        <div class="ability-card action-card">
          <div class="ability-card-header">
            <span class="ability-name">🔥 Special Action: ${a.name}</span>
            <span class="ability-type-badge action-badge">Special Action</span>
          </div>
          <div class="ability-desc">${a.desc}</div>
        </div>
      `);
    });
  }

  abilitiesContainer.innerHTML = abList.join('');
}

/* ---------------- DATA EXPORT & IMPORT ---------------- */

async function saveMonstersDirectly() {
  const exportArray = allMonsters.map(cleanMonsterForExport);
  const jsonStr = JSON.stringify(exportArray, null, 2);

  try {
    const res = await fetch('/api/save-monsters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: jsonStr
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        showToast("💾 Saved monsters.json directly to project codebase! (src/game/monsters.json)");
        return;
      }
    }
  } catch (e) {
    console.warn("Direct server save unavailable, falling back to download", e);
  }

  exportMonstersJson();
}

function exportMonstersJson() {
  const exportArray = allMonsters.map(cleanMonsterForExport);
  const jsonStr = JSON.stringify(exportArray, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `monsters.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Exported monsters.json file download!");
}

function cleanMonsterForExport(monster) {
  const base = MONSTERS_RAW.find(m => m.id === monster.id) || monster;
  const copy = JSON.parse(JSON.stringify({ ...base, ...monster }));
  delete copy._isEdited;
  /* `isBoss` must never reach monsters.json. The flag used to leak bosses into
     ordinary room spawns, and test/theme_roster_leak.test.js pins the roster to
     zero of them; bosses are designated by boss_encounters.json alone. Stale
     copies of it survive in localStorage from before that change, and the
     {...base, ...monster} merge above carried them straight back to disk on
     every save -- it silently re-broke the test twice. Strip it here, at the
     one boundary every save path goes through. */
  delete copy.isBoss;
  if (base.ac != null) copy.ac = base.ac;
  if (base.hp) copy.hp = JSON.parse(JSON.stringify(base.hp));
  if (base.atk != null) copy.atk = base.atk;
  if (base.dmg) copy.dmg = JSON.parse(JSON.stringify(base.dmg));
  if (base.effStats) copy.effStats = JSON.parse(JSON.stringify(base.effStats));
  if (base.statblock?.stats && copy.statblock) {
    copy.statblock.stats = JSON.parse(JSON.stringify(base.statblock.stats));
  }
  return copy;
}

function exportData() {
  const exportPayload = {
    timestamp: new Date().toISOString(),
    flags: userFlags,
    edits: userEdits,
    notes: {}
  };

  for (const m of allMonsters) {
    const note = getMonsterNote(m.id);
    if (note && note.trim()) {
      exportPayload.notes[m.id] = note;
    }
  }

  const jsonStr = JSON.stringify(exportPayload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dungeon_crawlers_bestiary_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Exported bestiary backup JSON!");
}

function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.flags) {
        userFlags = { ...userFlags, ...data.flags };
        saveFlags();
      }
      if (data.edits) {
        userEdits = { ...userEdits, ...data.edits };
        saveUserEdits();
      }
      if (data.notes) {
        for (const id in data.notes) {
          saveMonsterNote(id, data.notes[id]);
        }
      }
      applyFilters();
      renderCurrentMonster();
      updateGlobalStats();
      showToast("Successfully imported bestiary backup!");
    } catch (err) {
      alert("Failed to parse imported JSON file: " + err.message);
    }
  };
  reader.readAsText(file);
}

async function uploadCustomSprite(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    const filename = file.name;

    try {
      const res = await fetch('/api/upload-sprite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, dataUrl })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.spritePath) {
          applyLiveVisualEdit({ sprite: data.spritePath });
          showToast(`Uploaded ${filename} → ${data.spritePath}`);
          return;
        }
      }
    } catch (err) {
      console.warn("Server sprite upload unavailable, using data URL fallback", err);
    }

    applyLiveVisualEdit({ sprite: dataUrl });
    showToast(`Loaded custom sprite: ${filename}`);
  };
  reader.readAsDataURL(file);
}

function resolveSpriteUrl(spritePath) {
  if (!spritePath) return './dcss/monster/orc.png';
  spritePath = String(spritePath).trim();

  if (spritePath.startsWith('http://') || spritePath.startsWith('https://') || spritePath.startsWith('data:')) {
    return spritePath;
  }

  spritePath = spritePath.replace(/\\/g, '/');

  if (spritePath.startsWith('./')) spritePath = spritePath.slice(2);
  if (spritePath.startsWith('/')) spritePath = spritePath.slice(1);

  if (spritePath.startsWith('public/')) {
    spritePath = spritePath.slice(7);
  }

  if (spritePath.startsWith('sprites/') || spritePath.startsWith('dcss/') || spritePath.startsWith('lpc/') || spritePath.startsWith('art/') || spritePath.startsWith('fx/')) {
    return './' + spritePath;
  }

  return './dcss/monster/' + spritePath;
}

function rgbToHexInt(r, g, b) {
  return (r << 16) | (g << 8) | b;
}

function hexIntToHexStr(col) {
  if (col == null) return '#888888';
  let hex = Number(col).toString(16);
  while (hex.length < 6) hex = '0' + hex;
  return '#' + hex;
}

function formatCR(cr) {
  if (cr === 0.125) return '1/8';
  if (cr === 0.25) return '1/4';
  if (cr === 0.5) return '1/2';
  return String(cr ?? 0);
}

/* ---------------- TOP-LEVEL TABS ---------------- */

let activeTab = 'bestiary';

function setupTabs() {
  document.querySelectorAll('.app-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.app-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  const mainContainer = document.getElementById('main-container');
  const crView = document.getElementById('cr-scaling-view');
  const sbView = document.getElementById('spawn-budget-view');
  const bossView = document.getElementById('boss-encounters-view');
  const storyView = document.getElementById('story-quests-view');
  const drView = document.getElementById('dungeon-rosters-view');
  const trView = document.getElementById('tactical-rooms-view');
  if (mainContainer) mainContainer.style.display = (tab === 'bestiary') ? 'flex' : 'none';
  if (crView) crView.classList.toggle('active', tab === 'cr-scaling');
  if (sbView) sbView.classList.toggle('active', tab === 'spawn-budget');
  if (bossView) bossView.classList.toggle('active', tab === 'boss-encounters');
  if (storyView) storyView.classList.toggle('active', tab === 'story-quests');
  if (drView) drView.classList.toggle('active', tab === 'dungeon-rosters');
  if (trView) trView.classList.toggle('active', tab === 'tactical-rooms');
  if (tab === 'cr-scaling') renderCRTable();
  if (tab === 'spawn-budget') renderSpawnBudget();
  if (tab === 'boss-encounters') renderBossEncountersTab();
  if (tab === 'story-quests') renderStoryQuestsTab();
  if (tab === 'dungeon-rosters') renderDungeonRostersTab();
  if (tab === 'tactical-rooms') renderTacticalRoomsTab();
  if (tab === 'bestiary') updateSpriteDisplay();
}

/* ---------------- CURATED BOSS ENCOUNTERS (100) EDITOR ---------------- */

function getMonsterById(id) {
  return allMonsters.find(m => m.id === id) || MONSTERS_RAW.find(m => m.id === id);
}

function renderMonsterOptionsHTML(selectedId = '') {
  const sorted = [...allMonsters].sort((a, b) => {
    const crA = a.cr ?? 0;
    const crB = b.cr ?? 0;
    if (crA !== crB) return crA - crB;
    return a.name.localeCompare(b.name);
  });

  return sorted.map(m => {
    const sel = m.id === selectedId ? 'selected' : '';
    return `<option value="${m.id}" ${sel}>[CR ${formatCR(m.cr)}] ${m.name}</option>`;
  }).join('');
}

const BOSS_EDITS_KEY = 'dc_boss_encounters_edits';

let allBossEncounters = [];
let userBossEdits = {};
let currentBossId = 'molten-l1';
let bossThemeFilter = 'all';
let bossLevelFilter = 'all';
let bossSearchQuery = '';

function loadBossEncountersData() {
  try {
    const saved = localStorage.getItem(BOSS_EDITS_KEY);
    if (saved) userBossEdits = JSON.parse(saved);
  } catch (e) {
    userBossEdits = {};
  }
  allBossEncounters = BOSS_ENCOUNTERS_RAW.map(baseE => {
    if (userBossEdits[baseE.id]) {
      return { ...baseE, ...userBossEdits[baseE.id], _isEdited: true };
    }
    return { ...baseE, _isEdited: false };
  });
}

function saveBossEdits() {
  try {
    localStorage.setItem(BOSS_EDITS_KEY, JSON.stringify(userBossEdits));
  } catch (e) {
    console.error("Failed to save boss encounter edits", e);
  }
  loadBossEncountersData();
  renderBossEncountersTab();
  showToast("💾 Saved Boss Encounter edits to local storage!");
}

function setupBossEncountersTab() {
  loadBossEncountersData();

  const lvlSel = document.getElementById('boss-level-select');
  if (lvlSel && lvlSel.children.length <= 1) {
    for (let l = 1; l <= 20; l++) {
      const opt = document.createElement('option');
      opt.value = String(l);
      opt.textContent = `Level ${l}`;
      lvlSel.appendChild(opt);
    }
  }

  const bSelect = document.getElementById('edit-boss-id');
  if (bSelect) {
    bSelect.innerHTML = renderMonsterOptionsHTML();
  }

  document.querySelectorAll('.boss-theme-filter').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.boss-theme-filter').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      bossThemeFilter = e.target.dataset.theme;
      renderBossSidebarList();
    });
  });

  document.getElementById('boss-search-input')?.addEventListener('input', (e) => {
    bossSearchQuery = e.target.value.toLowerCase();
    renderBossSidebarList();
  });

  document.getElementById('boss-level-select')?.addEventListener('change', (e) => {
    bossLevelFilter = e.target.value;
    renderBossSidebarList();
  });

  document.getElementById('edit-boss-name')?.addEventListener('change', updateCurrentBossFromForm);
  document.getElementById('edit-boss-id')?.addEventListener('change', updateCurrentBossFromForm);
  document.getElementById('edit-boss-title')?.addEventListener('change', updateCurrentBossFromForm);
  document.getElementById('edit-boss-desc')?.addEventListener('change', updateCurrentBossFromForm);
  document.getElementById('edit-boss-cr-num')?.addEventListener('change', updateCurrentBossFromForm);

  const hpSlider = document.getElementById('edit-boss-hpmult-slider');
  hpSlider?.addEventListener('input', (e) => {
    const lbl = document.getElementById('edit-boss-hpmult-val');
    if (lbl) lbl.textContent = parseFloat(e.target.value).toFixed(2) + 'x';
    updateCurrentBossFromForm();
  });

  document.getElementById('boss-add-escort-btn')?.addEventListener('click', () => {
    const enc = allBossEncounters.find(e => e.id === currentBossId);
    if (!enc) return;
    const escorts = [...(enc.escorts || [])];
    escorts.push({ id: 'giant-rat', count: 2 });
    applyBossEdit(enc.id, { escorts });
  });

  document.getElementById('boss-save-all-btn')?.addEventListener('click', saveBossEdits);
  document.getElementById('boss-export-json-btn')?.addEventListener('click', exportBossEncountersJson);
  document.getElementById('boss-reset-defaults-btn')?.addEventListener('click', () => {
    if (confirm("Reset all 100 boss encounters to factory defaults?")) {
      userBossEdits = {};
      localStorage.removeItem(BOSS_EDITS_KEY);
      loadBossEncountersData();
      renderBossEncountersTab();
      showToast("Reset all boss encounters to factory defaults!");
    }
  });

  document.getElementById('boss-test-arena-btn')?.addEventListener('click', () => {
    const enc = allBossEncounters.find(e => e.id === currentBossId);
    if (enc) {
      const boss = getMonsterById(enc.bossId);
      window.open(buildTestSkillsUrl({
        id: enc.bossId,
        name: enc.bossTitle || enc.name,
        scale: 1.5,
        sprite: boss?.sprite || './dcss/monster/orc.png',
        animations: boss?.animations
      }), '_blank');
    }
  });
}

function updateCurrentBossFromForm() {
  const enc = allBossEncounters.find(e => e.id === currentBossId);
  if (!enc) return;
  const name = document.getElementById('edit-boss-name')?.value || enc.name;
  const bossId = document.getElementById('edit-boss-id')?.value || enc.bossId;
  const bossTitle = document.getElementById('edit-boss-title')?.value || enc.bossTitle;
  const bossHpMult = parseFloat(document.getElementById('edit-boss-hpmult-slider')?.value || '1.5');
  const targetCR = parseFloat(document.getElementById('edit-boss-cr-num')?.value || '1.0');
  const description = document.getElementById('edit-boss-desc')?.value || enc.description;

  applyBossEdit(enc.id, { name, bossId, bossTitle, bossHpMult, targetCR, description });
}

function applyBossEdit(id, changes) {
  userBossEdits[id] = { ...(userBossEdits[id] || {}), ...changes };
  localStorage.setItem(BOSS_EDITS_KEY, JSON.stringify(userBossEdits));
  loadBossEncountersData();
  renderBossEncountersTab();
}

function renderBossEncountersTab() {
  renderBossSidebarList();
  renderBossInspector();
}

function renderBossSidebarList() {
  const listEl = document.getElementById('boss-encounter-list');
  if (!listEl) return;

  let filtered = allBossEncounters.filter(e => {
    if (bossThemeFilter !== 'all' && e.theme.toLowerCase() !== bossThemeFilter) return false;
    if (bossLevelFilter !== 'all' && String(e.level) !== bossLevelFilter) return false;
    if (bossSearchQuery) {
      const q = bossSearchQuery;
      const mName = (getMonsterById(e.bossId)?.name || '').toLowerCase();
      if (!e.name.toLowerCase().includes(q) && !e.bossTitle.toLowerCase().includes(q) && !mName.includes(q) && !e.id.includes(q)) {
        return false;
      }
    }
    return true;
  });

  const countBadge = document.getElementById('boss-list-count');
  if (countBadge) countBadge.textContent = `${filtered.length} / ${allBossEncounters.length}`;

  listEl.innerHTML = filtered.map(e => {
    const active = e.id === currentBossId ? 'active' : '';
    const editedTag = e._isEdited ? '✏️ ' : '';
    const escCount = (e.escorts || []).reduce((acc, x) => acc + (x.count || 1), 0);
    const themeColor = e.theme === 'molten' ? '#ef4444' : e.theme === 'frost' ? '#38bdf8' : e.theme === 'verdant' ? '#10b981' : e.theme === 'grim' ? '#a855f7' : '#f59e0b';
    return `
      <div class="boss-item-card ${active}" data-id="${e.id}">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:700; font-size:12px; color:${themeColor}">${editedTag}${e.name}</span>
          <span class="badge" style="font-size:10px; padding:2px 6px; background:rgba(255,255,255,0.06)">L${e.level}</span>
        </div>
        <div style="font-size:11px; color:var(--text-muted); display:flex; justify-content:space-between;">
          <span>👑 ${e.bossTitle || e.bossId}</span>
          <span>🛡️ ${escCount} escorts</span>
        </div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.boss-item-card').forEach(card => {
    card.addEventListener('click', () => {
      currentBossId = card.dataset.id;
      renderBossEncountersTab();
    });
  });
}

function renderBossInspector() {
  const enc = allBossEncounters.find(e => e.id === currentBossId) || allBossEncounters[0];
  if (!enc) return;
  currentBossId = enc.id;

  const tBadge = document.getElementById('boss-badge-theme');
  if (tBadge) {
    tBadge.textContent = (enc.theme || 'ancient').toUpperCase();
    const colors = { molten: '#ef4444', frost: '#38bdf8', verdant: '#10b981', grim: '#a855f7', ancient: '#f59e0b' };
    tBadge.style.color = colors[enc.theme] || '#d9a441';
  }

  const lBadge = document.getElementById('boss-badge-level');
  if (lBadge) lBadge.textContent = `LEVEL ${enc.level}`;

  const idTag = document.getElementById('boss-id-tag');
  if (idTag) idTag.textContent = enc.id;

  const titleHeader = document.getElementById('boss-header-title');
  if (titleHeader) titleHeader.textContent = enc.name;

  const nameInput = document.getElementById('edit-boss-name');
  if (nameInput) nameInput.value = enc.name;

  const bossSelect = document.getElementById('edit-boss-id');
  if (bossSelect) {
    bossSelect.innerHTML = renderMonsterOptionsHTML(enc.bossId);
  }

  const bossTitleInput = document.getElementById('edit-boss-title');
  if (bossTitleInput) bossTitleInput.value = enc.bossTitle || '';

  const hpSlider = document.getElementById('edit-boss-hpmult-slider');
  if (hpSlider) hpSlider.value = enc.bossHpMult || 1.5;

  const hpLabel = document.getElementById('edit-boss-hpmult-val');
  if (hpLabel) hpLabel.textContent = (enc.bossHpMult || 1.5).toFixed(2) + 'x';

  const crNum = document.getElementById('edit-boss-cr-num');
  if (crNum) crNum.value = enc.targetCR || 1.0;

  const descText = document.getElementById('edit-boss-desc');
  if (descText) descText.value = enc.description || '';

  // Render Escort Minion Rows
  const escContainer = document.getElementById('boss-escort-rows');
  if (escContainer) {
    const escorts = enc.escorts || [];
    escContainer.innerHTML = escorts.map((esc, i) => `
      <div class="boss-escort-row">
        <select class="escort-id-select" data-idx="${i}" style="flex:1; background:var(--bg-input); border:1px solid var(--border); color:#fff; padding:4px 8px; border-radius:4px; font-size:12px">
          ${renderMonsterOptionsHTML(esc.id)}
        </select>
        <span style="font-size:11px; color:var(--text-muted)">Count:</span>
        <input type="number" class="escort-count-num" data-idx="${i}" min="1" max="6" value="${esc.count || 1}" style="width:50px; background:var(--bg-input); border:1px solid var(--border); color:#fff; padding:4px 6px; border-radius:4px; font-size:12px">
        <button class="btn btn-xs remove-escort-btn" data-idx="${i}" style="color:var(--red); border-color:rgba(239,68,68,0.3)">✖</button>
      </div>
    `).join('');

    escContainer.querySelectorAll('.escort-id-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        const newEsc = [...(enc.escorts || [])];
        newEsc[idx] = { ...newEsc[idx], id: e.target.value };
        applyBossEdit(enc.id, { escorts: newEsc });
      });
    });

    escContainer.querySelectorAll('.escort-count-num').forEach(num => {
      num.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        const cnt = Math.max(1, parseInt(e.target.value, 10) || 1);
        const newEsc = [...(enc.escorts || [])];
        newEsc[idx] = { ...newEsc[idx], count: cnt };
        applyBossEdit(enc.id, { escorts: newEsc });
      });
    });

    escContainer.querySelectorAll('.remove-escort-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        const newEsc = [...(enc.escorts || [])];
        newEsc.splice(idx, 1);
        applyBossEdit(enc.id, { escorts: newEsc });
      });
    });
  }

  const summaryEl = document.getElementById('boss-summary-text');
  if (summaryEl) {
    const mainM = getMonsterById(enc.bossId);
    const escText = (enc.escorts || []).map(x => {
      const m = getMonsterById(x.id);
      return `${x.count}x ${m ? m.name : x.id}`;
    }).join(', ');
    let baseHp = 40;
    if (mainM && mainM.hp) {
      if (Array.isArray(mainM.hp)) {
        baseHp = Math.round((mainM.hp[0] || 1) * ((mainM.hp[1] || 6) + 1) / 2 + (mainM.hp[2] || 0));
      } else if (typeof mainM.hp === 'number') {
        baseHp = mainM.hp;
      }
    }
    const effHp = Math.round(baseHp * (enc.bossHpMult || 1.5));

    summaryEl.innerHTML = `
      Primary: <b>${enc.bossTitle || (mainM ? mainM.name : enc.bossId)}</b> (${mainM ? mainM.name : ''}) — <b>${effHp} HP</b> (CR ${mainM ? formatCR(mainM.cr) : '?'})<br>
      Escorts: ${escText || '<i>None</i>'}
    `;
  }
}

function exportBossEncountersJson() {
  const exportArray = allBossEncounters.map(e => {
    const copy = JSON.parse(JSON.stringify(e));
    delete copy._isEdited;
    return copy;
  });
  const jsonStr = JSON.stringify(exportArray, null, 2);

  fetch('/api/save-bosses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: jsonStr
  }).then(res => {
    if (res.ok) {
      showToast("💾 Saved boss_encounters.json directly to codebase! (src/game/boss_encounters.json)");
      return;
    }
  }).catch(() => {});

  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `boss_encounters.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Exported boss_encounters.json file download!");
}

/* ---------------- CR SCALING (DIFFICULTY) EDITOR ----------------
   Edits mutate the live CR_SCALING_TABLE object in place, so the bestiary
   statblocks and the arena preview reflect a change immediately (getCRScale
   reads the table per call). "Save to Codebase" persists to cr_scaling.json,
   which is what the game itself imports on load. */

const CR_FIELDS = ['acPct', 'hpPct', 'atkPct', 'statPct'];

// Snapshot of what's on disk, so "Revert Unsaved" and the global difficulty
// slider both have a stable baseline to work from.
let crSavedBaseline = deepCloneTable(CR_SCALING_TABLE);
let crDirty = false;

function deepCloneTable(table) {
  return JSON.parse(JSON.stringify(table));
}

function crKeys() {
  return Object.keys(CR_SCALING_TABLE).map(Number).sort((a, b) => a - b);
}

function setupCRScalingTab() {
  // CR range dropdowns for the bulk editor.
  const fromSel = document.getElementById('cr-bulk-from');
  const toSel = document.getElementById('cr-bulk-to');
  const keys = crKeys();
  if (fromSel && toSel) {
    const opts = keys.map(k => `<option value="${k}">CR ${formatCR(k)}</option>`).join('');
    fromSel.innerHTML = opts;
    toSel.innerHTML = opts;
    fromSel.value = String(keys[0]);
    toSel.value = String(keys[keys.length - 1]);
  }

  const slider = document.getElementById('cr-difficulty-slider');
  const sliderLabel = document.getElementById('cr-difficulty-label');
  slider?.addEventListener('input', () => {
    if (sliderLabel) sliderLabel.textContent = `${Number(slider.value).toFixed(2)}×`;
  });

  document.getElementById('cr-difficulty-apply')?.addEventListener('click', () => {
    const factor = Number(slider?.value || 1);
    for (const k of crKeys()) {
      for (const f of CR_FIELDS) {
        CR_SCALING_TABLE[k][f] = Math.round((crSavedBaseline[k]?.[f] ?? 0) * factor);
      }
    }
    onCRTableChanged();
    showToast(`Applied ${factor.toFixed(2)}× difficulty to every CR row (from the saved baseline).`);
  });

  document.getElementById('cr-bulk-apply')?.addEventListener('click', () => {
    const col = document.getElementById('cr-bulk-column')?.value || 'all';
    const op = document.getElementById('cr-bulk-op')?.value || 'add';
    const val = Number(document.getElementById('cr-bulk-value')?.value || 0);
    const from = Number(fromSel?.value ?? 0);
    const to = Number(toSel?.value ?? 20);
    const lo = Math.min(from, to), hi = Math.max(from, to);
    const fields = col === 'all' ? CR_FIELDS : [col];

    for (const k of crKeys()) {
      if (k < lo || k > hi) continue;
      for (const f of fields) {
        const cur = CR_SCALING_TABLE[k][f] ?? 0;
        let next = cur;
        if (op === 'add') next = cur + val;
        else if (op === 'mul') next = cur * val;
        else if (op === 'set') next = val;
        CR_SCALING_TABLE[k][f] = Math.max(0, Math.round(next));
      }
    }
    onCRTableChanged();
    showToast(`Bulk ${op} applied to CR ${formatCR(lo)}–${formatCR(hi)}.`);
  });

  setupCRCurveTool(keys);

  document.getElementById('cr-preview-toggle')?.addEventListener('change', renderCRTable);
  document.getElementById('cr-preview-mode')?.addEventListener('change', renderCRTable);

  document.getElementById('cr-save-btn')?.addEventListener('click', saveCRScaling);

  document.getElementById('cr-revert-btn')?.addEventListener('click', () => {
    applyCRTable(crSavedBaseline);
    crDirty = false;
    onCRTableChanged(true);
    showToast("Reverted to the last saved CR scaling values.");
  });

  document.getElementById('cr-reset-btn')?.addEventListener('click', () => {
    if (!confirm("Reset the whole CR scaling table back to factory defaults?")) return;
    applyCRTable(CR_SCALING_FACTORY);
    onCRTableChanged();
    showToast("Restored factory default CR scaling. Save to make it stick.");
  });

  document.getElementById('cr-export-btn')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(CR_SCALING_TABLE, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cr_scaling.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast("Exported cr_scaling.json file download!");
  });

  document.getElementById('cr-import-btn')?.addEventListener('click', () => {
    document.getElementById('cr-import-file-input')?.click();
  });

  document.getElementById('cr-import-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        applyCRTable(data);
        onCRTableChanged();
        showToast("Imported CR scaling table. Save to make it stick.");
      } catch (err) {
        alert("Failed to import CR scaling JSON: " + err.message);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });
}

/* ---------------- CR curve tool ----------------
   Sweeps one column from a start value at the low CR to an end value at the
   high CR. `t` runs over the *rows* in range rather than the raw CR numbers,
   because the table's low end is fractional (0, 1/8, 1/4, 1/2) — spreading by
   CR value would squash those four rows into the first 2.5% of the curve. */

const CR_CURVE_SHAPES = {
  linear: (t) => t,
  easeIn: (t, p) => Math.pow(t, p),
  easeOut: (t, p) => 1 - Math.pow(1 - t, p),
  sCurve: (t, p) => {
    const a = Math.pow(t, p);
    const b = Math.pow(1 - t, p);
    return (a + b) === 0 ? t : a / (a + b);
  },
  exp: (t, p) => (Math.exp(p * t) - 1) / (Math.exp(p) - 1)
};

function crCurveEase(t, shape, power) {
  const fn = CR_CURVE_SHAPES[shape] || CR_CURVE_SHAPES.linear;
  const clamped = Math.min(1, Math.max(0, t));
  return Math.min(1, Math.max(0, fn(clamped, power)));
}

/* Read the whole curve panel into one object, plus the CR rows it covers. */
function crCurveSettings() {
  const keys = crKeys();
  const from = Number(document.getElementById('cr-curve-from')?.value ?? keys[0]);
  const to = Number(document.getElementById('cr-curve-to')?.value ?? keys[keys.length - 1]);
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return {
    field: document.getElementById('cr-curve-column')?.value || 'hpPct',
    lo, hi,
    range: keys.filter(k => k >= lo && k <= hi),
    start: Number(document.getElementById('cr-curve-start')?.value ?? 0),
    end: Number(document.getElementById('cr-curve-end')?.value ?? 0),
    shape: document.getElementById('cr-curve-shape')?.value || 'linear',
    power: Number(document.getElementById('cr-curve-power')?.value ?? 2)
  };
}

/* The value the curve wants at row index `i` of `range`. */
function crCurveValueAt(cfg, i) {
  const span = cfg.range.length - 1;
  const t = span > 0 ? i / span : 0;
  const v = cfg.start + (cfg.end - cfg.start) * crCurveEase(t, cfg.shape, cfg.power);
  return Math.max(0, Math.round(v));
}

function setupCRCurveTool(keys) {
  const fromSel = document.getElementById('cr-curve-from');
  const toSel = document.getElementById('cr-curve-to');
  if (fromSel && toSel && keys.length) {
    const opts = keys.map(k => `<option value="${k}">CR ${formatCR(k)}</option>`).join('');
    fromSel.innerHTML = opts;
    toSel.innerHTML = opts;
    fromSel.value = String(keys[0]);
    toSel.value = String(keys[keys.length - 1]);
  }

  const powerEl = document.getElementById('cr-curve-power');
  const powerLabel = document.getElementById('cr-curve-power-label');
  const syncPowerLabel = () => {
    if (powerLabel) powerLabel.textContent = Number(powerEl?.value ?? 2).toFixed(1);
  };
  syncPowerLabel();

  const ids = ['cr-curve-column', 'cr-curve-from', 'cr-curve-to', 'cr-curve-start',
    'cr-curve-end', 'cr-curve-shape', 'cr-curve-power'];
  for (const id of ids) {
    document.getElementById(id)?.addEventListener('input', () => {
      syncPowerLabel();
      renderCRCurvePreview();
    });
  }

  document.getElementById('cr-curve-fit')?.addEventListener('click', () => {
    const cfg = crCurveSettings();
    if (!cfg.range.length) return;
    const first = cfg.range[0];
    const last = cfg.range[cfg.range.length - 1];
    const startEl = document.getElementById('cr-curve-start');
    const endEl = document.getElementById('cr-curve-end');
    if (startEl) startEl.value = String(CR_SCALING_TABLE[first]?.[cfg.field] ?? 0);
    if (endEl) endEl.value = String(CR_SCALING_TABLE[last]?.[cfg.field] ?? 0);
    renderCRCurvePreview();
    showToast(`Seeded the curve from the table: CR ${formatCR(first)} → CR ${formatCR(last)}.`);
  });

  document.getElementById('cr-curve-apply')?.addEventListener('click', () => {
    const cfg = crCurveSettings();
    if (!cfg.range.length) {
      showToast("That CR range doesn't cover any rows.");
      return;
    }
    cfg.range.forEach((k, i) => {
      CR_SCALING_TABLE[k][cfg.field] = crCurveValueAt(cfg, i);
    });
    onCRTableChanged();
    const label = CR_COLUMN_LABEL[cfg.field] || cfg.field;
    showToast(`Curved ${label} across CR ${formatCR(cfg.lo)}–${formatCR(cfg.hi)}: ` +
      `${cfg.start} → ${cfg.end} (${CR_SHAPE_LABEL[cfg.shape] || cfg.shape}).`);
  });

  renderCRCurvePreview();
}

const CR_COLUMN_LABEL = { acPct: 'AC %', hpPct: 'HP %', atkPct: 'Atk %', statPct: 'Stat %' };
const CR_SHAPE_LABEL = {
  linear: 'linear', easeIn: 'ease in', easeOut: 'ease out',
  sCurve: 'S-curve', exp: 'exponential'
};

/* Sparkline of the curve about to be applied, with the linear sweep behind it
   as a reference so the shape's effect is legible at a glance. */
function renderCRCurvePreview() {
  const svg = document.getElementById('cr-curve-preview');
  if (!svg) return;

  const cfg = crCurveSettings();
  const W = 160, H = 44, PAD = 4;
  if (cfg.range.length < 2) {
    svg.innerHTML = `<text x="${W / 2}" y="${H / 2 + 4}" fill="#8b8fa3" font-size="9"
      text-anchor="middle">range too small</text>`;
    return;
  }

  const values = cfg.range.map((_, i) => crCurveValueAt(cfg, i));
  const lo = Math.min(...values, cfg.start, cfg.end);
  const hi = Math.max(...values, cfg.start, cfg.end);
  const span = (hi - lo) || 1;

  const xAt = (i) => PAD + (i / (cfg.range.length - 1)) * (W - PAD * 2);
  const yAt = (v) => H - PAD - ((v - lo) / span) * (H - PAD * 2);

  const pts = values.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
  const linear = cfg.range
    .map((_, i) => {
      const t = i / (cfg.range.length - 1);
      return `${xAt(i).toFixed(1)},${yAt(cfg.start + (cfg.end - cfg.start) * t).toFixed(1)}`;
    })
    .join(' ');

  svg.innerHTML =
    `<polyline points="${linear}" fill="none" stroke="#8b8fa3" stroke-width="1"
       stroke-dasharray="3 3" opacity="0.5"/>` +
    `<polyline points="${pts}" fill="none" stroke="#d9a441" stroke-width="1.8"
       stroke-linejoin="round"/>`;
}

/* Copy `src` values onto the live table without swapping the object reference
   (other modules hold that reference). Unknown CR rows in `src` are ignored. */
function applyCRTable(src) {
  for (const k of crKeys()) {
    for (const f of CR_FIELDS) {
      const v = src?.[k]?.[f];
      if (typeof v === 'number' && isFinite(v)) CR_SCALING_TABLE[k][f] = v;
    }
  }
}

function crTableMatchesBaseline() {
  return crKeys().every(k => CR_FIELDS.every(f => CR_SCALING_TABLE[k][f] === crSavedBaseline[k]?.[f]));
}

/* Re-render the table + anything downstream that renders scaled monster stats. */
function onCRTableChanged(clean = false) {
  crDirty = clean ? false : !crTableMatchesBaseline();
  renderCRTable();
  if (getCurrentMonster()) renderMonsterStats();
}

function renderCRTable() {
  const tbody = document.getElementById('cr-table-body');
  if (!tbody) return;

  const showPreview = document.getElementById('cr-preview-toggle')?.checked !== false;
  const previewMode = document.getElementById('cr-preview-mode')?.value || 'sample';

  const rows = crKeys().map(k => {
    const row = CR_SCALING_TABLE[k];
    const base = crSavedBaseline[k] || {};
    const rowDirty = CR_FIELDS.some(f => row[f] !== base[f]);
    const inputs = CR_FIELDS.map(f => `
      <td><input type="number" class="cr-input ${row[f] !== base[f] ? 'changed' : ''}"
                 data-cr="${k}" data-field="${f}" value="${row[f] ?? 0}" step="5" min="0"></td>
    `).join('');
    return `
      <tr class="${rowDirty ? 'cr-row-dirty' : ''}">
        <td>
          <div class="cr-label">CR ${formatCR(k)}</div>
          <div class="cr-count">${countMonstersAtCR(k)} mob${countMonstersAtCR(k) === 1 ? '' : 's'}</div>
        </td>
        ${inputs}
        <td class="cr-preview">${showPreview ? crPreviewHtml(k, previewMode) : '—'}</td>
        <td><button class="btn btn-xs cr-row-reset" data-cr="${k}" title="Reset this CR row to factory defaults">↺</button></td>
      </tr>
    `;
  });

  tbody.innerHTML = rows.join('');

  tbody.querySelectorAll('.cr-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const cr = Number(e.target.dataset.cr);
      const field = e.target.dataset.field;
      const val = Math.max(0, Math.round(Number(e.target.value) || 0));
      CR_SCALING_TABLE[cr][field] = val;
      onCRTableChanged();
    });
  });

  tbody.querySelectorAll('.cr-row-reset').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const cr = Number(e.currentTarget.dataset.cr);
      for (const f of CR_FIELDS) {
        const v = CR_SCALING_FACTORY[cr]?.[f];
        if (typeof v === 'number') CR_SCALING_TABLE[cr][f] = v;
      }
      onCRTableChanged();
    });
  });

  const indicator = document.getElementById('cr-dirty-indicator');
  if (indicator) indicator.textContent = crDirty ? '● Unsaved changes' : '';
}

function monstersAtCR(cr) {
  return MONSTERS_RAW.filter(m => (m.cr || 0) === cr);
}

function countMonstersAtCR(cr) {
  return monstersAtCR(cr).length;
}

function avgHp(hp) {
  if (!hp) return 0;
  return Math.floor(hp[0] * ((hp[1] || 6) + 1) / 2 + (hp[2] || 0));
}

/* Concrete "what does this row actually do" readout: base → scaled AC / HP /
   to-hit for a real monster sitting at that CR (or the mean across all of them). */
function crPreviewHtml(cr, mode) {
  const mobs = monstersAtCR(cr);
  if (!mobs.length) return '<span class="cr-base">no monsters at this CR</span>';

  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const sample = mode === 'average' ? mobs : [mobs[0]];
  const scaled = sample.map(applyCRScalingToMonster);

  const acB = mean(sample.map(m => m.ac || 0));
  const acS = mean(scaled.map(m => m.ac || 0));
  const hpB = mean(sample.map(m => avgHp(m.hp)));
  const hpS = mean(scaled.map(m => avgHp(m.hp)));
  const atB = mean(sample.map(m => m.atk || 0));
  const atS = mean(scaled.map(m => m.atk || 0));

  const n = v => (Math.round(v * 10) / 10);
  const label = mode === 'average'
    ? `avg of ${mobs.length}`
    : mobs[0].name;

  return `<span class="cr-base">${label}:</span>
    AC <span class="cr-base">${n(acB)}→</span><b>${n(acS)}</b> ·
    HP <span class="cr-base">${n(hpB)}→</span><b>${n(hpS)}</b> ·
    Hit <span class="cr-base">${fmtMod(n(atB))}→</span><b>${fmtMod(n(atS))}</b>`;
}

async function saveCRScaling() {
  const payload = JSON.stringify(CR_SCALING_TABLE, null, 2);
  try {
    const res = await fetch('/api/save-cr-scaling', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        crSavedBaseline = deepCloneTable(CR_SCALING_TABLE);
        crDirty = false;
        renderCRTable();
        showToast("💾 Saved CR scaling to src/game/cr_scaling.json — reload the game to apply.");
        return;
      }
    }
  } catch (e) {
    console.warn("Direct server save unavailable, falling back to download", e);
  }
  document.getElementById('cr-export-btn')?.click();
}

/* ---------------- SPAWN BUDGET (ENCOUNTER DENSITY) EDITOR ----------------
   The dungeon generator gives every combat/elite/boss room a threat budget and
   spends it buying monster tiers. Edits mutate the live SPAWN_BUDGET object
   imported from the generator, so the preview here always runs the same numbers
   the generator would; "Save to Codebase" writes spawn_budget.json, which is
   what the game itself loads. */

const SB_KNOBS = [
  {
    path: 'baseBudget', name: 'Base room budget', min: 20, max: 600, step: 5, dec: 0,
    desc: 'Threat points a room starts with, before difficulty and room-type multipliers.'
  },
  {
    path: 'difficultyFloor', name: 'Difficulty floor', min: 0, max: 1.5, step: 0.05, dec: 2,
    desc: 'Share of the base budget the shallowest room (difficulty 0) still gets.'
  },
  {
    path: 'difficultySpan', name: 'Difficulty span', min: 0, max: 2, step: 0.05, dec: 2,
    desc: 'Extra share added as room difficulty climbs to 1 (the deepest room).'
  },
  {
    path: 'typeMult.combat', name: 'Combat room ×', min: 0.1, max: 4, step: 0.05, dec: 2,
    desc: 'Budget multiplier for ordinary combat rooms.'
  },
  {
    path: 'typeMult.elite', name: 'Elite room ×', min: 0.1, max: 4, step: 0.05, dec: 2,
    desc: 'Budget multiplier for elite rooms (which also spawn at tier 5).'
  },
  {
    path: 'typeMult.boss', name: 'Boss room ×', min: 0.1, max: 6, step: 0.05, dec: 2,
    desc: 'Budget multiplier for the boss room (tier 3 minimum).'
  },
  {
    path: 'maxSpawns', name: 'Spawn cap per room', min: 1, max: 40, step: 1, dec: 0,
    desc: 'Hard ceiling on monsters bought by the generic room roll, however much budget is left.'
  },
  {
    path: 'hordeMaxSpawns', name: 'Horde spawn cap (Infestation / Nest)', min: 5, max: 40, step: 1, dec: 0,
    desc: 'Ceiling on monster count for Infestation and Brood Nest rooms, allowing swarms to bypass standard room limits.'
  },
  {
    path: 'overspendSlack', name: 'Overspend slack', min: 0, max: 1.5, step: 0.05, dec: 2,
    desc: 'How far the last buy may exceed the leftover budget, as a fraction of its own cost. Higher = fuller rooms.'
  },
];

let sbSavedBaseline = deepCloneTable(SPAWN_BUDGET);
let sbDirty = false;

function sbGet(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function sbSet(obj, path, val) {
  const parts = path.split('.');
  const last = parts.pop();
  const target = parts.reduce((o, k) => (o[k] ||= {}), obj);
  target[last] = val;
}

function sbTierKeys() {
  /* CR sample points for the read-only cost-curve table. Costs come from the
     crToCost formula (scaled by crCostScale), so these are display points only. */
  return [0.125, 0.25, 0.5, 1, 2, 3, 5, 8, 12, 17, 23, 30];
}

function sbLevelKeys() {
  return Object.keys(SPAWN_BUDGET.levelCurve || {}).map(Number).filter(n => isFinite(n)).sort((a, b) => a - b);
}

const SB_LEVEL_FIELDS = ['budgetMult', 'spawnCap'];

function setupSpawnBudgetTab() {
  const live = getSpawnBudget();
  applySpawnBudget(live);
  sbSavedBaseline = deepCloneTable(live);

  const densitySlider = document.getElementById('sb-density-slider');
  const densityLabel = document.getElementById('sb-density-label');
  densitySlider?.addEventListener('input', () => {
    if (densityLabel) densityLabel.textContent = `${Number(densitySlider.value).toFixed(2)}×`;
  });

  document.getElementById('sb-density-apply')?.addEventListener('click', () => {
    const factor = Number(densitySlider?.value || 1);
    SPAWN_BUDGET.baseBudget = Math.round((sbSavedBaseline.baseBudget ?? 150) * factor);
    onSpawnBudgetChanged();
    showToast(`Base room budget set to ${SPAWN_BUDGET.baseBudget} (${factor.toFixed(2)}× the saved baseline).`);
  });

  document.getElementById('sb-tier-apply')?.addEventListener('click', () => {
    /* The per-tier cost table is gone; the whole CR-cost curve scales by a
       single `crCostScale` multiplier. This control applies set/mul to it. */
    const op = document.getElementById('sb-tier-op')?.value || 'mul';
    const val = Number(document.getElementById('sb-tier-value')?.value || 1);
    const cur = SPAWN_BUDGET.crCostScale ?? 1;
    let next = cur;
    if (op === 'add') next = cur + val;
    else if (op === 'mul') next = cur * val;
    else if (op === 'set') next = val;
    SPAWN_BUDGET.crCostScale = Math.max(0.05, Math.round(next * 100) / 100);
    onSpawnBudgetChanged();
    showToast(`CR-cost scale set to ${SPAWN_BUDGET.crCostScale} (every spawn cost × this).`);
  });

  document.getElementById('sb-tier-overrides-reset-btn')?.addEventListener('click', () => {
    const len = Object.keys(sbCrCostOverrides).length;
    if (len > 0 && !confirm(`Reset all ${len} cost overrides back to formula values?`)) return;
    for (const k of Object.keys(sbCrCostOverrides)) delete sbCrCostOverrides[k];
    onSpawnBudgetChanged();
    showToast("All CR cost overrides cleared. Costs now use the default formula.");
  });

  // Level range dropdowns for the curve ramp tool.
  const rampFrom = document.getElementById('sb-ramp-from');
  const rampTo = document.getElementById('sb-ramp-to');
  const levels = sbLevelKeys();
  if (rampFrom && rampTo && levels.length) {
    const opts = levels.map(l => `<option value="${l}">Level ${l}</option>`).join('');
    rampFrom.innerHTML = opts;
    rampTo.innerHTML = opts;
    rampFrom.value = String(levels[0]);
    rampTo.value = String(levels[levels.length - 1]);
  }

  document.getElementById('sb-ramp-apply')?.addEventListener('click', () => {
    const from = Number(rampFrom?.value ?? 1);
    const to = Number(rampTo?.value ?? 20);
    const lo = Math.min(from, to), hi = Math.max(from, to);
    const m0 = Number(document.getElementById('sb-ramp-mult-start')?.value ?? 1);
    const m1 = Number(document.getElementById('sb-ramp-mult-end')?.value ?? 1);
    const c0 = Number(document.getElementById('sb-ramp-cap-start')?.value ?? 10);
    const c1 = Number(document.getElementById('sb-ramp-cap-end')?.value ?? 10);
    const span = Math.max(1, hi - lo);

    for (const l of sbLevelKeys()) {
      if (l < lo || l > hi) continue;
      const t = (l - lo) / span;
      const row = (SPAWN_BUDGET.levelCurve[l] ||= {});
      row.budgetMult = Math.max(0.05, Math.round((m0 + (m1 - m0) * t) * 100) / 100);
      row.spawnCap = Math.max(1, Math.round(c0 + (c1 - c0) * t));
    }
    onSpawnBudgetChanged();
    showToast(`Ramped levels ${lo}–${hi}: budget ×${m0}→×${m1}, cap ${c0}→${c1}.`);
  });

  document.getElementById('sb-preview-level')?.addEventListener('change', () => {
    renderSpawnBudgetPreview();
    renderSpawnTierTable();
    renderSpawnLevelTable();
  });

  document.getElementById('sb-preview-difficulty')?.addEventListener('input', (e) => {
    const label = document.getElementById('sb-preview-difficulty-label');
    if (label) label.textContent = Number(e.target.value).toFixed(2);
    renderSpawnBudgetPreview();
    renderSpawnTierTable();
    renderSpawnLevelTable();
  });

  document.getElementById('sb-preview-threatmult')?.addEventListener('change', () => {
    renderSpawnBudgetPreview();
    renderSpawnTierTable();
    renderSpawnLevelTable();
  });

  document.getElementById('sb-save-btn')?.addEventListener('click', saveSpawnBudget);

  document.getElementById('sb-revert-btn')?.addEventListener('click', () => {
    applySpawnBudget(sbSavedBaseline);
    onSpawnBudgetChanged(true);
    showToast("Reverted to the last saved spawn budget values.");
  });

  document.getElementById('sb-reset-btn')?.addEventListener('click', () => {
    if (!confirm("Reset every spawn budget lever back to factory defaults?")) return;
    try { localStorage.removeItem('dc_spawn_budget_edits'); } catch {}
    applySpawnBudget(SPAWN_BUDGET_FACTORY);
    onSpawnBudgetChanged();
    showToast("Restored factory default spawn budget. Save to make it stick.");
  });

  document.getElementById('sb-export-btn')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(SPAWN_BUDGET, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'spawn_budget.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast("Exported spawn_budget.json file download!");
  });

  document.getElementById('sb-import-btn')?.addEventListener('click', () => {
    document.getElementById('sb-import-file-input')?.click();
  });

  document.getElementById('sb-import-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        applySpawnBudget(JSON.parse(ev.target.result));
        onSpawnBudgetChanged();
        showToast("Imported spawn budget. Save to make it stick.");
      } catch (err) {
        alert("Failed to import spawn budget JSON: " + err.message);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  /* CR anchor point editing */
  document.getElementById('sb-anchor-add-btn')?.addEventListener('click', () => {
    const anchors = sbCrAnchors();
    const last = anchors[anchors.length - 1];
    const newLevel = last ? Math.min(40, last.level + 4) : 10;
    const newCR = last ? Math.min(50, last.cr + 3) : 5;
    anchors.push({ level: newLevel, cr: newCR });
    sbWriteAnchors(anchors);
    onSpawnBudgetChanged();
    showToast(`Added anchor at Level ${newLevel} / CR ${formatCR(newCR)}.`);
  });

  document.getElementById('sb-anchor-reset-btn')?.addEventListener('click', () => {
    if (!confirm("Reset CR anchor points to factory defaults?")) return;
    SPAWN_BUDGET.crAnchorLevels = [...SPAWN_BUDGET_FACTORY.crAnchorLevels];
    SPAWN_BUDGET.crAnchorCRs = [...SPAWN_BUDGET_FACTORY.crAnchorCRs];
    onSpawnBudgetChanged();
    showToast("CR anchors reset to factory defaults.");
  });
}

/* Copy `src` values onto the live object without swapping the reference (the
   dungeon generator holds that reference). Unknown keys are ignored. */
function applySpawnBudget(src) {
  for (const k of SB_KNOBS) {
    const v = sbGet(src, k.path);
    if (typeof v === 'number' && isFinite(v)) sbSet(SPAWN_BUDGET, k.path, v);
  }
  if (typeof src?.crCostScale === 'number' && isFinite(src.crCostScale)) {
    SPAWN_BUDGET.crCostScale = src.crCostScale;
  }
  if (Array.isArray(src?.crAnchorLevels)) SPAWN_BUDGET.crAnchorLevels = [...src.crAnchorLevels];
  if (Array.isArray(src?.crAnchorCRs)) SPAWN_BUDGET.crAnchorCRs = [...src.crAnchorCRs];
  if (src?.crCostOverrides && typeof src.crCostOverrides === 'object') {
    for (const k of Object.keys(sbCrCostOverrides)) delete sbCrCostOverrides[k];
    Object.assign(sbCrCostOverrides, JSON.parse(JSON.stringify(src.crCostOverrides)));
  } else {
    for (const k of Object.keys(sbCrCostOverrides)) delete sbCrCostOverrides[k];
  }
  for (const l of sbLevelKeys()) {
    for (const f of SB_LEVEL_FIELDS) {
      const v = src?.levelCurve?.[l]?.[f];
      if (typeof v === 'number' && isFinite(v)) SPAWN_BUDGET.levelCurve[l][f] = v;
    }
  }
}

function sbMatchesBaseline() {
  return SB_KNOBS.every(k => sbGet(SPAWN_BUDGET, k.path) === sbGet(sbSavedBaseline, k.path))
    && (SPAWN_BUDGET.crCostScale ?? 1) === (sbSavedBaseline.crCostScale ?? 1)
    && sbLevelKeys().every(l => SB_LEVEL_FIELDS.every(
      f => SPAWN_BUDGET.levelCurve[l][f] === sbSavedBaseline.levelCurve?.[l]?.[f]))
    && sbCrAnchorsString(SPAWN_BUDGET) === sbCrAnchorsString(sbSavedBaseline)
    && JSON.stringify(sbCrCostOverrides) === JSON.stringify(sbSavedBaseline.crCostOverrides || {});
}

function onSpawnBudgetChanged(clean = false) {
  sbDirty = clean ? false : !sbMatchesBaseline();
  try {
    localStorage.setItem('dc_spawn_budget_edits', JSON.stringify(SPAWN_BUDGET));
  } catch (e) {
    console.warn('Failed to save spawn budget to localStorage', e);
  }
  renderSpawnBudget();
}

function renderSpawnBudget() {
  renderSpawnKnobs();
  renderSpawnTierTable();
  renderSpawnLevelTable();
  renderCrAnchorTable();
  renderSpawnBudgetPreview();
  const indicator = document.getElementById('sb-dirty-indicator');
  if (indicator) indicator.textContent = sbDirty ? '● Unsaved changes' : '';
}

function renderSpawnKnobs() {
  const grid = document.getElementById('sb-knob-grid');
  if (!grid) return;

  grid.innerHTML = SB_KNOBS.map(k => {
    const val = Number(sbGet(SPAWN_BUDGET, k.path) ?? 0);
    const base = Number(sbGet(sbSavedBaseline, k.path) ?? 0);
    return `
      <div class="sb-knob ${val !== base ? 'changed' : ''}">
        <div class="sb-knob-head">
          <span class="sb-knob-name">${k.name}</span>
          <span class="sb-knob-val">${val.toFixed(k.dec)}</span>
        </div>
        <div class="sb-knob-row">
          <input type="range" class="sb-range" data-path="${k.path}"
                 min="${k.min}" max="${k.max}" step="${k.step}" value="${val}">
          <input type="number" class="sb-num" data-path="${k.path}"
                 min="${k.min}" step="${k.step}" value="${val.toFixed(k.dec)}">
        </div>
        <div class="sb-knob-desc">${k.desc}</div>
      </div>
    `;
  }).join('');

  const commit = (path, raw) => {
    const knob = SB_KNOBS.find(k => k.path === path);
    if (!knob) return;
    let v = Number(raw);
    if (!isFinite(v)) v = Number(sbGet(SPAWN_BUDGET, path)) || 0;
    v = Math.max(knob.min, Math.min(knob.max, v));
    if (knob.dec === 0) v = Math.round(v);
    else v = Math.round(v / knob.step) * knob.step;
    sbSet(SPAWN_BUDGET, path, Number(v.toFixed(4)));
    onSpawnBudgetChanged();
  };

  grid.querySelectorAll('.sb-range').forEach(el => {
    el.addEventListener('change', e => commit(e.target.dataset.path, e.target.value));
    // Live number readout while dragging, without a full re-render per frame.
    el.addEventListener('input', e => {
      const knob = SB_KNOBS.find(k => k.path === e.target.dataset.path);
      const card = e.target.closest('.sb-knob');
      const out = card?.querySelector('.sb-knob-val');
      const num = card?.querySelector('.sb-num');
      if (out && knob) out.textContent = Number(e.target.value).toFixed(knob.dec);
      if (num && knob) num.value = Number(e.target.value).toFixed(knob.dec);
    });
  });

  grid.querySelectorAll('.sb-num').forEach(el => {
    el.addEventListener('change', e => commit(e.target.dataset.path, e.target.value));
  });
}

/* The generator's own budget formula, so the editor can't drift from it. */
/* Both of these delegate to the generator so the tab always previews the real
   formula. They were duplicated here, which is how the preview drifts. */
function sbRoomBudget(roomType, difficulty, threatMult, level = 1) {
  return roomSpawnBudget(roomType, difficulty, threatMult, level, SPAWN_BUDGET);
}

/* Effective per-room monster ceiling: the global cap, tightened by the level. */
function sbSpawnCap(level = 1) {
  return roomSpawnCap(level, SPAWN_BUDGET);
}

function sbPreviewSettings() {
  return {
    difficulty: Number(document.getElementById('sb-preview-difficulty')?.value ?? 0.5),
    threatMult: Number(document.getElementById('sb-preview-threatmult')?.value || 1),
    level: Math.max(1, Math.round(Number(document.getElementById('sb-preview-level')?.value) || 1))
  };
}

/* CR a dungeon of this level actually fields. Uses the shared curve in
   constants.js — the same one game.js resolves spawns with and the generator
   prices against — so this readout can't drift from the game. */
function sbTierLabelForLevel(level) {
  const max = maxCrForDungeonLevel(level, SPAWN_BUDGET);
  return `CR ≤ ${formatCR(max)}`;
}

function renderSpawnLevelTable() {
  const tbody = document.getElementById('sb-level-table-body');
  if (!tbody) return;

  const { threatMult, level: previewLevel } = sbPreviewSettings();

  tbody.innerHTML = sbLevelKeys().map(l => {
    const row = SPAWN_BUDGET.levelCurve[l] || {};
    const base = sbSavedBaseline.levelCurve?.[l] || {};
    const dirty = SB_LEVEL_FIELDS.some(f => row[f] !== base[f]);
    const cap = Math.min(SPAWN_BUDGET.maxSpawns ?? 10, row.spawnCap ?? 99);
    /* Priced at the level's ceiling CR — the generator's crForDungeonLevel roll
       lands there at every anchor level, so this matches what the floor actually
       fields and agrees with the simulation card below. Pricing at the old floor
       CR understated cost and over-promised escort counts. */
    const cost = sbCrToCost(maxCrForDungeonLevel(l, SPAWN_BUDGET));

    // Shallowest and deepest room of a floor at this level, in monsters.
    const near = sbRoomBudget('combat', 0.15, threatMult, l);
    const far = sbRoomBudget('combat', 1.0, threatMult, l);
    const boss = sbRoomBudget('boss', 1.0, threatMult, l);
    const n = b => Math.min(cap, Math.max(1, Math.floor(b / cost)));

    return `
      <tr class="${dirty ? 'cr-row-dirty' : ''} ${l === previewLevel ? 'sb-row-current' : ''}">
        <td><span class="sb-tier-label">Level ${l}</span></td>
        <td><input type="number" class="cr-input sb-level-field ${row.budgetMult !== base.budgetMult ? 'changed' : ''}"
                   data-level="${l}" data-field="budgetMult" value="${row.budgetMult ?? 1}" min="0.05" step="0.05"></td>
        <td><input type="number" class="cr-input sb-level-field ${row.spawnCap !== base.spawnCap ? 'changed' : ''}"
                   data-level="${l}" data-field="spawnCap" value="${row.spawnCap ?? 10}" min="1" step="1"></td>
        <td class="cr-count">${sbTierLabelForLevel(l)}</td>
        <td class="cr-preview">
          first rooms <b>${n(near)}</b> <span class="cr-base">(${near})</span> ·
          deep rooms <b>${n(far)}</b> <span class="cr-base">(${far})</span> ·
          boss escort <b>${n(boss)}</b> <span class="cr-base">(${boss})</span>
        </td>
        <td><button class="btn btn-xs sb-level-reset" data-level="${l}" title="Reset this level to the factory default">↺</button></td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.sb-level-field').forEach(input => {
    input.addEventListener('change', e => {
      const l = e.target.dataset.level;
      const f = e.target.dataset.field;
      let v = Number(e.target.value);
      if (!isFinite(v)) return renderSpawnLevelTable();
      v = f === 'spawnCap' ? Math.max(1, Math.round(v)) : Math.max(0.05, Math.round(v * 100) / 100);
      (SPAWN_BUDGET.levelCurve[l] ||= {})[f] = v;
      onSpawnBudgetChanged();
    });
  });

  tbody.querySelectorAll('.sb-level-reset').forEach(btn => {
    btn.addEventListener('click', e => {
      const l = e.currentTarget.dataset.level;
      for (const f of SB_LEVEL_FIELDS) {
        const v = SPAWN_BUDGET_FACTORY.levelCurve?.[l]?.[f];
        if (typeof v === 'number') (SPAWN_BUDGET.levelCurve[l] ||= {})[f] = v;
      }
      onSpawnBudgetChanged();
    });
  });
}

function countMonstersAtTier(cr) {
  /* Counts monsters whose CR matches the sample point exactly (the curve table
     shows how many real stat blocks sit at each CR). */
  return MONSTERS_RAW.filter(m => Math.abs((m.cr || 0) - cr) < 0.01).length;
}

/* -------- CR anchor editing -------- */

function sbCrAnchors(source = SPAWN_BUDGET) {
  const levels = source.crAnchorLevels || [1, 4, 8, 12, 16];
  const crs = source.crAnchorCRs || [0.25, 1, 3, 6, 10];
  const len = Math.min(levels.length, crs.length);
  const pairs = [];
  for (let i = 0; i < len; i++) {
    pairs.push({ level: levels[i], cr: crs[i] });
  }
  pairs.sort((a, b) => a.level - b.level);
  return pairs;
}

function sbCrAnchorsBaseline() {
  return JSON.stringify(sbCrAnchors(sbSavedBaseline));
}

function sbCrAnchorsString(source = SPAWN_BUDGET) {
  return JSON.stringify(sbCrAnchors(source));
}

function sbWriteAnchors(anchors) {
  const sorted = [...anchors].sort((a, b) => a.level - b.level);
  SPAWN_BUDGET.crAnchorLevels = sorted.map(a => a.level);
  SPAWN_BUDGET.crAnchorCRs = sorted.map(a => a.cr);
}

function renderCrAnchorTable() {
  const tbody = document.getElementById('sb-anchor-table-body');
  if (!tbody) return;

  const anchors = sbCrAnchors();
  const baseStr = sbCrAnchorsBaseline();
  const curStr = sbCrAnchorsString();
  const dirty = curStr !== baseStr;

  tbody.innerHTML = anchors.map((a, i) => {
    const lvl = a.level;
    const base = baseCrForDungeonLevel(lvl, SPAWN_BUDGET);
    const up = crUpChanceForDungeonLevel(lvl, SPAWN_BUDGET);
    const preview = up <= 0
      ? `CR ${formatCR(base)}`
      : `CR ${formatCR(base)}+ (${Math.round(up * 100)}% roll-up)`;
    const isLast = anchors.length <= 2;
    return `
      <tr class="${dirty ? 'cr-row-dirty' : ''}">
        <td><input type="number" class="cr-input sb-anchor-level" data-idx="${i}"
                   value="${lvl}" min="1" max="40" step="1"></td>
        <td><input type="number" class="cr-input sb-anchor-cr" data-idx="${i}"
                   value="${a.cr}" min="0.0625" max="50" step="0.0625"></td>
        <td class="cr-preview">${preview}</td>
        <td>${isLast ? '' : `<button class="btn btn-xs sb-anchor-remove" data-idx="${i}" title="Remove this anchor">✕</button>`}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.sb-anchor-level').forEach(input => {
    input.addEventListener('change', e => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const v = Math.max(1, Math.min(40, Math.round(Number(e.target.value)) || 1));
      const anchors = sbCrAnchors();
      if (idx >= 0 && idx < anchors.length) {
        anchors[idx].level = v;
        sbWriteAnchors(anchors);
        onSpawnBudgetChanged();
      }
    });
  });

  tbody.querySelectorAll('.sb-anchor-cr').forEach(input => {
    input.addEventListener('change', e => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const v = Math.max(0.0625, Math.min(50, Math.round(Number(e.target.value) * 16) / 16));
      const anchors = sbCrAnchors();
      if (idx >= 0 && idx < anchors.length) {
        anchors[idx].cr = v;
        sbWriteAnchors(anchors);
        onSpawnBudgetChanged();
      }
    });
  });

  tbody.querySelectorAll('.sb-anchor-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = parseInt(e.currentTarget.dataset.idx, 10);
      const anchors = sbCrAnchors();
      if (anchors.length <= 2) {
        showToast("At least two anchor points are required.");
        return;
      }
      anchors.splice(idx, 1);
      sbWriteAnchors(anchors);
      onSpawnBudgetChanged();
      showToast("Anchor removed.");
    });
  });
}

function renderSpawnTierTable() {
  const tbody = document.getElementById('sb-tier-table-body');
  if (!tbody) return;

  const { difficulty, threatMult, level } = sbPreviewSettings();
  const combatBudget = sbRoomBudget('combat', difficulty, threatMult, level);
  const cap = sbSpawnCap(level);
  const lvlCR = baseCrForDungeonLevel(level, SPAWN_BUDGET);

  const overrides = sbCrCostOverrides;
  const scaleVal = SPAWN_BUDGET.crCostScale ?? 1;
  const scaleDirty = scaleVal !== (sbSavedBaseline.crCostScale ?? 1);

  tbody.innerHTML = sbTierKeys().map(cr => {
    const cost = sbCrToCost(cr);
    const formulaCost = Math.max(1, Math.round((8 + 13 * Math.pow(cr, 0.8)) * scaleVal));
    const hasOverride = sbCrCostOverrides.hasOwnProperty(String(cr));
    const rawFit = cost > 0 ? Math.floor(combatBudget / cost) : 0;
    const fit = Math.min(cap, rawFit);
    const capped = rawFit > cap;
    const roster = countMonstersAtTier(cr);
    const fielded = Math.abs(cr - lvlCR) < 0.01;
    const dirty = hasOverride || scaleDirty;
    return `
      <tr class="${dirty ? 'cr-row-dirty' : ''} ${fielded ? 'sb-row-current' : ''}">
        <td><span class="sb-tier-label">CR ${formatCR(cr)}</span>${fielded ? '<div class="cr-count">Lv ' + level + ' fields this</div>' : ''}</td>
        <td>
          <input type="number" class="cr-input sb-tier-cost" data-cr="${cr}"
                 value="${cost}" min="1" step="1"
                 style="width:72px;${hasOverride ? 'color:var(--gold-bright);font-weight:600' : ''}">
          ${hasOverride ? `<button class="btn btn-xs sb-tier-cost-revert" data-cr="${cr}" title="Revert to formula (${formulaCost})" style="margin-left:4px">↺</button>` : ''}
        </td>
        <td><div class="sb-bar" style="width:${Math.round(100 * cost / Math.max(1, sbCrToCost(sbTierKeys()[sbTierKeys().length - 1])))}%"></div></td>
        <td class="cr-count">${roster} mob${roster === 1 ? '' : 's'}</td>
        <td class="cr-preview"><b>${fit}</b> monster${fit === 1 ? '' : 's'}
          <span class="cr-base">(budget ${combatBudget}${capped ? `, clipped by the ${cap} spawn cap` : ''})</span></td>
        <td></td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.sb-tier-cost').forEach(input => {
    input.addEventListener('change', e => {
      const cr = e.target.dataset.cr;
      let v = Math.max(1, Math.round(Number(e.target.value)) || 1);
      const formulaCost = Math.max(1, Math.round((8 + 13 * Math.pow(Number(cr), 0.8)) * scaleVal));
      if (v === formulaCost) {
        delete sbCrCostOverrides[cr];
      } else {
        sbCrCostOverrides[cr] = v;
      }
      onSpawnBudgetChanged();
    });
  });

  tbody.querySelectorAll('.sb-tier-cost-revert').forEach(btn => {
    btn.addEventListener('click', e => {
      const cr = e.currentTarget.dataset.cr;
      delete sbCrCostOverrides[cr];
      onSpawnBudgetChanged();
    });
  });
}

/* Preview of a room's spend, on a fixed seed so it stays stable while knobs are
   dragged. This calls the generator's actual spend loop (buyRoomSpawns) rather
   than reimplementing it — the two used to be hand-kept copies, which is exactly
   how the tab and the game drift apart. sbCrToCost is injected so the preview
   reflects unsaved CR-cost edits. */
function sbSimulateRoom(roomType, difficulty, threatMult, level = 1, seed = 1337) {
  const res = buyRoomSpawns({
    level, roomType, difficulty, threatMult,
    data: SPAWN_BUDGET,
    rng: makeRng(seed).raw,
    costOf: sbCrToCost
  });
  return {
    budget: res.budget,
    crs: res.crs,
    spent: res.spent,
    naturalCR: baseCrForDungeonLevel(level, SPAWN_BUDGET)
  };
}

function renderSpawnBudgetPreview() {
  const grid = document.getElementById('sb-preview-grid');
  if (!grid) return;

  const { difficulty, threatMult, level } = sbPreviewSettings();

  grid.innerHTML = ['combat', 'elite', 'boss'].map(type => {
    const sim = sbSimulateRoom(type, difficulty, threatMult, level);
    /* Group the drawn CRs into bands for the chip readout. */
    const counts = {};
    for (const c of sim.crs) { const b = crBandIndex(c); counts[b] = (counts[b] || 0) + 1; }
    const chips = Object.keys(counts).sort((a, b) => a - b)
      .map(b => `<span class="sb-chip">${counts[b]}× CR band ${b}</span>`).join('');
    const label = type === 'combat' ? 'Combat room' : type === 'elite' ? 'Elite room' : 'Boss room';
    return `
      <div class="sb-preview-card ${type}">
        <div class="sb-preview-title">${label}</div>
        <div class="sb-preview-budget">${sim.budget} <span style="font-size:11px;color:var(--text-muted)">threat</span></div>
        <div class="sb-preview-line">
          <b>${sim.crs.length}</b> monster${sim.crs.length === 1 ? '' : 's'} ·
          spends ${sim.spent}/${sim.budget} ·
          cap ${sbSpawnCap(level)} ·
          budget ×${spawnLevelRow(level).budgetMult}
        </div>
        <div class="sb-preview-sub">Budget draw (sets the count):</div>
        <div>${chips}</div>
        <div class="sb-preview-sub">Actually spawned at Lv ${level}:</div>
        <div><span class="sb-chip actual">${sim.crs.length}× ${sbTierLabelForLevel(level)}</span></div>
      </div>
    `;
  }).join('');
}

async function saveSpawnBudget() {
  try {
    try { localStorage.setItem('dc_spawn_budget_edits', JSON.stringify(SPAWN_BUDGET)); } catch {}
    const res = await fetch('/api/save-spawn-budget', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SPAWN_BUDGET, null, 2)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        sbSavedBaseline = deepCloneTable(SPAWN_BUDGET);
        sbDirty = false;
        renderSpawnBudget();
        showToast("💾 Saved to src/game/spawn_budget.json successfully!");
        return;
      }
    }
  } catch (e) {
    console.warn("Direct server save unavailable, falling back to download", e);
  }
  document.getElementById('sb-export-btn')?.click();
}

/* ================= STORY QUEST CURATION TAB =================
   Curates each hand-authored story mission's cast: the mob pool per floor, the
   fallback roster, and the finale (boss creature, name, HP multiplier, escorts).

   Edits never touch story.js — they're written as overrides keyed by mission id
   into src/game/story_encounters.json, which story.js merges over the authored
   literals (see applyStoryEncounterOverride). localStorage holds the same shape
   so the running game picks up a change without a save. */

const STORY_EDITS_KEY = 'dc_story_encounter_edits';

let storyEdits = {};
let currentMissionId = STORY_MISSIONS_BASE[0]?.id || null;

/* Lane keys are the tier bands the missions were authored with. The generator
   flattens every lane into one candidate list and then filters it by the room's
   CR window, so the lanes are an authoring aid (and the CR spread is what
   actually decides which of them shows up at a given depth). */
const LANE_LABELS = {
  1: 'Tier 1 · Rank & file',
  2: 'Tier 2 · Elites',
  3: 'Tier 3 · Heavies',
  4: 'Tier 4',
  boss: 'Boss pool'
};

function laneLabel(key) {
  return LANE_LABELS[key] || `Tier ${key}`;
}

/* A mission can show ~25 "add creature" pickers at once and the option list is
   the same ~300 entries every time, so build it once per roster revision. */
let laneOptionsCache = null;

function laneOptionsHTML() {
  if (laneOptionsCache === null) laneOptionsCache = renderMonsterOptionsHTML();
  return laneOptionsCache;
}

function loadStoryEdits() {
  try {
    storyEdits = JSON.parse(localStorage.getItem(STORY_EDITS_KEY) || '{}') || {};
  } catch (e) {
    storyEdits = {};
  }
}

function persistStoryEdits() {
  try {
    localStorage.setItem(STORY_EDITS_KEY, JSON.stringify(storyEdits));
  } catch (e) {
    console.error('Failed to save story encounter edits', e);
  }
}

/* The lane/pool helpers are the game's own (srd.js), so the tab and the spawner
   never disagree about what a pool contains. */
const normalizePool = storyLanes;

/** Lane keys in authoring order: numeric tiers ascending, then the boss lane. */
function laneKeys(pool) {
  const nums = Object.keys(pool).filter(k => k !== 'boss').sort((a, b) => Number(a) - Number(b));
  return pool.boss ? [...nums, 'boss'] : nums;
}

/** The mission as the game will see it: authored data + saved + unsaved edits. */
function effectiveMission(id) {
  const base = STORY_MISSIONS_BASE.find(m => m.id === id);
  if (!base) return null;
  const m = JSON.parse(JSON.stringify(base));
  const ov = storyEdits[id];
  if (!ov) return m;

  if (ov.finalBossId) m.finalBossId = ov.finalBossId;
  if (ov.finalBossName != null) m.finalBossName = ov.finalBossName;
  if (ov.bossHpMult != null) m.bossHpMult = ov.bossHpMult;
  if (ov.monsterRoster) m.monsterRoster = JSON.parse(JSON.stringify(ov.monsterRoster));
  if (ov.bossEscorts) m.bossEscorts = JSON.parse(JSON.stringify(ov.bossEscorts));
  if (ov.floors && Array.isArray(m.floorPlan)) {
    for (const [idx, patch] of Object.entries(ov.floors)) {
      const f = m.floorPlan[Number(idx) - 1];
      if (!f || !patch) continue;
      if ('crBudget' in patch) {
        if (patch.crBudget == null) delete f.crBudget;
        else f.crBudget = patch.crBudget;
      }
      if (!patch.monsters) continue;
      /* mirrors applyStoryEncounterOverride: an empty pool clears the floor */
      if (Object.keys(patch.monsters).length) f.monsters = JSON.parse(JSON.stringify(patch.monsters));
      else delete f.monsters;
    }
  }
  return m;
}

/** Escorts as authored: missions have no escort field, so the baseline is the
 *  hard-coded thematic pair game.js falls back to for a few story bosses. */
const STORY_DEFAULT_ESCORTS = {
  'goblin-king': 'hobgoblin',
  'wight': 'skeleton',
  'death-knight': 'skeleton',
  'grick': 'giant-spider'
};

function effectiveEscorts(mission) {
  if (Array.isArray(mission.bossEscorts)) return mission.bossEscorts;
  const fallback = STORY_DEFAULT_ESCORTS[mission.finalBossId];
  return fallback ? [{ id: fallback, count: 2 }] : [];
}

function applyStoryEdit(id, changes) {
  storyEdits[id] = { ...(storyEdits[id] || {}), ...changes };
  persistStoryEdits();
  renderStoryQuestsTab();
}

function applyStoryFloorEdit(id, floorNo, patch) {
  const ov = storyEdits[id] || {};
  const floors = { ...(ov.floors || {}) };
  floors[String(floorNo)] = { ...(floors[String(floorNo)] || {}), ...patch };
  applyStoryEdit(id, { floors });
}

/* ---- CR-window reachability (generated quests only) -------------------------
   A THEME roster only gets used when at least one of its creatures lands inside
   the room's rolled CR window; when none do, spawnMonster silently widens to the
   whole bestiary and the roster is replaced by whatever CR happens to match.
   That is what the Dungeon Rosters tab reports.

   Story floors do NOT go through this: they spawn strictly from their whitelist
   against a per-floor CR budget (planStoryFloorCast), so a level-1 goblin camp
   can field bugbears and a goblin king's honour guard without the ceiling
   quietly swapping them out. */

function crWindowFor(level, targetCR) {
  return {
    minCR: Math.max(0, targetCR * 0.5),
    maxCR: Math.min(Math.max(targetCR * 1.5, targetCR + 0.5), maxCrForDungeonLevel(level))
  };
}

/** Share of rolls at this dungeon level where the pool can field a candidate.
 *  Seeded so the same pool always reports the same number. */
function poolHitRate(ids, level, samples = 400) {
  const crs = ids.map(id => getMonsterById(id)).filter(Boolean).map(m => m.cr ?? 0);
  if (!crs.length) return 0;
  const rng = makeRng(Math.round(level * 7919 + crs.length * 104729 + crs[0] * 31)).raw;
  let hits = 0;
  for (let i = 0; i < samples; i++) {
    const tcr = crForDungeonLevel(level, rng);
    const { minCR, maxCR } = crWindowFor(level, tcr);
    if (crs.some(c => c >= minCR && c <= maxCR)) hits++;
  }
  return hits / samples;
}

/* ---- Story floor budget preview --------------------------------------------
   Runs the real planner (planStoryFloorCast) against a representative spawn-point
   count so the tab reports what the floor will actually field, not an estimate.
   The generator's point count varies with map size; SLOT_SAMPLE is the typical
   count for a story floor and only affects the preview, never the game. */

const STORY_SLOT_SAMPLE = 14;

function storyFloorPreview(pool, budget) {
  const slots = Array.from({ length: STORY_SLOT_SAMPLE }, (_, i) => ({
    roomId: Math.floor(i / 3),
    weight: i % 5 === 4 ? 'heavy' : i % 3 === 0 ? 'light' : 'mid'
  }));
  const plan = planStoryFloorCast(pool, slots, {
    budget: budget != null ? budget : undefined,
    rng: makeRng(20260802).raw
  });
  const counts = {};
  for (const id of plan.ids) if (id) counts[id] = (counts[id] || 0) + 1;
  return { ...plan, slots: slots.length, counts };
}

function setupStoryQuestsTab() {
  loadStoryEdits();

  document.getElementById('sq-boss-id')?.addEventListener('change', (e) => {
    applyStoryEdit(currentMissionId, { finalBossId: e.target.value });
  });
  document.getElementById('sq-boss-name')?.addEventListener('change', (e) => {
    applyStoryEdit(currentMissionId, { finalBossName: e.target.value });
  });
  document.getElementById('sq-boss-hpmult')?.addEventListener('input', (e) => {
    const lbl = document.getElementById('sq-boss-hpmult-val');
    if (lbl) lbl.textContent = parseFloat(e.target.value).toFixed(2) + 'x';
  });
  document.getElementById('sq-boss-hpmult')?.addEventListener('change', (e) => {
    applyStoryEdit(currentMissionId, { bossHpMult: parseFloat(e.target.value) });
  });

  document.getElementById('sq-add-escort-btn')?.addEventListener('click', () => {
    const m = effectiveMission(currentMissionId);
    if (!m) return;
    applyStoryEdit(currentMissionId, { bossEscorts: [...effectiveEscorts(m), { id: 'goblin', count: 2 }] });
  });

  document.getElementById('sq-test-arena-btn')?.addEventListener('click', () => {
    const m = effectiveMission(currentMissionId);
    if (!m || !m.finalBossId) return;
    const boss = getMonsterById(m.finalBossId);
    window.open(buildTestSkillsUrl({
      id: m.finalBossId,
      name: m.finalBossName || m.finalBossId,
      scale: 1.5,
      sprite: boss?.sprite || './dcss/monster/orc.png',
      animations: boss?.animations
    }), '_blank');
  });

  document.getElementById('sq-save-btn')?.addEventListener('click', saveStoryEncounters);
  document.getElementById('sq-export-btn')?.addEventListener('click', () => downloadStoryEncounters());

  document.getElementById('sq-reset-mission-btn')?.addEventListener('click', () => {
    const m = STORY_MISSIONS_BASE.find(x => x.id === currentMissionId);
    if (!storyEdits[currentMissionId]) {
      showToast('This mission has no overrides — it is already the authored cast.');
      return;
    }
    if (!confirm(`Drop every cast override on "${m ? m.name : currentMissionId}" and restore its authored monsters?`)) return;
    delete storyEdits[currentMissionId];
    persistStoryEdits();
    renderStoryQuestsTab();
    showToast('Restored the authored cast. Save to Codebase to persist.');
  });

  document.getElementById('sq-reset-all-btn')?.addEventListener('click', () => {
    if (!confirm('Drop the cast overrides on every story mission?')) return;
    storyEdits = {};
    persistStoryEdits();
    renderStoryQuestsTab();
    showToast('All story missions restored to their authored casts.');
  });
}

function renderStoryQuestsTab() {
  renderStoryMissionList();
  renderStoryInspector();
}

function renderStoryMissionList() {
  const listEl = document.getElementById('sq-mission-list');
  if (!listEl) return;
  const countEl = document.getElementById('sq-mission-count');
  if (countEl) countEl.textContent = String(STORY_MISSIONS_BASE.length);

  listEl.innerHTML = STORY_MISSIONS_BASE.map(base => {
    const m = effectiveMission(base.id);
    const edited = !!storyEdits[base.id];
    const active = base.id === currentMissionId ? 'active' : '';
    const theme = (m.theme || '').toLowerCase();
    const themeColor = theme === 'molten' ? '#ef4444' : theme === 'frost' ? '#38bdf8'
      : theme === 'verdant' || theme === 'forest' ? '#10b981' : theme === 'grim' || theme === 'mire' ? '#a855f7' : '#f59e0b';
    const bossLabel = m.finalBossName || monsterDisplayName(m.finalBossId);
    return `
      <div class="boss-item-card ${active}" data-id="${base.id}">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:6px">
          <span style="font-weight:700; font-size:12px; color:${themeColor}">${edited ? '✏️ ' : ''}Ch.${m.chapter} — ${m.name}</span>
          <span class="badge" style="font-size:10px; padding:2px 6px; background:rgba(255,255,255,0.06)">L${m.level}</span>
        </div>
        <div style="font-size:11px; color:var(--text-muted); display:flex; justify-content:space-between; gap:6px">
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">👑 ${bossLabel}</span>
          <span style="flex-shrink:0">🗺️ ${(m.floorPlan || []).length}f</span>
        </div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.boss-item-card').forEach(card => {
    card.addEventListener('click', () => {
      currentMissionId = card.dataset.id;
      renderStoryQuestsTab();
    });
  });
}

function monsterDisplayName(id) {
  if (!id) return '—';
  const m = getMonsterById(id);
  return m ? m.name : id.replace(/-/g, ' ');
}

/** One editable lane of monster chips. `onChange(nextIds)` receives the new list.
 *  Chips carry the creature's budget cost — story floors buy their cast with it,
 *  so cost is what decides how many of a lane turn up, not the level ceiling. */
function renderMobLane(container, key, ids, onChange) {
  const lane = document.createElement('div');
  lane.className = 'mob-lane' + (key === 'boss' ? ' lane-boss' : '');

  const chips = ids.map((id, i) => {
    const m = getMonsterById(id);
    if (!m) {
      return `<span class="mob-chip chip-warn" title="No creature with this id exists in monsters.json">${id}
        <button data-idx="${i}" title="Remove">✖</button></span>`;
    }
    const cost = storySpawnCost(id);
    const tip = `CR ${formatCR(m.cr)} — costs ${cost} pts of the floor's budget`;
    return `<span class="mob-chip" title="${tip}">${m.name} <span class="chip-cr">CR ${formatCR(m.cr)} · ${cost}p</span>
      <button data-idx="${i}" title="Remove">✖</button></span>`;
  }).join('');

  const laneCost = ids.reduce((s, id) => s + storySpawnCost(id), 0);
  lane.innerHTML = `
    <div class="mob-lane-head">
      <span>${laneLabel(key)}</span>
      <span style="font-weight:400; text-transform:none">${ids.length} creature${ids.length === 1 ? '' : 's'}${ids.length ? ` · ${Math.round(laneCost / ids.length)}p avg` : ''}</span>
    </div>
    ${key === 'boss' ? '<div class="mob-lane-empty">Named here for reference only — the finale is spawned from the Curated Quest Boss panel, so these never turn up as corridor mobs.</div>' : ''}
    <div class="mob-chips">${chips || '<span class="mob-lane-empty">empty</span>'}</div>
    <select class="lane-add" style="background:var(--bg-input); border:1px solid var(--border); color:var(--text-main); padding:4px 8px; border-radius:6px; font-size:11.5px">
      <option value="">➕ add creature…</option>
      ${laneOptionsHTML()}
    </select>
  `;

  lane.querySelectorAll('.mob-chip button').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = [...ids];
      next.splice(parseInt(btn.dataset.idx, 10), 1);
      onChange(next);
    });
  });

  lane.querySelector('.lane-add')?.addEventListener('change', (e) => {
    const id = e.target.value;
    if (!id) return;
    if (ids.includes(id)) {
      showToast(`${monsterDisplayName(id)} is already in this lane.`);
      e.target.value = '';
      return;
    }
    onChange([...ids, id]);
  });

  container.appendChild(lane);
}

/** Lanes for a pool, plus an "add a tier lane" control. */
function renderPoolLanes(container, pool, onChange) {
  container.innerHTML = '';
  const keys = laneKeys(pool);
  const shown = keys.length ? keys : ['1'];

  for (const key of shown) {
    renderMobLane(container, key, pool[key] || [], (nextIds) => {
      const next = { ...pool };
      if (nextIds.length) next[key] = nextIds;
      else delete next[key];
      onChange(next);
    });
  }

  const missing = ['1', '2', '3', 'boss'].filter(k => !shown.includes(k));
  if (missing.length) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:5px; flex-wrap:wrap; align-items:center';
    row.innerHTML = `<span style="font-size:11px; color:var(--text-muted)">Add lane:</span>` +
      missing.map(k => `<button class="btn btn-xs lane-new" data-key="${k}">${laneLabel(k)}</button>`).join('');
    row.querySelectorAll('.lane-new').forEach(btn => {
      btn.addEventListener('click', () => {
        /* an empty lane has nothing to store, so seed it with the pool's own
           first creature rather than writing a key the save would strip */
        const seed = storyPoolIds(pool)[0] || 'goblin';
        onChange({ ...pool, [btn.dataset.key]: [seed] });
      });
    });
    container.appendChild(row);
  }
}

function renderStoryInspector() {
  const mission = effectiveMission(currentMissionId) || effectiveMission(STORY_MISSIONS_BASE[0]?.id);
  if (!mission) return;
  currentMissionId = mission.id;

  const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  setText('sq-badge-chapter', `CHAPTER ${mission.chapter}`);
  setText('sq-badge-theme', (mission.theme || '').toUpperCase());
  setText('sq-badge-level', `LEVEL ${mission.level}`);
  setText('sq-badge-floors', `${(mission.floorPlan || []).length} FLOORS`);
  setText('sq-id-tag', mission.id);
  setText('sq-header-title', mission.name);
  setText('sq-header-site', mission.siteName || '');

  const bossSel = document.getElementById('sq-boss-id');
  if (bossSel) bossSel.innerHTML = renderMonsterOptionsHTML(mission.finalBossId || '');

  const nameInput = document.getElementById('sq-boss-name');
  if (nameInput) nameInput.value = mission.finalBossName || '';

  const hpMult = mission.bossHpMult ?? 1.5;
  const hpSlider = document.getElementById('sq-boss-hpmult');
  if (hpSlider) hpSlider.value = hpMult;
  setText('sq-boss-hpmult-val', hpMult.toFixed(2) + 'x');

  renderStoryEscorts(mission);

  const rosterPool = normalizePool(mission.monsterRoster);
  const rosterEl = document.getElementById('sq-roster-lanes');
  if (rosterEl) {
    renderPoolLanes(rosterEl, rosterPool, (next) => {
      applyStoryEdit(mission.id, { monsterRoster: next });
    });
  }

  renderStoryFloors(mission, rosterPool);
  renderStoryWarnings(mission, rosterPool);
}

function renderStoryEscorts(mission) {
  const container = document.getElementById('sq-escort-rows');
  if (!container) return;
  const escorts = effectiveEscorts(mission);

  container.innerHTML = escorts.length ? escorts.map((esc, i) => `
    <div class="boss-escort-row">
      <select class="sq-escort-id" data-idx="${i}" style="flex:1; min-width:0; background:var(--bg-input); border:1px solid var(--border); color:#fff; padding:4px 8px; border-radius:4px; font-size:12px">
        ${renderMonsterOptionsHTML(esc.id)}
      </select>
      <span style="font-size:11px; color:var(--text-muted)">Count:</span>
      <input type="number" class="sq-escort-count" data-idx="${i}" min="1" max="4" value="${esc.count || 1}" style="width:50px; background:var(--bg-input); border:1px solid var(--border); color:#fff; padding:4px 6px; border-radius:4px; font-size:12px">
      <button class="btn btn-xs sq-escort-remove" data-idx="${i}" style="color:var(--red); border-color:rgba(239,68,68,0.3)">✖</button>
    </div>
  `).join('') : '<div class="mob-lane-empty">No escorts — the boss stands alone.</div>';

  const commit = (next) => applyStoryEdit(mission.id, { bossEscorts: next });

  container.querySelectorAll('.sq-escort-id').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const next = escorts.map((x, i) => i === Number(e.target.dataset.idx) ? { ...x, id: e.target.value } : x);
      commit(next);
    });
  });
  container.querySelectorAll('.sq-escort-count').forEach(num => {
    num.addEventListener('change', (e) => {
      const cnt = Math.max(1, Math.min(4, parseInt(e.target.value, 10) || 1));
      const next = escorts.map((x, i) => i === Number(e.target.dataset.idx) ? { ...x, count: cnt } : x);
      commit(next);
    });
  });
  container.querySelectorAll('.sq-escort-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = escorts.filter((_, i) => i !== Number(btn.dataset.idx));
      commit(next);
    });
  });

  const hint = document.getElementById('sq-escort-hint');
  if (hint) {
    hint.textContent = Array.isArray(mission.bossEscorts)
      ? 'Escorts spawn beside the boss on the final floor, capped at 4 of each.'
      : 'Showing the thematic default the game falls back to. Editing anything here pins the list for this mission.';
  }
}

function renderStoryFloors(mission, rosterPool) {
  const listEl = document.getElementById('sq-floor-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  const floors = mission.floorPlan || [];
  floors.forEach((floor, idx) => {
    const floorNo = idx + 1;
    const isFinal = floorNo === floors.length;
    const pool = normalizePool(floor.monsters);
    const usesFallback = Object.keys(pool).length === 0;
    const effective = usesFallback ? rosterPool : pool;
    const hasCast = storyPoolIds(effective).length > 0;

    const authored = floor.crBudget != null ? floor.crBudget : null;
    const derived = defaultStoryBudget(effective, STORY_SLOT_SAMPLE);
    const preview = hasCast ? storyFloorPreview(effective, authored) : null;

    const card = document.createElement('div');
    card.className = 'sq-floor-card' + (isFinal ? ' floor-final' : '');

    const castLine = preview
      ? Object.entries(preview.counts)
          .sort((a, b) => b[1] - a[1])
          .map(([id, n]) => `${n}× ${monsterDisplayName(id)}`).join(', ')
      : '';

    card.innerHTML = `
      <div class="sq-floor-title">
        <span class="badge" style="background:rgba(255,255,255,0.06)">FLOOR ${floorNo}</span>
        <span>${floor.name || '(unnamed floor)'}</span>
        <span class="badge" style="background:rgba(59,130,246,0.15); color:#60a5fa">${(floor.mapKind || 'dungeon').toUpperCase()} · ${(floor.theme || mission.theme || '').toUpperCase()}</span>
        ${isFinal ? '<span class="badge" style="background:rgba(217,164,65,0.2); color:var(--gold-bright)">FINALE</span>' : ''}
      </div>

      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; background:var(--bg-card); border:1px solid var(--border); border-radius:6px; padding:8px 10px">
        <span style="font-size:11px; font-weight:700; letter-spacing:0.04em; color:var(--text-muted); text-transform:uppercase">CR Budget</span>
        <input type="number" class="sq-floor-budget" min="0" step="10" value="${authored != null ? authored : ''}"
          placeholder="${derived}" title="Points this floor may spend buying creatures out of its whitelist. Leave blank to derive it from the cast (${derived} pts for a typical ${STORY_SLOT_SAMPLE}-spawn floor)."
          style="width:90px; background:var(--bg-input); border:1px solid var(--border); color:#fff; padding:4px 8px; border-radius:6px; font-size:12px">
        <button class="btn btn-xs sq-floor-budget-clear" ${authored == null ? 'disabled style="opacity:0.4"' : ''}>Use derived (${derived})</button>
        ${preview ? `<span style="margin-left:auto; font-size:11px; color:${preview.filled >= preview.slots ? 'var(--green)' : preview.filled >= preview.slots * 0.5 ? 'var(--amber)' : 'var(--red)'}"
          title="Simulated against a typical ${STORY_SLOT_SAMPLE}-spawn-point floor using the game's own planner.">
          fills ${preview.filled} of ${preview.slots} spawn points · ${preview.spent}/${preview.budget} pts spent</span>` : ''}
      </div>

      ${castLine ? `<div style="font-size:11.5px; color:var(--text-muted)">Typical floor: ${castLine}</div>` : ''}
      ${usesFallback ? `<div class="mob-lane-empty">No pool of its own — this floor draws from the fallback roster${Object.keys(rosterPool).length ? '' : ', which is also empty, so it uses the ' + (floor.theme || mission.theme) + ' dungeon roster and the ordinary CR window'}.</div>` : ''}
      <div class="sq-floor-lanes" style="display:flex; flex-direction:column; gap:8px"></div>
    `;

    card.querySelector('.sq-floor-budget')?.addEventListener('change', (e) => {
      const raw = e.target.value.trim();
      applyStoryFloorEdit(mission.id, floorNo, { crBudget: raw === '' ? null : Math.max(0, parseInt(raw, 10) || 0) });
    });
    card.querySelector('.sq-floor-budget-clear')?.addEventListener('click', () => {
      if (authored == null) return;
      applyStoryFloorEdit(mission.id, floorNo, { crBudget: null });
    });

    const lanesEl = card.querySelector('.sq-floor-lanes');
    renderPoolLanes(lanesEl, pool, (next) => {
      applyStoryFloorEdit(mission.id, floorNo, { monsters: next });
    });

    listEl.appendChild(card);
  });
}

function renderStoryWarnings(mission, rosterPool) {
  const el = document.getElementById('sq-warnings');
  if (!el) return;
  const rows = [];

  if (!mission.finalBossId) {
    rows.push({ cls: 'warn-bad', text: 'No boss creature set — the finale falls back to the curated boss table for this theme and level.' });
  } else if (!getMonsterById(mission.finalBossId)) {
    rows.push({ cls: 'warn-bad', text: `Boss id "${mission.finalBossId}" does not exist in monsters.json.` });
  }

  const floors = mission.floorPlan || [];
  const unknown = new Set();
  const starved = [];   // budget too small to fill the floor
  const bare = [];      // no cast at all — falls back to the theme roster
  const bloated = [];   // budget far exceeds what the floor can place

  floors.forEach((floor, idx) => {
    const pool = normalizePool(floor.monsters);
    const effective = Object.keys(pool).length ? pool : rosterPool;
    for (const id of storyPoolIds(effective)) if (!getMonsterById(id)) unknown.add(id);

    if (!storyPoolIds(effective).length) { bare.push(idx + 1); return; }

    const preview = storyFloorPreview(effective, floor.crBudget != null ? floor.crBudget : null);
    if (preview.filled < preview.slots) starved.push({ floor: idx + 1, ...preview });
    else if (preview.budget > preview.spent * 1.5) bloated.push({ floor: idx + 1, ...preview });
  });

  if (unknown.size) {
    rows.push({ cls: 'warn-bad', text: `Unknown creature id${unknown.size > 1 ? 's' : ''}: ${[...unknown].join(', ')} — these are skipped at spawn time.` });
  }

  if (bare.length) {
    rows.push({
      text: `Floor${bare.length > 1 ? 's' : ''} ${bare.join(', ')} ${bare.length > 1 ? 'have' : 'has'} no cast of its own and no fallback roster, so ${bare.length > 1 ? 'they fall' : 'it falls'} back to the dungeon theme's roster and the ordinary CR window — the level ceiling applies there.`
    });
  }

  if (starved.length) {
    const detail = starved.map(s => `floor ${s.floor} (${s.filled}/${s.slots})`).join(', ');
    rows.push({
      cls: starved.some(s => s.filled < s.slots * 0.5) ? 'warn-bad' : '',
      text: `Budget runs out before the floor is full on ${detail}. Unfunded spawn points are left empty — raise the CR budget, or add cheaper creatures to the cast.`
    });
  }

  if (bloated.length) {
    const detail = bloated.map(b => `floor ${b.floor} (${b.spent}/${b.budget} pts used)`).join(', ');
    rows.push({ text: `More budget than the floor's spawn points can spend on ${detail}. The surplus does nothing — the map's layout caps how many creatures fit.` });
  }

  if (!rows.length) {
    rows.push({ cls: 'warn-ok', text: 'Every floor fields its authored cast in full. Story floors ignore the CR window and the level ceiling, so heavy creatures show up exactly as written — the budget is the only limit.' });
  }

  el.innerHTML = rows.map(r => `<div class="warn-row ${r.cls || ''}">${r.text}</div>`).join('');
}

/** The overrides file: only what actually differs from the authored mission. */
function buildStoryEncountersPayload() {
  const out = {};
  for (const base of STORY_MISSIONS_BASE) {
    const ov = storyEdits[base.id];
    if (!ov) continue;
    const clean = {};
    if (ov.finalBossId && ov.finalBossId !== base.finalBossId) clean.finalBossId = ov.finalBossId;
    if (ov.finalBossName != null && ov.finalBossName !== base.finalBossName) clean.finalBossName = ov.finalBossName;
    if (ov.bossHpMult != null && ov.bossHpMult !== base.bossHpMult) clean.bossHpMult = ov.bossHpMult;
    if (ov.bossEscorts) clean.bossEscorts = ov.bossEscorts;
    if (ov.monsterRoster) clean.monsterRoster = ov.monsterRoster;
    if (ov.floors) {
      const floors = {};
      for (const [idx, patch] of Object.entries(ov.floors)) {
        if (!patch) continue;
        const f = {};
        if (patch.monsters) f.monsters = patch.monsters;
        /* null is meaningful: it clears an authored crBudget back to derived */
        if ('crBudget' in patch) f.crBudget = patch.crBudget;
        if (Object.keys(f).length) floors[idx] = f;
      }
      if (Object.keys(floors).length) clean.floors = floors;
    }
    if (Object.keys(clean).length) out[base.id] = clean;
  }
  return out;
}

async function saveStoryEncounters() {
  const payload = buildStoryEncountersPayload();
  try {
    const res = await fetch('/api/save-story-encounters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload, null, 2)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        showToast('💾 Saved src/game/story_encounters.json — reload the game to apply.');
        return;
      }
    }
  } catch (e) {
    console.warn('Direct server save unavailable, falling back to download', e);
  }
  downloadStoryEncounters(payload);
}

function downloadStoryEncounters(payload) {
  const jsonStr = JSON.stringify(payload || buildStoryEncountersPayload(), null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'story_encounters.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported story_encounters.json file download!');
}

/* ================= DUNGEON TYPE ROSTERS TAB =================
   The inverse of the Bestiary tab's per-creature dungeon chips: pick a dungeon
   type, then build the whole creature list it may draw from. Both write the
   same `dungeons` whitelist on the monster, so a change here shows up there and
   both persist through "Save to Codebase (monsters.json)". */

let drCurrentTheme = DUNGEON_OPTIONS[0]?.key || 'ancient';
let drSearch = '';
let drFamilyFilter = 'all';
let drMembershipFilter = 'all';
let drCrMin = null;
let drCrMax = null;

/** A creature's effective roster membership (explicit list, never derived — an
 *  unset list means "spawns nowhere themed", same as the generator reads it). */
function drMonsterIn(m, themeKey) {
  return Array.isArray(m.dungeons) && m.dungeons.includes(themeKey);
}

function drRosterFor(themeKey) {
  return allMonsters.filter(m => drMonsterIn(m, themeKey));
}

function drSetMembership(monsterIds, themeKey, on) {
  let changed = 0;
  for (const id of monsterIds) {
    const m = allMonsters.find(x => x.id === id);
    if (!m) continue;
    const cur = Array.isArray(m.dungeons) ? [...m.dungeons] : [];
    const has = cur.includes(themeKey);
    if (on && !has) cur.push(themeKey);
    else if (!on && has) cur.splice(cur.indexOf(themeKey), 1);
    else continue;
    if (!userEdits[id]) userEdits[id] = {};
    userEdits[id].dungeons = cur;
    changed++;
  }
  if (changed) {
    saveUserEdits();
    renderDungeonRostersTab();
    /* the Bestiary tab's chip grid reads the same field */
    const cur = getCurrentMonster();
    if (cur) populateDungeonGrid(cur);
  }
  return changed;
}

function setupDungeonRostersTab() {
  const famSel = document.getElementById('dr-family-filter');
  if (famSel) {
    famSel.innerHTML = '<option value="all">All families</option>' +
      MONSTER_THEMES.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
  }

  const copySel = document.getElementById('dr-copy-from');
  if (copySel) {
    copySel.innerHTML = DUNGEON_OPTIONS.map(d => `<option value="${d.key}">Merge from: ${d.label}</option>`).join('');
  }

  document.getElementById('dr-search')?.addEventListener('input', (e) => {
    drSearch = e.target.value.toLowerCase();
    renderDungeonRosterGrid();
  });
  document.getElementById('dr-family-filter')?.addEventListener('change', (e) => {
    drFamilyFilter = e.target.value;
    renderDungeonRosterGrid();
  });
  document.getElementById('dr-membership-filter')?.addEventListener('change', (e) => {
    drMembershipFilter = e.target.value;
    renderDungeonRosterGrid();
  });
  document.getElementById('dr-cr-min')?.addEventListener('change', (e) => {
    drCrMin = e.target.value === '' ? null : parseFloat(e.target.value);
    renderDungeonRosterGrid();
  });
  document.getElementById('dr-cr-max')?.addEventListener('change', (e) => {
    drCrMax = e.target.value === '' ? null : parseFloat(e.target.value);
    renderDungeonRosterGrid();
  });

  document.getElementById('dr-bulk-add-btn')?.addEventListener('click', () => {
    const ids = drFilteredMonsters().map(m => m.id);
    const n = drSetMembership(ids, drCurrentTheme, true);
    showToast(n ? `Added ${n} creature(s) to the ${drThemeLabel(drCurrentTheme)} roster.` : 'Every shown creature is already in the roster.');
  });

  document.getElementById('dr-bulk-remove-btn')?.addEventListener('click', () => {
    const ids = drFilteredMonsters().map(m => m.id);
    const n = drSetMembership(ids, drCurrentTheme, false);
    showToast(n ? `Removed ${n} creature(s) from the ${drThemeLabel(drCurrentTheme)} roster.` : 'None of the shown creatures were in the roster.');
  });

  document.getElementById('dr-clear-btn')?.addEventListener('click', () => {
    const roster = drRosterFor(drCurrentTheme);
    if (!roster.length) { showToast('That roster is already empty.'); return; }
    if (!confirm(`Remove all ${roster.length} creature(s) from the ${drThemeLabel(drCurrentTheme)} roster? Nothing will spawn in its themed rooms.`)) return;
    drSetMembership(roster.map(m => m.id), drCurrentTheme, false);
    showToast(`Cleared the ${drThemeLabel(drCurrentTheme)} roster.`);
  });

  document.getElementById('dr-copy-btn')?.addEventListener('click', () => {
    const from = document.getElementById('dr-copy-from')?.value;
    if (!from || from === drCurrentTheme) { showToast('Pick a different dungeon type to merge from.'); return; }
    const n = drSetMembership(drRosterFor(from).map(m => m.id), drCurrentTheme, true);
    showToast(n ? `Merged ${n} creature(s) from ${drThemeLabel(from)}.` : `${drThemeLabel(drCurrentTheme)} already has everything ${drThemeLabel(from)} has.`);
  });

  document.getElementById('dr-save-btn')?.addEventListener('click', saveMonstersDirectly);

  document.getElementById('dr-seed-btn')?.addEventListener('click', () => {
    const unconfigured = allMonsters.filter(m => !Array.isArray(m.dungeons));
    if (!unconfigured.length) { showToast('Every creature already has explicit dungeon picks.'); return; }
    if (!confirm(`Seed ${unconfigured.length} creature(s) with no picks at all from their creature-type family?`)) return;
    for (const m of unconfigured) {
      if (!userEdits[m.id]) userEdits[m.id] = {};
      userEdits[m.id].dungeons = derivedDungeonsForMonster(m);
    }
    saveUserEdits();
    renderDungeonRostersTab();
    showToast(`Seeded ${unconfigured.length} creature(s). Save to Codebase to persist.`);
  });
}

function drThemeLabel(key) {
  return DUNGEON_OPTIONS.find(d => d.key === key)?.label || key;
}

function renderDungeonRostersTab() {
  renderDungeonThemeList();
  renderDungeonRosterHeader();
  renderDungeonRosterCoverage();
  renderDungeonRosterWarnings();
  renderDungeonRosterGrid();
}

function renderDungeonThemeList() {
  const el = document.getElementById('dr-theme-list');
  if (!el) return;
  el.innerHTML = DUNGEON_OPTIONS.map(d => {
    const n = drRosterFor(d.key).length;
    return `
      <div class="dr-theme-card ${d.key === drCurrentTheme ? 'active' : ''} ${n === 0 ? 'roster-empty' : ''}" data-key="${d.key}">
        <span class="dr-theme-swatch" style="background:${d.accent}"></span>
        <span style="flex:1; font-size:12.5px; font-weight:600">${d.label}</span>
        <span class="badge" style="font-size:10px; padding:2px 6px; background:${n === 0 ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.06)'}; color:${n === 0 ? '#fca5a5' : 'var(--text-muted)'}">${n}</span>
      </div>
    `;
  }).join('');

  el.querySelectorAll('.dr-theme-card').forEach(card => {
    card.addEventListener('click', () => {
      drCurrentTheme = card.dataset.key;
      renderDungeonRostersTab();
    });
  });
}

function renderDungeonRosterHeader() {
  const roster = drRosterFor(drCurrentTheme);
  const titleEl = document.getElementById('dr-header-title');
  if (titleEl) titleEl.textContent = `${drThemeLabel(drCurrentTheme)} — ${roster.length} creature${roster.length === 1 ? '' : 's'}`;

  const subEl = document.getElementById('dr-header-sub');
  if (subEl) {
    const crs = roster.map(m => m.cr ?? 0).sort((a, b) => a - b);
    const spread = crs.length ? `CR ${formatCR(crs[0])} – ${formatCR(crs[crs.length - 1])}` : 'no creatures';
    const famIdx = DUNGEON_MONSTER_MAP[drCurrentTheme] || [];
    const fams = famIdx.map(i => MONSTER_THEMES[i]?.name).filter(Boolean).join(', ');
    subEl.textContent = `${spread}${fams ? ` · family hint: ${fams}` : ''}`;
  }
}

function renderDungeonRosterCoverage() {
  const el = document.getElementById('dr-coverage');
  const lvlEl = document.getElementById('dr-coverage-lvls');
  if (!el) return;
  const ids = drRosterFor(drCurrentTheme).map(m => m.id);

  let cells = '';
  let lvls = '';
  for (let lvl = 1; lvl <= 20; lvl++) {
    const hit = ids.length ? poolHitRate(ids, lvl) : 0;
    const pct = Math.round(hit * 100);
    const cls = pct >= 95 ? '' : pct >= 50 ? 'thin' : 'none';
    const cap = maxCrForDungeonLevel(lvl);
    const inBand = ids.filter(id => {
      const m = getMonsterById(id);
      return m && (m.cr ?? 0) <= cap;
    }).length;
    cells += `<div class="dr-cov-cell ${cls}" title="Level ${lvl}: ${pct}% of CR rolls can be filled from this roster. ${inBand} creature(s) sit at or under the level ceiling (CR ${formatCR(cap)}).">${pct}</div>`;
    lvls += `<div class="dr-cov-lvl">${lvl}</div>`;
  }
  el.innerHTML = cells;
  if (lvlEl) lvlEl.innerHTML = lvls;
}

function renderDungeonRosterWarnings() {
  const el = document.getElementById('dr-warnings');
  if (!el) return;
  const roster = drRosterFor(drCurrentTheme);
  const rows = [];

  if (!roster.length) {
    rows.push({ cls: 'warn-bad', text: `Nothing is whitelisted for ${drThemeLabel(drCurrentTheme)}. Its rooms pass an empty whitelist to the spawner, so every roll falls through to the closest creature in the whole bestiary — the theme is effectively ignored.` });
  } else {
    const weak = [];
    for (let lvl = 1; lvl <= 20; lvl++) {
      const hit = poolHitRate(roster.map(m => m.id), lvl);
      if (hit < 0.95) weak.push({ lvl, hit });
    }
    if (weak.length) {
      const worst = weak.slice(0, 6).map(w => `L${w.lvl} (${Math.round(w.hit * 100)}%)`).join(', ');
      rows.push({
        cls: weak.some(w => w.hit < 0.5) ? 'warn-bad' : '',
        text: `Thin at ${weak.length} dungeon level${weak.length === 1 ? '' : 's'}: ${worst}${weak.length > 6 ? ', …' : ''}. Rolls the roster can't fill are replaced by the closest creature from the whole bestiary — add creatures at those CRs to keep the theme intact.`
      });
    }
    const lowCr = roster.filter(m => (m.cr ?? 0) <= 1).length;
    if (lowCr < 3) {
      rows.push({ text: `Only ${lowCr} creature(s) at CR 1 or under — early dungeon levels have almost nothing to draw from.` });
    }
    if (!rows.length) {
      rows.push({ cls: 'warn-ok', text: 'This roster covers every dungeon level 1–20. Rooms in this theme will always spawn from your list.' });
    }
  }

  el.innerHTML = rows.map(r => `<div class="warn-row ${r.cls || ''}">${r.text}</div>`).join('');
}

function drFilteredMonsters() {
  return allMonsters.filter(m => {
    if (drSearch && !m.name.toLowerCase().includes(drSearch) && !m.id.includes(drSearch)) return false;
    if (drFamilyFilter !== 'all' && getThemeForMonster(m) !== drFamilyFilter) return false;
    const inRoster = drMonsterIn(m, drCurrentTheme);
    if (drMembershipFilter === 'in' && !inRoster) return false;
    if (drMembershipFilter === 'out' && inRoster) return false;
    const cr = m.cr ?? 0;
    if (drCrMin != null && cr < drCrMin) return false;
    if (drCrMax != null && cr > drCrMax) return false;
    return true;
  }).sort((a, b) => {
    const crA = a.cr ?? 0, crB = b.cr ?? 0;
    if (crA !== crB) return crA - crB;
    return a.name.localeCompare(b.name);
  });
}

function renderDungeonRosterGrid() {
  const el = document.getElementById('dr-monster-grid');
  if (!el) return;
  const list = drFilteredMonsters();

  const countEl = document.getElementById('dr-shown-count');
  if (countEl) countEl.textContent = `${list.length} shown / ${allMonsters.length}`;

  el.innerHTML = list.map(m => {
    const on = drMonsterIn(m, drCurrentTheme);
    return `
      <label class="dr-mob-row ${on ? 'on' : ''}" data-id="${m.id}" title="${m.name} — CR ${formatCR(m.cr)} · ${getThemeForMonster(m)}">
        <input type="checkbox" ${on ? 'checked' : ''}>
        <span class="dr-mob-name">${m.name}</span>
        <span class="dr-mob-fam">${getThemeForMonster(m)}</span>
        <span class="dr-mob-cr">CR ${formatCR(m.cr)}</span>
      </label>
    `;
  }).join('') || '<div class="mob-lane-empty">No creature matches these filters.</div>';

  el.querySelectorAll('.dr-mob-row input').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.closest('.dr-mob-row').dataset.id;
      drSetMembership([id], drCurrentTheme, e.target.checked);
    });
  });
}

function showToast(msg) {
  let toast = document.getElementById('bestiary-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'bestiary-toast';
    toast.className = 'bestiary-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

/* ================= SPECIAL & TACTICAL ROOMS CURATION TAB ================= */

const TACTICAL_ROOM_STYLES = [
  { id: 'swarm', name: 'Infestation', title: 'THE SWARM', icon: '🐀', desc: 'Overwhelming single-species horde of low-level vermin or pests filling the room' },
  { id: 'nest', name: 'The Brood Nest', title: 'THE BROOD NEST', icon: '🕷️', desc: 'A formidable brood mother or queen guarding a swarm of ravenous hatchlings' },
  { id: 'necromantic', name: 'Necromantic Graveyard', title: 'NECROMANTIC GRAVEYARD', icon: '💀', desc: 'Dark practitioner raising and commanding undead minions from the earth' },
  { id: 'ritual', name: 'Cult Ritual Chamber', title: 'CULT RITUAL CHAMBER', icon: '🕯️', desc: 'Backline spellcasters channeling dark magic screened by fanatical zealots' },
  { id: 'miniboss', name: "Commander's Garrison", title: "COMMANDER'S GARRISON", icon: '👑', desc: 'A high-CR squad commander backed by disciplined bodyguard escorts' },
  { id: 'killzone', name: 'The Killzone', title: 'THE KILLZONE', icon: '🏹', desc: 'Entrenched ranged snipers holding the back wall behind armored defenders' },
  { id: 'ambush', name: 'Pincer Ambush', title: 'PINCER AMBUSH', icon: '🗡️', desc: 'Concealed strike team encircling the party entrance doors' },
  { id: 'juggernaut', name: 'Siege Vanguard', title: 'SIEGE VANGUARD', icon: '🛡️', desc: 'A pair of heavily armored bruiser tanks holding chokepoints' },
  { id: 'duelists', name: "Champions' Ring", title: "CHAMPIONS' RING", icon: '⚔️', desc: 'Two elite martial gladiators dueling together in a trial of combat' },
  { id: 'arcane_surge', name: 'Ley Line Surge', title: 'LEY LINE SURGE', icon: '⚡', desc: 'Magical font infusing all monsters in the room with empowered spellcasting' }
];

let trCurrentStyle = 'swarm';
let trCurrentTheme = 'ancient';
let trCurrentLevel = 1;
let trSearch = '';
let trFamilyFilter = 'all';
let trDungeonFilter = 'theme';
let trCrMin = null;
let trCrMax = null;

let trData = {};

function loadTacticalRoomsData() {
  trData = JSON.parse(JSON.stringify(getCuratedTacticalRooms() || {}));
  for (const s of TACTICAL_ROOM_STYLES) {
    if (!trData[s.id]) trData[s.id] = {};
    if (!Array.isArray(trData[s.id].enabledThemes)) {
      trData[s.id].enabledThemes = DUNGEON_OPTIONS.map(d => d.key);
    }
  }
}

function isCurrentStyleEnabledInTheme(themeKey) {
  const styleData = trData[trCurrentStyle];
  if (!styleData || !Array.isArray(styleData.enabledThemes)) return true;
  return styleData.enabledThemes.includes(themeKey);
}

function toggleCurrentStyleTheme(themeKey) {
  if (!trData[trCurrentStyle]) trData[trCurrentStyle] = {};
  if (!Array.isArray(trData[trCurrentStyle].enabledThemes)) {
    trData[trCurrentStyle].enabledThemes = DUNGEON_OPTIONS.map(d => d.key);
  }
  const list = trData[trCurrentStyle].enabledThemes;
  const idx = list.indexOf(themeKey);
  if (idx !== -1) {
    list.splice(idx, 1);
    showToast(`Disabled ${trCurrentStyle} in ${drThemeLabel(themeKey)} dungeons.`);
  } else {
    list.push(themeKey);
    showToast(`Enabled ${trCurrentStyle} in ${drThemeLabel(themeKey)} dungeons.`);
  }
  saveTacticalRoomsToLocalStorage();
  renderTacticalStyleList();
  renderTacticalThemeTabs();
  renderTacticalThemeToggle();
  renderTacticalCuratedChips();
}

function getCuratedListForCurrentSelection() {
  if (!trData[trCurrentStyle]) trData[trCurrentStyle] = {};
  if (!trData[trCurrentStyle][trCurrentTheme]) trData[trCurrentStyle][trCurrentTheme] = {};
  const lvlKey = String(trCurrentLevel);
  if (!Array.isArray(trData[trCurrentStyle][trCurrentTheme][lvlKey])) {
    trData[trCurrentStyle][trCurrentTheme][lvlKey] = [];
  }
  return trData[trCurrentStyle][trCurrentTheme][lvlKey];
}

function setupTacticalRoomsTab() {
  loadTacticalRoomsData();

  const famSel = document.getElementById('tr-family-filter');
  if (famSel) {
    famSel.innerHTML = '<option value="all">All families</option>' +
      MONSTER_THEMES.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
  }

  document.getElementById('tr-theme-toggle-btn')?.addEventListener('click', () => {
    toggleCurrentStyleTheme(trCurrentTheme);
  });

  document.getElementById('tr-search')?.addEventListener('input', (e) => {
    trSearch = e.target.value.toLowerCase();
    renderTacticalCandidateGrid();
  });
  document.getElementById('tr-family-filter')?.addEventListener('change', (e) => {
    trFamilyFilter = e.target.value;
    renderTacticalCandidateGrid();
  });
  document.getElementById('tr-dungeon-filter')?.addEventListener('change', (e) => {
    trDungeonFilter = e.target.value;
    renderTacticalCandidateGrid();
  });
  document.getElementById('tr-cr-min')?.addEventListener('change', (e) => {
    trCrMin = e.target.value === '' ? null : parseFloat(e.target.value);
    renderTacticalCandidateGrid();
  });
  document.getElementById('tr-cr-max')?.addEventListener('change', (e) => {
    trCrMax = e.target.value === '' ? null : parseFloat(e.target.value);
    renderTacticalCandidateGrid();
  });

  document.getElementById('tr-clear-band-btn')?.addEventListener('click', () => {
    const list = getCuratedListForCurrentSelection();
    if (!list.length) { showToast('Level ' + trCurrentLevel + ' is already empty.'); return; }
    if (!confirm(`Clear all ${list.length} curated monster(s) for ${trCurrentStyle} in ${drThemeLabel(trCurrentTheme)} at Level ${trCurrentLevel}?`)) return;
    trData[trCurrentStyle][trCurrentTheme][String(trCurrentLevel)] = [];
    saveTacticalRoomsToLocalStorage();
    renderTacticalCuratedChips();
    renderTacticalCandidateGrid();
    renderTacticalLevelStrip();
    renderTacticalStyleList();
    showToast(`Cleared Level ${trCurrentLevel}.`);
  });

  document.getElementById('tr-copy-next-btn')?.addEventListener('click', () => {
    if (trCurrentLevel >= 20) { showToast('Already at Level 20.'); return; }
    const curList = getCuratedListForCurrentSelection();
    if (!curList.length) { showToast(`Level ${trCurrentLevel} has no monsters to copy.`); return; }
    const nextLvl = trCurrentLevel + 1;
    trData[trCurrentStyle][trCurrentTheme][String(nextLvl)] = [...curList];
    saveTacticalRoomsToLocalStorage();
    trCurrentLevel = nextLvl;
    renderTacticalRoomsTab();
    showToast(`Copied ${curList.length} monster(s) to Level ${nextLvl}!`);
  });

  document.getElementById('tr-apply-range-btn')?.addEventListener('click', () => {
    const curList = getCuratedListForCurrentSelection();
    if (!curList.length) { showToast(`Level ${trCurrentLevel} has no monsters to fill.`); return; }
    const rangeStr = prompt(`Apply Level ${trCurrentLevel}'s ${curList.length} monster(s) to a level range?\nExample: "1-5" or "1-20" or "6-10"`, `${trCurrentLevel}-${Math.min(20, trCurrentLevel + 4)}`);
    if (!rangeStr) return;
    const parts = rangeStr.split('-').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 1 && n <= 20);
    if (parts.length < 2) { showToast('Invalid range. Format: "1-5"'); return; }
    const start = Math.min(parts[0], parts[1]);
    const end = Math.max(parts[0], parts[1]);
    for (let l = start; l <= end; l++) {
      trData[trCurrentStyle][trCurrentTheme][String(l)] = [...curList];
    }
    saveTacticalRoomsToLocalStorage();
    renderTacticalRoomsTab();
    showToast(`Applied ${curList.length} monster(s) across Levels ${start}–${end}!`);
  });

  document.getElementById('tr-seed-defaults-btn')?.addEventListener('click', () => {
    seedTacticalRoomDefaults();
  });

  document.getElementById('tr-save-btn')?.addEventListener('click', saveTacticalRoomsDirectly);
  document.getElementById('tr-export-btn')?.addEventListener('click', exportTacticalRoomsJson);
}

function saveTacticalRoomsToLocalStorage() {
  try {
    localStorage.setItem('dc_tactical_rooms_edits', JSON.stringify(trData));
  } catch (e) {
    console.warn('Failed saving tactical rooms to localStorage', e);
  }
}

async function saveTacticalRoomsDirectly() {
  saveTacticalRoomsToLocalStorage();
  const jsonStr = JSON.stringify(trData, null, 2);
  try {
    const res = await fetch('/api/save-tactical-rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: jsonStr
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        showToast("💾 Saved tactical_rooms.json directly to project codebase!");
        return;
      }
    }
  } catch (e) {
    console.warn("Direct server save unavailable, falling back to download", e);
  }
  exportTacticalRoomsJson();
}

function exportTacticalRoomsJson() {
  const jsonStr = JSON.stringify(trData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tactical_rooms.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast("Exported tactical_rooms.json file download!");
}

function renderTacticalRoomsTab() {
  renderTacticalStyleList();
  renderTacticalHeader();
  renderTacticalThemeTabs();
  renderTacticalThemeToggle();
  renderTacticalLevelStrip();
  renderTacticalCuratedChips();
  renderTacticalCandidateGrid();
}

function renderTacticalStyleList() {
  const el = document.getElementById('tr-style-list');
  if (!el) return;
  el.innerHTML = TACTICAL_ROOM_STYLES.map(s => {
    const styleData = trData[s.id] || {};
    const enabledCount = Array.isArray(styleData.enabledThemes) ? styleData.enabledThemes.length : DUNGEON_OPTIONS.length;
    let totalCurated = 0;
    for (const tKey of Object.keys(styleData)) {
      if (tKey === 'enabledThemes') continue;
      for (const bKey of Object.keys(styleData[tKey])) {
        if (Array.isArray(styleData[tKey][bKey])) totalCurated += styleData[tKey][bKey].length;
      }
    }
    const isActive = s.id === trCurrentStyle;
    return `
      <div class="tr-style-card ${isActive ? 'active' : ''}" data-id="${s.id}">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span style="font-size:13px; font-weight:700; color:${isActive ? 'var(--gold-bright)' : '#fff'}; display:flex; align-items:center; gap:6px;">
            <span>${s.icon}</span>
            <span>${s.name}</span>
          </span>
          <span class="badge" style="font-size:10px; padding:1px 5px; color:${enabledCount ? 'var(--gold)' : 'var(--red)'}">${enabledCount}/${DUNGEON_OPTIONS.length}</span>
        </div>
        <div style="font-size:10.5px; color:var(--text-muted); line-height:1.2; margin-top:2px;">${s.title}</div>
      </div>
    `;
  }).join('');

  el.querySelectorAll('.tr-style-card').forEach(card => {
    card.addEventListener('click', () => {
      trCurrentStyle = card.dataset.id;
      renderTacticalRoomsTab();
    });
  });
}

function renderTacticalHeader() {
  const s = TACTICAL_ROOM_STYLES.find(x => x.id === trCurrentStyle) || TACTICAL_ROOM_STYLES[0];
  const titleEl = document.getElementById('tr-header-title');
  const subEl = document.getElementById('tr-header-sub');
  if (titleEl) titleEl.innerHTML = `${s.icon} ${s.name} <span style="font-size:14px; font-weight:400; color:var(--text-muted); margin-left:8px;">(${s.title})</span>`;
  if (subEl) subEl.textContent = s.desc;
}

function renderTacticalThemeTabs() {
  const el = document.getElementById('tr-theme-tabs');
  if (!el) return;
  const styleData = trData[trCurrentStyle] || {};
  const enabledList = Array.isArray(styleData.enabledThemes) ? styleData.enabledThemes : DUNGEON_OPTIONS.map(d => d.key);

  el.innerHTML = DUNGEON_OPTIONS.map(d => {
    const isActive = d.key === trCurrentTheme;
    const isEnabled = enabledList.includes(d.key);
    const themeData = styleData[d.key] || {};
    let n = 0;
    for (const [k, b] of Object.entries(themeData)) {
      if (k !== 'enabledThemes' && Array.isArray(b)) n += b.length;
    }
    return `
      <button class="tr-theme-tab-btn ${isActive ? 'active' : ''} ${!isEnabled ? 'disabled-biome' : ''}" data-key="${d.key}" title="${isEnabled ? `${d.label} (Enabled)` : `${d.label} (DISABLED for this room style)`}">
        <span class="dr-theme-swatch" style="background:${isEnabled ? d.accent : '#666'}; width:8px; height:8px; border-radius:50%; align-self:center; min-height:auto;"></span>
        <span>${d.label}</span>
        <span style="font-size:9.5px; opacity:0.8;">${isEnabled ? (n > 0 ? `(${n})` : '') : '✕ OFF'}</span>
      </button>
    `;
  }).join('');

  el.querySelectorAll('.tr-theme-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      trCurrentTheme = btn.dataset.key;
      renderTacticalRoomsTab();
    });
  });
}

function renderTacticalThemeToggle() {
  const isEnabled = isCurrentStyleEnabledInTheme(trCurrentTheme);
  const btn = document.getElementById('tr-theme-toggle-btn');
  const statusEl = document.getElementById('tr-theme-toggle-status');
  if (!btn || !statusEl) return;
  const tName = drThemeLabel(trCurrentTheme);
  if (isEnabled) {
    btn.className = 'btn btn-sm btn-success';
    btn.style.color = '#000';
    btn.style.background = '';
    btn.style.borderColor = '';
    statusEl.textContent = `✓ Enabled in ${tName}`;
  } else {
    btn.className = 'btn btn-sm';
    btn.style.borderColor = 'var(--red)';
    btn.style.color = '#fca5a5';
    btn.style.background = 'rgba(239,68,68,0.15)';
    statusEl.textContent = `✕ Disabled in ${tName}`;
  }
}

function renderTacticalLevelStrip() {
  const el = document.getElementById('tr-level-strip');
  if (!el) return;
  const hintEl = document.getElementById('tr-band-cr-hint');
  const baseCR = baseCrForDungeonLevel(trCurrentLevel);
  const maxCR = maxCrForDungeonLevel(trCurrentLevel);
  if (hintEl) hintEl.textContent = `Level ${trCurrentLevel} Target CR: ~${formatCR(baseCR)} (Ceiling CR: ${formatCR(maxCR)})`;

  const styleData = trData[trCurrentStyle] || {};
  const themeData = styleData[trCurrentTheme] || {};

  let buttonsHtml = '';
  for (let lvl = 1; lvl <= 20; lvl++) {
    const isActive = lvl === trCurrentLevel;
    const count = Array.isArray(themeData[String(lvl)]) ? themeData[String(lvl)].length : 0;
    buttonsHtml += `
      <button class="tr-lvl-btn ${isActive ? 'active' : ''}" data-level="${lvl}" title="Level ${lvl} — ${count} curated monster(s)">
        <span class="tr-lvl-num">${lvl}</span>
        <span class="tr-lvl-count">${count}</span>
      </button>
    `;
  }
  el.innerHTML = buttonsHtml;

  el.querySelectorAll('.tr-lvl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      trCurrentLevel = parseInt(btn.dataset.level, 10);
      renderTacticalRoomsTab();
    });
  });
}

function renderTacticalCuratedChips() {
  const el = document.getElementById('tr-curated-chips');
  const countEl = document.getElementById('tr-curated-count');
  if (!el) return;
  const isEnabled = isCurrentStyleEnabledInTheme(trCurrentTheme);
  const list = getCuratedListForCurrentSelection();
  if (countEl) countEl.textContent = `${list.length} creature${list.length === 1 ? '' : 's'}`;

  if (!isEnabled) {
    el.innerHTML = `
      <div class="warn-row warn-bad" style="width:100%; display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <span>⚠️ <b>Disabled in ${drThemeLabel(trCurrentTheme)}:</b> This tactical room type will NOT spawn during dungeon generation for this biome. Click the button above to enable it.</span>
        <button class="btn btn-xs btn-success" id="tr-quick-enable-btn" style="color:#000;">Enable Now</button>
      </div>
    `;
    document.getElementById('tr-quick-enable-btn')?.addEventListener('click', () => {
      toggleCurrentStyleTheme(trCurrentTheme);
    });
    return;
  }

  if (!list.length) {
    el.innerHTML = `<div class="mob-lane-empty">No curated creatures yet for Level ${trCurrentLevel}. Check creatures in the candidate grid below, or click "Seed Level Defaults".</div>`;
    return;
  }

  el.innerHTML = list.map(id => {
    const m = getMonsterById(id) || { id, name: id, cr: 0 };
    return `
      <div class="tr-mob-chip" data-id="${m.id}">
        <span class="tr-chip-name">${m.name}</span>
        <span class="tr-chip-cr">CR ${formatCR(m.cr)}</span>
        <button type="button" class="tr-chip-del-btn" title="Remove ${m.name} from level ${trCurrentLevel}">×</button>
      </div>
    `;
  }).join('');

  el.querySelectorAll('.tr-chip-del-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = e.target.closest('.tr-mob-chip').dataset.id;
      removeMonsterFromCuratedRoom(id);
    });
  });
}

function removeMonsterFromCuratedRoom(id) {
  const list = getCuratedListForCurrentSelection();
  const idx = list.indexOf(id);
  if (idx !== -1) {
    list.splice(idx, 1);
    saveTacticalRoomsToLocalStorage();
    renderTacticalCuratedChips();
    renderTacticalLevelStrip();
    renderTacticalCandidateGrid();
    renderTacticalStyleList();
    showToast(`Removed from Level ${trCurrentLevel}.`);
  }
}

function addMonsterToCuratedRoom(id) {
  const list = getCuratedListForCurrentSelection();
  if (!list.includes(id)) {
    list.push(id);
    saveTacticalRoomsToLocalStorage();
    renderTacticalCuratedChips();
    renderTacticalLevelStrip();
    renderTacticalCandidateGrid();
    renderTacticalStyleList();
    const m = getMonsterById(id);
    showToast(`Added ${m?.name || id} to Level ${trCurrentLevel}.`);
  }
}

function trFilteredCandidates() {
  return allMonsters.filter(m => {
    if (trSearch && !m.name.toLowerCase().includes(trSearch) && !m.id.includes(trSearch)) return false;
    if (trFamilyFilter !== 'all' && getThemeForMonster(m) !== trFamilyFilter) return false;
    if (trDungeonFilter === 'theme' && !drMonsterIn(m, trCurrentTheme)) return false;
    const cr = m.cr ?? 0;
    if (trCrMin != null && cr < trCrMin) return false;
    if (trCrMax != null && cr > trCrMax) return false;
    return true;
  }).sort((a, b) => {
    const crA = a.cr ?? 0, crB = b.cr ?? 0;
    if (crA !== crB) return crA - crB;
    return a.name.localeCompare(b.name);
  });
}

function renderTacticalCandidateGrid() {
  const el = document.getElementById('tr-candidate-grid');
  const countEl = document.getElementById('tr-candidate-count');
  if (!el) return;
  const list = trFilteredCandidates();
  if (countEl) countEl.textContent = `${list.length} shown / ${allMonsters.length}`;

  const curatedSet = new Set(getCuratedListForCurrentSelection());

  el.innerHTML = list.map(m => {
    const isSelected = curatedSet.has(m.id);
    return `
      <label class="dr-mob-row ${isSelected ? 'on' : ''}" data-id="${m.id}" title="${m.name} — CR ${formatCR(m.cr)} · ${getThemeForMonster(m)}">
        <input type="checkbox" ${isSelected ? 'checked' : ''}>
        <span class="dr-mob-name">${m.name}</span>
        <span class="dr-mob-fam">${getThemeForMonster(m)}</span>
        <span class="dr-mob-cr">CR ${formatCR(m.cr)}</span>
      </label>
    `;
  }).join('') || '<div class="mob-lane-empty">No candidate creatures match these filters.</div>';

  el.querySelectorAll('.dr-mob-row input').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.closest('.dr-mob-row').dataset.id;
      if (e.target.checked) {
        addMonsterToCuratedRoom(id);
      } else {
        removeMonsterFromCuratedRoom(id);
      }
    });
  });
}

function seedTacticalRoomDefaults() {
  const list = getCuratedListForCurrentSelection();
  const cap = maxCrForDungeonLevel(trCurrentLevel);
  const minCR = Math.max(0, cap * 0.2);

  let suggestions = [];
  if (trCurrentStyle === 'swarm') {
    suggestions = allMonsters.filter(m => {
      const fam = getThemeForMonster(m);
      const isVermin = fam === 'Vermin' || (m.tags && m.tags.includes('vermin'));
      const inTheme = drMonsterIn(m, trCurrentTheme);
      const cr = m.cr ?? 0;
      return (isVermin || fam === 'Beasts') && inTheme && cr <= cap && cr >= minCR;
    }).slice(0, 4).map(m => m.id);
    if (!suggestions.length) {
      suggestions = allMonsters.filter(m => {
        const fam = getThemeForMonster(m);
        const isVermin = fam === 'Vermin' || (m.tags && m.tags.includes('vermin'));
        return (isVermin || fam === 'Beasts') && (m.cr ?? 0) <= cap;
      }).slice(0, 3).map(m => m.id);
    }
  } else if (trCurrentStyle === 'necromantic') {
    suggestions = allMonsters.filter(m => getThemeForMonster(m) === 'Undead' && drMonsterIn(m, trCurrentTheme) && (m.cr ?? 0) <= cap).slice(0, 4).map(m => m.id);
  } else if (trCurrentStyle === 'nest') {
    suggestions = allMonsters.filter(m => (m.type === 'monstrosity' || getThemeForMonster(m) === 'Vermin') && drMonsterIn(m, trCurrentTheme) && (m.cr ?? 0) <= cap).slice(0, 3).map(m => m.id);
  } else {
    suggestions = allMonsters.filter(m => drMonsterIn(m, trCurrentTheme) && (m.cr ?? 0) <= cap).slice(0, 3).map(m => m.id);
  }

  if (!suggestions.length) {
    showToast(`No matching default candidates found for this theme at Level ${trCurrentLevel}.`);
    return;
  }

  let added = 0;
  for (const id of suggestions) {
    if (!list.includes(id)) { list.push(id); added++; }
  }
  saveTacticalRoomsToLocalStorage();
  renderTacticalCuratedChips();
  renderTacticalCandidateGrid();
  renderTacticalLevelStrip();
  renderTacticalStyleList();
  showToast(added ? `Seeded ${added} creature(s) for Level ${trCurrentLevel}.` : 'Creatures already present.');
}
