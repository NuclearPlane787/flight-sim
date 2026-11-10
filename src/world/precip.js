// v0.4.0: rain and snow around the camera, and drops on the windshield in the cockpit views.
//
//   const precip = createPrecip(scene, uniforms);
//   precip.setWeather(settings);    // normalizeWeather()'s shape, or null for the default weather
//   precip.update({ camera, origin, state, dt, paused, cockpit });
//   precip.stats                    // { kind, rate, intensity, ceilingM, particles, drops, drawCalls }
//
// Two objects, each one instanced draw of quads whose motion is all in the vertex shader, so a
// frame costs a few uniforms however hard it rains. Both hide in clear weather (no draw call):
//
//   particles  A box of points around the camera. Each sits at (its seeded place + one shared
//              offset) wrapped into the box, and the offset is the air's velocity relative to the
//              camera, integrated. The camera never leaves the box, so nothing runs out. A particle
//              draws as a segment along that velocity, as long as it moves in an exposure.
//   drops      Beads on a sphere around the eye, turned with the aircraft. The cockpit's walls
//              are nearer than the sphere and the world further, so the depth test alone leaves
//              only what lands in the window openings, for any type's windows.
//
// The cockpit flag: update({ cockpit }) if the caller passes one; otherwise camera.near < 0.1,
// which only the two seat views use (camera.js).
//
// Rain and snow fall only below the lowest cloud layer's base, and fade over FADE_M around it.
// With no layers at all they stop at NO_CLOUD_TOP_M. baseFt is read as feet above sea level.
//
// Visual only: the sim never reads this, and the particles are seeded from settings.seed.

import * as THREE from '../../vendor/three.module.js';

const FT = 0.3048, DEG = Math.PI / 180;

export const BOX_M = 80;               // the box's side
export const RAIN_MAX = 8000, SNOW_MAX = 6000, DROPS_MAX = 420;
const NO_CLOUD_TOP_M = 6000;           // no layers set: a rain-bearing cloud's top, about 20,000 ft
const FADE_M = 60;                     // the band around the cloud base that the fall fades over
const CAP_DT = 0.1;                    // s: a long frame moves the particles no further than this
const NEAR_M = 1.5, NEAR_COCKPIT_M = 4;// no particles this close to the eye (seats: none inside the flight deck)
const DROP_SHELL_M = 3;                // outside any type's flight-deck walls, inside the wing and the world

// A particle's own fall through the air, m/s, by the rate (the bigger drops of heavy rain fall faster).
export const fallSpeed = (kind, rate) => (kind === 'snow' ? 1.2 : 4 + 3.5 * rate);

// The altitude MSL (m) where the fall stops: the base of the lowest layer with any cover.
export function ceilingM(settings) {
  let ft = Infinity;
  for (const c of settings?.clouds ?? []) if (c.okta > 0 && c.baseFt < ft) ft = c.baseFt;
  return ft === Infinity ? NO_CLOUD_TOP_M : ft * FT;
}

// 0..1: how much of the fall is left at this altitude (a band of FADE_M centred on the ceiling).
export function fallAt(altM, ceiling) {
  const t = Math.min(1, Math.max(0, (altM - (ceiling - FADE_M / 2)) / FADE_M));
  return 1 - t * t * (3 - 2 * t);
}

// A particle's velocity relative to the aircraft, in the scene frame (X = map x, Y = up, Z = −map y):
// the wind (towards), minus its fall, minus the aircraft's own velocity.
export function relativeAir(state, fall, out = [0, 0, 0]) {
  const v = state?.vel, w = state?.wind;
  out[0] = (w?.x ?? 0) - (v?.x ?? 0);
  out[1] = (w?.z ?? 0) - fall - (v?.z ?? 0);
  out[2] = -((w?.y ?? 0) - (v?.y ?? 0));
  return out;
}

