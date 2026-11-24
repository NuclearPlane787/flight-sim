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

// v0.7.4 part 9, item 6 (v0.7.7's landmarks: Tower Bridge as a bridge, Madrid's unlit tower, the village church's
// tower in rural.js). On by default; ?landmarks77=0 on the page or FS_LANDMARKS77=0 in node: the models, Tower
// Bridge's entry and the church's shader text exactly as v0.7.3's (the `...Old` functions). Read once, at import.
export const LANDMARKS77 = (() => {
  try {
    const q = (typeof location !== 'undefined' && location && location.search) || '';
    const m = /[?&]landmarks77=([01])\b/.exec(q);
    if (m) return m[1] === '1';
  } catch (e) { /* no location */ }
  try { const v = typeof process !== 'undefined' && process.env ? process.env.FS_LANDMARKS77 : undefined; if (v === '0') return false; } catch (e) { /* no process */ }
  return true;
})();
// v0.7.8 part 3 (briefs/V0-7-8.md; the `marks` subagent): the castles' colours, Tower Bridge's ends on its banks, the
// Elbphilharmonie's wave-topped glass, the Bergisel jump down its hill. On by default; ?landmarks78=0 on the page or
// FS_LANDMARKS78=0 in node: every model and entry exactly as the pushed v0.7.7's (the `...77` functions). Read once.
export const LANDMARKS78 = (() => {
  try {
    const q = (typeof location !== 'undefined' && location && location.search) || '';
    const m = /[?&]landmarks78=([01])\b/.exec(q);
    if (m) return m[1] === '1';
  } catch (e) { /* no location */ }
  try { const v = typeof process !== 'undefined' && process.env ? process.env.FS_LANDMARKS78 : undefined; if (v === '0') return false; } catch (e) { /* no process */ }
  return true;
})();
// v0.7.9 part 8 (briefs/V0-7-9.md; the `looks` subagent): two more looks, each on by default and read once, at import,
// as apron.js's lookSwitch(): ?bergisel79=0 (node FS_BERGISEL79=0), the Bergisel jump's in-run with its depth
// (bergisel79()); ?ndg79=0 (FS_NDG79=0), Notre-Dame de la Garde's limestone rock. Each only with ?landmarks78 on. Off,
// v0.7.8's models exactly.
function lookSwitch79(q, env) {
  try {
    const s = (typeof location !== 'undefined' && location && location.search) || '';
    const m = new RegExp(`[?&]${q}=([01])\\b`).exec(s);
    if (m) return m[1] === '1';
  } catch (e) { /* no location */ }
  try { if (typeof process !== 'undefined' && process.env && process.env[env] === '0') return false; } catch (e) { /* no process */ }
  return true;
}
export const BERGISEL79 = LANDMARKS78 && lookSwitch79('bergisel79', 'FS_BERGISEL79');
export const NDG79 = LANDMARKS78 && lookSwitch79('ndg79', 'FS_NDG79');

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
    // (v0.7.9 looks: but for a model that asks to reach under it, Notre-Dame de la Garde's rock, ndgRock79())
    if (!this.below79) for (let i = 1; i < this.P.length; i += 3) if (this.P[i] < 0) this.P[i] = 0;
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
// v0.7.4 (LANDMARKS77): the bridge itself (towerbridge77 below); with the switch off v0.7.3's plain model (towerbridgeOld).
export function towerbridge(brg = 0, geo = {}) { return LANDMARKS77 ? towerbridge77(brg, geo, LANDMARKS78) : towerbridgeOld(brg); }

// Tower Bridge as a bridge (v0.7.4, `kind: 'bridge'` in landmarks.js: y 0 the Thames). 244 m between the abutments' ends,
// the two towers 65 m to their pinnacles on piers in the river, the central span 61 m between the towers' faces closed by
// the two bascules' road deck, the two high-level walkways 44 m above the water between the towers, and the side spans
// hung from the chains down to the road and up to the abutment towers on the banks (Wikipedia "Tower Bridge": 244 m, the
// towers 65 m, the central span 61 m, the walkways 44 m). The towers' plan (22 x 16 m), the piers' cutwaters, the road's
// height (10 m), the side spans' length (65.5 m here, the article's 82 m measured from the towers' centres), the chains'
// curve and the abutment towers (26 m) [EST]. Stone towers with windows, floodlit at night; the steel in light blue.
// v0.7.8 (LANDMARKS78, `approaches`): the approaches on to the banks. The river the game draws by the bridge (the 31 m
// cover's water, in a town) reaches about 137 m south of the centre and 115 to 140 m north, so the abutments' ends at
// 122 m stood at or in the water's edge, the south one short of its bank. Each end now runs on as the real bridge's
// does, a granite-faced approach at the road's height (30 m south, 18 m north [EST]) and a ramp down to the bank's
// ground (bridgeEnds()'s heights, h0 and h1) over 45 m [EST]: the south end on land 197 m out, the north 185 m.
function towerbridge77(brg = 0, geo = {}, approaches = false) {
  void geo;     // (the ends are the abutments' own, at +-122 m; bridgeEnds()'s heights aren't needed: no ramp)
  const b = new Builder(0.19).frame(0, 0, brg);
  const TN = 38.5, TH = 8, FACE = TN - TH, DECK = 10, AB = 117, ABH = 5, END = AB + ABH, WALK = 42;
  const stone = GLASS([0.62, 0.58, 0.48], 6.0, 3.0, 0.1, 0.2, { glow: flood(0.9) });
  const plainStone = PLAIN([0.58, 0.55, 0.46], 0.1, { glow: flood(0.7) });
  const granite = PLAIN([0.42, 0.40, 0.36], 0.1);
  const slate = PLAIN(SLATE, 0.2, { glow: flood(0.5) });
  const blue = PLAIN([0.36, 0.52, 0.66], 0.35, { glow: [0.10, 0.16, 0.24] });
  const road = PLAIN([0.30, 0.30, 0.31], 0.1);
  // A pinnacled stone tower about (0, n): legs either side of the road's arch (half width `open`, up to `archTop`), the
  // body above, four octagonal corner turrets with their spires and a pyramid roof between them.
  const tower = (n, hx, hn, base, archTop, top, open, turretTop, spireTop, roofTop, tr) => {
    b.set(stone);
    for (const s of [-1, 1]) box(b, s * (open + hx) / 2, n, base, archTop, (hx - open) / 2, hn);
    box(b, 0, n, base, DECK - 2.4, open, hn);                                                 // under the road
    box(b, 0, n, archTop, top, hx, hn, 0, { capBottom: true });
    b.set(plainStone);
    box(b, 0, n, archTop - 2.5, archTop, open, hn * 0.3, 0, { capBottom: true });             // the arch's head, inside
    b.set(stone);
    for (const [dx, dn] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) cyl(b, dx * (hx - tr * 0.6), n + dn * (hn - tr * 0.6), base, turretTop, tr, tr, 8);
    b.set(slate);
    for (const [dx, dn] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) spire(b, dx * (hx - tr * 0.6), n + dn * (hn - tr * 0.6), turretTop, spireTop, tr * 1.05, 8);
    b.loft([at(shift([[hx - 1.5, -(hn - 1.5)], [hx - 1.5, hn - 1.5], [-(hx - 1.5), hn - 1.5], [-(hx - 1.5), -(hn - 1.5)]], 0, n), top),
      at(shift([[1.2, -0.6], [1.2, 0.6], [-1.2, 0.6], [-1.2, -0.6]], 0, n), roofTop)]);
  };
  for (const s of [-1, 1]) {
    const n = s * TN;
    b.set(granite);
    b.loft([at(shift([[27, 0], [19, 12], [-19, 12], [-27, 0], [-19, -12], [19, -12]], 0, n), 0), at(shift([[27, 0], [19, 12], [-19, 12], [-27, 0], [-19, -12], [19, -12]], 0, n), 5)]);   // the pier and its cutwaters
    tower(n, 11, TH, 5, 26, 47, 5, 51, 65, 58, 2.6);
    b.set(slate);
    for (const sx of [-1, 1]) spire(b, sx * 4.5, n, 58 - 4, 60.5, 0.9, 6);                     // the roof's small pinnacles
    // the abutment tower on the bank
    tower(s * AB, 9, ABH, 0, 17, 24, 5, 26, 32, 29, 1.6);
  }
  // the two high-level walkways: a lattice girder each side, floor and roof, between the towers' faces
  b.set(blue);
  const PANELS = 8;
  for (const sx of [-1, 1]) {
    const xc = sx * 7, W = 1.8, y0 = WALK, y1 = WALK + 4;
    box(b, xc, 0, y0 - 0.5, y0, W + 0.2, FACE, 0, { capBottom: true });
    box(b, xc, 0, y1, y1 + 0.5, W + 0.2, FACE, 0, { capBottom: true });
    for (const w of [-1, 1]) {
      const x = xc + w * W;
      b.member([x, y0, -FACE], [x, y0, FACE], 0.35, 4);
      b.member([x, y1, -FACE], [x, y1, FACE], 0.35, 4);
      for (let k = 0; k <= PANELS; k++) {
        const na = lerp(-FACE, FACE, k / PANELS);
        b.member([x, y0, na], [x, y1, na], 0.25, 4);
        if (k < PANELS) { const nb = lerp(-FACE, FACE, (k + 1) / PANELS); b.member(k % 2 ? [x, y0, na] : [x, y1, na], k % 2 ? [x, y1, nb] : [x, y0, nb], 0.2, 4); }
      }
    }
  }
  // the bascules (closed: two leaves meeting in the middle), deeper at their heels by the towers
  b.set(road);
  for (const s of [-1, 1]) {
    box(b, 0, s * (FACE / 2 + 0.1), DECK - 2.2, DECK, 8.5, FACE / 2 - 0.1, 0, { capBottom: true });
    box(b, 0, s * (FACE - 4), DECK - 4.2, DECK - 2.2, 7.5, 4, 0, { capBottom: true });
  }
  b.set(blue);
  for (const sx of [-1, 1]) box(b, sx * 8.8, 0, DECK - 2.4, DECK + 1.1, 0.35, FACE, 0, { capBottom: true });   // their side girders
  // the side spans: the road from each tower to its abutment tower, the stiffening girders, the chains and their hangers
  const S0 = TN + TH, S1 = AB - ABH;
  const chain = (t) => 12 + 66.3 * (t - 0.65) ** 2;                                          // 40 m at the tower, 20 m at the abutment
  for (const s of [-1, 1]) {
    b.set(road);
    box(b, 0, s * (S0 + S1) / 2, DECK - 1.6, DECK, 8.5, (S1 - S0) / 2, 0, { capBottom: true });
    b.set(blue);
    for (const sx of [-1, 1]) {
      box(b, sx * 8.8, s * (S0 + S1) / 2, DECK - 1.8, DECK + 1.6, 0.4, (S1 - S0) / 2, 0, { capBottom: true });
      const K = 10, pts = [];
      for (let k = 0; k <= K; k++) { const t = k / K; pts.push([sx * 8.2, chain(t), s * lerp(S0, S1, t)]); }
      for (let k = 0; k < K; k++) b.member(pts[k], pts[k + 1], 0.9, 4);
      for (let k = 1; k < K; k++) if (pts[k][1] - DECK > 2.5) b.member([sx * 8.2, DECK + 1.6, pts[k][2]], [sx * 8.2, pts[k][1] - 0.8, pts[k][2]], 0.18, 4);
    }
  }
  // the road through the towers' arches (the main towers' and the abutments', out to the ends on the banks)
  b.set(road);
  for (const s of [-1, 1]) {
    box(b, 0, s * (FACE + S0) / 2, DECK - 2.4, DECK, 5, (S0 - FACE) / 2, 0, { capBottom: true });
    box(b, 0, s * (S1 + END) / 2, DECK - 2.4, DECK, 5, (END - S1) / 2, 0, { capBottom: true });
  }
  if (approaches) {
    const HX = 8, RAMP = 45;
    for (const s of [-1, 1]) {
      // (geo's h0 is the south end's ground, at n0 < 0; h1 the north's; 3 m without them)
      const L1 = s < 0 ? TB_APPROACH_S : TB_APPROACH_N, hEnd = Math.max((s < 0 ? geo.h0 : geo.h1) ?? 3, 1) + 0.3;
      const n0 = s * END, n1 = s * (END + L1), n2 = s * (END + L1 + RAMP);
      const sec = (n, top, hx = HX, y0 = 0) => [[-hx, y0, n], [hx, y0, n], [hx, top, n], [-hx, top, n]];
      b.set(granite);
      b.loft([sec(n0, DECK - 0.3), sec(n1, DECK - 0.3), sec(n2, hEnd - 0.3)], { capTop: true });
      b.set(road);
      b.loft([sec(n0, DECK, 6.5, DECK - 0.4), sec(n1, DECK, 6.5, DECK - 0.4), sec(n2, hEnd, 6.5, hEnd - 0.4)], { capTop: true });
      b.set(plainStone);
      for (const sx of [-1, 1]) {
        const par = (n, top) => [[sx * HX - 0.5, top - 1.4, n], [sx * HX, top - 1.4, n], [sx * HX, top, n], [sx * HX - 0.5, top, n]];
        b.loft([par(n0, DECK + 1.1), par(n1, DECK + 1.1), par(n2, hEnd + 1.1)], { capTop: true });
      }
    }
  }
  return b.result();
}
export const TB_APPROACH_S = 30, TB_APPROACH_N = 18;

