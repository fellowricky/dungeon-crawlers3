/**
 * DUNGEON FORGE — WebGL Scene, Camera, Instanced Rendering & Render Loop.
 */
import * as THREE from 'three';
import { SIM } from '../game/sim_flags.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { game } from '../game/game.js';
import { LIGHT_SOURCES, heroLightSource, classifyLight, dancingLightCarriers } from '../game/light_sources.js';
import { lightLevelAt, applyThemeLightLevels } from './sprite_lighting.js';
import { branchGrips, limbWorld } from './ambient_flyers.js';

/* Hover tooltip light hint, kept deliberately quiet: nothing at all in bright
   light, a small ⛅ or 🌙 after the text otherwise. Creatures report their
   own state; empty tiles are measured (the same steady light the rules use). */
function lightHint(state) { return state === 'dim' ? '  ⛅' : state === 'dark' ? '  🌙' : ''; }
function lightHintAt(x, z) {
  if (!D) return '';
  return lightHint(classifyLight(lightLevelAt(x, groundY(D, x, z), z)));
}
function lightHintFor(u) { return u ? lightHint(u.lightState) : ''; }
import { getSetting, onSettingsChange } from '../game/settings.js';
import { fxVisualBusy } from '../game/fx_clock.js';
import { tickPerfOverlay, setPerfOverlay, perfOverlayOn, applyUiScale } from '../ui/perf_overlay.js';
import { THEMES, SPAWN_THEMES, DOORWAY_THEMES, THEME_KEYS, VOID, FLOOR, WALL, POOL, TYPE, TINT, makeRng } from '../dungeon/dungeon_generator.js';
import { STEP as ELEV_STEP, groundY } from '../dungeon/elevation.js';
import { resolveOverlandEnvironment, buildEffectiveOverlandTheme } from '../dungeon/overland_weather.js';
import { SPELLS } from '../game/spells.js';
import { attackPreview, attackPreviewText, movePreview, threatZone } from '../game/tactical_preview.js';
import { GEO, boxUV, bgFromTris, chamferBox, spireGeo, xg, mergeGeos, OSSUARY_SKULL_SLOTS, BOOKSHELF_BACK } from './dungeon_geo.js';
import CUSTOM_PROPS from '../game/custom_props.json' with { type: 'json' };
import {
  TEX, matStone, matWood, matMetal, matCeramic, matRug, matMagicCircle,
  matTapestry, matSconce, matGoldInlay, matGoldBullion, matSwampGrass, matDeadGrass, matNecroCircle, matSporeCircle,
  matCampRing, matRegimentalBanner, matBoneStone, matBiolum, matGlacialIce,
  matFloor, matWall, matWallCap, matTrim, matGlow, matCloth, matIce, matBark,
  matGrass, matLeaf, matIvy, matCrackD, matRune, matPortal, matShaft, matSkirt,
  matRuneSeal, matEmber, matBlot, matBlotAdd, matWeb, liquidMat, partMat, fogPlaneMat, POST,
  matMist, createMistMaterial, createGodRayMaterial, applyTileTheme, setFogHeightField,
  matGroundTiles, setGroundTiles, propBlendPatch, applyPropTheme, loadDataNormal,
  PROP_NORMAL_SCALE
} from './dungeon_materials.js';
import PROP_NORMAL_INDEX from './prop_normal_index.json' with { type: 'json' };
import { bakeOverlandGround } from './guild_ground.js';
import { FOLIAGE, TREE_SCALE, copseNoise, foliageGeometry, foliageMaterial, foliageWind } from './tree_foliage.js';
import { initNixieVfx, updateNixieVfx, clearPersistentNixieEffects, registerPersistentNixieEffect, stopPersistentNixieEffectsNear } from './nixie_vfx.js';
import { initAmbientFX, updateAmbientFX, clearAmbientFX, triggerLiquidSplashFX } from './ambient_fx.js';
import { cutawayPatch } from './wall_cutaway.js';
import { darkMaskPatch } from './darkness.js';
import { SIGHT_BLOCKING_KINDS } from '../game/pathfinding.js';

/* Pillars, statues, door posts and gates dissolve round a body standing behind
   them, like the walls do (wall_cutaway.js). Their materials are shared with low
   props (chests, debris, door thresholds) that must NOT be cut, so the tall pieces
   get a cut-enabled copy: one per source material, with the same patches
   (darkness, prop blend) re-run on it, and its textures and colour re-synced from
   the source every level build, since themes swap them. */
const _cutCopies = new Map();
function cutCopy(mat) {
  if (!mat || (mat.userData && mat.userData.cutaway)) return mat;   // already cut (bark): use it as is
  let c = _cutCopies.get(mat);
  if (!c) {
    c = mat.clone();                              // clone() drops onBeforeCompile: re-patch below
    const ud = { ...(mat.userData || {}) };
    delete ud.darkMask; delete ud.propBlend; delete ud.cutaway;
    c.userData = ud;
    darkMaskPatch(c);
    if (mat.userData && mat.userData.propBlend) propBlendPatch(c);
    cutawayPatch(c);
    _cutCopies.set(mat, c);
  }
  for (const k of ['map', 'bumpMap', 'normalMap', 'roughnessMap', 'emissiveMap', 'aoMap']) {
    if (k in mat && c[k] !== mat[k]) { c[k] = mat[k]; c.needsUpdate = true; }
  }
  for (const k of ['bumpScale', 'roughness', 'metalness', 'emissiveIntensity', 'opacity']) if (k in mat) c[k] = mat[k];
  if (mat.color) c.color.copy(mat.color);
  if (mat.emissive) c.emissive.copy(mat.emissive);
  if (mat.normalScale) c.normalScale.copy(mat.normalScale);
  return c;
}
import { hoverUnitCard, setCursorUnit } from '../game/unit_card.js';
import { pickUnit } from './sprite_pick.js';
import { loadingCurtainCovers } from '../ui/loading_screen.js';

const canvasBg = 0x050609;
const clamp01 = x => Math.max(0, Math.min(1, x));

/* forest ground-prop assets (loaded once, cloned per placement) */
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('./draco/');
const propLoader = new GLTFLoader();
propLoader.setDRACOLoader(dracoLoader);

const BIOME_PROP_FILES = {
  generic: {
    chest: 'chest_anim.opt.glb',   // body + hinged lid + gold heap, 'open' clip
    barrel: 'barrel.opt.glb',
    crate: 'crate.opt.glb',
    weaponRack: 'oldweaponrack.opt.glb',
    tent: 'tent.opt.glb',            // overland war camps (Ashfield, Holdfast...)
    sunShrine: 'SunShrine.opt.glb'   // drawn in place of the campfire at a Light Shrine
  },
  Forest: {
    tree: 'tree.opt.glb',
    /* conifers generated bare; needles come from tree_foliage.js (style 'conifer') */
    spruce: 'spruce1.opt.glb', fir: 'fir1.opt.glb', pine: 'pine.opt.glb',
    tree_winter: 'tree_winter.opt.glb',
    mushroomLog: 'MushroomLog.opt.glb', rocks: 'rocks.opt.glb', stump: 'stump.opt.glb',
    vinemound: 'vinemound.opt.glb', cairn: 'Cairn.opt.glb', stakes: 'stakes.opt.glb',
    rack: 'rack.opt.glb', goblinfire: 'goblinfire.opt.glb', skulltotem: 'skulltotem.opt.glb'
  },
  Ancient: {
    vase: 'Vaze.opt.glb', coffin: 'coffin.opt.glb', pillarA: 'pillar.opt.glb', pillarB: 'pillar2.opt.glb',
    lectern: 'lectern.opt.glb', grainjars: 'grainjars.opt.glb', scrollshelf: 'scrollshelf.opt.glb',
    cage: 'cage.opt.glb', cage2: 'cage2.opt.glb', throne: 'throne.opt.glb'
  },
  Grim: {
    tombstone: 'Tombstone.opt.glb', weepingAngel: 'WeepingMourner.opt.glb',
    apothecaryShelf: 'DocShelf.opt.glb', funeralBell: 'OldBell.opt.glb', graveFence: 'OldFence.opt.glb',
    /* boneyard's blocker trees, generated bare and left bare */
    deadOak: 'deadoak.opt.glb', deadHawthorn: 'deadhawthorn.opt.glb',
    deadSnag: 'deadtreesnag.opt.glb', gallowsTree: 'Gallowstree.opt.glb',
    /* boneyard graveyard pieces */
    stoneCross: 'Stonecross1.opt.glb', woodMarkerA: 'Woodengravemarker1.opt.glb', woodMarkerB: 'Woodengravemarker2.opt.glb',
    mausoleumA: 'Mausoleum1.opt.glb', mausoleumB: 'Mausoleum2.opt.glb', mausoleumC: 'Mausoleum3.opt.glb',
    lychgate: 'Lychgate.opt.glb', openGrave: 'Opengrave.opt.glb', stoneBench: 'stonebench.opt.glb'
  },
  Molten: {
    anvil: 'Anvil.opt.glb',
    forge: 'forge.opt.glb',          // replaces the procedural forge once loaded
    quenchBarrel: 'Quench.opt.glb', mineCart: 'MineCart.opt.glb',
    coolingRocks: 'CoolingRocks.opt.glb', lavaSpikeA: 'lavaspike1.opt.glb', lavaSpikeB: 'lavaspike2.opt.glb'
  },
  frost: {
    icebone: 'icebone.opt.glb', snowtree: 'snowtree.opt.glb', tree_winter: 'snowtree.opt.glb',
    /* the Forest conifers again, with snow-laden needles (FOLIAGE.snowspruce…) */
    snowspruce: 'Forest/spruce1.opt.glb', snowfir: 'Forest/fir1.opt.glb', snowpine: 'Forest/pine.opt.glb',
    snowcartA: 'snowcart.opt.glb', snowcartB: 'snowcart2.opt.glb'
  },
  Verdant: {
    fren1: 'fren1.opt.glb', fren2: 'fren2.opt.glb', fren3: 'fren3.opt.glb', fren4: 'fren4.opt.glb',
    mushroomA: 'mushroom.opt.glb', mushroomB: 'mushroom2.opt.glb', rootsA: 'roots1.opt.glb', rootsB: 'roots2.opt.glb'
  },
  Moor: {
    /* the weeping willow (the old swamptree model only remains for the guild
       hall and trailer scenes). The sporewood has its own key for its own leaf tint. */
    swamptree: 'willow_clean.opt.glb', sporewillow: 'willow_clean.opt.glb',
    bush: 'bush.opt.glb', signpost: 'signpost.opt.glb',
    brokenSignpost: '389570cd4af64ded8622428ce71e2991.opt.glb', wheel: 'wheel.opt.glb'
  },
  /* Broadleaf trees for settled country, generated bare; leaves come from tree_foliage.js. */
  Holdfast: {
    elm: 'elm.opt.glb', oak: 'oak.opt.glb', birch: 'berch.opt.glb', hawthorn: 'hawthorn.opt.glb', pollarded: 'pollarded.opt.glb',
    stoneWallA: 'StoneWall1.opt.glb', stoneWallB: 'StoneWall2.opt.glb',
    oldCart: 'OldCart.opt.glb', oldWell: 'OldWell.opt.glb', firewood: 'FireWood.opt.glb'
  },
  Mire: {
    deadtree: 'deadtree.opt.glb',
    rotBoat: 'RotBoat.opt.glb', standingStoneA: 'StandingStone.opt.glb', standingStoneB: 'StandingStone2.opt.glb',
    cattailsA: 'cattails1.opt.glb', cattailsB: 'cattails2.opt.glb'
  }
};
/* Real models for the bone scatter (skull / skeleton / bonePile). They live
   in the Grim folder but are not Grim's: TH.bones themes, crypt rooms and
   overland camps all scatter bones, so they load on every level alongside
   the generic set. buildScene falls back to the procedural pieces until
   they arrive. */
const BONE_PROP_FOLDER = 'Grim';
const BONE_PROP_FILES = {
  boneSkull: 'skull.opt.glb',
  skeletonSitA: 'SkellySit.opt.glb',    // armoured, shield; faces its local -X
  skeletonSitB: 'SkellySit2.opt.glb',   // shackled, knees up; faces its local +X
  skeletonLieA: 'RandomBones2.opt.glb', // whole skeleton on a dark stain
  skeletonLieB: 'RandomBones3.opt.glb', // skeleton coming apart
  bonesScatter: 'RandomBones.opt.glb'   // loose bones and a ribcage
};
/* A Grim level scatters ~250 bones, far too many for a cloned model each
   (one draw call apiece). They go through buildMesh as instanced sets like
   the procedural bones did, so each model is one draw call per level and the
   fog hides them per instance. This is each model's meshes with their node
   transforms baked in, built once; disposeLevel never frees them. */
const bakedPropParts = {};
function bakedParts(key) {
  if (bakedPropParts[key]) return bakedPropParts[key];
  const root = propAssets[key];
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse(o => { if (o.isMesh) parts.push({ geo: o.geometry.clone().applyMatrix4(o.matrixWorld), mat: o.material }); });
  if (FOLIAGE[key]) {
    let mesh = null;
    root.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
    if (mesh) {
      const tm = { mesh, geo: treeGeometry(root, mesh), key };
      parts.push({ geo: foliageGeometryFor(tm), mat: foliageMaterial(FOLIAGE[key]) });
    }
  }
  return (bakedPropParts[key] = parts);
}
/* per-asset visual scale multiplier — these models are all normalized to fill
   one tile on import, but their real-world proportions differ, so the single-
   tile default reads wrong for several of them */
const PROP_SCALE_MULTIPLIER = {
  tree: 1.8,
  tree_winter: 1.8,
  snowtree: 1.8,
  swamptree: 2.07, sporewillow: 2.07,   // the 1.8 of the others times TREE_SCALE
  deadtree: 1.8,
  /* broadleaf (3d/Holdfast) as scattered props: the pine's 1.8 times each
     species' relative size (TREE_SCALE in tree_foliage.js) */
  elm: 1.8, oak: 2.25, birch: 1.9, hawthorn: 1.55, pollarded: 1.7,
  spruce: 1.8, fir: 1.8, pine: 1.85,
  snowspruce: 1.8, snowfir: 1.8, snowpine: 1.85,
  mushroomLog: 1.25,
  coffin: 1.5, pillarA: 1.3, pillarB: 1.3, vase: 0.42,
  lectern: 0.95, grainjars: 0.9, scrollshelf: 1.15,
  cage: 1.35, cage2: 1.3, throne: 1.45,
  chest: 1.15, barrel: 0.48, crate: 0.50, weaponRack: 1.25,
  anvil: 0.75, tombstone: 0.38, icebone: 1.1, weepingAngel: 1.35,
  apothecaryShelf: 1.3, funeralBell: 1.25,
  graveFence: 1.84,   // one segment spans two cells, posts overlapping the next
  /* boneyard (raw models ~0.6-0.9 units): headstones a little taller than the
     old tombstone, mausoleums ~1.95 tiles square (a 2x2 footprint), the
     lychgate two cells wide over its gateway, the open grave two cells long
     (OPEN_GRAVE_RIM in dungeon_generator.js assumes this 1.94) */
  stoneCross: 0.55, woodMarkerA: 0.55, woodMarkerB: 0.55,
  mausoleumA: 3.1, mausoleumB: 3.05, mausoleumC: 3.0,
  lychgate: 3.0, openGrave: 1.94,
  stoneBench: 1.6,   // raw 1.12 long: ~1.8 tiles, two cells; seat ~0.64 high
  /* the gallows tree as a lone scattered prop, at a belt tree's typical size
     (baseScale ~2.7 x its TREE_SCALE 1.15) */
  gallowsTree: 3.1,

  fren1: 0.9, fren2: 0.9, fren3: 0.9, fren4: 0.9,
  mushroomA: 1.2, mushroomB: 1.2, rootsA: 1.3, rootsB: 1.3,
  stump: 1.2, vinemound: 1.2, cairn: 1.1, rocks: 1.1, skulltotem: 1.3,
  /* stakes: three lashed posts in a row, 0.66 long x 1.05 tall raw; 1.35 makes
     a ~0.9-tile fence section ~1.4 tall (the generator lays them end to end at
     STAKE_SEG spacing, so keep the two in step) */
  goblinfire: 0.85, rack: 0.9, stakes: 1.35,
  /* the wheel model is 2 units across: 0.38 makes it ~0.76 tiles, the size of
     the old cart's own wheels (it was 0.9 = a 1.8-tile wheel) */
  bush: 1.1, signpost: 1.05, brokenSignpost: 1, wheel: 0.38,
  /* 3d/Holdfast (raw sizes from the GLB bounds, upright). The two field walls
     are scaled to the SAME height (~0.83 tiles) so their stones match: the low
     model is 0.18 tall x 1.18 long, so 4.6 makes it a ~5.4-tile run; the tall
     one is 0.42 x 1.11, so 2.0 makes a ~2.2-tile run. Both run along local Z.
     The cart is ~1 long on local X, so 1.9 gives a 2-tile cart; the roofed
     well ~1.25 across, ~1.3 tall. */
  stoneWallA: 4.6, stoneWallB: 2.0, oldCart: 1.9, oldWell: 1.4, firewood: 1.0,
  swampgrass: 0.45, swampgrass2: 0.42, swampgrass3: 0.46,
  /* batch 3 (generic / Molten / Mire). Raw models are ~1 tile across; these
     size them to the real object: a 6 ft tent, a ~9 ft forge with chimney,
     a waist-high quench tub, a 12 ft rowboat, a 7 ft standing stone. */
  tent: 1.6, sunShrine: 1.5,
  forge: 1.9, quenchBarrel: 0.55, mineCart: 0.9, coolingRocks: 0.85,
  lavaSpikeA: 1.4, lavaSpikeB: 1.4,
  rotBoat: 2.0, standingStoneA: 1.6, standingStoneB: 1.6, cattailsA: 0.95, cattailsB: 0.95,
  /* batch 4. Bone models get only a narrow ±8% of the scatter's size
     jitter (boneModel): a skull ~0.25 tile long like the procedural one, a
     sprawled body within its own tile, a seated skeleton ~2/3 tile tall.
     The snow carts are a handcart and a longer barrow with shafts. */
  boneSkull: 0.24, skeletonSitA: 0.75, skeletonSitB: 0.75,
  ossuarySkull: 0.21,   // a niche skull: ~0.15 tall, fits the 0.5-high shelf
  skeletonLieA: 0.78, skeletonLieB: 0.85, bonesScatter: 0.85,
  snowcartA: 1.1, snowcartB: 1.3
};
/* extra height-only stretch on top of the scale above, for props whose length
   is fixed by the grid but which still need to stand taller (the graveyard
   fence spans two cells and should reach a little above a hero's head) */
const PROP_STRETCH_Y = { graveFence: 1.5 };
const propAssets = {};
/* Bumped per tiled-ground build so a slow async bake can tell it is stale. */
let groundBakeSeq = 0;
/* Tree models that wall in a holdfast / forest map, mixed evenly. A key that
   has not loaded yet is skipped, so a missing model just narrows the mix. */
/* The old 'tree' (a solid cartoon pine) is retired from these lists in favour
   of the bare-generated conifers with needle cards. */
const HOLDFAST_TREES = ['elm', 'oak', 'birch', 'hawthorn', 'pollarded', 'pine'];
const FOREST_TREES = ['spruce', 'fir', 'pine', 'spruce', 'oak', 'elm', 'birch', 'hawthorn'];   // conifers first: still mostly evergreen
/* every living species, the willow counted twice: it is the moor's signature tree */
const MOOR_TREES = ['swamptree', 'pine', 'spruce', 'fir', 'oak', 'elm', 'swamptree', 'birch', 'hawthorn', 'pollarded'];
const WINTER_TREES = ['snowspruce', 'snowfir', 'snowspruce', 'snowpine'];   // spruce and fir carry snow best
/* oak and hawthorn carry the belt, the snag and the mire's dead tree break the
   height. The gallows tree is not here: it stands alone out in the open as
   ground scatter (oc.ground.gallowsTree). */
const BONEYARD_TREES = ['deadOak', 'deadHawthorn', 'deadOak', 'deadHawthorn', 'deadSnag', 'deadtree'];
/* Kinds a bird or a bat can sit in. Dead trees have no FOLIAGE entry, so they are listed here too. */
const PERCH_TREE_KINDS = new Set([
  'oak', 'elm', 'birch', 'hawthorn', 'pollarded', 'spruce', 'fir', 'pine',
  'snowspruce', 'snowfir', 'snowpine', 'swamptree', 'sporewillow',
  'deadOak', 'deadHawthorn', 'deadSnag', 'deadtree', 'gallowsTree',
  'tree', 'snowtree', 'tree_winter',
]);

/* A tree prop's mesh geometry in the model's upright space. Tree walls draw
   the first mesh's geometry raw, so a node transform would be lost: Blender's
   glTF export keeps meshes Z-up under a +90deg X node rotation, and the elm
   rendered lying on its side. Bake the mesh's transform relative to the
   model root once, cached on the mesh. */
function treeGeometry(root, mesh) {
  if (mesh.userData.treeGeo) return mesh.userData.treeGeo;
  root.updateMatrixWorld(true);
  const rel = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
  const geo = rel.equals(new THREE.Matrix4()) ? mesh.geometry : mesh.geometry.clone().applyMatrix4(rel);
  mesh.userData.treeGeo = geo;
  return geo;
}
/* Leaf cards for a bare tree, built once per model and cached on its mesh. */
function foliageGeometryFor(tm) {
  if (!tm.mesh.userData.foliageGeo) tm.mesh.userData.foliageGeo = foliageGeometry(tm.geo, FOLIAGE[tm.key]);
  return tm.mesh.userData.foliageGeo;
}
/* animation clips shipped inside a prop GLB (only the chest has one so far) */
const propClips = {};
/* placed chest instances + the mixers driving any lids currently swinging open */
let chestInstances = [];
let chestMixers = [];
const propBaseOffset = {};
/* How far each model reaches behind its origin (-min z, before the prop's
   own turn), for pushing wall-backed props flush against their wall. */
const propBackDepth = {};
/* Props the generator stands on a wall tile facing into the room (rot =
   atan2(-dx, -dy), so the wall is behind local -Z). They're drawn slid back
   until their back meets the wall face instead of floating mid-tile. */
const WALL_BACKED_PROPS = new Set(['scrollshelf']);
/* key -> the promise of a model still loading, so a level built before its
   models arrived can wait for exactly the ones it skipped (see buildScene's
   late pass) */
const propLoading = {};
/* True once that load has finished, succeeded or not. A level built while the
   bone models are still in flight must wait; one built after a failed load
   should keep the procedural stand-in instead of waiting forever. */
const propSettled = {};
/* Called after the late pass adds models to a level that is already on
   screen; main.js points it at the game's fog so they hide like the rest. */
let onLateProps = null;
export function setLatePropsHook(fn) { onLateProps = fn; }

/* One model prop instance (the default case of buildScene's prop switch).
   Batched into `into` (an instanced set map) when provided so each GLB model
   takes one InstancedMesh draw call per mesh part instead of hundreds of clones. */
/* Mid-crown on a leafy tree. Bare wood uses a lower grip when no limb was sampled. */
function gripFrac(kind) {
  const fol = FOLIAGE[kind];
  return fol ? (fol.minH + 0.9) / 2 : 0.55;
}

function recordPerch(cx, cy, x, z, y, room, hang) {
  if (!D) return;
  const rec = { cx, cy, x, z, y, room: room == null ? -1 : room };
  if (hang) {
    rec.limb = 1;
    rec.hx = hang.x;
    rec.hy = hang.y;
    rec.hz = hang.z;
  }
  (D.perches ||= []).push(rec);
}

/* One scan per model. A belt of hundreds of oaks shares a geometry. */
function gripsOf(geo) {
  if (!geo) return null;
  const ud = geo.userData || (geo.userData = {});
  if (ud.branchGrips !== undefined) return ud.branchGrips;
  const pos = geo.getAttribute && geo.getAttribute('position');
  const g = pos ? branchGrips(pos) : null;
  ud.branchGrips = g;
  return g;
}

function propTreeGeo(kind) {
  const root = propAssets[kind];
  if (!root) return null;
  let mesh = null;
  root.traverse(o => { if (!mesh && o.isMesh) mesh = o; });
  return mesh ? treeGeometry(root, mesh) : null;
}

/* Bird on the top of a sampled limb, bat on its underside. fallbackY is the
   trunk height used when the mesh has no limb. Transform matches writeInstances. */
function recordTreePerch(geo, cx, cy, px, py, pz, sx, sy, sz, rx, ry, rz, room, fallbackY) {
  const g = gripsOf(geo);
  if (!g) {
    recordPerch(cx, cy, px, pz, fallbackY, room);
    return;
  }
  const stand = limbWorld(g.stand, px, py, pz, sx, sy, sz, rx, ry, rz);
  const hang = limbWorld(g.hang, px, py, pz, sx, sy, sz, rx, ry, rz);
  recordPerch(cx, cy, stand.x, stand.z, stand.y, room, hang);
}

function notePropPerch(p, x, z, baseY, sy, room, xf) {
  if (!PERCH_TREE_KINDS.has(p.kind)) return;
  const cx = Math.round(p.x);
  const cy = Math.round(p.y);
  const rid = room != null ? room : -1;
  const fallbackY = baseY + sy * gripFrac(p.kind);
  if (!xf) {
    recordPerch(cx, cy, x, z, fallbackY, rid);
    return;
  }
  recordTreePerch(
    propTreeGeo(p.kind), cx, cy,
    xf.px, xf.py, xf.pz, xf.sx, xf.sy, xf.sz, xf.rx, xf.ry, xf.rz,
    rid, fallbackY,
  );
}

function placeModelProp(p, X, PY, Z, propRoom, rng, dl = 0, into = null) {
  const s = (p.scale || 1) * (PROP_SCALE_MULTIPLIER[p.kind] || 1);
  const isTreeProp = p.kind === 'tree' || p.kind === 'snowtree' || p.kind === 'tree_winter' || p.kind === 'swamptree' || p.kind === 'deadtree'
    || FOLIAGE[p.kind] !== undefined;
  if (into) {
    const set = (into[p.kind] ||= instSet());
    if (isTreeProp) {
      const sx = s * rng.f(0.70, 1.05);
      const sz = s * rng.f(0.70, 1.05);
      const sy = s * rng.f(0.88, 1.35);
      const tiltMag = rng.f(0.0, 0.087);
      const tiltDir = rng.f(0, 6.28);
      const rx = Math.sin(tiltDir) * tiltMag;
      const ry = p.rot || rng.f(0, 6.28);
      const rz = Math.cos(tiltDir) * tiltMag;
      const py = PY + ((propBaseOffset[p.kind] || 0) * sy + (p.oy || 0));
      set.addT(X, py, Z, sx, sy, sz, rx, ry, rz, 0xffffff, dl, propRoom);
      notePropPerch(p, X, Z, py, sy, propRoom, { px: X, py, pz: Z, sx, sy, sz, rx, ry, rz });
    } else {
      const sy = s * (PROP_STRETCH_Y[p.kind] || 1);
      const ry = p.rot || 0;
      const back = WALL_BACKED_PROPS.has(p.kind) ? Math.max(0, 0.49 - (propBackDepth[p.kind] || 0) * s) : 0;
      const px = X - Math.sin(ry) * back;
      const py = PY + ((propBaseOffset[p.kind] || 0) * sy + (p.oy || 0));
      const pz = Z - Math.cos(ry) * back;
      set.add(px, py, pz, s, sy, s, ry, 0xffffff, dl, propRoom);
      notePropPerch(p, px, pz, py, sy, propRoom, { px, py, pz, sx: s, sy, sz: s, rx: 0, ry, rz: 0 });
    }
    return;
  }
  const inst = propAssets[p.kind].clone(true);
  if (FOLIAGE[p.kind]) {
    let mesh = null;
    propAssets[p.kind].traverse(o => { if (o.isMesh && !mesh) mesh = o; });
    if (mesh) {
      const tm = { mesh, geo: treeGeometry(propAssets[p.kind], mesh), key: p.kind };
      const leaves = new THREE.Mesh(foliageGeometryFor(tm), foliageMaterial(FOLIAGE[p.kind]));
      leaves.castShadow = true; leaves.receiveShadow = true;
      inst.add(leaves);
    }
  }
  if (isTreeProp) {
    const sx = s * rng.f(0.70, 1.05);
    const sz = s * rng.f(0.70, 1.05);
    const sy = s * rng.f(0.88, 1.35);
    inst.scale.set(sx, sy, sz);
    const tiltMag = rng.f(0.0, 0.087);
    const tiltDir = rng.f(0, 6.28);
    inst.rotation.set(Math.sin(tiltDir) * tiltMag, p.rot || rng.f(0, 6.28), Math.cos(tiltDir) * tiltMag);
    const py = PY + ((propBaseOffset[p.kind] || 0) * sy + (p.oy || 0));
    inst.position.set(X, py, Z);
    notePropPerch(p, X, Z, py, sy, propRoom, {
      px: X, py, pz: Z, sx, sy, sz,
      rx: inst.rotation.x, ry: inst.rotation.y, rz: inst.rotation.z,
    });
  } else {
    const sy = s * (PROP_STRETCH_Y[p.kind] || 1);
    inst.scale.set(s, sy, s);
    inst.rotation.y = p.rot || 0;
    /* local -Z turns to world -(sin rot, cos rot): the wall side */
    const back = WALL_BACKED_PROPS.has(p.kind) ? Math.max(0, 0.49 - (propBackDepth[p.kind] || 0) * s) : 0;
    const py = PY + ((propBaseOffset[p.kind] || 0) * sy + (p.oy || 0));
    const px = X - Math.sin(p.rot || 0) * back;
    const pz = Z - Math.cos(p.rot || 0) * back;
    inst.position.set(px, py, pz);
    notePropPerch(p, px, pz, py, sy, propRoom, {
      px, py, pz, sx: s, sy, sz: s, rx: 0, ry: inst.rotation.y, rz: 0,
    });
  }
  inst.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  group.add(inst);
  if (propRoom >= 0) standaloneRooms.push({ mesh: inst, rid: propRoom });
}

/** Load a GLB and make it available to prop scatter under `key`.
 *  Used for the shipped biome props, for custom_props.json, and live by the
 *  dungeon editor when a model is imported. Resolves once the model is ready
 *  so a caller can re-forge and actually see it. */
