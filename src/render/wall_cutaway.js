/**
 * Wall cutaway: scenery standing between the camera and a body dissolves in a
 * dithered ellipse around that body.
 *
 * The low exploration camera (camera_director.js, CAM_EXPLORE_PITCH in
 * dungeon_scene.js) looks along the floor rather than down onto it, so the
 * wall row on the camera side of a corridor covers the party most of the time.
 * The director's only answer used to be tilting the camera up until it cleared
 * the wall, which throws the low angle away in exactly the places it shows the
 * most wall. Cutting the wall instead keeps the angle.
 *
 * Fragment-level, in view space, so it needs nothing from the geometry: a
 * fragment is cut when it sits in front of a body (closer to the camera along
 * the view axis, by at least `depth`) and inside an ellipse around that body
 * on screen. A wall behind or beside a hero is never touched. The edge is a
 * 4x4 ordered dither rather than a fade, which keeps the walls opaque (no
 * sorting, depth writes intact) and reads as pixel art.
 *
 * Shadows are untouched — the shadow pass uses its own depth material — so a
 * cut wall still throws its shadow, which is what keeps it reading as present.
 *
 * Console: __wallCutaway is the live tuning table; edits apply next frame.
 */
import * as THREE from 'three';

const CUT_MAX = 8;

/** Tuning, in world units (the ortho camera's view space is world-scaled). */
export const CUTAWAY = {
  rx: 1.3,          // ellipse half-width around a body
  ry: 1.8,          // half-height — bodies are tall
  lift: 1.1,        // ellipse centre above the feet: mid-body
  feather: 0.45,    // fraction of the radius given to the dithered edge
  depth: 0.35,      // how far in front of the body a fragment must be…
  depthFeather: 0.5,// …ramping to fully cut over this much more
  dither: 2,        // dither cell size in device pixels
  rate: 4           // per-second rate the effect fades in and out
};

export const cutawayUniforms = {
  uCutN: { value: 0 },
  uCutPts: { value: Array.from({ length: CUT_MAX }, () => new THREE.Vector3()) },
  uCutR: { value: new THREE.Vector2(CUTAWAY.rx, CUTAWAY.ry) },
  uCutFeather: { value: CUTAWAY.feather },
  uCutDepth: { value: new THREE.Vector2(CUTAWAY.depth, CUTAWAY.depthFeather) },
  uCutDither: { value: CUTAWAY.dither },
  uCutOn: { value: 0 }
};

const PARS = `
#define CUT_MAX ${CUT_MAX}
uniform int uCutN;
uniform vec3 uCutPts[CUT_MAX];
uniform vec2 uCutR;
uniform float uCutFeather;
uniform vec2 uCutDepth;
uniform float uCutDither;
uniform float uCutOn;
float cutBayer4(vec2 p) {
  ivec2 q = ivec2(mod(floor(p), 4.0));
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[q.x + q.y * 4]) + 0.5) / 16.0;
}
`;

const BODY = `
if (uCutOn > 0.001 && uCutN > 0) {
  vec3 cutFrag = -vViewPosition;
  float cut = 0.0;
  for (int i = 0; i < CUT_MAX; i++) {
    if (i >= uCutN) break;
    vec3 pv = (viewMatrix * vec4(uCutPts[i], 1.0)).xyz;
    float front = smoothstep(uCutDepth.x, uCutDepth.x + uCutDepth.y, cutFrag.z - pv.z);
    float r = length((cutFrag.xy - pv.xy) / uCutR);
    float inside = 1.0 - smoothstep(1.0 - uCutFeather, 1.0, r);
    cut = max(cut, front * inside);
  }
  if (cut * uCutOn > cutBayer4(gl_FragCoord.xy / uCutDither)) discard;
}
`;

/**
 * Add the cutaway to a lit mesh material, chained after any onBeforeCompile it
 * already has (the tile atlases carry one). Only materials whose fragment
 * shader declares vViewPosition qualify; anything else is returned untouched.
 *
 * The program cache key is extended rather than replaced: two materials that
 * shared a program before (matWall and matFloor both say 'atlas_lum_bump_tbn')
 * must stop sharing it once only one of them is cut.
 */
export function cutawayPatch(mat) {
  if (Array.isArray(mat)) { mat.forEach(cutawayPatch); return mat; }
  if (!mat || (mat.userData && mat.userData.cutaway)) return mat;
  if (!(mat.isMeshStandardMaterial || mat.isMeshLambertMaterial ||
        mat.isMeshPhongMaterial || mat.isMeshToonMaterial)) return mat;
  const prev = mat.onBeforeCompile;
  const baseKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = function (sh, renderer) {
    if (prev) prev.call(this, sh, renderer);
    Object.assign(sh.uniforms, cutawayUniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PARS)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + BODY);
  };
  mat.customProgramCacheKey = () => baseKey + '|cutaway';
  mat.userData.cutaway = true;
  mat.needsUpdate = true;
  return mat;
}

/**
 * Per-frame update: the bodies to keep visible (world positions of their feet,
 * at most CUT_MAX — callers list the party first) and whether the effect is
 * wanted. Fades rather than switching so toggling it is not a pop.
 */
export function updateCutaway(points, on, dt) {
  const U = cutawayUniforms;
  const n = Math.min(CUT_MAX, points ? points.length : 0);
  for (let i = 0; i < n; i++) {
    const p = points[i];
    U.uCutPts.value[i].set(p.x, (p.y || 0) + CUTAWAY.lift, p.z);
  }
  U.uCutN.value = n;
  U.uCutR.value.set(CUTAWAY.rx, CUTAWAY.ry);
  U.uCutFeather.value = CUTAWAY.feather;
  U.uCutDepth.value.set(CUTAWAY.depth, CUTAWAY.depthFeather);
  U.uCutDither.value = CUTAWAY.dither;
  const want = on ? 1 : 0;
  const k = 1 - Math.exp(-CUTAWAY.rate * Math.max(0, dt || 0));
  U.uCutOn.value += (want - U.uCutOn.value) * k;
  if (Math.abs(want - U.uCutOn.value) < 1e-3) U.uCutOn.value = want;
}

export const CUTAWAY_MAX = CUT_MAX;

if (typeof window !== 'undefined') window.__wallCutaway = CUTAWAY;
