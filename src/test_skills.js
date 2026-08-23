import * as THREE from 'three';
import { makeHero, CLASSES, MONSTERS_ALL } from './game/srd.js';
import {
  makeHeroMesh, makeMonsterMesh, updateProjectiles, updateWorldFx,
  updateFloatTexts, spawnSpriteEffect, spawnSheetEffect, spawnSlash,
  spawnProjectile, spawnBeamEffect, spawnAoEVisual, makeFloatText
} from './game/entities.js';
import { ABILITY_FX, CANTRIP_FX } from './game/combat.js';
import { SPELLS } from './game/spells.js';
import { BOSS_SPELLS, BOSS_SPELL_FX } from './game/monster_ai.js';
import { GIGAPACK_REGISTRY } from './game/gigapack_registry.js';
import { playSfx, spellSfx, cantripSfx } from './game/audio.js';
import { _v } from './game/shared.js';

/* ─────────────────────────────────────────────────────────────
   DOM Elements & Controls
   ───────────────────────────────────────────────────────────── */
const el = {
  select: document.getElementById('skill-select'),
  skillName: document.getElementById('skill-name'),
  infoLabel: document.getElementById('info-skill-label'),
  attackerSelect: document.getElementById('attacker-select'),
  targetSelect: document.getElementById('target-select'),
  themeSelect: document.getElementById('theme-select'),
  camPreset: document.getElementById('cam-preset'),
  resetCamBtn: document.getElementById('reset-cam-btn'),
  playBtn: document.getElementById('play-btn'),
  loopCb: document.getElementById('loop-cb'),
  interval: document.getElementById('interval'),
  intervalVal: document.getElementById('interval-val'),
  sfxCb: document.getElementById('sfx-cb'),
  bothCb: document.getElementById('both-cb'),
};

/* ─────────────────────────────────────────────────────────────
   Three.js Setup & Renderer
   ───────────────────────────────────────────────────────────── */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x090a10);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const fog = new THREE.FogExp2(0x0c0e18, 0.015);
scene.fog = fog;

/* ─────────────────────────────────────────────────────────────
   Camera & Interactive Orbit System
   ───────────────────────────────────────────────────────────── */
const aspect = innerWidth / innerHeight;
const cam = new THREE.PerspectiveCamera(42, aspect, 0.1, 120);

let yaw = Math.PI / 4;
let pitch = 0.55;
let camDistance = 16.5;
const camTarget = new THREE.Vector3(0, 0.6, 0);

let shakeIntensity = 0;
export function shakeCamera(intensity = 0.4) {
  shakeIntensity = Math.max(shakeIntensity, intensity);
}

function updateCamera() {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const fx = cp * Math.sin(yaw);
  const fy = sp;
  const fz = cp * Math.cos(yaw);

  cam.position.set(
    camTarget.x + fx * camDistance,
    camTarget.y + fy * camDistance,
    camTarget.z + fz * camDistance
  );

  if (shakeIntensity > 0.001) {
    const t = performance.now() * 0.05;
    cam.position.x += Math.sin(t * 1.7) * shakeIntensity * 0.35;
    cam.position.y += Math.cos(t * 1.3) * shakeIntensity * 0.25;
    cam.position.z += Math.sin(t * 1.1) * shakeIntensity * 0.35;
  }

  cam.lookAt(camTarget);
}
updateCamera();

/* Mouse / Pointer Interaction for Orbiting & Panning */
const canvas = renderer.domElement;
let isDragging = false;
let isOrbiting = false;
let lastX = 0, lastY = 0;

canvas.addEventListener('pointerdown', e => {
  isOrbiting = e.button === 2 || (e.button === 0 && e.shiftKey);
  isDragging = e.button === 0 && !e.shiftKey;
  lastX = e.clientX;
  lastY = e.clientY;
});

canvas.addEventListener('pointermove', e => {
  if (!isDragging && !isOrbiting) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;

  if (isOrbiting) {
    yaw -= dx * 0.006;
    pitch = Math.max(0.1, Math.min(1.4, pitch + dy * 0.006));
  } else if (isDragging) {
    const panSpeed = camDistance * 0.0008;
    const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
    camTarget.x -= rightX * dx * panSpeed;
    camTarget.z -= rightZ * dx * panSpeed;
    camTarget.y += dy * panSpeed;
  }

  lastX = e.clientX;
  lastY = e.clientY;
  updateCamera();
});

window.addEventListener('pointerup', () => {
  isDragging = false;
  isOrbiting = false;
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  camDistance = Math.max(4, Math.min(36, camDistance + e.deltaY * 0.012));
  updateCamera();
}, { passive: false });

/* Camera Presets */
const CAM_PRESETS = {
  iso: { yaw: Math.PI / 4, pitch: 0.55, dist: 16.5, target: new THREE.Vector3(0, 0.6, 0) },
  front: { yaw: 0, pitch: 0.2, dist: 14.0, target: new THREE.Vector3(0, 0.8, 0) },
  top: { yaw: 0, pitch: 1.35, dist: 18.0, target: new THREE.Vector3(0, 0, 0) },
  close: { yaw: Math.PI / 6, pitch: 0.35, dist: 8.5, target: new THREE.Vector3(0, 0.6, 0) },
};

