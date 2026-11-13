/**
 * DUNGEON & OVERLAND EDITOR — live theme tuning against the real renderer.
 *
 * Renders an actual forged level with the shipping scene code, then edits the
 * THEMES entry in place so every change is visible immediately. Edits are
 * tracked as a per-theme patch and written to src/game/theme_overrides.json,
 * which dungeon_generator.js merges over its defaults at import.
 *
 * The Textures tab is a browser port of tools/build_tile_atlas.py: it bakes the
 * same 2x2 atlases from the DCSS source tiles so the bake knobs (sat, target,
 * curve, neutralize, rotate, stack) can be dialled in against the lit scene
 * instead of a flat preview, then saved into public/art/tiles.
 */
import * as THREE from 'three';
import { THEMES, generateDungeon, QUEST_OVERLAND_MAP } from './dungeon/dungeon_generator.js';
import { TOD_LIGHT_KEYS, timeOfDayTheme, buildEffectiveOverlandTheme } from './dungeon/overland_weather.js';
import SAVED_OVERRIDES from './game/theme_overrides.json' with { type: 'json' };
import {
  renderer, cam, camTarget, updateCam, buildScene, renderFrame, liveUpdate,
  finishAnim, applyThemeEnv, applyTorchSettings, lights, registerProp, registeredProps,
  DEFAULT_CAM_ZOOM, MIN_CAM_ZOOM, MAX_CAM_ZOOM, setSunAngle, scene
} from './render/dungeon_scene.js';
import { buildSolidProps } from './game/pathfinding.js';
import {
  spawnAmbientCritters, clearAmbientCritters, tickAmbientCritters,
  ambientCritterCounts, crittersFor
} from './render/ambient_critters.js';
import { updateLivePixelFx } from './render/pixelfx_live.js';
import SAVED_CUSTOM_PROPS from './game/custom_props.json' with { type: 'json' };
import { setLightDebug, lightDebugOn, tickLightDebug, lightDebugSummary, applyThemeLightLevels, DARK_CUE_DEFAULT } from './render/sprite_lighting.js';
import { LIGHT_LEVEL_DEFAULTS } from './game/light_sources.js';
import { matFloor, matWall, matWallCap, setTileOverride } from './render/dungeon_materials.js';

/* ---------------- state ---------------- */
const DUNGEON_KEYS = Object.keys(THEMES).filter(k => !THEMES[k].overland);
const OVERLAND_KEYS = Object.keys(THEMES).filter(k => THEMES[k].overland);

const state = {
  themeKey: 'ancient',
  seed: 4242,
  tab: 'generate',
  /* overlandLayout 'quest' = exactly what quests generate (QUEST_OVERLAND_MAP:
     a 50 x 300 ribbon, nine clearings) and ignores the size sliders; 'ribbon'
     and 'classic' use the sliders. */
  gen: { roomCount: 16, loopChance: 0.18, decorDensity: 1, threatMult: 1,
         level: 1, mapW: 0, mapH: 0, zones: 0, timeOfDay: 'auto', weather: 'auto',
         overlandLayout: 'quest' },
  zoom: DEFAULT_CAM_ZOOM,
  animate: false
};

/* Per-theme patch of everything touched this session, keyed exactly like THEMES
   so it can be written straight out as the override file. */
const patches = JSON.parse(JSON.stringify(SAVED_OVERRIDES || {}));
const patchFor = k => (patches[k] ||= {});

/* Texture recipes live in the patch too (under `tiles`) so a bake is
   reproducible: the atlas PNG is an artifact, the recipe is the source. */
const DEFAULT_RECIPE = {
  family: '', variants: [0, 1, 2, 3], sat: 0.25, target: 0.6, curve: 'gamma',
  neutralize: '', neutralizeAmt: 1, rotate: 0, stack: 1, bumpScale: 0.45
};
let families = {};           /* "floor/rect_gray" -> [0,1,2,3,...] */
let familiesPromise = null;  /* lazy, retried on demand — the dev server can be
                                slow right after a restart and a failed boot
                                fetch would otherwise leave the picker empty */
const bakedTex = {};         /* slot -> {map, bump, canvas, bumpCanvas} */

const el = id => document.getElementById(id);
const body = el('body'), statusEl = el('status');

/* ---------------- helpers ---------------- */
const hex2css = n => '#' + (n >>> 0).toString(16).padStart(6, '0');
const css2hex = s => parseInt(s.replace('#', ''), 16) >>> 0;
const TH = () => THEMES[state.themeKey];

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = kind || '';
  if (kind === 'ok') setTimeout(() => { if (statusEl.textContent === msg) statusEl.textContent = ''; }, 4000);
}

/** Record a change into the theme patch, following a dotted path. */
function recordPatch(pathStr, value) {
  const parts = pathStr.split('.');
  let node = patchFor(state.themeKey);
  for (let i = 0; i < parts.length - 1; i++) node = (node[parts[i]] ||= {});
  node[parts[parts.length - 1]] = value;
}

function getPath(obj, pathStr) {
  return pathStr.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj, pathStr, value) {
  const parts = pathStr.split('.');
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) node = (node[parts[i]] ||= {});
  node[parts[parts.length - 1]] = value;
}

let lastD = null;
let rebuildTimer = 0;
let critterTimer = 0;
function scheduleRebuild(delay = 140) {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(forge, delay);
}

/** Respawn critters on the forge already on screen. */
function scheduleCritters(delay = 80) {
  clearTimeout(critterTimer);
  critterTimer = setTimeout(placeCritters, delay);
}

/** Resolved critter row for the theme on screen. Theme overrides win over the moor defaults. */
function critterCfg() {
  return crittersFor(state.themeKey, TH().critters);
}

function critterCountLine() {
  const c = ambientCritterCounts();
  const bit = (n, word, plural) => `${n} ${n === 1 ? word : (plural || word + 's')}`;
  return `${bit(c.frogs, 'frog')} · ${bit(c.snakes, 'snake')} · ${bit(c.dragonflies, 'dragonfly', 'dragonflies')} · ${bit(c.butterflies, 'butterfly', 'butterflies')} · ${bit(c.birds, 'bird')} · ${bit(c.bats, 'bat')} · ${bit(c.skinks, 'skink')} · ${bit(c.squirrels, 'squirrel')} on this map`;
}

function refreshCritterCount() {
  const node = document.getElementById('critter-count');
  if (node) node.textContent = critterCountLine();
}

const COUNT_KINDS = new Set(['snake', 'dragonfly', 'butterfly', 'bird', 'bat', 'skink', 'squirrel']);

/**
 * Write one critter field onto the theme and into the save patch. Raising a
 * count minimum past the maximum pulls the maximum up with it, and the other
 * way around, so the pair that gets saved is the pair that will spawn.
 */
function storeCritter(kind, field, value) {
  const cur = critterCfg();
  if (field === 'enabled') value = !!value;
  else if (field === 'chance') {
    const n = Number(value);
    value = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : cur.frog.chance;
  } else {
    const n = Math.round(Number(value));
    const fallback = cur[kind] && cur[kind][field] != null ? cur[kind][field] : 0;
    value = Number.isFinite(n) ? Math.min(24, Math.max(0, n)) : fallback;
  }
  const next = { ...cur[kind], [field]: value };
  if (COUNT_KINDS.has(kind) && next.min > next.max) {
    if (field === 'min') next.max = next.min;
    else next.min = next.max;
  }
  setPath(TH(), `critters.${kind}.${field}`, next[field]);
  recordPatch(`critters.${kind}.${field}`, next[field]);
  if (COUNT_KINDS.has(kind) && (field === 'min' || field === 'max')) {
    const other = field === 'min' ? 'max' : 'min';
    if (next[other] !== cur[kind][other]) {
      setPath(TH(), `critters.${kind}.${other}`, next[other]);
      recordPatch(`critters.${kind}.${other}`, next[other]);
    }
  }
}

/** Props block a bank, so stamp solidProps before the spawn reads the grid. */
function placeCritters() {
  clearTimeout(critterTimer);
  critterTimer = 0;
  if (!lastD) return ambientCritterCounts();
  if (!lastD.solidProps) {
    const solid = buildSolidProps(lastD);
    if (solid) lastD.solidProps = solid;
  }
  spawnAmbientCritters(scene, lastD);
  refreshCritterCount();
  return ambientCritterCounts();
}

