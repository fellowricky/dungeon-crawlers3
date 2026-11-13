import { describe, it, expect } from 'vitest';
import { parseDamageFloat, usesTypeColour, coinsForGold, pickCritSlot, CRIT_SLOTS } from '../src/game/damage_float.js';
import { DAMAGE_TYPE_ICONS, DMG_TYPES } from '../src/game/constants.js';
import { rampForType, TYPE_RAMPS } from '../src/render/pfx/damage_badge.js';

describe('reading a floating combat string', () => {
  it('an ordinary hit carries its type', () => {
    expect(parseDamageFloat('12 🗡️')).toMatchObject({ text: '12', amount: 12, types: ['slashing'], effect: null, heal: false });
  });

  it('a bare number stays a number, with no type', () => {
    expect(parseDamageFloat('8')).toMatchObject({ text: '8', types: [], effect: null });
  });

  it('reads vulnerable and resisted from their badges', () => {
    expect(parseDamageFloat('16 ⭕🔥')).toMatchObject({ amount: 16, types: ['fire'], effect: 'vuln' });
    expect(parseDamageFloat('4 ❌❄️')).toMatchObject({ amount: 4, types: ['cold'], effect: 'resist' });
  });

  it('reads every damage type combat can print', () => {
    for (const type of DMG_TYPES) {
      expect(parseDamageFloat(`7 ${DAMAGE_TYPE_ICONS[type]}`)?.types, type).toEqual([type]);
    }
  });

  it('reads immunity, with or without a type', () => {
    expect(parseDamageFloat('IMMUNE')).toMatchObject({ text: 'IMMUNE', effect: 'immune', types: [] });
    expect(parseDamageFloat('IMMUNE 💀')).toMatchObject({ effect: 'immune', types: ['necrotic'] });
  });

  it('a share of damage with no type draws no icon', () => {
    expect(parseDamageFloat('5 🛡️')).toMatchObject({ amount: 5, types: [] });
  });

  it('heals are numbers too', () => {
    expect(parseDamageFloat('+12')).toMatchObject({ text: '+12', amount: 12, heal: true });
  });

  it('leaves words as text', () => {
    for (const s of ['miss', 'CLEAVE', '+4 Ki', '+3 ward', '+slot', 'absorbed', 'FURY x3', '+10 HP', 'TRIPLE KILL!', '+2 🎵', '🎯 Dart 1']) {
      expect(parseDamageFloat(s), s).toBeNull();
    }
    expect(parseDamageFloat({})).toBeNull();
  });
});

describe('what colour a number is', () => {
  it('a typed hit on a monster takes its type\'s colour, whatever combat chose for it', () => {
    for (const c of ['#ff8a5a', '#ffd34a', '#4ade80', '#ff8a7a']) {
      expect(usesTypeColour(parseDamageFloat('9 🔥'), c), c).toBe(true);
    }
  });

  it('a hero being hurt stays red, even though it shows the type', () => {
    expect(usesTypeColour(parseDamageFloat('9 🔥'), '#ff9a7a')).toBe(false);
  });

  it('a number with no type keeps its own colour', () => {
    expect(usesTypeColour(parseDamageFloat('+9'), '#6ae06a')).toBe(false);
    expect(usesTypeColour(parseDamageFloat('9'), '#ff8a5a')).toBe(false);
  });

  it('every damage type has a ramp, and physical types share one', () => {
    for (const type of DMG_TYPES) expect(rampForType(type), type).toHaveLength(8);
    expect(rampForType('slashing')).toBe(TYPE_RAMPS.physical);
    expect(rampForType('piercing')).toBe(TYPE_RAMPS.physical);
    expect(rampForType('bludgeoning')).toBe(TYPE_RAMPS.physical);
    expect(rampForType('fire')).not.toBe(rampForType('cold'));
  });
});

describe('where a crit goes', () => {
  it('the first holds the target, the rest take slots of their own', () => {
    const live = [];
    for (let i = 0; i < 3; i++) live.push({ x: 2, z: 3, slot: pickCritSlot(live, 2, 3) });
    expect(live.map((c) => c.slot)).toEqual([0, 1, 2]);
  });

  it('a crit on someone else is no reason to move', () => {
    expect(pickCritSlot([{ x: 8, z: 8, slot: 0 }], 2, 3)).toBe(0);
  });

  it('takes back a slot that has come free', () => {
    expect(pickCritSlot([{ x: 2, z: 3, slot: 1 }], 2, 3)).toBe(0);
  });

  it('no two slots put bursts over each other', () => {
    const BURST_W = 100, BURST_H = 80;
    CRIT_SLOTS.forEach(([ax, ay], i) => CRIT_SLOTS.slice(i + 1).forEach(([bx, by]) => {
      expect(Math.abs(ax - bx) >= BURST_W || Math.abs(ay - by) >= BURST_H, `${ax},${ay} vs ${bx},${by}`).toBe(true);
    }));
  });
});

describe('coins for gold', () => {
  it('more gold throws more coins, up to the effect\'s dozen', () => {
    expect(coinsForGold(1)).toBe(3);
    expect(coinsForGold(10)).toBe(5);
    expect(coinsForGold(25)).toBe(7);
    expect(coinsForGold(60)).toBe(10);
    expect(coinsForGold(5000)).toBe(12);
  });
});
