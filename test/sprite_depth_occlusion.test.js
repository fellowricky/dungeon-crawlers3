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

describe('Sprite Depth Tilt & Occlusion Configuration', () => {
  it('configureSpriteMaterial injects depth tilt shader calculation and customProgramCacheKey', async () => {
    const THREE = await import('three');
    const { configureSpriteMaterial } = await import('../src/game/sprite_animator.js');

    const mat = new THREE.SpriteMaterial({ transparent: true, depthTest: true, depthWrite: false });
    configureSpriteMaterial(mat, { forwardBias: 0.25 });

    expect(mat.customProgramCacheKey).toBeDefined();
    expect(mat.customProgramCacheKey()).toBe('depthTiltSprite_0.250');
    expect(typeof mat.onBeforeCompile).toBe('function');

    const mockShader = {
      vertexShader: `
        void main() {
          vec2 rotatedPosition = vec2(1.0, 2.0);
          mvPosition.xy += rotatedPosition;
          gl_Position = projectionMatrix * mvPosition;
        }
      `
    };

    mat.onBeforeCompile(mockShader);
    expect(mockShader.vertexShader).toContain('float wallSlope = (abs(viewMatrix[1].y) > 0.0001) ? (viewMatrix[1].z / viewMatrix[1].y) : 0.0;');
    expect(mockShader.vertexShader).toContain('float groundSlope = (abs(viewMatrix[2].y) > 0.0001) ? abs(viewMatrix[2].z / viewMatrix[2].y) : 0.0;');
    expect(mockShader.vertexShader).toContain('mvPosition.z += zOffset + 0.250;');
  });

  it('HeroSprite, WolfSprite, and BeastSprite materials are configured with depth tilt', async () => {
    const { HeroSprite, WolfSprite, BeastSprite } = await import('../src/game/sprite_animator.js');

    const dummyHero = {
      visual: { gender: 'male', race: 'human' },
      equipment: {}
    };

    const heroSpr = new HeroSprite(dummyHero, 0xa0c080);
    expect(heroSpr.material.customProgramCacheKey).toBeDefined();
    expect(heroSpr.material.customProgramCacheKey()).toContain('depthTiltSprite');
    expect(heroSpr.material.depthTest).toBe(true);
    expect(heroSpr.material.depthWrite).toBe(false);

    const wolfSpr = new WolfSprite(dummyHero, 0xa0c080);
    expect(wolfSpr.material.customProgramCacheKey).toBeDefined();
    expect(wolfSpr.material.customProgramCacheKey()).toContain('depthTiltSprite');
    expect(wolfSpr.material.depthTest).toBe(true);

    const beastSpr = new BeastSprite(dummyHero, 0x2ecc71, { scaleX: 1.5, scaleY: 1.5 });
    expect(beastSpr.material.customProgramCacheKey).toBeDefined();
    expect(beastSpr.material.customProgramCacheKey()).toContain('depthTiltSprite');
    expect(beastSpr.material.depthTest).toBe(true);
  });

  it('Monster meshes and combat overlays have depth tilt shader applied', async () => {
    const { makeMonsterMesh, makeStatusTray, makeTurnHighlight } = await import('../src/game/entities.js');

    const monMesh = makeMonsterMesh({ name: 'Orc', sprite: 'orc.png', scale: 1.2 });
    expect(monMesh.anim.mesh.material.customProgramCacheKey).toBeDefined();
    expect(monMesh.anim.mesh.material.customProgramCacheKey()).toContain('depthTiltSprite');
    expect(monMesh.anim.mesh.material.depthTest).toBe(true);

    const tray = makeStatusTray();
    expect(tray.spr.material.customProgramCacheKey).toBeDefined();
    expect(tray.spr.material.customProgramCacheKey()).toContain('depthTiltSprite');
    expect(tray.spr.material.depthTest).toBe(true);

    const highlight = makeTurnHighlight(true);
    expect(highlight.mat.customProgramCacheKey).toBeDefined();
    expect(highlight.mat.customProgramCacheKey()).toContain('depthTiltSprite');
    expect(highlight.mat.depthTest).toBe(true);
  });

  it('Camera zoom bounds clamp correctly and default is two-thirds zoomed in', async () => {
    const { MIN_CAM_ZOOM, MAX_CAM_ZOOM, DEFAULT_CAM_ZOOM, cam } = await import('../src/render/dungeon_scene.js');

    expect(MIN_CAM_ZOOM).toBe(3.2);
    expect(MAX_CAM_ZOOM).toBe(14.0);
    expect(DEFAULT_CAM_ZOOM).toBeCloseTo(MIN_CAM_ZOOM + (MAX_CAM_ZOOM - MIN_CAM_ZOOM) * (2 / 3), 1);
    expect(cam.zoom).toBeCloseTo(DEFAULT_CAM_ZOOM, 1);
  });
});
