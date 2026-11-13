/**
 * Body effects — pixelfx effects that paint onto a creature's own body.
 *
 * pixelfx's status and curse effects are written around a stand-in character
 * (a 24 x 38 px figure): they flood its silhouette, outline it, stain it from
 * the feet up. Here the stand-in is replaced by the creature itself: its
 * current sprite frame is read back from the texture it is drawn with (the
 * frame rect and facing come from the texture's offset/repeat, so heroes,
 * atlas monsters and flipped sprites all work), cropped to its opaque body and
 * shrunk to the stand-in's scale, so the effect's pixel detail keeps the size
 * it was drawn at. That figure is rebuilt on every redraw, so the curse rides
 * a breathing, swaying body — nothing is authored per monster.
 *
 * The effect is parented to the creature's group and laid out so the
 * figure's pixels sit exactly over the sprite's: same feet, same height.
 */

import * as THREE from 'three';
import { spawnLivePixelFx } from './pixelfx_live.js';
import * as shadowCurse from '../vendor/pixelfx/fx/shadow/curse.js';
import * as spellCharge from '../vendor/pixelfx/fx/arcane/spell-charge.js';
import * as holyBlessing from '../vendor/pixelfx/fx/holy/blessing.js';
import * as statusRage from '../vendor/pixelfx/fx/status/rage.js';
import * as statusConfused from '../vendor/pixelfx/fx/status/confused.js';
import * as blinkIn from '../vendor/pixelfx/fx/arcane/blink-in.js';
import * as blinkOut from '../vendor/pixelfx/fx/arcane/blink-out.js';
import * as holyHeal from '../vendor/pixelfx/fx/holy/heal.js';
import * as levelUp from '../vendor/pixelfx/fx/ui/level-up.js';
import * as outlineFx from './pfx/status_warded.js';
import * as lightHeal from './pfx/light_heal.js';
import * as growthAura from './pfx/growth_aura.js';
import * as holdClamp from './pfx/hold_clamp.js';
import * as moonScorch from './pfx/moon_scorch.js';
import * as afflictionLift from './pfx/affliction_lift.js';
import * as petrified from '../vendor/pixelfx/fx/status/petrified.js';
import * as targetReticle from './pfx/target_reticle.js';
import { PAL } from '../vendor/pixelfx/core/index.js';
import { RAMPS, rampFrom } from './pfx/ramps.js';

/* Named body effects spells call through game.fxBodyEffect(kind, creature):
   { mod, options } — the same effect can read differently by palette. */
