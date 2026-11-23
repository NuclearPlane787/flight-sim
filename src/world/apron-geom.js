// Pure geometry for the airport ground: taxiway strokes, hold-short sites, taxiway edge
// lines, stand markings and jet bridge placement. No three.js, no DOM (node-testable).
// Everything is in map metres (x east, y north); headings are grid degrees, clockwise
// from +y, so a heading h points along (sin h, cos h).

import { pavementEnd, RUNWAY_SHOULDER_M } from './runways.js';

export const TAXI_W = 23;          // default taxiway width (m)
export const HOLD_DIST = 90;       // m from the runway centreline for synthetic hold-shorts
export const NOSE_WHEEL = 15.7;    // m forward of the stand point (A321 nose gear, geometry.js)
export const DOOR_FWD = 17;        // L1 door: m forward of the stand point
export const DOOR_SILL = 3.3;      // m above the ground
export const FUSE_HALF = 2.4;      // fuselage half width plus clearance: the bridge cab's face
// v0.7.6 (part 7): the stand's paint and the jet bridge were laid out in v0.1.0 for an aircraft whose reference point
// is on the stand point (its nose 21 m ahead of it), while the game parks every aircraft, the player's and the parked
// traffic, with its NOSE on the point (gate-flow.js, traffic-layout.js). So the bridge's cab and the stop bar lie about
// 21 m ahead of the aircraft they are for: a gap in front of every nose, plain where the terminal is straight ahead.
// gateFit(icao) says where the paint and the bridge are laid out for the nose on the point instead: at the four
// airports v0.7.5's pictures showed it at (their stands are their AIPs' INS points, the nose-gear stops), by this
// table; everywhere with ?gatefit=1 (node: FS_GATEFIT=1), nowhere with ?gatefit=0, for the look pass to decide.
export const NOSE_AT = 21;         // m: the nose tip ahead of the aircraft's reference point (geometry.js's NOSE_X)
export const GATE_FIT_SIDE = 9;    // m to the left of the door: where a fitted bridge looks for its wall from
export const GATE_FIT_HALF = 3.0;  // m from the centreline to a fitted cab's face: the widest type's nose at the door, and clearance
export const GATE_FIT = new Set(['RJGG', 'RJOO', 'RJOA', 'RKTU']);
const GATE_FIT_ALL = (() => {
  const q = typeof location !== 'undefined' && location && /[?&]gatefit=([01])(&|$)/.exec(location.search || '');
  const e = typeof process !== 'undefined' && process.env && process.env.FS_GATEFIT;
  return q ? q[1] : (e === '1' || e === '0') ? e : null;
})();
// v0.7.8 (part 1, Shane's "everything"): the fit at every airport by default, the lead-in line ending at the stop bar,
// and each gate's cab at the front door of the aircraft that stands there (jetBridge()'s `door`). ?gates78=0 (node
// FS_GATES78=0) gives the pushed v0.7.7's gates back: the fit at GATE_FIT's four airports only, the lead-in line
// 5.3 m past the bar, every cab 4 m behind the stand point. ?gatefit=1 or 0 still overrides where the fit is used.
export const GATES78 = (() => {
  const q = typeof location !== 'undefined' && location && /[?&]gates78=0(&|$)/.test(location.search || '');
  const e = typeof process !== 'undefined' && process.env && process.env.FS_GATES78 === '0';
  return !(q || e);
})();
export const gateFit = (icao) => GATE_FIT_ALL === '1' ? true : GATE_FIT_ALL === '0' ? false : GATES78 || GATE_FIT.has(icao);
// A gate's door, for jetBridge(): `back` m from the nose's tip to the middle of the front left door, `half` m from the
// centreline to the cab's face there (the fuselage's half width at the door and about 0.4 m), `sill` m above the
// ground. The types' own are GATE_DOOR in their geometry modules; the parked traffic's below, by AIRLINER_TYPES' index
// (traffic-models.js: the narrowbody is the A321's shape, the widebody about a 787's) [EST].
export const GATE_DOOR_DEFAULT = { back: NOSE_AT - DOOR_FWD, half: GATE_FIT_HALF, sill: DOOR_SILL };
export const PARKED_DOORS = [{ back: 4.0, half: 2.4, sill: 3.3 }, { back: 6.3, half: 3.2, sill: 4.7 }];
// A parked aircraft's door at its stand (traffic-layout.js's entry: its type, its nose's tip at x, y, its heading in
// radians, its lenScale):
// where the layout moved the nose back from the stand point, the door is that much further back too. null where it
// stands more than 5 degrees off the stand's heading (the default door then).
export function parkedDoor(stand, p) {
  const T = PARKED_DOORS[p.type] || PARKED_DOORS[0], k = p.lenScale || 1;
  const [dx, dy] = hdgVec(stand.hdgGridDeg);
  const pd = p.hdg != null ? p.hdg / DEG : stand.hdgGridDeg;   // the layout's heading is in radians (standHeading())
  const dh = Math.abs(((pd - stand.hdgGridDeg) % 360 + 540) % 360 - 180);
  if (dh > 5) return null;
  const off = (stand.x - p.x) * dx + (stand.y - p.y) * dy;
  return { back: Math.round((T.back * k + off) * 100) / 100, half: T.half, sill: T.sill };
}

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
  // Round joins: a wedge on the outer side of each bend. Even a slight bend needs one: at
  // 1.5° a 23 m taxiway's quads leave a 30 cm gap at the outer edge (v0.1.0 skipped bends
  // under ~2°, and the gaps showed as hairlines across the taxiways).
  for (let i = 1; i < n - 1; i++) {
    const [ax, ay] = norms[i - 1], [bx, by] = norms[i];
    const cross = ax * by - ay * bx;
    if (Math.abs(cross) < 1e-9 && ax * bx + ay * by > 0) continue;    // straight on
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

// v0.2.1. Split triangles (soup) by their longest edge wherever the flat triangle between its
// corners' ground heights strays more than tol (m) from the ground (tested at seven points
// inside it), down to edges of minEdge. Pavement lies just 8 cm up, so a long triangle across
// curving ground dips under it and the terrain shows through: up to 0.58 m on Jeju's parallel
// taxiway, where the flattening around the runway fades into the terrain. Only those triangles
// get split, so the count barely grows.
export function refineSoup(soup, groundAt, tol = 0.02, minEdge = 3, out = []) {
  const m2 = minEdge * minEdge;
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
    const h0 = groundAt(t[0], t[1]), h1 = groundAt(t[2], t[3]), h2 = groundAt(t[4], t[5]);
    // Tested at the edges' midpoints, the centre, and halfway from the centre to each corner.
    let dev = 0;
    for (const [a, b, c] of [[2, 2, 0], [0, 2, 2], [2, 0, 2], [1, 1, 1], [4, 1, 1], [1, 4, 1], [1, 1, 4]]) {
      const s = a + b + c;
      const x = (t[0] * a + t[2] * b + t[4] * c) / s, y = (t[1] * a + t[3] * b + t[5] * c) / s;
      dev = Math.max(dev, Math.abs(groundAt(x, y) - (h0 * a + h1 * b + h2 * c) / s));
    }
    if (dev <= tol) { out.push(...t); continue; }
    const i0 = k * 2, i1 = ((k + 1) % 3) * 2, i2 = ((k + 2) % 3) * 2;
    const mx = (t[i0] + t[i1]) / 2, my = (t[i0 + 1] + t[i1 + 1]) / 2;
    stack.push([t[i0], t[i0 + 1], mx, my, t[i2], t[i2 + 1]]);
    stack.push([mx, my, t[i1], t[i1 + 1], t[i2], t[i2 + 1]]);
  }
  return out;
}

