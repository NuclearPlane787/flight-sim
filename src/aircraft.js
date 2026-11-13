// The A321neo model, built in code: fuselage, wing with sharklets, LEAP-1A nacelles, tail,
// belly fairing, gear and every moving surface, in the Nuclear Airlines livery.
//
// Everything is built in the body frame of geometry.js (+x forward, +y left, +z up, metres)
// and converted once to the model frame (X = −y, Y = z, Z = −x). The whole airframe is one
// SkinnedMesh with one material: each moving part is skinned rigidly to its own bone, so the
// aircraft costs one draw call (plus one for the light glows, src/aircraft-lights.js).
//
//   createAircraft(opts?) → { object, update(state, dt), setCockpitView(bool), mesh, triangles,
//     (opts.def: a design's type entry, src/sim/designs.js designDef(): its engines (one per geo.NACELLES, each
//     its own engine type, src/engine-model.js), its gear (GEAR, GEAR_EXTEND_M) and its registration; v0.5.0)
//     setLights({ nav, beacon, strobe, landing, taxi, logo }), setNight(0..1),
//     lampPose() → { pos, dir } }
// lampPose() is in the model frame of `object` (X = −body y, i.e. right; Y up; Z = −body x, aft):
// the landing lamps' midpoint and beam while they're on, else the nose gear's taxi lamp.

import * as THREE from '../vendor/three.module.js';
import { TAIL_X, NOSE_X, GEAR, NACELLES, NACELLE_DIAMETER, NACELLE_LENGTH, WING, GROUND_Z } from './geometry.js';
import { createLiveryTextures, UV, FIN_BOX } from './livery.js';
import { cockpitWindows } from './cockpit-windows.js';
import { GEAR_DATA, WHEEL_R_MAIN, WHEEL_R_NOSE } from './sim/a321neo.js';
import { createLampGlows, flashAt } from './aircraft-lights.js';
import { addEngine, engineAnimator } from './engine-model.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Body frame → model frame.
export const BODY_TO_MODEL = new THREE.Matrix4().set(
  0, -1, 0, 0,
  0, 0, 1, 0,
  -1, 0, 0, 0,
  0, 0, 0, 1,
);
export const toModel = (x, y, z, out = new THREE.Vector3()) => out.set(-y, z, -x);

// Control-surface signs, matching src/sim/sim.js (rad): elevator + = nose-up elevator (trailing
// edge up), stab + = nose-up trim (trailing edge up), aileronL/R + = trailing edge up (the sim
// sends aileronL = −ail, aileronR = +ail, ail + rolls right), rudder + = trailing edge right
// (yaw right). steerAngle + = nosewheel turned right.
export const SIGNS = { elevator: 1, aileron: 1, stab: 1, rudder: 1, steer: 1 };

// Strut compression (m) at which the model's tyres sit at body z = −GROUND_Z: the sim's static
// compression (src/sim/a321neo.js GEAR_DATA).
export const STATIC_COMPRESSION = { nose: GEAR_DATA.nose.staticComp, main: GEAR_DATA.main.staticComp };

// --- Fuselage shape -----------------------------------------------------------------------

// Monotone cubic interpolation through [x, y] points (x ascending).
function curve(pts) {
  const n = pts.length, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d = [], m = [];
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : 2 / (1 / d[k - 1] + 1 / d[k]);
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let k = 0;
    while (x > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k], t = (x - xs[k]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k]
      + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
  };
}

// Top line, bottom line and half-width (body z / y) along the fuselage.
// The crown drops steeply over the windshield, then gently down the radome to the tip, as on
// the A320 family: the pilots see 20° down over the nose through a windshield that, from
// outside, is a low band (v0.1.2; before, one even slope made the windshield tall).
export const fuseTop = curve([
  [TAIL_X, 0.95], [-23.3, 1.12], [-22.5, 1.28], [-21, 1.48], [-19, 1.72], [-17, 1.92],
  [-15, 2.04], [-13, 2.07], [16, 2.07], [17, 2.02], [17.6, 1.93], [18.1, 1.77], [18.45, 1.57],
  [18.8, 1.30], [19.35, 0.56], [19.8, 0.33], [20.3, 0.14], [20.7, -0.06], [20.9, -0.24], [NOSE_X, -0.45],
]);
// The top line before the crown was cut down for the windshield; it sets the centre line.
const crownBeforeCut = curve([
  [TAIL_X, 0.95], [-23.3, 1.12], [-22.5, 1.28], [-21, 1.48], [-19, 1.72], [-17, 1.92],
  [-15, 2.04], [-13, 2.07], [16, 2.07], [17, 2.03], [18, 1.86], [18.5, 1.68], [19.0, 1.4],
  [19.5, 1.02], [20.0, 0.6], [20.5, 0.22], [20.8, -0.06], [20.95, -0.27], [NOSE_X, -0.45],
]);
export const fuseBot = curve([
  [TAIL_X, 0.75], [-23.3, 0.55], [-22.5, 0.2], [-21, -0.35], [-19.5, -0.95], [-17.5, -1.6],
  [-15, -1.95], [-12.5, -2.07], [-11, -2.07], [16.5, -2.07], [17.5, -2.04], [18.5, -1.95],
  [19.5, -1.72], [20.2, -1.38], [20.6, -1.05], [20.85, -0.75], [20.97, -0.56], [NOSE_X, -0.45],
]);
export const fuseHW = curve([
  [TAIL_X, 0.08], [-23.3, 0.3], [-22.5, 0.5], [-21, 0.78], [-19, 1.12], [-17, 1.48],
  [-15, 1.78], [-13, 1.94], [-11, 1.975], [16.5, 1.975], [17.5, 1.94], [18.5, 1.84],
  [19.3, 1.64], [20.0, 1.32], [20.5, 0.98], [20.8, 0.66], [20.95, 0.36], [NOSE_X, 0.0],
]);
// A section is two half-ellipses that meet at the centre line fuseMid(x), where it's widest:
// the upper one up to fuseTop, the lower one down to fuseBot. The centre line stays where it
// was before the crown was cut down, so only the top of the nose changed.
export const fuseMid = (x) => (crownBeforeCut(x) + fuseBot(x)) / 2;
// The section at x: centre line zc, upper and lower half-heights, half-width.
export function fuseSection(x) {
  const zc = fuseMid(x);
  return { zc, up: fuseTop(x) - zc, down: zc - fuseBot(x), hw: fuseHW(x) };
}
// Point on the fuselage surface at body x and angle θ (deg; 0 left, 90 crown, 180 right).
export function fusePoint(x, thDeg, off = 0, out = new THREE.Vector3()) {
  const zc = fuseMid(x), th = thDeg * DEG, sn = Math.sin(th);
  const hh = sn >= 0 ? fuseTop(x) - zc : zc - fuseBot(x);
  return out.set(x, Math.max(0, fuseHW(x) + off) * Math.cos(th), zc + Math.max(0, hh + off) * sn);
}

// The cockpit windows' outlines (left side, [x, θ] lists; cockpit-windows.js), worked out once.
let windowCache = null;
export function windowOutlines() {
  return windowCache || (windowCache = cockpitWindows({ fuseSection }));
}

