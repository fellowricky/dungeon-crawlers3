import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { hasEffect } from '../src/game/conditions.js';
import anims from '../src/game/vfx_animations.json';

describe('Shield', () => {
  it('shows nothing but its status: no flight, no sheet, no ring', () => {
    const { travel, impact } = anims.anims.shield;
    expect(travel.back.enabled || travel.front.enabled).toBe(false);
    expect(impact.back.type).toBe('none');
    expect(impact.front.enabled).toBe(false);
  });

  it('protects from when the charge ends', () => {
    const pending = [];
    const h = { x: 0, z: 0, data: { name: 'Wizard', hp: 5, maxHp: 20 } };
    const game = { fxNow: 0, markSpellUsed: vi.fn(), fxLog: vi.fn(), playAbilityFx: vi.fn(), fxDelay: (sec, cb) => pending.push({ sec, cb }) };
    SPELLS.shield.cast(game, h);
    expect(hasEffect(h, 'shielded')).toBe(false);
    pending[0].cb();
    expect(hasEffect(h, 'shielded')).toBe(true);
  });
});