/* ---------------- forge ---------------- */
function forge() {
  clearAmbientCritters();
  const th = TH();
  const params = {
    seed: state.seed >>> 0,
    themeKey: state.themeKey,
    roomCount: state.gen.roomCount,
    loopChance: state.gen.loopChance,
    decorDensity: state.gen.decorDensity,
    threatMult: state.gen.threatMult
  };
  if (th.overland) {
    params.level = state.gen.level;
    params.mapW = state.gen.mapW;
    params.mapH = state.gen.mapH;
    params.zones = state.gen.zones;
    const lay = state.gen.overlandLayout || 'quest';
    if (lay === 'quest') Object.assign(params, QUEST_OVERLAND_MAP);
    else if (lay === 'ribbon') params.layout = 'ribbon';
    if (state.gen.timeOfDay && state.gen.timeOfDay !== 'auto') params.timeOfDay = state.gen.timeOfDay;
    if (state.gen.weather && state.gen.weather !== 'auto') params.weather = state.gen.weather;
  }
  const t0 = performance.now();
  const d = generateDungeon(params.seed, params);
  lastD = d;
  buildScene(d);
  const counts = placeCritters();
  if (!state.animate) finishAnim();
  cam.zoom = state.zoom;
  cam.updateProjectionMatrix();
  updateCam();
  const weatherStr = (th.overland && d.timeOfDay && d.weather) ? ` · ${d.timeOfDay} · ${d.weather}` : '';
  el('hud').innerHTML =
    `<b>${th.label}</b> · seed ${d.seed}${weatherStr} · ${d.stats.rooms} rooms · ` +
    `${d.stats.floorTiles} tiles · ${counts.frogs} frogs · ${counts.snakes} snakes · ` +
    `${counts.dragonflies} dragonflies · ${counts.birds} birds · ${counts.bats} bats · ` +
    `${counts.skinks} skinks · ${counts.squirrels} squirrels · ` +
    `${lights.length} lights · ${(performance.now() - t0).toFixed(0)}ms`;
}

/* ---------------- control builders ---------------- */
function group(title) {
  const g = document.createElement('div');
  g.className = 'group';
  g.innerHTML = `<h2>${title}</h2>`;
  body.appendChild(g);
  return g;
}
function row(g, label) {
  const r = document.createElement('div');
  r.className = 'row';
  r.innerHTML = `<label>${label}</label><div class="ctl"></div>`;
  g.appendChild(r);
  return r.querySelector('.ctl');
}
function hint(g, text) {
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = text;
  g.appendChild(p);
}

function slider(g, label, opts) {
  const ctl = row(g, label);
  const { min = 0, max = 1, step = 0.01, get, set, fmt = v => (+v).toFixed(2), live } = opts;
  const input = document.createElement('input');
  input.type = 'range'; input.min = min; input.max = max; input.step = step;
  input.value = get();
  const out = document.createElement('span');
  out.className = 'val'; out.textContent = fmt(get());
  input.oninput = () => {
    const v = parseFloat(input.value);
    out.textContent = fmt(v);
    set(v);
    if (live) live(); else scheduleRebuild();
  };
  ctl.append(input, out);
  return input;
}

function colorRow(g, label, opts) {
  const ctl = row(g, label);
  const { get, set, live } = opts;
  const pick = document.createElement('input');
  pick.type = 'color'; pick.value = hex2css(get());
  const text = document.createElement('input');
  text.type = 'text'; text.className = 'hex'; text.value = hex2css(get());
  const apply = (cssVal, fromText) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(cssVal)) return;
    if (fromText) pick.value = cssVal; else text.value = cssVal;
    set(css2hex(cssVal));
    if (live) live(); else scheduleRebuild();
  };
  pick.oninput = () => apply(pick.value, false);
  text.onchange = () => apply(text.value.trim(), true);
  ctl.append(pick, text);
  return pick;
}

function select(g, label, options, opts) {
  const ctl = row(g, label);
  const sel = document.createElement('select');
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = typeof o === 'string' ? o : o.value;
    opt.textContent = typeof o === 'string' ? o : o.label;
    sel.appendChild(opt);
  }
  sel.value = opts.get();
  sel.onchange = () => { opts.set(sel.value); (opts.live || scheduleRebuild)(); };
  ctl.append(sel);
  return sel;
}

function numberRow(g, label, opts) {
  const ctl = row(g, label);
  const input = document.createElement('input');
  input.type = 'number';
  if (opts.min != null) input.min = opts.min;
  if (opts.max != null) input.max = opts.max;
  input.step = opts.step ?? 1;
  input.value = opts.get();
  input.onchange = () => { opts.set(parseFloat(input.value)); (opts.live || scheduleRebuild)(); };
  ctl.append(input);
  return input;
}

function buttons(g, defs) {
  const wrap = document.createElement('div');
  wrap.className = 'btnrow';
  for (const d of defs) {
    const b = document.createElement('button');
    b.textContent = d.label;
    if (d.primary) b.className = 'primary';
    b.onclick = d.onClick;
    wrap.appendChild(b);
  }
  g.appendChild(wrap);
  return wrap;
}

/* Theme value bound to a control: writes THEMES in place AND records the patch. */
function themeBinding(pathStr) {
  return {
    get: () => getPath(TH(), pathStr),
    set: v => { setPath(TH(), pathStr, v); recordPatch(pathStr, v); }
  };
}
/* ── per-time-of-day lighting (overland only) ──
   An overland map's lighting is the base theme run through its time of day
   (overland_weather.js timeOfDayTheme), so editing the base moved day, dusk
   and night together. Here the Lighting tab edits the time being viewed:
   values read from that time's derived look and are written to
   THEMES[k].tod[time] (saved under the same path). Dungeons have one time of
   day and keep editing the base theme. */
const todOf = () => {
  if (!TH().overland) return null;
  const t = state.gen.timeOfDay;
  return t && t !== 'auto' ? t : (lastD && lastD.timeOfDay) || 'day';
};
function lightGet(key) {
  const t = todOf();
  const v = t ? timeOfDayTheme(TH(), t)[key] : TH()[key];
  return Array.isArray(v) ? [...v] : (v && typeof v === 'object') ? { ...v } : v;
}
function lightSet(key, value) {
  const t = todOf();
  if (!t) { TH()[key] = value; recordPatch(key, value); return; }
  const tod = (TH().tod ||= {});
  (tod[t] ||= {})[key] = value;
  recordPatch(`tod.${t}.${key}`, Array.isArray(value) ? [...value] : value);
}
/* one element of an array-valued lighting key (hemi, dir, sunAngle, torchLight) */
const lightAt = (key, i) => ({
  get: () => lightGet(key)[i],
  set: v => { const cur = lightGet(key); cur[i] = v; lightSet(key, cur); }
});
const lightBinding = key => ({ get: () => lightGet(key), set: v => lightSet(key, v) });
/* light cut-offs + darkness shading: one `lightLevels` block per theme, and
   per time of day on overland themes, like everything else on this tab */
const levelsNow = () => ({ ...LIGHT_LEVEL_DEFAULTS, darkCue: DARK_CUE_DEFAULT, ...(lightGet('lightLevels') || {}) });
const levelAt = k => ({
  get: () => levelsNow()[k],
  set: v => { const cur = levelsNow(); cur[k] = v; lightSet('lightLevels', cur); applyThemeLightLevels(liveTheme()); }
});

/* The scene draws an overland map from d.effectiveTheme (the base run through
   time AND weather), so a live edit rebuilds that object's lighting keys in
   place rather than applying the bare base theme. */
function liveTheme() {
  const d = lastD;
  if (!TH().overland || !d || !d.effectiveTheme || !d.weatherEnv) return TH();
  const fresh = buildEffectiveOverlandTheme(TH(), d.weatherEnv);
  for (const k of TOD_LIGHT_KEYS) d.effectiveTheme[k] = fresh[k];
  d.effectiveTheme.weatherDirScale = fresh.weatherDirScale;
  d.effectiveTheme.weatherHemiScale = fresh.weatherHemiScale;
  d.effectiveTheme.accent = fresh.accent;
  return d.effectiveTheme;
}
const envLive = () => applyThemeEnv(liveTheme());

/* ---------------- tabs ---------------- */
const TABS = ['generate', 'critters', 'lighting', 'palette', 'textures', 'scatter', 'assets'];

function renderTabs() {
  const bar = el('tabs');
  bar.innerHTML = '';
  for (const t of TABS) {
    const b = document.createElement('button');
    b.className = 'tab' + (state.tab === t ? ' on' : '');
    b.textContent = t;
    b.onclick = () => { state.tab = t; renderTabs(); renderPanel(); };
    bar.appendChild(b);
  }
}

