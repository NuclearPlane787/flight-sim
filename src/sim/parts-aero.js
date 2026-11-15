// v0.5.3: the airframe's aerodynamics from its parts. Each wing panel (left and right), each tailplane panel and the
// fin is a few spanwise strips; each strip sees its own airflow (the body's velocity plus ω × r at the strip, the wing's
// downwash at the tailplane, lagged for the α-dot term, the sidewash at the fin), and makes its own lift, drag and
// moment from its section's lift curve (its stall per strip), its profile and induced drag, and its quarter-chord
// moment. The control surfaces deflect the strips they cover. The fuselage adds its drag, its side force and its
// destabilising (Munk) moments in pitch and yaw. So the stability, the damping, the control power and the stall come
// out of where the parts are and how big they are, not from tabled derivatives.
//
// The three types fly their lumped model (src/sim/flightmodel.js) untouched. A design's coefficients are
//     lumped(base, state) + parts(design, state) − parts(base, state)
// (src/sim/sim.js), so a design that is its base flies its golden flight, and a changed part changes the handling by
// what that part changes. The parts' model is good on its own: parts(base) is held to lumped(base) by the validation
// table (tests/parts-aero.test.mjs, STATUS.md's v0.5.3 entries).
//
// Pure: no DOM, no three.js. The sim and the prediction worker import it. Allocation free per call.
//
// Frames: the shapes are in the geometry frame (x forward, y left, z up, origin at the reference point: the
// fuselage centreline at 25 % MAC). The strips and the coefficients are in the sim's body frame (FRD: x forward,
// y right, z down), as flightmodel.js's: CL, CD in wind axes, CY body side force, Cl, Cm, Cn about the reference
// point, on the base's S, b and c (its lumped references), which a design keeps as its coefficients' references.
//
//   baseShape(base)              → the base's parts as planforms (data: the type's geometry and widebody-specs.js)
//   shapeOf(base, airframe)      → a design's parts: the base's changed by the design's airframe (src/sim/designs.js)
//   partsModel(base, airframe)   → the prepared strips (memoized by the airframe's contents)
//   partsInto(P, s, o)           → the coefficients for a state s (flightmodel.js's inputs, plus elev): fills o
//   partsNumbers(P)              → the planform's numbers (areas, spans, arms, AR, MAC) for the checks

import { typeById } from './types.js';
import { createFlightModel, interp } from './flightmodel.js';
import { B787_9, B777_300ER } from '../widebody-specs.js';
import { CAL } from './parts-aero-cal.js';

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const tab = (T, x) => interp(T, x);

// ---- the base airframes' parts, from the geometry ----
// A planform panel is a list of stations outboard from the root (y up the span from the centreline for the wing and
// the tailplane, z up for the fin), each with its leading edge's x, its chord and its height (z; the fin's y is 0).
// The first station is the panel's root at the fuselage's side; the strip inside it (to the centreline) is the
// carry-through, part of the reference area. Control surfaces as spans on the panel, in fractions of the exposed span.

// The A321neo: the wing from aircraft.js's wingSec() (the leading edge at 27.5°, the trailing edge straight to the
// kink at y = 6.4, the tip at 17.0 m; the sharklets are left out), the tailplane from stabSec() and the fin from finSec()
// (aircraft.js: drawn from Airbus's AC top and side views). The surfaces [EST] from the AC's top view: flaps to 76 % of
// the exposed span, the aileron outboard of them to 94 %, the slats from 15 %, five spoilers from 17 % to 70 %; the
// elevator 1.32 to 6.08 m, the rudder 2.02 to 7.58 m up the fin.
function a321Shape() {
  const T = typeById('a321neo'), G = T.geo, W = G.WING;
  const ys = 1.98, tanLe = Math.tan(27.5 * DEG), dih = Math.tan(W.dihedralDeg * DEG), z0 = -1.05;
  const st = (y, c) => ({ y, xle: W.rootX - (y - ys) * tanLe, c, z: z0 + (y - ys) * dih });
  const teRoot = W.rootX - W.rootChord;
  const kinkC = (W.rootX - (6.4 - ys) * tanLe) - teRoot;
  const exp = (y) => (y - ys) / (17.0 - ys);
  return {
    base: 'a321neo',
    wing: { stations: [st(ys, W.rootChord), st(6.4, kinkC), st(17.0, W.tipChord)], nIn: 2, nOut: 4,
      flap: [0, exp(13.4)], ail: [[exp(13.5), exp(16.1)]], slat: [exp(4.2), 1], spoiler: [exp(4.5), exp(12.5)] },
    tail: { stations: [{ y: 1.0, xle: -16.4, c: 3.95, z: 0.35 }, { y: 6.22, xle: -16.4 - 5.22 * Math.tan(32 * DEG), c: 1.35, z: 0.35 + 5.22 * Math.tan(6 * DEG) }],
      n: 3, elev: [(1.32 - 1.0) / 5.22, (6.08 - 1.0) / 5.22] },
    fin: { stations: [{ z: 1.9, xle: -15.0, c: 6.2 }, { z: 7.86, xle: -15.0 - 5.96 * Math.tan(36 * DEG), c: (-15.0 - 5.96 * Math.tan(36 * DEG)) + 21.9 }],
      n: 3, rud: [(2.02 - 1.9) / 5.96, (7.58 - 1.9) / 5.96] },
    body: { noseX: G.NOSE_X, tailX: G.TAIL_X, length: G.LENGTH, width: G.FUSELAGE_WIDTH, height: G.FUSELAGE_HEIGHT },
  };
}

