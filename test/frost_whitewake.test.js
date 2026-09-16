import { describe, it, expect } from 'vitest';
import {
  spawnMonster, dungeonMonsterIds, MONSTERS_BY_ID, getThemeForMonster,
} from '../src/game/srd.js';
import BOSS_ENCOUNTERS from '../src/game/boss_encounters.json' with { type: 'json' };
import { EFFECTS } from '../src/game/conditions.js';

const FIELD = [
  'whitewake-icebreaker', 'whitewake-spearcaster', 'whitewake-wolfspeaker',
  'whitewake-hearthguard', 'whitewake-snowfang',
];
const MOTHER = 'whitewake-white-mother';

describe('frost L2 Whitewake', () => {
  it('fields five CR 1/4 creatures on frost and keeps the White Mother off the room roster', () => {
    const ids = dungeonMonsterIds('frost');
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

  it('closes the CR 1/4 hole that left frost level 2 with a single creature', () => {
    /* Before this faction, frost's entire CR 1/4 band was one entry - `wolf` -
       so every level-2 room fielded the same animal up to the species cap. This
       asserts the band is genuinely populated now, which is the whole point of
       building the tier. */
    const band = dungeonMonsterIds('frost')
      .map(id => MONSTERS_BY_ID[id])
      .filter(m => m && m.cr === 0.25);
    expect(band.length).toBeGreaterThanOrEqual(6);
    expect(band.filter(m => m.animations?.idle).length).toBeGreaterThanOrEqual(5);
  });

  it('reaches every Whitewake role at frost level 2', () => {
    const roster = dungeonMonsterIds('frost');
    const qi = { dungeonLevel: 2, questFloor: 1, floors: 2 };
    const seen = new Set();
    for (let i = 0; i < 800; i++) {
      const spec = spawnMonster(0.25, 2, Math.random, roster, qi);
      expect(spec.cr).toBe(0.25);
      if (FIELD.includes(spec.id)) seen.add(spec.id);
    }
    expect([...seen].sort()).toEqual([...FIELD].sort());
  });

  it('keeps the hunters and the wolves in one vibe family', () => {
    /* getThemeForMonster has no bucket for an ordinary human tribe, so without an
       explicit `theme` the wolves would sort to Beasts and the hunters elsewhere,
       and pickRoomSpecies would stop drawing them into the same room. */
    for (const id of [...FIELD, MOTHER]) {
      expect(getThemeForMonster(MONSTERS_BY_ID[id]), id).toBe('Beasts');
    }
  });

  it('delivers the Wolf-Speaker cantripClass through spawnMonster', () => {
    const spec = spawnMonster(0.25, 2, () => 0, ['whitewake-wolfspeaker'],
      { dungeonLevel: 2, questFloor: 1, floors: 2 }, 'caster', false, true);
    expect(spec.id).toBe('whitewake-wolfspeaker');
    expect(spec.cantripClass).toBe('artificer');
    expect(spec.rangedDmgType).toBe('cold');
    expect(spec.ranged).toBe(true);
  });

  it('carries pack tactics through to the runtime on the hunt-minded members', () => {
    for (const id of ['whitewake-icebreaker', 'whitewake-snowfang', MOTHER]) {
      const raw = MONSTERS_BY_ID[id];
      const spec = spawnMonster(raw.cr, 2, () => 0, [id],
        { dungeonLevel: 2, questFloor: 1, floors: 2 }, null, false, true);
      expect(spec.packTactics, id).toBe(true);
    }
  });

  it('reaches the runtime with abilities intact and real effect keys', () => {
    for (const id of [...FIELD, MOTHER]) {
      const raw = MONSTERS_BY_ID[id];
      if (!raw.abilities) continue;
      const spec = spawnMonster(raw.cr, 2, () => 0, [id],
        { dungeonLevel: 2, questFloor: 1, floors: 2 }, null, false, true);
      expect(spec.abilities, id).toBeDefined();
      expect(spec.abilities.length).toBe(raw.abilities.length);
      for (const a of spec.abilities) {
        if (a.effect) expect(EFFECTS[a.effect.key], `${id}/${a.key}`).toBeDefined();
        if (a.buff) expect(EFFECTS[a.buff.key ?? a.buff], `${id}/${a.key}`).toBeDefined();
      }
    }
  });

  it('authors each damage bonus so the statblock text matches what is rolled', () => {
    for (const id of [...FIELD, MOTHER]) {
      const m = MONSTERS_BY_ID[id];
      const statKey = m.ranged ? 'dex' : 'str';
      const statMod = Math.floor((m.effStats[statKey] - 10) / 2);
      expect(Math.max(m.dmg[2] ?? 0, statMod)).toBe(m.dmg[2] ?? 0);
    }
  });

  it('wires frost-l2 to the White Mother with Whitewake escorts at the level CR', () => {
    const enc = BOSS_ENCOUNTERS.find(e => e.id === 'frost-l2');
    expect(enc).toBeDefined();
    expect(enc.bossId).toBe(MOTHER);
    /* the stock encounter asked for targetCR 1.5 on a level anchored at 0.25 */
    expect(enc.targetCR).toBeLessThanOrEqual(1);
    for (const esc of enc.escorts) {
      expect(FIELD).toContain(esc.id);
      expect(MONSTERS_BY_ID[esc.id]).toBeDefined();
    }
  });

  it('declares animation sheets with a cols count for every creature', () => {
    for (const id of [...FIELD, MOTHER]) {
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