function setCamPreset(key) {
  const p = CAM_PRESETS[key] || CAM_PRESETS.iso;
  yaw = p.yaw;
  pitch = p.pitch;
  camDistance = p.dist;
  camTarget.copy(p.target);
  updateCamera();
}

el.camPreset?.addEventListener('change', () => setCamPreset(el.camPreset.value));
el.resetCamBtn?.addEventListener('click', () => {
  if (el.camPreset) el.camPreset.value = 'iso';
  setCamPreset('iso');
});

window.addEventListener('resize', () => {
  cam.aspect = innerWidth / innerHeight;
  cam.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ─────────────────────────────────────────────────────────────
   Authentic 3D Dungeon Room Environment & Scatter Terrain
   ───────────────────────────────────────────────────────────── */
const roomGroup = new THREE.Group();
scene.add(roomGroup);

// Lighting
const ambientLight = new THREE.AmbientLight(0x283044, 1.2);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0x3a4868, 0x0c0e18, 0.9);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffedd4, 1.8);
dirLight.position.set(8, 14, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.bias = -0.0005;
scene.add(dirLight);

/* Torch Point Lights */
const torchLight1 = new THREE.PointLight(0xff9933, 2.8, 16, 2);
torchLight1.position.set(-6, 3.2, -5.5);
torchLight1.castShadow = true;
scene.add(torchLight1);

const torchLight2 = new THREE.PointLight(0xff9933, 2.8, 16, 2);
torchLight2.position.set(6, 3.2, -5.5);
torchLight2.castShadow = true;
scene.add(torchLight2);

// 1. 3D Bevelled Floor Tiles Grid (16x16)
const floorMaterials = [];
let wallMaterial, trimMaterial;

function buildDungeonRoomFloor() {
  const tileSize = 1.35;
  const halfGrid = 8;
  const tileGeom = new THREE.BoxGeometry(tileSize * 0.96, 0.12, tileSize * 0.96);

  wallMaterial = new THREE.MeshStandardMaterial({ color: 0x181c2d, roughness: 0.9, metalness: 0.1 });
  trimMaterial = new THREE.MeshStandardMaterial({ color: 0x252b42, roughness: 0.7 });

  for (let x = -halfGrid; x < halfGrid; x++) {
    for (let z = -halfGrid; z < halfGrid; z++) {
      const shade = (Math.abs(x + z) % 2 === 0) ? 0x1d2236 : 0x181c2d;
      const mat = new THREE.MeshStandardMaterial({ color: shade, roughness: 0.82, metalness: 0.1 });
      floorMaterials.push(mat);

      const tile = new THREE.Mesh(tileGeom, mat);
      const hVar = (Math.sin(x * 1.5 + z * 2.1) * 0.015);
      tile.position.set(x * tileSize + tileSize / 2, -0.06 + hVar, z * tileSize + tileSize / 2);
      tile.receiveShadow = true;
      roomGroup.add(tile);
    }
  }
}
buildDungeonRoomFloor();

// 2. 3D Perimeter Stone Walls & Moldings
const backWallGeom = new THREE.BoxGeometry(22, 6, 0.6);
const backWall = new THREE.Mesh(backWallGeom, wallMaterial);
backWall.position.set(0, 3, -10.5);
backWall.receiveShadow = true;
backWall.castShadow = true;
roomGroup.add(backWall);

const leftWallGeom = new THREE.BoxGeometry(0.6, 6, 22);
const leftWall = new THREE.Mesh(leftWallGeom, wallMaterial);
leftWall.position.set(-10.5, 3, 0);
leftWall.receiveShadow = true;
leftWall.castShadow = true;
roomGroup.add(leftWall);

const rightWall = new THREE.Mesh(leftWallGeom, wallMaterial);
rightWall.position.set(10.5, 3, 0);
rightWall.receiveShadow = true;
rightWall.castShadow = true;
roomGroup.add(rightWall);

// Stone Moldings
const trimGeom = new THREE.BoxGeometry(22, 0.35, 0.4);
const trim = new THREE.Mesh(trimGeom, trimMaterial);
trim.position.set(0, 0.18, -10.2);
roomGroup.add(trim);

// 3. 3D Torch Sconces
function makeTorchSconce(x, z) {
  const grp = new THREE.Group();
  grp.position.set(x, 3.2, z);
  const mountMat = new THREE.MeshStandardMaterial({ color: 0x33261a, roughness: 0.6 });
  const mount = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.3), mountMat);
  grp.add(mount);

  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffaa22 });
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), flameMat);
  flame.position.set(0, 0.4, 0.15);
  grp.add(flame);
  return grp;
}
roomGroup.add(makeTorchSconce(-6, -10.2));
roomGroup.add(makeTorchSconce(6, -10.2));

