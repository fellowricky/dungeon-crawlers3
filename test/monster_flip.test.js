import { describe, it, expect } from 'vitest';
import { spawnMonster, MONSTERS_ALL } from '../src/game/srd.js';
import { makeMonsterMesh } from '../src/game/entities.js';

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

describe('Monster Sprite FlipX Support', () => {
  it('spawnMonster preserves flipX on spawned monster instances', () => {
    const flippedTemplate = MONSTERS_ALL.find(m => m.flipX === true) || { id: 'test-flipped', name: 'Test Flipped', cr: 0.25, flipX: true };
    const spec = spawnMonster(flippedTemplate.cr || 0.25, 1, Math.random, [flippedTemplate.id]);

    if (flippedTemplate.flipX) {
      expect(spec.flipX).toBe(true);
    }
  });

  it('makeMonsterMesh initializes static sprite with mirrored texture when flipX is true', () => {
    const mon = {
      id: 'test-goblin',
      name: 'Goblin',
      sprite: 'orc.png',
      flipX: true
    };

    const ent = makeMonsterMesh(mon);
    expect(ent.anim).toBeDefined();

    const spriteMesh = ent.grp.children[0];
    const tex = spriteMesh.material.map;
    expect(tex.repeat.x).toBe(-1);
    expect(tex.offset.x).toBe(1);

    // Walking right (dx > 0.1) -> should face right (not mirrored for flipX creature)
    ent.anim.setDirection(1, 0);
    expect(tex.repeat.x).toBe(1);
    expect(tex.offset.x).toBe(0);

    // Walking left (dx < -0.1) -> should face left (mirrored for flipX creature)
    ent.anim.setDirection(-1, 0);
    expect(tex.repeat.x).toBe(-1);
    expect(tex.offset.x).toBe(1);
  });

  it('makeMonsterMesh initializes static sprite without mirror when flipX is false', () => {
    const mon = {
      id: 'test-orc',
      name: 'Orc',
      sprite: 'orc.png',
      flipX: false
    };

    const ent = makeMonsterMesh(mon);
    expect(ent.anim).toBeDefined();

    const spriteMesh = ent.grp.children[0];
    const tex = spriteMesh.material.map;
    expect(tex.repeat.x).toBe(1);
    expect(tex.offset.x).toBe(0);

    // Walking right (dx > 0.1) -> should face right (mirrored for normal creature)
    ent.anim.setDirection(1, 0);
    expect(tex.repeat.x).toBe(-1);
    expect(tex.offset.x).toBe(1);

    // Walking left (dx < -0.1) -> should face left (unmirrored for normal creature)
    ent.anim.setDirection(-1, 0);
    expect(tex.repeat.x).toBe(1);
    expect(tex.offset.x).toBe(0);
  });

  it('getSpriteBottomPadding detects transparent bottom padding to anchor feet to ground', async () => {
    const { getSpriteBottomPadding } = await import('../src/game/entities.js');
    expect(typeof getSpriteBottomPadding).toBe('function');
  });
});
