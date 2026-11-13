import { describe, it, expect, beforeEach } from 'vitest';
import { GuildManager, FACILITY_DEFINITIONS, getApothecaryBrewOutput, storedHeroCap, trainingFloorsForGain, RUNE_RECIPES } from '../src/game/guild.js';
import { makeRuneItem, runeSlotsFor, runeBaseRarity, canInscribeRune } from '../src/game/items.js';
import { itemTipBlock } from '../src/game/menus.js';

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

  it('unlocks drinkable potion recipes as the Apothecary levels', () => {
    guild.upgradeFacility('apothecary');
    const lvl1 = guild.listBrewRecipes();
    expect(lvl1.some(r => r.baseKey === 'Potion of Healing' && r.unlocked)).toBe(true);
    expect(lvl1.some(r => r.baseKey === 'Potion of Inspiration' && r.unlocked)).toBe(true);
    expect(lvl1.some(r => r.baseKey === 'Potion of Foresight' && !r.unlocked)).toBe(true);
    expect(lvl1.some(r => r.baseKey === 'Potion of Greater Healing' && !r.unlocked)).toBe(true);
    expect(lvl1.every(r => r.thrown !== true)).toBe(true);

    guild.facilityLevels.apothecary = 4;
    const lvl4 = guild.listBrewRecipes();
    expect(lvl4.some(r => r.baseKey === 'Potion of Greater Healing' && r.unlocked)).toBe(true);
  });

  it('brews the selected still recipe over floors, scaled by still level and alchemist INT', () => {
    guild.upgradeFacility('apothecary');
    guild.assignHero('Arthur', 'apothecary');
    fakeGame.inventory = [];

    expect(guild.setBrewRecipe('Potion of Foresight').ok).toBe(false);
    expect(guild.setBrewRecipe('Potion of Inspiration').ok).toBe(true);
    expect(guild.apothecaryRecipe).toBe('Potion of Inspiration');
    expect(guild.apothecaryFloors).toBe(0);

    const preview = guild.getStillPreview();
    expect(preview.duration).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < preview.duration - 1; i++) guild.onFloorCleared();
    expect(fakeGame.inventory).toHaveLength(0);

    guild.onFloorCleared();
    expect(fakeGame.inventory.length).toBeGreaterThanOrEqual(1);
    expect(fakeGame.inventory[0].buffKey).toBe('inspired');
  });

  it('buys yard gear, assigns a hero, and raises that ability over floors', () => {
    guild.upgradeFacility('training_grounds');
    fakeGame.storedHeroes[0].stats = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };

    const buy = guild.buyTrainingGear('pell');
    expect(buy.ok).toBe(true);
    expect(guild.trainingStations).toHaveLength(1);
    expect(guild.assignToStation(buy.id, 'Arthur').ok).toBe(true);

    const needed = trainingFloorsForGain(10, 1);
    for (let i = 0; i < needed - 1; i++) guild.onFloorCleared();
    expect(fakeGame.storedHeroes[0].stats.str).toBe(10);
    guild.onFloorCleared();
    expect(fakeGame.storedHeroes[0].stats.str).toBe(11);

    const up = guild.upgradeTrainingGear(buy.id);
    expect(up.ok).toBe(true);
    expect(guild.trainingStations[0].level).toBe(2);
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

  it('does not take a worker assignment', () => {
    expect(FACILITY_DEFINITIONS.armory.assignable).toBe(false);
    guild.facilityLevels.armory = 1;
    fakeGame.storedHeroes = [{ name: 'Quartermaster' }];
    expect(guild.assignHero('Quartermaster', 'armory')).toBe(false);
    expect(guild.getAssignedHeroes('armory')).toEqual([]);
  });

  it('clears a leftover Armory job on load', () => {
    guild.deserialize({ heroAssignments: { Nyx: 'armory', Arthur: 'blacksmith' } });
    expect(guild.heroAssignments.Nyx).toBeUndefined();
    expect(guild.heroAssignments.Arthur).toBe('blacksmith');
  });
});