function towerbridgeOld(brg = 0) {
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
// v0.7.4 (LANDMARKS77): the unlit slab at night was this tower's two cores, PLAIN (no window pattern, so no lit windows)
// under an even pale glow, and they are all of the tower seen from the east and the west (the glass between them is
// recessed and narrower): now they carry a pale glazed facade with lit windows as the three towers beside it, a dimmer
// glow; the frame at the top keeps its light. With the switch off, v0.7.3's (cepsaOld).
export function cepsa(brg = 0) { return LANDMARKS77 ? cepsa77(brg) : cepsaOld(brg); }
function cepsa77(brg = 0) {
  const b = new Builder(0.68).frame(0, 0, brg);
  const H = 248.3;
  // (the lead's picture review: no glow on the cores, as the neighbours' glass has none, so the wall between the lit
  // windows is as dark as theirs at night; the frame at the top dark too but for a trace, under its red lights. The
  // glow is added times uNight only: by day both read as before.)
  b.set(GLASS([0.44, 0.46, 0.47], 4.0, 2.5, 0.7, 0.26, { spec: 0.15 }));
  for (const s of [-1, 1]) box(b, s * 20, 0, 0, 232, 6, 20);
  b.set(PLAIN([0.64, 0.64, 0.62], 0.15, { glow: [0.02, 0.02, 0.025] }));
  for (const s of [-1, 1]) box(b, s * 20, 0, 232, H, 6, 20);
  box(b, 0, 0, 232, H, 14, 20, 0, { capBottom: true });
  b.set(GLASS([0.30, 0.34, 0.38], 4.0, 2.5, 0.85, 0.26));
  box(b, 0, 0, 0, 212, 14, 19);
  for (const s of [-1, 1]) b.light([s * 26, H, 0], 1);
  for (const y of [212, 140, 70]) ringLights(b, [[26, 20], [-26, 20], [-26, -20], [26, -20]], y, 0);
  return b.result();
}
function cepsaOld(brg = 0) {
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

// ================================================================== v0.7.1: Europe's next landmarks (briefs/V0-7-1.md part 5)
// The same rules: our own massing from public figures, no logos, lettering or names. Added to EUROPE_MODELS below.

const MARBLE = [0.70, 0.67, 0.62], SANDSTONE = [0.66, 0.60, 0.47];

// ------------------------------------------------------------------ Berlin

// The Fernsehturm: 368 m with the antenna. A tapering concrete shaft, the sphere (about 32 m across [EST],
// the visitor platform at 203 m and the restaurant at 207 m in it), the shaft on above it and the antenna
// in red and white bands.
export function fernsehturm() {
  const b = new Builder(0.21);
  const C = 212, R = 16;
  const pod = [];
  for (let i = 0; i <= 10; i++) { const a = Math.PI * (1 - i / 10); pod.push([C + R * Math.cos(a), Math.max(R * Math.sin(a), 4.6)]); }
  tvTower(b, { H: 368, r0: 16, r1: 4.8, podY0: C - R, pod, shaftTop: 252, shaftR: 4.2, mastR: 2.2, bands: 9,
    foot: [[0, 22], [6, 21], [10, 16]] });
  return b.result();
}

// The Brandenburg Gate: 26 m to the quadriga's top, about 65 m wide with its wings. Six pairs of columns (two
// rows, local x across the gate's depth; the gate's width along local n), five passages, the entablature and
// the stepped attic, the quadriga as one simple block; lower wings at either side.
export function brandenburg(brg = 0) {
  const b = new Builder(0.24).frame(0, 0, brg);
  const stone = PLAIN(SANDSTONE, 0.05, { glow: flood(1.0) });
  b.set(stone);
  box(b, 0, 0, 0, 1.2, 6.5, 21);                         // the plinth
  const cols = [-17.5, -10.5, -3.5, 3.5, 10.5, 17.5];
  for (const n of cols) for (const x of [-4.2, 4.2]) cyl(b, x, n, 1.2, 14.5, 0.95, 0.85, 8);
  for (const s of [-1, 1]) box(b, 0, s * 19.5, 1.2, 14.5, 4.6, 1.2);   // the end walls
  box(b, 0, 0, 14.5, 19.0, 5.6, 21);                     // the entablature
  box(b, 0, 0, 19.0, 21.0, 4.8, 13);                     // the attic's step
  // the quadriga: four horses and the chariot as one block, the figure over it
  b.set(PLAIN([0.22, 0.36, 0.30], 0.35, { glow: flood(0.7) }));
  box(b, 0, 0, 21.0, 23.6, 2.6, 3.4);
  cyl(b, 0.8, 0, 23.6, 26, 0.6, 0.3, 6);
  // the wings: lower colonnaded buildings stepping back to the full width
  b.set(stone);
  for (const s of [-1, 1]) {
    box(b, -4, s * 27, 0, 10.5, 6.5, 5.75);
    b.set(PLAIN(SLATE, 0.15)); gable(b, -4, s * 27, 10.5, 12.5, 6.5, 5.75, true); b.set(stone);
  }
  return b.result();
}

// ------------------------------------------------------------------ Vienna

// St Stephen's Cathedral: the south tower 136.7 m, the church 107 m long (local x, east) and 70 m wide with
// its towers. The hall-church's walls, the long steep tiled roof (its ridge [EST] at 62 m), the narrower
// choir, the unfinished north tower (68 m [EST]) and the two west towers (65 m [EST]).
export function stephansdom(brg = 0) {
  const b = new Builder(0.31).frame(0, 0, brg);
  const stone = GLASS([0.60, 0.56, 0.46], 8.0, 5.0, 0.0, 0.1, { glow: flood(0.9) });
  b.set(stone);
  box(b, -16, 0, 0, 25, 33, 19);                        // the nave
  box(b, 32, 0, 0, 23, 15, 15);                         // the choir
  b.set(PLAIN([0.52, 0.36, 0.20], 0.15, { glow: flood(0.4) }));     // the tiled roof
  gable(b, -16, 0, 25, 62, 33, 19, true);
  b.loft([at(shift([[15, -15], [15, 15], [-15, 15], [-15, -15]], 32, 0), 23), at(shift([[13, -0.3], [13, 0.3], [-15, 0.3], [-15, -0.3]], 32, 0), 56)]);
  b.set(stone);
  profile(b, 40, 0, [[0, 13], [23, 13]], 8, false);      // the apse
  // the south tower: square, then stepping in, then the spire
  const TX = -6, TN = -26;
  box(b, TX, TN, 0, 50, 7.5, 7.5);
  b.loft([at(shift(chamferRect(7.5, 7.5, 1.5), TX, TN), 50), at(shift(chamferRect(5.5, 5.5, 1.6), TX, TN), 80), at(shift(chamferRect(3.6, 3.6, 1.2), TX, TN), 105)], { capTop: false });
  spire(b, TX, TN, 105, 136.7, 3.6, 8);
  // the north tower, unfinished, with its cap
  box(b, TX, 26, 0, 61, 7.5, 7.5);
  b.set(PLAIN(COPPER, 0.3)); profile(b, TX, 26, [[61, 6.5], [64, 5.5], [66, 2.5], [68, 0.3]], 8); b.set(stone);
  // the west front's two towers
  for (const s of [-1, 1]) { box(b, -51, s * 11, 0, 50, 2.8, 2.8); spire(b, -51, s * 11, 50, 65, 2.8, 8); }
  return b.result();
}

// The Donauturm: 252 m to the antenna, the viewing platform at 150 m and the two revolving restaurants at
// 161 m and 169 m. A slender shaft, the pod, the steel mast; the base's pavilion [EST].
export function donauturm() {
  const b = new Builder(0.34);
  tvTower(b, { H: 252, r0: 5.5, r1: 4.2, podY0: 146, pod: [[146, 4.2], [150, 9], [153, 13.5], [158, 15.5], [172, 15.5], [175, 12], [178, 5]],
    shaftTop: 186, shaftR: 3.2, mastR: 1.6, bands: 6, foot: [[0, 15], [5, 14], [7, 6], [12, 5.5]] });
  return b.result();
}

// The Riesenrad (the Prater's giant wheel): 64.75 m. The wheel about 61 m across [EST] in the local n-y plane,
// two rims tied by spokes, carried on two lattice trestles, and 15 cabins.
export function riesenrad(brg = 0) {
  const b = new Builder(0.36).frame(0, 0, brg);
  const R = 30.2, HUB = 64.75 - R - 0.3, K = 30;
  const P = (x, r, t) => [x, HUB + r * Math.sin(t), r * Math.cos(t)];
  b.set(PLAIN([0.36, 0.33, 0.28], 0.25, { glow: [0.30, 0.22, 0.10] }));
  for (const x of [-3, 3]) for (let i = 0; i < K; i++) {
    const t0 = (i / K) * TAU, t1 = ((i + 1) / K) * TAU;
    b.member(P(x, R, t0), P(x, R, t1), 0.55, 3);
    if (i % 2 === 0) b.member([x * 0.6, HUB, 0], P(x, R, t0), 0.12, 3);
  }
  b.member([-5, HUB, 0], [5, HUB, 0], 1.2, 6);
  // the trestles: two legs a side, out to the ground
  for (const x of [-6, 6]) for (const s of [-1, 1]) b.member([x * 1.4, 0, s * 14], [x, HUB, 0], 0.7, 4);
  b.set(PLAIN([0.55, 0.10, 0.07], 0.25, { glow: [0.35, 0.20, 0.10] }));
  for (let i = 0; i < 15; i++) {
    const t = ((i + 0.25) / 15) * TAU, y = HUB + (R - 1.5) * Math.sin(t), n = (R - 1.5) * Math.cos(t);
    box(b, 0, n, y - 3.6, y - 0.6, 1.4, 2.6, 0, { capBottom: true });
  }
  b.light([0, 64.75, 0], 0);
  return b.result();
}

// ------------------------------------------------------------------ Milan

// The Duomo: 108.5 m to the Madonnina, 158.6 m long (local x, east to the apse) and 92 m across the
// transepts. Five aisles as a broad block under the raised nave, the facade's gable, the transepts, the
// rounded apse, rows of pinnacles along the roofs (a few for the forest), the crossing's octagon and its
// spire with the gilded statue on top. White marble, floodlit at night.
export function duomo(brg = 0) {
  const b = new Builder(0.41).frame(0, 0, brg);
  const marble = GLASS(MARBLE, 9.0, 4.5, 0.0, 0.1, { glow: flood(1.0) });
  const XC = 26;                                        // the crossing
  b.set(marble);
  box(b, -22, 0, 0, 30, 57, 29);                        // the aisles
  box(b, -22, 0, 30, 45, 57, 11);                       // the raised nave
  box(b, XC, 0, 0, 40, 15, 46);                         // the transepts
  box(b, 54, 0, 0, 40, 13, 20);                         // the choir
  profile(b, 59, 0, [[0, 20], [40, 20]], 10, false);    // the apse
  b.loft([at([[0.5, -29], [0.5, 29], [-0.5, 29], [-0.5, -29]].map(([x, n]) => [x - 79.3, n]), 0),
    at([[0.5, -29], [0.5, 29], [-0.5, 29], [-0.5, -29]].map(([x, n]) => [x - 79.3, n]), 36),
    at([[0.5, -6], [0.5, 6], [-0.5, 6], [-0.5, -6]].map(([x, n]) => [x - 79.3, n]), 56)]);     // the facade's gable
  b.set(PLAIN([0.66, 0.64, 0.60], 0.1, { glow: flood(0.6) }));
  gable(b, -22, 0, 45, 50, 57, 11, true);
  // the pinnacles: rows along the aisles' and the nave's edges, and the transepts' ends
  for (let k = 0; k < 9; k++) {
    const x = -76 + k * 13.5;
    for (const n of [-28, 28]) spire(b, x, n, 30, 42, 1.0, 4);
    for (const n of [-11, 11]) spire(b, x, n, 45, 55, 0.9, 4);
  }
  for (const n of [-45, 45]) for (const x of [XC - 13, XC, XC + 13]) spire(b, x, n, 40, 52, 1.0, 4);
  for (const n of [-28, 28, -14, 14]) spire(b, -79, n, 36, 50, 1.1, 4);
  // the crossing's octagon, its spire and the statue
  b.set(marble);
  cyl(b, XC, 0, 40, 66, 10, 9, 8);
  b.loft([at(shift(circle(9, 8), XC, 0), 66), at(shift(circle(5, 8), XC, 0), 82), at(shift(circle(1.6, 8), XC, 0), 104)]);
  b.set(PLAIN([0.80, 0.62, 0.28], 0.8, { glow: flood(1.4) }));
  cyl(b, XC, 0, 104, 108.5, 0.9, 0.3, 6);
  return b.result();
}

// ------------------------------------------------------------------ Lisbon

// The 25 de Abril Bridge: a suspension bridge, the main span 1,013 m (local n along the bridge, the base at
// the river, y 0), the towers 190 m, the side spans to the anchorages [EST: 483 m], the deck (a truss for the
// road over the railway) about 70 m clear [EST]. Painted red; the hangers a handful of thin lines.
export function ponte25(brg = 167, geo = {}) {
  void geo;
  const b = new Builder(0.43).frame(0, 0, brg);
  const S = 506.45, A = 989.85, END = 1000, H = 190, DECK = 70, D = 8, HW = 12.5, TX = 14;
  const red = PLAIN([0.56, 0.11, 0.06], 0.3, { glow: [0.22, 0.07, 0.04] });
  b.set(red);
  box(b, 0, 0, DECK, DECK + D, HW, END, 0, { capBottom: true });
  // the towers: two legs each, three cross beams, on their piers
  for (const n of [-S, S]) {
    b.set(PLAIN(CONCRETE, 0.1)); box(b, 0, n, 0, 12, TX + 8, 10); b.set(red);
    for (const sx of [-1, 1]) b.loft([at(shift(chamferRect(4, 5, 1), sx * TX, n), 12), at(shift(chamferRect(3, 4, 0.8), sx * TX, n), H)]);
    for (const y of [60, 130, H - 6]) box(b, 0, n, y, y + 5, TX - 2, 2.5, 0, { capBottom: true });
    for (const sx of [-1, 1]) b.light([sx * TX, H, n], 1);
    for (const sx of [-1, 1]) b.light([sx * (TX + 3.5), 130, n], 0);
  }
  // the main cables and hangers
  const top = H - 2, low = DECK + D + 3;
  const cy = (n) => {
    const a = Math.abs(n);
    if (a <= S) return low + (top - low) * (a / S) ** 2;
    const t = (a - S) / (A - S);
    return lerp(top, DECK + D, t) - 10 * Math.sin(Math.PI * t);
  };
  b.set(PLAIN([0.50, 0.10, 0.06], 0.35));
  const ns = [];
  for (let k = 0; k <= 16; k++) ns.push(lerp(-S, S, k / 16));
  for (let k = 1; k <= 6; k++) { ns.push(S + (A - S) * k / 6); ns.push(-S - (A - S) * k / 6); }
  ns.sort((p, q) => p - q);
  for (const sx of [-1, 1]) {
    for (let i = 0; i + 1 < ns.length; i++) b.member([sx * TX, cy(ns[i]), ns[i]], [sx * TX, cy(ns[i + 1]), ns[i + 1]], 0.7, 3);
    for (const n of ns) if (Math.abs(Math.abs(n) - S) > 1 && Math.abs(n) < A - 1 && cy(n) - DECK - D > 2) b.member([sx * TX, cy(n), n], [sx * TX, DECK + D, n], 0.25, 3);
  }
  // the anchorages, down to the ground
  b.set(PLAIN(CONCRETE, 0.1));
  for (const s of [-1, 1]) box(b, 0, s * (A - 2), 0, DECK + D + 2, 18, 12);
  for (const n of [-S / 2, S / 2]) b.light([0, cy(n) + 1, n], 0);
  return b.result();
}

// Christ the King (Almada): 110 m with its pedestal, on the south bank's clifftop. The pedestal 82 m: a
// trapezoidal frame of four arches facing the compass points with a flat platform; the figure 28 m with
// its arms out towards the city (local north). Floodlit at night.
export function cristorei(brg = 0) {
  const b = new Builder(0.45).frame(0, 0, brg);
  const stone = PLAIN([0.70, 0.68, 0.63], 0.05, { glow: flood(1.1) });
  b.set(stone);
  // the four legs, leaning in from the base's corners to the platform
  for (const [sx, sn] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    b.loft([at(shift([[3.5, -3.5], [3.5, 3.5], [-3.5, 3.5], [-3.5, -3.5]], sx * 15, sn * 15), 0), at(shift([[2.8, -2.8], [2.8, 2.8], [-2.8, 2.8], [-2.8, -2.8]], sx * 7.5, sn * 7.5), 66)], { capTop: false });
  }
  box(b, 0, 0, 0, 14, 9, 9);                             // the chapel
  box(b, 0, 0, 66, 79.3, 10.5, 10.5);                    // the arches' heads and the terrace
  box(b, 0, 0, 79.3, 82, 4.5, 4.5);                      // the figure's plinth
  // the figure: the robe tapering up, the arms out, the head
  b.loft([at(superellipse(3.6, 2.6, 2.4, 12), 82), at(superellipse(2.6, 2.0, 2.4, 12), 100), at(superellipse(2.4, 1.6, 2.4, 12), 104)]);
  box(b, 0, 0.3, 101, 104, 13.5, 1.3);
  cyl(b, 0, 0.4, 104, 108.6, 1.3, 1.1, 8);
  domeAt(b, 0, 0.4, 108.6, 1.1, 1.4, 8, 2);
  b.light([0, 110, 0.4], 0);
  return b.result();
}

// The Vasco da Gama Bridge: about 12.2 km over the Tagus estuary (the north viaduct 488 m, the Expo viaduct
// 672 m, the cable-stayed main bridge 829 m, its main span 420 m, its pylons 150 m, 45 m clear at high tide,
// then the central viaduct 6,351 m at 14 to 30 m and the south viaduct 3,825 m). Built on East Asia's cable-
// stayed helper: the deck coming down from the main span to the ground at each end; the viaduct's piers drawn
// every 312 m (every fourth of the real 78 m sections), the stays a few per pylon.
export function vascodagama(brg = 123, geo = {}) {
  const b = new Builder(0.47).frame(0, 0, brg);
  const g = { s: 210, n0: -1574.5, n1: 10590.5, h0: 3, h1: 3, ...geo };
  const H = 150, LEG = 17;
  cableStayed(b, {
    ...g, clear: 45, half: 15, back: 190, piers: 312,
    pylon: (bb, n) => {
      bb.set(PLAIN([0.64, 0.64, 0.62], 0.12, { glow: [0.18, 0.18, 0.20] }));
      for (const sx of [-1, 1]) bb.loft([at(shift(chamferRect(3.2, 4.5, 1), sx * LEG, n), 0), at(shift(chamferRect(2.2, 3.2, 0.8), sx * LEG, n), H)]);
      bb.member([-LEG, 40, n], [LEG, 40, n], 2.4, 4);
      bb.member([-LEG, H - 8, n], [LEG, H - 8, n], 1.8, 4);
      for (const sx of [-1, 1]) bb.light([sx * LEG, H, n], 1);
      for (const sx of [-1, 1]) bb.light([sx * (LEG + 3), 100, n], 0);
    },
    anchors: () => { const out = []; for (let k = 0; k < 6; k++) { const y = lerp(80, H - 12, k / 5); out.push([-LEG, y], [LEG, y]); } return out; },
  });
  return b.result();
}

// ------------------------------------------------------------------ the Øresund and Malmö

// The Øresund Bridge: 7,845 m from Peberholm to Lernacken, the cable-stayed main span 490 m between two pairs
// of free-standing pylons 204 m tall, 57 m clear, the approaches' girder on piers every 140 m. On East Asia's
// cable-stayed helper (the deck down to the ground at each end); the stays in two harp-like planes, a few each.
export function oresund(brg = 103, geo = {}) {
  const b = new Builder(0.49).frame(0, 0, brg);
  const g = { s: 245, n0: -3560, n1: 4285, h0: 3, h1: 3, ...geo };
  const H = 204, PX = 16;
  cableStayed(b, {
    ...g, clear: 57, half: 12, back: 300, piers: 140,
    pylon: (bb, n) => {
      bb.set(PLAIN([0.62, 0.62, 0.60], 0.12, { glow: [0.18, 0.18, 0.21] }));
      for (const sx of [-1, 1]) bb.loft([at(shift(chamferRect(3.5, 4.5, 1), sx * PX, n), 0), at(shift(chamferRect(2.4, 3.2, 0.8), sx * PX, n), H)]);
      bb.member([-PX, 50, n], [PX, 50, n], 2.5, 4);         // the beam under the deck
      for (const sx of [-1, 1]) bb.light([sx * PX, H, n], 1);
      for (const sx of [-1, 1]) bb.light([sx * (PX + 3.5), 130, n], 0);
    },
    anchors: () => { const out = []; for (let k = 0; k < 7; k++) { const y = lerp(95, H - 8, k / 6); out.push([-PX, y], [PX, y]); } return out; },
  });
  return b.result();
}

// The Turning Torso (Malmö): 190 m, 54 floors in nine segments of five floors (pentagonal plans round a core),
// each turned against the one below, the top one 90 degrees from the bottom; the core shows between them. The
// plan's size [EST]: about 25 m across.
export function torso(brg = 0) {
  const b = new Builder(0.51).frame(0, 0, brg);
  const H = 190, SEG = 19.6, STEP = (H - 2.4 - SEG) / 8;
  const pent = (a) => rotRing([[12.5, -9.5], [12.5, 6], [3.5, 12.5], [-9, 12.5], [-9, -9.5]].map(([x, n]) => [x - 1.5, n - 0.5]), a);
  b.set(PLAIN([0.58, 0.58, 0.58], 0.15));
  cyl(b, 0, 0, 0, H - 2.4, 5.3, 5.3, 12);
  b.set(GLASS([0.62, 0.63, 0.64], 3.6, 2.4, 0.55, 0.3, { glow: [0.12, 0.12, 0.13] }));
  for (let i = 0; i < 9; i++) {
    const y0 = i * STEP, a = (i / 8) * (Math.PI / 2);
    b.loft([at(pent(a), y0), at(pent(a), y0 + SEG)], { capBottom: i > 0 });
  }
  b.set(PLAIN([0.70, 0.70, 0.70], 0.3));
  cyl(b, 0, 0, H - 2.4, H, 3, 2, 8);
  b.light([0, H, 0], 1);
  for (let i = 3; i < 9; i += 3) { const ring = pent((i / 8) * (Math.PI / 2)); ringLights(b, [ring[0], ring[3]], i * STEP + SEG, 0); }
  return b.result();
}

// ------------------------------------------------------------------ Dublin

// The Poolbeg chimneys: two, 207.48 m and 207.8 m, banded red and white, about 75 m apart [EST] along
// local x; their taper [EST]. Aviation lights at the tops and part way up.
export function poolbeg(brg = 0) {
  const b = new Builder(0.53).frame(0, 0, brg);
  const red = PLAIN([0.58, 0.10, 0.06], 0.15), white = PLAIN([0.66, 0.66, 0.64], 0.15);
  for (const [x, H] of [[-37.5, 207.48], [37.5, 207.8]]) {
    const BANDS = 8;
    for (let k = 0; k < BANDS; k++) {
      const y0 = (k / BANDS) * H, y1 = ((k + 1) / BANDS) * H;
      b.set(k % 2 ? white : red);
      cyl(b, x, 0, y0, y1, lerp(9, 4.6, k / BANDS), lerp(9, 4.6, (k + 1) / BANDS), 16, { capTop: k === BANDS - 1 });
    }
    b.light([x, H, 0], 1);
    for (const y of [H * 0.66, H * 0.33]) ringLights(b, circle(lerp(9, 4.6, y / H) + 0.3, 3).map(([px, pn]) => [px + x, pn]), y, 0);
  }
  return b.result();
}

// ------------------------------------------------------------------ Brussels

// The Palace of Justice: 116 m (the article; about 104 m to the dome's own top), the block 160 x 150 m. The
// massive base, the raised central block with its porticoes, the drum and the dome, the lantern and crown.
export function palaisjustice(brg = 0) {
  const b = new Builder(0.55).frame(0, 0, brg);
  const stone = GLASS([0.58, 0.55, 0.49], 9.0, 6.0, 0.0, 0.1, { glow: flood(0.8) });
  b.set(stone);
  box(b, 0, 0, 0, 34, 80, 75);
  for (const [dx, dn] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) box(b, dx * 66, dn * 61, 34, 42, 14, 14);   // the corner pavilions
  box(b, 0, 0, 34, 58, 34, 34);                         // the central block
  box(b, 0, -40, 34, 52, 16, 6);                        // the main portico
  b.set(PLAIN(SLATE, 0.2)); gable(b, 0, -40, 52, 57, 16, 6, true); b.set(stone);
  cyl(b, 0, 0, 58, 72, 22, 22, 20);                     // the colonnaded drum
  cyl(b, 0, 0, 72, 80, 18, 18, 20);
  b.set(PLAIN([0.34, 0.36, 0.33], 0.4, { glow: flood(0.7) }));
  profile(b, 0, 0, [[80, 18], [88, 16.8], [95, 13], [100, 8], [104, 3.5]], 20);
  b.set(stone);
  cyl(b, 0, 0, 104, 110, 3.2, 2.8, 8);
  b.set(PLAIN([0.70, 0.58, 0.30], 0.7, { glow: flood(1.2) }));
  cyl(b, 0, 0, 110, 116, 2.4, 0.3, 8);
  b.light([0, 116, 0], 0);
  return b.result();
}

// ------------------------------------------------------------------ Jodrell Bank

// The Lovell Telescope: the bowl 76.2 m across, the elevation axis 50.5 m up, 89.0 m at most above the ground,
// the wheel girders' radius 38.5 m. Two towers on the turntable's rails carry the bowl between them on its
// axis (local x); the bowl tilted 20 degrees above the horizon, facing local north [EST: its pose]; the
// bowl's depth [EST: f/D about 0.3], the feed mast to the focus.
export function lovell(brg = 180) {
  const b = new Builder(0.57).frame(0, 0, brg);
  const AX = 50.5, R = 38.1, EL = 20 * DEG, DEPTH = 15.8, WA = -7.8, TW = 43;
  const ce = Math.cos(EL), se = Math.sin(EL);
  // dish coordinates (u across, v up the dish, w along the boresight; w 0 the rim's plane) -> local
  const Q = (u, v, w) => { const ww = w - WA; return [u, AX + v * ce + ww * se, -v * se + ww * ce]; };
  const steel = PLAIN([0.66, 0.67, 0.66], 0.35, { glow: [0.10, 0.10, 0.11] });
  b.set(steel);
  // the bowl: rings of the paraboloid w = DEPTH ((r/R)^2 - 1), the inside facing the sky
  const K = 20, RINGS = [0.08, 0.35, 0.6, 0.82, 1];
  const ringAt = (s) => Array.from({ length: K }, (_, i) => { const t = (i / K) * TAU, r = s * R; return Q(r * Math.cos(t), r * Math.sin(t), DEPTH * (s * s - 1)); });
  const rings = RINGS.map(ringAt);
  const back = Q(0, 0, -DEPTH - 30);
  for (let j = 0; j + 1 < rings.length; j++) for (let i = 0; i < K; i++) {
    const i1 = (i + 1) % K, A0 = b.T(rings[j][i]), A1 = b.T(rings[j][i1]), B1 = b.T(rings[j + 1][i1]), B0 = b.T(rings[j + 1][i]);
    const ins = b.T(back);
    b.tri(A0, A1, B1, ins); b.tri(A0, B1, B0, ins);
  }
  // the back of the bowl: the same surface seen from behind (a second skin a metre under)
  b.set(PLAIN([0.48, 0.49, 0.48], 0.2));
  const ringsB = RINGS.map((s) => Array.from({ length: K }, (_, i) => { const t = (i / K) * TAU, r = s * R; return Q(r * Math.cos(t), r * Math.sin(t), DEPTH * (s * s - 1) - 1); }));
  const front = Q(0, 0, 40);
  for (let j = 0; j + 1 < ringsB.length; j++) for (let i = 0; i < K; i++) {
    const i1 = (i + 1) % K, A0 = b.T(ringsB[j][i]), A1 = b.T(ringsB[j][i1]), B1 = b.T(ringsB[j + 1][i1]), B0 = b.T(ringsB[j + 1][i]);
    b.tri(A0, A1, B1, b.T(front)); b.tri(A0, B1, B0, b.T(front));
  }
  b.set(steel);
  // the rim, the elevation axis's trunnions, and the feed mast to the focus
  for (let i = 0; i < K; i++) b.member(rings[4][i], rings[4][(i + 1) % K], 0.45, 3);
  b.member([-TW, AX, 0], [-R - 1, AX, Q(0, 0, WA)[2]], 1.4, 6);
  b.member([TW, AX, 0], [R + 1, AX, Q(0, 0, WA)[2]], 1.4, 6);
  b.member(Q(0, 0, -DEPTH), Q(0, 0, 7.1), 0.6, 4);
  // the towers: two tapering lattice frames a side, on the turntable's bogies
  for (const sx of [-1, 1]) {
    for (const sn of [-1, 1]) b.member([sx * TW, 0, sn * 24], [sx * TW, AX + 2, 0], 1.2, 4);
    b.member([sx * TW, 0, -24], [sx * TW, 0, 24], 1.5, 4);
    b.member([sx * TW, 20, -15], [sx * TW, 20, 15], 0.8, 4);
    b.member([sx * TW, 0, -24], [sx * TW, 20, 15], 0.6, 4);
    b.member([sx * TW, 0, 24], [sx * TW, 20, -15], 0.6, 4);
  }
  // the track's two cross girders between the towers' feet
  for (const sn of [-1, 1]) b.member([-TW, 1, sn * 24], [TW, 1, sn * 24], 1.0, 4);
  b.light(Q(0, R + 0.5, 0), 0);
  return b.result();
}

// ------------------------------------------------------------------ Toulouse

// The rocket at the Cité de l'espace: a full-size launcher on its pad, about 53 m [the article: 55 m]. A plain
// white core (5.4 m across) with its fairing, two boosters (3 m across, 31 m [EST]) at its sides; no markings.
export function rocket(brg = 0) {
  const b = new Builder(0.59).frame(0, 0, brg);
  b.set(PLAIN([0.46, 0.46, 0.45], 0.1));
  box(b, 0, 0, 0, 2.5, 9, 6);                            // the pad
  b.set(PLAIN([0.74, 0.74, 0.72], 0.3, { glow: [0.30, 0.30, 0.32] }));
  profile(b, 0, 0, [[2.5, 2.7], [33, 2.7], [34, 2.6], [40, 2.6], [41, 2.7], [46, 2.7], [49.5, 2.2], [51.8, 1.2], [53, 0.2]], 16);
  for (const sx of [-1, 1]) profile(b, sx * 4.6, 0, [[1.5, 1.6], [2.5, 1.5], [29, 1.5], [31.5, 0.8], [33, 0.2]], 12);
  b.light([0, 53, 0], 0);
  return b.result();
}

Object.assign(EUROPE_MODELS, { fernsehturm, brandenburg, stephansdom, donauturm, riesenrad, duomo, ponte25, cristorei, vascodagama,
  oresund, torso, poolbeg, palaisjustice, lovell, rocket });

// ================================================================== v0.7.2: Europe's next landmarks (briefs/V0-7-2.md part 4)
// The same rules: our own massing from public figures, no logos, lettering or names. Added to EUROPE_MODELS below.

const DARKSTONE = [0.33, 0.31, 0.28], GRANITE = [0.55, 0.53, 0.48], FORTH_RED = [0.50, 0.12, 0.07], BASALT = [0.13, 0.135, 0.115];   // (the pictures-only review: the rock drew as a pale slab at 0.27; dark basalt under grass)

// A bridge's deck along local n: a box girder (half width hw, depth d) whose top follows top(n), from n0 to n1, cut
// every `step` metres and at the `extra` points.
function deckAlong(b, top, n0, n1, hw, d, step, extra = []) {
  const ns = [];
  for (let n = n0; n < n1; n += step) ns.push(n);
  ns.push(n1);
  for (const e of extra) if (e > n0 && e < n1 && !ns.includes(e)) ns.push(e);
  ns.sort((p, q) => p - q);
  const q = (x, y, n) => b.T([x, y, n]);
  for (let i = 0; i + 1 < ns.length; i++) {
    const na = ns[i], nb = ns[i + 1], ya = top(na), yb = top(nb);
    const c = b.T([0, (ya + yb) / 2 - d / 2, (na + nb) / 2]);
    const A = [q(-hw, ya - d, na), q(hw, ya - d, na), q(hw, ya, na), q(-hw, ya, na)];
    const B = [q(-hw, yb - d, nb), q(hw, yb - d, nb), q(hw, yb, nb), q(-hw, yb, nb)];
    for (let k = 0; k < 4; k++) { const k1 = (k + 1) % 4; b.tri(A[k], A[k1], B[k1], c); b.tri(A[k], B[k1], B[k], c); }
    if (i === 0) { b.tri(A[0], A[1], A[2], c); b.tri(A[0], A[2], A[3], c); }
    if (i + 2 === ns.length) { b.tri(B[0], B[1], B[2], c); b.tri(B[0], B[2], B[3], c); }
  }
}
// A deck's top: `y` within |n| <= m, then straight down to the ground read at each end (a few metres at least).
const rampTop = (g, m, y) => (n) => {
  const a = Math.abs(n);
  if (a <= m) return y;
  const end = n < 0 ? g.n0 : g.n1, h = Math.max(n < 0 ? g.h0 : g.h1, 3) + 0.3;
  return lerp(y, h, Math.min((a - m) / Math.max(Math.abs(end) - m, 1), 1));
};
// Piers under a deck beyond |n| = m, every `step`, where the deck is clear of the water by 3 m.
function piersAlong(b, g, top, d, m, step, hx, hn) {
  for (const side of [-1, 1]) {
    const end = Math.abs(side < 0 ? g.n0 : g.n1);
    for (let a = m + step; a < end - 25; a += step) { const y = top(side * a) - d; if (y > 3) box(b, 0, side * a, 0, y, hx, hn, 0, { capTop: false }); }
  }
}

// ------------------------------------------------------------------ Cologne and Düsseldorf

// Cologne Cathedral: the twin west spires 157.4 m, the church 144.5 m long (local x, east to the choir) and 86.25 m
// across the transept. Dark stone: the five-aisled nave (the aisles' and clerestory's heights and the roof's ridge, about
// 61 m, [EST]), the transept, the choir and its apse, the buttresses' pinnacles along the sides, the towers stepping in
// to their open octagons and the spires; the ridge turret over the crossing [EST]. Floodlit at night.
export function koelnerdom(brg = 0) {
  const b = new Builder(0.61).frame(0, 0, brg);
  const stone = GLASS(DARKSTONE, 9.0, 4.5, 0.0, 0.08, { glow: flood(0.9) });
  const L = 144.5 / 2, H = 157.4, WX = -L + 12.5;
  b.set(stone);
  box(b, -10, 0, 0, 19, 38, 22);                           // the aisles
  box(b, -10, 0, 19, 43, 38, 8.5);                         // the nave's clerestory
  box(b, 14, 0, 0, 43, 14, 43.1);                          // the transept
  box(b, 40, 0, 0, 19, 12, 22);                            // the choir's aisles
  box(b, 40, 0, 19, 43, 12, 8.5);                          // the choir
  profile(b, 52, 0, [[0, 20], [19, 20]], 12, false);       // the chevet's chapels
  profile(b, 52, 0, [[19, 8.5], [43, 8.5]], 10, false);    // the apse
  b.set(PLAIN(SLATE, 0.2, { glow: flood(0.3) }));
  gable(b, -10, 0, 43, 61, 38, 8.5, true);
  gable(b, 14, 0, 43, 61, 8.5, 43.1);
  gable(b, 40, 0, 43, 61, 12, 8.5, true);
  profile(b, 52, 0, [[43, 8.5], [59, 0.5]], 10);
  spire(b, 14, 0, 61, 109, 2.4, 8);                        // the crossing's ridge turret
  b.set(stone);
  for (let x = -44; x <= 60; x += 9) if (Math.abs(x - 14) > 12) for (const s of [-1, 1]) spire(b, x, s * 22, 19, 36, 1.1, 4);
  // the west towers: square to 60 m, stepping in to 100 m, the open octagon, the spire
  for (const s of [-1, 1]) {
    const tn = s * 18.5;
    box(b, WX, tn, 0, 60, 12.5, 12.5);
    b.loft([at(shift(chamferRect(12.5, 12.5, 2), WX, tn), 60), at(shift(chamferRect(10, 10, 2.5), WX, tn), 100)], { capTop: false });
    b.loft([at(shift(circle(10, 8, Math.PI / 8), WX, tn), 100), at(shift(circle(8.5, 8, Math.PI / 8), WX, tn), 110)], { capTop: false });
    spire(b, WX, tn, 110, H, 8.5, 8);
    for (const [dx, dn] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) spire(b, WX + dx * 10.5, tn + dn * 10.5, 60, 76, 1.3, 4);
    b.light([WX, H, tn], 1);
    b.light([WX + 9, 100, tn], 0);
  }
  // the west front between the towers, with its gable
  box(b, WX - 4, 0, 0, 44, 8, 6);
  return b.result();
}

// Düsseldorf's Rheinturm: 240.5 m, on the Rhine's bank. A slim tapering concrete shaft, the pod with the observation
// deck at 168 m and the revolving restaurant at 172.5 m, the shaft on above it and the antenna mast; the shaft's
// and the pod's sizes [EST].
export function rheinturm() {
  const b = new Builder(0.63);
  tvTower(b, { H: 240.5, r0: 8.4, r1: 4.4, podY0: 160, pod: [[160, 4.4], [163, 10], [166, 13.5], [175, 13.5], [178, 12.5], [181, 10.5], [185, 4.6]],
    shaftTop: 198, shaftR: 3.6, mastR: 1.8, bands: 6, foot: [[0, 14], [5, 13], [8, 8.6]] });
  return b.result();
}

// ------------------------------------------------------------------ Prague

// The Žižkov television tower: 216 m. Three steel tubes filled with concrete on a triangle, two to the decks at
// about 134 m and the third on to 191 m and the antenna; nine pods clinging to the tubes in threes (the restaurant's
// at about 63 m, the observation pods at about 93 m, the equipment pods under the decks); the heights and sizes [EST].
export function zizkov(brg = 0) {
  const b = new Builder(0.65).frame(0, 0, brg);
  const steel = PLAIN([0.60, 0.60, 0.58], 0.25, { glow: [0.14, 0.14, 0.16] });
  const R = 7.5, tubes = [0, 1, 2].map((k) => { const a = Math.PI / 2 + (k * TAU) / 3; return [R * Math.cos(a), R * Math.sin(a), Math.cos(a), Math.sin(a)]; });
  b.set(steel);
  tubes.forEach(([x, n], k) => cyl(b, x, n, 0, k === 0 ? 191 : 134, k === 0 ? 3.3 : 2.8, k === 0 ? 3.0 : 2.6, 10));
  b.set(PLAIN([0.66, 0.66, 0.64], 0.2, { glow: [0.18, 0.18, 0.20] }));
  const tri = tubes.map(([x, n]) => [x * 1.75, n * 1.75]);
  for (const [y0, y1] of [[116, 122], [128, 134]]) b.loft([at(tri, y0), at(tri, y1)], { capBottom: true });
  cyl(b, tubes[0][0], tubes[0][1], 168, 175, 6.5, 6.5, 8, { capBottom: true });
  b.set(PLAIN([0.70, 0.70, 0.68], 0.35, { glow: [0.22, 0.22, 0.25] }));
  for (const [x, n, ux, un] of tubes) for (const y of [63, 93, 108]) {
    const px = x + ux * 5.8, pn = n + un * 5.8;
    profile(b, px, pn, [[y - 5.5, 1.5], [y - 4.5, 4.2], [y + 3.5, 4.2], [y + 4.5, 1.5]], 8);
  }
  b.set(PLAIN([0.60, 0.07, 0.04], 0.2));
  cyl(b, tubes[0][0], tubes[0][1], 191, 216, 1.2, 0.3, 6);
  b.light([tubes[0][0], 216, tubes[0][1]], 1);
  for (const [x, n] of tubes) b.light([x * 1.75, 134.5, n * 1.75], 0);
  b.light([tubes[0][0], 191, tubes[0][1]], 0);
  return b.result();
}

// Prague Castle and St Vitus Cathedral: the cathedral 124 x 60 m (local x, east), its main tower 102.8 m (the
// article; about 97 m the commonly quoted figure) on the south side with its Baroque helm, the twin west spires 82 m,
// the nave's vault 33.2 m (the roof's ridge [EST]); round it the castle's long low ranges and the Old Royal Palace on a
// terrace along the ridge above the river (their plans and heights [EST], the castle about 570 m long, drawn shorter).
export function stvitus(brg = 0) {
  const b = new Builder(0.69).frame(0, 0, brg);
  const stone = GLASS([0.55, 0.52, 0.45], 8.0, 4.5, 0.0, 0.08, { glow: flood(0.9) });
  const plaster = GLASS([0.70, 0.67, 0.58], 4.0, 4.0, 0.0, 0.15, { glow: flood(0.5) });
  b.set(PLAIN(GRANITE, 0.05));
  box(b, -20, -5, 0, 4, 105, 72);                           // the terrace on the ridge
  b.set(plaster);
  for (const [x, n, hx, hn, h] of [[-25, -68, 100, 8, 22], [-110, -5, 10, 55, 20], [-60, 58, 50, 8, 18], [45, 58, 30, 8, 16], [55, -45, 28, 18, 20]]) {
    box(b, x, n, 4, h, hx, hn);
    b.set(PLAIN(TILES, 0.15)); gable(b, x, n, h, h + 7, hx, hn, hx > hn); b.set(plaster);
  }
  b.set(stone);
  box(b, -8, 0, 4, 30, 52, 16);                             // the nave and aisles
  box(b, -8, 0, 30, 40, 52, 7);                             // the clerestory
  box(b, 12, 0, 4, 34, 7, 30);                              // the transept
  profile(b, 44, 0, [[4, 16], [30, 16], [30, 9], [40, 9]], 10, false);   // the choir's chevet
  b.set(PLAIN([0.22, 0.24, 0.25], 0.25, { glow: flood(0.3) }));
  gable(b, -8, 0, 40, 52, 52, 7, true);
  gable(b, 12, 0, 34, 46, 7, 30);
  profile(b, 44, 0, [[40, 9], [50, 0.5]], 10);
  b.set(stone);
  spire(b, 22, 0, 52, 70, 2, 8);                            // the ridge turret
  // the west front's twin spires, 82 m
  for (const s of [-1, 1]) { box(b, -58, s * 11, 4, 52, 5, 5); spire(b, -58, s * 11, 52, 82, 5, 8); }
  // the great south tower: square to 56 m, the Renaissance gallery, the Baroque helm and lantern
  const TX = 18, TN = -24;
  box(b, TX, TN, 4, 56, 8, 8);
  box(b, TX, TN, 56, 66, 7, 7);
  b.set(PLAIN(COPPER, 0.3, { glow: flood(0.5) }));
  profile(b, TX, TN, [[66, 7], [72, 6.5], [77, 3.5], [80, 2], [84, 3.6], [88, 2.4], [92, 1.2], [102.8, 0.15]], 8);
  b.light([TX, 102.8, TN], 0);
  return b.result();
}

// ------------------------------------------------------------------ Geneva

// The Jet d'Eau: a plume of water about 140 m high (the brief; the article says the water is jetted to 150 m) at the
// end of a stone jetty from the lake's left bank. A thin pale cone leaning a little downwind (local +x [EST]), wider
// and paler towards its top, where the spray falls back; the jetty about 150 m long towards the shore (local -n)
// [EST]. Lit at night.
export function jetdeau(brg = 0) {
  const b = new Builder(0.71).frame(0, 0, brg);
  b.set(PLAIN(GRANITE, 0.05));
  box(b, 0, -75, 0, 1.6, 2.6, 75);
  box(b, 0, 0, 0, 1.8, 4, 4);
  const H = 140, lean = Math.tan(4 * DEG);
  const rings = [[1.8, 0.4], [20, 1.0], [50, 2.0], [85, 3.4], [115, 5.0], [131, 6.4], [137, 5.2], [H, 0.8]];
  const cols = [[0.70, 0.74, 0.76], [0.74, 0.77, 0.79], [0.78, 0.80, 0.82], [0.80, 0.82, 0.84], [0.84, 0.86, 0.87], [0.86, 0.88, 0.89], [0.88, 0.89, 0.90]];
  for (let i = 0; i + 1 < rings.length; i++) {
    b.set(PLAIN(cols[i], 0.5, { glow: [0.42, 0.44, 0.48].map((v) => v * (0.8 + 0.05 * i)) }));
    const [y0, r0] = rings[i], [y1, r1] = rings[i + 1];
    b.loft([at(shift(circle(r0, 10), y0 * lean, 0), y0), at(shift(circle(r1, 10), y1 * lean, 0), y1)], { smooth: true, capTop: i + 2 === rings.length });
  }
  return b.result();
}

// ------------------------------------------------------------------ the Forth bridges, west of Edinburgh

// The Forth Bridge (1890): a cantilever railway bridge, 2,467 m (8,094 ft) long, its three double cantilevers 110 m
// (361 ft) above high water, two main spans of 1,700 ft (518 m) between them. Each cantilever: four tubular legs on
// granite piers, the bottom tubes sweeping out and up to the arms' tips 207 m out, the ties from the top down to them,
// and the suspended girder (107 m) between two tips; the middle (Inchgarvie) cantilever wider at its foot. The rail
// deck about 48 m up [EST], the approach viaducts on granite piers every 51 m [EST], the deck down to the ground read
// at its ends. Red. Lights at the towers' tops.
export function forthbridge(brg = -15, geo = {}) {
  const b = new Builder(0.73).frame(0, 0, brg);
  const g = { s: 552, n0: -1360, n1: 1107, h0: 30, h1: 30, ...geo };
  const S = g.s, DY = 48, ARM = 207, TOP = 110, W0 = 18, W1 = 5;
  const towers = [[-S, 11], [0, 20], [S, 11]];
  const M = S + 11 + ARM;
  const top = rampTop(g, M, DY);
  b.set(PLAIN([0.30, 0.28, 0.26], 0.1));
  deckAlong(b, top, g.n0, g.n1, 5, 3, 120, [-M, M]);
  b.set(PLAIN(GRANITE, 0.05));
  piersAlong(b, g, top, 3, M, 51, 4, 3);
  for (const [Tn, a] of towers) for (const sn of [-1, 1]) box(b, 0, Tn + sn * a, 0, 6, W0 + 4, 6);
  b.set(PLAIN(FORTH_RED, 0.2, { glow: [0.20, 0.06, 0.03] }));
  const wAt = (y) => lerp(W0, W1, (y - 6) / (TOP - 6));
  for (const [Tn, a] of towers) {
    for (const sn of [-1, 1]) for (const sx of [-1, 1]) b.member([sx * W0, 6, Tn + sn * a], [sx * W1, TOP, Tn + sn * a], 1.8, 4);
    for (const y of [6, 58, TOP - 4]) {
      const w = wAt(y);
      for (const sn of [-1, 1]) b.member([-w, y, Tn + sn * a], [w, y, Tn + sn * a], 1.0, 4);
      for (const sx of [-1, 1]) b.member([sx * w, y, Tn - a], [sx * w, y, Tn + a], 1.0, 4);
    }
    for (const sx of [-1, 1]) { b.member([sx * W0, 6, Tn - a], [sx * wAt(TOP - 4), TOP - 4, Tn + a], 0.8, 4); b.member([sx * W0, 6, Tn + a], [sx * wAt(TOP - 4), TOP - 4, Tn - a], 0.8, 4); }
    for (const dir of [-1, 1]) {
      const nA = Tn + dir * a, nT = Tn + dir * (a + ARM);
      const bot = (t, sx) => [sx * lerp(W0, W1, t), lerp(6, DY - 1, t ** 0.8), lerp(nA, nT, t)];
      const tie = (t, sx) => [sx * W1, lerp(TOP, DY + 3, t), lerp(nA, nT, t)];
      const T = [0, 0.25, 0.5, 0.75, 1];
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 4; i++) { b.member(bot(T[i], sx), bot(T[i + 1], sx), 1.8, 4); b.member(tie(T[i], sx), tie(T[i + 1], sx), 1.0, 4); }
        for (let i = 1; i < 4; i++) b.member(bot(T[i], sx), tie(T[i], sx), 0.8, 4);
        for (let i = 0; i < 4; i++) b.member(bot(T[i], sx), tie(T[i + 1], sx), 0.6, 4);
      }
      for (let i = 1; i < 4; i++) b.member(bot(T[i], -1), bot(T[i], 1), 0.6, 4);
    }
    for (const sn of [-1, 1]) for (const sx of [-1, 1]) b.light([sx * W1, TOP + 1, Tn + sn * a], 1);
    b.light([0, 58, Tn], 0);
  }
  // the suspended girders between the arms' tips: two trusses, 10 m deep at the middle
  for (const [nA, nB] of [[-S + 11 + ARM, -20 - ARM], [20 + ARM, S - 11 - ARM]]) {
    const K = 5, P = (k, up, sx) => [sx * W1, DY - 1 + (up ? 4 + 6 * Math.sin(Math.PI * k / K) : 0), lerp(nA, nB, k / K)];
    for (const sx of [-1, 1]) for (let k = 0; k < K; k++) {
      b.member(P(k, 0, sx), P(k + 1, 0, sx), 0.9, 4); b.member(P(k, 1, sx), P(k + 1, 1, sx), 0.7, 4);
      if (k > 0) b.member(P(k, 0, sx), P(k, 1, sx), 0.5, 4);
      b.member(P(k, 0, sx), P(k + 1, 1, sx), 0.4, 4);
    }
  }
  return b.result();
}

