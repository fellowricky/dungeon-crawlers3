import { describe, it, expect } from 'vitest';
import { exploreMethods } from '../src/game/explore.js';

if (typeof globalThis.document === 'undefined') {
  const nullEl = { classList: { add() {}, remove() {}, toggle() {} }, style: {}, setAttribute() {} };
  globalThis.document = {
    getElementById: () => null,
    createElement: () => nullEl,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

const hero = (classKey, slots, slotsMax, hp = 30) => ({
  data: { name: classKey, classKey, hp, maxHp: 30, slots: { ...slots }, slotsMax: { ...slotsMax } }
});

/** Minimal host: real explore methods, stubbed collaborators. Room 0 "had
 *  monsters" (its lone monster is dead); room 1 is empty (never spawned any). */
function mkGame(over = {}) {
  return Object.assign({
    D: { rooms: [{}, {}] },
    monsters: [{ roomId: 0, data: { hp: 0 }, dead: true }],
    heroes: [],
    visitedRooms: new Uint8Array(2).fill(1),
    _slotRefreshedRooms: new Set(),
    log: () => {},
    updatePartyFrames: () => {},
    refreshMenus: () => {},
  }, exploreMethods, over);
}

describe('Warlock room-clear slot recovery', () => {
  it('recovers one slot for each living warlock once a room is cleared of monsters', () => {
    const w = hero('warlock', { 3: 1 }, { 3: 2 });       // spent one of two
    const fighter = hero('fighter', { 1: 1 }, { 1: 2 }); // not a warlock
    const full = hero('warlock', { 3: 2 }, { 3: 2 });     // already full
    const game = mkGame({ heroes: [w, fighter, full] });

    game.refreshSlotsOnRoomClear();

    expect(w.data.slots[3]).toBe(2);          // recovered 1
    expect(fighter.data.slots[1]).toBe(1);    // untouched (not a warlock)
    expect(full.data.slots[3]).toBe(2);       // already full — recoverSlots refused
  });

  it('does not reward the same room twice, nor rooms that never had monsters', () => {
    const w = hero('warlock', { 3: 1 }, { 3: 2 });
    const game = mkGame({ heroes: [w] });

    game.refreshSlotsOnRoomClear();
    expect(w.data.slots[3]).toBe(2);
    expect(game._slotRefreshedRooms.has(0)).toBe(true);

    // Room 1 is monster-free but counts as "cleared" by _roomCleared — the
    // hadMonsters gate must skip it, so no extra slot for it.
    game.refreshSlotsOnRoomClear();
    expect(w.data.slots[3]).toBe(2);
    expect(game._slotRefreshedRooms.has(1)).toBe(false);
  });

  it('skips downed warlocks', () => {
    const downed = hero('warlock', { 3: 1 }, { 3: 2 }, 0); // hp 0
    const game = mkGame({ heroes: [downed] });

    game.refreshSlotsOnRoomClear();

    expect(downed.data.slots[3]).toBe(1);
  });
});
