import { describe, it, expect, vi } from 'vitest';
import { makeHero, recalc, heroDamage } from '../src/game/srd.js';
import { combatMethods } from '../src/game/combat.js';
import { hasEffect } from '../src/game/conditions.js';

const warlock = (level, invocations = []) => {
  const h = makeHero('Vex', 'human', 'warlock', { str: 8, dex: 12, con: 14, int: 10, wis: 10, cha: 16 }, {});
  h.level = level;
  h.invocations = invocations;
  recalc(h);
  return h;
};

/** Minimal stand-in for the game object the combat methods are mixed into. */
function stubGame(over = {}) {
  return {
    fxNow: 0,
    fxLog: vi.fn(),
    pushEntity: vi.fn(() => 2),
    fxSchedule: (delay, fn) => fn(),
    ...combatMethods,
    /* after the spread: these stand in for the real thing */
    heroAttackRoll: vi.fn(),
    ...over
  };
}

const mob = (name = 'Goblin') => ({ x: 5, z: 0, dead: false, data: { name, hp: 30, maxHp: 30, scale: 1 } });

describe('Eldritch Blast fires beams on the attack path, not one fat die', () => {
  it('adds a beam at levels 5, 11 and 17 instead of growing a single roll', () => {
    for (const [level, beams] of [[1, 1], [4, 1], [5, 2], [10, 2], [11, 3], [16, 3], [17, 4], [20, 4]]) {
      expect(`L${level}=${warlock(level).cantripProfile.beams}`).toBe(`L${level}=${beams}`);
    }
  });

  it('rolls 1d10 per beam, so Agonizing Blast pays out on each one', () => {
    const h = warlock(17);
    for (let i = 0; i < 400; i++) {
      /* one beam's worth, never 4d10 rolled together */
      expect(heroDamage(h, false, h.cantripProfile)).toBeLessThanOrEqual(10);
    }
  });

  it('leaves other casters scaling their cantrip the normal way', () => {
    const wiz = makeHero('Gale', 'human', 'wizard', { str: 8, dex: 12, con: 14, int: 16, wis: 10, cha: 10 }, {});
    wiz.level = 17;
    recalc(wiz);
    expect(wiz.cantripProfile.beams).toBe(0);
    let sawBig = false;
    for (let i = 0; i < 400; i++) if (heroDamage(wiz, false, wiz.cantripProfile) > 10) sawBig = true;
    expect(sawBig).toBe(true);
  });

  it('animates every beam: one attack roll per beam, staggered', () => {
    const g = stubGame();
    const h = warlock(17);
    const heroEnt = { x: 0, z: 0, data: h };
    const foe = mob();

    g.fireExtraBeams(heroEnt, foe, [heroEnt], h.cantripProfile);
    /* beams 2..4 — the first is rolled by the caller */
    expect(g.heroAttackRoll).toHaveBeenCalledTimes(3);
  });

  it('stops firing beams once the target is down', () => {
    const foe = mob();
    const g = stubGame({
      heroAttackRoll: vi.fn(() => { foe.data.hp = 0; })
    });
    const h = warlock(17);
    g.fireExtraBeams({ x: 0, z: 0, data: h }, foe, [], h.cantripProfile);
    expect(g.heroAttackRoll).toHaveBeenCalledTimes(1);
  });

  it('does not let Thirsting Blade double the beams', () => {
    /* Thirsting Blade is a weapon invocation; the blast profile must be exempt */
    const h = warlock(20, ['thirstingBlade']);
    expect(h.cantripProfile.beams).toBe(4);
  });
});

