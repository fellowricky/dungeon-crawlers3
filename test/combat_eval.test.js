import { describe, it, expect } from 'vitest';
import {
  hitChance, avgRoll, monsterDpr, damageValue, effectiveHp, commitDamage,
  bestAoECenter, meleeThreats, opportunityRisk, inMortalDanger, slotCost,
  gridDist, gridFeet, reachTiles, canAttackFrom,
} from '../src/game/combat_eval.js';

/* combat_eval is the layer that lets the AI compare options instead of firing
   the first `if` that matches. These lock in the properties the hero AI relies
   on — above all that damage is worth nothing past a target's remaining HP. */

const mon = (over = {}) => ({
  x: 0, z: 0, active: true,
  data: { name: 'Goblin', hp: 20, maxHp: 20, dmg: [1, 6, 2], atk: 4, ac: 13 },
  ...over,
});
/* Reach and threat tests need a real grid now — distance is measured in tiles
   (combat_eval.gridDist), not in euclidean floats. GW is generous so the
   fixtures' world coords all land on the grid. */
const GW = 64;
const gridStub = () => ({
  D: { W: GW, H: GW, grid: new Int32Array(GW * GW) },
  cellOf(x, z) {
    const cx = Math.round(x + GW / 2 - 0.5), cy = Math.round(z + GW / 2 - 0.5);
    return (cx < 0 || cy < 0 || cx >= GW || cy >= GW) ? -1 : cy * GW + cx;
  },
  wx: (cx) => cx - GW / 2 + 0.5,
  wz: (cy) => cy - GW / 2 + 0.5,
});
const game = (monsters = []) => ({ ...gridStub(), monsters, heroes: [] });

describe('hitChance', () => {
  it('clamps to the 5% / 95% auto-miss and auto-hit band', () => {
    expect(hitChance(0, 40)).toBeCloseTo(0.05, 5);
    expect(hitChance(40, 2)).toBeCloseTo(0.95, 5);
  });

  it('advantage beats a flat roll, disadvantage loses to it', () => {
    const flat = hitChance(5, 15);
    expect(hitChance(5, 15, 1)).toBeGreaterThan(flat);
    expect(hitChance(5, 15, -1)).toBeLessThan(flat);
  });
});

describe('avgRoll', () => {
  it('averages dice plus the flat bonus', () => {
    expect(avgRoll(2, 6, 3)).toBeCloseTo(10, 5);   // 2d6 avg 7, +3
  });
});

describe('damageValue', () => {
  it('caps value at the target remaining HP — overkill is worth nothing', () => {
    const g = game();
    const weak = mon({ data: { name: 'Rat', hp: 4, maxHp: 20, dmg: [1, 4, 0] } });
    const big = damageValue(g, weak, 100);
    const exact = damageValue(g, weak, 4);
    /* 100 damage into 4 HP is worth the same as 4 damage into 4 HP: both kill
       it, and the extra 96 evaporates. */
    expect(big).toBeCloseTo(exact, 5);
  });

  it('rewards finishing a dangerous target over chipping a fresh one', () => {
    const g = game();
    const woundedOgre = mon({ data: { name: 'Ogre', hp: 6, maxHp: 60, dmg: [2, 8, 4] } });
    const freshOgre = mon({ data: { name: 'Ogre', hp: 60, maxHp: 60, dmg: [2, 8, 4] } });
    const swing = 25;
    /* The killing blow removes a whole attacker; 25 chip damage does not. */
    expect(damageValue(g, woundedOgre, swing)).toBeGreaterThan(damageValue(g, freshOgre, swing));
  });

  it('still prefers a real target over a sliver of HP on something harmless', () => {
    const g = game();
    const rat = mon({ data: { name: 'Rat', hp: 2, maxHp: 20, dmg: [1, 4, 0] } });
    const ogre = mon({ data: { name: 'Ogre', hp: 60, maxHp: 60, dmg: [2, 8, 4] } });
    expect(damageValue(g, ogre, 40)).toBeGreaterThan(damageValue(g, rat, 40));
  });

  it('is zero once the party has already committed lethal damage', () => {
    const g = game();
    const m = mon({ data: { name: 'Goblin', hp: 10, maxHp: 20, dmg: [1, 6, 2] } });
    commitDamage(g, m, 10);
    expect(effectiveHp(g, m)).toBe(0);
    expect(damageValue(g, m, 30)).toBe(0);
  });
});

