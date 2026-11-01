// The A321's exterior lights: which are on by phase (pure, tested), when the flashing ones
// flash, and their glows (one Points draw call, sized in pixels so they read from far away).
//
//   lightsFor({ onGround, gs, agl, altFt, enginesRunning, gatePhase, onRunway, gearDown })
//     → { nav, beacon, strobe, landing, taxi, logo }   (each 0 or 1)
//   flashAt(t) → { beaconTop, beaconBottom, strobe }    (0 or 1 at time t, s)
//   createLampGlows(lamps) → { object, setLevels(levels), setNight(n) }   (aircraft.js uses it)
//
// The SOP this follows (Airbus FCOM-style flows, as most A320-family operators fly them):
// - NAV & LOGO: NAV on whenever the aircraft is powered (always, here). LOGO on at night on
//   the ground (gate included) and in the air below 10,000 ft; off above. (By day the logo
//   light is drawn faintly or not at all: setNight handles that, not lightsFor.)
// - BEACON: on before pushback or engine start, off after the engines are shut down. So: on
//   whenever the engines run, during pushback and taxi, and always in the air.
// - STROBE: AUTO, i.e. on whenever airborne; set ON when lining up on the runway, OFF once
//   the runway is vacated. So: on in the air and on a runway (lined up, take-off roll, landing
//   rollout, and, as pilots do, while crossing one).
// - LAND (the retractable wing lights): on for take-off (on the runway) and in the air below
//   10,000 ft; off above 10,000 ft, and off after vacating the runway.
// - NOSE (taxi / T.O.): TAXI while taxiing (moving, not during pushback, off when stopped at
//   the gate), T.O. on the runway; it's on the nose gear, so it goes out when the gear
//   retracts and is back with the gear down on the approach.

import * as THREE from '../vendor/three.module.js';

export const LANDING_BELOW_FT = 10000;   // landing and logo lights below this
const TAXI_MIN_GS = 0.5;                  // m/s: "moving" for the taxi light

export function lightsFor(o = {}) {
  const onGround = o.onGround ?? true, gs = o.gs || 0, altFt = o.altFt ?? 0;
  const engines = !!o.enginesRunning, ph = o.gatePhase || 'none';
  const atStand = ph === 'parked' || ph === 'pushback' || ph === 'arrived';
  const onRunway = !!o.onRunway && !atStand;   // never at a stand, whatever the caller says
  const gearDown = o.gearDown ?? true;
  const air = !onGround, low = altFt < LANDING_BELOW_FT;
  const pushOrTaxi = ph === 'pushback' || ph === 'taxi' || ph === 'taxi-in';
  let taxi;
  if (air) taxi = gearDown ? 1 : 0;
  else taxi = !atStand && (onRunway || gs > TAXI_MIN_GS) ? 1 : 0;
  return {
    nav: 1,
    beacon: engines || pushOrTaxi || air ? 1 : 0,
    strobe: air || onRunway ? 1 : 0,
    landing: air ? (low ? 1 : 0) : (onRunway ? 1 : 0),
    taxi,
    logo: air ? (low ? 1 : 0) : 1,
  };
}

// Flash timing: the red beacons ~1 Hz, top and bottom alternating; the white strobes a double
// flash every 1.2 s, as on the A320 family.
export const BEACON_PERIOD = 1.0, STROBE_PERIOD = 1.2;
export function flashAt(t) {
  const tb = ((t % BEACON_PERIOD) + BEACON_PERIOD) % BEACON_PERIOD;
  const ts = ((t % STROBE_PERIOD) + STROBE_PERIOD) % STROBE_PERIOD;
  return {
    beaconTop: tb < 0.12 ? 1 : 0,
    beaconBottom: tb > 0.5 && tb < 0.62 ? 1 : 0,
    strobe: ts < 0.05 || (ts > 0.13 && ts < 0.18) ? 1 : 0,
  };
}

// --- The glows ------------------------------------------------------------------------------

// Each lamp: pos (model frame of aircraft.object), color, size (m: the halo's diameter at
// night), px [day, night] (its smallest size on screen), dir (model frame; null = all round),
// and its key in setLevels().
const VERT = /* glsl */ `
  attribute vec3 color;
  attribute vec4 aLamp;      // size (m), min px by day, min px at night, level 0..1
  attribute vec3 aDir;       // beam direction (zero for all-round lamps)
  uniform float uNightK, uPxScale;
  varying vec3 vCol;
  varying float vLevel, vCore;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float level = aLamp.w;
    // A beam is brightest seen from in front of it.
    float facing = 1.0;
    if (dot(aDir, aDir) > 0.5) {
      vec3 d = normalize((modelViewMatrix * vec4(aDir, 0.0)).xyz);
      facing = 0.12 + 0.88 * pow(max(dot(d, normalize(-mv.xyz)), 0.0), 5.0);
    }
    level *= facing;
    float sizeM = aLamp.x * mix(0.35, 1.0, uNightK);
    float px = max(sizeM * uPxScale / max(-mv.z, 0.1), mix(aLamp.y, aLamp.z, uNightK));
    gl_PointSize = level > 0.002 ? clamp(px * sqrt(level), 1.5, 320.0) : 0.0;
    // A small core: a fixed share of the sprite, at least ~2 px.
    vCore = clamp(2.2 / max(gl_PointSize, 1.0), 0.08, 0.5);
    vCol = color;
    vLevel = level;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }`;
const FRAG = /* glsl */ `
  uniform float uNightK;
  varying vec3 vCol;
  varying float vLevel, vCore;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = 1.0 - smoothstep(vCore * 0.6, vCore, d);
    float halo = exp(-d * d * 5.0) * (1.0 - d);
    vec3 c = vCol * (halo * mix(0.45, 0.9, uNightK)) + mix(vCol, vec3(1.0), 0.6) * core * 1.6;
    gl_FragColor = vec4(c * vLevel, 1.0);
    #include <colorspace_fragment>
  }`;

export function createLampGlows(lamps) {
  const n = lamps.length;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), lamp = new Float32Array(n * 4), dir = new Float32Array(n * 3);
  const c = new THREE.Color();
  lamps.forEach((L, i) => {
    pos.set(L.pos, i * 3);
    c.set(L.color); col.set([c.r, c.g, c.b], i * 3);
    lamp.set([L.size, L.px[0], L.px[1], 0], i * 4);
    if (L.dir) dir.set(L.dir, i * 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const aLamp = new THREE.BufferAttribute(lamp, 4);
  aLamp.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aLamp', aLamp);
  g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
  const uniforms = { uNightK: { value: 0 }, uPxScale: { value: 1000 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const object = new THREE.Points(g, mat);
  object.name = 'aircraft-lamps';
  object.frustumCulled = false;
  object.renderOrder = 2;
  // Pixels per metre at 1 m depth, from this camera and this canvas.
  const size = new THREE.Vector2();
  object.onBeforeRender = (renderer, scene, camera) => {
    renderer.getDrawingBufferSize(size);
    uniforms.uPxScale.value = camera.projectionMatrix.elements[5] * size.y * 0.5;
  };
  return {
    object,
    // levels: one number per lamp (0..1), in the lamps' order.
    setLevels(levels) {
      for (let i = 0; i < n; i++) lamp[i * 4 + 3] = levels[i] || 0;
      aLamp.needsUpdate = true;
    },
    setNight(k) { uniforms.uNightK.value = k; },
  };
}
