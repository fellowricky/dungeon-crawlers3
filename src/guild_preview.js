/**
 * GUILD COMPOUND PREVIEW — standalone harness for guild_scene.js.
 *
 * Deliberately NOT wired into the game. This page owns its own render loop and
 * its own throwaway state so the compound can be designed, framed and clicked
 * through long before showWorldMap() is touched. Same pattern as
 * dungeon_editor.html: render with the shipping scene code, drive it from a
 * side panel.
 *
 * Nothing in src/game/ imports this file.
 */
import {
  renderer, cam, renderFrame
} from './render/dungeon_scene.js';
import {
  buildGuildScene, disposeGuildScene, setStructureLevel, getStructureLevel,
  pickStructure, setHoverStructure, screenPosOf, setHeroes, updateGuildScene,
  setCameraConstrained, resizeGuildCamera, minCompoundZoom, loadGuildArt, guildArtCount,
  setStructureTransform, getStructureTransform, getTransformOverrides, clearTransforms,
  groundPointAt, lockCamera,
  getStructureHitbox, setStructureHitbox, getHitboxOverrides, setHitboxDebug,
  getInfraTier
} from './render/guild_scene.js';
import { STRUCTURES, STRUCTURE_BY_ID, COMPOUND, CAM, tierOf,
         INFRA_TIERS, infraTierOf, averageFacilityLevel } from './game/guild_layout.js';
import { FACILITY_DEFINITIONS } from './game/guild.js';
import { THEMES } from './dungeon/dungeon_generator.js';
import { makeHero, PLAYABLE_RACES, PLAYABLE_CLASSES, ABILITIES, STARTER_GEAR } from './game/srd.js';
import { makeStarterItem } from './game/items.js';
import { getRaceDefaults, skinColorsFor, HAIR_VALUES, HAIR_COLORS, FACIAL_HAIR_VALUES } from './game/appearance.js';

const el = id => document.getElementById(id);
const TIER_NAMES = ['Empty lot', 'Founded', 'Established', 'Grand'];

/* The compound's camera pose lives in guild_layout.js (CAM). yaw 0 looks
   straight down the north axis — the SNES-JRPG town camera. The dungeon's 45°
   yaw is what reads as isometric, and is deliberately NOT used here.

   Pan and zoom stay available to the player; guild_scene's constrainCamera()
   only suppresses orbit and keeps the view inside the walls. */

const state = {
  levels: Object.fromEntries(STRUCTURES.map(s => [s.id, s.alwaysBuilt ? 1 : 0])),
  themeKey: COMPOUND.themeKey,
  locked: true,
  heroCount: 6,
  selected: null,
  edit: false
};

/* Drag state for layout editing. Held here rather than in guild_scene so the
   scene module stays free of pointer handling. */
let drag = null;   // { id, grabDx, grabDz }

/* ---------------- throwaway hero generation ----------------
   A trimmed copy of worldmap.js's tavern recruit roll — enough visual variety
   to judge whether heroes read at this camera distance. */

