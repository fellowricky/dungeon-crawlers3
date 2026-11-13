/* ── sprite lighting ────────────────────────────────────────────────────
   Heroes and monsters are THREE.Sprite billboards, and SpriteMaterial is
   unlit: a body in a black corner draws exactly as bright as its PNG while
   the floor around it falls into shadow. This pass works out, once a frame
   per unit, how much light reaches the screen-left and screen-right of the
   body, and hands both to the sprite shader (configureSpriteMaterial's
   sprLit uniforms), which blends between them across the body.

   The light is evaluated the way three's lit floor evaluates it (same
   hemisphere mix, same point-light falloff, same /π Lambert term), so a torch
   that brightens the flagstones brightens whoever stands on them by the same
   proportion. The sun has no shadow map on the CPU; a short march through
   the wall grid stands in for it.

   The result multiplies the sprite's colour exactly as the same light
   multiplies the floor texture's (ref 1.0): the PNG is treated as the body's
   albedo. An earlier version measured each map against its own sun, so
   moonlight read as "full light" and a night party glowed on black ground.
   Now a bright overland day caps out at the PNG as drawn, while a dim biome,
   a corridor in shadow or a night dims the sprites by the same proportion it
   dims the ground. Two clamps keep it a
   game rather than a light meter: a floor so a unit in a black corner is
   still a readable silhouette (itself scaled down on dark maps, or it would
   undo the darkness), and a cap so a torch can't blow the pixel art out.

   Each unit also gets a soft contact shadow on the ground, created here the
   first time the unit is seen.

   Ground fog: the mist sheets and the rolling fog plane are flat layers on
   the floor, and a flat layer can't wrap a standing card — drawn before the
   sprite it sits under the whole body, drawn after it paints over the head
   too. So each unit carries the fog itself: the amount and colour of mist at
   its feet (sampled here with the same falloff and noise the fog shaders
   use) is handed to the sprite shader, which fades the body into it from the
   feet up over `fogTop`. */
import * as THREE from 'three';
import { SIM } from '../game/sim_flags.js';
import { scene, cam, hemi, dirL, sunOffset, D, fx, steadyLightSources } from './dungeon_scene.js';
import { fogPlaneMat, fogClearance, setPropCueState } from './dungeon_materials.js';
import { WALL, FLOOR, POOL } from '../dungeon/dungeon_generator.js';
import { STEP as ELEV_STEP, groundY } from '../dungeon/elevation.js';
import { classifyLight, LIGHT_LEVELS, LIGHT_LEVEL_DEFAULTS, setLightProbe, VIRTUAL_LIGHTS, DARK_ZONES, inDarkZone, zonePos, clearLightRegistry } from '../game/light_sources.js';
import { monsterGlow } from '../game/monster_light.js';
import { hasEffect } from '../game/conditions.js';

/* Live-tunable from the console as window.__spriteLight. */
export const SPRITE_LIGHT = {
  exposure: 1.0,     // overall multiplier on the relative light
  ref: 1.0,          // light level that shows a sprite at its PNG brightness (1 = matches the floor)
  floor: 0.25,       // readability lift in the dark (luminance), at full scene light
  floorMin: 0.3,     // ...and the share of it kept on the darkest maps
  cap: 1.05,         // brightest (luminance)
  sat: 0.65,         // 0 = brightness only, 1 = full light colour
  wrap: 0.35,        // light wrapping round the body; 0 = hard Lambert
  side: 0.9,         // how far the left/right normals turn away from the camera
  rate: 12,          // smoothing toward the target, per second
  shadow: 0.55,      // contact shadow opacity; 0 hides them
  shadowSize: 0.5,   // contact shadow diameter, as a fraction of frame width
  fogGain: 1.0,      // legs take the fog at the strength the floor shows there...
  mistGain: 2.5,     // ...except the wispy room mist sheets, which are faint (max ~0.1 drawn)
  fogFloor: 0.02,    // below this, no fog on the legs at all (thin and clear patches stay clean)
  fogMax: 0.8,       // never fog a body out completely
  fogTop: 0.5,       // world height over which the fog fades out up the body
  enabled: true
};
if (typeof window !== 'undefined') window.__spriteLight = SPRITE_LIGHT;

const INV_PI = 1 / Math.PI;
const WALL_TOP = 2.0;          // dungeon walls stand ~2.0 (dungeon_scene wall loop)
const OVERLAND_TOP = 2.2;      // treelines / blockers on overland maps

const _right = new THREE.Vector3(), _toCam = new THREE.Vector3();
const _nF = new THREE.Vector3(), _nL = new THREE.Vector3(), _nR = new THREE.Vector3();
const _sun = new THREE.Vector3(), _hemiDir = new THREE.Vector3();
const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _lp = new THREE.Vector3();
const _ref = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();

/* Point lights come and go only through fixed pools (see entities.js), so the
   list is rebuilt on a slow timer rather than walking the scene every frame. */
let _lights = [];
let _lightsAge = Infinity;
function refreshLights(dt) {
  _lightsAge += dt;
  if (_lightsAge < 0.5 && _lights.length) return;
  _lightsAge = 0;
  _lights = [];
  scene.traverse(o => { if (o.isPointLight) _lights.push(o); });
}

