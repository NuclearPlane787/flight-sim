// v0.8.0 (legs): sparks under the parts that scrape in a belly slide (a gear-up landing or a leg missing). Small bright
// streaks thrown back and falling from each touching point, in the aircraft's own frame (the object goes in the
// aircraft's group, as the wheels' spray and the engine smoke do), more the faster the slide. A look only: nothing in
// the sim reads it. Behind ?sparks80=0 (node FS_SPARKS80=0), on by default: off, nothing is made. On, nothing is
// drawn (the object is invisible: no draw call) until the sim says a part scrapes (state.scraping) above 3 m/s.
//
//   const sparks = createSparks(geo);             // geo: the type's (or design's) geo, its CRASH_POINTS in body metres
//   aircraft.object.add(sparks.object);
//   sparks.update({ state, dt, paused });          // state: sim.state (scraping, gs, pitch, roll, engines)
//
// The sim's skid points aren't in its public state, so the points are the type's CRASH_POINTS with the sim's three
// extra belly points (sim.js's skidPoints(), the same rule), and those touching are the ones within TOUCH_M of the
// lowest of them for the aircraft's pitch and roll (while the sim says something scrapes, the lowest points are on
// the ground). [EST] the look: no reference for a spark's size or life was read; these are the eye's.

import * as THREE from '../../vendor/three.module.js';
import { toModel } from '../aircraft.js';

function lookSwitch(q, env) {   // as apron.js's
  try {
    const s = (typeof location !== 'undefined' && location && location.search) || '';
    const m = new RegExp(`[?&]${q}=([01])\\b`).exec(s);
    if (m) return m[1] === '1';
  } catch (e) { /* no location */ }
  try { if (typeof process !== 'undefined' && process.env && process.env[env] === '0') return false; } catch (e) { /* no process */ }
  return true;
}
export const SPARKS80 = lookSwitch('sparks80', 'FS_SPARKS80');

export const SPARK_MAX_POINTS = 16;
export const TOUCH_M = 0.15;      // a point within this of the lowest one is touching
export const MIN_GS = 3;          // m/s: below this, no sparks
const PER_POINT = 48;             // sprites per point
const LIFE_S = 0.45;              // how long a spark lives

// The points that can scrape (body metres, x forward, y left, z up): CRASH_POINTS and the sim's extra belly points.
export function sparkPoints(geo) {
  const cp = (geo && geo.CRASH_POINTS) || [];
  const nose = cp.find((c) => c.why === 'nose impact'), belly = cp.find((c) => c.why === 'belly impact'), tail = cp.find((c) => c.why === 'tail strike');
  // an engine's point: its engine (a design's say so; the base types' are in the engines' order)
  let ne = 0;
  const pts = cp.map((c) => ({ x: c.x, y: c.y, z: c.z, engine: c.engine ?? (c.why === 'engine strike' ? ne++ : undefined), why: c.why }));
  if (nose && belly) for (const f of [1 / 3, 2 / 3]) pts.push({ x: belly.x + f * (nose.x - belly.x), y: 0, z: belly.z, why: 'belly impact' });
  if (belly && tail) pts.push({ x: (belly.x + tail.x) / 2, y: 0, z: (belly.z + tail.z) / 2, why: 'belly impact' });
  return pts.slice(0, SPARK_MAX_POINTS);
}

// Each point's sparks, 0 (none) to 1, into out[]: pure, for the tests. Returns how many points spark.
export function sparkLevels(state, pts, out = new Array(pts.length).fill(0)) {
  out.fill(0);
  if (!state || !state.scraping || !((state.gs || 0) > MIN_GS)) return 0;
  const th = state.pitch || 0, ph = state.roll || 0;
  const sx = Math.sin(th), sy = Math.sin(ph) * Math.cos(th), sz = Math.cos(ph) * Math.cos(th);
  const eng = state.engines || [];
  let lo = Infinity;
  const up = (p) => sx * p.x + sy * p.y + sz * p.z;   // the point's height above the body origin's, up positive
  const gone = (p) => p.engine !== undefined && eng[p.engine] && eng[p.engine].off;
  for (const p of pts) if (!gone(p)) lo = Math.min(lo, up(p));
  const k = 0.35 + 0.65 * Math.min(1, (state.gs - MIN_GS) / 50);   // more the faster
  let n = 0;
  for (let i = 0; i < pts.length; i++) if (!gone(pts[i]) && up(pts[i]) - lo < TOUCH_M) { out[i] = k; n++; }
  return n;
}

