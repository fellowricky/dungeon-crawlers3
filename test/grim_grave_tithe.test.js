import { describe, it, expect } from 'vitest';
import {
  spawnMonster, dungeonMonsterIds, MONSTERS_BY_ID, MONSTERS_ALL,
} from '../src/game/srd.js';
import BOSS_ENCOUNTERS from '../src/game/boss_encounters.json' with { type: 'json' };

const FIELD = ['tithe-taker', 'nail-marker', 'tithe-confessor', 'iron-penitent', 'tithe-flagellant'];
const MOTHER = 'mother-vellum';
const GRIMHOST_L1 = ['skeletal-swordsman', 'skeletal-bowman', 'skeletal-bulwark', 'cultist'];

describe('grim L2 Grave-Tithe', () => {
  it('fields five CR 1/4 cultists on grim and keeps Mother Vellum off the room roster', () => {
    const ids = dungeonMonsterIds('grim');
    for (const id of FIELD) {
      expect(ids).toContain(id);
      const m = MONSTERS_BY_ID[id];
      expect(m.cr).toBe(0.25);
      expect(m.isBoss).toBeFalsy();
    }
    expect(ids).not.toContain(MOTHER);
    const mother = MONSTERS_BY_ID[MOTHER];
    expect(mother.cr).toBe(1);
    expect(mother.isBoss).toBeFalsy();
    expect(mother.dungeons).toEqual([]);
  });

  it('reaches every Grave-Tithe role at grim level 2', () => {
    /* NOT an exclusivity check, unlike ancient_goblins.test.js. Ancient's CR 1/4
       band was curated down to exactly the five Nail-Crown goblins; grim's still
       carries seven stock SRD leftovers (skeleton, zombie, skeletal-warrior,
       titan-skeleton, wolf-spider, swarm-of-rats, swarm-of-bats), so the
       Grave-Tithe is only ~5/12 of the band. Tighten this to match ancient once
       that band is pruned. */
    const roster = dungeonMonsterIds('grim');
    const qi = { dungeonLevel: 2, questFloor: 1, floors: 2 };
    const seen = new Set();
    for (let i = 0; i < 400; i++) {
      const spec = spawnMonster(0.25, 2, Math.random, roster, qi);
      expect(spec.cr).toBe(0.25);
      if (FIELD.includes(spec.id)) seen.add(spec.id);
    }
    expect([...seen].sort()).toEqual([...FIELD].sort());
  });

  it('does not mix the L1 grimhost into the L2 CR window', () => {
    const roster = dungeonMonsterIds('grim');
    const qi = { dungeonLevel: 2, questFloor: 1, floors: 2 };
    for (let i = 0; i < 20; i++) {
      const spec = spawnMonster(0.25, 2, Math.random, roster, qi);
      expect(GRIMHOST_L1).not.toContain(spec.id);
    }
  });

  it('delivers the confessor cantripClass through spawnMonster', () => {
    /* Read through spawnMonster, not monsters.json: its return object is an
       explicit projection, so a field can look correct in the JSON and never
       reach the runtime. */
    const spec = spawnMonster(0.25, 2, () => 0,
      ['tithe-confessor'], { dungeonLevel: 2, questFloor: 1, floors: 2 }, 'caster', false, true);
    expect(spec.id).toBe('tithe-confessor');
    expect(spec.cantripClass).toBe('cleric');
    expect(spec.rangedDmgType).toBe('necrotic');
    expect(spec.ranged).toBe(true);
    expect(spec.abilities?.some(a => a.key === 'ray-of-sickness')).toBe(true);
  });

  it('delivers authored speedFt through spawnMonster instead of back-deriving it', () => {
    const qi = { dungeonLevel: 2, questFloor: 1, floors: 2 };
    const want = {
      'tithe-taker': 30, 'nail-marker': 30, 'tithe-confessor': 30,
      'iron-penitent': 25, 'tithe-flagellant': 35,
    };
    for (const [id, ft] of Object.entries(want)) {
      const spec = spawnMonster(0.25, 2, () => 0, [id], qi, null, false, true);
      expect(spec.id).toBe(id);
      expect(spec.speedFt).toBe(ft);
      /* speed is authored as speedFt/10, which inverts srd.js's derivation
         exactly — so the two agree rather than the grid rate being a rounding
         artifact of the real-time rate. */
      expect(Math.round((spec.speed * 10) / 5) * 5).toBe(ft);
    }
  });

  it('tags the iron penitent as a tank at AC 15 and the flagellant as the elite', () => {
    const pen = MONSTERS_BY_ID['iron-penitent'];
    expect(pen.ac).toBeGreaterThanOrEqual(14);
    expect(pen.tags).toContain('tank');

    const flag = MONSTERS_BY_ID['tithe-flagellant'];
    expect(flag.tags).toContain('elite');
    expect(flag.abilities?.some(a => a.trigger === 'onBloodied')).toBe(true);
  });

  it('gives every Grave-Tithe creature a complete 19-frame idle and attack atlas', () => {
    for (const id of [...FIELD, MOTHER]) {
      const m = MONSTERS_BY_ID[id];
      for (const kind of ['idle', 'attack']) {
        const a = m.animations?.[kind];
        expect(a, `${id} ${kind}`).toBeTruthy();
        expect(a.cols).toBe(19);
        expect(a.rows).toBe(1);
        expect(a.frameWidth).toBe(a.frameHeight);
        expect(a.sprite).toMatch(/^sprites\/.+\/(Idle|Attack)\/.+\.png$/);
      }
      expect(m.animations.idle.loop).toBe(true);
      expect(m.animations.attack.loop).toBe(false);
    }
  });

  it('wires grim-l2 to Mother Vellum and Grave-Tithe escorts', () => {
    const enc = BOSS_ENCOUNTERS.find(e => e.id === 'grim-l2');
    expect(enc.bossId).toBe(MOTHER);
    const escortIds = enc.escorts.map(e => e.id);
    expect(escortIds).toEqual(expect.arrayContaining([
      'iron-penitent', 'tithe-taker', 'nail-marker', 'tithe-confessor',
    ]));
    /* the stock SRD placeholder this replaced */
    expect(escortIds).not.toContain('zombie');
  });

  it('never sets isBoss on any monster', () => {
    expect(MONSTERS_ALL.filter(m => m.isBoss)).toHaveLength(0);
  });
});