// The Boeings: the wing from the geometry's WING (the leading edge's straight sweep from the root at the fuselage's
// side, the trailing edge's kink at kinkY, the tip's chord), its heights by the dihedral from widebody-specs.js's z0;
// the tailplane from widebody-specs.js's planform (the leading edge's sweep from rootY, its trailing-edge table, the
// tip's rounding) and the geometry's TAILPLANE; the fin from widebody-specs.js's leading-edge table and the geometry's
// FIN (its trailing edge straight from the root to the top). The surfaces are widebody-specs.js's drawn spans: the
// flaps and the flaperon (which droops with the flaps and works as an aileron), the outboard aileron, the slats, the
// spoilers, the elevator and the rudder.
function boeingShape(id, spec) {
  const T = typeById(id), G = T.geo, W = G.WING, ws = spec.wing, tp = spec.tailplane, fs = spec.fin;
  const ys = G.FUSELAGE_WIDTH / 2, tipY = G.SPAN / 2, tanLe = Math.tan(W.leSweepDeg * DEG), dih = Math.tan(W.dihedralDeg * DEG);
  const z0 = ws.z0;
  const leX = (y) => W.rootX - (y - ys) * tanLe;
  const st = (y, xle, c) => ({ y, xle, c, z: z0 + (y - ys) * dih });
  const exp = (y) => (y - ys) / (tipY - ys);
  const wing = {
    stations: [st(ys, W.rootX, W.rootChord), st(W.kinkY, leX(W.kinkY), leX(W.kinkY) - W.kinkTeX), st(tipY, W.tipLeX, W.tipLeX - W.tipTeX)],
    nIn: 2, nOut: 4,
    flap: [exp(ws.flapIn[0]), exp(ws.flapOut[1])], ail: [[exp(ws.flaperon[0]), exp(ws.flaperon[1])], [exp(ws.aileron[0]), exp(ws.aileron[1])]],
    slat: [exp(ws.slatSegments[0][0]), exp(ws.slatSegments[ws.slatSegments.length - 1][1])],
    spoiler: [exp(ws.spoilers[0][0]), exp(ws.spoilers[ws.spoilers.length - 1][1])],
  };
  const TP = G.TAILPLANE, tY = TP.span / 2, tanT = Math.tan(tp.leSweepDeg * DEG), tdih = Math.tan(tp.dihedralDeg * DEG);
  const tLe = (y) => TP.rootLeX - (y - tp.rootY) * tanT - (y > tp.leTip[0][0] ? tab(tp.leTip, y) : 0);
  const tst = (y) => ({ y, xle: tLe(y), c: tLe(y) - tab(tp.te, y), z: TP.z + y * tdih });
  const yMid = tp.leTip[0][0];
  const tail = { stations: [tst(tp.rootY), tst(yMid), tst(tY)], n: 3, elev: [(tp.elevator[0] - tp.rootY) / (tY - tp.rootY), (tp.elevator[1] - tp.rootY) / (tY - tp.rootY)] };
  const F = G.FIN, zr = fs.teRootZ, zt = F.topZ;
  const fLe = (z) => tab(fs.leTable, z);
  const fTe = (z) => lerp(F.rootTeX, F.topTeX, (z - zr) / (zt - zr));
  const zk = fs.leTable[fs.leTable.length - 3][0];   // where the top starts to round over
  const fst = (z) => ({ z, xle: fLe(z), c: fLe(z) - fTe(z) });
  const fin = { stations: [fst(zr), fst(zk), fst(zt)], n: 3, rud: [(fs.rudder[0] - zr) / (zt - zr), (fs.rudder[1] - zr) / (zt - zr)] };
  const body = { noseX: G.NOSE_X, tailX: G.NOSE_X - G.FUSELAGE_LENGTH, length: G.FUSELAGE_LENGTH, width: G.FUSELAGE_WIDTH, height: G.FUSELAGE_HEIGHT };
  return { base: id, wing, tail, fin, body };
}

const BASE_SHAPES = new Map();
export function baseShape(base) {
  const id = typeById(base).id;
  let s = BASE_SHAPES.get(id);
  if (!s) {
    s = id === 'b787-9' ? boeingShape(id, B787_9) : id === 'b777-300er' ? boeingShape(id, B777_300ER) : a321Shape();
    BASE_SHAPES.set(id, s);
  }
  return s;
}

// ---- a design's airframe applied to the base's parts ----
// airframe (src/sim/designs.js's normalised field):
//   { wingL: { span, chord, sweep, dihedral }, wingR: { … }, tail, fin, plugFwd, plugAft }
//   span, chord: × the base's exposed span and chord; sweep: degrees added to the quarter chord's; dihedral: degrees
//   (absolute); tail, fin: × the base's areas (aspect ratio and sweep kept); plugFwd, plugAft: metres of fuselage added
//   ahead of and behind the wing.
// The wing swings about its root's quarter chord, its chord grows about each station's quarter chord, its span from the
// fuselage's side; the tails grow about their roots' trailing edges (v0.5.4: were the quarter chords); the forward
// plug moves the nose forward and the aft plug the tail (tailplane and fin) back. The reference point (the base's 25 %
// MAC) stays where it is.
export function wingSide(base, ws, side) {
  const b = baseShape(base).wing, s0 = b.stations[0];
  const qc0 = s0.xle - s0.c / 4, ys = s0.y;
  const W = typeById(base).geo.WING, dih0 = W.dihedralDeg * DEG;
  const tanSw = (y, x) => (y > ys ? (qc0 - x) / (y - ys) : 0);
  const out = b.stations.map((st) => {
    const qc = st.xle - st.c / 4;
    const y = ys + (st.y - ys) * ws.span;
    const t0 = tanSw(st.y, qc);
    const sw0 = Math.atan(t0), sw = sw0 + ws.sweep * DEG;
    const x = qc0 - (y - ys) * Math.tan(sw);
    const c = st.c * ws.chord;
    const zRes = st.z - (s0.z + (st.y - ys) * Math.tan(dih0));
    const z = s0.z + (y - ys) * Math.tan(ws.dihedral * DEG) + zRes * ws.span;
    return { y, xle: x + c / 4, c, z };
  });
  return { ...b, stations: out, side };
}
export const SHARKLET_AR = 1.08;   // the A321's sharklets' effective aspect ratio (v0.5.3, extra time: shapeOf())
export function shapeOf(base, af) {
  const b = baseShape(base);
  if (!af) return { ...b, wingL: wingSide(base, defaultSide(base), 1), wingR: wingSide(base, defaultSide(base), -1) };
  const kt = Math.sqrt(af.tail), kf = Math.sqrt(af.fin), fwd = af.plugFwd || 0, aft = af.plugAft || 0;
  // v0.5.4: the tails scale about their roots' trailing edges (airframe-map.js's tail() and fin() agree); a factor
  // of 1 keeps the base's stations exactly (moved back with the aft plug only)
  const t0 = b.tail.stations[0], tq = t0.xle - t0.c;
  const tail = { ...b.tail, stations: b.tail.stations.map((s, i) => {
    if (kt === 1) return { ...s, xle: s.xle - aft };
    const qc = s.xle - s.c / 4, y = i === 0 ? s.y : t0.y + (s.y - t0.y) * kt, c = s.c * kt;
    const x = tq + (qc - tq) * kt - aft;
    return { y, xle: x + c / 4, c, z: t0.z + (s.z - t0.z) * kt };
  }) };
  const f0 = b.fin.stations[0], fq = f0.xle - f0.c;
  const fin = { ...b.fin, stations: b.fin.stations.map((s, i) => {
    if (kf === 1) return { ...s, xle: s.xle - aft };
    const qc = s.xle - s.c / 4, z = i === 0 ? s.z : f0.z + (s.z - f0.z) * kf, c = s.c * kf;
    const x = fq + (qc - fq) * kf - aft;
    return { z, xle: x + c / 4, c };
  }) };
  const body = { ...b.body, noseX: b.body.noseX + fwd, tailX: b.body.tailX - aft, length: b.body.length + fwd + aft };
  // v0.5.3 (extra time): the A321's sharklets off. The parts' wing never had them (its tip is 17.0 m), so they're an
  // effective aspect ratio: about 8 % more with them [EST] (Airbus quotes up to 4 % less fuel on long sectors, about
  // a tenth of the induced drag), which goes into the induced drag, the downwash and the 3D lift slope.
  const tipK = af.sharklets === false ? 1 / SHARKLET_AR : 1;
  return { ...b, wingL: wingSide(base, af.wingL, 1), wingR: wingSide(base, af.wingR, -1), tail, fin, body, tipK };
}
export function defaultSide(base) {
  return { span: 1, chord: 1, sweep: 0, dihedral: typeById(base).geo.WING.dihedralDeg };
}