export const BODY_EFFECTS = {
  /* Blight: wisps gather, a skull stamps down, the body floods with sickly
     necrotic green-black (Hex keeps the violet), cracks and crumbles. */
  blight: { mod: shadowCurse, options: { palette: RAMPS.necrotic } },
  /* Hunter's Mark: brackets lock onto the prey. */
  huntersReticle: { mod: targetReticle, options: { palette: RAMPS.marked }, fadeIn: 0.01, fadeOut: 0.05, hz: 30 },
  /* Hex: the same curse in its own violet. */
  hexCurse: { mod: shadowCurse },
  /* Bless: one whole pass of the cone of light, on the real figure so its
     sparkles land on this body's own head and shoulders. */
  blessing: { mod: holyBlessing, life: 3, fadeIn: 0.3, fadeOut: 0.5 },
  /* Vicious Mockery: one fast pass of each looping status, half a second apiece.
     `life` and `speed` fit a whole loop (rage 1.2 s, confused 2.4 s) into it. */
  mockeryRage: { mod: statusRage, life: 0.5, speed: 2.4, fadeIn: 0.04, fadeOut: 0.08, hz: 30 },
  mockeryConfused: { mod: statusConfused, life: 0.5, speed: 4.8, fadeIn: 0.04, fadeOut: 0.08, hz: 30 },
  /* Chromatic Orb's poison landing: bits rush in, and the target's own shape
     flares white and cools back through green. */
  chromaticPoison: { mod: blinkIn, options: { palette: PAL.poison }, fadeIn: 0.01, hz: 30 },
  /* Enlarge: a warm aura that glows while they grow. */
  growthAura: { mod: growthAura, options: { palette: rampFrom(0xffb45a) }, fadeIn: 0.01, hz: 30 },
  /* Hold Person: crystal jaws slam shut on the body as the rime spreads... */
  holdClamp: { mod: holdClamp, options: { palette: PAL.arcane }, fadeIn: 0.01, hz: 30 },
  /* ...or stop short and shatter when it resists. */
  holdBreak: { mod: holdClamp, options: { palette: PAL.arcane, broken: true }, fadeIn: 0.01, hz: 30 },
  /* Lesser Restoration: dark flecks pull up off the outline and burn to white, then a clean pulse round it. */
  afflictionLift: { mod: afflictionLift, options: { palette: rampFrom(0x8ff08a) }, fadeIn: 0.01, hz: 30 },
  /* Moonbeam burning someone: a silver line round them, pale light rising off it. */
  moonScorch: { mod: moonScorch, options: { palette: rampFrom(0xc0e8ff) }, fadeIn: 0.01, hz: 30 },
  /* Barkskin: bark climbs the body from the feet (done by 0.95 s) and fades before the statue would crack. */
  barkCreep: { mod: petrified, options: { palette: PAL.wood }, life: 1.25, fadeIn: 0.01, fadeOut: 0.3, hz: 30 },
  /* Barkskin ending: the same effect from just before it bursts apart (at 2.2 s). */
  barkBurst: { mod: petrified, options: { palette: PAL.wood }, headStart: 2.17, fadeIn: 0.01, hz: 30 },
  /* Healing Word's landing: Cure Wounds' climbing hoop, without its petals. */
  healingWord: { mod: lightHeal, options: { palette: PAL.leaf }, fadeIn: 0.01, hz: 30 },
  /* Thunderous Smite held ready: a bright blue line round the sprite until the swing that spends it. */
  smiteReady: { mod: outlineFx, options: { palette: PAL.electric, motes: 0, line: 1 }, fadeIn: 0.05, fadeOut: 0.1, hz: 15 },
  /* A hero gains a level: a pillar of gold round them, and LEVEL UP! drops in over it. */
  levelUp: { mod: levelUp, fadeIn: 0.01, hz: 30 },
  /* A familiar's arrival: bits rush in, a line of light opens into its own shape. */
  summonArrival: { mod: blinkIn, options: { palette: rampFrom(0x88ccff) }, fadeIn: 0.01, hz: 30 },
  /* Cure Wounds: petals open at the feet and a hoop climbs the body restoring its
     colour, in the spell's own green (the default is a gold that reads as Bless). */
  cureWounds: { mod: holyHeal, options: { palette: rampFrom(0x6ae06a) }, fadeIn: 0.01, hz: 30 },
};

/** Play BODY_EFFECTS[kind] on creature `e`; null if unknown or not ready. */
export function spawnBodyEffect(kind, e) {
  const def = BODY_EFFECTS[kind];
  return def ? spawnBodyFx(def.mod, e, def) : null;
}

/* arcane/blink-in's light has opened into the full silhouette by here. */
const SUMMON_APPEARS_SECONDS = 0.48;

/** A summon appearing: its sprite and health ring stay hidden until Blink In's
 *  flash. `delay(seconds, fn)` is the host's clock. A sprite still loading can't
 *  give its shape yet, so this keeps trying, and shows it plainly if it never can. */
export function playSummonArrival(e, delay, tries = 30) {
  const show = (on) => {
    const mesh = e.ent && e.ent.anim && e.ent.anim.mesh, bar = e.ent && e.ent.bar && e.ent.bar.spr;
    if (mesh) mesh.visible = on;
    if (bar) bar.visible = on;
  };
  show(false);
  if (spawnBodyEffect('summonArrival', e)) delay(SUMMON_APPEARS_SECONDS, () => show(true));
  else if (tries > 0) delay(0.05, () => playSummonArrival(e, delay, tries - 1));
  else show(true);
}

/* arcane/blink-out: the body is drawn by the effect from its flash on, and the line of light pops at its POP. */
const BLINK_FLASH_SECONDS = 0.32, BLINK_POP_SECONDS = 0.52, BLINK_OUT_SECONDS = 1.6;
const BLINK_PALETTE = rampFrom(0x6a2fb0, 0xb48ae8);   // a dark purple, its core only lilac

/** Misty Step: blink out where `e` stands, call `cross()` (which moves it) as the line pops, blink in wherever that
 *  left it. The departure stays behind on a holder of its own, since the creature's group is about to leave.
 *  `delay(seconds, fn)` is the host's clock. A sprite that can't give its shape just crosses. */