function isVisibleInScene(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/* Hemisphere + sun on a surface with normal n, unshadowed sun scaled by sunVis.
   `skyK` scales the hemisphere part (the light rules pass LIGHT_LEVELS.skyWeight). */
function ambientAndSun(n, sunVis, out, skyK = 1, dirScale = 1, hemiScale = 1) {
  const w = 0.5 * n.dot(_hemiDir) + 0.5;
  const hi = hemi.intensity * hemiScale * INV_PI * skyK;
  out.set(
    (hemi.groundColor.r + (hemi.color.r - hemi.groundColor.r) * w) * hi,
    (hemi.groundColor.g + (hemi.color.g - hemi.groundColor.g) * w) * hi,
    (hemi.groundColor.b + (hemi.color.b - hemi.groundColor.b) * w) * hi
  );
  if (sunVis > 0 && dirL.intensity > 0) {
    const ndl = Math.max(0, n.dot(_sun));
    const k = dirL.intensity * dirScale * INV_PI * ndl * sunVis;
    out.x += dirL.color.r * k; out.y += dirL.color.g * k; out.z += dirL.color.b * k;
  }
  return out;
}

function litLum(v) {
  return 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
}

/* Room light is taken on the floor's up normal and on the body's side
   normal. Keep the brighter one: a low sun still lights the side it hits,
   and an overhead sun (ancient is tuned to 85°) no longer misses the body
   and turns it black on stone the floor still calls lit. */
function keepBrighter(into, other) {
  if (litLum(other) > litLum(into)) into.copy(other);
}

/* Every live point light at P on normal n, added into out. */
function addPointLights(P, n, out, wrap = SPRITE_LIGHT.wrap) {
  for (const L of _lights) {
    if (!(L.intensity > 0) || !isVisibleInScene(L)) continue;
    L.getWorldPosition(_lp);
    const dx = _lp.x - P.x, dy = _lp.y - P.y, dz = _lp.z - P.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (L.distance > 0 && d >= L.distance) continue;
    /* three's getDistanceAttenuation */
    let att = 1 / Math.max(Math.pow(d, L.decay), 0.01);
    if (L.distance > 0) {
      const r = d / L.distance, w = Math.min(1, Math.max(0, 1 - r * r * r * r));
      att *= w * w;
    }
    const inv = d > 1e-4 ? 1 / d : 0;
    const ndl = Math.max(0, ((dx * n.x + dy * n.y + dz * n.z) * inv + wrap) / (1 + wrap));
    const k = L.intensity * att * ndl * INV_PI;
    out.x += L.color.r * k; out.y += L.color.g * k; out.z += L.color.b * k;
  }
  return out;
}

/* Is the sun visible from P? Marches toward the sun through the wall grid;
   a wall (or a higher terrain tier) taller than the ray where it crosses
   puts P in shadow — the same shadow the floor shows, near enough. */
function sunVisibility(P) {
  const d = D;
  if (!d || !d.grid || !(dirL.intensity > 0)) return 1;
  const hLen = Math.hypot(_sun.x, _sun.z);
  if (hLen < 1e-4) return 1;
  const hx = _sun.x / hLen, hz = _sun.z / hLen, slope = _sun.y / hLen;
  if (slope <= 0) return 0;
  const { W, H, grid } = d, height = d.height;
  const top = d.overland || (d.effectiveTheme && d.effectiveTheme.overland) ? OVERLAND_TOP : WALL_TOP;
  const maxT = Math.min(12, (top + 3 * ELEV_STEP - P.y) / slope + 0.5);
  for (let t = 0.3; t <= maxT; t += 0.25) {
    const x = P.x + hx * t, z = P.z + hz * t, y = P.y + slope * t;
    const gx = Math.round(x + W / 2 - 0.5), gz = Math.round(z + H / 2 - 0.5);
    if (gx < 0 || gz < 0 || gx >= W || gz >= H) return 1;
    const c = gz * W + gx;
    const base = height ? height[c] * ELEV_STEP : 0;
    if (grid[c] === WALL) { if (y < top + base) return 0; }
    else if (base > y) return 0;
  }
  return 1;
}

/* Light against the fixed reference, then desaturated, floored, capped. */
let _floor = 0.25;
function finish(v) {
  const S = SPRITE_LIGHT;
  v.multiplyScalar(S.exposure / S.ref);
  let lum = 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
  v.set(lum + (v.x - lum) * S.sat, lum + (v.y - lum) * S.sat, lum + (v.z - lum) * S.sat);
  /* A soft floor: a neutral lift that fades out as the real light rises, so
     a torch in a dark corridor still shows on top of it instead of being
     swallowed by a hard minimum. */
  const lift = _floor * (1 - Math.min(lum, 1));
  v.addScalar(lift); lum += lift;
  if (lum > S.cap) v.multiplyScalar(S.cap / lum);
  /* and per channel, or a strong orange lantern runs the reds off the top
     while the luminance still looks in range */
  const top = S.cap * 1.2;
  v.set(Math.min(v.x, top), Math.min(v.y, top), Math.min(v.z, top));
  return v;
}

/* ── contact shadows ── */
let _blobTex = null, _blobGeo = null;
function blobAssets() {
  if (_blobTex) return;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.45, 'rgba(0,0,0,0.75)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  _blobTex = new THREE.CanvasTexture(cv);
  _blobGeo = new THREE.PlaneGeometry(1, 1);
  _blobGeo.rotateX(-Math.PI / 2);
}

function contactShadowFor(v) {
  if (v._contactShadow) return v._contactShadow;
  if (typeof document === 'undefined') return null;
  blobAssets();
  const m = new THREE.Mesh(_blobGeo, new THREE.MeshBasicMaterial({
    map: _blobTex, color: 0x000000, transparent: true, depthWrite: false,
    opacity: 0, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4
  }));
  m.renderOrder = 2;          // after the floor, before the sprites (10)
  m.position.y = 0.02;
  m.raycast = () => { };       // never pickable
  v.grp.add(m);
  v._contactShadow = m;
  return m;
}

function updateContactShadow(v, mesh, state) {
  const sh = contactShadowFor(v);
  if (!sh) return;
  if (sh.parent !== v.grp) v.grp.add(sh);
  const mat = mesh.material;
  /* F4 debug: the shadow becomes a bright ring in the unit's light-state colour */
  const dbg = _dbg.on && state;
  const op = (dbg ? 0.9 : SPRITE_LIGHT.shadow) * (mesh.visible ? 1 : 0) * (mat.opacity ?? 1);
  sh.visible = op > 0.001;
  sh.material.opacity = op;
  sh.material.color.setHex(dbg ? LIGHT_DEBUG_COLORS[state] : 0x000000);
  const s = Math.abs(mesh.scale.x) * SPRITE_LIGHT.shadowSize * (dbg ? 1.3 : 1);
  sh.scale.set(s, 1, s * 0.8);
}

/* ── light status (bright / dim / dark) ──
   The light on the GROUND at a spot, measured as the floor is lit (normal up,
   plain Lambert, sun through the wall march), against the sprite reference.
   One function for the creature status and the F4 debug overlay, so the
   tiles and the creatures can never disagree. Thresholds and the hysteresis
   live in game/light_sources.js (LIGHT_LEVELS).

   It reads STEADY light, not what the GPU is drawing this frame:
   - every wall torch, candle and brazier on the level, at its flicker-
     averaged strength (dungeon_scene steadyLightSources) — not the handful of
     pooled real lights the camera happens to be near;
   - any light that publishes `userData.steady` (key lights, campfires),
     again without the flicker;
   - carried lights (the party's torch / lantern / Light) by their RADII, as
     5e does: within `bright` tiles the spot is at least bright, within `dim`
     at least dim (game/light_sources.js). Their PointLight only has to look
     the part.
   Pooled torch lights are skipped (the source list already covers them) and
   so are spell flashes, which would otherwise flash a tile bright. So a tile's
   state changes when something real changes — a hero walks up with a torch,
   a fire is put out — and never with a guttering flame or a camera move.

   The hemisphere "sky fill" counts at LIGHT_LEVELS.skyWeight (0 by default):
   it is the scene's visual brightness knob, so a dungeon can be lifted for
   the eye without lighting it for the rules. */
const _up = new THREE.Vector3(0, 1, 0), _gp = new THREE.Vector3(), _gl = new THREE.Vector3();

function pointLum(P, lx, ly, lz, lumI, distance, decay) {
  const dx = lx - P.x, dy = ly - P.y, dz = lz - P.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance > 0 && d >= distance) return 0;
  let att = 1 / Math.max(Math.pow(d, decay), 0.01);
  if (distance > 0) {
    const r = d / distance, w = Math.min(1, Math.max(0, 1 - r * r * r * r));
    att *= w * w;
  }
  const ndl = d > 1e-4 ? Math.max(0, dy / d) : 1;     // normal straight up
  return lumI * att * ndl * INV_PI;
}

