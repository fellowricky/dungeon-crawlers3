/* Prop textures snap to the floor's world pixel grid.
 * These fail if three renames a chunk the patch rewrites, or if the rewrite
 * misses (the bump regex is the fragile one) and props stay smooth.
 */
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

function compile(mat, lib) {
  const sh = {
    uniforms: {},
    vertexShader: lib.vertexShader,
    fragmentShader: lib.fragmentShader
  };
  mat.onBeforeCompile(sh);
  return sh;
}

describe('prop pixel grid', () => {
  it('keeps the three.js anchors the patch rewrites', () => {
    const frag = THREE.ShaderLib.standard.fragmentShader;
    const vert = THREE.ShaderLib.standard.vertexShader;
    for (const inc of ['map_fragment', 'normal_fragment_maps', 'bumpmap_pars_fragment', 'aomap_fragment', 'emissivemap_fragment', 'color_fragment', 'opaque_fragment']) {
      expect(frag).toContain(`#include <${inc}>`);
    }
    expect(vert).toContain('#include <worldpos_vertex>');
    expect(THREE.ShaderChunk.normal_fragment_maps).toContain('texture2D( normalMap, vNormalMapUv )');
    expect(THREE.ShaderChunk.bumpmap_pars_fragment).toContain('float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;');
    expect(THREE.ShaderChunk.aomap_fragment).toContain('texture2D( aoMap, vAoMapUv )');
    expect(THREE.ShaderChunk.emissivemap_fragment).toContain('texture2D( emissiveMap, vEmissiveMapUv )');
    expect(THREE.ShaderLib.lambert.fragmentShader).toContain('#include <map_fragment>');
    expect(THREE.ShaderLib.basic.fragmentShader).toContain('#include <map_fragment>');
  });

  it('snaps standard, lambert and basic prop shaders, and leaves the floor and the flames alone', async () => {
    const mats = await import('../src/render/dungeon_materials.js');
    const { propBlendPatch, PROP_PIXEL, propBlendUniforms,
      matStone, matTrim, matCloth, matWeb, matIce, matFloor, matWall, matGlow, matMagicCircle, matBark } = mats;

    expect(matStone.userData.propBlend).toBe(true);
    expect(matStone.userData.propPixelGrain).toBe(0.05);
    expect(matStone.customProgramCacheKey()).toContain('prop_pixel');
    expect(matStone.customProgramCacheKey()).not.toContain('pixel_only');

    expect(matTrim.userData.propBlend).toBe(true);
    expect(matCloth.userData.propBlend).toBe(true);
    expect(matWeb.userData.propBlend).toBe(true);
    expect(matBark.userData.propPixelGrain).toBe(0.08);

    expect(matIce.userData.propPixelOnly).toBe(true);
    expect(matIce.customProgramCacheKey()).toContain('pixel_only');

    expect(matFloor.userData.propBlend).toBeUndefined();
    expect(matWall.userData.propBlend).toBeUndefined();
    expect(matGlow.userData.propBlend).toBeUndefined();
    expect(matMagicCircle.userData.propBlend).toBeUndefined();

    const stone = compile(matStone, THREE.ShaderLib.standard);
    expect(stone.fragmentShader).toContain('propPixelTex( map, vMapUv');
    expect(stone.fragmentShader).toContain('propPixelTex( normalMap, vNormalMapUv');
    expect(stone.fragmentShader).toContain('propPixelUvFrom( vBumpMapUv');
    expect(stone.fragmentShader).toContain('propPixelTex( aoMap');
    expect(stone.fragmentShader).toContain('propPixelTex( emissiveMap');
    expect(stone.fragmentShader).toContain('perturbNormalArb');
    expect(stone.fragmentShader).not.toContain('float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv )');
    expect(stone.fragmentShader).not.toContain('#include <map_fragment>');
    expect(stone.fragmentShader).toContain('uPropPixelGrain');
    expect(stone.fragmentShader).toContain('pbComp');
    expect(stone.vertexShader).toContain('vPropWorldPos');
    expect(stone.fragmentShader).toContain('#ifdef USE_ALPHATEST');

    const cloth = compile(matCloth, THREE.ShaderLib.lambert);
    expect(cloth.fragmentShader).toContain('propPixelTex( map, vMapUv');
    expect(cloth.fragmentShader).toContain('pbHash');

    const web = compile(matWeb, THREE.ShaderLib.basic);
    expect(web.fragmentShader).toContain('propPixelTex( map, vMapUv');

    const ice = compile(matIce, THREE.ShaderLib.standard);
    expect(ice.fragmentShader).toContain('propPixelTex( map, vMapUv');
    expect(ice.fragmentShader).toContain('pbHash');
    expect(ice.fragmentShader).not.toContain('pbComp');

    const prev = PROP_PIXEL.perUnit;
    PROP_PIXEL.perUnit = 48;
    expect(propBlendUniforms.uPropPixelPerUnit.value).toBe(48);
    PROP_PIXEL.perUnit = prev;

    const grainPrev = PROP_PIXEL.grain;
    PROP_PIXEL.grain = 2;
    expect(stone.uniforms.uPropPixelGrain.value).toBeCloseTo(0.10);
    PROP_PIXEL.grain = grainPrev;

    const chained = new THREE.MeshStandardMaterial();
    let sawInclude = false;
    chained.onBeforeCompile = sh => { sawInclude = sh.fragmentShader.includes('#include <normal_fragment_maps>'); };
    propBlendPatch(chained);
    const after = compile(chained, THREE.ShaderLib.standard);
    expect(sawInclude).toBe(true);
    expect(after.fragmentShader).toContain('propPixelTex( normalMap');
    expect(chained.customProgramCacheKey()).toContain('prop_pixel');
  });
});
