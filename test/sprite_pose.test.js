import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { castPoseAt, hitPoseAt, poseCast, poseHit, tickPose } from '../src/game/sprite_pose.js';

const WINDUP = 0.5;

/* A visual whose material carries the shader's uniforms, recording what they were set to. */
function visual() {
  const value = (init) => ({ value: { v: init, set(...a) { this.v = a; } } });
  const sprPose = { pose: value([1, 1, 0]), dir: value([0, 0]) };
  return { anim: { mesh: { material: { userData: { sprPose } } } } };
}
const poseOf = (v) => v.anim.mesh.material.userData.sprPose.pose.value.v;

describe('caster pose', () => {
  it('starts at rest and leans back from the target across the charge', () => {
    expect(castPoseAt(0, WINDUP)).toEqual([1, 1, -0]);
    const mid = castPoseAt(0.25, WINDUP), end = castPoseAt(0.49, WINDUP);
    expect(mid[2]).toBeLessThan(0);
    expect(end[2]).toBeLessThan(mid[2]);
    expect(end[1]).toBeLessThan(1);
  });

  it('snaps into a stretched forward lean within a few frames of release', () => {
    const p = castPoseAt(WINDUP + 0.05, WINDUP);
    expect(p[2]).toBeGreaterThan(0.2);
    expect(p[1]).toBeGreaterThan(1.05);
    expect(p[0]).toBeLessThan(1);
  });

  it('settles', () => {
    expect(castPoseAt(WINDUP + 1, WINDUP)).toBeNull();
  });
});

describe('target pose', () => {
  it('is squashed flat on the very first frame, pushed along the blow', () => {
    const [sx, sy, skew] = hitPoseAt(0);
    expect(sx).toBeGreaterThan(1.15);
    expect(sy).toBeLessThan(0.85);
    expect(skew).toBeGreaterThan(0.15);
  });

  it('settles', () => {
    expect(hitPoseAt(1)).toBeNull();
  });
});

describe('running a pose', () => {
  it('returns the sprite exactly to rest when it ends', () => {
    const v = visual();
    poseHit(v, 1, 0);
    expect(poseOf(v)[1]).toBeLessThan(1);
    for (let i = 0; i < 60; i++) tickPose(v, 1 / 60);
    expect(poseOf(v)).toEqual([1, 1, 0]);
    expect(v._pose).toBeNull();
  });

  it('normalises the heading it hands the shader', () => {
    const v = visual();
    poseCast(v, 3, 4, WINDUP);
    expect(v.anim.mesh.material.userData.sprPose.dir.value.v).toEqual([0.6, 0.8]);
  });

  it('ignores a visual with no sprite to bend, such as the training dummy', () => {
    const v = { bodyMat: {} };
    expect(() => { poseHit(v, 1, 0); tickPose(v, 0.1); }).not.toThrow();
  });
});

describe('the shader hook', () => {
  it('still finds the line it patches in three.js', () => {
    const src = fs.readFileSync('node_modules/three/src/renderers/shaders/ShaderLib/sprite.glsl.js', 'utf8');
    expect(src).toContain('vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;');
  });
});