function renderPanel() {
  body.innerHTML = '';
  ({ generate: tabGenerate, critters: tabCritters, lighting: tabLighting, palette: tabPalette,
     textures: tabTextures, scatter: tabScatter, assets: tabAssets })[state.tab]();
}

/* A min/max critter. Changing the pair respawns and redraws the rows, because
   raising the minimum can pull the maximum up with it. */
function countKindGroup(title, kind, blurb) {
  const g = group(title);
  const on = row(g, `Spawn ${title.toLowerCase()}`);
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = critterCfg()[kind].enabled;
  cb.onchange = () => {
    storeCritter(kind, 'enabled', cb.checked);
    placeCritters();
  };
  on.append(cb);
  const respawn = () => { placeCritters(); renderPanel(); };
  numberRow(g, 'Minimum', {
    min: 0, max: 24, step: 1,
    get: () => critterCfg()[kind].min,
    set: v => storeCritter(kind, 'min', v),
    live: respawn,
  });
  numberRow(g, 'Maximum', {
    min: 0, max: 24, step: 1,
    get: () => critterCfg()[kind].max,
    set: v => storeCritter(kind, 'max', v),
    live: respawn,
  });
  hint(g, blurb);
}

/* ---- Critters ---- */
/* Ambiance only. A change here respawns on the current forge; it does not
   rebuild the rooms. Save still goes out through theme_overrides.json. */
function tabCritters() {
  const cfg = critterCfg();
  const frogs = group('Frogs');
  const frogOn = row(frogs, 'Spawn frogs');
  const frogCb = document.createElement('input');
  frogCb.type = 'checkbox';
  frogCb.checked = cfg.frog.enabled;
  frogCb.onchange = () => {
    storeCritter('frog', 'enabled', frogCb.checked);
    placeCritters();
  };
  frogOn.append(frogCb);
  slider(frogs, 'Spawn chance', {
    min: 0, max: 1, step: 0.01,
    fmt: v => `${Math.round(v * 100)}%`,
    get: () => critterCfg().frog.chance,
    set: v => storeCritter('frog', 'chance', v),
    live: () => scheduleCritters(),
  });
  hint(frogs, 'Each body of water rolls this chance and places one frog on a dry floor bank, at least four tiles from another frog. A dry map stays empty.');

  countKindGroup('Snakes', 'snake', 'That many snakes on grass off the track (the two tiles nearest the road). They rest, then crawl four or five tiles. The body lies flat until the crawl.');
  countKindGroup('Dragonflies', 'dragonfly', 'That many dragonflies over water, or over open floor when the map is dry. Each hovers, then darts a few tiles and glides, and sometimes sits still on a grass top for about a minute. A living hero or monster within five tiles sends it off.');
  countKindGroup('Butterflies', 'butterfly', 'That many butterflies over grass, or over open floor when the map has none. Each loiters in a slow chaotic flutter, then drifts to a new spot. It sits on a leaf less often than it flies. A living hero or monster within five tiles sends it off.');
  countKindGroup('Birds', 'bird', 'That many birds, one per clearing that has two trees at least eight tiles apart. Each sits with its wings folded, drops to the ground to peck, then flies to another tree. A living hero or monster within five tiles sends it off.');
  countKindGroup('Bats', 'bat', 'That many bats, one per clearing with two trees that far apart. Each hangs upside down with its wings folded, then flies to the other tree. The eyes stay dark.');
  countKindGroup('Skinks', 'skink', 'That many skinks on open stone off the road, never on lava or water. Each basks, then scuttles three or four tiles. Ash wears a rust stripe. The ruins wear a pale shoulder mark. A living hero or monster within five tiles sends it off.');
  countKindGroup('Squirrels', 'squirrel', 'That many squirrels at the foot of a tree, or on open snow when the map has fewer than two trees. Each sits with its tail curled, then dashes to another tree. A living hero or monster within five tiles sends it off.');

  const info = group('On this map');
  const count = document.createElement('p');
  count.className = 'hint';
  count.id = 'critter-count';
  count.textContent = critterCountLine();
  info.appendChild(count);
  hint(info, `${TH().label} (${state.themeKey}). These respawn on the map in view. Map size, seed, and decor still rebuild from the other tabs, and the new forge places critters again. Save writes this theme into theme_overrides.json.`);
}

/* ---- Generate ---- */
function tabGenerate() {
  const g = group('Theme');
  const ctl = row(g, 'Theme');
  const sel = document.createElement('select');
  for (const [label, keys] of [['Dungeon', DUNGEON_KEYS], ['Overland', OVERLAND_KEYS]]) {
    const grp = document.createElement('optgroup');
    grp.label = label;
    for (const k of keys) {
      const o = document.createElement('option');
      o.value = k; o.textContent = `${THEMES[k].label.toLowerCase()}  (${k})`;
      grp.appendChild(o);
    }
    sel.appendChild(grp);
  }
  sel.value = state.themeKey;
  sel.onchange = () => {
    state.themeKey = sel.value;
    loadRecipesForTheme();
    renderPanel();
    forge();
  };
  ctl.append(sel);

  const s = group('Seed & layout');
  numberRow(s, 'Seed', { get: () => state.seed, set: v => { state.seed = v >>> 0; }, step: 1 });
  buttons(s, [{ label: 'Randomise seed', onClick: () => { state.seed = (Math.random() * 1e9) >>> 0; renderPanel(); forge(); } },
              { label: 'Re-forge', primary: true, onClick: forge }]);
  slider(s, 'Rooms', { min: 6, max: 42, step: 1, fmt: v => v | 0,
    get: () => state.gen.roomCount, set: v => { state.gen.roomCount = v; } });
  slider(s, 'Loop chance', { min: 0, max: 0.6, step: 0.01,
    get: () => state.gen.loopChance, set: v => { state.gen.loopChance = v; } });
  slider(s, 'Decor density', { min: 0, max: 2, step: 0.05,
    get: () => state.gen.decorDensity, set: v => { state.gen.decorDensity = v; } });
  slider(s, 'Threat mult', { min: 0.25, max: 3, step: 0.05,
    get: () => state.gen.threatMult, set: v => { state.gen.threatMult = v; } });

  if (TH().overland) {
    const o = group('Overland');
    slider(o, 'Party level', { min: 1, max: 20, step: 1, fmt: v => v | 0,
      get: () => state.gen.level, set: v => { state.gen.level = v; } });
    /* 'Quest' is what the game generates for every quest overland floor; the
       size sliders only apply to the other two. */
    select(o, 'Layout', ['quest', 'ribbon', 'classic'], {
      get: () => state.gen.overlandLayout || 'quest',
      set: v => { state.gen.overlandLayout = v; } });
    /* Ranges mirror generateOverland's own clamps: 48-120 tiles (classic),
       height up to 320 and width from 36 for ribbons; 4-12 zones. */
    const sizeFmt = v => (v < 48 ? 'auto (58)' : String(v | 0));
    slider(o, 'Map width', { min: 36, max: 120, step: 2, fmt: sizeFmt,
      get: () => state.gen.mapW, set: v => { state.gen.mapW = v < 48 && state.gen.overlandLayout !== 'ribbon' ? 0 : v; } });
    slider(o, 'Map height', { min: 44, max: 320, step: 4, fmt: sizeFmt,
      get: () => state.gen.mapH, set: v => { state.gen.mapH = v < 48 ? 0 : v; } });
    slider(o, 'Zones', { min: 0, max: 12, step: 1, fmt: v => (v ? String(v | 0) : 'auto'),
      get: () => state.gen.zones, set: v => { state.gen.zones = v; } });
    hint(o, `Layout "quest" is exactly what quests generate (${QUEST_OVERLAND_MAP.mapW} x ` +
      `${QUEST_OVERLAND_MAP.mapH} ribbon, ${QUEST_OVERLAND_MAP.zones} clearings) and ignores the sliders. ` +
      '"ribbon" and "classic" use them (classic clamps to 48-120). Zoom out to see a size ' +
      'change — the camera does not reframe. Blockers: ' +
      `${TH().blockerGeo === 'block' ? 'masonry' : 'trees'}, ground: ${TH().groundMat || 'grass'}.`);
    select(o, 'Time of Day', ['auto', 'day', 'dusk', 'night'], {
      get: () => state.gen.timeOfDay || 'auto',
      set: v => { state.gen.timeOfDay = v; forge(); }
    });
    select(o, 'Weather', ['auto', 'clear', 'overcast', 'rain', 'fog', 'snow', 'blizzard', 'ash', 'spores'], {
      get: () => state.gen.weather || 'auto',
      set: v => { state.gen.weather = v; forge(); }
    });
    select(o, 'Blocker geo', ['tree', 'block'], {
      get: () => TH().blockerGeo || 'tree',
      set: v => { TH().blockerGeo = v; recordPatch('blockerGeo', v); }
    });
    select(o, 'Ground material', ['grass', 'floor', 'ice'], {
      get: () => TH().groundMat || 'grass',
      set: v => { TH().groundMat = v; recordPatch('groundMat', v); }
    });
  }

  const v = group('View');
  slider(v, 'Camera zoom', { min: MIN_CAM_ZOOM, max: MAX_CAM_ZOOM, step: 0.1,
    get: () => state.zoom, set: val => { state.zoom = val; },
    live: () => { cam.zoom = state.zoom; cam.updateProjectionMatrix(); } });
  hint(v, 'Drag to orbit, wheel to zoom — same controls as the game view.');
}

