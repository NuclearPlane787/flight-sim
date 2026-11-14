// Designs, the warehouse's aircraft. v0.5.0 made a design one of the three types (its base) with its engines
// changed (count, type, stations, a thrust scale), its empty weight, its fuel capacity and its gear's length.
// v0.5.2 makes it KSP's way: the base's airframe is the root, and parts attach to it wherever they fit. Engines on
// pylons under or over the wing, on the rear fuselage's sides or in the tail, each its own type and thrust, nudged
// fore and aft, up and down, and turned a few degrees; external fuel tanks under the wing, tanks in the cargo hold
// and ballast. A part on one side has a mirror twin by default (`pair`), and editing one edits both. Each part
// brings its own mass, drag and thrust line: the CG, the inertias, the drag and the thrust's moments follow from
// where it is. The airframe's lift and stability stay the base's (v0.5.3 builds the airframe from parts too).
//
// Everything that flies or draws an aircraft reads a design through designDef(), which makes a type entry like
// src/sim/types.js's: the same id as the base (the models, cockpits and screens are the base's), with the design's
// data (src/sim/a321neo.js's names), geometry (src/geometry.js's names) and limits. No DOM and no three.js: the
// sim, the prediction worker and node tests read it.
//
// The shape (`v: 2`):
//   { v, id, name, registration, base,          // base: 'a321neo' | 'b787-9' | 'b777-300er'
//     oewDeltaKg,                               // the structure's weight change, −15 % to +30 % of the base's OEW
//     fuelCapacityKg,                           // the airframe's own tanks, half to twice the base's (the change in the centre tank)
//     gearExtendM,                              // 0 to 1.5 m longer legs, main and nose together
//     parts: [ part, … ] }                      // up to MAX_PARTS, at most MAX_ENGINES engines
//   part (geometry frame: x forward, y left, z up; side 1 left, −1 right, 0 the centreline):
//     { id, kind: 'engine', engine, mount: 'wing' | 'overwing' | 'body' | 'tail', side, s, x, dx, dz, yaw, pitch, thrust, pair }
//         wing, overwing: s, the station (m from the centreline); body: x, the station along the fuselage; tail: on the fin's
//         root. dx, dz: the nacelle moved forward and up from where the mount puts it (m); yaw, pitch: the thrust line turned
//         (degrees; yaw towards the centreline is toe-in); thrust: the engine type's rated thrust times this (0.5 to 3).
//     { id, kind: 'tank', mount: 'wing' | 'hold', side, s, x, dx, kg, pair }   an external tank on a pylon under the wing (s),
//         or a tank in the cargo hold (x); kg: the fuel it holds
//     { id, kind: 'ballast', x, kg }            in the hold on the centreline, at station x
// A v1 design (v0.5.0's: engine, count, stations, thrustScale) becomes v2 parts on the way in (normalizeDesign()), with the
// same nacelles, thrust and mass.
//
//   normalizeDesign(d)      → a full, clamped v2 copy (never shares d)
//   newDesign(base, extra?) → a design that is its base exactly (it flies the base's golden flight)
//   designDef(d)            → the type entry (memoized by the design's contents)
//   resolveDef(x)           → designDef(x) for a design, typeById(x) for a type id
//   addPart(d, part, { mirror }) / updatePart(d, id, patch) / removePart(d, id) / setMirror(d, id, on) → a new design
//   placeEngine(base, part) / placeTank(base, part) / placeBallast(base, part) → where the part's parts go
//   mountRange(base, part)  → { lo, hi, key } for its station (s or x)
//   stationRange(base, engine) → [min, max] m for a wing engine's station (v0.5.0's)
//   designNumbers(def)      → the warehouse's live numbers and checks

import { TYPES, typeById } from './types.js';
import { ENGINE_TYPES, SCALED_KEYS, engineOfType, pylonLimitN } from './engine-types.js';
import { GENX_1B, GE90_115B } from '../audio/engine-sounds.js';

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);
const r2 = (v) => Math.round(v * 100) / 100;
export const COUNTS = [2, 3, 4, 6];                     // v0.5.0's engine counts (a v1 design's)
export const MAX_ENGINES = 8, MAX_PARTS = 24;
export const KINDS = ['engine', 'tank', 'ballast'];
export const ENGINE_MOUNTS = ['wing', 'overwing', 'body', 'tail'];
export const TANK_MOUNTS = ['wing', 'hold'];
export const RANGES = {
  thrustScale: [0.5, 3], oewFrac: [-0.15, 0.30], fuelFrac: [0.5, 2], gearExtendM: [0, 1.5],
  dx: [-3, 3], dz: [-1, 1], yaw: [-10, 10], pitch: [-10, 10], tankKg: [1000, 8000], holdKg: [1000, 3000], ballastKg: [100, 6000],
};
// Drag: a nacelle with its pylon about CD 0.05 on its frontal area, an external tank 0.08 (about 0.15 m² for an
// A321's LEAP-1A against the aircraft's 2.7 m²: the base's own nacelles are in its CD0, so only the change counts).
const CD_NACELLE = 0.05, CD_TANK = 0.08;
const FUEL_DENSITY = 800;                              // kg/m³
const TANK_EMPTY = 0.10, HOLD_EMPTY = 0.12;             // an empty tank's mass, as a fraction of its fuel
const SOUNDS = { 'genx-1b': GENX_1B, 'ge90-115b': GE90_115B };   // the LEAP-1A's is the synth's default
export const isDesign = (x) => !!x && typeof x === 'object' && typeof x.base === 'string' && !!TYPES[x.base];

