import { describe, it, expect } from 'vitest';
import {
  makeHero, createWolfCompanion, recalc, grantXp, canEquip, spawnMonster, CLASSES,
  heroDamage, pickAttackProfile, buildWeaponProfile, unarmedFallback, XP_TABLE,
  MONSTERS_ALL, monsterSpawnsIn, dungeonMonsterIds
} from '../src/game/srd.js';
import { makeStarterItem, migrateItem } from '../src/game/items.js';
import { chargeMax, chargesLeft } from '../src/game/features.js';
import { applyShortRestToHero } from '../src/game/rest.js';

describe('Per-creature dungeon spawn whitelist', () => {
  it('monsterSpawnsIn enforces the strict per-dungeon whitelist', () => {
    const m = { id: 'x', dungeons: ['ancient', 'frost'] };
    expect(monsterSpawnsIn(m, 'ancient')).toBe(true);
    expect(monsterSpawnsIn(m, 'frost')).toBe(true);
    expect(monsterSpawnsIn(m, 'grim')).toBe(false);
    expect(monsterSpawnsIn({ id: 'y', dungeons: [] }, 'ancient')).toBe(false);
    expect(monsterSpawnsIn({ id: 'z' }, 'ancient')).toBe(false);
    expect(monsterSpawnsIn(null, 'ancient')).toBe(false);
  });

  it('dungeonMonsterIds returns only creatures whitelisted for the theme', () => {
    /* The roster used to ship with no `dungeons` field on any creature, so
       this asserted an empty list. It is populated now, so assert the
       invariant instead: every id returned must actually be whitelisted. */
    const ancient = dungeonMonsterIds('ancient');
    expect(Array.isArray(ancient)).toBe(true);
    expect(ancient.length).toBeGreaterThan(0);

    const byId = new Map(MONSTERS_ALL.map(m => [m.id, m]));
    for (const id of ancient) {
      expect(monsterSpawnsIn(byId.get(id), 'ancient')).toBe(true);
    }

    // Creatures NOT whitelisted for a theme must be excluded from it.
    const excluded = MONSTERS_ALL.filter(m => !monsterSpawnsIn(m, 'ancient'));
    expect(excluded.length).toBeGreaterThan(0);
    const ancientSet = new Set(ancient);
    for (const m of excluded) expect(ancientSet.has(m.id)).toBe(false);

    // A synthetic creature is picked up for its theme and no other.
    const tmp = { id: 'test-dungeon-creature', cr: 0.25, dungeons: ['ancient'] };
    MONSTERS_ALL.push(tmp);
    try {
      expect(dungeonMonsterIds('ancient')).toContain('test-dungeon-creature');
      expect(dungeonMonsterIds('frost')).not.toContain('test-dungeon-creature');
    } finally {
      MONSTERS_ALL.pop();
    }
  });
});

