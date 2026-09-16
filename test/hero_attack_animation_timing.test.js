import { describe, it, expect, vi } from 'vitest';

if (typeof globalThis.Image === 'undefined') {
  class MockImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this._src = '';
    }
    get src() { return this._src; }
    set src(val) {
      this._src = val;
      setTimeout(() => { if (this.onload) this.onload(); }, 1);
    }
  }
  globalThis.Image = MockImage;
}

if (typeof globalThis.document === 'undefined') {
  const dummyCanvas = { width: 64, height: 64 };
  const dummyCtx = {
    canvas: dummyCanvas,
    font: '',
    measureText: () => ({ width: 10 }),
    strokeText: () => {},
    fillText: () => {},
    clearRect: () => {},
    fillRect: () => {},
    drawImage: () => {},
    getImageData: () => ({ data: new Uint8Array(4) }),
    putImageData: () => {}
  };
  dummyCanvas.getContext = () => dummyCtx;
  globalThis.document = {
    createElement: (tag) => {
      if (tag === 'canvas') return { ...dummyCanvas };
      return {};
    }
  };
}

import { HeroSprite } from '../src/game/sprite_animator.js';
import { combatMethods } from '../src/game/combat.js';

describe('Hero attack animation lifecycle and deferred roll timing', () => {
  it('calculates expected animation duration and speeds in HeroSprite', () => {
    const hero = {
      visual: {},
      equipment: { weapon: { baseKey: 'longsword' } },
      classKey: 'fighter'
    };
    const sprite = new HeroSprite(hero, 0xffffff);

    expect(sprite.resolveAttackAction()).toBe('slash');
    expect(sprite.attackDuration('slash')).toBeCloseTo(0.60, 2);

    expect(sprite.attackDuration('thrust')).toBeCloseTo(0.80, 2);
    expect(sprite.attackDuration('shoot')).toBeCloseTo(1.00, 2);
    expect(sprite.attackDuration('spellcast')).toBeCloseTo(7 / 9, 2);
  });

  it('HeroSprite plays full attack frames and automatically returns to walk at the end', () => {
    const hero = {
      visual: {},
      equipment: { weapon: { baseKey: 'greatsword' } },
      classKey: 'barbarian'
    };
    const sprite = new HeroSprite(hero, 0xffffff);

    sprite.play('slash');
    expect(sprite.state).toBe('slash');
    expect(sprite.isPlayingAttack()).toBe(true);

    // Update half-way through (3 frames / 10 fps = 0.3s)
    sprite.update(0.3);
    expect(sprite.state).toBe('slash');
    expect(sprite.isPlayingAttack()).toBe(true);

    // Update past full duration (0.6s total)
    sprite.update(0.35);
    expect(sprite.state).toBe('walk');
    expect(sprite.isPlayingAttack()).toBe(false);
  });

  it('heroPerformAttack plays animation first and defers roll and lunge to the end', () => {
    let pendingCallback = null;
    let scheduledDelay = 0;

    const game = {
      ...combatMethods,
      fxImpactDelay: vi.fn((delaySec, cb) => {
        scheduledDelay = delaySec;
        pendingCallback = cb;
      }),
      heroAttackRoll: vi.fn(),
      triggerLunge: vi.fn()
    };

    const mockAnim = {
      play: vi.fn(),
      isPlayingAttack: vi.fn(() => true),
      attackDuration: vi.fn(() => 0.60),
      resolveAttackAction: vi.fn(() => 'slash')
    };

    const hero = {
      x: 2,
      z: 2,
      data: { name: 'Valen', hp: 20, maxHp: 20, classKey: 'fighter' },
      ent: { anim: mockAnim }
    };

    const foe = {
      x: 3,
      z: 2,
      data: { name: 'Goblin', hp: 10, maxHp: 10 }
    };

    const delay = game.heroPerformAttack(hero, foe, [hero], {});

    // Animation started facing the target
    expect(mockAnim.play).toHaveBeenCalledWith('slash', true);
    expect(hero.attackTargetDX).toBe(1);
    expect(hero.attackTargetDZ).toBe(0);
    expect(delay).toBe(0.60);

    // Dice roll has NOT happened yet
    expect(game.heroAttackRoll).not.toHaveBeenCalled();
    expect(pendingCallback).not.toBeNull();
    expect(scheduledDelay).toBe(0.60);

    // Fire the deferred callback (representing the end of the animation)
    pendingCallback();

    // Now dice roll occurs!
    expect(game.heroAttackRoll).toHaveBeenCalledWith(hero, foe, [hero], {});
  });

  it('attack animation does not replay during lungeT', () => {
    const mockAnim = {
      play: vi.fn(),
      setDirection: vi.fn(),
      isPlayingAttack: vi.fn(() => false),
      mesh: { position: { y: 0 } }
    };

    const hero = {
      x: 2,
      z: 2,
      lungeT: 0.15,
      lungeDX: 1,
      lungeDZ: 0,
      data: { name: 'Valen', classKey: 'fighter' },
      ent: { anim: mockAnim }
    };

    const cosC = 1, sinC = 0;
    if (hero.ent.anim && hero.ent.anim.isPlayingAttack && hero.ent.anim.isPlayingAttack()) {
      hero.ent.anim.setDirection(hero.lungeDX, hero.lungeDZ);
    } else if (hero.lungeT > 0) {
      const rdx = hero.lungeDX * cosC - hero.lungeDZ * sinC;
      const rdz = hero.lungeDX * sinC + hero.lungeDZ * cosC;
      hero.ent.anim.setDirection(rdx, rdz);
    }

    expect(mockAnim.setDirection).toHaveBeenCalledWith(1, 0);
    expect(mockAnim.play).not.toHaveBeenCalled();
  });
});
