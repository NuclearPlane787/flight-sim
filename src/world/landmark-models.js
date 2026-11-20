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

export const MODELS = { lotte, b63, nseoul, parc1, shtower, swfc, jinmao, pearl, skytree, tokyotower, azabudai, tmg, ylmt, lct, neatt, harukas, umeda, fktower, fkdome };
