/**
 * What magical Darkness looks like. The rules live in game/light_sources.js (DARK_ZONES); this is only the picture.
 *
 * Mask: every lit material gets a small fragment patch that multiplies its final light down inside each zone, so a
 * torch, a spell light or the sun all stop at the edge. It works per pixel, needs no post pass (POST is off on low
 * quality), and its uniforms are fixed-size, so a zone appearing mid-fight recompiles nothing. Materials are patched at
 * level load (darkMaskSweep); anything that slipped through is caught when the first zone appears.
 *
 * Dome: the Darkness spell's plain black bubble, a real hemisphere rather than a billboard so that its foot stays on
 * the zone's circle at every camera angle. Its edge steps in pixel blocks, like the live pixel effects.
 *
 * Both share one radius per zone, and both are spheres centred on the floor, so the dome is exactly where the dark is.
 *
 * Console: __darkness is the live tuning table.
 */
import * as THREE from 'three';
import { DARK_ZONES, zonePos } from '../game/light_sources.js';

const DARK_MAX = 8;

export const DARKNESS = {
  floor: 0.05,     // what's left of a lit surface inside the dark
  edge: 0.45,      // tiles of dithered edge
  dither: 2,       // dither cell, device pixels
  grow: 0.7,       // seconds to swell to full size
  shrink: 0.45,    // seconds to collapse when it ends or is dispelled
  pxPerUnit: 32,   // the dome's pixel size, matching the live pixel effects
};

export const darkUniforms = {
  uDarkN: { value: 0 },
  uDarkZones: { value: Array.from({ length: DARK_MAX }, () => new THREE.Vector4()) },
  uDarkFloor: { value: DARKNESS.floor },
  uDarkEdge: { value: DARKNESS.edge },
  uDarkDither: { value: DARKNESS.dither },
};

const PARS = `
#define DARK_MAX ${DARK_MAX}
uniform int uDarkN;
uniform vec4 uDarkZones[DARK_MAX];
uniform float uDarkFloor;
uniform float uDarkEdge;
uniform float uDarkDither;
float darkBayer4(vec2 p) {
  ivec2 q = ivec2(mod(floor(p), 4.0));
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[q.x + q.y * 4]) + 0.5) / 16.0;
}
float darkMask(vec3 viewPos) {
  vec3 world = transpose(mat3(viewMatrix)) * (viewPos - viewMatrix[3].xyz);
  float inside = 0.0;
  for (int i = 0; i < DARK_MAX; i++) {
    if (i >= uDarkN) break;
    float r = uDarkZones[i].w;
    inside = max(inside, 1.0 - smoothstep(r - uDarkEdge, r, distance(world, uDarkZones[i].xyz)));
  }
  return inside > darkBayer4(gl_FragCoord.xy / uDarkDither) ? uDarkFloor : 1.0;
}
`;
const BODY = `
if (uDarkN > 0) outgoingLight *= darkMask(-vViewPosition);
#include <opaque_fragment>`;

/** Add the mask to a lit material, chained after any onBeforeCompile it already has. Safe alongside cutawayPatch. */
export function darkMaskPatch(mat) {
  if (Array.isArray(mat)) { mat.forEach(darkMaskPatch); return mat; }
  if (!mat || (mat.userData && mat.userData.darkMask)) return mat;
  if (!(mat.isMeshStandardMaterial || mat.isMeshLambertMaterial || mat.isMeshPhongMaterial || mat.isMeshToonMaterial)) return mat;
  const prev = mat.onBeforeCompile;
  const baseKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = function (sh, renderer) {
    if (prev) prev.call(this, sh, renderer);
    Object.assign(sh.uniforms, darkUniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PARS)
      .replace('#include <opaque_fragment>', BODY);
  };
  mat.customProgramCacheKey = () => baseKey + '|dark_mask';
  mat.userData.darkMask = true;
  mat.needsUpdate = true;
  return mat;
}

/** Patch every lit material in a scene. Call before the level's shaders are warmed up. */
export function darkMaskSweep(scene) {
  if (scene) scene.traverse((o) => { if (o.material) darkMaskPatch(o.material); });
}

/* ── the dome ── */
const DOME_VERT = `
varying vec3 vP;
varying vec3 vN;
void main() {
  vP = position;
  vN = normalMatrix * normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const DOME_FRAG = `
