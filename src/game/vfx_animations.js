/**
 * Composite VFX animations — the runtime for the animation editor.
 *
 * An animation is a two-phase effect:
 *   travel  — back/front layers fly from the caster to the target
 *   impact  — back/front layers fire at the target on arrival
 * plus a travel sound and an impact sound. Every layer is either a sprite
 * sheet (Gigapack registry or the custom sheet library), a static sprite,
 * or a procedural effect (particle burst, ground ring, beam, sparkle cube,
 * vines, glow, smoke).
 *
 * Definitions live in vfx_animations.json (authored in /test-skills.html and
 * saved through the /api/save-vfx-anims dev-server endpoint). Layers are
 * depth-stacked: "back" renders under "front" via renderOrder — no positional
 * offsets. The game plays a cantrip's animation from combat.js strike(); the
 * editor previews them with the exact same runtime.
 */

import * as THREE from 'three';
import { configureSpriteMaterial } from './sprite_animator.js';
import { GIGAPACK_REGISTRY } from './gigapack_registry.js';
import {
  spawnSheetEffect,
  spawnSpanSheetEffect,
  spawnSpriteEffect,
  spawnImpactBurst,
  spawnBeamEffect,
  spawnAoEVisual,
} from './entities.js';
import { spawnPixelVfx } from '../render/pixel_vfx.js';
import { updateLivePixelFx, spawnLiveMissile, spawnLiveBeam } from '../render/pixelfx_live.js';
import { PAL } from '../vendor/pixelfx/core/index.js';
import { playNixieEffect } from '../render/nixie_vfx.js';
import { playSfx } from './audio.js';
import { hold } from './fx_clock.js';
import LIB from './vfx_animations.json' with { type: 'json' };

export const VFX_LIB = LIB;
export const VFX_ANIMS = LIB.anims || {};
export const VFX_SHEET_LIBRARY = LIB.sheets || {};
export const CANTRIP_ANIM_BINDINGS = LIB.cantripBindings || {};

/* ── shared soft-glow sprite (procedural `glow` + `smoke`) ─────────────── */

let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(cv);
  _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}

/* Custom glow/smoke pool — self-updating fades, moved by the travel tween. */
const fxPool = [];
function pushFx(scene, mesh, mat, tex, dur, baseOpacity, vel) {
  const e = { mesh, mat, tex, t: 0, dur: Math.max(0.05, dur || 0.5), baseOpacity: baseOpacity ?? 1, vel };
  fxPool.push(e);
  return e;
}

function spawnGlow(scene, pos, color, scale = 1.5, dur = 0.5, opts = {}) {
  const mat = configureSpriteMaterial(new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, depthWrite: false, opacity: 0,
    blending: opts.blend || THREE.AdditiveBlending
  }), { forwardBias: 0.3 });
  const mesh = new THREE.Sprite(mat);
  mesh.scale.set(scale, scale, 1);
  mesh.position.copy(pos);
  mesh.renderOrder = opts.renderOrder != null ? opts.renderOrder : 20;
  scene.add(mesh);
  return pushFx(scene, mesh, mat, mat.map, dur, opts.opacity != null ? opts.opacity : 1, null);
}

function spawnSmoke(scene, pos, color, count = 8, scale = 1.2, dur = 1.0, opts = {}) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const mat = configureSpriteMaterial(new THREE.SpriteMaterial({
      map: glowTexture(), color, transparent: true, depthWrite: false, opacity: 0,
      blending: opts.blend || THREE.AdditiveBlending
    }), { forwardBias: 0.3 });
    const mesh = new THREE.Sprite(mat);
    const s = scale * (0.4 + Math.random() * 0.6);
    mesh.scale.set(s, s, 1);
    const p = pos.clone();
    p.x += (Math.random() - 0.5) * 0.5;
    p.y += (Math.random() - 0.5) * 0.2;
    p.z += (Math.random() - 0.5) * 0.5;
    mesh.position.copy(p);
    mesh.renderOrder = opts.renderOrder != null ? opts.renderOrder : 20;
    scene.add(mesh);
    out.push(pushFx(scene, mesh, mat, mat.map, dur * (0.7 + Math.random() * 0.6),
      opts.opacity != null ? opts.opacity : 0.5,
      { vx: (Math.random() - 0.5) * 0.4, vy: 0.4 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 0.4 }));
  }
  return out;
}

