// v0.7.4 (Shane's item 3: "Some parts of the East Asia border consist of sharp bends and square like divisions. Even if
// the map comes in grids, could we make the border diagonal in parts where that would make it more smooth?"): the
// 250 m data's outline as the map draws it. Drawing only: what loads, and where a predicted path ends (the region's
// outline, world/outline.js), don't change.
//
// smoothOutline(edges) -> [[[x, y], ...], ...]: closed rings from region.js fineOutline()'s edges (every side of a
// covered tile whose neighbour isn't covered, [x0, y0, x1, y1] in map metres, all one tile long), with each staircase
// cut: where the outline turns through two or more one-tile steps in a row (its sides alternating between two
// directions, one of the two lengths one tile and the other one or two: the slopes 1:1 and 2:1), the inner corners
// are replaced by one straight line through the steps' sides' midpoints. Each corner cut is a triangle of the same
// area, and the line cuts as many corners turning one way as the other (an odd number of sides in the run: an even
// one drops its last side), so it cuts off as much data as it adds. A single corner between longer sides stays square.
// Pure; no DOM. tests/v074-map-outline.test.mjs.

const key = (x, y) => `${x},${y}`;

// The rings of the edges as corner lists in tile units (integers), collinear points merged.
export function outlineRings(edges) {
  if (!edges || !edges.length) return { rings: [], size: 0, x0: 0, y0: 0 };
  const size = Math.hypot(edges[0][2] - edges[0][0], edges[0][3] - edges[0][1]);
  const x0 = edges[0][0], y0 = edges[0][1];
  const q = (v, o) => Math.round((v - o) / size);
  const adj = new Map(), segs = [];
  for (const [ax, ay, bx, by] of edges) {
    const a = [q(ax, x0), q(ay, y0)], b = [q(bx, x0), q(by, y0)];
    const s = { a, b, used: false };
    segs.push(s);
    for (const p of [a, b]) { const k = key(p[0], p[1]); (adj.get(k) || adj.set(k, []).get(k)).push(s); }
  }
  const rings = [];
  for (const s0 of segs) {
    if (s0.used) continue;
    s0.used = true;
    const pts = [s0.a];
    let cur = s0.b, dir = [s0.b[0] - s0.a[0], s0.b[1] - s0.a[1]];
    for (let guard = 0; guard < segs.length + 2; guard++) {
      if (cur[0] === s0.a[0] && cur[1] === s0.a[1]) break;
      pts.push(cur);
      const opts = (adj.get(key(cur[0], cur[1])) || []).filter((s) => !s.used);
      if (!opts.length) break;
      // At a pinch (two tiles touching at a corner: four sides meet) take a turn, never straight on, so each
      // ring goes round one piece.
      const out = (s) => (s.a[0] === cur[0] && s.a[1] === cur[1] ? s.b : s.a);
      const turn = opts.find((s) => { const o = out(s); return (o[0] - cur[0]) * dir[0] + (o[1] - cur[1]) * dir[1] === 0; });
      const nx = (opts.length > 1 && turn) || opts[0];
      nx.used = true;
      const o = out(nx);
      dir = [o[0] - cur[0], o[1] - cur[1]];
      cur = o;
    }
    rings.push(mergeCollinear(pts));
  }
  return { rings, size, x0, y0 };
}

function mergeCollinear(pts) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n], c = pts[i], nx = pts[(i + 1) % n];
    const cross = (c[0] - p[0]) * (nx[1] - c[1]) - (c[1] - p[1]) * (nx[0] - c[0]);
    if (cross !== 0) out.push(c);
  }
  return out.length >= 3 ? out : pts;
}

