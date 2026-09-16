import { describe, it, expect } from 'vitest';
import {
  spawnMonster, dungeonMonsterIds, MONSTERS_BY_ID, MONSTERS_ALL,
} from '../src/game/srd.js';
import BOSS_ENCOUNTERS from '../src/game/boss_encounters.json' with { type: 'json' };

const FIELD = ['cairnsworn', 'greenmail', 'ashen-archer', 'torcbearer', 'grave-hollow'];
const HALD = 'hald';
const TIER4 = ['suture-thing', 'hook-hauler', 'bonesaw-acolyte', 'tallowclad', 'sluiceborn'];

describe('grim L5 The Unrelieved', () => {
  it('fields five CR 2 undead on grim and keeps Hald off the room roster', () => {
    const ids = dungeonMonsterIds('grim');
    for (const id of FIELD) {
      expect(ids).toContain(id);
      const m = MONSTERS_BY_ID[id];
      expect(m.cr).toBe(2);
      expect(m.type).toBe('undead');
      expect(m.isBoss).toBeFalsy();
    }
    expect(ids).not.toContain(HALD);
    const hald = MONSTERS_BY_ID[HALD];
    expect(hald.cr).toBe(3);
    expect(hald.isBoss).toBeFalsy();
    expect(hald.dungeons).toEqual([]);
  });

  it('reaches every Unrelieved role at grim level 5', () => {
    /* NOT an exclusivity check: grim's CR 2 band still carries fifteen stock SRD
       creatures (gelatinous-cube, mimic, gibbering-mouther, azer, will-o-wisp
       and friends), so the Unrelieved is only ~5/20 of the band. Tighten this to
       match ancient once that band is pruned. */
    const roster = dungeonMonsterIds('grim');
    const qi = { dungeonLevel: 5, questFloor: 1, floors: 2 };
    const seen = new Set();
    for (let i = 0; i < 600; i++) {
      const spec = spawnMonster(2, 5, Math.random, roster, qi);
      expect(spec.cr).toBe(2);
      if (FIELD.includes(spec.id)) seen.add(spec.id);
    }
    expect([...seen].sort()).toEqual([...FIELD].sort());
  });

  it('does not mix the tier-4 Chirurgeon\'s Ward into the L5 CR window', () => {
    const roster = dungeonMonsterIds('grim');
    const qi = { dungeonLevel: 5, questFloor: 1, floors: 2 };
    for (let i = 0; i < 20; i++) {
      const spec = spawnMonster(2, 5, Math.random, roster, qi);
      expect(TIER4).not.toContain(spec.id);
    }
  });

  it('gives the archer a real weapon attack rather than a cantrip', () => {
    /* The point of this creature: tiers 2-4 put every ranged attack on a
       spellcaster, so grim had no plain archer. Read through spawnMonster, whose
       return object is an explicit whitelist. */
    const spec = spawnMonster(2, 5, () => 0, ['ashen-archer'],
      { dungeonLevel: 5, questFloor: 1, floors: 2 }, null, false, true);
    expect(spec.id).toBe('ashen-archer');
    expect(spec.ranged).toBe(true);
    expect(spec.rngRange).toBe(8);
    expect(spec.rangedDmgType).toBe('piercing');
    expect(spec.cantripClass).toBeFalsy();
  });

  it('delivers authored speedFt through spawnMonster instead of back-deriving it', () => {
    const qi = { dungeonLevel: 5, questFloor: 1, floors: 2 };
    const want = {
      cairnsworn: 30, greenmail: 20, 'ashen-archer': 30,
      torcbearer: 30, 'grave-hollow': 35,
    };
    for (const [id, ft] of Object.entries(want)) {
      const spec = spawnMonster(2, 5, () => 0, [id], qi, null, false, true);
      expect(spec.id).toBe(id);
      expect(spec.speedFt).toBe(ft);
      /* speed is authored as speedFt/10, which inverts srd.js's derivation
         exactly, so the two agree rather than the grid rate being a rounding
         artifact of the real-time rate. */
      expect(Math.round((spec.speed * 10) / 5) * 5).toBe(ft);
    }
  });

  it('carries the faction\'s riders through to runtime in the stock shapes', () => {
    const qi = { dungeonLevel: 5, questFloor: 1, floors: 2 };

    /* Grave-Hollow uses the same life-drain schema as the stock wight and
       specter - drainHp lives ON the effect, not beside it. */
    const gh = spawnMonster(2, 5, () => 0, ['grave-hollow'], qi, null, false, true);
    const drain = gh.abilities?.find(a => a.key === 'lifeDrain');
    expect(drain.trigger).toBe('onHit');
    expect(drain.effect.key).toBe('drained');
    expect(drain.effect.drainHp).toBe(5);
    expect(MONSTERS_BY_ID['wight'].abilities[0].effect.drainHp).toBe(drain.effect.drainHp);

    /* Greenmail's corrosion persists until a rest, so a duration on it would
       quietly defang the creature. */
    const gm = spawnMonster(2, 5, () => 0, ['greenmail'], qi, null, false, true);
    const corr = gm.abilities?.find(a => a.key === 'verdigris-bite');
    expect(corr.effect.key).toBe('corroded');
    expect(corr.effect.dur).toBeUndefined();

    /* Torcbearer is the fear caster; the AoE is what makes it one. */
    const tb = spawnMonster(2, 5, () => 0, ['torcbearer'], qi, null, false, true);
    const fear = tb.abilities?.find(a => a.key === 'the-old-authority');
    expect(fear.trigger).toBe('cycle');
    expect(fear.effect.key).toBe('frightened');
    expect(fear.aoe).toBeGreaterThan(0);
  });

  it('tags greenmail as the tank at AC 18 and cairnsworn as the two-attack line', () => {
    const tank = MONSTERS_BY_ID['greenmail'];
    expect(tank.ac).toBeGreaterThanOrEqual(17);
    expect(tank.tags).toContain('tank');

    /* Cairnsworn's identity is two attacks and no ability, as with the tier-4
       Suture-Thing and the tier-3 Risen Drudge. */
    const line = MONSTERS_BY_ID['cairnsworn'];
    expect(line.attacksPerTurn).toBe(2);
    expect(line.abilities).toBeUndefined();

    expect(MONSTERS_BY_ID['grave-hollow'].tags).toContain('elite');
  });

  it('keeps Hald\'s heal on the cycle ability, not onBloodied', () => {
    /* applyOnBloodiedAbilities honours `buff` and `aoe` but NOT `heal`
       (monster_ai.js:1443), so a heal placed there is silently dropped. */
    const hald = MONSTERS_BY_ID[HALD];
    const cyc = hald.abilities.find(a => a.trigger === 'cycle');
    const bloodied = hald.abilities.find(a => a.trigger === 'onBloodied');
    expect(cyc.heal).toBe(8);
    expect(bloodied.heal).toBeUndefined();
    expect(bloodied.buff.key).toBe('bloodlust');
    expect(bloodied.aoe).toBeGreaterThan(0);
  });

  it('gives every Unrelieved creature a complete 19-frame idle and attack atlas', () => {
    for (const id of [...FIELD, HALD]) {
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

  it('wires grim-l5 to Hald and Unrelieved escorts', () => {
    const enc = BOSS_ENCOUNTERS.find(e => e.id === 'grim-l5');
    expect(enc.bossId).toBe(HALD);
    const escortIds = enc.escorts.map(e => e.id);
    expect(escortIds).toEqual(expect.arrayContaining([
      'greenmail', 'cairnsworn', 'ashen-archer', 'grave-hollow',
    ]));
    /* the stock SRD placeholder this replaced (wight + 4 plain skeletons) */
    expect(enc.bossId).not.toBe('wight');
    expect(escortIds).not.toContain('skeleton');
  });

  it('never sets isBoss on any monster', () => {
    expect(MONSTERS_ALL.filter(m => m.isBoss)).toHaveLength(0);
  });
});
