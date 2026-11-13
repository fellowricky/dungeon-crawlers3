import { describe, it, expect } from 'vitest';
import { generateDungeon, THEMES, TYPE } from '../src/dungeon/dungeon_generator.js';

if (typeof globalThis.document === 'undefined') {
  globalThis.innerWidth = 1920;
  globalThis.innerHeight = 1080;
  const dummyCtx = new Proxy({
    font: '', measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8Array(4) }),
    createImageData: (w = 100, h = 100) => ({ data: new Uint8Array(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} })
  }, { get(t, p) { return p in t ? t[p] : () => {}; } });
  const dummyEl = {
    setAttribute: () => {}, addEventListener: () => {}, style: { setProperty: () => {} },
    getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
    getContext: () => dummyCtx,
    querySelector: () => dummyEl, querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    appendChild: () => {}
  };
  globalThis.document = {
    createElement: () => dummyEl, createElementNS: () => dummyEl,
    getElementById: () => null, querySelector: () => dummyEl, querySelectorAll: () => [],
    body: dummyEl, documentElement: dummyEl
  };
}

describe('Molten dungeon floor tinting', () => {
  it('has roomTint disabled in theme definition', () => {
    expect(THEMES.molten.roomTint).toBe(false);
  });

  it('does not tint entrance or treasure room floors with rainbow colors in molten', async () => {
    const sc = await import('../src/render/dungeon_scene.js');
    const d = generateDungeon(12345, { seed: 12345, roomCount: 15, themeKey: 'molten' });
    sc.buildScene(d);

    const entranceRoomIdx = d.entrance;
    expect(entranceRoomIdx).toBeGreaterThanOrEqual(0);
    const entranceRoom = d.rooms[entranceRoomIdx];
    expect(entranceRoom.type).toBe(TYPE.ENTRANCE);

    // Pick interior cells of the entrance room (not touching walls/doors/pools)
    let entranceInteriorCells = [];
    for (let y = Math.floor(entranceRoom.cy - entranceRoom.h / 4); y <= Math.ceil(entranceRoom.cy + entranceRoom.h / 4); y++) {
      for (let x = Math.floor(entranceRoom.cx - entranceRoom.w / 4); x <= Math.ceil(entranceRoom.cx + entranceRoom.w / 4); x++) {
        const c = y * d.W + x;
        if (d.grid[c] === 1 /* FLOOR */ && d.roomId[c] === entranceRoomIdx && !d.doorway[c]) {
          entranceInteriorCells.push(c);
        }
      }
    }

    expect(entranceInteriorCells.length).toBeGreaterThan(0);

    for (const c of entranceInteriorCells) {
      const instIdx = sc.floorCellStart[c];
      expect(instIdx).toBeGreaterThanOrEqual(0);
      const colHex = sc.floorColorsBase[instIdx];
      const r = (colHex >> 16) & 255;
      const g = (colHex >> 8) & 255;
      const b = colHex & 255;

      // In ancient / non-molten, entrance tint is 0x3fd0bb (teal, high green/blue).
      // Molten TH.floor is 0x645448 (R: 100, G: 84, B: 72 -> R > G > B warm/neutral charcoal).
      // If tinted with 0x3fd0bb, green and blue would be boosted (G > R).
      // Without room tint, R remains strictly greater than G and B.
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(b);
    }
  });
});

