// The sky: the sun and the Moon where they really are (src/astro.js), the light they give
// (uSunDir, uSunColor, uSkyAmb, uNight, three's sun and hemisphere lights, scene.fog), the
// haze (aerial perspective) every world shader applies, and the night sky: the real stars
// (BSC5, data/stars.json), a faint fill of fainter ones, the Milky Way, the Moon with its
// phase, and the twilight colours. Drawn as Satisfactory's sky is (a dome shader at infinity),
// in two draw calls at night (the dome and one Points draw for the stars) and one by day.
//
//   const sky = createSky(scene, uniforms, chunks);
//   every frame: sky.setTime(ms, latDeg, lonDeg); sky.update(camera, camAlt);
//
// Until setTime is called the sky is v0.1.4's fixed afternoon: the sun at 230°, 35° up.

import * as THREE from '../../vendor/three.module.js';
import { sunHorizontal, moonHorizontal, moonPhase, j2000ToEnuMatrix, galacticToEquatorial } from '../astro.js';

// v0.1.4's fixed afternoon sun: azimuth 230° true (south-west), 35° up.
export const SUN_AZIMUTH_DEG = 230;
export const SUN_ELEVATION_DEG = 35;

// Haze: extinction at sea level (1/m) and its scale height (m). About 60 km of visibility
// at sea level, clearer higher up: ground well visible ~100+ km from cruise.
export const HAZE_SIGMA0 = 2.6e-5;
export const HAZE_HEIGHT = 1500;

// The Moon is drawn a little larger than it is (its real 0.26° is a dot at 60° of view).
export const MOON_SCALE = 2.4;

const RAD = Math.PI / 180;

// Scene frame: X east, Y up, Z south (−map y). Azimuth from north, clockwise.
export function azElToScene(azDeg, elDeg, out = new THREE.Vector3()) {
  const az = azDeg * RAD, el = elDeg * RAD;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}
export function sunDirection(out = new THREE.Vector3()) {
  return azElToScene(SUN_AZIMUTH_DEG, SUN_ELEVATION_DEG, out);
}

// ------------------------------------------------------------------ the light (pure)

// Tables by the sun's (refracted) altitude, highest first: [deg, r, g, b], linear RGB.
// Above the first row the value is the first row's: the whole day looks like v0.1.4's.
// Each channel only falls as the sun goes down, so the light darkens monotonically.
const SUN_T = [
  [20, 1.0, 0.94, 0.86], [10, 1.0, 0.88, 0.74], [5, 0.98, 0.78, 0.56], [2, 0.92, 0.58, 0.30],
  [0, 0.75, 0.36, 0.12], [-2, 0.33, 0.13, 0.04], [-4, 0.08, 0.035, 0.015], [-6, 0, 0, 0],
];
// The sky's light on the ground, without the Moon: blue by day, the blue hour, then the
// dim blue-grey of a moonless night (airglow and starlight, ~5% of the day's).
const AMB_T = [
  [20, 0.38, 0.46, 0.58], [10, 0.36, 0.43, 0.54], [5, 0.31, 0.36, 0.46], [2, 0.25, 0.28, 0.38],
  [0, 0.19, 0.21, 0.30], [-2, 0.115, 0.13, 0.20], [-4, 0.065, 0.075, 0.13], [-6, 0.045, 0.055, 0.092],
  [-8, 0.030, 0.038, 0.064], [-10, 0.022, 0.028, 0.046], [-12, 0.0195, 0.026, 0.0415],
  [-15, 0.0172, 0.0229, 0.037], [-18, 0.0165, 0.022, 0.0355],
];
// The zenith and the horizon (sea level; skyBase darkens them with the camera's altitude).
const ZEN_T = [
  [20, 0.075, 0.20, 0.52], [10, 0.072, 0.19, 0.50], [5, 0.065, 0.165, 0.45], [2, 0.055, 0.13, 0.38],
  [0, 0.045, 0.10, 0.31], [-2, 0.032, 0.07, 0.23], [-4, 0.02, 0.045, 0.16], [-6, 0.011, 0.025, 0.098],
  [-8, 0.0062, 0.0135, 0.056], [-10, 0.0045, 0.0095, 0.036], [-12, 0.0038, 0.0075, 0.027],
  [-15, 0.0034, 0.0064, 0.022], [-18, 0.0032, 0.0060, 0.020],
];
const HOR_T = [
  [20, 0.58, 0.68, 0.82], [10, 0.58, 0.66, 0.78], [5, 0.56, 0.60, 0.68], [2, 0.36, 0.35, 0.43],
  [0, 0.17, 0.12, 0.16], [-2, 0.13, 0.095, 0.14], [-4, 0.10, 0.08, 0.125], [-6, 0.064, 0.058, 0.088],
  [-8, 0.032, 0.031, 0.050], [-10, 0.018, 0.020, 0.034], [-12, 0.0125, 0.0145, 0.026],
  [-15, 0.0105, 0.0125, 0.022], [-18, 0.0100, 0.0120, 0.021],
];
// The twilight glow at the horizon under the sun (orange, then red), and the Belt of Venus
// (pink, opposite the sun above the Earth's shadow). Not monotonic: they come and go.
const GLOW_T = [
  [12, 0, 0, 0], [6, 0.06, 0.02, 0.0], [3, 0.25, 0.06, 0.0], [0, 0.45, 0.06, 0.0],
  [-2, 0.40, 0.05, 0.005], [-4, 0.28, 0.04, 0.01], [-6, 0.16, 0.03, 0.015], [-9, 0.04, 0.01, 0.008],
  [-12, 0.006, 0.002, 0.002], [-15, 0, 0, 0],
];
const BELT_T = [
  [3, 0, 0, 0], [0, 0.08, 0.045, 0.06], [-2.5, 0.16, 0.085, 0.11], [-5, 0.07, 0.035, 0.06], [-7.5, 0, 0, 0],
];