function updateFxPool(scene, dt) {
  for (let i = fxPool.length - 1; i >= 0; i--) {
    const e = fxPool[i];
    e.t += dt;
    if (e.vel) {
      e.mesh.position.x += e.vel.vx * dt;
      e.mesh.position.y += e.vel.vy * dt;
      e.mesh.position.z += e.vel.vz * dt;
      e.vel.vy -= dt * 0.15;
    }
    const k = e.t / e.dur;
    e.mat.opacity = e.baseOpacity * (k < 0.15 ? k / 0.15 : k > 0.75 ? (1 - k) / 0.25 : 1);
    if (k >= 1) {
      scene.remove(e.mesh);
      e.mat.dispose();
      fxPool.splice(i, 1);
    }
  }
}

/* ── helpers ───────────────────────────────────────────────────────────── */

export function hexColor(c) {
  if (c == null) return 0xffffff;
  if (typeof c === 'number') return c;
  const n = parseInt(String(c).replace('#', ''), 16);
  return Number.isFinite(n) ? n : 0xffffff;
}

/** Resolve a sheet reference (`gigapack:<key>` or a custom library id) to a
 *  spawnSheetEffect-compatible def. */
export function resolveSheetDef(ref, fps) {
  if (!ref) return null;
  if (ref.startsWith('gigapack:')) return GIGAPACK_REGISTRY[ref.slice('gigapack:'.length)] || null;
  const custom = VFX_SHEET_LIBRARY[ref];
  if (custom) {
    const def = { ...custom };
    if (fps) def.fps = fps;
    return def;
  }
  return null;
}

const SLOTS = ['back', 'front'];

/** Where a span layer ends: the target, or — with `spanLength` (world units)
 *  — that far from the caster toward it, so an area spell's cone reaches its
 *  real range whoever it was aimed at. */
function spanEnd(layer, from, to) {
  if (!layer.spanLength) return to;
  const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz) || 1;
  return new THREE.Vector3(from.x + dx / d * layer.spanLength, from.y, from.z + dz / d * layer.spanLength);
}

/** A sheet layer drawn as a line from caster to target (`span: true`) rather
 *  than a sprite at one point — for sheets that are themselves a ray, source
 *  on the frame's left edge and tip on its right. See span_ribbon.js. */
export function isSpanLayer(layer) {
  return !!(layer && layer.enabled && ((layer.type === 'sheet' && layer.span) || isLiveBeam(layer)));
}
/** A live-drawn ray (render/pfx/beam.js) from caster to target. */
function isLiveBeam(layer) {
  return layer.type === 'live' && layer.fx === 'beam';
}

/** Spawn a single layer's effect at `pos` (one-shot). Beam layers use
 *  beamFrom/beamTo (travel: caster→target; impact: above→target); span sheets
 *  use spanFrom/spanTo (always caster→target). Returns any pool entries whose
 *  meshes the caller may tween (sheets/sprites/glow/smoke). */
