/**
 * WORLD MAP BIOME PAINTER (dev tool, world_map_editor.html)
 *
 * Paints src/game/world_biomes.json: one biome letter per cell over the world
 * map art. Saving goes through the dev server (/api/save-world-biomes in
 * vite.config.js), so it only works under `npm run dev`.
 *
 * The cell layer lives in an offscreen canvas at one pixel per cell, drawn
 * scaled up with smoothing off over the art; every edit just rewrites the
 * pixels it touched.
 */

import { WORLD, IMPASSABLE, MIN_DOORSTEP_CELLS, THEMES_ON_GROUND, DUNGEON_SITES } from './game/world_regions.js';

/* Saving rewrites world_biomes.json, which world_regions.js imports. Accepting
   the update here stops Vite reloading the page (and wiping undo) on every save. */
if (import.meta.hot) import.meta.hot.accept('./game/world_regions.js', () => {});

/* Paint colours are chosen to tell the twelve apart on the art, not the
   biomes' in-game `accent`s: several accents are near-identical greens and oranges. */
const PAINT = {
  forest: '#2e7d32', sporewood: '#aa50dc', moor: '#bea05a', mire: '#3c968c',
  holdfast: '#f0c83c', boneyard: '#c8c8c8', ruinfield: '#e67828', ashfield: '#c82828',
  snowfield: '#96dcff', sea: '#1e3ca0', lake: '#3c78dc', peaks: '#3c3c3c'
};
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
const UNDO_LIMIT = 200;

const { cols, rows, legend } = WORLD;
const letterOf = Object.fromEntries(Object.entries(legend).map(([ch, b]) => [b, ch]));
const biomes = Object.values(legend);
let cells = WORLD.cells.map(row => row.split(''));

const state = {
  biome: 'forest', tool: 'brush', brush: 3, opacity: 0.5,
  grid: false, solo: false, overlay: true, dirty: false,
  view: { scale: 1, ox: 0, oy: 0 },
  hover: null, drag: null, space: false
};
const undoStack = [], redoStack = [];

const $ = id => document.getElementById(id);
const canvas = $('view');
const ctx = canvas.getContext('2d');
const layer = document.createElement('canvas');
layer.width = cols; layer.height = rows;
const lctx = layer.getContext('2d');
const art = new Image();
art.src = './' + WORLD.art.src;
const cellPx = WORLD.art.w / cols;               // art px per cell (square cells)

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
const PAINT_RGB = Object.fromEntries(Object.entries(PAINT).map(([b, h]) => [b, rgb(h)]));

/* ---------- cell layer ---------- */

function redrawLayer() {
  const img = lctx.createImageData(cols, rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const b = legend[cells[r][c]];
      if (state.solo && b !== state.biome) continue;
      const [R, G, B] = PAINT_RGB[b];
      const i = (r * cols + c) * 4;
      img.data[i] = R; img.data[i + 1] = G; img.data[i + 2] = B; img.data[i + 3] = 255;
    }
  }
  lctx.putImageData(img, 0, 0);
}

function snapshot() { return cells.map(row => row.join('')); }
function restore(snap) { cells = snap.map(row => row.split('')); }

/** Record `before` (a snapshot taken ahead of the edit) as one undo step. */
function commit(before) {
  undoStack.push(before);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  markDirty();
}

function markDirty() {
  state.dirty = true;
  $('save').classList.add('dirty');
  redrawLayer(); renderCoverage(); draw();
}

function setCell(c, r, ch) {
  if (c < 0 || r < 0 || c >= cols || r >= rows || cells[r][c] === ch) return false;
  cells[r][c] = ch;
  return true;
}

function paintBrush(cc, cr) {
  const ch = letterOf[state.biome];
  const rad = state.brush / 2;
  let changed = false;
  for (let r = Math.floor(cr - rad); r <= Math.ceil(cr + rad); r++) {
    for (let c = Math.floor(cc - rad); c <= Math.ceil(cc + rad); c++) {
      // Size 1 is exactly one cell; larger sizes are a disc of that diameter.
      if (state.brush > 1 && (c - cc) ** 2 + (r - cr) ** 2 > rad * rad) continue;
      if (state.brush === 1 && (c !== cc || r !== cr)) continue;
      changed = setCell(c, r, ch) || changed;
    }
  }
  return changed;
}

