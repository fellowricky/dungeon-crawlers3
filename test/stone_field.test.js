/* Columns and sarcophagi share matStone. The ashlar has to keep real
 * contrast and a recessed joint, or a theme tint paints them one colour. */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

if (typeof globalThis.document === 'undefined') {
  globalThis.innerWidth = 1920;
  globalThis.innerHeight = 1080;
  const dummyCtx = new Proxy({
    font: '', measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8Array(4) }),
    createImageData: (w = 1, h = 1) => ({ data: new Uint8Array(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} })
  }, { get(t, p) { return p in t ? t[p] : () => {}; } });
  const dummyEl = {
    setAttribute: () => {}, addEventListener: () => {}, style: {},
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
    getContext: () => dummyCtx, querySelector: () => dummyEl, querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {} }, appendChild: () => {}
  };
  globalThis.document = {
    createElement: () => dummyEl, createElementNS: () => dummyEl,
    getElementById: () => null, querySelector: () => dummyEl, querySelectorAll: () => [], body: dummyEl
  };
  globalThis.window = globalThis;
}

function lumAt(rgba, i) {
  return 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
}

describe('stone ashlar', () => {
  it('breaks the field into blocks, joints and a real height range', async () => {
    const { paintStoneField } = await import('../src/render/dungeon_materials.js');
    const { rgba, height } = paintStoneField(256);
    const S = 256;
    const centers = [];
    const COLS = 3, ROWS = 5;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const x = Math.floor((col + 0.5) * S / COLS);
        const y = Math.floor((row + 0.5) * S / ROWS);
        centers.push(lumAt(rgba, (y * S + x) * 4));
      }
    }
    const cMin = Math.min(...centers), cMax = Math.max(...centers);
    expect(cMax - cMin).toBeGreaterThan(40);

    let face = 0, faceN = 0, joint = 0, jointN = 0;
    let hMin = 255, hMax = 0;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const L = lumAt(rgba, i * 4);
        const H = height[i];
        if (H < hMin) hMin = H;
        if (H > hMax) hMax = H;
        if (H < 40) { joint += L; jointN++; }
        else if (H > 170) { face += L; faceN++; }
      }
    }
    expect(jointN).toBeGreaterThan(S * S * 0.08);
    expect(faceN).toBeGreaterThan(S * S * 0.4);
    expect(joint / jointN).toBeLessThan((face / faceN) * 0.55);
    expect(hMax - hMin).toBeGreaterThan(120);
  });

  it('keeps the stone material on that bump, shifted per prop', async () => {
    const mats = await import('../src/render/dungeon_materials.js');
    expect(mats.matStone.bumpScale).toBeGreaterThan(1);
    expect(mats.matStone.bumpMap).toBeTruthy();
    expect(mats.matStone.bumpMap.colorSpace).toBe(THREE.NoColorSpace);
    expect(mats.matStone.map.magFilter).toBe(THREE.NearestFilter);
    expect(mats.matStone.normalMap).toBeFalsy();
    expect(mats.matStone.userData.propUvJitter).toBe(1);
  });
});
