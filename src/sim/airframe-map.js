// v0.5.3: a design's airframe as maps from its base's geometry (the geometry frame: x forward, y left, z up, metres,
// origin at the base's 25 % MAC on the centreline, which stays the design's reference point). The same maps move the
// parts' strips (src/sim/parts-aero.js, which builds its stations the same way), the model's vertices (aircraft.js,
// widebody.js), the mounts (src/sim/designs.js) and the warehouse's outline, so everything agrees.
//
//   airframeMap(base, af) → {
//     identity,                         // true for the base's own airframe (every map returns its input)
//     wing(side, x, y, z) → [x, y, z]   // a point on (or hung off) a wing side (side 1 left, y > 0; −1 right): from the
//                                       // fuselage's side out, its span × span, its chord × chord about each station's
//                                       // quarter chord, swung by the sweep about the root's quarter chord, its dihedral
//                                       // line turned, its thickness × chord
//     wingStation(side, yBase) → y      // where a base station goes (|y|)
//     wingBase(side, y) → yBase         // the inverse
//     tail(x, y, z), fin(x, y, z)       // the tailplane and the fin: scaled about their roots' quarter chords (area ×
//                                       // tail or fin, aspect ratio and sweep kept), and moved back with the aft plug
//     bodyX(x) → x                      // the fuselage's stations: ahead of FWD_CUT moved forward by plugFwd, behind
//                                       // AFT_CUT moved back by plugAft, between them as they were
//     bodyXBase(x) → x                  // the inverse (a station in the plugs gives the cut's own: a constant section)
//     cuts: { fwd, aft }                // the base's cut stations (x)
//     plugFwd, plugAft, af, base, ys, tipY: [left, right] (|y| of each wing's tip), span (tip to tip)
//   }