// Glass for one window outline: triangulated in (x, θ), split finely enough to follow the nose,
// and set just proud of the skin, facing out. Body coordinates, smooth normals from the skin.
function windowGlass(outline, mirror, off = 0.006) {
  const K = 0.024;                                   // θ degrees → about metres at the nose
  const th = (t) => (mirror ? 180 - t : t);
  const ring = outline.map(([x, t]) => new THREE.Vector2(x, th(t) * K));
  const faces = THREE.ShapeUtils.triangulateShape(ring, []);
  let tris = [];
  for (const f of faces) tris.push(f.map((k) => [ring[k].x, ring[k].y]));
  // Split each triangle at its longest edge until every edge is under 12 cm: the chords then
  // sag under 2 mm on the nose's 1.4 m radius, well inside the 6 mm the glass stands proud.
  for (let pass = 0; pass < 12; pass++) {
    const next = [];
    let split = false;
    for (const t of tris) {
      const e = [0, 1, 2].map((i) => Math.hypot(t[(i + 1) % 3][0] - t[i][0], t[(i + 1) % 3][1] - t[i][1]));
      const i = e.indexOf(Math.max(...e));
      if (e[i] < 0.12) { next.push(t); continue; }
      split = true;
      const a = t[i], b = t[(i + 1) % 3], c = t[(i + 2) % 3], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      next.push([a, m, c], [m, b, c]);
    }
    tris = next;
    if (!split) break;
  }
  const pos = [], nrm = [];
  const P = new THREE.Vector3(), Px = new THREE.Vector3(), Pt = new THREE.Vector3(), N = new THREE.Vector3();
  const surf = (x, t) => {
    fusePoint(x, t / K, off, P);
    // Outward normal: d/dθ × d/dx, oriented away from the fuselage's axis.
    fusePoint(x + 0.01, t / K, off, Px).sub(fusePoint(x - 0.01, t / K, off, N));
    fusePoint(x, t / K + 0.5, off, Pt).sub(fusePoint(x, t / K - 0.5, off, N));
    N.crossVectors(Pt, Px).normalize();
    if (N.y * P.y + N.z * (P.z - fuseMid(x)) < 0) N.negate();
    return [P.toArray(), N.toArray()];
  };
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C3 = new THREE.Vector3();
  for (const t of tris) {
    const v = t.map(([x, tk]) => surf(x, tk));
    A.fromArray(v[0][0]); B.fromArray(v[1][0]); C3.fromArray(v[2][0]);
    const n = B.sub(A).cross(C3.sub(A));
    const order = n.dot(new THREE.Vector3().fromArray(v[0][1])) < 0 ? [0, 2, 1] : [0, 1, 2];
    for (const k of order) { pos.push(...v[k][0]); nrm.push(...v[k][1]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

// --- Geometry helpers (body frame) -------------------------------------------------------

// A grid surface from rows of points. Triangle normals follow (row step) × (column step);
// if `expect(centroid)` is given, the whole grid is flipped when it mostly faces the other way.
export function grid(rows, { uvs = null, expect = null } = {}) {
  const nr = rows.length, nc = rows[0].length;
  const pos = new Float32Array(nr * nc * 3), uv = new Float32Array(nr * nc * 2);
  rows.forEach((row, k) => row.forEach((p, i) => {
    pos.set([p.x, p.y, p.z], (k * nc + i) * 3);
    if (uvs) uv.set(uvs[k][i], (k * nc + i) * 2);
  }));
  const idx = [];
  for (let k = 0; k < nr - 1; k++) for (let i = 0; i < nc - 1; i++) {
    const a = k * nc + i, b = (k + 1) * nc + i, c = (k + 1) * nc + i + 1, d = k * nc + i + 1;
    idx.push(a, b, c, a, c, d);
  }
  if (expect) {
    let score = 0;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), E = new THREE.Vector3();
    for (let t = 0; t < idx.length; t += 3) {
      A.fromArray(pos, idx[t] * 3); B.fromArray(pos, idx[t + 1] * 3); C.fromArray(pos, idx[t + 2] * 3);
      N.subVectors(B, A).cross(E.subVectors(C, A));
      const cen = A.clone().add(B).add(C).multiplyScalar(1 / 3);
      score += N.dot(expect(cen));
    }
    if (score < 0) for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (uvs) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Surface of revolution about the body x axis through (cy, cz). profile: [{x, r, v?}].
// Normals point along (profile tangent rotated clockwise in (x, r)): see the profiles below.
export function lathe(profile, segs, cx, cy, cz, uvRegion = null) {
  const rows = [], uvs = [];
  profile.forEach((p, j) => {
    const row = [], urow = [];
    for (let i = 0; i <= segs; i++) {
      const f = (i / segs) * Math.PI * 2;
      row.push(V(cx + p.x, cy + p.r * Math.cos(f), cz + p.r * Math.sin(f)));
      if (uvRegion) {
        const v = p.v ?? j / (profile.length - 1);
        urow.push([uvRegion.u0 + (i / segs) * (uvRegion.u1 - uvRegion.u0), uvRegion.v0 + v * (uvRegion.v1 - uvRegion.v0)]);
      }
    }
    rows.push(row); uvs.push(urow);
  });
  return grid(rows, { uvs: uvRegion ? uvs : null });
}

export function cylBetween(p0, p1, r0, r1 = r0, segs = 12) {
  const dir = p1.clone().sub(p0), len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.normalize()));
  g.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
  return g;
}
export function boxAt(cx, cy, cz, lx, ly, lz) {
  const g = new THREE.BoxGeometry(lx, ly, lz);
  g.translate(cx, cy, cz);
  return g;
}
export function sphereAt(c, r, segs = 8) {
  const g = new THREE.SphereGeometry(r, segs, Math.max(4, segs >> 1));
  g.translate(c.x, c.y, c.z);
  return g;
}

// --- Airfoils ----------------------------------------------------------------------------

export const halfThick = (f, t) => 5 * t * (0.2969 * Math.sqrt(f) - 0.126 * f - 0.3516 * f * f + 0.2843 * f ** 3 - 0.1036 * f ** 4);

// Section: { le (Vector3), chord, t, c (chord direction, unit), n (thickness direction), camber }.
export function foilPoint(s, f, side, plate = 0) {
  const cam = (s.camber || 0) * 4 * f * (1 - f);
  const h = plate ? (side > 0 ? 0.022 : 0.004) + halfThick(f, s.t) + cam : cam + side * halfThick(f, s.t);
  return s.le.clone().addScaledVector(s.c, f * s.chord).addScaledVector(s.n, h * s.chord + (plate ? 0 : 0));
}
export function plateOffset(s, f, side, lift = PLATE_LIFT) {
  // Spoiler plate: follows the upper surface, 6…30 mm above it (lift: [underside, top], m).
  const cam = (s.camber || 0) * 4 * f * (1 - f);
  const up = s.le.clone().addScaledVector(s.c, f * s.chord).addScaledVector(s.n, (cam + halfThick(f, s.t)) * s.chord);
  return up.addScaledVector(s.n, side > 0 ? lift[1] : lift[0]);
}
const PLATE_LIFT = [0.006, 0.03];
// A thinner plate just on the surface, under the spoilers: the fixed shroud over a flap's nose
// (v0.3.1), which closes the gaps between spoilers and covers the flap where there are none.
export const SHROUD_LIFT = [0.001, 0.004];

// A wing-like piece across sections secs[], from chord fraction f0 to f1. Returns geometries.
// f0 and f1 may also be arrays, one fraction per section (v0.3.1: a flap whose leading edge runs
// behind the main gear isn't at one fraction of the chord). nose > 0 rounds the front face into a
// half-ellipse that bulges forward by nose × the half-thickness there: a flap's nose, or the fixed
// leading edge behind a slat, which shows when the slat runs out.
export function foilPiece(secs, f0, f1, { nf = 7, caps = [true, true], plate = false, nose = 0, lift = PLATE_LIFT } = {}) {
  const F0 = (k) => (Array.isArray(f0) ? f0[k] : f0), F1 = (k) => (Array.isArray(f1) ? f1[k] : f1);
  const fsAt = (k) => {
    const a = F0(k), b = F1(k), fs = [];
    for (let i = 0; i <= nf; i++) {
      const s = i / nf;
      fs.push(a === 0 ? a + (b - a) * (1 - Math.cos(s * Math.PI / 2)) : a + (b - a) * s);
    }
    return fs;
  };
  const P = (s, f, side) => (plate ? plateOffset(s, f, side, lift) : foilPoint(s, f, side));
  const out = [];
  const nAvg = secs[0].n.clone().add(secs[secs.length - 1].n).normalize();
  const cAvg = secs[0].c.clone();
  const FS = secs.map((s, k) => fsAt(k));
  const up = secs.map((s, k) => FS[k].map((f) => P(s, f, 1)));
  const lo = secs.map((s, k) => FS[k].map((f) => P(s, f, -1)));
  out.push(grid(up, { expect: () => nAvg }));
  out.push(grid(lo, { expect: () => nAvg.clone().negate() }));
  // front and rear faces
  const L = secs.length - 1;
  let noseRows = null;
  if (secs.some((s, k) => F0(k) > 0.001) || plate) {
    if (nose > 0 && !plate) {
      const NJ = 6;
      noseRows = secs.map((s, k) => {
        const a = up[k][0], b = lo[k][0], mid = a.clone().add(b).multiplyScalar(0.5), h = a.clone().sub(mid);
        const fwd = s.c.clone().negate(), r = h.length() * nose, row = [];
        for (let j = 0; j <= NJ; j++) {
          const ph = (j / NJ) * Math.PI;
          row.push(mid.clone().addScaledVector(h, Math.cos(ph)).addScaledVector(fwd, r * Math.sin(ph)));
        }
        return row;
      });
      out.push(grid(noseRows, { expect: () => cAvg.clone().negate() }));
    } else out.push(grid(secs.map((s, k) => [up[k][0], lo[k][0]]), { expect: () => cAvg.clone().negate() }));
  }
  if (secs.some((s, k) => F1(k) < 0.999) || plate) out.push(grid(secs.map((s, k) => [up[k][nf], lo[k][nf]]), { expect: () => cAvg }));
  // end caps (and the rounded nose's ends, closed upper half to lower half)
  const spanDir = secs[L].le.clone().sub(secs[0].le).normalize();
  const capNose = (row, dir) => {
    const n = row.length - 1, half = n / 2;
    out.push(grid([row.slice(0, half + 1), row.slice(half).reverse()], { expect: () => dir }));
  };
  if (caps[0]) { out.push(grid([up[0], lo[0]], { expect: () => spanDir.clone().negate() })); if (noseRows) capNose(noseRows[0], spanDir.clone().negate()); }
  if (caps[1]) { out.push(grid([up[L], lo[L]], { expect: () => spanDir })); if (noseRows) capNose(noseRows[L], spanDir); }
  return out;
}

// A panel with some thickness from a grid surface (a gear door): the outer surface as given, an
// inner one `thick` inward (against expect), and the four rims, so it shows from both sides when it
// opens (v0.3.1: the Boeings' doors were single surfaces, invisible from inside). Returns
// { outer, back }: the outer surface (with uvs, if given), and the inner surface with the rims.
export function slab(rows, thick, expect, { uvs = null } = {}) {
  const inner = rows.map((row) => row.map((p) => p.clone().addScaledVector(expect(p).clone().normalize(), -thick)));
  const back = [grid(inner, { expect: (c) => expect(c).clone().negate() })];
  const nr = rows.length, nc = rows[0].length;
  const col = (rs, i) => rs.map((r) => r[i]);
  const edges = [
    [rows[0], inner[0], rows[0][Math.floor(nc / 2)].clone().sub(rows[1][Math.floor(nc / 2)])],
    [rows[nr - 1], inner[nr - 1], rows[nr - 1][Math.floor(nc / 2)].clone().sub(rows[nr - 2][Math.floor(nc / 2)])],
    [col(rows, 0), col(inner, 0), rows[Math.floor(nr / 2)][0].clone().sub(rows[Math.floor(nr / 2)][1])],
    [col(rows, nc - 1), col(inner, nc - 1), rows[Math.floor(nr / 2)][nc - 1].clone().sub(rows[Math.floor(nr / 2)][nc - 2])],
  ];
  for (const [a, b, dir] of edges) back.push(grid([a, b], { expect: () => dir }));
  return { outer: grid(rows, { uvs, expect }), back };
}

// Wing sections. side +1 = left (body +y), −1 = right. y is the distance from the centreline.
const Y_SIDE = 1.98;                 // fuselage side at the wing root
const TAN_LE = Math.tan(27.5 * DEG); // leading-edge sweep (25° at the quarter chord)
const KINK_Y = 6.4, TIP_Y = 17.0;
const TE_ROOT = WING.rootX - WING.rootChord;
const TE_SLOPE = ((WING.rootX - (TIP_Y - Y_SIDE) * TAN_LE - WING.tipChord) - TE_ROOT) / (TIP_Y - KINK_Y);
const DIH = WING.dihedralDeg * DEG;
// The wing's chord line at the fuselage side. Airbus's A321 AC heights (flap tracks, the
// sharklet's foot) put the wing about 0.3 m higher than v0.1.0's −1.35.
const WING_Z0 = -1.05;
export function wingSec(y, side) {
  const xle = WING.rootX - (y - Y_SIDE) * TAN_LE;
  const xte = y <= KINK_Y ? TE_ROOT : TE_ROOT + (y - KINK_Y) * TE_SLOPE;
  const z = WING_Z0 + (y - Y_SIDE) * Math.tan(DIH);
  const t = 0.15 - 0.04 * clamp((y - Y_SIDE) / (TIP_Y - Y_SIDE), 0, 1);
  return { le: V(xle, side * y, z), chord: xle - xte, t, c: V(-1, 0, 0), n: V(0, -side * Math.sin(DIH), Math.cos(DIH)), camber: 0.012 };
}
// The wing's lower surface (body z) at span y and chord fraction f (0 leading edge, 1 trailing).
export const wingLowerZ = (y, f) => foilPoint(wingSec(y, 1), f, -1).z;
const STAB_DIH = 6 * DEG;
function stabSec(y, side) {
  const k = clamp((y - 1.0) / 5.22, 0, 1.2);
  return {
    le: V(-16.4 - (y - 1.0) * Math.tan(32 * DEG), side * y, 0.35 + (y - 1.0) * Math.tan(STAB_DIH)),
    chord: 3.95 + (1.35 - 3.95) * k, t: 0.11,
    c: V(-1, 0, 0), n: V(0, -side * Math.sin(STAB_DIH), Math.cos(STAB_DIH)), camber: 0,
  };
}
const FIN_TIP_Z = 11.76 - GROUND_Z; // overall height 11.76 m on the ground
// The landing lights: span (m from the centreline) and chord fraction on the wing's underside.
const LAND_Y = 3.6, LAND_F = 0.12;
// High-lift surfaces (v0.3.1): the inner flap's span (its leading edge runs behind the main gear),
// the flap track fairings' stations (Airbus AC 2-2-0), the flaps' travel at full extension, m,
// and how far the spoilers overhang each flap (the travel less a slot). The slats droop, no travel.
const FIN_Y = [2.02, 6.38], CANOE_Y = [4.87, 8.30, 11.91];
const FLAP_TRAVEL = { in: 0.7, out: 0.55 }, OVERHANG = { in: 0.6, out: 0.45 };
// The nav lights and strobes sit at the sharklet's root, 7.6 m behind the wing root's leading edge.
const NAV_X = WING.rootX - 7.6;
// The inner flap's leading edge, body x (straight across its span): the 0.75-chord point at its
// outboard end. The tests check it clears the main gear.
export const FLAP_IN_LE_X = foilPoint(wingSec(FIN_Y[1], 1), 0.75, 0).x;
function finSec(z) {
  const xle = -15.0 - (z - 1.9) * Math.tan(36 * DEG);
  const xte = -21.2 - (z - 1.9) * ((21.9 - 21.2) / (FIN_TIP_Z - 1.9));
  return { le: V(xle, 0, z), chord: xle - xte, t: 0.11, c: V(-1, 0, 0), n: V(0, 1, 0), camber: 0 };
}

// --- The builder: one skinned geometry ---------------------------------------------------

export class Builder {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.bone = []; this.idx = []; this.bend = []; this.anyBend = false; }
  // geo in body coordinates. uv: 'keep' (use the geometry's), a function (x, y, z) → [u, v],
  // or null (the plain white texel, coloured by `color`). bendY (v0.4.3): the span (m) whose wing bend a
  // part rides on, for a rigid part hung off the wing (an engine and its pylon); null bends each vertex by
  // its own span. Only the Boeings' shader reads it (the 'bendY' attribute, written when any part sets it).
  add(geo, bone, color = '#ffffff', uv = null, bendY = null) {
    if (Array.isArray(geo)) { geo.forEach((g) => this.add(g, bone, color, uv, bendY)); return; }
    if (bendY !== null) this.anyBend = true;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const p = geo.attributes.position, t = geo.attributes.uv;
    const uvs = [];
    for (let i = 0; i < p.count; i++) {
      if (uv === 'keep' && t) uvs.push(t.getX(i), t.getY(i));
      else if (typeof uv === 'function') uvs.push(...uv(p.getX(i), p.getY(i), p.getZ(i)));
      else uvs.push(UV.plain.u, UV.plain.v);
    }
    geo.applyMatrix4(BODY_TO_MODEL);
    const n = geo.attributes.normal;
    const base = this.pos.length / 3;
    const c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(c.r, c.g, c.b);
      this.bone.push(bone);
      this.bend.push(bendY === null ? Math.abs(p.getX(i)) : Math.abs(bendY));   // model X = −y
    }
    this.uv.push(...uvs);
    if (geo.index) for (const i of geo.index.array) this.idx.push(base + i);
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }
  build() {
    const g = new THREE.BufferGeometry();
    const n = this.pos.length / 3;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = this.bone[i]; sw[i * 4] = 1; }
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    if (this.anyBend) g.setAttribute('bendY', new THREE.Float32BufferAttribute(this.bend, 1));
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    return g;
  }
}

