import { describe, it, expect, beforeEach } from 'vitest';
import { GuildManager, FACILITY_DEFINITIONS, getApothecaryBrewOutput } from '../src/game/guild.js';

describe('GuildManager', () => {
  let fakeGame;
  let guild;

  beforeEach(() => {
    fakeGame = {
      gold: 10000,
      potions: { heal: 0, greater: 0, superior: 0 },
      storedHeroes: [
        { name: 'Arthur', id: 'Arthur', level: 1, xp: 0, stats: { int: 10 } },
        { name: 'Gwen', id: 'Gwen', level: 1, xp: 0, stats: { int: 20 } }
      ],
      saveGame: () => {}
    };
    guild = new GuildManager(fakeGame);
    fakeGame.guild = guild;
  });

  it('initializes default facility levels at 0 (locked) except living_quarters at 1', () => {
    expect(guild.getFacilityLevel('living_quarters')).toBe(1);
    expect(guild.getFacilityLevel('training_grounds')).toBe(0);
    expect(guild.isUnlocked('training_grounds')).toBe(false);
    expect(guild.getFacilityLevel('blacksmith')).toBe(0);
    expect(guild.isUnlocked('blacksmith')).toBe(false);
  });

  it('calculates exponential upgrade costs correctly', () => {
    const baseCost = FACILITY_DEFINITIONS.blacksmith.baseCost; // 500
    const mult = FACILITY_DEFINITIONS.blacksmith.costMultiplier; // 2.2

    // Level 0 -> Level 1 (Unlock)
    expect(guild.getUpgradeCost('blacksmith')).toBe(baseCost);
    
    guild.upgradeFacility('blacksmith');
    expect(guild.getFacilityLevel('blacksmith')).toBe(1);
    expect(guild.isUnlocked('blacksmith')).toBe(true);

    // Level 1 -> Level 2
    const level2Cost = Math.floor(baseCost * mult);
    expect(guild.getUpgradeCost('blacksmith')).toBe(level2Cost);
  });

  it('calculates Apothecary potion brewing formula gradient correctly', () => {
    // Level 1 Apothecary + 10 INT Hero after 10 floors = 2 Base Health Potions
    const minYield = getApothecaryBrewOutput(1, 10, 10);
    expect(minYield.quantity).toBe(2);
    expect(minYield.potionTier).toBe('heal');

    // Level 10 Apothecary + 20 INT Hero after 10 floors = 5 Superior Potions
    const maxYield = getApothecaryBrewOutput(10, 20, 10);
    expect(maxYield.quantity).toBe(5);
    expect(maxYield.potionTier).toBe('superior');
  });

  it('brews potions automatically after 10 dungeon floors cleared based on level and hero INT', () => {
    guild.upgradeFacility('apothecary'); // Level 1
    guild.assignHero('Arthur', 'apothecary'); // 10 INT

    // Clear 9 floors
    for (let i = 0; i < 9; i++) {
      guild.onFloorCleared();
    }
    expect(fakeGame.potions.heal).toBe(0);

    // 10th floor cleared -> triggers brew batch of 2 Health Potions
    guild.onFloorCleared();
    expect(fakeGame.potions.heal).toBe(2);
  });

  it('serializes and deserializes guild state correctly', () => {
    guild.upgradeFacility('blacksmith');
    guild.upgradeFacility('apothecary');
    guild.assignHero('Gwen', 'apothecary');

    const data = guild.serialize();

    const newGuild = new GuildManager(fakeGame);
    newGuild.deserialize(data);

    expect(newGuild.getFacilityLevel('blacksmith')).toBe(1);
    expect(newGuild.getAssignedHeroes('apothecary')).toContain('Gwen');
  });
});