// 4. 3D Scatter Terrain Props (Stone Pillars, Wooden Crates, Barrels, Treasure Chest, Urns)
function makeStonePillar(x, z) {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  const mat = new THREE.MeshStandardMaterial({ color: 0x22283d, roughness: 0.85 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 3.2, 12), mat);
  shaft.position.y = 1.6;
  shaft.castShadow = true; shaft.receiveShadow = true;
  grp.add(shaft);

  const cap = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.25, 1.0), mat);
  cap.position.y = 3.2;
  cap.castShadow = true;
  grp.add(cap);

  const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 1.1), mat);
  base.position.y = 0.15;
  base.castShadow = true;
  grp.add(base);
  return grp;
}

roomGroup.add(makeStonePillar(-6.5, -6.5));
roomGroup.add(makeStonePillar(6.5, -6.5));
roomGroup.add(makeStonePillar(-6.5, 6.5));
roomGroup.add(makeStonePillar(6.5, 6.5));

function makeWoodenCrate(x, z, rY = 0) {
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 0.8 });
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.85), crateMat);
  crate.position.set(x, 0.425, z);
  crate.rotation.y = rY;
  crate.castShadow = true; crate.receiveShadow = true;
  return crate;
}
roomGroup.add(makeWoodenCrate(-4.2, -4.5, 0.2));
roomGroup.add(makeWoodenCrate(-4.8, -4.2, -0.4));

function makeOakBarrel(x, z) {
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x4a321a, roughness: 0.75 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.35, 0.9, 10), barrelMat);
  barrel.position.set(x, 0.45, z);
  barrel.castShadow = true; barrel.receiveShadow = true;
  return barrel;
}
roomGroup.add(makeOakBarrel(4.5, -4.5));
roomGroup.add(makeOakBarrel(5.2, -4.2));

function makeTreasureChest(x, z) {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x422917, roughness: 0.7 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.8, roughness: 0.3 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), bodyMat);
  body.position.y = 0.25;
  body.castShadow = true;
  grp.add(body);

  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 8, 1, false, 0, Math.PI), bodyMat);
  lid.rotation.z = Math.PI / 2;
  lid.position.set(0, 0.5, 0);
  lid.castShadow = true;
  grp.add(lid);

  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 0.05), trimMat);
  lock.position.set(0, 0.3, 0.32);
  grp.add(lock);

  return grp;
}
roomGroup.add(makeTreasureChest(0, -7.5));

/* Theme Switcher */
const THEME_CONFIGS = {
  ancient: {
    bg: 0x090a10, fog: 0x0c0e18,
    floor1: 0x1d2236, floor2: 0x181c2d, wall: 0x181c2d,
    hemiUp: 0x3a4868, hemiDown: 0x0c0e18,
    dir: 0xffedd4, torch: 0xff9933
  },
  necropolis: {
    bg: 0x050b10, fog: 0x07121a,
    floor1: 0x12202e, floor2: 0x0c1722, wall: 0x0e1b28,
    hemiUp: 0x205068, hemiDown: 0x050c12,
    dir: 0x8ce0ff, torch: 0x22d4ff
  },
  inferno: {
    bg: 0x120606, fog: 0x1a0909,
    floor1: 0x2d1717, floor2: 0x221010, wall: 0x241111,
    hemiUp: 0x682828, hemiDown: 0x120606,
    dir: 0xff8844, torch: 0xff3300
  },
  overgrown: {
    bg: 0x061009, fog: 0x0a180e,
    floor1: 0x172b1d, floor2: 0x112115, wall: 0x122416,
    hemiUp: 0x3a6842, hemiDown: 0x061009,
    dir: 0xd4ffaa, torch: 0x99ff33
  }
};

function applyTheme(themeKey) {
  const cfg = THEME_CONFIGS[themeKey] || THEME_CONFIGS.ancient;
  renderer.setClearColor(cfg.bg);
  scene.fog.color.set(cfg.fog);
  if (wallMaterial) wallMaterial.color.set(cfg.wall);
  floorMaterials.forEach((m, idx) => {
    m.color.set(idx % 2 === 0 ? cfg.floor1 : cfg.floor2);
  });
  hemiLight.color.set(cfg.hemiUp);
  hemiLight.groundColor.set(cfg.hemiDown);
  dirLight.color.set(cfg.dir);
  torchLight1.color.set(cfg.torch);
  torchLight2.color.set(cfg.torch);
}

el.themeSelect?.addEventListener('change', () => applyTheme(el.themeSelect.value));
applyTheme('ancient');

/* ─────────────────────────────────────────────────────────────
   Entities: Attacker & Target Unit Presets
   ───────────────────────────────────────────────────────────── */
const CASTER_X = -3.5, TARGET_X = 3.5;

function createHero(name, raceKey, classKey, visual = {}) {
  const heroData = makeHero(name, raceKey, classKey, {
    str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14
  }, {
    gender: 'male', hair: 'bangs/adult',
    skinColor: '#e8c088', hairColor: '#553311', eyeColor: '#4488cc',
    ...visual
  });
  const mesh = makeHeroMesh(heroData);
  return { ent: mesh, data: heroData, lungeT: 0, lungeDX: 0, lungeDZ: 0, castAnim: false, isMonster: false };
}

