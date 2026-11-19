// v0.5.7: the home page's white line art (plain data, no DOM): a skyline strip of world landmarks that tiles
// seamlessly, and four small icons. All of it is drawn here as path data (no traced or copied artwork).
//
//   SKYLINE = { width, height, baseline, paths: ['M…', …], landmarks: [{ name, x0, x1 }, …] }
//     x from 0 to width, y from 0 to height (y grows downward), baseline = the ground line's y. Copies placed at
//     x = 0, width, 2·width, … join with no seam: the ground line (paths[0]) runs the full width and nothing else
//     reaches x = 0 or x = width.
//   ICONS = { planeTop, planeSide, boardingPass, suitcase }, each { w, h, paths: [...] } in its own w × h box:
//     planeTop an airliner from above, nose to +x, centred; planeSide from the side, nose to the left;
//     boardingPass a ticket with a perforated tear-off stub; suitcase a rolling suitcase.
//
// Every path is meant to be stroked: fill none, stroke-width about 1.5–2 at 1:1, round caps and joins. Only the
// absolute commands M L H Q C Z are used (curves as Béziers, no arcs), so every point a path reaches lies inside the
// hull of the points it lists. Everything is computed once, at import.

const H = 220, B = 212;
const RAD = Math.PI / 180;
const num = (v) => { const r = Math.round(v * 10) / 10; return r === 0 ? '0' : String(r); };

// ---- the pen ----------------------------------------------------------------------------------------------------
// Draws in local coordinates mapped by T(x, y) → [X, Y]. path() builds one path; poly/line/rect/circle are shorthands.
function pen(T) {
  const out = [];
  const P = (x, y) => { const [a, b] = T(x, y); return num(a) + ' ' + num(b); };
  const g = { out };
  g.path = () => {
    let s = '', cx = NaN, cy = NaN, sx = NaN, sy = NaN;
    const p = {
      M(x, y) { s += 'M' + P(x, y); cx = sx = x; cy = sy = y; return p; },
      L(x, y) { s += 'L' + P(x, y); cx = x; cy = y; return p; },
      Q(x1, y1, x, y) { s += 'Q' + P(x1, y1) + ' ' + P(x, y); cx = x; cy = y; return p; },
      C(x1, y1, x2, y2, x, y) { s += 'C' + P(x1, y1) + ' ' + P(x2, y2) + ' ' + P(x, y); cx = x; cy = y; return p; },
      // to (x, y): M if nothing drawn yet, else L unless already there
      to(x, y) { if (!s) return p.M(x, y); if (Math.hypot(x - cx, y - cy) > 0.04) p.L(x, y); return p; },
      // an elliptical arc around (ex, ey) from angle a0 to a1 (degrees; 0 = +x, 90 = +y of the local frame), as cubics
      arc(ex, ey, rx, ry, a0, a1) {
        const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 90 - 1e-9));
        const d = (a1 - a0) / n, k = 4 / 3 * Math.tan(d * RAD / 4);
        const at = (a) => [ex + rx * Math.cos(a * RAD), ey + ry * Math.sin(a * RAD)];
        p.to(...at(a0));
        for (let i = 0; i < n; i++) {
          const a = a0 + i * d, b = a + d, [x0, y0] = at(a), [x3, y3] = at(b);
          p.C(x0 - k * rx * Math.sin(a * RAD), y0 + k * ry * Math.cos(a * RAD),
            x3 + k * rx * Math.sin(b * RAD), y3 - k * ry * Math.cos(b * RAD), x3, y3);
        }
        return p;
      },
      // a smooth curve (Catmull–Rom, as cubics) through the points
      smooth(pts) {
        p.to(...pts[0]);
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[i + 1], d = pts[Math.min(pts.length - 1, i + 2)];
          p.C(b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6, c[0] - (d[0] - b[0]) / 6, c[1] - (d[1] - b[1]) / 6, c[0], c[1]);
        }
        return p;
      },
      pts(pts) { for (const [x, y] of pts) p.to(x, y); return p; },
      Z() { s += 'Z'; cx = sx; cy = sy; return p; },
      end() { if (s) out.push(s); return g; },
    };
    return p;
  };
  g.poly = (pts, close = false) => { const p = g.path().pts(pts); if (close) p.Z(); return p.end(); };
  g.line = (x1, y1, x2, y2) => g.path().M(x1, y1).L(x2, y2).end();
  g.rect = (x, y, w, h) => g.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
  g.circle = (x, y, r, ry = r) => g.path().arc(x, y, r, ry, 0, 360).Z().end();
  g.smooth = (pts, close = false) => { const p = g.path().smooth(pts); if (close) p.Z(); return p.end(); };
  // a round-topped opening: jambs from hb, the crown at ht
  g.arch = (x0, x1, hb, ht) => { const r = (x1 - x0) / 2; return g.path().M(x0, hb).L(x0, ht - r).arc(x0 + r, ht - r, r, r, 180, 0).L(x1, hb).end(); };
  // a pointed opening: jambs from hb to the springing hs, the apex at ha
  g.pointed = (x0, x1, hb, hs, ha) => {
    const m = (x0 + x1) / 2, c = hs + 0.55 * (ha - hs);
    return g.path().M(x0, hb).L(x0, hs).Q(x0, c, m, ha).Q(x1, c, x1, hs).L(x1, hb).end();
  };
  return g;
}

// mirror a half outline: half = [[dx, h], …] from the bottom up (its last point on the axis, dx 0, or not)
const sym = (cx, half) => {
  const L = half.map(([dx, h]) => [cx - dx, h]);
  const R = half.slice().reverse().map(([dx, h]) => [cx + dx, h]);
  if (half[half.length - 1][0] === 0) R.shift();
  return L.concat(R);
};
// sample f(h) → half-width from h0 to h1 (n steps) as [[dx, h], …]
const sample = (f, h0, h1, n) => Array.from({ length: n + 1 }, (_, i) => { const h = h0 + (h1 - h0) * i / n; return [f(h), h]; });
const lerp = (a, b, t) => a + (b - a) * t;

// an X lattice between two edges (xl(h), xr(h)) at the given levels
function lattice(g, xl, xr, levels) {
  for (let i = 0; i < levels.length - 1; i++) {
    const a = levels[i], b = levels[i + 1];
    g.line(xl(a), a, xr(b), b); g.line(xr(a), a, xl(b), b);
  }
}

// cubic Bézier helpers: a point, a sub-curve, a height table (for curves running down in h), and drawing only the parts
// of a cubic that a hidden(point) test leaves visible
const bez = (q, t) => {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * q[0][0] + b * q[1][0] + c * q[2][0] + d * q[3][0], a * q[0][1] + b * q[1][1] + c * q[2][1] + d * q[3][1]];
};
function subCubic(q, t0, t1) {
  const split = (c, t) => {
    const L = (a, b) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
    const p01 = L(c[0], c[1]), p12 = L(c[1], c[2]), p23 = L(c[2], c[3]), p012 = L(p01, p12), p123 = L(p12, p23), m = L(p012, p123);
    return [[c[0], p01, p012, m], [m, p123, p23, c[3]]];
  };
  const left = split(q, t1)[0];
  return t0 > 0 ? split(left, t0 / t1)[1] : left;
}
const hTable = (q) => Array.from({ length: 33 }, (_, i) => bez(q, i / 32));
function xAtH(tab, h) {
  // the table runs down in h (from a peak to a foot): bisect for the segment holding h
  let lo = 0, hi = tab.length - 1;
  if (h >= tab[0][1]) return tab[0][0];
  if (h <= tab[hi][1]) return tab[hi][0];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tab[m][1] > h) lo = m; else hi = m; }
  const [x0, y0] = tab[lo], [x1, y1] = tab[hi];
  return y1 === y0 ? x0 : lerp(x0, x1, (h - y0) / (y1 - y0));
}
function cubicVisible(g, q, hidden) {
  const N = 32, runs = [];
  let was = hidden(q[0]), start = was ? null : 0;
  for (let i = 1; i <= N; i++) {
    const t = i / N, is = hidden(bez(q, t));
    if (is === was) continue;
    let a = (i - 1) / N, b = t;
    for (let k = 0; k < 14; k++) { const m = (a + b) / 2; if (hidden(bez(q, m)) === was) a = m; else b = m; }
    const tc = (a + b) / 2;
    if (was) start = tc; else { runs.push([start, tc]); start = null; }
    was = is;
  }
  if (start !== null) runs.push([start, 1]);
  for (const [t0, t1] of runs) {
    if (t1 - t0 < 0.02) continue;
    const s = t0 === 0 && t1 === 1 ? q : subCubic(q, t0, t1);
    g.path().M(...s[0]).C(...s[1], ...s[2], ...s[3]).end();
  }
}