function floodFill(c0, r0) {
  const from = cells[r0][c0], to = letterOf[state.biome];
  if (from === to) return false;
  const stack = [[c0, r0]];
  while (stack.length) {
    const [c, r] = stack.pop();
    if (c < 0 || r < 0 || c >= cols || r >= rows || cells[r][c] !== from) continue;
    cells[r][c] = to;
    stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
  }
  return true;
}

function fillRect(a, b) {
  const ch = letterOf[state.biome];
  let changed = false;
  for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) {
    for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) changed = setCell(c, r, ch) || changed;
  }
  return changed;
}

/* ---------- view ---------- */

function fitView() {
  const { width: W, height: H } = canvas;
  const s = Math.min(W / WORLD.art.w, H / WORLD.art.h) * 0.98;
  state.view = { scale: s, ox: (W - WORLD.art.w * s) / 2, oy: (H - WORLD.art.h * s) / 2 };
}

function resize() {
  const main = $('main');
  canvas.width = main.clientWidth; canvas.height = main.clientHeight;
  fitView(); draw();
}

function screenToCell(x, y) {
  const { scale, ox, oy } = state.view;
  const ax = (x - ox) / scale, ay = (y - oy) / scale;
  const c = Math.floor(ax / cellPx), r = Math.floor(ay / cellPx);
  return (c >= 0 && r >= 0 && c < cols && r < rows) ? { c, r } : null;
}

function draw() {
  const { scale, ox, oy } = state.view;
  const W = WORLD.art.w * scale, H = WORLD.art.h * scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (art.complete) ctx.drawImage(art, ox, oy, W, H);
  if (state.overlay) {
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = state.opacity;
    ctx.drawImage(layer, ox, oy, W, H);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
  }
  const cs = cellPx * scale;
  if (state.grid && cs >= 4) {
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= cols; c++) { ctx.moveTo(ox + c * cs + .5, oy); ctx.lineTo(ox + c * cs + .5, oy + H); }
    for (let r = 0; r <= rows; r++) { ctx.moveTo(ox, oy + r * cs + .5); ctx.lineTo(ox + W, oy + r * cs + .5); }
    ctx.stroke();
  }
  // Tool cursor: brush footprint, or the rectangle being dragged.
  const h = state.hover;
  ctx.strokeStyle = '#fcd34d'; ctx.lineWidth = 1.5;
  if (state.drag?.kind === 'rect') {
    const a = state.drag.start, b = h || a;
    const c0 = Math.min(a.c, b.c), r0 = Math.min(a.r, b.r);
    ctx.strokeRect(ox + c0 * cs, oy + r0 * cs, (Math.abs(a.c - b.c) + 1) * cs, (Math.abs(a.r - b.r) + 1) * cs);
  } else if (h && state.tool === 'brush') {
    ctx.beginPath();
    if (state.brush === 1) ctx.rect(ox + h.c * cs, oy + h.r * cs, cs, cs);
    else ctx.arc(ox + (h.c + .5) * cs, oy + (h.r + .5) * cs, state.brush / 2 * cs, 0, Math.PI * 2);
    ctx.stroke();
  } else if (h) {
    ctx.strokeRect(ox + h.c * cs, oy + h.r * cs, cs, cs);
  }
}

/* ---------- panel ---------- */

/** Dungeon themes that can sit on biome `b`, e.g. "verdant, ancient"; '' for travel-only ground. */
const sitesOn = b => (THEMES_ON_GROUND[b] || []).join(', ');