export function playBlinkStep(e, delay, cross) {
  const grp = e.ent && e.ent.grp, mesh = e.ent && e.ent.anim && e.ent.anim.mesh, bar = e.ent && e.ent.bar && e.ent.bar.spr;
  const show = (on) => { if (mesh) mesh.visible = on; if (bar) bar.visible = on; };
  const holder = new THREE.Group();
  holder.position.copy(grp ? grp.position : new THREE.Vector3());
  if (grp && grp.parent) grp.parent.add(holder);
  const out = grp && grp.parent ? spawnBodyFx(blinkOut, { ent: { grp: holder, anim: { mesh } } },
    { options: { palette: BLINK_PALETTE }, fadeIn: 0.01, hz: 30 }) : null;
  if (!out) { holder.removeFromParent(); cross(); return; }
  delay(BLINK_FLASH_SECONDS, () => show(false));
  delay(BLINK_OUT_SECONDS, () => holder.removeFromParent());
  delay(BLINK_POP_SECONDS, () => {
    cross();
    if (spawnBodyFx(blinkIn, e, { options: { palette: BLINK_PALETTE }, fadeIn: 0.01, hz: 30 })) delay(SUMMON_APPEARS_SECONDS, () => show(true));
    else show(true);
  });
}

/* The stand-in effects are drawn around: bodies this tall keep their detail
   (frost ferns, stains, outlines) at the scale it was authored. */
const BODY_PX = 40;
const ALPHA_ON = 128;

let _src = null, _dst = null;
function scratch(c, w, h) {
  if (!c) c = document.createElement('canvas');
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  return c;
}

/**
 * The creature's current frame as a pixelfx character, plus the art-px per
 * world unit that lays it over the sprite. Null until the sprite's texture
 * has loaded. Returns { actor: { mask, pixels, x, y, w, h, head, chest }, pxPerUnit }.
 */
export function silhouetteActor(e, heightPx = BODY_PX) {
  const mesh = e && e.ent && e.ent.anim && e.ent.anim.mesh;
  const tex = mesh && mesh.material && mesh.material.map;
  const img = tex && tex.image;
  if (!img || !(img.width > 0) || !(img.height > 0)) return null;

  /* the frame rect in image px; a negative repeat is a horizontal flip */
  const IW = img.width, IH = img.height;
  const rx = tex.repeat.x, ry = tex.repeat.y, ox = tex.offset.x, oy = tex.offset.y;
  const fw = Math.max(1, Math.round(Math.abs(rx) * IW)), fh = Math.max(1, Math.round(Math.abs(ry) * IH));
  const sx = Math.round(Math.min(ox, ox + rx) * IW), sy = Math.round((1 - (oy + Math.abs(ry))) * IH);
  const flip = (rx < 0) !== (mesh.scale.x < 0);

  _src = scratch(_src, fw, fh);
  const g = _src.getContext('2d', { willReadFrequently: true });
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, fw, fh);
  if (flip) g.setTransform(-1, 0, 0, 1, fw, 0);
  try { g.drawImage(img, sx, sy, fw, fh, 0, 0, fw, fh); } catch { return null; }
  const full = g.getImageData(0, 0, fw, fh).data;

  /* the opaque body's box within the frame */
  let x0 = fw, y0 = fh, x1 = -1, y1 = -1;
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    if (full[(y * fw + x) * 4 + 3] < ALPHA_ON) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;

  /* shrink the body to the stand-in's height (nearest, so it stays pixel art) */
  const k = heightPx / bh, w = Math.max(1, Math.round(bw * k)), h = heightPx;
  _dst = scratch(_dst, w, h);
  const d = _dst.getContext('2d', { willReadFrequently: true });
  d.imageSmoothingEnabled = false;
  d.clearRect(0, 0, w, h);
  d.drawImage(_src, x0, y0, bw, bh, 0, 0, w, h);
  const rgba = d.getImageData(0, 0, w, h).data;
  /* canvas RGBA bytes read as little-endian words are pixelfx's 0xAABBGGRR */
  const pixels = new Uint32Array(rgba.buffer.slice(0));
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] >= ALPHA_ON) { mask[i] = 1; pixels[i] |= 0xff000000; } else pixels[i] = 0;
  }

  /* lay the figure over the sprite: frame px -> world (the sprite's own
     center/scale, in its group) -> art px about the group's origin, feet at 0 */
  const sw = Math.abs(mesh.scale.x), shh = Math.abs(mesh.scale.y);
  /* only a negative scale mirrors the quad round its centre; a texture flip (negative repeat) leaves it where it is */
  const cx = mesh.scale.x < 0 ? 1 - mesh.center.x : mesh.center.x;
  const worldPerFramePx = shh / fh;
  const pxPerUnit = heightPx / (bh * worldPerFramePx);
  const left = ((x0 / fw) - cx) * sw, top = (1 - y0 / fh - mesh.center.y) * shh + (mesh.position.y || 0);
  const ax = Math.round(left * pxPerUnit), ay = Math.round(-top * pxPerUnit);
  return {
    pxPerUnit,
    actor: {
      mask: { w, h, data: mask }, pixels, x: ax, y: ay, w, h, k: 2,
      head: [ax + Math.round(w / 2), ay], chest: [ax + Math.round(w / 2), ay + Math.round(h * 0.32)],
    },
  };
}

