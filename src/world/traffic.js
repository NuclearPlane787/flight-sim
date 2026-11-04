// Airport life: parked airliners at the stands and ground vehicles on the service roads.
//
//   const traffic = createTraffic(scene, uniforms, chunks, airports, heightfield);
//   each rendered frame:  traffic.update({ camera, origin, dt })  → { drawCalls, triangles }
//   traffic.setPlayerStand('RKSS', '12')   frees that stand (and any overlapping one); null clears
//   traffic.setPlayerStand('RKSS', '36', { span, length })   the same for an aircraft of that size
//
// At night (uNight > 0) each type adds one instanced Points draw: the parked aircraft's
// navigation lights (red left wingtip, green right, white tail), sharing the shadow's
// instance buffers; beacons, strobes and logo lights are off, as on a parked aircraft.
//
// Ten instanced draws in all (by day): per airliner type (narrowbody, widebody) a near model, a
// ~200-triangle far model (beyond FAR_DIST) and the blob shadow, and one per vehicle kind
// (tug, bus, baggage cart, fuel truck), shared by the three airports. Each
// instance stores its position relative to its airport's origin (small numbers, so
// float32 is exact to millimetres); a uniform per airport carries that origin minus the
// scene origin, worked out in double on the CPU: the same camera-relative scheme as the
// runway lights. Liveries are an instance attribute indexing a small colour table; the
// fuselage stripes, windows and tail emblems are drawn in the fragment shader.
//
// CPU: aircraft never move, so their buffers are written only when the set of nearby
// airports changes or the camera has moved REPACK_MOVE since the last near/far split
// (never per frame). Vehicles step only while the camera is within ~6 km of an airport
// and below ~5,000 ft above it; otherwise nothing runs. Time comes from dt (pause-safe).

import * as THREE from '../../vendor/three.module.js';
import { AIRLINER_TYPES, buildAirliner, buildAirlinerFar, buildVehicle, buildShadow, PART } from './traffic-models.js';
import { placeParked, blockedByPlayer, createVehicles } from './traffic-layout.js';
import { LIVERIES, linearRgb } from './liveries-other.js';

const AIRCRAFT_RANGE = 15000;     // m from an airport's bounds: parked aircraft drawn
const FAR_DIST = 2000;            // m from the camera: parked aircraft use the far model beyond this
const REPACK_MOVE = 200;          // m the camera moves before the near/far split is redone
const VEHICLE_RANGE = 6000;       // m: vehicles drawn and moving
const VEHICLE_MAX_AGL = 1524;     // m (5,000 ft) above the airport
const MAX_AIRPORTS = 4;
const VEHICLE_KINDS = ['tug', 'bus', 'cart', 'fuel'];

// Vehicle paint by part, per kind: [BODY, CAB, GLASS, TANK, CARGO, STRIPE] and an
// alternative body colour picked per instance.
const VEHICLE_PAINT = {
  tug: { BODY: '#e8b21c', CAB: '#2b2f36', GLASS: '#1b2430', TANK: '#cccccc', CARGO: '#cccccc', STRIPE: '#222222', ALT: '#e6e8ea' },
  bus: { BODY: '#e9edf1', CAB: '#e9edf1', GLASS: '#1e2a36', TANK: '#cccccc', CARGO: '#cccccc', STRIPE: '#2a63b8', ALT: '#2a63b8' },
  cart: { BODY: '#4a5260', CAB: '#4a5260', GLASS: '#333333', TANK: '#cccccc', CARGO: '#b9bec6', STRIPE: '#2a63b8', ALT: '#3c6fb4' },
  fuel: { BODY: '#d03a2a', CAB: '#e8eaec', GLASS: '#1b2430', TANK: '#e3e6e9', CARGO: '#cccccc', STRIPE: '#d03a2a', ALT: '#d9dde1' },
};

// ------------------------------------------------------------------ shaders

