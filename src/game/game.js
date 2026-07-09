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
  makeHero, normalizeHero, spawnMonster, MONSTER_THEMES, grantXp
} from './srd.js';
import {
  makeHeroMesh, makeMonsterMesh, drawBar, updateFloatTexts,
  updateFlash, updateProjectiles, clearEffects
} from './entities.js';
import { log, buildPartyFrames, updatePartyFrames, updateResources, showBanner, showSetup } from './ui.js';
import { initMenus, refreshMenus } from './menus.js';
import { initShop, showShop } from './shop.js';
import { initWorldMap, showWorldMap } from './worldmap.js';
import { initSkills, checkForChallenge, resetChallengeState } from './skills.js';
import { partyLongRest } from './rest.js';

import { THEME_ORDER, REVEAL_RADIUS, FLOOR } from './constants.js';
import { _v } from './shared.js';
import { buildWallAdj, buildChokepoints, pathfindingMethods } from './pathfinding.js';
import { buildFogMaps, fogMethods } from './fog.js';
import { combatMethods } from './combat.js';
import { monsterAiMethods } from './monster_ai.js';
import { exploreMethods } from './explore.js';
import { inventoryMethods } from './inventory.js';

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
    this.activeQuest = null;
    this.questFloor = 0;
    this.follow = null;
    this.freeCamUntil = 0;
    this.elapsed = 0;
    this.gameGroup = null;
    this.saveTimer = 0;
    this.paused = false;
  }

  /* ============ boot / setup ============ */
  init(engine) {
    this.engine = engine;
    const save = this.loadSave();
    showSetup(!!save,
      slots => {
        this.heroes = slots.map(s => ({ data: makeHero(s.name, s.raceKey, s.classKey, s.baseStats, s.visual) }));
        this.gold = 0; this.potions = { heal: 2, greater: 0 }; this.inventory = []; this.dungeonLevel = 1;
        this.activeQuest = null; this.questFloor = 0;
        this.beginRun();
      },
      () => {
        this.heroes = save.heroes.map(h => ({ data: normalizeHero(h) }));
        this.gold = save.gold; this.potions = save.potions;
        this.inventory = save.inventory || [];
        this.dungeonLevel = save.dungeonLevel;
        this.activeQuest = save.activeQuest || null;
        this.questFloor = save.questFloor || 0;
        this.beginRun(true);
      });

    document.getElementById('potheal').addEventListener('click', () => this.drinkPotion('heal'));
    document.getElementById('potgreater').addEventListener('click', () => this.drinkPotion('greater'));
    initMenus(this);
    initShop(this);
    initWorldMap(this);
    initSkills(this);
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

  nextDungeon(first = false) {
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
    resetChallengeState(); // fresh skill-challenge state per dungeon floor
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

    this.monsters = [];
    const roomThemes = {};
    for (const sp of d.spawns) {
      if (roomThemes[sp.roomId] === undefined) {
        roomThemes[sp.roomId] = MONSTER_THEMES[sp.roomId % MONSTER_THEMES.length];
      }
      const theme = roomThemes[sp.roomId];
      const allowedNames = theme ? theme.monsters[sp.tier] : null;
      const m = spawnMonster(sp.tier, this.dungeonLevel, Math.random, allowedNames);
      this.addMonster(m, sp.x, sp.y, sp.roomId);
    }
    const bossSpec = spawnMonster('boss', this.dungeonLevel, Math.random);
    const ba = this.roomAnchor[d.boss];
    this.addMonster(bossSpec, (ba % W) + 1, Math.floor(ba / W), d.boss, true);
    this.boss = this.monsters[this.monsters.length - 1];

    this.chests = d.props.filter(p => p.kind === 'chest').map(p => ({ x: p.x, y: p.y, roomId: p.roomId, looted: false }));
    this.shrines = d.props.filter(p => p.kind === 'shrineCrystal').map(p => ({ x: p.x, y: p.y, roomId: p.roomId, used: false }));

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
    this.combat = false;
    this.wipeT = 0;
    this.completeT = 0;

    this.visitRoom(d.entrance, true);
    this.state = 'crawl';
    const themeLabel = d.params.themeKey.toUpperCase();
    log(`— Floor ${this.dungeonLevel}: ${d.name} (${themeLabel}) —`, 'sys');
    showBanner(d.name, `Floor ${this.dungeonLevel} · ${d.stats.rooms} rooms`);
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

  /* ============ main update ============ */
  update(dt, elapsed) {
    this.elapsed = elapsed;
    updateFloatTexts(this.engine.scene, dt);
    updateProjectiles(this.engine.scene, dt);
    if (this.paused) return;
    if (this.state !== 'crawl' || !this.D) return;
    if (this.engine.isAnimating()) return;

    const alive = this.heroes.filter(h => h.data.hp > 0);

    if (alive.length === 0) {
      this.wipeT += dt;
      if (this.wipeT > 2.8) this.respawnParty();
      return;
    }
    this.wipeT = 0;

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
      if (this.leaderTrail.length > 30) this.leaderTrail.pop();
    }

    this.updateMonsters(alive, dt);

    /* hero combat AI */
    this.combat = false;
    for (const h of alive) {
      updateFlash(h.ent, dt);
      const foe = this.pickHeroTarget(h, alive);
      if (foe) {
        this.combat = true;
        this.heroCombat(h, foe, alive, dt);
      }
    }

    /* burn DoTs from legendary Immolate perk */
    if (this.updateMonsterStatus) this.updateMonsterStatus(dt);

    /* End of combat: only clear per-fight combat flags — NOT short rest.
       Short rest comes from shrines / rest skill checks; long rest from floor clear. */
    if (this.combat) this.wasCombat = true;
    else if (this.wasCombat) {
      this.wasCombat = false;
      this._combatEngagedAt = null;  // reset combat pacing timer
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
        h.ent.grp.rotation.z = 0;
        h.x = leader.x + (Math.random() - 0.5); h.z = leader.z + (Math.random() - 0.5);
        log(`${h.data.name} staggers back to their feet.`, 'heal');
        drawBar(h.ent.bar, h.data.hp / h.data.maxHp);
      }
      this.checkInteractables(alive);
      /* Post-clear skill challenges (paused overlay when one fires) */
      checkForChallenge(this);
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
        h.ent.anim.play('hurt');
        h.ent.anim.time = 0;
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
      h.ent.anim.update(dt);
    }
    this.updateMonsterVisuals(dt, elapsed, cosC, sinC);

    if (elapsed > this.freeCamUntil) {
      _v.set(leader.x, 0, leader.z);
      this.engine.camTarget.lerp(_v, Math.min(1, dt * 2.2));
      this.engine.updateCam();
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

  respawnParty() {
    const { W } = this.D;
    const ea = this.roomAnchor[this.D.entrance];
    log('The party limps back to the entrance to regroup…', 'down');
    this.heroes.forEach((h, i) => {
      h.data.hp = Math.max(1, Math.round(h.data.maxHp * 0.5));
      h.x = this.wx(ea % W) + (i % 2 === 0 ? -0.5 : 0.5);
      h.z = this.wz(Math.floor(ea / W)) + (i < 2 ? -0.5 : 0.5);
      h.path = null; h.ent.grp.rotation.z = 0;
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

    /* XP */
    const xpEach = Math.max(1, Math.round((q.rewardXp || 0) / Math.max(1, this.heroes.length)));
    const before = this.heroes.map(h => h.data.level);
    for (const h of this.heroes) {
      grantXp(h.data, xpEach, log);
    }
    if (this.heroes.some((h, i) => h.data.level > before[i])) this.announceLevelUp();
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
      this.dungeonLevel = Math.max(1, (q.level || 1) + (this.questFloor - 1));
      this.saveGame();
      log(`Floor cleared. Merchant camp — then floor ${this.questFloor}/${q.floors} of ${q.name}.`, 'sys');
      this.state = 'shop';
      showShop();
      return;
    }

    /* Fallback free-crawl (no active quest) */
    this.dungeonLevel++;
    this.saveGame();
    log(`The floor is cleared. The party rests at a merchant camp before descending to floor ${this.dungeonLevel}…`, 'sys');
    this.state = 'shop';
    showShop();
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

    this.activeQuest = null;
    this.questFloor = 0;
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
  inventoryMethods
);

export const game = new Game();
if (typeof window !== 'undefined') window.__game = game;
