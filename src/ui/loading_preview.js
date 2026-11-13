/**
 * Dev Hub stage for every loading-plate recipe. The still, the loop, and the
 * weather layer are the same ones the curtain uses.
 */
import { loadingPlateUrl } from './loading_screen.js';
import { loadingRecipes, mountPlateWeather, stopPlateWeather } from './loading_weather.js';
import { isOffthreadCanvas } from './loading_offthread.js';

const recipes = loadingRecipes();
const stage = document.getElementById('stage');
const video = document.getElementById('plate');
const canvas = document.getElementById('weather');
const caption = document.getElementById('caption');
const list = document.getElementById('list');
const filter = document.getElementById('filter');
const count = document.getElementById('count');

let shown = 0;
let videoToken = 0;
/** mp4 url → true when that file is on disk. Missing files stay stills. */
const loopKnown = new Map();

function videoOf(url) {
  return url ? url.replace(/\.webp(\?.*)?$/, '.mp4$1') : '';
}

function writeCaption(recipe, playing) {
  const bits = [recipe.theme, recipe.timeOfDay, recipe.weather].filter(Boolean);
  bits.push(playing ? 'loop' : 'still');
  caption.textContent = bits.join(' · ');
}

function hideVideo() {
  try { video.pause(); } catch (e) { /* already stopped */ }
  video.style.display = 'none';
}

/* The stylesheet keeps #plate at display:none. An empty inline style does
   not override that, so a loaded loop has to be shown explicitly. */
function revealVideo() {
  video.style.display = 'block';
}

function show(index) {
  const recipe = recipes[index];
  if (!recipe) return;
  shown = index;
  const url = loadingPlateUrl(recipe.theme, recipe.timeOfDay);
  stage.style.backgroundImage = url ? `url("${url}")` : '';
  const loop = videoOf(url);
  const token = ++videoToken;
  const playing = () => token === videoToken && !!loop && video.getAttribute('src') === loop && video.readyState >= 2;
  const showLoop = () => {
    if (!playing()) return;
    revealVideo();
    const pending = video.play();
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    writeCaption(recipe, true);
  };
  video.onloadeddata = () => showLoop();
  video.onerror = () => {
    if (token !== videoToken) return;
    hideVideo();
    video.removeAttribute('src');
    writeCaption(recipe, false);
  };
  if (!loop) {
    hideVideo();
    video.removeAttribute('src');
  } else if (video.getAttribute('src') !== loop) {
    hideVideo();
    video.setAttribute('src', loop);
    video.load();
  } else {
    showLoop();
  }
  writeCaption(recipe, playing() || loopKnown.get(loop) === true);
  if (recipe.kind) {
    canvas.style.display = '';
    mountPlateWeather(canvas, recipe.kind, index + 1);
  } else {
    stopPlateWeather();
    canvas.style.display = 'none';
    /* A canvas the curtain worker owns is cleared by stopPlateWeather. */
    const ctx = isOffthreadCanvas(canvas) ? null : canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  for (const btn of list.querySelectorAll('button')) {
    btn.classList.toggle('on', Number(btn.dataset.index) === index);
  }
  const on = list.querySelector('button.on');
  if (on && typeof on.scrollIntoView === 'function') on.scrollIntoView({ block: 'nearest' });
}

function paintList() {
  const q = (filter.value || '').trim().toLowerCase();
  list.innerHTML = '';
  let n = 0;
  let lastTheme = '';
  recipes.forEach((recipe, index) => {
    const hay = `${recipe.theme} ${recipe.timeOfDay} ${recipe.weather} ${recipe.kind}`.toLowerCase();
    if (q && !hay.includes(q)) return;
    n += 1;
    if (recipe.theme !== lastTheme) {
      lastTheme = recipe.theme;
      const h = document.createElement('h2');
      h.textContent = recipe.theme;
      list.appendChild(h);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.index = String(index);
    const when = [recipe.timeOfDay, recipe.weather].filter(Boolean).join(' · ');
    const mp4 = videoOf(loadingPlateUrl(recipe.theme, recipe.timeOfDay));
    const hasLoop = loopKnown.get(mp4) === true;
    btn.textContent = (when || 'dungeon') + (hasLoop ? ' · loop' : '');
    if (recipe.kind) btn.dataset.kind = recipe.kind;
    if (hasLoop) btn.dataset.loop = '1';
    if (index === shown) btn.classList.add('on');
    btn.addEventListener('click', () => show(index));
    list.appendChild(btn);
  });
  count.textContent = `${n} of ${recipes.length}`;
}

filter.addEventListener('input', paintList);
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
  if (ev.target === filter) return;
  const step = ev.key === 'ArrowRight' ? 1 : -1;
  const next = (shown + step + recipes.length) % recipes.length;
  show(next);
});

paintList();
show(0);

const plateUrls = [...new Set(recipes.map((recipe) => videoOf(loadingPlateUrl(recipe.theme, recipe.timeOfDay))).filter(Boolean))];
Promise.all(plateUrls.map(async (mp4) => {
  try {
    const res = await fetch(mp4, { method: 'HEAD' });
    loopKnown.set(mp4, res.ok);
  } catch (e) {
    loopKnown.set(mp4, false);
  }
})).then(() => {
  paintList();
  const recipe = recipes[shown];
  if (!recipe) return;
  const mp4 = videoOf(loadingPlateUrl(recipe.theme, recipe.timeOfDay));
  writeCaption(recipe, loopKnown.get(mp4) === true || video.style.display === 'block');
});
