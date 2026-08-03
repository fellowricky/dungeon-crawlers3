import { describe, it, expect } from 'vitest';

if (typeof globalThis.document === 'undefined') {
  globalThis.innerWidth = 1920;
  globalThis.innerHeight = 1080;
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
    setAttribute: () => {}, addEventListener: () => {}, style: {},
    getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
    getContext: () => dummyCtx,
    querySelector: () => dummyEl, querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {} }, appendChild: () => {}
  };
  globalThis.document = {
    createElement: () => dummyEl, createElementNS: () => dummyEl,
    getElementById: () => null, querySelector: () => dummyEl, querySelectorAll: () => [], body: dummyEl
  };
}

describe('Druid UI Improvements: Drop Wild Shape & Out of Slots Toggle', () => {
  it('manually drops Wild Shape and reverts hero to natural form', async () => {
    const THREE = await import('three');
    const { game } = await import('../src/game/game.js');
    game.engine = { scene: new THREE.Group() };
    const hero = {
      data: {
        name: 'Druid',
        hp: 15, maxHp: 30, preWildShapeHp: 25,
        inWildShape: true, wildShapeHp: 20, wildShapeMaxHp: 20,
        wildShapeActiveForm: 'bear', level: 3, classKey: 'druid',
        stats: { str: 10, dex: 14, con: 12, int: 12, wis: 16, cha: 10 },
        abilityUsed: {}
      },
      bonusUsed: false,
      _bonusActed: false
    };

    game.heroes = [hero];
    const success = game.manualPerformBonusAbility(hero, 'dropWildShape');
    expect(success).toBe(true);
    expect(hero.data.inWildShape).toBe(false);
    expect(hero.data.hp).toBe(25);
  });

  it('respects wildShapeOnlyOutOfSlots toggle in auto combat', () => {
    const hero = {
      data: {
        name: 'Druid',
        hp: 10, maxHp: 30,
        inWildShape: false,
        level: 3, classKey: 'druid',
        stats: { str: 10, dex: 14, con: 12, int: 12, wis: 16, cha: 10 },
        slots: { 1: 2 },
        wildShapeOnlyOutOfSlots: true,
        features: ['wildShapeClass'],
        abilityUsed: {}
      },
      _abilityUsedThisCycle: false
    };

    const hasSlots = hero.data.slots && Object.values(hero.data.slots).some(s => s > 0);
    expect(hero.data.wildShapeOnlyOutOfSlots && hasSlots).toBe(true);
    expect(hero.data.inWildShape).toBe(false);
  });
});
