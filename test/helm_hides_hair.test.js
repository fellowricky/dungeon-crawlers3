import { describe, it, expect } from 'vitest';
import { buildLayerPaths, hairLayerPaths } from '../src/game/appearance.js';

/* A hero with long hair and a beard. */
const hero = (extra = {}) => ({ gender: 'male', hair: 'long', hairColor: '#552', facialHair: 'beard', ...extra });
const hairOf = (L) => ['hairBehind', 'hairMid', 'hair', 'hairExtBehind', 'hairExtMid', 'hairExt'].map((k) => L[k]);
const hasHair = (L) => hairOf(L).some(Boolean);

describe('a visible helm hides the hair', () => {
  it('the test hero really has hair to hide', () => {
    expect(Object.values(hairLayerPaths(hero())).some(Boolean)).toBe(true);
    expect(hasHair(buildLayerPaths(hero(), {}))).toBe(true);
  });

  it('a helmet hides every hair layer, and keeps the beard', () => {
    const L = buildLayerPaths(hero(), { helm: { visualHelm: 'helmet/greathelm' } });
    expect(L.helm).toBeTruthy();
    expect(hasHair(L)).toBe(false);
    expect(L.facialHair).toBeTruthy();
  });

  it('hoods and hats hide it too', () => {
    for (const vh of ['cloth/hood', 'pirate/tricorne/basic', 'magic/large']) {
      expect(hasHair(buildLayerPaths(hero(), { helm: { visualHelm: vh } })), vh).toBe(false);
    }
  });

  it('the hair comes back when the hero hides their hat', () => {
    const L = buildLayerPaths(hero({ hideHelm: true }), { helm: { visualHelm: 'helmet/greathelm' } });
    expect(L.helm).toBeNull();
    expect(hasHair(L)).toBe(true);
  });

  it('a headband is worn over the hair, so the hair stays', () => {
    const L = buildLayerPaths(hero(), { helm: { visualHelm: 'headband/thick' } });
    expect(L.helm).toBeTruthy();
    expect(hasHair(L)).toBe(true);
  });
});
