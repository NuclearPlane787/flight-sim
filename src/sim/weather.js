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
//
// v0.6.0 (briefs/V0-6-0.md, "The wind, true everywhere"): the wind keeps its true
// direction as set at the arrival (its magnetic direction there plus the variation there) and is
// turned into grid coordinates at each point by the local convergence: the mean wind (surface,
// aloft, the shear) and the gusts' direction turn by windTurnAt(C, x, y), exactly 0 at
// (refX, refY), so the arrival's wind is v0.5.8's to the bit. A function of position, no state.
// Settings without the `trueWind` tag (v0.5.8's) keep one vector everywhere. (The turbulence's frozen waves
// and the microbursts don't turn: they have no direction to keep.)

import { magToGrid, convergenceAt } from '../world/frame.js';

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
  const o = {
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
  // v0.6.0: weather made with the region on keeps its wind's true direction across the map
  // (windTurnAt). Settings without the tag are v0.5.8's (a save's): their wind keeps its grid
  // direction everywhere, so an old save in weather flies as it did.
  if (s.trueWind === true) o.trueWind = true;
  // v0.7.4, weather by place: the departure's own weather (`dep`) and the two ends' places (`ends`). The
  // settings themselves are then the destination's. The same weather at both ends (all but the place it
  // is referred to) is one weather: the destination's alone, as every version before v0.7.4 had it, so
  // its numbers are those to the bit.
  // (Two places within SAME_PLACE_M are one place, a circuit: there it is one weather, the destination's.)
  if (s.dep && typeof s.dep === 'object' && validEnds(s.ends) && !samePlace(s.ends)) {
    const d = normalizeWeather({ ...s.dep, dep: null, ends: null });
    if (!sameWeather(d, o)) {
      o.dep = d;
      o.ends = { ax: s.ends.ax, ay: s.ends.ay, bx: s.ends.bx, by: s.ends.by };
      // v0.7.9: a front that moves (frontKt, below). Absent when 0, so a weather with no front is to the byte what
      // v0.7.8 stored.
      // (frontT0 and frontM, the code review's first finding: the sim time the speed was set at and how far the front
      // had come by then, so that a front set or stopped in flight goes on from where it is. Each absent when 0.)
      const fk = clamp(num(s.ends.frontKt, 0), -FRONT_KT_MAX, FRONT_KT_MAX), fm = num(s.ends.frontM, 0), t0 = Math.max(0, num(s.ends.frontT0, 0));
      if (fk !== 0) o.ends.frontKt = fk;
      if (fm !== 0) o.ends.frontM = fm;
      if (fk !== 0 && t0 > 0) o.ends.frontT0 = t0;
    }
  }
  return o;
}

// ---- v0.7.4: weather by place ----
// Two weathers, the departure's (`dep`) and the destination's (the settings themselves), and between them a
// blend by position alone: a point's place along the route from the departure (ax, ay) to the destination
// (bx, by), t = 0 at the one and 1 at the other, projected onto the line. Each end's weather holds over its
// third of the route (exactly: w is 0 for t ≤ 1/3, 1 for t ≥ 2/3, so its numbers there are that weather's
// alone), the blend runs smoothly across the middle third, and beyond either end the nearer end's holds.
// No state, so the live sim, the prediction and a jump's restore read the same air.
const validEnds = (e) => !!e && [e.ax, e.ay, e.bx, e.by].every(Number.isFinite);
// v0.7.4 (the review): a route back to its own airport (a circuit) has one place, so one weather: the
// destination's, what the player set for where they will land. Ends closer than this are one place.
export const SAME_PLACE_M = 1000;
export const samePlace = (e) => !validEnds(e) || Math.hypot(e.bx - e.ax, e.by - e.ay) < SAME_PLACE_M;
const placeless = (s) => JSON.stringify({ ...s, refX: 0, refY: 0 });
// The same weather, wherever each is referred to (its wind's magnetic direction is read at its own place).
export const sameWeather = (a, b) => placeless(normalizeWeather(a)) === placeless(normalizeWeather(b));
export const hasTwoEnds = (s) => !!(s && s.dep && s.ends);

