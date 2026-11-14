// v0.5.0: one engine builder for all three aircraft. Each engine type has its own look, wherever it hangs: the
// LEAP-1A as aircraft.js always drew the A321's, the GEnx-1B and the GE90-115B as widebody.js drew the 787's and
// the 777's (their specs' `engine` fields, src/widebody-specs.js). So a GE90 can hang on an A321 and four on a 777.
//
//   addEngine(b, bone, n, host) → { k, eng, fan, rev, rate, travel }
//     b:    the airframe's Builder (aircraft.js); every part goes into its one skinned mesh (no draw call of its own)
//     bone: the airframe's bone(name, parent, pivot, axis) maker
//     n:    a nacelle { x, y, z, D, L, engine, i, tail? } in the body frame (src/geometry.js; designDef()'s
//           geo.NACELLES): its centre, diameter and length, the ENGINE_TYPES id, its index
//     host: { wingSec(y, side) → the wing's section at span y, bend: true on the Boeings (each part passes the
//           nacelle's span as bendY, so the engine rides the bent wing as one piece), finLeX(z) → the fin's
//           leading edge's x at height z (for the tail engine's fillet) }
//   A wing engine hangs on its pylon, up to the wing's underside at its station; the tail engine (n.tail, three
//   engines) sits on the crown with the fin's root carried forward over its back half by a fillet, DC-10 style.
//   Bones: 'eng<i>' at the nacelle's centre carries the whole engine and its pylon (scaled to nothing when the
//   engine is torn off), 'fan<i>' (turns about the axis) and 'rev<i>' (the reverser's sleeve slides aft) under it.
//   rate: the fan's visual turns per second at 100 % N1; travel: the sleeve's travel, m.
//
// A base type's own engines go through here too, part for part and in the order they always were, so its
// geometry is what it was (the same vertices, triangles and colours; only the parts' bones are new).

import * as THREE from '../vendor/three.module.js';
import { lathe, grid, boxAt, foilPoint, foilPiece } from './aircraft.js';
import { curve } from './widebody-shape.js';
import { UV } from './livery.js';
import { B787_9, B777_300ER } from './widebody-specs.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// The engine colours, as aircraft.js and widebody.js have them (the same in both).
const C = {
  white: '#f3f5f7', navy: '#122654', core: '#767b83', plug: '#3a3d43', fanFace: '#25282e', blade: '#5a6068',
  pylon: '#d5d9de', cascade: '#3d4148', fanCase: '#7a8189',
};

// The widebodies' nacelle profile, in fractions: x of half the cowl's length from its centre, r of its radius.
// The GEnx's long, clean nacelle: no step behind the lip, widest a quarter of the way back. (From widebody.js.)
export const INTAKE = [
  [0.62, 0.742, 0], [0.78, 0.757, 0.1], [0.92, 0.795, 0.22], [0.975, 0.825, 0.3], [1.0, 0.86, 0.36], [1.0, 0.895, 0.42],
  [0.975, 0.925, 0.48], [0.93, 0.95, 0.55], [0.80, 0.98, 0.6], [0.55, 1.0, 0.68], [0.2, 0.995, 0.8], [-0.04, 0.975, 1],
];
export const SLEEVE = [
  // x, r, how far the row follows the chevrons (0..1)
  [-0.04, 0.975, 0], [-0.4, 0.93, 0], [-0.72, 0.865, 0.1], [-0.88, 0.825, 0.55], [-1.0, 0.79, 1],
  [-0.995, 0.78, 1], [-0.86, 0.80, 0.5], [-0.5, 0.84, 0], [-0.04, 0.87, 0],
];

// Each engine type's look: 'leap' is aircraft.js's LEAP-1A (drawn in metres: its D 2.4 and L 5.0), 'wide' is
// widebody.js's (drawn in fractions of the nacelle's D and L, with that spec's engine fields).
export const ENGINE_LOOKS = {
  'leap-1a': { style: 'leap', rate: 7.5, travel: 0.6 },
  'genx-1b': { style: 'wide', en: B787_9.engine, coreL: B787_9.geo.NACELLE_CORE_LENGTH, rate: 6.5, travel: B787_9.engine.revTravel },
  'ge90-115b': { style: 'wide', en: B777_300ER.engine, coreL: B777_300ER.geo.NACELLE_CORE_LENGTH, rate: 6.5, travel: B777_300ER.engine.revTravel },
};
export const lookOf = (id) => ENGINE_LOOKS[id] || ENGINE_LOOKS['leap-1a'];

