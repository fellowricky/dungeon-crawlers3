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
import { allSettings, setSetting, resetSettings, applyLogClasses } from './settings.js';
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
      { key: 'autoLootChests', label: 'Auto-loot chests',
        hint: 'Take the haul 3 seconds after the wheel stops, without waiting for a click.' },
    ]
  },
];

function rowHTML(row, values) {
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
 * and never appeared mid-delve. Owning the node in JS — the same way #topnav and
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
 * The topnav ⚙ button is wired by menus.js, which owns that bar and builds it
 * after this runs.
 */
export function initOptionsMenu() {
  overlayHost();
  applyLogClasses();
  const btn = $('sys-options-btn');
  if (btn) btn.onclick = openOptions;
}