// Seeded (mulberry32): the same weather makes the same particles.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The particles' [x, y, z, w], each 0..1.
export function fillParticles(arr, seed) {
  const r = prng(Math.imul(seed ^ 0x51ed270b, 0x9e3779b1));
  for (let i = 0; i < arr.length; i++) arr[i] = r();
  return arr;
}

// The drops' [azimuth (rad), elevation (rad), size (m), phase]. Azimuths and elevations cover every
// window of every type; whatever falls on the walls is hidden by the depth test.
export function fillDrops(arr, seed) {
  const r = prng(Math.imul(seed ^ 0x2f6e2b1d, 0x85ebca6b));
  for (let i = 0; i < arr.length; i += 4) {
    arr[i] = (r() * 2 - 1) * 120 * DEG;
    arr[i + 1] = (-34 + 62 * r()) * DEG;
    arr[i + 2] = 0.012 + 0.024 * r() * r();
    arr[i + 3] = r();
  }
  return arr;
}

const COMMON_LIGHT = /* glsl */ `
  uniform vec3 uSunDir, uSunColor, uSkyAmb;
  uniform float uNight;
  // What a drop or flake catches: the sky's light, the sun's if it's up, and a floor for the dark.
  vec3 ambientLight() {
    return uSkyAmb * 1.7 + uSunColor * 0.35 * max(uSunDir.y, 0.0) + vec3(0.016, 0.018, 0.022);
  }
`;

const PARTICLE_VERT = /* glsl */ `
  attribute vec4 aP;
  uniform vec3 uOffset, uVRel, uLandPos, uLandDir, uCamScene;
  uniform float uBox, uTimeP, uSnow, uPxScale, uNear, uLandOn, uAlpha;
  ${COMMON_LIGHT}
  varying vec2 vUv;
  varying vec3 vLight;
  varying float vA;
  void main() {
    // Where it is in the box, the box centred on the camera. Snow wanders a little as it falls.
    vec3 p = aP.xyz * uBox + uOffset;
    if (uSnow > 0.5) {
      float ph = aP.w * 6.2832;
      p += vec3(sin(uTimeP * 0.9 + ph) * 0.6, 0.0, cos(uTimeP * 0.7 + ph * 1.7) * 0.6);
    }
    vec3 rel = mod(p, uBox) - 0.5 * uBox;
    float r = length(rel);

    // Its segment along the motion: a head and a tail as long as the exposure.
    float speed = length(uVRel);
    vec3 dir = speed > 0.01 ? uVRel / speed : vec3(0.0, -1.0, 0.0);
    float len = uSnow > 0.5 ? speed * 0.022 : clamp(speed * 0.06, 0.55, 14.0);
    vec3 a = (modelViewMatrix * vec4(rel, 1.0)).xyz;
    vec3 b = (modelViewMatrix * vec4(rel - dir * len, 1.0)).xyz;

    // Neither end behind the eye (a segment through it would cross the whole screen).
    float zMin = max(uNear * 0.5, 0.5);
    if (a.z > -zMin && b.z > -zMin) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
    if (a.z > -zMin) a += (b - a) * (a.z + zMin) / (a.z - b.z);
    if (b.z > -zMin) b += (a - b) * (b.z + zMin) / (b.z - a.z);

    // The quad: faces the eye, at least about a pixel and a half wide (thinner would shimmer).
    vec3 mid = 0.5 * (a + b), axis = b - a;
    vec3 side = cross(axis, mid);
    float sl = length(side);
    side = sl > 1e-6 ? side / sl : vec3(1.0, 0.0, 0.0);
    float dist = max(-mid.z, 0.1);
    float world = uSnow > 0.5 ? 0.03 + 0.035 * aP.w : 0.0035;
    float minW = 1.5 * dist / uPxScale;
    float w = max(world, minW);
    float thin = clamp(world / minW, 0.0, 1.0);
    // A slow flake is a round blob; extend the quad past both ends so the capsule's caps fit.
    vec3 along = normalize(axis + vec3(1e-6)) * w * 0.5;

    vUv = uv;
    vec3 c = position.x < 0.5 ? a - along : b + along;
    c += side * (position.y - 0.5) * w;
    gl_Position = projectionMatrix * vec4(c, 1.0);

    // Fades: near the eye, at the box's edge (so the wrap isn't seen), and its share of the rate.
    float fade = smoothstep(uNear, uNear + 2.0, r) * (1.0 - smoothstep(30.0, 39.0, r));
    float base = uSnow > 0.5 ? 0.85 : 0.55;
    vA = uAlpha * fade * base * mix(pow(thin, 0.25), 1.0, uSnow * 0.5);

    // Light: the ambient, and the landing lights' beam when it's on.
    vec3 light = ambientLight();
    if (uLandOn > 0.001) {
      vec3 toP = rel + uCamScene - uLandPos;
      float d2 = dot(toP, toP) + 1.0;
      float cosA = dot(toP, uLandDir) / sqrt(d2);
      light += vec3(1.0, 0.95, 0.86) * uLandOn * smoothstep(0.90, 0.985, cosA) * 900.0 / (d2 + 200.0);
    }
    vLight = light * (uSnow > 0.5 ? vec3(1.0) : vec3(1.05, 1.1, 1.2));
  }
`;

