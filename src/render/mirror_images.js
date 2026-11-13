/**
 * Mirror Image's duplicates: translucent pale twins of the creature's real sprite, one per image left, drifting
 * slowly round it. They mirror whatever the sprite shows this frame. Decoration only: nothing targets them and
 * they hold no tile. status_auras.js calls syncMirrorImages each frame with how many images the creature has;
 * losing one shatters it, and running out any other way (the spell ending, the caster falling) fades them.
 *
 * State is a WeakMap off the creature, so nothing render-side can end up in a save.
 */
import * as THREE from 'three';
import { configureSpriteMaterial } from '../game/sprite_animator.js';
import { spawnBodyFx } from './body_fx.js';
import * as imageShatter from './pfx/image_shatter.js';
import { rampFrom } from './pfx/ramps.js';

const TINT = 0xa8d8ff, OPACITY = 0.55, RADIUS = 0.95, SPIN = 0.32, BOB = 0.035;
const SPLIT_MS = 500, FADE_MS = 400, SHATTER_MS = 700, FLICKER_MS = 350;
const SLOTS = 3;
const SHATTER_PALETTE = rampFrom(0x88ccff);

const states = new WeakMap();

function makeGhost(e, slot, now) {
  const src = e.ent.anim.mesh, sm = src.material;
  const mat = configureSpriteMaterial(new THREE.SpriteMaterial({
    map: sm.map, color: TINT, transparent: true, opacity: 0,
    depthTest: true, depthWrite: false, alphaTest: 0.05,
  }));
  const mesh = new THREE.Sprite(mat);
  mesh.renderOrder = src.renderOrder || 0;
  mesh.center.copy(src.center);
  mesh.scale.copy(src.scale);
  /* a body in its own right: the twin is one frame of the same sheet, lit as the creature is */
  mesh.onBeforeRender = () => {
    if (mat.map !== sm.map) mat.map = sm.map;
    mat.rotation = sm.rotation;
    mesh.center.copy(src.center);
    mesh.scale.copy(src.scale);
    const a = sm.userData, b = mat.userData;
    if (a.sprPose && b.sprPose) { b.sprPose.pose.value.copy(a.sprPose.pose.value); b.sprPose.dir.value.copy(a.sprPose.dir.value); }
    if (a.sprLit && b.sprLit) {
      b.sprLit.L.value.copy(a.sprLit.L.value);
      b.sprLit.R.value.copy(a.sprLit.R.value);
      if (a.sprLit.fog && b.sprLit.fog) b.sprLit.fog.value.copy(a.sprLit.fog.value);
      if (a.sprLit.fogTop && b.sprLit.fogTop) b.sprLit.fogTop.value = a.sprLit.fogTop.value;
    }
  };
  const holder = new THREE.Group();
  holder.add(mesh);
  e.ent.grp.add(holder);
  return { slot, holder, mesh, mat, from: now, flickerUntil: 0 };
}

function dispose(g) {
  if (g.holder.parent) g.holder.parent.remove(g.holder);
  g.mat.dispose();
}

function pose(g, now) {
  const age = now - g.from, k = Math.min(1, age / SPLIT_MS), out = 1 - (1 - k) * (1 - k);
  const ang = (g.slot / SLOTS) * Math.PI * 2 + (now / 1000) * SPIN;
  const flicker = now < g.flickerUntil;
  const jit = flicker ? (Math.floor(now / 45) % 2 ? 0.06 : -0.06) : 0;
  g.holder.position.set(Math.cos(ang) * RADIUS * out + jit, Math.sin(now / 700 + g.slot * 2) * BOB, Math.sin(ang) * RADIUS * out);
  g.mat.opacity = OPACITY * Math.min(1, age / (SPLIT_MS * 0.6)) * (flicker && Math.floor(now / 45) % 2 ? 0.25 : 1);
}

/** Bring a creature's ghosts in line with the images it has left. */
export function syncMirrorImages(e, count, now = performance.now()) {
  let st = states.get(e);
  if (!st) {
    if (!count) return;
    states.set(e, (st = { ghosts: [], leaving: [] }));
  }
  const mesh = e.ent && e.ent.anim && e.ent.anim.mesh;
  if (count && (!mesh || !mesh.material.map)) return;   // not loaded yet: try again next frame

  while (st.ghosts.length < count) {
    const free = [0, 1, 2].find((s) => !st.ghosts.some((g) => g.slot === s));
    st.ghosts.push(makeGhost(e, free === undefined ? st.ghosts.length : free, now));
  }
  if (st.ghosts.length > count) {
    const lost = st.ghosts.length - count;
    for (const g of st.ghosts.splice(0, lost)) {
      /* one gone means a blow broke it; several at once, or none left and the creature still whole, means the spell ended */
      if (lost === 1) {
        g.mesh.visible = false;
        const fx = spawnBodyFx(imageShatter, { ent: { grp: g.holder, anim: { mesh: g.mesh } } },
          { options: { palette: SHATTER_PALETTE }, fadeIn: 0.01, hz: 30, renderOrder: 56 });
        g.until = now + (fx ? SHATTER_MS : 0);
      } else {
        g.fadeFrom = now;
        g.until = now + FADE_MS;
      }
      st.leaving.push(g);
    }
  }
  for (const g of st.ghosts) pose(g, now);
  for (let i = st.leaving.length - 1; i >= 0; i--) {
    const g = st.leaving[i];
    if (g.fadeFrom != null) g.mat.opacity = OPACITY * Math.max(0, 1 - (now - g.fadeFrom) / FADE_MS);
    if (now >= g.until) { dispose(g); st.leaving.splice(i, 1); }
  }
  if (!st.ghosts.length && !st.leaving.length) states.delete(e);
}

/** A blow passed through an image without breaking it: one of them flickers. */
export function flickerMirrorImage(e, now = performance.now()) {
  const st = states.get(e);
  if (!st || !st.ghosts.length) return;
  st.ghosts[Math.floor(Math.random() * st.ghosts.length)].flickerUntil = now + FLICKER_MS;
}