function randomHero() {
  const races = PLAYABLE_RACES.map(([k]) => k);
  const classes = PLAYABLE_CLASSES.map(([k]) => k);
  const raceKey = races[Math.floor(Math.random() * races.length)];
  const classKey = classes[Math.floor(Math.random() * classes.length)];
  const rd = getRaceDefaults(raceKey);
  const pal = skinColorsFor(raceKey);

  const visual = {
    gender: Math.random() > 0.5 ? 'male' : 'female',
    head: rd.head,
    skinColor: Math.random() < 0.5 ? rd.skinColor : pal[Math.floor(Math.random() * pal.length)],
    hair: HAIR_VALUES[1 + Math.floor(Math.random() * (HAIR_VALUES.length - 1))],
    hairExtension: 'none',
    hairExtColor: '',
    facialHair: rd.facialHair !== 'none' ? rd.facialHair
      : (Math.random() < 0.3 ? FACIAL_HAIR_VALUES[1 + Math.floor(Math.random() * (FACIAL_HAIR_VALUES.length - 1))] : 'none'),
    hairColor: Math.random() < 0.5 ? rd.hairColor : HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)],
    eyeColor: rd.eyeColor,
    ears: rd.ears,
    horns: rd.horns || 'none',
    spriteScaleX: rd.spriteScaleX || 1.0,
    spriteScaleY: rd.spriteScaleY || 1.0
  };

  const stats = {};
  for (const ab of ABILITIES) stats[ab] = 10 + Math.floor(Math.random() * 6);
  const hero = makeHero(`Recruit`, raceKey, classKey, stats, visual);

  /* Starter kit so they aren't standing around in their underwear. */
  const st = STARTER_GEAR[classKey];
  if (st) {
    hero.equipment.weapon = makeStarterItem('weapon', st.weapon);
    hero.equipment.armor = makeStarterItem('armor', st.armor, st.look);
  }
  return hero;
}

/** Spread N heroes across the structures that are actually built. */
function populateHeroes(n) {
  const open = STRUCTURES.filter(s => s.heroSlots?.length && (state.levels[s.id] > 0 || s.alwaysBuilt));
  const list = [];
  if (!open.length) { setHeroes([]); return 0; }
  for (let i = 0; i < n; i++) {
    const s = open[i % open.length];
    list.push({ hero: randomHero(), structureId: s.id });
  }
  return setHeroes(list);
}

/* ---------------- side panel ---------------- */

function facilityRow(s) {
  const lvl = state.levels[s.id];
  const tier = s.alwaysBuilt ? Math.max(1, tierOf(lvl)) : tierOf(lvl);
  const def = s.facility ? FACILITY_DEFINITIONS[s.facility] : null;
  return `
    <div class="srow" data-id="${s.id}">
      <div class="srow-head">
        <span class="srow-name">${def ? def.icon + ' ' : ''}${s.name}</span>
        <span class="srow-tier" id="tier-${s.id}">${TIER_NAMES[tier]}</span>
      </div>
      <div class="srow-ctl">
        <input type="range" min="0" max="10" step="1" value="${lvl}"
               data-id="${s.id}" ${s.alwaysBuilt ? 'disabled' : ''} />
        <span class="srow-lvl" id="lvl-${s.id}">${s.alwaysBuilt ? '—' : lvl}</span>
      </div>
    </div>`;
}

function renderInfra() {
  const box = el('infra-readout');
  if (!box) return;
  const avg = averageFacilityLevel(state.levels);
  const t = infraTierOf(state.levels);
  const next = INFRA_TIERS[t + 1];
  box.innerHTML = `<b style="color:var(--gold-bright)">${INFRA_TIERS[t].name}</b>`
    + ` &nbsp;tier ${t}/4 &nbsp;· avg facility level ${avg.toFixed(2)}`
    + (next ? `<br><span style="color:var(--text-muted)">next: ${next.name} at avg ${next.minAvg}</span>` : '');
}

function renderPanel() {
  renderInfra();
  el('structures').innerHTML = STRUCTURES.map(facilityRow).join('');
  el('structures').querySelectorAll('input[type=range]').forEach(inp => {
    inp.addEventListener('input', () => {
      const id = inp.dataset.id;
      const lvl = +inp.value;
      state.levels[id] = lvl;
      el(`lvl-${id}`).textContent = lvl;
      el(`tier-${id}`).textContent = TIER_NAMES[tierOf(lvl)];
      setStructureLevel(id, lvl);
      renderInfra();
      /* The wall tier is a function of the MEAN level, so one slider can change
         it. Rebuild the whole compound only when it actually crosses a
         threshold — rebuilding on every drag tick would be unusable. */
      if (infraTierOf(state.levels) !== getInfraTier()) rebuild();
      if (state.selected === id) renderPopup();
    });
    inp.addEventListener('change', () => populateHeroes(state.heroCount));
  });

  el('themes').innerHTML = Object.keys(THEMES)
    .map(k => `<option value="${k}" ${k === state.themeKey ? 'selected' : ''}>${THEMES[k].label || k}</option>`)
    .join('');
}

