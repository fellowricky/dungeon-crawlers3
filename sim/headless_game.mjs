/**
 * HeadlessGame — runs the REAL game engine in Node.js for mass balance testing.
 *
 * Uses the same combatMethods, monsterAiMethods, initiativeMethods,
 * turnEngineMethods, and pathfindingMethods as the browser game. All VFX/UI/
 * audio hooks are no-ops. Entities use plain {x,y,z} positions instead of
 * Three.js meshes.
 *
 * The result: thousands of full-fidelity combat encounters (with real
 * positioning, pathfinding, monster AI, status effects, spells, and action
 * economy) running at CPU speed with zero rendering overhead.
 */
import { buildWallAdj, buildChokepoints, buildSolidProps, pathfindingMethods } from '../src/game/pathfinding.js';
import { combatMethods } from '../src/game/combat.js';
import { monsterAiMethods } from '../src/game/monster_ai.js';
import { initiativeMethods } from '../src/game/initiative.js';
import { turnEngineMethods } from '../src/game/turn_engine.js';
import { hasEffect } from '../src/game/conditions.js';
import { FLOOR, WALL } from '../src/game/constants.js';

/* ── Stub entity visual object — absorbs property sets / calls harmlessly ── */
function entStub() {
  return {
    bar: {},
    grp: { rotation: { y: 0, z: 0, x: 0 }, visible: true, position: { set() {} } },
    anim: { mesh: { position: { y: 0 } }, play() {}, update() {}, setState() {}, _dying: false, _deathDone: false },
  };
}

/* ── Simple arena-room layout generator ───────────────────────────────────
 * Produces the same dungeon-data shape as the full generator but with a
 * single rectangular room, border walls, and optional pillar obstacles. */
export function createArenaRoom(width = 24, height = 18, pillars = true) {
  const W = width, H = height;
  const grid = new Int32Array(W * H);
  grid.fill(FLOOR);
  for (let x = 0; x < W; x++) { grid[x] = WALL; grid[(H - 1) * W + x] = WALL; }
  for (let y = 0; y < H; y++) { grid[y * W] = WALL; grid[y * W + W - 1] = WALL; }
  if (pillars) {
    const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
    const spots = [[cx - 3, cy - 2], [cx + 3, cy - 2], [cx - 3, cy + 2], [cx + 3, cy + 2]];
    for (const [px, py] of spots) {
      if (px > 1 && px < W - 2 && py > 1 && py < H - 2) grid[py * W + px] = WALL;
    }
  }
  return {
    grid, W, H,
    rooms: [{ id: 0, cx: Math.floor(W / 2), cy: Math.floor(H / 2), w: W - 2, h: H - 2, type: 'combat' }],
    props: [],
    entrance: { x: Math.floor(W / 4), y: Math.floor(H / 2) },
    roomId: new Int32Array(W * H).fill(0),
  };
}

export class HeadlessGame {
  /**
   * @param {object} dungeonData  Grid/rooms from createArenaRoom or generateDungeon
   * @param {object[]} party      Array of hero data objects (from makeHero/recalc)
   * @param {object} opts         { dungeonLevel, potions }
   */
  constructor(dungeonData, party, opts = {}) {
    /* ── Spatial setup (mirrors game.js onDungeon) ────────────────────── */
    this.D = dungeonData;
    const { W, H, grid } = this.D;
    this.D.wallAdj = buildWallAdj(grid, W, H);
    this.D.chokepoint = buildChokepoints(grid, W, H);
    this.D.solidProps = buildSolidProps(this.D);
    this.wx = x => x - W / 2 + 0.5;
    this.wz = y => y - H / 2 + 0.5;
    this.cellOf = (x, z) => {
      const cx = Math.round(x + W / 2 - 0.5), cy = Math.round(z + H / 2 - 0.5);
      return (cx < 0 || cy < 0 || cx >= W || cy >= H) ? -1 : cy * W + cx;
    };

    /* ── Entity setup ─────────────────────────────────────────────────── */
    const ent = dungeonData.entrance || { x: Math.floor(W / 4), y: Math.floor(H / 2) };
    const startX = this.wx(ent.x), startZ = this.wz(ent.y);
    this.heroes = party.map((h, i) => ({
      data: h,
      x: startX + (i % 2) * 0.8, z: startZ + Math.floor(i / 2) * 0.8,
      ent: entStub(),
      _side: 'hero',
      moving: false, walk: false,
      path: null, pathI: 0,
      cd: 0, lastCell: -1,
      castAnim: false,
      lungeDX: 0, lungeDZ: 1, lungeT: 0,
      aiFoe: null,
    }));
    this.monsters = [];
    this.leaderIdx = 0;

    /* ── Game state ───────────────────────────────────────────────────── */
    this.initiative = { active: false, order: [], idx: 0, round: 0, timer: 0 };
    this.fxNow = 0;
    this.elapsed = 0;
    this.activeAoEZones = [];
    this.controlMode = 'auto';
    this.combat = false;
    this.wasCombat = false;
    this._combatEngagedAt = null;
    this._killStreak = 0;
    this._killStreakTimer = 0;
    this.guild = { dispatchOnKill: () => {}, dispatchDungeonXp: () => {} };
    this.bestiary = {};
    this.grantQuestRewardsAtDungeonEnd = () => {};
    this.gold = 0;
    this.potions = opts.potions || { heal: 5, greater: 0, superior: 0 };
    this.inventory = [];
    this.dungeonLevel = opts.dungeonLevel || 1;
    this.activeQuest = null;
    this.questFloor = 0;
    this._jitterT = 0;
    this.storyProgress = {};
    this.summons = { summaryFor: () => null, restore: () => {}, syncScales: () => {} };
    this.visitedRooms = [];
    this.revealed = null;
    this.leaderTrail = [];
    this._intelLogged = false;
    this._unlockedDoors = new Set();
    this.targetingState = null;

    /* ── Data collection ──────────────────────────────────────────────── */
    this.eventLog = [];
    this.stats = {
      damageByHero: {},
      damageByMonster: {},
      healingByHero: {},
      killsByHero: {},
      attacksByHero: {},
      hitsByHero: {},
      critsByHero: {},
      missesByHero: {},
      damageTakenByHero: {},
      downsByHero: {},
    };

    /* ── Mix in ALL domain methods (same as Game.prototype) ──────────── */
    Object.assign(this, pathfindingMethods, combatMethods, monsterAiMethods,
      initiativeMethods, turnEngineMethods);
  }

