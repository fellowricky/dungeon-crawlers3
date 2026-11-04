/* Dominate Monster makes the target change sides for the duration: it fights
   the other monsters, they fight it, the party stops aiming at it, its hits
   are credited to the caster, it cannot hold a fight open on its own, and it
   flees when the fight ends before the spell does. */
import { describe, it, expect, vi } from 'vitest';
import { applyEffect, hasEffect, clearEffect, ROUND_SECONDS } from '../src/game/conditions.js';
import { combatMethods } from '../src/game/combat.js';
import { monsterAiMethods } from '../src/game/monster_ai.js';
import { initiativeMethods } from '../src/game/initiative.js';
import { turnEngineMethods } from '../src/game/turn_engine.js';
import { SPELLS } from '../src/game/spells.js';

const noop = () => {};
function mon(name, x, z, extra = {}) {
  return { x, z, active: true, dead: false, ent: {}, data: { name, id: name, hp: 20, maxHp: 20, ac: 12, atk: 4, dmg: [1, 6, 2], type: 'humanoid' }, ...extra };
}
function hero(name, x, z) {
  return { x, z, _side: 'hero', ent: {}, data: { name, hp: 20, maxHp: 20, ac: 14, classKey: 'wizard', level: 15, effStats: { int: 18 } } };
}
function game() {
  const g = Object.assign({}, combatMethods, monsterAiMethods, initiativeMethods, turnEngineMethods, {
    fxNow: 0, heroes: [], monsters: [], initiative: { active: false, order: [], idx: 0 },
    fxLog: noop, fxText: noop, fxStatusTray: noop, fxPlaySfx: noop, fxMeleeHitVFX: noop, fxProjectile: noop,
    fxImpactDelay: (d, fn) => fn(), fxHitFlash: noop, fxDrawBar: noop, refreshHud: noop, playAbilityFx: noop,
    markSpellUsed: noop, triggerLunge: noop, triggerHitStop: noop, triggerShake: noop, clearEntityPath: noop,
    _v3: (x, y, z) => ({ x, y, z }),
    isCurrentActor: () => true,
    creditThreat: vi.fn(),
  });
  return g;
}