// The Forth Road Bridge: a suspension bridge, 2,512 m long with its approach viaducts, the main span 1,006 m, the
// towers 156 m; the side spans (408 m) to the anchorages, the deck 33 m wide on its stiffening truss about 50 m clear
// [EST], the approach viaducts' piers every 100 m [EST]; grey. Cables and a handful of hangers as thin lines.
export function forthroad(brg = -5, geo = {}) {
  const b = new Builder(0.75).frame(0, 0, brg);
  const g = { s: 503, n0: -1256, n1: 1256, h0: 30, h1: 30, ...geo };
  const S = g.s, A = S + 408, H = 156, DECK = 50, D = 7, HW = 16.5, TX = 17;
  const top = rampTop(g, A, DECK + D);
  b.set(PLAIN([0.46, 0.48, 0.48], 0.25, { glow: [0.10, 0.10, 0.12] }));
  deckAlong(b, top, g.n0, g.n1, HW, D, 100, [-A, A, -S, S]);
  b.set(PLAIN(CONCRETE, 0.1));
  piersAlong(b, g, top, D, A, 100, 9, 3);
  for (const s of [-1, 1]) box(b, 0, s * A, 0, DECK + D + 2, 20, 14);           // the anchorages
  const grey = PLAIN([0.52, 0.54, 0.54], 0.25, { glow: [0.14, 0.14, 0.16] });
  for (const n of [-S, S]) {
    b.set(PLAIN(CONCRETE, 0.1)); box(b, 0, n, 0, 10, TX + 8, 9); b.set(grey);
    for (const sx of [-1, 1]) b.loft([at(shift(chamferRect(3.2, 4.5, 0.8), sx * TX, n), 10), at(shift(chamferRect(2.4, 3.4, 0.6), sx * TX, n), H)]);
    for (const y of [DECK - 4, 105, H - 7]) box(b, 0, n, y, y + 4, TX - 2, 2.2, 0, { capBottom: true });
    for (const sx of [-1, 1]) { b.light([sx * TX, H, n], 1); b.light([sx * (TX + 3), 105, n], 0); }
  }
  const tp = H - 2, low = DECK + D + 2;
  const cy = (n) => { const a = Math.abs(n); return a <= S ? low + (tp - low) * (a / S) ** 2 : lerp(tp, DECK + D, (a - S) / (A - S)) - 8 * Math.sin(Math.PI * (a - S) / (A - S)); };
  const ns = [];
  for (let k = 0; k <= 16; k++) ns.push(lerp(-S, S, k / 16));
  for (let k = 1; k <= 4; k++) { ns.push(S + (A - S) * k / 4); ns.push(-S - (A - S) * k / 4); }
  ns.sort((p, q) => p - q);
  b.set(PLAIN([0.40, 0.42, 0.42], 0.35));
  for (const sx of [-1, 1]) {
    for (let i = 0; i + 1 < ns.length; i++) b.member([sx * TX, cy(ns[i]), ns[i]], [sx * TX, cy(ns[i + 1]), ns[i + 1]], 0.6, 3);
    for (const n of ns) if (Math.abs(Math.abs(n) - S) > 1 && Math.abs(n) < A - 1 && cy(n) - DECK - D > 2) b.member([sx * TX, cy(n), n], [sx * TX, DECK + D, n], 0.2, 3);
  }
  return b.result();
}