export function registerProp(key, url, scaleMult, retries = 2) {
  if (scaleMult) PROP_SCALE_MULTIPLIER[key] = scaleMult;
  return (propLoading[key] = new Promise((resolve, reject) => {
    propLoader.load(url, gltf => {
      gltf.scene.traverse(o => {
        if (o.isMesh && o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          const isMetalProp = key === 'cage' || key === 'cage2' || key === 'weaponRack' || key === 'anvil' || key === 'funeralBell';
          for (const mat of mats) {
            // Raw AI models ship with a packed metallicRoughnessTexture (leaving mat.roughness = 1.0
            // while the texture's green channel forces ~0.05 mirror roughness) and KHR_materials_specular [2,2,2].
            // Strip the generated metallic/roughness maps and normalize to matte world roughness:
            if (mat.roughnessMap) mat.roughnessMap = null;
            if (mat.metalnessMap) mat.metalnessMap = null;
            if (mat.specularIntensityMap) mat.specularIntensityMap = null;
            if (mat.specularColorMap) mat.specularColorMap = null;
            if (mat.roughness !== undefined) {
              mat.roughness = isMetalProp ? 0.68 : 0.90;
            }
            if (mat.metalness !== undefined) {
              mat.metalness = isMetalProp ? Math.min(mat.metalness, 0.22) : 0.0;
            }
            if (mat.specularColor) {
              mat.specularColor.setRGB(0.06, 0.06, 0.06);
            }
            if (mat.specularIntensity !== undefined) {
              mat.specularIntensity = 0.08;
            }
            /* a tree can darken its own bark so the limbs sit back in its leaves */
            if (FOLIAGE[key]?.bark && mat.color) mat.color.setHex(FOLIAGE[key].bark);
            if (mat.emissive) {
              mat.emissive.setRGB(0, 0, 0);
            }
            // For scrollshelf, ensure paper and wood remain purely matte and non-glowing
            if (key === 'scrollshelf') {
              mat.roughness = 0.95;
              mat.metalness = 0.0;
              if (mat.specularColor) mat.specularColor.setRGB(0.04, 0.04, 0.04);
              if (mat.specularIntensity !== undefined) mat.specularIntensity = 0.04;
            }
            // For swamp grass, ensure double-sided rendering for all blades
            if (key.startsWith('swampgrass')) {
              mat.side = THREE.DoubleSide;
              mat.roughness = 0.92;
              mat.metalness = 0.0;
            }
            /* Authored GLB normals are nearly flat. The sidecar is a tangent
               normal built from that prop's color texture, same depth pass as
               the dungeon walls. The pixel shader snaps it onto the world grid. */
            const normalId = PROP_NORMAL_INDEX[String(url).replace(/^\.\//, '')];
            if (normalId && mat.normalScale) {
              const tex = loadDataNormal(`./art/prop_normals/${normalId}.png`);
              const src = mat.map || mat.normalMap;
              if (src) { tex.wrapS = src.wrapS; tex.wrapT = src.wrapT; }
              mat.normalMap = tex;
              mat.normalScale.set(PROP_NORMAL_SCALE, PROP_NORMAL_SCALE);
            }
            propBlendPatch(mat);
          }
        }
      });
      propAssets[key] = gltf.scene;
      delete bakedPropParts[key];
      if (gltf.animations && gltf.animations.length) propClips[key] = gltf.animations;
      const box = new THREE.Box3().setFromObject(gltf.scene);
      propBaseOffset[key] = -box.min.y;
      propBackDepth[key] = -box.min.z;
      propSettled[key] = true;
      resolve(key);
    }, undefined, err => {
      // If request was aborted (e.g. page navigation, reload, HMR), ignore silently
      const isAbort = err && (err.name === 'AbortError' || String(err).includes('aborted') || String(err).includes('ReadableStream'));
      if (isAbort) {
        propSettled[key] = true;
        resolve(null);
        return;
      }
      if (retries > 0) {
        setTimeout(() => {
          registerProp(key, url, scaleMult, retries - 1).then(resolve).catch(reject);
        }, 350);
        return;
      }
      propSettled[key] = true;
      console.warn(`prop load failed: ${key}`, err);
      reject(err);
    });
  }));
}
export function registeredProps() { return Object.keys(propAssets); }

const loadedBiomes = new Set();

/** Load only the 3D models required by the current theme/biome. */
export function preloadBiomeProps(biomeKey) {
  if (!biomeKey) return Promise.resolve();
  const folder = Object.keys(BIOME_PROP_FILES).find(k => k.toLowerCase() === biomeKey.toLowerCase())
    || ({ boneyard: 'Grim', ashfield: 'Molten', snowfield: 'frost' })[biomeKey.toLowerCase()] || null;
  /* Biomes that also borrow another folder's models: holdfast mixes in Forest's
     pine; forest takes Holdfast's broadleaf trees and woodpiles. */
  const extra = ({ holdfast: ['Forest'], forest: ['Holdfast'], moor: ['Forest', 'Holdfast'], mire: ['Moor'], sporewood: ['Forest', 'Moor'], boneyard: ['Mire'] })[biomeKey.toLowerCase()] || [];
  const promises = [];
  for (const f of [folder, ...extra]) {
    if (!f || loadedBiomes.has(f)) continue;
    loadedBiomes.add(f);
    for (const [key, file] of Object.entries(BIOME_PROP_FILES[f])) {
      if (!propAssets[key]) {
        /* 'Folder/file.glb' borrows another folder's model under a new key
           (frost's snow conifers are Forest's, with snowy needles) */
        promises.push(registerProp(key, file.includes('/') ? `./3d/${file}` : `./3d/${f}/${file}`).catch(() => { }));
      }
    }
  }
  if (!loadedBiomes.has('generic') && BIOME_PROP_FILES.generic) {
    loadedBiomes.add('generic');
    for (const [key, file] of Object.entries(BIOME_PROP_FILES.generic)) {
      if (!propAssets[key]) {
        promises.push(registerProp(key, `./3d/generic/${file}`).catch(() => { }));
      }
    }
  }
  /* The bone models have their own flag. They used to ride inside the
     'generic' branch above, but the idle background preload walks every
     BIOME_PROP_FILES folder, 'generic' included, through the folder loop —
     which marked generic loaded without ever reaching this list. A level
     started after the menu sat idle then never got the skull/skeleton GLBs
     and every bone and ossuary niche fell back to the procedural pieces. */
  if (!loadedBiomes.has('bones')) {
    loadedBiomes.add('bones');
    for (const [key, file] of Object.entries(BONE_PROP_FILES)) {
      if (!propAssets[key] && !propLoading[key]) {
        promises.push(registerProp(key, `./3d/${BONE_PROP_FOLDER}/${file}`).catch(() => { }));
      }
    }
  }
  return Promise.all(promises);
}

// Background idle preload of remaining biomes after page startup
if (typeof window !== 'undefined') {
  const bgPreload = () => {
    for (const folder in BIOME_PROP_FILES) {
      if (!loadedBiomes.has(folder)) {
        preloadBiomeProps(folder);
      }
    }
    for (const [key, def] of Object.entries(CUSTOM_PROPS || {})) {
      if (def && def.url && !propAssets[key]) registerProp(key, def.url, def.scale).catch(() => { });
    }
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(bgPreload, { timeout: 4000 });
  } else {
    setTimeout(bgPreload, 2000);
  }
}

function showWebGLErrorOverlay(err, opts = {}) {
  if (document.getElementById('dc-webgl-error')) return;
  const overlay = document.createElement('div');
  overlay.id = 'dc-webgl-error';
  const title = opts.title || 'WebGL Context Could Not Be Created';
  const lead = opts.lead || 'The game was unable to initialize a WebGL graphics context on your device or browser.';
  overlay.style.cssText = 'position:fixed;inset:0;background:#07080d;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif;padding:30px;text-align:center;z-index:999999;box-sizing:border-box;';
  overlay.innerHTML = `
    <div style="background:#141722;border:1px solid #2a2e40;border-radius:12px;padding:32px;max-width:560px;box-shadow:0 12px 40px rgba(0,0,0,0.8);">
      <h2 style="margin-top:0;color:#ff5555;font-size:22px;">${title}</h2>
      <p style="color:#d0d4e4;font-size:14px;line-height:1.6;">${lead}</p>
      <div style="background:#0a0c12;border-left:4px solid #ff5555;padding:12px 16px;margin:20px 0;text-align:left;font-family:monospace;font-size:12px;color:#ff9999;overflow-x:auto;">
        ${err ? (err.message || String(err)) : 'WebGL context not supported or disabled'}
      </div>
      <p style="color:#9098b0;font-size:13px;line-height:1.5;text-align:left;">
        <strong>Troubleshooting steps:</strong><br>
        • Quit and relaunch the browser or Electron app — a tab reload cannot revive a dead GPU process.<br>
        • Close other tabs running the game, the bestiary or the VFX editor (each holds a GL context; Chrome allows 16).<br>
        • Check chrome://gpu — WebGL and WebGL2 should read "Hardware accelerated".<br>
        • Enable Hardware Acceleration in browser settings; update graphics drivers.
      </p>
      <button onclick="location.reload()" style="margin-top:16px;background:#3a5ccc;color:#fff;border:none;padding:10px 24px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:14px;">
        Retry Loading
      </button>
    </div>
  `;
  document.body.appendChild(overlay);
}

export function createWebGLRenderer() {
  const contextNames = ['webgl2', 'webgl', 'experimental-webgl'];
  const attributePresets = [
    { antialias: true, powerPreference: 'high-performance' },
    { antialias: true },
    { antialias: false, powerPreference: 'default' },
    { antialias: false, failIfMajorPerformanceCaveat: false, powerPreference: 'low-power' },
    { antialias: false, depth: true, stencil: false, alpha: false },
    { antialias: false, preserveDrawingBuffer: true },
    {}
  ];

  for (const attrs of attributePresets) {
    for (const name of contextNames) {
      try {
        const c = document.createElement('canvas');
        const gl = c.getContext(name, attrs);
        if (gl) {
          try {
            const r = new THREE.WebGLRenderer({ canvas: c, context: gl, ...attrs });
            if (r) return r;
          } catch (e) {
            /* The context was created but three.js rejected it: release it
               now rather than leaving one live per failed preset — Chrome
               counts them against the 16-per-origin cap until GC. */
            const lose = gl.getExtension('WEBGL_lose_context');
            if (lose) lose.loseContext();
            throw e;
          }
        }
      } catch (e) {
        // Continue search
      }
    }
  }

  const err = new Error('WebGL creation failed: GPU driver options exhausted or WebGL disabled in browser settings.');
  showWebGLErrorOverlay(err);
  return null;
}

export const renderer = createWebGLRenderer();
export let maxAniso = 1;
/* GPU's largest texture edge; the overland ground bake sizes itself to fit. */
let maxTextureSize = 4096;
if (renderer) {
  /* A context lost mid-run (GPU reset, driver crash, too many contexts) leaves
     the picture frozen with no message. Say so, and offer the reload; if the
     browser hands the context back on its own, reload to a clean state. */
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    showWebGLErrorOverlay(new Error('The graphics context was lost. Progress is autosaved; reload to continue.'), {
      title: 'Graphics Context Lost',
      lead: 'The GPU reset or the browser reclaimed the game’s graphics context mid-run.'
    });
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => location.reload());
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(canvasBg);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  document.body.appendChild(renderer.domElement);
  maxAniso = renderer.capabilities.getMaxAnisotropy();
  maxTextureSize = renderer.capabilities.maxTextureSize || 4096;
}

export const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(canvasBg, 0.0032);
let curBg = new THREE.Color(canvasBg);
const _cBg = new THREE.Color();

export const BASE_HALF = 55;
export const MIN_CAM_ZOOM = 3.2;
export const MAX_CAM_ZOOM = 14.0;
export const DEFAULT_CAM_ZOOM = 10.4; // 2/3 between 3.2 (min) and 14.0 (max)
let aspect = innerWidth / innerHeight;
export const cam = new THREE.OrthographicCamera(-BASE_HALF * aspect, BASE_HALF * aspect, BASE_HALF, -BASE_HALF, -400, 800);
cam.zoom = DEFAULT_CAM_ZOOM;
cam.updateProjectionMatrix();
export let yaw = Math.PI / 4, pitch = 0.64;

export function setYawPitch(y, p) { yaw = y; pitch = p; updateCam(); }

/**
 * The zoom the PLAYER last chose, by wheel or by starting a floor.
 *
 * The automatic director (game/camera_director.js) treats this as a ceiling it
 * may pull back from but never push past, so a deliberate "zoom out and look
 * around" survives the next fight instead of being snapped away. Without a
 * record of the player's intent the director would have nothing to return to
 * once combat ends but a hard-coded default.
 */
export let userZoom = DEFAULT_CAM_ZOOM;
export let userPitch = 0.64;

/**
 * The same records for exploration. Kept apart from `userZoom` / `userPitch`
 * because the two modes want opposite things — out of combat the director goes
 * in close at a low angle, in combat it stands back and higher to read the
 * fight — and a single value meant zooming out for one fight also flattened
 * every corridor after it. The wheel and the orbit drag write whichever pair
 * `camMode` names; the game sets the mode each frame (setCamMode).
 *
 * The low angle is only usable because walls in front of the party are cut
 * away (render/wall_cutaway.js); without that the director would have to
 * tilt up past them, and does when the cutaway setting is off.
 */
export const DEFAULT_EXPLORE_ZOOM = MAX_CAM_ZOOM;
export const DEFAULT_EXPLORE_PITCH = 0.37;   // ~21 deg, vs 0.64 (~37 deg) in combat: low reads best exploring
/* Exploring, an orbit drag is a look around, not a new setting: it may only tilt
   within this low range, and EXPLORE_PITCH_RETURN seconds after the last drag the
   director eases back to its low angle. (A stray right-drag used to leave the whole
   rest of the run at a high angle.) Combat keeps the player's drag, as before. */
export const EXPLORE_PITCH_MIN = 0.32, EXPLORE_PITCH_MAX = 0.62;
export const EXPLORE_PITCH_RETURN = 6.0;
let _exploreOrbitAt = -Infinity;
export let exploreZoom = DEFAULT_EXPLORE_ZOOM;
export let explorePitch = DEFAULT_EXPLORE_PITCH;
export let camMode = 'explore';
export function setCamMode(m) { camMode = m === 'combat' ? 'combat' : 'explore'; }

/** Set the zoom the director is driving. Does NOT move `userZoom`. */
export function setCamZoom(z) {
  cam.zoom = Math.min(MAX_CAM_ZOOM, Math.max(MIN_CAM_ZOOM, z));
  cam.updateProjectionMatrix();
}

/** Set the zoom AND adopt it as the player's resting choice for the current
 *  mode (exploring or fighting). */
export function setUserZoom(z) {
  setCamZoom(z);
  if (camMode === 'combat') userZoom = cam.zoom;
  else exploreZoom = cam.zoom;
}

export let elapsed = 0;
export let gameTimeScale = 1.0;
export let shakeIntensity = 0;
export const camTarget = new THREE.Vector3(0, 0, 0);

export function shakeCamera(intensity = 0.5) {
  if (getSetting('screenShake') === false) return;
  shakeIntensity = Math.max(shakeIntensity, intensity);
}

export function triggerHitStop(frames = 3) {
  if (getSetting('hitStop') === false) return;
  gameTimeScale = 0.05;
  if (getSetting('screenShake') !== false) shakeIntensity = Math.max(shakeIntensity, 0.3);
}

export function triggerSlowMo(duration = 1.5) {
  gameTimeScale = Math.min(gameTimeScale, 0.25);
}

export function updateCam() {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const f = new THREE.Vector3(cp * Math.sin(yaw), sp, cp * Math.cos(yaw));
  cam.position.copy(camTarget).addScaledVector(f, 220);
  if (shakeIntensity > 0.001) {
    const t = elapsed * 60;
    cam.position.x += Math.sin(t * 1.7) * Math.cos(t * 0.9) * shakeIntensity * 0.8;
    cam.position.z += Math.cos(t * 1.3) * Math.sin(t * 1.1) * shakeIntensity * 0.8;
  }
  cam.lookAt(camTarget);
  updateSunFollow();
}

const LIGHT_K = 4 * Math.PI;

/* Torch pool intensity multiplier & range balanced between original bright and dimmed values */
const TORCH_I_K = 1.5 / 1.5, TORCH_R_K = 16 / 9.5;
const torchPoolIntensity = TH => ((TH && TH.torchLight && TH.torchLight[1]) ?? 1.5) * TORCH_I_K;
const torchPoolRange = TH => ((TH && TH.torchLight && TH.torchLight[2]) ?? 9.5) * TORCH_R_K;

export const hemi = new THREE.HemisphereLight(0x222b3d, 0x07080c, 0.45);
scene.add(hemi);
export const dirL = new THREE.DirectionalLight(0xffe2b8, 0.78);
dirL.position.set(72, 78, 46);
dirL.castShadow = true;
dirL.shadow.mapSize.set(2048, 2048);

/* ---------------- graphics quality ----------------
   One dial for everything that costs GPU time. Lights are counted per floor
   (a changed light count recompiles every lit shader — see the effect-light
   pool in entities.js), so the torch pool takes effect at the next forge;
   everything else applies on the spot. */
const QUALITY = {
  low: { pixelRatio: 1.0, shadow: 512, post: false, bloom: 0.0, torchPool: 6, keyBudget: 8 },
  medium: { pixelRatio: 1.25, shadow: 1024, post: true, bloom: 0.6, torchPool: 10, keyBudget: 12 },
  high: { pixelRatio: 1.6, shadow: 2048, post: true, bloom: 0.9, torchPool: 16, keyBudget: 18 }
};
export function currentQuality() {
  const q = getSetting('graphicsQuality');
  return QUALITY[q] ? q : 'high';
}
export function qualityProfile() { return QUALITY[currentQuality()]; }

function applyQuality() {
  const q = qualityProfile();
  if (renderer) renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
  if (dirL.shadow.mapSize.x !== q.shadow) {
    dirL.shadow.mapSize.set(q.shadow, q.shadow);
    if (dirL.shadow.map) { dirL.shadow.map.dispose(); dirL.shadow.map = null; }
  }
  POST.enabled = q.post;
  POST.fin.uniforms.uBloom.value = q.bloom;
  applyComfort();
}
const DOF_STRENGTH = { off: 0.0, subtle: 0.6, strong: 1.0 };
let dofStrength = 1.0;      // the setting; renderFrame scales it (manual combat eases it to nothing)
let manualSharp = 0.0;      // 1 while a manual fight is on: the whole battlefield stays sharp to plan on
function applyComfort() {
  const grain = getSetting('filmGrain') !== false;
  POST.fin.uniforms.uGrain.value = grain ? 1.0 : 0.0;
  /* depth of field has its own setting now (it used to ride on film grain) */
  const dof = getSetting('depthOfField');
  dofStrength = DOF_STRENGTH[dof] != null ? DOF_STRENGTH[dof] : 1.0;
}
if (typeof window !== 'undefined') {
  applyQuality();
  setPerfOverlay(!!getSetting('perfOverlay'));
  applyUiScale(getSetting('uiScale'));
  onSettingsChange((key) => {
    if (key === null || key === 'graphicsQuality') applyQuality();
    if (key === null || key === 'filmGrain' || key === 'depthOfField') applyComfort();
    if (key === null || key === 'perfOverlay') setPerfOverlay(!!getSetting('perfOverlay'));
    if (key === null || key === 'uiScale') applyUiScale(getSetting('uiScale'));
  });
}
dirL.shadow.bias = -0.0006;
dirL.shadow.normalBias = 0.035;
dirL.shadow.camera.near = 10;
dirL.shadow.camera.far = 240;
scene.add(dirL);
scene.add(dirL.target);

export const sunOffset = new THREE.Vector3(52, 68, 38);
export function updateSunFollow() {
  if (dirL && camTarget) {
    dirL.position.copy(camTarget).add(sunOffset);
    dirL.target.position.copy(camTarget);
    dirL.target.updateMatrixWorld();
  }
}

export function setSunAngle(azDeg, altDeg, dist = 94) {
  const az = (azDeg * Math.PI) / 180;
  const alt = (altDeg * Math.PI) / 180;
  sunOffset.set(
    dist * Math.cos(alt) * Math.sin(az),
    dist * Math.sin(alt),
    dist * Math.cos(alt) * Math.cos(az)
  );
  updateSunFollow();
  if (fx.shafts && fx.shafts.length) {
    const sunDir = sunOffset.clone().normalize();
    const shaftQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDir);
    for (const sh of fx.shafts) {
      sh.quaternion.copy(shaftQuat);
    }
  }
}
updateCam();

/* Party lights: each hero's own torch, lantern or Light cantrip
   (game/light_sources.js), replacing the single lantern that used to follow
   the leader. A fixed set made once — a changed light count recompiles every
   lit shader (see the effect-light pool in entities.js) — and handed out each
   frame to the heroes who carry a light, leader first. */
const PARTY_LIGHTS = 4;
export const partyLights = [];
/* Console: __partyLights() reports why they are on/off and where they are;
   __lightSources is the live table (game/light_sources.js) — edit a field,
   e.g. __lightSources.torch.base = 1.4, and the next frame uses it. */
if (typeof window !== 'undefined') window.__lightSources = LIGHT_SOURCES;
if (typeof window !== 'undefined') window.__partyLights = () => ({
  why: partyLightWhy,
  inScene: partyLights.map(L => { let o = L; while (o.parent) o = o.parent; return o === scene; }),
  lights: partyLights.map(L => ({ intensity: +L.intensity.toFixed(2), at: L.position.toArray().map(v => +v.toFixed(1)), color: '#' + L.color.getHexString(), distance: L.distance, decay: L.decay })),
  heroes: (game && game.heroes || []).map(h => ({
    name: h.data && h.data.name, hp: h.data && h.data.hp, x: h.x, z: h.z,
    trinket: h.data && h.data.equipment && h.data.equipment.trinket && (h.data.equipment.trinket.lightSource || h.data.equipment.trinket.name)
  }))
});

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(),
  _m = new THREE.Matrix4(), _c = new THREE.Color(), _Y = new THREE.Vector3(0, 1, 0),
  _E = new THREE.Euler();

/* -------- camera & pointer interaction controls -------- */
if (renderer && renderer.domElement) {
  const cnv = renderer.domElement;
  let dragging = false, orbiting = false, lastX = 0, lastY = 0, downX = 0, downY = 0;
  cnv.addEventListener('pointerdown', e => {
    orbiting = e.button === 2 || (e.button === 0 && e.shiftKey);
    dragging = e.button === 0 && !e.shiftKey;
    lastX = e.clientX; lastY = e.clientY;
    downX = e.clientX; downY = e.clientY;
    cnv.setPointerCapture(e.pointerId);
    if ((orbiting || dragging) && game && game.notifyUserPan) game.notifyUserPan();
  });
  const _clickNdc = new THREE.Vector2();
  const _clickRay = new THREE.Raycaster();
  const _clickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const _clickPt = new THREE.Vector3();

  /* Hover marker mesh for manual move / attack intent feedback */
  const _hoverMarkerGroup = new THREE.Group();
  const _hoverTileMat = new THREE.MeshBasicMaterial({ color: 0x4ade4a, transparent: true, opacity: 0.40, depthWrite: false, side: THREE.DoubleSide });
  _hoverTileMat.toneMapped = false;
  const _hoverTileMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95).rotateX(-Math.PI / 2), _hoverTileMat);
  _hoverTileMesh.position.y = 0.035;
  _hoverMarkerGroup.add(_hoverTileMesh);

  const _hoverBorderMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.80, depthWrite: false, side: THREE.DoubleSide });
  _hoverBorderMat.toneMapped = false;
  const _hoverBorderMesh = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.48, 32).rotateX(-Math.PI / 2), _hoverBorderMat);
  _hoverBorderMesh.position.y = 0.04;
  _hoverMarkerGroup.add(_hoverBorderMesh);
  _hoverMarkerGroup.visible = false;
  scene.add(_hoverMarkerGroup);

  /* AoE Grid Tile Highlighting System for manual mode targeting */
  let _aoeTileTex = null;
  function getAoeTileTex() {
    if (_aoeTileTex) return _aoeTileTex;
    if (typeof document === 'undefined') return null;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.30)';
    ctx.fillRect(4, 4, 56, 56);
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.strokeRect(2, 2, 60, 60);
    _aoeTileTex = new THREE.CanvasTexture(cv);
    return _aoeTileTex;
  }

  const _aoeTileMat = new THREE.MeshBasicMaterial({
    map: getAoeTileTex(),
    color: 0xffaa30,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  _aoeTileMat.toneMapped = false;
  const _aoeInstancedMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.95, 0.95).rotateX(-Math.PI / 2),
    _aoeTileMat,
    144
  );
  _aoeInstancedMesh.count = 0;
  _aoeInstancedMesh.visible = false;
  scene.add(_aoeInstancedMesh);
  const _aoeTileMatrix = new THREE.Matrix4();

  /* Danger zone: every square a live melee hostile threatens against the
     hero whose turn it is. Stepping OUT of a red square provokes — the same
     sets the move resolver consults (oaHostiles/provokesOA), just painted.
     Rebuilt only when the actor, its movement budget or the monster roster
     changes, so hovering costs nothing extra. */
  const _threatMat = new THREE.MeshBasicMaterial({
    map: getAoeTileTex(), color: 0xff3a3a, transparent: true, opacity: 0.32,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
  });
  _threatMat.toneMapped = false;
  const _threatMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.95, 0.95).rotateX(-Math.PI / 2), _threatMat, 256);
  _threatMesh.count = 0; _threatMesh.visible = false; _threatMesh.renderOrder = 5;
  scene.add(_threatMesh);
  let _threatKey = '';
  const refreshThreatZone = (cur) => {
    if (!cur || !game.D) { _threatMesh.visible = false; _threatKey = ''; return; }
    const alive = (game.monsters || []).filter(m => m.active && m.data && m.data.hp > 0).length;
    const key = `${cur.data && cur.data.name}|${cur.moveLeft}|${alive}|${game.initiative && game.initiative.idx}`;
    if (key === _threatKey) return;
    _threatKey = key;
    const zone = threatZone(game, cur);
    const W = game.D.W;
    let n = 0;
    for (const c of zone) {
      if (n >= 256) break;
      if (game.D.grid[c] !== FLOOR && game.D.grid[c] !== POOL) continue;
      const cx = game.wx(c % W), cz = game.wz(Math.floor(c / W));
      _aoeTileMatrix.setPosition(cx, groundY(game.D, cx, cz) + 0.04, cz);
      _threatMesh.setMatrixAt(n++, _aoeTileMatrix);
    }
    _threatMesh.count = n;
    _threatMesh.instanceMatrix.needsUpdate = true;
    _threatMesh.visible = n > 0;
  };
  const hideThreatZone = () => { _threatMesh.visible = false; _threatKey = ''; };

  const updatePointerTargeting = (e) => {
    if (!game || !cnv) return;
    const r = cnv.getBoundingClientRect();
    _clickNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    _clickRay.setFromCamera(_clickNdc, cam);
    /* The creature drawn under the cursor, to the pixel (sprite_pick.js). Every
       preview here uses it, matching what a click there will do (explore.js commandMove). */
    const pickedU = pickUnit(game, _clickRay);
    const pickedMonster = pickedU && (game.monsters || []).includes(pickedU) ? pickedU : null;
    const pickedHero = pickedU && !pickedMonster ? pickedU : null;

    if (game.updateSpellTargeting && game.targetingState && game.targetingState.active) {
      const ts = game.targetingState;
      if (_clickRay.ray.intersectPlane(_clickPlane, _clickPt)) {
        game.updateSpellTargeting(_clickPt.x, _clickPt.z);
      }
      const tgx = _clickPt.x, tgz = _clickPt.z;
      const tooltip = document.getElementById('hover-cursor-tooltip');

      /* AoE Grid Tile Highlight: illuminate every dungeon floor tile in radius */
      if (ts.isAoE && game.D && game.D.grid) {
        const radius = ts.radius || 2.5;
        const W = game.D.W, H = game.D.H;
        const minCol = Math.max(0, Math.floor(tgx - radius - 0.5));
        const maxCol = Math.min(W - 1, Math.ceil(tgx + radius + 0.5));
        const minRow = Math.max(0, Math.floor(tgz - radius - 0.5));
        const maxRow = Math.min(H - 1, Math.ceil(tgz + radius + 0.5));
        let count = 0;
        let caughtMonsters = 0;
        let caughtAllies = 0;

        for (let row = minRow; row <= maxRow; row++) {
          for (let col = minCol; col <= maxCol; col++) {
            const cellIdx = row * W + col;
            if (game.D.grid[cellIdx] !== FLOOR && game.D.grid[cellIdx] !== POOL) continue;
            const cx = (typeof game.wx === 'function') ? game.wx(col) : col + 0.5;
            const cz = (typeof game.wz === 'function') ? game.wz(row) : row + 0.5;
            if (Math.hypot(cx - tgx, cz - tgz) <= radius) {
              if (count < 144) {
                const gy = (typeof groundY === 'function') ? groundY(game.D, cx, cz) : 0;
                _aoeTileMatrix.setPosition(cx, gy + 0.045, cz);
                _aoeInstancedMesh.setMatrixAt(count, _aoeTileMatrix);
                count++;
              }
            }
          }
        }

        for (const m of (game.monsters || [])) {
          if (m.active && m.data && m.data.hp > 0 && Math.hypot(m.x - tgx, m.z - tgz) <= radius) {
            caughtMonsters++;
          }
        }
        for (const h of (game.heroes || [])) {
          if (h.data && h.data.hp > 0 && Math.hypot(h.x - tgx, h.z - tgz) <= radius) {
            caughtAllies++;
          }
        }

        const sp = SPELLS[ts.spellKey];
        _aoeTileMat.color.setHex(sp?.color || 0xffaa30);
        _aoeInstancedMesh.count = count;
        _aoeInstancedMesh.instanceMatrix.needsUpdate = true;
        _aoeInstancedMesh.visible = count > 0;
        _hoverMarkerGroup.visible = false;

        if (tooltip) {
          tooltip.style.display = 'block';
          tooltip.style.left = `${e.clientX}px`;
          tooltip.style.top = `${e.clientY}px`;
          const foeStr = `${caughtMonsters} foe${caughtMonsters === 1 ? '' : 's'}`;
          const allyWarn = caughtAllies > 0 ? ` ⚠️ ${caughtAllies} ally in blast!` : '';
          tooltip.textContent = `🎯 ${sp?.label || 'AoE'} (${count} tiles, ${foeStr}${allyWarn})`;
        }
        return;
      }

      /* Single-target spell targeting (hero ally or enemy monster) */
      _aoeInstancedMesh.visible = false;
      const tgtMonster = pickedMonster;
      const tgtHero = ts.isAlly && pickedHero && pickedHero.data.hp > 0 ? pickedHero : null;
      const targetUnit = tgtHero || tgtMonster;

      if (targetUnit) {
        game.hoveredMonster = tgtMonster || null;
        game.hoveredUnit = targetUnit;
        _hoverMarkerGroup.visible = true;
        _hoverMarkerGroup.position.set(targetUnit.x, 0.04, targetUnit.z);
        _hoverTileMat.color.setHex(tgtHero ? 0x4ade4a : 0xffaa30);
        _hoverBorderMat.color.setHex(tgtHero ? 0xaaffaa : 0xffe0a0);
        if (tooltip) {
          const dart = ts.isMultiTarget ? ` (Dart ${(ts.assignedTargets?.length || 0) + 1}/${ts.totalDarts})` : '';
          tooltip.style.display = 'block';
          tooltip.style.left = `${e.clientX}px`;
          tooltip.style.top = `${e.clientY}px`;
          tooltip.textContent = `🎯 ${ts.isAlly ? 'Heal/Buff' : 'Target'} ${targetUnit.data.name}${dart}${lightHintFor(targetUnit)}`;
        }
      } else {
        game.hoveredMonster = null;
        game.hoveredUnit = null;
        _hoverMarkerGroup.visible = false;
        if (tooltip) {
          tooltip.style.display = 'block';
          tooltip.style.left = `${e.clientX}px`;
          tooltip.style.top = `${e.clientY}px`;
          tooltip.textContent = ts.isAlly ? `🎯 Click an ally` : `🎯 Click a target`;
        }
      }
      return;
    }

    _aoeInstancedMesh.visible = false;

    /* Manual attack targeting (melee/thrown option selected): highlight the
       monster under the cursor + range tooltip, mirroring spell targeting. */
    if (game.attackTargetingState && game.attackTargetingState.active) {
      const at = game.attackTargetingState;
      const prof = at.profile || {};
      const ranged = !prof.melee;
      const reachTiles = ranged ? Math.max(1, Math.round(prof.range || 6)) : 1;
      const tooltip = document.getElementById('hover-cursor-tooltip');
      if (_clickRay.ray.intersectPlane(_clickPlane, _clickPt)) {
        const tgt = pickedMonster;
        if (tgt) {
          game.hoveredMonster = tgt;
          game.hoveredUnit = tgt;
          _hoverMarkerGroup.visible = true;
          _hoverMarkerGroup.position.set(tgt.x, 0.04, tgt.z);
          _hoverTileMat.color.setHex(0xff3344);
          _hoverBorderMat.color.setHex(0xffaaaa);
          if (tooltip) {
            tooltip.style.display = 'block';
            tooltip.style.left = `${e.clientX}px`;
            tooltip.style.top = `${e.clientY}px`;
            const odds = attackPreviewText(attackPreview(game, at.hero, tgt, prof));
            tooltip.textContent = `${ranged ? '🎯 Throw at' : '⚔️ Attack'} ${tgt.data.name}${lightHintFor(tgt)}${odds ? '\n' + odds : ''}`;
          }
        } else {
          game.hoveredMonster = null;
          game.hoveredUnit = null;
          _hoverMarkerGroup.visible = false;
          if (tooltip) {
            tooltip.style.display = 'block';
            tooltip.style.left = `${e.clientX}px`;
            tooltip.style.top = `${e.clientY}px`;
            tooltip.textContent = ranged ? `🎯 Click a target (range ${reachTiles * 5} ft)` : `🎯 Click a target`;
          }
        }
      }
      return;
    }

    const isManual = game.controlMode === 'manual' && game.initiative && game.initiative.active;
    const cur = isManual ? game._currentActor() : null;
    const isHeroTurn = cur && cur._side === 'hero' && cur.data && cur.data.hp > 0;
    const tooltip = document.getElementById('hover-cursor-tooltip');

    if (!isManual || !isHeroTurn) {
      _hoverMarkerGroup.visible = false;
      hideThreatZone();
      if (tooltip) tooltip.style.display = 'none';
      game.hoveredMonster = pickedMonster;
      return;
    }
    refreshThreatZone(cur);

    if (_clickRay.ray.intersectPlane(_clickPlane, _clickPt)) {
      const gx = _clickPt.x, gz = _clickPt.z;
      /* The attack reticle shows when the cursor is on the monster's drawn pixels
         (sprite_pick.js), the same test the click uses in explore.js commandMove;
         floor round it stays free for movement. */
      const clickedMonster = pickedMonster;

      if (clickedMonster && !cur.actUsed) {
        game.hoveredMonster = clickedMonster;
        game.hoveredUnit = clickedMonster;
        _hoverMarkerGroup.visible = true;
        _hoverMarkerGroup.position.set(clickedMonster.x, 0.04, clickedMonster.z);
        _hoverTileMat.color.setHex(0xff3333);
        _hoverBorderMat.color.setHex(0xffaaaa);

        const dist = Math.hypot(clickedMonster.x - cur.x, clickedMonster.z - cur.z);
        const wpn = cur.data?.equipment?.weapon;
        const isRanged = wpn?.visualWeapon?.startsWith('ranged/');
        const modeText = isRanged ? `🏹 Attack ${clickedMonster.data.name}` : (dist <= 1.9 ? `⚔️ Attack ${clickedMonster.data.name}` : `🏃 Move & Attack ${clickedMonster.data.name}`);
        const prof = cur.data.weaponProfile || cur.data.lastProfile || null;
        const odds = attackPreviewText(attackPreview(game, cur, clickedMonster, prof));

        if (tooltip) {
          tooltip.style.display = 'block';
          tooltip.style.left = `${e.clientX}px`;
          tooltip.style.top = `${e.clientY}px`;
          const lh = lightHintFor(clickedMonster);
          tooltip.textContent = odds ? `${modeText}${lh}\n${odds}` : modeText + lh;
        }
      } else {
        const cell = game.cellOf ? game.cellOf(gx, gz) : -1;
        const W = game.D ? game.D.W : 20;
        const cx = (game && typeof game.wx === 'function' && cell >= 0) ? game.wx(cell % W) : (cell % W) + 0.5;
        const cz = (game && typeof game.wz === 'function' && cell >= 0) ? game.wz(Math.floor(cell / W)) : Math.floor(cell / W) + 0.5;
        const moveLeft = cur.moveLeft != null ? cur.moveLeft : game.cellsForSpeed(cur);
        const moveLeftFt = moveLeft * 5;
        let pathDistFt = Math.round(Math.hypot(cx - cur.x, cz - cur.z) * 5);
        let inBudget = pathDistFt <= moveLeftFt;
        let provokeText = '';

        if (game && game.controlMode === 'manual' && game.initiative && game.initiative.active && (cur.moveLeft || 0) > 0) {
          /* Live path preview on hover — refresh even while a pending move is
             armed, so the player can re-aim before confirming. The pending
             move's own path is held in pendingMoveState; this is just visual. */
          const curCell = game.cellOf(cur.x, cur.z);
          if (cell >= 0 && cell !== curCell && game.D && game.D.grid && (game.D.grid[cell] === FLOOR || game.D.grid[cell] === POOL)) {
            /* The click that confirms runs this same planner (explore.js), and
               an armed move is shown as the exact path it will walk. */
            let plan = game.planManualMove ? game.planManualMove(cur, cell) : null;
            const pms = game.pendingMoveState;
            if (plan && pms && pms.active && pms.hero === cur &&
              (pms.targetCell === plan.targetCell || pms.goalCell === plan.targetCell)) {
              plan = { ...plan, path: pms.path, costFt: pms.costFt };
            }
            if (plan) {
              pathDistFt = plan.fullCostFt;
              inBudget = plan.inBudget;
              const actualPath = plan.path;
              game.updatePathVisual(actualPath, plan.costFt);
              const pv = movePreview(game, cur, actualPath);
              if (pv.provokers.length && !cur.disengageActive) {
                provokeText = `\n⚠️ provokes ${pv.provokers.map(p => p.data && p.data.name).filter(Boolean).join(', ')}`;
              }
            } else if (game.clearPathVisual) {
              game.clearPathVisual();
            }
          } else if (game.clearPathVisual) {
            game.clearPathVisual();
          }
        } else if (game && game.clearPathVisual) {
          game.clearPathVisual();
        }

        _hoverMarkerGroup.visible = true;
        _hoverMarkerGroup.position.set(cx, 0.035, cz);
        _hoverTileMat.color.setHex(inBudget ? 0x4ade4a : 0xd8aa46);
        _hoverBorderMat.color.setHex(inBudget ? 0xaaffaa : 0xffddaa);

        if (tooltip) {
          tooltip.style.display = 'block';
          tooltip.style.left = `${e.clientX}px`;
          tooltip.style.top = `${e.clientY}px`;
          tooltip.textContent = (inBudget ? `🦶 Move ${pathDistFt} ft` : `⚠️ Beyond Movement (${pathDistFt} ft / ${moveLeftFt} ft max)`) + lightHintAt(cx, cz) + provokeText;
        }
      }
    }
  };

  const onPointerLeave = () => {
    hoverUnitCard(null);
    setCursorUnit(null);
    if (game) {
      game.hoveredMonster = null;
      game.hoveredUnit = null;
    }
  };
  window.addEventListener('pointerleave', onPointerLeave);
  cnv.addEventListener('pointerleave', onPointerLeave);

  /* The creature under the cursor gets a white outline in any mode, so it reads
     as clickable (unit_card.js). In manual combat, resting on it a beat also pops
     its card up beside it; elsewhere cards are pinned by clicking instead. */
  const _hoverProj = new THREE.Vector3();
  const updateUnitHover = (e) => {
    if (!game || !game.unitAtPoint || game.state !== 'crawl') { setCursorUnit(null); hoverUnitCard(null); return; }
    const r = cnv.getBoundingClientRect();
    _clickNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    _clickRay.setFromCamera(_clickNdc, cam);
    /* what is drawn under the cursor, to the pixel (sprite_pick.js), not the floor tile */
    const unit = pickUnit(game, _clickRay);
    setCursorUnit(unit);
    if (!unit || !(game.controlMode === 'manual' && game.initiative && game.initiative.active)) { hoverUnitCard(null); return; }
    /* its chest on screen: the card sits off to its side */
    const chest = (unit.data && unit.data.scale != null ? 0.4 * unit.data.scale + 0.4 : 0.6) + groundY(game.D, unit.x, unit.z);
    _hoverProj.set(unit.x, chest, unit.z).project(cam);
    hoverUnitCard(unit, r.left + (_hoverProj.x + 1) / 2 * r.width, r.top + (1 - _hoverProj.y) / 2 * r.height);
  };

  cnv.addEventListener('pointermove', e => {
    updatePointerTargeting(e);
    updateUnitHover(e);
    /* The exploration orbit holds still while the player is aiming a click. */
    if (game) game._pointerMovedAt = game.elapsed;
    if (!dragging && !orbiting) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (orbiting) {
      yaw -= dx * 0.005;
      if (camMode === 'combat') {
        pitch = Math.min(1.15, Math.max(0.32, pitch + dy * 0.005));
        userPitch = pitch;
      } else {
        pitch = Math.min(EXPLORE_PITCH_MAX, Math.max(EXPLORE_PITCH_MIN, pitch + dy * 0.005));
        explorePitch = pitch;
        _exploreOrbitAt = elapsed;
      }
    } else {
      const wpp = (2 * BASE_HALF / cam.zoom) / cnv.clientHeight;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      camTarget.x += (-dx * fz - dy * fx) * wpp;
      camTarget.z += (dx * fx - dy * fz) * wpp;
    }
    if (game && game.notifyUserPan) game.notifyUserPan();
    updateCam();
  });
  const endDrag = () => { dragging = false; orbiting = false; };
  cnv.addEventListener('pointerup', e => {
    const wasClick = e.button === 0 && !e.shiftKey &&
      Math.hypot(e.clientX - downX, e.clientY - downY) < 6;
    endDrag();
    if (!wasClick) return;
    const r = cnv.getBoundingClientRect();
    _clickNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    _clickRay.setFromCamera(_clickNdc, cam);
    /* the creature actually clicked on, to the pixel: what inspection pins */
    const clicked = game ? pickUnit(game, _clickRay) : null;
    if (_clickRay.ray.intersectPlane(_clickPlane, _clickPt)) {
      if (game && game.commandMove) game.commandMove(_clickPt.x, _clickPt.z, clicked);
    } else if (clicked && game && game.commandMove) {
      game.commandMove(clicked.x, clicked.z, clicked);
    }
  });
  cnv.addEventListener('pointercancel', endDrag);
  cnv.addEventListener('contextmenu', e => e.preventDefault());
  cnv.addEventListener('wheel', e => {
    e.preventDefault();
    /* Orthographic zoom: higher = closer. The visible half-height is
       BASE_HALF/zoom, so the min clamp caps how far out you can pull. */
    setUserZoom(cam.zoom * Math.exp(-e.deltaY * 0.0012));
    /* Zooming is camera input just as much as panning is. Before, only a drag
       held the director off, so a player who zoomed out to survey a fight had
       the framing yanked back on the very next frame. */
    if (game && game.notifyUserPan) game.notifyUserPan();
  }, { passive: false });
}

