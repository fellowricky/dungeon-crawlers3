/**
 * VFX Animation Editor (/test-skills.html)
 *
 * Composes a composite VFX animation from up to four depth-stacked layers
 * (travel back/front + impact back/front), each a sprite sheet, a static
 * sprite, or a procedural effect, with per-layer color/opacity/blend/scale
 * plus travel & impact sound slots. Previews use the exact same runtime the
 * game uses (src/game/vfx_animations.js). "Save to Project" writes
 * src/game/vfx_animations.json via the /api/save-vfx-anims dev endpoint so
 * the effect plays in-game immediately.
 */

import * as THREE from 'three';
import { makeHero, MONSTERS_ALL } from './game/srd.js';
import {
  makeHeroMesh, makeMonsterMesh, updateProjectiles, updateWorldFx, updateFloatTexts,
  spawnAoEVisual,
} from './game/entities.js';
import { GIGAPACK_REGISTRY } from './game/gigapack_registry.js';
import { SOUND_META, playSfx, initAudio, getSfxVolume, setSfxVolume, getMusicVolume, setMusicVolume, SPELL_SFX } from './game/audio.js';
import { SPELLS } from './game/spells.js';
import { ABILITY_FX } from './game/combat.js';
import {
  VFX_LIB, VFX_ANIMS, VFX_SHEET_LIBRARY, CANTRIP_ANIM_BINDINGS,
  spawnCompositeAnimation, updateCompositeFX,
} from './game/vfx_animations.js';

/* ─────────────────────────────────────────────────────────────
   DOM
   ───────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const el = {
  animSelect: $('anim-select'), animName: $('anim-name'), animNameInput: $('anim-name-input'),
  playBtn: $('play-btn'), loopCb: $('loop-cb'), interval: $('interval'), intervalVal: $('interval-val'),
  skipTravelCb: $('skip-travel-cb'), sfxCb: $('sfx-cb'),
  attackerSelect: $('attacker-select'), targetSelect: $('target-select'),
  themeSelect: $('theme-select'), camPreset: $('cam-preset'), resetCamBtn: $('reset-cam-btn'),
  infoLabel: $('info-label'),
  animNew: $('anim-new'), animDup: $('anim-dup'), animDel: $('anim-del'),
  travelDur: $('travel-dur'), travelDurVal: $('travel-dur-val'),
  travelArc: $('travel-arc'), travelArcVal: $('travel-arc-val'),
  travelSound: $('travel-sound'), impactSound: $('impact-sound'),
  playTravelSound: $('play-travel-sound'), playImpactSound: $('play-impact-sound'),
  sfxVol: $('sfx-vol'), sfxVolVal: $('sfx-vol-val'),
  musicVol: $('music-vol'), musicVolVal: $('music-vol-val'), testSound: $('test-sound'),
  layersContainer: $('layers-container'),
  saveBtn: $('save-btn'), downloadBtn: $('download-btn'), loadBtn: $('load-btn'), loadFile: $('load-file'),
  saveStatus: $('save-status'),
};

/* ─────────────────────────────────────────────────────────────
   Three.js scene + camera (same scaffolding as the old test page)
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
scene.fog = new THREE.FogExp2(0x0c0e18, 0.015);

const cam = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 120);
let yaw = Math.PI / 4, pitch = 0.55, camDistance = 16.5;
const camTarget = new THREE.Vector3(0, 0.6, 0);

function updateCamera() {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  cam.position.set(
    camTarget.x + cp * Math.sin(yaw) * camDistance,
    camTarget.y + sp * camDistance,
    camTarget.z + cp * Math.cos(yaw) * camDistance
  );
  cam.lookAt(camTarget);
}
updateCamera();

const canvas = renderer.domElement;
let isDragging = false, isOrbiting = false, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', e => {
  isOrbiting = e.button === 2 || (e.button === 0 && e.shiftKey);
  isDragging = e.button === 0 && !e.shiftKey;
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('pointermove', e => {
  if (!isDragging && !isOrbiting) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  if (isOrbiting) { yaw -= dx * 0.006; pitch = Math.max(0.1, Math.min(1.4, pitch + dy * 0.006)); }
  else {
    const panSpeed = camDistance * 0.0008;
    camTarget.x -= Math.cos(yaw) * dx * panSpeed;
    camTarget.z += Math.sin(yaw) * dx * panSpeed;
    camTarget.y += dy * panSpeed;
  }
  lastX = e.clientX; lastY = e.clientY;
  updateCamera();
});
window.addEventListener('pointerup', () => { isDragging = false; isOrbiting = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  camDistance = Math.max(4, Math.min(36, camDistance + e.deltaY * 0.012));
  updateCamera();
}, { passive: false });

const CAM_PRESETS = {
  iso: { yaw: Math.PI / 4, pitch: 0.55, dist: 16.5 },
  front: { yaw: 0, pitch: 0.2, dist: 14.0 },
  top: { yaw: 0, pitch: 1.35, dist: 18.0 },
  close: { yaw: Math.PI / 6, pitch: 0.35, dist: 8.5 },
};
function setCamPreset(key) {
  const p = CAM_PRESETS[key] || CAM_PRESETS.iso;
  yaw = p.yaw; pitch = p.pitch; camDistance = p.dist;
  updateCamera();
}
el.camPreset?.addEventListener('change', () => setCamPreset(el.camPreset.value));
el.resetCamBtn?.addEventListener('click', () => { el.camPreset.value = 'iso'; setCamPreset('iso'); });
window.addEventListener('resize', () => {
  cam.aspect = innerWidth / innerHeight;
  cam.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ── room + theme (trimmed from the test page) ───────────────────────── */