// The Queensferry Crossing (2017): cable-stayed, about 2.7 km long, three single towers 207 m in the deck's middle,
// two main spans of 650 m; the stays in a central plane, crossing over at the middle of each main span; the cable-
// stayed part about 2,070 m [EST], the deck about 40 m wide [EST] and about 50 m clear [EST], the approach viaducts'
// piers every 115 m [EST]; the deck down to the ground read at its ends.
export function queensferry(brg = 20, geo = {}) {
  const b = new Builder(0.77).frame(0, 0, brg);
  const g = { s: 650, n0: -1350, n1: 1350, h0: 30, h1: 30, ...geo };
  const S = g.s, M = S + 385, H = 207, CLEAR = 50, D = 5, HW = 20;
  const top = rampTop(g, M, CLEAR + D);
  b.set(PLAIN([0.50, 0.51, 0.51], 0.25, { glow: [0.10, 0.10, 0.12] }));
  deckAlong(b, top, g.n0, g.n1, HW, D, 100, [-M, M, -S, S, 0]);
  b.set(PLAIN(CONCRETE, 0.1));
  piersAlong(b, g, top, D, S, 115, 8, 3);
  const tower = PLAIN([0.64, 0.64, 0.62], 0.12, { glow: [0.18, 0.18, 0.21] });
  for (const Tn of [-S, 0, S]) {
    b.set(tower);
    b.loft([at(shift(chamferRect(5, 9, 1.5), 0, Tn), 0), at(shift(chamferRect(3.6, 6.5, 1.2), 0, Tn), CLEAR), at(shift(chamferRect(2.6, 4.2, 0.8), 0, Tn), H)]);
    b.light([0, H, Tn], 1);
    for (const y of [150, 100]) for (const sx of [-1, 1]) b.light([sx * 3.4, y, Tn], 0);
    b.set(PLAIN([0.72, 0.72, 0.70], 0.4));
    for (let k = 0; k < 8; k++) {
      const y = lerp(105, H - 8, k / 7), t = (k + 1) / 8;
      for (const dir of [-1, 1]) {
        const reach = Tn === 0 || dir * Math.sign(Tn) < 0 ? 400 : M - S - 30;
        const n = Tn + dir * reach * t;
        b.member([0, y, Tn], [1.5 * (k % 2 ? 1 : -1), top(n), n], 0.35, 3);
      }
    }
  }
  return b.result();
}

// ------------------------------------------------------------------ Edinburgh

// Edinburgh Castle on its rock: the crag rising about 80 m above the streets round it (the article; the summit 130 m
// above the sea), cliffs to the south, west and north, the castle's walls along the top and its low stone buildings:
// the palace and the great hall round the summit's square, the long barracks, the half-moon battery over the
// esplanade, the little chapel. The game's 250 m ground smooths the crag away, so the model brings its own: 70 m of
// rock [EST] from the lowest ground round it, the buildings 6 to 20 m above it; their plans [EST].
export function edinburghcastle(brg = 0) {
  const b = new Builder(0.79).frame(0, 0, brg);
  const ROCK = 70;
  b.set(PLAIN(BASALT, 0.05));
  const r0 = shift(superellipse(130, 95, 2.4, 16), 5, 0), r1 = shift(superellipse(112, 74, 2.6, 16), 0, 2), r2 = shift(superellipse(100, 62, 3, 16), -2, 2);
  b.loft([at(r0, 0), at(r1, ROCK * 0.55), at(r2, ROCK)], { capTop: true });
  const stone = GLASS([0.36, 0.34, 0.30], 4.0, 4.5, 0.0, 0.12, { glow: flood(0.8) });
  b.set(stone);
  strip(b, resample(superellipse(97, 59, 3, 16), 24), ROCK, ROCK + 6);           // the curtain walls
  const R = ROCK;
  box(b, 10, -10, R, R + 18, 28, 9);                        // the palace and great hall's range
  box(b, 25, 12, R, R + 14, 9, 16);                         // the palace's east range
  box(b, -40, -38, R, R + 16, 34, 8);                       // the barracks on the south-west
  box(b, -45, 20, R, R + 12, 22, 10);                       // the hospital and stores
  box(b, -5, 30, R, R + 10, 18, 7);                         // the north range
  box(b, -18, 5, R + 6, R + 20, 3.5, 2.5);                  // the chapel on the summit
  profile(b, 70, -5, [[R, 22], [R + 18, 22]], 12, true);    // the half-moon battery
  box(b, 30, -10, R + 18, R + 20, 1.5, 1.5);
  b.set(PLAIN(SLATE, 0.2));
  gable(b, 10, -10, R + 18, R + 20, 28, 9, true);
  gable(b, -40, -38, R + 16, R + 19, 34, 8, true);
  gable(b, -45, 20, R + 12, R + 15, 22, 10, true);
  b.light([10, R + 20, -10], 0);
  return b.result();
}

// ------------------------------------------------------------------ Santiago de Compostela