// The same for a line (the paint): a point is put in the middle of any segment whose middle
// strays more than tol from the ground, down to minSeg.
export function refineLine(pts, groundAt, tol = 0.03, minSeg = 3) {
  const out = [pts[0]];
  const walk = (a, b, ha, hb, depth) => {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, hm = groundAt(mx, my);
    if (depth < 12 && Math.hypot(b[0] - a[0], b[1] - a[1]) > minSeg && Math.abs(hm - (ha + hb) / 2) > tol) {
      walk(a, [mx, my], ha, hm, depth + 1);
      walk([mx, my], b, hm, hb, depth + 1);
    } else out.push(b);
  };
  for (let i = 1; i < pts.length; i++) walk(pts[i - 1], pts[i], groundAt(pts[i - 1][0], pts[i - 1][1]), groundAt(pts[i][0], pts[i][1]), 0);
  return out;
}

// ------------------------------------------------------------------ runways drawn over the ground

// v0.2.1. The taxiways run on to the runways (OSM's taxiway lines end on the runway's
// centreline), but a taxiway's pavement and paint sit 8–10 cm up on the ground while the
// runway is drawn on it, and the runway's extra pull towards the camera (airports.js) only
// outweighs that gap when it's seen from high enough. From the cockpit or a low orbit the
// taxiway's asphalt was drawn over the runway in jagged patches. So the pavement stops at the
// runway's drawn edge, and the paint is split there (apron.js).

