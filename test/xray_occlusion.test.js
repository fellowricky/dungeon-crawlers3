/* ─────────────── X-ray silhouettes through walls ───────────────
 * Occluded heroes/monsters get a translucent twin so they stay readable behind
 * geometry. The twin is a child Sprite whose material draws only where the
 * depth buffer already holds something nearer (depthFunc GreaterDepth), which
 * is the per-pixel definition of "occluded" — no CPU raycast per entity.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { attachXrayGhost, XRAY_HERO_TINT, XRAY_FOE_TINT } from '../src/game/entities.js';
import { configureSpriteMaterial } from '../src/game/sprite_animator.js';

/** A stand-in for an entity's animated sprite, built the way the real ones are. */
function fakeAnim(opts = {}) {
  const mat = configureSpriteMaterial(new THREE.SpriteMaterial({
    map: opts.map === null ? null : new THREE.Texture(),
    transparent: true, depthTest: true, depthWrite: false
  }));
  const mesh = new THREE.Sprite(mat);
  mesh.renderOrder = 10;
  if (opts.center) mesh.center.copy(opts.center);
  return { mesh };
}

describe('X-ray silhouette material', () => {
  let ghost;
  beforeAll(() => { ghost = attachXrayGhost(fakeAnim(), XRAY_HERO_TINT); });

  it('draws only where something nearer has already been drawn', () => {
    // The whole feature rests on this comparison. LessEqualDepth (the default)
    // would draw the twin where the entity is *visible*, doubling it up.
    expect(ghost.material.depthFunc).toBe(THREE.GreaterDepth);
    expect(ghost.material.depthTest).toBe(true);
    // Never contribute depth of its own.
    expect(ghost.material.depthWrite).toBe(false);
  });

  it('is translucent and tinted, and draws after the real sprite', () => {
    expect(ghost.material.transparent).toBe(true);
    expect(ghost.material.opacity).toBeGreaterThan(0);
    expect(ghost.material.opacity).toBeLessThan(1);
    expect(ghost.material.color.getHex()).toBe(XRAY_HERO_TINT);
    expect(ghost.renderOrder).toBeGreaterThan(10);
  });

  it('parents to the sprite so transform and visibility are inherited', () => {
    const anim = fakeAnim();
    const g = attachXrayGhost(anim, XRAY_FOE_TINT);
    expect(g.parent).toBe(anim.mesh);
    expect(anim.xray).toBe(g);

    // Hiding the entity hides the twin — this is what stops an unseen monster
    // leaking its position through a wall.
    anim.mesh.visible = false;
    let reached = false;
    anim.mesh.traverseVisible(o => { if (o === g) reached = true; });
    expect(reached).toBe(false);
  });

  it('flattens to a silhouette but keeps the sprite alpha shape', () => {
    const shader = { vertexShader: 'mvPosition.xy += rotatedPosition;', fragmentShader: FRAG };
    ghost.material.onBeforeCompile(shader, null);
    // Colour comes from the tint, not the texture...
    expect(shader.fragmentShader).toContain('outgoingLight = diffuse;');
    expect(shader.fragmentShader).not.toContain('outgoingLight = diffuseColor.rgb;');
    // ...while alpha still flows from map_fragment through opaque_fragment.
    expect(shader.fragmentShader).toContain('#include <map_fragment>');
    expect(shader.fragmentShader).toContain('#include <opaque_fragment>');
  });

  it('keeps the depth-tilt vertex patch the real sprites use', () => {
    // Without it the twin is compared against walls at a different depth than
    // the sprite it stands in for.
    const shader = { vertexShader: 'mvPosition.xy += rotatedPosition;', fragmentShader: FRAG };
    ghost.material.onBeforeCompile(shader, null);
    expect(shader.vertexShader).toContain('mvPosition.z += zOffset');
  });

  it('does not share a program cache key with the opaque sprites', () => {
    // Same key + different fragment shader = three hands back the opaque
    // sprite's compiled program and the silhouette quietly stops existing.
    const plain = configureSpriteMaterial(new THREE.SpriteMaterial({}));
    expect(ghost.material.customProgramCacheKey()).not.toBe(plain.customProgramCacheKey());
  });
});

describe('X-ray silhouette frame sync', () => {
  it('follows the animation frame, center and rotation', () => {
    const anim = fakeAnim();
    const g = attachXrayGhost(anim, XRAY_HERO_TINT);

    const nextFrame = new THREE.Texture();
    anim.mesh.material.map = nextFrame;
    anim.mesh.material.rotation = 0.8;
    anim.mesh.center.set(0.5, 0.25);

    g.onBeforeRender();

    expect(g.material.map).toBe(nextFrame);
    expect(g.material.rotation).toBeCloseTo(0.8);
    expect(g.center.y).toBeCloseTo(0.25);
  });

  /* `needsUpdate` is a write-only setter in three — reading it gives undefined.
     It bumps `version`, which is what actually triggers the recompile, so that
     is what these assert on. */
  it('recompiles when the sprite gains a texture it did not have', () => {
    // null -> Texture flips the USE_MAP define; without the recompile the twin
    // renders as a solid tinted rectangle.
    const anim = fakeAnim({ map: null });
    const g = attachXrayGhost(anim, XRAY_HERO_TINT);
    const before = g.material.version;

    anim.mesh.material.map = new THREE.Texture();
    g.onBeforeRender();

    expect(g.material.map).not.toBeNull();
    expect(g.material.version).toBeGreaterThan(before);
  });

  it('does not force a recompile on an ordinary frame swap', () => {
    const anim = fakeAnim();
    const g = attachXrayGhost(anim, XRAY_HERO_TINT);
    g.onBeforeRender();
    const before = g.material.version;

    anim.mesh.material.map = new THREE.Texture();
    g.onBeforeRender();

    expect(g.material.version).toBe(before);
  });
});

/* three's sprite fragment shader, as of the pinned version — the patch above
   matches against these exact lines, so a three upgrade that rewrites them
   should fail here rather than silently render un-tinted twins. */
const FRAG = `
void main() {
\tvec4 diffuseColor = vec4( diffuse, opacity );
\tvec3 outgoingLight = vec3( 0.0 );
\t#include <map_fragment>
\t#include <alphatest_fragment>
\toutgoingLight = diffuseColor.rgb;
\t#include <opaque_fragment>
}
`;
