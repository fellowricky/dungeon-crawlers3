import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { monsterAiMethods } from '../src/game/monster_ai.js';
import { combatMethods } from '../src/game/combat.js';
import { sampleDissolvingPixels } from '../src/game/entities.js';

describe('Monster Death Evaporate Animation', () => {
  it('killMonster sets dead=true, hides overlays, and begins dissolve animation', () => {
    const scaleObj = {
      x: 1.0, y: 1.0, z: 1.0,
      set(x, y, z) { this.x = x; this.y = y; this.z = z; }
    };
    const monster = {
      x: 5,
      z: 5,
      dead: false,
      data: { hp: 0, gold: 10, name: 'Goblin' },
      ent: {
        grp: {
          visible: true,
          position: { set: () => {} },
          rotation: { x: 0, y: 0, z: 0 },
          scale: scaleObj
        },
        bar: { spr: { visible: true } },
        statusTray: { spr: { visible: true } },
        turnHighlight: { group: { visible: true } },
        anim: {
          setDirection: () => {},
          update: () => {},
          mesh: {
            position: { y: 0 },
            scale: scaleObj,
            material: { opacity: 1.0, transparent: false, alphaTest: 0.05, rotation: 0 }
          }
        }
      }
    };

    let evaporateStarted = 0;
    const evaporateSet = [];
    let pixels = 0;
    const game = Object.assign({}, monsterAiMethods, combatMethods, {
      monsters: [monster],
      heroes: [],
      gold: 0,
      lungeOffset: () => [0, 0],
      fxLog: () => {},
      fxBeginEvaporate: () => { evaporateStarted++; },
      fxSetEvaporate: (_mesh, dissolve) => {
        evaporateSet.push(dissolve);
        return { vMin: 0, vMax: 1, uMin: 0, uMax: 1 };
      },
      fxEvaporatePixels: (_pos, n) => { pixels += n; }
    });

    game.killMonster(monster, null);

    expect(monster.dead).toBe(true);
    expect(monster.ent.bar.spr.visible).toBe(false);
    expect(monster._deathAnim).toBeDefined();
    expect(monster._deathAnim.kind).toBe('evaporate');
    expect(monster.ent.grp.visible).toBe(true);

    game.updateMonsterVisuals(0.2, 0.2, 1, 0);
    expect(evaporateStarted).toBe(1);
    expect(monster.ent.anim.mesh.material.rotation).toBe(0);
    expect(monster.ent.grp.visible).toBe(true);
    expect(evaporateSet[evaporateSet.length - 1]).toBeGreaterThan(0);
    expect(pixels).toBeGreaterThan(0);

    game.updateMonsterVisuals(0.4, 0.6, 1, 0);
    expect(monster.ent.grp.visible).toBe(true);
    expect(monster.ent.anim.mesh.material.rotation).toBe(0);

    game.updateMonsterVisuals(0.6, 1.2, 1, 0);
    expect(monster.ent.grp.visible).toBe(true);

    game.updateMonsterVisuals(0.9, 2.1, 1, 0);
    expect(monster.ent.grp.visible).toBe(false);
    expect(monster._deathAnim).toBeNull();
  });

  it('samples dissolving pixels from the current sprite row (head vs feet)', () => {
    const w = 8, h = 8;
    const data = new Uint8ClampedArray(w * h * 4);
    const put = (x, y, r, g, b) => {
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (y < 2) put(x, y, 255, 255, 255);      // transparent padding (overwritten)
        if (y < 2) { const i = (y * w + x) * 4; data[i + 3] = 0; continue; }
        if (y < 4) put(x, y, 204, 32, 32);        // head (red)
        else if (y < 6) put(x, y, 192, 192, 200); // silver mail
        else put(x, y, 170, 48, 48);               // feet
      }
    }
    const mesh = {
      material: {
        color: new THREE.Color(1, 1, 1),
        map: {
          image: { width: w, height: h },
          flipY: true,
          offset: { x: 0, y: 0 },
          repeat: { x: 1, y: 1 },
          userData: { _pixelData: data, _pixelW: w, _pixelH: h, _pixelFlipY: true }
        }
      }
    };

    const avgG = (arr) => arr.reduce((s, p) => s + p.g, 0) / arr.length;
    const head = sampleDissolvingPixels(mesh, 0.05, 20);
    const mail = sampleDissolvingPixels(mesh, 0.5, 24);
    expect(head.length).toBeGreaterThan(0);
    expect(mail.length).toBeGreaterThan(0);
    expect(avgG(mail)).toBeGreaterThan(avgG(head));
  });

  it('restores natural sprite color on death and moves particle height from top down', () => {
    const scaleObj = {
      x: 1.2, y: 1.4, z: 1.0,
      set(x, y, z) { this.x = x; this.y = y; this.z = z; }
    };
    const matColor = new THREE.Color(0xff6050); // stuck hit flash red
    const monster = {
      x: 3,
      z: 4,
      dead: false,
      data: { hp: 0, gold: 5, name: 'Orc' },
      ent: {
        flashT: 0.15,
        grp: {
          visible: true,
          position: { x: 3, y: 0, z: 4, set: () => {} },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1.0, y: 1.0, z: 1.0 }
        },
        bar: { spr: { visible: true } },
        statusTray: { spr: { visible: true } },
        turnHighlight: { group: { visible: true } },
        anim: {
          setDirection: () => {},
          update: () => {},
          mesh: {
            position: { y: 0 },
            scale: scaleObj,
            material: { color: matColor, opacity: 1.0, transparent: false, alphaTest: 0.05, rotation: 0 }
          }
        }
      }
    };

    const spawnedHeights = [];
    const game = Object.assign({}, monsterAiMethods, combatMethods, {
      monsters: [monster],
      heroes: [],
      gold: 0,
      lungeOffset: () => [0, 0],
      fxLog: () => {},
      fxBeginEvaporate: (mesh) => {
        if (mesh.material.color) mesh.material.color.setRGB(1, 1, 1);
      },
      fxSetEvaporate: () => ({ vMin: 0, vMax: 1, uMin: 0, uMax: 1 }),
      fxEvaporatePixels: (pos) => {
        spawnedHeights.push(pos.y);
      }
    });

    game.killMonster(monster, null);

    /* The killing blow keeps its hit flash — the dissolve is held (holdT)
       until the flash has played, rather than clearing flashT on the spot and
       robbing the one hit that most deserves it. The colour is reset by the
       evaporate hook; the flash timer is left to run down. */
    expect(monster.ent.flashT).toBeGreaterThan(0);
    expect(monster._deathAnim && monster._deathAnim.holdT).toBeDefined();

    // Initial death tick: the dissolve starts (natural colour restored by the
    // evaporate hook) and the height should be near the top of the sprite.
    game.updateMonsterVisuals(0.08, 0.08, 1, 0);
    expect(monster.ent.anim.mesh.material.color.r).toBe(1);
    expect(monster.ent.anim.mesh.material.color.g).toBe(1);
    expect(monster.ent.anim.mesh.material.color.b).toBe(1);
    expect(spawnedHeights.length).toBeGreaterThan(0);
    const topH = spawnedHeights[0];
    expect(topH).toBeGreaterThan(1.0); // well above 0.5/feet

    // Later death tick: height should descend towards bottom
    game.updateMonsterVisuals(0.6, 0.68, 1, 0);
    const midH = spawnedHeights[spawnedHeights.length - 1];
    expect(midH).toBeLessThan(topH);

    game.updateMonsterVisuals(0.8, 1.48, 1, 0);
    const lowH = spawnedHeights[spawnedHeights.length - 1];
    expect(lowH).toBeLessThan(midH);
  });
});