// ---- the base airframe's shapes the mounts need ----
// The wing as a straight-tapered planform from the fuselage's side: its leading edge, chord and heights at a span,
// tied to the base's own nacelle (its pylon reaches the underside about 0.35 m over the nacelle's top).
const AIRFRAMES = new Map();
// Where the rear fuselage starts to taper (the tail cone), x: from the models (aircraft.js, widebody-specs.js).
const TAIL_CONE_X = { a321neo: -11.0 };
const TAIL_CONE_FROM_NOSE = { 'b787-9': 47, 'b777-300er': 54 };
// The A321's geometry has no FIN: its fin's root leading edge is at about x −15.0 (aircraft.js finSec()).
const FIN_ROOT_LE = { a321neo: -15.0 };
export function airframe(base) {
  let a = AIRFRAMES.get(base);
  if (a) return a;
  const T = typeById(base), G = T.geo, W = G.WING;
  const ys = G.FUSELAGE_WIDTH / 2, tipY = G.SPAN / 2;
  const leTan = Math.tan((W.leSweepDeg ?? W.sweepDeg + 2) * DEG), dihTan = Math.tan(W.dihedralDeg * DEG);
  const chord = (y) => W.rootChord + (W.tipChord - W.rootChord) * clamp((y - ys) / (tipY - ys), 0, 1);
  const leX = (y) => W.rootX - (Math.max(y, ys) - ys) * leTan;
  const N0 = G.NACELLES[0], D0 = G.NACELLE_DIAMETER, y0 = Math.abs(N0.y);
  const lower0 = N0.z + D0 / 2 + 0.35;
  const lower = (y) => lower0 + (y - y0) * dihTan;
  const upper = (y) => lower(y) + 0.12 * chord(y);
  const tailCone = TAIL_CONE_X[base] ?? G.NOSE_X - (TAIL_CONE_FROM_NOSE[base] ?? 0.75 * G.LENGTH);
  const finLe = G.FIN ? G.FIN.rootLeX : FIN_ROOT_LE[base] ?? G.TAIL_STRIKE_POINT.x + 2.5;
  a = { T, G, W, ys, tipY, chord, leX, lower, upper, tailCone, finLe, rootTe: W.rootX - W.rootChord };
  AIRFRAMES.set(base, a);
  return a;
}

// The stations a wing engine's pair may take (v0.5.0's): outboard of the fuselage's side by a nacelle's width, clear
// of the main gear's leg by half a nacelle and 0.3 m, to 70 % of the semi-span.
export function stationRange(base, engineId) {
  const G = typeById(base).geo, E = ENGINE_TYPES[engineId] || engineOfType(base);
  const D = E.nacelle.D;
  let lo = G.FUSELAGE_WIDTH / 2 + D;
  const gearY = G.GEAR.left.y, clear = D / 2 + 0.3;
  if (lo < gearY + clear && lo > gearY - clear) lo = gearY + clear;
  const hi = 0.7 * G.SPAN / 2;
  return [lo, Math.max(lo, hi)];
}

// Each mount's station range (s or x) for a part.
export function mountRange(base, p) {
  const a = airframe(base), G = a.G;
  if (p.kind === 'engine') {
    const E = ENGINE_TYPES[p.engine] || engineOfType(base), D = E.nacelle.D, L = E.nacelle.L;
    if (p.mount === 'wing') { const [lo, hi] = stationRange(base, E.id); return { lo, hi, key: 's' }; }
    if (p.mount === 'overwing') return { lo: a.ys + D / 2 + 0.6, hi: Math.max(a.ys + D / 2 + 0.6, 0.7 * a.tipY), key: 's' };
    if (p.mount === 'body') {
      const hi = a.rootTe - L / 2 - 0.5, lo = Math.min(hi, a.tailCone - 1.5);
      return { lo, hi, key: 'x' };
    }
    return { lo: 0, hi: 0, key: null };   // tail: on the fin's root
  }
  if (p.kind === 'tank' && p.mount === 'wing') return { lo: a.ys + 1.5, hi: 0.75 * a.tipY, key: 's' };
  // In the hold: between the tail cone and the nose gear's bay.
  const lo = a.tailCone + 2, hi = Math.max(lo, G.GEAR.nose.x - 3);
  return { lo, hi, key: 'x' };
}

// ---- where a part goes ----
// A wing engine at station y (v0.5.0's): from the base's first nacelle along the leading edge's sweep and up the
// dihedral; its top where the base nacelle's top is (the pylon's the same height), its aft end where the base's aft
// end is, so a bigger engine reaches lower and further forward. The thrust point keeps the base's offset from the
// nacelle's centre.
function wingEngine(G, E0, y, side) {
  const N0 = G.NACELLES[0], T0 = G.ENGINES[0], D0 = G.NACELLE_DIAMETER, L0 = G.NACELLE_LENGTH;
  const W = G.WING, sweep = Math.tan((W.leSweepDeg ?? W.sweepDeg) * DEG), dih = Math.tan(W.dihedralDeg * DEG);
  const dy = y - N0.y, dx = -dy * sweep + (E0.nacelle.L - L0) / 2, dz = dy * dih, dD = (E0.nacelle.D - D0) / 2;
  return {
    nacelle: { x: N0.x + dx, y: side * y, z: N0.z + dz - dD, D: E0.nacelle.D, L: E0.nacelle.L },
    thrust: { x: T0.x + dx, y: side * y, z: T0.z + dz - dD },
  };
}
// The tail engine (v0.5.0's), DC-10 style: on the centreline through the fin's root, its centre a little above the
// crown, the intake ahead of the fin.
function tailEngine(G, E, finLe) {
  const D = E.nacelle.D, L = E.nacelle.L;
  const x = finLe + 0.2 * L, z = G.FUSELAGE_HEIGHT / 2 + 0.45 * D;
  return { nacelle: { x, y: 0, z, D, L, tail: true }, thrust: { x, y: 0, z } };
}

