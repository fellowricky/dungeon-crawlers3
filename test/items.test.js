import { describe, it, expect } from 'vitest';
import { rollItem, recomputeItemBonuses, attuneHeroGear, rollLegendary } from '../src/game/items.js';

describe('Items & Loot System', () => {
  it('should roll a random item within expected parameters', () => {
    const item = rollItem(5);
    expect(item).toBeDefined();
    expect(item.slot).toBeDefined();
    expect(item.rarity).toBeDefined();
    expect(item.ilvl).toBe(5);
    expect(item.bonuses).toBeDefined();
  });

  it('should recompute item bonuses correctly', () => {
    const item = {
      slot: 'weapon',
      baseKey: 'Longsword',
      rarity: 'rare',
      ilvl: 10,
      affixKeys: ['ofStr'] // assumes ofStr is a valid affix key
    };

    recomputeItemBonuses(item);
    
    expect(item.name).toBeDefined();
    expect(item.value).toBeGreaterThan(0);
    expect(item.color).toBeDefined();
  });

  it('should attune equipment correctly based on hero level', () => {
    // Legacy/starter gear (starter: true) should not attune
    const starterWeapon = {
      slot: 'weapon',
      baseKey: 'Longsword',
      rarity: 'common',
      ilvl: 1,
      starter: true
    };

    const rareWeapon = {
      slot: 'weapon',
      baseKey: 'Longsword',
      rarity: 'rare',
      ilvl: 1,
      starter: false
    };

    const legendaryArmor = {
      slot: 'armor',
      baseKey: 'Chain mail',
      rarity: 'legendary',
      ilvl: 1,
      starter: false
    };

    const hero = {
      level: 5,
      equipment: {
        weapon: rareWeapon,
        armor: legendaryArmor,
        ring: starterWeapon
      }
    };

    const logs = [];
    const logFn = (msg) => logs.push(msg);

    const changed = attuneHeroGear(hero, logFn);

    expect(changed).toBe(true);

    // Starter weapon stays at 1
    expect(starterWeapon.ilvl).toBe(1);

    // Rare weapon attunes by +1 -> becomes 2
    expect(rareWeapon.ilvl).toBe(2);

    // Legendary armor bonds directly to hero level -> becomes 5
    expect(legendaryArmor.ilvl).toBe(5);

    expect(logs.length).toBe(2);
  });
});