/* The level's own fires (wall torches, candles, braziers) — static per level. */
function emitterLum(P) {
  let e = 0;
  for (const s of steadyLightSources()) e += pointLum(P, s.x, s.y, s.z, s.lum * s.intensity, s.distance, s.decay);
  return e;
}

/* Lights that publish a steady strength but can change mid-level: key lights,
   campfires (ramped, doused). Carried lights are not here — they go by radii. */
function keyLightsLum(P) {
  let e = 0;
  for (const L of _lights) {
    const st = L.userData && L.userData.steady;
    if (!(st > 0) || (L.userData && L.userData.radii) || !isVisibleInScene(L)) continue;
    L.getWorldPosition(_lp);
    const lum = 0.2126 * L.color.r + 0.7152 * L.color.g + 0.0722 * L.color.b;
    e += pointLum(P, _lp.x, _lp.y, _lp.z, lum * st, L.distance, L.decay);
  }
  return e;
}

function rulesWeatherScales() {
  const eff = D && D.effectiveTheme;
  const ds = eff && eff.weatherDirScale > 0 ? 1 / eff.weatherDirScale : 1;
  const hs = eff && eff.weatherHemiScale > 0 ? 1 / eff.weatherHemiScale : 1;
  return [ds, hs];
}

/* Sun (+ sky at skyWeight) and the level's fires: everything that only
   changes when the level or the lighting settings do. Leaves _gp at the point.
   Overland weather dims the visual scene lights on top of the time-of-day
   theme, while lightLevels are tuned per time of day, so the rules light map
   divides out the weather attenuation factor. */
function staticLevelAt(x, y, z) {
  _gp.set(x, y + 0.1, z);
  const [ds, hs] = rulesWeatherScales();
  ambientAndSun(_up, sunVisibility(_gp), _gl, LIGHT_LEVELS.skyWeight ?? 0, ds, hs);
  const amb = 0.2126 * _gl.x + 0.7152 * _gl.y + 0.0722 * _gl.z;
  return (amb + emitterLum(_gp)) / SPRITE_LIGHT.ref;
}

/* Glowing creatures this frame ({x, z, bright, dim, color, unit}), from
   monster_light.js; rebuilt by updateSpriteLighting. */
let _unitGlows = [];

/* Carried lights, virtual lights and glowing creatures: within `bright` tiles
   at least bright, within `dim` at least dim. Magical Darkness beats them all. */
function applyRadii(v, x, z) {
  if (DARK_ZONES.size && inDarkZone(x, z)) return 0;
  const EPS = 1e-4;
  const step = (px, pz, R) => {
    const r = Math.hypot(px - x, pz - z);
    if (r <= (R.bright || 0)) v = Math.max(v, LIGHT_LEVELS.bright + EPS);
    else if (r <= (R.dim || 0)) v = Math.max(v, LIGHT_LEVELS.dim + EPS);
  };
  for (const L of VIRTUAL_LIGHTS) { const p = zonePos(L); step(p.x, p.z, L); }
  for (const g of _unitGlows) step(g.x, g.z, g);
  for (const L of _lights) {
    const R = L.userData && L.userData.radii;
    if (!R || !(L.intensity > 0) || !isVisibleInScene(L)) continue;
    L.getWorldPosition(_lp);
    const r = Math.hypot(_lp.x - x, _lp.z - z);
    if (r <= R.bright) v = Math.max(v, LIGHT_LEVELS.bright + EPS);
    else if (r <= R.dim) v = Math.max(v, LIGHT_LEVELS.dim + EPS);
  }
  return v;
}

export function lightLevelAt(x, y, z) {
  if (DARK_ZONES.size && inDarkZone(x, z)) return 0;
  const v = staticLevelAt(x, y, z) + keyLightsLum(_gp) / SPRITE_LIGHT.ref;
  return applyRadii(v, x, z);
}
/* lightLevelAt for a creature, for balance runs (SIM.fast), where this is the
   hot path: every creature on the floor, every step. The sun-and-fires part
   depends only on where the creature stands and on the level's lighting, so it
   is kept per creature and recomputed when either changes — the same split,
   and the same staleness test, the level light map below uses. Carried lights
   and key lights are still read fresh, so the value is identical. */
let _fastSig = '', _fastSrc = null;
function creatureLightLevel(u, x, y, z) {
  if (DARK_ZONES.size && inDarkZone(x, z)) return 0;
  const c = u._lightStatic || (u._lightStatic = {});
  if (c.x !== x || c.y !== y || c.z !== z || c.sig !== _fastSig || c.src !== _fastSrc || c.D !== D) {
    c.stat = staticLevelAt(x, y, z);
    c.x = x; c.y = y; c.z = z; c.sig = _fastSig; c.src = _fastSrc; c.D = D;
  }
  _gp.set(x, y + 0.1, z);
  let key = 0;
  for (const k of _fastKey) key += pointLum(_gp, k.x, k.y, k.z, k.lum, k.distance, k.decay);
  let v = c.stat + key / SPRITE_LIGHT.ref;
  const EPS = 1e-4;
  for (const R of _fastRadii) {
    const r = Math.hypot(R.x - x, R.z - z);
    if (r <= R.bright) v = Math.max(v, LIGHT_LEVELS.bright + EPS);
    else if (r <= R.dim) v = Math.max(v, LIGHT_LEVELS.dim + EPS);
  }
  return v;
}
/* Where every light is this step, read once instead of once per creature: the
   same lights, in the same order, that keyLightsLum and applyRadii walk. */
let _fastKey = [], _fastRadii = [];
function snapshotLights() {
  _fastKey = []; _fastRadii = [];
  for (const L of VIRTUAL_LIGHTS) { const p = zonePos(L); _fastRadii.push({ x: p.x, z: p.z, bright: L.bright || 0, dim: L.dim || 0 }); }
  for (const g of _unitGlows) _fastRadii.push({ x: g.x, z: g.z, bright: g.bright || 0, dim: g.dim || 0 });
  for (const L of _lights) {
    const ud = L.userData, R = ud && ud.radii, st = ud && ud.steady;
    if (!R && !(st > 0)) continue;
    if (R && !(L.intensity > 0)) continue;
    if (!isVisibleInScene(L)) continue;
    L.getWorldPosition(_lp);
    if (R) _fastRadii.push({ x: _lp.x, z: _lp.z, bright: R.bright, dim: R.dim });
    else _fastKey.push({ x: _lp.x, y: _lp.y, z: _lp.z, lum: (0.2126 * L.color.r + 0.7152 * L.color.g + 0.0722 * L.color.b) * st, distance: L.distance, decay: L.decay });
  }
}
/* game rules ask tiles through light_sources.lightStateAt */
setLightProbe((x, z) => (D ? classifyLight(lightLevelAt(x, groundY(D, x, z), z)) : 'bright'));

