import { describe, it, expect } from 'vitest';
import {
  spawnMonster, dungeonMonsterIds, MONSTERS_BY_ID, MONSTERS_ALL,
} from '../src/game/srd.js';
import BOSS_ENCOUNTERS from '../src/game/boss_encounters.json' with { type: 'json' };

const FIELD = ['risen-drudge', 'gorebloat', 'harvest-necromancer', 'gravebound', 'carrion-ghoul'];
const SARKOTH = 'sarkoth';
const TIER2 = ['tithe-taker', 'nail-marker', 'tithe-confessor', 'iron-penitent', 'tithe-flagellant'];

describe('grim L3 Pale Harvest', () => {
  it('fields five CR 1/2 undead on grim and keeps Sarkoth off the room roster', () => {
    const ids = dungeonMonsterIds('grim');
    for (const id of FIELD) {
      expect(ids).toContain(id);
      const m = MONSTERS_BY_ID[id];
      expect(m.cr).toBe(0.5);
      expect(m.isBoss).toBeFalsy();
    }
    expect(ids).not.toContain(SARKOTH);
    const sarkoth = MONSTERS_BY_ID[SARKOTH];
    expect(sarkoth.cr).toBe(2);
    expect(sarkoth.isBoss).toBeFalsy();
    expect(sarkoth.dungeons).toEqual([]);
  });

  it('reaches every Pale Harvest role at grim level 3', () => {
    /* Kept as a reachability check rather than an exclusivity one. The original
       comment here claimed grim's CR 1/2 band carried seven stock SRD leftovers;
       that was wrong. Those creatures (wolf-spider, swarm-of-rats et al) have
       dungeons: [], which monsterSpawnsIn treats as "never spawns in a themed
       room" (srd.js:1084). The band is exactly these five, so this could be
       tightened to an exclusivity check if that ever seems worth it. */
    const roster = dungeonMonsterIds('grim');
    const qi = { dungeonLevel: 3, questFloor: 1, floors: 2 };
    const seen = new Set();
    for (let i = 0; i < 400; i++) {
      const spec = spawnMonster(0.5, 3, Math.random, roster, qi);
      expect(spec.cr).toBe(0.5);
      if (FIELD.includes(spec.id)) seen.add(spec.id);
    }
    expect([...seen].sort()).toEqual([...FIELD].sort());
  });

  it('does not mix the tier-2 Grave-Tithe into the L3 CR window', () => {
    const roster = dungeonMonsterIds('grim');
    const qi = { dungeonLevel: 3, questFloor: 1, floors: 2 };
    for (let i = 0; i < 20; i++) {
      const spec = spawnMonster(0.5, 3, Math.random, roster, qi);
      expect(TIER2).not.toContain(spec.id);
    }
  });

  it('delivers the confessor cantripClass through spawnMonster', () => {
    /* Read through spawnMonster, not monsters.json: its return object is an
       explicit projection, so a field can look correct in the JSON and never
       reach the runtime. */
    const spec = spawnMonster(0.5, 3, () => 0,
      ['harvest-necromancer'], { dungeonLevel: 3, questFloor: 1, floors: 2 }, 'caster', false, true);
    expect(spec.id).toBe('harvest-necromancer');
    /* Chill Touch is the sorcerer cantrip. cantripClass picks BOTH the VFX
       (CANTRIP_FX) and the save ability (wizard = DEX/Fire Bolt, sorcerer =
       CON/Chill Touch), so 'wizard' here fired a firebolt off a necrotic
       cantrip and rolled the wrong save. */
    expect(spec.cantripClass).toBe('sorcerer');
    expect(spec.rangedDmgType).toBe('necrotic');
    expect(spec.ranged).toBe(true);
    expect(spec.abilities?.some(a => a.key === 'ray-of-enfeeblement')).toBe(true);
  });

  it('delivers authored speedFt through spawnMonster instead of back-deriving it', () => {
    const qi = { dungeonLevel: 3, questFloor: 1, floors: 2 };
    const want = {
      'risen-drudge': 20, 'gorebloat': 20, 'harvest-necromancer': 30,
      'gravebound': 20, 'carrion-ghoul': 35,
    };
    for (const [id, ft] of Object.entries(want)) {
      const spec = spawnMonster(0.5, 3, () => 0, [id], qi, null, false, true);
      expect(spec.id).toBe(id);
      expect(spec.speedFt).toBe(ft);
      /* speed is authored as speedFt/10, which inverts srd.js's derivation
         exactly — so the two agree rather than the grid rate being a rounding
         artifact of the real-time rate. */
      expect(Math.round((spec.speed * 10) / 5) * 5).toBe(ft);
    }
  });

  it('tags the gravebound as a tank at AC 16 and the ghoul as the elite', () => {
    const pen = MONSTERS_BY_ID['gravebound'];
    expect(pen.ac).toBeGreaterThanOrEqual(14);
    expect(pen.tags).toContain('tank');

    const flag = MONSTERS_BY_ID['carrion-ghoul'];
    expect(flag.tags).toContain('elite');
    expect(flag.abilities?.some(a => a.trigger === 'onHit')).toBe(true);
    expect(flag.attacksPerTurn).toBe(2);
  });

  it('gives every Pale Harvest creature a complete 19-frame idle and attack atlas', () => {
    for (const id of [...FIELD, SARKOTH]) {
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

  it('wires grim-l3 to Sarkoth and Pale Harvest escorts', () => {
    const enc = BOSS_ENCOUNTERS.find(e => e.id === 'grim-l3');
    expect(enc.bossId).toBe(SARKOTH);
    const escortIds = enc.escorts.map(e => e.id);
    expect(escortIds).toEqual(expect.arrayContaining([
      'gravebound', 'risen-drudge', 'gorebloat', 'carrion-ghoul',
    ]));
    /* the stock SRD placeholder this replaced (specter + 3 shadows) */
    expect(escortIds).not.toContain('shadow');
  });

  it('never sets isBoss on any monster', () => {
    expect(MONSTERS_ALL.filter(m => m.isBoss)).toHaveLength(0);
  });
});