export function addEngine(b, bone, n, host) {
  const look = lookOf(n.engine);
  const k = n.i ?? 0;
  const side = n.y >= 0 ? 1 : -1;
  const eng = 'eng' + k, fan = 'fan' + k, rev = 'rev' + k;
  const EB = bone(eng, 'root', V(n.x, n.y, n.z));
  // The bend: a rigid engine rides the wing at its own span; the tail engine and a body engine (v0.5.2) aren't on
  // the wing (span 0).
  const BY = host.bend ? (n.tail || n.mount === 'body' ? 0 : n.y) : null;
  // v0.5.2: a design's engine turned a few degrees (its thrust line, designs.js placeEngine()): every part, pylon
  // included, turns about the nacelle's centre (yaw about z, then pitch about y), and the fan's axis with it.
  let bb = b, bn = bone;
  if (n.yaw || n.pitch) {
    const R = new THREE.Matrix4().makeTranslation(n.x, n.y, n.z)
      .multiply(new THREE.Matrix4().makeRotationZ(-(n.yaw || 0) * DEG))
      .multiply(new THREE.Matrix4().makeRotationY(-(n.pitch || 0) * DEG))
      .multiply(new THREE.Matrix4().makeTranslation(-n.x, -n.y, -n.z));
    const R3 = new THREE.Matrix3().setFromMatrix4(R);
    bb = { add: (g, ...rest) => b.add(g.applyMatrix4(R), ...rest) };
    bn = (name, parent, pivot, axis = V(1, 0, 0)) => bone(name, parent, pivot, axis.clone().applyMatrix3(R3).normalize());
  }
  if (look.style === 'leap') leapEngine(bb, bn, n, host, EB, eng, fan, rev, side, BY);
  else wideEngine(bb, bn, n, host, EB, eng, fan, rev, side, BY, look);
  return { k, eng, fan, rev, rate: look.rate, travel: look.travel };
}

// v0.5.2: the pylons of the mounts that aren't under the wing. A profile in (x, z) extruded sideways ((X, Y, Z) →
// body (X, −Z + y, Y)), or for the body's stub a plan in (x, y) extruded up ((X, Y, Z) → body (X, Y, Z + z)).
const SIDEWAYS = (y) => new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, y, 0, 1, 0, 0, 0, 0, 0, 1);
function blade(pts, depth, y) {
  const sh = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? sh.lineTo(x, z) : sh.moveTo(x, z)));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g.applyMatrix4(SIDEWAYS(y));
}
// Over the wing: a blade from the nacelle's underside down into the wing's upper surface (HondaJet style).
function overwingPylon(b, n, host, EB, BY) {
  const R = n.D / 2, side = n.y >= 0 ? 1 : -1, w = host.wingSec(Math.abs(n.y), side);
  const upper = (x) => foilPoint(w, clamp((w.le.x - x) / w.chord, 0, 1), 1).z;
  const xa = n.x + 0.18 * n.L, xb = n.x - 0.32 * n.L, zt = n.z - 0.7 * R;
  const pts = [[xa, zt], [xb - 0.4, zt], [xb, upper(xb) - 0.12], [xa - 0.3, upper(xa - 0.3) - 0.12]];
  b.add(blade(pts, Math.max(0.3, 0.16 * n.D), n.y), EB, C.pylon, null, BY);
}
// On the rear fuselage's side: a short swept stub from inside the skin out into the nacelle (MD-80 style).
function bodyPylon(b, n, host, EB, BY) {
  const R = n.D / 2, side = n.y >= 0 ? 1 : -1, yIn = side * (host.bodyHalf - 0.6), yOut = n.y - side * 0.7 * R;
  const sh = new THREE.Shape();
  const P = [[n.x + 0.25 * n.L, yIn], [n.x - 0.38 * n.L, yIn], [n.x - 0.3 * n.L, yOut], [n.x + 0.12 * n.L, yOut]];
  P.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
  const depth = Math.max(0.35, 0.18 * n.D);
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
  g.translate(0, 0, n.z - depth / 2);
  b.add(g, EB, C.pylon, null, BY);
}

