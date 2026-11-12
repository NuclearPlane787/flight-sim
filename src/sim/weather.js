// The weather the sim flies in (v0.4.0): the settings, as a plain JSON-safe object, and the wind field.
// No DOM and no three.js: it runs in the page, in node and in the prediction worker.
//
// Everything here is a function of position and time, with no state and no Math.random(): the live sim
// steps at 1/120 s and the prediction at 1/30 s, and a jump restores a snapshot, so both have to read the
// same air. A snapshot only needs the settings (with their seed).
//
// Frames: the wind is the velocity of the air, in NED (n, e, d: d is down), m/s. Directions on the panel
// are degrees magnetic, "from", as the tower gives them; they're converted once, at the settings' reference
// point (refX, refY: the arrival airport), so the wind is one vector everywhere.

import { magToGrid } from '../world/frame.js';

const KT = 0.514444, FT = 0.3048, DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

export const TURBULENCE_LEVELS = ['none', 'light', 'moderate', 'severe'];
export const RUNWAY_STATES = ['auto', 'dry', 'wet', 'snow', 'ice'];
export const ISA_TEMP_C = 15, STD_QNH = 1013.25;

// The default weather: v0.3.2's world exactly.
export function calmWeather() {
  return {
    seed: 1, preset: 'clear', refX: 0, refY: 0,
    wind: { fromDeg: 0, kt: 0, gustKt: 0 },   // the surface wind, at 10 m; gustKt is the peak ("G"), 0 for none
    aloft: { fromDeg: 0, kt: 0 },             // the wind above the boundary layer
    turbulence: 'none',
    shear: null,                              // { ftAgl, fromDeg, kt }: added above a thin layer at ftAgl
    microbursts: [],                          // [{ x, y, radiusM, dvKt }]: dvKt is the headwind-to-tailwind change
    visM: 150000, fogTopFt: 0,
    clouds: [],                               // up to three: [{ okta, baseFt, topFt }]
    precip: { kind: 'none', rate: 0 },        // 'rain' | 'snow', rate 0..1
    lightning: 0,                             // 0..1
    runway: 'auto',
    tempC: ISA_TEMP_C, qnh: STD_QNH,
  };
}

const num = (v, d) => (Number.isFinite(v) ? v : d);

// A full, clean copy of any settings object (a partial one, or a save's). Never shares objects with its input.
export function normalizeWeather(s) {
  const d = calmWeather();
  if (!s) return d;
  const dir = (a) => ((num(a, 0) % 360) + 360) % 360;
  const speed = (v) => Math.max(0, num(v, 0));
  const w = s.wind || d.wind, a = s.aloft || w;
  return {
    seed: num(s.seed, d.seed) | 0, preset: typeof s.preset === 'string' ? s.preset : d.preset,
    refX: num(s.refX, 0), refY: num(s.refY, 0),
    wind: { fromDeg: dir(w.fromDeg), kt: speed(w.kt), gustKt: speed(w.gustKt) },
    aloft: { fromDeg: dir(a.fromDeg), kt: speed(a.kt) },
    turbulence: TURBULENCE_LEVELS.includes(s.turbulence) ? s.turbulence : 'none',
    shear: s.shear && s.shear.kt > 0 ? { ftAgl: Math.max(50, num(s.shear.ftAgl, 500)), fromDeg: dir(s.shear.fromDeg), kt: speed(s.shear.kt) } : null,
    microbursts: (Array.isArray(s.microbursts) ? s.microbursts : []).filter((m) => m && m.dvKt > 0).slice(0, 24).map((m) => ({
      x: num(m.x, 0), y: num(m.y, 0), radiusM: clamp(num(m.radiusM, 1000), 300, 3000), dvKt: speed(m.dvKt),
    })),
    visM: clamp(num(s.visM, d.visM), 30, 150000), fogTopFt: Math.max(0, num(s.fogTopFt, 0)),
    clouds: (Array.isArray(s.clouds) ? s.clouds : []).slice(0, 3).map((c) => ({
      okta: clamp(num(c.okta, 0) | 0, 0, 8), baseFt: Math.max(0, num(c.baseFt, 3000)), topFt: Math.max(0, num(c.topFt, num(c.baseFt, 3000) + 1000)),
    })),
    precip: { kind: s.precip && ['rain', 'snow'].includes(s.precip.kind) ? s.precip.kind : 'none', rate: clamp(num(s.precip && s.precip.rate, 0), 0, 1) },
    lightning: clamp(num(s.lightning, 0), 0, 1),
    runway: RUNWAY_STATES.includes(s.runway) ? s.runway : 'auto',
    tempC: clamp(num(s.tempC, ISA_TEMP_C), -60, 60), qnh: clamp(num(s.qnh, STD_QNH), 900, 1100),
  };
}