function createMonster(name, sprite, scale = 1.0, fullData = {}) {
  const monData = { hp: 100, maxHp: 100, ...fullData, name, sprite, scale };
  const mesh = makeMonsterMesh(monData);
  return { ent: mesh, data: monData, lungeT: 0, lungeDX: 0, lungeDZ: 0, castAnim: false, isMonster: true };
}

function createDummy() {
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8b6538, roughness: 0.8 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.6, 12), mat);
  post.position.y = 0.8;
  post.castShadow = true;
  grp.add(post);

  const armMat = new THREE.MeshStandardMaterial({ color: 0x6e4e2a });
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4, 8), armMat);
  arm.rotation.z = Math.PI / 2;
  arm.position.y = 1.1;
  arm.castShadow = true;
  grp.add(arm);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), mat);
  head.position.y = 1.7;
  head.castShadow = true;
  grp.add(head);

  const anim = {
    mesh: grp,
    time: 0,
    play: () => {},
    update: dt => {},
    setDirection: () => {}
  };
  return { ent: { grp, anim }, data: { name: 'Target Dummy' }, lungeT: 0, lungeDX: 0, lungeDZ: 0, isMonster: true, isDummy: true };
}

// Parse URL Parameters
const urlParams = new URLSearchParams(window.location.search);
const paramMonsterId = urlParams.get('monster');
const paramScale = parseFloat(urlParams.get('scale')) || null;
const paramSprite = urlParams.get('sprite');
const paramName = urlParams.get('name');
/* The bestiary arena passes the live idle/attack atlas config so the preview
   animates exactly as configured in the editor. */
const paramAnimationsRaw = urlParams.get('animations');
let paramAnimations = null;
if (paramAnimationsRaw) {
  try { paramAnimations = JSON.parse(paramAnimationsRaw); } catch { paramAnimations = null; }
}

// Populate Attacker & Target Select Dropdowns with MONSTERS_ALL & HERO CLASSES
if (el.attackerSelect && el.targetSelect) {
  el.attackerSelect.innerHTML = '';
  el.targetSelect.innerHTML = '';

  const heroGroup = document.createElement('optgroup');
  heroGroup.label = '🧍 Heroes';
  heroGroup.appendChild(new Option('Fighter (Hero)', 'fighter'));
  heroGroup.appendChild(new Option('Wizard (Hero)', 'wizard'));
  heroGroup.appendChild(new Option('Rogue (Hero)', 'rogue'));
  heroGroup.appendChild(new Option('Cleric (Hero)', 'cleric'));
  heroGroup.appendChild(new Option('Ranger (Hero)', 'ranger'));
  heroGroup.appendChild(new Option('Paladin (Hero)', 'paladin'));
  heroGroup.appendChild(new Option('Warlock (Hero)', 'warlock'));

  const monGroup = document.createElement('optgroup');
  monGroup.label = '👾 Bestiary Monsters';
  MONSTERS_ALL.forEach(m => {
    monGroup.appendChild(new Option(`${m.name} (CR ${m.cr || 0})`, m.id));
  });

  el.attackerSelect.appendChild(heroGroup.cloneNode(true));
  el.attackerSelect.appendChild(monGroup.cloneNode(true));

  el.targetSelect.appendChild(new Option('Target Dummy', 'dummy'));
  el.targetSelect.appendChild(heroGroup.cloneNode(true));
  el.targetSelect.appendChild(monGroup.cloneNode(true));

  if (paramMonsterId) {
    el.attackerSelect.value = paramMonsterId;
  }
}

let attackerUnit = null;
let targetUnit = null;

let currentKey = '';

/* Cantrip preview keys use `cantrip:<classKey>`; resolve the playable caster
   classes' signature cantrips (those with a real cantripProfile) so the test
   page drives CANTRIP_FX exactly like the in-game strike() path. */
function cantripClassKey(value) {
  return value && value.startsWith('cantrip:') ? value.slice('cantrip:'.length) : null;
}

function cantripLabel(classKey) {
  return (CLASSES[classKey] && CLASSES[classKey].attack && CLASSES[classKey].attack.name) || classKey;
}

function updateSkillLabels() {
  const ck = cantripClassKey(currentKey);
  if (ck) {
    const label = cantripLabel(ck);
    if (el.skillName) el.skillName.textContent = label;
    if (el.infoLabel) el.infoLabel.textContent = label;
    return;
  }
  const fx = ABILITY_FX[currentKey] || BOSS_SPELL_FX[currentKey] || {};
  const label = fx.label || currentKey;
  if (el.skillName) el.skillName.textContent = label;
  if (el.infoLabel) el.infoLabel.textContent = label;
}