// v0.7.9 (briefs/V0-7-9.md part 9): a front that moves in time. `ends.frontKt` is the speed at which the blend, the
// front between the two weathers, travels along the route's line: positive, the destination's weather comes toward
// the departure (a front arriving against the flight); negative, the departure's weather follows the flight toward
// the destination. The front's place is still a function of position and time alone (`t`, the sim's seconds since
// the flight began, which a snapshot carries), with no state: the live sim, the predicted path and a jump's restore
// read the same air. 0 or absent: the front stands still, v0.7.8's weather to the bit (t is not read).
// The front moves from where it was when its speed was last set: `frontT0` is that sim time and `frontM` the metres
// it had come by then (withFront() sets both), so setting a speed an hour into a flight starts the front moving
// from where it stands, and "Still" leaves it where it has come to. A moved destination keeps the metres.
export const FRONT_KT_MAX = 60;
// How far the front has come by time t, in metres along the route (positive toward the departure).
export function frontMetres(e, t = 0) {
  if (!e || (!e.frontKt && !e.frontM)) return 0;
  const dt = Number.isFinite(t) ? Math.max(0, t - (e.frontT0 || 0)) : 0;
  return (e.frontM || 0) + (e.frontKt ? e.frontKt * KT * dt : 0);
}
// ... and as a fraction of the route's length (added to a point's place along it).
export function frontShift(e, t = 0) {
  if (!e || (!e.frontKt && !e.frontM)) return 0;
  const L = Math.hypot(e.bx - e.ax, e.by - e.ay);
  return L > 1 ? frontMetres(e, t) / L : 0;
}
// 0 (the departure's weather) .. 1 (the destination's) at map point (x, y), at sim time t.
export function blendWeight(e, x, y, t = 0) {
  const dx = e.bx - e.ax, dy = e.by - e.ay, L2 = dx * dx + dy * dy;
  if (!(L2 > 1)) return 0;   // (one place for both: the departure's)
  let f = ((x - e.ax) * dx + (y - e.ay) * dy) / L2;
  if (e.frontKt || e.frontM) f += frontShift(e, t);
  return f <= 1 / 3 ? 0 : f >= 2 / 3 ? 1 : smooth((f - 1 / 3) * 3);
}
// The settings with the front's speed set (kt, see blendWeight()) at sim time `t`: the front goes on from where it
// has come to by then. A single weather has no front and is returned as it is.
export function withFront(s, kt, t = 0) {
  if (!hasTwoEnds(s)) return s;
  const at = Number.isFinite(t) ? Math.max(0, t) : 0;
  return normalizeWeather({ ...s, ends: { ...s.ends, frontKt: kt, frontM: frontMetres(s.ends, at), frontT0: at } });
}
export const frontKtOf = (s) => (hasTwoEnds(s) && s.ends.frontKt) || 0;

// One end's weather alone, as a single settings object: 'dep' or 'dest'. A single weather is both ends'.
export function endWeather(s, end) {
  if (!s) return null;
  if (!hasTwoEnds(s)) return s;
  if (end === 'dep') return s.dep;
  const { dep, ends, ...dest } = s;
  return dest;
}

