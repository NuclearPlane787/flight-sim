// The landmarks' models (briefs/V0-6-0.md Part 6 step 3): massing made here from public facts (the height,
// the floors, the plan, the taper and the crown), no logos, signage or names, nothing copied.
// Pure geometry: each builder returns { geometry (a non-indexed THREE.BufferGeometry), lights }
// in the landmark's own frame: x east (grid), y up from the base (0 at the ground), z = -north,
// the base's centre at the origin. landmarks.js places it.
//
// The attributes, read by landmarks.js's shader:
//   position, normal
//   aCol  vec3  the albedo (linear)
//   aFac  vec4  the facade: floor height (m, 0: no window pattern), bay width (m), glass (0..1:
//               the share of a window that reflects the sky), the share of windows lit at night
//   aExt  vec4  u (m along the facade, for the bays), a seed, shell (1: a far stand-in for a
//               lattice, not drawn within about 3 km), specular (0..1, metal or paint)
//   aGlow vec3  the facade's own light at night (emitted, times uNight)
// lights: [x, y, z, kind] per aviation obstruction light: kind 0 steady red, 1 flashing red.

import * as THREE from '../../vendor/three.module.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ the builder

const DEFAULT = { col: [0.4, 0.4, 0.4], fac: [0, 0, 0, 0], seed: 0, shell: 0, spec: 0, glow: [0, 0, 0] };

export class Builder {
  constructor(seed = 0.37) {
    this.P = []; this.N = []; this.C = []; this.F = []; this.E = []; this.G = [];
    this.lights = [];
    this.seed = seed;
    this.m = { ...DEFAULT, seed };
    this.ox = 0; this.on = 0; this.cb = 1; this.sb = 0;
    this.flip = false;       // true: faces turn towards `inside` (a hole's wall)
  }
  // The material for what follows.
  set(m) { this.m = { ...DEFAULT, seed: this.seed, ...m }; return this; }
  // The frame for what follows: points are given as [x, y, n] (east, up, north) in a part's own
  // plan, turned to grid bearing `brgDeg` (the part's local north) and moved by (ox, on) metres.
  frame(ox = 0, on = 0, brgDeg = 0) { this.ox = ox; this.on = on; this.cb = Math.cos(brgDeg * DEG); this.sb = Math.sin(brgDeg * DEG); return this; }
  // Local [x, y, n] -> scene [X, y, Z].
  T(p) {
    const X = p[0] * this.cb + p[2] * this.sb + this.ox;
    const Nn = -p[0] * this.sb + p[2] * this.cb + this.on;
    return [X, p[1], -Nn];
  }
  light(p, kind = 0) { const q = this.T(p); this.lights.push([q[0], q[1], q[2], kind]); }

  // One triangle in scene coordinates; `inside` a scene point inside the solid (the face is turned
  // to face away from it); na..nc optional smooth normals (turned the same way); u per vertex.
  tri(a, b, c, inside, na = null, nb = null, nc = null, ua = 0, ub = 0, uc = 0) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (!(len > 1e-9)) return;
    n = [n[0] / len, n[1] / len, n[2] / len];
    const cx = (a[0] + b[0] + c[0]) / 3 - inside[0], cy = (a[1] + b[1] + c[1]) / 3 - inside[1], cz = (a[2] + b[2] + c[2]) / 3 - inside[2];
    if ((n[0] * cx + n[1] * cy + n[2] * cz < 0) !== this.flip) {
      [b, c] = [c, b]; [nb, nc] = [nc, nb]; [ub, uc] = [uc, ub];
      n = [-n[0], -n[1], -n[2]];
    }
    const fix = (v) => {
      if (!v) return n;
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      const w = [v[0] / l, v[1] / l, v[2] / l];
      return w[0] * n[0] + w[1] * n[1] + w[2] * n[2] < 0 ? [-w[0], -w[1], -w[2]] : w;
    };
    this._v(a, fix(na), ua); this._v(b, fix(nb), ub); this._v(c, fix(nc), uc);
  }
  _v(p, n, u) {
    const m = this.m;
    this.P.push(p[0], p[1], p[2]); this.N.push(n[0], n[1], n[2]);
    this.C.push(m.col[0], m.col[1], m.col[2]);
    this.F.push(m.fac[0], m.fac[1], m.fac[2], m.fac[3]);
    this.E.push(u, m.seed, m.shell, m.spec);
    this.G.push(m.glow[0], m.glow[1], m.glow[2]);
  }

  // A loft through sections of local points [x, y, n] (each section a closed ring, all the same
  // count). opts: smooth (normals across the ring), capTop, capBottom, inside (per section, local
  // points; default each ring's mean).
  loft(sections, { smooth = false, capTop = true, capBottom = false } = {}) {
    const S = sections.map((s) => s.map((p) => this.T(p)));
    const ns = S.length, nr = S[0].length;
    const mean = (r) => { const c = [0, 0, 0]; for (const p of r) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; } return [c[0] / r.length, c[1] / r.length, c[2] / r.length]; };
    const cen = S.map(mean);
    // u: arc length round each ring
    const U = S.map((r) => { const u = [0]; for (let i = 1; i <= nr; i++) u.push(u[i - 1] + Math.hypot(r[i % nr][0] - r[i - 1][0], r[i % nr][2] - r[i - 1][2])); return u; });
    let NS = null;
    if (smooth) {
      NS = S.map((r, j) => r.map((p, i) => {
        const a = r[(i + 1) % nr], b = r[(i - 1 + nr) % nr];
        const t1 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
        const up = S[Math.min(j + 1, ns - 1)][i], dn = S[Math.max(j - 1, 0)][i];
        let t2 = [up[0] - dn[0], up[1] - dn[1], up[2] - dn[2]];
        if (Math.hypot(...t2) < 1e-9) t2 = [0, 1, 0];
        const n = [t1[1] * t2[2] - t1[2] * t2[1], t1[2] * t2[0] - t1[0] * t2[2], t1[0] * t2[1] - t1[1] * t2[0]];
        const c = cen[j], o = [p[0] - c[0], 0, p[2] - c[2]];
        return n[0] * o[0] + n[2] * o[2] < 0 ? [-n[0], -n[1], -n[2]] : n;
      }));
    }
    // Each wall faces out by the ring's winding (in the scene's x-z plane), so thin or crescent
    // rings face the right way too: the inside point is just behind the edge.
    const area = (r) => { let A = 0; for (let i = 0; i < nr; i++) { const p = r[i], q = r[(i + 1) % nr]; A += p[0] * q[2] - q[0] * p[2]; } return A; };
    for (let j = 0; j + 1 < ns; j++) {
      const sg = Math.sign(area(S[j]) + area(S[j + 1])) || 1;
      for (let i = 0; i < nr; i++) {
        const i1 = (i + 1) % nr;
        const a = S[j][i], b = S[j][i1], c = S[j + 1][i1], d = S[j + 1][i];
        let ex = b[0] - a[0], ez = b[2] - a[2];
        if (Math.hypot(ex, ez) < 1e-6) { ex = c[0] - d[0]; ez = c[2] - d[2]; }
        const l = Math.hypot(ex, ez) || 1, ox = (sg * ez) / l, oz = (-sg * ex) / l;
        const inside = [(a[0] + b[0] + c[0] + d[0]) / 4 - ox, (a[1] + b[1] + c[1] + d[1]) / 4, (a[2] + b[2] + c[2] + d[2]) / 4 - oz];
        const ua = U[j][i], ub = U[j][i + 1], uc = U[j + 1][i + 1], ud = U[j + 1][i];
        if (NS) {
          this.tri(a, b, c, inside, NS[j][i], NS[j][i1], NS[j + 1][i1], ua, ub, uc);
          this.tri(a, c, d, inside, NS[j][i], NS[j + 1][i1], NS[j + 1][i], ua, uc, ud);
        } else {
          this.tri(a, b, c, inside, null, null, null, ua, ub, uc);
          this.tri(a, c, d, inside, null, null, null, ua, uc, ud);
        }
      }
    }
    const cap = (r, c, up) => {
      const inside = [c[0], c[1] - (up ? 1 : -1), c[2]];
      const nn = [0, up ? 1 : -1, 0];
      for (let i = 0; i < nr; i++) this.tri(c, r[i], r[(i + 1) % nr], inside, nn, nn, nn);
    };
    if (capTop) cap(S[ns - 1], cen[ns - 1], true);
    if (capBottom) cap(S[0], cen[0], false);
  }

  // A member (a beam) between local points a and b, `r` its half-width, a prism of `sides`.
  member(a, b, r, sides = 4, rot = 0) {
    const A = this.T(a), B = this.T(b);
    const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const L = Math.hypot(...d);
    if (!(L > 1e-6)) return;
    const k = [d[0] / L, d[1] / L, d[2] / L];
    const up = Math.abs(k[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let e1 = [k[1] * up[2] - k[2] * up[1], k[2] * up[0] - k[0] * up[2], k[0] * up[1] - k[1] * up[0]];
    const l1 = Math.hypot(...e1); e1 = e1.map((v) => v / l1);
    const e2 = [k[1] * e1[2] - k[2] * e1[1], k[2] * e1[0] - k[0] * e1[2], k[0] * e1[1] - k[1] * e1[0]];
    const ring = (P) => {
      const out = [];
      for (let s = 0; s < sides; s++) {
        const t = rot + (s + 0.5) * TAU / sides;
        const c = Math.cos(t) * r, sn = Math.sin(t) * r;
        out.push([P[0] + e1[0] * c + e2[0] * sn, P[1] + e1[1] * c + e2[1] * sn, P[2] + e1[2] * c + e2[2] * sn]);
      }
      return out;
    };
    const ra = ring(A), rb = ring(B);
    const inside = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
    for (let s = 0; s < sides; s++) {
      const s1 = (s + 1) % sides;
      // inside: the axis point nearest the face (the mid-point works for a straight prism)
      this.tri(ra[s], ra[s1], rb[s1], inside, null, null, null, 0, r, r);
      this.tri(ra[s], rb[s1], rb[s], inside, null, null, null, 0, r, 0);
    }
  }

  // A sphere (local centre), smooth.
  sphere(c, r, nu = 16, nv = 10) {
    const C = this.T(c);
    const pt = (i, j) => {
      const th = (i / nu) * TAU, ph = (j / nv) * Math.PI;
      return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
    };
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const q = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
      const P = q.map((v) => [C[0] + v[0] * r, C[1] + v[1] * r, C[2] + v[2] * r]);
      const u = q.map((v, k) => ((i + (k === 1 || k === 2 ? 1 : 0)) / nu) * TAU * r);
      if (j > 0) this.tri(P[0], P[1], P[2], C, q[0], q[1], q[2], u[0], u[1], u[2]);
      if (j < nv - 1) this.tri(P[0], P[2], P[3], C, q[0], q[2], q[3], u[0], u[2], u[3]);
    }
  }

  geometry() {
    // nothing below the base (a member's prism round its foot): the base is y = 0
    for (let i = 1; i < this.P.length; i += 3) if (this.P[i] < 0) this.P[i] = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aFac', new THREE.Float32BufferAttribute(this.F, 4));
    g.setAttribute('aExt', new THREE.Float32BufferAttribute(this.E, 4));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.G, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
  result() { return { geometry: this.geometry(), lights: this.lights }; }
}

// ------------------------------------------------------------------ plans (rings of [x, n])

export const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = (t) => t * t * (3 - 2 * t);
// A ring of [x, n] -> a section [x, y, n].
const at = (ring, y) => ring.map(([x, n]) => [x, y, n]);
const scaleRing = (ring, s) => ring.map(([x, n]) => [x * s, n * s]);
const rotRing = (ring, a) => { const c = Math.cos(a), s = Math.sin(a); return ring.map(([x, n]) => [x * c - n * s, x * s + n * c]); };
const shift = (ring, dx, dn) => ring.map(([x, n]) => [x + dx, n + dn]);

// A rounded rectangle (half-sizes hx, hn, corner radius r), `seg` points per corner.
export function roundedRect(hx, hn, r, seg = 4) {
  r = Math.min(r, hx, hn);
  const out = [];
  const cs = [[hx - r, hn - r, 0], [-(hx - r), hn - r, 90], [-(hx - r), -(hn - r), 180], [hx - r, -(hn - r), 270]];
  for (const [cx, cn, a0] of cs) {
    for (let k = 0; k <= seg; k++) {
      const a = (a0 + (90 * k) / seg) * DEG;
      out.push([cx + r * Math.cos(a), cn + r * Math.sin(a)]);
    }
  }
  return out;
}
// A chamfered rectangle (corners cut by c).
export function chamferRect(hx, hn, c) {
  return [[hx, -hn + c], [hx, hn - c], [hx - c, hn], [-hx + c, hn], [-hx, hn - c], [-hx, -hn + c], [-hx + c, -hn], [hx - c, -hn]];
}
// A superellipse |x/a|^p + |n/b|^p = 1, k points.
export function superellipse(a, b, p, k = 32, phase = 0) {
  const out = [];
  for (let i = 0; i < k; i++) {
    const t = phase + (i / k) * TAU, c = Math.cos(t), s = Math.sin(t);
    out.push([a * Math.sign(c) * Math.abs(c) ** (2 / p), b * Math.sign(s) * Math.abs(s) ** (2 / p)]);
  }
  return out;
}
export const circle = (r, k = 16, phase = 0) => superellipse(r, r, 2, k, phase);
// A polygon resampled to k points evenly along its perimeter (starting at its first vertex).
export function resample(poly, k) {
  const L = [0];
  for (let i = 1; i <= poly.length; i++) L.push(L[i - 1] + Math.hypot(poly[i % poly.length][0] - poly[i - 1][0], poly[i % poly.length][1] - poly[i - 1][1]));
  const tot = L[L.length - 1], out = [];
  let s = 0;
  for (let i = 0; i < k; i++) {
    const d = (i / k) * tot;
    while (L[s + 1] < d) s++;
    const t = (d - L[s]) / (L[s + 1] - L[s] || 1);
    const a = poly[s], b = poly[(s + 1) % poly.length];
    out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
  }
  return out;
}
// A box: local centre (x, n), y0..y1, half-sizes, turned by rotDeg within the part's frame.
function box(b, x, n, y0, y1, hx, hn, rotDeg = 0, opts = {}) {
  const r4 = shift(rotRing([[hx, -hn], [hx, hn], [-hx, hn], [-hx, -hn]], rotDeg * DEG), x, n);
  b.loft([at(r4, y0), at(r4, y1)], { capTop: opts.capTop !== false, capBottom: !!opts.capBottom });
}
function cyl(b, x, n, y0, y1, r0, r1, k = 12, opts = {}) {
  b.loft([at(shift(circle(r0, k), x, n), y0), at(shift(circle(r1, k), x, n), y1)], { smooth: true, capTop: opts.capTop !== false, capBottom: !!opts.capBottom });
}
// A tapering mast of stacked cylinders, painted in bands (cols alternate) if given.
function mast(b, y0, y1, r0, r1, bands = 1, cols = null, k = 8) {
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands, t1 = (i + 1) / bands;
    if (cols) b.set({ ...cols[i % cols.length] });
    cyl(b, 0, 0, lerp(y0, y1, t0), lerp(y0, y1, t1), lerp(r0, r1, t0), lerp(r0, r1, t1), k);
  }
}

// ------------------------------------------------------------------ materials

const GLASS = (col, floorH, bay, glass = 0.85, lit = 0.2, extra = {}) => ({ col, fac: [floorH, bay, glass, lit], ...extra });
const PLAIN = (col, spec = 0.15, extra = {}) => ({ col, fac: [0, 0, 0, 0], spec, ...extra });
const CONCRETE = [0.42, 0.41, 0.38];
const WHITE = [0.62, 0.62, 0.60];
const RED_PAINT = [0.62, 0.05, 0.03];

// Aviation lights round a ring of local [x, n] points at height y (every `step`-th point).
function ringLights(b, ring, y, kind = 0, step = 1) { ring.forEach(([x, n], i) => { if (i % step === 0) b.light([x, y, n], kind); }); }

// ------------------------------------------------------------------ Seoul

