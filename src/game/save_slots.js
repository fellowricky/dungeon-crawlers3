/**
 * Multi-slot save game system for Dungeon Crawlers.
 * Manages slot CRUD, active slot tracking, legacy save migration, and slot metadata summaries.
 */

import { SAVE_KEY, SAVE_SLOT_PREFIX, ACTIVE_SLOT_KEY, MAX_SAVE_SLOTS } from './constants.js';

export function getSlotKey(slotId) {
  const id = Math.max(1, Math.min(MAX_SAVE_SLOTS, parseInt(slotId, 10) || 1));
  return `${SAVE_SLOT_PREFIX}${id}`;
}

export function getActiveSlot() {
  try {
    const raw = globalThis.localStorage?.getItem(ACTIVE_SLOT_KEY);
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= MAX_SAVE_SLOTS) {
      return parsed;
    }
  } catch { /* ignore */ }
  return 1;
}

export function setActiveSlot(slotId) {
  const id = Math.max(1, Math.min(MAX_SAVE_SLOTS, parseInt(slotId, 10) || 1));
  try {
    globalThis.localStorage?.setItem(ACTIVE_SLOT_KEY, String(id));
  } catch { /* ignore */ }
  return id;
}

/**
 * Loads raw parsed JSON for a specific slot.
 * Automatically migrates legacy 'dungeon-crawlers-save-v1' into Slot 1 if Slot 1 is empty.
 */
