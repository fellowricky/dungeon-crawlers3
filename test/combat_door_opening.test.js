/* ─────────── No door opens during combat. Period. ───────────
 *
 * The reported bug, in the player's words: "doors are opening in combat,
 * allowing multiple rooms worth of enemies to join a fight." Then, after two
 * narrower fixes still leaked: "They should never be able to be opened.
 * period. during combat."
 *
 * So the rule is absolute, and this file pins it at every door that has ever
 * been left ajar:
 *
 *   - updateDoors        — proximity. Opened any arch a hero came within 2.2
 *                          of, which in melee is constant.
 *   - updateDoors        — path routing. The "only if you're going through it"
 *                          exception, which still leaked because pathing sends
 *                          heroes through gates mid-fight.
 *   - forceDoorsAlongPath / forceOpenAllDoors — the stall watchdog's old
 *                          remedy, and a back door is still a back door.
 *
 * A fight that genuinely cannot be reached is ENDED rather than forced open —
 * see _breakCombatStall, which now retires unreachable monsters so combat
 * lapses and the doors resume working out of combat.
 *
 * Sister file: combat_room_pull.test.js, which pins the aggro half.
 */
import { describe, it, expect } from 'vitest';

/* game.js reaches the renderer on import; the suite's standard stub. */
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

/** A world carrying the REAL updateDoors, bound to a plain object. */
async function scene({ inCombat, heroCellX, path = null }) {
  const { game } = await import('../src/game/game.js');
  const proto = Object.getPrototypeOf(game);

  const cellToArch = Int16Array.from({ length: W * H }, (_, i) => (i === DOOR ? 0 : -1));
  const wx = (x) => x, wz = (y) => y;

  const hero = {
    x: heroCellX, z: DOORZ,
    data: { hp: 30, maxHp: 30, name: 'Hero' },
    path, pathI: 0
  };

  const g = {
    D: { W, H, arches: [{ x: DOORX, y: DOORZ, len: 1.0, cells: [DOOR] }], cellToArch },
    wx, wz,
    heroes: [hero],
    monsters: [],
    _unlockedDoors: new Set(),
    combat: inCombat,
    initiative: { active: inCombat },
    engine: { getMeshes: () => null },
    isCombatActive() { return !!(this.combat || (this.initiative && this.initiative.active)); },
    isDoorClosed(i) { return !this._unlockedDoors.has(i); },
    clearEntityPath(e) { e.path = null; e.pathI = 0; },
  };
  g.updateDoors = proto.updateDoors.bind(g);
  g.syncDoorVisuals = proto.syncDoorVisuals.bind(g);
  return { g, hero };
}

/** Tick past the 0.6s unlock timer. */
const pump = (g) => { for (let i = 0; i < 20; i++) g.updateDoors(1 / 30); };

describe('while a fight is running', () => {
  it('does NOT open a gate a hero is merely fighting beside', async () => {
    /* THE BUG: two cells from the arch is ordinary melee spacing, and the
       gate used to swing open on its own 0.6s later. */
    const { g } = await scene({ inCombat: true, heroCellX: DOORX - 2 });
    pump(g);
    expect(g._unlockedDoors.has(0), 'gate opened just because a hero fought beside it').toBe(false);
  });

  it('does not open one even with the hero right on the threshold', async () => {
    const { g } = await scene({ inCombat: true, heroCellX: DOORX - 1 });
    pump(g);
    expect(g._unlockedDoors.has(0)).toBe(false);
  });

  it('does not open one even for a hero routing straight through it', async () => {
    /* The last exception standing, and it still leaked: pathing routinely
       sends heroes through gates mid-fight. */
    const { g } = await scene({
      inCombat: true, heroCellX: DOORX - 2,
      path: [DOORZ * W + (DOORX - 2), DOORZ * W + (DOORX - 1), DOOR, DOORZ * W + (DOORX + 1)]
    });
    pump(g);
    expect(g._unlockedDoors.has(0), 'routing through a gate still opened it mid-fight').toBe(false);
  });

  it('cancels an unlock that was already counting down when the fight started', async () => {
    /* Walk up to a gate out of combat, get jumped before it finishes: the
       gate must go back, not finish swinging. */
    const { g } = await scene({ inCombat: false, heroCellX: DOORX - 2 });
    g.updateDoors(0.3);                       // part-way through the 0.6s unlock
    expect(g._doorUnlockTimers[0]).toBeDefined();

    g.combat = true;
    g.initiative.active = true;
    pump(g);
    expect(g._unlockedDoors.has(0), 'an in-flight unlock completed during a fight').toBe(false);
    expect(g._doorUnlockTimers[0]).toBeUndefined();
  });

  it('refuses the force-open helpers the stall watchdog used to call', async () => {
    const { g } = await scene({ inCombat: true, heroCellX: DOORX - 2 });
    const { game } = await import('../src/game/game.js');
    const proto = Object.getPrototypeOf(game);
    g.forceDoorsAlongPath = proto.forceDoorsAlongPath.bind(g);
    g.forceOpenAllDoors = proto.forceOpenAllDoors.bind(g);
    g.syncDoorVisuals = proto.syncDoorVisuals.bind(g);

    expect(g.forceDoorsAlongPath([DOOR])).toBe(false);
    expect(g.forceOpenAllDoors()).toBe(false);
    expect(g._unlockedDoors.has(0)).toBe(false);
  });

  it('lets those same helpers work once the fight is over', async () => {
    const { g } = await scene({ inCombat: false, heroCellX: DOORX - 6 });
    const { game } = await import('../src/game/game.js');
    const proto = Object.getPrototypeOf(game);
    g.forceDoorsAlongPath = proto.forceDoorsAlongPath.bind(g);
    g.syncDoorVisuals = proto.syncDoorVisuals.bind(g);

    expect(g.forceDoorsAlongPath([DOOR])).toBe(true);
    expect(g._unlockedDoors.has(0)).toBe(true);
  });
});

describe('while exploring', () => {
  it('still opens a gate on plain proximity', async () => {
    const { g } = await scene({ inCombat: false, heroCellX: DOORX - 2 });
    pump(g);
    expect(g._unlockedDoors.has(0), 'walking up to a door no longer opens it').toBe(true);
  });

  it('still leaves a distant gate alone', async () => {
    const { g } = await scene({ inCombat: false, heroCellX: DOORX - 6 });
    pump(g);
    expect(g._unlockedDoors.has(0)).toBe(false);
  });
});