// Lotte World Tower: 554.5 m, 123 floors. A square plan with very rounded corners and a seam down
// the middle of each face, tapering on a gently convex curve from about 72 m to about 23 m; the
// four corners split apart at the top into a lantern-like crown, the seams opening.
export function lotte(brg = 68) {
  const b = new Builder(0.21).frame(0, 0, brg);
  const H = 554.5, ROOF = 486;
  const w = (y) => 36 * (1 - 0.68 * (y / H) ** 1.5);
  const NOTCH = 1.6, NW = 1.8;
  // the plan: a rounded square, a shallow V seam at each face's centre (x = w side etc.)
  const plan = (hw) => {
    const r = hw * 0.42, out = [];
    for (let q = 0; q < 4; q++) {
      const a0 = q * 90;
      // the seam at the face at angle a0 (its centre), then the corner after it
      const c = Math.cos(a0 * DEG), s = Math.sin(a0 * DEG), tx = -s, tn = c;   // face normal (c, s), tangent (tx, tn)
      out.push([c * hw - tx * NW, s * hw - tn * NW]);
      out.push([c * (hw - NOTCH), s * (hw - NOTCH)]);
      out.push([c * hw + tx * NW, s * hw + tn * NW]);
      const cx = (c - s) * (hw - r), cn = (s + c) * (hw - r);   // the corner circle's centre (a0 + 45°)
      for (let k = 0; k <= 4; k++) {
        const a = (a0 + (90 * k) / 4) * DEG;
        out.push([cx + r * Math.cos(a), cn + r * Math.sin(a)]);
      }
    }
    return out;
  };
  b.set(GLASS([0.30, 0.335, 0.37], 3.95, 3.0, 0.85, 0.26));
  const secs = [];
  for (let k = 0; k <= 22; k++) { const y = (ROOF * k) / 22; secs.push(at(plan(w(y)), y)); }
  b.loft(secs, { smooth: true, capTop: false });
  // the crown: four corner petals, the gaps between them widening from the seam to about 9 m
  b.set(GLASS([0.34, 0.37, 0.40], 4.0, 2.0, 0.7, 0, { glow: [0.20, 0.22, 0.27] }));
  for (let q = 0; q < 4; q++) {
    const secsP = [];
    for (let k = 0; k <= 7; k++) {
      const y = lerp(ROOF, H - 2, k / 7), hw = w(y), gap = lerp(NW, 4.5, (k / 7) ** 1.3), th = lerp(3.5, 1.6, k / 7);
      const r = hw * 0.42, ring = [];
      const a0 = q * 90 * DEG;
      // the petal: the outer arc from this face's seam to the next one, then back inside
      const pts = [];
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a0 + Math.PI / 2), s1 = Math.sin(a0 + Math.PI / 2);
      pts.push([c0 * hw - s0 * gap, s0 * hw + c0 * gap]);
      const cx = (c0 - s0) * (hw - r), cn = (s0 + c0) * (hw - r);
      for (let m = 0; m <= 4; m++) { const a = a0 + (m / 4) * Math.PI / 2; pts.push([cx + r * Math.cos(a), cn + r * Math.sin(a)]); }
      pts.push([c1 * hw + s1 * gap, s1 * hw - c1 * gap]);
      const inner = pts.slice().reverse().map(([x, n]) => { const l = Math.hypot(x, n); return [x * (l - th) / l, n * (l - th) / l]; });
      ring.push(...pts, ...inner);
      secsP.push(at(ring, y));
    }
    b.loft(secsP, { capTop: true });
  }
  // the lantern inside the crown, and the very top
  b.set(GLASS([0.40, 0.42, 0.44], 4.0, 2.0, 0.6, 0, { glow: [0.55, 0.57, 0.62] }));
  cyl(b, 0, 0, ROOF, 530, w(ROOF) - 5, 8, 12);
  b.set(PLAIN([0.5, 0.5, 0.5], 0.4));
  cyl(b, 0, 0, 530, H, 3, 0.4, 8);
  // lights: the top (flashing), the roof's corners, and three levels down the shaft
  b.light([0, H, 0], 1);
  for (const y of [ROOF, 380, 270, 160]) ringLights(b, scaleRing(plan(w(y)), 1.002).filter((_, i) => i % 8 === 1), y, 0);
  return b.result();
}

// The 63 Building: 249.6 m, 60 floors above ground, gold reflective glass. A slab about 60 m
// long whose broad faces lean in on a concave curve, about 43 m deep at the base, 22 m at the top.
export function b63(brg = 52) {
  const b = new Builder(0.43).frame(0, 0, brg);
  const H = 249.6;
  const depth = (y) => 11 + 10.5 * (1 - y / H) ** 1.8;
  // local: x across the slab (the leaning faces), n along it (60 m)
  const ring = (hd) => [[hd, -27], [hd, 27], [hd - 3, 30], [-(hd - 3), 30], [-hd, 27], [-hd, -27], [-(hd - 3), -30], [hd - 3, -30]];
  b.set(GLASS([0.30, 0.18, 0.045], 3.95, 2.4, 0.7, 0.22, { spec: 0.8 }));
  const secs = [];
  for (let k = 0; k <= 12; k++) { const y = (H - 6) * k / 12; secs.push(at(ring(depth(y)), y)); }
  b.loft(secs);
  // the roof's plant floor and parapet
  b.set(GLASS([0.40, 0.28, 0.08], 3.0, 2.0, 0.6, 0, { spec: 0.5 }));
  b.loft([at(ring(depth(H - 6) - 1.5).map(([x, n]) => [x, n * 0.85]), H - 6), at(ring(depth(H) - 2).map(([x, n]) => [x, n * 0.8]), H)]);
  b.light([0, H, 0], 1);
  for (const y of [H - 6, 170, 90]) for (const [x, n] of [[depth(y), 27], [depth(y), -27], [-depth(y), 27], [-depth(y), -27]]) b.light([x, y, n], 0);
  return b.result();
}

// N Seoul Tower: 236.7 m of tower on Namsan's summit. A slender concrete shaft, the pod of its
// observation decks at about 88-115 m, a short shaft above it and the antenna mast in red and white.
export function nseoul() {
  const b = new Builder(0.55);
  const H = 236.7;
  b.set(PLAIN([0.40, 0.40, 0.39], 0.1, { glow: [0.07, 0.09, 0.42] }));
  // the shaft, flared a little at the foot
  b.loft([0, 6, 30, 60, 88].map((y) => at(circle(y < 6 ? 9 : lerp(7.2, 5.6, y / 88), 14), y)), { smooth: true, capTop: false });
  // the pod: a cone under it, the decks' drum, the roof cone
  b.set(GLASS([0.30, 0.32, 0.34], 3.6, 1.8, 0.6, 0.45));
  b.loft([[88, 5.6], [93, 11.5], [96, 13.5], [104, 13.5], [107, 12.5], [111, 12.8], [115, 9.5], [117, 5]].map(([y, r]) => at(circle(r, 20), y)), { smooth: true });
  // above it, the antenna's concrete foot and the mast in bands
  b.set(PLAIN([0.42, 0.42, 0.41], 0.1, { glow: [0.06, 0.08, 0.36] }));
  cyl(b, 0, 0, 117, 140, 4.5, 3.6, 12);
  const red = PLAIN([0.60, 0.07, 0.04], 0.2), white = PLAIN(WHITE, 0.2);
  mast(b, 140, H, 2.6, 0.35, 9, [red, white], 8);
  // the plaza building at its foot
  b.set(GLASS([0.38, 0.37, 0.35], 4.2, 3.0, 0.3, 0.4));
  box(b, -14, -6, 0, 13, 13, 11);
  b.light([0, H, 0], 1);
  for (const y of [200, 160]) ringLights(b, circle(2.6 * (1 - (y - 140) / 100) + 0.6, 3), y, 0);
  ringLights(b, circle(9.6, 4), 115.2, 0);
  return b.result();
}

// Parc1: two office towers in Yeouido, 333 m (Tower 1, its roof about 318 m) and about 256 m,
// square towers with their corners cut back, red columns in the corners rising past the roofs.
// t2: Tower 2's offset (map metres east, north) from Tower 1.
export function parc1(brg = 142, t2 = [56, 43]) {
  const b = new Builder(0.62);
  const tower = (ox, on, roof, top) => {
    b.frame(ox, on, brg);
    const hx = 29.5, hn = 25.5, c = 4.5;
    b.set(GLASS([0.10, 0.13, 0.16], 4.3, 3.0, 0.9, 0.3));
    b.loft([at(chamferRect(hx, hn, c), 0), at(chamferRect(hx, hn, c), roof)]);
    // the red corner columns, joined in pairs across the short faces above the roof
    b.set(PLAIN(RED_PAINT, 0.3, { glow: [0.35, 0.03, 0.02] }));
    const cols = [[hx - c * 0.45, hn - c * 0.45], [-hx + c * 0.45, hn - c * 0.45], [-hx + c * 0.45, -hn + c * 0.45], [hx - c * 0.45, -hn + c * 0.45]];
    for (const [x, n] of cols) b.loft([at(shift(rotRing([[2, -2], [2, 2], [-2, 2], [-2, -2]], 45 * DEG), x, n), 0), at(shift(rotRing([[2, -2], [2, 2], [-2, 2], [-2, -2]], 45 * DEG), x, n), top)]);
    for (const s of [1, -1]) b.member([hx - c * 0.45, top - 2, s * (hn - c * 0.45)], [-hx + c * 0.45, top - 2, s * (hn - c * 0.45)], 1.6, 4);
    b.light([cols[0][0], top, cols[0][1]], 1); b.light([cols[2][0], top, cols[2][1]], 1);
    for (const y of [roof, roof * 0.66, roof * 0.33]) for (const [x, n] of cols) b.light([x, y, n], 0);
  };
  tower(0, 0, 318, 333);
  tower(t2[0], t2[1], 244, 256);
  return b.result();
}

// ------------------------------------------------------------------ Shanghai

// Shanghai Tower: 632 m, 128 floors, the roof at 587 m. A rounded-triangle plan about 86 m across
// at the base, tapering to about 49 m and twisting about 120° on the way up, with a notch running
// up one corner; the outer skin rises past the roof as a sloping crown. Refuge-floor bands every
// zone (nine zones).
export function shtower(brg = 0) {
  const b = new Builder(0.71).frame(0, 0, brg);
  const H = 632, ROOF = 587.4, TWIST = 120 * DEG;
  const W = (y) => 43 - 18.5 * Math.min(y / ROOF, 1) ** 1.1;
  const K = 54;
  const plan = (y, out = 0) => {
    const R = W(y) + out, tw = TWIST * Math.min(y / H, 1), ring = [];
    for (let i = 0; i < K; i++) {
      const t = (i / K) * TAU;
      let r = R * (1 + 0.13 * Math.cos(3 * t)) / 1.13;
      const dt = Math.abs(((t + Math.PI) % TAU) - Math.PI);           // angle from the notch's corner (t = 0)
      r -= 4.2 * Math.max(0, 1 - dt / (7 * DEG)) * (R / 43);
      ring.push([r * Math.cos(t + tw), r * Math.sin(t + tw)]);
    }
    return ring;
  };
  b.set(GLASS([0.27, 0.32, 0.36], 4.4, 2.6, 0.85, 0.27));
  const secs = [];
  for (let k = 0; k <= 26; k++) { const y = 575 * k / 26; secs.push(at(plan(y), y)); }
  // the crown: the last section cut by a sloping plane, 632 m at the notch's corner
  const top = plan(H), dir = [Math.cos(TWIST), Math.sin(TWIST)];
  const pmax = Math.max(...top.map(([x, n]) => x * dir[0] + n * dir[1]));
  secs.push(top.map(([x, n]) => [x, 610 + 22 * (x * dir[0] + n * dir[1]) / pmax, n]));
  b.loft(secs, { smooth: true });
  // the zones' refuge-floor bands (a slightly proud ring, pale)
  b.set(PLAIN([0.46, 0.48, 0.49], 0.3, { glow: [0.30, 0.34, 0.40] }));
  for (let z = 1; z <= 8; z++) {
    const y = z * 65;
    b.loft([at(plan(y - 1.5, 0.35), y - 1.5), at(plan(y + 1.5, 0.35), y + 1.5)], { smooth: true, capTop: false });
  }
  b.light([dir[0] * pmax, H, dir[1] * pmax], 1);
  const third = (y) => plan(y, 0.3).filter((_, i) => i % (K / 3) === K / 6);
  for (const y of [ROOF, 455, 325, 195]) ringLights(b, third(y), y, 0);
  return b.result();
}

// The Shanghai World Financial Center: 492 m, 101 floors, the roof at 487 m. A square prism about
// 58 m a side whose two opposite corners are cut away by curved faces that meet the diagonal at
// the top (a chisel about 82 m long and 16 m thick), with the trapezoidal opening through its top.
// Local plan: the chisel runs along the local north-east diagonal (bearing brg + 45°).
export function swfc(brg = -1) {
  const b = new Builder(0.33).frame(0, 0, brg);
  const H = 492, ROOF = 487.4, a = 29;
  const CT = 11.3;                                      // the top's thickness, as x - n
  const c = (y) => 2 * a - (2 * a - CT) * Math.min(y / ROOF, 1) ** 1.45;
  const plan = (y) => { const cc = c(y); return [[-a, -a], [cc - a, -a], [a, a - cc], [a, a], [a - cc, a], [-a, cc - a]]; };
  b.set(GLASS([0.20, 0.25, 0.29], 4.2, 3.0, 0.85, 0.27));
  const HOLE0 = 432, HOLE1 = 476;
  const secs = [];
  for (let k = 0; k <= 20; k++) { const y = HOLE0 * k / 20; secs.push(at(plan(y), y)); }
  b.loft(secs);
  // the opening: two posts at the chisel's ends, and the beam over it
  const s = (x, n) => (x + n) / Math.SQRT2;
  const hw = (y) => lerp(18, 26, (y - HOLE0) / (HOLE1 - HOLE0));   // half the opening's width along the chisel
  const clipPost = (poly, sMin, sign) => {
    // the part of the (convex) plan with sign * s >= sMin
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const fp = sign * s(p[0], p[1]) - sMin, fq = sign * s(q[0], q[1]) - sMin;
      if (fp >= 0) out.push(p);
      if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([lerp(p[0], q[0], t), lerp(p[1], q[1], t)]); }
    }
    return out;
  };
  for (const sign of [1, -1]) {
    const ps = [];
    for (let k = 0; k <= 3; k++) { const y = lerp(HOLE0, HOLE1, k / 3); ps.push(at(clipPost(plan(y), hw(y), sign), y)); }
    if (ps.every((r) => r.length === ps[0].length)) b.loft(ps, { capTop: false });
  }
  b.loft([at(plan(HOLE1), HOLE1), at(plan(ROOF), ROOF)], { capBottom: true });
  // the top's rail and mast stubs to 492
  b.set(PLAIN([0.35, 0.37, 0.38], 0.4));
  b.member([-a + 3, ROOF, -a + 3], [a - 3, ROOF, a - 3], 1.2, 4);
  for (const e of [1, -1]) b.member([e * (a - 3), ROOF, e * (a - 3)], [e * (a - 3), H, e * (a - 3)], 0.8, 4);
  for (const e of [1, -1]) b.light([e * (a - 3), H, e * (a - 3)], 1);
  for (const y of [400, 290, 180, 80]) for (const p of plan(y)) b.light([p[0], y, p[1]], 0);
  return b.result();
}

// Jin Mao Tower: 420.5 m, 88 floors. An octagon-cornered square about 62 m a side, stepping back in
// tiers like a pagoda, each tier an eighth shorter than the one below (the first 16 floors), with
// flared metal eaves at each step, a crown, and a spire from about 385 m.
export function jinmao(brg = 3) {
  const b = new Builder(0.48).frame(0, 0, brg);
  const H = 420.5;
  const plan = (w) => {
    // a square with its corners stepped twice (the plan's notched corners)
    const s1 = w * 0.16, s2 = w * 0.08, out = [];
    for (let q = 0; q < 4; q++) {
      const pts = [[w, -w + s1], [w, w - s1], [w - s2, w - s1], [w - s2, w - s2], [w - s1, w - s2], [w - s1, w]];
      for (const [x, n] of pts) { const a = q * Math.PI / 2, c = Math.cos(a), s = Math.sin(a); out.push([x * c - n * s, x * s + n * c]); }
    }
    return out;
  };
  const glass = GLASS([0.26, 0.27, 0.28], 4.0, 1.6, 0.55, 0.25, { spec: 0.35 });
  const eave = PLAIN([0.46, 0.46, 0.45], 0.5, { glow: [0.42, 0.38, 0.28] });
  let y = 0, h = 52, k = 0;
  const widths = [];
  const wAt = (yy) => 31 - 16 * Math.min(yy / 377, 1) ** 1.6;
  while (y + h * 0.5 < 377) {
    const y1n = Math.min(y + h, 377);
    const w0 = wAt(y), w1 = wAt(y1n) + 1.0;
    b.set(k >= 11 ? { ...glass, glow: [0.40, 0.36, 0.26] } : glass);
    const y1 = Math.min(y + h, 377);
    b.loft([at(plan(w0), y), at(plan(w1), y1 - 1.2)], { capTop: false });
    b.set(eave);
    b.loft([at(plan(w1), y1 - 1.2), at(plan(w1 + 1.4), y1 - 0.2), at(plan(w1 + 1.2), y1), at(plan(w1 - 0.6), y1)]);
    widths.push([y1, w1]);
    y = y1; h *= 0.88; k++;
  }
  // the crown: three small stepped tiers, then the spire
  b.set({ ...eave });
  b.loft([at(plan(15), 377), at(plan(13.5), 380), at(plan(10.5), 380), at(plan(9.5), 383), at(plan(7), 383), at(plan(6), 386), at(plan(4.2), 386), at(plan(3.6), 389)]);
  b.set(PLAIN([0.52, 0.52, 0.50], 0.6, { glow: [0.5, 0.45, 0.3] }));
  b.loft([[389, 3.8], [398, 2.8], [399, 3.4], [400.5, 2.4], [410, 1.2], [H, 0.15]].map(([yy, r]) => at(circle(r, 8), yy)), { smooth: true });
  b.light([0, H, 0], 1);
  for (const [yy, w] of widths.filter((_, i) => i % 3 === 2)) for (const [x, n] of [[w, w], [-w, w], [-w, -w], [w, -w]]) b.light([x * 0.86, yy, n * 0.86], 0);
  for (const [x, n] of [[15, 15], [-15, 15], [-15, -15], [15, -15]]) b.light([x * 0.86, 377, n * 0.86], 0);
  return b.result();
}

