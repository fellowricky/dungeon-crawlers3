/**
 * =============================================================================
 * DUNGEON THEME & LEVEL TEST LAUNCHER (DEVELOPER TOOL)
 * =============================================================================
 * Allows selecting any dungeon theme (Ancient, Molten, Frost, Grim, Verdant,
 * Forest, Moor, Mire, etc.) and level (1-20) for instant testing.
 *
 * HOW TO REMOVE OR DISABLE FOR RELEASE:
 * Option 1: Set ENABLE_DEV_TEST_DELVE = false below. (Feature disables completely)
 * Option 2: Remove the 1-line call in src/main.js and delete this file.
 * =============================================================================
 */

import { makeHero, grantXp, XP_TABLE, MAX_LEVEL } from './srd.js';
import { getRaceDefaults } from './appearance.js';
import { GuildManager } from './guild.js';
import { buildPartyFrames, updateResources, log } from './ui.js';

export const ENABLE_DEV_TEST_DELVE = true;

const THEME_OPTIONS = [
  // Core Dungeons
  { id: 'ancient', name: 'Ancient', category: 'dungeon', icon: '🏛️', color: '#e8973f', desc: 'Sunken stone halls & forgotten crypts' },
  { id: 'molten', name: 'Molten', category: 'dungeon', icon: '🌋', color: '#ff8642', desc: 'Basalt crucibles, lava pools & cinder sparks' },
  { id: 'frost', name: 'Frost', category: 'dungeon', icon: '❄️', color: '#7fd4ff', desc: 'Rimebound ice caverns & glacial pools' },
  { id: 'grim', name: 'Grim', category: 'dungeon', icon: '💀', color: '#9fe66a', desc: 'Blighted necropolis, bone heaps & toxic pools' },
  { id: 'verdant', name: 'Verdant', category: 'dungeon', icon: '🌿', color: '#59d68f', desc: 'Overgrowth, moss brick & fungal blooms' },
  // Overland Wilderness
  { id: 'forest', name: 'Forest', category: 'overland', icon: '🌲', color: '#8fd45a', desc: 'Dense woodland trails & shaded clearings' },
  { id: 'moor', name: 'Moor', category: 'overland', icon: '🌾', color: '#c9b877', desc: 'Peat bogs, heather & cold wind' },
  { id: 'mire', name: 'Mire', category: 'overland', icon: '🐊', color: '#6f9a72', desc: 'Murky swamp meres & plank causeways' },
  { id: 'holdfast', name: 'Holdfast', category: 'overland', icon: '🏰', color: '#e0a24a', desc: 'Fortified earthen perimeter & stockade' },
  { id: 'snowfield', name: 'Snowfield', category: 'overland', icon: '🏔️', color: '#c8dcec', desc: 'Blizzard-swept tundra approach' },
  { id: 'ashfield', name: 'Ashfield', category: 'overland', icon: '🔥', color: '#ff7a30', desc: 'Scorched volcanic waste & fissures' },
  { id: 'sporewood', name: 'Sporewood', category: 'overland', icon: '🍄', color: '#b975d9', desc: 'Alien fungal forest & glowing spores' },
  { id: 'ruinfield', name: 'Ruinfield', category: 'overland', icon: '🧱', color: '#b0a688', desc: 'Crumbling stone outworks & rubble' },
  { id: 'boneyard', name: 'Boneyard', category: 'overland', icon: '🦴', color: '#9fd08a', desc: 'Desolate skeletal valley' },
];

function getCrRangeText(level) {
  if (level <= 1) return 'CR 1/8 – 1 · Kobolds, Skeletons, Goblins, Giant Rats';
  if (level <= 4) return 'CR 1/2 – 2 · Orcs, Hobgoblins, Zombies, Spiders, Bugbears';
  if (level <= 8) return 'CR 2 – 5 · Ogres, Mummies, Gargoyles, Minotaurs, Wights';
  if (level <= 12) return 'CR 5 – 9 · Trolls, Elementals, Wraiths, Wyverns, Mages';
  if (level <= 16) return 'CR 9 – 13 · Bone Devils, Golems, Beholders, Young Dragons';
  return 'CR 13 – 20+ · Pit Fiends, Balors, Adult/Ancient Dragons, Liches';
}

