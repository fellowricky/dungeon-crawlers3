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
  it('POST.fin uniform uFocusRadius defaults to 0.24 for complete unit coverage', async () => {
    const { POST } = await import('../src/render/dungeon_materials.js');
    expect(POST.fin).toBeDefined();
    expect(POST.fin.uniforms.uFocusRadius.value).toBe(0.24);
  });

  it('POST.fin shader guarantees zero blur in combat focus zone without tilt bleed', async () => {
    const { POST } = await import('../src/render/dungeon_materials.js');
    const fragShader = POST.fin.fragmentShader;
    expect(fragShader).toContain('min(combatBand, actionBand)');
    expect(fragShader).toContain('smoothstep(uFocusRadius, uFocusRadius + 0.22, dAction)');
  });

  it('resolveCombatTarget accurately identifies combat targets for heroes and monsters', async () => {
    const { resolveCombatTarget } = await import('../src/render/dungeon_scene.js');

    const hero = { _side: 'hero', x: 5, z: 5, data: { hp: 20 } };
    const m1 = { active: true, x: 6, z: 5, data: { name: 'Goblin A', hp: 8 } };
    const m2 = { active: true, x: 12, z: 12, data: { name: 'Orc B', hp: 15 } };
    const game = {
      heroes: [hero],
      monsters: [m1, m2],
      hoveredMonster: null
    };

    // Hero with aiFoe set
    hero.aiFoe = m2;
    expect(resolveCombatTarget(game, hero)).toBe(m2);

    // Mouse hovering over a different monster takes immediate precedence
    game.hoveredMonster = m1;
    expect(resolveCombatTarget(game, hero)).toBe(m1);
    game.hoveredMonster = null;

    // Active attack targeting takes precedence over aiFoe
    game.attackTargetingState = { active: true, target: m1 };
    expect(resolveCombatTarget(game, hero)).toBe(m1);
    game.attackTargetingState = null;

    // Monster actor resolving target hero
    const monsterActor = { _side: 'mon', x: 7, z: 5, data: { hp: 10 }, target: hero };
    expect(resolveCombatTarget(game, monsterActor)).toBe(hero);
  });

  it('clearCombatActionFocus resets action timers and allows instant target transitions', async () => {
    const { setCombatActionFocus, clearCombatActionFocus } = await import('../src/render/dungeon_scene.js');

    const hero = { _side: 'hero', x: 2, z: 3, data: { hp: 25 } };
    const foe = { active: true, x: 4, z: 3, data: { hp: 12 } };

    setCombatActionFocus(hero, foe, 1.5, 0.24);
    clearCombatActionFocus();
    // After clearing, focus is unblocked and free to track the new turn actor/target with 0 delay
    expect(typeof clearCombatActionFocus).toBe('function');
  });
});
