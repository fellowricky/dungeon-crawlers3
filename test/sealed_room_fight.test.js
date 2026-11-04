/* ───────── A hero alone past a shut gate must not strand the party ─────────
 *
 * Report: mid-fight, one hero ended up through a CLOSED door, woke the room
 * beyond, and died there. The survivors were then held in a fight they could
 * not reach: monsters do not path through a shut gate, heroes may not open
 * one during combat, and the stall watchdog is off in manual mode (and blind
 * whenever a regenerating monster keeps the HP total moving). Soft-lock.
 *
 * Two halves. How he got through: the relocation helpers (overlap fix,
 * snap-to-centre, out-of-bounds rescue, stuck-glide) scanned rings of cells
 * with no idea a door was in the ring. And why it never resolved: only
 * SLEEPING monsters were ever checked against "can the party reach this?".
 */
import { describe, it, expect } from 'vitest';

if (typeof globalThis.document === 'undefined') {
  globalThis.innerWidth = 1920;
  globalThis.innerHeight = 1080;
  class MockImage {
    constructor() { this.onload = null; this.onerror = null; this._src = ''; this.naturalWidth = 32; this.naturalHeight = 32; }
    get src() { return this._src; }
    set src(v) { this._src = v; setTimeout(() => { if (this.onload) this.onload(); }, 1); }
  }
  globalThis.Image = MockImage;
  const dummyCtx = new Proxy({
    font: '', measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8Array(4) }),
    createImageData: (w = 100, h = 100) => ({ data: new Uint8Array(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} })
  }, { get(t, p) { return p in t ? t[p] : () => {}; } });
  const dummyEl = {
    setAttribute: () => {}, addEventListener: () => {}, style: {},
    getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
    getContext: () => dummyCtx, querySelector: () => dummyEl, querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {} }, appendChild: () => {}
  };
  globalThis.document = {
    createElement: () => dummyEl, createElementNS: () => dummyEl,
    getElementById: () => null, querySelector: () => dummyEl, querySelectorAll: () => [], body: dummyEl
  };
}

/* Two rooms side by side, one wall column between them with a single gate
   cell in it. Room 0 is x < DOORX, room 1 is x > DOORX. */
const W = 21, H = 9, DOORX = 10, DOORZ = 4, DOOR = DOORZ * W + DOORX;

async function scene() {
  const { pathfindingMethods } = await import('../src/game/pathfinding.js');
  const { monsterAiMethods } = await import('../src/game/monster_ai.js');
  const { FLOOR, WALL } = await import('../src/game/constants.js');

  const grid = new Uint8Array(W * H).fill(FLOOR);
  for (let z = 0; z < H; z++) if (z !== DOORZ) grid[z * W + DOORX] = WALL;
  const roomId = Int16Array.from({ length: W * H }, (_, i) => ((i % W) < DOORX ? 0 : (i % W) > DOORX ? 1 : -1));
  const cellToArch = Int16Array.from({ length: W * H }, (_, i) => (i === DOOR ? 0 : -1));

  const mk = (name, x, z, extra = {}) => Object.assign(
    { x, z, data: { hp: 20, maxHp: 20, name }, path: null, pathI: 0, ent: { grp: { visible: true } } }, extra);

  const g = Object.assign({}, pathfindingMethods, monsterAiMethods, {
    D: { W, H, grid, roomId, cellToArch, wallAdj: null, chokepoint: null, solidProps: null,
         arches: [{ x: DOORX, y: DOORZ, cells: [DOOR] }] },
    wx: (x) => x, wz: (y) => y,
    cellOf: (x, z) => {
      const cx = Math.round(x), cy = Math.round(z);
      return (cx < 0 || cy < 0 || cx >= W || cy >= H) ? -1 : cy * W + cx;
    },
    heroes: [], monsters: [],
    visitedRooms: [true, true], revealed: new Uint8Array(W * H).fill(1),
    _unlockedDoors: new Set(),
    combat: true, initiative: { active: true },
    isCombatActive() { return !!(this.combat || (this.initiative && this.initiative.active)); },
    isDoorClosed(i) { return !this._unlockedDoors.has(i); },
    isCellDoorClosed(c) { const a = cellToArch[c]; return a >= 0 && this.isDoorClosed(a); },
    isCellReserved: () => false,
    clearEntityPath(e) { e.path = null; e.pathI = 0; },
    hasLOS: () => true,
    fxLog: () => {},
  });
  return { g, mk, FLOOR, WALL };
}

