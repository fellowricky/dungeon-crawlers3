import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

if (typeof globalThis.document === 'undefined') {
  globalThis.innerWidth = 1920;
  globalThis.innerHeight = 1080;
  class MockImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this._src = '';
      this.naturalWidth = 32;
      this.naturalHeight = 32;
      this.width = 32;
      this.height = 32;
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
    setAttribute: () => {}, addEventListener: () => {}, style: {},
    getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
    getContext: () => dummyCtx,
    querySelector: () => dummyEl,
    querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    appendChild: () => {}
  };
  globalThis.document = {
    createElement: () => dummyEl, createElementNS: () => dummyEl,
    getElementById: () => null, querySelector: () => dummyEl, querySelectorAll: () => [], body: dummyEl
  };
}

describe('Door Rumble & Sink Animation', () => {
  function makeMockGame() {
    const s = {
      n: 1,
      px: new Float32Array([10.0]),
      py: new Float32Array([0.0]),
      pz: new Float32Array([15.0]),
      rx: new Float32Array([0.0]),
      ry: new Float32Array([0.0]),
      rz: new Float32Array([0.0]),
      sx: new Float32Array([1.0]),
      sy: new Float32Array([1.8]),
      sz: new Float32Array([1.0]),
    };

    const gateMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 1);
    gateMesh.userData = { set: s, _origPy: [0.0] };

    const g = {
      D: {
        W: 20,
        H: 20,
        arches: [{ x: 10.0, y: 15.0, len: 1.0, cells: [310] }],
        cellToArch: Int16Array.from({ length: 400 }, (_, i) => (i === 310 ? 0 : -1))
      },
      _unlockedDoors: new Set(),
      heroes: [{ x: 10.0, z: 14.0, data: { hp: 20 }, active: true }],
      combat: false,
      initiative: { active: false },
      engine: {
        getMeshes: () => ({ gate: gateMesh })
      },
      wx: (x) => x,
      wz: (z) => z,
      isCombatActive: () => false,
      isDoorClosed: function(idx) { return !this._unlockedDoors.has(idx); }
    };

    return g;
  }

  it('initiates rumbling and slides door down to -2.6 on open', async () => {
    const { game } = await import('../src/game/game.js');
    const mock = makeMockGame();
    const gameProto = Object.getPrototypeOf(game);

    mock.updateDoors = gameProto.updateDoors.bind(mock);
    mock.syncDoorVisuals = gameProto.syncDoorVisuals.bind(mock);

    // Initial state: door is closed at y = 0
    expect(mock._unlockedDoors.has(0)).toBe(false);

    // 1st tick (0.2s): should start unlock timer and animation
    mock.updateDoors(0.2);
    expect(mock._doorUnlockTimers[0]).toBeDefined();
    expect(mock._animatingDoors).toBeDefined();
    expect(mock._animatingDoors.has(0)).toBe(true);

    const s = mock.engine.getMeshes().gate.userData.set;
    // During animation, door should start sinking below 0
    expect(s.py[0]).toBeLessThan(0);

    // Advance through rest of unlock (0.45s more -> total 0.65s)
    mock.updateDoors(0.45);
    expect(mock._unlockedDoors.has(0)).toBe(true);
    expect(s.py[0]).toBeLessThanOrEqual(-2.5); // completely sunken into the ground
    mock.syncDoorVisuals();
    expect(s.py[0]).toBe(-10.0); // hidden deep beneath the floor
  });
});
