import { describe, it, expect, vi } from 'vitest';
import Game from '../src/game/combat.js';
import { SPELLS } from '../src/game/spells.js';

describe('5e Counterspell Reaction Interrupt Engine', () => {
  it('should interrupt enemy spellcasting using Reaction and 3rd level slot', () => {
    const log = [];
    const mockGame = {
      heroes: [
        {
          x: 2, z: 2, dead: false, active: true, reactionUsed: false,
          data: { name: 'Wizard', knownSpells: ['counterspell'], slots: { 3: 2 } }
        }
      ],
      monsters: [
        { x: 5, z: 5, dead: false, active: true, data: { name: 'Lich', hp: 100 } }
      ],
      playAbilityFx: vi.fn(),
      markSpellUsed: vi.fn(),
      fxText: vi.fn(),
      fxLog: (msg) => log.push(msg),
      refreshHud: vi.fn(),
      _v3: (x, y, z) => ({ x, y, z }),
      canUseSpellRecharge: vi.fn().mockReturnValue(true)
    };

    // Attach checkCounterspellInterrupt & resolveSpell methods
    mockGame.checkCounterspellInterrupt = Game.checkCounterspellInterrupt.bind(mockGame);
    mockGame.resolveSpell = Game.resolveSpell.bind(mockGame);

    const enemy = mockGame.monsters[0];
    const hero = mockGame.heroes[0];

    // Enemy attempts to cast Fireball
    const result = mockGame.resolveSpell(enemy, 'fireball', hero, mockGame.heroes);

    // Spell should be interrupted!
    expect(result).toBe(false);
    expect(hero.reactionUsed).toBe(true);
    expect(hero.data.slots[3]).toBe(1);
    expect(mockGame.playAbilityFx).toHaveBeenCalledWith(hero, 'counterspell', expect.anything());
    expect(log.some(l => l.includes('Counterspell'))).toBe(true);
  });

  it('should not interrupt if reactor has already used their Reaction', () => {
    const mockGame = {
      heroes: [
        {
          x: 2, z: 2, dead: false, active: true, reactionUsed: true, // Reaction spent!
          data: { name: 'Wizard', knownSpells: ['counterspell'], slots: { 3: 2 } }
        }
      ],
      monsters: [
        { x: 5, z: 5, dead: false, active: true, data: { name: 'Cultist', hp: 30 } }
      ],
      playAbilityFx: vi.fn(),
      fxText: vi.fn(),
      fxLog: vi.fn(),
      refreshHud: vi.fn(),
      _v3: (x, y, z) => ({ x, y, z }),
      canUseSpellRecharge: vi.fn().mockReturnValue(true)
    };

    mockGame.checkCounterspellInterrupt = Game.checkCounterspellInterrupt.bind(mockGame);

    const enemy = mockGame.monsters[0];
    const interrupted = mockGame.checkCounterspellInterrupt(enemy, 'fireball', SPELLS.fireball);

    expect(interrupted).toBe(false);
  });
});