/* ── the level light map ──
   lightLevelAt at every walkable tile centre, shared by the darkness cue and
   the F4 overlay so the two can never disagree. The static part (sun, sky
   at skyWeight, the level's fires) is cached and rebuilt only when the level
   or the lighting settings change; key lights and carried lights are layered
   on top a few times a second. */
const _lm = { D: null, cells: null, stat: null, level: null, sig: '', src: null, t: 0 };

function ensureLightMap() {
  if (_lm.D === D && _lm.cells) return !!_lm.cells.length;
  _lm.D = D; _lm.sig = ''; _lm.src = null; _lm.t = 0;
  clearLightRegistry();          // spells, thrown torches, oil: they end with the floor
  _lm.cells = [];
  if (!D || !D.grid) return false;
  const { W, H, grid } = D;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const g = grid[y * W + x];
    if (g !== FLOOR && g !== POOL) continue;
    const cx = x - W / 2 + 0.5, cz = y - H / 2 + 0.5;
    _lm.cells.push({ x: cx, z: cz, y: groundY(D, cx, cz), gx: x, gy: y, floor: g === FLOOR, state: null });
  }
  _lm.stat = new Float32Array(_lm.cells.length);
  _lm.level = new Float32Array(_lm.cells.length);
  return !!_lm.cells.length;
}

function staticSig() {
  const sw = LIGHT_LEVELS.skyWeight ?? 0;
  const [ds, hs] = rulesWeatherScales();
  return [(dirL.intensity * ds).toFixed(4), dirL.color.getHex(), _sun.x.toFixed(3), _sun.y.toFixed(3), _sun.z.toFixed(3),
    sw, sw > 0 ? (hemi.intensity * hs).toFixed(4) + hemi.color.getHex() + ':' + hemi.groundColor.getHex() : '',
  SPRITE_LIGHT.ref].join('|');
}

/* Recompute the map (throttled unless `force`). Returns true when it changed. */
function refreshLightMap(dt, force = false) {
  if (!ensureLightMap()) return false;
  _lm.t -= dt;
  if (!force && _lm.t > 0) return false;
  _lm.t = 0.2;
  const cells = _lm.cells, stat = _lm.stat, level = _lm.level;
  const sig = staticSig(), src = steadyLightSources();
  if (sig !== _lm.sig || src !== _lm.src) {
    for (let i = 0; i < cells.length; i++) stat[i] = staticLevelAt(cells[i].x, cells[i].y, cells[i].z);
    _lm.sig = sig; _lm.src = src;
  }
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    _gp.set(c.x, c.y + 0.1, c.z);
    level[i] = (DARK_ZONES.size && inDarkZone(c.x, c.z)) ? 0
      : applyRadii(stat[i] + keyLightsLum(_gp) / SPRITE_LIGHT.ref, c.x, c.z);
  }
  return true;
}

/* ── darkness cue ──
   The rules ignore the sky fill, but the picture keeps it, so dim and dark
   can look almost alike. The cue lets the light map gently shape the floor:
   a multiply tint, nothing at all in bright light, a faint cool shade in dim,
   a darker cool blue-grey in the dark (the "can't see colour" look). Warm
   against cold reads at a glance where brown against darker brown does not.
   Bilinear across tiles, so it falls off like light, never as squares.
   Floor only; walls and props keep their look. Tunable live
   (window.__spriteLight is the sprite side; this is window.__darkCue). */
export const DARK_CUE = {
  enabled: true,
  strength: 0.8,                  // 0 = off, 1 = full tints
  dim: [0.86, 0.88, 0.94],       // linear multiply at full strength
  dark: [0.52, 0.58, 0.80]
};
if (typeof window !== 'undefined') window.__darkCue = DARK_CUE;
export const DARK_CUE_DEFAULT = DARK_CUE.strength;

/** Load a theme's light cut-offs and darkness shading into the live rules:
 *  `TH.lightLevels = { bright, dim, skyWeight, darkCue }`, each falling back to
 *  the default. Called by buildScene with the effective theme, so an overland
 *  map gets the values of its own time of day. */
export function applyThemeLightLevels(TH) {
  const t = (TH && TH.lightLevels) || {};
  for (const k of Object.keys(LIGHT_LEVEL_DEFAULTS)) LIGHT_LEVELS[k] = t[k] ?? LIGHT_LEVEL_DEFAULTS[k];
  DARK_CUE.strength = t.darkCue ?? DARK_CUE_DEFAULT;
}

const _cue = { D: null, mesh: null, tex: null, data: null };

/* Light level -> cue amount: 0 bright; 0.25-0.5 across dim; 0.7-1 in the dark.
   The small steps at each threshold are what make the boundary readable. */
function cueAmount(v) {
  const B = LIGHT_LEVELS.bright, Dm = LIGHT_LEVELS.dim;
  const EPS = 1e-4;
  if (v >= B - EPS) return 0;
  if (v >= Dm - EPS) return 0.25 + 0.25 * (B - v) / Math.max(1e-4, B - Dm);
  return 0.7 + 0.3 * (1 - Math.max(0, v) / Math.max(1e-4, Dm));
}

function buildCue() {
  if (_cue.mesh) {
    scene.remove(_cue.mesh); _cue.mesh.geometry.dispose(); _cue.mesh.material.dispose();
    if (_cue.tex) _cue.tex.dispose();
    _cue.mesh = null; _cue.tex = null;
  }
  _cue.D = D;
  if (!ensureLightMap()) return;
  const { W, H } = D;
  const floors = _lm.cells.filter(c => c.floor);
  const pos = new Float32Array(floors.length * 12), ind = new Uint32Array(floors.length * 6);
  const e = 0.505, inset = 0.45;
  floors.forEach((c, k) => {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    corners.forEach(([sx, sz], j) => {
      const o = k * 12 + j * 3;
      pos[o] = c.x + sx * e;
      pos[o + 1] = groundY(D, c.x + sx * inset, c.z + sz * inset) + 0.012;
      pos[o + 2] = c.z + sz * e;
    });
    const b = k * 4, o = k * 6;
    ind[o] = b; ind[o + 1] = b + 2; ind[o + 2] = b + 1;
    ind[o + 3] = b; ind[o + 4] = b + 3; ind[o + 5] = b + 2;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(ind, 1));

  _cue.data = new Uint8Array(W * H * 4);
  const tex = new THREE.DataTexture(_cue.data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  _cue.tex = tex;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tCue: { value: tex },
      uSize: { value: new THREE.Vector2(W, H) },
      uDim: { value: new THREE.Vector3() },
      uDark: { value: new THREE.Vector3() },
      uStrength: { value: 0 }
    },
    vertexShader: `
      varying vec2 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform sampler2D tCue;
      uniform vec2 uSize;
      uniform vec3 uDim, uDark;
      uniform float uStrength;
      varying vec2 vW;
      void main() {
        float a = texture2D(tCue, (vW + uSize * 0.5) / uSize).r;
        vec3 t = a < 0.5 ? mix(vec3(1.0), uDim, a / 0.5) : mix(uDim, uDark, (a - 0.5) / 0.5);
        gl_FragColor = vec4(mix(vec3(1.0), t, uStrength), 1.0);
      }`,
    transparent: true, depthWrite: false, fog: false,
    /* multiply what is already drawn: dst * src */
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2
  });
  mat.toneMapped = false;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;           // over the floor; under contact shadows (2) and sprites (10)
  mesh.frustumCulled = false;
  mesh.raycast = () => { };
  mesh.visible = false;
  scene.add(mesh);
  _cue.mesh = mesh;
}