/* ---- Lighting ---- */
/* Light debug: the game's F4 overlay — every floor tile tinted by the light
   status the rules see (bright / dim / dark). Here it doubles as a tuning aid:
   move the ambient and torch sliders below and watch the split change. */
function lightDebugGroup(tod) {
  const g = group(tod ? `Light debug (F4) — ${tod}` : 'Light debug (F4)');
  const ctl = row(g, 'Show light levels');
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.id = 'light-debug-cb'; cb.checked = lightDebugOn();
  cb.onchange = () => { setLightDebug(cb.checked); refreshLightDebugReadout(); };
  ctl.append(cb);
  const out = document.createElement('p');
  out.className = 'hint'; out.id = 'light-debug-readout';
  g.appendChild(out);
  hint(g, 'Yellow = bright, blue = dim, red = dark. The party\'s own torches only light during a run, so here you see the map lights alone.');
  /* The rules' cut-offs, saved per theme (and per time of day overland) as
     `lightLevels`; buildScene loads them for every level. Re-setting the
     overlay forces an immediate repaint. */
  const thr = () => { setLightDebug(lightDebugOn()); refreshLightDebugReadout(); };
  slider(g, 'Bright at ≥', { min: 0.05, max: 1.5, step: 0.01, live: thr, ...levelAt('bright') });
  slider(g, 'Dim at ≥', { min: 0.01, max: 1.0, step: 0.01, live: thr, ...levelAt('dim') });
  slider(g, 'Sky fill counts', { min: 0, max: 1, step: 0.05, live: thr, ...levelAt('skyWeight') });
  /* The in-game cue (with F4 off): dim floor a touch cooler, dark floor a
     darker cool blue-grey. 0 turns it off. */
  slider(g, 'Darkness shading', { min: 0, max: 1.5, step: 0.05, live: thr, ...levelAt('darkCue') });
  hint(g, (tod ? `Saved for ${tod} on this theme. ` : 'Saved for this theme. ') +
    `Untouched values use the defaults (bright ${LIGHT_LEVEL_DEFAULTS.bright}, dim ${LIGHT_LEVEL_DEFAULTS.dim}, ` +
    `sky ${LIGHT_LEVEL_DEFAULTS.skyWeight}, shading ${DARK_CUE_DEFAULT}). ` +
    'Sky fill 0 = the Hemi sliders brighten the picture without lighting anything for the rules.');
  refreshLightDebugReadout();
}
function refreshLightDebugReadout() {
  const out = document.getElementById('light-debug-readout');
  if (!out) return;
  if (!lightDebugOn()) { out.textContent = 'off'; return; }
  const sm = lightDebugSummary();
  const pc = v => Math.round(v * 100) + '%';
  out.textContent = sm.tiles
    ? `bright ${pc(sm.bright)} · dim ${pc(sm.dim)} · dark ${pc(sm.dark)}  (${sm.tiles} tiles)`
    : 'sampling…';
}
setInterval(refreshLightDebugReadout, 500);

/* F4 here too, same as in the game; keeps the checkbox in step. */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'F4' || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  setLightDebug(!lightDebugOn());
  const cb = document.getElementById('light-debug-cb');
  if (cb) cb.checked = lightDebugOn();
  refreshLightDebugReadout();
});

function tabLighting() {
  const tod = todOf();
  if (tod) {
    const w = group('Time of day');
    select(w, 'Editing', ['day', 'dusk', 'night'], {
      get: () => tod,
      set: v => { state.gen.timeOfDay = v; },
      live: () => { forge(); renderPanel(); }
    });
    const tuned = TH().tod && TH().tod[tod];
    buttons(w, [{ label: `Reset ${tod} to derived`, onClick: () => {
      if (TH().tod) delete TH().tod[tod];
      const p = patchFor(state.themeKey);
      if (p.tod) delete p.tod[tod];
      envLive(); applyTorchSettings(liveTheme()); applyThemeLightLevels(liveTheme());
      setLightDebug(lightDebugOn()); renderPanel();
      setStatus(`${tod} lighting derives from the base theme again`, 'ok');
    } }]);
    hint(w, 'Overland lighting is tuned separately for day, dusk and night: the sliders below ' +
      `edit ${tod} only` + (tuned ? ' (hand-tuned).' : ' (still derived from the base theme; your first edit starts its own copy).') +
      ' Weather is layered on top afterwards, so pick Clear weather to see the plain values. ' +
      'The light cut-offs, background, fog, ambient, sun and torch strength are per time; flame colours and the accent are shared.');
  }
  lightDebugGroup(tod);
  const g = group(tod ? `Ambient & sun — ${tod}` : 'Ambient & sun');
  colorRow(g, 'Background', { ...lightBinding('bg'), live: envLive });
  colorRow(g, 'Fog colour', { ...lightBinding('fog'), live: envLive });
  slider(g, 'Fog density', { min: 0, max: 0.006, step: 0.0001, fmt: v => v.toFixed(4),
    ...lightBinding('fogD'), live: envLive });
  colorRow(g, 'Hemi sky', { ...lightAt('hemi', 0), live: envLive });
  colorRow(g, 'Hemi ground', { ...lightAt('hemi', 1), live: envLive });
  slider(g, 'Hemi intensity', { min: 0, max: 1.5, step: 0.01, ...lightAt('hemi', 2), live: envLive });
  colorRow(g, 'Sun colour', { ...lightAt('dir', 0), live: envLive });
  slider(g, 'Sun intensity', { min: 0, max: 2, step: 0.01, ...lightAt('dir', 1), live: envLive });
  const sunAt = i => ({
    get: () => (lightGet('sunAngle') || [54, 46.5])[i],
    set: v => { const cur = [...(lightGet('sunAngle') || [54, 46.5])]; cur[i] = v; lightSet('sunAngle', cur); }
  });
  slider(g, 'Sun azimuth', { min: 0, max: 360, step: 1, fmt: v => `${Math.round(v)}°`,
    ...sunAt(0), live: envLive });
  slider(g, 'Sun elevation', { min: 10, max: 85, step: 1, fmt: v => `${Math.round(v)}°`,
    ...sunAt(1), live: envLive });
  hint(g, 'Ambient and sun are the levers that decide whether a surface reads as its own ' +
         'material or as the light\'s colour — a neutral tile under coloured light takes the light.');

  const t = group('Torches');
  colorRow(t, 'Flame', themeBinding('flame'));
  colorRow(t, 'Flame core', themeBinding('flameCore'));
  const torchLive = () => applyTorchSettings(liveTheme());
  slider(t, tod ? `Torch intensity (${tod})` : 'Torch intensity', { min: 0, max: 4, step: 0.05, live: torchLive,
    ...lightAt('torchLight', 1) });
  slider(t, tod ? `Torch range (${tod})` : 'Torch range', { min: 2, max: 24, step: 0.5, live: torchLive,
    ...lightAt('torchLight', 2) });
  hint(t, 'Torch light colour follows Flame. Only the 16 nearest lit torches get a real ' +
         'light — the rest are billboards, so range matters more than intensity in big rooms.');

  const a = group('Accent');
  const ctl = row(a, 'UI accent');
  const pick = document.createElement('input');
  pick.type = 'color'; pick.value = TH().accent;
  pick.oninput = () => { TH().accent = pick.value; recordPatch('accent', pick.value); envLive(); };
  ctl.append(pick);
  hint(a, 'Drives the --ember CSS variable used by the in-game HUD.');
}

