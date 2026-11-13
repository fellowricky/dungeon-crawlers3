import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { hasEffect } from '../src/game/conditions.js';
import anims from '../src/game/vfx_animations.json';

function setup() {
  const pending = [];
  const ally = { _side: 'hero', data: { name: 'Ally', hp: 20, maxHp: 20 } };
  const hurt = { _side: 'hero', data: { name: 'Hurt', hp: 3, maxHp: 20 } };
  const h = { _side: 'hero', data: { name: 'Cleric', hp: 20, maxHp: 20 } };
  const game = { fxNow: 0, markSpellUsed: vi.fn(), fxLog: vi.fn(), playAbilityFx: vi.fn(), concentrate: vi.fn(), fxDelay: (sec, cb) => pending.push({ sec, cb }) };
  return { game, h, ally, hurt, pending };
}

describe('Shield of Faith', () => {
  it('shows nothing but its status', () => {
    const { travel, impact } = anims.anims.shieldOfFaith;
    expect(travel.back.enabled || travel.front.enabled).toBe(false);
    expect(impact.back.type).toBe('none');
    expect(impact.front.enabled).toBe(false);
  });

  it('wards the most-wounded ally when the charge ends', () => {
    const { game, h, ally, hurt, pending } = setup();
    expect(SPELLS.shieldOfFaith.cast(game, h, null, [h, ally, hurt])).toBe(true);
    expect(hasEffect(hurt, 'shieldOfFaith')).toBe(false);
    pending[0].cb();
    expect(hasEffect(hurt, 'shieldOfFaith')).toBe(true);
    expect(game.concentrate.mock.calls[0][1]).toBe('shieldOfFaith');
  });

  it('wards the ally it was aimed at, even at full health', () => {
    const { game, h, ally, hurt, pending } = setup();
    SPELLS.shieldOfFaith.cast(game, h, ally, [h, ally, hurt]);
    pending[0].cb();
    expect(hasEffect(ally, 'shieldOfFaith')).toBe(true);
  });

  it('with nobody hurt and nobody aimed at, is not cast', () => {
    const { game, h, ally } = setup();
    expect(SPELLS.shieldOfFaith.cast(game, h, null, [h, ally])).toBe(false);
    expect(game.markSpellUsed).not.toHaveBeenCalled();
  });
});