// ---- strips ----
// Each strip: its quarter chord's point (FRD), its area and chord, its axes (FRD): e_t, chordwise forward and normal to
// the span in the panel's plane; e_n, the panel's normal (down for the wing and the tailplane, right for the fin);
// h = e_n × e_t, the axis of its nose-up section moment. cosL, the cosine of its sweep (e_t against x).
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function unit(a) { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; }
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// The points along a panel's span (stations as [s, x_le, c, h]: s along the span, h the other coordinate), split into
// strips: n strips over each segment as given.
function stripsOf(st, counts, toFRD, kind, cover) {
  const out = [];
  const s0 = st[0].s, s1 = st[st.length - 1].s;
  for (let k = 0; k < st.length - 1; k++) {
    const a = st[k], b = st[k + 1], n = counts[k];
    for (let j = 0; j < n; j++) {
      const ta = j / n, tb = (j + 1) / n, tm = (ta + tb) / 2;
      const at = (t) => ({ s: lerp(a.s, b.s, t), xle: lerp(a.xle, b.xle, t), c: lerp(a.c, b.c, t), h: lerp(a.h, b.h, t) });
      const pa = at(ta), pb = at(tb), pm = at(tm);
      const qa = toFRD(pa.xle - pa.c / 4, pa.s, pa.h), qb = toFRD(pb.xle - pb.c / 4, pb.s, pb.h), qm = toFRD(pm.xle - pm.c / 4, pm.s, pm.h);
      const span = sub(qb, qa), ds = Math.hypot(span[0], span[1], span[2]);
      out.push({ kind, r: qm, S: pm.c * ds, c: pm.c, es: unit(span), eta: (pm.s - s0) / (s1 - s0), ...cover((pm.s - s0) / (s1 - s0)) });
    }
  }
  return out;
}
function axes(st, wantN) {
  // e_n: normal to the span and to x (the chord's line), towards wantN; e_t: in the plane, normal to the span, forward.
  let n = unit(cross([1, 0, 0], st.es));
  if (dot(n, wantN) < 0) n = [-n[0], -n[1], -n[2]];
  let t = unit(cross(st.es, n));
  if (t[0] < 0) t = [-t[0], -t[1], -t[2]];
  st.en = n; st.et = t; st.h = cross(n, t); st.cosL = t[0];
}
const inSpan = (eta, sp) => (eta >= sp[0] - 1e-9 && eta <= sp[1] + 1e-9 ? 1 : 0);

// The Helmbold–DATCOM lift slope of a panel of aspect ratio A and half-chord sweep L (per rad), for the 3D correction.
function helmbold(A, L) {
  const k = 0.95, t = Math.tan(L);
  return 2 * Math.PI * A / (2 + Math.sqrt(4 + A * A / (k * k) * (1 + t * t)));
}
function areaOf(strips) { let s = 0; for (const p of strips) s += p.S; return s; }

const FMS = new Map();
const fmOf = (base) => { let f = FMS.get(base); if (!f) { f = createFlightModel(typeById(base).data); FMS.set(base, f); } return f; };