const cellX = (c) => c % W;

describe('relocation helpers respect a shut gate', () => {
  it('getUnoccupiedCellNear never hands a stacked body the doorway or the room beyond', async () => {
    const { g, mk } = await scene();
    /* Two heroes on the square right in front of the gate; every other
       square on their side of it within reach is taken too, so the only
       Euclidean candidates are the door cell and room 1. */
    const front = DOORZ * W + (DOORX - 1);
    const a = mk('A', DOORX - 1, DOORZ), b = mk('B', DOORX - 1, DOORZ);
    g.heroes = [a, b];
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 0; ox++) {
      if (!ox && !oy) continue;
      g.heroes.push(mk('filler', DOORX - 1 + ox, DOORZ + oy));
    }
    const free = g.getUnoccupiedCellNear(front, b, 2);
    expect(free, 'relocated a hero onto or through the shut gate').not.toBe(DOOR);
    expect(cellX(free) < DOORX, `relocated a hero into the sealed room (cell ${free})`).toBe(true);
  });

  it('getUnoccupiedCellNear still uses the doorway once the gate is open', async () => {
    const { g, mk } = await scene();
    g._unlockedDoors.add(0);
    const front = DOORZ * W + (DOORX - 1);
    const a = mk('A', DOORX - 1, DOORZ), b = mk('B', DOORX - 1, DOORZ);
    g.heroes = [a, b];
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 0; ox++) {
      if (!ox && !oy) continue;
      g.heroes.push(mk('filler', DOORX - 1 + ox, DOORZ + oy));
    }
    const free = g.getUnoccupiedCellNear(front, b, 2);
    expect(free).not.toBe(front);
    expect(cellX(free) >= DOORX).toBe(true);
  });

  it('nearFloorCell looks past a shut gate instead of landing a body in it', async () => {
    const { g, WALL } = await scene();
    /* The wall cell right above the gate, with every ring-1 floor cell the
       scan visits before the gate walled off, so the gate is the first
       candidate the old code would have taken. */
    const inWall = (DOORZ - 1) * W + DOORX;
    expect(g.D.grid[inWall]).toBe(WALL);
    for (const [ox, oy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1]]) {
      g.D.grid[(DOORZ - 1 + oy) * W + DOORX + ox] = WALL;
    }
    const c = g.nearFloorCell(inWall, 3);
    expect(c).not.toBe(DOOR);
    expect(g.D.grid[c]).not.toBe(WALL);
  });

  it('a stuck-recovery glide stops at the gate rather than hopping it', async () => {
    const { g, mk } = await scene();
    const h = mk('H', DOORX - 2, DOORZ);
    g.heroes = [h];
    g.initiative = { active: false }; g.combat = false;
    /* A glide aimed at room 1, sampled coarsely so single frames land past
       the door cell entirely — the old code let those through. */
    h._posTween = { fromX: h.x, fromZ: h.z, toX: DOORX + 2, toZ: DOORZ, t: 0, dur: 0.25 };
    for (let i = 0; i < 6; i++) g.stepAlong(h, 1.5, 0.1);
    expect(h.x < DOORX - 0.5, `glided through the shut gate to x=${h.x}`).toBe(true);
    expect(h._posTween).toBeNull();
  });
});

