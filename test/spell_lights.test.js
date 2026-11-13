import { describe, it, expect } from 'vitest';
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

const { ensureFlashLightPool, acquirePooledLight, releasePooledLight } = await import('../src/game/entities.js');
const { spawnCompositeAnimation, updateCompositeFX } = await import('../src/game/vfx_animations.js');
const { activeSpellLights, lightDefOf } = await import('../src/game/spell_lights.js');

const lit = (scene) => { const out = []; scene.traverse((o) => { if (o.isPointLight && o.intensity > 0) out.push(o); }); return out; };
const count = (scene) => { let n = 0; scene.traverse((o) => { if (o.isPointLight) n++; }); return n; };
const soft = (dur = 1) => ({ enabled: true, type: 'procedural', kind: 'glow', color: '#ffffff', scale: 1, dur, opacity: 1 });
const anim = (light, flies = true) => ({
  light, travelSound: '', impactSound: '',
  travel: { duration: 1, arc: 0, front: flies ? soft() : { enabled: false } },
  impact: { delay: 0 },
});
const light = { enabled: true, color: '#ff0000', travel: 2, travelRange: 5, impact: 6, impactRange: 8, fade: 0.5, flicker: 0 };
const from = new THREE.Vector3(0, 1, 0), to = new THREE.Vector3(4, 1, 0);

function scene() {
  const s = new THREE.Scene();
  ensureFlashLightPool(s);
  return s;
}
const settle = (s) => { for (let i = 0; i < 10; i++) updateCompositeFX(s, 1); };

describe('spell lights', () => {
  it('an animation with no light block stays unlit', () => {
    const s = scene();
    spawnCompositeAnimation(s, anim(undefined), { from, to });
    updateCompositeFX(s, 0.5);
    expect(lit(s).length).toBe(0);
    settle(s);
  });

  it('follows the flight, flares on landing, fades and goes back to the pool', () => {
    const s = scene(), base = count(s);
    spawnCompositeAnimation(s, anim(light), { from, to });
    updateCompositeFX(s, 0.5);
    const [l] = lit(s);
    expect(l.intensity).toBeCloseTo(2);
    expect(l.distance).toBe(5);
    expect(l.position.x).toBeCloseTo(2);
    updateCompositeFX(s, 0.5);
    expect(l.distance).toBe(8);
    expect(l.position.x).toBeCloseTo(4);
    updateCompositeFX(s, 0.01);
    expect(l.intensity).toBeGreaterThan(2);
    settle(s);
    expect(lit(s).length).toBe(0);
    expect(activeSpellLights()).toBe(0);
    expect(count(s)).toBe(base);
    expect(l.parent).toBe(s);
  });

  it('a spell with no flight just flares', () => {
    const s = scene();
    spawnCompositeAnimation(s, anim(light, false), { from, to });
    updateCompositeFX(s, 0.01);
    expect(lit(s).length).toBe(1);
    expect(lit(s)[0].position.x).toBeCloseTo(4);
    settle(s);
    expect(lit(s).length).toBe(0);
  });

  it('holds the flare back by its delay, dark until then', () => {
    const s = scene();
    spawnCompositeAnimation(s, anim({ ...light, delay: 0.5 }, false), { from, to });
    updateCompositeFX(s, 0.25);
    expect(lit(s).length).toBe(0);
    expect(activeSpellLights()).toBe(1);
    updateCompositeFX(s, 0.3);
    updateCompositeFX(s, 0.1);
    expect(lit(s).length).toBe(1);
    expect(lit(s)[0].position.x).toBeCloseTo(4);
    settle(s);
    expect(activeSpellLights()).toBe(0);
  });

  it('plays unlit rather than allocating when the pool is dry', () => {
    const s = scene(), base = count(s), held = [];
    for (let l; (l = acquirePooledLight(s)); ) held.push(l);
    spawnCompositeAnimation(s, anim(light), { from, to });
    updateCompositeFX(s, 0.5);
    settle(s);
    expect(count(s)).toBe(base);
    expect(activeSpellLights()).toBe(0);
    for (const l of held) releasePooledLight(s, l);
  });

  it('never publishes anything the rules light map reads', () => {
    const s = scene();
    spawnCompositeAnimation(s, anim(light), { from, to });
    updateCompositeFX(s, 0.5);
    const [l] = lit(s);
    expect(l.userData.steady).toBeUndefined();
    expect(l.userData.radii).toBeUndefined();
    settle(s);
  });

  it('switched off means no light', () => {
    expect(lightDefOf({ light: { ...light, enabled: false } })).toBeNull();
    expect(lightDefOf({})).toBeNull();
  });
});
