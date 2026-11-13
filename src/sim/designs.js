// v0.5.0: designs, the warehouse's aircraft. A design is data: one plain, JSON-safe object, always made on one of the
// three types (its base), changing its engines (count, type, stations, a thrust scale), its empty weight, its fuel
// capacity and its gear's length. Everything that flies or draws an aircraft reads it through designDef(), which
// makes a type entry like src/sim/types.js's: the same id as the base (the models, cockpits and screens are the
// base's), with the design's data (src/sim/a321neo.js's names), geometry (src/geometry.js's names) and limits.
// No DOM and no three.js: the sim, the prediction worker and node tests read it.
//
// The shape (`v: 1`):
//   { v, id, name, registration, base,          // base: 'a321neo' | 'b787-9' | 'b777-300er'
//     engine,                                   // an ENGINE_TYPES id: 'leap-1a' | 'genx-1b' | 'ge90-115b'
//     count,                                    // 2, 3, 4 or 6: on the wings in pairs; 3 is a pair and one in the tail
//     stations,                                 // each wing pair's spanwise station, m from the centreline, inboard first
//     thrustScale,                              // 0.5 to 3
//     oewDeltaKg,                               // the empty weight's change, −15 % to +30 % of the base's OEW
//     fuelCapacityKg,                           // half to twice the base's (the change goes in or out of the centre tank)
//     gearExtendM }                             // 0 to 1.5 m longer legs, main and nose together
//
//   normalizeDesign(d)      → a full, clamped copy (never shares d)
//   newDesign(base, extra?) → a design that is its base exactly (it flies the base's golden flight)
//   designDef(d)            → the type entry (memoized by the design's contents)
//   resolveDef(x)           → designDef(x) for a design, typeById(x) for a type id
//   stationRange(base, engine, count) → [min, max] m for the pairs' stations
//   designNumbers(def)      → the warehouse's live numbers (OEW, MTOW, T/W, range, clearances, pylons, tail strike)

import { TYPES, typeById } from './types.js';
import { ENGINE_TYPES, SCALED_KEYS, engineOfType, pylonLimitN } from './engine-types.js';
import { GENX_1B, GE90_115B } from '../audio/engine-sounds.js';

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);
export const COUNTS = [2, 3, 4, 6];
export const RANGES = { thrustScale: [0.5, 3], oewFrac: [-0.15, 0.30], fuelFrac: [0.5, 2], gearExtendM: [0, 1.5] };
const SOUNDS = { 'genx-1b': GENX_1B, 'ge90-115b': GE90_115B };   // the LEAP-1A's is the synth's default
export const isDesign = (x) => !!x && typeof x === 'object' && typeof x.base === 'string' && !!TYPES[x.base];

const pairsOf = (count) => (count === 3 ? 1 : count / 2);
const baseEngine = (base) => engineOfType(base);

// The pairs' stations: outboard of the fuselage's side by a nacelle's width, clear of the main gear's leg by half a
// nacelle and 0.3 m, to 70 % of the semi-span.
export function stationRange(base, engineId, count = 2) {
  const G = typeById(base).geo, E = ENGINE_TYPES[engineId] || baseEngine(base);
  const D = E.nacelle.D;
  let lo = G.FUSELAGE_WIDTH / 2 + D;
  const gearY = G.GEAR.left.y, clear = D / 2 + 0.3;
  if (lo < gearY + clear && lo > gearY - clear) lo = gearY + clear;
  const hi = 0.7 * G.SPAN / 2;
  void count;
  return [lo, Math.max(lo, hi)];
}
// The spacing two pairs must keep: a nacelle and half a metre.
const spacingOf = (engineId) => (ENGINE_TYPES[engineId]?.nacelle.D ?? 3) + 0.5;