describe('dominateMonster', () => {
  it('flips sides: dominated, not hostile, off the hero target list, stamped ally in initiative', () => {
    const g = game();
    const h = hero('Wiz', 0, 0);
    const a = mon('Orc A', 1, 0), b = mon('Orc B', 3, 0);
    g.heroes = [h]; g.monsters = [a, b];
    h.aiFoe = a;
    expect(g.dominateMonster(h, a, 10)).toBe(true);
    expect(g.isDominated(a)).toBe(true);
    expect(g.isHostileMonster(a)).toBe(false);
    expect(g.hostileMonsters()).toEqual([b]);
    expect(h.aiFoe).toBeNull();
    expect(g.findMonsterTarget(h)).toBe(b);
    expect(a._effects.dominated.until).toBe(10 * ROUND_SECONDS);
    const parts = g._initParticipants();
    expect(a._side).toBe('ally');
    expect(b._side).toBe('mon');
    expect(parts).toContain(a);
  });

  it('the cast itself goes through dominateMonster and is held by concentration', () => {
    const g = game();
    const h = hero('Wiz', 0, 0);
    const a = mon('Orc A', 1, 0);
    g.heroes = [h]; g.monsters = [a];
    g.spellSave = () => false;
    expect(SPELLS.dominateMonster.cast(g, h, a)).toBe(true);
    expect(g.isDominated(a)).toBe(true);
    expect(hasEffect(a, 'stunned')).toBe(false);
    expect(h.conc.key).toBe('dominateMonster');
    g.breakConcentration(h, 'took a hit');
    expect(hasEffect(a, 'dominated')).toBe(false);
    /* monster_ai notices on its next pass and hands the will back */
    expect(a.dominatedBy).toBe(h);
    g.releaseDominated(a);
    expect(a.dominatedBy).toBeNull();
    expect(g.isHostileMonster(a)).toBe(true);
    expect(g.creditThreat).toHaveBeenCalledWith(a, h, expect.any(Number));
  });

  it('a dominated creature picks the nearest hostile monster, never another thrall', () => {
    const g = game();
    const h = hero('Wiz', 0, 0);
    const a = mon('Thrall', 0, 1), b = mon('Far', 6, 1), c = mon('Near', 2, 1), d = mon('Thrall 2', 1, 1);
    g.heroes = [h]; g.monsters = [a, b, c, d];
    g.dominateMonster(h, a); g.dominateMonster(h, d);
    expect(g.pickDominatedTarget(a)).toBe(c);
    c.data.hp = 0;
    expect(g.pickDominatedTarget(a)).toBe(b);
    b.data.hp = 0;
    expect(g.pickDominatedTarget(a)).toBeNull();
  });

  it('its hits are routed through damageMonster and credited to the master', () => {
    const g = game();
    const h = hero('Wiz', 0, 0);
    const a = mon('Thrall', 0, 1), b = mon('Orc', 1, 1);
    g.heroes = [h]; g.monsters = [a, b];
    g.dominateMonster(h, a);
    g.damageMonster = vi.fn(() => ({ dmg: 5 }));
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.99);   // d20 → 20, a crit: always lands
    try { g.monsterAttack(a, b); } finally { rnd.mockRestore(); }
    expect(g.damageMonster).toHaveBeenCalledTimes(1);
    const [tgt, dmg, credit, crit, opts] = g.damageMonster.mock.calls[0];
    expect(tgt).toBe(b);
    expect(dmg).toBeGreaterThan(0);
    expect(credit).toBe(h);
    expect(crit).toBe(true);
    expect(opts.via).toBe(a);
    expect(opts.skipPerks).toBe(true);
    /* and a hostile hitting the thrall credits nobody */
    g.damageMonster.mockClear();
    const rnd2 = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try { g.monsterAttack(b, a); } finally { rnd2.mockRestore(); }
    expect(g.damageMonster.mock.calls[0][0]).toBe(a);
    expect(g.damageMonster.mock.calls[0][2]).toBeNull();
    /* the generic hurt path routes the same way */
    g.damageMonster.mockClear();
    g.hurtHero(b, 7, a);
    expect(g.damageMonster).toHaveBeenCalledWith(b, 7, h, false, expect.objectContaining({ via: a }));
  });

  it('uses no abilities while dominated and none against a monster target', () => {
    const g = game();
    const h = hero('Wiz', 0, 0);
    const a = mon('Thrall', 0, 1, { isBoss: true }), b = mon('Orc', 1, 1, { data: { name: 'Orc', hp: 20, maxHp: 20, ac: 12, abilities: [{ key: 'x', trigger: 'cycle', spell: 'fireball' }] } });
    g.heroes = [h]; g.monsters = [a, b];
    g.dominateMonster(h, a);
    a._spellCycle = 99; b._spellCycle = 99;
    expect(g.tryMonsterCycleAbility(a, b)).toBe(false);
    expect(g.tryMonsterCycleAbility(b, a)).toBe(false);
  });

  it('opportunity attacks: the party does not threaten the thrall, the other monsters do', () => {
    const g = game();
    const h = hero('Fighter', 0, 0);
    h.data.weaponProfile = { melee: true };
    const a = mon('Thrall', 1, 0), b = mon('Orc', 2, 0);
    g.heroes = [h]; g.monsters = [a, b];
    g.threatenedCells = () => new Set();
    g.dominateMonster(h, a);
    expect(g.oaHostiles(h).map(o => o.entity)).toEqual([b]);
    expect(g.oaHostiles(a).map(o => o.entity)).toEqual([b]);
    expect(g.oaHostiles(b).map(o => o.entity)).toEqual([h]);
  });

  it('when the fight ends first, a surviving thrall flees instead of turning on the party', () => {
    const g = game();
    const h = hero('Wiz', 0, 0);
    const a = mon('Thrall', 1, 0);
    g.heroes = [h]; g.monsters = [a];
    g.dominateMonster(h, a);
    /* only an ally-side participant remains → nothing hostile → the fight is over */
    const parts = g._initParticipants();
    expect(parts.some(e => e._side === 'mon')).toBe(false);
    g.resolveDominatedAtCombatEnd();
    expect(a.dead).toBe(true);
    expect(a.data.hp).toBe(0);
    expect(a.dominatedBy).toBeNull();
    expect(hasEffect(a, 'dominated')).toBe(false);
  });
});
