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

import { TYPES, typeById, kitFor } from './types.js';
import { ENGINE_TYPES, SCALED_KEYS, engineOfType, pylonLimitN } from './engine-types.js';
import { GENX_1B, GE90_115B } from '../audio/engine-sounds.js';
import { partsModel, partsInto, partsDeltaInto, baseShape } from './parts-aero.js';
import { airframeMap } from './airframe-map.js';

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
// v0.5.3, the airframe: the base's wing (each side), tailplane, fin and fuselage, changed (src/sim/parts-aero.js makes
// their aerodynamics; designDef() their geometry, mass and fuel). span, chord: × the base's (the exposed span from the
// fuselage's side, the chord at every station); sweep: degrees added to the quarter chord's; dihedral: degrees, absolute;
// tail, fin: × the base's areas (aspect ratio and sweep kept); plugFwd, plugAft: metres of fuselage ahead of and behind
// the wing; mirror: the two wing panels kept the same (the warehouse's default; off, each side is its own).
export const AIRFRAME_RANGES = {
  span: [0.8, 1.3], chord: [0.8, 1.3], sweep: [-8, 8], dihedral: [-3, 8], tail: [0.6, 1.6], fin: [0.6, 1.6], plugFwd: [-4, 6], plugAft: [-4, 6],
};
const WING_KEYS = ['span', 'chord', 'sweep', 'dihedral'];
const STEP = { span: 0.01, chord: 0.01, sweep: 0.1, dihedral: 0.1, tail: 0.01, fin: 0.01, plugFwd: 0.05, plugAft: 0.05 };
const snap = (k, v) => { const q = STEP[k]; return +(Math.round(v / q) * q).toFixed(q < 0.1 ? 2 : 1); };
const baseDihedral = (base) => typeById(base).geo.WING.dihedralDeg;
// v0.5.3 (the run's extra time): the bases whose wingtip devices can come off: the A321's sharklets (`sharklets`, on by
// default; the Boeings' raked tips are their wing's planform, so they have no such switch).
export const HAS_SHARKLETS = (base) => typeById(base).id === 'a321neo';
export function defaultAirframe(base) {
  const w = { span: 1, chord: 1, sweep: 0, dihedral: baseDihedral(base) };
  return { wingL: { ...w }, wingR: { ...w }, mirror: true, tail: 1, fin: 1, plugFwd: 0, plugAft: 0, ...(HAS_SHARKLETS(base) ? { sharklets: true } : {}) };
}
function fixSide(w, base) {
  const d = { span: 1, chord: 1, sweep: 0, dihedral: baseDihedral(base) }, R = AIRFRAME_RANGES, o = {};
  for (const k of WING_KEYS) {
    const v = num(w?.[k], d[k]);
    // the base's own dihedral is kept to the bit (it needn't sit on the slider's step)
    o[k] = v === d[k] ? v : snap(k, clamp(v, ...R[k]));
  }
  return o;
}
export function fixAirframe(af, base) {
  if (!af || typeof af !== 'object') return defaultAirframe(base);
  const R = AIRFRAME_RANGES;
  const mirror = af.mirror !== false;
  const wingL = fixSide(af.wingL, base);
  const wingR = mirror ? { ...wingL } : fixSide(af.wingR ?? af.wingL, base);
  const one = (k, d) => { const v = num(af[k], d); return v === d ? d : snap(k, clamp(v, ...R[k])); };
  return { wingL, wingR, mirror, tail: one('tail', 1), fin: one('fin', 1), plugFwd: one('plugFwd', 0), plugAft: one('plugAft', 0),
    ...(HAS_SHARKLETS(base) ? { sharklets: af.sharklets !== false } : {}) };
}
// Is the airframe the base's own? Then the design flies the base's lumped model alone (to the bit).
export function isBaseAirframe(af, base) {
  if (!af) return true;
  const d = defaultAirframe(base);
  return af.tail === 1 && af.fin === 1 && af.plugFwd === 0 && af.plugAft === 0 && af.sharklets !== false
    && WING_KEYS.every((k) => af.wingL[k] === d.wingL[k] && af.wingR[k] === d.wingR[k]);
}
// The parts' model's airframe (src/sim/parts-aero.js's shapeOf()).
const aeroAirframe = (af) => ({ wingL: af.wingL, wingR: af.wingR, tail: af.tail, fin: af.fin, plugFwd: af.plugFwd, plugAft: af.plugAft,
  ...(af.sharklets === false ? { sharklets: false } : {}) });