// v0.5.2: an external fuel tank (designs.js placeTank()): a teardrop on a short pylon up into the wing's underside.
// Its bone 'pod<k>' at its centre; it rides the bent wing at its span.
export function addPod(b, bone, t, host, k) {
  const R = t.D / 2, L = t.L, side = t.y >= 0 ? 1 : -1;
  const PB = bone('pod' + k, 'root', V(t.x, t.y, t.z));
  const BY = host.bend ? t.y : null;
  b.add(lathe([
    { x: 0.5 * L, r: 0.0 }, { x: 0.46 * L, r: 0.3 * R }, { x: 0.38 * L, r: 0.62 * R }, { x: 0.26 * L, r: 0.88 * R }, { x: 0.1 * L, r: R },
    { x: -0.14 * L, r: R }, { x: -0.3 * L, r: 0.84 * R }, { x: -0.42 * L, r: 0.55 * R }, { x: -0.5 * L, r: 0.12 * R },
  ], 28, t.x, t.y, t.z), PB, C.white, null, BY);
  b.add(lathe([{ x: 0.06 * L, r: R * 1.004 }, { x: -0.02 * L, r: R * 1.004 }], 28, t.x, t.y, t.z), PB, C.navy, null, BY);
  const w = host.wingSec(Math.abs(t.y), side);
  const lower = (x) => foilPoint(w, clamp((w.le.x - x) / w.chord, 0, 1), -1).z;
  const xa = t.x + 0.2 * L, xb = t.x - 0.22 * L, zb = t.z + 0.6 * R;
  b.add(blade([[xa, zb], [xb, zb], [xb - 0.3, lower(xb - 0.3) + 0.12], [xa - 0.4, lower(xa - 0.4) + 0.12]], Math.max(0.16, 0.14 * t.D), t.y), PB, C.pylon, null, BY);
}

