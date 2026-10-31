// Pure geometry for the airport ground: taxiway strokes, hold-short sites, taxiway edge
// lines, stand markings and jet bridge placement. No three.js, no DOM (node-testable).
// Everything is in map metres (x east, y north); headings are grid degrees, clockwise
// from +y, so a heading h points along (sin h, cos h).

import { pavementEnd } from './runways.js';

export const TAXI_W = 23;          // default taxiway width (m)
export const HOLD_DIST = 90;       // m from the runway centreline for synthetic hold-shorts
export const NOSE_WHEEL = 15.7;    // m forward of the stand point (A321 nose gear, geometry.js)
export const DOOR_FWD = 17;        // L1 door: m forward of the stand point
export const DOOR_SILL = 3.3;      // m above the ground
export const FUSE_HALF = 2.4;      // fuselage half width plus clearance: the bridge cab's face

const DEG = Math.PI / 180;
export const hdgVec = (deg) => [Math.sin(deg * DEG), Math.cos(deg * DEG)];

// Drop a ring's closing point if it repeats the first.
export function openRing(pts) {
  const n = pts.length;
  if (n > 1 && pts[0][0] === pts[n - 1][0] && pts[0][1] === pts[n - 1][1]) return pts.slice(0, -1);
  return pts;
}

export function signedArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Distance from p to segment ab, and the parameter t of the nearest point.
export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + dx * t, qy = ay + dy * t;
  return { d: Math.hypot(px - qx, py - qy), t, x: qx, y: qy };
}

// Insert points so no segment is longer than maxSeg.
export function densify(pts, maxSeg) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / maxSeg));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

