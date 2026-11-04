/**
 * Screen-facing ribbon from one world point to another — how a VFX sheet that
 * IS a line (the Ray of Sickness ray: its source on the frame's left edge, its
 * tip on the right) is laid between caster and target.
 *
 * A plain sprite cannot do it: a sprite is always upright on screen, so a
 * horizontal ray sheet pointed screen-right whatever the direction of the
 * spell. The ribbon is a quad whose long axis is the real 3D line from→to and
 * whose width runs across that line in the camera's view plane, so on screen
 * the frame's left edge sits on the caster and its right edge on the target,
 * at any yaw or pitch. The width direction depends on the camera, so the quad
 * is rebuilt every frame from the rendering camera (entities.js
 * spawnSpanSheetEffect); the camera director sways the yaw and makes quarter
 * turns on its own, and the ray has to stay on the beam through all of it.
 *
 * Pure math, no THREE: points are {x,y,z}, the basis vectors [x,y,z].
 */

/**
 * The camera's screen-right and screen-up axes in world space for the
 * dungeon camera's yaw/pitch (render/dungeon_scene.js updateCam: the camera
 * sits along (cos p sin y, sin p, cos p cos y) from its target and looks at it
 * with world +Y up). The live game reads the same axes off the camera matrix;
 * this form is for tests and for callers without a camera.
 */
export function cameraBasisFromYawPitch(yaw, pitch) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  return {
    right: [cy, 0, -sy],
    up: [-sp * sy, cp, -sp * cy],
  };
}

/** Screen-right / screen-up axes from a camera's world matrix (column-major
 *  `elements`, as THREE stores them). */
export function cameraBasisFromMatrix(elements) {
  const e = elements;
  return {
    right: [e[0], e[1], e[2]],
    up: [e[4], e[5], e[6]],
  };
}

const dot = (v, x, y, z) => v[0] * x + v[1] * y + v[2] * z;

/**
 * Where `from`→`to` lands on screen, in world units (orthographic camera):
 * `length` is how long the line looks, `angle` its direction (radians, CCW
 * from screen-right).
 */
export function screenSpan(from, to, right, up) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const sx = dot(right, dx, dy, dz);
  const sy = dot(up, dx, dy, dz);
  return { length: Math.hypot(sx, sy), angle: Math.atan2(sy, sx), sx, sy };
}

/**
 * The ribbon's four corners, written into `out` (a 12-float array, reused
 * frame to frame) in the order
 *   0 from, lower edge   (u0 v0)
 *   1 to,   lower edge   (u1 v0)
 *   2 to,   upper edge   (u1 v1)
 *   3 from, upper edge   (u0 v1)
 * "Upper" is the screen-left side of the line looking from caster to target,
 * which keeps the texture a rotation of itself on screen, never a mirror.
 * When the line points straight into the screen there is no direction to
 * rotate to; the ribbon falls back to screen-up and has no length anyway.
 */
export function spanRibbon(from, to, right, up, halfWidth, out = new Array(12)) {
  const { sx, sy, length } = screenSpan(from, to, right, up);
  let nx, ny, nz;
  if (length > 1e-6) {
    /* Screen-perpendicular (-sy, sx), back in world space. */
    const a = -sy / length, b = sx / length;
    nx = a * right[0] + b * up[0];
    ny = a * right[1] + b * up[1];
    nz = a * right[2] + b * up[2];
  } else {
    nx = up[0]; ny = up[1]; nz = up[2];
  }
  const w = halfWidth;
  const put = (i, p, s) => {
    out[i] = p.x + s * w * nx; out[i + 1] = p.y + s * w * ny; out[i + 2] = p.z + s * w * nz;
  };
  put(0, from, -1);
  put(3, to, -1);
  put(6, to, 1);
  put(9, from, 1);
  return out;
}
