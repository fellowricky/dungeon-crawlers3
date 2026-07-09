/**
 * Hero combat resolution: attacks, subclass actives, damage, kills, loot drops.
 * Monster chase/AI lives in monster_ai.js; this module owns hero-side fighting
 * and shared combat outcomes (damageMonster / killMonster).
 *
 * Mixed onto Game — uses pathfinding (findPath, hasLOS, stepAlong, nudgeToward).
 */
import * as THREE from 'three';
import {
  grantXp, heroAttackBonus, heroDamage, subclassOf,
  CLASSES, RACES, roll, d as die, mod, pendingPoints
} from './srd.js';
import {
  drawBar, makeFloatText, hitFlash,
  spawnProjectile, spawnSlash, spawnSpriteEffect
} from './entities.js';
import { rollItem, equippedPerks } from './items.js';
import { log, updatePartyFrames, updateResources, showBanner } from './ui.js';
import { refreshMenus } from './menus.js';
import {
  HERO_SPEED, HERO_ATTACK_CD, COMBAT_SPEED, XP_SHARE,
  STUCK_SIDESTEP_T, STUCK_TELEPORT_T, STUCK_SIDESTEP_DIST
} from './constants.js';
import { _v } from './shared.js';
import { hasFeature, hasFeat, SPELLS } from './features.js';

/** Sprite paths + tint colors for ability / spell feedback. */
const ABILITY_FX = {
  secondWind:      { sprite: 'dcss/effect/goldaura_0.png', color: 0x6ae06a, label: '2nd WIND', float: '#6ae06a' },
  actionSurge:     { sprite: 'dcss/effect/heataura_0.png', color: 0xffd34a, label: 'SURGE', float: '#ffd34a' },
  flurry:          { sprite: 'dcss/effect/gold_sparkles_1.png', color: 0xe8d8a8, label: 'FLURRY', float: '#e8d8a8' },
  frenzy:          { sprite: 'dcss/effect/flame_0.png', color: 0xff6030, label: 'FRENZY', float: '#ff6030' },
  cunningAction:   { sprite: 'dcss/effect/sanctuary.png', color: 0x8fd4e8, label: 'DASH', float: '#8fd4e8' },
  rage:            { sprite: 'dcss/effect/flame_0.png', color: 0xff4020, label: 'RAGE', float: '#ff6040' },
  bearTotem:       { sprite: 'dcss/effect/heataura_0.png', color: 0xc08040, label: 'BEAR', float: '#c08040' },
  bardic:          { sprite: 'dcss/effect/gold_sparkles_2.png', color: 0xe8a8ff, label: 'INSPIRE', float: '#e8a8ff' },
  wildShape:       { sprite: 'dcss/effect/cloud_forest_fire.png', color: 0x6aaa4a, label: 'WILD SHAPE', float: '#6aaa4a' },
  combatSong:      { sprite: 'dcss/effect/gold_sparkles_1.png', color: 0xffd080, label: 'BATTLE SONG', float: '#ffd080' },
  divineSmite:     { sprite: 'dcss/effect/goldaura_1.png', color: 0xffe08a, label: 'SMITE', float: '#ffe08a' },
  tidesOfChaos:    { sprite: 'dcss/effect/cloud_chaos_2.png', color: 0xb06cf0, label: 'CHAOS', float: '#b06cf0' },
  indomitable:     { sprite: 'dcss/effect/sanctuary.png', color: 0xa0c0ff, label: 'INDOMITABLE', float: '#a0c0ff' },
  lucky:           { sprite: 'dcss/effect/gold_sparkles_3.png', color: 0x6aea6a, label: 'LUCKY', float: '#6aea6a' },
  layOnHands:      { sprite: 'dcss/effect/goldaura_0.png', color: 0xffe08a, label: null, float: '#6ae06a' },
  cureWounds:      { sprite: 'dcss/effect/sanctuary.png', color: 0x6ae06a, label: null, float: '#6ae06a' },
  deathstrike:     { sprite: 'dcss/effect/cloud_neg_1.png', color: 0xc04040, label: 'DEATHSTRIKE', float: '#e07070' },
  guidedStrike:    { sprite: 'dcss/effect/gold_sparkles_2.png', color: 0xffe08a, label: 'GUIDED', float: '#ffe08a' },
  vowOfEnmity:     { sprite: 'dcss/effect/heataura_1.png', color: 0xe8a83f, label: 'VOW', float: '#e8a83f' },
  shadowStep:      { sprite: 'dcss/effect/cloud_gloom.png', color: 0x6a5080, label: 'SHADOW STEP', float: '#a080c0' },
  sacredWeapon:    { sprite: 'dcss/effect/goldaura_2.png', color: 0xffe08a, label: 'SACRED', float: '#ffe08a' },
  colossusSlayer:  { sprite: 'dcss/effect/searing_ray_2.png', color: 0xe8a83f, label: 'PREY', float: '#e8a83f' },
  companionStrike: { sprite: 'dcss/effect/cloud_magic_trail_1.png', color: 0xa0c080, label: 'COMPANION', float: '#a0c080' },
  quiveringPalm:   { sprite: 'dcss/effect/quad_glow.png', color: 0xffd080, label: 'QUIVERING', float: '#ffd080' },
  rallyingCry:     { sprite: 'dcss/effect/goldaura_0.png', color: 0xe8a83f, label: 'RALLY', float: '#e8a83f' },
  preserveLife:    { sprite: 'dcss/effect/sanctuary.png', color: 0xbfe0ff, label: 'PRESERVE', float: '#bfe0ff' },
  dragonBreath:    { sprite: 'dcss/effect/cloud_fire_2.png', color: 0xff6020, label: 'BREATH', float: '#ff6020' },
  wildSurge:       { sprite: 'dcss/effect/cloud_chaos_3.png', color: 0xff8844, label: 'WILD MAGIC', float: '#ff8844' },
  cuttingWords:    { sprite: 'dcss/effect/xom_sparkles_blue.png', color: 0xd0a0ff, label: 'CUTTING WORDS', float: '#d0a0ff' },
  fiendishBlessing:{ sprite: 'dcss/effect/cloud_neg_0.png', color: 0x9b59b6, label: 'FIENDISH', float: '#9b59b6' },
  feyPresence:     { sprite: 'dcss/effect/cloud_spectral_1.png', color: 0xe8a8ff, label: 'FEY', float: '#e8a8ff' },
  /* spells */
  magicMissile:    { sprite: 'dcss/effect/magic_bolt_2.png', color: 0xb08cff, label: 'MISSILE', float: '#b08cff' },
  shield:          { sprite: 'dcss/effect/sanctuary.png', color: 0x88aaff, label: 'SHIELD', float: '#88aaff' },
  scorchingRay:    { sprite: 'dcss/effect/searing_ray_3.png', color: 0xff7a30, label: 'SCORCH', float: '#ff7a30' },
  fireball:        { sprite: 'dcss/effect/cloud_fire_2.png', color: 0xff7a30, label: 'FIREBALL', float: '#ff7a30' },
  haste:           { sprite: 'dcss/effect/xom_sparkles_blue.png', color: 0xa0e0ff, label: 'HASTE', float: '#a0e0ff' },
  bless:           { sprite: 'dcss/effect/gold_sparkles_2.png', color: 0xffe08a, label: 'BLESS', float: '#ffe08a' },
  healingWord:     { sprite: 'dcss/effect/goldaura_0.png', color: 0xe8a8ff, label: null, float: '#6ae06a' },
  spiritualWeapon: { sprite: 'dcss/effect/orb_glow_0.png', color: 0xbfe0ff, label: 'SPIRIT WEAPON', float: '#bfe0ff' },
  spiritGuardians: { sprite: 'dcss/effect/cloud_spectral_2.png', color: 0xd0c0ff, label: 'GUARDIANS', float: '#d0c0ff' },
  entangle:        { sprite: 'dcss/effect/cloud_magic_trail_2.png', color: 0x4cae4c, label: 'ENTANGLE', float: '#4cae4c' },
  moonbeam:        { sprite: 'dcss/effect/orb_glow_1.png', color: 0xc0e8ff, label: 'MOONBEAM', float: '#c0e8ff' },
  callLightning:   { sprite: 'dcss/effect/cloud_storm_2.png', color: 0x7090ff, label: 'LIGHTNING', float: '#7090ff' },
  shatter:         { sprite: 'dcss/effect/cloud_storm_1.png', color: 0xd0a0ff, label: 'SHATTER', float: '#d0a0ff' },
  chaosBolt:       { sprite: 'dcss/effect/cloud_chaos_4.png', color: 0xff8844, label: 'CHAOS BOLT', float: '#ff8844' },
  dragonBreathSpell:{ sprite: 'dcss/effect/cloud_fire_1.png', color: 0xff6020, label: 'BURNING HANDS', float: '#ff6020' },
  hex:             { sprite: 'dcss/effect/cloud_neg_2.png', color: 0x9b59b6, label: 'HEX', float: '#9b59b6' },
  armsOfHadar:     { sprite: 'dcss/effect/cloud_gloom_new.png', color: 0x6a3080, label: 'HADAR', float: '#6a3080' },
  thunderousSmite: { sprite: 'dcss/effect/cloud_storm_1.png', color: 0xf1c40f, label: 'THUNDEROUS', float: '#f1c40f' },
  huntersMark:     { sprite: 'dcss/effect/searing_ray_1.png', color: 0x1abc9c, label: "HUNTER'S MARK", float: '#1abc9c' }
};

