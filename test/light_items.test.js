import { describe, it, expect } from 'vitest';
import { makeHero } from '../src/game/srd.js';
import { makeLightSourceItem, rollItem, BASES, isConsumable } from '../src/game/items.js';
import { heroLightSource, TORCH_STACK_START, VIRTUAL_LIGHTS, clearLightRegistry } from '../src/game/light_sources.js';
import { combatMethods } from '../src/game/combat.js';
import { SPELLS } from '../src/game/spells.js';

const g = (extra = {}) => ({ ...combatMethods, inventory: [], monsters: [], logs: [], fxLog(t) { this.logs.push(t); }, _v3: (x, y, z) => ({ x, y, z }), ...extra });

describe('light items', () => {
  it('torches are a stack that burns down and refills from the bag', () => {
    const h = { x: 0, z: 0, data: makeHero('A', 'human', 'fighter') };
    const tr = h.data.equipment.trinket;
    expect(tr.charges).toBe(TORCH_STACK_START);
    const game = g();
    expect(game.useUpTorch(h)).toBe(TORCH_STACK_START - 1);
    tr.charges = 1;
    game.inventory.push(makeLightSourceItem('torch', 5));
    expect(game.useUpTorch(h)).toBe(5);                       // pulled a fresh bundle
    expect(h.data.equipment.trinket.charges).toBe(5);
    expect(game.inventory.length).toBe(0);
    h.data.equipment.trinket.charges = 1;
    expect(game.useUpTorch(h)).toBe(0);                       // last one out, nothing in the bag
    expect(h.data.equipment.trinket).toBeUndefined();
    expect(heroLightSource(h.data)).toBeNull();
  });

  it('the hooded lantern dims to a glow; the Driftglobe lights from a Kit slot', () => {
    const d = makeHero('B', 'human', 'rogue');
    d.equipment.trinket = makeLightSourceItem('lantern');
    expect(heroLightSource(d)).toBe('lantern');
    d._lanternHooded = true;
    expect(heroLightSource(d)).toBe('lanternHooded');
    delete d.equipment.trinket; d._lanternHooded = false;
    const globe = makeLightSourceItem('driftglobe');
    expect(globe.slot).toBe('kit');
    d.equipment.kit1 = globe;
    expect(heroLightSource(d)).toBe('driftglobe');
    expect(isConsumable(globe)).toBe(false);
  });

  it('the Driftglobe is a rare kit drop past the shallow floors, never a plain kit roll', () => {
    expect(BASES.kit.some(b => b.lightSource === 'driftglobe' && b.noDrop)).toBe(true);
    /* scripted rolls: the first lands on the kit slot, the next passes the 15% check */
    const scripted = (...v) => { let i = 0; return () => v[Math.min(i++, v.length - 1)]; };
    expect(rollItem(8, scripted(0.0, 0.01, 0.5), null, { ilvl: 8 }).lightSource).toBe('driftglobe');
    expect(rollItem(8, scripted(0.0, 0.9, 0.5), null, { ilvl: 8 }).lightSource).toBeFalsy();   // failed the 15%
    expect(rollItem(1, scripted(0.0, 0.01, 0.5), null, { ilvl: 1 }).lightSource).toBeFalsy();  // too shallow
    for (let n = 0; n < 300; n++) {
      const it = rollItem(8, Math.random, 'kit', { ilvl: 8 });   // a forced kit never turns into a globe
      expect(it && it.lightSource).toBeFalsy();
    }
  });

  it('the oil flask is a thrown consumable that leaves a burning pool', () => {
    expect(SPELLS.oilFlask && SPELLS.oilFlask.thrown).toBe(true);
    expect(BASES.trinket.some(b => b.spellKey === 'oilFlask' && b.thrown && !b.noDrop)).toBe(true);
  });

  it('throwing a torch lights a foe you cannot see and costs you the torch and your light for a round', () => {
    clearLightRegistry();
    const h = { x: 0, z: 0, lightState: 'bright', data: makeHero('C', 'human', 'fighter') };
    const lurker = { x: 3, z: 0, lightState: 'dark', active: true, data: { name: 'Lurker', hp: 5, statblock: { senses: {} } } };
    const game = g({ monsters: [lurker] });
    expect(game.throwTorchTarget(h)).toBe(lurker);
    const before = h.data.equipment.trinket.charges;
    expect(game.throwTorch(h)).toBe(true);
    expect(VIRTUAL_LIGHTS.size).toBe(1);
    expect(h.data.equipment.trinket.charges).toBe(before - 1);
    expect(heroLightSource(h.data)).toBeNull();               // readying the next one
    clearLightRegistry();
  });
});