// Duplicate polygons happen in the data (Gimpo and Incheon list some aprons twice).
export function dedupePolys(polys) {
  const seen = new Set();
  return polys.filter((p) => {
    const r = openRing(p.points || p);
    if (r.length < 3) return false;
    const key = r.length + ':' + r.map((q) => q[0].toFixed(0) + ',' + q[1].toFixed(0)).sort().slice(0, 4).join(';');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ------------------------------------------------------------------ runways

// Runway centrelines between the pavement ends.
export function runwayLines(airport) {
  return (airport.runways || []).map((r) => {
    const p0 = pavementEnd(r.ends[0]), p1 = pavementEnd(r.ends[1]);
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    return { ax: p0.x, ay: p0.y, bx: p1.x, by: p1.y, ux: (p1.x - p0.x) / len, uy: (p1.y - p0.y) / len, len, hw: (r.widthM || 45) / 2 };
  });
}

// Nearest runway centreline (segment distance).
export function nearestRunway(lines, x, y) {
  let best = { d: Infinity, line: null };
  for (const l of lines) {
    const s = segDist(x, y, l.ax, l.ay, l.bx, l.by);
    if (s.d < best.d) best = { d: s.d, line: l };
  }
  return best;
}

// ------------------------------------------------------------------ strokes

// A polyline stroked to half width hw, with round joins and caps, as a triangle soup
// [x0, y0, x1, y1, x2, y2, ...] appended to out.
export function strokeTriangles(pts, hw, out = [], capSteps = 8) {
  const n = pts.length;
  if (n < 2) return out;
  const tri = (a, b, c) => out.push(a[0], a[1], b[0], b[1], c[0], c[1]);
  const norms = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(dx, dy) || 1;
    norms.push([-dy / l, dx / l]);   // left normal
  }
  for (let i = 0; i < n - 1; i++) {
    const [nx, ny] = norms[i], a = pts[i], b = pts[i + 1];
    const al = [a[0] + nx * hw, a[1] + ny * hw], ar = [a[0] - nx * hw, a[1] - ny * hw];
    const bl = [b[0] + nx * hw, b[1] + ny * hw], br = [b[0] - nx * hw, b[1] - ny * hw];
    tri(al, ar, br); tri(al, br, bl);
  }
  // Fan from angle a0 to a1 (radians, the shorter way) around p.
  const fan = (p, a0, a1, minSteps) => {
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const steps = Math.max(minSteps, Math.ceil(Math.abs(da) / (22 * DEG)));
    for (let k = 0; k < steps; k++) {
      const t0 = a0 + (da * k) / steps, t1 = a0 + (da * (k + 1)) / steps;
      tri(p, [p[0] + Math.cos(t0) * hw, p[1] + Math.sin(t0) * hw], [p[0] + Math.cos(t1) * hw, p[1] + Math.sin(t1) * hw]);
    }
  };
  // Round joins: a wedge on the outer side of each bend.
  for (let i = 1; i < n - 1; i++) {
    const [ax, ay] = norms[i - 1], [bx, by] = norms[i];
    const cross = ax * by - ay * bx;
    if (Math.abs(cross) < 0.03 && ax * bx + ay * by > 0) continue;    // under ~2°
    // Turning left (cross > 0): the outer side is the right (-normal).
    const s = cross > 0 ? -1 : 1;
    fan(pts[i], Math.atan2(s * ay, s * ax), Math.atan2(s * by, s * bx), 1);
  }
  // Round caps.
  const [n0x, n0y] = norms[0], [n1x, n1y] = norms[n - 2];
  const a0 = Math.atan2(n0y, n0x);
  fan(pts[0], a0, a0 + Math.PI * 0.5, capSteps / 2); fan(pts[0], a0 + Math.PI * 0.5, a0 + Math.PI, capSteps / 2);
  const a1 = Math.atan2(-n1y, -n1x);
  fan(pts[n - 1], a1, a1 + Math.PI * 0.5, capSteps / 2); fan(pts[n - 1], a1 + Math.PI * 0.5, a1 + Math.PI, capSteps / 2);
  return out;
}

// Split triangles (soup) by their longest edge until every edge is at most maxEdge,
// so big apron polygons follow the ground.
export function subdivideSoup(soup, maxEdge, out = []) {
  const m2 = maxEdge * maxEdge;
  const stack = [];
  for (let i = 0; i < soup.length; i += 6) stack.push(soup.slice(i, i + 6));
  let guard = 0;
  while (stack.length) {
    const t = stack.pop();
    const e = [
      (t[2] - t[0]) ** 2 + (t[3] - t[1]) ** 2,
      (t[4] - t[2]) ** 2 + (t[5] - t[3]) ** 2,
      (t[0] - t[4]) ** 2 + (t[1] - t[5]) ** 2,
    ];
    const k = e[0] >= e[1] && e[0] >= e[2] ? 0 : e[1] >= e[2] ? 1 : 2;
    if (e[k] <= m2 || ++guard > 2e6) { out.push(...t); continue; }
    const i0 = k * 2, i1 = ((k + 1) % 3) * 2, i2 = ((k + 2) % 3) * 2;
    const mx = (t[i0] + t[i1]) / 2, my = (t[i0 + 1] + t[i1 + 1]) / 2;
    stack.push([t[i0], t[i0 + 1], mx, my, t[i2], t[i2 + 1]]);
    stack.push([mx, my, t[i1], t[i1 + 1], t[i2], t[i2 + 1]]);
  }
  return out;
}

// ------------------------------------------------------------------ segment index

// A grid of taxiway segments, for "is this point on some taxiway?" queries.
export function segmentIndex(taxiways, cell = 50) {
  const grid = new Map();
  const segs = [];
  taxiways.forEach((tw, ti) => {
    const hw = (tw.widthM || TAXI_W) / 2;
    for (let i = 0; i < tw.points.length - 1; i++) {
      const [ax, ay] = tw.points[i], [bx, by] = tw.points[i + 1];
      const s = { ti, i, ax, ay, bx, by, hw };
      segs.push(s);
      const x0 = Math.floor((Math.min(ax, bx) - hw) / cell), x1 = Math.floor((Math.max(ax, bx) + hw) / cell);
      const y0 = Math.floor((Math.min(ay, by) - hw) / cell), y1 = Math.floor((Math.max(ay, by) + hw) / cell);
      for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
        const k = gx + ',' + gy;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(s);
      }
    }
  });
  return {
    segs,
    near(x, y) { return grid.get(Math.floor(x / cell) + ',' + Math.floor(y / cell)) || []; },
  };
}

// ------------------------------------------------------------------ hold-short sites

// Taxiway direction and width at the point nearest (x, y).
function taxiAt(index, x, y) {
  let best = null;
  for (const s of index.near(x, y)) {
    const q = segDist(x, y, s.ax, s.ay, s.bx, s.by);
    if (!best || q.d < best.d) best = { d: q.d, s, x: q.x, y: q.y };
  }
  if (!best) return null;
  const { s } = best;
  const l = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1;
  return { x: best.x, y: best.y, d: best.d, dx: (s.bx - s.ax) / l, dy: (s.by - s.ay) / l, w: s.hw * 2 };
}

// Hold-short markings: each holding position (on its taxiway, facing the runway), plus a
// synthetic one where a taxiway crosses HOLD_DIST from a runway centreline with no
// holding position nearby. Returns [{ x, y, dx, dy (unit, towards the runway), w,
// pattern: 'A' (runway) | 'B' (intermediate), synthetic }].
export function holdShortSites(airport, index = segmentIndex(airport.taxiways || [])) {
  const lines = runwayLines(airport);
  const out = [];
  const towardRunway = (x, y, dx, dy) => {
    const a = nearestRunway(lines, x + dx * 5, y + dy * 5).d, b = nearestRunway(lines, x - dx * 5, y - dy * 5).d;
    return a <= b ? [dx, dy] : [-dx, -dy];
  };
  for (const hp of airport.holdingPositions || []) {
    const t = taxiAt(index, hp.x, hp.y);
    if (!t || t.d > 20) continue;
    const r = nearestRunway(lines, t.x, t.y);
    const [dx, dy] = towardRunway(t.x, t.y, t.dx, t.dy);
    out.push({ x: t.x, y: t.y, dx, dy, w: t.w, pattern: r.d < 250 ? 'A' : 'B', synthetic: false });
  }
  for (const tw of airport.taxiways || []) {
    const pts = tw.points;
    let prev = null;
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      const r = nearestRunway(lines, x, y);
      const f = r.d - HOLD_DIST;
      if (prev && (prev.f > 0) !== (f > 0) && Math.abs(prev.f - f) > 1e-6) {
        const k = prev.f / (prev.f - f);
        const hx = prev.x + (x - prev.x) * k, hy = prev.y + (y - prev.y) * k;
        const l = Math.hypot(x - prev.x, y - prev.y) || 1;
        let dx = (x - prev.x) / l, dy = (y - prev.y) / l;
        // Only where the taxiway really heads for the runway (not running alongside it).
        const ln = r.line || prev.line;
        const along = ln ? Math.abs(dx * ln.ux + dy * ln.uy) : 0;
        const nearExisting = out.some((o) => Math.hypot(o.x - hx, o.y - hy) < 80);
        if (along < 0.94 && !nearExisting) {
          [dx, dy] = towardRunway(hx, hy, dx, dy);
          out.push({ x: hx, y: hy, dx, dy, w: tw.widthM || TAXI_W, pattern: 'A', synthetic: true });
        }
      }
      prev = { x, y, f, line: r.line };
    }
  }
  return out;
}

