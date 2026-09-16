/* ─────────────── Bag sorting and filtering by power score ───────────────
 * Rarity only says how many affix rolls an item got, so a well-rolled rare
 * routinely beats a badly-rolled epic. PS (itemPoints) is the honest measure,
 * so it is the axis the bag sorts and filters on.
 */
import { describe, it, expect } from 'vitest';
import { inventoryMethods } from '../src/game/inventory.js';
import { itemPoints, itemCategory, isConsumable } from '../src/game/items.js';
import { readFileSync } from 'node:fs';

/** Item stub whose PS comes from real bonuses, via the real itemPoints. */
function item(name, rarity, bonusAtk) {
  return { name, rarity, slot: 'weapon', baseKey: 'dagger',
           bonuses: { atk: bonusAtk }, value: 10 };
}

function bagOf(...items) {
  const g = Object.assign({}, inventoryMethods, {
    inventory: items, saveGame() { this.saved = (this.saved || 0) + 1; }
  });
  return g;
}

const names = g => g.inventory.map(i => i.name);

describe('sortInventory by power score', () => {
  /* A weak legendary and a strong common: rarity and PS disagree, which is the
     whole reason PS sorting exists. */
  const weakLegendary = () => item('Weak Legendary', 'legendary', 1);
  const strongCommon = () => item('Strong Common', 'common', 40);

  it('puts the highest power score first, regardless of rarity', () => {
    const g = bagOf(weakLegendary(), strongCommon());
    expect(itemPoints(g.inventory[1])).toBeGreaterThan(itemPoints(g.inventory[0]));
    g.sortInventory('ps-desc');
    expect(names(g)[0]).toBe('Strong Common');
  });

  it('reverses for ps-asc', () => {
    const g = bagOf(strongCommon(), weakLegendary());
    g.sortInventory('ps-asc');
    expect(names(g)[0]).toBe('Weak Legendary');
  });

  it('breaks rarity ties by power score rather than by name', () => {
    const g = bagOf(item('Alpha', 'rare', 2), item('Zulu', 'rare', 30));
    g.sortInventory('rarity-desc');
    // Alphabetically Alpha wins; by power Zulu does, and power is what matters.
    expect(names(g)[0]).toBe('Zulu');
  });

  it('still supports rarity and name sorts', () => {
    const g = bagOf(strongCommon(), weakLegendary());
    g.sortInventory('rarity-desc');
    expect(names(g)[0]).toBe('Weak Legendary');
    g.sortInventory('name');
    expect(names(g)).toEqual(['Strong Common', 'Weak Legendary']);
  });

  it('persists the new order', () => {
    const g = bagOf(weakLegendary(), strongCommon());
    g.sortInventory('ps-desc');
    expect(g.saved).toBeGreaterThan(0);
  });

  it('leaves the bag untouched for an unknown order', () => {
    const g = bagOf(weakLegendary(), strongCommon());
    g.sortInventory('nonsense');
    expect(names(g)).toEqual(['Weak Legendary', 'Strong Common']);
  });
});

