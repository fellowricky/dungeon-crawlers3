import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  bayerDither,
  parseColor,
  PIXEL_VFX_PRESETS,
  spawnPixelVfx,
  updatePixelVfx,
  clearPixelVfx
} from '../src/render/pixel_vfx.js';
import { getPixelVfxTypeForAbility } from '../src/game/monster_ai.js';

describe('Procedural Pixel VFX Generator', () => {
  it('computes Bayer 4x4 matrix dithering correctly', () => {
    expect(bayerDither(0, 0, 0.0)).toBe(false);
    expect(bayerDither(0, 0, 1.0)).toBe(true);
    // At (0, 0) Bayer threshold is 0.5 / 16 = 0.03125
    expect(bayerDither(0, 0, 0.1)).toBe(true);
    // At (2, 2) Bayer value is 1 -> threshold is 1.5 / 16 = 0.09375
    expect(bayerDither(2, 2, 0.05)).toBe(false);
    expect(bayerDither(2, 2, 0.2)).toBe(true);
  });

  it('parses color integers and strings into RGBA components', () => {
    const magenta = parseColor(0xd946ef);
    expect(magenta.r).toBe(0xd9);
    expect(magenta.g).toBe(0x46);
    expect(magenta.b).toBe(0xef);
    expect(magenta.a).toBe(1.0);

    const hexStr = parseColor('#ef4444', 0.8);
    expect(hexStr.r).toBe(0xef);
    expect(hexStr.g).toBe(0x44);
    expect(hexStr.b).toBe(0x44);
    expect(hexStr.a).toBe(0.8);
  });

  it('maps monster ability definitions to appropriate procedural pixel VFX types', () => {
    expect(getPixelVfxTypeForAbility({ key: 'gibbering', label: 'Gibbering' })).toBe('gibbering');
    expect(getPixelVfxTypeForAbility({ label: 'Gibbering Mouther Babble' })).toBe('gibbering');
    expect(getPixelVfxTypeForAbility({ elem: 'psychic', label: 'Mind Blast' })).toBe('gibbering');

    expect(getPixelVfxTypeForAbility({ key: 'stench', label: 'Stench' })).toBe('stench');
    expect(getPixelVfxTypeForAbility({ key: 'fetid_cloud' })).toBe('stench');
    expect(getPixelVfxTypeForAbility({ elem: 'poison', label: 'Toxic Spores' })).toBe('stench');

    expect(getPixelVfxTypeForAbility({ key: 'fire_form', elem: 'fire' })).toBe('fire');
    expect(getPixelVfxTypeForAbility({ elem: 'cold', label: 'Freezing Aura' })).toBe('frost');
    expect(getPixelVfxTypeForAbility({ elem: 'radiant', label: 'Sanctuary Aura' })).toBe('holy');
    expect(getPixelVfxTypeForAbility({ label: 'Ground Stomp' })).toBe('shockwave');
  });

  it('executes all pixel VFX presets without throwing', () => {
    // Mock 2D context for headless node environment
    const size = 64;
    const mockCtx = {
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {},
      fillRect: () => {},
      clearRect: () => {},
      fillStyle: ''
    };

    const presets = Object.keys(PIXEL_VFX_PRESETS);
    expect(presets).toContain('gibbering');
    expect(presets).toContain('stench');
    expect(presets).toContain('shockwave');
    expect(presets).toContain('fire');
    expect(presets).toContain('frost');
    expect(presets).toContain('holy');
    expect(presets).toContain('slash');

    for (const presetName of presets) {
      const draw = PIXEL_VFX_PRESETS[presetName];
      expect(() => draw(mockCtx, size, 0.0, {})).not.toThrow();
      expect(() => draw(mockCtx, size, 0.5, {})).not.toThrow();
      expect(() => draw(mockCtx, size, 1.0, {})).not.toThrow();
    }
  });

  it('manages pixel VFX lifecycle and pooling in a Three.js scene', () => {
    const scene = new THREE.Scene();
    
    // In headless Node, document.createElement might not be present or mockable
    // If running in browser/vitest with DOM:
    if (typeof document !== 'undefined') {
      const vfx = spawnPixelVfx(scene, {
        type: 'gibbering',
        pos: { x: 5, z: 10 },
        radius: 3.0,
        color: 0xd946ef,
        duration: 0.5
      });

      expect(vfx).not.toBeNull();
      expect(vfx.mesh.parent).toBe(scene);
      expect(vfx.radius).toBe(3.0);

      // Advance time by half
      updatePixelVfx(scene, 0.25);
      expect(vfx.t).toBe(0.25);
      expect(vfx.mesh.parent).toBe(scene);

      // Advance time to completion
      updatePixelVfx(scene, 0.3);
      expect(vfx.mesh.parent).toBeNull(); // Removed and returned to pool

      clearPixelVfx(scene);
    }
  });
});