precision highp float;
uniform float uK;
uniform float uBlock;
varying vec3 vP;
varying vec3 vN;
const vec3 C_BLACK = vec3(0.006, 0.006, 0.012);
const vec3 C_EDGE  = vec3(0.050, 0.050, 0.085);
void main() {
  /* read the surface at the centre of this fragment's pixel block, so its edge steps in big pixels */
  vec2 o = (floor(gl_FragCoord.xy / uBlock) + 0.5) * uBlock - gl_FragCoord.xy;
  vec3 n = normalize(vN + dFdx(vN) * o.x + dFdy(vN) * o.y);
  float rim = 1.0 - abs(n.z);
  float a = rim > 0.97 ? 1.0 : 0.8 + 0.15 * rim * rim;
  /* the palette above is written as it should look on screen; the renderer works in linear */
  gl_FragColor = vec4(pow(rim > 0.97 ? C_EDGE : C_BLACK, vec3(2.2)), a * uK);
  #include <colorspace_fragment>
}`;

let domeGeo = null, domeMat = null;
function makeDome() {
  if (!domeGeo) {
    domeGeo = new THREE.SphereGeometry(1, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2);
    domeMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT, fragmentShader: DOME_FRAG,
      uniforms: { uK: { value: 0 }, uBlock: { value: 2 } },
      transparent: true, depthWrite: false, fog: false, toneMapped: false,
    });
  }
  const mesh = new THREE.Mesh(domeGeo, domeMat.clone());
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    const tall = renderer.getRenderTarget() ? renderer.getRenderTarget().height : renderer.domElement.height;
    const worldPerPx = camera.isOrthographicCamera ? (camera.top - camera.bottom) / camera.zoom / tall : 0;
    mesh.material.uniforms.uBlock.value = worldPerPx > 0 ? Math.max(1, Math.round(1 / (DARKNESS.pxPerUnit * worldPerPx))) : 2;
  };
  return mesh;
}

/* ── per frame ── */
const shown = new Map();   // zone → { r, mesh, x, y, z, full }

function dropEntry(zone, e) {
  if (e.mesh) { if (e.mesh.parent) e.mesh.parent.remove(e.mesh); e.mesh.material.dispose(); }
  shown.delete(zone);
}

/**
 * Ease each zone's radius and publish them to the mask. `heightAt(x, z)` is the floor under a zone. A new zone swells
 * from its centre; one that has gone (expired, dispelled) collapses, so nothing pops.
 */
export function updateDarkness(scene, dt, heightAt) {
  if (!DARK_ZONES.size && !shown.size) return;
  let fresh = false;
  for (const zone of DARK_ZONES) {
    if (shown.has(zone)) continue;
    shown.set(zone, { r: 0, mesh: null, x: 0, y: 0, z: 0, full: zone.r });
    fresh = true;
  }
  if (fresh) darkMaskSweep(scene);   // a material that loaded late; everything else was patched at level load

  let n = 0;
  for (const [zone, e] of shown) {
    const alive = DARK_ZONES.has(zone);
    /* the level changed under it: its dome went with the old scene */
    if (e.mesh && e.mesh.parent !== scene) { dropEntry(zone, e); continue; }
    if (alive) {
      const p = zonePos(zone);
      e.x = p.x; e.z = p.z; e.y = heightAt ? heightAt(p.x, p.z) : 0; e.full = zone.r;
      e.r = Math.min(e.full, e.r + (e.full / Math.max(0.01, DARKNESS.grow)) * dt);
    } else {
      e.r -= (e.full / Math.max(0.01, DARKNESS.shrink)) * dt;
      if (e.r <= 0) { dropEntry(zone, e); continue; }
    }
    /* out of the origin quickly and easing to its size, rather than at a constant speed */
    const u = e.r / e.full, r = e.full * (1 - (1 - u) * (1 - u));
    if (n < DARK_MAX) darkUniforms.uDarkZones.value[n++].set(e.x, e.y, e.z, r);
    if (zone.dome && !e.mesh) { e.mesh = makeDome(); scene.add(e.mesh); }
    if (e.mesh) {
      e.mesh.position.set(e.x, e.y, e.z);
      e.mesh.scale.setScalar(Math.max(0.001, r));
      e.mesh.material.uniforms.uK.value = Math.min(1, u * 3);
    }
  }
  darkUniforms.uDarkN.value = n;
  darkUniforms.uDarkFloor.value = DARKNESS.floor;
  darkUniforms.uDarkEdge.value = DARKNESS.edge;
  darkUniforms.uDarkDither.value = DARKNESS.dither;
}

/** How many zones are being drawn, for tests. */
export const shownDarkZones = () => shown.size;

if (typeof window !== 'undefined') window.__darkness = DARKNESS;