export function instSet() {
  return {
    px: [], py: [], pz: [], sx: [], sy: [], sz: [], rx: [], ry: [], rz: [], col: [], delay: [], roomIds: [], n: 0,
    add(x, y, z, sx, sy, sz, ry, color, delay, roomId) {
      this.px.push(x); this.py.push(y); this.pz.push(z);
      this.sx.push(sx); this.sy.push(sy); this.sz.push(sz);
      this.rx.push(0); this.ry.push(ry); this.rz.push(0);
      this.col.push(color); this.delay.push(delay);
      this.roomIds.push(roomId !== undefined ? roomId : -1);
      this.n++;
    },
    addT(x, y, z, sx, sy, sz, rx, ry, rz, color, delay, roomId) {
      this.px.push(x); this.py.push(y); this.pz.push(z);
      this.sx.push(sx); this.sy.push(sy); this.sz.push(sz);
      this.rx.push(rx); this.ry.push(ry); this.rz.push(rz);
      this.col.push(color); this.delay.push(delay);
      this.roomIds.push(roomId !== undefined ? roomId : -1);
      this.n++;
    }
  };
}

export function buildMesh(set, geo, mat, mode, dur, shadow) {
  const alloc = Math.max(set.n, 1);
  const mesh = new THREE.InstancedMesh(geo, mat, alloc);
  mesh.count = set.n;
  for (let i = 0; i < alloc; i++) mesh.setColorAt(i, _c.set(i < set.n ? set.col[i] : 0xffffff));
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  if (shadow === 1) { mesh.castShadow = true; mesh.receiveShadow = true; }
  else if (shadow === 2) mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.userData = { set, mode, dur, settled: false, roomIds: set.roomIds };
  writeInstances(mesh, Infinity);
  return mesh;
}

export function setAtlasAttr(geo, arr, n) {
  let at = geo.getAttribute('aUvO');
  const need = Math.max(n, 1) * 2;
  if (!at || at.array.length < need) {
    at = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(need, 4096)), 2);
    geo.setAttribute('aUvO', at);
  }
  at.array.set(arr); at.needsUpdate = true;
}

const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeOutBack = t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
let _overlandCullDirty = false;
let _lastCullX = 1e9, _lastCullZ = 1e9, _lastCullZoom = -1;

