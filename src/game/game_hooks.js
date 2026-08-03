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
import {
  drawBar,
  makeFloatText,
  makeLootFloatText,
  hitFlash,
  updateFlash,
  spawnProjectile,
  spawnSlash,
  spawnSpriteEffect,
  spawnSheetEffect,
  spawnDeathFountain,
  spawnAoEVisual,
  removeAoEVisual,
  spawnMeleeHitVFX,
  spawnTelegraph,
  spawnRichAbilityVFX,
  spawnBeamEffect,
  spawnImpactBurst,
  updateStatusTray,
  hasActiveFX,
} from './entities.js';
import {
  log,
  updatePartyFrames,
  updateResources,
  showBanner,
  updateInitiativeTracker,
  pulseLeaderFrame,
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
    makeFloatText(this.engine.scene, text, pos, color, isCrit);
  },

  /** Tactile Loot & Gold Feedback floating above the party leader's head */
  notifyLootFeedback(data) {
    if (!data) return;
    const leader = typeof this.partyLeader === 'function' ? this.partyLeader() : null;
    if (!leader || !this.engine || !this.engine.scene) return;

    const leaderX = typeof leader.x === 'number' ? leader.x : (leader.ent?.grp?.position?.x || 0);
    const leaderZ = typeof leader.z === 'number' ? leader.z : (leader.ent?.grp?.position?.z || 0);
    const basePos = new THREE.Vector3(leaderX, 2.0, leaderZ);

    if (data.gold && data.gold > 0) {
      makeLootFloatText(this.engine.scene, basePos, 'gold', data.gold);
      pulseLeaderFrame('gold');
    }

    if (data.items && Array.isArray(data.items)) {
      data.items.forEach((it, idx) => {
        setTimeout(() => {
          if (this.engine?.scene) {
            const currentLeader = typeof this.partyLeader === 'function' ? this.partyLeader() : leader;
            const lX = currentLeader && typeof currentLeader.x === 'number' ? currentLeader.x : (currentLeader?.ent?.grp?.position?.x || leaderX);
            const lZ = currentLeader && typeof currentLeader.z === 'number' ? currentLeader.z : (currentLeader?.ent?.grp?.position?.z || leaderZ);
            makeLootFloatText(this.engine.scene, new THREE.Vector3(lX, 2.0, lZ), 'gear', it);
            pulseLeaderFrame('gear', it?.rarity || 'common');
          }
        }, idx * 220);
      });
    } else if (data.item) {
      makeLootFloatText(this.engine.scene, basePos, 'gear', data.item);
      pulseLeaderFrame('gear', data.item?.rarity || 'common');
    }

    if (data.potion) {
      const potName = data.potion === 'greater' ? 'Greater Healing Potion' : 'Healing Potion';
      makeLootFloatText(this.engine.scene, basePos, 'gear', { name: potName, rarity: 'uncommon' });
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
  fxProjectile(from, to, kind, color, onHit, opts = {}) {
    spawnProjectile(this.engine.scene, from, to, kind, color, onHit, opts);
  },
  fxBeam(from, to, opts = {}) {
    spawnBeamEffect(this.engine.scene, from, to, opts);
  },
  fxSprite(path, pos, scale, dur) {
    spawnSpriteEffect(this.engine.scene, path, pos, scale, dur);
  },
  fxSheetEffect(def, pos, scale, dur) {
    spawnSheetEffect(this.engine.scene, def, pos, scale, dur);
  },
  fxSlash(pos, color, size) {
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
  fxHitFlash(ent) {
    if (ent?.ent) hitFlash(ent);
  },
  fxUpdateFlash(ent, dt) {
    if (ent?.ent) updateFlash(ent, dt);
  },
  fxDeathFountain(pos) {
    spawnDeathFountain(this.engine.scene, pos);
  },
  fxMeleeHitVFX(targetPos, attackerPos, isCrit, dmgType, scale) {
    spawnMeleeHitVFX(this.engine.scene, targetPos, attackerPos, isCrit, dmgType, scale);
  },
  fxTelegraph(pos, radius, color, duration) {
    spawnTelegraph(this.engine.scene, pos, radius, color, duration);
  },
  fxStatusTray(e) {
    updateStatusTray(e);
  },
  /** True when spell/projectile/attack FX animations are still playing.
   *  Headless override returns false (no FX → never blocks turn advance). */
  fxHasActiveFX() {
    return hasActiveFX();
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
  fxOnKill(m, h) { onKill(this, m, h); },
};