function prepare(base, shape) {
  const T = typeById(base), A = T.data, C = CAL[T.id];
  const ref = { S: A.S, b: A.SPAN, c: A.MAC };
  const strips = [];
  // The wing: each side from the centreline (the carry-through strip) to its tip.
  const wing = [];
  for (const w of [shape.wingL, shape.wingR]) {
    const side = w.side, st = w.stations;
    const toFRD = (x, y, z) => [x, -side * y, -z];
    const stations = [{ s: 0, xle: st[0].xle, c: st[0].c, h: st[0].z }, ...st.map((p) => ({ s: p.y, xle: p.xle, c: p.c, h: p.z }))];
    const sw = stripsOf(stations, [1, w.nIn, w.nOut], toFRD, 'wing', () => ({}));
    const ys = st[0].y, tip = st[st.length - 1].y;
    for (const p of sw) {
      const y = Math.abs(p.r[1]);
      const e = y <= ys ? -1 : (y - ys) / (tip - ys);   // the exposed span's fraction (−1 inside the body)
      p.side = side; p.y = y; p.eExp = e;
      p.flap = e >= 0 ? inSpan(e, w.flap) : 1;   // the flaps' slots run into the body's fairing: the carry-through gets them
      p.slat = e >= 0 ? inSpan(e, w.slat) : 0;
      p.ail = e >= 0 && w.ail.some((s) => inSpan(e, s)) ? 1 : 0;
      p.spoiler = e >= 0 ? inSpan(e, w.spoiler) : 0;
      axes(p, [0, 0, 1]);
      wing.push(p);
    }
  }
  // The tailplane, each side.
  const tail = [];
  for (const side of [1, -1]) {
    const st = shape.tail.stations;
    const toFRD = (x, y, z) => [x, -side * y, -z];
    const stations = [{ s: 0, xle: st[0].xle, c: st[0].c, h: st[0].z }, ...st.map((p) => ({ s: p.y, xle: p.xle, c: p.c, h: p.z }))];
    const counts = [1, ...st.slice(1).map((_, i) => (i === 0 ? shape.tail.n - 1 : 1))];
    for (const p of stripsOf(stations, counts, toFRD, 'tail', () => ({}))) {
      const y = Math.abs(p.r[1]), e = (y - st[0].y) / (st[st.length - 1].y - st[0].y);
      p.side = side; p.elev = e >= 0 ? inSpan(e, shape.tail.elev) : 0;
      axes(p, [0, 0, 1]);
      tail.push(p);
    }
  }
  // The fin.
  const fin = [];
  {
    const st = shape.fin.stations;
    const toFRD = (x, z) => [x, 0, -z];
    const stations = st.map((p) => ({ s: p.z, xle: p.xle, c: p.c, h: 0 }));
    const counts = st.slice(1).map((_, i) => (i === 0 ? shape.fin.n - 1 : 1));
    for (const p of stripsOf(stations, counts, (x, s) => toFRD(x, s), 'fin', () => ({}))) {
      const e = (-p.r[2] - st[0].z) / (st[st.length - 1].z - st[0].z);
      p.rud = inSpan(e, shape.fin.rud);
      axes(p, [0, 1, 0]);
      fin.push(p);
    }
  }
  // The panels' numbers: areas, spans, aspect ratios, the half-chord sweeps (for the slopes), the arms.
  const Sw = areaOf(wing);
  const spanW = shape.wingL.stations[shape.wingL.stations.length - 1].y + shape.wingR.stations[shape.wingR.stations.length - 1].y;
  const ARw = spanW * spanW / Sw * (shape.tipK ?? 1);
  const sweepOf = (w) => { const a = w.stations[0], b = w.stations[w.stations.length - 1];
    return Math.atan(((a.xle - a.c / 2) - (b.xle - b.c / 2)) / (b.y - a.y)); };
  const swL = sweepOf(shape.wingL), swR = sweepOf(shape.wingR);
  // v0.5.4: and each side's quarter chord's, root to tip (what the airframe's sweep turns), for the Mach normal to it
  const qSweepOf = (w) => { const a = w.stations[0], b = w.stations[w.stations.length - 1];
    return Math.atan(((a.xle - a.c / 4) - (b.xle - b.c / 4)) / (b.y - a.y)); };
  const sqL = qSweepOf(shape.wingL), sqR = qSweepOf(shape.wingR);
  const St = areaOf(tail), spanT = 2 * shape.tail.stations[shape.tail.stations.length - 1].y, ARt = spanT * spanT / St;
  const ta = shape.tail.stations[0], tb = shape.tail.stations[shape.tail.stations.length - 1];
  const swT = Math.atan(((ta.xle - ta.c / 2) - (tb.xle - tb.c / 2)) / (tb.y - ta.y));
  const Sf = areaOf(fin), hF = shape.fin.stations[shape.fin.stations.length - 1].z - shape.fin.stations[0].z, ARf = hF * hF / Sf;
  const fa = shape.fin.stations[0], fb = shape.fin.stations[shape.fin.stations.length - 1];
  const swF = Math.atan(((fa.xle - fa.c / 2) - (fb.xle - fb.c / 2)) / (fb.z - fa.z));
  const xw = wing.reduce((s, p) => s + p.S * p.r[0], 0) / Sw, xt = tail.reduce((s, p) => s + p.S * p.r[0], 0) / St;
  const xf = fin.reduce((s, p) => s + p.S * p.r[0], 0) / Sf;
  // The mean aerodynamic chord of the wing (area-weighted chord² / area) and its quarter chord's x.
  const macW = wing.reduce((s, p) => s + p.S * p.c, 0) / Sw;
  // The base's numbers, for the ratios that a design's strips scale by (the sections are the base's).
  const B = shape === BASE_FULL.get(T.id) ? null : baseNumbers(T.id);
  const hw = helmbold(ARw, (swL + swR) / 2), ht = helmbold(ARt, swT), hf = helmbold(C.finEndplate * ARf, swF);
  const nums = { Sw, spanW, ARw, swL, swR, sqL, sqR, St, spanT, ARt, swT, Sf, hF, ARf, swF, xw, xt, xf, lt: xw - xt, lf: xw - xf, macW, hw, ht, hf,
    Sflap: areaOf(wing.filter((p) => p.flap)), Sslat: areaOf(wing.filter((p) => p.slat)), Sspoil: areaOf(wing.filter((p) => p.spoiler)),
    ScFlap: wing.filter((p) => p.flap).reduce((s, p) => s + p.S * p.c, 0),
    body: shape.body, Vbody: shape.body.width * shape.body.height * shape.body.length };
  const R = B || nums;   // the base's own numbers (the sections' concentration ratios are the base's)
  const P = {
    base: T.id, A, C, ref, wing, tail, fin, nums, shape,
    // the 3D slope corrections against the base's planforms (1 for the base)
    kWing: nums.hw / R.hw, kTail: nums.ht / R.ht, kFin: nums.hf / R.hf,
    // the sections' increments are concentrated on the strips that carry them: per unit of their area, the base's
    rFlap: R.Sw / R.Sflap, rSlat: R.Sw / R.Sslat, rSpoil: R.Sw / R.Sspoil,
    cmFlap: A.CM.flap * ref.S * ref.c / R.ScFlap,   // per flap degree, on each flapped strip's S·c
    fm: fmOf(T.id), lc: [{}, {}, {}].map(() => ({ clmax: 0, a: 0, cl0: 0, alphaMax: 0 })),
    sideMach: [Math.cos(A.SWEEP) / Math.cos(A.SWEEP + (swL - R.swL)), Math.cos(A.SWEEP) / Math.cos(A.SWEEP + (swR - R.swR))],
    sweepMach: [A.SWEEP + (swL - R.swL), A.SWEEP + (swR - R.swR)],
    // v0.5.4: each side's Mach normal to its quarter chord against the base's, cos Λ_side / cos Λ_base with Λ_side the
    // type's sweep plus the side's turn: the maximum lift's loss with Mach goes by it (exactly 1 on the base's wing)
    normalMach: [Math.cos(A.SWEEP + (sqL - R.sqL)) / Math.cos(A.SWEEP), Math.cos(A.SWEEP + (sqR - R.sqR)) / Math.cos(A.SWEEP)],
    tSweepMach: swT, fSweepMach: swF,
    bodyRatio: { L: nums.body.length / R.body.length, V: nums.Vbody / R.Vbody, side: (nums.body.length * nums.body.height) / (R.body.length * R.body.height) },
    tailRatio: St / R.St, finRatio: Sf / R.Sf,
  };
  // The stall's spread along the span [EST]: the root stalls first (its section's α max 1.5° below the tip's, the
  // area-weighted mean unchanged), as a swept wing with slats and washout is laid out to.
  const etaMean = wing.reduce((s, p) => s + p.S * Math.max(0, p.eExp), 0) / Sw;
  for (const p of wing) p.dAlphaMax = C.stallSpread * (Math.max(0, p.eExp) - etaMean);
  return P;
}
const BASE_FULL = new Map();
const BASE_NUMS = new Map();
function baseNumbers(id) {
  let n = BASE_NUMS.get(id);
  if (!n) { n = partsModel(id, null).nums; BASE_NUMS.set(id, n); }
  return n;
}

