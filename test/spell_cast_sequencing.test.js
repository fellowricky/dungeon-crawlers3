import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

/* HeroSprite composes its layers on a canvas; give it one that does nothing. */
if (typeof globalThis.Image === 'undefined') {
  globalThis.Image = class { set src(v) { setTimeout(() => this.onerror && this.onerror(), 1); } };
}
if (typeof globalThis.document === 'undefined') {
  const ctx = new Proxy({}, { get: (t, k) => {
    if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop: () => {} });
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'getImageData') return () => ({ data: new Uint8Array(4) });
    return () => {};
  }});
  const el = {
    width: 64, height: 64, style: {}, setAttribute: () => {}, addEventListener: () => {},
    getContext: () => ctx, appendChild: () => {},
  };
  globalThis.document = {
    createElement: () => ({ ...el }), createElementNS: () => ({ ...el }),
    getElementById: () => null, body: el,
  };
}

import { HeroSprite } from '../src/game/sprite_animator.js';
import { actionAnimRemaining, actionAnimBusy } from '../src/game/turn_engine.js';
import { combatMethods } from '../src/game/combat.js';
import { initiativeMethods } from '../src/game/initiative.js';
import { cameraBasisFromYawPitch, cameraBasisFromMatrix, screenSpan, spanRibbon } from '../src/game/span_ribbon.js';
import { VFX_ANIMS, spawnCompositeAnimation, updateCompositeFX } from '../src/game/vfx_animations.js';

const CAST = 7 / 9;   // LPC spellcast: 7 frames at 9 fps

const caster = () => new HeroSprite({ visual: {}, equipment: {}, classKey: 'wizard' }, 0xffffff);

/* ── 1. a cast plays to its last frame ─────────────────────────────── */

describe('a spellcast is never cut short', () => {
  it('walking, idling and a flinch all wait for the cast to finish', () => {
    const s = caster();
    s.play('spellcast', true);
    s.update(0.2);
    s.play('walk');
    s.play('idle');
    s.play('hurt', true);
    expect(s.state).toBe('spellcast');
    expect(s.isPlayingAttack()).toBe(true);
    s.update(CAST);                       // past the last frame
    expect(s.state).toBe('walk');
    expect(s.isPlayingAttack()).toBe(false);
  });

  it('a second action queues behind the cast and starts when it ends', () => {
    const s = caster();
    s.play('spellcast', true);
    s.update(0.3);
    s.play('slash', true);
    expect(s.state).toBe('spellcast');
    expect(s.attackRemaining()).toBeCloseTo(CAST - 0.3 + 0.6, 5);   // the cast's rest + the slash
    s.update(CAST);
    expect(s.state).toBe('slash');
    expect(s.time).toBe(0);
  });

  it('death still takes over mid-cast', () => {
    const s = caster();
    s.play('spellcast', true);
    s.update(0.2);
    s.playDeath();
    expect(s.state).toBe('hurt');
    expect(s.attackRemaining()).toBe(0);
  });

  it('reports how much of the action animation is left, 0 when none is playing', () => {
    const s = caster();
    expect(s.attackRemaining()).toBe(0);
    s.play('spellcast', true);
    expect(s.attackRemaining()).toBeCloseTo(CAST, 5);
    s.update(0.5);
    expect(s.attackRemaining()).toBeCloseTo(CAST - 0.5, 5);
  });
});

describe('actionAnimBusy', () => {
  it('reads the actor animator, and an actor without one is never busy (headless)', () => {
    const s = caster();
    const h = { ent: { anim: s } };
    expect(actionAnimBusy(h)).toBe(false);
    s.play('spellcast', true);
    expect(actionAnimBusy(h)).toBe(true);
    expect(actionAnimRemaining(h)).toBeCloseTo(CAST, 5);
    expect(actionAnimBusy({ ent: {} })).toBe(false);
    expect(actionAnimBusy(null)).toBe(false);
    expect(actionAnimRemaining({ ent: { anim: { attackRemaining: () => -1 } } })).toBe(0);
  });
});