export function writeInstances(mesh, t) {
  const u = mesh.userData, s = u.set;
  let allDone = true;
  for (let i = 0; i < s.n; i++) {
    let k = (t - s.delay[i]) / u.dur;
    if (k < 1) allDone = false;
    k = Math.max(0.0001, Math.min(1, k));
    const g = u.mode === 'rise' ? easeOutCubic(k) : easeOutBack(k) * Math.min(1, k * 8);
    _q.setFromEuler(_E.set(s.rx[i], s.ry[i], s.rz[i]));
    if (s.py[i] <= -500 && s._parkedPy && s._parkedPy[i] !== undefined) {
      _p.set(s.px[i], s._parkedPy[i], s.pz[i]);
      _s.set(0, 0, 0);
    } else if (u.mode === 'rise') {
      _p.set(s.px[i], s.py[i], s.pz[i]); _s.set(s.sx[i], s.sy[i] * Math.max(g, 0.0001), s.sz[i]);
    } else {
      const m = Math.max(g, 0.0001); _p.set(s.px[i], s.py[i], s.pz[i]); _s.set(s.sx[i] * m, s.sy[i] * m, s.sz[i] * m);
    }
    _m.compose(_p, _q, _s); mesh.setMatrixAt(i, _m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  u._visState = null;
  u._fullMatrices = null;
  u._fullColors = null;
  u.settled = allDone;
  if (allDone) _overlandCullDirty = true;
}

/* -------- scene state -------- */
export let D = null;
export let group = null;
export let meshes = {};
export let overlay = null;
export let lights = [];
/* Campfire/shrine lights tagged with the room that owns them. Collected in
   buildScene's prop pass; see the 'shrineCrystal' case. */
export let roomLights = [];
export let standaloneRooms = [];
export let floorColorsBase = null, floorColorsHeat = null;
/* Cell → floor-instance mapping, recorded AS THE INSTANCES ARE EMITTED.
   The fog used to re-derive this by walking the grid and assuming one instance
   per FLOOR cell. That assumption quietly died when staircases started emitting
   STAIR_N treads apiece: from the first stair onward every cell's index was off
   by a growing amount, so revealing a room lit up unrelated tiles elsewhere on
   the map. A cell's instances are always contiguous, so (start, count) says it
   all. */
export let floorCellStart = null, floorCellCount = null;
export let animT = Infinity, animEnd = 0, animating = false;
export let fx = { liquids: [], shafts: [], mists: [], spinners: [], parts: null };
let levelGeos = [];
const lerpC = (a, b, t) => _c.set(a).lerp(new THREE.Color(b), t).getHex();

export function isAnimating() {
  return animating;
}

export function disposeLevel() {
  clearAmbientFX();
  for (const m of chestMixers) m.stopAllAction();
  chestMixers = []; chestInstances = [];
  if (group) {
    scene.remove(group);
    group.traverse(o => {
      if (o.isInstancedMesh) o.dispose();
      if (o.isLine || o.isPoints) { o.geometry.dispose(); if (o.material && o.material.dispose && o.material !== partMat) o.material.dispose(); }
    });
  }
  for (const g of levelGeos) g.dispose();
  levelGeos = [];
  group = null; meshes = {}; overlay = null;
  lights = [];
  roomLights = [];
  standaloneRooms = [];
  fx = { liquids: [], shafts: [], mists: [], spinners: [], parts: null };
}

export function applyThemeEnv(TH) {
  scene.fog.color.set(TH.fog);
  scene.fog.density = TH.fogD || 0.0025;
  curBg.set(TH.bg);
  hemi.color.set(TH.hemi[0]); hemi.groundColor.set(TH.hemi[1]); hemi.intensity = TH.hemi[2] * LIGHT_K;
  dirL.color.set(TH.dir[0]); dirL.intensity = TH.dir[1] * LIGHT_K;
  if (TH.sunAngle && Array.isArray(TH.sunAngle)) {
    setSunAngle(TH.sunAngle[0], TH.sunAngle[1]);
  } else {
    setSunAngle(54, 46.5);
  }
  applyPropTheme(TH);
  document.documentElement.style.setProperty('--ember', TH.accent);
}

/* `y` may be a number (flat level: the original behaviour) or a function of
   the cell, so a pool sunk into a lower tier draws at that tier's height. */
export function buildLiquidMesh(cells, wx, wz, y) {
  const yOf = typeof y === 'function' ? y : () => y;
  const key = new Set(cells.map(c => c.x + ',' + c.y));
  const n = cells.length;
  const pos = new Float32Array(n * 18), ae = new Float32Array(n * 12), am = new Float32Array(n * 24);
  const CE = [-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, -0.5];
  let o = 0, oe = 0, om = 0;
  for (const c of cells) {
    const x0 = wx(c.x) - 0.51, x1 = wx(c.x) + 0.51, z0 = wz(c.y) - 0.51, z1 = wz(c.y) + 0.51;
    const cy = yOf(c);
    pos.set([x0, cy, z0, x0, cy, z1, x1, cy, z1, x0, cy, z0, x1, cy, z1, x1, cy, z0], o); o += 18;
    ae.set(CE, oe); oe += 12;
    const mx0 = key.has((c.x - 1) + ',' + c.y) ? 0 : 1, mx1 = key.has((c.x + 1) + ',' + c.y) ? 0 : 1;
    const mz0 = key.has(c.x + ',' + (c.y - 1)) ? 0 : 1, mz1 = key.has(c.x + ',' + (c.y + 1)) ? 0 : 1;
    for (let k = 0; k < 6; k++) { am[om++] = mx0; am[om++] = mx1; am[om++] = mz0; am[om++] = mz1; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aE', new THREE.BufferAttribute(ae, 2));
  g.setAttribute('aM', new THREE.BufferAttribute(am, 4));
  levelGeos.push(g);
  return new THREE.Mesh(g, liquidMat);
}

export function buildScene(d) {
  disposeLevel();
  D = d;
  d.perches = [];
  /* A new floor resets the player's resting zooms too, otherwise a zoom set
     three floors ago silently caps the director forever. A floor opens out of
     combat, so the camera starts on the exploration zoom. */
  userZoom = DEFAULT_CAM_ZOOM;
  exploreZoom = DEFAULT_EXPLORE_ZOOM;
  camMode = 'explore';
  setCamZoom(exploreZoom);
  initNixieVfx(scene, cam);
  clearPersistentNixieEffects();
  const W = d.W, H = d.H;
  const wx = x => x - W / 2 + 0.5, wz = y => y - H / 2 + 0.5;
  const er = (d.rooms && d.entrance >= 0 && d.rooms[d.entrance]) || (d.rooms && d.rooms[0]);
  if (er) {
    camTarget.set(wx(er.cx), 0, wz(er.cy));
    updateCam();
  }
  initAmbientFX(scene, cam, d.params?.themeKey || d.themeKey, er ? new THREE.Vector3(wx(er.cx), 1.2, wz(er.cy)) : null);
  let TH = d.effectiveTheme || THEMES[d.params?.themeKey || d.themeKey] || THEMES.ancient;
  if (!d.effectiveTheme && TH.overland) {
    const env = resolveOverlandEnvironment(d.params?.themeKey || d.themeKey, d.seed || 1, d.params || {});
    TH = buildEffectiveOverlandTheme(TH, env);
    d.effectiveTheme = TH;
    d.weatherEnv = env;
    d.weather = env.weather;
    d.timeOfDay = env.timeOfDay;
  }
  const accC = parseInt(TH.accent.slice(1), 16);
  applyThemeEnv(TH);
  applyThemeLightLevels(TH);
  applyTileTheme(d.params.themeKey || d.themeKey);
  preloadBiomeProps(d.params?.themeKey || d.themeKey);
  group = new THREE.Group(); scene.add(group);

  if (!partyLights.length) {
    for (let i = 0; i < PARTY_LIGHTS; i++) {
      const L = new THREE.PointLight(0xffffff, 0, 9, 1);
      L.userData = { ph: i * 2.3, crowd: 1, partyLight: true };
      scene.add(L);
      partyLights.push(L);
    }
  }

  const grid = d.grid, roomId = d.roomId, corridor = d.corridor,
    doorway = d.doorway, bfs = d.bfs, maxBfs = d.maxBfs, rooms = d.rooms,
    lakeMask = d.lakeMask;
  const idx = (x, y) => y * W + x;
  const cellRng = makeRng(d.seed ^ 0x9e3779b9);
  const dStep = 0.016;
  /* Tiled overland ground (holdfast): one baked texture with a dirt road down
     the trail. The tiles carry their own colour, so floor instances are tinted
     near-white instead of TH.floor (which would muddy the bake to olive). */
  const GT = (TH.overland && TH.groundTiles && d.roadDist) ? TH.groundTiles : null;

  /* ── elevation ───────────────────────────────────────────────────────
     Levels generated before elevation existed (and overland maps, which stay
     flat in Tier 1) carry no height array; eH/eR then report 0 for every cell
     and everything below collapses to exactly the old flat output. */
  const eHeight = d.height || null, eRamp = d.ramp || null;
  const eH = c => (eHeight && c >= 0 && c < eHeight.length) ? eHeight[c] : 0;
  const eR = c => (eRamp && c >= 0 && c < eRamp.length) ? eRamp[c] : 0;
  /* Surface Y for a cell — the plane a body standing here walks on. */
  const surfY = c => eH(c) * ELEV_STEP;
  /* Same, from world coordinates — for the handful of scene objects positioned
     in world space rather than from a grid cell (light shafts, the boss rune). */
  const surfYW = (wxv, wzv) => {
    const gx = Math.round(wxv + W / 2 - 0.5), gy = Math.round(wzv + H / 2 - 0.5);
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) return 0;
    return surfY(idx(gx, gy));
  };

  /* GEO.floor is a 0.22-thick slab spanning y in [-0.22, 0]: its TOP face sits
     exactly at the instance origin and the slab hangs downward. So for a block
     with surface T and underside B:
       y = T           (independent of scale — the top never moves)
       k = (T-B)/0.22  (scaling only ever extends the block DOWNWARD)
     Worth stating plainly because assuming the slab straddled its origin cost
     a full debugging round: that version added a scale-dependent term to y,
     leaving every stretched block riding 0.11*(k-1) high — invisible at k=1,
     and the reason raised tiles floated above their own props at k=5. */
  const SLAB = 0.22;

  /* Every floor block is sunk to the LOWEST floor surface on the level rather
     than to whatever sits beside it. Deriving depth from cardinal neighbours
     left daylight under the terrain in three separate cases: platform
     interiors (all four neighbours equally high, so the block stayed a thin
     slab floating a level up), convex corners (the only lower neighbour is
     diagonal), and edges facing VOID. A common floor costs nothing — instance
     count is unchanged and the extra geometry is buried. Clamped against the
     block's own thickness so a flat level still yields k=1 exactly. */
  let floorMinY = 0;
  for (let c = 0; c < W * H; c++) {
    if (grid[c] !== FLOOR && grid[c] !== POOL) continue;
    const t = surfY(c);
    if (t < floorMinY) floorMinY = t;
  }

  /* How far down a block extends. Only as far as the LOWEST OF ITS EIGHT
     NEIGHBOURS, plus a full slab of overlap — never to the level's global
     floor.
     Sinking everything to a common floor did close the gaps, but the geometry
     below a tile's lowest neighbour can never be seen, and the cost was paid
     in texture: the side UVs are normalised over the geometry's own 0.22
     height, so scaling a block to k times that stretches its texture k times.
     Global floor drove k as high as 11 and left only 95 of 3184 tiles
     unstretched; the neighbour rule caps k at 5 and leaves 2516 of them at
     k = 1, unstretched entirely.
     The gaps this originally fixed came from consulting only the four
     CARDINAL neighbours with no overlap — convex corners and platform
     interiors had no lower cardinal to react to. Eight neighbours and a slab
     of overlap close them for the same reason, without the depth: the
     neighbour's own block spans at least SLAB below its top, so reaching
     SLAB under it guarantees the two overlap. */
  /* Where a cell's geometry actually starts, as opposed to its nominal
     surface level — see blockBottom. */
  /* Open graves (generator p.sink / p.sinkCells): their cells' ground drops
     by the model's rim height so the pit sits below the turf. Everything
     below that reads renderedTop, so the neighbouring slabs reach down to
     the sunken ground and their sides become the grave's dirt walls. */
  const sinkDepth = new Float32Array(W * H);
  for (const p of d.props) if (p.sink && p.sinkCells) for (const c of p.sinkCells) sinkDepth[c] = p.sink;
  const renderedTop = (c) => {
    if (grid[c] === POOL) return surfY(c) - 0.16;          /* basin rim */
    if (sinkDepth[c]) return surfY(c) - sinkDepth[c];
    /* Must match the lake-bed formula in the floor pass exactly; estimating it
       as one flat step left 343 edges where a neighbour stopped short of the
       bed it was meant to meet. */
    if (lakeMask[c] && grid[c] === FLOOR) return Math.min(surfY(c) - ELEV_STEP, floorMinY);
    return surfY(c);
  };
  const blockBottom = (ownT, gx, gy) => {
    let lo = ownT;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = gx + ox, ny = gy + oy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const nc = idx(nx, ny);
      const isRenderedWall = grid[nc] === WALL && TH.overland && wallDist[nc] >= 0 && wallDist[nc] <= 5;
      if (grid[nc] !== FLOOR && grid[nc] !== POOL && !isRenderedWall) continue;
      /* The neighbour's RENDERED top, which is not always its nominal surface:
         a lake draws its bed a step under the waterline and a pool sinks a
         basin below its rim. Reaching only to the nominal level left a gap
         over exactly those cells. */
      const t = isRenderedWall ? surfY(nc) : renderedTop(nc);
      if (t < lo) lo = t;
    }
    return Math.min(lo, ownT) - SLAB;
  };

  /* Walls have to reach that same common floor. GEO.wall spans y in [0,1] —
     it stands ON the base plane and grows upward, so every wall bottom used to
     sit at exactly y=0. The moment a sunken tier put floor below 0, the wall
     stopped short and you looked straight through the gap into the void: a
     black band up to 0.9 tall along the base of every wall bordering a pit.
     Walls are not props, so nothing else caught this.
     Left at 0 when the level never goes below the base plane, so flat levels
     and overland keep their exact original wall geometry. */
  const wallBase = floorMinY < 0 ? floorMinY - SLAB : 0;

  /* Which way does a ramp cell slope, as [dx, dy, sign]? +1 means the
     neighbour is a level UP (a dais approach), -1 a level DOWN (the lip of a
     sunken pit). Both exist, and looking only uphill left pit-side stairs
     rendering as flat tiles with a hard drop off the end. Uphill wins when a
     cell has both. */
  const rampDir = (x, y, c) => {
    const h = eH(c);
    let down = null;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + ox, ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const nc = idx(nx, ny);
      if (grid[nc] !== FLOOR) continue;
      if (eH(nc) === h + 1) return [ox, oy, 1];
      if (eH(nc) === h - 1 && !down) down = [ox, oy, -1];
    }
    return down;
  };
  /* Ramps are built as STAIRS, not slopes: a tilted slab reads as a wheelchair
     ramp from the fixed camera angle, which is wrong for a dungeon. STAIR_N
     visible treads plus the platform lip divide the rise into STAIR_N+1 equal
     risers of STEP/4 = 0.1125. */
  const STAIR_N = 3;

  const floorAnchor = (gx, gy) => {
    gx = Math.max(0, Math.min(W - 1, Math.round(gx)));
    gy = Math.max(0, Math.min(H - 1, Math.round(gy)));
    if (grid[idx(gx, gy)] === FLOOR || grid[idx(gx, gy)] === POOL) return idx(gx, gy);
    for (const o of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = gx + o[0], ny = gy + o[1];
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && (grid[idx(nx, ny)] === FLOOR || grid[idx(nx, ny)] === POOL)) return idx(nx, ny);
    }
    return -1;
  };

  const poolAdj = (x, y) => {
    const c = idx(x, y);
    return (x < W - 1 && grid[c + 1] === POOL) || (x > 0 && grid[c - 1] === POOL) ||
      (y < H - 1 && grid[c + W] === POOL) || (y > 0 && grid[c - W] === POOL);
  };

  const nearFloorBfs = (x, y) => {
    let b = 1e4;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const nx = x + ox, ny = y + oy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && bfs[idx(nx, ny)] >= 0) b = Math.min(b, bfs[idx(nx, ny)]);
    } return b === 1e4 ? 0 : b;
  };

  /* Distance-from-floor BFS for culling off-screen void trees and ground */
  const wallDist = new Int16Array(W * H).fill(-1);
  const qDist = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = idx(x, y);
    if (grid[c] === FLOOR) {
      wallDist[c] = 0;
      qDist.push(x, y);
    }
  }
  let qdHead = 0;
  while (qdHead < qDist.length) {
    const qx = qDist[qdHead++];
    const qy = qDist[qdHead++];
    const dCur = wallDist[idx(qx, qy)];
    if (dCur >= 5) continue;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = qx + ox, ny = qy + oy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H) {
        const nc = idx(nx, ny);
        if (wallDist[nc] === -1) {
          wallDist[nc] = dCur + 1;
          qDist.push(nx, ny);
        }
      }
    }
  }

  /* floors */
  const fs = instSet(); floorColorsBase = []; floorColorsHeat = [];
  floorCellStart = new Int32Array(W * H).fill(-1); floorCellCount = new Uint8Array(W * H);
  const markFloorCell = (c, from) => {
    if (fs.n <= from) return;
    floorCellStart[c] = from; floorCellCount[c] = fs.n - from;
  };
  const fUv = [], pushVar = (arr, rng) => { const v = rng.i(0, 3); arr.push((v & 1) * 0.5, (v >> 1) * 0.5); };
  const decCand = [];
  const base = new THREE.Color(), tint = new THREE.Color(),
    heatA = new THREE.Color(0x2f4bb0), heatB = new THREE.Color(0xe8502f);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = idx(x, y);
    const isWall = grid[c] === WALL;
    if ((!isWall && grid[c] !== FLOOR) || lakeMask[c]) {
      /* A lake is FLOOR flagged by lakeMask, and the floor pass skips it — so
         historically nothing was drawn beneath the water at all. Flat levels
         got away with it because neighbouring blocks hid the hole from every
         angle; once a lake could be levelled onto a tier, the surface was left
         hanging over open space. Give it a bed: one step below the waterline,
         sunk to the same common floor as everything else. */
      if (lakeMask[c] && grid[c] === FLOOR) {
        const bedTop = Math.min(surfY(c) - ELEV_STEP, floorMinY);
        const bedK = Math.max(1, (bedTop - blockBottom(bedTop, x, y)) / SLAB);
        const bcol = new THREE.Color(TH.floor).multiplyScalar(0.55).getHex();
        const fi0 = fs.n;
        fs.add(wx(x), bedTop, wz(y), 1, bedK, 1, 0, bcol, Math.max(0, bfs[c]) * dStep);
        markFloorCell(c, fi0);
        pushVar(fUv, cellRng);
        floorColorsBase.push(bcol); floorColorsHeat.push(bcol);
      }
      continue;
    }
    if (isWall && (!TH.overland || wallDist[c] < 0 || wallDist[c] > 5)) continue;
    let walls8 = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = x + ox, ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || grid[idx(nx, ny)] === WALL) walls8++;
    }
    const rid = roomId[c];
    if (isWall) {
      base.set(GT ? 0xe8e8e8 : TH.floor).multiplyScalar(cellRng.f(0.85, 1.02));
      floorColorsBase.push(base.getHex());
      floorColorsHeat.push(base.getHex());
      const dl = nearFloorBfs(x, y) * dStep + 0.28;
      const fi0 = fs.n;
      const topY = surfY(c) + cellRng.f(-0.02, 0.008);
      const botY = blockBottom(topY, x, y);
      const k = Math.max(1, (topY - botY) / SLAB);
      fs.add(wx(x), topY, wz(y), 1, k, 1, cellRng.i(0, 3) * (Math.PI / 2), base.getHex(), dl);
      markFloorCell(c, fi0);
      pushVar(fUv, cellRng);
    } else {
      base.set(GT ? 0xf2f2f2 : (corridor[c] ? TH.corridor : TH.floor));
      const applyRoomTint = TH.roomTint !== false && TH.label !== 'MOLTEN' && d.params?.themeKey !== 'molten' && d.themeKey !== 'molten';
      if (applyRoomTint && rid >= 0 && rooms[rid].type !== TYPE.COMBAT) base.lerp(tint.set(TINT[rooms[rid].type]), 0.17);
      if (doorway[c]) base.multiplyScalar(1.14);
      if (TH.pools && TH.pools.mode === 0 && poolAdj(x, y)) base.lerp(tint.set(0xff7a33), 0.3);
      base.multiplyScalar(1 - 0.11 * Math.min(walls8, 4));
      base.multiplyScalar(((x + y) & 1) ? 0.965 : 1.0);
      base.multiplyScalar(cellRng.f(0.94, 1.06));
      floorColorsBase.push(base.getHex());
      const diff = rid >= 0 ? rooms[rid].difficulty : (maxBfs ? bfs[c] / maxBfs : 0.5);
      floorColorsHeat.push(heatA.clone().lerp(heatB, Math.min(1, diff)).multiplyScalar(0.55 + 0.45 * (1 - 0.09 * Math.min(walls8, 4))).getHex());
      const jit = cellRng.f(-0.02, 0.008);
      const topY = surfY(c) + jit - sinkDepth[c];     /* visible top surface */
      const col = floorColorsBase[floorColorsBase.length - 1];
      const dly = Math.max(0, bfs[c]) * dStep;
      const rot = cellRng.i(0, 3) * (Math.PI / 2);
      const rdir = eR(c) ? rampDir(x, y, c) : null;
      if (rdir) {
        /* Each tread is a FULL-SIZE tile, not a 1/STAIR_N sliver. The atlas UVs
           are baked into GEO.floor, so scaling a box down the run squashes its
           texture — sliver treads rendered at 3x the pixel density of the floor
           around them. Instead every tread keeps a 1.0 footprint and slides
           along the run, each extending UNDER the higher ground beside it: the
           next tread up (and finally the platform itself) buries the overhang,
           leaving a clean 1/STAIR_N band visible at the correct density.
           The box extends toward the HIGH side — forward when climbing, back
           when descending into a pit — because that is the side with geometry
           tall enough to hide it. */
        const [ox, oz, sgn] = rdir;
        const rise = sgn * ELEV_STEP;
        /* floorColorsBase/Heat are parallel to INSTANCES, not cells, and this
           cell emits STAIR_N of them. One entry was pushed above, so top the
           arrays up or every colour past the first staircase is read from the
           wrong index (applyReveal and the heat overlay both index by
           instance). */
        for (let e = 1; e < STAIR_N; e++) {
          floorColorsBase.push(floorColorsBase[floorColorsBase.length - 1]);
          floorColorsHeat.push(floorColorsHeat[floorColorsHeat.length - 1]);
        }
        const fi0 = fs.n;
        for (let i = 0; i < STAIR_N; i++) {
          const treadTop = topY + rise * ((i + 1) / (STAIR_N + 1));
          const front = -0.5 + i / STAIR_N;     /* near edge of visible band */
          const ctr = sgn > 0 ? front + 0.5 : front + 1 / STAIR_N - 0.5;
          const bot = blockBottom(Math.min(topY, treadTop), x, y);
          const k = Math.max(1, (treadTop - bot) / SLAB);
          fs.add(wx(x) + ox * ctr, treadTop, wz(y) + oz * ctr, 1, k, 1, rot, col, dly);
          pushVar(fUv, cellRng);
        }
        markFloorCell(c, fi0);
        continue;
      }
      const botY = blockBottom(topY, x, y);
      const k = Math.max(1, (topY - botY) / SLAB);
      const fi0 = fs.n;
      fs.add(wx(x), topY, wz(y), 1, k, 1, rot, col, dly);
      markFloorCell(c, fi0);
      pushVar(fUv, cellRng);
      if (!sinkDepth[c]) decCand.push({ x, y, rid, walls8, surfY: surfY(c) });
    }
  }
  /* Overland ground defaults to the untextured grass material (per-instance
     tinted from TH.floor); themes over bare earth, ash or dust ask for the
     flagstone atlas instead via `groundMat`, and ice for frozen surfaces. */
  const groundMat = GT ? matGroundTiles
    : TH.overland
      ? (TH.groundMat === 'floor' ? matFloor : TH.groundMat === 'ice' ? matIce : matGrass)
      : matFloor;
  meshes.floor = buildMesh(fs, GEO.floor, groundMat, 'pop', 0.34, 2);
  setAtlasAttr(GEO.floor, fUv, fs.n);
  if (GT) {
    /* Road = open cells within GT.road tiles of the trail centreline. The bake
       is async (tile images); until it lands the ground shows the plain
       fallback, and a bake that finishes after the next floor began is dropped. */
    /* The first row past the band is worn to dirt GT.wear of the time, in
       clumps, so the verge reads as a worn track rather than a ruled stripe. */
    const dirt = new Uint8Array(W * H);
    const wear = (x, y) => {
      const h = Math.sin((Math.floor(x / 2) * 12.9898 + Math.floor(y / 2) * 78.233 + (d.seed % 997)) * 43758.5453);
      return h - Math.floor(h);
    };
    for (let c = 0; c < W * H; c++) {
      const rd = d.roadDist[c];
      if (grid[c] === WALL || rd < 0) continue;
      if (rd <= GT.road || (rd === GT.road + 1 && wear(c % W, (c / W) | 0) < (GT.wear ?? 0.35))) dirt[c] = 1;
    }
    const token = ++groundBakeSeq;
    setGroundTiles(null, -W / 2, -H / 2, W, H, GT);   // GT carries sat/bright for the banks too
    /* cap at 10240: a full-res 300-tile ribbon is 9600px, and past that the
       bake's GPU memory outgrows its payoff */
    bakeOverlandGround(W, H, dirt, {
      seed: d.seed, sat: GT.sat, bright: GT.bright, sepia: GT.sepia, road: GT.surface, anisotropy: maxAniso || 1,
      maxTexture: Math.min(maxTextureSize, 10240)
    })
      .then(tex => {
        if (token === groundBakeSeq) setGroundTiles(tex, -W / 2, -H / 2, W, H);
        else tex.dispose();
      })
      .catch(err => console.warn('overland ground bake failed', err));
  }

  /* prop instance sets */
  const S = {
    pillar: instSet(), arch: instSet(), archL: instSet(), gate: instSet(), torchArm: instSet(),
    flame: instSet(), flameCore: instSet(),
    debrisA: instSet(), debrisB: instSet(), debrisC: instSet(),
    chest: instSet(), chestTrim: instSet(), chestGlow: instSet(),
    grave: instSet(), sarco: instSet(), candle: instSet(), bone: instSet(),
    skull: instSet(), skeleton: instSet(), bonePile: instSet(), spiderWeb: instSet(),
    icicle: instSet(), shardIce: instSet(), roots: instSet(),
    crackD: instSet(), skirt: instSet(), bannerRod: instSet(), bannerCloth: instSet(), emblem: instSet(),
    spawn1: instSet(), spawn2: instSet(), spawn3: instSet(), band2: instSet(), band3: instSet(),
    crystal: instSet(), ring: instSet(), plinth: instSet(), platform: instSet(),
    brazier: instSet(), coals: instSet(), basin: instSet(), tent: instSet(),
    campfireStones: instSet(), campfireLogs: instSet(), campfireCoals: instSet(), campfireFlames: instSet(), campfireFlameCore: instSet(),
    bossGlow: instSet(), bossRock: instSet(),
    runeSeal: instSet(), ember: instSet(), rime: instSet(), stain: instSet(), growth: instSet(),
    barrel: instSet(), crate: instSet(), table: instSet(), bench: instSet(), chair: instSet(),
    bookshelf: instSet(), bookshelfBooks: instSet(), weaponRack: instSet(), statue: instSet(), urn: instSet(),
    rug: instSet(), magicCircle: instSet(), tapestry: instSet(), sconce: instSet(),
    forge: instSet(), cauldron: instSet(), ossuaryFrame: instSet(), ossuaryBones: instSet(), ossuaryBeds: instSet(), sporePod: instSet(),
    megalith: instSet(), wagon: instSet(), altarTable: instSet(), iceThrone: instSet(), globe: instSet(),
    sepulcherDais: instSet(),
    stalagmite: instSet(), boulderPile: instSet(), forgeChains: instSet(), hangingChains: instSet(), bridgeRailing: instSet(),
    magmaBridge: instSet(), magmaBridgeApproach: instSet(),
    woodBridge: instSet(), woodRailing: instSet(),
    mammothTusks: instSet(), runicObelisk: instSet(), runicObeliskGlow: instSet(), shieldRack: instSet(), hearthPit: instSet(), boneTotem: instSet(), glacialSpire: instSet(),
    ingotStack: instSet(), goldBullion: instSet(), smeltingCrucible: instSet(), crucibleLiquid: instSet(),
    swampgrass: instSet(), swampgrass2: instSet(), swampgrass3: instSet(),
    cornerRubbleA: instSet(), cornerRubbleB: instSet(), cornerRubbleC: instSet(), cornerRubbleD: instSet(), fallenBrick: instSet(),
    wallIvy: instSet(), threshold: instSet()
  };
  const pd = (x, y) => Math.max(0, bfs[idx(x, y)]) * dStep + 0.62;
  const shaftAt = [];
  const rubbleAUv = [], rubbleBUv = [], rubbleCUv = [], rubbleDUv = [], brickUv = [];
  let portalXZ = null, runeXZ = null;

  /* walls + trim caps */
  const ws = instSet(), cs = instSet();
  const wUv = [], cUv = [];
  const wcol = new THREE.Color();
  /* Overland blockers come in two silhouettes: trunk+canopy (forest, mire,
     sporewood, boneyard…) or jittered masonry (ruinfield, ashfield). */
  const blockGeo = TH.overland && TH.blockerGeo === 'block';
  if (TH.overland) {
    const pal = d.palisadeMask;
    /* arena thickets (generateOverland): grown solid, never thinned */
    const thicket = d.thicketMask;
    const isWinter = TH.label === 'SNOWFIELD' || TH.label === 'FROST' || d.params?.themeKey === 'snowfield' || d.themeKey === 'frost';
    const isForest = TH.label === 'FOREST' || d.params?.themeKey === 'forest' || d.themeKey === 'forest';
    const isMoor = TH.label === 'MOOR' || d.params?.themeKey === 'moor' || d.themeKey === 'moor';
    const isMire = TH.label === 'MIRE' || d.params?.themeKey === 'mire' || d.themeKey === 'mire';
    const isSporewood = TH.label === 'SPOREWOOD' || d.params?.themeKey === 'sporewood' || d.themeKey === 'sporewood';
    const isHoldfast = TH.label === 'HOLDFAST' || d.params?.themeKey === 'holdfast' || d.themeKey === 'holdfast';
    const isBoneyard = TH.label === 'BONEYARD' || d.params?.themeKey === 'boneyard' || d.themeKey === 'boneyard';

    const treeOptions = [];
    const treeKeys = [];   // parallel to treeOptions: prop key, for FOLIAGE lookups
    if (isBoneyard) {
      for (const k of BONEYARD_TREES) if (propAssets[k]) { treeOptions.push(propAssets[k]); treeKeys.push(k); }
    } else if (isHoldfast) {
      /* Settled country: the broadleaf models (bare, leaf cards added by
         tree_foliage.js) mixed with pine. Files live in BIOME_PROP_FILES.Holdfast. */
      for (const k of HOLDFAST_TREES) if (propAssets[k]) { treeOptions.push(propAssets[k]); treeKeys.push(k); }
    } else if (isWinter) {
      /* the new conifers, frosted (tree_foliage.js snow); the old snowtree
         model only if they failed to load */
      for (const k of WINTER_TREES) if (propAssets[k]) { treeOptions.push(propAssets[k]); treeKeys.push(k); }
      if (!treeOptions.length) {
        const wAsset = propAssets.snowtree || propAssets.tree_winter || propAssets.tree;
        if (wAsset) treeOptions.push(wAsset);
      }
    } else if (isMoor) {
      // Moor: conifers (needle cards) and swamp trees
      for (const k of MOOR_TREES) if (propAssets[k]) { treeOptions.push(propAssets[k]); treeKeys.push(k); }
    } else if (isMire) {
      // Mire: mix of swamp trees and dead trees
      if (propAssets.swamptree) { treeOptions.push(propAssets.swamptree); treeKeys.push('swamptree'); }
      if (propAssets.deadtree) { treeOptions.push(propAssets.deadtree); treeKeys.push(null); }
    } else if (isSporewood) {
      if (propAssets.sporewillow) { treeOptions.push(propAssets.sporewillow); treeKeys.push('sporewillow'); }
      else if (propAssets.spruce) { treeOptions.push(propAssets.spruce); treeKeys.push('spruce'); }
    } else if (isForest) {
      /* Pine, with broadleaf mixed in (leaf cards from tree_foliage.js). */
      for (const k of FOREST_TREES) if (propAssets[k]) { treeOptions.push(propAssets[k]); treeKeys.push(k); }
    }

    const treeMeshes = [];
    treeOptions.forEach((opt, oi) => {
      let mesh = null;
      opt.traverse(o => {
        if (o.isMesh && !mesh) {
          mesh = o;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          if (mesh.material) {
            if (mesh.material.roughnessMap) mesh.material.roughnessMap = null;
            if (mesh.material.metalnessMap) mesh.material.metalnessMap = null;
            mesh.material.roughness = 0.94;
            mesh.material.metalness = 0.0;
            mesh.material.shadowSide = THREE.DoubleSide;
            propBlendPatch(mesh.material);
            cutawayPatch(mesh.material);   // trees are this theme's walls
          }
        }
      });
      if (mesh) {
        treeMeshes.push({ mesh, geo: treeGeometry(opt, mesh), key: treeKeys[oi], set: instSet() });
      }
    });

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = idx(x, y);
      if (grid[c] !== WALL) continue;
      if (treeMeshes.length > 0 && (wallDist[c] < 0 || wallDist[c] > 5)) continue;
      const dl = nearFloorBfs(x, y) * dStep + 0.30;
      const treeY = surfY(c);
      /* The generator lays the ring as model fence sections on these themes
         (oc.camp.palisadeModel); the WALL cells still block, nothing to draw. */
      if (pal && pal[c] && TH.oc?.camp?.palisadeModel) continue;
      if (pal && pal[c]) {
        const hh = 1.5 + cellRng.f(-0.1, 0.18);
        wcol.set(TH.stake || 0x6b4a2f).multiplyScalar(cellRng.f(0.86, 1.1));
        ws.add(wx(x), treeY, wz(y), 1.5, hh, 1.5, cellRng.f(-0.08, 0.08), wcol.getHex(), dl);
        wcol.set(TH.stakeCap || 0x543822).multiplyScalar(cellRng.f(0.9, 1.05));
        cs.add(wx(x), treeY + hh - 0.06, wz(y), 0.42, 0.34, 0.42, cellRng.f(0, 6.28), wcol.getHex(), dl + 0.1);
        /* keep the atlas-uv arrays in step with the instance sets */
        if (blockGeo) { pushVar(wUv, cellRng); pushVar(cUv, cellRng); }
      } else if (blockGeo) {
        /* masonry blockers: toppled colonnade, obsidian spires.
           Same jitter-and-rotate treatment as the trees so an open field of them
           still reads as terrain rather than a dungeon wall, but built from the
           boxy wall/cap geometry with the stone atlas. */
        const [hMul, capMul] = TH.blockerH || [1, 0.6];
        const hh = (1.7 + cellRng.f(-0.55, 0.7)) * hMul;
        const jx = cellRng.f(-0.18, 0.18), jz = cellRng.f(-0.18, 0.18);
        const sxz = cellRng.f(0.72, 1.05);
        wcol.set(TH.wall).multiplyScalar(cellRng.f(0.82, 1.12));
        ws.add(wx(x) + jx, treeY, wz(y) + jz, sxz, hh, sxz, cellRng.f(0, 6.28), wcol.getHex(), dl);
        pushVar(wUv, cellRng);
        wcol.set(TH.cap).multiplyScalar(cellRng.f(0.88, 1.12));
        cs.add(wx(x) + jx, treeY + hh, wz(y) + jz, sxz * capMul, capMul, sxz * capMul,
          cellRng.f(0, 6.28), wcol.getHex(), dl + 0.12);
        pushVar(cUv, cellRng);
      } else if (treeMeshes.length > 0) {
        /* 3D Model Trees (Forest, Frost, Moor, Mire, Sporewood) */
        // Density tiered by distance: front row 0.85, row 2 0.72, row 3 0.60, row 4 0.48, row 5 0.38
        /* TH.treeDensity thins the whole belt for open country (holdfast) */
        /* TH.treeCopses gathers what is left into stands with bare ground between
           them, and only the odd lone tree out in the open (the moor's hills) */
        const copses = TH.treeCopses;
        const copseKeep = !copses ? 1
          : copseNoise(x, y, d.params?.seed ?? d.seed ?? 0, copses.size) >= copses.above ? 1 : copses.lone;
        const keepProb = (thicket && thicket[c]) ? 1 : (TH.treeDensity ?? 1) * copseKeep *
          (wallDist[c] === 1 ? 0.85 : (wallDist[c] === 2 ? 0.72 : (wallDist[c] === 3 ? 0.60 : (wallDist[c] === 4 ? 0.48 : 0.38))));
        if (cellRng.f(0, 1) <= keepProb) {
          const chosen = treeMeshes[cellRng.i(0, treeMeshes.length - 1)];
          const baseScale = cellRng.f(2.0, 3.4) * (TREE_SCALE[chosen.key] || 1);
          // Scale variance: independent horizontal (skinny/wide) and vertical (short/tall)
          const sx = baseScale * cellRng.f(0.70, 1.05);
          const sz = baseScale * cellRng.f(0.70, 1.05);
          const sy = baseScale * cellRng.f(0.88, 1.35);
          // Angle variance: 0 to 5 degrees (0.087 rad) random tilt + 360 yaw
          const tiltMag = cellRng.f(0.0, 0.087);
          const tiltDir = cellRng.f(0, 6.28);
          const rx = Math.sin(tiltDir) * tiltMag;
          const rz = Math.cos(tiltDir) * tiltMag;
          const ry = cellRng.f(0, 6.28);
          const jx = cellRng.f(-0.22, 0.22), jz = cellRng.f(-0.22, 0.22);
          chosen.set.addT(wx(x) + jx, treeY, wz(y) + jz, sx, sy, sz, rx, ry, rz, 0xffffff, dl);
          recordTreePerch(
            chosen.geo, x, y,
            wx(x) + jx, treeY, wz(y) + jz,
            sx, sy, sz, rx, ry, rz,
            -1, treeY + sy * gripFrac(chosen.key),
          );
        }
      } else {
        /* Procedural conifer trees (Snowfield, Sporewood, Mire, Moor) */
        const bl = TH.blocker || { trunkH: 1, trunkR: 1, canopyS: 1, canopyY: 0.42 };
        const hh = (1.9 + cellRng.f(-0.45, 0.75)) * (bl.trunkH ?? 1);
        const tr = bl.trunkR ?? 1;
        const jx = cellRng.f(-0.24, 0.24), jz = cellRng.f(-0.24, 0.24);
        wcol.set(TH.wall).multiplyScalar(cellRng.f(0.82, 1.12));
        ws.add(wx(x) + jx, treeY, wz(y) + jz, cellRng.f(0.8, 1.2) * tr, hh, cellRng.f(0.8, 1.2) * tr, cellRng.f(0, 6.28), wcol.getHex(), dl);
        const cS = bl.canopyS ?? 1;
        wcol.set(TH.cap).lerp(tint.set(TH.canopyTint ?? 0x8fbf5e), cellRng.f(0, 0.4)).multiplyScalar(cellRng.f(0.82, 1.15));
        cs.add(wx(x) + jx, treeY + hh * (bl.canopyY ?? 0.42), wz(y) + jz,
          cellRng.f(0.95, 1.35) * cS, cellRng.f(0.95, 1.3) * cS, cellRng.f(0.95, 1.35) * cS,
          cellRng.f(0, 6.28), wcol.getHex(), dl + 0.12);
        recordPerch(x, y, wx(x) + jx, wz(y) + jz, treeY + hh * (bl.canopyY ?? 0.42), -1);
      }
    }
    if (blockGeo) {
      meshes.wall = buildMesh(ws, GEO.wall, matWall, 'rise', 0.42, 1);
      setAtlasAttr(GEO.wall, wUv, ws.n);
      meshes.wallCap = buildMesh(cs, GEO.wallCap, matWallCap, 'pop', 0.3, 1);
      setAtlasAttr(GEO.wallCap, cUv, cs.n);
    } else if (treeMeshes.length > 0 && treeMeshes.some(tm => tm.set.n > 0)) {
      let meshIdx = 0;
      treeMeshes.forEach(tm => {
        if (tm.set.n > 0) {
          const m = buildMesh(tm.set, tm.geo, tm.mesh.material, 'rise', 0.42, 1);
          m.userData.isOverlandTree = true;
          m.userData.overlandCullable = true;
          if (meshIdx === 0) meshes.wall = m;
          else meshes[`wall_tree_${meshIdx}`] = m;
          /* Bare models get their leaf cards here: same instance transforms as
             the trunks, with a little per-tree colour variation. */
          const fol = tm.key && FOLIAGE[tm.key];
          if (fol) {
            const leafSet = Object.assign({}, tm.set, {
              col: tm.set.col.map((_, i) => {
                const h = Math.sin(tm.set.px[i] * 12.99 + tm.set.pz[i] * 78.23) * 43758.55;
                return _c.setRGB(1, 1, 1).multiplyScalar(0.74 + 0.22 * (h - Math.floor(h))).getHex();
              })
            });
            const lm = buildMesh(leafSet, foliageGeometryFor(tm), foliageMaterial(fol), 'rise', 0.42, 1);
            lm.userData.isOverlandTree = true;
            lm.userData.overlandCullable = true;
            meshes[`leaves_${meshIdx}`] = lm;
          }
          meshIdx++;
        }
      });
      /* A camp palisade (holdfast) still goes into ws/cs on a tree-walled map;
         draw it as timber, or it silently vanishes. */
      if (ws.n) meshes.palisade = buildMesh(ws, GEO.treeTrunk, matBark, 'rise', 0.42, 1);
      if (cs.n) meshes.palisadeCap = buildMesh(cs, GEO.treeTrunk, matBark, 'pop', 0.3, 1);
    } else {
      meshes.wall = buildMesh(ws, GEO.treeTrunk, matBark, 'rise', 0.42, 1);
      meshes.wallCap = buildMesh(cs, GEO.treeCanopy, matLeaf, 'pop', 0.3, 1);
    }
  } else {
    const isVerdant = TH.label === 'VERDANT' || d.params?.themeKey === 'verdant' || d.themeKey === 'verdant' || d.params?.themeKey === 'forest' || d.params?.themeKey === 'sporewood';
    const isAncient = TH.label === 'ANCIENT' || d.params?.themeKey === 'ancient' || d.themeKey === 'ancient';
    const isFrost = TH.label === 'FROST' || d.params?.themeKey === 'frost' || d.themeKey === 'frost' || TH.label === 'SNOWFIELD';
    const isGrim = TH.label === 'GRIM' || d.params?.themeKey === 'grim' || d.themeKey === 'grim';

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (grid[idx(x, y)] !== WALL) continue;
      const h = 2.0 + cellRng.f(-0.25, 0.25);
      const dl = nearFloorBfs(x, y) * dStep + 0.30;
      wcol.set(TH.wall).multiplyScalar(cellRng.f(0.9, 1.08));
      ws.add(wx(x), wallBase, wz(y), 1, h - wallBase, 1, 0, wcol.getHex(), dl);
      pushVar(wUv, cellRng);
      wcol.set(TH.cap).multiplyScalar(cellRng.f(0.92, 1.1));
      cs.add(wx(x), h, wz(y), 1, 1, 1, cellRng.i(0, 3) * (Math.PI / 2), wcol.getHex(), dl + 0.12);
      pushVar(cUv, cellRng);

      /* Vertical Wall Face Dressing (HD-2D creeping ivy, lichen, hanging icicles/chains) */
      const dirs = [
        { nx: x + 1, ny: y, ox: 0.505, oz: 0, rot: Math.PI / 2 },
        { nx: x - 1, ny: y, ox: -0.505, oz: 0, rot: -Math.PI / 2 },
        { nx: x, ny: y + 1, ox: 0, oz: 0.505, rot: 0 },
        { nx: x, ny: y - 1, ox: 0, oz: -0.505, rot: Math.PI }
      ];

      for (const dir of dirs) {
        if (dir.nx < 0 || dir.nx >= W || dir.ny < 0 || dir.ny >= H) continue;
        const nc = idx(dir.nx, dir.ny);
        const nTile = grid[nc];
        if (nTile === FLOOR || nTile === POOL) {
          const nRid = roomId[nc];
          const nFloorY = surfY(nc);
          const wxWall = wx(x) + dir.ox;
          const wzWall = wz(y) + dir.oz;

          if (isVerdant && cellRng.chance(0.38)) {
            const ivyScaleX = cellRng.f(0.85, 1.15) * (cellRng.chance(0.5) ? 1 : -1);
            const ivyScaleY = cellRng.f(0.85, 1.25);
            const ivyCol = lerpC(0x4a7c36, 0x82b84d, cellRng.raw());
            S.wallIvy.add(wxWall, nFloorY, wzWall, ivyScaleX, ivyScaleY, 1, dir.rot, ivyCol, dl + 0.15, nRid);
          } else if (isAncient && cellRng.chance(0.22)) {
            const ivyScaleX = cellRng.f(0.75, 1.05) * (cellRng.chance(0.5) ? 1 : -1);
            const ivyScaleY = cellRng.f(0.70, 1.10);
            const lichenCol = lerpC(0x5c7250, 0x8fa372, cellRng.raw());
            S.wallIvy.add(wxWall, nFloorY, wzWall, ivyScaleX, ivyScaleY, 1, dir.rot, lichenCol, dl + 0.15, nRid);
          } else if (isFrost && cellRng.chance(0.26)) {
            S.icicle.add(wxWall, nFloorY + h - 0.15, wzWall, cellRng.f(0.8, 1.2), cellRng.f(0.8, 1.3), cellRng.f(0.8, 1.2), dir.rot, 0xd0e8ff, dl + 0.15, nRid);
          } else if (isGrim && cellRng.chance(0.16)) {
            /* GEO.hangingChains is built up from the floor (its bracket sits
               at 1.73), unlike the icicles, which hang down from their origin.
               Stand it on the neighbouring floor, and shorten it so the
               bracket stays under this wall's top (y = h). */
            const chainSy = Math.max(0.5, Math.min(cellRng.f(0.9, 1.2), (h - 0.12 - nFloorY) / 1.73));
            S.hangingChains.add(wxWall, nFloorY, wzWall, 0.9, chainSy, 0.9, dir.rot, 0x3a3d42, dl + 0.15, nRid);
          }
        }
      }
    }
    meshes.wall = buildMesh(ws, GEO.wall, matWall, 'rise', 0.42, 1);
    setAtlasAttr(GEO.wall, wUv, ws.n);
    meshes.wallCap = buildMesh(cs, GEO.wallCap, matWallCap, 'pop', 0.3, 1);
    setAtlasAttr(GEO.wallCap, cUv, cs.n);
  }

  /* The bone scatter drawn with the real models once they're loaded. The
     variant comes from a hash of the cell, not cellRng, so the rest of the
     map's dressing doesn't reshuffle. A skeleton with a wall beside it sits
     slumped against that wall; one in the open lies on the floor.
     'placed' drew the model into `into`. 'pending' means the GLB is still
     loading — the caller must not bake the procedural stand-in, or it stays
     on screen after the model arrives. 'fallback' means there is no model. */
  const boneSets = {};
  const modelPropSets = {};
  const latePending = [];
  const boneLate = [];
  const boneModel = (p, rx, ry, X, PY, Z, room, dl, into = boneSets) => {
    const h = ((rx * 73856093) ^ (ry * 19349663)) >>> 0;
    let key = null, rot = p.rot || 0, ox = 0, oz = 0;
    if (p.kind === 'skull') key = 'boneSkull';
    else if (p.kind === 'bones' || p.kind === 'bonePile') key = (h & 1) ? 'bonesScatter' : 'skeletonLieB';
    else if (p.kind === 'skeleton') {
      key = 'skeletonLieA';
      const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      for (let k = 0; k < 4; k++) {
        const [wdx, wdy] = dirs[(h + k) % 4];
        const nx = rx + wdx, ny = ry + wdy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || grid[idx(nx, ny)] !== WALL) continue;
        /* back to the wall: rotation.y = θ turns local +X to world
           (cos θ, -sin θ), and grid +y is world +z */
        key = (h & 2) ? 'skeletonSitA' : 'skeletonSitB';
        rot = key === 'skeletonSitA' ? Math.atan2(-wdy, wdx) : Math.atan2(wdy, -wdx);
        const back = key === 'skeletonSitA' ? 0.27 : 0.2;
        ox = wdx * back; oz = wdy * back;
        break;
      }
    }
    if (!key || !propAssets[key]) return (key && propLoading[key] && !propSettled[key]) ? 'pending' : 'fallback';
    /* p.scale (0.85-1.25) was sized for the procedural stick bones; on a
       real model the top of that range sprawls a body across two tiles, so
       only a little of it is kept (0.92-1.08) */
    const s = (1 + ((p.scale || 1.05) - 1.05) * 0.4) * (PROP_SCALE_MULTIPLIER[key] || 1);
    (into[key] ||= instSet()).add(X + ox, PY + (propBaseOffset[key] || 0) * s, Z + oz, s, s, s, rot, 0xffffff, dl, room);
    return 'placed';
  };
  /* Niche skulls sit on the slot floor (the old sphere's bottom) and face out
     of the wall. The model's face is local +X, so -π/2 turns it to the frame's
     +Z. Beds are the loose bones under them; `beds` is null when the caller
     draws those itself. */
  const placeOssuarySkulls = (frame, into, beds) => {
    const { ox, oz, os, ry, PY, dl, propRoom, rx, py } = frame;
    if (beds) beds.add(ox, PY, oz, os, os, os, ry, 0xfff8ee, dl + 0.04, propRoom);
    const sk = PROP_SCALE_MULTIPLIER.ossuarySkull * os, cr = Math.cos(ry), sr = Math.sin(ry);
    OSSUARY_SKULL_SLOTS.forEach(([lx, ly, r], i) => {
      const h = ((rx * 73856093) ^ (Math.round(py) * 19349663) ^ (i * 83492791)) >>> 0;
      const s = sk * (r / 0.095), bx = lx * os;
      (into.boneSkull ||= instSet()).add(
        ox + bx * cr, PY + (ly - r) * os + (propBaseOffset.boneSkull || 0) * s, oz - bx * sr,
        s, s, s, ry - Math.PI / 2 + ((h % 61) / 60 - 0.5) * 0.5, 0xffffff, dl + 0.04, propRoom);
    });
  };

  for (const p of d.props) {
    const rx = Math.max(0, Math.min(W - 1, Math.round(p.x)));
    const ry = Math.max(0, Math.min(H - 1, Math.round(p.y)));
    const X = wx(p.x), Z = wz(p.y), dl = pd(rx, ry);
    /* Props take their Y from the tile they stand on, so anything on a dais
       or down in a sunken pit rides with the terrain for free. */
    const PY = surfY(idx(rx, ry));
    const rdx = Math.max(0, Math.min(W - 1, Math.round(p.x + (p.dx || 0))));
    const rdy = Math.max(0, Math.min(H - 1, Math.round(p.y + (p.dy || 0))));
    const propRoom = p.roomId !== undefined ? p.roomId : d.roomId[idx(rdx, rdy)];
    switch (p.kind) {
      case 'pillar': {
        const s = p.scale * 1.15;
        S.pillar.add(X, PY, Z, s, s, s, cellRng.i(0, 3) * Math.PI / 2, TH.pillar, dl, propRoom); break;
      }
      case 'debris': {
        const set = [S.debrisA, S.debrisB, S.debrisC][p.v || 0];
        set.add(X, PY, Z, p.scale, p.scale * 0.85, p.scale, p.rot, lerpC(TH.debris[0], TH.debris[1], cellRng.raw()), dl, propRoom); break;
      }
      case 'cornerRubble': {
        const v = Math.abs(p.v || 0) % 4;
        const set = (v === 0 ? S.cornerRubbleA : (v === 1 ? S.cornerRubbleB : (v === 2 ? S.cornerRubbleC : S.cornerRubbleD)));
        const uvArr = (v === 0 ? rubbleAUv : (v === 1 ? rubbleBUv : (v === 2 ? rubbleCUv : rubbleDUv)));
        const s = p.scale || 1.0;
        const cTone = lerpC(TH.wall || 0x424a58, (TH.debris ? TH.debris[1] : 0x504438), cellRng.f(0.2, 0.7));
        set.add(X, PY, Z, s, s, s, p.rot || 0, cTone, dl, propRoom);
        pushVar(uvArr, cellRng);
        break;
      }
      case 'fallenBrick': {
        const s = p.scale || 1.0;
        const cTone = lerpC(TH.wall || 0x424a58, (TH.debris ? TH.debris[1] : 0x504438), cellRng.f(0.2, 0.7));
        S.fallenBrick.add(X, PY, Z, s, s, s, p.rot || 0, cTone, dl, propRoom);
        pushVar(brickUv, cellRng);
        break;
      }
      case 'mushroomLog': case 'rocks': case 'stump': case 'vinemound':
      case 'cairn': case 'stakes': case 'rack': case 'goblinfire': case 'skulltotem':
      case 'vase': case 'coffin': case 'pillarA': case 'pillarB':
      case 'lectern': case 'grainjars': case 'scrollshelf':
      case 'cage': case 'cage2': case 'throne':
      case 'tombstone': case 'anvil': case 'icebone': case 'weepingAngel':
      case 'apothecaryShelf': case 'funeralBell': case 'graveFence':
      case 'fren1': case 'fren2': case 'fren3': case 'fren4':
      case 'mushroomA': case 'mushroomB': case 'rootsA': case 'rootsB':
      case 'bush': case 'signpost': case 'brokenSignpost': case 'wheel':
      /* any key registered through registerProp() (custom_props.json or the
         dungeon editor's model import) lands here too */
      default: {
        /* a model still loading: remembered, and placed by the late pass
           below once it arrives */
        if (!propAssets[p.kind]) { if (propLoading[p.kind]) latePending.push({ p, X, PY, Z, propRoom, dl }); break; }
        placeModelProp(p, X, PY, Z, propRoom, cellRng, dl, modelPropSets);
        break;
      }
      case 'chest': {
        if (propAssets['chest']) {
          const inst = propAssets['chest'].clone(true);
          const s = (p.scale || 1) * (PROP_SCALE_MULTIPLIER['chest'] || 1);
          inst.scale.setScalar(s);
          inst.rotation.y = p.rot || 0;
          inst.position.set(X, PY + ((propBaseOffset['chest'] || 0) * s + (p.oy || 0)), Z);
          inst.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
          group.add(inst);
          if (propRoom >= 0) standaloneRooms.push({ mesh: inst, rid: propRoom });
          chestInstances.push({ mesh: inst, x: X, z: Z, opened: false });
          break;
        }
        S.chest.add(X, PY, Z, 1, 1, 1, p.rot, 0x8a5a2c, dl, propRoom);
        S.chestTrim.add(X, PY, Z, 1, 1, 1, p.rot, 0xc8a24a, dl, propRoom);
        S.chestGlow.add(X, PY, Z, 1, 1, 1, p.rot, 0xffd27a, dl + 0.15, propRoom);
        break;
      }
      case 'shrineCrystal': {
        /* A Light Shrine (docs/LIGHT_IDEAS.md 47) is a stone sun shrine with a
           steady pale-gold glow rather than a campfire. It is still the rest
           spot, so the light keeps isCampfire and goes out when the party
           camps here — the blessing has passed to them. */
        if (p.lightShrine && propAssets.sunShrine) {
          const inst = propAssets.sunShrine.clone(true);
          const s = (p.scale || 1) * (PROP_SCALE_MULTIPLIER.sunShrine || 1);
          inst.scale.setScalar(s);
          inst.rotation.y = p.rot || 0;
          inst.position.set(X, PY + (propBaseOffset.sunShrine || 0) * s, Z);
          inst.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
          group.add(inst);
          if (propRoom >= 0) standaloneRooms.push({ mesh: inst, rid: propRoom });
          const sunLight = new THREE.PointLight(0xffe6b8, 2.2 * LIGHT_K, 12, 1.8);
          sunLight.position.set(X, PY + 1.25, Z);
          sunLight.userData = { base: 2.2, ph: cellRng.f(0, 6.28), ramp: 1, fogMult: 1, isCampfire: true, calm: true, roomId: propRoom };
          group.add(sunLight);
          lights.push(sunLight);
          if (propRoom >= 0) roomLights.push({ light: sunLight, rid: propRoom });
          break;
        }
        const stoneCol = lerpC(TH.pillar || 0x6e6860, 0x3a3430, 0.35);
        const logCol = 0x5a3e28;
        S.campfireStones.add(X, PY, Z, 1, 1, 1, p.rot, stoneCol, dl, propRoom);
        S.campfireLogs.add(X, PY, Z, 1, 1, 1, p.rot, logCol, dl + 0.1, propRoom);
        S.campfireCoals.add(X, PY, Z, 1, 1, 1, p.rot, 0xff4210, dl + 0.15, propRoom);
        S.campfireFlames.add(X, PY, Z, 1, 1, 1, p.rot, 0xff7a20, dl + 0.2, propRoom);
        S.campfireFlameCore.add(X, PY, Z, 1, 1, 1, p.rot, 0xffdf78, dl + 0.25, propRoom);

        const campLight = new THREE.PointLight(0xff7a26, 2.6 * LIGHT_K, 12, 1.8);
        campLight.position.set(X, PY + (0.35), Z);
        campLight.userData = { base: 2.6, ph: cellRng.f(0, 6.28), ramp: 1, fogMult: 1, isCampfire: true, roomId: propRoom };
        group.add(campLight);
        lights.push(campLight);
        if (propRoom >= 0) roomLights.push({ light: campLight, rid: propRoom });
        registerPersistentNixieEffect('campfire_embers', { x: X, y: 0.35, z: Z }, { roomId: propRoom });
        break;
      }
      case 'ring':
        S.platform.add(X, PY + (-0.02), Z, 1, 1, 1, 0, lerpC(TH.floor, 0xffffff, 0.1), dl, propRoom);
        S.ring.add(X, PY + (0.012), Z, 1, 1, 1, 0, 0x3fd0bb, dl + 0.1, propRoom);
        S.pillar.add(X - 1.45, PY + (0.1), Z, 0.72, 0.72, 0.72, 0, TH.pillar, dl + 0.15, propRoom);
        S.pillar.add(X + 1.45, PY + (0.1), Z, 0.72, 0.72, 0.72, 0, TH.pillar, dl + 0.15, propRoom);
        portalXZ = [X, Z];
        break;
      case 'bossCrystal': {
        S.bossGlow.add(X, PY, Z, 1.15, 1.15, 1.15, p.rot, 0xff4636, dl, propRoom);
        S.bossGlow.add(X + 0.55, PY + (0), Z - 0.42, 0.6, 0.75, 0.6, p.rot + 1.2, 0xff6a45, dl + 0.12, propRoom);
        S.bossRock.addT(X - 0.62, PY + (0), Z + 0.42, 0.75, 0.8, 0.75, 0.05, p.rot + 2.1, -0.06, 0x4a3336, dl + 0.15, propRoom);
        S.bossRock.addT(X + 0.75, PY + (0), Z + 0.55, 0.55, 0.6, 0.55, -0.06, p.rot + 3.6, 0.05, 0x51383a, dl + 0.2, propRoom);
        break;
      }
      case 'sepulcherDais':
        S.sepulcherDais.add(X, PY + (-0.02), Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, lerpC(TH.floor, 0x222a22, 0.35), dl, propRoom);
        break;
      case 'grave':
        S.grave.add(X, PY, Z, p.scale, p.scale, p.scale, p.rot, lerpC(TH.pillar, 0x4a3b32, cellRng.raw()), dl, propRoom);
        break;
      case 'sarco':
        S.sarco.add(X, PY, Z, p.scale, p.scale, p.scale, p.rot, lerpC(TH.pillar, 0x3a3028, cellRng.raw()), dl, propRoom);
        break;
      case 'candle': {
        const cY = (p.oy || 0);
        S.candle.add(X, PY + (cY), Z, p.scale, p.scale, p.scale, p.rot, 0xd8cba8, dl, propRoom);
        S.flameCore.add(X, PY + (cY + 0.28 * p.scale), Z, 0.6 * p.scale, 0.6 * p.scale, 0.6 * p.scale, 0, 0xffdf78, dl + 0.05, propRoom);
        break;
      }
      case 'icicle':
        /* oy lets overland hang them off shorter blockers than a dungeon wall. */
        S.icicle.addT(X, PY + (1.9 + (p.oy || 0)), Z, p.scale, p.scale, p.scale,
          cellRng.f(-0.1, 0.1), p.rot, cellRng.f(-0.1, 0.1),
          0xbfe2ff, dl, propRoom);
        break;
      case 'shardIce':
        /* ox/oz spread the members of a cluster around inside their shared cell. */
        S.shardIce.addT(X + (p.ox || 0), PY + (-0.1), Z + (p.oz || 0), p.scale, p.scale, p.scale,
          cellRng.f(-0.2, 0.2), p.rot, cellRng.f(-0.2, 0.2),
          0xcfeaff, dl, propRoom);
        break;
      case 'roots':
        S.roots.add(wx(p.x), PY + (0), wz(p.y), p.scale, p.scale, p.scale, Math.atan2(p.dx, p.dy),
          0x5a4632, nearFloorBfs(p.x, p.y) * dStep + 0.6, propRoom);
        break;
      case 'crack': {
        const cx = X - (p.dx || 0) * 0.5, cz = Z - (p.dy || 0) * 0.5;
        const vc = p.ice ? 0x9fd8ff : (TH.pools && TH.pools.mode === 3 ? 0x86c05a : 0xff6a28);
        S.crackD.add(cx, PY + (0), cz, p.scale, p.scale, p.scale, p.rot, vc, dl, propRoom);
        break;
      }
      case 'bones':
      case 'skull':
      case 'skeleton':
      case 'bonePile': {
        const boneState = boneModel(p, rx, ry, X, PY, Z, propRoom, dl);
        if (boneState === 'pending') boneLate.push({ p, rx, ry, X, PY, Z, propRoom, dl });
        else if (boneState !== 'placed') {
          const standIn = p.kind === 'skull' ? S.skull : (p.kind === 'skeleton' ? S.skeleton : (p.kind === 'bonePile' ? S.bonePile : S.bone));
          const standCol = p.kind === 'skull' ? 0xdfd8c4 : (p.kind === 'skeleton' ? 0xd0c8b0 : 0xcfc4a4);
          standIn.add(X, PY, Z, p.scale, p.scale, p.scale, p.rot, standCol, dl, propRoom);
        }
        break;
      }
      case 'spiderWeb': {
        /* p.x/p.y is the floor cell at an inside corner and p.dx/p.dy point at the
           two walls meeting there, so the hub goes on the corner post between them.
           The fan spans +x..+z from its own origin; rotating its bisector to face
           back into the room lands its two straight edges along the two walls. */
        const wdx = p.dx || 0, wdy = p.dy || 0;
        S.spiderWeb.add(X + wdx * 0.5, PY + (0), Z + wdy * 0.5, p.scale, p.scale, p.scale,
          Math.atan2(-wdx, -wdy) - Math.PI / 4, 0xe8e8e8, dl, propRoom);
        break;
      }
      case 'banner': {
        const ry = Math.atan2(p.dx, p.dy);
        const bx = wx(p.x) + p.dx * 0.54, bz = wz(p.y) + p.dy * 0.54;
        const bdl = nearFloorBfs(p.x, p.y) * dStep + 0.7;
        S.bannerRod.add(bx, PY + (1.98), bz, 1, 1, 1, ry, 0x6a5a3a, bdl, propRoom);
        S.bannerCloth.add(bx + p.dx * 0.03, PY + (1.96), bz + p.dy * 0.03, 1, 1, 1, ry, TH.cloth, bdl + 0.05, propRoom);
        S.emblem.add(bx + p.dx * 0.06, PY + (1.6), bz + p.dy * 0.06, 1, 1, 1, ry, accC, bdl + 0.1, propRoom);
        break;
      }
      case 'barrel': {
        if (propAssets['barrel']) {
          placeModelProp({ kind: 'barrel', scale: p.scale || 1, rot: p.rot || 0, oy: p.oy || 0 }, X, PY, Z, propRoom, cellRng, dl, modelPropSets);
          break;
        }
        S.barrel.add(X, PY, Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, lerpC(0x8a5a2c, 0x5a3a1c, cellRng.raw()), dl, propRoom);
        break;
      }
      case 'crate': {
        if (propAssets['crate']) {
          placeModelProp({ kind: 'crate', scale: p.scale || 1, rot: p.rot || 0, oy: p.oy || 0 }, X, PY, Z, propRoom, cellRng, dl, modelPropSets);
          break;
        }
        S.crate.add(X, PY, Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, lerpC(0x7a4e28, 0x9a6e38, cellRng.raw()), dl, propRoom);
        break;
      }
      case 'table':
        S.table.add(X, PY, Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0x7a4e28, dl, propRoom);
        break;
      case 'bench':
        S.bench.add(X, PY, Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0x6b4220, dl, propRoom);
        break;
      case 'chair':
        S.chair.add(X, PY, Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0x6b4220, dl, propRoom);
        break;
      case 'bookshelf': {
        /* stood on a wall tile facing the room (wall behind local -Z): slide
           it back until its back panel meets the wall face, or it stands a
           third of a tile out and reads as floating */
        const s = p.scale || 1, ry = p.rot || 0;
        const back = Math.max(0, 0.49 - BOOKSHELF_BACK * s);
        const bx = X - Math.sin(ry) * back, bz = Z - Math.cos(ry) * back;
        S.bookshelf.add(bx, PY, bz, s, s, s, ry, 0x5a3214, dl, propRoom);
        S.bookshelfBooks.add(bx, PY, bz, s, s, s, ry, lerpC(0x5a2018, 0x2e3a24, cellRng.raw()), dl + 0.04, propRoom);
        break;
      }
      case 'weaponRack': {
        if (propAssets['weaponRack']) {
          placeModelProp({ kind: 'weaponRack', scale: p.scale || 1, rot: p.rot || 0, oy: p.oy || 0 }, X, PY, Z, propRoom, cellRng, dl, modelPropSets);
          break;
        }
        S.weaponRack.add(X, PY, Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0x6b4a2f, dl, propRoom);
        break;
      }
      case 'statue':
        S.statue.add(X, PY, Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, lerpC(TH.pillar, 0xffffff, 0.15), dl, propRoom);
        break;
      case 'urn':
        S.urn.add(X, PY, Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, lerpC(0x9e6a45, 0x6a452e, cellRng.raw()), dl, propRoom);
        break;
      case 'rug':
        S.rug.add(X, PY, Z, p.scale || 1, 1, p.scale || 1, p.rot || 0, 0xd4af37, dl, propRoom);
        break;
      case 'magicCircle':
        S.magicCircle.add(X, PY, Z, p.scale || 1, 1, p.scale || 1, p.rot || 0, TH.accent ? parseInt(TH.accent.slice(1), 16) : 0x3fd0bb, dl, propRoom);
        break;
      case 'tapestry': {
        /* not `p.dy||1`: on an east/west wall dy is 0, which that turned into
           1 and hung the banner at 45 degrees to the wall */
        const ry = (p.dx || p.dy) ? Math.atan2(p.dx || 0, p.dy || 0) : 0;
        S.tapestry.add(wx(p.x) + (p.dx || 0) * 0.48, PY + (0), wz(p.y) + (p.dy || 0) * 0.48, 1, 1, 1, ry, TH.cloth, dl, propRoom);
        break;
      }
      case 'sconce': {
        const ry = (p.dx || p.dy) ? Math.atan2(p.dx || 0, p.dy || 0) : 0;   // see tapestry
        const sx = wx(p.x) + (p.dx || 0) * 0.48, sz = wz(p.y) + (p.dy || 0) * 0.48;
        S.sconce.add(sx, PY + (0), sz, 1, 1, 1, ry, 0x8a7248, dl, propRoom);
        S.flame.add(sx + (p.dx || 0) * 0.12, PY + (1.06), sz + (p.dy || 0) * 0.12, 0.8, 0.8, 0.8, 0, TH.flame, dl + 0.05, propRoom);
        S.flameCore.add(sx + (p.dx || 0) * 0.12, PY + (1.08), sz + (p.dy || 0) * 0.12, 0.8, 0.8, 0.8, 0, TH.flameCore, dl + 0.05, propRoom);
        break;
      }
      case 'forge': {
        const fY = p.oy || 0;
        if (propAssets.forge) {
          placeModelProp({ kind: 'forge', scale: p.scale || 1, rot: p.rot || 0, oy: fY }, X, PY, Z, propRoom, cellRng, dl, modelPropSets);
          break;
        }
        S.forge.add(X, PY + (fY), Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0x4a4540, dl, propRoom);
        S.coals.add(X, PY + (fY + 0.55 * (p.scale || 1)), Z, 0.8 * (p.scale || 1), 0.8 * (p.scale || 1), 0.8 * (p.scale || 1), 0, 0xff5a1f, dl + 0.1, propRoom);
        S.flame.add(X, PY + (fY + 0.65 * (p.scale || 1)), Z, 0.9 * (p.scale || 1), 0.9 * (p.scale || 1), 0.9 * (p.scale || 1), 0, TH.flame, dl + 0.12, propRoom);
        break;
      }
      case 'cauldron':
        S.cauldron.add(X, PY + (p.oy || 0), Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0x2a2826, dl, propRoom);
        break;
      case 'ossuaryWall': {
        // Enforce pure cardinal wall normal facing into the room
        let dx = p.dx || 0, dy = p.dy || 0;
        if (Math.abs(dx) >= Math.abs(dy)) { dx = dx >= 0 ? 1 : -1; dy = 0; }
        else { dy = dy > 0 ? 1 : -1; dx = 0; }
        const ry = Math.atan2(-dx, -dy);
        const ox = wx(p.x) + dx * 0.48, oz = wz(p.y) + dy * 0.48;
        const os = p.scale || 1;
        S.ossuaryFrame.add(ox, PY + (0), oz, os, os, os, ry, TH.wall, dl, propRoom);
        const ossuaryAt = { ox, oz, os, ry, PY, dl, propRoom, rx, py: p.y };
        if (!propAssets.boneSkull) {
          if (propLoading.boneSkull && !propSettled.boneSkull) boneLate.push({ ossuary: ossuaryAt });
          else S.ossuaryBones.add(ox, PY + (0), oz, os, os, os, ry, 0xfff8ee, dl + 0.04, propRoom);
          break;
        }
        placeOssuarySkulls(ossuaryAt, boneSets, S.ossuaryBeds);
        break;
      }
      case 'sporePod':
        S.sporePod.add(X, PY, Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0x59d68f, dl, propRoom);
        break;
      case 'megalith':
        S.megalith.add(X, PY, Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, lerpC(TH.wall, 0x8a929a, cellRng.raw()), dl, propRoom);
        break;
      case 'wagon':
        S.wagon.add(X, PY, Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0x6b4a2f, dl, propRoom);
        break;
      case 'altarTable': {
        /* A `podium` altar is not standing ON its cells, it IS them: the
           elevation pass raised the tile it covers by one STEP so the party can
           climb onto it. Drawn at its own height it would then be a block you
           stand inside. So sink it a full step and squash it to exactly STEP
           tall (GEO.altarTable is 0.65 high, base at y=0) — its top face lands
           flush with the tier surface and the slab becomes the floor you walk
           on, with the tier's own skirt reading as its plinth. */
        const as = p.scale || 1;
        const podium = !!p.podium;
        S.altarTable.add(X, PY - (podium ? ELEV_STEP : 0), Z,
          as, podium ? ELEV_STEP / 0.65 : as, as,
          p.rot || 0, lerpC(TH.wall, 0x4a3b32, 0.3), dl, propRoom);
        break;
      }
      case 'iceThrone':
        S.iceThrone.add(X, PY, Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0xbfe2ff, dl, propRoom);
        break;
      case 'globe':
        S.globe.add(X, PY, Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0xc8a24a, dl, propRoom);
        break;
      case 'stalagmite':
        S.stalagmite.add(X, PY, Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, lerpC(TH.wall, 0x22242b, 0.4), dl, propRoom);
        break;
      case 'boulderPile':
        S.boulderPile.add(X, PY, Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, lerpC(TH.debris[0], TH.debris[1], cellRng.raw()), dl, propRoom);
        break;
      case 'forgeChains':
        S.forgeChains.add(X, PY, Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0x3d4148, dl, propRoom);
        break;
      case 'hangingChains': {
        let dx = p.dx || 0, dy = p.dy || 0;
        if (Math.abs(dx) >= Math.abs(dy)) { dx = dx >= 0 ? 1 : -1; dy = 0; }
        else { dy = dy > 0 ? 1 : -1; dx = 0; }
        const ry = Math.atan2(-dx, -dy);
        const hx = wx(p.x) + dx * 0.48, hz = wz(p.y) + dy * 0.48;
        S.hangingChains.add(hx, PY + (p.oy || 0), hz, p.scale || 1, p.scale || 1, p.scale || 1, ry, 0x3a3d44, dl, propRoom);
        break;
      }
      case 'magmaBridge':
        S.magmaBridge.add(X, PY + (p.oy || 0), Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0x484c56, dl, propRoom);
        break;
      case 'woodBridge':
        S.woodBridge.add(X, PY + (p.oy || 0), Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0x7a5a38, dl, propRoom);
        break;
      case 'bridgeRailing':
      case 'woodRailing': {
        /* Placed per bridge EDGE rather than baked into the deck tile, so a
           3-wide crossing is railed at its two outer rows and open down the
           middle. ox/oz pick the side; the deck's top face is at 0.14. */
        const rs = p.scale || 1;
        /* Sit the railing ON the deck. The two decks are not the same height —
           the iron span's top face is at 0.20, the timber one's at 0.175 —
           and a single hardcoded 0.14 left both of them floating. */
        const deckTop = p.kind === 'woodRailing' ? 0.175 : 0.20;
        S[p.kind].add(X + (p.ox || 0), PY + deckTop + (p.oy || 0), Z + (p.oz || 0),
          rs, rs, rs, p.rot || 0,
          p.kind === 'woodRailing' ? 0x6b4d30 : 0x4a4038, dl, propRoom);
        break;
      }
      case 'magmaBridgeApproach':
        S.magmaBridgeApproach.add(X, PY + (p.oy || 0), Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0x5a544c, dl, propRoom);
        break;
      case 'swampgrass': case 'swampgrass2': case 'swampgrass3': {
        const sgY = p.oy || 0;
        const grassBase = (TH.cap || TH.floor || 0x4e582c);
        const wallTone = (TH.wall || 0x3e4a32);
        /* dead grass carries its own straw texture; the tint only varies it */
        const col = TH.deadGrass
          ? _c.set(0xd8d0c0).lerp(new THREE.Color(0xa89c88), cellRng.f(0, 1)).getHex()
          : _c.set(grassBase).lerp(new THREE.Color(wallTone), cellRng.f(0.15, 0.45)).multiplyScalar(cellRng.f(1.02, 1.22)).getHex();
        S[p.kind].add(X, PY + sgY, Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, col, dl, propRoom);
        break;
      }
      case 'ingotStack': {
        const iY = p.oy || 0;
        S.ingotStack.add(X, PY + (iY), Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0x5a5f6b, dl, propRoom);
        break;
      }
      case 'goldBullion': {
        const gbY = p.oy || 0;
        S.goldBullion.add(X, PY + (gbY), Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0xffd24d, dl + 0.12, propRoom);
        break;
      }
      case 'smeltingCrucible': {
        const scY = p.oy || 0;
        S.smeltingCrucible.add(X, PY + (scY), Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0x2a2826, dl, propRoom);
        S.crucibleLiquid.add(X, PY + (scY), Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0xff7a20, dl + 0.15, propRoom);
        break;
      }
      case 'mammothTusks':
        S.mammothTusks.add(X, PY + (p.oy || 0), Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0xf0ebe1, dl, propRoom);
        break;
      case 'runicObelisk': {
        const obY = p.oy || 0;
        S.runicObelisk.add(X, PY + (obY), Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0x4e5866, dl, propRoom);
        S.runicObeliskGlow.add(X, PY + (obY), Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0x38bdf8, dl + 0.25, propRoom);
        break;
      }
      case 'shieldRack':
        S.shieldRack.add(X, PY + (p.oy || 0), Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0x5a4432, dl, propRoom);
        break;
      case 'hearthPit':
        S.hearthPit.add(X, PY + (p.oy || 0), Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0x3d3835, dl, propRoom);
        S.flame.add(X, PY + ((p.oy || 0) + 0.25), Z, (p.scale || 1) * 0.9, (p.scale || 1) * 0.9, (p.scale || 1) * 0.9, 0, 0x38bdf8, dl + 0.1, propRoom);
        break;
      case 'boneTotem':
        S.boneTotem.add(X, PY + (p.oy || 0), Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0x9a8e80, dl, propRoom);
        break;
      case 'glacialSpire':
        S.glacialSpire.add(X, PY + (p.oy || 0), Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, 0x7de6ff, dl + 0.1, propRoom);
        break;
    }
  }

  for (const t of d.torches) {
    const ry = Math.atan2(t.dx, t.dy);
    const X = wx(t.x) + t.dx * 0.5, Z = wz(t.y) + t.dy * 0.5, dl = nearFloorBfs(t.x, t.y) * dStep + 0.66;
    const tc = idx(t.x + t.dx, t.y + t.dy);
    const trid = d.roomId[tc] >= 0 ? d.roomId[tc] : -2 - tc;
    /* A torch is mounted relative to the floor it lights, not to the base
       plane — `tc` is that floor cell. Left at 0 the sconce ends up at knee
       height beside a raised tier, or overhead beside a sunken one. */
    const tY = surfY(tc);
    S.torchArm.add(X, tY + 1.02, Z, 1, 1, 1, ry, 0x4a4038, dl, trid);
    S.flame.add(X + t.dx * 0.16, tY + 1.5, Z + t.dy * 0.16, 1.2, 1.2, 1.2, 0, TH.flame, dl + 0.08, trid);
    S.flameCore.add(X + t.dx * 0.16, tY + 1.53, Z + t.dy * 0.16, 1.2, 1.2, 1.2, 0, TH.flameCore, dl + 0.08, trid);
  }

  /* Mob spawn visual markers (pedestals & floating crystals) removed per user request */

  /* Themed doorways: post/lintel silhouette + material per theme, same
     resolution pattern as the spawn portals below. Declared here because the
     arch loop needs the tints and setDefs needs the geometry. */
  const dth = DOORWAY_THEMES[d.params.themeKey] || DOORWAY_THEMES.ancient;
  const doorMat = dth.matName === 'ice' ? matIce : (dth.matName === 'bark' ? matBark : matStone);
  const doorPostGeo = GEO[dth.postGeoName] || GEO.archPost;
  const doorLintelGeo = GEO[dth.lintelGeoName] || GEO.archLintel;

  for (const a of d.arches) {
    const X = wx(a.x), Z = wz(a.y);
    const half = a.len * 0.5 + 0.02;
    const dlA = nearFloorBfs(Math.round(a.x), Math.round(a.y)) * dStep + 0.7;
    /* Per-theme tints; a null in the table means "stay neutral, follow the
       theme's wall colour" (the pre-themed behaviour). */
    const postCol = dth.postCol != null ? dth.postCol : (TH.wall || TH.pillar);
    const lintelCol = dth.lintelCol != null ? dth.lintelCol : (TH.cap || TH.wall);
    const threshCol = lerpC(TH.floor, TH.wall, 0.18);
    const dcell = -2 - idx(Math.round(a.x), Math.round(a.y));
    const rot = a.px === 1 ? 0 : Math.PI / 2;
    const aCell = idx(Math.max(0, Math.min(W - 1, Math.round(a.x))), Math.max(0, Math.min(H - 1, Math.round(a.y))));
    const aFloorY = surfY(aCell);

    /* Posts face inward from either side of the opening: mirroring the far post
       keeps asymmetric silhouettes (leaning stones, side roots) reading as a
       matched pair rather than two copies pointing the same way. */
    if (a.px === 1) {
      S.threshold.add(X, aFloorY, Z, a.len + 0.12, 0.85, 0.65, 0, threshCol, dlA, dcell);
      S.arch.add(X - half, aFloorY, Z, 1.15, 1.12, 1.15, 0, postCol, dlA, dcell);
      S.arch.add(X + half, aFloorY, Z, 1.15, 1.12, 1.15, Math.PI, postCol, dlA, dcell);
      S.archL.add(X, aFloorY + 2.02, Z, a.len + 0.18, 1.25, 1.30, 0, lintelCol, dlA + 0.1, dcell);
    } else {
      S.threshold.add(X, aFloorY, Z, a.len + 0.12, 0.85, 0.65, Math.PI / 2, threshCol, dlA, dcell);
      S.arch.add(X, aFloorY, Z - half, 1.15, 1.12, 1.15, Math.PI / 2, postCol, dlA, dcell);
      S.arch.add(X, aFloorY, Z + half, 1.15, 1.12, 1.15, -Math.PI / 2, postCol, dlA, dcell);
      S.archL.add(X, aFloorY + 2.02, Z, a.len + 0.18, 1.25, 1.30, Math.PI / 2, lintelCol, dlA + 0.1, dcell);
    }
    S.gate.add(X, aFloorY, Z, a.len, 1.8, 1, rot, lerpC(TH.wall, 0x000000, dth.gateMix ?? 0.2), dlA + 0.05, dcell);
  }

  if (TH.pools) {
    liquidMat.uniforms.uMode.value = TH.pools.mode;
    liquidMat.uniforms.uColA.value.set(TH.pools.colA);
    liquidMat.uniforms.uColB.value.set(TH.pools.colB);
    liquidMat.uniforms.uGlow.value = TH.pools.glow;
  }
  if (d.pools.length) {
    const skirtC = TH.pools.mode === 0 ? 0xff5a1f : (TH.pools.mode === 3 ? 0x33531e : 0x11463c);
    /* Nearest FLOOR cell, used to decide which room's fog reveal owns this
       liquid tile. Multi-tile bodies have interior cells whose 4 neighbours are
       all POOL, so a 1-ring lookup isn't enough — widen the search a little
       before giving up. */
    const anchorOf = p => {
      const c = idx(p.x, p.y);
      if (grid[c + 1] === FLOOR) return c + 1; if (grid[c - 1] === FLOOR) return c - 1;
      if (grid[c + W] === FLOOR) return c + W; if (grid[c - W] === FLOOR) return c - W;
      for (let r = 2; r <= 4; r++)
        for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;   // ring only
          const nx = p.x + ox, ny = p.y + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = idx(nx, ny);
          if (grid[n] === FLOOR) return n;
        }
      return -1;
    };
    const poolGroups = new Map();
    for (const p of d.pools) {
      const dl = nearFloorBfs(p.x, p.y) * dStep + 0.5;
      const a = anchorOf(p), rid = a >= 0 ? roomId[a] : -1;
      const fogId = rid >= 0 ? rid : (a >= 0 ? -2 - a : -1);
      /* Basin and rim sit at the WATERLINE, not the base plane. Left at 0,
         a pool levelled onto a raised tier floated above its own basin with
         open void under the surface — the "water hovering with no texture"
         report. Pool cells are not FLOOR, which is exactly why the scene Y
         audit walked straight past this. */
      const pY = surfY(idx(p.x, p.y));
      S.basin.add(wx(p.x), pY, wz(p.y), 1, 1, 1, 0, lerpC(TH.wall, 0x000000, 0.35), dl, fogId);
      /* The skirt is a crusted rim, so it only belongs on the edge of a body —
         stacking one on every interior cell of a multi-tile pool is both noisy
         and needless geometry. */
      const pc = idx(p.x, p.y);
      const isRim = grid[pc + 1] !== POOL || grid[pc - 1] !== POOL ||
        grid[pc + W] !== POOL || grid[pc - W] !== POOL;
      if (isRim)
        S.skirt.add(wx(p.x), pY, wz(p.y), cellRng.f(0.85, 1.25), 1, cellRng.f(0.85, 1.25), cellRng.f(0, 6.28), skirtC, dl + 0.15, fogId);
      const key = rid >= 0 ? 'r' + rid : 'c' + a;
      if (!poolGroups.has(key)) poolGroups.set(key, { rid, anchors: [], cells: [] });
      const pg = poolGroups.get(key); pg.cells.push(p); if (a >= 0) pg.anchors.push(a);
    }
    for (const pg of poolGroups.values()) {
      const m = buildLiquidMesh(pg.cells, wx, wz, c => surfY(idx(c.x, c.y)) - 0.08);
      group.add(m); fx.liquids.push(m);
      standaloneRooms.push(pg.rid >= 0 ? { mesh: m, rid: pg.rid } : { mesh: m, cells: pg.anchors });
    }
  }
  if (d.lakeCells.length) {
    const byRoom = new Map();
    for (const lc of d.lakeCells) {
      const r = roomId[idx(lc.x, lc.y)];
      if (!byRoom.has(r)) byRoom.set(r, []);
      byRoom.get(r).push(lc);
    }
    for (const [r, cells] of byRoom) {
      const m = buildLiquidMesh(cells, wx, wz, c => surfY(idx(c.x, c.y)) - 0.12);
      group.add(m); fx.liquids.push(m);
      standaloneRooms.push({ mesh: m, rid: r });
    }
  }

  const TT = TH.tile || {};
  const decDl = t => nearFloorBfs(t.x, t.y) * dStep + 0.35;
  if (TT.runes) {
    const byRoom = new Map();
    for (const t of decCand) if (t.rid >= 0 && !t.walls8) {
      if (!byRoom.has(t.rid)) byRoom.set(t.rid, []);
      byRoom.get(t.rid).push(t);
    }
    for (const tiles of byRoom.values()) {
      if (!cellRng.chance(TT.runes)) continue;
      const t = tiles[cellRng.i(0, tiles.length - 1)];
      const s = cellRng.f(0.8, 1.1);
      S.runeSeal.add(wx(t.x), (t.surfY || 0), wz(t.y), s, 1, s, cellRng.f(0, 6.28),
        lerpC(0x7a5220, accC, 0.25), decDl(t), t.rid);
    }
  }
  if (TT.embers) for (const t of decCand) {
    if (!cellRng.chance(TT.embers)) continue;
    const s = cellRng.f(0.55, 1.0);
    S.ember.add(wx(t.x), (t.surfY || 0), wz(t.y), s, 1, s, cellRng.f(0, 6.28),
      lerpC(0x8a3512, 0xff5a1f, cellRng.raw()), decDl(t), t.rid);
  }
  if (TT.rime) for (const t of decCand) {
    if (!t.walls8 || !cellRng.chance(TT.rime)) continue;
    const s = cellRng.f(0.8, 1.3);
    S.rime.add(wx(t.x), (t.surfY || 0), wz(t.y), s, 1, s, cellRng.f(0, 6.28),
      lerpC(0x4a7290, 0x86b8d8, cellRng.raw()), decDl(t), t.rid);
  }
  if (TT.stains) for (const t of decCand) {
    if (!cellRng.chance(TT.stains)) continue;
    const s = cellRng.f(0.7, 1.45);
    S.stain.add(wx(t.x), (t.surfY || 0), wz(t.y), s, 1, s, cellRng.f(0, 6.28),
      lerpC(0x0d120c, 0x1c2416, cellRng.raw()), decDl(t), t.rid);
  }
  if (TT.growth) for (const t of decCand) {
    const hit = t.walls8 ? cellRng.chance(TT.growth) : cellRng.chance(TT.sprout || 0);
    if (!hit) continue;
    const s = cellRng.f(0.75, 1.35);
    S.growth.add(wx(t.x), (t.surfY || 0), wz(t.y), s, 1, s, cellRng.f(0, 6.28),
      lerpC(0x2e5230, 0x4f7f42, cellRng.raw()), decDl(t), t.rid);
  }

  const sth = SPAWN_THEMES[d.params.themeKey] || SPAWN_THEMES.ancient;
  const spawnMat = sth.spawnMatName === 'ice' ? matIce : (sth.spawnMatName === 'bark' ? matBark : matStone);
  const spawn1Geo = GEO[sth.spawn1GeoName] || GEO.spawn1;
  const spawn2Geo = GEO[sth.spawn2GeoName] || GEO.spawn2;
  const spawn3Geo = GEO[sth.spawn3GeoName] || GEO.spawn3;

  const grassMat = TH.deadGrass ? matDeadGrass : matSwampGrass;
  const setDefs = [
    ['pillar', GEO.pillar, cutCopy(matStone), 'rise', 0.4, 1],
    ['arch', doorPostGeo, cutCopy(doorMat), 'rise', 0.45, 1],
    ['archL', doorLintelGeo, cutCopy(doorMat), 'pop', 0.35, 1],
    ['gate', GEO.gate, cutCopy(doorMat), 'rise', 0.4, 1],
    ['torchArm', GEO.torch, matTrim, 'pop', 0.3, 0],
    ['flame', GEO.flame, matGlow, 'pop', 0.3, 0],
    ['flameCore', GEO.flameCore, matGlow, 'pop', 0.3, 0],
    ['debrisA', GEO.debrisA, matStone, 'pop', 0.3, 2],
    ['debrisB', GEO.debrisB, matStone, 'pop', 0.3, 2],
    ['debrisC', GEO.debrisC, matStone, 'pop', 0.3, 2],
    ['chest', GEO.chestBody, matStone, 'pop', 0.35, 1],
    ['chestTrim', GEO.chestTrim, matTrim, 'pop', 0.35, 0],
    ['chestGlow', GEO.chestSeam, matGlow, 'pop', 0.4, 0],
    ['grave', GEO.grave, matStone, 'rise', 0.4, 1],
    ['sarco', GEO.sarco, matStone, 'pop', 0.4, 1],
    ['candle', GEO.candle, matStone, 'pop', 0.3, 0],
    ['bone', GEO.bone, matBoneStone, 'pop', 0.3, 0],
    ['skull', GEO.skull, matBoneStone, 'pop', 0.35, 1],
    ['skeleton', GEO.skeleton, matBoneStone, 'pop', 0.35, 1],
    ['bonePile', GEO.bonePile, matBoneStone, 'pop', 0.35, 1],
    ['spiderWeb', GEO.spiderWeb, matWeb, 'pop', 0.4, 0],
    ['icicle', GEO.icicle, matIce, 'pop', 0.35, 0],
    ['shardIce', GEO.shard, matIce, 'pop', 0.35, 0],
    ['roots', GEO.roots, matBark, 'rise', 0.5, 1],
    ['wallIvy', GEO.wallIvy, matIvy, 'pop', 0.35, 0],
    ['threshold', GEO.threshold, matStone, 'pop', 0.35, 1],
    ['crackD', GEO.crack, matCrackD, 'pop', 0.4, 0],
    ['skirt', GEO.skirt, matSkirt, 'pop', 0.5, 0],
    ['bannerRod', GEO.bannerRod, matTrim, 'pop', 0.3, 0],
    ['bannerCloth', GEO.bannerCloth, matCloth, 'rise', 0.4, 0],
    ['emblem', GEO.emblem, matGlow, 'pop', 0.3, 0],
    ['spawn1', spawn1Geo, spawnMat, 'rise', 0.4, 1],
    ['spawn2', spawn2Geo, spawnMat, 'rise', 0.4, 1],
    ['spawn3', spawn3Geo, spawnMat, 'rise', 0.4, 1],
    ['band2', GEO.band2, matGlow, 'pop', 0.3, 0],
    ['band3', GEO.band3, matGlow, 'pop', 0.3, 0],
    ['crystal', GEO.crystal, matGlow, 'pop', 0.4, 0],
    ['ring', GEO.ring, matGlow, 'pop', 0.4, 0],
    ['plinth', GEO.plinth, matStone, 'pop', 0.4, 1],
    ['platform', GEO.platform, matStone, 'pop', 0.45, 2],
    ['sepulcherDais', GEO.sepulcherDais, matStone, 'rise', 0.4, 2],
    ['brazier', GEO.brazier, matTrim, 'pop', 0.35, 1],
    ['tent', GEO.tent, matCloth, 'rise', 0.4, 1],
    ['coals', GEO.coals, matGlow, 'pop', 0.35, 0],
    ['campfireStones', GEO.campfireStones, matStone, 'pop', 0.35, 1],
    ['campfireLogs', GEO.campfireLogs, matBark, 'rise', 0.4, 1],
    ['campfireCoals', GEO.campfireCoals, matEmber, 'pop', 0.35, 0],
    ['campfireFlames', GEO.campfireFlames, matGlow, 'pop', 0.3, 0],
    ['campfireFlameCore', GEO.campfireFlameCore, matGlow, 'pop', 0.3, 0],
    ['basin', GEO.basin, matStone, 'pop', 0.3, 0],
    ['bossGlow', GEO.bossShard, matGlow, 'rise', 0.5, 0],
    ['bossRock', GEO.bossShard, matStone, 'rise', 0.5, 1],
    ['runeSeal', GEO.seal, matRuneSeal, 'pop', 0.45, 0],
    ['ember', GEO.crack, matEmber, 'pop', 0.4, 0],
    ['rime', GEO.blot, matBlotAdd, 'pop', 0.5, 0],
    ['stain', GEO.blot, matBlot, 'pop', 0.5, 0],
    ['growth', GEO.blot, matBlot, 'pop', 0.5, 0],
    ['barrel', GEO.barrel, matWood, 'pop', 0.35, 1],
    ['crate', GEO.crate, matWood, 'pop', 0.35, 1],
    ['table', GEO.table, matWood, 'pop', 0.4, 1],
    ['bench', GEO.bench, matWood, 'pop', 0.35, 1],
    ['chair', GEO.chair, matWood, 'pop', 0.3, 1],
    ['bookshelf', GEO.bookshelf, matWood, 'rise', 0.45, 1],
    ['bookshelfBooks', GEO.bookshelfBooks, matWood, 'rise', 0.45, 1],
    ['weaponRack', GEO.weaponRack, matWood, 'rise', 0.4, 1],
    ['statue', GEO.statue, cutCopy(matStone), 'rise', 0.5, 1],
    ['urn', GEO.urn, matCeramic, 'pop', 0.35, 1],
    ['rug', GEO.rug, matRug, 'pop', 0.4, 0],
    ['magicCircle', GEO.magicCircle, matMagicCircle, 'pop', 0.45, 0],
    ['tapestry', GEO.tapestry, matTapestry, 'rise', 0.45, 0],
    ['sconce', GEO.sconce, matSconce, 'pop', 0.3, 0],
    ['forge', GEO.forge, matMetal, 'pop', 0.4, 1],
    ['cauldron', GEO.cauldron, matMetal, 'pop', 0.35, 1],
    ['ossuaryFrame', GEO.ossuaryFrame, matStone, 'rise', 0.45, 1],
    ['ossuaryBones', GEO.ossuaryBones, matBoneStone, 'rise', 0.45, 1],
    ['ossuaryBeds', GEO.ossuaryBeds, matBoneStone, 'rise', 0.45, 1],
    ['sporePod', GEO.sporePod, matBiolum, 'pop', 0.4, 0],
    ['megalith', GEO.megalith, matStone, 'rise', 0.5, 1],
    ['wagon', GEO.wagon, matWood, 'pop', 0.45, 1],
    ['altarTable', GEO.altarTable, matStone, 'pop', 0.4, 1],
    ['iceThrone', GEO.iceThrone, matGlacialIce, 'rise', 0.45, 1],
    ['globe', GEO.globe, matMetal, 'pop', 0.35, 1],
    ['stalagmite', GEO.stalagmite, matStone, 'rise', 0.45, 1],
    ['boulderPile', GEO.boulderPile, matStone, 'pop', 0.35, 1],
    ['forgeChains', GEO.forgeChains, matMetal, 'pop', 0.35, 0],
    ['hangingChains', GEO.hangingChains, matMetal, 'pop', 0.35, 0],
    ['bridgeRailing', GEO.bridgeRailing, matMetal, 'rise', 0.4, 0],
    ['magmaBridge', GEO.magmaBridge, matMetal, 'rise', 0.45, 1],
    ['magmaBridgeApproach', GEO.magmaBridgeApproach, matStone, 'rise', 0.4, 1],
    ['woodBridge', GEO.woodBridge, matWood, 'rise', 0.45, 1],
    ['woodRailing', GEO.woodRailing, matWood, 'rise', 0.4, 0],
    ['ingotStack', GEO.ingotStack, matMetal, 'pop', 0.35, 1],
    ['goldBullion', GEO.goldBullion, matGoldBullion, 'pop', 0.35, 1],
    ['smeltingCrucible', GEO.smeltingCrucible, matMetal, 'pop', 0.4, 1],
    ['crucibleLiquid', GEO.crucibleLiquid, matGlow, 'pop', 0.35, 0],
    ['mammothTusks', GEO.mammothTusks, matBoneStone, 'rise', 0.45, 1],
    ['runicObelisk', GEO.runicObelisk, matStone, 'rise', 0.5, 1],
    ['runicObeliskGlow', GEO.runicObeliskGlow, matGlow, 'pop', 0.4, 0],
    ['shieldRack', GEO.shieldRack, matWood, 'pop', 0.4, 1],
    ['hearthPit', GEO.hearthPit, matStone, 'pop', 0.35, 1],
    ['boneTotem', GEO.boneTotem, matBoneStone, 'rise', 0.45, 1],
    ['glacialSpire', GEO.glacialSpire, matGlacialIce, 'rise', 0.45, 1],
    ['cornerRubbleA', GEO.cornerRubbleA, matWallCap, 'pop', 0.35, 1],
    ['cornerRubbleB', GEO.cornerRubbleB, matWallCap, 'pop', 0.35, 1],
    ['cornerRubbleC', GEO.cornerRubbleC, matWallCap, 'pop', 0.35, 1],
    ['cornerRubbleD', GEO.cornerRubbleD, matWallCap, 'pop', 0.35, 1],
    ['fallenBrick', GEO.fallenBrick, matWallCap, 'pop', 0.3, 1],
    ['swampgrass', GEO.swampgrass, grassMat, 'pop', 0.35, 2],
    ['swampgrass2', GEO.swampgrass2, grassMat, 'pop', 0.35, 2],
    ['swampgrass3', GEO.swampgrass3, grassMat, 'pop', 0.35, 2]
  ];
  for (const [k, geo, mat, mode, dur, sh] of setDefs) {
    meshes[k] = buildMesh(S[k], geo, mat, mode, dur, sh);
    if (TH.overland && (k.startsWith('swampgrass') || k.startsWith('debris') || k === 'boulderPile' || k === 'roots')) {
      meshes[k].userData.overlandCullable = true;
    }
  }
  /* bone models: seated skeletons stand high enough to cast a shadow; the
     ones lying flat only receive */
  for (const [k, set] of Object.entries(boneSets))
    bakedParts(k).forEach((part, j) => {
      const m = buildMesh(set, part.geo, part.mat, 'pop', 0.35, k.startsWith('skeletonSit') ? 1 : 2);
      if (TH.overland) m.userData.overlandCullable = true;
      meshes[`${k}_${j}`] = m;
    });
  for (const [k, set] of Object.entries(modelPropSets))
    bakedParts(k).forEach((part, j) => {
      if (SIGHT_BLOCKING_KINDS.has(k)) cutawayPatch(part.mat);   // pillars, statues, obelisks: cut like walls
      const m = buildMesh(set, part.geo, part.mat, 'pop', 0.35, k.startsWith('swampgrass') ? 2 : 1);
      if (TH.overland) m.userData.overlandCullable = true;
      meshes[`model_${k}_${j}`] = m;
    });
  /* Late pass. buildScene starts a biome's models loading but doesn't wait
     for them, and model-only props (scroll shelves, cages, lecterns...) have
     no stand-in, so a level built before they arrived simply lacked them —
     until the next level. Once the skipped models load, and if this level is
     still the one on screen, place them and let the fog re-hide them. */
  if (latePending.length) {
    const builtGroup = group;
    const waits = [...new Set(latePending.map(q => propLoading[q.p.kind]))];
    Promise.allSettled(waits).then(() => {
      if (group !== builtGroup) return;
      const lateRng = makeRng((d.seed ^ 0x1a7e9a55) >>> 0);
      const lateModelSets = {};
      let placed = 0;
      for (const q of latePending) if (propAssets[q.p.kind]) { placeModelProp(q.p, q.X, q.PY, q.Z, q.propRoom, lateRng, q.dl || 0, lateModelSets); placed++; }
      for (const [k, set] of Object.entries(lateModelSets)) {
        if (!set.n || !propAssets[k]) continue;
        bakedParts(k).forEach((part, j) => {
          if (SIGHT_BLOCKING_KINDS.has(k)) cutawayPatch(part.mat);
          const mesh = buildMesh(set, part.geo, part.mat, 'pop', 0.35, k.startsWith('swampgrass') ? 2 : 1);
          if (TH.overland) mesh.userData.overlandCullable = true;
          meshes[`model_${k}_late_${j}`] = mesh;
          group.add(mesh);
        });
      }
      if (placed) _overlandCullDirty = true;
      if (placed && onLateProps) onLateProps();
    });
  }
  /* Bone models load with the generic set and often arrive after the first
     floor is built. Baking the stick stand-in at that moment left it on
     screen for the whole floor — the "it was the real skeletons, then it
     went back to the procedural ones" flicker across a reload. Hold those
     props until the GLBs settle, then instance the models (or the stand-in,
     if a file failed). */
  if (boneLate.length) {
    const builtGroup = group;
    const waits = Object.keys(BONE_PROP_FILES)
      .filter(k => propLoading[k] && !propSettled[k])
      .map(k => propLoading[k]);
    Promise.allSettled(waits).then(() => {
      if (group !== builtGroup) return;
      const lateSets = {};
      const stand = {
        skull: instSet(), skeleton: instSet(), bonePile: instSet(), bone: instSet(), ossuaryBones: instSet()
      };
      let placed = 0;
      for (const q of boneLate) {
        if (q.ossuary) {
          if (propAssets.boneSkull) {
            const beds = instSet();
            placeOssuarySkulls(q.ossuary, lateSets, beds);
            if (beds.n) {
              meshes.ossuaryBedsLate = buildMesh(beds, GEO.ossuaryBeds, matBoneStone, 'rise', 0.45, 1);
              group.add(meshes.ossuaryBedsLate);
              placed++;
            }
          } else {
            const f = q.ossuary;
            stand.ossuaryBones.add(f.ox, f.PY, f.oz, f.os, f.os, f.os, f.ry, 0xfff8ee, f.dl + 0.04, f.propRoom);
          }
          continue;
        }
        const st = boneModel(q.p, q.rx, q.ry, q.X, q.PY, q.Z, q.propRoom, q.dl, lateSets);
        if (st === 'placed') placed++;
        else {
          const kind = q.p.kind;
          const set = kind === 'skull' ? stand.skull : (kind === 'skeleton' ? stand.skeleton : (kind === 'bonePile' ? stand.bonePile : stand.bone));
          const col = kind === 'skull' ? 0xdfd8c4 : (kind === 'skeleton' ? 0xd0c8b0 : 0xcfc4a4);
          set.add(q.X, q.PY, q.Z, q.p.scale, q.p.scale, q.p.scale, q.p.rot || 0, col, q.dl, q.propRoom);
        }
      }
      for (const [k, set] of Object.entries(lateSets)) {
        if (!set.n || !propAssets[k]) continue;
        bakedParts(k).forEach((part, j) => {
          const mesh = buildMesh(set, part.geo, part.mat, 'pop', 0.35, k.startsWith('skeletonSit') ? 1 : 2);
          meshes[`${k}_late_${j}`] = mesh;
          group.add(mesh);
          placed++;
        });
      }
      const standDefs = [
        ['skull', GEO.skull, 'pop', 0.35, 1],
        ['skeleton', GEO.skeleton, 'pop', 0.35, 1],
        ['bonePile', GEO.bonePile, 'pop', 0.35, 1],
        ['bone', GEO.bone, 'pop', 0.3, 0],
        ['ossuaryBones', GEO.ossuaryBones, 'rise', 0.45, 1]
      ];
      for (const [k, geo, mode, dur, sh] of standDefs) {
        if (!stand[k].n) continue;
        const mesh = buildMesh(stand[k], geo, matBoneStone, mode, dur, sh);
        meshes[`${k}_late`] = mesh;
        group.add(mesh);
        placed++;
      }
      if (placed && onLateProps) onLateProps();
    });
  }
  if (S.cornerRubbleA.n > 0) setAtlasAttr(GEO.cornerRubbleA, rubbleAUv, S.cornerRubbleA.n);
  if (S.cornerRubbleB.n > 0) setAtlasAttr(GEO.cornerRubbleB, rubbleBUv, S.cornerRubbleB.n);
  if (S.cornerRubbleC.n > 0) setAtlasAttr(GEO.cornerRubbleC, rubbleCUv, S.cornerRubbleC.n);
  if (S.cornerRubbleD.n > 0) setAtlasAttr(GEO.cornerRubbleD, rubbleDUv, S.cornerRubbleD.n);
  if (S.fallenBrick.n > 0) setAtlasAttr(GEO.fallenBrick, brickUv, S.fallenBrick.n);
  for (const k in meshes) group.add(meshes[k]);

  /* Hide mob spawn towers / markers from rendering as requested by user */
  if (meshes.spawn1) meshes.spawn1.visible = false;
  if (meshes.spawn2) meshes.spawn2.visible = false;
  if (meshes.spawn3) meshes.spawn3.visible = false;
  if (meshes.band2) meshes.band2.visible = false;
  if (meshes.band3) meshes.band3.visible = false;

  if (portalXZ) {
    matPortal.color.set(0x3fd0bb);
    const m = new THREE.Mesh(GEO.portal, matPortal);
    m.position.set(portalXZ[0], 0.01, portalXZ[1]);
    group.add(m); fx.spinners.push({ m, spd: 0.55 });
    standaloneRooms.push({ mesh: m, rid: d.entrance });
  }
  if (runeXZ) {
    matRune.color.set(0xff5040);
    const m = new THREE.Mesh(GEO.runeRing, matRune);
    m.position.set(runeXZ.x, surfYW(runeXZ.x, runeXZ.z) + 0.06, runeXZ.z);
    m.scale.setScalar(runeXZ.s);
    group.add(m); fx.spinners.push({ m, spd: -0.16 });
    standaloneRooms.push({ mesh: m, rid: d.boss });
  }
  /* Ground height field for the fog layers (dungeon_materials.js): the walk
     surface per cell, walls a little above the floor they border (enough to
     clear a fog sheet without wiping fog out of every corridor), one 3x3
     blur so the fade spreads across about a cell rather than snapping at
     the cell edge. */
  {
    const hRaw = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = idx(x, y);
      if (grid[c] === FLOOR) { hRaw[c] = surfY(c); continue; }
      if (grid[c] === POOL) { hRaw[c] = surfY(c) - 0.15; continue; }
      let top = -Infinity;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const nx = x + i, ny = y + j;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nc = idx(nx, ny);
        if (grid[nc] === FLOOR || grid[nc] === POOL) top = Math.max(top, surfY(nc));
      }
      hRaw[c] = top === -Infinity ? 2.0 : top + 0.3;
    }
    const hBlur = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, wsum = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const nx = Math.max(0, Math.min(W - 1, x + i)), ny = Math.max(0, Math.min(H - 1, y + j));
        const w = (i === 0 ? 2 : 1) * (j === 0 ? 2 : 1);
        s += hRaw[idx(nx, ny)] * w; wsum += w;
      }
      hBlur[idx(x, y)] = s / wsum;
    }
    setFogHeightField(W, H, hBlur);
  }

  /* Layered Atmospheric Mist Sheets & Ground Haze (HD-2D Diorama Atmosphere) */
  if (d.rooms && d.rooms.length) {
    for (const r of d.rooms) {
      const isBoss = r.id === d.boss;
      const isLarge = (r.w >= 4 && r.h >= 4);
      let mistChance = 0.65;
      if (TH.overland) {
        if (d.weather === 'fog') mistChance = 0.85;
        else if (d.weather === 'rain' || d.weather === 'overcast') mistChance = 0.30;
        else mistChance = 0.08;
      }
      if (isBoss || (isLarge && cellRng.chance(mistChance))) {
        const cx = r.cx != null ? r.cx : (r.x + r.w / 2);
        const cy = r.cy != null ? r.cy : (r.y + r.h / 2);
        const X = wx(cx), Z = wz(cy);
        const fY = surfYW(X, Z);

        let mistColor = 0xdbe8d4; // natural forest morning haze
        if (TH.label === 'FROST' || TH.label === 'SNOWFIELD') mistColor = 0xcde8ff;
        else if (TH.label === 'MOLTEN') mistColor = 0xffd2a0;
        else if (TH.label === 'GRIM') mistColor = 0xa4e2b0;
        else if (TH.label === 'MIRE' || TH.label === 'MOOR') mistColor = 0xd2e5a8;
        else if (TH.label === 'BONEYARD') mistColor = 0xced4c8;
        else if (TH.overland) mistColor = 0xe4ecd8;

        const mistW = r.w * (TH.overland ? 1.45 : 1.25);
        const mistH = r.h * (TH.overland ? 1.45 : 1.25);
        const mMat = createMistMaterial(mistColor, TH.overland ? 0.30 : 0.22);

        const m = new THREE.Mesh(GEO.mistSheet, mMat);
        // Floats gently just above the turf (0.16 units)
        m.position.set(X, fY + 0.16, Z);
        m.scale.set(mistW, 1, mistH);
        m.rotation.y = cellRng.f(0, 6.28);
        m.renderOrder = 7;
        m.userData = {
          mat: mMat,
          baseY: fY + 0.16,
          phase: cellRng.f(0, 6.28),
          layerVisible: true,
          fogVisible: true
        };
        group.add(m);
        fx.mists.push(m);
        standaloneRooms.push({ mesh: m, rid: r.id });

        shaftAt.push({ x: X, z: Z, s: (mistW + mistH) * 0.25, rid: r.id });
      }
    }
  }



  // Soft waterline mist along pools / rivers (shared material & spaced clusters to avoid draw-call explosion on 300-tile ribbon maps)
  if (d.pools && d.pools.length) {
    const poolMistMat = createMistMaterial(0xbcd9e8, 0.22);
    const placedMistXZ = [];
    const minMistDistSq = TH.overland ? 3.2 * 3.2 : 1.8 * 1.8;
    const mistScale = TH.overland ? 4.0 : 2.8;
    for (const p of d.pools) {
      if (cellRng.chance(0.65)) {
        const pX = wx(p.x), pZ = wz(p.y);
        let tooClose = false;
        for (let k = 0; k < placedMistXZ.length; k += 2) {
          const dx = pX - placedMistXZ[k], dz = pZ - placedMistXZ[k + 1];
          if (dx * dx + dz * dz < minMistDistSq) { tooClose = true; break; }
        }
        if (tooClose) continue;
        placedMistXZ.push(pX, pZ);
        const pFY = surfYW(pX, pZ);
        const pm = new THREE.Mesh(GEO.mistSheet, poolMistMat);
        pm.position.set(pX, pFY + 0.06, pZ);
        pm.scale.set(mistScale, 1, mistScale);
        pm.renderOrder = 7;
        pm.userData = {
          mat: poolMistMat,
          baseY: pFY + 0.06,
          phase: cellRng.f(0, 6.28),
          layerVisible: true,
          fogVisible: true
        };
        group.add(pm);
        fx.mists.push(pm);
        const poolCell = p.y * W + p.x;
        const pRid = d.roomId ? d.roomId[poolCell] : -1;
        if (pRid >= 0) standaloneRooms.push({ mesh: pm, rid: pRid });
        else standaloneRooms.push({ mesh: pm, cells: [poolCell] });
      }
    }
  }


  if (TH.particles) {
    const spec = TH.particles;
    const pts = [];
    const pp = (x, z, y) => pts.push({ x, z, y, cell: floorAnchor(x + W / 2 - 0.5, z + H / 2 - 0.5) });
    if (spec.kind === 1) {
      for (const p of d.pools) {
        for (let k = 0; k < 4; k++) {
          pp(wx(p.x) + cellRng.f(-0.45, 0.45), wz(p.y) + cellRng.f(-0.45, 0.45), -0.02);
        }
      }
      for (const t of d.torches) pp(wx(t.x) + t.dx * 0.66, wz(t.y) + t.dy * 0.66, 1.5);
      for (const p of d.props) if (p.kind === 'brazier') pp(wx(p.x), wz(p.y), 0.62);
    } else if (spec.kind === 3) {
      for (const p of d.props) {
        if (p.kind === 'grave' || p.kind === 'sarco' || p.kind === 'tombstone') pp(wx(p.x) + cellRng.f(-0.2, 0.2), wz(p.y) + cellRng.f(-0.2, 0.2), 0.3);
        else if (p.kind === 'candle') pp(wx(p.x), wz(p.y), 0.25);
        else if (p.kind === 'bones') pp(wx(p.x), wz(p.y), 0.1);
      }
      for (const p of d.pools) pp(wx(p.x), wz(p.y), 0);
    } else if (spec.kind === 4) {
      for (const p of d.props) {
        if (p.kind === 'mushroomA' || p.kind === 'mushroomB') pp(wx(p.x) + cellRng.f(-0.25, 0.25), wz(p.y) + cellRng.f(-0.25, 0.25), 0.05);
        else if (p.kind === 'roots' || p.kind === 'rootsA' || p.kind === 'rootsB') pp(wx(p.x) + p.dx * 0.8, wz(p.y) + p.dy * 0.8, cellRng.f(0.2, 1.4));
      }
      for (const p of d.pools) pp(wx(p.x), wz(p.y), 0);
    } else if (spec.kind === 0) {
      for (const s of shaftAt) for (let k = 0; k < 10; k++)
        pp(s.x + cellRng.f(-0.8, 0.8) * s.s, s.z + cellRng.f(-0.8, 0.8) * s.s, cellRng.f(0.3, 2.4));
      for (const t of d.torches) pp(wx(t.x) + t.dx * 0.7, wz(t.y) + t.dy * 0.7, cellRng.f(1.2, 1.9));
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
        if (grid[idx(x, y)] === FLOOR && cellRng.chance(0.12)) pp(wx(x) + cellRng.f(-0.3, 0.3), wz(y) + cellRng.f(-0.3, 0.3), cellRng.f(0.2, 1.8));
    } else if (spec.kind === 2 || spec.kind === 5 || spec.kind === 6 || spec.kind === 7) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (grid[idx(x, y)] === FLOOR) {
          for (let k = 0; k < 3; k++) {
            pp(wx(x) + cellRng.f(-0.45, 0.45), wz(y) + cellRng.f(-0.45, 0.45), cellRng.f(0, 0.4));
          }
        }
      }
    } else {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
        if (grid[idx(x, y)] === FLOOR && cellRng.chance(0.35)) pp(wx(x) + cellRng.f(-0.4, 0.4), wz(y) + cellRng.f(-0.4, 0.4), cellRng.f(0, 0.5));
    }
    if (!pts.length)
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
        if (grid[idx(x, y)] === FLOOR && cellRng.chance(0.15)) pp(wx(x), wz(y), 0);
    if (pts.length) {
      const maxPts = spec.n ? spec.n : Math.min(240, pts.length * 6);
      /* perCell: density per floor cell (these kinds lay 3 anchors per cell),
         so a blizzard is thick on every map size instead of a fixed 550
         spread across a whole overland. */
      const n = spec.perCell
        ? Math.min(spec.cap || 24000, Math.max(40, Math.round(pts.length / 3 * spec.perCell)))
        : Math.min(maxPts, Math.max(40, pts.length));
      const pos = new Float32Array(n * 3), seed = new Float32Array(n);
      const fogCells = new Int32Array(n), origY = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const p = pts[cellRng.i(0, pts.length - 1)];
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
        seed[i] = cellRng.raw();
        fogCells[i] = p.cell; origY[i] = p.y;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      levelGeos.push(g);
      partMat.uniforms.uKind.value = spec.kind;
      partMat.uniforms.uColor.value.set(spec.color);
      let pMat = partMat;
      if (spec.kind === 7) {
        /* Additive white vanishes on white snow; the blizzard draws with
           normal blending. Shares partMat's uniforms so time/zoom still tick.
           Disposed with the level (only partMat itself is kept). */
        pMat = partMat.clone();
        pMat.uniforms = partMat.uniforms;
        pMat.blending = THREE.NormalBlending;
        pMat.toneMapped = false;
      }
      const pm = new THREE.Points(g, pMat);
      pm.frustumCulled = false;
      pm.renderOrder = 20;
      pm.userData.fogCells = fogCells; pm.userData.origY = origY;
      group.add(pm); fx.parts = pm;
    }
  }

  if (TH.groundFog) {
    const followCam = (W > 96 || H > 96);
    const fg = new THREE.PlaneGeometry(followCam ? Math.min(W + 20, 96) : (W + 20), followCam ? Math.min(H + 20, 96) : (H + 20)).rotateX(-Math.PI / 2);
    fogPlaneMat.uniforms.uColor.value.set(TH.groundFog.color !== undefined ? TH.groundFog.color : 0xd4dad0);
    fogPlaneMat.uniforms.uDensity.value = TH.groundFog.density !== undefined ? TH.groundFog.density : 0.28;
    fogPlaneMat.uniforms.uSpeed.value = TH.groundFog.speed !== undefined ? TH.groundFog.speed : 0.035;
    fogPlaneMat.uniforms.uScale.value = TH.groundFog.scale !== undefined ? TH.groundFog.scale : 0.10;
    const fogMesh = new THREE.Mesh(fg, fogPlaneMat);
    fogMesh.position.set(0, TH.groundFog.height !== undefined ? TH.groundFog.height : 0.24, 0);
    fogMesh.userData.followCam = followCam;
    /* Before the sprites (10): a flat sheet drawn after them painted over the
       whole body, head included. Units now carry the fog on their own legs
       (sprite_lighting.js), so the sheet only has to sit on the ground. */
    fogMesh.renderOrder = 8;
    levelGeos.push(fg);
    group.add(fogMesh);
    fx.fogPlane = fogMesh;
  }

  const shHalf = TH.overland ? 38 : Math.max(34, Math.min(68, Math.max(W, H) * 0.55));
  dirL.shadow.camera.left = -shHalf; dirL.shadow.camera.right = shHalf;
  dirL.shadow.camera.top = shHalf; dirL.shadow.camera.bottom = -shHalf;
  dirL.shadow.camera.updateProjectionMatrix();
  updateSunFollow();

  const budget = qualityProfile().keyBudget;
  const keys = [];
  keys.push({ x: rooms[d.entrance].cx, y: rooms[d.entrance].cy, col: 0x3fd0bb, i: 1.8, dist: 16 });
  keys.push({ x: rooms[d.boss].cx, y: rooms[d.boss].cy, col: 0xff4030, i: 2.2, dist: 20, ry: 2.2 });
  const shr = rooms.filter(r => r.type === TYPE.SHRINE);
  if (shr.length) keys.push({ x: shr[0].cx, y: shr[0].cy, col: 0x6f9dff, i: 1.8, dist: 16 });
  const tb = Math.max(4, budget - keys.length);
  const chosen = [];
  if (d.torches.length) {
    chosen.push(d.torches[0]);
    while (chosen.length < Math.min(tb, d.torches.length)) {
      let best = null, bd = -1;
      for (const t of d.torches) {
        let dm = 1e9; for (const c of chosen) { const q = (t.x - c.x) * (t.x - c.x) + (t.y - c.y) * (t.y - c.y); if (q < dm) dm = q; }
        if (dm > bd) { bd = dm; best = t; }
      }
      chosen.push(best);
    }
  }
  let li = 0;
  for (const k of keys) {
    const L = new THREE.PointLight(k.col, k.i * LIGHT_K, k.dist, 2);
    L.position.set(wx(k.x), k.ry || 1.6, wz(k.y));
    L.userData = { base: k.i, ph: li * 2.1, ramp: 1, roomId: d.roomId[idx(k.x, k.y)], fogMult: 1 }; group.add(L); lights.push(L); li++;
  }
  const torchCol = TH.flame || (TH.torchLight && TH.torchLight[0]) || 0xff8c3a;
  const tI = torchPoolIntensity(TH), tR = torchPoolRange(TH);
  for (let i = 0; i < qualityProfile().torchPool; i++) {
    const L = new THREE.PointLight(torchCol, 0, tR, 2);
    L.userData = { isTorchPool: true, base: tI, ph: i * 1.73, ramp: 1, fogMult: 1 };
    group.add(L); lights.push(L);
  }

  animT = 0; animEnd = 1.8; animating = true;
  _lastCullX = 1e9; _lastCullZ = 1e9; _lastCullZoom = -1; _overlandCullDirty = true;
  writeInstancesAll(0);
  applyTorchStates();
}