const COMMON_VERT = /* glsl */ `
  uniform vec2 uAirRel[${MAX_AIRPORTS}];   // airport origin minus the scene origin (map m)
  attribute float part;
  attribute vec4 iPos;      // x, y relative to the airport origin (map m), ground z, grid heading (rad)
  attribute vec4 iData;     // airport index, livery / tint, length scale, shown (0 or 1)
  varying vec3 vRel, vN, vLocal;
  varying float vPart, vLiv;
  #include <logdepthbuf_pars_vertex>
  void place(vec3 p) {
    float h = iPos.w;
    vec2 f = vec2(sin(h), cos(h)), l = vec2(-cos(h), sin(h));
    vec2 rel = uAirRel[int(iData.x + 0.5)] + iPos.xy + f * p.x + l * p.y;
    vec3 wp = vec3(rel.x, iPos.z + p.z, -rel.y);
    wp.y -= curveDrop((wp - uCamPos).xz);
    vRel = wp - uCamPos;
    vec2 n2 = f * normal.x + l * normal.y;
    vN = vec3(n2.x, normal.z, -n2.y);
    vPart = part;
    vLiv = iData.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    #include <logdepthbuf_vertex>
  }`;

const AIRLINER_VERT = /* glsl */ `
  ${COMMON_VERT}
  void main() {
    vec3 p = position;
    p.x *= iData.z;
    vLocal = vec3(position.x * iData.z, position.y, position.z);
    place(p * iData.w);
  }`;

const LIGHTING = /* glsl */ `
  vec3 shade(vec3 alb, vec3 n, float gloss) {
    float ndl = max(dot(n, uSunDir), 0.0);
    vec3 c = alb * (uSunColor * ndl * 2.2 + uSkyAmb * (0.5 + 0.5 * n.y) * 1.15);
    vec3 vd = normalize(vRel);
    c += uSunColor * gloss * pow(max(dot(reflect(vd, n), uSunDir), 0.0), 24.0);
    return c;
  }`;