export function spawnLayer(scene, layer, pos, beamFrom = null, beamTo = null, defaultDur = null, spanFrom = null, spanTo = null) {
  if (!layer || !layer.enabled) return [];
  const color = hexColor(layer.color);
  const blend = layer.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
  const scale = layer.scale != null ? layer.scale : 1.5;
  const dur = layer.dur != null ? layer.dur : (defaultDur != null ? defaultDur : 0.5);
  const base = { opacity: layer.opacity != null ? layer.opacity : 1, blend };
  const ro = layer.renderOrder;

  if (layer.type === 'sheet') {
    const def = resolveSheetDef(layer.sheet, layer.fps);
    if (def && layer.span && spanFrom && spanTo) {
      /* Scale is the ray's thickness; its length is the caster→target line. */
      return [spawnSpanSheetEffect(scene, def, spanFrom, spanTo, scale, dur, { ...base, renderOrder: ro })];
    }
    if (def) return [spawnSheetEffect(scene, def, pos, scale, dur, { ...base, renderOrder: ro })];
  } else if (layer.type === 'live') {
    if (isLiveBeam(layer)) {
      spawnLiveBeam(scene, spanFrom || beamFrom || pos, spanTo || beamTo || pos, {
        palette: PAL[layer.palette] || PAL.arcane, width: layer.width || 0.3, duration: dur, opacity: base.opacity,
      });
      return [];
    }
    /* A live-drawn missile (render/pfx/missile.js): `palette` is a pixelfx ramp name. */
    return [spawnLiveMissile(scene, pos, { kind: layer.fx, palette: layer.palette, scale, dur, opacity: base.opacity })];
  } else if (layer.type === 'sprite') {
    const sd = layer.frames
      ? { frames: layer.frames, frameInterval: layer.frameInterval }
      : layer.path;
    if (sd) return [spawnSpriteEffect(scene, sd, pos, scale, dur, { ...base, renderOrder: ro })];
  } else if (layer.type === 'procedural') {
    switch (layer.kind) {
      case 'burst':
        spawnImpactBurst(scene, pos, layer.burstType || 'magic', color, layer.count || 16);
        return [];
      case 'nixie':
        playNixieEffect(layer.nixieEffect || 'fire_burst', pos, { scale, duration: dur });
        return [];
      case 'ring':
        spawnPixelVfx(scene, { type: 'shockwave', pos: { x: pos.x, z: pos.z }, color, radius: scale, duration: dur });
        return [];
      case 'slash':
        spawnPixelVfx(scene, { type: 'slash', pos: { x: pos.x, z: pos.z }, color, radius: scale, rot: layer.rot || 0, duration: dur });
        return [];
      case 'beam':
        if (beamFrom && beamTo) {
          spawnBeamEffect(scene, beamFrom, beamTo, {
            type: layer.beamType || 'ray',
            color,
            width: Math.max(0.2, scale * 0.4),
            duration: dur,
            scrollSpeed: 5,
          });
        }
        return [];
      case 'sparkles':
        spawnAoEVisual(scene, pos, color, layer.radius || 2, Math.max(0.3, dur), { procedural: 'sparkleCube' });
        return [];
      case 'vines':
        spawnAoEVisual(scene, pos, color, layer.radius || 2, Math.max(0.3, dur), { procedural: 'vines' });
        return [];
      case 'glow':
        return [spawnGlow(scene, pos, color, scale, dur, { ...base, renderOrder: ro })];
      case 'smoke':
        return spawnSmoke(scene, pos, color, layer.count || 8, scale, dur, { ...base, renderOrder: ro });
      default:
        return [];
    }
  }
  return [];
}

function playImpactFor(anim, opts, to) {
  if (opts.impactSound === false) return;
  const fn = opts.impactSound || (anim.impactSound ? () => playSfx(anim.impactSound, { volume: 0.75 }) : null);
  if (fn) fn();
}

/* ── travel pool ───────────────────────────────────────────────────────── */

const travelPool = [];

/** Longest span layer in the travel block. A span is laid caster→target the
 *  moment the spell fires and may outlast the flight (a ray that lingers
 *  through the impact), so the turn has to wait for it too. */
function spanDuration(travel, fallback) {
  let longest = 0;
  for (const slot of SLOTS) {
    const layer = travel && travel[slot];
    if (!isSpanLayer(layer)) continue;
    longest = Math.max(longest, layer.dur != null ? layer.dur : fallback);
  }
  return longest;
}

/** Longest layer duration in an impact block — how long the landing reads for.
 *  Mirrors spawnLayer's own default so the two can't disagree. */
function impactDuration(impact) {
  let longest = 0;
  for (const slot of SLOTS) {
    const layer = impact && impact[slot];
    if (!layer || !layer.enabled) continue;
    longest = Math.max(longest, (layer.delay || 0) + (layer.dur != null ? layer.dur : 0.5));
  }
  return longest;
}

/**
 * Play a composite animation from `from` to `to`.
 * opts: { from, to, travelSound?, impactSound?, skipTravel?, onImpact?, groundAt?, curve? }
 *   travelSound/impactSound — override function, or `false` to mute. When
 *   omitted the animation's own sound slots play (travel on launch, impact on
 *   arrival).
 */