// Santiago de Compostela Cathedral: about 100 m long (local x, east) and 70 m across the transept; the west front's
// twin towers about 74 m [EST] over the Baroque facade; the Romanesque nave and aisles behind (their heights [EST]),
// the crossing's lantern tower; the clock tower over the south-east corner, rising to 75 m (the article); granite.
export function santiago(brg = 0) {
  const b = new Builder(0.81).frame(0, 0, brg);
  const granite = GLASS([0.58, 0.54, 0.44], 6.0, 4.0, 0.0, 0.1, { glow: flood(1.0) });
  b.set(granite);
  box(b, -2, 0, 0, 16, 40, 16);                             // the aisles
  box(b, -2, 0, 16, 25, 40, 7);                             // the nave
  box(b, 12, 0, 0, 25, 8, 35);                              // the transept
  profile(b, 40, 0, [[0, 15], [16, 15], [16, 8], [24, 8]], 10, false);   // the ambulatory and apse
  b.set(PLAIN([0.46, 0.43, 0.36], 0.1, { glow: flood(0.4) }));
  gable(b, -2, 0, 25, 32, 40, 7, true);
  gable(b, 12, 0, 25, 32, 8, 35);
  b.set(granite);
  profile(b, 12, 0, [[25, 8], [42, 8], [44, 5.5], [48, 1.5]], 8);         // the crossing's lantern
  // the west front: the facade between the towers, the two towers
  box(b, -46, 0, 0, 40, 5, 9);
  b.loft([at([[5, -9], [5, 9], [-5, 9], [-5, -9]].map(([x, n]) => [x - 46, n]), 40), at([[5, -3], [5, 3], [-5, 3], [-5, -3]].map(([x, n]) => [x - 46, n]), 48)]);
  for (const s of [-1, 1]) {
    const tn = s * 14.5;
    box(b, -46, tn, 0, 42, 6, 6);
    box(b, -46, tn, 42, 56, 4.6, 4.6);
    profile(b, -46, tn, [[56, 3.8], [64, 3.4], [66, 2.6], [70, 1.6], [74, 0.2]], 8);
  }
  // the clock tower
  const CX = 28, CN = -28;
  box(b, CX, CN, 0, 44, 6.5, 6.5);
  b.loft([at(shift(circle(6.2, 8, Math.PI / 8), CX, CN), 44), at(shift(circle(5.2, 8, Math.PI / 8), CX, CN), 58), at(shift(circle(4, 8, Math.PI / 8), CX, CN), 66)], { capTop: false });
  profile(b, CX, CN, [[66, 4], [70, 3], [72, 1.2], [75, 0.2]], 8);
  b.light([CX, 75, CN], 0);
  return b.result();
}

Object.assign(EUROPE_MODELS, { koelnerdom, rheinturm, zizkov, stvitus, jetdeau, forthbridge, forthroad, queensferry, edinburghcastle, santiago });

// ================================================================== v0.7.3: Europe's last landmarks (briefs/V0-7-3.md)
// The same rules: our own massing from public figures, no logos, lettering or names. Added to EUROPE_MODELS below.
// (Linear colours: a dark stone or brick about 0.12 to 0.3, so it doesn't draw as pale concrete in sunlight.)

const HH_BRICK = [0.26, 0.12, 0.07], VEN_BRICK = [0.40, 0.19, 0.11], VERDIGRIS = [0.22, 0.38, 0.32], GILT = [0.72, 0.52, 0.16];
const MARS_PALE = [0.50, 0.47, 0.40], MARS_GREEN = [0.16, 0.20, 0.17], LYON_WHITE = [0.56, 0.55, 0.51], IRON = [0.20, 0.21, 0.21];

// ------------------------------------------------------------------ Hamburg

// The Elbphilharmonie: 108 m at its western tip (the article; about 110 m the brief's). The brick warehouse below (eight
// floors in the brick facade, about 37 m [EST]) on a plan narrowing to the point at the west (local -x), about 110 m long
// [EST]; the glass body above it, the roof rising in waves to its peaks at the western tip; the plan's sizes and the
// waves [EST]. Lit inside at night.
// v0.7.8 (LANDMARKS78): elbphil78() below, the roof as a surface of waves; switch off, v0.7.3's model (elbphil77).
export function elbphil(brg = 0) { return LANDMARKS78 ? elbphil78(brg) : elbphil77(brg); }

// v0.7.8: the Elbphilharmonie's glass top as it reads from the river and the air ("Found while building v0.7.3": coarse).
// The same brick warehouse and plan (v0.7.3's). Over the brick, the Plaza's dark recessed band (37 to 41 m: the public
// terrace between the old and the new, the article); the glass body above it to the roof's edge; the roof a surface of
// five crests across the building, falling from the 108 m peak at the western tip to about 80 m in the east, each crest
// sharp and each trough between them a broad concave saddle, and a little higher at the long sides than along the middle
// (the crests' heights and places, the saddles' depth and the Plaza's height [EST], from public photographs). The glass
// with its floors and a warm light at night; the roof pale.
function elbphil78(brg = 0) {
  const b = new Builder(0.83).frame(0, 0, brg);
  const plan = resample([[56, -21], [56, 19], [-40, 11], [-56, 2], [-54, -9], [-36, -18]], 48);
  const BRICKTOP = 37, PLAZA = 41, TOP = 108;
  b.set(GLASS(HH_BRICK, 4.6, 3.2, 0.25, 0.15, { glow: [0.10, 0.06, 0.04] }));
  b.loft([at(plan, 0), at(plan, BRICKTOP)], { capTop: true });
  // the Plaza: a dark band set 1.5 m in
  const cxp = plan.reduce((s, p) => s + p[0], 0) / plan.length, cnp = plan.reduce((s, p) => s + p[1], 0) / plan.length;
  const inset = (ring, d) => ring.map(([x, n]) => { const dx = x - cxp, dn = n - cnp, l = Math.hypot(dx, dn) || 1; return [x - dx / l * d, n - dn / l * d]; });
  b.set(GLASS([0.06, 0.065, 0.07], 4.0, 6.0, 0.5, 0.5, { glow: [0.32, 0.27, 0.20] }));
  b.loft([at(inset(plan, 1.5), BRICKTOP), at(inset(plan, 1.5), PLAZA)], { capTop: false });
  // the roof's height: crests [t from the west tip (0) to the east end (1), height], saddles between them 13 m below the
  // lower crest; the long sides up to 3 m higher than the middle
  const CRESTS = [[0, TOP], [0.24, 99], [0.47, 93], [0.71, 87], [1, 82]];
  const hw = 21;
  const roofH = (x, n) => {
    const t = Math.min(Math.max((x + 56) / 112, 0), 1);     // (0 at the western tip, local -x)
    let i = 0;
    while (i < CRESTS.length - 2 && t > CRESTS[i + 1][0]) i++;
    const [t0, h0] = CRESTS[i], [t1, h1] = CRESTS[i + 1], u = (t - t0) / (t1 - t0);
    const sad = Math.min(h0, h1) - 13, w = (1 - Math.cos(2 * Math.PI * u)) / 2;
    const h = lerp(h0, h1, u) - (lerp(h0, h1, u) - sad) * Math.sqrt(w);
    return Math.min(h + 3 * Math.min((n / hw) ** 2, 1), TOP);
  };
  const tip = plan.reduce((a, p) => (p[0] < a[0] ? p : a), plan[0]);
  const edge = plan.map((p) => (p === tip ? TOP : roofH(p[0], p[1])));
  b.set(GLASS([0.30, 0.35, 0.40], 4.0, 3.0, 0.85, 0.35, { glow: [0.30, 0.27, 0.22] }));
  b.loft([at(plan, PLAZA), at(plan, PLAZA + 2), plan.map((p, i) => [p[0], edge[i], p[1]])], { capTop: false });
  // the roof: rings drawn in from the edge to the middle, each point at the roof's height there
  b.set(PLAIN([0.60, 0.61, 0.60], 0.3, { glow: [0.08, 0.08, 0.09] }));
  const K = 6, rings = [];
  for (let k = 0; k <= K; k++) {
    const s = 1 - k / K * 0.96;
    rings.push(plan.map((p, i) => {
      const x = cxp + (p[0] - cxp) * s, n = cnp + (p[1] - cnp) * s;
      return k === 0 ? [p[0], edge[i], p[1]] : [x, roofH(x, n), n];
    }));
  }
  for (let k = 0; k < K; k++) for (let i = 0; i < plan.length; i++) {
    const j = (i + 1) % plan.length, A = rings[k][i], B = rings[k][j], C = rings[k + 1][j], D = rings[k + 1][i];
    const below = (p) => b.T([p[0], p[1] - 20, p[2]]);
    b.tri(b.T(A), b.T(B), b.T(C), below(A));
    b.tri(b.T(A), b.T(C), b.T(D), below(A));
  }
  const last = rings[K], mid = [cxp, roofH(cxp, cnp), cnp];
  for (let i = 0; i < plan.length; i++) b.tri(b.T(last[i]), b.T(last[(i + 1) % plan.length]), b.T(mid), b.T([cxp, mid[1] - 20, cnp]));
  b.light([tip[0], TOP, tip[1]], 0);
  return b.result();
}

function elbphil77(brg = 0) {
  const b = new Builder(0.83).frame(0, 0, brg);
  const plan = resample([[56, -21], [56, 19], [-40, 11], [-56, 2], [-54, -9], [-36, -18]], 28);
  const BRICKTOP = 37;
  b.set(GLASS(HH_BRICK, 4.6, 3.2, 0.25, 0.15, { glow: [0.10, 0.06, 0.04] }));
  b.loft([at(plan, 0), at(plan, BRICKTOP)], { capTop: false });
  // the roof's line round the edge: lowest in the east, its waves rising to the peaks at the western tip
  const roof = ([x, n]) => {
    const t = (56 - x) / 112;
    const wave = 7 * Math.abs(Math.sin(t * Math.PI * 3.0 + n * 0.02));
    return Math.min(78 + 18 * t * t + wave, 106);
  };
  const tip = plan.reduce((a, p) => (p[0] < a[0] ? p : a), plan[0]);
  const top = plan.map((p) => [p[0], p === tip ? 108 : roof(p), p[1]]);
  b.set(GLASS([0.30, 0.35, 0.40], 4.0, 3.0, 0.85, 0.35, { glow: [0.30, 0.27, 0.22] }));
  b.loft([at(plan, BRICKTOP), at(plan, BRICKTOP + 2), top], { capTop: false });
  // the roof: fanned from a ridge point over the middle, pale
  b.set(PLAIN([0.60, 0.61, 0.60], 0.3, { glow: [0.08, 0.08, 0.09] }));
  const cx = -6, cn = 0, cy = 92, c = b.T([cx, cy, cn]), below = b.T([cx, cy - 30, cn]);
  for (let i = 0; i < top.length; i++) { const p = top[i], q = top[(i + 1) % top.length]; b.tri(b.T(p), b.T(q), c, below); }
  b.light([tip[0], 108, tip[1]], 0);
  return b.result();
}

// The Heinrich-Hertz-Turm: 279.2 m, a 204 m shaft of reinforced concrete and the steel mast above it (the article); the
// two stacked pods (the restaurant and the platforms) at about 120 to 152 m and the shaft's taper [EST].
export function hht() {
  const b = new Builder(0.85);
  tvTower(b, { H: 279.2, r0: 7.6, r1: 3.8, podY0: 118, pod: [[118, 3.8], [121, 9], [124, 12], [131, 12], [133, 8.5], [136, 5], [139, 9], [142, 11.5], [148, 11.5], [151, 8], [153, 3.8]],
    shaftTop: 204, shaftR: 3.4, mastR: 1.7, bands: 6, foot: [[0, 12], [4, 11], [7, 7.6]] });
  return b.result();
}

// ------------------------------------------------------------------ Venice

// St Mark's Campanile: 98.6 m. The square brick shaft 12 m a side and 50 m tall (the article), the arched belfry above it,
// the attic (the cube), the green pyramid spire and the gilded vane on top (their heights [EST]); beside it to the north-
// east the basilica as a low mass with its five domes on a Greek cross (its plan about 76 x 62 m, the domes about 43 m,
// the placing [EST]).
export function campanile(brg = 0) {
  const b = new Builder(0.87).frame(0, 0, brg);
  const H = 98.6;
  b.set(GLASS(VEN_BRICK, 6.0, 3.0, 0.0, 0.06, { glow: flood(0.7) }));
  box(b, 0, 0, 0, 50, 6, 6);
  b.set(PLAIN([0.60, 0.57, 0.50], 0.1, { glow: flood(0.8) }));
  box(b, 0, 0, 50, 52, 6.5, 6.5, 0, { capBottom: true });                   // the belfry's floor
  for (const [dx, dn] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) box(b, dx * 5.2, dn * 5.2, 52, 61, 1.1, 1.1, 0, { capTop: false });
  box(b, 0, 0, 52, 61, 3.2, 3.2, 0, { capTop: false });                     // the bells' frame inside the arches
  box(b, 0, 0, 61, 63, 6.5, 6.5, 0, { capBottom: true });                   // the cornice
  b.set(PLAIN([0.58, 0.55, 0.48], 0.1, { glow: flood(0.6) }));
  box(b, 0, 0, 63, 72, 5.6, 5.6);                                           // the attic
  b.set(PLAIN(VERDIGRIS, 0.3, { glow: flood(0.3) }));
  b.loft([at([[5.6, -5.6], [5.6, 5.6], [-5.6, 5.6], [-5.6, -5.6]], 72), at([[0.4, -0.4], [0.4, 0.4], [-0.4, 0.4], [-0.4, -0.4]], 94)]);
  b.set(PLAIN(GILT, 0.6, { glow: flood(0.5) }));
  profile(b, 0, 0, [[94, 0.4], [95, 1.1], [97, 0.8], [H, 0.15]], 6);
  b.light([0, H, 0], 0);
  // the basilica: the Greek cross under its five domes
  const BX = 55, BN = 48;
  b.set(GLASS([0.52, 0.48, 0.42], 7.0, 4.0, 0.0, 0.06, { glow: flood(0.6) }));
  box(b, BX, BN, 0, 26, 38, 31);
  box(b, BX - 40, BN, 0, 22, 4, 31);                                        // the west front's narthex
  b.set(PLAIN([0.30, 0.31, 0.30], 0.35, { glow: flood(0.3) }));
  for (const [dx, dn, r] of [[0, 0, 7], [-24, 0, 6.2], [24, 0, 6.2], [0, 22, 6.2], [0, -22, 6.2]]) {
    cyl(b, BX + dx, BN + dn, 26, 30, r + 0.5, r + 0.5, 12);
    domeAt(b, BX + dx, BN + dn, 30, r + 0.5, r === 7 ? 13 : 11, 12, 4);
  }
  return b.result();
}

// ------------------------------------------------------------------ Marseille

// Notre-Dame de la Garde: on its limestone peak (162 m above the sea, the article; the hill the terrain's). The fort's
// walls as a base [EST, 8 m]; the striped basilica of pale and green-grey stone, its nave and dome [EST]; the square bell
// tower over the porch, 41 m (the article), its cylindrical belfry of 12.5 m and the gilded statue of 11.2 m (the
// article) on top. The plan's sizes and the axis [EST].
export function ndg(brg = 0) {
  const b = new Builder(0.89).frame(0, 0, brg);
  const F = 8;
  if (NDG79) { b.below79 = true; ndgRock79(b); }   // v0.7.9 looks: the limestone peak under the fort, down to 36 m under the base
  b.set(PLAIN([0.30, 0.29, 0.26], 0.05, { glow: flood(0.4) }));
  b.loft([at(chamferRect(42, 22, 8), 0), at(chamferRect(40, 20, 7), F)]);   // the fort's base
  const pale = GLASS(MARS_PALE, 2.5, 4.0, 0.0, 0.06, { glow: flood(1.0) }), green = GLASS(MARS_GREEN, 2.5, 4.0, 0.0, 0.06, { glow: flood(0.6) });
  const banded = (y0, y1, fn) => { let k = 0; for (let y = y0; y < y1 - 0.01; y += 2.5, k++) { b.set(k % 2 ? green : pale); fn(y, Math.min(y + 2.5, y1)); } };
  // the nave (local x, the porch at the west, -x) and the choir's dome
  banded(F, F + 18, (y0, y1) => box(b, 4, 0, y0, y1, 26, 9, 0, { capTop: y1 >= F + 18 }));
  b.set(PLAIN([0.42, 0.40, 0.35], 0.15, { glow: flood(0.4) }));
  gable(b, 4, 0, F + 18, F + 24, 26, 9, true);
  banded(F, F + 25, (y0, y1) => cyl(b, 22, 0, y0, y1, 8, 8, 12, { capTop: false }));
  b.set(pale);
  domeAt(b, 22, 0, F + 25, 8, 8, 12, 4);
  // the bell tower over the porch: 41 m above the church's floor
  const TX = -27, TOP = F + 41;
  banded(F, TOP - 4, (y0, y1) => box(b, TX, 0, y0, y1, 5.5, 5.5, 0, { capTop: false }));
  b.set(pale);
  box(b, TX, 0, TOP - 4, TOP, 6.2, 6.2);
  b.set(PLAIN([0.55, 0.36, 0.30], 0.2, { glow: flood(0.8) }));           // the red granite belfry
  cyl(b, TX, 0, TOP, TOP + 12.5, 3.6, 3.2, 12);
  b.set(PLAIN(GILT, 0.7, { glow: [0.55, 0.42, 0.14] }));
  const S = TOP + 12.5;
  profile(b, TX, 0, [[S, 1.6], [S + 3, 1.9], [S + 6.5, 1.5], [S + 8.5, 1.0], [S + 9.6, 0.9], [S + 10.6, 0.6], [S + 11.2, 0.15]], 8);
  b.light([TX, S + 11.2, 0], 0);
  return b.result();
}

// v0.7.9 (NDG79; "Found while building v0.7.8": "the hill is a smooth dome with the streets draped on it: give it its
// steep limestone sides"): the peak as a crag of pale limestone under the fort, its rings rough (two waves of noise
// round each, fixed), stepping out and down from a top 2 m over the fort's walls (the ground's own top, 9.8 m over the base, under
// it: the church's lowest 2 m in the rock) to 36 m under the model's base, where
// the installed ground (the 30 m patch `ndg`) is above it everywhere round (tests/v079-looks-models.test.mjs). Where the
// ground falls away (north, south and west, as the real peak's cliffs) the rock stands out of it in faces of 5 to 20 m;
// to the east and south-east, where the ridge runs on, the ground covers it. Its entry's footprint grows to ROCK_R so
// the centre's buildings and the trees keep off the rock (its `parts` keep the base where it was). Sizes [EST].
export const NDG79_ROCK = [[10, 50, 32], [-6, 60, 42], [-20, 72, 54], [-36, 86, 66]];   // [y, half x, half n]
export const NDG79_ROCK_R = 100;   // the rock's reach (its widest ring with its roughness, 96 m), as footprintM
function ndgRock79(b) {
  const K = 24, rough = (k, j) => 1 + 0.07 * Math.sin(3 * (k / K) * 2 * Math.PI + 1.3 * j) + 0.05 * Math.sin(7 * (k / K) * 2 * Math.PI + 2.1 * j + 0.5);
  const ring = (y, a, n, j) => Array.from({ length: K }, (_, k) => {
    const t = (k / K) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t), e = 2 / 2.6;   // a squarish ellipse (superellipse 2.6)
    return [Math.sign(c) * Math.abs(c) ** e * a * rough(k, j), y, Math.sign(s) * Math.abs(s) ** e * n * rough(k, j)];
  });
  const R = NDG79_ROCK;
  // the upper faces paler, weathered; the lower a shade darker
  b.set(PLAIN([0.27, 0.26, 0.22], 0.05, { glow: [0.05, 0.05, 0.045] }));   // (0.52 then 0.40 read as snow in the sun)
  b.loft([ring(R[2][0], R[2][1], R[2][2], 2), ring(R[1][0], R[1][1], R[1][2], 1), ring(R[0][0], R[0][1], R[0][2], 0)], { smooth: false, capTop: true });
  b.set(PLAIN([0.23, 0.22, 0.19], 0.05));
  b.loft([ring(R[3][0], R[3][1], R[3][2], 3), ring(R[2][0], R[2][1], R[2][2], 2)], { smooth: false, capTop: false });
}