// A sharklet with its tip's reinforcement [EST]: Airbus doesn't publish it; about 200 kg is the figure usually given.
const SHARKLET_KG = 200;

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
export function airframe(base, af = null) {
  if (af && typeof af === 'object' && !isBaseAirframe(af, typeById(base).id)) return designSketch(typeById(base).id, af);
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
  a = { T, G, W, ys, tipY, chord, leX, lower, upper, tailCone, finLe, rootTe: W.rootX - W.rootChord, tipYs: [tipY, tipY] };
  AIRFRAMES.set(base, a);
  return a;
}
// v0.5.3: the same sketch for a design's airframe, through its map (src/sim/airframe-map.js): each function takes the
// side as a second argument (1 left, the default; −1 right), since the two wing panels may differ.
const SKETCHES = new Map();
function designSketch(base, af) {
  const key = base + JSON.stringify(af);
  let a = SKETCHES.get(key);
  if (a) return a;
  const a0 = airframe(base), M = airframeMap(base, af);
  const yb = (y, side) => M.wingBase(side || 1, Math.abs(y));
  const pt = (side, x, y, z) => M.wing(side || 1, x, Math.abs(y), z);
  const w = (side) => ((side || 1) > 0 ? af.wingL : af.wingR);
  const chord = (y, side = 1) => a0.chord(yb(y, side)) * w(side).chord;
  const leX = (y, side = 1) => { const b = yb(y, side); return pt(side, a0.leX(b), b, a0.lower(b))[0]; };
  // the heights at the pylons' chord station (30 % back), where the mounts meet the wing
  const lower = (y, side = 1) => { const b = yb(y, side); return pt(side, a0.leX(b) - 0.3 * a0.chord(b), b, a0.lower(b))[2]; };
  const upper = (y, side = 1) => { const b = yb(y, side); return pt(side, a0.leX(b) - 0.55 * a0.chord(b), b, a0.upper(b))[2]; };
  const tipYs = M.tipY.slice();
  const finLe = M.fin(a0.finLe, 0, a0.G.FUSELAGE_HEIGHT / 2)[0];
  const rootTe = pt(1, a0.rootTe, a0.ys, a0.lower(a0.ys))[0];
  a = { ...a0, chord, leX, lower, upper, tipY: Math.min(...tipYs), tipYs, tailCone: a0.tailCone - af.plugAft, finLe, rootTe, map: M, noseGearX: M.bodyX(a0.G.GEAR.nose.x) };
  if (SKETCHES.size > 64) SKETCHES.clear();
  SKETCHES.set(key, a);
  return a;
}
// The design's mount sketch (a type entry from designDef(), or a design).
export function designAirframe(x) {
  const d = x?.design || x;
  return d && d.base ? airframe(d.base, d.airframe) : airframe(x?.id || 'a321neo');
}

// The stations a wing engine's pair may take (v0.5.0's): outboard of the fuselage's side by a nacelle's width, clear
// of the main gear's leg by half a nacelle and 0.3 m, to 70 % of the semi-span.
export function stationRange(base, engineId, af = null, side = 1) {
  const G = typeById(base).geo, E = ENGINE_TYPES[engineId] || engineOfType(base);
  const D = E.nacelle.D;
  let lo = G.FUSELAGE_WIDTH / 2 + D;
  const gearY = G.GEAR.left.y, clear = D / 2 + 0.3;
  if (lo < gearY + clear && lo > gearY - clear) lo = gearY + clear;
  // v0.5.3: to 70 % of the design's semi-span on that side
  const tip = af && typeof af === 'object' ? airframe(base, af).tipYs[side < 0 ? 1 : 0] : G.SPAN / 2;
  const hi = 0.7 * tip;
  return [lo, Math.max(lo, hi)];
}

