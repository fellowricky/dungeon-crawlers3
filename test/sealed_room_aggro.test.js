import { describe, it, expect } from 'vitest';
import { monsterAiMethods } from '../src/game/monster_ai.js';
import { FLOOR, WALL } from '../src/game/constants.js';

/*
 * A 9x3 corridor split by a doorway at x=4:
 *
 *   x: 0 1 2 3 [4] 5 6 7 8
 *   room 0     door    room 1
 *
 * Heroes stand at x=1 (room 0). The monster sits at x=7 (room 1). Whether the
 * two can meet depends entirely on the door.
 */
const W = 9, H = 3, DOOR_X = 4, ROW = 1;
const cell = (x, y = ROW) => y * W + x;

function makeMap() {
  const grid = new Uint8Array(W * H).fill(WALL);
  const roomId = new Int16Array(W * H).fill(-1);
  for (let x = 0; x < W; x++) {
    grid[cell(x)] = FLOOR;
    roomId[cell(x)] = x < DOOR_X ? 0 : x > DOOR_X ? 1 : -1;   // door cell is corridor
  }
  return { W, H, grid, roomId };
}

function makeGame({ doorOpen }) {
  return Object.assign(Object.create(monsterAiMethods), {
    D: makeMap(),
    _unlockedDoors: new Set(doorOpen ? [0] : []),
    cellOf: (x) => cell(Math.round(x)),
    isCellDoorClosed: (c) => c === cell(DOOR_X) && !doorOpen,
  });
}

const heroes = [{ x: 1, z: ROW }];
const monster = { roomId: 1, x: 7, z: ROW };

describe('sealed rooms cannot start combat', () => {
  it('reports a monster behind a closed door as sealed', () => {
    expect(makeGame({ doorOpen: false })._sealedFromParty(monster, heroes)).toBe(true);
  });

  it('reports it as reachable once the door is open', () => {
    expect(makeGame({ doorOpen: true })._sealedFromParty(monster, heroes)).toBe(false);
  });

  it('never seals a monster sharing the party’s room', () => {
    const sameRoom = { roomId: 0, x: 2, z: ROW };
    expect(makeGame({ doorOpen: false })._sealedFromParty(sameRoom, heroes)).toBe(false);
  });

  it('collects exactly the rooms on the party’s side of a shut door', () => {
    const g = makeGame({ doorOpen: false });
    const rooms = g._partyReachableRooms(heroes);
    expect(rooms.has(0)).toBe(true);
    expect(rooms.has(1)).toBe(false);
  });

  it('reaches both rooms when the door is open', () => {
    const rooms = makeGame({ doorOpen: true })._partyReachableRooms(heroes);
    expect(rooms.has(0)).toBe(true);
    expect(rooms.has(1)).toBe(true);
  });

  /* The gate must not fail closed on missing data, or monsters would stop
     waking entirely on maps without room ids. */
  it('does not seal anything when there is no map to reason about', () => {
    const g = Object.assign(Object.create(monsterAiMethods), { D: null });
    expect(g._sealedFromParty(monster, heroes)).toBe(false);
  });

  it('does not seal a monster with no room id', () => {
    const g = makeGame({ doorOpen: false });
    expect(g._sealedFromParty({ roomId: -1, x: 7, z: ROW }, heroes)).toBe(false);
  });

  it('caches per door state, and re-answers when the door opens', () => {
    const g = makeGame({ doorOpen: false });
    expect(g._sealedFromParty(monster, heroes)).toBe(true);
    /* Same call twice must hit the cache and agree with itself. */
    expect(g._sealedFromParty(monster, heroes)).toBe(true);

    g._unlockedDoors.add(1);                       // door state changed
    g.isCellDoorClosed = () => false;
    expect(g._sealedFromParty(monster, heroes)).toBe(false);
  });
});