const PARTICLE_FRAG = /* glsl */ `
  uniform float uSnow;
  varying vec2 vUv;
  varying vec3 vLight;
  varying float vA;
  void main() {
    if (vA < 0.003) discard;
    // Soft across the width, and tapered along a streak.
    float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
    float a = uSnow > 0.5 ? smoothstep(0.0, 0.8, across) : across;
    float along = sin(3.14159 * clamp(vUv.x, 0.0, 1.0));
    a *= uSnow > 0.5 ? mix(1.0, along, 0.35) : along;
    gl_FragColor = vec4(vLight, a * vA);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const DROP_VERT = /* glsl */ `
  attribute vec4 aD;
  uniform float uShell, uFlow, uLife, uStretch, uSnow, uWet;
  ${COMMON_LIGHT}
  varying vec2 vUv;
  varying vec3 vLight;
  varying float vA, vStretch;
  const float EL_MIN = -34.0 * 0.0174533, EL_SPAN = 62.0 * 0.0174533;
  void main() {
    float ph = aD.w;
    // Airflow carries a drop up and outwards at speed; standing, it slides down (uFlow falls).
    float speedK = 0.7 + 0.6 * ph;
    float el0 = aD.y - EL_MIN + uFlow * speedK;
    float wrapped = mod(el0, EL_SPAN);
    float el = EL_MIN + wrapped;
    float az = aD.x * (1.0 + 0.25 * uStretch * (wrapped / EL_SPAN));
    // A short life, so the pattern keeps changing; and no pop where it wraps.
    float life = fract(uLife * (0.6 + 0.8 * ph) + ph * 7.0);
    float show = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.75, 1.0, life));
    show *= smoothstep(0.0, 0.05, wrapped / EL_SPAN) * (1.0 - smoothstep(0.95, 1.0, wrapped / EL_SPAN));

    vec3 dir = vec3(sin(az) * cos(el), sin(el), -cos(az) * cos(el));
    vec3 east = vec3(cos(az), 0.0, sin(az));
    vec3 north = cross(dir, east);
    float grow = 0.55 + 0.45 * smoothstep(0.0, 0.5, life);
    float size = aD.z * grow * (uSnow > 0.5 ? 1.3 : 1.0);
    float stretch = 1.0 + uStretch * (1.2 + 3.0 * ph);
    vec3 p = dir * uShell + (east * (position.x - 0.5) * size + north * (position.y - 0.5) * size * stretch);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    vUv = uv;
    vStretch = stretch;
    vA = uWet * show;
    vLight = ambientLight();
  }