const MODELS = new Map();
export function partsModel(base, airframe = null) {
  const id = typeById(base).id;
  const key = id + '|' + (airframe ? JSON.stringify(airframe) : '');
  let P = MODELS.get(key);
  if (P) return P;
  let shape;
  if (!airframe) {
    shape = BASE_FULL.get(id);
    if (!shape) { shape = shapeOf(id, null); BASE_FULL.set(id, shape); }
  } else shape = shapeOf(id, airframe);
  P = prepare(id, shape);
  if (MODELS.size > 64) for (const k of MODELS.keys()) { if (k.endsWith('|')) continue; MODELS.delete(k); break; }
  MODELS.set(key, P);
  return P;
}

// ---- the strips' lift curve ----
// A strip's lift curve (streamwise, on its own area): the lumped model's own curve for the slats and flaps it has (the
// sections are what the lumped curve sums to: its increments for slats and flaps put on the strips that carry them),
// times the panel's 3D slope against the base's, with Mach as the lumped model's (Prandtl–Glauert on the side's sweep).
// In the normal plane of a swept strip, a = a/cosΛ, cl0 and clmax /cos²Λ, α max and the knee /cosΛ.
function clOf(cl0, a, clmax, aMax, knee, alpha) {
  const k = aMax - knee;
  if (alpha <= k) {
    const aMin = -cl0 / a - 12 * DEG;
    if (alpha < aMin) return cl0 + a * aMin + 0.15 * Math.sin(2 * (alpha - aMin));
    return cl0 + a * alpha;
  }
  if (alpha <= aMax) { const d = aMax - alpha; return clmax - a / (2 * knee) * d * d; }
  const d = alpha - aMax;
  const post = clmax * (0.75 + 0.25 * Math.exp(-d / (2.5 * DEG)));
  const w = Math.min(1, d / (25 * DEG));
  return post * (1 - w) + 1.15 * Math.sin(2 * alpha) * w;
}
function slopeOf(cl0, a, aMax, knee, alpha) {
  const k = aMax - knee;
  if (alpha <= k) return alpha < -cl0 / a - 12 * DEG ? 0 : a;
  if (alpha <= aMax) return a / knee * (aMax - alpha);
  return 0;
}
// A symmetric section (the tails): ±α stall at aS, the same shape.
function clSym(a, aS, knee, alpha) {
  const s = alpha < 0 ? -1 : 1, x = alpha * s;
  return s * clOf(0, a, a * (aS - knee / 2), aS, knee, x);
}
function slopeSym(a, aS, knee, alpha) { return slopeOf(0, a, aS, knee, Math.abs(alpha)); }

const PG = (M, L) => { const mc = Math.min(M, 0.9) * Math.cos(L); return 1 / Math.sqrt(1 - mc * mc); };
const groundEffect = (h, b) => { const r = 16 * Math.max(h, 0.5) / b; return (r * r) / (1 + r * r); };