export function spawnCompositeAnimation(scene, anim, opts = {}) {
  if (!anim) return null;
  const travel = anim.travel || {};
  const from = opts.from || new THREE.Vector3(-3, 0.55, 0);
  const to = opts.to || new THREE.Vector3(3, 0.55, 0);
  const dur = Math.max(0.05, travel.duration != null ? travel.duration : 0.6);

  const travelSound = opts.travelSound === false
    ? null
    : (opts.travelSound || (anim.travelSound ? () => playSfx(anim.travelSound, { volume: 0.4 }) : null));

  const impactDur = impactDuration(anim.impact);

  /* Spells with no travel layers fire their impact immediately — no dead air. */
  const hasTravelLayers = !!(travel.back && travel.back.enabled) || !!(travel.front && travel.front.enabled);
  if (opts.skipTravel || !hasTravelLayers) {
    /* Hold the turn for the impact alone — there is no flight to wait through. */
    hold(impactDur);
    if (travelSound) travelSound();
    fireImpactLayers(scene, anim.impact || {}, to, from, opts.groundAt);
    /* `hitAt` (seconds): the blow lands partway through a built-up impact
       (Sacred Flame: the blessing opens, the hit comes with the flames). */
    const land = () => {
      playImpactFor(anim, opts, to);
      if (opts.onImpact) opts.onImpact(to);
    };
    const hitAt = (anim.impact && anim.impact.hitAt) || 0;
    if (hitAt > 0 && !opts.skipTravel) delayedLayers.push({ t: hitAt, fire: land });
    else land();
    return null;
  }

  /* The whole effect reads as one beat: the bolt flies, THEN it lands. Holding
     the sum is what stops the next combatant acting over a spell in flight —
     the specific bug this system exists for. */
  hold(Math.max(dur + impactDur, spanDuration(travel, dur)));

  if (travelSound) travelSound();

  const items = [];
  for (const slot of SLOTS) {
    const layer = travel[slot];
    if (!layer || !layer.enabled) continue;
    /* Beams and span sheets are a fixed caster→target link — not attached to
       the moving group. */
    const isBeam = layer.type === 'procedural' && layer.kind === 'beam';
    if (isBeam || isSpanLayer(layer)) {
      spawnLayer(scene, layer, to, from, to, dur, from, spanEnd(layer, from, to));
      continue;
    }
    const spawned = spawnLayer(scene, layer, from, from, to, dur);
    for (const s of spawned) if (s && s.mesh) items.push({ mesh: s.mesh, mat: s.mat, orient: !!layer.orient });
  }

  const T = {
    scene, from: from.clone(), to: to.clone(), items,
    /* Optional live target: while the effect is in flight its destination is
       re-read from this entity each frame, so a target that moves (knockback,
       its own turn, a pull) still gets hit instead of the effect landing in
       the square it used to occupy. */
    follow: opts.follow || null,
    t: 0, dur, arc: travel.arc || 0,
    /* `fan` { side, up }: each bolt leaves on its own bend, swinging out to a
       random side before curling in, so a volley reads as separate bolts. */
    curve: opts.curve || (travel.fan ? {
      side: (Math.random() < 0.5 ? -1 : 1) * travel.fan.side * (0.5 + Math.random() * 0.8),
      up: travel.fan.up * (0.5 + Math.random() * 0.8),
    } : null),
    impact: anim.impact || {},
    groundAt: opts.groundAt || null,
    impactSound: opts.impactSound === false
      ? null
      : (opts.impactSound || (anim.impactSound ? () => playSfx(anim.impactSound, { volume: 0.75 }) : null)),
    onImpact: opts.onImpact || null,
  };
  travelPool.push(T);

  /* `orient` layers are drawn facing right (a bolt with its tail behind it);
     turn them every frame to the flight's heading as the camera sees it, so
     the head always leads whichever way the camera looks — and on an arc it
     noses up out of the cast and dives into the target. */
  for (const it of items) {
    if (!it.orient || !it.mat) continue;
    it.mesh.onBeforeRender = (_r, _s, camera) => {
      const k = Math.min(0.99, T.t / T.dur);
      flightPos(T, k + 0.01, _ahead);
      flightPos(T, k, _behind);
      it.mat.rotation = screenAngle(_behind, _ahead, camera);
    };
  }

  return items.length ? items[0].mesh : null;
}

