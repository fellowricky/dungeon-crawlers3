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

describe('Item Lock Protection from Sell-All', () => {
  it('protects locked items from bulk sellByRarity', async () => {
    const { game } = await import('../src/game/game.js');
    game.gold = 0;
    game.inventory = [
      { id: '1', name: 'Common Sword', rarity: 'common', value: 10, locked: false },
      { id: '2', name: 'Locked Common Ring', rarity: 'common', value: 15, locked: true },
      { id: '3', name: 'Rare Helm', rarity: 'rare', value: 50, locked: false }
    ];

    const soldCount = game.sellByRarity('common');
    expect(soldCount).toBe(1);
    expect(game.inventory.length).toBe(2);
    expect(game.inventory.some(it => it.id === '2')).toBe(true);
  });

  it('prevents single sell on a locked item', async () => {
    const { game } = await import('../src/game/game.js');
    game.gold = 0;
    const lockedItem = { id: '2', name: 'Locked Ring', rarity: 'common', value: 15, locked: true };
    game.inventory = [lockedItem];

    game.sellItem(lockedItem);
    expect(game.inventory.length).toBe(1);
    expect(game.gold).toBe(0);
  });
});