const VERT = /* glsl */ `
  attribute vec4 aS;            // point index, phase, across (-1..1), up (0..1)
  uniform vec3 uP[${SPARK_MAX_POINTS}];
  uniform float uOn[${SPARK_MAX_POINTS}];
  uniform float uT, uGs;
  varying vec2 vUv;
  varying float vA;
  void main() {
    int e = int(aS.x + 0.5);
    float age = fract(uT / ${LIFE_S.toFixed(2)} * (0.7 + 0.6 * aS.y) + aS.y * 11.3);
    // Model space: x right, y up, z aft. Thrown back slower than the slide (the ground holds them), out and up, then falling.
    float t = age * ${LIFE_S.toFixed(2)};
    float back = (uGs * 0.55 + 4.0) * t * (0.6 + 0.4 * aS.w);
    float across = (1.5 + 3.0 * aS.w) * t * aS.z;
    float up = (1.2 + 3.0 * aS.w) * t - 4.9 * t * t;
    vec3 c = uP[e] + vec3(across, max(up, 0.0) + 0.05, back);
    vec4 mv = modelViewMatrix * vec4(c, 1.0);
    float size = 0.16 + 0.24 * (1.0 - age);   // [EST] (0.3 to 0.55 m read as cotton balls: the pictures review; small and hot now)
    mv.xy += (position.xy - 0.5) * size;
    gl_Position = projectionMatrix * mv;
    vUv = position.xy;
    // only some of the sprites at a low level: the fewer the slower
    float live = step(aS.y, uOn[e]);
    vA = live * (1.0 - age) * (1.0 - age);
  }
`;
const FRAG = /* glsl */ `
  varying vec2 vUv;
  varying float vA;
  void main() {
    if (vA < 0.002) discard;
    float d = length(vUv * 2.0 - 1.0);
    float a = (1.0 - smoothstep(0.0, 0.9, d)) * min(1.0, vA * 1.6);
    if (a < 0.002) discard;
    vec3 col = mix(vec3(1.0, 0.30, 0.04), vec3(1.0, 0.82, 0.35), vA);   // yellow-white where it leaves the metal, orange, then red as it dies
    gl_FragColor = vec4(col * 1.6, a);   // (2.2 read white by day after the tone mapping: v080-legs-a321neo-sparks-forced.png)
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createSparks(geo) {
  if (!SPARKS80) return null;
  const pts = sparkPoints(geo), np = Math.max(1, pts.length), n = PER_POINT * np;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const a = new Float32Array(n * 4);
  let r = 0x6a09e667;
  const rnd = () => { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; return ((r >>> 0) % 1e6) / 1e6; };
  for (let i = 0; i < n; i++) {
    a[i * 4] = Math.floor(i / PER_POINT);
    a[i * 4 + 1] = rnd();
    a[i * 4 + 2] = rnd() * 2 - 1;
    a[i * 4 + 3] = rnd();
  }
  g.setAttribute('aS', new THREE.InstancedBufferAttribute(a, 4));
  g.instanceCount = n;
  const P = [], on = [];
  for (let i = 0; i < SPARK_MAX_POINTS; i++) {
    const p = pts[Math.min(i, pts.length - 1)] || { x: 0, y: 0, z: 0 };
    P.push(toModel(p.x, p.y, p.z));
    on.push(0);
  }
  const u = { uP: { value: P }, uOn: { value: on }, uT: { value: 0 }, uGs: { value: 0 } };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const object = new THREE.Mesh(g, mat);
  object.name = 'sparks';
  object.frustumCulled = false;
  object.visible = false;
  object.renderOrder = 27;
  const lv = new Array(pts.length).fill(0);

  function update({ state, dt = 1 / 60, paused = false } = {}) {
    const k = sparkLevels(state, pts, lv);
    object.visible = k > 0;
    if (!object.visible) return;
    for (let i = 0; i < pts.length; i++) on[i] = lv[i];
    if (!paused) u.uT.value = (u.uT.value + dt) % 600;
    u.uGs.value = state.gs || 0;
  }
  return { object, update, points: pts };
}
