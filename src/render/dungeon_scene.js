/**
 * DUNGEON FORGE — WebGL Scene, Camera, Instanced Rendering & Render Loop.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { game } from '../game/game.js';
import { getSetting, onSettingsChange } from '../game/settings.js';
import { tickPerfOverlay, setPerfOverlay, perfOverlayOn, applyUiScale } from '../ui/perf_overlay.js';
import { THEMES, SPAWN_THEMES, DOORWAY_THEMES, THEME_KEYS, VOID, FLOOR, WALL, POOL, TYPE, TINT, makeRng } from '../dungeon/dungeon_generator.js';
import { STEP as ELEV_STEP, groundY } from '../dungeon/elevation.js';
import { SPELLS } from '../game/spells.js';
import { attackPreview, attackPreviewText, movePreview, threatZone } from '../game/tactical_preview.js';
import { GEO, boxUV, bgFromTris, chamferBox, spireGeo, xg, mergeGeos } from './dungeon_geo.js';
import CUSTOM_PROPS from '../game/custom_props.json' with { type: 'json' };
import {
  TEX, matStone, matWood, matMetal, matCeramic, matRug, matMagicCircle,
  matTapestry, matSconce, matGoldInlay, matGoldBullion, matSwampGrass, matNecroCircle, matSporeCircle,
  matCampRing, matRegimentalBanner, matBoneStone, matBiolum, matGlacialIce,
  matFloor, matWall, matWallCap, matTrim, matGlow, matCloth, matIce, matMoss, matBark,
  matGrass, matLeaf, matCrackD, matRune, matPortal, matShaft, matSkirt,
  matRuneSeal, matEmber, matBlot, matBlotAdd, matWeb, liquidMat, partMat, fogPlaneMat, POST,
  applyTileTheme
} from './dungeon_materials.js';
import { initNixieVfx, updateNixieVfx, clearPersistentNixieEffects, registerPersistentNixieEffect, stopPersistentNixieEffectsNear } from './nixie_vfx.js';
import { initAmbientFX, updateAmbientFX, clearAmbientFX, triggerLiquidSplashFX } from './ambient_fx.js';

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
    tent: 'tent.opt.glb'
  },
  Forest: {
    tree: 'tree.opt.glb',
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
  Grim: { tombstone: 'Tombstone.opt.glb' },
  Molten: { anvil: 'Anvil.opt.glb' },
  frost: { icebone: 'icebone.opt.glb', snowtree: 'snowtree.opt.glb', tree_winter: 'snowtree.opt.glb' },
  Verdant: {
    fren1: 'fren1.opt.glb', fren2: 'fren2.opt.glb', fren3: 'fren3.opt.glb', fren4: 'fren4.opt.glb',
    mushroomA: 'mushroom.opt.glb', mushroomB: 'mushroom2.opt.glb', rootsA: 'roots1.opt.glb', rootsB: 'roots2.opt.glb'
  },
  Moor: {
    swamptree: 'swamptree.opt.glb',
    bush: 'bush.opt.glb', signpost: 'signpost.opt.glb',
    brokenSignpost: '389570cd4af64ded8622428ce71e2991.opt.glb', wheel: 'wheel.opt.glb'
  },
  Mire: {
    deadtree: 'deadtree.opt.glb'
  }
};
/* per-asset visual scale multiplier — these models are all normalized to fill
   one tile on import, but their real-world proportions differ, so the single-
   tile default reads wrong for several of them */
const PROP_SCALE_MULTIPLIER = {
  tree: 1.8,
  tree_winter: 1.8,
  snowtree: 1.8,
  swamptree: 1.8,
  deadtree: 1.8,
  mushroomLog: 1.25,
  coffin: 1.5, pillarA: 1.3, pillarB: 1.3, vase: 0.42,
  lectern: 0.95, grainjars: 0.9, scrollshelf: 1.15,
  cage: 1.35, cage2: 1.3, throne: 1.45,
  chest: 1.15, barrel: 0.48, crate: 0.50, weaponRack: 1.25,
  anvil: 0.75, tombstone: 0.38, icebone: 1.1,
  fren1: 0.9, fren2: 0.9, fren3: 0.9, fren4: 0.9,
  mushroomA: 1.2, mushroomB: 1.2, rootsA: 1.3, rootsB: 1.3,
  stump: 1.2, vinemound: 1.2, cairn: 1.1, rocks: 1.1, skulltotem: 1.3,
  goblinfire: 0.85, rack: 0.9, stakes: 1,
  bush: 1.1, signpost: 1.05, brokenSignpost: 1, wheel: 0.9,
  swampgrass: 0.45, swampgrass2: 0.42, swampgrass3: 0.46
};
const propAssets = {};
/* animation clips shipped inside a prop GLB (only the chest has one so far) */
const propClips = {};
/* placed chest instances + the mixers driving any lids currently swinging open */
let chestInstances = [];
let chestMixers = [];
const propBaseOffset = {};

/** Load a GLB and make it available to prop scatter under `key`.
 *  Used for the shipped biome props, for custom_props.json, and live by the
 *  dungeon editor when a model is imported. Resolves once the model is ready
 *  so a caller can re-forge and actually see it. */
export function registerProp(key, url, scaleMult, retries = 2){
  if(scaleMult) PROP_SCALE_MULTIPLIER[key] = scaleMult;
  return new Promise((resolve, reject) => {
    propLoader.load(url, gltf => {
      gltf.scene.traverse(o => {
        if (o.isMesh && o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const mat of mats) {
            // Raw AI models ship with KHR_materials_specular [2,2,2] and ~0.06 roughness,
            // creating harsh, mirror-like specular highlights that appear as glowing light sources.
            // Normalize to realistic dungeon matte roughness and specular:
            if (mat.roughness !== undefined && mat.roughness < 0.8) {
              mat.roughness = 0.88;
            }
            if (mat.metalness !== undefined && mat.metalness > 0.1) {
              if (key !== 'cage' && key !== 'cage2' && key !== 'weaponRack' && key !== 'anvil') {
                mat.metalness = 0.0;
              } else {
                mat.metalness = Math.min(mat.metalness, 0.25);
              }
            }
            if (mat.specularColor) {
              mat.specularColor.setRGB(0.15, 0.15, 0.15);
            }
            if (mat.specularIntensity !== undefined) {
              mat.specularIntensity = 0.15;
            }
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
              mat.roughness = 0.90;
              mat.metalness = 0.0;
            }
          }
        }
      });
      propAssets[key] = gltf.scene;
      if (gltf.animations && gltf.animations.length) propClips[key] = gltf.animations;
      propBaseOffset[key] = -new THREE.Box3().setFromObject(gltf.scene).min.y;
      resolve(key);
    }, undefined, err => {
      // If request was aborted (e.g. page navigation, reload, HMR), ignore silently
      const isAbort = err && (err.name === 'AbortError' || String(err).includes('aborted') || String(err).includes('ReadableStream'));
      if(isAbort){
        resolve(null);
        return;
      }
      if(retries > 0){
        setTimeout(() => {
          registerProp(key, url, scaleMult, retries - 1).then(resolve).catch(reject);
        }, 350);
        return;
      }
      console.warn(`prop load failed: ${key}`, err);
      reject(err);
    });
  });
}
export function registeredProps(){ return Object.keys(propAssets); }

const loadedBiomes = new Set();

/** Load only the 3D models required by the current theme/biome. */
export function preloadBiomeProps(biomeKey){
  if(!biomeKey) return Promise.resolve();
  const folder = Object.keys(BIOME_PROP_FILES).find(k => k.toLowerCase() === biomeKey.toLowerCase())
    || (biomeKey.toLowerCase() === 'holdfast' ? 'Forest' : null);
  const promises = [];
  if(folder && !loadedBiomes.has(folder)){
    loadedBiomes.add(folder);
    for(const [key, file] of Object.entries(BIOME_PROP_FILES[folder])){
      if(!propAssets[key]){
        promises.push(registerProp(key, `./3d/${folder}/${file}`).catch(() => {}));
      }
    }
  }
  if(!loadedBiomes.has('generic') && BIOME_PROP_FILES.generic){
    loadedBiomes.add('generic');
    for(const [key, file] of Object.entries(BIOME_PROP_FILES.generic)){
      if(!propAssets[key]){
        promises.push(registerProp(key, `./3d/generic/${file}`).catch(() => {}));
      }
    }
  }
  return Promise.all(promises);
}

// Background idle preload of remaining biomes after page startup
if(typeof window !== 'undefined'){
  const bgPreload = () => {
    for(const folder in BIOME_PROP_FILES){
      if(!loadedBiomes.has(folder)){
        preloadBiomeProps(folder);
      }
    }
    for(const [key, def] of Object.entries(CUSTOM_PROPS || {})){
      if(def && def.url && !propAssets[key]) registerProp(key, def.url, def.scale).catch(() => {});
    }
  };
  if(typeof window.requestIdleCallback === 'function'){
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
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;
  document.body.appendChild(renderer.domElement);
  maxAniso = renderer.capabilities.getMaxAnisotropy();
}

export const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(canvasBg, 0.0032);
let curBg = new THREE.Color(canvasBg);
const _cBg = new THREE.Color();

export const BASE_HALF = 55;
export const MIN_CAM_ZOOM = 1.0;
export const MAX_CAM_ZOOM = 14.0;
export const DEFAULT_CAM_ZOOM = 9.67; // 2/3 between 1.0 (min) and 14.0 (max)
let aspect = innerWidth/innerHeight;
export const cam = new THREE.OrthographicCamera(-BASE_HALF*aspect, BASE_HALF*aspect, BASE_HALF, -BASE_HALF, -400, 800);
cam.zoom = DEFAULT_CAM_ZOOM;
cam.updateProjectionMatrix();
export let yaw = Math.PI/4, pitch = 0.64;

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

/** Set the zoom the director is driving. Does NOT move `userZoom`. */
export function setCamZoom(z) {
  cam.zoom = Math.min(MAX_CAM_ZOOM, Math.max(MIN_CAM_ZOOM, z));
  cam.updateProjectionMatrix();
}

/** Set the zoom AND adopt it as the player's resting choice. */
export function setUserZoom(z) {
  setCamZoom(z);
  userZoom = cam.zoom;
}

export let elapsed = 0;
export let gameTimeScale = 1.0;
export let shakeIntensity = 0;
export const camTarget = new THREE.Vector3(0,0,0);

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

export function updateCam(){
  const cp=Math.cos(pitch), sp=Math.sin(pitch);
  const f = new THREE.Vector3(cp*Math.sin(yaw), sp, cp*Math.cos(yaw));
  cam.position.copy(camTarget).addScaledVector(f, 220);
  if (shakeIntensity > 0.001) {
    const t = elapsed * 60;
    cam.position.x += Math.sin(t * 1.7) * Math.cos(t * 0.9) * shakeIntensity * 0.8;
    cam.position.z += Math.cos(t * 1.3) * Math.sin(t * 1.1) * shakeIntensity * 0.8;
  }
  cam.lookAt(camTarget);
}
updateCam();

const LIGHT_K = 4 * Math.PI;

/* Torch pool intensity multiplier & range balanced between original bright and dimmed values */
const TORCH_I_K = 1.5 / 1.5, TORCH_R_K = 16 / 9.5;
const torchPoolIntensity = TH => ((TH && TH.torchLight && TH.torchLight[1]) ?? 1.5) * TORCH_I_K;
const torchPoolRange     = TH => ((TH && TH.torchLight && TH.torchLight[2]) ?? 9.5) * TORCH_R_K;

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
  low:    { pixelRatio: 1.0,  shadow: 512,  post: false, bloom: 0.0, torchPool: 6,  keyBudget: 8  },
  medium: { pixelRatio: 1.25, shadow: 1024, post: true,  bloom: 0.6, torchPool: 10, keyBudget: 12 },
  high:   { pixelRatio: 1.6,  shadow: 2048, post: true,  bloom: 0.9, torchPool: 16, keyBudget: 18 }
};
export function currentQuality(){
  const q = getSetting('graphicsQuality');
  return QUALITY[q] ? q : 'high';
}
export function qualityProfile(){ return QUALITY[currentQuality()]; }