describe('heroStartCastAnim', () => {
  const hero = () => ({
    x: 0, z: 0, data: { name: 'Ilse', hp: 10, maxHp: 10, classKey: 'wizard' },
    ent: { anim: caster(), grp: { rotation: { y: 0 } } }
  });

  it('plays the whole spellcast toward the target and holds the turn for it', () => {
    const h = hero();
    const fxHold = vi.fn();
    const game = { ...combatMethods, fxHold };
    const dur = game.heroStartCastAnim(h, { x: 3, z: 0 });
    expect(h.ent.anim.state).toBe('spellcast');
    expect(dur).toBeCloseTo(CAST, 5);
    expect(fxHold).toHaveBeenCalledWith(dur);
    expect(h.castAnim).toBe(true);
    expect(h.attackTargetDX).toBeCloseTo(1);
    expect(h.attackTargetDZ).toBeCloseTo(0);
  });

  it('a second fx call inside the same cast turns the caster but never restarts it', () => {
    const h = hero();
    const game = { ...combatMethods, fxHold: vi.fn() };
    game.heroStartCastAnim(h, h);
    h.ent.anim.update(0.4);
    const left = game.heroStartCastAnim(h, { x: 0, z: 2 });
    expect(h.ent.anim.time).toBeCloseTo(0.4, 5);
    expect(left).toBeCloseTo(CAST - 0.4, 5);
    expect(game.fxHold).toHaveBeenCalledTimes(1);
    expect(h.attackTargetDZ).toBeCloseTo(1);
  });

  it('a spell through playAbilityFx plays the cast; a class feature keeps its lunge', () => {
    const h = hero();
    const game = { ...combatMethods, fxHold: vi.fn(), triggerLunge: vi.fn() };
    game.heroAbilityAnim(h, { at: { x: 2, z: 0 }, spell: true });
    expect(h.ent.anim.state).toBe('spellcast');
    expect(game.triggerLunge).not.toHaveBeenCalled();

    const g = hero();
    game.heroAbilityAnim(g, { at: { x: 2, z: 0 } });
    expect(g.ent.anim.state).not.toBe('spellcast');
    expect(game.triggerLunge).toHaveBeenCalledTimes(1);
    expect(g.castAnim).toBe(false);
  });
});

/* ── 1 + 2. the turn waits for the animation ─────────────────────────── */

/* A hero in melee reach of a kobold, everything around the action phase
   stubbed out, so heroCombat runs straight down to its bonus/action phases. */
function arena() {
  const anim = { left: 0, attackRemaining() { return this.left; } };
  const hero = {
    x: 0.5, z: 0.5, data: { name: 'Ilse', hp: 10, maxHp: 10, classKey: 'fighter' },
    ent: { anim }
  };
  const foe = { x: 1.5, z: 0.5, data: { name: 'Kobold', hp: 5, maxHp: 5 } };
  const game = {
    ...combatMethods,
    D: { W: 10 },
    cellOf: (x, z) => Math.floor(z) * 10 + Math.floor(x),
    initiative: { active: true },
    isCurrentActor: e => e === hero,
    controlMode: 'auto',
    fxNow: 5,
    getAbilityUseWeight: () => 1,
    getCombatMovementWeight: () => 0,
    getPotionHpThreshold: () => 0,
    heroAttackProfileFor: () => ({ source: 'weapon', melee: true }),
    runCombatReflexes: vi.fn(),
    heroTacticalAction: () => false,
    faceTowards: vi.fn(),
    refreshHud: vi.fn(),
    heroPostAttackWithdraw: vi.fn(),
    /* the bonus spell (Hex, say): claims the bonus action and starts a cast */
    tryCastBonusSpell: vi.fn(h => {
      if (h._bonusActed) return false;
      h._bonusActed = true;
      anim.left = CAST;
      return true;
    }),
    tryCastKnownSpell: vi.fn(() => true),
  };
  return { game, hero, foe, anim };
}

