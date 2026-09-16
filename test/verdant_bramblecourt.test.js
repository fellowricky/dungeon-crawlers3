import { describe, it, expect } from 'vitest';
import {
  spawnMonster, dungeonMonsterIds, MONSTERS_BY_ID,
} from '../src/game/srd.js';
import BOSS_ENCOUNTERS from '../src/game/boss_encounters.json' with { type: 'json' };
import { EFFECTS } from '../src/game/conditions.js';

const FIELD = [
  'bramblecourt-thornblade', 'bramblecourt-quillcast', 'bramblecourt-thistlewitch',
  'bramblecourt-heartwood', 'bramblecourt-wakethorn',
];
const WARDEN = 'bramblecourt-warden';
const TIER3 = ['bloomrot-capfist', 'bloomrot-puffcap', 'bloomrot-sporespeaker',
               'bloomrot-bracketback', 'bloomrot-thrall'];

describe('verdant L4 Bramblecourt', () => {
  it('fields five CR 1 fey on verdant and keeps the Warden off the room roster', () => {
    const ids = dungeonMonsterIds('verdant');
    for (const id of FIELD) {
      expect(ids).toContain(id);
      const m = MONSTERS_BY_ID[id];
      expect(m.cr).toBe(1);
      expect(m.type).toBe('fey');
      expect(m.isBoss).toBeFalsy();
    }
    expect(ids).not.toContain(WARDEN);
    const w = MONSTERS_BY_ID[WARDEN];
    expect(w.cr).toBe(2);
    expect(w.isBoss).toBeFalsy();
    expect(w.dungeons).toEqual([]);
  });

  it('reaches every Bramblecourt role at verdant level 4', () => {
    /* Reachability, not exclusivity: verdant's CR 1 band already carried
       seventeen creatures before this faction arrived. */
    const roster = dungeonMonsterIds('verdant');
    const qi = { dungeonLevel: 4, questFloor: 1, floors: 2 };
    const seen = new Set();
    for (let i = 0; i < 1600; i++) {
      const spec = spawnMonster(1, 4, Math.random, roster, qi);
      expect(spec.cr).toBe(1);
      if (FIELD.includes(spec.id)) seen.add(spec.id);
    }
    expect([...seen].sort()).toEqual([...FIELD].sort());
  });

  it('does not mix the tier-3 Bloomrot into the L4 CR window', () => {
    const roster = dungeonMonsterIds('verdant');
    const qi = { dungeonLevel: 4, questFloor: 1, floors: 2 };
    for (let i = 0; i < 40; i++) {
      const spec = spawnMonster(1, 4, Math.random, roster, qi);
      expect(TIER3).not.toContain(spec.id);
    }
  });

  it('delivers the Thistlewitch cantripClass through spawnMonster', () => {
    const spec = spawnMonster(1, 4, () => 0, ['bramblecourt-thistlewitch'],
      { dungeonLevel: 4, questFloor: 1, floors: 2 }, 'caster', false, true);
    expect(spec.id).toBe('bramblecourt-thistlewitch');
    expect(spec.cantripClass).toBe('warlock');
    expect(spec.ranged).toBe(true);
  });

  it('carries the spriggan swell as a real condition, not an invented one', () => {
    /* The faction signature is `enlarged`, an existing hero buff, so it needs no
       engine change. A typo here would fail silently: applyEffect returns false
       for an unknown key and nothing else complains. */
    expect(EFFECTS.enlarged).toBeDefined();
    const wake = MONSTERS_BY_ID['bramblecourt-wakethorn'].abilities
      .find(a => a.trigger === 'onBloodied');
    expect(wake.buff.key).toBe('enlarged');
    const warden = MONSTERS_BY_ID[WARDEN].abilities.find(a => a.key === 'grow-vast');
    expect(warden.buff.key).toBe('enlarged');
    expect(warden.maxUses).toBe(2);
  });

  it('reaches the runtime with abilities intact through spawnMonster', () => {
    for (const id of [...FIELD, WARDEN]) {
      const raw = MONSTERS_BY_ID[id];
      if (!raw.abilities) continue;
      const spec = spawnMonster(raw.cr, 4, () => 0, [id],
        { dungeonLevel: 4, questFloor: 1, floors: 2 }, null, false, true);
      expect(spec.abilities, id).toBeDefined();
      expect(spec.abilities.length).toBe(raw.abilities.length);
      for (const a of spec.abilities) {
        if (a.effect) expect(EFFECTS[a.effect.key], `${id}/${a.key}`).toBeDefined();
        if (a.buff) expect(EFFECTS[a.buff.key ?? a.buff], `${id}/${a.key}`).toBeDefined();
      }
    }
  });

  it('authors each damage bonus so the statblock text matches what is rolled', () => {
    for (const id of [...FIELD, WARDEN]) {
      const m = MONSTERS_BY_ID[id];
      const statKey = m.ranged ? 'dex' : 'str';
      const statMod = Math.floor((m.effStats[statKey] - 10) / 2);
      expect(Math.max(m.dmg[2] ?? 0, statMod)).toBe(m.dmg[2] ?? 0);
    }
  });

  it('wires verdant-l4 to the Warden with Bramblecourt escorts', () => {
    const enc = BOSS_ENCOUNTERS.find(e => e.id === 'verdant-l4');
    expect(enc).toBeDefined();
    expect(enc.bossId).toBe(WARDEN);
    expect(enc.escorts.length).toBeGreaterThan(0);
    for (const esc of enc.escorts) {
      expect(FIELD).toContain(esc.id);
      expect(MONSTERS_BY_ID[esc.id]).toBeDefined();
    }
  });

  it('declares animation sheets with a cols count for every creature', () => {
    for (const id of [...FIELD, WARDEN]) {
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
