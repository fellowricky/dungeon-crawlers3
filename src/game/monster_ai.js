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
import { roll, d as die } from './srd.js';
import {
  drawBar, makeFloatText, hitFlash, updateFlash,
  spawnSlash, spawnSpriteEffect
} from './entities.js';
import { log, updatePartyFrames } from './ui.js';
import { AGGRO_RANGE, MONSTER_ATTACK_CD } from './constants.js';
import { _v } from './shared.js';

/** Distance at which a monster stops chasing and starts swinging. */
export const MONSTER_MELEE_RANGE = 1.35;

/** Seconds between chase repaths while pursuing a hero. */
export const MONSTER_REPATH_CD = 0.7;

export const monsterAiMethods = {
  /**
   * Per-frame monster brain. Activates idle monsters near the party,
   * then chase / attack for each active living monster.
   */
  updateMonsters(alive, dt) {
    for (const m of this.monsters) {
      if (m.data.hp <= 0) continue;
      updateFlash(m.ent, dt);

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
        return true;
      }
    }
    return false;
  },

  /** Nearest living hero; override later for threat tables / focus fire. */
  pickMonsterTarget(m, alive) {
    let tgt = null, best = 1e9;
    for (const h of alive) {
      const d2 = Math.hypot(h.x - m.x, h.z - m.z);
      if (d2 < best) { best = d2; tgt = h; }
    }
    if (tgt) m._targetDist = best;
    return tgt;
  },

  /**
   * Default melee chase-and-swing. Hook for future archetypes
   * (ranged kite, caster, pack flanker, boss phases).
   */
  runMonsterBehavior(m, tgt, dt) {
    const dist = m._targetDist ?? Math.hypot(tgt.x - m.x, tgt.z - m.z);
    m.cd -= dt;

    if (dist > MONSTER_MELEE_RANGE) {
      this.monsterChase(m, tgt, dt);
    } else {
      this.monsterMelee(m, tgt, dt);
    }
  },

  monsterChase(m, tgt, dt) {
    if (m.charmedUntil && this.elapsed < m.charmedUntil) {
      m.walk = false;
      return;
    }
    m.repathT -= dt;
    if (m.repathT <= 0 || !m.path || m.pathI >= m.path.length) {
      m.path = this.findPath(this.cellOf(m.x, m.z), this.cellOf(tgt.x, tgt.z));
      m.pathI = 0;
      m.repathT = MONSTER_REPATH_CD;
    }
    let spd = m.data.speed;
    if (m.slowUntil && this.elapsed < m.slowUntil) spd *= 0.5;
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
      this.monsterAttack(m, tgt);
    }
  },

  /** One monster → hero attack roll + damage. */
  monsterAttack(m, h) {
    this.triggerLunge(m, h);
    const d20 = die(20);
    const total = d20 + m.data.atk;
    const crit = d20 === 20;
    const ac = this.heroAC(h);
    if (!crit && total < ac) {
      makeFloatText(this.engine.scene, 'miss', _v.set(h.x, 1.1, h.z), '#9aa');
      log(`${m.data.name} → ${h.data.name}: ${total} (vs AC ${ac}) miss`, 'miss');
      return;
    }
    /* charmed monsters skip attacks */
    if (m.charmedUntil && this.elapsed < m.charmedUntil) {
      makeFloatText(this.engine.scene, 'charmed', _v.set(m.x, 1.1, m.z), '#e8a8ff');
      return;
    }

    let dice = m.data.dmg[0]; if (crit) dice *= 2;
    let dmg = roll(dice, m.data.dmg[1], m.data.dmg[2] || 0);
    /* Cutting Words AC penalty already applied via heroAC? — reduce damage slightly if debuffed */
    if (m.cutWordsUntil && this.elapsed < m.cutWordsUntil) dmg = Math.max(1, dmg - 2);

    log(`${m.data.name} hits ${h.data.name} for ${dmg}${crit ? ' (crit!)' : ''}`, crit ? 'down' : 'roll');
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
        m.ent.anim.mesh.position.y = Math.abs(Math.sin(elapsed * 15)) * 0.15;
      } else {
        m.ent.anim.time = 0;
        m.ent.anim.mesh.position.y = 0;
      }
      m.ent.anim.update(dt);
    }
  }
};
