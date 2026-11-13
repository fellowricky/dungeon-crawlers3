import { describe, it, expect, vi } from 'vitest';
import { combatMethods } from '../src/game/combat.js';

const hero = (level, extra = {}) => ({ data: { level }, ...extra });

describe('celebrateLevelUps', () => {
  it('plays on each hero who gained a level, and nobody else', () => {
    const game = { ...combatMethods, fxLevelUp: vi.fn() };
    const up = hero(3), same = hero(2);
    game.celebrateLevelUps([up, same], [2, 2]);
    expect(game.fxLevelUp.mock.calls).toEqual([[up]]);
  });

  it('skips companions and temporary allies', () => {
    const game = { ...combatMethods, fxLevelUp: vi.fn() };
    game.celebrateLevelUps([hero(3, { companion: true }), hero(3, { temp: true })], [2, 2]);
    expect(game.fxLevelUp).not.toHaveBeenCalled();
  });

  it('does nothing without the effect hook', () => {
    expect(() => ({ ...combatMethods }).celebrateLevelUps([hero(3)], [2])).not.toThrow();
  });
});
