import { describe, it, expect, vi } from 'vitest';
import { combatMethods } from '../src/game/combat.js';
import { DAMAGE_TYPE_ICONS } from '../src/game/constants.js';

/* The strings combat hands the float-text layer, which is all the pixel numbers have to go on. */
function game() {
  return { ...combatMethods, _v3: (x, y, z) => ({ x, y, z }), fxText: vi.fn() };
}

describe('a number over a hero', () => {
  const hero = { x: 1, z: 2, data: {} };

  it('says what kind of damage it was', () => {
    const g = game();
    g.fxDamageNumber(hero, 9, { dmgType: 'fire' }, '#ff9a7a');
    expect(g.fxText).toHaveBeenCalledWith(`9 ${DAMAGE_TYPE_ICONS.fire}`, expect.anything(), '#ff9a7a', false);
  });

  it('crosses out a type the hero resisted', () => {
    const g = game();
    g.fxDamageNumber(hero, 4, { dmgType: 'cold', resisted: true }, '#ff9a7a');
    expect(g.fxText).toHaveBeenCalledWith(`4 ❌${DAMAGE_TYPE_ICONS.cold}`, expect.anything(), '#ff9a7a', false);
  });

  it('passes a crit on', () => {
    const g = game();
    g.fxDamageNumber(hero, 18, { dmgType: 'slashing' }, '#ff5040', true);
    expect(g.fxText).toHaveBeenCalledWith(`18 ${DAMAGE_TYPE_ICONS.slashing}`, expect.anything(), '#ff5040', true);
  });

  it('prints a bare number when the type is unknown ("magic" is not a damage type)', () => {
    const g = game();
    g.fxDamageNumber(hero, 6, { dmgType: 'magic' }, '#ff9a7a');
    expect(g.fxText).toHaveBeenCalledWith('6', expect.anything(), '#ff9a7a', false);
  });

  it('still says "absorbed" when nothing got through', () => {
    const g = game();
    g.fxDamageNumber(hero, 0, { tempAbsorbed: 5 }, '#ff9a7a');
    expect(g.fxText).toHaveBeenCalledWith('absorbed', expect.anything(), '#6ae0ff');
  });
});
