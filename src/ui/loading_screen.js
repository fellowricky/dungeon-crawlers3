/**
 * Dungeon Loading Screen Overlay
 * Provides a clean, atmospheric loading curtain during level generation,
 * shader compilation, and entity placement to eliminate initial pop-in and stutter.
 */

let overlayEl = null;
let titleEl = null;
let subtitleEl = null;
let barFillEl = null;
let percentEl = null;
let hideTimer = null;
let isVisible = false;
let showStartTime = 0;
export const MIN_LOADING_TIME_MS = 1400;

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

    const crest = document.createElement('div');
    crest.className = 'dungeon-loading-crest';
    const spinner = document.createElement('div');
    spinner.className = 'dungeon-loading-spinner';
    const icon = document.createElement('span');
    icon.className = 'dungeon-loading-icon';
    icon.textContent = '⚔️';
    crest.appendChild(spinner);
    crest.appendChild(icon);

    titleEl = document.createElement('div');
    titleEl.id = 'dungeon-loading-title';
    titleEl.className = 'dungeon-loading-title';
    titleEl.textContent = 'ENTERING DUNGEON';

    subtitleEl = document.createElement('div');
    subtitleEl.id = 'dungeon-loading-subtitle';
    subtitleEl.className = 'dungeon-loading-subtitle';
    subtitleEl.textContent = 'Preparing level & illuminating depths...';

    const barTrack = document.createElement('div');
    barTrack.className = 'dungeon-loading-bar-track';
    barFillEl = document.createElement('div');
    barFillEl.id = 'dungeon-loading-bar-fill';
    barFillEl.className = 'dungeon-loading-bar-fill';
    barTrack.appendChild(barFillEl);

    percentEl = document.createElement('div');
    percentEl.id = 'dungeon-loading-percent';
    percentEl.className = 'dungeon-loading-percent';
    percentEl.textContent = '0%';

    content.appendChild(crest);
    content.appendChild(titleEl);
    content.appendChild(subtitleEl);
    content.appendChild(barTrack);
    content.appendChild(percentEl);
    el.appendChild(content);

    document.body.appendChild(el);
  } else {
    titleEl = document.getElementById('dungeon-loading-title');
    subtitleEl = document.getElementById('dungeon-loading-subtitle');
    barFillEl = document.getElementById('dungeon-loading-bar-fill');
    percentEl = document.getElementById('dungeon-loading-percent');
  }
  overlayEl = el;
  return overlayEl;
}

/**
 * Update the loading screen progress percentage and optional status message.
 */
export function updateLoadingProgress(percent = 0, statusText = null) {
  ensureElements();
  const pct = Math.min(100, Math.max(0, Math.round(percent)));
  if (barFillEl) {
    if (barFillEl.style) barFillEl.style.width = `${pct}%`;
  }
  if (percentEl) {
    percentEl.textContent = `${pct}%`;
  }
  if (statusText && subtitleEl) {
    subtitleEl.textContent = statusText;
  }
}

/**
 * Show the loading screen curtain with optional title and subtitle.
 */
export function showLoadingScreen(opts = {}) {
  const el = ensureElements();
  if (!el) return;

  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  showStartTime = Date.now();

  const title = opts.title || 'ENTERING DUNGEON';
  const subtitle = opts.subtitle || (opts.floor ? `Descend into Floor ${opts.floor}` : 'Illuminating dark corridors...');

  if (titleEl) titleEl.textContent = title;
  if (subtitleEl) subtitleEl.textContent = subtitle;
  updateLoadingProgress(opts.progress || 0, subtitle);

  el.classList.remove('hidden', 'fade-out');
  el.classList.add('active');
  isVisible = true;
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
 * Hide the loading screen with a smooth cross-fade once rendering and asset warmup have settled.
 * Supports an optional readyPromise (e.g. GPU shader compile & texture decode) to ensure everything
 * is fully ready before revealing the scene.
 */
export function hideLoadingScreen(readyPromiseOrDuration = MIN_LOADING_TIME_MS, minDurationMs = MIN_LOADING_TIME_MS) {
  const el = ensureElements();
  if (!el || !isVisible) return;

  if (hideTimer) clearTimeout(hideTimer);

  let readyPromise = null;
  let duration = MIN_LOADING_TIME_MS;

  if (readyPromiseOrDuration && typeof readyPromiseOrDuration.then === 'function') {
    readyPromise = readyPromiseOrDuration;
    duration = typeof minDurationMs === 'number' ? minDurationMs : MIN_LOADING_TIME_MS;
  } else if (typeof readyPromiseOrDuration === 'number') {
    duration = readyPromiseOrDuration;
  }

  const now = Date.now();
  const elapsed = showStartTime > 0 ? (now - showStartTime) : duration;
  const waitMs = Math.max(50, duration - elapsed);

  const dismiss = () => {
    try {
      if (typeof window !== 'undefined' && window.ENGINE && typeof window.ENGINE.finishAnim === 'function') {
        window.ENGINE.finishAnim();
      }
    } catch (e) {}

    // Wait an additional animation frame so WebGL pipeline renders first buffer cleanly
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        el.classList.add('fade-out');
        setTimeout(() => {
          el.classList.remove('active', 'fade-out');
          el.classList.add('hidden');
          isVisible = false;
        }, 380);
      });
    } else {
      el.classList.remove('active');
      el.classList.add('hidden');
      isVisible = false;
    }
  };

  if (readyPromise) {
    Promise.all([
      new Promise(res => { hideTimer = setTimeout(res, waitMs); }),
      Promise.resolve(readyPromise).catch(() => {})
    ]).then(dismiss);
  } else {
    hideTimer = setTimeout(dismiss, waitMs);
  }
}
