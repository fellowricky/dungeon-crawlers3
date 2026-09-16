import { describe, it, expect } from 'vitest';
import { createArenaRoom, HeadlessGame } from '../sim/headless_game.mjs';
import { makeHero, recalc, spawnMonster } from '../src/game/srd.js';
import { combatMethods } from '../src/game/combat.js';
import { reservationMethods } from '../src/game/reservation.js';

function arenaWithMob() {
  const h = makeHero('Vex', 'human', 'warlock', { str: 8, dex: 12, con: 14, int: 10, wis: 10, cha: 18 }, {});
  h.level = 5;
  recalc(h);
  const game = new HeadlessGame(createArenaRoom(24, 18), [h], { dungeonLevel: 5 });
  const mob = spawnMonster(1, 5, () => 0.5, null, null);
  game.spawnMonsters([mob]);
  const m = game.monsters[0];
  /* stand the mob a couple of tiles to the caster's right, clear of walls */
  const hero = game.heroes[0];
  m.x = hero.x + 2; m.z = hero.z;
  return { game, hero, m };
}

describe('Knockback slides instead of teleporting', () => {
  it('moves the entity for real, immediately — logic must not lag', () => {
    const { game, hero, m } = arenaWithMob();
    const before = m.x;
    const moved = game.pushEntity(m, hero.x, hero.z, 2, 1);
    expect(moved).toBeGreaterThan(0);
    /* the authoritative position jumps at once, so reservations, pathing and
       line of sight never disagree with where the entity is standing */
    expect(m.x).toBeGreaterThan(before);
  });

  it('leaves behind a decaying visual offset that starts at the full shove', () => {
    const { game, hero, m } = arenaWithMob();
    const before = m.x;
    game.pushEntity(m, hero.x, hero.z, 2, 1);
    const shove = m.x - before;

    expect(m.knockT).toBeGreaterThan(0);
    /* offset points back the way it came, so the sprite starts where it was hit */
    expect(m.knockOX).toBeCloseTo(-shove, 5);

    const [ox0] = combatMethods.lungeOffset(m, 0);
    expect(ox0).toBeCloseTo(-shove, 5);
    /* sprite begins at its pre-hit spot, not at the destination */
    expect(m.x + ox0).toBeCloseTo(before, 5);
  });

  it('eases the sprite onto the destination and then stops', () => {
    const { game, hero, m } = arenaWithMob();
    const dest = (() => { game.pushEntity(m, hero.x, hero.z, 2, 1); return m.x; })();

    const seen = [];
    for (let i = 0; i < 40; i++) {
      const [ox] = combatMethods.lungeOffset(m, 1 / 60);
      seen.push(Math.abs(ox));
    }
    /* strictly settling, never overshooting or jittering */
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeLessThanOrEqual(seen[i - 1] + 1e-9);
    expect(seen[seen.length - 1]).toBe(0);

    const [oxEnd] = combatMethods.lungeOffset(m, 1 / 60);
    expect(m.x + oxEnd).toBeCloseTo(dest, 5);
  });

  it('still returns the plain lunge offset for an entity that was not shoved', () => {
    const e = { lungeT: 0.22, lungeDX: 1, lungeDZ: 0 };
    const [ox, oz] = combatMethods.lungeOffset(e, 1 / 60);
    expect(ox).not.toBe(0);
    expect(oz).toBe(0);
  });

  it('adds nothing at all for an idle entity', () => {
    expect(combatMethods.lungeOffset({}, 1 / 60)).toEqual([0, 0]);
  });

  it('triggerDodge lunges the target away from the attacker then returns to zero', () => {
    const target = { x: 4.5, z: 3.5 };
    const attacker = { x: 3.5, z: 3.5 };
    combatMethods.triggerDodge(target, attacker);
    expect(target.lungeDX).toBeGreaterThan(0);
    expect(target.lungeT).toBeGreaterThan(0);

    const [oxMid] = combatMethods.lungeOffset(target, target.lungeDur / 2);
    expect(oxMid).toBeGreaterThan(0.05);

    target.lungeT = 0.0001;
    const [oxEnd] = combatMethods.lungeOffset(target, 0.02);
    expect(oxEnd).toBeCloseTo(0, 2);
  });
});

describe('the wall-aware pushEntity the browser game actually uses', () => {
  /* game.js composes reservationMethods last, so its pushEntity is the live
     one; the headless sim omits it and falls back to pathfinding's. Both must
     glide, or knockback teleports in exactly one of the two builds. */
  function liveGame() {
    const { game, hero, m } = arenaWithMob();
    Object.assign(game, reservationMethods);
    return { game, hero, m };
  }

  it('is the cell-stepping implementation, not the fallback', () => {
    const { game } = liveGame();
    expect(String(game.pushEntity)).toContain('solidProps');
  });

  it('snaps the position but glides the sprite', () => {
    const { game, hero, m } = liveGame();
    const before = m.x;
    const moved = game.pushEntity(m, hero.x, hero.z, 2, 1);
    expect(moved).toBeGreaterThan(0);
    expect(m.x).not.toBeCloseTo(before, 5);

    expect(m.knockT).toBeGreaterThan(0);
    const [ox] = combatMethods.lungeOffset(m, 0);
    expect(m.x + ox).toBeCloseTo(before, 5);
  });

  it('settles exactly on the destination cell', () => {
    const { game, hero, m } = liveGame();
    game.pushEntity(m, hero.x, hero.z, 2, 1);
    const dest = m.x;
    for (let i = 0; i < 40; i++) combatMethods.lungeOffset(m, 1 / 60);
    const [ox, oz] = combatMethods.lungeOffset(m, 1 / 60);
    expect(ox).toBe(0);
    expect(oz).toBe(0);
    expect(m.x).toBeCloseTo(dest, 5);
  });
});
