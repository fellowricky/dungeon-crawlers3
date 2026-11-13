import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';

function setup() {
  const pending = [];
  let crossing = null;
  const h = { x: 0, z: 0, data: { name: 'Sorcerer', hp: 20, maxHp: 20 } };
  const game = {
    markSpellUsed: vi.fn(), fxLog: vi.fn(), playAbilityFx: vi.fn(), teleportEntity: vi.fn(),
    escapeTeleportCell: vi.fn(() => 7), isCellOccupiedAny: vi.fn(() => false),
    fxDelay: (_s, fn) => pending.push(fn),
    fxBlinkStep: vi.fn((_e, cross) => { crossing = cross; }),
  };
  return { game, h, flush: () => pending.splice(0).forEach((fn) => fn()), cross: () => crossing() };
}

describe('Misty Step', () => {
  it('keeps the slot when there is nowhere to go', () => {
    const { game, h } = setup();
    game.escapeTeleportCell.mockReturnValue(-1);
    expect(SPELLS.mistyStep.cast(game, h)).toBe(false);
    expect(game.markSpellUsed).not.toHaveBeenCalled();
  });

  it('does not move until the blink crosses, then lands on the chosen tile', () => {
    const { game, h, flush, cross } = setup();
    expect(SPELLS.mistyStep.cast(game, h)).toBe(true);
    flush();
    expect(game.fxBlinkStep).toHaveBeenCalledWith(h, expect.any(Function));
    expect(game.teleportEntity).not.toHaveBeenCalled();
    cross();
    expect(game.teleportEntity).toHaveBeenCalledWith(h, 7);
  });

  it('finds another tile if someone stepped onto it during the blink', () => {
    const { game, h, flush, cross } = setup();
    SPELLS.mistyStep.cast(game, h);
    flush();
    game.isCellOccupiedAny.mockReturnValue(true);
    game.escapeTeleportCell.mockReturnValue(9);
    cross();
    expect(game.teleportEntity).toHaveBeenCalledWith(h, 9);
  });

  it('a caster who fell during the blink stays where they fell', () => {
    const { game, h, flush, cross } = setup();
    SPELLS.mistyStep.cast(game, h);
    flush();
    h.data.hp = 0;
    cross();
    expect(game.teleportEntity).not.toHaveBeenCalled();
  });
});