// ------------------------------------------------------------------ Lyon

// The Basilica of Notre-Dame de Fourvière: 86 m long and 35 m wide (the article), white stone; the four octagonal towers at
// its corners about 48 m (the brief), their crenellated tops flat; the nave's and roof's heights, the apse and the axis
// [EST]. (The metal tower beside it is left out.)
export function fourviere(brg = 0) {
  const b = new Builder(0.91).frame(0, 0, brg);
  const white = GLASS(LYON_WHITE, 6.0, 4.5, 0.0, 0.06, { glow: flood(1.0) });
  b.set(white);
  box(b, 0, 0, 0, 26, 37, 15);                                                // the nave
  profile(b, 37, 0, [[0, 12], [24, 12]], 12, false);                          // the apse (east, +x)
  b.set(PLAIN([0.26, 0.27, 0.29], 0.2, { glow: flood(0.3) }));
  gable(b, 0, 0, 26, 34, 37, 15, true);
  profile(b, 37, 0, [[24, 12], [30, 0.6]], 12);
  b.set(white);
  box(b, -38, 0, 0, 30, 4, 11);                                               // the west front between the towers
  for (const [dx, dn] of [[-36, 13], [-36, -13], [30, 13], [30, -13]]) {
    const oct = (r) => shift(circle(r, 8, Math.PI / 8), dx, dn);
    b.loft([at(oct(6.5), 0), at(oct(6.0), 40), at(oct(6.8), 41.5), at(oct(6.8), 48)], { capTop: true });
  }
  for (const [dx, dn] of [[-36, 13], [-36, -13], [30, 13], [30, -13]]) b.light([dx, 48, dn], 0);
  return b.result();
}

// ------------------------------------------------------------------ Porto

// The Dom Luís I Bridge (1886): a two-deck iron arch over the Douro, the arch 172.5 m across (the article), the upper deck
// 395.25 m long (the article) about 45 m above the river (the brief; the article's 70 m unsourced), the lower deck at the
// quays (about 10 m [EST]) between the arch's feet. The arch as two inclined ribs of an upper and a lower chord with a few
// diagonals [EST its depth], posts up to the upper deck, hangers down to the lower; the granite pillars at the arch's feet
// and the iron piers on the slopes [EST]; the upper deck down to the ground read at its ends.
export function domluis(brg = -10, geo = {}) {
  const b = new Builder(0.93).frame(0, 0, brg);
  const g = { s: 86.25, n0: -197.6, n1: 197.6, h0: 30, h1: 30, ...geo };
  const S = g.s, DY = 45, LOW = 10, M = 120;
  const top = rampTop(g, M, DY);
  b.set(PLAIN(IRON, 0.25, { glow: [0.08, 0.08, 0.09] }));
  deckAlong(b, top, g.n0, g.n1, 4, 3.5, 30, [-M, M, -S, S, 0]);
  deckAlong(b, () => LOW, -S - 14, S + 14, 4, 2.5, 50, [-S, S]);
  // the arch: the upper chord meets the upper deck at the crown, the lower chord 9 m under it there, both from the feet
  const ARCH0 = 2, K = 8;
  const up = (n) => ARCH0 + (DY - 3.5 - ARCH0) * (1 - (n / S) ** 2);
  const lo = (n) => ARCH0 + (DY - 12.5 - ARCH0) * (1 - (n / S) ** 2);
  const wx = (y) => lerp(13, 5, (y - ARCH0) / (DY - ARCH0));
  for (const sx of [-1, 1]) {
    for (let k = 0; k < K; k++) {
      const na = lerp(-S, S, k / K), nb = lerp(-S, S, (k + 1) / K);
      b.member([sx * wx(up(na)), up(na), na], [sx * wx(up(nb)), up(nb), nb], 1.1, 4);
      b.member([sx * wx(lo(na)), lo(na), na], [sx * wx(lo(nb)), lo(nb), nb], 1.1, 4);
      if (k > 0) b.member([sx * wx(lo(na)), lo(na), na], [sx * wx(up(na)), up(na), na], 0.5, 4);
      b.member([sx * wx(lo(na)), lo(na), na], [sx * wx(up(nb)), up(nb), nb], 0.4, 4);
    }
  }
  for (let k = 1; k < K; k += 2) { const n = lerp(-S, S, k / K); b.member([-wx(up(n)), up(n), n], [wx(up(n)), up(n), n], 0.5, 4); }
  // posts from the arch up to the upper deck, hangers from it down to the lower deck
  for (const n of [-64, -43, -22, 22, 43, 64]) for (const sx of [-1, 1]) {
    if (DY - 3.5 - up(n) > 1) b.member([sx * wx(up(n)), up(n), n], [sx * 4, DY - 3.5, n], 0.45, 4);
    if (Math.abs(n) > 40 && lo(n) > LOW + 1) b.member([sx * wx(lo(n)), lo(n), n], [sx * 4, LOW, n], 0.35, 4);
  }
  // the granite pillars at the arch's feet, under both decks; the iron piers on the slopes
  b.set(PLAIN([0.30, 0.29, 0.27], 0.05));
  for (const s of [-1, 1]) box(b, 0, s * (S + 8), 0, DY - 3.5, 7, 6, 0, { capTop: false });
  b.set(PLAIN(IRON, 0.25));
  piersAlong(b, g, top, 3.5, S + 8, 34, 2.5, 2.5);
  return b.result();
}

// ------------------------------------------------------------------ Innsbruck

// The Bergisel ski jump: the concrete tower about 50 m (the brief) with the restaurant's pod on its top, cantilevered over
// the in-run, and the in-run sloping down from it (local +n, north) to the take-off table about 95 m out [EST]; the landing
// slope is the hill. The tower's and pod's sizes, the in-run's line and its supports [EST]. Lit at night.
// v0.7.8 (LANDMARKS78): bergisel78() below, the tower at the top of the hill and the in-run down it; off, v0.7.3's.
export function bergisel(brg = 0, geo = {}) { return LANDMARKS78 ? (BERGISEL79 ? bergisel79(brg, geo) : bergisel78(brg, geo)) : bergisel77(brg); }

// v0.7.8: the Bergisel jump on its hill ("Found while building v0.7.3": a small tower at the slope's foot). Its entry
// (landmarks.js) stands 105 m south of the article's point, the middle of the jump, and is `slope: true`: the model is
// given the ground along its axis, prof (m above its base, every 10 m of local n from -120 to +120, slopeProfile()); without
// one, BERGISEL_PROF, read from the installed 250 m ground (2026-11-23). The ground there: a crest about 43 m up at
// n = -90 to -120, falling about 25 degrees to the article's point (n = +105, 39 m below the base), the outrun's side.
// The tower (50 m, its pod) at n = -90 on the crest; the in-run from 34 m up its north face down to the take-off table
// 3 m over the slope at n = +5, steep at the top and flattening to the table (its curve, the table's place and height
// [EST]); its supports down to the ground every 12 m. The landing slope is the hill itself.
export const BERGISEL_PROF = [42.4, 43.2, 43.4, 43.1, 42.8, 40.4, 36, 31.5, 26.9, 22.2, 17.4, 12.4, 7.2, 2, -2.8, -7, -11.3, -16.2, -21.9, -27.6, -31.9, -34.7, -37.5, -39.2, -39.8];
export const BERGISEL_TOWER_N = -90, BERGISEL_TABLE_N = 5;
export const profAt = (prof, n) => { const f = Math.min(Math.max((n + 120) / 10, 0), prof.length - 1), i = Math.min(Math.floor(f), prof.length - 2); return lerp(prof[i], prof[i + 1], f - i); };
export const bergiselTop = (prof = BERGISEL_PROF) => profAt(prof, BERGISEL_TOWER_N) + 50;
function bergisel78(brg = 0, geo = {}) {
  const prof = geo.prof || BERGISEL_PROF, g = (n) => profAt(prof, n);
  const b = new Builder(0.95).frame(0, 0, brg);
  const H = 50, TN = BERGISEL_TOWER_N, y0 = g(TN), gMin = Math.min(...[-4.5, 0, 4.5].map((d) => g(TN + d))) - 1;
  // the tower: from below the ground on its crest (the lowest of its plan, less a metre) to 40 m, then the pod
  b.set(PLAIN([0.46, 0.46, 0.44], 0.1, { glow: [0.10, 0.10, 0.12] }));
  b.loft([at(shift(roundedRect(4.5, 4.5, 1.5, 2), 0, TN), gMin), at(shift(roundedRect(4.0, 4.0, 1.3, 2), 0, TN), y0 + 40)], { capTop: false });
  b.set(GLASS([0.28, 0.31, 0.33], 4.0, 2.5, 0.7, 0.4, { glow: [0.30, 0.28, 0.24] }));
  const pod = (s) => shift(superellipse(7 * s, 15 * s, 2.6, 16), 0, TN + 4);
  b.loft([at(pod(0.55), y0 + 40), at(pod(1), y0 + 43), at(pod(1), y0 + 47.5), at(pod(0.7), y0 + H)], { smooth: false });
  // the in-run
  const n0 = TN + 6, n1 = BERGISEL_TABLE_N, yTop = y0 + 34, yEnd = g(n1) + 3;
  const runY = (n) => { const t = Math.min(Math.max((n - n0) / (n1 - n0), 0), 1); return Math.max(lerp(yTop, yEnd, 1 - (1 - t) ** 1.35), g(n) + 1.8); };
  b.set(PLAIN([0.56, 0.56, 0.54], 0.15, { glow: [0.14, 0.14, 0.16] }));
  deckAlong(b, runY, n0, n1, 2.2, 1.6, 5);
  b.set(PLAIN([0.40, 0.40, 0.38], 0.1));
  for (let n = n0 + 10; n < n1 - 2; n += 12) { const yb = Math.min(...[-1, 0, 1].map((d) => g(n + d))) - 1, yt = runY(n) - 1.6; if (yt - yb > 1.5) box(b, 0, n, yb, yt, 1.0, 1.0, 0, { capTop: false }); }
  b.light([0, y0 + H, TN + 4], 0);
  return b.result();
}

// v0.7.9 (BERGISEL79; "Found while building v0.7.8": "the in-run is a thin strip over the trees: give it its depth"):
// bergisel78()'s tower and pod, and the in-run as a ramp with a body: the track 6 m wide between side walls 1.4 m
// high, carried on a box girder as wide and 3.2 m deep, a darker band under the pale track on each side (less where the slope comes up under it), on portal
// frames of two legs every 12 m. Its line (runY) is v0.7.8's, so its top, its table and the tower are where they were.
// The sizes [EST] (the jump's in-run, about 4 to 5 m across, on a steel structure from the tower down the hill).
export const BERGISEL79_SIZES = { hw: 3.0, wall: 1.4, wallT: 0.3, slab: 0.45, girderHw: 3.0, girderD: 3.2, legHw: 0.45, legX: 2.3, step: 12 };
// A prism along local n between x0 and x1, from bot(n) to top(n), in pieces of `step` m (deckAlong()'s, off its axis).
function prismAlong(b, top, bot, n0, n1, x0, x1, step) {
  const ns = [];
  for (let n = n0; n < n1; n += step) ns.push(n);
  ns.push(n1);
  const q = (x, y, n) => b.T([x, y, n]);
  for (let i = 0; i + 1 < ns.length; i++) {
    const na = ns[i], nb = ns[i + 1];
    const c = b.T([(x0 + x1) / 2, (top(na) + bot(na) + top(nb) + bot(nb)) / 4, (na + nb) / 2]);
    const A = [q(x0, bot(na), na), q(x1, bot(na), na), q(x1, top(na), na), q(x0, top(na), na)];
    const B = [q(x0, bot(nb), nb), q(x1, bot(nb), nb), q(x1, top(nb), nb), q(x0, top(nb), nb)];
    for (let k = 0; k < 4; k++) { const k1 = (k + 1) % 4; b.tri(A[k], A[k1], B[k1], c); b.tri(A[k], B[k1], B[k], c); }
    if (i === 0) { b.tri(A[0], A[1], A[2], c); b.tri(A[0], A[2], A[3], c); }
    if (i + 2 === ns.length) { b.tri(B[0], B[1], B[2], c); b.tri(B[0], B[2], B[3], c); }
  }
}
function bergisel79(brg = 0, geo = {}) {
  const prof = geo.prof || BERGISEL_PROF, g = (n) => profAt(prof, n);
  const b = new Builder(0.95).frame(0, 0, brg);
  const H = 50, TN = BERGISEL_TOWER_N, y0 = g(TN), gMin = Math.min(...[-4.5, 0, 4.5].map((d) => g(TN + d))) - 1;
  // the tower and its pod: bergisel78()'s
  b.set(PLAIN([0.46, 0.46, 0.44], 0.1, { glow: [0.10, 0.10, 0.12] }));
  b.loft([at(shift(roundedRect(4.5, 4.5, 1.5, 2), 0, TN), gMin), at(shift(roundedRect(4.0, 4.0, 1.3, 2), 0, TN), y0 + 40)], { capTop: false });
  b.set(GLASS([0.28, 0.31, 0.33], 4.0, 2.5, 0.7, 0.4, { glow: [0.30, 0.28, 0.24] }));
  const pod = (s) => shift(superellipse(7 * s, 15 * s, 2.6, 16), 0, TN + 4);
  b.loft([at(pod(0.55), y0 + 40), at(pod(1), y0 + 43), at(pod(1), y0 + 47.5), at(pod(0.7), y0 + H)], { smooth: false });
  // the in-run: bergisel78()'s line
  const S = BERGISEL79_SIZES;
  const n0 = TN + 6, n1 = BERGISEL_TABLE_N, yTop = y0 + 34, yEnd = g(n1) + 3;
  const runY = (n) => { const t = Math.min(Math.max((n - n0) / (n1 - n0), 0), 1); return Math.max(lerp(yTop, yEnd, 1 - (1 - t) ** 1.35), g(n) + 1.8); };
  const under = (n) => Math.min(...[-1, 0, 1].map((d) => g(n + d))) - 0.5;            // the slope under it, less half a metre
  const slabBot = (n) => runY(n) - S.slab;
  const girderBot = (n) => Math.max(slabBot(n) - S.girderD, Math.min(under(n), slabBot(n) - 0.6));
  // the track and its walls, pale; the girder below, a darker steel, so its side reads from above and from the side
  b.set(PLAIN([0.60, 0.60, 0.58], 0.15, { glow: [0.14, 0.14, 0.16] }));
  prismAlong(b, runY, slabBot, n0, n1, -S.hw, S.hw, 5);
  prismAlong(b, (n) => runY(n) + S.wall, runY, n0, n1, -S.hw, -S.hw + S.wallT, 5);
  prismAlong(b, (n) => runY(n) + S.wall, runY, n0, n1, S.hw - S.wallT, S.hw, 5);
  b.set(PLAIN([0.30, 0.31, 0.32], 0.1));
  prismAlong(b, slabBot, girderBot, n0, n1, -S.girderHw, S.girderHw, 5);
  // the portal frames: two legs from the slope to the girder's foot
  b.set(PLAIN([0.40, 0.40, 0.38], 0.1));
  for (let n = n0 + 10; n < n1 - 2; n += S.step) {
    const yb = under(n) - 0.5, yt = girderBot(n);
    if (yt - yb > 1.5) for (const x of [-S.legX, S.legX]) box(b, x, n, yb, yt, S.legHw, S.legHw, 0, { capTop: false });
  }
  b.light([0, y0 + H, TN + 4], 0);
  return b.result();
}

function bergisel77(brg = 0) {
  const b = new Builder(0.95).frame(0, 0, brg);
  const H = 50;
  b.set(PLAIN([0.46, 0.46, 0.44], 0.1, { glow: [0.10, 0.10, 0.12] }));
  b.loft([at(roundedRect(4.5, 4.5, 1.5, 2), 0), at(roundedRect(4.0, 4.0, 1.3, 2), 40)], { capTop: false });
  // the pod: a curved shell reaching out over the in-run and back, glazed
  b.set(GLASS([0.28, 0.31, 0.33], 4.0, 2.5, 0.7, 0.4, { glow: [0.30, 0.28, 0.24] }));
  const pod = (s) => shift(superellipse(7 * s, 15 * s, 2.6, 16), 0, 4);
  b.loft([at(pod(0.55), 40), at(pod(1), 43), at(pod(1), 47.5), at(pod(0.7), H)], { smooth: false });
  // the in-run: from under the pod down to the take-off table
  const runY = (n) => { const t = Math.min(Math.max((n - 10) / 85, 0), 1); return lerp(41, 3, Math.sin(t * Math.PI / 2) ** 1.4); };
  b.set(PLAIN([0.56, 0.56, 0.54], 0.15, { glow: [0.14, 0.14, 0.16] }));
  deckAlong(b, runY, 6, 95, 2.2, 1.6, 8);
  b.set(PLAIN([0.40, 0.40, 0.38], 0.1));
  for (const n of [28, 46, 64, 80]) { const y = runY(n) - 1.6; if (y > 1) box(b, 0, n, 0, y, 1.0, 1.0, 0, { capTop: false }); }
  b.light([0, H, 4], 0);
  return b.result();
}

