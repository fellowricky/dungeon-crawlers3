/**
 * Dungeon loading curtain.
 *
 * The curtain covers level generation, shader compilation, and entity
 * placement. Progress is the party walking the bottom edge of the screen,
 * left to right. Reported percent often jumps (the floor forge is one long
 * turn, and the first paint used to land already near 70%), so the walk
 * eases toward the reported value at a fixed pace and the curtain stays up
 * until the party has caught up. It leaves through a pixelfx wipe, chosen
 * at random: iris, burn away, or slash. Iris and slash shut, then open
 * onto the floor. Burn away eats the plate once from the edges. The
 * loading art stays in the middle until the fire reaches it, and the game
 * shows through what has already burned.
 */

import { playLoadingWipe, cancelLoadingWipe } from './loading_wipe.js';
import { heroShape } from '../game/appearance.js';
import { mountPlateWeather, stopPlateWeather, plateWeatherKind } from './loading_weather.js';
import {
  startOffthreadPlate, stopOffthreadPlate, isOffthreadCanvas, offthreadBroken, onOffthreadBroken, warmOffthread
} from './loading_offthread.js';

let overlayEl = null;
let titleEl = null;
let subtitleEl = null;
let mapEl = null;
let floorEl = null;
let pipsEl = null;
let partyEl = null;
let hideTimer = null;
let isVisible = false;
/* Set once the curtain starts to go, so the game draws again under the wipe. */
let leaving = false;
let showStartTime = 0;
let targetPct = 0;
let shownPct = 0;
let marching = false;
let marchRaf = 0;
let lastMarchTs = 0;
let partyToken = 0;
let marchers = [];
let plateVideo = null;
let weatherEl = null;
/* The plate loop drawn by the curtain worker. The <video> stays as the
   fallback for browsers (or files) the worker cannot decode. */
let plateCanvas = null;
let lastWeather = '';
let lastWeatherSeed = 1;
/* A hand-authored floor name stays. A placeholder (theme, region, quest
   title) is replaced once the forge actually names the map. */
let mapLocked = false;
/* The still and the walk strips. The forge waits on these so a blocked
   thread cannot hold the curtain on its empty ground color. */
let plateReady = Promise.resolve();
let partyReady = Promise.resolve();
let plateSerial = 0;

export const MIN_LOADING_TIME_MS = 1400;

/* The curtain worker loads its module now, during boot, rather than at the
   first curtain, where that time came straight out of the plate's start. */
if (typeof window !== 'undefined') warmOffthread();

/* Still plates. Overland floors have day, dusk, and night. Dungeons have one.
   A sibling mp4 plays over the still when that loop exists. An unknown key
   returns '' so the curtain keeps the dark ground instead of requesting a
   missing file. */
const DUNGEON_PLATES = new Set(['ancient', 'verdant', 'frost', 'grim', 'molten']);
const OVERLAND_PLATES = new Set([
  'forest', 'moor', 'mire', 'holdfast', 'boneyard', 'ruinfield', 'ashfield', 'snowfield', 'sporewood'
]);

export function loadingPlateUrl(theme, timeOfDay) {
  const key = String(theme || '').toLowerCase();
  if (DUNGEON_PLATES.has(key)) return `./art/loading/${key}.webp`;
  if (!OVERLAND_PLATES.has(key)) return '';
  const tod = timeOfDay === 'dusk' || timeOfDay === 'night' ? timeOfDay : 'day';
  return `./art/loading/${key}_${tod}.webp`;
}

function videoSrc(video) {
  if (!video) return '';
  const bag = video.attributes;
  if (bag && typeof bag.src === 'string') return bag.src;
  if (typeof video.getAttribute === 'function') return video.getAttribute('src') || '';
  return '';
}

function clearPlateVideo(video) {
  if (!video) return;
  if (typeof video.pause === 'function') {
    try { video.pause(); } catch (e) { /* already stopped */ }
  }
  if (typeof video.removeAttribute === 'function') video.removeAttribute('src');
  else if (video.attributes) video.attributes.src = '';
  if (video.style) video.style.display = 'none';
}

function playPlateVideo(video) {
  if (!video || typeof video.play !== 'function') return;
  try {
    const pending = video.play();
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  } catch (e) { /* autoplay can throw before a gesture */ }
}

/* A bad file must not sit on top of the still. A video with no frames paints
   black, and that black covers the picture, so the element stays hidden until
   a frame has actually arrived. */