function updateCue() {
  if (_cue.D !== D || !_cue.mesh) buildCue();
  const mesh = _cue.mesh;
  if (!mesh) return;
  const { W, H } = D;
  const data = _cue.data, cells = _lm.cells, level = _lm.level;
  data.fill(0);
  const amt = new Float32Array(W * H).fill(-1);
  let any = false;
  for (let i = 0; i < cells.length; i++) {
    const a = cueAmount(level[i]);
    amt[cells[i].gy * W + cells[i].gx] = a;
    if (a > 0) any = true;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = y * W + x;
    let a = amt[c];
    if (a < 0) {
      /* off the floor: borrow the neighbours, so the bilinear edge doesn't
         pull a floor tile's shade toward an arbitrary value */
      let sum = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const v = amt[ny * W + nx];
        if (v >= 0) { sum += v; n++; }
      }
      a = n ? sum / n : 0;
    }
    data[c * 4] = Math.round(Math.min(1, Math.max(0, a)) * 255);
    data[c * 4 + 3] = 255;
  }
  _cue.tex.needsUpdate = true;
  const U = mesh.material.uniforms;
  U.uDim.value.set(DARK_CUE.dim[0], DARK_CUE.dim[1], DARK_CUE.dim[2]);
  U.uDark.value.set(DARK_CUE.dark[0], DARK_CUE.dark[1], DARK_CUE.dark[2]);
  U.uStrength.value = DARK_CUE.strength;
  mesh.visible = DARK_CUE.enabled && DARK_CUE.strength > 0 && any;
  setPropCueState(_cue.tex, W, H, DARK_CUE.dim, DARK_CUE.dark, mesh.visible ? DARK_CUE.strength : 0);
}

/** Cue amount the floor at (x, z) was last shaded with (0 bright … 1 darkest),
 *  or null off the map / before the first paint. For tests and the console. */
export function darknessCueAt(x, z) {
  if (!_cue.data || !D) return null;
  const gx = Math.round(x + D.W / 2 - 0.5), gz = Math.round(z + D.H / 2 - 0.5);
  if (gx < 0 || gz < 0 || gx >= D.W || gz >= D.H) return null;
  return _cue.data[(gz * D.W + gx) * 4] / 255;
}
export const darknessCueShown = () => !!(_cue.mesh && _cue.mesh.visible);

/** Hide the cue and the F4 tiles (the game calls this outside a crawl, where
 *  nothing ticks them and the last level's would otherwise linger). */
export function hideLightOverlays() {
  if (_cue.mesh) _cue.mesh.visible = false;
  if (_dbg.mesh) _dbg.mesh.visible = false;
  setPropCueState(null, 1, 1, DARK_CUE.dim, DARK_CUE.dark, 0);
}

/* ── F4: light debug overlay ──
   Every floor tile painted by its light state (from the light map above),
   every creature's contact shadow swapped for a ring of its own state's
   colour. Creatures update every frame (they move). */
export const LIGHT_DEBUG_COLORS = { bright: 0xffe36b, dim: 0x3f8cff, dark: 0xff2f6a };
const _dbg = { on: false, mesh: null, forD: null, legend: null };
const _dbgCol = new THREE.Color(), _dbgM = new THREE.Matrix4();

function hex6(c) { return '#' + c.toString(16).padStart(6, '0'); }

export function setLightDebug(on) {
  _dbg.on = !!on;
  if (_dbg.mesh) _dbg.mesh.visible = _dbg.on;
  _lm.t = 0;
  if (typeof document !== 'undefined' && document.body && document.createElement) {
    if (!_dbg.legend && _dbg.on) {
      const el = document.createElement('div');
      const sw = c => '<span style="display:inline-block;width:10px;height:10px;margin:0 4px 0 10px;background:' + hex6(c) + '"></span>';
      el.innerHTML = '<b>Light debug (F4)</b>' + sw(LIGHT_DEBUG_COLORS.bright) + 'bright'
        + sw(LIGHT_DEBUG_COLORS.dim) + 'dim' + sw(LIGHT_DEBUG_COLORS.dark) + 'dark';
      if (el.style) Object.assign(el.style, {
        position: 'fixed', left: '8px', bottom: '8px', zIndex: 9999, padding: '4px 8px',
        font: '12px monospace', color: '#fff', background: 'rgba(0,0,0,0.7)', pointerEvents: 'none'
      });
      if (document.body.appendChild) document.body.appendChild(el);
      _dbg.legend = el;
    }
    if (_dbg.legend && _dbg.legend.style) _dbg.legend.style.display = _dbg.on ? 'block' : 'none';
  }
  return _dbg.on;
}
export const toggleLightDebug = () => setLightDebug(!_dbg.on);
export const lightDebugOn = () => _dbg.on;
if (typeof window !== 'undefined') {
  window.__lightDebug = setLightDebug;
  window.__lightAt = (x, z) => {
    const v = lightLevelAt(x, groundY(D, x, z), z);
    return { level: +v.toFixed(3), state: classifyLight(v) };
  };
}

function buildDebugTiles() {
  if (_dbg.mesh) { scene.remove(_dbg.mesh); _dbg.mesh.geometry.dispose(); _dbg.mesh.material.dispose(); _dbg.mesh = null; }
  _dbg.forD = D;
  if (!ensureLightMap()) return;
  const cells = _lm.cells;
  const geo = new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false, fog: false });
  mat.toneMapped = false;
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, cells.length));
  mesh.count = cells.length;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    _dbgM.makeTranslation(c.x, c.y + 0.04, c.z);
    mesh.setMatrixAt(i, _dbgM);
    mesh.setColorAt(i, _dbgCol.setHex(LIGHT_DEBUG_COLORS.dark));
  }
  mesh.renderOrder = 3;          // over the floor, under the sprites (10)
  mesh.frustumCulled = false;
  mesh.raycast = () => { };
  mesh.visible = _dbg.on;
  scene.add(mesh);
  _dbg.mesh = mesh;
}