// The metal tower of Fourvière (1894): 101 m with its antenna, 85.9 m before it (the article); a steel framework
// on four legs like a small Eiffel Tower, its base and platforms' sizes [EST]. Grey; a light at the top.
export function fourvieretower() {
  const b = new Builder(0.97);
  const H = 101, T = 85.9, w = (y) => lerp(8, 1.2, Math.pow(y / T, 0.8));
  b.set(PLAIN([0.36, 0.37, 0.37], 0.25, { glow: [0.08, 0.08, 0.09] }));
  const C = [[1, 1], [-1, 1], [-1, -1], [1, -1]], ys = [0, 14, 30, 48, 66, T];
  for (let i = 0; i + 1 < ys.length; i++) for (const [cx, cn] of C) b.member([cx * w(ys[i]), ys[i], cn * w(ys[i])], [cx * w(ys[i + 1]), ys[i + 1], cn * w(ys[i + 1])], 0.7, 4);
  for (let i = 1; i < ys.length - 1; i++) for (let k = 0; k < 4; k++) { const [ax, an] = C[k], [bx, bn] = C[(k + 1) % 4]; b.member([ax * w(ys[i]), ys[i], an * w(ys[i])], [bx * w(ys[i]), ys[i], bn * w(ys[i])], 0.4, 4); }
  for (let i = 0; i + 1 < ys.length - 1; i++) for (let k = 0; k < 4; k++) { const [ax, an] = C[k], [bx, bn] = C[(k + 1) % 4]; b.member([ax * w(ys[i]), ys[i], an * w(ys[i])], [bx * w(ys[i + 1]), ys[i + 1], bn * w(ys[i + 1])], 0.3, 4); }
  box(b, 0, 0, 14, 15.5, w(14) + 1.5, w(14) + 1.5, 0, { capBottom: true });   // the first platform
  box(b, 0, 0, T - 1.5, T, 2.2, 2.2, 0, { capBottom: true });
  b.set(PLAIN([0.60, 0.07, 0.04], 0.2));
  cyl(b, 0, 0, T, H, 0.6, 0.2, 6);
  b.light([0, H, 0], 0);
  return b.result();
}

Object.assign(EUROPE_MODELS, { elbphil, hht, campanile, ndg, fourviere, fourvieretower, domluis, bergisel });

// ================================================================== v0.7.5: Nagoya, Hiroshima, Miyajima, Osaka (East Asia)
// briefs/V0-7-5.md part 6. Our own massing from public figures, [EST] where not published; no logos, lettering, names
// or the shrine's plaque text on anything. Added to East Asia's MODELS (the list's entries in landmarks.js).

const KEEP_WALL = [0.72, 0.72, 0.69], KEEP_GOLD = [0.80, 0.62, 0.22];   // (darkened after the first stills: the shading lifts them)
// v0.7.8 (LANDMARKS78): the roofs' green copper and the stone base, chosen for what the shader makes of them. The
// landmarks' shader lights an albedo by the sun at 2.2 and the sky at 1.1 before the tone map (every one of the ninety-odd
// models is tuned to that, so it stays), and v0.7.5's 0.31 green copper came out at sRGB (164, 210, 197), pale mint, the
// 0.19 stone at (186, 182, 173), pale grey (read from v075-c3-landmark-osakacastle-above-day.png's sunlit faces). These
// aim at about (96, 148, 122), the weathered copper's darker green, and (150, 144, 130), the granite's mid grey, in sun.
const KEEP_ROOF = LANDMARKS78 ? [0.042, 0.114, 0.071] : [0.10, 0.31, 0.23];   // (0.026, 0.15, 0.09 at first: (77, 168, 136), too vivid)
const KEEP_STONE = LANDMARKS78 ? [0.09, 0.085, 0.074] : [0.19, 0.18, 0.16];   // (0.095, then 0.115: near black in the shade, pale in the sun; now with CASTLE_BASE_UP)
const CASTLE_BASE_UP = 0.85;
const KEEP_GLOW = [0.40, 0.38, 0.33];          // floodlit white plaster at night
const rect4 = (hx, hn, x = 0, n = 0) => [[x + hx, n - hn], [x + hx, n + hn], [x - hx, n + hn], [x - hx, n - hn]];

// A Japanese castle keep (tenshu) on its stone base (ishigaki), about local (cx, cn):
//   base [hx0, hn0, hx1, hn1, h]: the stone base, battered on a concave curve from its foot to its top;
//   tiers [[hx, hn, h, over, rise, dormers]]: each storey's walls, then its roof flaring out by `over` at the eaves and
//   rising (concave) to the next storey's walls; dormers: 'x' (gables on the two x faces), 'n', 'xn' (all four);
//   H the top (the ridge's gilded fish, if `fish`, reach it; else the ridge does). topWall: the last storey's colour.
function castleKeep(b, cx, cn, { base, tiers, H, fish = true, topWall = null, glow = KEEP_GLOW }) {
  const [hx0, hn0, hx1, hn1, hb] = base;
  b.set(PLAIN(KEEP_STONE, 0.05, { glow: glow.map((v) => v * 0.45) }));
  const ts = [0, 0.3, 0.6, 1];
  const n0 = b.N.length;
  b.loft(ts.map((t) => { const k = (1 - t) * (1 - t); return at(rect4(hx1 + (hx0 - hx1) * k, hn1 + (hn0 - hn1) * k, cx, cn), hb * t); }), { capTop: true });
  // v0.7.8 (LANDMARKS78): the stone base's shading evened out. The same albedo read near-black on Nagoya's base (its views
  // look south at the north faces, in shade: the shader's sky light alone) and pale on Osaka's (seen from the sunlit
  // south-west). The base's normals are turned most of the way up (CASTLE_BASE_UP of the way to straight up), so every
  // face takes the sun and the sky about as the base's top does: one mid grey from any side, the batter still shaded a little.
  if (LANDMARKS78) for (let i = n0; i < b.N.length; i += 3) {
    const x = b.N[i] * (1 - CASTLE_BASE_UP), y = b.N[i + 1] * (1 - CASTLE_BASE_UP) + CASTLE_BASE_UP, z = b.N[i + 2] * (1 - CASTLE_BASE_UP), l = Math.hypot(x, y, z) || 1;
    b.N[i] = x / l; b.N[i + 1] = y / l; b.N[i + 2] = z / l;
  }
  const wall = PLAIN(KEEP_WALL, 0.08, { glow });
  const roof = PLAIN(KEEP_ROOF, 0.2, { glow: glow.map((v) => v * 0.35) });
  let y = hb;
  tiers.forEach(([hx, hn, h, over, rise, dorm], i) => {
    const last = i === tiers.length - 1;
    b.set(last && topWall ? PLAIN(topWall, 0.15, { glow: glow.map((v) => v * 0.3) }) : wall);
    b.loft([at(rect4(hx, hn, cx, cn), y), at(rect4(hx, hn, cx, cn), y + h)], { capTop: false });
    y += h;
    b.set(roof);
    const ex = hx + over, en = hn + over;
    if (!last) {
      const [nx, nn] = tiers[i + 1];
      // the soffit (body to eaves), the eaves' edge, the concave slope to the next storey
      b.loft([at(rect4(hx, hn, cx, cn), y - 0.7), at(rect4(ex, en, cx, cn), y - 0.15), at(rect4(ex, en, cx, cn), y + 0.25),
        at(rect4(lerp(ex, nx, 0.62), lerp(en, nn, 0.62), cx, cn), y + rise * 0.45), at(rect4(nx, nn, cx, cn), y + rise)], { capTop: false });
      // the gables (chidori-hafu) on the slope's faces
      const gy0 = y + 0.1, gy1 = y + rise + 1.4;
      if (dorm && dorm.includes('n')) for (const s of [-1, 1]) gable(b, cx, cn + s * (hn + over * 0.35), gy0, gy1, Math.min(4.2, hx * 0.32), over * 0.7 + 0.6, false);
      if (dorm && dorm.includes('x')) for (const s of [-1, 1]) gable(b, cx + s * (hx + over * 0.35), cn, gy0, gy1, over * 0.7 + 0.6, Math.min(4.2, hn * 0.32), true);
      y += rise;
    } else {
      // the top roof: hipped to a ridge along the longer side; the ridge's gilded fish at its ends
      const top = fish ? H - 2.2 : H;
      const along = hx >= hn, rl = (along ? hx : hn) * 0.55;
      const ridge = along ? rect4(rl, 0.35, cx, cn) : rect4(0.35, rl, cx, cn);
      b.loft([at(rect4(hx, hn, cx, cn), y - 0.7), at(rect4(ex, en, cx, cn), y - 0.15), at(rect4(ex, en, cx, cn), y + 0.25),
        at(rect4(lerp(ex, along ? rl : 0.35, 0.6), lerp(en, along ? 0.35 : rl, 0.6), cx, cn), lerp(y + 0.25, top, 0.55)), at(ridge, top)], { capTop: true });
      if (fish) {
        b.set(PLAIN(KEEP_GOLD, 0.6, { glow: [0.5, 0.38, 0.12] }));
        for (const s of [-1, 1]) box(b, cx + (along ? s * (rl - 0.3) : 0), cn + (along ? 0 : s * (rl - 0.3)), top - 0.4, H, along ? 0.35 : 0.6, along ? 0.6 : 0.35);
      }
    }
  });
}

// Nagoya Castle: the main keep (tenshu, rebuilt in concrete in 1959), 36.1 m on its 19.5 m stone base, 55.6 m in all;
// five roofs of green copper over white plaster, the two gilded fish on the ridge. The stone base's foot is OSM's
// outline (39.8 x 36.5 m, its grid bearing -11); the storeys' sizes and the gables [EST]. The small keep (shotenshu)
// beside it to the south, joined by its walled stone bridge: OSM's outline (29.8 x 21.0 m), its heights [EST].
export function nagoyacastle(brg = -11.2) {
  const b = new Builder(0.58).frame(0, 0, brg);
  castleKeep(b, 0, 0, {
    base: [19.9, 18.25, 17.6, 16.0, 19.5], H: 55.6,
    tiers: [[16.8, 15.2, 5.4, 2.4, 2.4, 'xn'], [14.2, 12.6, 4.6, 2.2, 2.2, 'x'], [11.6, 10.1, 4.2, 2.0, 2.0, 'n'],
      [9.0, 7.8, 3.8, 1.9, 1.8, null], [7.0, 5.8, 3.7, 1.8, 0, null]],
  });
  // the small keep, 52.8 m away on the grid (OSM: 22.7 m east, 47.7 m south), its long side across
  castleKeep(b, 13.0, -51.2, {
    base: [14.9, 10.5, 13.6, 9.3, 12.5], H: 26, fish: false,
    tiers: [[12.4, 8.2, 5.0, 2.0, 2.0, 'n'], [9.6, 6.0, 3.8, 1.8, 0, null]],
  });
  // the walled stone bridge between them (hashidai)
  b.set(PLAIN(KEEP_STONE, 0.05, { glow: KEEP_GLOW.map((v) => v * 0.45) }));
  b.member([3.5, 4.5, -16.5], [9.5, 4.5, -40.0], 4.6, 4, 0);
  return b.result();
}

// Nagoya's TV tower (1954, the first in Japan): 180 m, a four-legged steel lattice, the enclosed deck at about 90 m and
// the open balcony at about 100 m. The legs' spread is OSM's outline (47 x 48 m at grid bearing -11); the lattice's
// taper above the deck, the antenna's share and the low building between the legs [EST]. Silver-grey, lit at night.
export function nagoyatv(brg = -11) {
  const b = new Builder(0.27).frame(0, 0, brg);
  const H = 180, DECK = 90, LT = 140;
  const w = (y) => (y <= DECK ? 3.8 + 18.2 * (1 - y / DECK) ** 1.55 : lerp(3.6, 1.5, (y - DECK - 13) / (LT - DECK - 13)));
  const fn = (y) => { const h = w(y); return [[h, h], [-h, h], [-h, -h], [h, -h]]; };
  const SILVER = [0.60, 0.61, 0.60];
  const paint = PLAIN(SILVER, 0.35, { glow: [0.42, 0.46, 0.55] });
  const shell = PLAIN(SILVER.map((v) => v * 0.72), 0.1, { glow: [0.22, 0.24, 0.30] });
  const ys = [];
  for (let y = 0; y < DECK - 4.5; y += Math.max(6.5, w(y) * 0.85)) ys.push(y);
  ys.push(DECK - 3);
  lattice(b, fn, ys, { rv: 1.1, rd: 0.4, rr: 0.45, sides: 4, cross: true, base: paint, shell: () => shell });
  const ym = [];
  for (let k = 0; k <= 6; k++) ym.push(lerp(DECK + 13, LT, k / 6));
  lattice(b, fn, ym, { rv: 0.6, rd: 0.26, rr: 0.3, sides: 4, cross: true, base: paint, shell: () => shell });
  // the deck (a glazed box round the lattice, about 90 m) and the open balcony above it (about 100 m)
  b.set(GLASS([0.30, 0.32, 0.34], 3.5, 2.0, 0.6, 0.65, { glow: [0.45, 0.38, 0.26] }));
  b.loft([at(chamferRect(8.4, 8.4, 1.4), DECK - 3), at(chamferRect(8.4, 8.4, 1.4), DECK + 4)]);
  b.set(PLAIN([0.44, 0.45, 0.45], 0.2, { glow: [0.18, 0.18, 0.2] }));
  b.loft([at(chamferRect(9.0, 9.0, 1.5), DECK + 4), at(chamferRect(9.0, 9.0, 1.5), DECK + 5)]);
  b.loft([at(chamferRect(4.6, 4.6, 0.8), DECK + 5), at(chamferRect(4.6, 4.6, 0.8), DECK + 9.5)]);
  b.loft([at(chamferRect(7.0, 7.0, 1.2), DECK + 9.5), at(chamferRect(7.0, 7.0, 1.2), DECK + 10.4)]);
  b.loft([at(chamferRect(3.8, 3.8, 0.6), DECK + 10.4), at(chamferRect(3.8, 3.8, 0.6), DECK + 13)]);
  // the antenna
  b.set(paint);
  b.loft([[LT, 1.6], [LT + 6, 1.1], [165, 0.7], [H, 0.22]].map(([y, r]) => at(circle(r, 8), y)), { smooth: true });
  // the building between the legs [EST: four floors]
  b.set(GLASS([0.42, 0.41, 0.38], 4.0, 3.0, 0.4, 0.4));
  b.loft([at(chamferRect(13, 13, 2), 0), at(chamferRect(13, 13, 2), 14)]);
  b.light([0, H, 0], 1);
  for (const y of [LT, DECK + 10, 50]) ringLights(b, fn(y), y, 0);
  return b.result();
}

// The great torii of Itsukushima Shrine (1875): 16.6 m (OSM height=16.591), standing in the sea off the shrine at
// Miyajima, vermilion; the two main pillars, each braced by two smaller legs fore and aft (six legs), the tie beam, the
// two top beams with their upturned ends (the top one about 24 m long: OSM's outline, 22.7 x 11.9 m, its long axis at
// grid bearing 37.9). Based at the water's level (y 0, the sea; `atSea` in its entry). The pillars' girth and spacing,
// the legs' places and the beams' heights [EST]; the plaque between the beams is a plain board.
export function torii(brg = -52.1) {
  const b = new Builder(0.81).frame(0, 0, brg);
  const H = 16.6, PX = 5.45, SN = 4.6;
  const VERM = PLAIN([0.78, 0.20, 0.08], 0.15, { glow: [0.55, 0.20, 0.08] });
  const BLACK = PLAIN([0.07, 0.065, 0.06], 0.25, { glow: [0.05, 0.04, 0.03] });
  b.set(VERM);
  for (const s of [-1, 1]) {
    cyl(b, s * PX, 0, 0, 14.2, 1.25, 1.0, 12);                                  // a main pillar
    for (const t of [-1, 1]) {
      cyl(b, s * PX, t * SN, 0, 8.6, 0.55, 0.5, 8);                            // its two legs
      box(b, s * PX, t * SN * 0.55, 6.3, 6.9, 0.32, SN * 0.45);                 // the legs' ties to the pillar
      box(b, s * PX, t * SN * 0.55, 8.0, 8.6, 0.32, SN * 0.45);
      b.set(BLACK);
      gable(b, s * PX, t * SN, 8.6, 9.3, 0.8, 0.8);                            // the legs' little roofs
      b.set(VERM);
    }
    box(b, s * PX, 0, 8.0, 8.6, 0.35, SN, 0, { capBottom: true });               // the fore-and-aft beam over the legs
  }
  box(b, 0, 0, 10.4, 11.4, 8.4, 0.45, 0, { capBottom: true });                 // the tie beam (nuki)
  box(b, 0, 0, 11.4, 13.6, 0.8, 0.3);                                           // the plain board between the beams
  box(b, 0, 0, 13.6, 14.3, 10.6, 0.55, 0, { capBottom: true });                // the lower top beam (shimaki)
  // the top beam (kasagi), its ends rising, with its black cap
  const K = 12.1, yb = (x) => 14.3 + 1.0 * (Math.abs(x) / K) ** 2.5;
  const xs = [-K, -9, -6, -3, 0, 3, 6, 9, K];
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i], c = xs[i + 1];
    b.set(VERM);
    b.member([a, yb(a) + 0.5, 0], [c, yb(c) + 0.5, 0], 0.78, 4, 0);
    b.set(BLACK);
    b.member([a, yb(a) + 1.15, 0], [c, yb(c) + 1.15, 0], 0.21, 4, 0);
  }
  // (member squares stand corner-up by half their width: the cap's top at the ends is H)
  return b.result();
}

