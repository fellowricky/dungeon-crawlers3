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
  spawnAoEVisual, makeFloatText, spawnBeamEffect, spawnProjectile, spawnSpriteEffect, spawnSheetEffect,
  hitFlash, updateFlash, visualOf
} from './game/entities.js';
import { poseCast, poseHit } from './game/sprite_pose.js';
import { GIGAPACK_REGISTRY } from './game/gigapack_registry.js';
import { THEMES, FLOOR, generateDungeon } from './dungeon/dungeon_generator.js';
import { groundY } from './dungeon/elevation.js';
import {
  renderer, scene, cam, camTarget, yaw, updateCam, setYawPitch, buildScene, finishAnim,
  liveUpdate, renderFrame, BASE_HALF, DEFAULT_CAM_ZOOM, MAX_CAM_ZOOM,
} from './render/dungeon_scene.js';
import { SOUND_META, playSfx, initAudio, getSfxVolume, setSfxVolume, SPELL_SFX } from './game/audio.js';
import { SPELLS, clearDancingLights } from './game/spells.js';
import { ABILITY_FX } from './game/combat.js';
import {
  VFX_LIB, VFX_ANIMS, VFX_SHEET_LIBRARY, CANTRIP_ANIM_BINDINGS,
  spawnCompositeAnimation, updateCompositeFX,
} from './game/vfx_animations.js';
import { spawnLivePixelFx, spawnLightMote, spawnManaBurst } from './render/pixelfx_live.js';
import * as stormCloudFx from './render/pfx/storm_cloud.js';
import * as wispFx from './render/pfx/wisp.js';
import { PAL } from './vendor/pixelfx/core/index.js';
import { syncStatusAuras, STATUS_AURAS } from './render/status_auras.js';
import { EFFECTS as STATUS_DEFS, clearAllEffects } from './game/conditions.js';
import { spawnBodyEffect, chestWorldY, spawnSpellCharge, SPELL_CHARGE_SECONDS } from './render/body_fx.js';

/* ─────────────────────────────────────────────────────────────
   DOM
   ───────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const el = {
  animSelect: $('anim-select'), animName: $('anim-name'), animNameInput: $('anim-name-input'),
  playBtn: $('play-btn'), loopCb: $('loop-cb'), interval: $('interval'), intervalVal: $('interval-val'),
  skipTravelCb: $('skip-travel-cb'), areaCb: $('area-cb'), sfxCb: $('sfx-cb'),
  attackerSelect: $('attacker-select'), targetSelect: $('target-select'),
  themeSelect: $('theme-select'), targetsSelect: $('targets-select'), levelSelect: $('level-select'), statusSelect: $('status-select'), rerollBtn: $('reroll-btn'), camPreset: $('cam-preset'), resetCamBtn: $('reset-cam-btn'),
  infoLabel: $('info-label'),
  animNew: $('anim-new'), animDup: $('anim-dup'), animDel: $('anim-del'),
  travelDur: $('travel-dur'), travelDurVal: $('travel-dur-val'),
  travelArc: $('travel-arc'), travelArcVal: $('travel-arc-val'),
  travelSound: $('travel-sound'), impactSound: $('impact-sound'),
  playTravelSound: $('play-travel-sound'), playImpactSound: $('play-impact-sound'),
  sfxVol: $('sfx-vol'), sfxVolVal: $('sfx-vol-val'),
  testSound: $('test-sound'),
  layersContainer: $('layers-container'),
  saveBtn: $('save-btn'), downloadBtn: $('download-btn'), loadBtn: $('load-btn'), loadFile: $('load-file'),
  saveStatus: $('save-status'),
};

/* ─────────────────────────────────────────────────────────────
   Scene: a real forged level drawn by the shipping renderer
   ─────────────────────────────────────────────────────────────
   dungeon_scene.js owns the renderer, scene, orthographic camera, lights,
   post-processing and the orbit / pan / zoom input, exactly as in play, so a
   spell is judged against the lighting and scale it will really get. */
let attackerUnit = null, targetUnit = null;
const DUNGEON_THEME_KEYS = Object.keys(THEMES).filter(k => !THEMES[k].overland);
const STAGE_GAP = 6;           // tiles between caster and target
let stageD = null;             // the forged level
let stage = null;              // { a: {x, z}, b: {x, z} } world positions
let stageSeed = 4242;