/** Share of floor tiles in each state as the overlay last painted them
 *  ({ bright, dim, dark } fractions, total tile count). */
export function lightDebugSummary() {
  const cells = (_dbg.on && _lm.cells) || [];
  const n = { bright: 0, dim: 0, dark: 0 };
  for (const c of cells) if (c.state) n[c.state]++;
  const t = Math.max(1, n.bright + n.dim + n.dark);
  return { bright: n.bright / t, dim: n.dim / t, dark: n.dark / t, tiles: cells.length };
}

/** The tile states the overlay last painted ({x, z, state}), for tests. */
export function lightDebugTiles() {
  return (_lm.cells || []).map(c => ({ x: c.x, z: c.z, state: c.state }));
}

function updateLightDebug() {
  if (!_dbg.on) return;
  if (_dbg.forD !== D || !_dbg.mesh) buildDebugTiles();
  if (!_dbg.mesh) return;
  const cells = _lm.cells, level = _lm.level;
  for (let i = 0; i < cells.length; i++) {
    cells[i].state = classifyLight(level[i]);
    _dbg.mesh.setColorAt(i, _dbgCol.setHex(LIGHT_DEBUG_COLORS[cells[i].state]));
  }
  if (_dbg.mesh.instanceColor) _dbg.mesh.instanceColor.needsUpdate = true;
}

/* Light map -> cue + F4 tiles, at the map's refresh rate. */
function updateLightOverlays(dt) {
  if (!(DARK_CUE.enabled || _dbg.on)) {
    if (_cue.mesh) _cue.mesh.visible = false;
    setPropCueState(null, 1, 1, DARK_CUE.dim, DARK_CUE.dark, 0);
    return;
  }
  if (!refreshLightMap(dt) && _cue.D === D && (!_dbg.on || _dbg.forD === D)) return;
  if (DARK_CUE.enabled) updateCue();
  else {
    if (_cue.mesh) _cue.mesh.visible = false;
    setPropCueState(null, 1, 1, DARK_CUE.dim, DARK_CUE.dark, 0);
  }
  updateLightDebug();
}

/* ── ground fog at a point ── */
const f32 = Math.fround;
const fract = x => f32(x - Math.floor(x));
/* dungeon_materials.js fogPlaneMat noise, in single precision so the hash
   lands on the same lattice values the GPU picks. */
function h21(px, py) {
  px = fract(f32(px * 123.34)); py = fract(f32(py * 456.21));
  const dd = f32(f32(px * f32(px + 45.32)) + f32(py * f32(py + 45.32)));
  px = f32(px + dd); py = f32(py + dd);
  return fract(f32(px * py));
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx_ = fract(x), fy = fract(y);
  fx_ = fx_ * fx_ * (3 - 2 * fx_); fy = fy * fy * (3 - 2 * fy);
  const a = h21(ix, iy), b = h21(ix + 1, iy), c = h21(ix, iy + 1), d = h21(ix + 1, iy + 1);
  return (a + (b - a) * fx_) + ((c + (d - c) * fx_) - (a + (b - a) * fx_)) * fy;
}
function fbm(x, y) {
  let v = 0, a = 0.625;
  for (let i = 0; i < 2; i++) { v += a * vnoise(x, y); x = f32(x * 2.03 + 11.7); y = f32(y * 2.03 + 11.7); a *= 0.5; }
  return v;
}
const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function groundFogAlpha(x, z) {
  const U = fogPlaneMat.uniforms;
  const t = U.uTime.value, sp = U.uSpeed.value, sc = U.uScale.value;
  const wx = f32(x * sc), wz = f32(z * sc);
  const d1x = t * sp * 1.6, d1y = t * sp * 0.95;
  const d2x = -t * sp * 0.6 + 17.3, d2y = t * sp * 1.3 + 42.1;
  const q1 = fbm(wx * 0.85 + d1x, wz * 0.85 + d1y);
  const q2 = fbm(wx * 0.85 + d2x, wz * 0.85 + d2y);
  const ux = wx + q1 * 1.8, uz = wz + q2 * 1.8;
  const n1 = fbm(ux + d1x * 0.5, uz + d1y * 0.5);
  const n2 = fbm(ux * 1.6 - d2x * 0.7, uz * 1.6 - d2y * 0.7);
  const raw = n1 * 0.63 + n2 * 0.37;
  const wisps = 0.85 + 0.15 * Math.sin(t * 0.4 + n2 * 8.0);
  return smooth(0.48, 0.72, raw) * U.uDensity.value * wisps;
}

/* Mist at the feet: rgb + a in _fog. Layers combine like stacked alpha. */
const _fog = new THREE.Vector4(), _fogC = new THREE.Vector3(), _fogLocal = new THREE.Vector3();
/* The mist sheet's texture (dungeon_materials.js makeMistTex), evaluated
   from the same formula instead of read back from the canvas, at (u, v) with
   the texture's repeat wrapping and the canvas's flipY. */
function mistTexAlpha(u, v) {
  u -= Math.floor(u); v -= Math.floor(v);
  const nx = (u * 256 - 128) / 128, ny = ((1 - v) * 256 - 128) / 128;
  const dist = Math.sqrt(nx * nx + ny * ny);
  if (dist >= 1) return 0;
  const rm = Math.cos(dist * Math.PI * 0.5), env = rm * rm;
  const n1 = Math.sin(nx * 4.2 + ny * 3.1) * Math.cos(ny * 5.4 - nx * 2.2);
  const n2 = Math.sin(nx * 8.5 - ny * 7.2) * 0.5;
  const n3 = Math.cos(nx * 15.0 + ny * 14.0) * 0.25;
  const noise = (n1 + n2 + n3 + 1.75) / 3.5;
  return Math.max(0, Math.min(255, Math.round(env * noise * 220))) / 255;
}
/* createMistMaterial's two scrolling layers at the sheet's own uv — so a unit
   standing in one of the sheet's clear gaps gets no fog, just as the floor
   there shows none. (It used to assume average density everywhere inside the
   sheet, which fogged heroes standing in visibly clear air.) */