function onPlateVideoError(video) {
  clearPlateVideo(video);
}

function revealPlateVideo(video) {
  if (!videoSrc(video)) return;
  if (video.style) video.style.display = '';
}

function attachPlateVideo(el) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  let video = typeof document.getElementById === 'function'
    ? document.getElementById('dungeon-loading-plate')
    : null;
  if (!video) {
    video = document.createElement('video');
    video.id = 'dungeon-loading-plate';
    video.className = 'dungeon-loading-plate';
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    if (video.style) video.style.display = 'none';
    if (typeof video.setAttribute === 'function') {
      video.setAttribute('muted', '');
      video.setAttribute('loop', '');
      video.setAttribute('autoplay', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('preload', 'auto');
    }
    if (typeof video.addEventListener === 'function') {
      video.addEventListener('error', () => onPlateVideoError(video));
      video.addEventListener('loadeddata', () => revealPlateVideo(video));
    }
    const first = el.firstChild;
    if (first && typeof el.insertBefore === 'function') el.insertBefore(video, first);
    else el.appendChild(video);
  }
  plateVideo = video;
  return video;
}

/* Decode the still before anything else asks for the wire. The loop is a
   much larger file, and a forge that starts now would sit on the main thread
   until the picture and the heroes had missed their chance to paint. */
function warmPlate(url) {
  if (!url || typeof Image !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    const timer = setTimeout(finish, 4000);
    const img = new Image();
    try { img.fetchPriority = 'high'; } catch (e) { /* older browsers */ }
    if (typeof img.setAttribute === 'function') img.setAttribute('fetchpriority', 'high');
    img.onload = () => {
      const job = (typeof img.decode === 'function') ? img.decode() : null;
      Promise.resolve(job).then(() => { clearTimeout(timer); finish(); }, () => { clearTimeout(timer); finish(); });
    };
    img.onerror = () => { clearTimeout(timer); finish(); };
    img.src = url;
  });
}

function beginPlateVideo(video, url) {
  if (!video || !url) return;
  const loop = url.replace(/\.webp(\?.*)?$/, '.mp4$1');
  const same = videoSrc(video) === loop;
  if (!same) {
    if (video.style) video.style.display = 'none';
    if (typeof video.setAttribute === 'function') video.setAttribute('src', loop);
    else if (video.attributes) video.attributes.src = loop;
  } else if ((video.readyState || 0) >= 2) {
    revealPlateVideo(video);
  }
  playPlateVideo(video);
}

function attachPlateCanvas(el) {
  if (plateCanvas && plateCanvas.parentNode === el) return plateCanvas;
  if (typeof document === 'undefined' || !document.createElement) return null;
  const canvas = document.createElement('canvas');
  canvas.id = 'dungeon-loading-plate-canvas';
  canvas.className = 'dungeon-loading-plate';
  if (canvas.style) canvas.style.display = 'none';
  /* Right after the video: over the still, under the weather. */
  const after = plateVideo && plateVideo.parentNode === el ? plateVideo.nextSibling : el.firstChild;
  if (after && typeof el.insertBefore === 'function') el.insertBefore(canvas, after);
  else el.appendChild(canvas);
  plateCanvas = canvas;
  return canvas;
}

function hidePlateCanvas() {
  if (plateCanvas && plateCanvas.style) plateCanvas.style.display = 'none';
}

function loopUrl(url) {
  return url.replace(/\.webp(\?.*)?$/, '.mp4$1');
}

/* The loop the worker is playing now: { loop, shown, moving }. `moving`
   settles on its first drawn frame (or its failure). */
let plateLive = null;

function stopPlateOffthread() {
  plateLive = null;
  stopOffthreadPlate();
}

/* The loop from the curtain worker. It keeps playing while a forge holds the
   main thread, which a <video> cannot: its data loading and its loop both
   run here. False when the worker is not available. A second show of the
   same plate (embark, then the floor load) keeps the loop running. */
