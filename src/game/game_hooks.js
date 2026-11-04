/**
 * Presentation-layer hooks — the single integration point between domain logic
 * (combat, AI, spells, conditions) and the outside world (Three.js, DOM, audio).
 *
 * Every VFX, UI, audio, and Three.js call from domain modules goes through one
 * of these `this.*` methods. The real Game mixes this in alongside the domain
 * mixins; a HeadlessGame provides no-op or data-collecting overrides so the same
 * domain code runs in Node.js without a browser.
 *
 * Why: decoupling presentation from game logic lets the entire combat engine
 * run headlessly for mass balance simulation. Domain modules never import
 * entities.js, ui.js, audio.js, or three directly — they call hooks.
 */
import * as THREE from 'three';
import { BEAT, noteBeat, readyToAdvance, resetFxClock, hold, fxVisualBusy } from './fx_clock.js';
import { reportError } from './errors.js';
import {
  beginInitiativeReveal, tickInitiativeReveal, finishInitiativeReveal, isRevealActive,
} from './initiative_reveal.js';
import { getSetting } from './settings.js';
import {
  drawBar,
  makeFloatText,
  hitFlash,
  updateFlash,
  HIT_FLASH_SEC,
  spawnProjectile,
  spawnSlash,
  spawnSpriteEffect,
  spawnSheetEffect,
  spawnDeathFountain,
  beginSpriteEvaporate,
  setSpriteEvaporate,
  spawnEvaporatePixels,
  spawnAoEVisual,
  removeAoEVisual,
  spawnMeleeHitVFX,
  spawnTelegraph,
  spawnRichAbilityVFX,
  spawnBeamEffect,
  spawnImpactBurst,
  spawnFlashLight,
  updateStatusTray,
  hasActiveFX,
  swapHeroSprite,
} from './entities.js';
import {
  log,
  updatePartyFrames,
  updateResources,
  showBanner,
  updateInitiativeTracker,
  pulseLeaderFrame,
  pushLootFeed,
} from './ui.js';
import { refreshMenus } from './menus.js';
import {
  playSfx,
  spellSfx,
  cantripSfx,
  abilitySfx,
} from './audio.js';
import { _v } from './shared.js';
import { onKill } from './quest_events.js';
import { spawnCompositeAnimation, hasActiveCompositeFX } from './vfx_animations.js';
import { groundY } from '../dungeon/elevation.js';
import { spawnLivePixelFx, spawnLightMote, spawnManaBurst } from '../render/pixelfx_live.js';
import { spawnBodyEffect, chestWorldY, spawnSpellCharge, SPELL_CHARGE_SECONDS } from '../render/body_fx.js';
import { poseCast, poseHit } from './sprite_pose.js';
import { visualOf } from './entities.js';
import * as stormCloudFx from '../render/pfx/storm_cloud.js';
import * as wispFx from '../render/pfx/wisp.js';
import { PAL } from '../vendor/pixelfx/core/index.js';

