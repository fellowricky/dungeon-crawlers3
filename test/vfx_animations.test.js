import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  VFX_ANIMS, VFX_SHEET_LIBRARY, CANTRIP_ANIM_BINDINGS, resolveSheetDef,
  spawnCompositeAnimation, updateCompositeFX,
} from '../src/game/vfx_animations.js';

/* Minimal DOM shim so canvas-texture creation (glow/smoke) works headlessly. */
if (typeof globalThis.document === 'undefined') {
  const dummyCtx = new Proxy({}, { get: (t, k) => {
    if (k === 'createRadialGradient') return () => ({ addColorStop: () => {} });
    if (k === 'measureText') return () => ({ width: 10 });
    return () => {};
  }});
  const dummyEl = {
    width: 0, height: 0, style: {}, setAttribute: () => {},
    addEventListener: () => {}, getContext: () => dummyCtx, appendChild: () => {},
  };
  globalThis.document = {
    createElement: () => dummyEl,
    createElementNS: () => dummyEl,
    getElementById: () => null,
    body: dummyEl,
  };
}

const proceduralAnim = () => ({
  travelSound: null, impactSound: null,
  travel: {
    duration: 0.4, arc: 0,
    back: { enabled: true, type: 'procedural', kind: 'glow', color: '#ff7a30', scale: 1.5, dur: 0.4, opacity: 0.5, blend: 'additive' },
    front: { enabled: true, type: 'procedural', kind: 'smoke', color: '#ffaa55', count: 3, scale: 0.8, dur: 0.4, opacity: 0.5 },
  },
  impact: {
    back: { enabled: true, type: 'procedural', kind: 'burst', color: '#ff5040', count: 8 },
    front: { enabled: true, type: 'procedural', kind: 'ring', color: '#ffd34a', scale: 1.4 },
  },
});

describe('VFX composite animation registry', () => {
  it('seeds an animation per playable caster cantrip', () => {
    expect(Object.keys(VFX_ANIMS)).toEqual(
      expect.arrayContaining(['fireBolt', 'chillTouch', 'sacredFlame', 'produceFlame', 'eldritchBlast'])
    );
  });

  it('binds every caster class to an existing animation', () => {
    const classes = ['wizard', 'sorcerer', 'cleric', 'druid', 'warlock'];
    for (const cls of classes) {
      const id = CANTRIP_ANIM_BINDINGS[cls];
      expect(id, `no binding for ${cls}`).toBeTruthy();
      expect(VFX_ANIMS[id], `anim ${id} missing`).toBeTruthy();
    }
  });

  it('resolves every seeded sheet reference (gigapack + custom library)', () => {
    expect(VFX_SHEET_LIBRARY.cantrip_fire_bolt).toBeTruthy();
    for (const anim of Object.values(VFX_ANIMS)) {
      for (const phase of ['travel', 'impact']) {
        for (const slot of ['back', 'front']) {
          const layer = anim[phase] && anim[phase][slot];
          if (layer && layer.enabled && layer.type === 'sheet') {
            expect(resolveSheetDef(layer.sheet, layer.fps), `${phase}.${slot} ${layer.sheet}`).toBeTruthy();
          }
        }
      }
    }
  });
});

describe('spawnCompositeAnimation runtime', () => {
  it('plays travel sound on launch and impact + onImpact on arrival', () => {
    const scene = new THREE.Scene();
    const travelSfx = vi.fn();
    const impactSfx = vi.fn();
    const onImpact = vi.fn();

    const from = new THREE.Vector3(-3, 0.55, 0);
    const to = new THREE.Vector3(3, 0.55, 0);

    spawnCompositeAnimation(scene, proceduralAnim(), {
      from, to, travelSound: travelSfx, impactSound: impactSfx, onImpact,
    });

    expect(travelSfx).toHaveBeenCalledTimes(1);
    expect(onImpact).not.toHaveBeenCalled();

    // Step just under the travel duration…
    updateCompositeFX(scene, 0.39);
    expect(onImpact).not.toHaveBeenCalled();

    // …then past it: impact layers + impact sound fire exactly once.
    updateCompositeFX(scene, 0.05);
    expect(impactSfx).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);

    // Another frame must not re-fire.
    updateCompositeFX(scene, 0.05);
    expect(impactSfx).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
  });

  it('skipTravel fires the impact phase immediately', () => {
    const scene = new THREE.Scene();
    const onImpact = vi.fn();
    const from = new THREE.Vector3(0, 0.55, 0);
    const to = new THREE.Vector3(0, 0.55, 4);

    spawnCompositeAnimation(scene, proceduralAnim(), {
      from, to, travelSound: false, impactSound: false, skipTravel: true, onImpact,
    });

    expect(onImpact).toHaveBeenCalledTimes(1);
    // Impact burst + ring should have been spawned onto the scene.
    expect(scene.children.length).toBeGreaterThan(0);
  });

  it('an animation with no enabled travel layers fires impact immediately', () => {
    const scene = new THREE.Scene();
    const onImpact = vi.fn();
    const impactSfx = vi.fn();
    const anim = proceduralAnim();
    anim.travel.back.enabled = false;
    anim.travel.front.enabled = false;

    spawnCompositeAnimation(scene, anim, {
      from: new THREE.Vector3(-3, 0.55, 0),
      to: new THREE.Vector3(3, 0.55, 0),
      travelSound: false, impactSound: impactSfx, onImpact,
    });

    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(impactSfx).toHaveBeenCalledTimes(1);
  });

  it('returns null and plays nothing for a missing animation', () => {
    const scene = new THREE.Scene();
    const travelSfx = vi.fn();
    expect(spawnCompositeAnimation(scene, null, { travelSound: travelSfx })).toBeNull();
    expect(travelSfx).not.toHaveBeenCalled();
  });
});