const roomGroup = new THREE.Group();
scene.add(roomGroup);
const ambientLight = new THREE.AmbientLight(0x283044, 1.2);
scene.add(ambientLight);
const hemiLight = new THREE.HemisphereLight(0x3a4868, 0x0c0e18, 0.9);
scene.add(hemiLight);
const dirLight = new THREE.DirectionalLight(0xffedd4, 1.8);
dirLight.position.set(8, 14, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.bias = -0.0005;
scene.add(dirLight);

const floorMaterials = [];
let wallMaterial;
function buildFloor() {
  const tileGeom = new THREE.BoxGeometry(1.35 * 0.96, 0.12, 1.35 * 0.96);
  wallMaterial = new THREE.MeshStandardMaterial({ color: 0x181c2d, roughness: 0.9, metalness: 0.1 });
  for (let x = -8; x < 8; x++) {
    for (let z = -8; z < 8; z++) {
      const shade = (Math.abs(x + z) % 2 === 0) ? 0x1d2236 : 0x181c2d;
      const mat = new THREE.MeshStandardMaterial({ color: shade, roughness: 0.82, metalness: 0.1 });
      floorMaterials.push(mat);
      const tile = new THREE.Mesh(tileGeom, mat);
      tile.position.set(x * 1.35 + 0.675, -0.06, z * 1.35 + 0.675);
      tile.receiveShadow = true;
      roomGroup.add(tile);
    }
  }
}
buildFloor();
const backWall = new THREE.Mesh(new THREE.BoxGeometry(22, 6, 0.6), wallMaterial);
backWall.position.set(0, 3, -10.5);
backWall.receiveShadow = true; backWall.castShadow = true;
roomGroup.add(backWall);

const THEME_CONFIGS = {
  ancient: { bg: 0x090a10, floor1: 0x1d2236, floor2: 0x181c2d, wall: 0x181c2d, hemiUp: 0x3a4868, hemiDown: 0x0c0e18, dir: 0xffedd4 },
  necropolis: { bg: 0x050b10, floor1: 0x12202e, floor2: 0x0c1722, wall: 0x0e1b28, hemiUp: 0x205068, hemiDown: 0x050c12, dir: 0x8ce0ff },
  inferno: { bg: 0x120606, floor1: 0x2d1717, floor2: 0x221010, wall: 0x241111, hemiUp: 0x682828, hemiDown: 0x120606, dir: 0xff8844 },
  overgrown: { bg: 0x061009, floor1: 0x172b1d, floor2: 0x112115, wall: 0x122416, hemiUp: 0x3a6842, hemiDown: 0x061009, dir: 0xd4ffaa },
};
function applyTheme(key) {
  const cfg = THEME_CONFIGS[key] || THEME_CONFIGS.ancient;
  renderer.setClearColor(cfg.bg);
  scene.fog.color.set(cfg.bg);
  if (wallMaterial) wallMaterial.color.set(cfg.wall);
  floorMaterials.forEach((m, i) => m.color.set(i % 2 === 0 ? cfg.floor1 : cfg.floor2));
  hemiLight.color.set(cfg.hemiUp);
  hemiLight.groundColor.set(cfg.hemiDown);
  dirLight.color.set(cfg.dir);
}
el.themeSelect?.addEventListener('change', () => applyTheme(el.themeSelect.value));
applyTheme('ancient');

/* ── units (caster + target) ──────────────────────────────────────────── */
let attackerUnit = null, targetUnit = null;

function createHero(name, raceKey, classKey, visual = {}) {
  const heroData = makeHero(name, raceKey, classKey, {
    str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14,
  }, { gender: 'male', hair: 'bangs/adult', skinColor: '#e8c088', hairColor: '#553311', eyeColor: '#4488cc', ...visual });
  const mesh = makeHeroMesh(heroData);
  return { ent: mesh, data: heroData, x: 0, z: 0, isMonster: false };
}

function createMonster(name, sprite, scale = 1.0, fullData = {}) {
  const mon = { hp: 100, maxHp: 100, ...fullData, name, sprite, scale };
  const mesh = makeMonsterMesh(mon);
  return { ent: mesh, data: mon, x: 0, z: 0, isMonster: true };
}

function createDummy() {
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8b6538, roughness: 0.8 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.6, 12), mat);
  post.position.y = 0.8; post.castShadow = true;
  grp.add(post);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4, 8), new THREE.MeshStandardMaterial({ color: 0x6e4e2a }));
  arm.rotation.z = Math.PI / 2; arm.position.y = 1.1; arm.castShadow = true;
  grp.add(arm);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 12), mat);
  head.position.y = 1.7; head.castShadow = true;
  grp.add(head);
  return { ent: { grp }, data: { name: 'Target Dummy', scale: 1.0 }, x: 0, z: 0, isMonster: true, isDummy: true };
}

