/**
 * Bestiary & Monster Visual/Stat Editor Module
 * Standalone tool for reviewing monsters, editing stats, scale, and granular Color Balance
 * (Shadows/Lows, Midtones/Mediums, Highlights/Highs), testing sprites, and exporting monsters.json.
 * Includes live expanded In-Game Room Combat Arena preview with generated walls & scatter terrain.
 */

import { MONSTERS_RAW, MONSTERS_ALL, applyCRScalingToMonster, fmtMod } from './game/srd.js';
import { BOSS_SPELLS, BOSS_SPELL_FX } from './game/monster_ai.js';
import { playSfx, spellSfx } from './game/audio.js';
import {
  CR_SCALING_TABLE, crForDungeonLevel, baseCrForDungeonLevel, crUpChanceForDungeonLevel, crToCost, crBandIndex
} from './game/constants.js';
import CR_SCALING_FACTORY from './game/cr_scaling.default.json' with { type: 'json' };
import { SPAWN_BUDGET, spawnLevelRow, makeRng } from './dungeon/dungeon_generator.js';
import SPAWN_BUDGET_FACTORY from './game/spawn_budget.default.json' with { type: 'json' };
import { getDefaultColorBalance, applyColorBalanceToPixel } from './game/color_balance.js';

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
let heroReference = 'human.png'; // 'none', 'human.png', 'dwarf.png', 'elf.png', 'halfling.png'
let autoFitZoom = false; // Auto zoom out if monster scale clips container
let testSpriteOverride = null; // Custom uploaded sprite file URL
let showCRScaled = true; // Scale monster stats in statblock display according to CR table

// Hero Scale Comparison Reference & Ground Alignment State
let showHeroRef = true;
let heroRefSprite = 'human.png';
let snapToGround = true;
let currentYOffset = 0;

const HERO_SCALES = {
  'human.png': 1.0,
  'dwarf.png': 0.85,
  'elf.png': 1.0,
  'halfling.png': 0.65
};

// Default Color Balance (Shadows, Midtones, Highlights) lives in
// game/color_balance.js — the game bakes the same math into monster sprites.

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  setupUIEventListeners();
  setupTabs();
  setupCRScalingTab();
  setupSpawnBudgetTab();
  setupKeyboardNavigation();
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
  } catch (e) {
    console.warn("Failed to load monster edits from localStorage", e);
    userEdits = {};
  }

  mergeUserEditsIntoMonsters();
}

function mergeUserEditsIntoMonsters() {
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
      currentBg = e.target.dataset.bg;
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

  document.getElementById('hero-ref-select')?.addEventListener('change', (e) => {
    heroRefSprite = e.target.value;
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
      const activeSpritePath = testSpriteOverride || monster.sprite;
      const url = `test-skills.html?monster=${encodeURIComponent(monster.id)}&name=${encodeURIComponent(monster.name)}&scale=${monster.scale || 1.0}&sprite=${encodeURIComponent(activeSpritePath)}`;
      window.open(url, '_blank');
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
      const activeSpritePath = testSpriteOverride || m.sprite;
      const url = `test-skills.html?monster=${encodeURIComponent(m.id)}&name=${encodeURIComponent(m.name)}&scale=${m.scale || 1.0}&sprite=${encodeURIComponent(activeSpritePath)}`;
      window.open(url, '_blank');
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
      isBoss: document.getElementById('edit-isboss')?.checked || false,
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
      /* Tier filter now selects CR bands (option value 1-5 -> band 0-4) or the
         boss roster. Monsters no longer carry a `tier` field. */
      if (tierVal === 'boss') { if (!m.isBoss) return false; }
      else if (String(crBandIndex(m.cr)) !== String(Number(tierVal) - 1)) return false;
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
        <div class="monster-item-thumb" style="border-color: ${hexColor}">
          <img src="${resolveSpriteUrl(m.sprite)}" alt="${m.name}" loading="lazy" onerror="this.src='./dcss/monster/orc.png'">
        </div>
        <div class="monster-item-info">
          <div class="monster-item-name">${m.name}</div>
          <div class="monster-item-sub">
            <span class="cr-pill">CR ${formatCR(m.cr)}</span>
            <span class="type-pill">${m.type || 'creature'}</span>
            ${m.isBoss ? '<span class="tier-pill boss">☠ BOSS</span>' : ''}
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
    const imgEl = thumbEl.querySelector('img');
    if (imgEl) imgEl.src = resolveSpriteUrl(m.sprite);
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
      ${monster.isBoss ? '<span class="meta-badge badge-tier">☠ BOSS</span>' : ''}
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

  const editIsBoss = document.getElementById('edit-isboss');
  if (editIsBoss) editIsBoss.checked = !!monster.isBoss;

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
  });
}

const imageCache = {};

