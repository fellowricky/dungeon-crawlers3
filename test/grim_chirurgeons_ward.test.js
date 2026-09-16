import { describe, it, expect } from 'vitest';
import {
  spawnMonster, dungeonMonsterIds, MONSTERS_BY_ID, MONSTERS_ALL,
} from '../src/game/srd.js';
import BOSS_ENCOUNTERS from '../src/game/boss_encounters.json' with { type: 'json' };

const FIELD = ['suture-thing', 'hook-hauler', 'bonesaw-acolyte', 'tallowclad', 'sluiceborn'];
const CAUTER = 'cauter';
const TIER3 = ['risen-drudge', 'gorebloat', 'harvest-necromancer', 'gravebound', 'carrion-ghoul'];

describe('grim L4 Chirurgeon\'s Ward', () => {
  it('fields five CR 1 creatures on grim and keeps Cauter off the room roster', () => {
    const ids = dungeonMonsterIds('grim');
    for (const id of FIELD) {
      expect(ids).toContain(id);
      const m = MONSTERS_BY_ID[id];
      expect(m.cr).toBe(1);
      expect(m.isBoss).toBeFalsy();
    }
    expect(ids).not.toContain(CAUTER);
    const cauter = MONSTERS_BY_ID[CAUTER];
    expect(cauter.cr).toBe(2);
    expect(cauter.isBoss).toBeFalsy();
    expect(cauter.dungeons).toEqual([]);
  });

  it('reaches every Ward role at grim level 4, and nothing else', () => {
    /* Exclusivity check, matching ancient. grim's CR 1 band is now exactly the
       five Ward creatures: quasit, specter and reaper-lord were pruned off the
       theme earlier, and cult-leader — the curated grim L1 boss — was the last
       id left carrying dungeons:['grim'], which is why the L1 boss kept turning
       up as a rank-and-file mook on L4. See the curated-boss check below. */
    const roster = dungeonMonsterIds('grim');
    const qi = { dungeonLevel: 4, questFloor: 1, floors: 2 };
    const seen = new Set();
    for (let i = 0; i < 400; i++) {
      const spec = spawnMonster(1, 4, Math.random, roster, qi);
      expect(spec.cr).toBe(1);
      seen.add(spec.id);
    }
    expect([...seen].sort()).toEqual([...FIELD].sort());
  });

  it('keeps the bespoke grim bosses off the grim spawn roster', () => {
    /* A curated boss is spawned by id with strictIds+bypassCeiling, so it needs
       no roster entry. Leaving one on `dungeons` does not make it a better boss
       — it makes it an ordinary spawn the moment a floor's CR window reaches its
       CR, which is how the L1 Bone-Chanter walked into L4 corridors.

       Scoped to the BESPOKE tier (statblock.source === 'grim'): the five named
       creatures written for this arc, L1-L5. From L6 the encounters reuse
       generic SRD monsters (wraith, lich, death-knight) that are meant to
       patrol as well as headline, so they stay on the roster by design. */
    const roster = dungeonMonsterIds('grim');
    const bespoke = BOSS_ENCOUNTERS
      .filter(e => e.theme.toLowerCase() === 'grim')
      .map(e => e.bossId)
      .filter(id => MONSTERS_BY_ID[id]?.statblock?.source === 'grim');
    expect(bespoke).toContain('cult-leader');
    for (const id of bespoke) {
      expect(roster).not.toContain(id);
      expect(MONSTERS_BY_ID[id].dungeons).toEqual([]);
    }
  });

  it('does not mix the tier-3 Pale Harvest into the L4 CR window', () => {
    const roster = dungeonMonsterIds('grim');
    const qi = { dungeonLevel: 4, questFloor: 1, floors: 2 };
    for (let i = 0; i < 20; i++) {
      const spec = spawnMonster(1, 4, Math.random, roster, qi);
      expect(TIER3).not.toContain(spec.id);
    }
  });

  it('delivers the acolyte cantripClass through spawnMonster', () => {
    /* Read through spawnMonster, not monsters.json: its return object is an
       explicit projection, so a field can look correct in the JSON and never
       reach the runtime. */
    const spec = spawnMonster(1, 4, () => 0,
      ['bonesaw-acolyte'], { dungeonLevel: 4, questFloor: 1, floors: 2 }, 'caster', false, true);
    expect(spec.id).toBe('bonesaw-acolyte');
    /* Chill Touch is the sorcerer cantrip. cantripClass picks BOTH the VFX
       (CANTRIP_FX) and the save ability (wizard = DEX/Fire Bolt, sorcerer =
       CON/Chill Touch), so 'wizard' here fired a firebolt off a necrotic
       cantrip and rolled the wrong save. */
    expect(spec.cantripClass).toBe('sorcerer');
    expect(spec.rangedDmgType).toBe('necrotic');
    expect(spec.ranged).toBe(true);
    expect(spec.abilities?.some(a => a.key === 'open-the-seam')).toBe(true);
  });

  it('delivers authored speedFt through spawnMonster instead of back-deriving it', () => {
    const qi = { dungeonLevel: 4, questFloor: 1, floors: 2 };
    const want = {
      'suture-thing': 25, 'hook-hauler': 25, 'bonesaw-acolyte': 30,
      'tallowclad': 20, 'sluiceborn': 35,
    };
    for (const [id, ft] of Object.entries(want)) {
      const spec = spawnMonster(1, 4, () => 0, [id], qi, null, false, true);
      expect(spec.id).toBe(id);
      expect(spec.speedFt).toBe(ft);
      /* speed is authored as speedFt/10, which inverts srd.js's derivation
         exactly — so the two agree rather than the grid rate being a rounding
         artifact of the real-time rate. */
      expect(Math.round((spec.speed * 10) / 5) * 5).toBe(ft);
    }
  });

  it('carries the faction\'s three defining riders through to runtime', () => {
    const qi = { dungeonLevel: 4, questFloor: 1, floors: 2 };

    /* Hook-Hauler: restrained is the control piece the whole faction is built
       around, and it is the number most likely to need tuning after play. */
    const hh = spawnMonster(1, 4, () => 0, ['hook-hauler'], qi, null, false, true);
    const hooked = hh.abilities?.find(a => a.key === 'hooked');
    expect(hooked.trigger).toBe('onHit');
    expect(hooked.effect.key).toBe('restrained');
    expect(hooked.save).toEqual({ ab: 'str', dc: 13 });

    /* Sluiceborn: `drained` persists past the fight (stacking -5 max HP until a
       rest), so an accidental duration on it would silently defang the creature. */
    const sb = spawnMonster(1, 4, () => 0, ['sluiceborn'], qi, null, false, true);
    const tapped = sb.abilities?.find(a => a.key === 'tapped');
    expect(tapped.effect.key).toBe('drained');
    expect(tapped.effect.dur).toBeUndefined();

    /* Tallowclad retaliates rather than auras: an aoe here would turn it into a
       second control piece stacked on the Hook-Hauler. */
    const tc = spawnMonster(1, 4, () => 0, ['tallowclad'], qi, null, false, true);
    const wax = tc.abilities?.find(a => a.key === 'spitting-wax');
    expect(wax.trigger).toBe('onDamaged');
    expect(wax.aoe).toBeUndefined();
  });

  it('tags the tallowclad as a tank at AC 17 and the sluiceborn as the elite', () => {
    const tank = MONSTERS_BY_ID['tallowclad'];
    expect(tank.ac).toBeGreaterThanOrEqual(16);
    expect(tank.tags).toContain('tank');

    const elite = MONSTERS_BY_ID['sluiceborn'];
    expect(elite.tags).toContain('elite');
    expect(elite.abilities?.some(a => a.trigger === 'onHit')).toBe(true);

    /* The Suture-Thing's identity is two attacks, not an ability — the
       four-armed concept was dropped because Krea2 will not render extra limbs,
       but the mechanic it existed for was kept. */
    const suture = MONSTERS_BY_ID['suture-thing'];
    expect(suture.attacksPerTurn).toBe(2);
    expect(suture.abilities).toBeUndefined();
  });

  it('keeps Cauter\'s heal on the cycle ability, not onBloodied', () => {
    /* applyOnBloodiedAbilities honours `buff` and `aoe` but NOT `heal`
       (monster_ai.js:1443), so a heal placed there is silently dropped. */
    const cauter = MONSTERS_BY_ID[CAUTER];
    const cyc = cauter.abilities.find(a => a.trigger === 'cycle');
    const bloodied = cauter.abilities.find(a => a.trigger === 'onBloodied');
    expect(cyc.heal).toBe(6);
    expect(bloodied.heal).toBeUndefined();
    expect(bloodied.buff.key).toBe('bloodlust');
    expect(bloodied.aoe).toBeGreaterThan(0);
  });

  it('gives every Ward creature a complete 19-frame idle and attack atlas', () => {
    for (const id of [...FIELD, CAUTER]) {
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

  it('wires grim-l4 to Cauter and Ward escorts', () => {
    const enc = BOSS_ENCOUNTERS.find(e => e.id === 'grim-l4');
    expect(enc.bossId).toBe(CAUTER);
    const escortIds = enc.escorts.map(e => e.id);
    expect(escortIds).toEqual(expect.arrayContaining([
      'tallowclad', 'suture-thing', 'hook-hauler', 'sluiceborn',
    ]));
    /* the stock SRD placeholder this replaced (ghoul + 2 ghasts) */
    expect(enc.bossId).not.toBe('ghoul');
    expect(escortIds).not.toContain('ghast');
  });

  it('never sets isBoss on any monster', () => {
    expect(MONSTERS_ALL.filter(m => m.isBoss)).toHaveLength(0);
  });
});
