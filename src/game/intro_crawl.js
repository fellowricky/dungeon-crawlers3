/**
 * Opening crawl — Star-Wars-style receding text shown once, right after a
 * new party is created, before the world map reveals. Fully narrated: each
 * paragraph queues its prerecorded line (intro_crawl_p0..pN, Merlin voice).
 *
 * Skippable at any time (button or Esc); skipping cuts narration and hands
 * control to the onDone callback (which opens the world map).
 */
import { INTRO_CRAWL } from './story.js';
import { playNarration, queueNarration, stopNarration, preloadNarration, isNarrationActive } from './audio.js';
import { hideLoadingScreen } from '../ui/loading_screen.js';

let root = null;
let done = false;
let onDoneCb = null;
let keyHandler = null;
let waitPoll = null;
let sawNarration = false;

function ensureDom() {
  if (root) return;
  root = document.createElement('div');
  root.id = 'intro-crawl';
  root.innerHTML = `
    <div class="ic-persp">
      <div class="ic-scroll" id="ic-scroll">
        <div class="ic-title">${INTRO_CRAWL.title}</div>
        <div class="ic-subtitle">${INTRO_CRAWL.subtitle}</div>
        ${INTRO_CRAWL.paragraphs.map(p => `<p>${p}</p>`).join('')}
      </div>
    </div>
    <div class="ic-fade ic-fade-top"></div>
    <div class="ic-fade ic-fade-bottom"></div>
    <button class="ic-skip" id="ic-skip">Skip ▸</button>`;
  document.body.appendChild(root);
  root.querySelector('#ic-skip').addEventListener('click', finish);
  root.querySelector('#ic-scroll').addEventListener('animationend', onScrollEnd);
}

/* Fallback only: if the narration never played (muted / missing), the scroll
   running its full course is what ends the crawl. When narration IS playing,
   the drain-poll in showIntroCrawl fades out long before this fires. */
function onScrollEnd() {
  if (!sawNarration) beginFade();
}

/* Narration finished (or fallback fired): reveal the world map underneath,
   then dissolve the crawl over it — a true cross-fade into the map screen. */
function beginFade() {
  if (done) return;
  done = true;
  stopNarration();
  if (waitPoll) { clearInterval(waitPoll); waitPoll = null; }
  if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
  const cb = onDoneCb;
  onDoneCb = null;
  if (cb) cb();                       // world map appears beneath (z-50 < z-70)
  root.classList.add('ic-out');       // 2.2s opacity dissolve (game.css)
  setTimeout(() => root.classList.remove('show', 'run', 'ic-out'), 2400);
}

/* Skip: no fade, straight to the map. */
function finish() {
  if (done) return;
  done = true;
  stopNarration();
  if (waitPoll) { clearInterval(waitPoll); waitPoll = null; }
  if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
  if (root) root.classList.remove('show', 'run', 'ic-out');
  const cb = onDoneCb;
  onDoneCb = null;
  if (cb) cb();
}

export function showIntroCrawl(onDone) {
  ensureDom();
  done = false;
  sawNarration = false;
  onDoneCb = onDone || null;
  root.classList.remove('ic-out');
  root.classList.add('show');
  /* two frames so the initial transform commits before the animation starts */
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('run')));

  /* Embarking from party setup raises the loading curtain and hands over to
     the crawl, which is not a floor load and so never lowers it. Drop it now
     that the crawl is on screen, or the run starts behind a frozen curtain. */
  hideLoadingScreen();

  /* Warm every paragraph's buffer up front so the chain has no fetch/decode
     stalls between lines, then play: p0 via playNarration (hard-resets any
     stale narration state), the rest queued with a short breath between. */
  const ids = INTRO_CRAWL.paragraphs.map((p, i) => `intro_crawl_p${i}`);
  preloadNarration(ids);
  playNarration(ids[0]);
  ids.slice(1).forEach(id => queueNarration(id, { delay: 350 }));

  /* The narration is the clock: once the voice channel has been active and
     then drains, cross-fade into the map. (If it never activates — muted —
     the scroll's own animationend is the fallback.) */
  waitPoll = setInterval(() => {
    if (done) { clearInterval(waitPoll); waitPoll = null; return; }
    if (isNarrationActive()) { sawNarration = true; return; }
    if (sawNarration) beginFade();
  }, 250);

  keyHandler = e => { if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') finish(); };
  document.addEventListener('keydown', keyHandler);
}