// An engine part's nacelle (centre, size, mount), thrust point and thrust direction (unit, geometry frame; null along x).
export function placeEngine(base, p) {
  const a = airframe(base), G = a.G, E = ENGINE_TYPES[p.engine] || engineOfType(base), D = E.nacelle.D, L = E.nacelle.L;
  let nacelle, thrust;
  if (p.mount === 'tail') ({ nacelle, thrust } = tailEngine(G, E, a.finLe));
  else if (p.mount === 'wing') ({ nacelle, thrust } = wingEngine(G, E, p.s, p.side));
  else if (p.mount === 'overwing') {
    const y = p.s, x = a.leX(y) - 0.55 * a.chord(y), z = a.upper(y) + 0.65 + D / 2;
    nacelle = { x, y: p.side * y, z, D, L };
    thrust = { x, y: p.side * y, z };
  } else {
    // body: on a short stub from the rear fuselage's side, a little above its middle (MD-80 style)
    const y = a.ys + 0.55 + D / 2, z = 0.12 * G.FUSELAGE_HEIGHT;
    nacelle = { x: p.x, y: p.side * y, z, D, L };
    thrust = { x: p.x, y: p.side * y, z };
  }
  const dx = p.dx || 0, dz = p.dz || 0;
  nacelle = { ...nacelle, x: nacelle.x + dx, z: nacelle.z + dz, mount: p.mount };
  thrust = { x: thrust.x + dx, y: thrust.y, z: thrust.z + dz };
  // yaw toward the centreline is toe-in: for a left engine (side 1) its nose turns to −y.
  const yw = (p.yaw || 0) * DEG * (p.side || 1), pt = (p.pitch || 0) * DEG;
  const dir = yw === 0 && pt === 0 ? null : [Math.cos(pt) * Math.cos(yw), -Math.cos(pt) * Math.sin(yw), Math.sin(pt)];
  return { nacelle, thrust, dir, E };
}
// An external tank (a teardrop on a pylon under the wing) or a hold tank: its centre and size.
export function placeTank(base, p) {
  const a = airframe(base), G = a.G, vol = p.kg / FUEL_DENSITY;
  if (p.mount === 'hold') return { x: p.x, y: 0, z: -0.28 * G.FUSELAGE_HEIGHT, D: 0, L: 0, hold: true };
  const D = Math.cbrt(vol / (0.75 * Math.PI)), L = 4 * D, y = p.s;
  return { x: a.leX(y) - 0.3 * a.chord(y) + (p.dx || 0), y: p.side * y, z: a.lower(y) - 0.45 - D / 2, D, L };
}
export const placeBallast = (base, p) => ({ x: p.x, y: 0, z: -0.3 * typeById(base).geo.FUSELAGE_HEIGHT });

// ---- normalising ----
const baseEngine = (base) => engineOfType(base);
const pairsOf = (count) => (count === 3 ? 1 : count / 2);
const spacingOf = (engineId) => (ENGINE_TYPES[engineId]?.nacelle.D ?? 3) + 0.5;
function defaultStations(base, engineId, count) {
  const G = typeById(base).geo, [lo, hi] = stationRange(base, engineId);
  const y0 = clamp(G.ENGINES[0].y, lo, hi);
  const n = pairsOf(count);
  if (n === 1) return [y0];
  const a = Math.max(lo, Math.min(y0, hi - (n - 1) * spacingOf(engineId)));
  const out = [];
  for (let i = 0; i < n; i++) out.push(+(a + (hi - a) * (n === 2 ? i * 0.62 : i / (n - 1))).toFixed(2));
  return out;
}
// v0.5.0's station rules, for a v1 design on its way in.
function fixStations(st, base, engineId, count) {
  const [lo, hi] = stationRange(base, engineId), sp = spacingOf(engineId), n = pairsOf(count);
  let s = (Array.isArray(st) ? st.map((v) => num(v, NaN)).filter(Number.isFinite) : []).slice(0, n);
  if (s.length < n) s = defaultStations(base, engineId, count);
  s = s.map((v) => clamp(v, lo, hi)).sort((a, b) => a - b);
  for (let i = 1; i < n; i++) if (s[i] < s[i - 1] + sp) s[i] = s[i - 1] + sp;
  if (s[n - 1] > hi) { s[n - 1] = hi; for (let i = n - 2; i >= 0; i--) if (s[i] > s[i + 1] - sp) s[i] = s[i + 1] - sp; }
  return s.map((v) => Math.max(lo, v));
}
// A v1 design's engines as v2 parts: a mirrored pair per station, the tail engine of three.
function partsFromV1(d, base) {
  const engine = ENGINE_TYPES[d.engine] ? d.engine : baseEngine(base).id;
  const count = COUNTS.includes(+d.count) ? +d.count : 2;
  const thrust = +clamp(num(d.thrustScale, 1), ...RANGES.thrustScale).toFixed(3);
  const stations = fixStations(d.stations, base, engine, count);
  const parts = [];
  let n = 0;
  for (const s of stations) {
    const a = `p${++n}`, b = `p${++n}`;
    parts.push({ id: a, kind: 'engine', engine, mount: 'wing', side: 1, s, x: 0, dx: 0, dz: 0, yaw: 0, pitch: 0, thrust, pair: b });
    parts.push({ id: b, kind: 'engine', engine, mount: 'wing', side: -1, s, x: 0, dx: 0, dz: 0, yaw: 0, pitch: 0, thrust, pair: a });
  }
  if (count === 3) parts.push({ id: `p${++n}`, kind: 'engine', engine, mount: 'tail', side: 0, s: 0, x: 0, dx: 0, dz: 0, yaw: 0, pitch: 0, thrust, pair: null });
  return parts;
}
export const baseParts = (base) => partsFromV1({ engine: baseEngine(base).id, count: 2, stations: [typeById(base).geo.ENGINES[0].y], thrustScale: 1 }, base);