/* ── level light sources ──
   Every wall torch, candle and brazier on the level, built once per level
   (and again if the theme's torch settings change, as the editor's sliders
   do). Two readers:
   - liveUpdate hands the pooled PointLights (6/10/16 by quality) to the ones
     nearest the camera, flickering — that is all the GPU ever draws;
   - steadyLightSources() gives the rules ALL of them at their flicker-averaged
     strength, so a tile's bright/dim/dark never depends on where the camera
     is, which graphics quality is set, or which way a flame is guttering. */
const FLICKER_MEAN = { torch: 0.78, brazier: 0.78, candle: 0.82 };
let _emCache = { D: null, sig: '', list: [] };
function levelEmitters() {
  if (!D) return [];
  const TH = THEMES[D.params?.themeKey || D.themeKey] || THEMES.ancient;
  const torchCol = TH.flame || (TH.torchLight && TH.torchLight[0]) || 0xff8c3a;
  const candleCol = 0xffbe58;
  const tR = torchPoolRange(TH);
  /* The theme's torch strength (the editor's Torch intensity slider). This
     used to be a fixed max(1.8, …) that ignored the slider entirely; every
     theme's stored value was reset to that 1.8 when it was wired up, so no
     torch changed until someone moves the slider. */
  const tI = TH.torchLight ? torchPoolIntensity(TH) : Math.max(1.8, (TH.torchIntensity || 1.6));
  /* _torchVersion bumps whenever a sconce is snuffed or kindled */
  const sig = torchCol + '|' + tR + '|' + tI + '|' + (D._torchVersion | 0);
  if (_emCache.D === D && _emCache.sig === sig) return _emCache.list;

  const wx = x => x - D.W / 2 + 0.5;
  const wz = y => y - D.H / 2 + 0.5;
  const idx = (x, y) => y * D.W + x;
  const surfY = c => (D.height && c >= 0 && c < D.height.length ? D.height[c] * ELEV_STEP : 0);
  const list = [];
  for (const t of D.torches || []) {
    if (t.lit === false) continue;          // snuffed, or an unlit room's sconce
    const tc = idx(t.x + t.dx, t.y + t.dy);
    const trid = D.roomId[tc] >= 0 ? D.roomId[tc] : (D.roomId[idx(t.x, t.y)] >= 0 ? D.roomId[idx(t.x, t.y)] : (t.roomId !== undefined ? t.roomId : -2 - tc));
    const tY = surfY(tc);
    list.push({
      tx: wx(t.x) + t.dx * 0.66, ty: tY + 1.82, flameTipY: tY + 2.02, tz: wz(t.y) + t.dy * 0.66,
      color: torchCol, dist: tR || 11, intensity: tI, kind: 'torch',
      trid, cells: [tc, idx(t.x, t.y)]
    });
  }
  for (const p of D.props || []) {
    if (p.kind !== 'candle' && p.kind !== 'brazier') continue;
    const cellX = Math.round(p.x), cellY = Math.round(p.y);
    const tc = idx(Math.max(0, Math.min(D.W - 1, cellX)), Math.max(0, Math.min(D.H - 1, cellY)));
    const pY = surfY(tc);
    const trid = p.roomId !== undefined ? p.roomId : (D.roomId && D.roomId[tc] >= 0 ? D.roomId[tc] : -1);
    const sc = p.scale || 1;
    if (p.kind === 'candle') {
      list.push({
        tx: wx(p.x), ty: pY + (p.oy || 0) + 0.38 * sc, flameTipY: pY + (p.oy || 0) + 0.46 * sc, tz: wz(p.y),
        color: candleCol, dist: 6.2 * Math.sqrt(sc), intensity: 1.23 * sc, kind: 'candle', trid, cells: [tc]   // was 1.45, dimmed 15%
      });
    } else {
      list.push({
        tx: wx(p.x), ty: pY + (p.oy || 0) + 0.75 * sc, flameTipY: pY + (p.oy || 0) + 0.95 * sc, tz: wz(p.y),
        color: torchCol, dist: 10.0 * Math.sqrt(sc), intensity: 2.0 * sc, kind: 'brazier', trid, cells: [tc]
      });
    }
  }
  /* The two Ancient pillar models carry a flame of their own; each is lit
     like a wall torch from where the flame sits on the model. Dungeons only
     for now: a Ruinfield overland scatters ~80 of them and has no torches,
     so lighting them all would undo its night-time darkness. */
  for (const p of (TH.overland ? [] : D.props || [])) {
    const pf = PILLAR_FLAMES[p.kind];
    if (!pf) continue;
    const cellX = Math.round(p.x), cellY = Math.round(p.y);
    const tc = idx(Math.max(0, Math.min(D.W - 1, cellX)), Math.max(0, Math.min(D.H - 1, cellY)));
    const pY = surfY(tc) + (p.oy || 0);
    const trid = p.roomId !== undefined ? p.roomId : (D.roomId && D.roomId[tc] >= 0 ? D.roomId[tc] : -1);
    const sc = (p.scale || 1) * (PROP_SCALE_MULTIPLIER[p.kind] || 1);
    const [lx, ly, lz] = pf.at, rot = p.rot || 0;
    /* rotation.y = rot turns local (x, z) to world (x cos + z sin, -x sin + z cos) */
    list.push({
      tx: wx(p.x) + (lx * Math.cos(rot) + lz * Math.sin(rot)) * sc, ty: pY + ly * sc,
      flameTipY: pY + pf.tip * sc, tz: wz(p.y) + (-lx * Math.sin(rot) + lz * Math.cos(rot)) * sc,
      color: torchCol, dist: tR, intensity: tI, kind: 'torch', trid, cells: [tc]
    });
  }
  _emCache = { D, sig, list };
  return list;
}
/* Where the flame is on each flame-bearing pillar model, in model units
   (y up, before the prop's scale and turn). Measured from the models'
   bright fire-coloured texels: pillarA (pillar.glb) burns in a bowl on top,
   pillarB (pillar2.glb) holds a torch on its front (+Z) face. */