function lerpTable(t, h, out) {
  if (h >= t[0][0]) { out[0] = t[0][1]; out[1] = t[0][2]; out[2] = t[0][3]; return out; }
  for (let i = 1; i < t.length; i++) {
    if (h >= t[i][0]) {
      const a = t[i - 1], b = t[i], k = (h - b[0]) / (a[0] - b[0]);
      for (let c = 0; c < 3; c++) out[c] = b[c + 1] + (a[c + 1] - b[c + 1]) * k;
      return out;
    }
  }
  const z = t[t.length - 1];
  out[0] = z[1]; out[1] = z[2]; out[2] = z[3];
  return out;
}
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
export const luminance = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// The Moon's light, 0..1: its lit fraction (brightness grows faster than the fraction: the
// opposition surge) and its height (dimmer through more air, gone below the horizon).
export function moonLight(moonAltDeg, moonIllum) {
  if (!(moonIllum > 0)) return 0;
  const up = smooth(-1.5, 8, moonAltDeg) * (0.45 + 0.55 * Math.sin(Math.max(moonAltDeg, 0) * RAD));
  return Math.pow(Math.min(moonIllum, 1), 1.6) * up;
}

// Everything the light needs from the sun's and the Moon's altitudes (degrees) and the
// Moon's lit fraction. Pure, for the tests. Colours are linear RGB arrays.
export function lightingAt(sunAltDeg, moonAltDeg = -90, moonIllum = 0) {
  const h = sunAltDeg;
  const sunColor = lerpTable(SUN_T, h, [0, 0, 0]);
  const skyAmb = lerpTable(AMB_T, h, [0, 0, 0]);
  const zenith = lerpTable(ZEN_T, h, [0, 0, 0]);
  const horizon = lerpTable(HOR_T, h, [0, 0, 0]);
  const glow = lerpTable(GLOW_T, h, [0, 0, 0]);
  const belt = lerpTable(BELT_T, h, [0, 0, 0]);
  // 0 by day, 1 at night: ~0 with the sun above +4°, 1 below −10°.
  const night = 1 - smooth(-10, 4, h);
  // The Moon lights the ground and the sky, by night only (by day it's lost in the blue).
  const mk = moonLight(moonAltDeg, moonIllum);
  const mn = mk * smooth(2, -8, h);
  const MOON_AMB = [0.020, 0.026, 0.038], MOON_ZEN = [0.0016, 0.0036, 0.0095], MOON_HOR = [0.003, 0.005, 0.010];
  for (let c = 0; c < 3; c++) {
    skyAmb[c] += mn * MOON_AMB[c];
    zenith[c] += mn * MOON_ZEN[c];
    horizon[c] += mn * MOON_HOR[c];
  }
  // The haze tends to a colour a little deeper than the horizon (v0.1.4: 0.36, 0.46, 0.62).
  const hazeTint = [horizon[0] * 0.36 / 0.58, horizon[1] * 0.46 / 0.68, horizon[2] * 0.62 / 0.82];
  // The Moon's aureole in the sky and the haze.
  const moonGlow = [0.010 * mn, 0.011 * mn, 0.013 * mn];
  // The Earth's shadow: rises opposite the sun as it sets, its top about the sun's depression.
  const shadow = smooth(1, -2.5, h) * smooth(-9, -5, h);
  const shadowTopRad = Math.max(0, -h - 0.5) * 0.9 * RAD;
  // The stars come out below −6° and are all there by −15°.
  const stars = 1 - smooth(-15, -6, h);
  return {
    sunColor, skyAmb, zenith, horizon, glow, belt, hazeTint, moonGlow, shadow, shadowTopRad,
    night, stars, moon: mn,
    // The disc of the Moon: faint in the day's blue, bright at night.
    moonDisc: 0.25 + 2.15 * smooth(6, -6, h),
    // A suggested renderer.toneMappingExposure: a little more at night, so it isn't crushed.
    exposure: 1 + 0.45 * night,
    // Three's own lights (the aircraft), relative to v0.1.4's: the sun's strength and the Moon's.
    sunScale: luminance(sunColor) / luminance(SUN_T[0].slice(1)),
    moonScale: 0.05 * mk * smooth(0, -6, h),
    ambScale: luminance(skyAmb) / luminance(AMB_T[0].slice(1)),
  };
}