for (const k of DUNGEON_THEME_KEYS) {
  const o = document.createElement('option');
  o.value = k;
  o.textContent = THEMES[k].label || k;
  el.themeSelect.appendChild(o);
}
el.themeSelect.value = DUNGEON_THEME_KEYS.includes('ancient') ? 'ancient' : DUNGEON_THEME_KEYS[0];

const cellToWorld = (d, gx, gy) => ({ x: gx - d.W / 2 + 0.5, z: gy - d.H / 2 + 0.5 });
const floorY = (x, z) => groundY(stageD, x, z);

/** Two floor cells STAGE_GAP apart on one row of a room, with clear floor
 *  between them and no prop on either — the longest clean run near a room's
 *  middle, biggest rooms first. */
function findStage(d) {
  const propAt = new Set(d.props.map(p => p.y * d.W + p.x));
  const clear = (gx, gy) => gx >= 0 && gy >= 0 && gx < d.W && gy < d.H
    && d.grid[gy * d.W + gx] === FLOOR && !propAt.has(gy * d.W + gx);
  const rooms = [...d.rooms].sort((p, q) => q.w * q.h - p.w * p.h);
  for (const r of rooms) {
    for (let dy = 0; dy <= Math.floor(r.h / 2); dy++) {
      for (const gy of [r.cy + dy, r.cy - dy]) {
        let run = 0;
        for (let gx = r.cx - Math.floor(r.w / 2); gx <= r.cx + Math.floor(r.w / 2); gx++) {
          run = clear(gx, gy) ? run + 1 : 0;
          if (run === STAGE_GAP + 1) {
            return { a: cellToWorld(d, gx - STAGE_GAP, gy), b: cellToWorld(d, gx, gy) };
          }
        }
      }
    }
  }
  return { a: cellToWorld(d, d.rooms[0].cx - 3, d.rooms[0].cy), b: cellToWorld(d, d.rooms[0].cx + 3, d.rooms[0].cy) };
}

function forgeStage() {
  const themeKey = el.themeSelect.value;
  stageD = generateDungeon(stageSeed, { seed: stageSeed, themeKey });
  buildScene(stageD);
  finishAnim();
  stage = findStage(stageD);
  frameStage();
  if (attackerUnit) placeUnits();
}

/** Centre the caster→target pair in the part of the view the editor panel
 *  leaves uncovered: slide the look-at point along screen-right by half the
 *  panel's width, in world units. */
function frameStage() {
  if (!stage) return;
  const panel = document.getElementById('editor-panel');
  const covered = panel ? Math.max(0, innerWidth - panel.getBoundingClientRect().left) : 0;
  const shift = (covered / 2) * (cam.right - cam.left) / cam.zoom / innerWidth;
  camTarget.set(
    (stage.a.x + stage.b.x) / 2 + Math.cos(yaw) * shift, 0,
    (stage.a.z + stage.b.z) / 2 - Math.sin(yaw) * shift);
  updateCam();
}
el.themeSelect.addEventListener('change', forgeStage);
el.rerollBtn?.addEventListener('click', () => { stageSeed = (Math.random() * 1e9) >>> 0; forgeStage(); });

const CAM_PRESETS = {
  iso: { yaw: Math.PI / 4, pitch: 0.64, zoom: DEFAULT_CAM_ZOOM },
  front: { yaw: 0, pitch: 0.3, zoom: DEFAULT_CAM_ZOOM },
  top: { yaw: 0, pitch: 1.35, zoom: DEFAULT_CAM_ZOOM },
  close: { yaw: Math.PI / 6, pitch: 0.45, zoom: MAX_CAM_ZOOM },
};
function setCamPreset(key) {
  const p = CAM_PRESETS[key] || CAM_PRESETS.iso;
  cam.zoom = p.zoom;
  cam.updateProjectionMatrix();
  setYawPitch(p.yaw, p.pitch);
  frameStage();
}
el.camPreset?.addEventListener('change', () => setCamPreset(el.camPreset.value));
el.resetCamBtn?.addEventListener('click', () => {
  el.camPreset.value = 'iso';
  setCamPreset('iso');
});
window.addEventListener('resize', () => {
  if (!renderer) return;
  renderer.setSize(innerWidth, innerHeight);
  const aspect = innerWidth / innerHeight;
  cam.left = -BASE_HALF * aspect; cam.right = BASE_HALF * aspect;
  cam.top = BASE_HALF; cam.bottom = -BASE_HALF;
  cam.updateProjectionMatrix();
});

