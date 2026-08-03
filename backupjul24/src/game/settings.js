/**
 * Player preferences — the settings hub behind the in-game Options menu.
 *
 * Two families live here:
 *
 *   LOG VERBOSITY  How chatty the combat log is. These are enforced entirely
 *     in CSS: `log()` (ui.js) stamps every line with a category class and
 *     wraps roll math in a `.lg-detail` span, and `applyLogClasses` toggles
 *     suppression classes on #gamelog. Nothing is rebuilt or re-rendered, so a
 *     toggle applies instantly *and retroactively* to lines already on screen —
 *     which is why this is done with classes instead of filtering at log time.
 *
 *   AUTOMATION     Chores the player can hand to the game (auto-resolving skill
 *     challenges, skipping the chest spin wheel).
 *
 * Audio volumes deliberately stay in audio.js under their own key — they were
 * already persisted there and the audio graph owns them.
 *
 * Everything is persisted to localStorage under one key and read through
 * getSetting() so call sites never touch storage themselves.
 */

const LS_KEY = 'dc_settings_v1';

/**
 * Defaults are chosen to preserve the behaviour the game shipped with, so an
 * existing player sees nothing change until they opt in: the log stays fully
 * verbose and both automations stay off.
 */
export const SETTING_DEFAULTS = Object.freeze({
  /* ── combat log verbosity ── */
  logRollDetail: true,     // the "(14+7 vs AC 15)" math inside attack lines
  logHitMiss: true,        // attack results — hits, misses, crits
  logHealing: true,        // HP restoration
  logEffects: true,        // buff / debuff application
  logDeaths: true,         // enemy death notifications

  /* ── automation ── */
  autoSkillChallenges: false,  // pick the best approach instead of asking
  autoLootChests: false,       // wheel still spins; shortens the take-loot wait
});

/** Which log category each setting suppresses when switched off. */
const LOG_SUPPRESS_CLASS = Object.freeze({
  logRollDetail: 'no-lg-detail',
  logHitMiss:    'no-lg-hitmiss',
  logHealing:    'no-lg-heal',
  logEffects:    'no-lg-effect',
  logDeaths:     'no-lg-death',
});

const settings = { ...SETTING_DEFAULTS };
try {
  const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  /* Only adopt keys we know about, so a stale/hand-edited blob can't inject
     junk and a removed setting doesn't linger forever. */
  for (const k of Object.keys(SETTING_DEFAULTS)) {
    if (raw[k] !== undefined) settings[k] = raw[k];
  }
} catch { /* private mode / corrupt blob — fresh defaults */ }

const listeners = new Set();

function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}

/** Read one setting. Unknown keys return undefined rather than throwing. */
export function getSetting(key) { return settings[key]; }

/** A copy of every current setting — for rendering the options UI. */
export function allSettings() { return { ...settings }; }

/**
 * Write one setting, persist, re-apply the log classes and notify listeners.
 * Ignores unknown keys so a typo can't quietly create a phantom setting.
 */
export function setSetting(key, value) {
  if (!(key in SETTING_DEFAULTS)) return false;
  settings[key] = value;
  persist();
  applyLogClasses();
  for (const cb of listeners) {
    try { cb(key, value); } catch (e) { console.warn('[settings] listener threw', e); }
  }
  return true;
}

/** Restore every setting to its shipped default. */
export function resetSettings() {
  Object.assign(settings, SETTING_DEFAULTS);
  persist();
  applyLogClasses();
  for (const cb of listeners) {
    try { cb(null, null); } catch (e) { console.warn('[settings] listener threw', e); }
  }
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function onSettingsChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Push the current verbosity choices onto #gamelog as `no-lg-*` classes. The
 * CSS in game.css does the hiding. Safe to call before the DOM exists (the
 * options UI and game boot both call it).
 */
export function applyLogClasses() {
  if (typeof document === 'undefined') return;
  const box = document.getElementById('gamelog');
  if (!box) return;
  for (const [key, cls] of Object.entries(LOG_SUPPRESS_CLASS)) {
    box.classList.toggle(cls, !settings[key]);
  }
}
