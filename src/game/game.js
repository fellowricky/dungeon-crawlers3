/**
 * Dungeon Crawlers — game controller / orchestrator.
 *
 * Heroes explore autonomously (Clickpocalypse-style); the player watches,
 * clicks potions, and builds the party. Combat math is SRD 5.1.
 *
 * Domain logic lives in mixins (pathfinding, fog, combat, monster_ai, explore, inventory).
 * This file owns boot, dungeon load, the main update loop, and camera/UI glue.
 *
 * See README.md in this folder for the module map.
 */
import * as THREE from 'three';
import {
  makeHero, normalizeHero, spawnMonster, crForDungeonLevel, crBandIndex, MONSTER_THEMES, MONSTERS_BY_ID, monsterSpawnsIn, dungeonMonsterIds, grantXp, getCuratedBossEncounter,
  storyPoolIds, storyLaneWeight, planStoryFloorCast
} from './srd.js';
import {
  makeHeroMesh, makeMonsterMesh, drawBar, updateFloatTexts, makeFloatText,
  updateFlash, updateProjectiles, updateWorldFx, clearEffects,
  updateStatusTray, disposeSearchIndicator,
  createExitIndicator, updateExitIndicator, disposeExitIndicator,
  preloadAllSpellAndCombatVFX
} from './entities.js';
import { log, buildPartyFrames, updatePartyFrames, updateResources, showBanner, showTitle, showSetup, initGameLog, updateLogPauseBtn, bindPartyLeaderUI, bindCompanionUI } from './ui.js';
import { initMenus, refreshMenus } from './menus.js';
import { initShop, showShop } from './shop.js';
import { initWorldMap, showWorldMap } from './worldmap.js';
import { showIntroCrawl } from './intro_crawl.js';
import { initSkills, checkForChallenge, resetChallengeState, fireCampChallenge, checkRoomEntryChallenge, fireChallenge } from './skills.js';
import { checkBossReveal } from './boss_card.js';
import { showFloorBeat } from './floor_beat.js';
import { initChestWheel } from './chest_wheel.js';
import { initOptionsMenu } from './options_ui.js';
import { GuildManager } from './guild.js';
import {
  initQuestEvents, normalizeQuest, resolveFloorPhase, phaseNeedsChoice, offerFloorChoice,
  applyPhaseToSpawns, announceFloor, spawnAlly, dismissAlly, placeGems,
  checkPuzzleGate, onFloorCleared, onQuestCompleted, updateQuestTracker
} from './quest_events.js';
import { GAUNTLET_DESCEND } from './quest_story.js';
import { initRunStats, finalizeRunStats, trackGold, trackLoot, trackFloor, restoreRunStats } from './run_stats.js';
import { showQuestResults } from './results.js';
import { partyLongRest, partyShortRest } from './rest.js';
import { hasEffect } from './conditions.js';
import { initAudio, playSfx } from './audio.js';

import { THEME_ORDER, REVEAL_RADIUS, FLOOR } from './constants.js';
import { writeInstances } from '../render/dungeon_scene.js';
import { autoProloguePlan } from './overland_prologue.js';
import { _v } from './shared.js';
import { buildWallAdj, buildChokepoints, buildSolidProps, pathfindingMethods } from './pathfinding.js';
import { buildFogMaps, fogMethods } from './fog.js';
import { combatMethods } from './combat.js';
import { monsterAiMethods } from './monster_ai.js';
import { gameHookMethods } from './game_hooks.js';
import { exploreMethods } from './explore.js';
import { inventoryMethods } from './inventory.js';
import { initiativeMethods } from './initiative.js';
import { turnEngineMethods } from './turn_engine.js';
import { createSummonManager } from './summons.js';

/* Min real speed (world units/sec) that counts as "moving" for the walk cycle.
   Catches separation/wall-repel shove during scrums while ignoring settled jitter. */
const MOVE_ANIM_SPEED_EPS = 0.2;
/* Seconds to keep the walk cycle running after the last detected motion. Debounces
   bursty/intermittent movement (path capture, force cancellation) so heroes don't
   flicker back to the idle frame mid-stride. */
const WALK_ANIM_HOLD = 0.12;

const WIPE_FLAVOR = [
  'The darkness claims you for now\u2026',
  'A cold silence falls over the dungeon.',
  'Your vision fades to black\u2026',
  'Death is not the end \u2014 merely a pause.',
  'The abyss stares back, and blinks first.',
  'Your bodies lie still on the cold stone floor.',
  'Fate has dealt a cruel hand this day.',
  'The dungeon\u2019s shadows swallow you whole.',
  'A faint whisper echoes: \u201cNot yet\u2026\u201d',
  'You drift through an endless void\u2026',
  'The stones beneath you grow colder still.',
  'Even heroes must sometimes fall.',
];

let _cachedTentMaterial = null;

function createTentSprite() {
  if (!_cachedTentMaterial) {
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const ctx = cv.getContext('2d');

    ctx.fillStyle = '#8b6914';
    ctx.beginPath();
    ctx.moveTo(32, 8);
    ctx.lineTo(8, 56);
    ctx.lineTo(56, 56);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#4a3208';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#3a2204';
    ctx.beginPath();
    ctx.moveTo(32, 24);
    ctx.lineTo(24, 56);
    ctx.lineTo(40, 56);
    ctx.closePath();
    ctx.fill();

    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    _cachedTentMaterial = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false });
  }

  const sp = new THREE.Sprite(_cachedTentMaterial);
  sp.center.set(0.5, 0);
  return sp;
}

function drawCampfireCanvas(ctx, w, h, time) {
  ctx.clearRect(0, 0, w, h);

  const flk = Math.sin(time * 15) * 0.15 + Math.sin(time * 23) * 0.1;

  ctx.strokeStyle = '#5a3a1a';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(12, 44);
  ctx.lineTo(50, 52);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(50, 40);
  ctx.lineTo(12, 50);
  ctx.stroke();

  const fh = 28 + flk * 10;

  ctx.fillStyle = 'rgba(255,100,30,0.55)';
  ctx.beginPath();
  ctx.moveTo(20, 44);
  ctx.quadraticCurveTo(22 + flk * 4, 22, 32 + flk * 6, 44 - fh);
  ctx.quadraticCurveTo(42 - flk * 5, 18, 44, 44);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,180,40,0.75)';
  ctx.beginPath();
  ctx.moveTo(26, 44);
  ctx.quadraticCurveTo(27 + flk * 2, 32, 32 + flk * 4, 44 - fh * 0.7);
  ctx.quadraticCurveTo(37 - flk * 3, 30, 38, 44);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,180,0.85)';
  ctx.beginPath();
  ctx.arc(32, 44 - fh * 0.3, 6 + flk * 2, 0, Math.PI * 2);
  ctx.fill();
}

class Game {
  constructor() {
    this.state = 'boot';
    this.engine = null;
    this.D = null;
    this.heroes = [];
    this.leaderIdx = 0;   // index into this.heroes of the designated party leader
    this.monsters = [];
    this.summons = createSummonManager(this);   // companion/summon lifecycle
    bindCompanionUI({ for: (hd) => this.summons.summaryFor(hd) });
    this.chests = [];
    this.shrines = [];
    this.gold = 0;
    this.potions = { heal: 2, greater: 0, superior: 0 };
    this.inventory = [];
    this.dungeonLevel = 1;
    this.effectiveLevel = 1;
    this.activeQuest = null;
    this.questFloor = 0;
    this.questChains = { active: [], log: [] };
    this.legendaryPity = 0;  // 10-floor clears w/o a legendary (see LEGENDARY_PITY)
    this.floorPhase = null;
    this.puzzleState = null;
    this.gems = [];
    this.follow = null;
    this.freeCamUntil = 0;
    this.elapsed = 0;
    this.gameGroup = null;
    this.saveTimer = 0;
    this.paused = false;
    this.campAnim = null;
    this._deathChoiceOpen = false;
    this._deathTimer = null;
    this._deathPick = null;
    this._killStreak = 0;
    this._killStreakTimer = 0;
    this.storedHeroes = [];
    this.townShopInventory = [];
    this.townTavernHirePool = [];
    this.bestiary = {};  // { monsterId: killCount } — persists; unlocks compendium entries
    this.guild = new GuildManager(this);
    this.activeAoEZones = [];
    this.controlMode = 'auto';
    this._initReset();   // D&D initiative turn-order state
  }

  setControlMode(mode) {
    this.controlMode = (mode === 'manual') ? 'manual' : 'auto';
    log(`🕹️ Control mode set to ${this.controlMode.toUpperCase()}.`, 'sys');
    this.updateModeToggleUI();
    this.saveGame();
  }

  toggleControlMode() {
    this.setControlMode(this.controlMode === 'manual' ? 'auto' : 'manual');
  }

  updateModeToggleUI() {
    const btn = document.getElementById('mode-toggle-btn');
    if (!btn) return;
    const isManual = this.controlMode === 'manual';
    btn.className = `mode-toggle-btn ${isManual ? 'mode-manual' : 'mode-auto'}`;
    btn.innerHTML = `<span class="mode-ico">${isManual ? '🎯' : '⚡'}</span><span class="mode-label">${isManual ? 'MANUAL' : 'AUTO'}</span>`;
  }

  /** Average hero level, floored at 1.  Used to set a floor under
   *  dungeonLevel so over-levelled parties aren't fighting wet noodles. */
  partyLevel() {
    return Math.max(1, Math.round(
      this.heroes.reduce((s, h) => s + (h.data.level || 1), 0) / Math.max(1, this.heroes.length)
    ));
  }