// Each mount's station range (s or x) for a part.
export function mountRange(base, p, af = null) {
  const a = airframe(base, af), G = a.G, tipS = a.tipYs[(p.side || 1) < 0 ? 1 : 0];
  if (p.kind === 'engine') {
    const E = ENGINE_TYPES[p.engine] || engineOfType(base), D = E.nacelle.D, L = E.nacelle.L;
    if (p.mount === 'wing') { const [lo, hi] = stationRange(base, E.id, af, p.side || 1); return { lo, hi, key: 's' }; }
    if (p.mount === 'overwing') return { lo: a.ys + D / 2 + 0.6, hi: Math.max(a.ys + D / 2 + 0.6, 0.7 * tipS), key: 's' };
    if (p.mount === 'body') {
      const hi = a.rootTe - L / 2 - 0.5, lo = Math.min(hi, a.tailCone - 1.5);
      return { lo, hi, key: 'x' };
    }
    return { lo: 0, hi: 0, key: null };   // tail: on the fin's root
  }
  if (p.kind === 'tank' && p.mount === 'wing') return { lo: a.ys + 1.5, hi: 0.75 * tipS, key: 's' };
  // In the hold: between the tail cone and the nose gear's bay.
  const lo = a.tailCone + 2, hi = Math.max(lo, (a.noseGearX ?? G.GEAR.nose.x) - 3);
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
export function placeEngine(base, p, af = null) {
  const a = airframe(base, af), G = a.G, E = ENGINE_TYPES[p.engine] || engineOfType(base), D = E.nacelle.D, L = E.nacelle.L;
  let nacelle, thrust;
  if (p.mount === 'tail') ({ nacelle, thrust } = tailEngine(G, E, a.finLe));
  else if (p.mount === 'wing' && a.map) {
    // v0.5.3: on a changed wing, the base's placement at the base's station, carried with the wing where its pylon
    // meets it (the nacelle keeps its size and its hang below the pylon)
    const side = p.side || 1, a0 = airframe(base), yb = a.map.wingBase(side, p.s);
    ({ nacelle, thrust } = wingEngine(G, E, yb, side));
    const xa = a0.leX(yb) - 0.3 * a0.chord(yb), za = a0.lower(yb);
    const [xn, , zn] = a.map.wing(side, xa, yb, za);
    nacelle = { ...nacelle, x: nacelle.x + xn - xa, y: side * p.s, z: nacelle.z + zn - za };
    thrust = { ...thrust, x: thrust.x + xn - xa, y: side * p.s, z: thrust.z + zn - za };
  } else if (p.mount === 'wing') ({ nacelle, thrust } = wingEngine(G, E, p.s, p.side));
  else if (p.mount === 'overwing') {
    const y = p.s, sd = p.side || 1, x = a.leX(y, sd) - 0.55 * a.chord(y, sd), z = a.upper(y, sd) + 0.65 + D / 2;
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
export function placeTank(base, p, af = null) {
  const a = airframe(base, af), G = a.G, vol = p.kg / FUEL_DENSITY;
  if (p.mount === 'hold') return { x: p.x, y: 0, z: -0.28 * G.FUSELAGE_HEIGHT, D: 0, L: 0, hold: true };
  const D = Math.cbrt(vol / (0.75 * Math.PI)), L = 4 * D, y = p.s, sd = p.side || 1;
  return { x: a.leX(y, sd) - 0.3 * a.chord(y, sd) + (p.dx || 0), y: p.side * y, z: a.lower(y, sd) - 0.45 - D / 2, D, L };
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
function fixPart(p, base, id, af = null) {
  const kind = KINDS.includes(p.kind) ? p.kind : 'engine';
  const out = { id: String(p.id || id).slice(0, 12), kind };
  if (kind === 'engine') {
    out.engine = ENGINE_TYPES[p.engine] ? p.engine : baseEngine(base).id;
    out.mount = ENGINE_MOUNTS.includes(p.mount) ? p.mount : 'wing';
    out.side = out.mount === 'tail' ? 0 : (+p.side < 0 ? -1 : 1);
    const R = mountRange(base, out, af);
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
    const R = mountRange(base, out, af);
    out.s = out.mount === 'wing' ? clamp(num(p.s, R.lo), R.lo, R.hi) : 0;
    out.x = out.mount === 'hold' ? clamp(num(p.x, (R.lo + R.hi) / 2), R.lo, R.hi) : 0;
    out.dx = out.mount === 'wing' ? r2(clamp(num(p.dx, 0), ...RANGES.dx)) : 0;
    const K = out.mount === 'hold' ? RANGES.holdKg : RANGES.tankKg;
    out.kg = Math.round(clamp(num(p.kg, K[0] * 2), ...K));
  } else {
    const R = mountRange(base, { kind: 'ballast' }, af);
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
  const af = fixAirframe(d.airframe, base);   // v0.5.3: the parts are clamped to the design's airframe
  const seen = new Set();
  const parts = [];
  let engines = 0;
  raw.slice(0, MAX_PARTS * 2).forEach((p, i) => {
    if (!p || typeof p !== 'object' || parts.length >= MAX_PARTS) return;
    let q = fixPart(p, base, `p${i + 1}`, af);
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
    airframe: af,   // v0.5.3 (a v2 design without it is its base's airframe)
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
  const p = fixPart({ ...part, id: id() }, d.base, 'p0', d.airframe);
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
    if (fixPart(p, d.base, p.id, d.airframe).side === 0) { parts = parts.filter((q) => q !== t); p.pair = null; }
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
  if (!isBaseAirframe(d.airframe, T.id)) return false;   // v0.5.3: on a changed wing they move with it
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

// The airframe's geometry: geo.AIRFRAME (the map) and the points that move with it, in place on buildGeo()'s copy.
function applyAirframeGeo(geo, M, G0) {
  const bx = M.bodyX;
  const mv = (p) => ({ ...p, x: bx(p.x) });
  geo.AIRFRAME = M;
  geo.EYES = Object.fromEntries(Object.entries(geo.EYES).map(([k, e]) => [k, mv(e)]));
  geo.GEAR = { ...geo.GEAR, nose: mv(geo.GEAR.nose) };
  geo.TAIL_STRIKE_POINT = mv(geo.TAIL_STRIKE_POINT);
  geo.CRASH_POINTS = geo.CRASH_POINTS.map((c) => {
    if (c.why === 'wingtip strike') {
      // the sharklets off (v0.5.3, extra time): the tip is the wing's own, not the sharklet's foot
      const st = baseShape(M.base).wing.stations, yb = M.af?.sharklets === false ? Math.sign(c.y) * Math.min(Math.abs(c.y), st[st.length - 1].y) : c.y;
      const [x, y, z] = M.wing(c.y > 0 ? 1 : -1, c.x, yb, c.z); return { ...c, x, y, z };
    }
    if (c.why === 'engine strike' || c.why === 'tank strike') return c;   // placed on the design's airframe already
    return mv(c);
  });
  const noseX = bx(G0.NOSE_X), tailX = bx(G0.FUSELAGE_TAIL_X ?? G0.TAIL_X) - 0;
  geo.DESIGN_SHAPE = { spanM: M.span, lengthM: G0.LENGTH + M.plugFwd + M.plugAft, noseX, tailX: bx(G0.TAIL_X), tipY: M.tipY };
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
  // v0.5.3: the airframe's structure, each part's change against the base's where it is (airframeMasses()).
  const afm = isBaseAirframe(d.airframe, d.base) ? null : airframeMasses(T, d.airframe);
  if (afm) pm.push(...afm.pm);
  const cg0 = A.CG_OEW_X;
  let dm = 0, dmx = 0;
  for (const p of pm) { dm += p.m; dmx += p.m * (p.x - cg0); }
  const oew = A.OEW + d.oewDeltaKg + dm;
  D.OEW = oew;
  // The structural limits stay the base's: the payload is what MZFW leaves over this OEW.
  D.MAX_PAYLOAD = Math.max(0, T.limits.MZFW - oew);
  D.CG_OEW_X = dmx === 0 ? cg0 : cg0 + dmx / oew;
  // v0.5.3: how far the airframe's own structure moved the empty CG (sim.js's take-off trim takes it out; the other
  // parts' moves, ballast and engines, stay in it, as on the base's airframe)
  if (afm) {
    let m2 = 0, mx2 = 0;
    for (const p of pm) if (!afm.pm.includes(p)) { m2 += p.m; mx2 += p.m * (p.x - cg0); }
    const oew2 = A.OEW + d.oewDeltaKg + m2;
    D.AIRFRAME_CG_SHIFT = D.CG_OEW_X - (mx2 === 0 ? cg0 : cg0 + mx2 / oew2);
  }
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
  // v0.5.3: the wing's tanks hold what the wing's volume does (each side's span × chord², the thickness with the chord),
  // added to the capacity; their fuel's centre moves with the wing, and its roll and yaw inertia with the span².
  const fw = afm ? afm.fuel : 1;
  const cap = d.fuelCapacityKg + 2 * A.FUEL_WING_EACH * (fw - 1), added = tanks.reduce((s, t) => s + t.part.kg, 0);
  D.FUEL_WING_EACH = Math.min(A.FUEL_WING_EACH * fw, cap / 2);
  if (afm) {
    D.CG_WING_FUEL_X = A.CG_WING_FUEL_X + afm.fuelDx;
    D.IXX_WING_FUEL_R2 = A.IXX_WING_FUEL_R2 * afm.fuelR2; D.IZZ_WING_FUEL_R2 = A.IZZ_WING_FUEL_R2 * afm.fuelR2;
  }
  const centre = cap - 2 * D.FUEL_WING_EACH;
  D.FUEL_CENTER = centre + added;
  D.FUEL_MAX = cap + added;
  if (added > 0) D.CG_CENTER_FUEL_X = (centre * A.CG_CENTER_FUEL_X + tanks.reduce((s, t) => s + t.part.kg * t.place.x, 0)) / (centre + added);
  // The gear: the wing is that much higher over the ground (ground effect), and the tail-strike angle follows.
  const ext = d.gearExtendM;
  if (ext) D.WING_HEIGHT = A.WING_HEIGHT + ext;
  // the tail-strike angle with the longer legs and the aft plug (v0.5.3)
  if (ext || afm) D.PITCH_TAILSTRIKE_DEG = A.PITCH_TAILSTRIKE_DEG + (tailAngle(geo) - tailAngle(G0)) / DEG;
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
// v0.5.3: the airframe's structure weights [EST], as fractions of the base's OEW (transport-aircraft statistics, e.g.
// Roskam's and Raymer's group weights: the wing 10 to 12 % of MTOW, about 22 % of an airliner's OEW; the tailplane and
// the fin 2 to 3 % together; the fuselage with its furnishings and systems about 30 %, spread along its length), and
// how each part's scales: the wing's per side with span^1.15 · chord^0.15 / cos Λ (Raymer's transport wing: S^0.65 ·
// A^0.5 / cos Λ), the tails' with their areas^0.75, the plugs' per metre; the cockpit and the nose gear (2 % [EST])
// move with the forward plug, the APU and the tail cone's systems (0.5 % [EST]) with the aft plug. Each part's mass
// sits at its strips' centroid (src/sim/parts-aero.js), so the CG and the inertias follow where it is.
const STRUCT = { wing: 0.22, tail: 0.022, fin: 0.016, fuselage: 0.30, nose: 0.02, aft: 0.005 };
function centroid(strips, side) {
  let S = 0, x = 0, y = 0, z = 0;
  for (const p of strips) if (side === undefined || p.side === side) { S += p.S; x += p.S * p.r[0]; y -= p.S * p.r[1]; z -= p.S * p.r[2]; }
  return { S, x: x / S, y: y / S, z: z / S };
}
function airframeMasses(T, af) {
  const A = T.data, G = T.geo, oew = A.OEW;
  const Pb = partsModel(T.id), Pd = partsModel(T.id, aeroAirframe(af)), M = airframeMap(T.id, af);
  const pm = [];
  const swap = (m0, c0, m1, c1) => { pm.push({ m: -m0, x: c0.x, y: c0.y, z: c0.z }, { m: m1, x: c1.x, y: c1.y, z: c1.z }); };
  const sw0 = Math.atan(Math.tan(A.SWEEP));
  let fuel = 0, fuelDx = 0, fuelR2 = 0;
  for (const [side, w] of [[1, af.wingL], [-1, af.wingR]]) {
    const c0 = centroid(Pb.wing, side), c1 = centroid(Pd.wing, side);
    const m0 = STRUCT.wing * oew / 2;
    const k = Math.pow(w.span, 1.15) * Math.pow(w.chord, 0.15) * Math.cos(sw0) / Math.cos(sw0 + w.sweep * DEG);
    swap(m0, c0, m0 * k, c1);
    fuel += 0.5 * w.span * w.chord * w.chord;
    fuelDx += 0.5 * (c1.x - c0.x);
    fuelR2 += 0.5 * (c1.y * c1.y) / (c0.y * c0.y);
  }
  // the sharklets off (v0.5.3, extra time): their mass taken from the design's wingtips
  if (af.sharklets === false) {
    const st = baseShape(T.id).wing.stations, tip = st[st.length - 1];
    for (const [side, i] of [[1, 0], [-1, 1]]) pm.push({ m: -SHARKLET_KG, x: tip.xle - tip.c / 2, y: side * M.partsTip[i], z: tip.z - 1 });
  }
  swap(STRUCT.tail * oew, centroid(Pb.tail), STRUCT.tail * oew * Math.pow(af.tail, 0.75), centroid(Pd.tail));
  swap(STRUCT.fin * oew, centroid(Pb.fin), STRUCT.fin * oew * Math.pow(af.fin, 0.75), centroid(Pd.fin));
  // the fuselage: the plugs' own mass at their middles, and what's ahead of (behind) them carried forward (back)
  const perM = STRUCT.fuselage * oew / G.LENGTH, cuts = M.cuts, f = af.plugFwd, b = af.plugAft;
  const noseX = G.NOSE_X, tailX = G.NOSE_X - G.LENGTH;
  if (f) {
    pm.push({ m: perM * f, x: cuts.fwd + f / 2, y: 0, z: 0 });
    const mf = perM * (noseX - cuts.fwd) + STRUCT.nose * oew, xf = (perM * (noseX - cuts.fwd) * (noseX + cuts.fwd) / 2 + STRUCT.nose * oew * (noseX - 3)) / mf;
    swap(mf, { x: xf, y: 0, z: 0 }, mf, { x: xf + f, y: 0, z: 0 });
  }
  if (b) {
    pm.push({ m: perM * b, x: cuts.aft - b / 2, y: 0, z: 0 });
    const ma = perM * (cuts.aft - tailX) + STRUCT.aft * oew, xa = (perM * (cuts.aft - tailX) * (cuts.aft + tailX) / 2 + STRUCT.aft * oew * (tailX + 3)) / ma;
    swap(ma, { x: xa, y: 0, z: 0 }, ma, { x: xa - b, y: 0, z: 0 });
  }
  return { pm, fuel, fuelDx, fuelR2 };
}

// The angle at which the tail-strike point touches, pivoting on the main wheels (rad).
function tailAngle(G) {
  const m = G.GEAR.left, t = G.TAIL_STRIKE_POINT;
  return Math.atan2(t.z - m.z, m.x - t.x);
}

// The design's parts placed: engines in the sim's order, tanks, ballast.
function placeParts(d) {
  const af = isBaseAirframe(d.airframe, d.base) ? null : d.airframe;
  const engines = orderEngines(engineParts(d).map((p) => ({ part: p, ...placeEngine(d.base, p, af) })));
  const tanks = d.parts.filter((p) => p.kind === 'tank').map((p) => ({ part: p, place: placeTank(d.base, p, af) }));
  const ballast = d.parts.filter((p) => p.kind === 'ballast').map((p) => ({ part: p, place: placeBallast(d.base, p) }));
  return { engines, tanks, ballast };
}

const keyOf = (d) => JSON.stringify([d.id, d.base, d.oewDeltaKg, d.fuelCapacityKg, d.gearExtendM, d.parts, d.name, d.registration, d.airframe]);
const memo = new Map();
export function designDef(design) {
  const d = normalizeDesign(design);
  const key = keyOf(d);
  let def = memo.get(key);
  if (def) return def;
  const T = TYPES[d.base];
  const { engines, tanks, ballast } = placeParts(d);
  const geo = buildGeo(T, d, engines, tanks);
  // v0.5.3: a changed airframe moves what sits on it: the cockpit and the nose gear with the forward plug, the tail
  // and its strike point with the aft plug, the wingtips with the wing. The shape constants (WING, NOSE_X, TAILPLANE,
  // FIN, LENGTH, SPAN…) stay the base's: the models build the base's shapes through geo.AIRFRAME (src/sim/airframe-map.js).
  if (!isBaseAirframe(d.airframe, d.base)) applyAirframeGeo(geo, airframeMap(d.base, d.airframe), T.geo);
  const data = buildData(T, d, engines, tanks, ballast, geo);
  // v0.5.3: the airframe's aerodynamics from its parts, against the base's (sim.js adds the difference to the lumped
  // model). A design on its base's airframe doesn't carry them, and flies the base's numbers exactly.
  if (!isBaseAirframe(d.airframe, d.base)) {
    data.PARTS_AERO = Object.freeze({ design: partsModel(d.base, aeroAirframe(d.airframe)), base: partsModel(d.base) });
    // Part 3: the control laws' gains scaled by the design's control power per inertia against the base's (exactly 1
    // when absent: the types and base-airframe designs).
    data.GAIN_SCALE = Object.freeze(gainScale(T, data));
  }
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
    // v0.5.3: the landing score's touchdown-pitch band, its top moved down by how much sooner the design's tail strikes
    // (a stretched body, longer legs move it up never: the base's band is the most it allows)
    ...(T.score && data.PITCH_TAILSTRIKE_DEG < T.data.PITCH_TAILSTRIKE_DEG ? { score: scoreBand(T.score, T.data.PITCH_TAILSTRIKE_DEG - data.PITCH_TAILSTRIKE_DEG) } : {}),
  });
  if (memo.size > 64) memo.clear();
  memo.set(key, def);
  return def;
}
// ---- v0.5.3, the airframe's checks (the warehouse's readout) ----
// The static margin from the parts' neutral point against the CG at the default load (fraction of MAC: −Cmα/CLα
// about 25 % MAC at the clean 250 kt point, plus the CG's distance ahead of 25 % MAC); Cnβ about that CG; the 1 g
// stall at MLW in the landing flaps (KCAS, sea level) and the approach speed (1.23 VS1g + 5 kt); the tail-strike
// angle; the span and its ICAO code letter against the stand's (the base's). Each against the base type's own.
const CODE_LETTERS = [[15, 'A'], [24, 'B'], [36, 'C'], [52, 'D'], [65, 'E'], [80, 'F']];
export const codeLetter = (span) => (CODE_LETTERS.find(([m]) => span < m) || [0, 'F+'])[1];
function coeffsOf(def, s) {
  const o = {};
  kitFor(def).fm.coefficients(s, o);
  if (def.data.PARTS_AERO) partsDeltaInto(def.data.PARTS_AERO, s, o);
  return o;
}
function stabilityOf(def, cgX) {
  const A = def.data, s = { ...PT_REF };
  const d = (k, f, h) => (coeffsOf(def, { ...s, [k]: s[k] + h })[f] - coeffsOf(def, { ...s, [k]: s[k] - h })[f]) / (2 * h);
  const cla = d('alpha', 'CL', 0.005), cma = d('alpha', 'Cm', 0.005), cnb = d('beta', 'Cn', 0.01), cyb = d('beta', 'CY', 0.01);
  const land = A.CONFIGS[A.CONFIG_FULL];
  const sl = { ...PT_REF, M: 0.2, slat: land.slat, flap: land.flap, gear: 1 };
  const clmax = coeffsOf(def, sl).clmax;
  const vs = Math.sqrt(2 * def.limits.MLW * 9.80665 / (1.225 * A.S * clmax)) / 0.514444;
  return { sm: -cma / cla + cgX / A.MAC, cnb: cnb - cgX * cyb / A.SPAN, vs };
}
function noseShare(def, cgX) {
  const G = def.geo, xm = G.GEAR.left.x, xn = G.GEAR.nose.x;
  return (cgX - xm) / (xn - xm);
}
// The same with full take-off thrust on the brakes' release, at a mass: the engines' thrust below the CG (the sim's CG
// is on the centreline) and the acceleration's inertia at the CG pitch the nose up by T · (CG height − thrust line) over
// the weight times the wheelbase. (A stretched 787 at 0.3 % empty sat back on its tail at 25 kt: this catches it.)
function noseShareThrust(def, cgX, mass) {
  const G = def.geo, A = def.data, xm = G.GEAR.left.x, xn = G.GEAR.nose.x, ED = A.ENGINE_DATA;
  let T = 0, Tz = 0;
  G.ENGINES.forEach((e, i) => { const t = ED ? ED[i].T0_ENGINE : A.T0_ENGINE; T += t; Tz += t * e.z; });
  const zT = T > 0 ? Tz / T : 0;
  return noseShare(def, cgX) - T * Math.max(0, -zT) / (mass * 9.80665 * (xn - xm));
}
const payloadOf = (def) => { const B = def.base || def, L = B.limits; return Math.min((B.defaults?.pax ?? 0) * L.PAX_KG + (B.defaults?.cargoKg ?? 0), Math.max(0, L.MZFW - def.data.OEW)); };
const fuelOf = (def) => { const L = (def.base || def).limits; return Math.max(0, Math.min(def.data.FUEL_MAX, L.MTOW - def.data.OEW - payloadOf(def))); };
function airframeNumbers(def, cgX) {
  const B = def.base || def;
  const L = B.limits, pax = B.defaults?.pax ?? 0, A0 = B.data;
  const payload = Math.min(pax * L.PAX_KG + (B.defaults?.cargoKg ?? 0), Math.max(0, L.MZFW - A0.OEW));
  const fuel = Math.max(0, Math.min(A0.FUEL_MAX, L.MTOW - A0.OEW - payload));
  const wing = Math.min(fuel, 2 * A0.FUEL_WING_EACH), cgB = (A0.OEW * A0.CG_OEW_X + payload * A0.CG_PAYLOAD_X + wing * A0.CG_WING_FUEL_X + (fuel - wing) * A0.CG_CENTER_FUEL_X) / (A0.OEW + payload + fuel);
  const d = stabilityOf(def, cgX), b = def.base ? stabilityOf(B, cgB) : d;
  const span = def.geo.DESIGN_SHAPE?.spanM ?? def.geo.SPAN;
  return {
    staticMarginMac: d.sm, staticMarginBaseMac: b.sm, cnBeta: d.cnb, cnBetaBase: b.cnb,
    stallKt: d.vs, stallKtBase: b.vs, approachKt: 1.23 * d.vs + 5, approachKtBase: 1.23 * b.vs + 5,
    tailStrikeDeg: def.data.PITCH_TAILSTRIKE_DEG, tailStrikeBaseDeg: A0.PITCH_TAILSTRIKE_DEG,
    spanM: span, spanBaseM: B.geo.SPAN, codeLetter: codeLetter(span), codeLetterBase: codeLetter(B.geo.SPAN), gateLetter: B.icaoCode,
    lengthM: def.geo.DESIGN_SHAPE?.lengthM ?? B.geo.LENGTH,
    // the nose wheel's share of the weight standing (the CG between the main and nose gear), at the default load and
    // empty: below 2.5 % full thrust from engines under the wing tips it onto its tail (red: a stretched 787 at 1.9 % sat on
    // its tail at 21 kt), below 5 % the nose is light to steer (amber) [EST: airliners carry 6 to 12 % on the nose]
    noseLoad: noseShare(def, cgX), noseLoadEmpty: noseShare(def, def.data.CG_OEW_X),
    // with full take-off thrust: at the default load, and empty with a little fuel (the lightest it'll be on a runway)
    noseLoadThrust: Math.min(noseShareThrust(def, cgX, def.data.OEW + payloadOf(def) + fuelOf(def)),
      noseShareThrust(def, (def.data.OEW * def.data.CG_OEW_X + 5000 * def.data.CG_CENTER_FUEL_X) / (def.data.OEW + 5000), def.data.OEW + 5000)),
    noseLoadBase: noseShare(B, cgB),
  };
}

// ---- v0.5.3, Part 3: the control powers per inertia, the design's against the base's ----
// At the clean 250 kt, 10,000 ft point (parts-aero's validation table's anchor), the CG at 25 % MAC, a reference mass
// (OEW, the default payload, half the fuel): pitch, the elevator's Cm per rad over Iyy; roll, the ailerons' and the roll
// spoilers' full Cl over Ixx; yaw, the rudder's Cn per rad over Izz. Also each axis's damping (Cmq/Iyy, Clp/Ixx, Cnr/Izz)
// and stiffness (Cmα/Iyy, Cnβ/Izz) ratios, for laws that want them.
const PT_REF = { alpha: 0.06, beta: 0, M: 0.42, phat: 0, qhat: 0, rhat: 0, adothat: 0, slat: 0, flap: 0, gear: 0, doors: 0, sb: 0, gsp: 0, spL: 0, spR: 0, ail: 0, rud: 0, ths: 0, hWing: 3000, elev: 0 };
function inertiasOf(A, T) {
  const m = A.OEW + T.defaults.pax * T.limits.PAX_KG + 0.5 * A.FUEL_MAX;
  const wf = Math.min(0.5 * A.FUEL_MAX, 2 * A.FUEL_WING_EACH);
  const zf = m - wf;
  return {
    Ixx: A.IXX_ZFW_PER_KG * zf + A.IXX_WING_FUEL_R2 * wf + (A.DESIGN_DIXX || 0),
    Iyy: A.IYY_PER_KG * m + (A.DESIGN_DIYY || 0),
    Izz: A.IZZ_ZFW_PER_KG * zf + A.IZZ_WING_FUEL_R2 * wf + (A.DESIGN_DIZZ || 0),
  };
}
function powersOf(P, s) {
  const d = (key, field, h) => { const a = {}, b = {}; partsInto(P, { ...s, [key]: s[key] + h }, a); partsInto(P, { ...s, [key]: s[key] - h }, b); return (a[field] - b[field]) / (2 * h); };
  const o = {}; partsInto(P, s, o);
  return { elev: o.dCmElev, roll: o.dClAil, sp: o.dClSp, rud: o.dCnRud, cmq: d('qhat', 'Cm', 0.005), clp: d('phat', 'Cl', 0.005), cnr: d('rhat', 'Cn', 0.005),
    cma: d('alpha', 'Cm', 0.005), cnb: d('beta', 'Cn', 0.01), cla: d('alpha', 'CL', 0.005) };
}
export function gainScale(T, data) {
  const A0 = T.data, PA = data.PARTS_AERO;
  if (!PA) return { pitch: 1, roll: 1, yaw: 1, pitchDamp: 1, rollDamp: 1, yawDamp: 1, pitchStiff: 1, yawStiff: 1, lift: 1 };
  const pd = powersOf(PA.design, PT_REF), pb = powersOf(PA.base, PT_REF);
  const Id = inertiasOf(data, T), Ib = inertiasOf(A0, T);
  // the lumped powers plus the parts' differences, as the sim flies them
  const el = (p) => A0.CM.elevator + p.elev - pb.elev;
  const rl = (p) => A0.CL_ROLL.aileron * A0.AIL_MAX + A0.CL_ROLL.spoiler + (p.roll - pb.roll) * A0.AIL_MAX + (p.sp - pb.sp);
  const rd = (p) => A0.CN.rudder + p.rud - pb.rud;
  const r = (fd, fb, Id_, Ib_) => (fd / Id_) / (fb / Ib_);
  return {
    pitch: r(el(pd), el(pb), Id.Iyy, Ib.Iyy), roll: r(rl(pd), rl(pb), Id.Ixx, Ib.Ixx), yaw: r(rd(pd), rd(pb), Id.Izz, Ib.Izz),
    pitchDamp: r(A0.CM.q + pd.cmq - pb.cmq, A0.CM.q, Id.Iyy, Ib.Iyy), rollDamp: r(A0.CL_ROLL.p + pd.clp - pb.clp, A0.CL_ROLL.p, Id.Ixx, Ib.Ixx),
    yawDamp: r(A0.CN.r + pd.cnr - pb.cnr, A0.CN.r, Id.Izz, Ib.Izz),
    pitchStiff: r(A0.CM.alpha + pd.cma - pb.cma, A0.CM.alpha, Id.Iyy, Ib.Iyy), yawStiff: r(A0.CN.beta + pd.cnb - pb.cnb, A0.CN.beta, Id.Izz, Ib.Izz),
    lift: (A0.CLA_CLEAN + pd.cla - pb.cla) / A0.CLA_CLEAN,
  };
}

function scoreBand(sc, sooner) {
  const high = sc.high - sooner, best = Math.min(sc.best, high - 1), low = Math.min(sc.low, best - 1);
  return { ...sc, high, best, low };
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
  // v0.5.3 (the reviewer's finding 4): a nacelle or tank on or under the ground standing ends the flight the instant it
  // starts ("engine strike"): such a design can be saved and edited, but not flown (the warehouse's Fly it and New
  // scenario's Fly wait for longer gear or the parts moved up)
  const touchesGround = engines.some((e) => !e.tail && e.clearRestM <= 0) || pods.some((t) => t.clearRestM <= 0);
  return {
    airframe: airframeNumbers(def, cgX),
    touchesGround,
    overlap,
    oewKg: A.OEW, mtowKg: L.MTOW, fuelCapacityKg: A.FUEL_MAX, thrustToWeight: tw, rangeNm, payloadKg: payload,
    payloadMaxKg: Math.max(0, L.MZFW - A.OEW), tailStrikeDeg: ta / DEG, engines, pods,
    engineCount: n, thrustOffsetM: total > 0 ? ty / total : 0, cgShiftMac, dragAddedM2: A.DRAG_ADDED_M2 || 0, cgX,
  };
}