const HERO_PRESETS = {
  wizard: ['Mage', 'human', 'wizard', { hair: 'long/adult', hairColor: '#884422' }],
  sorcerer: ['Sorc', 'human', 'sorcerer', { hair: 'long/adult', hairColor: '#773311' }],
  cleric: ['Cleric', 'human', 'cleric', { hair: 'buzzcut/adult', hairColor: '#aa7733' }],
  druid: ['Druid', 'elf', 'druid', { hair: 'long/adult', hairColor: '#554422' }],
  warlock: ['Warlock', 'tiefling', 'warlock', { hair: 'long/adult', hairColor: '#991133', skinColor: '#d46666' }],
  fighter: ['Fighter', 'dwarf', 'fighter', { hair: 'buzzcut/adult', hairColor: '#332211' }],
};

function buildUnit(presetKey) {
  const normKey = (presetKey || '').replace(/-/g, '_');
  const monData = MONSTERS_ALL.find(m => m.id === presetKey || m.id.replace(/-/g, '_') === normKey);
  if (monData) {
    return createMonster(monData.name, monData.sprite, monData.scale || 1.0, monData);
  }
  if (HERO_PRESETS[presetKey]) {
    return createHero(...HERO_PRESETS[presetKey]);
  }
  return createDummy();
}

function setupUnits() {
  if (attackerUnit) scene.remove(attackerUnit.ent.grp);
  if (targetUnit) scene.remove(targetUnit.ent.grp);
  attackerUnit = buildUnit(el.attackerSelect.value);
  targetUnit = buildUnit(el.targetSelect.value);
  attackerUnit.x = -3.5; attackerUnit.z = 0;
  targetUnit.x = 3.5; targetUnit.z = 0;
  attackerUnit.ent.grp.position.set(attackerUnit.x, 0, attackerUnit.z);
  targetUnit.ent.grp.position.set(targetUnit.x, 0, targetUnit.z);
  scene.add(attackerUnit.ent.grp);
  scene.add(targetUnit.ent.grp);
}
setupUnits();
el.attackerSelect.addEventListener('change', setupUnits);
el.targetSelect.addEventListener('change', setupUnits);

/* ─────────────────────────────────────────────────────────────
   Editor state
   ───────────────────────────────────────────────────────────── */
const LAYER_KEYS = ['travel.back', 'travel.front', 'impact.back', 'impact.front'];
const PHASE_LABELS = { travel: 'Travel', impact: 'Impact' };

/* Working copy of the animation library (deep-cloned from the JSON the game
   imports, so unsaved edits never touch game state). */
const lib = {
  _comment: VFX_LIB._comment,
  cantripBindings: { ...CANTRIP_ANIM_BINDINGS },
  sheets: { ...VFX_SHEET_LIBRARY },
  anims: JSON.parse(JSON.stringify(VFX_ANIMS)),
};
let currentId = Object.keys(lib.anims)[0] || 'new';
let editing = null;
const soloMap = { 'travel.back': false, 'travel.front': false, 'impact.back': false, 'impact.front': false };

function hexNumToCss(n) {
  if (n == null) return '#ffffff';
  return '#' + Math.max(0, Math.min(0xffffff, n)).toString(16).padStart(6, '0');
}

function emptyLayer() {
  return { enabled: false, type: 'none', color: '#ffffff', scale: 1.5, dur: 0.5, opacity: 0.9, blend: 'additive' };
}

/* Build a sensible starting composite for a spell / class feature from its
   existing ABILITY_FX burst (sheet / sprite / ring) + SFX slot. Travel layers
   are disabled by default because most spells already drive their own
   projectile or beam — enable them in the editor if you want a travel phase. */