// The colour of a star from its B−V index (blue-white to orange-red), normalised.
const BV_T = [[-0.4, 0.60, 0.70, 1.0], [0.0, 0.78, 0.85, 1.0], [0.3, 0.97, 0.96, 1.0], [0.6, 1.0, 0.93, 0.82],
  [1.0, 1.0, 0.82, 0.60], [1.5, 1.0, 0.70, 0.44], [2.2, 1.0, 0.58, 0.32]];
export function bvColor(bv) {
  if (!Number.isFinite(bv)) bv = 0.4;
  const b = Math.min(Math.max(bv, -0.4), 2.2);
  const t = BV_T.map((r) => r).reverse();      // lerpTable wants highest first
  return lerpTable(t, b, [0, 0, 0]);
}

// ------------------------------------------------------------------ GLSL

// GLSL: sky colour by direction, the haze colour, and applyHaze(). Needs UNIFORMS_GLSL.
// The sky's own uniforms (uSky*) come from createSky; a material made without them (uSkyOn
// is then 0) gets v0.1.4's fixed day.
export const ATMOS_GLSL = /* glsl */ `
const float HAZE_SIGMA0 = ${HAZE_SIGMA0.toExponential()};
const float HAZE_H = ${HAZE_HEIGHT.toFixed(1)};
uniform float uSkyOn, uSkyShadow, uSkyShadowTop;
uniform vec3 uSkyZenith, uSkyHorizon, uSkyGlow, uSkyBelt, uHazeTint, uMoonDir, uMoonGlow;

// Below this elevation (rad) the view ray meets the Earth: the horizon dips as you climb.
float horizonDip() { return -sqrt(2.0 * max(uCamAlt, 1.0) / 6371000.0); }

vec3 skyBase(vec3 dir) {
  float alt = clamp(uCamAlt / 12000.0, 0.0, 1.0);
  bool on = uSkyOn > 0.5;
  vec3 z0 = on ? uSkyZenith : vec3(0.075, 0.20, 0.52);
  vec3 h0 = on ? uSkyHorizon : vec3(0.58, 0.68, 0.82);
  // Higher up the sky darkens (v0.1.4: zenith 0.035, 0.11, 0.38 and horizon 0.52, 0.64, 0.82 at 12 km).
  vec3 zenith = z0 * mix(vec3(1.0), vec3(0.035 / 0.075, 0.11 / 0.20, 0.38 / 0.52), alt);
  vec3 horizon = h0 * mix(vec3(1.0), vec3(0.52 / 0.58, 0.64 / 0.68, 1.0), alt);
  float e = dir.y - horizonDip();
  float t = pow(1.0 - clamp(e, 0.0, 1.0), mix(5.0, 9.0, alt));
  vec3 c = mix(zenith, horizon, t);
  // Sun-ward brightening (Mie forward scattering) and a gentle aureole.
  float mu = max(dot(dir, uSunDir), 0.0);
  c += uSunColor * (0.10 * pow(mu, 6.0) + 0.22 * pow(mu, 48.0)) * (0.5 + 0.5 * t);
  if (on) {
    // Twilight: the glow along the horizon under the sun, and opposite it the Earth's
    // shadow (blue-grey) with the Belt of Venus (pink) above.
    vec2 sh = uSunDir.xz, dh = dir.xz;
    float shl = length(sh), dhl = length(dh);
    float az = (shl > 1e-4 && dhl > 1e-4) ? dot(dh / dhl, sh / shl) : 0.0;
    float ee = max(e, 0.0);
    float toward = 0.5 + 0.5 * az, anti = 1.0 - toward;
    // Under the sun the long path through the air takes the blue out of the sky's light.
    float redden = pow(toward, 5.0) * exp(-ee * 6.0) * clamp(uSkyGlow.r * 2.5, 0.0, 1.0);
    c *= 1.0 - redden * vec3(0.0, 0.45, 0.85);
    c += uSkyGlow * (0.95 * pow(toward, 5.0) * exp(-ee * 6.0) + 0.22 * toward * toward * exp(-ee * 2.0) + 0.10 * exp(-ee * 9.0));
    float w = anti * anti;
    float belt = exp(-pow((e - uSkyShadowTop - 0.08) / 0.07, 2.0));
    c += uSkyBelt * belt * w;
    float inShadow = (1.0 - smoothstep(uSkyShadowTop - 0.01, uSkyShadowTop + 0.02, e)) * w * uSkyShadow;
    c = mix(c, c * vec3(0.55, 0.62, 0.88), inShadow);
    // The Moon's aureole.
    float mm = max(dot(dir, uMoonDir), 0.0);
    c += uMoonGlow * (0.6 * pow(mm, 8.0) + 1.8 * pow(mm, 90.0)) * (0.6 + 0.4 * t);
  }
  return c;
}

// Colour the haze tends to along a view direction (no sun disc).
vec3 hazeColor(vec3 dir) {
  vec3 d = dir;
  d.y = max(d.y, horizonDip());
  return skyBase(d);
}

vec3 skyColor(vec3 dir) {
  vec3 c = skyBase(dir);
  float mu = dot(dir, uSunDir);
  // The disc, ~0.5°; low down it reddens and dims (above ~7° it is v0.1.4's).
  float redden = clamp(1.0 - uSunDir.y * 8.0, 0.0, 1.0);
  vec3 disc = uSunColor * mix(vec3(1.0), pow(uSunColor / max(uSunColor.r, 1e-4), vec3(2.0)) * 0.03, redden);
  c += disc * 30.0 * smoothstep(0.99994, 0.99997, mu);
  if (dir.y < horizonDip()) c = hazeColor(dir);
  return c;
}

// Exponential height fog along the ray from the camera to a point at offset rel (scene).
vec3 applyHaze(vec3 col, vec3 rel) {
  float dist = length(rel);
  float h0 = uCamAlt, dh = rel.y;
  float od;
  float e0 = exp(-max(h0, 0.0) / HAZE_H);
  if (abs(dh) < 1.0) od = HAZE_SIGMA0 * e0 * dist;
  else od = HAZE_SIGMA0 * HAZE_H * dist / dh * (e0 - exp(-max(h0 + dh, 0.0) / HAZE_H));
  vec3 ext = exp(-od * vec3(0.85, 1.0, 1.2));
  // A clear autumn day: the haze is blue-grey, a little deeper than the white-ish horizon sky
  // (at night a dark blue; at sunset it takes the glow through hazeColor).
  vec3 tint = uSkyOn > 0.5 ? uHazeTint : vec3(0.36, 0.46, 0.62);
  vec3 hc = mix(hazeColor(rel / max(dist, 1e-3)), tint, 0.35);
  return col * ext + hc * (1.0 - ext);
}
`;