`;

const DROP_FRAG = /* glsl */ `
  uniform float uSnow;
  varying vec2 vUv;
  varying vec3 vLight;
  varying float vA, vStretch;
  void main() {
    if (vA < 0.004) discard;
    vec2 q = vUv * 2.0 - 1.0;
    float d = length(q);
    if (d > 1.0) discard;
    float edge = 1.0 - smoothstep(0.82, 1.0, d);
    vec3 col;
    float a;
    if (uSnow > 0.5) {
      col = vLight * 1.1;
      a = edge * 0.8;
    } else {
      // A lens turns the view over: the sky at its foot, the darker world at its head, and a dark
      // rim where the light is bent away. A glint towards the top.
      float rim = smoothstep(0.55, 0.98, d);
      col = vLight * mix(1.15, 0.45, 0.5 + 0.5 * q.y);
      col *= 1.0 - 0.45 * rim;
      float glint = smoothstep(0.26, 0.05, length(q - vec2(-0.3, 0.4 / vStretch)));
      col += vLight * 1.6 * glint;
      a = edge * (0.42 + 0.3 * rim);
    }
    gl_FragColor = vec4(col, a * vA);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function quadGeometry(attrName, array) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute(attrName, new THREE.InstancedBufferAttribute(array, 4));
  g.instanceCount = 0;
  return g;
}