function buildUnit(presetKey, isAttacker) {
  const normKey = (presetKey || '').replace(/-/g, '_');
  const monData = MONSTERS_ALL.find(m => m.id === presetKey || m.id.replace(/-/g, '_') === normKey);

  if (monData || (isAttacker && paramMonsterId)) {
    const scale = (isAttacker && paramScale) ? paramScale : (monData ? monData.scale : 1.0);
    const sprite = (isAttacker && paramSprite) ? paramSprite : (monData ? monData.sprite : `${presetKey}.png`);
    const name = (isAttacker && paramName) ? paramName : (monData ? monData.name : presetKey);
    let fullData = monData || {};
    /* URL animations (from the bestiary arena) win over the monsters.json copy
       so the preview matches what the editor currently has configured. */
    if (paramAnimations && (paramAnimations.idle || paramAnimations.attack)) {
      fullData = { ...fullData, animations: paramAnimations };
    }
    return createMonster(name, sprite, scale, fullData);
  }

  switch (presetKey) {
    case 'wizard':
      return createHero('Mage', 'human', 'wizard', { hair: 'long/adult', hairColor: '#884422' });
    case 'fighter':
      return createHero('Fighter', 'dwarf', 'fighter', { hair: 'buzzcut/adult', hairColor: '#332211' });
    case 'rogue':
      return createHero('Rogue', 'elf', 'rogue', { hair: 'bangs/adult', hairColor: '#111111', skinColor: '#e0c8b0' });
    case 'cleric':
      return createHero('Cleric', 'human', 'cleric', { hair: 'buzzcut/adult', hairColor: '#aa7733' });
    case 'ranger':
      return createHero('Ranger', 'half-elf', 'ranger', { hair: 'long/adult', hairColor: '#554422' });
    case 'paladin':
      return createHero('Paladin', 'human', 'paladin', { hair: 'buzzcut/adult', hairColor: '#ddbb66' });
    case 'warlock':
      return createHero('Warlock', 'tiefling', 'warlock', { hair: 'long/adult', hairColor: '#991133', skinColor: '#d46666' });
    case 'dummy':
    default:
      return createDummy();
  }
}

function setupUnits() {
  if (attackerUnit) scene.remove(attackerUnit.ent.grp);
  if (targetUnit) scene.remove(targetUnit.ent.grp);

  const atkKey = el.attackerSelect?.value || paramMonsterId || 'fighter';
  const tgtKey = el.targetSelect?.value || 'dummy';

  attackerUnit = buildUnit(atkKey, true);
  targetUnit = buildUnit(tgtKey, false);

  attackerUnit.x = CASTER_X; attackerUnit.z = 0;
  attackerUnit.ent.grp.position.set(attackerUnit.x, 0, attackerUnit.z);
  scene.add(attackerUnit.ent.grp);

  targetUnit.x = TARGET_X; targetUnit.z = 0;
  targetUnit.ent.grp.position.set(targetUnit.x, 0, targetUnit.z);
  scene.add(targetUnit.ent.grp);

  attackerUnit.ent.anim?.setDirection(1, 0);
  targetUnit.ent.anim?.setDirection(-1, 0);

  populateSkillsForAttacker(attackerUnit);
}

function populateSkillsForAttacker(unit) {
  if (!el.select) return;
  el.select.innerHTML = '';

  const mData = unit?.data;
  const isMonster = unit?.isMonster;

  if (isMonster && mData) {
    const monId = mData.id || paramMonsterId;
    const profileGroup = document.createElement('optgroup');
    profileGroup.label = `👾 ${mData.name || 'Monster'} Profile Abilities`;

    // 1. Primary Melee Strike
    const primaryOpt = document.createElement('option');
    primaryOpt.value = 'monster_melee_attack';
    primaryOpt.textContent = `⚔️ ${mData.name} Primary Melee Attack`;
    profileGroup.appendChild(primaryOpt);

    // 2. Boss Spells & Abilities
    const spellIds = BOSS_SPELLS[monId] || [];
    spellIds.forEach(spId => {
      const fx = BOSS_SPELL_FX[spId] || {};
      const label = fx.label || spId;
      const opt = document.createElement('option');
      opt.value = spId;
      opt.textContent = `✨ Boss Ability: ${label}`;
      profileGroup.appendChild(opt);
    });

    // 3. Statblock Actions
    if (mData.statblock?.actions) {
      mData.statblock.actions.forEach((a, i) => {
        const opt = document.createElement('option');
        opt.value = `action_${i}`;
        opt.textContent = `🔥 Action: ${a.name}`;
        profileGroup.appendChild(opt);
      });
    }

    el.select.appendChild(profileGroup);
  }

  // Class Cantrips Group — plays each class's signature cantrip through
  // CANTRIP_FX, the same animated sheets the in-game strike() path uses.
  const cantripGroup = document.createElement('optgroup');
  cantripGroup.label = '🪄 Class Cantrips';
  Object.entries(CLASSES)
    .filter(([, c]) => c.attack && c.attack.cantripScale)
    .forEach(([classKey]) => {
      const opt = document.createElement('option');
      opt.value = `cantrip:${classKey}`;
      opt.textContent = `${cantripLabel(classKey)} (${classKey})`;
      cantripGroup.appendChild(opt);
    });
  el.select.appendChild(cantripGroup);

  // Full Game Catalog Group
  const catalogGroup = document.createElement('optgroup');
  catalogGroup.label = '🌟 All Game Spells & VFX';
  const keys = Object.keys(ABILITY_FX).sort((a, b) => {
    const la = ABILITY_FX[a].label || a;
    const lb = ABILITY_FX[b].label || b;
    return la.localeCompare(lb);
  });

  keys.forEach(k => {
    const fx = ABILITY_FX[k];
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = fx.label ? `${fx.label} (${k})` : k;
    catalogGroup.appendChild(opt);
  });
  el.select.appendChild(catalogGroup);

  if (el.select.options.length > 0) {
    el.select.selectedIndex = 0;
    currentKey = el.select.value;
    updateSkillLabels();
  }
}