/* ── Cartographer: Pre-Scouting & Expeditions ───────────────────────── */
describe('GuildManager — Cartographer & Expeditions', () => {
  let fakeGame, guild;

  beforeEach(() => {
    fakeGame = {
      gold: 5000,
      inventory: [],
      storedHeroes: [
        { name: 'Robin', id: 'Robin', classKey: 'ranger', level: 3, xp: 0, stats: { int: 12, wis: 14 } },
        { name: 'Shadow', id: 'Shadow', classKey: 'rogue', level: 2, xp: 0, stats: { int: 14, dex: 16 } },
        { name: 'Boran', id: 'Boran', classKey: 'fighter', level: 3, xp: 0, stats: { str: 16, con: 14 } }
      ],
      saveGame: () => {}
    };
    guild = new GuildManager(fakeGame);
    fakeGame.guild = guild;
  });

  it('pre-scouts dungeon rooms based on cartographer facility level', () => {
    const fakeDungeon = {
      rooms: [{ id: 0, type: 'entrance' }, { id: 1, type: 'combat' }, { id: 2, type: 'treasure' }, { id: 3, type: 'shrine' }, { id: 4, type: 'boss' }],
      boss: 4
    };

    // Level 0 (Locked) -> 0 scouted rooms
    expect(guild.getDungeonPreScoutedRooms(fakeDungeon)).toHaveLength(0);

    // Level 1 -> 1 room
    guild.facilityLevels.cartographer = 1;
    const scoutedLvl1 = guild.getDungeonPreScoutedRooms(fakeDungeon);
    expect(scoutedLvl1.length).toBeGreaterThanOrEqual(1);

    // Level 4 -> Pre-scouts treasure/shrine rooms first
    guild.facilityLevels.cartographer = 4;
    const scoutedLvl4 = guild.getDungeonPreScoutedRooms(fakeDungeon);
    expect(scoutedLvl4).toContain(2); // treasure room prioritized

    // Assigning a Ranger/Rogue scout increases scout count
    guild.assignHero('Robin', 'cartographer');
    const scoutedWithHero = guild.getDungeonPreScoutedRooms(fakeDungeon);
    expect(scoutedWithHero.length).toBe(scoutedLvl4.length + 1);
  });

  it('dispatches squads, ticks floor progress, and claims rewards', () => {
    guild.facilityLevels.cartographer = 1;
    const res = guild.dispatchExpedition('forage_forest', ['Robin', 'Shadow']);
    expect(res.ok).toBe(true);
    expect(guild.activeExpeditions).toHaveLength(1);

    const exp = guild.activeExpeditions[0];
    expect(exp.floorsRemaining).toBe(4);

    // Tick 4 floors
    for (let i = 0; i < 4; i++) {
      guild.onFloorCleared();
    }

    expect(exp.completed).toBe(true);
    expect(exp.floorsRemaining).toBe(0);

    const initialGold = fakeGame.gold;
    const claimRes = guild.claimExpedition(exp.id);
    expect(claimRes.ok).toBe(true);
    expect(fakeGame.gold).toBeGreaterThan(initialGold);
    expect(guild.materials.iron).toBeGreaterThan(0);
    expect(guild.activeExpeditions).toHaveLength(0);
  });
});

/* ── Academy: Research Tree ─────────────────────────────────────────── */
describe('GuildManager — Academy Tech Tree', () => {
  let fakeGame, guild;

  beforeEach(() => {
    fakeGame = {
      gold: 500000,
      inventory: [],
      storedHeroes: [],
      partyLevel: () => 16,
      saveGame: () => {}
    };
    guild = new GuildManager(fakeGame);
    fakeGame.guild = guild;
    guild.facilityLevels.academy = 1;
    guild.tomes = 100;
  });

  it('enforces tech tree prerequisites, party level gates, and deducts gold and tomes', () => {
    expect(guild.hasTech('m1_vitality')).toBe(true); // default unlocked

    // Cannot unlock Tier 3 before Tier 2
    expect(guild.canUnlockTech('m3_warlord')).toBe(false);

    // Unlock Tier 2 (Req Level 7)
    expect(guild.canUnlockTech('m2_striking')).toBe(true);
    guild.unlockTech('m2_striking');
    expect(guild.hasTech('m2_striking')).toBe(true);

    // Unlock Tier 3 (Req Level 12)
    expect(guild.canUnlockTech('m3_warlord')).toBe(true);
    guild.unlockTech('m3_warlord');
    expect(guild.hasTech('m3_warlord')).toBe(true);
    expect(guild.getTechBonus('physDmgBonus')).toBe(0.12);

    // Unlock Tier 4 (Req Level 16)
    expect(guild.canUnlockTech('m4_legend')).toBe(true);
    guild.unlockTech('m4_legend');
    expect(guild.hasTech('m4_legend')).toBe(true);
    expect(guild.getTechBonus('extraAttacks')).toBe(1);
  });

  it('blocks unlock when party level is below minimum requirement', () => {
    fakeGame.partyLevel = () => 5; // Level 5 party
    expect(guild.canUnlockTech('m2_striking')).toBe(false); // requires level 7
  });
});

