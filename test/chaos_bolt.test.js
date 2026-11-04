import { describe, it, expect, vi } from 'vitest';
import { SPELLS, CHAOS_BOLT_PALETTES } from '../src/game/spells.js';
import { LIGHT_SOURCES, dancingLightCarriers } from '../src/game/light_sources.js';

function setup() {
  const foe = { x: 4, z: 0, dead: false, data: { name: 'Goblin', hp: 30, maxHp: 30, scale: 1 } };
  const h = { x: 0, z: 0, data: { name: 'Sorc', level: 3, hp: 20, dmgBonus: 0, effStats: { cha: 16 } } };
  const pending = [];
  const game = {
    fxNow: 0, monsters: [foe], heroes: [h],
    fxLog: vi.fn(), markSpellUsed: vi.fn(), spellDamage: vi.fn(), fxManaBurst: vi.fn(),
    _v3: (x, y, z) => ({ x, y, z }),
    fxChestPos: (e) => ({ x: e.x, y: 0.5, z: e.z }),
    fxGroundY: () => 0,
    playAbilityFx: vi.fn((_c, _k, o) => o.onImpact()),
    fxDelay: (sec, cb) => pending.push({ sec, cb }),
  };
  return { game, h, foe, pending };
}

describe('Chaos Bolt', () => {
  it('flies at the target, then bursts in the palette of the type it rolled', () => {
    const { game, h, foe, pending } = setup();
    expect(SPELLS.chaosBolt.cast(game, h, foe)).toBe(true);
    expect(game.playAbilityFx.mock.calls[0][2].at).toBe(foe);
    expect(game.spellDamage).not.toHaveBeenCalled();
    pending[0].cb();
    const dmgType = game.spellDamage.mock.calls[0][4].dmgType;
    expect(game.fxManaBurst.mock.calls[0][1]).toBe(CHAOS_BOLT_PALETTES[dmgType]);
  });

  it('has a palette for every type it can roll', () => {
    expect(Object.keys(CHAOS_BOLT_PALETTES).sort()).toEqual(['acid', 'cold', 'fire', 'lightning', 'poison', 'thunder']);
  });

  it('hits on the burst\'s flash, and not a corpse', () => {
    const { game, h, foe, pending } = setup();
    SPELLS.chaosBolt.cast(game, h, foe);
    expect(pending[0].sec).toBeCloseTo(0.22);
    foe.dead = true;
    pending[0].cb();
    expect(game.spellDamage).not.toHaveBeenCalled();
  });
});

describe('Dancing Lights as light sources', () => {
  it('shines like a torch at half brightness, without a floor disc', () => {
    expect(LIGHT_SOURCES.dancingLight.base).toBeCloseTo(LIGHT_SOURCES.torch.base / 2);
    expect(LIGHT_SOURCES.dancingLight.color).toBe(LIGHT_SOURCES.torch.color);
    expect(LIGHT_SOURCES.dancingLight.reach).toBe(LIGHT_SOURCES.torch.reach);
  });

  it('lists each wisp of each living caster', () => {
    const motes = [{ x: 1, z: 2 }, { x: 3, z: 4 }];
    const carriers = dancingLightCarriers([
      { data: { hp: 5 }, _dancingLights: motes },
      { data: { hp: 0 }, _dancingLights: [{ x: 9, z: 9 }] },
      { data: { hp: 5 } },
    ]);
    expect(carriers.map(c => c.h)).toEqual(motes);
    expect(carriers[0].src).toBe(LIGHT_SOURCES.dancingLight);
  });
});