setupUnits();

el.attackerSelect?.addEventListener('change', setupUnits);
el.targetSelect?.addEventListener('change', setupUnits);

el.select?.addEventListener('change', () => {
  currentKey = el.select.value;
  updateSkillLabels();
});

/* ─────────────────────────────────────────────────────────────
   ABILITY FX REGISTRY & EXECUTION PIPELINE
   ───────────────────────────────────────────────────────────── */

function getProjectileKind(key, fx) {
  if (fx.kind) return fx.kind;
  if (key.includes('fire') || key.includes('flame') || key.includes('inferno')) return 'fireball';
  if (key.includes('ice') || key.includes('frost') || key.includes('cold')) return 'ice';
  if (key.includes('lightning') || key.includes('thunder') || key.includes('storm')) return 'lightning';
  if (key.includes('acid') || key.includes('poison') || key.includes('venom')) return 'acid';
  if (key.includes('heal') || key.includes('holy') || key.includes('bless') || key.includes('divine')) return 'holy';
  if (key.includes('shadow') || key.includes('dark') || key.includes('necro') || key.includes('curse')) return 'shadow';
  return 'magic';
}

/* Replay a class cantrip the way the in-game auto-battler does (strike()):
   cast SFX → animated projectile (the class's Gigapack projSheet) → on hit the
   class's CANTRIP_FX pixel-art burst + impact ring + SFX. */
function playCantripVFX(classKey, source, target) {
  const cfx = CANTRIP_FX[classKey];
  if (!cfx) return;

  const sx = source.x, sz = source.z;
  const tx = target.x, tz = target.z;
  const color = cfx.color || 0xe8d8a8;
  const tScale = target.data?.scale || 1;

  if (el.sfxCb?.checked) playSfx(cantripSfx(classKey), { volume: 0.4 });

  const from = new THREE.Vector3(sx, 0.55, sz);
  const to = new THREE.Vector3(tx, 0.4 * tScale + 0.4, tz);

  spawnProjectile(scene, from, to, 'bolt', color, () => {
    if (target.dead) return;
    if (el.sfxCb?.checked) playSfx('spellImpact', { volume: 0.75 });
    spawnSlash(scene, { x: tx, z: tz }, color, tScale * 0.9);
    spawnSheetEffect(scene, cfx, to, cfx.scale * Math.max(1, tScale * 0.8), cfx.dur || 1.0);
    if (target.ent?.anim) target.ent.anim.play('hit');
  }, { sheetDef: cfx.projSheet ? GIGAPACK_REGISTRY[cfx.projSheet] : null, scale: 1.4 });
}