describe('Eldritch Blast invocation riders land on the attack path', () => {
  it('shoves the target back on every beam that hits with Repelling Blast', () => {
    const g = stubGame();
    const h = warlock(11, ['repellingBlast']);
    const heroEnt = { x: 0, z: 0, data: h };
    const foe = mob();

    g.beginBlastAction(heroEnt, h.cantripProfile);
    g.applyBlastRiders(heroEnt, foe);
    g.applyBlastRiders(heroEnt, foe);

    expect(g.pushEntity).toHaveBeenCalledTimes(2);
    /* dir 1 = away from the caster */
    expect(g.pushEntity.mock.calls[0]).toEqual([foe, 0, 0, 2, 1]);
  });

  it('hauls the target closer with Grasp of Hadar, once per turn', () => {
    const g = stubGame();
    const h = warlock(11, ['graspOfHadar']);
    const heroEnt = { x: 0, z: 0, data: h };
    const foe = mob();

    g.beginBlastAction(heroEnt, h.cantripProfile);
    g.applyBlastRiders(heroEnt, foe);
    g.applyBlastRiders(heroEnt, foe);

    expect(g.pushEntity).toHaveBeenCalledTimes(1);
    /* dir -1 = toward the caster */
    expect(g.pushEntity.mock.calls[0][4]).toBe(-1);

    /* a fresh action re-arms it */
    g.beginBlastAction(heroEnt, h.cantripProfile);
    g.applyBlastRiders(heroEnt, foe);
    expect(g.pushEntity).toHaveBeenCalledTimes(2);
  });

  it('slows the target with Lance of Lethargy, once per turn', () => {
    const g = stubGame();
    const h = warlock(11, ['lanceOfLethargy']);
    const heroEnt = { x: 0, z: 0, data: h };
    const foe = mob();

    g.beginBlastAction(heroEnt, h.cantripProfile);
    g.applyBlastRiders(heroEnt, foe);
    expect(hasEffect(foe, 'slowed')).toBe(true);
  });

  it('never shoves and hauls the same beam', () => {
    const g = stubGame();
    const h = warlock(11, ['repellingBlast', 'graspOfHadar']);
    const heroEnt = { x: 0, z: 0, data: h };

    g.beginBlastAction(heroEnt, h.cantripProfile);
    g.applyBlastRiders(heroEnt, mob());
    expect(g.pushEntity).toHaveBeenCalledTimes(1);
    expect(g.pushEntity.mock.calls[0][4]).toBe(1);
  });

  it('leaves a dead target alone', () => {
    const g = stubGame();
    const h = warlock(11, ['repellingBlast']);
    const foe = mob();
    foe.data.hp = 0;
    g.applyBlastRiders({ x: 0, z: 0, data: h }, foe);
    expect(g.pushEntity).not.toHaveBeenCalled();
  });

  it('fires on impact, never at cast time', () => {
    /* The bolt takes ~0.55s to travel and strike() resolves the hit in the
       animation's onImpact callback. Shoving the target when the attack was
       rolled slid it clear before the beam arrived, and the beam then landed
       in the empty square it had been knocked out of. */
    const h = warlock(5, ['repellingBlast']);
    const events = [];
    let impact = null;

    const g = {
      ...combatMethods,
      fxNow: 0, heroes: [],
      /* Deliberately a bare {x,y,z}, exactly like the headless sim's _v3.
         The stub used to carry a set() method, which hid a call to to.set()
         that threw on every headless run. */
      _v3: (x, y, z) => ({ x, y, z }),
      fxPlaySfx() {}, fxSlash() {}, fxSprite() {}, fxSheetEffect() {}, showMiss() {},
      fxLog() {}, fxCantripSfx: () => 'sfx', fxMeleeHitVFX() {},
      damageMonster() { events.push('damage'); return {}; },
      applyOnHitPerks() {},
      pushEntity() { events.push('knockback'); return 2; },
      /* stand in for the travelling animation: hold the impact callback */
      fxCompositeAnimation(anim, from, to, opts) { impact = () => opts.onImpact(to); },
      fxProjectile(from, to, kind, color, onHit) { impact = onHit; }
    };
    const hero = { x: 0, z: 0, data: h };
    const foe = mob();

    g.strike(hero, foe, 7, false, false, [hero], h.cantripProfile);
    expect(events).toEqual([]);          /* nothing has landed yet */

    impact();
    expect(events).toEqual(['damage', 'knockback']);
  });

  it('does nothing for a warlock who took none of those invocations', () => {
    const g = stubGame();
    const h = warlock(11, ['armorOfShadows']);
    const foe = mob();
    g.beginBlastAction({ x: 0, z: 0, data: h }, h.cantripProfile);
    g.applyBlastRiders({ x: 0, z: 0, data: h }, foe);
    expect(g.pushEntity).not.toHaveBeenCalled();
    expect(hasEffect(foe, 'slowed')).toBe(false);
  });
});