// An onion dome on (cx, h0): base half-width w0, widest w1, height hd. Returns its right half-width at h (for stripes).
function onion(g, cx, h0, w0, w1, hd, o = {}) {
  const bul = o.bulge ?? 0.32, tip = o.tip ?? 0.08, tc = o.tipC ?? 0.7, hb = h0 + bul * hd;
  const A = [[w0, h0], [w0 + 0.9 * (w1 - w0), h0 + 0.04 * hd], [w1, h0 + 0.14 * hd], [w1, hb]];
  const Bz = [[w1, hb], [w1, h0 + (bul + 0.26) * hd], [tip * w1, h0 + tc * hd], [0, h0 + hd]];
  const p = g.path().M(cx - w0, h0);
  p.C(cx - A[1][0], A[1][1], cx - A[2][0], A[2][1], cx - w1, hb);
  p.C(cx - Bz[1][0], Bz[1][1], cx - Bz[2][0], Bz[2][1], cx, h0 + hd);
  p.C(cx + Bz[2][0], Bz[2][1], cx + Bz[1][0], Bz[1][1], cx + w1, hb);
  p.C(cx + A[2][0], A[2][1], cx + A[1][0], A[1][1], cx + w0, h0);
  if (o.close) p.Z();
  p.end();
  // the right half sampled, for its half-width at h
  const tab = [];
  for (const q of [A, Bz]) for (let i = 0; i <= 16; i++) tab.push(bez(q, i / 16));
  return (h) => {
    for (let i = 0; i < tab.length - 1; i++) {
      const [x0, y0] = tab[i], [x1, y1] = tab[i + 1];
      if ((h - y0) * (h - y1) <= 0 && y1 !== y0) return lerp(x0, x1, (h - y0) / (y1 - y0));
    }
    return 0;
  };
}
// a cross (or a finial) standing on (x, h)
const cross = (g, x, h, len, bar = 2.2) => { g.line(x, h, x, h + len); g.line(x - bar, h + len * 0.68, x + bar, h + len * 0.68); };

// ---- the landmarks ------------------------------------------------------------------------------------------------
// Each draws in its slot's local coordinates: x from the slot's left edge, h up from the ground line.

// A Korean tiled roof (Sungnyemun): eave at he with tips lifted, its top (where the storey above meets it) at ht.
function koreanRoof(g, cx, he, half, lift, ht, halfTop, ridge = false) {
  const L = cx - half, R = cx + half;
  g.path().M(L, he + lift).Q(cx - half * 0.74, he, cx - half * 0.46, he).L(cx + half * 0.46, he).Q(cx + half * 0.74, he, R, he + lift)
    .Q(cx + halfTop + 0.5 * (half - halfTop), he + lift * 1.05, cx + halfTop, ht).L(cx - halfTop, ht)
    .Q(cx - halfTop - 0.5 * (half - halfTop), he + lift * 1.05, L, he + lift).Z().end();
  // the eave's fascia
  g.path().M(L + 4, he + lift * 0.62).Q(cx - half * 0.7, he + 2.6, cx - half * 0.44, he + 2.6).L(cx + half * 0.44, he + 2.6)
    .Q(cx + half * 0.7, he + 2.6, R - 4, he + lift * 0.62).end();
  // tile rows
  const n = Math.round(half / 6.5);
  for (let i = 1; i < n * 2; i++) {
    const t = i / (n * 2) - 0.5;
    g.line(cx + t * 2 * half * 0.62, he + 3.6 + Math.abs(t) * 1.6, cx + t * 2 * halfTop * 0.96, ht - 1.4);
  }
  if (ridge) {
    g.path().M(cx - halfTop - 4.5, ht + 5.5).Q(cx - halfTop - 2, ht + 2.6, cx - halfTop + 1.5, ht + 2.6).L(cx + halfTop - 1.5, ht + 2.6)
      .Q(cx + halfTop + 2, ht + 2.6, cx + halfTop + 4.5, ht + 5.5).end();
  }
}

function sungnyemun(g) {
  const cx = 62;
  // the stone base, its sides battered, and the rainbow arch with its ring of voussoirs
  g.poly([[6, 0], [11, 32], [113, 32], [118, 0]]);
  g.path().M(50, 0).L(50, 15).arc(cx, 15, 12, 12, 180, 0).L(74, 0).end();
  g.path().arc(cx, 15, 15.5, 15.5, 180, 0).end();
  g.line(cx, 0, cx, 25.5);
  g.line(8.4, 11, 44, 11); g.line(80, 11, 115.6, 11);
  g.line(10.1, 22, 45.5, 22); g.line(78.5, 22, 113.9, 22);
  // the parapet
  g.poly([[13, 32], [13, 36], [111, 36], [111, 32]]);
  // the lower storey, its roof, the upper storey and its roof
  for (const x of [28, 40, 52, 72, 84, 96]) g.line(x, 36, x, 45.5);
  g.poly([[24, 45.5], [24, 36]]); g.poly([[100, 45.5], [100, 36]]);
  koreanRoof(g, cx, 45.5, 54, 7.5, 56, 27);
  g.rect(35, 56, 54, 10);
  for (const x of [48.5, 62, 75.5]) g.line(x, 56, x, 66);
  g.line(35, 60, 89, 60);
  koreanRoof(g, cx, 66, 48, 9, 82, 23, true);
}

function eiffel(g) {
  const cx = 42, hw = (h) => 2 + 34.6 * Math.exp(-h / 52);
  const L = (h) => cx - hw(h), R = (h) => cx + hw(h);
  const edge = (h0, h1, s) => g.smooth(sample((h) => s * hw(h), h0, h1, Math.max(3, Math.ceil((h1 - h0) / 9))).map(([dx, h]) => [cx + dx, h]));
  // legs and the great arch between them, up to the first floor
  edge(0, 31.5, -1); edge(0, 31.5, 1);
  g.path().arc(cx, 0, 21.5, 27.5, 180, 0).end();
  const inner = (h) => 21.5 * Math.sqrt(Math.max(0, 1 - (h / 27.5) ** 2));
  lattice(g, L, (h) => cx - inner(h), [0, 9.5, 19, 26.5]);
  lattice(g, (h) => cx + inner(h), R, [0, 9.5, 19, 26.5]);
  g.rect(cx - 23, 31.5, 46, 5);
  // the second stage: the legs lean in to meet under the second floor
  edge(36.5, 67.5, -1); edge(36.5, 67.5, 1);
  g.path().M(cx - 11.5, 36.5).Q(cx - 10.5, 54, cx, 62).Q(cx + 10.5, 54, cx + 11.5, 36.5).end();
  const op = (h) => (h >= 62 ? 0 : 11.5 * (1 - ((h - 36.5) / 25.5) ** 1.6));
  lattice(g, L, (h) => cx - op(h), [36.5, 49, 61]);
  lattice(g, (h) => cx + op(h), R, [36.5, 49, 61]);
  g.rect(cx - 13.5, 67.5, 27, 4);
  // the long upper stage, its lattice, the top floor, the campanile and the mast
  edge(71.5, 161.5, -1); edge(71.5, 161.5, 1);
  lattice(g, L, R, [71.5, 85, 98, 110, 121, 131, 140, 148, 155, 161.5]);
  g.rect(cx - 5.5, 161.5, 11, 3.5);
  g.poly([[cx - 2.6, 165], [cx - 2.6, 171], [cx + 2.6, 171], [cx + 2.6, 165]]);
  g.path().M(cx - 2.6, 171).Q(cx, 175.5, cx + 2.6, 171).end();
  g.line(cx, 174, cx, 194); g.line(cx - 1.6, 184, cx + 1.6, 184);
}

