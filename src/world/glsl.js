// Shared GPU pieces for the world: the data textures, the uniforms every world shader
// reads, and the GLSL that samples heights exactly like heightfield.js does on the CPU.
//
// Every world material gets the same `uniforms` object (the values are shared), plus its
// own. The terrain, trees, buildings and runways all call terrainHeight() in their vertex
// shaders, so everything sits on the same ground.

import * as THREE from '../../vendor/three.module.js';
import { PATCH_BLEND, FLAT_MARGIN_U, FLAT_MARGIN_V, FLAT_BLEND, PAVE_BLEND_M } from './heightfield.js';
import { RUNWAY_SHOULDER_M } from './runways.js';
import { EARTH_RADIUS } from './frame.js';

export const MAX_PATCHES = 4;
export const MAX_RUNWAYS = 12;

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

// ------------------------------------------------------------------ textures

function dataTex(data, w, h, format, type, opts = {}) {
  const t = new THREE.DataTexture(data, w, h, format, type);
  if (opts.internal) t.internalFormat = opts.internal;
  t.minFilter = opts.mip ? THREE.LinearMipmapLinearFilter : (opts.linear ? THREE.LinearFilter : THREE.NearestFilter);
  t.magFilter = opts.linear || opts.mip ? THREE.LinearFilter : THREE.NearestFilter;
  t.generateMipmaps = !!opts.mip;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.flipY = false;
  t.unpackAlignment = 1;
  if (opts.aniso) t.anisotropy = opts.aniso;
  t.needsUpdate = true;
  return t;
}

// Normals (map ENU x, y packed as RG8 around 128) from a height grid, by central differences.
function normalsRG(h, nx, ny, cell, scale, out = new Uint8Array(nx * ny * 2), rowOff = 0) {
  const k = scale / (2 * cell);
  for (let j = 0; j < ny; j++) {
    const jm = j > 0 ? j - 1 : 0, jp = j < ny - 1 ? j + 1 : ny - 1;
    for (let i = 0; i < nx; i++) {
      const im = i > 0 ? i - 1 : 0, ip = i < nx - 1 ? i + 1 : nx - 1;
      let a = h[j * nx + im], b = h[j * nx + ip], c = h[jm * nx + i], d = h[jp * nx + i];
      if (a < 0) a = 0; if (b < 0) b = 0; if (c < 0) c = 0; if (d < 0) d = 0;
      const gx = (b - a) * k, gy = (d - c) * k;
      const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      const o = ((j + rowOff) * nx + i) * 2;
      out[o] = Math.round(128 - 127 * gx * inv);
      out[o + 1] = Math.round(128 - 127 * gy * inv);
    }
  }
  return out;
}

// Stack grids vertically in one atlas (2 spare rows between them). Returns rows and size.
function atlasLayout(grids) {
  let w = 1, rows = 0;
  const offs = [];
  for (const g of grids) { w = Math.max(w, g.nx); offs.push(rows); rows += g.ny + 2; }
  return { w, h: Math.max(1, rows), offs };
}

