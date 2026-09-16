import { describe, it, expect } from 'vitest';
import {
  spawnMonster, dungeonMonsterIds, MONSTERS_BY_ID, MONSTERS_ALL,
} from '../src/game/srd.js';
import BOSS_ENCOUNTERS from '../src/game/boss_encounters.json' with { type: 'json' };

const FIELD = ['goblin-cutter', 'goblin-archer', 'goblin-hexer', 'goblin-shield', 'goblin-sneak'];
const CHIEF = 'goblin-warchief';

describe('ancient L2 Nail-Crown goblins', () => {
  it('fields five CR 1/4 goblins on ancient and keeps the warchief off the room roster', () => {
    const ids = dungeonMonsterIds('ancient');
    for (const id of FIELD) {
      expect(ids).toContain(id);
      const m = MONSTERS_BY_ID[id];
      expect(m.cr).toBe(0.25);
      expect(m.isBoss).toBeFalsy();
    }
    expect(ids).not.toContain(CHIEF);
    const chief = MONSTERS_BY_ID[CHIEF];
    expect(chief.cr).toBe(1);
    expect(chief.isBoss).toBeFalsy();
    expect(chief.dungeons).toEqual([]);
  });

  it('spawns only the Nail-Crown 1/4s at ancient level 2', () => {
    const roster = dungeonMonsterIds('ancient');
    const qi = { dungeonLevel: 2, questFloor: 1, floors: 2 };
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const spec = spawnMonster(0.25, 2, Math.random, roster, qi);
      seen.add(spec.id);
      expect(spec.cr).toBe(0.25);
      expect(FIELD).toContain(spec.id);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('does not mix L1 kobolds into the L2 CR window', () => {
    const roster = dungeonMonsterIds('ancient');
    const qi = { dungeonLevel: 2, questFloor: 1, floors: 2 };
    for (let i = 0; i < 20; i++) {
      const spec = spawnMonster(0.25, 2, Math.random, roster, qi);
      expect(spec.id).not.toMatch(/^kobold-/);
    }
  });

  it('delivers goblin-hexer cantripClass through spawnMonster', () => {
    const spec = spawnMonster(0.25, 2, () => 0,
      ['goblin-hexer'], { dungeonLevel: 2, questFloor: 1, floors: 2 }, 'caster', false, true);
    expect(spec.id).toBe('goblin-hexer');
    expect(spec.cantripClass).toBe('warlock');
    expect(spec.ranged).toBe(true);
    expect(spec.abilities?.some(a => a.key === 'bane')).toBe(true);
  });

  it('tags goblin-shield as a tank at AC 15', () => {
    const m = MONSTERS_BY_ID['goblin-shield'];
    expect(m.ac).toBeGreaterThanOrEqual(14);
    expect(m.tags).toContain('tank');
  });

  it('wires ancient-l2 to the warchief and goblin escorts', () => {
    const enc = BOSS_ENCOUNTERS.find(e => e.id === 'ancient-l2');
    expect(enc.bossId).toBe(CHIEF);
    const escortIds = enc.escorts.map(e => e.id);
    expect(escortIds).toEqual(expect.arrayContaining([
      'goblin-shield', 'goblin-cutter', 'goblin-archer', 'goblin-hexer',
    ]));
    expect(escortIds).not.toContain('guardian-serpent');
    expect(escortIds).not.toContain('poisonous-snake');
  });

  it('never sets isBoss on any monster', () => {
    expect(MONSTERS_ALL.filter(m => m.isBoss)).toHaveLength(0);
  });
});
