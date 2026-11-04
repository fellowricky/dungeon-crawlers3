/* Every theme's walls and caps take their own tangent normal. The floor
 * materials stay on the luminance bump. Themes share one material, so a
 * theme with no normal has to clear the previous theme's map.
 * Optimized props and the painted procedural canvases that have real edges
 * use the same kind of sidecar. */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import * as THREE from 'three';
import PROP_NORMAL_INDEX from '../src/render/prop_normal_index.json' with { type: 'json' };

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

describe('tile normals', () => {
  it('gives every theme its own wall and cap normal, and leaves floors bare', async () => {
    const { applyTileTheme, matWall, matWallCap, matFloor } = await import('../src/render/dungeon_materials.js');
    applyTileTheme('grim');
    expect(matWall.normalMap).toBeTruthy();
    expect(matWall.normalMap.colorSpace).not.toBe(THREE.SRGBColorSpace);
    expect(matWall.normalMap.magFilter).toBe(THREE.NearestFilter);
    expect(matWall.normalScale.x).toBe(2.5);
    expect(matWallCap.normalMap).toBeTruthy();
    expect(matWallCap.normalMap).not.toBe(matWall.normalMap);
    expect(matFloor.normalMap).toBeFalsy();
    const grimWall = matWall.normalMap;

    applyTileTheme('ancient');
    expect(matWall.normalMap).toBeTruthy();
    expect(matWall.normalMap).not.toBe(grimWall);
    expect(matWallCap.normalMap).toBeTruthy();
    expect(matWall.normalScale.x).toBe(2.5);
    expect(matWallCap.normalScale.x).toBe(2.5);
    expect(matFloor.normalMap).toBeFalsy();

    applyTileTheme('molten');
    expect(matWall.normalMap).toBeTruthy();
    expect(matWall.normalMap).not.toBe(grimWall);
    expect(matFloor.normalMap).toBeFalsy();

    applyTileTheme('no-such-theme');
    expect(matWall.normalMap).toBeFalsy();
    expect(matWallCap.normalMap).toBeFalsy();
    expect(matFloor.normalMap).toBeFalsy();

    const sh = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader
    };
    matWall.onBeforeCompile(sh);
    expect(sh.vertexShader).toContain('vNormalMapUv = vNormalMapUv * 0.5 + aUvO');
    expect(sh.fragmentShader).toContain('USE_NORMALMAP_TANGENTSPACE');
  });

  it('points every optimized prop at a sidecar normal', () => {
    const keys = Object.keys(PROP_NORMAL_INDEX);
    expect(keys).toHaveLength(82);
    expect(keys).toContain('3d/Ancient/cage.opt.glb');
    const id = PROP_NORMAL_INDEX['3d/Ancient/cage.opt.glb'];
    const file = path.join(process.cwd(), 'public', 'art', 'prop_normals', `${id}.png`);
    expect(fs.existsSync(file)).toBe(true);
    const ids = new Set(Object.values(PROP_NORMAL_INDEX));
    expect(ids.size).toBe(80);
    for (const digest of ids) {
      expect(fs.existsSync(path.join(process.cwd(), 'public', 'art', 'prop_normals', `${digest}.png`))).toBe(true);
    }
  });

  it('normals the painted procedural surfaces and leaves the flat canvases alone', async () => {
    const mats = await import('../src/render/dungeon_materials.js');
    expect(mats.matWood.normalMap).toBeTruthy();
    expect(mats.matWood.normalMap.colorSpace).not.toBe(THREE.SRGBColorSpace);
    expect(mats.matWood.normalMap.magFilter).toBe(THREE.NearestFilter);
    expect(mats.matWood.normalScale.x).toBe(2.5);
    expect(mats.matMetal.normalScale.x).toBe(2.5);
    expect(mats.matBark.normalMap).toBe(mats.matWood.normalMap);
    expect(mats.matMetal.normalMap).toBeTruthy();
    expect(mats.matSconce.normalMap).toBe(mats.matMetal.normalMap);
    expect(mats.matRug.normalMap).toBeTruthy();
    expect(mats.matGoldInlay.normalMap).toBe(mats.matGoldBullion.normalMap);
    expect(mats.matIvy.normalMap).toBeTruthy();
    expect(mats.matIvy.normalMap.wrapS).toBe(mats.matIvy.map.wrapS);
    expect(mats.matCampRing.normalMap).toBeTruthy();
    expect(mats.matLeaf.normalMap).toBeTruthy();
    expect(mats.matSwampGrass.normalMap).toBeTruthy();
    expect(mats.matStone.normalMap).toBeFalsy();
    expect(mats.matBoneStone.normalMap).toBeFalsy();
    expect(mats.matCeramic.normalMap).toBeFalsy();
    expect(mats.matGlacialIce.normalMap).toBeFalsy();
    expect(mats.matIce.normalMap).toBeFalsy();
  });
});