// The Oriental Pearl Tower: 468 m. Three vertical columns and three slanted legs, the lower sphere
// (about 50 m across, centre about 90 m), five small spheres up the columns, the upper sphere (about
// 45 m across, centre about 263 m), the small top sphere (about 350 m) and the antenna.
export function pearl() {
  const b = new Builder(0.82);
  const H = 468;
  const colR = 7.5;
  b.set(PLAIN([0.56, 0.56, 0.55], 0.25, { glow: [0.07, 0.03, 0.09] }));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + Math.PI / 2;
    cyl(b, colR * Math.cos(a), colR * Math.sin(a), 0, 340, 4.6, 3.6, 10);
    // the slanted legs, between the columns, from the ground to the lower sphere's underside
    const a2 = a + Math.PI / 3;
    b.member([46 * Math.cos(a2), 0, 46 * Math.sin(a2)], [12 * Math.cos(a2), 70, 12 * Math.sin(a2)], 3.4, 6);
    // the ring beam the legs and columns meet
  }
  // the spheres: rose and magenta glass panels, lit at night
  const sphere = GLASS([0.42, 0.04, 0.16], 3.6, 3.0, 0.55, 0.2, { spec: 0.75, glow: [0.85, 0.15, 0.55] });
  b.set(sphere);
  b.sphere([0, 93, 0], 25, 22, 14);
  b.sphere([0, 263, 0], 22.5, 22, 14);
  b.set({ ...sphere, glow: [0.6, 0.2, 0.7] });
  b.sphere([0, 350, 0], 8, 14, 9);
  for (let i = 0; i < 5; i++) b.sphere([0, 140 + 20 * i, 0], 6.2, 12, 8);
  // the antenna: a shaft from the top sphere, stepped
  b.set(PLAIN([0.58, 0.58, 0.57], 0.4, { glow: [0.35, 0.2, 0.4] }));
  b.loft([[340, 4.0], [358, 3.6], [370, 3.0], [372, 3.8], [374, 2.6], [410, 1.9], [440, 1.1], [H, 0.2]].map(([y, r]) => at(circle(r, 8), y)), { smooth: true });
  // the pavilion at the base
  b.set(GLASS([0.40, 0.40, 0.40], 4.5, 3.0, 0.4, 0.2));
  b.loft([at(circle(24, 18), 0), at(circle(24, 18), 9)]);
  b.light([0, H, 0], 1);
  for (const y of [400, 352]) ringLights(b, circle(y > 360 ? 2.0 : 8.2, 3), y, 0);
  ringLights(b, circle(22.7, 3), 263, 0);
  ringLights(b, circle(25.2, 3), 93, 0);
  return b.result();
}

// ------------------------------------------------------------------ Tokyo

// A lattice tower: K corner points per level (fn(y) -> ring of [x, n]) between the levels `ys`;
// verticals, rings every `ringEvery` levels, one diagonal per panel (alternating), and a shell for
// far away. Colour by height through `paint(y)` (a material) if given.
function lattice(b, fn, ys, { rv = 1.2, rd = 0.6, rr = 0.6, sides = 3, ringEvery = 1, cross = false, paint = null, shell = null, base = {} } = {}) {
  const K = fn(ys[0]).length;
  const P = ys.map((y) => fn(y).map(([x, n]) => [x, y, n]));
  const mat = (y) => (paint ? paint(y) : base);
  for (let j = 0; j + 1 < ys.length; j++) {
    const ym = (ys[j] + ys[j + 1]) / 2;
    b.set(mat(ym));
    for (let i = 0; i < K; i++) {
      const i1 = (i + 1) % K;
      b.member(P[j][i], P[j + 1][i], rv * lerp(1, 0.6, j / ys.length), sides);
      if (cross) { b.member(P[j][i], P[j + 1][i1], rd, sides); b.member(P[j][i1], P[j + 1][i], rd, sides); }
      else b.member((i + j) % 2 ? P[j][i] : P[j][i1], (i + j) % 2 ? P[j + 1][i1] : P[j + 1][i], rd, sides);
    }
    if ((j + 1) % ringEvery === 0) { b.set(mat(ys[j + 1])); for (let i = 0; i < K; i++) b.member(P[j + 1][i], P[j + 1][(i + 1) % K], rr, sides); }
  }
  if (shell) {
    // far away: a solid stand-in a little inside the members (not drawn within about 3 km)
    for (let j = 0; j + 1 < ys.length; j++) {
      const m = shell((ys[j] + ys[j + 1]) / 2);
      b.set({ ...m, shell: 1 });
      b.loft([at(scaleRing(fn(ys[j]), 0.97), ys[j]), at(scaleRing(fn(ys[j + 1]), 0.97), ys[j + 1])], { capTop: false });
    }
  }
}

// Tokyo Skytree: 634 m. A lattice tower whose plan is an equilateral triangle (about 68 m a side)
// at the base, becoming a circle by about 320 m; the Tembo deck at about 340-355 m, the gallery at
// about 445-452 m, the lattice to 495 m, then the gain tower and the antenna. A core column inside.
export function skytree(brg = 0) {
  const b = new Builder(0.12).frame(0, 0, brg);
  const H = 634, LAT_TOP = 495;
  const Rt = 68 / Math.sqrt(3);
  const rc = (y) => (y < 320 ? 14.8 : lerp(14.8, 9.5, (y - 320) / (LAT_TOP - 320)));
  const K = 12;
  const fn = (y) => {
    const f = y < 320 ? (1 - y / 320) ** 1.6 : 0, out = [];
    for (let i = 0; i < K; i++) {
      const t = (i / K) * TAU + Math.PI / 2;
      const m = ((t - Math.PI / 2) % (TAU / 3) + TAU / 3) % (TAU / 3) - Math.PI / 3;
      const rTri = (Rt / 2) / Math.cos(m);
      const r = rc(y) + f * (rTri - rc(0));
      out.push([r * Math.cos(t), r * Math.sin(t)]);
    }
    return out;
  };
  const ys = [];
  for (let k = 0; k <= 20; k++) ys.push(LAT_TOP * (k / 20) ** 0.92);
  const white = PLAIN([0.60, 0.64, 0.68], 0.25, { glow: [0.22, 0.34, 0.62] });
  lattice(b, fn, ys, { rv: 1.7, rd: 0.75, rr: 0.7, sides: 3, ringEvery: 2, base: white, shell: () => PLAIN([0.42, 0.45, 0.49], 0.1, { glow: [0.12, 0.18, 0.34] }) });
  // the core column
  b.set(PLAIN([0.55, 0.57, 0.60], 0.1));
  cyl(b, 0, 0, 0, 375, 5.5, 4.5, 12, { capTop: true });
  // the Tembo deck: a three-level drum, wider than the tower
  b.set(GLASS([0.22, 0.26, 0.30], 4.5, 2.0, 0.8, 0.6, { glow: [0.15, 0.25, 0.45] }));
  b.loft([[333, 14.8], [337, 20.5], [344, 21.5], [347, 20.0], [352, 20.8], [355, 19.5], [357, 15]].map(([y, r]) => at(circle(r, 24), y)), { smooth: true });
  // the Tembo Galleria
  b.loft([[441, 10.5], [444, 14.3], [452, 14.3], [455, 10.2]].map(([y, r]) => at(circle(r, 24), y)), { smooth: true });
  // the gain tower (a slimmer lattice, drawn solid) and the antenna
  b.set(PLAIN([0.62, 0.65, 0.69], 0.3, { glow: [0.25, 0.36, 0.6] }));
  b.loft([[LAT_TOP - 4, 9.0], [LAT_TOP, 6.5], [540, 5.6], [580, 4.6], [585, 3.0], [610, 2.4], [H, 0.6]].map(([y, r]) => at(circle(r, 12), y)), { smooth: true });
  b.light([0, H, 0], 1);
  for (const y of [LAT_TOP, 452, 355, 250, 150]) ringLights(b, fn(y).filter((_, i) => i % 4 === 0), y + 0.5, 0);
  return b.result();
}

// Tokyo Tower: 332.9 m. The lattice tower on four legs, the main deck at about 145-150 m, the top
// deck at about 250 m, then the mast; painted international orange and white in bands. The legs
// spread over arches at the foot, over a low building.
export function tokyotower(brg = 27) {
  const b = new Builder(0.91).frame(0, 0, brg);
  const H = 332.9, TOP = 250;
  const w = (y) => (y < TOP ? 2.8 + 31.2 * (1 - y / TOP) ** 2.05 : lerp(2.8, 0.5, (y - TOP) / (H - TOP)));
  const fn = (y) => { const h = w(y); return [[h, h], [-h, h], [-h, -h], [h, -h]]; };
  const ORANGE = [0.86, 0.15, 0.025], WHITE_P = [0.70, 0.70, 0.68];
  const NB = 11;
  const band = (y) => Math.floor(Math.min(y / H, 0.9999) * NB) % 2 === 0;    // even bands orange
  const paint = (y) => PLAIN(band(y) ? ORANGE : WHITE_P, 0.3, { glow: [1.0, 0.42, 0.10].map((v) => v * 0.85) });
  // the legs: from the ground to the girder at 42 m, an arch on each face between them
  const ARCH = 42;
  for (let i = 0; i < 4; i++) {
    const p = (y) => [fn(y)[i][0], y, fn(y)[i][1]];
    b.set(paint(0));
    for (let k = 0; k < 4; k++) b.member(p(ARCH * k / 4), p(ARCH * (k + 1) / 4), 2.6, 4);
    // the arch to the next leg
    const q = (y) => [fn(y)[(i + 1) % 4][0], y, fn(y)[(i + 1) % 4][1]];
    const A = p(4), B = q(4), pts = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8, yy = 4 + (ARCH - 6) * Math.sin(Math.PI * t);
      const ww = w(yy) / w(4);
      pts.push([lerp(A[0], B[0], t) * ww * 0.98, yy, lerp(A[2], B[2], t) * ww * 0.98]);
    }
    for (let k = 0; k < 8; k++) b.member(pts[k], pts[k + 1], 1.0, 4);
  }
  // the lattice from the girder to the top deck, then the mast
  const ys = [ARCH];
  while (ys[ys.length - 1] < TOP - 1) { const y = ys[ys.length - 1]; ys.push(Math.min(TOP, y + Math.max(9, w(y) * 1.25))); }
  lattice(b, fn, ys, { rv: 1.8, rd: 0.55, rr: 0.7, sides: 4, cross: true, paint, shell: (y) => PLAIN((band(y) ? ORANGE : WHITE_P).map((v) => v * 0.75), 0.1, { glow: [0.5, 0.2, 0.05] }) });
  const ym = [];
  for (let k = 0; k <= 6; k++) ym.push(lerp(TOP, H - 8, k / 6));
  lattice(b, fn, ym, { rv: 0.6, rd: 0.3, rr: 0.3, sides: 4, cross: true, paint, shell: (y) => PLAIN((band(y) ? ORANGE : WHITE_P).map((v) => v * 0.8), 0.1) });
  b.set(paint(H));
  cyl(b, 0, 0, H - 8, H, 0.7, 0.2, 6);
  // the decks
  b.set(GLASS([0.30, 0.31, 0.32], 3.2, 2.0, 0.6, 0.6, { glow: [0.5, 0.35, 0.2] }));
  b.loft([at(chamferRect(13, 13, 3), 143), at(chamferRect(13.5, 13.5, 3), 152)]);
  b.loft([at(chamferRect(5.5, 5.5, 1.5), 247), at(chamferRect(5.5, 5.5, 1.5), 252)]);
  // the low building under the legs
  b.set(GLASS([0.38, 0.37, 0.35], 4.0, 3.0, 0.35, 0.35));
  b.loft([at(chamferRect(30, 22, 2), 0), at(chamferRect(30, 22, 2), 18)]);
  b.light([0, H, 0], 1);
  for (const y of [TOP + 2, 152, 95]) ringLights(b, fn(y), y, 0);
  ringLights(b, fn(295).slice(0, 1), 295, 0);
  return b.result();
}

// Azabudai Hills Mori JP Tower: 325.2 m, 64 floors. A softly rounded square about 74 m a side that
// swells a little above the base, then tapers into a rounded crown.
export function azabudai(brg = 18) {
  const b = new Builder(0.27).frame(0, 0, brg);
  const H = 325.2;
  const w = (y) => {
    const t = y / H;
    let v = 35.5 + 2.2 * Math.sin(Math.PI * Math.min(t / 0.7, 1)) - 6 * Math.max(0, (t - 0.55) / 0.45) ** 1.4;
    if (t > 0.9) v -= 30 * (t - 0.9) ** 1.5 * 3.2;
    return v;
  };
  b.set(GLASS([0.31, 0.34, 0.37], 5.0, 3.2, 0.85, 0.27));
  const secs = [];
  for (let k = 0; k <= 24; k++) { const y = H * (1 - (1 - k / 24) ** 1.15); secs.push(at(superellipse(w(y), w(y), 3.6, 40, Math.PI / 4), y)); }
  b.loft(secs, { smooth: true });
  b.light([0, H, 0], 1);
  for (const y of [300, 220, 140, 60]) ringLights(b, superellipse(w(y) + 0.2, w(y) + 0.2, 3.6, 4, Math.PI / 4), y, 0);
  return b.result();
}

// The Tokyo Metropolitan Government Building No. 1: 242.9 m, 48 floors. A long block that splits
// into twin towers at the 33rd floor (about 163 m); each tower's top part turned 45°.
// Local plan: n along the block (its long axis, bearing brg), the towers at n = +-30.5.
export function tmg(brg = 162) {
  const b = new Builder(0.58).frame(0, 0, brg);
  const H = 242.9, SPLIT = 163, TURN = 200;
  const stone = GLASS([0.38, 0.36, 0.33], 5.0, 2.4, 0.3, 0.2, { spec: 0.1 });
  b.set(stone);
  const blockPlan = [[23, -54], [23, -12], [19, -12], [19, 12], [23, 12], [23, 54], [-23, 54], [-23, 12], [-19, 12], [-19, -12], [-23, -12], [-23, -54]];
  b.loft([at(blockPlan, 0), at(blockPlan, SPLIT)]);
  // the centre between the towers: set back, a little higher
  b.loft([at(chamferRect(17, 12, 1), SPLIT), at(chamferRect(17, 12, 1), SPLIT + 9)]);
  for (const s of [1, -1]) {
    b.loft([at(shift(chamferRect(23, 21, 4.5), 0, s * 33), SPLIT), at(shift(chamferRect(23, 21, 4.5), 0, s * 33), TURN)]);
    // the top part, turned 45°
    const top = shift(rotRing(chamferRect(17, 17, 3.5), 45 * DEG), 0, s * 33);
    b.loft([at(shift(chamferRect(22, 20, 4.5), 0, s * 33), TURN), at(shift(chamferRect(22, 20, 4.5), 0, s * 33), TURN + 3)]);
    b.loft([at(top, TURN + 3), at(top, H - 3)]);
    b.set(PLAIN([0.36, 0.35, 0.33], 0.2));
    b.loft([at(scaleRing(top, 0.8).map(([x, n]) => [x, n + s * 33 * 0.2]), H - 3), at(scaleRing(top, 0.8).map(([x, n]) => [x, n + s * 33 * 0.2]), H)]);
    b.set(stone);
    b.light([0, H, s * 33], 1);
    for (const [x, n] of top) b.light([x, H - 3, n], 0);
    for (const [x, n] of [[23, 21], [-23, 21], [-23, -21], [23, -21]]) b.light([x, SPLIT + 0.2, s * 33 + n], 0);
  }
  return b.result();
}

// Yokohama Landmark Tower: 296.3 m, 70 floors. A square tower about 60 m a side with chamfered
// corners, flaring out at the base, stepping back near the top to a hollow square crown.
export function ylmt(brg = 50) {
  const b = new Builder(0.66).frame(0, 0, brg);
  const H = 296.3;
  const w = (y) => (y < 60 ? 30 + 7 * (1 - y / 60) ** 2 : 30);
  b.set(GLASS([0.38, 0.37, 0.35], 4.0, 2.6, 0.35, 0.2, { spec: 0.1 }));
  const secs = [];
  for (const y of [0, 10, 20, 32, 45, 60, 240]) secs.push(at(chamferRect(w(y), w(y), w(y) * 0.24), y));
  b.loft(secs);
  b.loft([at(chamferRect(27, 27, 6.5), 240), at(chamferRect(27, 27, 6.5), 256)]);
  b.loft([at(chamferRect(24, 24, 5.8), 256), at(chamferRect(24, 24, 5.8), 271)]);
  b.loft([at(chamferRect(21, 21, 5), 271), at(chamferRect(21, 21, 5), 277)]);
  // the crown: four walls round a hollow square
  b.set(GLASS([0.44, 0.42, 0.40], 4.0, 2.0, 0.3, 0, { glow: [0.4, 0.4, 0.42] }));
  for (const [x, n, hx, hn] of [[16, 0, 2.5, 18.5], [-16, 0, 2.5, 18.5], [0, 16, 13.5, 2.5], [0, -16, 13.5, 2.5]]) box(b, x, n, 277, H, hx, hn);
  b.light([16, H, 16], 1); b.light([-16, H, -16], 1);
  for (const y of [271, 200, 130, 60]) for (const [x, n] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) b.light([x * w(y) * 0.88, y, n * w(y) * 0.88], 0);
  return b.result();
}

// ------------------------------------------------------------------ with the new airports

// Busan's LCT: the Landmark Tower (411.6 m, 101 floors) and the two residential towers (339.1 m
// and 333 m), curved plans, the crowns tapering. parts: [dx, dn, height, a, b] in map metres from
// the Landmark Tower.
export function lct(parts = [[0, 0, 411.6, 36, 34], [-160, 151, 339.1, 34, 26], [-78, 95, 333, 33, 27]], brg = 117) {
  const b = new Builder(0.74);
  parts.forEach(([dx, dn, H, ha, hb], i) => {
    b.frame(dx, dn, brg + (i ? 0 : -96));
    const crown = i ? 0.86 : 0.82;
    b.set(GLASS([0.20, 0.25, 0.29], 4.0, 2.8, 0.85, 0.12, { glow: [0, 0, 0] }));   // residential: few windows lit late (it read as three white pillars at 0.27)
    const secs = [];
    const s = (y) => (y < H * crown ? 1 - 0.05 * y / H : lerp(1 - 0.05 * crown, 0.42, ((y - H * crown) / (H * (1 - crown))) ** 1.3));
    for (const t of [0, 0.25, 0.5, 0.75, crown]) secs.push(at(scaleRing(superellipse(ha, hb, 2.6, 28), s(t * H)), t * H));
    b.loft(secs, { smooth: true, capTop: false });
    b.set(GLASS([0.30, 0.34, 0.38], 4.0, 2.0, 0.7, 0, { glow: [0.20, 0.23, 0.30] }));
    const top = [];
    for (let k = 0; k <= 5; k++) { const y = lerp(H * crown, H - 3, k / 5); top.push(at(scaleRing(superellipse(ha, hb, 2.6, 28), s(y)).map(([x, n]) => [x + (i ? 0 : 6) * (k / 5), n]), y)); }
    b.loft(top, { smooth: true });
    b.set(PLAIN([0.5, 0.5, 0.5], 0.4));
    cyl(b, 0, 0, H - 3, H, 1.4, 0.3, 6);
    b.light([0, H, 0], 1);
    for (const y of [H * crown, H * 0.55, H * 0.3]) ringLights(b, scaleRing(superellipse(ha, hb, 2.6, 4), s(y) + 0.003), y, 0);
  });
  return b.result();
}