import { typeById } from './types.js';
import { baseShape } from './parts-aero.js';

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Where the plugs go in: in the cabin's constant section, just ahead of the wing's root and just behind it (the
// fuselage is a cylinder there on all three types: aircraft.js's and widebody-specs.js's tables).
const CUT_GAP = 1.0;   // m clear of the wing's root
export function plugCuts(base) {
  const W = typeById(base).geo.WING;
  return { fwd: W.rootX + CUT_GAP, aft: W.rootX - W.rootChord - CUT_GAP };
}

// The base wing's planform, piecewise linear through the parts' stations (root at the fuselage's side, kink, tip):
// its quarter chord's x, its chord and its chord plane's height at a span.
function planform(base) {
  const st = baseShape(base).wing.stations;
  const at = (y) => {
    const yy = clamp(y, st[0].y, st[st.length - 1].y);
    let k = 0;
    while (k < st.length - 2 && yy > st[k + 1].y) k++;
    const a = st[k], b = st[k + 1], t = (yy - a.y) / (b.y - a.y);
    const c = a.c + (b.c - a.c) * t, xle = a.xle + (b.xle - a.xle) * t;
    return { qc: xle - c / 4, c, z: a.z + (b.z - a.z) * t };
  };
  return { st, at, ys: st[0].y, tip: st[st.length - 1].y, qc0: st[0].xle - st[0].c / 4, z0: st[0].z };
}

const MAPS = new Map();
export function airframeMap(base, af) {
  const T = typeById(base), id = T.id;
  const key = id + '|' + (af ? JSON.stringify([af.wingL, af.wingR, af.tail, af.fin, af.plugFwd, af.plugAft, af.sharklets !== false]) : '');
  let m = MAPS.get(key);
  if (m) return m;
  const P = planform(id), S = baseShape(id), G = T.geo;
  const dih0 = G.WING.dihedralDeg * DEG;
  const sideOf = (side) => (af ? (side > 0 ? af.wingL : af.wingR) : { span: 1, chord: 1, sweep: 0, dihedral: G.WING.dihedralDeg });
  const ident = !af || (['wingL', 'wingR'].every((k) => af[k].span === 1 && af[k].chord === 1 && af[k].sweep === 0 && af[k].dihedral === G.WING.dihedralDeg)
    && af.tail === 1 && af.fin === 1 && af.plugFwd === 0 && af.plugAft === 0 && af.sharklets !== false);
  const wingSideMap = (side) => {
    const w = sideOf(side), ys = P.ys;
    const tanD = Math.tan(w.dihedral * DEG), tanD0 = Math.tan(dih0);
    return (x, y, z) => {
      const ay = Math.abs(y), s = Math.sign(y) || side;
      const yb = Math.max(ay, ys);
      const pf = P.at(yb);
      // the base's quarter-chord line's sweep at this station, from the root's quarter chord
      const t0 = yb > ys + 1e-9 ? (P.qc0 - pf.qc) / (yb - ys) : 0;
      const yn = ay <= ys ? ay : ys + (ay - ys) * w.span;
      const dyn = Math.max(0, yn - ys);
      const qcN = P.qc0 - dyn * Math.tan(Math.atan(t0) + w.sweep * DEG);
      const xn = qcN + (x - pf.qc) * w.chord;
      // the chord plane's height: the base's dihedral line turned to the design's, the rest (camber, twist, the
      // drawn heights) kept, the thickness × chord about the chord plane
      const planeB = P.z0 + (yb - ys) * tanD0;
      const resid = pf.z - planeB;            // the drawn chord plane's own departure from the dihedral line
      const zn = P.z0 + dyn * tanD + resid * w.span + (z - pf.z) * w.chord;
      return [xn, s * yn, zn];
    };
  };
  const WL = wingSideMap(1), WR = wingSideMap(-1);
  const fwd = af ? af.plugFwd : 0, aft = af ? af.plugAft : 0;
  const cuts = plugCuts(id);
  // tailplane and fin: about their roots' quarter chords (the parts' stations[0])
  const t0 = S.tail.stations[0], tq = t0.xle - t0.c / 4, kt = Math.sqrt(af ? af.tail : 1);
  const f0 = S.fin.stations[0], fq = f0.xle - f0.c / 4, kf = Math.sqrt(af ? af.fin : 1);
  const tail = (x, y, z) => {
    const ay = Math.abs(y), s = Math.sign(y);
    const yn = ay <= t0.y ? ay : t0.y + (ay - t0.y) * kt;
    return [tq + (x - tq) * kt - aft, s * yn, t0.z + (z - t0.z) * kt];
  };
  const fin = (x, y, z) => [fq + (x - fq) * kf - aft, y * kf, z <= f0.z ? z : f0.z + (z - f0.z) * kf];
  const bodyX = (x) => (x > cuts.fwd ? x + fwd : x < cuts.aft ? x - aft : x);
  const bodyXBase = (x) => (x > cuts.fwd + fwd ? x - fwd : x >= cuts.fwd ? cuts.fwd : x < cuts.aft - aft ? x + aft : x <= cuts.aft ? cuts.aft : x);
  const sL = sideOf(1), sR = sideOf(-1);
  const tipL = P.ys + (P.tip - P.ys) * sL.span, tipR = P.ys + (P.tip - P.ys) * sR.span;
  // the base's own wingtip (G.SPAN/2) may lie past the parts' tip station (the A321's sharklets): it scales the same
  // (v0.5.3, extra time) with the sharklets off the tip is the parts' own (17.0 m on the A321)
  const tipG = af && af.sharklets === false ? P.tip : G.SPAN / 2;
  m = {
    identity: ident, base: id, af, cuts, plugFwd: fwd, plugAft: aft, ys: P.ys,
    wing: (side, x, y, z) => (ident ? [x, y, z] : (side > 0 ? WL : WR)(x, y, z)),
    wingStation: (side, yb) => (yb <= P.ys ? yb : P.ys + (yb - P.ys) * sideOf(side).span),
    wingBase: (side, y) => (y <= P.ys ? y : P.ys + (y - P.ys) / sideOf(side).span),
    tail: ident ? (x, y, z) => [x, y, z] : tail,
    fin: ident ? (x, y, z) => [x, y, z] : fin,
    bodyX: ident ? (x) => x : bodyX, bodyXBase: ident ? (x) => x : bodyXBase,
    tailScale: kt, finScale: kf,
    tipY: [P.ys + (tipG - P.ys) * sL.span, P.ys + (tipG - P.ys) * sR.span],
    span: P.ys * 2 + (tipG - P.ys) * (sL.span + sR.span),
    partsTip: [tipL, tipR],
  };
  if (MAPS.size > 64) MAPS.clear();
  MAPS.set(key, m);
  return m;
}
