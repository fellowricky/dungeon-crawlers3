import { describe, it, expect } from 'vitest';
import { combatMethods } from '../src/game/combat.js';

/* A blow that lands and is not shrugged off entirely deals at least 1.
   Resistance halves with Math.floor, so 1 damage resisted used to become 0 —
   a hit that visibly connects for nothing. Immunity is the deliberate
   exception: it stays at 0 and is labelled on screen. */

const monster = (statblock = {}) => ({
  x: 0, z: 0, active: true, dead: false,
  roomId: 0,
  data: {
    name: 'Skeletal Swordsman', hp: 20, maxHp: 20, scale: 1,
    statblock: { immune: [], resist: [], vulnerable: [], ...statblock }
  },
  ent: { bar: {} }
});

function mkGame() {
  const g = {
    guild: null,
    monsters: [],
    heroes: [],
    fxNow: 0,
    _v3: (x, y, z) => ({ x, y, z }),
    fxText() {}, fxLog() {}, fxHitFlash() {}, fxDrawBar() {},
    triggerHitStop() {}, triggerShake() {}, refreshHud() {},
    activateRoomMonsters() {}, creditThreat() {}, killMonster() {},
    healHero() {}
  };
  Object.assign(g, combatMethods);
  return g;
}

describe('minimum damage on a landed hit', () => {
  it('a resisted 1-damage hit still deals 1, not 0', () => {
    const g = mkGame();
    const m = monster({ resist: ['slashing'] });
    g.monsters = [m];

    const { dmg } = g.damageMonster(m, 1, null, false, { dmgType: 'slashing' });

    expect(dmg).toBe(1);
    expect(m.data.hp).toBe(19);
  });

  it('resistance still halves properly when there is something to halve', () => {
    const g = mkGame();
    const m = monster({ resist: ['slashing'] });
    g.monsters = [m];

    const { dmg } = g.damageMonster(m, 9, null, false, { dmgType: 'slashing' });

    expect(dmg).toBe(4);          // floor(9 / 2) — the floor must not inflate this
    expect(m.data.hp).toBe(16);
  });

  it('immunity still means zero, and says so', () => {
    const g = mkGame();
    const m = monster({ immune: ['poison'] });
    g.monsters = [m];

    const { dmg, modLabel } = g.damageMonster(m, 6, null, false, { dmgType: 'poison' });

    expect(dmg).toBe(0);
    expect(modLabel).toBe('IMMUNE');
    expect(m.data.hp).toBe(20);
  });

  it('a zero-damage input stays zero — the floor is for landed hits only', () => {
    /* Nothing "landed" here, so there is nothing to guarantee. This keeps the
       rule from silently inventing damage for non-attack callers. */
    const g = mkGame();
    const m = monster();
    g.monsters = [m];

    const { dmg } = g.damageMonster(m, 0, null, false, { dmgType: 'slashing' });

    expect(dmg).toBe(0);
    expect(m.data.hp).toBe(20);
  });

  it('never heals the target when handed a negative', () => {
    const g = mkGame();
    const m = monster();
    g.monsters = [m];

    g.damageMonster(m, -5, null, false, { dmgType: 'slashing' });

    expect(m.data.hp).toBeLessThanOrEqual(20);
  });
});
