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
  updateStatusTray
} from './entities.js';
import { log, updatePartyFrames } from './ui.js';
import { SPELLS } from './spells.js';
import { roll, d as die, d20Roll } from './srd.js';
import { hasFeature } from './features.js';
import { AGGRO_RANGE, MONSTER_ATTACK_CD, MONSTER_SPEED_MULT,
  THREAT_WEIGHT, THREAT_DIST_WEIGHT, THREAT_JITTER, THREAT_HALFLIFE_SEC, TARGET_SWITCH_MARGIN,
  KITE_THREAT_RANGE, KITE_RETREAT_DIST, KITE_COMMIT_SEC,
  FLANK_OFFSET, PACK_TAGS, PACK_IDS, PACK_FOCUS_BONUS } from './constants.js';
import { hasEffect, getEffectMods, tickEffects as _tickEffects, applyEffect, rollSave } from './conditions.js';
import { _v } from './shared.js';
import { playSfx } from './audio.js';

/** Spells accessible to specific boss monsters (by id).  Keys are spell ids
 *  from the SPELLS registry; bosses cast them on alternating attack cycles. */
const BOSS_SPELLS = {
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
const BOSS_SPELL_FX = {
  fireball:          { label:'Fireball',       color:0xff7a30, sprite:'cloud_fire_2',    aoe:2.6, dice:[6,6,4],  save:{ ab:'dex', dc:15, half:true } },
  flameStrike:       { label:'Flame Strike',   color:0xffd34a, sprite:'flame_1',         aoe:2.6, dice:[6,6,6],  save:{ ab:'dex', dc:16, half:true } },
  dragonBreathSpell: { label:'Searing Breath', color:0xff6020, sprite:'cloud_fire_1',    aoe:3.0, dice:[8,6,4],  save:{ ab:'dex', dc:16, half:true } },
  coneOfCold:        { label:'Cone of Cold',   color:0x7fd4ff, sprite:'frost_0',         aoe:3.0, dice:[6,8,0],  save:{ ab:'con', dc:16, half:true } },
  shatter:           { label:'Shatter',        color:0xd0a0ff, sprite:'sandblast_1',     aoe:2.4, dice:[3,8,2],  save:{ ab:'con', dc:14, half:true } },
  callLightning:     { label:'Call Lightning', color:0x7090ff, sprite:'zap_2',           aoe:2.2, dice:[4,10,0], save:{ ab:'dex', dc:15, half:true } },
  chaosBolt:         { label:'Chaos Bolt',     color:0xff8844, sprite:'cloud_chaos_4',            dice:[3,8,4] },
  acidArrow:         { label:'Acid Arrow',     color:0x4cae4c, sprite:'acid_venom',               dice:[4,4,3] },
  blight:            { label:'Blight',         color:0x6a3080, sprite:'cloud_neg_1',              dice:[6,8,0],  save:{ ab:'con', dc:16, half:true } },
  inflictWounds:     { label:'Inflict Wounds', color:0xc04040, sprite:'drain_red_1',              dice:[5,10,0] },
  fear:              { label:'Fear',           color:0x9b59b6, sprite:'cloud_gloom_new', aoe:3.2, effect:{ key:'frightened', dur:6 }, save:{ ab:'wis', dc:15 } },
  slow:              { label:'Slow',           color:0x8fd4e8, sprite:'cloud_blue_smoke', aoe:2.8, effect:{ key:'slowed', dur:6 },     save:{ ab:'wis', dc:15 } },
  web:               { label:'Web',            color:0xbfa060, sprite:'net_trap',         aoe:2.6, effect:{ key:'restrained', dur:6 }, save:{ ab:'dex', dc:14 } },
  darkness:          { label:'Darkness',       color:0x888899, sprite:'cloud_black_smoke', aoe:3.0, effect:{ key:'blinded', dur:5 } },
  holdPerson:        { label:'Hold Person',    color:0x8090c0, sprite:'silenced',                 effect:{ key:'paralyzed', dur:5 }, save:{ ab:'wis', dc:15 } },
  holdMonster:       { label:'Hold',           color:0x8090c0, sprite:'silenced',                 effect:{ key:'paralyzed', dur:5 }, save:{ ab:'wis', dc:15 } },
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

      /* tick timed effects on monsters */
      _tickEffects(m, this.elapsed);
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

      const tgt = this.pickMonsterTarget(m, alive);
      if (!tgt) continue;

      this.runMonsterBehavior(m, tgt, dt);
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
   * Activate a sleeping monster if its room is known and a hero is in aggro range.
   * Returns true if the monster became (or already was) active.
   */
  tryActivateMonster(m, alive) {
    if (m.active) return true;
    const known = this.visitedRooms[m.roomId] || this.revealed[this.cellOf(m.x, m.z)];
    if (!known) return false;

    for (const h of alive) {
      if (Math.hypot(h.x - m.x, h.z - m.z) < AGGRO_RANGE) {
        m.active = true;
        m.ent.grp.visible = true;
        this.activateRoomMonsters(m.roomId);
        return true;
      }
    }
    return false;
  },

  /**
   * Threat-aware target selection. Each candidate hero is scored:
   *   threat dealt + proximity pull + slow jitter, with a hysteresis
   *   margin favouring the current target (anti-twitch). Pack monsters
   *   also get a bonus toward a pack-mate's current target (focus fire).
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

    let tgt = null, best = -Infinity;
    for (const h of alive) {
      const hi = this.heroes.indexOf(h);
      const d = Math.hypot(h.x - m.x, h.z - m.z);
      /* ignore heroes way out of aggro range unless we're already on them */
      if (d > AGGRO_RANGE + 3 && hi !== curIdx) continue;

      let score = (threat[hi] || 0) * THREAT_WEIGHT
                + (AGGRO_RANGE - d) * THREAT_DIST_WEIGHT
                + (h._aiJitter || 0);
      if (hi === packFocus) score += PACK_FOCUS_BONUS;
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
    return this.nearFloorCell(this.cellOf(fx, fz), 2);
  },

  /**
   * Default melee chase-and-swing, with ranged kite and boss caster hooks.
   */
  runMonsterBehavior(m, tgt, dt) {
    const dist = m._targetDist ?? Math.hypot(tgt.x - m.x, tgt.z - m.z);
    /* Initiative gate: off-turn monsters keep chasing/kiting but can't attack
       (their cooldown is held above 0 so no attack branch fires). */
    if (this.initiative && this.initiative.active && !this.isCurrentActor(m)) {
      if (m.cd < 0.05) m.cd = 0.05;
    } else {
      m.cd -= dt;
    }
    m._kiteT = (m._kiteT || 0) - dt;

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

    /* Boss caster: on a ready action (m.cd elapsed), every Nth turn it casts
       at the party instead of swinging. _spellCycle advances only on real
       attacks (see monsterMelee), and casting itself sets m.cd — so casts are
       paced to ~every 3rd swing rather than firing every frame. */
    if (m.isBoss && !m.data.ranged && m.cd <= 0 && dist < 8) {
      const spells = BOSS_SPELLS[m.data.id];
      if (spells && (m._spellCycle || 0) >= BOSS_SPELL_EVERY) {
        m._spellCycle = 0;
        this.monsterCastSpell(m, tgt, spells);
        return;
      }
    }

    if (dist > MONSTER_MELEE_RANGE) {
      this.monsterChase(m, tgt, dt);
    } else {
      this.monsterMelee(m, tgt, dt);
    }
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

    /* retreat vector: away from the threat */
    let dx = m.x - threat.x, dz = m.z - threat.z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    let goal = this.nearFloorCell(this.cellOf(m.x + dx * KITE_RETREAT_DIST, m.z + dz * KITE_RETREAT_DIST), 2);

    /* direct retreat blocked → try a perpendicular strafe to break the jam */
    if (goal < 0) {
      goal = this.nearFloorCell(this.cellOf(m.x + (-dz) * KITE_RETREAT_DIST, m.z + dx * KITE_RETREAT_DIST), 2);
    }
    /* cornered: give up on moving and just shoot */
    if (goal < 0) { this.monsterRanged(m, tgt, dt); return; }

    m.repathT -= dt;
    if (m.repathT <= 0 || !m.path || m.pathI >= m.path.length) {
      m.path = this.findPath(this.cellOf(m.x, m.z), goal);
      m.pathI = 0;
      m.repathT = MONSTER_REPATH_CD;
    }
    const mods = getEffectMods(m);
    let spd = m.data.speed * MONSTER_SPEED_MULT * mods.speedMul;
    if (m.slowUntil && this.elapsed < m.slowUntil) spd *= 0.5;
    this.stepAlong(m, spd, dt);
    m.walk = true;

    /* face the target so shots/anims look right while backing away */
    m.ent.grp.rotation.y = Math.atan2(tgt.x - m.x, tgt.z - m.z);

    /* fire on cadence if there's a clean shot at the target */
    if (m.cd <= 0
        && Math.hypot(tgt.x - m.x, tgt.z - m.z) <= m.data.rngRange
        && this.hasLOS(m.x, m.z, tgt.x, tgt.z)) {
      m.cd = MONSTER_ATTACK_CD;
      this.monsterRangedAttack(m, tgt);
    }
  },

  /** Ranged attack: face the target and fire a projectile on cooldown. */
  monsterRanged(m, tgt, dt) {
    m.walk = false;
    m.ent.grp.rotation.y = Math.atan2(tgt.x - m.x, tgt.z - m.z);
    if (m.cd <= 0) {
      m.cd = MONSTER_ATTACK_CD;
      this.monsterRangedAttack(m, tgt);
    }
  },

  /** Advantage/disadvantage sources for a monster attacking a hero. */
  monsterAttackAdv(m, h) {
    let adv = 0;
    if (getEffectMods(m).atkDisadvantage) adv -= 1;   // poisoned / blinded / frightened…
    if (getEffectMods(h).defAdvantage) adv += 1;      // hero blinded / restrained…
    /* Reckless Attack: attacks against a reckless raging barbarian have advantage */
    if (hasEffect(h, 'raging') && hasFeature(h.data, 'recklessAttack')) adv += 1;
    return adv;
  },

  /** Fire a ranged projectile at a hero. */
  monsterRangedAttack(m, h) {
    const adv = this.monsterAttackAdv(m, h);
    const d20 = d20Roll(adv);
    const total = d20 + m.data.atk;
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
      log(`${m.data.name} shoots ${h.data.name} for ${dealt}${crit ? ' (crit!)' : ''}`, crit ? 'down' : 'roll');
      updatePartyFrames(this.heroes.map(x => x.data));
      if (h.data.hp <= 0) {
        h.data.hp = 0; h.data.downs++;
        log(`💀 ${h.data.name} goes down!`, 'down');
      }
    });
  },

  /** Apply boss-inflicted damage to a hero: HP, bar, floater, downs, perks. */
  hurtHero(h, dmg, src, colorHex = 0xff5040) {
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
    }
    return dealt;
  },

  /** Boss casts a random spell from its pool AT THE PARTY (see BOSS_SPELL_FX). */
  monsterCastSpell(m, tgt, spellPool) {
    m.walk = false;
    m.ent.grp.rotation.y = Math.atan2(tgt.x - m.x, tgt.z - m.z);
    m.cd = MONSTER_ATTACK_CD * 1.5;   // throttle the next boss action

    const spellKey = spellPool[Math.floor(Math.random() * spellPool.length)];
    const fx = BOSS_SPELL_FX[spellKey];
    const label = (fx && fx.label) || (SPELLS[spellKey] && SPELLS[spellKey].label) || 'a dark spell';

    log(`✨ ${m.data.name} casts ${label}!`, 'crit');
    if (this.engine) this.engine.triggerShake(0.9, 0.4);
    this.triggerLunge(m, tgt);
    makeFloatText(this.engine.scene, label, _v.set(m.x, 1.5, m.z), '#e8c25a');
    if (!fx) return;   // unknown spell → flourish only, no effect

    const sprite = fx.sprite ? `dcss/effect/${fx.sprite}.png` : null;

    /* Support spell: heal the boss and any wounded minions nearby. */
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

    for (const h of targets) {
      const saved = fx.save ? rollSave(h, fx.save.ab, fx.save.dc, { magic: true }) : false;
      if (sprite) spawnSpriteEffect(this.engine.scene, sprite, new THREE.Vector3(h.x, 0.5, h.z), fx.aoe ? 1.6 : 1.2, 0.4);
      if (fx.dice) {
        let dmg = roll(fx.dice[0], fx.dice[1], fx.dice[2]);
        if (saved) dmg = fx.save && fx.save.half ? Math.floor(dmg / 2) : 0;
        if (dmg > 0) {
          log(`${m.data.name}'s ${label} hits ${h.data.name} for ${dmg}${saved ? ' (saved)' : ''}`, 'down');
          this.hurtHero(h, dmg, m, fx.color || 0xff5040);
        } else {
          makeFloatText(this.engine.scene, 'resist', _v.set(h.x, 1.1, h.z), '#9aa');
        }
      }
      if (fx.effect) {
        if (saved) {
          if (!fx.dice) makeFloatText(this.engine.scene, 'resist', _v.set(h.x, 1.1, h.z), '#9aa');
        } else {
          applyEffect(h, fx.effect.key, { duration: fx.effect.dur, elapsed: this.elapsed, source: m });
          makeFloatText(this.engine.scene, fx.effect.key, _v.set(h.x, 1.35, h.z), '#d0a0ff');
        }
      }
    }
    updatePartyFrames(this.heroes.map(x => x.data));
  },

  monsterChase(m, tgt, dt) {
    if (hasEffect(m, 'charmed')) {
      m.walk = false;
      return;
    }
    /* incapacitated monsters cannot act */
    const mods = getEffectMods(m);
    if (mods.incapacitated) { m.walk = false; return; }

    m.repathT -= dt;
    if (m.repathT <= 0 || !m.path || m.pathI >= m.path.length) {
      let goal = this.cellOf(tgt.x, tgt.z);
      /* flank: aim for the far side of the target if allies are already
         clustered on it, so melee wraps around instead of stacking */
      const flank = this.flankGoal(m, tgt);
      if (flank >= 0) goal = flank;
      m.path = this.findPath(this.cellOf(m.x, m.z), goal);
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
    this.stepAlong(m, spd, dt);
    m.walk = true;
  },

  monsterMelee(m, tgt, dt) {
    m.walk = false;
    m.ent.grp.rotation.y = Math.atan2(tgt.x - m.x, tgt.z - m.z);
    if (m.cd <= 0) {
      m.cd = MONSTER_ATTACK_CD;
      /* Count this swing toward the boss's cast cadence (see runMonsterBehavior). */
      if (m.isBoss && BOSS_SPELLS[m.data.id]) m._spellCycle = (m._spellCycle || 0) + 1;
      this.monsterAttack(m, tgt);
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
    const total = d20 + m.data.atk;
    let crit = d20 === 20;
    /* defender auto-crit on melee (paralyzed/unconscious) */
    if (getEffectMods(h).autoCritMelee) crit = true;
    if (crit && this.engine) this.engine.triggerHitStop(2);
    const ac = this.heroAC(h);
    playSfx('swordAttack', { volume: 0.5 });
    if (!crit && total < ac) {
      makeFloatText(this.engine.scene, 'miss', _v.set(h.x, 1.1, h.z), '#9aa');
      playSfx(Math.random() < 0.5 ? 'swordBlock' : 'swordParry', { volume: 0.5 });
      log(`${m.data.name} → ${h.data.name}: ${total} (vs AC ${ac}${adv > 0 ? ', adv' : adv < 0 ? ', dis' : ''}) miss`, 'miss');
      return;
    }

    let dice = m.data.dmg[0]; if (crit) dice *= 2;
    let dmg = roll(dice, m.data.dmg[1], m.data.dmg[2] || 0);
    dmg = Math.round(dmg * dmgDealtMul);
    if (dmg >= 15 && this.engine) this.engine.triggerShake(0.4, 0.2);
    if (m.cutWordsUntil && this.elapsed < m.cutWordsUntil) dmg = Math.max(1, dmg - 2);

    log(`${m.data.name} hits ${h.data.name} for ${dmg}${crit ? ' (crit!)' : ''}`, crit ? 'down' : 'roll');
    playSfx('swordHit', { volume: 0.6 });
    spawnSlash(this.engine.scene, { x: h.x, z: h.z }, crit ? 0xff5040 : 0xff9a7a, 0.9);
    spawnSpriteEffect(this.engine.scene, crit ? 'dcss/effect/flame_0.png' : 'dcss/effect/blood_0.png', new THREE.Vector3(h.x, 0.5, h.z), 1.0, 0.3);
    const dealt = this.applyIncomingDamage ? this.applyIncomingDamage(h, dmg) : (h.data.hp -= dmg, dmg);
    hitFlash(h.ent);
    makeFloatText(this.engine.scene, String(dealt), _v.set(h.x, 1.2, h.z), crit ? '#ff5040' : '#ff9a7a');
    drawBar(h.ent.bar, Math.max(0, h.data.hp / h.data.maxHp));
    /* legendary defensive perks (thorns / riposte) */
    if (dealt > 0 && this.applyOnDamagedPerks) this.applyOnDamagedPerks(h, m, dealt);
    updatePartyFrames(this.heroes.map(x => x.data));
    if (h.data.hp <= 0) {
      h.data.hp = 0; h.data.downs++;
      if (this.engine) this.engine.triggerShake(0.7, 0.35);
      log(`💀 ${h.data.name} goes down!`, 'down');
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

      if (m.lungeT > 0) {
        const rdx = m.lungeDX * cosC - m.lungeDZ * sinC;
        const rdz = m.lungeDX * sinC + m.lungeDZ * cosC;
        m.ent.anim.setDirection(rdx, rdz);
        m.ent.anim.mesh.position.y = 0;
      } else if (m.walk) {
        const angle = m.ent.grp.rotation.y;
        const mdx = Math.sin(angle), mdz = Math.cos(angle);
        const rdx = mdx * cosC - mdz * sinC;
        const rdz = mdx * sinC + mdz * cosC;
        m.ent.anim.setDirection(rdx, rdz);
        m.ent.anim.mesh.position.y = Math.abs(Math.sin(elapsed * 9)) * 0.08;
      } else {
        m.ent.anim.time = 0;
        m.ent.anim.mesh.position.y = 0;
      }
      m.ent.anim.update(dt);
    }
  }
};
