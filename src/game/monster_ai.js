/**
 * Monster AI — activation, targeting, chase, and attack cadence.
 *
 * Expand here as enemy behavior grows (pack tactics, ranged, leashing,
 * ability casts, boss phases, etc.). Attack *resolution* (rolls/damage
 * visuals) lives in `monsterAttack`; hero-side combat stays in combat.js.
 *
 * Mixed onto Game — uses pathfinding (findPath, stepAlong) and combat helpers
 * (heroAC, triggerLunge).  All VFX/UI/audio calls go through this.* hooks
 * (see game_hooks.js) so the same code runs headlessly in Node.js.
 */
import { SPELLS } from './spells.js';
import { PLANNER, planMonsterAbility, monsterTargetReach } from './turn_planner.js';
import { gridDist, inMortalDanger } from './combat_eval.js';
import { roll, d as die, d20Roll } from './srd.js';
import { hasFeature, hasFeat, hasShieldEquipped } from './features.js';
import { AGGRO_RANGE, COMBAT_JOIN_RANGE, MONSTER_ATTACK_CD, MONSTER_SPEED_MULT,
  THREAT_WEIGHT, THREAT_DIST_WEIGHT, THREAT_JITTER, THREAT_HALFLIFE_SEC, TARGET_SWITCH_MARGIN,
  KITE_THREAT_RANGE, KITE_RETREAT_DIST, KITE_COMMIT_SEC,
  TACTICAL_BLOODIED_FRAC, TACTICAL_DODGE_BLOODIED_FRAC, TACTICAL_DODGE_PIN_THREATS,
  FLANK_OFFSET, PACK_TAGS, PACK_IDS, PACK_FOCUS_BONUS, FLOOR, WALL } from './constants.js';
import { hasEffect, getEffectMods, tickEffects as _tickEffects, applyEffect, clearEffect, rollSave, rollSaveDetail, ROUND_SECONDS } from './conditions.js';
import { sightAdvantage, noteAttackFromDark, canSee, noticeRangeMul } from './light_rules.js';
import { monsterLightTraits } from './monster_light.js';
import { lightStateOf, addDarkZone, VIRTUAL_LIGHTS, zonePos } from './light_sources.js';
import { provokesOA, strikeInterval, attackAnimDelay, scheduleFollowUpStrike, actionAnimBusy, actionAnimRemaining } from './turn_engine.js';
import { SPELL_CHARGE_SECONDS } from '../render/body_fx.js';
import { groundY as groundYAt, easeBodyY } from '../dungeon/elevation.js';
import { Motion } from './motion_debug.js';
import { FACING_BAND_MOVE, FACING_BAND_REST } from './sprite_animator.js';
import { firstRunTip } from './help_ui.js';

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

/** Maps an ability definition or spell element to a procedural pixel VFX preset */
export function getPixelVfxTypeForAbility(ab) {
  if (!ab) return 'shockwave';
  const key = (ab.key || '').toLowerCase();
  const label = (ab.label || ab.name || '').toLowerCase();
  const elem = (ab.elem || ab.damageType || '').toLowerCase();

  if (key === 'gibbering' || label.includes('gibbering') || elem === 'psychic') {
    return 'gibbering';
  }
  if (key === 'stench' || key === 'fetid_cloud' || label.includes('stench') || label.includes('fetid') || elem === 'poison' || elem === 'acid') {
    return 'stench';
  }
  if (elem === 'fire' || key.includes('fire') || label.includes('fire') || label.includes('flame') || label.includes('burn')) {
    return 'fire';
  }
  if (elem === 'cold' || elem === 'frost' || label.includes('frost') || label.includes('cold') || label.includes('ice') || label.includes('blizzard')) {
    return 'frost';
  }
  if (elem === 'radiant' || elem === 'holy' || label.includes('holy') || label.includes('radiant') || label.includes('sanctuary') || label.includes('bless')) {
    return 'holy';
  }
  return 'shockwave';
}

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

/* ── Monster combat style (role) ──────────────────────────────────────
   A lightweight identity used to decide when the Action-spending fallbacks
   (Dash / Dodge / Disengage) are worth taking, so monsters stop spamming
   them. Derived from existing data — no data migration — but any monster can
   override it with `m.data.tactics`
   ('ranged' | 'skirmisher' | 'brute' | 'tank' | 'berserker' | 'standard'). */
/** Phase 3 monster rules on? (turn_planner PLANNER switches) */
function planned() {
  return PLANNER.on && PLANNER.monsters !== false && PLANNER.monsterMoves !== false;
}

export function monsterCombatStyle(m) {
  const d = (m && m.data) || {};
  if (d.tactics) return d.tactics;
  if (d.ranged) return 'ranged';
  if (d.bloodFrenzy) return 'berserker';
  if (d.martialAdvantage) return 'brute';
  const spd = d.speed || 0;
  const hp = d.maxHp || d.hp || 0;
  if (spd <= 2.8 && hp >= 30) return 'tank';       // slow + sturdy → hold the line
  if (spd >= 4.2 && hp <= 45) return 'skirmisher'; // fast + fragile → dart in and out
  return 'standard';
}

/** How hurt a monster is (0 = full HP … 1 = dead). */
export function monsterHurtFrac(m) {
  const d = (m && m.data) || {};
  const maxHp = d.maxHp || d.hp || 1;
  return maxHp > 0 ? Math.max(0, Math.min(1, 1 - d.hp / maxHp)) : 1;
}

/** Whether this monster spends its Action on Disengage, given the situation.
   Berserkers never break contact; ranged/skirmishers bail out of melee;
   everything else only retreats once bloodied. Callers still decide whether a
   break is physically needed (pinned in melee / stepping through a threatened
   square). */
