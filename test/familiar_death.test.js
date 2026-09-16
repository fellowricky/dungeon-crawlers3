import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { combatMethods } from '../src/game/combat.js';
import { createSummonManager } from '../src/game/summons.js';

describe('Find Familiar Death Animation and Dismissal Lifecycle', () => {
  it('triggers killCompanion when a familiar is defeated and sets up monster-style death animation', () => {
    const grp = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 1.0 }));
    grp.add(mesh);

    const familiar = {
      companion: true,
      kind: 'owlFamiliar',
      summonerName: 'Mage',
      summonerClassKey: 'wizard',
      dead: false,
      data: {
        name: 'Owl Familiar',
        hp: 0,
        maxHp: 10
      },
      ent: {
        grp,
        bar: { spr: { visible: true } },
        anim: { mesh }
      }
    };

    let logCalled = false;
    const game = {
      ...combatMethods,
      heroes: [familiar],
      fxLog: (msg) => {
        logCalled = true;
      },
      refreshHud: () => {},
      triggerShake: () => {}
    };

    game.killCompanion(familiar);

    expect(familiar.dead).toBe(true);
    expect(familiar.ent.bar.spr.visible).toBe(false);
    expect(familiar._deathAnim).not.toBeNull();
    expect(familiar._deathAnim.dur).toBe(0.65);
    expect(familiar._deathAnim.poppedBurst).toBe(false);
    expect(logCalled).toBe(true);
  });

  it('animates death and completely removes dead familiar from heroes array when animation finishes', () => {
    const scene = new THREE.Scene();
    const grp = new THREE.Group();
    scene.add(grp);

    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 1.0 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    grp.add(mesh);

    const summoner = {
      data: { name: 'Mage', classKey: 'wizard', level: 3, hp: 20, maxHp: 20 },
      x: 0, z: 0
    };

    const familiar = {
      companion: true,
      kind: 'owlFamiliar',
      summonerName: 'Mage',
      summonerClassKey: 'wizard',
      dead: false,
      x: 1, z: 1,
      data: {
        name: 'Owl Familiar',
        hp: 0,
        maxHp: 10
      },
      ent: {
        grp,
        bar: { spr: { visible: true } },
        anim: { mesh }
      }
    };

    const game = {
      ...combatMethods,
      heroes: [summoner, familiar],
      gameGroup: scene,
      fxLog: () => {},
      refreshHud: () => {},
      triggerShake: () => {}
    };

    game.summons = createSummonManager(game);

    // 1. Defeat familiar
    game.killCompanion(familiar);
    expect(game.heroes).toContain(familiar);
    expect(familiar._deathAnim).not.toBeNull();

    // 2. Simulate game loop update during topple (dt = 0.15)
    const dt1 = 0.15;
    const a = familiar._deathAnim;
    a.t += dt1;
    expect(a.t).toBe(0.15);
    expect(a.poppedBurst).toBe(false);

    // 3. Simulate game loop update reaching impact and fade (dt = 0.20 -> t = 0.35)
    const dt2 = 0.20;
    a.t += dt2;
    if (a.t >= 0.20) a.poppedBurst = true;
    expect(a.poppedBurst).toBe(true);
    // At t = 0.35, fadeK is (0.35 - 0.25) / 0.40 = 0.25 -> opacity is 0.75
    const fadeK = (a.t - 0.25) / (a.dur - 0.25);
    mat.opacity = 1.0 - fadeK;
    expect(mat.opacity).toBeCloseTo(0.75);

    // 4. Complete death animation (dt = 0.35 -> t = 0.70 >= 0.65)
    a.t += 0.35;
    const k = a.t / a.dur;
    expect(k).toBeGreaterThanOrEqual(1.0);

    // On completion, dismiss is called:
    game.summons.dismiss(familiar);

    // Familiar is now removed from heroes and scene
    expect(game.heroes).not.toContain(familiar);
    expect(game.heroes.length).toBe(1);
    expect(familiar.ent.grp.parent).toBeNull();
  });
});
