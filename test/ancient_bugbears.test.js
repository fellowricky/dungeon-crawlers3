import { describe, it, expect } from 'vitest';
import {
  spawnMonster, dungeonMonsterIds, MONSTERS_BY_ID, MONSTERS_ALL,
} from '../src/game/srd.js';
import BOSS_ENCOUNTERS from '../src/game/boss_encounters.json' with { type: 'json' };

const FIELD = [
  'bugbear-maul', 'bugbear-javelin', 'bugbear-bonespeaker',
  'bugbear-hidebound', 'bugbear-throatcutter',
];
const GHAUR = 'bugbear-warlord';
const HOBGOBLINS = [
  'hobgoblin-legionary', 'hobgoblin-archer', 'hobgoblin-devastator',
  'hobgoblin-ironback', 'hobgoblin-drillmaster',
];

describe('ancient L4 Black-Maul bugbears', () => {
  it('fields five CR 1 bugbears on ancient and keeps Ghaur off the room roster', () => {
    const ids = dungeonMonsterIds('ancient');
    for (const id of FIELD) {
      expect(ids).toContain(id);
      const m = MONSTERS_BY_ID[id];
      expect(m.cr).toBe(1);
      expect(m.isBoss).toBeFalsy();
    }
    expect(ids).not.toContain(GHAUR);
    const ghaur = MONSTERS_BY_ID[GHAUR];
    expect(ghaur.cr).toBe(3);
    expect(ghaur.isBoss).toBeFalsy();
    expect(ghaur.dungeons).toEqual([]);
  });

  /* The whole reason this faction exists: ancient's CR 1 rung was EMPTY, so a
     level-4 slot found no exact match, stepped down, and fielded level 3's CR
     1/2 hobgoblins while the room was charged level-4 prices (budgetMult 3.2 vs
     1.35). Every other biome carries 11-18 creatures at CR 1. */
  it('fills the CR 1 rung that was empty on ancient', () => {
    const ids = dungeonMonsterIds('ancient');
    const atOne = ids.filter(id => MONSTERS_BY_ID[id].cr === 1);
    expect(atOne.length).toBeGreaterThan(0);
    expect(atOne.sort()).toEqual([...FIELD].sort());
  });

  it('spawns only Black-Maul bugbears at ancient level 4', () => {
    const roster = dungeonMonsterIds('ancient');
    const qi = { dungeonLevel: 4, questFloor: 1, floors: 4 };
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const spec = spawnMonster(1, 4, Math.random, roster, qi);
      seen.add(spec.id);
      expect(spec.cr).toBe(1);
      expect(FIELD).toContain(spec.id);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  /* Level 4 keeps the same mixing behaviour level 3 has: an ordinary slot buys
     a CR 1 bugbear, a minion/guard slot (crOffset -1 => 1 * 0.6 = 0.6) has no
     exact match and steps down to the dearest rung at or below, the CR 1/2
     Red-Banner hobgoblins. So L4 reads as bugbears commanding hobgoblins. */
  it('steps down to the L3 hobgoblins for the -1 crOffset minion slots', () => {
    const roster = dungeonMonsterIds('ancient');
    const qi = { dungeonLevel: 4, questFloor: 1, floors: 4 };
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const spec = spawnMonster(1 * 0.6, 4, Math.random, roster, qi, 'minion');
      seen.add(spec.id);
      expect(HOBGOBLINS).toContain(spec.id);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('delivers the bonespeaker cantrip fields through spawnMonster', () => {
    const spec = spawnMonster(1, 4, () => 0,
      ['bugbear-bonespeaker'], { dungeonLevel: 4, questFloor: 1, floors: 4 }, 'caster', false, true);
    expect(spec.id).toBe('bugbear-bonespeaker');
    expect(spec.cantripClass).toBe('sorcerer');
    expect(spec.rangedDmgType).toBe('necrotic');
    expect(spec.ranged).toBe(true);
    expect(spec.abilities?.some(a => a.key === 'bone-curse')).toBe(true);
  });

  /* Ghaur's ground-smash both damages and knocks prone. `half` has to sit
     INSIDE `save` -- _resolveAbilityOnHero reads fx.save.half, and a top-level
     `half` is silently ignored, turning save-for-half into save-for-nothing. */
  it('gives Ghaur a save-for-half smash with the half flag in the right place', () => {
    const spec = spawnMonster(3, 4, () => 0,
      [GHAUR], { dungeonLevel: 4, questFloor: 1, floors: 4 }, 'boss', true, true);
    expect(spec.id).toBe(GHAUR);
    const smash = spec.abilities.find(a => a.key === 'sunder-the-floor');
    expect(smash.save.half).toBe(true);
    expect(smash.half).toBeUndefined();
    expect(smash.dice).toEqual([2, 6, 0]);
    expect(smash.effect.key).toBe('prone');
  });

  /* Every previous ancient boss ends with onBloodied -> bloodlust. */
  it('does not reuse the bloodlust rider a fourth time', () => {
    const ghaur = MONSTERS_BY_ID[GHAUR];
    const bloodied = ghaur.abilities.find(a => a.trigger === 'onBloodied');
    expect(bloodied.buff.key).toBe('enlarged');
    for (const prev of ['kobold-chief', 'goblin-warchief', 'hobgoblin-legate']) {
      const m = MONSTERS_BY_ID[prev];
      expect(m.abilities.some(a => a.trigger === 'onBloodied')).toBe(true);
    }
  });

  it('completes the goblinoid ladder across ancient L1-L4', () => {
    const rung = cr => dungeonMonsterIds('ancient')
      .filter(id => MONSTERS_BY_ID[id].cr === cr && MONSTERS_BY_ID[id].statblock?.source);
    expect(rung(0.125).some(id => id.startsWith('kobold-'))).toBe(true);
    expect(rung(0.25).some(id => id.startsWith('goblin-'))).toBe(true);
    expect(rung(0.5).some(id => id.startsWith('hobgoblin-'))).toBe(true);
    expect(rung(1).some(id => id.startsWith('bugbear-'))).toBe(true);
  });

  it('leaves the SRD bugbear placeholder alone', () => {
    const srd = MONSTERS_BY_ID['bugbear'];
    expect(srd.cr).toBe(1);
    expect(srd.dungeons).not.toContain('ancient');
    expect(srd.statblock?.source).not.toBe('black-maul');
  });

  it('wires ancient-l4 to Ghaur with one escort from each caste', () => {
    const enc = BOSS_ENCOUNTERS.find(e => e.id === 'ancient-l4');
    expect(enc.bossId).toBe(GHAUR);
    const ids = enc.escorts.map(e => e.id);
    expect(ids.some(id => id.startsWith('bugbear-'))).toBe(true);
    expect(ids.some(id => id.startsWith('hobgoblin-'))).toBe(true);
    expect(ids.some(id => id.startsWith('goblin-'))).toBe(true);
    expect(ids).not.toContain('gargoyle');
    expect(enc.bossId).not.toBe('stone-giant');
  });

  it('never sets isBoss on any monster', () => {
    expect(MONSTERS_ALL.filter(m => m.isBoss)).toHaveLength(0);
  });
});