function renderSpriteCanvas(src, colorBalance, fallbackColorInt, scaleMultiplier, zoomFactor, callback) {
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

    const groundY = Math.floor(canvas.height * 0.78);
    const heroScaleFactor = HERO_SCALES[heroRefSprite] || 1.0;
    const yOffset = currentYOffset || 0;

    // Auto-Fit Zoom Calculation
    let effectiveZoom = zoomFactor;
    if (autoFitZoom) {
      const paddingX = 60;
      const paddingY = 80;

      const maxCanvasW = canvas.width - paddingX;
      const maxCanvasH = canvas.height - paddingY;

      const heroUnscaledW = 32 * heroScaleFactor;
      const heroUnscaledH = 32 * heroScaleFactor;

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
      const heroUrl = `./dcss/monster/${heroRefSprite}`;
      const drawBoth = (heroImg) => {
        const heroW = heroImg.naturalWidth || heroImg.width || 32;
        const heroH = heroImg.naturalHeight || heroImg.height || 32;

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

        const heroDisplayW = heroW * effectiveZoom * heroScaleFactor;
        const heroDisplayH = heroH * effectiveZoom * heroScaleFactor;
        const heroBottomPadDisp = heroBottomPadding * effectiveZoom * heroScaleFactor;

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
        ctx.fillText(`🧍 Hero (${heroScaleFactor.toFixed(2)}x)`, heroX + heroDisplayW / 2, Math.max(20, heroY - 8));

        // Draw Monster Sprite
        ctx.drawImage(offscreen, monsterX, monsterY, monsterDisplayW, monsterDisplayH);

        // Monster Tag & Badge
        ctx.fillStyle = '#fcd34d';
        ctx.fillText(`👾 Monster (${scaleMultiplier.toFixed(2)}x)`, monsterX + monsterDisplayW / 2, Math.max(20, monsterY - 8));
      };

      if (imageCache[heroUrl]) {
        drawBoth(imageCache[heroUrl]);
      } else {
        const heroImg = new Image();
        heroImg.crossOrigin = 'anonymous';
        heroImg.onload = () => {
          imageCache[heroUrl] = heroImg;
          drawBoth(heroImg);
        };
        heroImg.onerror = () => {
          const displayW = w * effectiveZoom * scaleMultiplier;
          const displayH = h * effectiveZoom * scaleMultiplier;
          const bottomPad = (snapToGround ? monsterBounds.bottomPadding : 0) * effectiveZoom * scaleMultiplier;
          const monsterYOffsetDisp = yOffset * effectiveZoom * 0.5;
          ctx.drawImage(offscreen, (canvas.width - displayW) / 2, groundY - displayH + bottomPad - monsterYOffsetDisp, displayW, displayH);
        };
        heroImg.src = heroUrl;
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

function openArenaModal() {
  const monster = getCurrentMonster();
  if (!monster) return;

  const modal = document.getElementById('arena-modal');
  if (modal) modal.style.display = 'flex';

  const nameEl = document.getElementById('arena-monster-name');
  if (nameEl) nameEl.textContent = `${monster.name} — 3D Dungeon Skill & Animation Arena`;

  const activeSpritePath = testSpriteOverride || monster.sprite;
  const iframe = document.getElementById('arena-3d-iframe');
  if (iframe) {
    iframe.src = `test-skills.html?monster=${encodeURIComponent(monster.id)}&name=${encodeURIComponent(monster.name)}&scale=${monster.scale || 1.0}&sprite=${encodeURIComponent(activeSpritePath)}&embed=1`;
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
  if (mainContainer) mainContainer.style.display = (tab === 'bestiary') ? 'flex' : 'none';
  if (crView) crView.classList.toggle('active', tab === 'cr-scaling');
  if (sbView) sbView.classList.toggle('active', tab === 'spawn-budget');
  if (tab === 'cr-scaling') renderCRTable();
  if (tab === 'spawn-budget') renderSpawnBudget();
  if (tab === 'bestiary') updateSpriteDisplay();
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
function sbRoomBudget(roomType, difficulty, threatMult, level = 1) {
  const floor = SPAWN_BUDGET.difficultyFloor ?? 0.35;
  const span = SPAWN_BUDGET.difficultySpan ?? 0.65;
  const mult = SPAWN_BUDGET.typeMult?.[roomType] ?? 1;
  const lvl = spawnLevelRow(level);
  return Math.round((SPAWN_BUDGET.baseBudget ?? 150) * threatMult * lvl.budgetMult * (floor + span * difficulty) * mult);
}

/* Effective per-room monster ceiling: the global cap, tightened by the level. */
function sbSpawnCap(level = 1) {
  return Math.min(SPAWN_BUDGET.maxSpawns ?? 10, spawnLevelRow(level).spawnCap ?? 99);
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
  const base = baseCrForDungeonLevel(level, SPAWN_BUDGET);
  const up = crUpChanceForDungeonLevel(level, SPAWN_BUDGET);
  if (up <= 0) return `CR ${formatCR(base)}`;
  return `CR ${formatCR(base)}+ (${Math.round((1 - up) * 100)}/${Math.round(up * 100)} roll-up)`;
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
    /* Priced at the CR this level actually fields — that's what the generator
       charges the budget, so a level 16 room's costly high-CR spawns buy far
       fewer bodies than a level 1 room's cheap trash at the same budget. */
    const cost = sbCrToCost(baseCrForDungeonLevel(l, SPAWN_BUDGET));

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

/* Mirror of the generator's generic-room spend loop, on a fixed seed so the
   preview is stable while knobs are dragged. */
function sbSimulateRoom(roomType, difficulty, threatMult, level = 1, seed = 1337) {
  const budget = sbRoomBudget(roomType, difficulty, threatMult, level);
  const cap = sbSpawnCap(level);
  const slackFrac = SPAWN_BUDGET.overspendSlack ?? 0.7;

  const rng = makeRng(seed);
  const crs = [];
  let remaining = budget;
  while (crs.length < cap) {
    const c = crForDungeonLevel(level, rng.raw, SPAWN_BUDGET);
    const cost = sbCrToCost(c);
    if (cost > remaining + cost * slackFrac) break;
    crs.push(c); remaining -= cost;
  }
  if (crs.length === 0) crs.push(baseCrForDungeonLevel(level, SPAWN_BUDGET));

  return { budget, crs, spent: budget - remaining, naturalCR: baseCrForDungeonLevel(level, SPAWN_BUDGET) };
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
        showToast("💾 Saved to src/game/spawn_budget.json — reload the game to apply.");
        return;
      }
    }
  } catch (e) {
    console.warn("Direct server save unavailable, falling back to download", e);
  }
  document.getElementById('sb-export-btn')?.click();
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