// One ring of corners (tile units, a rectilinear polygon) with its staircases cut. Returns points (may be halves).
export function cutStaircases(ring) {
  const n = ring.length;
  if (n < 6) return ring.map((p) => [p[0], p[1]]);
  // Side i runs from corner i to corner i+1.
  const side = (i) => { const a = ring[i % n], b = ring[(i + 1) % n]; return { dx: Math.sign(b[0] - a[0]), dy: Math.sign(b[1] - a[1]), len: Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) }; };
  const S = Array.from({ length: n }, (_, i) => side(i));
  const sameDir = (i, j) => S[i % n].dx === S[j % n].dx && S[i % n].dy === S[j % n].dy;
  // Can sides i .. i+m-1 form a staircase (directions alternating between two, each parity one length, one of them 1
  // and the other 1 or 2)?
  const fits = (i, m) => {
    if (m < 2) return true;
    const la = S[i % n].len, lb = S[(i + 1) % n].len;
    if (Math.min(la, lb) !== 1 || Math.max(la, lb) > 2) return false;
    for (let t = 0; t < m; t++) {
      const s = S[(i + t) % n];
      if (s.len !== (t % 2 ? lb : la)) return false;
      if (t >= 2 && !sameDir(i + t, i + t - 2)) return false;
    }
    return true;
  };
  // Start where a run can't extend backwards, so a run is never split at the ring's seam.
  let start = 0;
  for (let i = 0; i < n; i++) { if (!fits((i + n - 1) % n, 2)) { start = i; break; } }
  const runs = [];   // [first side, number of sides] (indices from `start`)
  const inRun = new Set();
  let i = 0;
  while (i < n) {
    let m = 1;
    while (i + m < n && fits(start + i, m + 1)) m++;
    if (m >= 3) {
      const use = m % 2 ? m : m - 1;
      runs.push([start + i, use]);
      for (let t = 0; t < m; t++) inRun.add((start + i + t) % n);
      i += m;
    } else i += 1;
  }
  // v0.7.4, second pass: a single one-tile jog between two longer sides running the same way (the outline steps over
  // by one tile and carries on) is cut too: a 1:1 line from half a tile before the jog to half a tile after it. Its
  // two corners turn opposite ways, so it cuts off as much as it adds. (A single corner between longer sides, the
  // outline turning for good, stays square.)
  const jogs = [];
  for (let s = 0; s < n; s++) {
    const p = (s + n - 1) % n, q = (s + 1) % n;
    if (S[s].len !== 1 || S[p].len < 2 || S[q].len < 2 || inRun.has(s) || inRun.has(p) || inRun.has(q)) continue;
    if (S[p].dx !== S[q].dx || S[p].dy !== S[q].dy) continue;
    if (jogs.length && (jogs[jogs.length - 1] === p || jogs[jogs.length - 1] === (s + n - 2) % n)) continue;   // needs half its sides free
    jogs.push(s);
  }
  if (jogs.length && jogs[0] === (jogs[jogs.length - 1] + 1) % n) jogs.pop();
  if (!runs.length && !jogs.length) return ring.map((p) => [p[0], p[1]]);
  const drop = new Set(), insertAfter = new Map();
  for (const s of jogs) {
    const p = (s + n - 1) % n, q = (s + 1) % n, a = ring[s], b = ring[q];
    drop.add(s); drop.add(q);
    insertAfter.set(s, [[a[0] - S[p].dx / 2, a[1] - S[p].dy / 2], [b[0] + S[q].dx / 2, b[1] + S[q].dy / 2]]);
  }
  const mid = (s) => { const a = ring[s % n], b = ring[(s + 1) % n]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
  for (const [s, m] of runs) {
    for (let t = 1; t < m; t++) drop.add((s + t) % n);          // the inner corners
    insertAfter.set(s % n, [mid(s), mid(s + m - 1)]);           // after the run's first corner: the line
  }
  const out = [];
  for (let c = 0; c < n; c++) {
    if (!drop.has(c)) out.push([ring[c][0], ring[c][1]]);
    if (insertAfter.has(c)) out.push(...insertAfter.get(c));
  }
  return out;
}

// The rings in map metres, with their staircases cut.
export function smoothOutline(edges) {
  const { rings, size, x0, y0 } = outlineRings(edges);
  return rings.map((r) => cutStaircases(r).map(([i, j]) => [x0 + i * size, y0 + j * size]));
}

// Signed area of a ring (for the tests).
export function ringArea(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

// v0.7.4: a dashed line's cost grows with its whole length, off the screen too (Chrome dashes the whole path): zoomed in
// to an airport the region's edge and the 250 m data's outline ran to millions of pixels and cost tens of ms a draw.
// traceClipped() adds a polyline (screen px, flat [x0, y0, x1, y1, ...]) to the path cut to the box (screen px, with a
// margin): only the parts inside, each part one subpath.
export function traceClipped(ctx, flat, closed, b) {
  const n = flat.length / 2, last = closed ? n : n - 1;
  let open = false;
  for (let s = 0; s < last; s++) {
    const ax = flat[2 * s], ay = flat[2 * s + 1], e = (s + 1) % n, bx = flat[2 * e], by = flat[2 * e + 1];
    let t0 = 0, t1 = 1, ok = true;
    const dx = bx - ax, dy = by - ay;
    for (const [p, q] of [[-dx, ax - b.x0], [dx, b.x1 - ax], [-dy, ay - b.y0], [dy, b.y1 - ay]]) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (!ok) { open = false; continue; }
    if (!open || t0 > 0) ctx.moveTo(ax + dx * t0, ay + dy * t0);
    ctx.lineTo(ax + dx * t1, ay + dy * t1);
    open = t1 === 1;
  }
}
