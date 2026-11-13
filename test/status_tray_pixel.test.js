import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { hasPixelIndicator, STATUS_AURAS } from '../src/render/status_auras.js';
import { drawStatusTray } from '../src/game/entities.js';

/* A status with a pixel indicator on the creature doesn't also get an emoji in the tray over its head. */
function tray() {
  const drawn = [];
  const g = { clearRect() {}, strokeText() {}, fillText(t) { drawn.push(t); }, font: '', textAlign: '', textBaseline: '', lineWidth: 0, strokeStyle: '' };
  return { drawn, tray: { g, cv: { width: 256, height: 64 }, tex: new THREE.Texture() } };
}

describe('the status tray over a creature\'s head', () => {
  it('leaves out every status with a pixel indicator', () => {
    for (const key of Object.keys(STATUS_AURAS)) expect(hasPixelIndicator(key), key).toBe(true);
    expect(hasPixelIndicator('magicWeapon')).toBe(true);
    expect(hasPixelIndicator('mirrorImages')).toBe(true);
  });

  it('keeps the emoji for a status nothing else shows', () => {
    expect(hasPixelIndicator('prone')).toBe(false);
  });

  it('draws only those', () => {
    const { drawn, tray: t } = tray();
    drawStatusTray(t, { _effects: { blessed: {}, prone: {}, mirrorImages: {} } });
    expect(drawn).toEqual(['🛌']);
  });

  it('draws nothing when every status has its own indicator', () => {
    const { drawn, tray: t } = tray();
    drawStatusTray(t, { _effects: { blessed: {}, paralyzed: {} } });
    expect(drawn).toEqual([]);
  });
});