// The galactic frame in J2000 equatorial unit vectors (x to RA 0, y to RA 90°, z north).
function eqVec(ra, dec) { return [Math.cos(dec * RAD) * Math.cos(ra * RAD), Math.cos(dec * RAD) * Math.sin(ra * RAD), Math.sin(dec * RAD)]; }
const gv = (l, b) => { const e = galacticToEquatorial(l, b); return eqVec(e.raDeg, e.decDeg); };
const GAL_C = gv(0, 0), GAL_90 = gv(90, 0), GAL_N = gv(0, 90);
const v3s = (v) => `vec3(${v.map((x) => x.toFixed(6)).join(', ')})`;

// The dome's night pieces: the faint fill of stars, the Milky Way and the Moon.
const NIGHT_GLSL = /* glsl */ `
uniform mat3 uSkyToJ;        // scene direction -> J2000
uniform float uStarVis, uMoonR, uMoonDisc;
uniform vec3 uMoonPole;      // the celestial north pole in the scene frame (orients the Moon's face)

float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 h33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float vn3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), u.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), u.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
float fbm4(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * vn3(p); p = p * 2.07 + 13.7; a *= 0.5; } return v; }

float gPix = 0.001;   // a pixel in radians, set at the top of main()

// The faint stars below the catalogue's limit: at most one per cell of a grid round the sky,
// denser along the Milky Way (band: 0..1).
vec3 fillStars(vec3 j, float band) {
  vec3 p = j * 260.0, c = floor(p);
  vec3 h = h33(c);
  if (h.x < 0.90 - 0.12 * band) return vec3(0.0);
  vec3 sp = c + 0.5 + (h33(c + 17.0) - 0.5) * 0.6;
  float dist = length(p - sp);
  float px = gPix * 260.0;
  float r = max(0.10, px * 1.1);                 // at least a pixel wide: no shimmer
  float s = smoothstep(r, r * 0.3, dist) * (0.004 + 0.022 * pow(h.y, 3.0)) * min(0.10 / r, 1.0) * 5.0;
  vec3 tint = mix(vec3(0.78, 0.85, 1.0), vec3(1.0, 0.90, 0.76), h.z);
  return tint * s;
}

// The Milky Way: a soft, mottled band along the galactic plane, brightest and widest towards
// Sagittarius (l = 0), with the dark Great Rift from Cygnus down to Scorpius.
const vec3 GAL_C = ${v3s(GAL_C)}, GAL_90 = ${v3s(GAL_90)}, GAL_N = ${v3s(GAL_N)};
vec3 milkyWay(vec3 j, out float bandOut) {
  float sb = dot(j, GAL_N);
  float b = asin(clamp(sb, -1.0, 1.0));
  bandOut = 0.0;
  if (abs(b) > 0.75) return vec3(0.0);
  float l = atan(dot(j, GAL_90), dot(j, GAL_C));               // -pi..pi, 0 at the centre
  float bulge = exp(-pow(l / 0.42, 2.0));
  float cl = 0.5 + 0.5 * cos(l);
  float width = 0.075 + 0.05 * cl + 0.10 * bulge;
  float n1 = fbm4(j * 7.0 + 3.0), n2 = fbm4(j * 15.0 + 11.0), n3 = fbm4(j * 34.0 + 5.0);
  float bw = b + (n1 - 0.5) * 0.05;
  float band = exp(-bw * bw / (width * width));
  float wide = exp(-b * b / (0.09 + 0.08 * bulge));
  bandOut = band;
  // Bright towards the centre, dim towards the anticentre (Auriga, Taurus).
  float bright = 0.30 + 0.55 * cl * cl + 1.5 * bulge;
  // Star clouds, then the dust: the Great Rift just north of the plane from l = 85° to −35°,
  // and patchy lanes everywhere in the band.
  float clouds = 0.35 + 1.1 * n1 * n1 + 0.7 * smoothstep(0.45, 0.8, n2) + 0.35 * n3;
  float riftL = smoothstep(-0.70, -0.45, l) * (1.0 - smoothstep(1.30, 1.55, l));
  float riftB = 0.012 + 0.012 * sin(l * 3.0) + (n2 - 0.5) * 0.03;
  float rift = exp(-pow((b - riftB) / (0.020 + 0.012 * bulge), 2.0)) * riftL;
  float dust = smoothstep(0.52, 0.72, fbm4(j * 21.0 + 7.0)) * band;
  float g = band * clouds * bright * (1.0 - 0.85 * rift) * (1.0 - 0.55 * dust) + 0.22 * wide * (0.6 + 0.8 * n1) * bright;
  // Warm and creamy in the bulge, blue-white along the arms, a violet tinge in the wide glow.
  vec3 col = mix(vec3(0.70, 0.76, 1.0), vec3(1.0, 0.86, 0.66), clamp(bulge * 0.9 + 0.1 * n2, 0.0, 1.0));
  col = mix(vec3(0.62, 0.56, 0.95), col, clamp(band * 1.4, 0.0, 1.0));
  return col * g * 0.03;
}

// The Moon's disc, lit by the sun (the terminator follows the real phase), with its maria and a
// little earthshine on the dark side. rgb, and its coverage in a.
vec4 moonDisc(vec3 d) {
  float cd = dot(d, uMoonDir);
  if (cd < cos(uMoonR * 1.08)) return vec4(0.0);
  vec3 up = uMoonPole - uMoonDir * dot(uMoonPole, uMoonDir);
  vec3 v = length(up) > 1e-4 ? normalize(up) : vec3(0.0, 1.0, 0.0);
  vec3 u = normalize(cross(v, uMoonDir));
  float sr = sin(uMoonR);
  vec2 xy = vec2(dot(d, u), dot(d, v)) / sr;
  float rr = length(xy);
  float aa = max(gPix / sr, 1e-3);
  float a = smoothstep(1.0, 1.0 - aa * 1.5, rr);
  float z = sqrt(max(0.0, 1.0 - min(rr * rr, 1.0)));
  vec3 n = normalize(xy.x * u + xy.y * v - z * uMoonDir);
  // The maria: dark patches fixed on the face (in the face's own frame).
  vec3 f = vec3(xy, z);
  float m = smoothstep(0.42, 0.62, fbm4(f * 2.2 + vec3(4.1, 1.7, 0.3)));
  float crat = smoothstep(0.6, 0.7, fbm4(f * 9.0 + 2.0));
  vec3 alb = mix(vec3(0.95, 0.93, 0.88), vec3(0.58, 0.58, 0.60), m) * (1.0 - 0.12 * crat);
  float lit = smoothstep(-0.04, 0.12, dot(n, uSunDir));
  float limb = 0.75 + 0.25 * z;                  // a little limb darkening
  // Low down the Moon turns yellow, then orange.
  vec3 tint = mix(vec3(1.0, 0.72, 0.45), vec3(1.0, 0.98, 0.95), smoothstep(0.0, 0.25, uMoonDir.y));
  vec3 c = alb * tint * (lit * limb * uMoonDisc + 0.012);
  return vec4(c, a);
}
`;