export function shouldDisengage(m, { pinned = false, bloodiedFrac = TACTICAL_BLOODIED_FRAC } = {}) {
  const style = monsterCombatStyle(m);
  if (style === 'berserker') return false;
  if (monsterHurtFrac(m) >= bloodiedFrac) return true;
  if (pinned && (style === 'ranged' || style === 'skirmisher')) return true;
  return false;
}

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
      this.fxUpdateFlash(m.ent, dt);

      /* tick timed effects on monsters (combat clock — see conditions.js) */
      _tickEffects(m, this.fxNow);
      this.fxStatusTray(m);
      /* Dominate Monster ran out (or the caster's concentration broke and the
         effect went with it): hand the creature back its own will. */
      if (m.dominatedBy && !hasEffect(m, 'dominated')) this.releaseDominated(m);
      const dominated = !!m.dominatedBy;
      /* Banishment: off the plane until the effect lapses — nothing below
         applies to a creature that is not here. */
      if (m._banished) {
        if (!hasEffect(m, 'banished')) this.returnBanished(m);
        continue;
      }

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
      } else if (this._cutOffFromParty(m, alive)) {
        /* Awake, but no living hero can walk to it without a gate opening —
           and no gate opens while it keeps the fight alive. The one hero who
           could reach it is dead (that is the only way a woken monster ends
           up here). Left active it would hold the party in initiative for
           ever: monsters cannot path through a shut door, heroes may not
           open one mid-fight, and the stall watchdog is off in manual mode
           and blind whenever a regenerating monster keeps the HP total
           moving. Sleep now; the survivors walk up, the gate swings, and it
           wakes on its own terms. */
        this.disengageMonster(m);
        if (typeof this.fxLog === 'function') this.fxLog(`🚪 ${m.data.name} loses track of the party behind a shut door.`, 'sys');
        continue;
      }

      /* Regeneration (SRD trait): heal per tick while below max, unless fire
         or acid damage suppressed it (m._noRegenUntil, set in damageMonster). */
      if (m.data.regen && m.data.hp < m.data.maxHp &&
          !(m._noRegenUntil && this.fxNow < m._noRegenUntil) &&
          !(monsterLightTraits(m).vampire && lightStateOf(m) === 'bright')) {   // 43: light stops a vampire mending
        m._regenT = (m._regenT || 0) + dt;
        if (m._regenT >= 3) {
          m._regenT = 0;
          m.data.hp = Math.min(m.data.maxHp, m.data.hp + m.data.regen);
          this.fxDrawBar(m.ent.bar, Math.max(0, m.data.hp / m.data.maxHp), '#e0483a');
          this.fxText('+' + m.data.regen, this._v3(m.x, 1.2, m.z), '#6ae06a');
        }
      }

      /* Light traits (docs/LIGHT_IDEAS.md 39, 40): a Shadow hides in dim light
         or darkness as a bonus action; a darkmantle wraps itself in magical
         Darkness once it wakes. */
      {
        const lt = monsterLightTraits(m);
        if (lt.shadowStealth && m.active && !m._hidden && lightStateOf(m) !== 'bright'
            && this.initiative && this.initiative.active) {
          m._hidden = true;
          if (this.fxLog) this.fxLog(`🌑 ${m.data.name} slips into the shadows.`, 'roll');
        }
        /* 43: sunlight (Sunbeam, Daylight, Radiant Flare) burns a vampire */
        if (lt.vampire && m.active) {
          let inSun = false;
          for (const L of VIRTUAL_LIGHTS) {
            if (!L.sunlight) continue;
            const p = zonePos(L);
            if (Math.hypot(p.x - m.x, p.z - m.z) <= (L.bright || 0)) { inSun = true; break; }
          }
          if (inSun) {
            m._sunBurnT = (m._sunBurnT || 0) + dt;
            if (m._sunBurnT >= 6) {
              m._sunBurnT = 0;
              const burn = (Math.floor(Math.random() * 6) + 1) + (Math.floor(Math.random() * 6) + 1);   // 2d6
              if (this.spellDamage) this.spellDamage(m, burn, null, false, { dmgType: 'radiant', magical: true });
              if (this.fxLog) this.fxLog(`☀️ ${m.data.name} smokes and burns in the sunlight! (${burn} radiant)`, 'crit');
            }
          } else m._sunBurnT = 0;
        }
        if (lt.darknessAura && m.active && !m._darkZone) {
          m._darkZone = addDarkZone({ follow: m, r: lt.darknessAura });
          if (this.fxLog) this.fxLog(`🌑 Unnatural darkness billows from ${m.data.name}!`, 'crit');
        }
      }

      /* Real-time Aura Pulse (Stench, Fetid Cloud, Gibbering, Fire Form aura, etc.):
         pulses every N seconds (default 4.0s) against all alive heroes within radius.
         A dominated creature's aura is not turned on the party. */
      if (!dominated && m.data.abilities && m.data.abilities.some(a => a.trigger === 'aura' && !a.fxOnly)) {
        m._auraT = (m._auraT || 0) + dt;
        if (m._auraT >= AURA_PULSE_EVERY) {
          m._auraT = 0;
          for (const ab of m.data.abilities) {
            if (ab.trigger !== 'aura' || ab.fxOnly) continue;
            const r = ab.aoe || ab.radius || 2.0;
            const targets = alive.filter(h => Math.hypot(h.x - m.x, h.z - m.z) <= r);
            if (targets.length > 0) {
              const vfxType = getPixelVfxTypeForAbility(ab);
              const defColor = vfxType === 'gibbering' ? 0xd946ef : (vfxType === 'stench' ? 0x84cc16 : (vfxType === 'fire' ? 0xf97316 : (vfxType === 'frost' ? 0x38bdf8 : (vfxType === 'holy' ? 0xfacc15 : 0x88aa66))));
              this.fxTelegraph({ x: m.x, z: m.z }, r, ab.color || defColor, 0.65, { type: vfxType });
              for (const h of targets) {
                this._resolveAbilityOnHero(m, h, ab, ab.label || 'an aura');
              }
            }
          }
        }
      }

      let tgt;
      if (dominated) {
        /* Fights for its master: nearest hostile monster. With none left it
           simply stands its turn. */
        tgt = this.pickDominatedTarget(m);
        if (!tgt) {
          m.walk = false; m.moving = false;
          if (this.isCurrentActor(m)) m.actUsed = true;
          continue;
        }
      } else {
        /* Hostiles see the party AND any creature the party has turned. */
        const thralls = this.dominatedMonsters();
        tgt = this.pickMonsterTarget(m, thralls.length ? alive.concat(thralls) : alive);
      }
      if (!tgt) continue;

      this.runMonsterBehavior(m, tgt, dt);

      /* Same-side overlap watchdog: with cell reservation this should never
         happen, but if it does (a reservation leak), log once and let the
         next pathing pass sort it out rather than teleporting the body. */
      if (!m.moving && !m.walk && !m._overlapLogged) {
        const mc = this.cellOf(m.x, m.z);
        if (mc >= 0) {
          const overlap = this.monsters.find(o => o !== m && o.active && o.data.hp > 0 &&
            this.cellOf(o.x, o.z) === mc);
          if (overlap) {
            m._overlapLogged = true;
            console.warn('[reservation] monster-monster overlap — possible leak', m.data && m.data.name, mc);
          }
        }
      }
    }
  },

  /**
   * Rooms the party can actually walk to without opening a door.
   *
   * A monster sealed behind a shut door cannot be fought and cannot fight back,
   * so it has no business dragging the party into initiative — but line of sight
   * alone did not guarantee that. `hasLOS` samples cells along a straight line,
   * and a sight line that clips the corner of a doorway can miss the door cell
   * entirely, waking a room the party has no way into. Once one such monster
   * woke, `activateRoomMonsters` recruited the whole sealed room with it.
   *
   * This answers the question properly: flood-fill the floor from the living
   * party, treating a closed door as a wall, and collect the rooms reached.
   *
   * One BFS, cached against door state and party position, instead of a path
   * query per monster per frame. `_unlockedDoors` only ever grows — doors never
   * re-lock — so the reachable region only ever shrinks one way: when the
   * living party itself changes. A hero who ended up past a shut gate wakes
   * the room beyond, and when he dies there the survivors are sealed off from
   * a fight that is still running. That is why active monsters are checked
   * against this too (_cutOffFromParty, in updateMonsters), not only the
   * sleeping ones.
   */
  _partyReachableRooms(alive) {
    const reach = this._partyReach(alive);
    return reach ? reach.rooms : null;
  },

  _partyReach(alive) {
    const D = this.D;
    if (!D || !D.grid || !D.roomId || !alive || !alive.length) return null;

    let key = (this._unlockedDoors ? this._unlockedDoors.size : -1) + '|';
    for (const h of alive) key += this.cellOf(h.x, h.z) + ',';
    if (this._reachRoomCache && this._reachRoomCache.key === key) {
      return this._reachRoomCache;
    }

    const W = D.W, H = D.H, total = W * H;
    const rooms = new Set();
    const seen = new Uint8Array(total);
    const q = [];
    for (const h of alive) {
      const c = this.cellOf(h.x, h.z);
      if (c >= 0 && c < total && !seen[c]) { seen[c] = 1; q.push(c); }
    }

    const doorCheck = typeof this.isCellDoorClosed === 'function';
    for (let i = 0; i < q.length; i++) {
      const c = q[i];
      const rid = D.roomId[c];
      if (rid >= 0) rooms.add(rid);
      const x = c % W, y = (c / W) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        /* Only walls and gates seal. Water is crossed by flyers and shot
           over by everyone, so a pool is part of the region, not its edge —
           otherwise a stirge hovering over a mere reads as cut off. */
        if (seen[n] || D.grid[n] === WALL) continue;
        /* A shut door is a wall for this purpose — stop, and do not mark it
           seen, so it still gets reached once it opens. */
        if (doorCheck && this.isCellDoorClosed(n)) continue;
        seen[n] = 1; q.push(n);
      }
    }

    this._reachRoomCache = { key, rooms, seen };
    return this._reachRoomCache;
  },

  /** True if `m` sits in a room the party cannot currently walk to. */
  _sealedFromParty(m, alive) {
    if (!m || m.roomId == null || m.roomId < 0) return false;
    const rooms = this._partyReachableRooms(alive);
    if (!rooms) return false;          // no map data — never block on ignorance
    return !rooms.has(m.roomId);
  },

  /** True if the cell `m` is standing on right now cannot be walked to from
   *  any living hero without opening a gate. Cell-based, unlike
   *  _sealedFromParty: `roomId` is the spawn room and a monster that chased
   *  the party two rooms over still carries it. */
  _cutOffFromParty(m, alive) {
    if (!m) return false;
    const reach = this._partyReach(alive);
    if (!reach) return false;
    const c = this.cellOf(m.x, m.z);
    if (c < 0 || c >= reach.seen.length) return false;
    /* A body clipped into a wall is a different bug with its own watchdog;
       calling it cut off would just flip it asleep and awake every frame. */
    if (this.D.grid[c] === WALL) return false;
    return !reach.seen[c];
  },

  /** Put an active monster back to sleep. Nothing about the encounter is
   *  reset beyond that: heroDecideTarget drops it as a target the moment it
   *  is inactive, and it wakes again through tryActivateMonster like any
   *  other sleeper once someone can actually reach it. */
  disengageMonster(m) {
    m.active = false;
    m._threat = null;
    m._tgtIdx = undefined;
    if (typeof this.clearEntityPath === 'function') this.clearEntityPath(m);
    else { m.path = null; m.pathI = 0; }
    m.moving = false;
  },

  activateRoomMonsters(roomId) {
    if (roomId == null) return;
    for (const m of this.monsters) {
      if (m.roomId === roomId && !m.active && m.data.hp > 0 && !m._banished) {
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
    if (m._banished) return false;
    const known = this.visitedRooms[m.roomId] || this.revealed[this.cellOf(m.x, m.z)];
    if (!known) return false;

    /* Sealed behind a shut door: nobody can reach anybody, so there is no fight
       to start. Checked before LOS because LOS can slip past a doorway corner
       and is what let a locked room open combat. */
    if (this._sealedFromParty(m, alive)) return false;

    /* Mid-fight, a doorway guarantees nothing any more.
       Two separately-correct fixes compose into a bug here. One widened
       AGGRO_RANGE to 12 because "the LOS gate (walls/closed doors) now bounds
       aggro". The other let doors keep opening during combat, to cure the
       fight-across-a-shut-gate soft-lock (test/combat_door_lock.test.js). But
       a hero in melee drifts within 2.2 of a gate, updateDoors unlocks it
       0.6s later, the LOS gate that justified the wide range evaporates, and
       aggro reaches straight through the empty doorway — where
       activateRoomMonsters then wakes the ENTIRE next room, including
       monsters past 12 units who were never seen at all. Repeat at the next
       gate and a two-room fight becomes a four-room one.

       So once a fight is already running, joining it is on a short leash and
       is strictly individual. A room still wakes as a unit when the party
       walks in on it (out of combat, below) — that is the intended feel — and
       anything actually shot still wakes through damageMonster. What no
       longer happens is a whole room being recruited because a door happened
       to open in someone else's fight. */
    const inFight = typeof this.isCombatActive === 'function' && this.isCombatActive();
    const range = inFight ? COMBAT_JOIN_RANGE : AGGRO_RANGE;

    for (const h of alive) {
      /* a lit hero is noticed from further, one lost in the dark from closer */
      /* 48: at night an unlit party is harder to spot */
      const night = this.D && this.D.timeOfDay === 'night' && !h._lightActive ? 0.8 : 1;
      if (Math.hypot(h.x - m.x, h.z - m.z) < range * noticeRangeMul(m, h) * night &&
          this.hasLOS(h.x, h.z, m.x, m.z)) {
        m.active = true;
        m.ent.grp.visible = true;
        if (m._spellCycle === undefined) {
          m._spellCycle = Math.floor(Math.random() * 2) + 1;
        }
        if (!inFight || m.isRival) this.activateRoomMonsters(m.roomId);
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

    /* Unseen heroes (Pass Without Trace) are not targets while anyone
       visible is; if the whole party is hidden the monster guesses. */
    /* Same for heroes the monster can't see in the dark (light_rules.js). */
    const seenHero = o => !getEffectMods(o).invisible && canSee(m, o);
    const anyVisible = alive.some(seenHero);
    let tgt = null, best = -Infinity;
    for (const h of alive) {
      if (anyVisible && !seenHero(h)) continue;
      const hi = this.heroes.indexOf(h);
      const d = Math.hypot(h.x - m.x, h.z - m.z);
      /* ignore heroes way out of aggro range unless we're already on them */
      if (!this.initiative?.active && d > AGGRO_RANGE + 3 && hi !== curIdx) continue;

      let score = (threat[hi] || 0) * THREAT_WEIGHT
                + (AGGRO_RANGE - d) * THREAT_DIST_WEIGHT
                + (h._aiJitter || 0);
      if (hi === packFocus) score += PACK_FOCUS_BONUS;
      /* 41: drawn to light — a moth makes for whoever carries a flame */
      if (h._lightActive && monsterLightTraits(m).drawnToLight) score += 40;

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

      /* Reach (turn_planner.monsterTargetReach): a hero it can hit this turn
         beats one it can't, and a hero it cannot reach at all (across a
         chasm, behind a shut door) is a last resort. Distance alone hid walls. */
      if (planned(this)) score += monsterTargetReach(this, m, h);

      if (hi === curIdx) score *= TARGET_SWITCH_MARGIN;   // hysteresis
      if (score > best) { best = score; tgt = h; }
    }
    if (tgt) {
      m._tgtIdx = this.heroes.indexOf(tgt);
      m._targetDist = Math.hypot(tgt.x - m.x, tgt.z - m.z);
    }
    return tgt;
  },

  /** Nearest living hostile monster for a dominated creature to fight. */
  pickDominatedTarget(m) {
    let best = null, bestD = Infinity;
    for (const o of this.monsters) {
      if (o === m || !this.isHostileMonster(o) || !o.active) continue;
      const d = Math.hypot(o.x - m.x, o.z - m.z);
      if (d < bestD) { bestD = d; best = o; }
    }
    if (best) { m._tgtIdx = -1; m._targetDist = bestD; }
    return best;
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
    const isOcc = typeof this.isCellOccupiedAny === 'function'
      ? this.isCellOccupiedAny(goal, m)
      : this.isCellOccupiedByAlly(goal, m);
    if (!isOcc) return goal;
    if (typeof this.approachCellNear === 'function') {
      /* ring-1 only — never the target's own cell, never 2+ tiles out. */
      return this.approachCellNear(goal, m);
    }
    const W = this.D.W, H = this.D.H || Math.floor(this.D.grid.length / W);
    const gx = goal % W, gz = Math.floor(goal / W);
    const solid = this.D.solidProps;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue; // never the target cell itself
        const nx = gx + dx, nz = gz + dz;
        if (nx < 0 || nx >= W || nz < 0 || nz >= H) continue;
        const nc = nz * W + nx;
        if (this.D.grid[nc] !== 1) continue; // not floor
        if (solid && solid[nc]) continue;
        return nc;
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
    /* Track target movement every frame (all monsters), not just on the
       monster's own turn — a target only moves while IT is the actor, so a
       kiting signal must accumulate across turns to be any use. */
    this.monsterTrackFlee(m, dist, dt);
    /* Initiative gate: nothing acts outside its own turn.

       Stated POSITIVELY — a monster acts only when it IS the current actor.
       The old negative form (`active && !isCurrentActor`) left a hole on the
       one frame a monster wakes: updateInitiative runs BEFORE updateMonsters
       and reads `_initParticipants`, which only counts monsters already
       `active`. So on the frame tryActivateMonster flips that flag, no roll
       has happened yet, `initiative.active` is still false, the gate passes,
       and the monster takes a free action before anyone rolls initiative.
       Melee hid it by spending that frame pathing toward the party; a ranged
       monster just shot, which is why only ranged ones appeared to cheat.
       Initiative rolls on the very next frame, so holding here costs a frame. */
    if (!this.isCurrentActor(m)) return;
    if (actionAnimBusy(m, this)) {
      m.walk = false;
      m.moving = !!(m.path && m.pathI < m.path.length && (m.moveLeft || 0) > 0);
      return;
    }

    /* Incapacitated (asleep, stunned, paralysed, petrified, held): no action,
       no reaction, no movement — the turn is simply skipped.

       This has to sit HERE, at the one choke point, because the downstream
       paths only checked it piecemeal. monsterChase, monsterKite, monsterAttack
       and monsterTacticalAction each tested `incapacitated`, but the two paths
       reached FIRST from this function did not: tryMonsterCycleAbility just
       below, and the m.data.ranged branch after it. So a slept archer kept
       shooting and a slept caster kept casting — only its feet and its melee
       swing stopped, which is why Sleep looked like it did nothing to them.

       actUsed lets updateInitiative retire the turn on its normal paced-advance
       path instead of burning the 2.5s stuck-ceiling watchdog (and logging a
       spurious "Turn stuck" warning) once per sleeper per round. */
    if (getEffectMods(m).incapacitated) {
      m.walk = false;
      m.moving = false;
      m.actUsed = true;
      if (typeof this.clearEntityPath === 'function') this.clearEntityPath(m);
      return;
    }

    m._kiteT = (m._kiteT || 0) - dt;

    /* Ability casters (bosses + any monster with cycle abilities): every Nth attack
       the monster uses an ability at the party instead of swinging. */
    if (!m.actUsed && dist < 8 && this.hasLOS(m.x, m.z, tgt.x, tgt.z)) {
      if (this.tryMonsterCycleAbility(m, tgt)) return;
    }

    /* Ranged monster: if a melee hero is breathing down our neck, kite
       away rather than stand and die. Otherwise hold at range and shoot. */
    if (m.data.ranged) {
      const threat = m.dominatedBy ? null : this.nearestMeleeThreat(m);
      if (threat) {
        this.monsterKite(m, tgt, threat, dt);
        return;
      }
      const canSee = this.hasLOS(m.x, m.z, tgt.x, tgt.z);
      if (dist <= m.data.rngRange && canSee) {
        this.monsterRanged(m, tgt, dt);
        return;
      }
      /* target out of range or blocked by cover/wall: fall through to chase and close the gap / find an angle */
    }

    /* Out of reach of its target but toe-to-toe with another hero, and the
       target is not reachable this turn: swing at the one in reach. Walking
       on would eat an opportunity attack and end the turn without attacking. */
    if (planned(this) && !m.data.ranged && !m.actUsed && dist > MONSTER_MELEE_RANGE) {
      const adj = this.monsterAdjacentHero(m);
      if (adj && !this.monsterReachesThisTurn(m, tgt)) {
        if (typeof this.clearEntityPath === 'function') this.clearEntityPath(m); else m.path = null;
        m._tgtIdx = this.heroes.indexOf(adj);
        this.monsterMelee(m, adj, dt);
        return;
      }
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
   * Dash / Dodge / Disengage decision for a monster whose turn it is.
   *
   * Fires when the monster cannot reach and attack a target using normal
   * movement alone, or when its movement budget is spent. Each branch spends
   * the whole Action, so it only fires when the action genuinely pays off:
   *   • Disengage — pinned in melee and either bloodied or a squishy kiter.
   *   • Dash      — only when a double-move lands the monster in strike range
   *                 (and it is sprinting in or chasing a fleeing target). A
   *                 Dash at a stationary foe that walking would also reach is
   *                 just a wasted turn, and a Dash that still can't close the
   *                 gap is worse than useless.
   *   • Dodge     — only under real pressure (bloodied or outnumbered) and
   *                 not for bulky styles that should hold the line.
   *
   * Returns true when the frame was handled and the caller should stand down
   * for this frame.
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
       AND the monster would rather not eat the hit — bloodied, or a squishy ranged/skirmisher. */
    const threatDist = Math.hypot(tgt.x - m.x, tgt.z - m.z);
    if (hasFullMove && threatDist <= MONSTER_MELEE_RANGE + 0.3 && !m.disengageActive) {
      const pinnedBy = this.heroes.filter(h => h.data.hp > 0 &&
        Math.hypot(h.x - m.x, h.z - m.z) <= MONSTER_MELEE_RANGE + 0.3).length;
      /* A retreat throws away the whole turn's damage, so a healthy-enough
         monster stands and swings. It runs when one more round would likely
         drop it (inMortalDanger), or when it is a ranged / skirmishing kiter. */
      const style = monsterCombatStyle(m);
      const worthFleeing = !planned(this) || style === 'ranged' || style === 'skirmisher' || inMortalDanger(this, m);
      if (pinnedBy > 0 && worthFleeing && shouldDisengage(m, { pinned: true }) && this.takeCommonAction(m, 'disengage')) {
        const threats = this.heroes.filter(h => h.data.hp > 0 && Math.hypot(h.x - m.x, h.z - m.z) <= 3.5);
        const fleePath = this.findFleePath(m, threats, m.moveLeft || speedCells, { avoidClosedDoors: true });
        if (fleePath) {
          this.setEntityPath(m, fleePath); m.repathT = MONSTER_REPATH_CD; m._stuckT = 0;
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

    /* B) DASH CHECK: ONLY at turn start, and ONLY when a double-move genuinely
       lands the monster in strike range. Spending the Action to Dash at a
       stationary target is pointless — walking reaches it just as fast — so
       Dash is reserved for closing the gap in one go, or chasing a fleeing
       foe. If the target is farther than a double move, Dash cannot help this
       turn: walk instead and keep the Action. */
    if (hasFullMove) {
      let goal = this.cellOf(tgt.x, tgt.z);
      if (typeof this.approachCellNear === 'function') goal = this.approachCellNear(goal, m);
      const route = this.findPath(this.cellOf(m.x, m.z), goal, { avoidClosedDoors: true, mover: m });
      if (route) {
        const travel = Math.max(0, route.length - 1);
        const closesNow = travel > speedCells && travel <= 2 * speedCells;
        const style = monsterCombatStyle(m);
        const worthIt = closesNow &&
          (this.monsterTargetFleeing(m) || style === 'skirmisher' || style === 'berserker');
        if (worthIt && this.takeCommonAction(m, 'dash')) {
          this.setEntityPath(m, route); m.repathT = MONSTER_REPATH_CD; m._stuckT = 0;
          const mods = getEffectMods(m);
          let spd = m.data.speed * MONSTER_SPEED_MULT * mods.speedMul;
          m.walk = this.moveStep(m, spd, dt || 0.016);
          m.moving = m.walk;
          return true;
        }
      }
    }

    /* C) DODGE CHECK: out of movement budget and no route available. Only
       spend the Action bracing when there is real pressure (bloodied or
       pinned by several hostiles) and the monster isn't built to tank or
       berserk — otherwise just hold ground. Either way, exhaust the frame so
       the stuck-recovery nudge never jitters the sprite on a spent budget. */
    if ((m.moveLeft || 0) <= 0 && (!m.path || m.pathI >= m.path.length)) {
      const style = monsterCombatStyle(m);
      const canBrace = style !== 'brute' && style !== 'tank' && style !== 'berserker';
      if (canBrace && this.monsterUnderPressure(m) && this.takeCommonAction(m, 'dodge')) {
        m.walk = false; m.moving = false;
        m.path = null; m.pathI = 0; m._stuckT = 0;
        return true;
      }
      /* no action spent — just hold ground */
      m.walk = false; m.moving = false;
      m.path = null; m.pathI = 0; m._stuckT = 0;
      return true;
    }
    return false;
  },

  /** A living, visible hero in melee reach of `m` (grid-adjacent), lowest HP first. */
  monsterAdjacentHero(m) {
    let best = null;
    for (const h of this.heroes) {
      if (!h || !h.data || h.data.hp <= 0) continue;
      if (getEffectMods(h).invisible || !canSee(m, h)) continue;
      const t = gridDist(this, m, h);
      if (t < 0 || t > 1) continue;
      if (!best || h.data.hp < best.data.hp) best = h;
    }
    return best;
  },

  /** Can `m` still walk into melee reach of `tgt` with the movement it has left? */
  monsterReachesThisTurn(m, tgt) {
    const budget = m.moveLeft != null ? m.moveLeft : this.cellsForSpeed(m);
    if (budget <= 0) return false;
    if (m.path && m.pathI < m.path.length && m.path[m.path.length - 1] != null) {
      const end = m.path[m.path.length - 1];
      const W = this.D.W, tc = this.cellOf(tgt.x, tgt.z);
      const adjEnd = Math.max(Math.abs((end % W) - (tc % W)), Math.abs(Math.floor(end / W) - Math.floor(tc / W))) <= 1;
      if (adjEnd) return m.path.length - m.pathI <= budget;
    }
    const goal = typeof this.approachCellNear === 'function'
      ? this.approachCellNear(this.cellOf(tgt.x, tgt.z), m) : this.cellOf(tgt.x, tgt.z);
    const route = this.findPath(this.cellOf(m.x, m.z), goal, { avoidClosedDoors: true, mover: m });
    return !!route && route.length - 1 <= budget;
  },

  /** Is `m` under enough pressure to justify bracing with the Dodge action?
      Bloodied, or pinned by several hostiles at once. */
  monsterUnderPressure(m) {
    if (monsterHurtFrac(m) >= TACTICAL_DODGE_BLOODIED_FRAC) return true;
    let adjacent = 0;
    for (const h of this.heroes) {
      if (!h || !h.data || h.data.hp <= 0) continue;
      if (Math.hypot(h.x - m.x, h.z - m.z) <= MONSTER_MELEE_RANGE + 0.3) adjacent++;
      if (adjacent >= TACTICAL_DODGE_PIN_THREATS) return true;
    }
    return false;
  },

  /** Track whether the target is actively moving away, so Dash is only ever
      spent to pursue (a stationary foe never justifies burning the Action).
      Smooth per-frame deltas are tiny, so distances accumulate over a ~0.5s
      window; two windows of the target backing away (>0.5 units each) counts
      as a kiting target. */
  monsterTrackFlee(m, dist, dt) {
    const prev = m._tgtLastDist;
    m._tgtLastDist = dist;
    if (prev == null) return;
    const delta = dist - prev;
    m._fleeWinT = (m._fleeWinT || 0) + (dt || 0.016);
    m._fleeWinDist = (m._fleeWinDist || 0) + delta;
    if (m._fleeWinT >= 0.5) {
      m._fleeStrike = m._fleeWinDist > 0.5 ? (m._fleeStrike || 0) + 1 : 0;
      m._fleeWinT = 0;
      m._fleeWinDist = 0;
    }
  },

  /** True once the target has been consistently backing away over the last ~1s. */
  monsterTargetFleeing(m) {
    return (m._fleeStrike || 0) >= 2;
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

    /* Disengage before a costly retreat if bloodied or double-pinned */
    if (this.initiative && this.initiative.active && this.isCurrentActor(m)
        && !m.actUsed && !m.disengageActive
        && Math.hypot(threat.x - m.x, threat.z - m.z) <= MONSTER_MELEE_RANGE + 0.3) {
      const pinnedBy = this.heroes.filter(h => h.data.hp > 0 &&
        Math.hypot(h.x - m.x, h.z - m.z) <= MONSTER_MELEE_RANGE + 0.3).length;
      const bloodied = monsterHurtFrac(m) >= 0.5;
      /* Disengage costs the shot. A shooter only gives it up when one more
         round in melee would likely drop it; otherwise it fires first (below)
         and backs off on its movement, eating at most one free hit. */
      const flee = planned(this) ? inMortalDanger(this, m) : (bloodied || pinnedBy > 1);
      if (flee && this.takeCommonAction(m, 'disengage')) {
        const threats = this.heroes.filter(h => h.data.hp > 0 && Math.hypot(h.x - m.x, h.z - m.z) <= 3.5);
        const fleePath = this.findFleePath(m, threats, m.moveLeft || this.cellsForSpeed(m), { avoidClosedDoors: true });
        if (fleePath) {
          this.setEntityPath(m, fleePath); m.repathT = MONSTER_REPATH_CD;
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

    if (!this.hasLivePath(m)) {
      this.setEntityPath(m, this.findPath(this.cellOf(m.x, m.z), goal, { avoidClosedDoors: true, mover: m }));
    }
    /* face the target so shots/anims look right while backing away */
    this.faceTowards(m, tgt.x, tgt.z, dt);

    /* fire first if there's already a clean shot at the target and action is free,
       so the cast, charge, projectile, and hit animation complete before retreating */
    if (!m.actUsed
        && Math.hypot(tgt.x - m.x, tgt.z - m.z) <= m.data.rngRange
        && (!this.hasLOS || this.hasLOS(m.x, m.z, tgt.x, tgt.z))) {
      m.actUsed = true;
      this._countSwing(m);
      this.monsterRangedAttack(m, tgt);
    }

    if (actionAnimBusy(m, this)) {
      m.walk = false;
      m.moving = !!(m.path && m.pathI < m.path.length && (m.moveLeft || 0) > 0);
      return;
    }

    const mods = getEffectMods(m);
    let spd = m.data.speed * MONSTER_SPEED_MULT * mods.speedMul;
    if (m.slowUntil && this.elapsed < m.slowUntil) spd *= 0.5;
    m.walk = this.moveStep(m, spd, dt);
    m.moving = m.walk;

    /* fire if stepping just opened a clean shot at the target and action is free */
    if (!m.actUsed
        && Math.hypot(tgt.x - m.x, tgt.z - m.z) <= m.data.rngRange
        && (!this.hasLOS || this.hasLOS(m.x, m.z, tgt.x, tgt.z))) {
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
    this.faceTowards(m, tgt.x, tgt.z, dt);
    if (!m.actUsed) {
      if (typeof this.hasLOS === 'function' && !this.hasLOS(m.x, m.z, tgt.x, tgt.z)) return;
      m.actUsed = true;
      this._countSwing(m);
      this.monsterRangedAttack(m, tgt);
      /* Multiattack for ranged variants — manticore tail-spike volley,
         deep-elf-master-archer double-shot, etc. Same stagger as melee: all
         fired in one tick, every shot left on the same frame of one draw. */
      this._scheduleMultiattack(m, tgt, () => this.monsterRangedAttack(m, tgt));
    }
  },

  /* Extra swings of a Multiattack (`attacksPerTurn: N`), spaced by the attack
     animation on the combat clock so each one replays the sheet. Extra
     attacks only fire while both still stand, matching hero Extra Attack. */
  _scheduleMultiattack(m, tgt, swing) {
    const extra = Math.max(0, (m.data.attacksPerTurn || 1) - 1);
    if (extra <= 0) return;
    const interval = strikeInterval(attackAnimDelay(m));
    for (let i = 0; i < extra; i++) {
      scheduleFollowUpStrike(this, m, (i + 1) * interval, () => {
        if (tgt && tgt.data && tgt.data.hp > 0 && m && m.data && m.data.hp > 0 && m.active) swing();
      });
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
    /* Blood Frenzy (SRD sharks / sahuagin): advantage vs a target not at full HP */
    if (m.data.bloodFrenzy && h.data && h.data.maxHp && h.data.hp < h.data.maxHp) adv += 1;
    /* Protection fighting style: an adjacent shield-bearer's reaction */
    if (this.protectionReaction) adv += this.protectionReaction(m, h);
    /* Light & sight (light_rules.js). Most dungeon natives have darkvision,
       so the dark rarely hides the party from them — but it can. */
    const sight = sightAdvantage(m, h);
    adv += sight.adv;
    noteAttackFromDark(m, sight.unseenAttacker);
    m._hidden = false;                           // striking gives a hider away
    /* Sunlight Sensitivity / Weakness (SRD): fighting in bright light — a
       torch counts — is at disadvantage. docs/LIGHT_IDEAS.md 17, 39 */
    const lt = monsterLightTraits(m);
    if ((lt.sunlightSensitive || lt.sunlightWeak) && lightStateOf(m) === 'bright') {
      adv -= 1;
      if (!m._sunLogged) { m._sunLogged = true; this.fxLog(`☀️ ${m.data.name} flinches from the light.`, 'roll'); }
    }
    if (sight.unseenAttacker) this.fxLog(`🌑 ${m.data.name} strikes unseen from the dark!`, 'roll');
    else if (sight.unseenTarget) this.fxLog(`🌑 ${m.data.name} swings blind at ${h.data.name}.`, 'roll');
    return adv;
  },

  /** Invisible monsters become visible the moment they attack (5e). */
  revealInvisible(m) {
    clearEffect(m, 'invisible');
    this.fxLog(`👁 ${m.data.name} drops its invisibility to attack!`, 'sys');
    this.fxSprite('dcss/effect/cloud_magic_trail_1.png', this._v3(m.x, 1.0, m.z), 1.4, 0.5);
  },

  /** Fire a ranged projectile at a hero. */
  monsterRangedAttack(m, h) {
    if (this.isMonsterEntity(h)) return this.monsterAttackMonster(m, h, true);
    if (typeof globalThis.setCombatActionFocus === 'function' && m && h) {
      globalThis.setCombatActionFocus(m, h, 1.25);
    }
    /* Invisible monsters are revealed the moment they attack (5e) */
    if (hasEffect(m, 'invisible')) this.revealInvisible(m);
    /* Animated-atlas monsters play their one-shot attack sheet when firing
       (forced, for the same Multiattack reason as monsterAttack). */
    if (m.ent && m.ent.anim && m.ent.anim.play) m.ent.anim.play('attack', true);
    const animRem = actionAnimRemaining(m);
    if (animRem > 0 && typeof this.fxHold === 'function') this.fxHold(animRem);
    const cover = (typeof this.getCover === 'function')
      ? this.getCover(m, h)
      : { type: 'none', acBonus: 0, dexBonus: 0 };
    if (cover.type === 'total') return;

    const adv = this.monsterAttackAdv(m, h);
    const d20 = d20Roll(adv);
    const atkMods = getEffectMods(m);
    let atkBonus = (m.data.atk != null ? m.data.atk : 4) + (atkMods.atkBonus || 0);
    if (atkMods.blessDice) atkBonus += die(4);
    let total = d20 + atkBonus;
    let crit = d20 === 20;
    if (crit) this.triggerHitStop(2);
    const baseAc = this.heroAC(h);
    const ac = baseAc + cover.acBonus;
    /* Jarring Chord (bard talent): weapon shots only; cantrips are saves */
    if (!m.data.cantripClass && this.jarringChord) total = this.jarringChord(m, h, total, ac, crit);
    if (!m.data.cantripClass && this.bendLuckAttack) total = this.bendLuckAttack(m, h, total, ac, crit);
    const from = this.fxChestPos ? this.fxChestPos(m) : this._v3(m.x, 0.55, m.z);
    const to = this._v3(h.x, (this.fxGroundY ? this.fxGroundY(h.x, h.z) : 0) + 0.4, h.z);

    /* Not every ranged attacker draws a bow. `cantripClass` names one of the
       hero cantrip classes (CANTRIP_FX in combat.js) and routes the whole
       delivery through fxCantripDelivery — the SAME code and the same tables the
       heroes use — so a cultist casting Chill Touch looks and sounds exactly
       like a sorcerer casting it. Anything without it still shoots an arrow. */
    const cantripClass = m.data.cantripClass || null;
    const hitSfx = cantripClass ? 'spellImpact' : 'bowHit';
    const missSfx = cantripClass ? 'spellImpact' : 'bowBlock';

    const preCharge = !!(cantripClass && typeof this.fxSpellCharge === 'function' && typeof this.fxImpactDelay === 'function');
    if (preCharge) {
      this.fxSpellCharge(m, m.data.rangedColor || m.data.color || 0xff8a5a, null, { x: h.x - m.x, z: h.z - m.z });
    }
    const deliver = (color, onImpact) => {
      const curFrom = this.fxChestPos ? this.fxChestPos(m) : this._v3(m.x, 0.55, m.z);
      if (cantripClass) {
        this.fxCantripDelivery(curFrom, to, cantripClass, { caster: preCharge ? null : m,
          dmgType: m.data.rangedDmgType || 'magic', follow: h, onImpact
        });
      } else {
        this.fxPlaySfx('bowAttack', { volume: 0.5 });
        this.fxProjectile(curFrom, to, 'arrow', color, onImpact);
      }
    };

    /* The projectile must LEAVE at the release pose, not on frame 0. Sheets are
       authored windup -> release -> recover, so firing immediately shows the
       arrow already in flight while the archer is still drawing. Melee already
       does this; ranged did not. 0 for un-animated monsters keeps their timing. */
    const rawImpactIn = (m.ent && m.ent.anim && m.ent.anim.attackImpactDelay)
      ? m.ent.anim.attackImpactDelay() : 0;
    const impactIn = preCharge ? Math.max(rawImpactIn, SPELL_CHARGE_SECONDS) : rawImpactIn;
    const onRelease = (fn) => this.fxImpactDelay(impactIn, fn);

    if (cantripClass) {
      /* Cantrips ignore AC and target a saving throw:
         - wizard: DEX Save (Fire Bolt)
         - warlock: CHA Save (Eldritch Blast)
         - sorcerer: CON Save (Chill Touch)
         - druid: WIS Save (Produce Flame)
         - cleric: DEX Save (Sacred Flame) */
      const MONSTER_CANTRIP_SAVES = {
        wizard: 'dex',
        warlock: 'cha',
        sorcerer: 'con',
        druid: 'wis',
        cleric: 'dex',
        artificer: 'dex'
      };
      const saveAb = MONSTER_CANTRIP_SAVES[cantripClass] || 'dex';
      const prof = Math.max(2, Math.floor(((m.data.cr || 1)) / 4) + 2);
      const dc = m.data.spellDC || (8 + Math.max(prof, atkBonus));
      const coverDex = (saveAb === 'dex') ? cover.dexBonus : 0;
      const saveRes = rollSaveDetail(h, saveAb, dc, { magic: true, bonus: coverDex });

      if (saveRes.saved) {
        onRelease(() => {
          deliver(0x999999, () => {
            this.fxText('Saved!', this._v3(h.x, 1.1, h.z), '#6ae0ff');
            if (this.triggerDodge) this.triggerDodge(h, m);
            this.fxPlaySfx(missSfx, { volume: 0.45 });
            this.fxLog(`🛡 ${h.data.name} succeeds on ${saveAb.toUpperCase()} save (${saveRes.total} vs DC ${dc}) vs ${m.data.name}'s cantrip!`, 'miss');
          });
        });
        return;
      }

      const dmgArr = Array.isArray(m.data.dmg) ? m.data.dmg : [1, 8, 2];
      let dmg = roll(dmgArr[0], dmgArr[1], dmgArr[2] || 0);
      const color = m.data.rangedColor || m.data.color || 0xff8a5a;
      onRelease(() => {
        deliver(color, () => {
          if (h.data.hp <= 0) return;
          this.fxPlaySfx(hitSfx, { volume: 0.6 });
          const mit = {};
          const dealt = this.applyIncomingDamage
            ? this.applyIncomingDamage(h, dmg, mit, { dmgType: m.data.rangedDmgType || 'magic', magical: true })
            : (h.data.hp -= dmg, dmg);
          this.fxHitFlash(h.ent);
          if (cantripClass && this.fxPoseHit) this.fxPoseHit(h, m);
          if (this.fxDamageNumber) this.fxDamageNumber(h, dealt, mit, '#ff9a7a');
          else this.fxText(String(dealt), this._v3(h.x, 1.2, h.z), '#ff9a7a');
          this.fxDrawBar(h.ent.bar, Math.max(0, h.data.hp / h.data.maxHp));
          if (dealt > 0 && this.applyOnDamagedPerks) this.applyOnDamagedPerks(h, m, dealt);
          if (dealt > 0) this.applyOnHitAbilities(m, h);
          this.fxLog(`${m.data.name}'s cantrip strikes ${h.data.name} for ${dealt} (${saveAb.toUpperCase()} save failed: ${saveRes.total} vs DC ${dc})`, 'roll', { cat: 'hitmiss' });
          this.refreshHud();
          if (h.data.hp <= 0) {
            if (h.companion && this.killCompanion) {
              this.killCompanion(h, m);
            } else {
              h.data.hp = 0; h.data.downs++;
              this.fxLog(`💀 ${h.data.name} goes down!`, 'down');
            }
            if (m?.data?.abilities) this.applyOnKillAbilities(m, h);
          }
        });
      });
      return;
    }

    if ((crit || total >= ac) && this.mirrorImageIntercept && this.mirrorImageIntercept(h, total)) {
      onRelease(() => deliver(0x999999, () => this.fxPlaySfx(missSfx, { volume: 0.45 })));
      return;
    }
    if (!crit && total < ac) {
      if (total >= baseAc && cover.acBonus > 0) {
        this.fxLog(`🛡️ ${h.data.name} is protected by ${cover.type === 'threeQuarters' ? 'three-quarters' : 'half'} cover (+${cover.acBonus} AC vs ${m.data.name}'s shot)!`, 'miss');
      }
      /* spawn a visible projectile that "misses" */
      onRelease(() => {
        deliver(0x999999, () => {
          if (this.showMiss) this.showMiss(h, m);
          else this.fxText('miss', this._v3(h.x, 1.1, h.z), '#9aa');
          this.fxPlaySfx(missSfx, { volume: 0.45 });
        });
      });
      return;
    }

    const dmgArr = Array.isArray(m.data.dmg) ? m.data.dmg : [1, 8, 2];
    let dice = dmgArr[0]; if (crit) dice *= 2;
    let dmg = roll(dice, dmgArr[1], dmgArr[2] || 0);
    const color = m.data.rangedColor || m.data.color || 0xff8a5a;
    onRelease(() => {
      deliver(color, () => {
      if (h.data.hp <= 0) return;
      /* Deflect Missiles (Monk L3): knock the shot aside, or catch it */
      if (this.deflectMissiles) dmg = this.deflectMissiles(h, dmg);
      if (dmg <= 0) { this.fxPlaySfx(missSfx, { volume: 0.45 }); return; }
      this.fxPlaySfx(hitSfx, { volume: 0.6 });
      const mit = {};
      const dealt = this.applyIncomingDamage ? this.applyIncomingDamage(h, dmg, mit) : (h.data.hp -= dmg, dmg);
      this.fxHitFlash(h.ent);
      if (cantripClass && this.fxPoseHit) this.fxPoseHit(h, m);
      if (this.fxDamageNumber) this.fxDamageNumber(h, dealt, mit, crit ? '#ff5040' : '#ff9a7a', crit);
      else this.fxText(String(dealt), this._v3(h.x, 1.2, h.z), crit ? '#ff5040' : '#ff9a7a');
      this.fxDrawBar(h.ent.bar, Math.max(0, h.data.hp / h.data.maxHp));
      if (dealt > 0 && this.applyOnDamagedPerks) this.applyOnDamagedPerks(h, m, dealt);
      if (dealt > 0) this.applyOnHitAbilities(m, h);
      this.fxLog(`${m.data.name} shoots ${h.data.name} for ${dealt}${crit ? ' (crit!)' : ''}`, crit ? 'down' : 'roll',
        { cat: 'hitmiss' });
      this.refreshHud();
      if (h.data.hp <= 0) {
        if (h.companion && this.killCompanion) {
          this.killCompanion(h, m);
        } else {
          h.data.hp = 0; h.data.downs++;
          this.fxLog(`💀 ${h.data.name} goes down!`, 'down');
        }
        /* onKill riders on the shooter (gnoll-hunter Rampage, etc.). */
        if (m?.data?.abilities) this.applyOnKillAbilities(m, h);
      }
      });
    });
  },

  /** Apply boss-inflicted damage to a hero: HP, bar, floater, downs, perks.
   *  `dmgType` is plumbed for future hero-resistance support (roadmap 2F);
   *  heroes have no statblock resistance yet, so it is not currently reduced. */
  hurtHero(h, dmg, src, colorHex = 0xff5040, dmgType = null, magical = false) {
    if (h.data.hp <= 0) return 0;
    /* A monster on the receiving end (a dominated creature, or a hostile hit
       by one): the monster damage path owns resistances, death and loot. */
    if (this.isMonsterEntity(h)) {
      const credit = src && src.dominatedBy ? src.dominatedBy : null;
      const r = this.damageMonster(h, dmg, credit, false, { skipPerks: true, via: src, dmgType });
      return r ? r.dmg : 0;
    }
    const mit = {};
    const dealt = this.applyIncomingDamage ? this.applyIncomingDamage(h, dmg, mit, { dmgType, magical }) : (h.data.hp -= dmg, dmg);
    this.fxHitFlash(h.ent);
    if (magical && this.fxPoseHit) this.fxPoseHit(h, src);
    if (this.fxDamageNumber) this.fxDamageNumber(h, dealt, mit, '#ff7a5a');
    else this.fxText(String(dealt), this._v3(h.x, 1.2, h.z), '#ff7a5a');
    this.fxDrawBar(h.ent.bar, Math.max(0, h.data.hp / h.data.maxHp));
    if (dealt > 0 && this.applyOnDamagedPerks) this.applyOnDamagedPerks(h, src, dealt);
    if (!h.companion && h.data.hp > 0 && h.data.hp < h.data.maxHp * 0.5) firstRunTip('potion');
    if (h.data.hp <= 0) {
      if (h.companion && this.killCompanion) {
        this.killCompanion(h, src);
      } else {
        h.data.hp = 0; h.data.downs++;
        this.triggerShake(0.7, 0.35);
        this.fxLog(`💀 ${h.data.name} goes down!`, 'down');
      }
      /* onKill riders on the killer (gnoll Rampage, vampire lifesteal…). */
      if (src?.data?.abilities) this.applyOnKillAbilities(src, h);
    }
    return dealt;
  },

  /** Boss pool / data-driven cycle ability, if the cadence is due.
   *  Returns true if an ability was used (the monster's action is spent). */
  tryMonsterCycleAbility(m, tgt) {
    /* A dominated creature only swings (its spells and breath are aimed
       through hero-shaped resolvers), and nothing aims an ability at another
       monster for the same reason — they close and hit it instead. */
    if (m.dominatedBy || this.isMonsterEntity(tgt)) return false;
    /* Silence: no spells. Non-spell abilities (a breath, a hook, a grab) still
       work — only entries that name a spell are verbal. */
    const silenced = hasEffect(m, 'silenced');
    /* legacy boss pool takes precedence */
    const spells = m.isBoss ? BOSS_SPELLS[m.data.id] : null;
    if (spells) {
      if (silenced) return false;
      if ((m._spellCycle || 0) >= BOSS_SPELL_EVERY) {
        /* Planned like any other ability: Fireball waits for a clump, Fear
           skips heroes already frightened, Mass Cure waits for a wound. The
           cadence counter keeps counting while it waits, so the spell comes
           out the moment it is worth it. */
        if (PLANNER.on && PLANNER.monsters !== false) {
          const pool = spells.filter(k => BOSS_SPELL_FX[k]).map(k => ({ ...BOSS_SPELL_FX[k], key: k }));
          const choice = pool.length ? planMonsterAbility(this, m, tgt, pool) : null;
          if (!choice) return false;
          m._spellCycle = 0;
          this._castAbilityFx(m, choice.target || tgt, BOSS_SPELL_FX[choice.ab.key], choice.ab.label, choice.ab.key);
          return true;
        }
        m._spellCycle = 0;
        this.monsterCastSpell(m, tgt, spells);
        return true;
      }
      return false;
    }
    const abs = m.data.abilities;
    if (!abs) return false;
    /* `maxUses` caps an ability for the monster's whole life — a shaman with one
       Entangle prepared should cast it once and then fall back to its cantrip,
       not loop it every few swings. Counts live on the instance, so they reset
       naturally when the creature is spawned again. */
    const spent = m._abUses || (m._abUses = {});
    /* Band-limited abilities. `range` is the reach in 5 ft cells (the caller's
       own gate is a flat 8, so anything up to that works); `minRange` keeps an
       ability that exists to CLOSE distance — the Hook-Hauler reeling someone
       in — from being wasted on a hero already standing next to it. */
    const dist = Math.hypot(tgt.x - m.x, tgt.z - m.z);
    const cyc = abs.filter(a => a.trigger === 'cycle' &&
      !(silenced && a.spell) &&
      !(a.maxUses != null && (spent[a.key] || 0) >= a.maxUses) &&
      !(a.range != null && dist > a.range) &&
      !(a.minRange != null && dist < a.minRange));
    if (!cyc.length) return false;
    /* Pick an ability that is actually good right now (turn_planner.planMonsterAbility):
       an area ability is aimed at the hero standing in the thickest clump and
       held back while the party is spread out; a heal waits for someone hurt.
       It used to be a random entry fired at the current target, which is how a
       breath weapon went off on one hero while three stood clumped a step away. */
    const planned = PLANNER.on && PLANNER.monsters !== false;
    const choice = planned ? planMonsterAbility(this, m, tgt, cyc) : null;
    const ab = choice ? choice.ab : (planned ? null : cyc[Math.floor(Math.random() * cyc.length)]);
    if (!ab) return false;
    if ((m._spellCycle || 0) < (ab.every || MONSTER_ABILITY_EVERY)) return false;
    m._spellCycle = 0;
    if (ab.maxUses != null) spent[ab.key] = (spent[ab.key] || 0) + 1;
    this.monsterUseAbility(m, (choice && choice.target) || tgt, ab);
    return true;
  },

  /** Count a real attack toward the monster's ability cadence. */
  _countSwing(m) {
    const spent = m._abUses || {};
    const hasLive = m.data.abilities && m.data.abilities.some(a =>
      a.trigger === 'cycle' && !(a.maxUses != null && (spent[a.key] || 0) >= a.maxUses));
    if ((m.isBoss && BOSS_SPELLS[m.data.id]) || hasLive) {
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

  /** OA-free reposition (blink-dog Teleport, phase-spider Ethereal Jaunt, ghost
   *  Etherealness…). Picks an unoccupied floor cell within `fx.blink.range` cells,
   *  preferring one closer to the target so blinkers lunge toward prey, then snaps
   *  the monster there with a teleport visual. Never provokes opportunity attacks
   *  because the monster is not moving through threatened squares. */
  monsterBlink(m, tgt, fx, key) {
    const range = (fx.blink && fx.blink.range) || 3;
    const W = this.D.W, H = this.D.H || Math.floor(this.D.grid.length / W);
    const fcx = m.x, fcz = m.z;
    const fromCell = this.cellOf(fcx, fcz);
    const gx = fromCell % W, gz = Math.floor(fromCell / W);
    const tCell = this.cellOf(tgt.x, tgt.z);

    const cands = [];
    for (let dz = -range; dz <= range; dz++) {
      for (let dx = -range; dx <= range; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = gx + dx, nz = gz + dz;
        if (nx < 0 || nx >= W || nz < 0 || nz >= H) continue;
        const c = nz * W + nx;
        if (this.D.grid[c] !== 1) continue;             // not floor
        if (this.D.solidProps && this.D.solidProps[c]) continue;
        if (this.isCellOccupiedByAlly(c, m)) continue;  // no stacking on allies
        if (c === tCell) continue;                      // never the target's own cell
        let blocked = false;
        for (const h of this.heroes) {
          if (h.data.hp <= 0) continue;
          if (Math.hypot(this.wx(nx) - h.x, this.wz(nz) - h.z) < 0.9) { blocked = true; break; }
        }
        if (blocked) continue;
        cands.push(c);
      }
    }
    if (!cands.length) {
      this.fxLog(`${m.data.name} fails to find a clear spot to blink to.`, 'roll');
      return;
    }

    /* Prefer a spot nearer the target so blinkers close distance (weighted by
       a small random jitter so the choice isn't perfectly deterministic). */
    cands.sort((a, b) => {
      const ax = a % W, az = Math.floor(a / W), bx = b % W, bz = Math.floor(b / W);
      const da = Math.hypot(this.wx(ax) - tgt.x, this.wz(az) - tgt.z);
      const db = Math.hypot(this.wx(bx) - tgt.x, this.wz(bz) - tgt.z);
      return (da - db) + (Math.random() - 0.5);
    });
    const pick = cands[0];
    const px = pick % W, pz = Math.floor(pick / W);
    m.x = this.wx(px);
    m.z = this.wz(pz);
    m.path = null; m.pathI = 0;
    m.walk = false; m.moving = false;

    this.fxPlaySfx(this.fxAbilitySfx(key, fx), { volume: 0.6 });
    this.fxLog(`✨ ${m.data.name} teleports!`, 'crit');
    this.fxSprite(`dcss/effect/${fx.sprite || 'cloud_tloc_energy'}.png`,
      this._v3(m.x, 1.0, m.z), 1.6, 0.6);
    this.fxTelegraph({ x: m.x, z: m.z }, 1.0, fx.color || 0x8fd4e8, 0.5);
  },

  /** Shared use-an-ability action: telegraph, then resolve vs the party.
   *  `fx` is a BOSS_SPELL_FX entry or a monsters.json `abilities` entry —
   *  same shape: { label, color, sprite, aoe?, dice?, dmgType?, save?, effect?, heal? }
   *  `key` is the spell name when the ability has one, so it shares the
   *  player-side sound; otherwise this.fxAbilitySfx() picks a slot from its shape. */
  _castAbilityFx(m, tgt, fx, label, key) {
    m.walk = false;
    m.moving = false;
    m.path = null;
    m.actUsed = true;
    /* No dt in scope here (this runs from the action phase, not the movement
       phase) — snap the facing with the default step instead. */
    this.faceTowards(m, tgt.x, tgt.z);

    this.fxPlaySfx(this.fxAbilitySfx(key, fx), { volume: m.isBoss ? 0.75 : 0.6 });
    this.fxLog(`✨ ${m.data.name} uses ${label}!`, 'crit');
    if (m.isBoss) this.triggerShake(0.9, 0.4);
    this.triggerLunge(m, tgt);
    /* Animated-atlas monsters play their attack sheet on any ability lunge. */
    if (m.ent && m.ent.anim && m.ent.anim.play) m.ent.anim.play('attack');
    this.fxText(label, this._v3(m.x, 1.5, m.z), '#e8c25a');
    if (!fx) return;   // unknown spell → flourish only, no effect

    /* A hero who knows Counterspell can stop it (abjuration.js). The monster's
       action is spent either way. */
    if (this.heroCounterspell && this.heroCounterspell(m, key, fx, label)) return;

    /* Blink / teleport (blink-dog Teleport, phase-spider Ethereal Jaunt…):
       OA-free reposition, no damage by itself. */
    if (fx.blink) {
      this.monsterBlink(m, tgt, fx, key);
      return;
    }

    /* Self-buff (Invisibility, etc.): `buff` applies an effect to the monster
       itself. No duration → persists until the monster attacks (or combat ends),
       which is exactly how 5e invisibility behaves. */
    if (fx.buff) {
      const effKey = typeof fx.buff === 'string' ? fx.buff : fx.buff.key;
      const dur = (typeof fx.buff === 'object' && fx.buff.dur) || null;
      const opts = { elapsed: this.fxNow };
      if (dur != null) opts.duration = dur;
      applyEffect(m, effKey, opts);
      this.fxText(effKey, this._v3(m.x, 1.5, m.z), '#e8c25a');
      this.fxLog(`✨ ${m.data.name} uses ${label}!`, 'crit');
      if (fx.sprite) this.fxSprite(`dcss/effect/${fx.sprite}.png`, this._v3(m.x, 1.2, m.z), 1.5, 0.7);
      return;
    }

    /* Using an offensive ability drops invisibility (5e: "until it attacks") */
    if (hasEffect(m, 'invisible') && (fx.dice || fx.effect || fx.aoe)) this.revealInvisible(m);

    const sprite = fx.sprite ? `dcss/effect/${fx.sprite}.png` : null;

    /* Support spell: heal the caster and any wounded allies nearby. */
    if (fx.heal) {
      const allies = fx.selfOnly
        ? [m]
        : (m.data?.isRival
          ? [m, ...this.monsters.filter(o => o !== m && !o.dead && o.data?.isRival && o.data.hp > 0 && Math.hypot(o.x - m.x, o.z - m.z) < 6.0)]
          : [m, ...this.monsters.filter(o => o !== m && !o.dead && o.data.hp > 0 && Math.hypot(o.x - m.x, o.z - m.z) < 3.5)]);
      for (const o of allies) {
        const amt = roll(fx.heal[0], fx.heal[1], fx.heal[2]);
        o.data.hp = Math.min(o.data.maxHp, o.data.hp + amt);
        this.fxDrawBar(o.ent.bar, Math.max(0, o.data.hp / o.data.maxHp), '#e0483a');
        this.fxText('+' + amt, this._v3(o.x, 1.2, o.z), '#6ae06a');
        if (sprite) this.fxSprite(sprite, this._v3(o.x, 0.5, o.z), 1.2, 0.4);
      }
      this.fxLog(`💚 ${m.data.name} uses ${label}!`, 'heal');
      return;
    }

    /* Offensive / debuff spell: resolve against the party. */
    const heroes = this.heroes.filter(h => h.data.hp > 0);
    let targets;
    if (fx.aoe) {
      targets = heroes.filter(h => Math.hypot(h.x - tgt.x, h.z - tgt.z) <= fx.aoe);
      if (targets.length === 0 && tgt.data.hp > 0) targets = [tgt];
      this.fxTelegraph({ x: tgt.x, z: tgt.z }, fx.aoe, fx.color || 0xe04040, 0.8);
    } else {
      targets = tgt.data.hp > 0 ? [tgt] : (heroes.length ? [heroes[0]] : []);
      this.fxTelegraph({ x: tgt.x, z: tgt.z }, 1.2, fx.color || 0xe04040, 0.6);
    }

    /* Same wind-up rule as a melee swing: the ability is decided now, but its
       damage and conditions land when the attack animation reaches its contact
       pose (and after the telegraph has had time to read). Deferred here at the
       call site rather than inside _resolveAbilityOnHero, which is also used by
       onHit riders, auras and death bursts that must stay immediate. */
    const abilityImpactIn = (m.ent && m.ent.anim && m.ent.anim.attackImpactDelay)
      ? m.ent.anim.attackImpactDelay() : 0;
    const isSpell = !!(fx.magic || (key && SPELLS[key]));
    /* Mage Slayer: casting next to one invites a reaction attack */
    if (isSpell && this.mageSlayerReaction) this.mageSlayerReaction(m);
    this.fxImpactDelay(abilityImpactIn, () => {
      if (m.data.hp <= 0 || m.dead) return;
      for (const h of targets) this._resolveAbilityOnHero(m, h, fx, label, { aoe: !!fx.aoe, isSpell });
      this.refreshHud();
    });
  },

  /** Resolve one ability instance against one hero: save → damage → condition.
   *  Shared by cycle casts, onHit riders, auras, and death bursts. */
  _resolveAbilityOnHero(m, h, fx, label, opts = {}) {
    let saveRes = null;
    let dc = 10;
    /* Mage Slayer: advantage on saves against a spell cast by an adjacent creature */
    const isSpell = !!(fx.magic || opts.isSpell);
    const mageSlayerAdv = isSpell && h.data && hasFeat(h.data, 'mageSlayer')
      && Math.hypot(m.x - h.x, m.z - h.z) <= 1.8 ? 1 : 0;
    if (fx.save) {
      const abStat = fx.save.ab || 'con';
      const prof = m.data.statblock?.prof || Math.max(2, Math.floor((m.data.cr || 1) / 4) + 2);
      const statVal = m.data.effStats?.[abStat] ?? m.data.statblock?.stats?.[abStat] ?? 10;
      const statMod = Math.floor((statVal - 10) / 2);
      const calculatedDC = 8 + prof + statMod;
      dc = fx.save.dc != null ? Math.max(fx.save.dc, calculatedDC) : calculatedDC;
      saveRes = rollSaveDetail(h.data || h, fx.save.ab, dc,
        { magic: isSpell, adv: mageSlayerAdv, vs: fx.effect && fx.effect.key });   // Steadfast
    }
    const saved = saveRes ? saveRes.saved : false;
    this.fxRichAbilityVFX(m, h, fx, label, opts);

    /* `beam` draws a physical line between caster and target — a thrown hook
       and chain, as opposed to the radiating burst fxRichAbilityVFX gives every
       ability. Passing the victim's sprite group as followTo lets the beam
       track them, so a chain visibly shortens as the pull below reels them in. */
    if (fx.beam && typeof this.fxBeam === 'function') {
      this.fxBeam(this._v3(m.x, 0.7, m.z), this._v3(h.x, 0.7, h.z), {
        type: fx.beam,
        color: fx.beamColor || fx.color || 0x8a8172,
        duration: fx.beamDur || 0.55,
        followTo: (h.ent && h.ent.grp) || null
      });
    }

    if (fx.save && saveRes) {
      const rollStr = `${saveRes.d20} + ${saveRes.mod} = ${saveRes.total}`;
      if (saved) {
        this.fxLog(`🛡️ ${h.data.name} succeeds on the ${fx.save.ab.toUpperCase()} save vs ${m.data.name}'s ${label}!`, 'roll',
          { detail: `(${rollStr} vs DC ${dc})` });
      } else {
        this.fxLog(`⚡ ${h.data.name} fails the ${fx.save.ab.toUpperCase()} save vs ${m.data.name}'s ${label}!`, 'down',
          { detail: `(${rollStr} vs DC ${dc})` });
      }
    }

    /* Declared out here because the `heal:true` lifesteal rider below needs the
       damage this ability actually dealt. */
    let dmg = 0;
    if (fx.dice) {
      dmg = roll(fx.dice[0], fx.dice[1], fx.dice[2] || 0);
      /* Evasion (rogue 7 / monk 7): against a DEX save for half, a pass takes
         nothing and a fail takes half. */
      const dexHalf = fx.save && fx.save.half && (fx.save.ab || 'con') === 'dex';
      const evasion = dexHalf && h.data && hasFeature(h.data, 'evasion');
      /* Shield Master's reaction: a passed DEX save for half means no damage */
      const shieldMaster = dexHalf && saved && h.data && hasFeat(h.data, 'shieldMaster') && hasShieldEquipped(h.data) && !h.reactionUsed;
      if (shieldMaster) { h.reactionUsed = true; dmg = 0; this.fxText('shield!', this._v3(h.x, 1.3, h.z), '#c0d8ff'); }
      else if (evasion) dmg = saved ? 0 : Math.floor(dmg / 2);
      else if (saved) dmg = fx.save && fx.save.half ? Math.floor(dmg / 2) : 0;
      if (dmg > 0) {
        this.fxLog(`${m.data.name}'s ${label} hits ${h.data.name} for ${dmg}${saved ? ' (saved for half)' : ''}`, 'down');
        this.hurtHero(h, dmg, m, fx.color || 0xff5040, fx.dmgType, isSpell);
      } else {
        this.fxText(saved ? 'save!' : 'resist', this._v3(h.x, 1.1, h.z), '#9aa');
      }
    } else if (saved) {
      this.fxText('save!', this._v3(h.x, 1.1, h.z), '#9aa');
    }

    /* Lifesteal riders (stirge Blood Drain, succubus Draining Kiss…): `heal:true`
       heals for the damage dealt, `heal:[n,d,f]` rolls a set amount, `heal:5` is flat. */
    if (fx.heal && m.data && m.data.hp > 0) {
      let amt = 0;
      if (fx.heal === true) amt = dmg;
      else if (Array.isArray(fx.heal)) amt = roll(fx.heal[0], fx.heal[1], fx.heal[2] || 0);
      else if (typeof fx.heal === 'number') amt = fx.heal;
      if (amt > 0) {
        const before = m.data.hp;
        m.data.hp = Math.min(m.data.maxHp, m.data.hp + amt);
        const gained = m.data.hp - before;
        if (gained > 0) {
          this.fxText('+' + gained, this._v3(m.x, 1.4, m.z), '#6ae06a');
          this.fxDrawBar(m.ent.bar, Math.max(0, m.data.hp / m.data.maxHp), '#6ae06a');
          this.fxLog(`🩸 ${m.data.name} drains ${gained} HP from ${h.data.name}.`, 'heal');
        }
      }
    }

    if (fx.effect && !saved) {
      const eOpts = { duration: fx.effect.dur, elapsed: this.fxNow, source: m };
      /* repeat save each round to shake the condition off (5e "at the end
         of each of its turns") — reuses the ability's own save & DC */
      if (fx.effect.repeatSave && fx.save)
        eOpts.repeatSave = { ability: fx.save.ab, dc: fx.save.dc, every: ROUND_SECONDS };
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
          this.fxDrawBar(h.ent.bar, Math.max(0, h.data.hp / h.data.maxHp));
        }
        this.fxText(fx.effect.key, this._v3(h.x, 1.35, h.z), '#d0a0ff');
        this.fxLog(`✨ ${h.data.name} is now ${fx.effect.key}!`, 'crit');
      }
    }

    /* Forced movement. `pull` reels the hero toward the monster, `push` shoves
       them away; the value is whole 5 ft cells. pushEntity walks it a tile at a
       time and stops at the first wall, solid prop, closed door, or occupied /
       reserved cell, so a chain can never drag someone through geometry or
       stack them on top of another body. It also leaves a knock-glide on the
       sprite, which is what the 'chain' beam tracks while it reels in.

       Resolved LAST so the hero is still standing where they were hit while the
       damage numbers and the save readout land on them. */
    const shift = fx.pull || fx.push;
    if (shift && !saved && h.data.hp > 0 && typeof this.pushEntity === 'function') {
      const dir = fx.pull ? -1 : 1;
      const moved = this.pushEntity(h, m.x, m.z, shift, dir);
      if (moved > 0) {
        if (this.clearPendingMove) this.clearPendingMove();
        this.fxLog(`⛓ ${h.data.name} is ${fx.pull ? 'hauled' : 'shoved'} ${moved * 5} ft!`, 'down');
      } else {
        /* Wedged against something — the hook still bit, it just could not
           take up any slack. Say so rather than silently doing nothing. */
        this.fxLog(`⛓ The chain goes taut — ${h.data.name} does not budge.`, 'roll');
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
    this.refreshHud();
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
              const vfxType = getPixelVfxTypeForAbility(ab);
              const defColor = vfxType === 'gibbering' ? 0xd946ef : (vfxType === 'stench' ? 0x84cc16 : (vfxType === 'fire' ? 0xf97316 : (vfxType === 'frost' ? 0x38bdf8 : (vfxType === 'holy' ? 0xfacc15 : 0x88aa66))));
              this.fxTelegraph({ x: m.x, z: m.z }, r, ab.color || defColor, 0.6, { type: vfxType });
              this._resolveAbilityOnHero(m, actor, ab, ab.label || 'an aura');
              if (this.heroes) this.refreshHud();
            }
          }
        }
      }
    } else if (actor._side === 'mon' && actor.active && actor.data && actor.data.hp > 0 && actor.data.abilities) {
      /* Monster starting turn: pulse visual telegraph and resolve aura on all nearby heroes */
      for (const ab of actor.data.abilities) {
        if (ab.trigger !== 'aura') continue;
        const r = ab.aoe || ab.radius || 2.0;
        const vfxType = getPixelVfxTypeForAbility(ab);
        const defColor = vfxType === 'gibbering' ? 0xd946ef : (vfxType === 'stench' ? 0x84cc16 : (vfxType === 'fire' ? 0xf97316 : (vfxType === 'frost' ? 0x38bdf8 : (vfxType === 'holy' ? 0xfacc15 : 0x88aa66))));
        this.fxTelegraph({ x: actor.x, z: actor.z }, r, ab.color || defColor, 0.6, { type: vfxType });
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
        if (targets.length) this.refreshHud();
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
      this.fxLog(`💥 ${m.data.name}'s ${ab.label || 'death burst'}!`, 'crit');
      const vfxType = getPixelVfxTypeForAbility(ab) === 'shockwave' ? 'fire' : getPixelVfxTypeForAbility(ab);
      this.fxTelegraph({ x: m.x, z: m.z }, r, ab.color || 0xff7a30, 0.7, { type: vfxType });
      for (const h of targets) this._resolveAbilityOnHero(m, h, ab, ab.label || 'death burst', { aoe: true });
      this.refreshHud();
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
        const vfxType = getPixelVfxTypeForAbility(ab);
        this.fxTelegraph({ x: m.x, z: m.z }, r, ab.color || 0xff7a30, 0.5, { type: vfxType });
        for (const h of targets) this._resolveAbilityOnHero(m, h, ab, ab.label || 'retaliation');
      } else {
        this._resolveAbilityOnHero(m, attacker, ab, ab.label || 'retaliation');
      }
      this.refreshHud();
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
          this.fxText('+' + gained, this._v3(m.x, 1.4, m.z), '#6ae06a');
          this.fxDrawBar(m.ent.bar, Math.max(0, m.data.hp / m.data.maxHp), '#6ae06a');
        }
        this.fxLog(`🩸 ${m.data.name}'s ${ab.label || 'kill buff'} (+${gained} HP).`, 'heal');
        didSomething = true;
      }
      /* buff: apply a status effect to self (raging / bloodlust / hasted…) */
      if (ab.buff) {
        const effKey = typeof ab.buff === 'string' ? ab.buff : ab.buff.key;
        const dur = (typeof ab.buff === 'object' ? ab.buff.dur : null) || ab.dur || ROUND_SECONDS;
        applyEffect(m, effKey, { duration: dur, elapsed: this.fxNow });
        this.fxLog(` ${m.data.name}'s ${ab.label || 'kill buff'}!`, 'crit');
        this.fxText(ab.label || 'kill buff', this._v3(m.x, 1.5, m.z), '#e8c25a');
        didSomething = true;
      }
      /* AoE: also frighten / damage nearby heroes (death-knight-style) */
      if (ab.aoe && (ab.dice || ab.effect)) {
        const r = ab.aoe;
        const targets = this.heroes.filter(h => h.data.hp > 0 && Math.hypot(h.x - m.x, h.z - m.z) <= r);
        this.fxTelegraph({ x: m.x, z: m.z }, r, ab.color || 0xff7a30, 0.5);
        for (const h of targets) this._resolveAbilityOnHero(m, h, ab, ab.label || 'kill aura');
        this.refreshHud();
        didSomething = true;
      }
      /* Centered sprite for the kill moment — if the ability declared one
         and we actually did something above. Covers vampire-spawn blood-feast
         (drain_red_2), gnoll/orc rampage (gold_sparkles_1), etc. */
      if (didSomething) {
        this.fxPlaySfx(this.fxAbilitySfx(ab.spell || ab.key, ab), { volume: 0.55 });
        if (ab.sprite) {
          this.fxSprite(`dcss/effect/${ab.sprite}.png`,
            this._v3(m.x, 1.0, m.z), 1.4, 0.7);
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
        const dur = (typeof ab.buff === 'object' ? ab.buff.dur : null) || ab.dur || ROUND_SECONDS * 2;
        applyEffect(m, effKey, { duration: dur, elapsed: this.fxNow });
        this.fxLog(`${m.data.name} ${ab.label || 'enrages'}!`, 'crit');
        this.fxText(ab.label || 'ENRAGED', this._v3(m.x, 1.5, m.z), '#ff5040');
        this.triggerShake(0.5, 0.25);
        didSomething = true;
      }
      /* AoE: some bloodied triggers pulse outward (frightful presence) */
      if (ab.aoe && (ab.dice || ab.effect)) {
        const r = ab.aoe;
        const targets = this.heroes.filter(h => h.data.hp > 0 && Math.hypot(h.x - m.x, h.z - m.z) <= r);
        this.fxTelegraph({ x: m.x, z: m.z }, r, ab.color || 0xff7a30, 0.6);
        for (const h of targets) this._resolveAbilityOnHero(m, h, ab, ab.label || 'bloodied aura');
        this.refreshHud();
        didSomething = true;
      }
      /* Enrage visual — flame_0 family is canonical (matches player Rage). */
      if (didSomething) {
        this.fxPlaySfx(this.fxAbilitySfx(ab.spell || ab.key, ab), { volume: 0.6 });
        if (ab.sprite) {
          this.fxSprite(`dcss/effect/${ab.sprite}.png`,
            this._v3(m.x, 1.0, m.z), 1.8, 0.9);
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


    /* Combat commits to a square: pick a destination once, walk it, then
       pick again. Mid-walk repath reset pathI to 0 and stepAlong snapped
       the body back onto its own tile centre every tick. */
    if (!this.hasLivePath(m)) {
      let goal = this.cellOf(tgt.x, tgt.z);
      /* flank: aim for the far side of the target if allies are already
         clustered on it, so melee wraps around instead of stacking */
      const flank = this.flankGoal(m, tgt);
      const from = this.cellOf(m.x, m.z);
      let route = null;
      if (flank >= 0) {
        goal = flank;
        /* Wrapping round to the far side is only worth it when the walk fits
           this turn's movement. A flank that ends a tile short leaves the
           monster standing next to nobody with its Action unspent — the
           direct approach attacks this turn instead. */
        if (planned(this)) {
          const flankRoute = this.findPath(from, this.nearUnoccupiedGoal(m, flank), { avoidClosedDoors: true, mover: m });
          const budget = m.moveLeft != null ? m.moveLeft : this.cellsForSpeed(m);
          if (!flankRoute || flankRoute.length - 1 > budget) {
            goal = typeof this.approachCellNear === 'function'
              ? this.approachCellNear(this.cellOf(tgt.x, tgt.z), m) : this.cellOf(tgt.x, tgt.z);
          } else route = flankRoute;
        }
      }
      /* Avoid pathing directly onto a cell already occupied by another monster */
      goal = this.nearUnoccupiedGoal(m, goal);
      this.setEntityPath(m, route || this.findPath(from, goal, { avoidClosedDoors: true, mover: m }));
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
    /* Check opportunity attack risk before stepping out of reach */
    if (this.initiative?.active && m.path && m.pathI < m.path.length && !m.disengageActive) {
      const fromCell = this.cellOf(m.x, m.z);
      const nextCell = m.path[m.pathI];
      const provokers = provokesOA(this.oaHostiles(m), fromCell, nextCell);
      if (provokers.length > 0) {
        /* Only spend the Action breaking contact when the monster would rather
           not eat the hit — a bloodied retreat or a squishy kiter. Healthy
           bruisers take the opportunity attack like the wall they are. */
        const pinnedBy = this.heroes.filter(h => h.data && h.data.hp > 0 &&
          Math.hypot(h.x - m.x, h.z - m.z) <= MONSTER_MELEE_RANGE + 0.3).length;
        /* Mid-approach, a Disengage spends the Action that the monster was
           walking up to use: it arrives and cannot attack. Something already
           in reach is the better use of the turn. (Retreating is decided at
           turn start, in monsterTacticalAction.) */
        const inReach = planned(this) && !m.actUsed ? this.monsterAdjacentHero(m) : null;
        if (inReach) {
          m.path = null; m.walk = false; m.moving = false;
          m._tgtIdx = this.heroes.indexOf(inReach);
          this.monsterMelee(m, inReach, dt);
          return;
        }
        if (!planned(this) && shouldDisengage(m, { pinned: pinnedBy > 0 })
            && !m.actUsed && this.takeCommonAction(m, 'disengage')) {
          this.fxLog(`💨 ${m.data.name} Disengages to avoid opportunity attacks.`, 'sys');
        } else if (Math.hypot(tgt.x - m.x, tgt.z - m.z) <= MONSTER_MELEE_RANGE) {
          m.path = null;
          m.walk = false;
          m.moving = false;
          this.monsterMelee(m, tgt, dt);
          return;
        }
      }
    }

    const moved = this.moveStep(m, spd, dt);
    m.walk = moved;
    m.moving = moved;

    /* If a ranged monster closed in or rounded an obstruction and now has clear line of sight, take the shot! */
    if (m.data.ranged && !m.actUsed) {
      const curDist = Math.hypot(tgt.x - m.x, tgt.z - m.z);
      if (curDist <= m.data.rngRange && this.hasLOS(m.x, m.z, tgt.x, tgt.z)) {
        m.path = null;
        m.walk = false;
        m.moving = false;
        this.faceTowards(m, tgt.x, tgt.z, dt);
        this.monsterRanged(m, tgt, dt);
        return;
      }
    }

    /* Monster stuck-recovery. Heroes get multi-stage handleStuck; monsters had
       nothing, so a body wedged against a doorway frame (stepAlong reports no
       progress) used to sit there until its next scheduled repath produced the
       same blocked route. Nudge it perpendicular to the approach to slip off
       the frame, then force an immediate repath (a fresh flank goal often
       routes it to the other side of the target). A doorway single-file yield
       is expected, so only recover once genuinely stuck for ~0.6 s.
       Guarded by canMove so an OFF-TURN monster (held still by moveStep) is
       never mistaken for stuck and nudged/repathed off its square. */
    if (!moved && this.canMove(m) && m.path && m.pathI < m.path.length) {
      m._stuckT = (m._stuckT || 0) + dt;
      if (m._stuckT > 0.6) {
        /* Drop the blocked route so the next think repaths. Do NOT nudge the
           sprite 0.4 off-centre — that offset is the empty-room tile-edge
           jitter (snap then pulls it back). */
        if (typeof this.clearEntityPath === 'function') this.clearEntityPath(m);
        else { m.path = null; m.pathI = 0; }
        m.repathT = 0; m._stuckT = 0;
      }
    } else {
      m._stuckT = 0;
    }
  },

  monsterMelee(m, tgt, dt) {
    m.walk = false;
    m.moving = false;
    m.path = null;
    this.faceTowards(m, tgt.x, tgt.z, dt);
    if (!m.actUsed) {
      m.actUsed = true;
      /* Count this swing toward the ability cast cadence (see tryMonsterCycleAbility). */
      this._countSwing(m);
      this.monsterAttack(m, tgt);
      /* Multiattack (5e): `attacksPerTurn: N` strikes N times per cd window. */
      this._scheduleMultiattack(m, tgt, () => this.monsterAttack(m, tgt));
    }
  },

  /** One monster → hero attack roll + damage. */
  monsterAttack(m, h) {
    /* 40: light-snuffers — a goblin or cultist may douse a lit hero's torch
       (once per fight) instead of swinging. The hero is in the dark until it
       dries out (game.js ticks _dousedT down). */
    if (h && h.data && h._lightActive && !m._dousedOnce && monsterLightTraits(m).douser
        && !hasEffect(m, 'charmed') && !getEffectMods(m).incapacitated && Math.random() < 0.25) {
      m._dousedOnce = true;
      h.data._dousedT = 12;
      if (this.fxLog) this.fxLog(`💧 ${m.data.name} hurls water — ${h.data.name}'s light hisses out!`, 'crit');
      return;
    }
    if (this.isMonsterEntity(h)) return this.monsterAttackMonster(m, h, false);
    /* charmed or incapacitated monsters skip attacks */
    if (hasEffect(m, 'charmed')) {
      this.fxText('charmed', this._v3(m.x, 1.1, m.z), '#e8a8ff');
      return;
    }
    if (getEffectMods(m).incapacitated) return;
    /* Invisible monsters are revealed the moment they attack (5e) */
    if (hasEffect(m, 'invisible')) this.revealInvisible(m);
    /* Sentinel: a guard standing next to this monster punishes it for
       attacking someone else — before the blow lands. */
    if (this.sentinelReaction) this.sentinelReaction(m, h);
    if (m.data.hp <= 0 || m.dead) return;
    const dmgDealtMul = getEffectMods(m).dmgDealtMul;
    this.triggerLunge(m, h);
    /* Animated-atlas monsters (bestiary editor) play their one-shot attack
       sheet. Forced: a Multiattack follow-up may land a frame before the
       previous swing's sheet has settled back to idle, and play() would
       otherwise no-op and leave the impact delay pointing into thin air. */
    if (m.ent && m.ent.anim && m.ent.anim.play) m.ent.anim.play('attack', true);
    const animRem = actionAnimRemaining(m);
    if (animRem > 0 && typeof this.fxHold === 'function') this.fxHold(animRem);
    const adv = this.monsterAttackAdv(m, h);
    const d20 = d20Roll(adv);
    const atkMods = getEffectMods(m);
    let atkBonus = (m.data.atk != null ? m.data.atk : 4) + (atkMods.atkBonus || 0);
    if (atkMods.blessDice) atkBonus += die(4);
    let total = d20 + atkBonus;
    let crit = d20 === 20;
    /* defender auto-crit on melee (paralyzed/unconscious) */
    if (getEffectMods(h).autoCritMelee) crit = true;
    if (crit) this.triggerHitStop(2);
    let ac = this.heroAC(h);
    /* Defensive Duelist: a finesse fighter may parry one melee hit per round */
    if (!crit && this.defensiveDuelistParry) ac += this.defensiveDuelistParry(h, total, ac);
    /* Jarring Chord (bard talent): a nearby bard's note may spoil the blow */
    if (this.jarringChord) total = this.jarringChord(m, h, total, ac, crit);
    if (this.bendLuckAttack) total = this.bendLuckAttack(m, h, total, ac, crit);
    /* The outcome is decided now, but the CONSEQUENCES wait for the swing to
       reach its contact pose - otherwise the damage number and hit spark appear
       while the creature is still winding up. 0 for un-animated monsters, which
       keeps their timing exactly as before. */
    const impactIn = (m.ent && m.ent.anim && m.ent.anim.attackImpactDelay)
      ? m.ent.anim.attackImpactDelay() : 0;
    const onImpact = (fn) => this.fxImpactDelay(impactIn, fn);

    this.fxPlaySfx('swordAttack', { volume: 0.5 });
    /* Mirror Image: a blow that would connect may be drawn onto a duplicate. */
    if ((crit || total >= ac) && this.mirrorImageIntercept && this.mirrorImageIntercept(h, total)) {
      onImpact(() => this.fxPlaySfx('swordBlock', { volume: 0.4 }));
      return;
    }
    if (!crit && total < ac) {
      onImpact(() => {
        if (this.showMiss) this.showMiss(h, m);
        else this.fxText('miss', this._v3(h.x, 1.1, h.z), '#9aa');
        this.fxPlaySfx(Math.random() < 0.5 ? 'swordBlock' : 'swordParry', { volume: 0.5 });
        this.fxLog(`${m.data.name} → ${h.data.name}: miss`, 'miss',
          { detail: `(${total} vs AC ${ac}${adv > 0 ? ', adv' : adv < 0 ? ', dis' : ''})` });
        /* Counterstrike (fighter talent): the miss opens the monster up */
        if (this.counterstrike) this.counterstrike(m, h);
      });
      return;
    }

    const dmgArr = Array.isArray(m.data.dmg) ? m.data.dmg : [1, 8, 2];
    let dice = dmgArr[0]; if (crit) dice *= 2;
    const statKey = m.data.ranged ? 'dex' : 'str';
    const statVal = m.data.effStats?.[statKey] ?? m.data.statblock?.stats?.[statKey] ?? 10;
    const statMod = Math.floor((statVal - 10) / 2);
    const dmgBonus = Math.max(dmgArr[2] || 0, statMod);
    let dmg = roll(dice, dmgArr[1], dmgBonus) + (atkMods.dmgBonus || 0);
    dmg = Math.round(dmg * dmgDealtMul);
    /* Swarms deal half damage once bloodied (SRD "…or half if the swarm has
       half of its hit points or fewer"). */
    if (m.data.swarm && m.data.maxHp && m.data.hp <= m.data.maxHp / 2) dmg = Math.max(1, Math.floor(dmg / 2));
    /* Martial Advantage (SRD hobgoblin): +2d6 when an ally is adjacent to the target */
    if (m.data.martialAdvantage) {
      for (const o of this.monsters) {
        if (o === m || o.dead || o.data.hp <= 0 || !o.active) continue;
        if (Math.hypot(o.x - h.x, o.z - h.z) < MONSTER_MELEE_RANGE + 0.5) { dmg += die(6) + die(6); break; }
      }
    }
    if (dmg >= 15) this.triggerShake(0.4, 0.2);
    if (m.cutWordsUntil && this.fxNow < m.cutWordsUntil) dmg = Math.max(1, dmg - 2);

    onImpact(() => {
      /* The target may already be down by the time the blow lands - another
         attacker can resolve during the wind-up. Same guard fxProjectile uses. */
      if (h.data.hp <= 0) return;
      this.fxPlaySfx('swordHit', { volume: 0.6 });
      if (crit) {
        this.triggerHitStop(4);
        this.triggerShake(0.5, 0.25);
      } else {
        this.triggerHitStop(1);
      }
      this.fxMeleeHitVFX({ x: h.x, z: h.z }, { x: m.x, z: m.z }, crit, 'slashing', 0.9);
      const mit = {};
      const dealt = this.applyIncomingDamage
        ? this.applyIncomingDamage(h, dmg, mit, { dmgType: m.data.dmgType || 'slashing', magical: !!m.data.magicalAttacks })
        : (h.data.hp -= dmg, dmg);
      this.fxHitFlash(h.ent);
      /* Logged HERE, after mitigation, so the line agrees with the number over
         the hero's head. Printed before the roll was applied, it reported the
         raw damage while temp HP, Uncanny Dodge or Heavy Armor Master had
         already eaten some or all of it — "hits for 7" above a floating 0. */
      const soak = this.describeMitigation ? this.describeMitigation(mit, dmg, dealt) : '';
      this.fxLog(`${m.data.name} hits ${h.data.name} for ${dealt}${crit ? ' (crit!)' : ''}${soak}`,
        crit ? 'down' : 'roll', { cat: 'hitmiss' });
      if (this.fxDamageNumber) this.fxDamageNumber(h, dealt, mit, crit ? '#ff5040' : '#ff9a7a', crit);
      else this.fxText(String(dealt), this._v3(h.x, 1.2, h.z), crit ? '#ff5040' : '#ff9a7a');
      this.fxDrawBar(h.ent.bar, Math.max(0, h.data.hp / h.data.maxHp));
      /* legendary defensive perks (thorns / riposte) */
      if (dealt > 0 && this.applyOnDamagedPerks) this.applyOnDamagedPerks(h, m, dealt);
      /* onHit ability riders (poison bite, paralysis claws, life drain…) */
      if (dealt > 0) this.applyOnHitAbilities(m, h);
      this.refreshHud();
      if (h.data.hp <= 0) {
        if (h.companion && this.killCompanion) {
          this.killCompanion(h, m);
        } else {
          h.data.hp = 0; h.data.downs++;
          this.triggerShake(0.7, 0.35);
          this.fxLog(`💀 ${h.data.name} goes down!`, 'down');
        }
        /* onKill riders (gnoll Rampage, vampire lifesteal…). */
        if (m?.data?.abilities) this.applyOnKillAbilities(m, h);
      }
    });
  },

  /**
   * Monster-vs-monster attack (Dominate Monster). Same roll as monsterAttack
   * — d20 + atk vs the target's AC, crit on a natural 20 — but the damage goes
   * through damageMonster so resistances, Undead Fortitude, death and loot all
   * behave. A dominated attacker's hits are credited to its master (threat,
   * damage tally, kill line); a hostile hitting the thrall credits nobody.
   */
  monsterAttackMonster(m, tgt, ranged = false) {
    if (getEffectMods(m).incapacitated) return;
    if (!tgt || !tgt.data || tgt.data.hp <= 0 || tgt.dead) return;
    if (hasEffect(m, 'invisible')) this.revealInvisible(m);
    if (!ranged) this.triggerLunge(m, tgt);
    if (m.ent && m.ent.anim && m.ent.anim.play) m.ent.anim.play('attack', true);
    const animRem = actionAnimRemaining(m);
    if (animRem > 0 && typeof this.fxHold === 'function') this.fxHold(animRem);

    const atkMods = getEffectMods(m);
    const tgtMods = getEffectMods(tgt);
    let adv = 0;
    if (tgtMods.defAdvantage) adv += 1;
    if (atkMods.atkDisadvantage) adv -= 1;
    const d20 = d20Roll(adv);
    let atkBonus = (m.data.atk != null ? m.data.atk : 4) + (atkMods.atkBonus || 0);
    if (atkMods.blessDice) atkBonus += die(4);
    const total = d20 + atkBonus;
    let crit = d20 === 20;
    if (tgtMods.autoCritMelee && !ranged) crit = true;
    const ac = (tgt.data.ac != null ? tgt.data.ac : 10) + (tgtMods.acBonus || 0);

    const impactIn = (m.ent && m.ent.anim && m.ent.anim.attackImpactDelay)
      ? m.ent.anim.attackImpactDelay() : 0;
    const credit = m.dominatedBy || null;
    const label = credit ? `${m.data.name} (dominated)` : m.data.name;

    const resolve = () => {
      if (tgt.data.hp <= 0 || tgt.dead) return;
      if (!crit && total < ac) {
        this.fxText('miss', this._v3(tgt.x, 1.1, tgt.z), '#9aa');
        this.fxPlaySfx(Math.random() < 0.5 ? 'swordBlock' : 'swordParry', { volume: 0.5 });
        this.fxLog(`${label} → ${tgt.data.name}: miss`, 'miss', { detail: `(${total} vs AC ${ac})` });
        return;
      }
      const dmgArr = Array.isArray(m.data.dmg) ? m.data.dmg : [1, 8, 2];
      let dice = dmgArr[0]; if (crit) dice *= 2;
      const statKey = m.data.ranged ? 'dex' : 'str';
      const statVal = m.data.effStats?.[statKey] ?? m.data.statblock?.stats?.[statKey] ?? 10;
      const dmgBonus = Math.max(dmgArr[2] || 0, Math.floor((statVal - 10) / 2));
      let dmg = roll(dice, dmgArr[1], dmgBonus) + (atkMods.dmgBonus || 0);
      dmg = Math.round(dmg * atkMods.dmgDealtMul);
      if (m.data.swarm && m.data.maxHp && m.data.hp <= m.data.maxHp / 2) dmg = Math.max(1, Math.floor(dmg / 2));
      if (m.cutWordsUntil && this.fxNow < m.cutWordsUntil) dmg = Math.max(1, dmg - 2);
      this.fxPlaySfx(ranged ? 'bowHit' : 'swordHit', { volume: 0.6 });
      if (!ranged) this.fxMeleeHitVFX({ x: tgt.x, z: tgt.z }, { x: m.x, z: m.z }, crit, 'slashing', 0.9);
      const dmgType = m.data.ranged ? (m.data.rangedDmgType || 'piercing') : (m.data.dmgType || 'slashing');
      this.fxLog(`${label} hits ${tgt.data.name} for ${dmg}${crit ? ' (crit!)' : ''}`, crit ? 'down' : 'roll', { cat: 'hitmiss' });
      this.damageMonster(tgt, dmg, credit, crit, { skipPerks: true, via: m, dmgType });
    };

    if (ranged) {
      this.fxPlaySfx('bowAttack', { volume: 0.5 });
      this.fxImpactDelay(impactIn, () =>
        this.fxProjectile(this._v3(m.x, 0.55, m.z), this._v3(tgt.x, 0.4, tgt.z), 'arrow', 0xd0c0a0, resolve));
    } else {
      this.fxPlaySfx('swordAttack', { volume: 0.5 });
      this.fxImpactDelay(impactIn, resolve);
    }
  },

  /**
   * Presentation: position, walk bob, attack lunge orientation.
   * Kept next to AI so monster visual state stays in one place.
   */
  updateMonsterVisuals(dt, elapsed, cosC, sinC) {
    for (const m of this.monsters) {
      if (m.data.hp <= 0) {
        if (m._deathAnim && m.ent && m.ent.anim && m.ent.anim.mesh) {
          const a = m._deathAnim;
          const mesh = m.ent.anim.mesh;
          const mat = mesh.material;

          /* Death hold: let the killing blow finish reading before the body
             starts to go. updateMonsters skips dead monsters entirely, so the
             flash has to be ticked from here or it would freeze on frame one.
             Nothing below this runs during the hold — the dissolve resets the
             colour and the scale every frame, which would eat the flash. */
          if (a.holdT > 0) {
            a.holdT -= dt;
            this.fxUpdateFlash(m.ent, dt);
            if (a.holdT > 0) continue;
            /* Hold over: hand the sprite to the dissolve in a known state. */
            if (mat) {
              mat.rotation = 0;
              if (mat.color) mat.color.setRGB(1, 1, 1);
            }
            mesh.position.x = m.ent._shudderHome || mesh.position.x;
            mesh.scale.set(a.baseScaleX, a.baseScaleY, 1.0);
            m.ent.flashT = 0;
          }

          a.t += dt;
          const k = Math.min(1.0, a.t / a.dur);
          /* Ease-out: the head goes first, then the rest of the body. */
          const dissolve = 1 - Math.pow(1 - k, 1.55);

          if (!a.started) {
            a.started = true;
            if (typeof this.fxBeginEvaporate === 'function') this.fxBeginEvaporate(mesh);
          }
          const bounds = (typeof this.fxSetEvaporate === 'function')
            ? this.fxSetEvaporate(mesh, dissolve, a.t)
            : null;

          /* Specks rise from the current dissolve edge (top of what's left). */
          if (typeof this.fxEvaporatePixels === 'function') {
            const rate = 110 + dissolve * 50;
            a.pixAcc = (a.pixAcc || 0) + dt * rate;
            const n = Math.min(32, Math.floor(a.pixAcc));
            if (n > 0) {
              a.pixAcc -= n;
              const grpS = (m.ent.grp && m.ent.grp.scale && m.ent.grp.scale.x) || 1;
              const gy = (m.ent?.grp?.position?.y || 0) + (mesh?.position?.y || 0);
              const totalH = (a.baseScaleY || 1) * grpS;
              const h = Math.max(0.04, gy + (1.0 - dissolve) * totalH);
              const width = (a.baseScaleX || 1) * grpS * 1.15;
              const mx = m.ent?.grp?.position?.x ?? m.x;
              const mz = m.ent?.grp?.position?.z ?? m.z;
              this.fxEvaporatePixels({ x: mx, y: h, z: mz }, n, null, mesh, dissolve, width);
            }
          }

          if (mat) {
            mat.rotation = 0;
            if (mat.color && (mat.color.r !== 1 || mat.color.g !== 1 || mat.color.b !== 1)) {
              mat.color.setRGB(1, 1, 1);
            }
            mat.opacity = k > 0.94 ? Math.max(0, 1 - (k - 0.94) / 0.06) : 1;
          }
          mesh.scale.set(a.baseScaleX, a.baseScaleY, 1.0);

          if (k >= 1.0) {
            if (m.ent.grp) m.ent.grp.visible = false;
            if (mat) {
              mat.opacity = 1.0;
              mat.rotation = 0;
            }
            mesh.scale.set(a.baseScaleX, a.baseScaleY, 1.0);
            m._deathAnim = null;
          }
        } else if (m.ent?.grp) {
          m.ent.grp.visible = false;
        }
        continue;
      }
      const [ox, oz] = this.lungeOffset(m, dt);
      const gp = m.ent.grp.position;
      gp.set(m.x + ox,
             easeBodyY(gp.y, groundYAt(this.D, m.x + ox, m.z + oz), dt),
             m.z + oz);
      Motion.visual(this, m, m.x + ox, m.z + oz, (m.lungeT > 0) ? 'lunge' : ((m.knockT > 0) ? 'knockback' : 'sprite'));

      /* Visual scale: enlarged status effect increases sprite size by 50% */
      if (m.ent && m.ent.grp) {
        const isEnlarged = hasEffect(m, 'enlarged') || hasEffect(m.data, 'enlarged');
        const targetScale = isEnlarged ? 1.5 : 1.0;
        const currentScale = m.ent.grp.scale.x || 1.0;
        if (Math.abs(currentScale - targetScale) > 0.005) {
          const newScale = currentScale + (targetScale - currentScale) * Math.min(1.0, dt * 8.0);
          m.ent.grp.scale.set(newScale, newScale, newScale);
        } else if (currentScale !== targetScale) {
          m.ent.grp.scale.set(targetScale, targetScale, targetScale);
        }
      }

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
        /* Standing monsters get the wide band, like resting heroes: only the
           camera turns them, and the exploration orbit must not flip them. */
        m.ent.anim.setDirection(rdx, rdz, m.walk ? FACING_BAND_MOVE : FACING_BAND_REST);
        if (m.walk) {
          m.ent.anim.mesh.position.y = Math.abs(Math.sin(elapsed * 9)) * 0.08;
        } else {
          /* Animated sprites run their own clock (idle loop) — only static
             billboards freeze time when standing still. */
          if (!m.ent.anim.animated) m.ent.anim.time = 0;
          m.ent.anim.mesh.position.y = 0;
        }
      }
      m.ent.anim.update(dt);
    }
  }
};