// The runway's state: as set on the panel, or from the precipitation and the temperature. 'dry' | 'wet' | 'snow' | 'ice'.
export function runwayStateOf(s) {
  if (!s) return 'dry';
  if (s.runway && s.runway !== 'auto') return s.runway;
  const rate = s.precip ? s.precip.rate : 0, kind = s.precip ? s.precip.kind : 'none';
  if (kind === 'none' || !(rate > 0)) return 'dry';
  const freezing = s.tempC <= 0;
  if (kind === 'snow') return freezing ? 'snow' : 'wet';
  return freezing ? 'ice' : 'wet';   // rain below freezing ices it
}

// What the runway's state does to the tyres, as factors on the dry numbers (null: dry, so nothing changes). The braking
// coefficients against a dry runway's 0.50: wet about 0.30 (a mid-speed value of §25.109(c)'s speed-dependent curve, AC 25-32's
// code 5), compacted or loose snow 0.20 (the CS-25 ceiling for those surfaces), ice 0.08 (poor; AC 25-32's table not seen
// beyond its 0.16 for a slippery wet runway, so EST). Side grip follows, less harshly. Snow also adds drag on the wheels.
export const RUNWAY_TYRES = {
  wet:  { brake: 0.60, side: 0.75, rollAdd: 0.0 },
  snow: { brake: 0.40, side: 0.45, rollAdd: 0.015 },
  ice:  { brake: 0.16, side: 0.18, rollAdd: 0.0 },
};
// v0.4.2: hydroplaning. Heavy rain on a wet runway leaves standing water (hydro 0..1, from the rain's rate: none
// under 0.55, all of it from 0.9, so a severe storm's and heavy rain's); a wet runway set by hand, or one wet from light
// rain, has none. gear.js takes the tyres' grip away above the type's hydroplaning speed (9 √p kt, NASA's).
export function runwayTyresOf(s) {
  const t = RUNWAY_TYRES[runwayStateOf(s)] || null;
  if (!t || runwayStateOf(s) !== 'wet' || !s.precip || s.precip.kind !== 'rain') return t;
  const x = Math.min(1, Math.max(0, (s.precip.rate - 0.55) / 0.35)), hydro = x * x * (3 - 2 * x);
  return hydro > 0 ? { ...t, hydro } : t;
}

// Nothing to fly in and nothing to draw: the sim then skips the weather altogether.
export function isDefaultWeather(s) {
  return JSON.stringify(normalizeWeather(s)) === JSON.stringify(calmWeather());
}

// ---- the boundary layer ----
const PROFILE_ALPHA = 0.16;     // the power law's exponent (between open water's 0.11 and rough land's 0.25)
const PROFILE_TOP_M = 900;      // the wind aloft is reached here (about 3,000 ft)

// ---- gusts ----
const GUST_S = 10;              // s: how long a gust takes to grow and die
const GUST_SCALE_M = 500;       // m: a gust patch's size
const GUST_MIN_ADV = 3;         // m/s, so that gusts still pass in a near-calm

