import { describe, it, expect } from 'vitest';
import { compareTooltipHTML } from '../src/game/menus.js';
import { rollItem, itemPoints } from '../src/game/items.js';
import { makeHero } from '../src/game/srd.js';

describe('Gear Power Score (PS) Comparison Tooltip', () => {
  it('renders positive PS diff when bag gear is stronger than equipped gear', () => {
    const hero = makeHero('Valeros', 'human', 'fighter', { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, {});
    
    // Equipped weapon (lower level)
    const eqWeapon = rollItem(1, Math.random, 'weapon', { source: 'trash' });
    eqWeapon.slot = 'weapon';
    hero.equipment.weapon = eqWeapon;

    // Bag weapon (higher level)
    const bagWeapon = rollItem(10, Math.random, 'weapon', { source: 'boss' });
    bagWeapon.slot = 'weapon';

    const bagPs = itemPoints(bagWeapon);
    const eqPs = itemPoints(eqWeapon);
    const expectedDiff = bagPs - eqPs;

    const html = compareTooltipHTML(bagWeapon, hero);

    expect(html).toContain(`<span>Power Score</span><b>${bagPs}</b>`);
    expect(html).toContain(`<span>Power Score</span><b>${eqPs}</b>`);
    if (expectedDiff > 0) {
      expect(html).toContain(`<i class="tt-d pos">+${expectedDiff}</i>`);
    } else if (expectedDiff < 0) {
      expect(html).toContain(`<i class="tt-d neg">${expectedDiff}</i>`);
    } else {
      expect(html).not.toContain('class="tt-d');
    }
  });

  it('renders negative PS diff when bag gear is weaker than equipped gear', () => {
    const hero = makeHero('Valeros', 'human', 'fighter', { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, {});
    
    // High-end equipped armor
    const eqArmor = rollItem(15, Math.random, 'armor', { source: 'boss' });
    eqArmor.slot = 'armor';
    hero.equipment.armor = eqArmor;

    // Low-end bag armor
    const bagArmor = rollItem(1, Math.random, 'armor', { source: 'trash' });
    bagArmor.slot = 'armor';

    const bagPs = itemPoints(bagArmor);
    const eqPs = itemPoints(eqArmor);
    const expectedDiff = bagPs - eqPs;

    const html = compareTooltipHTML(bagArmor, hero);

    expect(html).toContain(`<span>Power Score</span><b>${bagPs}</b>`);
    expect(html).toContain(`<span>Power Score</span><b>${eqPs}</b>`);
    if (expectedDiff < 0) {
      expect(html).toContain(`<i class="tt-d neg">${expectedDiff}</i>`);
    }
  });

  it('renders positive PS diff when equipped slot is empty', () => {
    const hero = makeHero('Valeros', 'human', 'fighter', { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, {});
    hero.equipment.weapon = null;

    const bagWeapon = rollItem(5, Math.random, 'weapon', { source: 'trash' });
    bagWeapon.slot = 'weapon';
    const bagPs = itemPoints(bagWeapon);

    const html = compareTooltipHTML(bagWeapon, hero);

    expect(html).toContain(`<span>Power Score</span><b>${bagPs}</b>`);
    expect(html).toContain(`<i class="tt-d pos">+${bagPs}</i>`);
    expect(html).toContain('nothing equipped');
  });

  it('compares against the lower PS equipped piece when multiple slots exist (e.g. rings)', () => {
    const hero = makeHero('Valeros', 'human', 'fighter', { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, {});
    
    const strongRing = rollItem(15, Math.random, 'ring', { source: 'boss' });
    strongRing.slot = 'ring';
    const weakRing = rollItem(2, Math.random, 'ring', { source: 'trash' });
    weakRing.slot = 'ring';

    hero.equipment.ring1 = strongRing;
    hero.equipment.ring2 = weakRing;

    const midRing = rollItem(8, Math.random, 'ring', { source: 'chest' });
    midRing.slot = 'ring';

    const bagPs = itemPoints(midRing);
    const lowerEquippedPs = Math.min(itemPoints(strongRing), itemPoints(weakRing));
    const expectedDiff = bagPs - lowerEquippedPs;

    const html = compareTooltipHTML(midRing, hero);

    expect(html).toContain(`<span>Power Score</span><b>${bagPs}</b>`);
    expect(html).toContain(`<span>Power Score</span><b>${lowerEquippedPs}</b>`);
    if (expectedDiff > 0) {
      expect(html).toContain(`<i class="tt-d pos">+${expectedDiff}</i>`);
    } else if (expectedDiff < 0) {
      expect(html).toContain(`<i class="tt-d neg">${expectedDiff}</i>`);
    }
  });
});