function createHeroVisual(raceKey, gender = 'male') {
  const raceDefs = getRaceDefaults(raceKey);
  return {
    gender,
    head: raceDefs.head || '',
    skinColor: raceDefs.skinColor || '#f0c896',
    hair: raceDefs.hair || (gender === 'female' ? 'long_tied/adult' : 'short/adult'),
    hairExtension: 'none',
    facialHair: raceDefs.facialHair || 'none',
    hairColor: raceDefs.hairColor || '#302018',
    hairExtColor: '',
    eyeColor: raceDefs.eyeColor || '#3a72a0',
    ears: raceDefs.ears || 'none',
    horns: raceDefs.horns || 'none',
    spriteScaleX: raceDefs.spriteScaleX || 1.0,
    spriteScaleY: raceDefs.spriteScaleY || 1.0
  };
}

let _modalEl = null;
let _gameInstance = null;
let _godModeInterval = null;
let _selectedThemeId = 'ancient';

/**
 * Creates or retrieves the Test Delve Modal DOM element.
 */
function getOrCreateModal() {
  if (_modalEl && document.body && document.body.contains(_modalEl)) return _modalEl;

  const overlay = document.createElement('div');
  overlay.id = 'dev-test-delve-modal';
  overlay.className = 'dev-test-overlay';
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 99999;
    background: rgba(5, 7, 12, 0.85);
    backdrop-filter: blur(8px);
    display: none;
    align-items: center;
    justify-content: center;
    padding: 16px;
    box-sizing: border-box;
    font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #e2e4f0;
  `;

  overlay.innerHTML = `
    <div class="dev-test-dialog" style="
      background: #111422;
      border: 1px solid rgba(217, 164, 65, 0.35);
      border-radius: 12px;
      width: min(860px, 95vw);
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 16px 48px rgba(0,0,0,0.8), 0 0 24px rgba(217, 164, 65, 0.15);
      overflow: hidden;
    ">
      <div class="dev-test-header" style="
        padding: 14px 20px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(24, 28, 46, 0.6);
      ">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="
            background: rgba(217, 164, 65, 0.15);
            border: 1px solid rgba(217, 164, 65, 0.4);
            color: #fcd34d;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 1px;
            padding: 3px 8px;
            border-radius: 4px;
          ">DEV TEST</span>
          <h2 style="margin:0; font-size:18px; font-weight:600; letter-spacing:0.5px; color:#f0f2ff;">
            DUNGEON THEME &amp; LEVEL CHOOSER
          </h2>
        </div>
        <button id="dev-test-close-btn" style="
          background: none;
          border: none;
          color: #8e95b0;
          font-size: 20px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
        " title="Close (Esc)">✕</button>
      </div>

      <div class="dev-test-body" style="
        padding: 18px 20px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 18px;
      ">
        <!-- Section: Theme -->
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <label style="font-size:13px; font-weight:600; color:#d9a441; letter-spacing:0.5px;">
              1. SELECT DUNGEON THEME
            </label>
            <div id="dev-theme-filter" style="display:flex; gap:6px;">
              <button class="dev-filter-btn active" data-cat="all" style="
                background:#181c2e; border:1px solid rgba(217,164,65,0.3); color:#fcd34d;
                font-size:11px; padding:3px 9px; border-radius:4px; cursor:pointer;
              ">ALL (${THEME_OPTIONS.length})</button>
              <button class="dev-filter-btn" data-cat="dungeon" style="
                background:#0e101a; border:1px solid rgba(255,255,255,0.1); color:#8e95b0;
                font-size:11px; padding:3px 9px; border-radius:4px; cursor:pointer;
              ">DUNGEONS (5)</button>
              <button class="dev-filter-btn" data-cat="overland" style="
                background:#0e101a; border:1px solid rgba(255,255,255,0.1); color:#8e95b0;
                font-size:11px; padding:3px 9px; border-radius:4px; cursor:pointer;
              ">OVERLAND (9)</button>
            </div>
          </div>
          <div id="dev-theme-grid" style="
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 8px;
            max-height: 200px;
            overflow-y: auto;
            padding-right: 4px;
          "></div>
        </div>

        <!-- Section: Level & Difficulty -->
        <div style="background:rgba(24,28,46,0.4); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:12px 14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <label style="font-size:13px; font-weight:600; color:#d9a441; letter-spacing:0.5px;">
              2. DUNGEON DIFFICULTY &amp; LEVEL
            </label>
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:12px; color:#8e95b0;">Level:</span>
              <input id="dev-level-input" type="number" min="1" max="20" value="1" style="
                background:#0e101a; border:1px solid rgba(217,164,65,0.4); color:#fcd34d;
                font-size:14px; font-weight:700; width:52px; text-align:center; padding:3px; border-radius:4px;
              ">
            </div>
          </div>
          <input id="dev-level-slider" type="range" min="1" max="20" value="1" style="
            width:100%; accent-color:#d9a441; cursor:pointer; margin-bottom:8px;
          ">
          <div id="dev-cr-info" style="font-size:12px; color:#8e95b0; line-height:1.4;">
            ${getCrRangeText(1)}
          </div>
        </div>

        <!-- Section: Floor Progression & Structure -->
        <div style="background:rgba(24,28,46,0.4); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:12px 14px;">
          <label style="display:block; font-size:13px; font-weight:600; color:#d9a441; margin-bottom:10px;">
            3. FLOOR SELECTION &amp; OVERLAND SKIP
          </label>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:10px;">
            <div style="display:flex; align-items:center; justify-content:space-between; background:#0e101a; border:1px solid rgba(255,255,255,0.08); padding:8px 12px; border-radius:6px;">
              <span style="font-size:12px; color:#f0f2ff;">Start on Floor:</span>
              <select id="dev-start-floor" style="
                background:#181c2e; border:1px solid rgba(217,164,65,0.4); color:#fcd34d;
                font-weight:700; padding:4px 8px; border-radius:4px; font-size:13px;
              ">
                <option value="1" selected>Floor 1</option>
                <option value="2">Floor 2</option>
                <option value="3">Floor 3</option>
                <option value="4">Floor 4</option>
                <option value="5">Floor 5</option>
                <option value="6">Floor 6</option>
                <option value="7">Floor 7</option>
                <option value="8">Floor 8</option>
                <option value="9">Floor 9</option>
                <option value="10">Floor 10 (Boss)</option>
              </select>
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; background:#0e101a; border:1px solid rgba(255,255,255,0.08); padding:8px 12px; border-radius:6px;">
              <span style="font-size:12px; color:#f0f2ff;">Total Floors:</span>
              <select id="dev-floors-select" style="
                background:#181c2e; border:1px solid rgba(255,255,255,0.15); color:#e2e4f0;
                padding:4px 8px; border-radius:4px; font-size:12px;
              ">
                <option value="1">1 Floor</option>
                <option value="3" selected>3 Floors</option>
                <option value="5">5 Floors</option>
                <option value="10">10 Floors (Full Campaign)</option>
              </select>
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:#38bdf8; cursor:pointer;">
              <input id="dev-skip-prologue" type="checkbox" checked style="accent-color:#38bdf8;">
              <b>Skip Overland Maps:</b> Dive directly into the selected dungeon theme on every floor (no forced approach/threshold maps).
            </label>
            <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:#f59e0b; cursor:pointer;">
              <input id="dev-rival-room" type="checkbox" checked style="accent-color:#f59e0b;">
              <b>Spawn Rival Adventurers Room:</b> Guaranteed 4-hero rival party campsite on this floor.
            </label>
          </div>
        </div>

        <!-- Section: Party Setup & Helpers -->
        <div style="background:rgba(24,28,46,0.4); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:12px 14px;">
          <label style="display:block; font-size:13px; font-weight:600; color:#d9a441; margin-bottom:8px;">
            4. PARTY &amp; TESTING HELPERS
          </label>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
            <div style="display:flex; flex-direction:column; gap:6px;">
              <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:#e2e4f0; cursor:pointer;">
                <input type="radio" name="dev-party-choice" value="scale" checked style="accent-color:#d9a441;">
                Auto-Scale Party (Fighter, Rogue, Cleric, Wizard leveled to match)
              </label>
              <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:#e2e4f0; cursor:pointer;">
                <input type="radio" name="dev-party-choice" value="current" style="accent-color:#d9a441;">
                Use Current / Saved Slot Party
              </label>
            </div>
            <div style="display:flex; flex-direction:column; gap:6px;">
              <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:#a3e635; cursor:pointer;">
                <input id="dev-reveal-map" type="checkbox" checked style="accent-color:#a3e635;">
                Reveal Entire Map (Disable fog-of-war)
              </label>
              <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:#67e8f9; cursor:pointer;">
                <input id="dev-god-mode" type="checkbox" style="accent-color:#06b6d4;">
                God Mode (Invincible heroes)
              </label>
              <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:#fcd34d; cursor:pointer;">
                <input id="dev-full-potions" type="checkbox" checked style="accent-color:#d9a441;">
                99x Potions of Healing
              </label>
            </div>
          </div>
        </div>
      </div>

      <div class="dev-test-footer" style="
        padding: 14px 20px;
        border-top: 1px solid rgba(255,255,255,0.08);
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(14, 16, 26, 0.95);
      ">
        <div style="font-size:11px; color:#8e95b0;">
          💡 Shortcut: Press <b style="color:#fcd34d;">F2</b> anytime to toggle this modal.
        </div>
        <div style="display:flex; gap:10px;">
          <button id="dev-test-cancel-btn" style="
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.12);
            color: #8e95b0;
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 13px;
            cursor: pointer;
          ">Cancel</button>
          <button id="dev-test-embark-btn" style="
            background: linear-gradient(135deg, #d9a441, #b8860b);
            border: 1px solid #fcd34d;
            color: #0b0c14;
            font-weight: 700;
            padding: 8px 22px;
            border-radius: 6px;
            font-size: 13px;
            cursor: pointer;
            letter-spacing: 0.5px;
            box-shadow: 0 2px 10px rgba(217,164,65,0.3);
          ">⚔️ EMBARK TEST DELVE</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  _modalEl = overlay;
  setupModalEvents(overlay);
  return overlay;
}