// Incheon's Northeast Asia Trade Tower (Songdo): 305 m, 68 floors. Faceted glass: a square base
// about 58 m a side tapering and turning into a triangle at the roof.
export function neatt(brg = 40) {
  const b = new Builder(0.39).frame(0, 0, brg);
  const H = 305, K = 12;
  const sq = resample([[29, -29], [29, 29], [-29, 29], [-29, -29]], K);
  const tri = resample([0, 1, 2].map((i) => { const a = (i / 3) * TAU - Math.PI / 4; return [24 * Math.cos(a), 24 * Math.sin(a)]; }), K);
  b.set(GLASS([0.14, 0.21, 0.28], 4.2, 2.6, 0.88, 0.27));
  const secs = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10, y = (H - 8) * t, e = smooth01(t);
    secs.push(at(rotRing(sq.map((p, i) => [lerp(p[0], tri[i][0], e), lerp(p[1], tri[i][1], e)]), 12 * DEG * t), y));
  }
  b.loft(secs);
  b.set(PLAIN([0.4, 0.42, 0.44], 0.4, { glow: [0.3, 0.38, 0.5] }));
  b.loft([at(rotRing(scaleRing(tri, 0.96), 12 * DEG), H - 8), at(rotRing(scaleRing(tri, 0.8), 12 * DEG), H)]);
  b.light([0, H, 0], 1);
  for (const y of [H - 8, 200, 100]) { const t = y / (H - 8), e = smooth01(t); ringLights(b, rotRing(sq.map((p, i) => [lerp(p[0], tri[i][0], e), lerp(p[1], tri[i][1], e)]), 12 * DEG * t).filter((_, i) => i % 3 === 0), y, 0); }
  return b.result();
}

// Abeno Harukas: 300 m, 60 floors. Three stacked boxes, each set back from the one below on the
// west, flush on the east, with recessed floors between them.
export function harukas(brg = 8) {
  const b = new Builder(0.52).frame(0, 0, brg);
  const H = 300;
  const glass = GLASS([0.30, 0.34, 0.38], 4.5, 2.0, 0.75, 0.27, { spec: 0.3 });
  const blocks = [[0, 112, -44, 44, -38, 38], [118, 204, -22, 44, -31, 31], [210, H, -6, 44, -24, 24]];
  for (const [y0, y1, x0, x1, n0, n1] of blocks) {
    b.set(glass);
    b.loft([at([[x1, n0], [x1, n1], [x0, n1], [x0, n0]], y0), at([[x1, n0], [x1, n1], [x0, n1], [x0, n0]], y1)]);
  }
  // the recessed floors between the blocks
  b.set(PLAIN([0.12, 0.13, 0.14], 0.2, { glow: [0.4, 0.38, 0.32] }));
  box(b, 11, 0, 112, 118, 29, 27);
  box(b, 19, 0, 204, 210, 21, 21);
  b.light([44, H, 24], 1); b.light([-6, H, -24], 1);
  for (const [y, x0] of [[H, -6], [204, -22], [112, -44]]) for (const [x, n] of [[44, 1], [x0, 1], [x0, -1], [44, -1]]) b.light([x, y, n * (y === H ? 24 : y === 204 ? 31 : 38)], 0);
  return b.result();
}

// The Umeda Sky Building: 173 m, 40 floors. Two slab towers about 54 m apart, joined at the top by
// the ring-shaped observatory deck with a round hole in its middle, escalator tubes across the gap.
export function umeda(brg = -2) {
  const b = new Builder(0.86).frame(0, 0, brg);
  const H = 173, DECK = 159;
  const glass = GLASS([0.29, 0.33, 0.37], 4.0, 1.8, 0.92, 0.27, { spec: 0.4 });
  b.set(glass);
  for (const s of [1, -1]) b.loft([at(shift([[15, -27.5], [15, 27.5], [-15, 27.5], [-15, -27.5]], s * 42, 0), 0), at(shift([[15, -27.5], [15, 27.5], [-15, 27.5], [-15, -27.5]], s * 42, 0), DECK)], { capTop: false });
  // the deck: a plate over both towers with a round hole (outer rectangle and inner circle sampled
  // at the same angles, so the top and the underside are strips between them)
  const N = 40, R = 18.5;
  const outer = [], inner = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * TAU, c = Math.cos(t), s = Math.sin(t);
    const k = Math.min(57 / Math.max(Math.abs(c), 1e-6), 27.5 / Math.max(Math.abs(s), 1e-6));
    outer.push([c * k, s * k]); inner.push([c * R, s * R]);
  }
  b.set({ ...glass, glow: [0.3, 0.35, 0.45] });
  b.loft([at(outer, DECK), at(outer, H)], { capTop: false });
  b.flip = true;            // the hole's wall faces the hole
  b.loft([at(inner, DECK), at(inner, H)], { capTop: false });
  b.flip = false;
  const strip = (y, up) => {
    const nn = [0, up ? 1 : -1, 0];
    for (let i = 0; i < N; i++) {
      const i1 = (i + 1) % N;
      const o0 = b.T([outer[i][0], y, outer[i][1]]), o1 = b.T([outer[i1][0], y, outer[i1][1]]);
      const n0 = b.T([inner[i][0], y, inner[i][1]]), n1 = b.T([inner[i1][0], y, inner[i1][1]]);
      const ins = [o0[0], y - (up ? 1 : -1), o0[2]];
      b.tri(o0, o1, n1, ins, nn, nn, nn); b.tri(o0, n1, n0, ins, nn, nn, nn);
    }
  };
  strip(H, true); strip(DECK, false);
  // the escalator tubes across the gap, and the bridge a third of the way up
  b.set(PLAIN([0.45, 0.47, 0.50], 0.5));
  b.member([-27, 148, -6], [27, 158, -6], 2.2, 6);
  b.member([27, 128, 8], [-27, 146, 8], 2.2, 6);
  b.member([-27, 60, 0], [27, 60, 0], 2.0, 4);
  b.light([57, H, 27.5], 1); b.light([-57, H, -27.5], 1);
  for (const [x, n] of [[57, -27.5], [-57, 27.5]]) b.light([x, H, n], 0);
  for (const s of [1, -1]) for (const n of [27.5, -27.5]) b.light([s * 57, 90, n], 0);
  return b.result();
}

// Fukuoka Tower: 234 m. A slim triangular prism clad in half-mirror glass to about 140 m, the
// observation decks near its top (116-123 m), a tapering frame above and the antenna.
export function fktower(brg = 140) {
  const b = new Builder(0.17).frame(0, 0, brg);
  const H = 234;
  const tri = (s) => [0, 1, 2].map((i) => { const a = (i / 3) * TAU + Math.PI / 2; return [s / Math.sqrt(3) * Math.cos(a), s / Math.sqrt(3) * Math.sin(a)]; });
  const mirror = GLASS([0.22, 0.27, 0.33], 0, 0, 0.95, 0, { spec: 0.8, glow: [0.15, 0.25, 0.6] });
  b.set({ ...mirror, fac: [6.0, 3.0, 0.95, 0] });
  b.loft([at(tri(24), 0), at(tri(24), 112)], { capTop: false });
  b.set(GLASS([0.18, 0.20, 0.22], 3.5, 2.0, 0.5, 0.7, { glow: [0.25, 0.3, 0.5] }));
  b.loft([at(tri(24.4), 112), at(tri(24.4), 126)], { capTop: false });
  b.set({ ...mirror, fac: [6.0, 3.0, 0.95, 0] });
  b.loft([at(tri(24), 126), at(tri(23), 150), at(tri(11), 196), at(tri(7), 200)]);
  b.set(PLAIN([0.55, 0.55, 0.55], 0.4));
  b.loft([[200, 1.8], [225, 0.9], [H, 0.3]].map(([y, r]) => at(circle(r, 6), y)), { smooth: true });
  b.light([0, H, 0], 1);
  for (const y of [200, 150, 80]) ringLights(b, tri(y > 190 ? 7.2 : 24.2), y, 0);
  return b.result();
}

// The dome beside it: about 216 m across and 84 m high: a drum and a low spherical cap.
export function fkdome() {
  const b = new Builder(0.29);
  const R = 108, H = 84, DRUM = 30;
  b.set(GLASS([0.48, 0.48, 0.47], 6.0, 8.0, 0.3, 0.15, { spec: 0.2 }));
  b.loft([at(circle(R, 48), 0), at(circle(R, 48), DRUM)], { smooth: true, capTop: false });
  // the cap: a sphere of radius S through the drum's rim, its top at H
  const h = H - DRUM, S = (R * R + h * h) / (2 * h), cy = H - S;
  b.set(PLAIN([0.47, 0.49, 0.51], 0.5));
  const secs = [];
  for (let k = 0; k <= 8; k++) {
    const phi = Math.asin(R / S) * (1 - k / 8);
    const r = Math.max(S * Math.sin(phi), 0.5), y = cy + S * Math.cos(phi);
    secs.push(at(circle(r, 48), y));
  }
  b.loft(secs, { smooth: true });
  // the roof's ribs (its panels' seams), along the meridians, and the ring at the drum's top
  b.set(PLAIN([0.30, 0.31, 0.32], 0.3));
  const rib = (k, t) => { const phi = Math.asin(R / S) * (1 - t); return [S * Math.sin(phi), cy + S * Math.cos(phi) + 0.4]; };
  for (let m = 0; m < 24; m++) {
    const a = (m / 24) * Math.PI * 2;
    for (let k = 0; k < 6; k++) {
      const [r0, y0] = rib(m, k / 6), [r1, y1] = rib(m, (k + 1) / 6);
      if (r1 < 6) break;
      b.member([r0 * Math.cos(a), y0, r0 * Math.sin(a)], [r1 * Math.cos(a), y1, r1 * Math.sin(a)], 0.9, 3);
    }
  }
  return b.result();
}

// ------------------------------------------------------------------ v0.6.3: Beijing, Tianjin, Shenyang, Vladivostok

// CITIC Tower (China Zun): 527.7 m, 109 floors, the top floor at 522 m. A square plan with rounded
// corners, about 78 m a side at the base (OSM 81 x 77 m), drawn in on a concave curve to about 54 m
// near 385 m and flaring again to about 69 m at the top, as the ancient vessel it is named for
// (the waist's and top's widths [EST], from the design's published proportions).
export function citic(brg = 6) {
  const b = new Builder(0.31).frame(0, 0, brg);
  const H = 527.7, ROOF = 522, WAIST = 385;
  const hw = (y) => (y < WAIST ? 39 - 12 * smooth01(y / WAIST) : 27 + 7.5 * smooth01(Math.min((y - WAIST) / (ROOF - WAIST), 1)));
  const plan = (y) => roundedRect(hw(y), hw(y), hw(y) * 0.2, 3);
  b.set(GLASS([0.27, 0.31, 0.35], 4.85, 3.0, 0.85, 0.26));
  const secs = [];
  for (let k = 0; k <= 24; k++) { const y = (ROOF * k) / 24; secs.push(at(plan(y), y)); }
  b.loft(secs, { smooth: false });
  // the crown: a parapet round the roof's garden, lit at night
  b.set(GLASS([0.34, 0.37, 0.40], 4.0, 2.0, 0.6, 0, { glow: [0.30, 0.32, 0.36] }));
  b.loft([at(plan(ROOF), ROOF), at(scaleRing(plan(ROOF), 1.004), H)], { capTop: false });
  b.flip = true;
  b.loft([at(scaleRing(plan(ROOF), 0.93), ROOF), at(scaleRing(plan(ROOF), 0.93), H)], { capTop: false });
  b.flip = false;
  const c = hw(ROOF) * 0.97;
  for (const [x, n] of [[c, c], [-c, -c]]) b.light([x, H, n], 1);
  for (const [x, n] of [[c, -c], [-c, c]]) b.light([x, H, n], 0);
  for (const y of [420, 300, 180, 70]) { const q = hw(y) * 0.95; for (const [x, n] of [[q, q], [-q, q], [-q, -q], [q, -q]]) b.light([x, y, n], 0); }
  return b.result();
}

// CCTV Headquarters: 234 m, 51 floors. Two towers leaning out at about 6° [EST], rising from an
// L-shaped podium of about 9 floors [EST] along two sides of the site and joined at the top by an
// L-shaped overhang of about 13 floors [EST] along the other two: a loop, about 160 m a side in plan
// (OSM 159 x 168 m). Local plan: tower A at the south-west corner, B at the north-east, the podium
// round the south-east corner, the overhang round the north-west.
export function cctv(brg = 6) {
  const b = new Builder(0.44).frame(0, 0, brg);
  const H = 234, POD = 50, OVER = 162, E = 80, T = 27;      // E: the site's half side; T: a tower's half side
  const glass = GLASS([0.24, 0.26, 0.28], 4.5, 3.0, 0.7, 0.24, { spec: 0.3 });
  b.set(glass);
  // the podium: an L round the south-east corner (y 0..POD)
  // (each L as two boxes: a fan cap from an L's centre would cover its inner corner)
  box(b, 0, -E + T, 0, POD, E, T);
  box(b, E - T, T, 0, POD, T, E - T);
  // the towers, leaning: A (south-west) towards the north, B (north-east) towards the west, each by
  // tan 6° of its rise, so their tops sit under the overhang's arms
  const lean = Math.tan(6 * DEG);
  const tower = (cx, cn, dx, dn) => {
    const secs = [];
    for (const y of [POD, (POD + OVER) / 2, OVER]) secs.push(at(shift([[T, -T], [T, T], [-T, T], [-T, -T]], cx + dx * lean * (y - POD), cn + dn * lean * (y - POD)), y));
    b.loft(secs, { capTop: false });
  };
  tower(-E + T, -E + T, 0, 1);
  tower(E - T, E - T, -1, 0);
  // the overhang: an L round the north-west corner (y OVER..H), its arms over the towers' tops
  const dA = lean * (OVER - POD);
  b.set({ ...glass, glow: [0.10, 0.11, 0.13] });
  box(b, -E + T, dA / 2, OVER, H, T, E - dA / 2, 0, { capBottom: true });
  box(b, (-E + 2 * T + E - dA) / 2, E - T, OVER, H, (E - dA - (-E + 2 * T)) / 2, T, 0, { capBottom: true });
  b.light([-E, H, E], 1); b.light([E - dA, H, E], 1); b.light([-E, H, -E + dA], 1);
  for (const [x, n] of [[-E + 2 * T, E - 2 * T], [-E + 2 * T, -E + dA], [E - dA, E - 2 * T]]) b.light([x, H, n], 0);
  for (const [x, n] of [[E, -E], [E, E], [-E, -E]]) b.light([x, POD, n], 0);
  return b.result();
}

// A TV tower: a round concrete shaft (r0 at the foot to r1 at the pod), the pod (rings [y, r]),
// a short shaft above it and the mast, painted red and white in bands. Lights: the mast's top
// flashing, steady ones up the mast and round the pod.
function tvTower(b, { H, r0, r1, podY0, pod, shaftTop, shaftR, mastR, foot = null, bands = 6 }) {
  const shaft = PLAIN(CONCRETE.map((v) => v * 1.12), 0.1, { glow: [0.10, 0.10, 0.12] });
  b.set(shaft);
  if (foot) b.loft(foot.map(([y, r]) => at(circle(r, 16), y)), { smooth: true, capTop: false });
  const y0 = foot ? foot[foot.length - 1][0] : 0;
  b.loft([y0, lerp(y0, podY0, 0.35), lerp(y0, podY0, 0.7), podY0].map((y) => at(circle(lerp(r0, r1, (y - y0) / (podY0 - y0)), 16), y)), { smooth: true, capTop: false });
  b.set(GLASS([0.30, 0.32, 0.34], 3.6, 2.2, 0.6, 0.45, { glow: [0.25, 0.25, 0.30] }));
  b.loft(pod.map(([y, r]) => at(circle(r, 24), y)), { smooth: true });
  const podTop = pod[pod.length - 1][0];
  b.set(shaft);
  cyl(b, 0, 0, podTop, shaftTop, shaftR, shaftR * 0.85, 12);
  const red = PLAIN([0.60, 0.07, 0.04], 0.2), white = PLAIN(WHITE, 0.2);
  mast(b, shaftTop, H, mastR, 0.3, bands, [red, white], 8);
  b.light([0, H, 0], 1);
  for (const t of [0.33, 0.66]) { const y = lerp(shaftTop, H, t); ringLights(b, circle(lerp(mastR, 0.3, t) + 0.3, 3), y, 0); }
  const podMax = Math.max(...pod.map(([, r]) => r));
  ringLights(b, circle(podMax + 0.3, 4), pod.reduce((a, p) => (p[1] === podMax ? p[0] : a), podY0), 0);
  ringLights(b, circle(shaftR + 0.2, 3), shaftTop, 0);
}

// The Central Radio and TV Tower (Beijing): 405 m to the antenna, the observation deck at 238 m,
// the top floor at 248 m. The pod's shape and the shaft's and mast's sizes [EST]; the base building
// about 70 m across (OSM 72 x 71 m) [EST its height].
export function cctvtower() {
  const b = new Builder(0.13);
  tvTower(b, { H: 405, r0: 13, r1: 9, podY0: 212, pod: [[212, 9], [220, 22], [228, 24], [238, 24], [242, 21], [248, 21], [253, 13], [257, 8]],
    shaftTop: 278, shaftR: 6.5, mastR: 3.2, bands: 8 });
  b.set(GLASS([0.38, 0.37, 0.35], 4.2, 3.0, 0.35, 0.35));
  b.loft([at(chamferRect(34, 34, 8), 0), at(chamferRect(34, 34, 8), 16)]);
  return b.result();
}

