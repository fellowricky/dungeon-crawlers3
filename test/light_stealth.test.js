import { describe, it, expect } from 'vitest';
import { canSee, canHide, perceptionAdv } from '../src/game/light_rules.js';
import { setLightProbe, lightStateAt } from '../src/game/light_sources.js';
import { combatMethods } from '../src/game/combat.js';
import { makeHero } from '../src/game/srd.js';
import { makeLightSourceItem } from '../src/game/items.js';

const unit = (data, o = {}) => ({ x: 0, z: 0, lightState: 'dim', data: { name: 'U', hp: 10, feats: [], features: [], invocations: [], skills: {}, ...data }, ...o });
const monster = (senses = {}, o = {}) => ({ x: 3, z: 0, lightState: 'bright', data: { name: 'M', hp: 10, statblock: { senses } }, ...o });

describe('stealth & shadow', () => {
  it('Hide: rogues (Cunning Action) and Skulkers can hide in dim or dark, never in bright light', () => {
    const rogue = unit({ features: ['cunningActionClass'] });
    expect(canHide(rogue)).toBe(true);
    expect(canHide({ ...rogue, lightState: 'dark' })).toBe(true);
    expect(canHide({ ...rogue, lightState: 'bright' })).toBe(false);
    expect(canHide(unit({ feats: ['skulker'] }))).toBe(true);
    expect(canHide(unit({}))).toBe(false);                           // no way to hide
  });

  it('a hidden creature is unseen even by darkvision, until it steps into bright light; blindsight finds it', () => {
    const rogue = unit({ features: ['cunningActionClass'] }, { _hidden: true, lightState: 'dim' });
    expect(canSee(monster({ darkvision: 60 }), rogue)).toBe(false);
    expect(canSee(monster({ blindsight: 30 }), rogue)).toBe(true);
    rogue.lightState = 'bright';
    expect(canSee(monster(), rogue)).toBe(true);
    expect(rogue._hidden).toBe(false);
  });

  it('Umbral Sight: darkvision cannot see the ranger in the dark; blindsight still can', () => {
    const ranger = unit({ skills: { umbralSight: 1 } }, { lightState: 'dark' });
    expect(canSee(monster({ darkvision: 60 }), ranger)).toBe(false);
    expect(canSee(monster({ blindsight: 60 }), ranger)).toBe(true);
    const plain = unit({}, { lightState: 'dark' });
    expect(canSee(monster({ darkvision: 60 }), plain)).toBe(true);
  });

  it('Skulker: dim light never hinders Perception (darkness still does)', () => {
    expect(perceptionAdv(unit({ feats: ['skulker'] }, { lightState: 'dim' }))).toBe(0);
    expect(perceptionAdv(unit({ feats: ['skulker'] }, { lightState: 'dark' }))).toBe(-1);
  });

  it('tile light comes from the registered probe; bright when none', () => {
    setLightProbe(null);
    expect(lightStateAt(0, 0)).toBe('bright');
    setLightProbe((x) => (x > 5 ? 'dark' : 'dim'));
    expect(lightStateAt(9, 0)).toBe('dark');
    expect(lightStateAt(1, 0)).toBe('dim');
    setLightProbe(null);
  });

  /* A tiny game: one torch on the wall above floor tile (2,1) of a 5x5 room. */
  const tinyGame = () => {
    const W = 5, H = 5;
    const grid = new Uint8Array(W * H).fill(1);
    const torch = { x: 2, y: 0, dx: 0, dy: 1 };
    const g = {
      ...combatMethods,
      D: { W, H, grid, torches: [torch] },
      wx: x => x - W / 2 + 0.5, wz: y => y - H / 2 + 0.5,
      cellOf(x, z) { return Math.round(z + H / 2 - 0.5) * W + Math.round(x + W / 2 - 0.5); },
      isCellOccupiedAny: () => false,
      logs: [], fxLog(t) { this.logs.push(t); },
      engine: { setTorchLit: (t, lit) => { t.lit = lit; } },
    };
    return { g, torch };
  };

  it('Snuff is the Thief\'s; Kindle needs a carried flame; each toggles the sconce', () => {
    const { g, torch } = tinyGame();
    const at = { x: g.wx(2), z: g.wz(1) };                          // the floor the torch lights
    const thief = { ...at, data: makeHero('T', 'human', 'rogue') };
    thief.data.subclass = 'thief';
    const fighter = { ...at, data: makeHero('F', 'human', 'fighter') };   // starts with a torch
    expect(g.canSnuff(thief)).toBe(true);
    expect(g.canSnuff(fighter)).toBe(false);
    expect(g.canKindle(fighter)).toBe(false);                      // nothing unlit yet
    expect(g.snuffTorch(thief)).toBe(true);
    expect(torch.lit).toBe(false);
    expect(g.canKindle(fighter)).toBe(true);
    delete fighter.data.equipment.trinket;                         // no flame, no kindle
    expect(g.canKindle(fighter)).toBe(false);
    fighter.data.equipment.trinket = makeLightSourceItem('lantern');
    expect(g.kindleTorch(fighter)).toBe(true);
    expect(torch.lit).toBe(true);
    /* far from the wall: nothing in reach */
    const away = { x: g.wx(2), z: g.wz(4), data: thief.data };
    expect(g.canSnuff(away)).toBe(false);
  });

  it('Shadow Step lands only on a free shadowed tile beside the foe', () => {
    const { g } = tinyGame();
    const foe = { x: g.wx(2), z: g.wz(2) };
    const monk = { x: g.wx(0), z: g.wz(4) };
    setLightProbe(() => 'bright');
    expect(g.shadowCellBeside(monk, foe, 12)).toBe(-1);            // no shadow anywhere
    setLightProbe((x, z) => (x > 0.5 ? 'dark' : 'bright'));        // the east side is dark
    const c = g.shadowCellBeside(monk, foe, 12);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(g.wx(c % 5)).toBeGreaterThan(0.5);
    setLightProbe(null);
  });
});