// One part, clamped to its mount's limits (a centreline part has side 0; the tail is the only engine mount there).
function fixPart(p, base, id) {
  const kind = KINDS.includes(p.kind) ? p.kind : 'engine';
  const out = { id: String(p.id || id).slice(0, 12), kind };
  if (kind === 'engine') {
    out.engine = ENGINE_TYPES[p.engine] ? p.engine : baseEngine(base).id;
    out.mount = ENGINE_MOUNTS.includes(p.mount) ? p.mount : 'wing';
    out.side = out.mount === 'tail' ? 0 : (+p.side < 0 ? -1 : 1);
    const R = mountRange(base, out);
    out.s = out.mount === 'wing' || out.mount === 'overwing' ? clamp(num(p.s, R.lo), R.lo, R.hi) : 0;
    out.x = out.mount === 'body' ? clamp(num(p.x, (R.lo + R.hi) / 2), R.lo, R.hi) : 0;
    out.dx = r2(clamp(num(p.dx, 0), ...RANGES.dx));
    out.dz = r2(clamp(num(p.dz, 0), ...RANGES.dz));
    out.yaw = r2(clamp(num(p.yaw, 0), ...RANGES.yaw));
    out.pitch = r2(clamp(num(p.pitch, 0), ...RANGES.pitch));
    out.thrust = +clamp(num(p.thrust, 1), ...RANGES.thrustScale).toFixed(3);
  } else if (kind === 'tank') {
    out.mount = TANK_MOUNTS.includes(p.mount) ? p.mount : 'wing';
    out.side = out.mount === 'hold' ? 0 : (+p.side < 0 ? -1 : 1);
    const R = mountRange(base, out);
    out.s = out.mount === 'wing' ? clamp(num(p.s, R.lo), R.lo, R.hi) : 0;
    out.x = out.mount === 'hold' ? clamp(num(p.x, (R.lo + R.hi) / 2), R.lo, R.hi) : 0;
    out.dx = out.mount === 'wing' ? r2(clamp(num(p.dx, 0), ...RANGES.dx)) : 0;
    const K = out.mount === 'hold' ? RANGES.holdKg : RANGES.tankKg;
    out.kg = Math.round(clamp(num(p.kg, K[0] * 2), ...K));
  } else {
    const R = mountRange(base, { kind: 'ballast' });
    out.side = 0;
    out.x = clamp(num(p.x, (R.lo + R.hi) / 2), R.lo, R.hi);
    out.kg = Math.round(clamp(num(p.kg, 1000), ...RANGES.ballastKg));
  }
  out.pair = typeof p.pair === 'string' && out.side !== 0 ? p.pair : null;
  return out;
}
// The fields a mirror twin shares with its part (its side is the other one).
const SHARED = ['kind', 'engine', 'mount', 's', 'x', 'dx', 'dz', 'yaw', 'pitch', 'thrust', 'kg'];

export function normalizeDesign(d = {}) {
  const base = TYPES[d.base] ? d.base : 'a321neo';
  const T = TYPES[base], A = T.data;
  const r = RANGES;
  // v0.5.0's engine fields (engine, count, stations, thrustScale), where present, make the engines as they did (a v1
  // design, or an old caller's `{ ...design, count: 4 }`); a v2 design never carries them, so it round-trips.
  const v1 = ['engine', 'count', 'stations', 'thrustScale'].some((k) => d[k] !== undefined);
  const others = Array.isArray(d.parts) ? d.parts.filter((p) => p && p.kind !== 'engine') : [];
  const raw = v1 || !Array.isArray(d.parts) ? [...partsFromV1(d, base), ...others] : d.parts;
  const seen = new Set();
  const parts = [];
  let engines = 0;
  raw.slice(0, MAX_PARTS * 2).forEach((p, i) => {
    if (!p || typeof p !== 'object' || parts.length >= MAX_PARTS) return;
    let q = fixPart(p, base, `p${i + 1}`);
    while (seen.has(q.id)) q = { ...q, id: q.id + 'x' };
    if (q.kind === 'engine') { if (engines >= MAX_ENGINES) return; engines++; }
    seen.add(q.id);
    parts.push(q);
  });
  // Pairs: both ends name each other, on opposite sides, the same kind; the first of the two leads, the twin follows.
  const byId = new Map(parts.map((p) => [p.id, p]));
  for (const p of parts) {
    if (!p.pair) continue;
    const t = byId.get(p.pair);
    if (!t || t === p || t.pair !== p.id || t.kind !== p.kind || t.side !== -p.side) { p.pair = null; continue; }
    if (parts.indexOf(t) > parts.indexOf(p)) for (const k of SHARED) if (k in p) t[k] = p[k];
  }
  for (const p of parts) if (p.pair && byId.get(p.pair)?.pair !== p.id) p.pair = null;
  return {
    v: 2,
    id: String(d.id || 'd' + Date.now().toString(36)).slice(0, 40),
    name: String(d.name ?? `My ${T.name}`).slice(0, 40) || `My ${T.name}`,
    registration: String(d.registration ?? T.registration).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 8) || T.registration,
    base,
    oewDeltaKg: Math.round(clamp(num(d.oewDeltaKg, 0), r.oewFrac[0] * A.OEW, r.oewFrac[1] * A.OEW)),
    fuelCapacityKg: Math.round(clamp(num(d.fuelCapacityKg, A.FUEL_MAX), r.fuelFrac[0] * A.FUEL_MAX, r.fuelFrac[1] * A.FUEL_MAX)),
    gearExtendM: +clamp(num(d.gearExtendM, 0), ...r.gearExtendM).toFixed(2),
    parts,
  };
}