function generateSpellAnim(k) {
  const fx = ABILITY_FX[k] || {};
  const sp = SPELLS[k] || {};
  const color = hexNumToCss(fx.color != null ? fx.color : sp.color);
  const scale = fx.scale || 1.6;
  const dur = fx.dur || 0.45;
  const impact = { delay: 0, back: emptyLayer(), front: emptyLayer() };
  if (fx.sheetKey) {
    impact.back = { enabled: true, type: 'sheet', sheet: 'gigapack:' + fx.sheetKey, fps: 20, color: '#ffffff', scale, dur, opacity: 0.9, blend: 'additive' };
  } else {
    impact.back = { enabled: true, type: 'procedural', kind: 'glow', color, scale: scale * 0.9, dur, opacity: 0.5, blend: 'additive' };
  }
  if (fx.sprite) {
    impact.front = { enabled: true, type: 'sprite', path: fx.sprite, frames: fx.frames, frameInterval: fx.frameInterval, color: '#ffffff', scale: scale * 0.9, dur, opacity: 0.95, blend: 'additive' };
  } else {
    impact.front = { enabled: true, type: 'procedural', kind: 'ring', color, scale: 1.2, dur: 0.35, opacity: 1, blend: 'normal' };
  }
  return {
    name: sp.label || fx.label || k, generated: true,
    travelSound: SPELL_SFX[k] || '', impactSound: 'spellImpact',
    travel: {
      duration: 0.5, arc: 0,
      back: { enabled: false, type: 'procedural', kind: 'glow', color, scale: 1.5, dur: 0.5, opacity: 0.45, blend: 'additive' },
      front: { enabled: false, type: 'sheet', sheet: 'gigapack:round_sparkle_burst_003_large_red', color: '#ffffff', scale: 1.3, dur: 0.5, opacity: 0.9, blend: 'additive' },
    },
    impact,
  };
}

/* Every spell / class feature without an authored animation gets a generated
   starting point (marked `generated`) so the whole catalog is editable. Only
   authored or edited entries are written back on save. */
const modifiedIds = new Set();
function markModified(id) {
  if (!id || !lib.anims[id]) return;
  modifiedIds.add(id);
  delete lib.anims[id].generated;
}

const catalogKeys = [...new Set([...Object.keys(SPELLS), ...Object.keys(ABILITY_FX)])].sort();
for (const k of catalogKeys) {
  if (lib.anims[k]) continue;
  lib.anims[k] = generateSpellAnim(k);
}

function layerRef(key) {
  const [phase, slot] = key.split('.');
  return editing && editing[phase] ? editing[phase][slot] : null;
}

function defaultAnim() {
  return {
    name: 'New Animation', travelSound: '', impactSound: '',
    travel: {
      duration: 0.6, arc: 0,
      back: { enabled: false, type: 'none', color: '#ffffff', scale: 1.5, dur: 0.5, opacity: 0.9, blend: 'additive' },
      front: { enabled: true, type: 'sheet', sheet: 'gigapack:round_sparkle_burst_003_large_red', color: '#ffffff', scale: 1.4, dur: 0.5, opacity: 0.9, blend: 'additive' },
    },
    impact: {
      delay: 0,
      back: { enabled: false, type: 'none', color: '#ffffff', scale: 2.0, dur: 0.6, opacity: 0.9, blend: 'additive' },
      front: { enabled: true, type: 'procedural', kind: 'ring', color: '#ffd34a', scale: 1.2, dur: 0.35, opacity: 1, blend: 'normal' },
    },
  };
}

function selectAnim(id) {
  if (!lib.anims[id]) return;
  currentId = id;
  editing = lib.anims[id];
  /* Normalize any hand-edited/loaded animation that lacks a phase. */
  const dflt = defaultAnim();
  editing.travel = editing.travel || JSON.parse(JSON.stringify(dflt.travel));
  editing.impact = editing.impact || JSON.parse(JSON.stringify(dflt.impact));
  editing.travel.duration = editing.travel.duration != null ? editing.travel.duration : 0.6;
  editing.travel.arc = editing.travel.arc != null ? editing.travel.arc : 0;
  el.animSelect.value = id;
  el.animName.textContent = editing.name;
  el.animNameInput.value = editing.name;
  el.infoLabel.textContent = editing.name;
  el.travelDur.value = editing.travel.duration;
  el.travelDurVal.textContent = editing.travel.duration.toFixed(2) + 's';
  el.travelArc.value = editing.travel.arc;
  el.travelArcVal.textContent = editing.travel.arc.toFixed(2);
  el.travelSound.value = editing.travelSound || '';
  el.impactSound.value = editing.impactSound || '';
  renderLayers();
}

function repopulateAnimSelect() {
  el.animSelect.innerHTML = '';
  const authored = document.createElement('optgroup');
  authored.label = '🎨 Authored / Edited';
  const defaults = document.createElement('optgroup');
  defaults.label = '📚 All Spells & Abilities (defaults)';
  for (const id of Object.keys(lib.anims)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = lib.anims[id].name || id;
    if (lib.anims[id].generated) defaults.appendChild(opt);
    else authored.appendChild(opt);
  }
  el.animSelect.appendChild(authored);
  el.animSelect.appendChild(defaults);
  el.animSelect.value = currentId;
}