function setAllLevels(lvl) {
  for (const s of STRUCTURES) {
    if (s.alwaysBuilt) continue;
    state.levels[s.id] = lvl;
  }
  rebuild();
}

function rebuild() {
  buildGuildScene({ levels: state.levels, themeKey: state.themeKey });
  cam.zoom = +el('zoom').value;
  cam.updateProjectionMatrix();
  renderPanel();
  populateHeroes(state.heroCount);
  closePopup();
}

/* ---------------- structure popup ----------------
   Phase 0 stand-in for the real thing: name, level, what the next upgrade
   costs and does, and the two actions the design calls for. */

function renderPopup() {
  const id = state.selected;
  const pop = el('popup');
  if (!id) { pop.style.display = 'none'; return; }

  const s = STRUCTURE_BY_ID[id];
  const lvl = getStructureLevel(id);
  const def = s.facility ? FACILITY_DEFINITIONS[s.facility] : null;
  const tier = s.alwaysBuilt ? Math.max(1, tierOf(lvl)) : tierOf(lvl);

  let body = '';
  if (def) {
    const maxed = lvl >= def.maxLevel;
    const cost = Math.round(def.baseCost * Math.pow(def.costMultiplier, lvl));
    body = `
      <p class="pop-desc">${def.description}</p>
      <div class="pop-effect">${def.getEffectText(lvl)}</div>
      <div class="pop-meta">Level ${lvl}/${def.maxLevel} · ${TIER_NAMES[tier]}</div>
      <div class="pop-actions">
        <button class="pop-btn primary" data-act="upgrade" ${maxed ? 'disabled' : ''}>
          ${lvl === 0 ? `Build · ${cost}g` : maxed ? 'Fully Upgraded' : `Upgrade · ${cost}g`}
        </button>
        <button class="pop-btn" data-act="enter" ${lvl === 0 ? 'disabled' : ''}>Enter</button>
      </div>`;
  } else {
    const opensLabel = { quests: 'Quest board', shop: 'Shop stock', story: 'Chronicle', roster: 'Roster' }[s.opens] || s.opens;
    body = `
      <p class="pop-desc">Town structure — no upgrade track.</p>
      <div class="pop-meta">Opens: ${opensLabel}</div>
      <div class="pop-actions">
        <button class="pop-btn" data-act="enter">Enter</button>
      </div>`;
  }

  pop.innerHTML = `<div class="pop-title">${def ? def.icon + ' ' : ''}${s.name}</div>${body}`;
  pop.style.display = 'block';

  pop.querySelectorAll('.pop-btn').forEach(b => {
    b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'upgrade' && def) {
        const next = Math.min(def.maxLevel, getStructureLevel(id) + 1);
        state.levels[id] = next;
        setStructureLevel(id, next);
        renderPanel();
        populateHeroes(state.heroCount);
        renderPopup();
        setStatus(`${s.name} → level ${next} (${TIER_NAMES[tierOf(next)]})`);
      } else if (act === 'enter') {
        /* Phase 0: interiors are not built. The plan (§6) has Enter opening the
           existing renderFacilityView content — wired up at integration time. */
        setStatus(`Enter "${s.name}" → would open: ${s.opens}`);
      }
    });
  });
}

function closePopup() {
  state.selected = null;
  el('popup').style.display = 'none';
}

/** Keep the popup pinned over its building as the camera moves. */
function positionPopup() {
  if (!state.selected) return;
  const p = screenPosOf(state.selected);
  const pop = el('popup');
  if (!p || p.behind) { pop.style.display = 'none'; return; }
  pop.style.display = 'block';
  pop.style.left = `${Math.round(p.x)}px`;
  pop.style.top = `${Math.round(p.y)}px`;
}