export function newDesign(base = 'a321neo', extra = {}) {
  const T = typeById(base), A = T.data;
  // v0.5.0's engine fields (engine, count, stations, thrustScale) still make the engines when no parts are given.
  const v1 = !('parts' in extra) && ['engine', 'count', 'stations', 'thrustScale'].some((k) => k in extra);
  const parts = v1 ? partsFromV1(extra, T.id) : baseParts(T.id);
  return normalizeDesign({
    v: 2, id: extra.id || 'd' + Date.now().toString(36), name: `My ${T.name}`, registration: T.registration, base: T.id,
    oewDeltaKg: 0, fuelCapacityKg: A.FUEL_MAX, gearExtendM: 0, parts, ...extra,
  });
}

// ---- editing (each returns a new, normalised design) ----
function nextId(d) {
  let n = 0;
  for (const p of d.parts) { const m = /^p(\d+)/.exec(p.id); if (m) n = Math.max(n, +m[1]); }
  return () => `p${++n}`;
}
export function addPart(design, part, { mirror = true } = {}) {
  const d = normalizeDesign(design), id = nextId(d);
  if (d.parts.length >= MAX_PARTS) return d;
  const p = fixPart({ ...part, id: id() }, d.base, 'p0');
  if (p.kind === 'engine' && engineParts(d).length >= MAX_ENGINES) return d;
  const add = [p];
  const room = d.parts.length + 2 <= MAX_PARTS && (p.kind !== 'engine' || engineParts(d).length + 2 <= MAX_ENGINES);
  if (mirror && p.side !== 0 && room) {
    const t = { ...p, id: id(), side: -p.side, pair: p.id };
    p.pair = t.id;
    add.push(t);
  } else p.pair = null;
  return normalizeDesign({ ...d, parts: [...d.parts, ...add] });
}
export function updatePart(design, id, patch) {
  const d = normalizeDesign(design);
  const p = d.parts.find((q) => q.id === id);
  if (!p) return d;
  const { id: _i, pair: _p, side, ...rest } = patch;
  Object.assign(p, rest);
  if (side !== undefined && !p.pair) p.side = +side < 0 ? -1 : 1;
  let parts = d.parts;
  const t = p.pair ? parts.find((q) => q.id === p.pair) : null;
  if (t) {
    // A part moved to a mount on the centreline loses its twin; the twin follows anything else.
    if (fixPart(p, d.base, p.id).side === 0) { parts = parts.filter((q) => q !== t); p.pair = null; }
    else for (const k of SHARED) if (k in p) t[k] = p[k];
  }
  return normalizeDesign({ ...d, parts: parts.map((q) => (q === p ? { ...p } : q)) });
}
export function removePart(design, id) {
  const d = normalizeDesign(design);
  const p = d.parts.find((q) => q.id === id);
  if (!p) return d;
  return normalizeDesign({ ...d, parts: d.parts.filter((q) => q.id !== id && q.id !== p.pair) });
}
export function setMirror(design, id, on) {
  const d = normalizeDesign(design), idn = nextId(d);
  const p = d.parts.find((q) => q.id === id);
  if (!p || p.side === 0) return d;
  if (!on) {
    const t = d.parts.find((q) => q.id === p.pair);
    if (t) t.pair = null;
    p.pair = null;
    return normalizeDesign(d);
  }
  if (p.pair) return d;
  if (p.kind === 'engine' && engineParts(d).length >= MAX_ENGINES) return d;
  if (d.parts.length >= MAX_PARTS) return d;
  const t = { ...p, id: idn(), side: -p.side, pair: p.id };
  p.pair = t.id;
  return normalizeDesign({ ...d, parts: [...d.parts, t] });
}
export const engineParts = (d) => d.parts.filter((p) => p.kind === 'engine');
// A design's engines as v0.5.0's fields (the first engine's type and thrust, the left wing's stations inboard first).
export function v1View(design) {
  const d = normalizeDesign(design), E = engineParts(d);
  return { count: E.length, engine: E[0]?.engine ?? null, thrustScale: E[0]?.thrust ?? 1,
    stations: E.filter((p) => p.mount === 'wing' && p.side > 0).map((p) => p.s).sort((a, b) => a - b) };
}

// ---- the geometry ----
// The engines in the sim's order: the left side outboard to inboard, the centreline, the right side inboard to
// outboard (v0.5.0's for its layouts: engine 1 the left outboard, a tail engine between the two sides).
function orderEngines(list) {
  const rank = (e) => (e.nacelle.y > 1e-9 ? 0 : e.nacelle.y < -1e-9 ? 2 : 1);
  return list.slice().sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    const ya = Math.abs(a.nacelle.y), yb = Math.abs(b.nacelle.y);
    if (ya !== yb) return ra === 0 ? yb - ya : ya - yb;
    return b.nacelle.x - a.nacelle.x;
  });
}
// Is the design's set of engines the base's own (its type, at its station, untouched)? Then its geometry is the
// base's exactly (v0.5.0's shortcut, so a design that is its base flies its golden flight).
function baseEngines(T, d) {
  const E = engineParts(d), G = T.geo, e0 = baseEngine(T.id).id;
  if (E.length !== 2) return false;
  return E.every((p) => p.engine === e0 && p.mount === 'wing' && p.s === G.ENGINES[0].y && !p.dx && !p.dz && !p.yaw && !p.pitch && p.thrust === 1)
    && E[0].side === -E[1].side;
}

