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
  try {
    data.slotId = id;
    data.updatedAt = Date.now();
    const serialized = JSON.stringify(data);
    globalThis.localStorage?.setItem(getSlotKey(id), serialized);
    setActiveSlot(id);
    return true;
  } catch (e) {
    console.warn(`Failed to save slot ${id}:`, e);
    return false;
  }
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