const AIRLINER_FRAG = /* glsl */ `
  uniform vec3 uLiv[${LIVERIES.length * 6}];   // per livery: fuse, belly, tail, acc1, acc2, engine
  uniform float uPattern[${LIVERIES.length}];
  uniform vec4 uBody;      // zc, R, length, cockpit x
  uniform vec4 uFin;       // centre (m behind nose), centre z, size, fin root z
  varying vec3 vRel, vN, vLocal;
  varying float vPart, vLiv;
  #include <logdepthbuf_pars_fragment>
  ${LIGHTING}
  // Antialiased step: 1 where v > e.
  float aStep(float e, float v) { float w = max(fwidth(v), 1e-4); return smoothstep(e - w, e + w, v); }
  float band(float a, float b, float v) { return aStep(a, v) * (1.0 - aStep(b, v)); }
  vec3 hazard(float t) { return mix(vec3(0.007, 0.007, 0.009), vec3(1.0, 0.56, 0.01), aStep(0.5, fract(t))); }

  void main() {
    #include <logdepthbuf_fragment>
    int L = int(vLiv + 0.5);
    vec3 cFuse = uLiv[L * 6], cBelly = uLiv[L * 6 + 1], cTail = uLiv[L * 6 + 2];
    vec3 cA1 = uLiv[L * 6 + 3], cA2 = uLiv[L * 6 + 4], cEng = uLiv[L * 6 + 5];
    float pat = uPattern[L];
    int k = int(vPart + 0.5);
    float d = -vLocal.x;                       // metres behind the nose
    float z = vLocal.z - uBody.x, R = uBody.y;  // height from the fuselage centreline
    vec3 n = normalize(vN);
    vec3 alb = vec3(0.72, 0.74, 0.76);
    float gloss = 0.25;
    if (k == 0) {
      alb = cFuse;
      float bz = -0.42 * R;
      alb = mix(alb, cBelly, 1.0 - aStep(bz, z));
      // Cheatlines below the windows, behind the cockpit; tail-wards they sweep up.
      float rise = smoothstep(uBody.z * 0.6, uBody.z * 0.9, d) * 0.9 * R;
      float c1 = band(-0.18 * R + rise, -0.08 * R + rise, z) * aStep(uBody.w + 3.0, d);
      float c2 = band(-0.30 * R + rise, -0.21 * R + rise, z) * aStep(uBody.w + 3.0, d);
      alb = mix(alb, cA1, c1);
      alb = mix(alb, cA2, c2);
      // Cabin windows, ~0.53 m pitch; they average out to a grey band far away.
      float wv = band(0.10 * R, 0.30 * R, z) * band(uBody.w + 4.0, uBody.z * 0.80, d);
      float ww = 1.0 - aStep(0.42, fract(d / 0.53));
      ww = mix(ww, 0.4, smoothstep(0.15, 0.4, fwidth(d)));
      alb = mix(alb, vec3(0.03, 0.04, 0.05), wv * ww);
      // Cockpit windows.
      float cw = band(uBody.w - 1.6, uBody.w, d) * band(0.18 * R, 0.50 * R, z) * aStep(0.15, abs(vLocal.y) / R + 0.4);
      alb = mix(alb, vec3(0.02, 0.025, 0.03), cw);
      gloss = 0.35;
    } else if (k == 1) {
      alb = cTail;
      // The fin's pattern, only on the fin itself (not the sharklets).
      if (abs(vLocal.y) < 0.6) {
        vec2 q = (vec2(d, vLocal.z) - uFin.xy) / uFin.z;   // + aft, + up, in fin heights
        q.x = -q.x;                                        // + forward
        if (pat < 0.5) {
          // Atom: a lime core and three blue orbits; a hazard band at the base.
          float r = length(q);
          float orb = 0.0;
          for (int i = 0; i < 3; i++) {
            float a = float(i) * 1.0472 + 0.35;
            vec2 e = mat2(cos(a), sin(a), -sin(a), cos(a)) * q;
            float f = length(e / vec2(0.36, 0.12));
            orb = max(orb, band(0.86, 1.0, f));
          }
          alb = mix(alb, cA2, orb);
          alb = mix(alb, cA1 * 1.15, 1.0 - aStep(0.075, r));
          float hz = band(uFin.w, uFin.w + 0.075 * uFin.z, vLocal.z);
          alb = mix(alb, hazard((d + vLocal.z) / (0.06 * uFin.z)), hz);
        } else if (pat < 1.5) {
          // Sun disc over a lower band.
          alb = mix(alb, cA2, 1.0 - aStep(-0.28, q.y));
          alb = mix(alb, cA1, 1.0 - aStep(0.24, length(q - vec2(0.0, 0.05))));
        } else if (pat < 2.5) {
          // A diagonal sweep up the fin.
          float s = q.y - 0.55 * q.x;
          alb = mix(alb, cA1, band(-0.10, 0.12, s));
          alb = mix(alb, cA2, band(0.18, 0.24, s));
        } else {
          // Horizontal bands.
          alb = mix(alb, cA1, band(0.02, 0.14, q.y));
          alb = mix(alb, cA2, band(-0.12, -0.04, q.y));
        }
      }
      gloss = 0.3;
    } else if (k == 2) {
      alb = cEng; gloss = 0.35;
    } else if (k == 12) {
      // Intake lip: Nuclear's black and yellow hazard stripes; the others take accent 1.
      alb = pat < 0.5 ? hazard((vLocal.y + vLocal.z) * 2.2) : mix(cEng, vec3(0.75), 0.6);
      gloss = 0.4;
    } else if (k == 3) {
      alb = vec3(0.62, 0.65, 0.69); gloss = 0.2;
    } else if (k == 4) {
      alb = vec3(0.10, 0.10, 0.11); gloss = 0.05;
    } else if (k == 5) {
      alb = vec3(0.025, 0.025, 0.03); gloss = 0.0;
    }
    vec3 col = shade(alb, n, gloss);
    gl_FragColor = vec4(applyHaze(col, vRel), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// Blob shadows: the planform slid along the sun onto the ground, multiplied in.
const SHADOW_VERT = /* glsl */ `
  uniform vec2 uAirRel[${MAX_AIRPORTS}];
  attribute vec4 iPos, iData;
  varying float vShade;
  #include <logdepthbuf_pars_vertex>
  void main() {
    float h = iPos.w;
    vec2 f = vec2(sin(h), cos(h)), l = vec2(-cos(h), sin(h));
    vec3 p = position;
    p.x *= iData.z;
    vec2 rel = uAirRel[int(iData.x + 0.5)] + iPos.xy + f * p.x + l * p.y;
    // Slide along the sun (scene x, -z = map x, y) by the height it casts from.
    vec3 sd = uSunDir;
    vec2 sun = vec2(sd.x, -sd.z) / max(sd.y, 0.25);
    rel -= sun * p.z;
    vec3 wp = vec3(rel.x, iPos.z + 0.05, -rel.y);
    wp.y -= curveDrop((wp - uCamPos).xz);
    vec3 r = wp - uCamPos;
    float d = length(r);
    // Darker with a high sun, fading with distance and haze; hidden with the aircraft.
    vShade = mix(1.0, 0.5, smoothstep(0.05, 0.35, sd.y) * exp(-d / 4000.0)) ;
    vShade = mix(1.0, vShade, iData.w);
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    float dm = length(mv.xyz);
    mv.xyz *= 1.0 - min((0.1 + dm * 0.001) / max(dm, 1e-3), 0.5);   // pull towards the camera
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }`;

const SHADOW_FRAG = /* glsl */ `
  varying float vShade;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(vec3(vShade), 1.0);
  }`;

const VEHICLE_VERT = /* glsl */ `
  ${COMMON_VERT}
  void main() {
    vLocal = position;
    place(position);
  }`;

const VEHICLE_FRAG = /* glsl */ `
  uniform vec3 uPal[8];     // BODY, CAB, GLASS, TANK, CARGO, STRIPE, ALT, DARK
  varying vec3 vRel, vN, vLocal;
  varying float vPart, vLiv;
  #include <logdepthbuf_pars_fragment>
  ${LIGHTING}
  void main() {
    #include <logdepthbuf_fragment>
    int k = int(vPart + 0.5);
    vec3 n = normalize(vN);
    vec3 alb = uPal[7];
    float gloss = 0.1;
    if (k == 6) alb = vLiv > 0.5 ? uPal[6] : uPal[0];
    else if (k == 7) alb = uPal[1];
    else if (k == 8) { alb = uPal[2]; gloss = 0.5; }
    else if (k == 9) { alb = uPal[3]; gloss = 0.4; }
    else if (k == 10) alb = uPal[4];
    else if (k == 11) alb = uPal[5];
    gl_FragColor = vec4(applyHaze(shade(alb, n, gloss), vRel), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// The parked aircraft's nav lights: a point per lamp, at least a few pixels at night.
const NAVLIGHT_VERT = /* glsl */ `
  uniform vec2 uAirRel[${MAX_AIRPORTS}];
  attribute vec4 iPos, iData;
  attribute vec3 color;
  varying vec3 vCol;
  #include <logdepthbuf_pars_vertex>
  void main() {
    float h = iPos.w;
    vec2 f = vec2(sin(h), cos(h)), l = vec2(-cos(h), sin(h));
    vec3 p = position;
    p.x *= iData.z;
    vec2 rel = uAirRel[int(iData.x + 0.5)] + iPos.xy + f * p.x + l * p.y;
    vec3 wp = vec3(rel.x, iPos.z + p.z, -rel.y);
    wp.y -= curveDrop((wp - uCamPos).xz);
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    float d = max(-mv.z, 0.1);
    float px = max(2.6 * uPxScale / d, mix(1.5, 6.0, uNight));
    gl_PointSize = iData.w * uNight > 0.01 ? min(px, 96.0) : 0.0;
    vCol = color * uNight * iData.w * mix(1.0, 0.45, smoothstep(2000.0, 15000.0, d));
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }`;
const NAVLIGHT_FRAG = /* glsl */ `
  varying vec3 vCol;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = 1.0 - smoothstep(0.15, 0.32, d);
    float halo = exp(-d * d * 5.0) * (1.0 - d);
    gl_FragColor = vec4((vCol * halo * 0.8 + mix(vCol, vec3(1.0), 0.5) * core * 1.5), 1.0);
    #include <colorspace_fragment>
  }`;

// Model-frame lamp positions for a type (x forward from the nose, y left, z above the ground).
function navLamps(T) {
  const R = T.radius, half = T.span / 2 - R * 0.85;
  const tanS = Math.tan(T.sweepDeg * Math.PI / 180), dih = Math.tan(T.dihedralDeg * Math.PI / 180);
  const tx = -(T.wingRootX + half * tanS) - T.tipChord * 0.4, tz = T.zc + T.wingZ + half * dih + 0.1;
  return [
    [tx, T.span / 2 + 0.05, tz, 1.0, 0.03, 0.02],      // red, left
    [tx, -T.span / 2 - 0.05, tz, 0.02, 1.0, 0.08],     // green, right
    [-T.length - 0.1, 0, T.zc + R * 0.35, 1.0, 1.0, 1.0], // white, tail
  ];
}

// ------------------------------------------------------------------ helpers

function instancedGeometry(model, capacity) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(model.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(model.normal, 3));
  g.setAttribute('part', new THREE.BufferAttribute(model.part, 1));
  g.setIndex(new THREE.BufferAttribute(model.index, 1));
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(capacity, 1) * 4), 4);
  const iData = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(capacity, 1) * 4), 4);
  iPos.setUsage(THREE.DynamicDrawUsage);
  iData.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iPos', iPos);
  g.setAttribute('iData', iData);
  g.instanceCount = 0;
  return g;
}