/* ─────────────────────────────────────────────────────────────
   Sound selects
   ───────────────────────────────────────────────────────────── */
const CAT_ORDER = ['cantrip', 'element', 'school', 'support', 'melee', 'ranged', 'world', 'skill', 'other'];
function populateSoundSelect(sel) {
  const prev = sel.value;
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = ''; none.textContent = '— none —';
  sel.appendChild(none);
  const groups = {};
  for (const [name, meta] of Object.entries(SOUND_META)) {
    const cat = meta.category || 'other';
    (groups[cat] ||= []).push(name);
  }
  for (const cat of CAT_ORDER) {
    const names = groups[cat];
    if (!names || !names.length) continue;
    const og = document.createElement('optgroup');
    og.label = cat;
    for (const name of names.sort()) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name + (metaHasAudio(SOUND_META[name]) ? '' : ' (fallback)');
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}
function metaHasAudio(meta) { return !!meta && Array.isArray(meta.files) && meta.files.length > 0; }
populateSoundSelect(el.travelSound);
populateSoundSelect(el.impactSound);

/* ─────────────────────────────────────────────────────────────
   Layer controls
   ───────────────────────────────────────────────────────────── */
const PROC_KINDS = [
  ['burst', 'Particle Burst'], ['ring', 'Ground Ring'], ['beam', 'Beam'],
  ['sparkles', 'Rising Sparkles'], ['vines', 'Vine Cluster'], ['glow', 'Glow Orb'], ['smoke', 'Smoke Puffs'],
];
const BURST_TYPES = [['fire', 'Fire'], ['frost', 'Frost'], ['lightning', 'Lightning'], ['poison', 'Poison'], ['holy', 'Holy'], ['dark', 'Dark'], ['magic', 'Magic']];
const BEAM_TYPES = [['ray', 'Ray'], ['pillar', 'Pillar'], ['lightning', 'Lightning']];

function sheetOptions(selected) {
  const frag = document.createDocumentFragment();
  const customNames = Object.keys(lib.sheets);
  if (customNames.length) {
    const og = document.createElement('optgroup');
    og.label = 'Custom Sheets';
    for (const name of customNames) {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      if (name === selected) opt.selected = true;
      og.appendChild(opt);
    }
    frag.appendChild(og);
  }
  const byCat = {};
  for (const [key, def] of Object.entries(GIGAPACK_REGISTRY)) {
    (byCat[def.category || 'Other'] ||= []).push(key);
  }
  for (const cat of Object.keys(byCat).sort()) {
    const og = document.createElement('optgroup');
    og.label = 'Gigapack · ' + cat;
    for (const key of byCat[cat].sort()) {
      const opt = document.createElement('option');
      opt.value = 'gigapack:' + key;
      opt.textContent = key;
      if ('gigapack:' + key === selected) opt.selected = true;
      og.appendChild(opt);
    }
    frag.appendChild(og);
  }
  return frag;
}

function firstSheetRef() {
  const custom = Object.keys(lib.sheets)[0];
  if (custom) return custom;
  const first = Object.keys(GIGAPACK_REGISTRY)[0];
  return first ? 'gigapack:' + first : '';
}

function trow(label, control) {
  const row = document.createElement('div');
  row.className = 'trow';
  const lab = document.createElement('label');
  lab.textContent = label;
  row.appendChild(lab);
  row.appendChild(control);
  return row;
}
function numControl(value, min, max, step, onInput) {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.value = value; inp.min = min; inp.max = max; inp.step = step;
  inp.addEventListener('input', () => onInput(parseFloat(inp.value)));
  return inp;
}
function selControl(options, value, onInput) {
  const sel = document.createElement('select');
  for (const [v, label] of options) {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = label;
    if (v === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onInput(sel.value));
  return sel;
}

function buildTypeControls(container, key) {
  container.innerHTML = '';
  const layer = layerRef(key);
  if (!layer) return;

  if (layer.type === 'none') {
    const p = document.createElement('div');
    p.className = 'trow';
    p.style.color = '#5a6480';
    p.textContent = 'Layer disabled.';
    container.appendChild(p);
    return;
  }

  if (layer.type === 'sheet') {
    const sel = document.createElement('select');
    sel.appendChild(sheetOptions(layer.sheet));
    sel.addEventListener('change', () => { markModified(currentId); layer.sheet = sel.value; });
    container.appendChild(trow('Sheet', sel));
    if (!layer.sheet && sel.options[0]) layer.sheet = sel.options[0].value;
    const fps = numControl(layer.fps || 30, 1, 90, 1, v => { markModified(currentId); layer.fps = v; });
    container.appendChild(trow('FPS', fps));
  } else if (layer.type === 'sprite') {
    const path = document.createElement('input');
    path.type = 'text';
    path.placeholder = 'dcss/effect/...png';
    path.value = layer.path || '';
    path.addEventListener('input', () => { markModified(currentId); layer.path = path.value; });
    container.appendChild(trow('Sprite path', path));
  } else if (layer.type === 'procedural') {
    if (!layer.kind) layer.kind = 'glow';
    const kind = selControl(PROC_KINDS, layer.kind, v => {
      markModified(currentId);
      layer.kind = v;
      buildTypeControls(container, key);
    });
    container.appendChild(trow('Kind', kind));
    const k = layer.kind;
    if (k === 'burst') {
      container.appendChild(trow('Burst type', selControl(BURST_TYPES, layer.burstType || 'magic', v => { markModified(currentId); layer.burstType = v; })));
      container.appendChild(trow('Count', numControl(layer.count || 16, 2, 60, 1, v => { markModified(currentId); layer.count = v; })));
    } else if (k === 'beam') {
      container.appendChild(trow('Beam type', selControl(BEAM_TYPES, layer.beamType || 'ray', v => { markModified(currentId); layer.beamType = v; })));
    } else if (k === 'sparkles' || k === 'vines') {
      container.appendChild(trow('Radius', numControl(layer.radius || 2, 0.5, 6, 0.1, v => { markModified(currentId); layer.radius = v; })));
    } else if (k === 'smoke') {
      container.appendChild(trow('Puffs', numControl(layer.count || 8, 2, 40, 1, v => { markModified(currentId); layer.count = v; })));
    }
  }
}

function buildCommonControls(container, key) {
  const layer = layerRef(key);
  if (!layer) return;

  const color = document.createElement('input');
  color.type = 'color';
  color.value = /^#[\da-f]{6}$/i.test(layer.color || '') ? layer.color : '#ffffff';
  color.addEventListener('input', () => { markModified(currentId); layer.color = color.value; });
  container.appendChild(trow('Color', color));

  const opacity = document.createElement('input');
  opacity.type = 'range'; opacity.min = 0; opacity.max = 1; opacity.step = 0.05;
  opacity.value = layer.opacity != null ? layer.opacity : 1;
  opacity.addEventListener('input', () => { markModified(currentId); layer.opacity = parseFloat(opacity.value); });
  container.appendChild(trow('Opacity', opacity));

  const blend = selControl([['normal', 'Normal'], ['additive', 'Additive']], layer.blend === 'additive' ? 'additive' : 'normal', v => { markModified(currentId); layer.blend = v; });
  container.appendChild(trow('Blend', blend));

  const scale = numControl(layer.scale != null ? layer.scale : 1.5, 0.2, 6, 0.1, v => { markModified(currentId); layer.scale = v; });
  container.appendChild(trow('Scale', scale));

  const dur = numControl(layer.dur != null ? layer.dur : 0.5, 0.1, 3, 0.05, v => { markModified(currentId); layer.dur = v; });
  container.appendChild(trow('Duration', dur));
}

function renderLayerSection(key) {
  const [phase, slot] = key.split('.');
  const layer = layerRef(key);

  const details = document.createElement('details');
  details.className = 'layer';
  details.open = true;

  const summary = document.createElement('summary');
  const enable = document.createElement('input');
  enable.type = 'checkbox';
  enable.checked = !!(layer && layer.enabled);
  enable.addEventListener('change', () => { markModified(currentId); if (layer) layer.enabled = enable.checked; });
  summary.appendChild(enable);

  const title = document.createElement('span');
  title.className = 'layer-title';
  title.textContent = `${PHASE_LABELS[phase]} ${slot === 'back' ? 'Back' : 'Front'}`;
  summary.appendChild(title);

  const typeSel = selControl([['none', 'None'], ['sheet', 'Sprite Sheet'], ['sprite', 'Sprite'], ['procedural', 'Procedural']], layer ? layer.type : 'none', v => {
    if (!layer) return;
    markModified(currentId);
    layer.type = v;
    if (v === 'sheet' && !layer.sheet) layer.sheet = firstSheetRef();
    if (v === 'procedural' && !layer.kind) layer.kind = 'glow';
    const body = details.querySelector('.layer-body');
    buildTypeControls(body.querySelector('.type-controls'), key);
  });
  summary.appendChild(typeSel);

  const solo = document.createElement('button');
  solo.className = 'layer-solo' + (soloMap[key] ? ' active' : '');
  solo.title = 'Solo this layer for preview';
  solo.textContent = '◉';
  solo.addEventListener('click', () => {
    const wasSolo = soloMap[key];
    for (const k of LAYER_KEYS) soloMap[k] = false;
    soloMap[key] = !wasSolo;
    renderLayers();
  });
  summary.appendChild(solo);
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'layer-body';
  const typeCtrls = document.createElement('div');
  typeCtrls.className = 'type-controls';
  const commonCtrls = document.createElement('div');
  commonCtrls.className = 'common-controls';
  commonCtrls.style.cssText = 'display:flex;flex-direction:column;gap:8px;border-top:1px solid #222838;padding-top:8px;';
  body.appendChild(typeCtrls);
  body.appendChild(commonCtrls);
  details.appendChild(body);

  buildTypeControls(typeCtrls, key);
  buildCommonControls(commonCtrls, key);
  el.layersContainer.appendChild(details);
}

function renderLayers() {
  el.layersContainer.innerHTML = '';
  for (const key of LAYER_KEYS) renderLayerSection(key);
}

/* ─────────────────────────────────────────────────────────────
   Animation actions
   ───────────────────────────────────────────────────────────── */
function buildPreview(anim) {
  const out = JSON.parse(JSON.stringify(anim));
  const soloActive = Object.values(soloMap).some(Boolean);
  if (soloActive) {
    for (const key of LAYER_KEYS) {
      const [phase, slot] = key.split('.');
      const l = out[phase] && out[phase][slot];
      if (l) l.enabled = !!soloMap[key];
    }
  }
  return out;
}

const PERSISTENT_ZONE_SPELLS = new Set([
  'entangle', 'moonbeam', 'web', 'wallOfFire', 'spiritGuardians',
  'faerieFire', 'grease', 'flamingSphere', 'cloudkill', 'spikeGrowth'
]);

function playNow() {
  if (!editing || !attackerUnit || !targetUnit) return;
  const from = new THREE.Vector3(attackerUnit.x, 0.55, attackerUnit.z);
  const to = new THREE.Vector3(targetUnit.x, 0.5 * (targetUnit.data.scale || 1) + 0.4, targetUnit.z);
  const sound = el.sfxCb.checked;
  spawnCompositeAnimation(scene, buildPreview(editing), {
    from, to,
    travelSound: sound ? undefined : false,
    impactSound: sound ? undefined : false,
    skipTravel: el.skipTravelCb.checked,
  });
  previewPersistentZone();
}

/** 4-second preview of the persistent ground zone (vines, beam, web, …)
 *  matching test_skills.js — the composite impact burst alone vanishes in ~1s. */
function previewPersistentZone() {
  const key = currentId;
  const spell = SPELLS[key];
  if (!spell || typeof spell.cast !== 'function' || !PERSISTENT_ZONE_SPELLS.has(key)) return;
  const h = attackerUnit, foe = targetUnit;
  const mock = {
    D: {},
    monsters: [],
    heroes: [h],
    fxNow: 0,
    markSpellUsed() {},
    /* Some spells (Web) now defer their zone spawn to onImpact — fired once
       the travel bolt lands in real play. This preview has no travel to wait
       through, so fire it immediately. */
    playAbilityFx(h, k, opts = {}) { opts.onImpact?.(); },
    fxLog() {},
    spellSave() { return true; },
    concentrate() {},
    spawnAoEZone(_c, _k, x, z, radius, options = {}) {
      spawnAoEVisual(scene, { x, y: 0, z }, options.color || 0xffffff, radius, 4.0, { ...options });
      return { id: 'preview', caster: h, spellKey: _k, x, z, radius, options, savesThisTurn: new Set() };
    }
  };
  try { spell.cast(mock, h, foe, [h], 1); } catch { /* preview-only; ignore missing combat hooks */ }
}

el.playBtn.addEventListener('click', playNow);
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && document.activeElement.tagName !== 'SELECT' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    playNow();
  }
});

