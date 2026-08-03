/**
 * Monster AI — activation, targeting, chase, and attack cadence.
 *
 * Expand here as enemy behavior grows (pack tactics, ranged, leashing,
 * ability casts, boss phases, etc.). Attack *resolution* (rolls/damage
 * visuals) lives in `monsterAttack`; hero-side combat stays in combat.js.
 *
 * Mixed onto Game — uses pathfinding (findPath, stepAlong) and combat helpers
 * (heroAC, triggerLunge).
 */
import * as THREE from 'three';
import {
  drawBar, makeFloatText, hitFlash, updateFlash,
  spawnSlash, spawnSpriteEffect, spawnProjectile, spawnTelegraph,
  updateStatusTray, spawnMeleeHitVFX, spawnRichAbilityVFX
} from './entities.js';
import { log, updatePartyFrames } from './ui.js';
import { SPELLS } from './spells.js';
import { roll, d as die, d20Roll } from './srd.js';
import { hasFeature } from './features.js';
import { AGGRO_RANGE, MONSTER_ATTACK_CD, MONSTER_SPEED_MULT,
  THREAT_WEIGHT, THREAT_DIST_WEIGHT, THREAT_JITTER, THREAT_HALFLIFE_SEC, TARGET_SWITCH_MARGIN,
  KITE_THREAT_RANGE, KITE_RETREAT_DIST, KITE_COMMIT_SEC,
  FLANK_OFFSET, PACK_TAGS, PACK_IDS, PACK_FOCUS_BONUS, TIGHT_R } from './constants.js';
import { hasEffect, getEffectMods, tickEffects as _tickEffects, applyEffect, rollSave, rollSaveDetail } from './conditions.js';
import { _v } from './shared.js';
import { playSfx, abilitySfx } from './audio.js';

/** Spells accessible to specific boss monsters (by id).  Keys are spell ids
 *  from the SPELLS registry; bosses cast them on alternating attack cycles. */
export const BOSS_SPELLS = {
  'ancient-lich-lord':  ['blight','fear','holdPerson','bestowCurse'],
  'adult-red-dragon':   ['fireball','dragonBreathSpell','fear'],
  'pit-fiend':          ['fireball','holdMonster','blindness'],
  'balor':              ['fireball','fear','darkness'],
  'kraken':             ['callLightning','slow','web'],
  'lich':               ['blight','fear','bestowCurse','rayOfEnfeeblement'],
  'cacodemon':          ['chaosBolt','fireball','fear'],
  'hell-knight':        ['inflictWounds','bestowCurse','blindness'],
  'golden-dragon-ancient':['flameStrike','fear','massCureWounds'],
  'ettin':              ['shatter'],
  'purple-worm':        ['acidArrow'],
  'young-dragon':       ['dragonBreathSpell','fear'],
  'titan':              ['flameStrike','holdMonster'],
  'iron-dragon-ancient':['coneOfCold','fear'],
};

/** Bosses cast a spell roughly every Nth attack cycle. */
const BOSS_SPELL_EVERY = 3;

/** Non-boss monsters with `abilities` use a cycle ability every Nth attack
 *  (per-ability `every` overrides). Same cadence idea as bosses. */
const MONSTER_ABILITY_EVERY = 3;

/** Seconds between aura pulses (stench, fetid cloud, gibbering…). */
const AURA_PULSE_EVERY = 4;

/* Boss-side spell resolution. The hero spell registry (spells.js) only knows
 * how to damage MONSTERS, so bosses can't reuse it — this table drives a
 * self-contained resolver (monsterCastSpell) that hits the PARTY instead.
 *   dice:  [count, sides, flatBonus]  damage roll (via roll())
 *   save:  { ab, dc, half }           ability save; half=true → half dmg on success,
 *                                      otherwise a successful save negates the effect
 *   effect:{ key, dur }               condition applied to heroes on a failed save
 *   aoe:   radius in world units      hits every hero within radius of the target
 *   heal:  [count, sides, flatBonus]  support: heals the boss + nearby minions
 *   sprite: dcss/effect/<name>.png    impact visual */
export const BOSS_SPELL_FX = {
  fireball:          { label:'Fireball',       color:0xff7a30, sprite:'cloud_fire_2',    aoe:2.6, dice:[6,6,4],  dmgType:'fire',      save:{ ab:'dex', dc:15, half:true } },
  flameStrike:       { label:'Flame Strike',   color:0xffd34a, sprite:'flame_1',         aoe:2.6, dice:[6,6,6],  dmgType:'radiant',   save:{ ab:'dex', dc:16, half:true } },
  dragonBreathSpell: { label:'Searing Breath', color:0xff6020, sprite:'cloud_fire_1',    aoe:3.0, dice:[8,6,4],  dmgType:'fire',      save:{ ab:'dex', dc:16, half:true } },
  coneOfCold:        { label:'Cone of Cold',   color:0x7fd4ff, sprite:'frost_0',         aoe:3.0, dice:[6,8,0],  dmgType:'cold',      save:{ ab:'con', dc:16, half:true } },
  shatter:           { label:'Shatter',        color:0xd0a0ff, sprite:'sandblast_1',     aoe:2.4, dice:[3,8,2],  dmgType:'thunder',   save:{ ab:'con', dc:14, half:true } },
  callLightning:     { label:'Call Lightning', color:0x7090ff, sprite:'zap_2',           aoe:2.2, dice:[4,10,0], dmgType:'lightning', save:{ ab:'dex', dc:15, half:true } },
  chaosBolt:         { label:'Chaos Bolt',     color:0xff8844, sprite:'cloud_chaos_4',            dice:[3,8,4],  dmgType:'force' },
  acidArrow:         { label:'Acid Arrow',     color:0x4cae4c, sprite:'acid_venom',               dice:[4,4,3],  dmgType:'acid' },
  blight:            { label:'Blight',         color:0x6a3080, sprite:'cloud_neg_1',              dice:[6,8,0],  dmgType:'necrotic',  save:{ ab:'con', dc:16, half:true } },
  inflictWounds:     { label:'Inflict Wounds', color:0xc04040, sprite:'drain_red_1',              dice:[5,10,0], dmgType:'necrotic' },
  fear:              { label:'Fear',           color:0x9b59b6, sprite:'cloud_gloom_new', aoe:3.2, effect:{ key:'frightened', dur:6 }, save:{ ab:'wis', dc:15 } },
  slow:              { label:'Slow',           color:0x8fd4e8, sprite:'cloud_blue_smoke', aoe:2.8, effect:{ key:'slowed', dur:6 },     save:{ ab:'wis', dc:15 } },
  web:               { label:'Web',            color:0xbfa060, sprite:'net_trap',         aoe:2.6, effect:{ key:'restrained', dur:6 }, save:{ ab:'dex', dc:14 } },
  darkness:          { label:'Darkness',       color:0x888899, sprite:'cloud_black_smoke', aoe:3.0, effect:{ key:'blinded', dur:6 } },
  holdPerson:        { label:'Hold Person',    color:0x8090c0, sprite:'silenced',                 effect:{ key:'paralyzed', dur:6 }, save:{ ab:'wis', dc:15 } },
  holdMonster:       { label:'Hold',           color:0x8090c0, sprite:'silenced',                 effect:{ key:'paralyzed', dur:6 }, save:{ ab:'wis', dc:15 } },
  blindness:         { label:'Blindness',      color:0x888899, sprite:'cloud_black_smoke',        effect:{ key:'blinded', dur:6 },   save:{ ab:'con', dc:15 } },
  bestowCurse:       { label:'Bestow Curse',   color:0x9b59b6, sprite:'cloud_neg_1',              effect:{ key:'weakenedDmg', dur:8 }, save:{ ab:'wis', dc:15 } },
  rayOfEnfeeblement: { label:'Enfeeble',       color:0xd0a080, sprite:'cloud_meph_0',             effect:{ key:'weakenedDmg', dur:8 }, save:{ ab:'con', dc:14 } },
  massCureWounds:    { label:'Mass Cure Wounds', color:0x6ae06a, sprite:'goldaura_1', heal:[4,8,8] },
};

export const MONSTER_MELEE_RANGE = 1.5;

/** Seconds between chase repaths while pursuing a hero. */
export const MONSTER_REPATH_CD = 0.7;

