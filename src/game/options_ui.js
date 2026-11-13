/**
 * The Options overlay — one settings hub, reachable from three places:
 *   • the title screen's Settings panel
 *   • the world-map system menu
 *   • the ⚙ button on the dungeon HUD (mid-delve)
 *
 * All three open the SAME `#options-overlay`, which lives at the top level of
 * index.html rather than inside any screen container — that's what lets it open
 * during a delve as well as on the world map.
 *
 * The panel is generated from OPTION_GROUPS below, so adding a preference means
 * adding one entry here plus its default in settings.js — no markup to touch.
 * Toggles write straight through to settings (persisted + applied immediately);
 * there is no OK/Cancel, matching how the volume sliders already behave.
 */
import { allSettings, setSetting, resetSettings, applyLogClasses, GRAPHICS_QUALITY_LEVELS } from './settings.js';
import { getMusicVolume, getSfxVolume, getNarrationVolume,
         setMusicVolume, setSfxVolume, setNarrationVolume, playSfx } from './audio.js';

const $ = id => (typeof document === 'undefined' ? null : document.getElementById(id));

/** Grouped, labelled view of the settings, in display order. */
const OPTION_GROUPS = [
  {
    title: '📜 Combat Log',
    note: 'Applies instantly — including to lines already in the log.',
    rows: [
      { key: 'logRollDetail', label: 'Roll details',
        hint: 'Show the dice math: "(14+7 vs AC 15)". Off = results only.' },
      { key: 'logHitMiss', label: 'Hit & miss messages',
        hint: 'Every attack result. Off is much quieter in big fights.' },
      { key: 'logHealing', label: 'Healing',
        hint: 'Potions, heal spells and other HP restoration.' },
      { key: 'logEffects', label: 'Buffs & debuffs',
        hint: 'Effects being applied to heroes and monsters.' },
      { key: 'logDeaths', label: 'Enemy deaths',
        hint: 'Kill notifications. Hero downs are always shown.' },
    ]
  },
  {
    title: '⚙️ Automation',
    note: 'Hand the routine decisions to the party.',
    rows: [
      { key: 'autoSkillChallenges', label: 'Auto-complete skill challenges',
        hint: 'Pick the approach with the best expected payoff instead of asking. The roll still plays out, and the narration is never cut short.' },
    ]
  },
  {
    title: '⚔️ Combat',
    note: 'Playback speed while a fight is active. Applies to movement, attacks and animations.',
    rows: [
      { key: 'initiativeReveal', label: 'Initiative roll-off',
        hint: 'Show everyone’s d20 at the start of a fight before the first turn' },
      { key: 'combatSpeed', type: 'range', min: 0.5, max: 1.5, step: 0.05,
        label: 'Combat playback speed',
        hint: '0.7 ≈ 30% slower; 1.0 is the original speed.' },
    ]
  },
  {
    title: '🖥️ Graphics & comfort',
    note: 'Quality changes the light count at the next floor; everything else applies instantly.',
    rows: [
      { key: 'graphicsQuality', type: 'select', label: 'Quality',
        options: [['low', 'Low — no post-processing, 512 shadow map, fewest torches'],
                  ['medium', 'Medium — bloom on, 1024 shadow map, fewer torches'],
                  ['high', 'High — the full look']],
        hint: 'Low is for integrated graphics and long idle sessions. Torch count takes effect when the next floor is built.' },
      { key: 'screenShake', label: 'Screen shake',
        hint: 'Camera shake on heavy hits, crits and explosions.' },
      { key: 'hitStop', label: 'Hit-stop',
        hint: 'The brief freeze-frame that sells a landed blow.' },
      { key: 'filmGrain', label: 'Film grain',
        hint: 'The fine grain of the post-process look.' },
      { key: 'depthOfField', type: 'select', label: 'Depth of field',
        options: [['strong', 'Strong — the full diorama blur'],
                  ['subtle', 'Subtle — a lighter touch'],
                  ['off', 'Off — everything sharp']],
        hint: 'Exploring, a soft band follows the party. In a fight, whoever is acting and everything they target stay sharp while the rest of the room softens.' },
      { key: 'uiScale', type: 'range', min: 0.8, max: 1.4, step: 0.05, format: 'x',
        label: 'UI scale',
        hint: 'Size of the HUD, party frames, combat log and menus.' },
      { key: 'perfOverlay', label: 'Performance readout',
        hint: 'Frame time, draw calls, lights and shader programs in the corner. F3 toggles it too.' },
    ]
  },
  {
    title: '🎥 Camera',
    note: 'The camera leaves you in control for seven seconds after you drag, orbit or scroll, then takes over again. Exploring and fighting each remember their own zoom and tilt.',
    rows: [
      { key: 'cameraAutoFrame', label: 'Auto-frame the fight',
        hint: 'Pull back far enough to show the enemies as well as the party. Never crops a hero to fit a monster.' },
      { key: 'cameraActionZoom', label: 'Action punch-in zoom',
        hint: 'Zoom in for tighter, dramatic shots during attacks, spells and critical hits, easing back out between turns.' },
      { key: 'cameraAutoRotate', label: 'Turn to see past walls',
        hint: 'When scenery sits between the camera and the party, swing a quarter turn around it.' },
      { key: 'cameraActionRotate', label: 'Cinematic action angles',
        hint: 'Turn to dynamic angles during combat to clearly view clashes from the side rather than stacked behind sprites.' },
      { key: 'cameraWallCutaway', label: 'See through walls',
        hint: 'Dissolve walls and trees standing between the camera and a hero, so the camera can stay low. Off, it tilts up over them instead.' },
      { key: 'cameraExploreOrbit', label: 'Gentle orbit while exploring',
        hint: 'Slowly sway the camera a little to either side while the party explores. Holds still while you point at something, and settles when a fight starts.' },
    ]
  },
];