// Each runway as drawn (airports.js: pavement end to pavement end, its width plus the paved
// shoulders), as a rectangle in its own frame: (ax, ay) its first pavement end, (ux, uy)
// along it, u0..u1 and the half width hw, all shrunk by `inset` (m).
export function drawnRunwayRects(airport, inset = 0) {
  return runwayLines(airport).map((l) => {
    const r = { ax: l.ax, ay: l.ay, ux: l.ux, uy: l.uy, u0: inset, u1: l.len - inset, hw: l.hw + RUNWAY_SHOULDER_M - inset };
    // Its corners' bounding box, to skip far-off triangles quickly.
    const xs = [], ys = [];
    for (const u of [r.u0, r.u1]) for (const v of [-r.hw, r.hw]) { xs.push(r.ax + r.ux * u - r.uy * v); ys.push(r.ay + r.uy * u + r.ux * v); }
    r.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    return r;
  });
}

// The point's (u, v) in a rect's frame.
const rectUV = (r, x, y) => [(x - r.ax) * r.ux + (y - r.ay) * r.uy, -(x - r.ax) * r.uy + (y - r.ay) * r.ux];

export function inRect(r, x, y) {
  const [u, v] = rectUV(r, x, y);
  return u >= r.u0 && u <= r.u1 && Math.abs(v) <= r.hw;
}

// A rect's four sides as lines f(x, y) = a x + b y + c, with f <= 0 on the inside.
function rectSides(r) {
  const k = r.ux * r.ax + r.uy * r.ay, m = r.uy * r.ax - r.ux * r.ay;
  return [
    [-r.ux, -r.uy, k + r.u0],          // u >= u0
    [r.ux, r.uy, -k - r.u1],           // u <= u1
    [-r.uy, r.ux, m - r.hw],           // v <= hw
    [r.uy, -r.ux, -m - r.hw],          // v >= -hw
  ];
}

// A convex polygon ([[x, y], ...]) cut by the line f: [the part where f >= 0, the part where f <= 0].
function cutPoly(poly, [a, b, c]) {
  const pos = [], neg = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const fp = a * p[0] + b * p[1] + c, fq = a * q[0] + b * q[1] + c;
    if (fp >= 0) pos.push(p);
    if (fp <= 0) neg.push(p);
    if ((fp > 0 && fq < 0) || (fp < 0 && fq > 0)) {
      const t = fp / (fp - fq), x = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      pos.push(x); neg.push(x);
    }
  }
  return [pos, neg];
}

function polyArea(poly) {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return Math.abs(s) / 2;
}

// Triangles (soup) with whatever lies inside any of the rects cut away. Each triangle is cut
// along a rect's four sides in turn: a piece outside one side is kept, the rest goes on to
// the next side, and what's left inside all four is dropped.
export function clipSoupOutside(soup, rects, out = []) {
  const sides = rects.map(rectSides);
  for (let i = 0; i < soup.length; i += 6) {
    let pieces = [[[soup[i], soup[i + 1]], [soup[i + 2], soup[i + 3]], [soup[i + 4], soup[i + 5]]]];
    const x0 = Math.min(soup[i], soup[i + 2], soup[i + 4]), x1 = Math.max(soup[i], soup[i + 2], soup[i + 4]);
    const y0 = Math.min(soup[i + 1], soup[i + 3], soup[i + 5]), y1 = Math.max(soup[i + 1], soup[i + 3], soup[i + 5]);
    rects.forEach((r, ri) => {
      const [bx0, by0, bx1, by1] = r.box;
      if (x1 < bx0 || x0 > bx1 || y1 < by0 || y0 > by1) return;
      const kept = [];
      for (const piece of pieces) {
        let rest = piece;
        for (const side of sides[ri]) {
          const [o, inn] = cutPoly(rest, side);
          if (o.length >= 3 && polyArea(o) > 1e-4) kept.push(o);
          rest = inn;
          if (rest.length < 3 || polyArea(rest) <= 1e-4) break;
        }
      }
      pieces = kept;
    });
    for (const p of pieces) for (let k = 1; k < p.length - 1; k++) out.push(p[0][0], p[0][1], p[k][0], p[k][1], p[k + 1][0], p[k + 1][1]);
  }
  return out;
}