export const gameHookMethods = {

  /* ════════════════════════════════════════════════════════════════════
     Vector helpers — hides THREE.Vector3 behind a factory so callers never
     touch Three.js directly.  In headless mode _v3 returns a plain {x,y,z}.
     ════════════════════════════════════════════════════════════════════ */
  _v3(x, y, z) { return new THREE.Vector3(x, y, z); },

  /** Set the shared scratch vector and return it (avoids per-call alloc). */
  _vScratch(x, y, z) { _v.set(x, y, z); return _v; },

  /* ════════════════════════════════════════════════════════════════════
     Combat log
     ════════════════════════════════════════════════════════════════════ */
  fxLog(msg, style, opts) { log(msg, style, opts); },

  /* ════════════════════════════════════════════════════════════════════
     Floating world text (damage / heal / status numbers)
     ════════════════════════════════════════════════════════════════════ */
  fxText(text, pos, color, isCrit) {
    /* A crit is worth dwelling on; ordinary damage numbers ride the routine
       beat the turn already carries. See fx_clock.js. */
    if (isCrit) noteBeat(BEAT.NOTABLE);
    makeFloatText(this.engine.scene, text, pos, color, isCrit);
  },

  /** Loot & gold feedback: a line on the top-centre feed, plus a pulse on the
   *  leader's portrait frame.
   *
   *  This used to hang a world-space bubble over the leader's head. That read
   *  badly for two reasons: it scaled with the camera, so a long item name
   *  covered a good part of the play area, and it sat exactly where the party
   *  was walking. The feed is screen-space, so it is a consistent size and
   *  stays clear of the floor. The leader-frame pulse is kept — that is what
   *  still ties a pickup to WHO picked it up.
   *
   *  The gold sparkle stays in the world, at the leader: it is a burst rather
   *  than something you have to read, so it loses nothing by being in 3D. */
  notifyLootFeedback(data) {
    if (!data) return;

    if (data.gold && data.gold > 0) {
      pushLootFeed({ icon: '\u{1FA99}', name: `${data.gold} Gold`, rarity: 'common' });
      pulseLeaderFrame('gold');
      const leader = typeof this.partyLeader === 'function' ? this.partyLeader() : null;
      if (leader && this.engine?.scene && this.fxImpactBurst) {
        const lx = typeof leader.x === 'number' ? leader.x : (leader.ent?.grp?.position?.x || 0);
        const lz = typeof leader.z === 'number' ? leader.z : (leader.ent?.grp?.position?.z || 0);
        this.fxImpactBurst(new THREE.Vector3(lx, 1.4, lz), 'holy', '#ffd700', 14);
      }
    }

    /* A chest can hand over several items at once. Stagger them so they arrive
       as a readable list instead of landing in a single frame. */
    if (data.items && Array.isArray(data.items)) {
      data.items.forEach((it, idx) => {
        setTimeout(() => {
          pushLootFeed({ icon: '\u{1F9F0}', name: it?.name || 'Gear', rarity: it?.rarity || 'common' });
          pulseLeaderFrame('gear', it?.rarity || 'common');
        }, idx * 220);
      });
    } else if (data.item) {
      pushLootFeed({ icon: '\u{1F9F0}', name: data.item?.name || 'Gear', rarity: data.item?.rarity || 'common' });
      pulseLeaderFrame('gear', data.item?.rarity || 'common');
    }

    if (data.potion) {
      const potName = data.potion === 'greater' ? 'Greater Healing Potion' : 'Healing Potion';
      pushLootFeed({ icon: '\u{1F9EA}', name: potName, rarity: 'uncommon' });
      pulseLeaderFrame('gear', 'uncommon');
    }
  },

  notifyGold(amount) {
    this.notifyLootFeedback({ gold: amount });
  },

  notifyGear(item) {
    this.notifyLootFeedback({ item });
  },

  /* ════════════════════════════════════════════════════════════════════
     Projectiles, beams, sprites, slashes, bursts
     ════════════════════════════════════════════════════════════════════ */
  /* Delay the impact half of a melee attack (damage, hit FX, floater, death)
     until the attack animation actually reaches its contact pose. Combat rolls
     the attack immediately so the outcome is decided at action time; only the
     consequences are deferred - the same split fxProjectile already uses for
     ranged, where the arrow's travel provides the delay.

     Ticked from the game loop with the combat-speed-scaled dt, so the Options
     speed slider stretches the wind-up exactly as it stretches the animation.
     `hold` keeps the turn engine from advancing before the blow lands. */
  fxImpactDelay(delaySec, cb) {
    this.fxDelay(delaySec, cb);
  },
  /* General combat-clock timer. Anything that sequences presentation — the
     darts of a Magic Missile, the hailstones of an Ice Storm — goes through
     here, never setTimeout: real time drifts from the combat clock the moment
     the speed slider leaves 1.0 or a hit-stop fires, and the follow-up lands
     out of step with the animation it belongs to (the Extra Attack drift of
     Sept 2026). `hold: false` for a timer that is a rule, not a visual — it
     must not keep the turn engine waiting. */
  fxDelay(delaySec, cb, opts = null) {
    if (!cb) return;
    if (this._castLead) delaySec = (delaySec || 0) + this._castLead;
    if (!(delaySec > 0)) { cb(); return; }
    if (!opts || opts.hold !== false) hold(delaySec + 0.25);
    (this._pendingImpacts || (this._pendingImpacts = [])).push({ t: delaySec, cb, holds: !opts || opts.hold !== false });
  },
  /** Hold the turn engine while a visual that carries information — a hero's
      spellcast — plays for `sec` combat seconds. */
  fxHold(sec) {
    hold(sec);
  },
  /** Advance pending impacts; fires each callback once its delay elapses. */
  tickPendingImpacts(dt) {
    const q = this._pendingImpacts;
    if (!q || !q.length) return;
    for (let i = q.length - 1; i >= 0; i--) {
      q[i].t -= dt;
      if (q[i].t > 0) continue;
      const { cb } = q[i];
      q.splice(i, 1);
      /* One bad impact must not take the frame down with it. */
      try { cb(); } catch (e) { reportError('deferred impact', e); }
    }
  },
  /** Drop queued impacts (combat ended, floor changed) so they cannot land
      into a torn-down scene. */
  clearPendingImpacts() { this._pendingImpacts = null; },

  /* ── the spell charge ─────────────────────────────────────────────────
     Every spell opens with a half-second charge at the caster's chest. The
     cast itself still runs at once (its rules, its slot, whether it succeeded),
     but while `_castLead` is set everything it shows — and its damage and
     healing, combat.js — waits out the charge. */
  fxWithSpellCharge(caster, color, cast, chargeFx = null) {
    this._castLead = SPELL_CHARGE_SECONDS;
    let ok;
    try { ok = cast(); } finally { this._castLead = 0; }
    if (ok) this.fxSpellCharge(caster, color, chargeFx);
    return ok;
  },
  /* `chargeFx`: a BODY_EFFECTS name to wind up with instead of the gather at the chest.
     `toward`: the world heading { x, z } the spell leaves along; by default the
     heading the cast animation just turned the caster to. */
  fxSpellCharge(caster, color, chargeFx = null, toward = null) {
    if (chargeFx) spawnBodyEffect(chargeFx, caster);
    else spawnSpellCharge(caster, color);
    poseCast(visualOf(caster), toward ? toward.x : (caster.attackTargetDX || 0), toward ? toward.z : (caster.attackTargetDZ || 0), SPELL_CHARGE_SECONDS);
    /* a soft swell that crests as the charge ends, so the spell's own sound doesn't start cold */
    this.fxPlaySfx('spellCharge', { volume: 0.6 });
    hold(SPELL_CHARGE_SECONDS);
  },
  /* Where a spell leaves the caster: the centre of the chest, on the real floor. */
  fxChestPos(e) { return this._v3(e.x, chestWorldY(e), e.z); },
  fxGroundY(x, z) { return groundY(this.D, x, z); },
  /** Run `fn` after the charge if a cast is opening; true if it was deferred. */
  _afterCastLead(fn) {
    if (!this._castLead) return false;
    this.fxDelay(0, fn);
    return true;
  },
  fxProjectile(from, to, kind, color, onHit, opts = {}) {
    if (this._afterCastLead(() => this.fxProjectile(from, to, kind, color, onHit, opts))) return;
    noteBeat(BEAT.NOTABLE);
    const dur = spawnProjectile(this.engine.scene, from, to, kind, color, onHit, opts);
    if (dur > 0) hold(dur);
  },
  /** Play a composite VFX animation (travel + impact layers, sounds) authored
   *  in the animation editor. `opts` may carry travelSound/impactSound overrides
   *  (or false to mute) and an onImpact callback. */
  fxCompositeAnimation(anim, from, to, opts = {}) {
    if (this._afterCastLead(() => this.fxCompositeAnimation(anim, from, to, opts))) return null;
    noteBeat(BEAT.NOTABLE);
    /* `ground` impact layers sit on the terrain under the target, raised floors included. */
    const groundAt = opts.groundAt || ((x, z) => groundY(this.D, x, z));
    return spawnCompositeAnimation(this.engine.scene, anim, { ...opts, from, to, groundAt });
  },
  /** Call Lightning's storm cloud, live-drawn (pixelfx) over the floor at
   *  (x, z): boiling, raining, flickering, never striking on its own.
   *  Returns { glideTo(x, z, sec), flash(k), remove() }. */
  fxStormCloud(x, z) {
    /* the cloud gathers with the charge; only its bolts wait */
    const at = (px, pz) => new THREE.Vector3(px, groundY(this.D, px, pz), pz);
    const fx = spawnLivePixelFx(this.engine.scene, stormCloudFx, { pos: at(x, z), pxPerUnit: stormCloudFx.PX_PER_UNIT });
    return {
      glideTo: (px, pz, sec) => { const p = at(px, pz); fx.moveTo(p.x, p.y, p.z, sec); },
      flash: (k) => fx.flash(k),
      remove: () => fx.remove(),
    };
  },
  /** A small gold wisp of Dancing Lights, live-drawn over the floor at (x, z).
   *  Returns { glideTo(x, z, sec), place(x, z), remove() }. */
  fxWisp(x, z, seed = 0) {
    const at = (px, pz) => new THREE.Vector3(px, groundY(this.D, px, pz), pz);
    const fx = spawnLivePixelFx(this.engine.scene, wispFx, {
      pos: at(x, z), pxPerUnit: (38 / 1.1) * 3, options: { palette: PAL.gold, seed: seed + 1 },
    });
    return {
      glideTo: (px, pz, sec) => { const p = at(px, pz); fx.moveTo(p.x, p.y, p.z, sec); },
      place: (px, pz) => { const p = at(px, pz); fx.mesh.position.copy(p); },
      remove: () => fx.remove(),
    };
  },
  /** The Light cantrip's white mote (render/pfx/light_mote.js). */
  fxLightMote(x, y, z) {
    const fx = spawnLightMote(this.engine.scene, new THREE.Vector3(x, y, z));
    return { place: (px, py, pz) => fx.mesh.position.set(px, py, pz), remove: () => fx.remove() };
  },
  /** pixelfx's Mana Burst on the floor under `e`, in a named PAL ramp. */
  fxManaBurst(e, palette) {
    spawnManaBurst(this.engine.scene, new THREE.Vector3(e.x, groundY(this.D, e.x, e.z), e.z), PAL[palette]);
  },
  /** A pixelfx effect painted onto a creature's own sprite (render/body_fx.js). */
  fxBodyEffect(kind, creature) {
    if (this._afterCastLead(() => this.fxBodyEffect(kind, creature))) return null;
    return spawnBodyEffect(kind, creature);
  },
  fxBeam(from, to, opts = {}) {
    if (this._afterCastLead(() => this.fxBeam(from, to, opts))) return;
    /* pillars stand on the terrain under their mark */
    if (opts.type === 'pillar' && opts.groundY == null && to) opts = { ...opts, groundY: groundY(this.D, to.x, to.z) };
    hold(opts.duration || 0.55);
    spawnBeamEffect(this.engine.scene, from, to, opts);
  },
  fxSprite(path, pos, scale, dur) {
    if (this._afterCastLead(() => this.fxSprite(path, pos, scale, dur))) return;
    const entry = spawnSpriteEffect(this.engine.scene, path, pos, scale, dur);
    if (entry && entry.dur > 0) hold(entry.dur);
  },
  fxSheetEffect(def, pos, scale, dur) {
    if (this._afterCastLead(() => this.fxSheetEffect(def, pos, scale, dur))) return;
    const entry = spawnSheetEffect(this.engine.scene, def, pos, scale, dur);
    if (entry && entry.dur > 0) hold(entry.dur);
  },
  fxSlash(pos, color, size) {
    noteBeat(BEAT.ROUTINE);
    spawnSlash(this.engine.scene, pos, color, size);
  },
  fxImpactBurst(pos, type, color, count) {
    spawnImpactBurst(this.engine.scene, pos, type, color, count);
  },

  /* ════════════════════════════════════════════════════════════════════
     Entity visuals — HP bars, hit flash, status tray, death fountain
     ════════════════════════════════════════════════════════════════════ */
  fxDrawBar(bar, frac, color) {
    if (bar) drawBar(bar, frac, color);
  },
  /* Rebuild a hero's sprite after its appearance changes (wild shape in/out).
     Routed through a hook because it constructs THREE textures — headless
     callers (the balance sim) stub it out. */
  fxSwapHeroSprite(ent, heroData) {
    if (ent) swapHeroSprite(ent, heroData);
  },
  fxHitFlash(ent) {
    hitFlash(ent);
  },
  /* A spell landing on `e`: squashed, pushed away from `source`. */
  fxPoseHit(e, source) {
    if (!e || !source || source.x == null) return;
    poseHit(visualOf(e), e.x - source.x, e.z - source.z);
  },
  fxUpdateFlash(ent, dt) {
    updateFlash(ent, dt);
  },
  /* How long a hit flash runs. The death path holds its dissolve for this long
     so the killing blow still gets its flash and recoil. Exposed as a hook
     because combat.js deliberately never imports entities.js. */
  fxHitFlashSeconds() {
    return HIT_FLASH_SEC;
  },
  fxDeathFountain(pos) {
    spawnDeathFountain(this.engine.scene, pos);
  },
  fxBeginEvaporate(mesh) {
    if (mesh && mesh.material) beginSpriteEvaporate(mesh.material);
  },
  fxSetEvaporate(mesh, dissolve, time) {
    if (mesh && mesh.material) return setSpriteEvaporate(mesh.material, dissolve, time);
    return null;
  },
  fxEvaporatePixels(pos, count, color, mesh, dissolve, spriteWidth) {
    if (this.engine && this.engine.scene) {
      const cam = this.engine?.cam;
      const camTarget = this.engine?.camTarget;
      let camAngle = Math.PI / 4;
      if (cam && camTarget) {
        camAngle = Math.atan2(cam.position.x - camTarget.x, cam.position.z - camTarget.z);
      }
      spawnEvaporatePixels(this.engine.scene, pos, { count, color, mesh, dissolve, spriteWidth, camAngle });
    }
  },
  fxMeleeHitVFX(targetPos, attackerPos, isCrit, dmgType, scale, opts = {}) {
    const cam = this.engine?.cam;
    const camTarget = this.engine?.camTarget;
    let camAngle = 0;
    if (cam && camTarget) {
      camAngle = Math.atan2(cam.position.x - camTarget.x, cam.position.z - camTarget.z);
    }
    spawnMeleeHitVFX(this.engine.scene, targetPos, attackerPos, isCrit, dmgType, scale, { ...opts, camAngle });
  },
  fxTelegraph(pos, radius, color, duration, opts = {}) {
    const optObj = typeof opts === 'string' ? { type: opts } : (opts || {});
    spawnTelegraph(this.engine.scene, pos, radius, color, duration, optObj);
  },
  fxStatusTray(e) {
    updateStatusTray(e);
  },
  /** True when spell/projectile/attack FX animations are still playing.
   *  Headless override returns false (no FX → never blocks turn advance). */
  fxHasActiveFX() {
    return hasActiveFX() || hasActiveCompositeFX();
  },
  /** True while any spell charge, delayed release, projectile flight, or hit/impact
   *  visual is still playing. Used by actionAnimBusy(actor, game) so casters finish
   *  their cast, charge, projectile, and hit animation before stepping away. */
  fxActionBusy() {
    return !!(this._castLead > 0
      || (this._pendingImpacts && this._pendingImpacts.some(p => p.holds !== false))
      || hasActiveFX()
      || hasActiveCompositeFX()
      || fxVisualBusy());
  },
  fxRichAbilityVFX(casterPos, targetPos, fx, label, opts = {}) {
    spawnRichAbilityVFX(this.engine.scene, casterPos, targetPos, fx, label, opts);
  },

  /* ════════════════════════════════════════════════════════════════════
     AoE zone visuals
     ════════════════════════════════════════════════════════════════════ */
  fxAoEVisual(pos, color, size, duration, options = null) {
    return spawnAoEVisual(this.engine.scene, pos, color, size, duration, options);
  },
  fxRemoveAoEVisual(visual) {
    if (visual) removeAoEVisual(this.engine.scene, visual);
  },
  fxFlashLight(pos, color = 0xffaa44, intensity = 4.5, range = 12.0, duration = 0.3) {
    if (this.engine?.scene) spawnFlashLight(this.engine.scene, pos, color, intensity, range, duration);
  },

  /* ════════════════════════════════════════════════════════════════════
     Engine screen effects (hit-stop, screen shake)
     ════════════════════════════════════════════════════════════════════ */
  triggerHitStop(dur) {
    if (this.engine?.triggerHitStop) this.engine.triggerHitStop(dur);
  },
  triggerShake(intensity) {
    if (this.engine?.triggerShake) this.engine.triggerShake(intensity);
  },
  triggerSlowMo(dur) {
    if (this.engine?.triggerSlowMo) this.engine.triggerSlowMo(dur);
  },

  /* ════════════════════════════════════════════════════════════════════
     UI updates
     ════════════════════════════════════════════════════════════════════ */
  refreshHud() {
    updatePartyFrames(this.heroes.map(x => x.data));
  },
  refreshResources() {
    updateResources(this);
  },
  fxShowBanner(msg) {
    showBanner(msg);
  },
  fxRefreshMenus() {
    refreshMenus(this);
  },
  fxUpdateInitTracker() {
    updateInitiativeTracker(this);
  },
  fxUpdateManualBar() {
    if (typeof window !== 'undefined' && window.__updateManualBar)
      window.__updateManualBar();
  },
  fxLevelUpBadge() {
    const badge = document.getElementById('nav-party-badge');
    if (badge) badge.textContent = String(parseInt(badge.textContent || '0') + 1);
  },

  /* ════════════════════════════════════════════════════════════════════
     Audio
     ════════════════════════════════════════════════════════════════════ */
  fxPlaySfx(name, opts) {
    playSfx(name, opts);
  },
  fxSpellSfx(key) {
    return spellSfx(key);
  },
  fxCantripSfx(classKey) {
    return cantripSfx(classKey);
  },
  fxAbilitySfx(key, fx) {
    return abilitySfx(key, fx);
  },

  /* ════════════════════════════════════════════════════════════════════
     Delayed VFX scheduling — spells use this for sequential projectiles
     and delayed explosions.  Headless overrides to fire immediately.
     ════════════════════════════════════════════════════════════════════ */
  fxSchedule(delayMs, fn) {
    setTimeout(fn, delayMs);
  },

  /* ════════════════════════════════════════════════════════════════════
     Quest event hooks — quest_events.js pulls in Three.js/UI, so the
     import lives here (browser-only).  Headless provides a no-op.
     ════════════════════════════════════════════════════════════════════ */
  fxOnKill(m, h) { noteBeat(BEAT.MAJOR); onKill(this, m, h); },

  /* ════════════════════════════════════════════════════════════════════
     Turn pacing — see fx_clock.js. Lives behind the hook layer so
     HeadlessGame keeps advancing turns with zero delay.
     ════════════════════════════════════════════════════════════════════ */
  /** True once every information-carrying visual has finished AND this turn's
   *  read buffer has elapsed. The initiative loop will not pass the spotlight
   *  until this is true. */
  fxTurnReady() { return readyToAdvance(); },

  /** Start the combat-start d20 roll-off. Returns true if it is playing, in
   *  which case the caller must not begin turn 1 yet. Respects the Options
   *  toggle; HeadlessGame stubs this to false so the sim never waits. */
  fxBeginInitiativeReveal(order, aliveRows) {
    if (getSetting('initiativeReveal') === false) return false;
    /* Build the rail first — the badges need real row rectangles to fly to. */
    updateInitiativeTracker(this);
    return beginInitiativeReveal(this.engine, order, aliveRows);
  },
  /** Advance the roll-off. True while still playing. */
  fxTickInitiativeReveal(dt) { return tickInitiativeReveal(dt); },
  fxRevealActive() { return isRevealActive(); },
  fxCancelInitiativeReveal() { finishInitiativeReveal(); },
  /** Drop pending holds — combat ended or the floor changed. */
  /* Combat is over: also drop any queued melee impacts so a blow scheduled
     during the final round cannot fire into a torn-down scene. */
  fxResetPacing() { resetFxClock(); finishInitiativeReveal(); this.clearPendingImpacts(); },
};