function operaHouse(g) {
  const base = 12;
  // the podium and the monumental steps at its back
  g.poly([[4, 0], [4, base], [158, base], [158, 8.5], [163, 8.5], [163, 4.5], [168, 4.5], [168, 0]]);
  g.line(4, 6, 158, 6);
  // the shells, front to back, each hidden where it passes behind those drawn before it. A shell: its peak, the
  // foot of its mouth (the glass front, under the overhanging peak) and the foot of its back; facing left when the
  // back foot is right of the peak, facing right otherwise.
  const front = [];
  const shell = (xp, hp, xf, xb, ribs) => {
    const d = hp - base;
    const mouth = [[xp, hp], [lerp(xp, xf, 0.6), hp - 0.35 * d], [xf, base + 0.35 * d], [xf, base]];
    const back = [[xp, hp], [lerp(xp, xb, 0.5), hp - 0.04 * d], [xb, base + 0.5 * d], [xb, base]];
    const lines = [mouth, back];
    for (let i = 1; i <= ribs; i++) {
      const f = i / (ribs + 1), s = bez(mouth, 0.06 + 0.12 * f), e = [lerp(xb, xf, f * 0.9 + 0.05), base], dd = s[1] - base;
      lines.push([s, [lerp(s[0], e[0], 0.5), s[1] - 0.04 * dd], [e[0], base + 0.5 * dd], e]);
    }
    const hidden = (pt) => front.some((f) => f(pt));
    for (const q of lines) cubicVisible(g, q, hidden);
    const tm = hTable(mouth), tb = hTable(back), x0 = Math.min(xp, xf, xb), x1 = Math.max(xp, xf, xb);
    front.push(([x, h]) => {
      if (h <= base + 0.2 || h >= hp - 0.2 || x <= x0 || x >= x1) return false;
      const a = xAtH(tm, h), b = xAtH(tb, h);
      return x > Math.min(a, b) + 0.4 && x < Math.max(a, b) - 0.4;
    });
  };
  // the concert hall: three shells rising to the right and one facing back
  shell(16, 34, 24, 46, 1);
  shell(30, 54, 40, 70, 2);
  shell(48, 73, 60, 99, 2);
  shell(107, 46, 102, 84, 1);
  // the theatre, smaller, the same way round
  shell(113, 27, 119, 132, 1);
  shell(124, 41, 132, 149, 1);
  shell(137, 52, 146, 160, 1);
  shell(165, 31, 161, 150, 1);
}

function empireState(g) {
  const cx = 35;
  const steps = [[31, 0], [31, 12], [26, 12], [26, 30], [23, 30], [23, 40], [19.5, 40], [19.5, 48], [16, 48], [16, 112],
    [13, 112], [13, 124], [10, 124], [10, 132], [7, 132]];
  const half = steps.concat([[6.2, 140], [5, 156], [5.6, 156], [3.6, 160], [1.6, 163], [0, 163.6]]);
  g.poly(sym(cx, half));
  // the piers running up the shaft and the setbacks
  for (const dx of [-11, -5.5, 0, 5.5, 11]) g.line(cx + dx, 49, cx + dx, 111);
  for (const dx of [-8.5, -3, 3, 8.5]) g.line(cx + dx, 113, cx + dx, 123);
  for (const dx of [-4, 0, 4]) g.line(cx + dx, 125, cx + dx, 131);
  g.line(cx - 20, 20, cx + 20, 20);
  for (const dx of [-18, -12, -6, 0, 6, 12, 18]) g.line(cx + dx, 14, cx + dx, 18);
  for (const dx of [-16, -8, 0, 8, 16]) g.line(cx + dx, 22, cx + dx, 28);
  // the mast's bands and the antenna
  g.line(cx - 5.9, 146, cx + 5.9, 146); g.line(cx - 5.2, 152, cx + 5.2, 152);
  g.line(cx, 163.6, cx, 188);
}

function tajMahal(g) {
  const cx = 80;
  g.poly([[2, 0], [2, 6], [158, 6], [158, 0]]);
  // the minarets with their balconies and kiosks
  for (const mx of [10, 150]) {
    g.poly([[mx - 3.2, 6], [mx - 2.6, 84]]); g.poly([[mx + 3.2, 6], [mx + 2.6, 84]]);
    for (const h of [30, 56, 82]) g.poly([[mx - 5, h], [mx - 4.4, h + 2], [mx + 4.4, h + 2], [mx + 5, h]], true);
    g.poly([[mx - 3.4, 84], [mx - 3.4, 88], [mx + 3.4, 88], [mx + 3.4, 84]]);
    onion(g, mx, 88, 3.6, 4.4, 8, { tip: 0.1 });
    g.line(mx, 96, mx, 100);
  }
  // the main block, its tall portal and the arches either side
  g.poly([[40, 6], [40, 52], [64, 52]]); g.poly([[96, 52], [120, 52], [120, 6]]);
  g.line(45, 6, 45, 52); g.line(115, 6, 115, 52);
  g.poly([[64, 6], [64, 58], [96, 58], [96, 6]]);
  g.line(64, 58, 64, 62); g.line(96, 58, 96, 62);
  g.pointed(69, 91, 6, 34, 52);
  g.poly([[67, 6], [67, 55], [93, 55], [93, 6]]);
  for (const [x0, x1] of [[48, 60], [100, 112]]) { g.pointed(x0, x1, 8, 20, 27); g.pointed(x0, x1, 31, 42, 48); }
  // the kiosks on the roof
  for (const kx of [52, 108]) {
    g.line(kx - 4, 52, kx - 4, 58); g.line(kx + 4, 52, kx + 4, 58); g.line(kx - 5, 58, kx + 5, 58);
    onion(g, kx, 58, 5, 5.6, 9, { tip: 0.1 });
    g.line(kx, 67, kx, 70);
  }
  // the drum, the great dome and its finial
  g.poly([[62.5, 58], [62.5, 64], [97.5, 64], [97.5, 58]]);
  onion(g, cx, 64, 17, 22.5, 46, { bulge: 0.3, tip: 0.1, tipC: 0.72 });
  g.line(cx, 110, cx, 119); g.circle(cx, 113.5, 1.4);
}

function bigBen(g) {
  const cx = 20;
  g.line(8, 0, 8, 86); g.line(32, 0, 32, 86);
  g.line(14, 4, 14, 83); g.line(26, 4, 26, 83);
  for (const h of [18, 34, 50, 66]) g.line(16.5, h, 23.5, h);
  // the clock stage, the dial and its hands
  g.rect(6, 86, 28, 28);
  g.circle(cx, 100, 10);
  g.line(cx, 100, cx - 1.5, 106.5); g.line(cx, 100, cx + 5, 103);
  g.line(6, 114, 6, 120); g.line(34, 114, 34, 120);
  // the belfry and its arcade
  g.poly([[8, 114], [8, 128], [32, 128], [32, 114]]);
  for (const x of [10.5, 17.5, 24.5]) g.pointed(x, x + 5, 115, 121, 125.5);
  // the spire roof with corner pinnacles, the lantern and the finial
  g.poly([[8, 128], [14.5, 152], [25.5, 152], [32, 128]]);
  g.line(8, 128, 8, 135); g.line(32, 128, 32, 135);
  g.line(11.5, 136, 28.5, 136); g.line(13.2, 144, 26.8, 144);
  g.poly([[15.5, 152], [15.5, 158], [24.5, 158], [24.5, 152]]);
  g.poly([[15.5, 158], [cx, 172], [24.5, 158]]);
  g.line(cx, 172, cx, 178);
}

