import { describe, it, expect, vi } from 'vitest';
import { SPELLS, CHROMATIC_ORB_HIT_MS } from '../src/game/spells.js';
import anims from '../src/game/vfx_animations.json';

function setup() {
  const pending = [];
  const foe = { x: 4, z: 0, dead: false, data: { name: 'Goblin', hp: 30, maxHp: 30, scale: 1 } };
  const h = { x: 0, z: 0, data: { name: 'Mage', level: 3, hp: 20, dmgBonus: 0 } };
  const game = {
    fxLog: vi.fn(), markSpellUsed: vi.fn(), spellDamage: vi.fn(), fxProjectile: vi.fn(),
    _v3: (x, y, z) => ({ x, y, z }),
    fxChestPos: (e) => ({ x: e.x, y: 0.5, z: e.z }),
    fxGroundY: () => 0,
    fxElementImpact: vi.fn(), fxPlaySfx: vi.fn(),
    playAbilityFx: vi.fn(),
    fxDelay: (sec, cb) => pending.push({ sec, cb }),
  };
  return { game, h, foe, pending };
}

describe('Chromatic Orb', () => {
  it('flies its own animation at the target, with no second projectile', () => {
    const { game, h, foe } = setup();
    expect(SPELLS.chromaticOrb.cast(game, h, foe)).toBe(true);
    const [, key, o] = game.playAbilityFx.mock.calls[0];
    expect(key).toBe('chromaticOrb');
    expect(o.at).toBe(foe);
    expect(o.toPos.x).toBe(foe.x);
    expect(game.fxProjectile).not.toHaveBeenCalled();
  });

  it('lands the rolled type\'s effect, then hurts on its flash', () => {
    const { game, h, foe, pending } = setup();
    SPELLS.chromaticOrb.cast(game, h, foe);
    game.playAbilityFx.mock.calls[0][2].onImpact();
    const type = game.fxElementImpact.mock.calls[0][1];
    expect(pending[0].sec).toBeCloseTo(CHROMATIC_ORB_HIT_MS[type] / 1000);
    expect(game.spellDamage).not.toHaveBeenCalled();
    pending[0].cb();
    expect(game.spellDamage.mock.calls[0][4].dmgType).toBe(type);
    expect(game.fxPlaySfx).toHaveBeenCalledWith('spellImpact', expect.anything());
  });

  it('does not hurt a corpse', () => {
    const { game, h, foe, pending } = setup();
    SPELLS.chromaticOrb.cast(game, h, foe);
    game.playAbilityFx.mock.calls[0][2].onImpact();
    foe.dead = true;
    pending[0].cb();
    expect(game.spellDamage).not.toHaveBeenCalled();
  });

  it('holds the turn for the landing without the old sheet impact', () => {
    const { back, front } = anims.anims.chromaticOrb.impact;
    expect(back.type).toBe('none');
    expect(back.dur).toBeGreaterThanOrEqual(1.5);
    expect(front.enabled).toBe(false);
  });

  it('draws the orb sheet over the ribbon, whole by the time it lands', () => {
    const { duration, front, back } = anims.anims.chromaticOrb.travel;
    expect(front.sheet).toBe('spell_chromaticOrb');
    expect(front.renderOrder).toBeGreaterThan(40);   // live missiles draw at 40
    expect(back.fx).toBe('magicRibbon');
    expect(duration * front.fps * 0.7).toBeGreaterThanOrEqual(18);   // frame 19 is the orb at full size
  });
});
