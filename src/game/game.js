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
  makeHero, normalizeHero, spawnMonster, MONSTER_THEMES, DUNGEON_MONSTER_MAP, grantXp
} from './srd.js';
import {
  makeHeroMesh, makeMonsterMesh, drawBar, updateFloatTexts,
  updateFlash, updateProjectiles, updateWorldFx, clearEffects,
  updateStatusTray
} from './entities.js';
import { log, buildPartyFrames, updatePartyFrames, updateResources, showBanner, showSetup, initGameLog } from './ui.js';
import { initMenus, refreshMenus } from './menus.js';
import { initShop, showShop } from './shop.js';
import { initWorldMap, showWorldMap } from './worldmap.js';
import { initSkills, checkForChallenge, resetChallengeState, fireCampChallenge, checkRoomEntryChallenge } from './skills.js';
import { initChestWheel } from './chest_wheel.js';
import {
  initQuestEvents, normalizeQuest, resolveFloorPhase, phaseNeedsChoice, offerFloorChoice,
  applyPhaseToSpawns, announceFloor, spawnAlly, dismissAlly, placeGems,
  checkPuzzleGate, onFloorCleared, onQuestCompleted, updateQuestTracker
} from './quest_events.js';
import { GAUNTLET_DESCEND } from './quest_story.js';
import { partyLongRest, partyShortRest } from './rest.js';
import { initAudio, playSfx } from './audio.js';

import { THEME_ORDER, REVEAL_RADIUS, FLOOR } from './constants.js';
import { _v } from './shared.js';
import { buildWallAdj, buildChokepoints, pathfindingMethods } from './pathfinding.js';
import { buildFogMaps, fogMethods } from './fog.js';
import { combatMethods } from './combat.js';
import { monsterAiMethods } from './monster_ai.js';
import { exploreMethods } from './explore.js';
import { inventoryMethods } from './inventory.js';
import { initiativeMethods } from './initiative.js';

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