// ---- the coefficients ----
// s: flightmodel.js's inputs (alpha, beta, M, phat, qhat, rhat, adothat, slat, flap, gear, doors, sb, gsp, spL, spR,
// ail, rud, ths, hWing) and elev (rad, + nose up; 0 if missing). The rates are on the base's b and c, as the sim's.
// Writes o: CL, CD, CY, Cl, Cm, Cn (on the base's S, b, c, about the reference point), clmax (the wing's maximum lift on
// S at this slat, flap and Mach), and the controls' powers at this state, per rad (per unit for the spoilers): dCmElev
// (nose-up elevator), dClAil (+ roll right), dClSp (spR − spL), dCnRud (+ yaw right).
const F = [0, 0, 0], Mo = [0, 0, 0], AC = [0, 0, 0];
export function partsInto(P, s, o) {
  const A = P.A, C = P.C, ref = P.ref, N = P.nums;
  const alpha = s.alpha, beta = s.beta, M = s.M;
  const ca = Math.cos(alpha), sa = Math.sin(alpha), cb = Math.cos(beta), sb = Math.sin(beta);
  const u = ca * cb, v = sb, w = sa * cb;
  const p = s.phat * 2 / ref.b, q = s.qhat * 2 / ref.c, r = s.rhat * 2 / ref.b;
  const elev = s.elev || 0;
  // The lumped curves: clean, slats only, slats and flaps.
  const fm = P.fm, L0 = P.lc[0], L1 = P.lc[1], L2 = P.lc[2];
  fm.liftCurve(0, 0, L0); fm.liftCurve(s.slat, 0, L1); fm.liftCurve(s.slat, s.flap, L2);
  // v0.5.4: the section's maximum lift falls with the Mach normal to its side's sweep (M × cos Λ_side / cos Λ_base:
  // more sweep raises the top of the coffin corner); exactly M on the base's sweep (P.normalMach is 1 there)
  const clmaxMachL = clmaxMachOf(A, M * P.normalMach[0]), clmaxMachR = clmaxMachOf(A, M * P.normalMach[1]);
  const ge = groundEffect(s.hWing, N.spanW), geLift = 1 + 0.10 * (1 - ge);
  const e = A.OSWALD - (A.OSWALD - A.OSWALD_FLAPS) * Math.min(1, s.flap / A.FLAP_REF_DEG);
  const K = 1 / (Math.PI * e * N.ARw);
  const flapCd = interp(A.FLAP_CD, s.flap), slatCd = A.SLAT_CD_PER_DEG * s.slat;
  const knee = A.KNEE;
  F[0] = F[1] = F[2] = 0; Mo[0] = Mo[1] = Mo[2] = 0;
  let dCmE = 0, dClA = 0, dClS = 0, dCnR = 0, clmaxW = 0;
  // Two passes over the wing: the first finds its lift (for the induced drag and the downwash), the second makes
  // the forces. Each strip's local α and dynamic pressure, kept from the first pass.
  const W = P.wing;
  let liftW = 0, slopeW = 0;
  for (let i = 0; i < W.length; i++) {
    const st = W[i], R = st.r, si = st.side > 0 ? 0 : 1;
    // the strip's velocity through the air (per unit of the airspeed), FRD: v + ω × r. The roll rate's flow is the
    // antisymmetric loading's, whose lift slope is less than the symmetric one the strips carry (lifting line: about
    // (A + 2)/(A + 4) of it for an elliptic wing, less with the tip's loss): kP.
    // The same holds for all the wing's antisymmetric flow: the sideslip's (the dihedral and sweep effects) and the
    // yaw rate's, so kP takes the side velocity, the roll rate's and the yaw rate's terms.
    const kP = C.kP;
    const vx = u + q * R[2] - kP * r * R[1], vy = kP * (v + r * R[0] - p * R[2]), vz = w + kP * p * R[1] - q * R[0];
    const Vt = vx * st.et[0] + vy * st.et[1] + vz * st.et[2], Vn = vx * st.en[0] + vy * st.en[1] + vz * st.en[2];
    const V2 = Vt * Vt + Vn * Vn, cL = st.cosL, cL2 = cL * cL;
    // its section: the lumped curve's slats and flaps where it has them, concentrated
    const fS = st.slat * P.rSlat, fF = st.flap * P.rFlap;
    let a = L0.a + fF * (L2.a - L1.a), cl0 = L0.cl0 + C.kFlapCL * (fS * (L1.cl0 - L0.cl0) + fF * (L2.cl0 - L1.cl0)) + C.dcl0;
    const cm0 = L0.clmax * C.kClmax + C.kClmaxHL * (fS * (L1.clmax - L0.clmax) + fF * (L2.clmax - L1.clmax));
    // Fowler: the flap extends the chord (the lumped slope's rise with the flaps is that extension), so the strip's
    // aerodynamic centre moves aft by a quarter of what the chord grows.
    st._dx = st.flap ? -(st.c / 4) * (fF * (L2.a - L1.a) / L0.a) : 0;
    a *= C.kA * P.kWing * PG(M, P.sweepMach[si]);
    const clmax = cm0 * (si === 0 ? clmaxMachL : clmaxMachR);
    const aMax = (clmax - cl0) / a + knee / 2 + st.dAlphaMax;
    const clmaxS = cl0 + a * (aMax - knee / 2);
    // in the normal plane
    const an = a / cL, cl0n = cl0 / cL2, clmaxn = clmaxS / cL2, aMaxn = aMax / cL, kneen = knee / cL;
    // the ailerons (+ rolls right: the left wing's α up, the right's down) and the spoilers (each side's roll
    // spoilers, the speed brakes and the ground spoilers) on the strips they cover
    const sgn = st.side > 0 ? 1 : -1;
    const al = Math.atan2(Vn, Vt) + st.ail * C.tauA * (s.ail || 0) * sgn / cL;
    const cl = clOf(cl0n, an, clmaxn, aMaxn, kneen, al) * geLift
      - st.spoiler * P.rSpoil * (C.kSB * s.sb + C.kGSP * s.gsp * (0.6 + 0.4 * s.flap / A.FLAP_REF_DEG) + C.kSpR * (sgn > 0 ? (s.spL || 0) : (s.spR || 0)));
    st._V2 = V2; st._Vt = Vt; st._Vn = Vn; st._cl = cl; st._al = al; st._aMaxn = aMaxn; st._an = an; st._cl0n = cl0n; st._kneen = kneen;
    liftW += V2 * st.S * cl;   // ≈ the lift (on its own normal), for the induced drag and the downwash
    slopeW += st.S * a;
    clmaxW += st.S * clmaxS;
  }
  const CLw = liftW / N.Sw, aW = slopeW / N.Sw;
  for (let i = 0; i < W.length; i++) {
    const st = W[i], R = st.r, Vt = st._Vt, Vn = st._Vn, V2 = st._V2, Vp = Math.sqrt(V2) || 1e-9;
    const cl = st._cl, al = st._al;
    let cd = C.cd0w + st.flap * P.rFlap * flapCd * C.kFlapCD + st.slat * P.rSlat * slatCd + cl * CLw * K * ge
      + st.spoiler * P.rSpoil * (A.SPEEDBRAKE_CD * s.sb + A.GROUND_SPOILER_CD * s.gsp);
    if (al > st._aMaxn) { const sd = Math.sin(al - st._aMaxn); cd += 1.6 * sd * sd + 0.04 * sd; }
    // wave drag: the lumped model's, its critical Mach on the side's sweep (Korn: Mdd ∝ 1/cos Λ)
    const mcrit = (A.MCRIT0 - 0.1 * (cl * st.cosL * st.cosL - 0.5)) * P.sideMach[st.side > 0 ? 0 : 1];
    if (M > mcrit) { const dm = M - mcrit; cd += A.WAVE_K * dm * dm * dm * dm; }
    addStrip(st, V2, Vt, Vn, Vp, cl, cd, C.cmw + st.flap * P.cmFlap * C.kCmFlap * s.flap, st._dx);
    // the ailerons' and the roll spoilers' powers (their strips' lift slope, here)
    const slope = slopeOf(st._cl0n, st._an, st._aMaxn, st._kneen, al);
    if (st.ail) dClA += rollOf(st, V2 * st.S * slope * C.tauA / st.cosL * (st.side > 0 ? 1 : -1), Vt, Vn, Vp);
    if (st.spoiler) dClS += rollOf(st, -V2 * st.S * C.kSpR * P.rSpoil * (st.side > 0 ? -1 : 1), Vt, Vn, Vp);
  }
  // The tailplane: in the wing's downwash, lagged (the air at the tail left the wing lt/V ago), and the stabiliser's
  // and the elevator's angles.
  const adotLag = s.adothat * 2 * N.lt / ref.c;
  const eps = C.kEps * 2 * (CLw - aW * adotLag) / (Math.PI * N.ARw);
  const ex = -eps * sa, ez = eps * ca;   // the air's downward velocity at the tail (normal to the flow), body axes
  const aT = C.aT * P.kTail * PG(M, P.tSweepMach) * C.etaT, aSt = C.tailStall;
  const T = P.tail;
  for (let i = 0; i < T.length; i++) {
    const st = T[i], R = st.r;
    const vx = u + q * R[2] - r * R[1] - ex, vy = v + r * R[0] - p * R[2], vz = w + p * R[1] - q * R[0] - ez;
    const Vt = vx * st.et[0] + vy * st.et[1] + vz * st.et[2], Vn = vx * st.en[0] + vy * st.en[1] + vz * st.en[2];
    const V2 = Vt * Vt + Vn * Vn, Vp = Math.sqrt(V2) || 1e-9, cL = st.cosL;
    const al = Math.atan2(Vn, Vt) + (C.iT - s.ths - st.elev * C.tauE * elev) / cL;
    const an = aT / cL;
    const cl = clSym(an, aSt / cL, knee / cL, al);
    const cd = C.cd0t;
    addStrip(st, V2, Vt, Vn, Vp, cl, cd, 0);
    if (st.elev) {
      const sl = slopeSym(an, aSt / cL, knee / cL, al);
      dCmE += pitchOf(st, -V2 * st.S * sl * C.tauE / cL, Vt, Vn, Vp);
    }
  }
  // The fin: in the sidewash (the air at the fin moving across with β, from the wing and the body).
  const aF = C.aF * P.kFin * PG(M, P.fSweepMach), aSf = C.finStall;
  const sig = C.sidewash * beta;
  const Fn = P.fin;
  for (let i = 0; i < Fn.length; i++) {
    const st = Fn[i], R = st.r;
    const vx = u + q * R[2] - r * R[1], vy = v + r * R[0] - p * R[2] + sig, vz = w + p * R[1] - q * R[0];
    const Vt = vx * st.et[0] + vy * st.et[1] + vz * st.et[2], Vn = vx * st.en[0] + vy * st.en[1] + vz * st.en[2];
    const V2 = Vt * Vt + Vn * Vn, Vp = Math.sqrt(V2) || 1e-9, cL = st.cosL;
    const al = Math.atan2(Vn, Vt) + st.rud * C.tauR * s.rud / cL;
    const an = aF / cL;
    const cl = clSym(an, aSf / cL, knee / cL, al);
    addStrip(st, V2, Vt, Vn, Vp, cl, C.cd0t, 0);
    if (st.rud) {
      const sl = slopeSym(an, aSf / cL, knee / cL, al);
      dCnR += yawOf(st, V2 * st.S * sl * C.tauR / cL, Vt, Vn, Vp);
    }
  }
  // The fuselage: the Munk moments (destabilising, with its volume), its side force (with its side area), its drag
  // (with its length), as the base's per unit; and the wing–body's own sideslip roll (the low wing).
  const Sr = ref.S, BR = P.bodyRatio;
  // Body forces as coefficients on S (FRD): the side force at the body's middle; drag along the flow.
  const cyB = -C.kY * BR.side * beta;
  const cmB = C.kF * BR.V * alpha, cnB = -C.kN * BR.V * beta;
  // CD items that don't scale with the parts (gear, doors, the β drag, the nacelles and the rest) and the body's,
  // which grows with its length; the tails' profile drag is in their strips, the wing's in its strips.
  const cdB = C.cd0b * BR.L + C.cd0x + A.GEAR_CD * s.gear + A.GEAR_DOOR_CD * s.doors + 0.4 * beta * beta;
  // forces in body axes from the strips (on S): F; moments: Mo (on S, metres)
  let Fx = F[0] / Sr, Fy = F[1] / Sr, Fz = F[2] / Sr;
  // body drag along −(u, v, w), body side force along y
  Fx += -cdB * u; Fy += -cdB * v + cyB; Fz += -cdB * w;
  // back to wind-axis CL, CD and the side force (flightmodel.js's: F = qS(−CD·V̂ + CL·(sin α, 0, −cos α)) + CY ŷ)
  const CL = Fx * sa - Fz * ca;
  const CD = -(Fx * ca + Fz * sa) / Math.max(cb, 1e-6);
  o.CL = CL; o.CD = CD; o.CY = Fy + CD * v;
  const xB = (P.nums.body.noseX + P.nums.body.tailX) / 2;   // the side force's place, the body's middle (FRD x)
  o.Cl = Mo[0] / (Sr * ref.b) + C.kWB * beta;
  o.Cm = Mo[1] / (Sr * ref.c) + cmB + A.CM.gear * s.gear + A.CM.ground * (1 - ge) + A.CM.spoiler * (s.sb + s.gsp) + C.cm0b;
  o.Cn = (Mo[2] + xB * cyB * Sr) / (Sr * ref.b) + cnB;
  o.clmax = clmaxW / Sr;
  o.dCmElev = dCmE / (Sr * ref.c);
  o.dClAil = dClA / (Sr * ref.b);
  o.dClSp = 0.5 * dClS / (Sr * ref.b);   // per unit of spR − spL: each side's half
  o.dCnRud = dCnR / (Sr * ref.b);
  o.CLw = CLw; o.eps = eps;
  return o;
}