const fmtRange = (row, v) => row.format === 'x' ? `${v.toFixed(2)}×` : `${Math.round(v * 100)}%`;

function rowHTML(row, values) {
  if (row.type === 'range') {
    const val = values[row.key] != null ? values[row.key] : (row.min || 0);
    return `<label class="opt-vol-row opt-range-row">
      <span class="opt-vol-label">${row.label}</span>
      <span class="opt-range-val" data-val-for="${row.key}">${fmtRange(row, val)}</span>
      <input type="range" class="opt-range" data-setting="${row.key}" data-format="${row.format || ''}" min="${row.min}" max="${row.max}" step="${row.step}" value="${val}">
    </label>
    <div class="opt-row-hint">${row.hint}</div>`;
  }
  if (row.type === 'select') {
    const cur = values[row.key];
    const opts = row.options.map(([v, label]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`).join('');
    return `<label class="opt-vol-row opt-select-row">
      <span class="opt-vol-label">${row.label}</span>
      <select class="opt-select" data-setting="${row.key}">${opts}</select>
    </label>
    <div class="opt-row-hint">${row.hint}</div>`;
  }
  const on = !!values[row.key];
  return `<label class="opt-row">
    <input type="checkbox" class="opt-check" data-setting="${row.key}"${on ? ' checked' : ''}>
    <span class="opt-text">
      <span class="opt-label">${row.label}</span>
      <span class="opt-hint">${row.hint}</span>
    </span>
  </label>`;
}

/* Volume lives here too, but it is not a `settings.js` value — the audio graph
   owns those three numbers under its own storage key, so the sliders read and
   write audio.js directly. */
function volumeGroupHTML() {
  const pct = v => Math.round(v * 100);
  const row = (id, icon, label, val) => `
    <label class="opt-vol-row">
      <span class="opt-vol-label">${icon} ${label}</span>
      <input type="range" min="0" max="100" value="${pct(val)}" data-vol="${id}" aria-label="${label} volume">
    </label>`;
  return `
    <div class="opt-group">
      <h3>🔊 Volume</h3>
      ${row('music', '🎵', 'Music', getMusicVolume())}
      ${row('sfx', '⚔️', 'Effects', getSfxVolume())}
      ${row('narr', '🗣️', 'Narration', getNarrationVolume())}
    </div>`;
}

function panelHTML() {
  const values = allSettings();
  const groups = OPTION_GROUPS.map(g => `
    <div class="opt-group">
      <h3>${g.title}</h3>
      ${g.note ? `<div class="opt-group-note">${g.note}</div>` : ''}
      ${g.rows.map(r => rowHTML(r, values)).join('')}
    </div>`).join('');

  return `<div class="opt-panel">
    <h2 class="opt-title">Options</h2>
    ${volumeGroupHTML()}
    ${groups}
    <div class="opt-actions">
      <button id="opt-reset" class="btn">↺ Restore Defaults</button>
      <button id="opt-close" class="btn primary">↩ Back</button>
    </div>
  </div>`;
}

let _escBound = false;

/**
 * The overlay host, created in document.body on first use.
 *
 * Built here rather than declared in index.html on purpose: `.wm-frame` and
 * `#worldmapscreen` were unclosed in the markup, so a statically-declared
 * overlay got auto-nested inside the (usually display:none) world-map screen
 * and never appeared mid-delve. Owning the node in JS — the same way the HUD nav buttons and
 * #charscreen do — makes that class of bug impossible.
 */
function overlayHost() {
  if (typeof document === 'undefined') return null;
  let ov = $('options-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'options-overlay';
    document.body.appendChild(ov);
  }
  return ov;
}

/** Render + show the overlay. Re-renders each time so it always reflects
 *  whatever the settings are now (they can also change from elsewhere). */
export function openOptions() {
  const ov = overlayHost();
  if (!ov) return;
  ov.innerHTML = panelHTML();

  ov.querySelectorAll('.opt-check').forEach(box => {
    box.addEventListener('change', () => setSetting(box.dataset.setting, box.checked));
  });

  ov.querySelectorAll('.opt-range').forEach(sl => {
    sl.addEventListener('input', () => {
      const v = parseFloat(sl.value);
      setSetting(sl.dataset.setting, v);
      const val = ov.querySelector(`[data-val-for="${sl.dataset.setting}"]`);
      if (val) val.textContent = fmtRange({ format: sl.dataset.format }, v);
    });
  });

  ov.querySelectorAll('.opt-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const v = sel.value;
      if (sel.dataset.setting === 'graphicsQuality' && !GRAPHICS_QUALITY_LEVELS.includes(v)) return;
      setSetting(sel.dataset.setting, v);
    });
  });

  const VOL_SETTERS = { music: setMusicVolume, sfx: setSfxVolume, narr: setNarrationVolume };
  ov.querySelectorAll('[data-vol]').forEach(sl => {
    const set = VOL_SETTERS[sl.dataset.vol];
    sl.addEventListener('input', () => set(sl.value / 100));
    /* audible feedback once the user settles on an SFX level */
    if (sl.dataset.vol === 'sfx') {
      sl.addEventListener('change', () => playSfx('swordHit', { throttleMs: 0 }));
    }
  });

  const closeBtn = ov.querySelector('#opt-close');
  if (closeBtn) closeBtn.addEventListener('click', closeOptions);

  const resetBtn = ov.querySelector('#opt-reset');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    resetSettings();
    openOptions();               // re-render with the restored values
  });

  /* backdrop click dismisses; clicks inside the panel must not */
  ov.addEventListener('click', e => { if (e.target === ov) closeOptions(); });

  if (!_escBound) {
    _escBound = true;
    document.addEventListener('keydown', e => {
      const el = $('options-overlay');
      if (e.key === 'Escape' && el && el.classList.contains('show')) {
        e.stopPropagation();
        closeOptions();
      }
    });
  }

  ov.classList.add('show');
}

export function closeOptions() {
  const ov = $('options-overlay');
  if (ov) ov.classList.remove('show');
}

/**
 * Create the overlay host, wire the openers that live in static markup, and push
 * the stored verbosity onto the log. Called once from game boot; safe to call
 * again (openers use onclick, so listeners are replaced rather than stacked).
 *
 * The ⚙ button in #hud-top-right is wired by menus.js, which builds it
 * after this runs.
 */
export function initOptionsMenu() {
  overlayHost();
  applyLogClasses();
  const btn = $('sys-options-btn');
  if (btn) btn.onclick = openOptions;
}