// The settings with one end's weather set (`w`, a single weather, or null for calm), the other end's kept,
// at the places `ends` ({ ax, ay, bx, by }; the settings' own if left out). Normalized: equal ends become one.
export function withEndWeather(s, end, w, ends) {
  let e = validEnds(ends) ? ends : s && s.ends;
  // v0.7.9: the front stays with the route
  if (e && e.frontKt === undefined && e.frontM === undefined && s && s.ends && (s.ends.frontKt || s.ends.frontM)) {
    e = { ...e };
    for (const k of ['frontKt', 'frontM', 'frontT0']) if (s.ends[k]) e[k] = s.ends[k];
  }
  const one = normalizeWeather(w);
  const other = normalizeWeather(endWeather(s, end === 'dep' ? 'dest' : 'dep'));
  if (!validEnds(e)) return one;   // no places to blend between: the one weather everywhere
  const dep = end === 'dep' ? one : other, dest = end === 'dep' ? other : one;
  delete dep.dep; delete dep.ends; delete dest.dep; delete dest.ends;
  return normalizeWeather({ ...dest, dep, ends: e });
}

// A route changed in flight: the destination's weather goes with the new destination (its place, and the
// place its wind's magnetic direction is read at). A single weather is everywhere, and stays as it is.
export function moveDestination(s, x, y) {
  if (!hasTwoEnds(s) || !Number.isFinite(x) || !Number.isFinite(y)) return s;
  return normalizeWeather({ ...s, refX: x, refY: y, ends: { ...s.ends, bx: x, by: y } });
}

const wrapDeg = (d) => ((d % 360) + 360) % 360;
// A single weather between two (a at w = 0, b at w = 1): what the air at a point of the blend is, for the
// look, the sound and another airport's METAR. a or b itself at the ends. The wind blends as vectors (the
// two ends' magnetic directions taken as one: their variations differ by a few degrees at most), the
// visibility by its logarithm, the cloud layers in order of their bases, the turbulence by its level.
export function blendSettings(a, b, w) {
  const A = normalizeWeather(a), B = normalizeWeather(b);
  if (!(w > 0)) return A;
  if (w >= 1) return B;
  const near = w < 0.5 ? A : B;
  const lerp = (p, q) => p + (q - p) * w;
  const mixDir = (fa, ka, fb, kb, keep) => {
    const n = lerp(ka * Math.cos(fa * DEG), kb * Math.cos(fb * DEG)), e = lerp(ka * Math.sin(fa * DEG), kb * Math.sin(fb * DEG));
    const kt = Math.hypot(n, e);
    return { fromDeg: kt > 1e-6 ? wrapDeg(Math.atan2(e, n) / DEG) : keep, kt };
  };
  const sw = mixDir(A.wind.fromDeg, A.wind.kt, B.wind.fromDeg, B.wind.kt, near.wind.fromDeg);
  const exA = A.wind.gustKt > A.wind.kt ? A.wind.gustKt - A.wind.kt : 0, exB = B.wind.gustKt > B.wind.kt ? B.wind.gustKt - B.wind.kt : 0;
  const ex = lerp(exA, exB);
  const al = mixDir(A.aloft.fromDeg, A.aloft.kt, B.aloft.fromDeg, B.aloft.kt, near.aloft.fromDeg);
  const ti = Math.round(lerp(TURBULENCE_LEVELS.indexOf(A.turbulence), TURBULENCE_LEVELS.indexOf(B.turbulence)));
  const la = A.clouds.slice().sort((p, q) => p.baseFt - q.baseFt), lb = B.clouds.slice().sort((p, q) => p.baseFt - q.baseFt);
  const clouds = [];
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    const p = la[i] || { okta: 0, baseFt: lb[i].baseFt, topFt: lb[i].topFt }, q = lb[i] || { okta: 0, baseFt: p.baseFt, topFt: p.topFt };
    const okta = Math.round(lerp(p.okta, q.okta));
    if (okta > 0) clouds.push({ okta, baseFt: lerp(p.baseFt, q.baseFt), topFt: lerp(p.topFt, q.topFt) });
  }
  const ra = A.precip.kind === 'none' ? 0 : A.precip.rate * (1 - w), rb = B.precip.kind === 'none' ? 0 : B.precip.rate * w;
  const kind = ra + rb > 0 ? (ra >= rb ? A.precip.kind : B.precip.kind) : 'none';
  const o = {
    seed: near.seed, preset: near.preset, refX: near.refX, refY: near.refY,
    wind: { ...sw, gustKt: ex > 0 ? sw.kt + ex : 0 }, aloft: al,
    turbulence: TURBULENCE_LEVELS[ti] || 'none', shear: near.shear,
    microbursts: [...A.microbursts, ...B.microbursts].slice(0, 24),
    visM: Math.exp(lerp(Math.log(A.visM), Math.log(B.visM))), fogTopFt: lerp(A.fogTopFt, B.fogTopFt),
    clouds, precip: { kind, rate: kind === 'none' ? 0 : ra + rb },
    lightning: lerp(A.lightning, B.lightning), runway: near.runway,
    tempC: lerp(A.tempC, B.tempC), qnh: lerp(A.qnh, B.qnh),
  };
  if (A.trueWind || B.trueWind) o.trueWind = true;
  return normalizeWeather(o);
}