// the height of a quadratic Bézier [p0, p1, p2] where it passes x (x monotonic along it)
function quadAtX([p0, p1, p2], x) {
  let prev = p0;
  for (let i = 1; i <= 64; i++) {
    const t = i / 64, u = 1 - t;
    const q = [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
    if ((x - prev[0]) * (x - q[0]) <= 0) return lerp(prev[1], q[1], (x - prev[0]) / (q[0] - prev[0] || 1));
    prev = q;
  }
  return p2[1];
}

// line-line intersection of (a1→a2) and (b1→b2)
function meet(a1, a2, b1, b2) {
  const d = (a2[0] - a1[0]) * (b2[1] - b1[1]) - (a2[1] - a1[1]) * (b2[0] - b1[0]);
  const t = ((b1[0] - a1[0]) * (b2[1] - b1[1]) - (b1[1] - a1[1]) * (b2[0] - b1[0])) / d;
  return [a1[0] + t * (a2[0] - a1[0]), a1[1] + t * (a2[1] - a1[1])];
}

function pyramids(g) {
  // a pyramid: feet l and r, apex (ax, ah), the near corner's foot rx (the ridge between its two faces), the face in
  // shadow hatched; `behind` = the edge [top, foot] of one in front, which hides its lower left edge; cap = the height
  // (a fraction) where Khafre's remaining casing stones begin
  const pyr = (l, r, ax, ah, rx, behind = null, cap = 0) => {
    const apex = [ax, ah], left = behind ? meet([l, 0], apex, behind[0], behind[1]) : [l, 0];
    g.poly([left, apex, [r, 0]]);
    g.line(ax, ah, rx, 0);
    for (let h = 7; h < ah - 6; h += 7.5) { const t = h / ah; g.line(lerp(rx, ax, t) + 2.5, h, lerp(r, ax, t) - 2, h); }
    if (cap) g.line(lerp(l, ax, cap), ah * cap, lerp(r, ax, cap), ah * cap);
    return [apex, [r, 0]];
  };
  const khufu = pyr(4, 112, 58, 68, 72);
  pyr(94, 190, 142, 62, 152, khufu, 0.86);
  pyr(196, 236, 216, 26, 221);
}

function nSeoulTower(g) {
  const cx = 75;
  // Namsan with a few tree crowns on its slopes, and the plaza building on its top
  const hill = (x) => 40 * (1 - ((x - cx) / 75) ** 2) ** 2;
  const p = g.path().M(0, 0);
  const run = (a, b) => { const n = Math.max(1, Math.round((b - a) / 6)); p.smooth(Array.from({ length: n + 1 }, (_, i) => [lerp(a, b, i / n), hill(lerp(a, b, i / n))])); };
  const bump = (a, b) => { const t = Math.max(hill(a), hill(b)) + 5.5; p.C(a - 0.5, t, b + 0.5, t, b, hill(b)); };
  run(0, 28); bump(28, 36); run(36, 40); bump(40, 48); run(48, 52); bump(52, 59); run(59, cx - 13);
  p.L(cx - 13, 47).L(cx + 13, 47).L(cx + 13, hill(cx + 13));
  run(cx + 13, 91); bump(91, 98); run(98, 102); bump(102, 110); run(110, 114); bump(114, 122); run(122, 150);
  p.end();
  // the shaft, the observatory, the mast
  g.line(cx - 4, 47, cx - 3, 108); g.line(cx + 4, 47, cx + 3, 108);
  g.poly(sym(cx, [[3, 108], [9.5, 116], [9.5, 129], [6, 132.5], [3.6, 132.5], [3.6, 137], [0, 137]]), true);
  g.line(cx - 9.5, 120.5, cx + 9.5, 120.5); g.line(cx - 9.5, 125, cx + 9.5, 125);
  g.poly([[cx - 2.8, 137], [cx - 1, 170]]); g.poly([[cx + 2.8, 137], [cx + 1, 170]]);
  g.line(cx - 3.6, 148, cx + 3.6, 148); g.line(cx - 3, 159, cx + 3, 159);
  g.line(cx, 170, cx, 184);
}

function colosseum(g) {
  const x0 = 6, x1 = 184, cx = (x0 + x1) / 2, a = (x1 - x0) / 2;
  const tiers = [0, 19, 37, 54, 70];
  const n = 14;
  const piers = Array.from({ length: n + 1 }, (_, i) => cx + a * Math.sin((-90 + 180 * i / n) * RAD));
  const brk = 116; // where the outer wall's top breaks away
  // the outline: full height on the left, the broken edge, then the lower ring
  g.poly([[x0, 0], [x0, 70], [brk, 70], [brk + 3, 64], [brk + 6, 64], [brk + 9, 55], [brk + 13, 52], [brk + 16, 44], [brk + 22, 40], [x1, 40], [x1, 0]]);
  // cornices
  g.line(x0, 19, x1, 19); g.line(x0, 37, x1, 37);
  g.line(x0, 54, brk + 13, 54);
  // arches in the two lower tiers everywhere, the third tier and the attic only on the left
  for (let t = 0; t < 3; t++) {
    const hb = tiers[t], ht = tiers[t + 1] - 2.5;
    for (let i = 0; i < n; i++) {
      const pa = piers[i], pb = piers[i + 1], w = pb - pa, pad = Math.min(2.4, w * 0.2);
      if (t === 2 && pb > brk + 8) continue;
      if (w < 4.5) continue;
      g.arch(pa + pad, pb - pad, hb + (t ? 2 : 0), ht);
    }
  }
  // the attic's pilasters and windows
  for (let i = 1; i < n; i++) if (piers[i] < brk - 1) g.line(piers[i], 55.5, piers[i], 68.5);
  for (let i = 0; i < n; i += 2) {
    const pa = piers[i], pb = piers[i + 1];
    if (pb > brk - 1 || pb - pa < 6) continue;
    const m = (pa + pb) / 2; g.rect(m - 1.6, 59, 3.2, 4.5);
  }
}

function burjKhalifa(g) {
  const cx = 32;
  const Ls = [[24, 26], [19, 52], [15, 78], [11.5, 102], [8.5, 124], [6, 143], [4, 158]];
  const Rs = [[21, 38], [17, 64], [13, 89], [10, 112], [7, 133], [5, 151], [4, 158]];
  const stair = (steps, s) => {
    const pts = [[cx + s * steps[0][0], 0]];
    for (let i = 0; i < steps.length; i++) {
      pts.push([cx + s * steps[i][0], steps[i][1]]);
      if (i + 1 < steps.length) pts.push([cx + s * steps[i + 1][0], steps[i][1]]);
    }
    return pts;
  };
  const L = stair(Ls, -1), R = stair(Rs, 1);
  g.poly(L.concat([[cx - 3, 158], [cx - 2.2, 172], [cx - 0.5, 206], [cx + 0.5, 206], [cx + 2.2, 172], [cx + 3, 158]]).concat(R.reverse()));
  // the bands' seams running down
  for (let i = 1; i < 4; i++) { g.line(cx - Ls[i][0], 3, cx - Ls[i][0], Ls[i - 1][1]); g.line(cx + Rs[i][0], 3, cx + Rs[i][0], Rs[i - 1][1]); }
  g.line(cx - 22, 3, cx + 19, 3);
}

function liberty(g) {
  const cx = 35;
  // Fort Wood, the pedestal (with its loggia) and its cornice
  g.poly([[0, 0], [5, 9], [65, 9], [70, 0]]);
  g.poly([[14, 9], [14, 14], [56, 14], [56, 9]]);
  g.line(18, 14, 20, 58); g.line(52, 14, 50, 58);
  g.rect(17, 58, 36, 4);
  g.poly([[21, 62], [21, 70], [49, 70], [49, 62]]);
  g.line(19.1, 36, 50.9, 36);
  for (const x of [27, 33, 39]) g.arch(x, x + 4, 40, 53);
  // the figure: robe, raised arm and torch, head and crown, tablet
  g.smooth([[cx - 10.4, 70], [cx - 8.8, 90], [cx - 7, 110], [cx - 6.2, 121]]); g.line(cx - 6.2, 121, cx - 2.6, 124.6);
  g.poly([[cx + 2.6, 124.6], [cx + 6, 121.5], [cx + 5.4, 116]]);
  g.smooth([[cx + 7.4, 101.3], [cx + 9, 86], [cx + 10.8, 70]]);
  g.poly([[cx - 6.6, 119.5], [cx - 11.6, 144.5], [cx - 8.6, 144.5], [cx - 3.4, 123]]);
  g.poly([[cx - 11.8, 145.5], [cx - 13.4, 149.5], [cx - 6.8, 149.5], [cx - 8.4, 145.5]], true);
  g.path().M(cx - 12.6, 149.5).Q(cx - 14, 154.5, cx - 10.1, 159.5).Q(cx - 6.2, 154.5, cx - 7.6, 149.5).end();
  g.circle(cx, 128.4, 3.3);
  for (const a of [28, 50, 71, 90, 109, 130, 152]) g.line(cx + 4 * Math.cos(a * RAD), 129 + 4 * Math.sin(a * RAD), cx + 8.6 * Math.cos(a * RAD), 129 + 8.6 * Math.sin(a * RAD));
  g.poly([[cx + 4.6, 115.3], [cx + 10.6, 117.6], [cx + 12.2, 103.4], [cx + 6.2, 101]], true);
  g.path().M(cx - 6.8, 106).Q(cx - 1, 104.5, cx + 6.6, 99.5).end(); g.line(cx - 3.4, 71, cx - 2.4, 94); g.line(cx + 3.6, 71, cx + 2.8, 90);
}

function stBasils(g) {
  g.poly([[8, 0], [8, 26], [142, 26], [142, 0]]);
  for (let i = 0; i < 9; i++) g.arch(14 + i * 14, 22 + i * 14, 0, 16);
  g.line(8, 20, 142, 20);
  const dome = (cx, top, w, wmax, hd, stripes, crossLen) => {
    g.poly([[cx - w, 26], [cx - w, top]]); g.poly([[cx + w, 26], [cx + w, top]]);
    g.line(cx - w - 1.5, top, cx + w + 1.5, top);
    g.pointed(cx - w + 2, cx + w - 2, top - 9, top - 5, top - 1.5);
    const hw = onion(g, cx, top, w - 1.5, wmax, hd, { bulge: 0.33, tip: 0.05, tipC: 0.74 });
    for (let i = 0; i < stripes; i++) {
      const ha = top + hd * (0.1 + 0.2 * i), hb = ha + hd * 0.3;
      if (hb > top + hd * 0.78) break;
      const xa = cx - hw(ha) * 0.92, xb = cx + hw(hb) * 0.92;
      g.path().M(xa, ha).Q(cx, (ha + hb) / 2 - hd * 0.06, xb, hb).end();
    }
    cross(g, cx, top + hd, crossLen);
  };
  // the central tent spire over its drum and its gables
  const cx = 75;
  g.poly([[cx - 10, 26], [cx - 10, 50]]); g.poly([[cx + 10, 26], [cx + 10, 50]]);
  for (const x of [cx - 10, cx - 3.3, cx + 3.3]) g.pointed(x, x + 6.7, 44, 48, 54);
  g.line(cx - 11, 50, cx + 11, 50);
  g.poly([[cx - 8.5, 54], [cx - 3, 94], [cx + 3, 94], [cx + 8.5, 54]], true);
  g.line(cx - 6, 72, cx + 6, 72);
  g.poly([[cx - 3, 94], [cx - 3, 99]]); g.poly([[cx + 3, 94], [cx + 3, 99]]);
  onion(g, cx, 99, 2.8, 4.6, 10, { tip: 0.05 });
  cross(g, cx, 109, 11);
  dome(42, 58, 7, 11.5, 24, 3, 10);
  dome(108, 54, 7, 11.5, 22, 3, 10);
  dome(18, 40, 5, 8, 16, 2, 8);
  dome(132, 44, 5, 8, 16, 2, 8);
}

function lotteTower(g) {
  const cx = 30, top = 198, slit = 174;
  // the mall at its foot
  g.poly([[2, 0], [2, 11], [58, 11], [58, 0]]);
  g.line(6, 6, 54, 6);
  // the slender cone, its sides gently curved, its crown split open by a notch
  const hw = (h) => 17 * Math.pow(Math.max(0, 1 - Math.pow(h / 201, 1.2)), 0.4);
  const side = sample(hw, 11, top - 3, 12);
  g.path().smooth(side.map(([dx, h]) => [cx - dx, h])).L(cx - 2.5, top).L(cx, slit).L(cx + 2.5, top)
    .smooth(side.slice().reverse().map(([dx, h]) => [cx + dx, h])).end();
  g.line(cx, 11, cx, slit);
}

function towerBridge(g) {
  const deck = 20;
  g.line(0.5, deck, 229.5, deck); g.line(10, deck + 4, 66, deck + 4); g.line(92, deck + 4, 138, deck + 4); g.line(164, deck + 4, 220, deck + 4);
  g.line(115, deck, 115, deck + 4);
  const tower = (x) => {
    const c = x + 13;
    g.poly([[x, 0], [x, 82]]); g.poly([[x + 26, 0], [x + 26, 82]]);
    g.line(x, 82, x + 26, 82);
    g.pointed(x + 5, x + 21, 0, deck + 12, deck + 20);
    g.line(x, 46, x + 26, 46); g.line(x, 70, x + 26, 70);
    g.pointed(c - 8, c - 2, 50, 60, 65); g.pointed(c + 2, c + 8, 50, 60, 65);
    // corner turrets and the central spire
    for (const tx of [x, x + 26]) { g.poly([[tx - 2, 82], [tx - 2, 90], [tx, 96], [tx + 2, 90], [tx + 2, 82]]); }
    g.poly([[c - 8, 82], [c, 104], [c + 8, 82]]);
    g.line(c, 104, c, 110);
  };
  tower(66); tower(138);
  // the high walkways and their lattice
  g.line(92, 66, 138, 66); g.line(92, 74, 138, 74);
  for (let x = 92; x < 137; x += 7.7) { g.line(x, 66, x + 3.85, 74); g.line(x + 3.85, 74, Math.min(138, x + 7.7), 66); }
  // the side spans' chains and hangers, and the shore towers
  for (const s of [-1, 1]) {
    const tx = s < 0 ? 66 : 164, ex = s < 0 ? 9 : 221;
    g.path().M(tx, 72).Q(lerp(tx, ex, 0.62), 26, ex, 32).end();
    const chain = [[tx, 72], [lerp(tx, ex, 0.62), 26], [ex, 32]];
    for (const f of [0.2, 0.4, 0.6, 0.8]) { const x = lerp(tx, ex, f); g.line(x, deck + 4, x, quadAtX(chain, x)); }
    g.poly([[ex - 5, 0], [ex - 5, 32], [ex, 38], [ex + 5, 32], [ex + 5, 0]]);
  }
}

function christRedeemer(g) {
  const sx = 64;
  // Corcovado, its cliff under the statue, and Sugarloaf beyond
  g.path().M(0, 0).C(12, 3, 24, 12, 34, 28).C(40, 38, 44, 40, 48, 50).C(53, 62, 56, 74, sx - 5, 78).L(sx + 4.5, 78)
    .C(sx + 7, 66, sx + 9, 44, sx + 13, 26).C(sx + 17, 10, sx + 26, 4, 102, 3)
    .C(110, 2.5, 113, 20, 117, 36).C(120, 48, 126, 53, 132, 53).C(140, 53, 145, 40, 148, 22).C(150, 9, 153, 2, 160, 0).end();
  // the statue: plinth, robe, arms outstretched, head
  g.poly([[sx - 3.4, 78], [sx - 3.4, 85], [sx + 3.4, 85], [sx + 3.4, 78]]);
  g.poly([[sx - 4.8, 85], [sx - 3.4, 114], [sx - 21.5, 115.2], [sx - 22, 117.8], [sx - 3.2, 119.6], [sx - 1.7, 121.8], [sx + 1.7, 121.8],
    [sx + 3.2, 119.6], [sx + 22, 117.8], [sx + 21.5, 115.2], [sx + 3.4, 114], [sx + 4.8, 85]]);
  g.circle(sx, 125, 3);
  g.line(sx - 1.2, 88, sx - 0.6, 111);
}

function petronas(g) {
  const tower = (cx) => {
    const half = [[12, 0], [12, 92], [10.5, 92], [10.5, 108], [9, 108], [9, 121], [7.5, 121], [7.5, 133], [6, 133], [6, 143],
      [4.6, 143], [4.6, 151], [3.2, 155], [1, 170], [0, 170]];
    g.poly(sym(cx, half));
    g.line(cx - 6, 4, cx - 6, 88); g.line(cx + 6, 4, cx + 6, 88); g.line(cx, 4, cx, 88);
    g.line(cx, 170, cx, 192); g.line(cx - 1.4, 177, cx + 1.4, 177); g.line(cx - 1.1, 184, cx + 1.1, 184);
  };
  const a = 28, b = 82;
  tower(a); tower(b);
  g.rect(a + 12, 64, b - a - 24, 5);
  g.line((a + b) / 2 - 2, 64, a + 12, 46); g.line((a + b) / 2 + 2, 64, b - 12, 46);
}

function pisa(g) {
  const cx = 22, tilt = 5.5 * RAD, lift = 13 * Math.sin(tilt);
  const T = ([u, v]) => [cx + u * Math.cos(tilt) + v * Math.sin(tilt), -u * Math.sin(tilt) + v * Math.cos(tilt) + lift];
  const P = (pts) => pts.map(T);
  const R = 13, Rb = 9.5;
  const story = [0, 15, 26, 37, 48, 59, 70, 81];
  // the drum's outline, the belfry and its roof
  g.poly(P([[-R, 0], [-R, 81], [-Rb, 81], [-Rb, 93], [Rb, 93], [Rb, 81], [R, 81], [R, 0]]));
  g.path().pts(P([[-Rb - 0.5, 93]])).Q(...T([0, 97.5]), ...T([Rb + 0.5, 93])).end();
  // the galleries and their arcades
  const cols = [-90, -50, -15, 15, 50, 90].map((d) => R * Math.sin(d * RAD));
  for (let i = 1; i < story.length; i++) g.poly(P([[-R - 1, story[i]], [R + 1, story[i]]]));
  for (let i = 0; i < story.length - 1; i++) {
    const vb = story[i] + (i ? 1.5 : 1), vt = story[i + 1] - 1.6;
    for (let j = 0; j < cols.length - 1; j++) {
      const ua = cols[j] + 1.1, ub = cols[j + 1] - 1.1, r = (ub - ua) / 2;
      if (r < 0.9) continue;
      const p = g.path().pts(P([[ua, vb], [ua, vt - r]]));
      for (let k = 1; k <= 6; k++) { const a = Math.PI - Math.PI * k / 6; p.L(...T([ua + r + r * Math.cos(a), vt - r + r * Math.sin(a)])); }
      p.L(...T([ub, vb])).end();
    }
  }
  const bcols = [-90, -30, 30, 90].map((d) => Rb * Math.sin(d * RAD));
  for (let j = 0; j < bcols.length - 1; j++) {
    const ua = bcols[j] + 1.2, ub = bcols[j + 1] - 1.2, r = (ub - ua) / 2;
    const p = g.path().pts(P([[ua, 82.5], [ua, 91.5 - r]]));
    for (let k = 1; k <= 6; k++) { const a = Math.PI - Math.PI * k / 6; p.L(...T([ua + r + r * Math.cos(a), 91.5 - r + r * Math.sin(a)])); }
    p.L(...T([ub, 82.5])).end();
  }
}

function spaceNeedle(g) {
  const cx = 37;
  for (const s of [-1, 1]) {
    const X = (dx) => cx + s * dx;
    g.smooth([[X(25), 0], [X(15), 22], [X(8), 52], [X(9.5), 90], [X(13), 118]]);
    g.smooth([[X(19), 0], [X(11), 22], [X(5), 52], [X(6.2), 90], [X(9.4), 117.2]]);
  }
  g.line(cx - 1.8, 0, cx - 1.8, 117); g.line(cx + 1.8, 0, cx + 1.8, 117);
  g.rect(cx - 9.5, 50, 19, 4);
  // the top house: the underside, the halo, the roof, the spire
  g.poly(sym(cx, [[13, 118], [31, 128], [31, 131.5], [20, 136.5], [14, 138], [9, 141.5], [4.6, 143], [0, 143]]), true);
  g.line(cx - 31, 128, cx + 31, 128); g.line(cx - 20, 136.5, cx + 20, 136.5);
  for (const dx of [-21, -10, 0, 10, 21]) g.line(cx + dx * 0.45, 119.5, cx + dx, 127.5);
  g.line(cx, 143, cx, 168);
}

function marinaBaySands(g) {
  // three towers, each on legs splayed at the foot, under the SkyPark, cantilevered out to the left
  for (const cx of [48, 93, 138]) {
    g.smooth([[cx - 15, 0], [cx - 13.4, 26], [cx - 13, 56], [cx - 13, 97]]);
    g.smooth([[cx + 15, 0], [cx + 13.4, 26], [cx + 13, 56], [cx + 13, 97]]);
    g.path().M(cx - 3.6, 0).Q(cx - 0.8, 24, cx, 38).Q(cx + 0.8, 24, cx + 3.6, 0).end();
  }
  g.path().M(8, 104).L(8, 101.4).L(30, 97).L(156, 97).Q(160, 97, 160, 101).Q(160, 105, 156, 105).L(12, 105).Q(8, 105, 8, 104).end();
  for (const x of [44, 52, 60, 120, 128]) g.path().M(x - 2.6, 105).Q(x, 110, x + 2.6, 105).end();
  g.line(80, 105, 80, 108.5); g.line(104, 105, 104, 108.5); g.line(80, 108.5, 104, 108.5);
}

function gatewayArch(g) {
  const cx = 70, k = 3.0;
  const curve = (half, ht, n) => Array.from({ length: n + 1 }, (_, i) => {
    const u = -1 + 2 * i / n; return [cx + half * u, ht * (1 - (Math.cosh(k * u) - 1) / (Math.cosh(k) - 1))];
  });
  g.smooth(curve(64, 138, 28)); g.smooth(curve(53, 133, 26));
  g.line(cx - 66, 0.01, cx - 50, 0.01); g.line(cx + 50, 0.01, cx + 66, 0.01);
}

function brandenburg(g) {
  g.poly([[4, 0], [4, 3], [126, 3], [126, 0]]);
  for (const x of [15.5, 34, 52.5, 77.5, 96, 114.5]) {
    g.line(x - 2.5, 3, x - 2.5, 39); g.line(x + 2.5, 3, x + 2.5, 39);
    g.line(x - 3.6, 39, x + 3.6, 39); g.line(x - 3.4, 5, x + 3.4, 5);
  }
  g.rect(8, 40, 114, 10); g.line(8, 44, 122, 44);
  for (let x = 12; x < 120; x += 6) g.line(x, 45.5, x, 48.5);
  g.poly([[20, 50], [20, 58], [110, 58], [110, 50]]); g.rect(42, 51.5, 46, 5);
  g.poly([[30, 58], [30, 61], [100, 61], [100, 58]]);
  g.poly([[46, 61], [46, 64], [84, 64], [84, 61]]);
  // the quadriga, in profile: the near horse rearing, the heads of the others behind it, the chariot, Victoria
  // with her standard (the wreath and the eagle on top)
  g.poly([[70, 64], [70.5, 69], [72, 72.5], [71, 75], [66, 75.6], [61.5, 76.2], [58.5, 80.5], [57.2, 82.4], [57.6, 84.2], [56, 82.6],
    [52.6, 78.4], [52.2, 77.4], [53.4, 77], [55.6, 78.6], [56.6, 72.5], [56.2, 71], [53, 69.5], [52, 68.8], [52.8, 66.5], [53.6, 66.2],
    [54.4, 68], [57.4, 69.6], [66.5, 69.8], [67.6, 67], [67.8, 64]]);
  g.poly([[64.6, 76.2], [61.6, 81.4], [60.4, 83.6], [60.8, 85.4], [59.2, 83.8], [58.6, 81.6]]);
  g.poly([[67.4, 76], [64.8, 82.4], [63.6, 84.4], [64, 86.2], [62.4, 84.6], [61.7, 82.2]]);
  g.path().M(72.6, 64).L(72.6, 69.5).Q(73, 73.5, 77, 73.5).L(80.5, 73.5).L(80.5, 64).end();
  g.poly([[75.4, 73.5], [75.8, 84.5], [78.6, 84.5], [79, 73.5]]);
  g.circle(77.2, 86.6, 1.8);
  g.path().M(76, 83.2).Q(72.5, 85, 72, 89.4).end(); g.path().M(78.4, 83.2).Q(82, 85, 82.4, 89.4).end();
  g.line(74.2, 76, 74.2, 95.4); g.circle(74.2, 97.6, 2.1);
  g.poly([[71.6, 101.6], [74.2, 100.2], [76.8, 101.6]]);
}

function skytree(g) {
  const cx = 26;
  const hw = (h) => 5.5 + 11.5 * Math.pow(1 - h / 118, 1.6);
  g.smooth(sample((h) => -hw(h), 0, 117, 8).map(([dx, h]) => [cx + dx, h]));
  g.smooth(sample((h) => hw(h), 0, 117, 8).map(([dx, h]) => [cx + dx, h]));
  lattice(g, (h) => cx - hw(h), (h) => cx + hw(h), [0, 15, 29, 42, 54, 65, 75, 84, 93, 101, 109, 117]);
  // the two decks and the mast
  g.poly(sym(cx, [[5.5, 117], [10, 120], [10, 128.5], [7, 131.5], [4.4, 131.5], [0, 131.5]]), true);
  g.line(cx - 10, 124.2, cx + 10, 124.2);
  g.line(cx - 4.4, 131.5, cx - 4.4, 150); g.line(cx + 4.4, 131.5, cx + 4.4, 150);
  g.poly(sym(cx, [[4.4, 150], [7, 152], [7, 156], [4, 158], [0, 158]]), true);
  g.poly([[cx - 3.4, 158], [cx - 2, 174], [cx - 0.6, 205]]); g.poly([[cx + 3.4, 158], [cx + 2, 174], [cx + 0.6, 205]]);
  g.line(cx - 2.8, 164, cx + 2.8, 164); g.line(cx - 1.6, 182, cx + 1.6, 182);
}

// v0.6.0: Shanghai's Oriental Pearl Tower (about 468 m), our own drawing from its public shape: three slanted legs
// splayed at its foot, three columns rising through the big lower sphere (50 m across, its centre about 93 m up), the
// five small spheres between the columns, the upper sphere (45 m, about 272 m up) with its deck, the shaft to the small
// top sphere (about 350 m) and the antenna. At about 0.34 px a metre, as the strip's towers are drawn.
function orientalPearl(g) {
  const cx = 25, s = 0.34;
  const m = (h) => h * s;
  // the three legs: the outer two splayed in profile (each a pair of lines), the third one coming at us, short
  for (const k of [-1, 1]) {
    const X = (dx) => cx + k * dx;
    g.poly([[X(22), 0], [X(9.5), m(78)]]); g.poly([[X(17.5), 0], [X(6.5), m(74)]]);
    g.line(X(21), 0.01, X(16.5), 0.01);
  }
  g.poly([[cx - 2.4, 0], [cx - 1.6, m(60)]]); g.poly([[cx + 2.4, 0], [cx + 1.6, m(60)]]);
  // the base: a low podium under the columns
  g.rect(cx - 11, 0, 22, 4.5);
  // the columns from the podium to the lower sphere
  g.line(cx - 5.2, 4.5, cx - 5.2, m(70)); g.line(cx + 5.2, 4.5, cx + 5.2, m(70));
  // the lower sphere, with its band of windows
  const r1 = 9.2, c1 = m(93);
  g.circle(cx, c1, r1);
  g.path().M(cx - r1, c1).Q(cx, c1 - 2.6, cx + r1, c1).end();
  g.path().M(cx - r1 * 0.94, c1 + 3).Q(cx, c1 + 0.6, cx + r1 * 0.94, c1 + 3).end();
  // the columns on to the upper sphere, the five small spheres between them
  const top1 = c1 + r1, r2 = 8.2, c2 = m(272), bot2 = c2 - r2;
  g.line(cx - 4.2, top1 - 0.6, cx - 3.4, bot2 + 0.4); g.line(cx + 4.2, top1 - 0.6, cx + 3.4, bot2 + 0.4);
  for (let i = 0; i < 5; i++) g.circle(cx, lerp(top1 + 4.5, bot2 - 4.5, i / 4), 2);
  // the upper sphere, its deck's ring
  g.circle(cx, c2, r2);
  g.rect(cx - r2 - 1.6, c2 - 1.4, 2 * r2 + 3.2, 2.8);
  // the shaft to the top sphere, the antenna
  const r3 = 3.2, c3 = m(352);
  g.line(cx - 2.2, c2 + r2 - 0.3, cx - 1.5, c3 - r3 + 0.2); g.line(cx + 2.2, c2 + r2 - 0.3, cx + 1.5, c3 - r3 + 0.2);
  g.circle(cx, c3, r3);
  g.poly([[cx - 1.3, c3 + r3 - 0.2], [cx - 0.5, m(468) - 6]]); g.poly([[cx + 1.3, c3 + r3 - 0.2], [cx + 0.5, m(468) - 6]]);
  g.line(cx - 1.2, c3 + r3 + 9, cx + 1.2, c3 + r3 + 9); g.line(cx - 0.9, c3 + r3 + 19, cx + 0.9, c3 + r3 + 19);
  g.line(cx, m(468) - 6, cx, m(468));
}

// Generic buildings between the landmarks: a stepped block outline with a few window strokes.
function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function fillers(g, w, rnd) {
  const blocks = [];
  let x = 4;
  const end = w - 4;
  let lastH = 0;
  while (end - x >= 12) {
    let bw = 14 + Math.round(rnd() * 16);
    if (end - x - bw < 14) bw = end - x;
    let bh = 30 + Math.round(rnd() * 44);
    if (Math.abs(bh - lastH) < 7) bh = bh > 52 ? bh - 12 : bh + 12;
    blocks.push({ x0: x, x1: x + bw, h: bh, roof: Math.floor(rnd() * 6) });
    lastH = bh; x += bw;
  }
  if (!blocks.length) return;
  // the stepped outline
  const pts = [[blocks[0].x0, 0]];
  for (const b of blocks) { pts.push([b.x0, b.h], [b.x1, b.h]); }
  pts.push([blocks[blocks.length - 1].x1, 0]);
  g.poly(pts);
  for (let i = 0; i < blocks.length - 1; i++) {
    const b = blocks[i], c = blocks[i + 1];
    g.line(b.x1, 0, b.x1, Math.min(b.h, c.h));
  }
  for (const b of blocks) {
    const bw = b.x1 - b.x0, m = (b.x0 + b.x1) / 2;
    // rooftop
    if (b.roof === 1 && bw > 16) g.poly([[m - 4, b.h], [m - 4, b.h + 4], [m + 3, b.h + 4], [m + 3, b.h]]);
    else if (b.roof === 2) g.line(m + 2, b.h, m + 2, b.h + 9);
    else if (b.roof === 3 && bw > 18) g.poly([[b.x0 + 4, b.h], [b.x0 + 4, b.h + 6], [b.x1 - 4, b.h + 6], [b.x1 - 4, b.h]]);
    else if (b.roof === 4 && b.h < 50) g.poly([[b.x0 + 1, b.h], [m, b.h + Math.min(10, bw * 0.4)], [b.x1 - 1, b.h]]);
    // windows: short strokes on a grid, a few of them lit
    const cols = Math.max(1, Math.floor((bw - 6) / 5));
    const gap = (bw - 6) / cols;
    for (let hr = b.h - 7; hr > 6; hr -= 7) {
      for (let c = 0; c < cols; c++) {
        if (rnd() > 0.3) continue;
        const wx = b.x0 + 3 + gap * (c + 0.5);
        g.line(wx, hr - 3, wx, hr);
      }
    }
  }
}

// [name, slot width, draw]; tall ones kept apart, continents mixed. The strip wraps from the last to the first.
const LANDMARKS = [
  ['Sungnyemun', 124, sungnyemun],
  ['Eiffel Tower', 84, eiffel],
  ['Sydney Opera House', 172, operaHouse],
  ['Empire State Building', 70, empireState],
  ['Taj Mahal', 160, tajMahal],
  ['Big Ben', 40, bigBen],
  ['Pyramids of Giza', 238, pyramids],
  ['N Seoul Tower', 150, nSeoulTower],
  ['Colosseum', 190, colosseum],
  ['Burj Khalifa', 64, burjKhalifa],
  ['Statue of Liberty', 70, liberty],
  ['St Basil\'s Cathedral', 150, stBasils],
  ['Lotte World Tower', 60, lotteTower],
  ['Tower Bridge', 230, towerBridge],
  ['Oriental Pearl Tower', 50, orientalPearl],   // v0.6.0
  ['Christ the Redeemer', 162, christRedeemer],
  ['Petronas Towers', 110, petronas],
  ['Leaning Tower of Pisa', 52, pisa],
  ['Space Needle', 74, spaceNeedle],
  ['Marina Bay Sands', 164, marinaBaySands],
  ['Gateway Arch', 140, gatewayArch],
  ['Brandenburg Gate', 130, brandenburg],
  ['Tokyo Skytree', 52, skytree],
];

// v0.6.0: landmarks added after v0.5.7's strip draw their gap and its buildings from a random stream of their own, so
// every other building stays as it was drawn (only moved along by the new ones' width). The Pearl Tower's gap is a
// narrow 15 px (no buildings fit), keeping the strip within its 4,000 px.
const ADDED = new Map([['Oriental Pearl Tower', 15]]);
function buildSkyline() {
  const rnd = rng(57), own = rng(60);
  const paths = [], landmarks = [];
  // the gap after each landmark, filled with generic buildings; the last one is split across the seam, half at the
  // strip's end and half at its start, each half filled on its own side
  const gaps = LANDMARKS.filter(([name]) => !ADDED.has(name)).map(() => 40 + Math.round(rnd() * 32));
  const head = Math.round(gaps[gaps.length - 1] / 2), tail = gaps[gaps.length - 1] - head;
  let x = 0, j = 0;
  const fill = (w, r = rnd) => { const f = pen((lx, h) => [x + lx, B - h]); fillers(f, w, r); paths.push(...f.out); x += w; };
  fill(head);
  LANDMARKS.forEach(([name, w, draw], i) => {
    const g = pen((lx, h) => [x + lx, B - h]);
    draw(g);
    paths.push(...g.out);
    landmarks.push({ name, x0: x, x1: x + w });
    x += w;
    if (ADDED.has(name)) { fill(ADDED.get(name) ?? 40 + Math.round(own() * 32), own); return; }
    const gap = gaps[j++];
    fill(i === LANDMARKS.length - 1 ? tail : gap);
  });
  const width = Math.round(x);
  paths.unshift(`M0 ${B}H${width}`);
  return { width, height: H, baseline: B, paths, landmarks };
}

export const SKYLINE = buildSkyline();

// ---- the icons ----------------------------------------------------------------------------------------------------
function icon(w, h, draw) { const g = pen((x, y) => [x, y]); draw(g); return { w, h, paths: g.out }; }

// An airliner from above, nose to +x, as one outline (y down; the upper half mirrored about the axis), scaled by s
// about (ox, oy). Returns the mapping, for parts drawn on it.
function planeOutline(g, ox, oy, s) {
  const T = (x, y) => [ox + x * s, oy + y * s];
  const half = [[30, 0], [29, -1.5], [27, -2.7], [24, -3.3], [12, -3.3], [-3.5, -26], [-8, -26], [-3, -3.3], [-19, -3], [-25.5, -11.5],
    [-28.5, -11.5], [-26, -2.2], [-29.5, -0.8], [-30, 0]];
  const pts = half.concat(half.slice(1, -1).reverse().map(([x, y]) => [x, -y]));
  g.poly(pts.map(([x, y]) => T(x, y)), true);
  return T;
}

export const ICONS = {
  planeTop: icon(64, 64, (g) => {
    const T = planeOutline(g, 32, 32, 1);
    // the engines, ahead of the wings' leading edges; the windscreen; the fin along the tail
    for (const s of [-1, 1]) {
      g.path().M(...T(6.1, s * 12)).L(...T(12, s * 12)).Q(...T(14.2, s * 12), ...T(14.2, s * 10)).Q(...T(14.2, s * 8), ...T(12, s * 8))
        .L(...T(8.8, s * 8)).end();
    }
    g.path().M(...T(25.2, -1.7)).Q(...T(27, 0), ...T(25.2, 1.7)).end();
    g.line(...T(-21, 0), ...T(-28.6, 0));
  }),
  planeSide: icon(96, 36, (g) => {
    // fuselage, fin, tailplane, the near wing and its engine, the cockpit window and the cabin windows
    g.path().M(4, 22.5).C(4, 18.5, 9, 15.3, 17, 15).L(70, 15).L(92.5, 14.4).L(93, 16.4).Q(80, 25.4, 62, 26.6).L(18, 26.6)
      .C(9, 26.6, 4, 25.6, 4, 22.5).Z().end();
    g.poly([[68, 15], [83, 3], [89.5, 3], [91.8, 14.6]]);
    g.poly([[80, 18.4], [90.5, 21], [93, 21], [90.2, 18.2]]);
    g.poly([[36, 24.5], [56.5, 32.6], [60, 32.6], [52, 25.8]]);
    g.path().M(31, 27.8).L(40.5, 27.8).Q(42.5, 27.8, 42.5, 30).Q(42.5, 32.2, 40.5, 32.2).L(31, 32.2).Q(29.6, 30, 31, 27.8).Z().end();
    g.line(38.5, 27.8, 38.5, 25.7);
    g.line(8.5, 18.6, 13, 17.4);
    for (let x = 20; x <= 64; x += 3.6) g.line(x, 19, x + 0.8, 19);
  }),
  boardingPass: icon(96, 52, (g) => {
    const p = g.path().M(6, 2).L(66, 2).arc(70, 2, 4, 4, 180, 0).L(90, 2).arc(90, 6, 4, 4, -90, 0).L(94, 46).arc(90, 46, 4, 4, 0, 90)
      .L(74, 50).arc(70, 50, 4, 4, 0, -180).L(6, 50).arc(6, 46, 4, 4, 90, 180).L(2, 6).arc(6, 6, 4, 4, 180, 270);
    p.Z().end();
    const d = g.path();
    for (let y = 9.5; y < 42.6; y += 5.5) d.M(70, y).L(70, y + 2.6);
    d.end();
    planeOutline(g, 15, 12.5, 0.21);
    g.line(25, 12.5, 46, 12.5);
    g.line(9, 23, 24, 23); g.line(42, 23, 57, 23);
    g.path().M(28, 23).L(38, 23).M(35.5, 20.8).L(38, 23).L(35.5, 25.2).end();
    g.line(9, 33, 44, 33);
    g.line(9, 42, 19, 42); g.line(25, 42, 35, 42); g.line(41, 42, 51, 42);
    g.line(77, 11, 89, 11); g.line(77, 18, 86, 18); g.line(77, 25, 90, 25);
    for (const x of [77.5, 80, 83.5, 86, 89.5]) g.line(x, 33, x, 43);
  }),
  suitcase: icon(48, 72, (g) => {
    g.path().M(19, 16).L(19, 6).Q(19, 2.5, 22.5, 2.5).L(25.5, 2.5).Q(29, 2.5, 29, 6).L(29, 16).end();
    g.line(22.5, 6.4, 25.5, 6.4);
    g.path().M(13, 16).L(35, 16).Q(40, 16, 40, 21).L(40, 57).Q(40, 62, 35, 62).L(13, 62).Q(8, 62, 8, 57).L(8, 21).Q(8, 16, 13, 16).Z().end();
    for (const x of [16, 24, 32]) g.line(x, 22, x, 56);
    g.circle(14, 66, 3.4); g.circle(34, 66, 3.4);
  }),
};
