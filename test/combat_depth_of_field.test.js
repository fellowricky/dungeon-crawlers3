import { describe, it, expect } from 'vitest';

if (typeof globalThis.document === 'undefined') {
  globalThis.innerWidth = 1920;
  globalThis.innerHeight = 1080;
  class MockImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this._src = '';
    }
    get src() { return this._src; }
    set src(val) {
      this._src = val;
      setTimeout(() => { if (this.onload) this.onload(); }, 1);
    }
  }
  globalThis.Image = MockImage;

  const dummyCtx = new Proxy({
    font: '', measureText: () => ({ width: 10 }),
    getImageData: (w, h) => ({ data: new Uint8Array(4) }),
    createImageData: (w = 100, h = 100) => ({ data: new Uint8Array(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} })
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {};
    }
  });
  const dummyEl = {
    setAttribute: () => {}, addEventListener: () => {}, style: { setProperty: () => {} },
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 1920, width: 1920, height: 1080 }),
    getContext: () => dummyCtx,
    querySelector: () => dummyEl,
    querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    appendChild: () => {}
  };
  globalThis.document = {
    documentElement: dummyEl,
    createElement: () => dummyEl, createElementNS: () => dummyEl,
    getElementById: () => null, querySelector: () => dummyEl, querySelectorAll: () => [], body: dummyEl
  };
  globalThis.window = globalThis;
}

describe('Combat Depth of Field & Action Focus', () => {
  it('the final pass keeps focused creatures sharp through the focus mask and a world-sized capsule', async () => {
    const { POST } = await import('../src/render/dungeon_materials.js');
    const frag = POST.fin.fragmentShader;
    expect(POST.fin.uniforms.tFocus).toBeDefined();
    expect(frag).toContain('texture2D(tFocus, vUv)');
    expect(frag).toContain('max(capsuleSharp, maskSharp)');
    /* the explore band follows the party and fades as the camera pulls out */
    expect(frag).toContain('abs(vUv.y - uBandY)');
    expect(frag).toContain('uExploreFade');
  });

  it('focus follows declared targets, never the cursor', async () => {
    const { resolveCombatTarget } = await import('../src/render/dungeon_scene.js');
    const hero = { _side: 'hero', x: 5, z: 5, data: { hp: 20 } };
    const m1 = { active: true, x: 6, z: 5, data: { name: 'Goblin A', hp: 8 } };
    const m2 = { active: true, x: 12, z: 12, data: { name: 'Orc B', hp: 15 } };
    const game = { heroes: [hero], monsters: [m1, m2], hoveredMonster: null };

    hero.aiFoe = m2;
    expect(resolveCombatTarget(game, hero)).toBe(m2);

    /* hovering another monster does NOT pull the focus off the declared target */
    game.hoveredMonster = m1; game.hoveredUnit = m1;
    expect(resolveCombatTarget(game, hero)).toBe(m2);
    game.hoveredMonster = game.hoveredUnit = null;

    /* aiming a manual attack declares its target */
    game.attackTargetingState = { active: true, target: m1 };
    expect(resolveCombatTarget(game, hero)).toBe(m1);
    game.attackTargetingState = null;

    /* a monster's declared target */
    const monsterActor = { _side: 'mon', x: 7, z: 5, data: { hp: 10 }, target: hero };
    expect(resolveCombatTarget(game, monsterActor)).toBe(hero);

    /* nothing declared: no guess (the old nearest-enemy fallback put focus on the wrong creature) */
    expect(resolveCombatTarget(game, { _side: 'mon', x: 1, z: 1, data: { hp: 3 } })).toBe(null);
  });

  it('an action can focus a whole list of targets, and clearing drops them', async () => {
    const { setCombatActionFocus, clearCombatActionFocus } = await import('../src/render/dungeon_scene.js');
    const hero = { _side: 'hero', x: 2, z: 3, data: { hp: 25 }, ent: {} };
    const foes = [{ active: true, x: 4, z: 3, data: { hp: 12 }, ent: {} }, { active: true, x: 5, z: 4, data: { hp: 9 }, ent: {} }];
    expect(() => setCombatActionFocus(hero, foes, 1.0)).not.toThrow();
    expect(() => setCombatActionFocus(hero, { x: 3, y: 0, z: 3 }, 0.9)).not.toThrow();   // an area's centre point
    clearCombatActionFocus();
  });

  it('a creature leaving the focus lingers sharp, then fades; a newcomer is sharp at once', async () => {
    const { focusWeights, FOCUS_LINGER, FOCUS_FADE } = await import('../src/render/dungeon_scene.js');
    const last = new Map();
    const old = { name: 'old' }, next = { name: 'next' };
    const w = (list, t) => Object.fromEntries(focusWeights(list, t, last).map((r) => [r.e.name, r.w]));
    expect(w([old], 0)).toEqual({ old: 1 });
    /* the turn passes: the newcomer is fully sharp, the old one still is too */
    expect(w([next], 0.1)).toEqual({ old: 1, next: 1 });
    expect(w([next], FOCUS_LINGER)).toMatchObject({ old: 1 });
    /* then it softens, part way through the fade */
    const mid = w([next], FOCUS_LINGER + FOCUS_FADE / 2).old;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    /* and is gone once the fade is over */
    expect(w([next], FOCUS_LINGER + FOCUS_FADE + 0.01)).toEqual({ next: 1 });
  });

  it('the whole combat room stays sharp: room cells, its wall ring, and a disc round each combatant', async () => {
    const { combatAreaCells, COMBAT_AREA_DISC_NO_ROOM } = await import('../src/render/dungeon_scene.js');
    const W = 20, H = 20;
    const roomId = new Int32Array(W * H).fill(-1);
    for (let y = 5; y <= 8; y++) for (let x = 5; x <= 8; x++) roomId[y * W + x] = 3;   // a 4x4 room
    for (let y = 5; y <= 8; y++) for (let x = 12; x <= 15; x++) roomId[y * W + x] = 4; // the room next door
    const D = { W, H, roomId };
    const cells = new Set(combatAreaCells(D, 3, [6 * W + 6]));
    expect(cells.has(6 * W + 6)).toBe(true);           // inside the room
    expect(cells.has(4 * W + 4)).toBe(true);           // its wall ring
    expect(cells.has(13 * W + 13)).toBe(false);        // far away
    expect(cells.has(6 * W + 13)).toBe(false);         // the next room blurs
    /* a combatant out in the corridor keeps a disc round it */
    const spill = new Set(combatAreaCells(D, 3, [6 * W + 11]));
    expect(spill.has(6 * W + 11)).toBe(true);
    /* no room at all: wider discs round the combatants */
    const open = new Set(combatAreaCells(D, -1, [10 * W + 10]));
    expect(open.has(10 * W + 10 + COMBAT_AREA_DISC_NO_ROOM)).toBe(true);
    expect(open.has(0)).toBe(false);
  });
});