function buildGeo(T, d, engines, tanks) {
  const G = T.geo, ext = d.gearExtendM;
  let ENGINES, NACELLES, DIRS = null;
  if (baseEngines(T, d)) {
    NACELLES = G.NACELLES.map((n, i) => ({ ...n, D: G.NACELLE_DIAMETER, L: G.NACELLE_LENGTH, engine: engines[0].part.engine, i, mount: 'wing', part: engines[i].part.id }));
    ENGINES = G.ENGINES.map((e) => ({ x: e.x, y: e.y, z: e.z }));
  } else {
    ENGINES = engines.map((e) => ({ x: e.thrust.x, y: e.thrust.y, z: e.thrust.z }));
    NACELLES = engines.map((e, i) => ({ ...e.nacelle, engine: e.part.engine, i, part: e.part.id, yaw: e.part.yaw * (e.part.side || 1), pitch: e.part.pitch }));
    if (engines.some((e) => e.dir)) DIRS = engines.map((e) => e.dir || [1, 0, 0]);
  }
  const GROUND_Z = G.GROUND_Z + ext;
  const GEAR = ext === 0 ? G.GEAR : Object.fromEntries(Object.entries(G.GEAR).map(([k, g]) => [k, { ...g, z: g.z - ext }]));
  const PODS = tanks.filter((t) => !t.place.hold).map((t) => ({ ...t.place, part: t.part.id }));
  const CRASH_POINTS = [
    ...G.CRASH_POINTS.filter((c) => c.why !== 'engine strike'),
    // each nacelle's lowest point (a tail engine can't touch: it has none), and each external tank's
    ...NACELLES.filter((n) => !n.tail).map((n) => ({ x: n.x, y: n.y, z: n.z - n.D / 2, why: 'engine strike', engine: n.i })),
    ...PODS.map((t) => ({ x: t.x, y: t.y, z: t.z - t.D / 2, why: 'tank strike' })),
  ];
  return { ...G, ENGINES, NACELLES, THRUST_DIRS: DIRS, PODS, GEAR, GROUND_Z, CRASH_POINTS, GEAR_EXTEND_M: ext };
}