export function loadSlotRaw(slotId = getActiveSlot()) {
  const id = Math.max(1, Math.min(MAX_SAVE_SLOTS, parseInt(slotId, 10) || 1));
  try {
    const key = getSlotKey(id);
    let raw = globalThis.localStorage?.getItem(key);

    // Legacy migration: if Slot 1 has no save yet, check the legacy unslotted SAVE_KEY
    if (!raw && id === 1) {
      const legacyRaw = globalThis.localStorage?.getItem(SAVE_KEY);
      if (legacyRaw) {
        try {
          const data = JSON.parse(legacyRaw);
          if (data && typeof data === 'object') {
            data.slotId = 1;
            data.updatedAt = data.updatedAt || Date.now();
            globalThis.localStorage?.setItem(key, JSON.stringify(data));
            return data;
          }
        } catch { /* ignore */ }
      }
    }

    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Saves raw game data object into a specific slot.
 */
export function saveSlotRaw(slotId = getActiveSlot(), data) {
  if (!data || typeof data !== 'object') return false;
  const id = Math.max(1, Math.min(MAX_SAVE_SLOTS, parseInt(slotId, 10) || 1));
  let serialized = null;
  try {
    data.slotId = id;
    data.updatedAt = Date.now();
    serialized = JSON.stringify(data, saveReplacer);
    globalThis.localStorage?.setItem(getSlotKey(id), serialized);
    setActiveSlot(id);
    return true;
  } catch (e) {
    const quota = isQuotaError(e);
    console.warn(`Failed to save slot ${id}:`, e);
    if (quota && serialized) console.warn(describeSaveSize(id, data, serialized));
    const err = new Error(quota ? 'save quota exceeded' : 'save failed');
    err.quota = quota;
    err.cause = e;
    throw err;
  }
}

/* Safety net under heroSaveRecord (inventory.js): should any new runtime
   reference leak into the payload, the renderer objects it drags along are
   dropped here rather than serialised through Object3D.toJSON — which turns
   every texture into a data URL and is what made saves outgrow the quota. */
export function saveReplacer(key, value) {
  if (value && typeof value === 'object'
      && (value.isObject3D || value.isMaterial || value.isTexture || value.isBufferGeometry)) {
    return undefined;
  }
  return value;
}

/** localStorage's "full" error has different names/codes across browsers. */
export function isQuotaError(e) {
  if (!e) return false;
  return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || e.code === 22 || e.code === 1014 || /quota/i.test(String(e.message || ''));
}

/**
 * Where the bytes are. A save that outgrows the quota fails silently every
 * autosave otherwise, and "the save is too big" is useless without knowing
 * which field grew — and whether it is the save at all, or another key on the
 * origin (the editors keep their drafts in the same localStorage).
 */
export function describeSaveSize(slotId, data, serialized) {
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  const lines = [`Save slot ${slotId} is ${kb(serialized.length)} serialized. Largest fields:`];
  const fields = Object.entries(data)
    .map(([k, v]) => { try { return [k, JSON.stringify(v === undefined ? null : v).length]; } catch { return [k, 0]; } })
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  for (const [k, n] of fields) lines.push(`  ${k}: ${kb(n)}`);
  try {
    const ls = globalThis.localStorage;
    if (ls) {
      let total = 0;
      const keys = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        const n = (ls.getItem(k) || '').length;
        total += n;
        keys.push([k, n]);
      }
      keys.sort((a, b) => b[1] - a[1]);
      lines.push(`localStorage holds ${kb(total)} across ${keys.length} keys. Largest:`);
      for (const [k, n] of keys.slice(0, 8)) lines.push(`  ${k}: ${kb(n)}`);
    }
  } catch { /* ignore */ }
  return lines.join('\n');
}

/**
 * Deletes save data for a slot.
 */
export function deleteSaveSlot(slotId) {
  const id = Math.max(1, Math.min(MAX_SAVE_SLOTS, parseInt(slotId, 10) || 1));
  try {
    globalThis.localStorage?.removeItem(getSlotKey(id));
    if (id === 1) {
      globalThis.localStorage?.removeItem(SAVE_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Formats slot metadata for display in the save slot picker UI.
 */
export function getSaveSlotInfo(slotId) {
  const id = Math.max(1, Math.min(MAX_SAVE_SLOTS, parseInt(slotId, 10) || 1));
  const data = loadSlotRaw(id);
  if (!data || !Array.isArray(data.heroes) || data.heroes.length === 0) {
    return {
      slotId: id,
      empty: true,
      updatedAt: null,
      formattedDate: null,
      heroes: [],
      leader: null,
      gold: 0,
      locationText: 'Empty Slot'
    };
  }

  const heroes = data.heroes.map(h => ({
    name: h.name || 'Hero',
    raceKey: h.raceKey || 'human',
    classKey: h.classKey || 'fighter',
    level: h.level || 1,
    hp: h.hp || 0,
    maxHp: h.maxHp || 1
  }));

  const leaderIdx = Math.min(Math.max(0, data.leaderIdx || 0), heroes.length - 1);
  const leader = heroes[leaderIdx] || heroes[0];

  let locationText = 'Town / World Map';
  if (data.activeQuest && data.activeQuest.name) {
    const qf = data.questFloor || 1;
    const total = data.activeQuest.floors || 1;
    locationText = `${data.activeQuest.name} (Floor ${qf}/${total})`;
  }

  let formattedDate = 'Recently';
  if (data.updatedAt) {
    try {
      const d = new Date(data.updatedAt);
      formattedDate = d.toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch { /* fallback */ }
  }

  return {
    slotId: id,
    empty: false,
    updatedAt: data.updatedAt || 0,
    formattedDate,
    heroes,
    leader,
    gold: data.gold || 0,
    dungeonLevel: data.dungeonLevel || 1,
    locationText,
    questName: data.activeQuest?.name || null
  };
}

/**
 * Returns metadata list for all save slots.
 */
export function listSaveSlots() {
  const slots = [];
  for (let i = 1; i <= MAX_SAVE_SLOTS; i++) {
    slots.push(getSaveSlotInfo(i));
  }
  return slots;
}

/**
 * Checks if any slot currently has save data.
 */
export function hasAnySave() {
  for (let i = 1; i <= MAX_SAVE_SLOTS; i++) {
    const raw = loadSlotRaw(i);
    if (raw && Array.isArray(raw.heroes) && raw.heroes.length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Returns the most recently updated save slot ID, or the active slot if valid, or 1.
 */
export function getMostRecentSaveSlot() {
  const slots = listSaveSlots().filter(s => !s.empty);
  if (slots.length === 0) return null;

  // Sort by updatedAt descending
  slots.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return slots[0].slotId;
}

/* ---------------- export / import ----------------
   A run is hours of party, guild and quest progress, and all of it lives in
   one browser profile's localStorage. Clearing site data, changing browser or
   reinstalling the desktop build loses it with no way back. A save is
   100–200 KB of plain JSON, so it travels as a file — which also gives a
   bug report something to attach. */

export const SAVE_FILE_FORMAT = 'dungeon-crawlers-save';
export const SAVE_FILE_VERSION = 1;

/** The text of a save file for `slotId`, or null when the slot is empty. */
export function exportSlotFile(slotId) {
  const id = Math.max(1, Math.min(MAX_SAVE_SLOTS, parseInt(slotId, 10) || 1));
  const data = loadSlotRaw(id);
  if (!data || !Array.isArray(data.heroes) || data.heroes.length === 0) return null;
  const envelope = {
    format: SAVE_FILE_FORMAT,
    version: SAVE_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    slotId: id,
    data
  };
  const lead = data.heroes[0];
  const who = String((lead && lead.name) || 'company').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const stamp = envelope.exportedAt.slice(0, 10);
  return { filename: `dungeon-crawlers-${who}-slot${id}-${stamp}.json`, text: JSON.stringify(envelope) };
}

/**
 * Parse a save file (the envelope above, or a bare save object) and say what
 * is in it without writing anything. Throws with a player-readable message
 * when it is not a save.
 */
export function parseSaveFile(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('That file is not a save — it is not valid JSON.'); }
  const data = parsed && parsed.format === SAVE_FILE_FORMAT ? parsed.data : parsed;
  if (!data || typeof data !== 'object' || !Array.isArray(data.heroes) || data.heroes.length === 0) {
    throw new Error('That file is not a save — no party inside it.');
  }
  if (parsed.format === SAVE_FILE_FORMAT && parsed.version > SAVE_FILE_VERSION) {
    throw new Error(`That save was exported by a newer version of the game (file v${parsed.version}, this game reads v${SAVE_FILE_VERSION}).`);
  }
  const heroes = data.heroes.map(h => ({ name: h.name || 'Hero', level: h.level || 1, classKey: h.classKey || '' }));
  return { data, heroes, exportedAt: parsed.exportedAt || null, sourceSlot: parsed.slotId || data.slotId || null };
}

/** Write an already-parsed save into `slotId`. Migration happens on load, as
    for any other save. Returns true on success; throws on quota. */
export function importSaveInto(slotId, parsedFile) {
  const id = Math.max(1, Math.min(MAX_SAVE_SLOTS, parseInt(slotId, 10) || 1));
  const data = { ...parsedFile.data };
  return saveSlotRaw(id, data);
}