function renderPalette() {
  $('palette').innerHTML = '';
  biomes.forEach((b, i) => {
    const btn = document.createElement('button');
    btn.className = 'swatch' + (b === state.biome ? ' active' : '') + (sitesOn(b) ? ' doorstep' : '');
    btn.title = sitesOn(b) ? `${sitesOn(b)} dungeons can sit here`
      : IMPASSABLE.has(b) ? 'Impassable' : 'Travel country';
    btn.innerHTML = `<span class="chip" style="background:${PAINT[b]}"></span><span class="name">${b}</span><span class="key">${KEYS[i] ?? ''}</span>`;
    btn.onclick = () => selectBiome(b);
    $('palette').appendChild(btn);
  });
}

function renderCoverage() {
  const counts = Object.fromEntries(biomes.map(b => [b, 0]));
  for (const row of cells) for (const ch of row) counts[legend[ch]]++;
  const biomeRows = biomes.map(b =>
    `<tr><td><span style="color:${PAINT[b]}">■</span> ${b}</td>` +
    `<td class="theme">${sitesOn(b) ? '⌂ ' + sitesOn(b) : IMPASSABLE.has(b) ? 'impassable' : ''}</td>` +
    `<td class="n">${counts[b]}</td></tr>`).join('');
  /* Per dungeon theme: all the ground it can sit on, summed. This is what
     placement draws from, so this is where the starvation warning belongs. */
  const themeRows = Object.entries(DUNGEON_SITES).map(([theme, sites]) => {
    const n = sites.reduce((s, b) => s + (counts[b] || 0), 0);
    const warn = n < MIN_DOORSTEP_CELLS;
    return `<tr class="${warn ? 'warn' : ''}"><td>⌂ ${theme}</td><td class="theme">${sites.join(' + ')}</td>` +
      `<td class="n">${n}${warn ? ' (low)' : ''}</td></tr>`;
  }).join('');
  $('coverage').innerHTML = biomeRows + `<tr><td colspan="3"><h2 style="margin:8px 0 2px">Dungeon ground</h2></td></tr>` + themeRows;
}

function renderReadout() {
  const h = state.hover;
  if (!h) { $('readout').textContent = ''; return; }
  const b = legend[cells[h.r][h.c]];
  const x = ((h.c + .5) / cols * 100).toFixed(1), y = ((h.r + .5) / rows * 100).toFixed(1);
  const role = sitesOn(b) ? ` · ${sitesOn(b)} dungeons` : IMPASSABLE.has(b) ? ' · impassable' : '';
  $('readout').textContent = `cell ${h.c}, ${h.r} · ${x}%, ${y}% · ${b}${role}`;
}

function setStatus(text, cls = '') { $('status').textContent = text; $('status').className = cls; }

function selectBiome(b) {
  state.biome = b;
  renderPalette();
  if (state.solo) { redrawLayer(); draw(); }
}

function selectTool(t) {
  state.tool = t;
  document.querySelectorAll('#tools button').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === t));
  draw();
}

function setBrush(n) {
  state.brush = Math.max(1, Math.min(8, n));
  $('brush').value = state.brush; $('brushVal').textContent = state.brush;
  draw();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot()); restore(undoStack.pop()); markDirty();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot()); restore(redoStack.pop()); markDirty();
}

async function save() {
  setStatus('Saving…');
  try {
    const res = await fetch('/api/save-world-biomes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...WORLD, cells: snapshot() })
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.success) throw new Error(out.error || `HTTP ${res.status} (is the dev server running?)`);
    state.dirty = false;
    $('save').classList.remove('dirty');
    setStatus('Saved world_biomes.json', 'ok');
  } catch (err) {
    setStatus('Save failed: ' + err.message, 'err');
  }
}

/* ---------- input ---------- */

