/**
 * Live pixelfx effects — a pixelfx module drawn every frame into a canvas
 * texture on a sprite, for effects that hang around longer than any sprite
 * sheet should loop (Call Lightning's storm cloud). Baked sheets are still
 * the right tool for one-shots; this is for persistent, never-repeating ones.
 *
 * The vendored pixelfx core (src/vendor/pixelfx, MIT) does the drawing: the
 * module paints colour + light buffers, `composite` flattens them onto a
 * transparent canvas, and the texture is re-uploaded at DRAW_HZ. The sprite
 * stands on the effect's own origin (meta.origin — a cloud's floor point) and
 * is sized at `pxPerUnit` art pixels per world unit.
 *
 * Ticked from updateCompositeFX (game loop and VFX editor); cleared with the
 * rest of the world fx when a level unloads.
 */

import * as THREE from 'three';
import { createFrame, clearFrame, createFx, composite, PAL } from '../vendor/pixelfx/core/index.js';
import { configureSpriteMaterial } from '../game/sprite_animator.js';
import * as beamFx from './pfx/beam.js';
import * as missileFx from './pfx/missile.js';
import * as lightMoteFx from './pfx/light_mote.js';
import * as magicMissileFx from './pfx/magic_missile.js';
import * as manaBurstFx from '../vendor/pixelfx/fx/arcane/mana-burst.js';
import { spanRibbon, screenSpan, cameraBasisFromMatrix } from '../game/span_ribbon.js';

/* Art redraws per second. The pixel art itself moves at 30 fps, but 20 reads
   the same at game zoom and spares a third of the CPU (~3.4 ms per draw for
   the storm cloud). */
const DRAW_HZ = 20;
const FADE_IN = 0.6, FADE_OUT = 0.8;
const live = [];

/**
 * Spawn a live effect. opts: { pos: Vector3 (the effect's origin, e.g. the
 * floor point under a cloud), pxPerUnit = 24, options (the module's own
 * options), opacity = 1, renderOrder = 30, parent = scene, margin = 0 (art
 * px of extra canvas round the effect's authored size), fadeIn = 0.6 s,
 * beforeDraw(options) (called before each redraw — a body effect rebuilds its
 * figure there), holdAt (seconds: a one-shot freezes there until remove(),
 * then plays out its ending — Petrified holds as stone, then shatters),
 * anchorArt [x, y] (art px from the origin that sits on `pos` instead of the
 * origin itself), life (seconds until it removes itself), fadeOut (seconds),
 * headStart (seconds of the effect to skip), speed (clock multiplier), hz (redraws a second) }. With a parent (a creature's group) `pos` is local to it,
 * and the effect follows and scales with that creature. One-shot modules
 * remove themselves when they finish.
 * Returns a handle: { mesh, options, moveTo(x, y, z, seconds), flash(k), remove() }.
 */
export function spawnLivePixelFx(scene, mod, opts = {}) {
  const m = opts.margin || 0;
  const W = mod.meta.size[0] + 2 * m, H = mod.meta.size[1] + 2 * m;
  const OX = mod.meta.origin[0] + m, OY = mod.meta.origin[1] + m;
  const frame = createFrame(W, H);
  const fx = createFx(mod, { ...(opts.options || {}), x: OX, y: OY });
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;

  const mat = configureSpriteMaterial(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, opacity: 0,
  }), { forwardBias: 0.3 });
  mat.toneMapped = false;
  const mesh = new THREE.Sprite(mat);
  const ppu = opts.pxPerUnit || 24;
  mesh.scale.set(W / ppu, H / ppu, 1);
  const [ax, ay] = opts.anchorArt || [0, 0];
  mesh.center.set((OX + ax) / W, 1 - (OY + ay) / H);
  if (opts.pos) mesh.position.copy(opts.pos);
  mesh.renderOrder = opts.renderOrder != null ? opts.renderOrder : 30;
  const parent = opts.parent || scene;
  parent.add(mesh);

  if (opts.headStart) fx.update(opts.headStart);
  const e = {
    life: opts.life != null ? opts.life : null, fadeOutDur: opts.fadeOut != null ? opts.fadeOut : FADE_OUT,
    parent, mesh, mat, tex, ctx, img, frame, fx,
    t: 0, acc: 1 / DRAW_HZ, baseOpacity: opts.opacity != null ? opts.opacity : 1,
    fadeIn: 0, fadeInDur: opts.fadeIn != null ? opts.fadeIn : FADE_IN,
    removing: false, fadeOut: 0, glide: null, flashK: 0, beforeDraw: opts.beforeDraw || null,
    hz: opts.hz || DRAW_HZ, speed: opts.speed || 1,
    holdAt: opts.holdAt != null ? opts.holdAt : null, released: false,
  };
  live.push(e);

  return {
    mesh,
    options: fx.options,
    /** Glide the effect's origin to (x, y, z) over `seconds` (eased). */
    moveTo(x, y, z, seconds = 0.5) {
      e.glide = { from: mesh.position.clone(), to: new THREE.Vector3(x, y, z), t: 0, dur: Math.max(0.01, seconds) };
    },
    /** Light it up from inside (the module's `flash` option), decaying over ~0.4 s. */
    flash(k = 1) { e.flashK = Math.max(e.flashK, k); },
    /** Fade out, then dispose — or, for a held one-shot, play out its ending first. */
    remove() {
      if (e.holdAt != null && !e.released) e.released = true;
      else e.removing = true;
    },
  };
}

