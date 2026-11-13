/**
 * DUNGEON FORGE — entry point & UI controller.
 *
 * Orchestrates procedural dungeon generation, WebGL showcase rendering,
 * DOM control listeners, and connects the game loop controller (`game.js`).
 */
import { game } from './game/game.js';
import {
  generateDungeon, THEMES, SPAWN_THEMES, THEME_KEYS, VOID, FLOOR, WALL, POOL, TYPE, TINT
} from './dungeon/dungeon_generator.js';
import {
  renderer, scene, cam, camTarget, updateCam, buildScene, liveUpdate, applyReveal,
  tick, lights, meshes, fx, standaloneRooms, setYawPitch, shakeCamera, isAnimating,
  triggerHitStop, triggerSlowMo, finishAnim, floorCellStart, floorCellCount, setTorchLit,
  setLatePropsHook
} from './render/dungeon_scene.js';
import { POST } from './render/dungeon_materials.js';
import { initAssetPack } from './game/asset_pack.js';
import { loadIconManifest } from './game/icons.js';
import { showLoadingScreen, hideLoadingScreen, scheduleAfterPaint, revealLoadingMap } from './ui/loading_screen.js';
import { resolveOverlandEnvironment } from './dungeon/overland_weather.js';
import { initTestDungeon, mountTestDelveTitleButton } from './game/test_dungeon.js';
import { showTitleLoading } from './game/ui.js';

/* ---------------- DOM Elements ---------------- */
const el = {
  seed:     document.getElementById('seed'),
  dice:     document.getElementById('dice'),
  forge:    document.getElementById('forge'),
  rooms:    document.getElementById('rooms') || { value: 16 },
  loops:    document.getElementById('loops') || { value: 18 },
  decor:    document.getElementById('decor') || { value: 100 },
  vRooms:   document.getElementById('vRooms') || { textContent: '' },
  vLoops:   document.getElementById('vLoops') || { textContent: '' },
  vDecor:   document.getElementById('vDecor') || { textContent: '' },
  vTheme:   document.getElementById('vTheme') || { textContent: '' },
  dname:    document.getElementById('dname') || { textContent: '' },
  dsub:     document.getElementById('dsub') || { textContent: '' },
  sRooms:   document.getElementById('sRooms') || { textContent: '' },
  sEdges:   document.getElementById('sEdges') || { textContent: '' },
  sCrit:    document.getElementById('sCrit') || { textContent: '' },
  sTiles:   document.getElementById('sTiles') || { textContent: '' },
  sLights:  document.getElementById('sLights') || { textContent: '' },
  sMs:      document.getElementById('sMs') || { textContent: '' },
  tGraph:   document.getElementById('tGraph') || { checked: false },
  tHeat:    document.getElementById('tHeat') || { checked: false },
  tAnim:    document.getElementById('tAnim') || { checked: true },
  tPost:    document.getElementById('tPost') || { checked: true }
};

let themeSel = 'auto';
let forgeThreatMult = 1;
/* Dungeon level of the floor being forged — drives the spawn budget's level
   curve. 1 (the standalone forge default) is the gentlest row. */
let forgeLevel = 1;
let forgeOpts = {};

const OBJ_MESHES = {
  props: ['pillar','debrisA','debrisB','debrisC','chestBody','chestTrim','chestSeam','tent','bone',
          'skull','skeleton','bonePile','spiderWeb',
          'ring','crystal','grave','sarco','candle','icicle','shard','roots','barrel','crate','table',
          'bench','chair','bookshelf','bookshelfBooks','weaponRack','statue','urn','rug','magicCircle','tapestry','sconce',
          'treasureHeap','alchemyBench','hangingCage','webbing','shackle','alcove','stalagmite',
          'scrollPedestal','weaponRackShield','potionPedestal','charnelPile','crystalCluster'],
  torches: ['torch','flame','flameCore','brazier','coals'],
};
const objVis = { props:true, torches:true, particles:true, liquids:true, lights:true };

function applyObjectVis(){
  for(const cat in OBJ_MESHES)
    for(const k of OBJ_MESHES[cat])
      if(meshes[k]) meshes[k].visible = objVis[cat];
  for(const k in meshes)
    if(k.startsWith('model_') && meshes[k]) meshes[k].visible = objVis.props;
  if(fx.parts) fx.parts.visible = objVis.particles;
  const comb = (m, layerOn)=>{
    if(!m) return;
    if(!m.userData) m.userData = {};
    m.userData.layerVisible = layerOn;
    m.visible = layerOn && m.userData.fogVisible !== false;
  };
  for(const m of fx.shafts) comb(m, objVis.particles);
  for(const m of fx.liquids) comb(m, objVis.liquids);
  for(const sp of fx.spinners) comb(sp.m, objVis.props);
  for(const L of lights) L.visible = objVis.lights;
}

function resolveTheme(seed){
  if(themeSel !== 'auto') return themeSel;
  return THEME_KEYS[seed % THEME_KEYS.length];
}