// A strip's force (lift normal to its local flow in the panel's normal plane, drag along it) and moments about the
// reference point, added to F and Mo (per unit of the free stream's dynamic pressure).
function addStrip(st, V2, Vt, Vn, Vp, cl, cd, cmSec, dxAc = 0) {
  const et = st.et, en = st.en, k = V2 * st.S;
  const R = dxAc === 0 ? st.r : (AC[0] = st.r[0] + dxAc, AC[1] = st.r[1], AC[2] = st.r[2], AC);
  // lift direction (Vn·e_t − Vt·e_n)/Vp, drag direction −(Vt·e_t + Vn·e_n)/Vp
  const lx = (Vn * et[0] - Vt * en[0]) / Vp, ly = (Vn * et[1] - Vt * en[1]) / Vp, lz = (Vn * et[2] - Vt * en[2]) / Vp;
  const dx = -(Vt * et[0] + Vn * en[0]) / Vp, dy = -(Vt * et[1] + Vn * en[1]) / Vp, dz = -(Vt * et[2] + Vn * en[2]) / Vp;
  const fx = k * (cl * lx + cd * dx), fy = k * (cl * ly + cd * dy), fz = k * (cl * lz + cd * dz);
  F[0] += fx; F[1] += fy; F[2] += fz;
  Mo[0] += R[1] * fz - R[2] * fy; Mo[1] += R[2] * fx - R[0] * fz; Mo[2] += R[0] * fy - R[1] * fx;
  if (cmSec !== 0) { const m = k * st.c * cmSec; Mo[0] += m * st.h[0]; Mo[1] += m * st.h[1]; Mo[2] += m * st.h[2]; }
}
// The moment of a change dL of a strip's lift (along its lift direction): roll, pitch and yaw components.
function liftMoment(st, dL, Vt, Vn, Vp, axis) {
  const et = st.et, en = st.en, R = st.r;
  const lx = (Vn * et[0] - Vt * en[0]) / Vp, ly = (Vn * et[1] - Vt * en[1]) / Vp, lz = (Vn * et[2] - Vt * en[2]) / Vp;
  const fx = dL * lx, fy = dL * ly, fz = dL * lz;
  return axis === 0 ? R[1] * fz - R[2] * fy : axis === 1 ? R[2] * fx - R[0] * fz : R[0] * fy - R[1] * fx;
}
// dL is per unit of the control's angle on the strip whose α rises with it (sign handled by the caller):
// the right wing's aileron up (+ roll right) lowers its lift: a + aileron raises the left wing's α, lowers the right's.
const rollOf = (st, dL, Vt, Vn, Vp) => liftMoment(st, dL, Vt, Vn, Vp, 0);
const pitchOf = (st, dL, Vt, Vn, Vp) => liftMoment(st, dL, Vt, Vn, Vp, 1);
const yawOf = (st, dL, Vt, Vn, Vp) => liftMoment(st, dL, Vt, Vn, Vp, 2);