function applyQuality(){
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
function applyComfort(){
  const grain = getSetting('filmGrain') !== false;
  POST.fin.uniforms.uGrain.value = grain ? 1.0 : 0.0;
  POST.fin.uniforms.uTilt.value = grain ? 1.0 : 0.0;
}
if (typeof window !== 'undefined') {
  applyQuality();
  setPerfOverlay(!!getSetting('perfOverlay'));
  applyUiScale(getSetting('uiScale'));
  onSettingsChange((key) => {
    if (key === null || key === 'graphicsQuality') applyQuality();
    if (key === null || key === 'filmGrain') applyComfort();
    if (key === null || key === 'perfOverlay') setPerfOverlay(!!getSetting('perfOverlay'));
    if (key === null || key === 'uiScale') applyUiScale(getSetting('uiScale'));
  });
}
dirL.shadow.bias = -0.0004;
dirL.shadow.normalBias = 0.55;
dirL.shadow.camera.near = 1;
dirL.shadow.camera.far = 320;
scene.add(dirL);

export let heroLight = null;

const _p=new THREE.Vector3(), _q=new THREE.Quaternion(), _s=new THREE.Vector3(),
      _m=new THREE.Matrix4(), _c=new THREE.Color(), _Y=new THREE.Vector3(0,1,0),
      _E=new THREE.Euler();

/* -------- camera & pointer interaction controls -------- */
if(renderer && renderer.domElement){
  const cnv = renderer.domElement;
  let dragging=false, orbiting=false, lastX=0, lastY=0, downX=0, downY=0;
  cnv.addEventListener('pointerdown', e=>{
    orbiting = e.button===2 || (e.button===0 && e.shiftKey);
    dragging = e.button===0 && !e.shiftKey;
    lastX = e.clientX; lastY = e.clientY;
    downX = e.clientX; downY = e.clientY;
    cnv.setPointerCapture(e.pointerId);
    if ((orbiting || dragging) && game && game.notifyUserPan) game.notifyUserPan();
  });
  const _clickNdc = new THREE.Vector2();
  const _clickRay = new THREE.Raycaster();
  const _clickPlane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
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
      const tCell = (game.cellOf && game.D) ? game.cellOf(tgx, tgz) : -1;
      const tgtMonster = (game.monsters || []).find(m => m.active && m.data && m.data.hp > 0
        && ((tCell >= 0 && game.cellOf(m.x, m.z) === tCell) || Math.hypot(m.x - tgx, m.z - tgz) < 0.6));
      const tgtHero = ts.isAlly ? (game.heroes || []).find(h => h.data && h.data.hp > 0
        && ((tCell >= 0 && game.cellOf(h.x, h.z) === tCell) || Math.hypot(h.x - tgx, h.z - tgz) < 0.6)) : null;
      const targetUnit = tgtHero || tgtMonster;

      if (targetUnit) {
        _hoverMarkerGroup.visible = true;
        _hoverMarkerGroup.position.set(targetUnit.x, 0.04, targetUnit.z);
        _hoverTileMat.color.setHex(tgtHero ? 0x4ade4a : 0xffaa30);
        _hoverBorderMat.color.setHex(tgtHero ? 0xaaffaa : 0xffe0a0);
        if (tooltip) {
          const dart = ts.isMultiTarget ? ` (Dart ${(ts.assignedTargets?.length || 0) + 1}/${ts.totalDarts})` : '';
          tooltip.style.display = 'block';
          tooltip.style.left = `${e.clientX}px`;
          tooltip.style.top = `${e.clientY}px`;
          tooltip.textContent = `🎯 ${ts.isAlly ? 'Heal/Buff' : 'Target'} ${targetUnit.data.name}${dart}`;
        }
      } else {
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
        const tgx = _clickPt.x, tgz = _clickPt.z;
        const tCell = (game.cellOf && game.D) ? game.cellOf(tgx, tgz) : -1;
        const tgt = (game.monsters || []).find(m => m.active && m.data && m.data.hp > 0
          && ((tCell >= 0 && game.cellOf(m.x, m.z) === tCell) || Math.hypot(m.x - tgx, m.z - tgz) < 0.6));
        if (tgt) {
          _hoverMarkerGroup.visible = true;
          _hoverMarkerGroup.position.set(tgt.x, 0.04, tgt.z);
          _hoverTileMat.color.setHex(0xff3344);
          _hoverBorderMat.color.setHex(0xffaaaa);
          if (tooltip) {
            tooltip.style.display = 'block';
            tooltip.style.left = `${e.clientX}px`;
            tooltip.style.top = `${e.clientY}px`;
            const odds = attackPreviewText(attackPreview(game, at.hero, tgt, prof));
            tooltip.textContent = `${ranged ? '🎯 Throw at' : '⚔️ Attack'} ${tgt.data.name}${odds ? '\n' + odds : ''}`;
          }
        } else {
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
      return;
    }
    refreshThreatZone(cur);

    if (_clickRay.ray.intersectPlane(_clickPlane, _clickPt)) {
      const gx = _clickPt.x, gz = _clickPt.z;
      /* Grid-based monster hit-test: only show the attack reticle when the
         cursor is actually on the monster's tile (or very close to its
         centre), so adjacent floor tiles remain usable for movement. Must
         match the click resolver in explore.js commandMove. */
      const rawCell = (game.cellOf && game.D) ? game.cellOf(gx, gz) : -1;
      const clickedMonster = (game.monsters || []).find(m => m.active && m.data && m.data.hp > 0
        && ((rawCell >= 0 && game.cellOf(m.x, m.z) === rawCell) || Math.hypot(m.x - gx, m.z - gz) < 0.6));

      if (clickedMonster && !cur.actUsed) {
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
          tooltip.textContent = odds ? `${modeText}\n${odds}` : modeText;
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
            const rawPath = game.findPath ? game.findPath(curCell, cell, { mover: cur }) : null;
            if (rawPath && rawPath.length >= 2) {
              const fullSteps = rawPath.length - 1;
              pathDistFt = fullSteps * 5;
              inBudget = fullSteps <= moveLeft;
              const maxSteps = Math.min(moveLeft, fullSteps);
              const actualPath = rawPath.slice(0, maxSteps + 1);
              const costFt = maxSteps * 5;
              game.updatePathVisual(actualPath, costFt);
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
          tooltip.textContent = (inBudget ? `🦶 Move ${pathDistFt} ft` : `⚠️ Beyond Movement (${pathDistFt} ft / ${moveLeftFt} ft max)`) + provokeText;
        }
      }
    }
  };

  window.addEventListener('pointermove', updatePointerTargeting);

  cnv.addEventListener('pointermove', e=>{
    updatePointerTargeting(e);
    if(!dragging && !orbiting) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if(orbiting){
      yaw -= dx*0.005;
      pitch = Math.min(1.15, Math.max(0.32, pitch + dy*0.005));
      userPitch = pitch;
    } else {
      const wpp = (2*BASE_HALF/cam.zoom)/cnv.clientHeight;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      camTarget.x += (-dx*fz - dy*fx)*wpp;
      camTarget.z += ( dx*fx - dy*fz)*wpp;
    }
    if(game && game.notifyUserPan) game.notifyUserPan();
    updateCam();
  });
  const endDrag = ()=>{ dragging=false; orbiting=false; };
  cnv.addEventListener('pointerup', e=>{
    const wasClick = e.button===0 && !e.shiftKey &&
      Math.hypot(e.clientX-downX, e.clientY-downY) < 6;
    endDrag();
    if(!wasClick) return;
    const r = cnv.getBoundingClientRect();
    _clickNdc.set(((e.clientX-r.left)/r.width)*2-1, -((e.clientY-r.top)/r.height)*2+1);
    _clickRay.setFromCamera(_clickNdc, cam);
    if(_clickRay.ray.intersectPlane(_clickPlane, _clickPt)){
      if(game && game.commandMove) game.commandMove(_clickPt.x, _clickPt.z);
    }
  });
  cnv.addEventListener('pointercancel', endDrag);
  cnv.addEventListener('contextmenu', e=>e.preventDefault());
  cnv.addEventListener('wheel', e=>{
    e.preventDefault();
    /* Orthographic zoom: higher = closer. The visible half-height is
       BASE_HALF/zoom, so the min clamp caps how far out you can pull. */
    setUserZoom(cam.zoom*Math.exp(-e.deltaY*0.0012));
    /* Zooming is camera input just as much as panning is. Before, only a drag
       held the director off, so a player who zoomed out to survey a fight had
       the framing yanked back on the very next frame. */
    if(game && game.notifyUserPan) game.notifyUserPan();
  }, {passive:false});
}

export function instSet(){
  return { px:[],py:[],pz:[], sx:[],sy:[],sz:[], rx:[],ry:[],rz:[], col:[], delay:[], roomIds:[], n:0,
    add(x,y,z, sx,sy,sz, ry, color, delay, roomId){
      this.px.push(x); this.py.push(y); this.pz.push(z);
      this.sx.push(sx); this.sy.push(sy); this.sz.push(sz);
      this.rx.push(0); this.ry.push(ry); this.rz.push(0);
      this.col.push(color); this.delay.push(delay);
      this.roomIds.push(roomId !== undefined ? roomId : -1);
      this.n++;
    },
    addT(x,y,z, sx,sy,sz, rx,ry,rz, color, delay, roomId){
      this.px.push(x); this.py.push(y); this.pz.push(z);
      this.sx.push(sx); this.sy.push(sy); this.sz.push(sz);
      this.rx.push(rx); this.ry.push(ry); this.rz.push(rz);
      this.col.push(color); this.delay.push(delay);
      this.roomIds.push(roomId !== undefined ? roomId : -1);
      this.n++;
    }};
}

export function buildMesh(set, geo, mat, mode, dur, shadow){
  const alloc = Math.max(set.n,1);
  const mesh = new THREE.InstancedMesh(geo, mat, alloc);
  mesh.count = set.n;
  for(let i=0;i<alloc;i++) mesh.setColorAt(i, _c.set(i<set.n ? set.col[i] : 0xffffff));
  if(mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  if(shadow===1){ mesh.castShadow = true; mesh.receiveShadow = true; }
  else if(shadow===2) mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.userData = { set, mode, dur, settled:false, roomIds: set.roomIds };
  writeInstances(mesh, Infinity);
  return mesh;
}

export function setAtlasAttr(geo, arr, n){
  let at = geo.getAttribute('aUvO');
  const need = Math.max(n,1)*2;
  if(!at || at.array.length < need){
    at = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(need,4096)), 2);
    geo.setAttribute('aUvO', at);
  }
  at.array.set(arr); at.needsUpdate = true;
}

const easeOutCubic = t => 1-Math.pow(1-t,3);
const easeOutBack  = t => { const c=1.70158; return 1 + (c+1)*Math.pow(t-1,3) + c*Math.pow(t-1,2); };