/* ── missiles ────────────────────────────────────────────────────────────
   A live missile for a composite's travel layer: the travel tween moves the
   sprite, and each draw notes where it is and turns its recent path into art
   px from the head, across the view of the camera that is drawing it, so the
   tail traces the real flight from any angle. */
const MISSILE_PX_PER_UNIT = 30;     // the head (about 8 art px) reads ~0.25 units wide
const MISSILE_TRAIL = 22;           // draws of history

/** opts: { kind ('magicMissile', else the arcane missile), palette (a PAL name), scale (size multiplier), dur, seed }. Returns { mesh, mat }. */
export function spawnLiveMissile(scene, pos, opts = {}) {
  const ppu = MISSILE_PX_PER_UNIT / (opts.scale || 1);
  const seen = [];
  let right = [1, 0, 0], up = [0, 1, 0];
  const fx = spawnLivePixelFx(scene, opts.kind === 'magicMissile' ? magicMissileFx : missileFx, {
    pos, pxPerUnit: ppu, fadeIn: 0.02, life: opts.dur || 0.6, fadeOut: 0.06, hz: 30, renderOrder: 40,
    opacity: opts.opacity,
    options: { palette: PAL[opts.palette] || PAL.arcane, seed: opts.seed != null ? opts.seed : Math.floor(Math.random() * 1000), trail: [] },
    beforeDraw(o) {
      const h = fx.mesh.position, out = [[0, 0]];
      for (let i = seen.length - 1; i >= 0; i--) {
        const dx = seen[i].x - h.x, dy = seen[i].y - h.y, dz = seen[i].z - h.z;
        const ax = (dx * right[0] + dy * right[1] + dz * right[2]) * ppu;
        const ay = -(dx * up[0] + dy * up[1] + dz * up[2]) * ppu;
        if (Math.hypot(ax, ay) > 66) break;     // the tail ends at the canvas edge
        out.push([ax, ay]);
      }
      o.trail = out;
    },
  });
  fx.mesh.onBeforeRender = (_r, _s, camera) => {
    const b = cameraBasisFromMatrix(camera.matrixWorld.elements);
    right = b.right; up = b.up;
    const last = seen[seen.length - 1], p = fx.mesh.position;
    if (!last || last.distanceToSquared(p) > 1e-4) seen.push(p.clone());
    if (seen.length > MISSILE_TRAIL) seen.shift();
  };
  return { mesh: fx.mesh, mat: fx.mesh.material };
}

/** pixelfx's Mana Burst standing on the floor point `pos`, whole at its authored 1.8 s, in `palette`. */
export function spawnManaBurst(scene, pos, palette) {
  return spawnLivePixelFx(scene, manaBurstFx, {
    pos, pxPerUnit: 38 / 1.1, fadeIn: 0.01, life: 1.8, fadeOut: 0.1, hz: 30, renderOrder: 40, options: { palette },
  });
}

/** The Light cantrip's mote, drawn pixel for pixel with the hero sprite. Lives
 *  until removed; the caller moves `.mesh`. Returns the live effect. */
export function spawnLightMote(scene, pos) {
  return spawnLivePixelFx(scene, lightMoteFx, {
    pos, pxPerUnit: 38 / 1.1, fadeIn: 0.3, options: { seed: Math.random() * 3 },
  });
}

/* ── beams ───────────────────────────────────────────────────────────────
   One canvas per beam, sized to its length in art px, laid on a ribbon along
   the real 3D line from caster to target (span_ribbon.js) — its long axis the
   line itself, its width across it in the view plane, rebuilt from the
   rendering camera every draw. A camera-facing card would dip under the floor
   toward its far end; the ribbon stays on the line from any yaw or pitch. */

const BEAM_HZ = 30;              // pulses race down a beam: redraw faster than auras
const BEAM_PAD = 44;             // art px round the beam for its end flare and sparks
const BEAM_H = 96;
const BEAM_CORE_PX = 15.6;       // the core's authored thickness (2 x 6 px x 1.3)
const BEAM_SHOOT = 0.12;         // seconds for the beam to shoot out to its target

/**
 * A beam from `from` to `to` (world). opts: { palette, flow = 1 (-1: a drain,
 * pulses running back into the caster), jag = 0 (lightning crackle), width
 * (world thickness of the core, as the old beams' `width`), duration, seed }.
 */
