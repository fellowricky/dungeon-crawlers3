/**
 * DUNGEON FORGE — WebGL Scene, Camera, Instanced Rendering & Render Loop.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { game } from '../game/game.js';
import { THEMES, SPAWN_THEMES, DOORWAY_THEMES, THEME_KEYS, VOID, FLOOR, WALL, POOL, TYPE, TINT, makeRng } from '../dungeon/dungeon_generator.js';
import { GEO, boxUV, bgFromTris, chamferBox, spireGeo, xg, mergeGeos } from './dungeon_geo.js';
import CUSTOM_PROPS from '../game/custom_props.json' with { type: 'json' };
import {
  TEX, matStone, matWood, matMetal, matCeramic, matRug, matMagicCircle,
  matTapestry, matSconce, matGoldInlay, matNecroCircle, matSporeCircle,
  matCampRing, matRegimentalBanner, matBoneStone, matBiolum, matGlacialIce,
  matFloor, matWall, matWallCap, matTrim, matGlow, matCloth, matIce, matMoss, matBark,
  matGrass, matLeaf, matCrackD, matRune, matPortal, matShaft, matSkirt,
  matRuneSeal, matEmber, matBlot, matBlotAdd, matWeb, liquidMat, partMat, POST,
  applyTileTheme
} from './dungeon_materials.js';

const canvasBg = 0x050609;
const clamp01 = x => Math.max(0, Math.min(1, x));

/* forest ground-prop assets (loaded once, cloned per placement) */
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');
const propLoader = new GLTFLoader();
propLoader.setDRACOLoader(dracoLoader);

const BIOME_PROP_FILES = {
  Forest: {
    mushroomLog: 'MushroomLog.opt.glb', rocks: 'rocks.opt.glb', stump: 'stump.opt.glb',
    vinemound: 'vinemound.opt.glb', cairn: 'Cairn.opt.glb', stakes: 'stakes.opt.glb',
    rack: 'rack.opt.glb', goblinfire: 'goblinfire.opt.glb', skulltotem: 'skulltotem.opt.glb'
  },
  Ancient: {
    vase: 'Vaze.opt.glb', coffin: 'coffin.opt.glb', pillarA: 'pillar.opt.glb', pillarB: 'pillar2.opt.glb'
  },
  Grim: { tombstone: 'Tombstone.opt.glb' },
  Molten: { anvil: 'Anvil.opt.glb' },
  frost: { icebone: 'icebone.opt.glb' },
  Verdant: {
    fren1: 'fren1.opt.glb', fren2: 'fren2.opt.glb', fren3: 'fren3.opt.glb', fren4: 'fren4.opt.glb',
    mushroomA: 'mushroom.opt.glb', mushroomB: 'mushroom2.opt.glb', rootsA: 'roots1.opt.glb', rootsB: 'roots2.opt.glb'
  },
  Moor: {
    bush: 'bush.opt.glb', signpost: 'signpost.opt.glb',
    brokenSignpost: '389570cd4af64ded8622428ce71e2991.opt.glb', wheel: 'wheel.opt.glb'
  }
};
/* per-asset visual scale multiplier — these models are all normalized to fill
   one tile on import, but their real-world proportions differ, so the single-
   tile default reads wrong for several of them */
const PROP_SCALE_MULTIPLIER = {
  mushroomLog: 1.25,
  coffin: 1.5, pillarA: 1.3, pillarB: 1.3, vase: 0.85,
  anvil: 0.75, tombstone: 1.15, icebone: 1.1,
  fren1: 0.9, fren2: 0.9, fren3: 0.9, fren4: 0.9,
  mushroomA: 1.2, mushroomB: 1.2, rootsA: 1.3, rootsB: 1.3,
  stump: 1.2, vinemound: 1.2, cairn: 1.1, rocks: 1.1, skulltotem: 1.3,
  goblinfire: 0.85, rack: 0.9, stakes: 1,
  bush: 1.1, signpost: 1.05, brokenSignpost: 1, wheel: 0.9
};
const propAssets = {};
const propBaseOffset = {};

/** Load a GLB and make it available to prop scatter under `key`.
 *  Used for the shipped biome props, for custom_props.json, and live by the
 *  dungeon editor when a model is imported. Resolves once the model is ready
 *  so a caller can re-forge and actually see it. */
export function registerProp(key, url, scaleMult){
  if(scaleMult) PROP_SCALE_MULTIPLIER[key] = scaleMult;
  return new Promise((resolve, reject) => {
    propLoader.load(url, gltf => {
      propAssets[key] = gltf.scene;
      propBaseOffset[key] = -new THREE.Box3().setFromObject(gltf.scene).min.y;
      resolve(key);
    }, undefined, err => {
      console.error(`prop load failed: ${key}`, err);
      reject(err);
    });
  });
}
export function registeredProps(){ return Object.keys(propAssets); }

for(const folder in BIOME_PROP_FILES){
  for(const [key, file] of Object.entries(BIOME_PROP_FILES[folder])){
    registerProp(key, `/3d/${folder}/${file}`).catch(() => {});
  }
}
/* Models imported through the dungeon editor. Same shape as BIOME_PROP_FILES
   entries but with an explicit url + scale, so they survive a reload and work
   in the game, not just in the editor. */
for(const [key, def] of Object.entries(CUSTOM_PROPS || {})){
  if(def && def.url) registerProp(key, def.url, def.scale).catch(() => {});
}