/* ── units (caster + target) ──────────────────────────────────────────── */

function createHero(name, raceKey, classKey, visual = {}) {
  const heroData = makeHero(name, raceKey, classKey, {
    str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14,
  }, { gender: 'male', hair: 'bangs/adult', skinColor: '#e8c088', hairColor: '#553311', eyeColor: '#4488cc', ...visual });
  const mesh = makeHeroMesh(heroData);
  return { ent: mesh, data: heroData, x: 0, z: 0, isMonster: false };
}

function createMonster(name, sprite, scale = 1.0, fullData = {}) {
  /* bestiary rows give hp as dice ([n, die, bonus]); a bench unit needs a number */
  const mon = { ...fullData, name, sprite, scale, hp: 100, maxHp: 100 };
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
  /* Built at the old bench's scale; shrink it to a hero's height on the real tile grid. */
  grp.scale.setScalar(0.65);
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
  /* Hero presets first: the bestiary has its own `wizard` (the Evil Wizard),
     which used to stand in for the Wizard caster. */
  if (HERO_PRESETS[presetKey]) {
    return createHero(...HERO_PRESETS[presetKey]);
  }
  const normKey = (presetKey || '').replace(/-/g, '_');
  const monData = MONSTERS_ALL.find(m => m.id === presetKey || m.id.replace(/-/g, '_') === normKey);
  if (monData) {
    return createMonster(monData.name, monData.sprite, monData.scale || 1.0, monData);
  }
  return createDummy();
}

let extraTargets = [];     // the second and third targets when Targets is 3
let allyUnit = null;       // stands beside the caster, for spells that land on the party
const allTargets = () => [targetUnit, ...extraTargets].filter(Boolean);

/** A clear floor cell (no prop) at world (x, z) on the forged level. */
function clearFloorAt(x, z) {
  const d = stageD;
  const gx = Math.round(x + d.W / 2 - 0.5), gy = Math.round(z + d.H / 2 - 0.5);
  if (gx < 0 || gy < 0 || gx >= d.W || gy >= d.H || d.grid[gy * d.W + gx] !== FLOOR) return false;
  return !d.props.some(p => p.x === gx && p.y === gy);
}

/** Stand the caster and target on the stage's two floor cells, and any extra
 *  targets beside the target: 3 tiles off to its sides, so each is its own
 *  Call Lightning strike (2.2) yet all sit inside a Fireball (4) or the cone. */
function placeUnits() {
  for (const [u, p] of [[attackerUnit, stage.a], [targetUnit, stage.b]]) {
    u.x = p.x; u.z = p.z;
    u.ent.grp.position.set(u.x, floorY(u.x, u.z), u.z);
  }
  const spots = [[0, 3], [0, -3], [-1, 3], [-1, -3], [1, 3], [1, -3], [-2, 2], [-2, -2]]
    .map(([dx, dz]) => ({ x: stage.b.x + dx, z: stage.b.z + dz }))
    .filter(p => clearFloorAt(p.x, p.z));
  /* one tile from the caster, on the first clear floor */
  const allySpot = [[0, 1], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0]]
    .map(([dx, dz]) => ({ x: stage.a.x + dx, z: stage.a.z + dz }))
    .find(p => clearFloorAt(p.x, p.z)) || { x: stage.a.x, z: stage.a.z + 1 };
  allyUnit.x = allySpot.x; allyUnit.z = allySpot.z;
  allyUnit.ent.grp.position.set(allyUnit.x, floorY(allyUnit.x, allyUnit.z), allyUnit.z);
  extraTargets.forEach((u, i) => {
    const p = spots[i] || { x: stage.b.x, z: stage.b.z + (i ? -3 : 3) };
    u.x = p.x; u.z = p.z;
    u.ent.grp.position.set(u.x, floorY(u.x, u.z), u.z);
  });
  drawHitArea();
}

/* ── hit area: the spell's real area of effect, outlined on the floor ── */
let areaLine = null;
let areaReady = false;   // the editor state it reads is declared further down
let castPreviewReady = false;   // likewise for the cast preview's state
const AREA_COLOR = 0x7dffb0;
/** Outline SPELLS[id].area (or a circle of ai.aoeRadius) under the stage:
 *  circles centre on the target, cones open from the caster toward it — the
 *  same geometry the cast tests creatures against. */