function playSkillVFX(key, source, target) {
  if (!source || !target) return;

  const sx = source.x, sz = source.z;
  const tx = target.x, tz = target.z;

  // Class cantrips — replay the in-game strike() path (projectile + the
  // class's CANTRIP_FX pixel-art impact burst).
  const ck = cantripClassKey(key);
  if (ck) {
    playCantripVFX(ck, source, target);
    return;
  }

  const mData = source.data || {};
  const isMonsterMelee = (key === 'monster_melee_attack' || key.startsWith('action_'));

  // Melee Attack Lunge Animation
  source.lungeT = 1.0;
  source.lungeDX = (tx - sx) * 0.45;
  source.lungeDZ = (tz - sz) * 0.45;
  if (source.ent?.anim) source.ent.anim.play('attack');

  // Universal Monster Melee Strike
  if (isMonsterMelee) {
    setTimeout(() => {
      const hitPos = new THREE.Vector3(tx, 0.8, tz);
      spawnSlash(scene, { x: tx, z: tz }, mData.color || 0xef4444, 1.5);
      const dmg = Math.floor(Math.random() * 20) + 12;
      makeFloatText(scene, `-${dmg} HP!`, hitPos, '#ef4444');

      if (el.sfxCb?.checked) playSfx('swordAttack', { volume: 0.7 });
      shakeCamera(0.35);
      if (target.ent?.anim) target.ent.anim.play('hit');
    }, 280);
    return;
  }

  const fx = ABILITY_FX[key] || BOSS_SPELL_FX[key] || { label: key, color: 0xffaa22, isRanged: true };
  const isRanged = fx.isRanged ?? true;
  const color = fx.color ?? 0xffaa22;

  const triggerImpact = (fxRef, impactX, impactZ, opts = {}) => {
    const fxr = fxRef || fx;
    const hitPos = new THREE.Vector3(impactX, 0.8, impactZ);
    const scale = opts.scale != null ? opts.scale : (fxr.scale || 1.2);
    const dur = opts.dur != null ? opts.dur : (fxr.dur || 0.6);

    const sheetDef = fxr.sheetDef || (fxr.sheetKey ? GIGAPACK_REGISTRY[fxr.sheetKey] : null);
    if (sheetDef) spawnSheetEffect(scene, sheetDef, hitPos, scale, dur);
    if (fxr.sprite) {
      const spriteDef = fxr.frames ? { sprite: fxr.sprite, frames: fxr.frames, frameInterval: fxr.frameInterval } : fxr.sprite;
      spawnSpriteEffect(scene, spriteDef, hitPos, scale, dur);
    }
    if (fxr.color != null) spawnSlash(scene, { x: impactX, z: impactZ }, fxr.color, opts.ring != null ? opts.ring : 1.4);
    if (fxr.label) makeFloatText(scene, fxr.label, _v.set(impactX, 1.6, impactZ), fxr.float || '#e8c25a');

    shakeCamera(0.32);
    if (target.ent?.anim) target.ent.anim.play('hit');
  };

  // If real SPELLS entry exists, execute its cast function!
  if (SPELLS[key] && typeof SPELLS[key].cast === 'function') {
    const gameMock = {
      engine: { scene },
      monsters: [target],
      heroes: [source],
      summons: { spawn: () => null },
      fxNow: performance.now() / 1000,
      _v3(x, y, z) { return new THREE.Vector3(x, y, z); },
      fxLog() {},
      fxPlaySfx(name, opts) { if (el.sfxCb?.checked) playSfx(name, opts); },
      fxSchedule(delayMs, cb) { setTimeout(cb, delayMs); },
      /* Faithful replica of combat.playAbilityFx: honors at/alsoAt/ring/scale/
         dur/floatY so AoE spells show every cluster burst at the right size. */
      playAbilityFx(h, k, opts = {}) {
        if (el.sfxCb?.checked) playSfx(spellSfx(k), { volume: 0.65 });
        const fxr = ABILITY_FX[k] || { sprite: 'dcss/effect/magic_bolt_1.png', color: 0xc0a060, label: null, float: '#e8c25a' };
        const at = opts.at || h;
        const atX = at.x != null ? at.x : tx;
        const atZ = at.z != null ? at.z : tz;
        const scale = opts.scale != null ? opts.scale : (fxr.scale || 2.0);
        const dur = opts.dur != null ? opts.dur : (fxr.dur || 0.45);

        const sheetDef = fxr.sheetDef || (fxr.sheetKey ? GIGAPACK_REGISTRY[fxr.sheetKey] : null);
        if (sheetDef) spawnSheetEffect(scene, sheetDef, new THREE.Vector3(atX, 0.55, atZ), scale, dur);
        if (fxr.sprite) {
          const spriteDef = fxr.frames ? { sprite: fxr.sprite, frames: fxr.frames, frameInterval: fxr.frameInterval } : fxr.sprite;
          spawnSpriteEffect(scene, spriteDef, new THREE.Vector3(atX, 0.55, atZ), scale, dur);
        }
        if (fxr.color != null) spawnSlash(scene, { x: atX, z: atZ }, fxr.color, opts.ring != null ? opts.ring : 1.2);
        if (fxr.label) makeFloatText(scene, fxr.label, new THREE.Vector3(atX, opts.floatY != null ? opts.floatY : 1.35, atZ), fxr.float || '#e8c25a');

        for (const t of opts.alsoAt || []) {
          if (!t || t === at) continue;
          const x = t.x != null ? t.x : tx;
          const z = t.z != null ? t.z : tz;
          if (sheetDef) spawnSheetEffect(scene, sheetDef, new THREE.Vector3(x, 0.45, z), scale * 0.85, dur * 0.9);
          if (fxr.sprite) {
            const spriteDef2 = fxr.frames ? { sprite: fxr.sprite, frames: fxr.frames, frameInterval: fxr.frameInterval } : fxr.sprite;
            spawnSpriteEffect(scene, spriteDef2, new THREE.Vector3(x, 0.45, z), scale * 0.85, dur * 0.9);
          }
          if (fxr.color != null) spawnSlash(scene, { x, z }, fxr.color, 0.9);
        }
      },
      fxProjectile(from, to, kind, col, onHit, opts) {
        spawnProjectile(scene, from, to, kind, col, onHit, opts);
      },
      fxBeam(from, to, opts) {
        spawnBeamEffect(scene, from, to, opts);
      },
      fxSprite(path, pos, scale, dur) {
        spawnSpriteEffect(scene, path, pos, scale, dur);
      },
      fxSlash(pos, col, size) {
        spawnSlash(scene, pos, col, size);
      },
      fxText(text, pos, col) {
        makeFloatText(scene, text, pos, col);
      },
      healHero(a, amt) {
        if (!a || !a.data) return;
        if (a.data.maxHp != null && a.data.hp != null) {
          a.data.hp = Math.min(a.data.maxHp, (a.data.hp || 0) + amt);
        }
        const x = a.x != null ? a.x : tx, z = a.z != null ? a.z : tz;
        makeFloatText(scene, `+${amt}`, _v.set(x, 1.3, z), '#6ae06a');
        spawnSpriteEffect(scene, 'dcss/effect/gold_sparkles_1.png', new THREE.Vector3(x, 1.0, z), 1.4, 0.5);
      },
      resolveMoonbeamDamage(zone, m) {
        if (!m || m.dead) return;
        const from = new THREE.Vector3(m.x, 6.0, m.z);
        const to = new THREE.Vector3(m.x, 0.4, m.z);
        spawnBeamEffect(scene, from, to, {
          type: 'pillar', color: 0xb08cff, coreColor: 0xffffff,
          width: 1.6, duration: 0.7, targetBurst: 'round_light_burst_001_large_yellow'
        });
        makeFloatText(scene, '2d10 radiant', _v.set(m.x, 1.4, m.z), '#b08cff');
      },
      spellDamage(m, dmg) {
        triggerImpact(fx, m.x, m.z);
      },
      spellSave() { return false; },
      markSpellUsed() {},
      concentrate() {},
      /* Render the real persistent-zone visual (faerie fire sparkle cube, web,
         moonbeam beam, wall of fire loop sheet, entangle vines…). A finite
         duration keeps previewed zones from piling up while looping. */
      spawnAoEZone(caster, spellKey, x, z, radius, options = {}) {
        const visual = spawnAoEVisual(scene, { x, z }, options.color || 0xffffff, radius, 4.0, { ...options });
        return { id: 'z_test', caster, spellKey, x, z, radius, visual, options, savesThisTurn: new Set(), affectedTargets: new Set(), data: { hp: 1 } };
      }
    };

    const res = SPELLS[key].cast(gameMock, source, target, [source], 1);
    if (res !== false) return;
  }

  // Fallback for non-SPELLS active abilities
  if (el.sfxCb?.checked) {
    if (isRanged) playSfx('spellFire', { volume: 0.7 });
    else if (fx.label === '2nd WIND' || fx.label === 'HEAL') playSfx('spellBuff', { volume: 0.7 });
    else playSfx('swordAttack', { volume: 0.7 });
  }

  if (isRanged) {
    const from = new THREE.Vector3(sx, 0.6, sz);
    const to = new THREE.Vector3(tx, 0.5, tz);
    const projKind = getProjectileKind(key, fx);
    const projSheet = fx.projSheet || 'directional_fire_burst_001_large_red';

    spawnProjectile(scene, from, to, projKind, color, () => {
      triggerImpact(fx, tx, tz);
    }, { projSheet });
  } else {
    triggerImpact(fx, tx, tz);
  }
}

