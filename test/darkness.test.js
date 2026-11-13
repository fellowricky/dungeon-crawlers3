import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';

if (typeof globalThis.document === 'undefined') {
  const dummyCtx = new Proxy({
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    getImageData: () => ({ data: new Uint8Array(4) }),
  }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const dummyEl = { style: {}, getContext: () => dummyCtx, setAttribute: () => {}, appendChild: () => {} };
  globalThis.document = { createElement: () => dummyEl, getElementById: () => null, body: dummyEl };
}

const { darkMaskPatch, darkMaskSweep, darkUniforms, updateDarkness, shownDarkZones, DARKNESS } = await import('../src/render/darkness.js');
const { addDarkZone, removeDarkZone, DARK_ZONES, inDarkZone } = await import('../src/game/light_sources.js');
const { SPELLS } = await import('../src/game/spells.js');

const domes = (s) => s.children.filter((c) => c.material && c.material.isShaderMaterial);
const flat = () => 0;

describe('darkness', () => {
  beforeEach(() => {
    const s = new THREE.Scene();
    DARK_ZONES.clear();
    for (let i = 0; i < 200 && shownDarkZones(); i++) updateDarkness(s, 0.1, flat);
  });

  it('patches lit materials once, extends the cache key, and leaves unlit ones alone', () => {
    const m = new THREE.MeshStandardMaterial();
    const key = m.customProgramCacheKey();
    darkMaskPatch(m);
    darkMaskPatch(m);
    expect(m.customProgramCacheKey()).toBe(key + '|dark_mask');
    const sh = { uniforms: {}, fragmentShader: '#include <common>\n#include <opaque_fragment>', vertexShader: '' };
    m.onBeforeCompile(sh);
    expect(sh.fragmentShader.match(/darkMask\(-vViewPosition\)/g).length).toBe(1);
    expect(sh.fragmentShader).toContain('#include <opaque_fragment>');
    expect(sh.uniforms.uDarkZones).toBe(darkUniforms.uDarkZones);
    const basic = new THREE.MeshBasicMaterial();
    darkMaskPatch(basic);
    expect(basic.userData.darkMask).toBeUndefined();
  });

  it('chains after an existing onBeforeCompile', () => {
    const m = new THREE.MeshLambertMaterial();
    let ran = 0;
    m.onBeforeCompile = () => { ran++; };
    darkMaskPatch(m);
    m.onBeforeCompile({ uniforms: {}, fragmentShader: '', vertexShader: '' });
    expect(ran).toBe(1);
  });

  it('sweeps a whole scene', () => {
    const s = new THREE.Scene();
    const m = new THREE.MeshPhongMaterial();
    s.add(new THREE.Group().add(new THREE.Mesh(new THREE.BufferGeometry(), m)));
    darkMaskSweep(s);
    expect(m.userData.darkMask).toBe(true);
  });

  it('a zone swells to its radius on the floor, then collapses when it goes', () => {
    const s = new THREE.Scene();
    const Z = addDarkZone({ x: 2, z: 5, r: 3 });
    updateDarkness(s, DARKNESS.grow / 2, () => 1.5);
    const mid = darkUniforms.uDarkZones.value[0].w;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(3);
    updateDarkness(s, DARKNESS.grow, () => 1.5);
    const v = darkUniforms.uDarkZones.value[0];
    expect([v.x, v.y, v.z, v.w]).toEqual([2, 1.5, 5, 3]);
    expect(darkUniforms.uDarkN.value).toBe(1);
    removeDarkZone(Z);
    updateDarkness(s, DARKNESS.shrink / 2, flat);
    expect(darkUniforms.uDarkN.value).toBe(1);
    updateDarkness(s, DARKNESS.shrink, flat);
    expect(darkUniforms.uDarkN.value).toBe(0);
    expect(shownDarkZones()).toBe(0);
  });

  it('only a zone that asks for a dome gets one, its size follows the mask, and it is removed with the zone', () => {
    const s = new THREE.Scene();
    addDarkZone({ x: 0, z: 0, r: 2 });
    const Z = addDarkZone({ x: 9, z: 0, r: 3, dome: true });
    updateDarkness(s, 5, flat);
    expect(domes(s).length).toBe(1);
    expect(domes(s)[0].scale.x).toBe(3);
    expect(domes(s)[0].position.x).toBe(9);
    removeDarkZone(Z);
    updateDarkness(s, 5, flat);
    expect(domes(s).length).toBe(0);
  });

  it('adds no lights to the scene', () => {
    const s = new THREE.Scene();
    addDarkZone({ x: 0, z: 0, r: 3, dome: true });
    updateDarkness(s, 1, flat);
    let lights = 0;
    s.traverse((o) => { if (o.isLight) lights++; });
    expect(lights).toBe(0);
  });

  it('caps what it publishes without overrunning the uniform array', () => {
    const s = new THREE.Scene();
    for (let i = 0; i < 12; i++) addDarkZone({ x: i, z: 0, r: 1 });
    updateDarkness(s, 1, flat);
    expect(darkUniforms.uDarkN.value).toBe(darkUniforms.uDarkZones.value.length);
  });

  it('the spell makes its domed zone when the mote lands, not before', () => {
    let landing = null, used = 0;
    const game = {
      markSpellUsed() { used++; }, fxLog() {},
      playAbilityFx(_h, key, opts) { expect(key).toBe('darkness'); landing = opts.onImpact; },
    };
    const foe = { x: 4, z: 6, data: { name: 'Foe' } };
    expect(SPELLS.darkness.cast(game, { data: { name: 'Hero' } }, foe)).toBe(true);
    expect(used).toBe(1);
    expect(DARK_ZONES.size).toBe(0);
    landing();
    const [Z] = DARK_ZONES;
    expect(Z.dome).toBe(true);
    expect(Z.r).toBe(3);
    expect(inDarkZone(4, 8.9)).toBe(true);
    expect(inDarkZone(4, 9.1)).toBe(false);
  });
});
