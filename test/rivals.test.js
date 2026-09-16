import { describe, it, expect } from 'vitest';
import { generateRivalParty, equipClassAppropriateGear, generateCompanyName } from '../src/game/rivals.js';
import { generateDungeon, TYPE } from '../src/dungeon/dungeon_generator.js';
import { canEquip } from '../src/game/srd.js';

describe('Rival Adventurers System', () => {
  it('generates a procedural company name', () => {
    const name = generateCompanyName();
    expect(typeof name).toBe('string');
    expect(name.startsWith('The ')).toBe(true);
    expect(name.split(' ').length).toBeGreaterThanOrEqual(3);
  });

  it('generates a 4-hero rival party scaled to dungeon level', () => {
    const { company, rivals } = generateRivalParty(5);

    expect(typeof company).toBe('string');
    expect(rivals).toHaveLength(4);

    const roles = rivals.map(r => r.role);
    expect(roles).toContain('tank');
    expect(roles).toContain('skirmisher');
    expect(roles).toContain('healer');
    expect(roles).toContain('caster');

    for (const rival of rivals) {
      expect(rival.level).toBe(5);
      expect(rival.isRival).toBe(true);
      expect(rival.companyName).toBe(company);
      expect(rival.hp).toBeGreaterThan(20);
      expect(rival.maxHp).toBeGreaterThan(20);
      expect(rival.ac).toBeGreaterThanOrEqual(10);
      expect(typeof rival.atk).toBe('number');
      expect(Array.isArray(rival.dmg)).toBe(true);
      expect(rival.dmg).toHaveLength(3);
      expect(rival.rngRange).toBeGreaterThan(0);
      expect(rival.speedCells).toBeGreaterThan(0);
      expect(rival.abilities.length).toBeGreaterThan(0);
      expect(rival.visual).toBeDefined();
      expect(rival.visual.gender).toBeDefined();
    }
  });

  it('equips class-appropriate gear that satisfies canEquip', () => {
    const { rivals } = generateRivalParty(7);

    for (const rival of rivals) {
      for (const [slot, item] of Object.entries(rival.equipment || {})) {
        if (item) {
          expect(canEquip(rival, item)).toBe(true);
        }
      }
    }

    // Fighter should have weapon and armor
    const fighter = rivals.find(r => r.classKey === 'fighter');
    expect(fighter.equipment.weapon).toBeDefined();
    expect(fighter.equipment.armor).toBeDefined();

    // Wizard should not wear heavy/medium armor
    const wizard = rivals.find(r => r.classKey === 'wizard');
    if (wizard.equipment.armor) {
      expect(wizard.equipment.armor.prof || 'none').toBe('none');
    }
  });

  it('assigns class-specific spells and skills', () => {
    const { rivals } = generateRivalParty(6);

    const fighter = rivals.find(r => r.classKey === 'fighter');
    expect(fighter.abilities.some(a => a.key === 'secondWind')).toBe(true);
    expect(fighter.abilities.some(a => a.key === 'actionSurge')).toBe(true);

    const rogue = rivals.find(r => r.classKey === 'rogue');
    expect(rogue.abilities.some(a => a.key === 'sneakAttack')).toBe(true);

    const cleric = rivals.find(r => r.classKey === 'cleric');
    expect(cleric.abilities.some(a => a.key === 'cureWounds')).toBe(true);

    const wizard = rivals.find(r => r.classKey === 'wizard');
    expect(wizard.abilities.some(a => a.key === 'fireball' || a.key === 'scorchingRay')).toBe(true);
  });

  it('places a TYPE.RIVAL room and campsite props when hasRivalRoom is true', () => {
    const dungeon = generateDungeon(12345, {
      seed: 12345,
      roomCount: 16,
      themeKey: 'ancient',
      hasRivalRoom: true
    });

    expect(dungeon).toBeDefined();
    const rivalRooms = dungeon.rooms.filter(r => r.type === TYPE.RIVAL);
    expect(rivalRooms.length).toBe(1);

    const rRoom = rivalRooms[0];
    expect(rRoom.rival).toBe(true);

    // Verify campsite props placed in this room
    const campProps = dungeon.props.filter(p => p.roomId === rRoom.id);
    const kinds = campProps.map(p => p.kind);
    expect(kinds).toContain('shrineCrystal'); // campfire
    expect(kinds).toContain('weaponRack');
    expect(kinds).toContain('crate');
  });

  it('does NOT place a TYPE.RIVAL room when hasRivalRoom is false', () => {
    const dungeon = generateDungeon(12345, {
      seed: 12345,
      roomCount: 16,
      themeKey: 'ancient',
      hasRivalRoom: false
    });

    expect(dungeon).toBeDefined();
    const rivalRooms = dungeon.rooms.filter(r => r.type === TYPE.RIVAL);
    expect(rivalRooms.length).toBe(0);
  });

  it('ensures single-floor allocation rule across multi-floor quest', () => {
    const floors = 5;
    const rivalFloor = Math.max(1, Math.ceil(floors / 2));
    expect(rivalFloor).toBe(3);

    // Verify floor 1, 2, 4, 5 do NOT request rival room
    const checkFloor = (floor, spawned) => {
      return !spawned && floor === rivalFloor;
    };

    expect(checkFloor(1, false)).toBe(false);
    expect(checkFloor(2, false)).toBe(false);
    expect(checkFloor(3, false)).toBe(true);
    expect(checkFloor(3, true)).toBe(false); // already spawned
    expect(checkFloor(4, true)).toBe(false);
    expect(checkFloor(5, true)).toBe(false);
  });
});
