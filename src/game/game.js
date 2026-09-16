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
  makeHero, normalizeHero, spawnMonster, crForDungeonLevel, maxCrForDungeonLevel, crBandIndex, MONSTER_THEMES, MONSTERS_BY_ID, monsterSpawnsIn, dungeonMonsterIds, grantXp, getCuratedBossEncounter, getCuratedTacticalRoom, getThemeForMonster, pickRoomSpecies,
  storyPoolIds, storyLaneWeight, planStoryFloorCast, MONSTERS_ALL } from './srd.js';
import {
  makeHeroMesh, makeRivalHeroMesh, makeMonsterMesh, drawBar, updateFloatTexts, makeFloatText,
  updateFlash, updateProjectiles, updateWorldFx, clearEffects,
  updateStatusTray, disposeSearchIndicator,
  createExitIndicator, updateExitIndicator, disposeExitIndicator,
  preloadAllSpellAndCombatVFX, preloadFloorAssets, updateEntityStatusAuras
} from './entities.js';
import { generateRivalParty } from './rivals.js';
import { addToInventory, takeFromInventory } from './items.js';
import { configureSpriteMaterial } from './sprite_animator.js';
import { updateCompositeFX } from './vfx_animations.js';
import { playNixieEffect } from '../render/nixie_vfx.js';
import { log, buildPartyFrames, updatePartyFrames, updateResources, showBanner, showTitle, showSetup, initGameLog, updateLogPauseBtn, bindPartyLeaderUI, bindCompanionUI, layoutHud, clearLootFeed } from './ui.js';
import { showSaveSlotsModal } from './ui_save_slots.js';
import { installGlobalErrorHandlers, reportError } from './errors.js';
import { firstRunTip } from './help_ui.js';
import { hasAnySave, getMostRecentSaveSlot, getActiveSlot, setActiveSlot } from './save_slots.js';
import { logRoomSpawnDebug } from './spawn_debug.js';
import { initMenus, refreshMenus } from './menus.js';
import { initShop, showShop } from './shop.js';
import { initWorldMap, showWorldMap } from './worldmap.js';
import { showLoadingScreen, hideLoadingScreen } from '../ui/loading_screen.js';
import { showIntroCrawl } from './intro_crawl.js';
import { initSkills, checkForChallenge, resetChallengeState, fireCampChallenge, checkRoomEntryChallenge, fireChallenge } from './skills.js';
import { checkBossReveal } from './boss_card.js';
import { checkBossCutscene, updateBossCutscene, beginBossCutscene } from './boss_cutscene.js';
import { showFloorBeat } from './floor_beat.js';
import { initChestLoot, cancelPendingChestLoot } from './chest_loot.js';
import { initItemReveal } from './item_reveal.js';
import { initOptionsMenu } from './options_ui.js';
import { getSetting, setSetting } from './settings.js';
import { tickFxClock, fxClockState } from './fx_clock.js';
import { partyCentroid } from './combat_eval.js';
import { GuildManager } from './guild.js';
import {
  initQuestEvents, normalizeQuest, resolveFloorPhase, phaseNeedsChoice, offerFloorChoice,
  applyPhaseToSpawns, announceFloor, spawnAlly, dismissAlly, placeGems,
  checkPuzzleGate, onFloorCleared, onQuestCompleted, updateQuestTracker,
  shouldUseStoryCast
} from './quest_events.js';
import { GAUNTLET_DESCEND } from './quest_story.js';
import { initRunStats, finalizeRunStats, trackGold, trackLoot, trackFloor, restoreRunStats } from './run_stats.js';
import { showQuestResults } from './results.js';
import { partyLongRest, partyShortRest } from './rest.js';
import { hasEffect } from './conditions.js';
import { initAudio, playSfx } from './audio.js';

import { THEME_ORDER, REVEAL_RADIUS, SIGHT_RADIUS, FLOOR, WALL } from './constants.js';
import { writeInstances, extinguishCampfire, openChest, cam, userZoom, userPitch, setCamZoom, setYawPitch,
         BASE_HALF, MIN_CAM_ZOOM, MAX_CAM_ZOOM, yaw as camYaw, pitch as camPitch }
  from '../render/dungeon_scene.js';
import { driveCamera, resetDirector, weightedFocus, actionEpicenter, blendFocus, clampPull, centroid,
         CAM_FREE_SECONDS, CAM_ACTION_MARGIN, CAM_FIT_FLOOR_ZOOM }
  from './camera_director.js';
import { autoProloguePlan } from './overland_prologue.js';
import { buildWallAdj, buildChokepoints, buildSolidProps, buildSightBlockers, pathfindingMethods, canFly, isGroundFor } from './pathfinding.js';
import { groundY as groundYAt, easeBodyY } from '../dungeon/elevation.js';
import { buildFogMaps, fogMethods, syncDoorInstance, DOOR_OPEN_Y } from './fog.js';
import { combatMethods } from './combat.js';
import { monsterAiMethods } from './monster_ai.js';
import { gameHookMethods } from './game_hooks.js';
import { exploreMethods } from './explore.js';
import { inventoryMethods } from './inventory.js';
import { initiativeMethods } from './initiative.js';
import { Trace, installTraceConsole } from './ai_trace.js';
import { Motion, installMotionConsole } from './motion_debug.js';
import { turnEngineMethods } from './turn_engine.js';
import { reservationMethods } from './reservation.js';
import { createSummonManager } from './summons.js';

/* Min real speed (world units/sec) that counts as "moving" for the walk cycle.
   Catches separation/wall-repel shove during scrums while ignoring settled jitter. */
const MOVE_ANIM_SPEED_EPS = 0.2;
/* Seconds to keep the walk cycle running after the last detected motion. Debounces
   bursty/intermittent movement (path capture, force cancellation) so heroes don't
   flicker back to the idle frame mid-stride. */
const WALK_ANIM_HOLD = 0.12;
/* Backstop autosave cadence (see the saveTimer block in update). */
const AUTOSAVE_INTERVAL_SEC = 60;

const _doorP = new THREE.Vector3();
const _doorQ = new THREE.Quaternion();
const _doorS = new THREE.Vector3();
const _doorM = new THREE.Matrix4();
const _doorE = new THREE.Euler();
const DOOR_SINK_Y = -2.6;

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

const TENT_DIRS = ['front', 'back', 'left', 'right'];
let _tentMaterials = {};

export function getTentMaterial(dir = 'front') {
  const d = TENT_DIRS.includes(dir) ? dir : 'front';
  if (!_tentMaterials[d]) {
    const texPath = `sprites/tent/tent_${d}.png`;
    const tex = new THREE.TextureLoader().load(texPath);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    _tentMaterials[d] = configureSpriteMaterial(new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: true,
      depthWrite: false
    }));
  }
  return _tentMaterials[d];
}

export function createTentSprite(dir = 'front') {
  const sp = new THREE.Sprite(getTentMaterial(dir));
  sp.center.set(0.5, 0.1);
  return sp;
}

export function getTentFacingDir(tentX, tentZ, campX, campZ, camera = cam) {
  if (!camera || !camera.position) return 'front';

  // The tent's entrance doorway faces towards the central campfire
  const toFireX = campX - tentX;
  const toFireZ = campZ - tentZ;
  const tentAngle = Math.atan2(toFireZ, toFireX);

  // Angle from tent to camera
  const toCamX = camera.position.x - tentX;
  const toCamZ = camera.position.z - tentZ;
  const camAngle = Math.atan2(toCamZ, toCamX);

  let diff = camAngle - tentAngle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;

  // diff is the angle of camera relative to the tent's front
  if (Math.abs(diff) <= Math.PI / 4) {
    return 'front';
  } else if (Math.abs(diff) >= (3 * Math.PI) / 4) {
    return 'back';
  } else if (diff > 0) {
    return 'right';
  } else {
    return 'left';
  }
}

