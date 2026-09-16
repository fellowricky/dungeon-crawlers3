import { describe, it, expect, beforeAll } from 'vitest';
import {
  rollItem, recomputeItemBonuses, rollLegendary,
  makeDye, DYE_COLORS, migrateItem, migrateInventory, itemCategory, rollChestLoot, RARITIES,
  itemPoints, itemSpend, itemBudget, getBase, baseCost, BASES, slotsFor, compareItemStats
} from '../src/game/items.js';
import { mulberry32 } from '../src/game/quests.js';

describe('Items & Loot System', () => {
  beforeAll(() => {
    // Stub document for headless compatibility (applyDye logs to the game log)
    globalThis.document = globalThis.document || {
      getElementById: () => ({ classList: { add() {}, remove() {}, contains() { return false; } }, innerHTML: '', appendChild() {}, children: [], removeChild() {}, firstChild: null, style: {} }),
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {} }),
      body: { appendChild() {} }, head: { appendChild() {} }
    };
  });

  it('should roll a random item within expected parameters', () => {
    const item = rollItem(5);
    expect(item).toBeDefined();
    expect(item.slot).toBeDefined();
    expect(item.rarity).toBeDefined();
    /* ilvl derives from the quest tier plus the source offset — a chest is
       tier +/- 1 — rather than echoing the tier verbatim. */
    expect(item.ilvl).toBeGreaterThanOrEqual(4);
    expect(item.ilvl).toBeLessThanOrEqual(6);
    expect(item.bonuses).toBeDefined();
    /* explicit ilvl still wins outright */
    expect(rollItem(5, Math.random, null, { ilvl: 9 }).ilvl).toBe(9);
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

  it('never attunes gear — item stats are frozen at the ilvl they were found at', () => {
    /* Attunement was removed with the budget rework: equipment used to walk its
       ilvl up as the hero levelled, so gear kept pace whether or not you found
       anything and a drop could never feel like a find. */
    const rare = rollItem(3, Math.random, 'weapon', { ilvl: 3, forceRarity: 'rare' });
    const before = { ilvl: rare.ilvl, bonuses: JSON.stringify(rare.bonuses) };
    recomputeItemBonuses(rare);
    expect(rare.ilvl).toBe(before.ilvl);
    expect(JSON.stringify(rare.bonuses)).toBe(before.bonuses);
  });

  it('spends its budget without exceeding it', () => {
    for (const tier of [0, 1, 5, 12, 20]) {
      for (let i = 0; i < 200; i++) {
        const it = rollItem(tier, Math.random);
        if (!it || it.slot === 'kit') continue;
        const budget = itemBudget(it.slot, it.ilvl, it.rarity);
        /* Never overspend. The base is charged against the same budget, which
           is what replaced the old hand-maintained minimum-floor table.
           itemSpend (base + affixes) is the budgeted figure — itemPoints also
           counts perks, which are budget-exempt by design.
           The one documented exception is the "no base is affordable" fallback,
           which hands back the cheapest base so a slot is never empty — it can
           only happen when that base alone outprices the budget, and it always
           leaves zero room for affixes. */
        const fallback = (it.affixes || []).length === 0;
        if (!fallback) expect(itemSpend(it)).toBeLessThanOrEqual(budget);
      }
    }
  });

  describe('Dyes', () => {
    it('makeDye produces a well-formed dye record', () => {
      for (let i = 0; i < 50; i++) {
        const dye = makeDye();
        expect(dye.slot).toBe('dye');
        expect(['common', 'uncommon', 'rare']).toContain(dye.rarity);
        expect(DYE_COLORS[dye.rarity].some(c => c.hex === dye.dyeColor)).toBe(true);
        expect(dye.name.endsWith(' Dye')).toBe(true);
        expect(dye.value).toBeGreaterThan(0);
        expect(dye.color).toBe(RARITIES[dye.rarity].color);
        expect(dye.bonuses).toEqual({});
        expect(dye.affixes).toEqual([]);
        expect(itemCategory(dye)).toBe('other');
      }
    });

    it('migrateItem leaves dyes intact (no starter heuristic, no base recompute)', () => {
      const dye = makeDye();
      const before = JSON.stringify({ ...dye, _migrated: undefined });
      migrateItem(dye);
      expect(dye.starter).toBeUndefined();
      expect(dye.dyeColor).toBeDefined();
      expect(dye.value).toBeGreaterThan(0);
      const after = JSON.stringify({ ...dye, _migrated: undefined });
      expect(after).toBe(before);
      /* idempotent across a save round-trip */
      const revived = JSON.parse(JSON.stringify(dye));
      migrateInventory([revived]);
      expect(revived.dyeColor).toBe(dye.dyeColor);
      expect(revived.name).toBe(dye.name);
    });

    it('rollChestLoot sometimes adds a dye on top of the 1-3 gear items', () => {
      let sawDye = false;
      for (let seed = 1; seed <= 60; seed++) {
        const items = rollChestLoot(3, mulberry32(seed));
        const dyes = items.filter(it => it.slot === 'dye');
        const gear = items.filter(it => it.slot !== 'dye');
        expect(gear.length).toBeGreaterThanOrEqual(1);
        expect(gear.length).toBeLessThanOrEqual(3);
        expect(dyes.length).toBeLessThanOrEqual(1);
        if (dyes.length) sawDye = true;
      }
      expect(sawDye).toBe(true);
    });
  });

  describe('applyDye (inventory mixin)', () => {
    it('recolors an equipped item, banks originalColor, and consumes the dye', async () => {
      const { inventoryMethods } = await import('../src/game/inventory.js');
      const dye = makeDye(Math.random, { rarity: 'rare', color: { name: 'Gold', hex: '#e8c25a' } });
      const armor = { slot: 'armor', name: 'Chain Shirt', visualColor: '#52414a' };
      const weapon = { slot: 'weapon', name: 'Wand', visualColor: null, crystalColor: '#aa66ff' };
      const hero = { equipment: { armor, weapon } };
      const game = {
        inventory: [dye],
        heroes: [{ data: hero }],
        afterGearChange() { this._refreshed = true; },
        applyDye: inventoryMethods.applyDye
      };

      let r = game.applyDye(hero, 'armor', dye);
      expect(r.ok).toBe(true);
      expect(armor.visualColor).toBe('#e8c25a');
      expect(armor.originalColor).toBe('#52414a');
      expect(game.inventory).toEqual([]);
      expect(game._refreshed).toBe(true);

      /* magic weapon: crystal recolors too; originalColor banks the null */
      const dye2 = makeDye(Math.random, { rarity: 'common', color: { name: 'Crimson', hex: '#a32020' } });
      game.inventory.push(dye2);
      r = game.applyDye(hero, 'weapon', dye2);
      expect(r.ok).toBe(true);
      expect(weapon.visualColor).toBe('#a32020');
      expect(weapon.crystalColor).toBe('#a32020');
      expect(weapon.originalColor).toBeNull();

      /* guards: empty slot, un-dyeable slot, non-dye item */
      expect(game.applyDye(hero, 'helm', makeDye()).ok).toBe(false);
      expect(game.applyDye(hero, 'ring1', makeDye()).ok).toBe(false);
      expect(game.applyDye(hero, 'armor', { slot: 'weapon' }).ok).toBe(false);
    });

    it('equipItem refuses dyes', async () => {
      const { inventoryMethods } = await import('../src/game/inventory.js');
      const game = { equipItem: inventoryMethods.equipItem };
      const r = game.equipItem({ equipment: {} }, makeDye());
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/dye/i);
    });
  });

  describe('Base asset integrity', () => {
    it('every base points at an icon file and sprite layers that exist on disk', async () => {
      const { BASES } = await import('../src/game/items.js');
      const fs = await import('node:fs');
      const path = await import('node:path');
      const pub = path.resolve(__dirname, '../public');
      const missing = [];
      const dirOk = p => fs.existsSync(path.join(pub, 'lpc', p));

      for (const slot in BASES) {
        for (const b of BASES[slot]) {
          if (b.icon && !b.icon.startsWith('🎨') && !fs.existsSync(path.join(pub, b.icon))) {
            missing.push(`${slot}/${b.name}: icon ${b.icon}`);
          }
          if (b.visualWeapon && !dirOk(`weapon/${b.visualWeapon}`)) missing.push(`${slot}/${b.name}: weapon layer ${b.visualWeapon}`);
          if (b.visualHelm && !dirOk(`hat/${b.visualHelm}`)) missing.push(`${slot}/${b.name}: helm layer ${b.visualHelm}`);
          if (b.visualTorso && b.visualTorso !== 'none' && !dirOk(`torso/${b.visualTorso}`)) missing.push(`${slot}/${b.name}: torso layer ${b.visualTorso}`);
          if (b.visualShield && !dirOk(`shield/${b.visualShield}`)) missing.push(`${slot}/${b.name}: shield layer ${b.visualShield}`);
          if (b.visualShoes && b.visualShoes !== 'none' && !dirOk(`feet/${b.visualShoes}`)) missing.push(`${slot}/${b.name}: feet layer ${b.visualShoes}`);
          if (b.visualGloves && !dirOk(b.visualGloves)) missing.push(`${slot}/${b.name}: gloves layer ${b.visualGloves}`);
          if (b.visualNeck && !dirOk(`neck/${b.visualNeck}`)) missing.push(`${slot}/${b.name}: neck layer ${b.visualNeck}`);
        }
      }
      expect(missing, missing.join('\n')).toEqual([]);
    });

    it('weapons all carry a complete 5e attack profile', async () => {
      const { BASES } = await import('../src/game/items.js');
      for (const b of BASES.weapon) {
        expect(Array.isArray(b.dmg), b.name).toBe(true);
        expect(typeof b.melee, b.name).toBe('boolean');
        expect(b.dmgType, b.name).toBeTruthy();
        expect(['simple', 'martial']).toContain(b.weaponType);
        if (!b.melee) expect(b.range, `${b.name} (ranged) needs a range`).toBeGreaterThan(2);
      }
    });
  });

  describe('Legendary rework (frozen stats, banded perks)', () => {
    it('effectiveIlvl ignores hero level — legendary stats are frozen at find', async () => {
      const { effectiveIlvl } = await import('../src/game/items.js');
      const leg = rollLegendary(3, mulberry32(11));
      expect(effectiveIlvl(leg, 20)).toBe(3);
    });

    it('perk magnitudes and descriptions scale with found ilvl', async () => {
      const { perkBand, perkMag, perkDescFor } = await import('../src/game/items.js');
      expect(perkBand(1)).toBe(0);
      expect(perkBand(5)).toBe(1);
      expect(perkBand(10)).toBe(2);
      expect(perkBand(17)).toBe(3);
      expect(perkMag('lifesteal', 2)).toBeLessThan(perkMag('lifesteal', 16));
      expect(perkMag('keenEdge', 5)).toBeNull(); // passive — its stats are flat, not banded
      expect(perkDescFor('lifesteal', 2)).toContain('12%');
      expect(perkDescFor('lifesteal', 16)).toContain('24%');
      /* rolled legendaries bake the band numbers into the perk desc */
      for (let seed = 1; seed <= 20; seed++) {
        const leg = rollLegendary(16, mulberry32(seed));
        if (leg.perk?.id === 'lifesteal') expect(leg.perk.desc).toContain('24%');
      }
    });

    it('a legendary is the only rarity that carries a perk, at any ilvl', () => {
      /* The perk is BUDGET-EXEMPT, so even a shallow legendary can afford its
         defining feature — its power comes from the found-ilvl band instead. */
      for (const ilvl of [0, 2, 9, 20]) {
        const leg = rollLegendary(ilvl, mulberry32(ilvl + 1));
        expect(leg.rarity).toBe('legendary');
        expect(leg.perk).toBeTruthy();
      }
      const rng = mulberry32(99);
      for (let i = 0; i < 400; i++) {
        const it = rollItem(10, rng);
        if (it && it.rarity !== 'legendary') expect(it.perk).toBeFalsy();
      }
    });
  });

  describe('Drop distribution', () => {
    const rollMany = (level, n, seed = 42) => {
      const rng = mulberry32(seed);
      const items = [];
      for (let i = 0; i < n; i++) items.push(rollItem(level, rng));
      return items;
    };

    it('rarity is a drop chance, not a gate — every tier is reachable at every depth', () => {
      /* The old maxRarityIdx gate is gone. What keeps a shallow epic from
         breaking the game is the deliberately FLAT rarity budget multiplier, not
         a hard lock, so scarcity alone does the work. */
      const early = rollMany(1, 6000).filter(it => it.slot !== 'kit');
      const eShare = r => early.filter(it => it.rarity === r).length / early.length;
      expect(eShare('common')).toBeGreaterThan(0.7);   // still overwhelmingly common
      expect(eShare('epic')).toBeLessThan(0.03);       // but not impossible

      const deep = rollMany(15, 6000).filter(it => it.slot !== 'kit');
      const share = r => deep.filter(it => it.rarity === r).length / deep.length;
      expect(share('epic')).toBeGreaterThan(0.01);
      expect(share('epic')).toBeLessThan(0.15);        // epics stay the tail
      expect(share('common')).toBeGreaterThan(0.10);   // commons never vanish
      /* Legendaries CAN now drop from random loot, at lottery odds. */
      expect(share('legendary')).toBeLessThan(0.02);
    });

    it('early game has real base variety (regression: repetitive drops)', () => {
      const items = rollMany(1, 3000).filter(it => it.slot !== 'kit');
      const distinct = new Set(items.map(it => it.baseKey));
      expect(distinct.size).toBeGreaterThanOrEqual(25);
    });

    it('a base only rolls the affixes its whitelist allows', () => {
      /* `affixAllow` is the loot editor's per-base restriction. Absent means no
         restriction; an empty array means no affixes at all — which is why the
         editor deletes the property rather than writing a full list. */
      const base = BASES.weapon.find(b => b.name === 'Longsword');
      const collect = (n, seed) => {
        const rng = mulberry32(seed);
        const keys = new Set();
        for (let i = 0; i < n; i++) {
          const it = rollItem(12, rng, 'weapon');
          if (it.baseKey === 'Longsword') (it.affixes || []).forEach(a => keys.add(a.key));
        }
        return keys;
      };

      const unrestricted = collect(3000, 11);
      expect(unrestricted.size).toBeGreaterThan(5);

      try {
        base.affixAllow = ['crit', 'elemFire'];
        const restricted = collect(3000, 11);
        expect(restricted.size).toBeGreaterThan(0);
        for (const k of restricted) expect(['crit', 'elemFire']).toContain(k);

        base.affixAllow = [];
        expect(collect(3000, 11).size).toBe(0);
      } finally {
        delete base.affixAllow;
      }
    });

    it('charisma is itemized: cha rolls appear on affixes and base gear', () => {
      const items = rollMany(14, 5000, 7);
      const withCha = items.filter(it => (it.bonuses?.cha || 0) > 0);
      expect(withCha.length).toBeGreaterThan(0);
      const fromAffix = items.filter(it => (it.affixes || []).some(a => a.key === 'cha'));
      expect(fromAffix.length).toBeGreaterThan(0);
    });
  });

  describe('Trinket slot & consumable items', () => {
    it('slotsFor maps the trinket slot one-to-one', () => {
      expect(slotsFor('trinket')).toEqual(['trinket']);
    });

    it('trinkets land in the Accessories bag tab', () => {
      expect(itemCategory({ slot: 'trinket' })).toBe('accessory');
    });

    it('forceSlot trinket rolls a scroll with charges and a spell', () => {
      let sc = null;
      for (let i = 0; i < 60; i++) {
        const itm = rollItem(5, Math.random, 'trinket', { source: 'chest' });
        if (itm && itm.scroll && !itm.thrown) { sc = itm; break; }   // a spell scroll, not thrown gear
      }
      expect(sc).toBeDefined();
      expect(sc.slot).toBe('trinket');
      expect(sc.scroll).toBe(true);
      expect(sc.spellKey).toBeTruthy();
      expect(sc.casterOnly).toBe(true);
      expect(sc.charges).toBeGreaterThan(0);
      expect(sc.bonuses).toEqual({});
    });

    it('the trinket pool includes potions usable by any class', () => {
      let sawPotion = false;
      for (let i = 0; i < 120; i++) {
        const t = rollItem(10, Math.random, 'trinket', { source: 'chest' });
        if (t.potion) { sawPotion = true; break; }
      }
      expect(sawPotion).toBe(true);
    });

    it('migration preserves a scroll\'s name, value and charges', () => {
      let sc = null;
      for (let i = 0; i < 60; i++) {
        const itm = rollItem(5, Math.random, 'trinket', { source: 'chest' });
        if (itm && itm.scroll && !itm.thrown) { sc = itm; break; }   // a spell scroll, not thrown gear
      }
      const { name, value, charges, spellKey } = sc;
      migrateItem(sc);
      expect(sc.name).toBe(name);
      expect(sc.value).toBe(value);
      expect(sc.charges).toBe(charges);
      expect(sc.spellKey).toBe(spellKey);
    });

    it('random chest loot can include trinkets', () => {
      let sawTrinket = false;
      for (let i = 0; i < 40; i++) {
        const items = rollChestLoot(5, Math.random, 1);
        if (items.some(it => it.slot === 'trinket')) { sawTrinket = true; break; }
      }
      expect(sawTrinket).toBe(true);
    });

    it('compareItemStats correctly calculates stat deltas', () => {
      const shieldOld = { slot: 'shield', acBase: 2, bonuses: { hp: 5 } };
      const shieldNew = { slot: 'shield', acBase: 2, bonuses: { ac: 1, hp: 10, str: 2 } };
      const diffs = compareItemStats(shieldNew, shieldOld);
      
      const acDiff = diffs.find(d => d.stat === 'AC');
      const hpDiff = diffs.find(d => d.stat === 'Max HP');
      const strDiff = diffs.find(d => d.stat === 'STR');

      expect(acDiff).toBeDefined();
      expect(acDiff.diff).toBe(1);
      expect(acDiff.text).toBe('+1 AC');
      expect(acDiff.isPositive).toBe(true);

      expect(hpDiff).toBeDefined();
      expect(hpDiff.diff).toBe(5);
      expect(hpDiff.text).toBe('+5 Max HP');
      expect(hpDiff.isPositive).toBe(true);

      expect(strDiff).toBeDefined();
      expect(strDiff.diff).toBe(2);
      expect(strDiff.text).toBe('+2 STR');

      // Test weapon comparison
      const dagger = { slot: 'weapon', dmg: [1, 4], dmgType: 'piercing', bonuses: {} }; // avg 2.5
      const sword = { slot: 'weapon', dmg: [1, 8], dmgType: 'slashing', bonuses: { dmg: 2 } }; // avg 4.5 + 2 = 6.5
      const weaponDiffs = compareItemStats(sword, dagger);
      const dmgDiff = weaponDiffs.find(d => d.stat === 'Damage');
      expect(dmgDiff).toBeDefined();
      expect(dmgDiff.diff).toBe(4);
      expect(dmgDiff.isPositive).toBe(true);
    });
  });
});