export function mistSheetDensity(u, v, t) {
  const a1 = mistTexAlpha(u * 1.15 + t * 0.018, v * 1.15 + t * 0.009);
  const a2 = mistTexAlpha(u * 1.65 - t * 0.013, v * 1.65 + t * 0.016);
  return a1 * 0.58 + a2 * 0.42;
}
function fogAt(P) {
  let clear = 1, wsum = 0;
  _fogC.set(0, 0, 0);
  const add = (a, col) => {
    if (!(a > 0.001)) return;
    clear *= 1 - a; wsum += a;
    _fogC.x += col.r * a; _fogC.y += col.g * a; _fogC.z += col.b * a;
  };
  const mists = fx && fx.mists;
  if (mists) for (const m of mists) {
    const mm = m && m.userData && m.userData.mat;
    if (!mm || !mm.uniforms || !isVisibleInScene(m)) continue;
    _fogLocal.copy(P); m.worldToLocal(_fogLocal);
    const dist = 2 * Math.hypot(_fogLocal.x, _fogLocal.z);
    if (dist >= 1) continue;
    const edge = smooth(1.0, 0.40, dist);
    /* mistSheet geometry is a unit plane rotated flat: uv.x = x + 0.5, uv.y = 0.5 - z */
    const dens = mistSheetDensity(_fogLocal.x + 0.5, 0.5 - _fogLocal.z, mm.uniforms.uTime ? mm.uniforms.uTime.value : 0);
    add(dens * edge * mm.uniforms.uOpacity.value * fogClearance(P.x, P.z, m.position.y) * SPRITE_LIGHT.mistGain, mm.uniforms.uColor.value);
  }
  const fp = fx && fx.fogPlane;
  if (fp && isVisibleInScene(fp)) {
    add(groundFogAlpha(P.x, P.z) * fogClearance(P.x, P.z, fp.position.y), fogPlaneMat.uniforms.uColor.value);
  }
  if (wsum <= 0) return _fog.set(0, 0, 0, 0);
  const raw = (1 - clear) * SPRITE_LIGHT.fogGain;
  /* a soft floor: legs in thin or clear patches carry nothing */
  const a = Math.min(SPRITE_LIGHT.fogMax, raw) * smooth(SPRITE_LIGHT.fogFloor, SPRITE_LIGHT.fogFloor * 3, raw);
  return _fog.set(_fogC.x / wsum, _fogC.y / wsum, _fogC.z / wsum, a);
}

/* ── floor glows for virtual lights and glowing creatures ──
   Not lights: a soft additive disc on the ground, sized to the dim radius,
   so a will-o'-wisp or a thrown torch reads as shedding light. Pooled. */
const _glowPool = [];
let _glowTex = null;
function glowTexture() {
  if (_glowTex || typeof document === 'undefined') return _glowTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext && cv.getContext('2d');
  if (!g || !g.createRadialGradient) return null;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(cv);
  return _glowTex;
}
function updateGlowDiscs() {
  const items = [];
  for (const L of VIRTUAL_LIGHTS) if (L.glow !== false) { const p = zonePos(L); if (DARK_ZONES.size && inDarkZone(p.x, p.z)) continue; items.push({ x: p.x, z: p.z, dim: L.dim, color: L.color || 0xffc070, k: L.bright > 0 ? 0.55 : 0.32 }); }
  for (const g of _unitGlows) if (!(DARK_ZONES.size && inDarkZone(g.x, g.z))) items.push({ x: g.x, z: g.z, dim: g.dim, color: g.color, k: g.bright > 0 ? 0.16 : 0.28 });
  const tex = glowTexture();
  if (!tex && items.length) return;
  while (_glowPool.length < items.length && _glowPool.length < 32) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    mat.toneMapped = false;
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 2; m.frustumCulled = false; m.raycast = () => { };
    scene.add(m);
    _glowPool.push(m);
  }
  for (let i = 0; i < _glowPool.length; i++) {
    const m = _glowPool[i], it = items[i];
    if (!it) { m.visible = false; continue; }
    m.visible = true;
    m.position.set(it.x, (D ? groundY(D, it.x, it.z) : 0) + 0.03, it.z);
    const s = Math.max(1, it.dim * 2);
    m.scale.set(s, 1, s);
    m.material.color.setHex(it.color).multiplyScalar(it.k);
  }
}

/* ── per frame ── */
/* Frame-wide basis shared by the sprite pass and the debug overlay: the live
   light list, camera right, the standing-body normals, sun and sky direction. */
function prepareFrame(dt) {
  refreshLights(dt);

  /* Frame-wide basis: camera right, a mostly-horizontal "facing the camera"
     normal (a standing body, not the tilted quad), and the two side normals. */
  cam.updateMatrixWorld();
  const e = cam.matrixWorld.elements;
  _right.set(e[0], 0, e[2]).normalize();
  _toCam.set(e[8], 0, e[10]).normalize();
  _nF.copy(_toCam).setY(0.3).normalize();
  _nL.copy(_nF).addScaledVector(_right, -SPRITE_LIGHT.side).normalize();
  _nR.copy(_nF).addScaledVector(_right, SPRITE_LIGHT.side).normalize();
  _sun.copy(sunOffset).normalize();
  _hemiDir.copy(hemi.position).normalize();
  if (_hemiDir.lengthSq() < 0.5) _hemiDir.set(0, 1, 0);

  /* How lit the open floor is. It only scales the readability floor, so a
     night keeps a faint lift. Critters sample this same frame. */
  ambientAndSun(_up, 1, _ref);
  const sceneK = litLum(_ref) / SPRITE_LIGHT.ref;
  _floor = SPRITE_LIGHT.floor * Math.min(1, Math.max(SPRITE_LIGHT.floorMin, sceneK));
}

/* Ambient critters are the same unlit sprite cards as heroes. The game
   registers a walker; this pass tints whatever it hands back. */
let _shadeList = null;
export function setSpriteShadeList(fn) { _shadeList = fn; }

/**
 * Write the hero light onto one billboard. `sprLit` stays white until
 * something calls this, which is why a critter used to read as a full-bright
 * PNG in a dark scene. Left and right match the body pass. No fog: these
 * cards sit in the crowns, and the ground mist would paint the whole sprite.
 */
export function shadeBillboard(mesh, x, y, z, dt) {
  const lit = mesh && mesh.material && mesh.material.userData && mesh.material.userData.sprLit;
  if (!lit || !hemi || !dirL) return;
  if (!SPRITE_LIGHT.enabled) {
    lit.L.value.set(1, 1, 1);
    lit.R.value.set(1, 1, 1);
    return;
  }
  const scaleX = Math.abs(mesh.scale && mesh.scale.x) || 0.2;
  const off = 0.18 * scaleX;
  _p.set(x, y, z);
  _q.copy(_p).addScaledVector(_right, -off);
  const visL = sunVisibility(_q);
  ambientAndSun(_up, visL, _a);
  ambientAndSun(_nL, visL, _ref);
  keepBrighter(_a, _ref);
  addPointLights(_p, _nL, _a);
  _q.copy(_p).addScaledVector(_right, off);
  const visR = sunVisibility(_q);
  ambientAndSun(_up, visR, _b);
  ambientAndSun(_nR, visR, _ref);
  keepBrighter(_b, _ref);
  addPointLights(_p, _nR, _b);
  finish(_a);
  finish(_b);
  if (DARK_ZONES.size && inDarkZone(x, z)) { _a.setScalar(0.12); _b.setScalar(0.12); }
  const k = 1 - Math.exp(-SPRITE_LIGHT.rate * (dt > 0 ? dt : 0.016));
  if (!mesh.userData._shadeSeen) {
    mesh.userData._shadeSeen = true;
    lit.L.value.copy(_a);
    lit.R.value.copy(_b);
  } else {
    lit.L.value.lerp(_a, k);
    lit.R.value.lerp(_b, k);
  }
}