describe('a bonus action and the action never animate together', () => {
  it('the action waits for the bonus spell to finish casting, then goes', () => {
    const { game, hero, foe, anim } = arena();
    const tick = () => combatMethods.heroCombat.call(game, hero, foe, [hero], 1 / 60);

    tick();                                         // bonus spell cast
    expect(game.tryCastBonusSpell).toHaveBeenCalledTimes(1);
    expect(game.tryCastKnownSpell).not.toHaveBeenCalled();
    expect(hero.actUsed).toBeFalsy();               // the Action is still to come

    tick();                                         // still casting: nothing happens
    expect(game.tryCastBonusSpell).toHaveBeenCalledTimes(1);
    expect(game.tryCastKnownSpell).not.toHaveBeenCalled();

    anim.left = 0;                                  // the cast's last frame
    tick();
    expect(game.tryCastKnownSpell).toHaveBeenCalledTimes(1);
    expect(hero.actUsed).toBe(true);
  });

  it('without a bonus-action animation the action follows in the same frame', () => {
    const { game, hero, foe } = arena();
    game.tryCastBonusSpell = vi.fn(h => { h._bonusActed = true; return true; });   // a potion: no cast
    combatMethods.heroCombat.call(game, hero, foe, [hero], 1 / 60);
    expect(game.tryCastKnownSpell).toHaveBeenCalledTimes(1);
  });
});

describe('a caster does not walk off mid-cast', () => {
  it('a walk queued during the cast holds until the last frame, and counts as moving', () => {
    const { game, hero, foe, anim } = arena();
    game.moveStep = vi.fn(() => true);
    anim.left = 0.5;
    hero.path = [11, 12, 13]; hero.pathI = 1; hero.moveLeft = 4;
    combatMethods.heroCombat.call(game, hero, foe, [hero], 1 / 60);
    expect(game.moveStep).not.toHaveBeenCalled();
    /* moving, so the turn engine cannot end the turn between the cast's last
       frame and the first step */
    expect(hero.moving).toBe(true);

    hero.path = null;
    combatMethods.heroCombat.call(game, hero, foe, [hero], 1 / 60);
    expect(hero.moving).toBe(false);
  });

  it('the turn does not pass while the current hero is still casting', () => {
    const { hero, anim } = arena();
    hero._side = 'hero';
    hero.actUsed = true;
    hero.moving = false;
    anim.left = 0.3;
    const advance = vi.fn();
    const kobold = { active: true, data: { name: 'Kobold', hp: 5 } };
    const game = {
      ...initiativeMethods,
      heroes: [hero],
      monsters: [kobold],
      initiative: { active: true, order: [hero, kobold], idx: 0, timer: 5 },
      _advanceTurn: advance,
      fxHasActiveFX: () => false,
      fxTurnReady: () => true,
      controlMode: 'auto',
    };
    game.updateInitiative(1 / 60);
    expect(advance).not.toHaveBeenCalled();
    anim.left = 0;
    game.updateInitiative(1 / 60);
    expect(advance).toHaveBeenCalled();
  });

  it('holds movement until cast animation, spell charge, projectile flight, AND hit animation all finish', () => {
    const { game, hero, foe, anim } = arena();
    let chargePending = true;
    let projFlying = true;
    let hitPlaying = true;
    game.fxActionBusy = () => chargePending || projFlying || hitPlaying;
    game.heroAvoidOA = () => false;
    game.moveStep = vi.fn(() => true);

    anim.left = CAST;
    hero.path = [11, 12, 13]; hero.pathI = 1; hero.moveLeft = 4;

    /* 1. Cast animation & charge playing */
    combatMethods.heroCombat.call(game, hero, foe, [hero], 1 / 60);
    expect(game.moveStep).not.toHaveBeenCalled();
    expect(hero.moving).toBe(true);

    /* 2. Cast sprite animation and charge finish, projectile still in flight */
    anim.left = 0;
    chargePending = false;
    combatMethods.heroCombat.call(game, hero, foe, [hero], 1 / 60);
    expect(game.moveStep).not.toHaveBeenCalled();
    expect(hero.moving).toBe(true);

    /* 3. Projectile lands, hit/impact animation still playing */
    projFlying = false;
    combatMethods.heroCombat.call(game, hero, foe, [hero], 1 / 60);
    expect(game.moveStep).not.toHaveBeenCalled();
    expect(hero.moving).toBe(true);

    /* 4. Hit animation finishes — caster finally takes their movement step */
    hitPlaying = false;
    combatMethods.heroCombat.call(game, hero, foe, [hero], 1 / 60);
    expect(game.moveStep).toHaveBeenCalledTimes(1);
  });

  it('cantrip heroPerformAttack starts fxSpellCharge at t=0 and releases at SPELL_CHARGE_SECONDS without double-charging', () => {
    const h = {
      x: 0, z: 0, data: { name: 'Lyra', hp: 10, maxHp: 10, classKey: 'wizard' },
      ent: { anim: caster(), grp: { rotation: { y: 0 } } }
    };
    const foe = { x: 4, z: 0, data: { name: 'Goblin', hp: 10, maxHp: 10 } };
    const profile = { source: 'cantrip', melee: false, isSave: true, cantripScale: true, name: 'Fire Bolt', dmgType: 'fire' };
    let delayedRelease = null;
    const fxSpellCharge = vi.fn();
    const fxHold = vi.fn();
    const fxImpactDelay = vi.fn((sec, cb) => { delayedRelease = { sec, cb }; });
    const heroAttackRoll = vi.fn((actor) => {
      expect(actor._cantripPreCharged).toBe(true);
    });
    const game = {
      ...combatMethods,
      fxSpellCharge,
      fxHold,
      fxImpactDelay,
      heroAttackRoll,
    };

    const delaySec = game.heroPerformAttack(h, foe, [h], { profile });
    expect(h.ent.anim.state).toBe('spellcast');
    expect(fxSpellCharge).toHaveBeenCalledTimes(1);
    expect(fxHold).toHaveBeenCalledWith(CAST);
    expect(delaySec).toBeCloseTo(0.5, 5);
    expect(delayedRelease.sec).toBeCloseTo(0.5, 5);
    expect(heroAttackRoll).not.toHaveBeenCalled();

    delayedRelease.cb();
    expect(heroAttackRoll).toHaveBeenCalledTimes(1);
    expect(h._cantripPreCharged).toBeFalsy();
  });
});

