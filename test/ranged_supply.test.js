import { describe, it, expect } from 'vitest';
import { rollItem, weaponKindOf, BASES } from '../src/game/items.js';
import { GuildManager } from '../src/game/guild.js';

/* A ranger who sells their only bow must be able to buy or forge another:
   the weapon roll can be narrowed to a kind, and both the shop shelf and the
   blacksmith lean on that. */

describe('weaponKindOf', () => {
  it('sorts every weapon base into melee, ranged or focus', () => {
    const kinds = new Set(BASES.weapon.map(weaponKindOf));
    expect([...kinds].sort()).toEqual(['focus', 'melee', 'ranged']);
    expect(weaponKindOf(BASES.weapon.find(b => b.name === 'Longbow'))).toBe('ranged');
    expect(weaponKindOf(BASES.weapon.find(b => b.name === 'Wand'))).toBe('focus');
  });
});

describe('rollItem weaponKind', () => {
  it('every ranged roll is a bow, crossbow or sling at any tier', () => {
    for (const tier of [1, 5, 12]) {
      for (let i = 0; i < 40; i++) {
        const it = rollItem(tier, Math.random, 'weapon', { weaponKind: 'ranged' });
        expect(it.slot).toBe('weapon');
        expect(it.melee).toBe(false);
        expect(it.focus).toBeFalsy();
      }
    }
  });
  it('a focus roll is always a wand', () => {
    for (let i = 0; i < 30; i++) expect(rollItem(3, Math.random, 'weapon', { weaponKind: 'focus' }).focus).toBe(true);
  });
});

describe('blacksmith ranged / wand categories', () => {
  const guild = () => {
    const game = { gold: 100000, inventory: [], heroes: [], storedHeroes: [] };
    const g = new GuildManager(game);
    g.isUnlocked = () => true;
    g.getMaxCraftablePS = () => 999;
    g.materials = { iron: 999, leather: 999 };
    return { g, game };
  };
  it('forges a ranged weapon on request', () => {
    const { g, game } = guild();
    const r = g.craftEquipment('ranged', 30);
    expect(r.ok).toBe(true);
    expect(r.item.slot).toBe('weapon');
    expect(weaponKindOf(r.item)).toBe('ranged');
    expect(game.inventory).toContain(r.item);
  });
  it('forges a wand on request and prices it as leather-work', () => {
    const { g } = guild();
    const r = g.craftEquipment('focus', 30);
    expect(r.ok).toBe(true);
    expect(weaponKindOf(r.item)).toBe('focus');
    expect(g.getCraftingCosts('ranged', 30).isMetal).toBe(false);
  });
});
