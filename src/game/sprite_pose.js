/* A sprite's cast and hit poses: anticipation and squash-and-stretch.

   A caster leans back from its target and settles low across the charge, then
   snaps through upright into a stretched lean at the moment the spell leaves,
   and springs back. A target takes the same in reverse: squashed flat in a
   single frame, pushed away from the source, and springing back.

   The pose reaches the sprite through a shader uniform (sprite_animator.js,
   configureSpriteMaterial), never mesh.scale or mesh.position: applyCell owns
   the scale and rewrites it mid-animation, and the hit shudder owns position.x.
   The quad bends around its pivot, so the feet stay planted. The skew direction
   is a world heading the shader turns into screen space, so it stays right
   however the camera swings.

   A pose is [scaleX, scaleY, skew], where positive skew leans the top of the
   sprite along the heading. Curves are pure so they can be tested headless. */

const LEAN_BACK = 0.22, SQUAT_X = 0.05, SQUAT_Y = 0.06;
const SNAP_SEC = 0.05, LEAN_OUT = 0.26, STRETCH_X = 0.07, STRETCH_Y = 0.10;
const CAST_SETTLE_SEC = 0.5;
const SQUISH_X = 0.20, SQUISH_Y = 0.22, PUSH = 0.20, HIT_SEC = 0.5;

const lerp = (a, b, k) => a + (b - a) * k;
/* A spring from 1: rings through zero and dies away. */
const spring = (t, decay, rate) => Math.exp(-decay * t) * Math.cos(rate * t);

/** The caster's pose `t` seconds into a charge of `windup` seconds; null once it has settled. */
export function castPoseAt(t, windup) {
  if (t < windup) {
    const u = t / windup, e = u * u * (3 - 2 * u);
    return [1 + SQUAT_X * e, 1 - SQUAT_Y * e, -LEAN_BACK * e];
  }
  const r = t - windup;
  if (r < SNAP_SEC) {
    const k = r / SNAP_SEC;
    return [lerp(1 + SQUAT_X, 1 - STRETCH_X, k), lerp(1 - SQUAT_Y, 1 + STRETCH_Y, k), lerp(-LEAN_BACK, LEAN_OUT, k)];
  }
  const after = r - SNAP_SEC;
  if (after >= CAST_SETTLE_SEC) return null;
  const a = spring(after, 8, 12);
  return [1 - STRETCH_X * a, 1 + STRETCH_Y * a, LEAN_OUT * a];
}

/** The target's pose `t` seconds after the hit; null once it has settled. */
export function hitPoseAt(t) {
  if (t >= HIT_SEC) return null;
  const a = spring(t, 7, 14);
  return [1 + SQUISH_X * a, 1 - SQUISH_Y * a, PUSH * a];
}

const uniformsOf = (v) => {
  const mat = v && v.anim && v.anim.mesh && v.anim.mesh.material;
  return mat && mat.userData && mat.userData.sprPose;
};

function write(v, pose) {
  const u = uniformsOf(v);
  if (u) u.pose.value.set(pose[0], pose[1], pose[2]);
}

function start(v, curve, dx, dz) {
  const u = uniformsOf(v);
  if (!u) return;
  const len = Math.hypot(dx, dz) || 1;
  u.dir.value.set(dx / len, dz / len);
  v._pose = { t: 0, curve };
  write(v, curve(0));
}

/** Lean `v` (an entity's visual) back from a target along world heading (dx, dz) for `windup` seconds, then snap. */
export function poseCast(v, dx, dz, windup) {
  start(v, (t) => castPoseAt(t, windup), dx, dz);
}

/** Squash `v` (an entity's visual), pushed along the blow's world heading (dx, dz). */
export function poseHit(v, dx, dz) {
  start(v, hitPoseAt, dx, dz);
}

/** Advance a running pose; the sprite returns to rest when it ends. */
export function tickPose(v, dt) {
  const p = v && v._pose;
  if (!p) return;
  p.t += dt;
  const pose = p.curve(p.t);
  if (pose) { write(v, pose); return; }
  write(v, [1, 1, 0]);
  v._pose = null;
}