/* ── Enchanter: Disenchanting & Runecrafting ─────────────────────────── */
describe('GuildManager — Enchanter Spire', () => {
  let fakeGame, guild;

  beforeEach(() => {
    fakeGame = { gold: 10000, inventory: [], storedHeroes: [], saveGame: () => {} };
    guild = new GuildManager(fakeGame);
    fakeGame.guild = guild;
    guild.facilityLevels.enchanter = 1;
  });

  it('previews dust yield from rarity before destroying the item', () => {
    const preview = guild.getDisenchantPreview({ rarity: 'rare' });
    expect(preview.dust).toBe(13); // 12 × 1.10 at Enchanter 1
    expect(preview.essencePool).toEqual(['fire', 'frost', 'lightning']);
    guild.facilityLevels.enchanter = 5;
    expect(guild.getDisenchantPreview({ rarity: 'common' }).dust).toBe(5);
  });

  it('disenchants gear into Arcane Dust and Essences', () => {
    const rareSword = { name: 'Rare Blade', slot: 'weapon', rarity: 'rare' };
    fakeGame.inventory.push(rareSword);

    const initialDust = guild.essences.dust;
    const res = guild.disenchantItem(rareSword);

    expect(res.ok).toBe(true);
    expect(guild.essences.dust).toBeGreaterThan(initialDust);
    expect(fakeGame.inventory).not.toContain(rareSword);
  });

  it('crafts and applies runes to equipment', () => {
    guild.essences.dust = 50;
    guild.essences.fire = 10;

    const craftRes = guild.craftRune('flame_1');
    expect(craftRes.ok).toBe(true);
    const rune = fakeGame.inventory.find(i => i && i.slot === 'rune');
    expect(rune).toBeDefined();
    expect(rune.runeKey).toBe('flame_1');

    const sword = { name: 'Broadsword', slot: 'weapon', kind: 'weapon', rarity: 'common', color: '#b4b0a4' };
    fakeGame.inventory.push(sword);

    const applyRes = guild.applyRuneToItem(sword, rune);
    expect(applyRes.ok).toBe(true);
    expect(sword.inscribedRunes).toHaveLength(1);
    expect(sword.inscribedRunes[0].runeKey).toBe('flame_1');
    expect(sword.rarity).toBe('uncommon');
    expect(fakeGame.inventory.find(i => i && i.slot === 'rune')).toBeUndefined();

    expect(guild.craftRune('flame_3').ok).toBe(false);
  });

  /* Rune slots follow the rarity the piece had before its first rune. */
  const freshRune = (key = 'flame_1') => {
    const r = makeRuneItem(RUNE_RECIPES[key]);
    fakeGame.inventory.push(r);
    return r;
  };

  it('grey and green gear take one rune; blue and purple take two', () => {
    const grey = { name: 'Club', slot: 'weapon', rarity: 'common' };
    const green = { name: 'Fine Club', slot: 'weapon', rarity: 'uncommon' };
    const blue = { name: 'Enchanted Club', slot: 'weapon', rarity: 'rare' };
    const purple = { name: 'Ancient Club', slot: 'weapon', rarity: 'epic' };
    expect(runeSlotsFor(grey)).toBe(1);
    expect(runeSlotsFor(green)).toBe(1);
    expect(runeSlotsFor(blue)).toBe(2);
    expect(runeSlotsFor(purple)).toBe(2);

    expect(guild.applyRuneToItem(grey, freshRune()).ok).toBe(true);
    expect(grey.rarity).toBe('uncommon');                  // promoted, but slots stay at one
    expect(guild.applyRuneToItem(grey, freshRune()).ok).toBe(false);

    expect(guild.applyRuneToItem(blue, freshRune()).ok).toBe(true);
    expect(blue.rarity).toBe('epic');
    expect(guild.applyRuneToItem(blue, freshRune()).ok).toBe(true);
    const third = guild.applyRuneToItem(blue, freshRune());
    expect(third.ok).toBe(false);
    expect(third.reason).toMatch(/2 runes/);
    expect(blue.inscribedRunes).toHaveLength(2);
  });

  it('Fabled (legendary) gear cannot be enchanted', () => {
    const fabled = { name: 'Fabled Blade', slot: 'weapon', rarity: 'legendary' };
    const r = guild.applyRuneToItem(fabled, freshRune());
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Fabled/);
    expect(canInscribeRune(fabled)).toBe(false);
  });

  it('old inscribed gear works out its slots from the promotions it already took', () => {
    /* An Enchanted (blue) piece that took one rune before slots existed is now
       purple with no stamp: it still has one slot left. */
    const old = { name: 'Old Blade', slot: 'weapon', rarity: 'epic',
      inscribedRunes: [{ runeKey: 'flame_1', name: 'Searing Flame I' }] };
    expect(runeBaseRarity(old)).toBe('rare');
    expect(canInscribeRune(old)).toBe(true);
  });

  it('the item tooltip lists inscribed runes and the slots left', () => {
    const blue = { name: 'Enchanted Club', slot: 'weapon', rarity: 'rare', bonuses: {} };
    guild.applyRuneToItem(blue, freshRune('frost_1'));
    const html = itemTipBlock(blue, '', '#fff');
    expect(html).toContain('Runes 1/2');
    expect(html).toContain('Bitter Frost I');
    expect(html).toContain('+1d4 cold on hit');
    expect(html).toContain('Empty rune slot');
  });
});