const HB_FIELDS = [['w', 'Width'], ['d', 'Depth'], ['h', 'Height'],
                   ['dx', 'Offset X'], ['dz', 'Offset Z']];

function renderHitboxPanel() {
  const box = el('hitbox-fields');
  if (!box) return;
  if (!state.selected) { box.innerHTML = '<div style="font-size:11px;color:var(--text-muted)">select a building</div>'; return; }
  const hb = getStructureHitbox(state.selected);
  box.innerHTML = HB_FIELDS.map(([k, label]) => `
    <div class="row">
      <label>${label}</label>
      <div class="ctl">
        <input type="range" id="hb-${k}" data-k="${k}"
               min="${k === 'dx' || k === 'dz' ? -12 : 0.5}" max="${k === 'dx' || k === 'dz' ? 12 : 24}"
               step="0.1" value="${hb[k]}" />
      </div>
      <span class="val" id="hb-val-${k}">${(+hb[k]).toFixed(1)}</span>
    </div>`).join('');
  box.querySelectorAll('input[type=range]').forEach(inp => {
    inp.addEventListener('input', () => {
      const k = inp.dataset.k;
      setStructureHitbox(state.selected, { [k]: +inp.value });
      el(`hb-val-${k}`).textContent = (+inp.value).toFixed(1);
    });
  });
}

function updateEditReadout() {
  const box = el('edit-readout');
  if (!box) return;
  if (!state.selected) { box.textContent = 'no building selected'; return; }
  const lvl = state.levels[state.selected] | 0;
  const t = getStructureTransform(state.selected, lvl);
  box.textContent = `${state.selected} lvl${lvl}  dx ${t.dx.toFixed(2)}  dz ${t.dz.toFixed(2)}  scale ${t.scale.toFixed(3)}`;
  renderHitboxPanel();
}

/** Number of individual level offsets across all buildings. */
function overrideCount(o) {
  return Object.values(o).reduce((n, levels) => n + Object.keys(levels).length, 0);
}

function collectEdits() {
  return { transforms: getTransformOverrides(), hitboxes: getHitboxOverrides() };
}

function exportLayout() {
  const payload = collectEdits();
  const n = overrideCount(payload.transforms) + Object.keys(payload.hitboxes).length;
  if (!n) { setStatus('nothing moved yet'); return; }
  const o = payload;
  /* Shape is { building: { level: {dx,dz,scale} } } — the same payload the save
     endpoint merges into the manifest, so copy and Save stay interchangeable. */
  const text = JSON.stringify(o, null, 2);
  el('edit-export').value = text;
  el('edit-export').style.display = 'block';
  el('edit-export').select();
  try { navigator.clipboard.writeText(text); } catch { /* the box is the fallback */ }
  setStatus(`${n} edit(s) copied — or press Save to write the manifest`);
}

/** Persist nudges into public/art/guild/manifest.json via the dev server, so
 *  tuning survives a reload instead of living only in this tab. */
async function saveLayout() {
  const payload = collectEdits();
  const n = overrideCount(payload.transforms) + Object.keys(payload.hitboxes).length;
  if (!n) { setStatus('nothing moved yet'); return; }
  try {
    const res = await fetch('/api/save-guild-transforms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const j = await res.json();
    setStatus(j.success ? `saved ${j.count} edit(s) to manifest.json`
                        : `save failed: ${j.error}`);
  } catch (err) {
    setStatus(`save failed: ${err.message}`);
  }
}

let statusTimer = 0;
function setStatus(msg) {
  const s = el('status');
  s.textContent = msg;
  s.style.opacity = '1';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { s.style.opacity = '0'; }, 3200);
}

/* ---------------- pointer ---------------- */

