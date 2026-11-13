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
import { createFrame, clearFrame, createFx, composite, PAL, ease } from '../vendor/pixelfx/core/index.js';
import { configureSpriteMaterial } from '../game/sprite_animator.js';
import * as beamFx from './pfx/beam.js';
import { drapeGeometry } from './drape.js';
import * as missileFx from './pfx/missile.js';
import * as lightMoteFx from './pfx/light_mote.js';
import * as magicMissileFx from './pfx/magic_missile.js';
import * as manaBurstFx from '../vendor/pixelfx/fx/arcane/mana-burst.js';
import * as plasmaExplosionFx from '../vendor/pixelfx/fx/explosions/plasma-explosion.js';
import * as snowflakeBurstFx from '../vendor/pixelfx/fx/ice/snowflake-burst.js';
import * as zapHitFx from '../vendor/pixelfx/fx/lightning/zap-hit.js';
import * as geyserFx from '../vendor/pixelfx/fx/water/geyser.js';
import * as weedTuftFx from './pfx/weed_tuft.js';
import * as thunderclapFx from './pfx/thunderclap.js';
import * as shockRingFx from './pfx/shock_ring.js';
import * as wardCircleFx from './pfx/ward_circle.js';
import * as hadarPortalFx from './pfx/hadar_portal.js';
import * as magicMissileHitFx from './pfx/magic_missile_hit.js';
import * as hitSparkFx from '../vendor/pixelfx/fx/impacts/hit-spark.js';
import * as critHitFx from '../vendor/pixelfx/fx/impacts/crit-hit.js';
import * as bluntHitFx from '../vendor/pixelfx/fx/impacts/blunt-hit.js';
import * as scytheReapFx from '../vendor/pixelfx/fx/melee/scythe-reap.js';
import * as heavyCleaveFx from '../vendor/pixelfx/fx/melee/heavy-cleave.js';
import * as smiteFx from '../vendor/pixelfx/fx/holy/smite.js';
import * as faerieSparkleFx from './pfx/faerie_sparkle.js';
import * as faerieStarsFx from './pfx/faerie_stars.js';
import * as greaseSlickFx from './pfx/grease_slick.js';
import * as flamingSphereFx from './pfx/flaming_sphere.js';
import * as damagePopFx from './pfx/damage_pop.js';
import * as critPopFx from './pfx/crit_pop.js';
import * as coinCollectFx from './pfx/coin_collect.js';
import { rampForType, TYPE_RAMPS } from './pfx/damage_badge.js';
import { usesTypeColour, coinsForGold, pickCritSlot, CRIT_SLOTS } from '../game/damage_float.js';
import { spawnMoonbeamCone } from './moonbeam_cone.js';
import * as moonbeamPoolFx from './pfx/moonbeam_pool.js';
import * as softMoteFx from './pfx/soft_mote.js';
import * as liveArrowFx from './pfx/live_arrow.js';
import * as acidSplatFx from './pfx/acid_splat.js';
import { RAMPS, rampFrom } from './pfx/ramps.js';
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
 * headStart (seconds of the effect to skip), speed (clock multiplier), hz (redraws a second),
 * flat (lie on the ground instead of facing the camera, for an effect drawn straight
 * down: it holds true as the camera turns; `pos` is its centre, and `anchorArt` doesn't apply),
 * heightAt(x, z) (with flat: the world floor height, and the sheet drapes over it), additive (adds light rather than paints), overlay (never hidden by the world) }. With a parent (a creature's group) `pos` is local to it,
 * and the effect follows and scales with that creature. One-shot modules
 * remove themselves when they finish.
 * Returns a handle: { mesh, options, moveTo(x, y, z, seconds), flash(k), remove() }.
 */
const FLAT_PLANE = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const DRAPE_SPACING = 0.1;   // world units between a draped sheet's vertices
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

  const mat = opts.flat
    ? new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, opacity: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    })
    : configureSpriteMaterial(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, opacity: 0,
    }), { forwardBias: 0.3 });
  mat.toneMapped = false;
  if (opts.overlay) mat.depthTest = false;   // drawn over the world, never hidden by it: floating numbers
  if (opts.additive) mat.blending = THREE.AdditiveBlending;   // it adds light to what's behind it instead of painting over it
  const ppu = opts.pxPerUnit || 24;
  let geo = null;
  if (opts.flat && opts.heightAt) {
    geo = new THREE.PlaneGeometry(W / ppu, H / ppu, Math.ceil(W / ppu / DRAPE_SPACING), Math.ceil(H / ppu / DRAPE_SPACING)).rotateX(-Math.PI / 2);
    drapeGeometry(geo, opts.pos.x, opts.pos.z, 0, opts.heightAt);
  }
  const mesh = opts.flat ? new THREE.Mesh(geo || FLAT_PLANE, mat) : new THREE.Sprite(mat);
  if (geo) {
    /* the vertices carry the height, so the mesh itself sits at floor zero */
  } else if (opts.flat) {
    mesh.scale.set(W / ppu, 1, H / ppu);
  } else {
    mesh.scale.set(W / ppu, H / ppu, 1);
    const [ax, ay] = opts.anchorArt || [0, 0];
    mesh.center.set((OX + ax) / W, 1 - (OY + ay) / H);
  }
  if (opts.pos) mesh.position.copy(opts.pos);
  if (geo) mesh.position.y = 0;
  mesh.renderOrder = opts.renderOrder != null ? opts.renderOrder : 30;
  const parent = opts.parent || scene;
  parent.add(mesh);

  if (opts.headStart) fx.update(opts.headStart);
  const e = {
    life: opts.life != null ? opts.life : null, fadeOutDur: opts.fadeOut != null ? opts.fadeOut : FADE_OUT,
    parent, mesh, mat, tex, ctx, img, frame, fx, geo,
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

/** opts: { kind ('magicMissile', 'magicRibbon', 'softMote', else the arcane missile), palette (a PAL name), scale (size multiplier), dur, seed }. Returns { mesh, mat }. */
export function spawnLiveMissile(scene, pos, opts = {}) {
  const ppu = MISSILE_PX_PER_UNIT / (opts.scale || 1);
  const seen = [];
  let right = [1, 0, 0], up = [0, 1, 0];
  const mod = opts.kind === 'softMote' ? softMoteFx : opts.kind === 'arrow' ? liveArrowFx
    : opts.kind === 'magicMissile' || opts.kind === 'magicRibbon' ? magicMissileFx : missileFx;
  const fx = spawnLivePixelFx(scene, mod, {
    pos, pxPerUnit: ppu, fadeIn: 0.02, life: opts.dur || 0.6, fadeOut: 0.06, hz: 30, renderOrder: opts.renderOrder != null ? opts.renderOrder : 40,
    opacity: opts.opacity,
    options: { palette: PAL[opts.palette] || PAL.arcane, seed: opts.seed != null ? opts.seed : Math.floor(Math.random() * 1000), trail: [], noOrb: opts.kind === 'magicRibbon' },
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

/** The Live Effect tab's Impacts: one-shots an impact layer plays where a spell lands. */
export const LIVE_IMPACTS = {
  magicMissileHit: { label: 'Magic Missile Hit', mod: magicMissileHitFx },
  hitSpark: { label: 'Hit Spark', mod: hitSparkFx },
  critHit: { label: 'Critical Hit', mod: critHitFx },
  bluntHit: { label: 'Blunt Hit', mod: bluntHitFx },
};

/** LIVE_IMPACTS[fx] at `pos`, whole at its authored length. opts: { palette (a PAL name, else its own colours),
 *  scale, opacity, renderOrder }. Some are drawn `height` px over their floor point, so that height is what meets `pos`. */
export function spawnLiveImpact(scene, fx, pos, opts = {}) {
  const { mod } = LIVE_IMPACTS[fx], height = mod.meta.options.height || 0;
  return spawnLivePixelFx(scene, mod, {
    pos, pxPerUnit: (38 / 1.1) / (opts.scale || 1), anchorArt: [0, -height],
    fadeIn: 0.01, fadeOut: 0.1, hz: 30, renderOrder: opts.renderOrder != null ? opts.renderOrder : 40, opacity: opts.opacity,
    options: PAL[opts.palette] ? { palette: PAL[opts.palette] } : {},
  });
}

/** Acid Arrow bursting as liquid at `pos`, `floorBelow` world units over the floor, its gobs carrying on the way the
 *  arrow was going: away from `from` { x, z }, as seen on screen. The art throws them to its right. */
export function spawnAcidSplat(scene, pos, floorBelow, from) {
  const ppu = 38 / 1.1;
  const fx = spawnLivePixelFx(scene, acidSplatFx, {
    pos, pxPerUnit: ppu, fadeIn: 0.01, fadeOut: 0.1, hz: 30, renderOrder: 40, options: { floor: floorBelow * ppu, seed: Math.floor(Math.random() * 1000) },
  });
  fx.mesh.onBeforeRender = (_r, _s, camera) => {
    const { right } = cameraBasisFromMatrix(camera.matrixWorld.elements);
    fx.options.flip = (pos.x - from.x) * right[0] + (pos.z - from.z) * right[2] < 0;
  };
  return fx;
}

/** pixelfx's Scythe Reap in blood, standing on the floor point `pos`, whole at its authored 2.1 s.
 *  It sweeps from the side `caster` { x, z } is on as seen on screen, whichever way the camera
 *  has turned; the art starts on its right. `size` scales it. */
export function spawnScytheReap(scene, pos, caster, size = 1) {
  const fx = spawnLivePixelFx(scene, scytheReapFx, {
    pos, pxPerUnit: (38 / 1.1) / size, fadeIn: 0.01, fadeOut: 0.1, hz: 30, renderOrder: 40, options: { palette: PAL.blood },
  });
  fx.mesh.onBeforeRender = (_r, _s, camera) => {
    const { right } = cameraBasisFromMatrix(camera.matrixWorld.elements);
    fx.options.flip = (caster.x - pos.x) * right[0] + (caster.z - pos.z) * right[2] < 0;
  };
  return fx;
}

/* Art px to a world unit: its ring's reach then is the spell's 3-tile radius. spells.js times its blows from these. */
const THUNDERWAVE_PX_PER_UNIT = 38 / 1.1, THUNDERCLAP_RING_DELAY = 0.12;
/** Thunderwave round (x, z): Thunderclap standing on the floor, and when it claps, its shock ring laid flat over the level. */
export function spawnThunderclap(scene, x, z, floorY, surfaceAt, later) {
  spawnLivePixelFx(scene, thunderclapFx, {
    pos: new THREE.Vector3(x, floorY(x, z), z), pxPerUnit: THUNDERWAVE_PX_PER_UNIT,
    fadeIn: 0.01, fadeOut: 0.1, hz: 30, renderOrder: 40, options: { palette: PAL.electric },
  });
  later(THUNDERCLAP_RING_DELAY, () => spawnLivePixelFx(scene, shockRingFx, {
    pos: new THREE.Vector3(x, 0, z), pxPerUnit: THUNDERWAVE_PX_PER_UNIT, flat: true, heightAt: surfaceAt,
    fadeIn: 0.01, fadeOut: 0.05, hz: 30, renderOrder: 1,
  }));
}

/** Thunderous Smite's swing: pixelfx's Heavy Cleave in electric at the striker's feet `pos`, swinging toward
 *  `toward` { x, z } as seen on screen; its art swings to its right. `headStart` skips into it. */
export const SMITE_CLEAVE_SLAM = 0.335;   // when its arc hits
export function spawnSmiteCleave(scene, pos, toward, headStart = 0) {
  const fx = spawnLivePixelFx(scene, heavyCleaveFx, {
    pos, pxPerUnit: 38 / 1.1, fadeIn: 0.01, fadeOut: 0.1, hz: 30, renderOrder: 40, headStart, options: { palette: PAL.electric },
  });
  fx.mesh.onBeforeRender = (_r, _s, camera) => {
    const { right } = cameraBasisFromMatrix(camera.matrixWorld.elements);
    fx.options.flip = (toward.x - pos.x) * right[0] + (toward.z - pos.z) * right[2] < 0;
  };
  return fx;
}

/** Thunderous Smite's blow landing: pixelfx's Smite in electric on the floor point `pos`, joined just before its
 *  bolt drops (at 0.54 s): a hit is only known as it lands, so its mark and glint can't play ahead of it. */
export function spawnSmiteImpact(scene, pos) {
  return spawnLivePixelFx(scene, smiteFx, {
    pos, pxPerUnit: 38 / 1.1, fadeIn: 0.01, fadeOut: 0.1, hz: 30, renderOrder: 40, headStart: 0.5, options: { palette: PAL.electric },
  });
}

/** pixelfx's Mana Burst standing on the floor point `pos`, whole at its authored 1.8 s, in `palette`. `size` scales it. */
export function spawnManaBurst(scene, pos, palette, size = 1) {
  return spawnLivePixelFx(scene, manaBurstFx, {
    pos, pxPerUnit: (38 / 1.1) / size, fadeIn: 0.01, life: 1.8, fadeOut: 0.1, hz: 30, renderOrder: 40, options: { palette },
  });
}

/** A flat rune circle draped over the level round (x, z) for a little over a second: Protection
 *  from Evil's in its own holy gold, or in `palette` (a PAL or RAMPS name; Sleep's is `hush`). */
export function spawnWardCircle(scene, x, z, surfaceAt, palette) {
  const ramp = PAL[palette] || RAMPS[palette];
  return spawnLivePixelFx(scene, wardCircleFx, {
    pos: new THREE.Vector3(x, 0, z), pxPerUnit: 46, flat: true, heightAt: surfaceAt,
    fadeIn: 0.01, life: 1.2, fadeOut: 0.35, hz: 30, renderOrder: 1, options: ramp ? { palette: ramp } : {},
  });
}

/** Arms of Hadar's void portal, draped flat over the level round (x, z) and sized so its rim is the spell's
 *  `radius` (world units). Timed to the upright tentacle sheet it plays under; it ends on its own. */
export function spawnHadarPortal(scene, x, z, surfaceAt, radius = 2.2) {
  return spawnLivePixelFx(scene, hadarPortalFx, {
    pos: new THREE.Vector3(x, 0, z), pxPerUnit: hadarPortalFx.meta.options.radius / radius, flat: true, heightAt: surfaceAt,
    fadeIn: 0.01, fadeOut: 0.1, hz: 20, renderOrder: 1,
  });
}

/** Grease's slick, draped over the level round (x, z). `surfaceAt(x, z)` is the height of
 *  what's drawn there (elevation.js surfaceY). remove() fades it. */
export function spawnGreaseSlick(scene, x, z, surfaceAt) {
  return spawnLivePixelFx(scene, greaseSlickFx, {
    pos: new THREE.Vector3(x, 0, z), pxPerUnit: 38 / 1.1, flat: true, heightAt: surfaceAt,
    fadeIn: 0.01, fadeOut: 0.8, hz: 15, renderOrder: 1,
  });
}

/** Flaming Sphere's ball of fire, hovering over (x, z) at the game's own pixel scale. remove() fades it. */
export function spawnFlamingSphere(scene, x, z, floorY) {
  const fx = spawnLivePixelFx(scene, flamingSphereFx, {
    pos: new THREE.Vector3(x, floorY(x, z), z), pxPerUnit: 38 / 1.1,
    /* the creatures' own renderOrder: in that bucket three sorts back to front, so whoever stands
       nearer the camera covers the ball and it covers whoever stands behind it */
    fadeIn: 0.15, fadeOut: 0.5, hz: 30, renderOrder: 10,
  });
  /** Roll over to (nx, nz), keeping to the floor. */
  fx.glideTo = (nx, nz, seconds) => fx.moveTo(nx, floorY(nx, nz), nz, seconds);
  return fx;
}

/* ── floating numbers ─────────────────────────────────────────────────── */
const NUMBER_PX_PER_UNIT = 38 / 1.1;
const NUMBER_HEIGHT = 0.42;        // how far up the next number starts when one is already there
const NUMBER_STACK_MS = 650;
const CRIT_SCALE = 0.5;            // a crit's digits come out the size of an ordinary number's: its theatre does the shouting
const CRIT_LIFT = 0.25;            // its burst, over the target's head rather than on its face
const CRIT_MS = critPopFx.meta.duration * 1000, CRIT_FLY_MS = 240;
const MAX_LIVE_NUMBERS = 24;       // a big AoE shouldn't be able to pile up canvases: the oldest make way
const liveNumbers = [];
let recentNumbers = [];
let liveCrits = [];
let numberSeed = 1;

/** Hex string to the 8-step ramp a number of that colour is drawn in. */
function rampFromCss(color) {
  let s = String(color || '#ff5a4a').replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16);
  return rampFrom(Number.isNaN(n) ? 0xff5a4a : n);
}

/** A number floating over `pos`, as read by parseDamageFloat. Crits get the slam, everything else the punch. */
export function spawnDamagePop(scene, pos, spec, { color, isCrit = false } = {}) {
  const now = performance.now();
  recentNumbers = recentNumbers.filter((r) => now - r.t < NUMBER_STACK_MS);
  const lane = recentNumbers.filter((r) => Math.hypot(r.x - pos.x, r.z - pos.z) < 0.6).length;
  recentNumbers.push({ x: pos.x, z: pos.z, t: now });

  const typed = spec.types.length > 0 ? rampForType(spec.types[0]) : null;
  const palette = spec.effect === 'immune' ? ['#16161c', '#2a2a34', '#4a4a58', '#6a6a78', '#8a8a98', '#b0b0bc', '#d8d8e0', '#ffffff']
    : usesTypeColour(spec, color) ? (isCrit && typed === TYPE_RAMPS.physical ? TYPE_RAMPS.fire : typed) : rampFromCss(color);   // a weapon's crit keeps the hot slam it was drawn with
  const common = { types: spec.types, effect: spec.effect, typePalette: typed || palette, palette, seed: numberSeed++ };
  /* A crit slams in on the target, then one with company flies out to a slot of its own. */
  let critOut = null, critBorn = now;
  if (isCrit) {
    liveCrits = liveCrits.filter((c) => now - c.t < CRIT_MS);
    const slot = pickCritSlot(liveCrits, pos.x, pos.z);
    liveCrits.push({ x: pos.x, z: pos.z, t: now, slot });
    if (slot > 0) critOut = CRIT_SLOTS[slot];
  }
  const handle = spawnLivePixelFx(scene, isCrit ? critPopFx : damagePopFx, {
    pos: new THREE.Vector3(pos.x, pos.y + (isCrit ? CRIT_LIFT : lane * NUMBER_HEIGHT), pos.z),
    pxPerUnit: isCrit ? NUMBER_PX_PER_UNIT / CRIT_SCALE : NUMBER_PX_PER_UNIT,
    fadeIn: 0.01, fadeOut: 0.05, hz: 30, overlay: true, renderOrder: isCrit ? 75 : 65,
    /* its quad's anchor slides, so the flight is in screen space and holds true whichever way the camera faces */
    beforeDraw: critOut ? () => {
      const k = ease.outCubic(Math.min(1, (performance.now() - critBorn) / CRIT_FLY_MS));
      const [W, H] = critPopFx.meta.size, [ox, oy] = critPopFx.meta.origin;
      handle.mesh.center.set((ox - critOut[0] * k) / W, 1 - (oy - critOut[1] * k) / H);
    } : null,
    options: isCrit ? { ...common, text: spec.text + '!' } : { ...common, text: spec.text, dir: lane % 2 ? -1 : 1 },
  });
  liveNumbers.push({ handle, t: now });
  while (liveNumbers.length > MAX_LIVE_NUMBERS) liveNumbers.shift().handle.remove();
  for (let i = liveNumbers.length - 1; i >= 0; i--) if (now - liveNumbers[i].t > 2000) liveNumbers.splice(i, 1);
  return handle;
}

/** Gold won at the floor point `pos`: a coin bursts into a fountain that zips into a counter climbing to `amount`. */
export function spawnCoinCollect(scene, pos, amount) {
  return spawnLivePixelFx(scene, coinCollectFx, {
    pos: new THREE.Vector3(pos.x, pos.y, pos.z), pxPerUnit: NUMBER_PX_PER_UNIT,
    fadeIn: 0.01, fadeOut: 0.05, hz: 30, overlay: true, renderOrder: 60,
    options: { amount, count: coinsForGold(amount), seed: numberSeed++ },
  });
}

/** Moonbeam's standing light over (x, z): the shaft, a real cone in the world, and its pool flat on the floor.
 *  flash(k) brightens both, glideTo(x, z, seconds) moves both, remove() fades both. */
export function spawnMoonbeam(scene, x, z, floorY) {
  const lift = 0.03;
  const shaft = spawnMoonbeamCone(scene, x, floorY(x, z), z);
  const pool = spawnLivePixelFx(scene, moonbeamPoolFx, {
    pos: new THREE.Vector3(x, floorY(x, z) + lift, z), pxPerUnit: 38 / 1.1, flat: true, fadeIn: 0.01, fadeOut: 0.35, hz: 20, renderOrder: 1, additive: true,
  });
  return {
    flash(k = 1) { shaft.flash(k); pool.flash(k); },
    glideTo(nx, nz, seconds) {
      shaft.moveTo(nx, floorY(nx, nz), nz, seconds);
      pool.moveTo(nx, floorY(nx, nz) + lift, nz, seconds);
    },
    remove() { shaft.remove(); pool.remove(); },
  };
}

/** Faerie Fire's cast: each row of stars lands along one line, so two of them,
 *  each its own shuffle, either side of (x, z) cover the area instead. */
const FAERIE_ROWS = [[-0.5, -0.8], [0.5, 0.8]];
export function spawnFaerieStars(scene, x, z, floorY) {
  FAERIE_ROWS.forEach(([dx, dz], i) => {
    const px = x + dx, pz = z + dz;
    spawnLivePixelFx(scene, faerieStarsFx, {
      pos: new THREE.Vector3(px, floorY(px, pz), pz), pxPerUnit: 38 / 1.1,
      fadeIn: 0.01, fadeOut: 0.1, hz: 30, renderOrder: 40, options: { palette: RAMPS.faerie, seed: 13 + i * 5 },
    });
  });
}

/** Faerie Fire's standing area: a quiet glitter over the ground round (x, z). remove() fades it. */
export function spawnFaerieSparkle(scene, x, z, floorY) {
  return spawnLivePixelFx(scene, faerieSparkleFx, {
    pos: new THREE.Vector3(x, floorY(x, z), z), pxPerUnit: 38 / 1.1,
    fadeIn: 0.6, fadeOut: 0.6, hz: 15, renderOrder: 38, options: { palette: RAMPS.faerie },
  });
}

/** Entangle's standing growth: tufts of weeds across a circle of `radius` round
 *  (x, z), swaying for as long as the zone lasts. `floorY(x, z)` is the ground
 *  height. remove() has them shrink back into the floor. */
const WEED_TUFTS = 16, GOLDEN_ANGLE = 2.39996;
export function spawnEntangleWeeds(scene, x, z, radius, floorY) {
  const tufts = [];
  for (let i = 0; i < WEED_TUFTS; i++) {
    const r = radius * 0.92 * Math.sqrt((i + 0.5) / WEED_TUFTS), a = i * GOLDEN_ANGLE;
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    tufts.push(spawnLivePixelFx(scene, weedTuftFx, {
      pos: new THREE.Vector3(px, floorY(px, pz), pz), pxPerUnit: 38 / 1.1,
      fadeIn: 0.01, fadeOut: 0.45, hz: 15, renderOrder: 25, options: { seed: 11 + i * 7 },
    }));
  }
  return { remove() { for (const t of tufts) { t.options.wither = true; t.remove(); } } };
}

/** Chromatic Orb's landing, a different effect per damage type. `chest` and
 *  `floor` are the target's: a blast or a zap centres on the body, the rest
 *  stand on the ground. Each plays whole at its authored length. Poison isn't
 *  here: it plays on the creature's own figure (body_fx.js `chromaticPoison`). */
const ONE_SHOT = { fadeIn: 0.01, fadeOut: 0.1, hz: 30, renderOrder: 40 };
export function spawnElementImpact(scene, type, chest, floor) {
  switch (type) {
    case 'fire':
      return spawnLivePixelFx(scene, plasmaExplosionFx, { ...ONE_SHOT, pos: chest, pxPerUnit: 55, options: { palette: PAL.fire, accent: PAL.fire } });
    case 'cold':
      return spawnLivePixelFx(scene, snowflakeBurstFx, { ...ONE_SHOT, pos: floor, pxPerUnit: 38 / 1.1, options: { palette: PAL.ice } });
    case 'lightning':
      return spawnLivePixelFx(scene, zapHitFx, { ...ONE_SHOT, pos: chest, pxPerUnit: 38 / 1.1 });
    case 'acid':
      /* Cut in shortly before it erupts (at 1.15 s), and sized to a body, not a landmark. */
      return spawnLivePixelFx(scene, geyserFx, { ...ONE_SHOT, pos: floor, pxPerUnit: 55, headStart: 0.9, options: { palette: PAL.leaf, height: 70 } });
    default:
      return null;
  }
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

/** Dispose one live effect immediately. A fade-out remove() would still be in `live` for the level clear to free twice. */
export function dropLivePixelFx(mesh) {
  if (!mesh) return;
  const i = live.findIndex((e) => e.mesh === mesh);
  if (i < 0) return;
  disposeEntry(live[i]);
  live.splice(i, 1);
}
