// The dense centres from real buildings (briefs/V0-6-0.md Part 6 step 2, behind CITIES_ON): OpenStreetMap's
// footprints (ODbL) in nine city centres, extruded to their heights, with our own facades.
//
//   const centres = createCentres(scene, uniforms, chunks, { heightfield, renderer, baseUrl });
//   each frame:  centres.update({ camMap, origin, camScene, agl });   // -> centres.stats
//   centres.maskAt(x, y)     true where the real buildings replace the procedural block (map metres)
//   centres.maskVersion()    rises whenever the mask changes (rebuild the block lists)
//   centres.dispose()
//
// Loading: centres.json once; a centre's buildings when the camera comes within LOAD_M of its box
// (Seoul, Songdo and Busan with CITIES_ON; the six others also need EAST_ASIA_ON), fetched, parsed
// and built in a Worker (centres-worker.js; Tokyo's build is about 100 ms of CPU), then handed to the
// GPU over the next frames, one mesh a frame (each at most a few MB), drawn only once all are in;
// released beyond RELEASE_M. One centre builds at a time, the nearest first.
//
// The tiers (the numbers in the report): the tall (top >= 35 m) in one mesh sorted by height, its
// draw range the buildings at least tallCut(d) tall at the box's nearest point (all within about
// 12 km, 60 m and up to 27 km, 100 m and up to 55 km, none beyond 60 km); each building grows out of
// the ground as its own distance crosses the cut, so nothing pops. The low (under 35 m) in 2 km
// chunks, one mesh per chunk row, each drawing the run of its chunks within LOW_R of the camera, the
// buildings shrinking into the ground between 0.78 and 0.97 LOW_R (cities.js's grow), and none above
// CITY_MAX_AGL. Red aviation lights on everything at AVIATION_M or more: one Points draw per centre,
// at night only.
//
// The ground: the vertex shader samples terrainHeight() at each building's centre (every vertex of a
// building gets the same base), sinks the foot by the slope over the footprint's radius, and raised
// building:parts start at their minHeight. Records on a runway's flattening zone and under a landmark
// (landmarks.js, loaded if it's there) are left out by the builder.

import * as THREE from '../../vendor/three.module.js';
import { CITIES_ON, EAST_ASIA_ON } from './region.js';
import { toMap } from './frame.js';
import { CITY_MAX_AGL } from './cities.js';
import { CELL_M, AVIATION_M, loadAndBuild } from './centres-worker.js';

export const LOAD_M = 60000;           // load a centre within this of its box
export const RELEASE_M = 120000;       // release it beyond this
export const LOW_R = 7500;             // the low tier's reach (m, horizontal)
const CULL_MARGIN = 250;               // m round a box tested against the view (v0.6.1): a building's reach past its chunk's square
// The tall tier's cut (m of height below which a building isn't drawn) by its distance (m, from the
// camera, with the camera's height above the ground): knots of a piecewise-linear function. A
// building is full height once its top passes 1.25 x the cut.
export const CUT_KNOTS = [[0, 0], [12000, 28], [15000, 48], [27000, 48], [30000, 80], [55000, 80], [60000, 1000]];
export function tallCut(d) {
  const K = CUT_KNOTS;
  if (d <= K[0][0]) return K[0][1];
  for (let k = 1; k < K.length; k++) {
    if (d < K[k][0]) return K[k - 1][1] + (K[k][1] - K[k - 1][1]) * (d - K[k - 1][0]) / (K[k][0] - K[k - 1][0]);
  }
  return 1e5;
}
const CUT_GLSL = (() => {
  const K = CUT_KNOTS, f = (v) => v.toFixed(1);
  let s = 'float tallCut(float d) {\n';
  for (let k = 1; k < K.length; k++) s += `  if (d < ${f(K[k][0])}) return mix(${f(K[k - 1][1])}, ${f(K[k][1])}, (d - ${f(K[k - 1][0])}) / ${f(K[k][0] - K[k - 1][0])});\n`;
  return s + '  return 1e5;\n}\n';
})();

// The look by country (0 Korea, 1 Japan, 2 China); Korea's three stand with CITIES_ON alone.
const COUNTRY = { seoul: 0, songdo: 0, busan: 0, tokyo: 1, yokohama: 1, osaka: 1, fukuoka: 1, shanghai: 2, qingdao: 2 };
const KOREA = new Set(['seoul', 'songdo', 'busan']);
export function centreAllowed(id, cities = CITIES_ON, region = EAST_ASIA_ON) {
  return !!cities && (KOREA.has(id) || !!region);
}

// Distance (m) from (x, y) to a box [x0, y0, x1, y1] (0 inside).
export function boxDistance(b, x, y) {
  return Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3]));
}

// The landmarks as exclusion discs in map metres: [{ x, y, r }] (r = footprintM, at least 20 m).
export function landmarkExclusions(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const l of list) {
    if (!l || !Number.isFinite(l.lat) || !Number.isFinite(l.lon)) continue;
    const [x, y] = toMap(l.lat, l.lon);
    out.push({ x, y, r: Math.max(Number(l.footprintM) || 0, 20) });
  }
  return out;
}

