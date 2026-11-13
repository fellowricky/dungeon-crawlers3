import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import anims from '../src/game/vfx_animations.json';

function setup() {
  const pending = [];
  const near = { x: 1, z: 0, dead: false, active: true, data: { name: 'Near', hp: 20, maxHp: 20 } };
  const far = { x: 2.8, z: 0, dead: false, active: true, data: { name: 'Far', hp: 20, maxHp: 20 } };
  const h = { x: 0, z: 0, _side: 'hero', data: { name: 'Bard', hp: 20, maxHp: 20, dmgBonus: 0 } };
  const game = {
    monsters: [near, far], markSpellUsed: vi.fn(), fxLog: vi.fn(), playAbilityFx: vi.fn(), spellSave: vi.fn(() => false),
    spellDamage: vi.fn(), pushEntity: vi.fn(), fxThunderclap: vi.fn(), fxDelay: (sec, cb) => pending.push({ sec, cb }),
  };
  return { game, h, near, far, pending };
}

describe('Thunderwave', () => {
  it('has no flight', () => {
    const { travel, impact } = anims.anims.thunderwave;
    expect(travel.back.enabled || travel.front.enabled).toBe(false);
    expect(impact.back.type).toBe('none');
  });

  it('claps round the caster, and hurts nobody until the ring reaches them', () => {
    const { game, h, near, far, pending } = setup();
    SPELLS.thunderwave.cast(game, h, near, [], 1);
    expect(game.spellDamage).not.toHaveBeenCalled();
    pending[0].cb();
    expect(game.fxThunderclap).toHaveBeenCalledWith(h);
    const [nearHit, farHit] = [pending[1], pending[2]];
    expect(nearHit.sec).toBeGreaterThan(0.12);
    expect(farHit.sec).toBeGreaterThan(nearHit.sec);
    expect(farHit.sec).toBeLessThanOrEqual(0.62);
    nearHit.cb();
    expect(game.spellDamage.mock.calls[0][0]).toBe(near);
    expect(game.pushEntity).toHaveBeenCalledTimes(1);
  });

  it('leaves a foe that died first alone', () => {
    const { game, h, near, pending } = setup();
    SPELLS.thunderwave.cast(game, h, near, [], 1);
    near.dead = true;
    pending[1].cb();
    expect(game.spellDamage).not.toHaveBeenCalled();
  });
});