// The catalogue stars: one Points draw. Positions are J2000 unit vectors; uStarMat turns them
// to the scene. Each fades with the sky's brightness behind it, into the haze near the
// horizon, and near the Moon; and twinkles a little, more near the horizon.
const STAR_VERT = (chunks) => /* glsl */ `
${chunks.UNIFORMS_GLSL}
${ATMOS_GLSL}
uniform mat3 uStarMat;
uniform float uStarVis, uMoonR;
attribute vec3 aCol;
attribute float aSize;
varying vec3 vCol;
void main() {
  vec3 d = uStarMat * position;
  float e = d.y - horizonDip();
  float hi = smoothstep(1500.0, 11000.0, uCamAlt);
  float haze = mix(smoothstep(0.0, 0.16, e), smoothstep(0.0, 0.05, e), hi);
  float lum = dot(skyBase(d), vec3(0.2126, 0.7152, 0.0722));
  float contrast = 1.0 / (1.0 + lum * 70.0);
  float seed = fract(float(gl_VertexID) * 0.61803);
  float tw = 1.0 + (0.10 + 0.35 * (1.0 - smoothstep(0.0, 0.4, e))) * (1.0 - 0.8 * hi)
           * sin(uTime * (4.0 + 7.0 * seed) + seed * 80.0);
  float moonCut = smoothstep(cos(uMoonR * 1.4), cos(uMoonR * 2.2), dot(d, uMoonDir));
  float k = uStarVis * haze * contrast * tw * mix(1.0, 1.55, hi) * moonCut;
  vCol = aCol * k;
  gl_PointSize = aSize;
  gl_Position = projectionMatrix * viewMatrix * vec4(d * 45000.0 + cameraPosition, 1.0);
  if (e < 0.0 || k < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // off screen
}`;
const STAR_FRAG = /* glsl */ `
varying vec3 vCol;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 6.0) + 0.06 * (1.0 - r2);
  gl_FragColor = vec4(vCol * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Build the star Points from data/stars.json's flat [ra, dec, vmag, bv, …] list.
export function starGeometry(json) {
  const s = json.stars, n = Math.floor(s.length / 4);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ra = s[4 * i], dec = s[4 * i + 1], m = s[4 * i + 2], bv = s[4 * i + 3];
    const v = eqVec(ra, dec);
    pos.set(v, 3 * i);
    // Brightness: compressed magnitudes (faint stars stay visible on a screen), then colour.
    const b = 1.4 * Math.pow(10, -0.4 * (m - 1) * 0.72);
    const c = bvColor(bv);
    col[3 * i] = c[0] * b; col[3 * i + 1] = c[1] * b; col[3 * i + 2] = c[2] * b;
    size[i] = 2.2 + 4.8 * Math.pow(smooth(6.5, -1.5, m), 1.6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  return g;
}

// ------------------------------------------------------------------ createSky

// The sky dome: a sphere around the camera, drawn first, without depth; the stars right after.
export function createSky(scene, uniforms, chunks) {
  // The sky's uniforms, added to the shared object before the other world materials copy it.
  Object.assign(uniforms, {
    uSkyOn: { value: 1 },
    uSkyZenith: { value: new THREE.Vector3() }, uSkyHorizon: { value: new THREE.Vector3() },
    uSkyGlow: { value: new THREE.Vector3() }, uSkyBelt: { value: new THREE.Vector3() },
    uHazeTint: { value: new THREE.Vector3() },
    uSkyShadow: { value: 0 }, uSkyShadowTop: { value: 0 },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) }, uMoonGlow: { value: new THREE.Vector3() },
  });
  const own = {
    uSkyToJ: { value: new THREE.Matrix3() },
    uStarMat: { value: new THREE.Matrix3() },
    uStarVis: { value: 0 },
    uMoonR: { value: 0.26 * MOON_SCALE * RAD },
    uMoonDisc: { value: 0.25 },
    uMoonPole: { value: new THREE.Vector3(0, 1, 0) },
  };
  const u = Object.assign({}, uniforms, own);

  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 wp = vec4(position * 50000.0 + cameraPosition, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${chunks.UNIFORMS_GLSL}
      ${ATMOS_GLSL}
      ${NIGHT_GLSL}
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        gPix = max(length(fwidth(d)), 1e-5);
        vec3 col = skyColor(d);
        float e = d.y - horizonDip();
        if (e > 0.0) {
          if (uStarVis > 0.002) {
            // Stars and the Milky Way fade into the horizon's haze and against a bright sky;
            // from cruise the air is thinner and they are more vivid.
            float hi = smoothstep(1500.0, 11000.0, uCamAlt);
            float haze = mix(smoothstep(0.0, 0.22, e), smoothstep(0.0, 0.07, e), hi);
            float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
            float k = uStarVis * haze / (1.0 + lum * 70.0) * mix(1.0, 1.5, hi);
            vec3 j = uSkyToJ * d;
            float band;
            col += milkyWay(j, band) * k * (1.0 - 0.8 * clamp(uMoonGlow.r * 100.0, 0.0, 1.0));
            col += fillStars(j, band) * k;
          }
          if (uMoonDir.y > horizonDip() - 0.02) {
            vec4 m = moonDisc(d);
            col = mix(col, col * 0.15 + m.rgb, m.a);
            // the corona
            float th = sqrt(max(2.0 * (1.0 - dot(d, uMoonDir)), 0.0));
            col += uMoonGlow * 40.0 * (exp(-th / 0.010) + 0.25 * exp(-th / 0.05)) * smoothstep(-0.01, 0.02, e);
          }
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  scene.add(mesh);

  // The stars: added when data/stars.json has loaded. Additive, but in the opaque list
  // (transparent: false) so they draw right after the dome and everything else covers them.
  let stars = null;
  const starMat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: STAR_VERT(chunks),
    fragmentShader: STAR_FRAG,
    blending: THREE.AdditiveBlending,
    transparent: false,
    depthTest: false,
    depthWrite: false,
  });
  if (typeof fetch === 'function' && typeof document !== 'undefined') {
    fetch(new URL('../../data/stars.json', import.meta.url))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`stars.json ${r.status}`))))
      .then((json) => {
        stars = new THREE.Points(starGeometry(json), starMat);
        stars.frustumCulled = false;
        stars.renderOrder = -999;
        stars.name = 'stars';
        stars.visible = own.uStarVis.value > 0.002;
        scene.add(stars);
      })
      .catch((e) => console.warn('sky: no stars:', e));
  }

  const sun = sunDirection();
  const keyDir = sun.clone();
  const sunLight = new THREE.DirectionalLight(0xfff1e0, 3.0);
  sunLight.position.copy(sun).multiplyScalar(1000);
  sunLight.target.position.set(0, 0, 0);
  sunLight.name = 'sun';
  scene.add(sunLight, sunLight.target);
  const hemi = new THREE.HemisphereLight(0xa9c4e8, 0x5a5444, 1.1);
  hemi.name = 'skylight';
  scene.add(hemi);
  const DAY_SUN_LIGHT = sunLight.color.clone(), DAY_SKY = hemi.color.clone(), DAY_GROUND = hemi.groundColor.clone();
  const MOON_LIGHT = new THREE.Color(0.62, 0.72, 1.0);

  // scene.fog for three's own materials (the aircraft): exp2 matched to the haze near
  // the camera, in the horizontal haze colour.
  const fog = new THREE.FogExp2(0xa8b8cc, 1e-5);
  scene.fog = fog;

  const state = { sunAltDeg: SUN_ELEVATION_DEG, sunAzDeg: SUN_AZIMUTH_DEG, moonAltDeg: -90, moonAzDeg: 0, moonIllum: 0, night: 0, exposure: 1 };
  let L = null;
  const moonDir = uniforms.uMoonDir.value;
  const m3 = new THREE.Matrix3();

  // Apply the light for the sun's and the Moon's altitudes (lightingAt) to every uniform and light.
  function applyLight(sunAlt, moonAlt, illum) {
    L = lightingAt(sunAlt, moonAlt, illum);
    uniforms.uSunColor.value.setRGB(L.sunColor[0], L.sunColor[1], L.sunColor[2]);
    uniforms.uSkyAmb.value.setRGB(L.skyAmb[0], L.skyAmb[1], L.skyAmb[2]);
    uniforms.uSkyZenith.value.fromArray(L.zenith);
    uniforms.uSkyHorizon.value.fromArray(L.horizon);
    uniforms.uSkyGlow.value.fromArray(L.glow);
    uniforms.uSkyBelt.value.fromArray(L.belt);
    uniforms.uHazeTint.value.fromArray(L.hazeTint);
    uniforms.uMoonGlow.value.fromArray(L.moonGlow);
    uniforms.uSkyShadow.value = L.shadow;
    uniforms.uSkyShadowTop.value = L.shadowTopRad;
    uniforms.uNight.value = L.night;
    own.uStarVis.value = L.stars;
    own.uMoonDisc.value = L.moonDisc;
    if (stars) stars.visible = L.stars > 0.002;
    // Three's lights: the sun, or the Moon (cool and dim) once it's the brighter.
    const useMoon = L.moonScale > L.sunScale;
    keyDir.copy(useMoon ? moonDir : sun);
    if (useMoon) { sunLight.color.copy(MOON_LIGHT); sunLight.intensity = 3.0 * L.moonScale; }
    else {
      sunLight.color.setRGB(DAY_SUN_LIGHT.r * L.sunColor[0], DAY_SUN_LIGHT.g * L.sunColor[1] / 0.94, DAY_SUN_LIGHT.b * L.sunColor[2] / 0.86);
      sunLight.intensity = 3.0 * (L.sunColor[0] > 0 ? 1 : 0);
    }
    const a = L.skyAmb;
    hemi.color.setRGB(DAY_SKY.r * a[0] / 0.38, DAY_SKY.g * a[1] / 0.46, DAY_SKY.b * a[2] / 0.58);
    hemi.groundColor.copy(DAY_GROUND).multiplyScalar(L.ambScale);
    state.night = L.night;
    state.exposure = L.exposure;
  }
  uniforms.uSunDir.value.copy(sun);
  applyLight(SUN_ELEVATION_DEG, -90, 0);

  let last = { ms: NaN, lat: NaN, lon: NaN };
  const sky = {
    mesh, sunLight, hemi, fog, sun, state,
    get stars() { return stars; },
    get drawCalls() { return 1 + (stars && stars.visible ? 1 : 0); },
    get lighting() { return L; },

    // The time (epoch ms) and the place: the sun, the Moon and the stars, and the light.
    // Cheap: the astronomy reruns only every 0.25 s of clock time, on a jump, or after a move.
    setTime(ms, latDeg, lonDeg) {
      if (!Number.isFinite(ms) || !Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return;
      if (Math.abs(ms - last.ms) < 250 && Math.abs(latDeg - last.lat) < 0.01 && Math.abs(lonDeg - last.lon) < 0.01) return;
      last.ms = ms; last.lat = latDeg; last.lon = lonDeg;
      const s = sunHorizontal(ms, latDeg, lonDeg);
      const m = moonHorizontal(ms, latDeg, lonDeg);
      const ph = moonPhase(ms);
      azElToScene(s.azDeg, s.altRefractedDeg, sun);
      uniforms.uSunDir.value.copy(sun);
      azElToScene(m.azDeg, m.altRefractedDeg, moonDir);
      own.uMoonR.value = m.semiDiameterDeg * MOON_SCALE * RAD;
      // J2000 -> east, north, up; the scene is east, up, south.
      const E = j2000ToEnuMatrix(ms, latDeg, lonDeg);
      own.uStarMat.value.set(E[0], E[1], E[2], E[6], E[7], E[8], -E[3], -E[4], -E[5]);
      own.uSkyToJ.value.copy(m3.copy(own.uStarMat.value).transpose());
      own.uMoonPole.value.set(E[2], E[8], -E[5]);
      state.sunAltDeg = s.altRefractedDeg; state.sunAzDeg = s.azDeg;
      state.moonAltDeg = m.altRefractedDeg; state.moonAzDeg = m.azDeg; state.moonIllum = ph.illum;
      applyLight(s.altRefractedDeg, m.altRefractedDeg, ph.illum);
    },

    update(camera, camAlt) {
      // Keep the key light's shadowless direction fixed relative to the camera.
      sunLight.position.copy(camera.position).addScaledVector(keyDir, 1000);
      sunLight.target.position.copy(camera.position);
      // FogExp2: 1 - exp(-(density d)^2). Match the haze's optical depth at 3 km.
      const sigma = HAZE_SIGMA0 * Math.exp(-Math.max(camAlt, 0) / HAZE_HEIGHT);
      fog.density = Math.sqrt(sigma * 3000) / 3000;
      // Horizon haze colour in linear RGB (as skyBase gives near the horizon).
      const a = Math.min(Math.max(camAlt / 12000, 0), 1), h = L.horizon;
      fog.color.setRGB(h[0] * (1 + (0.52 / 0.58 - 1) * a), h[1] * (1 + (0.64 / 0.68 - 1) * a), h[2]);
    },
  };
  return sky;
}