function bindPointer() {
  const cnv = renderer?.domElement;
  if (!cnv) return;
  let downX = 0, downY = 0;

  cnv.addEventListener('pointermove', e => {
    if (drag) {
      const p = groundPointAt(e.clientX, e.clientY);
      if (p) {
        const s = STRUCTURE_BY_ID[drag.id];
        setStructureTransform(drag.id, drag.level, {
          dx: p.x - drag.grabDx - s.x,
          dz: p.z - drag.grabDz - s.z
        });
        if (state.selected === drag.id) positionPopup();
        updateEditReadout();
      }
      return;
    }
    setHoverStructure(pickStructure(e.clientX, e.clientY));
  });

  cnv.addEventListener('pointerdown', e => {
    downX = e.clientX; downY = e.clientY;
    if (!state.edit || e.button !== 0) return;
    const id = pickStructure(e.clientX, e.clientY);
    if (!id) return;
    const p = groundPointAt(e.clientX, e.clientY);
    if (!p) return;
    const s = STRUCTURE_BY_ID[id];
    const level = state.levels[id] | 0;
    const t = getStructureTransform(id, level);
    /* Remember where inside the building it was grabbed, so it does not snap
       its centre to the cursor. Level is captured too: edits belong to the
       level whose art is on screen. */
    drag = { id, level, grabDx: p.x - (s.x + t.dx), grabDz: p.z - (s.z + t.dz) };
    state.selected = id;
    lockCamera(true);
    renderPopup(); positionPopup();
  });

  const endDrag = () => { if (drag) { drag = null; lockCamera(false); } };
  cnv.addEventListener('pointerup', e => {
    if (drag) { endDrag(); return; }
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
    const id = pickStructure(e.clientX, e.clientY);
    if (id) { state.selected = id; renderPopup(); positionPopup(); }
    else closePopup();
  });
  cnv.addEventListener('pointercancel', endDrag);

  /* Wheel scales the selected building in edit mode instead of zooming. */
  cnv.addEventListener('wheel', e => {
    if (!state.edit || !state.selected) return;
    e.preventDefault(); e.stopPropagation();
    const lvl = state.levels[state.selected] | 0;
    const t = getStructureTransform(state.selected, lvl);
    const next = Math.max(0.25, Math.min(4, t.scale * Math.exp(-e.deltaY * 0.0015)));
    setStructureTransform(state.selected, lvl, { scale: next });
    updateEditReadout();
  }, { passive: false, capture: true });

  window.addEventListener('keydown', e => {
    if (!state.edit || !state.selected) return;
    const lvl = state.levels[state.selected] | 0;
    const t = getStructureTransform(state.selected, lvl);
    const step = e.shiftKey ? 1 : 0.25;
    const map = { ArrowLeft: ['dx', -step], ArrowRight: ['dx', step],
                  ArrowUp: ['dz', -step], ArrowDown: ['dz', step] };
    if (map[e.key]) {
      const [k, d] = map[e.key];
      setStructureTransform(state.selected, lvl, { [k]: t[k] + d });
      e.preventDefault(); updateEditReadout(); positionPopup();
    } else if (e.key === '[' || e.key === ']') {
      setStructureTransform(state.selected, lvl, { scale: t.scale * (e.key === '[' ? 0.97 : 1.03) });
      updateEditReadout();
    }
  });
}

/* ---------------- render loop ---------------- */

let last = performance.now();
function loop() {
  requestAnimationFrame(loop);
  if (!renderer) return;
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  updateGuildScene(dt);   // also applies the camera constraint
  positionPopup();

  /* The wheel changes cam.zoom directly (shared dungeon handler), so mirror it
     back into the slider instead of letting the two drift apart. */
  const zEl = el('zoom');
  if (Math.abs(+zEl.value - cam.zoom) > 0.005) {
    zEl.value = cam.zoom;
    el('zoom-val').textContent = cam.zoom.toFixed(2);
  }

  renderFrame();
}

/* ---------------- boot ---------------- */

