import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnMonster, dungeonMonsterIds, MONSTERS_BY_ID, MONSTERS_ALL } from '../src/game/srd.js';

/* The overland set (Oct 2026): wanderers for the nine overland biomes plus the
   bandit gang. Placement and CR come from docs/OVERLAND_ROSTER.xlsx via
   scratch/ov_records.py; these pin what the game must actually do with them. */
const OVERLAND = ['moor', 'forest', 'mire', 'holdfast', 'boneyard', 'ruinfield', 'ashfield', 'snowfield', 'sporewood'];
const SET = MONSTERS_ALL.filter(m => m.statblock?.source === 'overland');
const BANDITS = SET.filter(m => m.tags.includes('bandit') && m.type === 'humanoid');
const QI = { dungeonLevel: 1, questFloor: 1, floors: 3 };

describe('overland roster', () => {
  it('ships the whole set', () => {
    expect(SET.length).toBe(40);
    expect(BANDITS.length).toBe(13);
  });

  it('spreads across the first six dungeon levels (CR 0 .. 3)', () => {
    for (const m of SET) expect([0, 0.125, 0.25, 0.5, 1, 2, 3]).toContain(m.cr);
  });

  it('places the set on overland biomes only, never in a dungeon theme', () => {
    for (const m of SET) {
      expect(m.dungeons.length).toBeGreaterThan(0);
      for (const d of m.dungeons) expect(OVERLAND).toContain(d);
    }
  });

  it('lets the bandit gang roam every overland biome', () => {
    for (const b of OVERLAND) {
      const ids = dungeonMonsterIds(b);
      for (const m of BANDITS) expect(ids).toContain(m.id);
    }
  });

  it('puts the bullywug tribe in the mire and the sporewood', () => {
    for (const m of SET.filter(x => x.tags.includes('bullywug'))) {
      expect(dungeonMonsterIds('mire')).toContain(m.id);
      expect(dungeonMonsterIds('sporewood')).toContain(m.id);
    }
  });

  it('never carries isBoss', () => {
    for (const m of SET) expect(m.isBoss).toBeFalsy();
  });

  it('keeps speed and speedFt in step on whole 5 ft boundaries', () => {
    for (const m of SET) {
      expect(m.speedFt % 5).toBe(0);
      expect(m.speedFt).toBe(Math.round(m.speed * 10));
      expect(m.speed).toBeGreaterThan(0);              // zero-speed-monsters
    }
  });

  it('points every animation at a sheet that exists with the right column count', () => {
    for (const m of SET) {
      for (const kind of ['idle', 'attack']) {
        const a = m.animations[kind];
        const file = path.join('public', a.sprite);
        expect(fs.existsSync(file), file).toBe(true);
        const buf = fs.readFileSync(file);
        const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);   // PNG IHDR
        expect(h).toBe(a.frameHeight);
        expect(w / h).toBe(a.cols);
      }
      expect(m.animations.idle.loop).toBe(true);
      expect(m.animations.attack.loop).toBe(false);
    }
  });

  /* spawnMonster projects spec field by field; only spawning proves a field arrives. */
  it('delivers caster, ranged, flying and regen fields through spawnMonster', () => {
    const spawn = id => spawnMonster(MONSTERS_BY_ID[id].cr, 1, () => 0, [id], QI, null, true, true);
    expect(spawn('bandit-hexer').cantripClass).toBe('warlock');
    expect(spawn('bandit-hedge-mage').cantripClass).toBe('wizard');
    expect(spawn('bullywug-croaker').cantripClass).toBe('druid');
    const archer = spawn('bandit-archer');
    expect(archer.ranged).toBe(true);
    expect(archer.rangedDmgType).toBe('piercing');
    for (const id of ['blood-hawk', 'peryton', 'banshee', 'gas-spore']) expect(spawn(id).tags).toContain('flying');
    expect(spawn('revenant').regen).toBe(3);
    expect(spawn('gas-spore').abilities.some(a => a.trigger === 'onDeath')).toBe(true);
  });

  it('only fields CR 1/8 and below at level 1 on the holdfast road', () => {
    const roster = dungeonMonsterIds('holdfast');
    for (let i = 0; i < 40; i++) {
      expect(spawnMonster(0.125, 1, Math.random, roster, QI).cr).toBeLessThanOrEqual(0.125);
    }
  });
});
