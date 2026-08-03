/**
 * Sound Editor — review and wire every sound in the game.
 *
 * Companion to the bestiary and loot editor, over the same data-file pattern:
 * the registry lives in src/game/sounds.json, audio.js imports it, and this
 * tool edits it and writes it back through the vite dev middleware
 * /api/save-sounds.
 *
 * The four tabs answer the four questions an audio pass actually asks:
 *   Slots      — what sounds exist, which are still placeholders, what plays
 *                in their place, and which abilities depend on each one
 *   Abilities  — does every spell / feature / boss spell point somewhere sane
 *   Routing    — per-class cantrips and monster damage-type fallbacks
 *   Library    — what is on disk: orphaned files, and slots pointing at files
 *                that aren't there
 *
 * Preview playback deliberately does NOT go through audio.js playSfx(): that
 * reads the registry as it was at import time, so it could not hear unsaved
 * edits. This plays the resolved file directly, with the same playback-rate
 * jitter and squared volume curve the game uses, so a preview matches what
 * the dungeon will sound like.
 */

import SOUNDS_ON_DISK from './game/sounds.json';
import { ABILITY_FX } from './game/combat.js';
import { SPELLS } from './game/spells.js';
import { BOSS_SPELL_FX } from './game/monster_ai.js';

const SFX_DIR = 'sounds/';
const LS_DRAFT = 'dc_sound_editor_draft';

/* ── state ──────────────────────────────────────────────────────────── */

let DATA = null;            // working copy of sounds.json
let LIBRARY = [];           // [{ path, size }] from /api/list-sounds
let libraryLoaded = false;  // false when the dev middleware isn't reachable
let selectedSlot = null;
let dirty = false;
let previewVol = 0.8;

const $ = id => document.getElementById(id);
const clone = o => JSON.parse(JSON.stringify(o));

/* Where each ability key comes from, for the Abilities tab's Source column.
   A key can be several things at once (most boss spells are player spells
   too), so the label lists them in specificity order. */
const ABILITY_SOURCES = (() => {
  const src = {};
  const add = (k, tag) => { (src[k] = src[k] || []).push(tag); };
  for (const k of Object.keys(ABILITY_FX)) add(k, 'feature');
  for (const k of Object.keys(SPELLS)) add(k, 'spell');
  for (const k of Object.keys(BOSS_SPELL_FX)) add(k, 'boss');
  /* ABILITY_FX holds both features and spells — a key that is also in SPELLS
     is a spell with FX, not a class feature. */
  for (const k of Object.keys(src)) {
    if (src[k].includes('spell')) src[k] = src[k].filter(t => t !== 'feature');
  }
  return src;
})();

const ALL_ABILITY_KEYS = Object.keys(ABILITY_SOURCES).sort();

const CATEGORY_LABELS = {
  melee: 'Melee', ranged: 'Ranged', world: 'World & Props',
  element: 'Elemental', school: 'Magic Schools', support: 'Support & Martial',
  cantrip: 'Class Cantrips', skill: 'Skill Challenges', other: 'Other',
};

/* ── registry helpers (mirror audio.js resolution) ───────────────────── */

function slotOf(name) { return DATA.slots[name] || null; }

/** Files a slot ends up playing, following its fallback chain. */
function resolveFiles(name) {
  const seen = new Set();
  let n = name;
  while (n && !seen.has(n)) {
    seen.add(n);
    const s = slotOf(n);
    if (!s) return { files: [], via: null, broken: true };
    if (s.files && s.files.length) return { files: s.files, via: n, broken: false };
    n = s.fallback;
  }
  return { files: [], via: null, broken: false };
}

function fileExists(p) { return !libraryLoaded || LIBRARY.some(f => f.path === p); }

/** recorded | fallback | silent | broken */
function slotStatus(name) {
  const s = slotOf(name);
  if (!s) return 'broken';
  if (s.files && s.files.length) {
    return s.files.some(f => !fileExists(f)) ? 'broken' : 'recorded';
  }
  const r = resolveFiles(name);
  if (r.broken) return 'broken';
  return r.files.length ? 'fallback' : 'silent';
}