function createTentSprite() {
  const cv = document.createElement('canvas');
  cv.width = 48; cv.height = 48;
  const ctx = cv.getContext('2d');

  ctx.fillStyle = '#8b6914';
  ctx.beginPath();
  ctx.moveTo(24, 6);
  ctx.lineTo(6, 44);
  ctx.lineTo(42, 44);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#4a3208';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#3a2204';
  ctx.beginPath();
  ctx.moveTo(24, 18);
  ctx.lineTo(18, 44);
  ctx.lineTo(30, 44);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#4a3208';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(24, 18);
  ctx.lineTo(24, 44);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false });
  const sp = new THREE.Sprite(mat);
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
    this.monsters = [];
    this.chests = [];
    this.shrines = [];
    this.gold = 0;
    this.potions = { heal: 2, greater: 0 };
    this.inventory = [];
    this.dungeonLevel = 1;
    this.effectiveLevel = 1;
    this.activeQuest = null;
    this.questFloor = 0;
    this.questChains = { active: [], log: [] };
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
    this._wipeScreen = false;
    this._wipeTimer = 0;
    this._killStreak = 0;
    this._killStreakTimer = 0;
    this.storedHeroes = [];
    this.townShopInventory = [];
    this.townTavernHirePool = [];
    this.bestiary = {};  // { monsterId: killCount } — persists; unlocks compendium entries
    this._initReset();   // D&D initiative turn-order state
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
    const save = this.loadSave();
    showSetup(!!save,
      slots => {
        this.heroes = slots.map(s => ({ data: makeHero(s.name, s.raceKey, s.classKey, s.baseStats, s.visual) }));
        this.storedHeroes = [];
        this.townShopInventory = [];
        this.townTavernHirePool = [];
        this.gold = 0; this.potions = { heal: 2, greater: 0 }; this.inventory = []; this.dungeonLevel = 1;
        this.activeQuest = null; this.questFloor = 0;
        this.questChains = { active: [], log: [] };
        this.beginRun();
      },
      () => {
        this.heroes = save.heroes.map(h => ({ data: normalizeHero(h) }));
        this.storedHeroes = (save.storedHeroes || []).map(h => normalizeHero(h));
        this.townShopInventory = save.townShopInventory || [];
        this.townTavernHirePool = save.townTavernHirePool || [];
        this.gold = save.gold; this.potions = save.potions;
        this.bestiary = save.bestiary || {};
        this.inventory = save.inventory || [];
        this.dungeonLevel = save.dungeonLevel;
        this.activeQuest = normalizeQuest(save.activeQuest || null);
        this.questFloor = save.questFloor || 0;
        this.questChains = save.questChains || { active: [], log: [] };
        this.beginRun(true);
      });

    document.getElementById('potheal').addEventListener('click', () => this.drinkPotion('heal'));
    document.getElementById('potgreater').addEventListener('click', () => this.drinkPotion('greater'));
    /* potion hotkeys: 1 = heal, 2 = greater (ignore while typing).
       Auto-drinking is now per-hero via the AI Priorities tab (potionThreshold knob). */
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === '1') this.drinkPotion('heal');
      else if (e.key === '2') this.drinkPotion('greater');
    });
    initGameLog();
    initMenus(this);
    initShop(this);
    initWorldMap(this);
    initSkills(this);
    initChestWheel(this);
    initQuestEvents(this);
    this._createWipeScreen();
    initAudio();
  }

  beginRun(fromSave = false) {
    buildPartyFrames(this.heroes.map(h => h.data));
    updateResources(this);
    log(`A party of ${this.heroes.length} sets out. Good luck — they won't need your help. Mostly.`, 'sys');
    /* Resume mid-quest from save; otherwise pick a quest on the world map. */
    if (fromSave && this.activeQuest) {
      log(`Resuming quest: ${this.activeQuest.name} (floor ${this.questFloor}/${this.activeQuest.floors}).`, 'sys');
      this.nextDungeon(true);
    } else {
      this.state = 'worldmap';
      showWorldMap({ refresh: true });
    }
  }

  /** Embark on a world-map quest (called from worldmap.js). */
  startQuest(quest) {
    this.activeQuest = quest;
    this.questFloor = 1;
    this.dungeonLevel = Math.max(1, quest.level || 1);
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
    const roomCount = Math.min(70, 16 + lvl * 4);
    const themeKey = q?.theme || THEME_ORDER[(lvl - 1) % THEME_ORDER.length];
    /* Long rest is applied when a floor is cleared (finishDungeon).
       Here we only top up HP to at least half and clear combat-only state. */
    for (const h of this.heroes) {
      h.data.hp = Math.min(h.data.maxHp, Math.max(h.data.hp, Math.round(h.data.maxHp * 0.5)));
      h.raging = false;
      h.tempHp = 0;
      h.uncannyUsed = false;
      h._foughtThisCombat = false;
      h.phaseStepUntil = 0;
    }
    if (q) {
      log(`— ${q.name}: floor ${this.questFloor}/${q.floors} (depth ${lvl}) —`, 'sys');
    }
    this.engine.reforge(seed, roomCount, themeKey, false);
    if (!first) this.saveGame();
  }

  /* ============ dungeon load (called by engine forge) ============ */
  onDungeon(d) {
    if (this.state === 'boot') return;
    this.D = d;
    resetChallengeState(this); // fresh skill-challenge state per dungeon floor
    resolveFloorPhase(this);   // phase descriptor + puzzle/gem state for this floor
    const eng = this.engine;

    if (this.gameGroup) { eng.scene.remove(this.gameGroup); }
    clearEffects(eng.scene);
    this.gameGroup = new THREE.Group();
    eng.scene.add(this.gameGroup);

    const { W, H, grid, rooms } = d;
    this.wx = x => x - W / 2 + 0.5;
    this.wz = y => y - H / 2 + 0.5;
    this.cellOf = (x, z) => {
      const cx = Math.round(x + W / 2 - 0.5), cy = Math.round(z + H / 2 - 0.5);
      return (cx < 0 || cy < 0 || cx >= W || cy >= H) ? -1 : cy * W + cx;
    };

    d.wallAdj = buildWallAdj(grid, W, H);
    d.chokepoint = buildChokepoints(grid, W, H);

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
    /* dungeon-theme-aware monster selection: each visual theme maps to 2–3
       monster families (e.g. frost → beasts + undead).  Rooms pick
       deterministically from that subset instead of the global pool. */
    const themePool = d.themeKey && DUNGEON_MONSTER_MAP[d.themeKey]
      ? DUNGEON_MONSTER_MAP[d.themeKey] : [0, 1, 2, 3];
    const roomThemes = {};
    const roomLockedSpawns = {}; // roomId -> { [tier]: spec }
    const questInfo = {
      dungeonLevel: this.activeQuest ? this.activeQuest.level : this.dungeonLevel,
      questFloor: this.questFloor,
      floors: this.activeQuest ? this.activeQuest.floors : 10
    };

    for (const sp of d.spawns) {
      if (roomThemes[sp.roomId] === undefined) {
        const idx = themePool[sp.roomId % themePool.length];
        roomThemes[sp.roomId] = MONSTER_THEMES[idx];
        roomLockedSpawns[sp.roomId] = {};
      }
      const theme = roomThemes[sp.roomId];

      const D = questInfo.dungeonLevel + Math.max(0, questInfo.questFloor - 1) * 0.5;
      let targetTier = sp.tier;
      if (typeof targetTier === 'number') {
        let maxTier = 5;
        if (D < 2) maxTier = 1;
        else if (D < 3) maxTier = 2;
        else if (D < 4.5) maxTier = 3;
        else if (D < 6) maxTier = 4;
        targetTier = Math.min(targetTier, maxTier);
      }

      if (roomLockedSpawns[sp.roomId][targetTier] === undefined) {
        const allowedNames = theme ? theme.monsters[targetTier] : null;
        const spec = spawnMonster(targetTier, this.effectiveLevel, Math.random, allowedNames, questInfo);
        roomLockedSpawns[sp.roomId][targetTier] = spec;
      }
      const mSpec = roomLockedSpawns[sp.roomId][targetTier];
      const m = applyPhaseToSpawns(this, spawnMonster(targetTier, this.effectiveLevel, Math.random, [mSpec.id], questInfo));
      this.addMonster(m, sp.x, sp.y, sp.roomId);
    }
    /* Final floor fights the quest's pre-rolled boss (foreshadowing is truthful) */
    const q2 = this.activeQuest;
    const finalFloor = q2 && (this.questFloor | 0) >= (q2.floors | 0);
    const bossSpec = applyPhaseToSpawns(this, spawnMonster('boss', this.effectiveLevel, Math.random,
      finalFloor && q2.finalBossId ? [q2.finalBossId] : null, questInfo));
    const ba = this.roomAnchor[d.boss];
    this.addMonster(bossSpec, (ba % W) + 1, Math.floor(ba / W), d.boss, true);
    this.boss = this.monsters[this.monsters.length - 1];

    this.chests = d.props.filter(p => p.kind === 'chest').map(p => ({ x: p.x, y: p.y, roomId: p.roomId, looted: false }));
    this.shrines = d.props.filter(p => p.kind === 'shrineCrystal').map(p => ({ x: p.x, y: p.y, roomId: p.roomId, used: false }));
    placeGems(this);

    /* Ally-phase guest joins before placement so it gets a mesh like everyone */
    spawnAlly(this);

    const ea = this.roomAnchor[d.entrance];
    const ex = ea % W, ey = Math.floor(ea / W);
    this.heroes.forEach((h, i) => {
      h.ent = makeHeroMesh(h.data);
      h.x = this.wx(ex + (i % 2 === 0 ? -0.5 : 0.5));
      h.z = this.wz(ey + (i < 2 ? -0.5 : 0.5));
      h.ent.grp.position.set(h.x, 0, h.z);
      h.path = null; h.pathI = 0; h.cd = Math.random();
      h.target = null; h.repathT = 0; h.walkPhase = Math.random() * 6;
      this.gameGroup.add(h.ent.grp);
      drawBar(h.ent.bar, Math.max(0, h.data.hp / h.data.maxHp));
    });
    this.leaderTrail = [];
    this.targetRoom = -1;
    this.userGoal = -1;
    this._searchRoom = -1; this._searchT = 0; this._searchGoal = -1; this._searchGoalT = 0;
    this.combat = false;
    this.wipeT = 0;
    this.completeT = 0;

    this.visitRoom(d.entrance, true);
    this.recalculateFog(this);   // show frontier rooms adjacent to entrance
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
    const m = {
      data: spec, x: this.wx(x), z: this.wz(y), roomId, isBoss,
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

  /* ============ main update ============ */
  update(dt, elapsed) {
    this.elapsed = elapsed;
    window.__elapsedTime = elapsed;
    updateFloatTexts(this.engine.scene, dt);
    updateProjectiles(this.engine.scene, dt);
    updateWorldFx(this.engine.scene, dt);
    if (this.paused) return;
    if (this.state !== 'crawl' || !this.D) return;
    if (this.engine.isAnimating()) return;
    if (this.campAnim) { this.updateCampAnimation(dt); return; }

    const alive = this.heroes.filter(h => h.data.hp > 0);

    if (alive.length === 0) {
      this._updateWipe(dt);
    } else {
      this.wipeT = 0;
      if (this._wipeScreen) this._hideWipeScreen();
    }

    if (alive.length === 0) {
      /* fall through to visual loop so death animations keep playing */
    } else {

    const leader = alive[0];

    for (const h of alive) {
      const c = this.cellOf(h.x, h.z);
      if (c >= 0 && c !== h.lastCell) {
        h.lastCell = c;
        this.revealAround(c, REVEAL_RADIUS);
        const rid = this.D.roomId[c];
        if (rid >= 0) this.visitRoom(rid);
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

    /* tick timed status effects on all heroes */
    for (const h of this.heroes) {
      if (h.data.hp > 0) {
        this.tickEffectsOn(h);
        updateStatusTray(h);
      }
    }

    /* hero combat AI — two passes so heroes with no foe in range still
       hustle toward the fight instead of freezing rooms behind */
    this.combat = false;
    const foeOf = new Map();
    for (const h of alive) {
      updateFlash(h.ent, dt);
      const foe = this.pickHeroTarget(h, alive);
      if (foe) { this.combat = true; foeOf.set(h, foe); }
    }
    for (const h of alive) {
      const foe = foeOf.get(h);
      if (foe) this.heroCombat(h, foe, alive, dt);
      else if (this.combat) this.combatCatchup(h, alive, dt);
    }

    /* burn DoTs from legendary Immolate perk */
    if (this.updateMonsterStatus) this.updateMonsterStatus(dt);

    /* End of combat: only clear per-fight combat flags — NOT short rest.
       Short rest comes from shrines / rest skill checks; long rest from floor clear. */
    if (this.combat) this.wasCombat = true;
    else if (this.wasCombat) {
      this.wasCombat = false;
      this._combatEngagedAt = null;  // reset combat pacing timer
      this.recalculateFog(this);     // re-snuff frontier rooms
      for (const h of alive) {
        h._foughtThisCombat = false; // First Strike perk
        h.uncannyUsed = false;       // Uncanny Dodge once per fight
      }
      updatePartyFrames(this.heroes.map(x => x.data));
    }

    if (!this.combat) {
      this.exploreAI(alive, leader, dt);
      for (const h of this.heroes) if (h.data.hp <= 0) {
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
      /* Puzzle-floor ward rounds fire before random post-clear challenges */
      checkPuzzleGate(this);
      /* Post-clear skill challenges (paused overlay when one fires) */
      checkForChallenge(this);
      /* Room-entry & pre-boss skill challenges */
      checkRoomEntryChallenge(this);
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
          let a;
          if (h.castAnim || casters.has(c)) a = 'spellcast';
          else if (c === 'rogue' || c === 'ranger') a = 'shoot';
          else a = 'slash';
          h.ent.anim.play(a);
          const rdx = h.lungeDX * cosC - h.lungeDZ * sinC;
          const rdz = h.lungeDX * sinC + h.lungeDZ * cosC;
          h.ent.anim.setDirection(rdx, rdz);
          if (h.lungeT <= 0.02) h.castAnim = false;
        } else {
          h.castAnim = false;
          h.ent.anim.play('walk');
          if (h.moving) {
            const angle = h.ent.grp.rotation.y;
            const mdx = Math.sin(angle), mdz = Math.cos(angle);
            const rdx = mdx * cosC - mdz * sinC;
            const rdz = mdx * sinC + mdz * cosC;
            h.ent.anim.setDirection(rdx, rdz);
          } else {
            h.ent.anim.time = 0;
          }
        }
      }
      if (h.data.hp > 0) h.ent.anim.update(dt);
    }
    this.updateMonsterVisuals(dt, elapsed, cosC, sinC);

    if (elapsed > this.freeCamUntil) {
      /* Dynamic combat camera: center on the fight midpoint */
      const leader = alive[0];
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

    if (this.boss && this.boss.data.hp <= 0) {
      this.completeT += dt;
      if (this.completeT > 3.2) this.finishDungeon();
    }

    this.saveTimer += dt;
    if (this.saveTimer > 5) {
      this.saveTimer = 0;
      this.saveGame();
      updatePartyFrames(this.heroes.map(x => x.data));
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
      drawCampfireCanvas(a.campfire.ctx, a.campfire.canvas.width, a.campfire.canvas.height, t);
      a.campfire.tex.needsUpdate = true;
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
      tk.sprite.material.map.dispose();
      tk.sprite.material.dispose();
      this.gameGroup.remove(tk.sprite);
      tk.hero.ent.grp.visible = true;
      tk.hero.ent.grp.scale.setScalar(1);
    }

    a.campfire.sprite.material.map.dispose();
    a.campfire.sprite.material.dispose();
    this.gameGroup.remove(a.campfire.sprite);
    this.gameGroup.remove(a.light);

    partyShortRest(this, { fullHeal: true, reason: 'shrine' });

    this.campAnim = null;
  }

  _createWipeScreen() {
    if (document.getElementById('wipescreen')) return;
    const ov = document.createElement('div');
    ov.id = 'wipescreen';
    ov.innerHTML = `
      <div class="cs-frame wipe-frame">
        <div class="cs-header">
          <div class="cs-tabs">
            <span style="color:#cc5050;font-weight:700;font-size:14px;letter-spacing:1px;">\u271D PARTY WIPED</span>
          </div>
        </div>
        <div class="cs-body" style="flex-direction:column;align-items:center;justify-content:center;padding:28px 24px;">
          <div class="wipe-flavor" id="wipe-flavor"></div>
          <div class="wipe-countdown">Respawning in <span id="wipe-timer">5</span>s</div>
        </div>
      </div>`;
    document.body.appendChild(ov);
  }

  _showWipeScreen() {
    this._wipeScreen = true;
    this._wipeTimer = 5;
    const flavor = WIPE_FLAVOR[Math.floor(Math.random() * WIPE_FLAVOR.length)];
    document.getElementById('wipe-flavor').textContent = flavor;
    document.getElementById('wipe-timer').textContent = '5';
    document.getElementById('wipescreen').classList.add('show');
  }

  _updateWipe(dt) {
    if (!this._wipeScreen) {
      this._showWipeScreen();
    }
    this._wipeTimer -= dt;
    const sec = Math.max(0, Math.ceil(this._wipeTimer));
    const el = document.getElementById('wipe-timer');
    if (el) el.textContent = String(sec);
    if (this._wipeTimer <= 0) {
      this._hideWipeScreen();
      this.respawnParty();
    }
  }

  _hideWipeScreen() {
    this._wipeScreen = false;
    this._wipeTimer = 0;
    const ov = document.getElementById('wipescreen');
    if (ov) ov.classList.remove('show');
  }

  respawnParty() {
    const { W } = this.D;
    const ea = this.roomAnchor[this.D.entrance];
    log('The party limps back to the entrance to regroup…', 'down');
    this.heroes.forEach((h, i) => {
      h.data.hp = Math.max(1, Math.round(h.data.maxHp * 0.5));
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
      drawBar(h.ent.bar, h.data.hp / h.data.maxHp);
    });
    for (const m of this.monsters) { m.active = false; m.path = null; }
    this.targetRoom = -1;
    this.wipeT = 0;
    updatePartyFrames(this.heroes.map(x => x.data));
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
    if (gold) log(`🪙 Quest reward: +${gold}g.`, 'treasure');

    /* XP — quest rewards go to the real party only (never a temp ally) */
    const real = this.heroes.filter(h => !h.temp);
    const xpEach = Math.max(1, Math.round((q.rewardXp || 0) / Math.max(1, real.length)));
    const before = real.map(h => h.data.level);
    for (const h of real) {
      grantXp(h.data, xpEach, log);
    }
    if (real.some((h, i) => h.data.level > before[i])) this.announceLevelUp();
    log(`✨ Quest reward: +${xpEach} XP each.`, 'level');

    /* Gear (legendary / epic prize) */
    if (q.rewardItem) {
      this.inventory.push(q.rewardItem);
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

    updateResources(this);
    updatePartyFrames(this.heroes.map(h => h.data));
    refreshMenus(this);
    this.saveGame();
  }

  finishDungeon() {
    this.completeT = -1e9;
    const q = this.activeQuest;

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

    this.activeQuest = null;
    this.questFloor = 0;
    this.floorPhase = null;
    this.puzzleState = null;
    updateQuestTracker(this);
    this.saveGame();
    this.state = 'worldmap';
    /* Brief delay so the reward banner is readable, then open map */
    setTimeout(() => {
      showWorldMap({ refresh: true });
    }, 2200);
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
  }
}

Object.assign(
  Game.prototype,
  pathfindingMethods,
  fogMethods,
  combatMethods,
  monsterAiMethods,
  exploreMethods,
  inventoryMethods,
  initiativeMethods
);

export const game = new Game();
if (typeof window !== 'undefined') window.__game = game;