function defaultStations(base, engineId, count) {
  const G = typeById(base).geo, [lo, hi] = stationRange(base, engineId, count);
  const y0 = clamp(G.ENGINES[0].y, lo, hi);
  const n = pairsOf(count);
  if (n === 1) return [y0];
  const a = Math.max(lo, Math.min(y0, hi - (n - 1) * spacingOf(engineId)));
  const out = [];
  for (let i = 0; i < n; i++) out.push(+(a + (hi - a) * (n === 2 ? i * 0.62 : i / (n - 1))).toFixed(2));
  return out;
}

// The stations clamped into the range, sorted inboard first, and pushed apart to the spacing (outboard first, then
// back in from the tip if they ran past it).
function fixStations(st, base, engineId, count) {
  const [lo, hi] = stationRange(base, engineId, count), sp = spacingOf(engineId), n = pairsOf(count);
  let s = (Array.isArray(st) ? st.map((v) => num(v, NaN)).filter(Number.isFinite) : []).slice(0, n);
  if (s.length < n) s = defaultStations(base, engineId, count);
  s = s.map((v) => clamp(v, lo, hi)).sort((a, b) => a - b);
  for (let i = 1; i < n; i++) if (s[i] < s[i - 1] + sp) s[i] = s[i - 1] + sp;
  if (s[n - 1] > hi) { s[n - 1] = hi; for (let i = n - 2; i >= 0; i--) if (s[i] > s[i + 1] - sp) s[i] = s[i + 1] - sp; }
  return s.map((v) => Math.max(lo, v));
}

export function newDesign(base = 'a321neo', extra = {}) {
  const T = typeById(base), A = T.data;
  return normalizeDesign({
    v: 1, id: extra.id || 'd' + Date.now().toString(36), name: `My ${T.name}`, registration: T.registration, base: T.id,
    engine: baseEngine(T.id).id, count: 2, stations: [T.geo.ENGINES[0].y], thrustScale: 1, oewDeltaKg: 0,
    fuelCapacityKg: A.FUEL_MAX, gearExtendM: 0, ...extra,
  });
}

export function normalizeDesign(d = {}) {
  const base = TYPES[d.base] ? d.base : 'a321neo';
  const T = TYPES[base], A = T.data;
  const engine = ENGINE_TYPES[d.engine] ? d.engine : baseEngine(base).id;
  const count = COUNTS.includes(+d.count) ? +d.count : 2;
  const r = RANGES;
  return {
    v: 1,
    id: String(d.id || 'd' + Date.now().toString(36)).slice(0, 40),
    name: String(d.name ?? `My ${T.name}`).slice(0, 40) || `My ${T.name}`,
    registration: String(d.registration ?? T.registration).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 8) || T.registration,
    base, engine, count,
    stations: fixStations(d.stations, base, engine, count),
    thrustScale: +clamp(num(d.thrustScale, 1), ...r.thrustScale).toFixed(3),
    oewDeltaKg: Math.round(clamp(num(d.oewDeltaKg, 0), r.oewFrac[0] * A.OEW, r.oewFrac[1] * A.OEW)),
    fuelCapacityKg: Math.round(clamp(num(d.fuelCapacityKg, A.FUEL_MAX), r.fuelFrac[0] * A.FUEL_MAX, r.fuelFrac[1] * A.FUEL_MAX)),
    gearExtendM: +clamp(num(d.gearExtendM, 0), ...r.gearExtendM).toFixed(2),
  };
}
// The parts that change how it flies (not its id, name or registration): what the memo and the kits key on.
const keyOf = (d) => JSON.stringify([d.id, d.base, d.engine, d.count, d.stations, d.thrustScale, d.oewDeltaKg, d.fuelCapacityKg, d.gearExtendM, d.name, d.registration]);

