import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';

describe('5e SRD Spell Alignment & Upcasting Tests', () => {
  it('should scale Fireball damage dice when upcast with higher slot levels', () => {
    const log = [];
    const mockGame = {
      markSpellUsed: vi.fn(),
      playAbilityFx: vi.fn(),
      fxLog: (msg) => log.push(msg),
      fxProjectile: (from, to, type, color, onDetonate) => onDetonate(),
      fxSprite: vi.fn(),
      fxSlash: vi.fn(),
      spellSave: vi.fn().mockReturnValue(false),
      spellDamage: vi.fn(),
      _v3: (x, y, z) => ({ x, y, z }),
      monsters: [{ x: 5, z: 5, data: { hp: 50 }, dead: false, active: true }]
    };

    const hero = { x: 0, z: 0, data: { name: 'Wizard', level: 9 } };
    const foe = mockGame.monsters[0];

    // Cast 5th-level Fireball (should be 8 + (5-3) = 10d6)
    SPELLS.fireball.cast(mockGame, hero, foe, [], 5);

    expect(mockGame.spellDamage).toHaveBeenCalledWith(
      foe,
      expect.any(Number),
      hero,
      true,
      expect.objectContaining({ dmgType: 'fire' })
    );
    expect(log.some(l => l.includes('Lvl 5, 10d6'))).toBe(true);
  });

  it('should scale Scorching Ray counts when upcast with higher slot levels', () => {
    const mockGame = {
      markSpellUsed: vi.fn(),
      playAbilityFx: vi.fn(),
      fxLog: vi.fn(),
      fxSchedule: (delay, cb) => cb(),
      fxPlaySfx: vi.fn(),
      _v3: (x, y, z) => ({ x, y, z }),
      fxBeam: vi.fn(({ onHit }) => { if (onHit) onHit(); }),
      spellDamage: vi.fn(),
      fxSprite: vi.fn(),
      monsters: [{ x: 5, z: 5, data: { hp: 100, scale: 1.0 }, dead: false, active: true }]
    };

    const hero = { x: 0, z: 0, data: { name: 'Sorcerer', level: 5 } };
    const foe = mockGame.monsters[0];

    // Cast 4th-level Scorching Ray (should be 3 + (4-2) = 5 rays)
    SPELLS.scorchingRay.cast(mockGame, hero, foe, [], 4);

    expect(mockGame.fxBeam).toHaveBeenCalledTimes(5);
  });

  it('should apply 5e SRD Sleep HP pool allocation without a saving throw', () => {
    const log = [];
    const mockGame = {
      markSpellUsed: vi.fn(),
      playAbilityFx: vi.fn(),
      fxLog: (msg) => log.push(msg),
      fxNow: 100,
      heroes: [],
      monsters: [
        { x: 2, z: 2, data: { name: 'Goblin 1', hp: 8 }, active: true },
        { x: 3, z: 3, data: { name: 'Goblin 2', hp: 12 }, active: true },
        { x: 4, z: 4, data: { name: 'Ogre', hp: 60 }, active: true }
      ]
    };

    const hero = { _side: 'hero', x: 0, z: 0, data: { name: 'Bard', level: 1 } };
    const foe = mockGame.monsters[0];

    // Cast 1st-level Sleep (rolls 5d8 HP pool)
    SPELLS.sleep.cast(mockGame, hero, foe, [], 1);

    expect(mockGame.spellSave).toBeUndefined(); // No save required!
    expect(log.some(l => l.includes('HP pool for Sleep'))).toBe(true);
    expect(mockGame.monsters[0]._effects?.unconscious || mockGame.monsters[1]._effects?.unconscious).toBeDefined();
  });

  it('should push targets 10 ft on failed Thunderwave save', () => {
    const mockGame = {
      markSpellUsed: vi.fn(),
      playAbilityFx: vi.fn(),
      fxLog: vi.fn(),
      spellSave: vi.fn().mockReturnValue(false), // Save failed!
      spellDamage: vi.fn(),
      monsters: [{ x: 2, z: 0, data: { hp: 30 }, dead: false, active: true }]
    };

    const hero = { x: 0, z: 0, data: { name: 'Druid', level: 1 } };
    const foe = mockGame.monsters[0];

    SPELLS.thunderwave.cast(mockGame, hero, foe, [], 1);

    // Target pushed 2 units along (2, 0) vector -> position becomes (4, 0)
    expect(foe.x).toBeGreaterThan(2.0);
    expect(mockGame.spellDamage).toHaveBeenCalledWith(foe, expect.any(Number), hero, false, expect.anything());
  });
});