// The Hiroshima Peace Memorial (the Atomic Bomb Dome): the ruin of the Prefectural Industrial Promotion Hall (1915),
// kept as it stood after 6 August 1945: about 25 m to the top of the bare steel frame of its dome, over a five-storey
// central stair tower; the brick walls of the three-storey wings broken to uneven heights, the windows empty. Modelled
// plainly, as the memorial it is. OSM's outline (46.3 x 31.6 m, long axis at grid bearing -11: local x here); the
// wings' plan, the broken walls' heights and the dome's ellipse [EST].
export function abombdome(brg = 79) {
  const b = new Builder(0.33).frame(0, 0, brg);
  const H = 25;
  const BRICK_RUIN = [0.27, 0.22, 0.17], STEEL = [0.08, 0.075, 0.07];
  const glow = [0.26, 0.22, 0.16];
  // the walls: segments [x0, n0, x1, n1, top] 0.7 m thick, the openings as the facade's dark bays
  b.set({ col: BRICK_RUIN, fac: [4.6, 2.9, 0.42, 0], spec: 0.04, glow });
  const T = 0.35;
  const seg = (x0, n0, x1, n1, top) => {
    const L = Math.hypot(x1 - x0, n1 - n0), a = Math.atan2(n1 - n0, x1 - x0) * 180 / Math.PI;
    box(b, (x0 + x1) / 2, (n0 + n1) / 2, 0, top, L / 2 + T, T, a);
  };
  const run = (x0, n0, x1, n1, tops) => {
    const k = tops.length;
    for (let i = 0; i < k; i++) seg(lerp(x0, x1, i / k), lerp(n0, n1, i / k), lerp(x0, x1, (i + 1) / k), lerp(n0, n1, (i + 1) / k), tops[i]);
  };
  // the front wing (three storeys), facing local +n, the tower at its middle
  run(-22, 13, -6, 13, [14.5, 15.5, 13.0, 15.0]);
  run(6, 13, 22, 13, [15.0, 12.5, 15.5, 14.0]);
  run(-22, 4, -6, 4, [12.0, 9.5, 13.5, 11.0]);
  run(6, 4, 22, 4, [11.5, 13.5, 8.5, 12.5]);
  run(-22, 13, -22, -14, [14.0, 12.0, 9.0, 10.5, 7.5]);
  run(22, 13, 22, -14, [13.5, 11.0, 12.5, 8.0, 9.5]);
  // the side wings going back (lower, more broken) and the rear wall's stubs
  run(-14, 4, -14, -14, [9.0, 7.0, 8.5]);
  run(14, 4, 14, -14, [8.0, 9.5, 6.5]);
  run(-22, -14, -14, -14, [8.0, 5.5]);
  run(14, -14, 22, -14, [6.0, 8.5]);
  run(-6, 4, -6, 13, [16.0]);
  run(6, 4, 6, 13, [16.0]);
  // the stair tower: an elongated octagon about 12 x 10 m, its walls to the drum at 18.5 m
  const oct = superellipse(6.2, 5.2, 2, 8, Math.PI / 8).map(([x, n]) => [x, n + 8.5]);
  b.set({ col: BRICK_RUIN.map((v) => v * 0.94), fac: [3.7, 2.4, 0.45, 0], spec: 0.04, glow });
  for (let i = 0; i < 8; i++) { const [x0, n0] = oct[i], [x1, n1] = oct[(i + 1) % 8]; seg(x0, n0, x1, n1, 18.5); }
  // the drum's ring and the dome's bare frame: an ellipsoid 5.9 x 4.9 m from 19 m to the crown ring at 24.4 m
  b.set(PLAIN(STEEL, 0.2, { glow: [0.08, 0.07, 0.06] }));
  const ring = (y, s) => superellipse(5.9 * s, 4.9 * s, 2, 16).map(([x, n]) => [x, y, n + 8.5]);
  b.loft([at(superellipse(6.3, 5.3, 2, 16).map(([x, n]) => [x, n + 8.5]), 18.5), at(superellipse(6.3, 5.3, 2, 16).map(([x, n]) => [x, n + 8.5]), 19.0)]);
  const lev = [0, 0.25, 0.5, 0.72, 0.9, 1].map((t) => [19.0 + 5.2 * Math.sin(t * Math.PI / 2), Math.max(Math.cos(t * Math.PI / 2), 0.16)]);
  const R = lev.map(([y, s]) => ring(y, s));
  for (let i = 0; i < 16; i++) for (let j = 0; j + 1 < R.length; j++) b.member(R[j][i], R[j + 1][i], 0.11, 4);
  for (const j of [1, 3, 5]) for (let i = 0; i < 16; i++) b.member(R[j][i], R[j][(i + 1) % 16], 0.09, 4);
  // the crown: a small ring and its stub to the top
  b.member([0, 24.2, 8.5], [0, H, 8.5], 0.18, 4);
  return b.result();
}

// Osaka Castle: the main tower (rebuilt in concrete in 1931): about 55 m with its stone base [the brief; the tower about
// 41 m on a stone base of about 14 m, EST], five roofs of green copper over white walls, the top storey dark with gilded
// trim, the gilded fish on the ridge. The stone base's foot is OSM's outline (41.8 x 37.7 m, grid bearing 1); the
// storeys' sizes and the gables [EST].
export function osakacastle(brg = 1) {
  const b = new Builder(0.64).frame(0, 0, brg);
  castleKeep(b, 0, 0, {
    base: [18.85, 20.9, 17.0, 19.0, 13.5], H: 55, topWall: [0.13, 0.12, 0.11],
    tiers: [[15.8, 17.6, 6.8, 2.3, 2.4, 'xn'], [13.0, 14.4, 5.6, 2.1, 2.3, 'xn'], [10.4, 11.4, 5.0, 2.0, 2.1, 'x'],
      [8.0, 8.8, 4.4, 1.8, 2.0, 'n'], [6.4, 7.0, 4.6, 1.8, 0, null]],
  });
  // the top storey's gilded bands (y 44.1 to 48.7 there)
  b.set(PLAIN(KEEP_GOLD, 0.6, { glow: [0.5, 0.38, 0.12] }));
  for (const y of [45.2, 47.6]) b.loft([at(rect4(6.5, 7.1), y), at(rect4(6.5, 7.1), y + 0.35)], { capTop: false });
  return b.result();
}

Object.assign(MODELS, { nagoyacastle, nagoyatv, torii, abombdome, osakacastle });

// ================================================================== v0.7.6: three landmarks by the air bases (briefs/V0-7-6.md part 5)
// The same rules: our own massing from public figures, no logos, lettering or names. Added to EUROPE_MODELS below.

// (Linear colours, darker than they read: the first stills drew 0.6 stone and 0.34 lead nearly white in the sun.)
const ELY_STONE = [0.40, 0.36, 0.27], ELY_LEAD = [0.12, 0.13, 0.14], PILAR_BRICK = [0.44, 0.25, 0.15], CADIZ_STONE = [0.42, 0.38, 0.28];
const TILE_GREEN = [0.08, 0.30, 0.16], TILE_YELLOW = [0.66, 0.50, 0.10], TILE_BLUE = [0.10, 0.20, 0.46], TILE_WHITE = [0.66, 0.66, 0.63];
const TILE_GOLD = [0.62, 0.40, 0.06];

// A dome from y0 of radius r and height h in k gores (meridian strips), each gore's material from mats in turn (one
// material: a plain dome in k segments); smooth normals from the dome's centre.
function goredDome(b, x, n, y0, r, h, mats, k = 16, rings = 4) {
  const pt = (i, j) => { const a = (i / k) * TAU, t = (j / rings) * Math.PI / 2, rr = Math.max(r * Math.cos(t), j === rings ? 0 : 0.3); return [x + rr * Math.cos(a), y0 + h * Math.sin(t), n + rr * Math.sin(a)]; };
  const inside = b.T([x, y0 + h * 0.3, n]);
  const nrm = (p) => { const q = b.T(p), c = b.T([x, y0, n]); return [(q[0] - c[0]) / r, (q[1] - c[1]) / h, (q[2] - c[2]) / r]; };
  for (let i = 0; i < k; i++) {
    b.set(mats[i % mats.length]);
    for (let j = 0; j < rings; j++) {
      const p00 = pt(i, j), p10 = pt(i + 1, j), p01 = pt(i, j + 1), p11 = pt(i + 1, j + 1);
      b.tri(b.T(p00), b.T(p10), b.T(p11), inside, nrm(p00), nrm(p10), nrm(p11));
      if (j < rings - 1) b.tri(b.T(p00), b.T(p11), b.T(p01), inside, nrm(p00), nrm(p11), nrm(p01));
    }
  }
}
const oct = (r, x = 0, n = 0) => shift(circle(r, 8, Math.PI / 8), x, n);

// ------------------------------------------------------------------ Ely

// Ely Cathedral: 163.7 m long (the article), on an east-west axis (local x east). The west tower 66 m (the article) over the
// Galilee porch, square to its octagonal belfry with four corner turrets [EST: the stages' heights]; the south-west transept
// beside it with its corner turrets (the north-west transept long fallen); the Norman nave (over 75 m, the article) with its
// aisles; the Octagon over the crossing, 23 m across inside (the article), its lead roof and the timber lantern to 52 m (the
// article); the transepts and the long choir to the flat east end; the Lady Chapel to the north-east. The widths and every
// height but the two towers' [EST]. Barnack stone (pale), lead roofs; floodlit at night.
export function ely(brg = 0) {
  const b = new Builder(0.43).frame(0, 0, brg);
  const stone = GLASS(ELY_STONE, 6.0, 4.0, 0.0, 0.06, { glow: flood(1.0) }), lead = PLAIN(ELY_LEAD, 0.3, { glow: flood(0.3) });
  b.set(stone);
  box(b, -78, 0, 0, 14, 4, 6);                                  // the Galilee porch
  box(b, -37, 0, 0, 12, 23, 12);                                // the nave's aisles
  box(b, -37, 0, 12, 23, 23, 6.5);                              // the nave's clerestory
  box(b, 0, 0, 0, 22, 9, 27);                                   // the transepts
  box(b, 46, 0, 0, 12, 34, 12);                                 // the choir's aisles
  box(b, 46, 0, 12, 24, 34, 6.5);                               // the choir
  box(b, 24, 21, 0, 16, 15, 7);                                 // the Lady Chapel
  b.set(lead);
  gable(b, -78, 0, 14, 18, 4, 6, true);
  gable(b, -37, 0, 23, 29, 23, 6.5, true);
  gable(b, 0, 0, 22, 28, 9, 27);
  gable(b, 46, 0, 24, 30, 34, 6.5, true);
  gable(b, 24, 21, 16, 21, 15, 7, true);
  // the Octagon: the stone octagon over the crossing, its corner pinnacles, the lead roof and the lantern
  b.set(stone);
  b.loft([at(oct(15.5), 0), at(oct(15.5), 27)]);
  for (const [x, n] of oct(15.5)) spire(b, x, n, 27, 34, 1.0, 4);
  b.set(lead);
  b.loft([at(oct(15.5), 27), at(oct(7.2), 33)], { capTop: false });
  b.set(GLASS([0.36, 0.33, 0.26], 3.0, 1.6, 0.4, 0.2, { glow: flood(1.1) }));
  b.loft([at(oct(6.6), 33), at(oct(6.6), 48)]);
  for (const [x, n] of oct(6.6)) spire(b, x, n, 48, 52, 0.6, 4);
  b.set(lead);
  b.loft([at(oct(6.6), 48), at(oct(1.5), 49.5)]);
  // the west tower: square to 42 m, its octagon to 63 m, the four turrets to 66 m
  const TX = -68;
  b.set(stone);
  box(b, TX, 0, 0, 42, 7.5, 7.5);
  for (const [dx, dn] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) b.loft([at(oct(1.8, TX + dx * 7, dn * 7), 0), at(oct(1.6, TX + dx * 7, dn * 7), 46)]);
  b.loft([at(oct(7.0, TX, 0), 42), at(oct(6.6, TX, 0), 63)]);
  for (const [dx, dn] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) { const x = TX + dx * 4.6, n = dn * 4.6; b.loft([at(oct(1.1, x, n), 56), at(oct(1.0, x, n), 64.5), at(oct(0.15, x, n), 66)]); }
  // the south-west transept, with its octagonal corner turrets
  box(b, TX, -16.5, 0, 30, 7.5, 9);
  for (const dx of [-1, 1]) b.loft([at(oct(2.4, TX + dx * 7.5, -25.5), 0), at(oct(2.2, TX + dx * 7.5, -25.5), 40), at(oct(0.2, TX + dx * 7.5, -25.5), 45)]);
  box(b, TX, 14, 0, 9, 7.5, 6.5);                               // what stands of the north-west transept
  b.light([TX, 66, 0], 0);
  return b.result();
}

// ------------------------------------------------------------------ Zaragoza

// The Basílica del Pilar: 130 by 67 m (the article), its long axis along the Ebro (local x), brick walls (the article); the
// four corner towers about 92 m (the brief; the Spanish article says 98), each square to its belfry, an octagonal stage, a
// small dome and a spire [EST: the stages]; the great dome over the centre on its drum and the ten smaller domes round it,
// eleven in all (the article), their caps in glazed tiles of green, yellow, blue and white (the article) as gores; the
// domes' sizes and heights, the walls' and the roof's heights and the domes' plan [EST]. Floodlit at night.
export function pilar(brg = 0) {
  const b = new Builder(0.47).frame(0, 0, brg);
  const brick = GLASS(PILAR_BRICK, 5.0, 4.0, 0.0, 0.05, { glow: flood(1.0) }), plain = GLASS([0.40, 0.37, 0.30], 5.0, 4.0, 0.0, 0.05, { glow: flood(0.9) });
  const tiles = [TILE_GREEN, TILE_YELLOW, TILE_BLUE, TILE_WHITE].map((c) => PLAIN(c, 0.55, { glow: flood(0.5) }));
  const HX = 65, HN = 33.5, WALL = 27;
  b.set(brick);
  box(b, 0, 0, 0, WALL, HX - 2, HN - 2);
  b.set(PLAIN([0.22, 0.15, 0.10], 0.15, { glow: flood(0.3) }));
  box(b, 0, 0, WALL, WALL + 3, HX - 3, HN - 3);                    // the roofs between the domes
  // the great dome: its drum, the cap in gores, the lantern
  b.set(brick);
  cyl(b, 0, 0, WALL + 3, 46, 12, 12, 16);
  goredDome(b, 0, 0, 46, 12, 15, tiles, 16, 4);
  b.set(plain);
  cyl(b, 0, 0, 61, 67, 2.4, 2.0, 8);
  spire(b, 0, 0, 67, 72, 1.2, 6);
  // the ten smaller domes: four on the axis, three along each side [EST: the plan]
  for (const [x, n] of [[-46, 0], [-24, 0], [24, 0], [46, 0], [-42, 19], [0, 21], [42, 19], [-42, -19], [0, -21], [42, -19]]) {
    b.set(brick);
    cyl(b, x, n, WALL + 3, 36, 5.5, 5.5, 12);
    goredDome(b, x, n, 36, 5.5, 6.5, tiles, 8, 3);
    b.set(plain);
    cyl(b, x, n, 42.5, 46, 1.2, 1.0, 6);
  }
  // the four towers at the corners
  for (const [sx, sn] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const x = sx * (HX - 5.5), n = sn * (HN - 5.5);
    b.set(brick);
    box(b, x, n, 0, 52, 5.5, 5.5);
    box(b, x, n, 52, 64, 4.6, 4.6);                                    // the belfry
    b.set(plain);
    b.loft([at(oct(4.0, x, n), 64), at(oct(3.6, x, n), 74)]);
    b.set(tiles[(sx + 1) / 2 + (sn + 1)]);
    b.loft([at(oct(3.6, x, n), 74), at(oct(2.8, x, n), 78), at(oct(1.2, x, n), 80.5)]);
    b.set(plain);
    cyl(b, x, n, 80.5, 85, 1.0, 0.8, 6);
    spire(b, x, n, 85, 92, 0.7, 6);
    b.light([x, 92, n], 0);
  }
  return b.result();
}

// ------------------------------------------------------------------ Cádiz

// Cádiz Cathedral: on the sea front (the Campo del Sur behind its apse), the main front to the north-west (local -x) between
// its two towers, about 54 m from the ground (the Spanish article; about 56 m the brief); the crossing's dome on its drum,
// covered in golden tiles (the article), about 52 m to its lantern (the brief) [EST]; the nave, the transept and the
// ambulatory round the apse; the plan's sizes and the walls' heights [EST]. Limestone and shell stone (the article: pale).
export function cadiz(brg = 0) {
  const b = new Builder(0.53).frame(0, 0, brg);
  const stone = GLASS(CADIZ_STONE, 6.0, 4.0, 0.0, 0.06, { glow: flood(1.0) });
  b.set(stone);
  box(b, -6, 0, 0, 18, 34, 26);                                    // the aisles and chapels
  box(b, -6, 0, 18, 28, 34, 10);                                   // the nave
  box(b, 8, 0, 0, 28, 10, 30);                                     // the transept
  profile(b, 26, 0, [[0, 24], [18, 24], [18, 11], [26, 11]], 14, false);   // the ambulatory and the apse
  b.set(PLAIN([0.30, 0.27, 0.21], 0.15, { glow: flood(0.4) }));
  box(b, -6, 0, 28, 30, 34, 10); box(b, 8, 0, 28, 30, 10, 30);      // the flat roofs and their balustrades
  profile(b, 26, 0, [[26, 11], [30, 4], [31, 0.5]], 14);
  // the dome over the crossing
  b.set(stone);
  cyl(b, 8, 0, 30, 37, 12, 12, 16);
  goredDome(b, 8, 0, 37, 12, 11, [PLAIN(TILE_GOLD, 0.6, { glow: [0.45, 0.33, 0.10] })], 16, 4);
  b.set(stone);
  cyl(b, 8, 0, 48, 51, 2.4, 2.0, 8);
  goredDome(b, 8, 0, 51, 2.0, 1.0, [PLAIN(TILE_GOLD, 0.6, { glow: [0.45, 0.33, 0.10] })], 8, 2);
  // the front between the towers and the two towers: square to 36 m, the belfry, the octagonal lantern and its cap
  b.set(stone);
  box(b, -42, 0, 0, 30, 4, 12);
  for (const s of [-1, 1]) {
    const tn = s * 17;
    box(b, -40, tn, 0, 36, 5.5, 5.5);
    box(b, -40, tn, 36, 44, 4.6, 4.6);
    b.loft([at(oct(4.0, -40, tn), 44), at(oct(3.6, -40, tn), 49)]);
    goredDome(b, -40, tn, 49, 3.6, 4.0, [PLAIN([0.38, 0.35, 0.28], 0.3, { glow: flood(0.8) })], 8, 3);
    spire(b, -40, tn, 53, 54, 0.5, 4);
    b.light([-40, 54, tn], 0);
  }
  return b.result();
}

Object.assign(EUROPE_MODELS, { ely, pilar, cadiz });