window.addEventListener('resize', () => {
  if (!renderer) return;
  renderer.setSize(innerWidth, innerHeight);
  resizeGuildCamera();
});

(async function boot() {
  /* Load the generated-art manifest first so the very first build already uses
     whatever sprites exist, rather than flashing procedural boxes. */
  await loadGuildArt();
  const zoom = el('zoom');
  zoom.max = 9; zoom.step = 0.02;
  /* The slider must not offer a zoom the compound constraint will immediately
     override, or the two fight and the readout jitters. */
  zoom.min = minCompoundZoom().toFixed(2);
  zoom.value = Math.max(COMPOUND.camZoom, minCompoundZoom());
  el('zoom-val').textContent = (+zoom.value).toFixed(2);
  zoom.addEventListener('input', () => {
    cam.zoom = +zoom.value;
    cam.updateProjectionMatrix();
    el('zoom-val').textContent = (+zoom.value).toFixed(2);
  });

  el('lock').addEventListener('change', e => {
    state.locked = e.target.checked;
    setCameraConstrained(state.locked);
    setStatus(state.locked
      ? 'Constrained — drag to pan, wheel to zoom, orbit blocked'
      : 'Free look — right-drag orbits. Sprites will look wrong off-angle.');
  });

  el('themes').addEventListener('change', e => {
    state.themeKey = e.target.value;
    rebuild();
  });

  el('heroes').addEventListener('input', e => {
    state.heroCount = +e.target.value;
    el('heroes-val').textContent = state.heroCount;
    populateHeroes(state.heroCount);
  });

  el('edit-mode').addEventListener('change', e => {
    state.edit = e.target.checked;
    setCameraConstrained(!state.edit ? true : true);
    setStatus(state.edit
      ? 'Edit: drag to move · wheel to scale · arrows nudge (shift = 1 unit) · [ ] scale'
      : 'Edit off — camera drag restored');
    updateEditReadout();
  });
  el('hitbox-show').addEventListener('change', e => {
    setHitboxDebug(e.target.checked);
    setStatus(e.target.checked ? 'click volumes shown' : 'click volumes hidden');
  });
  el('edit-export-btn').addEventListener('click', exportLayout);
  el('edit-save-btn').addEventListener('click', saveLayout);
  el('edit-reset-btn').addEventListener('click', () => {
    clearTransforms();
    /* Clear the export box too — leaving stale JSON on screen after a reset
       reads as "these offsets are still live" when they are not. */
    el('edit-export').value = '';
    el('edit-export').style.display = 'none';
    updateEditReadout();
    setStatus('transforms reset');
  });

  el('all-0').addEventListener('click', () => setAllLevels(0));
  el('all-1').addEventListener('click', () => setAllLevels(1));
  el('all-5').addEventListener('click', () => setAllLevels(5));
  el('all-10').addEventListener('click', () => setAllLevels(10));
  el('reroll').addEventListener('click', () => populateHeroes(state.heroCount));

  el('collapse').addEventListener('click', () => {
    const p = el('panel');
    p.classList.toggle('collapsed');
    el('collapse').textContent = p.classList.contains('collapsed') ? '‹' : '›';
  });

  buildGuildScene({ levels: state.levels, themeKey: state.themeKey });
  cam.zoom = COMPOUND.camZoom;
  cam.updateProjectionMatrix();
  renderPanel();
  populateHeroes(state.heroCount);
  bindPointer();
  loop();

  const n = guildArtCount();
  setStatus(n
    ? `Click a building. ${n} generated sprite${n === 1 ? '' : 's'} loaded.`
    : 'Click a building. No generated art found — all placeholders are procedural.');
})();

/* Handle for scripted checks, mirroring window.__editor in the dungeon editor. */
if (typeof window !== 'undefined') {
  window.__guildPreview = { state, rebuild, populateHeroes, setStructureLevel, STRUCTURES };
}