describe('bestAoECenter', () => {
  const caster = { x: 0, z: 0 };

  it('shifts the blast off the target to catch the whole cluster', () => {
    /* Target at 0; three more bunched around x=4. A blast centred on the
       target alone catches 1. Centred between them it catches all four. */
    const target = mon({ x: 0, z: 0 });
    const pack = [mon({ x: 4, z: 0 }), mon({ x: 4.5, z: 0.5 }), mon({ x: 4, z: 1 })];
    const g = game([target, ...pack]);

    const spot = bestAoECenter(g, caster, 3.0, { minTargets: 2, mustCover: target });
    expect(spot).not.toBeNull();
    expect(spot.targets.length).toBeGreaterThan(1);
    /* It moved off the target's own tile to reach the pack... */
    expect(spot.x).toBeGreaterThan(0);
    /* ...but the target is still inside the blast. */
    expect(Math.hypot(target.x - spot.x, target.z - spot.z)).toBeLessThanOrEqual(3.0);
  });

  it('refuses when nothing clears minTargets', () => {
    const lonely = mon({ x: 0, z: 0 });
    const faraway = mon({ x: 30, z: 30 });
    const g = game([lonely, faraway]);
    expect(bestAoECenter(g, caster, 2.0, { minTargets: 2, mustCover: lonely })).toBeNull();
  });

  it('never relocates away from the target when mustCover is set', () => {
    const target = mon({ x: 0, z: 0 });
    const distantPack = [mon({ x: 20, z: 0 }), mon({ x: 20.5, z: 0 }), mon({ x: 21, z: 0 })];
    const g = game([target, ...distantPack]);
    /* The far pack is a juicier blast, but it does not include our target, so
       there is no legal centre and the spell is simply not cast. */
    expect(bestAoECenter(g, caster, 2.0, { minTargets: 2, mustCover: target })).toBeNull();
  });

  it('prefers the centre covering the most useful damage', () => {
    const target = mon({ x: 0, z: 0 });
    const near = mon({ x: 1.5, z: 0 });
    const alsoNear = mon({ x: 1.6, z: 0.4 });
    const g = game([target, near, alsoNear]);
    const spot = bestAoECenter(g, caster, 2.5, { minTargets: 2, mustCover: target });
    expect(spot.targets.length).toBe(3);
  });
});

describe('threat assessment', () => {
  it('only melee-capable hostiles pin — an archer next door does not', () => {
    const hero = { x: 0, z: 0, data: { hp: 30, maxHp: 30 } };
    const archer = mon({ x: 1, z: 0, data: { name: 'Archer', hp: 10, ranged: true, dmg: [1, 8, 2] } });
    const brute = mon({ x: 1, z: 0 });
    expect(meleeThreats(game([archer]), hero).length).toBe(0);
    expect(meleeThreats(game([brute]), hero).length).toBe(1);
  });

  it('opportunity risk counts one attack per threat, not a full round', () => {
    const hero = { x: 0, z: 0, data: { hp: 30, maxHp: 30 } };
    const brute = mon({ x: 1, z: 0, data: { name: 'Ogre', hp: 40, dmg: [2, 8, 4], attacksPerTurn: 3 } });
    const g = game([brute]);
    /* A multiattacker only gets ONE swing as a reaction, so the OA risk must
       be well below its damage per round. */
    expect(opportunityRisk(g, hero, [brute])).toBeLessThan(monsterDpr(brute));
  });

  it('ignores a threat that has already spent its reaction', () => {
    const hero = { x: 0, z: 0, data: { hp: 30, maxHp: 30 } };
    const spent = mon({ x: 1, z: 0, reactionUsed: true });
    expect(opportunityRisk(game([spent]), hero, [spent])).toBe(0);
  });

  it('mortal danger tracks incoming damage, not a flat HP fraction', () => {
    const g = (hp) => {
      const hero = { x: 0, z: 0, data: { hp, maxHp: 100 } };
      const pack = [mon({ x: 1, z: 0, data: { name: 'Ogre', hp: 40, dmg: [2, 8, 4] } })];
      return [{ ...gridStub(), monsters: pack, heroes: [hero] }, hero];
    };
    const [g1, low] = g(4);
    expect(inMortalDanger(g1, low)).toBe(true);
    const [g2, healthy] = g(90);
    expect(inMortalDanger(g2, healthy)).toBe(false);
  });
});

