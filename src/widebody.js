// A widebody airliner built in code from a spec (src/widebody-specs.js): the fuselage from
// src/widebody-shape.js, the wing, nacelles, tail, bogies and every moving surface, in the Nuclear
// Airlines livery (src/livery-widebody.js). The 787-9 and the 777-300ER are two specs; whatever differs
// between them beyond the numbers is an optional spec field whose default is the 787's.
//
// As aircraft.js does: everything is built in the body frame (+x forward, +y left, +z up, metres) and
// converted once to the model frame (X = −y, Y = z, Z = −x). The airframe is one SkinnedMesh with one
// material, each moving part skinned rigidly to its own bone; the light glows are one Points draw.
//
//   createWidebody(spec, opts?) → { object, update(state, dt), setCockpitView(bool), mesh, triangles,
//     setLights({ nav, beacon, strobe, landing, taxi, logo }), setNight(0..1), lampPose() → { pos, dir },
//     setWingFlex(metres), bones, shape, windows }
//   setWingFlex is a hook for the bending wing (V030.md's "nice" list): metres of extra lift at the
//   tips, applied in the vertex shader. main.js drives it from the lift (def.wingFlexM).

import * as THREE from '../vendor/three.module.js';
import {
  Builder, grid, slab, cylBetween, boxAt, lathe, sphereAt, foilPoint, foilPiece, plateOffset, toModel, SIGNS, SHROUD_LIFT,
} from './aircraft.js';
import { UV } from './livery.js';
import { createWidebodyLivery, finBoxFor, fuseUVFor } from './livery-widebody.js';
import { fuselageShape, curve } from './widebody-shape.js';
import { boeingWindowOutlines } from './cockpit-windows-boeing.js';
import { createLampGlows, flashAt } from './aircraft-lights.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const C = {
  white: '#f3f5f7', navy: '#122654', wing: '#c6cbd2', wingDark: '#aab0b8', stab: '#d9dde2',
  metal: '#9aa0a8', gear: '#c9cdd2', chrome: '#e2e5e8', tyre: '#1a1b1d', hub: '#62676e',
  core: '#767b83', plug: '#3a3d43', fanFace: '#25282e', blade: '#5a6068', pylon: '#d5d9de',
  cascade: '#3d4148', red: '#ff2a1a', green: '#22ff55', lamp: '#ffffff', glass: '#0b1117',
  doorIn: '#b9bec5',   // the inside of the gear doors (v0.3.1)
};

// The nacelle's profile, in fractions: x of half the cowl's length from its centre, r of its radius.
// The GEnx's long, clean nacelle: no step behind the lip, widest a quarter of the way back.
const INTAKE = [
  [0.62, 0.742, 0], [0.78, 0.757, 0.1], [0.92, 0.795, 0.22], [0.975, 0.825, 0.3], [1.0, 0.86, 0.36], [1.0, 0.895, 0.42],
  [0.975, 0.925, 0.48], [0.93, 0.95, 0.55], [0.80, 0.98, 0.6], [0.55, 1.0, 0.68], [0.2, 0.995, 0.8], [-0.04, 0.975, 1],
];
// The side stay's reach from the leg, inboard and up, m; its folding angle follows.
const STAY_DY = 1.7, STAY_DZ = 0.95;
const SLEEVE = [
  // x, r, how far the row follows the chevrons (0..1)
  [-0.04, 0.975, 0], [-0.4, 0.93, 0], [-0.72, 0.865, 0.1], [-0.88, 0.825, 0.55], [-1.0, 0.79, 1],
  [-0.995, 0.78, 1], [-0.86, 0.80, 0.5], [-0.5, 0.84, 0], [-0.04, 0.87, 0],
];

// A tyre with rounded shoulders, about an axle along body y, centred on c.
function tyre(c, R, W, segs = 20) {
  const prof = [[0.66, -0.5], [0.86, -0.5], [0.96, -0.42], [1, -0.26], [1, 0.26], [0.96, 0.42], [0.86, 0.5], [0.66, 0.5]];
  const rows = prof.map(([r, y]) => {
    const row = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      row.push(V(c.x + R * r * Math.cos(a), c.y + W * y, c.z + R * r * Math.sin(a)));
    }
    return row;
  });
  return grid(rows, { expect: (q) => q.clone().sub(c) });
}

// The inboard flap's leading edge (v0.3.1), body x at span y: straight from 0.45 m behind the main
// gear's leg (or hingeF, if that's further aft) at the flap's inboard end to hingeF at its outboard
// end. Pure, so the tests can check it clears the gear.
export function inboardFlapLE(spec) {
  const WS = spec.wing, le = curve(WS.le), te = curve(WS.te), HF = WS.hingeF;
  const xHF = (y) => le(y) - HF * Math.max(0.05, le(y) - te(y));
  const [y0, y1] = WS.flapIn;
  const x0 = Math.min(xHF(y0), spec.geo.GEAR.left.x - 0.45), x1 = xHF(y1);
  return { y0, y1, x0, x1, xAt: (y) => x0 + ((x1 - x0) * (y - y0)) / (y1 - y0) };
}

