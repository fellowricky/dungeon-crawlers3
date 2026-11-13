import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { aoeZoneManager } from '../src/game/aoe_system.js';
import { getEffect } from '../src/game/conditions.js';
import anims from '../src/game/vfx_animations.json';

/* grid cells on a 20-wide map: (19, 19), well outside the circle, and (5, 5), inside it */
const FAR = 19 + 19 * 20, IN_ZONE = 5 + 5 * 20;

function setup(saved = false) {
  const pending = [];
  const foe = { x: 5, z: 5, dead: false, active: true, _side: 'monster', data: { name: 'Orc', hp: 20, maxHp: 20 } };
  const h = { x: 0, z: 0, _side: 'hero', data: { name: 'Bard', hp: 20, maxHp: 20, level: 3 } };
  const sparkle = { remove: vi.fn() };
  const game = {
    heroes: [h], monsters: [foe], fxNow: 0,
    markSpellUsed: vi.fn(), fxLog: vi.fn(), playAbilityFx: vi.fn(), concentrate: vi.fn(),
    spawnAoEZone: vi.fn(() => ({})), spellSave: vi.fn(() => saved),
    fxFaerieStars: vi.fn(), fxFaerieSparkle: vi.fn(() => sparkle),
    fxDelay: (sec, cb) => pending.push({ sec, cb }),
  };
  return { game, h, foe, sparkle, pending };
}

describe('Faerie Fire', () => {
  it('has no flight', () => {
    const { travel, impact } = anims.anims.faerieFire;
    expect(travel.back.enabled || travel.front.enabled).toBe(false);
    expect(impact.back.type).toBe('none');
  });

  it('rains stars after the charge, then lights the area as they land', () => {
    const { game, h, foe, sparkle, pending } = setup();
    SPELLS.faerieFire.cast(game, h, foe);
    pending[0].cb();
    expect(game.fxFaerieStars).toHaveBeenCalledWith(5, 5);
    expect(game.spawnAoEZone).not.toHaveBeenCalled();
    pending[1].cb();
    const opts = game.spawnAoEZone.mock.calls[0][5];
    expect(opts.procedural).toBeUndefined();
    expect(game.spawnAoEZone.mock.results[0].value.liveFx).toBe(sparkle);
    expect(getEffect(foe, 'faerieFire')).toBeTruthy();
    expect(game.concentrate.mock.calls[0][2]).toEqual([{ e: foe, key: 'faerieFire' }]);
  });

  it('marks a foe stepping in on a failed save, and adds it to the concentration', () => {
    const caster = { _side: 'hero', x: 0, z: 0, active: true, data: { hp: 20, maxHp: 20, level: 3 }, conc: { targets: [] } };
    const actor = { _side: 'monster', x: 5, z: 5, active: true, data: { name: 'Orc', hp: 20 } };
    const game = { spellSave: vi.fn(() => false), fxLog: vi.fn(), fxNow: 0, D: { W: 20 } };
    const zone = { spellKey: 'faerieFire', caster, x: 5, z: 5, radius: 2.5, shape: 'circle', savesThisTurn: new Set() };
    game.activeAoEZones = [zone];
    aoeZoneManager.processStepZones(game, actor, FAR, IN_ZONE);
    expect(getEffect(actor, 'faerieFire')).toBeTruthy();
    expect(caster.conc.targets).toEqual([{ e: actor, key: 'faerieFire' }]);
  });

  it('leaves the caster\'s own side alone', () => {
    const caster = { _side: 'hero', x: 0, z: 0, active: true, data: { hp: 20, maxHp: 20, level: 3 }, conc: { targets: [] } };
    const ally = { _side: 'hero', x: 5, z: 5, active: true, data: { name: 'Ally', hp: 20 } };
    const game = { spellSave: vi.fn(() => false), fxLog: vi.fn(), fxNow: 0, D: { W: 20 } };
    const zone = { spellKey: 'faerieFire', caster, x: 5, z: 5, radius: 2.5, shape: 'circle', savesThisTurn: new Set() };
    game.activeAoEZones = [zone];
    aoeZoneManager.processStepZones(game, ally, FAR, IN_ZONE);
    expect(game.spellSave).not.toHaveBeenCalled();
    expect(getEffect(ally, 'faerieFire')).toBeNull();
  });
});