let loopTimer = null;
function resetLoop() {
  if (loopTimer) clearInterval(loopTimer);
  if (el.loopCb.checked) {
    const sec = parseFloat(el.interval.value);
    loopTimer = setInterval(playNow, sec * 1000);
  }
}
el.loopCb.addEventListener('change', resetLoop);
el.interval.addEventListener('input', () => {
  el.intervalVal.textContent = parseFloat(el.interval.value).toFixed(1) + 's';
  resetLoop();
});
resetLoop();

el.animSelect.addEventListener('change', () => selectAnim(el.animSelect.value));
el.animNameInput.addEventListener('input', () => {
  if (!editing) return;
  markModified(currentId);
  editing.name = el.animNameInput.value;
  el.animName.textContent = editing.name;
  el.infoLabel.textContent = editing.name;
  const opt = el.animSelect.selectedOptions[0];
  if (opt) opt.textContent = editing.name;
});

el.travelDur.addEventListener('input', () => {
  markModified(currentId);
  editing.travel.duration = parseFloat(el.travelDur.value);
  el.travelDurVal.textContent = editing.travel.duration.toFixed(2) + 's';
});
el.travelArc.addEventListener('input', () => {
  markModified(currentId);
  editing.travel.arc = parseFloat(el.travelArc.value);
  el.travelArcVal.textContent = editing.travel.arc.toFixed(2);
});
el.travelSound.addEventListener('change', () => { markModified(currentId); editing.travelSound = el.travelSound.value; });
el.impactSound.addEventListener('change', () => { markModified(currentId); editing.impactSound = el.impactSound.value; });
el.playTravelSound.addEventListener('click', () => { if (el.travelSound.value) playSfx(el.travelSound.value, { volume: 0.6 }); });
el.playImpactSound.addEventListener('click', () => { if (el.impactSound.value) playSfx(el.impactSound.value, { volume: 0.6 }); });