describe('SRD 5.1 Adaptation', () => {
  it('should make a new hero and calculate correct initial stats', () => {
    const hero = makeHero('Aldric', 'human', 'fighter', {
      str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12
    }, {});
    
    expect(hero.name).toBe('Aldric');
    expect(hero.level).toBe(1);
    expect(hero.xp).toBe(0);
    // Fighter base hit die is 10, human gives +1 to all stats, making con 15 (mod +2).
    // HP = 10 (hit die) + 8 (grit) + 2 (con mod) = 20.
    expect(hero.maxHp).toBe(20);
    /* Tier-0 starting gear: a Peasant Shirt sets no AC floor, so a level-1 hero
       is genuinely unarmored at 10 + Dex. Starters used to be a Chain Shirt
       (AC 15), which made most level-1 drops a downgrade. */
    expect(hero.ac).toBe(12); // unarmored 10 + Dex mod (dex 13+1 human = 14, +2)
  });

  it('should recalc stats correctly after leveling up or modifying attributes', () => {
    const hero = makeHero(' Aldric', 'human', 'fighter', {
      str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12
    }, {});
    
    hero.level = 3;
    recalc(hero);
    
    // Level 3 maxHp should scale: L1 (10) + 8 + 2*avg(6) + 3*2 (con) = 18 + 12 + 6 = 36
    expect(hero.maxHp).toBe(36);
  });

  it('should handle XP progression and trigger level-ups', () => {
    const hero = makeHero(' Aldric', 'human', 'fighter', {
      str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12
    }, {});
    
    const logs = [];
    const logFn = (msg) => logs.push(msg);
    
    const targetXp = XP_TABLE[2] + 50;
    grantXp(hero, targetXp, logFn);
    
    expect(hero.xp).toBe(targetXp);
    expect(hero.level).toBe(2);
    expect(logs.some(l => l.includes('reaches level'))).toBe(true);
  });

  it('should enforce equipment requirements (canEquip)', () => {
    const fighter = makeHero('Aldric', 'human', 'fighter', {
      str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12
    }, {});
    
    const wizard = makeHero('Sariel', 'elf', 'wizard', {
      str: 8, dex: 15, con: 12, int: 15, wis: 13, cha: 10
    }, {});
    
    const shieldItem = { slot: 'shield' };
    const plateArmor = { slot: 'armor', prof: 'heavy', armorBase: 18 };
    const simpleWeapon = { slot: 'weapon', baseKey: 'Dagger', weaponType: 'simple' };
    const martialWeapon = { slot: 'weapon', baseKey: 'Greatsword', weaponType: 'martial' };

    // Shield check
    expect(canEquip(fighter, shieldItem)).toBe(true);
    expect(canEquip(wizard, shieldItem)).toBe(false);

    // Armor check
    expect(canEquip(fighter, plateArmor)).toBe(true);
    expect(canEquip(wizard, plateArmor)).toBe(false);

    // Weapon check
    expect(canEquip(fighter, martialWeapon)).toBe(true);
    expect(canEquip(wizard, martialWeapon)).toBe(false);
    expect(canEquip(wizard, simpleWeapon)).toBe(true);
  });

  it('should spawn monsters with scaling attributes based on CR and level', () => {
    const monster = spawnMonster('1', 3, Math.random);
    expect(monster).toBeDefined();
    expect(monster.hp).toBeGreaterThan(0);
    expect(monster.scale).toBeDefined();
  });
});

/* ─── Weapon-driven attack profiles (D&D 5e) ──────────────────────────── */