  /* ═════════════════════════════════════════════════════════════════════
     HOOK OVERRIDES — every fx* method is a no-op or data collector.
     These override the gameHookMethods that the real Game uses.
     ═════════════════════════════════════════════════════════════════════ */
  _v3(x, y, z) { return { x, y, z }; }
  fxLog(msg) { this.eventLog.push({ t: this.elapsed, type: 'log', msg }); }
  fxText() {}
  fxProjectile(_from, _to, _kind, _color, onHit) { if (onHit) onHit(); }
  fxBeam() {}
  fxSprite() {}
  fxSheetEffect() {}
  fxSlash() {}
  fxImpactBurst() {}
  fxDrawBar() {}
  fxHitFlash() {}
  fxUpdateFlash() {}
  fxDeathFountain() {}
  fxMeleeHitVFX() {}
  fxTelegraph() {}
  fxStatusTray() {}
  fxRichAbilityVFX() {}
  fxAoEVisual() { return {}; }
  fxRemoveAoEVisual() {}
  triggerHitStop() {}
  triggerShake() {}
  triggerSlowMo() {}
  refreshHud() {}
  refreshResources() {}
  fxShowBanner() {}
  fxRefreshMenus() {}
  fxUpdateInitTracker() {}
  fxUpdateManualBar() {}
  fxLevelUpBadge() {}
  fxPlaySfx() {}
  fxSpellSfx() { return 'spell'; }
  fxCantripSfx() { return 'cantrip'; }
  fxAbilitySfx() { return 'ability'; }
  fxHasActiveFX() { return false; }
  fxOnKill() {}
  fxSchedule(_ms, fn) { fn(); }

  /* ═════════════════════════════════════════════════════════════════════
     Game-level methods needed by domain mixins
     ═════════════════════════════════════════════════════════════════════ */
  partyLeader(alive) {
    const h = this.heroes[this.leaderIdx];
    if (h && h.data.hp > 0) return h;
    return alive ? alive[0] : this.heroes.find(x => x.data.hp > 0);
  }
  realHeroes() { return this.heroes; }
  snapToTileCenter(e) {
    if (!e || e.data?.hp == null) return;
    const c = this.cellOf(e.x, e.z);
    if (c >= 0) { e.x = this.wx(c % this.D.W); e.z = this.wz(Math.floor(c / this.D.W)); }
  }
  visitRoom() {}
  revealAround() {}
  isCellDoorClosed() { return false; }

  /** Minimal stuck recovery — clear path and re-snap to grid. */
  handleStuck(e, leader, dt) {
    if (!e) return;
    e.path = null;
    e.pathI = 0;
    e.moving = false;
    // Snap to nearest walkable cell
    const c = this.cellOf(e.x, e.z);
    if (c >= 0) {
      e.x = this.wx(c % this.D.W);
      e.z = this.wz(Math.floor(c / this.D.W));
    }
  }