// The weather at map point (x, y), as a single settings object: a single weather is itself (the very
// object), an end's third that end's, the middle a blend. Each end's microbursts are kept only where its
// weather reaches (the departure's where the weight is under 1, the destination's where it is over 0).
// step > 0 rounds the weight to that step (the look's: it changes only by a visible step).
// (v0.7.9: `t`, the sim's time, for a front that moves; 0 where it stands still.)
export function weatherAt(s, x, y, step = 0, t = 0) {
  if (!hasTwoEnds(s)) return s || null;
  let w = blendWeight(s.ends, x, y, t);
  if (step > 0) w = Math.round(w / step) * step;
  const keep = (list, mine) => list.filter((m) => { const k = blendWeight(s.ends, m.x, m.y, t); return mine === 'dep' ? k < 1 : k > 0; });
  const a = endWeather(s, 'dep'), b = endWeather(s, 'dest');
  const o = blendSettings({ ...a, microbursts: keep(a.microbursts, 'dep') }, { ...b, microbursts: keep(b.microbursts, 'dest') }, w);
  // v0.7.4 (the review): for the look, the clouds' pattern (seed) and their drift (the wind aloft and the place it
  // is read at) are one for the whole flight, the destination's, at every point of the route: crossing the blend
  // changes how much cloud there is and where its layers sit, never where the whole field is or which pattern it
  // has. (clouds.js reads `cloud` before the weather's own seed and aloft; the sim never reads it.)
  // (The seed too, so the rain's particles and the strikes keep theirs across the blend.)
  return { ...o, seed: b.seed, cloud: { seed: b.seed, aloft: { ...b.aloft }, refX: b.refX, refY: b.refY, trueWind: b.trueWind === true } };
}

