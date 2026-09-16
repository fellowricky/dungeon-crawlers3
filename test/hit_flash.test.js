import { describe, it, expect } from 'vitest';
import { hitFlash, updateFlash, visualOf } from '../src/game/entities.js';

function fakeVisual() {
  return {
    anim: {
      mesh: {
        material: { color: { r: 1, g: 1, b: 1, set(hex) { this._hex = hex; }, setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; } } },
        position: { x: 0, y: 0, z: 0 }
      }
    }
  };
}

describe('hit flash + shudder', () => {
  it('visualOf accepts both the visual bundle and the game entity', () => {
    const vis = fakeVisual();
    expect(visualOf(vis)).toBe(vis);
    expect(visualOf({ ent: vis })).toBe(vis);
    expect(visualOf(null)).toBeNull();
  });

  it('hitFlash starts a white flash and updateFlash shudders then restores', () => {
    const vis = fakeVisual();
    hitFlash(vis);
    expect(vis.flashT).toBeGreaterThan(0);
    expect(vis.anim.mesh.material.color._hex).toBe(0xfff4ee);

    updateFlash(vis, 0.02);
    expect(Math.abs(vis.anim.mesh.position.x)).toBeGreaterThan(0);

    updateFlash(vis, 1);
    expect(vis.flashT).toBe(0);
    expect(vis.anim.mesh.position.x).toBe(0);
    expect(vis.anim.mesh.material.color._hex).toBe(0xffffff);
  });

  it('hitFlash on a game entity (h, not h.ent) still reaches the mesh', () => {
    const vis = fakeVisual();
    hitFlash({ ent: vis, x: 1, z: 2 });
    expect(vis.flashT).toBeGreaterThan(0);
  });
});

/* ── ownership ──────────────────────────────────────────────────────────
   The flash may only drive things it owns. `anim.mesh.scale` is owned by
   HeroSprite.applyCell, which rewrites it whenever the animation swaps to a
   sheet with a different cell size (64 / 128 / 192). A scale punch here looked
   fine until a cell change landed mid-flash, at which point the restore pinned
   the wrong resting size and left heroes 2-3x too large. */

function fakeVisualWithOverlay() {
  const writes = { scale: 0, center: 0 };
  const overlay = {
    visible: false,
    material: { opacity: 0, color: { set(hex) { this._hex = hex; } } }
  };
  const vis = {
    anim: {
      hitOverlay: overlay,
      mesh: {
        material: { color: { r: 1, g: 1, b: 1, set(hex) { this._hex = hex; }, setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; } } },
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1.125, y: 1.125, set() { writes.scale++; } },
        center: { copy() { writes.center++; } }
      }
    }
  };
  return { vis, overlay, writes };
}

describe('hit flash ownership', () => {
  it('never writes anim.mesh.scale — applyCell owns it', () => {
    const { vis, writes } = fakeVisualWithOverlay();
    hitFlash(vis);
    for (let i = 0; i < 20; i++) updateFlash(vis, 0.03);
    expect(writes.scale).toBe(0);
  });

  it('drives the additive overlay instead, and puts it away afterwards', () => {
    const { vis, overlay } = fakeVisualWithOverlay();

    hitFlash(vis);
    expect(overlay.visible).toBe(true);
    expect(overlay.material.opacity).toBeGreaterThan(0.5);

    updateFlash(vis, 0.03);
    const early = overlay.material.opacity;
    /* Late in the flash the overlay has faded well below its impact value. */
    for (let i = 0; i < 10; i++) updateFlash(vis, 0.03);
    expect(overlay.material.opacity).toBeLessThan(early);

    updateFlash(vis, 1);
    expect(overlay.visible).toBe(false);
    expect(overlay.material.opacity).toBe(0);
  });

  it('still works for a sprite that has no overlay attached', () => {
    /* Rival minis, editor previews and the test stubs above have none. */
    const vis = fakeVisual();
    expect(() => { hitFlash(vis); updateFlash(vis, 0.03); updateFlash(vis, 1); }).not.toThrow();
    expect(vis.flashT).toBe(0);
  });
});
