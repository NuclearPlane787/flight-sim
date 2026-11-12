// v0.4.2: spray from the wheels on a wet or snowy runway. Soft sprites thrown up and back from each leg's contact
// point, in the aircraft's own frame (the object goes in the aircraft's group), more of it the faster the roll and
// the wetter the runway: a wet runway's mist, more in heavy rain; snow's white powder; a little off ice. Visual only.
//
//   const spray = createSpray(GEAR, uniforms);   // GEAR: the type's legs in body metres (x forward, y left, z up)
//   aircraft.object.add(spray.object);
//   spray.update({ gs, onGround, wow, runway, rain, dt, paused });   // runway: 'dry' | 'wet' | 'snow' | 'ice'

import * as THREE from '../../vendor/three.module.js';
import { toModel } from '../aircraft.js';

const PER_LEG = 140;          // sprites per leg
const LIFE_S = 1.25;          // how long a sprite lives
const KT = 0.514444;

// How much spray a runway's state makes, before the speed (0..1).
export function sprayAmount(runway, rain, gs, onGround) {
  if (!onGround) return 0;
  const base = runway === 'wet' ? 0.55 + 0.45 * Math.min(1, Math.max(0, rain)) : runway === 'snow' ? 0.7 : runway === 'ice' ? 0.12 : 0;
  const x = Math.min(1, Math.max(0, (gs - 20 * KT) / (60 * KT)));
  return base * x * x * (3 - 2 * x);
}

const VERT = /* glsl */ `
  attribute vec4 aS;            // leg (0 nose, 1 left, 2 right), phase, across (-1..1), up (0..1)
  uniform vec3 uLeg0, uLeg1, uLeg2;
  uniform float uT, uGs, uAmt, uSnow;
  uniform vec3 uSunDir, uSunColor, uSkyAmb;
  uniform float uNight;
  varying vec2 vUv;
  varying float vA;
  varying vec3 vCol;
  void main() {
    float age = fract(uT / ${LIFE_S.toFixed(2)} * (0.8 + 0.4 * aS.y) + aS.y * 13.7);
    vec3 leg = aS.x < 0.5 ? uLeg0 : aS.x < 1.5 ? uLeg1 : uLeg2;
    // Model space: x right, y up, z aft. Thrown back nearly at the roll's speed, out and up, then settling.
    float back = uGs * ${LIFE_S.toFixed(2)} * age * (0.55 + 0.25 * aS.w);
    float across = (0.4 + 3.6 * age) * aS.z;    // ('out' is a GLSL keyword)
    float up = (0.15 + (aS.x < 0.5 ? 1.6 : 3.8) * aS.w) * age * (1.6 - age);
    vec3 c = leg + vec3(across, up, back);
    // A billboard in view space, growing as it spreads.
    vec4 mv = modelViewMatrix * vec4(c, 1.0);
    float size = (0.6 + 4.4 * age) * (uSnow > 0.5 ? 1.2 : 1.0);
    mv.xy += (position.xy - 0.5) * size;
    gl_Position = projectionMatrix * mv;
    vUv = position.xy;
    float legAmt = aS.x < 0.5 ? 0.45 : 1.0;   // the nose wheel throws less
    vA = uAmt * legAmt * smoothstep(0.0, 0.08, age) * (1.0 - age) * (1.0 - age) * 0.46;
    float sunUp = max(uSunDir.y, 0.0);
    vCol = (uSkyAmb * 1.25 + uSunColor * sunUp * 1.1) * (uSnow > 0.5 ? 1.05 : 0.9) + vec3(0.02) * (1.0 - uNight);
  }
`;
const FRAG = /* glsl */ `
  varying vec2 vUv;
  varying float vA;
  varying vec3 vCol;
  void main() {
    if (vA < 0.002) discard;
    float d = length(vUv * 2.0 - 1.0);
    float a = (1.0 - smoothstep(0.35, 1.0, d)) * vA;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vCol, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createSpray(GEAR, uniforms = {}) {
  const n = PER_LEG * 3;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const a = new Float32Array(n * 4);
  let r = 0x9e3779b9;
  const rnd = () => { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; return ((r >>> 0) % 1e6) / 1e6; };
  for (let i = 0; i < n; i++) {
    a[i * 4] = Math.floor(i / PER_LEG);
    a[i * 4 + 1] = rnd();
    a[i * 4 + 2] = rnd() * 2 - 1;
    a[i * 4 + 3] = rnd();
  }
  g.setAttribute('aS', new THREE.InstancedBufferAttribute(a, 4));
  g.instanceCount = n;
  const leg = (l) => toModel(l.x, l.y, l.z);
  const u = {
    uLeg0: { value: leg(GEAR.nose) }, uLeg1: { value: leg(GEAR.left) }, uLeg2: { value: leg(GEAR.right) },
    uT: { value: 0 }, uGs: { value: 0 }, uAmt: { value: 0 }, uSnow: { value: 0 },
    uSunDir: uniforms.uSunDir ?? { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: uniforms.uSunColor ?? { value: new THREE.Color(1, 1, 1) },
    uSkyAmb: uniforms.uSkyAmb ?? { value: new THREE.Color(0.3, 0.4, 0.5) },
    uNight: uniforms.uNight ?? { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const object = new THREE.Mesh(g, mat);
  object.name = 'spray';
  object.frustumCulled = false;
  object.visible = false;
  object.renderOrder = 25;

  function update({ gs = 0, onGround = false, runway = 'dry', rain = 0, dt = 1 / 60, paused = false } = {}) {
    const amt = sprayAmount(runway, rain, gs, onGround);
    object.visible = amt > 0.01;
    if (!object.visible) return;
    if (!paused) u.uT.value = (u.uT.value + dt) % 600;
    u.uGs.value = gs;
    u.uAmt.value = amt;
    u.uSnow.value = runway === 'snow' ? 1 : 0;
  }
  return { object, update };
}