// For the look and the sound: the weather where the camera is, the same object until the settings change
// or the blend's weight moves by a visible step (1/24 of the middle third's change), so the world's and
// the synth's setWeather() run a few dozen times across a route, not every frame. A single weather is
// passed through as it is.
export const LOOK_STEP = 1 / 24;
export function createWeatherFollower(step = LOOK_STEP) {
  let lastS, lastW = NaN, out = null;
  return {
    at(s, x, y, t = 0) {
      if (!hasTwoEnds(s)) { lastS = s; lastW = NaN; out = s || null; return out; }
      const w = Math.round(blendWeight(s.ends, x, y, t) / step) * step;
      if (s !== lastS || w !== lastW) {
        lastS = s; lastW = w; out = weatherAt(s, x, y, step, t);
        if (isDefaultWeather({ ...out, seed: calmWeather().seed })) out = null;   // (the look's seed is the flight's)   // a calm end draws and sounds as the default weather does (null)
      }
      return out;
    },
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
  const n = normalizeWeather(s);
  delete n.trueWind;   // the tag alone is no weather
  return JSON.stringify(n) === JSON.stringify(calmWeather());
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
  if (hasTwoEnds(s)) return compileTwoEnds(s);
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
    refConv: convergenceAt(s.refX, s.refY), trueWind: s.trueWind === true,
    sfN: sf.n, sfE: sf.e, alN: al.n, alE: al.e,
    bDen: Math.pow(PROFILE_TOP_M / 10, PROFILE_ALPHA) - 1,
    gustAmp: Math.max(0, s.wind.gustKt - s.wind.kt) * KT, gustN, gustE,
    advSpeed: adv, advN: gustN * adv, advE: gustE * adv,
    shear: null, level: s.turbulence, modes: null, bursts: null, w20: sp * W20_FROM_10M,
    dT: s.tempC - ISA_TEMP_C, qnhPa: s.qnh * 100, qnh: s.qnh,
    gustKt: s.wind.gustKt > s.wind.kt ? s.wind.gustKt : 0,   // v0.7.4: the screens' gust peak (0: none)
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

// v0.7.4: two ends. A and B are each end's own compiled weather; windAt() blends their winds and
// localWeather() the rest. burstLambda() is a burst's strength for the scan at sim time t. The fields the sim reads without a place (windOn, atmOn, modes as a flag,
// bursts for the predictive windshear's scan) cover both: each end's microbursts are weighted by how much of
// that end's weather is at the burst (so a storm's cells stay with the end that has the storm).
export function burstLambda(C, b, t = 0) {
  if (!C || !C.two || b.lambda0 === undefined) return b.lambda;
  const k = blendWeight(C.ends, b.x, b.y, t);
  return b.lambda0 * (b.mine === 'dep' ? 1 - k : k);
}
function compileTwoEnds(s) {
  const { dep, ends, ...dest } = s;
  const A = compileWeather(dep), B = compileWeather(dest);
  const e = { ax: ends.ax, ay: ends.ay, bx: ends.bx, by: ends.by };
  for (const k of ['frontKt', 'frontM', 'frontT0']) if (ends[k]) e[k] = ends[k];   // v0.7.9
  // (v0.7.9, the code review's second finding: under a front the weights change with the clock, so each burst keeps
  // its own strength and its end, none is dropped, and the scan weighs them at its own time: burstLambda().)
  const front = !!(e.frontKt || e.frontM);
  const weigh = (list, mine) => list.map((b) => {
    const k = blendWeight(e, b.x, b.y);
    const o = { ...b, lambda: b.lambda * (mine === 'dep' ? 1 - k : k) };
    if (front) { o.lambda0 = b.lambda; o.mine = mine; }
    return o;
  }).filter((b) => front || b.lambda > 0);
  return {
    two: true, settings: s, A, B, ends: e, seed: B.seed,
    trueWind: false, refConv: 0,
    windOn: A.windOn || B.windOn, atmOn: A.atmOn || B.atmOn,
    modes: A.modes || B.modes, bursts: [...weigh(A.bursts, 'dep'), ...weigh(B.bursts, 'dest')],
    dT: B.dT, qnhPa: B.qnhPa, qnh: B.qnh, tyres: B.tyres, sfN: B.sfN, sfE: B.sfE, gustKt: B.gustKt,
    memo: { x: NaN, y: NaN, w: NaN, L: null },
  };
}

// v0.7.4: the compiled weather's place-bound parts at map point (x, y): { dT, qnhPa, qnh, atmOn, tyres, sfN,
// sfE, gustKt, trueWind, refConv } as the sim reads them. A single weather is itself; an end's third that
// end's own compiled weather; the middle a blend (sfN, sfE already turned to the place: windTurnAt() of it
// is 0). The runway's state is the nearer end's. A pure function of (x, y): the memo only saves the sums.
export function localWeather(C, x, y, t = 0) {
  if (!C.two) return C;
  const w = blendWeight(C.ends, x, y, t);
  if (w === 0) return C.A;
  if (w === 1) return C.B;
  const m = C.memo;
  if (m.x === x && m.y === y && m.w === w && m.L) return m.L;
  const A = C.A, B = C.B, L = m.L || (m.L = { two: false, trueWind: false, refConv: 0 });
  const lerp = (p, q) => p + (q - p) * w;
  const turned = (K) => {
    const r = windTurnAt(K, x, y);
    if (r === 0) return [K.sfN, K.sfE];
    const c = Math.cos(r), sn = Math.sin(r);
    return [K.sfN * c - K.sfE * sn, K.sfE * c + K.sfN * sn];
  };
  const a = turned(A), b = turned(B);
  L.sfN = lerp(a[0], b[0]); L.sfE = lerp(a[1], b[1]);
  L.dT = lerp(A.dT, B.dT); L.qnhPa = lerp(A.qnhPa, B.qnhPa); L.qnh = lerp(A.qnh, B.qnh);
  L.atmOn = L.dT !== 0 || L.qnhPa !== STD_QNH * 100;
  L.tyres = w < 0.5 ? A.tyres : B.tyres;
  L.gustKt = lerp(A.gustKt, B.gustKt);
  L.windOn = A.windOn || B.windOn; L.modes = A.modes || B.modes;
  L.w = w;
  m.x = x; m.y = y; m.w = w;
  return L;
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

// The angle (rad, clockwise) by which the wind compiled at (refX, refY) turns on the map at (x, y):
// convergence there minus convergence here, 0 for v0.5.8's settings (no
// `trueWind` tag) and exactly 0 at the reference.
export function windTurnAt(C, x, y) {
  return C.trueWind ? C.refConv - convergenceAt(x, y) : 0;
}

// Fills W with the air's velocity at map point (x, y), height z (metres above sea level), agl above the
// ground, at sim time t: n, e, d (the whole wind), meanN, meanE (without gusts, turbulence and bursts),
// and p, the roll-rate gust (rad/s) across a span `span` whose right wing points along (rn, re).
export function windAt(C, x, y, z, agl, t, rn, re, span, W) {
  if (C.two) return windAtTwo(C, x, y, z, agl, t, rn, re, span, W);
  const turn = windTurnAt(C, x, y);
  const tc = turn === 0 ? 1 : Math.cos(turn), ts = turn === 0 ? 0 : Math.sin(turn);
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
  if (turn !== 0) { const n0 = n; n = n0 * tc - e * ts; e = e * tc + n0 * ts; }
  W.meanN = n; W.meanE = e;
  let d = 0, p = 0;
  if (C.gustAmp > 0) {
    const g = gustField(C, x, y, t) * C.gustAmp * (h < 10 ? Math.pow(Math.max(h, 1) / 10, PROFILE_ALPHA) : 1) * (1 - smooth((h - 600) / 900));
    if (turn === 0) { n += C.gustN * g; e += C.gustE * g; }
    else { n += (C.gustN * tc - C.gustE * ts) * g; e += (C.gustE * tc + C.gustN * ts) * g; }
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

// v0.7.4: two ends' air. In an end's third that end's wind alone (the very same sums); across the middle
// both, blended by the weight (the gusts and the turbulence too: where the two are alike, half of each).
const WA = newWind(), WB = newWind();
const WIND_KEYS = ['n', 'e', 'd', 'p', 'meanN', 'meanE', 'sn', 'se', 'sd'];
function windAtTwo(C, x, y, z, agl, t, rn, re, span, W) {
  const w = blendWeight(C.ends, x, y, t);
  if (w === 0) return windAt(C.A, x, y, z, agl, t, rn, re, span, W);
  if (w === 1) return windAt(C.B, x, y, z, agl, t, rn, re, span, W);
  windAt(C.A, x, y, z, agl, t, rn, re, span, WA);
  windAt(C.B, x, y, z, agl, t, rn, re, span, WB);
  for (const k of WIND_KEYS) W[k] = WA[k] + (WB[k] - WA[k]) * w;
  return W;
}