function drawHitArea() {
  if (areaLine) { scene.remove(areaLine); areaLine.geometry.dispose(); areaLine = null; }
  if (!areaReady) return;
  const sp = SPELLS[currentId];
  const area = sp && (sp.area || (sp.ai && sp.ai.aoeRadius ? { shape: 'circle', radius: sp.ai.aoeRadius } : null));
  if (!el.areaCb.checked || !area || !attackerUnit || !targetUnit) return;
  const pts = [];
  const lift = 0.06;
  const at = (x, z) => new THREE.Vector3(x, floorY(x, z) + lift, z);
  if (area.shape === 'cone') {
    const a = attackerUnit, aim = Math.atan2(targetUnit.z - a.z, targetUnit.x - a.x);
    pts.push(at(a.x, a.z));
    for (let i = 0; i <= 32; i++) {
      const th = aim - area.halfAngle + (2 * area.halfAngle * i) / 32;
      pts.push(at(a.x + Math.cos(th) * area.range, a.z + Math.sin(th) * area.range));
    }
    pts.push(at(a.x, a.z));
  } else {
    const t = targetUnit;
    for (let i = 0; i <= 64; i++) {
      const th = (i / 64) * Math.PI * 2;
      pts.push(at(t.x + Math.cos(th) * area.radius, t.z + Math.sin(th) * area.radius));
    }
  }
  const mat = new THREE.LineBasicMaterial({ color: AREA_COLOR, transparent: true, opacity: 0.8, depthTest: false });
  mat.toneMapped = false;
  areaLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
  areaLine.renderOrder = 999;
  scene.add(areaLine);
}
el.areaCb.addEventListener('change', drawHitArea);

/** Face `u` toward `other` and advance its animation, the way the game's
 *  visual loop does: facing is picked relative to the camera, and an LPC hero
 *  drops back to idle once a cast has played out. */
function tickUnit(u, other, dt) {
  const anim = u && u.ent.anim;
  if (!anim) return;
  if (typeof anim.setDirection === 'function' && other) {
    const camAngle = Math.atan2(cam.position.x - camTarget.x, cam.position.z - camTarget.z);
    const c = Math.cos(camAngle), s = Math.sin(camAngle);
    const dx = other.x - u.x, dz = other.z - u.z;
    anim.setDirection(dx * c - dz * s, dx * s + dz * c);
  }
  if (typeof anim.update === 'function') anim.update(dt);
  if (!u.isMonster && anim.state === 'walk' && typeof anim.play === 'function') anim.play('idle');
}

function setupUnits() {
  if (typeof resetCastPreview === 'function' && castPreviewReady) resetCastPreview();
  for (const u of [attackerUnit, allyUnit, targetUnit, ...extraTargets]) if (u) scene.remove(u.ent.grp);
  attackerUnit = buildUnit(el.attackerSelect.value);
  if (el.levelSelect) attackerUnit.data.level = parseInt(el.levelSelect.value, 10) || 1;
  allyUnit = buildUnit('fighter');
  targetUnit = buildUnit(el.targetSelect.value);
  const n = Math.max(1, parseInt(el.targetsSelect.value, 10) || 1);
  extraTargets = Array.from({ length: n - 1 }, () => buildUnit(el.targetSelect.value));
  placeUnits();
  for (const u of [attackerUnit, allyUnit, targetUnit, ...extraTargets]) scene.add(u.ent.grp);
  if (el.statusSelect && el.statusSelect.value) applyReviewStatus();
}
forgeStage();
setupUnits();
el.attackerSelect.addEventListener('change', setupUnits);
el.targetSelect.addEventListener('change', setupUnits);
el.targetsSelect.addEventListener('change', setupUnits);
el.levelSelect.addEventListener('change', setupUnits);

/* ── Status review: any mapped status, held on the targets' real sprites.
   Clearing it plays the aura's release (stone shattering off, roots
   crumbling) the way the status ending would in a fight. ── */