// Distance from a point to an airport's bounding box (map metres).
function boxDist(b, x, y) {
  const dx = Math.max(b[0] - x, 0, x - b[2]), dy = Math.max(b[1] - y, 0, y - b[3]);
  return Math.hypot(dx, dy);
}

// ------------------------------------------------------------------ public

export function createTraffic(scene, uniforms, chunks, airports, heightfield = null) {
  const group = new THREE.Group();
  group.name = 'traffic';
  const list = (Array.isArray(airports) ? airports : (airports && airports.airports) || []).slice(0, MAX_AIRPORTS);
  const heightAt = heightfield ? (x, y) => heightfield.heightAt(x, y) : null;
  const airRel = Array.from({ length: MAX_AIRPORTS }, () => new THREE.Vector2());

  // Per airport: origin, bounds, parked aircraft, the vehicle fleet.
  const sites = list.map((a, ai) => {
    const ox = a.origin ? a.origin[0] : a.stands?.[0]?.x || 0, oy = a.origin ? a.origin[1] : a.stands?.[0]?.y || 0;
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    const grow = (x, y) => { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); };
    for (const s of a.stands || []) grow(s.x, s.y);
    for (const r of a.serviceRoads || []) for (const [x, y] of r.points) grow(x, y);
    if (!isFinite(b[0])) { grow(ox, oy); }
    const parked = placeParked(a, { heightAt });
    const fleet = createVehicles(a, { heightAt });
    return { a, ai, ox, oy, b, parked, fleet, hidden: new Set(), near: false, active: false, elev: a.elevM || 0 };
  });

  const common = (extra) => Object.assign({}, uniforms, { uAirRel: { value: airRel } }, extra);
  const vert = (body) => `${chunks.UNIFORMS_GLSL}\n${chunks.HEIGHT_GLSL}\n${body}`;
  const frag = (body) => `${chunks.UNIFORMS_GLSL}\n${chunks.ATMOS_GLSL}\n${body}`;

  // Airliners: one mesh per type.
  const livCols = [], livPat = [];
  for (const L of LIVERIES) {
    for (const key of ['fuse', 'belly', 'tail', 'acc1', 'acc2', 'engine']) livCols.push(new THREE.Vector3(...linearRgb(L[key])));
    livPat.push(L.pattern);
  }
  const airliners = AIRLINER_TYPES.map((T, ti) => {
    const model = buildAirliner(T);
    const cap = sites.reduce((n, s) => n + s.parked.filter((p) => p.type === ti).length, 0);
    const geo = instancedGeometry(model, cap);
    const finRootZ = T.zc + T.radius * 0.55, fH = T.finTop - finRootZ;
    const fTan = Math.tan(T.finSweepDeg * Math.PI / 180);
    const finC = [T.finRootX + fH * 0.55 * fTan + (T.finRootChord + (T.finTipChord - T.finRootChord) * 0.55) * 0.45, finRootZ + fH * 0.55];
    const u = common({
      uLiv: { value: livCols }, uPattern: { value: livPat },
      uBody: { value: new THREE.Vector4(T.zc, T.radius, T.length, 3.3 * T.radius / 2) },
      uFin: { value: new THREE.Vector4(finC[0], finC[1], fH, finRootZ + 0.2) },
    });
    const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: vert(AIRLINER_VERT), fragmentShader: frag(AIRLINER_FRAG), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.name = `traffic-${T.name}`;
    mesh.visible = false;
    group.add(mesh);
    // The far model: same material, its own instance buffers.
    const farModel = buildAirlinerFar(T);
    const fgeo = instancedGeometry(farModel, cap);
    const far = new THREE.Mesh(fgeo, mat);
    far.frustumCulled = false;
    far.name = `traffic-${T.name}-far`;
    far.visible = false;
    group.add(far);
    // Its shadow: every instance (near and far), a ~14-triangle planform.
    const sm = buildShadow(T);
    const sgeo = new THREE.InstancedBufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(sm.position, 3));
    sgeo.setIndex(new THREE.BufferAttribute(sm.index, 1));
    const sPos = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(cap, 1) * 4), 4);
    const sDat = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(cap, 1) * 4), 4);
    sPos.setUsage(THREE.DynamicDrawUsage);
    sDat.setUsage(THREE.DynamicDrawUsage);
    sgeo.setAttribute('iPos', sPos);
    sgeo.setAttribute('iData', sDat);
    sgeo.instanceCount = 0;
    const smat = new THREE.ShaderMaterial({
      uniforms: common({}), vertexShader: vert(SHADOW_VERT), fragmentShader: SHADOW_FRAG,
      transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: true, side: THREE.DoubleSide,
    });
    const shadow = new THREE.Mesh(sgeo, smat);
    shadow.frustumCulled = false;
    shadow.name = `traffic-${T.name}-shadow`;
    shadow.visible = false;
    shadow.renderOrder = 1;
    group.add(shadow);
    // Its nav lights at night: three points per instance, on the shadow's instance buffers.
    const lamps = navLamps(T);
    const lgeo = new THREE.InstancedBufferGeometry();
    lgeo.setAttribute('position', new THREE.Float32BufferAttribute(lamps.flatMap((q) => q.slice(0, 3)), 3));
    lgeo.setAttribute('color', new THREE.Float32BufferAttribute(lamps.flatMap((q) => q.slice(3)), 3));
    lgeo.setAttribute('iPos', sPos);
    lgeo.setAttribute('iData', sDat);
    lgeo.instanceCount = 0;
    const lu = common({});   // uPxScale: the world's (pixels per radian), set each frame
    const lmat = new THREE.ShaderMaterial({
      uniforms: lu, vertexShader: vert(NAVLIGHT_VERT), fragmentShader: NAVLIGHT_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const navLights = new THREE.Points(lgeo, lmat);
    navLights.frustumCulled = false;
    navLights.name = `traffic-${T.name}-navlights`;
    navLights.visible = false;
    navLights.renderOrder = 2;
    group.add(navLights);
    return { T, ti, mesh, geo, tris: model.triangles, far, fgeo, ftris: farModel.triangles, shadow, sgeo, stris: sm.triangles, navLights, lgeo };
  });

  // Vehicles: one mesh per kind; filled from the one active airport.
  const darkLin = new THREE.Vector3(...linearRgb('#16181b'));
  const maxPerKind = {};
  for (const k of VEHICLE_KINDS) maxPerKind[k] = Math.max(1, ...sites.map((s) => s.fleet.vehicles.filter((v) => v.kind === k).length));
  const vehicles = VEHICLE_KINDS.map((kind) => {
    const model = buildVehicle(kind);
    const geo = instancedGeometry(model, maxPerKind[kind]);
    const P = VEHICLE_PAINT[kind];
    const pal = ['BODY', 'CAB', 'GLASS', 'TANK', 'CARGO', 'STRIPE', 'ALT'].map((c) => new THREE.Vector3(...linearRgb(P[c])));
    pal.push(darkLin);
    const mat = new THREE.ShaderMaterial({ uniforms: common({ uPal: { value: pal } }), vertexShader: vert(VEHICLE_VERT), fragmentShader: frag(VEHICLE_FRAG), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.name = `traffic-${kind}`;
    mesh.visible = false;
    group.add(mesh);
    return { kind, mesh, geo, tris: model.triangles };
  });
  // Each site's vehicles, grouped by kind, with a seeded tint each.
  for (const s of sites) {
    s.byKind = {};
    for (const k of VEHICLE_KINDS) s.byKind[k] = [];
    s.fleet.vehicles.forEach((v, i) => s.byKind[v.kind].push({ v, tint: (i * 7919 + s.ai * 31) % 5 === 0 ? 1 : 0 }));
  }
  scene.add(group);

  // Rewrite the airliner buffers for the airports that are near now, splitting them into
  // near and far models by their distance from the camera (map x, y and height z).
  const packAt = { x: 0, y: 0, z: 0 };
  function packAirliners(cx = packAt.x, cy = packAt.y, cz = packAt.z) {
    packAt.x = cx; packAt.y = cy; packAt.z = cz;
    const far2 = FAR_DIST * FAR_DIST;
    for (const A of airliners) {
      const outs = [A.geo, A.fgeo, A.sgeo].map((g) => ({ g, pos: g.attributes.iPos.array, dat: g.attributes.iData.array, n: 0 }));
      const put = (o, p, s, i) => {
        o.pos.set([p.x - s.ox, p.y - s.oy, p.z, p.hdg], o.n * 4);
        o.dat.set([s.ai, p.livery, p.lenScale, s.hidden.has(i) ? 0 : 1], o.n * 4);
        o.n++;
      };
      for (const s of sites) {
        if (!s.near) continue;
        s.parked.forEach((p, i) => {
          if (p.type !== A.ti) return;
          const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
          put(dx * dx + dy * dy + dz * dz > far2 ? outs[1] : outs[0], p, s, i);
          put(outs[2], p, s, i);
        });
      }
      for (const o of outs) {
        o.g.instanceCount = o.n;
        o.g.attributes.iPos.needsUpdate = true;
        o.g.attributes.iData.needsUpdate = true;
      }
      A.mesh.visible = outs[0].n > 0;
      A.far.visible = outs[1].n > 0;
      A.shadow.visible = outs[2].n > 0;
      A.lgeo.instanceCount = outs[2].n;
    }
  }

  // Write the active airport's vehicles (positions every frame while active).
  function writeVehicles(s, withData) {
    for (const V of vehicles) {
      const items = s.byKind[V.kind];
      const pos = V.geo.attributes.iPos.array, dat = V.geo.attributes.iData.array;
      for (let i = 0; i < items.length; i++) {
        const { v, tint } = items[i];
        const o = i * 4;
        pos[o] = v.x - s.ox; pos[o + 1] = v.y - s.oy; pos[o + 2] = v.z; pos[o + 3] = v.hdg;
        if (withData) { dat[o] = s.ai; dat[o + 1] = tint; dat[o + 2] = 1; dat[o + 3] = 1; }
      }
      V.geo.instanceCount = items.length;
      V.geo.attributes.iPos.needsUpdate = true;
      if (withData) V.geo.attributes.iData.needsUpdate = true;
      V.mesh.visible = items.length > 0;
    }
  }

  const camScene = new THREE.Vector3();
  let activeSite = null;
  const stats = { drawCalls: 0, triangles: 0, parked: 0, vehicles: 0, updateMs: 0 };

  return {
    group,
    stats,
    sites,

    update(ctx, dt) {
      const step = Math.min(Math.max(dt ?? ctx.dt ?? 0, 0), 1);
      const { camera, origin } = ctx;
      camera.updateMatrixWorld();
      camScene.setFromMatrixPosition(camera.matrixWorld);
      const cx = origin.x + camScene.x, cy = origin.y - camScene.z, cz = camScene.y;

      // Which airports are near enough to draw.
      let changed = false, next = null, bestD = Infinity;
      for (const s of sites) {
        const dh = boxDist(s.b, cx, cy), dz = cz - s.elev;
        const near = Math.hypot(dh, Math.max(dz, 0)) < AIRCRAFT_RANGE;
        if (near !== s.near) { s.near = near; changed = true; }
        if (dh < VEHICLE_RANGE && dz < VEHICLE_MAX_AGL && dh < bestD) { bestD = dh; next = s; }
        airRel[s.ai].set(s.ox - origin.x, s.oy - origin.y);
      }
      const moved = Math.hypot(cx - packAt.x, cy - packAt.y, cz - packAt.z) > REPACK_MOVE;
      if (changed || (moved && sites.some((s) => s.near))) packAirliners(cx, cy, cz);

      // Vehicles: step and upload only for the active airport.
      if (next !== activeSite) {
        activeSite = next;
        if (!next) for (const V of vehicles) { V.mesh.visible = false; V.geo.instanceCount = 0; }
        else writeVehicles(next, true);
      }
      if (activeSite && step > 0) {
        activeSite.fleet.step(step);
        writeVehicles(activeSite, false);
      }

      let calls = 0, tris = 0, parked = 0, vcount = 0;
      const lit = (uniforms.uNight?.value || 0) > 0.02;
      for (const A of airliners) {
        A.navLights.visible = lit && A.shadow.visible;
        if (A.navLights.visible) calls++;
        if (A.mesh.visible) { calls++; tris += A.tris * A.geo.instanceCount; }
        if (A.far.visible) { calls++; tris += A.ftris * A.fgeo.instanceCount; }
        if (A.shadow.visible) { calls++; tris += A.stris * A.sgeo.instanceCount; parked += A.sgeo.instanceCount; }
      }
      for (const V of vehicles) if (V.mesh.visible) { calls++; tris += V.tris * V.geo.instanceCount; vcount += V.geo.instanceCount; }
      stats.drawCalls = calls; stats.triangles = tris; stats.parked = parked; stats.vehicles = vcount;
      return { drawCalls: calls, triangles: tris };
    },

    // Keep the player's stand free: hide the parked aircraft there and any it would overlap
    // (with opts = { span, length }: any within wingtip clearance of an aircraft that size).
    setPlayerStand(icao, ref, opts = null) {
      for (const s of sites) {
        const before = s.hidden;
        s.hidden = s.a.icao === icao && ref != null ? blockedByPlayer(s.a, s.parked, ref, opts) : new Set();
        if (before.size !== s.hidden.size || [...before].some((i) => !s.hidden.has(i))) packAirliners();
      }
    },

    // Stand refs with a parked aircraft (for picking a free stand), minus the hidden ones.
    occupiedStands(icao) {
      const s = sites.find((t) => t.a.icao === icao);
      return s ? s.parked.filter((p, i) => !s.hidden.has(i)).map((p) => p.stand) : [];
    },
  };
}

export { PART };