function showWebGLErrorOverlay(err) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:#07080d;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif;padding:30px;text-align:center;z-index:999999;box-sizing:border-box;';
  overlay.innerHTML = `
    <div style="background:#141722;border:1px solid #2a2e40;border-radius:12px;padding:32px;max-width:560px;box-shadow:0 12px 40px rgba(0,0,0,0.8);">
      <h2 style="margin-top:0;color:#ff5555;font-size:22px;">WebGL Context Could Not Be Created</h2>
      <p style="color:#d0d4e4;font-size:14px;line-height:1.6;">
        The game was unable to initialize a WebGL graphics context on your device or browser.
      </p>
      <div style="background:#0a0c12;border-left:4px solid #ff5555;padding:12px 16px;margin:20px 0;text-align:left;font-family:monospace;font-size:12px;color:#ff9999;overflow-x:auto;">
        ${err ? (err.message || String(err)) : 'WebGL context not supported or disabled'}
      </div>
      <p style="color:#9098b0;font-size:13px;line-height:1.5;text-align:left;">
        <strong>Troubleshooting steps:</strong><br>
        • Enable Hardware Acceleration in browser settings.<br>
        • Update graphics drivers.<br>
        • Restart your browser or Electron application.<br>
        • Check chrome://gpu for GL driver errors.
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
          const r = new THREE.WebGLRenderer({ canvas: c, context: gl, ...attrs });
          if (r) return r;
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

const BASE_HALF = 55;
let aspect = innerWidth/innerHeight;
export const cam = new THREE.OrthographicCamera(-BASE_HALF*aspect, BASE_HALF*aspect, BASE_HALF, -BASE_HALF, -400, 800);
export let yaw = Math.PI/4, pitch = 0.64;

export function setYawPitch(y, p) { yaw = y; pitch = p; updateCam(); }

export let elapsed = 0;
export let gameTimeScale = 1.0;
export let shakeIntensity = 0;
export const camTarget = new THREE.Vector3(0,0,0);

export function shakeCamera(intensity = 0.5) {
  shakeIntensity = Math.max(shakeIntensity, intensity);
}

export function triggerHitStop(frames = 3) {
  gameTimeScale = 0.05;
  shakeIntensity = Math.max(shakeIntensity, 0.3);
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

/* Torch pool lights used to hard-code 2.2 / 18 and ignore the theme's
   torchLight:[colour, intensity, range] entirely. These factors make ancient's
   authored 1.5 / 9.5 land on exactly the old numbers, so nothing shifts by
   default while the per-theme values (and the editor sliders) now do something. */
const TORCH_I_K = 2.2 / 1.5, TORCH_R_K = 18 / 9.5;
const torchPoolIntensity = TH => ((TH && TH.torchLight && TH.torchLight[1]) ?? 1.5) * TORCH_I_K;
const torchPoolRange     = TH => ((TH && TH.torchLight && TH.torchLight[2]) ?? 9.5) * TORCH_R_K;

export const hemi = new THREE.HemisphereLight(0x222b3d, 0x07080c, 0.45);
scene.add(hemi);
export const dirL = new THREE.DirectionalLight(0xffe2b8, 0.78);
dirL.position.set(72, 78, 46);
dirL.castShadow = true;
dirL.shadow.mapSize.set(2048, 2048);
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

  const updatePointerTargeting = (e) => {
    if (!game || !cnv) return;
    const r = cnv.getBoundingClientRect();
    _clickNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    _clickRay.setFromCamera(_clickNdc, cam);

    if (game.updateSpellTargeting && game.targetingState && game.targetingState.active) {
      if (_clickRay.ray.intersectPlane(_clickPlane, _clickPt)) {
        game.updateSpellTargeting(_clickPt.x, _clickPt.z);
      }
      _hoverMarkerGroup.visible = false;
      const tooltip = document.getElementById('hover-cursor-tooltip');
      if (tooltip) tooltip.style.display = 'none';
      return;
    }

    const isManual = game.controlMode === 'manual' && game.initiative && game.initiative.active;
    const cur = isManual ? game._currentActor() : null;
    const isHeroTurn = cur && cur._side === 'hero' && cur.data && cur.data.hp > 0;
    const tooltip = document.getElementById('hover-cursor-tooltip');

    if (!isManual || !isHeroTurn) {
      _hoverMarkerGroup.visible = false;
      if (tooltip) tooltip.style.display = 'none';
      return;
    }

    if (_clickRay.ray.intersectPlane(_clickPlane, _clickPt)) {
      const gx = _clickPt.x, gz = _clickPt.z;
      const clickedMonster = (game.monsters || []).find(m => m.active && m.data && m.data.hp > 0 && Math.hypot(m.x - gx, m.z - gz) < 1.3);

      if (clickedMonster) {
        _hoverMarkerGroup.visible = true;
        _hoverMarkerGroup.position.set(clickedMonster.x, 0.04, clickedMonster.z);
        _hoverTileMat.color.setHex(0xff3333);
        _hoverBorderMat.color.setHex(0xffaaaa);

        const dist = Math.hypot(clickedMonster.x - cur.x, clickedMonster.z - cur.z);
        const wpn = cur.data?.equipment?.weapon;
        const isRanged = wpn?.visualWeapon?.startsWith('ranged/');
        const modeText = isRanged ? `🏹 Attack ${clickedMonster.data.name}` : (dist <= 1.9 ? `⚔️ Attack ${clickedMonster.data.name}` : `🏃 Move & Attack ${clickedMonster.data.name}`);

        if (tooltip) {
          tooltip.style.display = 'block';
          tooltip.style.left = `${e.clientX}px`;
          tooltip.style.top = `${e.clientY}px`;
          tooltip.textContent = modeText;
        }
      } else {
        const cell = game.cellOf ? game.cellOf(gx, gz) : -1;
        const W = game.D ? game.D.W : 20;
        const cx = (game && typeof game.wx === 'function' && cell >= 0) ? game.wx(cell % W) : (cell % W) + 0.5;
        const cz = (game && typeof game.wz === 'function' && cell >= 0) ? game.wz(Math.floor(cell / W)) : Math.floor(cell / W) + 0.5;
        const dist = Math.hypot(cx - cur.x, cz - cur.z);
        const distFt = Math.round(dist * 5);
        const moveLeftFt = (cur.moveLeft != null ? cur.moveLeft : game.cellsForSpeed(cur)) * 5;
        const inBudget = distFt <= moveLeftFt;

        if (game && game.controlMode === 'manual' && game.initiative && game.initiative.active && (cur.moveLeft || 0) > 0) {
          if (!game.pendingMoveState) {
            const curCell = game.cellOf(cur.x, cur.z);
            if (cell >= 0 && cell !== curCell && game.D && game.D.grid && game.D.grid[cell] === 0) {
              const rawPath = game.findPath ? game.findPath(curCell, cell) : null;
              if (rawPath && rawPath.length >= 2) {
                const maxSteps = Math.min(cur.moveLeft || game.cellsForSpeed(cur), rawPath.length - 1);
                const actualPath = rawPath.slice(0, maxSteps + 1);
                const costFt = maxSteps * 5;
                game.updatePathVisual(actualPath, costFt);
              } else if (game.clearPathVisual) {
                game.clearPathVisual();
              }
            } else if (game.clearPathVisual) {
              game.clearPathVisual();
            }
          }
        } else if (game && game.clearPathVisual && !game.pendingMoveState) {
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
          tooltip.textContent = inBudget ? `🦶 Proposed Move ${distFt} ft` : `⚠️ Beyond Movement (${distFt} ft)`;
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
    } else {
      const wpp = (2*BASE_HALF/cam.zoom)/cnv.clientHeight;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      camTarget.x += (-dx*fz - dy*fx)*wpp;
      camTarget.z += ( dx*fx - dy*fz)*wpp;
      if(game && game.notifyUserPan) game.notifyUserPan();
    }
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
    cam.zoom = Math.min(6, Math.max(0.12, cam.zoom*Math.exp(-e.deltaY*0.0012)));
    cam.updateProjectionMatrix();
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
export let standaloneRooms = [];
export let floorColorsBase = null, floorColorsHeat = null;
export let animT = Infinity, animEnd = 0, animating = false;
export let fx = { liquids:[], shafts:[], spinners:[], parts:null };
let levelGeos = [];
const lerpC = (a,b,t)=> _c.set(a).lerp(new THREE.Color(b), t).getHex();

export function isAnimating() {
  return animating;
}

export function disposeLevel(){
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
  standaloneRooms = [];
  fx = { liquids:[], shafts:[], spinners:[], parts:null };
}

export function applyThemeEnv(TH){
  scene.fog.color.set(TH.fog);
  curBg.set(TH.bg);
  hemi.color.set(TH.hemi[0]); hemi.groundColor.set(TH.hemi[1]); hemi.intensity = TH.hemi[2] * LIGHT_K;
  dirL.color.set(TH.dir[0]); dirL.intensity = TH.dir[1] * LIGHT_K;
  document.documentElement.style.setProperty('--ember', TH.accent);
}

export function buildLiquidMesh(cells, wx, wz, y){
  const key = new Set(cells.map(c=>c.x+','+c.y));
  const n = cells.length;
  const pos = new Float32Array(n*18), ae = new Float32Array(n*12), am = new Float32Array(n*24);
  const CE = [-0.5,-0.5, -0.5,0.5, 0.5,0.5, -0.5,-0.5, 0.5,0.5, 0.5,-0.5];
  let o=0, oe=0, om=0;
  for(const c of cells){
    const x0=wx(c.x)-0.51, x1=wx(c.x)+0.51, z0=wz(c.y)-0.51, z1=wz(c.y)+0.51;
    pos.set([x0,y,z0, x0,y,z1, x1,y,z1,  x0,y,z0, x1,y,z1, x1,y,z0], o); o+=18;
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
  const TH = THEMES[d.params.themeKey || d.themeKey] || THEMES.ancient;
  const accC = parseInt(TH.accent.slice(1),16);
  applyThemeEnv(TH);
  applyTileTheme(d.params.themeKey || d.themeKey);
  group = new THREE.Group(); scene.add(group);

  if(!heroLight){
    heroLight = new THREE.PointLight(0xffbb66, 2.0 * LIGHT_K, 18, 2);
    heroLight.userData = { base: 2.0, ph: 0, ramp: 1, fogMult: 1 };
    scene.add(heroLight);
  }

  const W=d.W, H=d.H, grid=d.grid, roomId=d.roomId, corridor=d.corridor,
        doorway=d.doorway, bfs=d.bfs, maxBfs=d.maxBfs, rooms=d.rooms,
        lakeMask=d.lakeMask;
  const idx=(x,y)=>y*W+x, wx=x=>x-W/2+0.5, wz=y=>y-H/2+0.5;
  const cellRng = makeRng(d.seed ^ 0x9e3779b9);
  const dStep = 0.016;

  const floorAnchor = (gx, gy)=>{
    gx = Math.max(0, Math.min(W-1, Math.round(gx)));
    gy = Math.max(0, Math.min(H-1, Math.round(gy)));
    if(grid[idx(gx,gy)]===FLOOR) return idx(gx,gy);
    for(const o of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
      const nx=gx+o[0], ny=gy+o[1];
      if(nx>=0&&ny>=0&&nx<W&&ny<H && grid[idx(nx,ny)]===FLOOR) return idx(nx,ny);
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

  /* floors */
  const fs = instSet(); floorColorsBase=[]; floorColorsHeat=[];
  const fUv=[], pushVar=(arr,rng)=>{ const v=rng.i(0,3); arr.push((v&1)*0.5, (v>>1)*0.5); };
  const decCand=[];
  const base = new THREE.Color(), tint = new THREE.Color(),
        heatA = new THREE.Color(0x2f4bb0), heatB = new THREE.Color(0xe8502f);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const c=idx(x,y); if(grid[c]!==FLOOR || lakeMask[c]) continue;
    let walls8=0;
    for(let oy=-1;oy<=1;oy++) for(let ox=-1;ox<=1;ox++){
      if(!ox&&!oy) continue;
      const nx=x+ox, ny=y+oy;
      if(nx<0||ny<0||nx>=W||ny>=H || grid[idx(nx,ny)]===WALL) walls8++;
    }
    const rid = roomId[c];
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
    fs.add(wx(x), cellRng.f(-0.02,0.008), wz(y), 1,1,1, cellRng.i(0,3)*(Math.PI/2), floorColorsBase[floorColorsBase.length-1], Math.max(0,bfs[c])*dStep);
    pushVar(fUv, cellRng);
    decCand.push({x, y, rid, walls8});
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
  const nearFloorBfs = (x,y)=>{ let b=1e4;
    for(let oy=-1;oy<=1;oy++) for(let ox=-1;ox<=1;ox++){
      const nx=x+ox, ny=y+oy;
      if(nx>=0&&ny>=0&&nx<W&&ny<H && bfs[idx(nx,ny)]>=0) b=Math.min(b,bfs[idx(nx,ny)]);
    } return b===1e4?0:b; };
  const ws = instSet(), cs = instSet();
  const wUv=[], cUv=[];
  const wcol = new THREE.Color();
  /* Overland blockers come in two silhouettes: trunk+canopy (forest, mire,
     sporewood…) or jittered masonry (boneyard, ruinfield, ashfield). */
  const blockGeo = TH.overland && TH.blockerGeo === 'block';
  if(TH.overland){
    const pal = d.palisadeMask;
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){
      const c=idx(x,y);
      if(grid[c]!==WALL) continue;
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
      } else {
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
      ws.add(wx(x),0,wz(y), 1,h,1, 0, wcol.getHex(), dl);
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
              bossGlow:instSet(), bossRock:instSet(),
              runeSeal:instSet(), ember:instSet(), rime:instSet(), stain:instSet(), growth:instSet(),
              barrel:instSet(), crate:instSet(), table:instSet(), bench:instSet(), chair:instSet(),
              bookshelf:instSet(), weaponRack:instSet(), statue:instSet(), urn:instSet(),
              rug:instSet(), magicCircle:instSet(), tapestry:instSet(), sconce:instSet(),
              forge:instSet(), cauldron:instSet(), ossuaryWall:instSet(), sporePod:instSet(),
              megalith:instSet(), wagon:instSet(), altarTable:instSet(), iceThrone:instSet(), globe:instSet() };
  const pd = (x,y)=> Math.max(0,bfs[idx(x,y)])*dStep + 0.62;
  const shaftAt = [];
  let portalXZ = null, runeXZ = null;

  for(const p of d.props){
    const X=wx(p.x), Z=wz(p.y), dl=pd(p.x,p.y);
    const propRoom = p.roomId !== undefined ? p.roomId : d.roomId[idx(p.x + (p.dx||0), p.y + (p.dy||0))];
    switch(p.kind){
      case 'pillar': { const s=p.scale*1.15;
        S.pillar.add(X,0,Z, s,s,s, cellRng.i(0,3)*Math.PI/2, TH.pillar, dl, propRoom); break; }
      case 'debris': { const set=[S.debrisA,S.debrisB,S.debrisC][p.v||0];
        set.add(X,0,Z, p.scale,p.scale*0.85,p.scale, p.rot, lerpC(TH.debris[0],TH.debris[1],cellRng.raw()), dl, propRoom); break; }
      case 'mushroomLog': case 'rocks': case 'stump': case 'vinemound':
      case 'cairn': case 'stakes': case 'rack': case 'goblinfire': case 'skulltotem':
      case 'vase': case 'coffin': case 'pillarA': case 'pillarB':
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
        inst.position.set(X, (propBaseOffset[p.kind]||0) * s, Z);
        inst.rotation.y = p.rot;
        inst.scale.setScalar(s);
        inst.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
        group.add(inst);
        if(propRoom>=0) standaloneRooms.push({mesh:inst, rid:propRoom});
        break;
      }
      case 'chest':
        S.chest.add(X,0,Z, 1,1,1, p.rot, 0x8a5a2c, dl, propRoom);
        S.chestTrim.add(X,0,Z, 1,1,1, p.rot, 0xc8a24a, dl, propRoom);
        S.chestGlow.add(X,0,Z, 1,1,1, p.rot, 0xffd27a, dl+0.15, propRoom);
        break;
      case 'shrineCrystal': {
        S.plinth.add(X,0,Z, 1,1,1, p.rot, lerpC(TH.pillar,0xffffff,0.12), dl, propRoom);
        S.crystal.add(X, 1.4, Z, 1.05,1.05,1.05, p.rot, 0x8fbcff, dl+0.2, propRoom);
        for(let k=0;k<4;k++){
          const a = k*Math.PI/2 + Math.PI/4, cx = X+Math.cos(a)*0.36, cz = Z+Math.sin(a)*0.36;
          S.candle.add(cx, 0.5, cz, 0.8,0.8,0.8, 0, 0xd8cba8, dl+0.15, propRoom);
          S.flameCore.add(cx, 0.65, cz, 0.5,0.5,0.5, 0, TH.flameCore, dl+0.25, propRoom);
        }
        shaftAt.push({x:X, z:Z, s:1, rid: propRoom});
        break; }
      case 'ring':
        S.platform.add(X,-0.02,Z, 1,1,1, 0, lerpC(TH.floor,0xffffff,0.1), dl, propRoom);
        S.ring.add(X, 0.16, Z, 1,1,1, 0, 0x3fd0bb, dl+0.1, propRoom);
        S.pillar.add(X-1.45, 0.1, Z, 0.72,0.72,0.72, 0, TH.pillar, dl+0.15, propRoom);
        S.pillar.add(X+1.45, 0.1, Z, 0.72,0.72,0.72, 0, TH.pillar, dl+0.15, propRoom);
        portalXZ = [X,Z];
        shaftAt.push({x:X, z:Z, s:0.9, rid: propRoom});
        break;
      case 'bossCrystal': {
        S.bossGlow.add(X,0,Z, 1.15,1.15,1.15, p.rot, 0xff4636, dl, propRoom);
        S.bossGlow.add(X+0.55,0,Z-0.42, 0.6,0.75,0.6, p.rot+1.2, 0xff6a45, dl+0.12, propRoom);
        S.bossRock.addT(X-0.62,0,Z+0.42, 0.75,0.8,0.75, 0.05,p.rot+2.1,-0.06, 0x4a3336, dl+0.15, propRoom);
        S.bossRock.addT(X+0.75,0,Z+0.55, 0.55,0.6,0.55, -0.06,p.rot+3.6,0.05, 0x51383a, dl+0.2, propRoom);
        break; }
      case 'grave':
        S.grave.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, lerpC(TH.pillar,0x4a3b32,cellRng.raw()), dl, propRoom);
        break;
      case 'sarco':
        S.sarco.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, lerpC(TH.pillar,0x3a3028,cellRng.raw()), dl, propRoom);
        break;
      case 'candle':
        S.candle.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0xd8cba8, dl, propRoom);
        S.flameCore.add(X, 0.22*p.scale, Z, 0.5*p.scale,0.5*p.scale,0.5*p.scale, 0, TH.flameCore, dl+0.05, propRoom);
        break;
      case 'icicle':
        /* oy lets overland hang them off shorter blockers than a dungeon wall. */
        S.icicle.addT(X, 1.9 + (p.oy||0), Z, p.scale,p.scale,p.scale,
                      cellRng.f(-0.1,0.1), p.rot, cellRng.f(-0.1,0.1),
                      0xbfe2ff, dl, propRoom);
        break;
      case 'shardIce':
        /* ox/oz spread the members of a cluster around inside their shared cell. */
        S.shardIce.addT(X + (p.ox||0), -0.1, Z + (p.oz||0), p.scale,p.scale,p.scale,
                        cellRng.f(-0.2,0.2), p.rot, cellRng.f(-0.2,0.2),
                        0xcfeaff, dl, propRoom);
        break;
      case 'roots':
        S.roots.add(wx(p.x), 0, wz(p.y), p.scale,p.scale,p.scale, Math.atan2(p.dx,p.dy),
                    0x5a4632, nearFloorBfs(p.x,p.y)*dStep + 0.6, propRoom);
        break;
      case 'moss':
        S.moss.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, lerpC(0x3f6b3a,0x5a8a4a,cellRng.raw()), dl, propRoom);
        break;
      case 'crack': {
        const cx = X - (p.dx||0)*0.5, cz = Z - (p.dy||0)*0.5;
        const vc = p.ice ? 0x9fd8ff : (TH.pools && TH.pools.mode===3 ? 0x86c05a : 0xff6a28);
        S.crackD.add(cx, 0, cz, p.scale,p.scale,p.scale, p.rot, vc, dl, propRoom);
        break; }
      case 'bones':
        S.bone.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0xcfc4a4, dl, propRoom);
        break;
      case 'skull':
        S.skull.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0xdfd8c4, dl, propRoom);
        break;
      case 'skeleton':
        S.skeleton.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0xd0c8b0, dl, propRoom);
        break;
      case 'bonePile':
        S.bonePile.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0xcfc4a4, dl, propRoom);
        break;
      case 'spiderWeb': {
        /* p.x/p.y is the floor cell at an inside corner and p.dx/p.dy point at the
           two walls meeting there, so the hub goes on the corner post between them.
           The fan spans +x..+z from its own origin; rotating its bisector to face
           back into the room lands its two straight edges along the two walls. */
        const wdx = p.dx || 0, wdy = p.dy || 0;
        S.spiderWeb.add(X + wdx*0.5, 0, Z + wdy*0.5, p.scale,p.scale,p.scale,
                        Math.atan2(-wdx, -wdy) - Math.PI/4, 0xe8e8e8, dl, propRoom);
        break; }
      case 'banner': {
        const ry = Math.atan2(p.dx, p.dy);
        const bx = wx(p.x)+p.dx*0.54, bz = wz(p.y)+p.dy*0.54;
        const bdl = nearFloorBfs(p.x,p.y)*dStep + 0.7;
        S.bannerRod.add(bx, 1.98, bz, 1,1,1, ry, 0x6a5a3a, bdl, propRoom);
        S.bannerCloth.add(bx+p.dx*0.03, 1.96, bz+p.dy*0.03, 1,1,1, ry, TH.cloth, bdl+0.05, propRoom);
        S.emblem.add(bx+p.dx*0.06, 1.6, bz+p.dy*0.06, 1,1,1, ry, accC, bdl+0.1, propRoom);
        break; }
      case 'barrel':
        S.barrel.add(X,0,Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, lerpC(0x8a5a2c, 0x5a3a1c, cellRng.raw()), dl, propRoom);
        break;
      case 'crate':
        S.crate.add(X,0,Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, lerpC(0x7a4e28, 0x9a6e38, cellRng.raw()), dl, propRoom);
        break;
      case 'table':
        S.table.add(X,0,Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x7a4e28, dl, propRoom);
        break;
      case 'bench':
        S.bench.add(X,0,Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x6b4220, dl, propRoom);
        break;
      case 'chair':
        S.chair.add(X,0,Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x6b4220, dl, propRoom);
        break;
      case 'bookshelf':
        S.bookshelf.add(X,0,Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x5a3214, dl, propRoom);
        break;
      case 'weaponRack':
        S.weaponRack.add(X,0,Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x6b4a2f, dl, propRoom);
        break;
      case 'statue':
        S.statue.add(X,0,Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, lerpC(TH.pillar, 0xffffff, 0.15), dl, propRoom);
        break;
      case 'urn':
        S.urn.add(X,0,Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, lerpC(0x9e6a45, 0x6a452e, cellRng.raw()), dl, propRoom);
        break;
      case 'rug':
        S.rug.add(X,0,Z, p.scale||1,1,p.scale||1, p.rot||0, 0xd4af37, dl, propRoom);
        break;
      case 'magicCircle':
        S.magicCircle.add(X,0,Z, p.scale||1,1,p.scale||1, p.rot||0, TH.accent ? parseInt(TH.accent.slice(1),16) : 0x3fd0bb, dl, propRoom);
        break;
      case 'tapestry': {
        const ry = Math.atan2(p.dx||0, p.dy||1);
        S.tapestry.add(wx(p.x)+(p.dx||0)*0.48, 0, wz(p.y)+(p.dy||0)*0.48, 1,1,1, ry, TH.cloth, dl, propRoom);
        break; }
      case 'sconce': {
        const ry = Math.atan2(p.dx||0, p.dy||1);
        const sx = wx(p.x)+(p.dx||0)*0.48, sz = wz(p.y)+(p.dy||0)*0.48;
        S.sconce.add(sx, 0, sz, 1,1,1, ry, 0x8a7248, dl, propRoom);
        S.flame.add(sx+(p.dx||0)*0.12, 1.06, sz+(p.dy||0)*0.12, 0.8,0.8,0.8, 0, TH.flame, dl+0.05, propRoom);
        S.flameCore.add(sx+(p.dx||0)*0.12, 1.08, sz+(p.dy||0)*0.12, 0.8,0.8,0.8, 0, TH.flameCore, dl+0.05, propRoom);
        break; }
      case 'forge':
        S.forge.add(X,0,Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x4a4540, dl, propRoom);
        S.coals.add(X,0.55,Z, 0.8,0.8,0.8, 0, 0xff5a1f, dl+0.1, propRoom);
        S.flame.add(X, 0.65, Z, 0.9,0.9,0.9, 0, TH.flame, dl+0.12, propRoom);
        break;
      case 'cauldron':
        S.cauldron.add(X,0,Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x2a2826, dl, propRoom);
        break;
      case 'ossuaryWall': {
        const ry = Math.atan2(p.dx||0, p.dy||1);
        const ox = wx(p.x)+(p.dx||0)*0.48, oz = wz(p.y)+(p.dy||0)*0.48;
        S.ossuaryWall.add(ox,0,oz, p.scale||1,p.scale||1,p.scale||1, ry, lerpC(TH.wall, 0x3a3028, 0.35), dl, propRoom);
        break; }
      case 'sporePod':
        S.sporePod.add(X,0,Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x59d68f, dl, propRoom);
        break;
      case 'megalith':
        S.megalith.add(X,0,Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, lerpC(TH.wall, 0x8a929a, cellRng.raw()), dl, propRoom);
        break;
      case 'wagon':
        S.wagon.add(X,0,Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0x6b4a2f, dl, propRoom);
        break;
      case 'altarTable':
        S.altarTable.add(X,0,Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, lerpC(TH.wall, 0x4a3b32, 0.3), dl, propRoom);
        break;
      case 'iceThrone':
        S.iceThrone.add(X,0,Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0xbfe2ff, dl, propRoom);
        break;
      case 'globe':
        S.globe.add(X,0,Z, p.scale||1,p.scale||1,p.scale||1, p.rot||0, 0xc8a24a, dl, propRoom);
        break;
    }
  }

  for(const t of d.torches){
    const ry = Math.atan2(t.dx, t.dy);
    const X = wx(t.x)+t.dx*0.5, Z = wz(t.y)+t.dy*0.5, dl = nearFloorBfs(t.x,t.y)*dStep + 0.66;
    const tc = idx(t.x + t.dx, t.y + t.dy);
    const trid = d.roomId[tc] >= 0 ? d.roomId[tc] : -2 - tc;
    S.torchArm.add(X, 1.02, Z, 1,1,1, ry, 0x4a4038, dl, trid);
    S.flame.add(X+t.dx*0.16, 1.5, Z+t.dy*0.16, 1.2,1.2,1.2, 0, TH.flame, dl+0.08, trid);
    S.flameCore.add(X+t.dx*0.16, 1.53, Z+t.dy*0.16, 1.2,1.2,1.2, 0, TH.flameCore, dl+0.08, trid);
  }

  for(const sp of d.spawns){
    const X=wx(sp.x), Z=wz(sp.y), dl=pd(sp.x,sp.y)+0.1, rot=cellRng.f(0,6.28);
    const sth = SPAWN_THEMES[d.params.themeKey] || SPAWN_THEMES.ancient;
    /* Portal mesh tier is derived from the spawn's target CR (formerly a literal
       `tier` field). Low CR -> small ground rune, mid -> pillar, high -> crystal. */
    const cr = sp.targetCR != null ? sp.targetCR : 0.25;
    const portalTier = cr < 0.6 ? 1 : (cr < 2 ? 2 : 3);
    if(portalTier===1){
      S.spawn1.add(X,0,Z, 1,1,1, rot, sth.baseCol, dl, sp.roomId);
      S.band2.add(X, 0.14, Z, 0.7,0.7,0.7, rot, sth.ringCol, dl+0.08, sp.roomId);
    } else if(portalTier===2){
      S.spawn2.add(X,0,Z, 1,1,1, rot, sth.baseCol, dl, sp.roomId);
      S.band2.add(X, 0.55, Z, 1,1,1, rot, sth.ringCol, dl+0.1, sp.roomId);
    } else {
      S.spawn3.add(X,0,Z, 1,1,1, rot, sth.baseCol, dl, sp.roomId);
      S.band3.add(X, 0.62, Z, 1,1,1, rot, sth.ringCol, dl+0.1, sp.roomId);
      S.crystal.add(X, 1.98, Z, 0.42,0.42,0.42, rot, sth.crystalCol, dl+0.2, sp.roomId);
    }
  }

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
      S.arch.add(X-half,0,Z, 1,1,1, 0, postCol, dlA, dcell);
      S.arch.add(X+half,0,Z, 1,1,1, Math.PI, postCol, dlA, dcell);
      S.archL.add(X,1.62,Z, a.len+0.08,1,1, 0, lintelCol, dlA+0.1, dcell);
    } else {
      S.arch.add(X,0,Z-half, 1,1,1, Math.PI/2, postCol, dlA, dcell);
      S.arch.add(X,0,Z+half, 1,1,1, -Math.PI/2, postCol, dlA, dcell);
      S.archL.add(X,1.62,Z, a.len+0.08,1,1, Math.PI/2, lintelCol, dlA+0.1, dcell);
    }
    S.gate.add(X, 0, Z, a.len, 1.5, 1, rot, lerpC(TH.wall, 0x000000, dth.gateMix ?? 0.2), dlA+0.05, dcell);
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
      S.basin.add(wx(p.x), 0, wz(p.y), 1,1,1, 0, lerpC(TH.wall,0x000000,0.35), dl, fogId);
      /* The skirt is a crusted rim, so it only belongs on the edge of a body —
         stacking one on every interior cell of a multi-tile pool is both noisy
         and needless geometry. */
      const pc = idx(p.x, p.y);
      const isRim = grid[pc+1] !== POOL || grid[pc-1] !== POOL ||
                    grid[pc+W] !== POOL || grid[pc-W] !== POOL;
      if(isRim)
        S.skirt.add(wx(p.x), 0, wz(p.y), cellRng.f(0.85,1.25),1,cellRng.f(0.85,1.25), cellRng.f(0,6.28), skirtC, dl+0.15, fogId);
      const key = rid>=0 ? 'r'+rid : 'c'+a;
      if(!poolGroups.has(key)) poolGroups.set(key, {rid, anchors:[], cells:[]});
      const pg = poolGroups.get(key); pg.cells.push(p); if(a>=0) pg.anchors.push(a);
    }
    for(const pg of poolGroups.values()){
      const m = buildLiquidMesh(pg.cells, wx, wz, -0.08);
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
      const m = buildLiquidMesh(cells, wx, wz, -0.12);
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
      S.runeSeal.add(wx(t.x), 0, wz(t.y), s,1,s, cellRng.f(0,6.28),
                     lerpC(0x7a5220, accC, 0.25), decDl(t), t.rid);
    }
  }
  if(TT.embers) for(const t of decCand){
    if(!cellRng.chance(TT.embers)) continue;
    const s = cellRng.f(0.55,1.0);
    S.ember.add(wx(t.x), 0, wz(t.y), s,1,s, cellRng.f(0,6.28),
                lerpC(0x8a3512, 0xff5a1f, cellRng.raw()), decDl(t), t.rid);
  }
  if(TT.rime) for(const t of decCand){
    if(!t.walls8 || !cellRng.chance(TT.rime)) continue;
    const s = cellRng.f(0.8,1.3);
    S.rime.add(wx(t.x), 0, wz(t.y), s,1,s, cellRng.f(0,6.28),
               lerpC(0x4a7290, 0x86b8d8, cellRng.raw()), decDl(t), t.rid);
  }
  if(TT.stains) for(const t of decCand){
    if(!cellRng.chance(TT.stains)) continue;
    const s = cellRng.f(0.7,1.45);
    S.stain.add(wx(t.x), 0, wz(t.y), s,1,s, cellRng.f(0,6.28),
                lerpC(0x0d120c, 0x1c2416, cellRng.raw()), decDl(t), t.rid);
  }
  if(TT.growth) for(const t of decCand){
    const hit = t.walls8 ? cellRng.chance(TT.growth) : cellRng.chance(TT.sprout||0);
    if(!hit) continue;
    const s = cellRng.f(0.75,1.35);
    S.growth.add(wx(t.x), 0, wz(t.y), s,1,s, cellRng.f(0,6.28),
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
    ['brazier',  GEO.brazier,   matTrim,   'pop',  0.35, 1],
    ['tent',     GEO.tent,      matCloth,  'rise', 0.4,  1],
    ['coals',    GEO.coals,     matGlow,   'pop',  0.35, 0],
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
    ['ossuaryWall',GEO.ossuaryWall,matBoneStone,'rise',0.45,1],
    ['sporePod', GEO.sporePod,  matBiolum, 'pop',  0.4,  0],
    ['megalith', GEO.megalith,  matStone,  'rise', 0.5,  1],
    ['wagon',    GEO.wagon,     matWood,   'pop',  0.45, 1],
    ['altarTable',GEO.altarTable,matStone, 'pop',  0.4,  1],
    ['iceThrone',GEO.iceThrone, matGlacialIce,'rise',0.45,1],
    ['globe',    GEO.globe,     matMetal,  'pop',  0.35, 1]
  ];
  for(const [k, geo, mat, mode, dur, sh] of setDefs) meshes[k] = buildMesh(S[k], geo, mat, mode, dur, sh);
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
    m.position.set(portalXZ[0], 0.12, portalXZ[1]);
    group.add(m); fx.spinners.push({m, spd:0.55});
    standaloneRooms.push({mesh:m, rid: d.entrance});
  }
  if(runeXZ){
    matRune.color.set(0xff5040);
    const m = new THREE.Mesh(GEO.runeRing, matRune);
    m.position.set(runeXZ.x, 0.06, runeXZ.z);
    m.scale.setScalar(runeXZ.s);
    group.add(m); fx.spinners.push({m, spd:-0.16});
    standaloneRooms.push({mesh:m, rid: d.boss});
  }
  if(TH.shafts){
    const big = rooms.filter(r=>r.type===TYPE.COMBAT && !r.lake).sort((a,b)=>b.w*b.h-a.w*a.h).slice(0,2);
    for(const r of big) shaftAt.push({x:wx(r.cx), z:wz(r.cy), s:1.3, rid: r.id});
  }
  for(const s of shaftAt){
    const m = new THREE.Mesh(GEO.shaft, matShaft);
    m.position.set(s.x, 0, s.z);
    m.scale.setScalar(s.s);
    group.add(m); fx.shafts.push(m);
    standaloneRooms.push({mesh:m, rid: s.rid !== undefined ? s.rid : -1});
  }

  { const spec = TH.particles;
    const pts = [];
    const pp = (x,z,y)=>pts.push({x,z,y, cell: floorAnchor(x + W/2 - 0.5, z + H/2 - 0.5)});
    if(spec.kind===1){
      for(const p of d.pools) pp(wx(p.x)+cellRng.f(-0.3,0.3), wz(p.y)+cellRng.f(-0.3,0.3), -0.02);
      for(const t of d.torches) pp(wx(t.x)+t.dx*0.66, wz(t.y)+t.dy*0.66, 1.5);
      for(const p of d.props) if(p.kind==='brazier') pp(wx(p.x), wz(p.y), 0.62);
    } else if(spec.kind===3){
      for(const p of d.props){
        if(p.kind==='grave' || p.kind==='sarco') pp(wx(p.x)+cellRng.f(-0.2,0.2), wz(p.y)+cellRng.f(-0.2,0.2), 0.3);
        else if(p.kind==='candle') pp(wx(p.x), wz(p.y), 0.25);
        else if(p.kind==='bones') pp(wx(p.x), wz(p.y), 0.1);
      }
      for(const p of d.pools) pp(wx(p.x), wz(p.y), 0);
    } else if(spec.kind===4){
      for(const p of d.props){
        if(p.kind==='moss') pp(wx(p.x)+cellRng.f(-0.25,0.25), wz(p.y)+cellRng.f(-0.25,0.25), 0.05);
        else if(p.kind==='roots') pp(wx(p.x)+p.dx*0.8, wz(p.y)+p.dy*0.8, cellRng.f(0.2,1.4));
      }
      for(const p of d.pools) pp(wx(p.x), wz(p.y), 0);
    } else if(spec.kind===0){
      for(const s of shaftAt) for(let k=0;k<10;k++)
        pp(s.x+cellRng.f(-0.8,0.8)*s.s, s.z+cellRng.f(-0.8,0.8)*s.s, cellRng.f(0.3,2.4));
      for(const t of d.torches) pp(wx(t.x)+t.dx*0.7, wz(t.y)+t.dy*0.7, cellRng.f(1.2,1.9));
    } else {
      for(let y=0;y<H;y++) for(let x=0;x<W;x++)
        if(grid[idx(x,y)]===FLOOR && cellRng.chance(0.25)) pp(wx(x), wz(y), 0);
    }
    if(!pts.length)
      for(let y=0;y<H;y++) for(let x=0;x<W;x++)
        if(grid[idx(x,y)]===FLOOR && cellRng.chance(0.1)) pp(wx(x), wz(y), 0);
    if(pts.length){
      const n = Math.min(spec.n, Math.max(40, pts.length*6));
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
      pm.userData.fogCells = fogCells; pm.userData.origY = origY;
      group.add(pm); fx.parts = pm;
    }
  }

  const shHalf = Math.max(W,H)*0.62 + 6;
  dirL.shadow.camera.left = -shHalf; dirL.shadow.camera.right = shHalf;
  dirL.shadow.camera.top = shHalf;   dirL.shadow.camera.bottom = -shHalf;
  dirL.shadow.camera.updateProjectionMatrix();

  const budget = 18;
  const keys = [];
  keys.push({x:rooms[d.entrance].cx, y:rooms[d.entrance].cy, col:0x3fd0bb, i:1.8, dist:16});
  keys.push({x:rooms[d.boss].cx, y:rooms[d.boss].cy, col:0xff4030, i:2.2, dist:20, ry:2.2});
  const shr = rooms.filter(r=>r.type===TYPE.SHRINE);
  if(shr.length) keys.push({x:shr[0].cx, y:shr[0].cy, col:0x6f9dff, i:1.8, dist:16});
  const tb = Math.max(8, budget - keys.length);
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
  for(let i=0; i<16; i++){
    const L = new THREE.PointLight(torchCol, 0, tR, 2);
    L.userData = { isTorchPool: true, base: tI, ph: i*1.7, ramp: 1, fogMult: 1 };
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

export function liveUpdate(time, tt){
  for(const key of ['flame','flameCore']){
    const fm = meshes[key];
    if(!fm || !fm.userData.set.n) continue;
    const fu = fm.userData, s = fu.set;
    for(let i=0;i<s.n;i++){
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
  matEmber.opacity = 0.72 + 0.24*Math.sin(time*2.3)*Math.sin(time*1.13);
  if(renderer){
    partMat.uniforms.uZoom.value = renderer.domElement.height * cam.zoom / (2*BASE_HALF);
  }
  for(const sp of fx.spinners) sp.m.rotation.y = time * sp.spd;
  for(const L of lights){
    if(L.userData && L.userData.isTorchPool) continue;
    const base = L.userData.base !== undefined ? L.userData.base : 1.5;
    const ph = L.userData.ph !== undefined ? L.userData.ph : 0;
    const ramp = L.userData.ramp === undefined ? 1 : L.userData.ramp;
    const fogM = L.userData.fogMult !== undefined ? L.userData.fogMult : 1;
    L.intensity = base * LIGHT_K * ramp * fogM * (0.84 + 0.22*Math.sin(time*9 + ph)*Math.sin(time*4.7 + ph*1.7));
  }

  if(D && D.torches && D.torches.length){
    const wx = x => x - D.W/2 + 0.5;
    const wz = y => y - D.H/2 + 0.5;
    const idx = (x,y) => y*D.W + x;

    let lx = 0, lz = 0;
    if(game && game.heroes){
      const alive = game.heroes.filter(h => h.data.hp > 0);
      const leader = alive[game.leaderIdx] || alive[0];
      if(leader && leader.x !== undefined){ lx = leader.x; lz = leader.z; }
    }

    const TH = THEMES[D.params.themeKey || D.themeKey] || THEMES.ancient;
    const torchCol = TH.flame || (TH.torchLight && TH.torchLight[0]) || 0xff8c3a;
    const activeTorches = [];

    for(const t of D.torches){
      const tx = wx(t.x) + t.dx * 0.7;
      const tz = wz(t.y) + t.dy * 0.7;
      const distSq = (tx - lx)*(tx - lx) + (tz - lz)*(tz - lz);

      const tc = idx(t.x + t.dx, t.y + t.dy);
      const trid = D.roomId[tc] >= 0 ? D.roomId[tc] : -2 - tc;

      let isVis = true;
      if(trid >= 0 && game && game.visitedRooms){
        isVis = !!game.visitedRooms[trid];
      }
      if(isVis || distSq < 900){
        activeTorches.push({ t, tx, tz, distSq });
      }
    }

    activeTorches.sort((a,b) => a.distSq - b.distSq);

    let poolIdx = 0;
    for(const L of lights){
      if(!L.userData || !L.userData.isTorchPool) continue;
      if(poolIdx < activeTorches.length){
        const item = activeTorches[poolIdx];
        L.color.set(torchCol);
        L.position.set(item.tx, 1.7, item.tz);
        const base = L.userData.base || 2.2;
        const ph = L.userData.ph || (poolIdx * 1.7);
        L.intensity = base * LIGHT_K * (0.84 + 0.22*Math.sin(time*9 + ph)*Math.sin(time*4.7 + ph*1.7));
      } else {
        L.intensity = 0;
      }
      poolIdx++;
    }
  }

  if(heroLight && game && game.heroes){
    const alive = game.heroes.filter(h => h.data.hp > 0);
    const leader = alive[game.leaderIdx] || alive[0];
    if(leader && leader.x !== undefined){
      heroLight.position.set(leader.x, 1.8, leader.z);
      heroLight.intensity = 2.0 * LIGHT_K * (game.state === 'crawl' ? 1 : 0) * (0.88 + 0.12*Math.sin(time*10));
    }
  }
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
  liveUpdate(elapsed, animating ? animT - 2.3 : Infinity);
  if(game && typeof game.update === 'function'){
    game.update(gameDt, elapsed);
  }
  renderer.info.reset();
  renderFrame();
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
