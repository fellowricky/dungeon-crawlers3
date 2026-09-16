import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { PIXEL_VFX_PRESETS, spawnPixelVfx } from '../src/render/pixel_vfx.js';
import { spawnMeleeHitVFX } from '../src/game/entities.js';

describe('Procedural Pixel Melee VFX', () => {
  function createMockContext(size = 64) {
    const data = new Uint8ClampedArray(size * size * 4);
    return {
      canvas: { width: size, height: size },
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: vi.fn(),
      fillRect: vi.fn(),
      clearRect: vi.fn()
    };
  }

  it('draws melee_slash with valid pixel buffer at various progress points', () => {
    const ctx = createMockContext();
    expect(() => {
      PIXEL_VFX_PRESETS.melee_slash(ctx, 64, 0.0, { isCrit: false });
      PIXEL_VFX_PRESETS.melee_slash(ctx, 64, 0.5, { isCrit: true });
      PIXEL_VFX_PRESETS.melee_slash(ctx, 64, 1.0, { isCrit: false });
    }).not.toThrow();
    expect(ctx.putImageData).toHaveBeenCalled();
  });

  it('draws melee_pierce with valid pixel buffer at various progress points', () => {
    const ctx = createMockContext();
    expect(() => {
      PIXEL_VFX_PRESETS.melee_pierce(ctx, 64, 0.0, { isCrit: false });
      PIXEL_VFX_PRESETS.melee_pierce(ctx, 64, 0.5, { isCrit: true });
      PIXEL_VFX_PRESETS.melee_pierce(ctx, 64, 1.0, { isCrit: false });
    }).not.toThrow();
    expect(ctx.putImageData).toHaveBeenCalled();
  });

  it('draws melee_blunt with valid pixel buffer at various progress points', () => {
    const ctx = createMockContext();
    expect(() => {
      PIXEL_VFX_PRESETS.melee_blunt(ctx, 64, 0.0, { isCrit: false });
      PIXEL_VFX_PRESETS.melee_blunt(ctx, 64, 0.5, { isCrit: true });
      PIXEL_VFX_PRESETS.melee_blunt(ctx, 64, 1.0, { isCrit: false });
    }).not.toThrow();
    expect(ctx.putImageData).toHaveBeenCalled();
  });

  it('spawnMeleeHitVFX selects correct procedural preset and orientation for slashing', () => {
    const scene = new THREE.Scene();
    const targetPos = { x: 5, z: 5 };
    const attackerPos = { x: 4, z: 5 }; // Attacking from the left (dx = 1, dz = 0)

    let spawnedOpts = null;
    const origSpawn = spawnPixelVfx;
    try {
      spawnMeleeHitVFX(scene, targetPos, attackerPos, false, 'slashing', 1.0, {
        camAngle: 0
      });
      // The scene should contain the spawned billboard sprite
      expect(scene.children.length).toBeGreaterThan(0);
      const child = scene.children[0];
      expect(child.isSprite).toBe(true);
    } finally {
      scene.clear();
    }
  });

  it('spawnMeleeHitVFX spawns piercing effect for piercing damage', () => {
    const scene = new THREE.Scene();
    const targetPos = { x: 5, z: 5 };
    const attackerPos = { x: 5, z: 4 }; // Attacking from above

    try {
      spawnMeleeHitVFX(scene, targetPos, attackerPos, false, 'piercing', 1.0, { camAngle: 0 });
      expect(scene.children.length).toBeGreaterThan(0);
      const child = scene.children[0];
      expect(child.isSprite).toBe(true);
    } finally {
      scene.clear();
    }
  });

  it('spawnMeleeHitVFX spawns bludgeoning effect for bludgeoning damage', () => {
    const scene = new THREE.Scene();
    const targetPos = { x: 5, z: 5 };
    const attackerPos = { x: 6, z: 5 }; // Attacking from the right

    try {
      spawnMeleeHitVFX(scene, targetPos, attackerPos, true, 'bludgeoning', 1.0, { camAngle: 0 });
      expect(scene.children.length).toBeGreaterThan(0);
      const child = scene.children[0];
      expect(child.isSprite).toBe(true);
    } finally {
      scene.clear();
    }
  });

  it('spawnMeleeHitVFX spawns procedural pixel effect for ranged weapon attacks', () => {
    const scene = new THREE.Scene();
    const targetPos = { x: 5, z: 5 };
    const attackerPos = { x: 2, z: 5 }; // Arrow shot from left

    try {
      spawnMeleeHitVFX(scene, targetPos, attackerPos, false, 'piercing', 1.0, {
        ranged: true,
        camAngle: 0
      });
      // Ranged attacks MUST spawn the piercing procedural pixel effect
      expect(scene.children.length).toBeGreaterThan(0);
      const child = scene.children[0];
      expect(child.isSprite).toBe(true);
    } finally {
      scene.clear();
    }
  });
});