/* ---- Palette ---- */
const PALETTE_KEYS = [
  ['floor', 'Floor'], ['corridor', 'Corridor'], ['wall', 'Wall'], ['cap', 'Wall cap'],
  ['pillar', 'Pillar'], ['cloth', 'Cloth/banners']
];
function tabPalette() {
  const g = group('Surface tints');
  for (const [key, label] of PALETTE_KEYS) {
    if (TH()[key] == null) continue;
    colorRow(g, label, themeBinding(key));
  }
  colorRow(g, 'Debris A', { get: () => TH().debris[0], set: v => { TH().debris[0] = v; recordPatch('debris', [...TH().debris]); } });
  colorRow(g, 'Debris B', { get: () => TH().debris[1], set: v => { TH().debris[1] = v; recordPatch('debris', [...TH().debris]); } });
  hint(g, 'These multiply the tile texture per cell. A saturated tint filters the texture\'s ' +
         'own colours out — keep it near-neutral if you want the tile art to show through.');

  if (TH().overland) {
    const o = group('Overland blockers');
    if (TH().stake != null) colorRow(o, 'Palisade stake', themeBinding('stake'));
    if (TH().stakeCap != null) colorRow(o, 'Stake cap', themeBinding('stakeCap'));
    if (TH().canopyTint != null) colorRow(o, 'Canopy tint', themeBinding('canopyTint'));
  }

  if (TH().pools) {
    const p = group('Liquid pools');
    select(p, 'Mode', [{ value: '0', label: '0 — lava' }, { value: '1', label: '1 — ice' },
                       { value: '2', label: '2 — water' }, { value: '3', label: '3 — miasma' }], {
      get: () => String(TH().pools.mode), set: v => { TH().pools.mode = +v; recordPatch('pools.mode', +v); } });
    colorRow(p, 'Colour A', themeBinding('pools.colA'));
    colorRow(p, 'Colour B', themeBinding('pools.colB'));
    slider(p, 'Glow', { min: 0, max: 3, step: 0.05, ...themeBinding('pools.glow') });
    slider(p, 'Amount', { min: 0, max: 0.6, step: 0.01, ...themeBinding('pools.amount') });
    if (TH().pools.pits != null)
      slider(p, 'Pits', { min: 0, max: 6, step: 1, fmt: v => v | 0, ...themeBinding('pools.pits') });
  }

  const pt = group('Particles');
  if (TH().particles) {
    select(pt, 'Kind', [{ value: '0', label: '0 — dust' }, { value: '1', label: '1 — embers' },
                        { value: '2', label: '2 — snow' }, { value: '3', label: '3 — wisps' },
                        { value: '4', label: '4 — spores' }, { value: '7', label: '7 — blizzard' }], {
      get: () => String(TH().particles.kind), set: v => { TH().particles.kind = +v; recordPatch('particles.kind', +v); } });
    colorRow(pt, 'Colour', themeBinding('particles.color'));
    slider(pt, 'Count', { min: 0, max: 600, step: 10, fmt: v => v | 0, ...themeBinding('particles.n') });
  }
}

/* ---- Scatter ---- */
/* Multipliers over the generator's built-in decoration rates (dungeon_generator
   `dmul`). 1 = the hand-tuned default, 0 = off, >1 = more. */
const DECOR_KEYS = [
  ['furniture', 'Room furniture', 'Tables, chairs, barrels, crates, bookshelves, racks, urns, rugs placed by room archetype. Above 1 adds extra clutter on leftover tiles.'],
  ['debris', 'Loose debris', 'Rubble scattered across open floor.'],
  ['pillars', 'Pillar accents', 'Matched statue-pillar sets in large ancient/grim rooms.'],
  ['sconces', 'Wall sconces', 'Extra wall sconce in furnished rooms.'],
  ['bones', 'Bone litter', 'Skulls, bone piles and skeletons — denser in crypts.'],
  ['webs', 'Cobwebs', 'Corner webs. Native to ancient/grim/verdant and any crypt room; touching this slider switches them on for the current theme too.'],
  ['icicles', 'Icicles & shards', 'Wall icicles and ice shards on frozen lakes. Native to frost; touching this slider switches them on for the current theme too.']
];

/* Overland maps run a different generator: no room archetypes, pillars, sconces
   or webs out there, so those multipliers have nothing to scale. */
const OVERLAND_DECOR = ['debris', 'bones', 'icicles'];

function tabScatter() {
  const overland = !!TH().overland;
  const d = group('Procedural decor');
  for (const [key, label, tip] of DECOR_KEYS) {
    if (overland && !OVERLAND_DECOR.includes(key)) continue;
    const s = slider(d, label, {
      min: 0, max: 2, step: 0.05,
      get: () => TH().decor?.[key] ?? 1,
      set: v => { (TH().decor ||= {})[key] = v; recordPatch(`decor.${key}`, v); }
    });
    s.parentElement.parentElement.title = tip;
  }
  hint(d, 'Multipliers over the generator\'s built-in rates: 1 is as designed, 0 turns the ' +
          'sweep off, above 1 adds more. Hover a row for what it covers.' +
          (overland ? ' Furniture, pillars, sconces and webs are dungeon-only.' : ''));

  const g = group('Tile decoration');
  const tile = TH().tile || {};
  const TILE_LABELS = { runes: 'Runes', embers: 'Embers', rime: 'Rime', rough: 'Rough ice',
                        stains: 'Stains', growth: 'Growth', sprout: 'Sprouts' };
  const known = Object.keys(TILE_LABELS);
  for (const key of known) {
    const present = tile[key] != null;
    slider(g, TILE_LABELS[key] + (present ? '' : ' (off)'), {
      min: 0, max: 1, step: 0.01,
      get: () => TH().tile?.[key] ?? 0,
      set: v => { (TH().tile ||= {})[key] = v; recordPatch(`tile.${key}`, v); }
    });
  }
  hint(g, 'Chance per eligible floor tile. Zero disables the decoration.');

  const p = group('Prop scatter');
  const scatter = TH().propScatter || {};
  const keys = Object.keys(scatter);
  if (!keys.length) hint(p, 'This theme scatters no props of its own.');
  for (const key of keys) {
    slider(p, key, { min: 0, max: 0.02, step: 0.0005, fmt: v => v.toFixed(4),
      get: () => TH().propScatter[key],
      set: v => { TH().propScatter[key] = v; recordPatch(`propScatter.${key}`, v); } });
  }

  if (TH().oc && TH().oc.ground) {
    const o = group('Overland ground cover');
    for (const key of Object.keys(TH().oc.ground)) {
      slider(o, key, { min: 0, max: 0.2, step: 0.002, fmt: v => v.toFixed(3),
        get: () => TH().oc.ground[key],
        set: v => { TH().oc.ground[key] = v; recordPatch(`oc.ground.${key}`, v); } });
    }
  }

  const f = group('Feature flags');
  for (const key of ['graveyards', 'bones', 'roots', 'shafts', 'lakes', 'icicles']) {
    if (TH()[key] == null && !['graveyards', 'bones', 'roots', 'shafts', 'lakes', 'icicles'].includes(key)) continue;
    const ctl = row(f, key);
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = !!TH()[key];
    cb.onchange = () => { TH()[key] = cb.checked; recordPatch(key, cb.checked); scheduleRebuild(); };
    ctl.append(cb);
  }
}

/* ---------------- Textures: in-browser port of build_tile_atlas.py ---------------- */
const SLOTS = [['floor', 'Floor'], ['wall', 'Wall'], ['cap', 'Wall cap']];
let activeSlot = 'floor';

function ensureFamilies() {
  if (Object.keys(families).length) return Promise.resolve(families);
  familiesPromise ||= fetch('/api/list-tile-sources')
    .then(r => r.json())
    .then(j => {
      if (!j.success) throw new Error(j.error || 'list-tile-sources failed');
      families = j.families;
      if (state.tab === 'textures') renderPanel();
      return families;
    })
    .catch(err => { familiesPromise = null; setStatus('tile list: ' + err.message, 'err'); return {}; });
  return familiesPromise;
}

function recipeFor(slot) {
  const p = patchFor(state.themeKey);
  p.tiles ||= {};
  p.tiles[slot] ||= { ...DEFAULT_RECIPE };
  return p.tiles[slot];
}
function loadRecipesForTheme() { for (const [slot] of SLOTS) recipeFor(slot); }

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load failed: ' + src));
    img.src = src;
  });
}

function imgPixels(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, img.width, img.height);
}

/** Luminance histogram across every tile, as the python tool does. */
function jointHistogram(tiles) {
  const hist = new Float64Array(256);
  for (const t of tiles) {
    const d = t.data;
    for (let i = 0; i < d.length; i += 4) {
      hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++;
    }
  }
  return hist;
}