// Build every texture and uniform from a heightfield (heightfield.js). Missing layers get
// 1x1 stand-ins that mean "sea level, sea, no cover".
export function createWorldUniforms(hf) {
  const L = hf.layers || {};
  const scale = L.heightScale || 0.25;
  const nat = L.national || { x0: -400000, y0: -400000, cell: 250, nx: 3200, ny: 3200 };
  const has = hf.info || {};

  const heightTex = has.height
    ? dataTex(nat.height, nat.nx, nat.ny, THREE.RedIntegerFormat, THREE.ShortType, { internal: 'R16I' })
    : dataTex(new Int16Array([-80]), 1, 1, THREE.RedIntegerFormat, THREE.ShortType, { internal: 'R16I' });
  const normalTex = has.height
    ? dataTex(normalsRG(nat.height, nat.nx, nat.ny, nat.cell, scale), nat.nx, nat.ny, THREE.RGFormat, THREE.UnsignedByteType, { mip: true, aniso: 8 })
    : dataTex(new Uint8Array([128, 128]), 1, 1, THREE.RGFormat, THREE.UnsignedByteType, { linear: true });
  const waterTex = has.water
    ? dataTex(nat.water, nat.nx, nat.ny, THREE.RGFormat, THREE.UnsignedByteType, { mip: true, aniso: 8 })
    : dataTex(new Uint8Array([0, 255]), 1, 1, THREE.RGFormat, THREE.UnsignedByteType, { linear: true });
  const coverTex = has.cover
    ? dataTex(nat.cover, nat.nx, nat.ny, THREE.RGBAFormat, THREE.UnsignedByteType, { mip: true, aniso: 8 })
    : dataTex(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType, { linear: true });

  // 30 m height patches: one R16I atlas plus a normal atlas.
  const patches = (L.patches || []).slice(0, MAX_PATCHES);
  const pl = atlasLayout(patches);
  const pH = new Int16Array(pl.w * pl.h), pN = new Uint8Array(pl.w * pl.h * 2).fill(128);
  const patchRect = [], patchDim = [];
  patches.forEach((p, k) => {
    for (let j = 0; j < p.ny; j++) pH.set(p.height.subarray(j * p.nx, (j + 1) * p.nx), (pl.offs[k] + j) * pl.w);
    const n = normalsRG(p.height, p.nx, p.ny, p.cell, scale);
    for (let j = 0; j < p.ny; j++) pN.set(n.subarray(j * p.nx * 2, (j + 1) * p.nx * 2), (pl.offs[k] + j) * pl.w * 2);
    patchRect.push(new THREE.Vector4(p.x0, p.y0, p.cell, pl.offs[k]));
    patchDim.push(new THREE.Vector4(p.nx, p.ny, pl.w, pl.h));
  });
  while (patchRect.length < MAX_PATCHES) { patchRect.push(new THREE.Vector4(1e9, 1e9, 1, 0)); patchDim.push(new THREE.Vector4(1, 1, 1, 1)); }
  const patchHTex = dataTex(pH, pl.w, pl.h, THREE.RedIntegerFormat, THREE.ShortType, { internal: 'R16I' });
  const patchNTex = dataTex(pN, pl.w, pl.h, THREE.RGFormat, THREE.UnsignedByteType, { linear: true });

  // 10 m coast patches: one R8 atlas.
  const coast = (L.coastPatches || []).slice(0, MAX_PATCHES);
  const cl = atlasLayout(coast);
  const cA = new Uint8Array(cl.w * cl.h).fill(255);
  const coastRect = [], coastDim = [];
  coast.forEach((p, k) => {
    for (let j = 0; j < p.ny; j++) cA.set(p.coast.subarray(j * p.nx, (j + 1) * p.nx), (cl.offs[k] + j) * cl.w);
    coastRect.push(new THREE.Vector4(p.x0, p.y0, p.cell, cl.offs[k]));
    coastDim.push(new THREE.Vector4(p.nx, p.ny, cl.w, cl.h));
  });
  while (coastRect.length < MAX_PATCHES) { coastRect.push(new THREE.Vector4(1e9, 1e9, 1, 0)); coastDim.push(new THREE.Vector4(1, 1, 1, 1)); }
  const coastTex = dataTex(cA, cl.w, cl.h, THREE.RedFormat, THREE.UnsignedByteType, { linear: true });

  // Runway flattening rects (the same list heightAt uses).
  const rects = (hf.runwayRects || []).slice(0, MAX_RUNWAYS);
  // (In rank order, as heightAt runs them.) rwyC: a runway's two bends where it meets a longer one.
  const rwyA = [], rwyB = [], rwyC = [];
  for (const r of rects) {
    rwyA.push(new THREE.Vector4(r.cx, r.cy, r.dx, r.dy));
    rwyB.push(new THREE.Vector4(r.halfLen, r.halfWid, r.e0, r.e1));
    const k = r.knots || [], k1 = k[k.length > 1 ? 1 : 0];
    rwyC.push(k.length ? new THREE.Vector4(k[0][0], k[0][1], k1[0], k1[1]) : new THREE.Vector4(1e9, 0, 1e9, 0));
  }
  while (rwyA.length < MAX_RUNWAYS) { rwyA.push(new THREE.Vector4(1e9, 1e9, 1, 0)); rwyB.push(new THREE.Vector4(0, 0, 0, 0)); rwyC.push(new THREE.Vector4(1e9, 0, 1e9, 0)); }

  return {
    // data
    uHeight: { value: heightTex },
    uNormal: { value: normalTex },
    uWater: { value: waterTex },
    uCover: { value: coverTex },
    uNat: { value: new THREE.Vector4(nat.x0, nat.y0, nat.cell, 0) },
    uNatSize: { value: new THREE.Vector2(has.height ? nat.nx : 1, has.height ? nat.ny : 1) },
    uNatSizeM: { value: new THREE.Vector2(nat.nx * nat.cell, nat.ny * nat.cell) },
    uHasHeight: { value: has.height ? 1 : 0 },
    uHasWater: { value: has.water ? 1 : 0 },
    uHasCover: { value: has.cover ? 1 : 0 },
    uPatchH: { value: patchHTex },
    uPatchN: { value: patchNTex },
    uPatchRect: { value: patchRect },
    uPatchDim: { value: patchDim },
    uPatchCount: { value: patches.length },
    uCoast: { value: coastTex },
    uCoastRect: { value: coastRect },
    uCoastDim: { value: coastDim },
    uCoastCount: { value: coast.length },
    uRwyA: { value: rwyA },
    uRwyB: { value: rwyB },
    uRwyC: { value: rwyC },
    uRwyCount: { value: rects.length },
    // per frame
    uOrigin: { value: new THREE.Vector2() },   // map x, y of the scene origin
    uCamPos: { value: new THREE.Vector3() },   // camera, scene frame
    uCamAlt: { value: 0 },                     // camera altitude MSL (m)
    uCamAgl: { value: 0 },
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uSkyAmb: { value: new THREE.Color(0.3, 0.4, 0.5) },
    uPxScale: { value: 1000 },                 // pixels per radian (viewport height / fov)
  };
}