const STATUS_LABEL = {
  recorded: 'recorded', fallback: 'placeholder', silent: 'silent', broken: 'broken',
};

/** Ability keys routed to a slot, directly or through a fallback chain. */
function usersOfSlot(name) {
  const direct = [], indirect = [];
  for (const [key, slot] of Object.entries(DATA.abilities)) {
    if (slot === name) direct.push(key);
    else if (resolveFiles(slot).via === name) indirect.push(key);
  }
  return { direct: direct.sort(), indirect: indirect.sort() };
}

function slotNames() { return Object.keys(DATA.slots); }

/* ── preview playback ────────────────────────────────────────────────── */

let currentAudio = null;

function stopPreview() {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
}

/** Play one file exactly as the game would: random rate jitter, volume². */
function playFile(path, { jitter = true } = {}) {
  stopPreview();
  const a = new Audio(encodeURI(SFX_DIR + path));
  a.volume = previewVol * previewVol;
  if (jitter) a.playbackRate = 0.94 + Math.random() * 0.12;
  a.addEventListener('error', () => toast(`Could not play ${path}`, true));
  a.play().catch(() => toast('Click the page once, then press play again'));
  currentAudio = a;
}

/** Play what a slot resolves to right now (random variant, like the game). */
function playSlot(name) {
  const r = resolveFiles(name);
  if (!r.files.length) {
    toast(slotStatus(name) === 'broken'
      ? `${name} points at a missing file`
      : `${name} is silent — no audio and no fallback`, true);
    return;
  }
  playFile(r.files[(Math.random() * r.files.length) | 0]);
}

/* ── save / load ─────────────────────────────────────────────────────── */

function markDirty() {
  dirty = true;
  try { localStorage.setItem(LS_DRAFT, JSON.stringify(DATA)); } catch { /* private mode */ }
  renderStats();
}

async function loadLibrary() {
  try {
    const res = await fetch('/api/list-sounds');
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    LIBRARY = json.files;
    libraryLoaded = true;
  } catch {
    /* Opened without the vite dev server: everything still works except the
       file picker and the missing/orphan checks, which need a disk listing. */
    LIBRARY = [];
    libraryLoaded = false;
  }
}