describe('an awake monster the survivors cannot reach', () => {
  it('is cut off once the only hero on its side is dead', async () => {
    const { g, mk } = await scene();
    const survivor = mk('Survivor', DOORX - 3, DOORZ);
    const fallen = mk('Fallen', DOORX + 3, DOORZ, { data: { hp: 0, maxHp: 20, name: 'Fallen' } });
    const walled = mk('Walled', DOORX + 4, DOORZ, { active: true, roomId: 1 });
    g.heroes = [survivor, fallen]; g.monsters = [walled];
    const alive = g.heroes.filter(h => h.data.hp > 0);
    expect(g._cutOffFromParty(walled, alive)).toBe(true);
  });

  it('is not cut off while that hero still stands', async () => {
    const { g, mk } = await scene();
    const survivor = mk('Survivor', DOORX - 3, DOORZ);
    const lone = mk('Lone', DOORX + 3, DOORZ);
    const walled = mk('Walled', DOORX + 4, DOORZ, { active: true, roomId: 1 });
    g.heroes = [survivor, lone]; g.monsters = [walled];
    expect(g._cutOffFromParty(walled, g.heroes)).toBe(false);
  });

  it('is not cut off through an open gate, nor when it is in the party\'s own room', async () => {
    const { g, mk } = await scene();
    const survivor = mk('Survivor', DOORX - 3, DOORZ);
    const walled = mk('Walled', DOORX + 4, DOORZ, { active: true, roomId: 1 });
    const near = mk('Near', DOORX - 5, DOORZ, { active: true, roomId: 0 });
    g.heroes = [survivor]; g.monsters = [walled, near];
    expect(g._cutOffFromParty(near, g.heroes)).toBe(false);
    g._unlockedDoors.add(0);
    expect(g._cutOffFromParty(walled, g.heroes)).toBe(false);
  });

  it('is judged by where it stands, not where it spawned', async () => {
    const { g, mk } = await scene();
    /* Spawned in room 1, but it chased the party into room 0 before the
       reach was cut — a spawn-room test would wrongly retire it. */
    const survivor = mk('Survivor', DOORX - 3, DOORZ);
    const chaser = mk('Chaser', DOORX - 5, DOORZ, { active: true, roomId: 1 });
    g.heroes = [survivor]; g.monsters = [chaser];
    expect(g._cutOffFromParty(chaser, g.heroes)).toBe(false);
  });

  it('a flyer over water is still in reach', async () => {
    const { g, mk } = await scene();
    const { POOL } = await import('../src/game/constants.js');
    const survivor = mk('Survivor', DOORX - 6, DOORZ);
    const px = DOORX - 3;
    for (let z = 0; z < H; z++) g.D.grid[z * W + px] = POOL;
    const stirge = mk('Stirge', px, DOORZ, { active: true, roomId: 0, data: { hp: 5, maxHp: 5, name: 'Stirge', tags: ['flying'] } });
    g.heroes = [survivor]; g.monsters = [stirge];
    expect(g._cutOffFromParty(stirge, g.heroes)).toBe(false);
  });

  it('updateMonsters puts it back to sleep so the fight can lapse', async () => {
    const { g, mk } = await scene();
    const survivor = mk('Survivor', DOORX - 3, DOORZ);
    const fallen = mk('Fallen', DOORX + 3, DOORZ, { data: { hp: 0, maxHp: 20, name: 'Fallen' } });
    const walled = mk('Walled', DOORX + 4, DOORZ, { active: true, roomId: 1, path: [1, 2, 3], pathI: 1 });
    const near = mk('Near', DOORX - 5, DOORZ, { active: true, roomId: 0 });
    g.heroes = [survivor, fallen]; g.monsters = [walled, near];
    /* Everything past the activation gate is out of scope here. */
    g.fxUpdateFlash = () => {}; g.fxStatusTray = () => {};
    g.pickMonsterTarget = () => null;
    const alive = g.heroes.filter(h => h.data.hp > 0);
    g.updateMonsters(alive, 0.016);
    expect(walled.active, 'a monster nobody can reach kept the fight alive').toBe(false);
    expect(walled.path).toBeNull();
    expect(near.active, 'retired a monster in the same room as the survivors').toBe(true);
    /* And it stays asleep on the next frame rather than flipping awake. */
    g.updateMonsters(alive, 0.016);
    expect(walled.active).toBe(false);
  });
});