const PILLAR_FLAMES = {
  pillarA: { at: [0, 0.80, 0], tip: 0.97 },
  pillarB: { at: [0, 0.72, 0.17], tip: 0.92 }
};

/* ── snuffing / kindling a wall torch ──
   `t` is a D.torches record. Unlit sconces keep their bracket; the flame and
   its glow instances are parked out of sight (the flame animation skips any
   instance at y <= -500) and restored on relight. The light itself follows
   from levelEmitters skipping unlit torches. */
function torchFlameXZ(t) {
  const wx = x => x - D.W / 2 + 0.5, wz = y => y - D.H / 2 + 0.5;
  const X = wx(t.x) + t.dx * 0.5, Z = wz(t.y) + t.dy * 0.5;
  return [X + t.dx * 0.16, Z + t.dy * 0.16];
}
function setTorchFlameVisible(t, on) {
  const [fx_, fz] = torchFlameXZ(t);
  for (const key of ['flame', 'flameCore']) {
    const fm = meshes[key];
    const s = fm && fm.userData && fm.userData.set;
    if (!s) continue;
    if (!s._parkedPy) s._parkedPy = {};
    for (let i = 0; i < s.n; i++) {
      if (Math.hypot(s.px[i] - fx_, s.pz[i] - fz) > 0.05) continue;
      if (!on && s.py[i] > -500) { s._parkedPy[i] = s.py[i]; s.py[i] = -999; }
      else if (on && s.py[i] <= -500 && s._parkedPy[i] !== undefined) { s.py[i] = s._parkedPy[i]; delete s._parkedPy[i]; }
    }
  }
}
export function setTorchLit(t, lit) {
  if (!D || !t) return;
  t.lit = !!lit;
  D._torchVersion = (D._torchVersion | 0) + 1;
  setTorchFlameVisible(t, !!lit);
}
/* sconces generated unlit (dark rooms) start with their flame parked */
function applyTorchStates() {
  if (!D || !D.torches) return;
  for (const t of D.torches) if (t.lit === false) setTorchFlameVisible(t, false);
}