// A polyline cut where it crosses the rects' edges, as runs that lie wholly inside some rect
// or wholly outside all of them, in order: [{ inside, pts }]. Neighbouring runs share the
// point where they meet.
export function splitPolyline(pts, rects) {
  const runs = [];
  let cur = null;
  const push = (inside, p) => {
    if (!cur || cur.inside !== inside) {
      const prev = cur && cur.pts[cur.pts.length - 1];
      cur = { inside, pts: prev ? [prev] : [] };
      runs.push(cur);
    }
    const last = cur.pts[cur.pts.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-6) cur.pts.push(p);
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    // Where along a..b (t in 0..1) it's inside each rect (Liang–Barsky), merged.
    const spans = [];
    for (const r of rects) {
      const [ua, va] = rectUV(r, a[0], a[1]), [ub, vb] = rectUV(r, b[0], b[1]);
      let t0 = 0, t1 = 1;
      const clip = (p, q) => {          // keep where p + q t >= 0
        if (Math.abs(q) < 1e-12) return p >= 0;
        const t = -p / q;
        if (q > 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
        return t0 <= t1;
      };
      if (clip(ua - r.u0, ub - ua) && clip(r.u1 - ua, ua - ub) && clip(r.hw - va, va - vb) && clip(r.hw + va, vb - va) && t1 - t0 > 1e-9) spans.push([t0, t1]);
    }
    spans.sort((p, q) => p[0] - q[0]);
    const merged = [];
    for (const s of spans) {
      const m = merged[merged.length - 1];
      if (m && s[0] <= m[1] + 1e-9) m[1] = Math.max(m[1], s[1]); else merged.push(s.slice());
    }
    const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    let t = 0;
    for (const [s0, s1] of merged) {
      if (s0 > t) { push(false, at(t)); push(false, at(s0)); }
      push(true, at(Math.max(s0, t))); push(true, at(s1));
      t = s1;
    }
    if (t < 1) { push(false, at(t)); push(false, b); }
  }
  return runs.filter((r) => r.pts.length >= 2);
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
export function standMarks(stand, fit = false) {
  const [dx, dy] = hdgVec(stand.hdgGridDeg);
  const fwd = fit ? NOSE_WHEEL - NOSE_AT : NOSE_WHEEL;     // v0.7.6: with the nose on the point, the nose wheel is 5.3 m behind it
  const stop = { x: stand.x + dx * fwd, y: stand.y + dy * fwd, dx, dy };
  let lead;
  if (stand.leadIn && stand.leadIn.length >= 2) {
    lead = stand.leadIn.map((p) => [p[0], p[1]]);
    const e = lead[lead.length - 1];
    // OSM's line ends at the stand point; carry it on to the stop bar.
    if ((stop.x - e[0]) * dx + (stop.y - e[1]) * dy > 0.5) lead.push([stop.x, stop.y]);
    // v0.7.8: with the fit the bar is 5.3 m short of the point, so the line is cut where it crosses the bar.
    else if (fit && GATES78) lead = trimLeadAt(lead, stop);
  } else {
    lead = [[stand.x - dx * 60, stand.y - dy * 60], [stop.x, stop.y]];
  }
  const label = { x: stand.x - dx * 14, y: stand.y - dy * 14, dx, dy };
  return { lead, stop, label };
}

// A lead-in line cut where it crosses the stop bar (the line through `stop` square to its heading): the points past
// the bar dropped, the crossing point added. A line that never reaches the bar, or lies wholly past it, is returned whole.
export function trimLeadAt(lead, stop) {
  const ahead = (p) => (p[0] - stop.x) * stop.dx + (p[1] - stop.y) * stop.dy;
  let n = lead.length;
  while (n > 0 && ahead(lead[n - 1]) > 0) n--;
  if (n === lead.length || n === 0) return lead;
  const a = lead[n - 1], b = lead[n], fa = ahead(a), fb = ahead(b), t = fa / (fa - fb);
  const out = lead.slice(0, n);
  if (-fa > 0.05) out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  return out.length >= 2 ? out : lead;
}

// Where a gate's jet bridge goes: from the nearest terminal wall to the cab at the L1 door.
// terminals: [ring, ...]. Returns null if no terminal wall is within maxLen.
// v0.7.8: `fitDoor` ({ back, half, sill }, with the fit only) puts the cab at that aircraft's own front door; without it
// the cab is where v0.7.6's fit put it, 4 m behind the nose and GATE_FIT_HALF out, which clears every type.
export function jetBridge(stand, terminals, maxLen = 80, fit = false, fitDoor = null) {
  const [dx, dy] = hdgVec(stand.hdgGridDeg);
  const lx = -dy, ly = dx;                                        // the aircraft's left
  // (The code review's fifth finding: the wall is always looked for from the DEFAULT door, as the paving under the
  // bridge is laid, and only the cab goes to the aircraft's own door. So a gate has its bridge for every type or for
  // none, its root never leaves its paving, and the root's clearance of the nose, tested for the default door 4 m
  // back, only grows for a door further back.)
  const D = fit && fitDoor ? fitDoor : null, back = NOSE_AT - DOOR_FWD;
  // v0.7.6 (gateFit()): the door where the parked aircraft's L1 door is, 4 m behind the nose that stands on the point.
  const doorFwd = fit ? DOOR_FWD - NOSE_AT : DOOR_FWD;
  // The fitted cab's face stands GATE_FIT_HALF out from the centreline, clear of a 777's nose too (its skin is about
  // 2.8 m out where the cab ends); before the fit the cab was 21 m ahead of every nose and FUSE_HALF met nothing.
  const side = fit ? GATE_FIT_HALF : FUSE_HALF;
  let door = { x: stand.x + dx * doorFwd + lx * side, y: stand.y + dy * doorFwd + ly * side };
  // The wall is looked for from the door; with the fit, from 9 m out to the left of it, so that a bridge from a wall
  // straight ahead comes in at an angle past the nose, as a real one does from its rotunda.
  const aim = fit ? { x: door.x + lx * GATE_FIT_SIDE, y: door.y + ly * GATE_FIT_SIDE } : door;
  let best = null;
  for (const ring of terminals) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const q = segDist(aim.x, aim.y, a[0], a[1], b[0], b[1]);
      // Not behind the door, and on the left half (the bridge mustn't cross the nose).
      const rx = q.x - door.x, ry = q.y - door.y;
      if (rx * dx + ry * dy < -4 || rx * lx + ry * ly < -6) continue;
      // With the fit the root is clear of the nose too: beside the fuselage, or ahead of the nose's tip.
      if (fit && rx * lx + ry * ly < 3 && rx * dx + ry * dy < back + 3) continue;
      // ... and never right of the centreline: a tunnel from there to a cab on the left would cross the nose (five
      // of Munich's gates did under ?gatefit=1, by the code review's count).
      if (fit && rx * lx + ry * ly < -side) continue;
      const d = fit ? Math.hypot(rx, ry) : q.d;
      if (!best || q.d < best.q) best = { d, q: q.d, x: q.x, y: q.y };
    }
  }
  if (!best || best.d > maxLen || best.d < 4) return null;
  // v0.7.8: the cab at the aircraft's own door, the root where the default door found it.
  if (D) door = { x: stand.x - dx * D.back + lx * D.half, y: stand.y - dy * D.back + ly * D.half };
  // The cab sits square to the fuselage, its face on the door; the tunnel meets its back.
  const cab = { x: door.x + lx * 1.6, y: door.y + ly * 1.6 };
  const jb = { root: { x: best.x, y: best.y }, cab, door, fwd: [dx, dy], left: [lx, ly], length: Math.hypot(cab.x - best.x, cab.y - best.y) };
  if (D && D.sill != null) jb.sill = D.sill;
  return jb;
}