function setThemeSel(key){
  themeSel = key;
  document.querySelectorAll('#chips .chip').forEach(ch => {
    ch.classList.toggle('on', ch.dataset.t === key);
  });
}

/* ---------------- Forge & Showcase Presentation ---------------- */
function forge(animate = true){
  const seed = (parseInt(el.seed.value, 10) || 0) >>> 0;
  const themeKey = resolveTheme(seed);
  const params = {
    seed,
    roomCount: +el.rooms.value || 16,
    loopChance: (+el.loops.value || 18) / 100,
    decorDensity: (+el.decor.value || 100) / 100,
    themeKey,
    threatMult: forgeThreatMult,
    level: forgeLevel,
    hasRivalRoom: !!(forgeOpts && forgeOpts.hasRivalRoom)
  };
  const d = generateDungeon(seed, params);
  presentDungeon(d, animate);
}

function forgeOverland(seed, opts = {}){
  if(el.seed) el.seed.value = seed >>> 0;
  const params = {
    seed: seed >>> 0,
    themeKey: (opts.themeKey && THEMES[opts.themeKey] && THEMES[opts.themeKey].overland) ? opts.themeKey : 'forest',
    decorDensity: (+el.decor.value/100) || 1,
    level: opts.level || 1,
    name: opts.name || null,
    mapW: opts.mapW || 0,
    mapH: opts.mapH || 0,
    zones: opts.zones || 0,
    layout: opts.layout || null,   // 'ribbon' = long narrow journey map (overland_prologue.js)
    river: opts.river,             // true/false forces a theme's oc.river; unset = its chance
    threatMult: opts.threatMult || 1
  };
  const d = generateDungeon(seed, params);
  presentDungeon(d, opts.animate === true);
}

/* Models that finish loading after a level was built are added late (see
   buildScene); re-run the fog so the ones in unseen rooms hide at once. */
setLatePropsHook(() => {
  if (game && game.D && typeof game.recalculateFog === 'function') game.recalculateFog(game);
});

function presentDungeon(d, animate){
  buildScene(d);
  applyObjectVis();
  const TH = THEMES[d.params.themeKey] || THEMES.ancient;
  if(el.vTheme) el.vTheme.textContent = (themeSel==='auto' && !TH.overland) ? 'AUTO \u00b7 '+TH.label : TH.label;
  if(el.dname) el.dname.textContent = d.name;
  const st = d.stats;
  if(el.dsub){
    const weatherInfo = (TH.overland && d.timeOfDay && d.weather)
      ? ' \u00b7 <span style="opacity:0.85">' + d.timeOfDay + ' \u00b7 ' + d.weather + '</span>'
      : '';
    el.dsub.innerHTML = 'seed ' + d.seed +
      ' \u00b7 <span style="color:var(--ember)">' + TH.label.toLowerCase() + '</span>' +
      ' \u00b7 ' + (TH.overland ? 'overland' : 'floor ' + ((d.seed % 9) + 2)) +
      weatherInfo +
      ' \u00b7 ' + (d.valid ? '<span class="ok">connected \u2713</span>' : '<span class="bad">unresolved</span>') +
      (st.attempts > 1 ? ' \u00b7 reroll \u00d7' + (st.attempts-1) : '');
  }
  if(el.sRooms) el.sRooms.textContent  = st.rooms;
  if(el.sEdges) el.sEdges.textContent  = st.edges + ' \u00b7 ' + st.loops;
  if(el.sCrit) el.sCrit.textContent   = st.critLen + ' rm';
  if(el.sTiles) el.sTiles.textContent  = st.floorTiles;
  if(el.sLights) el.sLights.textContent = lights.length;
  if(el.sMs) el.sMs.textContent     = st.genMs.toFixed(1) + 'ms';

  if (!animate || !el.tAnim.checked) finishAnim();

  game.onDungeon(d);
  if (d && d.name) revealLoadingMap(d.name);
  if (game.state === 'boot') {
    hideLoadingScreen();
  }
}

/* ---------------- Engine Glue Object ---------------- */
const ENGINE = {
  scene,
  cam,
  renderer,
  camTarget,
  updateCam,
  isAnimating: () => isAnimating(),
  finishAnim: () => finishAnim(),
  getMeshes: () => meshes,
  getFloorMap: () => ({ start: floorCellStart, count: floorCellCount }),
  getLights: () => lights,
  getStandalone: () => standaloneRooms,
  getParticles: () => fx.parts,
  setTorchLit,
  reforge(seed, roomCount, themeKey, animate=false, threatMult=1, level=1, opts = {}){
    /* The curtain is already up. _loadFloor shows it and yields a paint before
       calling here. A second show used to zero the march and replace the
       quest title with "FORGING LEVEL" on the same turn the floor was built. */
    forgeThreatMult = threatMult;
    forgeLevel = level;
    forgeOpts = opts || {};
    if(el.seed) el.seed.value = seed;
    if(el.rooms) el.rooms.value = Math.max(12, Math.min(80, roomCount));
    setThemeSel(themeKey);
    forge(animate);
    forgeThreatMult = 1;
    /* forgeLevel stays put: a manual re-forge from the forge panel should match
       the floor you're standing on, not snap back to the level-1 curve. */
  },
  reforgeOverland(seed, opts = {}){
    forgeOverland(seed, opts);
  },
  triggerHitStop(frames = 3) {
    triggerHitStop(frames);
  },
  triggerSlowMo(duration = 1.5) {
    triggerSlowMo(duration);
  },
  triggerShake(intensity = 0.6, duration = 0.3) {
    shakeCamera(intensity);
  }
};