export function createWidebody(spec, opts = {}) {
  const G = spec.geo, N = G.NOSE_X;
  const shape = fuselageShape(spec);
  const { fuseTop, fuseBot, fuseMid, fuseHW, fusePoint } = shape;
  const windows = boeingWindowOutlines(spec, shape);   // one design, for the glass, the livery and the cockpit's shell
  const A = spec.data || {};
  const staticComp = {
    nose: A.GEAR_DATA?.nose?.staticComp ?? 0.2, main: A.GEAR_DATA?.main?.staticComp ?? 0.28,
    ...(opts.staticCompression || {}),
  };
  const WS = spec.wing, TP = spec.tailplane, BG = G.BOGIE, GS = spec.gear, LS = spec.lights || {};
  const R_MAIN = BG.wheelRadiusMain, R_NOSE = BG.wheelRadiusNose, NAXLES = BG.axles || 2;
  const AFT_STEER = NAXLES > 2 ? GS.aftSteer || null : null;   // { maxDeg, fromDeg, atDeg } of the aft axle, against the nosewheel's
  const b = new Builder();
  const bones = [], B = {};

  function bone(name, parent, pivot, axis = V(1, 0, 0)) {
    const bn = new THREE.Bone();
    bn.name = name;
    const p = toModel(pivot.x, pivot.y, pivot.z);
    bn.userData.pivot = p.clone();
    bn.userData.axis = toModel(axis.x, axis.y, axis.z).normalize();
    if (parent) { bn.position.copy(p).sub(B[parent].userData.pivot); B[parent].add(bn); } else bn.position.copy(p);
    bn.userData.rest = bn.position.clone();
    bones.push(bn); B[name] = bn;
    return bones.length - 1;
  }

  const eye = G.EYES.captain;
  const SPLIT = eye.x - spec.splitBehindEye;
  const ROOT = bone('root', null, V(0, 0, 0));
  const NOSE = bone('nose', 'root', V(SPLIT + 1, 0, 0.2));

  // The skin's outward normal at (x, θ); leaves the point in P.
  const surfN = (x, t, off, P, Px, Pt, Q) => {
    fusePoint(x, t, off, P);
    fusePoint(x + 0.01, t, off, Px).sub(fusePoint(x - 0.01, t, off, Q));
    fusePoint(x, t + 0.5, off, Pt).sub(fusePoint(x, t - 0.5, off, Q));
    const n = new THREE.Vector3().crossVectors(Pt, Px);
    if (n.lengthSq() < 1e-12) return n.set(1, 0, 0);
    n.normalize();
    if (n.y * P.y + n.z * (P.z - fuseMid(x)) < 0) n.negate();
    return n;
  };

  // --- Fuselage: two lofts, the forward one hidden in the seat views ---
  const NA = 64, fuseUV = fuseUVFor(spec), tailEnd = shape.tailEndX;
  function fuseLoft(stations) {
    const rows = [], uvs = [];
    for (const x of stations) {
      const row = [], urow = [];
      for (let i = 0; i <= NA; i++) {
        const th = -90 + (360 * i) / NA;
        row.push(fusePoint(x, th, 0, new THREE.Vector3())); urow.push(fuseUV(x, th));
      }
      rows.push(row); uvs.push(urow);
    }
    const g = grid(rows, { uvs, expect: (c) => V(0, c.y, c.z - fuseMid(c.x)) });
    // Normals from the shape itself: the two lofts then meet without a shading seam at the split.
    const nrm = g.attributes.normal, P = V(0, 0, 0), Px = V(0, 0, 0), Pt = V(0, 0, 0), Q = V(0, 0, 0);
    stations.forEach((x, k) => {
      for (let i = 0; i <= NA; i++) {
        const j = k * (NA + 1) + i, th = -90 + (360 * i) / NA;
        if (x > N - 0.02) { nrm.setXYZ(j, 1, 0, 0); continue; }
        const n = surfN(x, th, 0, P, Px, Pt, Q);
        nrm.setXYZ(j, n.x, n.y, n.z);
      }
    });
    return g;
  }
  const xTailStart = N - (spec.fuselage.tailConeD ?? spec.fuselage.top.find((p) => p[0] > 40)?.[0] ?? 44) - 2;   // where the cone begins
  const tailSt = [], midSt = [], noseSt = [];
  for (let i = 0; i <= 34; i++) tailSt.push(tailEnd + (xTailStart - tailEnd) * (i / 34) ** 1.15);
  // The even rows are too coarse where the nose's shoulder still curves behind the split: a chord across
  // it lies under the true curve that the windows' glass follows. spec.fuselage.midD places them instead.
  if (spec.fuselage.midD) { for (const d of spec.fuselage.midD) midSt.push(N - d); midSt.push(SPLIT); }
  else for (let i = 1; i <= 8; i++) midSt.push(xTailStart + ((SPLIT - xTailStart) * i) / 8);
  for (let i = 0; i <= 38; i++) noseSt.push(SPLIT + (N - SPLIT) * Math.sin((i / 38) * Math.PI / 2) ** 0.9);
  b.add(fuseLoft([...tailSt, ...midSt]), ROOT, '#ffffff', 'keep');
  b.add(fuseLoft(noseSt), NOSE, '#ffffff', 'keep');
  // The tail cone's end, with the APU's exhaust in it.
  {
    const zc = fuseMid(tailEnd), h = (fuseTop(tailEnd) - fuseBot(tailEnd)) / 2;
    const g = lathe([{ x: 0.0, r: spec.fuselage.tailCapR ?? Math.max(h, fuseHW(tailEnd)) * 0.9 }, { x: -0.05, r: 0.0 }], 12, tailEnd, 0, zc);
    b.add(g, ROOT, C.plug);
  }

  // --- Glass: the cockpit windows and the cabin's ---
  function glassFrom(outline, mirror, off, kTheta, maxEdge) {
    const th = (t) => (mirror ? 180 - t : t);
    const ring = outline.map(([x, t]) => new THREE.Vector2(x, th(t) * kTheta));
    let tris = THREE.ShapeUtils.triangulateShape(ring, []).map((f) => f.map((k) => [ring[k].x, ring[k].y]));
    for (let pass = 0; pass < 10; pass++) {
      const next = []; let split = false;
      for (const t of tris) {
        const e = [0, 1, 2].map((i) => Math.hypot(t[(i + 1) % 3][0] - t[i][0], t[(i + 1) % 3][1] - t[i][1]));
        const i = e.indexOf(Math.max(...e));
        if (e[i] < maxEdge) { next.push(t); continue; }
        split = true;
        const a = t[i], c0 = t[(i + 1) % 3], c = t[(i + 2) % 3], m = [(a[0] + c0[0]) / 2, (a[1] + c0[1]) / 2];
        next.push([a, m, c], [m, c0, c]);
      }
      tris = next;
      if (!split) break;
    }
    const pos = [], nrm = [];
    const P = V(0, 0, 0), Px = V(0, 0, 0), Pt = V(0, 0, 0), Q = V(0, 0, 0);
    const AA = V(0, 0, 0), BB = V(0, 0, 0), CC = V(0, 0, 0);
    for (const t of tris) {
      const v = t.map(([x, tk]) => { const n = surfN(x, tk / kTheta, off, P, Px, Pt, Q); return [P.toArray(), n.toArray()]; });
      AA.fromArray(v[0][0]); BB.fromArray(v[1][0]); CC.fromArray(v[2][0]);
      const n = BB.clone().sub(AA).cross(CC.clone().sub(AA));
      const order = n.dot(V(0, 0, 0).fromArray(v[0][1])) < 0 ? [0, 2, 1] : [0, 1, 2];
      for (const k of order) { pos.push(...v[k][0]); nrm.push(...v[k][1]); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    return g;
  }
  for (const w of windows) for (const mirror of [false, true]) b.add(glassFrom(w, mirror, 0.008, 0.033, 0.16), NOSE, C.glass);
  // The 787's big cabin windows: glass geometry, since the atlas (about 3 cm a pixel on a fuselage this
  // long) can't draw them crisply. The livery paints a dark backing under each.
  {
    const CAB = spec.cabin, win = CAB.window;
    const doorClear = (d) => CAB.doors.every((dd) => Math.abs(d - dd) > CAB.doorW / 2 + win.w);
    const pos = [], nrm = [], P = V(0, 0, 0), Px = V(0, 0, 0), Pt = V(0, 0, 0), Q = V(0, 0, 0);
    for (let d = win.first; d < win.last; d += win.pitch) {
      if (!doorClear(d)) continue;
      const x0 = N - d, s = shape.fuseSection(x0);
      for (const side of [1, -1]) {
        const ring = [];
        // An upright rounded rectangle, 10 points.
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          const cx = Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** 0.6 * win.w / 2;
          const cz = Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** 0.6 * win.h / 2;
          const x = x0 + cx, z = win.z + cz;
          const sx = shape.fuseSection(x);
          const t = Math.asin(clamp((z - sx.zc) / sx.up, -1, 1)) / DEG;
          ring.push([x, side > 0 ? t : 180 - t]);
        }
        const cen = (() => {
          const t = Math.asin(clamp((win.z - s.zc) / s.up, -1, 1)) / DEG;
          return [x0, side > 0 ? t : 180 - t];
        })();
        const nc = surfN(cen[0], cen[1], 0.008, P, Px, Pt, Q).toArray(), pc = P.toArray();
        const pts = ring.map(([x, t]) => { const n = surfN(x, t, 0.008, P, Px, Pt, Q); return [P.toArray(), n.toArray()]; });
        for (let k = 0; k < 10; k++) {
          const a = pts[k], c = pts[(k + 1) % 10];
          // Facing out on both sides: the winding flips with the side.
          const tri = side > 0 ? [[pc, nc], c, a] : [[pc, nc], a, c];
          for (const [p, n] of tri) { pos.push(...p); nrm.push(...n); }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    b.add(g, ROOT, C.glass);
  }

  // --- Belly fairing ---
  const FR = spec.fairing;
  const dT = (t) => t.map(([d, v]) => [N - d, v]).reverse();
  const fairHW = curve(dT(FR.hw)), fairBot = curve(dT(FR.bot));
  const fairPoint = (x, th, off = 0) => V(x, (fairHW(x) + off) * Math.cos(th), FR.zc + (Math.sin(th) > 0 ? FR.up : FR.zc - fairBot(x) + off) * Math.sin(th));
  {
    const x1 = N - FR.hw[0][0], x0 = N - FR.hw[FR.hw.length - 1][0], rows = [];
    for (let i = 0; i <= 26; i++) {
      const x = x0 + ((x1 - x0) * i) / 26, row = [];
      for (let j = 0; j <= 40; j++) row.push(fairPoint(x, -Math.PI / 2 + (2 * Math.PI * j) / 40));
      rows.push(row);
    }
    b.add(grid(rows, { expect: (c) => V(0, c.y, c.z - FR.zc) }), ROOT, C.navy);
  }

  // --- Wing ---
  const leOf = curve(WS.le), teOf = curve(WS.te), tOf = curve(WS.t);
  const ys = G.FUSELAGE_WIDTH / 2, tipY = G.SPAN / 2;
  const DIH = Math.tan(G.WING.dihedralDeg * DEG);
  const bendTip = G.WING.tipZ - (WS.z0 + (tipY - ys) * DIH);
  // A type whose front view isn't a straight dihedral plus a tip bend gives its chord plane as a table.
  const zTable = WS.zTable ? curve(WS.zTable) : null;
  const wingZ = (y) => {
    if (zTable) return zTable(y);
    const s = clamp((y - ys) / (tipY - ys), 0, 1);
    return WS.z0 + (y - ys) * DIH + bendTip * s ** (WS.bendExp ?? 3.2);     // the static bend: upward towards the tip
  };
  function wingSec(y, side) {
    const xle = leOf(y), slope = (wingZ(y + 0.05) - wingZ(y - 0.05)) / 0.1, phi = Math.atan(slope);
    return {
      le: V(xle, side * y, wingZ(y)), chord: Math.max(0.05, xle - teOf(y)), t: tOf(y),
      c: V(-1, 0, 0), n: V(0, -side * Math.sin(phi), Math.cos(phi)), camber: 0.012,
    };
  }
  const stationsBetween = (y0, y1) => [y0, ...WS.stations.filter((y) => y > y0 + 0.02 && y < y1 - 0.02), y1];
  const HF = WS.hingeF, LF = WS.leF;
  const lightY = WS.landingLightY, lightF = WS.landingLightF;

  for (const side of [1, -1]) {
    const S = side > 0 ? 'L' : 'R';
    const ws = (y) => wingSec(y, side);
    const secs = (ys2) => ys2.map(ws);
    const LAST = WS.aileron[1];
    // The inboard flap's leading edge (v0.3.1). At hingeF of the chord it ran through the main gear's
    // leg, so with the flaps out the leg hung from the empty flap cove. It now runs straight from
    // behind the leg (0.45 m clear of its axis) at the flap's inboard end to hingeF at its outboard
    // end, and the fixed structure ahead of it (the rear spar and the gear beam) carries the leg.
    const fAt = (y, x) => { const w = ws(y); return (w.le.x - x) / w.chord; };
    const xAt = (y, f) => { const w = ws(y); return w.le.x - f * w.chord; };
    const FL = inboardFlapLE(spec), [FI0, FI1] = WS.flapIn;
    const inFin = (y) => y >= FI0 - 1e-6 && y <= FI1 + 1e-6;
    const fFlapLE = (y) => (inFin(y) ? fAt(y, FL.xAt(y)) : HF);
    // Fixed structure, then the fixed parts of the leading and trailing edges. The fixed leading edge
    // behind the slats is a round nose about the slats' hinge line, so a slat that droops about that
    // line stays sealed against it (v0.4.1, below).
    // LAST is one of its sections even where it isn't a station (v0.4.1: the 777's aileron ends at 29.6,
    // between stations, so the box stopped at 28 and left a hole in front of the aileron).
    const fixYs = [...new Set([0.6, ...WS.stations.filter((y) => y < LAST), FI0, FI1, LAST])].sort((p, q) => p - q);
    b.add(foilPiece(secs(fixYs), LF, fixYs.map(fFlapLE), { caps: [false, false], nf: 6, nose: 1 }), ROOT, C.wing);
    // The tip, outboard of the aileron. Where the outer slat runs on past the aileron (the 777's), the
    // tip has the same round nose behind it until the slat ends, not a second leading edge in it.
    const seg0 = WS.slatSegments[0][0], segN = WS.slatSegments[WS.slatSegments.length - 1][1];
    if (segN > LAST + 0.001) {
      b.add(foilPiece(secs(stationsBetween(LAST, segN)), LF, 1, { caps: [true, true], nf: 8, nose: 1 }), ROOT, C.wing);
      b.add(foilPiece(secs(stationsBetween(segN, tipY)), 0, 1, { caps: [true, true], nf: 8 }), ROOT, C.wing);
    } else b.add(foilPiece(secs(stationsBetween(LAST, tipY)), 0, 1, { caps: [true, true], nf: 8 }), ROOT, C.wing);
    // The fixed leading edge where there's no slat: from the root, across wide gaps between slats (the
    // pylon's), and from the last slat to the tip. Each closes its ends, as a slat that's out shows them.
    // A narrow gap between two slats (a panel line) is a slightly sunken filler on the slats' bone
    // instead, so it droops with them; it was an open slot before v0.4.1, light through the wing.
    const slatGaps = [];
    let y = 0.6;
    for (const [y0, y1] of WS.slatSegments) {
      if (y0 - y > 0.15 || y === 0.6) b.add(foilPiece(secs(stationsBetween(y, y0)), 0, LF, { caps: [y > 0.6, true], nf: 5 }), ROOT, C.wingDark);
      else if (y0 > y) slatGaps.push([y, y0]);
      y = y1;
    }
    if (LAST - y > 0.001) b.add(foilPiece(secs(stationsBetween(y, LAST)), 0, LF, { caps: [true, true], nf: 5 }), ROOT, C.wingDark);
    b.add(foilPiece(secs(stationsBetween(0.6, FI0)), HF, 1, { caps: [false, true], nf: 5 }), ROOT, C.wing);

    // Slats, one bone a wing, hinged along the straight line through the fixed nose's centre at the
    // first and last slats' ends. v0.4.1: they droop about it and no longer run out on tracks, so no
    // slot opens between slat and wing (Shane: "close it up"); the round nose fills the slat's back.
    const slatA = foilPoint(ws(seg0), LF, 0), slatB = foilPoint(ws(segN), LF, 0);
    const SL = bone('slats' + S, 'root', slatA, slatB.clone().sub(slatA).multiplyScalar(side).normalize());
    for (const [y0, y1] of WS.slatSegments) b.add(foilPiece(secs(stationsBetween(y0, y1)), 0, LF, { nf: 5 }), SL, C.metal);
    const sunk = (w) => ({ ...w, le: w.le.clone().addScaledVector(w.c, 0.012 * w.chord), chord: w.chord * 0.988, t: w.t * 0.88 });
    for (const [y0, y1] of slatGaps) b.add(foilPiece([y0, y1].map((q) => sunk(ws(q))), 0, LF + 0.01, { nf: 5 }), SL, C.wingDark);

    // Trailing-edge surfaces: hinged at the surface's leading edge, mid-thickness. f0 and f1 may be
    // functions of the span (the inboard flap's leading edge, the spoilers over it).
    const hinged = (name, y0, y1, f0, f1, color, o = {}) => {
      const F0 = typeof f0 === 'function' ? f0 : () => f0, F1 = typeof f1 === 'function' ? f1 : () => f1;
      const pa = o.plate ? plateOffset(ws(y0), F0(y0), -1) : foilPoint(ws(y0), F0(y0), 0);
      const pb = o.plate ? plateOffset(ws(y1), F0(y1), -1) : foilPoint(ws(y1), F0(y1), 0);
      const idx = bone(name + S, o.parent ? o.parent + S : 'root', pa, pb.clone().sub(pa).multiplyScalar(side).normalize());
      const ys2 = stationsBetween(y0, y1);
      b.add(foilPiece(secs(ys2), ys2.map(F0), ys2.map(F1), { plate: o.plate, nf: o.plate ? 3 : 5, nose: o.nose || 0 }), idx, color);
      return idx;
    };
    // A double-slotted inboard flap (spec.wing.flapInAftF, the chord fraction where its aft flap starts
    // at hingeF) is two pieces: the aft one rides on the main one and opens further (update()). With
    // the leading edge moved, the aft flap keeps its share of the flap's chord.
    const aftShare = WS.flapInAftF ? (WS.flapInAftF - HF) / (1 - HF) : 0;
    const fAftF = (y) => fFlapLE(y) + aftShare * (1 - fFlapLE(y));
    hinged('flapIn', FI0, FI1, fFlapLE, WS.flapInAftF ? fAftF : 1, C.wing, { nose: 1 });
    if (WS.flapInAftF) hinged('flapInAft', FI0, FI1, fAftF, 1, C.wing, { parent: 'flapIn', nose: 1 });
    hinged('flaperon', WS.flaperon[0], WS.flaperon[1], HF, 1, C.wing);
    hinged('flapOut', WS.flapOut[0], WS.flapOut[1], HF, 1, C.wing, { nose: 1 });
    hinged('aileron', WS.aileron[0], WS.aileron[1], HF, 1, C.wing);
    // The fixed trailing edge between the moving surfaces, closed at its ends (v0.4.1: they were 0.1 m
    // slots, light through the wing).
    const teSpans = [WS.flapIn, WS.flaperon, WS.flapOut, WS.aileron];
    for (let i = 0; i + 1 < teSpans.length; i++) {
      const [y0, y1] = [teSpans[i][1], teSpans[i + 1][0]];
      if (y1 - y0 > 0.001) b.add(foilPiece(secs([y0, y1]), HF, 1, { nf: 5 }), ROOT, C.wing);
    }
    // Spoilers: plates on the upper surface whose trailing edges overhang the flaps by about what the
    // flaps travel (less a slot), as the real ones do, so a flap that's out leaves a slot under them,
    // not an open gap. Each keeps its drawn width, moved aft by the overhang. Under them a fixed shroud
    // runs each flap's whole span, so there's no light between spoilers, nor a gap where there's none.
    const SPF = WS.spoilerF ?? 0.56, OV = { in: WS.flapTravel.in - 0.15, out: WS.flapTravel.out - 0.15 };
    const overhang = (y) => Math.min(inFin(y) ? OV.in : OV.out, 0.6 * ws(y).chord * (1 - fFlapLE(y)));
    const spAft = (y) => fAt(y, xAt(y, fFlapLE(y)) - overhang(y));
    const spFront = (y) => spAft(y) - (HF - SPF);
    WS.spoilers.forEach(([y0, y1], i) => hinged('spoiler' + (i + 1), y0, y1, spFront, (y) => spAft(y) + 0.005, C.wingDark, { plate: true }));
    for (const [f0y, f1y] of [WS.flapIn, WS.flapOut]) {
      const ys2 = stationsBetween(f0y, f1y);
      b.add(foilPiece(secs(ys2), ys2.map((q) => fFlapLE(q) - 0.02), ys2.map((q) => spAft(q) + 0.005), { plate: true, nf: 3, lift: SHROUD_LIFT }), ROOT, C.wingDark);
    }

    // Flap track fairings: the aft part hinges down from the fixed front as the flaps run out (update()),
    // rather than riding away with the flap and leaving the front part hanging. They reach well past the
    // trailing edge.
    WS.canoes.forEach(([yc], i) => {
      const w = ws(yc), L = 0.62 * w.chord + 1.2, xs2 = w.le.x - 0.52 * w.chord, zc = w.le.z - 0.055 * w.chord - 0.05;
      const r = 0.2 + 0.016 * w.chord;
      const prof = [[0, 0.0], [0.07, 0.55], [0.22, 0.9], [0.42, 1], [0.7, 0.72], [0.9, 0.32], [1, 0.02]].map(([t, k]) => ({ x: -t * L, r: k * r }));
      b.add(lathe(prof.slice(0, 4), 14, xs2, side * yc, zc), ROOT, C.wingDark);
      const CB = bone('canoe' + i + S, 'root', V(xs2 - 0.42 * L, side * yc, zc + r), V(0, 1, 0));
      b.add(lathe(prof.slice(3), 14, xs2, side * yc, zc), CB, C.wingDark);
    });

    // --- Engine ---
    const E = G.NACELLES[side > 0 ? 0 : 1];
    const ex = E.x, ey = E.y, ez = E.z, RN = G.NACELLE_DIAMETER / 2, HL = G.NACELLE_LENGTH / 2, CL = G.NACELLE_CORE_LENGTH;
    const EN = spec.engine, RF = EN.fanR;
    b.add(lathe((EN.intake || INTAKE).map(([f, r, v]) => ({ x: f * HL, r: r * RN, v })), 48, ex, ey, ez, UV.nacelle), ROOT, '#ffffff', 'keep');
    // The translating sleeve, with the chevrons on its trailing edge.
    const REV = bone('rev' + S, 'root', V(ex, ey, ez));
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
      b.add(grid(rows), REV, C.navy);
    }
    // Inside: the cascades that show when the sleeve moves back, the fan duct, the core and its plug.
    b.add(lathe([{ x: -0.04 * HL + 0.0, r: 0.95 * RN }, { x: -0.5 * HL, r: 0.885 * RN }], 32, ex, ey, ez), ROOT, C.cascade);
    const CR = EN.coreR ?? 1;    // the core's radius against the 787's, for a bigger bypass ratio
    b.add(lathe([
      { x: 0.42 * HL, r: 0.33 * RN * CR }, { x: -0.1 * HL, r: 0.5 * RN * CR }, { x: -0.7 * HL, r: 0.5 * RN * CR }, { x: -1.0 * HL, r: 0.46 * RN * CR },
      { x: -HL - 0.55 * CL, r: 0.34 * RN * CR }, { x: -HL - 0.58 * CL, r: 0.27 * RN * CR },
    ], 32, ex, ey, ez), ROOT, C.core);
    b.add(lathe([{ x: -HL - 0.5 * CL, r: 0.26 * RN * CR }, { x: -HL - 0.8 * CL, r: 0.16 * RN * CR }, { x: -HL - CL, r: 0.01 }], 20, ex, ey, ez), ROOT, C.plug);
    b.add(lathe([{ x: ((EN.fanF ?? 0.6) - 0.02) * HL, r: 0 }, { x: ((EN.fanF ?? 0.6) - 0.02) * HL, r: RF }], 32, ex, ey, ez), ROOT, C.fanFace);
    const FAN = bone('fan' + S, 'root', V(ex, ey, ez), V(1, 0, 0));
    const fx = (EN.fanF ?? 0.6) * HL, SK = EN.spinnerK ?? 1, HUB = 0.4 * SK;
    const spinnerAt = [[0.72, 0], [0.62, 0.11], [0.36, 0.27], [0.08, 0.42], [-0.08, 0.46]];
    b.add(lathe(spinnerAt.map(([x, r]) => ({ x: fx + x * SK, r: r * SK })), 24, ex, ey, ez), FAN, C.navy);
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
      b.add(grid(rows, { expect: (c) => V(0.4, c.y - ey, c.z - ez) }), FAN, C.white);
    } else b.add(boxAt(ex + fx + 0.3, ey, ez + 0.2, 0.42, 0.05, 0.2), FAN, C.white);  // so the rotation shows
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
      b.add(g, FAN, C.blade);
    }
    // Pylon: a profile in (x, z) extruded sideways, from the cowl's top into the wing and back
    // under it to the fairing behind the trailing edge.
    {
      const w = wingSec(Math.abs(ey), side), sh = new THREE.Shape();
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
      b.add(g, ROOT, C.pylon);
    }

    // --- Main gear: a four- or six-wheel bogie on a leg that folds inward into the belly ---
    const gm = side > 0 ? G.GEAR.left : G.GEAR.right;
    const axleZ = gm.z + R_MAIN;
    const pivot = V(gm.x, gm.y, spec.gear.mainPivotZ);
    const LEG = bone('mainLeg' + S, 'root', pivot, V(1, 0, 0));
    const zLow = axleZ + 0.72;
    b.add(cylBetween(pivot, V(gm.x, gm.y, zLow), 0.2, 0.19, 14), LEG, C.gear);
    // Side stay (to the fairing), drag brace (forward).
    const midZ = (pivot.z + zLow) / 2 - 0.3;
    // The side stay folds up against the leg as it retracts (update() rotates it), or it would
    // come out through the top of the wing.
    const STAY = bone('stay' + S, 'mainLeg' + S, V(gm.x, gm.y, midZ), V(1, 0, 0));
    b.add(cylBetween(V(gm.x, gm.y, midZ), V(gm.x, gm.y - side * (GS.stayDY ?? STAY_DY), midZ + (GS.stayDZ ?? STAY_DZ)), 0.075, 0.075, 8), STAY, C.gear);
    b.add(cylBetween(V(gm.x, gm.y, midZ - 0.1), V(gm.x + 1.35, gm.y, pivot.z - 0.2), 0.08, 0.08, 8), LEG, C.gear);
    // The leg's door, outboard of it.
    b.add(boxAt(gm.x, gm.y + side * 0.3, pivot.z - 0.75, 0.85, 0.035, 1.5), LEG, C.navy);
    const PIS = bone('mainPiston' + S, 'mainLeg' + S, V(gm.x, gm.y, axleZ), V(0, 0, 1));
    b.add(cylBetween(V(gm.x, gm.y, zLow + 0.3), V(gm.x, gm.y, axleZ), 0.13, 0.13, 12), PIS, C.chrome);
    const TRUCK = bone('bogie' + S, 'mainPiston' + S, V(gm.x, gm.y, axleZ), V(0, 1, 0));
    const AX = (BG.axleSpacing * (NAXLES - 1)) / 2, TR = BG.tread / 2, TW = BG.wheelWidthMain;
    b.add(cylBetween(V(gm.x + AX + 0.1, gm.y, axleZ + 0.02), V(gm.x - (BG.axleSpacingAft ?? AX) - 0.1, gm.y, axleZ + 0.02), 0.11, 0.11, 8), TRUCK, C.gear);
    // Torque link, from the piston to the beam.
    b.add(cylBetween(V(gm.x, gm.y, zLow + 0.15), V(gm.x + 0.4, gm.y + side * 0.14, axleZ + 0.35), 0.035, 0.035, 5), PIS, C.gear);
    for (let ia = 0; ia < NAXLES; ia++) {
      // The 777's aft axle has its own spacing from the centre one.
      const ax = BG.axleSpacingAft && ia === NAXLES - 1 ? gm.x - BG.axleSpacingAft : gm.x + AX - ia * BG.axleSpacing;
      // A steered aft axle (the 777's) turns on the beam, carrying its two wheels with it.
      const steered = AFT_STEER && ia === NAXLES - 1;
      const AXLE = steered ? bone('aftAxle' + S, 'bogie' + S, V(ax, gm.y, axleZ), V(0, 0, 1)) : TRUCK;
      b.add(cylBetween(V(ax, gm.y - TR, axleZ), V(ax, gm.y + TR, axleZ), 0.075, 0.075, 8), AXLE, C.gear);
      const WH = bone('mainWheel' + S + ia, steered ? 'aftAxle' + S : 'bogie' + S, V(ax, gm.y, axleZ), V(0, 1, 0));
      for (const dy of [-TR, TR]) {
        const c = V(ax, gm.y + dy, axleZ);
        b.add(tyre(c, R_MAIN, TW), WH, C.tyre);
        b.add(new THREE.CylinderGeometry(R_MAIN * 0.68, R_MAIN * 0.68, TW - 0.04, 16).translate(c.x, c.y, c.z), WH, C.hub);
        b.add(boxAt(c.x, c.y + Math.sign(dy) * (TW / 2 - 0.015), c.z + R_MAIN * 0.42, 0.09, 0.01, 0.14), WH, C.tyre);
      }
    }
    // The belly door, hinged towards the centre line, curved to the fairing.
    {
      const L = GS.mainDoorLen, DI = GS.mainDoorIn ?? 0.35, DW = GS.mainDoorW ?? 2.75, DR = bone('mainDoor' + S, 'root', V(gm.x, side * DI, FR.bot[3][1] + 0.05), V(1, 0, 0));
      const rows = [];
      for (let i = 0; i <= 2; i++) {
        const x = gm.x - L / 2 + (L * i) / 2, row = [];
        for (let j = 0; j <= 5; j++) {
          const q = (DI + (DW * j) / 5) / fairHW(x);
          const th = -Math.acos(clamp(q, -1, 1));
          const p = fairPoint(x, th, 0.025);
          row.push(V(p.x, side * p.y, p.z));
        }
        rows.push(row);
      }
      // With some thickness and an inside (v0.3.1): a single surface didn't show from inside the bay.
      const door = slab(rows, 0.045, () => V(0, 0, -1));
      b.add(door.outer, DR, C.navy);
      b.add(door.back, DR, C.doorIn);
    }

    // Lights: nav at the tip, and the landing lamp under the inner wing.
    const tipS = wingSec(tipY - 0.25, side);
    b.add(sphereAt(tipS.le.clone().add(V(-0.1, side * 0.04, 0)), 0.08), ROOT, side > 0 ? C.red : C.green);
    b.add(sphereAt(foilPoint(wingSec(lightY, side), lightF, -1).add(V(0, 0, 0.02)), 0.14), ROOT, C.lamp);
  }

  // --- Horizontal stabiliser (trimmable) with elevators ---
  const TPG = G.TAILPLANE, stY = TPG.span / 2, tanLe = Math.tan(TP.leSweepDeg * DEG), tanSD = Math.tan(TP.dihedralDeg * DEG);
  const stabTe = curve(TP.te), stabRound = curve(TP.leTip);
  const stabSec = (y, side) => {
    const le = TPG.rootLeX - (y - TP.rootY) * tanLe - (y > TP.leTip[0][0] ? stabRound(y) : 0);
    return {
      le: V(le, side * y, TPG.z + y * tanSD), chord: Math.max(0.1, le - stabTe(y)), t: TP.t ?? 0.1,
      c: V(-1, 0, 0), n: V(0, -side * Math.sin(TP.dihedralDeg * DEG), Math.cos(TP.dihedralDeg * DEG)), camber: 0,
    };
  };
  const STAB = bone('stab', 'root', V(N - TP.pivotD, 0, TPG.z), V(0, 1, 0));
  const stStations = TP.stations ?? [0.2, 1.4, 3.03, 5.5, 8, 9.0, 9.56, stY];
  for (const side of [1, -1]) {
    const S = side > 0 ? 'L' : 'R';
    const ss = (l) => l.map((y) => stabSec(y, side));
    const [e0, e1] = TP.elevator;
    b.add(foilPiece(ss(stStations.filter((y) => y <= e1).concat([e1])), 0, TP.hingeF, { caps: [false, false], nf: 8 }), STAB, C.stab);
    b.add(foilPiece(ss([0.2, 1.4, e0]), TP.hingeF, 1, { caps: [false, true], nf: 4 }), STAB, C.stab);
    b.add(foilPiece(ss([e1, ...stStations.filter((y) => y > e1)]), 0, 1, { caps: [true, true], nf: 6 }), STAB, C.stab);
    const pa = foilPoint(stabSec(e0, side), TP.hingeF, 0), pb = foilPoint(stabSec(e1, side), TP.hingeF, 0);
    const EL = bone('elev' + S, 'stab', pa, pb.clone().sub(pa).multiplyScalar(side).normalize());
    b.add(foilPiece(ss([e0, ...stStations.filter((y) => y > e0 && y < e1), e1]), TP.hingeF, 1, { nf: 4 }), EL, C.stab);
  }

  // --- Fin, rudder, dorsal fillet, with the livery's projection ---
  const FN = spec.fin, FG = G.FIN, finBox = finBoxFor(spec);
  const finUV = (x, y, z) => [
    UV.fin.u0 + ((x - finBox.x0) / (finBox.x1 - finBox.x0)) * (UV.fin.u1 - UV.fin.u0),
    UV.fin.v0 + ((z - finBox.z0) / (finBox.z1 - finBox.z0)) * (UV.fin.v1 - UV.fin.v0),
  ];
  const finLe = curve(FN.leTable);
  const finTe = (z) => FG.rootTeX + ((z - FN.teRootZ) / (FG.topZ - FN.teRootZ)) * (FG.topTeX - FG.rootTeX);
  const finSec = (z) => ({ le: V(finLe(z), 0, z), chord: Math.max(0.1, finLe(z) - finTe(z)), t: 0.095, c: V(-1, 0, 0), n: V(0, 1, 0), camber: 0 });
  const [r0, r1] = FN.rudder, FH = FN.hingeF;
  const fz = (zs) => zs.map(finSec);
  const zSt = FN.zStations;
  b.add(foilPiece(fz(zSt.filter((z) => z <= r1).concat([r1])), 0, FH, { caps: [false, false], nf: 8 }), ROOT, '#ffffff', finUV);
  b.add(foilPiece(fz(zSt.filter((z) => z < r0).concat([r0])), FH, 1, { caps: [false, true], nf: 4 }), ROOT, '#ffffff', finUV);
  b.add(foilPiece(fz([r1, ...zSt.filter((z) => z > r1)]), 0, 1, { caps: [true, true], nf: 6 }), ROOT, '#ffffff', finUV);
  {
    const pa = foilPoint(finSec(r0), FH, 0), pb = foilPoint(finSec(r1), FH, 0);
    const RUD = bone('rudder', 'root', pa, pb.clone().sub(pa).normalize());
    b.add(foilPiece(fz([r0, ...zSt.filter((z) => z > r0 && z < r1), r1]), FH, 1, { nf: 4 }), RUD, '#ffffff', finUV);
  }
  {
    const fle = curve(FN.filletLe), zs = FN.filletLe.map((p) => p[0]), zMax = zs[zs.length - 1];
    const rowsZ = [zs[0], (zs[0] + zs[1]) / 2, zs[1], zs[2], (zs[2] + zs[3]) / 2, zs[3], (zs[3] + zMax) / 2, zMax];
    const sec = (z) => ({ le: V(fle(z), 0, z), chord: Math.max(1, fle(z) - finLe(z) + (FN.filletOver ?? 1.8)), t: 0.1, c: V(-1, 0, 0), n: V(0, 1, 0), camber: 0 });
    b.add(foilPiece(rowsZ.map(sec), 0, 1, { caps: [false, false], nf: 6 }), ROOT, '#ffffff', finUV);
  }

  // --- Nose gear: retracts forward into the bay under the flight deck; steers about the leg ---
  const NG = G.GEAR.nose;
  const nAxle = V(NG.x, 0, NG.z + R_NOSE), nPivot = V(NG.x, 0, spec.gear.nosePivotZ);
  const nAxis = nPivot.clone().sub(nAxle).normalize();
  const NLEG = bone('noseLeg', 'root', nPivot, V(0, 1, 0));
  b.add(cylBetween(nPivot, nPivot.clone().lerp(nAxle, 0.6), 0.14, 0.13, 12), NLEG, C.gear);
  // The drag brace folds up against the leg, as the main gear's side stay does.
  const nBraceAt = nPivot.clone().lerp(nAxle, 0.35);
  const NBRACE = bone('noseBrace', 'noseLeg', nBraceAt, V(0, 1, 0));
  const nBraceAngle = Math.atan2(1.25, nPivot.z - 0.05 - nBraceAt.z);
  b.add(cylBetween(nBraceAt, V(NG.x - 1.25, 0, nPivot.z - 0.05), 0.06, 0.06, 6), NBRACE, C.gear);
  b.add(sphereAt(nPivot.clone().lerp(nAxle, 0.45).add(V(0.17, 0, 0)), 0.1), NLEG, C.lamp);
  bone('noseSteer', 'noseLeg', nAxle, nAxis);
  const NPIS = bone('nosePiston', 'noseSteer', nAxle, nAxis);
  b.add(cylBetween(nPivot.clone().lerp(nAxle, 0.5), nAxle, 0.09, 0.09, 10), NPIS, C.chrome);
  b.add(cylBetween(V(nAxle.x, -BG.noseTread / 2, nAxle.z), V(nAxle.x, BG.noseTread / 2, nAxle.z), 0.06, 0.06, 8), NPIS, C.gear);
  b.add(boxAt(nAxle.x + 0.06, 0, nAxle.z + 0.5, 0.55, 0.24, 0.07), NPIS, C.gear);
  const NWH = bone('noseWheel', 'nosePiston', nAxle, V(0, 1, 0));
  for (const dy of [-BG.noseTread / 2, BG.noseTread / 2]) {
    const c = V(nAxle.x, dy, nAxle.z), TN = BG.wheelWidthNose;
    b.add(tyre(c, R_NOSE, TN, 18), NWH, C.tyre);
    b.add(new THREE.CylinderGeometry(R_NOSE * 0.68, R_NOSE * 0.68, TN - 0.03, 14).translate(c.x, c.y, c.z), NWH, C.hub);
    b.add(boxAt(c.x, c.y + Math.sign(dy) * (TN / 2 - 0.01), c.z + R_NOSE * 0.42, 0.07, 0.01, 0.1), NWH, C.tyre);
  }
  // Nose doors: patches of the skin, hinged along the bay's sides.
  for (const side of [1, -1]) {
    const [d0, d1] = spec.gear.noseDoor, xa = N - d1, xb = N - d0, rows = [], uvs = [];
    for (let i = 0; i <= 3; i++) {
      const x = xa + ((xb - xa) * i) / 3, row = [], urow = [];
      for (let j = 0; j <= 3; j++) {
        const th = -90 + side * (1.5 + (16 * j) / 3);    // θ on the left side's belly goes −90 → −74
        row.push(fusePoint(x, th, 0.02, new THREE.Vector3()));
        urow.push(fuseUV(x, th < -90 ? th + 360 : th));   // the skin's own paint, so a closed door doesn't show
      }
      rows.push(row); uvs.push(urow);
    }
    const hingeTh = -90 + side * 17.5;
    const h = fusePoint((xa + xb) / 2, hingeTh, 0.02, new THREE.Vector3());
    const D = bone('noseDoor' + (side > 0 ? 'L' : 'R'), 'root', h, V(1, 0, 0));
    const door = slab(rows, 0.04, () => V(0, 0, -1), { uvs });   // two-sided, as the belly doors (v0.3.1)
    b.add(door.outer, D, '#ffffff', 'keep');
    b.add(door.back, D, C.doorIn);
  }

  // Tail light, beacons.
  const tailZ = fuseMid(tailEnd);
  b.add(sphereAt(V(tailEnd - 0.04, 0, tailZ), 0.08), ROOT, C.lamp);
  const BCN_T = LS.beaconTopX ?? -1.5, BCN_B = LS.beaconBottomX ?? 9.0;
  b.add(sphereAt(V(BCN_T, 0, fuseTop(BCN_T) + 0.03), 0.11), ROOT, C.red);
  b.add(sphereAt(V(BCN_B, 0, fuseBot(BCN_B) - 0.02), 0.11), ROOT, C.red);

  // --- Mesh, material, skeleton ---
  const geometry = b.build();
  const { map, emissiveMap } = createWidebodyLivery(spec, shape, windows, opts.registration || spec.registration);
  const material = new THREE.MeshStandardMaterial({
    map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.6, vertexColors: true, roughness: 0.42, metalness: 0.08,
  });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = spec.name;
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.add(bones[ROOT]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  const midX = (N + G.TAIL_X) / 2;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, -midX), Math.hypot((N - G.TAIL_X) / 2, tipY) + 4);

  // The logo lights, the night fill: as aircraft.js. The mask uses the bind-pose (model frame) position.
  const logoU = { value: 0 }, fillU = { value: 0 }, flexU = { value: 0 };
  // The fuselage's crown under the fin, as a straight line in the model frame, so the pool of light
  // stays on the fin and doesn't burn out the white crown ahead of it.
  const xa = FN.filletLe[1][1], xb = G.FIN.rootTeX;
  const topA = fuseTop(xa), topSlope = (fuseTop(xb) - topA) / (-xb + xa);   // per metre of model Z
  const finY0 = fuseTop((xa + xb) / 2);
  const flexLimitZ = -(G.WING.tipTeX - 3);  // model Z behind which nothing is wing (keeps the tail out of the bend)
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uLogo = logoU;
    sh.uniforms.uFill = fillU;
    sh.uniforms.uFlex = flexU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBindPos;\nuniform float uFlex;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vBindPos = position;
        if (uFlex != 0.0 && position.z < ${flexLimitZ.toFixed(2)}) {
          float s = max(abs(position.x) - ${ys.toFixed(2)}, 0.0) / ${(tipY - ys).toFixed(2)};
          transformed.y += uFlex * s * s;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBindPos;\nuniform float uLogo, uFill;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * uFill;
        if (uLogo > 0.001) {
          float fin = (1.0 - smoothstep(0.9, 1.3, abs(vBindPos.x))) * smoothstep(0.02, 0.3, vBindPos.y - (${topA.toFixed(3)} + (vBindPos.z - ${(-xa).toFixed(3)}) * ${topSlope.toFixed(4)}));
          float fall = exp(-max(vBindPos.y - ${finY0.toFixed(2)}, 0.0) / 4.6);
          totalEmissiveRadiance += uLogo * fin * fall * (diffuseColor.rgb + 0.04) * vec3(1.0, 0.95, 0.86) * 2.2;
        }`);
  };

  // Light glows. Positions in the model frame.
  const M = (v) => toModel(v.x, v.y, v.z).toArray();
  const Md = (x, y, z) => toModel(x, y, z).normalize().toArray();
  const landP = [1, -1].map((side) => foilPoint(wingSec(lightY, side), lightF, -1).add(V(0, 0, -0.1)));
  const landDirBody = [Math.cos(8 * DEG), 0, -Math.sin(8 * DEG)];
  const taxiP = nPivot.clone().lerp(nAxle, 0.45).add(V(0.28, 0, 0));
  const taxiDirBody = [Math.cos(9 * DEG), 0, -Math.sin(9 * DEG)];
  const tipL = wingSec(tipY - 0.25, 1), tipR = wingSec(tipY - 0.25, -1);
  const LAMPS = [
    { key: 'navL', pos: M(tipL.le.clone().add(V(-0.1, 0.1, 0))), color: C.red, size: 3.0, px: [2.5, 9] },
    { key: 'navR', pos: M(tipR.le.clone().add(V(-0.1, -0.1, 0))), color: C.green, size: 3.0, px: [2.5, 9] },
    { key: 'tail', pos: M(V(tailEnd - 0.15, 0, tailZ)), color: '#ffffff', size: 2.4, px: [2, 7] },
    { key: 'beaconTop', pos: M(V(BCN_T, 0, fuseTop(BCN_T) + 0.14)), color: C.red, size: 5.5, px: [4, 14] },
    { key: 'beaconBottom', pos: M(V(BCN_B, 0, fuseBot(BCN_B) - 0.12)), color: C.red, size: 5.5, px: [4, 14] },
    { key: 'strobe', pos: M(tipL.le.clone().add(V(-0.3, 0.15, 0))), color: '#ffffff', size: 10.0, px: [8, 26] },
    { key: 'strobe', pos: M(tipR.le.clone().add(V(-0.3, -0.15, 0))), color: '#ffffff', size: 10.0, px: [8, 26] },
    { key: 'strobe', pos: M(V(tailEnd - 0.2, 0, tailZ - 0.1)), color: '#ffffff', size: 8.0, px: [6, 20] },
    ...landP.map((p) => ({ key: 'landing', pos: M(p), color: '#fff4e0', size: 8.0, px: [4, 22], dir: Md(...landDirBody) })),
    { key: 'taxi', pos: M(taxiP), color: '#fff4e0', size: 5.0, px: [3, 16], dir: Md(...taxiDirBody) },
  ];
  const glows = createLampGlows(LAMPS);
  const levels = new Array(LAMPS.length).fill(0);
  let lights = { nav: 1, beacon: 1, strobe: 1, landing: 0, taxi: 0, logo: 0 };
  let night = 0, gearNow = 1;
  const landMid = toModel((landP[0].x + landP[1].x) / 2, 0, (landP[0].z + landP[1].z) / 2).toArray();
  const pose = { land: { pos: landMid, dir: Md(...landDirBody) }, taxi: { pos: M(taxiP), dir: Md(...taxiDirBody) } };

  const object = new THREE.Group();
  object.name = 'aircraft';
  object.add(mesh, glows.object);

  // --- Animation (no allocation per frame) ---
  const tmp = new THREE.Vector3();
  const rot = (name, angle) => { const bn = B[name]; bn.quaternion.setFromAxisAngle(bn.userData.axis, angle); };
  const move = (name, dx, dy, dz) => { const bn = B[name]; bn.position.copy(bn.userData.rest).add(toModel(dx, dy, dz, tmp)); };
  const slide = (name, d) => { const bn = B[name]; bn.position.copy(bn.userData.rest).addScaledVector(bn.userData.axis, d); };
  let fanL = 0, fanR = 0, wheelMain = 0, wheelNose = 0, clock = 0, cockpitView = false;
  const TILT = spec.gear.tiltDeg * DEG, SPOILERS = WS.spoilers;
  const SP_NAMES = { L: SPOILERS.map((_, i) => `spoiler${i + 1}L`), R: SPOILERS.map((_, i) => `spoiler${i + 1}R`) };
  // How far the bogie hangs: fully when the strut's unloaded, flat once it takes weight.
  const tiltOf = (comp) => TILT * (1 - clamp(comp / 0.09, 0, 1));
  const EMPTY = {};
  const WHEEL_NAMES = [];
  for (let i = 0; i < NAXLES; i++) WHEEL_NAMES.push('mainWheelL' + i, 'mainWheelR' + i);
  const EMPTY_LIST = [];
  const FT = WS.flapTravel, REV_T = spec.engine.revTravel;
  const FLAP_OUT_DEG = WS.flapOutDeg ?? 20, FLPRN = WS.flaperonDroop ?? [0.8, 30], AFT_F = WS.flapInAft;
  const steerMax = (spec.data?.STEER_TILLER ?? 70 * DEG);

  function update(state = EMPTY, dt = 0) {
    clock += dt;
    const s = state.surfaces || EMPTY;
    rot('stab', SIGNS.stab * (s.stab || 0));
    rot('elevL', SIGNS.elevator * (s.elevator || 0));
    rot('elevR', SIGNS.elevator * (s.elevator || 0));
    rot('rudder', SIGNS.rudder * (s.rudder || 0));
    const fd = state.flapDeg || 0, tr = clamp(fd / FLAP_OUT_DEG, 0, 1);
    for (let k = 0; k < 2; k++) {
      const S = k ? 'R' : 'L';
      const arr = (k ? s.spoilersR : s.spoilersL) || EMPTY_LIST;
      const ail = (k ? s.aileronR : s.aileronL) || 0;
      for (let i = 0; i < SPOILERS.length; i++) rot(SP_NAMES[S][i], clamp(arr[SPOILERS[i][2]] || 0, 0, 1) * 50 * DEG);
      rot(k ? 'aileronR' : 'aileronL', SIGNS.aileron * ail);
      // The flaperon: an aileron at all speeds, and it droops with the flaps.
      rot(k ? 'flaperonR' : 'flaperonL', SIGNS.aileron * ail * 0.8 - Math.min(fd * FLPRN[0], FLPRN[1]) * DEG);
      // The slats droop about their hinge line, sealed against the fixed nose (v0.4.1: no travel).
      rot(k ? 'slatsR' : 'slatsL', (state.slatDeg || 0) * DEG * 0.85);
      const fi = k ? 'flapInR' : 'flapInL', fo = k ? 'flapOutR' : 'flapOutL';
      rot(fi, -fd * DEG);
      move(fi, -FT.in * tr, 0, -0.18 * tr);
      if (WS.flapInAftF) {
        // The aft flap: past the small settings it opens on top of the main flap, with its own slot.
        const fa = k ? 'flapInAftR' : 'flapInAftL', open = clamp((fd - AFT_F.fromDeg) / (AFT_F.toDeg - AFT_F.fromDeg), 0, 1);
        rot(fa, -open * AFT_F.deg * DEG);
        move(fa, -AFT_F.slide * open, 0, -0.03 * open);
      }
      rot(fo, -fd * DEG);
      move(fo, -FT.out * tr, 0, -0.14 * tr);
      for (let i = 0; i < WS.canoes.length; i++) rot('canoe' + i + S, -fd * DEG * 0.55);
    }

    // Gear.
    const gp = clamp(state.gearPos ?? 1, 0, 1), up = 1 - gp;
    rot('mainLegL', -up * 88 * DEG);
    rot('mainLegR', up * 88 * DEG);
    rot('noseLeg', -up * 104 * DEG);
    rot('noseBrace', up * nBraceAngle);
    const stay = up * Math.atan2(GS.stayDY ?? STAY_DY, GS.stayDZ ?? STAY_DZ);
    rot('stayL', -stay);
    rot('stayR', stay);
    const gc = state.gearCompression || EMPTY;
    const cl = gc.left ?? staticComp.main, cr = gc.right ?? staticComp.main;
    // The rear axle stays where the sim's contact point is: tilting about the beam's centre would
    // push it below that, so the piston rises by what the tilt adds.
    const AX2 = BG.axleSpacingAft ?? (BG.axleSpacing * (NAXLES - 1)) / 2, tl = tiltOf(cl), trr = tiltOf(cr);
    slide('mainPistonL', cl - staticComp.main + AX2 * Math.sin(tl));
    slide('mainPistonR', cr - staticComp.main + AX2 * Math.sin(trr));
    rot('bogieL', -tl);
    rot('bogieR', -trr);
    slide('nosePiston', (gc.nose ?? staticComp.nose) - staticComp.nose);
    const steer = state.steerAngle || 0;
    rot('noseSteer', -SIGNS.steer * steer);
    if (AFT_STEER) {
      // The aft axle turns the other way from the nosewheel (it lies aft of the turn's centre) and only
      // once the nosewheel is turned hard: Boeing's numbers are in the spec.
      const a = (Math.sign(steer) * SIGNS.steer * AFT_STEER.maxDeg * DEG) * clamp((Math.abs(steer) - AFT_STEER.fromDeg * DEG) / (steerMax - AFT_STEER.fromDeg * DEG), 0, 1);
      rot('aftAxleL', a); rot('aftAxleR', a);
    }
    const wr = state.wheelRate || EMPTY;
    wheelMain += (wr.main || 0) * dt; wheelNose += (wr.nose || 0) * dt;
    for (let i = 0; i < WHEEL_NAMES.length; i++) rot(WHEEL_NAMES[i], wheelMain);
    rot('noseWheel', wheelNose);
    const doors = clamp(state.gearDoors ?? (gp > 0.99 ? 0 : 1), 0, 1) * 80 * DEG;
    rot('noseDoorL', doors); rot('noseDoorR', -doors);
    rot('mainDoorL', -doors); rot('mainDoorR', doors);

    // Engines.
    const en = state.engines || EMPTY_LIST;
    fanL = (fanL + ((en[0]?.n1 || 0) / 100) * 6.5 * Math.PI * 2 * dt) % (Math.PI * 2);
    fanR = (fanR + ((en[1]?.n1 || 0) / 100) * 6.5 * Math.PI * 2 * dt) % (Math.PI * 2);
    rot('fanL', fanL); rot('fanR', fanR);
    move('revL', -REV_T * clamp(en[0]?.rev || 0, 0, 1), 0, 0);
    move('revR', -REV_T * clamp(en[1]?.rev || 0, 0, 1), 0, 0);

    // Lights, as aircraft.js.
    gearNow = gp;
    const f = flashAt(clock), L = lights, gearLamp = gp > 0.97 ? 1 : 0, seen = cockpitView ? 0 : 1;
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
  function setNight(n) {
    night = clamp(n || 0, 0, 1);
    glows.setNight(night);
    fillU.value = 0.035 * night;
    logoU.value = lights.logo * night;
  }
  function lampPose() {
    const p = lights.landing > 0 || !(lights.taxi > 0 && gearNow > 0.97) ? pose.land : pose.taxi;
    return { pos: p.pos.slice(), dir: p.dir.slice() };
  }
  function setCockpitView(on) {
    if (on === cockpitView) return;
    cockpitView = on;
    B.nose.scale.setScalar(on ? 1e-4 : 1);
  }
  // The wing's vertex bend, and the tip lamps with it (they're not in the skinned mesh). Rewrites a few
  // floats, only when the bend has moved by a centimetre.
  const lampY = LAMPS.map((L) => L.pos[1]);
  const lampAttr = glows.object.geometry.getAttribute('position');
  function setWingFlex(m) {
    m = m || 0;
    const moved = Math.abs(m - flexU.value) > 0.01;
    if (!moved && (m !== 0 || flexU.value === 0)) return;
    flexU.value = m;
    LAMPS.forEach((L, i) => {
      if (L.pos[2] >= flexLimitZ || Math.abs(L.pos[0]) <= ys) return;
      const k = (Math.abs(L.pos[0]) - ys) / (tipY - ys);
      lampAttr.setY(i, lampY[i] + m * k * k);
    });
    lampAttr.needsUpdate = true;
  }

  update({}, 0);
  return {
    object, update, setCockpitView, setLights, setNight, lampPose, setWingFlex, mesh, bones: B,
    triangles: geometry.index.count / 3, shape, windows,
  };
}