function beginPlateOffthread(el, video, url, serial) {
  if (typeof HTMLCanvasElement === 'undefined' || typeof Worker !== 'function' || offthreadBroken()) return false;
  const loop = loopUrl(url);
  if (plateLive && plateLive.loop === loop) {
    if (plateLive.shown && plateCanvas && plateCanvas.style) plateCanvas.style.display = '';
    return true;
  }
  const canvas = attachPlateCanvas(el);
  if (!canvas) return false;
  const live = { loop, shown: false, moving: null, settle: null };
  live.moving = new Promise((resolve) => { live.settle = resolve; });
  const ok = startOffthreadPlate(canvas, loop, serial, {
    shown: () => {
      live.settle();
      if (plateLive !== live) return;
      live.shown = true;
      if (canvas.style) canvas.style.display = '';
    },
    failed: () => {
      live.settle();
      if (plateLive !== live) return;
      plateLive = null;
      hidePlateCanvas();
      beginPlateVideo(video, url);
    }
  });
  if (!ok) return false;
  plateLive = live;
  clearPlateVideo(video);
  return true;
}

export const PLATE_MOTION_WAIT_MS = 2000;

function plateMoving(capMs) {
  const live = plateLive;
  if (!live || live.shown) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, capMs);
    live.moving.then(() => { clearTimeout(timer); resolve(); });
  });
}

function applyPlate(el, theme, timeOfDay) {
  const serial = ++plateSerial;
  if (theme) el.setAttribute('data-theme', theme);
  else el.setAttribute('data-theme', '');
  if (timeOfDay) el.setAttribute('data-time', timeOfDay);
  else if (typeof el.removeAttribute === 'function') el.removeAttribute('data-time');
  else el.setAttribute('data-time', '');
  const url = loadingPlateUrl(theme, timeOfDay);
  const video = attachPlateVideo(el);
  if (!url || !plateLive || plateLive.loop !== loopUrl(url)) hidePlateCanvas();
  if (!url) {
    if (el.style) el.style.backgroundImage = '';
    stopPlateOffthread();
    clearPlateVideo(video);
    plateReady = Promise.resolve();
    return;
  }
  /* Hide a previous loop immediately. A video with no frame paints black
     and would cover the new still. The mp4 itself waits until the still
     has decoded, so it cannot cut in front of the picture. */
  if (video && video.style) video.style.display = 'none';
  plateReady = warmPlate(url).then(() => {
    if (serial !== plateSerial) return;
    if (!beginPlateOffthread(el, video, url, serial)) {
      beginPlateVideo(video, url);
      return undefined;
    }
    /* The load holds until the loop is actually moving on screen, so the
       first thing the player sees is the living picture, not a still that
       starts to move later. Capped: a slow fetch must not hold the floor. */
    return plateMoving(PLATE_MOTION_WAIT_MS);
  });
  if (el.style) el.style.backgroundImage = `url("${url}")`;
}

/* The canvas belongs to this overlay. A rebuilt curtain (tests swap document)
   must not keep drawing on a canvas that was left on the previous one. */
function weatherOn(el) {
  if (!weatherEl || !el) return false;
  if (typeof el.contains === 'function' && el.contains(weatherEl)) return true;
  const kids = el.children;
  if (!kids) return false;
  for (let i = 0; i < kids.length; i++) if (kids[i] === weatherEl) return true;
  return false;
}

/* Rain, fog, snow, or blizzard over the still. Anything else clears the layer. */
function applyPlateWeather(el, weather, seed) {
  const kind = plateWeatherKind(weather);
  lastWeather = weather;
  lastWeatherSeed = seed;
  if (el && typeof el.setAttribute === 'function') el.setAttribute('data-weather', kind);
  if (!kind) {
    stopPlateWeather();
    if (weatherEl && weatherEl.style) weatherEl.style.display = 'none';
    return;
  }
  /* A canvas the worker owned is dead with it, so draw on a fresh one. */
  const orphan = weatherEl && isOffthreadCanvas(weatherEl) && offthreadBroken();
  if (orphan && typeof weatherEl.remove === 'function') weatherEl.remove();
  if (el && typeof document !== 'undefined' && typeof document.createElement === 'function' && (orphan || !weatherOn(el))) {
    weatherEl = document.createElement('canvas');
    weatherEl.id = 'dungeon-loading-weather';
    weatherEl.className = 'dungeon-loading-weather';
    if (typeof el.appendChild === 'function') el.appendChild(weatherEl);
  }
  if (weatherEl && weatherEl.style) weatherEl.style.display = '';
  mountPlateWeather(weatherEl, kind, seed);
}