function shadeListed(dt) {
  if (_shadeList) _shadeList(shadeBillboard, dt);
}

/** Run the darkness cue and the F4 overlay on their own — for pages with no
 *  creatures and no game loop (the dungeon editor). The game ticks them from
 *  updateSpriteLighting. */
export function tickLightOverlays(dt = 0.016) {
  if (!cam || !hemi || !dirL) return;
  prepareFrame(dt);
  updateLightOverlays(dt);
  shadeListed(dt);
}
export const tickLightDebug = tickLightOverlays;

export function updateSpriteLighting(units, dt = 0.016) {
  if (!cam || !hemi || !dirL) return;
  prepareFrame(dt);
  /* Balance runs (SIM.fast) skip the floor tint and debug overlay. They still
     need the per-floor reset ensureLightMap does (it clears spell lights left
     over from the last floor), and everything below that the rules read. */
  if (SIM.fast) { ensureLightMap(); _fastSig = staticSig(); _fastSrc = steadyLightSources(); }
  else updateLightOverlays(dt);
  if (!units) { shadeListed(dt); return; }

  const k = 1 - Math.exp(-SPRITE_LIGHT.rate * dt);
  /* glowing creatures (monster_light.js) and who stands in magical Darkness */
  _unitGlows = [];
  for (const u of units) {
    if (!u || !u.data || u.data.hp <= 0) continue;
    let g = u.data.classKey ? null : monsterGlow(u);
    /* Sacred Weapon (Devotion paladin) blazes: bright 2 / dim 4 */
    if (!g && u.data.classKey === 'paladin' && u.data.subclass === 'devotion' && hasEffect(u, 'sacredWeapon'))
      g = { bright: 2, dim: 4, color: 0xfff0c0 };
    /* outlined by Faerie Fire (or Guiding Bolt's mark): a faint violet glow */
    if (!g && hasEffect(u, 'faerieFire')) g = { bright: 0, dim: 1, color: 0xb08cff };
    if (g) _unitGlows.push({ x: u.x || 0, z: u.z || 0, bright: g.bright, dim: g.dim, color: g.color, unit: u });
  }
  for (const u of units) if (u) u._inMagicalDarkness = DARK_ZONES.size ? inDarkZone(u.x || 0, u.z || 0) : false;
  updateGlowDiscs();
  if (SIM.fast) snapshotLights();

  for (const u of units) {
    const v = u && (u.ent || u);
    if (!v || !v.grp) continue;

    /* Light status, for every creature with a body in the world — seen or
       not: a goblin lurking in an unrevealed room is still in the dark. */
    /* steady light, so no easing: it follows a carried torch frame by frame */
    v.grp.getWorldPosition(_p);
    u.lightLevel = SIM.fast ? creatureLightLevel(u, _p.x, _p.y, _p.z) : lightLevelAt(_p.x, _p.y, _p.z);
    /* self-check for the fast path: SIM.verify compares it with the plain one */
    if (SIM.fast && SIM.verify) {
      SIM.checked = (SIM.checked || 0) + 1;
      if (lightLevelAt(_p.x, _p.y, _p.z) !== u.lightLevel) SIM.mismatch = (SIM.mismatch || 0) + 1;
    }
    /* No previous state. The hold in classifyLight keeps bright down to
       bright*hyst, and a night theme can put its whole dim band above that
       (moor night is 0.55 / 0.45, so the hold floor is 0.44). A creature that
       was bright once then kept the sun icon on every blue tile. The party
       frames and the rules read this value, and the light is already steady,
       so it classifies the same way the floor tile does. */
    u.lightState = classifyLight(u.lightLevel);
    /* mirrored onto the hero record for the party frames, which are drawn
       from h.data (inventory.js heroSaveRecord keeps it out of saves) */
    if (u.data && typeof u.data === 'object') u.data._lightState = u.lightState;
    if (SIM.fast) continue;   // the rest of the loop only shades the sprite

    const mesh = v.anim && v.anim.mesh;
    const lit = mesh && mesh.material && mesh.material.userData && mesh.material.userData.sprLit;
    if (!lit) continue;
    updateContactShadow(v, mesh, u.lightState);
    if (!SPRITE_LIGHT.enabled) {
      lit.L.value.set(1, 1, 1); lit.R.value.set(1, 1, 1);
      if (lit.fog) lit.fog.value.set(0, 0, 0, 0);
      continue;
    }
    if (!v.grp.visible) continue;

    v.grp.getWorldPosition(_p);
    if (lit.fog) {
      fogAt(_p);
      lit.fogTop.value = SPRITE_LIGHT.fogTop;
      if (!v._litSeen) lit.fog.value.copy(_fog);
      else lit.fog.value.lerp(_fog, k);
    }
    const bodyH = Math.abs(mesh.scale.y) * (v.grp.scale ? v.grp.scale.y : 1);
    _p.y += 0.35 * bodyH;
    const off = 0.18 * Math.abs(mesh.scale.x);

    _q.copy(_p).addScaledVector(_right, -off);
    const visL = sunVisibility(_q);
    ambientAndSun(_up, visL, _a);
    ambientAndSun(_nL, visL, _ref);
    keepBrighter(_a, _ref);
    addPointLights(_p, _nL, _a);
    _q.copy(_p).addScaledVector(_right, off);
    const visR = sunVisibility(_q);
    ambientAndSun(_up, visR, _b);
    ambientAndSun(_nR, visR, _ref);
    keepBrighter(_b, _ref);
    addPointLights(_p, _nR, _b);
    finish(_a); finish(_b);

    /* A creature that sheds its own light is lit by it, whatever the room. */
    if (_unitGlows.some(g => g.unit === u)) {
      for (const v3 of [_a, _b]) {
        const l = 0.2126 * v3.x + 0.7152 * v3.y + 0.0722 * v3.z;
        if (l < 0.9) v3.multiplyScalar(0.9 / Math.max(l, 0.05)).clampScalar(0, 1.05);
      }
    }
    /* Magical Darkness swallows a body whole. */
    if (u._inMagicalDarkness) { _a.setScalar(0.12); _b.setScalar(0.12); }

    /* Snap on a unit's first frame (no fade-in from white), ease after. */
    if (!v._litSeen) { v._litSeen = true; lit.L.value.copy(_a); lit.R.value.copy(_b); }
    else { lit.L.value.lerp(_a, k); lit.R.value.lerp(_b, k); }
  }
  shadeListed(dt);
}