/* ── Armory: gear storage between delves ──────────────────────────────── */
describe('GuildManager — Armory', () => {
  let fakeGame, guild;
  const gear = (name, over = {}) => ({ name, slot: 'weapon', kind: 'weapon', ...over });

  beforeEach(() => {
    fakeGame = { gold: 10000, inventory: [], storedHeroes: [], saveGame: () => {} };
    guild = new GuildManager(fakeGame);
    fakeGame.guild = guild;
  });

  it('is locked with zero capacity until built', () => {
    expect(guild.isUnlocked('armory')).toBe(false);
    expect(guild.getArmoryCapacity()).toBe(0);
    const sword = gear('Sword');
    fakeGame.inventory.push(sword);
    const res = guild.depositItem(sword);
    expect(res.ok).toBe(false);
    expect(fakeGame.inventory).toContain(sword);   // nothing lost
  });

  it('capacity scales with facility level', () => {
    guild.facilityLevels.armory = 1;
    const perLevel = guild.getArmoryCapacity();
    expect(perLevel).toBeGreaterThan(0);
    guild.facilityLevels.armory = 3;
    expect(guild.getArmoryCapacity()).toBe(perLevel * 3);
  });

  it('deposit moves the item out of inventory and into storage', () => {
    guild.facilityLevels.armory = 1;
    const sword = gear('Sword');
    fakeGame.inventory.push(sword);
    expect(guild.depositItem(sword).ok).toBe(true);
    expect(fakeGame.inventory).not.toContain(sword);
    expect(guild.storedItems).toContain(sword);
    expect(guild.getArmoryFreeSlots()).toBe(guild.getArmoryCapacity() - 1);
  });

  it('withdraw moves it back, and the round trip preserves the same object', () => {
    guild.facilityLevels.armory = 1;
    const sword = gear('Sword', { enhanceLevel: 2 });
    fakeGame.inventory.push(sword);
    guild.depositItem(sword);
    expect(guild.withdrawItem(sword).ok).toBe(true);
    expect(guild.storedItems).toHaveLength(0);
    expect(fakeGame.inventory).toContain(sword);
    expect(fakeGame.inventory[0].enhanceLevel).toBe(2);
  });

  it('refuses a deposit that would exceed capacity, losing nothing', () => {
    guild.facilityLevels.armory = 1;
    const cap = guild.getArmoryCapacity();
    for (let i = 0; i < cap; i++) {
      const it = gear(`Filler ${i}`);
      fakeGame.inventory.push(it);
      expect(guild.depositItem(it).ok).toBe(true);
    }
    const overflow = gear('Overflow');
    fakeGame.inventory.push(overflow);
    const res = guild.depositItem(overflow);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/full/i);
    expect(guild.storedItems).toHaveLength(cap);
    expect(fakeGame.inventory).toContain(overflow);
  });

  it('rejects stale clicks: an item not actually in inventory / storage', () => {
    guild.facilityLevels.armory = 1;
    const ghost = gear('Ghost');           // never added to inventory
    expect(guild.depositItem(ghost).ok).toBe(false);
    expect(guild.withdrawItem(ghost).ok).toBe(false);
    expect(guild.depositItem(null).ok).toBe(false);
    expect(guild.storedItems).toHaveLength(0);
  });

  it('deposit-all takes gear but leaves potions and dyes behind', () => {
    guild.facilityLevels.armory = 1;
    const potion = { name: 'Potion', kind: 'potion', slot: 'potion' };
    const dye = { name: 'Dye', kind: 'dye', slot: 'dye' };
    fakeGame.inventory.push(gear('Axe'), potion, dye, gear('Helm', { slot: 'head' }));
    expect(guild.depositAllGear()).toBe(2);
    expect(fakeGame.inventory).toEqual([potion, dye]);
  });

  it('deposit-all stops at capacity instead of dropping the remainder', () => {
    guild.facilityLevels.armory = 1;
    const cap = guild.getArmoryCapacity();
    for (let i = 0; i < cap + 5; i++) fakeGame.inventory.push(gear(`Blade ${i}`));
    expect(guild.depositAllGear()).toBe(cap);
    expect(guild.storedItems).toHaveLength(cap);
    expect(fakeGame.inventory).toHaveLength(5);      // leftovers stay carried
  });

  it('survives a serialize / deserialize round trip', () => {
    guild.facilityLevels.armory = 2;
    const sword = gear('Heirloom');
    fakeGame.inventory.push(sword);
    guild.depositItem(sword);

    const blob = JSON.parse(JSON.stringify(guild.serialize()));
    const fresh = new GuildManager({ gold: 0, inventory: [], storedHeroes: [], saveGame: () => {} });
    fresh.deserialize(blob);

    expect(fresh.getArmoryCapacity()).toBe(guild.getArmoryCapacity());
    expect(fresh.storedItems).toHaveLength(1);
    expect(fresh.storedItems[0].name).toBe('Heirloom');
  });

  it('is exposed as a real facility so it shows up in the guild UI', () => {
    expect(FACILITY_DEFINITIONS.armory).toBeDefined();
    expect(FACILITY_DEFINITIONS.armory.getEffectText(3)).toMatch(/\d+/);
  });
});