function buildLut(hist, target, curve) {
  let total = 0, sum = 0;
  for (let i = 0; i < 256; i++) { total += hist[i]; sum += hist[i] * i; }
  const mean = total ? sum / total / 255 : 0;
  if (curve === 'gain') {
    const k = mean > 0 ? target / mean : 1;
    return { lut: Array.from({ length: 256 }, (_, i) => Math.min(255, Math.round(i * k))), mean, k };
  }
  const meanAt = gpow => {
    let acc = 0;
    for (let i = 0; i < 256; i++) acc += hist[i] * Math.pow(i / 255, gpow);
    return total ? acc / total : 0;
  };
  let lo = 0.02, hi = 1.0;
  if (mean >= target) { lo = 1.0; hi = 8.0; }
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (meanAt(mid) > target) lo = mid; else hi = mid;
  }
  const gpow = (lo + hi) / 2;
  return { lut: Array.from({ length: 256 }, (_, i) => Math.min(255, Math.round(255 * Math.pow(i / 255, gpow)))), mean, k: gpow };
}

/** normalise -> desaturate -> neutralize, in that order (see the python tool). */
function processTile(imgData, lut, cfg) {
  const d = new Uint8ClampedArray(imgData.data);
  let ratios = null;
  if (cfg.neutralize && /^#?[0-9a-fA-F]{6}$/.test(cfg.neutralize)) {
    const c = css2hex(cfg.neutralize.startsWith('#') ? cfg.neutralize : '#' + cfg.neutralize);
    const rgb = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const avg = (rgb[0] + rgb[1] + rgb[2]) / 3;
    if (avg > 0) ratios = rgb.map(v => Math.max(0.25, 1 + (v / avg - 1) * (cfg.neutralizeAmt ?? 1)));
  }
  for (let i = 0; i < d.length; i += 4) {
    let r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]];
    const grey = 0.299 * r + 0.587 * g + 0.114 * b;
    const keep = cfg.sat;
    r = grey + (r - grey) * keep; g = grey + (g - grey) * keep; b = grey + (b - grey) * keep;
    if (ratios) { r /= ratios[0]; g /= ratios[1]; b /= ratios[2]; }
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  return new ImageData(d, imgData.width, imgData.height);
}

/** Nearest-neighbour upscale + rotate, returning a canvas of side q. */
function tileCanvas(imgData, q, rotate) {
  const src = document.createElement('canvas');
  src.width = imgData.width; src.height = imgData.height;
  src.getContext('2d').putImageData(imgData, 0, 0);
  const out = document.createElement('canvas');
  out.width = q; out.height = q;
  const g = out.getContext('2d');
  g.imageSmoothingEnabled = false;
  if (rotate) {
    g.translate(q / 2, q / 2);
    g.rotate(-rotate * Math.PI / 180);   /* match PIL's counter-clockwise rotate */
    g.translate(-q / 2, -q / 2);
  }
  g.drawImage(src, 0, 0, q, q);
  return out;
}

async function bakeSlot(slot) {
  const cfg = recipeFor(slot);
  if (!cfg.family) return null;
  const variants = cfg.variants.slice(0, 4);
  const imgs = await Promise.all(variants.map(v => {
    const [kind, fam] = [cfg.family.split('/')[0], cfg.family.split('/').slice(1).join('/')];
    return loadImage(`/api/tile-source?path=${encodeURIComponent(`${kind}/${fam}_${v}.png`)}`);
  }));
  const tiles = imgs.map(imgPixels);
  const { lut, mean, k } = buildLut(jointHistogram(tiles), cfg.target, cfg.curve);
  const processed = tiles.map(t => processTile(t, lut, cfg));

  const size = tiles[0].width, scale = 4, q = size * scale;
  const stack = Math.max(1, cfg.stack | 0), qh = q * stack;
  const atlas = document.createElement('canvas');
  atlas.width = q * 2; atlas.height = qh * 2;
  const ag = atlas.getContext('2d');
  ag.imageSmoothingEnabled = false;
  processed.forEach((p, i) => {
    const tc = tileCanvas(p, q, cfg.rotate);
    for (let s = 0; s < stack; s++) ag.drawImage(tc, (i & 1) * q, (i >> 1) * qh + s * q);
  });

  /* bump: luminance, contrast-stretched about its own mean */
  const bump = document.createElement('canvas');
  bump.width = atlas.width; bump.height = atlas.height;
  const bg = bump.getContext('2d');
  const ad = ag.getImageData(0, 0, atlas.width, atlas.height);
  const bd = bg.createImageData(atlas.width, atlas.height);
  let lsum = 0;
  const lum = new Float32Array(ad.data.length / 4);
  for (let i = 0, j = 0; i < ad.data.length; i += 4, j++) {
    lum[j] = 0.299 * ad.data[i] + 0.587 * ad.data[i + 1] + 0.114 * ad.data[i + 2];
    lsum += lum[j];
  }
  const lmean = lsum / lum.length;
  for (let j = 0, i = 0; j < lum.length; j++, i += 4) {
    const v = Math.max(0, Math.min(255, (lum[j] - lmean) * 1.5 + lmean));
    bd.data[i] = bd.data[i + 1] = bd.data[i + 2] = v; bd.data[i + 3] = 255;
  }
  bg.putImageData(bd, 0, 0);

  const map = new THREE.CanvasTexture(atlas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.NearestFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.anisotropy = 8;
  map.colorSpace = THREE.SRGBColorSpace;
  const bumpTex = new THREE.CanvasTexture(bump);
  bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
  bumpTex.magFilter = THREE.NearestFilter;
  bumpTex.minFilter = THREE.LinearMipmapLinearFilter;

  bakedTex[slot] = { map, bump: bumpTex, canvas: atlas, bumpCanvas: bump, mean, k };
  return bakedTex[slot];
}

function applyBakes() {
  const o = {};
  for (const [slot] of SLOTS) {
    const b = bakedTex[slot];
    if (b) o[slot] = { map: b.map, bump: b.bump, bumpScale: recipeFor(slot).bumpScale };
  }
  setTileOverride(Object.keys(o).length ? o : null);
  const mats = { floor: matFloor, wall: matWall, cap: matWallCap };
  for (const [slot, mat] of Object.entries(mats)) {
    const b = o[slot];
    if (!b) continue;
    mat.map = b.map; mat.bumpMap = b.bump; mat.bumpScale = b.bumpScale;
    if(mat.normalMap){ mat.normalMap = null; mat.needsUpdate = true; }
  }
}

async function rebakeAndApply(slot) {
  try {
    setStatus('baking ' + slot + '…');
    await bakeSlot(slot);
    applyBakes();
    renderPanel();
    setStatus(`${slot} baked`, 'ok');
  } catch (err) {
    setStatus(err.message, 'err');
  }
}

function tabTextures() {
  const g = group('Slot');
  const ctl = row(g, 'Editing');
  const sel = document.createElement('select');
  for (const [slot, label] of SLOTS) {
    const o = document.createElement('option');
    o.value = slot; o.textContent = label;
    sel.appendChild(o);
  }
  sel.value = activeSlot;
  sel.onchange = () => { activeSlot = sel.value; renderPanel(); };
  ctl.append(sel);

  const cfg = recipeFor(activeSlot);
  ensureFamilies();
  const famNames = Object.keys(families).sort();

  const src = group('Source tiles');
  if (!famNames.length) {
    hint(src, 'Loading tile families from the DCSS set…');
  } else {
    const fctl = row(src, 'Family');
    const fsel = document.createElement('select');
    const none = document.createElement('option');
    none.value = ''; none.textContent = '— none (keep current) —';
    fsel.appendChild(none);
    for (const f of famNames) {
      const o = document.createElement('option');
      o.value = f; o.textContent = `${f}  (${families[f].length})`;
      fsel.appendChild(o);
    }
    fsel.value = cfg.family;
    fsel.onchange = () => {
      cfg.family = fsel.value;
      cfg.variants = (families[cfg.family] || [0, 1, 2, 3]).slice(0, 4);
      rebakeAndApply(activeSlot);
    };
    fctl.append(fsel);

    const vctl = row(src, 'Variants');
    const vin = document.createElement('input');
    vin.type = 'text'; vin.value = cfg.variants.join(', ');
    vin.onchange = () => {
      const nums = vin.value.split(/[,\s]+/).map(Number).filter(n => Number.isFinite(n));
      if (nums.length === 4) { cfg.variants = nums; rebakeAndApply(activeSlot); }
      else setStatus('need exactly 4 variant numbers', 'err');
    };
    vctl.append(vin);
    hint(src, `Available: ${(families[cfg.family] || []).join(', ') || '—'}. Mixing families is ` +
              'fine — pick four numbers from one family, or hand-edit after switching.');
  }

  const bake = group('Bake');
  slider(bake, 'Saturation', { min: 0, max: 1, step: 0.05,
    get: () => cfg.sat, set: v => { cfg.sat = v; }, live: () => rebakeAndApply(activeSlot) });
  slider(bake, 'Target brightness', { min: 0.1, max: 0.9, step: 0.01,
    get: () => cfg.target, set: v => { cfg.target = v; }, live: () => rebakeAndApply(activeSlot) });
  select(bake, 'Curve', ['gamma', 'gain'], {
    get: () => cfg.curve, set: v => { cfg.curve = v; }, live: () => rebakeAndApply(activeSlot) });
  const nctl = row(bake, 'Neutralize hex');
  const nin = document.createElement('input');
  nin.type = 'text'; nin.className = 'hex'; nin.placeholder = '#3e5034';
  nin.value = cfg.neutralize || '';
  nin.onchange = () => { cfg.neutralize = nin.value.trim(); rebakeAndApply(activeSlot); };
  const nbtn = document.createElement('button');
  nbtn.textContent = 'tint×sun';
  nbtn.title = 'Fill with this theme\'s tint multiplied by its sun colour';
  nbtn.onclick = () => {
    const tint = activeSlot === 'floor' ? TH().floor : activeSlot === 'wall' ? TH().wall : TH().cap;
    const light = TH().dir[0];
    const mix = (a, b) => Math.round(((a >> b & 255) * ((light >> b & 255) / 255)));
    const v = (mix(tint, 16) << 16) | (mix(tint, 8) << 8) | mix(tint, 0);
    cfg.neutralize = hex2css(v); nin.value = cfg.neutralize;
    rebakeAndApply(activeSlot);
  };
  nctl.append(nin, nbtn);
  slider(bake, 'Neutralize amount', { min: 0, max: 1, step: 0.05,
    get: () => cfg.neutralizeAmt, set: v => { cfg.neutralizeAmt = v; }, live: () => rebakeAndApply(activeSlot) });
  hint(bake, 'Neutralize cancels a colour\'s hue so the surface reads as stone rather than as ' +
             'the tint. Point it at tint×sun, not the tint alone — the lighting is usually the ' +
             'bigger half.');

  const geo = group('Geometry');
  select(geo, 'Rotate', ['0', '90', '180', '270'], {
    get: () => String(cfg.rotate), set: v => { cfg.rotate = +v; }, live: () => rebakeAndApply(activeSlot) });
  select(geo, 'Stack', ['1', '2', '3'], {
    get: () => String(cfg.stack), set: v => { cfg.stack = +v; }, live: () => rebakeAndApply(activeSlot) });
  slider(geo, 'Bump scale', { min: 0, max: 1.5, step: 0.05,
    get: () => cfg.bumpScale, set: v => { cfg.bumpScale = v; },
    live: () => { applyBakes(); } });
  hint(geo, 'Walls want stack 2 (a wall box is ~2 units tall, 1 wide). Caps are flat slabs, so ' +
            'stack 1. Rotate 90 only for tiles taken from floor/ and used as a wall.');

  const out = group('Result');
  const b = bakedTex[activeSlot];
  if (b) {
    const prev = document.createElement('canvas');
    prev.className = 'swatch';
    prev.width = b.canvas.width; prev.height = b.canvas.height;
    prev.getContext('2d').drawImage(b.canvas, 0, 0);
    out.appendChild(prev);
    hint(out, `${b.canvas.width}×${b.canvas.height} · source mean ${b.mean.toFixed(3)} → ` +
              `${cfg.target.toFixed(2)} (${cfg.curve} ${b.k.toFixed(2)})`);
  } else {
    hint(out, 'Nothing baked for this slot yet — pick a family above.');
  }
  buttons(out, [
    { label: 'Re-bake', onClick: () => rebakeAndApply(activeSlot) },
    { label: 'Save PNG', primary: true, onClick: () => saveAtlas(activeSlot) },
    { label: 'Copy CLI', onClick: () => copyBakeCommand(activeSlot) }
  ]);
}

async function saveAtlas(slot) {
  const b = bakedTex[slot];
  if (!b) return setStatus('bake something first', 'err');
  const name = `${state.themeKey}_${slot}.png`;
  try {
    const r = await fetch('/api/save-tile-atlas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, dataUrl: b.canvas.toDataURL('image/png'),
                             bumpDataUrl: b.bumpCanvas.toDataURL('image/png') })
    });
    const j = await r.json();
    setStatus(j.success ? `saved public/${j.path}` : j.error, j.success ? 'ok' : 'err');
  } catch (err) { setStatus(err.message, 'err'); }
}

