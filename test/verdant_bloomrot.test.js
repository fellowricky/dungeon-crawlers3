import { describe, it, expect } from 'vitest';
import {
  spawnMonster, dungeonMonsterIds, MONSTERS_BY_ID,
} from '../src/game/srd.js';
import BOSS_ENCOUNTERS from '../src/game/boss_encounters.json' with { type: 'json' };
import { TYPE_IMMUNITIES } from '../src/game/conditions.js';

const FIELD = [
  'bloomrot-capfist', 'bloomrot-puffcap', 'bloomrot-sporespeaker',
  'bloomrot-bracketback', 'bloomrot-thrall',
];
const SOVEREIGN = 'bloomrot-sovereign';
const TIER2 = ['widowsilk-fang', 'widowsilk-slinger', 'widowsilk-weaver',
               'widowsilk-carapace', 'widowsilk-stalker'];

describe('verdant L3 Bloomrot', () => {
  it('fields five CR 1/2 creatures on verdant and keeps the Sovereign off the room roster', () => {
    const ids = dungeonMonsterIds('verdant');
    for (const id of FIELD) {
      expect(ids).toContain(id);
      const m = MONSTERS_BY_ID[id];
      expect(m.cr).toBe(0.5);
      expect(m.isBoss).toBeFalsy();
    }
    expect(ids).not.toContain(SOVEREIGN);
    const sov = MONSTERS_BY_ID[SOVEREIGN];
    expect(sov.cr).toBe(1);
    expect(sov.isBoss).toBeFalsy();
    expect(sov.dungeons).toEqual([]);
  });

  it('reaches every Bloomrot role at verdant level 3', () => {
    /* Reachability, not exclusivity: verdant's CR 1/2 band also carries the orc
       line, the swarms and several stock beasts, so this faction shares its rung
       rather than owning it. */
    const roster = dungeonMonsterIds('verdant');
    const qi = { dungeonLevel: 3, questFloor: 1, floors: 2 };
    const seen = new Set();
    for (let i = 0; i < 1200; i++) {
      const spec = spawnMonster(0.5, 3, Math.random, roster, qi);
      expect(spec.cr).toBe(0.5);
      if (FIELD.includes(spec.id)) seen.add(spec.id);
    }
    expect([...seen].sort()).toEqual([...FIELD].sort());
  });

  it('does not mix the tier-2 Widowsilk into the L3 CR window', () => {
    const roster = dungeonMonsterIds('verdant');
    const qi = { dungeonLevel: 3, questFloor: 1, floors: 2 };
    for (let i = 0; i < 40; i++) {
      const spec = spawnMonster(0.5, 3, Math.random, roster, qi);
      expect(TIER2).not.toContain(spec.id);
    }
  });

  it('delivers the Sporespeaker cantripClass through spawnMonster', () => {
    /* Read through spawnMonster, not monsters.json: its return object is an
       explicit projection, so a field can look correct in the JSON and never
       reach the runtime. */
    const spec = spawnMonster(0.5, 3, () => 0, ['bloomrot-sporespeaker'],
      { dungeonLevel: 3, questFloor: 1, floors: 2 }, 'caster', false, true);
    expect(spec.id).toBe('bloomrot-sporespeaker');
    expect(spec.cantripClass).toBe('druid');
    expect(spec.ranged).toBe(true);
  });

  it('keeps blanket condition immunity to the tank and the boss only', () => {
    /* conditions.js gives `plant` immunity to seven conditions and applyEffect
       checks it before anything else, so the type is a balance lever. Only the
       Bracketback and the Sovereign are meant to carry it - if the three fey
       myconids ever get retyped to plant, an entire level-3 roster stops
       responding to the party's control spells. */
    expect(TYPE_IMMUNITIES.plant).toContain('frightened');
    expect(MONSTERS_BY_ID['bloomrot-bracketback'].type).toBe('plant');
    expect(MONSTERS_BY_ID[SOVEREIGN].type).toBe('plant');
    for (const id of ['bloomrot-capfist', 'bloomrot-puffcap', 'bloomrot-sporespeaker']) {
      expect(MONSTERS_BY_ID[id].type).toBe('fey');
    }
    expect(MONSTERS_BY_ID['bloomrot-thrall'].type).toBe('undead');
  });

  it('authors each damage bonus so the statblock text matches what is rolled', () => {
    /* monsterAttack uses max(dmg[2], statMod), so an effStats value above the
       authored bonus silently raises real damage above the printed statblock. */
    for (const id of [...FIELD, SOVEREIGN]) {
      const m = MONSTERS_BY_ID[id];
      const statKey = m.ranged ? 'dex' : 'str';
      const statMod = Math.floor((m.effStats[statKey] - 10) / 2);
      expect(Math.max(m.dmg[2] ?? 0, statMod)).toBe(m.dmg[2] ?? 0);
    }
  });

  it('wires verdant-l3 to the Sovereign with Bloomrot escorts', () => {
    const enc = BOSS_ENCOUNTERS.find(e => e.id === 'verdant-l3');
    expect(enc).toBeDefined();
    expect(enc.bossId).toBe(SOVEREIGN);
    expect(enc.escorts.length).toBeGreaterThan(0);
    for (const esc of enc.escorts) {
      expect(FIELD).toContain(esc.id);
      expect(MONSTERS_BY_ID[esc.id]).toBeDefined();
    }
  });

  it('declares animation sheets with a cols count for every creature', () => {
    for (const id of [...FIELD, SOVEREIGN]) {
      const m = MONSTERS_BY_ID[id];
      for (const kind of ['idle', 'attack']) {
        const a = m.animations?.[kind];
        expect(a, `${id} ${kind}`).toBeDefined();
        expect(a.rows).toBe(1);
        expect(a.cols).toBeGreaterThan(1);
        expect(a.frameWidth).toBe(a.frameHeight);
        expect(a.sprite).toMatch(/^sprites\//);
      }
      expect(m.animations.idle.loop).toBe(true);
      expect(m.animations.attack.loop).toBe(false);
    }
  });
});