// The LEAP-1A: nacelle, pylon, fan and the translating cowl of the thrust reverser (aircraft.js until v0.5.0).
function leapEngine(b, bone, n, host, EB, eng, fan, rev, side, BY) {
  const ex = n.x, ey = n.y, ez = n.z;
  b.add(lathe([
    { x: 1.45, r: 0.93, v: 0 }, { x: 1.9, r: 0.95, v: 0.12 }, { x: 2.25, r: 0.985, v: 0.24 }, { x: 2.42, r: 1.01, v: 0.3 },
    { x: 2.5, r: 1.04, v: 0.36 }, { x: 2.53, r: 1.08, v: 0.42 }, { x: 2.51, r: 1.12, v: 0.48 }, { x: 2.44, r: 1.155, v: 0.55 },
    { x: 2.2, r: 1.19, v: 0.6 }, { x: 1.6, r: 1.215, v: 0.68 }, { x: 0.8, r: 1.21, v: 0.8 }, { x: 0.05, r: 1.18, v: 1 },
  ], 44, ex, ey, ez, UV.nacelle), EB, '#ffffff', 'keep', BY);
  const REV = bone(rev, eng, V(ex, ey, ez));
  b.add(lathe([
    { x: 0.05, r: 1.18 }, { x: -0.6, r: 1.125 }, { x: -1.2, r: 1.02 }, { x: -1.5, r: 0.94 },
    { x: -1.45, r: 0.9 }, { x: -0.9, r: 0.95 }, { x: 0.0, r: 1.02 },
  ], 44, ex, ey, ez), REV, C.navy, null, BY);
  b.add(lathe([{ x: 0.0, r: 1.09 }, { x: -0.6, r: 1.06 }], 32, ex, ey, ez), EB, C.cascade, null, BY);
  b.add(lathe([{ x: 0.6, r: 0.62 }, { x: -0.6, r: 0.72 }, { x: -1.5, r: 0.64 }, { x: -2.05, r: 0.52 }, { x: -2.08, r: 0.46 }], 32, ex, ey, ez), EB, C.core, null, BY);
  b.add(lathe([{ x: -1.9, r: 0.43 }, { x: -2.3, r: 0.25 }, { x: -2.52, r: 0.02 }], 24, ex, ey, ez), EB, C.plug, null, BY);
  // v0.4.3: the fan case, from the reverser cowl's inner lip (x 0.0) forward to the intake's inner end (1.45):
  // the cowl was hollow there, so past the fan face's rim a look into the intake went through the inside of
  // the cowl, whose faces point out (Shane: "you can see through the edges"). The fan face reaches it, and
  // a disc just behind faces aft, so a look up the fan nozzle meets the fan, not the sky in front.
  b.add(lathe([{ x: 0.0, r: 1.02 }, { x: 0.5, r: 0.989 }, { x: 1.0, r: 0.958 }, { x: 1.45, r: 0.93 }], 44, ex, ey, ez), EB, C.fanCase, null, BY);
  b.add(lathe([{ x: 1.32, r: 0.0 }, { x: 1.32, r: 0.95 }], 32, ex, ey, ez), EB, C.fanFace, null, BY);
  b.add(lathe([{ x: 1.308, r: 0.95 }, { x: 1.308, r: 0.0 }], 32, ex, ey, ez), EB, C.fanFace, null, BY);
  b.add(lathe([{ x: -0.25, r: 1.0 }, { x: -0.25, r: 0.68 }], 32, ex, ey, ez), EB, C.fanFace, null, BY);
  const FAN = bone(fan, eng, V(ex, ey, ez), V(1, 0, 0));
  b.add(lathe([{ x: 2.0, r: 0.0 }, { x: 1.93, r: 0.15 }, { x: 1.76, r: 0.29 }, { x: 1.55, r: 0.38 }, { x: 1.42, r: 0.39 }], 24, ex, ey, ez), FAN, C.navy, null, BY);
  // one white swirl on the spinner so the rotation shows
  b.add(boxAt(ex + 1.72, ey, ez + 0.16, 0.36, 0.05, 0.2).rotateX(0).translate(0, 0, 0), FAN, C.white, null, BY);
  for (let i = 0; i < 18; i++) {
    const g = new THREE.BoxGeometry(0.34, 0.03, 0.56);
    g.rotateZ(38 * DEG);          // blade twist (about the radial axis, z here)
    g.translate(0, 0, 0.66);
    g.rotateX((i / 18) * Math.PI * 2);
    g.translate(ex + 1.45, ey, ez);
    b.add(g, FAN, C.blade, null, BY);
  }
  if (n.tail) { tailFillet(b, n, host, EB, BY); return; }
  if (n.mount === 'overwing') { overwingPylon(b, n, host, EB, BY); return; }
  if (n.mount === 'body') { bodyPylon(b, n, host, EB, BY); return; }
  // Pylon: a profile in (x, z) extruded sideways. Its lower edge sits inside the nacelle's
  // top and its upper edge rises to the wing's leading edge, then runs on inside the wing.
  {
    const sh = new THREE.Shape();
    const w = host.wingSec(Math.abs(ey), side);
    const lower = (x) => foilPoint(w, clamp((w.le.x - x) / w.chord, 0, 1), -1).z;  // wing's lower surface
    const pts = [[ex + 1.8, ez + 1.15], [ex + 0.6, ez + 1.42], [w.le.x + 0.1, w.le.z + 0.01], [ex - 2.2, lower(ex - 2.2) + 0.1],
      [ex - 4.2, lower(ex - 4.2) + 0.06], [ex - 4.9, lower(ex - 4.9) + 0.04], [ex - 5.2, lower(ex - 5.2) - 0.14],
      [ex - 3.8, ez + 1.13], [ex - 2.0, ez + 0.89], [ex - 1.0, ez + 0.98], [ex + 1.0, ez + 1.15]];
    pts.forEach(([x, z], i) => (i ? sh.lineTo(x, z) : sh.moveTo(x, z)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.42, bevelEnabled: false });
    g.translate(0, 0, -0.21);
    // shape (X, Y, Z) → body (x = X, y = −Z, z = Y)
    g.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, ey, 0, 1, 0, 0, 0, 0, 0, 1));
    b.add(g, EB, C.pylon, null, BY);
  }
}