for (const key of Object.keys(STATUS_AURAS)) {
  const o = document.createElement('option');
  o.value = key;
  o.textContent = (STATUS_DEFS[key] && STATUS_DEFS[key].label) || key;
  el.statusSelect.appendChild(o);
}
function applyReviewStatus() {
  const key = el.statusSelect.value;
  for (const u of allTargets()) u._effects = key ? { [key]: { duration: 1e9 } } : {};
}
el.statusSelect.addEventListener('change', applyReviewStatus);

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
  resetCastPreview();
  drawHitArea();
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
    /* For a sheet that is itself a ray (source on the left edge, tip on the
       right): stretch it from caster to target instead of a sprite at one
       point. Scale becomes its thickness. */
    const span = document.createElement('input');
    span.type = 'checkbox';
    span.checked = !!layer.span;
    span.addEventListener('change', () => { markModified(currentId); layer.span = span.checked; });
    container.appendChild(trow('Span caster→target', span));
    /* An area spell's reach in tiles (Cone of Cold: 12), so the span shows
       the real hit area rather than stopping at whoever was targeted. */
    const spanLen = numControl(layer.spanLength || 0, 0, 24, 0.5, v => { markModified(currentId); layer.spanLength = v || undefined; });
    container.appendChild(trow('Span length (0 = to target)', spanLen));
    /* A travel sheet drawn facing right (a bolt with its tail behind it):
       turn it to point along the flight, caster to target. */
    if (key.startsWith('travel.')) {
      const orient = document.createElement('input');
      orient.type = 'checkbox';
      orient.checked = !!layer.orient;
      orient.addEventListener('change', () => { markModified(currentId); layer.orient = orient.checked; });
      container.appendChild(trow('Orient to target', orient));
    }
  } else if (layer.type === 'live') {
    const kind = selControl([['missile', 'Missile'], ['magicMissile', 'Magic Missile'], ['beam', 'Beam']], layer.fx || 'missile', v => { markModified(currentId); layer.fx = v; });
    container.appendChild(trow('Effect', kind));
    const pal = selControl(Object.keys(PAL).map(k => [k, k]), layer.palette || 'arcane', v => { markModified(currentId); layer.palette = v; });
    container.appendChild(trow('Palette', pal));
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

  const scale = numControl(layer.scale != null ? layer.scale : 1.5, 0.2, 16, 0.1, v => { markModified(currentId); layer.scale = v; });
  container.appendChild(trow('Scale', scale));

  /* An impact that stands on its own floor line (a ground blast): put it on
     the floor under the target rather than at body height. */
  if (key.startsWith('impact.')) {
    /* Start this layer a beat after the landing (seconds). */
    const delay = numControl(layer.delay || 0, 0, 3, 0.05, v => { markModified(currentId); layer.delay = v || undefined; });
    container.appendChild(trow('Delay (s)', delay));
    const ground = document.createElement('input');
    ground.type = 'checkbox';
    ground.checked = !!layer.ground;
    ground.addEventListener('change', () => { markModified(currentId); layer.ground = ground.checked; });
    container.appendChild(trow('On the ground', ground));
  }

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

  const typeSel = selControl([['none', 'None'], ['sheet', 'Sprite Sheet'], ['live', 'Live Effect'], ['sprite', 'Sprite'], ['procedural', 'Procedural']], layer ? layer.type : 'none', v => {
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

/* Spells previewed through their real cast(): a stand-in game hands them the
   caster, the targets and the hooks combat would, so who gets hit, when the
   damage lands, what the cloud does each round — all of it plays as in a
   fight. Damage shows as floating numbers; the stand-ins never die. */
const CAST_PREVIEW_SPELLS = new Set([
  'fireball', 'coneOfCold', 'iceStorm', 'callLightning', 'blight', 'sleep', 'hex',
  /* the beam and ray spells (pixelfx beam, via fxBeam) */
  'scorchingRay', 'rayOfEnfeeblement', 'lightningBolt', 'vampiricTouch', 'guidingBolt',
  'rayOfSickness', 'disintegrate', 'chainLightning', 'sunbeam', 'eldritchBlast',
  /* pillars of light (and fire) from above */
  'moonbeam', 'flameStrike',
  /* the rest of the cantrips and level 1 spells with a cast of their own */
  'dancingLights', 'chillTouch', 'viciousMockery', 'magicMissile', 'shield', 'bless', 'entangle', 'healingWord', 'chaosBolt',
  'dragonBreathSpell', 'armsOfHadar', 'thunderousSmite', 'huntersMark', 'bane', 'faerieFire',
  'hideousLaughter', 'protectionFromEvil', 'grease', 'inflictWounds', 'thunderwave',
  'cureWounds', 'shieldOfFaith', 'chromaticOrb', 'findFamiliar',
]);
const PREVIEW_HP = 5;      // low enough for Sleep's pool to put every stand-in under
let previewCloud = null;   // Call Lightning's live cloud
let castPreview = null;    // { game, targets, next } — the stand-in fight a cast runs in

let previewMote = null;
function resetCastPreview() {
  if (previewCloud) { previewCloud.remove(); previewCloud = null; }
  if (previewMote) { previewMote.remove(); previewMote = null; }
  if (attackerUnit) { attackerUnit.conc = null; clearDancingLights(attackerUnit); clearAllEffects(attackerUnit); }
  if (allyUnit) clearAllEffects(allyUnit);
  castPreview = null;
}

function playNow() {
  if (!editing || !attackerUnit || !targetUnit) return;
  const from = new THREE.Vector3(attackerUnit.x, chestWorldY(attackerUnit), attackerUnit.z);
  const to = new THREE.Vector3(targetUnit.x, floorY(targetUnit.x, targetUnit.z) + 0.5 * (targetUnit.data.scale || 1) + 0.4, targetUnit.z);
  const sound = el.sfxCb.checked;
  /* Light has no cast: Play shows its mote at the caster's shoulder (spells.js tickLightMotes). */
  if (currentId === 'light') {
    if (previewMote) return;      // it stays lit; Loop must not restart it
    resetCastPreview();
    previewMote = spawnLightMote(scene, new THREE.Vector3(attackerUnit.x + 0.3, chestWorldY(attackerUnit) + 0.3, attackerUnit.z - 0.25));
    return;
  }
  if (CAST_PREVIEW_SPELLS.has(currentId) && SPELLS[currentId] && typeof SPELLS[currentId].cast === 'function') {
    previewCast();
    return;
  }
  resetCastPreview();
  /* The caster plays its spellcast, as heroStartCastAnim does in combat. */
  const anim = attackerUnit.ent.anim;
  if (anim && typeof anim.play === 'function') anim.play(anim.anims ? 'attack' : 'spellcast', true);
  /* the charge at the chest, then the spell, as in combat */
  spawnSpellCharge(attackerUnit, previewColor());
  poseCast(visualOf(attackerUnit), targetUnit.x - attackerUnit.x, targetUnit.z - attackerUnit.z, SPELL_CHARGE_SECONDS);
  if (sound) playSfx('spellCharge', { volume: 0.6 });
  const preview = buildPreview(editing);
  setTimeout(() => {
    spawnCompositeAnimation(scene, preview, {
      from, to, groundAt: floorY,
      travelSound: sound ? undefined : false,
      impactSound: sound ? undefined : false,
      skipTravel: el.skipTravelCb.checked,
      onImpact: () => {
        hitFlash(targetUnit.ent);
        poseHit(visualOf(targetUnit), targetUnit.x - attackerUnit.x, targetUnit.z - attackerUnit.z);
      },
    });
    previewPersistentZone();
  }, SPELL_CHARGE_SECONDS * 1000);
}

/** The colour a spell charges in: its own, else its animation's first glow. */
function previewColor() {
  const sp = SPELLS[currentId];
  if (sp && sp.color != null) return sp.color;
  const glow = editing && editing.travel && editing.travel.back;
  return glow && glow.color ? parseInt(String(glow.color).replace('#', ''), 16) : 0xc0a060;
}

/** Run the spell's own cast() in a stand-in fight. A concentration spell that
 *  is still up (Call Lightning's storm) gets its next round instead — the
 *  druid's turn — so Play / Loop walks the cloud from target to target. */
function previewCast() {
  const h = attackerUnit, spell = SPELLS[currentId];
  if (castPreview && h.conc && typeof h.conc.onTurn === 'function') {
    h.actUsed = false;
    h.conc.onTurn(castPreview.game, h);
    return;
  }
  resetCastPreview();
  const targets = allTargets().map(u => ({
    x: u.x, z: u.z, active: true, dead: false, ent: u.ent,
    data: { ...u.data, hp: PREVIEW_HP, maxHp: PREVIEW_HP },
  }));
  castPreview = { targets, next: 1, game: castGame(h, targets) };
  const preview = castPreview;
  const a = h.ent && h.ent.anim;
  if (a && typeof a.play === 'function') a.play(a.anims ? 'attack' : 'spellcast', true);
  if (spell.chargeFx) spawnBodyEffect(spell.chargeFx, h);
  else spawnSpellCharge(h, spell.color);
  {
    const t = targets[0];
    poseCast(visualOf(h), t ? t.x - h.x : 0, t ? t.z - h.z : 0, SPELL_CHARGE_SECONDS);
  }
  if (el.sfxCb.checked) playSfx('spellCharge', { volume: 0.6 });
  setTimeout(() => {
    if (castPreview !== preview) return;
    try { spell.cast(preview.game, h, targets[0], [h, allyUnit], spell.level || 1); }
    catch (err) { console.warn('[vfx editor] cast preview:', err); }
  }, SPELL_CHARGE_SECONDS * 1000);
}

/** The slice of the combat API the previewed spells call, played into the
 *  editor scene. Anything else a cast reaches for (an fx/trigger hook this
 *  bench has no use for) is a no-op rather than a throw. */
function castGame(h, targets) {
  const sfx = () => (el.sfxCb.checked ? undefined : false);
  const body = t => new THREE.Vector3(t.x, floorY(t.x, t.z) + 0.5 * ((t.data && t.data.scale) || 1) + 0.4, t.z);
  const animFor = k => (k === currentId ? buildPreview(editing) : VFX_ANIMS[k]);
  const api = {
    D: {}, heroes: [h, allyUnit], monsters: targets, fxNow: 0,
    _v3: (x, y, z) => new THREE.Vector3(x, y, z),
    fxChestPos: e => new THREE.Vector3(e.x, chestWorldY(e), e.z),
    fxGroundY: (x, z) => floorY(x, z),
    markSpellUsed() {}, fxLog() {},
    concentrate(caster, key, applied, zone) { caster.conc = { key, targets: applied || [], zone }; },
    spellSave() { return Math.random() < 0.5; },
    spellDamage(m, dmg) {
      makeFloatText(scene, String(dmg), new THREE.Vector3(m.x, floorY(m.x, m.z) + 1.3, m.z), '#ff6a5a');
      hitFlash(m.ent);
      poseHit(visualOf(m), m.x - h.x, m.z - h.z);
    },
    fxText(text, pos, color) { makeFloatText(scene, text, pos, color); },
    fxDelay(sec, cb) { setTimeout(cb, sec * 1000); },
    fxSchedule(ms, cb) { setTimeout(cb, ms); },
    fxProjectile(from, to, kind, color, onHit, opts = {}) { spawnProjectile(scene, from, to, kind, color, onHit, opts); },
    fxSprite(path, pos, scale, dur) { spawnSpriteEffect(scene, path, pos, scale, dur); },
    fxSheetEffect(def, pos, scale, dur) { spawnSheetEffect(scene, def, pos, scale, dur); },
    fxBeam(from, to, opts = {}) {
      if (opts.type === 'pillar' && opts.groundY == null && to) opts = { ...opts, groundY: floorY(to.x, to.z) };
      spawnBeamEffect(scene, from, to, opts);
    },
    spawnAoEZone(_c, k, x, z, radius, options = {}) {
      spawnAoEVisual(scene, { x, y: floorY(x, z), z }, options.color || 0xffffff, radius, 4.0, { ...options });
      return { id: 'preview', caster: h, spellKey: k, x, z, radius, options, savesThisTurn: new Set() };
    },
    fxBodyEffect(kind, creature) { return spawnBodyEffect(kind, creature); },
    fxManaBurst(e, palette) { spawnManaBurst(scene, new THREE.Vector3(e.x, floorY(e.x, e.z), e.z), PAL[palette]); },
    hasLOS() { return true; },
    healHero(who, amt) { makeFloatText(scene, '+' + amt, new THREE.Vector3(who.x, floorY(who.x, who.z) + 1.3, who.z), '#6ae06a'); },
    /* Each round's bolt goes to the next stand-in, as the druid would pick a fresh target. */
    findMonsterTarget() { return targets[castPreview.next++ % targets.length]; },
    fxWisp(x, z, seed = 0) {
      const fx = spawnLivePixelFx(scene, wispFx, {
        pos: new THREE.Vector3(x, floorY(x, z), z), pxPerUnit: (38 / 1.1) * 3, options: { palette: PAL.gold, seed: seed + 1 },
      });
      return {
        glideTo: (px, pz, sec) => fx.moveTo(px, floorY(px, pz), pz, sec),
        place: (px, pz) => fx.mesh.position.set(px, floorY(px, pz), pz),
        remove: () => fx.remove(),
      };
    },
    fxStormCloud(x, z) {
      if (previewCloud) previewCloud.remove();
      const fx = spawnLivePixelFx(scene, stormCloudFx, {
        pos: new THREE.Vector3(x, floorY(x, z), z), pxPerUnit: stormCloudFx.PX_PER_UNIT,
      });
      previewCloud = fx;
      return { glideTo: (px, pz, sec) => fx.moveTo(px, floorY(px, pz), pz, sec), flash: k => fx.flash(k), remove: () => fx.remove() };
    },
    /* combat.playAbilityFx's composite path: travel caster→target, impact on
       arrival, the other targets' impacts landing with it. */
    playAbilityFx(caster, k, opts = {}) {
      const at = opts.at || caster;
      const anim = animFor(k);
      if (!anim) { if (opts.onImpact) opts.onImpact(opts.toPos || at); return; }
      const from = opts.fromPos || new THREE.Vector3(caster.x, chestWorldY(caster), caster.z);
      spawnCompositeAnimation(scene, anim, {
        from, to: opts.toPos || body(at), groundAt: floorY, curve: opts.curve, follow: opts.follow, travelSound: sfx(), impactSound: sfx(),
        onImpact: (pos) => {
          for (const t of opts.alsoAt || []) {
            if (!t || t === at) continue;
            spawnCompositeAnimation(scene, anim, { from, to: body(t), groundAt: floorY, skipTravel: true, travelSound: false, impactSound: false });
          }
          if (opts.onImpact) opts.onImpact(pos);
        },
      });
    },
  };
  return new Proxy(api, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string' && /^(fx|trigger|refresh|note|resolve|log)/.test(k)) return () => null;
      return undefined;
    },
  });
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
      spawnAoEVisual(scene, { x, y: floorY(x, z), z }, options.color || 0xffffff, radius, 4.0, { ...options });
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
let lastTime = performance.now(), loopT = 0;
function animate(time) {
  requestAnimationFrame(animate);
  if (!renderer) return;
  const dt = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;
  loopT += dt;
  /* The scene module's own tick() drives game.update(), which this page never
     initialises — so, like the dungeon editor, run just the visual half. */
  liveUpdate(loopT, Infinity, dt);
  tickUnit(attackerUnit, targetUnit, dt);
  tickUnit(targetUnit, attackerUnit, dt);
  for (const u of extraTargets) tickUnit(u, attackerUnit, dt);
  /* Statuses a previewed cast left on its stand-ins (Sleep's Zs) persist
     until the next cast, as they would until something wakes them. */
  syncStatusAuras([...(castPreview ? castPreview.targets : []), ...allTargets(), attackerUnit, allyUnit].filter(Boolean));
  updateProjectiles(scene, dt);
  updateWorldFx(scene, dt);
  updateFloatTexts(scene, cam);
  updateCompositeFX(scene, dt);
  for (const u of [attackerUnit, allyUnit, ...allTargets()]) if (u) updateFlash(u.ent, dt);
  renderFrame(dt);
}

/* Handle for scripted checks — a dynamic re-import would get a second module
   instance (and a second renderer), as in the dungeon editor. */
window.__vfxEditor = {
  renderer, scene, cam, lib, playNow, forgeStage,
  get stage() { return stage; }, get dungeon() { return stageD; },
  get units() { return { attacker: attackerUnit, ally: allyUnit, target: targetUnit, extras: extraTargets }; },
  get castPreview() { return castPreview; }, get cloud() { return previewCloud; },
  /* the frame just drawn, for side-by-side review (the canvas clears after compositing) */
  grab(ctx, sx, sy, sw, sh, dx, dy, dw, dh) { renderFrame(0); ctx.drawImage(renderer.domElement, sx, sy, sw, sh, dx, dy, dw, dh); },
};

/* SFX only — this is an effects bench, the soundtrack just gets in the way. */
initAudio({ music: false });
/* Warm the audio pipeline on the very first interaction — registered after
   initAudio so its unlock listener runs first, making the first real SFX
   play instantly (fetch/decode already in cache). */
window.addEventListener('pointerdown', () => playSfx('spellImpact', { volume: 0 }), { once: true });
repopulateAnimSelect();
areaReady = true;
castPreviewReady = true;
selectAnim(currentId);
requestAnimationFrame(animate);