/* ── Audio volume (the game persists these in localStorage — if SFX was muted
   in a previous session the editor would otherwise be silent). ─────────── */
function initVolume(slider, valEl, get, set) {
  slider.value = get();
  valEl.textContent = get().toFixed(2);
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    set(v);
    valEl.textContent = v.toFixed(2);
  });
}
initVolume(el.sfxVol, el.sfxVolVal, getSfxVolume, setSfxVolume);
initVolume(el.musicVol, el.musicVolVal, getMusicVolume, setMusicVolume);
el.testSound.addEventListener('click', () => playSfx('spellImpact', { volume: 1 }));

/* ── New / Duplicate / Delete ──────────────────────────────── */
el.animNew.addEventListener('click', () => {
  const id = 'anim_' + Date.now().toString(36);
  lib.anims[id] = defaultAnim();
  modifiedIds.add(id);
  repopulateAnimSelect();
  selectAnim(id);
});
el.animDup.addEventListener('click', () => {
  if (!editing) return;
  const id = 'anim_' + Date.now().toString(36);
  const copy = JSON.parse(JSON.stringify(editing));
  delete copy.generated;
  copy.name = editing.name + ' copy';
  lib.anims[id] = copy;
  modifiedIds.add(id);
  repopulateAnimSelect();
  selectAnim(id);
});
el.animDel.addEventListener('click', () => {
  if (!editing || Object.keys(lib.anims).length <= 1) return;
  delete lib.anims[currentId];
  modifiedIds.delete(currentId);
  repopulateAnimSelect();
  selectAnim(Object.keys(lib.anims)[0]);
});

