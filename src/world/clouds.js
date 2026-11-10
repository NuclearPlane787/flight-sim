// v0.4.0: the cloud layers and lightning.
//
// Each layer is two flat discs, at its base and its top, centred on the camera and following the Earth's curve:
// the cover is procedural noise in the fragment shader, seeded by the weather's seed. The holes line up between
// the two discs, with parallax, so a layer has a thickness to it. Inside a layer (camera between base and top,
// and in the noise's cloud there) the view fogs out by nested shells around the camera, depth-tested, so the
// cockpit and the near aircraft stay visible while the world beyond goes white or grey.
//
// Lightning comes from the sim's seeded strikesBetween() (src/sim/lightning.js), driven by sim time, so it stops
// when the sim stops. Flashes light the clouds near them and the whole scene for a moment (an additive full-screen
// quad and an ambient light for three's own materials); ground strikes close by draw a jagged bolt.
//
// Each storm cell (settings.microbursts) has a rain shaft: a soft grey column from the ground to the lowest layer's
// base. The whole set is one instanced draw of a capped cylinder; the fragment shader integrates the rain along the
// view ray through the column in closed form, so it blends out towards the edge and can be flown through.
//
//   const clouds = createClouds(scene, uniforms);
//   clouds.setWeather(settings);    // normalizeWeather()'s shape, or null for the default (clear)
//   clouds.update({ camera, origin, state, dt, paused });
//
// Draws: clear weather nothing at all (every object visible = false). Otherwise one per surface that shows (an
// overcast's far side is never drawn), one for the fog shells while in cloud, one for the flash, one for a bolt and
// one for all the rain shafts.
// Weather objects use the shared uniforms object; nothing here adds to it.

import { magToGrid } from './frame.js';
import * as THREE from '../../vendor/three.module.js';
import { strikesBetween } from '../sim/lightning.js';
import { EARTH_RADIUS } from './frame.js';
import { UNIFORMS_GLSL, NOISE_GLSL } from './glsl.js';
import { ATMOS_GLSL } from './sky.js';

const FT = 0.3048;
export const MAX_LAYERS = 3;
const DISC_RADIUS_M = 400000;        // past the horizon from any cloud height the game flies at
const RING_INNER_M = 150;
const RINGS = 42, SEGS = 80;
const CLOUD_SCALE_M = 5200;          // the noise's first octave, metres
const SOFT = 0.022;                  // how soft a cloud's edge is, in noise units
const FOG_RADII = [48, 90, 130, 180, 260];   // the fog shells (m); 3rd person's camera is 75 m out, so the aircraft stays dimly in view
const FOG_ALPHA = 0.58;              // opacity of one shell at full cloud density (about 1% left past the last)
const FOG_RAMP_M = 70;               // how far (m) the view fogs in and out across a layer's base and top
const MAX_ACTIVE = 8;
const FLASH_LIFE_S = 0.42;           // a flash's whole life (sim seconds)
const BOLT_RANGE_M = 40000;          // the farthest ground strike that draws a bolt
const FLASH_RANGE_M = 70000;         // the farthest flash that lights the scene at all
export const MAX_SHAFTS = 24;        // normalizeWeather()'s cap on microbursts
const SHAFT_SEGS = 24;
const SHAFT_DEFAULT_TOP_M = 2500;    // a shaft's top with no cloud layer (as the bolt's)
const SHAFT_MIN_TOP_M = 60;          // a layer on the deck still leaves a column to draw
const SHAFT_TAU = 1.1;               // optical depth per radius of rain (the middle of a column: about 3/4 of the view gone)
const SHAFT_MAX_ALPHA = 0.85;
// After every layer above the camera (-500 and below) and before every layer below it (500 and up) and the ground's
// transparent things, so a shaft shows in front of a ceiling and through the holes of a layer under the aircraft.
export const SHAFT_ORDER = -400;

// ------------------------------------------------------------------ the noise (pure: the same in JS and GLSL)

