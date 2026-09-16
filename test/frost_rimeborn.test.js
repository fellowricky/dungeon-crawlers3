import { describe, it, expect } from 'vitest';
import {
  spawnMonster, dungeonMonsterIds, MONSTERS_BY_ID,
} from '../src/game/srd.js';
import BOSS_ENCOUNTERS from '../src/game/boss_encounters.json' with { type: 'json' };

const FIELD = ['rime-crawler', 'shard-mantis', 'frost-prism', 'rime-urchin', 'shard-swarm'];
const WARDEN = 'hoarfrost-warden';
const QI = { dungeonLevel: 1, questFloor: 1, floors: 2 };

describe('frost L1 Rimeborn roster', () => {
  it('fields five CR 1/8 creatures on frost and keeps the warden off the room roster', () => {
    const ids = dungeonMonsterIds('frost');
    for (const id of FIELD) {
      expect(ids).toContain(id);
      const m = MONSTERS_BY_ID[id];
      expect(m.cr).toBe(0.125);
      expect(m.isBoss).toBeFalsy();
    }
    expect(ids).not.toContain(WARDEN);
    const w = MONSTERS_BY_ID[WARDEN];
    expect(w.cr).toBe(1);
    expect(w.isBoss).toBeFalsy();
  });

  it('keeps aquatic and off-theme creatures out of frost', () => {
    const ids = dungeonMonsterIds('frost');
    for (const id of ['merfolk-fighter', 'merfolk-javelineer', 'merfolk-impaler',
                      'merfolk-aquamancer', 'lemure', 'shrieker']) {
      expect(ids).not.toContain(id);
    }
  });

  /* Removing them from frost was the point; leaving them with no home was not.
     An empty `dungeons` array keeps a creature out of EVERY themed spawn. */
  it('leaves the displaced creatures somewhere to spawn', () => {
    for (const id of ['merfolk-fighter', 'merfolk-javelineer', 'merfolk-impaler',
                      'merfolk-aquamancer', 'lemure']) {
      expect(MONSTERS_BY_ID[id].dungeons.length).toBeGreaterThan(0);
    }
  });

  /* spawnMonster projects `spec` field by field rather than spreading it, so a
     property can be perfectly correct in monsters.json and still never reach the
     runtime. Reading MONSTERS_ALL cannot catch that -- only spawning can. */
  it('delivers the prism cantrip fields through spawnMonster', () => {
    const spec = spawnMonster(0.125, 1, () => 0, ['frost-prism'], QI, 'caster', false, true);
    expect(spec.id).toBe('frost-prism');
    expect(spec.cantripClass).toBe('artificer');
    expect(spec.rangedDmgType).toBe('cold');
    expect(spec.ranged).toBe(true);
  });

  it('delivers cold immunity and fire vulnerability through spawnMonster', () => {
    for (const id of [...FIELD, WARDEN]) {
      const spec = spawnMonster(id === WARDEN ? 1 : 0.125, 1, () => 0, [id], QI);
      expect(spec.statblock.immune).toContain('cold');
      expect(spec.statblock.vulnerable).toContain('fire');
    }
  });

  /* 1 cell = 5 ft. speedFt is what the tactical turn engine reads; authoring it
     explicitly keeps the number in the file equal to the number in play, instead
     of resolving through a round() with thresholds every 0.5 of `speed`. */
  it('gives every Rimeborn a speed on a whole 5 ft boundary', () => {
    for (const id of [...FIELD, WARDEN]) {
      const m = MONSTERS_BY_ID[id];
      expect(m.speedFt % 5).toBe(0);
      expect(m.speedFt).toBe(Math.round(m.speed * 10));
      expect(spawnMonster(id === WARDEN ? 1 : 0.125, 1, () => 0, [id], QI).speedFt)
        .toBe(m.speedFt);
    }
  });

  it('matches the frost-l1 encounter to its own targetCR', () => {
    const enc = BOSS_ENCOUNTERS.find(e => e.id === 'frost-l1');
    expect(enc.bossId).toBe(WARDEN);
    expect(MONSTERS_BY_ID[enc.bossId].cr).toBe(enc.targetCR);
    for (const esc of enc.escorts) {
      expect(MONSTERS_BY_ID[esc.id].cr).toBeLessThanOrEqual(enc.targetCR);
    }
  });

  it('spawns only Rimeborn and ambient vermin at level 1, never above CR 1/8', () => {
    const roster = dungeonMonsterIds('frost');
    for (let i = 0; i < 40; i++) {
      const spec = spawnMonster(0.125, 1, Math.random, roster, QI);
      expect(spec.cr).toBeLessThanOrEqual(0.125);
      expect(spec.id).not.toBe(WARDEN);
    }
  });
});