/* The worker died mid-curtain: keep the weather going on this thread. */
onOffthreadBroken(() => {
  if (isVisible && overlayEl && lastWeather) applyPlateWeather(overlayEl, lastWeather, lastWeatherSeed);
});
/* Full left-to-right crossing. A reported jump (0 → 70) takes the same
   fraction of this, so the party never teleports to wherever the loader is. */
export const MARCH_FULL_MS = 2200;
const MARCH_DT_CAP_SEC = 0.05;
/* Columns 1–8 of the LPC walk row. The clock is a CSS steps() transform,
   not this rAF loop: a floor forge blocks the main thread and freezes
   requestAnimationFrame, and the feet have to keep moving so the curtain
   does not look stuck. 8 frames at this rate is the animation duration. */
const WALK_FPS = 8;
const WALK_FRAMES = 8;
/* Matches .dungeon-loading-hero. A 64px LPC body frame draws at this size.
   Larger cells (oversize weapon sheets) grow the canvas and shift down so
   the body stays this tall and the feet stay on the same line. */
export const HERO_BODY_PX = 112;

/* Display box for one marcher. `drop` is how far the canvas hangs below the
   party baseline: the body frame is centered in an oversize cell, and that
   empty pad has to fall below the line or the hero renders half size. */
export function marcherLayout(cell, scaleX = 1, scaleY = 1) {
  const c = Number(cell) > 0 ? Number(cell) : 64;
  const sx = Number(scaleX) > 0 ? Number(scaleX) : 1;
  const sy = Number(scaleY) > 0 ? Number(scaleY) : 1;
  const px = HERO_BODY_PX / 64;
  return {
    width: Math.round(c * px * sx),
    height: Math.round(c * px * sy),
    drop: Math.round(sy * px * (c - 64) / 2)
  };
}

function fitMarcher(frame, cell, hero) {
  const visual = (hero && (hero.visual || (hero.data && hero.data.visual))) || {};
  const shape = heroShape(visual);   // a dwarf's build is already in the walk sheet
  const box = marcherLayout(cell, shape.quadX, shape.quadY);
  if (!frame || !frame.style) return box;
  frame.style.width = box.width + 'px';
  frame.style.height = box.height + 'px';
  frame.style.transform = box.drop ? `translateY(${box.drop}px)` : '';
  const strip = frame._strip;
  if (strip && strip.style) {
    strip.style.width = (box.width * WALK_FRAMES) + 'px';
    strip.style.height = box.height + 'px';
  }
  const sheet = frame._bitmap;
  if (sheet && sheet.style) {
    sheet.style.width = (box.width * WALK_FRAMES) + 'px';
    sheet.style.height = box.height + 'px';
  }
  return box;
}

/* One frame of the window shows one cell. The strip is eight walk frames
   wide and slides by its own width, so each step lands on a cell. */
function armWalk(strip, phaseSec) {
  if (!strip || !strip.style) return;
  const dur = WALK_FRAMES / WALK_FPS;
  strip.style.animationName = 'dungeon-loading-walk';
  strip.style.animationDuration = dur + 's';
  strip.style.animationTimingFunction = `steps(${WALK_FRAMES}, end)`;
  strip.style.animationIterationCount = 'infinite';
  strip.style.animationDelay = (-(Number(phaseSec) || 0)) + 's';
}

function paintWalkStrip(canvas, sheet) {
  if (!canvas || !sheet || !sheet.canvas) return;
  const cell = sheet.cell || 64;
  const row = Number.isFinite(sheet.rightRow) ? sheet.rightRow : 3;
  canvas.width = cell * WALK_FRAMES;
  canvas.height = cell;
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < WALK_FRAMES; i++) {
    ctx.drawImage(
      sheet.canvas,
      (i + 1) * cell, row * cell, cell, cell,
      i * cell, 0, cell, cell
    );
  }
}

function clampPct(n) {
  return Math.min(100, Math.max(0, Math.round(Number(n) || 0)));
}

function publishMarch() {
  if (!overlayEl || typeof overlayEl.setAttribute !== 'function') return;
  overlayEl.setAttribute('data-loading-target', String(targetPct));
  overlayEl.setAttribute('data-loading-shown', String(Math.round(shownPct)));
}

