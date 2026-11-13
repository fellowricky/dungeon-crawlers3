/**
 * Thrown-weapon preview (throw_preview.html). Dev tool, not shipped in the
 * game flow: a real hero sprite swings and lets go, and the REAL projectile
 * code (entities.js spawnThrownWeapon, items.js thrownStyleFor) flies the
 * weapon at a training dummy — alternating a hit and a miss per weapon.
 */
import * as THREE from 'three';
import { makeHero, recalc } from './game/srd.js';
import { makeHeroMesh, spawnProjectile, updateProjectiles, updateWorldFx, spawnSlash, getOrLoadSpriteTexture } from './game/entities.js';
import { rollItem, BASES, thrownStyleFor } from './game/items.js';

const THROWN = BASES.weapon.filter(b => b.thrown).map(b => b.name);
for (const b of BASES.weapon) if (b.thrown && b.icon) getOrLoadSpriteTexture(b.icon);

/* ── scene ─────────────────────────────────────────────────────────── */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x090a10);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.add(new THREE.AmbientLight(0xffffff, 1.4));
const sun = new THREE.DirectionalLight(0xffe8c0, 1.2);
sun.position.set(3, 8, 5);
scene.add(sun);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 16), new THREE.MeshStandardMaterial({ color: 0x3a3530, roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const grid = new THREE.GridHelper(30, 30, 0x5a5048, 0x4a423a);
grid.position.y = 0.005;
scene.add(grid);

/* Game-like camera: pitched down ~30 degrees, looking across the throw. */
const cam = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 100);
const camTarget = new THREE.Vector3(0, 0.6, 0);
const pitch = 0.52, dist = 11.5;
cam.position.set(0, camTarget.y + Math.sin(pitch) * dist, Math.cos(pitch) * dist);
cam.lookAt(camTarget);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  cam.aspect = innerWidth / innerHeight;
  cam.updateProjectionMatrix();
});

const THROWER_X = -3.5, TARGET_X = 3.5;

/* Training dummy as the target. */
const dummy = new THREE.Group();
const wood = new THREE.MeshStandardMaterial({ color: 0x8b6538, roughness: 0.8 });
const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.4, 10), wood);
post.position.y = 0.7;
const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), wood);
head.position.y = 1.5;
const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.2, 8), wood);
arm.rotation.z = Math.PI / 2;
arm.position.y = 1.05;
dummy.add(post, head, arm);
dummy.position.set(TARGET_X, 0, 0);
scene.add(dummy);

/* ── thrower ───────────────────────────────────────────────────────── */
let hero = null;
let heroEnt = null;

function equip(baseKey) {
  if (heroEnt) scene.remove(heroEnt.grp);
  hero = makeHero('Thrower', 'human', 'fighter', { str: 14, dex: 14, con: 14 }, {
    gender: 'male', hair: 'bangs/adult', skinColor: '#e8c088', hairColor: '#553311', eyeColor: '#4488cc'
  });
  hero.equipment = { ...(hero.equipment || {}), weapon: rollItem(1, Math.random, 'weapon', { baseKey, forceRarity: 'common' }) };
  delete hero.equipment.offhand;
  recalc(hero);
  heroEnt = makeHeroMesh(hero);
  heroEnt.grp.position.set(THROWER_X, 0, 0);
  scene.add(heroEnt.grp);
  if (heroEnt.anim && heroEnt.anim.setDirection) heroEnt.anim.setDirection(1, 0);
}

/* ── one throw ─────────────────────────────────────────────────────── */
function throwOnce(miss) {
  if (!heroEnt) return;
  const wpn = hero.equipment.weapon;
  const profile = { ...hero.weaponProfile, melee: false, throwing: true };
  const anim = heroEnt.anim;
  let release = 0.4;
  if (anim) {
    const action = anim.resolveAttackAction ? anim.resolveAttackAction(profile) : 'slash';
    if (anim.setDirection) anim.setDirection(1, 0);
    anim.play(action, true);
    release = anim.attackImpactDelay ? anim.attackImpactDelay(action) : 0.4;
  }
  later(release, () => {
    const from = new THREE.Vector3(THROWER_X, 0.75, 0);
    const to = miss
      ? new THREE.Vector3(TARGET_X + 0.8, 0.18, 0.45)
      : new THREE.Vector3(TARGET_X, 0.9, 0);
    spawnProjectile(scene, from, to, 'thrown', 0xffffff, () => {
      if (!miss) spawnSlash(scene, to, 0xffe0a0, 0.9);
    }, { icon: wpn.icon, style: thrownStyleFor(wpn), miss });
  });
}

/* Timers on the scene clock so "half speed" slows everything together. */
const timers = [];
function later(sec, fn) { timers.push({ t: sec, fn }); }

/* ── UI + sequence ─────────────────────────────────────────────────── */
const nowEl = document.getElementById('now');
const btnHost = document.getElementById('weapons');
const cycleEl = document.getElementById('cycle');
const slowEl = document.getElementById('slow');
let current = 0, step = 0, clock = 0;

function select(i) {
  current = i;
  step = 0;
  clock = 0.6;
  equip(THROWN[i]);
  [...btnHost.children].forEach((b, j) => b.classList.toggle('on', j === i));
}
THROWN.forEach((name, i) => {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => { cycleEl.checked = false; select(i); };
  btnHost.appendChild(b);
});

let manual = false;
function tickSequence(dt) {
  if (manual) return;
  clock -= dt;
  if (clock > 0) return;
  if (step < 2) {
    const miss = step === 1;
    const st = thrownStyleFor(hero.equipment.weapon);
    nowEl.textContent = `${THROWN[current]} — ${miss ? 'miss' : 'hit'} (${st.spin ? 'spins' : 'point-first'})`;
    throwOnce(miss);
    step++;
    clock = 2.2;
  } else if (cycleEl.checked) {
    select((current + 1) % THROWN.length);
  } else {
    step = 0;
    clock = 0.8;
  }
}

select(0);

let last = performance.now();
let paused = false;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (paused) return;
  if (slowEl.checked) dt *= 0.5;
  advance(dt);
}
/** Advance the whole preview by `dt` seconds and draw (also used for capture). */
function advance(dt) {
  for (let i = timers.length - 1; i >= 0; i--) {
    timers[i].t -= dt;
    if (timers[i].t <= 0) { const f = timers[i].fn; timers.splice(i, 1); f(); }
  }
  tickSequence(dt);
  if (heroEnt && heroEnt.anim) heroEnt.anim.update(dt);
  updateProjectiles(scene, dt, cam);
  updateWorldFx(scene, dt);
  renderer.render(scene, cam);
}
requestAnimationFrame(frame);

/* For automated capture: window.__throwPreview.select(i) / .throwOnce(miss). */
window.__throwPreview = { select, throwOnce, THROWN, scene, cam, advance, pause: (v) => { paused = v; manual = v; } };