const _ahead = new THREE.Vector3(), _behind = new THREE.Vector3();
/** Where the flight is at progress k: the straight line lifted by `arc`, or,
 *  with `curve` { side, up } (a Magic Missile dart swinging out to one side),
 *  a bend through a point `side` across the line and `up` above its middle. */
function flightPos(T, k, out) {
  if (T.curve) {
    const dx = T.to.x - T.from.x, dz = T.to.z - T.from.z, len = Math.hypot(dx, dz) || 1;
    const u = 1 - k, a = u * u, b = 2 * u * k, c = k * k;
    return out.set(
      a * T.from.x + b * ((T.from.x + T.to.x) / 2 + (-dz / len) * T.curve.side) + c * T.to.x,
      a * T.from.y + b * ((T.from.y + T.to.y) / 2 + (T.curve.up || 0)) + c * T.to.y,
      a * T.from.z + b * ((T.from.z + T.to.z) / 2 + (dx / len) * T.curve.side) + c * T.to.z);
  }
  out.lerpVectors(T.from, T.to, k);
  if (T.arc > 0) out.y += Math.sin(k * Math.PI) * T.arc;
  return out;
}

const _saA = new THREE.Vector3(), _saB = new THREE.Vector3();
/** On-screen angle (radians, counter-clockwise from screen right) of the line from → to. */
function screenAngle(from, to, camera) {
  _saA.copy(from).project(camera);
  _saB.copy(to).project(camera);
  /* NDC is squashed to a square; stretch x back by the view's width:height
     (the game's camera is orthographic, the editor's was perspective). */
  const aspect = camera.isOrthographicCamera
    ? (camera.right - camera.left) / (camera.top - camera.bottom)
    : (camera.aspect || 1);
  return Math.atan2(_saB.y - _saA.y, (_saB.x - _saA.x) * aspect);
}

/** `groundAt(x, z)` is the floor height for `ground` layers (a blast whose
 *  sheet pivot is its floor line); without it the floor is y = 0. */
function fireImpactLayers(scene, impact, to, from = null, groundAt = null) {
  for (const slot of SLOTS) {
    const layer = impact[slot];
    if (!layer || !layer.enabled) continue;
    const beamFrom = new THREE.Vector3(to.x, 5.5, to.z);
    const beamTo = new THREE.Vector3(to.x, 0.4, to.z);
    const pos = layer.ground ? new THREE.Vector3(to.x, groundAt ? groundAt(to.x, to.z) : 0, to.z) : to;
    /* `delay` (seconds) staggers a layer after the landing: Sleep's rune
       circle turns first, its Zs drift up a beat later. */
    if (layer.delay > 0) delayedLayers.push({ t: layer.delay, fire: () => spawnLayer(scene, layer, pos, beamFrom, beamTo, null, from, to) });
    else spawnLayer(scene, layer, pos, beamFrom, beamTo, null, from, to);
  }
}
const delayedLayers = [];

/** True while any composite projectile travel or delayed impact layer is still active. */
export function hasActiveCompositeFX() {
  return travelPool.length > 0 || delayedLayers.length > 0;
}

/** Advance composite animations (travel tween + custom glow/smoke pool).
 *  Called from the game main loop and the editor's render loop. */
export function updateCompositeFX(scene, dt) {
  updateFxPool(scene, dt);
  updateLivePixelFx(dt);
  for (let i = delayedLayers.length - 1; i >= 0; i--) {
    if ((delayedLayers[i].t -= dt) > 0) continue;
    const { fire } = delayedLayers[i];
    delayedLayers.splice(i, 1);
    fire();
  }
  for (let i = travelPool.length - 1; i >= 0; i--) {
    const T = travelPool[i];
    T.t += dt;
    if (T.follow && T.follow.data && T.follow.data.hp > 0 && !T.follow.dead) {
      T.to.x = T.follow.x;
      T.to.z = T.follow.z;
    }
    const k = Math.min(1, T.t / T.dur);
    for (const it of T.items) {
      if (!it.mesh) continue;
      flightPos(T, k, it.mesh.position);
    }
    if (k >= 1) {
      if (T.impactSound) T.impactSound();
      fireImpactLayers(T.scene, T.impact, T.to, T.from, T.groundAt);
      if (T.onImpact) T.onImpact(T.to);
      travelPool.splice(i, 1);
    }
  }
}