// ---- the geometry ----
// A nacelle at station y, from the base's first one (at y0): along the wing's leading edge's sweep and up its
// dihedral; its top where the base nacelle's top is (the pylon's the same height), its aft end where the base's aft
// end is, so a bigger engine reaches lower and further forward. The thrust point (the sim's ENGINES) keeps the
// base's offset from the nacelle's centre.
function wingEngine(G, E0, y, side) {
  const N0 = G.NACELLES[0], T0 = G.ENGINES[0], D0 = G.NACELLE_DIAMETER, L0 = G.NACELLE_LENGTH;
  const W = G.WING, sweep = Math.tan((W.leSweepDeg ?? W.sweepDeg) * DEG), dih = Math.tan(W.dihedralDeg * DEG);
  const dy = y - N0.y, dx = -dy * sweep + (E0.nacelle.L - L0) / 2, dz = dy * dih, dD = (E0.nacelle.D - D0) / 2;
  return {
    nacelle: { x: N0.x + dx, y: side * y, z: N0.z + dz - dD, D: E0.nacelle.D, L: E0.nacelle.L },
    thrust: { x: T0.x + dx, y: side * y, z: T0.z + dz - dD },
  };
}
// The tail engine (three engines), DC-10 style: on the centreline through the fin's root, its centre a little above
// the crown, the intake ahead of the fin.
// The A321's geometry has no FIN: its fin's root leading edge is at about x −15.0 (aircraft.js finSec()).
const FIN_ROOT_LE = { a321neo: -15.0 };
function tailEngine(G, E, typeId) {
  const D = E.nacelle.D, L = E.nacelle.L;
  const finLe = G.FIN ? G.FIN.rootLeX : FIN_ROOT_LE[typeId] ?? G.TAIL_STRIKE_POINT.x + 2.5;
  const x = finLe + 0.2 * L, z = G.FUSELAGE_HEIGHT / 2 + 0.45 * D;
  return { nacelle: { x, y: 0, z, D, L, tail: true }, thrust: { x, y: 0, z } };
}

function buildGeo(T, d, E) {
  const G = T.geo, ext = d.gearExtendM;
  const same = d.count === 2 && d.engine === baseEngine(T.id).id && d.stations[0] === G.ENGINES[0].y;
  let engines;
  if (same) engines = G.NACELLES.map((n, i) => ({ nacelle: { ...n, D: G.NACELLE_DIAMETER, L: G.NACELLE_LENGTH }, thrust: G.ENGINES[i] }));
  else {
    const L = [], R = [];
    // Engine 1 is the left outboard; the right wing's go inboard to outboard after them.
    for (let i = d.stations.length - 1; i >= 0; i--) L.push(wingEngine(G, E, d.stations[i], 1));
    for (let i = 0; i < d.stations.length; i++) R.push(wingEngine(G, E, d.stations[i], -1));
    engines = d.count === 3 ? [...L, tailEngine(G, E, T.id), ...R] : [...L, ...R];
  }
  const ENGINES = engines.map((e) => ({ x: e.thrust.x, y: e.thrust.y, z: e.thrust.z }));
  const NACELLES = engines.map((e, i) => ({ ...e.nacelle, engine: d.engine, i }));
  const GROUND_Z = G.GROUND_Z + ext;
  const GEAR = ext === 0 ? G.GEAR : Object.fromEntries(Object.entries(G.GEAR).map(([k, g]) => [k, { ...g, z: g.z - ext }]));
  const CRASH_POINTS = [
    ...G.CRASH_POINTS.filter((c) => c.why !== 'engine strike'),
    // each nacelle's lowest point (a tail engine can't touch: it has none)
    ...NACELLES.filter((n) => !n.tail).map((n) => ({ x: n.x, y: n.y, z: n.z - n.D / 2, why: 'engine strike', engine: n.i })),
  ];
  return { ...G, ENGINES, NACELLES, GEAR, GROUND_Z, CRASH_POINTS, GEAR_EXTEND_M: ext };
}