// ------------------------------------------------------------------ edge lines

// Taxiway edge lines: the stroke's edges (inset by `inset`), kept only where they're not
// inside other pavement (another taxiway, an apron, a runway). Returns polylines.
export function taxiwayEdges(airport, index, aprons, step = 4, inset = 0.6) {
  const lines = runwayLines(airport);
  const rings = aprons.map((a) => openRing(a.points || a));
  const boxes = rings.map((r) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [x0, y0, x1, y1];
  });
  const covered = (x, y, ti, si) => {
    for (const s of index.near(x, y)) {
      if (s.ti === ti && Math.abs(s.i - si) <= 1) continue;
      if (segDist(x, y, s.ax, s.ay, s.bx, s.by).d < s.hw - 0.2) return true;
    }
    for (let k = 0; k < rings.length; k++) {
      const b = boxes[k];
      if (x < b[0] || y < b[1] || x > b[2] || y > b[3]) continue;
      if (pointInRing(x, y, rings[k])) return true;
    }
    for (const l of lines) if (segDist(x, y, l.ax, l.ay, l.bx, l.by).d < l.hw + 9) return true;
    return false;
  };
  const out = [];
  (airport.taxiways || []).forEach((tw, ti) => {
    const hw = (tw.widthM || TAXI_W) / 2 - inset;
    for (const side of [1, -1]) {
      let run = [];
      const flush = () => { if (run.length >= 2) out.push(run); run = []; };
      for (let i = 0; i < tw.points.length - 1; i++) {
        const [ax, ay] = tw.points[i], [bx, by] = tw.points[i + 1];
        const l = Math.hypot(bx - ax, by - ay);
        if (l < 1e-3) continue;
        const nx = (-(by - ay) / l) * side, ny = ((bx - ax) / l) * side;
        const n = Math.max(1, Math.ceil(l / step));
        // A fresh piece per segment keeps corners from cutting across.
        flush();
        for (let k = 0; k <= n; k++) {
          const x = ax + ((bx - ax) * k) / n + nx * hw, y = ay + ((by - ay) * k) / n + ny * hw;
          if (covered(x, y, ti, i)) flush();
          else run.push([x, y]);
        }
      }
      flush();
    }
  });
  // Join pieces that continue each other (end of one = start of the next, within 1 m).
  const joined = [];
  for (const p of out) {
    const last = joined[joined.length - 1];
    if (last) {
      const e = last[last.length - 1];
      if (Math.hypot(e[0] - p[0][0], e[1] - p[0][1]) < 1.5) { last.push(...p.slice(1)); continue; }
    }
    joined.push(p.slice());
  }
  return joined.filter((p) => polyLength(p) > 6);
}