describe('slotCost', () => {
  const caster = (slots) => ({ data: { slots } });

  it('is free for cantrips', () => {
    expect(slotCost(caster({}), 0, {})).toBe(0);
  });

  it('rises with spell level', () => {
    const h = caster({ 1: 2, 3: 2 });
    expect(slotCost(h, 3, {})).toBeGreaterThan(slotCost(h, 1, {}));
  });

  it('charges more for the last slot than for a full pouch', () => {
    expect(slotCost(caster({ 2: 1 }), 2, {})).toBeGreaterThan(slotCost(caster({ 2: 4 }), 2, {}));
  });

  it('discounts heavily when the fight is dangerous', () => {
    const h = caster({ 3: 2 });
    expect(slotCost(h, 3, {}, { danger: true })).toBeLessThan(slotCost(h, 3, {}));
  });

  it('honours the abilityUse directive — hoarders pay more', () => {
    const h = caster({ 2: 2 });
    expect(slotCost(h, 2, {}, { abilityUse: 0 })).toBeGreaterThan(slotCost(h, 2, {}, { abilityUse: 1 }));
  });
});

/* One world unit is one tile is five feet. The rules are grid rules, so reach
   and range must be judged in squares — measuring euclidean floats meant two
   diagonally adjacent creatures were 1.414 apart and a "5 ft" reach of 1.4
   excluded them, while MELEE_PIN_RANGE (1.6) still counted that same monster as
   pinning the hero. */
describe('grid distance', () => {
  const W = 20, H = 20;
  const g = {
    D: { W, H, grid: new Int32Array(W * H) },
    cellOf(x, z) {
      const cx = Math.round(x + W / 2 - 0.5), cy = Math.round(z + H / 2 - 0.5);
      return (cx < 0 || cy < 0 || cx >= W || cy >= H) ? -1 : cy * W + cx;
    },
    wx: (cx) => cx - W / 2 + 0.5,
    wz: (cy) => cy - H / 2 + 0.5,
  };
  const at = (cx, cy) => ({ x: g.wx(cx), z: g.wz(cy) });

  it('counts a diagonal as one tile — 5 ft, same as an orthogonal step', () => {
    expect(gridDist(g, at(5, 5), at(6, 5))).toBe(1);   // orthogonal
    expect(gridDist(g, at(5, 5), at(6, 6))).toBe(1);   // diagonal
    expect(gridFeet(g, at(5, 5), at(6, 6))).toBe(5);
  });

  it('counts two squares as 10 ft in every direction', () => {
    expect(gridFeet(g, at(5, 5), at(7, 5))).toBe(10);
    expect(gridFeet(g, at(5, 5), at(7, 7))).toBe(10);  // the far diagonal
  });

  it('is unaffected by sub-tile drift', () => {
    const drifted = { x: g.wx(6) + 0.24, z: g.wz(6) - 0.19 };
    expect(gridDist(g, at(5, 5), drifted)).toBe(1);
  });

  it('reachTiles: normal melee reaches every adjacent square', () => {
    expect(reachTiles({ melee: true, range: 1.4 })).toBe(1);
  });

  it('reachTiles: a reach weapon covers 10 ft, far diagonal included', () => {
    expect(reachTiles({ melee: true, range: 2.5, reach: true })).toBe(2);
    expect(gridDist(g, at(5, 5), at(7, 7))).toBeLessThanOrEqual(2);
  });

  it('a diagonally adjacent foe is attackable with a plain melee weapon', () => {
    const hero = at(5, 5);
    const foe = { ...at(6, 6), data: { hp: 10, maxHp: 10 } };
    expect(canAttackFrom(g, hero, foe, { melee: true, range: 1.4 })).toBe(true);
  });

  it('a foe two squares away is NOT attackable with a plain melee weapon', () => {
    const hero = at(5, 5);
    const foe = { ...at(7, 5), data: { hp: 10, maxHp: 10 } };
    expect(canAttackFrom(g, hero, foe, { melee: true, range: 1.4 })).toBe(false);
  });

  it('pinning and reach agree — anything that pins can be hit back', () => {
    const hero = { ...at(5, 5), data: { hp: 20, maxHp: 20 } };
    const foe = { ...at(6, 6), active: true, data: { name: 'Orc', hp: 10, maxHp: 10, dmg: [1, 8, 2] } };
    const gg = { ...g, monsters: [foe], heroes: [hero] };
    expect(meleeThreats(gg, hero, 1).length).toBe(1);
    expect(canAttackFrom(gg, hero, foe, { melee: true, range: 1.4 })).toBe(true);
  });
});