function forgeCurtain() {
  const opts = { title: 'FORGING DUNGEON', subtitle: 'Sculpting corridors and placing encounters...' };
  const theme = THEMES[themeSel];
  if (themeSel && themeSel !== 'auto' && theme) {
    opts.theme = themeSel;
    opts.map = theme.label;
    if (theme.overland && el.seed) {
      const env = resolveOverlandEnvironment(themeSel, (Number(el.seed.value) || 1) >>> 0);
      opts.timeOfDay = env.timeOfDay;
      opts.weather = env.weather;
      opts.seed = (Number(el.seed.value) || 1) >>> 0;
    }
  }
  return opts;
}

/* The click has to put the curtain on screen before forge() runs. forge()
   builds the whole floor in this turn, and a same-turn call never paints. */
function forgeWhenPainted() {
  showLoadingScreen(forgeCurtain());
  scheduleAfterPaint(() => forge(true));
}

/* ---------------- UI Event Handlers ---------------- */
if(el.seed) el.seed.addEventListener('change', () => {
  forgeWhenPainted();
});
if(el.dice) el.dice.addEventListener('click', () => {
  el.seed.value = 1 + Math.floor(Math.random()*999999);
  forgeWhenPainted();
});
if(el.forge) el.forge.addEventListener('click', () => {
  forgeWhenPainted();
});

document.querySelectorAll('#chips .chip').forEach(ch => {
  ch.addEventListener('click', () => {
    setThemeSel(ch.dataset.t);
    forgeWhenPainted();
  });
});

document.querySelectorAll('#objchips .chip').forEach(ch => {
  ch.addEventListener('click', () => {
    const cat = ch.dataset.o;
    if (objVis[cat] !== undefined) {
      objVis[cat] = !objVis[cat];
      ch.classList.toggle('on', objVis[cat]);
      ch.setAttribute('aria-pressed', objVis[cat]);
      applyObjectVis();
    }
  });
});

const collapseBtn = document.getElementById('collapse');
if(collapseBtn){
  collapseBtn.addEventListener('click', e => {
    const p = document.getElementById('panel');
    if(p){
      p.classList.toggle('min');
      e.target.textContent = p.classList.contains('min') ? '+' : '\u2013';
    }
  });
}

window.addEventListener('resize', () => {
  if(renderer){
    renderer.setSize(window.innerWidth, window.innerHeight);
    const aspect = window.innerWidth / window.innerHeight;
    cam.left   = -55 * aspect;
    cam.right  =  55 * aspect;
    cam.top    =  55;
    cam.bottom = -55;
    cam.updateProjectionMatrix();
  }
});

/* ---------------- Initialization ---------------- */
window.game = game;
window.ENGINE = ENGINE;

/* The main menu waits on the title card, not the dungeon curtain. The map
   plaque is for floors. Mount the dev button first so its row is already in
   the menu box when that first frame paints. */
mountTestDelveTitleButton();
showTitleLoading('Preparing assets & archives...');
/* The icon index tells the registry which generated PNGs exist, so a missing
   one falls back to its old emoji instead of rendering a broken image. It is
   loaded alongside the asset pack and never blocks boot: if the fetch fails,
   every lookup stays optimistic and the UI still works.
   Yield a paint first. A cached pack resolves in a microtask of this turn
   and used to forge before the title card was on screen. */
scheduleAfterPaint(() => {
  Promise.all([initAssetPack(), loadIconManifest()]).finally(() => {
    game.init(ENGINE);
    initTestDungeon(game);
    forge(true);
    tick();
    /* Balance-test harness (sim/real): the real game, driven in fast-forward.
       Dev server only — sim/ is not part of any build. */
    if (import.meta.env && import.meta.env.DEV && new URLSearchParams(location.search).has('sim')) {
      /* The first fetch of the module can fail while the dev server is still
         transforming it; try again a few times before giving up. */
      const simBoot = '/sim/real/boot.js';
      const loadSim = (left) => import(/* @vite-ignore */ simBoot + (left < 5 ? '?retry=' + left : ''))
        .catch(err => (left > 0 ? new Promise(r => setTimeout(r, 1500)).then(() => loadSim(left - 1)) : Promise.reject(err)));
      loadSim(5);
    }
  });
});