export function spawnLiveBeam(scene, from, to, opts = {}) {
  const width = opts.width || 0.45;
  const ppu = BEAM_CORE_PX / width;                       // art px per world unit, from the beam's thickness
  const dist = from.distanceTo(to);
  const L = Math.max(16, Math.min(1400, Math.round(dist * ppu)));
  const W = L + BEAM_PAD * 2, H = BEAM_H;
  const frame = createFrame(W, H);
  const fx = createFx(beamFx, {
    x: BEAM_PAD, y: H / 2, length: L, reach: 0,
    palette: opts.palette, flow: opts.flow || 1, jag: opts.jag || 0,
    seed: opts.seed != null ? opts.seed : Math.floor(Math.random() * 1000),
  });
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide });
  mat.toneMapped = false;

  /* the canvas margin carried past both ends, along the line */
  const dir = to.clone().sub(from).normalize(), padW = BEAM_PAD * (dist / L);
  const A = from.clone().addScaledVector(dir, -padW), B = to.clone().addScaledVector(dir, padW);
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(new Float32Array(12), 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;                             // its vertices are rewritten per draw
  mesh.renderOrder = 40;
  const lay = (camera) => {
    const b = cameraBasisFromMatrix(camera.matrixWorld.elements);
    /* width from the beam's on-screen length, so its pixels stay square however it recedes */
    const across = screenSpan(from, to, b.right, b.up).length;
    spanRibbon(A, B, b.right, b.up, (H / 2) * (across / L), posAttr.array);
    posAttr.needsUpdate = true;
  };
  lay({ matrixWorld: new THREE.Matrix4().makeRotationY(Math.PI / 4) });
  mesh.onBeforeRender = (_r, _s, camera) => lay(camera);
  scene.add(mesh);
  live.push({
    parent: scene, mesh, mat, tex, geo, ctx, img, frame, fx, beam: true,
    t: 0, acc: 1, dur: opts.duration || 0.55, baseOpacity: opts.opacity != null ? opts.opacity : 1,
  });
}

/** One beam's frame: shoot out, hold, fade; true when it's gone. */
function updateBeam(e, dt) {
  e.t += dt;
  const k = e.t / e.dur;
  e.mat.opacity = e.baseOpacity * (k < 0.85 ? 1 : Math.max(0, (1 - k) / 0.15));
  if (k >= 1) return true;
  e.acc += dt;
  if (e.acc < 1 / BEAM_HZ) return false;
  e.fx.options.reach = Math.min(1, e.t / BEAM_SHOOT);
  e.fx.update(e.acc);
  e.acc = 0;
  clearFrame(e.frame);
  e.fx.draw(e.frame);
  composite(e.frame, e.img.data, null);
  e.ctx.putImageData(e.img, 0, 0);
  e.tex.needsUpdate = true;
  return false;
}

function disposeEntry(e) {
  e.parent.remove(e.mesh);
  e.mat.dispose();
  e.tex.dispose();
  if (e.geo) e.geo.dispose();
}

/** Advance, redraw and fade every live effect. */
export function updateLivePixelFx(dt) {
  for (let i = live.length - 1; i >= 0; i--) {
    const e = live[i];
    if (e.beam) {
      if (updateBeam(e, dt)) { disposeEntry(e); live.splice(i, 1); }
      continue;
    }
    e.t += dt;
    if (e.glide) {
      const g = e.glide;
      g.t += dt;
      const k = Math.min(1, g.t / g.dur), s = k * k * (3 - 2 * k);
      e.mesh.position.lerpVectors(g.from, g.to, s);
      if (k >= 1) e.glide = null;
    }
    if (e.life != null && !e.removing && (e.life -= dt) <= 0) e.removing = true;
    if (e.removing) e.fadeOut += dt;
    else e.fadeIn = Math.min(e.fadeInDur, e.fadeIn + dt);
    const fade = e.removing ? Math.max(0, 1 - e.fadeOut / e.fadeOutDur) : (e.fadeInDur > 0 ? e.fadeIn / e.fadeInDur : 1);
    e.mat.opacity = e.baseOpacity * fade;
    if (e.removing && e.fadeOut >= e.fadeOutDur) {
      disposeEntry(e);
      live.splice(i, 1);
      continue;
    }

    if (e.flashK > 0) {
      e.fx.options.flash = e.flashK;
      e.flashK = Math.max(0, e.flashK - dt * 2.5);
    } else if (e.fx.options.flash) {
      e.fx.options.flash = 0;
    }

    e.acc += dt;
    if (e.acc < 1 / e.hz) continue;
    /* a held one-shot stops at its hold point until released */
    const step = e.holdAt != null && !e.released ? Math.min(e.acc, Math.max(0, e.holdAt - e.fx.t)) : e.acc;
    if (step > 0) e.fx.update(step * e.speed);
    e.acc = 0;
    if (!e.removing && !e.fx.meta.loop && e.fx.done()) e.removing = true;
    if (e.beforeDraw) e.beforeDraw(e.fx.options);
    clearFrame(e.frame);
    e.fx.draw(e.frame);
    composite(e.frame, e.img.data, null);
    e.ctx.putImageData(e.img, 0, 0);
    e.tex.needsUpdate = true;
  }
}

/** Drop every live effect at once (level unload). */
export function clearLivePixelFx() {
  for (const e of live) disposeEntry(e);
  live.length = 0;
}