/* ── War Room & Blacksmith ──────────────────────────────────────────── */
describe('GuildManager — War Room & Blacksmith Salvage', () => {
  let fakeGame, guild;

  beforeEach(() => {
    fakeGame = { gold: 10000, inventory: [], storedHeroes: [], saveGame: () => {} };
    guild = new GuildManager(fakeGame);
    fakeGame.guild = guild;
    guild.facilityLevels.war_room = 1;
    guild.facilityLevels.blacksmith = 1;
  });

  it('sets slaying orders and battle doctrines', () => {
    expect(guild.setSlayingOrder('dragon_hunt')).toBe(true);
    expect(guild.activeSlayingOrder).toBe('dragon_hunt');

    expect(guild.setBattleDoctrine('ambush')).toBe(true);
    expect(guild.activeDoctrine).toBe('ambush');
  });

  it('salvages equipment into Iron and Leather materials', () => {
    const ironHelm = { name: 'Iron Helmet', slot: 'armor' };
    fakeGame.inventory.push(ironHelm);

    const initialIron = guild.materials.iron;
    const res = guild.salvageItem(ironHelm);

    expect(res.ok).toBe(true);
    expect(guild.materials.iron).toBeGreaterThan(initialIron);
    expect(fakeGame.inventory).not.toContain(ironHelm);
  });

  it('crafts targeted equipment based on PS score and applies hero artisan bonus', () => {
    // Level 1 Blacksmith Max PS is 35
    expect(guild.getMaxCraftablePS()).toBe(35);

    // Target PS 50 is blocked at Level 1
    const overLimit = guild.craftEquipment('weapon', 50);
    expect(overLimit.ok).toBe(false);

    // Assign hero to grant artisan bonus
    fakeGame.storedHeroes.push({ name: 'Thor', stats: { str: 18 }, level: 4 });
    guild.assignHero('Thor', 'blacksmith');
    const heroBonus = guild.getAssignedBlacksmithBonus();
    expect(heroBonus.bonusPS).toBeGreaterThan(0);

    // Craft within PS limit
    guild.materials.iron = 20;
    guild.materials.leather = 20;
    const craftRes = guild.craftEquipment('weapon', 30);

    expect(craftRes.ok).toBe(true);
    expect(craftRes.item).toBeDefined();
    expect(craftRes.item.slot).toBe('weapon');
    expect(fakeGame.inventory).toContain(craftRes.item);
    expect(craftRes.finalPS).toBeGreaterThan(0);
  });

  it('lists melee bases under weapon and can pin one', () => {
    const melee = guild.listCraftBases('weapon');
    const ranged = guild.listCraftBases('ranged');
    expect(melee.some(b => b.name === 'Longsword')).toBe(true);
    expect(melee.some(b => b.name === 'Longbow')).toBe(false);
    expect(ranged.some(b => b.name === 'Longbow')).toBe(true);

    guild.materials.iron = 40;
    guild.materials.leather = 40;
    const res = guild.craftEquipment('weapon', 30, 'Longsword');
    expect(res.ok).toBe(true);
    expect(res.item.baseKey).toBe('Longsword');
    expect(res.item.slot).toBe('weapon');

    const bad = guild.craftEquipment('weapon', 30, 'Longbow');
    expect(bad.ok).toBe(false);
  });

  it('bulk salvages unlocked gear by PS score while protecting locked and higher PS gear', () => {
    const lowSword = { name: 'Rusty Dagger', slot: 'weapon', baseKey: 'Dagger', rarity: 'common' }; // low PS
    const lockedLowBoots = { name: 'Old Boots', slot: 'boots', baseKey: 'Boots', rarity: 'common', locked: true }; // locked
    const highPlate = { name: 'Radiant Plate', slot: 'armor', baseKey: 'Plate Armor', rarity: 'legendary', affixes: [{ key: 'ac_bonus', n: 5 }] }; // high PS
    const potion = { name: 'Health Potion', kind: 'potion' };

    fakeGame.inventory = [lowSword, lockedLowBoots, highPlate, potion];

    // Bulk salvage everything with PS <= 30
    const res = guild.salvageByPowerScore(30);

    expect(res.ok).toBe(true);
    expect(res.count).toBe(1); // Only lowSword salvaged
    expect(fakeGame.inventory).not.toContain(lowSword);
    expect(fakeGame.inventory).toContain(lockedLowBoots); // protected
    expect(fakeGame.inventory).toContain(highPlate); // higher PS kept
    expect(fakeGame.inventory).toContain(potion); // potions kept
    expect(guild.materials.iron).toBeGreaterThan(0);
  });

  it('never scraps dyes, consumables or kits — only weapons, armor and accessories', () => {
    const ring = { name: 'Copper Ring', slot: 'ring', rarity: 'common' };
    const dye = { name: 'Crimson Dye', slot: 'dye', dyeColor: '#c00', rarity: 'common', qty: 3 };
    const scroll = { name: 'Scroll of Fireball', slot: 'trinket', scroll: true, spellKey: 'fireball', qty: 2 };
    const brew = { name: 'Potion of Speed', slot: 'trinket', potion: true, buffKey: 'haste' };
    const kit = { name: "Healer's Kit", slot: 'kit', rarity: 'common' };

    fakeGame.inventory = [ring, dye, scroll, brew, kit];
    const res = guild.salvageByPowerScore(1000);

    expect(res.count).toBe(1);
    expect(fakeGame.inventory).toEqual([dye, scroll, brew, kit]);
    expect(guild.salvageItem(dye).ok).toBe(false);
    expect(guild.salvageItem(scroll).ok).toBe(false);
    expect(fakeGame.inventory).toContain(dye);
  });
});

