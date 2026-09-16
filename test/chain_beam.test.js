import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { spawnBeamEffect, updateProjectiles } from '../src/game/entities.js';

/* The 'chain' beam type owns geometry that nothing else in entities.js does —
   a pool of link meshes plus a hook — so it also owns disposing them. These
   cover the shape of the animation and the teardown, which is where a leak
   would hide. */

const LINK_POOL = 20;      // links
const CHILDREN = LINK_POOL + 1;  // + the hook

function spawnChain(scene, follow, duration = 0.6) {
  spawnBeamEffect(scene,
    new THREE.Vector3(0, 0.7, 0),
    new THREE.Vector3(follow.position.x, 0.7, 0),
    { type: 'chain', color: 0x6e6963, duration, followTo: follow });
  return scene.children.find(c => c.type === 'Group');
}

const visibleLinks = (grp) => grp.children.filter(c => c.visible).length;

describe("chain beam ('Drag Them Back')", () => {
  it('throws out to full length, then sheds links as the victim is reeled in', () => {
    const scene = new THREE.Scene();
    const follow = { position: new THREE.Vector3(4, 0, 0) };
    const grp = spawnChain(scene, follow);

    expect(grp).toBeTruthy();
    expect(grp.children.length).toBe(CHILDREN);

    /* Throw phase: the chain is still leaving the hauler's fist. */
    const atRest = visibleLinks(grp);
    updateProjectiles(scene, 0.05);
    const throwing = visibleLinks(grp);
    expect(throwing).toBeGreaterThan(atRest);

    /* Fully extended across the 4-unit gap, at fixed link spacing. */
    updateProjectiles(scene, 0.10);
    const extended = visibleLinks(grp);
    expect(extended).toBeGreaterThan(throwing);

    /* Reel: the victim closes, and the chain must SHED links rather than
       bunch them up — constant spacing is what makes it read as a chain. */
    follow.position.x = 1.0;
    updateProjectiles(scene, 0.05);
    expect(visibleLinks(grp)).toBeLessThan(extended);
  });

  it('removes itself from the scene and disposes its geometry when it ends', () => {
    const scene = new THREE.Scene();
    const follow = { position: new THREE.Vector3(3, 0, 0) };
    const grp = spawnChain(scene, follow, 0.3);

    const linkGeo = grp.children[0].geometry;
    const mat = grp.children[0].material;
    let disposedGeo = false, disposedMat = false;
    linkGeo.addEventListener('dispose', () => { disposedGeo = true; });
    mat.addEventListener('dispose', () => { disposedMat = true; });

    updateProjectiles(scene, 0.4);

    expect(scene.children.includes(grp)).toBe(false);
    expect(disposedGeo).toBe(true);
    expect(disposedMat).toBe(true);
  });

  it('falls back to the cast-time position when nothing is being tracked', () => {
    /* followTo is optional — an ability can draw a chain without a pull. */
    const scene = new THREE.Scene();
    spawnBeamEffect(scene, new THREE.Vector3(0, 0.7, 0), new THREE.Vector3(5, 0.7, 0),
      { type: 'chain', duration: 0.4 });
    const grp = scene.children.find(c => c.type === 'Group');
    expect(grp).toBeTruthy();
    expect(() => updateProjectiles(scene, 0.1)).not.toThrow();
    updateProjectiles(scene, 0.5);
    expect(scene.children.includes(grp)).toBe(false);
  });
});
