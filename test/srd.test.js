import { describe, it, expect } from 'vitest';
import { makeHero, recalc, grantXp, canEquip, spawnMonster, CLASSES } from '../src/game/srd.js';

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
    expect(hero.ac).toBe(15); // Chain Shirt starts AC at 13 + Dex mod (13 + 2 (dex 14 mod) = 15)
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
    
    // XP threshold for L2 is 300 XP
    grantXp(hero, 350, logFn);
    
    expect(hero.xp).toBe(350);
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