/* ── Save / Download / Load ────────────────────────────────── */
function setStatus(msg, isErr) {
  el.saveStatus.textContent = msg;
  el.saveStatus.className = 'status' + (isErr ? ' err' : '');
}

function libraryPayload() {
  const anims = {};
  for (const [id, a] of Object.entries(lib.anims)) {
    if (!a.generated || modifiedIds.has(id)) {
      const clean = { ...a };
      delete clean.generated;
      anims[id] = clean;
    }
  }
  return {
    ...('_comment' in lib ? { _comment: lib._comment } : {}),
    cantripBindings: lib.cantripBindings || {},
    sheets: lib.sheets || {},
    anims,
  };
}

el.saveBtn.addEventListener('click', async () => {
  setStatus('Saving…');
  try {
    const r = await fetch('/api/save-vfx-anims', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(libraryPayload()),
    });
    const j = await r.json();
    setStatus(j.success ? 'Saved → src/game/vfx_animations.json' : 'Save failed: ' + (j.error || ''));
    if (!j.success) setStatus('Save failed: ' + (j.error || ''), true);
  } catch (err) {
    setStatus('Save failed: ' + err.message, true);
  }
});

el.downloadBtn.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(libraryPayload(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'vfx_animations.json';
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus('Downloaded vfx_animations.json');
});

el.loadBtn.addEventListener('click', () => el.loadFile.click());
el.loadFile.addEventListener('change', async () => {
  const file = el.loadFile.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || !data.anims) throw new Error('file needs an "anims" object');
    lib.anims = data.anims;
    if (data.sheets) lib.sheets = data.sheets;
    if (data.cantripBindings) lib.cantripBindings = data.cantripBindings;
    repopulateAnimSelect();
    selectAnim(Object.keys(lib.anims)[0]);
    setStatus('Loaded ' + Object.keys(lib.anims).length + ' animation(s)');
  } catch (err) {
    setStatus('Load failed: ' + err.message, true);
  }
  el.loadFile.value = '';
});

/* ─────────────────────────────────────────────────────────────
   Main loop
   ───────────────────────────────────────────────────────────── */
let lastTime = performance.now();
function animate(time) {
  requestAnimationFrame(animate);
  const dt = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;
  updateProjectiles(scene, dt);
  updateWorldFx(scene, dt);
  updateFloatTexts(scene, cam);
  updateCompositeFX(scene, dt);
  renderer.render(scene, cam);
}

initAudio();
/* Warm the audio pipeline on the very first interaction — registered after
   initAudio so its unlock listener runs first, making the first real SFX
   play instantly (fetch/decode already in cache). */
window.addEventListener('pointerdown', () => playSfx('spellImpact', { volume: 0 }), { once: true });
repopulateAnimSelect();
selectAnim(currentId);
requestAnimationFrame(animate);