// The GLSL ihash(ivec2, uint) of glsl.js, exactly, so the sim's position can sample what the shader draws.
export function ihash(cx, cy, s) {
  let h = (Math.imul(cx, 374761393) + Math.imul(cy, 668265263) + Math.imul(s, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0xffffff) / 16777216;
}
const hsmooth = (t) => t * t * (3 - 2 * t);
function cv(px, py, s) {
  const fx = Math.floor(px), fy = Math.floor(py), ux = hsmooth(px - fx), uy = hsmooth(py - fy);
  const a = ihash(fx, fy, s), b = ihash(fx + 1, fy, s), c = ihash(fx, fy + 1, s), d = ihash(fx + 1, fy + 1, s);
  const ab = a + (b - a) * ux;
  return ab + ((c + (d - c) * ux) - ab) * uy;
}
const OCT_W = [0.40, 0.25, 0.17, 0.11, 0.07];
const OCT_F = [1.0, 2.03, 4.11, 8.27, 16.53];
const OCT_O = [0.0, 11.3, 23.7, 41.9, 7.1];
// The cloud field at p (in units of the layer's scale), about 0..1, mean about 0.5: the shader's cloudN at full detail.
export function cloudNoise(px, py, seed) {
  const s = seed >>> 0;
  const wx = cv(px * 0.5 + 3.1, py * 0.5 + 3.1, (s + 11) >>> 0) * 0.9 - 0.45;
  const wy = cv(px * 0.5 + 7.7, py * 0.5 + 7.7, (s + 23) >>> 0) * 0.9 - 0.45;
  const qx = px + wx, qy = py + wy;
  let v = 0;
  for (let i = 0; i < OCT_W.length; i++) v += OCT_W[i] * cv(qx * OCT_F[i] + OCT_O[i], qy * OCT_F[i] + OCT_O[i], (s + i * 7) >>> 0);
  return v;
}

const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// The threshold on cloudNoise that gives each okta's cover (tests/weather-clouds.test.mjs checks them against
// sampled cover). okta 0 has no cloud; 8 is solid (threshold below everything).
export const COVER_THR = [Infinity, 0.6301, 0.5773, 0.5370, 0.4996, 0.4622, 0.4216, 0.3689, -1];
export function coverThreshold(okta) {
  const k = Math.round(Math.min(Math.max(okta, 0), 8));
  return COVER_THR[k];
}

// A rain shaft's top (m): the lowest layer's base, of layerParams() layers sorted by height.
export function shaftTopM(layers) {
  return layers.length ? Math.max(layers[0].baseM, SHAFT_MIN_TOP_M) : SHAFT_DEFAULT_TOP_M;
}

// How much of the camera's spot is in cloud (0..1) at a map position for a layer (see layerParams()).
export function coverAt(layer, mapX, mapY) {
  if (layer.okta >= 8) return 1;
  const n = cloudNoise((mapX - layer.driftX) / layer.scale, (mapY - layer.driftY) / layer.scale, layer.seed);
  return sstep(layer.thr - SOFT, layer.thr + SOFT, n);
}

// One layer's settings for the shaders, from a { okta, baseFt, topFt } and its index. Null for no cloud.
export function layerParams(c, i, seed) {
  if (!c || !(c.okta > 0)) return null;
  const okta = Math.round(Math.min(c.okta, 8));
  const baseM = Math.max(c.baseFt, 0) * FT;
  const topM = Math.max(c.topFt, c.baseFt + 150) * FT;
  const s = (Math.imul((seed | 0), 1013) + Math.imul(i + 1, 7919)) & 0xffffff;
  // A little variation in the size of the clouds from layer to layer and flight to flight.
  const scale = CLOUD_SCALE_M * (0.85 + 0.3 * ihash(i + 3, 17, s));
  return { okta, baseM, topM, seed: s, scale, thr: coverThreshold(okta), driftX: 0, driftY: 0 };
}

// How far inside cloud the camera is, 0..1, over all the layers: the fog's strength. The noise at the camera
// says whether this bit of a broken layer has cloud in it at all.
export function fogStrength(layers, camAlt, mapX, mapY) {
  let f = 0;
  for (const l of layers) {
    const inZ = sstep(l.baseM - FOG_RAMP_M, l.baseM + FOG_RAMP_M, camAlt) * (1 - sstep(l.topM - FOG_RAMP_M, l.topM + FOG_RAMP_M, camAlt));
    if (inZ <= 0) continue;
    f = Math.max(f, inZ * coverAt(l, mapX, mapY));
  }
  return f;
}

// Which surfaces of a layer draw from a camera height, and in what order. A layer above the camera draws before
// the ground's transparent things (they're nearer), a layer below it after them (it covers them). Solid layers
// show only the near face. Returns { base, top, orderBase, orderTop }.
export function surfaceOrder(layer, i, camAlt) {
  const above = camAlt < layer.topM && camAlt < layer.baseM;
  const inside = camAlt >= layer.baseM && camAlt <= layer.topM;
  const solid = layer.okta >= 8;
  const lowOrder = -500 - i * 5, highOrder = 500 + i * 5;
  if (above) return { base: true, top: !solid, orderBase: lowOrder, orderTop: lowOrder - 1 };
  if (inside) return { base: true, top: true, orderBase: highOrder, orderTop: lowOrder };
  return { base: !solid, top: true, orderBase: highOrder, orderTop: highOrder + 1 };
}

// A flash's brightness at an age (s): a quick main stroke with two re-strikes, about 0.4 s in all.
export function flashEnvelope(age, power = 1) {
  if (age < 0 || age >= FLASH_LIFE_S) return 0;
  const peak = (t, width, height) => (age < t ? 0 : height * Math.exp(-(age - t) / width));
  return power * Math.min(peak(0, 0.05, 1) + peak(0.09, 0.05, 0.7) + peak(0.2, 0.06, 0.5), 1.6) * (1 - sstep(0.3, FLASH_LIFE_S, age));
}

// Seeded random in [0, 1).
function rng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

// A jagged bolt from height topM down to the ground, relative to the strike's point: polylines of [dx, h, dz] with
// the first the main channel. Seeded: the same strike gives the same bolt.
export function boltPaths(seed, topM, maxSegments = 60) {
  const r = rng(seed);
  const SEG = 24;
  const main = [[0, topM, 0]];
  for (let i = 1; i <= SEG; i++) {
    const k = i / SEG;
    const last = main[i - 1], jag = 220 * (1 - k * 0.6);
    main.push([last[0] + (r() - 0.5) * jag, topM * (1 - k), last[2] + (r() - 0.5) * jag]);
  }
  main[SEG][1] = 0;
  const paths = [main];
  let used = SEG;
  for (let b = 0; b < 3 && used < maxSegments; b++) {
    const start = 3 + Math.floor(r() * (SEG - 8));
    const n = Math.min(4 + Math.floor(r() * 5), maxSegments - used);
    const ang = r() * Math.PI * 2, spread = 180 + r() * 140;
    const path = [main[start].slice()];
    for (let i = 1; i <= n; i++) {
      const p = path[i - 1];
      path.push([p[0] + Math.cos(ang) * spread * 0.5 * (0.4 + r()), p[1] - (70 + r() * 110), p[2] + Math.sin(ang) * spread * 0.5 * (0.4 + r())]);
    }
    paths.push(path);
    used += n;
  }
  return paths;
}

// ------------------------------------------------------------------ the shaders

const CLOUD_GLSL = /* glsl */ `
const float OCT_W[5] = float[5](${OCT_W.map((v) => v.toFixed(4)).join(', ')});
const float OCT_F[5] = float[5](${OCT_F.map((v) => v.toFixed(2)).join(', ')});
const float OCT_O[5] = float[5](${OCT_O.map((v) => v.toFixed(1)).join(', ')});
float cv(vec2 p, uint s) {
  vec2 fl = floor(p), f = p - fl;
  ivec2 c = ivec2(fl);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = ihash(c, s), b = ihash(c + ivec2(1, 0), s), d = ihash(c + ivec2(0, 1), s), e = ihash(c + ivec2(1, 1), s);
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}
// The cloud field (cloudNoise in clouds.js): lod is the pixel's footprint in units of the scale. Each octave
// finer than a pixel gives way to its mean, so the distance doesn't shimmer; a low octave count cheapens the shading sample.
float cloudN(vec2 p, uint s, float lod, int octaves) {
  vec2 q = p + vec2(cv(p * 0.5 + vec2(3.1), s + 11u) * 0.9 - 0.45, cv(p * 0.5 + vec2(7.7), s + 23u) * 0.9 - 0.45);
  float v = 0.0;
  for (int i = 0; i < 5; i++) {
    if (i >= octaves) { v += OCT_W[i] * 0.5; continue; }
    float w = 1.0 - smoothstep(0.22, 0.72, OCT_F[i] * lod);
    if (w <= 0.0) { v += OCT_W[i] * 0.5; continue; }
    v += OCT_W[i] * mix(0.5, cv(q * OCT_F[i] + vec2(OCT_O[i]), s + uint(i) * 7u), w);
  }
  return v;
}
`;

const CLOUD_VERT = /* glsl */ `
varying vec3 vRel;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vRel = w.xyz - cameraPosition;
  w.y -= dot(vRel.xz, vRel.xz) / ${(2 * EARTH_RADIUS).toFixed(1)};
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const CLOUD_FRAG = /* glsl */ `
${UNIFORMS_GLSL}
${ATMOS_GLSL}
${NOISE_GLSL}
${CLOUD_GLSL}
uniform float uIsTop, uThr, uCov, uSeed, uScale, uSolid, uFlash;
uniform vec2 uDrift;
uniform vec2 uFlashPos;
varying vec3 vRel;
void main() {
  float dist = length(vRel);
  vec2 map = uOrigin + vec2(uCamPos.x + vRel.x, -(uCamPos.z + vRel.z)) - uDrift;
  vec2 p = map / uScale;
  float fw = length(fwidth(p));
  uint s = uint(uSeed);
  float n = cloudN(p, s, fw, 5);
  float cov = uSolid > 0.5 ? 1.0 : smoothstep(uThr - ${SOFT.toFixed(3)}, uThr + ${SOFT.toFixed(3)}, n);
  // Far away the field averages out: the layer turns to its cover fraction, not all or nothing.
  float far = smoothstep(0.5, 1.6, fw * 2.0);
  cov = mix(cov, uCov, far);
  // From below, the top surface shows only through the base's holes: let the sky through there too.
  if (uIsTop > 0.5 && vRel.y > 0.0) cov *= 0.45;
  // Don't paint a surface flat against the windshield: the fog shells take over close in.
  cov *= smoothstep(25.0, 260.0, dist);
  if (cov < 0.004) discard;

  // How thick the cloud is here (0 at its edge, 1 well inside).
  float thick = uSolid > 0.5 ? smoothstep(0.32, 0.72, n) : clamp((n - uThr) / 0.20, 0.0, 1.0);
  // Toward the sun: a cheap slope, the difference along the light (3 octaves).
  vec2 sxz = uSunDir.xz;
  float sl = length(sxz);
  vec2 toSun = sl > 1e-4 ? vec2(sxz.x, -sxz.y) / sl : vec2(0.0);
  float n2 = cloudN(p + toSun * 0.07, s, fw, 3);
  float slope = clamp((n - n2) * 9.0, -1.0, 1.0);

  float sunUp = max(uSunDir.y, 0.0);
  float mn = clamp(uMoonGlow.r * 100.0, 0.0, 1.0);
  float moonUp = smoothstep(0.0, 0.2, uMoonDir.y);
  vec3 col;
  bool under = vRel.y > 0.0;
  if (under) {
    // The underside: the sky's grey light, darker the thicker it is, with a brighter edge where the sun comes round.
    float grey = dot(uSkyAmb, vec3(0.2126, 0.7152, 0.0722));
    vec3 amb = mix(uSkyAmb, vec3(grey), 0.65) * 1.35;
    col = amb * mix(1.15, 0.42, thick);
    col += uSunColor * (0.10 + 0.42 * (1.0 - thick)) * smoothstep(0.0, 0.18, sunUp);
    col += vec3(0.04, 0.05, 0.07) * mn * moonUp * (1.0 - thick * 0.6);
    // City glow from below: built-up cover, blurred to about 8 km, orange.
    if (uNight > 0.02 && uHasCover > 0.5) {
      vec2 uv = (map + uDrift - uNat.xy) / uNatSizeM;
      float dense = textureLod(uCover, uv, 5.0).b;
      dense += 0.6 * textureLod(uCover, uv, 7.0).b;
      col += vec3(1.0, 0.42, 0.12) * clamp(dense * 0.16, 0.0, 0.065) * uNight * mix(1.0, 0.6, thick);
    }
  } else {
    // The top: the sun on it, shaped by the slope toward the sun, and the sky's light.
    float lam = clamp(sunUp * 0.9 + 0.12 + slope * 0.5 * smoothstep(0.0, 0.25, sunUp), 0.0, 1.25);
    col = uSunColor * lam * 1.55;
    col += uSkyAmb * (0.75 + 0.35 * sunUp);
    col *= mix(0.74, 1.02, smoothstep(0.34, 0.68, n));   // the billows: shaded hollows, bright crowns
    if (uIsTop < 0.5) col *= 0.82;      // the base seen from inside the layer is in shadow
    // Moonlight only: dark above, on a moonless night almost black.
    col += vec3(0.05, 0.062, 0.09) * mn * moonUp * (0.5 + 0.5 * clamp(uMoonDir.y + slope * 0.3, 0.0, 1.0));
  }

  // Lightning: the flash lights the cloud around it, brightest from below.
  if (uFlash > 0.0) {
    vec2 d = map + uDrift - uFlashPos;
    float k = exp(-dot(d, d) / 2.2e8);
    col += vec3(0.62, 0.68, 0.85) * uFlash * k * (under ? 1.5 : 0.9) * mix(0.55, 1.0, thick);
  }

  // Into the haze with the Earth's curve, as everything else on the ground.
  vec3 rel = vRel;
  rel.y -= dot(rel.xz, rel.xz) / ${(2 * EARTH_RADIUS).toFixed(1)};
  col = applyHaze(col, rel);

  gl_FragColor = vec4(col, cov);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const FOG_VERT = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FOG_FRAG = /* glsl */ `
uniform float uFogA, uFlash;
uniform vec3 uFogCol;
void main() {
  // Inside cloud: white in the sun, grey in dull light, near black at night, and a lit pale flash when lightning goes.
  vec3 c = uFogCol + vec3(0.5, 0.55, 0.7) * uFlash;
  gl_FragColor = vec4(c, uFogA);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const FLASH_FRAG = /* glsl */ `
uniform float uStrength;
void main() {
  gl_FragColor = vec4(vec3(0.72, 0.80, 1.0) * uStrength, 1.0);
}`;

const BOLT_VERT = /* glsl */ `
uniform float uPxScale;
attribute vec3 aNext;
attribute float aSide;
uniform float uWidthPx;
varying float vSide;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec3 next = (modelMatrix * vec4(aNext, 1.0)).xyz;
  vec3 dir = normalize(next - w.xyz + vec3(0.0, 1e-3, 0.0));
  vec3 view = w.xyz - cameraPosition;
  float dist = length(view);
  vec3 perp = normalize(cross(dir, view / max(dist, 1.0)) + vec3(1e-4, 0.0, 0.0));
  float halfW = uWidthPx * dist / max(uPxScale, 1.0);
  w.xyz += perp * aSide * halfW;
  w.y -= dot(view.xz, view.xz) / ${(2 * EARTH_RADIUS).toFixed(1)};
  vSide = aSide;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const BOLT_FRAG = /* glsl */ `
uniform float uBolt;
varying float vSide;
void main() {
  float a = exp(-vSide * vSide * 3.0);
  vec3 c = vec3(3.4, 3.7, 4.6) * uBolt * a;
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// The rain in a column, integrated along the view ray. Density falls as 1 - r^2/R^2, so across the ray's horizontal
// path (u about the point nearest the axis, half-chord c) the integral of (c^2 - u^2)/R^2 is exact; the chord's end
// clips to the camera, the ground and the top. No ray marching, so a fragment costs one noise call.
const SHAFT_VERT = /* glsl */ `
attribute vec3 aCell;     // x, z of the scene about the mesh's position, then the radius
uniform float uShaftTop;
varying vec3 vRel;
flat varying vec3 vC;     // the axis at the ground, from the camera
flat varying float vR, vInside, vSeed;
void main() {
  vec3 c = (modelMatrix * vec4(aCell.x, 0.0, aCell.y, 1.0)).xyz;
  float rim = aCell.z / ${Math.cos(Math.PI / SHAFT_SEGS).toFixed(6)};   // the polygon holds the circle
  vec4 w = vec4(c.x + position.x * rim, position.y * uShaftTop, c.z + position.z * rim, 1.0);
  vRel = w.xyz - cameraPosition;
  vC = c - cameraPosition;
  vR = aCell.z;
  vSeed = fract(aCell.x * 0.00131 + aCell.y * 0.00173) * 37.0;
  vInside = (length(vC.xz) < rim && cameraPosition.y < uShaftTop) ? 1.0 : 0.0;
  w.y -= dot(vRel.xz, vRel.xz) / ${(2 * EARTH_RADIUS).toFixed(1)};
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SHAFT_FRAG = /* glsl */ `
${UNIFORMS_GLSL}
${ATMOS_GLSL}
${NOISE_GLSL}
uniform float uShaftTop, uFlash;
uniform vec2 uFlashPos;
varying vec3 vRel;
flat varying vec3 vC;
flat varying float vR, vInside, vSeed;
void main() {
  // One wall per pixel: the near one from outside (hills in front of it cut it), the far one from inside.
  if ((vInside > 0.5) == gl_FrontFacing) discard;

  float h = length(vRel.xz);
  vec2 dh = h > 1e-3 ? vRel.xz / h : vec2(1.0, 0.0);
  float slope = vRel.y / max(h, 1e-3);
  vec2 o = -vC.xz;
  float sc = -dot(o, dh);
  float b2 = dot(o, o) - sc * sc;
  float R2 = vR * vR, c2 = R2 - b2;
  if (c2 <= 0.0) discard;
  float c = sqrt(c2);

  // The part of the chord ahead of the camera, between the ground and the top (u is measured from sc).
  float u0 = max(-c, -sc), u1 = c;
  float y0 = cameraPosition.y;
  if (abs(slope) < 1e-6) {
    if (y0 > uShaftTop) discard;
  } else {
    float sGround = -y0 / slope, sTop = (uShaftTop - y0) / slope;
    u0 = max(u0, min(sGround, sTop) - sc);
    u1 = min(u1, max(sGround, sTop) - sc);
  }
  if (u1 <= u0) discard;
  float integral = ((c2 * u1 - u1 * u1 * u1 / 3.0) - (c2 * u0 - u0 * u0 * u0 / 3.0)) / R2;

  // Curtains of heavier and lighter rain, across the shaft and a little down it, at the chord's middle.
  float um = 0.5 * (u0 + u1), sm = sc + um, ym = y0 + slope * sm;
  float bs = dot(o, vec2(-dh.y, dh.x));
  float n = fbm3(vec2(bs / vR * 2.6 + vSeed, ym / uShaftTop * 1.3));
  float tau = ${SHAFT_TAU.toFixed(3)} * integral / vR * min(sqrt(1.0 + slope * slope), 3.0) * mix(0.55, 1.45, n);
  tau *= 1.0 - smoothstep(0.82, 1.0, ym / uShaftTop);   // into the cloud (or into clear air, with no layer)
  float a = min(1.0 - exp(-tau), ${SHAFT_MAX_ALPHA.toFixed(2)});
  // From inside only the far wall draws, and the ground in front of it hides it: fade the rays that reach it low,
  // or the wall's foot would show as a hard line on the ground.
  if (vInside > 0.5) a *= smoothstep(0.0, 140.0, y0 + slope * (sc + u1));
  if (a < 0.004) discard;

  // Lit as a layer's underside: the sky's grey light, a little of the sun's, nearly nothing at night.
  float grey = dot(uSkyAmb, vec3(0.2126, 0.7152, 0.0722));
  vec3 col = mix(uSkyAmb, vec3(grey), 0.7) * 0.42;
  col += uSunColor * 0.03 * smoothstep(0.0, 0.18, max(uSunDir.y, 0.0));

  // Lightning lights the shafts near it.
  if (uFlash > 0.0) {
    vec2 d = uOrigin + vec2(uCamPos.x + vC.x, -(uCamPos.z + vC.z)) - uFlashPos;
    col += vec3(0.62, 0.68, 0.85) * uFlash * exp(-dot(d, d) / 2.2e8) * 0.8;
  }

  // Hazed at the middle of the rain the ray crosses, with the Earth's curve.
  vec3 rel = vec3(dh.x * sm, sm * slope, dh.y * sm);
  rel.y -= dot(rel.xz, rel.xz) / ${(2 * EARTH_RADIUS).toFixed(1)};
  col = applyHaze(col, rel);

  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ------------------------------------------------------------------ geometry

// A disc of concentric rings (radii in metres, growing outwards), y = 0, indexed.
function discGeometry() {
  const n = 1 + RINGS * SEGS;
  const pos = new Float32Array(n * 3);
  let v = 3;
  for (let r = 0; r < RINGS; r++) {
    const rad = RING_INNER_M * Math.pow(DISC_RADIUS_M / RING_INNER_M, r / (RINGS - 1));
    for (let s = 0; s < SEGS; s++) {
      const a = (s / SEGS) * Math.PI * 2;
      pos[v++] = Math.cos(a) * rad;
      pos[v++] = 0;
      pos[v++] = Math.sin(a) * rad;
    }
  }
  const idx = new Uint32Array(3 * (SEGS + 2 * SEGS * (RINGS - 1)));
  let k = 0;
  for (let s = 0; s < SEGS; s++) { idx[k++] = 0; idx[k++] = 1 + ((s + 1) % SEGS); idx[k++] = 1 + s; }
  for (let r = 0; r < RINGS - 1; r++) {
    for (let s = 0; s < SEGS; s++) {
      const a = 1 + r * SEGS + s, b = 1 + r * SEGS + (s + 1) % SEGS, c = a + SEGS, d = b + SEGS;
      idx[k++] = a; idx[k++] = b; idx[k++] = c;
      idx[k++] = b; idx[k++] = d; idx[k++] = c;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// The fog's nested spheres, in one geometry: all one colour, so their order doesn't matter.
function fogGeometry() {
  const parts = FOG_RADII.map((r) => new THREE.SphereGeometry(r, 18, 12));
  const count = parts.reduce((a, g) => a + g.attributes.position.count, 0);
  const idxCount = parts.reduce((a, g) => a + g.index.count, 0);
  const pos = new Float32Array(count * 3);
  const idx = new Uint32Array(idxCount);
  let v = 0, k = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, v * 3);
    for (let i = 0; i < g.index.count; i++) idx[k++] = g.index.array[i] + v;
    v += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// The unit column (radius 1, y 0..1), walls and top cap, wound outward; one instance per cell.
export function shaftGeometry() {
  const n = SHAFT_SEGS;
  const pos = new Float32Array((2 * n + 1) * 3);
  for (let s = 0; s < n; s++) {
    const a = (s / n) * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
    pos.set([x, 0, z], s * 3);
    pos.set([x, 1, z], (n + s) * 3);
  }
  pos.set([0, 1, 0], 2 * n * 3);
  const idx = new Uint16Array(n * 9);
  for (let s = 0, k = 0; s < n; s++) {
    const t = (s + 1) % n, a = s, b = t, c = n + s, d = n + t;
    idx[k++] = a; idx[k++] = c; idx[k++] = b;
    idx[k++] = b; idx[k++] = c; idx[k++] = d;
    idx[k++] = c; idx[k++] = 2 * n; idx[k++] = d;
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(MAX_SHAFTS * 3), 3));
  g.instanceCount = 0;
  return g;
}

const BOLT_MAX_SEGS = 60;
function boltGeometry() {
  const vtx = BOLT_MAX_SEGS * 4;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vtx * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aNext', new THREE.BufferAttribute(new Float32Array(vtx * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array(vtx), 1).setUsage(THREE.DynamicDrawUsage));
  const idx = new Uint16Array(BOLT_MAX_SEGS * 6);
  for (let i = 0; i < BOLT_MAX_SEGS; i++) {
    idx[i * 6] = i * 4; idx[i * 6 + 1] = i * 4 + 1; idx[i * 6 + 2] = i * 4 + 2;
    idx[i * 6 + 3] = i * 4 + 2; idx[i * 6 + 4] = i * 4 + 1; idx[i * 6 + 5] = i * 4 + 3;
  }
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// ------------------------------------------------------------------ createClouds

export function createClouds(scene, uniforms) {
  const shared = {
    uDrift: { value: new THREE.Vector2() },
    uFlash: { value: 0 },
    uFlashPos: { value: new THREE.Vector2() },
  };

  const disc = discGeometry();
  function surface(isTop) {
    const own = {
      uIsTop: { value: isTop ? 1 : 0 },
      uThr: { value: 1 }, uCov: { value: 0 }, uSeed: { value: 0 }, uScale: { value: CLOUD_SCALE_M },
      uSolid: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, uniforms, shared, own),
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(disc, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.name = isTop ? 'cloud-top' : 'cloud-base';
    scene.add(mesh);
    return { mesh, mat, own };
  }
  const surfaces = [];
  for (let i = 0; i < MAX_LAYERS; i++) surfaces.push({ base: surface(false), top: surface(true) });

  // The fog shells: drawn last, depth-tested, so the cockpit and anything close stays.
  const fogU = { uFogA: { value: 0 }, uFogCol: { value: new THREE.Vector3() }, uFlash: shared.uFlash };
  const fogMat = new THREE.ShaderMaterial({
    uniforms: fogU,
    vertexShader: FOG_VERT,
    fragmentShader: FOG_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const fog = new THREE.Mesh(fogGeometry(), fogMat);
  fog.frustumCulled = false;
  fog.visible = false;
  fog.renderOrder = 900;
  fog.name = 'cloud-fog';
  scene.add(fog);

  // The flash over the whole scene, for a moment.
  const flashU = { uStrength: { value: 0 } };
  const flashMat = new THREE.ShaderMaterial({
    uniforms: flashU,
    vertexShader: /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: FLASH_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const flashGeo = new THREE.BufferGeometry();
  flashGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const flashMesh = new THREE.Mesh(flashGeo, flashMat);
  flashMesh.frustumCulled = false;
  flashMesh.visible = false;
  flashMesh.renderOrder = 950;
  flashMesh.name = 'lightning-flash';
  scene.add(flashMesh);

  // Three's own materials (the aircraft) get an ambient light for the flash; visible only then.
  const flashLight = new THREE.AmbientLight(0xc8d4ff, 0);
  flashLight.visible = false;
  flashLight.name = 'lightning-light';
  scene.add(flashLight);

  // The bolt, for one strike at a time: a camera-facing ribbon.
  const boltU = { uBolt: { value: 0 }, uWidthPx: { value: 1.6 } };
  const boltGeo = boltGeometry();
  const boltMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({ uPxScale: uniforms.uPxScale }, boltU),
    vertexShader: BOLT_VERT,
    fragmentShader: BOLT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const bolt = new THREE.Mesh(boltGeo, boltMat);
  bolt.frustumCulled = false;
  bolt.visible = false;
  bolt.renderOrder = 100;
  bolt.name = 'lightning-bolt';
  scene.add(bolt);

  // The rain shafts: one instanced draw for the whole set.
  const shaftU = { uShaftTop: { value: SHAFT_DEFAULT_TOP_M } };
  const shaftGeo = shaftGeometry();
  const shaftMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, uniforms, shared, shaftU),
    vertexShader: SHAFT_VERT,
    fragmentShader: SHAFT_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shaft = new THREE.Mesh(shaftGeo, shaftMat);
  shaft.frustumCulled = false;
  shaft.visible = false;
  shaft.renderOrder = SHAFT_ORDER;
  shaft.name = 'rain-shafts';
  scene.add(shaft);

  let settings = null;
  let layers = [];
  let shaftCount = 0, shaftRefX = 0, shaftRefY = 0;   // the instances are stored about the first cell
  let lightningOn = false;
  let lastT = NaN;
  const active = [];                       // the flashes alive, oldest first
  let boltStrike = null;                   // the strike whose bolt is drawn
  const strikes = [];                      // reused by strikesBetween
  const camPos = new THREE.Vector3();
  const stats = { layers: 0, drawCalls: 0, triangles: 0, fog: 0, flash: 0, bolts: 0, shafts: 0 };

  function hideAll() {
    for (const s of surfaces) { s.base.mesh.visible = false; s.top.mesh.visible = false; }
    fog.visible = false; flashMesh.visible = false; flashLight.visible = false; bolt.visible = false; shaft.visible = false;
    active.length = 0; boltStrike = null; lastT = NaN;
    stats.layers = 0; stats.drawCalls = 0; stats.triangles = 0; stats.fog = 0; stats.flash = 0; stats.bolts = 0; stats.shafts = 0;
  }

  function buildShafts(cells) {
    shaftCount = Math.min(cells.length, MAX_SHAFTS);
    shaftGeo.instanceCount = shaftCount;
    if (!shaftCount) return;
    shaftRefX = cells[0].x; shaftRefY = cells[0].y;
    const attr = shaftGeo.attributes.aCell, arr = attr.array;
    for (let i = 0; i < shaftCount; i++) {
      arr[i * 3] = cells[i].x - shaftRefX;
      arr[i * 3 + 1] = -(cells[i].y - shaftRefY);
      arr[i * 3 + 2] = cells[i].radiusM;
    }
    attr.needsUpdate = true;
  }

  function buildBolt(s, topM) {
    const paths = boltPaths(s.seed, topM, BOLT_MAX_SEGS);
    const pos = boltGeo.attributes.position.array, nxt = boltGeo.attributes.aNext.array, side = boltGeo.attributes.aSide.array;
    let v = 0, segs = 0;
    for (const path of paths) {
      for (let i = 0; i + 1 < path.length && segs < BOLT_MAX_SEGS; i++, segs++) {
        const a = path[i], b = path[i + 1];
        for (let q = 0; q < 4; q++) {
          const p = q < 2 ? a : b;
          pos[v * 3] = p[0]; pos[v * 3 + 1] = p[1]; pos[v * 3 + 2] = p[2];
          nxt[v * 3] = b[0]; nxt[v * 3 + 1] = b[1]; nxt[v * 3 + 2] = b[2];
          side[v] = (q % 2) ? 1 : -1;
          v++;
        }
      }
    }
    boltGeo.attributes.position.needsUpdate = true;
    boltGeo.attributes.aNext.needsUpdate = true;
    boltGeo.attributes.aSide.needsUpdate = true;
    boltGeo.setDrawRange(0, segs * 6);
  }

  return {
    setWeather(s) {
      settings = s || null;
      layers = (s?.clouds || []).map((c, i) => layerParams(c, i, s.seed)).filter(Boolean).slice(0, MAX_LAYERS)
        .sort((a, b) => a.baseM - b.baseM);
      lightningOn = !!s && s.lightning > 0;
      lastT = NaN;
      active.length = 0;
      boltStrike = null;
      buildShafts(s?.microbursts || []);
      shaftU.uShaftTop.value = shaftTopM(layers);
      if (!layers.length && !lightningOn && !shaftCount) hideAll();
    },

    update({ camera, origin, state, paused = false }) {
      if (!layers.length && !lightningOn && !shaftCount) { if (stats.drawCalls) hideAll(); return; }
      const t = Number.isFinite(state?.t) ? state.t : 0;
      camera.updateMatrixWorld();
      camPos.setFromMatrixPosition(camera.matrixWorld);
      const mapX = origin.x + camPos.x, mapY = origin.y - camPos.z;
      const camAlt = camPos.y;

      // The clouds drift with the wind aloft, by sim time: a pure function of it.
      let driftX = 0, driftY = 0;
      const a = settings?.aloft;
      if (a && a.kt > 0) {
        const r = magToGrid(a.fromDeg * Math.PI / 180, settings.refX || 0, settings.refY || 0), v = a.kt * 0.5144 * 0.7;   // the wind's magnetic direction, on the map
        driftX = -Math.sin(r) * v * t;
        driftY = -Math.cos(r) * v * t;
      }
      shared.uDrift.value.set(driftX, driftY);

      // ---- lightning (sim time: no strikes while the sim is stopped)
      let flash = 0, scene_flash = 0, flashX = 0, flashY = 0;
      if (lightningOn) {
        const window = Number.isFinite(lastT) ? t - lastT : 0;
        if (!paused && window > 0 && window < 3) {
          strikesBetween(settings, lastT, t, mapX, mapY, strikes);
          for (const s of strikes) {
            const sd = (Math.imul(s.t * 1000 | 0, 16807) + (settings.seed | 0)) | 0;
            const st = { t: s.t, x: s.x, y: s.y, power: s.power, ground: s.ground, seed: sd };
            active.push(st);
            if (active.length > MAX_ACTIVE) active.shift();
            if (s.ground && Math.hypot(s.x - mapX, s.y - mapY) < BOLT_RANGE_M) boltStrike = st;
          }
        }
        if (window < 0 || window >= 3) { active.length = 0; boltStrike = null; }
        if (!paused) lastT = t;

        // The strongest flash now (weighted by distance) lights the clouds and the scene; one is plenty.
        let best = 0;
        for (let i = active.length - 1; i >= 0; i--) {
          const s = active[i], age = t - s.t;
          if (age > FLASH_LIFE_S || age < 0) { active.splice(i, 1); continue; }
          const dist = Math.hypot(s.x - mapX, s.y - mapY);
          const env = flashEnvelope(age, s.power);
          const near = 1 / (1 + (dist / 15000) ** 2);
          if (env * near > best) { best = env * near; flash = env; flashX = s.x; flashY = s.y; scene_flash = env * clamp01(1 - dist / FLASH_RANGE_M) * (0.25 + 0.75 * near); }
        }

        // The bolt lasts as long as its flash.
        if (boltStrike) {
          const age = t - boltStrike.t;
          if (age >= FLASH_LIFE_S || age < 0) boltStrike = null;
          else {
            if (!bolt.userData.built || bolt.userData.built !== boltStrike) {
              const topM = layers.length ? layers[0].baseM : 2500;
              buildBolt(boltStrike, topM);
              bolt.userData.built = boltStrike;
            }
            boltU.uBolt.value = Math.min(flashEnvelope(age, boltStrike.power) * 1.1, 1.3);
            bolt.position.set(boltStrike.x - origin.x, 0, -(boltStrike.y - origin.y));
          }
        }
      }
      const boltOn = !!boltStrike && boltU.uBolt.value > 0.02;
      if (bolt.visible !== boltOn) bolt.visible = boltOn;

      shared.uFlash.value = flash;
      shared.uFlashPos.value.set(flashX, flashY);
      const flashScreen = scene_flash * THREE.MathUtils.lerp(0.05, 0.3, uniforms.uNight.value);
      flashU.uStrength.value = flashScreen;
      const flashOn = flashScreen > 0.004;
      if (flashMesh.visible !== flashOn) flashMesh.visible = flashOn;
      if (flashLight.visible !== flashOn) flashLight.visible = flashOn;
      flashLight.intensity = scene_flash * THREE.MathUtils.lerp(0.6, 4.0, uniforms.uNight.value);

      // ---- the surfaces
      let draws = 0, tris = 0;
      for (let i = 0; i < MAX_LAYERS; i++) {
        const l = layers[i], S = surfaces[i];
        if (!l) { S.base.mesh.visible = false; S.top.mesh.visible = false; continue; }
        const ord = surfaceOrder(l, i, camAlt);
        place(S.base, l, l.baseM, ord.base, ord.orderBase);
        place(S.top, l, l.topM, ord.top, ord.orderTop);
        if (ord.base) { draws++; tris += disc.index.count / 3; }
        if (ord.top) { draws++; tris += disc.index.count / 3; }
      }

      // ---- the view inside a layer
      for (const l of layers) { l.driftX = driftX; l.driftY = driftY; }
      const inCloud = fogStrength(layers, camAlt, mapX, mapY);
      fog.visible = inCloud > 0.01;
      if (fog.visible) {
        fog.position.copy(camPos);
        fogU.uFogA.value = FOG_ALPHA * inCloud;
        // Day: bright and grey-white; dusk takes the sun's colour; night, the sky's (dark) light.
        const sunY = Math.max(uniforms.uSunDir.value.y, 0);
        const c = uniforms.uSunColor.value, a = uniforms.uSkyAmb.value;
        fogU.uFogCol.value.set(c.r * 0.55 * sunY + a.r * 1.2, c.g * 0.55 * sunY + a.g * 1.2, c.b * 0.55 * sunY + a.b * 1.2);
        draws++; tris += fog.geometry.index.count / 3;
      }

      // ---- the rain shafts (the origin follows the camera, so the set moves against it every frame)
      const shaftOn = shaftCount > 0;
      if (shaft.visible !== shaftOn) shaft.visible = shaftOn;
      if (shaftOn) {
        shaft.position.set(shaftRefX - origin.x, 0, -(shaftRefY - origin.y));
        draws++; tris += shaftCount * shaftGeo.index.count / 3;
      }

      stats.shafts = shaftCount;
      stats.layers = layers.length;
      stats.fog = inCloud;
      stats.flash = flash;
      stats.bolts = boltOn ? 1 : 0;
      stats.drawCalls = draws + (flashOn ? 1 : 0) + (boltOn ? 1 : 0);
      stats.triangles = tris + (flashOn ? 1 : 0) + (boltOn ? boltGeo.drawRange.count / 3 : 0);

      function place(sf, l, alt, on, order) {
        if (sf.mesh.visible !== on) sf.mesh.visible = on;
        if (!on) return;
        sf.mesh.position.set(camPos.x, alt, camPos.z);
        sf.mesh.renderOrder = order;
        const o = sf.own;
        o.uThr.value = l.thr; o.uCov.value = l.okta / 8; o.uSeed.value = l.seed; o.uScale.value = l.scale;
        o.uSolid.value = l.okta >= 8 ? 1 : 0;
      }
    },

    get stats() { return stats; },
  };
}
