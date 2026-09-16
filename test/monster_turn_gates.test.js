import { describe, it, expect } from 'vitest';
import { monsterAiMethods } from '../src/game/monster_ai.js';
import { initiativeMethods } from '../src/game/initiative.js';
import { applyEffect, getEffectMods } from '../src/game/conditions.js';

/* The two gates at the top of runMonsterBehavior. Both are choke points: every
   downstream action path (cycle abilities, ranged fire, kiting, chasing, melee)
   is reached THROUGH them, which is the whole reason they live there and not
   scattered across the individual branches. */

/** A ranged monster that would shoot the moment it is allowed to. */
const archer = (over = {}) => ({
  x: 0, z: 0, active: true,
  data: {
    name: 'Skeletal Bowman', hp: 7, maxHp: 7, speed: 3.0,
    ranged: true, rngRange: 7, atk: 4, dmg: [1, 6, 2],
  },
  actUsed: false, walk: false, moving: false,
  path: null, pathI: 0, moveLeft: 4,
  ent: { grp: { rotation: { y: 0 } } },
  ...over
});

const hero = () => ({ x: 3, z: 0, data: { name: 'Hero', hp: 30, maxHp: 30 } });

/** Minimal host carrying the REAL runMonsterBehavior and the REAL
 *  isCurrentActor, so the test exercises how the two actually compose. Every
 *  action a monster could take is recorded rather than performed. */
function mkGame(over = {}) {
  const acted = [];
  const g = {
    initiative: { active: false, order: [], idx: 0, _awaitingReveal: false },
    heroes: [], monsters: [],
    hasLOS: () => true,
    nearestMeleeThreat: () => null,
    clearEntityPath: (e) => { e.path = null; e.pathI = 0; },
    monsterTrackFlee: () => {},
    /* Every downstream action path, stubbed to record instead of act. */
    tryMonsterCycleAbility: () => { acted.push('ability'); return true; },
    monsterRanged: () => { acted.push('ranged'); },
    monsterRangedAttack: () => { acted.push('rangedAttack'); },
    monsterKite: () => { acted.push('kite'); },
    monsterTacticalAction: () => { acted.push('tactical'); return true; },
    monsterChase: () => { acted.push('chase'); },
    monsterMelee: () => { acted.push('melee'); },
    fxLog() {},
    ...over
  };
  Object.assign(g, monsterAiMethods);
  /* Re-apply the recorders that monsterAiMethods just overwrote — we want the
     REAL runMonsterBehavior, but stubbed versions of everything it dispatches
     to, so a call is observable without dragging in the renderer. */
  g.monsterTrackFlee = () => {};
  g.tryMonsterCycleAbility = () => { acted.push('ability'); return true; };
  g.monsterRanged = () => { acted.push('ranged'); };
  g.monsterRangedAttack = () => { acted.push('rangedAttack'); };
  g.monsterKite = () => { acted.push('kite'); };
  g.monsterTacticalAction = () => { acted.push('tactical'); return true; };
  g.monsterChase = () => { acted.push('chase'); };
  g.monsterMelee = () => { acted.push('melee'); };
  Object.assign(g, over);
  g.isCurrentActor = initiativeMethods.isCurrentActor;
  g._currentActor = initiativeMethods._currentActor;
  g.acted = acted;
  return g;
}

describe('runMonsterBehavior turn gates', () => {
  it('does not let a ranged monster act before initiative has been rolled', () => {
    /* The wake frame: updateInitiative has already run THIS frame, and it only
       counts monsters that were already `active`, so a monster woken later in
       the same frame by tryActivateMonster finds initiative.active === false.
       That used to pass the old negative gate and buy a free shot. */
    const g = mkGame();
    const m = archer();
    g.monsters = [m];
    g.initiative.active = false;

    g.runMonsterBehavior(m, hero(), 0.016);

    expect(g.acted).toEqual([]);
  });

  it('does not let anyone act while the initiative roll-off is still playing', () => {
    const g = mkGame();
    const m = archer();
    g.monsters = [m];
    /* active AND top of the order — but the dice are still landing. */
    g.initiative = { active: true, order: [m], idx: 0, _awaitingReveal: true };

    g.runMonsterBehavior(m, hero(), 0.016);

    expect(g.acted).toEqual([]);
  });

  it('lets the current actor act once initiative is live', () => {
    const g = mkGame();
    const m = archer();
    g.monsters = [m];
    g.initiative = { active: true, order: [m], idx: 0, _awaitingReveal: false };

    g.runMonsterBehavior(m, hero(), 0.016);

    /* Proves the gates are shut by the initiative state, not by a broken host. */
    expect(g.acted.length).toBeGreaterThan(0);
  });

  it('skips the turn of an incapacitated monster instead of letting it shoot', () => {
    /* Sleep applies `unconscious`, which carries incapacitated:true. The branch
       reached first for a ranged monster is monsterRanged — which had no
       incapacitated check of its own, so a slept archer kept firing. */
    const g = mkGame();
    const m = archer();
    g.monsters = [m];
    g.initiative = { active: true, order: [m], idx: 0, _awaitingReveal: false };

    expect(applyEffect(m, 'unconscious', { duration: 60, elapsed: 0 })).toBe(true);
    expect(getEffectMods(m).incapacitated).toBe(true);

    g.runMonsterBehavior(m, hero(), 0.016);

    expect(g.acted).toEqual([]);
    expect(m.walk).toBe(false);
    expect(m.moving).toBe(false);
    /* actUsed lets updateInitiative retire the turn on its paced-advance path
       rather than burning the 2.5s stuck-ceiling watchdog every round. */
    expect(m.actUsed).toBe(true);
  });

  it('stops an incapacitated ability caster from using its cycle ability', () => {
    /* tryMonsterCycleAbility is reached BEFORE the ranged branch and had no
       check either, so a slept caster went on casting. */
    const g = mkGame();
    const m = archer({ data: { name: 'Bonesaw Acolyte', hp: 22, maxHp: 22, speed: 3.0, ranged: true, rngRange: 7, atk: 4, dmg: [1, 10, 2] } });
    g.monsters = [m];
    g.initiative = { active: true, order: [m], idx: 0, _awaitingReveal: false };
    applyEffect(m, 'unconscious', { duration: 60, elapsed: 0 });

    g.runMonsterBehavior(m, hero(), 0.016);

    expect(g.acted).not.toContain('ability');
    expect(g.acted).toEqual([]);
  });

  it('lets the monster act again once the condition is gone', () => {
    const g = mkGame();
    const m = archer();
    g.monsters = [m];
    g.initiative = { active: true, order: [m], idx: 0, _awaitingReveal: false };
    applyEffect(m, 'unconscious', { duration: 60, elapsed: 0 });
    g.runMonsterBehavior(m, hero(), 0.016);
    expect(g.acted).toEqual([]);

    m._effects = {};
    m._effectCache = null;
    m.actUsed = false;
    g.runMonsterBehavior(m, hero(), 0.016);

    expect(g.acted.length).toBeGreaterThan(0);
  });
});