/* ── 3. the ray spans caster → target on screen ──────────────────────── */

/** The dungeon camera exactly as render/dungeon_scene.js updateCam builds it. */
function dungeonCamera(yaw, pitch, target = new THREE.Vector3(2, 0, -1)) {
  const cam = new THREE.OrthographicCamera(-20, 20, 12, -12, -400, 800);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  cam.position.copy(target).addScaledVector(new THREE.Vector3(cp * Math.sin(yaw), sp, cp * Math.cos(yaw)), 220);
  cam.lookAt(target);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

const screenOf = (cam, x, y, z) => {
  const v = new THREE.Vector3(x, y, z).project(cam);
  return { x: v.x * 20, y: v.y * 12 };   // back to world units on the ortho frustum
};
const corner = (arr, i) => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];

describe('span ribbon', () => {
  const YAWS = [0, Math.PI / 4, Math.PI / 4 + 0.31, Math.PI / 4 - 0.31, 3 * Math.PI / 4, Math.PI, -Math.PI / 2];
  const PITCHES = [0.44, 0.64, 1.15];
  const from = { x: 0, y: 0.55, z: 0 };
  const TARGETS = [{ x: 4, y: 0.9, z: 1 }, { x: -2, y: 0.9, z: 3 }, { x: 0.5, y: 1.2, z: -5 }, { x: -3, y: 0.9, z: -3 }];

  it('the yaw/pitch basis is the camera\'s own screen axes', () => {
    for (const yaw of YAWS) for (const pitch of PITCHES) {
      const b = cameraBasisFromYawPitch(yaw, pitch);
      const m = cameraBasisFromMatrix(dungeonCamera(yaw, pitch).matrixWorld.elements);
      for (let i = 0; i < 3; i++) {
        expect(b.right[i]).toBeCloseTo(m.right[i], 6);
        expect(b.up[i]).toBeCloseTo(m.up[i], 6);
      }
    }
  });

  it('left edge on the caster, right edge on the target, square to the line, at any camera angle', () => {
    for (const yaw of YAWS) for (const pitch of PITCHES) for (const to of TARGETS) {
      const cam = dungeonCamera(yaw, pitch);
      const { right, up } = cameraBasisFromMatrix(cam.matrixWorld.elements);
      const q = spanRibbon(from, to, right, up, 0.5);
      const P = [0, 1, 2, 3].map(i => screenOf(cam, ...corner(q, i)));
      const F = screenOf(cam, from.x, from.y, from.z);
      const T = screenOf(cam, to.x, to.y, to.z);
      /* edge midpoints sit on the caster and the target */
      expect((P[0].x + P[3].x) / 2).toBeCloseTo(F.x, 4);
      expect((P[0].y + P[3].y) / 2).toBeCloseTo(F.y, 4);
      expect((P[1].x + P[2].x) / 2).toBeCloseTo(T.x, 4);
      expect((P[1].y + P[2].y) / 2).toBeCloseTo(T.y, 4);
      /* the width runs square across the on-screen line, full width */
      const lx = T.x - F.x, ly = T.y - F.y;
      const wx = P[3].x - P[0].x, wy = P[3].y - P[0].y;
      expect(lx * wx + ly * wy).toBeCloseTo(0, 4);
      expect(Math.hypot(wx, wy)).toBeCloseTo(1.0, 4);
      /* and on the left of the line (the frame's top), so the art is never mirrored */
      expect(lx * wy - ly * wx).toBeGreaterThan(0);
      /* the corners lie on the real 3D line, so the ribbon shares the beam's depth */
      const span = screenSpan(from, to, right, up);
      expect(span.length).toBeCloseTo(Math.hypot(lx, ly), 4);
    }
  });

  it('a line pointing straight into the screen degrades to a zero-length ribbon, not NaNs', () => {
    const { right, up } = cameraBasisFromYawPitch(0, 0);   // looking along -Z
    const q = spanRibbon({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -4 }, right, up, 0.5);
    expect(q.every(Number.isFinite)).toBe(true);
  });
});

