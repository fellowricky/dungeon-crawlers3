/**
 * Moonbeam's shaft: a real cone standing in the world, like a spotlight. Being geometry, the floor and whatever stands in
 * front of it cut it off properly from any camera angle, and its foot is always the circle on the floor, which a flat
 * billboard can only fake for one angle. It looks like pixel art because the shader works on positions snapped to the
 * game's art pixel: hard straight bands, a bright line down each silhouette edge, a brighter core. Additive: it adds light
 * to what's behind it. Depth-tested, never written, and only its near side is drawn, so it never lights itself twice.
 * A few twinkles hang inside it.
 */
import * as THREE from 'three';

const R_FOOT = 1.8, R_TOP = 0.75, HEIGHT = 9.5, ART_PX = 38 / 1.1;
const DROP = 0.22, SETTLE = 0.35, FADE_OUT = 0.35;

const VERT = /* glsl */`
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const FRAG = /* glsl */`
  uniform vec3 uAxis;       // the foot's centre
  uniform float uFront, uLift, uFade, uPx, uHeight, uFoot, uTop;
  uniform vec3 uEdge, uCore, uBody;
  varying vec3 vWorld;
  void main() {
    if (vWorld.y < uAxis.y + uFront) discard;                 // not yet struck this far down
    vec3 p = floor(vWorld * uPx) / uPx;                       // one art pixel: bands step, not slide
    float h = clamp((p.y - uAxis.y) / uHeight, 0.0, 1.0);
    vec2 n = normalize(p.xz - uAxis.xz);
    /* toward the camera, from its orientation: true of the game's orthographic camera, where its position says nothing */
    vec2 v = vec2(viewMatrix[0][2], viewMatrix[2][2]);
    float vl = length(v);
    float d = vl < 0.02 ? 1.0 : clamp(dot(n, v / vl), 0.0, 1.0); // 1 facing the camera, 0 at the silhouette
    float fade = (1.0 - smoothstep(0.82, 1.0, h)) * uFade;
    float q = sqrt(1.0 - d * d);                              // 0 the middle of the beam as seen, 1 its edge
    vec3 col; float a;
    float radius = mix(uFoot, uTop, h);
    float edge = 1.0 - 1.4 / (radius * uPx);                  // a line about one art pixel wide, whatever the width here
    if (q > edge) { col = uEdge; a = 0.85; }
    else if (q < 0.42) { col = uCore; a = 0.34 + uLift; }
    else { col = uBody; a = 0.2 + uLift; }
    col = mix(col, vec3(1.0), clamp(uLift * 2.0, 0.0, 1.0));
    gl_FragColor = vec4(col * a * fade, 1.0);
    #include <colorspace_fragment>
  }`;

/* The twinkles: points hanging inside the cone, each swelling from nothing to a one-pixel dot to a small cross and back on
   its own slow clock, rising very slightly so they read as light in the beam, never as something falling through it.
   Real points in the world, so the floor and foreground cut them off just as they do the cone. */
const TWINKLES = 46, TWINKLE_TOP = 6.5;

const SPARK_VERT = /* glsl */`
  attribute vec2 aClock;    // x: phase, y: speed
  uniform float uTime, uPxSize, uRise;
  varying float vK;
  void main() {
    float cycle = fract(aClock.x + uTime * aClock.y);
    vK = max(0.0, sin(cycle * 6.2832));                      // half of each cycle is dark
    vec3 pos = position;
    pos.y += uRise * cycle;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(pos, 1.0);
    gl_PointSize = uPxSize * (vK > 0.72 ? 3.0 : 1.0);         // a dot, or at its peak a three-pixel cross
    gl_Position.z -= 0.0005 * gl_Position.w;
  }`;

const SPARK_FRAG = /* glsl */`
  uniform float uFade;
  uniform vec3 uColor;
  varying float vK;
  void main() {
    if (vK < 0.12) discard;
    if (vK > 0.72) {                                          // the cross: no corners
      vec2 c = floor(gl_PointCoord * 3.0);
      if (c.x != 1.0 && c.y != 1.0) discard;
    }
    float a = vK > 0.72 ? 1.0 : vK > 0.4 ? 0.7 : 0.4;          // brightness in steps, like everything else here
    gl_FragColor = vec4(uColor * a * uFade, 1.0);
    #include <colorspace_fragment>
  }`;

function makeTwinkles(parent) {
  const pos = new Float32Array(TWINKLES * 3), clock = new Float32Array(TWINKLES * 2);
  for (let i = 0; i < TWINKLES; i++) {
    /* more of them low down, where the beam is brightest */
    const h = Math.pow(Math.random(), 1.5) * TWINKLE_TOP, r = R_FOOT + (R_TOP - R_FOOT) * (h / HEIGHT);
    const ang = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r * 0.9;
    pos[i * 3] = Math.cos(ang) * d; pos[i * 3 + 1] = h + 0.1; pos[i * 3 + 2] = Math.sin(ang) * d;
    clock[i * 2] = Math.random(); clock[i * 2 + 1] = 0.28 + Math.random() * 0.3;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aClock', new THREE.BufferAttribute(clock, 2));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPxSize: { value: 2 }, uRise: { value: 0.22 }, uFade: { value: 0 }, uColor: { value: new THREE.Color(0xf0f8ff) } },
    vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG,
    transparent: true, depthTest: true, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = 11;
  points.frustumCulled = false;
  parent.add(points);
  return { points, geo, mat };
}

/** A beam on the floor at (x, y, z). flash(k) whitens it, moveTo glides it, remove() fades and disposes it. */
export function spawnMoonbeamCone(scene, x, y, z) {
  const geo = new THREE.CylinderGeometry(R_TOP, R_FOOT, HEIGHT, 64, 1, true).translate(0, HEIGHT / 2, 0);
  const u = {
    uAxis: { value: new THREE.Vector3(x, y, z) }, uFront: { value: HEIGHT }, uLift: { value: 0.3 }, uFade: { value: 1 },
    uPx: { value: ART_PX }, uHeight: { value: HEIGHT }, uFoot: { value: R_FOOT }, uTop: { value: R_TOP },
    uEdge: { value: new THREE.Color(0xe0f4ff) }, uCore: { value: new THREE.Color(0x8cb4d4) }, uBody: { value: new THREE.Color(0x6288b4) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthTest: true, depthWrite: false, side: THREE.FrontSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;   // it has to keep ticking to finish its fade
  scene.add(mesh);
  const sparks = makeTwinkles(mesh);
  const bufSize = new THREE.Vector2();

  const born = performance.now();
  let last = born, flashK = 0, removedAt = null, glide = null;
  const dispose = () => { mesh.removeFromParent(); geo.dispose(); mat.dispose(); sparks.geo.dispose(); sparks.mat.dispose(); };

  mesh.onBeforeRender = (renderer, _scene, camera) => {
    const now = performance.now(), dt = (now - last) / 1000, age = (now - born) / 1000;
    last = now;
    const k = Math.min(1, age / DROP);
    u.uFront.value = HEIGHT * (1 - k * k * k);     // it strikes down from the top, accelerating
    u.uLift.value = 0.3 * Math.max(0, 1 - Math.max(0, age - DROP) / SETTLE) + 0.3 * flashK;
    flashK = Math.max(0, flashK - dt * 2.5);
    /* one art pixel on screen, at whatever zoom: an orthographic projection's scale over half the buffer's height */
    renderer.getDrawingBufferSize(bufSize);
    const pxSize = Math.max(1, camera.projectionMatrix.elements[5] * bufSize.y * 0.5 / ART_PX);
    const su = sparks.mat.uniforms;
    su.uTime.value = age;
    su.uPxSize.value = Math.round(pxSize);
    su.uFade.value = Math.min(1, Math.max(0, age - DROP) / 0.4);   // they come out once the beam has landed
    if (glide) {
      glide.t = Math.min(1, glide.t + dt / glide.dur);
      const e = glide.t * glide.t * (3 - 2 * glide.t);
      mesh.position.lerpVectors(glide.from, glide.to, e);
      u.uAxis.value.copy(mesh.position);
      if (glide.t >= 1) glide = null;
    }
    if (removedAt != null) {
      const f = 1 - (now - removedAt) / (FADE_OUT * 1000);
      u.uFade.value = Math.max(0, f);
      su.uFade.value = Math.max(0, f);
      if (f <= 0) dispose();
    }
  };

  return {
    flash(amount = 1) { flashK = Math.max(flashK, amount); },
    moveTo(nx, ny, nz, seconds = 0.5) {
      glide = { from: mesh.position.clone(), to: new THREE.Vector3(nx, ny, nz), t: 0, dur: Math.max(0.01, seconds) };
    },
    remove() { if (removedAt == null) removedAt = performance.now(); },
  };
}