/** How far above its group's origin (its feet) a creature's chest is, in the
 *  group's own units, read off its current sprite: 52% of the way down
 *  the opaque body, where a spell's charge sits and the spell leaves from. A sprite not loaded yet gets a typical height. */
export function chestLocalY(e) {
  const s = silhouetteActor(e);
  return s ? -(s.actor.y + s.actor.h * 0.52) / s.pxPerUnit : 0.55;
}

/** The chest in world space: on the real floor (the group stands on it), and
 *  scaled with the creature. */
export function chestWorldY(e) {
  const g = e && e.ent && e.ent.grp;
  return g ? g.position.y + chestLocalY(e) * (g.scale.y || 1) : 0.55;
}

/* The half-second charge at the start of a spell: pixelfx arcane/spell-charge,
   whose ring collapses into its orb between 0.07 s and 0.47 s. Its orb sits at
   (15, -22) art px from its origin, so that point is what's pinned to the chest. */
export const SPELL_CHARGE_SECONDS = 0.5;
const CHARGE_ORB_ART = [15, -22];

/** Energy gathering at the caster's chest, in the spell's colours. */
export function spawnSpellCharge(e, color, core = 0xffffff) {
  if (!e || !e.ent || !e.ent.grp) return null;
  return spawnLivePixelFx(null, spellCharge, {
    parent: e.ent.grp,
    pos: new THREE.Vector3(0, chestLocalY(e), 0),
    anchorArt: CHARGE_ORB_ART,
    pxPerUnit: (38 / 1.1) * 2,          // half the stand-in's scale (38 art px to a 1.1-unit body): a small gather at the chest
    options: { palette: rampFrom(color != null ? color : 0xc0a060, core) },
    headStart: 0.07, life: SPELL_CHARGE_SECONDS - 0.08, fadeOut: 0.08, fadeIn: 0.04,
    renderOrder: 57,
  });
}

/* An `overhead` effect is authored round a floor point (a pickup orb); lift
   that point to just under the top of the creature's head, so the effect
   plays above it at the creature's own height. */
const OVERHEAD_DROP = 0.25;

/**
 * Play a pixelfx body effect on creature `e`, its figure rebuilt from the
 * sprite each redraw. One-shots (shadow/curse) remove themselves when done;
 * loops (status/cursed) last until the handle's remove(). opts: { options,
 * holdAt, anchor: 'overhead' }. Null if the sprite isn't ready yet.
 */
export function spawnBodyFx(mod, e, opts = {}) {
  const first = silhouetteActor(e);
  if (!first) return null;
  let last = first.actor;
  const headTop = -first.actor.y / first.pxPerUnit;
  return spawnLivePixelFx(null, mod, {
    parent: e.ent.grp,
    pos: opts.anchor === 'overhead' ? new THREE.Vector3(0, headTop - OVERHEAD_DROP, 0) : null,
    pxPerUnit: first.pxPerUnit,
    margin: opts.margin != null ? opts.margin : 24,
    renderOrder: opts.renderOrder != null ? opts.renderOrder : 56,
    fadeIn: opts.fadeIn != null ? opts.fadeIn : (mod.meta.loop ? 0.6 : 0.1),
    holdAt: opts.holdAt,
    life: opts.life, fadeOut: opts.fadeOut, speed: opts.speed, hz: opts.hz, headStart: opts.headStart,
    options: { ...(opts.options || {}), actor: first.actor },
    beforeDraw(o) {
      const now = silhouetteActor(e);
      if (now) last = now.actor;
      o.actor = last;
    },
  });
}
