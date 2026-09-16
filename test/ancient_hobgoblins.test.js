import { describe, it, expect } from 'vitest';
import {
  spawnMonster, dungeonMonsterIds, MONSTERS_BY_ID, MONSTERS_ALL,
} from '../src/game/srd.js';
import BOSS_ENCOUNTERS from '../src/game/boss_encounters.json' with { type: 'json' };

const FIELD = [
  'hobgoblin-legionary', 'hobgoblin-archer', 'hobgoblin-devastator',
  'hobgoblin-ironback', 'hobgoblin-drillmaster',
];
const LEGATE = 'hobgoblin-legate';
const GOBLINS = ['goblin-cutter', 'goblin-archer', 'goblin-hexer', 'goblin-shield', 'goblin-sneak'];

describe('ancient L3 Red-Banner hobgoblins', () => {
  it('fields five CR 1/2 hobgoblins on ancient and keeps the legate off the room roster', () => {
    const ids = dungeonMonsterIds('ancient');
    for (const id of FIELD) {
      expect(ids).toContain(id);
      const m = MONSTERS_BY_ID[id];
      expect(m.cr).toBe(0.5);
      expect(m.isBoss).toBeFalsy();
    }
    expect(ids).not.toContain(LEGATE);
    const legate = MONSTERS_BY_ID[LEGATE];
    expect(legate.cr).toBe(2);
    expect(legate.isBoss).toBeFalsy();
    expect(legate.dungeons).toEqual([]);
  });

  it('owns the ancient CR 1/2 rung outright — the orcs were evicted', () => {
    const ids = dungeonMonsterIds('ancient');
    const atHalf = ids.filter(id => MONSTERS_BY_ID[id].cr === 0.5);
    expect(atHalf.sort()).toEqual([...FIELD].sort());
    for (const orc of ['orc', 'orc-warrior', 'orc-priest', 'orc-whelp']) {
      expect(MONSTERS_BY_ID[orc].dungeons).not.toContain('ancient');
    }
  });

  it('spawns only Red-Banner hobgoblins at ancient level 3', () => {
    const roster = dungeonMonsterIds('ancient');
    const qi = { dungeonLevel: 3, questFloor: 1, floors: 3 };
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const spec = spawnMonster(0.5, 3, Math.random, roster, qi);
      seen.add(spec.id);
      expect(spec.cr).toBe(0.5);
      expect(FIELD).toContain(spec.id);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  /* The mix the level is built around: an ordinary level-3 slot is priced at
     CR 1/2 and fields a hobgoblin, while a minion/guard slot carries crOffset
     -1 (targetCR 0.5 * 0.6 = 0.3), which has no exact match and steps DOWN to
     the dearest rung at or below — the CR 1/4 Nail-Crown goblins. */
  it('steps down to the L2 goblins for the -1 crOffset minion slots', () => {
    const roster = dungeonMonsterIds('ancient');
    const qi = { dungeonLevel: 3, questFloor: 1, floors: 3 };
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const spec = spawnMonster(0.5 * 0.6, 3, Math.random, roster, qi, 'minion');
      seen.add(spec.id);
      expect(GOBLINS).toContain(spec.id);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('does not mix L1 kobolds into the L3 CR window', () => {
    const roster = dungeonMonsterIds('ancient');
    const qi = { dungeonLevel: 3, questFloor: 1, floors: 3 };
    for (let i = 0; i < 20; i++) {
      expect(spawnMonster(0.5, 3, Math.random, roster, qi).id).not.toMatch(/^kobold-/);
    }
  });

  it('delivers devastator cantripClass and burning hands through spawnMonster', () => {
    const spec = spawnMonster(0.5, 3, () => 0,
      ['hobgoblin-devastator'], { dungeonLevel: 3, questFloor: 1, floors: 3 }, 'caster', false, true);
    expect(spec.id).toBe('hobgoblin-devastator');
    expect(spec.cantripClass).toBe('wizard');
    expect(spec.rangedDmgType).toBe('fire');
    expect(spec.ranged).toBe(true);
    expect(spec.abilities?.some(a => a.key === 'burning-hands')).toBe(true);
  });

  /* spawnMonster builds its return object field by field, so a flag that is not
     named there never reaches m.data no matter how correct monsters.json looks.
     monster_ai.js reads m.data.martialAdvantage, so this has to be asserted on
     the SPAWNED monster, not on MONSTERS_BY_ID. */
  it('delivers martialAdvantage through spawnMonster, not just in the JSON', () => {
    const qi = { dungeonLevel: 3, questFloor: 1, floors: 3 };
    const drill = spawnMonster(0.5, 3, () => 0, ['hobgoblin-drillmaster'], qi, null, false, true);
    expect(drill.id).toBe('hobgoblin-drillmaster');
    expect(drill.martialAdvantage).toBe(true);

    const legate = spawnMonster(2, 3, () => 0, [LEGATE], qi, 'boss', true, true);
    expect(legate.martialAdvantage).toBe(true);

    /* and the rank and file do NOT have it — +2d6 on every body in a cohort
       that fights in formation would triple the floor's damage output. */
    const line = spawnMonster(0.5, 3, () => 0, ['hobgoblin-legionary'], qi, null, false, true);
    expect(line.martialAdvantage).toBeFalsy();
  });

  it('tags ironback as a tank at AC 18 and drillmaster as the elite', () => {
    expect(MONSTERS_BY_ID['hobgoblin-ironback'].ac).toBe(18);
    expect(MONSTERS_BY_ID['hobgoblin-ironback'].tags).toContain('tank');
    expect(MONSTERS_BY_ID['hobgoblin-drillmaster'].tags).toContain('elite');
  });

  it('leaves the existing SRD hobgoblins alone', () => {
    expect(MONSTERS_BY_ID['hobgoblin'].cr).toBe(0.5);
    expect(MONSTERS_BY_ID['hobgoblin'].dungeons).not.toContain('ancient');
    expect(MONSTERS_BY_ID['hobgoblin-captain'].cr).toBe(4);
    expect(MONSTERS_BY_ID['hobgoblin-warlord'].cr).toBe(7);
  });

  it('wires ancient-l3 to the legate with a mixed hobgoblin/goblin escort', () => {
    const enc = BOSS_ENCOUNTERS.find(e => e.id === 'ancient-l3');
    expect(enc.bossId).toBe(LEGATE);
    const escortIds = enc.escorts.map(e => e.id);
    expect(escortIds).toEqual(expect.arrayContaining([
      'hobgoblin-ironback', 'hobgoblin-legionary', 'hobgoblin-archer',
    ]));
    expect(escortIds.some(id => GOBLINS.includes(id))).toBe(true);
    expect(escortIds).not.toContain('gnoll');
  });

  it('never sets isBoss on any monster', () => {
    expect(MONSTERS_ALL.filter(m => m.isBoss)).toHaveLength(0);
  });
});