  /* ============ boot / setup ============ */
  init(engine) {
    this.engine = engine;
    initChestWheel(this);
    /* Options overlay: bind its three openers and push the stored combat-log
       verbosity onto #gamelog before anything gets logged. */
    initOptionsMenu();

    const urlParams = new URLSearchParams(window.location.search);
    const testMonId = urlParams.get('testMonster');

    if (testMonId) {
      const testScale = parseFloat(urlParams.get('scale')) || null;
      const testSprite = urlParams.get('sprite');
      const testName = urlParams.get('name');

      this.testMonsterConfig = {
        id: testMonId,
        scale: testScale,
        sprite: testSprite,
        name: testName
      };

      this.heroes = [
        { data: makeHero('Fighter', 'dwarf', 'fighter') },
        { data: makeHero('Wizard', 'human', 'wizard') },
        { data: makeHero('Rogue', 'elf', 'rogue') },
        { data: makeHero('Cleric', 'human', 'cleric') }
      ];
      this.leaderIdx = 0;
      this.gold = 100;
      this.dungeonLevel = 1;
      this.controlMode = 'manual';

      const setupOverlay = document.getElementById('overlay');
      if (setupOverlay) setupOverlay.style.display = 'none';

      buildPartyFrames(this.heroes.map(h => h.data));
      updateResources(this);
      this.updateModeToggleUI();
      log(`⚔️ Test Monster Arena Mode initialized for: ${testName || testMonId}`, 'sys');

      initGameLog(this);
      initMenus(this);
      initShop(this);
      initWorldMap(this);
      initSkills(this);
      initChestWheel(this);
      initQuestEvents(this);
      initAudio();
      return;
    }

    const save = this.loadSave();
    /* Boot flow: title screen → (New Game) party setup → run, or
       (Continue) straight back into the saved run. */
    const startNewParty = slots => {
      this.heroes = slots.map(s => ({ data: makeHero(s.name, s.raceKey, s.classKey, s.baseStats, s.visual) }));
      this.leaderIdx = 0;
      this.storedHeroes = [];
      this.townShopInventory = [];
      this.townTavernHirePool = [];
      this.gold = 0; this.potions = { heal: 2, greater: 0, superior: 0 }; this.inventory = []; this.dungeonLevel = 1;
      this.activeQuest = null; this.questFloor = 0;
      this.questChains = { active: [], log: [] };
      this.legendaryPity = 0;
      this.storyProgress = {};
      this.controlMode = 'auto';
      this.beginRun();
    };
    const continueSaved = () => {
      this.heroes = save.heroes.map(h => ({ data: normalizeHero(h) }));
      this.leaderIdx = Math.min(Math.max(0, save.leaderIdx || 0), this.heroes.length - 1);
      this.storedHeroes = (save.storedHeroes || []).map(h => normalizeHero(h));
      this.townShopInventory = save.townShopInventory || [];
      this.townTavernHirePool = save.townTavernHirePool || [];
      this.gold = save.gold; this.potions = { heal: 0, greater: 0, superior: 0, ...save.potions };
      this.bestiary = save.bestiary || {};
      this.inventory = save.inventory || [];
      this.dungeonLevel = save.dungeonLevel;
      this.activeQuest = normalizeQuest(save.activeQuest || null);
      this.questFloor = save.questFloor || 0;
      this.questChains = save.questChains || { active: [], log: [] };
      this.legendaryPity = save.legendaryPity || 0;
      this.storyProgress = save.storyProgress || {};
      this.controlMode = save.controlMode || 'auto';
      if (save.guildData && this.guild) this.guild.deserialize(save.guildData);
      restoreRunStats(this, save.runStats || null);
      /* Old save resumed mid-quest: stats cover the remainder of the run */
      if (this.activeQuest && !this.runStats) initRunStats(this, this.activeQuest);
      /* Re-inject run-persistent summoned companions (added without meshes;
         the floor-load loop wraps them like any other hero). */
      this.summons.restore(save.companions);
      this.beginRun(true);
    };
    const openTitle = () => showTitle(!!save, {
      onNew: () => showSetup(startNewParty, openTitle),
      onContinue: continueSaved
    });
    openTitle();

    const modeBtn = document.getElementById('mode-toggle-btn');
    if (modeBtn) modeBtn.addEventListener('click', () => this.toggleControlMode());
    document.getElementById('potheal').addEventListener('click', () => this.drinkPotion('heal'));
    document.getElementById('potgreater').addEventListener('click', () => this.drinkPotion('greater'));
    document.getElementById('potsuperior').addEventListener('click', () => this.drinkPotion('superior'));
    /* potion hotkeys: 1 = heal, 2 = greater, 3 = superior (ignore while typing).
       L cycles the party leader, M toggles Auto/Manual mode.
       Auto-drinking is now per-hero via the AI Priorities tab (potionThreshold knob). */
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === '1') this.drinkPotion('heal');
      else if (e.key === '2') this.drinkPotion('greater');
      else if (e.key === '3') this.drinkPotion('superior');
      else if (e.key === 'l' || e.key === 'L') this.cycleLeader();
      else if (e.key === 'm' || e.key === 'M') this.toggleControlMode();
      else if (e.key === 'Escape') {
        if (this.cancelSpellTargeting) this.cancelSpellTargeting();
        if (this.clearPendingMove) this.clearPendingMove();
      }
      else if (e.code === 'Space' || e.key === ' ') {
        if (this.state === 'crawl') {
          e.preventDefault();
          this.setPaused(!this.paused);
        }
      }
    });
    bindPartyLeaderUI({
      getLeader: () => this.leaderIdx,
      setLeader: i => this.setLeader(i)
    });
    initGameLog(this);
    initMenus(this);
    initShop(this);
    initWorldMap(this);
    initSkills(this);
    initChestWheel(this);
    initQuestEvents(this);
    this._createDeathChoiceScreen();
    initAudio();
  }

  beginRun(fromSave = false) {
    buildPartyFrames(this.heroes.map(h => h.data));
    updateResources(this);
    this.updateModeToggleUI();
    log(`A party of ${this.heroes.length} sets out. Good luck — they won't need your help. Mostly.`, 'sys');
    /* Resume mid-quest from save; otherwise pick a quest on the world map. */
    if (fromSave && this.activeQuest) {
      log(`Resuming quest: ${this.activeQuest.name} (floor ${this.questFloor}/${this.activeQuest.floors}).`, 'sys');
      this.nextDungeon(true);
    } else if (fromSave) {
      this.state = 'worldmap';
      showWorldMap({ refresh: true });
    } else {
      /* Brand-new company: narrated opening crawl, then the world map. */
      this.state = 'worldmap';
      showIntroCrawl(() => showWorldMap({ refresh: true }));
    }
  }

  /** Embark on a world-map quest (called from worldmap.js). */
  startQuest(quest) {
    this.activeQuest = quest;
    this.questFloor = 1;
    this._floorBeatFired = new Set();   // re-arm end-of-floor beats for this run
    this.dungeonLevel = Math.max(1, quest.level || 1);
    initRunStats(this, quest);
    resetChallengeState(this, { newQuest: true });
    /* Fresh quest = long rest so abilities start available */
    partyLongRest(this, { silent: true, reason: 'embark' });
    this.nextDungeon(true);
  }

  /** Route to the next floor — pauses at a pre-floor choice overlay when the
   *  incoming floor is an unresolved, undecided phase floor. */
  nextDungeon(first = false) {
    this.state = 'transition';
    const q = this.activeQuest;
    const phase = (q && Array.isArray(q.phases))
      ? q.phases.find(p => p.floor === this.questFloor) || null
      : null;
    if (phase && phaseNeedsChoice(phase)) {
      offerFloorChoice(this, phase, () => this._loadFloor(first));
      return;
    }
    this._loadFloor(first);
  }

  _loadFloor(first = false) {
    this.state = 'transition';
    const lvl = this.dungeonLevel;
    const q = this.activeQuest;
    const seed = q
      ? (q.seed + (this.questFloor - 1) * 9973)
      : (1 + Math.floor(Math.random() * 999999));
    /* Room count is a 2-axis gradient across quest LEVEL and FLOOR depth.
       Both axes are normalised to their max (Lv 20, Floor 10) so the bottom
       corner (Lv 1 / Floor 1) yields MIN_ROOMS and the top corner (Lv 20 /
       Floor 10) yields exactly MAX_ROOMS — the 70 cap is only reached there.
       Level is weighted more heavily than floor depth (70/30). Freeplay (no
       quest) falls back to treating dungeonLevel as the level axis. */
    const MIN_ROOMS = 12, MAX_ROOMS = 70;
    const qLevel = q ? q.level : lvl;
    const floor  = q ? this.questFloor : 1;
    const lvlT   = Math.min(1, Math.max(0, (qLevel - 1) / 19)); // 0 @Lv1 → 1 @Lv20
    const floorT = Math.min(1, Math.max(0, (floor  - 1) / 9));  // 0 @F1  → 1 @F10
    const grad   = 0.70 * lvlT + 0.30 * floorT;
    const roomCount = Math.min(MAX_ROOMS, Math.round(MIN_ROOMS + (MAX_ROOMS - MIN_ROOMS) * grad));
    const themeKey = q?.theme || THEME_ORDER[(lvl - 1) % THEME_ORDER.length];
    /* Long rest is applied when a floor is cleared (finishDungeon).
       Here we only top up HP to at least half and clear combat-only state. */
    for (const h of this.heroes) {
      h.data.hp = Math.min(h.data.maxHp, Math.max(h.data.hp, Math.round(h.data.maxHp * 0.5)));
      h.raging = false;
      h.data.tempHp = 0;
      h.uncannyUsed = false;
      h._foughtThisCombat = false;
      h.phaseStepUntil = 0;
    }
    if (q) {
      log(`— ${q.name}: floor ${this.questFloor}/${q.floors} (depth ${lvl}) —`, 'sys');
    }
    /* Story missions on overland maps forge through the open-terrain
       generator; everything downstream (onDungeon, fog, spawns) is shared. */
    /* floorPlan lets one mission change surface per floor — e.g. an overland
       approach that descends into a dungeon on floor 2. Indexed by
       questFloor-1; missing entries fall back to the quest-level fields. */
    /* Story missions declare floorPlan by hand; random quests get an equivalent
       plan derived on the fly (overland approach + threshold, then the dungeon).
       Deriving instead of baking keeps saved in-flight quests working. */
    const plan = (q && Array.isArray(q.floorPlan))
      ? q.floorPlan[this.questFloor - 1]
      : (q ? autoProloguePlan(q, this.questFloor) : null);
    const fKind = (plan && plan.mapKind) || (q && q.mapKind);
    /* Overland floors use a shrouded-map fog (whole map dim-grey, brightening
       around the party) instead of the dungeon's room-by-room black reveal. */
    this._pendingOverland = fKind === 'overland';
    const fTheme = (plan && plan.theme) || (q && q.theme) || themeKey;
    /* Story missions run hotter than random quests: threatMult scales every
       zone's spawn budget in the generators. Explicit q.threatMult wins. */
    const tMult = q ? (q.threatMult || (q.story ? 1.3 : 1)) : 1;
    if (q && fKind === 'overland') {
      this.engine.reforgeOverland(seed, {
        themeKey: fTheme, level: qLevel, name: (plan && plan.name) || q.siteName || null,
        mapW: (plan && plan.mapW) || q.mapW || 0,
        mapH: (plan && plan.mapH) || q.mapH || 0,
        zones: (plan && plan.zones) || q.zones || 0,
        threatMult: tMult
      });
    } else {
      /* reforge() has no name parameter (only the overland forge does), so a
         curated dungeon-floor name is stashed here and stamped on in
         onDungeon — otherwise story floors fall back to generated names. */
      this._pendingFloorName = (plan && plan.name) || null;
      this.engine.reforge(seed, roomCount, fTheme, false, tMult, qLevel);
    }
    if (!first) this.saveGame();
  }

  /* ============ dungeon load (called by engine forge) ============ */
  onDungeon(d) {
    if (this.state === 'boot') return;
    if (this._pendingFloorName) { d.name = this._pendingFloorName; this._pendingFloorName = null; }
    d.overland = !!this._pendingOverland;
    this.D = d;
    this._unlockedDoors = new Set();
    const { W, H } = d;
    d.cellToArch = new Int16Array(W * H).fill(-1);
    if (d.arches) {
      for (let i = 0; i < d.arches.length; i++) {
        const cells = d.arches[i].cells;
        if (cells) {
          for (let j = 0; j < cells.length; j++) {
            d.cellToArch[cells[j]] = i;
          }
        }
      }
    }
    resetChallengeState(this); // fresh skill-challenge state per dungeon floor
    /* Briefing intel (story missions): scouted routes start the party with
       skill momentum — Fenwick's map pays off on the first few checks. */
    if (this.activeQuest?.storyFlags?.scouted) this._skillMomentum = 1;
    this._slotRefreshedRooms = new Set(); // fresh room-clear slot-refresh tracking
    resolveFloorPhase(this);   // phase descriptor + puzzle/gem state for this floor
    const eng = this.engine;

    if (this._searchIndicator) { disposeSearchIndicator(this._searchIndicator); this._searchIndicator = null; }
    if (this.gameGroup) { eng.scene.remove(this.gameGroup); }
    clearEffects(eng.scene);
    preloadAllSpellAndCombatVFX();
    this.gameGroup = new THREE.Group();
    eng.scene.add(this.gameGroup);

    const { grid, rooms } = d;
    this.wx = x => x - W / 2 + 0.5;
    this.wz = y => y - H / 2 + 0.5;
    this.cellOf = (x, z) => {
      const cx = Math.round(x + W / 2 - 0.5), cy = Math.round(z + H / 2 - 0.5);
      return (cx < 0 || cy < 0 || cx >= W || cy >= H) ? -1 : cy * W + cx;
    };

    d.wallAdj = buildWallAdj(grid, W, H);
    d.chokepoint = buildChokepoints(grid, W, H);
    d.solidProps = buildSolidProps(d);

    const fog = buildFogMaps(d);
    this.floorInst = fog.floorInst;
    this.wallInst = fog.wallInst;
    this.revealed = fog.revealed;
    this.visitedRooms = fog.visitedRooms;
    this._searchedRooms = new Uint8Array(rooms.length);
    this.fogAll();

    this.roomAnchor = rooms.map(r => {
      let c = r.cy * W + r.cx;
      if (grid[c] === FLOOR) return c;
      for (let rad = 1; rad < 6; rad++)
        for (let oy = -rad; oy <= rad; oy++) for (let ox = -rad; ox <= rad; ox++) {
          const nx = r.cx + ox, ny = r.cy + oy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && grid[ny * W + nx] === FLOOR && d.roomId[ny * W + nx] === r.id)
            return ny * W + nx;
        }
      return c;
    });

    this.roomAdj = rooms.map(() => []);
    for (const e of d.edges) {
      this.roomAdj[e.a].push(e.b);
      this.roomAdj[e.b].push(e.a);
    }

    /* blend dungeon depth with party strength so scaling never falls behind */
    this.effectiveLevel = Math.max(this.dungeonLevel, this.partyLevel());

    this.monsters = [];
    /* dungeon-theme-aware monster selection: rooms draw from every creature
       explicitly whitelisted for the dungeon theme (see dungeonMonsterIds),
       so per-creature dungeon picks in the bestiary are honoured. */
    const roomLockedSpawns = {}; // roomId -> { [crBand]: spec }
    /* Hard-coded story cast for this floor, if the mission declares one. */
    const _sq = this.activeQuest;
    const _sPlan = (_sq && Array.isArray(_sq.floorPlan)) ? _sq.floorPlan[this.questFloor - 1] : null;
    /* Story rosters may be flat arrays OR legacy tier-keyed objects ({1:[...],2:[...]}).
       Flatten either into a single candidate list — spawnMonster then filters it
       by CR window, so the authored cast auto-scales with floor depth. */
    const _rawRoster = (_sPlan && _sPlan.monsters) || (_sq && _sq.monsterRoster) || null;
    const storyPool = _rawRoster && storyPoolIds(_rawRoster).length ? _rawRoster : null;
    const questInfo = {
      dungeonLevel: this.activeQuest ? this.activeQuest.level : this.dungeonLevel,
      questFloor: this.questFloor,
      floors: this.activeQuest ? this.activeQuest.floors : 10
    };
    const finalFloor = !this.activeQuest || (this.questFloor | 0) >= (this.activeQuest.floors | 0);

    /* A story floor with an authored cast is spawned strictly from that cast and
       paid for out of a per-floor CR budget — no CR window, no level ceiling, no
       widening to the rest of the bestiary. The budget is authored per floor
       (crBudget), else per mission (crBudget), else derived so the floor holds
       about as many creatures as the generator laid spawn points for. */
    const activeSpawns = d.spawns.filter(sp => !(finalFloor && sp.roomId === d.boss));
    let storyCast = null;
    if (storyPool) {
      const authoredBudget = (_sPlan && _sPlan.crBudget != null) ? _sPlan.crBudget
        : (_sq && _sq.crBudget != null) ? _sq.crBudget : null;
      const plan = planStoryFloorCast(
        storyPool,
        activeSpawns.map(sp => ({ roomId: sp.roomId, weight: storyLaneWeight(sp) })),
        { budget: authoredBudget, rng: Math.random }
      );
      storyCast = new Map(activeSpawns.map((sp, i) => [sp, plan.ids[i]]));
    }

    for (const sp of d.spawns) {
      if (finalFloor && sp.roomId === d.boss) continue;

      if (storyCast) {
        const castId = storyCast.get(sp);
        /* null = the floor's budget ran out before this spawn point; leave it
           empty instead of importing an off-cast creature. */
        if (!castId) continue;
        const m = applyPhaseToSpawns(this, spawnMonster(
          MONSTERS_BY_ID[castId]?.cr ?? 1, this.effectiveLevel, Math.random,
          [castId], questInfo, sp.role || null, true, true));
        if (sp.roomBuff === 'arcane_surge') {
          m.arcaneSurge = true;
          m.atk = (m.atk || 0) + 2;
          m.speedMult = (m.speedMult || 1) * 1.15;
        }
        this.addMonster(m, sp.x, sp.y, sp.roomId);
        continue;
      }

      if (roomLockedSpawns[sp.roomId] === undefined) {
        roomLockedSpawns[sp.roomId] = {};
      }

      /* Resolve the spawn's target CR. fixedCR pins it (swarm minions); crOffset
         shifts it a band (miniboss +1, guards -1); otherwise use the floor's
         rolled base CR. This replaces the old tier/tierOffset/fixedTier logic. */
      const baseCR = crForDungeonLevel(questInfo.dungeonLevel, Math.random);
      let targetCR = sp.targetCR != null ? sp.targetCR : baseCR;
      if (sp.fixedCR) {
        targetCR = sp.targetCR;
      } else if (sp.crOffset !== undefined) {
        const step = sp.crOffset >= 0
          ? targetCR * Math.pow(1.5, sp.crOffset)
          : targetCR * Math.pow(0.6, -sp.crOffset);
        targetCR = Math.max(0.125, step);
      } else if (sp.targetCR == null) {
        targetCR = baseCR;
      }
      const bandKey = crBandIndex(targetCR);

      /* Themes are now flat candidate lists; spawnMonster filters by CR window.
         The room draws from every creature explicitly whitelisted for this
         dungeon theme (union across families) so per-creature dungeon picks in
         the bestiary are honoured. (Story floors never reach here — they took
         the strict budgeted path above.) */
      let allowedNames = d.themeKey ? dungeonMonsterIds(d.themeKey) : null;

      if (sp.roomStyle === 'necromantic') {
        const undeadTheme = MONSTER_THEMES.find(t => t.name === 'Undead');
        if (undeadTheme && undeadTheme.monsters && undeadTheme.monsters.length) {
          allowedNames = undeadTheme.monsters.filter(id => monsterSpawnsIn(MONSTERS_BY_ID[id], d.themeKey));
        }
      } else if (sp.roomStyle === 'nest') {
        const verminTheme = MONSTER_THEMES.find(t => t.name === 'Vermin') || MONSTER_THEMES.find(t => t.name === 'Beasts');
        if (verminTheme && verminTheme.monsters && verminTheme.monsters.length) {
          allowedNames = verminTheme.monsters.filter(id => monsterSpawnsIn(MONSTERS_BY_ID[id], d.themeKey));
        }
      }

      if (sp.role) {
        const lockKey = `role_${sp.role}_${bandKey}`;
        if (!roomLockedSpawns[sp.roomId][lockKey]) {
          roomLockedSpawns[sp.roomId][lockKey] = spawnMonster(targetCR, this.effectiveLevel, Math.random, allowedNames, questInfo, sp.role);
        }
        const roleSpec = roomLockedSpawns[sp.roomId][lockKey];
        const m = applyPhaseToSpawns(this, spawnMonster(targetCR, this.effectiveLevel, Math.random, [roleSpec.id], questInfo, sp.role));
        if (sp.roomBuff === 'arcane_surge') {
          m.arcaneSurge = true;
          m.atk = (m.atk || 0) + 2;
          m.speedMult = (m.speedMult || 1) * 1.15;
        }
        this.addMonster(m, sp.x, sp.y, sp.roomId);
      } else {
        if (roomLockedSpawns[sp.roomId][bandKey] === undefined) {
          const spec = spawnMonster(targetCR, this.effectiveLevel, Math.random, allowedNames, questInfo);
          roomLockedSpawns[sp.roomId][bandKey] = spec;
        }
        const mSpec = roomLockedSpawns[sp.roomId][bandKey];
        const m = applyPhaseToSpawns(this, spawnMonster(targetCR, this.effectiveLevel, Math.random, [mSpec.id], questInfo));
        if (sp.roomBuff === 'arcane_surge') {
          m.arcaneSurge = true;
          m.atk = (m.atk || 0) + 2;
          m.speedMult = (m.speedMult || 1) * 1.15;
        }
        this.addMonster(m, sp.x, sp.y, sp.roomId);
      }
    }
    /* Final floor fights the quest's pre-rolled curated boss encounter */
    const q2 = this.activeQuest;
    const ba = this.roomAnchor[d.boss];

    this.floorExit = null;
    if (this._exitIndicator) { disposeExitIndicator(this._exitIndicator); this._exitIndicator = null; }

    if (!finalFloor) {
      /* Non-final floors: NO boss. Instead, room d.boss hosts a pack of Elites.
         An exit portal appears in room d.boss so the party can descend to the next floor. */
      this.boss = null;
      const ex = (ba % W), ey = Math.floor(ba / W);
      this.floorExit = { roomId: d.boss, x: ex, y: ey, active: false, entered: false };
      this._exitIndicator = createExitIndicator(this.gameGroup, this.wx(ex), this.wz(ey));
      updateExitIndicator(this._exitIndicator, 0, false, 0);

      // Spawn 2-3 Miniboss / Elite pack monsters in room d.boss
      const targetCR = crForDungeonLevel(questInfo.dungeonLevel + Math.max(0, questInfo.questFloor - 1) * 0.5);
      const eliteCount = 2 + Math.floor(Math.random() * 2);
      /* Same theme roster the ordinary rooms draw from (above). Passing null
         here meant the elite pack ignored the dungeon roster entirely and
         rolled the whole bestiary — which is how dryads, merfolk and dragon
         wyrmlings turned up guarding a grim crypt. */
      const eliteAllowed = d.themeKey ? dungeonMonsterIds(d.themeKey) : null;
      for (let i = 0; i < eliteCount; i++) {
        const eliteSpec = applyPhaseToSpawns(this, spawnMonster(targetCR, this.effectiveLevel, Math.random, eliteAllowed, questInfo, 'miniboss'));
        eliteSpec.isElitePack = true;
        this.addMonster(eliteSpec, (ba % W) + (i % 2), Math.floor(ba / W) + Math.floor(i / 2), d.boss);
      }
    } else {
      /* Final-floor boss encounter: Curated Boss + Curated Escort Minions */
      const qBossEncounter = q2 && q2.bossEncounter;
      const curated = qBossEncounter ? qBossEncounter : getCuratedBossEncounter(q2?.theme, questInfo.dungeonLevel);
      const D = questInfo.dungeonLevel + Math.max(0, questInfo.questFloor - 1) * 0.5;
      const bossTargetCR = Math.max(1, D);

      const mainBossId = (q2 && q2.finalBossId) ? q2.finalBossId : (curated ? curated.bossId : null);
      const bossSpec = applyPhaseToSpawns(this, spawnMonster(bossTargetCR, this.effectiveLevel, Math.random,
        mainBossId ? [mainBossId] : null, questInfo, 'boss', true, true));

      /* Apply authored/curated boss name */
      if (q2 && q2.finalBossName) {
        bossSpec.name = q2.finalBossName;
      } else if (curated && (!q2?.finalBossId || q2.finalBossId === curated.bossId) && curated.bossTitle) {
        bossSpec.name = curated.bossTitle;
      }

      /* Apply HP multiplier */
      const hpMult = (q2 && q2.bossHpMult) ? q2.bossHpMult : (curated?.bossHpMult || 1.5);
      bossSpec.maxHp = Math.round(bossSpec.maxHp * hpMult);
      bossSpec.hp = bossSpec.maxHp;

      this.addMonster(bossSpec, (ba % W) + 1, Math.floor(ba / W), d.boss, true);
      this.boss = this.monsters[this.monsters.length - 1];

      /* Spawn Curated Escort Minions:
         Use curated.escorts ONLY if curated matches the mainBossId or no specific finalBossId override exists */
      const escortsToSpawn = (curated && (!q2?.finalBossId || q2.finalBossId === curated.bossId))
        ? curated.escorts
        : null;

      if (Array.isArray(escortsToSpawn) && escortsToSpawn.length > 0) {
        let escOffset = 0;
        for (const esc of escortsToSpawn) {
          const count = Math.min(4, esc.count || 1);
          for (let c = 0; c < count; c++) {
            const escortSpec = applyPhaseToSpawns(this, spawnMonster(Math.max(0.5, bossTargetCR * 0.6), this.effectiveLevel, Math.random, [esc.id], questInfo, 'minion', true, true));
            escOffset++;
            const ox = (ba % W) + (escOffset % 3) - 1;
            const oy = Math.floor(ba / W) + Math.floor(escOffset / 3) - 1;
            this.addMonster(escortSpec, Math.max(1, Math.min(W - 2, ox)), Math.max(1, Math.min(H - 2, oy)), d.boss);
          }
        }
      } else if (q2 && q2.finalBossId) {
        /* Default thematic escorts for specific story final bosses */
        const storyEscortId = q2.finalBossId === 'goblin-king' ? 'hobgoblin' :
                              (q2.finalBossId === 'wight' || q2.finalBossId === 'death-knight') ? 'skeleton' :
                              (q2.finalBossId === 'grick') ? 'giant-spider' : null;
        if (storyEscortId) {
          for (let c = 0; c < 2; c++) {
            const escortSpec = applyPhaseToSpawns(this, spawnMonster(Math.max(0.5, bossTargetCR * 0.6), this.effectiveLevel, Math.random, [storyEscortId], questInfo, 'minion', true, true));
            const ox = (ba % W) + (c === 0 ? -1 : 1);
            const oy = Math.floor(ba / W) + (c === 0 ? 1 : -1);
            this.addMonster(escortSpec, Math.max(1, Math.min(W - 2, ox)), Math.max(1, Math.min(H - 2, oy)), d.boss);
          }
        }
      }
    }

    this.chests = d.props.filter(p => p.kind === 'chest').map(p => ({ x: p.x, y: p.y, roomId: p.roomId, looted: false }));
    this.shrines = d.props.filter(p => p.kind === 'shrineCrystal').map(p => ({ x: p.x, y: p.y, roomId: p.roomId, used: false }));
    placeGems(this);

    /* Ally-phase guest joins before placement so it gets a mesh like everyone */
    spawnAlly(this);
    /* Prune floor/combat-lifetime summons (and orphaned companions); run-
       persistent ones stay in this.heroes and are re-wrapped below. */
    this.summons.onFloorEnter();

    const ea = this.roomAnchor[d.entrance];
    const ex = ea % W, ey = Math.floor(ea / W);
    this.heroes.forEach((h, i) => {
      h.ent = makeHeroMesh(h.data);
      h.x = this.wx(ex + (i % 2 === 0 ? -0.5 : 0.5));
      h.z = this.wz(ey + (i < 2 ? -0.5 : 0.5));
      h.ent.grp.position.set(h.x, 0, h.z);
      h.path = null; h.pathI = 0;
      h.target = null; h.repathT = 0; h.walkPhase = Math.random() * 6;
      this.gameGroup.add(h.ent.grp);
      drawBar(h.ent.bar, Math.max(0, h.data.hp / h.data.maxHp));
    });
    this.leaderTrail = [];
    this.targetRoom = -1;
    this.userGoal = -1;
    this._searchRoom = -1; this._searchT = 0; this._searchGoal = -1; this._searchGoalT = 0;
    this._searchIndicator = null;
    this.combat = false;
    this.wipeT = 0;
    this.completeT = 0;

    this.visitRoom(d.entrance, true);
    this.recalculateFog(this);   // show frontier rooms adjacent to entrance

    if (this.testMonsterConfig) {
      const tCfg = this.testMonsterConfig;
      this.monsters.forEach(m => {
        if (m.ent && m.ent.grp) this.gameGroup.remove(m.ent.grp);
      });
      this.monsters = [];

      const ea = this.roomAnchor[d.entrance];
      const ex = ea % W, ey = Math.floor(ea / W);

      const baseM = MONSTERS_ALL.find(m => m.id === tCfg.id) || {
        id: tCfg.id,
        name: tCfg.name || 'Test Monster',
        sprite: tCfg.sprite || `${tCfg.id}.png`,
        scale: tCfg.scale || 1.0,
        hp: [10, 6, 25], ac: 14, atk: 5, dmg: [2, 6, 3], cr: 1
      };

      const mSpec = JSON.parse(JSON.stringify(baseM));
      if (tCfg.scale) mSpec.scale = tCfg.scale;
      if (tCfg.sprite) mSpec.sprite = tCfg.sprite;
      if (tCfg.name) mSpec.name = tCfg.name;
      mSpec.maxHp = mSpec.hp ? Math.floor(mSpec.hp[0] * ((mSpec.hp[1] || 6) + 1) / 2 + (mSpec.hp[2] || 0)) : 120;
      mSpec.hp = mSpec.maxHp;

      this.addMonster(mSpec, ex + 2, ey, d.entrance, true);

      const spawnedTestMon = this.monsters[this.monsters.length - 1];
      if (spawnedTestMon && spawnedTestMon.ent && spawnedTestMon.ent.grp) {
        if (tCfg.scale) spawnedTestMon.ent.grp.scale.set(tCfg.scale, tCfg.scale, tCfg.scale);
      }
    }

    this.syncDoorVisuals();
    this.state = 'crawl';
    playSfx('doorOpen', { volume: 0.75 });
    const themeLabel = d.params.themeKey.toUpperCase();
    const flLabel = this.activeQuest ? `F${this.questFloor}/${this.activeQuest.floors}` : `${this.dungeonLevel}`;
    log(`— ${flLabel}: ${d.name} (${themeLabel}) —`, 'sys');
    showBanner(d.name, `${flLabel} · ${d.stats.rooms} rooms`);
    announceFloor(this);
    updateResources(this);
    updatePartyFrames(this.heroes.map(h => h.data));
    refreshMenus(this);
  }

  addMonster(spec, x, y, roomId, isBoss = false) {
    /* At-spawn variant roll: monsters with `variants: ['melee','ranged']`
       are randomly tagged as one or the other per-instance. The instance
       gets its own shallow-cloned spec so we don't mutate the shared
       template. AI reads m.data.ranged as before; m.variant is also
       available as an explicit tag. */
    let instanceSpec = spec;
    if (Array.isArray(spec.variants) && spec.variants.length > 1) {
      instanceSpec = { ...spec };
      delete instanceSpec.variants;
      const pick = spec.variants[Math.floor(Math.random() * spec.variants.length)];
      instanceSpec.ranged = (pick === 'ranged');
    }
    const m = {
      data: instanceSpec, x: this.wx(x), z: this.wz(y), roomId, isBoss,
      variant: instanceSpec.ranged ? 'ranged' : 'melee',
      active: false, path: null, pathI: 0, cd: Math.random() * 2, repathT: 0,
      walkPhase: Math.random() * 6
    };
    m.ent = makeMonsterMesh(spec);
    m.ent.grp.position.set(m.x, 0, m.z);
    m.ent.grp.visible = false;
    this.gameGroup.add(m.ent.grp);
    this.monsters.push(m);
  }

  /** Spawn a temporary ally hero mid-floor (skill-check reward / animal friend).
   *  `data` is a full hero record (from makeHero). Placed at the party leader.
   *  temp:true excludes it from saveGame, kill XP, and quest-reward splits. */
  spawnTempAlly(data, label = 'ally') {
    if (this.heroes.some(h => h.temp)) return null;   // one temp ally at a time
    const leader = this.heroes.find(h => !h.temp && h.data.hp > 0) || this.heroes[0];
    const ent = makeHeroMesh(data);
    const h = {
      data, temp: true, allyLabel: label,
      x: leader ? leader.x : this.wx(0), z: leader ? leader.z : this.wz(0),
      ent, path: null, pathI: 0, cd: Math.random(), repathT: 0,
      target: null, walkPhase: Math.random() * 6
    };
    h.ent.grp.position.set(h.x, 0, h.z);
    this.gameGroup.add(h.ent.grp);
    drawBar(h.ent.bar, Math.max(0, h.data.hp / h.data.maxHp));
    this.heroes.push(h);
    buildPartyFrames(this.heroes.map(x => x.data));
    return h;
  }

  /** Remove a temp ally (floor clear / dismiss). */
  dismissTempAlly() {
    const idx = this.heroes.findIndex(h => h.temp);
    if (idx < 0) return;
    const [ally] = this.heroes.splice(idx, 1);
    if (ally.ent?.grp?.parent) ally.ent.grp.parent.remove(ally.ent.grp);
    buildPartyFrames(this.heroes.map(x => x.data));
  }

  /** The designated party leader if valid and alive, else the first living
   *  hero. Pass the precomputed `alive` list when available. */
  partyLeader(alive) {
    const h = this.heroes[this.leaderIdx];
    if (h && !h.temp && !h.companion && h.data.hp > 0) return h;
    return alive ? alive[0] : this.heroes.find(x => x.data.hp > 0);
  }

  /** Real controllable heroes — excludes temp quest allies AND summoned
   *  companions. Use this for XP / loot / leadership / party-size caps /
   *  run-stats / progression so companions never count as a party member. */
  realHeroes() {
    return this.heroes.filter(h => !h.temp && !h.companion);
  }

  /** Designate hero `i` as party leader (must exist, be alive, and not a
   *  temp quest ally or summoned companion). Returns true on success. */
  setLeader(i) {
    const h = this.heroes[i];
    if (!h || h.temp || h.companion || h.data.hp <= 0) return false;
    if (this.leaderIdx === i) return true;
    this.leaderIdx = i;
    /* clear exploration pathing so the party re-forms behind the new leader */
    for (const x of this.heroes) { x.path = null; x.pathGoal = -1; }
    this.leaderTrail = [];
    log(`⭐ ${h.data.name} now leads the party.`, 'sys');
    updatePartyFrames(this.heroes.map(x => x.data));
    this.saveGame();
    return true;
  }

  /** Cycle leadership to the next living non-temp hero (hotkey). */
  cycleLeader() {
    const n = this.heroes.length;
    if (!n) return;
    for (let step = 1; step <= n; step++) {
      const i = (this.leaderIdx + step) % n;
      if (this.setLeader(i)) return;
    }
  }

  isDoorClosed(archIndex) {
    if (!this._unlockedDoors) return false;
    return !this._unlockedDoors.has(archIndex);
  }

  isCellDoorClosed(c) {
    if (!this.D || !this.D.cellToArch || c < 0 || c >= this.D.cellToArch.length) return false;
    const archIdx = this.D.cellToArch[c];
    if (archIdx < 0) return false;
    return this.isDoorClosed(archIdx);
  }

  syncDoorVisuals() {
    if (!this.engine || typeof this.engine.getMeshes !== 'function') return;
    const meshes = this.engine.getMeshes();
    const gateMesh = meshes ? meshes.gate : null;
    if (!gateMesh || !gateMesh.userData || !gateMesh.userData.set) return;
    const s = gateMesh.userData.set;
    for (let i = 0; i < s.n; i++) {
      const isOpen = !!(this._unlockedDoors && this._unlockedDoors.has(i));
      const targetY = isOpen ? -1.5 : 0;
      s.py[i] = targetY;
      if (gateMesh.userData._origPy) {
        gateMesh.userData._origPy[i] = targetY;
      }
    }
    writeInstances(gateMesh, Infinity);
  }

  /* Doors open for whichever living hero walks up to them — not just the
     leader, and not only outside combat.
       • Leader-only meant a follower whose route crossed a different gate
         than the leader's stood on it until the stuck-recovery teleport.
       • Combat-only-suspended meant that the instant `this.combat` latched
         (a monster on the far side, a foe still alive behind the party) the
         gate froze shut with heroes pathing into it — a soft-lock, because
         the fight can't end while the combatants can't reach each other. */
  updateDoors(dt) {
    if (!this.D || !this.D.arches || !this._unlockedDoors) return;
    const alive = this.heroes.filter(h => h.data.hp > 0);
    if (!alive.length) return;

    if (!this._doorUnlockTimers) this._doorUnlockTimers = {};

    const W = this.D.W;
    let changed = false;

    for (let i = 0; i < this.D.arches.length; i++) {
      if (this._unlockedDoors.has(i)) continue;
      const a = this.D.arches[i];
      const ax = this.wx(a.x);
      const az = this.wz(a.y);

      let opener = null, bd = 1e9;
      for (const h of alive) {
        let minDist = Math.hypot(h.x - ax, h.z - az);
        if (a.cells && a.cells.length > 0 && W > 0) {
          for (let j = 0; j < a.cells.length; j++) {
            const cellIdx = a.cells[j];
            const cx = this.wx(cellIdx % W);
            const cz = this.wz(Math.floor(cellIdx / W));
            const dCell = Math.hypot(h.x - cx, h.z - cz);
            if (dCell < minDist) minDist = dCell;
          }
        }
        // Also check if hero's path passes through this arch's cells in the next few nodes
        if (h.path && h.pathI < h.path.length) {
          const lookahead = Math.min(h.path.length, h.pathI + 4);
          for (let idx = h.pathI; idx < lookahead; idx++) {
            const pathCell = h.path[idx];
            if (this.D.cellToArch && this.D.cellToArch[pathCell] === i) {
              minDist = Math.min(minDist, 1.0);
              break;
            }
          }
        }

        if (minDist < bd) { bd = minDist; opener = h; }
      }

      if (bd < 2.2) {
        if (this._doorUnlockTimers[i] === undefined) {
          this._doorUnlockTimers[i] = 0;
          playSfx('lockUnlock', { volume: 0.7 });
          log('🚪 Opening door...', 'sys');
        }

        this._doorUnlockTimers[i] += dt;

        if (this._doorUnlockTimers[i] >= 0.6) {
          this._unlockedDoors.add(i);
          delete this._doorUnlockTimers[i];
          changed = true;
          playSfx('doorOpen', { volume: 0.8 });
          log('🚪 Door opened.', 'sys');
          /* Everyone repaths: the cell that was costing +5 (or blocking the
             step outright) is now plain floor, so held-up followers behind
             the opener pick up the new route on the same frame. */
          for (const h of alive) {
            h.path = null;
            h.pathGoal = -1;
            h.repathT = 0;
            h.stuckT = 0;
            h.stuckStage = 0;
            h._blockedByDoor = false;
            h._doorWaitTime = 0;
          }
          this.stuckT = 0;
        }
      } else {
        if (this._doorUnlockTimers[i] !== undefined) {
          delete this._doorUnlockTimers[i];
        }
      }
    }
    if (changed) this.syncDoorVisuals();
  }

  /* Unlock every still-closed door arch that a path passes through. Returns
     true if at least one door was opened. Used to break combat deadlocks where
     a closed gate is the only thing between a monster and its target — see
     monsterChase (proactive) and _breakCombatStall (watchdog). */
  forceDoorsAlongPath(path) {
    if (!path || !this.D || !this.D.cellToArch || !this._unlockedDoors) return false;
    let opened = false;
    for (const c of path) {
      if (c < 0 || c >= this.D.cellToArch.length) continue;
      const arch = this.D.cellToArch[c];
      if (arch >= 0 && !this._unlockedDoors.has(arch)) {
        this._unlockedDoors.add(arch);
        if (this._doorUnlockTimers) delete this._doorUnlockTimers[arch];
        opened = true;
      }
    }
    if (opened) {
      this.syncDoorVisuals();
      playSfx('doorOpen', { volume: 0.7 });
    }
    return opened;
  }

  /* Last-resort: open every closed door on the floor. */
  forceOpenAllDoors() {
    if (!this.D || !this.D.arches || !this._unlockedDoors) return false;
    let opened = false;
    for (let i = 0; i < this.D.arches.length; i++)
      if (!this._unlockedDoors.has(i)) { this._unlockedDoors.add(i); opened = true; }
    if (opened) {
      this.syncDoorVisuals();
      playSfx('doorOpen', { volume: 0.7 });
    }
    return opened;
  }

  /* Combat-stall watchdog. A fight can wedge when a closed door (or any other
     obstacle) separates the party from the monsters while door-opening is
     suspended during combat: monsters can't path in, heroes hold position, and
     because the fight never resolves the door never reopens — a soft-lock.
     Each combat frame we watch total HP and aggregate position of all live
     combatants; if NOTHING changes for STALL_LIMIT seconds, we force open the
     gate(s) between each monster and its nearest hero and clear all paths so
     everyone repaths and the fight can proceed. */
  _combatStallWatch(dt) {
    /* `this.state` is the screen ('crawl' | 'worldmap' | 'shop' | …) and is
       never 'combat' — the fight flag is `this.combat`, which the caller has
       already checked. Guarding on state === 'combat' made this whole
       watchdog unreachable, so nothing ever broke a jammed fight. */
    if (this.state !== 'crawl' || this.controlMode === 'manual') {
      this._stallT = 0;
      return;
    }
    const STALL_LIMIT = 4;
    const parts = [];
    for (const h of this.heroes) if (h.data.hp > 0) parts.push(h);
    for (const m of this.monsters) if (m.active && m.data.hp > 0) parts.push(m);
    if (parts.length < 2) { this._stallT = 0; return; }

    let sumHp = 0, sumPos = 0;
    for (const e of parts) {
      sumHp += e.data.hp;
      const c = (typeof this.cellOf === 'function') ? this.cellOf(e.x, e.z) : -1;
      sumPos += (c >= 0 ? c : Math.floor(e.x) + Math.floor(e.z));
    }
    const moved = this._stallPos === undefined || Math.abs(sumPos - this._stallPos) > 0;
    const hpChanged = this._stallHp === undefined || sumHp !== this._stallHp;
    this._stallPos = sumPos; this._stallHp = sumHp;

    if (moved || hpChanged) { this._stallT = 0; return; }
    this._stallT = (this._stallT || 0) + dt;
    if (this._stallT >= STALL_LIMIT) { this._stallT = 0; this._breakCombatStall(); }
  }

  _breakCombatStall() {
    let opened = false;
    for (const m of this.monsters) {
      if (!m.active || m.data.hp <= 0) continue;
      let best = null, bd = 1e9;
      for (const h of this.heroes) {
        if (h.data.hp <= 0) continue;
        const d = Math.hypot(h.x - m.x, h.z - m.z);
        if (d < bd) { bd = d; best = h; }
      }
      if (!best) continue;
      const goal = this.nearFloorCell(this.cellOf(best.x, best.z), 2);
      if (goal < 0) continue;
      const p = this.findPath(this.cellOf(m.x, m.z), goal);   // door-ignoring
      if (p && this.forceDoorsAlongPath(p)) opened = true;
    }
    for (const m of this.monsters) { m.path = null; m.pathI = 0; m.repathT = 0; }
    for (const h of this.heroes)   { h.path = null; h.pathI = 0; h.repathT = 0; }
    if (opened) {
      log('🚪 A door between combatants opens and the battle resumes.', 'sys');
    }
  }

  /* ============ main update ============ */
  update(dt, elapsed) {
    this.elapsed = elapsed;
    window.__elapsedTime = elapsed;
    window.__effectClock = this.fxNow;   // combat clock — status-tray countdowns
    updateFloatTexts(this.engine.scene, dt);
    updateProjectiles(this.engine.scene, dt);
    updateWorldFx(this.engine.scene, dt);
    if (this.paused) return;
    if (this._pendingFinish) {
      this._pendingFinish = false;
      this.finishDungeon();
      return;
    }
    if (this._floorClearTimer > 0) {
      this._floorClearTimer -= dt;
      if (this._floorClearTimer <= 0) {
        this._floorClearTimer = 0;
        this.finishDungeon();
        return;
      }
    }
    if (this.state !== 'crawl' || !this.D) return;
    if (this.engine.isAnimating()) return;
    if (this.campAnim) { this.updateCampAnimation(dt); return; }

    const alive = this.heroes.filter(h => h.data.hp > 0);

    if (alive.length === 0) {
      if (!this._deathChoiceOpen) this._showDeathChoice();
    } else {
      this.wipeT = 0;
      if (this._deathChoiceOpen) this._hideDeathChoiceScreen();
    }

    if (alive.length === 0) {
      /* fall through to visual loop so death animations keep playing */
    } else {

    const leader = this.partyLeader(alive);

    for (const h of alive) {
      const c = this.cellOf(h.x, h.z);
      if (c >= 0) {
        this.revealAround(c, REVEAL_RADIUS);
        if (c !== h.lastCell) {
          h.lastCell = c;
          const rid = this.D.roomId[c];
          if (rid >= 0) this.visitRoom(rid);
        }
      }
    }

    const lc = this.cellOf(leader.x, leader.z);
    if (lc >= 0 && (this.leaderTrail.length === 0 || this.leaderTrail[0] !== lc)) {
      this.leaderTrail.unshift(lc);
      if (this.leaderTrail.length > 50) this.leaderTrail.pop();
    }

    /* Advance D&D initiative before anyone acts, so the current actor's
       "ready" pulse is set for this frame (movement stays real-time). */
    this.updateInitiative(dt);

    this.updateMonsters(alive, dt);

    /* Decay kill-streak timer */
    if (this._killStreakTimer > 0) {
      this._killStreakTimer -= dt;
      if (this._killStreakTimer <= 0) { this._killStreak = 0; this._killStreakTimer = 0; }
    }

    /* Tick timed status effects + effect-based DoTs on all heroes.
       Both run on the combat clock (fxNow), which only advances inside an
       initiative order — so durations burn down in rounds, and a boon earned
       between fights is still whole when the next fight starts. */
    for (const h of this.heroes) {
      if (h.data.hp > 0) {
        this.tickEffectsOn(h);
        this.tickHeroDots(h);
        updateStatusTray(h);
      }
    }

    /* hero combat AI — two passes so heroes with no foe in range still
       hustle toward the fight instead of freezing rooms behind */
    this.combat = false;
    const foeOf = new Map();
    for (const h of alive) {
      updateFlash(h.ent, dt);
      const foe = this.heroDecideTarget(h, alive, dt);
      if (foe) { this.combat = true; foeOf.set(h, foe); }
    }
    /* Subclass "start of combat" passives (wards, temp HP, surges) fire once,
       the frame a new fight first engages (before wasCombat latches true). */
    if (this.combat && !this.wasCombat) {
      for (const h of alive) this.subclassCombatStart(h, alive);
      this.applyInspiringLeader(alive);   // feat: party-wide temp HP
      const lc = this.cellOf(leader.x, leader.z);
      this.combatRoomId = (lc >= 0 && this.D.roomId) ? this.D.roomId[lc] : -1;
    }
    for (const h of alive) {
      /* Charmed heroes switch teams — they stalk and attack their own allies
         until the charm breaks (damage save / round-cadence repeat save). */
      if (this.combat && hasEffect(h, 'charmed')) { this.charmedHeroUpdate(h, alive, dt); continue; }
      const foe = foeOf.get(h);
      if (foe) this.heroCombat(h, foe, alive, dt);
      else if (this.combat) this.combatCatchup(h, alive, dt);
    }

    /* burn DoTs from legendary Immolate perk */
    if (this.updateMonsterStatus) this.updateMonsterStatus();
    if (this.updateAoEZones) this.updateAoEZones(dt);

    /* End of combat: only clear per-fight combat flags — NOT short rest.
       Short rest comes from shrines / rest skill checks; long rest from floor clear. */
    if (this.combat) this.wasCombat = true;
    else if (this.wasCombat) {
      this.wasCombat = false;
      this.combatRoomId = null;
      this._combatEngagedAt = null;  // reset combat pacing timer
      this.recalculateFog(this);     // re-snuff frontier rooms
      for (const h of alive) {
        h._foughtThisCombat = false; // First Strike perk
        h.uncannyUsed = false;       // Uncanny Dodge once per fight
      }
      updatePartyFrames(this.heroes.map(x => x.data));
    }

    /* Doors keep working during a fight — see updateDoors. Suspending them
       mid-combat is what wedged heroes against a gate they were never allowed
       to open. The stall watchdog stays on as the last resort. */
    this.updateDoors(dt);
    if (this.combat) this._combatStallWatch(dt);
    else this._stallT = 0;

    if (!this.combat) {
      this.exploreAI(alive, leader, dt);
      /* Downed real heroes stagger back up at 30% between fights. Summoned
         companions are intentionally excluded — their deathPolicy (e.g.
         reviveOnShortRest) governs when they return. */
      for (const h of this.heroes) if (h.data.hp <= 0 && !h.companion) {
        h.data.hp = Math.max(1, Math.round(h.data.maxHp * 0.3));
        // Reset death pose
        h.ent.grp.rotation.z = 0;
        h.ent.grp.rotation.x = 0;
        h.ent.anim.mesh.position.y = 0;
        h._dyingStarted = false;
        h._deathLean = 0;
        h.ent.anim._dying = false;
        h.ent.anim._deathDone = false;
        h.ent.anim.play('walk');
        h.x = leader.x + (Math.random() - 0.5); h.z = leader.z + (Math.random() - 0.5);
        log(`${h.data.name} staggers back to their feet.`, 'heal');
        drawBar(h.ent.bar, h.data.hp / h.data.maxHp);
      }
      this.checkInteractables(alive);
      this.updateSearch(dt, alive, leader);
      /* Puzzle-floor ward rounds fire before random post-clear challenges */
      checkPuzzleGate(this);
      /* Post-clear skill challenges (paused overlay when one fires) */
      checkForChallenge(this);
      /* Post-search & pre-boss skill challenges */
      checkRoomEntryChallenge(this);
      /* Cosmetic boss reveal card (story missions with bossArt only) */
      checkBossReveal(this);
    }

    }

    this.applySeparation(alive, dt);

    /* visuals: position, bob, attack lunge */
    const cx = this.engine.cam.position.x - this.engine.camTarget.x;
    const cz = this.engine.cam.position.z - this.engine.camTarget.z;
    const camAngle = Math.atan2(cx, cz);
    const cosC = Math.cos(camAngle), sinC = Math.sin(camAngle);

    for (const h of this.heroes) {
      const [ox, oz] = this.lungeOffset(h, dt);
      h.ent.grp.position.set(h.x + ox, 0, h.z + oz);

      if (h.data.hp <= 0) {
        // Trigger death animation once
        if (!h._dyingStarted) {
          h._dyingStarted = true;
          h._deathLean = 0;
          h.ent.anim.playDeath();
        }
        // Lerp the sprite group forward (lay flat on ground)
        const targetLean = Math.PI * 0.5;
        h._deathLean = h._deathLean || 0;
        h._deathLean += (targetLean - h._deathLean) * Math.min(1, dt * 4);
        h.ent.grp.rotation.x = h._deathLean;
        // Sink the sprite slightly so it rests on the floor not above it
        h.ent.anim.mesh.position.y = Math.max(0, 0.5 - h._deathLean * 0.5);
        h.ent.anim.update(dt);
      } else {
        if (h.lungeT > 0) {
          const c = h.data.classKey;
          const casters = new Set(['wizard', 'cleric', 'sorcerer', 'warlock', 'druid', 'bard']);
          /* Pick the attack anim the equipped weapon's LPC sheets actually
             have: bows/crossbows shoot, polearms + staves thrust (they have
             no slash frames), everything else slashes. */
          const wpn = h.data.equipment && h.data.equipment.weapon;
          const vw = (wpn && wpn.visualWeapon) || '';
          let a;
          if (h.castAnim || casters.has(c)) a = 'spellcast';
          else if (vw.startsWith('ranged/')) a = 'shoot';
          /* scythe is the one polearm whose sheets swing (slash) instead of poking */
          else if (vw === 'polearm/scythe') a = 'slash';
          else if (vw.startsWith('polearm/') || vw.startsWith('magic/')) a = 'thrust';
          else a = 'slash';
          h.ent.anim.play(a);
          const rdx = h.lungeDX * cosC - h.lungeDZ * sinC;
          const rdz = h.lungeDX * sinC + h.lungeDZ * cosC;
          h.ent.anim.setDirection(rdx, rdz);
          if (h.lungeT <= 0.02) h.castAnim = false;
        } else {
          h.castAnim = false;
          h.ent.anim.play('walk');
          const pdx = h.x - (h._animPX ?? h.x);
          const pdz = h.z - (h._animPZ ?? h.z);
          const speed = Math.hypot(pdx, pdz) / Math.max(dt, 1e-4);
          if (h.moving || speed > MOVE_ANIM_SPEED_EPS) {
            h._walkHold = WALK_ANIM_HOLD;
          } else if (h._walkHold > 0) {
            h._walkHold -= dt;
          }
          if (h._walkHold <= 0) {
            h.ent.anim.time = 0;
          }
          h.ent.anim.mesh.position.y = 0;

          const angle = h.ent.grp.rotation.y;
          const mdx = Math.sin(angle), mdz = Math.cos(angle);
          h.ent.anim.setDirection(mdx * cosC - mdz * sinC, mdx * sinC + mdz * cosC);
        }
      }
      if (h.data.hp > 0) h.ent.anim.update(dt);
      /* remember this frame's position so the next frame can measure drift */
      h._animPX = h.x; h._animPZ = h.z;
    }
    this.updateMonsterVisuals(dt, elapsed, cosC, sinC);
    this.updateTurnHighlights(dt);

    if (elapsed > this.freeCamUntil) {
      /* Dynamic combat camera: center on the fight midpoint */
      const leader = this.partyLeader(alive);
      if (leader) {
        if (this.combat) {
          let cx = leader.x, cz = leader.z, n = 1;
          for (const m of this.monsters) {
            if (!m.dead && m.active && m.data.hp > 0) {
              cx += m.x; cz += m.z; n++;
            }
          }
          _v.set(cx / n, 0, cz / n);
        } else {
          _v.set(leader.x, 0, leader.z);
        }
        this.engine.camTarget.lerp(_v, Math.min(1, dt * 1.6));
        this.engine.updateCam();
      }
    }



    /* Expedition floors: exit portal tile */
    if (this.floorExit && !this.floorExit.entered) {
      this.updateFloorExit(dt, elapsed, alive);
    }

    this.saveTimer += dt;
    if (this.saveTimer > 5) {
      this.saveTimer = 0;
      this.saveGame();
      updatePartyFrames(this.heroes.map(x => x.data));
    }
  }

  updateTurnHighlights(dt) {
    const inCombat = this.initiative && this.initiative.active;
    const curActor = inCombat ? this._currentActor() : null;

    /* Update Hero Turn Highlights */
    for (const h of (this.heroes || [])) {
      if (!h.ent || !h.ent.turnHighlight) continue;
      const th = h.ent.turnHighlight;
      const isTurn = inCombat && curActor === h && h.data && h.data.hp > 0;
      th.group.visible = isTurn;
      if (isTurn && th.mat && th.spr) {
        th.mat.opacity = 0.50 + Math.sin((this.elapsed || 0) * 3.5) * 0.20;
        const scaleBoost = 1.65 + Math.sin((this.elapsed || 0) * 2.5) * 0.08;
        th.spr.scale.set(scaleBoost, scaleBoost * 1.12, 1.0);
      }
    }

    /* Update Monster Turn Highlights */
    for (const m of (this.monsters || [])) {
      if (!m.ent || !m.ent.turnHighlight) continue;
      const th = m.ent.turnHighlight;
      const isTurn = inCombat && curActor === m && m.active && m.data && m.data.hp > 0;
      th.group.visible = isTurn;
      if (isTurn && th.mat && th.spr) {
        th.mat.opacity = 0.50 + Math.sin((this.elapsed || 0) * 3.5) * 0.20;
        const scaleBoost = 1.65 + Math.sin((this.elapsed || 0) * 2.5) * 0.08;
        th.spr.scale.set(scaleBoost, scaleBoost * 1.12, 1.0);
      }
    }
  }

  /* ============ shrine camp rest animation ============ */
  beginCampAnimation(sx, sz, heroes) {
    if (this.campAnim || !heroes.length) return;

    const campX = sx, campZ = sz;

    const tents = heroes.map((h) => {
      const dx = campX - h.x, dz = campZ - h.z;
      const d = Math.hypot(dx, dz) || 1;
      const tentX = h.x + (dx / d) * 0.4;
      const tentZ = h.z + (dz / d) * 0.4;

      h.ent.grp.visible = false;

      const tent = createTentSprite();
      tent.position.set(tentX, 0, tentZ);
      tent.scale.set(1.35, 1.35, 1);
      this.gameGroup.add(tent);

      return { sprite: tent, hero: h };
    });

    const cfCV = document.createElement('canvas');
    cfCV.width = 64; cfCV.height = 64;
    const cfCtx = cfCV.getContext('2d');
    const cfTex = new THREE.CanvasTexture(cfCV);
    cfTex.minFilter = THREE.LinearFilter;
    cfTex.magFilter = THREE.LinearFilter;
    const cfMat = new THREE.SpriteMaterial({ map: cfTex, transparent: true, depthTest: true, depthWrite: false });
    const campfire = new THREE.Sprite(cfMat);
    campfire.position.set(campX, 0.05, campZ);
    campfire.scale.set(1.4, 1.4, 1);
    this.gameGroup.add(campfire);

    const light = new THREE.PointLight(0xff8833, 2, 4, 0.5);
    light.position.set(campX, 0.15, campZ);
    this.gameGroup.add(light);

    this.campAnim = {
      phase: 0,
      timer: 0,
      tents,
      campfire: { sprite: campfire, canvas: cfCV, ctx: cfCtx, tex: cfTex },
      light,
      campX,
      campZ
    };

    log('⛺', 'heal');
  }

  updateCampAnimation(dt) {
    if (!this.campAnim) return false;
    const a = this.campAnim;
    a.timer += dt;
    const t = a.timer;

    if (t < 0.6) {
      const k = t / 0.6;
      const s = Math.max(0.01, 1 - k * k);
      for (const tk of a.tents) {
        tk.hero.ent.grp.scale.setScalar(s);
      }
    } else if (t < 14.2) {
      a.lastTexUpdate = (a.lastTexUpdate || 0) + dt;
      if (a.lastTexUpdate >= 0.05) {
        a.lastTexUpdate = 0;
        drawCampfireCanvas(a.campfire.ctx, a.campfire.canvas.width, a.campfire.canvas.height, t);
        a.campfire.tex.needsUpdate = true;
      }
      a.light.intensity = 1.3 + Math.sin(t * 11) * 0.4 + Math.sin(t * 17) * 0.3;
    } else if (t < 14.8) {
      const k = (t - 14.2) / 0.6;
      const s = Math.min(1, k * k);
      for (const tk of a.tents) {
        tk.hero.ent.grp.scale.setScalar(s);
      }
      a.campfire.sprite.material.opacity = 1 - k;
      a.light.intensity = Math.max(0, 1.3 * (1 - k));
    } else {
      this.applyCampRest();
      return false;
    }
    return true;
  }

  applyCampRest() {
    if (!this.campAnim) return;
    const a = this.campAnim;

    for (const tk of a.tents) {
      this.gameGroup.remove(tk.sprite);
      tk.hero.ent.grp.visible = true;
      tk.hero.ent.grp.scale.setScalar(1);
    }

    a.campfire.sprite.material.map.dispose();
    a.campfire.sprite.material.dispose();
    this.gameGroup.remove(a.campfire.sprite);
    this.gameGroup.remove(a.light);

    this.campAnim = null;
    partyShortRest(this, { fullHeal: true, reason: 'shrine' });
  }

  _createDeathChoiceScreen() {
    if (document.getElementById('deathchoicescreen')) return;
    const ov = document.createElement('div');
    ov.id = 'deathchoicescreen';
    ov.innerHTML = `
      <div class="cs-frame fc-frame death-frame">
        <div class="cs-header">
          <div class="cs-tabs">
            <span style="color:#cc5050;font-weight:700;font-size:14px;letter-spacing:1px;">\u271D PARTY WIPED</span>
          </div>
        </div>
        <div class="cs-body" style="flex-direction:column; padding:18px 22px;">
          <div class="fc-title death-title" id="dc-flavor"></div>
          <div class="fc-desc">The party has fallen. Choose your fate \u2014 or fate will choose for you.</div>
          <div class="fc-buttons" id="dc-buttons">
            <button class="fc-btn primary" data-choice="respawn">
              <span class="fc-btn-label">\u{1F480} Respawn</span>
              <span class="fc-btn-sub">Lose 25% of items &amp; gold. Revive at the floor entrance, fully rested.</span>
              <span class="fc-count" id="dc-count"></span>
            </button>
            <button class="fc-btn" data-choice="flee">
              <span class="fc-btn-label">\u{1F3C3} Flee the Dungeon</span>
              <span class="fc-btn-sub">Abandon the quest and escape to the world map. Your loot is safe.</span>
            </button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(ov);

    if (!document.getElementById('deathchoice-css')) {
      const style = document.createElement('style');
      style.id = 'deathchoice-css';
      style.textContent = `
        #deathchoicescreen{ position:fixed; inset:0; z-index:55; display:none;
          align-items:center; justify-content:center; background:rgba(4,5,9,0.88);
          backdrop-filter:blur(6px); }
        #deathchoicescreen.show{ display:flex; }
        .death-frame{ background:linear-gradient(180deg,#1a1018,#0d0e15); }
        .death-title{ color:#d8c8a8; text-shadow:0 2px 12px rgba(200,50,50,0.3); }
      `;
      document.head.appendChild(style);
    }

    ov.querySelectorAll('.fc-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        if (this._deathPick) this._deathPick(btn.dataset.choice);
      }));
  }

  /** On party wipe: show the death-choice overlay once. A 30s wall-clock timer
   *  auto-picks Respawn (the primary option). Mirrors offerFloorChoice()'s UX. */
  _showDeathChoice() {
    const ov = document.getElementById('deathchoicescreen');
    if (!ov) return;
    this._deathChoiceOpen = true;
    const flavor = WIPE_FLAVOR[Math.floor(Math.random() * WIPE_FLAVOR.length)];
    const fl = document.getElementById('dc-flavor');
    if (fl) fl.textContent = flavor;

    let remaining = 30;
    let finished = false;
    const cd = document.getElementById('dc-count');
    if (cd) cd.textContent = `auto-respawn in ${remaining}s`;
    this._deathTimer = setInterval(() => {
      remaining--;
      if (cd) cd.textContent = `auto-respawn in ${remaining}s`;
      if (remaining <= 0) pick('respawn');
    }, 1000);

    const pick = (choice) => {
      if (finished) return;
      finished = true;
      if (this._deathTimer) { clearInterval(this._deathTimer); this._deathTimer = null; }
      ov.classList.remove('show');
      this._deathChoiceOpen = false;
      this._deathPick = null;
      this.saveGame();
      if (choice === 'flee') this._fleeDungeon();
      else this._respawnWithDeathPenalty();
    };
    this._deathPick = pick;
    ov.classList.add('show');
  }

  _hideDeathChoiceScreen() {
    const ov = document.getElementById('deathchoicescreen');
    if (ov) ov.classList.remove('show');
    if (this._deathTimer) { clearInterval(this._deathTimer); this._deathTimer = null; }
    this._deathChoiceOpen = false;
    this._deathPick = null;
  }

  /** Respawn penalty: lose 25% of inventory items (random) + 25% gold, then
   *  revive at full HP with a long rest at the current floor entrance. */
  _respawnWithDeathPenalty() {
    const { W } = this.D;
    const ea = this.roomAnchor[this.D.entrance];

    /* Loot toll: 25% of inventory items (random subset) + 25% of gold.
       Equipped gear is never touched. */
    const loseN = Math.round(this.inventory.length * 0.25);
    if (loseN > 0) {
      const idx = this.inventory.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      const losers = idx.slice(0, loseN).sort((a, b) => b - a);
      const names = losers.map(k => this.inventory[k].name);
      for (const k of losers) this.inventory.splice(k, 1);
      log(`\u{1F480} Death's toll: lost ${losers.length} item(s) \u2014 ${names.join(', ')}.`, 'down');
    }
    const loseG = Math.round(this.gold * 0.25);
    if (loseG > 0) {
      this.gold -= loseG;
      log(`\u{1F480} Death's toll: lost ${loseG}g.`, 'down');
    }

    /* Revive at full HP, reposition at entrance, reset death/anim state. */
    this.heroes.forEach((h, i) => {
      h.data.hp = h.data.maxHp;
      h.x = this.wx(ea % W) + (i % 2 === 0 ? -0.5 : 0.5);
      h.z = this.wz(Math.floor(ea / W)) + (i < 2 ? -0.5 : 0.5);
      h.path = null;
      h.ent.grp.rotation.z = 0;
      h.ent.grp.rotation.x = 0;
      h.ent.anim.mesh.position.y = 0;
      h._dyingStarted = false;
      h._deathLean = 0;
      h.ent.anim._dying = false;
      h.ent.anim._deathDone = false;
      h.ent.anim.play('walk');
    });

    /* Full recharge (abilities / slots / effects) \u2014 HP already set above. */
    partyLongRest(this, { reason: 'death respawn' });

    for (const m of this.monsters) { m.active = false; m.path = null; }
    this.targetRoom = -1;
    this.wipeT = 0;
    updateResources(this);
    updatePartyFrames(this.heroes.map(x => x.data));
    log('The party drags itself back from the brink, regrouping at the entrance\u2026', 'down');
  }

  /** Abandon the active quest and return to the world map. Loot stays intact. */
  _fleeDungeon() {
    log('\u{1F3C3} The survivors flee the dungeon, the quest abandoned\u2026', 'down');
    this.runStats = null;
    this.activeQuest = null;
    this.questFloor = 0;
    this.floorPhase = null;
    this.puzzleState = null;
    updateQuestTracker(this);
    this.saveGame();
    this.state = 'worldmap';
    setTimeout(() => showWorldMap({ refresh: true }), 600);
  }

  /**
   * Deliver the pre-rolled quest reward package at the end of the final dungeon
   * floor (called from boss kill). Safe to call once — sets rewardClaimed.
   */
  grantQuestRewardsAtDungeonEnd() {
    const q = this.activeQuest;
    if (!q || q.rewardClaimed) return;
    q.rewardClaimed = true;

    log(`🏁 Quest complete: ${q.name}!`, 'boss');

    /* Gold */
    const gold = q.rewardGold || 0;
    this.gold += gold;
    trackGold(this, gold);
    if (gold) log(`🪙 Quest reward: +${gold}g.`, 'treasure');

    /* XP — quest rewards go to the real party only (never a temp ally or companion) */
    const real = this.realHeroes();
    const xpEach = Math.max(1, Math.round((q.rewardXp || 0) / Math.max(1, real.length)));
    const before = real.map(h => h.data.level);
    for (const h of real) {
      grantXp(h.data, xpEach, log);
    }
    if (real.some((h, i) => h.data.level > before[i])) this.announceLevelUp();
    this.summons.syncScales();   // companions follow their summoner's new level
    log(`✨ Quest reward: +${xpEach} XP each.`, 'level');

    /* Legendary pity: count 10-floor clears without a legendary reward;
       reset when one lands. generateQuests forces a legendary onto the
       hardest 10-floor offer once the counter reaches LEGENDARY_PITY. */
    if ((q.floors | 0) >= 10) {
      this.legendaryPity = (q.rewardItem && q.rewardItem.rarity === 'legendary')
        ? 0 : (this.legendaryPity | 0) + 1;
    }

    /* Gear (legendary / epic prize) */
    if (q.rewardItem) {
      this.inventory.push(q.rewardItem);
      trackLoot(this, q.rewardItem);
      const tag = q.rewardItem.rarity === 'legendary' ? '★ LEGENDARY' : 'Reward';
      log(`🎁 Quest reward: ${tag} — ${q.rewardItem.name}!`, 'treasure');
      if (q.rewardItem.perk) {
        const p = q.rewardItem.perk;
        log(`  ★ ${p.name} — ${p.desc}`, 'treasure');
      }
      showBanner('QUEST COMPLETE!', q.rewardItem.name);
    } else {
      showBanner('QUEST COMPLETE!', q.name);
    }

    if (typeof this.notifyLootFeedback === 'function') {
      this.notifyLootFeedback({ gold, item: q.rewardItem });
    }

    updateResources(this);
    updatePartyFrames(this.heroes.map(h => h.data));
    refreshMenus(this);
    this.saveGame();
  }

  /* Expedition floor progression. The exit tile in the deepest room stays
     sealed until every room on the floor is done (cleared + searched + chests
     looted), then opens; the party walks onto it to descend. */
  updateFloorExit(dt, elapsed, alive) {
    const fx = this.floorExit;
    if (!fx || !this.D) return;
    const rooms = this.D.rooms;
    if (!alive) alive = this.heroes.filter(h => h.data.hp > 0);

    const exitRoomCleared = typeof this._roomCleared === 'function' && this._roomCleared(fx.roomId);

    if (!fx.active) {
      let done = 0;
      for (let rid = 0; rid < rooms.length; rid++) if (this.roomDone(rid)) done++;
      const frac = rooms.length ? done / rooms.length : 0;
      if (this._exitIndicator) updateExitIndicator(this._exitIndicator, frac, false, elapsed);
      if (done >= rooms.length || exitRoomCleared) {
        fx.active = true;
        log('🜂 The floor is swept. The way onward opens — head for the marker.', 'story');
        playSfx('doorOpen', { volume: 0.8 });
        /* point the explore AI at the exit room so the party actually goes */
        this.userGoal = this.roomAnchor[fx.roomId];
        this.targetRoom = fx.roomId;
      }
      return;
    }

    if (this._exitIndicator) updateExitIndicator(this._exitIndicator, 1, true, elapsed);

    /* keep steering there in case the explore AI wanders off */
    if (this.targetRoom !== fx.roomId) {
      this.userGoal = this.roomAnchor[fx.roomId];
      this.targetRoom = fx.roomId;
    }

    const tx = this.wx(fx.x), tz = this.wz(fx.y);
    const steppedOnPortal = alive.some(h => Math.hypot(h.x - tx, h.z - tz) < 1.6);
    if (steppedOnPortal) {
      fx.entered = true;
      log('The party descends to the next floor.', 'story');
      this.finishDungeon();
    }
  }

  /* End-of-floor story beat: a voiced branching scene that resolves into a
     skill challenge. Fires once per non-boss floor of a story mission that
     defines `floorBeats[floor]`. Returns true if a beat was shown. */
  maybeFireFloorBeat() {
    const q = this.activeQuest;
    if (!q || !q.floorBeats) return false;
    if ((this.questFloor | 0) >= (q.floors | 0)) return false;   // boss floor: its own reveal
    const bt = q.floorBeats[this.questFloor];
    if (!bt) return false;
    if (!this._floorBeatFired) this._floorBeatFired = new Set();
    if (this._floorBeatFired.has(this.questFloor)) return false;
    this._floorBeatFired.add(this.questFloor);

    showFloorBeat(this, bt, {
      voiceBase: `${q.id}_fb${this.questFloor}`,
      launchChallenge: (ch) => fireChallenge(this, ch),
    });
    return true;
  }

  finishDungeon() {
    this.completeT = -1e9;
    const q = this.activeQuest;
    trackFloor(this);

    /* Quest-ally guests leave at the stair, before the rest is applied */
    dismissAlly(this);
    /* Phase aftermath: war-chest / gauntlet spoils; true = skip the merchant */
    const skipShop = onFloorCleared(this);

    /* Long rest on floor clear — full ability / slot recharge */
    partyLongRest(this, { reason: 'floor cleared' });

    if (q) {
      /* Final floor: rewards already granted on boss kill; wrap up and open map */
      if (this.questFloor >= q.floors) {
        /* Safety: if boss path somehow skipped grant, deliver now */
        if (!q.rewardClaimed) this.grantQuestRewardsAtDungeonEnd();
        this.completeQuest();
        return;
      }
      this.questFloor++;
      this.saveGame();
      if (skipShop) {
        log(GAUNTLET_DESCEND[Math.floor(Math.random() * GAUNTLET_DESCEND.length)], 'story');
        this.nextDungeon(false);
        return;
      }
      log(`Floor cleared. Merchant camp — then floor ${this.questFloor}/${q.floors} of ${q.name}.`, 'sys');
      this.state = 'shop';
      this._openCampFlow();
      return;
    }

    /* Fallback free-crawl (no active quest) */
    this.dungeonLevel++;
    this.saveGame();
    log(`The floor is cleared. The party rests at a merchant camp before descending to floor ${this.dungeonLevel}…`, 'sys');
    this.state = 'shop';
    this._openCampFlow();
  }

  /** After final-floor rewards: clear quest state and return to world map. */
  completeQuest() {
    const q = this.activeQuest;
    if (!q) {
      this.dungeonLevel++;
      this.state = 'shop';
      showShop();
      return;
    }
    /* Rewards are granted at dungeon end (boss kill); do not grant again here. */
    if (!q.rewardClaimed) this.grantQuestRewardsAtDungeonEnd();

    /* Victory narration + quest-chain bookkeeping (sequel unlocks / epilogues) */
    onQuestCompleted(this, q);

    /* Story-mode chapter completion unlocks the next chapter */
    if (q.story && q.id) {
      this.storyProgress = this.storyProgress || {};
      this.storyProgress[q.id] = (this.storyProgress[q.id] || 0) + 1;
    }

    /* Snapshot run stats before quest state is torn down */
    const summary = finalizeRunStats(this);
    this.runStats = null;

    this.activeQuest = null;
    this.questFloor = 0;
    this.floorPhase = null;
    this.puzzleState = null;
    updateQuestTracker(this);
    this.saveGame();
    this.state = 'worldmap';
    /* Brief delay so the boss-death spectacle and reward banner land, then
       the results screen; its Continue button opens the world map. */
    setTimeout(() => {
      showQuestResults(this, q, summary, () => showWorldMap({ refresh: true }));
    }, 1200);
  }

  onShopExit() {
    this.nextDungeon(false);
  }

  /** Open the merchant camp, optionally preceded by a camp skill challenge
   *  (Persuasion/Insight/History/Deception) whose outcome resolves before the
   *  shop overlay appears. `state` must already be set to 'shop' by the caller. */
  _openCampFlow() {
    const openShop = () => { if (this.state === 'shop') showShop(); };
    const alive = this.heroes.some(h => h.data.hp > 0);
    const campSkills = ['persuasion', 'insight', 'history', 'deception'];
    const skill = campSkills[Math.floor(Math.random() * campSkills.length)];
    /* 55% chance a social challenge fires at camp */
    if (alive && Math.random() < 0.55) {
      if (!fireCampChallenge(this, skill, openShop)) openShop();
    } else {
      openShop();
    }
  }

  notifyUserPan() {
    this.freeCamUntil = this.elapsed + 6;
  }

  setPaused(p) {
    this.paused = p;
    if (!p) this.freeCamUntil = this.elapsed + 1.5;
    updateLogPauseBtn(p);
  }
}

Object.assign(
  Game.prototype,
  gameHookMethods,
  pathfindingMethods,
  fogMethods,
  combatMethods,
  monsterAiMethods,
  exploreMethods,
  inventoryMethods,
  initiativeMethods,
  turnEngineMethods
);

export const game = new Game();
if (typeof window !== 'undefined') window.__game = game;
