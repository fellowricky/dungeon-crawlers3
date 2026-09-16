import { describe, it, expect } from 'vitest';
import {
  spawnMonster, dungeonMonsterIds, MONSTERS_BY_ID, MONSTERS_ALL,
} from '../src/game/srd.js';
import { PACK_TAGS } from '../src/game/constants.js';
import BOSS_ENCOUNTERS from '../src/game/boss_encounters.json' with { type: 'json' };

const FIELD = [
  'orc-oathsworn', 'orc-ashthrower', 'orc-eyepriest',
  'orc-unbroken', 'orc-berserker',
];
const GORRUKH = 'orc-oathbearer';
const BUGBEARS = [
  'bugbear-maul', 'bugbear-javelin', 'bugbear-bonespeaker',
  'bugbear-hidebound', 'bugbear-throatcutter',
];


describe('ancient L6 Sundered Oath orcs', () => {
  it('fields five CR 3 creatures on ancient and keeps Gorrukh off the room roster', () => {
    const ids = dungeonMonsterIds('ancient');
    for (const id of FIELD) {
      expect(ids).toContain(id);
      const m = MONSTERS_BY_ID[id];
      expect(m.cr).toBe(3);
      expect(m.isBoss).toBeFalsy();
    }
    expect(ids).not.toContain(GORRUKH);
    const g = MONSTERS_BY_ID[GORRUKH];
    expect(g.cr).toBe(5);
    expect(g.isBoss).toBeFalsy();
    expect(g.dungeons).toEqual([]);
  });

  /* Unlike L5, this rung needed no eviction: CR 3 on ancient was completely
     empty before this faction landed -- the roster jumped straight from the CR 2
     gnolls to CR 5 trolls and hill giants, so a 400-spawn sample at level 6 came
     back 100% gnolls. */
  it('leaves the ancient CR 3 rung to the Oath alone', () => {
    const ids = dungeonMonsterIds('ancient');
    const atThree = ids.filter(id => MONSTERS_BY_ID[id].cr === 3);
    expect(atThree.sort()).toEqual([...FIELD].sort());
  });

  it('makes the Oath the dominant CR 3 presence at level 6', () => {
    const roster = dungeonMonsterIds('ancient');
    const qi = { dungeonLevel: 6, questFloor: 1, floors: 8 };
    const seen = new Set();
    let oath = 0;
    for (let i = 0; i < 200; i++) {
      const spec = spawnMonster(3, 6, Math.random, roster, qi);
      seen.add(spec.id);
      expect(spec.cr).toBe(3);
      if (FIELD.includes(spec.id)) oath++;
    }
    expect(oath / 200).toBeGreaterThan(0.5);
    expect(seen.size).toBeGreaterThan(1);
  });

  /* KNOWN-IMPERFECT, PINNED DELIBERATELY. Minion slots price at
     targetCR * 0.6 and step down to the dearest rung at or below. That landed
     exactly one floor down while the CR anchors were doubling (0.125 -> 0.25 ->
     0.5 -> 1 -> 2), but from CR 2 up the anchors step +1 at a time, so
     3 * 0.6 = 1.8 SKIPS the CR 2 gnolls and lands on the CR 1 bugbears -- two
     rungs down. The same skip hits L7 and L8, in every dungeon, and the fix is
     in game.js:743 (crOffset is a ratio where the comment above it says rungs).
     Zenu deferred that fix, so this test pins the behaviour as it actually is
     rather than as it ought to be. If crOffset is corrected later, this
     expectation should flip to the gnolls and that is the signal it worked. */
  it('steps minion slots down to the L4 bugbears, skipping the gnolls', () => {
    const roster = dungeonMonsterIds('ancient');
    const qi = { dungeonLevel: 6, questFloor: 1, floors: 8 };
    for (let i = 0; i < 30; i++) {
      const spec = spawnMonster(3 * 0.6, 6, Math.random, roster, qi, 'minion');
      expect(BUGBEARS).toContain(spec.id);
    }
  });

  /* The Carrion Choir one floor up is built entirely on the shared `pack` tag
     (monster_ai checks PACK_TAGS before its hardcoded PACK_IDS list) for
     shared-target focus fire. Reusing it here would make L6 play exactly like
     L5 with different art, so the orcs deliberately do NOT carry it. */
  it('withholds the pack tag so L6 does not replay L5', () => {
    expect(PACK_TAGS).toContain('pack');
    const qi = { dungeonLevel: 6, questFloor: 1, floors: 8 };
    for (const id of [...FIELD, GORRUKH]) {
      const spec = spawnMonster(MONSTERS_BY_ID[id].cr, 6, () => 0, [id], qi, null, true, true);
      expect(spec.id).toBe(id);
      expect(spec.tags).not.toContain('pack');
      expect(spec.packTactics).toBeFalsy();
    }
  });

  it('delivers the eye-priest cantrip fields through spawnMonster', () => {
    const spec = spawnMonster(3, 6, () => 0, ['orc-eyepriest'],
      { dungeonLevel: 6, questFloor: 1, floors: 8 }, 'caster', false, true);
    expect(spec.id).toBe('orc-eyepriest');
    expect(spec.ranged).toBe(true);
    expect(spec.rangedDmgType).toBe('radiant');
    /* cantripClass drives the VFX, so it has to match the radiant damage type
       and the golden-white light the sprite is visibly casting. cleric =
       sacred flame; this is the one cantrip class L1-L5 never spent. */
    expect(spec.cantripClass).toBe('cleric');
    expect(spec.abilities?.some(a => a.key === 'oath-light')).toBe(true);
  });

  /* All 30 records across L1-L5 use only cycle / onHit / onBloodied / onKill.
     The berserker is the ancient ladder's first aura, and it needs no engine
     change -- monster_ai already pulses aura abilities on a timer. */
  it('introduces the ladder’s first aura trigger', () => {
    const b = MONSTERS_BY_ID['orc-berserker'];
    const aura = b.abilities.find(a => a.trigger === 'aura');
    expect(aura).toBeTruthy();
    expect(aura.effect.key).toBe('frightened');
    expect(aura.aoe).toBeGreaterThan(0);

    const LADDER = ['kobold-', 'goblin-', 'hobgoblin-', 'bugbear-', 'gnoll-'];
    const older = MONSTERS_ALL.filter(m => LADDER.some(p => m.id.startsWith(p))
      && /warren|nail-crown|red-banner|black-maul|carrion-choir/.test(m.statblock?.source || ''));
    expect(older.length).toBeGreaterThan(0);
    expect(older.some(m => (m.abilities || []).some(a => a.trigger === 'aura'))).toBe(false);
  });

  /* The thing worth guarding was never the onBloodied TRIGGER -- it was the
     fifth reuse of the same onBloodied->bloodlust rider. Gorrukh may escalate on
     being hurt; it just has to escalate into something the ladder has not
     already spent (kobold chief / goblin warchief / hobgoblin legate all take
     bloodlust, Ghaur takes enlarged, Hessk takes hasted). */
  it('gives Gorrukh an aura and an escalation the ladder has not used', () => {
    const g = MONSTERS_BY_ID[GORRUKH];
    expect(g.abilities.some(a => a.trigger === 'aura')).toBe(true);
    const onBl = g.abilities.find(a => a.trigger === 'onBloodied');
    expect(onBl.buff.key).toBe('giantStrength');
    expect(['bloodlust', 'enlarged', 'hasted']).not.toContain(onBl.buff.key);
  });

  /* Higher CR should mean a richer kit, not just bigger numbers. These three
     assertions pin the specific things that make L6 read differently in play. */
  it('borrows hero-class buffs the monster roster has never used', () => {
    /* `raging` carries dmgTakenMul 0.5 -- half damage taken -- which is what
       "The Unbroken stops giving ground" actually means mechanically. Before
       this faction, all 33 monster self-buffs in the game were one of four
       keys, leaving most of the EFFECTS table unused by monsters. */
    const u = MONSTERS_BY_ID['orc-unbroken'];
    expect(u.abilities.find(a => a.trigger === 'onBloodied').buff.key).toBe('raging');

    /* The berserker takes the opposite trade on the same trigger: bloodlust is
       speed and damage with no mitigation. One gets harder to kill, the other
       harder to escape. */
    const b = MONSTERS_BY_ID['orc-berserker'];
    expect(b.abilities.find(a => a.trigger === 'onBloodied').buff.key).toBe('bloodlust');
    expect(b.abilities.some(a => a.trigger === 'aura')).toBe(true);
  });

  it('gives the eye-priest a real spell list rather than one trick', () => {
    const p = MONSTERS_BY_ID['orc-eyepriest'];
    const cyc = p.abilities.filter(a => a.trigger === 'cycle');
    expect(cyc.length).toBe(2);
    /* maxUses is already a spell-slot count, so both spells run out. */
    expect(cyc.every(a => a.maxUses > 0)).toBe(true);
    /* Every cycle ability MUST share `every`. tryMonsterCycleAbility picks a
       random one and only then checks that one's cadence, so a caster with
       mismatched cadences rolls spells that are not ready and wastes the cast. */
    expect(new Set(cyc.map(a => a.every)).size).toBe(1);
    /* One controls, one damages -- not two deliveries of the same effect. */
    expect(cyc.some(a => a.effect)).toBe(true);
    expect(cyc.some(a => a.dice)).toBe(true);
  });

  /* Gorrukh's first draft paired a fear aura with a fear cycle spell, so half
     the kit did nothing the other half wasn't already doing. */
  it('does not give the boss two deliveries of the same condition', () => {
    const g = MONSTERS_BY_ID[GORRUKH];
    const conds = g.abilities.filter(a => a.effect).map(a => a.effect.key);
    expect(new Set(conds).size).toBe(conds.length);
  });

  it('completes the ancient ladder L1-L6 at one faction per rung', () => {
    const ids = dungeonMonsterIds('ancient');
    const rung = cr => ids.filter(id => MONSTERS_BY_ID[id].cr === cr);
    expect(rung(0.125).some(id => id.startsWith('kobold-'))).toBe(true);
    expect(rung(0.25).some(id => id.startsWith('goblin-'))).toBe(true);
    expect(rung(0.5).some(id => id.startsWith('hobgoblin-'))).toBe(true);
    expect(rung(1).some(id => id.startsWith('bugbear-'))).toBe(true);
    expect(rung(2).some(id => id.startsWith('gnoll-') || id === 'carrion-hyena')).toBe(true);
    expect(rung(3).some(id => id.startsWith('orc-'))).toBe(true);
  });

  /* The pre-existing orc records are placeholders Zenu flagged for a later
     redo. They sit at CR 0.5, 2, 6, 11 and 13 -- nowhere near this rung -- and
     this faction must not disturb them. */
  it('leaves the older placeholder orcs alone', () => {
    for (const id of ['orc', 'orc-warrior', 'orc-priest', 'orc-whelp',
      'orc-knight', 'orc-high-priest', 'orc-wizard', 'orc-sorcerer',
      'orc-warbringer', 'orc-warlord']) {
      const m = MONSTERS_BY_ID[id];
      expect(m).toBeTruthy();
      expect(m.statblock?.source).not.toBe('sundered-oath');
      expect(m.cr).not.toBe(3);
    }
  });

  it('wires ancient-l6 to Gorrukh with an Oath escort', () => {
    const enc = BOSS_ENCOUNTERS.find(e => e.id === 'ancient-l6');
    expect(enc.bossId).toBe(GORRUKH);
    const ids = enc.escorts.map(e => e.id);
    expect(ids).toEqual(expect.arrayContaining(['orc-unbroken', 'orc-oathsworn']));
    /* The placeholder it replaced was a CR 10 stone golem with gargoyle
       escorts on a targetCR 3.5 floor. */
    expect(enc.bossId).not.toBe('stone-golem');
    expect(ids).not.toContain('gargoyle');
  });

  it('never sets isBoss on any monster', () => {
    expect(MONSTERS_ALL.filter(m => m.isBoss)).toHaveLength(0);
  });
});