// ---- the data: the engine's numbers, the mass properties, the tanks ----
function buildData(T, d, E, geo) {
  const A = T.data, E0 = baseEngine(T.id), G0 = T.geo;
  const D = { ...A, ...E.data };
  if (d.thrustScale !== 1) for (const k of SCALED_KEYS) D[k] = E.data[k] * d.thrustScale;
  // The engines' masses against the base's two (already inside its OEW, CG and inertias): each engine added at its
  // place, each of the base's taken away at its own. Point masses about the OEW's CG.
  const parts = [];
  for (const n of geo.NACELLES) parts.push({ m: E.installedKg, x: n.x, y: n.y, z: n.z });
  for (const n of G0.NACELLES) parts.push({ m: -E0.installedKg, x: n.x, y: n.y, z: n.z });
  const cg0 = A.CG_OEW_X;
  let dm = 0, dmx = 0;
  for (const p of parts) { dm += p.m; dmx += p.m * (p.x - cg0); }
  const oew = A.OEW + d.oewDeltaKg + dm;
  D.OEW = oew;
  // The structural limits stay the base's: the payload is what MZFW leaves over this OEW (the review's finding A).
  D.MAX_PAYLOAD = Math.max(0, T.limits.MZFW - oew);
  D.CG_OEW_X = dmx === 0 ? cg0 : cg0 + dmx / oew;
  // The inertias: the per-kg terms already grow with the OEW, so the point masses add only what they add beyond them.
  let ixx = 0, iyy = 0, izz = 0;
  for (const p of parts) {
    const rx = p.x - D.CG_OEW_X;
    ixx += p.m * (p.y * p.y + p.z * p.z); iyy += p.m * (rx * rx + p.z * p.z); izz += p.m * (rx * rx + p.y * p.y);
  }
  const dAll = d.oewDeltaKg + dm;
  D.DESIGN_DIXX = ixx - dm * A.IXX_ZFW_PER_KG;
  D.DESIGN_DIYY = iyy - dm * A.IYY_PER_KG;
  D.DESIGN_DIZZ = izz - dm * A.IZZ_ZFW_PER_KG;
  void dAll;
  // The tanks: the wings stay as they are (or empty to half of a smaller capacity each); the centre tank takes the rest.
  const cap = d.fuelCapacityKg;
  D.FUEL_MAX = cap;
  D.FUEL_WING_EACH = Math.min(A.FUEL_WING_EACH, cap / 2);
  D.FUEL_CENTER = cap - 2 * D.FUEL_WING_EACH;
  // The gear: the wing is that much higher over the ground (ground effect), and the tail-strike angle follows.
  const ext = d.gearExtendM;
  if (ext) {
    D.WING_HEIGHT = A.WING_HEIGHT + ext;
    D.PITCH_TAILSTRIKE_DEG = A.PITCH_TAILSTRIKE_DEG + (tailAngle(geo) - tailAngle(G0)) / DEG;
  }
  // The pylons' limits, engine by engine: 1.5 × the engine type's rated take-off thrust (CS-25's ultimate factor) is
  // the least a pylon holds; as built each has its own margin over it, here 0 to 10 %, fixed by the design's parts
  // (not its id or name: a copy behaves as the original) and the engine's place, so pylons don't all fail in the same
  // instant: past its limit the weakest goes first.
  const partsKey = JSON.stringify([d.base, d.engine, d.count, d.stations, d.thrustScale, d.oewDeltaKg, d.fuelCapacityKg, d.gearExtendM]);
  D.PYLON_LIMITS_N = geo.ENGINES.map((_, i) => pylonLimitN(E) * (1 + 0.10 * scatter(partsKey, i)));
  D.ENGINE_MASS_KG = E.installedKg;
  D.DESIGN = true;
  return D;
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

const memo = new Map();
export function designDef(design) {
  const d = normalizeDesign(design);
  const key = keyOf(d);
  let def = memo.get(key);
  if (def) return def;
  const T = TYPES[d.base], E = ENGINE_TYPES[d.engine];
  const geo = buildGeo(T, d, E);
  const data = buildData(T, d, E, geo);
  const massRatio = (data.OEW + T.defaults.pax * T.limits.PAX_KG) / (T.data.OEW + T.defaults.pax * T.limits.PAX_KG);
  const tsfcRatio = E.data.TSFC_C0 / T.data.TSFC_C0;
  def = Object.freeze({
    ...T, base: T, design: Object.freeze({ ...d, stations: Object.freeze(d.stations.slice()) }), key,
    name: d.name, registration: d.registration, engine: E, engineCount: d.count,
    engineName: `${d.count} × ${E.short}`, data: Object.freeze(data), geo: Object.freeze(geo),
    sound: SOUNDS[E.id], limits: { ...T.limits, OEW: data.OEW, FUEL_MAX: data.FUEL_MAX },
    fuel: { ...T.fuel, perNm: T.fuel.perNm * massRatio * tsfcRatio },
  });
  if (memo.size > 64) memo.clear();
  memo.set(key, def);
  return def;
}
export const resolveDef = (x) => (isDesign(x) ? designDef(x) : typeById(x));

// ---- the warehouse's numbers ----
// Each engine's ground clearance at rest (the nacelle's lowest point over the ground, with the gear's static
// compression as the base's) and at the tail-strike attitude (pitched up about the main wheels until the tail
// touches); each pylon's load at full thrust (sea level, standing) against its limit; thrust to weight at MTOW; the
// range from the setup's fuel rule with full tanks (or as much as MTOW leaves with the default payload).
export function designNumbers(def) {
  const A = def.data, G = def.geo, L = def.limits, F = def.fuel;
  const n = G.ENGINES.length, thrust = A.T0_ENGINE;           // per engine, sea level static
  const tw = (n * thrust) / (L.MTOW * 9.80665);
  // The base's default load, or as much of it as MZFW leaves over this OEW.
  const pax = def.defaults?.pax ?? 0, payload = Math.min(pax * L.PAX_KG + (def.defaults?.cargoKg ?? 0), Math.max(0, L.MZFW - A.OEW));
  const fuel = Math.max(0, Math.min(A.FUEL_MAX, L.MTOW - A.OEW - payload));
  const rangeNm = Math.max(0, (fuel - F.climbKg - F.holdKg - F.taxiKg) / F.perNm);
  const ta = tailAngle(G);
  const m = G.GEAR.left;
  const engines = G.NACELLES.map((nc, i) => {
    const zLow = nc.z - nc.D / 2;
    const rest = zLow + G.GROUND_Z;
    // Pitched up by the tail-strike angle about the main wheels' contact (x = m.x, z = m.z).
    const rx = nc.x - m.x, rz = zLow - m.z;
    const pitched = rz * Math.cos(ta) + rx * Math.sin(ta);
    const limit = A.PYLON_LIMITS_N ? A.PYLON_LIMITS_N[i] : 1.5 * thrust;
    return { i, x: nc.x, y: nc.y, tail: !!nc.tail, clearRestM: rest, clearTailStrikeM: nc.tail ? Infinity : pitched,
      loadN: thrust, limitN: limit, pylonFrac: thrust / limit };
  });
  return {
    // Nacelles closer than a nacelle's width apart (big engines in three pairs on a small wing): they overlap.
    overlap: G.NACELLES.some((a, i) => G.NACELLES.some((b, j) => j > i && !a.tail && !b.tail && Math.sign(a.y) === Math.sign(b.y) && Math.abs(a.y - b.y) < (a.D + b.D) / 2)),
    oewKg: A.OEW, mtowKg: L.MTOW, fuelCapacityKg: A.FUEL_MAX, thrustToWeight: tw, rangeNm, payloadKg: payload,
    payloadMaxKg: Math.max(0, L.MZFW - A.OEW), tailStrikeDeg: ta / DEG, engines,
  };
}