/* Play button & Selection Event Handlers */
el.playBtn.addEventListener('click', () => {
  currentKey = el.select.value;
  updateSkillLabels();
  playSkillVFX(currentKey, attackerUnit, targetUnit);
});

window.addEventListener('keydown', e => {
  if (e.code === 'Space' && document.activeElement.tagName !== 'SELECT' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    currentKey = el.select.value;
    updateSkillLabels();
    playSkillVFX(currentKey, attackerUnit, targetUnit);
  }
});

/* Loop Timer */
let loopTimer = null;

function resetLoop() {
  if (loopTimer) clearInterval(loopTimer);
  if (el.loopCb.checked) {
    const sec = parseFloat(el.interval.value);
    loopTimer = setInterval(() => {
      currentKey = el.select.value;
      updateSkillLabels();
      playSkillVFX(currentKey, attackerUnit, targetUnit);
    }, sec * 1000);
  }
}

el.loopCb.addEventListener('change', resetLoop);
el.interval.addEventListener('input', () => {
  el.intervalVal.textContent = parseFloat(el.interval.value).toFixed(1) + 's';
  resetLoop();
});
resetLoop();

/* ─────────────────────────────────────────────────────────────
   Main Animation Loop
   ───────────────────────────────────────────────────────────── */
let lastTime = performance.now();

function animate(time) {
  requestAnimationFrame(animate);

  const dt = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;

  // Lunge Recovery for Attacker & Target
  [attackerUnit, targetUnit].forEach(u => {
    if (!u) return;
    if (u.lungeT > 0) {
      u.lungeT -= dt * 4.0;
      if (u.lungeT < 0) u.lungeT = 0;
      const factor = Math.sin(u.lungeT * Math.PI);
      u.ent.grp.position.x = u.x + u.lungeDX * factor;
      u.ent.grp.position.z = u.z + u.lungeDZ * factor;
    }

    if (u.ent.anim) u.ent.anim.update(dt);
  });

  // Update Three.js FX
  updateProjectiles(scene, dt);
  updateWorldFx(scene, dt);
  updateFloatTexts(scene, cam);

  // Camera Shake Decay
  if (shakeIntensity > 0) {
    shakeIntensity = Math.max(0, shakeIntensity - dt * 2.5);
    updateCamera();
  }

  renderer.render(scene, cam);
}

requestAnimationFrame(animate);