describe('Span sheet composite', () => {
  it('Ray of Sickness is a live poison beam landing a live hit', () => {
    const { travel, impact } = VFX_ANIMS.rayOfSickness;
    expect(travel.front).toMatchObject({ type: 'live', fx: 'beam', palette: 'poison' });
    expect(impact.front).toMatchObject({ type: 'live', fx: 'hitSpark', palette: 'poison' });
  });

  it('lays the sheet from caster to target and re-aims it for whatever camera draws it', () => {
    const scene = new THREE.Scene();
    const from = new THREE.Vector3(0, 0.55, 0);
    const to = new THREE.Vector3(4, 0.9, 1);
    const off = { enabled: false, type: 'none', color: '#ffffff', scale: 1, dur: 0.3, opacity: 1, blend: 'normal' };
    const spanAnim = {
      travel: { duration: 0.45, arc: 0.1, back: off,
        front: { enabled: true, type: 'sheet', sheet: 'spell_rayOfSickness', span: true, color: '#ffffff', scale: 1, dur: 1.2, opacity: 0.9, blend: 'additive', fps: 30 } },
      impact: { delay: 0, back: off, front: off },
    };
    spawnCompositeAnimation(scene, spanAnim, { from, to, travelSound: false, impactSound: false });
    const ribbon = scene.children.find(o => o.isMesh && typeof o.onBeforeRender === 'function'
      && o.geometry && o.geometry.attributes.position && o.geometry.attributes.position.count === 4);
    expect(ribbon).toBeTruthy();
    expect(ribbon.frustumCulled).toBe(false);

    for (const yaw of [Math.PI / 4, Math.PI / 4 + 0.3, 5 * Math.PI / 4]) {
      const cam = dungeonCamera(yaw, 0.64);
      ribbon.onBeforeRender(null, scene, cam);
      const arr = ribbon.geometry.attributes.position.array;
      const L = screenOf(cam, ...corner(arr, 0)), L2 = screenOf(cam, ...corner(arr, 3));
      const R = screenOf(cam, ...corner(arr, 1)), R2 = screenOf(cam, ...corner(arr, 2));
      const F = screenOf(cam, from.x, from.y, from.z), T = screenOf(cam, to.x, to.y, to.z);
      expect((L.x + L2.x) / 2).toBeCloseTo(F.x, 4);
      expect((L.y + L2.y) / 2).toBeCloseTo(F.y, 4);
      expect((R.x + R2.x) / 2).toBeCloseTo(T.x, 4);
      expect((R.y + R2.y) / 2).toBeCloseTo(T.y, 4);
    }

    /* the travel glow still flies; the ribbon stays put on the line */
    updateCompositeFX(scene, 0.2);
    expect(scene.children).toContain(ribbon);
  });
});
