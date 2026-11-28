// v0.8.0: the smoke of an engine on fire. Soft dark sprites trailing from each burning engine's nacelle, with a glow
// at the nacelle, in the aircraft's own frame (the object goes in the aircraft's group, as the wheels' spray does).
// A look only: nothing in the sim reads it. Behind ?smoke80=0 (node FS_SMOKE80=0), on by default: off, nothing is
// made. On, nothing is drawn (the object is invisible: no draw call) until an engine burns, so with no fire the
// game draws what v0.7.9 drew.
//
//   const smoke = createEngineSmoke(NACELLES, uniforms);   // the type's nacelles in body metres (x forward, y left, z up)
//   aircraft.object.add(smoke.object);
//   smoke.update({ engines, tas, dt, paused });             // engines: sim.state.engines ([{ fire }])

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
export const SMOKE80 = lookSwitch('smoke80', 'FS_SMOKE80');

export const SMOKE_MAX_ENGINES = 8;
const PER_ENGINE = 128;       // sprites per engine
const LIFE_S = 1.4;           // how long a sprite lives (at 170 kt the plume is about 120 m long: a sprite a metre, each metres wide)

// Which engines smoke: a bit each (the fire burning). Pure, for the tests.
export function burningMask(engines) {
  let m = 0;
  for (let i = 0; engines && i < engines.length && i < SMOKE_MAX_ENGINES; i++) if (engines[i] && engines[i].fire) m |= 1 << i;
  return m;
}

const VERT = /* glsl */ `
  attribute vec4 aS;            // engine index, phase, across (-1..1), up (-1..1)
  uniform vec3 uEng[${SMOKE_MAX_ENGINES}];
  uniform float uBurn[${SMOKE_MAX_ENGINES}];
  uniform float uT, uTas;
  uniform vec3 uSunDir, uSunColor, uSkyAmb;
  uniform float uNight;
  varying vec2 vUv;
  varying float vA;
  varying vec3 vCol;
  void main() {
    int e = int(aS.x + 0.5);
    float age = fract(uT / ${LIFE_S.toFixed(2)} * (0.85 + 0.3 * aS.y) + aS.y * 17.3);
    // Model space: x right, y up, z aft. Left behind at the airspeed (it stops in the air the aircraft has left),
    // spreading and, standing still, rising.
    float still = 1.0 - clamp(uTas / 25.0, 0.0, 1.0);
    float back = uTas * ${LIFE_S.toFixed(2)} * age * (0.9 + 0.1 * aS.w) + 1.5;
    float spread = 0.35 + (1.6 + 0.03 * uTas) * age;
    vec3 c = uEng[e] + vec3(aS.z * spread, aS.w * spread * 0.7 + still * 9.0 * age * (0.6 + 0.4 * aS.y), back);
    vec4 mv = modelViewMatrix * vec4(c, 1.0);
    float size = 1.8 + (6.0 + 0.04 * uTas) * age;
    mv.xy += (position.xy - 0.5) * size;
    gl_Position = projectionMatrix * mv;
    vUv = position.xy;
    vA = uBurn[e] * smoothstep(0.0, 0.02, age) * (1.0 - age * age) * 0.62;
    // The flame's glow at the nacelle fading into dark smoke lit by the sky.
    float glow = 1.0 - smoothstep(0.0, 0.045, age);
    float flick = 0.75 + 0.25 * sin(uT * 23.0 + aS.y * 40.0);
    vec3 smoke = (uSkyAmb * 0.9 + uSunColor * max(uSunDir.y, 0.0) * 0.5) * (0.07 + 0.10 * age) + vec3(0.01);   // black at the engine, greying as it thins
    vCol = mix(smoke, vec3(1.0, 0.42, 0.08) * (1.4 * flick), glow);
  }
`;
const FRAG = /* glsl */ `
  varying vec2 vUv;
  varying float vA;
  varying vec3 vCol;
  void main() {
    if (vA < 0.002) discard;
    float d = length(vUv * 2.0 - 1.0);
    float a = (1.0 - smoothstep(0.3, 1.0, d)) * vA;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vCol, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// NACELLES: the type's (or the design's) engines' nacelle centres, body metres; at most SMOKE_MAX_ENGINES are used.
export function createEngineSmoke(NACELLES, uniforms = {}) {
  if (!SMOKE80) return null;
  const ne = Math.min(SMOKE_MAX_ENGINES, NACELLES.length), n = PER_ENGINE * ne;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const a = new Float32Array(n * 4);
  let r = 0x2545f491;
  const rnd = () => { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; return ((r >>> 0) % 1e6) / 1e6; };
  for (let i = 0; i < n; i++) {
    a[i * 4] = Math.floor(i / PER_ENGINE);
    a[i * 4 + 1] = rnd();
    a[i * 4 + 2] = rnd() * 2 - 1;
    a[i * 4 + 3] = rnd() * 2 - 1;
  }
  g.setAttribute('aS', new THREE.InstancedBufferAttribute(a, 4));
  g.instanceCount = n;
  const eng = [], burn = [];
  for (let i = 0; i < SMOKE_MAX_ENGINES; i++) {
    const p = NACELLES[Math.min(i, ne - 1)];
    eng.push(toModel(p.x - 1.2, p.y, p.z));   // a little aft of the nacelle's middle
    burn.push(0);
  }
  const u = {
    uEng: { value: eng }, uBurn: { value: burn }, uT: { value: 0 }, uTas: { value: 0 },
    uSunDir: uniforms.uSunDir ?? { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: uniforms.uSunColor ?? { value: new THREE.Color(1, 1, 1) },
    uSkyAmb: uniforms.uSkyAmb ?? { value: new THREE.Color(0.3, 0.4, 0.5) },
    uNight: uniforms.uNight ?? { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const object = new THREE.Mesh(g, mat);
  object.name = 'engine-smoke';
  object.frustumCulled = false;
  object.visible = false;
  object.renderOrder = 26;

  function update({ engines, tas = 0, dt = 1 / 60, paused = false } = {}) {
    const m = burningMask(engines);
    object.visible = m !== 0;
    if (!object.visible) return;
    for (let i = 0; i < SMOKE_MAX_ENGINES; i++) burn[i] = m & (1 << i) ? 1 : 0;
    if (!paused) u.uT.value = (u.uT.value + dt) % 600;
    u.uTas.value = tas;
  }
  return { object, update };
}
