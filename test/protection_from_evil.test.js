import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { applyEffect, hasEffect } from '../src/game/conditions.js';
import anims from '../src/game/vfx_animations.json';

function setup() {
  const pending = [];
  const h = { x: 0, z: 0, data: { name: 'Paladin', hp: 20, maxHp: 20, level: 3 } };
  const game = {
    fxNow: 0, markSpellUsed: vi.fn(), fxLog: vi.fn(), playAbilityFx: vi.fn(), fxWardCircle: vi.fn(),
    fxDelay: (sec, cb) => pending.push({ sec, cb }),
  };
  return { game, h, pending };
}

describe('Protection from Evil', () => {
  it('has no flight', () => {
    const { travel, impact } = anims.anims.protectionFromEvil;
    expect(travel.back.enabled || travel.front.enabled).toBe(false);
    expect(impact.back.type).toBe('none');
  });

  it('opens the circle, then cleanses and wards as it turns', () => {
    const { game, h, pending } = setup();
    applyEffect(h, 'charmed', { duration: 60, elapsed: 0 });
    SPELLS.protectionFromEvil.cast(game, h);
    pending[0].cb();
    expect(game.fxWardCircle).toHaveBeenCalledWith(h);
    expect(hasEffect(h, 'warded')).toBe(false);
    expect(hasEffect(h, 'charmed')).toBe(true);
    expect(pending[1].sec).toBeCloseTo(0.6);
    pending[1].cb();
    expect(hasEffect(h, 'warded')).toBe(true);
    expect(hasEffect(h, 'charmed')).toBe(false);
  });
});