function renderThemeCards(container, filterCat = 'all') {
  if (!container) return;
  container.innerHTML = '';
  const filtered = THEME_OPTIONS.filter(t => filterCat === 'all' || t.category === filterCat);

  filtered.forEach(t => {
    const card = document.createElement('div');
    const isSelected = t.id === _selectedThemeId;
    card.className = `dev-theme-card ${isSelected ? 'selected' : ''}`;
    card.setAttribute('data-theme-id', t.id);
    if (card.dataset) card.dataset.themeId = t.id;
    card.style.cssText = `
      background: ${isSelected ? 'rgba(217, 164, 65, 0.12)' : 'rgba(24, 28, 46, 0.7)'};
      border: 1px solid ${isSelected ? t.color : 'rgba(255, 255, 255, 0.08)'};
      box-shadow: ${isSelected ? `0 0 12px ${t.color}44` : 'none'};
      border-radius: 6px;
      padding: 8px 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.15s ease;
    `;

    card.innerHTML = `
      <span style="font-size: 20px;">${t.icon}</span>
      <div style="flex:1; min-width:0;">
        <div style="display:flex; align-items:center; gap:6px;">
          <strong style="font-size:13px; color:${t.color};">${t.name}</strong>
          <span style="font-size:9px; background:rgba(255,255,255,0.08); padding:1px 4px; border-radius:3px; color:#8e95b0; text-transform:uppercase;">
            ${t.category}
          </span>
        </div>
        <div style="font-size:10px; color:#8e95b0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${t.desc}">
          ${t.desc}
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      _selectedThemeId = t.id;
      renderThemeCards(container, filterCat);
    });

    container.appendChild(card);
  });
}

function setupModalEvents(overlay) {
  const closeBtn = overlay.querySelector('#dev-test-close-btn');
  const cancelBtn = overlay.querySelector('#dev-test-cancel-btn');
  const embarkBtn = overlay.querySelector('#dev-test-embark-btn');
  const lvlSlider = overlay.querySelector('#dev-level-slider');
  const lvlInput = overlay.querySelector('#dev-level-input');
  const crInfo = overlay.querySelector('#dev-cr-info');
  const themeGrid = overlay.querySelector('#dev-theme-grid');
  const filterBtns = overlay.querySelectorAll('.dev-filter-btn');

  let currentCategory = 'all';
  renderThemeCards(themeGrid, currentCategory);

  if (filterBtns && filterBtns.forEach) {
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => {
          b.classList.remove('active');
          b.style.background = '#0e101a';
          b.style.borderColor = 'rgba(255,255,255,0.1)';
          b.style.color = '#8e95b0';
        });
        btn.classList.add('active');
        btn.style.background = '#181c2e';
        btn.style.borderColor = 'rgba(217,164,65,0.3)';
        btn.style.color = '#fcd34d';
        currentCategory = btn.dataset ? btn.dataset.cat : 'all';
        renderThemeCards(themeGrid, currentCategory);
      });
    });
  }

  const syncLevel = (val) => {
    let num = parseInt(val, 10) || 1;
    num = Math.max(1, Math.min(20, num));
    if (lvlSlider) lvlSlider.value = num;
    if (lvlInput) lvlInput.value = num;
    if (crInfo) crInfo.textContent = getCrRangeText(num);
  };

  if (lvlSlider && lvlSlider.addEventListener) {
    lvlSlider.addEventListener('input', e => syncLevel(e.target.value));
  }
  if (lvlInput && lvlInput.addEventListener) {
    lvlInput.addEventListener('change', e => syncLevel(e.target.value));
  }

  const close = () => {
    overlay.style.display = 'none';
  };

  if (closeBtn && closeBtn.addEventListener) closeBtn.addEventListener('click', close);
  if (cancelBtn && cancelBtn.addEventListener) cancelBtn.addEventListener('click', close);
  if (overlay.addEventListener) {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) close();
    });
  }

  if (embarkBtn && embarkBtn.addEventListener) {
    embarkBtn.addEventListener('click', () => {
      const level = parseInt(lvlInput?.value, 10) || 1;
      const startFloor = parseInt(overlay.querySelector('#dev-start-floor')?.value, 10) || 1;
      const floors = parseInt(overlay.querySelector('#dev-floors-select')?.value, 10) || 3;
      const skipPrologue = overlay.querySelector('#dev-skip-prologue')?.checked !== false;
      const rivalRoom = overlay.querySelector('#dev-rival-room')?.checked !== false;
      const partyChoice = overlay.querySelector('input[name="dev-party-choice"]:checked')?.value || 'scale';
      const revealMap = !!overlay.querySelector('#dev-reveal-map')?.checked;
      const godMode = !!overlay.querySelector('#dev-god-mode')?.checked;
      const fullPotions = !!overlay.querySelector('#dev-full-potions')?.checked;

      close();
      launchTestDelve({
        theme: _selectedThemeId,
        level,
        startFloor,
        floors: Math.max(floors, startFloor),
        skipPrologue,
        rivalRoom,
        seed: Math.floor(Math.random() * 999999) + 1,
        partyChoice,
        revealMap,
        godMode,
        fullPotions
      });
    });
  }
}

/**
 * Launch the test delve with selected parameters.
 */
export function launchTestDelve(config) {
  if (!_gameInstance) {
    console.error('[TestDelve] Game instance not bound!');
    return;
  }

  const game = _gameInstance;
  const themeSpec = THEME_OPTIONS.find(t => t.id === config.theme) || THEME_OPTIONS[0];

  // 1. Setup Party with complete LPC visuals so sprites never appear blank/invisible
  const DEFAULT_BUILDS = [
    { name: 'Valen', raceKey: 'human', classKey: 'fighter', gender: 'male', stats: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 } },
    { name: 'Lyra', raceKey: 'elf', classKey: 'rogue', gender: 'female', stats: { str: 8, dex: 15, con: 12, int: 14, wis: 10, cha: 13 } },
    { name: 'Morgrim', raceKey: 'dwarf', classKey: 'cleric', gender: 'male', stats: { str: 14, dex: 8, con: 14, int: 10, wis: 15, cha: 12 } },
    { name: 'Eldrin', raceKey: 'human', classKey: 'wizard', gender: 'male', stats: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 } }
  ];

  if (config.partyChoice === 'scale' || !game.heroes || game.heroes.length === 0) {
    game.heroes = DEFAULT_BUILDS.map(b => ({
      data: makeHero(b.name, b.raceKey, b.classKey, b.stats, createHeroVisual(b.raceKey, b.gender))
    }));
    game.leaderIdx = 0;

    // Scale to target level
    if (config.level > 1) {
      for (const h of game.heroes) {
        const targetXp = XP_TABLE[config.level] || 0;
        if (targetXp > h.data.xp) {
          grantXp(h.data, targetXp - h.data.xp);
        }
      }
    }
  }

  if (!game.guild) game.guild = new GuildManager(game);

  // 2. Cheats / Helpers
  if (config.fullPotions) {
    game.potions = { heal: 99, greater: 99, superior: 99 };
  }

  if (config.godMode) {
    if (_godModeInterval) clearInterval(_godModeInterval);
    _godModeInterval = setInterval(() => {
      if (game.heroes) {
        for (const h of game.heroes) {
          if (h && h.data) {
            h.data.hp = Math.max(h.data.hp, h.data.maxHp || 100);
          }
        }
      }
    }, 200);
  } else if (_godModeInterval) {
    clearInterval(_godModeInterval);
    _godModeInterval = null;
  }

  // 3. Clear UI screens (Title, World Map, Setup, Pause)
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.remove('title-open');
    const screens = ['titlescreen', 'worldmapscreen', 'setup', 'overlay', 'wm-sysmenu'];
    screens.forEach(id => {
      const s = document.getElementById(id);
      if (s) s.style.display = 'none';
    });
  }

  buildPartyFrames(game.heroes.map(h => h.data));
  updateResources(game);
  if (typeof game.updateModeToggleUI === 'function') game.updateModeToggleUI();

  // 4. Create custom test quest with explicit floor plan to skip prologue overland maps
  const isOverland = themeSpec.category === 'overland';
  const startFloor = Math.max(1, config.startFloor || 1);
  const totalFloors = Math.max(config.floors || 3, startFloor);

  // Build explicit floorPlan entries so every floor uses the requested theme without random overland injection
  const floorPlan = Array.from({ length: totalFloors }, (_, i) => ({
    mapKind: isOverland ? 'overland' : 'dungeon',
    theme: themeSpec.id,
    name: `${themeSpec.name} — Floor ${i + 1}`,
    level: config.level
  }));

  const testQuest = {
    id: `test_delve_${themeSpec.id}_lv${config.level}`,
    name: `Test: ${themeSpec.name.toUpperCase()} (Lv ${config.level})`,
    desc: `Dev test run for ${themeSpec.name} (${themeSpec.category}) at Level ${config.level}.`,
    theme: themeSpec.id,
    level: config.level,
    startFloor: startFloor,
    floors: totalFloors,
    floorPlan: config.skipPrologue ? floorPlan : null,
    skipPrologue: !!config.skipPrologue,
    mapKind: isOverland ? 'overland' : 'dungeon',
    seed: config.seed || (Math.floor(Math.random() * 999999) + 1),
    threatMult: 1.0,
    forceRivalRoom: !!config.rivalRoom,
    rivalFloor: startFloor,
    testDelve: true,
    rewards: { gold: 500, xp: 1000 }
  };

  log(`🧪 [TEST DELVE] Launching ${themeSpec.name} at Level ${config.level}, starting on Floor ${startFloor}/${totalFloors} (Overland skipped: ${config.skipPrologue})`, 'sys');

  game.startQuest(testQuest);

  // 5. If Reveal Map was chosen, unveil all rooms & cells
  if (config.revealMap) {
    const revealAll = () => {
      if (!game.D || !game.revealed) return;
      if (Array.isArray(game.D.rooms)) {
        for (let r = 0; r < game.D.rooms.length; r++) {
          if (typeof game.visitRoom === 'function') game.visitRoom(r);
        }
      }
      for (let c = 0; c < game.D.W * game.D.H; c++) {
        if (game.D.grid && game.D.grid[c] === 1 /* FLOOR */) {
          game.revealed[c] = 1;
        }
      }
      if (typeof game.recalculateFog === 'function') game.recalculateFog(game);
    };

    setTimeout(revealAll, 400);
    setTimeout(revealAll, 1200);
  }
}

/**
 * Open the Test Delve Modal.
 */
export function openTestDelveModal() {
  if (!ENABLE_DEV_TEST_DELVE) return;
  const modal = getOrCreateModal();
  modal.style.display = 'flex';
}

/**
 * Close the Test Delve Modal.
 */
export function closeTestDelveModal() {
  if (_modalEl) _modalEl.style.display = 'none';
}

/**
 * Injects Title Screen button & HUD button and sets up hotkeys.
 */
export function initTestDungeon(game) {
  if (!ENABLE_DEV_TEST_DELVE) return;
  _gameInstance = game;

  if (typeof document === 'undefined') return;

  // 1. Inject into Title Screen menu
  const injectTitleButton = () => {
    const tsMenu = document.querySelector('#titlescreen .ts-menu');
    if (tsMenu && !document.getElementById('ts-test-delve')) {
      const testBtn = document.createElement('button');
      testBtn.id = 'ts-test-delve';
      testBtn.className = 'ts-btn dev-test-btn';
      testBtn.style.cssText = `
        border-color: rgba(217, 164, 65, 0.5) !important;
        color: #fcd34d !important;
        background: linear-gradient(180deg, rgba(217, 164, 65, 0.15) 0%, rgba(14, 16, 26, 0.8) 100%) !important;
      `;
      testBtn.innerHTML = '🧪 TEST DELVE (DEV)';
      testBtn.addEventListener('click', openTestDelveModal);

      // Place right after "NEW GAME"
      const newGameBtn = document.getElementById('ts-new');
      if (newGameBtn && newGameBtn.nextSibling) {
        tsMenu.insertBefore(testBtn, newGameBtn.nextSibling);
      } else {
        tsMenu.appendChild(testBtn);
      }
    }
  };

  // 2. Inject top-right in-game HUD button
  const injectHudButton = () => {
    const hudRight = document.getElementById('hud-top-right');
    if (hudRight && !document.getElementById('btn-dev-test-hud')) {
      const devChip = document.createElement('button');
      devChip.id = 'btn-dev-test-hud';
      devChip.title = 'Dev Test Chooser (F2)';
      devChip.style.cssText = `
        background: rgba(14, 16, 26, 0.85);
        border: 1px solid rgba(217, 164, 65, 0.4);
        color: #fcd34d;
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        margin-right: 6px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        backdrop-filter: blur(4px);
        font-family: inherit;
      `;
      devChip.innerHTML = '🧪 Test';
      devChip.addEventListener('click', openTestDelveModal);

      const floorBadge = document.getElementById('floorbadge');
      if (floorBadge) {
        hudRight.insertBefore(devChip, floorBadge);
      } else {
        hudRight.appendChild(devChip);
      }
    }
  };

  injectTitleButton();
  injectHudButton();

  setTimeout(injectTitleButton, 500);
  setTimeout(injectHudButton, 500);

  // 3. Hotkey: F2 (or Ctrl+Shift+D)
  document.addEventListener('keydown', e => {
    if (e.key === 'F2' || (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd'))) {
      e.preventDefault();
      if (_modalEl && _modalEl.style.display === 'flex') {
        closeTestDelveModal();
      } else {
        openTestDelveModal();
      }
    } else if (e.key === 'Escape' && _modalEl && _modalEl.style.display === 'flex') {
      closeTestDelveModal();
    }
  });

  // 4. URL query parameters check (e.g. ?testDelve=1, ?theme=molten&level=5&floor=3)
  if (typeof window !== 'undefined' && window.location && window.location.search) {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('testDelve') || urlParams.has('theme')) {
      const paramTheme = urlParams.get('theme') || 'ancient';
      const paramLevel = parseInt(urlParams.get('level'), 10) || 1;
      const paramFloor = parseInt(urlParams.get('floor'), 10) || 1;
      const paramFloors = parseInt(urlParams.get('floors'), 10) || 3;
      const paramSkipPrologue = urlParams.get('skipPrologue') !== 'false';
      const paramGod = urlParams.get('god') === '1' || urlParams.get('god') === 'true';
      const paramReveal = urlParams.get('reveal') !== '0';

      if (urlParams.get('testDelve') === 'auto' || urlParams.has('theme')) {
        setTimeout(() => {
          launchTestDelve({
            theme: paramTheme,
            level: paramLevel,
            startFloor: paramFloor,
            floors: Math.max(paramFloors, paramFloor),
            skipPrologue: paramSkipPrologue,
            seed: Math.floor(Math.random() * 999999) + 1,
            partyChoice: 'scale',
            revealMap: paramReveal,
            godMode: paramGod,
            fullPotions: true
          });
        }, 300);
      } else {
        setTimeout(openTestDelveModal, 300);
      }
    }
  }
}