// The Tianjin Radio and Television Tower: 415.2 m, standing in its lake. A round shaft (OSM: 30 m
// across at the foot) flared at the water, the pod about two-thirds of the way up (its rings [EST]),
// and the mast.
export function tjtower() {
  const b = new Builder(0.47);
  tvTower(b, { H: 415.2, r0: 11.5, r1: 7.5, podY0: 232, pod: [[232, 7.5], [240, 18], [246, 20], [262, 20], [268, 16], [274, 8]],
    shaftTop: 300, shaftR: 5.5, mastR: 2.8, foot: [[0, 15], [6, 14.5], [16, 11.5]], bands: 8 });
  return b.result();
}

// The Liaoning Broadcast and TV Tower (Shenyang): 305.5 m. A round shaft (OSM: 38 m across at the
// foot, with its base), the disk with the observation decks and the revolving restaurant, an outdoor
// deck on top of it (its height [EST]), and the mast.
export function lntower() {
  const b = new Builder(0.58);
  tvTower(b, { H: 305.5, r0: 10, r1: 6.5, podY0: 180, pod: [[180, 6.5], [186, 17], [190, 21], [198, 21], [201, 18], [204, 9]],
    shaftTop: 222, shaftR: 5, mastR: 2.4, foot: [[0, 18], [8, 18], [9, 11], [14, 10]], bands: 6 });
  return b.result();
}

// A cable-stayed bridge along the local n axis (map metres; its plan from OpenStreetMap), the base
// at the sea (y 0). geo: { s: half the pylons' spacing, n0, n1: the deck's ends (n0 < -s, n1 > s),
// h0, h1: the ground's height at those ends, clear: the deck's underside at mid-span, half: the
// deck's half width, back: the cable fans' reach behind each pylon, pylon(b, n): the pylon's builder,
// anchors(n): [x, y] cable anchors on the pylon at n (x signed), piers: spacing beyond the fans }.
function cableStayed(b, g) {
  const D = 4.5;                                    // the deck's depth
  // the deck's underside: a gentle camber over the main span, then straight down to the ends' ground
  const under = (n) => {
    const a = Math.abs(n);
    if (a <= g.s) return g.clear + 3 * (1 - (a / g.s) ** 2);
    const end = n < 0 ? g.n0 : g.n1, hEnd = (n < 0 ? g.h0 : g.h1) - D;
    const t = (a - g.s) / (Math.abs(end) - g.s);
    return lerp(g.clear, Math.max(hEnd, 0.5), t);
  };
  // the deck: a box girder lofted along n
  const ns = [];
  for (let n = g.n0; n < g.n1; n += 60) ns.push(n);
  ns.push(g.n1);
  for (const s of [-g.s, g.s]) if (!ns.includes(s)) ns.push(s);
  ns.sort((p, q) => p - q);
  b.set(PLAIN([0.40, 0.41, 0.42], 0.25));
  const H = g.half;
  for (let i = 0; i + 1 < ns.length; i++) {
    const na = ns[i], nb = ns[i + 1], ya = under(na), yb = under(nb);
    const c = b.T([0, (ya + yb) / 2 + D / 2, (na + nb) / 2]);
    const q = (x, y, n) => b.T([x, y, n]);
    const A = [q(-H, ya, na), q(H, ya, na), q(H, ya + D, na), q(-H, ya + D, na)];
    const B = [q(-H, yb, nb), q(H, yb, nb), q(H, yb + D, nb), q(-H, yb + D, nb)];
    for (let k = 0; k < 4; k++) { const k1 = (k + 1) % 4; b.tri(A[k], A[k1], B[k1], c); b.tri(A[k], B[k1], B[k], c); }
    if (i === 0) { b.tri(A[0], A[1], A[2], c); b.tri(A[0], A[2], A[3], c); }
    if (i + 2 === ns.length) { b.tri(B[0], B[1], B[2], c); b.tri(B[0], B[2], B[3], c); }
  }
  // the approach piers, below the deck where it is clear of the ground (where the ground is
  // higher they stand in it)
  b.set(PLAIN(CONCRETE, 0.1));
  for (const side of [-1, 1]) {
    const end = side < 0 ? g.n0 : g.n1;
    for (let a = g.s + g.piers; a < Math.abs(end) - 20; a += g.piers) {
      const y = under(side * a);
      if (y > 3) box(b, 0, side * a, 0, y, H * 0.55, 3, 0, { capTop: false });
    }
  }
  // the pylons and their fans of stays: from the anchors on each pylon to the deck's edges, over
  // the main span (to near mid-span) and the back span
  for (const pn of [-g.s, g.s]) {
    g.pylon(b, pn);
    const anc = g.anchors(pn);
    b.set(PLAIN([0.70, 0.70, 0.68], 0.4));
    anc.forEach(([x, y], k) => {
      const t = (k + 1) / anc.length;
      for (const dir of [-1, 1]) {
        const reach = dir * Math.sign(pn) < 0 ? g.s * 0.96 : g.back;     // towards the middle, or behind
        const n = pn + dir * reach * t;
        b.member([x, y, pn], [Math.sign(x) * (H - 1), under(n) + D, n], 0.55, 3);
      }
    });
  }
}

// The Russky Bridge (Vladivostok): the pylons 321 m (OSM height=321; Wikipedia's infobox 319.1 m,
// its text 324 m), the main span 1,104 m over the Eastern Bosphorus strait, 70 m clear below, the
// deck 29.5 m wide, spans 60+72+3x84+1104+3x84+72+60 m, 168 stays. A-shaped pylons (the legs from
// OSM's footings, 80 m apart) meeting at the head, the stays in two planes from it.
export function russky(brg = 45.6, geo = {}) {
  const b = new Builder(0.52).frame(0, 0, brg);
  const g = { s: 556, n0: -1064, n1: 1064, h0: 30, h1: 30, ...geo };
  const H = 321, LEG = 40, HEAD = 190;
  cableStayed(b, {
    ...g, clear: 70, half: 14.75, back: 384 * g.s / 552, piers: 84 * g.s / 552,
    pylon: (bb, n) => {
      bb.set(PLAIN([0.60, 0.61, 0.60], 0.15, { glow: [0.18, 0.20, 0.26] }));
      for (const sx of [-1, 1]) bb.member([sx * LEG, 0, n], [sx * 3.5, HEAD + 40, n], 5.5, 4);
      bb.loft([at(shift(chamferRect(5.5, 8, 1.5), 0, n), HEAD + 30), at(shift(chamferRect(4, 6, 1.2), 0, n), H)]);
      // the cross beam under the deck
      bb.member([-LEG * 0.82, 62, n], [LEG * 0.82, 62, n], 3, 4);
      bb.light([0, H, n], 1);
      for (const y of [240, 160, 80]) for (const sx of [-1, 1]) bb.light([sx * (LEG - (LEG - 3.5) * y / (HEAD + 40) + 6), y, n], 0);
    },
    anchors: () => { const out = []; for (let k = 0; k < 11; k++) { const y = lerp(HEAD + 40, H - 12, k / 10); out.push([-3.5, y], [3.5, y]); } return out; },
  });
  return b.result();
}

// The Zolotoy (Golden) Bridge (Vladivostok): over the Golden Horn bay, the main span 737 m, 1,387 m
// long, 60 m clear below, the deck 33.3 m wide. The pylons about 226 m [EST: Wikipedia's infobox
// gives a height of 222.42 m without saying of what], their legs splayed into a V across the deck
// [EST their sizes]; their places: the cable-stayed section's middle (OSM) +- half the main span [EST].
export function zolotoy(brg = -1.7, geo = {}) {
  const b = new Builder(0.63).frame(0, 0, brg);
  const g = { s: 371.8, n0: -686.8, n1: 686.8, h0: 30, h1: 30, ...geo };
  const H = 226, B0 = 21, B1 = 31;
  cableStayed(b, {
    ...g, clear: 60, half: 16.65, back: Math.max(Math.min(Math.abs(g.n0), g.n1) - g.s - 40, 120), piers: 60,
    pylon: (bb, n) => {
      bb.set(PLAIN([0.58, 0.58, 0.56], 0.15, { glow: [0.34, 0.27, 0.12] }));
      for (const sx of [-1, 1]) bb.member([sx * B0, 0, n], [sx * B1, H - 2, n], 4, 4);
      bb.member([-B0 - 1.5, 54, n], [B0 + 1.5, 54, n], 3, 4);
      bb.member([-B1 + 1, H - 30, n], [B1 - 1, H - 30, n], 2.2, 4);
      bb.loft([at(shift(chamferRect(4, 4, 1), -B1, n), H - 2), at(shift(chamferRect(3, 3, 0.8), -B1, n), H)]);
      bb.loft([at(shift(chamferRect(4, 4, 1), B1, n), H - 2), at(shift(chamferRect(3, 3, 0.8), B1, n), H)]);
      for (const sx of [-1, 1]) { bb.light([sx * B1, H, n], 1); for (const y of [150, 90]) bb.light([sx * (lerp(B0, B1, y / H) + 4.5), y, n], 0); }
    },
    anchors: () => { const out = []; for (let k = 0; k < 9; k++) { const y = lerp(120, H - 12, k / 8), x = lerp(B0, B1, y / H); out.push([-x, y], [x, y]); } return out; },
  });
  return b.result();
}

// ------------------------------------------------------------------ v0.6.4: Pyongyang, Sapporo, Sendai

// The Ryugyong Hotel (Pyongyang): 330 m, 105 floors. Three wings at 120°, each 100 m long and 18 m
// wide, their outer faces sloping at about 75° to the ground and stepped once, meeting at a common point
// (drawn at OSM's slope, 235 m in 70 m, 73°, so the three meet under the crown);
// on top a truncated cone of stacked rings (the article: 40 m wide, eight floors meant to turn and
// six static above), then the pinnacle. Glass-clad. Local north: one wing (OSM: the wings point at
// grid bearings about 77, 197 and 317). The low podium round the wings' feet is drawn too (OSM's
// 10 m base, which this replaces), out to the wings' tips.
export function ryugyong(brg = 77) {
  const b = new Builder(0.71).frame(0, 0, brg);
  const H = 330, TAN = 235 / 70;
  const W = 9;                              // the wing's half width (18 m)
  const TIP = 104, TIP_H = 24;              // the wing's end: a short upright face, then the slope
  const STEP_Y = 160, STEP = 3.5;           // the one step in the slope
  // the wing's reach at height y (m from the centre)
  const reach = (y) => {
    if (y <= TIP_H) return TIP;
    const d = TIP - (y - TIP_H) / TAN;
    return y < STEP_Y ? d : d - STEP;
  };
  const glass = GLASS([0.27, 0.34, 0.42], 3.1, 3.0, 0.9, 0.06, { spec: 0.35, glow: [0.05, 0.08, 0.13] });
  const ys = [0, TIP_H, STEP_Y - 0.01, STEP_Y, 230, 290];
  for (let w = 0; w < 3; w++) {
    b.set({ ...glass, seed: 0.71 + w * 0.1 });
    const a = w * 120 * DEG;
    const secs = ys.map((y) => {
      const d = reach(y);
      // the wing's plan: from just inside the core to its reach, W either side (turned by a)
      return at(rotRing([[W, 6], [W, d], [-W, d], [-W, 6]], a), y);
    });
    b.loft(secs, { capTop: true });
  }
  // the core between the wings: a triangle with rounded corners round the wings' roots, to where the
  // wings' slopes meet it
  const core = (r) => { const out = []; for (let k = 0; k < 3; k++) { const a0 = (k * 120 + 60) * DEG; for (let m = -2; m <= 2; m++) { const t = a0 + m * 18 * DEG; out.push([r * Math.sin(t), r * Math.cos(t)]); } } return out; };
  b.set(glass);
  b.loft([at(core(22), 0), at(core(22), 160), at(core(19), 260), at(core(15), 284)], { capTop: true });
  // the crown: the truncated cone in rings (each ring a lighter band with a shadow gap under it)
  const ringMat = PLAIN([0.58, 0.60, 0.62], 0.45, { glow: [0.40, 0.42, 0.48] });
  const cone = GLASS([0.22, 0.28, 0.35], 3.2, 2.5, 0.8, 0, { spec: 0.3, glow: [0.07, 0.09, 0.13] });
  const rOf = (y) => lerp(20, 7, (y - 280) / (316 - 280));
  for (let k = 0; k < 5; k++) {
    const y0 = 280 + k * 7.2, y1 = y0 + 7.2;
    b.set(cone);
    b.loft([at(circle(rOf(y0) - 1.2, 24), y0), at(circle(rOf(y1) - 1.2, 24), y1 - 2)], { smooth: true, capTop: false });
    b.set(ringMat);
    b.loft([at(circle(rOf(y1 - 2) - 1.2, 24), y1 - 2), at(circle(rOf(y1 - 2) + 0.8, 24), y1 - 1.6), at(circle(rOf(y1) + 0.8, 24), y1)], { smooth: false, capTop: true });
  }
  // the pinnacle
  b.set(PLAIN([0.55, 0.57, 0.60], 0.5, { glow: [0.30, 0.32, 0.38] }));
  b.loft([[316, 6.5], [322, 4], [326, 2.5], [H, 0.4]].map(([y, r]) => at(circle(r, 12), y)), { smooth: true });
  // the podium: a low base along each wing, wider than it, to the tips
  b.set(GLASS([0.50, 0.49, 0.46], 4.5, 3.0, 0.4, 0.15));
  for (let w = 0; w < 3; w++) b.loft([at(rotRing([[20, 0], [20, TIP - 4], [-20, TIP - 4], [-20, 0]], w * 120 * DEG), 0), at(rotRing([[20, 0], [20, TIP - 4], [-20, TIP - 4], [-20, 0]], w * 120 * DEG), 10)]);
  b.light([0, H, 0], 1);
  for (let w = 0; w < 3; w++) {
    const a = w * 120 * DEG, pt = (d) => [-d * Math.sin(a), d * Math.cos(a)];      // along the wing (as rotRing turns it)
    for (const y of [290, 200, 120, TIP_H]) { const [x, n] = pt(reach(y) - 0.5); b.light([x, y + 0.5, n], y === 290 ? 1 : 0); }
  }
  return b.result();
}

// The Juche Tower (Pyongyang): 170 m, a four-sided tapering 150 m spire of white stone (OSM: its plan
// a square with deep recessed corners, about 18.5 m across at the foot, the faces 10.3 m, to about
// 9 m across at 145 m), a small platform at its top and a 20 m torch whose flame is lit at night,
// on a 59 m square terrace (OSM). Local north along the terrace's side (grid bearing about 13°).
export function juche(brg = 13) {
  const b = new Builder(0.83).frame(0, 0, brg);
  const H = 170, SPIRE = 148;
  // the plan at half-side a: a cross whose arms are (a - n) wide either side, the corners recessed by n
  const plan = (a) => {
    const n = a * 0.44, c = a - n;
    return [[a, -c], [a, c], [c, c], [c, a], [-c, a], [-c, c], [-a, c], [-a, -c], [-c, -c], [-c, -a], [c, -a], [c, -c]];
  };
  const half = (y) => lerp(9.25, 4.4, (y / SPIRE) ** 1.15);
  const stone = PLAIN([0.70, 0.68, 0.62], 0.08, { glow: [0.30, 0.28, 0.22] });
  // the terrace and the spire's foot
  b.set(PLAIN([0.56, 0.55, 0.52], 0.05, { glow: [0.10, 0.10, 0.09] }));
  b.loft([at(roundedRect(29.5, 29.5, 1, 1), 0), at(roundedRect(29.5, 29.5, 1, 1), 5)]);
  b.set(stone);
  b.loft([at(scaleRing(plan(11.5), 1), 5), at(plan(11.5), 9), at(plan(9.6), 9.5)], { capTop: false });
  const secs = [];
  for (let k = 0; k <= 10; k++) { const y = lerp(9.5, SPIRE, k / 10); secs.push(at(plan(half(y)), y)); }
  b.loft(secs, { capTop: true });
  // the platform under the torch
  b.set(PLAIN([0.62, 0.58, 0.48], 0.15, { glow: [0.25, 0.22, 0.12] }));
  b.loft([at(circle(3.6, 12), SPIRE), at(circle(6.2, 12), 149.5), at(circle(6.2, 12), 151.2), at(circle(4.2, 12), 151.8)]);
  // the torch: a flame swelling from its cup and drawn up to a point, lit from inside at night
  b.set(PLAIN([0.80, 0.16, 0.05], 0.3, { glow: [1.35, 0.30, 0.06] }));
  const flame = [[151.8, 3.0], [154, 4.6], [157, 5.5], [160, 5.3], [163, 4.3], [166, 2.6], [168.5, 1.1], [H, 0.15]];
  b.loft(flame.map(([y, r], i) => at(rotRing(superellipse(r, r * 0.92, 2, 16), i * 0.35), y)), { smooth: true });
  b.light([0, H, 0], 1);
  for (const y of [146, 100, 50]) ringLights(b, plan(half(y) + 0.3).filter((_, i) => i % 3 === 0), y, 0);
  return b.result();
}

