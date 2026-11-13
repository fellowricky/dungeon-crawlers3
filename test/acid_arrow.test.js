import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { combatMethods } from '../src/game/combat.js';
import { hasEffect } from '../src/game/conditions.js';
import { ROUND_SECONDS } from '../src/game/conditions.js';
import anims from '../src/game/vfx_animations.json';

function setup() {
  const pending = [];
  const foe = { x: 5, z: 5, dead: false, data: { name: 'Orc', hp: 20, maxHp: 20 } };
  const h = { x: 0, z: 0, data: { name: 'Wizard', hp: 20, maxHp: 20, dmgBonus: 0 } };
  const game = {
    _v3: (x, y, z) => ({ x, y, z }), markSpellUsed: vi.fn(), fxLog: vi.fn(), playAbilityFx: vi.fn(), spellDamage: vi.fn(),
    fxAcidSplat: vi.fn(), fxPlaySfx: vi.fn(), fxProjectile: vi.fn(), fxDelay: (sec, cb) => pending.push({ sec, cb }),
  };
  return { game, h, foe, pending };
}

describe('Acid Arrow', () => {
  it('flies a green arrow over a ribbon, and nothing else', () => {
    const { game, h, foe } = setup();
    SPELLS.acidArrow.cast(game, h, foe);
    expect(game.fxProjectile).not.toHaveBeenCalled();
    expect(game.playAbilityFx.mock.calls[0][2].at).toBe(foe);
    const { back, front } = anims.anims.acidArrow.travel;
    expect(front).toMatchObject({ type: 'live', fx: 'arrow', palette: 'leaf', orient: true });
    expect(back).toMatchObject({ type: 'live', fx: 'magicRibbon', palette: 'leaf' });
  });

  it('bursts as liquid and hurts on landing, with more acid still to come', () => {
    const { game, h, foe } = setup();
    SPELLS.acidArrow.cast(game, h, foe);
    game.playAbilityFx.mock.calls[0][2].onImpact();
    expect(game.fxAcidSplat).toHaveBeenCalled();
    expect(game.spellDamage).toHaveBeenCalledTimes(1);
    expect(foe.acid.dmg).toBeGreaterThanOrEqual(2);
    expect(foe.acid.dmg).toBeLessThanOrEqual(8);
    expect(hasEffect(foe, 'acidCoated')).toBe(true);
  });

  it('does not hurt a corpse, or leave acid on one', () => {
    const { game, h, foe } = setup();
    SPELLS.acidArrow.cast(game, h, foe);
    foe.dead = true;
    game.playAbilityFx.mock.calls[0][2].onImpact();
    expect(game.spellDamage).not.toHaveBeenCalled();
    expect(foe.acid).toBeUndefined();
  });

  it('bites again a round later, once', () => {
    const src = { data: {} }, m = { dead: false, data: { hp: 20 }, acid: { dmg: 5, src, clock: 0 } };
    const game = { ...combatMethods, monsters: [m], fxNow: ROUND_SECONDS - 0.1, spellDamage: vi.fn() };
    game.updateMonsterStatus();
    expect(game.spellDamage).not.toHaveBeenCalled();
    game.fxNow = ROUND_SECONDS;
    game.updateMonsterStatus();
    game.updateMonsterStatus();
    expect(game.spellDamage).toHaveBeenCalledTimes(1);
    expect(game.spellDamage.mock.calls[0][1]).toBe(5);
    expect(game.spellDamage.mock.calls[0][4].dmgType).toBe('acid');
    expect(m.acid).toBeNull();
  });
});