function hash01(seed, i, j) {
  // A small integer mix (Murmur3's finaliser): the same on every engine, unlike float noise.
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function noise2(seed, x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10), sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash01(seed, i, j), b = hash01(seed, i + 1, j), c = hash01(seed, i, j + 1), d = hash01(seed, i + 1, j + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// 0..1: how much of the gust is here. Zero most of the time (the lulls), with smooth peaks that reach 1.
// A gust is a patch of a few hundred metres, carried with the wind, that grows and dies over some seconds: a
// fixed point sees one every 20 to 40 s and an airliner goes through one in a few seconds. (Tying the patch's
// length to the wind speed would make it 70 m long in 15 kt, and an airliner would feel noise.)
function gustNoise(seed, X, Y, T) {
  const i = Math.floor(T), f = T - i, s = f * f * f * (f * (f * 6 - 15) + 10);
  const a = noise2(Math.imul(seed ^ i, 0x9e3779b1), X, Y), b = noise2(Math.imul(seed ^ (i + 1), 0x9e3779b1), X, Y);
  return a + (b - a) * s;
}

export function gustField(C, x, y, t) {
  const along = y * C.gustN + x * C.gustE - C.advSpeed * t;
  const across = -y * C.gustE + x * C.gustN;
  const X = along / GUST_SCALE_M, Y = across / GUST_SCALE_M, T = t / GUST_S;
  const n = (gustNoise(C.seed, X, Y, T) + 0.35 * gustNoise(C.seed ^ 0x51ed, 2.3 * X, 2.3 * Y, 1.7 * T)) / 1.35;
  return smooth((n - 0.45) / 0.2);
}

// ---- turbulence: a frozen field, carried with the surface wind (Taylor's hypothesis) ----
// A sum of sine waves with fixed wavevectors; only the amplitudes change with height, so flying through a
// height never shifts a phase. The directions are isotropic in the horizontal, so the correlation along
// any level track is the sum of J0(k·r), and these amplitudes make that the Dryden form:
//   longitudinal R(r) = σ² e^(−r/L)                 → cumulative variance F(s) = 1 − 1/√(1+s²),            s = kL
//   transverse   R(r) = σ² (1 − r/2L) e^(−r/L)      → G(s) = 1 − (3/2)(1+s²)^(−1/2) + (1/2)(1+s²)^(−3/2)
// (the Hankel transforms of the two correlations). East and north use the first and the vertical the second.
const N_MODES = 20;
const K_MIN = 2 * Math.PI / 40000, K_MAX = 2 * Math.PI / 60;
const K_EDGES = new Float64Array(N_MODES + 1);
for (let i = 0; i <= N_MODES; i++) K_EDGES[i] = K_MIN * Math.pow(K_MAX / K_MIN, i / N_MODES);
const fLong = (s) => 1 - 1 / Math.sqrt(1 + s * s);
const fTrans = (s) => { const r = 1 / Math.sqrt(1 + s * s); return 1 - 1.5 * r + 0.5 * r * r * r; };

// MIL-F-8785C, figure 7 (the high-altitude exceedance curves): σ (ft/s) by altitude (ft).
const POE_ALT = [500, 1750, 3750, 7500, 15000, 25000, 35000, 45000, 55000, 65000, 75000, 80000];
const POE_SIGMA = {
  light:    [6.6, 6.9, 7.4, 6.7, 4.6, 2.7, 0.4, 0, 0, 0, 0, 0],                       // 10⁻²
  moderate: [8.6, 9.6, 10.6, 10.1, 8.0, 6.6, 5.0, 4.2, 2.7, 0, 0, 0],                 // 10⁻³
  severe:   [15.6, 17.6, 23.0, 23.6, 22.1, 20.0, 16.0, 15.1, 12.1, 7.9, 6.2, 5.1],    // 10⁻⁵
};
const W20_KT = { light: 15, moderate: 30, severe: 45 };
// v0.4.1: near the ground the turbulence comes from the wind, as the standard's low-altitude model has it (σw = 0.1·W20,
// W20 the wind at 20 ft): the level scales the wind actually blowing (K_W20), with half the level's own W20 as a floor
// (convection, a storm's). Before, the level's W20 alone set it: moderate turbulence in a 15 kt wind blew as if it were
// 30 kt, and the crosswind swung through ±30° every few seconds.
const K_W20 = { light: 0.7, moderate: 1.0, severe: 1.4 };
const W20_FROM_10M = Math.pow(20 * 0.3048 / 10, 0.16);   // the power law below, from 10 m down to 20 ft

function highSigmaFt(table, ft) {
  if (ft <= POE_ALT[0]) return table[0];
  for (let i = 1; i < POE_ALT.length; i++) {
    if (ft <= POE_ALT[i]) return table[i - 1] + (table[i] - table[i - 1]) * (ft - POE_ALT[i - 1]) / (POE_ALT[i] - POE_ALT[i - 1]);
  }
  return table[table.length - 1];
}

// σ (m/s) and L (m) at height hFt above the ground: { su, sw, Lu, Lw }. w20: the mean wind at 20 ft (m/s), for the low
// altitudes' σ; without it (null) the level's W20 alone, the standard's light, moderate and severe.
export function turbulenceScales(level, hFt, out = {}, w20 = null) {
  const table = POE_SIGMA[level];
  if (!table) { out.su = out.sw = 0; out.Lu = out.Lw = 1; return out; }
  const W20 = w20 === null ? W20_KT[level] * KT : Math.max(0.5 * W20_KT[level] * KT, K_W20[level] * w20);
  const low = (ft) => {
    const h = Math.max(ft, 10), f = 0.177 + 0.000823 * h;
    const sw = 0.1 * W20;
    return { su: sw / Math.pow(f, 0.4), sw, Lu: h / Math.pow(f, 1.2) * FT, Lw: h * FT };
  };
  if (hFt <= 1000) { const a = low(hFt); out.su = a.su; out.sw = a.sw; out.Lu = a.Lu; out.Lw = a.Lw; return out; }
  const hs = highSigmaFt(table, Math.max(hFt, 2000)) * FT, hL = 1750 * FT;
  if (hFt >= 2000) { out.su = out.sw = hs; out.Lu = out.Lw = hL; return out; }
  const a = low(1000), k = (hFt - 1000) / 1000;
  out.su = a.su + (hs - a.su) * k; out.sw = a.sw + (hs - a.sw) * k;
  out.Lu = a.Lu + (hL - a.Lu) * k; out.Lw = a.Lw + (hL - a.Lw) * k;
  return out;
}

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- microbursts: Oseguera and Bowles's axisymmetric downburst (NASA TM-100632) ----
export const MB_ZSTAR = 250, MB_EPS = 30;   // m: the height of the outflow's decay and of the boundary layer
const MB_ZPEAK = Math.log(MB_ZSTAR / MB_EPS) * (MB_ZSTAR * MB_EPS) / (MB_ZSTAR - MB_EPS);
const MB_ZSHAPE = Math.exp(-MB_ZPEAK / MB_ZSTAR) - Math.exp(-MB_ZPEAK / MB_EPS);
const MB_RSHAPE = 0.63817;                  // the peak of (1 − e^(−x²)) / x, at x = 1.1209
const MB_FADE_LO = 1500, MB_FADE_HI = 3000; // m: the model holds its downdraft forever; a real shaft ends

// Fills `out` { n, e, d } with one microburst's wind at the offset (dx east, dy north) and height z above
// the ground. lambda scales it so that the outflow's peak each way is dv / 2.
export function microburstInto(dx, dy, z, R, lambda, out) {
  out.n = out.e = out.d = 0;
  const r2 = dx * dx + dy * dy, s = r2 / (R * R);
  if (s > 36) return out;
  const zc = Math.max(z, 0);
  const fade = 1 - smooth((zc - MB_FADE_LO) / (MB_FADE_HI - MB_FADE_LO));
  if (fade <= 0) return out;
  const eS = Math.exp(-zc / MB_ZSTAR), eE = Math.exp(-zc / MB_EPS);
  // u_r / r, finite at the centre: λR²/(2r²) · (1 − e^(−s)) · (e^(−z/z*) − e^(−z/ε)).
  const k = s > 1e-9 ? -Math.expm1(-s) / s : 1;
  // The outflow falls only as 1/r, so it's tapered to nothing from 4R to 6R, not cut off.
  const edge = 1 - smooth((s - 16) / 20);
  const ur = 0.5 * lambda * k * (eS - eE) * fade * edge;
  out.e = ur * dx; out.n = ur * dy;
  // w up = −λ e^(−s) [ε(e^(−z/ε) − 1) − z*(e^(−z/z*) − 1)]; d is down, so the sign flips.
  out.d = lambda * Math.exp(-s) * (MB_EPS * (eE - 1) - MB_ZSTAR * (eS - 1)) * fade * edge;
  return out;
}
export const microburstLambda = (dvMs, R) => dvMs / (MB_RSHAPE * R * MB_ZSHAPE);

// ---- compiled settings: what the sim reads every step ----
export function compileWeather(settings) {
  const s = normalizeWeather(settings);
  const vec = (fromDeg, kt) => {
    const a = magToGrid(fromDeg * DEG, s.refX, s.refY), v = kt * KT;
    return { n: -v * Math.cos(a), e: -v * Math.sin(a) };   // "from" → the way the air is going
  };
  const sf = vec(s.wind.fromDeg, s.wind.kt), al = vec(s.aloft.fromDeg, s.aloft.kt);
  const sp = Math.hypot(sf.n, sf.e);
  const gustN = sp > 0 ? sf.n / sp : 1, gustE = sp > 0 ? sf.e / sp : 0;
  const adv = Math.max(sp, GUST_MIN_ADV);
  const C = {
    settings: s, seed: s.seed | 0,
    sfN: sf.n, sfE: sf.e, alN: al.n, alE: al.e,
    bDen: Math.pow(PROFILE_TOP_M / 10, PROFILE_ALPHA) - 1,
    gustAmp: Math.max(0, s.wind.gustKt - s.wind.kt) * KT, gustN, gustE,
    advSpeed: adv, advN: gustN * adv, advE: gustE * adv,
    shear: null, level: s.turbulence, modes: null, bursts: null, w20: sp * W20_FROM_10M,
    dT: s.tempC - ISA_TEMP_C, qnhPa: s.qnh * 100,
    windOn: false, atmOn: s.tempC !== ISA_TEMP_C || s.qnh !== STD_QNH,
    tyres: runwayTyresOf(s),
  };
  if (s.shear) {
    const d = vec(s.shear.fromDeg, s.shear.kt);
    C.shear = { z: s.shear.ftAgl * FT, n: d.n, e: d.e };
  }
  C.bursts = s.microbursts.map((m) => ({ x: m.x, y: m.y, R: m.radiusM, lambda: microburstLambda(m.dvKt * KT, m.radiusM) }));
  if (s.turbulence !== 'none') {
    const rnd = mulberry32(C.seed ^ 0x7e57);
    const make = () => {
      const m = { kn: new Float64Array(N_MODES), ke: new Float64Array(N_MODES), kz: new Float64Array(N_MODES), ph: new Float64Array(N_MODES) };
      const a0 = rnd() * 2 * Math.PI;
      for (let i = 0; i < N_MODES; i++) {
        const k = Math.sqrt(K_EDGES[i] * K_EDGES[i + 1]);
        // Stratified: the golden angle spreads the directions evenly, with a little seeded jitter.
        const th = a0 + i * 2.39996323 + (rnd() - 0.5) * 0.6;
        m.kn[i] = k * Math.cos(th); m.ke[i] = k * Math.sin(th);
        m.kz[i] = k * 0.5 * (rnd() * 2 - 1);
        m.ph[i] = rnd() * 2 * Math.PI;
      }
      return m;
    };
    C.modes = { e: make(), n: make(), d: make() };
  }
  C.windOn = sp > 0 || al.n !== 0 || al.e !== 0 || C.gustAmp > 0 || !!C.shear || C.bursts.length > 0 || !!C.modes;
  return C;
}

const scales = { su: 0, sw: 0, Lu: 1, Lw: 1 };
const burst = { n: 0, e: 0, d: 0 };

function sumModes(m, weights, x, y, z, t, adN, adE) {
  let sum = 0;
  for (let i = 0; i < N_MODES; i++) {
    sum += weights[i] * Math.sin(m.kn[i] * (y - adN * t) + m.ke[i] * (x - adE * t) + m.kz[i] * z + m.ph[i]);
  }
  return sum;
}

const wLong = new Float64Array(N_MODES), wTrans = new Float64Array(N_MODES);

function fillWeights(weights, f, sigma, L) {
  const a0 = f(K_EDGES[0] * L), span = f(K_EDGES[N_MODES] * L) - a0;
  const scale = span > 1e-9 ? 2 * sigma * sigma / span : 0;
  let prev = a0;
  for (let i = 0; i < N_MODES; i++) {
    const next = f(K_EDGES[i + 1] * L);
    weights[i] = Math.sqrt(Math.max(0, (next - prev) * scale));
    prev = next;
  }
}

// Fills W with the air's velocity at map point (x, y), height z (metres above sea level), agl above the
// ground, at sim time t: n, e, d (the whole wind), meanN, meanE (without gusts, turbulence and bursts),
// and p, the roll-rate gust (rad/s) across a span `span` whose right wing points along (rn, re).
export function windAt(C, x, y, z, agl, t, rn, re, span, W) {
  const h = agl > 0 ? agl : 0;
  let n, e;
  if (h >= PROFILE_TOP_M) { n = C.alN; e = C.alE; }
  else if (h <= 10) {
    const f = Math.pow(Math.max(h, 1) / 10, PROFILE_ALPHA);
    n = C.sfN * f; e = C.sfE * f;
  } else {
    const b = (Math.pow(h / 10, PROFILE_ALPHA) - 1) / C.bDen;
    n = C.sfN + (C.alN - C.sfN) * b; e = C.sfE + (C.alE - C.sfE) * b;
  }
  if (C.shear) {
    const sh = C.shear;
    const on = smooth((h - sh.z + 30) / 60) * (1 - smooth((h - sh.z - 300) / 600));
    n += sh.n * on; e += sh.e * on;
  }
  W.meanN = n; W.meanE = e;
  let d = 0, p = 0;
  if (C.gustAmp > 0) {
    const g = gustField(C, x, y, t) * C.gustAmp * (h < 10 ? Math.pow(Math.max(h, 1) / 10, PROFILE_ALPHA) : 1) * (1 - smooth((h - 600) / 900));
    n += C.gustN * g; e += C.gustE * g;
  }
  for (let i = 0; i < C.bursts.length; i++) {
    const b = C.bursts[i];
    microburstInto(x - b.x, y - b.y, h, b.R, b.lambda, burst);
    n += burst.n; e += burst.e; d += burst.d;
  }
  // Everything but the turbulence: what the speed trend reads.
  W.sn = n; W.se = e; W.sd = d;
  if (C.modes) {
    turbulenceScales(C.level, h / FT, scales, C.w20);
    if (scales.su > 0 || scales.sw > 0) {
      fillWeights(wLong, fLong, scales.su, scales.Lu);
      fillWeights(wTrans, fTrans, scales.sw, scales.Lw);
      const M = C.modes;
      e += sumModes(M.e, wLong, x, y, z, t, C.advN, C.advE);
      n += sumModes(M.n, wLong, x, y, z, t, C.advN, C.advE);
      d += sumModes(M.d, wTrans, x, y, z, t, C.advN, C.advE);
      // The roll gust: the vertical gust's difference across the span, in closed form for each wave.
      if (span > 0) {
        const m = M.d;
        for (let i = 0; i < N_MODES; i++) {
          const kr = m.kn[i] * rn + m.ke[i] * re;
          const ph = m.kn[i] * (y - C.advN * t) + m.ke[i] * (x - C.advE * t) + m.kz[i] * z + m.ph[i];
          p += wTrans[i] * Math.cos(ph) * 2 * Math.sin(kr * span / 2) / span;
        }
      }
    }
  }
  W.n = n; W.e = e; W.d = d; W.p = p;
  return W;
}

export const newWind = () => ({ n: 0, e: 0, d: 0, p: 0, meanN: 0, meanE: 0, sn: 0, se: 0, sd: 0 });
