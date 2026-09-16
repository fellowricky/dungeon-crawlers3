import { describe, it, expect, vi } from 'vitest';
import { combatMethods } from '../src/game/combat.js';

/* The combat log and the floating number must report the SAME thing.
   Both used to be printed from different values at different times: the log
   from the raw roll, before resolution; the number from the post-mitigation
   total. Anything that reduced damage — temp HP, resistance, Uncanny Dodge —
   made them contradict each other on screen. */

function mkGame(over = {}) {
  const g = {
    heroes: [], monsters: [], guild: null, fxNow: 0,
    _v3: (x, y, z) => ({ x, y, z }),
    fxText: vi.fn(), fxLog: vi.fn(), fxHitFlash() {}, fxDrawBar() {},
    fxPlaySfx() {}, fxMeleeHitVFX() {}, triggerLunge() {}, showMiss() {},
    applyOnHitPerks() {}, monsterEliteRoom: () => false,
    triggerHitStop() {}, triggerShake() {}, refreshHud() {},
    activateRoomMonsters() {}, creditThreat() {}, killMonster() {},
    healHero() {}, breakConcentration() {}, revertWildShape() {},
    subclassIncomingMul: () => 1,
    ...over
  };
  Object.assign(g, combatMethods);
  Object.assign(g, over);
  return g;
}

const hero = (over = {}) => ({
  x: 0, z: 0,
  data: { name: 'Vermithrax', hp: 40, maxHp: 40, tempHp: 0, effStats: {}, ...over },
  ent: { bar: {} }
});

describe('mitigation is reported, not hidden', () => {
  it('temp HP absorbing a blow is reported, not shown as a bare 0', () => {
    /* The reported case: "Hook-Hauler hits Vermithrax for 7" over a floating 0,
       because 7 temp HP ate the whole blow. */
    const g = mkGame();
    const h = hero({ tempHp: 7 });
    const mit = {};

    const dealt = g.applyIncomingDamage(h, 7, mit);

    expect(dealt).toBe(0);
    expect(mit.tempAbsorbed).toBe(7);
    expect(h.data.tempHp).toBe(0);
    expect(h.data.hp).toBe(40);          // no hit points lost — the 0 was correct
    /* ...but it has to SAY so. */
    expect(g.describeMitigation(mit, 7, dealt)).toContain('soaked by temp HP');
    g.fxDamageNumber(h, dealt, mit, '#fff');
    expect(g.fxText.mock.calls[0][0]).toBe('absorbed');
  });

  it('a partial soak reports both halves', () => {
    const g = mkGame();
    const h = hero({ tempHp: 3 });
    const mit = {};

    const dealt = g.applyIncomingDamage(h, 10, mit);

    expect(dealt).toBe(7);
    expect(mit.tempAbsorbed).toBe(3);
    expect(h.data.hp).toBe(33);
    expect(g.describeMitigation(mit, 10, dealt)).toBe(' (3 soaked by temp HP)');
    /* A real number still prints as a plain number. */
    g.fxDamageNumber(h, dealt, mit, '#fff');
    expect(g.fxText.mock.calls[0][0]).toBe('7');
  });

  it('says nothing extra when nothing was mitigated', () => {
    const g = mkGame();
    const h = hero();
    const mit = {};

    const dealt = g.applyIncomingDamage(h, 9, mit);

    expect(dealt).toBe(9);
    /* The common case must read exactly as it always did. */
    expect(g.describeMitigation(mit, 9, dealt)).toBe('');
  });

  it('strike reports the post-resistance number, not the raw roll', () => {
    /* The second reported case: "hit, 14 dmg" over a floating 13, because
       resistance is applied inside damageMonster, after the log had printed. */
    const g = mkGame();
    const foe = {
      x: 1, z: 0, dead: false, roomId: 0,
      data: { name: 'Suture-Thing', hp: 30, maxHp: 30, scale: 1,
        statblock: { immune: [], resist: ['slashing'], vulnerable: [] } },
      ent: { bar: {} }
    };
    g.monsters = [foe];

    const seen = [];
    g.strike(hero(), foe, 14, false, false, [],
      { melee: true, dmgType: 'slashing', source: 'weapon' },
      (dealt, modLabel) => seen.push({ dealt, modLabel }));

    expect(seen).toHaveLength(1);
    expect(seen[0].dealt).toBe(7);        // floor(14 / 2) — what actually landed
    expect(foe.data.hp).toBe(23);         // and the number matches the HP lost
  });
});