export function createPrecip(scene, uniforms) {
  const u = uniforms || {};
  const shared = {
    uSunDir: u.uSunDir ?? { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: u.uSunColor ?? { value: new THREE.Color(1, 1, 1) },
    uSkyAmb: u.uSkyAmb ?? { value: new THREE.Color(0.3, 0.4, 0.5) },
    uNight: u.uNight ?? { value: 0 },
  };

  const particleData = new Float32Array(Math.max(RAIN_MAX, SNOW_MAX) * 4);
  const particleGeo = quadGeometry('aP', particleData);
  const pU = {
    ...shared,
    uOffset: { value: new THREE.Vector3() },
    uVRel: { value: new THREE.Vector3(0, -6, 0) },
    uCamScene: { value: new THREE.Vector3() },
    uBox: { value: BOX_M },
    uTimeP: { value: 0 },
    uSnow: { value: 0 },
    uNear: { value: NEAR_M },
    uAlpha: { value: 1 },
    uPxScale: u.uPxScale ?? { value: 1000 },
    uLandPos: u.uLandPos ?? { value: new THREE.Vector3() },
    uLandDir: u.uLandDir ?? { value: new THREE.Vector3(0, 0, -1) },
    uLandOn: u.uLandOn ?? { value: 0 },
  };
  const particleMat = new THREE.ShaderMaterial({
    uniforms: pU, vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
  });
  const particles = new THREE.Mesh(particleGeo, particleMat);
  particles.name = 'precip-particles';
  particles.frustumCulled = false;
  particles.visible = false;
  particles.renderOrder = 20;   // over the clouds and the world's other transparent things
  scene.add(particles);

  const dropData = new Float32Array(DROPS_MAX * 4);
  const dropGeo = quadGeometry('aD', dropData);
  const dU = {
    ...shared,
    uShell: { value: DROP_SHELL_M },
    uFlow: { value: 0 },
    uLife: { value: 0 },
    uStretch: { value: 0 },
    uSnow: { value: 0 },
    uWet: { value: 0 },
  };
  const dropMat = new THREE.ShaderMaterial({
    uniforms: dU, vertexShader: DROP_VERT, fragmentShader: DROP_FRAG,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
  });
  const drops = new THREE.Mesh(dropGeo, dropMat);
  drops.name = 'precip-drops';
  drops.frustumCulled = false;
  drops.visible = false;
  drops.renderOrder = 30;       // over the rain outside
  scene.add(drops);

  let kind = 'none', rate = 0, ceiling = NO_CLOUD_TOP_M, seed = null, fall = 0;
  let wet = 0;                  // 0..1: how wet the windshield is, which lags the rain
  const offset = [0, 0, 0], vRel = [0, -6, 0];
  let intensity = 0;
  const bodyQ = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ'), camPos = new THREE.Vector3();

  function setWeather(settings) {
    const k = settings?.precip?.kind ?? 'none';
    const r = settings?.precip?.rate ?? 0;
    kind = k !== 'none' && r > 0 ? k : 'none';
    rate = kind === 'none' ? 0 : r;
    ceiling = ceilingM(settings);
    fall = fallSpeed(kind, rate);
    const s = settings?.seed ?? 1;
    if (kind !== 'none' && s !== seed) {
      seed = s;
      fillParticles(particleData, seed);
      particleGeo.attributes.aP.needsUpdate = true;
      fillDrops(dropData, seed);
      dropGeo.attributes.aD.needsUpdate = true;
    }
    const snow = kind === 'snow' ? 1 : 0;
    pU.uSnow.value = dU.uSnow.value = snow;
    particleGeo.instanceCount = kind === 'none' ? 0 : Math.round((snow ? SNOW_MAX : RAIN_MAX) * (0.15 + 0.85 * rate));
    dropGeo.instanceCount = kind === 'none' ? 0 : Math.round(DROPS_MAX * (0.2 + 0.8 * rate) * (snow ? 0.5 : 1));
    if (kind === 'none') { wet = 0; intensity = 0; particles.visible = drops.visible = false; }
  }

  function update({ camera, state, dt = 1 / 60, paused = false, cockpit }) {
    if (kind === 'none') return;
    const alt = camera.position.y;
    intensity = fallAt(alt, ceiling);
    const moving = !paused && dt > 0;
    const step = moving ? Math.min(dt, CAP_DT) : 0;

    relativeAir(state, fall, vRel);
    if (moving) {
      for (let i = 0; i < 3; i++) offset[i] = (((offset[i] + vRel[i] * step) % BOX_M) + BOX_M) % BOX_M;
      pU.uTimeP.value = (pU.uTimeP.value + step) % 3600;
    }
    particles.visible = intensity > 0.002;
    if (particles.visible) {
      camera.getWorldPosition(camPos);
      particles.position.copy(camPos);
      pU.uCamScene.value.copy(camPos);
      pU.uOffset.value.fromArray(offset);
      pU.uVRel.value.fromArray(vRel);
      pU.uAlpha.value = intensity * (0.55 + 0.45 * rate);
    }

    // The windshield. It wets in a few seconds and dries more slowly once out of the rain.
    const seat = cockpit ?? (camera.near < 0.1);
    pU.uNear.value = seat ? NEAR_COCKPIT_M : NEAR_M;
    if (moving) {
      const target = intensity * (0.35 + 0.65 * rate);
      wet += (target - wet) * Math.min(1, step / (target > wet ? 2.5 : 5));
      if (wet < 0.001) wet = 0;
      const tas = state?.tas ?? Math.hypot(vRel[0], vRel[2]);
      const air = smooth(12, 70, tas);        // 0 standing, 1 from about 135 kt
      const rateRad = kind === 'snow' ? (-0.004 + 0.3 * air) : (-0.014 + 0.46 * air);
      dU.uFlow.value = (dU.uFlow.value + rateRad * step) % 100;
      dU.uLife.value = (dU.uLife.value + step * (0.12 + 0.28 * air)) % 1000;
      dU.uStretch.value = air;
    }
    drops.visible = seat && wet > 0.01;
    if (drops.visible) {
      drops.position.copy(camera.getWorldPosition(camPos));
      euler.set(state?.pitch ?? 0, -(state?.hdg ?? 0), -(state?.roll ?? 0), 'YXZ');
      drops.quaternion.copy(bodyQ.setFromEuler(euler));
      dU.uWet.value = wet;
    }
  }

  return {
    setWeather,
    update,
    objects: { particles, drops },
    get stats() {
      const on = (m) => (m.visible ? 1 : 0);
      return {
        kind, rate, intensity, ceilingM: ceiling, wet,
        particles: particles.visible ? particleGeo.instanceCount : 0,
        drops: drops.visible ? dropGeo.instanceCount : 0,
        drawCalls: on(particles) + on(drops),
      };
    },
  };
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
