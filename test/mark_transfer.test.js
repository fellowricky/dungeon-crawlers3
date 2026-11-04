/* Hunter's Mark and Hex follow the 5e rule: once the marked creature is dead,
   the caster may spend a bonus action on a later turn to move the mark to a
   new creature without casting again. Before this the hero was left
   concentrating on a corpse and had to spend a fresh slot to re-mark. */
import { describe, it, expect } from 'vitest';
import { combatMethods } from '../src/game/combat.js';
import { applyEffect, hasEffect, getEffect } from '../src/game/conditions.js';

function mkGame() {
  const logs = [];
  const g = Object.assign({}, combatMethods, {
    fxNow: 100, heroes: [], monsters: [],
    fxLog: (m) => logs.push(m), playAbilityFx: () => {}, refreshHud: () => {},
    refreshAbilityHud: () => {}, removeAoEZone: () => {},
  });
  g.logs = logs;
  return g;
}
const hero = (name = 'Wren') => ({ data: { name, hp: 20, maxHp: 20 }, x: 0, z: 0 });
const mob = (name, hp = 10) => ({ data: { name, hp, maxHp: hp }, dead: hp <= 0, x: 1, z: 0 });

describe("Hunter's Mark moves to new prey", () => {
  it('moves the mark for free once the marked creature is dead', () => {
    const g = mkGame(), h = hero(), a = mob('Rat A'), b = mob('Rat B');
    applyEffect(a, 'huntersMarked', { duration: 120, elapsed: g.fxNow, source: h });
    g.concentrate(h, 'huntersMark', [{ e: a, key: 'huntersMarked' }]);
    a.data.hp = 0; a.dead = true;

    expect(g.tryMoveMark(h, b)).toBe(true);
    expect(hasEffect(b, 'huntersMarked')).toBe(true);
    expect(getEffect(b, 'huntersMarked').source).toBe(h);
    expect(hasEffect(a, 'huntersMarked')).toBe(false);
    expect(h.conc.key).toBe('huntersMark');            // concentration continues
    expect(h.conc.targets).toEqual([{ e: b, key: 'huntersMarked' }]);
    expect(h._bonusActed).toBe(true);                    // it cost the bonus action…
    expect(h._bonusLeveled).toBeUndefined();             // …but is not a leveled cast
    expect(g.logs.some(m => /moves Hunter's Mark/.test(m))).toBe(true);
  });

  it('does nothing while the marked creature still lives', () => {
    const g = mkGame(), h = hero(), a = mob('Rat A'), b = mob('Rat B');
    applyEffect(a, 'huntersMarked', { duration: 120, elapsed: g.fxNow, source: h });
    g.concentrate(h, 'huntersMark', [{ e: a, key: 'huntersMarked' }]);
    expect(g.tryMoveMark(h, b)).toBe(false);
    expect(hasEffect(b, 'huntersMarked')).toBe(false);
    expect(h._bonusActed).toBeUndefined();
  });

  it('is skipped when the bonus action is spent, the target is dead, or nothing is marked', () => {
    const g = mkGame(), h = hero(), a = mob('Rat A', 0), b = mob('Rat B');
    expect(g.tryMoveMark(h, b)).toBe(false);             // no concentration at all
    g.concentrate(h, 'huntersMark', [{ e: a, key: 'huntersMarked' }]);
    expect(g.tryMoveMark(h, mob('Dead', 0))).toBe(false);
    h._bonusActed = true;
    expect(g.tryCastBonusSpell(h, b, [h])).toBe(false);
    expect(hasEffect(b, 'huntersMarked')).toBe(false);
  });

  it('Hex moves the same way', () => {
    const g = mkGame(), h = hero('Nyx'), a = mob('Imp', 0), b = mob('Cultist');
    g.concentrate(h, 'hex', [{ e: a, key: 'hexMarked' }]);
    expect(g.tryMoveMark(h, b)).toBe(true);
    expect(hasEffect(b, 'hexMarked')).toBe(true);
    expect(h.conc.key).toBe('hex');
  });

  it('other concentration spells are untouched', () => {
    const g = mkGame(), h = hero(), a = mob('Rat A', 0), b = mob('Rat B');
    g.concentrate(h, 'bless', [{ e: a, key: 'blessed' }]);
    expect(g.tryMoveMark(h, b)).toBe(false);
  });
});