// The planform's numbers, for the checks and the warehouse.
export function partsNumbers(P) {
  const n = P.nums;
  return { wingAreaM2: n.Sw, spanM: n.spanW, aspectRatio: n.ARw, macM: n.macW, tailAreaM2: n.St, finAreaM2: n.Sf,
    tailArmM: n.lt, finArmM: n.lf, sweepDeg: [(n.swL) / DEG, (n.swR) / DEG] };
}

// ---- the design's coefficients: lumped(base) + parts(design) − parts(base) ----
// PA = { design, base } (partsModel()s, from designDef()). s is the state the lumped model was given; o holds its
// coefficients and gets the parts' difference added. The elevator, the ailerons and the roll spoilers are left out of
// the difference (the sim's laws invert them): their powers' differences go to o.CmElev, and o.dClAil and o.dClSp (per
// rad of aileron, per unit of spR − spL) for the sim to add to the lumped powers. The clmax difference too.
const SD = { alpha: 0, beta: 0, M: 0, phat: 0, qhat: 0, rhat: 0, adothat: 0, slat: 0, flap: 0, gear: 0, doors: 0, sb: 0, gsp: 0, spL: 0, spR: 0, ail: 0, rud: 0, ths: 0, hWing: 10, elev: 0 };
const OD = {}, OB = {};
export function partsDeltaInto(PA, s, o) {
  SD.alpha = s.alpha; SD.beta = s.beta; SD.M = s.M; SD.phat = s.phat; SD.qhat = s.qhat; SD.rhat = s.rhat; SD.adothat = s.adothat;
  SD.slat = s.slat; SD.flap = s.flap; SD.gear = s.gear; SD.doors = s.doors; SD.sb = s.sb; SD.gsp = s.gsp; SD.rud = s.rud; SD.ths = s.ths;
  SD.hWing = s.hWing;
  partsInto(PA.design, SD, OD);
  partsInto(PA.base, SD, OB);
  o.CL += OD.CL - OB.CL; o.CD += OD.CD - OB.CD; o.CY += OD.CY - OB.CY;
  o.Cl += OD.Cl - OB.Cl; o.Cm += OD.Cm - OB.Cm; o.Cn += OD.Cn - OB.Cn;
  o.CmElev += OD.dCmElev - OB.dCmElev;
  o.clmax += OD.clmax - OB.clmax;
  o.dClAil = OD.dClAil - OB.dClAil;
  o.dClSp = OD.dClSp - OB.dClSp;
  return o;
}

// The maximum lift's difference (on the base's S) at a slat, flap and Mach, for the sim's speeds (VLS, the stall
// warning, α prot): the wing's strips' clmax, the design's less the base's. Only the wing's sections (no flow, no tails),
// as partsInto() sums them (tests/parts-aero.test.mjs holds the two equal), and the last answer kept: the sim asks twice
// a step with the same inputs. A pure function of its inputs, so the memo changes nothing but the cost.
// v0.5.4: the lumped model's maximum-lift loss with Mach (flightmodel.js's), at a side's normal Mach
function clmaxMachOf(A, Mn) { return Math.max(0.55, 1 - A.CLMAX_MACH_SLOPE * Math.max(0, Mn - 0.35)); }
function wingClmax(P, slat, flap, M) {
  const A = P.A, C = P.C, fm = P.fm, L0 = P.lc[0], L1 = P.lc[1], L2 = P.lc[2];
  fm.liftCurve(0, 0, L0); fm.liftCurve(slat, 0, L1); fm.liftCurve(slat, flap, L2);
  const clmaxMachL = clmaxMachOf(A, M * P.normalMach[0]), clmaxMachR = clmaxMachOf(A, M * P.normalMach[1]);   // v0.5.4: as partsInto()
  const knee = A.KNEE, W = P.wing;
  let sum = 0;
  for (let i = 0; i < W.length; i++) {
    const st = W[i], si = st.side > 0 ? 0 : 1;
    const fS = st.slat * P.rSlat, fF = st.flap * P.rFlap;
    let a = L0.a + fF * (L2.a - L1.a);
    const cl0 = L0.cl0 + C.kFlapCL * (fS * (L1.cl0 - L0.cl0) + fF * (L2.cl0 - L1.cl0)) + C.dcl0;
    const cm0 = L0.clmax * C.kClmax + C.kClmaxHL * (fS * (L1.clmax - L0.clmax) + fF * (L2.clmax - L1.clmax));
    a *= C.kA * P.kWing * PG(M, P.sweepMach[si]);
    const clmax = cm0 * (si === 0 ? clmaxMachL : clmaxMachR);
    const aMax = (clmax - cl0) / a + knee / 2 + st.dAlphaMax;
    sum += st.S * (cl0 + a * (aMax - knee / 2));
  }
  return sum / P.ref.S;
}
export { wingClmax };
const CM = { PA: null, slat: NaN, flap: NaN, M: NaN, d: 0 };
export function clmaxDelta(PA, slat, flap, M) {
  if (CM.PA === PA && CM.slat === slat && CM.flap === flap && CM.M === M) return CM.d;
  const d = wingClmax(PA.design, slat, flap, M) - wingClmax(PA.base, slat, flap, M);
  CM.PA = PA; CM.slat = slat; CM.flap = flap; CM.M = M; CM.d = d;
  return d;
}