// The low tier's draw range for one chunk row: [first chunk, last chunk] within r of (x, y) (map
// metres), or null. chunkM: the chunk's side; box: the centre's box.
export function rowRange(box, chunkM, chunkCols, row, x, y, r) {
  const y0 = box[1] + row * chunkM, y1 = y0 + chunkM;
  const dy = Math.max(y0 - y, 0, y - y1);
  if (dy >= r) return null;
  const half = Math.sqrt(r * r - dy * dy);
  const c0 = Math.max(0, Math.floor((x - half - box[0]) / chunkM));
  const c1 = Math.min(chunkCols - 1, Math.floor((x + half - box[0]) / chunkM));
  return c0 > c1 ? null : [c0, c1];
}

// Index into a descending list: how many of top[] are at least v.
export function countAtLeast(top, v) {
  let lo = 0, hi = top.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (top[m] >= v) lo = m + 1; else hi = m; }
  return lo;
}

// ---------------------------------------------------------------- shaders

const VERT = /* glsl */ `
uniform vec2 uAnchor;          // the centre's origin relative to the scene origin (map metres)
uniform float uTier, uLowR, uMaxAgl, uCountry, uSeedC;
attribute vec4 aP, aB, aN;
varying vec3 vRel, vN, vTint, vRoofCol;
varying vec4 vF;               // height above the ground (m), along the wall (m), top (m), roof 1 / wall 0
varying vec4 vG;               // seed, class, distance (m), estimated
varying vec2 vRxy;             // the point relative to the building's centre (m)
#include <logdepthbuf_pars_vertex>
const float Q = 32767.0;
${CUT_GLSL}
void main() {
  vec4 P = aP * Q, B = floor(aB * Q + 0.5);
  vec2 c = uAnchor + B.xy * 0.5;                       // the building's centre, map, from the origin
  float top = B.z * 0.1;
  float fl = floor(B.w / 4096.0), rad = B.w - fl * 4096.0;
  float est = mod(fl, 2.0);
  vec2 dc = c - vec2(uCamPos.x, -uCamPos.z);
  float dh = length(dc);
  float g;
  if (uTier < 0.5) {
    float cut = tallCut(length(vec2(dh, max(uCamAgl, 0.0))));
    g = clamp((top - cut) / (0.25 * cut + 1e-3), 0.0, 1.0);
  } else {
    g = 1.0 - smoothstep(uLowR * 0.78, uLowR * 0.97, dh);
    g *= 1.0 - smoothstep(uMaxAgl * 0.7, uMaxAgl, uCamAgl);
  }
  vec2 m = uOrigin + c;
  // Where the game's 250 m water field puts the building's centre well out in the water (piers,
  // reclaimed land the map doesn't have yet), leave it out: it would stand in the sea.
  float wet = uHasWater > 0.5 ? (texture(uWater, natUv(m)).r * 255.0 - 128.0) * 20.0 : 1.0;
  if (wet < -40.0) g = 0.0;
  if (g <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // The builder left out every record within a runway's flattening zone (and its blend), so the
  // flattening never applies here: the raw height is terrainHeight() without its runway loop.
  float pw;
  float ground = max(rawHeight(m, pw), 0.0);
  vec2 nn = texture(uNormal, natUv(m)).rg * (255.0 / 127.0) - (128.0 / 127.0);
  float sl = min(length(nn), 0.95);
  float sink = 1.0 + rad * min(sl / sqrt(1.0 - sl * sl), 0.7);
  float hv = P.z * 0.1;
  float y = ground + hv * g - (hv < 0.05 ? sink : 0.0) - (1.0 - g) * 4.0;
  vec2 lp = uAnchor + P.xy * 0.5;
  vec3 wp = vec3(lp.x, y, -lp.y);
  vec3 rel = wp - uCamPos;
  wp.y -= curveDrop(rel.xz);
  vRel = wp - uCamPos;
  vN = vec3(aN.x, aN.z, -aN.y);
  float roof = aN.w > 0.5 ? 1.0 : 0.0;
  vF = vec4(hv, P.w * 0.5, top, roof);
  vRxy = (P.xy - B.xy) * 0.5;
  ivec2 bi = ivec2(B.xy) + ivec2(int(uSeedC) * 7919, int(uSeedC) * 104729);
  float seed = ihash(bi, 41u), s1 = ihash(bi, 42u), s2 = ihash(bi, 43u), s3 = ihash(bi, 44u);
  // The class: 0 a glass tower (curtain wall), 1 a mid-rise of tile and render, 2 apartments (Korea's
  // slabs, China's point towers), 3 low-rise, 4 a podium (big and low: a mall, a station).
  int ctry = int(uCountry + 0.5);
  float cls;
  if (top < 30.0 && rad > 45.0) cls = 4.0;
  else if (top < 35.0) cls = 3.0;
  else if (ctry == 0 && top < 170.0 && rad < 70.0 && seed < 0.72) cls = 2.0;
  else if (ctry == 2 && top < 110.0 && rad < 45.0 && seed < (est > 0.5 ? 0.75 : 0.5)) cls = 2.0;
  else if (est < 0.5 && (top >= 90.0 || (top >= 55.0 && seed > (ctry == 1 ? 0.55 : 0.7)))) cls = 0.0;
  else cls = 1.0;
  vG = vec4(seed, cls, dh, est);
  // Facade colours (the cities' palette, a little richer for the towers).
  vec3 t;
  if (cls == 0.0) t = mix(vec3(0.26, 0.27, 0.28), vec3(0.36, 0.36, 0.35), s1);              // mullions and spandrels: aluminium, pale stone
  else if (cls == 1.0) t = s1 < 0.35 ? mix(vec3(0.30, 0.29, 0.27), vec3(0.37, 0.35, 0.31), s2)  // render, pale tile
                       : s1 < 0.6 ? mix(vec3(0.22, 0.20, 0.18), vec3(0.28, 0.25, 0.21), s2)   // brown tile, granite
                       : s1 < 0.85 ? mix(vec3(0.26, 0.27, 0.28), vec3(0.33, 0.34, 0.35), s2)  // grey concrete
                       : mix(vec3(0.16, 0.19, 0.22), vec3(0.22, 0.25, 0.28), s2);             // dark panels
  else if (cls == 2.0) t = (ctry == 2 ? (s1 < 0.4 ? vec3(0.36, 0.33, 0.28) : s1 < 0.7 ? vec3(0.34, 0.29, 0.27) : vec3(0.33, 0.34, 0.35))
                         : (s1 < 0.35 ? vec3(0.36, 0.355, 0.335) : s1 < 0.6 ? vec3(0.36, 0.33, 0.27) : s1 < 0.8 ? vec3(0.29, 0.29, 0.30) : vec3(0.33, 0.28, 0.23))) * (0.9 + 0.15 * s2);
  else if (cls == 3.0) t = ctry == 1 ? mix(vec3(0.33, 0.32, 0.30), vec3(0.25, 0.23, 0.20), s1)
                       : (s1 < 0.35 ? mix(vec3(0.22, 0.13, 0.09), vec3(0.29, 0.18, 0.12), s2) : mix(vec3(0.25, 0.24, 0.22), vec3(0.36, 0.33, 0.28), s2));
  else t = mix(vec3(0.17, 0.17, 0.17), vec3(0.24, 0.23, 0.22), s1);                         // podiums: darker
  if (est > 0.5) t = mix(t, vec3(0.30, 0.29, 0.27), 0.5);                                   // estimated: plainer
  vTint = t;
  float rr = s3;
  vRoofCol = cls == 0.0 ? vec3(0.13, 0.135, 0.14) * (0.85 + 0.3 * s2)
           : rr < 0.55 ? vec3(0.17, 0.17, 0.165) * (0.8 + 0.4 * s1)
           : rr < 0.72 ? (ctry == 1 ? vec3(0.10, 0.105, 0.11) : vec3(0.10, 0.14, 0.11))     // dark sheet, green waterproofing
           : rr < 0.86 ? vec3(0.24, 0.24, 0.23)                                              // pale concrete
           : ctry == 2 ? (rad > 25.0 && top < 40.0 && s2 < 0.6 ? vec3(0.11, 0.16, 0.24) : vec3(0.19, 0.19, 0.185))   // blue steel on sheds, else concrete
           : vec3(0.20, 0.11, 0.08);                                                          // terracotta
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */ `
varying vec3 vRel, vN, vTint, vRoofCol;
varying vec4 vF, vG;
varying vec2 vRxy;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vN);
  float y = vF.x, along = vF.y, top = vF.z;
  float seed = vG.x, cls = vG.y, dist = vG.z, est = vG.w;
  vec3 alb = vTint, glow = vec3(0.0), refl = vec3(0.0);
  vec3 vd = normalize(vRel);
  if (vF.w < 0.5) {
    float FH = cls < 0.5 ? 4.0 : cls < 1.5 ? 3.5 : cls < 2.5 ? 2.9 : cls < 3.5 ? 3.2 : 4.8;
    float fy = y / FH, fl = fract(fy);
    float fw = max(fwidth(y), fwidth(along));
    float fyw = fwidth(fy) + 1e-4;
    float w, cellW;
    if (cls < 0.5) {
      // A curtain wall: glass across, a spandrel at each slab, mullions every 1.5 m (averaged out
      // once they're under a pixel or two: no moire).
      float mu = along / 1.5, muw = fwidth(mu) + 1e-4, fm = fract(mu);
      float mull = smoothstep(0.0, 0.07 + muw, fm) * (1.0 - smoothstep(0.93 - muw, 1.0, fm));
      float span = smoothstep(0.0, 0.16 + fyw, fl) * (1.0 - smoothstep(0.97 - fyw, 1.0, fl));
      w = mix(mull * span, 0.8, smoothstep(0.25, 0.9, max(muw, fyw)));
      cellW = 3.0;
    } else if (cls < 2.5 && cls > 1.5) {
      // Apartments (cities.js): one unit every 9.6 m, piers and balcony glazing.
      float uu = along / 9.6, uw = fwidth(uu) + 1e-4, fu = fract(uu);
      float glz = smoothstep(0.0, 0.10 + uw, fu) * (1.0 - smoothstep(0.80 - uw, 0.86, fu));
      glz = mix(0.45, 1.0, mix(glz, 0.8, smoothstep(0.25, 0.6, uw)));
      float win = smoothstep(0.30, 0.36, fl) * (1.0 - smoothstep(0.80, 0.86, fl));
      w = glz * mix(win, 0.62, smoothstep(0.4, 1.4, fw));
      cellW = 9.6;
    } else {
      // Punched windows in bays of 3.2 m.
      float win = smoothstep(0.28, 0.34, fl) * (1.0 - smoothstep(0.82, 0.88, fl));
      float fa = fract(along / 3.2);
      float colw = smoothstep(0.10, 0.18, fa) * (1.0 - smoothstep(0.82, 0.90, fa));
      w = mix(win * colw * (cls > 3.5 ? 0.7 : 1.0), 0.3, smoothstep(0.4, 1.4, fw));
      cellW = 6.4;
    }
    if (est > 0.5) w = mix(w, 0.32, 0.5);                        // estimated heights: plainer
    float base = step(1.5, y);
    // The parapet: the top metre is solid, a shade lighter (the crown of a curtain wall too).
    float par = smoothstep(top - 1.4, top - 1.1, y);
    w *= base * (1.0 - par);
    // The glass, each tower its own (blue-grey, green, dark grey, silver, bronze).
    vec3 glass = vec3(0.045, 0.055, 0.065);
    if (cls < 0.5) glass = seed < 0.3 ? vec3(0.05, 0.075, 0.10) : seed < 0.5 ? vec3(0.05, 0.085, 0.08) : seed < 0.7 ? vec3(0.045, 0.05, 0.055)
                         : seed < 0.88 ? vec3(0.11, 0.12, 0.13) : vec3(0.085, 0.07, 0.05);
    float fade = 1.0 - smoothstep(1500.0, 5000.0, dist);
    alb = mix(alb, glass, w * mix(0.8, 0.95, fade));
    alb = mix(alb, vTint * 1.12, par);
    // Glass reflects the sky (Fresnel) and the sun.
    float cosv = max(dot(n, -vd), 0.0);
    float fr = (cls < 0.5 ? 0.06 : 0.03) + (cls < 0.5 ? 0.45 : 0.2) * pow(1.0 - cosv, 4.0);
    vec3 rd = reflect(vd, n);
    refl = w * fr * (uSkyAmb * 1.3 + uSunColor * 3.0 * pow(max(dot(rd, uSunDir), 0.0), 80.0));
    // Shopfronts: the ground floor darker, glazed, lit late.
    float shop = (1.0 - step(4.5, y)) * step(0.5, base) * (cls > 2.5 && cls < 3.5 || cls > 3.5 ? 1.0 : 0.6);
    alb *= 0.85 + 0.15 * smoothstep(0.0, 20.0, y);
    if (uNight > 0.01) {
      // Lit windows: a cell per bay (or per flat) on each floor, each building its own share, the
      // offices' cooler and more of them, averaged out far away (cities.js's way).
      float face = n.x + 2.0 * n.z;
      vec2 cid = vec2(floor(along / cellW), floor(fy));
      float hs = hash12(cid + vec2(seed * 913.0 + face * 57.0, seed * 371.0));
      float share = cls < 0.5 ? 0.10 + 0.25 * seed : cls < 1.5 ? 0.10 + 0.22 * seed : 0.12 + 0.26 * seed;
      float lit = step(hs, share);
      float hk = hash12(cid * 1.37 + seed * 77.0 + 3.1);
      float warm = cls < 1.5 ? 0.35 : 0.7;
      vec3 wc = hk < warm ? vec3(1.0, 0.56, 0.24) : (hk < 0.92 ? vec3(0.82, 0.86, 0.95) : vec3(0.5, 0.62, 1.0));
      float dimmer = (0.45 + 0.55 * hash12(cid + 11.7 + seed * 19.0)) * (cls < 1.5 ? 0.75 : 1.0);
      float avg = smoothstep(0.5, 1.6, max(fw / FH, fwidth(along) / cellW));
      vec3 meanCol = mix(vec3(1.0, 0.6, 0.3), vec3(0.85, 0.85, 0.9), cls < 1.5 ? 0.5 : 0.0) * share * 0.2;
      glow = mix(wc * lit * dimmer, meanCol, avg) * w * uNight * 0.9;
      // The shops' windows along the street.
      glow += vec3(1.0, 0.7, 0.4) * shop * (0.35 + 0.4 * step(0.4, hash12(vec2(floor(along / 5.0), seed * 53.0)))) * uNight * mix(1.0, 0.25, avg);
    }
  } else {
    // The roof: its own tone, and a plant room or two (colour only).
    alb = vRoofCol;
    float r = length(vRxy);
    float s1 = fract(seed * 13.17), s2 = fract(seed * 7.31);
    vec2 o = (vec2(s1, s2) - 0.5) * 8.0;
    vec2 hs = vec2(4.0 + 6.0 * s2, 3.0 + 5.0 * s1);
    vec2 q = abs(vRxy - o) - hs;
    float aa = fwidth(vRxy.x) + 1e-3;
    float box = 1.0 - smoothstep(-aa, aa, max(q.x, q.y));
    alb = mix(alb, alb * (s1 < 0.5 ? 1.35 : 0.7), box * step(14.0, top) * (seed > 0.25 ? 1.0 : 0.0));
    // A little texture (weathering, ducts) close in.
    alb *= 0.92 + 0.16 * hash12(floor(vRxy / 2.5) + seed * 97.0) * (1.0 - smoothstep(0.5, 2.0, aa));
    if (uSnow > 0.0) alb = mix(alb, vec3(0.55, 0.57, 0.60), uSnow * 0.75);   // snow on the roofs
  }
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 col = alb * (uSunColor * ndl * 2.2 + uSkyAmb * (0.55 + 0.45 * n.y) * 1.1) + glow + refl * (1.0 - uNight * 0.7);
  gl_FragColor = vec4(applyHaze(col, vRel), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// The red obstruction lights (night only): points that hold their size far away.
const LIGHT_VERT = /* glsl */ `
uniform vec2 uAnchor;
uniform float uSeedC;
attribute vec3 aL;             // x, y (m from the centre's origin), the light's height above the ground
attribute vec2 aC;             // the building's centre (m from the origin)
varying vec3 vCol;
#include <logdepthbuf_pars_vertex>
${CUT_GLSL}
void main() {
  vec2 c = uAnchor + aC;
  vec2 dc = c - vec2(uCamPos.x, -uCamPos.z);
  float cut = tallCut(length(vec2(length(dc), max(uCamAgl, 0.0))));
  if (aL.z < cut * 1.25 + 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec3(0.0); return; }
  float wet = uHasWater > 0.5 ? (texture(uWater, natUv(uOrigin + c)).r * 255.0 - 128.0) * 20.0 : 1.0;
  if (wet < -40.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec3(0.0); return; }
  float pw;
  float ground = max(rawHeight(uOrigin + c, pw), 0.0);
  vec2 lp = uAnchor + aL.xy;
  vec3 wp = vec3(lp.x, ground + aL.z, -lp.y);
  vec3 rel = wp - uCamPos;
  wp.y -= curveDrop(rel.xz);
  rel = wp - uCamPos;
  float d3 = length(rel);
  // Medium-intensity red, flashing about 30 a minute, each building on its own phase.
  float ph = ihash(ivec2(floor(aC * 2.0)) + ivec2(int(uSeedC) * 31, 0), 51u);
  float fl = fract(uTime * 0.5 + ph);
  float I = 0.3 + 0.7 * (smoothstep(0.0, 0.08, fl) * (1.0 - smoothstep(0.45, 0.6, fl)));
  float e0 = exp(-max(uCamAlt, 0.0) / HAZE_H);
  float od = abs(rel.y) < 1.0 ? HAZE_SIGMA0 * e0 * d3
           : HAZE_SIGMA0 * HAZE_H * d3 / rel.y * (e0 - exp(-max(uCamAlt + rel.y, 0.0) / HAZE_H));
  od += fogDepth(rel, d3);
  vec3 ext = exp(-0.6 * od * mix(vec3(0.85, 1.0, 1.2), vec3(1.0), uFogMix));
  vCol = vec3(1.0, 0.07, 0.03) * I * ext * uNight * 2.2;
  gl_PointSize = clamp(5.0 * uPxScale / max(d3, 1.0), 2.5, 5.0);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float dd = length(mv.xyz);
  mv.xyz *= 1.0 - min(1.5 / max(dd, 1e-3), 0.5);     // pulled 1.5 m towards the camera: off the roof
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const LIGHT_FRAG = /* glsl */ `
varying vec3 vCol;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vCol * (exp(-r2 * 6.0) * 1.3 + exp(-r2 * 2.0) * 0.3), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------- the module

export function createCentres(scene, uniforms, chunks, { heightfield = null, renderer = null, baseUrl = 'data/' } = {}) {
  const stats = { drawCalls: 0, triangles: 0, buildings: 0, loaded: 0, ready: '' };
  let maskVer = 0;
  const NOOP = {
    stats, group: null, centres: new Map(),
    update() { return stats; }, maskAt: () => false, maskVersion: () => 0, dispose() {}, log: [],
  };
  if (!CITIES_ON) return NOOP;

  const group = new THREE.Group();
  group.name = 'centres';
  scene.add(group);
  const abs = (u) => { try { return new URL(u, typeof location !== 'undefined' ? location.href : undefined).href; } catch { return u; } };
  const base = abs(baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  const log = [];          // per centre: the timings (the browser check reads them)

  // centres.json, and the landmarks (if their module is there yet).
  let index = null;
  const centres = new Map();
  const indexP = fetch(base + 'centres/centres.json').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => {
    index = j && Array.isArray(j.centres) ? j : { centres: [] };
    j && index.centres.forEach((info, k) => centres.set(info.id, { info, k, state: 'idle', res: null, parts: null, stage: 0 }));
  });
  let exclude = null;
  const landmarksP = import('./landmarks.js').catch(() => null).then((m) => { exclude = landmarkExclusions(m && m.LANDMARKS); });

  // The worker (one, made on the first build; idle between messages).
  let worker = null, workerFailed = false, jobSeq = 0, inFlight = null;
  function getWorker() {
    if (worker || workerFailed) return worker;
    try {
      worker = new Worker(new URL('./centres-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => onResult(e.data);
      worker.onerror = (e) => { console.warn('centres: worker error', e.message || e); if (inFlight) onResult({ job: inFlight.job, error: 'worker error' }); };
    } catch (e) { workerFailed = true; worker = null; }
    return worker;
  }
  function runRunways(info) {
    const rects = (heightfield && heightfield.runwayRects) || [];
    const [x0, y0, x1, y1] = info.box, m = 6000;
    return rects.filter((r) => r.cx > x0 - m - r.halfLen && r.cx < x1 + m + r.halfLen && r.cy > y0 - m - r.halfLen && r.cy < y1 + m + r.halfLen)
      .map((r) => ({ cx: r.cx, cy: r.cy, dx: r.dx, dy: r.dy, halfLen: r.halfLen, halfWid: r.halfWid }));
  }
  function startJob(c) {
    const job = ++jobSeq;
    const msg = { job, url: base + 'centres/' + c.info.file, info: c.info, exclude: exclude || [], runways: runRunways(c.info) };
    c.state = 'building'; c.job = job; c.t0 = performance.now();
    inFlight = { job, id: c.info.id };
    const w = getWorker();
    if (w) w.postMessage(msg);
    else loadAndBuild(msg).then((r) => { r.job = job; onResult(r); }, (e) => onResult({ job, error: String(e) }));
  }
  function onResult(r) {
    if (inFlight && r.job === inFlight.job) inFlight = null;
    for (const c of centres.values()) {
      if (c.job !== r.job) continue;
      if (c.state !== 'building') return;            // released meanwhile: drop it
      if (r.error) { console.warn('centres:', c.info.id, r.error); c.state = 'failed'; return; }
      c.res = r; c.state = 'staging'; c.stage = 0; c.tResult = performance.now();
      return;
    }
  }

  // Materials: one per tier per centre (the same program), and its own uniforms.
  const shared = uniforms;
  const vs = `${chunks.UNIFORMS_GLSL}\n${chunks.NOISE_GLSL}\n${chunks.HEIGHT_GLSL}\n${VERT}`;
  const fs = `${chunks.UNIFORMS_GLSL}\n${chunks.ATMOS_GLSL}\n${chunks.NOISE_GLSL}\n${FRAG}`;
  const lvs = `${chunks.UNIFORMS_GLSL}\n${chunks.NOISE_GLSL}\n${chunks.HEIGHT_GLSL}\n${chunks.ATMOS_GLSL}\n${LIGHT_VERT}`;
  function makeMats(c) {
    const own = { uAnchor: { value: new THREE.Vector2() }, uCountry: { value: COUNTRY[c.info.id] ?? 0 }, uSeedC: { value: c.k + 1 }, uLowR: { value: LOW_R }, uMaxAgl: { value: CITY_MAX_AGL } };
    const tall = new THREE.ShaderMaterial({ uniforms: Object.assign({}, shared, own, { uTier: { value: 0 } }), vertexShader: vs, fragmentShader: fs });
    const low = new THREE.ShaderMaterial({ uniforms: Object.assign({}, shared, own, { uTier: { value: 1 } }), vertexShader: vs, fragmentShader: fs });
    const lights = new THREE.ShaderMaterial({ uniforms: Object.assign({}, shared, own), vertexShader: lvs, fragmentShader: LIGHT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    return { own, tall, low, lights };
  }
  // Compile the programs once, before the first centre is drawn (in parallel where the GPU can).
  let compiled = null;
  function compile(c) {
    if (compiled) return compiled;
    if (!renderer || !renderer.compileAsync) { compiled = Promise.resolve(); return compiled; }
    const m = makeMats(c), g = new THREE.Group();
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('aP', new THREE.BufferAttribute(new Int16Array(12), 4, true));
    tri.setAttribute('aB', new THREE.BufferAttribute(new Int16Array(12), 4, true));
    tri.setAttribute('aN', new THREE.BufferAttribute(new Int8Array(12), 4, true));
    tri.setIndex([0, 1, 2]);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('aL', new THREE.BufferAttribute(new Float32Array(3), 3));
    pg.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(2), 2));
    g.add(new THREE.Mesh(tri, m.tall), new THREE.Mesh(tri, m.low), new THREE.Points(pg, m.lights));
    g.traverse((o) => { o.frustumCulled = false; });
    const cam = new THREE.PerspectiveCamera();
    compiled = renderer.compileAsync(g, cam, scene).catch(() => {}).then(() => {
      tri.dispose(); pg.dispose(); m.tall.dispose(); m.low.dispose(); m.lights.dispose();
    });
    return compiled;
  }

  const freeArrays = function () { this.array = null; };
  const attr = (a, n, norm) => new THREE.BufferAttribute(a, n, norm).onUpload(freeArrays);
  function tierGeometry(t, v0, v1, idx) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('aP', attr(t.aP.subarray(v0 * 4, v1 * 4), 4, true));
    g.setAttribute('aB', attr(t.aB.subarray(v0 * 4, v1 * 4), 4, true));
    g.setAttribute('aN', attr(t.aN.subarray(v0 * 4, v1 * 4), 4, true));
    g.setIndex(new THREE.BufferAttribute(idx, 1).onUpload(freeArrays));
    return g;
  }
  const mesh = (g, m, name) => {
    const o = new THREE.Mesh(g, m);
    o.frustumCulled = false; o.name = name; o.matrixAutoUpdate = false;
    g.setDrawRange(0, 0);                  // uploaded on the next render, drawn once ready
    group.add(o);
    return o;
  };

  // One staging step a frame: the materials and the tall mesh, then a low row a frame, then the
  // lights; then the centre is ready and its mask is on.
  function stageStep(c) {
    const r = c.res;
    if (c.stage === 0) {
      if (!c.parts) c.parts = { mats: makeMats(c), tall: null, rows: [], lights: null };
      const P = c.parts;
      P.tall = r.tall.index.length ? mesh(tierGeometry(r.tall, 0, r.tall.verts, r.tall.index), P.mats.tall, `centre-${c.info.id}-tall`) : null;
      c.stage = 1; c.row = 0;
      return;
    }
    const L = r.low, P = c.parts;
    if (c.stage === 1) {
      // The next non-empty chunk row: its vertices and its indices, rebased to the row's first vertex.
      while (c.row < L.chunkRows) {
        const row = c.row++;
        const i0 = L.chunkStart[row * L.chunkCols], i1 = L.chunkStart[(row + 1) * L.chunkCols];
        if (i1 <= i0) { P.rows.push(null); continue; }
        let vmin = Infinity, vmax = -1;
        for (let i = i0; i < i1; i++) { const v = L.index[i]; if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
        const idx = new Uint32Array(i1 - i0);
        for (let i = i0; i < i1; i++) idx[i - i0] = L.index[i] - vmin;
        const g = tierGeometry(L, vmin, vmax + 1, idx);
        const o = mesh(g, P.mats.low, `centre-${c.info.id}-low-${row}`);
        P.rows.push({ o, row, i0 });
        return;
      }
      c.stage = 2;
    }
    if (c.stage === 2) {
      const n = r.lights.length / 5;
      if (n) {
        const aL = new Float32Array(n * 3), aC = new Float32Array(n * 2);
        for (let k = 0; k < n; k++) {
          aL[k * 3] = r.lights[k * 5]; aL[k * 3 + 1] = r.lights[k * 5 + 1]; aL[k * 3 + 2] = r.lights[k * 5 + 2];
          aC[k * 2] = r.lights[k * 5 + 3]; aC[k * 2 + 1] = r.lights[k * 5 + 4];
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('aL', attr(aL, 3)); g.setAttribute('aC', attr(aC, 2));
        g.setDrawRange(0, n);              // no 'position': three needs the count (an infinite range draws nothing)
        const p = new THREE.Points(g, P.mats.lights);
        p.frustumCulled = false; p.name = `centre-${c.info.id}-lights`; p.renderOrder = 9; p.matrixAutoUpdate = false;
        p.visible = false;
        group.add(p);
        P.lights = { o: p, n };
      }
      // Done: keep only what the frames need (the GPU has the rest), and the mask is on.
      c.meta = { tallTop: r.tall.top, tallEnd: r.tall.end, chunkStart: L.chunkStart, chunkCols: L.chunkCols, chunkRows: L.chunkRows, chunkM: L.chunkM, mask: r.mask, masked: r.masked, kept: r.kept };
      c.timing = { id: c.info.id, ...r.ms, bytes: r.bytes, toResultMs: c.tResult - c.t0, stagingMs: performance.now() - c.tResult, totalMs: performance.now() - c.t0, tallTris: r.tall.tris, lowTris: r.low.tris, buildings: r.kept, lights: n, masked: r.masked, cells: c.info.cols * c.info.rows, skipped: r.skipped };
      log.push(c.timing);
      c.res = null;
      c.state = 'ready';
      maskVer++;
    }
  }

  function release(c) {
    const wasReady = c.state === 'ready';
    if (c.parts) {
      const P = c.parts;
      for (const o of [P.tall, ...P.rows.map((r) => r && r.o), P.lights && P.lights.o]) {
        if (!o) continue;
        group.remove(o); o.geometry.dispose();
      }
      P.mats.tall.dispose(); P.mats.low.dispose(); P.mats.lights.dispose();
    }
    c.parts = null; c.res = null; c.meta = null; c.state = 'idle'; c.job = 0;
    if (wasReady) maskVer++;
  }

  let compiling = false;
  // frustum (v0.6.1): the view's, in scene coordinates. A centre wholly out of view draws nothing,
  // and each row of low chunks is trimmed to the chunks the view can see (a run, as before).
  const cullBox = new THREE.Box3();
  const seen = (frustum, origin, x0, y0, x1, y1, top) => {
    cullBox.min.set(x0 - origin.x, -1500, -(y1 - origin.y));   // (far centres are drawn lower by the earth's curve: 280 m at 60 km)
    cullBox.max.set(x1 - origin.x, top, -(y0 - origin.y));
    return frustum.intersectsBox(cullBox);
  };
  function update({ camMap, origin, agl = 0, frustum = null }) {
    stats.drawCalls = 0; stats.triangles = 0; stats.buildings = 0; stats.staging = '';
    if (!CITIES_ON) { for (const c of centres.values()) if (c.state !== 'idle') release(c); return stats; }
    if (!index) return stats;
    const cx = camMap.x, cy = camMap.y;
    // Load and release by distance; one build at a time, the nearest first.
    let next = null, nextD = Infinity, staged = false, loaded = 0;
    for (const c of centres.values()) {
      const d = boxDistance(c.info.box, cx, cy);
      c.dist = d;
      const allowed = centreAllowed(c.info.id);
      if (c.state !== 'idle' && c.state !== 'failed' && (d > RELEASE_M || !allowed)) { release(c); continue; }
      if (c.state === 'failed' && d > RELEASE_M) c.state = 'idle';
      if (c.state === 'idle' && allowed && d < LOAD_M && d < nextD) { next = c; nextD = d; }
      if (c.state === 'staging' && !staged && !compiling) { stats.staging = `${c.info.id}:${c.stage}:${c.row || 0}`; stageStep(c); staged = true; }
      if (c.state !== 'idle' && c.state !== 'failed') loaded++;
    }
    stats.loaded = loaded;
    if (next && !inFlight && exclude !== null) {
      // The programs compile while the first centre builds.
      if (!compiled) { compiling = true; compile(next).then(() => { compiling = false; }); }
      startJob(next);
    }
    // Draw.
    const night = uniforms.uNight.value >= 0.01;
    const lowOn = agl < CITY_MAX_AGL;
    let ready = '';
    for (const c of centres.values()) {
      if (!c.parts) continue;
      const P = c.parts;
      P.mats.own.uAnchor.value.set(c.info.origin[0] - origin.x, c.info.origin[1] - origin.y);
      if (c.state !== 'ready') continue;
      ready += (ready ? ' ' : '') + c.info.id;
      const M = c.meta;
      const B = c.info.box;
      const inView = !frustum || seen(frustum, origin, B[0] - CULL_MARGIN, B[1] - CULL_MARGIN, B[2] + CULL_MARGIN, B[3] + CULL_MARGIN, 1500);
      if (!inView) {
        if (P.tall) P.tall.visible = false;
        for (const R of P.rows) if (R) R.o.visible = false;
        if (P.lights) P.lights.o.visible = false;
        continue;
      }
      // Tall: everything at least the cut at the box's nearest point.
      if (P.tall) {
        const cut = tallCut(Math.hypot(c.dist, Math.max(agl, 0)));
        const k = cut <= 0 ? M.tallTop.length : countAtLeast(M.tallTop, cut);
        const cnt = k ? M.tallEnd[k - 1] : 0;
        P.tall.geometry.setDrawRange(0, cnt);
        P.tall.visible = cnt > 0;
        if (cnt) { stats.drawCalls++; stats.triangles += cnt / 3; stats.buildings += k; }
      }
      // Low: each chunk row's run of chunks within reach.
      for (const R of P.rows) {
        if (!R) continue;
        const rr = lowOn && c.dist < LOW_R ? rowRange(c.info.box, M.chunkM, M.chunkCols, R.row, cx, cy, LOW_R) : null;
        if (!rr) { R.o.visible = false; continue; }
        if (frustum) {
          const y0 = B[1] + R.row * M.chunkM, col = (k) => seen(frustum, origin, B[0] + k * M.chunkM - CULL_MARGIN, y0 - CULL_MARGIN, B[0] + (k + 1) * M.chunkM + CULL_MARGIN, y0 + M.chunkM + CULL_MARGIN, 1000);
          while (rr[0] <= rr[1] && !col(rr[0])) rr[0]++;
          while (rr[1] > rr[0] && !col(rr[1])) rr[1]--;
          if (rr[0] > rr[1]) { R.o.visible = false; continue; }
        }
        const s = M.chunkStart[R.row * M.chunkCols + rr[0]], e = M.chunkStart[R.row * M.chunkCols + rr[1] + 1];
        R.o.geometry.setDrawRange(s - R.i0, e - s);
        R.o.visible = e > s;
        if (e > s) { stats.drawCalls++; stats.triangles += (e - s) / 3; }
      }
      // The aviation lights, at night.
      if (P.lights) {
        const on = night && c.dist < 60000;
        P.lights.o.visible = on;
        if (on) stats.drawCalls++;
      }
    }
    stats.ready = ready;
    return stats;
  }

  function maskAt(x, y) {
    for (const c of centres.values()) {
      if (c.state !== 'ready') continue;
      const b = c.info.box;
      if (x < b[0] || x >= b[2] || y < b[1] || y >= b[3]) continue;
      const i = Math.floor((x - b[0]) / CELL_M), j = Math.floor((y - b[1]) / CELL_M);
      if (i < 0 || j < 0 || i >= c.info.cols || j >= c.info.rows) continue;
      if (c.meta.mask[j * c.info.cols + i]) return true;
    }
    return false;
  }

  function dispose() {
    for (const c of centres.values()) release(c);
    scene.remove(group);
    if (worker) { worker.terminate(); worker = null; }
  }

  return {
    stats, group, centres, log, ready: Promise.all([indexP, landmarksP]),
    update, maskAt, maskVersion: () => maskVer, dispose,
    AVIATION_M,
  };
}
