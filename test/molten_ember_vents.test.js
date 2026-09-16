import { describe, it, expect } from 'vitest';
import {
  spawnMonster, dungeonMonsterIds, MONSTERS_BY_ID, MONSTERS_ALL,
} from '../src/game/srd.js';
import BOSS_ENCOUNTERS from '../src/game/boss_encounters.json' with { type: 'json' };

const FIELD = ['ash-mite', 'cinder-rat', 'ember-magmin', 'ash-speaker', 'vent-beetle'];
const CHIEF = 'ember-swarm-chief';

describe('molten L1 Ember Vents roster', () => {
  it('fields five CR 1/8 creatures on molten and keeps the chief off the room roster', () => {
    const ids = dungeonMonsterIds('molten');
    for (const id of FIELD) {
      expect(ids).toContain(id);
      const m = MONSTERS_BY_ID[id];
      expect(m.cr).toBe(0.125);
      expect(m.isBoss).toBeFalsy();
    }
    expect(ids).not.toContain(CHIEF);
    const chief = MONSTERS_BY_ID[CHIEF];
    expect(chief.cr).toBe(1);
    expect(chief.isBoss).toBeFalsy();
    expect(chief.dungeons).toEqual([]);
  });

  it('does not leak generic CR 1/8 soup into molten', () => {
    const ids = dungeonMonsterIds('molten');
    for (const id of ['giant-rat', 'grey-rat', 'kobold', 'stirge', 'fire-crab', 'big-kobold']) {
      expect(ids).not.toContain(id);
    }
  });

  it('spawns only the Ember Vents 1/8s at level 1', () => {
    const roster = dungeonMonsterIds('molten');
    const qi = { dungeonLevel: 1, questFloor: 1, floors: 2 };
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const spec = spawnMonster(0.125, 1, Math.random, roster, qi);
      seen.add(spec.id);
      expect(spec.cr).toBe(0.125);
      expect(FIELD).toContain(spec.id);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('delivers ash-speaker cantripClass through spawnMonster', () => {
    const spec = spawnMonster(0.125, 1, () => 0,
      ['ash-speaker'], { dungeonLevel: 1, questFloor: 1, floors: 2 }, 'caster', false, true);
    expect(spec.id).toBe('ash-speaker');
    expect(spec.cantripClass).toBe('wizard');
    expect(spec.rangedDmgType).toBe('fire');
    expect(spec.ranged).toBe(true);
    expect(spec.abilities?.some(a => a.key === 'burning-hands')).toBe(true);
  });

  it('tags vent-beetle as a tank at AC 15', () => {
    const m = MONSTERS_BY_ID['vent-beetle'];
    expect(m.ac).toBeGreaterThanOrEqual(14);
    expect(m.tags).toContain('tank');
  });

  it('wires molten-l1 to the new chief and escorts', () => {
    const enc = BOSS_ENCOUNTERS.find(e => e.id === 'molten-l1');
    expect(enc.bossId).toBe(CHIEF);
    const escortIds = enc.escorts.map(e => e.id);
    expect(escortIds).toEqual(expect.arrayContaining(['vent-beetle', 'ember-magmin', 'ash-speaker', 'cinder-rat']));
    expect(escortIds).not.toContain('giant-fire-beetle');
    expect(escortIds).not.toContain('magmin');
  });

  it('never sets isBoss on any monster', () => {
    expect(MONSTERS_ALL.filter(m => m.isBoss)).toHaveLength(0);
  });
});