// ---- the data: the engines' numbers, the mass properties, the tanks, the drag ----
const engineData = (E, thrust) => {
  const o = { ...E.data };
  if (thrust !== 1) for (const k of SCALED_KEYS) o[k] = E.data[k] * thrust;
  return o;
};
function buildData(T, d, engines, tanks, ballast, geo) {
  const A = T.data, E0 = baseEngine(T.id), G0 = T.geo;
  const first = engines[0] || null;
  const D = { ...A, ...(first ? engineData(first.E, first.part.thrust) : {}) };
  // Mixed engines (types or thrusts): each engine's own numbers (sim.js makes an engine model per engine).
  const mixed = !!first && engines.some((e) => e.E.id !== first.E.id || e.part.thrust !== first.part.thrust);
  D.ENGINE_DATA = mixed ? engines.map((e) => Object.freeze(engineData(e.E, e.part.thrust))) : undefined;
  if (!first) { D.T0_ENGINE = 0; D.T_IDLE = 0; }
  // The parts' masses against the base's two engines (already inside its OEW, CG and inertias): each part added at
  // its place, each of the base's engines taken away at its own. Point masses about the OEW's CG.
  const pm = [];
  geo.NACELLES.forEach((n, i) => pm.push({ m: engines[i].E.installedKg, x: n.x, y: n.y, z: n.z }));
  for (const n of G0.NACELLES) pm.push({ m: -E0.installedKg, x: n.x, y: n.y, z: n.z });
  for (const t of tanks) pm.push({ m: t.part.kg * (t.place.hold ? HOLD_EMPTY : TANK_EMPTY), x: t.place.x, y: t.place.y, z: t.place.z });
  for (const b of ballast) pm.push({ m: b.part.kg, x: b.place.x, y: b.place.y, z: b.place.z });
  const cg0 = A.CG_OEW_X;
  let dm = 0, dmx = 0;
  for (const p of pm) { dm += p.m; dmx += p.m * (p.x - cg0); }
  const oew = A.OEW + d.oewDeltaKg + dm;
  D.OEW = oew;
  // The structural limits stay the base's: the payload is what MZFW leaves over this OEW.
  D.MAX_PAYLOAD = Math.max(0, T.limits.MZFW - oew);
  D.CG_OEW_X = dmx === 0 ? cg0 : cg0 + dmx / oew;
  // The inertias: the per-kg terms already grow with the OEW, so the point masses add only what they add beyond them.
  let ixx = 0, iyy = 0, izz = 0;
  for (const p of pm) {
    const rx = p.x - D.CG_OEW_X;
    ixx += p.m * (p.y * p.y + p.z * p.z); iyy += p.m * (rx * rx + p.z * p.z); izz += p.m * (rx * rx + p.y * p.y);
  }
  D.DESIGN_DIXX = ixx - dm * A.IXX_ZFW_PER_KG;
  D.DESIGN_DIYY = iyy - dm * A.IYY_PER_KG;
  D.DESIGN_DIZZ = izz - dm * A.IZZ_ZFW_PER_KG;
  // The tanks: the wings stay as they are (or empty to half of a smaller capacity each); the centre tank takes the rest,
  // and the parts' tanks join it (their fuel feeds through it, burned first), its CG the mean of where they all are.
  const cap = d.fuelCapacityKg, added = tanks.reduce((s, t) => s + t.part.kg, 0);
  D.FUEL_WING_EACH = Math.min(A.FUEL_WING_EACH, cap / 2);
  const centre = cap - 2 * D.FUEL_WING_EACH;
  D.FUEL_CENTER = centre + added;
  D.FUEL_MAX = cap + added;
  if (added > 0) D.CG_CENTER_FUEL_X = (centre * A.CG_CENTER_FUEL_X + tanks.reduce((s, t) => s + t.part.kg * t.place.x, 0)) / (centre + added);
  // The gear: the wing is that much higher over the ground (ground effect), and the tail-strike angle follows.
  const ext = d.gearExtendM;
  if (ext) {
    D.WING_HEIGHT = A.WING_HEIGHT + ext;
    D.PITCH_TAILSTRIKE_DEG = A.PITCH_TAILSTRIKE_DEG + (tailAngle(geo) - tailAngle(G0)) / DEG;
  }
  // The drag the parts add, as areas (CD × frontal area, m²) where they are: every nacelle, less the base's two where
  // they were (in its CD0), and every external tank. sim.js applies them against the airflow, with their moments.
  const drag = [];
  if (!baseEngines(T, d)) {
    geo.NACELLES.forEach((n) => drag.push({ x: n.x, y: n.y, z: n.z, cda: CD_NACELLE * Math.PI * n.D * n.D / 4 }));
    for (const n of G0.NACELLES) drag.push({ x: n.x, y: n.y, z: n.z, cda: -CD_NACELLE * Math.PI * G0.NACELLE_DIAMETER * G0.NACELLE_DIAMETER / 4 });
  }
  for (const t of geo.PODS) drag.push({ x: t.x, y: t.y, z: t.z, cda: CD_TANK * Math.PI * t.D * t.D / 4 });
  D.DRAG_PARTS = drag.length ? Object.freeze(drag.map((p) => Object.freeze(p))) : undefined;
  D.DRAG_ADDED_M2 = drag.reduce((s, p) => s + p.cda, 0);
  // The pylons' limits, engine by engine: 1.5 × the engine type's rated take-off thrust (CS-25's ultimate factor) is
  // the least a pylon holds; as built each has its own margin over it, 0 to 10 %, fixed by the design's parts (not
  // its id or name: a copy behaves as the original) and the engine's place, so pylons don't all fail in the same
  // instant: past its limit the weakest goes first.
  // (A design v0.5.0 could have made keys them as v0.5.0 did, so its pylons are what they were.)
  const v1 = v1Shape(d);
  const partsKey = v1 ? JSON.stringify([d.base, v1.engine, v1.count, v1.stations, v1.thrustScale, d.oewDeltaKg, d.fuelCapacityKg, d.gearExtendM])
    : JSON.stringify([d.base, d.oewDeltaKg, d.fuelCapacityKg, d.gearExtendM, d.parts.map(({ id, pair, ...p }) => p)]);
  D.PYLON_LIMITS_N = engines.map((e, i) => pylonLimitN(e.E) * (1 + 0.10 * scatter(partsKey, i)));
  D.ENGINE_MASSES = engines.map((e) => e.E.installedKg);
  D.ENGINE_MASS_KG = first ? first.E.installedKg : 0;
  D.DESIGN = true;
  return D;
}
// The design as v0.5.0 would have had it (engine, count, stations, thrustScale), if it could: wing pairs and at most one
// tail engine, all one type at one thrust, untouched, and no other parts. Else null.
function v1Shape(d) {
  if (d.parts.some((p) => p.kind !== 'engine')) return null;
  const E = engineParts(d);
  if (!E.length) return null;
  const e0 = E[0];
  if (E.some((p) => p.engine !== e0.engine || p.thrust !== e0.thrust || p.dx || p.dz || p.yaw || p.pitch || (p.mount !== 'wing' && p.mount !== 'tail'))) return null;
  const tails = E.filter((p) => p.mount === 'tail'), left = E.filter((p) => p.mount === 'wing' && p.side > 0), right = E.filter((p) => p.mount === 'wing' && p.side < 0);
  if (tails.length > 1 || left.length !== right.length) return null;
  const stations = left.map((p) => p.s).sort((a, b) => a - b);
  if (right.map((p) => p.s).sort((a, b) => a - b).some((s, i) => s !== stations[i])) return null;
  const count = 2 * stations.length + tails.length;
  if (!COUNTS.includes(count) || (count === 3) !== (tails.length === 1)) return null;
  return { engine: e0.engine, count, stations, thrustScale: e0.thrust };
}
// A number in [0, 1) from a string and an index, the same everywhere (integer arithmetic only).
function scatter(str, i) {
  let h = 2166136261;
  for (let k = 0; k < str.length; k++) h = Math.imul(h ^ str.charCodeAt(k), 16777619);
  h = (h + Math.imul(i + 1, 0x9e3779b9)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// The angle at which the tail-strike point touches, pivoting on the main wheels (rad).
function tailAngle(G) {
  const m = G.GEAR.left, t = G.TAIL_STRIKE_POINT;
  return Math.atan2(t.z - m.z, m.x - t.x);
}

// The design's parts placed: engines in the sim's order, tanks, ballast.
function placeParts(d) {
  const engines = orderEngines(engineParts(d).map((p) => ({ part: p, ...placeEngine(d.base, p) })));
  const tanks = d.parts.filter((p) => p.kind === 'tank').map((p) => ({ part: p, place: placeTank(d.base, p) }));
  const ballast = d.parts.filter((p) => p.kind === 'ballast').map((p) => ({ part: p, place: placeBallast(d.base, p) }));
  return { engines, tanks, ballast };
}

const keyOf = (d) => JSON.stringify([d.id, d.base, d.oewDeltaKg, d.fuelCapacityKg, d.gearExtendM, d.parts, d.name, d.registration]);
const memo = new Map();
export function designDef(design) {
  const d = normalizeDesign(design);
  const key = keyOf(d);
  let def = memo.get(key);
  if (def) return def;
  const T = TYPES[d.base];
  const { engines, tanks, ballast } = placeParts(d);
  const geo = buildGeo(T, d, engines, tanks);
  const data = buildData(T, d, engines, tanks, ballast, geo);
  const massRatio = (data.OEW + T.defaults.pax * T.limits.PAX_KG) / (T.data.OEW + T.defaults.pax * T.limits.PAX_KG);
  // The fuel per mile: the mass, the engines' thrust-weighted TSFC, and the drag the parts add against the base's CD0.
  const tT = engines.reduce((s, e) => s + e.E.data.T0_ENGINE * e.part.thrust, 0) || 1;
  const tsfc = engines.reduce((s, e) => s + e.E.data.TSFC_C0 * e.E.data.T0_ENGINE * e.part.thrust, 0) / tT;
  const tsfcRatio = engines.length ? tsfc / T.data.TSFC_C0 : 1;
  const dragRatio = 1 + 0.5 * data.DRAG_ADDED_M2 / (T.data.CD0 * T.data.S);
  const E = engines[0]?.E || baseEngine(T.id);
  const types = [...new Set(engines.map((e) => e.E.short))];
  def = Object.freeze({
    ...T, base: T, design: Object.freeze({ ...d, parts: Object.freeze(d.parts.map((p) => Object.freeze({ ...p }))) }), key,
    name: d.name, registration: d.registration, engine: E, engineCount: engines.length,
    engineName: engines.length ? `${engines.length} × ${types.join(' + ')}` : 'no engines', data: Object.freeze(data), geo: Object.freeze(geo),
    sound: SOUNDS[E.id], limits: { ...T.limits, OEW: data.OEW, FUEL_MAX: data.FUEL_MAX },
    // Mixed engine types: each engine's own voice (src/audio/synth.js; null: the LEAP-1A's, the synth's default).
    sounds: types.length > 1 ? Object.freeze(engines.map((e) => SOUNDS[e.E.id] || null)) : undefined,
    fuel: { ...T.fuel, perNm: T.fuel.perNm * massRatio * tsfcRatio * dragRatio },
  });
  if (memo.size > 64) memo.clear();
  memo.set(key, def);
  return def;
}
export const resolveDef = (x) => (isDesign(x) ? designDef(x) : typeById(x));

// ---- the warehouse's numbers ----
// Each engine's ground clearance at rest (the nacelle's lowest point over the ground) and at the tail-strike attitude
// (pitched up about the main wheels until the tail touches); each pylon's load at full thrust (sea level, standing)
// against its limit; thrust to weight at MTOW; the range; the thrust's sideways offset from the centreline; the CG's
// move against the base's at the same load; nacelles and tanks that overlap.
export function designNumbers(def) {
  const A = def.data, G = def.geo, L = def.limits, F = def.fuel;
  const ED = A.ENGINE_DATA, n = G.ENGINES.length;
  const T0 = (i) => (ED ? ED[i].T0_ENGINE : A.T0_ENGINE);
  let total = 0, ty = 0;
  for (let i = 0; i < n; i++) { total += T0(i); ty += T0(i) * G.ENGINES[i].y; }
  const tw = total / (L.MTOW * 9.80665);
  const pax = def.defaults?.pax ?? 0, payload = Math.min(pax * L.PAX_KG + (def.defaults?.cargoKg ?? 0), Math.max(0, L.MZFW - A.OEW));
  const fuel = Math.max(0, Math.min(A.FUEL_MAX, L.MTOW - A.OEW - payload));
  const rangeNm = Math.max(0, (fuel - F.climbKg - F.holdKg - F.taxiKg) / F.perNm);
  const ta = tailAngle(G);
  const m = G.GEAR.left;
  const clearOf = (zLow, x, tail) => {
    const rest = zLow + G.GROUND_Z;
    const rx = x - m.x, rz = zLow - m.z;
    return { rest, pitched: tail ? Infinity : rz * Math.cos(ta) + rx * Math.sin(ta) };
  };
  const engines = G.NACELLES.map((nc, i) => {
    const c = clearOf(nc.z - nc.D / 2, nc.x, !!nc.tail);
    const thrust = T0(i);
    const limit = A.PYLON_LIMITS_N ? A.PYLON_LIMITS_N[i] : 1.5 * thrust;
    return { i, x: nc.x, y: nc.y, z: nc.z, D: nc.D, L: nc.L, mount: nc.mount || 'wing', tail: !!nc.tail, engine: nc.engine, part: nc.part,
      clearRestM: c.rest, clearTailStrikeM: c.pitched, loadN: thrust, limitN: limit, pylonFrac: thrust / limit };
  });
  const pods = (G.PODS || []).map((t) => { const c = clearOf(t.z - t.D / 2, t.x, false); return { ...t, clearRestM: c.rest, clearTailStrikeM: c.pitched }; });
  // Overlaps: any two nacelles or tanks whose boxes meet.
  const boxes = [...engines, ...pods];
  let overlap = false;
  for (let i = 0; i < boxes.length && !overlap; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (Math.abs(a.x - b.x) < (a.L + b.L) / 2 - 0.2 && Math.abs(a.y - b.y) < (a.D + b.D) / 2 && Math.abs(a.z - b.z) < (a.D + b.D) / 2) { overlap = true; break; }
  }
  // The CG at the base's default load and full tanks (as MTOW allows), against the base type's at its own: in % of the MAC.
  const cgAt = (D, fuelKg, load) => {
    const wing = Math.min(fuelKg, 2 * D.FUEL_WING_EACH), centre = fuelKg - wing;
    const mass = D.OEW + load + fuelKg;
    return (D.OEW * D.CG_OEW_X + load * D.CG_PAYLOAD_X + wing * D.CG_WING_FUEL_X + centre * D.CG_CENTER_FUEL_X) / mass;
  };
  const B = def.base?.data || A;
  const basePayload = Math.min(pax * L.PAX_KG + (def.defaults?.cargoKg ?? 0), Math.max(0, L.MZFW - B.OEW));
  const baseFuel = Math.max(0, Math.min(B.FUEL_MAX, L.MTOW - B.OEW - basePayload));
  const cgX = cgAt(A, fuel, payload);
  const cgShiftMac = (cgX - cgAt(B, baseFuel, basePayload)) / A.MAC;
  return {
    overlap,
    oewKg: A.OEW, mtowKg: L.MTOW, fuelCapacityKg: A.FUEL_MAX, thrustToWeight: tw, rangeNm, payloadKg: payload,
    payloadMaxKg: Math.max(0, L.MZFW - A.OEW), tailStrikeDeg: ta / DEG, engines, pods,
    engineCount: n, thrustOffsetM: total > 0 ? ty / total : 0, cgShiftMac, dragAddedM2: A.DRAG_ADDED_M2 || 0, cgX,
  };
}