export const monsterAiMethods = {
  /**
   * Per-frame monster brain. Activates idle monsters near the party,
   * then chase / attack for each active living monster.
   */
  updateMonsters(alive, dt) {
    /* Slow per-hero jitter so monsters' target preference drifts without
       causing per-frame retarget twitch. Refreshed every ~2s. */
    this._jitterT = (this._jitterT || 0) + dt;
    if (this._jitterT >= 2.0) {
      this._jitterT = 0;
      for (const h of alive) h._aiJitter = (Math.random() * 2 - 1) * THREAT_JITTER;
    }

    for (const m of this.monsters) {
      if (m.data.hp <= 0) continue;
      updateFlash(m.ent, dt);

      /* tick timed effects on monsters (combat clock — see conditions.js) */
      _tickEffects(m, this.fxNow);
      updateStatusTray(m);

      /* decay accumulated threat (exponential half-life) so stale aggro fades */
      if (m._threat) {
        const decay = Math.pow(0.5, dt / THREAT_HALFLIFE_SEC);
        for (const ki in m._threat) {
          m._threat[ki] *= decay;
          if (m._threat[ki] < 0.1) delete m._threat[ki];
        }
      }
      /* cache pack membership once per monster */
      if (m._pack === undefined) m._pack = this.isPackMonster(m);

      if (!m.active) {
        if (this.tryActivateMonster(m, alive)) {
          /* fall through into chase/attack this frame */
        } else {
          continue;
        }
      }

      /* Regeneration (SRD trait): heal per tick while below max, unless fire
         or acid damage suppressed it (m._noRegenUntil, set in damageMonster). */
      if (m.data.regen && m.data.hp < m.data.maxHp &&
          !(m._noRegenUntil && this.fxNow < m._noRegenUntil)) {
        m._regenT = (m._regenT || 0) + dt;
        if (m._regenT >= 3) {
          m._regenT = 0;
          m.data.hp = Math.min(m.data.maxHp, m.data.hp + m.data.regen);
          drawBar(m.ent.bar, Math.max(0, m.data.hp / m.data.maxHp), '#e0483a');
          makeFloatText(this.engine.scene, '+' + m.data.regen, _v.set(m.x, 1.2, m.z), '#6ae06a');
        }
      }

      /* Real-time Aura Pulse (Stench, Fetid Cloud, Gibbering, Fire Form aura, etc.):
         pulses every N seconds (default 4.0s) against all alive heroes within radius */
      if (m.data.abilities && m.data.abilities.some(a => a.trigger === 'aura' && !a.fxOnly)) {
        m._auraT = (m._auraT || 0) + dt;
        if (m._auraT >= AURA_PULSE_EVERY) {
          m._auraT = 0;
          for (const ab of m.data.abilities) {
            if (ab.trigger !== 'aura' || ab.fxOnly) continue;
            const r = ab.aoe || ab.radius || 2.0;
            const targets = alive.filter(h => Math.hypot(h.x - m.x, h.z - m.z) <= r);
            if (targets.length > 0) {
              spawnTelegraph(this.engine.scene, { x: m.x, z: m.z }, r, ab.color || 0x88aa66, 0.5);
              for (const h of targets) {
                this._resolveAbilityOnHero(m, h, ab, ab.label || 'an aura');
              }
            }
          }
        }
      }

      const tgt = this.pickMonsterTarget(m, alive);
      if (!tgt) continue;

      this.runMonsterBehavior(m, tgt, dt);

      /* Same-side overlap enforcement: if this monster stopped on a cell
         occupied by another monster, displace it. Only checks monster-monster
         overlaps (not monster-hero), and only when not actively moving, to
         avoid disrupting ongoing path traversal. */
      if (!m.moving && !m.walk) {
        const mc = this.cellOf(m.x, m.z);
        if (mc >= 0) {
          const overlap = this.monsters.find(o => o !== m && o.active && o.data.hp > 0 &&
            this.cellOf(o.x, o.z) === mc);
          if (overlap && this.enforceUnoccupiedCell) this.enforceUnoccupiedCell(m);
        }
      }
    }
  },

  activateRoomMonsters(roomId) {
    if (roomId == null) return;
    for (const m of this.monsters) {
      if (m.roomId === roomId && !m.active && m.data.hp > 0) {
        m.active = true;
        if (m.ent && m.ent.grp) m.ent.grp.visible = true;
      }
    }
  },

  /**
   * Activate a sleeping monster if its room is known, a hero is in aggro
   * range, AND the monster can actually see a hero — hasLOS is blocked by
   * walls and closed doorway gates, so fights don't wake monsters through
   * a locked door.
   */
  tryActivateMonster(m, alive) {
    if (m.active) return true;
    const known = this.visitedRooms[m.roomId] || this.revealed[this.cellOf(m.x, m.z)];
    if (!known) return false;

    for (const h of alive) {
      if (Math.hypot(h.x - m.x, h.z - m.z) < AGGRO_RANGE &&
          this.hasLOS(h.x, h.z, m.x, m.z)) {
        m.active = true;
        m.ent.grp.visible = true;
        if (m._spellCycle === undefined) {
          m._spellCycle = Math.floor(Math.random() * 2) + 1;
        }
        this.activateRoomMonsters(m.roomId);
        return true;
      }
    }
    return false;
  },

  /** True if this monster exhibits higher-level tactical awareness. */
  isTacticalMonster(m) {
    if (m.isBoss || (m.data.cr != null && m.data.cr >= 3)) return true;
    const tags = m.data.tags || [];
    const tacticalTags = ['caster', 'dragon', 'demon', 'devil', 'undead', 'boss', 'commander', 'tactical'];
    if (tags.some(t => tacticalTags.includes(t))) return true;
    if (m.data.id && BOSS_SPELLS[m.data.id]) return true;
    return false;
  },

  /**
   * Threat-aware target selection. Each candidate hero is scored:
   *   threat dealt + proximity pull + slow jitter, with a hysteresis
   *   margin favouring the current target (anti-twitch). Pack monsters
   *   also get a bonus toward a pack-mate's current target (focus fire).
   *   Tactical monsters additionally prioritize low-AC casters, healers,
   *   concentrating mages, and low-HP targets.
   *   [taunt hook] a non-null m._forcedTgt (hero idx) short-circuits this.
   */
  pickMonsterTarget(m, alive) {
    if (m._forcedTgt !== undefined && this.heroes[m._forcedTgt]?.data.hp > 0) {
      const h = this.heroes[m._forcedTgt];
      m._tgtIdx = m._forcedTgt;
      m._targetDist = Math.hypot(h.x - m.x, h.z - m.z);
      return h;
    }

    const threat = m._threat || {};
    const curIdx = m._tgtIdx;
    const packFocus = (m._pack && this.packFocusHero(m)) ?? -1;
    const isTactical = this.isTacticalMonster(m);

    let tgt = null, best = -Infinity;
    for (const h of alive) {
      const hi = this.heroes.indexOf(h);
      const d = Math.hypot(h.x - m.x, h.z - m.z);
      /* ignore heroes way out of aggro range unless we're already on them */
      if (!this.initiative?.active && d > AGGRO_RANGE + 3 && hi !== curIdx) continue;

      let score = (threat[hi] || 0) * THREAT_WEIGHT
                + (AGGRO_RANGE - d) * THREAT_DIST_WEIGHT
                + (h._aiJitter || 0);
      if (hi === packFocus) score += PACK_FOCUS_BONUS;

      if (isTactical && h.data) {
        const clsKey = h.data.classKey;
        /* Prioritize soft casters / healers */
        if (['wizard', 'sorcerer', 'warlock', 'cleric', 'bard', 'druid'].includes(clsKey)) {
          score += 1.5;
        }
        /* Prioritize heroes concentrating on active spells */
        if (h.conc) score += 1.2;
        /* Low HP finisher bonus */
        if (h.data.hp / h.data.maxHp < 0.3) score += 1.5;
      }

      if (hi === curIdx) score *= TARGET_SWITCH_MARGIN;   // hysteresis
      if (score > best) { best = score; tgt = h; }
    }
    if (tgt) {
      m._tgtIdx = this.heroes.indexOf(tgt);
      m._targetDist = Math.hypot(tgt.x - m.x, tgt.z - m.z);
    }
    return tgt;
  },

  /** Credit damage as threat on a monster (called from damageMonster). */
  creditThreat(m, h, dmg) {
    if (!h || dmg <= 0 || !m || m.data.hp <= 0) return;
    const idx = this.heroes.indexOf(h);
    if (idx < 0) return;
    if (!m._threat) m._threat = {};
    m._threat[idx] = (m._threat[idx] || 0) + dmg * THREAT_WEIGHT;
  },

  /** True if this monster belongs to a coordinating pack (tag/id heuristic). */
  isPackMonster(m) {
    const tags = m.data.tags || [];
    for (let i = 0; i < tags.length; i++) if (PACK_TAGS.includes(tags[i])) return true;
    return PACK_IDS.includes(m.data.id);
  },

  /** Hero idx that this monster's pack-mates are mostly focusing, or -1. */
  packFocusHero(m) {
    if (!m._pack) return -1;
    const counts = {};
    let best = -1, bestN = 0;
    for (const o of this.monsters) {
      if (o === m || o.data.hp <= 0 || !o.active) continue;
      if (o.data.id !== m.data.id) continue;        // kin = same species
      const ti = o._tgtIdx;
      if (ti === undefined || ti === null) continue;
      counts[ti] = (counts[ti] || 0) + 1;
      if (counts[ti] > bestN) { bestN = counts[ti]; best = ti; }
    }
    return bestN > 0 ? best : -1;
  },

  /** Nearest living hero within `range` of a monster (a melee threat to a shooter). */
  nearestMeleeThreat(m, range = KITE_THREAT_RANGE) {
    let best = null, bd = range;
    for (const h of this.heroes) {
      if (h.data.hp <= 0) continue;
      const d = Math.hypot(h.x - m.x, h.z - m.z);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  },

  /**
   * Flank goal cell: if allied melee monsters are clustered on the target,
   * aim for the opposite side of the target so we wrap around instead of
   * stacking into a conga line. Returns a valid floor cell or -1.
   */
  /** Check if a cell is occupied by another living monster (not `self`). */
  isCellOccupiedByAlly(cell, self) {
    if (cell < 0) return false;
    for (const o of this.monsters) {
      if (o === self || !o.active || o.data.hp <= 0) continue;
      if (this.cellOf(o.x, o.z) === cell) return true;
    }
    return false;
  },

  /** Find an unoccupied adjacent floor cell near `goal` for monster `m`. */
  nearUnoccupiedGoal(m, goal) {
    if (goal < 0) return goal;
    if (!this.isCellOccupiedByAlly(goal, m)) return goal;
    const W = this.D.W, H = this.D.H || Math.floor(this.D.grid.length / W);
    const gx = goal % W, gz = Math.floor(goal / W);
    const solid = this.D.solidProps;
    for (let r = 1; r <= 2; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const nx = gx + dx, nz = gz + dz;
          if (nx < 0 || nx >= W || nz < 0 || nz >= H) continue;
          const nc = nz * W + nx;
          if (this.D.grid[nc] !== 1) continue; // not floor
          if (solid && solid[nc]) continue;
          if (this.isCellOccupiedByAlly(nc, m)) continue;
          return nc;
        }
      }
    }
    return goal; // fallback: no free cell found
  },

  flankGoal(m, tgt) {
    let sx = 0, sz = 0, n = 0;
    for (const o of this.monsters) {
      if (o === m || o.data.hp <= 0 || !o.active) continue;
      if (o.data.ranged) continue;
      if (Math.hypot(o.x - tgt.x, o.z - tgt.z) < MONSTER_MELEE_RANGE + 1.0) {
        sx += o.x; sz += o.z; n++;
      }
    }
    if (n === 0) return -1;
    const cx = sx / n, cz = sz / n;
    let dx = tgt.x - cx, dz = tgt.z - cz;
    const dl = Math.hypot(dx, dz);
    if (dl < 0.01) return -1;
    dx /= dl; dz /= dl;
    const fx = tgt.x + dx * FLANK_OFFSET;
    const fz = tgt.z + dz * FLANK_OFFSET;
    const cell = this.nearFloorCell(this.cellOf(fx, fz), 2);
    return this.nearUnoccupiedGoal(m, cell);
  },

  /**
   * Default melee chase-and-swing, with ranged kite and boss caster hooks.
   */
  runMonsterBehavior(m, tgt, dt) {
    const dist = m._targetDist ?? Math.hypot(tgt.x - m.x, tgt.z - m.z);
    /* Initiative gate: off-turn monsters cannot act or move on other creatures' turns. */
    if (this.initiative && this.initiative.active && !this.isCurrentActor(m)) return;
    m._kiteT = (m._kiteT || 0) - dt;

    /* Ability casters (bosses + any monster with cycle abilities): every Nth attack
       the monster uses an ability at the party instead of swinging. */
    if (!m.actUsed && dist < 8 && this.hasLOS(m.x, m.z, tgt.x, tgt.z)) {
      if (this.tryMonsterCycleAbility(m, tgt)) return;
    }

    /* Ranged monster: if a melee hero is breathing down our neck, kite
       away rather than stand and die. Otherwise hold at range and shoot. */
    if (m.data.ranged) {
      const threat = this.nearestMeleeThreat(m);
      if (threat) {
        this.monsterKite(m, tgt, threat, dt);
        return;
      }
      if (dist <= m.data.rngRange) {
        this.monsterRanged(m, tgt, dt);
        return;
      }
      /* target out of range: fall through to chase and close the gap */
    }

    /* Dash / Dodge: the tactical fallbacks for a turn where the monster's
       movement has run out (or it is wedged) and it still can't reach anyone. */
    if (this.monsterTacticalAction(m, tgt, dist, dt)) return;

    if (dist > MONSTER_MELEE_RANGE) {
      this.monsterChase(m, tgt, dt);
    } else {
      this.monsterMelee(m, tgt, dt);
    }
  },

  /**
   * Dash / Dodge decision for a monster whose turn it is.
   *
   * Fires when the monster cannot reach and attack a target using normal movement
   * alone (dist > reach + normalMove) or when movement budget is spent.
   *
   * Returns true when an action was taken and the caller should stand down for
   * this frame.
   */
  monsterTacticalAction(m, tgt, dist, dt) {
    if (!this.initiative || !this.initiative.active || !this.isCurrentActor(m)) return false;
    if (m.actUsed) return false;
    if (hasEffect(m, 'charmed') || getEffectMods(m).incapacitated) return false;

    const reach = m.data.ranged ? m.data.rngRange : MONSTER_MELEE_RANGE;
    if (dist <= reach && (!m.data.ranged || this.hasLOS(m.x, m.z, tgt.x, tgt.z))) return false;

    const speedCells = this.cellsForSpeed(m);
    const hasFullMove = (m.moveLeft == null || m.moveLeft >= speedCells * 0.85) && (!m.path || m.pathI >= m.path.length);

    /* A) DISENGAGE CHECK: ONLY at turn start (hasn't moved yet) if monster started in melee threat
       AND is severely bloodied (<35% HP) or a squishy ranged caster. */
    const threatDist = Math.hypot(tgt.x - m.x, tgt.z - m.z);
    if (hasFullMove && threatDist <= MONSTER_MELEE_RANGE + 0.3 && !m.disengageActive) {
      const pinnedBy = this.heroes.filter(h => h.data.hp > 0 &&
        Math.hypot(h.x - m.x, h.z - m.z) <= MONSTER_MELEE_RANGE + 0.3).length;
      const bloodied = m.data.hp <= m.data.maxHp * 0.35;
      const squishyRanged = m.data.ranged && pinnedBy > 0;
      if (pinnedBy > 0 && (bloodied || squishyRanged) && this.takeCommonAction(m, 'disengage')) {
        const threats = this.heroes.filter(h => h.data.hp > 0 && Math.hypot(h.x - m.x, h.z - m.z) <= 3.5);
        const fleePath = this.findFleePath(m, threats, m.moveLeft || speedCells, { avoidClosedDoors: true });
        if (fleePath) {
          m.path = fleePath; m.pathI = 0; m.repathT = MONSTER_REPATH_CD; m._stuckT = 0;
          const mods = getEffectMods(m);
          let spd = m.data.speed * MONSTER_SPEED_MULT * mods.speedMul;
          m.walk = this.moveStep(m, spd, dt || 0.016);
          m.moving = m.walk;
        } else {
          m.walk = false; m.moving = false;
        }
        return true;
      }
    }

    /* B) DASH CHECK: ONLY at turn start when target is beyond normal move + reach.
       If target IS reachable within normal movement, Dash is strictly forbidden! */
    const needsDash = hasFullMove && dist > (reach + speedCells);

    if (needsDash) {
      const route = this.findPath(this.cellOf(m.x, m.z), this.cellOf(tgt.x, tgt.z), { avoidClosedDoors: true });
      if (route && this.takeCommonAction(m, 'dash')) {
        m.path = route; m.pathI = 0; m.repathT = MONSTER_REPATH_CD; m._stuckT = 0;
        const mods = getEffectMods(m);
        let spd = m.data.speed * MONSTER_SPEED_MULT * mods.speedMul;
        m.walk = this.moveStep(m, spd, dt || 0.016);
        m.moving = m.walk;
        return true;
      }
    }

    /* C) DODGE CHECK: out of movement budget and no route available */
    if ((m.moveLeft || 0) <= 0 && (!m.path || m.pathI >= m.path.length) && this.takeCommonAction(m, 'dodge')) {
      m.walk = false; m.moving = false;
      m.path = null; m.pathI = 0; m._stuckT = 0;
      return true;
    }
    return false;
  },

  /**
   * Ranged monster retreat: back away from the nearest melee threat toward
   * an open cell, and fire on cadence if a clean shot is available. A short
   * commit window (m._kiteT) keeps the monster from flickering between
   * kiting and shooting as the threat distance wobbles.
   */
  monsterKite(m, tgt, threat, dt) {
    if (hasEffect(m, 'charmed') || getEffectMods(m).incapacitated) { m.walk = false; return; }
    if (m._kiteT <= 0) m._kiteT = KITE_COMMIT_SEC;

    /* Disengage before a costly retreat if bloodied or pinned */
    if (this.initiative && this.initiative.active && this.isCurrentActor(m)
        && !m.actUsed && !m.disengageActive
        && Math.hypot(threat.x - m.x, threat.z - m.z) <= MONSTER_MELEE_RANGE + 0.3) {
      const pinnedBy = this.heroes.filter(h => h.data.hp > 0 &&
        Math.hypot(h.x - m.x, h.z - m.z) <= MONSTER_MELEE_RANGE + 0.3).length;
      const bloodied = m.data.hp <= m.data.maxHp * 0.5;
      if ((bloodied || pinnedBy > 1) && this.takeCommonAction(m, 'disengage')) {
        const threats = this.heroes.filter(h => h.data.hp > 0 && Math.hypot(h.x - m.x, h.z - m.z) <= 3.5);
        const fleePath = this.findFleePath(m, threats, m.moveLeft || this.cellsForSpeed(m), { avoidClosedDoors: true });
        if (fleePath) {
          m.path = fleePath; m.pathI = 0; m.repathT = MONSTER_REPATH_CD;
        }
      }
    }

    /* retreat vector: away from the threat */
    let dx = m.x - threat.x, dz = m.z - threat.z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    let goal = this.nearFloorCell(this.cellOf(m.x + dx * KITE_RETREAT_DIST, m.z + dz * KITE_RETREAT_DIST), 2);

    /* direct retreat blocked → try a perpendicular strafe (either side) */
    if (goal < 0) {
      goal = this.nearFloorCell(this.cellOf(m.x + (-dz) * KITE_RETREAT_DIST, m.z + dx * KITE_RETREAT_DIST), 2);
    }
    if (goal < 0) {
      goal = this.nearFloorCell(this.cellOf(m.x + dz * KITE_RETREAT_DIST, m.z + (-dx) * KITE_RETREAT_DIST), 2);
    }
    /* cornered (or blocked by walls/closed doors): give up on moving and just shoot */
    if (goal < 0 && !m.path) { this.monsterRanged(m, tgt, dt); return; }

    m.repathT -= dt;
    if (m.repathT <= 0 || !m.path || m.pathI >= m.path.length) {
      m.path = this.findPath(this.cellOf(m.x, m.z), goal, { avoidClosedDoors: true });
      m.pathI = 0;
      m.repathT = MONSTER_REPATH_CD;
    }
    const mods = getEffectMods(m);
    let spd = m.data.speed * MONSTER_SPEED_MULT * mods.speedMul;
    if (m.slowUntil && this.elapsed < m.slowUntil) spd *= 0.5;
    m.walk = this.moveStep(m, spd, dt);
    m.moving = m.walk;

    /* face the target so shots/anims look right while backing away */
    m.ent.grp.rotation.y = Math.atan2(tgt.x - m.x, tgt.z - m.z);

    /* fire if there's a clean shot at the target and action is free */
    if (!m.actUsed
        && Math.hypot(tgt.x - m.x, tgt.z - m.z) <= m.data.rngRange
        && this.hasLOS(m.x, m.z, tgt.x, tgt.z)) {
      m.actUsed = true;
      this._countSwing(m);
      this.monsterRangedAttack(m, tgt);
    }
  },

  /** Ranged attack: face the target and fire a projectile on cooldown. */
  monsterRanged(m, tgt, dt) {
    m.walk = false;
    m.moving = false;
    m.path = null;
    m.ent.grp.rotation.y = Math.atan2(tgt.x - m.x, tgt.z - m.z);
    if (!m.actUsed) {
      m.actUsed = true;
      this._countSwing(m);
      this.monsterRangedAttack(m, tgt);
      /* Multiattack for ranged variants — manticore tail-spike volley,
         deep-elf-master-archer double-shot, etc. Same loop as melee. */
      const extra = Math.max(0, (m.data.attacksPerTurn || 1) - 1);
      for (let i = 0; i < extra && tgt.data.hp > 0; i++) {
        this.monsterRangedAttack(m, tgt);
      }
    }
  },

  /** Advantage/disadvantage sources for a monster attacking a hero. */
  monsterAttackAdv(m, h) {
    let adv = 0;
    if (getEffectMods(m).atkDisadvantage) adv -= 1;   // poisoned / blinded / frightened…
    if (getEffectMods(h).defAdvantage) adv += 1;      // hero blinded / restrained…
    /* Reckless Attack: attacks against a reckless raging barbarian have advantage */
    if (hasEffect(h, 'raging') && hasFeature(h.data, 'recklessAttack')) adv += 1;
    /* Pack Tactics (SRD trait): advantage when a living ally is adjacent to the target */
    if (m.data.packTactics) {
      for (const o of this.monsters) {
        if (o === m || o.dead || o.data.hp <= 0 || !o.active) continue;
        if (Math.hypot(o.x - h.x, o.z - h.z) < MONSTER_MELEE_RANGE + 0.5) { adv += 1; break; }
      }
    }
    return adv;
  },

  /** Fire a ranged projectile at a hero. */
  monsterRangedAttack(m, h) {
    const adv = this.monsterAttackAdv(m, h);
    const d20 = d20Roll(adv);
    const atkMods = getEffectMods(m);
    let atkBonus = m.data.atk + (atkMods.atkBonus || 0);
    if (atkMods.blessDice) atkBonus += d(4);
    const total = d20 + atkBonus;
    let crit = d20 === 20;
    if (crit && this.engine) this.engine.triggerHitStop(2);
    const ac = this.heroAC(h);
    const from = new THREE.Vector3(m.x, 0.55, m.z);
    const to = new THREE.Vector3(h.x, 0.4, h.z);

    playSfx('bowAttack', { volume: 0.5 });
    if (!crit && total < ac) {
      /* spawn a visible projectile that "misses" */
      spawnProjectile(this.engine.scene, from, to, 'arrow', 0x999999, () => {
        makeFloatText(this.engine.scene, 'miss', _v.set(h.x, 1.1, h.z), '#9aa');
        playSfx('bowBlock', { volume: 0.45 });
      });
      return;
    }

    let dice = m.data.dmg[0]; if (crit) dice *= 2;
    let dmg = roll(dice, m.data.dmg[1], m.data.dmg[2] || 0);
    const color = m.data.color || 0xff8a5a;
    spawnProjectile(this.engine.scene, from, to, 'arrow', color, () => {
      if (h.data.hp <= 0) return;
      playSfx('bowHit', { volume: 0.6 });
      const dealt = this.applyIncomingDamage ? this.applyIncomingDamage(h, dmg) : (h.data.hp -= dmg, dmg);
      hitFlash(h.ent);
      makeFloatText(this.engine.scene, String(dealt), _v.set(h.x, 1.2, h.z), crit ? '#ff5040' : '#ff9a7a');
      drawBar(h.ent.bar, Math.max(0, h.data.hp / h.data.maxHp));
      spawnSlash(this.engine.scene, { x: h.x, z: h.z }, crit ? 0xff5040 : 0xff9a7a, 0.7);
      if (dealt > 0 && this.applyOnDamagedPerks) this.applyOnDamagedPerks(h, m, dealt);
      if (dealt > 0) this.applyOnHitAbilities(m, h);
      log(`${m.data.name} shoots ${h.data.name} for ${dealt}${crit ? ' (crit!)' : ''}`, crit ? 'down' : 'roll',
        { cat: 'hitmiss' });
      updatePartyFrames(this.heroes.map(x => x.data));
      if (h.data.hp <= 0) {
        h.data.hp = 0; h.data.downs++;
        log(`💀 ${h.data.name} goes down!`, 'down');
        /* onKill riders on the shooter (gnoll-hunter Rampage, etc.). */
        if (m?.data?.abilities) this.applyOnKillAbilities(m, h);
      }
    });
  },

  /** Apply boss-inflicted damage to a hero: HP, bar, floater, downs, perks.
   *  `dmgType` is plumbed for future hero-resistance support (roadmap 2F);
   *  heroes have no statblock resistance yet, so it is not currently reduced. */
  hurtHero(h, dmg, src, colorHex = 0xff5040, dmgType = null) {
    if (h.data.hp <= 0) return 0;
    const dealt = this.applyIncomingDamage ? this.applyIncomingDamage(h, dmg) : (h.data.hp -= dmg, dmg);
    hitFlash(h.ent);
    makeFloatText(this.engine.scene, String(dealt), _v.set(h.x, 1.2, h.z), '#ff7a5a');
    drawBar(h.ent.bar, Math.max(0, h.data.hp / h.data.maxHp));
    spawnSlash(this.engine.scene, { x: h.x, z: h.z }, colorHex, 0.8);
    if (dealt > 0 && this.applyOnDamagedPerks) this.applyOnDamagedPerks(h, src, dealt);
    if (h.data.hp <= 0) {
      h.data.hp = 0; h.data.downs++;
      if (this.engine) this.engine.triggerShake(0.7, 0.35);
      log(`💀 ${h.data.name} goes down!`, 'down');
      /* onKill riders on the killer (gnoll Rampage, vampire lifesteal…). */
      if (src?.data?.abilities) this.applyOnKillAbilities(src, h);
    }
    return dealt;
  },

  /** onKill riders: fire abilities when this monster downs a hero. */
  applyOnKillAbilities(m, h) {
    const abs = m.data?.abilities;
    if (!abs || !h) return;
    for (const ab of abs) {
      if (ab.trigger !== 'onKill') continue;
      this._resolveAbilityOnHero(m, h, ab, ab.label || 'onKill ability');
    }
    updatePartyFrames(this.heroes.map(x => x.data));
  },

  /** Boss pool / data-driven cycle ability, if the cadence is due.
   *  Returns true if an ability was used (the monster's action is spent). */
  tryMonsterCycleAbility(m, tgt) {
    /* legacy boss pool takes precedence */
    const spells = m.isBoss ? BOSS_SPELLS[m.data.id] : null;
    if (spells) {
      if ((m._spellCycle || 0) >= BOSS_SPELL_EVERY) {
        m._spellCycle = 0;
        this.monsterCastSpell(m, tgt, spells);
        return true;
      }
      return false;
    }
    const abs = m.data.abilities;
    if (!abs) return false;
    const cyc = abs.filter(a => a.trigger === 'cycle');
    if (!cyc.length) return false;
    const ab = cyc[Math.floor(Math.random() * cyc.length)];
    if ((m._spellCycle || 0) < (ab.every || MONSTER_ABILITY_EVERY)) return false;
    m._spellCycle = 0;
    this.monsterUseAbility(m, tgt, ab);
    return true;
  },

  /** Count a real attack toward the monster's ability cadence. */
  _countSwing(m) {
    if ((m.isBoss && BOSS_SPELLS[m.data.id]) ||
        (m.data.abilities && m.data.abilities.some(a => a.trigger === 'cycle'))) {
      m._spellCycle = (m._spellCycle || 0) + 1;
    }
  },

  /** Boss casts a random spell from its pool AT THE PARTY (see BOSS_SPELL_FX). */
  monsterCastSpell(m, tgt, spellPool) {
    const spellKey = spellPool[Math.floor(Math.random() * spellPool.length)];
    const fx = BOSS_SPELL_FX[spellKey];
    const label = (fx && fx.label) || (SPELLS[spellKey] && SPELLS[spellKey].label) || 'a dark spell';
    this._castAbilityFx(m, tgt, fx, label, spellKey);
  },

  /** A monster uses one of its data-driven `abilities` entries (fx-shaped). */
  monsterUseAbility(m, tgt, ab) {
    this._castAbilityFx(m, tgt, ab, ab.label || 'an ability', ab.spell || ab.key);
  },

  /** Shared use-an-ability action: telegraph, then resolve vs the party.
   *  `fx` is a BOSS_SPELL_FX entry or a monsters.json `abilities` entry —
   *  same shape: { label, color, sprite, aoe?, dice?, dmgType?, save?, effect?, heal? }
   *  `key` is the spell name when the ability has one, so it shares the
   *  player-side sound; otherwise abilitySfx() picks a slot from its shape. */
  _castAbilityFx(m, tgt, fx, label, key) {
    m.walk = false;
    m.moving = false;
    m.path = null;
    m.actUsed = true;
    m.ent.grp.rotation.y = Math.atan2(tgt.x - m.x, tgt.z - m.z);

    playSfx(abilitySfx(key, fx), { volume: m.isBoss ? 0.75 : 0.6 });
    log(`✨ ${m.data.name} uses ${label}!`, 'crit');
    if (m.isBoss && this.engine) this.engine.triggerShake(0.9, 0.4);
    this.triggerLunge(m, tgt);
    makeFloatText(this.engine.scene, label, _v.set(m.x, 1.5, m.z), '#e8c25a');
    if (!fx) return;   // unknown spell → flourish only, no effect

    const sprite = fx.sprite ? `dcss/effect/${fx.sprite}.png` : null;

    /* Support spell: heal the caster and any wounded minions nearby. */
    if (fx.heal) {
      const allies = [m, ...this.monsters.filter(o =>
        o !== m && !o.dead && o.data.hp > 0 && Math.hypot(o.x - m.x, o.z - m.z) < 3.5)];
      for (const o of allies) {
        const amt = roll(fx.heal[0], fx.heal[1], fx.heal[2]);
        o.data.hp = Math.min(o.data.maxHp, o.data.hp + amt);
        drawBar(o.ent.bar, Math.max(0, o.data.hp / o.data.maxHp), '#e0483a');
        makeFloatText(this.engine.scene, '+' + amt, _v.set(o.x, 1.2, o.z), '#6ae06a');
        if (sprite) spawnSpriteEffect(this.engine.scene, sprite, new THREE.Vector3(o.x, 0.5, o.z), 1.2, 0.4);
      }
      return;
    }

    /* Offensive / debuff spell: resolve against the party. */
    const heroes = this.heroes.filter(h => h.data.hp > 0);
    let targets;
    if (fx.aoe) {
      targets = heroes.filter(h => Math.hypot(h.x - tgt.x, h.z - tgt.z) <= fx.aoe);
      if (targets.length === 0 && tgt.data.hp > 0) targets = [tgt];
      spawnTelegraph(this.engine.scene, { x: tgt.x, z: tgt.z }, fx.aoe, fx.color || 0xe04040, 0.8);
    } else {
      targets = tgt.data.hp > 0 ? [tgt] : (heroes.length ? [heroes[0]] : []);
      spawnTelegraph(this.engine.scene, { x: tgt.x, z: tgt.z }, 1.2, fx.color || 0xe04040, 0.6);
    }

    for (const h of targets) this._resolveAbilityOnHero(m, h, fx, label, { aoe: !!fx.aoe });
    updatePartyFrames(this.heroes.map(x => x.data));
  },

  /** Resolve one ability instance against one hero: save → damage → condition.
   *  Shared by cycle casts, onHit riders, auras, and death bursts. */
  _resolveAbilityOnHero(m, h, fx, label, opts = {}) {
    let saveRes = null;
    if (fx.save) {
      const abStat = fx.save.ab || 'con';
      const prof = m.data.statblock?.prof || Math.max(2, Math.floor((m.data.cr || 1) / 4) + 2);
      const statVal = m.data.effStats?.[abStat] ?? m.data.statblock?.stats?.[abStat] ?? 10;
      const statMod = Math.floor((statVal - 10) / 2);
      const calculatedDC = 8 + prof + statMod;
      dc = fx.save.dc != null ? Math.max(fx.save.dc, calculatedDC) : calculatedDC;
      saveRes = rollSaveDetail(h.data || h, fx.save.ab, dc, { magic: !!fx.magic });
    }
    const saved = saveRes ? saveRes.saved : false;
    spawnRichAbilityVFX(this.engine.scene, m, h, fx, label, opts);

    if (fx.save && saveRes) {
      const rollStr = `${saveRes.d20} + ${saveRes.mod} = ${saveRes.total}`;
      if (saved) {
        log(`🛡️ ${h.data.name} succeeds on the ${fx.save.ab.toUpperCase()} save vs ${m.data.name}'s ${label}!`, 'roll',
          { detail: `(${rollStr} vs DC ${dc})` });
      } else {
        log(`⚡ ${h.data.name} fails the ${fx.save.ab.toUpperCase()} save vs ${m.data.name}'s ${label}!`, 'down',
          { detail: `(${rollStr} vs DC ${dc})` });
      }
    }

    if (fx.dice) {
      let dmg = roll(fx.dice[0], fx.dice[1], fx.dice[2] || 0);
      if (saved) dmg = fx.save && fx.save.half ? Math.floor(dmg / 2) : 0;
      if (dmg > 0) {
        log(`${m.data.name}'s ${label} hits ${h.data.name} for ${dmg}${saved ? ' (saved for half)' : ''}`, 'down');
        this.hurtHero(h, dmg, m, fx.color || 0xff5040, fx.dmgType);
      } else {
        makeFloatText(this.engine.scene, saved ? 'save!' : 'resist', _v.set(h.x, 1.1, h.z), '#9aa');
      }
    } else if (saved) {
      makeFloatText(this.engine.scene, 'save!', _v.set(h.x, 1.1, h.z), '#9aa');
    }

    if (fx.effect && !saved) {
      const eOpts = { duration: fx.effect.dur, elapsed: this.fxNow, source: m };
      /* repeat save each round to shake the condition off (5e "at the end
         of each of its turns") — reuses the ability's own save & DC */
      if (fx.effect.repeatSave && fx.save)
        eOpts.repeatSave = { ability: fx.save.ab, dc: fx.save.dc, every: 6 };
      /* until-rest debuffs (drained / corroded) carry no duration; tag them
         so rest.js clears them on a short/long rest */
      if (fx.effect.dur == null) eOpts.tag = 'rest';
      if (fx.effect.dotDmg != null) eOpts.dotDmg = fx.effect.dotDmg;
      if (applyEffect(h, fx.effect.key, eOpts)) {
        /* Drained: life-drain also bites max HP until a rest (5e wight/wraith) */
        if (fx.effect.key === 'drained') {
          const bite = fx.effect.drainHp || 5;
          h.data.hpDrain = (h.data.hpDrain || 0) + bite;
          h.data.maxHp = Math.max(1, h.data.maxHp - bite);
          if (h.data.hp > h.data.maxHp) h.data.hp = h.data.maxHp;
          drawBar(h.ent.bar, Math.max(0, h.data.hp / h.data.maxHp));
        }
        makeFloatText(this.engine.scene, fx.effect.key, _v.set(h.x, 1.35, h.z), '#d0a0ff');
        log(`✨ ${h.data.name} is now ${fx.effect.key}!`, 'crit');
      }
    }
  },

  /** onHit riders (poison bites, paralysis claws, life drain…) after a
   *  successful monster hit on a hero. */
  applyOnHitAbilities(m, h) {
    const abs = m.data.abilities;
    if (!abs || h.data.hp <= 0) return;
    for (const ab of abs) {
      if (ab.trigger !== 'onHit') continue;
      if (ab.chance != null && Math.random() > ab.chance) continue;
      this._resolveAbilityOnHero(m, h, ab, ab.label || 'an ability');
    }
    updatePartyFrames(this.heroes.map(x => x.data));
  },

  tickMonsterAuras(actor) {
    return this.processTurnAuras(actor);
  },

  /**
   * Turn Engine 5e SRD Aura Processor:
   * Called on turn start in initiative (_beginTurn) and during tactical movement.
   *
   * Abilities with `fxOnly: true` are pure visual flavor (giant-fire-beetle
   * glow, fire-bat ember halo, etc.) — they spawn the telegraph sprite on
   * turn start but skip target resolution.
   */
  processTurnAuras(actor) {
    if (!this.initiative || !this.initiative.active || !actor) return;
    const round = this.initiative.round || 1;

    if (actor._side === 'hero' && actor.data && actor.data.hp > 0) {
      /* Hero starting turn or moving: check all active living monsters with auras */
      if (!this.monsters) return;
      for (const m of this.monsters) {
        if (!m.active || !m.data || m.data.hp <= 0 || !m.data.abilities) continue;
        for (const ab of m.data.abilities) {
          if (ab.trigger !== 'aura' || ab.fxOnly) continue;
          const r = ab.aoe || ab.radius || 2.0;
          const d = Math.hypot(actor.x - m.x, actor.z - m.z);
          if (d <= r) {
            actor._auraProcessed = actor._auraProcessed || {};
            const mId = m.data.id || (m.x.toFixed(1) + '_' + m.z.toFixed(1));
            const key = `${mId}_${ab.key || ab.label}_r${round}`;
            if (!actor._auraProcessed[key]) {
              actor._auraProcessed[key] = true;
              spawnTelegraph(this.engine.scene, { x: m.x, z: m.z }, r, ab.color || 0x88aa66, 0.5);
              this._resolveAbilityOnHero(m, actor, ab, ab.label || 'an aura');
              if (this.heroes) updatePartyFrames(this.heroes.map(x => x.data));
            }
          }
        }
      }
    } else if (actor._side === 'mon' && actor.active && actor.data && actor.data.hp > 0 && actor.data.abilities) {
      /* Monster starting turn: pulse visual telegraph and resolve aura on all nearby heroes */
      for (const ab of actor.data.abilities) {
        if (ab.trigger !== 'aura') continue;
        const r = ab.aoe || ab.radius || 2.0;
        spawnTelegraph(this.engine.scene, { x: actor.x, z: actor.z }, r, ab.color || 0x88aa66, 0.5);
        if (ab.fxOnly) continue;
        if (!this.heroes) continue;
        const targets = this.heroes.filter(h => h.data && h.data.hp > 0 && Math.hypot(h.x - actor.x, h.z - actor.z) <= r);
        for (const h of targets) {
          h._auraProcessed = h._auraProcessed || {};
          const mId = actor.data.id || (actor.x.toFixed(1) + '_' + actor.z.toFixed(1));
          const key = `${mId}_${ab.key || ab.label}_r${round}`;
          if (!h._auraProcessed[key]) {
            h._auraProcessed[key] = true;
            this._resolveAbilityOnHero(actor, h, ab, ab.label || 'an aura');
          }
        }
        if (targets.length) updatePartyFrames(this.heroes.map(x => x.data));
      }
    }
  },

  /** onDeath burst (magmin…): AoE save-for-half centered on the corpse.
   *  Called from killMonster. */
  monsterDeathBurst(m) {
    const abs = m.data.abilities;
    if (!abs) return;
    for (const ab of abs) {
      if (ab.trigger !== 'onDeath') continue;
      const r = ab.aoe || 2.0;
      const targets = this.heroes.filter(h => h.data.hp > 0 && Math.hypot(h.x - m.x, h.z - m.z) <= r);
      log(`💥 ${m.data.name}'s ${ab.label || 'death burst'}!`, 'crit');
      spawnTelegraph(this.engine.scene, { x: m.x, z: m.z }, r, ab.color || 0xff7a30, 0.7);
      for (const h of targets) this._resolveAbilityOnHero(m, h, ab, ab.label || 'death burst', { aoe: true });
      updatePartyFrames(this.heroes.map(x => x.data));
    }
  },

  /** onDamaged riders: when this monster takes damage, fire abilities that
   *  retaliate against the attacker (fire elemental Fire Form, salamander
   *  Heated Body, etc.). Called from combat.js damageMonster. */
  applyOnDamagedAbilities(m, attacker, dmg, opts = {}) {
    const abs = m.data.abilities;
    if (!abs || dmg <= 0 || m.data.hp <= 0 || !attacker || attacker.data?.hp <= 0) return;
    for (const ab of abs) {
      if (ab.trigger !== 'onDamaged') continue;
      if (ab.chance != null && Math.random() > ab.chance) continue;
      /* Default target: the attacker. Some abilities (devils' Hellish
         Rebuke style) could AoE, but the data schema treats this as a
         single-target retaliation unless `aoe` is set. */
      if (ab.aoe) {
        const r = ab.aoe;
        const targets = this.heroes.filter(h => h.data.hp > 0 && Math.hypot(h.x - m.x, h.z - m.z) <= r);
        spawnTelegraph(this.engine.scene, { x: m.x, z: m.z }, r, ab.color || 0xff7a30, 0.5);
        for (const h of targets) this._resolveAbilityOnHero(m, h, ab, ab.label || 'retaliation');
      } else {
        this._resolveAbilityOnHero(m, attacker, ab, ab.label || 'retaliation');
      }
      updatePartyFrames(this.heroes.map(x => x.data));
    }
  },

  /** onKill riders: when this monster kills a hero, fire self-buffs (gnoll
   *  Rampage), self-heals (vampire blood drain), or AoE effects (frightful
   *  presence triggered by the kill). Called from the 3 hero-death sites in
   *  monster_ai.js. */
  applyOnKillAbilities(m, deadHero) {
    const abs = m.data.abilities;
    if (!abs || m.data.hp <= 0) return;
    for (const ab of abs) {
      if (ab.trigger !== 'onKill') continue;
      if (ab.chance != null && Math.random() > ab.chance) continue;
      let didSomething = false;
      /* heal: vampire-style lifesteal on kill */
      if (ab.heal) {
        const before = m.data.hp;
        m.data.hp = Math.min(m.data.maxHp, m.data.hp + ab.heal);
        const gained = m.data.hp - before;
        if (gained > 0) {
          makeFloatText(this.engine.scene, '+' + gained, _v.set(m.x, 1.4, m.z), '#6ae06a');
          drawBar(m.ent.bar, Math.max(0, m.data.hp / m.data.maxHp), '#6ae06a');
        }
        log(`🩸 ${m.data.name}'s ${ab.label || 'kill buff'} (+${gained} HP).`, 'heal');
        didSomething = true;
      }
      /* buff: apply a status effect to self (raging / bloodlust / hasted…) */
      if (ab.buff) {
        const effKey = typeof ab.buff === 'string' ? ab.buff : ab.buff.key;
        const dur = (typeof ab.buff === 'object' ? ab.buff.dur : null) || ab.dur || 5;
        applyEffect(m, effKey, { duration: dur, elapsed: this.fxNow });
        log(` ${m.data.name}'s ${ab.label || 'kill buff'}!`, 'crit');
        makeFloatText(this.engine.scene, ab.label || 'kill buff', _v.set(m.x, 1.5, m.z), '#e8c25a');
        didSomething = true;
      }
      /* AoE: also frighten / damage nearby heroes (death-knight-style) */
      if (ab.aoe && (ab.dice || ab.effect)) {
        const r = ab.aoe;
        const targets = this.heroes.filter(h => h.data.hp > 0 && Math.hypot(h.x - m.x, h.z - m.z) <= r);
        spawnTelegraph(this.engine.scene, { x: m.x, z: m.z }, r, ab.color || 0xff7a30, 0.5);
        for (const h of targets) this._resolveAbilityOnHero(m, h, ab, ab.label || 'kill aura');
        updatePartyFrames(this.heroes.map(x => x.data));
        didSomething = true;
      }
      /* Centered sprite for the kill moment — if the ability declared one
         and we actually did something above. Covers vampire-spawn blood-feast
         (drain_red_2), gnoll/orc rampage (gold_sparkles_1), etc. */
      if (didSomething) {
        playSfx(abilitySfx(ab.spell || ab.key, ab), { volume: 0.55 });
        if (ab.sprite) {
          spawnSpriteEffect(this.engine.scene, `dcss/effect/${ab.sprite}.png`,
            new THREE.Vector3(m.x, 1.0, m.z), 1.4, 0.7);
        }
      }
    }
  },

  /** onBloodied riders: fire once the first time a monster's HP drops below
   *  50%. Used for flesh-golem Berserk, hydra head-regrow, enrage-style
   *  triggers. Called from combat.js damageMonster. */
  applyOnBloodiedAbilities(m) {
    const abs = m.data.abilities;
    if (!abs || m.data.hp <= 0) return;
    for (const ab of abs) {
      if (ab.trigger !== 'onBloodied') continue;
      let didSomething = false;
      /* buff: standard self-buff (most common — Berserk, Bloodlust). */
      if (ab.buff) {
        const effKey = typeof ab.buff === 'string' ? ab.buff : ab.buff.key;
        const dur = (typeof ab.buff === 'object' ? ab.buff.dur : null) || ab.dur || 8;
        applyEffect(m, effKey, { duration: dur, elapsed: this.fxNow });
        log(`${m.data.name} ${ab.label || 'enrages'}!`, 'crit');
        makeFloatText(this.engine.scene, ab.label || 'ENRAGED', _v.set(m.x, 1.5, m.z), '#ff5040');
        if (this.engine) this.engine.triggerShake(0.5, 0.25);
        didSomething = true;
      }
      /* AoE: some bloodied triggers pulse outward (frightful presence) */
      if (ab.aoe && (ab.dice || ab.effect)) {
        const r = ab.aoe;
        const targets = this.heroes.filter(h => h.data.hp > 0 && Math.hypot(h.x - m.x, h.z - m.z) <= r);
        spawnTelegraph(this.engine.scene, { x: m.x, z: m.z }, r, ab.color || 0xff7a30, 0.6);
        for (const h of targets) this._resolveAbilityOnHero(m, h, ab, ab.label || 'bloodied aura');
        updatePartyFrames(this.heroes.map(x => x.data));
        didSomething = true;
      }
      /* Enrage visual — flame_0 family is canonical (matches player Rage). */
      if (didSomething) {
        playSfx(abilitySfx(ab.spell || ab.key, ab), { volume: 0.6 });
        if (ab.sprite) {
          spawnSpriteEffect(this.engine.scene, `dcss/effect/${ab.sprite}.png`,
            new THREE.Vector3(m.x, 1.0, m.z), 1.8, 0.9);
        }
      }
    }
  },

  monsterChase(m, tgt, dt) {
    if (hasEffect(m, 'charmed')) {
      m.walk = false;
      return;
    }
    /* incapacitated monsters cannot act */
    const mods = getEffectMods(m);
    if (mods.incapacitated) { m.walk = false; return; }

    /* Combat-room leash: give up the chase if the target has retreated
       well beyond the room where the fight started.  Prevents long
       pursuit across the map without any physics force — the monster
       simply holds its ground.  Same fuzzy-AI pattern as the existing
       inHome check in monsterKite(). */
    if (!this.initiative?.active && this.beyondCombatLeash(tgt.x, tgt.z)) { m.walk = false; return; }

    m.repathT -= dt;
    if (m.repathT <= 0 || !m.path || m.pathI >= m.path.length) {
      let goal = this.cellOf(tgt.x, tgt.z);
      /* flank: aim for the far side of the target if allies are already
         clustered on it, so melee wraps around instead of stacking */
      const flank = this.flankGoal(m, tgt);
      if (flank >= 0) goal = flank;
      /* Avoid pathing directly onto a cell already occupied by another monster */
      goal = this.nearUnoccupiedGoal(m, goal);
      m.path = this.findPath(this.cellOf(m.x, m.z), goal, { avoidClosedDoors: true });
      m.pathI = 0;
      m.repathT = MONSTER_REPATH_CD;
    }
    let spd = m.data.speed * MONSTER_SPEED_MULT * mods.speedMul;
    if (m.slowUntil && this.elapsed < m.slowUntil) spd *= 0.5;  // legacy compat
    /* Slow down in chokepoints so monsters don't jam doorways against
       heroes trying to pass through. */
    if (this.D.chokepoint) {
      const mc = this.cellOf(m.x, m.z);
      const tc = this.cellOf(tgt.x, tgt.z);
      if ((mc >= 0 && this.D.chokepoint[mc]) ||
          (tc >= 0 && this.D.chokepoint[tc])) {
        spd *= 0.4;
      }
    }
    const moved = this.moveStep(m, spd, dt);
    m.walk = moved;

    /* Monster stuck-recovery. Heroes get multi-stage handleStuck; monsters had
       nothing, so a body wedged against a doorway frame (stepAlong reports no
       progress) used to sit there until its next scheduled repath produced the
       same blocked route. Nudge it perpendicular to the approach to slip off
       the frame, then force an immediate repath (a fresh flank goal often
       routes it to the other side of the target). A doorway single-file yield
       is expected, so only recover once genuinely stuck for ~0.6 s.
       Guarded by canMove so an OFF-TURN monster (held still by moveStep) is
       never mistaken for stuck and nudged/repathed off its square. */
    if (!moved && this.canMove(m)) {
      m._stuckT = (m._stuckT || 0) + dt;
      if (m._stuckT > 0.6) {
        const toX = tgt.x - m.x, toZ = tgt.z - m.z, tl = Math.hypot(toX, toZ) || 1;
        const px = -toZ / tl, pz = toX / tl;   /* perpendicular to approach */
        const nudge = 0.4;
        let nudged = false;
        if (!this.blocked(m.x + px * nudge, m.z + pz * nudge, TIGHT_R)) {
          m.x += px * nudge; m.z += pz * nudge; nudged = true;
        } else if (!this.blocked(m.x - px * nudge, m.z - pz * nudge, TIGHT_R)) {
          m.x -= px * nudge; m.z -= pz * nudge; nudged = true;
        }
        if (!nudged) {
          /* Fallback longitudinal nudge for 1-wide doorways where sides are walls */
          const lx = toX / tl, lz = toZ / tl;
          if (!this.blocked(m.x + lx * nudge, m.z + lz * nudge, TIGHT_R)) {
            m.x += lx * nudge; m.z += lz * nudge;
          } else if (!this.blocked(m.x - lx * nudge, m.z - lz * nudge, TIGHT_R)) {
            m.x -= lx * nudge; m.z -= lz * nudge;
          }
        }
        m.path = null; m.pathI = 0; m.repathT = 0; m._stuckT = 0;
      }
    } else {
      m._stuckT = 0;
    }
  },

  monsterMelee(m, tgt, dt) {
    m.walk = false;
    m.moving = false;
    m.path = null;
    m.ent.grp.rotation.y = Math.atan2(tgt.x - m.x, tgt.z - m.z);
    if (!m.actUsed) {
      m.actUsed = true;
      /* Count this swing toward the ability cast cadence (see tryMonsterCycleAbility). */
      this._countSwing(m);
      this.monsterAttack(m, tgt);
      /* Multiattack (5e): `attacksPerTurn: N` strikes N times per cd window.
         Extra attacks only fire while the target lives, matching the hero
         Extra Attack pattern at combat.js. Default 1 = no multiattack. */
      const extra = Math.max(0, (m.data.attacksPerTurn || 1) - 1);
      for (let i = 0; i < extra && tgt.data.hp > 0; i++) {
        this.monsterAttack(m, tgt);
      }
    }
  },

  /** One monster → hero attack roll + damage. */
  monsterAttack(m, h) {
    /* charmed or incapacitated monsters skip attacks */
    if (hasEffect(m, 'charmed')) {
      makeFloatText(this.engine.scene, 'charmed', _v.set(m.x, 1.1, m.z), '#e8a8ff');
      return;
    }
    if (getEffectMods(m).incapacitated) return;
    const dmgDealtMul = getEffectMods(m).dmgDealtMul;
    this.triggerLunge(m, h);
    const adv = this.monsterAttackAdv(m, h);
    const d20 = d20Roll(adv);
    const atkMods = getEffectMods(m);
    let atkBonus = m.data.atk + (atkMods.atkBonus || 0);
    if (atkMods.blessDice) atkBonus += d(4);
    const total = d20 + atkBonus;
    let crit = d20 === 20;
    /* defender auto-crit on melee (paralyzed/unconscious) */
    if (getEffectMods(h).autoCritMelee) crit = true;
    if (crit && this.engine) this.engine.triggerHitStop(2);
    const ac = this.heroAC(h);
    playSfx('swordAttack', { volume: 0.5 });
    if (!crit && total < ac) {
      makeFloatText(this.engine.scene, 'miss', _v.set(h.x, 1.1, h.z), '#9aa');
      playSfx(Math.random() < 0.5 ? 'swordBlock' : 'swordParry', { volume: 0.5 });
      log(`${m.data.name} → ${h.data.name}: miss`, 'miss',
        { detail: `(${total} vs AC ${ac}${adv > 0 ? ', adv' : adv < 0 ? ', dis' : ''})` });
      return;
    }

    let dice = m.data.dmg[0]; if (crit) dice *= 2;
    const statKey = m.data.ranged ? 'dex' : 'str';
    const statVal = m.data.effStats?.[statKey] ?? m.data.statblock?.stats?.[statKey] ?? 10;
    const statMod = Math.floor((statVal - 10) / 2);
    const dmgBonus = Math.max(m.data.dmg[2] || 0, statMod);
    let dmg = roll(dice, m.data.dmg[1], dmgBonus);
    dmg = Math.round(dmg * dmgDealtMul);
    if (dmg >= 15 && this.engine) this.engine.triggerShake(0.4, 0.2);
    if (m.cutWordsUntil && this.fxNow < m.cutWordsUntil) dmg = Math.max(1, dmg - 2);

    /* explicit cat: a crit uses the 'down' style, which is otherwise reserved
       for hero-drops and never suppressed. */
    log(`${m.data.name} hits ${h.data.name} for ${dmg}${crit ? ' (crit!)' : ''}`, crit ? 'down' : 'roll',
      { cat: 'hitmiss' });
    playSfx('swordHit', { volume: 0.6 });
    if (crit && this.engine) {
      this.engine.triggerHitStop(4);
      this.engine.triggerShake(0.5, 0.25);
    } else if (this.engine) {
      this.engine.triggerHitStop(1);
    }
    spawnMeleeHitVFX(this.engine.scene, { x: h.x, z: h.z }, { x: m.x, z: m.z }, crit, 'slashing', 0.9);
    const dealt = this.applyIncomingDamage ? this.applyIncomingDamage(h, dmg) : (h.data.hp -= dmg, dmg);
    hitFlash(h.ent);
    makeFloatText(this.engine.scene, String(dealt), _v.set(h.x, 1.2, h.z), crit ? '#ff5040' : '#ff9a7a');
    drawBar(h.ent.bar, Math.max(0, h.data.hp / h.data.maxHp));
    /* legendary defensive perks (thorns / riposte) */
    if (dealt > 0 && this.applyOnDamagedPerks) this.applyOnDamagedPerks(h, m, dealt);
    /* onHit ability riders (poison bite, paralysis claws, life drain…) */
    if (dealt > 0) this.applyOnHitAbilities(m, h);
    updatePartyFrames(this.heroes.map(x => x.data));
    if (h.data.hp <= 0) {
      h.data.hp = 0; h.data.downs++;
      if (this.engine) this.engine.triggerShake(0.7, 0.35);
      log(`💀 ${h.data.name} goes down!`, 'down');
      /* onKill riders (gnoll Rampage, vampire lifesteal…). */
      if (m?.data?.abilities) this.applyOnKillAbilities(m, h);
    }
  },

  /**
   * Presentation: position, walk bob, attack lunge orientation.
   * Kept next to AI so monster visual state stays in one place.
   */
  updateMonsterVisuals(dt, elapsed, cosC, sinC) {
    for (const m of this.monsters) {
      if (m.data.hp <= 0) continue;
      const [ox, oz] = this.lungeOffset(m, dt);
      m.ent.grp.position.set(m.x + ox, 0, m.z + oz);

      const angle = m.ent.grp.rotation.y;
      const mdx = Math.sin(angle), mdz = Math.cos(angle);
      const rdx = mdx * cosC - mdz * sinC;
      const rdz = mdx * sinC + mdz * cosC;

      if (m.lungeT > 0) {
        const lrdx = m.lungeDX * cosC - m.lungeDZ * sinC;
        const lrdz = m.lungeDX * sinC + m.lungeDZ * cosC;
        m.ent.anim.setDirection(lrdx, lrdz);
        m.ent.anim.mesh.position.y = 0;
      } else {
        m.ent.anim.setDirection(rdx, rdz);
        if (m.walk) {
          m.ent.anim.mesh.position.y = Math.abs(Math.sin(elapsed * 9)) * 0.08;
        } else {
          m.ent.anim.time = 0;
          m.ent.anim.mesh.position.y = 0;
        }
      }
      m.ent.anim.update(dt);
    }
  }
};
