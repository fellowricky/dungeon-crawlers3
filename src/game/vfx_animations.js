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
  spawnSpriteEffect,
  spawnImpactBurst,
  spawnSlash,
  spawnBeamEffect,
  spawnAoEVisual,
} from './entities.js';
import { playNixieEffect } from '../render/nixie_vfx.js';
import { playSfx } from './audio.js';
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

/** Spawn a single layer's effect at `pos` (one-shot). Beam layers use
 *  beamFrom/beamTo (travel: caster→target; impact: above→target). Returns any
 *  pool entries whose meshes the caller may tween (sheets/sprites/glow/smoke). */
export function spawnLayer(scene, layer, pos, beamFrom = null, beamTo = null, defaultDur = null) {
  if (!layer || !layer.enabled) return [];
  const color = hexColor(layer.color);
  const blend = layer.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
  const scale = layer.scale != null ? layer.scale : 1.5;
  const dur = layer.dur != null ? layer.dur : (defaultDur != null ? defaultDur : 0.5);
  const base = { opacity: layer.opacity != null ? layer.opacity : 1, blend };
  const ro = layer.renderOrder;

  if (layer.type === 'sheet') {
    const def = resolveSheetDef(layer.sheet, layer.fps);
    if (def) return [spawnSheetEffect(scene, def, pos, scale, dur, { ...base, renderOrder: ro })];
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
        spawnSlash(scene, { x: pos.x, z: pos.z }, color, scale);
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

/**
 * Play a composite animation from `from` to `to`.
 * opts: { from, to, travelSound?, impactSound?, skipTravel?, onImpact? }
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

  /* Spells with no travel layers fire their impact immediately — no dead air. */
  const hasTravelLayers = !!(travel.back && travel.back.enabled) || !!(travel.front && travel.front.enabled);
  if (opts.skipTravel || !hasTravelLayers) {
    if (travelSound) travelSound();
    playImpactFor(anim, opts, to);
    fireImpactLayers(scene, anim.impact || {}, to);
    if (opts.onImpact) opts.onImpact(to);
    return null;
  }

  if (travelSound) travelSound();

  const items = [];
  for (const slot of SLOTS) {
    const layer = travel[slot];
    if (!layer || !layer.enabled) continue;
    /* Beams are a fixed caster→target link — not attached to the moving group. */
    const isBeam = layer.type === 'procedural' && layer.kind === 'beam';
    if (isBeam) {
      spawnLayer(scene, layer, to, from, to, dur);
      continue;
    }
    const spawned = spawnLayer(scene, layer, from, from, to, dur);
    for (const s of spawned) if (s && s.mesh) items.push({ mesh: s.mesh });
  }

  travelPool.push({
    scene, from: from.clone(), to: to.clone(), items,
    t: 0, dur, arc: travel.arc || 0,
    impact: anim.impact || {},
    impactSound: opts.impactSound === false
      ? null
      : (opts.impactSound || (anim.impactSound ? () => playSfx(anim.impactSound, { volume: 0.75 }) : null)),
    onImpact: opts.onImpact || null,
  });

  return items.length ? items[0].mesh : null;
}

function fireImpactLayers(scene, impact, to) {
  for (const slot of SLOTS) {
    const layer = impact[slot];
    if (!layer || !layer.enabled) continue;
    const beamFrom = new THREE.Vector3(to.x, 5.5, to.z);
    const beamTo = new THREE.Vector3(to.x, 0.4, to.z);
    spawnLayer(scene, layer, to, beamFrom, beamTo);
  }
}

/** Advance composite animations (travel tween + custom glow/smoke pool).
 *  Called from the game main loop and the editor's render loop. */
export function updateCompositeFX(scene, dt) {
  updateFxPool(scene, dt);
  for (let i = travelPool.length - 1; i >= 0; i--) {
    const T = travelPool[i];
    T.t += dt;
    const k = Math.min(1, T.t / T.dur);
    for (const it of T.items) {
      if (!it.mesh) continue;
      it.mesh.position.lerpVectors(T.from, T.to, k);
      if (T.arc > 0) it.mesh.position.y += Math.sin(k * Math.PI) * T.arc;
    }
    if (k >= 1) {
      if (T.impactSound) T.impactSound();
      fireImpactLayers(T.scene, T.impact, T.to);
      if (T.onImpact) T.onImpact(T.to);
      travelPool.splice(i, 1);
    }
  }
}