/* The same sources as the rules see them: position, luminance of the colour,
   flicker-averaged intensity, and the pool lights' falloff (decay 2). The
   returned array is stable while the level and settings are, so callers can
   cache on its identity. */
let _steadyCache = { src: null, list: [] };
export function steadyLightSources() {
  const em = levelEmitters();
  if (_steadyCache.src === em) return _steadyCache.list;
  const c = new THREE.Color();
  const list = em.map(e => {
    c.set(e.color);
    return {
      x: e.tx, y: e.ty, z: e.tz, kind: e.kind,
      lum: 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b,
      intensity: e.intensity * LIGHT_K * (FLICKER_MEAN[e.kind] || 0.78),
      distance: e.dist, decay: 2
    };
  });
  _steadyCache = { src: em, list };
  return list;
}

/* Push torch intensity/range onto the live pool lights without a re-forge —
   the flicker tick reads userData.base, and nothing else touches distance. */
export function applyTorchSettings(TH) {
  const i = torchPoolIntensity(TH), r = torchPoolRange(TH);
  for (const L of lights) {
    if (!L.userData || !L.userData.isTorchPool) continue;
    L.userData.base = i; L.distance = r;
  }
}

export function writeInstancesAll(t) {
  for (const k in meshes) {
    if (meshes[k] && meshes[k].isInstancedMesh && !meshes[k].userData.settled) {
      writeInstances(meshes[k], t);
    }
  }
}

export function settleAll() {
  for (const k in meshes) writeInstances(meshes[k], Infinity);
}

export function finishAnim() {
  animating = false; animT = Infinity;
  settleAll();
}

export function applyReveal(visibleRoomSet, heroPositions = []) {
  for (const k in meshes) {
    const mesh = meshes[k];
    if (!mesh || !mesh.isInstancedMesh) continue;
    const roomIds = mesh.userData.roomIds;
    if (!roomIds) continue;
    const set = mesh.userData.set;
    for (let i = 0; i < mesh.count; i++) {
      const rid = roomIds[i];
      let vis = false;
      if (rid === -1) vis = true;
      else if (visibleRoomSet && visibleRoomSet.has && visibleRoomSet.has(rid)) vis = true;
      else if (Array.isArray(heroPositions)) {
        const px = set.px[i], pz = set.pz[i];
        for (const hp of heroPositions) {
          if (Math.hypot(px - hp.x, pz - hp.z) < 3.5) { vis = true; break; }
        }
      }
      _q.setFromEuler(_E.set(set.rx[i], set.ry[i], set.rz[i]));
      _p.set(set.px[i], vis ? set.py[i] : -999, set.pz[i]);
      _s.set(set.sx[i], set.sy[i], set.sz[i]);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
}

export function liveUpdate(time, tt, dt = 0.016) {
  for (const m of chestMixers) m.update(dt);
  for (const key of ['flame', 'flameCore', 'campfireFlames', 'campfireFlameCore']) {
    const fm = meshes[key];
    if (!fm || !fm.userData.set.n) continue;
    const fu = fm.userData, s = fu.set;
    for (let i = 0; i < s.n; i++) {
      if (s.py[i] <= -500) {
        _q.set(0, 0, 0, 1);
        _p.set(s.px[i], -999, s.pz[i]);
        _s.set(0, 0, 0);
        _m.compose(_p, _q, _s); fm.setMatrixAt(i, _m);
        continue;
      }
      const k = clamp01((tt - s.delay[i]) / fu.dur);
      const g = Math.max(0.0001, k >= 1 ? 1 : easeOutBack(k) * Math.min(1, k * 8));
      const fl = 0.86 + 0.22 * Math.sin(time * 11 + i * 2.7) * Math.sin(time * 5.3 + i * 1.31);
      _q.set(0, 0, 0, 1);
      _p.set(s.px[i], s.py[i] + 0.03 * Math.sin(time * 7 + i), s.pz[i]);
      _s.set(s.sx[i] * g * (0.92 + 0.12 * Math.sin(time * 13 + i * 3.1)), s.sy[i] * g * fl, s.sz[i] * g);
      _m.compose(_p, _q, _s); fm.setMatrixAt(i, _m);
    }
    fm.instanceMatrix.needsUpdate = true;
  }
  const cm = meshes.crystal;
  if (cm && cm.userData.set.n) {
    const cu = cm.userData, s = cu.set;
    for (let i = 0; i < s.n; i++) {
      if (s.py[i] <= -500) {
        _q.set(0, 0, 0, 1);
        _p.set(s.px[i], -999, s.pz[i]);
        _s.set(0, 0, 0);
        _m.compose(_p, _q, _s); cm.setMatrixAt(i, _m);
        continue;
      }
      const k = clamp01((tt - s.delay[i]) / cu.dur);
      const g = Math.max(0.0001, k >= 1 ? 1 : easeOutBack(k) * Math.min(1, k * 8));
      _q.setFromAxisAngle(_Y, s.ry[i] + time * 0.9);
      _p.set(s.px[i], s.py[i] + 0.08 * Math.sin(time * 2.1 + i * 1.7), s.pz[i]);
      _s.set(s.sx[i] * g, s.sy[i] * g, s.sz[i] * g);
      _m.compose(_p, _q, _s); cm.setMatrixAt(i, _m);
    }
    cm.instanceMatrix.needsUpdate = true;
  }
  liquidMat.uniforms.uTime.value = time;
  partMat.uniforms.uTime.value = time;
  fogPlaneMat.uniforms.uTime.value = time;
  foliageWind.value = time;
  if (fx.fogPlane && fx.fogPlane.userData && fx.fogPlane.userData.followCam && camTarget) {
    fx.fogPlane.position.x = camTarget.x;
    fx.fogPlane.position.z = camTarget.z;
  }
  matEmber.opacity = 0.72 + 0.24 * Math.sin(time * 2.3) * Math.sin(time * 1.13);
  updateNixieVfx(dt);
  updateSunFollow();
  if (renderer && D && D.overland && !animating && camTarget) {
    const cx = camTarget.x || 0, cz = camTarget.z || 0;
    const zf = Math.max(MIN_CAM_ZOOM, cam ? cam.zoom : DEFAULT_CAM_ZOOM);
    if (_overlandCullDirty || Math.abs(cx - _lastCullX) > 2.0 || Math.abs(cz - _lastCullZ) > 2.0 || Math.abs(zf - _lastCullZoom) > 0.05) {
      _overlandCullDirty = false;
      _lastCullX = cx; _lastCullZ = cz; _lastCullZoom = zf;
      const winX = (BASE_HALF * (aspect || 1.78)) / zf + 22;
      const winZ = (BASE_HALF / zf) * 2.2 + 26;
      for (const k in meshes) {
        const mesh = meshes[k];
        if (!mesh || !mesh.isInstancedMesh) continue;
        const u = mesh.userData;
        if (!u || !u.overlandCullable || !u.settled) continue;
        const s = u.set;
        if (!s || !s.n) continue;
        if (!u._fullMatrices) {
          u._fullMatrices = new Float32Array(mesh.instanceMatrix.array);
          u._fullColors = mesh.instanceColor ? new Float32Array(mesh.instanceColor.array) : null;
        }
        const fullMat = u._fullMatrices;
        const outMat = mesh.instanceMatrix.array;
        const fullCol = u._fullColors;
        const outCol = mesh.instanceColor ? mesh.instanceColor.array : null;
        let outIdx = 0;
        for (let i = 0; i < s.n; i++) {
          if (s.py[i] <= -500) continue;
          const dx = s.px[i] - cx, dz = s.pz[i] - cz;
          if (dx < -winX || dx > winX || dz < -winZ || dz > winZ) continue;
          const srcOff = i * 16, dstOff = outIdx * 16;
          for (let mIdx = 0; mIdx < 16; mIdx++) outMat[dstOff + mIdx] = fullMat[srcOff + mIdx];
          if (outCol && fullCol) {
            const sc3 = i * 3, dc3 = outIdx * 3;
            outCol[dc3] = fullCol[sc3];
            outCol[dc3 + 1] = fullCol[sc3 + 1];
            outCol[dc3 + 2] = fullCol[sc3 + 2];
          }
          outIdx++;
        }
        mesh.count = outIdx;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      if (fx.mists) {
        for (const mi of fx.mists) {
          if (!mi || !mi.userData) continue;
          const baseVis = mi.userData.layerVisible !== false && mi.userData.fogVisible !== false;
          const inWin = Math.abs(mi.position.x - cx) <= winX + 6 && Math.abs(mi.position.z - cz) <= winZ + 6;
          mi.visible = baseVis && inWin;
        }
      }
    }
  }
  if (renderer) {
    const ch = (renderer.domElement && renderer.domElement.height) || (window.innerHeight * (window.devicePixelRatio || 1)) || 1080;
    partMat.uniforms.uZoom.value = ch * cam.zoom / (2 * BASE_HALF);
  }
  for (const sp of fx.spinners) sp.m.rotation.y = time * sp.spd;
  if (fx.mists) {
    for (const mi of fx.mists) {
      if (mi && mi.visible && mi.userData && mi.userData.mat) {
        const mm = mi.userData.mat;
        if (mm.uniforms && mm.uniforms.uTime) {
          mm.uniforms.uTime.value = time;
        }
        // Gentle undulating vertical breathing
        mi.position.y = mi.userData.baseY + Math.sin(time * 0.45 + mi.userData.phase) * 0.025;
      }
    }
  }
  if (fx.shafts) {
    for (const sh of fx.shafts) {
      if (sh && sh.userData && sh.userData.mat && sh.userData.mat.uniforms && sh.userData.mat.uniforms.uTime) {
        sh.userData.mat.uniforms.uTime.value = time;
      }
    }
  }
  for (const L of lights) {
    if (L.userData && L.userData.isTorchPool) continue;
    if (L.userData && L.userData.extinguished) { L.intensity = 0; L.userData.steady = 0; continue; }
    const base = L.userData.base !== undefined ? L.userData.base : 1.5;
    const ph = L.userData.ph !== undefined ? L.userData.ph : 0;
    const ramp = L.userData.ramp === undefined ? 1 : L.userData.ramp;
    const fogM = L.userData.fogMult !== undefined ? L.userData.fogMult : 1;
    /* a calm light (the Light Shrine) breathes slowly instead of flickering */
    const fWave = L.userData.calm ? 0.78 + 0.04 * Math.sin(time * 0.7 + ph)
      : 0.78 + 0.15 * Math.sin(time * 9.8 + ph) * Math.cos(time * 5.2 + ph * 1.7) + 0.07 * Math.sin(time * 20.0 + ph * 2.5);
    L.intensity = base * LIGHT_K * ramp * fogM * Math.max(0.3, fWave);
    /* what the light rules read: the same light without the flicker */
    L.userData.steady = base * LIGHT_K * ramp * fogM * 0.78;
  }

  if (D && ((D.torches && D.torches.length) || (D.props && D.props.length))) {
    let lx = (camTarget && camTarget.x !== undefined) ? camTarget.x : 0;
    let lz = (camTarget && camTarget.z !== undefined) ? camTarget.z : 0;
    if ((lx === 0 && lz === 0) && game && game.heroes) {
      const alive = game.heroes.filter(h => h.data.hp > 0);
      const leader = alive[game.leaderIdx] || alive[0];
      if (leader && leader.x !== undefined) { lx = leader.x; lz = leader.z; }
    }

    /* Every light source on the level (levelEmitters, cached), narrowed to the
       ones the player could know about and sorted nearest-the-camera first:
       the pool below only has torchPool real lights to hand out. */
    const activeEmitters = [];
    for (const em of levelEmitters()) {
      const distSq = (em.tx - lx) * (em.tx - lx) + (em.tz - lz) * (em.tz - lz);
      let isVis = false;
      if (game && game.D) {
        if (em.trid >= 0 && game.visitedRooms && game.visitedRooms[em.trid]) isVis = true;
        if (!isVis && game.revealed && em.cells.some(c => c >= 0 && c < game.revealed.length && game.revealed[c] > 0)) isVis = true;
        if (!isVis && game.losVisible && em.cells.some(c => c >= 0 && c < game.losVisible.length && game.losVisible[c] > 0)) isVis = true;
        if (!isVis && D && D.overland && distSq < 900) isVis = true;
      } else {
        isVis = true;
      }
      if (isVis) activeEmitters.push({ ...em, distSq });
    }

    activeEmitters.sort((a, b) => a.distSq - b.distSq);

    let poolIdx = 0;
    for (const L of lights) {
      if (!L.userData || !L.userData.isTorchPool) continue;
      if (poolIdx < activeEmitters.length) {
        const item = activeEmitters[poolIdx];
        L.color.set(item.color);
        L.position.set(item.tx, item.ty, item.tz);
        L.distance = item.dist;
        const base = item.intensity;
        const ph = L.userData.ph || (poolIdx * 1.73);
        const fWave = item.kind === 'candle'
          ? 0.82 + 0.12 * Math.sin(time * 8.5 + ph) * Math.cos(time * 4.6 + ph * 1.5) + 0.06 * Math.sin(time * 17.0 + ph * 2.2)
          : 0.78 + 0.16 * Math.sin(time * 10.2 + ph) * Math.cos(time * 5.8 + ph * 1.7) + 0.08 * Math.sin(time * 21.0 + ph * 2.8);
        L.intensity = base * LIGHT_K * Math.max(0.4, fWave);
      } else {
        L.intensity = 0;
      }
      poolIdx++;
    }

    updateAmbientFX(camTarget, activeEmitters.map(a => ({ x: a.tx, z: a.tz, y: a.flameTipY || a.ty })), dt);
  } else {
    updateAmbientFX(camTarget, [], dt);
  }

  updatePartyLights(time, dt);
}

/* Hand the party lights to the heroes carrying a light this frame, on a
   dungeon floor or an overland alike. Heroes bunched together share brightness
   (1/sqrt of the crowd), or a tight party of four torches would bleach the
   floor under them instead of reading as four torches. */
let partyLightWhy = 'not run yet';
/* ── glinting treasure (docs/LIGHT_IDEAS.md 46) ──
   An unopened chest standing in darkness gives off a faint, slow twinkle —
   enough to spot loot in the dark, never enough to light anything. */
const _glints = [];
let _glintTex = null;
function updateChestGlints(time) {
  if (typeof document === 'undefined') return;
  if (!_glintTex) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 32;
    const g = cv.getContext && cv.getContext('2d');
    if (!g || !g.createRadialGradient) return;
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,240,200,1)'); grd.addColorStop(0.3, 'rgba(255,220,140,0.5)'); grd.addColorStop(1, 'rgba(255,200,100,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
    _glintTex = new THREE.CanvasTexture(cv);
  }
  const want = [];
  if (D && game && game.state === 'crawl') {
    for (const c of chestInstances) {
      if (c.opened) continue;
      if (c.mesh && !c.mesh.visible) continue;
      const cell = (typeof game.cellOf === 'function') ? game.cellOf(c.x, c.z) : -1;
      if (cell >= 0) {
        const isSeen = (game.revealed && game.revealed[cell]) || (game.losVisible && game.losVisible[cell]);
        if (!isSeen) continue;
      }
      const y = groundY(D, c.x, c.z);
      if (classifyLight(lightLevelAt(c.x, y, c.z)) !== 'dark') continue;
      want.push({ x: c.x, y, z: c.z, i: want.length });
    }
  }
  while (_glints.length < want.length && _glints.length < 24) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: _glintTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.material.toneMapped = false; m.renderOrder = 12; m.raycast = () => { };
    scene.add(m); _glints.push(m);
  }
  for (let i = 0; i < _glints.length; i++) {
    const s = _glints[i], w = want[i];
    if (!w) { s.visible = false; continue; }
    const tw = Math.max(0, Math.sin(time * 1.7 + w.i * 2.3));
    s.visible = tw > 0.02;
    s.position.set(w.x + 0.12, w.y + 0.55, w.z);
    s.material.opacity = 0.75 * tw * tw;
    s.scale.setScalar(0.18 + 0.12 * tw);
  }
}

function updatePartyLights(time, dt) {
  updateChestGlints(time);
  if (!partyLights.length) { partyLightWhy = 'no party lights built'; return; }
  const off = why => {
    partyLightWhy = why;
    for (const L of partyLights) { L.intensity = 0; L.userData.radii = null; }
    if (game && game.heroes) for (const h of game.heroes) h._lightActive = false;
  };
  if (!game || !game.heroes || !D) return off('no game or level');
  if (game.state !== 'crawl') return off(`game state is "${game.state}", not crawl`);
  /* No overland weather gate: a light a hero has equipped always shines.
     `heroLightNeeded` dates from the free party lantern; gating carried lights
     on it switched them off on any daytime overland, foggy or tod-tuned dark
     ones included, where the ground reads dim. On a clear day the sun simply
     outshines them. */
  partyLightWhy = 'on';

  const alive = game.heroes.filter(h => h.data && h.data.hp > 0 && h.x !== undefined);
  const leader = (game.heroes[game.leaderIdx] && alive.includes(game.heroes[game.leaderIdx])) ? game.heroes[game.leaderIdx] : alive[0];
  const carriers = [];
  for (const h of game.heroes) h._lightActive = false;
  for (const h of leader ? [leader, ...alive.filter(a => a !== leader)] : []) {
    const key = heroLightSource(h.data);
    if (key) { carriers.push({ h, src: LIGHT_SOURCES[key] }); h._lightActive = true; }
    if (carriers.length >= partyLights.length) break;
  }
  /* Dancing Lights take whatever the heroes' own lights leave of the pool. */
  for (const c of dancingLightCarriers(alive)) {
    if (carriers.length >= partyLights.length) break;
    carriers.push(c);
  }
  if (!carriers.length) partyLightWhy = `no hero carries a light (${alive.length} alive with a position)`;

  const isOverland = !!(D && (D.overland || D.effectiveTheme?.overland));
  const todHeroIntensity = (D?.effectiveTheme?.heroLightIntensity !== undefined)
    ? D.effectiveTheme.heroLightIntensity
    : (D?.timeOfDay === 'night' ? 2.4 : D?.timeOfDay === 'dusk' ? 1.3 : 1.0);
  /* On overland maps, especially night/dark maps, boost light intensity, reach,
     and ground angle so hero torches cut starkly against the pitch-black landscape. */
  const overlandMult = isOverland ? Math.max(1.0, todHeroIntensity * 1.25) : 1.0;
  const overlandReach = (isOverland && todHeroIntensity > 1.0) ? 1.45 : 1.0;
  const overlandHeightMult = (isOverland && todHeroIntensity > 1.0) ? 0.75 : 1.0;

  for (let i = 0; i < partyLights.length; i++) {
    const L = partyLights[i], c = carriers[i];
    if (!c) { L.intensity = 0; L.userData.radii = null; continue; }
    let near = 0;
    for (const o of carriers) if (o !== c && Math.hypot(o.h.x - c.h.x, o.h.z - c.h.z) < 3) near++;
    const crowd = 1 / Math.sqrt(1 + near);
    L.userData.crowd += (crowd - L.userData.crowd) * Math.min(1, dt * 4);
    const ph = L.userData.ph;
    /* mean 1, so `base` is the light's real strength */
    const wave = c.src.flicker === 'torch'
      ? 1 + 0.17 * Math.sin(time * 9.5 + ph) * Math.cos(time * 5.4 + ph * 1.3) + 0.07 * Math.sin(time * 19.0 + ph * 2.1)
      : c.src.flicker === 'lantern' ? 1 + 0.04 * Math.sin(time * 3.1 + ph) : 1;
    /* a light shrine's blessing (docs/LIGHT_IDEAS.md 47): every party light
       reaches twice as far for the rest of the floor */
    const bless = (game._lightBlessedD && game._lightBlessedD === D) ? 2 : 1;
    L.color.set(c.src.color);
    L.distance = (c.src.reach || (c.src.dim + 1)) * overlandReach * bless;
    L.decay = c.src.decay;
    L.position.set(c.h.x, groundY(D, c.h.x, c.h.z) + c.src.height * overlandHeightMult, c.h.z);
    /* `base` is perceived brightness: a deep orange torch carries well under
       half the luminance of white at the same intensity, so divide it back
       out or the coloured lights land far dimmer than their radii promise. */
    const lum = 0.2126 * L.color.r + 0.7152 * L.color.g + 0.0722 * L.color.b;
    L.intensity = (c.src.base / Math.max(0.2, lum)) * LIGHT_K * wave * L.userData.crowd * overlandMult * (bless > 1 ? 1.6 : 1);
    /* what the light rules read: the source's own radii, 5e-style, not the
       falloff (render/sprite_lighting.js lightLevelAt) */
    L.userData.radii = { bright: c.src.bright * bless, dim: c.src.dim * bless };
  }
}

/* Swing open the lid of the chest nearest (x, z). The loot is decided
   elsewhere; this is purely the in-world beat. Returns the clip length in
   seconds so the caller can time the haul to the lid, or 0 if nothing there
   could animate (fallback instanced chest, clip missing). */
export function openChest(x, z, radius = 2.5) {
  let best = null, bd = radius;
  for (const c of chestInstances) {
    const d = Math.hypot(c.x - x, c.z - z);
    if (!c.opened && d <= bd) { best = c; bd = d; }
  }
  if (!best) return 0;
  best.opened = true;
  const clips = propClips.chest;
  const clip = clips && (THREE.AnimationClip.findByName(clips, 'open') || clips[0]);
  if (!clip) return 0;
  const mixer = new THREE.AnimationMixer(best.mesh);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;   // stay open
  action.play();
  chestMixers.push(mixer);
  return clip.duration;
}

export function extinguishCampfire(x, z, radius = 2.5) {
  // 1. Hide/sink campfire flames and glowing coals near (x, z)
  for (const key of ['campfireFlames', 'campfireFlameCore', 'campfireCoals']) {
    const fm = meshes[key];
    if (!fm || !fm.userData || !fm.userData.set) continue;
    const s = fm.userData.set;
    for (let i = 0; i < s.n; i++) {
      if (Math.hypot(s.px[i] - x, s.pz[i] - z) <= radius) {
        s.py[i] = -999;
        s.sy[i] = 0;
        _q.set(0, 0, 0, 1);
        _p.set(s.px[i], -999, s.pz[i]);
        _s.set(0, 0, 0);
        _m.compose(_p, _q, _s);
        fm.setMatrixAt(i, _m);
      }
    }
    fm.instanceMatrix.needsUpdate = true;
  }

  // 2. Extinguish the campfire point lights near (x, z)
  if (Array.isArray(lights)) {
    for (const l of lights) {
      if (l.userData?.isCampfire && Math.hypot(l.position.x - x, l.position.z - z) <= radius) {
        /* Intensity 0 and the `extinguished` flag (honoured by the flicker
           loop) are the whole extinguish. NEVER hide the light: three
           bakes the count of visible lights into every lit shader, so hiding
           one light recompiled every lit program in the level — the
           multi-second freeze after the camp animation. See the pooled-light
           note in entities.js. */
        l.intensity = 0;
        l.userData.base = 0;
        l.userData.extinguished = true;
      }
    }
  }

  // 3. Stop persistent embers near (x, z)
  stopPersistentNixieEffectsNear(x, z, radius);
}

export function setupRTs() {
  if (!renderer) return;
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  if (POST.w === size.x && POST.h === size.y && POST.rtScene) return;
  POST.w = size.x; POST.h = size.y;
  if (POST.rtScene) { POST.rtScene.dispose(); POST.rtA.dispose(); POST.rtB.dispose(); POST.rtFocus.dispose(); POST.rtFocusB.dispose(); }
  const ps = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false };
  POST.rtScene = new THREE.WebGLRenderTarget(size.x, size.y, { ...ps, samples: 4 });
  const pb = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false };
  POST.rtA = new THREE.WebGLRenderTarget(size.x >> 2, size.y >> 2, pb);
  POST.rtB = new THREE.WebGLRenderTarget(size.x >> 2, size.y >> 2, pb);
  /* the depth-of-field focus mask (renderFocusMask), at the bloom chain's quarter size */
  POST.rtFocus = new THREE.WebGLRenderTarget(size.x >> 2, size.y >> 2, pb);
  POST.rtFocusB = new THREE.WebGLRenderTarget(size.x >> 2, size.y >> 2, pb);
}