/* Body-level state flags the stylesheet keys off (cursor, vignette). */
function setBodyFlag(name, on) {
  const b = typeof document !== 'undefined' && document.body;
  if (!b || !b.classList) return;
  if (on) b.classList.add(name); else b.classList.remove(name);
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
    /* Camera director scratch: goal zoom, how long a better yaw has been
       better, and any quarter-turn currently in flight. See camera_director. */
    this._camDir = { zoomGoal: null, dwell: 0, turnT: null, turnFrom: 0, turnDelta: 0 };
    this.elapsed = 0;
    this.gameGroup = null;
    this.saveTimer = 0;
    this.paused = false;
    this.campAnim = null;
    this.bossCutscene = null;
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
    if (this.controlMode === 'manual') firstRunTip('manual');
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
    btn.innerHTML = `<span class="mode-ico">${isManual ? '🎮' : '⚡'}</span><span class="mode-label">${isManual ? 'MANUAL' : 'AUTO'}</span>`;
    btn.title = isManual ? 'Control Mode: MANUAL (Click or press M for Auto)' : 'Control Mode: AUTO (Click or press M for Manual)';
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
    initChestLoot(this);
    initItemReveal(this);
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
      initChestLoot(this);
      initQuestEvents(this);
      initAudio();
      return;
    }

    const activeSlot = getActiveSlot();
    this.activeSaveSlot = activeSlot;
    const initialSave = this.loadSave(activeSlot) || (hasAnySave() ? this.loadSave(getMostRecentSaveSlot()) : null);

    /* Boot flow: title screen → (New Game) select save slot → party setup → run, or
       (Continue) straight back into the saved run, or (Load Game) pick slot. */
    const startNewParty = (slots, targetSlotId) => {
      const slotId = targetSlotId != null ? targetSlotId : (this.activeSaveSlot || getActiveSlot());
      this.activeSaveSlot = slotId;
      setActiveSlot(slotId);
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
      this.guild = new GuildManager(this);
      this.saveGame(slotId);
      this.beginRun();
    };

    const continueSaved = (targetSlotId) => {
      const slotId = targetSlotId != null ? targetSlotId : (getMostRecentSaveSlot() || this.activeSaveSlot || getActiveSlot());
      const save = this.loadSave(slotId);
      if (!save) {
        openTitle();
        return;
      }
      this.activeSaveSlot = slotId;
      setActiveSlot(slotId);
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
      this.guild = new GuildManager(this);
      if (save.guildData && this.guild) this.guild.deserialize(save.guildData);
      restoreRunStats(this, save.runStats || null);
      /* Old save resumed mid-quest: stats cover the remainder of the run */
      if (this.activeQuest && !this.runStats) initRunStats(this, this.activeQuest);
      /* Re-inject run-persistent summoned companions (added without meshes;
         the floor-load loop wraps them like any other hero). */
      this.summons.restore(save.companions);
      this.beginRun(true);
    };

    this.startNewPartyInSlot = (slotId) => {
      this.activeSaveSlot = slotId;
      showSetup(slots => startNewParty(slots, slotId), () => showWorldMap({ refresh: true }));
    };

    this.loadAndSwitchSlot = (slotId) => {
      this.saveGame();
      continueSaved(slotId);
    };

    const openTitle = () => {
      const anySave = hasAnySave();
      showTitle(anySave, {
        onNew: () => {
          showSaveSlotsModal({
            mode: 'new',
            onSelect: (targetSlotId) => {
              this.activeSaveSlot = targetSlotId;
              setActiveSlot(targetSlotId);
              showSetup(slots => startNewParty(slots, targetSlotId), openTitle);
            },
            onCancel: openTitle
          });
        },
        onContinue: () => continueSaved(getMostRecentSaveSlot()),
        onLoad: () => {
          showSaveSlotsModal({
            mode: 'load',
            onSelect: (targetSlotId) => {
              continueSaved(targetSlotId);
            },
            onCancel: openTitle
          });
        }
      });
    };
    openTitle();

    const modeBtn = document.getElementById('mode-toggle-btn');
    if (modeBtn) modeBtn.addEventListener('click', () => this.toggleControlMode());
    const exitBtn = document.getElementById('btn-exit-dungeon');
    if (exitBtn) exitBtn.addEventListener('click', () => {
      if (this.state === 'worldmap') return;
      if (window.confirm('Abandon the current dungeon run and return to the World Map? All collected loot and gold will be kept.')) {
        this._fleeDungeon();
      }
    });
    document.getElementById('potheal')?.addEventListener('click', () => this.drinkPotion('heal'));
    document.getElementById('potgreater')?.addEventListener('click', () => this.drinkPotion('greater'));
    document.getElementById('potsuperior')?.addEventListener('click', () => this.drinkPotion('superior'));
    /* potion hotkeys: 1 = heal, 2 = greater, 3 = superior (ignore while typing).
       L cycles the party leader, M toggles Auto/Manual mode.
       Auto-drinking is now per-hero via the AI Priorities tab (potionThreshold knob). */
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'F3') { e.preventDefault(); setSetting('perfOverlay', !getSetting('perfOverlay')); return; }
      if (e.key === '1') this.drinkPotion('heal');
      else if (e.key === '2') this.drinkPotion('greater');
      else if (e.key === '3') this.drinkPotion('superior');
      else if (e.key === 'l' || e.key === 'L') this.cycleLeader();
      else if (e.key === 'm' || e.key === 'M') this.toggleControlMode();
      else if (e.key === 'e' || e.key === 'E') {
        if (this.controlMode === 'manual' && this.initiative && this.initiative.active) {
          const cur = this._currentActor();
          if (cur && cur._side === 'hero') {
            this.manualEndTurn();
          }
        }
      }
      else if (e.key === 'Escape') {
        if (this.cancelAttackTargeting) this.cancelAttackTargeting();
        if (this.cancelSpellTargeting) this.cancelSpellTargeting();
        if (this.clearPendingMove) this.clearPendingMove();
        if (typeof window !== 'undefined' && window.__closeManualDrawer) window.__closeManualDrawer();
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
    initChestLoot(this);
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
    this.questFloor = (quest && quest.startFloor) ? quest.startFloor : 1;
    if (quest) {
      quest.rivalFloor = quest.rivalFloor || Math.max(1, Math.ceil((quest.floors || 1) / 2));
      quest.rivalSpawned = false;
      quest.rivalDefeated = false;
    }
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
    /* Loot rows are about what just happened on THIS floor — carrying them
       through a transition would have them fade over a room they were not
       found in. */
    clearLootFeed();
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

    showLoadingScreen({
      title: q ? q.name : `DUNGEON DEPTH ${lvl}`,
      subtitle: q ? `Floor ${this.questFloor} of ${q.floors} · Preparing encounters...` : `Descending into depth ${lvl}...`,
      floor: this.questFloor
    });
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
      : ((q && !q.skipPrologue) ? autoProloguePlan(q, this.questFloor) : null);
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
      const hasRival = !!(
        q && !q.rivalSpawned &&
        (this.questFloor === (q.rivalFloor || 1) || q.forceRivalRoom)
      );
      this._pendingFloorName = (plan && plan.name) || null;
      this.engine.reforge(seed, roomCount, fTheme, false, tMult, qLevel, { hasRivalRoom: hasRival });
    }
    if (!first) this.saveGame();
  }

  /* ============ dungeon load (called by engine forge) ============ */
  onDungeon(d) {
    if (this.state === 'boot') return;
    cancelPendingChestLoot();   // a lid still swinging on the old floor has no chest to pay out
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
    preloadAllSpellAndCombatVFX(eng?.renderer, eng?.scene, eng?.cam);
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
    /* Separate from solidProps: a coffin stops feet, not eyes. See
       SIGHT_BLOCKING_KINDS — hasLOS and the fog's field of view both read
       this, so the two questions stay independent. */
    d.sightBlockers = buildSightBlockers(d, d.solidProps);

    /* The renderer hands over the cell → floor-instance map it actually built;
       see buildFogMaps for why this is not re-derived from the grid. */
    const fog = buildFogMaps(d, this.engine && this.engine.getFloorMap
      ? this.engine.getFloorMap() : null);
    this.floorInst = fog.floorInst;
    this.floorInstN = fog.floorInstN;
    this.wallInst = fog.wallInst;
    this.revealed = fog.revealed;
    this.losSeen = fog.losSeen;
    this.losVisible = fog.losVisible;
    this.visitedRooms = fog.visitedRooms;
    this._searchedRooms = new Uint8Array(rooms.length);
    this._scoutedRooms = new Uint8Array(rooms.length);
    this._fovDirty = true;          // first field-of-view sweep on the new floor
    this.fogAll();

    this.roomAnchor = rooms.map(r => {
      let c = r.cy * W + r.cx;
      if (grid[c] === FLOOR && (!d.solidProps || !d.solidProps[c])) return c;
      for (let rad = 1; rad < 6; rad++)
        for (let oy = -rad; oy <= rad; oy++) for (let ox = -rad; ox <= rad; ox++) {
          const nx = r.cx + ox, ny = r.cy + oy;
          const idx = ny * W + nx;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && grid[idx] === FLOOR && d.roomId[idx] === r.id && (!d.solidProps || !d.solidProps[idx]))
            return idx;
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
    const roomSpawnSpecies = {}; // roomId -> { counts, pools, anchorFamily } — feeds the per-room species variety cap
    /* Hard-coded story cast for this floor, if the mission declares one. */
    const _sq = this.activeQuest;
    const _sPlan = (_sq && Array.isArray(_sq.floorPlan)) ? _sq.floorPlan[this.questFloor - 1] : null;
    /* Story rosters may be flat arrays OR legacy tier-keyed objects ({1:[...],2:[...]}).
       Flatten either into a single candidate list — spawnMonster then filters it
       by CR window, so the authored cast auto-scales with floor depth. */
    const _rawRoster = (_sPlan && _sPlan.monsters) || (_sq && _sq.monsterRoster) || null;
    /* The story-cast path is for AUTHORED casts only — story missions (q.story)
       or floors with an explicit per-floor `monsters` list. Generic quests also
       carry a `monsterRoster` (decorateQuest sets one for every quest), but they
       must spawn from the generator's priced slots instead, so the room threat
       budget and the level's CR ceiling are actually honoured. Routing them here
       silently replaced the budget-drawn rooms with a lane-locked curated cast
       that ignored the budget entirely. */
    const storyPool = shouldUseStoryCast(_sq, _sPlan) && _rawRoster && storyPoolIds(_rawRoster).length ? _rawRoster : null;
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
      if (d.rooms && d.rooms.some(r => r.id === sp.roomId && (r.type === 'rival' || r.rival))) continue;

      if (storyCast) {
        const castId = storyCast.get(sp);
        /* null = the floor's budget ran out before this spawn point; leave it
           empty instead of importing an off-cast creature. */
        if (!castId) continue;
        const m = applyPhaseToSpawns(this, spawnMonster(
          MONSTERS_BY_ID[castId]?.cr ?? 1, this.effectiveLevel, Math.random,
          [castId], questInfo, sp.role || null, true, true));
        if (this._spawnDbg) this._spawnDbg.push({ roomId: sp.roomId, tcr: MONSTERS_BY_ID[castId]?.cr ?? 1, band: 'story', allowed: 'cast', role: sp.role || null, fieldedCR: m.data?.cr, fieldedId: m.data?.id });
        if (sp.roomBuff === 'arcane_surge') {
          m.arcaneSurge = true;
          m.atk = (m.atk || 0) + 2;
          m.speedMult = (m.speedMult || 1) * 1.15;
        }
        this.addMonster(m, sp.x, sp.y, sp.roomId);
        continue;
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
        /* Clamp to the level ceiling so the slot's resolved CR (what the purse
           is charged) matches what spawnMonster is allowed to field — without
           this, a step-up that clears the ceiling is priced above the curve but
           fields a ceiling monster, silently shorting the room's value. */
        targetCR = Math.min(Math.max(0.125, step), maxCrForDungeonLevel(questInfo.dungeonLevel));
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
      let curatedTactical = null;

      if (sp.roomStyle) {
        curatedTactical = getCuratedTacticalRoom(sp.roomStyle, d.themeKey, questInfo.dungeonLevel || this.effectiveLevel || 1);
        if (curatedTactical && curatedTactical.length > 0) {
          allowedNames = curatedTactical;
        } else if (sp.roomStyle === 'necromantic') {
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
      }
      const poolKey = sp.role ? `role_${sp.role}_${bandKey}` : String(bandKey);

      /* Per-room species state for the variety cap: counts caps how many copies
         of one creature a room may field (SPECIES_CAP); pools tracks which
         species each band/role has already rolled; anchorFamily is the room's
         dominant vibe family so fresh rolls stay cohesive. */
      let roomSpecies = roomSpawnSpecies[sp.roomId];
      if (!roomSpecies) roomSpecies = roomSpawnSpecies[sp.roomId] = { counts: {}, pools: {}, anchorFamily: null };
      const counts = roomSpecies.counts;
      if (!roomSpecies.pools[poolKey]) roomSpecies.pools[poolKey] = [];
      const bandPool = roomSpecies.pools[poolKey];
      /* Unified rooms (a swarm, a duel, a brood) deliberately field ONE species
         per role — the variety cap below would break "ten grey rats". */
      const unify = sp.roomStyle === 'swarm' || sp.roomStyle === 'duelists' || sp.roomStyle === 'nest';

      let chosenId;
      if (unify) {
        if (bandPool.length === 0) {
          let seedId;
          if (curatedTactical && curatedTactical.length > 0) {
            seedId = curatedTactical[Math.floor(Math.random() * curatedTactical.length)];
          } else {
            const seed = spawnMonster(targetCR, this.effectiveLevel, Math.random, allowedNames, questInfo, sp.role);
            seedId = seed.id;
          }
          bandPool.push(seedId);
        }
        chosenId = bandPool[0];
      } else {
        /* The CR window the slot may field within — mirrors spawnMonster so the
           pick can exclude capped species without drifting off the slot's CR. */
        const minCR = Math.max(0, targetCR * 0.5);
        const maxCR = Math.min(Math.max(targetCR * 1.5, targetCR + 0.5),
          maxCrForDungeonLevel(questInfo.dungeonLevel));
        const windowed = allowedNames
          ? allowedNames.filter((id) => {
              const c = MONSTERS_BY_ID[id] && MONSTERS_BY_ID[id].cr;
              return typeof c === 'number' && c >= minCR && c <= maxCR;
            })
          : null;
        chosenId = pickRoomSpecies({
          bandPool, counts,
          anchorFamily: roomSpecies.anchorFamily,
          familyOf: (id) => MONSTERS_BY_ID[id] ? getThemeForMonster(MONSTERS_BY_ID[id]) : 'Unknown',
          window: windowed && windowed.length ? windowed : (allowedNames ? allowedNames.filter(id => MONSTERS_BY_ID[id]) : null),
          roll: (pool) => {
            const sm = spawnMonster(targetCR, this.effectiveLevel, Math.random, pool, questInfo, sp.role);
            return sm ? sm.id : (pool && pool[0] ? pool[0] : 'goblin');
          }
        });
      }
      counts[chosenId] = (counts[chosenId] || 0) + 1;
      if (!roomSpecies.anchorFamily && MONSTERS_BY_ID[chosenId]) {
        roomSpecies.anchorFamily = getThemeForMonster(MONSTERS_BY_ID[chosenId]);
      }

      const m = applyPhaseToSpawns(this, spawnMonster(targetCR, this.effectiveLevel, Math.random, [chosenId], questInfo, sp.role));
      if (this._spawnDbg) this._spawnDbg.push({ roomId: sp.roomId, tcr: targetCR, band: bandKey, allowed: allowedNames?.length ?? null, role: sp.role || null, fieldedCR: m.data?.cr, fieldedId: m.data?.id });
      if (sp.roomBuff === 'arcane_surge') {
        m.arcaneSurge = true;
        m.atk = (m.atk || 0) + 2;
        m.speedMult = (m.speedMult || 1) * 1.15;
      }
      this.addMonster(m, sp.x, sp.y, sp.roomId);
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
      this.bossEncounterUsed = null;
      const ex = (ba % W), ey = Math.floor(ba / W);
      this.floorExit = { roomId: d.boss, x: ex, y: ey, active: false, entered: false };
      this._exitIndicator = createExitIndicator(this.gameGroup, this.wx(ex), this.wz(ey));
      updateExitIndicator(this._exitIndicator, 0, false, 0);

      // Spawn 2-3 Miniboss / Elite pack monsters in room d.boss
      /* The pack scales toward the level's CR ceiling, never past it — the
         party must not meet anything above the dungeon's controlled strength
         (the same rule buyRoomSpawns and spawnMonster already enforce). */
      const packCap = maxCrForDungeonLevel(questInfo.dungeonLevel);
      const targetCR = Math.min(
        crForDungeonLevel(questInfo.dungeonLevel + Math.max(0, questInfo.questFloor - 1) * 0.5),
        packCap
      );
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

      /* Remember which encounter this floor's boss ACTUALLY came from, so the
         intro cinematic reads the same one the spawner used instead of
         re-deriving it. Two ways they would otherwise disagree: a quest can
         carry no pre-rolled bossEncounter at all and fall back to the curated
         lookup above (dev test delves do exactly this), and a finalBossId
         override can leave the curated entry describing a boss that is not the
         one standing here — the same condition guarding bossTitle below. */
      this.bossEncounterUsed =
        (curated && (!q2?.finalBossId || q2.finalBossId === curated.bossId)) ? curated : null;
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

    /* Spawn Rival Adventurers party if this floor features a rival camp */
    const rivalRoom = d.rooms && d.rooms.find(r => r.type === 'rival' || r.rival);
    if (rivalRoom) {
      if (this.activeQuest) this.activeQuest.rivalSpawned = true;
      const { company, rivals } = generateRivalParty(this.dungeonLevel || 1);
      this.rivalCompany = company;
      const offsets = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      rivals.forEach((rData, idx) => {
        const off = offsets[idx % offsets.length];
        const rx = Math.max(1, Math.min(W - 2, rivalRoom.cx + off[0]));
        const ry = Math.max(1, Math.min(H - 2, rivalRoom.cy + off[1]));
        this.addRivalMonster(rData, rx, ry, rivalRoom.id);
      });
      log(`⚔️ A rival adventuring company, "${company}", has set up camp on this floor!`, 'crit');
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
      /* Place each hero on a distinct cell at or adjacent to the entrance,
         not at half-cell ±0.5 offsets (which used to seed a first-move
         backstep jitter). Reserve the landing cell so no follower stacks on
         the leader before movement begins. */
      const offsets = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
      const ox = offsets[i % offsets.length][0];
      const oy = offsets[i % offsets.length][1];
      const px = Math.max(1, Math.min(W - 2, ex + ox));
      const py = Math.max(1, Math.min(this.D.H - 2, ey + oy));
      if (typeof this.placeAtFreeCell === 'function') {
        this.placeAtFreeCell(h, this.wx(px), this.wz(py), { radius: 2 });
      } else {
        h.x = this.wx(px); h.z = this.wz(py);
      }
      h.ent.grp.position.set(h.x, groundYAt(this.D, h.x, h.z), h.z);
      this.clearEntityPath(h);
      h.target = null; h.repathT = 0; h.walkPhase = Math.random() * 6;
      this.gameGroup.add(h.ent.grp);
      drawBar(h.ent.bar, Math.max(0, h.data.hp / h.data.maxHp));
    });

    /* Immediately snap camera directly onto the party leader so the view starts on the party without panning */
    const alive = this.heroes.filter(h => h.data.hp > 0);
    const leader = this.partyLeader(alive) || this.heroes[0];
    if (leader && this.engine && this.engine.camTarget) {
      this.engine.camTarget.set(leader.x, 0, leader.z);
      if (typeof this.engine.updateCam === 'function') this.engine.updateCam();
    }
    /* A snap invalidates everything the director had in flight: a half-finished
       quarter-turn and a zoom goal fitted to the previous floor's fight. */
    resetDirector(this._camDir);

    this.leaderTrail = [];
    this.targetRoom = -1;
    this.userGoal = -1;
    this._searchRoom = -1; this._searchT = 0; this._searchGoal = -1; this._searchGoalT = 0;
    this._searchIndicator = null;
    this.combat = false;
    this.wipeT = 0;
    this.completeT = 0;

    this.visitRoom(d.entrance, true);
    if (this.guild && typeof this.guild.getDungeonPreScoutedRooms === 'function') {
      const scouted = this.guild.getDungeonPreScoutedRooms(d);
      for (const sRid of scouted) {
        if (sRid >= 0 && sRid < d.rooms.length) this._scoutedRooms[sRid] = 1;
      }
      if (scouted.length > 0) {
        log(`🗺️ Cartographer's Guild charted ${scouted.length} room${scouted.length > 1 ? 's' : ''} on this floor in advance!`, 'treasure');
      }
    }
    this.recalculateFog(this);   // show frontier rooms adjacent to entrance + scouted rooms

    if (this.testMonsterConfig) {
      const tCfg = this.testMonsterConfig;
      this.monsters.forEach(m => {
        if (m.ent && m.ent.grp) this.gameGroup.remove(m.ent.grp);
      });
    this.monsters = [];
    this._spawnDbg = [];   // per-slot spawn record, consumed by spawn_debug.js

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
    const warmupPromise = preloadFloorAssets(this, this.engine?.renderer, this.engine?.scene, this.engine?.cam);
    hideLoadingScreen(warmupPromise, 1400);
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
    /* Find a free spawn cell near the requested (x, y). Multiple escorts /
       reinforcements often share a spawn anchor; without this, two bodies
       would land on the same tile and the second would evict the first's
       reservation. Radius-2 spiral search picks the nearest open floor. */
    let spawnX = this.wx(x), spawnZ = this.wz(y);
    if (typeof this.placeAtFreeCell === 'function' && this.D) {
      /* placeAtFreeCell mutates the entity's x/z directly, so we use a
         throwaway holder then read the chosen coordinates back. */
      const probe = { x: spawnX, z: spawnZ, data: instanceSpec };
      this.placeAtFreeCell(probe, spawnX, spawnZ, { radius: 2 });
      spawnX = probe.x; spawnZ = probe.z;
    }
    const m = {
      data: instanceSpec, x: spawnX, z: spawnZ, roomId, isBoss,
      variant: instanceSpec.ranged ? 'ranged' : 'melee',
      active: false, path: null, pathI: 0, cd: Math.random() * 2, repathT: 0,
      walkPhase: Math.random() * 6
    };
    /* Even dormant (inactive) monsters reserve their spawn cell so a hero
       wandering past doesn't stand on top of them before they activate. The
       reservation is reaped automatically if the monster later moves/dies. */
    if (typeof this.reserveCell === 'function') {
      const c = (typeof this.cellOf === 'function') ? this.cellOf(m.x, m.z) : -1;
      if (c >= 0) this.reserveCell(m, c);
    }
    m.ent = makeMonsterMesh(spec);
    m.ent.grp.position.set(m.x, groundYAt(this.D, m.x, m.z), m.z);
    m.ent.grp.visible = false;
    this.gameGroup.add(m.ent.grp);
    this.monsters.push(m);
  }

  /** Spawn a rival adventurer hero as a hostile combatant. */
  addRivalMonster(spec, x, y, roomId) {
    let spawnX = this.wx(x), spawnZ = this.wz(y);
    if (typeof this.placeAtFreeCell === 'function' && this.D) {
      const probe = { x: spawnX, z: spawnZ, data: spec };
      this.placeAtFreeCell(probe, spawnX, spawnZ, { radius: 2 });
      spawnX = probe.x; spawnZ = probe.z;
    }
    const m = {
      data: spec, x: spawnX, z: spawnZ, roomId, isBoss: false, isRival: true,
      variant: spec.ranged ? 'ranged' : 'melee',
      active: false, path: null, pathI: 0, cd: Math.random() * 1.5, repathT: 0,
      walkPhase: Math.random() * 6
    };
    if (typeof this.reserveCell === 'function') {
      const c = (typeof this.cellOf === 'function') ? this.cellOf(m.x, m.z) : -1;
      if (c >= 0) this.reserveCell(m, c);
    }
    m.ent = makeRivalHeroMesh(spec);
    m.ent.grp.position.set(m.x, groundYAt(this.D, m.x, m.z), m.z);
    m.ent.grp.visible = false;
    this.gameGroup.add(m.ent.grp);
    this.monsters.push(m);
  }

  /** Spawn a temporary ally hero mid-floor (skill-check reward / animal friend).
   *  `data` is a full hero record (from makeHero). Placed at a free cell near
   *  the party leader. temp:true excludes it from saveGame, kill XP, and
   *  quest-reward splits. */
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
    /* Land on a free cell near the leader instead of stacking on the leader's
       own tile (the old behaviour seeded a same-cell pair every time). */
    if (typeof this.placeAtFreeCell === 'function' && leader) {
      this.placeAtFreeCell(h, leader.x, leader.z, { radius: 2 });
    }
    h.ent.grp.position.set(h.x, groundYAt(this.D, h.x, h.z), h.z);
    this.gameGroup.add(h.ent.grp);
    drawBar(h.ent.bar, Math.max(0, h.data.hp / h.data.maxHp));
    this.heroes.push(h);
    buildPartyFrames(this.heroes.map(x => x.data));
    return h;
  }

  /** Remove a temp ally (floor clear / dismiss). Any gear the player equipped
   *  on them from the party stash is returned to the stash. */
  dismissTempAlly() {
    const idx = this.heroes.findIndex(h => h.temp);
    if (idx < 0) return;
    const [ally] = this.heroes.splice(idx, 1);
    if (ally.data?.equipment) {
      for (const it of Object.values(ally.data.equipment)) addToInventory(this.inventory, it);
    }
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

  isCombatActive() {
    return !!(this.combat || (this.initiative && this.initiative.active));
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
      if (this._animatingDoors && this._animatingDoors.has(i)) continue;
      /* syncDoorInstance skips any gate the fog currently holds hidden — see
         its comment. This loop runs for the WHOLE floor every time a single
         door opens, so writing hidden instances here lit up every unexplored
         gate on the map. */
      syncDoorInstance(gateMesh, i, !!(this._unlockedDoors && this._unlockedDoors.has(i)));
    }
    if (gateMesh.instanceMatrix) gateMesh.instanceMatrix.needsUpdate = true;
  }

  /* Doors open for whichever living hero walks up to them — in combat as well
     as out of it. */
  updateDoors(dt) {
    /* Runs DURING combat too. The caller's comment has said "doors keep working
       during a fight" for a while, but this early return sat here undoing it:
       every unlock timer was wiped each frame, so a party fighting across a
       shut gate could never open it and the fight could never end — and the
       fight not ending was the reason doors stayed shut. */
    if (!this.D || !this.D.arches || !this._unlockedDoors) return;
    const alive = this.heroes.filter(h => h.data.hp > 0);
    if (!alive.length) return;

    if (!this._doorUnlockTimers) this._doorUnlockTimers = {};
    if (!this._animatingDoors) this._animatingDoors = new Map();

    const W = this.D.W;
    let changed = false;

    // 1. Proximity check to trigger door opening
    for (let i = 0; i < this.D.arches.length; i++) {
      if (this._unlockedDoors.has(i)) continue;
      const a = this.D.arches[i];
      const ax = this.wx(a.x);
      const az = this.wz(a.y);

      /* Proximity opens a gate while exploring — walk up to it and it swings.
         In a FIGHT no gate opens at all. Not on proximity, not for a hero
         routing through it, not for the stall breaker: every softer rule tried
         here leaked, because a fight naturally drifts heroes onto thresholds
         and pathing sends them through gates mid-combat. A gate that swings
         during a fight pulls the room behind it into that fight, so the rule
         is absolute and the enforcement lives in three places that all have to
         agree — here, forceDoorsAlongPath, and forceOpenAllDoors.

         A fight that genuinely cannot be reached is ended rather than forced
         open; see _breakCombatStall. */
      const inFight = typeof this.isCombatActive === 'function' && this.isCombatActive();

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
        /* A hero heading for this arch counts as arriving early — out of
           combat only, like everything else here. */
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

        /* No hero counts as an opener mid-fight, so bd stays 1e9 and the
           branch below cancels any unlock already counting down and puts the
           gate back where it was. */
        if (inFight) continue;
        if (minDist < bd) { bd = minDist; opener = h; }
      }

      if (bd < 2.2) {
        if (this._doorUnlockTimers[i] === undefined) {
          this._doorUnlockTimers[i] = 0;
          playSfx('lockUnlock', { volume: 0.7 });
          playSfx('gateOpen', { volume: 0.75 });
          log('🚪 Opening door...', 'sys');

          const meshes = this.engine?.getMeshes ? this.engine.getMeshes() : null;
          const gateMesh = meshes ? meshes.gate : null;
          const s = gateMesh?.userData?.set;
          const origPx = (s && s.px && s.px[i] !== undefined) ? s.px[i] : ax;
          const origPz = (s && s.pz && s.pz[i] !== undefined) ? s.pz[i] : az;
          const startY = (s && s.py && s.py[i] !== undefined) ? s.py[i] : 0;
          const origSx = (s && s.sx && s.sx[i] !== undefined) ? s.sx[i] : 1.0;
          const origSy = (s && s.sy && s.sy[i] !== undefined) ? s.sy[i] : 1.8;
          const origSz = (s && s.sz && s.sz[i] !== undefined) ? s.sz[i] : 1.0;

          try {
            playNixieEffect('door_splinters', { x: ax, y: 0.05, z: az }, { scale: 0.85, duration: 0.35 });
          } catch (e) { reportError('door splinter VFX', e, 'warn'); }

          this._animatingDoors.set(i, {
            t: 0,
            dur: 0.6,
            ax,
            az,
            origPx,
            origPz,
            startY,
            targetY: DOOR_SINK_Y,
            origSx,
            origSy,
            origSz
          });
        }

        this._doorUnlockTimers[i] += dt;

        if (this._doorUnlockTimers[i] >= 0.6) {
          this._unlockedDoors.add(i);
          delete this._doorUnlockTimers[i];
          changed = true;
          /* Sight through the gate just changed without anyone moving, so the
             field of view has to be recomputed even if the party stands still.
             The room beyond lights by LOS from here; its banner, music and
             full reveal still wait for someone to cross the threshold
             (visitRoom). */
          this._fovDirty = true;
          playSfx('doorOpen', { volume: 0.8 });
          log('🚪 Door opened.', 'sys');
          /* Everyone repaths: stagger slightly across successive frames so
             the entire party does not compute full A* searches simultaneously on a single frame. */
          alive.forEach((h, idx) => {
            if (typeof this.clearEntityPath === 'function') this.clearEntityPath(h);
            else { h.path = null; h.pathI = 0; }
            h.pathGoal = -1;
            h.repathT = idx * 0.04;
            h.stuckT = 0;
            h.stuckStage = 0;
            h._blockedByDoor = false;
            h._doorWaitTime = 0;
          });
          this.stuckT = 0;
        }
      } else {
        if (this._doorUnlockTimers[i] !== undefined && !this._unlockedDoors.has(i)) {
          delete this._doorUnlockTimers[i];
          this._animatingDoors.delete(i);
          this.syncDoorVisuals();
        }
      }
    }

    // 2. Animate rumbling and sliding doors
    if (this._animatingDoors && this._animatingDoors.size > 0) {
      const meshes = this.engine?.getMeshes ? this.engine.getMeshes() : null;
      const gateMesh = meshes ? meshes.gate : null;
      const s = gateMesh?.userData?.set;

      if (gateMesh && s) {
        for (const [idx, anim] of this._animatingDoors.entries()) {
          anim.t += dt;
          const p = Math.min(1.0, anim.t / anim.dur);

          // Rumble vibration effect
          const rumbleMag = Math.max(0, (1.0 - p) * 0.03);
          const jx = Math.sin(anim.t * 70.0) * rumbleMag;
          const jz = Math.cos(anim.t * 60.0) * rumbleMag;

          // Smooth mechanical slide & shrink into floor pocket
          const ease = p * p * (3 - 2 * p);
          const curY = anim.startY + (anim.targetY - anim.startY) * ease;
          const scaleMult = Math.max(0, 1.0 - ease);

          s.py[idx] = curY;
          s.px[idx] = anim.origPx + jx;
          s.pz[idx] = anim.origPz + jz;

          _doorQ.setFromEuler(_doorE.set(s.rx[idx], s.ry[idx], s.rz[idx]));
          _doorP.set(s.px[idx], s.py[idx], s.pz[idx]);
          _doorS.set(anim.origSx * Math.min(1.0, scaleMult * 1.2), anim.origSy * scaleMult, anim.origSz * Math.min(1.0, scaleMult * 1.2));
          _doorM.compose(_doorP, _doorQ, _doorS);
          gateMesh.setMatrixAt(idx, _doorM);

          if (p >= 1.0) {
            /* Hand the finished door to the same code that owns every other
               gate write, so it lands in the one state that all the other
               passes agree is invisible — sunk AND zero-scaled in the set. */
            s.px[idx] = anim.origPx;
            s.pz[idx] = anim.origPz;
            syncDoorInstance(gateMesh, idx, true);
            this._animatingDoors.delete(idx);
          }
        }
        if (gateMesh.instanceMatrix) gateMesh.instanceMatrix.needsUpdate = true;
      }
    }

    if (changed) this.syncDoorVisuals();
  }

  /* Unlock every still-closed door arch that a path passes through. Returns
     true if at least one door was opened.

     Both force-open helpers refuse while a fight is running. They were opened
     up once, to give the stall watchdog a remedy — but "a door opened during
     combat" is exactly the bug players kept reporting, and a back door left
     for the watchdog is still a back door. The watchdog has a different
     remedy now (see _breakCombatStall), so these can hold the line. */
  forceDoorsAlongPath(path) {
    if (this.isCombatActive()) return false;
    if (!path || !this.D || !this.D.cellToArch || !this._unlockedDoors) return false;
    let opened = false;
    for (const c of path) {
      if (c < 0 || c >= this.D.cellToArch.length) continue;
      const arch = this.D.cellToArch[c];
      if (arch >= 0 && !this._unlockedDoors.has(arch)) {
        this._unlockedDoors.add(arch);
        if (this._doorUnlockTimers) delete this._doorUnlockTimers[arch];
        if (this._animatingDoors) this._animatingDoors.delete(arch);
        opened = true;
      }
    }
    if (opened) {
      this.syncDoorVisuals();
      this._fovDirty = true;
      playSfx('doorOpen', { volume: 0.7 });
    }
    return opened;
  }

  /* Last-resort: open every closed door on the floor. Never during a fight. */
  forceOpenAllDoors() {
    if (this.isCombatActive()) return false;
    if (!this.D || !this.D.arches || !this._unlockedDoors) return false;
    let opened = false;
    for (let i = 0; i < this.D.arches.length; i++)
      if (!this._unlockedDoors.has(i)) {
        this._unlockedDoors.add(i);
        if (this._doorUnlockTimers) delete this._doorUnlockTimers[i];
        if (this._animatingDoors) this._animatingDoors.delete(i);
        opened = true;
      }
    if (opened) {
      this.syncDoorVisuals();
      this._fovDirty = true;
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

  /* True when this monster could reach the party if a shut gate were opened
     for it, and cannot otherwise — i.e. a closed door is the ONE thing in its
     way. Both queries share a goal, so anything else that blocks a route
     (bodies wedged in a corridor, a prop, a wall) blocks them equally and
     answers false. That matters: retiring a monster is not the remedy for a
     wedge, and this must never mistake one for the other.

     The goal is a free cell NEXT TO a hero, never the hero's own cell —
     findPath refuses outright when the destination is occupied, and the
     party's own square always is. */
  _shutGateIsTheOnlyThingBetween(m) {
    if (!this.D || typeof this.cellOf !== 'function') return false;
    const from = this.cellOf(m.x, m.z);
    if (from < 0) return false;
    const W = this.D.W, H = this.D.H || Math.floor(this.D.grid.length / W);

    let reachableThroughGate = false;
    for (const h of this.heroes) {
      if (h.data.hp <= 0) continue;
      const hc = this.cellOf(h.x, h.z);
      if (hc < 0) continue;
      const hx = hc % W, hy = Math.floor(hc / W);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = hx + ox, ny = hy + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const goal = ny * W + nx;
          if (goal === from) return false;               /* already adjacent */
          /* Without doors first: one success and the fight is not gated. */
          if (this.findPath(from, goal, { avoidClosedDoors: true })) return false;
          if (!reachableThroughGate && this.findPath(from, goal)) reachableThroughGate = true;
        }
      }
    }
    return reachableThroughGate;
  }

  _breakCombatStall() {
    /* This used to force the gate between the combatants open. It cannot any
       more — no door opens during a fight, full stop — so a fight that cannot
       be reached is ENDED instead of forced.

       Any active monster with no door-free route to a living hero loses
       interest and goes back to sleep. heroDecideTarget only ever targets
       active monsters, so combat lapses on its own a frame later, and the
       moment it does the doors resume opening normally on approach. The party
       walks up, the gate swings, the fight starts again on its own terms —
       with one room in it. */
    let disengaged = 0;
    for (const m of this.monsters) {
      if (!m.active || m.data.hp <= 0) continue;
      if (this._shutGateIsTheOnlyThingBetween(m)) {
        m.active = false;
        m._threat = null;
        disengaged++;
      }
    }
    /* Repath everyone regardless — a stall can also be two bodies wedged in a
       corridor, which clearing paths alone shakes loose. */
    for (const m of this.monsters) {
      if (typeof this.clearEntityPath === 'function') this.clearEntityPath(m);
      else { m.path = null; m.pathI = 0; }
      m.repathT = 0;
    }
    for (const h of this.heroes)   {
      if (typeof this.clearEntityPath === 'function') this.clearEntityPath(h);
      else { h.path = null; h.pathI = 0; }
      h.repathT = 0;
    }
    if (disengaged) {
      log(`\u{1F6AA} ${disengaged === 1 ? 'An enemy loses' : 'Enemies lose'} track of the party behind a shut door.`, 'sys');
    }
  }

  /* ============ main update ============ */
  update(dt, elapsed) {
    this.elapsed = elapsed;
    /* Options → Combat playback speed: scale the whole combat clock (movement,
       attack lunges, sprite animation frames, projectiles, VFX, float text,
       initiative pacing, cooldowns) uniformly while a fight is active. Read each
       frame so a mid-fight slider change applies instantly. Exploration and the
       camp rest animation run at full speed. */
    /* Kept unscaled for the few things that are fixed-length CINEMATICS rather
       than combat pacing — the initiative roll-off is budgeted in real seconds,
       so "2.5s" means 2.5s regardless of where the speed slider sits. */
    this.rawDt = dt;
    if (this.combat) {
      const cs = getSetting('combatSpeed');
      if (typeof cs === 'number' && cs > 0 && cs !== 1) dt *= cs;
    }
    window.__elapsedTime = elapsed;
    window.__effectClock = this.fxNow;   // combat clock — status-tray countdowns
    /* Presentation clock — drives turn pacing. Ticked with the same combat-speed
       scaled dt as the effects below, so the Options speed slider scales how long
       the game dwells on a result exactly as it scales the animation itself. */
    tickFxClock(dt);
    updateFloatTexts(this.engine.scene, dt);
    updateProjectiles(this.engine.scene, dt);
    /* Deferred melee impacts — same scaled dt as the projectiles above, so a
       delayed blow lands in step with the animation that earned it. */
    this.tickPendingImpacts(dt);
    updateWorldFx(this.engine.scene, dt);
    updateCompositeFX(this.engine.scene, dt);
    updateEntityStatusAuras([...(this.heroes || []), ...(this.monsters || [])], dt);
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

    const alive = this.heroes.filter(h => h.data.hp > 0);

    if (alive.length === 0) {
      if (!this._deathChoiceOpen) this._showDeathChoice();
    } else {
      this.wipeT = 0;
      if (this._deathChoiceOpen) this._hideDeathChoiceScreen();
    }

    if (alive.length === 0) {
      /* fall through to visual loop so death animations keep playing */
    } else if (this.bossCutscene) {
      /* Boss intro cinematic. Replaces the simulation for its duration — the
         crawl is frozen — but deliberately falls through to the visual loop
         below, so the boss it is introducing can animate on camera. Ticked on
         rawDt: a fixed-length cinematic, not combat pacing. */
      updateBossCutscene(this, this.rawDt);
    } else {

    const leader = this.partyLeader(alive);

    for (const h of alive) {
      let c = this.cellOf(h.x, h.z);
      /* The watchdog asks "is this body somewhere it could legally be", and for
         a flyer a pool IS such a place. Testing FLOOR alone made it fire on
         every hovering familiar the instant its centre crossed the water's
         edge: it teleported the body back to dry land and cleared its path, so
         the familiar re-planned the same crossing and got yanked out again —
         a flyer visibly bouncing off water it was entitled to cross. */
      if (c < 0 || !isGroundFor(this.D.grid, c, canFly(h))) {
        /* Out-of-bounds watchdog: immediately rescue hero back onto walkable floor */
        const safeCell = this.nearFloorCell(c >= 0 ? c : 0, 50);
        if (safeCell >= 0) {
          const sx = this.wx(safeCell % this.D.W);
          const sz = this.wz(Math.floor(safeCell / this.D.W));
          h.x = sx; h.z = sz;
          if (h.ent && h.ent.grp) h.ent.grp.position.set(sx, groundYAt(this.D, sx, sz), sz);
          if (typeof this.clearEntityPath === 'function') this.clearEntityPath(h);
          c = safeCell;
          log(`⚠️ Relocated ${h.data.name} back inside the dungeon.`, 'sys');
        }
      }
      if (c >= 0) {
        this.revealAround(c, REVEAL_RADIUS);
        if (c !== h.lastCell) {
          h.lastCell = c;
          this._fovDirty = true;
          const rid = this.D.roomId[c];
          if (rid >= 0) this.visitRoom(rid);
        }
      }
    }

    /* Field of view. Recomputed when a hero changes cell (or a door finishes
       opening) rather than every frame — sight only changes when someone moves
       or something between them opens — and it repaints only when the visible
       set actually moved, which walking through already-known rooms does not
       do. revealAround above stays as it was: inside a room you have entered,
       everything is known, and this pass exists for the ones you have not. */
    if (this._fovDirty) {
      this._fovDirty = false;
      if (this.updateVisionField(alive, SIGHT_RADIUS)) this.recalculateFog(this);
    }

    const lc = this.cellOf(leader.x, leader.z);
    if (lc >= 0 && (this.leaderTrail.length === 0 || this.leaderTrail[0] !== lc)) {
      this.leaderTrail.unshift(lc);
      if (this.leaderTrail.length > 50) this.leaderTrail.pop();
    }

    /* Boss intro cinematic — armed here, after the movement loop above has
       marked the boss room visited but before initiative or combat can engage,
       so the scene opens on a room nobody is fighting in yet. It takes over
       from the next frame via the `bossCutscene` branch of this method. */
    checkBossCutscene(this);

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
      setBodyFlag('dc-in-combat', true);    // sword cursor up (ui_kit.css)
      for (const h of alive) this.subclassCombatStart(h, alive);
      this.applyInspiringLeader(alive);   // feat: party-wide temp HP
      const lc = this.cellOf(leader.x, leader.z);
      this.combatRoomId = (lc >= 0 && this.D.roomId) ? this.D.roomId[lc] : -1;
      logRoomSpawnDebug(this, this.combatRoomId);   // console roster + budget readout
      layoutHud();   // swap the quest box out for the initiative tracker
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
      setBodyFlag('dc-in-combat', false);   // sword cursor down
      this.combatRoomId = null;
      this._combatEngagedAt = null;  // reset combat pacing timer
      this.recalculateFog(this);     // re-snuff frontier rooms
      for (const h of alive) {
        h._foughtThisCombat = false; // First Strike perk
        h.uncannyUsed = false;       // Uncanny Dodge once per fight
      }
      updatePartyFrames(this.heroes.map(x => x.data));
      layoutHud();   // bring the quest box back
    }

    /* Doors keep working during a fight — see updateDoors. Suspending them
       mid-combat is what wedged heroes against a gate they were never allowed
       to open. The stall watchdog stays on as the last resort. */
    this.updateDoors(dt);
    if (this.combat) this._combatStallWatch(dt);
    else this._stallT = 0;

    if (!this.combat) {
      if (this.campAnim) {
        this.updateCampAnimation(dt);
      } else {
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
          if (typeof this.placeAtFreeCell === 'function') {
            this.placeAtFreeCell(h, leader.x, leader.z, { radius: 2 });
          } else {
            h.x = leader.x + (Math.random() - 0.5); h.z = leader.z + (Math.random() - 0.5);
          }
          log(`${h.data.name} staggers back to their feet.`, 'heal');
          drawBar(h.ent.bar, h.data.hp / h.data.maxHp);
        }
        this.checkInteractables(alive);
        this.updateSearch(dt, alive, leader);
        /* Warlocks recover a spell slot once a room's monsters are all dead */
        this.refreshSlotsOnRoomClear();
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

    }

    if (!this.campAnim && !this.bossCutscene) {
      this.reapReservations();
      /* Snap first, then un-stack: settling a body onto its tile centre can put
         two of them on the same point, so the overlap resolver has to run last. */
      this.snapStationaryToTiles(alive, dt);
      this.resolveRestingOverlaps();
    }

    /* visuals: position, bob, attack lunge */
    const cx = this.engine.cam.position.x - this.engine.camTarget.x;
    const cz = this.engine.cam.position.z - this.engine.camTarget.z;
    const camAngle = Math.atan2(cx, cz);
    const cosC = Math.cos(camAngle), sinC = Math.sin(camAngle);

    for (const h of this.heroes) {
      if (!this.campAnim) {
        const [ox, oz] = this.lungeOffset(h, dt);
        const gp = h.ent.grp.position;
        gp.set(h.x + ox,
               easeBodyY(gp.y, groundYAt(this.D, h.x + ox, h.z + oz), dt),
               h.z + oz);
        const visSrc = (h.lungeT > 0) ? 'lunge' : ((h.knockT > 0) ? 'knockback' : 'sprite');
        Motion.visual(this, h, h.x + ox, h.z + oz, visSrc);
      }

      /* Visual scale: enlarged status effect increases sprite size by 50% */
      if (h.ent && h.ent.grp && !this.campAnim) {
        const isEnlarged = hasEffect(h, 'enlarged') || hasEffect(h.data, 'enlarged');
        const targetScale = isEnlarged ? 1.5 : 1.0;
        const currentScale = h.ent.grp.scale.x || 1.0;
        if (Math.abs(currentScale - targetScale) > 0.005) {
          const newScale = currentScale + (targetScale - currentScale) * Math.min(1.0, dt * 8.0);
          h.ent.grp.scale.set(newScale, newScale, newScale);
        } else if (currentScale !== targetScale) {
          h.ent.grp.scale.set(targetScale, targetScale, targetScale);
        }
      }

      if (h.data.hp <= 0) {
        if (h.companion) {
          if (h._deathAnim && h.ent && h.ent.anim && h.ent.anim.mesh) {
            const a = h._deathAnim;
            const mesh = h.ent.anim.mesh;
            const mat = mesh.material;
            a.t += dt;
            const k = Math.min(1.0, a.t / a.dur);

            // 1. Topple rotation onto the floor (t: 0 -> 0.25s) with smooth ease-out
            const toppleK = Math.min(1.0, a.t / 0.25);
            const toppleFrac = 1.0 - Math.pow(1.0 - toppleK, 2);

            if (mat) {
              mat.rotation = a.targetRot * toppleFrac;
            }

            // 2. Foreshorten vertical scale slightly
            const currentScaleY = a.baseScaleY * (1.0 - toppleFrac * 0.35);
            mesh.scale.set(a.baseScaleX, currentScaleY, 1.0);

            // 3. Impact smoke / dust burst
            if (a.t >= 0.20 && !a.poppedBurst) {
              a.poppedBurst = true;
              if (typeof this.fxImpactBurst === 'function') {
                this.fxImpactBurst({ x: h.x, y: 0.05, z: h.z }, 'dark', '#888899', 6);
              }
            }

            // 4. Fade opacity (t: 0.25s -> dur)
            if (mat) {
              if (a.t > 0.25) {
                const fadeK = (a.t - 0.25) / Math.max(0.01, a.dur - 0.25);
                mat.opacity = Math.max(0.0, 1.0 - fadeK);
              } else {
                mat.opacity = 1.0;
              }
            }

            // 5. Complete death animation: remove from scene, dismiss companion from heroes array
            if (k >= 1.0) {
              if (h.ent.grp) {
                h.ent.grp.visible = false;
                if (h.ent.grp.parent) h.ent.grp.parent.remove(h.ent.grp);
              }
              if (mat) {
                mat.opacity = 1.0;
                mat.rotation = 0;
              }
              mesh.scale.set(a.baseScaleX, a.baseScaleY, 1.0);
              h._deathAnim = null;
              if (this.summons && typeof this.summons.dismiss === 'function') {
                this.summons.dismiss(h);
              }
            }
          } else if (!h._deathAnim) {
            if (this.killCompanion) this.killCompanion(h);
          }
          continue;
        }

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
        if (h.ent.anim && h.ent.anim.isPlayingAttack && h.ent.anim.isPlayingAttack()) {
          /* Full attack animation sequence is actively playing (wind-up / swing).
             Keep facing the attack target until the animation completes and returns to walk. */
          const tdx = h.attackTargetDX ?? h.lungeDX;
          const tdz = h.attackTargetDZ ?? h.lungeDZ;
          if (tdx != null && tdz != null) {
            const rdx = tdx * cosC - tdz * sinC;
            const rdz = tdx * sinC + tdz * cosC;
            h.ent.anim.setDirection(rdx, rdz);
          }
          h.ent.anim.mesh.position.y = 0;
        } else if (h.lungeT > 0) {
          /* Physical lunge offset is finishing at impact. Keep facing the target
             without restarting the attack animation. */
          const rdx = h.lungeDX * cosC - h.lungeDZ * sinC;
          const rdz = h.lungeDX * sinC + h.lungeDZ * cosC;
          h.ent.anim.setDirection(rdx, rdz);
          if (h.lungeT <= 0.02) h.castAnim = false;
        } else {
          h.castAnim = false;
          const pdx = h.x - (h._animPX ?? h.x);
          const pdz = h.z - (h._animPZ ?? h.z);
          const speed = Math.hypot(pdx, pdz) / Math.max(dt, 1e-4);
          if (h.moving || speed > MOVE_ANIM_SPEED_EPS) {
            h._walkHold = WALK_ANIM_HOLD;
          } else if (h._walkHold > 0) {
            h._walkHold -= dt;
          }
          /* A hero who has come to rest breathes on the LPC idle sheet instead
             of freezing on the walk cycle's standing frame. Gear that ships no
             idle art holds still inside that atlas (see loadState), so only the
             body and hair move.
             A frame-sliced animator (familiar, wild-shape form) usually has no
             walk sheet — its idle loop IS its resting AND moving animation — so
             it stays on 'walk', which play() no-ops, leaving the idle running.
             One that DOES ship a walk sheet (the ranger's war-wolf) is treated
             like an LPC hero instead: it walks while moving and drops to its
             idle when it comes to rest. */
          const sliced = h.ent.anim.anims;
          const standing = h._walkHold <= 0 && (!sliced || !!sliced.walk);
          h.ent.anim.play(standing ? 'idle' : 'walk');
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

    /* The cutscene owns the camera outright while it runs — the director's
       dwell timers and deadbands would fight a scripted move. */
    if (!this.bossCutscene && elapsed > this.freeCamUntil) this.updateCameraDirector(dt, alive);



    /* Expedition floors: exit portal tile */
    if (this.floorExit && !this.floorExit.entered) {
      this.updateFloorExit(dt, elapsed, alive);
    }

    /* Periodic autosave is a backstop, not the save system: every meaningful
       transition (floor change, shop, quest, rest, loot) saves explicitly. It
       ran every 5 s, which serialised the whole game state mid-fight for no
       gain — nothing that happens inside a combat is worth keeping until the
       combat resolves, and that is when the hitch is most visible. Now a
       minute between saves, never during initiative, plus a save when the tab
       is hidden or closed (see saveOnLeave at the bottom of this file). */
    this.saveTimer += dt;
    if (this.saveTimer > AUTOSAVE_INTERVAL_SEC && !(this.initiative && this.initiative.active)) {
      this.saveTimer = 0;
      this.saveGame();
      updatePartyFrames(this.heroes.map(x => x.data));
    }
  }

  /**
   * Automatic camera framing. The maths — weighted focus, screen-space fit,
   * yaw scoring — is in camera_director.js; this method's job is to decide WHO
   * gets framed and to hand the result to the renderer.
   *
   * Only runs when the player has not touched the camera for CAM_FREE_SECONDS
   * (the caller gates on `freeCamUntil`).
   */
  updateCameraDirector(dt, alive) {
    if (!this.engine || !this.engine.camTarget) return;

    /* WHO MUST STAY ON SCREEN: everyone standing, companions and summons
       included. They are bodies the player is invested in, and losing a
       familiar off the edge of frame is exactly as confusing as losing a hero. */
    const party = [];
    for (const h of this.heroes || []) {
      if (h && h.data && h.data.hp > 0) party.push({ x: h.x, z: h.z });
    }
    if (!party.length) return;

    /* WHO IS WORTH LOOKING AT: engaged, alive, and already visible. Framing a
       monster the fog has not revealed would pull the view back to make room
       for something the player cannot see — and announce that it is there. */
    const foes = [];
    const autoFrame = getSetting('cameraAutoFrame') !== false;
    if (this.combat && autoFrame) {
      for (const m of this.monsters || []) {
        if (!m || !m.active || !m.data || m.data.hp <= 0) continue;
        if (m.ent && m.ent.grp && m.ent.grp.visible === false) continue;
        foes.push({ x: m.x, z: m.z });
      }
    }

    /* WHERE THE FRAME IS CENTRED. Out of combat it stays on the leader, as it
       always has: the party strings out behind them down a corridor, and a
       centroid would leave the hero being steered at the edge of the screen.
       In combat the centre is the party's (companions excluded, per
       partyCentroid) pulled 30% toward the hostiles. */
    const leader = this.partyLeader(alive);
    const core = partyCentroid(this.heroes);

    /* Determine active combat action & target */
    let actionObj = null;
    const autoActionZoom = getSetting('cameraActionZoom') !== false;
    const autoActionRotate = getSetting('cameraActionRotate') !== false;

    if (this.combat) {
      let activeHero = null;
      let activeFoe = null;
      let isLungeOrCast = false;

      // Check 1: Any hero or monster actively lunging or casting this frame
      for (const h of (this.heroes || [])) {
        if (h && h.data && h.data.hp > 0 && (h.lungeT > 0 || h.castAnim)) {
          activeHero = h;
          activeFoe = h.target || h._pendingAttackTarget || h._lastTarget;
          isLungeOrCast = true;
          break;
        }
      }
      if (!activeHero) {
        for (const m of (this.monsters || [])) {
          if (m && m.active && m.data && m.data.hp > 0 && (m.lungeT > 0 || m.castAnim)) {
            activeFoe = m;
            activeHero = m.target || m._lastTarget;
            isLungeOrCast = true;
            break;
          }
        }
      }

      // Check 2: Initiative current actor
      const inInitiative = !!(this.initiative && this.initiative.active);
      const curActor = inInitiative ? this._currentActor() : null;
      if (!activeHero && !activeFoe && curActor) {
        if (curActor._side === 'hero' || (this.heroes && this.heroes.includes(curActor))) {
          activeHero = curActor;
          activeFoe = curActor.target || curActor._pendingAttackTarget || curActor._lastTarget;
        } else {
          activeFoe = curActor;
          activeHero = curActor.target || curActor._lastTarget;
        }
      }

      // Check 3: Active targeting states
      if (this.attackTargetingState && this.attackTargetingState.active) {
        activeHero = activeHero || this.attackTargetingState.hero;
        activeFoe = this.attackTargetingState.target || activeFoe;
      } else if (this.spellTargetingState && this.spellTargetingState.active) {
        activeHero = activeHero || this.spellTargetingState.hero;
        activeFoe = this.spellTargetingState.target || activeFoe;
      }

      // Fallback: If one is found but not the other, find closest opposite
      if (activeHero && !activeFoe && foes.length) {
        let minD = Infinity;
        for (const f of foes) {
          const d = Math.hypot(f.x - activeHero.x, f.z - activeHero.z);
          if (d < minD) { minD = d; activeFoe = f; }
        }
      } else if (activeFoe && !activeHero && party.length) {
        let minD = Infinity;
        for (const p of party) {
          const d = Math.hypot(p.x - activeFoe.x, p.z - activeFoe.z);
          if (d < minD) { minD = d; activeHero = p; }
        }
      }

      // Fallback: If neither found, pick the closest hero-monster pair in the room
      if (!activeHero && !activeFoe && party.length && foes.length) {
        let minD = Infinity;
        for (const p of party) {
          for (const f of foes) {
            const d = Math.hypot(p.x - f.x, p.z - f.z);
            if (d < minD) {
              minD = d;
              activeHero = p;
              activeFoe = f;
            }
          }
        }
      }

      /* Subject hold to prevent rapid jitter between candidates */
      const now = this.elapsed || 0;
      if (isLungeOrCast && activeHero) {
        this._camDir.subject = { actor: activeHero, target: activeFoe };
        this._camDir.subjectUntil = now + 1.4;
      } else if (this._camDir.subject && now < (this._camDir.subjectUntil || 0)) {
        const s = this._camDir.subject;
        const actAlive = !s.actor || (s.actor.data ? s.actor.data.hp > 0 : true);
        const tgtAlive = !s.target || (s.target.data ? s.target.data.hp > 0 : true);
        if (actAlive && tgtAlive) {
          activeHero = s.actor;
          activeFoe = s.target;
        } else {
          this._camDir.subject = null;
        }
      } else if (activeHero) {
        this._camDir.subject = { actor: activeHero, target: activeFoe };
        this._camDir.subjectUntil = now + 1.0;
      }

      /* Calculate action intensity based on fx_clock state and activity */
      const fx = typeof fxClockState === 'function' ? fxClockState() : { waiting: 0, beat: null };
      let targetIntensity = 0;
      if (isLungeOrCast) {
        targetIntensity = 1.0;
      } else if (fx.waiting > 0) {
        if (fx.beat === 'major') targetIntensity = 1.0;
        else if (fx.beat === 'notable') targetIntensity = 0.9;
        else targetIntensity = 0.7;
      } else if (curActor || activeHero || activeFoe) {
        targetIntensity = 0.55;
      }

      /* Smooth intensity transition */
      this._camDir.intensity = this._camDir.intensity || 0;
      const rate = targetIntensity > this._camDir.intensity ? 6.0 : 2.0;
      this._camDir.intensity += (targetIntensity - this._camDir.intensity) * Math.min(1, dt * rate);

      const actorEnt = activeHero || curActor;
      const targetEnt = activeFoe;
      if (actorEnt && this._camDir.intensity > 0.01) {
        actionObj = {
          actor: { x: actorEnt.x, z: actorEnt.z },
          target: targetEnt ? { x: targetEnt.x, z: targetEnt.z } : null,
          intensity: this._camDir.intensity
        };
      }
    } else if (this._camDir.intensity) {
      this._camDir.intensity = Math.max(0, this._camDir.intensity - dt * 3.0);
      this._camDir.subject = null;
    }

    /* WHERE THE FRAME IS CENTRED.
       In combat with an active clash: dynamically center heavily on the action epicenter.
       Out of combat: stays on the leader. */
    let focus = null;
    if (this.combat && actionObj && actionObj.intensity > 0.05 && (actionObj.actor || actionObj.target)) {
      const epic = actionEpicenter(actionObj.actor, actionObj.target);
      const tactical = core ? weightedFocus([core], foes) : (leader ? { x: leader.x, z: leader.z } : epic);
      const w = 0.35 + 0.55 * Math.min(1, actionObj.intensity);
      const blended = blendFocus(tactical, epic, w);
      focus = clampPull(centroid(party), blended, party, {
        aspect: cam.top > 0 ? cam.right / cam.top : 16 / 9,
        baseHalf: BASE_HALF, yaw: camYaw, pitch: camPitch,
        margin: CAM_ACTION_MARGIN,
        budgetZoom: Math.min(CAM_FIT_FLOOR_ZOOM, userZoom, MAX_CAM_ZOOM)
      });
    } else if (this.combat) {
      if (core) focus = weightedFocus([core], foes);
    } else if (leader) {
      focus = { x: leader.x, z: leader.z };
    } else if (core) {
      focus = core;
    }

    /* Occlusion probe for the yaw scorer: walls, plus the props already
       classified as sight-blocking for the fog's field of view. */
    const D = this.D;
    const isBlocked = (D && D.grid && typeof this.cellOf === 'function')
      ? (x, z) => {
          const c = this.cellOf(x, z);
          if (c < 0) return false;          // off the map: empty, not occluding
          if (D.grid[c] === WALL) return true;
          return !!(D.sightBlockers && D.sightBlockers[c]);
        }
      : null;

    const out = driveCamera(this._camDir, {
      party, foes, focus,
      entities: party.concat(foes),
      action: actionObj,
      actionZoom: autoFrame && autoActionZoom,
      targetX: this.engine.camTarget.x, targetZ: this.engine.camTarget.z,
      zoom: cam.zoom, restZoom: userZoom,
      restPitch: userPitch,
      aspect: cam.top > 0 ? cam.right / cam.top : 16 / 9,
      baseHalf: BASE_HALF, minZoom: MIN_CAM_ZOOM, maxZoom: MAX_CAM_ZOOM,
      yaw: camYaw, pitch: camPitch,
      autoRotate: (!!getSetting('cameraAutoRotate') && isBlocked != null && !D?.overland)
                  || (autoActionRotate && this.combat && !D?.overland),
      isBlocked
    }, dt);
    if (!out) return;

    this.engine.camTarget.set(out.x, 0, out.z);
    if (autoFrame) setCamZoom(out.zoom);
    if (Math.abs(out.yaw - camYaw) > 1e-4 || Math.abs(out.pitch - camPitch) > 1e-4) {
      setYawPitch(out.yaw, out.pitch);
    } else {
      this.engine.updateCam();
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
        const scaleBoost = 1.24 + Math.sin((this.elapsed || 0) * 2.5) * 0.06;
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
        const scaleBoost = 1.24 + Math.sin((this.elapsed || 0) * 2.5) * 0.06;
        th.spr.scale.set(scaleBoost, scaleBoost * 1.12, 1.0);
      }
    }
  }

  /* ============ shrine camp rest animation ============ */
  beginCampAnimation(sx, sz, heroes) {
    /* Summoned companions (wolf, familiar) don't pitch tents — the camp is
       the party's, they just settle wherever they are. */
    heroes = heroes.filter(h => !h.companion);
    if (this.campAnim || !heroes.length) return;

    const campX = sx, campZ = sz;
    const N = heroes.length;
    const R = 1.5; // 50% larger diameter circle around the fire

    const tents = heroes.map((h, i) => {
      const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
      let targetX = campX + Math.cos(angle) * R;
      let targetZ = campZ + Math.sin(angle) * R;

      // Ensure target position doesn't push into a wall if campfire is near edge
      if (this.D && this.D.grid) {
        const cell = typeof this.cellOf === 'function' ? this.cellOf(targetX, targetZ) : -1;
        if (cell >= 0 && this.D.grid[cell] === WALL) {
          targetX = campX + Math.cos(angle) * 1.1;
          targetZ = campZ + Math.sin(angle) * 1.1;
        }
      }

      const startX = h.x !== undefined ? h.x : campX;
      const startZ = h.z !== undefined ? h.z : campZ;

      const dir = getTentFacingDir(targetX, targetZ, campX, campZ, cam);
      const tent = createTentSprite(dir);
      tent.position.set(targetX, groundYAt(this.D, targetX, targetZ), targetZ);
      tent.scale.set(1.6, 1.6, 1);
      tent.visible = false;
      this.gameGroup.add(tent);

      return {
        sprite: tent,
        hero: h,
        startX,
        startZ,
        targetX,
        targetZ,
        currentDir: dir
      };
    });

    this.campAnim = {
      phase: 0,
      timer: 0,
      tents,
      campX,
      campZ
    };

    log('⛺ The party gathers around the warm campfire to rest.', 'heal');
  }

  updateCampAnimation(dt) {
    if (!this.campAnim) return false;
    const a = this.campAnim;
    a.timer += dt;
    const t = a.timer;

    // Dynamically update tent facing perspectives based on camera orbit angle
    for (const tk of a.tents) {
      const newDir = getTentFacingDir(tk.targetX, tk.targetZ, a.campX, a.campZ, cam);
      if (tk.currentDir !== newDir) {
        tk.currentDir = newDir;
        tk.sprite.material = getTentMaterial(newDir);
      }
    }

    // Stage 1 (0 to 1.8s): Party smoothly walks to their spots in the campfire circle
    if (t < 1.8) {
      const p = Math.min(1, t / 1.8);
      const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p; // smooth walking
      for (const tk of a.tents) {
        const curX = tk.startX + (tk.targetX - tk.startX) * ease;
        const curZ = tk.startZ + (tk.targetZ - tk.startZ) * ease;
        tk.hero.x = curX;
        tk.hero.z = curZ;
        if (tk.hero.ent && tk.hero.ent.grp) {
          tk.hero.ent.grp.position.set(curX, groundYAt(this.D, curX, curZ), curZ);
          tk.hero.ent.grp.visible = true;
          tk.hero.ent.grp.scale.setScalar(1);
          if (tk.hero.ent.anim) {
            if (typeof tk.hero.ent.anim.setDirection === 'function') {
              tk.hero.ent.anim.setDirection(tk.targetX - tk.startX, tk.targetZ - tk.startZ);
            }
            if (typeof tk.hero.ent.anim.play === 'function') {
              tk.hero.ent.anim.play('walk');
            }
          }
        }
        tk.hero.walk = true;
        tk.hero.moving = true;
        tk.sprite.visible = false;
      }
    }
    // Stage 2 (1.8s to 2.5s): Heroes stand gathered in a circle facing the warm crackling fire
    else if (t < 2.5) {
      for (const tk of a.tents) {
        tk.hero.walk = false;
        tk.hero.moving = false;
        tk.hero.x = tk.targetX;
        tk.hero.z = tk.targetZ;
        if (tk.hero.ent && tk.hero.ent.grp) {
          tk.hero.ent.grp.position.set(tk.targetX, groundYAt(this.D, tk.targetX, tk.targetZ), tk.targetZ);
          tk.hero.ent.grp.visible = true;
          tk.hero.ent.grp.scale.setScalar(1);
          if (tk.hero.ent.anim && typeof tk.hero.ent.anim.setDirection === 'function') {
            tk.hero.ent.anim.setDirection(a.campX - tk.targetX, a.campZ - tk.targetZ);
          }
        }
        tk.sprite.visible = false;
      }
    }
    // Stage 3 (2.5s to 7.5s): Instantaneous tent pitch, 5-second cozy tent rest
    else if (t < 7.5) {
      for (const tk of a.tents) {
        tk.hero.walk = false;
        tk.hero.moving = false;
        tk.hero.x = tk.targetX;
        tk.hero.z = tk.targetZ;
        if (tk.hero.ent && tk.hero.ent.grp) {
          tk.hero.ent.grp.position.set(tk.targetX, groundYAt(this.D, tk.targetX, tk.targetZ), tk.targetZ);
          tk.hero.ent.grp.scale.setScalar(1);
          tk.hero.ent.grp.visible = false; // Inside tent
        }
        tk.sprite.visible = true;
        tk.sprite.scale.set(1.6, 1.6, 1);
      }
    }
    // Stage 4 (7.5s to 8.0s): Tents pack up, party emerges fully refreshed
    else if (t < 8.0) {
      for (const tk of a.tents) {
        if (tk.hero.ent && tk.hero.ent.grp) {
          tk.hero.ent.grp.position.set(tk.targetX, groundYAt(this.D, tk.targetX, tk.targetZ), tk.targetZ);
          tk.hero.ent.grp.visible = true;
          tk.hero.ent.grp.scale.setScalar(1);
        }
        tk.sprite.visible = false;
      }
    }
    // Finished
    else {
      this.applyCampRest();
      return false;
    }
    return true;
  }

  extinguishCampfire(x, z, radius = 2.5) {
    if (typeof extinguishCampfire === 'function') {
      extinguishCampfire(x, z, radius);
    }
  }

  /* Swing a chest lid open in the scene; returns the clip length (0 if none).
     Game-side wrapper so chest_loot.js needs no scene import — the render
     modules build canvas textures at import time, which the headless tests
     that pull in explore.js cannot provide. */
  openChest(x, z, radius = 2.5) {
    return (typeof openChest === 'function') ? openChest(x, z, radius) : 0;
  }

  applyCampRest() {
    if (!this.campAnim) return;
    const a = this.campAnim;

    for (const tk of a.tents) {
      this.gameGroup.remove(tk.sprite);
      if (tk.hero.ent && tk.hero.ent.grp) {
        tk.hero.ent.grp.visible = true;
        tk.hero.ent.grp.scale.setScalar(1);
        tk.hero.ent.grp.position.set(tk.targetX, groundYAt(this.D, tk.targetX, tk.targetZ), tk.targetZ);
      }
      tk.hero.x = tk.targetX;
      tk.hero.z = tk.targetZ;
      tk.hero.walk = false;
      tk.hero.moving = false;
    }

    // Extinguish 3D campfire in the dungeon scene
    this.extinguishCampfire(a.campX, a.campZ);
    if (this.shrines) {
      for (const s of this.shrines) {
        const sx = this.wx(s.x), sz = this.wz(s.y);
        if (Math.hypot(sx - a.campX, sz - a.campZ) < 2.5) {
          s.used = true;
          s.extinguished = true;
        }
      }
    }

    this.campAnim = null;
    log('💨 The campfire is extinguished as the well-rested party sets out.', 'sys');
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
      /* One unit per chosen cell — a stack of ten scrolls loses one, not ten.
         Descending index order keeps the remaining indices valid. */
      for (const k of losers) takeFromInventory(this.inventory, this.inventory[k], 1);
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
      /* Distinct entrance-adjacent cells, never half-cell offsets. */
      const offsets = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
      const ox = offsets[i % offsets.length][0];
      const oy = offsets[i % offsets.length][1];
      const px = Math.max(1, Math.min(W - 2, (ea % W) + ox));
      const py = Math.max(1, Math.min(this.D.H - 2, Math.floor(ea / W) + oy));
      if (typeof this.placeAtFreeCell === 'function') {
        this.placeAtFreeCell(h, this.wx(px), this.wz(py), { radius: 2 });
      } else {
        h.x = this.wx(px) + (i % 2 === 0 ? -0.5 : 0.5);
        h.z = this.wz(Math.floor(ea / W)) + (i < 2 ? -0.5 : 0.5);
      }
      this.clearEntityPath(h);
      h.ent.grp.rotation.z = 0;
      h.ent.grp.rotation.x = 0;
      h.ent.anim.mesh.position.y = 0;
      h._dyingStarted = false;
      h._deathLean = 0;
      h.ent.anim._dying = false;
      h.ent.anim._deathDone = false;
      h.ent.anim.play('walk');
    });

    /* Full recharge (abilities / slots / effects) — HP already set above. */
    partyLongRest(this, { reason: 'death respawn' });

    for (const m of this.monsters) {
      m.active = false;
      if (typeof this.clearEntityPath === 'function') this.clearEntityPath(m);
      else m.path = null;
    }
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
      addToInventory(this.inventory, q.rewardItem);
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
        const exitCell = fx.y * this.D.W + fx.x;
        const exitTarget = typeof this.nearFloorCell === 'function' ? this.nearFloorCell(exitCell, 2) : exitCell;
        this.userGoal = exitTarget >= 0 ? exitTarget : exitCell;
        this.targetRoom = fx.roomId;
      }
      return;
    }

    if (this._exitIndicator) updateExitIndicator(this._exitIndicator, 1, true, elapsed);

    /* keep steering there in case the explore AI wanders off */
    if (this.targetRoom !== fx.roomId) {
      const exitCell = fx.y * this.D.W + fx.x;
      const exitTarget = typeof this.nearFloorCell === 'function' ? this.nearFloorCell(exitCell, 2) : exitCell;
      this.userGoal = exitTarget >= 0 ? exitTarget : exitCell;
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
    /* Any camera input — drag, orbit or wheel — parks the director for
       CAM_FREE_SECONDS. Three seconds is short enough that letting go of the
       mouse hands the framing back promptly, and long enough that a series of
       small adjustments is not fought for the whole time you are making it. */
    this.freeCamUntil = this.elapsed + CAM_FREE_SECONDS;
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
  turnEngineMethods,
  reservationMethods
);

export const game = new Game();
if (typeof window !== 'undefined') {
  window.__game = game;
  installGlobalErrorHandlers(window);
  /* The autosave now runs a minute apart and never mid-combat, so the tab
     being hidden or closed is the save that matters. `pagehide` fires on
     close, reload and navigation in every browser; `visibilitychange` covers
     switching tabs on mobile, where pagehide may never come. Only while a run
     is actually in progress — there is nothing to write from the title. */
  const saveOnLeave = () => {
    if (game.state === 'boot' || !game.heroes || !game.heroes.length) return;
    try { game.saveGame(); } catch (e) { /* the quota path already logged */ }
  };
  if (typeof window.addEventListener === 'function') window.addEventListener('pagehide', saveOnLeave);
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveOnLeave(); });
  }
  /* AI decision trace — off by default, costs nothing until switched on.
     In the console:  __aiTrace(true)  then  __aiTraceDump() / __aiTraceIdle()
     With __aiTraceLog(true) the reasoning is echoed straight into the combat
     log, so a fight can be watched without opening devtools. */
  installTraceConsole();
  installMotionConsole();
  /* Replay the boss intro cinematic on demand, so the shot can be judged
     without walking a party back down to the boss room every time.
     In the console:  __bossCutscene()
     Works on any floor that has a living boss; the encounter's own `cutscene`
     block is used when it has one, otherwise a bare default is synthesised so
     the camera move alone can be reviewed. */
  window.__bossCutscene = () => {
    if (!game.boss || !game.boss.data || game.boss.data.hp <= 0) return 'no living boss on this floor';
    if (game.bossCutscene) return 'already playing';
    const cut = (game.bossEncounterUsed && game.bossEncounterUsed.cutscene) || {};
    beginBossCutscene(game, cut);
    return 'rolling';
  };
  window.__aiTraceLog = (v = true) => {
    Trace.enable(true);
    Trace.sink = v
      ? (e, event, why) => game.fxLog(`🧠 ${(e.data && e.data.name) || '?'} — ${event}: ${why}`, 'sys')
      : null;
    return `AI reasoning in combat log: ${v ? 'ON' : 'OFF'}`;
  };
}
