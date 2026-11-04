/* ─────────────── Sprite facing hysteresis ───────────────
 * Facing is picked from the heading relative to the camera, so the
 * exploration orbit's +/-18 deg sway turns bodies that never moved. With no
 * band, a resting hero near a 45 deg boundary flipped facing on every swing.
 */
import { describe, it, expect } from 'vitest';
import { pickFacing, pickFlip, FACING_BAND_MOVE, FACING_BAND_REST } from '../src/game/sprite_animator.js';
import { CAM_ORBIT_AMPLITUDE } from '../src/game/camera_director.js';

const DEG = Math.PI / 180;
const at = a => [Math.cos(a), Math.sin(a)];   // dx, dz for a relative heading

/** Sweep the camera through several full sway cycles; count facing changes. */
function flipsUnderSway(base, pick, start, band) {
  let cur = start, flips = 0;
  for (let i = 0; i <= 2000; i++) {
    const a = base + CAM_ORBIT_AMPLITUDE * Math.sin(i / 2000 * 6 * Math.PI);
    const next = pick(cur, ...at(a), band);
    if (next !== cur) { flips++; cur = next; }
  }
  return flips;
}

describe('four-way facing', () => {
  it('rests wider than the orbit sways', () => {
    expect(FACING_BAND_REST).toBeGreaterThan(CAM_ORBIT_AMPLITUDE);
  });

  it('flips a resting body at most once over a whole swaying session', () => {
    for (let b = 0; b < 360; b += 3) {
      const base = b * DEG;
      const start = pickFacing('down', ...at(base));
      expect(flipsUnderSway(base, pickFacing, start, FACING_BAND_REST)).toBeLessThanOrEqual(1);
    }
  });

  it('without the band, a body on the boundary would flip every swing', () => {
    expect(flipsUnderSway(45 * DEG, pickFacing, 'right', 0)).toBeGreaterThan(4);
  });

  it('still follows a real turn promptly while moving', () => {
    expect(pickFacing('right', ...at(60 * DEG), FACING_BAND_MOVE)).toBe('down');
    expect(pickFacing('right', ...at(-60 * DEG), FACING_BAND_MOVE)).toBe('up');
    expect(pickFacing('down', ...at(180 * DEG), FACING_BAND_MOVE)).toBe('left');
    // a quarter turn of the camera carries even a resting body over
    expect(pickFacing('right', ...at(95 * DEG), FACING_BAND_REST)).toBe('down');
  });

  it('holds its axis just past the diagonal, then gives way', () => {
    expect(pickFacing('right', ...at(48 * DEG), FACING_BAND_MOVE)).toBe('right');
    expect(pickFacing('right', ...at(55 * DEG), FACING_BAND_MOVE)).toBe('down');
  });

  it('keeps its facing for a heading too small to read', () => {
    expect(pickFacing('up', 0.01, 0.01)).toBe('up');
  });
});

describe('two-way flip', () => {
  it('flips a resting body at most once over a whole swaying session', () => {
    for (let b = 0; b < 360; b += 3) {
      const base = b * DEG;
      const start = pickFlip(null, ...at(base));
      expect(flipsUnderSway(base, pickFlip, start, FACING_BAND_REST)).toBeLessThanOrEqual(1);
    }
  });

  it('follows a heading clearly to the other side', () => {
    expect(pickFlip(true, -0.5, 0.86)).toBe(false);
    expect(pickFlip(false, 0.5, 0.86)).toBe(true);
    expect(pickFlip(true, -0.05, 1)).toBe(true);     // inside the band: hold
  });
});
