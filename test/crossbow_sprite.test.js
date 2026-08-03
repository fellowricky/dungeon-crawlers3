import { describe, it, expect } from 'vitest';
import { buildLayerPaths } from '../src/game/appearance.js';

describe('Crossbow Sprite Layering', () => {
  it('does not include weapon_behind for crossbows to prevent duplicate bow rendering', () => {
    const visual = { gender: 'male' };
    const equipment = {
      weapon: { visualWeapon: 'ranged/crossbow' }
    };

    const paths = buildLayerPaths(visual, equipment);
    expect(paths.weapon).toBe('weapon/ranged/crossbow');
    expect(paths.weapon_behind).toBeNull();
  });

  it('preserves weapon_behind for regular bows', () => {
    const visual = { gender: 'male' };
    const equipment = {
      weapon: { visualWeapon: 'ranged/bow' }
    };

    const paths = buildLayerPaths(visual, equipment);
    expect(paths.weapon).toBe('weapon/ranged/bow');
    expect(paths.weapon_behind).toBe('weapon_behind/ranged/bow');
  });
});