function ensureElements() {
  if (typeof document === 'undefined' || !document.body) return null;
  let el = document.getElementById('dungeon-loading-overlay');
  if (!el) {
    warmOffthread();
    el = document.createElement('div');
    el.id = 'dungeon-loading-overlay';
    el.className = 'dungeon-loading-overlay hidden';
    el.setAttribute('aria-live', 'polite');
    attachPlateVideo(el);

    const content = document.createElement('div');
    content.className = 'dungeon-loading-content';

    titleEl = document.createElement('div');
    titleEl.id = 'dungeon-loading-title';
    titleEl.className = 'dungeon-loading-title';
    titleEl.textContent = 'ENTERING DUNGEON';

    subtitleEl = document.createElement('div');
    subtitleEl.id = 'dungeon-loading-subtitle';
    subtitleEl.className = 'dungeon-loading-subtitle';
    subtitleEl.textContent = 'Preparing level & illuminating depths...';

    content.appendChild(titleEl);
    content.appendChild(subtitleEl);

    const march = document.createElement('div');
    march.id = 'dungeon-loading-march';
    march.className = 'dungeon-loading-march';

    const road = document.createElement('div');
    road.className = 'dungeon-loading-road';

    partyEl = document.createElement('div');
    partyEl.id = 'dungeon-loading-party';
    partyEl.className = 'dungeon-loading-party';

    march.appendChild(road);
    march.appendChild(partyEl);
    el.appendChild(content);
    el.appendChild(march);
    document.body.appendChild(el);
  } else {
    titleEl = document.getElementById('dungeon-loading-title');
    subtitleEl = document.getElementById('dungeon-loading-subtitle');
    partyEl = document.getElementById('dungeon-loading-party');
    attachPlateVideo(el);
  }
  ensureCard(el);
  overlayEl = el;
  return overlayEl;
}

function clearChildren(el) {
  if (!el) return;
  if (typeof el.replaceChildren === 'function') {
    el.replaceChildren();
    return;
  }
  if (Array.isArray(el.children)) {
    el.children.length = 0;
    return;
  }
  if (typeof el.innerHTML === 'string') el.innerHTML = '';
}

function ensureCard(el) {
  let card = typeof document.getElementById === 'function'
    ? document.getElementById('dungeon-loading-card')
    : null;
  if (!card) {
    card = document.createElement('div');
    card.id = 'dungeon-loading-card';
    card.className = 'dungeon-loading-card';
    for (const corner of ['tl', 'tr', 'bl', 'br']) {
      const tick = document.createElement('span');
      tick.className = 'dungeon-loading-card-corner ' + corner;
      card.appendChild(tick);
    }
    mapEl = document.createElement('div');
    mapEl.id = 'dungeon-loading-map';
    mapEl.className = 'dungeon-loading-map';
    floorEl = document.createElement('div');
    floorEl.id = 'dungeon-loading-floor';
    floorEl.className = 'dungeon-loading-floor';
    pipsEl = document.createElement('div');
    pipsEl.id = 'dungeon-loading-pips';
    pipsEl.className = 'dungeon-loading-pips';
    card.appendChild(mapEl);
    card.appendChild(floorEl);
    card.appendChild(pipsEl);
    el.appendChild(card);
    return;
  }
  mapEl = document.getElementById('dungeon-loading-map');
  floorEl = document.getElementById('dungeon-loading-floor');
  pipsEl = document.getElementById('dungeon-loading-pips');
}

function floorLine(floor, floors) {
  const n = floor | 0;
  const m = floors | 0;
  if (n > 0 && m > 0) return `Floor ${n} of ${m}`;
  if (n > 0) return `Floor ${n}`;
  return '';
}

function paintFloorProgress(floor, floors) {
  const line = floorLine(floor, floors);
  if (floorEl) floorEl.textContent = line;
  if (!pipsEl) return;
  clearChildren(pipsEl);
  const n = floor | 0;
  const m = floors | 0;
  if (!(n > 0 && m > 0 && m <= 12) || typeof document === 'undefined') {
    if (pipsEl.style) pipsEl.style.display = 'none';
    return;
  }
  if (pipsEl.style) pipsEl.style.display = '';
  for (let i = 1; i <= m; i++) {
    const pip = document.createElement('span');
    pip.className = 'dungeon-loading-pip' + (i < n ? ' is-done' : i === n ? ' is-now' : '');
    pipsEl.appendChild(pip);
  }
}