function copyBakeCommand(slot) {
  const c = recipeFor(slot);
  const [kind, fam] = [c.family.split('/')[0], c.family.split('/').slice(1).join('/')];
  const dir = 'Sprites/Dungeon Crawl Stone Soup Full/dungeon';
  const tiles = c.variants.map(v => `"${dir}/${kind}/${fam}_${v}.png"`).join(' ');
  const cmd = [
    'python tools/build_tile_atlas.py --tiles', tiles,
    `--sat ${c.sat}`, `--target ${c.target}`, `--curve ${c.curve}`,
    c.neutralize ? `--neutralize 0x${c.neutralize.replace('#', '')}` : '',
    c.neutralize && c.neutralizeAmt !== 1 ? `--neutralize-amt ${c.neutralizeAmt}` : '',
    c.rotate ? `--rotate ${c.rotate}` : '',
    c.stack > 1 ? `--stack ${c.stack}` : '',
    `--out public/art/tiles/${state.themeKey}_${slot}.png`
  ].filter(Boolean).join(' ');
  navigator.clipboard.writeText(cmd);
  setStatus('bake command copied', 'ok');
}

/* ---------------- Assets: import textures and models ---------------- */
const customProps = JSON.parse(JSON.stringify(SAVED_CUSTOM_PROPS || {}));
let modelList = [];

const readFileAsDataURL = file => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = () => reject(new Error('could not read ' + file.name));
  fr.readAsDataURL(file);
});

function filePicker(g, label, accept, multiple, onFiles) {
  const ctl = row(g, label);
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.multiple = !!multiple;
  input.style.cssText = 'flex:1;font-size:10.5px;color:var(--text-muted)';
  input.onchange = () => { if (input.files.length) onFiles([...input.files], input); };
  ctl.append(input);
  return input;
}

/** Where scatter density for a prop key lives: dungeons use propScatter,
 *  overland biomes use oc.ground. */
function scatterTable() {
  const th = TH();
  if (th.overland) { th.oc ||= {}; th.oc.ground ||= {}; return { table: th.oc.ground, path: 'oc.ground' }; }
  th.propScatter ||= {};
  return { table: th.propScatter, path: 'propScatter' };
}

async function importTiles(files) {
  const family = (files[0].name.replace(/\.[^.]+$/, '').replace(/[^\w-]/g, '_') || 'custom')
    .replace(/_\d+$/, '');
  try {
    let n = 0;
    for (const f of files.slice(0, 4)) {
      const dataUrl = await readFileAsDataURL(f);
      const r = await fetch('/api/upload-tile-source', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ family, index: n, dataUrl })
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error);
      n++;
    }
    /* one file is fine — it just repeats across all four atlas quadrants */
    const variants = Array.from({ length: 4 }, (_, i) => Math.min(i, n - 1));
    families[`custom/${family}`] = Array.from({ length: n }, (_, i) => i);
    const cfg = recipeFor(activeSlot);
    cfg.family = `custom/${family}`;
    cfg.variants = variants;
    await rebakeAndApply(activeSlot);
    setStatus(`imported ${n} tile${n > 1 ? 's' : ''} as custom/${family}`, 'ok');
  } catch (err) { setStatus(err.message, 'err'); }
}

async function importAtlas(file, slot) {
  try {
    const dataUrl = await readFileAsDataURL(file);
    const img = await loadImage(dataUrl);
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const map = new THREE.CanvasTexture(c);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.anisotropy = 8;
    map.colorSpace = THREE.SRGBColorSpace;
    bakedTex[slot] = { map, bump: map, canvas: c, bumpCanvas: c, mean: 0, k: 1 };
    applyBakes();
    setStatus(`${file.name} applied to ${slot} (${img.width}×${img.height}) — Save PNG to keep it`, 'ok');
    renderPanel();
  } catch (err) { setStatus(err.message, 'err'); }
}