const C = {
  white: '#f3f5f7', navy: '#122654', wing: '#c6cbd2', wingDark: '#aab0b8', stab: '#d9dde2',
  metal: '#9aa0a8', gear: '#c9cdd2', chrome: '#e2e5e8', tyre: '#1a1b1d', hub: '#8d939a',
  core: '#767b83', plug: '#3a3d43', fanFace: '#25282e', blade: '#5a6068', pylon: '#d5d9de',
  cascade: '#3d4148', red: '#ff2a1a', green: '#22ff55', lamp: '#ffffff', glass: '#0b1117', fanCase: '#7a8189',
};

// --- The aircraft ------------------------------------------------------------------------

export function createAircraft(opts = {}) {
  const staticComp = { ...STATIC_COMPRESSION, ...(opts.staticCompression || {}) };
  // v0.5.0: a design's engines and gear (designDef()'s geo), or the A321's own.
  const def = opts.def || null, GEO = def ? def.geo : null;
  const GEAR_ = GEO ? GEO.GEAR : GEAR, EXT = GEO?.GEAR_EXTEND_M || 0;
  const NACS = GEO ? GEO.NACELLES : NACELLES.map((n, i) => ({ ...n, D: NACELLE_DIAMETER, L: NACELLE_LENGTH, engine: 'leap-1a', i }));
  const engines = [];
  const b = new Builder();
  const bones = [], B = {};

  // Bones are created at their pivots (body coordinates) with identity rest rotation.
  // axis: hinge axis in body coordinates.
  function bone(name, parent, pivot, axis = V(1, 0, 0)) {
    const bn = new THREE.Bone();
    bn.name = name;
    const p = toModel(pivot.x, pivot.y, pivot.z);
    bn.userData.pivot = p.clone();
    bn.userData.axis = toModel(axis.x, axis.y, axis.z).normalize();
    if (parent) { bn.position.copy(p).sub(B[parent].userData.pivot); B[parent].add(bn); }
    else bn.position.copy(p);
    bn.userData.rest = bn.position.clone();
    bones.push(bn); B[name] = bn;
    return bones.length - 1;
  }

  const ROOT = bone('root', null, V(0, 0, 0));
  const NOSE = bone('nose', 'root', V(18.6, 0, 0.2));

  // Fuselage: two lofts that meet at x = 16.6 (the nose part is hidden in the seat views).
  const NA = 56;
  const fuseUV = (x, th) => [(x - TAIL_X) / (NOSE_X - TAIL_X), UV.fuselage.v0 + (UV.fuselage.v1 - UV.fuselage.v0) * ((th + 90) / 360)];
  function fuseLoft(stations) {
    const rows = [], uvs = [];
    for (const x of stations) {
      const row = [], urow = [];
      for (let i = 0; i <= NA; i++) {
        const th = -90 + (360 * i) / NA;
        row.push(fusePoint(x, th)); urow.push(fuseUV(x, th));
      }
      rows.push(row); uvs.push(urow);
    }
    return grid(rows, { uvs, expect: (c) => V(0, c.y, c.z - fuseMid(c.x)) });
  }
  const SPLIT = 16.6;
  const tailSt = [], midSt = [], noseSt = [];
  for (let i = 0; i <= 30; i++) tailSt.push(TAIL_X + (-11 - TAIL_X) * (1 - Math.cos((i / 30) * Math.PI / 2)));
  for (let i = 1; i <= 26; i++) midSt.push(-11 + ((SPLIT + 11) * i) / 26);
  for (let i = 0; i <= 32; i++) noseSt.push(SPLIT + (NOSE_X - SPLIT) * Math.sin((i / 32) * Math.PI / 2));
  b.add(fuseLoft([...tailSt, ...midSt]), ROOT, '#ffffff', 'keep');
  b.add(fuseLoft(noseSt), NOSE, '#ffffff', 'keep');
  // Cockpit glass, on the nose (so it's hidden with it in the seat views).
  for (const w of windowOutlines()) for (const mirror of [false, true]) b.add(windowGlass(w, mirror), NOSE, C.glass);
  // APU exhaust
  b.add(lathe([{ x: 0, r: 0.1 }, { x: 0, r: 0.0 }], 10, TAIL_X + 0.03, 0, 0.85), ROOT, C.plug);

  // Belly fairing (navy), a wide shallow body under the wing box.
  {
    const hw = curve([[-6.2, 1.0], [-5, 1.7], [-3, 2.2], [0, 2.35], [4, 2.3], [6.5, 1.95], [8.2, 1.1]]);
    const bot = curve([[-6.2, -2.06], [-5, -2.17], [-3, -2.3], [0, -2.36], [4, -2.33], [6.5, -2.2], [8.2, -1.98]]);
    const zc = -1.3, rows = [];
    for (let i = 0; i <= 24; i++) {
      const x = -6.2 + (14.4 * i) / 24, row = [];
      for (let j = 0; j <= 40; j++) {
        const th = -Math.PI / 2 + (2 * Math.PI * j) / 40;
        row.push(V(x, hw(x) * Math.cos(th), zc + (zc - bot(x)) * Math.sin(th)));
      }
      rows.push(row);
    }
    b.add(grid(rows, { expect: (c) => V(0, c.y, c.z - zc) }), ROOT, C.navy);
  }

  // Wing, both sides.
  const parts = {}; // per side: hinge data for update()
  for (const side of [1, -1]) {
    const S = side > 0 ? 'L' : 'R';
    const ws = (y) => wingSec(y, side);
    const secs = (ys) => ys.map(ws);
    // The trailing edge (v0.3.1). The flaps' leading edges were at 0.75 of the chord, which ran
    // through the main gear's leg: with the flaps out, the leg hung from the empty flap cove. The
    // inner flap's leading edge now runs straight across, behind the leg, at the 0.75-chord point of
    // its outboard end, so the fixed structure ahead of it (the rear spar and the gear beam) carries
    // the leg, as on the real one.
    const fAt = (y, x) => { const w = ws(y); return (w.le.x - x) / w.chord; };
    const X_FIN_LE = FLAP_IN_LE_X;
    const fFlapLE = (y) => (y >= FIN_Y[0] - 1e-6 && y <= FIN_Y[1] + 1e-6 ? fAt(y, X_FIN_LE) : 0.75);
    // Fixed structure: its leading edge behind the slats is a round nose about the slats' hinge line,
    // so a slat that droops about that line stays sealed against it (v0.4.1, below).
    const fixYs = [0.6, Y_SIDE, FIN_Y[0], 4, FIN_Y[1], KINK_Y, 9, 12, 14.5, 16.6];
    b.add(foilPiece(secs(fixYs), 0.13, fixYs.map((y) => (y < FIN_Y[0] - 1e-6 ? 0.75 : fFlapLE(y))), { caps: [false, false], nose: 1 }), ROOT, C.wing);
    // The fixed leading edge where there's no slat (the root, the pylon), and the fixed trailing edge
    // between the moving surfaces. v0.4.1: each reaches its neighbours and closes its ends; the 2 to
    // 6 cm slots between them before were light through the wing.
    b.add(foilPiece(secs([0.6, Y_SIDE, 2.62]), 0, 0.13, { caps: [false, true] }), ROOT, C.wingDark);
    b.add(foilPiece(secs([5.18, 6.32]), 0, 0.13), ROOT, C.wingDark);
    b.add(foilPiece(secs([0.6, FIN_Y[0]]), 0.75, 1, { caps: [false, true] }), ROOT, C.wing);
    for (const [y0, y1] of [[FIN_Y[1], 6.42], [12.38, 12.42], [16.58, 16.6]]) b.add(foilPiece(secs([y0, y1]), 0.75, 1), ROOT, C.wing);
    b.add(foilPiece(secs([16.6, TIP_Y]), 0, 1, { caps: [true, false] }), ROOT, C.wing);

    // Sharklet: a bend, then a swept blade up to the tip of the 35.8 m span.
    {
      const t0 = ws(TIP_Y), sk = [];
      const R = 0.55;
      for (let k = 0; k <= 5; k++) {
        const a = (k / 5) * 90 * DEG;
        const ang = DIH + a;
        sk.push({
          le: V(t0.le.x - 0.25 * (k / 5), side * (TIP_Y + R * Math.sin(a)), t0.le.z + R * (1 - Math.cos(a))),
          chord: t0.chord - 0.25 * (k / 5), t: 0.1, c: V(-1, 0, 0),
          n: V(0, -side * Math.sin(ang), Math.cos(ang)), camber: 0.01,
        });
      }
      const top = sk[5];
      for (let k = 1; k <= 4; k++) {
        const f = k / 4, h = 1.85 * f;
        sk.push({
          le: V(top.le.x - h * Math.tan(38 * DEG), side * (TIP_Y + R + 0.35 * f), top.le.z + h),
          chord: top.chord + (0.5 - top.chord) * f, t: 0.09, c: V(-1, 0, 0),
          n: V(0, -side, 0.19 * 0), camber: 0.01,
        });
      }
      b.add(foilPiece(sk, 0, 1, { caps: [false, true] }), ROOT, C.navy);
    }

    // Slats: one bone per wing, hinged along the line through the fixed nose's centre at the first and
    // last slats' ends. v0.4.1: they droop about it and no longer run out on tracks, so no slot opens
    // between slat and wing (Shane: "close it up"); the round nose fills the slat's back. The panel
    // lines between the outer four are slightly sunken fillers on the same bone, not open slots.
    const slatA = foilPoint(ws(2.62), 0.13, 0), slatB = foilPoint(ws(16.6), 0.13, 0);
    const slatAxis = slatB.clone().sub(slatA).multiplyScalar(side).normalize();
    const SL = bone('slats' + S, 'root', slatA, slatAxis);
    const slatSegs = [[2.62, 5.18]], SW = (16.6 - 6.32) / 4;
    for (let i = 0; i < 4; i++) slatSegs.push([6.32 + i * SW, 6.32 + (i + 1) * SW - (i < 3 ? 0.04 : 0)]);
    for (const [y0, y1] of slatSegs) b.add(foilPiece(secs([y0, y1]), 0, 0.13), SL, C.metal);
    const sunk = (w) => ({ ...w, le: w.le.clone().addScaledVector(w.c, 0.012 * w.chord), chord: w.chord * 0.988, t: w.t * 0.88 });
    for (let i = 1; i < 4; i++) b.add(foilPiece([slatSegs[i][1], slatSegs[i + 1][0]].map((q) => sunk(ws(q))), 0, 0.14), SL, C.wingDark);

    // Trailing-edge surfaces: hinge at the surface's leading edge, mid-thickness. f0 may be a
    // function of the span (the inner flap's).
    const hinged = (name, y0, y1, ys, f0, f1, color, opts2 = {}) => {
      const F0 = typeof f0 === 'function' ? f0 : () => f0, F1 = typeof f1 === 'function' ? f1 : () => f1;
      const pa = opts2.plate ? plateOffset(ws(y0), F0(y0), -1) : foilPoint(ws(y0), F0(y0), 0);
      const pb = opts2.plate ? plateOffset(ws(y1), F0(y1), -1) : foilPoint(ws(y1), F0(y1), 0);
      const axis = pb.clone().sub(pa).multiplyScalar(side).normalize(); // +y component
      const idx = bone(name + S, opts2.parent || 'root', pa, axis);
      b.add(foilPiece(secs(ys), ys.map(F0), ys.map(F1), { plate: opts2.plate, nf: opts2.plate ? 3 : 6, nose: opts2.nose || 0 }), idx, color);
      return idx;
    };
    hinged('flapIn', FIN_Y[0], FIN_Y[1], [FIN_Y[0], 4.2, FIN_Y[1]], fFlapLE, 1, C.wing, { nose: 1 });
    hinged('flapOut', 6.42, 12.38, [6.42, 9.4, 12.38], 0.75, 1, C.wing, { nose: 1 });
    // Flap track fairings ("canoes") under the trailing edge, at Airbus's stations (AC 2-2-0: 4.87,
    // 8.30 and 11.91 m). The aft part hinges down from the fixed front as the flaps run out, rather
    // than riding away with the flap and leaving the front part hanging.
    CANOE_Y.forEach((y, i) => {
      const w = ws(y), L = 0.8 * w.chord, xs = w.le.x - 0.5 * w.chord;
      const zc = w.le.z - 0.06 * w.chord;
      const prof = [[0, 0], [0.08, 0.1], [0.25, 0.17], [0.45, 0.17], [0.7, 0.13], [0.9, 0.06], [1, 0.005]]
        .map(([t, r]) => ({ x: -t * L, r }));
      b.add(lathe(prof.slice(0, 4), 12, xs, side * y, zc), ROOT, C.wingDark);
      const CB = bone('canoe' + i + S, 'root', V(xs - 0.45 * L, side * y, zc + 0.17), V(0, 1, 0));
      b.add(lathe(prof.slice(3), 12, xs, side * y, zc), CB, C.wingDark);
    });
    hinged('aileron', 12.42, 16.58, [12.42, 14.5, 16.58], 0.75, 1, C.wing);
    // Spoilers: plates on the upper surface whose trailing edges overhang the flaps by about what
    // the flaps travel, as the real ones do, so a flap that's out leaves a slot under them, not an
    // open gap. Each keeps its 0.155-chord width. Under them, a fixed shroud runs the flaps' whole
    // span, so there's no light between spoilers, nor a gap where there's no spoiler.
    const flapChord = (y) => ws(y).chord * (1 - fFlapLE(y));
    const overhang = (y) => Math.min(fFlapLE(y) < 0.751 ? OVERHANG.out : OVERHANG.in, 0.65 * flapChord(y));
    const spAft = (y) => fAt(y, ws(y).le.x - fFlapLE(y) * ws(y).chord - overhang(y));
    const spYs = [[3.0, 6.2], [6.6, 7.97], [8.0, 9.37], [9.4, 10.77], [10.8, 12.2]];
    spYs.forEach(([y0, y1], i) => hinged('spoiler' + (i + 1), y0, y1, [y0, (y0 + y1) / 2, y1], (y) => spAft(y) - 0.155, spAft, C.wingDark, { plate: true }));
    for (const ys of [[FIN_Y[0], 4.2, FIN_Y[1]], [6.42, 9.4, 12.38]]) {
      b.add(foilPiece(secs(ys), ys.map((y) => fFlapLE(y) - 0.03), ys.map(spAft), { plate: true, nf: 3, lift: SHROUD_LIFT }), ROOT, C.wingDark);
    }
    parts[S] = true;

    // Engines (v0.5.0: src/engine-model.js, one per nacelle on this wing; the A321's two as they always were).
    for (const n of NACS) if (!n.tail && (n.y >= 0) === (side > 0)) engines.push(addEngine(b, bone, n, { wingSec, bend: false }));

    // Main gear: retracts inward into the belly. Wheels sit at z = −GROUND_Z at static compression.
    const gm = side > 0 ? GEAR_.left : GEAR_.right;
    const TYRE_R = WHEEL_R_MAIN;
    const axleZ = gm.z + TYRE_R;
    // The leg hangs from inside the wing (its pivot and braces moved up with the wing in v0.1.2).
    const pivot = V(gm.x, gm.y, -0.9);
    const LEG = bone('mainLeg' + S, 'root', pivot, V(1, 0, 0));
    // v0.5.0: a design's longer gear (EXT) lengthens the leg below the wing; the pivot and braces stay.
    b.add(cylBetween(pivot, V(gm.x, gm.y, -2.7 - EXT), 0.15, 0.14, 14), LEG, C.gear);
    b.add(cylBetween(V(gm.x, gm.y, -2.15), V(gm.x, gm.y - side * 0.95, -0.98), 0.06, 0.06, 8), LEG, C.gear);
    b.add(cylBetween(V(gm.x, gm.y, -2.0), V(gm.x + 1.0, gm.y, -0.98), 0.06, 0.06, 8), LEG, C.gear);
    b.add(boxAt(gm.x, gm.y + side * 0.24, -1.76, 0.75, 0.04, 1.52), LEG, C.navy);
    const PIS = bone('mainPiston' + S, 'mainLeg' + S, V(gm.x, gm.y, axleZ), V(0, 0, 1));
    b.add(cylBetween(V(gm.x, gm.y, -2.6 - EXT), V(gm.x, gm.y, axleZ), 0.1, 0.1, 12), PIS, C.chrome);
    b.add(cylBetween(V(gm.x, gm.y - 0.5, axleZ), V(gm.x, gm.y + 0.5, axleZ), 0.075, 0.075, 8), PIS, C.gear);
    b.add(cylBetween(V(gm.x, gm.y, axleZ + 0.05), V(gm.x + 0.45, gm.y, axleZ + 0.6), 0.04, 0.04, 6), PIS, C.gear);
    const WH = bone('mainWheel' + S, 'mainPiston' + S, V(gm.x, gm.y, axleZ), V(0, 1, 0));
    for (const dy of [-0.465, 0.465]) {
      const c = V(gm.x, gm.y + dy, axleZ);
      b.add(new THREE.CylinderGeometry(TYRE_R, TYRE_R, 0.44, 24).translate(c.x, c.y, c.z), WH, C.tyre);
      b.add(new THREE.CylinderGeometry(0.36, 0.36, 0.46, 16).translate(c.x, c.y, c.z), WH, C.hub);
      b.add(boxAt(c.x, c.y + Math.sign(dy) * 0.235, c.z + 0.2, 0.08, 0.01, 0.12), WH, C.tyre); // marks to show spin
    }
    // hinged belly door over the leg bay
    const DR = bone('mainDoor' + S, 'root', V(gm.x, side * 0.25, -2.36), V(1, 0, 0));
    b.add(boxAt(gm.x, side * 0.85, -2.37, 1.7, 1.15, 0.03), DR, C.navy);

    // Lights: navigation (red left, green right) and strobe at the sharklet root.
    b.add(sphereAt(V(NAV_X, side * 17.3, 0.42), 0.08), ROOT, side > 0 ? C.red : C.green);
    // Retractable landing light, under the inner wing between the fuselage and the engine.
    b.add(sphereAt(foilPoint(wingSec(LAND_Y, side), LAND_F, -1).add(V(0, 0, 0.02)), 0.11), ROOT, C.lamp);
  }

  // The tail engine (a design's third), on the centreline through the fin's root.
  for (const n of NACS) if (n.tail) engines.push(addEngine(b, bone, n, { wingSec, bend: false, finLeX: (z) => finSec(z).le.x }));

  // Horizontal stabiliser (trimmable) with elevators.
  const STAB = bone('stab', 'root', V(-19.4, 0, 0.35), V(0, 1, 0));
  for (const side of [1, -1]) {
    const S = side > 0 ? 'L' : 'R';
    const ss = (ys) => ys.map((y) => stabSec(y, side));
    b.add(foilPiece(ss([0.4, 1.3, 3.5, 6.1]), 0, 0.72, { caps: [false, false] }), STAB, C.stab);
    b.add(foilPiece(ss([0.4, 1.3]), 0.72, 1, { caps: [false, true] }), STAB, C.stab);
    b.add(foilPiece(ss([6.1, 6.22]), 0, 1, { caps: [true, true] }), STAB, C.stab);
    const pa = foilPoint(stabSec(1.32, side), 0.72, 0), pb = foilPoint(stabSec(6.08, side), 0.72, 0);
    const EL = bone('elev' + S, 'stab', pa, pb.clone().sub(pa).multiplyScalar(side).normalize());
    b.add(foilPiece(ss([1.32, 3.7, 6.08]), 0.72, 1), EL, C.stab);
  }

  // Fin and rudder, with the livery's fin projection.
  const finUV = (x, y, z) => [
    UV.fin.u0 + ((x - FIN_BOX.x0) / (FIN_BOX.x1 - FIN_BOX.x0)) * (UV.fin.u1 - UV.fin.u0),
    UV.fin.v0 + ((z - FIN_BOX.z0) / (FIN_BOX.z1 - FIN_BOX.z0)) * (UV.fin.v1 - UV.fin.v0),
  ];
  const fz = (zs) => zs.map(finSec);
  b.add(foilPiece(fz([1.0, 2.0, 4.5, 7.6]), 0, 0.68, { caps: [false, false] }), ROOT, '#ffffff', finUV);
  b.add(foilPiece(fz([1.0, 2.0]), 0.68, 1, { caps: [false, true] }), ROOT, '#ffffff', finUV);
  b.add(foilPiece(fz([7.6, FIN_TIP_Z]), 0, 1, { caps: [true, true], nf: 6 }), ROOT, '#ffffff', finUV);
  {
    const pa = foilPoint(finSec(2.02), 0.68, 0), pb = foilPoint(finSec(7.58), 0.68, 0);
    const RUD = bone('rudder', 'root', pa, pb.clone().sub(pa).normalize());
    b.add(foilPiece(fz([2.02, 4.8, 7.58]), 0.68, 1), RUD, '#ffffff', finUV);
  }
  // Dorsal fillet ahead of the fin.
  {
    const rows = [];
    for (let i = 0; i <= 6; i++) {
      const x = -12.0 - (i / 6) * 3.4, h = 0.6 * Math.pow(i / 6, 1.6), row = [];
      for (let j = 0; j <= 6; j++) {
        const a = (j / 6) * Math.PI;
        row.push(V(x, Math.cos(a) * (0.12 + 0.12 * (i / 6)), fuseTop(x) - 0.08 + h * Math.sin(a)));
      }
      rows.push(row);
    }
    b.add(grid(rows, { expect: (c) => V(0, c.y, 0.5) }), ROOT, '#ffffff', finUV);
  }

  // Nose gear: retracts forward. Nosewheel steering about the leg axis.
  const NG = GEAR_.nose, NTYRE = WHEEL_R_NOSE;
  const nAxle = V(NG.x, 0, NG.z + NTYRE), nPivot = V(16.1, 0, -1.3);
  const nAxis = nPivot.clone().sub(nAxle).normalize();
  const NLEG = bone('noseLeg', 'root', nPivot, V(0, 1, 0));
  b.add(cylBetween(nPivot, nPivot.clone().lerp(nAxle, 0.6), 0.11, 0.1, 12), NLEG, C.gear);
  b.add(cylBetween(nPivot.clone().lerp(nAxle, 0.35), V(17.3, 0, -1.4), 0.05, 0.05, 6), NLEG, C.gear);
  b.add(sphereAt(nPivot.clone().lerp(nAxle, 0.5).add(V(0.12, 0, 0)), 0.08), NLEG, C.lamp); // taxi light
  const NSTEER = bone('noseSteer', 'noseLeg', nAxle, nAxis);
  const NPIS = bone('nosePiston', 'noseSteer', nAxle, nAxis);
  b.add(cylBetween(nPivot.clone().lerp(nAxle, 0.5), nAxle, 0.075, 0.075, 10), NPIS, C.chrome);
  b.add(cylBetween(V(nAxle.x, -0.36, nAxle.z), V(nAxle.x, 0.36, nAxle.z), 0.05, 0.05, 8), NPIS, C.gear);
  b.add(boxAt(nAxle.x + 0.05, 0, nAxle.z + 0.42, 0.5, 0.2, 0.06), NPIS, C.gear); // mudguard-ish link
  const NWH = bone('noseWheel', 'nosePiston', nAxle, V(0, 1, 0));
  for (const dy of [-0.235, 0.235]) {
    const c = V(nAxle.x, dy, nAxle.z);
    b.add(new THREE.CylinderGeometry(NTYRE, NTYRE, 0.22, 20).translate(c.x, c.y, c.z), NWH, C.tyre);
    b.add(new THREE.CylinderGeometry(0.2, 0.2, 0.235, 12).translate(c.x, c.y, c.z), NWH, C.hub);
    b.add(boxAt(c.x, c.y + Math.sign(dy) * 0.118, c.z + 0.12, 0.06, 0.01, 0.08), NWH, C.tyre);
  }
  for (const side of [1, -1]) {
    const D = bone('noseDoor' + (side > 0 ? 'L' : 'R'), 'root', V(17.1, side * 0.36, -2.0), V(1, 0, 0));
    b.add(boxAt(17.1, side * 0.18, -2.0, 2.5, 0.36, 0.03), D, C.white);
  }

  // Tail light, beacons.
  b.add(sphereAt(V(TAIL_X - 0.02, 0, 0.85), 0.07), ROOT, C.lamp);
  b.add(sphereAt(V(-1.5, 0, fuseTop(-1.5) + 0.03), 0.09), ROOT, C.red);
  b.add(sphereAt(V(1.5, 0, -2.38), 0.09), ROOT, C.red);

  // --- Mesh, material, skeleton ---
  const geometry = b.build();
  const { map, emissiveMap } = createLiveryTextures(fuseTop, windowOutlines(), opts.registration || def?.registration);
  const material = new THREE.MeshStandardMaterial({
    map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.6,
    vertexColors: true, roughness: 0.42, metalness: 0.08,
  });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'A321neo';
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.add(bones[ROOT]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 26);

  // The logo lights (on the stabiliser, aimed up at the fin): the fin and fillet take a pool
  // of light, brightest at the root. The mask uses the bind-pose (model frame) position.
  // At night, a faint fill (uFill) stands for the light of the ramp floods, the city and the
  // sky glow that three's sun and hemisphere lights no longer give, so the airframe never
  // goes pitch black.
  const logoU = { value: 0 }, fillU = { value: 0 };
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uLogo = logoU;
    sh.uniforms.uFill = fillU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBindPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBindPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBindPos;\nuniform float uLogo, uFill;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * uFill;
        if (uLogo > 0.001) {
          float fin = (1.0 - smoothstep(0.6, 0.9, abs(vBindPos.x))) * smoothstep(${(14.6).toFixed(1)}, 15.6, vBindPos.z)
            * smoothstep(1.55, 2.0, vBindPos.y);
          float fall = exp(-max(vBindPos.y - 1.9, 0.0) / 3.2);
          totalEmissiveRadiance += uLogo * fin * fall * (diffuseColor.rgb + 0.04) * vec3(1.0, 0.95, 0.86) * 2.2;
        }`);
  };

  // Light glows (src/aircraft-lights.js): one Points draw. Positions in the model frame.
  const M = (v) => toModel(v.x, v.y, v.z).toArray();
  const Md = (x, y, z) => toModel(x, y, z).normalize().toArray();
  const landP = [1, -1].map((side) => foilPoint(wingSec(LAND_Y, side), LAND_F, -1).add(V(0, 0, -0.08)));
  const landDirBody = [Math.cos(8 * DEG), 0, -Math.sin(8 * DEG)];   // aimed 8° down: the ground ahead on final
  const taxiP = nPivot.clone().lerp(nAxle, 0.5).add(V(0.22, 0, 0));
  const taxiDirBody = [Math.cos(9 * DEG), 0, -Math.sin(9 * DEG)];
  const LAMPS = [
    { key: 'navL', pos: M(V(NAV_X, 17.35, 0.42)), color: C.red, size: 3.0, px: [2.5, 9] },
    { key: 'navR', pos: M(V(NAV_X, -17.35, 0.42)), color: C.green, size: 3.0, px: [2.5, 9] },
    { key: 'tail', pos: M(V(TAIL_X - 0.1, 0, 0.85)), color: '#ffffff', size: 2.4, px: [2, 7] },
    { key: 'beaconTop', pos: M(V(-1.5, 0, fuseTop(-1.5) + 0.12)), color: C.red, size: 5.0, px: [4, 14] },
    { key: 'beaconBottom', pos: M(V(1.5, 0, -2.47)), color: C.red, size: 5.0, px: [4, 14] },
    { key: 'strobe', pos: M(V(NAV_X - 0.2, 17.4, 0.42)), color: '#ffffff', size: 9.0, px: [8, 26] },
    { key: 'strobe', pos: M(V(NAV_X - 0.2, -17.4, 0.42)), color: '#ffffff', size: 9.0, px: [8, 26] },
    { key: 'strobe', pos: M(V(TAIL_X - 0.15, 0, 0.75)), color: '#ffffff', size: 7.0, px: [6, 20] },
    ...landP.map((p) => ({ key: 'landing', pos: M(p), color: '#fff4e0', size: 7.0, px: [4, 22], dir: Md(...landDirBody) })),
    { key: 'taxi', pos: M(taxiP), color: '#fff4e0', size: 4.5, px: [3, 16], dir: Md(...taxiDirBody) },
  ];
  const glows = createLampGlows(LAMPS);
  const levels = new Array(LAMPS.length).fill(0);
  // Until setLights is called: nav, beacon and strobes, as before v0.2.0.
  let lights = { nav: 1, beacon: 1, strobe: 1, landing: 0, taxi: 0, logo: 0 };
  let night = 0, gearNow = 1;
  const landMid = toModel((landP[0].x + landP[1].x) / 2, 0, (landP[0].z + landP[1].z) / 2).toArray();
  const pose = { land: { pos: landMid, dir: Md(...landDirBody) }, taxi: { pos: M(taxiP), dir: Md(...taxiDirBody) } };

  const object = new THREE.Group();
  object.name = 'aircraft';
  object.add(mesh, glows.object);

  // --- Animation ---
  const qa = new THREE.Quaternion();
  const rot = (name, angle) => { const bn = B[name]; bn.quaternion.setFromAxisAngle(bn.userData.axis, angle); };
  const move = (name, dx, dy, dz) => { // offset in body axes, in the parent's frame
    const bn = B[name]; bn.position.copy(bn.userData.rest).add(toModel(dx, dy, dz));
  };
  const slide = (name, d) => { const bn = B[name]; bn.position.copy(bn.userData.rest).addScaledVector(bn.userData.axis, d); };
  void qa;
  let wheelMain = 0, wheelNose = 0, clock = 0, cockpitView = false;
  const animateEngines = engineAnimator(engines, B, toModel);
  const NO_ENGINES = [];

  function update(state = {}, dt = 0) {
    clock += dt;
    const s = state.surfaces || {};
    // Trailing edge up is a positive rotation about the (+y-pointing) hinge axes.
    rot('stab', SIGNS.stab * (s.stab || 0));
    rot('elevL', SIGNS.elevator * (s.elevator || 0));
    rot('elevR', SIGNS.elevator * (s.elevator || 0));
    rot('aileronL', SIGNS.aileron * (s.aileronL || 0));
    rot('aileronR', SIGNS.aileron * (s.aileronR || 0));
    rot('rudder', SIGNS.rudder * (s.rudder || 0));
    for (const S of ['L', 'R']) {
      const arr = (S === 'L' ? s.spoilersL : s.spoilersR) || [];
      for (let i = 0; i < 5; i++) rot('spoiler' + (i + 1) + S, clamp(arr[i] || 0, 0, 1) * 50 * DEG);
      // Slats: they droop about their hinge line, sealed against the fixed nose (v0.4.1: no travel).
      rot('slats' + S, (state.slatDeg || 0) * DEG * 0.85);
      // Fowler flaps: mostly aft travel first, then rotation.
      const fd = state.flapDeg || 0, tr = clamp(fd / 20, 0, 1);
      rot('flapIn' + S, -fd * DEG);
      move('flapIn' + S, -FLAP_TRAVEL.in * tr, 0, -0.1 * tr);
      rot('flapOut' + S, -fd * DEG);
      move('flapOut' + S, -FLAP_TRAVEL.out * tr, 0, -0.08 * tr);
      // the flap track fairings' aft parts follow the flaps down
      for (let i = 0; i < CANOE_Y.length; i++) rot('canoe' + i + S, -fd * DEG * 0.55);
    }

    // Gear.
    const gp = clamp(state.gearPos ?? 1, 0, 1);
    const up = 1 - gp;
    rot('mainLegL', -up * 88 * DEG);
    rot('mainLegR', up * 88 * DEG);
    rot('noseLeg', -up * 100 * DEG);
    const gc = state.gearCompression || {};
    slide('mainPistonL', (gc.left ?? staticComp.main) - staticComp.main);
    slide('mainPistonR', (gc.right ?? staticComp.main) - staticComp.main);
    slide('nosePiston', (gc.nose ?? staticComp.nose) - staticComp.nose);
    rot('noseSteer', -SIGNS.steer * (state.steerAngle || 0));
    const wr = state.wheelRate || {};
    wheelMain += (wr.main || 0) * dt; wheelNose += (wr.nose || 0) * dt;
    rot('mainWheelL', wheelMain); rot('mainWheelR', wheelMain); rot('noseWheel', wheelNose);
    const doors = clamp(state.gearDoors ?? (gp > 0.99 ? 0 : 1), 0, 1) * 80 * DEG;
    rot('noseDoorL', doors); rot('noseDoorR', -doors);
    rot('mainDoorL', -doors); rot('mainDoorR', doors);

    // Engines: each fan (a visual rate that reads as spinning) and reverser its own engine's; one torn off is gone.
    animateEngines(state.engines || NO_ENGINES, dt);

    // Lights: steady nav, flashing beacons and strobes (aircraft-lights.js), the lamps.
    gearNow = gp;
    const f = flashAt(clock), L = lights, gearLamp = gp > 0.97 ? 1 : 0;
    // From the seats the nose is hidden, so the lamps under it would show through: hide them
    // (the pilots never see these lamps, only their light on the ground).
    const seen = cockpitView ? 0 : 1;
    for (let i = 0; i < LAMPS.length; i++) {
      const k = LAMPS[i].key;
      levels[i] = k === 'navL' || k === 'navR' || k === 'tail' ? L.nav
        : k === 'beaconTop' ? L.beacon * f.beaconTop
          : k === 'beaconBottom' ? L.beacon * f.beaconBottom
            : k === 'strobe' ? L.strobe * f.strobe
              : k === 'landing' ? L.landing * seen
                : L.taxi * gearLamp * seen;
    }
    glows.setLevels(levels);
  }

  function setLights(l) {
    lights = { nav: l.nav ?? 0, beacon: l.beacon ?? 0, strobe: l.strobe ?? 0, landing: l.landing ?? 0, taxi: l.taxi ?? 0, logo: l.logo ?? 0 };
    logoU.value = lights.logo * night;
  }
  // n: 0 by day … 1 at night. Bigger halos and the logo light at night.
  function setNight(n) {
    night = clamp(n || 0, 0, 1);
    glows.setNight(night);
    fillU.value = 0.035 * night;
    logoU.value = lights.logo * night;
  }
  // The landing lamps' midpoint and beam (model frame), or the taxi lamp's when only it is on.
  function lampPose() {
    const p = lights.landing > 0 || !(lights.taxi > 0 && gearNow > 0.97) ? pose.land : pose.taxi;
    return { pos: p.pos.slice(), dir: p.dir.slice() };
  }

  function setCockpitView(on) {
    if (on === cockpitView) return;
    cockpitView = on;
    B.nose.scale.setScalar(on ? 1e-4 : 1);
  }

  update({}, 0);
  return { object, update, setCockpitView, setLights, setNight, lampPose, mesh, bones: B, triangles: geometry.index.count / 3 };
}