function applyCard(opts, title) {
  const given = typeof opts.map === 'string' ? opts.map.trim() : '';
  const mapText = given || title || '';
  mapLocked = !!opts.mapLock;
  if (mapEl) mapEl.textContent = mapText;
  paintFloorProgress(opts.floor, opts.floors);
  if (titleEl && titleEl.classList) {
    if (mapText && title && mapText === title) titleEl.classList.add('is-echo');
    else titleEl.classList.remove('is-echo');
  }
}

/**
 * Fill in the generated map name once the forge knows it. A show that passed
 * `mapLock` keeps the name it was given (a story floor, the boot curtain).
 */
export function revealLoadingMap(name) {
  if (mapLocked || !mapEl) return;
  const text = String(name || '').trim();
  if (!text || mapEl.textContent === text) return;
  mapEl.textContent = text;
  if (titleEl && titleEl.classList) {
    if (titleEl.textContent === text) titleEl.classList.add('is-echo');
    else titleEl.classList.remove('is-echo');
  }
}

function orderParty(list) {
  const members = (list || []).filter(h => h && !h.temp && !h.companion);
  const g = (typeof window !== 'undefined') ? window.game : null;
  let leader = null;
  if (g && typeof g.partyLeader === 'function') {
    try {
      leader = g.partyLeader(members.filter(h => h.data && h.data.hp > 0));
    } catch (e) { leader = null; }
  }
  if (!leader || !members.includes(leader)) return members;
  return [leader, ...members.filter(h => h !== leader)];
}

function liveParty() {
  const g = (typeof window !== 'undefined') ? window.game : null;
  if (!g || !Array.isArray(g.heroes)) return [];
  const list = typeof g.realHeroes === 'function' ? g.realHeroes() : g.heroes;
  return orderParty(list);
}

function clearParty() {
  partyToken++;
  marchers = [];
  if (!partyEl) return;
  if (typeof partyEl.replaceChildren === 'function') partyEl.replaceChildren();
}

function applyMarchPosition() {
  publishMarch();
  if (!partyEl || !partyEl.style) return;
  const track = (typeof document !== 'undefined')
    ? document.getElementById('dungeon-loading-march')
    : null;
  const trackW = track && track.clientWidth ? track.clientWidth : 0;
  const partyW = partyEl.offsetWidth || 0;
  if (!trackW) {
    partyEl.style.transform = `translateX(${shownPct}%)`;
    return;
  }
  const travel = Math.max(0, trackW - partyW);
  partyEl.style.transform = `translateX(${(shownPct / 100) * travel}px)`;
}

/**
 * Move the party toward the reported percent. `dtSec` is capped so a stall
 * on the main thread (the floor forge) cannot fling them across the screen
 * on the next frame. The walk cycle does not live here: it is a CSS steps
 * animation, so the feet keep moving while this loop is stalled.
 */
export function advanceLoadingMarch(dtSec) {
  const dt = Math.min(MARCH_DT_CAP_SEC, Math.max(0, dtSec || 0));
  const rate = 100 / (MARCH_FULL_MS / 1000);
  if (shownPct < targetPct) shownPct = Math.min(targetPct, shownPct + rate * dt);
  applyMarchPosition();
  return shownPct;
}

/**
 * True while the curtain hides the whole game: shown, and not yet leaving.
 * The render loop skips the scene then. A frame drawn behind the curtain
 * is never seen, and the first one after a forge compiles every new shader
 * synchronously, which froze the curtain for many seconds. preloadFloorAssets
 * compiles them asynchronously instead, before the curtain is allowed to go.
 */
export function loadingCurtainCovers() {
  return isVisible && !leaving;
}

export function loadingMarch() {
  return { shown: shownPct, target: targetPct };
}

function startMarch() {
  if (marching) return;
  if (typeof requestAnimationFrame !== 'function') return;
  marching = true;
  lastMarchTs = 0;
  const step = (ts) => {
    if (!marching) return;
    const dt = lastMarchTs ? (ts - lastMarchTs) / 1000 : 0;
    lastMarchTs = ts;
    advanceLoadingMarch(dt);
    marchRaf = requestAnimationFrame(step);
  };
  marchRaf = requestAnimationFrame(step);
}