// The Sapporo TV Tower: 147.2 m to the antenna, the observation deck at 90.38 m. A four-legged steel
// lattice in red, straight-tapering from a square about 33 m a side (OSM) at the ground to the deck,
// a glazed deck, a slimmer lattice above it and the antenna; a low building between the legs.
// Local north along the footprint's side (grid bearing about -10°).
export function sapporotv(brg = -10) {
  const b = new Builder(0.39).frame(0, 0, brg);
  const H = 147.2, DECK = 90.4, TOP = 136;
  const w = (y) => (y <= DECK ? 4.6 + 11.9 * (1 - y / DECK) ** 1.35 : lerp(4.6, 1.3, (y - DECK) / (TOP - DECK)));
  const fn = (y) => { const h = w(y); return [[h, h], [-h, h], [-h, -h], [h, -h]]; };
  const RED = [0.66, 0.13, 0.05];
  const paint = PLAIN(RED, 0.3, { glow: [0.95, 0.30, 0.10] });
  const shell = PLAIN(RED.map((v) => v * 0.7), 0.1, { glow: [0.55, 0.16, 0.05] });
  const ys = [];
  for (let y = 0; y < DECK - 0.5; y += Math.max(6.5, w(y) * 0.9)) ys.push(y);
  ys.push(DECK - 4);
  lattice(b, fn, ys, { rv: 1.0, rd: 0.38, rr: 0.45, sides: 4, cross: true, base: paint, shell: () => shell });
  const ym = [];
  for (let k = 0; k <= 6; k++) ym.push(lerp(DECK + 4, TOP, k / 6));
  lattice(b, fn, ym, { rv: 0.55, rd: 0.25, rr: 0.3, sides: 4, cross: true, base: paint, shell: () => shell });
  // the deck: a glazed box round the lattice, its roof and floor slabs
  b.set(GLASS([0.30, 0.32, 0.33], 4.0, 2.0, 0.6, 0.65, { glow: [0.45, 0.35, 0.22] }));
  b.loft([at(chamferRect(7.6, 7.6, 1.2), DECK - 4), at(chamferRect(7.6, 7.6, 1.2), DECK + 4)]);
  b.set(PLAIN([0.40, 0.40, 0.40], 0.2));
  b.loft([at(chamferRect(8.2, 8.2, 1.3), DECK + 4), at(chamferRect(8.2, 8.2, 1.3), DECK + 4.8)]);
  // the antenna
  b.set(paint);
  b.loft([[TOP, 1.4], [TOP + 5, 0.9], [H, 0.25]].map(([y, r]) => at(circle(r, 8), y)), { smooth: true });
  // the building between the legs (three floors)
  b.set(GLASS([0.40, 0.39, 0.36], 4.2, 3.0, 0.4, 0.4));
  b.loft([at(chamferRect(13.5, 13.5, 2), 0), at(chamferRect(13.5, 13.5, 2), 13)]);
  b.light([0, H, 0], 1);
  for (const y of [TOP, DECK + 5, 45]) ringLights(b, fn(y), y, 0);
  return b.result();
}

// The Sendai Daikannon: a 100 m white statue of a standing bodhisattva, 92 m of figure on an 8 m
// pedestal, on its hill north-west of the city. Massing only: a robed column that tapers a little to
// the waist and widens to the shoulders, the neck and a rounded head with a low crown; no face, hands
// or folds. Local north: the way it faces [EST: towards the city, south-east].
export function daikannon(brg = 135) {
  const b = new Builder(0.55).frame(0, 0, brg);
  const H = 100, PED = 8;
  const white = PLAIN([0.74, 0.74, 0.71], 0.12, { glow: [0.42, 0.42, 0.44] });
  // the pedestal: an octagonal hall about 39 m across (OSM), its sides north, south, east and west
  b.set(PLAIN([0.55, 0.54, 0.51], 0.05, { glow: [0.12, 0.12, 0.12] }));
  b.loft([at(circle(21, 8, Math.PI / 8), 0), at(circle(21, 8, Math.PI / 8), PED - 1.5), at(circle(18.5, 8, Math.PI / 8), PED)]);
  // the figure: elliptical sections [y, half width (shoulders' axis, x), half depth (n), forward shift]
  b.set(white);
  const S = [[PED, 10.5, 8.5, 0], [PED + 3, 10.0, 8.0, 0], [24, 8.9, 7.0, 0.3], [44, 8.2, 6.4, 0.5], [60, 8.6, 6.2, 0.6],
    [72, 10.0, 6.4, 0.4], [79, 11.0, 6.4, 0], [82.5, 10.4, 6.0, 0], [85, 7.0, 4.6, 0], [86.5, 3.4, 3.4, 0]];
  b.loft(S.map(([y, a, d, f]) => at(shift(superellipse(a, d, 2.3, 24), 0, f), y)), { smooth: true, capTop: false });
  // the neck and the head (an ellipsoid about 11 m tall), the crown's low dome on it
  const HEAD_C = 93.5, HA = 4.3, HV = 5.6;
  const head = [[86.5, 3.0], [88, 3.0]];
  for (let k = 1; k <= 9; k++) { const t = -1 + (k / 10) * 2, y = HEAD_C + HV * t; head.push([y, Math.max(HA * Math.sqrt(1 - t * t), 0.6)]); }
  head.push([HEAD_C + HV * 0.98, 1.2]);
  b.loft(head.map(([y, r]) => at(superellipse(r, r * 1.05, 2, 16), y)).filter((s, i, A) => i === 0 || s[0][1] > A[i - 1][0][1]), { smooth: true });
  b.loft([[HEAD_C + 2.5, 2.4], [HEAD_C + 5.0, 2.6], [H - 0.6, 1.6], [H, 0.3]].map(([y, r]) => at(circle(r, 12), y)), { smooth: true });
  b.light([0, H, 0], 0);
  for (const sx of [-1, 1]) b.light([sx * 11.2, 79, 0], 0);
  return b.result();
}

export const MODELS = { lotte, b63, nseoul, parc1, shtower, swfc, jinmao, pearl, skytree, tokyotower, azabudai, tmg, ylmt, lct, neatt, harukas, umeda, fktower, fkdome,
  citic, cctv, russky, zolotoy, cctvtower, tjtower, lntower, ryugyong, juche, sapporotv, daikannon };

// ================================================================== v0.7.0: Europe (briefs/V0-7-0.md Part 6)
// The same rules: our own massing from public figures (heights, plans, the shapes everyone knows),
// no logos, lettering or names, nothing copied. Their own map (EUROPE_MODELS) beside East Asia's.

const STONE = [0.64, 0.61, 0.53], PORTLAND = [0.67, 0.65, 0.59], LIMESTONE = [0.68, 0.63, 0.52], TRAVERTINE = [0.68, 0.61, 0.48];
const LEAD = [0.34, 0.36, 0.38], SLATE = [0.30, 0.31, 0.33], BRICK = [0.47, 0.27, 0.18], TILES = [0.50, 0.25, 0.16], COPPER = [0.30, 0.47, 0.41];
const FLOOD = [0.42, 0.32, 0.18];             // a monument's warm floodlights at night
const flood = (k = 1) => FLOOD.map((v) => v * k);

// A gable roof over a box: the ridge along n (alongX: along x), y0 the eaves, y1 the ridge.
function gable(b, x, n, y0, y1, hx, hn, alongX = false) {
  const base = [[hx, -hn], [hx, hn], [-hx, hn], [-hx, -hn]];
  const ridge = alongX ? [[hx, -0.3], [hx, 0.3], [-hx, 0.3], [-hx, -0.3]] : [[0.3, -hn], [0.3, hn], [-0.3, hn], [-0.3, -hn]];
  b.loft([at(shift(base, x, n), y0), at(shift(ridge, x, n), y1)]);
}
// A round profile [[y, r], ...] about (x, n).
function profile(b, x, n, pts, k = 16, smooth = true, capTop = true) {
  b.loft(pts.map(([y, r]) => at(shift(circle(r, k), x, n), y)), { smooth, capTop });
}
// A hemispherical (h: its height) dome from y0, radius r.
function domeAt(b, x, n, y0, r, h, k = 16, rings = 5) {
  const pts = [];
  for (let i = 0; i <= rings; i++) { const a = (i / rings) * Math.PI / 2; pts.push([y0 + h * Math.sin(a), Math.max(r * Math.cos(a), 0.4)]); }
  profile(b, x, n, pts, k);
}
// A vertical wall strip along local [x, n] points (closed: round to the first), facing away from
// the plan's centre (outward) or towards it; u along the strip for the facade's bays.
function strip(b, pts, y0, y1, outward = true, closed = true) {
  const m = closed ? pts.length : pts.length - 1;
  let u = 0;
  for (let i = 0; i < m; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const a = b.T([p[0], y0, p[1]]), c = b.T([q[0], y0, q[1]]), d = b.T([q[0], y1, q[1]]), e = b.T([p[0], y1, p[1]]);
    const mx = (p[0] + q[0]) / 2, mn = (p[1] + q[1]) / 2, ym = (y0 + y1) / 2;
    const inside = outward ? b.T([0, ym, 0]) : b.T([mx * 2, ym, mn * 2]);
    b.tri(a, c, d, inside, null, null, null, u, u + l, u + l);
    b.tri(a, d, e, inside, null, null, null, u, u + l, u);
    u += l;
  }
}
// A flat ring (facing up) between two point lists of the same count at height y.
function annulus(b, outer, inner, y, closed = true) {
  const m = closed ? outer.length : outer.length - 1;
  for (let i = 0; i < m; i++) {
    const i1 = (i + 1) % outer.length;
    const o0 = b.T([outer[i][0], y, outer[i][1]]), o1 = b.T([outer[i1][0], y, outer[i1][1]]);
    const n0 = b.T([inner[i][0], y, inner[i][1]]), n1 = b.T([inner[i1][0], y, inner[i1][1]]);
    const below = [(o0[0] + n1[0]) / 2, y - 1, (o0[2] + n1[2]) / 2];
    b.tri(o0, o1, n1, below); b.tri(o0, n1, n0, below);
  }
}
// A slender tapering spire (k sides) from y0 to y1.
const spire = (b, x, n, y0, y1, r, k = 8) => cyl(b, x, n, y0, y1, r, 0.15, k);

// ------------------------------------------------------------------ London

// The Shard: 309.6 m. A slender glass pyramid of eight facets on a plan about 58 x 48 m, tapering
// to a point; the facets part near the top into separate shards round an open crown.
export function shard(brg = 0) {
  const b = new Builder(0.52).frame(0, 0, brg);
  const H = 309.6, TOP = 286;
  const hw = (y) => 29 * (1 - 0.87 * (y / TOP));
  b.set(GLASS([0.40, 0.45, 0.50], 3.9, 1.5, 0.92, 0.25));
  const secs = [];
  for (let k = 0; k <= 12; k++) { const y = (TOP * k) / 12, w = hw(y); secs.push(at(chamferRect(w, w * 0.82, w * 0.34), y)); }
  b.loft(secs, { capTop: false });
  // the crown: the facets' tips carried on past the roof as separate shards, lit at night
  b.set(GLASS([0.48, 0.52, 0.56], 3.9, 1.5, 0.8, 0, { glow: [0.30, 0.33, 0.40] }));
  const w0 = hw(250);
  for (const [x, n] of [[w0, 0], [-w0, 0], [0, w0 * 0.82], [0, -w0 * 0.82]]) b.member([x, 250, n], [x * 0.12, H - 0.8, n * 0.12], 0.8, 4);
  b.loft([at(chamferRect(hw(TOP), hw(TOP) * 0.82, hw(TOP) * 0.34), TOP), at(chamferRect(0.6, 0.5, 0.2), H - 6)]);
  b.light([0, H, 0], 1);
  for (const y of [250, 170, 90]) { const w = hw(y); ringLights(b, [[w, 0], [-w, 0], [0, w * 0.82], [0, -w * 0.82]], y, 0); }
  return b.result();
}

// The Palace of Westminster with the Elizabeth Tower: the palace about 265 m along the river (local
// n), the Elizabeth Tower (96 m: the clock stage at about 55-62 m, lit at night, the belfry, the
// spire) at its north end, the Victoria Tower (98.5 m) at the south, the Central Tower (91 m) between.
export function westminster(brg = 10) {
  const b = new Builder(0.62).frame(0, 0, brg);
  const stone = GLASS([0.60, 0.54, 0.40], 6.0, 4.0, 0.15, 0.25, { glow: flood(0.8) });
  b.set(stone);
  box(b, 0, 0, 0, 24, 34, 120);
  box(b, -20, -60, 0, 24, 18, 40);            // the courts behind
  b.set(PLAIN(SLATE, 0.2));
  gable(b, 0, 0, 24, 33, 34, 120);
  // the pinnacles along the river front and the courts' ranges
  b.set(PLAIN([0.58, 0.52, 0.39], 0.1, { glow: flood(0.6) }));
  for (let k = 0; k < 13; k++) for (const x of [33, -33]) spire(b, x, -114 + k * 19, 24, 31, 1.0, 4);
  // the Central Tower: an octagon and its spire
  b.set(stone);
  cyl(b, 0, 10, 24, 66, 7, 6, 8);
  b.set(PLAIN(SLATE, 0.2, { glow: flood(0.6) }));
  spire(b, 0, 10, 66, 91, 6, 8);
  // the Elizabeth Tower
  const EX = 5, EN = 133;
  b.set(stone);
  box(b, EX, EN, 0, 55, 6, 6);
  b.set(PLAIN([0.66, 0.60, 0.46], 0.2, { glow: [0.95, 0.80, 0.45] }));     // the four lit dials
  box(b, EX, EN, 55, 62.5, 6.8, 6.8);
  b.set(stone);
  box(b, EX, EN, 62.5, 72, 5.5, 5.5);
  b.set(PLAIN(SLATE, 0.25, { glow: flood(0.7) }));
  b.loft([at(shift(chamferRect(5.5, 5.5, 1.2), EX, EN), 72), at(shift(chamferRect(2.5, 2.5, 0.6), EX, EN), 86), at(shift(chamferRect(0.3, 0.3, 0.1), EX, EN), 96)]);
  // the Victoria Tower and its corner pinnacles
  const VX = -5, VN = -128;
  b.set(stone);
  box(b, VX, VN, 0, 88, 11.5, 11.5);
  for (const [dx, dn] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) { cyl(b, VX + dx * 10, VN + dn * 10, 88, 93, 1.6, 1.4, 6); spire(b, VX + dx * 10, VN + dn * 10, 93, 98.5, 1.4, 6); }
  return b.result();
}

// The London Eye: 135 m, the rim about 120 m across on its hub, 32 lit capsules outside the rim,
// carried from the land side on an A-frame. The wheel in the local n-y plane.
export function eye(brg = 25) {
  const b = new Builder(0.71).frame(0, 0, brg);
  const HUB = 73.5, R = 58, K = 32;
  const P = (r, t) => [0, HUB + r * Math.sin(t), r * Math.cos(t)];
  b.set(PLAIN([0.72, 0.73, 0.74], 0.4, { glow: [0.20, 0.30, 0.55] }));
  for (let i = 0; i < K; i++) {
    const t0 = (i / K) * TAU, t1 = ((i + 1) / K) * TAU;
    b.member(P(R, t0), P(R, t1), 1.3, 4);
    b.member(P(R - 4, t0), P(R - 4, t1), 0.6, 4);
    if (i % 2 === 0) b.member(P(R, t0), P(R - 4, t1), 0.35, 3);
  }
  for (let i = 0; i < 16; i++) { const t = (i / 16) * TAU; b.member([0, HUB, 0], P(R - 4, t), 0.25, 3); }
  b.member([-4, HUB, 0], [4, HUB, 0], 3, 8);
  // the A-frame's two legs from the land side
  for (const s of [-1, 1]) b.member([34, 0, s * 20], [3, HUB, 0], 1.6, 6);
  // the capsules
  b.set(GLASS([0.55, 0.60, 0.65], 3.0, 2.0, 0.8, 0.9, { glow: [0.40, 0.45, 0.60] }));
  for (let i = 0; i < K; i++) {
    const t = ((i + 0.5) / K) * TAU, r = R + 1.8, y = HUB + r * Math.sin(t), n = r * Math.cos(t);
    box(b, 0, n, y - 1.5, y + 1.5, 1.6, 1.6, 0, { capBottom: true });
  }
  b.light([0, HUB + R + 1.3, 0], 0);
  return b.result();
}

// St Paul's Cathedral: 111 m to the cross. The nave and choir about 158 m long (local x, east), the
// transepts; the dome on its colonnaded drum, the lantern, the ball and cross; two west towers.
export function stpauls(brg = 0) {
  const b = new Builder(0.33).frame(0, 0, brg);
  const stone = GLASS(PORTLAND, 7.0, 3.2, 0.0, 0.0, { glow: flood() });
  b.set(stone);
  box(b, -5, 0, 0, 30, 74, 18);
  box(b, 0, 0, 0, 30, 16, 37);
  box(b, -79, 0, 0, 26, 2, 14);                // the west portico
  b.set(PLAIN(LEAD, 0.3));
  gable(b, -5, 0, 30, 36, 74, 18, true);
  gable(b, 0, 0, 30, 36, 16, 37);
  b.set(stone);
  cyl(b, 0, 0, 30, 53, 23, 23, 24);           // the peristyle
  cyl(b, 0, 0, 53, 64, 18.5, 18.5, 24);       // the attic drum
  b.set(PLAIN([0.40, 0.42, 0.43], 0.35, { glow: flood(0.8) }));
  domeAt(b, 0, 0, 64, 18.5, 28, 24, 6);
  b.set(stone);
  cyl(b, 0, 0, 91.5, 104, 4, 3.4, 8);          // the lantern
  b.set(PLAIN([0.70, 0.60, 0.35], 0.7, { glow: flood(1.2) }));
  cyl(b, 0, 0, 104, 108, 3.4, 0.8, 8);
  cyl(b, 0, 0, 108, 111, 0.7, 0.2, 6);
  // the west towers
  b.set(stone);
  for (const s of [-1, 1]) {
    box(b, -72, s * 15, 0, 45, 6, 6);
    cyl(b, -72, s * 15, 45, 60, 4.5, 4.0, 8);
    b.set(PLAIN(LEAD, 0.3)); domeAt(b, -72, s * 15, 60, 4.0, 5, 8, 3); b.set(stone);
    spire(b, -72, s * 15, 64.5, 69, 0.8, 6);
  }
  return b.result();
}