function pointer(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('pointerdown', e => {
  const p = pointer(e);
  canvas.setPointerCapture(e.pointerId);
  if (e.button === 1 || (e.button === 0 && state.space)) {
    state.drag = { kind: 'pan', x: p.x, y: p.y, ox: state.view.ox, oy: state.view.oy };
    return;
  }
  const cell = screenToCell(p.x, p.y);
  if (!cell) return;
  if (e.button === 2 || state.tool === 'pick' || e.altKey) {
    selectBiome(legend[cells[cell.r][cell.c]]);
    return;
  }
  if (e.button !== 0) return;
  if (state.tool === 'fill') {
    const before = snapshot();
    if (floodFill(cell.c, cell.r)) commit(before);
  } else if (state.tool === 'rect') {
    state.drag = { kind: 'rect', start: cell };
    draw();
  } else {
    state.drag = { kind: 'brush', before: snapshot(), changed: paintBrush(cell.c, cell.r), last: cell };
    if (state.drag.changed) { redrawLayer(); draw(); }
  }
});

canvas.addEventListener('pointermove', e => {
  const p = pointer(e);
  const d = state.drag;
  if (d?.kind === 'pan') {
    state.view.ox = d.ox + p.x - d.x; state.view.oy = d.oy + p.y - d.y;
    draw(); return;
  }
  state.hover = screenToCell(p.x, p.y);
  if (d?.kind === 'brush' && state.hover) {
    // Step along the line from the last cell so a fast stroke leaves no gaps.
    const { c: c0, r: r0 } = d.last, { c: c1, r: r1 } = state.hover;
    const steps = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0), 1);
    for (let i = 1; i <= steps; i++) {
      const c = Math.round(c0 + (c1 - c0) * i / steps), r = Math.round(r0 + (r1 - r0) * i / steps);
      d.changed = paintBrush(c, r) || d.changed;
    }
    d.last = state.hover;
    redrawLayer();
  }
  renderReadout(); draw();
});

canvas.addEventListener('pointerup', () => {
  const d = state.drag;
  state.drag = null;
  if (d?.kind === 'brush' && d.changed) {
    commit(d.before);
  } else if (d?.kind === 'rect' && state.hover) {
    const before = snapshot();
    if (fillRect(d.start, state.hover)) commit(before);
  }
  draw();
});

canvas.addEventListener('pointerleave', () => { state.hover = null; renderReadout(); draw(); });

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const p = pointer(e);
  const v = state.view;
  const k = Math.exp(-e.deltaY * 0.0015);
  const s = Math.max(0.1, Math.min(4, v.scale * k));
  v.ox = p.x - (p.x - v.ox) * s / v.scale;
  v.oy = p.y - (p.y - v.oy) * s / v.scale;
  v.scale = s;
  draw();
}, { passive: false });

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (ctrl) return;
  if (e.key === ' ') { state.space = true; e.preventDefault(); return; }
  const i = KEYS.indexOf(e.key);
  if (i >= 0 && biomes[i]) { selectBiome(biomes[i]); return; }
  switch (e.key.toLowerCase()) {
    case 'b': selectTool('brush'); break;
    case 'f': selectTool('fill'); break;
    case 'r': selectTool('rect'); break;
    case 'i': selectTool('pick'); break;
    case '[': setBrush(state.brush - 1); break;
    case ']': setBrush(state.brush + 1); break;
    case 'g': $('grid').checked = state.grid = !state.grid; draw(); break;
    case 's': $('solo').checked = state.solo = !state.solo; redrawLayer(); draw(); break;
    case 'o': $('overlay').checked = state.overlay = !state.overlay; draw(); break;
    case 'h': fitView(); draw(); break;
  }
});
window.addEventListener('keyup', e => { if (e.key === ' ') state.space = false; });

window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('resize', resize);

$('brush').oninput = e => setBrush(+e.target.value);
$('opacity').oninput = e => { state.opacity = e.target.value / 100; $('opacityVal').textContent = e.target.value + '%'; draw(); };
$('grid').onchange = e => { state.grid = e.target.checked; draw(); };
$('solo').onchange = e => { state.solo = e.target.checked; redrawLayer(); draw(); };
$('overlay').onchange = e => { state.overlay = e.target.checked; draw(); };
$('undo').onclick = undo;
$('redo').onclick = redo;
$('save').onclick = save;
document.querySelectorAll('#tools button').forEach(btn => { btn.onclick = () => selectTool(btn.dataset.tool); });

art.onload = draw;
art.onerror = () => setStatus(`Could not load ${WORLD.art.src}`, 'err');
renderPalette(); selectTool('brush'); redrawLayer(); renderCoverage(); resize();