export const combatMethods = {
  /** Refresh ability icons on party frames after a cast/spend. */
  refreshAbilityHud() {
    updatePartyFrames(this.heroes.map(x => x.data));
  },

  /**
   * Play cast animation + world VFX for a class feature / spell.
   * @param {object} h hero entity
   * @param {string} key ABILITY_FX key
   * @param {object} [opts] { at: entity|{x,z}, alsoAt: entity[], noAnim, scale, dur, floatY }
   */
  playAbilityFx(h, key, opts = {}) {
    const fx = ABILITY_FX[key] || { sprite: 'dcss/effect/magic_bolt_1.png', color: 0xc0a060, label: null, float: '#e8c25a' };
    const at = opts.at || h;
    const x = at.x, z = at.z;
    const y = opts.floatY != null ? opts.floatY : 1.35;
    const scale = opts.scale || 1.5;
    const dur = opts.dur || 0.45;

    if (fx.sprite) {
      spawnSpriteEffect(this.engine.scene, fx.sprite, new THREE.Vector3(x, 0.55, z), scale, dur);
    }
    if (fx.color != null) {
      spawnSlash(this.engine.scene, { x, z }, fx.color, opts.ring || 1.2);
    }
    if (fx.label) {
      makeFloatText(this.engine.scene, fx.label, _v.set(x, y, z), fx.float || '#e8c25a');
    }
    if (opts.alsoAt) {
      for (const t of opts.alsoAt) {
        if (!t || t === at) continue;
        if (fx.sprite) {
          spawnSpriteEffect(this.engine.scene, fx.sprite, new THREE.Vector3(t.x, 0.45, t.z), scale * 0.85, dur * 0.9);
        }
        spawnSlash(this.engine.scene, { x: t.x, z: t.z }, fx.color || 0xc0a060, 0.9);
      }
    }

    /* Hero cast / strike animation (drives spellcast / slash sprites in the update loop) */
    if (!opts.noAnim && h?.ent) {
      h.castAnim = !!opts.spell;
      if (opts.at && opts.at !== h && opts.at.x != null) this.triggerLunge(h, opts.at);
      else {
        h.lungeDX = 0; h.lungeDZ = 1; h.lungeT = 0.28;
      }
    }
  },

  /* ── Combat pacing helpers ────────────────────────────────────── */

  /** Seconds since the current combat encounter began. */
  _combatSec() {
    return this._combatEngagedAt != null ? this.elapsed - this._combatEngagedAt : 999;
  },

  /** True when combat has lasted at least minSec — prevents instant cooldown dumps. */
  _combatStable(minSec = 2.0) {
    return this._combatSec() >= minSec;
  },

  /**
   * Threat assessment: is this foe worth spending limited resources on?
   * @param {'normal'|'high'|'low'} threshold  high = boss/elite only; low = almost always
   */
  _worthSpending(h, foe, alive, threshold = 'normal') {
    if (foe.isBoss) return true;
    if (this.monsterEliteRoom(foe)) return true;
    if (threshold === 'high') return false;
    // Trash with decent HP — still worth a spell or two
    if (foe.data.hp >= 12) return true;
    // Party is struggling — use whatever we have
    if (alive && alive.length) {
      const partyFrac = alive.reduce((s, a) => s + a.data.hp / a.data.maxHp, 0) / alive.length;
      if (partyFrac < 0.55) return true;
    }
    // Don't waste on nearly-dead trash
    if (foe.data.hp / Math.max(foe.data.maxHp, 1) < 0.35) return false;
    return threshold !== 'high';
  },

  pickHeroTarget(h, alive) {
    let tgt = null, best = 1e9;
    for (const m of this.monsters) {
      if (m.data.hp <= 0 || !m.active) continue;
      const dd = Math.hypot(m.x - h.x, m.z - h.z);
      if (dd < best && dd < 13) { best = dd; tgt = m; }
    }
    return tgt;
  },

  heroCombat(h, foe, alive, dt) {
    const cls = CLASSES[h.data.classKey];
    const atk = cls.attack;
    const dist = Math.hypot(foe.x - h.x, foe.z - h.z);
    h.cd -= dt;

    // Track combat engagement for pacing / staggering
    if (!this._combatEngagedAt) this._combatEngagedAt = this.elapsed;
    h._abilityUsedThisCycle = false;

    this.runCombatReflexes(h, alive, foe);

    const inRange = dist <= atk.range && (atk.melee || this.hasLOS(h.x, h.z, foe.x, foe.z));
    if (!inRange) {
      h.combatFoe = null;
      h.repathT -= dt;
      if (h.repathT <= 0 || !h.path || h.pathI >= h.path.length) {
        h.path = this.findPath(this.cellOf(h.x, h.z), this.cellOf(foe.x, foe.z));
        h.pathI = 0; h.repathT = 0.5;
      }
      h.moving = this.stepAlong(h, HERO_SPEED * h.data.speedMult * this.hasteMult(h), dt);

      /* multi-stage stuck recovery during combat */
      if (!h.moving && h !== alive[0]) {
        h.stuckT = (h.stuckT || 0) + dt;
        h.stuckStage = h.stuckStage || 0;

        /* Stage 1: lateral dodge perpendicular to foe */
        if (h.stuckStage === 0 && h.stuckT > STUCK_SIDESTEP_T) {
          h.stuckStage = 1;
          const perpX = -(foe.z - h.z), perpZ = (foe.x - h.x);
          const d = Math.hypot(perpX, perpZ) || 1;
          const sx = h.x + (perpX / d) * STUCK_SIDESTEP_DIST;
          const sz = h.z + (perpZ / d) * STUCK_SIDESTEP_DIST;
          if (!this.blocked(sx, sz, 0.3)) {
            h.x = sx; h.z = sz; h.path = null;
            h.stuckT = 0; h.stuckStage = 0;
          } else {
            const sx2 = h.x - (perpX / d) * STUCK_SIDESTEP_DIST;
            const sz2 = h.z - (perpZ / d) * STUCK_SIDESTEP_DIST;
            if (!this.blocked(sx2, sz2, 0.3)) {
              h.x = sx2; h.z = sz2; h.path = null;
              h.stuckT = 0; h.stuckStage = 0;
            }
          }
        }

        /* Stage 2: force repath */
        if (h.stuckStage === 1 && h.stuckT > 1.2) {
          h.stuckStage = 2;
          h.path = null;
        }

        /* Stage 3: teleport (last resort) */
        if (h.stuckStage >= 2 && h.stuckT > STUCK_TELEPORT_T) {
          h.stuckT = 0; h.stuckStage = 0;
          const leader = alive[0];
          h.x = leader.x + (Math.random() - 0.5) * 0.5;
          h.z = leader.z + (Math.random() - 0.5) * 0.5;
          h.path = null;
          log(`✨ Teleported ${h.data.name} to join combat.`, 'sys');
        }
      } else {
        h.stuckT = 0; h.stuckStage = 0;
      }
      return;
    } else {
      h.stuckT = 0; h.stuckStage = 0;
    }

    this.combatMove(h, foe, atk, dt);
    h.ent.grp.rotation.y = Math.atan2(foe.x - h.x, foe.z - h.z);
    if (h.cd > 0) return;

    /* healers: heal a badly-hurt ally instead of attacking */
    if (cls.healer && h.data.healSlots > 0) {
      let worst = null, wf = 0.55;
      for (const a of alive) { const f = a.data.hp / a.data.maxHp; if (f < wf) { wf = f; worst = a; } }
      if (worst) {
        h.cd = HERO_ATTACK_CD;
        h.data.healSlots--;
        const ab = cls.attack.ability === 'cha' ? 'cha' : 'wis';
        const amt = roll(1, 8, mod(h.data.effStats[ab]) + h.data.healBonus);
        worst.data.hp = Math.min(worst.data.maxHp, worst.data.hp + amt);
        this.playAbilityFx(h, 'cureWounds', { at: worst, spell: true });
        makeFloatText(this.engine.scene, '+' + amt, _v.set(worst.x, 1.55, worst.z), '#6ae06a');
        log(`${h.data.name} casts Cure Wounds on ${worst.data.name} (+${amt}).`, 'heal');
        drawBar(worst.ent.bar, worst.data.hp / worst.data.maxHp);
        this.refreshAbilityHud();
        return;
      }
    }

    /* Lay on Hands (paladin) */
    if (hasFeature(h.data, 'layOnHands') && (h.data.layOnHands || 0) > 0) {
      let worst = null, wf = 0.45;
      for (const a of alive) { const f = a.data.hp / a.data.maxHp; if (f < wf) { wf = f; worst = a; } }
      if (worst) {
        const spend = Math.min(h.data.layOnHands, 10 + h.data.level);
        h.data.layOnHands -= spend;
        h.cd = HERO_ATTACK_CD;
        this.healHero(worst, spend + h.data.healBonus);
        this.playAbilityFx(h, 'layOnHands', { at: worst, spell: true });
        log(`🙏 ${h.data.name} uses Lay on Hands on ${worst.data.name} (+${spend}).`, 'heal');
        this.refreshAbilityHud();
        return;
      }
    }

    h.cd = HERO_ATTACK_CD;

    /* known spells (learned via progression) */
    if (this.tryCastKnownSpell(h, foe, alive)) return;

    const sc = subclassOf(h.data);
    if (sc && this.castSubclassSpell(h, sc, foe, alive)) return;

    const opts = this.buildAttackOpts(h, foe, sc);
    this.heroAttackRoll(h, foe, alive, opts);

    /* Extra Attack / Improved Extra Attack */
    let attacks = 1;
    if (hasFeature(h.data, 'extraAttack2')) attacks = 3;
    else if (hasFeature(h.data, 'extraAttack')) attacks = 2;
    for (let i = 1; i < attacks && foe.data.hp > 0; i++) {
      this.heroAttackRoll(h, foe, alive, {});
    }

    /* Action Surge (class feature or Champion subclass) — only when it matters */
    const surgeWorthy = foe.data.hp / Math.max(foe.data.maxHp, 1) > 0.30 || foe.isBoss || this.monsterEliteRoom(foe);
    const canSurge = (hasFeature(h.data, 'actionSurgeClass') || (sc && sc.active.key === 'actionSurge'))
      && !h.data.abilityUsed.short && foe.data.hp > 0 && surgeWorthy && !h._abilityUsedThisCycle;
    if (canSurge) {
      h.data.abilityUsed.short = true; h._abilityUsedThisCycle = true;
      this.playAbilityFx(h, 'actionSurge', { at: h });
      log(`⚔ ${h.data.name} surges with action — attacking again!`, 'crit');
      this.heroAttackRoll(h, foe, alive, {});
      this.refreshAbilityHud();
    }

    /* Flurry of Blows — only when foe is worth the effort */
    else if (hasFeature(h.data, 'flurryOfBlows') && !h.data.abilityUsed.short && foe.data.hp > 0
        && h.data.hp < h.data.maxHp * 0.7 && surgeWorthy && !h._abilityUsedThisCycle) {
      h.data.abilityUsed.short = true; h._abilityUsedThisCycle = true;
      this.playAbilityFx(h, 'flurry', { at: foe });
      log(`👊 ${h.data.name} uses Flurry of Blows!`, 'crit');
      this.heroAttackRoll(h, foe, alive, {});
      this.refreshAbilityHud();
    }

    /* Berserker frenzy — free extra attack, don't waste on near-dead foes */
    else if (sc && sc.active.key === 'frenzy' && !h.data.abilityUsed.short && foe.data.hp > 0
        && h.raging && foe.data.hp / Math.max(foe.data.maxHp, 1) > 0.35 && !h._abilityUsedThisCycle) {
      h.data.abilityUsed.short = true; h._abilityUsedThisCycle = true;
      this.playAbilityFx(h, 'frenzy', { at: foe });
      log(`😤 ${h.data.name} frenzies — another strike!`, 'crit');
      this.heroAttackRoll(h, foe, alive, {});
      this.refreshAbilityHud();
    }
  },

  /* defensive / buff reflexes that fire outside the attack cadence
   *   Now staggered: only ONE reflex fires per cycle, and most require
   *   a minimum combat duration so we don't dump everything on frame 1. */
  runCombatReflexes(h, alive, foe) {
    const d = h.data;
    let hudDirty = false;

    /* ── Rage expiry ── */
    if (h.raging && this.elapsed > (h.rageUntil || 0)) h.raging = false;

    const sc = subclassOf(d);

    /* ── Second Wind — immediate save if critically low ── */
    if ((d.secondWind || hasFeature(d, 'secondWind')) && !d.secondWindUsed && d.hp < d.maxHp * 0.3) {
      d.secondWindUsed = true; h._abilityUsedThisCycle = true;
      const amt = roll(1, 10, d.level);
      d.hp = Math.min(d.maxHp, d.hp + amt);
      this.playAbilityFx(h, 'secondWind', { at: h });
      makeFloatText(this.engine.scene, '+' + amt, _v.set(h.x, 1.55, h.z), '#6ae06a');
      drawBar(h.ent.bar, d.hp / d.maxHp);
      log(`${d.name} catches a second wind (+${amt}).`, 'heal');
      hudDirty = true;
    }

    /* ── Cunning Action — dodge when bloodied ── */
    else if (!h._abilityUsedThisCycle) {
      const cunning = hasFeature(d, 'cunningActionClass') || (sc && sc.active.key === 'cunningAction');
      if (cunning && !d.abilityUsed.short && d.hp < d.maxHp * 0.35) {
        d.abilityUsed.short = true; h._abilityUsedThisCycle = true;
        h.cunningUntil = this.elapsed + 6;
        this.playAbilityFx(h, 'cunningAction', { at: h });
        log(`💨 ${d.name} uses Cunning Action — darting clear! (+4 AC, +40% speed)`, 'heal');
        hudDirty = true;
      }
    }

    /* ── Rage — only after combat has been going a bit ── */
    else if (!h._abilityUsedThisCycle) {
      if (hasFeature(d, 'rage') && !h.raging && !d.rageUsed && d.hp < d.maxHp * 0.45
          && this._combatStable(1.2)) {
        d.rageUsed = true; h._abilityUsedThisCycle = true;
        h.raging = true;
        h.rageUntil = this.elapsed + 12;
        this.playAbilityFx(h, 'rage', { at: h, scale: 1.7 });
        log(`😡 ${d.name} enters a Rage!`, 'crit');
        hudDirty = true;
      }
    }

    /* ── Bear Totem — emergency DR for bear barbarians ── */
    else if (!h._abilityUsedThisCycle) {
      if (sc && sc.active.key === 'bearTotem' && !d.abilityUsed.short && d.hp < d.maxHp * 0.35) {
        d.abilityUsed.short = true; h._abilityUsedThisCycle = true;
        h.bearTotemUntil = this.elapsed + 8;
        this.playAbilityFx(h, 'bearTotem', { at: h, scale: 1.6 });
        log(`🐻 ${d.name} summons the Bear Totem — damage halved!`, 'heal');
        hudDirty = true;
      }
    }

    /* ── Bardic Inspiration — don't inspire in the first 2s, wait for real trouble ── */
    else if (!h._abilityUsedThisCycle) {
      if (hasFeature(d, 'bardicInspiration') && !d.abilityUsed.short && alive.length >= 2
          && this._combatStable(2.0)) {
        const anyHurt = alive.some(a => a.data.hp < a.data.maxHp * 0.6);
        if (anyHurt) {
          d.abilityUsed.short = true; h._abilityUsedThisCycle = true;
          for (const a of alive) a.inspiredUntil = this.elapsed + 8;
          this.playAbilityFx(h, 'bardic', { at: h, alsoAt: alive, spell: true });
          log(`🎵 ${d.name} inspires the party! (+2 to hit)`, 'heal');
          hudDirty = true;
        }
      }
    }

    /* ── Wild Shape — druid panic button ── */
    else if (!h._abilityUsedThisCycle) {
      if (hasFeature(d, 'wildShapeClass') && !d.abilityUsed.short && d.hp < d.maxHp * 0.4) {
        d.abilityUsed.short = true; h._abilityUsedThisCycle = true;
        h.wildShapeUntil = this.elapsed + 8;
        h.tempHp = (h.tempHp || 0) + 15 + d.level;
        this.playAbilityFx(h, 'wildShape', { at: h, scale: 1.8 });
        log(`🐻 ${d.name} Wild Shapes! (+temp HP, fierce claws)`, 'heal');
        hudDirty = true;
      }
    }

    /* ── Combat Inspiration (Valor bard) — requires combat to be underway ── */
    else if (!h._abilityUsedThisCycle) {
      if (sc && sc.active.key === 'combatInspiration' && !d.abilityUsed.short
          && this._combatStable(2.5) && alive.length >= 2) {
        const anyHurt = alive.some(a => a.data.hp < a.data.maxHp * 0.65);
        if (anyHurt) {
          d.abilityUsed.short = true; h._abilityUsedThisCycle = true;
          for (const a of alive) a.inspiredUntil = this.elapsed + 8;
          this.playAbilityFx(h, 'combatSong', { at: h, alsoAt: alive, spell: true });
          log(`🎶 ${d.name} plays a battle song! (+3 to hit)`, 'heal');
          hudDirty = true;
        }
      }
    }

    if (hudDirty) this.refreshAbilityHud();
  },

  buildAttackOpts(h, foe, sc) {
    const opts = {};
    const d = h.data;
    let hudDirty = false;
    const stable = this._combatStable(1.5);
    if (sc && !d.abilityUsed.short) {
      if (sc.active.key === 'deathstrike' && foe.data.hp >= foe.data.maxHp
          && this._worthSpending(h, foe, null, 'normal')) {
        d.abilityUsed.short = true; opts.autoCrit = true;
        this.playAbilityFx(h, 'deathstrike', { at: foe });
        log(`🗡 ${d.name} lines up a Deathstrike!`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'guidedStrike' && (foe.isBoss || this.monsterEliteRoom(foe))
          && this._worthSpending(h, foe, null, 'high')) {
        d.abilityUsed.short = true; opts.atkBonus = 10; opts.extraDmg = roll(2, 8);
        this.playAbilityFx(h, 'guidedStrike', { at: foe, spell: true });
        log(`⚡ ${d.name} calls a Guided Strike! (+10 to hit, +2d8)`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'vowOfEnmity' && (foe.isBoss || this.monsterEliteRoom(foe))
          && this._worthSpending(h, foe, null, 'high')) {
        d.abilityUsed.short = true; opts.atkBonus = 5;
        this.playAbilityFx(h, 'vowOfEnmity', { at: foe, spell: true });
        log(`⚔️ ${d.name} swears a Vow of Enmity!`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'shadowStep' && stable
          && this._worthSpending(h, foe, null, 'low')) {
        d.abilityUsed.short = true; opts.atkBonus = 4; opts.extraDmg = roll(2, 6);
        this.playAbilityFx(h, 'shadowStep', { at: foe });
        log(`🌑 ${d.name} Shadow Steps behind the foe!`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'sacredWeapon' && stable
          && this._worthSpending(h, foe, null, 'normal')) {
        d.abilityUsed.short = true;
        h.sacredUntil = this.elapsed + 8;
        this.playAbilityFx(h, 'sacredWeapon', { at: h, spell: true });
        log(`✨ ${d.name} blesses their weapon!`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'colossusSlayer' && foe.data.hp < foe.data.maxHp
          && this._worthSpending(h, foe, null, 'low')) {
        d.abilityUsed.short = true; opts.extraDmg = roll(1, 8);
        this.playAbilityFx(h, 'colossusSlayer', { at: foe });
        log(`🏹 ${d.name}'s Colossus Slayer finds the wound!`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'companionStrike' && stable
          && this._worthSpending(h, foe, null, 'normal')) {
        d.abilityUsed.short = true; opts.extraDmg = roll(1, 8, 3);
        this.playAbilityFx(h, 'companionStrike', { at: foe });
        log(`🐺 ${d.name}'s companion strikes!`, 'crit');
        hudDirty = true;
      } else if (sc.active.key === 'quiveringPalm' && (foe.isBoss || this.monsterEliteRoom(foe))
          && this._worthSpending(h, foe, null, 'high')) {
        d.abilityUsed.short = true; opts.extraDmg = roll(4, 10);
        this.playAbilityFx(h, 'quiveringPalm', { at: foe });
        log(`✋ ${d.name} delivers Quivering Palm!`, 'crit');
        hudDirty = true;
      }
    }
    if (hasFeature(d, 'divineSmite') && !d.smiteUsed
        && (foe.isBoss || this.monsterEliteRoom(foe))
        && this._worthSpending(h, foe, null, 'high')) {
      d.smiteUsed = true;
      opts.extraDmg = (opts.extraDmg || 0) + roll(2, 8);
      this.playAbilityFx(h, 'divineSmite', { at: foe, spell: true });
      log(`💫 ${d.name} Divine Smites!`, 'crit');
      hudDirty = true;
    }
    if (hasFeature(d, 'tidesOfChaos') && !d.tidesUsed && stable
        && this._worthSpending(h, foe, null, 'normal')) {
      d.tidesUsed = true;
      opts.atkBonus = (opts.atkBonus || 0) + 5;
      this.playAbilityFx(h, 'tidesOfChaos', { at: h, spell: true });
      log(`🌀 ${d.name} rides the Tides of Chaos!`, 'crit');
      hudDirty = true;
    }
    if (hudDirty) this.refreshAbilityHud();
    if (hasFeature(d, 'colossusSlayerClass') && foe.data.hp < foe.data.maxHp) {
      opts.extraDmg = (opts.extraDmg || 0) + roll(1, 8);
    }
    if (h.raging && hasFeature(d, 'recklessAttack')) opts.atkBonus = (opts.atkBonus || 0) + 2;
    if (h.raging) opts.extraDmg = (opts.extraDmg || 0) + 2;
    if (h.sacredUntil > this.elapsed) {
      opts.atkBonus = (opts.atkBonus || 0) + 4;
      opts.extraDmg = (opts.extraDmg || 0) + roll(1, 8);
    }
    if (h.inspiredUntil > this.elapsed) opts.atkBonus = (opts.atkBonus || 0) + 2;
    if (h.hexTarget === foe && h.hexUntil > this.elapsed) opts.extraDmg = (opts.extraDmg || 0) + roll(1, 6);
    if (h.markTarget === foe && h.markUntil > this.elapsed) opts.extraDmg = (opts.extraDmg || 0) + roll(1, 6);
    if (h.smiteNext) {
      opts.extraDmg = (opts.extraDmg || 0) + roll(2, 6);
      h.smiteNext = false;
    }
    if (hasFeat(d, 'mageSlayer') && (foe.isBoss || this.monsterEliteRoom(foe))) {
      opts.extraDmg = (opts.extraDmg || 0) + 2;
    }
    return opts;
  },

  /* one d20 attack roll + resolution (extracted so Action Surge can repeat it) */
  heroAttackRoll(h, foe, alive, opts = {}) {
    const cls = CLASSES[h.data.classKey];
    let d20 = die(20);
    if (d20 === 1 && RACES[h.data.raceKey].lucky) d20 = die(20);
    let atkBonus = heroAttackBonus(h.data) + (opts.atkBonus || 0);
    if (h.inspiredUntil > this.elapsed) atkBonus += 1; // stack gently with buildAttackOpts
    let crit = !!opts.autoCrit || d20 >= h.data.critRange;
    let total = d20 + atkBonus;
    let miss = !crit && total < foe.data.ac;

    /* Indomitable (long rest) / Lucky feat (short rest): convert a miss */
    if (miss && hasFeature(h.data, 'indomitable') && !h.data.abilityUsed?.long) {
      h.data.abilityUsed.long = true;
      miss = false;
      this.playAbilityFx(h, 'indomitable', { at: h });
      log(`🛡 ${h.data.name} is Indomitable — the miss becomes a hit!`, 'crit');
      this.refreshAbilityHud();
    } else if (miss && hasFeat(h.data, 'lucky') && !h.data.abilityUsed?.short) {
      h.data.abilityUsed.short = true;
      miss = false;
      this.playAbilityFx(h, 'lucky', { at: h });
      log(`🍀 ${h.data.name}'s Lucky feat turns a miss into a hit!`, 'crit');
      this.refreshAbilityHud();
    }

    let dmg = 0, sneak = false;
    if (!miss) {
      let wasCrit = crit;
      dmg = heroDamage(h.data, wasCrit) + (opts.extraDmg || 0);
      if (wasCrit && hasFeature(h.data, 'brutalCritical') && cls.attack.melee) {
        dmg += die(cls.attack.dmg[1] || 6);
      }
      if (h.wildShapeUntil > this.elapsed) dmg += roll(2, 6);
      if (cls.sneakDice || hasFeature(h.data, 'sneakAttack')) {
        const flanked = alive.some(a => a !== h && Math.hypot(a.x - foe.x, a.z - foe.z) < 1.7);
        if (flanked) {
          const dice = cls.sneakDice ? cls.sneakDice(h.data.level) : Math.ceil(h.data.level / 2);
          dmg += roll(dice, 6); sneak = true;
        }
      }
      /* Agonizing Blast: CHA to cantrip damage for warlocks */
      if (hasFeature(h.data, 'agonizingBlast') && cls.attack.cantripScale) {
        dmg += mod(h.data.effStats.cha);
      }
      /* Legendary perk pre-damage modifiers (execute, first strike, crit surge) */
      dmg = this.applyPerkDamageMods(h, foe, dmg, wasCrit);
    }
    const vs = `(${d20}+${atkBonus} vs AC ${foe.data.ac})`;
    if (crit && !miss) log(`💥 ${h.data.name} crits ${foe.data.name}! ${opts.autoCrit ? '(Deathstrike)' : `(nat ${d20})`} — ${dmg} dmg${sneak ? ' +sneak' : ''}`, 'crit');
    else if (miss) log(`${h.data.name} → ${foe.data.name}: ${total} ${vs} miss`, 'miss');
    else log(`${h.data.name} → ${foe.data.name}: ${total} ${vs} hit, ${dmg} dmg${sneak ? ' +sneak' : ''}`, 'roll');
    this.strike(h, foe, dmg, crit && !miss, miss, alive);
  },

  /** Pre-hit damage multipliers/adders from equipped legendary perks. */
  applyPerkDamageMods(h, foe, dmg, crit) {
    let d = dmg;
    const perks = equippedPerks(h.data);
    for (const { perk } of perks) {
      if (perk.id === 'execute' && foe.data.maxHp > 0 && foe.data.hp / foe.data.maxHp < 0.30) {
        d = Math.round(d * 1.35);
        makeFloatText(this.engine.scene, 'EXECUTE', _v.set(foe.x, 1.4, foe.z), '#e8a83f');
      }
      if (perk.id === 'firstStrike' && !h._foughtThisCombat) {
        d = Math.round(d * 1.50);
        makeFloatText(this.engine.scene, 'FIRST STRIKE', _v.set(foe.x, 1.5, foe.z), '#8fd4e8');
      }
      if (perk.id === 'critSurge' && crit) {
        d += 4;
      }
    }
    return Math.max(0, d);
  },

  /** On-hit legendary perk procs (lifesteal, cleave, burn, chain, mana font). */
  applyOnHitPerks(h, foe, dmg, crit, alive) {
    if (dmg <= 0 || foe.dead) return;
    h._foughtThisCombat = true;
    const perks = equippedPerks(h.data, 'onHit').concat(
      equippedPerks(h.data, 'onCrit').filter(p => crit)
    );
    const seen = new Set();
    for (const { perk, item } of perks) {
      if (seen.has(perk.id)) continue;
      seen.add(perk.id);
      const id = perk.id;

      if (id === 'lifesteal') {
        const heal = Math.max(1, Math.round(dmg * 0.18));
        h.data.hp = Math.min(h.data.maxHp, h.data.hp + heal);
        makeFloatText(this.engine.scene, `+${heal}`, _v.set(h.x, 1.35, h.z), '#e07070');
        drawBar(h.ent.bar, h.data.hp / h.data.maxHp);
      }

      if (id === 'cleave' && CLASSES[h.data.classKey].attack.melee) {
        const splash = Math.max(1, Math.round(dmg * 0.45));
        let best = null, bestD = 2.4;
        for (const m of this.monsters) {
          if (m === foe || m.dead || m.data.hp <= 0) continue;
          const dd = Math.hypot(m.x - foe.x, m.z - foe.z);
          if (dd < bestD) { bestD = dd; best = m; }
        }
        if (best) {
          this.damageMonster(best, splash, h, false, { skipPerks: true });
          makeFloatText(this.engine.scene, 'CLEAVE', _v.set(best.x, 1.3, best.z), '#e8a83f');
          spawnSlash(this.engine.scene, { x: best.x, z: best.z }, 0xe8a83f, best.data.scale * 0.8);
        }
      }

      if (id === 'burn') {
        const ticks = 3;
        const tickDmg = Math.max(1, 1 + Math.floor(h.data.level / 3));
        foe.burn = { ticks, dmg: tickDmg, src: h, t: 0 };
        makeFloatText(this.engine.scene, 'BURN', _v.set(foe.x, 1.2, foe.z), '#ff7a30');
        spawnSpriteEffect(this.engine.scene, 'dcss/effect/flame_0.png',
          new THREE.Vector3(foe.x, 0.5, foe.z), 0.9, 0.25);
      }

      if (id === 'chain' && !CLASSES[h.data.classKey].attack.melee && Math.random() < 0.40) {
        const arc = Math.max(1, Math.round(dmg * 0.5));
        let best = null, bestD = 4.5;
        for (const m of this.monsters) {
          if (m === foe || m.dead || m.data.hp <= 0) continue;
          const dd = Math.hypot(m.x - foe.x, m.z - foe.z);
          if (dd < bestD) { bestD = dd; best = m; }
        }
        if (best) {
          this.damageMonster(best, arc, h, false, { skipPerks: true });
          makeFloatText(this.engine.scene, 'ARC', _v.set(best.x, 1.3, best.z), '#8fd4e8');
          spawnSpriteEffect(this.engine.scene, 'dcss/effect/magic_bolt_1.png',
            new THREE.Vector3(best.x, 0.5, best.z), 1.0, 0.25);
        }
      }

      if (id === 'manaFont' && Math.random() < 0.15) {
        if (h.data.slotsMax && h.data.slots < h.data.slotsMax) {
          h.data.slots++;
          makeFloatText(this.engine.scene, '+slot', _v.set(h.x, 1.5, h.z), '#b06cf0');
          log(`✦ ${h.data.name}'s ${item.name} restores a spell slot!`, 'heal');
          updatePartyFrames(this.heroes.map(x => x.data));
        }
      }

      if (id === 'critSurge' && crit) {
        spawnSpriteEffect(this.engine.scene, 'dcss/effect/flame_0.png',
          new THREE.Vector3(foe.x, 0.6, foe.z), 1.1, 0.3);
      }
    }
  },

  /** Defensive perks when a hero takes damage (thorns, riposte). */
  applyOnDamagedPerks(h, attacker, dealt) {
    if (!attacker || dealt <= 0 || attacker.dead) return;
    const perks = equippedPerks(h.data, 'onDamaged');
    const seen = new Set();
    for (const { perk } of perks) {
      if (seen.has(perk.id)) continue;
      seen.add(perk.id);
      if (perk.id === 'thorns') {
        const thornDmg = 2 + Math.floor(h.data.level / 3);
        attacker.data.hp -= thornDmg;
        makeFloatText(this.engine.scene, String(thornDmg), _v.set(attacker.x, 1.1, attacker.z), '#6aea6a');
        if (attacker.data.hp <= 0) this.killMonster(attacker, h);
      }
      if (perk.id === 'riposte' && CLASSES[h.data.classKey].attack.melee) {
        const ret = 3 + Math.floor(h.data.level / 2);
        attacker.data.hp -= ret;
        makeFloatText(this.engine.scene, 'RIPOSTE', _v.set(attacker.x, 1.35, attacker.z), '#e8a83f');
        makeFloatText(this.engine.scene, String(ret), _v.set(attacker.x, 1.1, attacker.z), '#ffd34a');
        spawnSlash(this.engine.scene, { x: attacker.x, z: attacker.z }, 0xe8a83f, 0.7);
        if (attacker.data.hp <= 0) this.killMonster(attacker, h);
      }
    }
  },

  /** On-kill legendary perks. */
  applyOnKillPerks(h, m) {
    const perks = equippedPerks(h.data, 'onKill');
    for (const { perk } of perks) {
      if (perk.id === 'phaseStep') {
        h.phaseStepUntil = this.elapsed + 3;
        makeFloatText(this.engine.scene, 'PHASE', _v.set(h.x, 1.4, h.z), '#8fd4e8');
        log(`◈ ${h.data.name}'s Phase Step grants +4 AC briefly.`, 'heal');
      }
    }
  },

  /** Spend a spell slot if available. */
  spendSlot(h) {
    if ((h.data.slots || 0) <= 0) return false;
    h.data.slots--;
    this.refreshAbilityHud();
    return true;
  },

  canUseSpellRecharge(h, spell) {
    if (spell.recharge === 'slot') return (h.data.slots || 0) > 0;
    if (spell.recharge === 'short') return !h.data.abilityUsed?.short;
    if (spell.recharge === 'long' || spell.recharge === 'day') return !h.data.abilityUsed?.long;
    return true;
  },

  markSpellUsed(h, spell) {
    if (spell.recharge === 'slot') this.spendSlot(h);
    else if (spell.recharge === 'short') {
      h.data.abilityUsed.short = true;
      this.refreshAbilityHud();
    } else if (spell.recharge === 'long' || spell.recharge === 'day') {
      h.data.abilityUsed.long = true;
      this.refreshAbilityHud();
    }
  },

  /* Idle AI: pick the best known spell for this moment.
   *   Now conservative — "any" spells gate behind combat time + threat,
   *   elite/boss spells check threat, and nearly-dead targets are skipped. */
  tryCastKnownSpell(h, foe, alive) {
    const known = h.data.knownSpells || [];
    if (!known.length) return false;

    let best = null, bestP = -1;
    for (const key of known) {
      const sp = SPELLS[key];
      if (!sp || !this.canUseSpellRecharge(h, sp)) continue;
      const ai = sp.ai || { when: 'any', priority: 1 };
      let ok = false;
      if (ai.when === 'any') {
        // "Any" spells (Bless, Chaos Bolt) are always eligible — but we gate
        // them behind combat stability + threat so they aren't wasted on trash.
        ok = this._combatStable(ai.minCombatSec || 2.0)
          && this._worthSpending(h, foe, alive, 'low');
      }
      else if (ai.when === 'eliteOrBoss') {
        ok = (foe.isBoss || this.monsterEliteRoom(foe) || foe.data.hp >= 15)
          && this._worthSpending(h, foe, alive, 'normal');
      }
      else if (ai.when === 'selfHurt') ok = h.data.hp / h.data.maxHp < (ai.hpFrac || 0.4);
      else if (ai.when === 'hurtAlly') {
        ok = alive.some(a => a.data.hp / a.data.maxHp < (ai.hpFrac || 0.5));
      } else if (ai.when === 'cluster') {
        const n = this.monsters.filter(m => m.data.hp > 0 && m.active && Math.hypot(m.x - foe.x, m.z - foe.z) < 2.2).length;
        ok = n >= (ai.minTargets || 3);
      }
      if (ok && ai.priority > bestP) { bestP = ai.priority; best = key; }
    }
    if (!best) return false;
    // Final guard: don't cast at a foe that's one hit from death (unless it's a defensive/urgent spell)
    const sp = SPELLS[best];
    if (sp && sp.ai && sp.ai.when !== 'selfHurt' && sp.ai.when !== 'hurtAlly'
        && foe.data.hp / Math.max(foe.data.maxHp, 1) < 0.25 && foe.data.hp < 8) {
      return false;
    }
    return this.resolveSpell(h, best, foe, alive);
  },

  resolveSpell(h, key, foe, alive) {
    const sp = SPELLS[key];
    if (!sp || !this.canUseSpellRecharge(h, sp)) return false;
    const d = h.data;
    const from = new THREE.Vector3(h.x, 0.55, h.z);
    const to = new THREE.Vector3(foe.x, 0.5 * (foe.data.scale || 1), foe.z);
    const cluster = () => this.monsters.filter(m => m.data.hp > 0 && m.active && Math.hypot(m.x - foe.x, m.z - foe.z) < 2.2);
    const castSelf = () => this.playAbilityFx(h, key, { at: h, spell: true });
    const castOn = (t, extra = {}) => this.playAbilityFx(h, key, { at: t, spell: true, ...extra });

    /* --- individual spell effects --- */
    if (key === 'magicMissile') {
      this.markSpellUsed(h, sp);
      castSelf();
      const darts = 3 + Math.floor(d.level / 4);
      log(`✴ ${d.name} casts Magic Missile (${darts} darts)!`, 'crit');
      for (let i = 0; i < darts; i++) {
        const t = new THREE.Vector3(foe.x + (Math.random() - 0.5) * 0.5, 0.4 * foe.data.scale + 0.4, foe.z + (Math.random() - 0.5) * 0.5);
        spawnProjectile(this.engine.scene, from, t, 'bolt', sp.color, () => {
          if (foe.dead) return;
          this.damageMonster(foe, roll(1, 4, 1) + d.dmgBonus, h, false);
          spawnSpriteEffect(this.engine.scene, 'dcss/effect/magic_bolt_1.png', t, 0.9, 0.25);
        });
      }
      return true;
    }
    if (key === 'shield') {
      this.markSpellUsed(h, sp);
      h.shieldUntil = this.elapsed + 6;
      castSelf();
      log(`🛡 ${d.name} casts Shield! (+5 AC)`, 'heal');
      return true;
    }
    if (key === 'scorchingRay') {
      this.markSpellUsed(h, sp);
      castSelf();
      log(`🔥 ${d.name} casts Scorching Ray!`, 'crit');
      for (let i = 0; i < 3; i++) {
        spawnProjectile(this.engine.scene, from, to, 'bolt', sp.color, () => {
          if (foe.dead) return;
          this.damageMonster(foe, roll(2, 6, d.dmgBonus), h, false);
          spawnSpriteEffect(this.engine.scene, 'dcss/effect/searing_ray_3.png', to, 1.1, 0.28);
        });
      }
      return true;
    }
    if (key === 'fireball') {
      const foes = cluster();
      if (foes.length < 2) return false;
      this.markSpellUsed(h, sp);
      castSelf();
      log(`🔥 ${d.name} casts Fireball!`, 'crit');
      spawnProjectile(this.engine.scene, from, to, 'bolt', sp.color, () => {
        spawnSpriteEffect(this.engine.scene, 'dcss/effect/cloud_fire_2.png', to, 2.5, 0.5);
        spawnSlash(this.engine.scene, { x: foe.x, z: foe.z }, sp.color, 2.4);
        for (const m of foes) { if (!m.dead) this.damageMonster(m, roll(8, 6, d.dmgBonus), h, true); }
      });
      return true;
    }
    if (key === 'haste') {
      this.markSpellUsed(h, sp);
      h.cunningUntil = this.elapsed + 8;
      h.shieldUntil = this.elapsed + 8;
      castSelf();
      log(`⚡ ${d.name} casts Haste!`, 'heal');
      return true;
    }
    if (key === 'bless') {
      this.markSpellUsed(h, sp);
      for (const a of alive) a.inspiredUntil = this.elapsed + 8;
      this.playAbilityFx(h, 'bless', { at: h, alsoAt: alive, spell: true });
      log(`✨ ${d.name} casts Bless!`, 'heal');
      return true;
    }
    if (key === 'healingWord') {
      let worst = null, wf = 1;
      for (const a of alive) { const f = a.data.hp / a.data.maxHp; if (f < wf) { wf = f; worst = a; } }
      if (!worst || wf >= 0.55) return false;
      this.markSpellUsed(h, sp);
      const amt = roll(1, 4, mod(d.effStats.cha || d.effStats.wis) + d.healBonus);
      this.healHero(worst, amt);
      castOn(worst);
      log(`💬 ${d.name} casts Healing Word on ${worst.data.name} (+${amt}).`, 'heal');
      return true;
    }
    if (key === 'spiritualWeapon') {
      this.markSpellUsed(h, sp);
      const amt = roll(1, 8, mod(d.effStats.wis) + d.dmgBonus);
      castSelf();
      log(`⚔ ${d.name} casts Spiritual Weapon!`, 'crit');
      spawnProjectile(this.engine.scene, from, to, 'bolt', sp.color, () => {
        if (!foe.dead) {
          this.damageMonster(foe, amt, h, false);
          spawnSpriteEffect(this.engine.scene, 'dcss/effect/orb_glow_0.png', to, 1.2, 0.3);
        }
      });
      return true;
    }
    if (key === 'spiritGuardians' || key === 'entangle' || key === 'callLightning' || key === 'shatter'
      || key === 'dragonBreathSpell' || key === 'armsOfHadar') {
      const foes = cluster();
      if (foes.length < 1) return false;
      this.markSpellUsed(h, sp);
      const dice = key === 'callLightning' ? [3, 10] : key === 'spiritGuardians' ? [3, 8] : key === 'shatter' ? [3, 8]
        : key === 'dragonBreathSpell' ? [3, 6] : key === 'armsOfHadar' ? [2, 6] : [1, 6];
      castOn(foe, { alsoAt: foes, ring: 2.0, scale: 2.0 });
      log(`✨ ${d.name} casts ${sp.label}!`, 'crit');
      for (const m of foes) {
        if (m.dead) continue;
        this.damageMonster(m, roll(dice[0], dice[1], d.dmgBonus), h, false);
        if (key === 'entangle') m.slowUntil = this.elapsed + 4;
      }
      return true;
    }
    if (key === 'moonbeam' || key === 'chaosBolt') {
      this.markSpellUsed(h, sp);
      const amt = key === 'moonbeam' ? roll(2, 10, d.dmgBonus) : roll(2, 8, mod(d.effStats.cha) + d.dmgBonus);
      castSelf();
      log(`✨ ${d.name} casts ${sp.label}!`, 'crit');
      spawnProjectile(this.engine.scene, from, to, 'bolt', sp.color, () => {
        if (!foe.dead) {
          this.damageMonster(foe, amt, h, key === 'chaosBolt' && Math.random() < 0.15);
          const spr = key === 'moonbeam' ? 'dcss/effect/orb_glow_1.png' : 'dcss/effect/cloud_chaos_4.png';
          spawnSpriteEffect(this.engine.scene, spr, to, 1.3, 0.35);
        }
      });
      return true;
    }
    if (key === 'hex') {
      this.markSpellUsed(h, sp);
      h.hexTarget = foe; h.hexUntil = this.elapsed + 8;
      castOn(foe);
      log(`🔮 ${d.name} casts Hex on ${foe.data.name}!`, 'crit');
      return true;
    }
    if (key === 'huntersMark') {
      this.markSpellUsed(h, sp);
      h.markTarget = foe; h.markUntil = this.elapsed + 8;
      castOn(foe);
      log(`🎯 ${d.name} marks ${foe.data.name}!`, 'crit');
      return true;
    }
    if (key === 'thunderousSmite') {
      this.markSpellUsed(h, sp);
      h.smiteNext = true;
      castSelf();
      log(`⚡ ${d.name} readies Thunderous Smite!`, 'crit');
      return true;
    }
    return false;
  },

  /* day- and slot-tier subclass actives; returns true if one consumed this turn */
  castSubclassSpell(h, sc, foe, alive) {
    const key = sc.active.key, d = h.data;
    if (key === 'rallyingCry' && !d.abilityUsed?.long) {
      const hurt = alive.filter(a => a.data.hp < a.data.maxHp * 0.5);
      if (hurt.length >= 2) {
        d.abilityUsed.long = true;
        this.playAbilityFx(h, 'rallyingCry', { at: h, alsoAt: alive });
        log(`📣 ${d.name} bellows a Rallying Cry!`, 'heal');
        for (const a of alive) this.healHero(a, roll(1, 10, d.level));
        this.refreshAbilityHud();
        return true;
      }
      return false;
    }
    if (key === 'preserveLife' && !d.abilityUsed?.long) {
      const hurt = alive.filter(a => a.data.hp < a.data.maxHp * 0.4);
      if (hurt.length >= 2) {
        d.abilityUsed.long = true;
        this.playAbilityFx(h, 'preserveLife', { at: h, alsoAt: alive, spell: true });
        log(`✨ ${d.name} channels divinity — Preserve Life!`, 'heal');
        for (const a of alive) this.healHero(a, d.level * 2 + mod(d.effStats.wis) + d.healBonus);
        this.refreshAbilityHud();
        return true;
      }
      return false;
    }
    if (key === 'fireball' && d.slots > 0) {
      return this.resolveSpell(h, 'fireball', foe, alive);
    }
    if (key === 'magicMissile' && d.slots > 0
        && (foe.isBoss || this.monsterEliteRoom(foe) || foe.data.hp >= 15)
        && this._worthSpending(h, foe, alive, 'normal')) {
      return this.resolveSpell(h, 'magicMissile', foe, alive);
    }
    if (key === 'dragonBreath' && !d.abilityUsed.short && this._combatStable(1.0)) {
      const foes = this.monsters.filter(m => m.data.hp > 0 && m.active && Math.hypot(m.x - h.x, m.z - h.z) < 3);
      if (foes.length >= 2) {
        d.abilityUsed.short = true;
        this.playAbilityFx(h, 'dragonBreath', { at: h, alsoAt: foes, scale: 2.2, ring: 2.2 });
        log(`🐉 ${d.name} breathes fire!`, 'crit');
        for (const m of foes) this.damageMonster(m, roll(3, 6, d.dmgBonus), h, false);
        this.refreshAbilityHud();
        return true;
      }
    }
    if (key === 'wildSurge' && !d.abilityUsed.short && this._combatStable(1.5)) {
      // Only surge when someone is actually hurt — don't waste the heal
      const anyHurt = alive.some(a => a.data.hp < a.data.maxHp * 0.8);
      if (anyHurt) {
        d.abilityUsed.short = true;
        this.playAbilityFx(h, 'wildSurge', { at: h, alsoAt: alive, spell: true });
        log(`🌈 ${d.name}'s Wild Magic heals the party!`, 'heal');
        for (const a of alive) this.healHero(a, roll(1, 10, d.level));
        this.refreshAbilityHud();
        return true;
      }
    }
    if (key === 'cuttingWords' && !d.abilityUsed.short && (foe.isBoss || this.monsterEliteRoom(foe))
        && this._worthSpending(h, foe, alive, 'high')) {
      d.abilityUsed.short = true;
      foe.cutWordsUntil = this.elapsed + 6;
      foe.data._acPenalty = 4;
      this.playAbilityFx(h, 'cuttingWords', { at: foe, spell: true });
      log(`🎤 ${d.name} uses Cutting Words on ${foe.data.name}!`, 'crit');
      this.refreshAbilityHud();
      return true;
    }
    if (key === 'fiendishBlessing' && !d.abilityUsed.short
        && this._combatStable(1.8) && d.hp < d.maxHp * 0.8) {
      d.abilityUsed.short = true;
      h.tempHp = (h.tempHp || 0) + 10;
      this.playAbilityFx(h, 'fiendishBlessing', { at: h, spell: true });
      log(`😈 ${d.name} gains Fiendish Blessing (+10 temp HP)!`, 'heal');
      this.refreshAbilityHud();
      return true;
    }
    if (key === 'feyPresence' && !d.abilityUsed.short && this._combatStable(1.2)) {
      const foes = this.monsters.filter(m => m.data.hp > 0 && m.active && Math.hypot(m.x - h.x, m.z - h.z) < 3);
      if (foes.length) {
        d.abilityUsed.short = true;
        for (const m of foes) m.charmedUntil = this.elapsed + 3;
        this.playAbilityFx(h, 'feyPresence', { at: h, alsoAt: foes, spell: true });
        log(`🧚 ${d.name}'s Fey Presence charms nearby foes!`, 'heal');
        this.refreshAbilityHud();
        return true;
      }
    }
    if (key === 'wildShape' && !d.abilityUsed.short
        && d.hp < d.maxHp * 0.55) {
      d.abilityUsed.short = true;
      h.wildShapeUntil = this.elapsed + 8;
      h.tempHp = (h.tempHp || 0) + 20;
      this.playAbilityFx(h, 'wildShape', { at: h, scale: 1.9 });
      log(`🐻 ${d.name} Wild Shapes into a bear!`, 'heal');
      this.refreshAbilityHud();
      return true;
    }
    return false;
  },

  healHero(a, amt) {
    if (a.data.hp <= 0) return;
    a.data.hp = Math.min(a.data.maxHp, a.data.hp + amt);
    makeFloatText(this.engine.scene, '+' + amt, _v.set(a.x, 1.3, a.z), '#6ae06a');
    drawBar(a.ent.bar, a.data.hp / a.data.maxHp);
  },

  /* dynamic in-combat positioning: hold a slot around the foe with a gentle
     orbital sway so heroes read as fighting, not standing still. */
  combatMove(h, foe, atk, dt) {
    if (h.combatFoe !== foe) {
      h.combatFoe = foe;
      const idx = this.heroes.indexOf(h);
      h.anchorAngle = idx * (Math.PI * 2 / this.heroes.length) + (Math.random() - 0.5) * 0.4;
      h.swayPhase = Math.random() * 6.28;
      h.swayDir = Math.random() < 0.5 ? -1 : 1;
    }
    const desiredR = atk.melee ? 1.05 : Math.max(2.6, Math.min(atk.range - 0.8, atk.range * 0.6));
    const ang = h.anchorAngle + Math.sin(this.elapsed * 0.75 + h.swayPhase) * 0.55 * h.swayDir;
    const r = desiredR + Math.sin(this.elapsed * 1.15 + h.swayPhase) * 0.22;
    const tx = foe.x + Math.cos(ang) * r;
    const tz = foe.z + Math.sin(ang) * r;
    h.moving = this.nudgeToward(h, tx, tz, HERO_SPEED * COMBAT_SPEED * h.data.speedMult * this.hasteMult(h), dt);
  },

  hasteMult(h) { return h.cunningUntil > this.elapsed ? 1.4 : 1; },
  heroAC(h) {
    let ac = h.data.ac;
    if (h.cunningUntil > this.elapsed) ac += 4;
    if (h.shieldUntil > this.elapsed) ac += 5;
    if (h.raging) ac += 2;
    if (h.phaseStepUntil > this.elapsed) ac += 4;
    return ac;
  },

  /** Incoming damage after rage / totem / uncanny dodge / temp HP. */
  applyIncomingDamage(h, dmg) {
    let d = dmg;
    if (h.raging || (h.bearTotemUntil > this.elapsed)) d = Math.ceil(d / 2);
    if (hasFeature(h.data, 'uncannyDodge') && !h.uncannyUsed) {
      h.uncannyUsed = true;
      d = Math.ceil(d / 2);
    }
    if (h.tempHp > 0) {
      const absorb = Math.min(h.tempHp, d);
      h.tempHp -= absorb;
      d -= absorb;
    }
    h.data.hp -= d;
    return d;
  },

  strike(h, foe, dmg, crit, miss, alive = null) {
    const cls = CLASSES[h.data.classKey], a = cls.attack;
    const party = alive || this.heroes.filter(x => x.data.hp > 0);
    if (a.melee) {
      this.triggerLunge(h, foe);
      if (miss) { this.showMiss(foe); }
      else {
        this.damageMonster(foe, dmg, h, crit);
        this.applyOnHitPerks(h, foe, dmg, crit, party);
        spawnSlash(this.engine.scene, { x: foe.x, z: foe.z }, crit ? 0xffd34a : 0xdfe4ee, foe.data.scale);
        spawnSpriteEffect(this.engine.scene, crit ? 'dcss/effect/flame_0.png' : 'dcss/effect/blood_0.png', new THREE.Vector3(foe.x, 0.5, foe.z), 1.0, 0.3);
      }
    } else {
      const color = h.data.classKey === 'wizard' ? 0xff7a30
        : h.data.classKey === 'cleric' ? 0xbfe0ff : 0xe8d8a8;
      const kind = h.data.classKey === 'rogue' ? 'arrow' : 'bolt';
      const from = new THREE.Vector3(h.x, 0.55, h.z);
      const to = new THREE.Vector3(foe.x, 0.4 * foe.data.scale + 0.4, foe.z);
      spawnProjectile(this.engine.scene, from, to, kind, color, () => {
        if (foe.dead) return;
        if (miss) this.showMiss(foe);
        else {
          this.damageMonster(foe, dmg, h, crit);
          this.applyOnHitPerks(h, foe, dmg, crit, party);
          if (kind === 'bolt') {
            spawnSlash(this.engine.scene, { x: foe.x, z: foe.z }, color, foe.data.scale * 0.9);
            spawnSpriteEffect(this.engine.scene, 'dcss/effect/magic_bolt_1.png', to, 1.2, 0.3);
          } else {
            spawnSpriteEffect(this.engine.scene, 'dcss/effect/arrow_4.png', to, 1.0, 0.3);
          }
        }
      });
    }
  },

  showMiss(foe) { makeFloatText(this.engine.scene, 'miss', _v.set(foe.x, 1.1, foe.z), '#9aa'); },

  triggerLunge(e, target) {
    const dx = target.x - e.x, dz = target.z - e.z, d = Math.hypot(dx, dz) || 1;
    e.lungeDX = dx / d; e.lungeDZ = dz / d; e.lungeT = 0.22;
  },

  lungeOffset(e, dt) {
    if (!e.lungeT || e.lungeT <= 0) return [0, 0];
    e.lungeT -= dt;
    const p = 1 - Math.max(0, e.lungeT) / 0.22;
    const amp = Math.sin(Math.min(1, p) * Math.PI) * 0.42;
    return [e.lungeDX * amp, e.lungeDZ * amp];
  },

  damageMonster(m, dmg, h, crit = false, opts = {}) {
    if (m.dead) return;
    m.data.hp -= dmg;
    m.active = true;
    if (h?.data) h.data.dmgDealt += dmg;
    hitFlash(m.ent);
    makeFloatText(this.engine.scene, String(dmg), _v.set(m.x, 0.9 * m.data.scale + 0.5, m.z), crit ? '#ffd34a' : '#ff8a5a');
    drawBar(m.ent.bar, Math.max(0, m.data.hp / m.data.maxHp), '#e0483a');
    if (m.data.hp <= 0) this.killMonster(m, h);
  },

  /** Tick burn DoTs on monsters (called from update loop). */
  updateMonsterStatus(dt) {
    for (const m of this.monsters) {
      if (m.dead || m.data.hp <= 0 || !m.burn) continue;
      m.burn.t = (m.burn.t || 0) + dt;
      if (m.burn.t >= 1.0) {
        m.burn.t -= 1.0;
        m.burn.ticks--;
        const bd = m.burn.dmg;
        m.data.hp -= bd;
        makeFloatText(this.engine.scene, String(bd), _v.set(m.x, 1.0, m.z), '#ff7a30');
        drawBar(m.ent.bar, Math.max(0, m.data.hp / m.data.maxHp), '#e0483a');
        if (m.data.hp <= 0) this.killMonster(m, m.burn.src);
        else if (m.burn.ticks <= 0) m.burn = null;
      }
    }
  },

  killMonster(m, h) {
    m.dead = true;
    m.ent.grp.visible = false;
    m.burn = null;
    if (h?.data) {
      h.data.kills++;
      this.applyOnKillPerks(h, m);
    }
    this.gold += m.data.gold;
    const before = this.heroes.map(a => a.data.level);
    const share = Math.max(1, Math.round(m.data.xp * XP_SHARE));
    for (const a of this.heroes) if (a.data.hp > 0) grantXp(a.data, share, log);
    const killer = h?.data?.name || 'The party';
    log(`${killer} slays the ${m.data.name}. (+${m.data.gold}g, +${share} XP each)`, m.isBoss ? 'boss' : 'kill');
    /* Random drops: common–epic only (legendaries are quest rewards). */
    let dropChance = m.isBoss ? 1 : (m.data.name && this.monsterEliteRoom(m) ? 0.35 : 0.10);
    if (Math.random() < dropChance) {
      const it = rollItem(this.dungeonLevel);
      this.inventory.push(it);
      log(`  ↳ ${m.data.name} dropped ${it.name} (ilvl ${it.ilvl})!`, 'treasure');
    }
    if (m.isBoss) {
      log(`👑 ${m.data.name} falls! The floor is conquered!`, 'boss');
      this.gold += 50 * this.dungeonLevel;

      const q = this.activeQuest;
      const finalFloor = q && (this.questFloor|0) >= (q.floors|0);

      if (finalFloor && q.rewardItem && !q.rewardClaimed) {
        /* Quest reward is delivered at the end of the final dungeon floor. */
        this.grantQuestRewardsAtDungeonEnd();
      } else {
        showBanner('FLOOR CLEARED!', `${m.data.name} defeated`);
        const it = rollItem(this.dungeonLevel + 2, Math.random, null, { forceRarity: 'epic' });
        this.inventory.push(it);
        log(`  ↳ ${it.name} (ilvl ${it.ilvl}) claimed from the hoard!`, 'treasure');
      }
    }
    if (this.heroes.some((a, i) => a.data.level > before[i])) this.announceLevelUp();
    updateResources(this);
    updatePartyFrames(this.heroes.map(x => x.data));
    refreshMenus(this);
  },

  monsterEliteRoom(m) {
    const r = this.D.rooms[m.roomId];
    return r && (r.type === 'elite');
  },

  announceLevelUp() {
    const total = this.heroes.reduce((n, h) => n + pendingPoints(h.data), 0);
    const badge = document.getElementById('nav-levelup-badge');
    if (badge) { badge.textContent = total; badge.style.display = total > 0 ? '' : 'none'; }
  }
};
