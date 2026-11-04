/**
 * Dungeon loading curtain.
 *
 * The curtain covers level generation, shader compilation, and entity
 * placement. Progress is the party walking the bottom edge of the screen,
 * left to right. Reported percent often jumps (the floor forge is one long
 * turn, and the first paint used to land already near 70%), so the walk
 * eases toward the reported value at a fixed pace and the curtain stays up
 * until the party has caught up.
 */

let overlayEl = null;
let titleEl = null;
let subtitleEl = null;
let partyEl = null;
let hideTimer = null;
let isVisible = false;
let showStartTime = 0;
let targetPct = 0;
let shownPct = 0;
let marching = false;
let marchRaf = 0;
let lastMarchTs = 0;
let partyToken = 0;
let marchers = [];

export const MIN_LOADING_TIME_MS = 1400;
/* Full left-to-right crossing. A reported jump (0 → 70) takes the same
   fraction of this, so the party never teleports to wherever the loader is. */
export const MARCH_FULL_MS = 2200;
const MARCH_DT_CAP_SEC = 0.05;
const WALK_FPS = 8;

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
    el = document.createElement('div');
    el.id = 'dungeon-loading-overlay';
    el.className = 'dungeon-loading-overlay hidden';
    el.setAttribute('aria-live', 'polite');

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
  }
  overlayEl = el;
  return overlayEl;
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

function paintMarchers(nowSec) {
  for (const fig of marchers) {
    const sheet = fig._sheet;
    if (!sheet || !fig._ctx) continue;
    const frame = 1 + Math.floor((nowSec + fig._phase) * WALK_FPS) % 8;
    if (frame === fig._frame) continue;
    fig._frame = frame;
    const cell = sheet.cell;
    const ctx = fig._ctx;
    ctx.clearRect(0, 0, fig.width, fig.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      sheet.canvas,
      frame * cell, sheet.rightRow * cell, cell, cell,
      0, 0, fig.width, fig.height
    );
  }
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
 * on the next frame.
 */
export function advanceLoadingMarch(dtSec, nowSec = 0) {
  const dt = Math.min(MARCH_DT_CAP_SEC, Math.max(0, dtSec || 0));
  const rate = 100 / (MARCH_FULL_MS / 1000);
  if (shownPct < targetPct) shownPct = Math.min(targetPct, shownPct + rate * dt);
  applyMarchPosition();
  if (nowSec) paintMarchers(nowSec);
  return shownPct;
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
    advanceLoadingMarch(dt, ts / 1000);
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
  if (!members.length || typeof document === 'undefined' || !document.createElement) return;
  const token = partyToken;
  members.forEach((hero, i) => {
    const canvas = document.createElement('canvas');
    canvas.className = 'dungeon-loading-hero';
    canvas.width = 64;
    canvas.height = 64;
    canvas._phase = i * 0.13;
    canvas._frame = -1;
    partyEl.appendChild(canvas);
    marchers.push(canvas);
    composeSheet(hero).then(sheet => {
      if (token !== partyToken || !sheet || !sheet.canvas) return;
      const cell = sheet.cell || 64;
      canvas.width = cell;
      canvas.height = cell;
      canvas._sheet = sheet;
      canvas._ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      canvas._frame = -1;
    });
  });
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
  if (opts.theme) el.setAttribute('data-theme', opts.theme);
  else if (opening) el.setAttribute('data-theme', '');
  publishMarch();

  const party = opts.party || (opening ? liveParty() : null);
  /* Embark shows the curtain, then the floor load shows it again. Remounting
     would throw away walk sheets that are already decoding. */
  if (party && (opening || marchers.length === 0)) mountParty(party);

  el.classList.remove('hidden', 'fade-out');
  el.classList.add('active');
  isVisible = true;
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

/** Run `fn` after the curtain has been painted. Sync forge work belongs here. */
export function scheduleAfterPaint(fn) {
  nextPaint().then(fn);
}

/**
 * Show the loading curtain and wait until it is genuinely on screen.
 *
 * Use this instead of `showLoadingScreen()` at any point where a click kicks off
 * blocking work — the curtain becomes immediate feedback that the input landed,
 * even if the thread then stalls behind it.
 */
export async function showLoadingScreenPainted(opts = {}) {
  showLoadingScreen(opts);
  await nextPaint();
}

/**
 * Hide the curtain once three things are true: the minimum time has elapsed,
 * the caller's ready promise has settled, and the party has walked up to the
 * reported percent. The last one is what keeps a 70% jump from dismissing
 * the screen while the party is still on the left.
 */
export function hideLoadingScreen(readyPromiseOrDuration = MIN_LOADING_TIME_MS, minDurationMs = MIN_LOADING_TIME_MS) {
  const el = ensureElements();
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
    try {
      if (typeof window !== 'undefined' && window.ENGINE && typeof window.ENGINE.finishAnim === 'function') {
        window.ENGINE.finishAnim();
      }
    } catch (e) {}

    const finishHide = () => {
      el.classList.add('fade-out');
      setTimeout(() => {
        el.classList.remove('active', 'fade-out');
        el.classList.add('hidden');
        isVisible = false;
        stopMarch();
      }, 380);
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
