import { describe, it, expect } from 'vitest';
import {
  spawnMonster, dungeonMonsterIds, MONSTERS_BY_ID, MONSTERS_ALL,
} from '../src/game/srd.js';
import { PACK_TAGS } from '../src/game/constants.js';
import BOSS_ENCOUNTERS from '../src/game/boss_encounters.json' with { type: 'json' };

const FIELD = [
  'gnoll-render', 'gnoll-longfang', 'gnoll-marrowchanter',
  'gnoll-bonecarl', 'carrion-hyena',
];
const HESSK = 'gnoll-packlord';
const BUGBEARS = [
  'bugbear-maul', 'bugbear-javelin', 'bugbear-bonespeaker',
  'bugbear-hidebound', 'bugbear-throatcutter',
];


describe('ancient L5 Carrion Choir gnolls', () => {
  it('fields five CR 2 creatures on ancient and keeps Hessk off the room roster', () => {
    const ids = dungeonMonsterIds('ancient');
    for (const id of FIELD) {
      expect(ids).toContain(id);
      const m = MONSTERS_BY_ID[id];
      expect(m.cr).toBe(2);
      expect(m.isBoss).toBeFalsy();
    }
    expect(ids).not.toContain(HESSK);
    const hessk = MONSTERS_BY_ID[HESSK];
    expect(hessk.cr).toBe(4);
    expect(hessk.isBoss).toBeFalsy();
    expect(hessk.dungeons).toEqual([]);
  });

  /* L5 was not an empty rung like L4 -- it was an incoherent one. When this
     faction was designed, 400 sampled level-5 spawns returned 27 species
     including plesiosaurus, pegasus and merrow. That cleanup landed separately
     before these records were wired, so the eviction pass here was a no-op; the
     rung is now single-faction, matching the L2-L4 pattern. */
  it('leaves the ancient CR 2 rung to the Choir alone', () => {
    const ids = dungeonMonsterIds('ancient');
    const atTwo = ids.filter(id => MONSTERS_BY_ID[id].cr === 2);
    expect(atTwo.sort()).toEqual([...FIELD].sort());
    for (const id of ['plesiosaurus', 'pegasus', 'merrow', 'water-nymph', 'centaur', 'griffon']) {
      expect(ids).not.toContain(id);
    }
  });

  it('makes the Choir the dominant CR 2 presence at level 5', () => {
    const roster = dungeonMonsterIds('ancient');
    const qi = { dungeonLevel: 5, questFloor: 1, floors: 5 };
    const seen = new Set();
    let choir = 0;
    for (let i = 0; i < 200; i++) {
      const spec = spawnMonster(2, 5, Math.random, roster, qi);
      seen.add(spec.id);
      expect(spec.cr).toBe(2);
      if (FIELD.includes(spec.id)) choir++;
    }
    expect(choir / 200).toBeGreaterThan(0.5);
    expect(seen.size).toBeGreaterThan(1);
  });

  /* Same mixing shape as every floor below: an ordinary slot buys the floor's
     own CR, a minion slot (crOffset -1 => 2 * 0.6 = 1.2) steps down to the
     dearest rung at or below, which is the CR 1 Black-Maul bugbears. */
  it('steps down to the L4 bugbears for the -1 crOffset minion slots', () => {
    const roster = dungeonMonsterIds('ancient');
    const qi = { dungeonLevel: 5, questFloor: 1, floors: 5 };
    for (let i = 0; i < 30; i++) {
      const spec = spawnMonster(2 * 0.6, 5, Math.random, roster, qi, 'minion');
      expect(BUGBEARS).toContain(spec.id);
    }
  });

  /* monster_ai checks PACK_TAGS against a creature's tags BEFORE falling back to
     the hardcoded PACK_IDS list, so the shared tag buys focus fire with no edit
     to constants.js. Assert on the spawned monster: tags are projected, but this
     is the mechanism the whole faction's behaviour rests on. */
  it('gives the whole Choir the pack tag for shared-target focus fire', () => {
    expect(PACK_TAGS).toContain('pack');
    const qi = { dungeonLevel: 5, questFloor: 1, floors: 5 };
    for (const id of [...FIELD, HESSK]) {
      const spec = spawnMonster(MONSTERS_BY_ID[id].cr, 5, () => 0, [id], qi, null, true, true);
      expect(spec.id).toBe(id);
      expect(spec.tags).toContain('pack');
    }
  });

  it('delivers the marrowchanter cantrip fields through spawnMonster', () => {
    const spec = spawnMonster(2, 5, () => 0, ['gnoll-marrowchanter'],
      { dungeonLevel: 5, questFloor: 1, floors: 5 }, 'caster', false, true);
    expect(spec.id).toBe('gnoll-marrowchanter');
    expect(spec.ranged).toBe(true);
    expect(spec.rangedDmgType).toBe('necrotic');
    /* cantripClass drives the VFX, so it has to match the necrotic damage type
       and the green witch-light the sprite is visibly casting -- cleric's
       sacred flame would render a yellow radiant burst instead. */
    expect(spec.cantripClass).toBe('sorcerer');
    expect(spec.abilities?.some(a => a.key === 'laughing-dark')).toBe(true);
  });

  it('types the hyena as a beast so nest rooms can field it', () => {
    const h = MONSTERS_BY_ID['carrion-hyena'];
    expect(h.type).toBe('beast');
    expect(h.theme).toBe('Beasts');
    expect(h.speed).toBeGreaterThan(4);
  });

  /* Every ancient boss below this one ends on onBloodied, and Ghaur already
     took `enlarged`. A pack leader should escalate on a KILL. */
  it('does not reuse the onBloodied rider a fifth time', () => {
    const hessk = MONSTERS_BY_ID[HESSK];
    expect(hessk.abilities.some(a => a.trigger === 'onBloodied')).toBe(false);
    const onKill = hessk.abilities.find(a => a.trigger === 'onKill');
    expect(onKill.buff.key).toBe('hasted');
  });

  it('completes the ancient ladder L1-L5 at one faction per rung', () => {
    const ids = dungeonMonsterIds('ancient');
    const rung = cr => ids.filter(id => MONSTERS_BY_ID[id].cr === cr);
    expect(rung(0.125).some(id => id.startsWith('kobold-'))).toBe(true);
    expect(rung(0.25).some(id => id.startsWith('goblin-'))).toBe(true);
    expect(rung(0.5).some(id => id.startsWith('hobgoblin-'))).toBe(true);
    expect(rung(1).some(id => id.startsWith('bugbear-'))).toBe(true);
    expect(rung(2).some(id => id.startsWith('gnoll-') || id === 'carrion-hyena')).toBe(true);
  });

  it('leaves the older SRD gnolls alone', () => {
    expect(MONSTERS_BY_ID['gnoll'].statblock?.source).not.toBe('carrion-choir');
    expect(MONSTERS_BY_ID['gnoll'].dungeons).not.toContain('ancient');
    expect(MONSTERS_BY_ID['gnoll-sergeant'].cr).toBe(1);
  });

  it('wires ancient-l5 to Hessk with a Choir escort', () => {
    const enc = BOSS_ENCOUNTERS.find(e => e.id === 'ancient-l5');
    expect(enc.bossId).toBe(HESSK);
    const ids = enc.escorts.map(e => e.id);
    expect(ids).toEqual(expect.arrayContaining(['gnoll-bonecarl', 'carrion-hyena']));
    expect(enc.bossId).not.toBe('shield-guardian');
    expect(ids).not.toContain('animated-armor');
  });

  it('never sets isBoss on any monster', () => {
    expect(MONSTERS_ALL.filter(m => m.isBoss)).toHaveLength(0);
  });
});
