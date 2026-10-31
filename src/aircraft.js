// The A321neo model, built in code: fuselage, wing with sharklets, LEAP-1A nacelles, tail,
// belly fairing, gear and every moving surface, in the Nuclear Airlines livery.
//
// Everything is built in the body frame of geometry.js (+x forward, +y left, +z up, metres)
// and converted once to the model frame (X = −y, Y = z, Z = −x). The whole airframe is one
// SkinnedMesh with one material: each moving part is skinned rigidly to its own bone, so the
// aircraft costs one draw call (plus two for the light glows).
//
//   createAircraft(opts?) → { object, update(state, dt), setCockpitView(bool), mesh, triangles }

import * as THREE from '../vendor/three.module.js';
import { TAIL_X, NOSE_X, GEAR, ENGINES, WING, GROUND_Z } from './geometry.js';
import { createLiveryTextures, UV, FIN_BOX } from './livery.js';
import { GEAR_DATA, WHEEL_R_MAIN, WHEEL_R_NOSE } from './sim/a321neo.js';

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
export const fuseTop = curve([
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
// Point on the fuselage surface at body x and angle θ (deg; 0 left, 90 crown, 180 right).
export function fusePoint(x, thDeg, off = 0, out = new THREE.Vector3()) {
  const t = fuseTop(x), b = fuseBot(x), hw = fuseHW(x);
  const zc = (t + b) / 2, hh = (t - b) / 2, th = thDeg * DEG;
  return out.set(x, Math.max(0, hw + off) * Math.cos(th), zc + Math.max(0, hh + off) * Math.sin(th));
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
function lathe(profile, segs, cx, cy, cz, uvRegion = null) {
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
function sphereAt(c, r, segs = 8) {
  const g = new THREE.SphereGeometry(r, segs, Math.max(4, segs >> 1));
  g.translate(c.x, c.y, c.z);
  return g;
}

// --- Airfoils ----------------------------------------------------------------------------

const halfThick = (f, t) => 5 * t * (0.2969 * Math.sqrt(f) - 0.126 * f - 0.3516 * f * f + 0.2843 * f ** 3 - 0.1036 * f ** 4);

// Section: { le (Vector3), chord, t, c (chord direction, unit), n (thickness direction), camber }.
function foilPoint(s, f, side, plate = 0) {
  const cam = (s.camber || 0) * 4 * f * (1 - f);
  const h = plate ? (side > 0 ? 0.022 : 0.004) + halfThick(f, s.t) + cam : cam + side * halfThick(f, s.t);
  return s.le.clone().addScaledVector(s.c, f * s.chord).addScaledVector(s.n, h * s.chord + (plate ? 0 : 0));
}
function plateOffset(s, f, side) {
  // Spoiler plate: follows the upper surface, 4…22 mm above it.
  const cam = (s.camber || 0) * 4 * f * (1 - f);
  const up = s.le.clone().addScaledVector(s.c, f * s.chord).addScaledVector(s.n, (cam + halfThick(f, s.t)) * s.chord);
  return up.addScaledVector(s.n, side > 0 ? 0.03 : 0.006);
}

// A wing-like piece across sections secs[], from chord fraction f0 to f1. Returns geometries.
function foilPiece(secs, f0, f1, { nf = 7, caps = [true, true], plate = false } = {}) {
  const fs = [];
  for (let i = 0; i <= nf; i++) {
    const s = i / nf;
    fs.push(f0 === 0 ? f0 + (f1 - f0) * (1 - Math.cos(s * Math.PI / 2)) : f0 + (f1 - f0) * s);
  }
  const P = (s, f, side) => (plate ? plateOffset(s, f, side) : foilPoint(s, f, side));
  const out = [];
  const nAvg = secs[0].n.clone().add(secs[secs.length - 1].n).normalize();
  const cAvg = secs[0].c.clone();
  const up = secs.map((s) => fs.map((f) => P(s, f, 1)));
  const lo = secs.map((s) => fs.map((f) => P(s, f, -1)));
  out.push(grid(up, { expect: () => nAvg }));
  out.push(grid(lo, { expect: () => nAvg.clone().negate() }));
  // front and rear faces
  const t0 = halfThick(Math.max(f0, 1e-4), secs[0].t);
  if (f0 > 0.001 || plate) out.push(grid(secs.map((s, k) => [up[k][0], lo[k][0]]), { expect: () => cAvg.clone().negate() }));
  if (f1 < 0.999 || plate) out.push(grid(secs.map((s, k) => [up[k][nf], lo[k][nf]]), { expect: () => cAvg }));
  void t0;
  // end caps
  const spanDir = secs[secs.length - 1].le.clone().sub(secs[0].le).normalize();
  if (caps[0]) out.push(grid([up[0], lo[0]], { expect: () => spanDir.clone().negate() }));
  const L = secs.length - 1;
  if (caps[1]) out.push(grid([up[L], lo[L]], { expect: () => spanDir }));
  return out;
}

// Wing sections. side +1 = left (body +y), −1 = right. y is the distance from the centreline.
const Y_SIDE = 1.98;                 // fuselage side at the wing root
const TAN_LE = Math.tan(27.5 * DEG); // leading-edge sweep (25° at the quarter chord)
const KINK_Y = 6.4, TIP_Y = 17.0;
const TE_ROOT = WING.rootX - WING.rootChord;
const TE_SLOPE = ((WING.rootX - (TIP_Y - Y_SIDE) * TAN_LE - WING.tipChord) - TE_ROOT) / (TIP_Y - KINK_Y);
const DIH = WING.dihedralDeg * DEG;
const WING_Z0 = -1.35;
function wingSec(y, side) {
  const xle = WING.rootX - (y - Y_SIDE) * TAN_LE;
  const xte = y <= KINK_Y ? TE_ROOT : TE_ROOT + (y - KINK_Y) * TE_SLOPE;
  const z = WING_Z0 + (y - Y_SIDE) * Math.tan(DIH);
  const t = 0.15 - 0.04 * clamp((y - Y_SIDE) / (TIP_Y - Y_SIDE), 0, 1);
  return { le: V(xle, side * y, z), chord: xle - xte, t, c: V(-1, 0, 0), n: V(0, -side * Math.sin(DIH), Math.cos(DIH)), camber: 0.012 };
}
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
function finSec(z) {
  const xle = -15.0 - (z - 1.9) * Math.tan(36 * DEG);
  const xte = -21.2 - (z - 1.9) * ((21.9 - 21.2) / (FIN_TIP_Z - 1.9));
  return { le: V(xle, 0, z), chord: xle - xte, t: 0.11, c: V(-1, 0, 0), n: V(0, 1, 0), camber: 0 };
}

// --- The builder: one skinned geometry ---------------------------------------------------

export class Builder {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.bone = []; this.idx = []; }
  // geo in body coordinates. uv: 'keep' (use the geometry's), a function (x, y, z) → [u, v],
  // or null (the plain white texel, coloured by `color`).
  add(geo, bone, color = '#ffffff', uv = null) {
    if (Array.isArray(geo)) { geo.forEach((g) => this.add(g, bone, color, uv)); return; }
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
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    return g;
  }
}

const C = {
  white: '#f3f5f7', navy: '#122654', wing: '#c6cbd2', wingDark: '#aab0b8', stab: '#d9dde2',
  metal: '#9aa0a8', gear: '#c9cdd2', chrome: '#e2e5e8', tyre: '#1a1b1d', hub: '#8d939a',
  core: '#767b83', plug: '#3a3d43', fanFace: '#25282e', blade: '#5a6068', pylon: '#d5d9de',
  cascade: '#3d4148', red: '#ff2a1a', green: '#22ff55', lamp: '#ffffff',
};

// --- The aircraft ------------------------------------------------------------------------

export function createAircraft(opts = {}) {
  const staticComp = { ...STATIC_COMPRESSION, ...(opts.staticCompression || {}) };
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
    return grid(rows, { uvs, expect: (c) => V(0, c.y, c.z - (fuseTop(c.x) + fuseBot(c.x)) / 2) });
  }
  const SPLIT = 16.6;
  const tailSt = [], midSt = [], noseSt = [];
  for (let i = 0; i <= 30; i++) tailSt.push(TAIL_X + (-11 - TAIL_X) * (1 - Math.cos((i / 30) * Math.PI / 2)));
  for (let i = 1; i <= 26; i++) midSt.push(-11 + ((SPLIT + 11) * i) / 26);
  for (let i = 0; i <= 32; i++) noseSt.push(SPLIT + (NOSE_X - SPLIT) * Math.sin((i / 32) * Math.PI / 2));
  b.add(fuseLoft([...tailSt, ...midSt]), ROOT, '#ffffff', 'keep');
  b.add(fuseLoft(noseSt), NOSE, '#ffffff', 'keep');
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
    // fixed structure
    b.add(foilPiece(secs([0.6, Y_SIDE, 4, KINK_Y, 9, 12, 14.5, 16.6]), 0.13, 0.75, { caps: [false, false] }), ROOT, C.wing);
    b.add(foilPiece(secs([0.6, Y_SIDE, 2.58]), 0, 0.13, { caps: [false, true] }), ROOT, C.wingDark);
    b.add(foilPiece(secs([5.22, 6.28]), 0, 0.13), ROOT, C.wingDark);
    b.add(foilPiece(secs([0.6, 2.0]), 0.75, 1, { caps: [false, true] }), ROOT, C.wing);
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

    // Slats: one bone per wing, hinged along the leading edge.
    const slatA = foilPoint(ws(2.62), 0.13, 0), slatB = foilPoint(ws(16.6), 0.13, 0);
    const slatAxis = slatB.clone().sub(slatA).multiplyScalar(side).normalize();
    const SL = bone('slats' + S, 'root', slatA, slatAxis);
    b.add(foilPiece(secs([2.62, 5.18]), 0, 0.13), SL, C.metal);
    for (let i = 0; i < 4; i++) {
      const y0 = 6.32 + (i * (16.58 - 6.32)) / 4, y1 = 6.32 + ((i + 1) * (16.58 - 6.32)) / 4 - 0.04;
      b.add(foilPiece(secs([y0, y1]), 0, 0.13), SL, C.metal);
    }

    // Trailing-edge surfaces: hinge at the surface's leading edge, mid-thickness.
    const hinged = (name, y0, y1, ys, f0, f1, color, opts2 = {}) => {
      const pa = opts2.plate ? plateOffset(ws(y0), f0, -1) : foilPoint(ws(y0), f0, 0);
      const pb = opts2.plate ? plateOffset(ws(y1), f0, -1) : foilPoint(ws(y1), f0, 0);
      const axis = pb.clone().sub(pa).multiplyScalar(side).normalize(); // +y component
      const idx = bone(name + S, 'root', pa, axis);
      b.add(foilPiece(secs(ys), f0, f1, { plate: opts2.plate, nf: opts2.plate ? 3 : 6 }), idx, color);
      return idx;
    };
    const FIN = hinged('flapIn', 2.02, 6.38, [2.02, 4.2, 6.38], 0.75, 1, C.wing);
    const FOUT = hinged('flapOut', 6.42, 12.38, [6.42, 9.4, 12.38], 0.75, 1, C.wing);
    // Flap track fairings ("canoes") under the trailing edge; the aft part rides on the flap.
    for (const [y, fb] of [[4.0, FIN], [8.4, FOUT], [11.0, FOUT]]) {
      const w = ws(y), L = 0.8 * w.chord, xs = w.le.x - 0.5 * w.chord;
      const zc = w.le.z - 0.06 * w.chord;
      const prof = [[0, 0], [0.08, 0.1], [0.25, 0.17], [0.45, 0.17], [0.7, 0.13], [0.9, 0.06], [1, 0.005]]
        .map(([t, r]) => ({ x: -t * L, r }));
      b.add(lathe(prof.slice(0, 4), 12, xs, side * y, zc), ROOT, C.wingDark);
      b.add(lathe(prof.slice(3), 12, xs, side * y, zc), fb, C.wingDark);
    }
    hinged('aileron', 12.42, 16.58, [12.42, 14.5, 16.58], 0.75, 1, C.wing);
    const spY = [[3.0, 6.2], [6.6, 7.97], [8.0, 9.37], [9.4, 10.77], [10.8, 12.2]];
    spY.forEach(([y0, y1], i) => hinged('spoiler' + (i + 1), y0, y1, [y0, y1], 0.6, 0.755, C.wingDark, { plate: true }));
    parts[S] = true;

    // Engine: nacelle, pylon, fan and the translating cowl of the thrust reverser.
    const E = ENGINES[side > 0 ? 0 : 1];
    const ex = E.x, ey = E.y, ez = E.z;
    b.add(lathe([
      { x: 1.45, r: 0.93, v: 0 }, { x: 1.9, r: 0.95, v: 0.12 }, { x: 2.25, r: 0.985, v: 0.24 }, { x: 2.42, r: 1.01, v: 0.3 },
      { x: 2.5, r: 1.04, v: 0.36 }, { x: 2.53, r: 1.08, v: 0.42 }, { x: 2.51, r: 1.12, v: 0.48 }, { x: 2.44, r: 1.155, v: 0.55 },
      { x: 2.2, r: 1.19, v: 0.6 }, { x: 1.6, r: 1.215, v: 0.68 }, { x: 0.8, r: 1.21, v: 0.8 }, { x: 0.05, r: 1.18, v: 1 },
    ], 44, ex, ey, ez, UV.nacelle), ROOT, '#ffffff', 'keep');
    const REV = bone('rev' + S, 'root', V(ex, ey, ez));
    b.add(lathe([
      { x: 0.05, r: 1.18 }, { x: -0.6, r: 1.125 }, { x: -1.2, r: 1.02 }, { x: -1.5, r: 0.94 },
      { x: -1.45, r: 0.9 }, { x: -0.9, r: 0.95 }, { x: 0.0, r: 1.02 },
    ], 44, ex, ey, ez), REV, C.navy);
    b.add(lathe([{ x: 0.0, r: 1.09 }, { x: -0.6, r: 1.06 }], 32, ex, ey, ez), ROOT, C.cascade);
    b.add(lathe([{ x: 0.6, r: 0.62 }, { x: -0.6, r: 0.72 }, { x: -1.5, r: 0.64 }, { x: -2.05, r: 0.52 }, { x: -2.08, r: 0.46 }], 32, ex, ey, ez), ROOT, C.core);
    b.add(lathe([{ x: -1.9, r: 0.43 }, { x: -2.3, r: 0.25 }, { x: -2.52, r: 0.02 }], 24, ex, ey, ez), ROOT, C.plug);
    b.add(lathe([{ x: 1.32, r: 0.0 }, { x: 1.32, r: 0.95 }], 32, ex, ey, ez), ROOT, C.fanFace);
    b.add(lathe([{ x: -0.25, r: 1.0 }, { x: -0.25, r: 0.68 }], 32, ex, ey, ez), ROOT, C.fanFace);
    const FAN = bone('fan' + S, 'root', V(ex, ey, ez), V(1, 0, 0));
    b.add(lathe([{ x: 2.0, r: 0.0 }, { x: 1.93, r: 0.15 }, { x: 1.76, r: 0.29 }, { x: 1.55, r: 0.38 }, { x: 1.42, r: 0.39 }], 24, ex, ey, ez), FAN, C.navy);
    // one white swirl on the spinner so the rotation shows
    b.add(boxAt(ex + 1.72, ey, ez + 0.16, 0.36, 0.05, 0.2).rotateX(0).translate(0, 0, 0), FAN, C.white);
    for (let i = 0; i < 18; i++) {
      const g = new THREE.BoxGeometry(0.34, 0.03, 0.56);
      g.rotateZ(38 * DEG);          // blade twist (about the radial axis, z here)
      g.translate(0, 0, 0.66);
      g.rotateX((i / 18) * Math.PI * 2);
      g.translate(ex + 1.45, ey, ez);
      b.add(g, FAN, C.blade);
    }
    // Pylon: a profile in (x, z) extruded sideways.
    {
      const sh = new THREE.Shape();
      const pts = [[ex + 1.6, ez + 1.13], [ex - 0.2, ez + 1.32], [ex - 1.6, ez + 1.2], [ex - 3.4, ez + 0.82],
        [ex - 5.5, ez + 0.7], [ex - 4.9, ez + 0.43], [ex - 3.0, ez + 0.4], [ex - 1.4, ez + 0.75], [ex + 0.2, ez + 0.98]];
      pts.forEach(([x, z], i) => (i ? sh.lineTo(x, z) : sh.moveTo(x, z)));
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.42, bevelEnabled: false });
      g.translate(0, 0, -0.21);
      // shape (X, Y, Z) → body (x = X, y = −Z, z = Y)
      g.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, ey, 0, 1, 0, 0, 0, 0, 0, 1));
      b.add(g, ROOT, C.pylon);
    }

    // Main gear: retracts inward into the belly. Wheels sit at z = −GROUND_Z at static compression.
    const gm = side > 0 ? GEAR.left : GEAR.right;
    const TYRE_R = WHEEL_R_MAIN;
    const axleZ = gm.z + TYRE_R;
    const pivot = V(gm.x, gm.y, -1.45);
    const LEG = bone('mainLeg' + S, 'root', pivot, V(1, 0, 0));
    b.add(cylBetween(pivot, V(gm.x, gm.y, -2.7), 0.15, 0.14, 14), LEG, C.gear);
    b.add(cylBetween(V(gm.x, gm.y, -2.15), V(gm.x, gm.y - side * 0.95, -1.5), 0.06, 0.06, 8), LEG, C.gear);
    b.add(cylBetween(V(gm.x, gm.y, -2.0), V(gm.x + 1.0, gm.y, -1.45), 0.06, 0.06, 8), LEG, C.gear);
    b.add(boxAt(gm.x, gm.y + side * 0.24, -2.0, 0.75, 0.04, 1.05), LEG, C.navy);
    const PIS = bone('mainPiston' + S, 'mainLeg' + S, V(gm.x, gm.y, axleZ), V(0, 0, 1));
    b.add(cylBetween(V(gm.x, gm.y, -2.6), V(gm.x, gm.y, axleZ), 0.1, 0.1, 12), PIS, C.chrome);
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
    b.add(sphereAt(V(-3.0, side * 17.3, 0.12), 0.08), ROOT, side > 0 ? C.red : C.green);
  }

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
  const NG = GEAR.nose, NTYRE = WHEEL_R_NOSE;
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
  const { map, emissiveMap } = createLiveryTextures(fuseTop);
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

  // Light glows: steady navigation lights, and the flashing beacons and strobes.
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const pointsOf = (list, size) => {
    const pos = [], col = [];
    for (const [p, c] of list) { const m = toModel(p.x, p.y, p.z); pos.push(m.x, m.y, m.z); const cc = new THREE.Color(c); col.push(cc.r, cc.g, cc.b); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({
      size, map: glowTex, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false,
    }));
    pts.userData.base = col.slice();
    pts.frustumCulled = false;
    return pts;
  };
  const nav = pointsOf([
    [V(-3.0, 17.3, 0.12), C.red], [V(-3.0, -17.3, 0.12), C.green], [V(TAIL_X - 0.05, 0, 0.85), '#ffffff'],
  ], 1.4);
  const flash = pointsOf([
    [V(-1.5, 0, fuseTop(-1.5) + 0.1), C.red], [V(1.5, 0, -2.45), C.red],
    [V(-3.15, 17.35, 0.12), '#ffffff'], [V(-3.15, -17.35, 0.12), '#ffffff'], [V(TAIL_X - 0.08, 0, 0.75), '#ffffff'],
  ], 3.2);

  const object = new THREE.Group();
  object.name = 'aircraft';
  object.add(mesh, nav, flash);

  // --- Animation ---
  const qa = new THREE.Quaternion();
  const rot = (name, angle) => { const bn = B[name]; bn.quaternion.setFromAxisAngle(bn.userData.axis, angle); };
  const move = (name, dx, dy, dz) => { // offset in body axes, in the parent's frame
    const bn = B[name]; bn.position.copy(bn.userData.rest).add(toModel(dx, dy, dz));
  };
  const slide = (name, d) => { const bn = B[name]; bn.position.copy(bn.userData.rest).addScaledVector(bn.userData.axis, d); };
  void qa;
  let fanL = 0, fanR = 0, wheelMain = 0, wheelNose = 0, clock = 0;

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
      // Slats: forward and down on their tracks, nose down.
      const sl = clamp((state.slatDeg || 0) / 27, 0, 1.2);
      rot('slats' + S, (state.slatDeg || 0) * DEG * 0.85);
      move('slats' + S, 0.34 * sl, 0, -0.1 * sl);
      // Fowler flaps: mostly aft travel first, then rotation.
      const fd = state.flapDeg || 0, tr = clamp(fd / 20, 0, 1);
      rot('flapIn' + S, -fd * DEG);
      move('flapIn' + S, -0.95 * tr, 0, -0.1 * tr);
      rot('flapOut' + S, -fd * DEG);
      move('flapOut' + S, -0.72 * tr, 0, -0.08 * tr);
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

    // Engines: fans (a visual rate that reads as spinning), reversers.
    const en = state.engines || [];
    const rate = (n1) => ((n1 || 0) / 100) * 7.5 * Math.PI * 2;
    fanL = (fanL + rate(en[0]?.n1) * dt) % (Math.PI * 2);
    fanR = (fanR + rate(en[1]?.n1) * dt) % (Math.PI * 2);
    rot('fanL', fanL); rot('fanR', fanR);
    move('revL', -0.6 * clamp(en[0]?.rev || 0, 0, 1), 0, 0);
    move('revR', -0.6 * clamp(en[1]?.rev || 0, 0, 1), 0, 0);

    // Lights: beacons ~1 Hz alternating, strobes double-flash every 1.3 s.
    const fc = flash.geometry.attributes.color, base = flash.userData.base;
    const tb = clock % 1.0, ts = clock % 1.3;
    const on = [tb < 0.12, tb > 0.5 && tb < 0.62, ts < 0.05 || (ts > 0.16 && ts < 0.21)];
    const lit = [on[0], on[1], on[2], on[2], on[2]];
    for (let i = 0; i < 5; i++) for (let k = 0; k < 3; k++) fc.array[i * 3 + k] = lit[i] ? base[i * 3 + k] : 0;
    fc.needsUpdate = true;
  }

  let cockpitView = false;
  function setCockpitView(on) {
    if (on === cockpitView) return;
    cockpitView = on;
    B.nose.scale.setScalar(on ? 1e-4 : 1);
  }

  update({}, 0);
  return { object, update, setCockpitView, mesh, bones: B, triangles: geometry.index.count / 3 };
}