export function writeInstances(mesh, t){
  const u = mesh.userData, s = u.set;
  let allDone = true;
  for(let i=0;i<s.n;i++){
    let k = (t - s.delay[i]) / u.dur;
    if(k < 1) allDone = false;
    k = Math.max(0.0001, Math.min(1, k));
    const g = u.mode==='rise' ? easeOutCubic(k) : easeOutBack(k)*Math.min(1,k*8);
    _q.setFromEuler(_E.set(s.rx[i], s.ry[i], s.rz[i]));
    if(u.mode==='rise'){ _p.set(s.px[i], s.py[i], s.pz[i]); _s.set(s.sx[i], s.sy[i]*Math.max(g,0.0001), s.sz[i]); }
    else { const m=Math.max(g,0.0001); _p.set(s.px[i], s.py[i], s.pz[i]); _s.set(s.sx[i]*m, s.sy[i]*m, s.sz[i]*m); }
    _m.compose(_p,_q,_s); mesh.setMatrixAt(i,_m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  u.settled = allDone;
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
export let fx = { liquids:[], shafts:[], spinners:[], parts:null };
let levelGeos = [];
const lerpC = (a,b,t)=> _c.set(a).lerp(new THREE.Color(b), t).getHex();

export function isAnimating() {
  return animating;
}

export function disposeLevel(){
  clearAmbientFX();
  for (const m of chestMixers) m.stopAllAction();
  chestMixers = []; chestInstances = [];
  if(group){ scene.remove(group);
    group.traverse(o=>{
      if(o.isInstancedMesh) o.dispose();
      if(o.isLine || o.isPoints){ o.geometry.dispose(); if(o.material && o.material.dispose && o.material!==partMat) o.material.dispose(); }
    });
  }
  for(const g of levelGeos) g.dispose();
  levelGeos = [];
  group = null; meshes = {}; overlay = null;
  lights = [];
  roomLights = [];
  standaloneRooms = [];
  fx = { liquids:[], shafts:[], spinners:[], parts:null };
}

export function applyThemeEnv(TH){
  scene.fog.color.set(TH.fog);
  scene.fog.density = TH.fogD || 0.0025;
  curBg.set(TH.bg);
  hemi.color.set(TH.hemi[0]); hemi.groundColor.set(TH.hemi[1]); hemi.intensity = TH.hemi[2] * LIGHT_K;
  dirL.color.set(TH.dir[0]); dirL.intensity = TH.dir[1] * LIGHT_K;
  document.documentElement.style.setProperty('--ember', TH.accent);
}

/* `y` may be a number (flat level: the original behaviour) or a function of
   the cell, so a pool sunk into a lower tier draws at that tier's height. */
export function buildLiquidMesh(cells, wx, wz, y){
  const yOf = typeof y === 'function' ? y : () => y;
  const key = new Set(cells.map(c=>c.x+','+c.y));
  const n = cells.length;
  const pos = new Float32Array(n*18), ae = new Float32Array(n*12), am = new Float32Array(n*24);
  const CE = [-0.5,-0.5, -0.5,0.5, 0.5,0.5, -0.5,-0.5, 0.5,0.5, 0.5,-0.5];
  let o=0, oe=0, om=0;
  for(const c of cells){
    const x0=wx(c.x)-0.51, x1=wx(c.x)+0.51, z0=wz(c.y)-0.51, z1=wz(c.y)+0.51;
    const cy = yOf(c);
    pos.set([x0,cy,z0, x0,cy,z1, x1,cy,z1,  x0,cy,z0, x1,cy,z1, x1,cy,z0], o); o+=18;
    ae.set(CE, oe); oe+=12;
    const mx0 = key.has((c.x-1)+','+c.y) ? 0 : 1, mx1 = key.has((c.x+1)+','+c.y) ? 0 : 1;
    const mz0 = key.has(c.x+','+(c.y-1)) ? 0 : 1, mz1 = key.has(c.x+','+(c.y+1)) ? 0 : 1;
    for(let k=0;k<6;k++){ am[om++]=mx0; am[om++]=mx1; am[om++]=mz0; am[om++]=mz1; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  g.setAttribute('aE', new THREE.BufferAttribute(ae,2));
  g.setAttribute('aM', new THREE.BufferAttribute(am,4));
  levelGeos.push(g);
  return new THREE.Mesh(g, liquidMat);
}

export function buildScene(d){
  disposeLevel();
  D = d;
  /* A new floor resets the player's resting zoom too, otherwise a zoom set
     three floors ago silently caps the director forever. */
  setUserZoom(DEFAULT_CAM_ZOOM);
  initNixieVfx(scene, cam);
  clearPersistentNixieEffects();
  const W = d.W, H = d.H;
  const wx = x => x - W / 2 + 0.5, wz = y => y - H / 2 + 0.5;
  const er = (d.rooms && d.entrance >= 0 && d.rooms[d.entrance]) || (d.rooms && d.rooms[0]);
  if (er) {
    camTarget.set(wx(er.cx), 0, wz(er.cy));
    updateCam();
  }
  initAmbientFX(scene, cam, d.params.themeKey || d.themeKey, er ? new THREE.Vector3(wx(er.cx), 1.2, wz(er.cy)) : null);
  const TH = THEMES[d.params.themeKey || d.themeKey] || THEMES.ancient;
  const accC = parseInt(TH.accent.slice(1),16);
  applyThemeEnv(TH);
  applyTileTheme(d.params.themeKey || d.themeKey);
  preloadBiomeProps(d.params?.themeKey || d.themeKey);
  group = new THREE.Group(); scene.add(group);

  if(!heroLight){
    heroLight = new THREE.PointLight(0xffbb66, 2.0 * LIGHT_K, 18, 2);
    heroLight.userData = { base: 2.0, ph: 0, ramp: 1, fogMult: 1 };
    scene.add(heroLight);
  }

  const grid=d.grid, roomId=d.roomId, corridor=d.corridor,
        doorway=d.doorway, bfs=d.bfs, maxBfs=d.maxBfs, rooms=d.rooms,
        lakeMask=d.lakeMask;
  const idx=(x,y)=>y*W+x;
  const cellRng = makeRng(d.seed ^ 0x9e3779b9);
  const dStep = 0.016;

  /* ── elevation ───────────────────────────────────────────────────────
     Levels generated before elevation existed (and overland maps, which stay
     flat in Tier 1) carry no height array; eH/eR then report 0 for every cell
     and everything below collapses to exactly the old flat output. */
  const eHeight = d.height || null, eRamp = d.ramp || null;
  const eH = c => (eHeight && c>=0 && c<eHeight.length) ? eHeight[c] : 0;
  const eR = c => (eRamp && c>=0 && c<eRamp.length) ? eRamp[c] : 0;
  /* Surface Y for a cell — the plane a body standing here walks on. */
  const surfY = c => eH(c) * ELEV_STEP;
  /* Same, from world coordinates — for the handful of scene objects positioned
     in world space rather than from a grid cell (light shafts, the boss rune). */
  const surfYW = (wxv, wzv) => {
    const gx = Math.round(wxv + W/2 - 0.5), gy = Math.round(wzv + H/2 - 0.5);
    if(gx<0||gy<0||gx>=W||gy>=H) return 0;
    return surfY(idx(gx,gy));
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
  for(let c=0;c<W*H;c++){
    if(grid[c]!==FLOOR && grid[c]!==POOL) continue;
    const t = surfY(c);
    if(t < floorMinY) floorMinY = t;
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
  const renderedTop = (c) => {
    if(grid[c] === POOL) return surfY(c) - 0.16;          /* basin rim */
    /* Must match the lake-bed formula in the floor pass exactly; estimating it
       as one flat step left 343 edges where a neighbour stopped short of the
       bed it was meant to meet. */
    if(lakeMask[c] && grid[c] === FLOOR) return Math.min(surfY(c) - ELEV_STEP, floorMinY);
    return surfY(c);
  };
  const blockBottom = (ownT, gx, gy) => {
    let lo = ownT;
    for(let oy=-1;oy<=1;oy++) for(let ox=-1;ox<=1;ox++){
      if(!ox && !oy) continue;
      const nx=gx+ox, ny=gy+oy;
      if(nx<0||ny<0||nx>=W||ny>=H) continue;
      const nc = idx(nx,ny);
      if(grid[nc]!==FLOOR && grid[nc]!==POOL) continue;
      /* The neighbour's RENDERED top, which is not always its nominal surface:
         a lake draws its bed a step under the waterline and a pool sinks a
         basin below its rim. Reaching only to the nominal level left a gap
         over exactly those cells. */
      const t = renderedTop(nc);
      if(t < lo) lo = t;
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
  const rampDir = (x,y,c) => {
    const h = eH(c);
    let down = null;
    for(const [ox,oy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+ox, ny=y+oy;
      if(nx<0||ny<0||nx>=W||ny>=H) continue;
      const nc = idx(nx,ny);
      if(grid[nc]!==FLOOR) continue;
      if(eH(nc) === h+1) return [ox,oy,1];
      if(eH(nc) === h-1 && !down) down = [ox,oy,-1];
    }
    return down;
  };
  /* Ramps are built as STAIRS, not slopes: a tilted slab reads as a wheelchair
     ramp from the fixed camera angle, which is wrong for a dungeon. STAIR_N
     visible treads plus the platform lip divide the rise into STAIR_N+1 equal
     risers of STEP/4 = 0.1125. */
  const STAIR_N = 3;

  const floorAnchor = (gx, gy)=>{
    gx = Math.max(0, Math.min(W-1, Math.round(gx)));
    gy = Math.max(0, Math.min(H-1, Math.round(gy)));
    if(grid[idx(gx,gy)]===FLOOR || grid[idx(gx,gy)]===POOL) return idx(gx,gy);
    for(const o of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
      const nx=gx+o[0], ny=gy+o[1];
      if(nx>=0&&ny>=0&&nx<W&&ny<H && (grid[idx(nx,ny)]===FLOOR || grid[idx(nx,ny)]===POOL)) return idx(nx,ny);
    }
    return -1;
  };

  const mossMask = new Uint8Array(W*H);
  for(const p of d.props) if(p.kind==='moss') mossMask[idx(p.x,p.y)] = 1;
  const poolAdj = (x,y)=>{
    const c=idx(x,y);
    return (x<W-1 && grid[c+1]===POOL) || (x>0 && grid[c-1]===POOL) ||
           (y<H-1 && grid[c+W]===POOL) || (y>0 && grid[c-W]===POOL);
  };

  const nearFloorBfs = (x,y)=>{ let b=1e4;
    for(let oy=-1;oy<=1;oy++) for(let ox=-1;ox<=1;ox++){
      const nx=x+ox, ny=y+oy;
      if(nx>=0&&ny>=0&&nx<W&&ny<H && bfs[idx(nx,ny)]>=0) b=Math.min(b,bfs[idx(nx,ny)]);
    } return b===1e4?0:b; };

  /* Distance-from-floor BFS for culling off-screen void trees and ground */
  const wallDist = new Int16Array(W*H).fill(-1);
  const qDist = [];
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const c=idx(x,y);
    if(grid[c]===FLOOR){
      wallDist[c] = 0;
      qDist.push(x, y);
    }
  }
  let qdHead = 0;
  while(qdHead < qDist.length){
    const qx = qDist[qdHead++];
    const qy = qDist[qdHead++];
    const dCur = wallDist[idx(qx, qy)];
    if(dCur >= 3) continue;
    for(let oy=-1; oy<=1; oy++) for(let ox=-1; ox<=1; ox++){
      if(!ox && !oy) continue;
      const nx = qx + ox, ny = qy + oy;
      if(nx>=0 && ny>=0 && nx<W && ny<H){
        const nc = idx(nx, ny);
        if(wallDist[nc] === -1){
          wallDist[nc] = dCur + 1;
          qDist.push(nx, ny);
        }
      }
    }
  }

  /* floors */
  const fs = instSet(); floorColorsBase=[]; floorColorsHeat=[];
  floorCellStart = new Int32Array(W*H).fill(-1); floorCellCount = new Uint8Array(W*H);
  const markFloorCell = (c, from) => {
    if(fs.n <= from) return;
    floorCellStart[c] = from; floorCellCount[c] = fs.n - from;
  };
  const fUv=[], pushVar=(arr,rng)=>{ const v=rng.i(0,3); arr.push((v&1)*0.5, (v>>1)*0.5); };
  const decCand=[];
  const base = new THREE.Color(), tint = new THREE.Color(),
        heatA = new THREE.Color(0x2f4bb0), heatB = new THREE.Color(0xe8502f);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const c=idx(x,y);
    const isWall = grid[c]===WALL;
    if((!isWall && grid[c]!==FLOOR) || lakeMask[c]){
      /* A lake is FLOOR flagged by lakeMask, and the floor pass skips it — so
         historically nothing was drawn beneath the water at all. Flat levels
         got away with it because neighbouring blocks hid the hole from every
         angle; once a lake could be levelled onto a tier, the surface was left
         hanging over open space. Give it a bed: one step below the waterline,
         sunk to the same common floor as everything else. */
      if(lakeMask[c] && grid[c]===FLOOR){
        const bedTop = Math.min(surfY(c) - ELEV_STEP, floorMinY);
        const bedK = Math.max(1, (bedTop - blockBottom(bedTop, x, y))/SLAB);
        const bcol = new THREE.Color(TH.floor).multiplyScalar(0.55).getHex();
        const fi0 = fs.n;
        fs.add(wx(x), bedTop, wz(y), 1,bedK,1, 0, bcol, Math.max(0,bfs[c])*dStep);
        markFloorCell(c, fi0);
        pushVar(fUv, cellRng);
        floorColorsBase.push(bcol); floorColorsHeat.push(bcol);
      }
      continue;
    }
    if(isWall && (!TH.overland || wallDist[c] < 0 || wallDist[c] > 3)) continue;
    let walls8=0;
    for(let oy=-1;oy<=1;oy++) for(let ox=-1;ox<=1;ox++){
      if(!ox&&!oy) continue;
      const nx=x+ox, ny=y+oy;
      if(nx<0||ny<0||nx>=W||ny>=H || grid[idx(nx,ny)]===WALL) walls8++;
    }
    const rid = roomId[c];
    if(isWall){
      base.set(TH.floor).multiplyScalar(cellRng.f(0.85,1.02));
      floorColorsBase.push(base.getHex());
      floorColorsHeat.push(base.getHex());
      const dl = nearFloorBfs(x,y)*dStep + 0.28;
      const fi0 = fs.n;
      fs.add(wx(x), cellRng.f(-0.02,0.008), wz(y), 1,1,1, cellRng.i(0,3)*(Math.PI/2), base.getHex(), dl);
      markFloorCell(c, fi0);
      pushVar(fUv, cellRng);
    } else {
      base.set(corridor[c] ? TH.corridor : TH.floor);
      if(rid>=0 && rooms[rid].type!==TYPE.COMBAT) base.lerp(tint.set(TINT[rooms[rid].type]), 0.17);
      if(doorway[c]) base.multiplyScalar(1.14);
      if(mossMask[c]) base.lerp(tint.set(0x4c7a42), 0.32);
      if(TH.pools && TH.pools.mode===0 && poolAdj(x,y)) base.lerp(tint.set(0xff7a33), 0.3);
      base.multiplyScalar(1 - 0.11*Math.min(walls8,4));
      base.multiplyScalar(((x+y)&1) ? 0.965 : 1.0);
      base.multiplyScalar(cellRng.f(0.94,1.06));
      floorColorsBase.push(base.getHex());
      const diff = rid>=0 ? rooms[rid].difficulty : (maxBfs ? bfs[c]/maxBfs : 0.5);
      floorColorsHeat.push(heatA.clone().lerp(heatB, Math.min(1,diff)).multiplyScalar(0.55 + 0.45*(1-0.09*Math.min(walls8,4))).getHex());
      const jit  = cellRng.f(-0.02,0.008);
      const topY = surfY(c) + jit;                    /* visible top surface */
      const col  = floorColorsBase[floorColorsBase.length-1];
      const dly  = Math.max(0,bfs[c])*dStep;
      const rot  = cellRng.i(0,3)*(Math.PI/2);
      const rdir = eR(c) ? rampDir(x,y,c) : null;
      if(rdir){
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
        const [ox,oz,sgn] = rdir;
        const rise = sgn*ELEV_STEP;
        /* floorColorsBase/Heat are parallel to INSTANCES, not cells, and this
           cell emits STAIR_N of them. One entry was pushed above, so top the
           arrays up or every colour past the first staircase is read from the
           wrong index (applyReveal and the heat overlay both index by
           instance). */
        for(let e=1;e<STAIR_N;e++){
          floorColorsBase.push(floorColorsBase[floorColorsBase.length-1]);
          floorColorsHeat.push(floorColorsHeat[floorColorsHeat.length-1]);
        }
        const fi0 = fs.n;
        for(let i=0;i<STAIR_N;i++){
          const treadTop = topY + rise*((i+1)/(STAIR_N+1));
          const front    = -0.5 + i/STAIR_N;     /* near edge of visible band */
          const ctr      = sgn > 0 ? front + 0.5 : front + 1/STAIR_N - 0.5;
          const bot      = blockBottom(Math.min(topY, treadTop), x, y);
          const k        = Math.max(1, (treadTop - bot)/SLAB);
          fs.add(wx(x) + ox*ctr, treadTop, wz(y) + oz*ctr, 1,k,1, rot, col, dly);
          pushVar(fUv, cellRng);
        }
        markFloorCell(c, fi0);
        continue;
      }
      const botY = blockBottom(topY, x, y);
      const k    = Math.max(1, (topY - botY)/SLAB);
      const fi0  = fs.n;
      fs.add(wx(x), topY, wz(y), 1,k,1, rot, col, dly);
      markFloorCell(c, fi0);
      pushVar(fUv, cellRng);
      decCand.push({x, y, rid, walls8, surfY: surfY(c)});
    }
  }
  /* Overland ground defaults to the untextured grass material (per-instance
     tinted from TH.floor); themes over bare earth, ash or dust ask for the
     flagstone atlas instead via `groundMat`, and ice for frozen surfaces. */
  const groundMat = TH.overland
    ? (TH.groundMat === 'floor' ? matFloor : TH.groundMat === 'ice' ? matIce : matGrass)
    : matFloor;
  meshes.floor = buildMesh(fs, GEO.floor, groundMat, 'pop', 0.34, 2);
  setAtlasAttr(GEO.floor, fUv, fs.n);

  /* walls + trim caps */
  const ws = instSet(), cs = instSet();
  const wUv=[], cUv=[];
  const wcol = new THREE.Color();
  /* Overland blockers come in two silhouettes: trunk+canopy (forest, mire,
     sporewood…) or jittered masonry (boneyard, ruinfield, ashfield). */
  const blockGeo = TH.overland && TH.blockerGeo === 'block';
  if(TH.overland){
    const pal = d.palisadeMask;
    const isWinter = TH.label === 'SNOWFIELD' || TH.label === 'FROST' || d.params?.themeKey === 'snowfield' || d.themeKey === 'frost';
    const isForest = TH.label === 'FOREST' || d.params?.themeKey === 'forest' || d.themeKey === 'forest';
    const isMoor = TH.label === 'MOOR' || d.params?.themeKey === 'moor' || d.themeKey === 'moor';
    const isMire = TH.label === 'MIRE' || d.params?.themeKey === 'mire' || d.themeKey === 'mire';
    const isSporewood = TH.label === 'SPOREWOOD' || d.params?.themeKey === 'sporewood' || d.themeKey === 'sporewood';

    const treeOptions = [];
    if (isWinter) {
      const wAsset = propAssets.snowtree || propAssets.tree_winter || propAssets.tree;
      if (wAsset) treeOptions.push(wAsset);
    } else if (isMoor) {
      // Moor: mix of plain pine trees and swamp trees
      if (propAssets.tree) treeOptions.push(propAssets.tree);
      if (propAssets.swamptree) treeOptions.push(propAssets.swamptree);
    } else if (isMire) {
      // Mire: mix of swamp trees and dead trees
      if (propAssets.swamptree) treeOptions.push(propAssets.swamptree);
      if (propAssets.deadtree) treeOptions.push(propAssets.deadtree);
    } else if (isSporewood) {
      if (propAssets.swamptree) treeOptions.push(propAssets.swamptree);
      else if (propAssets.tree) treeOptions.push(propAssets.tree);
    } else if (isForest) {
      if (propAssets.tree) treeOptions.push(propAssets.tree);
    }

    const treeMeshes = [];
    for (const opt of treeOptions) {
      let mesh = null;
      opt.traverse(o => {
        if (o.isMesh && !mesh) {
          mesh = o;
          if (mesh.material) {
            mesh.material.roughness = 0.94;
            mesh.material.metalness = 0.0;
          }
        }
      });
      if (mesh) {
        treeMeshes.push({ mesh, set: instSet() });
      }
    }

    for(let y=0;y<H;y++) for(let x=0;x<W;x++){
      const c=idx(x,y);
      if(grid[c]!==WALL) continue;
      if(treeMeshes.length > 0 && (wallDist[c] < 0 || wallDist[c] > 3)) continue;
      const dl = nearFloorBfs(x,y)*dStep + 0.30;
      if(pal && pal[c]){
        const hh = 1.5 + cellRng.f(-0.1,0.18);
        wcol.set(TH.stake||0x6b4a2f).multiplyScalar(cellRng.f(0.86,1.1));
        ws.add(wx(x),0,wz(y), 1.5,hh,1.5, cellRng.f(-0.08,0.08), wcol.getHex(), dl);
        wcol.set(TH.stakeCap||0x543822).multiplyScalar(cellRng.f(0.9,1.05));
        cs.add(wx(x),hh-0.06,wz(y), 0.42,0.34,0.42, cellRng.f(0,6.28), wcol.getHex(), dl+0.1);
        /* keep the atlas-uv arrays in step with the instance sets */
        if(blockGeo){ pushVar(wUv, cellRng); pushVar(cUv, cellRng); }
      } else if(blockGeo){
        /* masonry blockers: graveyard walls, toppled colonnade, obsidian spires.
           Same jitter-and-rotate treatment as the trees so an open field of them
           still reads as terrain rather than a dungeon wall, but built from the
           boxy wall/cap geometry with the stone atlas. */
        const [hMul, capMul] = TH.blockerH || [1, 0.6];
        const hh = (1.7 + cellRng.f(-0.55, 0.7)) * hMul;
        const jx = cellRng.f(-0.18,0.18), jz = cellRng.f(-0.18,0.18);
        const sxz = cellRng.f(0.72, 1.05);
        wcol.set(TH.wall).multiplyScalar(cellRng.f(0.82,1.12));
        ws.add(wx(x)+jx,0,wz(y)+jz, sxz,hh,sxz, cellRng.f(0,6.28), wcol.getHex(), dl);
        pushVar(wUv, cellRng);
        wcol.set(TH.cap).multiplyScalar(cellRng.f(0.88,1.12));
        cs.add(wx(x)+jx, hh, wz(y)+jz, sxz*capMul,capMul,sxz*capMul,
               cellRng.f(0,6.28), wcol.getHex(), dl+0.12);
        pushVar(cUv, cellRng);
      } else if(treeMeshes.length > 0){
        /* 3D Model Trees (Forest, Frost, Moor, Mire, Sporewood) */
        // Density reduced by 20%: front row 0.80, row 2 0.68, row 3 0.48
        const keepProb = wallDist[c] === 1 ? 0.80 : (wallDist[c] === 2 ? 0.68 : 0.48);
        if(cellRng.f(0, 1) <= keepProb){
          const chosen = treeMeshes[cellRng.i(0, treeMeshes.length - 1)];
          const baseScale = cellRng.f(2.0, 3.4);
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
          chosen.set.addT(wx(x)+jx, 0, wz(y)+jz, sx, sy, sz, rx, ry, rz, 0xffffff, dl);
        }
      } else {
        /* Procedural conifer trees (Snowfield, Sporewood, Mire, Moor) */
        const bl = TH.blocker || { trunkH:1, trunkR:1, canopyS:1, canopyY:0.42 };
        const hh = (1.9 + cellRng.f(-0.45,0.75)) * (bl.trunkH ?? 1);
        const tr = bl.trunkR ?? 1;
        const jx = cellRng.f(-0.24,0.24), jz = cellRng.f(-0.24,0.24);
        wcol.set(TH.wall).multiplyScalar(cellRng.f(0.82,1.12));
        ws.add(wx(x)+jx,0,wz(y)+jz, cellRng.f(0.8,1.2)*tr,hh,cellRng.f(0.8,1.2)*tr, cellRng.f(0,6.28), wcol.getHex(), dl);
        const cS = bl.canopyS ?? 1;
        wcol.set(TH.cap).lerp(tint.set(TH.canopyTint ?? 0x8fbf5e), cellRng.f(0,0.4)).multiplyScalar(cellRng.f(0.82,1.15));
        cs.add(wx(x)+jx, hh*(bl.canopyY ?? 0.42), wz(y)+jz,
               cellRng.f(0.95,1.35)*cS,cellRng.f(0.95,1.3)*cS,cellRng.f(0.95,1.35)*cS,
               cellRng.f(0,6.28), wcol.getHex(), dl+0.12);
      }
    }
    if(blockGeo){
      meshes.wall    = buildMesh(ws, GEO.wall, matWall, 'rise', 0.42, 1);
      setAtlasAttr(GEO.wall, wUv, ws.n);
      meshes.wallCap = buildMesh(cs, GEO.wallCap, matWallCap, 'pop', 0.3, 1);
      setAtlasAttr(GEO.wallCap, cUv, cs.n);
    } else if(treeMeshes.length > 0 && treeMeshes.some(tm => tm.set.n > 0)){
      let meshIdx = 0;
      treeMeshes.forEach(tm => {
        if(tm.set.n > 0){
          const m = buildMesh(tm.set, tm.mesh.geometry, tm.mesh.material, 'rise', 0.42, 2);
          if(meshIdx === 0) meshes.wall = m;
          else meshes[`wall_tree_${meshIdx}`] = m;
          meshIdx++;
        }
      });
    } else {
      meshes.wall    = buildMesh(ws, GEO.treeTrunk, matBark, 'rise', 0.42, 1);
      meshes.wallCap = buildMesh(cs, GEO.treeCanopy, matLeaf, 'pop', 0.3, 1);
    }
  } else {
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){
      if(grid[idx(x,y)]!==WALL) continue;
      const h = 2.0 + cellRng.f(-0.25,0.25);
      const dl = nearFloorBfs(x,y)*dStep + 0.30;
      wcol.set(TH.wall).multiplyScalar(cellRng.f(0.9,1.08));
      ws.add(wx(x),wallBase,wz(y), 1,h-wallBase,1, 0, wcol.getHex(), dl);
      pushVar(wUv, cellRng);
      wcol.set(TH.cap).multiplyScalar(cellRng.f(0.92,1.1));
      cs.add(wx(x),h,wz(y), 1,1,1, cellRng.i(0,3)*(Math.PI/2), wcol.getHex(), dl+0.12);
      pushVar(cUv, cellRng);
    }
    meshes.wall    = buildMesh(ws, GEO.wall, matWall, 'rise', 0.42, 1);
    setAtlasAttr(GEO.wall, wUv, ws.n);
    meshes.wallCap = buildMesh(cs, GEO.wallCap, matWallCap, 'pop', 0.3, 1);
    setAtlasAttr(GEO.wallCap, cUv, cs.n);
  }

  /* prop instance sets */
  const S = { pillar:instSet(), arch:instSet(), archL:instSet(), gate:instSet(), torchArm:instSet(),
              flame:instSet(), flameCore:instSet(),
              debrisA:instSet(), debrisB:instSet(), debrisC:instSet(),
              chest:instSet(), chestTrim:instSet(), chestGlow:instSet(),
              grave:instSet(), sarco:instSet(), candle:instSet(), bone:instSet(),
              skull:instSet(), skeleton:instSet(), bonePile:instSet(), spiderWeb:instSet(),
              icicle:instSet(), shardIce:instSet(), roots:instSet(), moss:instSet(),
              crackD:instSet(), skirt:instSet(), bannerRod:instSet(), bannerCloth:instSet(), emblem:instSet(),
              spawn1:instSet(), spawn2:instSet(), spawn3:instSet(), band2:instSet(), band3:instSet(),
              crystal:instSet(), ring:instSet(), plinth:instSet(), platform:instSet(),
              brazier:instSet(), coals:instSet(), basin:instSet(), tent:instSet(),
              campfireStones:instSet(), campfireLogs:instSet(), campfireCoals:instSet(), campfireFlames:instSet(), campfireFlameCore:instSet(),
              bossGlow:instSet(), bossRock:instSet(),
              runeSeal:instSet(), ember:instSet(), rime:instSet(), stain:instSet(), growth:instSet(),
              barrel:instSet(), crate:instSet(), table:instSet(), bench:instSet(), chair:instSet(),
              bookshelf:instSet(), weaponRack:instSet(), statue:instSet(), urn:instSet(),
              rug:instSet(), magicCircle:instSet(), tapestry:instSet(), sconce:instSet(),
              forge:instSet(), cauldron:instSet(), ossuaryFrame:instSet(), ossuaryBones:instSet(), sporePod:instSet(),
              megalith:instSet(), wagon:instSet(), altarTable:instSet(), iceThrone:instSet(), globe:instSet(),
              sepulcherDais:instSet(),
              stalagmite:instSet(), boulderPile:instSet(), forgeChains:instSet(), hangingChains:instSet(), bridgeRailing:instSet(),
              magmaBridge:instSet(), magmaBridgeApproach:instSet(),
              woodBridge:instSet(), woodRailing:instSet(),
              mammothTusks:instSet(), runicObelisk:instSet(), runicObeliskGlow:instSet(), shieldRack:instSet(), hearthPit:instSet(), boneTotem:instSet(), glacialSpire:instSet(),
              ingotStack:instSet(), goldBullion:instSet(), smeltingCrucible:instSet(), crucibleLiquid:instSet(),
              swampgrass:instSet(), swampgrass2:instSet(), swampgrass3:instSet(),
              cornerRubbleA:instSet(), cornerRubbleB:instSet(), cornerRubbleC:instSet(), cornerRubbleD:instSet(), fallenBrick:instSet() };
  const pd = (x,y)=> Math.max(0,bfs[idx(x,y)])*dStep + 0.62;
  const shaftAt = [];
  const rubbleAUv = [], rubbleBUv = [], rubbleCUv = [], rubbleDUv = [], brickUv = [];
  let portalXZ = null, runeXZ = null;

  for(const p of d.props){
    const rx = Math.max(0, Math.min(W-1, Math.round(p.x)));
    const ry = Math.max(0, Math.min(H-1, Math.round(p.y)));
    const X=wx(p.x), Z=wz(p.y), dl=pd(rx, ry);
    /* Props take their Y from the tile they stand on, so anything on a dais
       or down in a sunken pit rides with the terrain for free. */
    const PY = surfY(idx(rx, ry));
    const rdx = Math.max(0, Math.min(W-1, Math.round(p.x + (p.dx||0))));
    const rdy = Math.max(0, Math.min(H-1, Math.round(p.y + (p.dy||0))));
    const propRoom = p.roomId !== undefined ? p.roomId : d.roomId[idx(rdx, rdy)];
    switch(p.kind){
      case 'pillar': { const s=p.scale*1.15;
        S.pillar.add(X, PY, Z, s,s,s, cellRng.i(0,3)*Math.PI/2, TH.pillar, dl, propRoom); break; }
      case 'debris': { const set=[S.debrisA,S.debrisB,S.debrisC][p.v||0];
        set.add(X, PY, Z, p.scale,p.scale*0.85,p.scale, p.rot, lerpC(TH.debris[0],TH.debris[1],cellRng.raw()), dl, propRoom); break; }
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
      case 'tombstone': case 'anvil': case 'icebone':
      case 'fren1': case 'fren2': case 'fren3': case 'fren4':
      case 'mushroomA': case 'mushroomB': case 'rootsA': case 'rootsB':
      case 'bush': case 'signpost': case 'brokenSignpost': case 'wheel':
      /* any key registered through registerProp() (custom_props.json or the
         dungeon editor's model import) lands here too */
      default: {
        const asset = propAssets[p.kind];
        if(!asset) break;
        const inst = asset.clone(true);
        const s = p.scale * (PROP_SCALE_MULTIPLIER[p.kind] || 1);
        const isTreeProp = p.kind === 'tree' || p.kind === 'snowtree' || p.kind === 'tree_winter' || p.kind === 'swamptree' || p.kind === 'deadtree';
        if(isTreeProp){
          const sx = s * cellRng.f(0.70, 1.05);
          const sz = s * cellRng.f(0.70, 1.05);
          const sy = s * cellRng.f(0.88, 1.35);
          inst.scale.set(sx, sy, sz);
          const tiltMag = cellRng.f(0.0, 0.087);
          const tiltDir = cellRng.f(0, 6.28);
          inst.rotation.set(Math.sin(tiltDir)*tiltMag, p.rot || cellRng.f(0, 6.28), Math.cos(tiltDir)*tiltMag);
          inst.position.set(X, PY + ((propBaseOffset[p.kind]||0) * sy + (p.oy || 0)), Z);
        } else {
          inst.scale.setScalar(s);
          inst.rotation.y = p.rot;
          inst.position.set(X, PY + ((propBaseOffset[p.kind]||0) * s + (p.oy || 0)), Z);
        }
        inst.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
        group.add(inst);
        if(propRoom>=0) standaloneRooms.push({mesh:inst, rid:propRoom});
        break;
      }
      case 'chest': {
        if(propAssets['chest']){
          const inst = propAssets['chest'].clone(true);
          const s = (p.scale||1) * (PROP_SCALE_MULTIPLIER['chest'] || 1);
          inst.scale.setScalar(s);
          inst.rotation.y = p.rot || 0;
          inst.position.set(X, PY + ((propBaseOffset['chest']||0) * s + (p.oy || 0)), Z);
          inst.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
          group.add(inst);
          if(propRoom>=0) standaloneRooms.push({mesh:inst, rid:propRoom});
          chestInstances.push({ mesh: inst, x: X, z: Z, opened: false });
          break;
        }
        S.chest.add(X, PY, Z, 1,1,1, p.rot, 0x8a5a2c, dl, propRoom);
        S.chestTrim.add(X, PY, Z, 1,1,1, p.rot, 0xc8a24a, dl, propRoom);
        S.chestGlow.add(X, PY, Z, 1,1,1, p.rot, 0xffd27a, dl+0.15, propRoom);
        break;
      }
      case 'shrineCrystal': {
        const stoneCol = lerpC(TH.pillar || 0x6e6860, 0x3a3430, 0.35);
        const logCol = 0x5a3e28;
        S.campfireStones.add(X, PY, Z, 1,1,1, p.rot, stoneCol, dl, propRoom);
        S.campfireLogs.add(X, PY, Z, 1,1,1, p.rot, logCol, dl+0.1, propRoom);
        S.campfireCoals.add(X, PY, Z, 1,1,1, p.rot, 0xff4210, dl+0.15, propRoom);
        S.campfireFlames.add(X, PY, Z, 1,1,1, p.rot, 0xff7a20, dl+0.2, propRoom);
        S.campfireFlameCore.add(X, PY, Z, 1,1,1, p.rot, 0xffdf78, dl+0.25, propRoom);

        const campLight = new THREE.PointLight(0xff7a26, 2.6 * LIGHT_K, 12, 1.8);
        campLight.position.set(X, PY + (0.35), Z);
        campLight.userData = { base: 2.6, ph: cellRng.f(0, 6.28), ramp: 1, fogMult: 1, isCampfire: true };
        group.add(campLight);
        lights.push(campLight);
        if (propRoom >= 0) roomLights.push({ light: campLight, rid: propRoom });
        registerPersistentNixieEffect('campfire_embers', { x: X, y: 0.35, z: Z });
        break; }
      case 'ring':
        S.platform.add(X, PY + (-0.02), Z, 1,1,1, 0, lerpC(TH.floor,0xffffff,0.1), dl, propRoom);
        S.ring.add(X, PY + (0.012), Z, 1,1,1, 0, 0x3fd0bb, dl+0.1, propRoom);
        S.pillar.add(X-1.45, PY + (0.1), Z, 0.72,0.72,0.72, 0, TH.pillar, dl+0.15, propRoom);
        S.pillar.add(X+1.45, PY + (0.1), Z, 0.72,0.72,0.72, 0, TH.pillar, dl+0.15, propRoom);
        portalXZ = [X,Z];
        break;
      case 'bossCrystal': {
        S.bossGlow.add(X, PY, Z, 1.15,1.15,1.15, p.rot, 0xff4636, dl, propRoom);
        S.bossGlow.add(X+0.55, PY + (0), Z-0.42, 0.6,0.75,0.6, p.rot+1.2, 0xff6a45, dl+0.12, propRoom);
        S.bossRock.addT(X-0.62, PY + (0), Z+0.42, 0.75,0.8,0.75, 0.05,p.rot+2.1,-0.06, 0x4a3336, dl+0.15, propRoom);
        S.bossRock.addT(X+0.75, PY + (0), Z+0.55, 0.55,0.6,0.55, -0.06,p.rot+3.6,0.05, 0x51383a, dl+0.2, propRoom);
        break; }
      case 'sepulcherDais':
        S.sepulcherDais.add(X, PY + (-0.02), Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, lerpC(TH.floor, 0x222a22, 0.35), dl, propRoom);
        break;
      case 'grave':
        S.grave.add(X, PY, Z, p.scale,p.scale,p.scale, p.rot, lerpC(TH.pillar,0x4a3b32,cellRng.raw()), dl, propRoom);
        break;
      case 'sarco':
        S.sarco.add(X, PY, Z, p.scale,p.scale,p.scale, p.rot, lerpC(TH.pillar,0x3a3028,cellRng.raw()), dl, propRoom);
        break;
      case 'candle': {
        const cY = (p.oy || 0);
        S.candle.add(X, PY + (cY), Z, p.scale, p.scale, p.scale, p.rot, 0xd8cba8, dl, propRoom);
        S.flameCore.add(X, PY + (cY + 0.28*p.scale), Z, 0.6*p.scale, 0.6*p.scale, 0.6*p.scale, 0, 0xffdf78, dl+0.05, propRoom);
        break; }
      case 'icicle':
        /* oy lets overland hang them off shorter blockers than a dungeon wall. */
        S.icicle.addT(X, PY + (1.9 + (p.oy||0)), Z, p.scale,p.scale,p.scale,
                      cellRng.f(-0.1,0.1), p.rot, cellRng.f(-0.1,0.1),
                      0xbfe2ff, dl, propRoom);
        break;
      case 'shardIce':
        /* ox/oz spread the members of a cluster around inside their shared cell. */
        S.shardIce.addT(X + (p.ox||0), PY + (-0.1), Z + (p.oz||0), p.scale,p.scale,p.scale,
                        cellRng.f(-0.2,0.2), p.rot, cellRng.f(-0.2,0.2),
                        0xcfeaff, dl, propRoom);
        break;
      case 'roots':
        S.roots.add(wx(p.x), PY + (0), wz(p.y), p.scale,p.scale,p.scale, Math.atan2(p.dx,p.dy),
                    0x5a4632, nearFloorBfs(p.x,p.y)*dStep + 0.6, propRoom);
        break;
      case 'moss':
        S.moss.add(X, PY, Z, p.scale,p.scale,p.scale, p.rot, lerpC(0x3f6b3a,0x5a8a4a,cellRng.raw()), dl, propRoom);
        break;
      case 'crack': {
        const cx = X - (p.dx||0)*0.5, cz = Z - (p.dy||0)*0.5;
        const vc = p.ice ? 0x9fd8ff : (TH.pools && TH.pools.mode===3 ? 0x86c05a : 0xff6a28);
        S.crackD.add(cx, PY + (0), cz, p.scale,p.scale,p.scale, p.rot, vc, dl, propRoom);
        break; }
      case 'bones':
        S.bone.add(X, PY, Z, p.scale,p.scale,p.scale, p.rot, 0xcfc4a4, dl, propRoom);
        break;
      case 'skull':
        S.skull.add(X, PY, Z, p.scale,p.scale,p.scale, p.rot, 0xdfd8c4, dl, propRoom);
        break;
      case 'skeleton':
        S.skeleton.add(X, PY, Z, p.scale,p.scale,p.scale, p.rot, 0xd0c8b0, dl, propRoom);
        break;
      case 'bonePile':
        S.bonePile.add(X, PY, Z, p.scale,p.scale,p.scale, p.rot, 0xcfc4a4, dl, propRoom);
        break;
      case 'spiderWeb': {
        /* p.x/p.y is the floor cell at an inside corner and p.dx/p.dy point at the
           two walls meeting there, so the hub goes on the corner post between them.
           The fan spans +x..+z from its own origin; rotating its bisector to face
           back into the room lands its two straight edges along the two walls. */
        const wdx = p.dx || 0, wdy = p.dy || 0;
        S.spiderWeb.add(X + wdx*0.5, PY + (0), Z + wdy*0.5, p.scale,p.scale,p.scale,
                        Math.atan2(-wdx, -wdy) - Math.PI/4, 0xe8e8e8, dl, propRoom);
        break; }
      case 'banner': {
        const ry = Math.atan2(p.dx, p.dy);
        const bx = wx(p.x)+p.dx*0.54, bz = wz(p.y)+p.dy*0.54;
        const bdl = nearFloorBfs(p.x,p.y)*dStep + 0.7;
        S.bannerRod.add(bx, PY + (1.98), bz, 1,1,1, ry, 0x6a5a3a, bdl, propRoom);
        S.bannerCloth.add(bx+p.dx*0.03, PY + (1.96), bz+p.dy*0.03, 1,1,1, ry, TH.cloth, bdl+0.05, propRoom);
        S.emblem.add(bx+p.dx*0.06, PY + (1.6), bz+p.dy*0.06, 1,1,1, ry, accC, bdl+0.1, propRoom);
        break; }
      case 'barrel': {
        if(propAssets['barrel']){
          const inst = propAssets['barrel'].clone(true);
          const s = (p.scale||1) * (PROP_SCALE_MULTIPLIER['barrel'] || 1);
          inst.scale.setScalar(s);
          inst.rotation.y = p.rot || 0;
          inst.position.set(X, PY + ((propBaseOffset['barrel']||0) * s + (p.oy || 0)), Z);
          inst.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
          group.add(inst);
          if(propRoom>=0) standaloneRooms.push({mesh:inst, rid:propRoom});
          break;
        }
        S.barrel.add(X, PY, Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, lerpC(0x8a5a2c, 0x5a3a1c, cellRng.raw()), dl, propRoom);
        break;
      }
      case 'crate': {
        if(propAssets['crate']){
          const inst = propAssets['crate'].clone(true);
          const s = (p.scale||1) * (PROP_SCALE_MULTIPLIER['crate'] || 1);
          inst.scale.setScalar(s);
          inst.rotation.y = p.rot || 0;
          inst.position.set(X, PY + ((propBaseOffset['crate']||0) * s + (p.oy || 0)), Z);
          inst.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
          group.add(inst);
          if(propRoom>=0) standaloneRooms.push({mesh:inst, rid:propRoom});
          break;
        }
        S.crate.add(X, PY, Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, lerpC(0x7a4e28, 0x9a6e38, cellRng.raw()), dl, propRoom);
        break;
      }
      case 'table':
        S.table.add(X, PY, Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x7a4e28, dl, propRoom);
        break;
      case 'bench':
        S.bench.add(X, PY, Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x6b4220, dl, propRoom);
        break;
      case 'chair':
        S.chair.add(X, PY, Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x6b4220, dl, propRoom);
        break;
      case 'bookshelf':
        S.bookshelf.add(X, PY, Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x5a3214, dl, propRoom);
        break;
      case 'weaponRack': {
        if(propAssets['weaponRack']){
          const inst = propAssets['weaponRack'].clone(true);
          const s = (p.scale||1) * (PROP_SCALE_MULTIPLIER['weaponRack'] || 1);
          inst.scale.setScalar(s);
          inst.rotation.y = p.rot || 0;
          inst.position.set(X, PY + ((propBaseOffset['weaponRack']||0) * s + (p.oy || 0)), Z);
          inst.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
          group.add(inst);
          if(propRoom>=0) standaloneRooms.push({mesh:inst, rid:propRoom});
          break;
        }
        S.weaponRack.add(X, PY, Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x6b4a2f, dl, propRoom);
        break;
      }
      case 'statue':
        S.statue.add(X, PY, Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, lerpC(TH.pillar, 0xffffff, 0.15), dl, propRoom);
        break;
      case 'urn':
        S.urn.add(X, PY, Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, lerpC(0x9e6a45, 0x6a452e, cellRng.raw()), dl, propRoom);
        break;
      case 'rug':
        S.rug.add(X, PY, Z, p.scale||1,1,p.scale||1, p.rot||0, 0xd4af37, dl, propRoom);
        break;
      case 'magicCircle':
        S.magicCircle.add(X, PY, Z, p.scale||1,1,p.scale||1, p.rot||0, TH.accent ? parseInt(TH.accent.slice(1),16) : 0x3fd0bb, dl, propRoom);
        break;
      case 'tapestry': {
        const ry = Math.atan2(p.dx||0, p.dy||1);
        S.tapestry.add(wx(p.x)+(p.dx||0)*0.48, PY + (0), wz(p.y)+(p.dy||0)*0.48, 1,1,1, ry, TH.cloth, dl, propRoom);
        break; }
      case 'sconce': {
        const ry = Math.atan2(p.dx||0, p.dy||1);
        const sx = wx(p.x)+(p.dx||0)*0.48, sz = wz(p.y)+(p.dy||0)*0.48;
        S.sconce.add(sx, PY + (0), sz, 1,1,1, ry, 0x8a7248, dl, propRoom);
        S.flame.add(sx+(p.dx||0)*0.12, PY + (1.06), sz+(p.dy||0)*0.12, 0.8,0.8,0.8, 0, TH.flame, dl+0.05, propRoom);
        S.flameCore.add(sx+(p.dx||0)*0.12, PY + (1.08), sz+(p.dy||0)*0.12, 0.8,0.8,0.8, 0, TH.flameCore, dl+0.05, propRoom);
        break; }
      case 'forge': {
        const fY = p.oy || 0;
        S.forge.add(X, PY + (fY), Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x4a4540, dl, propRoom);
        S.coals.add(X, PY + (fY + 0.55*(p.scale||1)), Z, 0.8*(p.scale||1), 0.8*(p.scale||1), 0.8*(p.scale||1), 0, 0xff5a1f, dl+0.1, propRoom);
        S.flame.add(X, PY + (fY + 0.65*(p.scale||1)), Z, 0.9*(p.scale||1), 0.9*(p.scale||1), 0.9*(p.scale||1), 0, TH.flame, dl+0.12, propRoom);
        break; }
      case 'cauldron':
        S.cauldron.add(X, PY + (p.oy||0), Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x2a2826, dl, propRoom);
        break;
      case 'ossuaryWall': {
        // Enforce pure cardinal wall normal facing into the room
        let dx = p.dx || 0, dy = p.dy || 0;
        if (Math.abs(dx) >= Math.abs(dy)) { dx = dx >= 0 ? 1 : -1; dy = 0; }
        else { dy = dy > 0 ? 1 : -1; dx = 0; }
        const ry = Math.atan2(-dx, -dy);
        const ox = wx(p.x) + dx * 0.48, oz = wz(p.y) + dy * 0.48;
        S.ossuaryFrame.add(ox, PY + (0), oz, p.scale||1, p.scale||1, p.scale||1, ry, TH.wall, dl, propRoom);
        S.ossuaryBones.add(ox, PY + (0), oz, p.scale||1, p.scale||1, p.scale||1, ry, 0xfff8ee, dl+0.04, propRoom);
        break; }
      case 'sporePod':
        S.sporePod.add(X, PY, Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x59d68f, dl, propRoom);
        break;
      case 'megalith':
        S.megalith.add(X, PY, Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, lerpC(TH.wall, 0x8a929a, cellRng.raw()), dl, propRoom);
        break;
      case 'wagon':
        S.wagon.add(X, PY, Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x6b4a2f, dl, propRoom);
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
          p.rot||0, lerpC(TH.wall, 0x4a3b32, 0.3), dl, propRoom);
        break; }
      case 'iceThrone':
        S.iceThrone.add(X, PY, Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0xbfe2ff, dl, propRoom);
        break;
      case 'globe':
        S.globe.add(X, PY, Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0xc8a24a, dl, propRoom);
        break;
      case 'stalagmite':
        S.stalagmite.add(X, PY, Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, lerpC(TH.wall, 0x22242b, 0.4), dl, propRoom);
        break;
      case 'boulderPile':
        S.boulderPile.add(X, PY, Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, lerpC(TH.debris[0], TH.debris[1], cellRng.raw()), dl, propRoom);
        break;
      case 'forgeChains':
        S.forgeChains.add(X, PY, Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x3d4148, dl, propRoom);
        break;
      case 'hangingChains': {
        let dx = p.dx || 0, dy = p.dy || 0;
        if (Math.abs(dx) >= Math.abs(dy)) { dx = dx >= 0 ? 1 : -1; dy = 0; }
        else { dy = dy > 0 ? 1 : -1; dx = 0; }
        const ry = Math.atan2(-dx, -dy);
        const hx = wx(p.x) + dx * 0.48, hz = wz(p.y) + dy * 0.48;
        S.hangingChains.add(hx, PY + (p.oy||0), hz, p.scale||1, p.scale||1, p.scale||1, ry, 0x3a3d44, dl, propRoom);
        break; }
      case 'magmaBridge':
        S.magmaBridge.add(X, PY + (p.oy||0), Z, p.scale||1, p.scale||1, p.scale||1, p.rot||0, 0x484c56, dl, propRoom);
        break;
      case 'woodBridge':
        S.woodBridge.add(X, PY + (p.oy||0), Z, p.scale||1, p.scale||1, p.scale||1, p.rot||0, 0x7a5a38, dl, propRoom);
        break;
      case 'bridgeRailing':
      case 'woodRailing': {
        /* Placed per bridge EDGE rather than baked into the deck tile, so a
           3-wide crossing is railed at its two outer rows and open down the
           middle. ox/oz pick the side; the deck's top face is at 0.14. */
        const rs = p.scale||1;
        /* Sit the railing ON the deck. The two decks are not the same height —
           the iron span's top face is at 0.20, the timber one's at 0.175 —
           and a single hardcoded 0.14 left both of them floating. */
        const deckTop = p.kind === 'woodRailing' ? 0.175 : 0.20;
        S[p.kind].add(X + (p.ox||0), PY + deckTop + (p.oy||0), Z + (p.oz||0),
                      rs, rs, rs, p.rot||0,
                      p.kind === 'woodRailing' ? 0x6b4d30 : 0x4a4038, dl, propRoom);
        break;
      }
      case 'magmaBridgeApproach':
        S.magmaBridgeApproach.add(X, PY + (p.oy||0), Z, p.scale||1, p.scale||1, p.scale||1, p.rot||0, 0x5a544c, dl, propRoom);
        break;
      case 'swampgrass': case 'swampgrass2': case 'swampgrass3': {
        const sgY = p.oy || 0;
        const grassBase = (TH.cap || TH.floor || 0x4e582c);
        const wallTone = (TH.wall || 0x3e4a32);
        const col = _c.set(grassBase).lerp(new THREE.Color(wallTone), cellRng.f(0.15, 0.45)).multiplyScalar(cellRng.f(1.02, 1.22)).getHex();
        S[p.kind].add(X, PY + sgY, Z, p.scale || 1, p.scale || 1, p.scale || 1, p.rot || 0, col, dl, propRoom);
        break;
      }
      case 'ingotStack': {
        const iY = p.oy || 0;
        S.ingotStack.add(X, PY + (iY), Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x5a5f6b, dl, propRoom);
        break; }
      case 'goldBullion': {
        const gbY = p.oy || 0;
        S.goldBullion.add(X, PY + (gbY), Z, p.scale||1, p.scale||1, p.scale||1, p.rot||0, 0xffd24d, dl+0.12, propRoom);
        break; }
      case 'smeltingCrucible': {
        const scY = p.oy || 0;
        S.smeltingCrucible.add(X, PY + (scY), Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x2a2826, dl, propRoom);
        S.crucibleLiquid.add(X, PY + (scY), Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0xff7a20, dl+0.15, propRoom);
        break; }
      case 'mammothTusks':
        S.mammothTusks.add(X, PY + (p.oy||0), Z, p.scale||1, p.scale||1, p.scale||1, p.rot||0, 0xf0ebe1, dl, propRoom);
        break;
      case 'runicObelisk': {
        const obY = p.oy || 0;
        S.runicObelisk.add(X, PY + (obY), Z, p.scale||1, p.scale||1, p.scale||1, p.rot||0, 0x4e5866, dl, propRoom);
        S.runicObeliskGlow.add(X, PY + (obY), Z, p.scale||1, p.scale||1, p.scale||1, p.rot||0, 0x38bdf8, dl+0.25, propRoom);
        break; }
      case 'shieldRack':
        S.shieldRack.add(X, PY + (p.oy||0), Z, p.scale||1, p.scale||1, p.scale||1, p.rot||0, 0x5a4432, dl, propRoom);
        break;
      case 'hearthPit':
        S.hearthPit.add(X, PY + (p.oy||0), Z, p.scale||1, p.scale||1, p.scale||1, p.rot||0, 0x3d3835, dl, propRoom);
        S.flame.add(X, PY + ((p.oy||0)+0.25), Z, (p.scale||1)*0.9, (p.scale||1)*0.9, (p.scale||1)*0.9, 0, 0x38bdf8, dl+0.1, propRoom);
        break;
      case 'boneTotem':
        S.boneTotem.add(X, PY + (p.oy||0), Z, p.scale||1, p.scale||1, p.scale||1, p.rot||0, 0x9a8e80, dl, propRoom);
        break;
      case 'glacialSpire':
        S.glacialSpire.add(X, PY + (p.oy||0), Z, p.scale||1, p.scale||1, p.scale||1, p.rot||0, 0x7de6ff, dl+0.1, propRoom);
        break;
    }
  }

  for(const t of d.torches){
    const ry = Math.atan2(t.dx, t.dy);
    const X = wx(t.x)+t.dx*0.5, Z = wz(t.y)+t.dy*0.5, dl = nearFloorBfs(t.x,t.y)*dStep + 0.66;
    const tc = idx(t.x + t.dx, t.y + t.dy);
    const trid = d.roomId[tc] >= 0 ? d.roomId[tc] : -2 - tc;
    /* A torch is mounted relative to the floor it lights, not to the base
       plane — `tc` is that floor cell. Left at 0 the sconce ends up at knee
       height beside a raised tier, or overhead beside a sunken one. */
    const tY = surfY(tc);
    S.torchArm.add(X, tY + 1.02, Z, 1,1,1, ry, 0x4a4038, dl, trid);
    S.flame.add(X+t.dx*0.16, tY + 1.5, Z+t.dy*0.16, 1.2,1.2,1.2, 0, TH.flame, dl+0.08, trid);
    S.flameCore.add(X+t.dx*0.16, tY + 1.53, Z+t.dy*0.16, 1.2,1.2,1.2, 0, TH.flameCore, dl+0.08, trid);
  }

  /* Mob spawn visual markers (pedestals & floating crystals) removed per user request */

  /* Themed doorways: post/lintel silhouette + material per theme, same
     resolution pattern as the spawn portals below. Declared here because the
     arch loop needs the tints and setDefs needs the geometry. */
  const dth = DOORWAY_THEMES[d.params.themeKey] || DOORWAY_THEMES.ancient;
  const doorMat = dth.matName === 'ice' ? matIce : (dth.matName === 'bark' ? matBark : matStone);
  const doorPostGeo = GEO[dth.postGeoName] || GEO.archPost;
  const doorLintelGeo = GEO[dth.lintelGeoName] || GEO.archLintel;

  for(const a of d.arches){
    const X=wx(a.x), Z=wz(a.y);
    const half = a.len * 0.5 + 0.02;
    const dlA = nearFloorBfs(Math.round(a.x), Math.round(a.y))*dStep + 0.7;
    /* Per-theme tints; a null in the table means "stay neutral, follow the
       theme's wall colour" (the pre-themed behaviour). */
    const postCol = dth.postCol != null ? dth.postCol : lerpC(TH.wall, 0xffffff, 0.12);
    const lintelCol = dth.lintelCol != null ? dth.lintelCol : postCol;
    const dcell = -2 - idx(Math.round(a.x), Math.round(a.y));
    const rot = a.px===1 ? 0 : Math.PI/2;
    /* Posts face inward from either side of the opening: mirroring the far post
       keeps asymmetric silhouettes (leaning stones, side roots) reading as a
       matched pair rather than two copies pointing the same way. */
    if(a.px===1){
      S.arch.add(X-half,0,Z, 1,1.08,1, 0, postCol, dlA, dcell);
      S.arch.add(X+half,0,Z, 1,1.08,1, Math.PI, postCol, dlA, dcell);
      S.archL.add(X,1.88,Z, a.len+0.08,1,1, 0, lintelCol, dlA+0.1, dcell);
    } else {
      S.arch.add(X,0,Z-half, 1,1.08,1, Math.PI/2, postCol, dlA, dcell);
      S.arch.add(X,0,Z+half, 1,1.08,1, -Math.PI/2, postCol, dlA, dcell);
      S.archL.add(X,1.88,Z, a.len+0.08,1,1, Math.PI/2, lintelCol, dlA+0.1, dcell);
    }
    S.gate.add(X, 0, Z, a.len, 1.8, 1, rot, lerpC(TH.wall, 0x000000, dth.gateMix ?? 0.2), dlA+0.05, dcell);
  }

  if(TH.pools){
    liquidMat.uniforms.uMode.value = TH.pools.mode;
    liquidMat.uniforms.uColA.value.set(TH.pools.colA);
    liquidMat.uniforms.uColB.value.set(TH.pools.colB);
    liquidMat.uniforms.uGlow.value = TH.pools.glow;
  }
  if(d.pools.length){
    const skirtC = TH.pools.mode===0 ? 0xff5a1f : (TH.pools.mode===3 ? 0x33531e : 0x11463c);
    /* Nearest FLOOR cell, used to decide which room's fog reveal owns this
       liquid tile. Multi-tile bodies have interior cells whose 4 neighbours are
       all POOL, so a 1-ring lookup isn't enough — widen the search a little
       before giving up. */
    const anchorOf = p => { const c = idx(p.x,p.y);
      if(grid[c+1]===FLOOR) return c+1; if(grid[c-1]===FLOOR) return c-1;
      if(grid[c+W]===FLOOR) return c+W; if(grid[c-W]===FLOOR) return c-W;
      for(let r=2; r<=4; r++)
        for(let oy=-r; oy<=r; oy++) for(let ox=-r; ox<=r; ox++){
          if(Math.max(Math.abs(ox),Math.abs(oy)) !== r) continue;   // ring only
          const nx = p.x+ox, ny = p.y+oy;
          if(nx<0 || ny<0 || nx>=W || ny>=H) continue;
          const n = idx(nx,ny);
          if(grid[n]===FLOOR) return n;
        }
      return -1; };
    const poolGroups = new Map();
    for(const p of d.pools){
      const dl = nearFloorBfs(p.x,p.y)*dStep + 0.5;
      const a = anchorOf(p), rid = a>=0 ? roomId[a] : -1;
      const fogId = rid>=0 ? rid : (a>=0 ? -2-a : -1);
      /* Basin and rim sit at the WATERLINE, not the base plane. Left at 0,
         a pool levelled onto a raised tier floated above its own basin with
         open void under the surface — the "water hovering with no texture"
         report. Pool cells are not FLOOR, which is exactly why the scene Y
         audit walked straight past this. */
      const pY = surfY(idx(p.x, p.y));
      S.basin.add(wx(p.x), pY, wz(p.y), 1,1,1, 0, lerpC(TH.wall,0x000000,0.35), dl, fogId);
      /* The skirt is a crusted rim, so it only belongs on the edge of a body —
         stacking one on every interior cell of a multi-tile pool is both noisy
         and needless geometry. */
      const pc = idx(p.x, p.y);
      const isRim = grid[pc+1] !== POOL || grid[pc-1] !== POOL ||
                    grid[pc+W] !== POOL || grid[pc-W] !== POOL;
      if(isRim)
        S.skirt.add(wx(p.x), pY, wz(p.y), cellRng.f(0.85,1.25),1,cellRng.f(0.85,1.25), cellRng.f(0,6.28), skirtC, dl+0.15, fogId);
      const key = rid>=0 ? 'r'+rid : 'c'+a;
      if(!poolGroups.has(key)) poolGroups.set(key, {rid, anchors:[], cells:[]});
      const pg = poolGroups.get(key); pg.cells.push(p); if(a>=0) pg.anchors.push(a);
    }
    for(const pg of poolGroups.values()){
      const m = buildLiquidMesh(pg.cells, wx, wz, c => surfY(idx(c.x, c.y)) - 0.08);
      group.add(m); fx.liquids.push(m);
      standaloneRooms.push(pg.rid>=0 ? {mesh:m, rid:pg.rid} : {mesh:m, cells:pg.anchors});
    }
  }
  if(d.lakeCells.length){
    const byRoom = new Map();
    for(const lc of d.lakeCells){
      const r = roomId[idx(lc.x,lc.y)];
      if(!byRoom.has(r)) byRoom.set(r, []);
      byRoom.get(r).push(lc);
    }
    for(const [r, cells] of byRoom){
      const m = buildLiquidMesh(cells, wx, wz, c => surfY(idx(c.x, c.y)) - 0.12);
      group.add(m); fx.liquids.push(m);
      standaloneRooms.push({mesh:m, rid:r});
    }
  }

  const TT = TH.tile || {};
  const decDl = t => nearFloorBfs(t.x,t.y)*dStep + 0.35;
  if(TT.runes){
    const byRoom = new Map();
    for(const t of decCand) if(t.rid>=0 && !t.walls8){
      if(!byRoom.has(t.rid)) byRoom.set(t.rid, []);
      byRoom.get(t.rid).push(t);
    }
    for(const tiles of byRoom.values()){
      if(!cellRng.chance(TT.runes)) continue;
      const t = tiles[cellRng.i(0, tiles.length-1)];
      const s = cellRng.f(0.8,1.1);
      S.runeSeal.add(wx(t.x), (t.surfY||0), wz(t.y), s,1,s, cellRng.f(0,6.28),
                     lerpC(0x7a5220, accC, 0.25), decDl(t), t.rid);
    }
  }
  if(TT.embers) for(const t of decCand){
    if(!cellRng.chance(TT.embers)) continue;
    const s = cellRng.f(0.55,1.0);
    S.ember.add(wx(t.x), (t.surfY||0), wz(t.y), s,1,s, cellRng.f(0,6.28),
                lerpC(0x8a3512, 0xff5a1f, cellRng.raw()), decDl(t), t.rid);
  }
  if(TT.rime) for(const t of decCand){
    if(!t.walls8 || !cellRng.chance(TT.rime)) continue;
    const s = cellRng.f(0.8,1.3);
    S.rime.add(wx(t.x), (t.surfY||0), wz(t.y), s,1,s, cellRng.f(0,6.28),
               lerpC(0x4a7290, 0x86b8d8, cellRng.raw()), decDl(t), t.rid);
  }
  if(TT.stains) for(const t of decCand){
    if(!cellRng.chance(TT.stains)) continue;
    const s = cellRng.f(0.7,1.45);
    S.stain.add(wx(t.x), (t.surfY||0), wz(t.y), s,1,s, cellRng.f(0,6.28),
                lerpC(0x0d120c, 0x1c2416, cellRng.raw()), decDl(t), t.rid);
  }
  if(TT.growth) for(const t of decCand){
    const hit = t.walls8 ? cellRng.chance(TT.growth) : cellRng.chance(TT.sprout||0);
    if(!hit) continue;
    const s = cellRng.f(0.75,1.35);
    S.growth.add(wx(t.x), (t.surfY||0), wz(t.y), s,1,s, cellRng.f(0,6.28),
                 lerpC(0x2e5230, 0x4f7f42, cellRng.raw()), decDl(t), t.rid);
  }

  const sth = SPAWN_THEMES[d.params.themeKey] || SPAWN_THEMES.ancient;
  const spawnMat = sth.spawnMatName === 'ice' ? matIce : (sth.spawnMatName === 'bark' ? matBark : matStone);
  const spawn1Geo = GEO[sth.spawn1GeoName] || GEO.spawn1;
  const spawn2Geo = GEO[sth.spawn2GeoName] || GEO.spawn2;
  const spawn3Geo = GEO[sth.spawn3GeoName] || GEO.spawn3;

  const setDefs = [
    ['pillar',   GEO.pillar,    matStone,  'rise', 0.4,  1],
    ['arch',     doorPostGeo,   doorMat,   'rise', 0.45, 1],
    ['archL',    doorLintelGeo, doorMat,   'pop',  0.35, 1],
    ['gate',     GEO.gate,      doorMat,   'rise', 0.4,  1],
    ['torchArm', GEO.torch,     matTrim,   'pop',  0.3,  0],
    ['flame',    GEO.flame,     matGlow,   'pop',  0.3,  0],
    ['flameCore',GEO.flameCore, matGlow,   'pop',  0.3,  0],
    ['debrisA',  GEO.debrisA,   matStone,  'pop',  0.3,  2],
    ['debrisB',  GEO.debrisB,   matStone,  'pop',  0.3,  2],
    ['debrisC',  GEO.debrisC,   matStone,  'pop',  0.3,  2],
    ['chest',    GEO.chestBody, matStone,  'pop',  0.35, 1],
    ['chestTrim',GEO.chestTrim, matTrim,   'pop',  0.35, 0],
    ['chestGlow',GEO.chestSeam, matGlow,   'pop',  0.4,  0],
    ['grave',    GEO.grave,     matStone,  'rise', 0.4,  1],
    ['sarco',    GEO.sarco,     matStone,  'pop',  0.4,  1],
    ['candle',   GEO.candle,    matStone,  'pop',  0.3,  0],
    ['bone',     GEO.bone,      matBoneStone,  'pop',  0.3,  0],
    ['skull',    GEO.skull,     matBoneStone,  'pop',  0.35, 1],
    ['skeleton', GEO.skeleton,  matBoneStone,  'pop',  0.35, 1],
    ['bonePile', GEO.bonePile,  matBoneStone,  'pop',  0.35, 1],
    ['spiderWeb',GEO.spiderWeb, matWeb,        'pop',  0.4,  0],
    ['icicle',   GEO.icicle,    matIce,    'pop',  0.35, 0],
    ['shardIce', GEO.shard,     matIce,    'pop',  0.35, 0],
    ['roots',    GEO.roots,     matBark,   'rise', 0.5,  1],
    ['moss',     GEO.moss,      matMoss,   'pop',  0.4,  0],
    ['crackD',   GEO.crack,     matCrackD, 'pop',  0.4,  0],
    ['skirt',    GEO.skirt,     matSkirt,  'pop',  0.5,  0],
    ['bannerRod',GEO.bannerRod, matTrim,   'pop',  0.3,  0],
    ['bannerCloth',GEO.bannerCloth,matCloth,'rise',0.4,  0],
    ['emblem',   GEO.emblem,    matGlow,   'pop',  0.3,  0],
    ['spawn1',   spawn1Geo,     spawnMat,  'rise', 0.4,  1],
    ['spawn2',   spawn2Geo,     spawnMat,  'rise', 0.4,  1],
    ['spawn3',   spawn3Geo,     spawnMat,  'rise', 0.4,  1],
    ['band2',    GEO.band2,     matGlow,   'pop',  0.3,  0],
    ['band3',    GEO.band3,     matGlow,   'pop',  0.3,  0],
    ['crystal',  GEO.crystal,   matGlow,   'pop',  0.4,  0],
    ['ring',     GEO.ring,      matGlow,   'pop',  0.4,  0],
    ['plinth',   GEO.plinth,    matStone,  'pop',  0.4,  1],
    ['platform', GEO.platform,  matStone,  'pop',  0.45, 2],
    ['sepulcherDais', GEO.sepulcherDais, matStone, 'rise', 0.4, 2],
    ['brazier',  GEO.brazier,   matTrim,   'pop',  0.35, 1],
    ['tent',     GEO.tent,      matCloth,  'rise', 0.4,  1],
    ['coals',    GEO.coals,     matGlow,   'pop',  0.35, 0],
    ['campfireStones',   GEO.campfireStones,    matStone,  'pop', 0.35, 1],
    ['campfireLogs',     GEO.campfireLogs,      matBark,   'rise',0.4,  1],
    ['campfireCoals',    GEO.campfireCoals,     matEmber,  'pop', 0.35, 0],
    ['campfireFlames',   GEO.campfireFlames,    matGlow,   'pop', 0.3,  0],
    ['campfireFlameCore',GEO.campfireFlameCore, matGlow,   'pop', 0.3,  0],
    ['basin',    GEO.basin,     matStone,  'pop',  0.3,  0],
    ['bossGlow', GEO.bossShard, matGlow,   'rise', 0.5,  0],
    ['bossRock', GEO.bossShard, matStone,  'rise', 0.5,  1],
    ['runeSeal', GEO.seal,      matRuneSeal,'pop', 0.45, 0],
    ['ember',    GEO.crack,     matEmber,  'pop',  0.4,  0],
    ['rime',     GEO.blot,      matBlotAdd,'pop',  0.5,  0],
    ['stain',    GEO.blot,      matBlot,   'pop',  0.5,  0],
    ['growth',   GEO.blot,      matBlot,   'pop',  0.5,  0],
    ['barrel',   GEO.barrel,    matWood,   'pop',  0.35, 1],
    ['crate',    GEO.crate,     matWood,   'pop',  0.35, 1],
    ['table',    GEO.table,     matWood,   'pop',  0.4,  1],
    ['bench',    GEO.bench,     matWood,   'pop',  0.35, 1],
    ['chair',    GEO.chair,     matWood,   'pop',  0.3,  1],
    ['bookshelf',GEO.bookshelf, matWood,   'rise', 0.45, 1],
    ['weaponRack',GEO.weaponRack,matWood,  'rise', 0.4,  1],
    ['statue',   GEO.statue,    matStone,  'rise', 0.5,  1],
    ['urn',      GEO.urn,       matCeramic,'pop',  0.35, 1],
    ['rug',      GEO.rug,       matRug,    'pop',  0.4,  0],
    ['magicCircle',GEO.magicCircle,matMagicCircle,'pop',0.45, 0],
    ['tapestry', GEO.tapestry,  matTapestry,'rise',0.45, 0],
    ['sconce',   GEO.sconce,    matSconce, 'pop',  0.3,  0],
    ['forge',    GEO.forge,     matMetal,  'pop',  0.4,  1],
    ['cauldron', GEO.cauldron,  matMetal,  'pop',  0.35, 1],
    ['ossuaryFrame',GEO.ossuaryFrame,matStone,'rise',0.45,1],
    ['ossuaryBones',GEO.ossuaryBones,matBoneStone,'rise',0.45,1],
    ['sporePod', GEO.sporePod,  matBiolum, 'pop',  0.4,  0],
    ['megalith', GEO.megalith,  matStone,  'rise', 0.5,  1],
    ['wagon',    GEO.wagon,     matWood,   'pop',  0.45, 1],
    ['altarTable',GEO.altarTable,matStone, 'pop',  0.4,  1],
    ['iceThrone',GEO.iceThrone, matGlacialIce,'rise',0.45,1],
    ['globe',    GEO.globe,     matMetal,  'pop',  0.35, 1],
    ['stalagmite',GEO.stalagmite,matStone, 'rise', 0.45, 1],
    ['boulderPile',GEO.boulderPile,matStone,'pop', 0.35, 1],
    ['forgeChains',GEO.forgeChains,matMetal,'pop', 0.35, 0],
    ['hangingChains',GEO.hangingChains,matMetal,'pop',0.35, 0],
    ['bridgeRailing',GEO.bridgeRailing,matMetal,'rise',0.4, 0],
    ['magmaBridge',GEO.magmaBridge,matMetal,'rise',0.45, 1],
    ['magmaBridgeApproach',GEO.magmaBridgeApproach,matStone,'rise',0.4, 1],
    ['woodBridge',GEO.woodBridge,matWood,'rise',0.45, 1],
    ['woodRailing',GEO.woodRailing,matWood,'rise',0.4, 0],
    ['ingotStack',GEO.ingotStack,matMetal, 'pop',  0.35, 1],
    ['goldBullion',GEO.goldBullion,matGoldBullion, 'pop', 0.35, 1],
    ['smeltingCrucible',GEO.smeltingCrucible,matMetal,'pop',0.4,1],
    ['crucibleLiquid',GEO.crucibleLiquid,matGlow,'pop',0.35,0],
    ['mammothTusks',GEO.mammothTusks,matBoneStone,'rise',0.45,1],
    ['runicObelisk',GEO.runicObelisk,matStone,'rise',0.5,1],
    ['runicObeliskGlow',GEO.runicObeliskGlow,matGlow,'pop',0.4,0],
    ['shieldRack',GEO.shieldRack,matWood,'pop',0.4,1],
    ['hearthPit',GEO.hearthPit,matStone,'pop',0.35,1],
    ['boneTotem',GEO.boneTotem,matBoneStone,'rise',0.45,1],
    ['glacialSpire',GEO.glacialSpire,matGlacialIce,'rise',0.45,1],
    ['cornerRubbleA',GEO.cornerRubbleA,matWallCap,'pop',0.35,1],
    ['cornerRubbleB',GEO.cornerRubbleB,matWallCap,'pop',0.35,1],
    ['cornerRubbleC',GEO.cornerRubbleC,matWallCap,'pop',0.35,1],
    ['cornerRubbleD',GEO.cornerRubbleD,matWallCap,'pop',0.35,1],
    ['fallenBrick',GEO.fallenBrick,matWallCap,'pop',0.3,1],
    ['swampgrass', GEO.swampgrass, matSwampGrass, 'pop', 0.35, 2],
    ['swampgrass2',GEO.swampgrass2,matSwampGrass, 'pop', 0.35, 2],
    ['swampgrass3',GEO.swampgrass3,matSwampGrass, 'pop', 0.35, 2]
  ];
  for(const [k, geo, mat, mode, dur, sh] of setDefs) meshes[k] = buildMesh(S[k], geo, mat, mode, dur, sh);
  if (S.cornerRubbleA.n > 0) setAtlasAttr(GEO.cornerRubbleA, rubbleAUv, S.cornerRubbleA.n);
  if (S.cornerRubbleB.n > 0) setAtlasAttr(GEO.cornerRubbleB, rubbleBUv, S.cornerRubbleB.n);
  if (S.cornerRubbleC.n > 0) setAtlasAttr(GEO.cornerRubbleC, rubbleCUv, S.cornerRubbleC.n);
  if (S.cornerRubbleD.n > 0) setAtlasAttr(GEO.cornerRubbleD, rubbleDUv, S.cornerRubbleD.n);
  if (S.fallenBrick.n > 0)   setAtlasAttr(GEO.fallenBrick, brickUv, S.fallenBrick.n);
  for(const k in meshes) group.add(meshes[k]);

  /* Hide mob spawn towers / markers from rendering as requested by user */
  if (meshes.spawn1) meshes.spawn1.visible = false;
  if (meshes.spawn2) meshes.spawn2.visible = false;
  if (meshes.spawn3) meshes.spawn3.visible = false;
  if (meshes.band2) meshes.band2.visible = false;
  if (meshes.band3) meshes.band3.visible = false;

  if(portalXZ){
    matPortal.color.set(0x3fd0bb);
    const m = new THREE.Mesh(GEO.portal, matPortal);
    m.position.set(portalXZ[0], 0.01, portalXZ[1]);
    group.add(m); fx.spinners.push({m, spd:0.55});
    standaloneRooms.push({mesh:m, rid: d.entrance});
  }
  if(runeXZ){
    matRune.color.set(0xff5040);
    const m = new THREE.Mesh(GEO.runeRing, matRune);
    m.position.set(runeXZ.x, surfYW(runeXZ.x, runeXZ.z) + 0.06, runeXZ.z);
    m.scale.setScalar(runeXZ.s);
    group.add(m); fx.spinners.push({m, spd:-0.16});
    standaloneRooms.push({mesh:m, rid: d.boss});
  }
  /* Light shafts disabled */


  if(TH.particles){
    const spec = TH.particles;
    const pts = [];
    const pp = (x,z,y)=>pts.push({x,z,y, cell: floorAnchor(x + W/2 - 0.5, z + H/2 - 0.5)});
    if(spec.kind===1){
      for(const p of d.pools){
        for(let k=0; k<4; k++){
          pp(wx(p.x)+cellRng.f(-0.45,0.45), wz(p.y)+cellRng.f(-0.45,0.45), -0.02);
        }
      }
      for(const t of d.torches) pp(wx(t.x)+t.dx*0.66, wz(t.y)+t.dy*0.66, 1.5);
      for(const p of d.props) if(p.kind==='brazier') pp(wx(p.x), wz(p.y), 0.62);
    } else if(spec.kind===3){
      for(const p of d.props){
        if(p.kind==='grave' || p.kind==='sarco' || p.kind==='tombstone') pp(wx(p.x)+cellRng.f(-0.2,0.2), wz(p.y)+cellRng.f(-0.2,0.2), 0.3);
        else if(p.kind==='candle') pp(wx(p.x), wz(p.y), 0.25);
        else if(p.kind==='bones') pp(wx(p.x), wz(p.y), 0.1);
      }
      for(const p of d.pools) pp(wx(p.x), wz(p.y), 0);
    } else if(spec.kind===4){
      for(const p of d.props){
        if(p.kind==='moss' || p.kind==='mushroomA' || p.kind==='mushroomB') pp(wx(p.x)+cellRng.f(-0.25,0.25), wz(p.y)+cellRng.f(-0.25,0.25), 0.05);
        else if(p.kind==='roots' || p.kind==='rootsA' || p.kind==='rootsB') pp(wx(p.x)+p.dx*0.8, wz(p.y)+p.dy*0.8, cellRng.f(0.2,1.4));
      }
      for(const p of d.pools) pp(wx(p.x), wz(p.y), 0);
    } else if(spec.kind===0){
      for(const s of shaftAt) for(let k=0;k<10;k++)
        pp(s.x+cellRng.f(-0.8,0.8)*s.s, s.z+cellRng.f(-0.8,0.8)*s.s, cellRng.f(0.3,2.4));
      for(const t of d.torches) pp(wx(t.x)+t.dx*0.7, wz(t.y)+t.dy*0.7, cellRng.f(1.2,1.9));
      for(let y=0;y<H;y++) for(let x=0;x<W;x++)
        if(grid[idx(x,y)]===FLOOR && cellRng.chance(0.12)) pp(wx(x)+cellRng.f(-0.3,0.3), wz(y)+cellRng.f(-0.3,0.3), cellRng.f(0.2,1.8));
    } else if(spec.kind===2 || spec.kind===5 || spec.kind===6){
      for(let y=0;y<H;y++) for(let x=0;x<W;x++){
        if(grid[idx(x,y)]===FLOOR){
          for(let k=0; k<3; k++){
            pp(wx(x)+cellRng.f(-0.45,0.45), wz(y)+cellRng.f(-0.45,0.45), cellRng.f(0, 0.4));
          }
        }
      }
    } else {
      for(let y=0;y<H;y++) for(let x=0;x<W;x++)
        if(grid[idx(x,y)]===FLOOR && cellRng.chance(0.35)) pp(wx(x)+cellRng.f(-0.4,0.4), wz(y)+cellRng.f(-0.4,0.4), cellRng.f(0, 0.5));
    }
    if(!pts.length)
      for(let y=0;y<H;y++) for(let x=0;x<W;x++)
        if(grid[idx(x,y)]===FLOOR && cellRng.chance(0.15)) pp(wx(x), wz(y), 0);
    if(pts.length){
      const maxPts = spec.n ? spec.n : Math.min(240, pts.length*6);
      const n = Math.min(maxPts, Math.max(40, pts.length));
      const pos = new Float32Array(n*3), seed = new Float32Array(n);
      const fogCells = new Int32Array(n), origY = new Float32Array(n);
      for(let i=0;i<n;i++){
        const p = pts[cellRng.i(0, pts.length-1)];
        pos[i*3]=p.x; pos[i*3+1]=p.y; pos[i*3+2]=p.z;
        seed[i]=cellRng.raw();
        fogCells[i]=p.cell; origY[i]=p.y;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos,3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed,1));
      levelGeos.push(g);
      partMat.uniforms.uKind.value = spec.kind;
      partMat.uniforms.uColor.value.set(spec.color);
      const pm = new THREE.Points(g, partMat);
      pm.frustumCulled = false;
      pm.renderOrder = 20;
      pm.userData.fogCells = fogCells; pm.userData.origY = origY;
      group.add(pm); fx.parts = pm;
    }
  }

  if(TH.groundFog){
    const fg = new THREE.PlaneGeometry(W + 20, H + 20).rotateX(-Math.PI / 2);
    fogPlaneMat.uniforms.uColor.value.set(TH.groundFog.color !== undefined ? TH.groundFog.color : 0xd4dad0);
    fogPlaneMat.uniforms.uDensity.value = TH.groundFog.density !== undefined ? TH.groundFog.density : 0.28;
    fogPlaneMat.uniforms.uSpeed.value = TH.groundFog.speed !== undefined ? TH.groundFog.speed : 0.035;
    fogPlaneMat.uniforms.uScale.value = TH.groundFog.scale !== undefined ? TH.groundFog.scale : 0.10;
    const fogMesh = new THREE.Mesh(fg, fogPlaneMat);
    fogMesh.position.set(0, TH.groundFog.height !== undefined ? TH.groundFog.height : 0.24, 0);
    fogMesh.renderOrder = 15;
    levelGeos.push(fg);
    group.add(fogMesh);
    fx.fogPlane = fogMesh;
  }

  const shHalf = Math.max(W,H)*0.62 + 6;
  dirL.shadow.camera.left = -shHalf; dirL.shadow.camera.right = shHalf;
  dirL.shadow.camera.top = shHalf;   dirL.shadow.camera.bottom = -shHalf;
  dirL.shadow.camera.updateProjectionMatrix();

  const budget = qualityProfile().keyBudget;
  const keys = [];
  keys.push({x:rooms[d.entrance].cx, y:rooms[d.entrance].cy, col:0x3fd0bb, i:1.8, dist:16});
  keys.push({x:rooms[d.boss].cx, y:rooms[d.boss].cy, col:0xff4030, i:2.2, dist:20, ry:2.2});
  const shr = rooms.filter(r=>r.type===TYPE.SHRINE);
  if(shr.length) keys.push({x:shr[0].cx, y:shr[0].cy, col:0x6f9dff, i:1.8, dist:16});
  const tb = Math.max(4, budget - keys.length);
  const chosen = [];
  if(d.torches.length){
    chosen.push(d.torches[0]);
    while(chosen.length < Math.min(tb, d.torches.length)){
      let best=null, bd=-1;
      for(const t of d.torches){
        let dm=1e9; for(const c of chosen){ const q=(t.x-c.x)*(t.x-c.x)+(t.y-c.y)*(t.y-c.y); if(q<dm) dm=q; }
        if(dm>bd){ bd=dm; best=t; }
      }
      chosen.push(best);
    }
  }
  let li=0;
  for(const k of keys){
    const L = new THREE.PointLight(k.col, k.i * LIGHT_K, k.dist, 2);
    L.position.set(wx(k.x), k.ry||1.6, wz(k.y));
    L.userData={base:k.i, ph:li*2.1, ramp:1, roomId: d.roomId[idx(k.x, k.y)], fogMult:1}; group.add(L); lights.push(L); li++;
  }
  const torchCol = TH.flame || (TH.torchLight && TH.torchLight[0]) || 0xff8c3a;
  const tI = torchPoolIntensity(TH), tR = torchPoolRange(TH);
  for(let i=0; i<qualityProfile().torchPool; i++){
    const L = new THREE.PointLight(torchCol, 0, tR, 2);
    L.userData = { isTorchPool: true, base: tI, ph: i*1.73, ramp: 1, fogMult: 1 };
    group.add(L); lights.push(L);
  }

  animT = 0; animEnd = 1.8; animating = true;
  writeInstancesAll(0);
}

/* Push torch intensity/range onto the live pool lights without a re-forge —
   the flicker tick reads userData.base, and nothing else touches distance. */
export function applyTorchSettings(TH){
  const i = torchPoolIntensity(TH), r = torchPoolRange(TH);
  for(const L of lights){
    if(!L.userData || !L.userData.isTorchPool) continue;
    L.userData.base = i; L.distance = r;
  }
}

export function writeInstancesAll(t){
  for(const k in meshes){
    if(meshes[k] && meshes[k].isInstancedMesh && !meshes[k].userData.settled){
      writeInstances(meshes[k], t);
    }
  }
}

export function settleAll(){
  for(const k in meshes) writeInstances(meshes[k], Infinity);
}

export function finishAnim(){
  animating = false; animT = Infinity;
  settleAll();
}

export function applyReveal(visibleRoomSet, heroPositions = []){
  for(const k in meshes){
    const mesh = meshes[k];
    if(!mesh || !mesh.isInstancedMesh) continue;
    const roomIds = mesh.userData.roomIds;
    if(!roomIds) continue;
    const set = mesh.userData.set;
    for(let i=0; i<mesh.count; i++){
      const rid = roomIds[i];
      let vis = false;
      if(rid === -1) vis = true;
      else if(visibleRoomSet && visibleRoomSet.has && visibleRoomSet.has(rid)) vis = true;
      else if(Array.isArray(heroPositions)){
        const px = set.px[i], pz = set.pz[i];
        for(const hp of heroPositions){
          if(Math.hypot(px - hp.x, pz - hp.z) < 3.5){ vis = true; break; }
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

export function liveUpdate(time, tt, dt = 0.016){
  for (const m of chestMixers) m.update(dt);
  for(const key of ['flame','flameCore','campfireFlames','campfireFlameCore']){
    const fm = meshes[key];
    if(!fm || !fm.userData.set.n) continue;
    const fu = fm.userData, s = fu.set;
    for(let i=0;i<s.n;i++){
      if(s.py[i] <= -500){
        _q.set(0,0,0,1);
        _p.set(s.px[i], -999, s.pz[i]);
        _s.set(0,0,0);
        _m.compose(_p,_q,_s); fm.setMatrixAt(i,_m);
        continue;
      }
      const k = clamp01((tt - s.delay[i]) / fu.dur);
      const g = Math.max(0.0001, k>=1 ? 1 : easeOutBack(k)*Math.min(1,k*8));
      const fl = 0.86 + 0.22*Math.sin(time*11 + i*2.7)*Math.sin(time*5.3 + i*1.31);
      _q.set(0,0,0,1);
      _p.set(s.px[i], s.py[i] + 0.03*Math.sin(time*7 + i), s.pz[i]);
      _s.set(s.sx[i]*g*(0.92 + 0.12*Math.sin(time*13 + i*3.1)), s.sy[i]*g*fl, s.sz[i]*g);
      _m.compose(_p,_q,_s); fm.setMatrixAt(i,_m);
    }
    fm.instanceMatrix.needsUpdate = true;
  }
  const cm = meshes.crystal;
  if(cm && cm.userData.set.n){ const cu = cm.userData, s = cu.set;
    for(let i=0;i<s.n;i++){
      if(s.py[i] <= -500){
        _q.set(0,0,0,1);
        _p.set(s.px[i], -999, s.pz[i]);
        _s.set(0,0,0);
        _m.compose(_p,_q,_s); cm.setMatrixAt(i,_m);
        continue;
      }
      const k = clamp01((tt - s.delay[i]) / cu.dur);
      const g = Math.max(0.0001, k>=1 ? 1 : easeOutBack(k)*Math.min(1,k*8));
      _q.setFromAxisAngle(_Y, s.ry[i] + time*0.9);
      _p.set(s.px[i], s.py[i] + 0.08*Math.sin(time*2.1 + i*1.7), s.pz[i]);
      _s.set(s.sx[i]*g, s.sy[i]*g, s.sz[i]*g);
      _m.compose(_p,_q,_s); cm.setMatrixAt(i,_m);
    }
    cm.instanceMatrix.needsUpdate = true;
  }
  liquidMat.uniforms.uTime.value = time;
  partMat.uniforms.uTime.value = time;
  fogPlaneMat.uniforms.uTime.value = time;
  matEmber.opacity = 0.72 + 0.24*Math.sin(time*2.3)*Math.sin(time*1.13);
  updateNixieVfx(dt);
  if(renderer){
    const ch = (renderer.domElement && renderer.domElement.height) || (window.innerHeight * (window.devicePixelRatio || 1)) || 1080;
    partMat.uniforms.uZoom.value = ch * cam.zoom / (2*BASE_HALF);
  }
  for(const sp of fx.spinners) sp.m.rotation.y = time * sp.spd;
  for(const L of lights){
    if(L.userData && L.userData.isTorchPool) continue;
    if(L.userData && L.userData.extinguished) { L.intensity = 0; continue; }
    const base = L.userData.base !== undefined ? L.userData.base : 1.5;
    const ph = L.userData.ph !== undefined ? L.userData.ph : 0;
    const ramp = L.userData.ramp === undefined ? 1 : L.userData.ramp;
    const fogM = L.userData.fogMult !== undefined ? L.userData.fogMult : 1;
    const fWave = 0.78 + 0.15*Math.sin(time*9.8 + ph)*Math.cos(time*5.2 + ph*1.7) + 0.07*Math.sin(time*20.0 + ph*2.5);
    L.intensity = base * LIGHT_K * ramp * fogM * Math.max(0.3, fWave);
  }

  if(D && ((D.torches && D.torches.length) || (D.props && D.props.length))){
    const wx = x => x - D.W/2 + 0.5;
    const wz = y => y - D.H/2 + 0.5;
    const idx = (x,y) => y*D.W + x;
    const surfY = c => (D.height && c >= 0 && c < D.height.length ? D.height[c] * ELEV_STEP : 0);

    let lx = (camTarget && camTarget.x !== undefined) ? camTarget.x : 0;
    let lz = (camTarget && camTarget.z !== undefined) ? camTarget.z : 0;
    if((lx === 0 && lz === 0) && game && game.heroes){
      const alive = game.heroes.filter(h => h.data.hp > 0);
      const leader = alive[game.leaderIdx] || alive[0];
      if(leader && leader.x !== undefined){ lx = leader.x; lz = leader.z; }
    }

    const TH = THEMES[D.params.themeKey || D.themeKey] || THEMES.ancient;
    const torchCol = TH.flame || (TH.torchLight && TH.torchLight[0]) || 0xff8c3a;
    const candleCol = 0xffbe58;
    const tR = torchPoolRange(TH);
    const activeEmitters = [];

    if(D.torches && D.torches.length){
      for(const t of D.torches){
        const tx = wx(t.x) + t.dx * 0.66;
        const tz = wz(t.y) + t.dy * 0.66;
        const distSq = (tx - lx)*(tx - lx) + (tz - lz)*(tz - lz);

        const tc = idx(t.x + t.dx, t.y + t.dy);
        const trid = D.roomId[tc] >= 0 ? D.roomId[tc] : (D.roomId[idx(t.x, t.y)] >= 0 ? D.roomId[idx(t.x, t.y)] : (t.roomId !== undefined ? t.roomId : -2 - tc));
        const tY = surfY(tc);

        let isVis = false;
        if(game){
          if(trid >= 0 && game.visitedRooms && game.visitedRooms[trid]){
            isVis = true;
          }
          if(!isVis && game.revealed){
            isVis = (game.revealed[tc] > 0) || (game.revealed[idx(t.x, t.y)] > 0);
          }
          if(!isVis && distSq < 1600){
            isVis = true;
          }
        } else {
          isVis = true;
        }
        if(isVis){
          activeEmitters.push({
            tx,
            ty: tY + 1.82,
            flameTipY: tY + 2.02,
            tz,
            distSq,
            color: torchCol,
            dist: tR || 11,
            intensity: Math.max(1.8, (TH.torchIntensity || 1.6)),
            kind: 'torch'
          });
        }
      }
    }

    if(D.props && D.props.length){
      for(const p of D.props){
        if(p.kind !== 'candle' && p.kind !== 'brazier') continue;
        const px = wx(p.x);
        const pz = wz(p.y);
        const distSq = (px - lx)*(px - lx) + (pz - lz)*(pz - lz);
        const cellX = Math.round(p.x), cellY = Math.round(p.y);
        const tc = idx(Math.max(0, Math.min(D.W - 1, cellX)), Math.max(0, Math.min(D.H - 1, cellY)));
        const pY = surfY(tc);
        const trid = p.roomId !== undefined ? p.roomId : (D.roomId && D.roomId[tc] >= 0 ? D.roomId[tc] : -1);

        let isVis = false;
        if(game){
          if(trid >= 0 && game.visitedRooms && game.visitedRooms[trid]){
            isVis = true;
          }
          if(!isVis && game.revealed){
            isVis = (tc >= 0 && tc < game.revealed.length && game.revealed[tc] > 0);
          }
          if(!isVis && distSq < 1600){
            isVis = true;
          }
        } else {
          isVis = true;
        }

        if(isVis){
          if(p.kind === 'candle'){
            const sc = p.scale || 1;
            activeEmitters.push({
              tx: px,
              ty: pY + (p.oy || 0) + 0.38 * sc,
              flameTipY: pY + (p.oy || 0) + 0.46 * sc,
              tz: pz,
              distSq,
              color: candleCol,
              dist: 6.2 * Math.sqrt(sc),
              intensity: 1.45 * sc,
              kind: 'candle'
            });
          } else if(p.kind === 'brazier'){
            const sc = p.scale || 1;
            activeEmitters.push({
              tx: px,
              ty: pY + (p.oy || 0) + 0.75 * sc,
              flameTipY: pY + (p.oy || 0) + 0.95 * sc,
              tz: pz,
              distSq,
              color: torchCol,
              dist: 10.0 * Math.sqrt(sc),
              intensity: 2.0 * sc,
              kind: 'brazier'
            });
          }
        }
      }
    }

    activeEmitters.sort((a,b) => a.distSq - b.distSq);

    let poolIdx = 0;
    for(const L of lights){
      if(!L.userData || !L.userData.isTorchPool) continue;
      if(poolIdx < activeEmitters.length){
        const item = activeEmitters[poolIdx];
        L.color.set(item.color);
        L.position.set(item.tx, item.ty, item.tz);
        L.distance = item.dist;
        const base = item.intensity;
        const ph = L.userData.ph || (poolIdx * 1.73);
        const fWave = item.kind === 'candle'
          ? 0.82 + 0.12*Math.sin(time*8.5 + ph)*Math.cos(time*4.6 + ph*1.5) + 0.06*Math.sin(time*17.0 + ph*2.2)
          : 0.78 + 0.16*Math.sin(time*10.2 + ph)*Math.cos(time*5.8 + ph*1.7) + 0.08*Math.sin(time*21.0 + ph*2.8);
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

  if(heroLight && game && game.heroes){
    const alive = game.heroes.filter(h => h.data.hp > 0);
    const leader = alive[game.leaderIdx] || alive[0];
    if(leader && leader.x !== undefined){
      heroLight.position.set(leader.x, 1.8, leader.z);
      const hWave = 0.80 + 0.14*Math.sin(time*9.5)*Math.cos(time*5.4) + 0.06*Math.sin(time*19.0);
      heroLight.intensity = 1.6 * LIGHT_K * (game.state === 'crawl' ? 1 : 0) * Math.max(0.3, hWave);
    }
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
        l.intensity = 0;
        l.userData.base = 0;
        l.userData.extinguished = true;
        l.visible = false;
      }
    }
  }

  // 3. Stop persistent embers near (x, z)
  stopPersistentNixieEffectsNear(x, z, radius);
}

export function setupRTs(){
  if (!renderer) return;
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  if(POST.w===size.x && POST.h===size.y && POST.rtScene) return;
  POST.w=size.x; POST.h=size.y;
  if(POST.rtScene){ POST.rtScene.dispose(); POST.rtA.dispose(); POST.rtB.dispose(); }
  const ps = {minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter, format:THREE.RGBAFormat, depthBuffer:true, stencilBuffer:false};
  POST.rtScene = new THREE.WebGLRenderTarget(size.x, size.y, {...ps, samples:4});
  const pb = {minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter, format:THREE.RGBAFormat, depthBuffer:false, stencilBuffer:false};
  POST.rtA = new THREE.WebGLRenderTarget(size.x>>2, size.y>>2, pb);
  POST.rtB = new THREE.WebGLRenderTarget(size.x>>2, size.y>>2, pb);
}

export function renderFrame(){
  if(!renderer) return;
  if(!POST.enabled){
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
  POST.blur.uniforms.uRes.value.set(POST.w>>2, POST.h>>2);
  POST.blur.uniforms.tS.value = POST.rtA.texture; POST.blur.uniforms.uDir.value.set(1,0);
  renderer.setRenderTarget(POST.rtB); renderer.render(POST.sBlur, POST.qcam);
  POST.blur.uniforms.tS.value = POST.rtB.texture; POST.blur.uniforms.uDir.value.set(0,1);
  renderer.setRenderTarget(POST.rtA); renderer.render(POST.sBlur, POST.qcam);
  POST.fin.uniforms.tS.value = POST.rtScene.texture;
  POST.fin.uniforms.tB.value = POST.rtA.texture;
  POST.fin.uniforms.uRes.value.set(POST.w, POST.h);
  POST.fin.uniforms.uTime.value = elapsed;
  renderer.setRenderTarget(null); renderer.render(POST.sFinal, POST.qcam);
}

const timer = new THREE.Timer();
let fpsFrames = 0, fpsTime = 0;

export function tick(){
  if (!renderer) return;
  if(document.hidden) setTimeout(tick, 100);
  else requestAnimationFrame(tick);
  timer.update();
  const rawDt = Math.min(timer.getDelta(), 0.05);
  elapsed += rawDt;

  if (Math.abs(gameTimeScale - 1.0) > 0.001) {
    gameTimeScale += (1.0 - gameTimeScale) * Math.min(1, rawDt * 10);
    if (Math.abs(gameTimeScale - 1.0) < 0.002) gameTimeScale = 1.0;
  }
  if (shakeIntensity > 0.001) {
    shakeIntensity *= Math.exp(-rawDt * 8);
    if (shakeIntensity < 0.002) shakeIntensity = 0;
  }

  const gameDt = rawDt * gameTimeScale;
  if(animating){
    animT += rawDt;
    writeInstancesAll(animT);
    if(animT > animEnd + 0.35) finishAnim();
  }
  liveUpdate(elapsed, animating ? animT - 2.3 : Infinity, rawDt);
  if(game && typeof game.update === 'function'){
    game.update(gameDt, elapsed);
  }
  renderer.info.reset();
  renderFrame();
  tickPerfOverlay(rawDt, { renderer, scene, game });
  fpsFrames++; fpsTime += rawDt;
  if(fpsTime >= 0.5){
    const elFps = document.getElementById('sFps');
    const elCalls = document.getElementById('sCalls');
    const elTris = document.getElementById('sTris');
    if(elFps) elFps.textContent = Math.round(fpsFrames/fpsTime);
    if(elCalls) elCalls.textContent = renderer.info.render.calls;
    if(elTris){
      const tr = renderer.info.render.triangles;
      elTris.textContent = tr > 1e6 ? (tr/1e6).toFixed(2)+'M' : Math.round(tr/1e3)+'k';
    }
    fpsFrames = 0; fpsTime = 0;
  }
}