// Tower Bridge: the two towers about 65 m (local n along the bridge, from the river at y 0), the
// bascules between them, the high walkways at about 42 m, the side spans hung from chains to the
// shore towers. Stone towers floodlit at night, the steel painted blue and white.
export function towerbridge(brg = 0) {
  const b = new Builder(0.19).frame(0, 0, brg);
  const TN = 40.5, DECK = 9, END = 120;
  const stone = GLASS([0.62, 0.58, 0.48], 6.0, 3.0, 0.1, 0.2, { glow: flood(0.9) });
  const blue = PLAIN([0.36, 0.52, 0.66], 0.35, { glow: [0.10, 0.16, 0.24] });
  for (const s of [-1, 1]) {
    const n = s * TN;
    b.set(PLAIN([0.42, 0.40, 0.36], 0.1));
    box(b, 0, n, 0, 6, 14, 18);                // the pier
    b.set(stone);
    box(b, 0, n, 6, 52, 10, 9);
    b.set(PLAIN(SLATE, 0.2, { glow: flood(0.5) }));
    gable(b, 0, n, 52, 58, 8, 7);
    b.set(stone);
    for (const [dx, dn] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) { cyl(b, dx * 9.5, n + dn * 8, 6, 55, 2.2, 2.2, 8); b.set(PLAIN(SLATE, 0.2, { glow: flood(0.5) })); spire(b, dx * 9.5, n + dn * 8, 55, 65, 2.2, 8); b.set(stone); }
  }
  b.set(blue);
  for (const s of [-1, 1]) box(b, s * 6, 0, 41, 45, 1.8, TN - 9, 0, { capBottom: true });                 // the walkways
  b.set(PLAIN([0.30, 0.30, 0.31], 0.1));
  box(b, 0, 0, DECK, DECK + 2, 8, TN - 9, 0, { capBottom: true });                                         // the bascules
  for (const s of [-1, 1]) box(b, 0, s * (TN + 9 + END) / 2, DECK, DECK + 2, 8, (END - TN - 9) / 2, 0, { capBottom: true });
  // the chains, from each tower's top down to the deck and up to the shore tower
  b.set(blue);
  for (const s of [-1, 1]) for (const sx of [-1, 1]) {
    const pts = [];
    for (let k = 0; k <= 6; k++) { const t = k / 6, n = lerp(TN + 9, END - 4, t); pts.push([sx * 7.5, 40 - 34 * Math.sin(Math.PI * t * 0.85) + 18 * t * t, s * n]); }
    for (let k = 0; k < 6; k++) b.member(pts[k], pts[k + 1], 0.7, 4);
  }
  b.set(stone);
  for (const s of [-1, 1]) box(b, 0, s * (END - 4), 0, 24, 8, 4);
  return b.result();
}

// ------------------------------------------------------------------ Paris

// The Eiffel Tower: 330 m to the antenna. Four lattice legs from a square 125 m a side, an arch on
// each face under the first floor (57 m), meeting at the second floor (115 m), the lattice shaft
// to the top floor (276 m) and the antenna. Bronze paint, gold-lit at night.
export function eiffel(brg = 46) {
  const b = new Builder(0.88).frame(0, 0, brg);
  const H = 330, TOP = 276;
  const w = (y) => 3 + 59.5 * Math.exp(-y / 75);
  const s = (y) => lerp(7.5, 5, Math.min(y / 115, 1));
  const BRONZE = [0.36, 0.27, 0.19], GOLD = [0.95, 0.60, 0.22];
  const paint = PLAIN(BRONZE, 0.25, { glow: GOLD.map((v) => v * 0.75) });
  // the legs: solid, with the lattice's openings as a pattern
  b.set({ ...paint, fac: [5.0, 2.5, 0.0, 0.0] });
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const secs = [0, 20, 40, 57, 80, 100, 116].map((y) => { const c = w(y) - s(y); return at(shift(rotRing([[s(y), -s(y)], [s(y), s(y)], [-s(y), s(y)], [-s(y), -s(y)]], 0), sx * c, sz * c), y); });
    b.loft(secs, { capTop: false });
  }
  // the arches under the first floor
  b.set(paint);
  for (let f = 0; f < 4; f++) {
    const rot = (f * Math.PI) / 2, pts = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8, y = 6 + 33 * Math.sin(Math.PI * t), c = w(y) - s(y) * 1.6;
      const x = lerp(-1, 1, t) * c, n = w(y) * 0.97;
      pts.push([x * Math.cos(rot) - n * Math.sin(rot), y, x * Math.sin(rot) + n * Math.cos(rot)]);
    }
    for (let k = 0; k < 8; k++) b.member(pts[k], pts[k + 1], 0.9, 4);
  }
  // the first and second floors
  const w1 = w(57);
  for (let f = 0; f < 4; f++) {
    const r = [[0, w1 - 3, w1, 3], [0, -(w1 - 3), w1, 3], [w1 - 3, 0, 3, w1 - 6], [-(w1 - 3), 0, 3, w1 - 6]][f];
    box(b, r[0], r[1], 57, 64, r[2], r[3], 0, { capBottom: true });
  }
  box(b, 0, 0, 115, 121, w(115) + 1, w(115) + 1, 0, { capBottom: true });
  // the shaft: a lattice to the top floor, its far stand-in a shell
  const ys = [];
  for (let k = 0; k <= 10; k++) ys.push(lerp(121, TOP, k / 10));
  const sq = (y) => { const h = w(y); return [[h, -h], [h, h], [-h, h], [-h, -h]]; };
  lattice(b, sq, ys, { rv: 1.4, rd: 0.5, rr: 0.6, sides: 4, cross: true, base: paint, shell: () => PLAIN(BRONZE.map((v) => v * 0.85), 0.1, { glow: GOLD.map((v) => v * 0.5) }) });
  // the top floor, the mast and the antenna
  b.set(GLASS([0.40, 0.34, 0.26], 3.0, 2.0, 0.5, 0.6, { glow: GOLD.map((v) => v * 0.8) }));
  box(b, 0, 0, TOP, 284, 5.5, 5.5);
  b.set(paint);
  cyl(b, 0, 0, 284, 300, 2.5, 1.8, 8);
  b.set(PLAIN([0.55, 0.55, 0.55], 0.3));
  cyl(b, 0, 0, 300, H, 1.2, 0.25, 6);
  b.light([0, H, 0], 1);
  for (const y of [TOP, 121, 64]) ringLights(b, sq(y), y + 0.5, 0);
  return b.result();
}

// The Arc de Triomphe: 49.54 m high, 44.82 m wide, 22.21 m deep; the great arch 29.19 m high and 14.62 m wide
// through its wide faces (local n: along the avenue), the transverse arches 18.68 x 8.44 m. Floodlit at night.
export function arc(brg = 116) {
  const b = new Builder(0.41).frame(0, 0, brg);
  b.set(PLAIN(LIMESTONE, 0.1, { glow: flood(1.1) }));
  const HX = 22.5, HN = 11, O = 7.3, SPRING = 21.9;
  // the piers, each pierced across by a transverse arch 18.68 m high and 8.44 m wide
  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) box(b, s * (O + HX) / 2, t * (HN + 4.22) / 2, 0, 18.7, (HX - O) / 2, (HN - 4.22) / 2);
    box(b, s * (O + HX) / 2, 0, 18.7, 33, (HX - O) / 2, HN, 0, { capBottom: true });
  }
  // the arch's curve as four steps a side, then the slab over the crown
  for (let k = 0; k < 4; k++) {
    const y0 = SPRING + O * Math.sin((k * Math.PI) / 8), y1 = SPRING + O * Math.sin(((k + 1) * Math.PI) / 8);
    const xi = O * Math.cos(((k + 1) * Math.PI) / 8);
    for (const s of [-1, 1]) box(b, s * (xi + O) / 2, 0, y0, y1, (O - xi) / 2 + 0.01, HN, 0, { capBottom: true });
  }
  box(b, 0, 0, SPRING + O, 33, O, HN, 0, { capBottom: true });
  box(b, 0, 0, 33, 46, HX, HN);
  box(b, 0, 0, 46, 49.54, HX - 0.8, HN - 0.8);   // the attic
  return b.result();
}

// Sacré-Cœur: the dome 83.33 m, the campanile behind it 84 m, on Montmartre. White travertine: the main
// dome on its drum, four small domes round it.
export function sacrecoeur(brg = 0) {
  const b = new Builder(0.36).frame(0, 0, brg);
  const white = PLAIN([0.80, 0.79, 0.74], 0.15, { glow: flood(1.0) });
  b.set({ ...white, fac: [8, 3.5, 0, 0] });
  box(b, 0, -5, 0, 26, 18, 32);
  box(b, 0, 0, 0, 26, 30, 12);
  box(b, 0, -40, 0, 22, 14, 4);               // the portico
  b.set(white);
  profile(b, 0, 0, [[26, 10], [50, 10]], 24, true, false);
  profile(b, 0, 0, [[50, 10.4], [55, 10.8], [61, 10.0], [67, 7.9], [72, 5.0], [75, 2.4]], 24);
  cyl(b, 0, 0, 75, 80, 2.2, 2.0, 8);
  spire(b, 0, 0, 80, 83.3, 2.0, 8);
  for (const [dx, dn] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    cyl(b, dx * 13, dn * 13, 26, 36, 4, 4, 12);
    domeAt(b, dx * 13, dn * 13, 36, 4.2, 6, 12, 3);
    spire(b, dx * 13, dn * 13, 41.5, 45, 0.8, 6);
  }
  for (const dx of [-1, 1]) { domeAt(b, dx * 9, -40, 22, 3.5, 5, 10, 3); }
  // the campanile
  box(b, 0, 34, 0, 55, 6, 6);
  cyl(b, 0, 34, 55, 65, 5, 5, 12);
  domeAt(b, 0, 34, 65, 5.2, 8, 12, 4);
  spire(b, 0, 34, 72.5, 84, 1.0, 6);
  return b.result();
}

// Notre-Dame de Paris: the west front's two flat-topped towers at 69 m, the nave and choir about
// 128 m long (local n, towards the apse), the flying buttresses, the spire over the crossing (96 m,
// rebuilt as it was). Floodlit at night.
export function notredame(brg = 112) {
  const b = new Builder(0.39).frame(0, 0, brg);
  const stone = GLASS([0.66, 0.62, 0.52], 8.0, 3.5, 0.0, 0.15, { glow: flood(0.9) });
  b.set(stone);
  box(b, 0, -5, 0, 33, 12, 50);
  box(b, 0, -5, 0, 20, 24, 50);
  box(b, 0, 8, 0, 33, 24, 7);
  cyl(b, 0, 45, 0, 33, 12, 12, 12, { capTop: false });
  cyl(b, 0, 45, 0, 20, 20, 20, 16);
  box(b, 0, -58, 0, 45, 20, 4);               // the west front
  for (const s of [-1, 1]) box(b, s * 13, -57, 45, 69, 7, 5);
  b.set(PLAIN(LEAD, 0.3));
  gable(b, 0, -5, 33, 43, 12, 50);
  gable(b, 0, 8, 33, 43, 24, 7, true);
  cyl(b, 0, 45, 33, 43, 12, 0.4, 12);
  b.set(stone);
  for (let k = 0; k < 7; k++) for (const s of [-1, 1]) b.member([s * 24, 20, -40 + k * 13], [s * 12.5, 30, -40 + k * 13], 0.7, 4);
  b.set(PLAIN(LEAD, 0.35, { glow: flood(0.7) }));
  cyl(b, 0, 8, 43, 60, 3, 2.2, 8);
  spire(b, 0, 8, 60, 96, 2.2, 8);
  return b.result();
}

// La Grande Arche: a hollow cube 110 m high, 108 m wide and 112 m deep, open along the axis (local
// n); white with a glass grid.
export function grandearche(brg = 122) {
  const b = new Builder(0.44).frame(0, 0, brg);
  b.set(GLASS([0.74, 0.76, 0.76], 3.5, 2.6, 0.45, 0.3, { glow: [0.10, 0.11, 0.13] }));
  for (const s of [-1, 1]) box(b, s * 45, 0, 0, 110, 9, 56);
  box(b, 0, 0, 92, 110, 36, 56, 0, { capBottom: true });
  b.set(PLAIN([0.70, 0.70, 0.68], 0.1));
  box(b, 0, 0, 0, 7, 36, 56);
  b.light([0, 110, 0], 0);
  return b.result();
}

// ------------------------------------------------------------------ Frankfurt

// The Commerzbank Tower: 258.7 m to the roof (its antenna, to 300 m, not modelled). A triangle with rounded
// corners and gently convex sides, about 60 m a side; the crown lit at night (white: no company's colour).
export function commerzbank(brg = 0) {
  const b = new Builder(0.57).frame(0, 0, brg);
  const H = 258.7, ROOF = 248;
  const tri = (s) => { const out = []; for (let i = 0; i < 24; i++) { const t = (i / 24) * TAU + Math.PI / 2; const r = (26 + 8.6 * Math.cos(3 * (t - Math.PI / 2))) * s; out.push([r * Math.cos(t), r * Math.sin(t)]); } return out; };
  b.set(GLASS([0.34, 0.39, 0.38], 3.7, 2.7, 0.85, 0.28));
  b.loft([0, 80, 160, ROOF].map((y) => at(tri(1), y)), { smooth: false, capTop: false });
  b.set(GLASS([0.40, 0.42, 0.44], 3.7, 2.0, 0.6, 0, { glow: [0.50, 0.50, 0.48] }));
  b.loft([at(tri(1), ROOF), at(tri(0.9), 254), at(tri(0.35), H)]);
  b.light([0, H, 0], 1);
  for (const y of [ROOF, 160, 80]) ringLights(b, tri(1.0).filter((_, i) => i % 8 === 0), y, 0);
  return b.result();
}

// The Messeturm: 256.5 m. A square shaft of red granite and glass, about 41 m a side, rising into
// a cylinder and capped by a pyramid, which is lit at night.
export function messeturm(brg = 0) {
  const b = new Builder(0.63).frame(0, 0, brg);
  const H = 256.5;
  b.set(GLASS([0.46, 0.27, 0.21], 3.75, 2.5, 0.45, 0.28));
  b.loft([0, 100, 200].map((y) => at(roundedRect(20.5, 20.5, 3, 2), y)), { capTop: true });
  b.set(GLASS([0.30, 0.33, 0.36], 3.75, 2.0, 0.85, 0.28));
  cyl(b, 0, 0, 200, 222, 17, 17, 24);
  b.set(PLAIN([0.42, 0.26, 0.20], 0.3, { glow: [0.55, 0.48, 0.36] }));
  b.loft([at(chamferRect(15, 15, 2), 222), at(chamferRect(0.3, 0.3, 0.1), H)]);
  b.light([0, H, 0], 1);
  ringLights(b, [[17, 0], [-17, 0], [0, 17], [0, -17]], 222, 0);
  ringLights(b, [[20.5, 20.5], [-20.5, 20.5], [-20.5, -20.5], [20.5, -20.5]], 150, 0);
  return b.result();
}

// The Europaturm: 337.5 m, a concrete telecommunications tower with a wide pod (about 59 m across,
// its heights [EST]) and the mast.
export function europaturm() {
  const b = new Builder(0.66);
  tvTower(b, { H: 337.5, r0: 9.5, r1: 6, podY0: 200, pod: [[200, 6], [208, 22], [214, 29.5], [226, 29.5], [230, 25], [236, 9]],
    shaftTop: 262, shaftR: 5, mastR: 2.5, bands: 6 });
  return b.result();
}

// ------------------------------------------------------------------ Madrid: the four towers and Caleido

// Torre Cepsa: 248.3 m. Two concrete cores at its sides joined at the top by a frame, the glass
// between them stopping short of it: an opening under the top.
export function cepsa(brg = 0) {
  const b = new Builder(0.68).frame(0, 0, brg);
  const H = 248.3;
  b.set(PLAIN([0.64, 0.64, 0.62], 0.15, { glow: [0.18, 0.18, 0.20] }));
  for (const s of [-1, 1]) box(b, s * 20, 0, 0, H, 6, 20);
  box(b, 0, 0, 232, H, 14, 20, 0, { capBottom: true });
  b.set(GLASS([0.30, 0.34, 0.38], 4.0, 2.5, 0.85, 0.26));
  box(b, 0, 0, 0, 212, 14, 19);
  for (const s of [-1, 1]) b.light([s * 26, H, 0], 1);
  for (const y of [212, 140, 70]) ringLights(b, [[26, 20], [-26, 20], [-26, -20], [26, -20]], y, 0);
  return b.result();
}

// Torre PwC: 236 m. A rounded three-lobed plan, glass, under a tall crown, lit at night.
export function pwc(brg = 0) {
  const b = new Builder(0.69).frame(0, 0, brg);
  const H = 236, ROOF = 205;
  const plan = (s) => { const out = []; for (let i = 0; i < 24; i++) { const t = (i / 24) * TAU, r = (21 + 2.5 * Math.cos(3 * t)) * s; out.push([r * Math.cos(t), r * Math.sin(t)]); } return out; };
  b.set(GLASS([0.30, 0.36, 0.34], 3.9, 2.6, 0.85, 0.26));
  b.loft([0, 100, ROOF].map((y) => at(plan(1), y)), { smooth: true });
  b.set(PLAIN([0.55, 0.60, 0.58], 0.3, { glow: [0.30, 0.42, 0.36] }));
  b.loft([at(plan(1), ROOF), at(plan(1.04), H)], { capTop: false, smooth: true });
  b.flip = true;
  b.loft([at(plan(0.9), ROOF), at(plan(0.94), H)], { capTop: false, smooth: true });
  b.flip = false;
  b.light([0, H, 21], 1); b.light([0, H, -21], 1);
  for (const y of [ROOF, 130, 60]) ringLights(b, plan(1).filter((_, i) => i % 8 === 0), y, 0);
  return b.result();
}

// Torre de Cristal: 249 m. A square plan whose corners are cut more and more on the way up; a
// glass garden lit at the top.
export function cristal(brg = 0) {
  const b = new Builder(0.72).frame(0, 0, brg);
  const H = 249, ROOF = 228;
  b.set(GLASS([0.36, 0.42, 0.46], 4.0, 2.5, 0.92, 0.26));
  b.loft([0, 60, 120, 180, ROOF].map((y) => at(chamferRect(22, 22, lerp(2, 12, y / ROOF)), y)), { capTop: false });
  b.set(GLASS([0.40, 0.48, 0.42], 4.0, 2.0, 0.7, 0, { glow: [0.32, 0.42, 0.34] }));
  b.loft([at(chamferRect(22, 22, 12), ROOF), at(chamferRect(19, 19, 11), H)]);
  b.light([0, H, 0], 1);
  for (const y of [ROOF, 150, 75]) ringLights(b, [[22, 0], [-22, 0], [0, 22], [0, -22]], y, 0);
  return b.result();
}