describe('Weapon-driven attack profiles', () => {
  it('derives the attack profile from the equipped weapon, not the class (fixes rogue bug)', () => {
    const rogue = makeHero('Kira', 'human', 'rogue',
      { str:10, dex:16, con:12, int:10, wis:10, cha:10 }, {});
    // Starter is a Rusty Dagger — melee, finesse, piercing
    expect(rogue.weaponProfile).toBeDefined();
    expect(rogue.weaponProfile.melee).toBe(true);
    expect(rogue.weaponProfile.dmg).toEqual([1, 4]);
    expect(rogue.weaponProfile.dmgType).toBe('piercing');
    expect(rogue.weaponProfile.ability).toBe('dex'); // finesse, dex > str
    expect(rogue.weaponProfile.source).toBe('weapon');

    // Shortsword → 1d6 piercing melee (NOT a ranged bow attack)
    rogue.equipment.weapon = makeStarterItem('weapon', 'Shortsword');
    recalc(rogue);
    expect(rogue.weaponProfile.melee).toBe(true);
    expect(rogue.weaponProfile.dmg).toEqual([1, 6]);
    expect(rogue.weaponProfile.dmgType).toBe('piercing');

    // Shortbow → ranged (the original bug: rogue with shortsword made ranged attacks)
    rogue.equipment.weapon = makeStarterItem('weapon', 'Shortbow');
    recalc(rogue);
    expect(rogue.weaponProfile.melee).toBe(false);
    expect(rogue.weaponProfile.dmg).toEqual([1, 6]);
    expect(rogue.weaponProfile.ability).toBe('dex');
  });

  it('uses the class dice when no weapon is equipped (unarmed fallback)', () => {
    const fighter = makeHero('Aldric', 'human', 'fighter',
      { str:15, dex:13, con:14, int:8, wis:10, cha:12 }, {});
    delete fighter.equipment.weapon;
    recalc(fighter);
    // Fighter with no weapon → unarmed (1 + str)
    expect(fighter.weaponProfile).toBeNull();
    const atk = pickAttackProfile(fighter);
    expect(atk.source).toBe('unarmed');
    expect(atk.dmg).toEqual([1, 1]);
    expect(atk.ability).toBe('str');

    // Monk with no weapon → martial arts unarmed (1d6 + dex)
    const monk = makeHero('Toby', 'human', 'monk',
      { str:10, dex:16, con:14, int:10, wis:14, cha:10 }, {});
    delete monk.equipment.weapon;
    recalc(monk);
    const monkAtk = pickAttackProfile(monk);
    expect(monkAtk.source).toBe('unarmed');
    expect(monkAtk.dmg).toEqual([1, 6]);
    expect(monkAtk.ability).toBe('dex');
  });

  it('finesse weapons use max(STR, DEX) per 5e rules', () => {
    // High-STR fighter with a rapier (finesse) → uses STR
    const fighter = makeHero('Aldric', 'human', 'fighter',
      { str:18, dex:10, con:14, int:10, wis:10, cha:10 }, {});
    fighter.equipment.weapon = makeStarterItem('weapon', 'Rapier');
    recalc(fighter);
    expect(fighter.weaponProfile.finesse).toBe(true);
    expect(fighter.weaponProfile.ability).toBe('str');

    // High-DEX rogue with a rapier → uses DEX
    const rogue = makeHero('Kira', 'human', 'rogue',
      { str:10, dex:18, con:14, int:10, wis:10, cha:10 }, {});
    rogue.equipment.weapon = makeStarterItem('weapon', 'Rapier');
    recalc(rogue);
    expect(rogue.weaponProfile.ability).toBe('dex');
  });

  it('casters keep their cantrip profile; focus weapons keep them on cantrips', () => {
    const wizard = makeHero('Sariel', 'elf', 'wizard',
      { str:8, dex:14, con:12, int:16, wis:12, cha:10 }, {});
    expect(wizard.cantripProfile).toBeDefined();
    expect(wizard.cantripProfile.name).toBe('Fire Bolt');
    expect(wizard.cantripProfile.cantripScale).toBe(true);
    expect(wizard.cantripProfile.dmgType).toBe('fire');
    expect(wizard.cantripProfile.source).toBe('cantrip');

    // Equip a Wand (a focus) → caster always picks cantrip regardless of slider
    wizard.equipment.weapon = makeStarterItem('weapon', 'Wand');
    recalc(wizard);
    expect(wizard.weaponProfile.focus).toBe(true);
    wizard.aiPrefs.rangedPref = 0; // even at "always melee", focus forces cantrip
    for (let i = 0; i < 30; i++) {
      expect(pickAttackProfile(wizard).source).toBe('cantrip');
    }
  });

  it('caster with a non-focus weapon rolls between cantrip and weapon by rangedPref', () => {
    const cleric = makeHero('Doric', 'human', 'cleric',
      { str:12, dex:10, con:14, int:10, wis:16, cha:12 }, {});
    // Cleric starter is a tier-0 Club — NOT a focus
    expect(cleric.weaponProfile.focus).toBeFalsy();
    expect(cleric.weaponProfile.melee).toBe(true);
    expect(cleric.weaponProfile.dmg).toEqual([1, 4]);

    // rangedPref = 1 → always cantrip
    cleric.aiPrefs.rangedPref = 1;
    for (let i = 0; i < 30; i++) {
      expect(pickAttackProfile(cleric).source).toBe('cantrip');
    }
    // rangedPref = 0 → always weapon
    cleric.aiPrefs.rangedPref = 0;
    for (let i = 0; i < 30; i++) {
      expect(pickAttackProfile(cleric).source).toBe('weapon');
    }
  });

  it('heroDamage rolls the weapon profile dice + ability mod', () => {
    const fighter = makeHero('Aldric', 'human', 'fighter',
      { str:18, dex:10, con:14, int:10, wis:10, cha:10 }, {});
    // Tier-0 starter Club: 1d4 bludgeoning. str 18+1 human = 19, mod +4. dmgBonus 0.
    const p = fighter.weaponProfile;
    expect(p.dmg).toEqual([1, 4]);
    let min = Infinity, max = 0;
    for (let i = 0; i < 300; i++) {
      const d = heroDamage(fighter, false, p);
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
    // 1d4 + 4 (str) + 0 (dmgBonus) = 5..8
    expect(min).toBe(5);
    expect(max).toBe(8);
  });

  it('heroDamage doubles dice on crit and adds savage attack die', () => {
    const halfOrcFighter = makeHero('Garrick', 'halforc', 'fighter',
      { str:18, dex:10, con:14, int:10, wis:10, cha:10 }, {});
    // half-orc savageCrit adds +1 die on melee crits
    const p = halfOrcFighter.weaponProfile; // tier-0 Club 1d4
    let max = 0;
    for (let i = 0; i < 300; i++) {
      const d = heroDamage(halfOrcFighter, true, p);
      // crit doubles the dice (2d4) and savageCrit adds one more (3d4).
      // half-orc str 18+2 = 20, mod +5 → 3d4+5 = 8..17
      expect(d).toBeGreaterThanOrEqual(8);
      expect(d).toBeLessThanOrEqual(17);
      max = Math.max(max, d);
    }
    // Verify that we are rolling reasonably high values
    expect(max).toBeGreaterThanOrEqual(14);
  });

  it('cantrip damage scales with level and adds no ability mod', () => {
    const wizard = makeHero('Sariel', 'elf', 'wizard',
      { str:8, dex:14, con:12, int:16, wis:12, cha:10 }, {});
    wizard.level = 10;
    recalc(wizard);
    // Fire Bolt at L10 → 2d10 (cantripDice(10) = 2), no ability mod
    const p = wizard.cantripProfile;
    let min = Infinity, max = 0;
    for (let i = 0; i < 300; i++) {
      const d = heroDamage(wizard, false, p);
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
    // 2d10 = 2..20, + 0 ability, + 0 dmgBonus (starter wand has no dmg bonus)
    expect(min).toBeGreaterThanOrEqual(2);
    expect(max).toBeLessThanOrEqual(20);
  });
});

/* ─── Two-Weapon Fighting ────────────────────────────────────────────── */

describe('Two-Weapon Fighting', () => {
  it('enables an offhand attack profile only when both weapons are light', () => {
    const rogue = makeHero('Kira', 'human', 'rogue',
      { str:10, dex:16, con:12, int:10, wis:10, cha:10 }, {});
    // Two light weapons → TWF active
    rogue.equipment.weapon = makeStarterItem('weapon', 'Shortsword');
    rogue.equipment.offhand = makeStarterItem('weapon', 'Dagger');
    recalc(rogue);
    expect(rogue.offhandProfile).toBeDefined();
    expect(rogue.offhandProfile.offhand).toBe(true);
    expect(rogue.offhandProfile.noAbilityMod).toBe(true);
    expect(rogue.offhandProfile.dmg).toEqual([1, 4]); // Dagger 1d4

    // Non-light main hand → no TWF
    rogue.equipment.weapon = makeStarterItem('weapon', 'Longsword');
    recalc(rogue);
    expect(rogue.offhandProfile).toBeNull();

    // Two-handed main → no TWF
    rogue.equipment.weapon = makeStarterItem('weapon', 'Greatsword');
    recalc(rogue);
    expect(rogue.offhandProfile).toBeNull();
  });

  it('offhand attack deals weapon die with no ability mod to damage', () => {
    const rogue = makeHero('Kira', 'human', 'rogue',
      { str:10, dex:18, con:12, int:10, wis:10, cha:10 }, {});
    rogue.equipment.weapon = makeStarterItem('weapon', 'Shortsword');
    rogue.equipment.offhand = makeStarterItem('weapon', 'Shortsword');
    recalc(rogue);
    const oh = rogue.offhandProfile;
    let min = Infinity, max = 0;
    for (let i = 0; i < 300; i++) {
      const d = heroDamage(rogue, false, oh);
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
    // 1d6 + 0 (no ability mod for TWF offhand) + 0 dmgBonus = 1..6
    expect(min).toBe(1);
    expect(max).toBe(6);
  });
});

/* ─── Migration of legacy saves ──────────────────────────────────────── */

describe('Legacy save migration', () => {
  it('migrateItem backfills 5e weapon fields on old saves', () => {
    const legacy = {
      id: 'i1', slot: 'weapon', baseKey: 'Shortsword', name: 'Shortsword',
      rarity: 'common', ilvl: 5, bonuses: {}
    };
    migrateItem(legacy);
    expect(legacy.dmg).toEqual([1, 6]);
    expect(legacy.melee).toBe(true);
    expect(legacy.dmgType).toBe('piercing');
    expect(legacy.finesse).toBe(true);
    expect(legacy.light).toBe(true);
  });

  it('migrateItem backfills focus + ranged fields on legacy caster weapons', () => {
    const legacyWand = {
      id: 'i2', slot: 'weapon', baseKey: 'Wand', name: 'Wand',
      rarity: 'common', ilvl: 3, bonuses: {}
    };
    migrateItem(legacyWand);
    expect(legacyWand.focus).toBe(true);
    expect(legacyWand.melee).toBe(false);
    expect(legacyWand.dmgType).toBe('force');
    expect(legacyWand.dmg).toEqual([1, 6]);
  });
});

describe('Wolf Companion Creation & Scaling', () => {
  it('creates a wolf companion with stat block scaled to level', () => {
    const wolf1 = createWolfCompanion(1);
    expect(wolf1.name).toBe('Alpha Wolf');
    expect(wolf1.isWolf).toBe(true);
    expect(wolf1.raceKey).toBe('wolf');
    expect(wolf1.classKey).toBe('wolf');
    expect(wolf1.level).toBe(1);
    expect(wolf1.maxHp).toBeGreaterThan(0);
    expect(wolf1.ac).toBeGreaterThanOrEqual(13);
    expect(wolf1.visual.spriteSheet).toBe('sprites/wolf.png');
    expect(wolf1.visual.singleImage).toBe(true);
    expect(wolf1.weaponProfile.name).toBe('Bite');
    expect(wolf1.weaponProfile.dmgType).toBe('piercing');

    const wolf5 = createWolfCompanion(5);
    expect(wolf5.level).toBe(5);
    expect(wolf5.maxHp).toBeGreaterThan(wolf1.maxHp);
    expect(wolf5.atkBonus).toBeGreaterThanOrEqual(wolf1.atkBonus);
  });
});

describe('Proficiency Bonus Feature Charge Scaling', () => {
  it('scales short-rest skills and Rage charges by proficiency bonus', () => {
    const lvl1Hero = { level: 1 };
    const lvl5Hero = { level: 5 };
    const lvl9Hero = { level: 9 };

    expect(chargeMax('secondWind', lvl1Hero)).toBe(2);
    expect(chargeMax('secondWind', lvl5Hero)).toBe(3);
    expect(chargeMax('secondWind', lvl9Hero)).toBe(4);

    expect(chargeMax('rage', lvl1Hero)).toBe(2);
    expect(chargeMax('rage', lvl5Hero)).toBe(3);
    expect(chargeMax('rage', lvl9Hero)).toBe(4);

    expect(chargeMax('actionSurgeClass', lvl1Hero)).toBe(2);
    expect(chargeMax('flurryOfBlows', lvl5Hero)).toBe(3);
  });

  it('refills Rage and long rest abilities when resting at a shrine', () => {
    const hero = { level: 1, charges: { rage: 0, secondWind: 0 } };
    applyShortRestToHero(hero, { reason: 'shrine', fullHeal: true });
    expect(chargesLeft(hero, 'rage')).toBe(2);
    expect(chargesLeft(hero, 'secondWind')).toBe(2);
  });
});