  /* ═════════════════════════════════════════════════════════════════════
     Combat loop — replicates the essential sequence from game.js update()
     ═════════════════════════════════════════════════════════════════════ */
  tick(dt) {
    this.elapsed += dt;

    const alive = this.heroes.filter(h => h.data.hp > 0);
    if (alive.length === 0) return;

    /* Track combat engagement for _combatSec() */
    const hasActiveMonster = this.monsters.some(m => m.active && m.data.hp > 0);
    if (hasActiveMonster && this._combatEngagedAt == null) {
      this._combatEngagedAt = this.elapsed;
    }

    /* Advance initiative */
    this.updateInitiative(dt);

    /* Monster AI */
    this.updateMonsters(alive, dt);

    /* Kill-streak decay */
    if (this._killStreakTimer > 0) {
      this._killStreakTimer -= dt;
      if (this._killStreakTimer <= 0) { this._killStreak = 0; this._killStreakTimer = 0; }
    }

    /* Tick hero status effects */
    for (const h of this.heroes) {
      if (h.data.hp > 0) {
        this.tickEffectsOn(h);
        if (this.tickHeroDots) this.tickHeroDots(h);
      }
    }

    /* Hero combat AI — two-pass like game.js */
    this.combat = false;
    const foeOf = new Map();
    for (const h of alive) {
      const foe = this.heroDecideTarget(h, alive, dt);
      if (foe) { this.combat = true; foeOf.set(h, foe); }
    }

    /* Start-of-combat subclass passives */
    if (this.combat && !this.wasCombat) {
      for (const h of alive) this.subclassCombatStart(h, alive);
      if (this.applyInspiringLeader) this.applyInspiringLeader(alive);
    }
    this.wasCombat = this.combat;

    for (const h of alive) {
      if (this.combat && hasEffect(h, 'charmed')) {
        if (this.charmedHeroUpdate) this.charmedHeroUpdate(h, alive, dt);
        continue;
      }
      const foe = foeOf.get(h);
      if (foe) this.heroCombat(h, foe, alive, dt);
      else if (this.combat) this.combatCatchup(h, alive, dt);
    }

    /* Monster status ticking (burn DoTs, regen, etc.) */
    if (this.updateMonsterStatus) this.updateMonsterStatus();

    /* Persistent AoE spell zones */
    if (this.updateAoEZones) this.updateAoEZones(dt);
  }

  /**
   * Run combat at maximum speed until one side wins or timeout.
   * @param {number} maxTicks  Safety cap (~10K ticks at dt=1/60 ≈ 100s of game time)
   * @returns {'victory'|'wipe'|'timeout'}
   */
  runUntilResolved(maxTicks = 15000) {
    const dt = 1 / 60;
    for (let i = 0; i < maxTicks; i++) {
      if (!this.monsters.some(m => m.data.hp > 0)) return 'victory';
      if (!this.heroes.some(h => h.data.hp > 0)) return 'wipe';
      this.tick(dt);
    }
    return 'timeout';
  }

  /* ═════════════════════════════════════════════════════════════════════
     Monster placement — spawn monsters into the arena and activate them
     ═════════════════════════════════════════════════════════════════════ */

  /**
   * Place a monster entity at a position and mark it active (aggroed).
   * @param {object} monsterData  Monster data from spawnMonster()
   * @param {number} x  World X
   * @param {number} z  World Z
   */
  addMonster(monsterData, x, z) {
    const m = {
      data: monsterData,
      x, z,
      ent: entStub(),
      _side: 'mon',
      active: true,
      moving: false, walk: false,
      path: null, pathI: 0, repathT: 0,
      cd: 0,
      _threat: {},
      _tgtIdx: -1,
      _spellCycle: 0,
      _forcedTgt: null,
    };
    this.monsters.push(m);
    return m;
  }

  /**
   * Spawn monsters in a spread formation near the far side of the arena.
   * Positions them within reach after ~2 movement turns.
   * @param {object[]} monsterSpecs  Array of monster data objects
   */
  spawnMonsters(monsterSpecs) {
    const { W, H } = this.D;
    const ent = this.D.entrance || { x: Math.floor(W / 4), y: Math.floor(H / 2) };
    // Place monsters 3-5 cells from the heroes
    const offset = 3 + Math.min(2, Math.floor(monsterSpecs.length / 2));
    const baseX = this.wx(Math.min(W - 2, ent.x + offset));
    const baseZ = this.wz(ent.y);
    const spread = 1.2;
    monsterSpecs.forEach((spec, i) => {
      const x = baseX + (i % 3) * spread;
      const z = baseZ + Math.floor(i / 3) * spread - spread;
      this.addMonster(spec, x, z);
    });
  }
}
