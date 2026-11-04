/* ─────────────── Wall cutaway ───────────────
 * The low exploration camera only works because walls between it and the
 * party dissolve. These cover the two ways that goes wrong without anyone
 * seeing a shader error: a patched material silently sharing a program with
 * an unpatched one (matWall and matFloor both carried 'atlas_lum_bump_tbn'),
 * and the injection anchors no longer existing in three's shader source.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { cutawayPatch, updateCutaway, cutawayUniforms, CUTAWAY, CUTAWAY_MAX } from '../src/render/wall_cutaway.js';

describe('cutawayPatch', () => {
  it('gives a patched material its own program, apart from its unpatched twin', () => {
    const key = () => 'atlas_lum_bump_tbn';
    const wall = new THREE.MeshStandardMaterial(); wall.customProgramCacheKey = key;
    const floor = new THREE.MeshStandardMaterial(); floor.customProgramCacheKey = key;
    cutawayPatch(wall);
    expect(wall.customProgramCacheKey()).not.toBe(floor.customProgramCacheKey());
    expect(wall.customProgramCacheKey()).toContain('atlas_lum_bump_tbn');
  });

  it('runs the material\'s existing onBeforeCompile before its own', () => {
    const mat = new THREE.MeshStandardMaterial();
    let ranFirst = false;
    mat.onBeforeCompile = sh => { ranFirst = !sh.fragmentShader.includes('uCutOn'); };
    cutawayPatch(mat);
    const sh = { uniforms: {}, vertexShader: '', fragmentShader: '#include <common>\nvoid main(){\n#include <clipping_planes_fragment>\n}' };
    mat.onBeforeCompile(sh);
    expect(ranFirst).toBe(true);
    expect(sh.fragmentShader).toContain('uniform float uCutOn');
    expect(sh.fragmentShader).toContain('discard');
    expect(sh.uniforms.uCutPts).toBe(cutawayUniforms.uCutPts);
  });

  it('finds both injection anchors in three\'s real lit shaders', () => {
    // If three ever renames these chunks the patch would no-op silently.
    // The cut reads vViewPosition inside main(); Standard declares it inline,
    // Lambert/Phong/Toon in their lights_*_pars chunk — either way before main.
    const expand = src => src.replace(/#include <(\w+)>/g, (m, k) =>
      (k === 'common' || k === 'clipping_planes_fragment') ? m : expand(THREE.ShaderChunk[k] || ''));
    for (const name of ['standard', 'lambert', 'phong', 'toon']) {
      const frag = THREE.ShaderLib[name].fragmentShader;
      expect(frag).toContain('#include <common>');
      expect(frag).toContain('#include <clipping_planes_fragment>');
      expect(expand(frag).split('void main')[0]).toContain('varying vec3 vViewPosition');
    }
  });

  it('leaves unlit materials alone and is idempotent', () => {
    const basic = new THREE.MeshBasicMaterial();
    const before = basic.onBeforeCompile;
    cutawayPatch(basic);
    expect(basic.onBeforeCompile).toBe(before);

    const lit = new THREE.MeshStandardMaterial();
    cutawayPatch(lit);
    const once = lit.onBeforeCompile;
    cutawayPatch(lit);
    expect(lit.onBeforeCompile).toBe(once);
  });
});

describe('updateCutaway', () => {
  it('centres each ellipse at mid-body and caps the count', () => {
    const pts = Array.from({ length: CUTAWAY_MAX + 3 }, (_, i) => ({ x: i, y: 0.5, z: -i }));
    updateCutaway(pts, true, 1 / 60);
    expect(cutawayUniforms.uCutN.value).toBe(CUTAWAY_MAX);
    expect(cutawayUniforms.uCutPts.value[2].y).toBeCloseTo(0.5 + CUTAWAY.lift, 6);
  });

  it('fades in and out rather than popping', () => {
    cutawayUniforms.uCutOn.value = 0;
    updateCutaway([{ x: 0, z: 0 }], true, 1 / 60);
    const first = cutawayUniforms.uCutOn.value;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.2);
    for (let i = 0; i < 240; i++) updateCutaway([{ x: 0, z: 0 }], true, 1 / 60);
    expect(cutawayUniforms.uCutOn.value).toBe(1);
    for (let i = 0; i < 240; i++) updateCutaway([{ x: 0, z: 0 }], false, 1 / 60);
    expect(cutawayUniforms.uCutOn.value).toBe(0);
  });
});