function stopMarch() {
  marching = false;
  if (marchRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(marchRaf);
  marchRaf = 0;
}

function sheetFromHero(hero) {
  const tex = hero && hero.ent && hero.ent.anim && hero.ent.anim.textures
    ? hero.ent.anim.textures.walk
    : null;
  const img = tex && tex.image;
  if (!img || !(img.width > 8)) return null;
  const cell = tex._cell || (img.height / 4) || 64;
  return { canvas: img, cell, rightRow: 3 };
}

let composeImport = null;
function composeSheet(hero) {
  const live = sheetFromHero(hero);
  if (live) return Promise.resolve(live);
  const rec = (hero && (hero.visual || hero.equipment)) ? hero : (hero && hero.data);
  if (!rec) return Promise.resolve(null);
  if (!composeImport) composeImport = import('../game/sprite_animator.js');
  return composeImport.then(m => m.composeHeroWalkSheet(rec)).catch(() => null);
}

function mountParty(heroes) {
  const el = ensureElements();
  if (!el || !partyEl) return;
  const members = orderParty(heroes);
  clearParty();
  if (!members.length || typeof document === 'undefined' || !document.createElement) {
    partyReady = Promise.resolve();
    return;
  }
  const token = partyToken;
  const jobs = [];
  members.forEach((hero, i) => {
    const frame = document.createElement('div');
    frame.className = 'dungeon-loading-hero';
    const strip = document.createElement('div');
    strip.className = 'dungeon-loading-strip';
    const canvas = document.createElement('canvas');
    canvas.className = 'dungeon-loading-sheet';
    const phase = i * 0.13;
    armWalk(strip, phase);
    strip.appendChild(canvas);
    frame.appendChild(strip);
    frame._strip = strip;
    frame._bitmap = canvas;
    partyEl.appendChild(frame);
    marchers.push(frame);
    jobs.push(composeSheet(hero).then(sheet => {
      if (token !== partyToken || !sheet || !sheet.canvas) return;
      const cell = sheet.cell || 64;
      fitMarcher(frame, cell, hero);
      paintWalkStrip(canvas, sheet);
    }).catch(() => {}));
  });
  partyReady = Promise.all(jobs).then(() => {}, () => {});
}

/**
 * Update the reported load percent and optional status line.
 * The party walks toward this value; it does not snap to it.
 */
export function updateLoadingProgress(percent = 0, statusText = null) {
  ensureElements();
  targetPct = clampPct(percent);
  publishMarch();
  if (statusText && subtitleEl) subtitleEl.textContent = statusText;
}

/**
 * Show the loading curtain. `opts.party` is the hero list to march (wrappers
 * or hero records). `opts.theme` is the floor theme key, kept for the biome
 * plate. Opening the curtain always starts the party at the left edge, even
 * when the loader has already reported a high percent.
 */
export function showLoadingScreen(opts = {}) {
  const el = ensureElements();
  if (!el) return;

  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  const opening = !isVisible;
  /* A show during the wipe must not let its shut frame hide this curtain. */
  cancelLoadingWipe();
  if (opening) {
    shownPct = 0;
    showStartTime = Date.now();
    lastMarchTs = 0;
  }
  /* A fresh show starts the report at 0 (or opts.progress). The walk position
     is only rewound when the curtain was hidden — embark paints the curtain,
     then the floor load shows it again a frame later, and the party should
     not pop back to the left. */
  targetPct = typeof opts.progress === 'number' ? clampPct(opts.progress) : 0;

  const title = opts.title || (opening ? 'ENTERING DUNGEON' : (titleEl && titleEl.textContent));
  const subtitle = opts.subtitle
    || (opts.floor ? `Descend into Floor ${opts.floor}` : null)
    || (opening ? 'Illuminating dark corridors...' : (subtitleEl && subtitleEl.textContent));

  if (titleEl && title) titleEl.textContent = title;
  if (subtitleEl && subtitle) subtitleEl.textContent = subtitle;
  applyCard(opts, title || '');
  if (opts.theme) applyPlate(el, opts.theme, opts.timeOfDay || '');
  else if (opening) applyPlate(el, '', '');
  applyPlateWeather(el, opts.weather || '', opts.seed || 1);
  publishMarch();

  const party = opts.party || (opening ? liveParty() : null);
  /* Embark shows the curtain, then the floor load shows it again. Remounting
     would throw away walk sheets that are already decoding. */
  if (party && (opening || marchers.length === 0)) mountParty(party);

  el.classList.remove('hidden', 'fade-out');
  el.classList.add('active');
  isVisible = true;
  leaving = false;
  startMarch();
}

/**
 * Resolve once the browser has actually PAINTED the current DOM state.
 *
 * `showLoadingScreen()` only flips a class — it does not draw anything. If the
 * caller then does its heavy work in the same task (generating a floor, building
 * the scene, decoding textures), the browser never gets a frame in between, so
 * the curtain is not on screen while the thread is blocked. What the player sees
 * is the button they clicked freezing for a few seconds, with no acknowledgement
 * that the click registered at all.
 *
 * Two nested rAFs, not one: the first callback runs BEFORE the coming paint, the
 * second only after that paint has been committed. A single rAF would hand the
 * thread back too early and block the very frame it was waiting for.
 *
 * The `setTimeout` is a safety net — rAF does not fire in a background or hidden
 * tab, and a caller awaiting this must never be stranded.
 */
export function nextPaint() {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 120);
  });
}