describe('Bag power-score filter', () => {
  const menus = readFileSync(new URL('../src/game/menus.js', import.meta.url), 'utf8');

  it('offers power-score sort buttons in the bag header', () => {
    expect(menus).toContain('data-sort="ps-desc"');
    expect(menus).toContain('data-sort="ps-asc"');
  });

  /* The filter was simplified from a min/max slider pair to a row of
     "junk floor" chips: a floor is the only cap a player ever used, and a
     max that silently hid a fresh legendary was a trap. These pin the
     current design. */
  it('renders the junk floor as PS chips, with "All" clearing it', () => {
    expect(menus).toContain('class="ps-filter"');
    expect(menus).toContain('data-psfloor="${val}"');
    expect(menus).toMatch(/chip\(0, 'All'/);
    expect(menus).toMatch(/bagMinPS === val \? ' on' : ''/);
  });

  it('offers to sell exactly the items the floor hides, and says how many', () => {
    expect(menus).toContain('data-pssell="${bagMinPS}"');
    expect(menus).toMatch(/Sell \$\{hiddenByPS\} junk/);
    expect(menus).toMatch(/hidden item\(s\) under PS \$\{bagMinPS\}/);
  });

  it('re-renders on change, not on input, so the drag is not interrupted', () => {
    // Re-rendering per input event destroys the slider mid-drag and the handle
    // stops following the pointer.
    expect(menus).toMatch(/addEventListener\('change',[\s\S]{0,200}?render\(\)/);
  });

  it('bulk-sell honours the same floor the grid shows', () => {
    // "Hide the best gear, then sell everything else" only works if bulk-sell
    // honours the same window the grid does — or it quietly destroys gear the
    // player filtered out of view.
    expect(menus).toContain('bulkSellHTML(visible)');
    expect(menus).toMatch(/sellByRarity\([\s\S]{0,160}?min: bagMinPS/);
    expect(menus).toMatch(/PS \$\{bagMinPS\}/);
  });
});

describe('Consumables are their own category', () => {
  const scroll = { name: 'Scroll of Fire', slot: 'trinket', rarity: 'rare', scroll: true, spellKey: 'fireball', value: 30 };
  const potionItem = { name: 'Potion of Might', slot: 'trinket', rarity: 'common', potion: true, buffKey: 'might', value: 10 };
  const amulet = { name: 'Amulet', slot: 'amulet', rarity: 'rare', bonuses: { atk: 3 }, value: 20 };
  const realTrinket = { name: 'Lucky Charm', slot: 'trinket', rarity: 'epic', bonuses: { atk: 2 }, value: 40 };

  it('files scrolls and potions under consumable, not accessory', () => {
    expect(itemCategory(scroll)).toBe('consumable');
    expect(itemCategory(potionItem)).toBe('consumable');
  });

  it('leaves worn accessories where they were', () => {
    expect(itemCategory(amulet)).toBe('accessory');
    // A trinket with real stats is gear, not stock, and stays an accessory.
    expect(itemCategory(realTrinket)).toBe('accessory');
  });

  it('recognises a consumable by any of its markers', () => {
    expect(isConsumable({ spellKey: 'fireball' })).toBe(true);
    expect(isConsumable({ buffKey: 'might' })).toBe(true);
    expect(isConsumable(amulet)).toBe(false);
    expect(isConsumable(null)).toBe(false);
  });

  it('gives consumables a bag tab of their own', () => {
    const menus = readFileSync(new URL('../src/game/menus.js', import.meta.url), 'utf8');
    expect(menus).toMatch(/key:'consumable'/);
    expect(menus).toMatch(/consumable:'scrolls or potions'/);
  });
});

describe('Bulk sell honours the power-score window', () => {
  const gear = (name, rarity, atk) => ({ name, rarity, slot: 'weapon', baseKey: 'dagger',
                                         bonuses: { atk }, value: 10 });
  const bag = (...items) => Object.assign({}, inventoryMethods, {
    inventory: items, gold: 0, saveGame() {}, heroes: []
  });

  it('spares items above the max, so the keepers survive a sell-all', () => {
    const keep = gear('Keeper', 'rare', 40);
    const junk = gear('Junk', 'rare', 2);
    const g = bag(keep, junk);
    const cap = Math.floor((itemPoints(keep) + itemPoints(junk)) / 2);

    const sold = g.sellByRarity('rare', null, { min: 0, max: cap });

    expect(sold).toBe(1);
    expect(g.inventory).toContain(keep);
    expect(g.inventory).not.toContain(junk);
  });

  it('sells everything of that rarity when no window is given', () => {
    const g = bag(gear('A', 'rare', 40), gear('B', 'rare', 2));
    expect(g.sellByRarity('rare')).toBe(2);
    expect(g.inventory.length).toBe(0);
  });

  it('still protects locked items inside the window', () => {
    const locked = gear('Locked', 'rare', 2);
    locked.locked = true;
    const g = bag(locked, gear('Loose', 'rare', 2));
    expect(g.sellByRarity('rare', null, { min: 0, max: 9999 })).toBe(1);
    expect(g.inventory).toContain(locked);
  });
});
