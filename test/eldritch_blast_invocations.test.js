import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';

describe('Warlock Eldritch Blast & Invocations Engine', () => {
  it('should scale Eldritch Blast beam count by level (Lvl 1=1, Lvl 5=2, Lvl 11=3, Lvl 17=4)', () => {
    const mockGame = {
      markSpellUsed: vi.fn(),
      fxLog: vi.fn(),
      fxSchedule: (delay, cb) => cb(),
      _v3: (x, y, z) => ({ x, y, z }),
      playAbilityFx: vi.fn((h, key, opts) => opts?.onImpact?.()),
      spellDamage: vi.fn(),
      fxSprite: vi.fn(),
      monsters: [{ x: 5, z: 5, data: { hp: 100, scale: 1.0 }, dead: false, active: true }]
    };

    const target = mockGame.monsters[0];

    // Level 1 Warlock -> 1 beam
    SPELLS.eldritchBlast.cast(mockGame, { x: 0, z: 0, data: { level: 1 } }, target);
    expect(mockGame.playAbilityFx).toHaveBeenCalledTimes(1);

    mockGame.playAbilityFx.mockClear();

    // Level 5 Warlock -> 2 beams
    SPELLS.eldritchBlast.cast(mockGame, { x: 0, z: 0, data: { level: 5 } }, target);
    expect(mockGame.playAbilityFx).toHaveBeenCalledTimes(2);

    mockGame.playAbilityFx.mockClear();

    // Level 11 Warlock -> 3 beams
    SPELLS.eldritchBlast.cast(mockGame, { x: 0, z: 0, data: { level: 11 } }, target);
    expect(mockGame.playAbilityFx).toHaveBeenCalledTimes(3);

    mockGame.playAbilityFx.mockClear();

    // Level 17 Warlock -> 4 beams
    SPELLS.eldritchBlast.cast(mockGame, { x: 0, z: 0, data: { level: 17 } }, target);
    expect(mockGame.playAbilityFx).toHaveBeenCalledTimes(4);
  });

  it('should add CHA modifier with Agonizing Blast invocation', () => {
    const mockGame = {
      markSpellUsed: vi.fn(),
      fxLog: vi.fn(),
      fxSchedule: (delay, cb) => cb(),
      _v3: (x, y, z) => ({ x, y, z }),
      playAbilityFx: vi.fn((h, key, opts) => opts?.onImpact?.()),
      spellDamage: vi.fn(),
      fxSprite: vi.fn(),
      monsters: [{ x: 5, z: 5, data: { hp: 100, scale: 1.0 }, dead: false, active: true }]
    };

    const hero = {
      x: 0, z: 0,
      data: { level: 1, effStats: { cha: 18 }, invocations: ['agonizingBlast'] }
    };
    const target = mockGame.monsters[0];

    SPELLS.eldritchBlast.cast(mockGame, hero, target);

    // CHA 18 gives +4 bonus damage per beam (1d10 + 4 >= 5)
    const dmgPassed = mockGame.spellDamage.mock.calls[0][1];
    expect(dmgPassed).toBeGreaterThanOrEqual(5);
  });

  it('should push target back 10 ft with Repelling Blast invocation', () => {
    const mockGame = {
      markSpellUsed: vi.fn(),
      fxLog: vi.fn(),
      fxSchedule: (delay, cb) => cb(),
      _v3: (x, y, z) => ({ x, y, z }),
      playAbilityFx: vi.fn((h, key, opts) => opts?.onImpact?.()),
      spellDamage: vi.fn(),
      fxSprite: vi.fn(),
      monsters: [{ x: 4, z: 0, data: { name: 'Orc', hp: 50, scale: 1.0 }, dead: false, active: true }]
    };

    const hero = {
      x: 0, z: 0,
      data: { level: 5, invocations: ['repellingBlast'] }
    };
    const target = mockGame.monsters[0];

    SPELLS.eldritchBlast.cast(mockGame, hero, target);

    // Pushed 2 tiles away from (4, 0) along positive x -> x should increase to > 5
    expect(target.x).toBeGreaterThan(5.0);
  });

  it('should cast expanded 5e spells Chromatic Orb, Flaming Sphere, and Cloudkill', () => {
    const mockGame = {
      markSpellUsed: vi.fn(),
      playAbilityFx: vi.fn((_h, _key, o) => o?.onImpact?.()),
      fxLog: vi.fn(),
      fxProjectile: (from, to, type, color, onDetonate) => onDetonate(),
      spawnAoEZone: vi.fn().mockReturnValue({ id: 1 }),
      concentrate: vi.fn(),
      spellSave: vi.fn().mockReturnValue(false),
      spellDamage: vi.fn(),
      fxSprite: vi.fn(),
      _v3: (x, y, z) => ({ x, y, z }),
      monsters: [{ x: 5, z: 5, data: { name: 'Troll', hp: 100 }, dead: false, active: true }]
    };

    const hero = { x: 0, z: 0, data: { name: 'Sorcerer', level: 9 } };
    const target = mockGame.monsters[0];

    // Chromatic Orb
    SPELLS.chromaticOrb.cast(mockGame, hero, target, [], 1);
    expect(mockGame.spellDamage).toHaveBeenCalled();

    // Flaming Sphere
    SPELLS.flamingSphere.cast(mockGame, hero, target, [], 2);
    expect(mockGame.spawnAoEZone).toHaveBeenCalledWith(hero, 'flamingSphere', expect.any(Number), expect.any(Number), 1.5, expect.anything());

    // Cloudkill
    SPELLS.cloudkill.cast(mockGame, hero, target, [], 5);
    expect(mockGame.spawnAoEZone).toHaveBeenCalledWith(hero, 'cloudkill', 5, 5, 3.2, expect.anything());
  });
});