// Torre Emperador Castellana (formerly Torre Espacio): 230 m. A square at the foot, two convex arcs
// meeting in points at the top.
export function emperador(brg = 0) {
  const b = new Builder(0.74).frame(0, 0, brg);
  const H = 230, ROOF = 220;
  const sec = (t) => superellipse(lerp(20, 24, t), lerp(20, 12, t), lerp(10, 1.7, t), 24);
  b.set(GLASS([0.30, 0.33, 0.37], 4.0, 2.5, 0.88, 0.26));
  b.loft([0, 0.25, 0.5, 0.75, 1].map((t) => at(sec(t), t * ROOF)), { capTop: false });
  b.set(GLASS([0.38, 0.40, 0.44], 4.0, 2.0, 0.6, 0, { glow: [0.30, 0.32, 0.38] }));
  b.loft([at(sec(1), ROOF), at(scaleRing(sec(1), 0.96), H)]);
  b.light([24, H, 0], 1); b.light([-24, H, 0], 1);
  for (const y of [150, 75]) ringLights(b, sec(y / ROOF).filter((_, i) => i % 6 === 0), y, 0);
  return b.result();
}

// Caleido: 181 m. A tall slab of glass under an open frame at the top.
export function caleido(brg = 0) {
  const b = new Builder(0.77).frame(0, 0, brg);
  const H = 181, ROOF = 165;
  b.set(GLASS([0.34, 0.37, 0.40], 4.0, 2.5, 0.85, 0.26));
  box(b, 0, 0, 0, ROOF, 28, 11);
  b.set(PLAIN([0.66, 0.66, 0.64], 0.2, { glow: [0.25, 0.25, 0.27] }));
  for (const s of [-1, 1]) { box(b, s * 27, 0, ROOF, H, 1, 11); box(b, 0, s * 10, ROOF, H, 26, 1); }
  b.light([27, H, 10], 1); b.light([-27, H, -10], 1);
  ringLights(b, [[28, 11], [-28, -11], [28, -11], [-28, 11]], 100, 0);
  return b.result();
}

// The Puerta de Europa: two towers of 114 m on either side of the avenue (local n), each leaning
// 15 degrees towards the other.
export function kio(brg = 0) {
  const b = new Builder(0.79).frame(0, 0, brg);
  const H = 114, X0 = 55, S = 17, lean = Math.tan(15 * DEG);
  for (const s of [-1, 1]) {
    b.set(GLASS([0.28, 0.29, 0.31], 3.8, 2.8, 0.8, 0.3));
    const sq = (y) => shift([[S, -S], [S, S], [-S, S], [-S, -S]], s * (X0 - lean * y), 0);
    b.loft([0, H / 2, H - 4].map((y) => at(sq(y), y)), { capTop: true });
    b.set(PLAIN([0.55, 0.20, 0.16], 0.3, { glow: [0.35, 0.12, 0.10] }));
    b.loft([at(sq(H - 4), H - 4), at(sq(H), H)], { capTop: true });
    b.light([s * (X0 - lean * H), H, 0], 1);
  }
  return b.result();
}

// ------------------------------------------------------------------ Zurich

// The Grossmünster: twin towers of 64 m with domed tops at the west end of the nave (local n east).
export function grossmunster(brg = 90) {
  const b = new Builder(0.81).frame(0, 0, brg);
  const stone = GLASS([0.64, 0.59, 0.49], 8.0, 3.0, 0.0, 0.1, { glow: flood(0.9) });
  b.set(stone);
  box(b, 0, 5, 0, 22, 11, 25);
  box(b, 0, 34, 0, 18, 8, 5);
  b.set(PLAIN(SLATE, 0.2));
  gable(b, 0, 5, 22, 32, 11, 25);
  gable(b, 0, 34, 18, 26, 8, 5);
  for (const s of [-1, 1]) {
    b.set(stone);
    box(b, s * 7.5, -24, 0, 48, 4.5, 4.5);
    cyl(b, s * 7.5, -24, 48, 56, 4, 4, 8);
    b.set(PLAIN([0.36, 0.33, 0.32], 0.3, { glow: flood(0.5) }));
    domeAt(b, s * 7.5, -24, 56, 4, 5.5, 8, 3);
    spire(b, s * 7.5, -24, 61.3, 64, 0.6, 6);
  }
  return b.result();
}

// The Prime Tower: 126 m. An irregular octagon of green glass, a little wider at the top.
export function primetower(brg = 15) {
  const b = new Builder(0.83).frame(0, 0, brg);
  const H = 126;
  b.set(GLASS([0.30, 0.38, 0.36], 3.6, 2.7, 0.9, 0.3));
  b.loft([[0, 20, 14, 6], [60, 21.5, 15, 6.5], [H, 23, 16, 7]].map(([y, hx, hn, c]) => at(chamferRect(hx, hn, c), y)));
  b.light([0, H, 0], 1);
  return b.result();
}

// ------------------------------------------------------------------ Munich

// The Olympiaturm: 291 m. A concrete shaft, the pod with its decks and the restaurant at about
// 182-192 m, the mast.
export function olympiaturm() {
  const b = new Builder(0.85);
  tvTower(b, { H: 291, r0: 8.5, r1: 5.5, podY0: 172, pod: [[172, 5.5], [177, 14], [182, 15.5], [193, 15.5], [196, 12], [199, 6]],
    shaftTop: 226, shaftR: 4.5, mastR: 2.2, bands: 6 });
  return b.result();
}

// The Frauenkirche: twin brick towers of about 98.5 m, square turning octagonal, under green onion
// domes, at the west end of the hall church and its great roof (local n east).
export function frauenkirche(brg = 90) {
  const b = new Builder(0.87).frame(0, 0, brg);
  const brick = GLASS(BRICK, 8.0, 4.0, 0.0, 0.1, { glow: flood(0.8) });
  b.set(brick);
  box(b, 0, 5, 0, 37, 20, 48);
  b.set(PLAIN(TILES, 0.15));
  gable(b, 0, 5, 37, 68, 20, 48);
  for (const s of [-1, 1]) {
    b.set(brick);
    box(b, s * 11.5, -50, 0, 64, 6.5, 6.5);
    cyl(b, s * 11.5, -50, 64, 76, 6, 6, 8);
    b.set(PLAIN(COPPER, 0.35, { glow: flood(0.5) }));
    profile(b, s * 11.5, -50, [[76, 6], [80, 7.2], [85, 6.5], [89, 4], [92, 1.6], [94, 1.0]], 12);
    spire(b, s * 11.5, -50, 94, 98.5, 1.0, 6);
  }
  return b.result();
}

// ------------------------------------------------------------------ Barcelona

// The Sagrada Família: the Tower of Jesus Christ at 172.5 m over the crossing, the Virgin Mary's
// (138 m, its star lit) and the four Evangelists' (135 m) round it, the Nativity's and the
// Passion's four bell towers each (about 98-112 m [EST]); the Glory facade's towers not yet built.
// Local n along the nave towards the apse.
export function sagrada(brg = -45) {
  const b = new Builder(0.89).frame(0, 0, brg);
  const H = 172.5;
  const stone = GLASS([0.62, 0.55, 0.43], 9.0, 4.0, 0.0, 0.2, { glow: flood(0.9) });
  const tower = (x, n, y0, h, r) => {
    profile(b, x, n, [[y0, r], [lerp(y0, h, 0.55), r * 0.92], [lerp(y0, h, 0.85), r * 0.55], [lerp(y0, h, 0.95), r * 0.35]], 8, true, false);
    cyl(b, x, n, lerp(y0, h, 0.95), h, r * 0.42, 0.2, 8);
  };
  b.set(stone);
  box(b, 0, 0, 0, 45, 22, 40);
  box(b, 0, 5, 0, 45, 30, 13);
  cyl(b, 0, 40, 0, 45, 18, 18, 16);
  b.set(PLAIN([0.55, 0.50, 0.42], 0.15));
  gable(b, 0, 0, 45, 60, 22, 40);
  gable(b, 0, 5, 45, 60, 30, 13, true);
  cyl(b, 0, 40, 45, 58, 18, 3, 16);
  b.set(stone);
  const facade = [98, 107, 107, 98], passion = [104, 112, 112, 104];
  [-12, -4, 4, 12].forEach((dn, i) => { tower(31, 5 + dn, 0, facade[i], 3.6); tower(-31, 5 + dn, 0, passion[i], 3.6); });
  for (const [dx, dn] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) tower(dx * 14, 5 + dn * 14, 40, 135, 6.5);
  tower(0, 30, 40, 134, 8);
  b.set(PLAIN([0.85, 0.85, 0.80], 0.5, { glow: [1.0, 0.95, 0.80] }));
  b.sphere([0, 135.5, 30], 2.5, 8, 5);       // Mary's star, lit at night
  b.set(stone);
  profile(b, 0, 5, [[45, 11], [110, 9.5], [150, 6], [163, 3]], 12, true, true);
  // the cross on top, lit at night
  b.set(PLAIN([0.88, 0.88, 0.86], 0.4, { glow: [0.9, 0.9, 0.85] }));
  b.member([0, 162, 5], [0, H - 0.7, 5], 0.7, 4);
  b.member([-3.5, 168, 5], [3.5, 168, 5], 0.6, 4);
  b.member([0, 168, 1.5], [0, 168, 8.5], 0.6, 4);
  b.light([0, H, 5], 1);
  for (const [dx, dn] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) b.light([dx * 14, 135, 5 + dn * 14], 0);
  b.light([0, 138, 30], 0);
  return b.result();
}

// Torre Glòries: 144.4 m. A rounded bullet of glass on an elliptical plan, its skin lit in colours at night.
export function glories(brg = 0) {
  const b = new Builder(0.91).frame(0, 0, brg);
  const H = 144.4, A = 22, Bn = 19, Y1 = 85;
  const f = (y) => (y <= Y1 ? lerp(1, 0.96, y / Y1) : 0.96 * Math.sqrt(Math.max(1 - ((y - Y1) / (H - Y1)) ** 2, 0)));
  b.set(GLASS([0.40, 0.42, 0.46], 3.8, 1.8, 0.8, 0.35, { glow: [0.22, 0.12, 0.34] }));
  const ys = [0, 40, Y1, 100, 112, 122, 131, 137, 141, 143.3, H];
  b.loft(ys.map((y) => at(superellipse(Math.max(A * f(y), 0.6), Math.max(Bn * f(y), 0.5), 2, 24), y)), { smooth: true });
  b.light([0, H, 0], 0);
  return b.result();
}

// The Collserola tower: 288.4 m on the Collserola ridge. A slender concrete shaft, thirteen floors
// on triangular plans with curved sides, guyed to the hill, and the mast (the floors' heights [EST]).
export function collserola(brg = 0) {
  const b = new Builder(0.93).frame(0, 0, brg);
  const H = 288.4, F0 = 108, F1 = 150.6;     // the pod's top at 152 m (Wikipedia)
  b.set(PLAIN(CONCRETE.map((v) => v * 1.15), 0.1));
  cyl(b, 0, 0, 0, F1 + 6, 2.3, 2.1, 8);
  const tri = (s) => { const out = []; for (let i = 0; i < 9; i++) { const t = (i / 9) * TAU + Math.PI / 2; const r = (15 + 6 * Math.cos(3 * (t - Math.PI / 2))) * s; out.push([r * Math.cos(t), r * Math.sin(t)]); } return out; };
  b.set(GLASS([0.55, 0.56, 0.57], 3.6, 2.0, 0.4, 0.4, { glow: [0.15, 0.15, 0.18] }));
  for (let k = 0; k < 13; k++) { const y = lerp(F0, F1, k / 12); b.loft([at(tri(1), y), at(tri(1), y + 1.4)], { capBottom: true }); }
  b.set(PLAIN([0.62, 0.62, 0.62], 0.3));
  cyl(b, 0, 0, F1 + 6, 220, 1.8, 1.2, 8);
  cyl(b, 0, 0, 220, H, 0.8, 0.25, 6);
  // the guys: from the floors' corners down to anchors on the hill
  b.set(PLAIN([0.40, 0.40, 0.40], 0.3));
  for (let i = 0; i < 3; i++) {
    const t = (i / 3) * TAU + Math.PI / 2, c = Math.cos(t), sn = Math.sin(t);
    for (const y of [F0, F1]) b.member([21 * c, y, 21 * sn], [45 * c, 0, 45 * sn], 0.3, 3);
  }
  b.light([0, H, 0], 1);
  ringLights(b, tri(1).filter((_, i) => i % 3 === 0), F1 + 1.4, 0);
  ringLights(b, circle(1.6, 3), 220, 0);
  return b.result();
}

// ------------------------------------------------------------------ Rome

// St Peter's Basilica: 136.6 m to the cross. Michelangelo's block under the dome (local n east, the
// dome 40 m west of the model's centre), the nave to the facade (about 115 m wide, 46 m high), the
// drum with its windows, the dome, the lantern, the ball and cross; two minor domes.
export function stpeters(brg = 90) {
  const b = new Builder(0.95).frame(0, 0, brg);
  const H = 136.6, DN = -40;
  const stone = GLASS(TRAVERTINE, 9.0, 4.0, 0.0, 0.15, { glow: flood(0.9) });
  b.set(stone);
  box(b, 0, DN, 0, 45, 62, 70);
  box(b, 0, 67, 0, 45, 30, 37);
  box(b, 0, 107, 0, 47, 57, 3);
  b.set(PLAIN(LEAD, 0.3));
  gable(b, 0, 67, 45, 53, 30, 37);
  b.set(stone);
  cyl(b, 0, DN, 45, 75, 25, 25, 24);
  cyl(b, 0, DN, 75, 80, 23.5, 23.5, 24);
  b.set(PLAIN([0.50, 0.52, 0.53], 0.35, { glow: flood(0.8) }));
  profile(b, 0, DN, [[80, 23], [90, 22], [100, 19], [108, 15], [114, 10], [117, 6]], 24);
  b.set(stone);
  cyl(b, 0, DN, 117, 128, 5.5, 5, 12);
  b.set(PLAIN([0.50, 0.52, 0.53], 0.35, { glow: flood(0.8) }));
  cyl(b, 0, DN, 128, 133, 5, 1, 12);
  b.set(PLAIN([0.70, 0.60, 0.35], 0.7, { glow: flood(1.2) }));
  cyl(b, 0, DN, 133, H, 1.2, 0.3, 6);
  for (const s of [-1, 1]) {
    b.set(stone); cyl(b, s * 40, -5, 45, 55, 6, 6, 12);
    b.set(PLAIN([0.50, 0.52, 0.53], 0.35)); domeAt(b, s * 40, -5, 55, 6.2, 8, 12, 3);
    spire(b, s * 40, -5, 62.5, 68, 1.2, 6);
  }
  return b.result();
}

// The Colosseum: an ellipse 189 x 156 m (local x along its long axis), 48 m high where the outer
// ring stands whole (the north side) and lower where it fell; the arcades, the cavea's slope and
// the arena inside, open to the sky. Floodlit at night.
export function colosseum(brg = -18) {
  const b = new Builder(0.97).frame(0, 0, brg);
  const A = 94.5, B = 78, K = 48, H = 48, LOW = 36;
  const ell = (s, i) => { const t = (i / K) * TAU; return [A * s * Math.cos(t), B * s * Math.sin(t)]; };
  const ring = (s) => Array.from({ length: K }, (_, i) => ell(s, i));
  const stone = GLASS(TRAVERTINE, 11.5, 6.6, 0.0, 0.0, { glow: flood(0.9) });
  b.set(stone);
  strip(b, ring(1), 0, LOW, true);
  strip(b, ring(0.95), 0, LOW, false);
  // the whole outer ring's upper storey on the north side (local n > 0): the arc's points
  const north = Array.from({ length: K / 2 + 1 }, (_, i) => ell(1, i)), northIn = Array.from({ length: K / 2 + 1 }, (_, i) => ell(0.95, i));
  strip(b, north, LOW, H, true, false);
  strip(b, northIn, LOW, H, false, false);
  b.set(PLAIN(TRAVERTINE, 0.1, { glow: flood(0.6) }));
  annulus(b, north, northIn, H, false);
  const south = Array.from({ length: K / 2 + 1 }, (_, i) => ell(1, K / 2 + i)), southIn = Array.from({ length: K / 2 + 1 }, (_, i) => ell(0.95, K / 2 + i));
  annulus(b, south, southIn, LOW, false);
  // the cavea: the seating's slope down to the arena, facing in and up
  b.set(PLAIN([0.58, 0.52, 0.42], 0.05, { glow: flood(0.4) }));
  b.flip = true;
  b.loft([at(ring(0.46), 4), at(ring(0.7), 20), at(ring(0.95), LOW - 1)], { capTop: false });
  b.flip = false;
  b.set(PLAIN([0.40, 0.34, 0.27], 0.02));
  const ar = ring(0.46), c = b.T([0, 3, 0]);
  for (let i = 0; i < K; i++) b.tri(b.T([ar[i][0], 4, ar[i][1]]), b.T([ar[(i + 1) % K][0], 4, ar[(i + 1) % K][1]]), b.T([0, 4, 0]), c);
  return b.result();
}

// Europe's models (v0.7.0), by landmark id: their own map beside East Asia's MODELS.
export const EUROPE_MODELS = { shard, westminster, eye, stpauls, towerbridge, eiffel, arc, sacrecoeur, notredame, grandearche,
  commerzbank, messeturm, europaturm, cepsa, pwc, cristal, emperador, caleido, kio, grossmunster, primetower,
  olympiaturm, frauenkirche, sagrada, glories, collserola, stpeters, colosseum };