/* Title card first, then the still and the walk strips, then one more paint
   so those are on screen. Only then is it safe to block the thread. */
function settleCurtain() {
  return nextPaint()
    .then(() => Promise.all([plateReady, partyReady]))
    .then(() => nextPaint());
}

/** Run `fn` after the curtain, the still, and the heroes have been painted. */
export function scheduleAfterPaint(fn) {
  settleCurtain().then(fn);
}

/**
 * Show the loading curtain and wait until the picture and the party are
 * actually on screen. Blocking work (the floor forge, restoring a save)
 * belongs after this, not beside it.
 */
export async function showLoadingScreenPainted(opts = {}) {
  showLoadingScreen(opts);
  await settleCurtain();
}

/**
 * Hide the curtain once three things are true: the minimum time has elapsed,
 * the caller's ready promise has settled, and the party has walked up to the
 * reported percent. The last one is what keeps a 70% jump from dismissing
 * the screen while the party is still on the left.
 */
export function hideLoadingScreen(readyPromiseOrDuration = MIN_LOADING_TIME_MS, minDurationMs = MIN_LOADING_TIME_MS) {
  /* Do not build a curtain just to dismiss it. Boot never shows one, and
     creating it here would hang an empty overlay over the title card. */
  const el = overlayEl
    || (typeof document !== 'undefined' && typeof document.getElementById === 'function'
      ? document.getElementById('dungeon-loading-overlay')
      : null);
  if (!el || !isVisible) return;

  if (hideTimer) clearTimeout(hideTimer);

  let readyDone = true;
  let duration = MIN_LOADING_TIME_MS;

  if (readyPromiseOrDuration && typeof readyPromiseOrDuration.then === 'function') {
    readyDone = false;
    duration = typeof minDurationMs === 'number' ? minDurationMs : MIN_LOADING_TIME_MS;
    Promise.resolve(readyPromiseOrDuration).then(() => { readyDone = true; }, () => { readyDone = true; });
  } else if (typeof readyPromiseOrDuration === 'number') {
    duration = readyPromiseOrDuration;
  }

  const dismiss = () => {
    leaving = true;
    try {
      if (typeof window !== 'undefined' && window.ENGINE && typeof window.ENGINE.finishAnim === 'function') {
        window.ENGINE.finishAnim();
      }
    } catch (e) {}

    const dropCurtain = () => {
      el.classList.remove('active', 'fade-out');
      el.classList.add('hidden');
      isVisible = false;
      stopMarch();
      stopPlateWeather();
      stopPlateOffthread();
      if (plateVideo && typeof plateVideo.pause === 'function') {
        try { plateVideo.pause(); } catch (e) { /* already stopped */ }
      }
    };

    /* A random wipe plays over the curtain. Iris and slash open onto the
       floor. Burn away reveals the floor through the part it has eaten.
       Without a canvas (or when motion is reduced) the old fade still dismisses it. */
    const finishHide = () => {
      if (playLoadingWipe(dropCurtain)) return;
      el.classList.add('fade-out');
      setTimeout(dropCurtain, 380);
    };

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finishHide);
    else finishHide();
  };

  const tickHide = () => {
    if (!isVisible) return;
    const elapsed = showStartTime > 0 ? (Date.now() - showStartTime) : duration;
    const minOk = elapsed >= duration;
    const marchOk = shownPct >= targetPct - 0.75;
    if (minOk && marchOk && readyDone) dismiss();
    else hideTimer = setTimeout(tickHide, 40);
  };
  hideTimer = setTimeout(tickHide, 40);
}
