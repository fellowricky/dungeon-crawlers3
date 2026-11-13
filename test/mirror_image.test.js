import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { getEffect, hasEffect } from '../src/game/conditions.js';
import { combatMethods } from '../src/game/combat.js';

function setup() {
  const pending = [];
  const h = { x: 0, z: 0, data: { name: 'Sorcerer', hp: 20, maxHp: 20, effStats: { dex: 10 } } };
  const game = {
    fxNow: 0, markSpellUsed: vi.fn(), fxLog: vi.fn(), playAbilityFx: vi.fn(),
    fxDelay: (_s, fn) => pending.push(fn),
  };
  return { game, h, flush: () => pending.splice(0).forEach((fn) => fn()) };
}

describe('Mirror Image', () => {
  it('the three images appear as the charge ends', () => {
    const { game, h, flush } = setup();
    expect(SPELLS.mirrorImage.cast(game, h)).toBe(true);
    expect(hasEffect(h, 'mirrorImages')).toBe(false);
    flush();
    expect(getEffect(h, 'mirrorImages').images).toBe(3);
  });

  it('fizzles if the caster falls during the charge', () => {
    const { game, h, flush } = setup();
    SPELLS.mirrorImage.cast(game, h);
    h.data.hp = 0;
    flush();
    expect(hasEffect(h, 'mirrorImages')).toBe(false);
  });

  it('a blow that misses the image flickers it; one that beats its AC breaks it', () => {
    const { game, h, flush } = setup();
    SPELLS.mirrorImage.cast(game, h);
    flush();
    const g = { ...combatMethods, fxText: vi.fn(), fxLog: vi.fn(), _v3: (x, y, z) => ({ x, y, z }), fxMirrorFlicker: vi.fn() };
    const r = vi.spyOn(Math, 'random').mockReturnValue(0.99);   // the d20 always goes for an image
    expect(g.mirrorImageIntercept(h, 1)).toBe(true);
    expect(g.fxMirrorFlicker).toHaveBeenCalledWith(h);
    expect(getEffect(h, 'mirrorImages').images).toBe(3);
    expect(g.mirrorImageIntercept(h, 25)).toBe(true);
    expect(g.fxMirrorFlicker).toHaveBeenCalledTimes(1);
    expect(getEffect(h, 'mirrorImages').images).toBe(2);
    r.mockRestore();
  });
});