// The widebodies' engine (widebody.js until v0.5.0), with an engine spec's fields: the intake and sleeve
// profiles, the fan's blades and radius, chevrons, the spinner, the core's radius, the pylon's depth.
function wideEngine(b, bone, n, host, EB, eng, fan, rev, side, BY, look) {
  const ex = n.x, ey = n.y, ez = n.z, RN = n.D / 2, HL = n.L / 2, CL = look.coreL;
  const EN = look.en, RF = EN.fanR;
  // v0.4.3: every part of the engine rides the wing's bend at the pylon's span (ey), as one piece; bent
  // vertex by vertex, the fan's blades, turning, carried each one's own lift round with them, and the fan
  // sat off the nacelle's axis in flight (Shane: "the fan blades … aren't centered correctly").
  const INT = EN.intake || INTAKE;
  b.add(lathe(INT.map(([f, r, v]) => ({ x: f * HL, r: r * RN, v })), 48, ex, ey, ez, UV.nacelle), EB, '#ffffff', 'keep', BY);
  // The translating sleeve, with the chevrons on its trailing edge.
  const REV = bone(rev, eng, V(ex, ey, ez));
  {
    const segs = EN.chevrons ? EN.chevrons * 4 : 48, rows = [];     // chevrons: 0 is a plain nozzle
    for (const [f, rr, k] of EN.sleeve || SLEEVE) {
      const row = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const tooth = EN.chevrons ? Math.abs((((i / segs) * EN.chevrons) % 1) * 2 - 1) : 1;  // 1 at a chevron's tip, 0 in the notch
        const x = ex + f * HL - k * EN.chevronDepth * (1 - tooth);          // the notch is cut forward
        row.push(V(x, ey + rr * RN * Math.cos(a), ez + rr * RN * Math.sin(a)));
      }
      rows.push(row);
    }
    b.add(grid(rows), REV, C.navy, null, BY);
  }
  // Inside: the cascades that show when the sleeve moves back, the fan duct, the core and its plug.
  b.add(lathe([{ x: -0.04 * HL + 0.0, r: 0.95 * RN }, { x: -0.5 * HL, r: 0.885 * RN }], 32, ex, ey, ez), EB, C.cascade, null, BY);
  const CR = EN.coreR ?? 1;    // the core's radius against the 787's, for a bigger bypass ratio
  b.add(lathe([
    { x: 0.42 * HL, r: 0.33 * RN * CR }, { x: -0.1 * HL, r: 0.5 * RN * CR }, { x: -0.7 * HL, r: 0.5 * RN * CR }, { x: -1.0 * HL, r: 0.46 * RN * CR },
    { x: -HL - 0.55 * CL, r: 0.34 * RN * CR }, { x: -HL - 0.58 * CL, r: 0.27 * RN * CR },
  ], 32, ex, ey, ez), EB, C.core, null, BY);
  b.add(lathe([{ x: -HL - 0.5 * CL, r: 0.26 * RN * CR }, { x: -HL - 0.8 * CL, r: 0.16 * RN * CR }, { x: -HL - CL, r: 0.01 }], 20, ex, ey, ez), EB, C.plug, null, BY);
  // v0.4.3: the fan case, the duct's wall from the reverser's inner lip forward to the intake's inner end.
  // Without it the cowl was hollow from the fan's rim back to the reverser, and past the fan face's edge
  // a look into the intake went through the inside of the cowl, whose faces point out (Shane: "you can
  // see through the edges"). The fan face now reaches the wall, and a disc behind it faces aft, so a look
  // up the fan nozzle meets the back of the fan, not the sky ahead of the engine.
  const SLV = EN.sleeve || SLEEVE, IN0 = INT[0], SL1 = SLV[SLV.length - 1];
  const wA = { x: SL1[0] * HL, r: SL1[1] * RN }, wB = { x: IN0[0] * HL, r: IN0[1] * RN };
  let lipI = INT.findIndex(([f]) => f >= 0.999);
  if (lipI < 1) lipI = 1;
  const innerR = (x) => {                // the duct's radius at x: the case behind the intake, the intake ahead
    if (x <= wB.x) return wA.r + (wB.r - wA.r) * clamp((x - wA.x) / (wB.x - wA.x), 0, 1);
    for (let k = 0; k < lipI; k++) {
      const x0 = INT[k][0] * HL, x1 = INT[k + 1][0] * HL;
      if (x <= x1) return (INT[k][1] + (INT[k + 1][1] - INT[k][1]) * clamp((x - x0) / (x1 - x0), 0, 1)) * RN;
    }
    return INT[lipI][1] * RN;
  };
  b.add(lathe([0, 0.35, 0.7, 1].map((t) => ({ x: wA.x + (wB.x - wA.x) * t, r: wA.r + (wB.r - wA.r) * t })), 48, ex, ey, ez), EB, C.fanCase, null, BY);
  const xFace = ((EN.fanF ?? 0.6) - 0.02) * HL, rFace = Math.max(RF, innerR(xFace) + 0.012);
  b.add(lathe([{ x: xFace, r: 0 }, { x: xFace, r: rFace }], 32, ex, ey, ez), EB, C.fanFace, null, BY);
  b.add(lathe([{ x: xFace - 0.012, r: rFace }, { x: xFace - 0.012, r: 0 }], 32, ex, ey, ez), EB, C.fanFace, null, BY);
  const FAN = bone(fan, eng, V(ex, ey, ez), V(1, 0, 0));
  const fx = (EN.fanF ?? 0.6) * HL, SK = EN.spinnerK ?? 1, HUB = 0.4 * SK;
  const spinnerAt = [[0.72, 0], [0.62, 0.11], [0.36, 0.27], [0.08, 0.42], [-0.08, 0.46]];
  b.add(lathe(spinnerAt.map(([x, r]) => ({ x: fx + x * SK, r: r * SK })), 24, ex, ey, ez), FAN, C.navy, null, BY);
  if (EN.swirl) {
    // The white spiral painted on the spinner: a ribbon just proud of it, half a turn from tip to base.
    const spin = curve(spinnerAt.map(([x, r]) => [x, r]).reverse()), rows = [];
    for (const w of [-1, 1]) {
      const row = [];
      for (let k = 0; k <= 14; k++) {
        const s = k / 14, xs = 0.68 - 0.74 * s, a = s * Math.PI * 1.1 + w * (0.05 + 0.16 * s);
        const r = (spin(xs) + 0.012) * SK;
        row.push(V(ex + fx + xs * SK, ey + r * Math.cos(a), ez + r * Math.sin(a)));
      }
      rows.push(row);
    }
    b.add(grid(rows, { expect: (c) => V(0.4, c.y - ey, c.z - ez) }), FAN, C.white, null, BY);
  } else b.add(boxAt(ex + fx + 0.3, ey, ez + 0.2, 0.42, 0.05, 0.2), FAN, C.white, null, BY);  // so the rotation shows
  for (let i = 0; i < EN.fanBlades; i++) {
    // A blade: long chord, with the twist and sweep a composite fan blade has.
    const g = new THREE.BoxGeometry(0.62 * SK, 0.03, RF - HUB, 1, 1, 4);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const r01 = (p.getZ(k) + (RF - HUB) / 2) / (RF - HUB), tw = (58 - 34 * r01) * DEG;
      const cx = p.getX(k), cy = p.getY(k);
      p.setXYZ(k, cx * Math.cos(tw) - cy * Math.sin(tw) - 0.16 * r01 * r01, cx * Math.sin(tw) + cy * Math.cos(tw), p.getZ(k));
    }
    g.computeVertexNormals();
    g.translate(0, 0, HUB + (RF - HUB) / 2);
    g.rotateX((i / EN.fanBlades) * Math.PI * 2);
    g.translate(ex + fx, ey, ez);
    b.add(g, FAN, C.blade, null, BY);
  }
  if (n.tail) { tailFillet(b, n, host, EB, BY); return; }
  if (n.mount === 'overwing') { overwingPylon(b, n, host, EB, BY); return; }
  if (n.mount === 'body') { bodyPylon(b, n, host, EB, BY); return; }
  // Pylon: a profile in (x, z) extruded sideways, from the cowl's top into the wing and back
  // under it to the fairing behind the trailing edge.
  {
    const w = host.wingSec(Math.abs(ey), side), sh = new THREE.Shape();
    const lower = (x) => foilPoint(w, clamp((w.le.x - x) / w.chord, 0, 1), -1).z;
    const xNoz = ex - HL, tail = w.le.x - w.chord * 0.95;
    const pts = [
      [ex + 0.5 * HL, ez + RN * 0.97], [ex + 0.05 * HL, ez + RN + 0.08], [w.le.x + 0.15, w.le.z + 0.05], [w.le.x - 1.2, lower(w.le.x - 1.2) + 0.2],
      [tail + 1.4, lower(tail + 1.4) + 0.06], [tail, lower(tail) - 0.02], [tail - 0.7, lower(tail) - 0.2],
      [tail + 0.2, lower(tail) - 0.5], [xNoz - 1.0, ez + RN * 0.42], [xNoz, ez + RN * 0.52], [xNoz + 0.15, ez + RN * 0.72],
      [ex - 0.2 * HL, ez + RN * 0.9],
    ];
    pts.forEach(([x, z], i) => (i ? sh.lineTo(x, z) : sh.moveTo(x, z)));
    const PD = EN.pylonDepth ?? 0.5;
    const g = new THREE.ExtrudeGeometry(sh, { depth: PD, bevelEnabled: false });
    g.translate(0, 0, -PD / 2);
    g.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, ey, 0, 1, 0, 0, 0, 0, 0, 1));
    b.add(g, EB, C.pylon, null, BY);
  }
}

