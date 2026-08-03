import { describe, it, expect } from 'vitest';
import { buildLayerPaths } from '../src/game/appearance.js';
import { SETTING_DEFAULTS } from '../src/game/settings.js';

describe('Per-hero hide-hats toggle', () => {
  it('includes helm layer when hat is equipped and hideHelm is false', () => {
    const visual = { gender: 'male' };
    const equipment = { helm: { visualHelm: 'hood' } };

    const layers = buildLayerPaths(visual, equipment);
    expect(layers.helm).toBe('hat/hood/adult');
  });

  it('hides helm layer when visual.hideHelm is true', () => {
    const visual = { gender: 'male', hideHelm: true };
    const equipment = { helm: { visualHelm: 'hood' } };

    const layers = buildLayerPaths(visual, equipment);
    expect(layers.helm).toBeNull();
  });

  it('hides the visor layer alongside the helm', () => {
    const equipment = { helm: { visualHelm: 'greathelm', visualVisor: 'slit' } };

    const shown = buildLayerPaths({ gender: 'male' }, equipment);
    expect(shown.visor).toBe('hat/visor/slit/adult');

    const hidden = buildLayerPaths({ gender: 'male', hideHelm: true }, equipment);
    expect(hidden.visor).toBeNull();
  });

  it('is per hero — one hero hiding hats does not affect another', () => {
    const equipment = { helm: { visualHelm: 'hood' } };

    const hiding = buildLayerPaths({ gender: 'male', hideHelm: true }, equipment);
    const showing = buildLayerPaths({ gender: 'female' }, equipment);

    expect(hiding.helm).toBeNull();
    expect(showing.helm).toBe('hat/hood/adult');
  });

  it('drops only headgear layers — body and armor are untouched', () => {
    const visual = { gender: 'male', hideHelm: true };
    const equipment = {
      helm: { visualHelm: 'hood' },
      armor: { visualTorso: 'armour/plate' }
    };

    const layers = buildLayerPaths(visual, equipment);
    expect(layers.helm).toBeNull();
    expect(layers.body).toBe('body/bodies/male');
    expect(layers.torso).toBe('torso/armour/plate/male');
  });

  it('is no longer a global setting in the options menu', () => {
    expect(SETTING_DEFAULTS).not.toHaveProperty('hideHats');
  });
});