/* ---------------- Depth of field: what's in play stays sharp ----------------
   Outside combat a soft band follows the party up and down the screen and fades
   as the camera pulls out. In combat the sharp area is a FOCUS SET, driven by
   events rather than guessed: the creature whose turn it is, plus whatever an
   action declares (setCombatActionFocus: the actor and every target, all of an
   area spell's victims), held until the action's hold runs out AND the
   presentation clock says its visuals have finished (fx_clock fxVisualBusy).
   The set's bodies are drawn as silhouettes into a small FOCUS MASK each frame
   (renderFocusMask), softened by the bloom blur, so exactly those creatures stay
   sharp at any zoom and size; a thin world-sized capsule from the actor to its
   first target keeps a projectile sharp in flight. The cursor never moves the
   focus: hover has its outline and card instead. */
let combatFocusCur = 0.0;                 // 0 = explore band, 1 = combat focus
let focusPresence = 0.0;                  // eases to 1 while the focus mask has a body in it
const focusHeld = new Map();              // entity -> seconds its action hold has left
let capsuleFrom = null, capsuleTo = null, capsuleUntil = 0;
const FOCUS_CAPSULE_WORLD = 0.55;         // world units either side of the actor->target line
const focusWorldA = new THREE.Vector3();
const focusWorldB = new THREE.Vector3();
const _focusPosA = new THREE.Vector3();
const _focusPosB = new THREE.Vector3();
const focusScreenA = new THREE.Vector2(0.5, 0.48);
const focusScreenB = new THREE.Vector2(0.5, 0.48);
const _projA = new THREE.Vector3();
const _projB = new THREE.Vector3();
const _camRight = new THREE.Vector3();
let focusCapsuleRadius = 0.0;             // screen units (height = 1), from FOCUS_CAPSULE_WORLD at this zoom
let exploreBandY = 0.48;                  // screen height of the party
let exploreFade = 1.0;                    // the band fades as the camera pulls out
let _focusClock = 0;

const isEntity = (o) => !!(o && o.data && (o.ent || (o.anim && o.anim.mesh)));

/** The creature acting now: in focus for as long as its turn lasts. */
function currentActor(g) {
  return g && g.initiative && g.initiative.active && typeof g._currentActor === 'function' ? g._currentActor() : null;
}

/** The target an actor has declared (no guessing: nearest-enemy fallbacks pulled focus onto the wrong creature). */
export function resolveCombatTarget(g, act) {
  if (!g || !act) return null;
  const live = (e) => e && e.data && e.data.hp > 0 && e.active !== false ? e : null;
  /* a target the player is aiming at (manual attack / spell targeting) is declared too */
  const aimed = (st) => st && st.active ? live(st.target) : null;
  return aimed(g.attackTargetingState) || aimed(g.spellTargetingState)
    || live(act.aiFoe) || live(act.target) || live(act._pendingAttackTarget) || null;
}

function getPosVector(obj, outVec) {
  if (!obj || !outVec) return null;
  if (obj.isVector3) { outVec.copy(obj); return outVec; }
  if (obj.x != null) {
    const zVal = obj.z != null ? obj.z : (obj.y ?? 0);
    const gy = (typeof groundY === 'function' && D) ? groundY(D, obj.x, zVal) : 0;
    const yVal = (obj.y != null && obj.z != null && !isEntity(obj)) ? obj.y : (gy + 0.6);
    outVec.set(obj.x, yVal, zVal);
    return outVec;
  }
  return null;
}

/**
 * An action has been declared: keep `actor` and `target` (one, or a list — every
 * creature an area spell catches) sharp for `duration` seconds, and after that for
 * as long as the action's visuals are still playing. Positions (an area's centre)
 * steer the actor->target capsule only. `radius` is kept for old callers.
 */
export function setCombatActionFocus(actor, target, duration = 0.95, radius = 0) {
  void radius;
  if (!actor) return;
  const hold = Math.max(0.2, duration);
  const list = Array.isArray(target) ? target : [target];
  for (const e of [actor, ...list]) if (isEntity(e)) focusHeld.set(e, Math.max(focusHeld.get(e) || 0, hold));
  const first = list.find(Boolean) || actor;
  capsuleFrom = actor; capsuleTo = first; capsuleUntil = _focusClock + hold;
}

export function clearCombatActionFocus() {
  focusHeld.clear();
  if (typeof focusLastWanted !== 'undefined') focusLastWanted.clear();
  capsuleFrom = capsuleTo = null;
}

if (typeof window !== 'undefined') {
  window.setCombatActionFocus = setCombatActionFocus;
  window.clearCombatActionFocus = clearCombatActionFocus;
  window.resolveCombatTarget = resolveCombatTarget;
}
if (typeof globalThis !== 'undefined') {
  globalThis.setCombatActionFocus = setCombatActionFocus;
  globalThis.clearCombatActionFocus = clearCombatActionFocus;
  globalThis.resolveCombatTarget = resolveCombatTarget;
}

/** The creatures to keep sharp this frame. */
function focusSet() {
  const out = new Set();
  const cur = currentActor(game);
  if (cur && cur.data && cur.data.hp > 0) {
    out.add(cur);
    const t = resolveCombatTarget(game, cur);
    if (t) out.add(t);
  }
  const monsters = (game && game.monsters) || [];
  /* a downed hero is still in play; a dead monster is not */
  for (const e of focusHeld.keys()) if (e && e.data && (e.data.hp > 0 || !monsters.includes(e))) out.add(e);
  return out;
}

/* screen units (height = 1) that `worldR` spans across the view at `p` */
function screenSpanOf(p, worldR) {
  _camRight.set(1, 0, 0).applyQuaternion(cam.quaternion).multiplyScalar(worldR).add(p);
  _projA.copy(p).project(cam);
  _projB.copy(_camRight).project(cam);
  return Math.abs(_projB.x - _projA.x) * 0.5 * (cam.right - cam.left) / Math.max(0.0001, cam.top - cam.bottom);
}

function updateCombatFocus(dt) {
  _focusClock += dt;
  const inCombat = !!(game && game.initiative && game.initiative.active);

  /* an action's hold counts down; the visuals it started keep it until they end */
  const busy = fxVisualBusy();
  for (const [e, t] of focusHeld) {
    const left = t - dt;
    if (left > 0 || busy) focusHeld.set(e, Math.max(0, left));
    else focusHeld.delete(e);
  }
  if (!inCombat) clearCombatActionFocus();

  /* snap in fast as a fight starts, ease out slowly after it */
  const want = inCombat ? 1 : 0;
  const rate = want > combatFocusCur ? 10.0 : 2.5;
  combatFocusCur += (want - combatFocusCur) * Math.min(1.0, dt * rate);

  /* the capsule: actor -> first target of the last action, or the acting creature on its own */
  const cur = inCombat ? currentActor(game) : null;
  const holdCapsule = capsuleFrom && (_focusClock < capsuleUntil || busy);
  const from = holdCapsule ? capsuleFrom : cur;
  const to = holdCapsule ? capsuleTo : (cur ? resolveCombatTarget(game, cur) || cur : null);
  const pA = getPosVector(from, _focusPosA);
  const pB = getPosVector(to, _focusPosB) || pA;
  if (pA) focusWorldA.lerp(pA, focusWorldA.lengthSq() < 0.001 ? 1 : Math.min(1.0, dt * 16.0));
  if (pB) focusWorldB.lerp(pB, focusWorldB.lengthSq() < 0.001 ? 1 : Math.min(1.0, dt * 16.0));

  if (cam) {
    _projA.copy(focusWorldA).project(cam);
    focusScreenA.set(_projA.x * 0.5 + 0.5, _projA.y * 0.5 + 0.5);
    _projB.copy(focusWorldB).project(cam);
    focusScreenB.set(_projB.x * 0.5 + 0.5, _projB.y * 0.5 + 0.5);
    focusCapsuleRadius = pA ? screenSpanOf(focusWorldA, FOCUS_CAPSULE_WORLD) : 0;

    /* the explore band follows the party on screen, and fades as the camera pulls out */
    const alive = (game && game.heroes || []).filter((h) => h && h.data && h.data.hp > 0);
    if (alive.length) {
      let sy = 0;
      for (const h of alive) {
        getPosVector(h, _focusPosA);
        sy += _focusPosA.project(cam).y;
      }
      const y = (sy / alive.length) * 0.5 + 0.5;
      exploreBandY += (y - exploreBandY) * Math.min(1, dt * 4);
    }
    exploreFade = Math.min(1, Math.max(0, (cam.zoom - 0.45) / 0.55));
  }
}

/* ── the focus mask: the focus set's bodies, drawn white on black ── */
/* A creature joining the focus is sharp at once; one leaving LINGERS, then fades
   out of focus. The hand-off is never a jump: whatever takes the focus is already
   sharp before the old one softens (a turn passing used to swap them in a frame). */
export const FOCUS_LINGER = 0.6;          // seconds still fully sharp after leaving the focus set
export const FOCUS_FADE = 0.5;            // then softens over this long
const focusLastWanted = new Map();        // entity -> _focusClock when it was last in the focus set

/** Each body's focus weight this frame (1 = sharp): in the set now, or lingering / fading after. */
export function focusWeights(wanted, now, last = focusLastWanted) {
  for (const e of wanted) last.set(e, now);
  const out = [];
  for (const [e, t] of last) {
    const age = now - t;
    const w = age <= FOCUS_LINGER ? 1 : 1 - Math.min(1, (age - FOCUS_LINGER) / FOCUS_FADE);
    if (w <= 0) { last.delete(e); continue; }
    out.push({ e, w: w * w * (3 - 2 * w) });   // smoothstep: the fade eases out rather than ramping
  }
  return out;
}
const focusMaskScene = new THREE.Scene();
const _maskProxies = [];
function maskProxy(i) {
  if (_maskProxies[i]) return _maskProxies[i];
  const mat = new THREE.SpriteMaterial({ transparent: false, depthTest: false, depthWrite: false, alphaTest: 0.25 });
  /* drawn at its focus weight: a lingering focus fades in the mask, not just in time */
  mat.userData.w = { value: 1.0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uFocusW = mat.userData.w;
    sh.fragmentShader = sh.fragmentShader
      .replace('uniform float opacity;', 'uniform float opacity;\nuniform float uFocusW;')
      .replace('outgoingLight = diffuseColor.rgb;', 'outgoingLight = vec3(uFocusW);');
  };
  mat.customProgramCacheKey = () => 'focusMaskSprite';
  const s = new THREE.Sprite(mat);
  s.matrixAutoUpdate = false;
  s.frustumCulled = false;
  focusMaskScene.add(s);
  _maskProxies[i] = s;
  return s;
}
const _visibleInWorld = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };

/* ── the combat room: kept sharp as a whole ──
   Zenu: focusing on just the acting creature didn't read well, so the whole
   room the fight is in is drawn into the focus mask; only what lies outside it
   blurs. The room is game.combatRoomId (the leader's room when the fight began)
   plus a one-tile ring for its walls and doorways, and a disc round every live
   combatant so a fight that spills into a corridor stays sharp where it is. With
   no room at all (corridor, open overland) the discs are wider. Each cell is a
   tall box, so creatures and walls standing in it are covered on screen too. */
export const COMBAT_AREA_RING = 1;          // tiles of wall / doorway kept round the room
export const COMBAT_AREA_DISC = 2;          // tiles round each combatant, with a room
export const COMBAT_AREA_DISC_NO_ROOM = 5;  // ... and without one
const COMBAT_AREA_MAX = 6000;
const COMBAT_AREA_BOX_H = 3.2;

/** Cells to keep sharp for a fight in room `rid` with combatants at `cells` (grid indices). */
export function combatAreaCells(d, rid, combatantCells) {
  if (!d || !d.W || !d.H) return [];
  const W = d.W, H = d.H, set = new Set();
  const addDisc = (c, r) => {
    const cx = c % W, cy = (c / W) | 0;
    for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++)
      for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++)
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r + r) set.add(y * W + x);
  };
  const hasRoom = rid != null && rid >= 0 && d.roomId;
  if (hasRoom) {
    for (let c = 0; c < W * H; c++) {
      if (d.roomId[c] !== rid) continue;
      const cx = c % W, cy = (c / W) | 0;
      for (let y = Math.max(0, cy - COMBAT_AREA_RING); y <= Math.min(H - 1, cy + COMBAT_AREA_RING); y++)
        for (let x = Math.max(0, cx - COMBAT_AREA_RING); x <= Math.min(W - 1, cx + COMBAT_AREA_RING); x++) set.add(y * W + x);
    }
  }
  const r = hasRoom ? COMBAT_AREA_DISC : COMBAT_AREA_DISC_NO_ROOM;
  for (const c of combatantCells || []) if (c >= 0) addDisc(c, r);
  return [...set];
}

let _areaMesh = null, _areaKey = '';
const _areaM = new THREE.Matrix4();
function combatAreaMesh() {
  if (_areaMesh) return _areaMesh;
  const geo = new THREE.BoxGeometry(1.02, COMBAT_AREA_BOX_H, 1.02);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, toneMapped: false });
  _areaMesh = new THREE.InstancedMesh(geo, mat, COMBAT_AREA_MAX);
  _areaMesh.frustumCulled = false;
  _areaMesh.renderOrder = -1;
  _areaMesh.count = 0;
  _areaMesh.visible = false;
  focusMaskScene.add(_areaMesh);
  return _areaMesh;
}

/** Keep the combat area's boxes current. True while there is an area to keep sharp. */
function updateCombatArea() {
  const mesh = combatAreaMesh();
  const inCombat = !!(game && game.initiative && game.initiative.active);
  if (combatFocusCur <= 0.01 || !D) { mesh.visible = false; _areaKey = ''; return false; }
  /* after the fight the last area stays while the combat look eases out */
  if (!inCombat) return mesh.visible && mesh.count > 0;
  const rid = game.combatRoomId;
  const combatants = [];
  for (const e of (game.initiative.order || [])) {
    if (!e || !e.data || e.data.hp <= 0 || e.x == null) continue;
    combatants.push(typeof game.cellOf === 'function' ? game.cellOf(e.x, e.z) : -1);
  }
  const key = `${D.W}x${D.H}|${rid}|${combatants.join(',')}`;
  if (key !== _areaKey) {
    _areaKey = key;
    const cells = combatAreaCells(D, rid, combatants);
    const n = Math.min(cells.length, COMBAT_AREA_MAX);
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      const x = (c % D.W) - D.W / 2 + 0.5, z = ((c / D.W) | 0) - D.H / 2 + 0.5;
      const gy = typeof groundY === 'function' ? groundY(D, x, z) : 0;
      _areaM.makeTranslation(x, gy + COMBAT_AREA_BOX_H / 2 - 0.2, z);
      mesh.setMatrixAt(i, _areaM);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }
  mesh.visible = mesh.count > 0;
  return mesh.visible;
}

/** Draw the focus set's silhouettes into POST.rtFocus and soften them. Returns false when nothing is in focus. */
function renderFocusMask() {
  const bodies = [];
  if (combatFocusCur > 0.01) {
    for (const { e, w } of focusWeights(focusSet(), _focusClock)) {
      const v = e.ent || e;
      const mesh = v && v.anim && v.anim.mesh;
      if (mesh && mesh.isSprite && mesh.material && mesh.material.map && _visibleInWorld(mesh)) bodies.push({ mesh, w });
    }
  } else {
    focusLastWanted.clear();
  }
  /* full-strength bodies last, so an overlapping fading one never dims them */
  bodies.sort((a, b) => a.w - b.w);
  let i = 0;
  for (const { mesh, w } of bodies) {
    const p = maskProxy(i);
    p.renderOrder = i++;
    p.material.userData.w.value = w;
    p.visible = true;
    p.matrix.copy(mesh.matrixWorld);
    p.matrixWorld.copy(mesh.matrixWorld);
    p.center.copy(mesh.center);
    p.material.map = mesh.material.map;
    p.material.rotation = mesh.material.rotation || 0;
  }
  for (; i < _maskProxies.length; i++) _maskProxies[i].visible = false;
  const area = updateCombatArea();
  renderer.setClearColor(0x000000, 1);
  renderer.setRenderTarget(POST.rtFocus);
  renderer.clear();
  if (!bodies.length && !area) return false;
  renderer.render(focusMaskScene, cam);
  /* two blur passes there and back: a soft halo round each body, so the edge of focus never shows */
  POST.blur.uniforms.uRes.value.set(POST.w >> 2, POST.h >> 2);
  for (let k = 0; k < 2; k++) {
    POST.blur.uniforms.tS.value = POST.rtFocus.texture; POST.blur.uniforms.uDir.value.set(1, 0);
    renderer.setRenderTarget(POST.rtFocusB); renderer.render(POST.sBlur, POST.qcam);
    POST.blur.uniforms.tS.value = POST.rtFocusB.texture; POST.blur.uniforms.uDir.value.set(0, 1);
    renderer.setRenderTarget(POST.rtFocus); renderer.render(POST.sBlur, POST.qcam);
  }
  return true;
}

export function renderFrame(dt = 0.016) {
  if (!renderer) return;
  if (!POST.enabled) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(curBg);
    renderer.setRenderTarget(null);
    renderer.render(scene, cam);
    return;
  }
  setupRTs();
  renderer.setClearColor(_cBg.copy(curBg).convertSRGBToLinear());
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setRenderTarget(POST.rtScene); renderer.render(scene, cam);
  POST.thresh.uniforms.tS.value = POST.rtScene.texture;
  renderer.setRenderTarget(POST.rtA); renderer.render(POST.sThresh, POST.qcam);
  POST.blur.uniforms.uRes.value.set(POST.w >> 2, POST.h >> 2);
  POST.blur.uniforms.tS.value = POST.rtA.texture; POST.blur.uniforms.uDir.value.set(1, 0);
  renderer.setRenderTarget(POST.rtB); renderer.render(POST.sBlur, POST.qcam);
  POST.blur.uniforms.tS.value = POST.rtB.texture; POST.blur.uniforms.uDir.value.set(0, 1);
  renderer.setRenderTarget(POST.rtA); renderer.render(POST.sBlur, POST.qcam);

  updateCombatFocus(dt);
  const masked = renderFocusMask();
  POST.fin.uniforms.tS.value = POST.rtScene.texture;
  POST.fin.uniforms.tB.value = POST.rtA.texture;
  POST.fin.uniforms.tFocus.value = POST.rtFocus.texture;
  POST.fin.uniforms.uMaskOn.value = masked ? 1.0 : 0.0;
  POST.fin.uniforms.uRes.value.set(POST.w, POST.h);
  POST.fin.uniforms.uTime.value = elapsed;
  /* combat focus only while something is in it: with nobody focused it would blur the whole screen */
  focusPresence += ((masked ? 1 : 0) - focusPresence) * Math.min(1, dt * 10);
  POST.fin.uniforms.uCombatFocus.value = combatFocusCur * focusPresence;
  POST.fin.uniforms.uFocusA.value.copy(focusScreenA);
  POST.fin.uniforms.uFocusB.value.copy(focusScreenB);
  POST.fin.uniforms.uFocusRadius.value = focusCapsuleRadius;
  POST.fin.uniforms.uBandY.value = exploreBandY;
  POST.fin.uniforms.uExploreFade.value = exploreFade;
  /* Manual combat: the player is reading the whole field to plan, so the blur eases out
     entirely while it lasts (and back in when it ends or auto takes over). */
  const manualFight = !!(game && game.controlMode === 'manual' && game.initiative && game.initiative.active);
  manualSharp += ((manualFight ? 1 : 0) - manualSharp) * Math.min(1, dt * 6);
  POST.fin.uniforms.uTilt.value = dofStrength * (1 - manualSharp);

  if (sunOffset && cam) {
    const _sunView = _p.copy(sunOffset).transformDirection(cam.matrixWorldInverse);
    const sx = _sunView.x;
    const sy = Math.max(0.20, _sunView.y); // Sunlight always comes from above/horizon
    const sunLen = Math.hypot(sx, sy) || 1.0;
    const sunDirX = sx / sunLen;
    const sunDirY = sy / sunLen;
    if (POST.fin.uniforms.uSunDir) {
      POST.fin.uniforms.uSunDir.value.set(sunDirX, sunDirY);
    }
    // Place virtual sun origin 14 screen-units away along the sun vector, so the hub is never visible
    const sunDist = 14.0;
    POST.fin.uniforms.uSunScreen.value.set(0.5 + sunDirX * sunDist, 0.45 + sunDirY * sunDist);
  }
  const isOverland = D && (D.overland || (THEMES[D.params?.themeKey || D.themeKey] && THEMES[D.params?.themeKey || D.themeKey].overland));
  // Smoothly fade out god rays when zoomed all the way out into map overview mode
  const currentZoom = cam ? cam.zoom : DEFAULT_CAM_ZOOM;
  const zoomFade = Math.min(1.0, Math.max(0.0, (currentZoom - 1.8) / 2.0));
  POST.fin.uniforms.uGodRayIntensity.value = (isOverland ? 0.35 : 0.0) * zoomFade;
  const curTh = (D && THEMES[D.params?.themeKey || D.themeKey]) || THEMES.forest;
  if (curTh && curTh.dir && POST.fin.uniforms.uGodRayColor) {
    POST.fin.uniforms.uGodRayColor.value.set(curTh.dir[0]);
  }

  renderer.setRenderTarget(null); renderer.render(POST.sFinal, POST.qcam);
}

const timer = new THREE.Timer();
let fpsFrames = 0, fpsTime = 0;

export function tick() {
  if (!renderer) return;
  if (document.hidden) setTimeout(tick, 100);
  else requestAnimationFrame(tick);
  timer.update();
  const rawDt = Math.min(timer.getDelta(), 0.05);
  elapsed += rawDt;
  /* an exploring look-around eases back to the director's low angle once the player lets go */
  if (camMode === 'explore' && elapsed - _exploreOrbitAt > EXPLORE_PITCH_RETURN && explorePitch !== DEFAULT_EXPLORE_PITCH) {
    explorePitch += (DEFAULT_EXPLORE_PITCH - explorePitch) * Math.min(1, rawDt * 0.9);
    if (Math.abs(explorePitch - DEFAULT_EXPLORE_PITCH) < 0.002) explorePitch = DEFAULT_EXPLORE_PITCH;
  }

  if (Math.abs(gameTimeScale - 1.0) > 0.001) {
    gameTimeScale += (1.0 - gameTimeScale) * Math.min(1, rawDt * 10);
    if (Math.abs(gameTimeScale - 1.0) < 0.002) gameTimeScale = 1.0;
  }
  if (shakeIntensity > 0.001) {
    shakeIntensity *= Math.exp(-rawDt * 8);
    if (shakeIntensity < 0.002) shakeIntensity = 0;
  }

  const gameDt = rawDt * gameTimeScale;
  if (animating) {
    animT += rawDt;
    writeInstancesAll(animT);
    if (animT > animEnd + 0.35) finishAnim();
  }
  liveUpdate(elapsed, animating ? animT - 2.3 : Infinity, rawDt);
  if (game && typeof game.update === 'function') {
    game.update(gameDt, elapsed);
  }
  renderer.info.reset();
  /* sim/real balance runs step the game faster than real time; nobody is
     watching, so the frame is not drawn. Nor is it behind the loading
     curtain: the first frame of a new floor compiled every shader
     synchronously there and froze the curtain (preloadFloorAssets compiles
     them asynchronously instead). Drawing resumes as the curtain leaves. */
  if (!SIM.fast && !loadingCurtainCovers()) renderFrame(rawDt);
  tickPerfOverlay(rawDt, { renderer, scene, game });
  fpsFrames++; fpsTime += rawDt;
  if (fpsTime >= 0.5) {
    const elFps = document.getElementById('sFps');
    const elCalls = document.getElementById('sCalls');
    const elTris = document.getElementById('sTris');
    if (elFps) elFps.textContent = Math.round(fpsFrames / fpsTime);
    if (elCalls) elCalls.textContent = renderer.info.render.calls;
    if (elTris) {
      const tr = renderer.info.render.triangles;
      elTris.textContent = tr > 1e6 ? (tr / 1e6).toFixed(2) + 'M' : Math.round(tr / 1e3) + 'k';
    }
    fpsFrames = 0; fpsTime = 0;
  }
}