// The tail engine's fillet: the fin's root carried forward over the nacelle's back half, its leading edge from the
// cowl's crown up to the fin's leading edge, so the fin rises out of the engine (DC-10 style). A thin symmetric
// foil on the centreline (as the widebodies' dorsal fillet), each section ending 2 m into the fin; its foot is
// inside the nacelle and the crown.
function tailFillet(b, n, host, EB, BY) {
  if (!host.finLeX) return;
  const R = n.D / 2, xc = n.x, zc = n.z, zA = zc + 0.9 * R, zt = zc + R + 0.35 * n.D;
  const xT = host.finLeX(zt) - 0.1;
  const leAt = (z) => (z <= zA ? xc : xc + ((xT - xc) * (z - zA)) / (zt - zA));
  const sec = (z) => {
    const le = leAt(z), chord = Math.max(1, le - (host.finLeX(z) - 2));
    return { le: V(le, 0, z), chord, t: 0.12, c: V(-1, 0, 0), n: V(0, 1, 0), camber: 0 };
  };
  const zs = [zc - 0.5 * R, zA, zA + (zt - zA) / 3, zA + (2 * (zt - zA)) / 3, zt];
  b.add(foilPiece(zs.map(sec), 0, 1, { caps: [false, true], nf: 8 }), EB, C.navy, null, BY);
}

// The engines' animation, shared by both airframes: each fan turns with its own engine's N1, each sleeve slides
// with its own reverser, and an engine that's `off` (torn off its pylon) is gone with its pylon. No allocation.
export function engineAnimator(list, B, toModel) {
  const ang = new Float64Array(list.length), gone = new Uint8Array(list.length), tmp = new THREE.Vector3();
  return function update(en, dt) {
    for (let j = 0; j < list.length; j++) {
      const E = list[j], s = en[E.k];
      ang[j] = (ang[j] + ((s?.n1 || 0) / 100) * E.rate * Math.PI * 2 * dt) % (Math.PI * 2);
      const f = B[E.fan];
      f.quaternion.setFromAxisAngle(f.userData.axis, ang[j]);
      const r = B[E.rev];
      r.position.copy(r.userData.rest).add(toModel(-E.travel * clamp(s?.rev || 0, 0, 1), 0, 0, tmp));
      const off = s?.off === true ? 1 : 0;
      if (off !== gone[j]) { gone[j] = off; B[E.eng].scale.setScalar(off ? 1e-4 : 1); }
    }
  };
}