async function save() {
  try {
    const res = await fetch('/api/save-sounds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(DATA),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    dirty = false;
    try { localStorage.removeItem(LS_DRAFT); } catch { /* ignore */ }
    renderStats();
    toast('Saved to src/game/sounds.json — reload the game to hear it');
  } catch (e) {
    toast(`Save failed: ${e.message} (is the dev server running?)`, true);
  }
}

function exportJson() {
  const blob = new Blob([JSON.stringify(DATA, null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sounds.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function revert() {
  if (dirty && !confirm('Discard unsaved changes and reload the registry from disk?')) return;
  DATA = clone(SOUNDS_ON_DISK);
  dirty = false;
  try { localStorage.removeItem(LS_DRAFT); } catch { /* ignore */ }
  renderAll();
  toast('Reverted to the saved registry');
}

/* ── header stats ────────────────────────────────────────────────────── */

function renderStats() {
  const counts = { recorded: 0, fallback: 0, silent: 0, broken: 0 };
  for (const name of slotNames()) counts[slotStatus(name)]++;
  const unmapped = ALL_ABILITY_KEYS.filter(k => !DATA.abilities[k]).length;
  const orphans = libraryLoaded
    ? LIBRARY.filter(f => !slotNames().some(n => DATA.slots[n].files.includes(f.path))).length
    : 0;

  const chip = (cls, label, val) => `<span class="stat-chip ${cls}">${label} <b>${val}</b></span>`;
  $('stat-chips').innerHTML = [
    chip('ok', 'recorded', counts.recorded),
    chip(counts.fallback ? 'warn' : 'ok', 'placeholder', counts.fallback),
    chip('', 'silent', counts.silent),
    counts.broken ? chip('bad', 'broken', counts.broken) : '',
    unmapped ? chip('bad', 'unmapped abilities', unmapped) : chip('ok', 'abilities', ALL_ABILITY_KEYS.length),
    libraryLoaded && orphans ? chip('warn', 'unused files', orphans) : '',
    dirty ? '<span class="stat-chip warn"><b>unsaved</b></span>' : '',
  ].join('');
}

/* ── slots tab ───────────────────────────────────────────────────────── */

function renderSlotList() {
  const q = $('slot-search').value.trim().toLowerCase();
  const cat = $('slot-filter-cat').value;
  const status = $('slot-filter-status').value;

  const groups = {};
  for (const name of slotNames()) {
    const s = DATA.slots[name];
    const st = slotStatus(name);
    if (q && !name.toLowerCase().includes(q) && !(s.note || '').toLowerCase().includes(q)) continue;
    if (cat && s.category !== cat) continue;
    if (status && st !== status) continue;
    (groups[s.category] = groups[s.category] || []).push({ name, st });
  }

  const order = ['melee', 'ranged', 'world', 'element', 'school', 'support', 'cantrip', 'skill', 'other'];
  const cats = Object.keys(groups).sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  if (!cats.length) {
    $('slot-list').innerHTML = '<div class="list-group-label">No slots match</div>';
    return;
  }

  $('slot-list').innerHTML = cats.map(c => `
    <div class="list-group-label">${CATEGORY_LABELS[c] || c}</div>
    ${groups[c].map(({ name, st }) => {
      const n = DATA.slots[name].files.length;
      return `<div class="slot-entry ${name === selectedSlot ? 'selected' : ''}" data-slot="${name}">
        <span class="dot ${st}" title="${STATUS_LABEL[st]}"></span>
        <span class="name">${name}</span>
        <span class="count">${n ? `${n} file${n > 1 ? 's' : ''}` : STATUS_LABEL[st]}</span>
      </div>`;
    }).join('')}
  `).join('');

  for (const el of $('slot-list').querySelectorAll('.slot-entry')) {
    el.onclick = () => { selectedSlot = el.dataset.slot; renderSlotList(); renderSlotDetail(); };
  }
}

function renderSlotDetail() {
  const box = $('slot-detail');
  if (!selectedSlot || !slotOf(selectedSlot)) {
    box.innerHTML = `<div class="panel"><h3>Sound slots</h3>
      <p class="hint">Pick a slot on the left. Green means real audio is on disk, amber means the slot
      is declared but still borrowing another sound, grey means deliberately silent, red means it points
      at a file that isn't there.</p></div>`;
    return;
  }

  const name = selectedSlot;
  const s = DATA.slots[name];
  const st = slotStatus(name);
  const r = resolveFiles(name);
  const users = usersOfSlot(name);

  const resolvedLine = st === 'recorded'
    ? `Plays its own audio — ${s.files.length} variant${s.files.length > 1 ? 's' : ''}.`
    : st === 'fallback'
      ? `No audio yet — currently borrowing <b class="mono">${r.via}</b>.`
      : st === 'silent'
        ? 'No audio and no fallback — plays nothing at all.'
        : 'Points at a file that is not on disk.';

  const otherSlots = slotNames().filter(n => n !== name);

  box.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div style="display:flex;align-items:center;gap:12px">
          <span class="slot-title">${name}</span>
          <span class="badge ${st}">${STATUS_LABEL[st]}</span>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn" id="d-play">▶ Play</button>
          <button class="btn btn-danger btn-xs" id="d-delete">Delete slot</button>
        </div>
      </div>
      <p class="hint" style="margin-bottom:14px">${resolvedLine}</p>
      <div class="field-grid">
        <div class="field">
          <label>Category</label>
          <select class="form-input" id="d-cat">
            ${Object.entries(CATEGORY_LABELS).map(([k, v]) =>
              `<option value="${k}" ${s.category === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Fallback while unrecorded</label>
          <select class="form-input" id="d-fallback">
            <option value="">— none (silent) —</option>
            ${otherSlots.map(n => `<option value="${n}" ${s.fallback === n ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field">
        <label>Note — what this sound should be</label>
        <input class="form-input" id="d-note" type="text" value="${escapeAttr(s.note || '')}"
               placeholder="e.g. crack plus rolling thunder">
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Audio variants</h3>
        <button class="btn btn-xs" id="d-add">＋ Add file</button>
      </div>
      ${s.files.length ? s.files.map((f, i) => `
        <div class="file-row ${fileExists(f) ? '' : 'missing'}">
          <button class="btn-icon" data-play="${i}" title="Play this variant">▶</button>
          <span class="path">${f}${fileExists(f) ? '' : ' — missing'}</span>
          <button class="btn-icon" data-up="${i}" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn-icon" data-rm="${i}" title="Remove">✖</button>
        </div>`).join('')
      : `<div class="empty-note ${st === 'silent' ? 'silent' : ''}">
          ${st === 'silent'
            ? 'Declared but silent on purpose. The game already calls this slot by name — give it files, or a fallback above, whenever you want it audible.'
            : `Declared but unrecorded. Drop files under <span class="mono">public/sounds/</span>, then add them here — every call site already asks for <span class="mono">${name}</span>, so nothing else has to change.`}
        </div>`}
      ${!libraryLoaded ? '<p class="hint" style="margin-top:10px">Run <span class="mono">npm run dev</span> to browse files from disk.</p>' : ''}
    </div>

    <div class="panel">
      <h3>Used by ${users.direct.length + users.indirect.length} abilit${users.direct.length + users.indirect.length === 1 ? 'y' : 'ies'}</h3>
      ${users.direct.length
        ? `<div class="chip-row">${users.direct.map(k => `<span class="chip" data-ab="${k}">${k}</span>`).join('')}</div>`
        : '<p class="hint">No spell or ability routes here directly.</p>'}
      ${users.indirect.length ? `
        <p class="hint" style="margin:12px 0 6px">Also heard here while their own slot is unrecorded:</p>
        <div class="chip-row">${users.indirect.map(k => `<span class="chip" data-ab="${k}">${k}</span>`).join('')}</div>` : ''}
    </div>`;

  /* wiring */
  $('d-play').onclick = () => playSlot(name);
  $('d-cat').onchange = e => { s.category = e.target.value; markDirty(); renderSlotList(); };
  $('d-note').oninput = e => { s.note = e.target.value; markDirty(); };
  $('d-fallback').onchange = e => {
    const target = e.target.value || null;
    if (target && createsCycle(name, target)) {
      toast(`${target} already falls back to ${name} — that would loop`, true);
      e.target.value = s.fallback || '';
      return;
    }
    s.fallback = target;
    markDirty(); renderSlotList(); renderSlotDetail();
  };
  $('d-delete').onclick = () => deleteSlot(name);
  $('d-add').onclick = () => openPicker(name);

  for (const el of box.querySelectorAll('[data-play]')) {
    el.onclick = () => playFile(s.files[+el.dataset.play]);
  }
  for (const el of box.querySelectorAll('[data-rm]')) {
    el.onclick = () => { s.files.splice(+el.dataset.rm, 1); markDirty(); renderSlotList(); renderSlotDetail(); };
  }
  for (const el of box.querySelectorAll('[data-up]')) {
    el.onclick = () => {
      const i = +el.dataset.up;
      [s.files[i - 1], s.files[i]] = [s.files[i], s.files[i - 1]];
      markDirty(); renderSlotDetail();
    };
  }
  for (const el of box.querySelectorAll('[data-ab]')) {
    el.onclick = () => {
      switchTab('page-abilities');
      $('ab-search').value = el.dataset.ab;
      renderAbilityTable();
    };
  }
}

function createsCycle(from, to) {
  const seen = new Set([from]);
  let n = to;
  while (n) {
    if (seen.has(n)) return true;
    seen.add(n);
    const s = slotOf(n);
    if (!s || (s.files && s.files.length)) return false;
    n = s.fallback;
  }
  return false;
}

function newSlot() {
  const name = (prompt('New slot name (camelCase, e.g. spellRadiant):') || '').trim();
  if (!name) return;
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) { toast('Use a camelCase identifier — no spaces or dashes', true); return; }
  if (DATA.slots[name]) { toast(`${name} already exists`, true); return; }
  DATA.slots[name] = { category: 'other', files: [], fallback: null, note: '' };
  selectedSlot = name;
  markDirty(); renderAll();
  toast(`Declared ${name}. Give it files or a fallback, then route abilities to it.`);
}

function deleteSlot(name) {
  const users = usersOfSlot(name);
  const routed = [
    ...users.direct,
    ...Object.entries(DATA.cantrips).filter(([, v]) => v === name).map(([k]) => `cantrip:${k}`),
    ...Object.entries(DATA.damageTypes).filter(([, v]) => v === name).map(([k]) => `dmgType:${k}`),
  ];
  const fallbackUsers = slotNames().filter(n => DATA.slots[n].fallback === name);
  if (routed.length || fallbackUsers.length) {
    toast(`Still referenced by ${[...routed, ...fallbackUsers].slice(0, 3).join(', ')}${routed.length + fallbackUsers.length > 3 ? '…' : ''} — repoint those first`, true);
    return;
  }
  if (!confirm(`Delete slot ${name}?\n\nThe game will fall silent anywhere its name is still hard-coded in a playSfx() call.`)) return;
  delete DATA.slots[name];
  selectedSlot = null;
  markDirty(); renderAll();
}

/* ── abilities tab ───────────────────────────────────────────────────── */

function renderAbilityTable() {
  const q = $('ab-search').value.trim().toLowerCase();
  const fSource = $('ab-filter-source').value;
  const fStatus = $('ab-filter-status').value;
  const fSlot = $('ab-filter-slot').value;

  const rows = ALL_ABILITY_KEYS.filter(k => {
    const slot = DATA.abilities[k];
    if (q && !k.toLowerCase().includes(q)) return false;
    if (fSource && !ABILITY_SOURCES[k].includes(fSource)) return false;
    if (fSlot && slot !== fSlot) return false;
    if (fStatus && (!slot || slotStatus(slot) !== fStatus)) return false;
    return true;
  });

  const SOURCE_LABEL = { feature: 'Class feature', spell: 'Spell', boss: 'Boss spell' };
  const opts = sel => slotNames().map(n =>
    `<option value="${n}" ${n === sel ? 'selected' : ''}>${n}</option>`).join('');

  $('ab-count').textContent =
    `${rows.length} of ${ALL_ABILITY_KEYS.length} shown` +
    (ALL_ABILITY_KEYS.some(k => !DATA.abilities[k]) ? ' · ⚠ some abilities have no slot' : '');

  $('ab-table').innerHTML = `
    <thead><tr>
      <th style="width:38px"></th><th>Ability</th><th style="width:150px">Source</th>
      <th style="width:190px">Sound slot</th><th style="width:110px">State</th><th>Actually plays</th>
    </tr></thead>
    <tbody>${rows.map(k => {
      const slot = DATA.abilities[k];
      const st = slot ? slotStatus(slot) : 'broken';
      const r = slot ? resolveFiles(slot) : { via: null };
      const plays = !slot ? '<span style="color:var(--red)">no slot assigned</span>'
        : st === 'recorded' ? `<span class="muted">${slot}</span>`
        : st === 'fallback' ? `<span style="color:var(--amber)">${r.via}</span> <span class="muted">(placeholder)</span>`
        : st === 'silent' ? '<span class="muted">nothing</span>'
        : '<span style="color:var(--red)">missing file</span>';
      return `<tr>
        <td><button class="btn-icon" data-play-ab="${k}" title="Play what this ability sounds like">▶</button></td>
        <td class="mono">${k}</td>
        <td class="muted">${ABILITY_SOURCES[k].map(t => SOURCE_LABEL[t]).join(' · ')}</td>
        <td><select class="row-select" data-slot-for="${k}">
          <option value="">— none —</option>${opts(slot)}
        </select></td>
        <td><span class="badge ${st}">${STATUS_LABEL[st]}</span></td>
        <td class="mono">${plays}</td>
      </tr>`;
    }).join('')}</tbody>`;

  for (const el of $('ab-table').querySelectorAll('[data-play-ab]')) {
    el.onclick = () => {
      const slot = DATA.abilities[el.dataset.playAb];
      if (!slot) { toast(`${el.dataset.playAb} has no slot assigned`, true); return; }
      playSlot(slot);
    };
  }
  for (const el of $('ab-table').querySelectorAll('[data-slot-for]')) {
    el.onchange = () => {
      const k = el.dataset.slotFor;
      if (el.value) DATA.abilities[k] = el.value;
      else delete DATA.abilities[k];
      markDirty(); renderAbilityTable();
    };
  }
}

/* ── routing tab ─────────────────────────────────────────────────────── */

function renderRoutingTables() {
  const opts = sel => slotNames().map(n =>
    `<option value="${n}" ${n === sel ? 'selected' : ''}>${n}</option>`).join('');

  const table = (map, keyLabel, extra = () => '') => `
    <thead><tr>
      <th style="width:38px"></th><th style="width:170px">${keyLabel}</th>
      <th style="width:200px">Sound slot</th><th style="width:110px">State</th><th>Actually plays</th>
    </tr></thead>
    <tbody>${Object.entries(map).map(([k, slot]) => {
      const st = slotStatus(slot);
      const r = resolveFiles(slot);
      return `<tr>
        <td><button class="btn-icon" data-play-slot="${slot}">▶</button></td>
        <td class="mono">${k}${extra(k)}</td>
        <td><select class="row-select" data-map-key="${k}">${opts(slot)}</select></td>
        <td><span class="badge ${st}">${STATUS_LABEL[st]}</span></td>
        <td class="mono muted">${st === 'recorded' ? slot : st === 'fallback' ? r.via : st === 'silent' ? 'nothing' : 'missing file'}</td>
      </tr>`;
    }).join('')}</tbody>`;

  $('cantrip-table').innerHTML = table(DATA.cantrips, 'Class');
  $('dmg-table').innerHTML = table(DATA.damageTypes, 'Damage type');

  for (const el of document.querySelectorAll('[data-play-slot]')) {
    el.onclick = () => playSlot(el.dataset.playSlot);
  }
  for (const el of $('cantrip-table').querySelectorAll('[data-map-key]')) {
    el.onchange = () => { DATA.cantrips[el.dataset.mapKey] = el.value; markDirty(); renderRoutingTables(); };
  }
  for (const el of $('dmg-table').querySelectorAll('[data-map-key]')) {
    el.onchange = () => { DATA.damageTypes[el.dataset.mapKey] = el.value; markDirty(); renderRoutingTables(); };
  }
}

/* ── library tab ─────────────────────────────────────────────────────── */

function renderLibrary() {
  if (!libraryLoaded) {
    $('lib-count').textContent = '';
    $('lib-table').innerHTML = `<tbody><tr><td class="muted" style="padding:20px">
      Needs the vite dev server for the disk listing — run <span class="mono">npm run dev</span> and open this page from it.
    </td></tr></tbody>`;
    return;
  }

  const usedBy = new Map();                     // file path → [slot names]
  for (const n of slotNames()) {
    for (const f of DATA.slots[n].files) {
      if (!usedBy.has(f)) usedBy.set(f, []);
      usedBy.get(f).push(n);
    }
  }
  const onDisk = new Set(LIBRARY.map(f => f.path));
  const missing = [...usedBy.keys()].filter(p => !onDisk.has(p));

  const q = $('lib-search').value.trim().toLowerCase();
  const filter = $('lib-filter').value;

  const rows = [
    ...LIBRARY.map(f => ({ path: f.path, size: f.size, slots: usedBy.get(f.path) || [], onDisk: true })),
    ...missing.map(p => ({ path: p, size: 0, slots: usedBy.get(p), onDisk: false })),
  ].filter(r => {
    if (q && !r.path.toLowerCase().includes(q)) return false;
    if (filter === 'used') return r.onDisk && r.slots.length;
    if (filter === 'orphan') return r.onDisk && !r.slots.length;
    if (filter === 'missing') return !r.onDisk;
    return true;
  });

  const orphans = LIBRARY.filter(f => !usedBy.has(f.path)).length;
  $('lib-count').textContent =
    `${LIBRARY.length} files on disk · ${orphans} unused` + (missing.length ? ` · ⚠ ${missing.length} referenced but missing` : '');

  const kb = n => `${(n / 1024).toFixed(0)} KB`;
  $('lib-table').innerHTML = `
    <thead><tr>
      <th style="width:38px"></th><th>File</th><th style="width:90px">Size</th><th>Used by</th>
    </tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td>${r.onDisk ? `<button class="btn-icon" data-play-file="${escapeAttr(r.path)}">▶</button>` : '⚠'}</td>
      <td class="mono" ${r.onDisk ? '' : 'style="color:var(--red)"'}>${r.path}${r.onDisk ? '' : ' — not on disk'}</td>
      <td class="muted">${r.onDisk ? kb(r.size) : '—'}</td>
      <td class="mono muted">${r.slots.length ? r.slots.join(', ') : '<span style="color:var(--amber)">unused</span>'}</td>
    </tr>`).join('')}</tbody>`;

  for (const el of $('lib-table').querySelectorAll('[data-play-file]')) {
    el.onclick = () => playFile(el.dataset.playFile, { jitter: false });
  }
}

/* ── file picker ─────────────────────────────────────────────────────── */

let pickerSlot = null;

function openPicker(slotName) {
  if (!libraryLoaded) { toast('File picker needs the vite dev server (npm run dev)', true); return; }
  pickerSlot = slotName;
  $('picker-slot').textContent = slotName;
  $('picker-search').value = '';
  renderPicker();
  $('picker-backdrop').classList.add('show');
  $('picker-search').focus();
}

function closePicker() {
  $('picker-backdrop').classList.remove('show');
  pickerSlot = null;
}

function renderPicker() {
  const q = $('picker-search').value.trim().toLowerCase();
  const mine = new Set(DATA.slots[pickerSlot].files);
  const usedElsewhere = new Set();
  for (const n of slotNames()) {
    if (n === pickerSlot) continue;
    for (const f of DATA.slots[n].files) usedElsewhere.add(f);
  }
  const rows = LIBRARY.filter(f => !q || f.path.toLowerCase().includes(q));
  $('picker-hint').textContent = `${rows.length} file${rows.length === 1 ? '' : 's'} · click to add, ▶ to audition`;
  $('picker-body').innerHTML = rows.map(f => `
    <div class="pick-row ${mine.has(f.path) ? 'used' : ''}" data-add="${escapeAttr(f.path)}">
      <button class="btn-icon" data-audition="${escapeAttr(f.path)}">▶</button>
      <span class="path">${f.path}</span>
      <span class="size">${mine.has(f.path) ? 'already added' : usedElsewhere.has(f.path) ? 'used elsewhere' : `${(f.size / 1024).toFixed(0)} KB`}</span>
    </div>`).join('') || '<p class="hint" style="padding:10px">No files match.</p>';

  for (const el of $('picker-body').querySelectorAll('[data-audition]')) {
    el.onclick = e => { e.stopPropagation(); playFile(el.dataset.audition, { jitter: false }); };
  }
  for (const el of $('picker-body').querySelectorAll('[data-add]')) {
    el.onclick = () => {
      const p = el.dataset.add;
      const files = DATA.slots[pickerSlot].files;
      if (files.includes(p)) { toast('Already a variant of this slot'); return; }
      files.push(p);
      markDirty(); renderPicker(); renderSlotList(); renderSlotDetail();
      toast(`Added to ${pickerSlot}`);
    };
  }
}

/* ── misc ────────────────────────────────────────────────────────────── */

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

let toastTimer = null;
function toast(msg, isErr = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('err', isErr);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function switchTab(pageId) {
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.page === pageId);
  for (const p of document.querySelectorAll('.tab-page')) p.classList.toggle('active', p.id === pageId);
  if (pageId === 'page-library') renderLibrary();
  if (pageId === 'page-routing') renderRoutingTables();
}

function renderAll() {
  renderStats();
  renderCategoryFilter();
  renderSlotFilterOptions();
  renderSlotList();
  renderSlotDetail();
  renderAbilityTable();
  renderRoutingTables();
  renderLibrary();
}

function renderCategoryFilter() {
  const cats = [...new Set(slotNames().map(n => DATA.slots[n].category))];
  const cur = $('slot-filter-cat').value;
  $('slot-filter-cat').innerHTML = '<option value="">All categories</option>' +
    cats.map(c => `<option value="${c}" ${c === cur ? 'selected' : ''}>${CATEGORY_LABELS[c] || c}</option>`).join('');
}

function renderSlotFilterOptions() {
  const cur = $('ab-filter-slot').value;
  $('ab-filter-slot').innerHTML = '<option value="">Any slot</option>' +
    slotNames().map(n => `<option value="${n}" ${n === cur ? 'selected' : ''}>${n}</option>`).join('');
}

/* ── boot ────────────────────────────────────────────────────────────── */

async function init() {
  DATA = clone(SOUNDS_ON_DISK);
  /* Restore an interrupted session rather than silently losing it. */
  try {
    const draft = localStorage.getItem(LS_DRAFT);
    if (draft) {
      const parsed = JSON.parse(draft);
      if (parsed && parsed.slots && confirm('You have unsaved sound-editor changes from a previous session. Restore them?')) {
        DATA = parsed;
        dirty = true;
      } else {
        localStorage.removeItem(LS_DRAFT);
      }
    }
  } catch { /* ignore a corrupt draft */ }

  await loadLibrary();
  renderAll();

  for (const t of document.querySelectorAll('.tab')) t.onclick = () => switchTab(t.dataset.page);
  $('slot-search').oninput = renderSlotList;
  $('slot-filter-cat').onchange = renderSlotList;
  $('slot-filter-status').onchange = renderSlotList;
  $('btn-new-slot').onclick = newSlot;
  $('ab-search').oninput = renderAbilityTable;
  $('ab-filter-source').onchange = renderAbilityTable;
  $('ab-filter-status').onchange = renderAbilityTable;
  $('ab-filter-slot').onchange = renderAbilityTable;
  $('lib-search').oninput = renderLibrary;
  $('lib-filter').onchange = renderLibrary;
  $('btn-save').onclick = save;
  $('btn-export').onclick = exportJson;
  $('btn-revert').onclick = revert;
  $('picker-close').onclick = closePicker;
  $('picker-search').oninput = renderPicker;
  $('picker-backdrop').onclick = e => { if (e.target.id === 'picker-backdrop') closePicker(); };
  $('preview-vol').oninput = e => { previewVol = e.target.value / 100; };

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closePicker(); stopPreview(); }
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
  });
  window.addEventListener('beforeunload', e => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  /* Handy for scripted checks from the console / preview harness. */
  window.__soundEditor = { get data() { return DATA; }, slotStatus, resolveFiles, usersOfSlot };
}

init();
