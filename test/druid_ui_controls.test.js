/* ─────────────── Druid panel: Drop Wild Shape + slot policy ───────────────
 * Both controls live in the druid's own section of the character sheet
 * (menus.js). `dropWildShape` also exists as a manual-combat bonus action, but
 * that bar only renders on a hero's turn in manual control mode — in auto mode
 * there was no way to reach it. And `wildShapeOnlyOutOfSlots` had a reader in
 * combat.js with no writer anywhere, so the policy was permanently off.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { shouldAutoWildShape } from '../src/game/combat.js';

if (typeof globalThis.document === 'undefined') {
  globalThis.innerWidth = 1920;
  globalThis.innerHeight = 1080;
  const dummyCtx = new Proxy({
    font: '', measureText: () => ({ width: 10 }),
    getImageData: (w, h) => ({ data: new Uint8Array(4) }),
    createImageData: (w = 100, h = 100) => ({ data: new Uint8Array(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} })
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {};
    }
  });
  const dummyEl = {
    setAttribute: () => {}, addEventListener: () => {}, style: {},
    getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
    getContext: () => dummyCtx,
    querySelector: () => dummyEl, querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {} }, appendChild: () => {}
  };
  globalThis.document = {
    createElement: () => dummyEl, createElementNS: () => dummyEl,
    getElementById: () => null, querySelector: () => dummyEl, querySelectorAll: () => [], body: dummyEl
  };
}

/** A druid whose HP is low enough that auto-combat wants to transform. */
const hurtDruid = (over = {}) => ({
  name: 'Druid', classKey: 'druid', level: 3,
  hp: 10, maxHp: 30, inWildShape: false,
  features: ['wildShapeClass'],
  abilityUsed: {},
  stats: { str: 10, dex: 14, con: 12, int: 12, wis: 16, cha: 10 },
  ...over
});

describe('Drop Wild Shape', () => {
  it('reverts the hero to natural form and restores pre-shift HP', async () => {
    const THREE = await import('three');
    const { game } = await import('../src/game/game.js');
    game.engine = { scene: new THREE.Group() };
    const hero = {
      data: {
        name: 'Druid',
        /* L3 druid, CON 12: 8 + 8 + 2x5 + 3x1 = 29 max HP once recalc runs */
        hp: 15, maxHp: 29, preWildShapeHp: 25,
        inWildShape: true, wildShapeHp: 20, wildShapeMaxHp: 20,
        wildShapeActiveForm: 'bear', level: 3, classKey: 'druid',
        stats: { str: 10, dex: 14, con: 12, int: 12, wis: 16, cha: 10 },
        abilityUsed: {}
      },
      bonusUsed: false,
      _bonusActed: false
    };
    game.heroes = [hero];

    expect(game.manualPerformBonusAbility(hero, 'dropWildShape')).toBe(true);
    expect(hero.data.inWildShape).toBe(false);
    expect(hero.data.hp).toBe(25);
  });

  it('refuses when the druid is not transformed', async () => {
    const THREE = await import('three');
    const { game } = await import('../src/game/game.js');
    game.engine = { scene: new THREE.Group() };
    const hero = { data: hurtDruid({ preWildShapeHp: 25 }), bonusUsed: false, _bonusActed: false };
    game.heroes = [hero];

    expect(game.manualPerformBonusAbility(hero, 'dropWildShape')).toBe(false);
  });

  it('is reachable from the druid panel, not only the manual combat bar', () => {
    // The manual bar renders only on a hero's turn in manual control mode, so
    // in auto mode the character sheet is the only way to reach this.
    const menus = readFileSync(new URL('../src/game/menus.js', import.meta.url), 'utf8');
    expect(menus).toContain('ws-drop');
    expect(menus).toContain('Drop Wild Shape');
    expect(menus).toContain('revertWildShape');
  });
});

describe('Wild Shape only when out of spell slots', () => {
  it('transforms at low HP when the policy is off', () => {
    expect(shouldAutoWildShape(hurtDruid({ slots: { 1: 2 } }))).toBe(true);
  });

  it('holds the form while slots remain when the policy is on', () => {
    const d = hurtDruid({ slots: { 1: 2 }, wildShapeOnlyOutOfSlots: true });
    expect(shouldAutoWildShape(d)).toBe(false);
  });

  it('transforms once the slots are spent', () => {
    const d = hurtDruid({ slots: { 1: 0, 2: 0 }, wildShapeOnlyOutOfSlots: true });
    expect(shouldAutoWildShape(d)).toBe(true);
  });

  it('still respects the other gates regardless of the policy', () => {
    // Healthy: no reason to shift.
    expect(shouldAutoWildShape(hurtDruid({ hp: 30, slots: {} }))).toBe(false);
    // Already transformed.
    expect(shouldAutoWildShape(hurtDruid({ inWildShape: true, slots: {} }))).toBe(false);
    // Not a wild-shaper.
    expect(shouldAutoWildShape(hurtDruid({ features: [], slots: {} }))).toBe(false);
  });

  it('has a control that actually writes the flag', () => {
    // Regression: combat.js read `wildShapeOnlyOutOfSlots` but nothing in the
    // app ever assigned it, so the policy could never be turned on.
    const menus = readFileSync(new URL('../src/game/menus.js', import.meta.url), 'utf8');
    expect(menus).toContain('wsonlyslots');
    expect(menus).toMatch(/wildShapeOnlyOutOfSlots\s*=/);
  });
});
