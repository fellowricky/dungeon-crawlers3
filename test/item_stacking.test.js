import { describe, it, expect, vi } from 'vitest';
import { makeDye, rollItem, addToInventory, takeFromInventory, coalesceInventory, stackKey, qtyOf, isStackable } from '../src/game/items.js';
import { inventoryMethods } from '../src/game/inventory.js';
import { makeHero } from '../src/game/srd.js';

vi.mock('../src/game/ui.js', () => ({
  log: () => {}, updateResources: () => {}, updatePartyFrames: () => {}, drawBar: () => {}
}));

/* Dyes and consumables are stock, not gear: the same colour or the same scroll
   is one bag cell with a count. Gear keeps one cell per piece — every piece
   has its own rolls. */

const crimson = () => makeDye(() => 0, { rarity: 'common', color: { name: 'Crimson', hex: '#a32020' } });
const scroll = () => rollItem(5, () => 0.99, 'trinket');   // top of the trinket pool, deterministic

describe('stack keys', () => {
  it('two dyes of one colour and rarity share a key; different colours do not', () => {
    expect(stackKey(crimson())).toBe(stackKey(crimson()));
    const navy = makeDye(() => 0, { rarity: 'common', color: { name: 'Navy', hex: '#1b2a6b' } });
    expect(stackKey(navy)).not.toBe(stackKey(crimson()));
  });
  it('a half-read scroll does not key with a fresh one', () => {
    const a = scroll(), b = scroll();
    expect(stackKey(a)).toBe(stackKey(b));
    b.charges = Math.max(0, b.charges - 1);
    expect(stackKey(a)).not.toBe(stackKey(b));
  });
  it('gear never stacks', () => {
    const sword = rollItem(3, () => 0.3, 'weapon');
    expect(isStackable(sword)).toBe(false);
    expect(stackKey(sword)).toBeNull();
  });
});

describe('addToInventory / takeFromInventory', () => {
  it('merges like dyes into one cell and counts them', () => {
    const inv = [];
    addToInventory(inv, crimson());
    addToInventory(inv, crimson());
    const host = addToInventory(inv, crimson());
    expect(inv).toHaveLength(1);
    expect(host).toBe(inv[0]);
    expect(qtyOf(inv[0])).toBe(3);
  });
  it('keeps two swords as two cells', () => {
    const inv = [];
    addToInventory(inv, rollItem(3, () => 0.3, 'weapon'));
    addToInventory(inv, rollItem(3, () => 0.3, 'weapon'));
    expect(inv).toHaveLength(2);
  });
  it('taking one unit splits off a copy and leaves the rest', () => {
    const inv = [];
    for (let i = 0; i < 3; i++) addToInventory(inv, crimson());
    const stack = inv[0];
    const one = takeFromInventory(inv, stack, 1);
    expect(one).not.toBe(stack);
    expect(one.qty).toBe(1);
    expect(one.dyeColor).toBe(stack.dyeColor);
    expect(one.id).not.toBe(stack.id);
    expect(qtyOf(stack)).toBe(2);
    expect(inv).toEqual([stack]);
  });
  it('taking the last unit removes the cell and returns the record itself', () => {
    const inv = [];
    const d = addToInventory(inv, crimson());
    expect(takeFromInventory(inv, d, 1)).toBe(d);
    expect(inv).toHaveLength(0);
    expect(takeFromInventory(inv, d, 1)).toBeNull();
  });
  it('coalesces a pre-stacking save without reordering', () => {
    const sword = rollItem(3, () => 0.3, 'weapon');
    const inv = coalesceInventory([crimson(), sword, crimson(), scroll(), crimson(), scroll()]);
    expect(inv.map(it => it.slot)).toEqual(['dye', 'weapon', 'trinket']);
    expect(qtyOf(inv[0])).toBe(3);
    expect(qtyOf(inv[2])).toBe(2);
  });
});

describe('inventory methods on stacks', () => {
  const game = () => {
    const g = Object.assign({ inventory: [], gold: 0, heroes: [], saveGame() {}, afterGearChange() {} }, inventoryMethods);
    g.afterGearChange = () => {};
    return g;
  };
  const wizard = () => makeHero('Sariel', 'human', 'wizard', { str: 8, dex: 15, con: 12, int: 15, wis: 13, cha: 10 });

  it('equipping from a stack of scrolls takes one and leaves the stack', () => {
    const g = game();
    const d = wizard();
    for (let i = 0; i < 3; i++) addToInventory(g.inventory, scroll());
    const stack = g.inventory[0];
    const r = g.equipItem(d, stack);
    expect(r.ok).toBe(true);
    expect(d.equipment.trinket).not.toBe(stack);
    expect(qtyOf(d.equipment.trinket)).toBe(1);
    expect(qtyOf(stack)).toBe(2);
    expect(g.inventory).toEqual([stack]);
  });
  it('an unequipped scroll rejoins the fresh stack, a used one does not', () => {
    const g = game();
    const d = wizard();
    for (let i = 0; i < 2; i++) addToInventory(g.inventory, scroll());
    g.equipItem(d, g.inventory[0]);
    g.unequipItem(d, 'trinket');
    expect(g.inventory).toHaveLength(1);
    expect(qtyOf(g.inventory[0])).toBe(2);
    g.equipItem(d, g.inventory[0]);
    d.equipment.trinket.charges -= 1;
    g.unequipItem(d, 'trinket');
    expect(g.inventory).toHaveLength(2);
  });
  it('applying a dye spends one from the stack', () => {
    const g = game();
    const d = wizard();
    d.equipment.armor = { name: 'Robe', slot: 'armor', visualColor: null };
    for (let i = 0; i < 2; i++) addToInventory(g.inventory, crimson());
    const r = g.applyDye(d, 'armor', g.inventory[0]);
    expect(r.ok).toBe(true);
    expect(d.equipment.armor.visualColor).toBe('#a32020');
    expect(g.inventory).toHaveLength(1);
    expect(qtyOf(g.inventory[0])).toBe(1);
  });
  it('sells one unit by default and the whole stack on request', () => {
    const g = game();
    for (let i = 0; i < 4; i++) addToInventory(g.inventory, crimson());
    const stack = g.inventory[0];
    g.sellItem(stack);
    expect(g.gold).toBe(40);
    expect(qtyOf(stack)).toBe(3);
    g.sellItem(stack, Infinity);
    expect(g.gold).toBe(160);
    expect(g.inventory).toHaveLength(0);
  });
  it('bulk sale pays for every unit in the stack', () => {
    const g = game();
    for (let i = 0; i < 5; i++) addToInventory(g.inventory, crimson());
    expect(g.sellByRarity('common')).toBe(1);
    expect(g.gold).toBe(200);
  });
});