/* ── Living Quarters: stored-hero bunks ──────────────────────────────── */
describe('GuildManager — Living Quarters bunks', () => {
  let fakeGame, guild;

  beforeEach(() => {
    fakeGame = { gold: 10000, storedHeroes: [], saveGame: () => {} };
    guild = new GuildManager(fakeGame);
    fakeGame.guild = guild;
  });

  it('default quarters (level 1) hold 8 stored heroes', () => {
    expect(guild.getFacilityLevel('living_quarters')).toBe(1);
    expect(storedHeroCap(1)).toBe(8);
    expect(guild.getStoredHeroCap()).toBe(8);
    expect(guild.canStoreHero()).toBe(true);
  });

  it('scales 6 + 2 per level', () => {
    expect(storedHeroCap(0)).toBe(6);
    expect(storedHeroCap(5)).toBe(16);
    expect(storedHeroCap(10)).toBe(26);
    guild.facilityLevels.living_quarters = 5;
    expect(guild.getStoredHeroCap()).toBe(16);
  });

  it('effect text uses the same cap formula', () => {
    expect(FACILITY_DEFINITIONS.living_quarters.getEffectText(1)).toMatch(/Max Stored Heroes: 8/);
    expect(FACILITY_DEFINITIONS.living_quarters.getEffectText(10)).toMatch(/Max Stored Heroes: 26/);
  });

  it('free slots count storedHeroes against the cap', () => {
    fakeGame.storedHeroes = Array.from({ length: 8 }, (_, i) => ({ name: `H${i}` }));
    expect(guild.getStoredHeroFreeSlots()).toBe(0);
    expect(guild.canStoreHero()).toBe(false);
  });

  it('over-cap reports zero free slots without trimming the bench', () => {
    fakeGame.storedHeroes = Array.from({ length: 12 }, (_, i) => ({ name: `H${i}` }));
    expect(guild.getStoredHeroCap()).toBe(8);
    expect(guild.getStoredHeroFreeSlots()).toBe(0);
    expect(guild.canStoreHero()).toBe(false);
    expect(fakeGame.storedHeroes).toHaveLength(12);
  });
});