export function polyLength(p) {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return s;
}

// ------------------------------------------------------------------ stands

// Stand markings: the lead-in line (OSM's, else straight in along the heading), the stop
// bar at the nose wheel, and where the number goes. Returns
// { lead: [[x, y], ...], stop: { x, y, dx, dy }, label: { x, y, dx, dy } } where (dx, dy)
// is the stand heading.
export function standMarks(stand) {
  const [dx, dy] = hdgVec(stand.hdgGridDeg);
  const stop = { x: stand.x + dx * NOSE_WHEEL, y: stand.y + dy * NOSE_WHEEL, dx, dy };
  let lead;
  if (stand.leadIn && stand.leadIn.length >= 2) {
    lead = stand.leadIn.map((p) => [p[0], p[1]]);
    const e = lead[lead.length - 1];
    // OSM's line ends at the stand point; carry it on to the stop bar.
    if ((stop.x - e[0]) * dx + (stop.y - e[1]) * dy > 0.5) lead.push([stop.x, stop.y]);
  } else {
    lead = [[stand.x - dx * 60, stand.y - dy * 60], [stop.x, stop.y]];
  }
  const label = { x: stand.x - dx * 14, y: stand.y - dy * 14, dx, dy };
  return { lead, stop, label };
}

// Where a gate's jet bridge goes: from the nearest terminal wall to the cab at the L1 door.
// terminals: [ring, ...]. Returns null if no terminal wall is within maxLen.
export function jetBridge(stand, terminals, maxLen = 80) {
  const [dx, dy] = hdgVec(stand.hdgGridDeg);
  const lx = -dy, ly = dx;                                        // the aircraft's left
  const door = { x: stand.x + dx * DOOR_FWD + lx * FUSE_HALF, y: stand.y + dy * DOOR_FWD + ly * FUSE_HALF };
  let best = null;
  for (const ring of terminals) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const q = segDist(door.x, door.y, a[0], a[1], b[0], b[1]);
      // Not behind the door, and on the left half (the bridge mustn't cross the nose).
      const rx = q.x - door.x, ry = q.y - door.y;
      if (rx * dx + ry * dy < -4 || rx * lx + ry * ly < -6) continue;
      if (!best || q.d < best.d) best = { d: q.d, x: q.x, y: q.y };
    }
  }
  if (!best || best.d > maxLen || best.d < 4) return null;
  // The cab sits square to the fuselage, its face on the door; the tunnel meets its back.
  const cab = { x: door.x + lx * 1.6, y: door.y + ly * 1.6 };
  return { root: { x: best.x, y: best.y }, cab, door, fwd: [dx, dy], left: [lx, ly], length: Math.hypot(cab.x - best.x, cab.y - best.y) };
}
