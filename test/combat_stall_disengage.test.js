/* ───────── A fight nobody can reach ends; it does not force a gate ─────────
 *
 * _breakCombatStall used to force open the gate between the combatants. That
 * was the one remaining way a door could open mid-fight, and "doors opened
 * during combat" is the bug this whole line of work exists to kill.
 *
 * The remedy is inverted now: monsters with no door-free route to any living
 * hero lose interest and go back to sleep. heroDecideTarget only targets
 * active monsters, so combat lapses on its own, and out of combat the doors
 * work normally again — the party walks up, the gate swings, and the fight
 * starts on its own terms with one room in it.
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

const W = 21, H = 9, DOORX = 10, DOORZ = 4, DOOR = DOORZ * W + DOORX;

async function scene() {
  const { game } = await import('../src/game/game.js');
  const { pathfindingMethods } = await import('../src/game/pathfinding.js');
  const { FLOOR, WALL } = await import('../src/game/constants.js');
  const proto = Object.getPrototypeOf(game);

  const grid = new Uint8Array(W * H).fill(FLOOR);
  for (let z = 0; z < H; z++) if (z !== DOORZ) grid[z * W + DOORX] = WALL;
  const cellToArch = Int16Array.from({ length: W * H }, (_, i) => (i === DOOR ? 0 : -1));

  const hero = { x: DOORX - 3, z: DOORZ, data: { hp: 30, maxHp: 30, name: 'Hero' }, path: null, pathI: 0 };
  /* An active monster on the far side of the shut gate — the classic jam. */
  const walled = { x: DOORX + 3, z: DOORZ, active: true, roomId: 1,
                   ent: { grp: { visible: true } }, data: { hp: 20, maxHp: 20, name: 'Walled' } };
  /* And one in the room WITH the party, which must be left alone. */
  const near = { x: DOORX - 4, z: DOORZ, active: true, roomId: 0,
                 ent: { grp: { visible: true } }, data: { hp: 20, maxHp: 20, name: 'Near' } };

  const g = Object.assign({}, pathfindingMethods, {
    D: { W, H, grid, cellToArch, wallAdj: null, chokepoint: null, solidProps: null,
         arches: [{ x: DOORX, y: DOORZ, cells: [DOOR] }] },
    wx: (x) => x, wz: (y) => y,
    cellOf: (x, z) => {
      const cx = Math.round(x), cy = Math.round(z);
      return (cx < 0 || cy < 0 || cx >= W || cy >= H) ? -1 : cy * W + cx;
    },
    heroes: [hero], monsters: [walled, near],
    _unlockedDoors: new Set(),
    combat: true, initiative: { active: true },
    isCombatActive() { return !!(this.combat || (this.initiative && this.initiative.active)); },
    isDoorClosed(i) { return !this._unlockedDoors.has(i); },
    isCellDoorClosed(c) { const a = cellToArch[c]; return a >= 0 && this.isDoorClosed(a); },
    isCellReserved: () => false,
    clearEntityPath(e) { e.path = null; e.pathI = 0; },
    engine: { getMeshes: () => null },
  });
  g._breakCombatStall = proto._breakCombatStall.bind(g);
  g._shutGateIsTheOnlyThingBetween = proto._shutGateIsTheOnlyThingBetween.bind(g);
  g.forceDoorsAlongPath = proto.forceDoorsAlongPath.bind(g);
  g.syncDoorVisuals = proto.syncDoorVisuals.bind(g);
  return { g, hero, walled, near };
}

describe('breaking a stalled fight', () => {
  it('does not open the gate between the combatants', async () => {
    const { g } = await scene();
    g._breakCombatStall();
    expect(g._unlockedDoors.has(0), 'the stall breaker forced a gate open mid-fight').toBe(false);
  });

  it('retires the monster nobody can reach, so combat can lapse', async () => {
    const { g, walled } = await scene();
    g._breakCombatStall();
    expect(walled.active, 'an unreachable monster kept the party in combat forever').toBe(false);
  });

  it('leaves the monsters that ARE reachable in the fight', async () => {
    const { g, near } = await scene();
    g._breakCombatStall();
    expect(near.active, 'retired a monster standing in the same room as the party').toBe(true);
  });

  it('only retires monsters a SHUT GATE is blocking, not ones blocked some other way', async () => {
    /* The false positive this is built to avoid. Retiring a monster is the
       remedy for "a closed door is in the way" and nothing else — if the route
       is blocked for any other reason, both the with-doors and without-doors
       queries fail alike and the monster stays in the fight, because clearing
       paths is what shakes a wedge loose. Here the gate is already OPEN, so
       nothing is door-blocked and nobody should be retired. */
    const { g, walled, near } = await scene();
    g._unlockedDoors.add(0);
    g._breakCombatStall();
    expect(walled.active).toBe(true);
    expect(near.active).toBe(true);
  });

  it('clears paths so a merely wedged fight shakes loose', async () => {
    const { g, hero, near } = await scene();
    hero.path = [1, 2, 3]; near.path = [4, 5, 6];
    g._breakCombatStall();
    expect(hero.path).toBeNull();
    expect(near.path).toBeNull();
  });
});
