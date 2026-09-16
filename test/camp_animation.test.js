import { describe, it, expect } from 'vitest';

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
    querySelector: () => dummyEl,
    querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    appendChild: () => {}
  };
  globalThis.document = {
    createElement: () => dummyEl, createElementNS: () => dummyEl,
    getElementById: () => null, querySelector: () => dummyEl, querySelectorAll: () => [], body: dummyEl
  };
}

describe('Camp Animation Performance & Circular Fan-Out', () => {
  it('fans party out in an even circle around the fire before pitching tents', async () => {
    const THREE = await import('three');
    const { game } = await import('../src/game/game.js');

    game.gameGroup = new THREE.Group();
    const heroes = [
      { x: 10, z: 10, data: { hp: 10, maxHp: 20 }, ent: { grp: new THREE.Group() } },
      { x: 10, z: 10, data: { hp: 15, maxHp: 25 }, ent: { grp: new THREE.Group() } },
      { x: 10, z: 10, data: { hp: 12, maxHp: 22 }, ent: { grp: new THREE.Group() } },
      { x: 10, z: 10, data: { hp: 18, maxHp: 30 }, ent: { grp: new THREE.Group() } }
    ];

    const campX = 10, campZ = 10;
    game.beginCampAnimation(campX, campZ, heroes);
    expect(game.campAnim).toBeDefined();
    expect(game.campAnim.tents.length).toBe(4);

    // Initial stage (0 < t < 1.8s): heroes are visible, scale 1.0, walking to circle
    game.updateCampAnimation(0.9);
    expect(heroes[0].ent.grp.visible).toBe(true);
    expect(heroes[0].ent.grp.scale.x).toBe(1);
    expect(heroes[0].walk).toBe(true);

    // Complete walking stage (at t = 1.81s)
    game.updateCampAnimation(0.95);
    // Verify heroes are at 50% larger distance (1.5) from campfire
    for (let i = 0; i < heroes.length; i++) {
      const dist = Math.hypot(heroes[i].x - campX, heroes[i].z - campZ);
      expect(dist).toBeCloseTo(1.5, 1);
    }

    // Gathering stage (1.8s < t < 2.8s): heroes stand gathered around the warm fire before pitching tents
    game.updateCampAnimation(0.4); // t = 2.25s
    expect(heroes[0].ent.grp.visible).toBe(true);
    expect(heroes[0].ent.grp.scale.x).toBe(1);
    expect(heroes[0].walk).toBe(false);

    // Mid tent stage (t > 3.3s): heroes are inside resting
    game.updateCampAnimation(1.5); // t = 3.75s
    expect(heroes[0].ent.grp.visible).toBe(false);

    // Finish animation
    game.updateCampAnimation(15.0);
    expect(game.campAnim).toBeNull();
    expect(heroes[0].ent.grp.visible).toBe(true);
    expect(heroes[0].ent.grp.scale.x).toBe(1);
  });

  it('triggers campfire rest when party approaches shrine in exploration and heals party', async () => {
    const THREE = await import('three');
    const { game } = await import('../src/game/game.js');

    game.gameGroup = new THREE.Group();
    game.D = {
      W: 20, H: 20,
      grid: new Uint8Array(400),
      roomId: new Int16Array(400).fill(1)
    };
    game.wx = x => x;
    game.wz = y => y;
    game.cellOf = (x, z) => Math.round(z) * 20 + Math.round(x);

    const heroes = [
      { x: 5.5, z: 5.5, data: { name: 'Valeros', hp: 5, maxHp: 20, classKey: 'fighter' }, ent: { grp: new THREE.Group(), bar: { g: { clearRect: () => {}, fillRect: () => {} }, cv: { width: 64, height: 10 }, tex: {} } } }
    ];
    game.heroes = heroes;
    game.shrines = [{ x: 5, y: 5, roomId: 1, used: false }];

    // Near shrine (distance < 2.5)
    game.checkInteractables(heroes);
    expect(game.shrines[0].used).toBe(true);
    expect(game.campAnim).toBeDefined();

    // Advance full rest duration
    game.updateCampAnimation(10.0);
    expect(game.campAnim).toBeNull();
    expect(heroes[0].data.hp).toBe(20); // Healed to full on short rest
  });

  it('maps tent sprite perspective to camera angle facing the campfire', async () => {
    const { getTentFacingDir } = await import('../src/game/game.js');
    const campX = 0, campZ = 0;
    const tentX = 0, tentZ = 2; // Tent is South of fire, facing North (-Z)

    // Camera North of campfire looking at front entrance
    const camInFront = { position: { x: 0, z: -5 } };
    expect(getTentFacingDir(tentX, tentZ, campX, campZ, camInFront)).toBe('front');

    // Camera South of tent looking at back of tent
    const camBehind = { position: { x: 0, z: 8 } };
    expect(getTentFacingDir(tentX, tentZ, campX, campZ, camBehind)).toBe('back');

    // Camera East of tent looking at right side
    const camEast = { position: { x: 6, z: 2 } };
    expect(getTentFacingDir(tentX, tentZ, campX, campZ, camEast)).toBe('right');

    // Camera West of tent looking at left side
    const camWest = { position: { x: -6, z: 2 } };
    expect(getTentFacingDir(tentX, tentZ, campX, campZ, camWest)).toBe('left');
  });
});