async function importModel(file) {
  const name = file.name.replace(/[^\w.-]/g, '_');
  const key = name.replace(/\.(glb|gltf)$/i, '').replace(/[^\w-]/g, '_');
  try {
    setStatus('uploading ' + name + '…');
    const dataUrl = await readFileAsDataURL(file);
    const r = await fetch('/api/upload-model', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, dataUrl })
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    await attachModel(key, j.url, 1);
    setStatus(`${key} imported and scattered — tune its density below`, 'ok');
  } catch (err) { setStatus(err.message, 'err'); }
}

/** Register a model, remember it, and give it a starting scatter density in
 *  the current theme so it shows up on the next forge. */
async function attachModel(key, url, scale) {
  await registerProp(key, url, scale);
  customProps[key] = { url, scale };
  const { table, path: p } = scatterTable();
  if (table[key] == null) {
    table[key] = TH().overland ? 0.02 : 0.002;
    recordPatch(`${p}.${key}`, table[key]);
  }
  renderPanel();
  forge();
}

function tabAssets() {
  const t = group('Import textures');
  filePicker(t, 'Source tiles', 'image/png', true, files => importTiles(files));
  hint(t, 'One to four PNGs — they become a custom family in the Textures picker and go ' +
          'through the same bake, so a hand-drawn tile gets the same normalise/neutralize ' +
          'treatment as the DCSS set. Fewer than four repeat across the atlas.');
  const slotCtl = row(t, 'Apply atlas to');
  const slotSel = document.createElement('select');
  for (const [slot, label] of SLOTS) {
    const o = document.createElement('option');
    o.value = slot; o.textContent = label;
    slotSel.appendChild(o);
  }
  slotSel.value = activeSlot;
  slotSel.onchange = () => { activeSlot = slotSel.value; };
  slotCtl.append(slotSel);
  filePicker(t, 'Finished atlas', 'image/png', false, files => importAtlas(files[0], activeSlot));
  hint(t, 'Skips the bake entirely: a 2×2 atlas you made elsewhere, applied as-is. ' +
          'Wall atlases should be twice as tall as they are wide (the stack-2 layout).');

  const m = group('Import 3D scatter');
  filePicker(m, 'Model (.glb)', '.glb,.gltf,model/gltf-binary', false, files => importModel(files[0]));
  hint(m, 'Saved to public/3d/Custom and registered as a scatter prop. Models are placed ' +
          'sitting on the floor using their own bounding box, rotated in 90° steps.');

  const existing = group('Attach an existing model');
  if (!modelList.length) {
    hint(existing, 'Loading model list…');
    fetch('/api/list-models').then(r => r.json()).then(j => {
      if (j.success) { modelList = j.models; if (state.tab === 'assets') renderPanel(); }
    }).catch(() => {});
  } else {
    const ctl = row(existing, 'Model');
    const sel = document.createElement('select');
    const none = document.createElement('option');
    none.value = ''; none.textContent = `— ${modelList.length} on disk —`;
    sel.appendChild(none);
    for (const mdl of modelList) {
      const o = document.createElement('option');
      o.value = mdl; o.textContent = mdl;
      sel.appendChild(o);
    }
    sel.onchange = () => {
      if (!sel.value) return;
      const key = sel.value.split('/').pop().replace(/\.(glb|gltf)$/i, '').replace(/[^\w-]/g, '_');
      attachModel(key, `/3d/${sel.value}`, 1);
      setStatus(`${key} attached to ${state.themeKey}`, 'ok');
    };
    ctl.append(sel);
    hint(existing, 'Any GLB already in public/3d — including the shipped biome props — can be ' +
                   'scattered in a theme that does not normally use it.');
  }

  const s = group('Scatter in this theme');
  const { table, path: tPath } = scatterTable();
  const keys = Object.keys(table);
  if (!keys.length) hint(s, 'Nothing scattered yet — import a model or attach one above.');
  for (const key of keys) {
    const isCustom = !!customProps[key];
    slider(s, key + (isCustom ? ' ·' : ''), {
      min: 0, max: TH().overland ? 0.2 : 0.02, step: TH().overland ? 0.002 : 0.0005,
      fmt: v => v.toFixed(4),
      get: () => table[key],
      set: v => { table[key] = v; recordPatch(`${tPath}.${key}`, v); }
    });
  }
  hint(s, 'Chance per eligible tile. A dot marks an imported model. ' +
          `Registered prop keys: ${registeredProps().length}.`);

  const custom = group('Imported models');
  const ckeys = Object.keys(customProps);
  if (!ckeys.length) hint(custom, 'No imported models yet.');
  for (const key of ckeys) {
    slider(custom, key + ' scale', {
      min: 0.2, max: 3, step: 0.05,
      get: () => customProps[key].scale ?? 1,
      set: v => { customProps[key].scale = v; },
      live: () => { registerProp(key, customProps[key].url, customProps[key].scale).then(forge); }
    });
  }
  if (ckeys.length) {
    buttons(custom, [{ label: 'Save model registry', primary: true, onClick: saveCustomProps }]);
    hint(custom, 'Writes src/game/custom_props.json so imported models load in the game too, ' +
                 'not just in this editor.');
  }
}

async function saveCustomProps() {
  try {
    const r = await fetch('/api/save-custom-props', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(customProps)
    });
    const j = await r.json();
    setStatus(j.success ? 'saved custom_props.json' : j.error, j.success ? 'ok' : 'err');
  } catch (err) { setStatus(err.message, 'err'); }
}

/* ---------------- save / export ---------------- */
function currentPatchJson() {
  /* drop empty theme entries so the file stays a minimal diff */
  const out = {};
  for (const [k, v] of Object.entries(patches)) {
    if (v && Object.keys(v).length) out[k] = v;
  }
  return out;
}

el('save').onclick = async () => {
  try {
    const r = await fetch('/api/save-theme-overrides', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentPatchJson())
    });
    const j = await r.json();
    setStatus(j.success ? 'saved theme_overrides.json' : j.error, j.success ? 'ok' : 'err');
  } catch (err) { setStatus(err.message, 'err'); }
};

el('copy').onclick = () => {
  navigator.clipboard.writeText(JSON.stringify(currentPatchJson(), null, 2));
  setStatus('overrides JSON copied', 'ok');
};

el('revert').onclick = () => {
  delete patches[state.themeKey];
  setStatus('reload the page to drop in-memory edits for this theme', 'err');
};

el('collapse').onclick = () => {
  const p = el('panel');
  p.classList.toggle('collapsed');
  el('collapse').textContent = p.classList.contains('collapsed') ? '‹' : '›';
};

/* ---------------- render loop ----------------
   The scene module's tick() drives game.update() before it renders, and this
   page never calls game.init() — so it would throw every frame and nothing
   would ever draw. The editor only needs the visual half: advance the shader
   clock for torch flicker and particles, then render. */
let loopT = 0, loopLast = performance.now();
function editorLoop() {
  requestAnimationFrame(editorLoop);
  if (!renderer) return;
  const now = performance.now();
  const dt = Math.min((now - loopLast) / 1000, 0.05);
  loopT += dt;
  loopLast = now;
  liveUpdate(loopT, Infinity);
  tickAmbientCritters(dt, cam);
  updateLivePixelFx(dt);
  tickLightDebug(dt);
  renderFrame();
}

/* Handle for debugging and scripted checks — mirrors window.__game in the
   main app, since a dynamic re-import gets a different module instance. */
if (typeof window !== 'undefined') {
  /* `lights` is re-assigned by buildScene, so expose it as a getter — a captured
     reference would go stale on the first re-forge. */
  window.__editor = { state, patches, customProps, forge, placeCritters, THEMES,
                      get lights(){ return lights; },
                      lastDungeon: () => lastD, bakedTex, recipeFor };
}

/* ---------------- boot ---------------- */
window.addEventListener('resize', () => {
  if (!renderer) return;
  renderer.setSize(innerWidth, innerHeight);
  const aspect = innerWidth / innerHeight;
  cam.left = -55 * aspect; cam.right = 55 * aspect;
  cam.top = 55; cam.bottom = -55;
  cam.updateProjectionMatrix();
});

(async function boot() {
  loadRecipesForTheme();
  renderTabs();
  renderPanel();
  camTarget.set(0, 0, 0);
  forge();
  editorLoop();
  ensureFamilies();
})();