// ------------------------------------------------------------------ GLSL

// Uniform declarations shared by every world shader.
export const UNIFORMS_GLSL = /* glsl */ `
uniform highp isampler2D uHeight;
uniform sampler2D uNormal, uWater, uCover, uPatchN, uCoast;
uniform highp isampler2D uPatchH;
uniform vec4 uNat;
uniform vec2 uNatSize, uNatSizeM;
uniform float uHasHeight, uHasWater, uHasCover;
uniform vec4 uPatchRect[${MAX_PATCHES}], uPatchDim[${MAX_PATCHES}];
uniform int uPatchCount;
uniform vec4 uCoastRect[${MAX_PATCHES}], uCoastDim[${MAX_PATCHES}];
uniform int uCoastCount;
uniform vec4 uRwyA[${MAX_RUNWAYS}], uRwyB[${MAX_RUNWAYS}], uRwyC[${MAX_RUNWAYS}];
uniform int uRwyCount;
uniform vec2 uOrigin;
uniform vec3 uCamPos;
uniform float uCamAlt, uCamAgl, uTime, uPxScale;
uniform vec3 uSunDir, uSunColor, uSkyAmb;
`;

// Hashes and value noise (deterministic: the same everywhere, every run).
export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
// Integer-lattice hashes: exact for cells far from the map origin.
float ihash(ivec2 c) {
  uint h = uint(c.x) * 374761393u + uint(c.y) * 668265263u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= h >> 16u;
  return float(h & 0xffffffu) / 16777216.0;
}
float ihash(ivec2 c, uint s) {
  uint h = uint(c.x) * 374761393u + uint(c.y) * 668265263u + s * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= h >> 16u;
  return float(h & 0xffffffu) / 16777216.0;
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm3(vec2 p) {
  return 0.5 * vnoise(p) + 0.3 * vnoise(p * 2.03 + 17.1) + 0.2 * vnoise(p * 4.11 + 41.7);
}
`;

// Heights, exactly as heightfield.js computes them (bilinear, patches, runway flattening).
export const HEIGHT_GLSL = /* glsl */ `
const float H_SCALE = 0.25;
const float EARTH_R = ${f(EARTH_RADIUS)};

float bilinI(highp isampler2D t, vec2 fxy, vec2 lo, vec2 hi) {
  fxy = clamp(fxy, lo, hi);
  vec2 i = min(floor(fxy), hi - 1.0);
  i = max(i, lo);
  vec2 tt = fxy - i;
  ivec2 p = ivec2(i);
  float a = float(texelFetch(t, p, 0).r), b = float(texelFetch(t, p + ivec2(1, 0), 0).r);
  float c = float(texelFetch(t, p + ivec2(0, 1), 0).r), d = float(texelFetch(t, p + ivec2(1, 1), 0).r);
  float ab = a + (b - a) * tt.x;
  return ab + ((c + (d - c) * tt.x) - ab) * tt.y;
}

float patchWeight(vec4 r, vec4 dim, vec2 m) {
  vec2 lo = m - r.xy, hi = r.xy + dim.xy * r.z - m;
  float e = min(min(lo.x, hi.x), min(lo.y, hi.y)) - r.z;
  return smoothstep(0.0, ${f(PATCH_BLEND)}, e);
}

// Raw data height (m, may be negative over the sea) and the patch weight it used.
float rawHeight(vec2 m, out float pw) {
  float h = 0.0;
  pw = 0.0;
  if (uHasHeight > 0.5) {
    vec2 fxy = (m - uNat.xy) / uNat.z - 0.5;
    h = bilinI(uHeight, fxy, vec2(0.0), uNatSize - 1.0) * H_SCALE;
  } else {
    h = -20.0;
  }
  for (int k = 0; k < ${MAX_PATCHES}; k++) {
    if (k >= uPatchCount) break;
    vec4 r = uPatchRect[k], dim = uPatchDim[k];
    float w = patchWeight(r, dim, m);
    if (w <= 0.0) continue;
    vec2 fxy = (m - r.xy) / r.z - 0.5;
    fxy.y += r.w;
    float hp = bilinI(uPatchH, fxy, vec2(0.0, r.w), vec2(dim.x - 1.0, r.w + dim.y - 1.0)) * H_SCALE;
    h += (hp - h) * w;
    pw = max(pw, w);
  }
  return h;
}

// A runway's surface height at u metres along from its centre: straight between its ends, or
// through two bends (kn: u, h, u, h; u >= 1e8 when it has none) where it meets a longer runway.
float rwyElev(float u, vec4 b, vec4 kn) {
  if (kn.x > 1e8) return mix(b.z, b.w, clamp((u + b.x) / (2.0 * b.x), 0.0, 1.0));
  if (u < kn.x) return mix(b.z, kn.y, clamp((u + b.x) / max(kn.x + b.x, 1e-3), 0.0, 1.0));
  if (u < kn.z) return mix(kn.y, kn.w, (u - kn.x) / max(kn.z - kn.x, 1e-3));
  return mix(kn.w, b.w, clamp((u - kn.z) / max(b.x - kn.z, 1e-3), 0.0, 1.0));
}

// Runway flattening, as heightAt in heightfield.js: on a runway's pavement the ground is that
// runway's surface (the longer one's where two cross: the uniforms run by rank); off the
// pavements the nearby runways' surfaces blend by distance. zone: how much of the point is in
// a runway's flat zone (0..1).
float flattenRunways(vec2 m, float h, out float zone) {
  zone = 0.0;
  float num = 0.0, den = 0.0, pav = 0.0, onPav = 0.0;
  for (int k = 0; k < ${MAX_RUNWAYS}; k++) {
    if (k >= uRwyCount) break;
    vec4 a = uRwyA[k], b = uRwyB[k];
    vec2 d = m - a.xy;
    float u = dot(d, a.zw), v = -d.x * a.w + d.y * a.z;
    float du = abs(u) - (b.x + ${f(FLAT_MARGIN_U)}), dv = abs(v) - (b.y + ${f(FLAT_MARGIN_V)});
    float w = 1.0 - smoothstep(0.0, ${f(FLAT_BLEND)}, max(du, dv));
    // smoothstep(0,B,x) on CPU is 1-t*t*(3-2t) with t=1-x/B; the same curve.
    if (w <= 0.0) continue;
    float e = rwyElev(u, b, uRwyC[k]);
    float c = length(max(vec2(abs(u) - b.x, abs(v) - b.y - ${f(RUNWAY_SHOULDER_M)}), 0.0));
    if (c <= 0.0) { onPav = 1.0; pav = e; }
    float kk = w * exp(-c / ${f(PAVE_BLEND_M)});
    num += kk * e; den += kk;
    zone = max(zone, w);
  }
  if (den > 0.0) h += ((onPav > 0.5 ? pav : num / den) - h) * zone;
  return h;
}

float terrainHeight(vec2 m) {
  float pw, zone;
  float h = flattenRunways(m, rawHeight(m, pw), zone);
  return max(h, 0.0);
}

vec2 natUv(vec2 m) { return (m - uNat.xy) / uNatSizeM; }

// Signed distance to the sea coast (m, + on land): 10 m patches near the airports win.
// The field must stay continuous: the shaders antialias the coast and the beach with
// fwidth(), so any jump (the patch's edge, or where its 8-bit range saturates at ±254 m)
// would draw a thin dashed line. So the patch fades into the national field over its
// outer 300 m, and where it saturates it hands over smoothly (keeping its own sign).
// The national water distances (R: sea, G: inland, m), sampled with Catmull-Rom (9 bilinear
// taps) instead of plain bilinear, so the shorelines and river banks drawn from the 250 m
// grid curve smoothly instead of running in straight, kinked segments. Catmull-Rom passes
// through the data values, so one-cell lakes keep their size.
vec2 waterField(vec2 m) {
  vec2 sz = uNatSize;
  vec2 sp = natUv(m) * sz;
  vec2 p1 = floor(sp - 0.5) + 0.5, f = sp - p1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (p1 - 1.0) / sz, t3 = (p1 + 2.0) / sz, t12 = (p1 + w2 / w12) / sz;
  vec2 v = (texture(uWater, vec2(t0.x, t0.y)).rg * w0.x + texture(uWater, vec2(t12.x, t0.y)).rg * w12.x + texture(uWater, vec2(t3.x, t0.y)).rg * w3.x) * w0.y
         + (texture(uWater, vec2(t0.x, t12.y)).rg * w0.x + texture(uWater, vec2(t12.x, t12.y)).rg * w12.x + texture(uWater, vec2(t3.x, t12.y)).rg * w3.x) * w12.y
         + (texture(uWater, vec2(t0.x, t3.y)).rg * w0.x + texture(uWater, vec2(t12.x, t3.y)).rg * w12.x + texture(uWater, vec2(t3.x, t3.y)).rg * w3.x) * w3.y;
  return (v * 255.0 - 128.0) * 20.0;
}

float seaDistance(vec2 m, float rawH) {
  float dn = uHasWater > 0.5 ? waterField(m).r : rawH * 20.0;
  for (int k = 0; k < ${MAX_PATCHES}; k++) {
    if (k >= uCoastCount) break;
    vec4 r = uCoastRect[k], dim = uCoastDim[k];
    vec2 fxy = (m - r.xy) / r.z;
    float e = min(min(fxy.x, fxy.y), min(dim.x - fxy.x, dim.y - fxy.y)) - 1.0;   // cells to the edge
    if (e <= 0.0) continue;
    vec2 uv = vec2(fxy.x, fxy.y + r.w) / dim.zw;
    float dp = (texture(uCoast, uv).r * 255.0 - 128.0) * 2.0;
    float sg = dp < 0.0 ? -1.0 : 1.0;
    float far = sg * max(abs(dp), sg * dn);          // the national value, on the patch's side
    float d = mix(dp, far, smoothstep(190.0, 250.0, abs(dp)));
    return mix(dn, d, smoothstep(0.0, 30.0, e));
  }
  return dn;
}
float inlandDistance(vec2 m) {
  if (uHasWater < 0.5) return 2560.0;
  return waterField(m).g;
}

// Earth's curvature: how far a point at horizontal offset rel (from the camera) drops.
float curveDrop(vec2 rel) { return dot(rel, rel) / (2.0 * EARTH_R); }

// Map position of a scene position.
vec2 sceneToMap(vec3 p) { return uOrigin + vec2(p.x, -p.z); }
`;
