// Airport life on the CPU: which stands get a parked airliner (and which one), and the
// ground vehicles driving the service roads. Pure: no DOM, no three.js (runs in node).
//
//   const parked = placeParked(airport, { heightAt, wide })   seeded, the same every run
//   const fleet = createVehicles(airport, { heightAt })        seeded vehicles on the roads
//   fleet.step(dt); fleet.vehicles[i] → { kind, x, y, z, hdg }
//
// Coordinates are map metres; headings are grid radians (clockwise from map +y).

import { AIRLINER_TYPES } from './traffic-models.js';

// ------------------------------------------------------------------ seeded random

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

// mulberry32: small, fast, good enough for layout.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ footprints

// An oriented rectangle on the map: centre, unit axis (forward), half extents.
function rect(cx, cy, ux, uy, hl, hw) { return { cx, cy, ux, uy, hl, hw }; }

// Separating-axis test for two oriented rectangles.
export function rectsOverlap(a, b) {
  const axes = [[a.ux, a.uy], [-a.uy, a.ux], [b.ux, b.uy], [-b.uy, b.ux]];
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  for (const [ax, ay] of axes) {
    const ra = a.hl * Math.abs(a.ux * ax + a.uy * ay) + a.hw * Math.abs(-a.uy * ax + a.ux * ay);
    const rb = b.hl * Math.abs(b.ux * ax + b.uy * ay) + b.hw * Math.abs(-b.uy * ax + b.ux * ay);
    if (Math.abs(dx * ax + dy * ay) > ra + rb) return false;
  }
  return true;
}

function rectCorners(r) {
  const out = [];
  for (const [s, t] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    out.push([r.cx + r.ux * r.hl * s - r.uy * r.hw * t, r.cy + r.uy * r.hl * s + r.ux * r.hw * t]);
  }
  return out;
}

function pointInRect(x, y, r) {
  const dx = x - r.cx, dy = y - r.cy;
  return Math.abs(dx * r.ux + dy * r.uy) <= r.hl && Math.abs(-dx * r.uy + dy * r.ux) <= r.hw;
}

export function pointInPoly(x, y, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function segsCross(p, q, r, s) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(r, s, p), d2 = d(r, s, q), d3 = d(p, q, r), d4 = d(p, q, s);
  return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0);
}

// Does an oriented rectangle touch a polygon (overlap, either inside the other)?
function rectHitsPoly(r, P, bb) {
  if (bb && (r.cx + r.hl + r.hw < bb[0] || r.cx - r.hl - r.hw > bb[2] || r.cy + r.hl + r.hw < bb[1] || r.cy - r.hl - r.hw > bb[3])) return false;
  const C = rectCorners(r);
  for (const [x, y] of C) if (pointInPoly(x, y, P)) return true;
  for (const [x, y] of P) if (pointInRect(x, y, r)) return true;
  for (let i = 0; i < 4; i++) for (let j = 0, k = P.length - 1; j < P.length; k = j++) {
    if (segsCross(C[i], C[(i + 1) % 4], P[k], P[j])) return true;
  }
  return false;
}

// The footprint of an airliner of type T whose nose tip is at (x, y), heading h:
// fuselage, wing and tailplane boxes, each grown by `margin` metres.
export function footprint(T, x, y, h, lenScale = 1, margin = 0) {
  const ux = Math.sin(h), uy = Math.cos(h);
  const at = (along) => [x + ux * along, y + uy * along];
  const L = T.length * lenScale, ls = lenScale;
  const f = at(-L / 2), w = at(-(T.wingX0 + T.wingX1) / 2 * ls), s = at(-(T.stabX0 + T.stabX1) / 2 * ls);
  return [
    rect(f[0], f[1], ux, uy, L / 2 + margin, T.radius + margin),
    rect(w[0], w[1], ux, uy, (T.wingX1 - T.wingX0) / 2 * ls + margin, T.span / 2 + margin),
    rect(s[0], s[1], ux, uy, (T.stabX1 - T.stabX0) / 2 * ls + margin, T.stabSpan / 2 + margin),
  ];
}

function footprintsOverlap(A, B) {
  for (const a of A) for (const b of B) if (rectsOverlap(a, b)) return true;
  return false;
}

// ------------------------------------------------------------------ parked aircraft

export const FILL = 0.7;            // share of the stands that get an aircraft
const CLEAR = 2.0;                  // m grown on every side of a footprint (4 m wingtip gap)

// Liveries: 0 = Nuclear Airlines, then the made-up ones (liveries-other.js). Nuclear is
// the commonest at every airport, the others by airport.
const LIVERY_WEIGHTS = {
  RKSS: [0.40, 0.25, 0.15, 0.20],
  RKPC: [0.35, 0.15, 0.35, 0.15],
  RKSI: [0.40, 0.25, 0.10, 0.25],
};

function pick(weights, r) {
  let s = 0;
  for (let i = 0; i < weights.length; i++) { s += weights[i]; if (r < s) return i; }
  return weights.length - 1;
}

// Obstacles an aircraft must stay clear of: buildings (by polygon) and runway strips.
function obstacles(airport) {
  const polys = (airport.buildings || []).map((b) => {
    const P = b.points;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { P, bb: [x0, y0, x1, y1] };
  });
  const strips = (airport.runways || []).map((r) => {
    const [a, b] = r.ends;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    return rect((a.x + b.x) / 2, (a.y + b.y) / 2, ux, uy, len / 2 + 300, r.widthM / 2 + 60);
  });
  return { polys, strips };
}

function blocked(fp, obs) {
  for (const r of fp) {
    for (const s of obs.strips) if (rectsOverlap(r, s)) return true;
    for (const p of obs.polys) if (rectHitsPoly(r, p.P, p.bb)) return true;
  }
  return false;
}

// A stand's nose-in heading (grid radians). The baked hdgGridDeg is right where the
// stand has a lead-in line, but at Gimpo (no lead-ins in the data) it's often 90° off.
// There the lead-in is a taxiway line that ends at, or runs through, the stand. Each
// candidate heading (the baked one, a line ending within 30 m, both ways along a line
// passing within 8 m) is scored by how much of a narrowbody parked that way lies on
// the apron; the best wins, ties going to the earlier candidate.
export function standHeading(airport, s, aprons = apronIndex(airport)) {
  const h0 = (s.hdgGridDeg || 0) * Math.PI / 180;
  if (s.hdgFixed || (s.leadIn && s.leadIn.length > 1)) return h0; // already corrected (main.js)
  const cands = [];
  let end = null;
  for (const t of airport.taxiways || []) {
    const P = t.points;
    if (!P || P.length < 2) continue;
    for (const [i, j] of [[P.length - 1, P.length - 2], [0, 1]]) {
      const d = Math.hypot(P[i][0] - s.x, P[i][1] - s.y);
      if (d < 30 && (!end || d < end.d)) {
        // Walk back along the line at least 8 m for a steady direction.
        let k = j;
        const step = j > i ? 1 : -1;
        while (k + step >= 0 && k + step < P.length && Math.hypot(P[k][0] - P[i][0], P[k][1] - P[i][1]) < 8) k += step;
        end = { d, h: Math.atan2(P[i][0] - P[k][0], P[i][1] - P[k][1]) };
      }
    }
    for (let i = 0; i < P.length - 1; i++) {
      const [ax, ay] = P[i], [bx, by] = P[i + 1];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      if (L2 < 1) continue;
      const u = Math.min(Math.max(((s.x - ax) * dx + (s.y - ay) * dy) / L2, 0), 1);
      if (Math.hypot(ax + dx * u - s.x, ay + dy * u - s.y) < 8) {
        const h = Math.atan2(dx, dy);
        cands.push(h, h + Math.PI);
      }
    }
  }
  // Scores: apron cover, plus a bonus for following a line. A line through the stand
  // counts only when it's square to the baked heading (the Gimpo failure); a line
  // ending at the stand only when it doesn't turn the stand round (a push-back line).
  const diff = (h) => Math.abs(Math.atan2(Math.sin(h - h0), Math.cos(h - h0)));
  const scored = [{ h: h0, bonus: 0 }];
  if (end && diff(end.h) < 2.1) scored.push({ h: end.h, bonus: end.d < 10 ? 0.6 : 0.3 });
  for (const h of cands) if (Math.abs(diff(h) - Math.PI / 2) < 0.35) scored.push({ h, bonus: 0.2 });
  if (scored.length === 1) return h0;
  let best = h0, bestScore = -1;
  for (const c of scored) {
    const sc = (aprons.length ? apronCover(aprons, s.x, s.y, c.h) : 1) + c.bonus;
    if (sc > bestScore + 1e-9) { best = c.h; bestScore = sc; }
  }
  return best;
}

// Aprons with bounding boxes, for quick point tests.
export function apronIndex(airport) {
  return (airport.aprons || []).map((a) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of a.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { P: a.points, bb: [x0, y0, x1, y1] };
  });
}

// Share of a narrowbody's sample points (nose at x, y, heading h) on an apron.
function apronCover(aprons, x, y, h) {
  const fx = Math.sin(h), fy = Math.cos(h), rx = Math.cos(h), ry = -Math.sin(h);
  let n = 0, inside = 0;
  const test = (px, py) => {
    n++;
    for (const a of aprons) {
      if (px < a.bb[0] || px > a.bb[2] || py < a.bb[1] || py > a.bb[3]) continue;
      if (pointInPoly(px, py, a.P)) { inside++; return; }
    }
  };
  for (let d = 4; d <= 40; d += 4) test(x - fx * d, y - fy * d);
  for (const side of [-16, -8, 8, 16]) test(x - fx * 20 + rx * side, y - fy * 20 + ry * side);
  return inside / n;
}

// Choose the parked aircraft for one airport. Returns a list of
// { stand (ref), type (index into AIRLINER_TYPES), livery, x, y (nose tip), z, hdg, lenScale, fp }.
// `wide`: whether widebodies park here (Incheon). Seeded by the ICAO code.
export function placeParked(airport, { heightAt = null, wide = airport.icao === 'RKSI', fill = FILL } = {}) {
  const R = rng(hashString(`parked:${airport.icao}`));
  const stands = (airport.stands || []).slice();
  // Seeded shuffle (Fisher–Yates).
  for (let i = stands.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [stands[i], stands[j]] = [stands[j], stands[i]]; }
  const target = Math.round(stands.length * fill);
  const obs = obstacles(airport);
  const weights = LIVERY_WEIGHTS[airport.icao] || [0.4, 0.2, 0.2, 0.2];
  const placed = [];
  const aprons = apronIndex(airport);
  const fits = (fp) => !blocked(fp, obs) && !placed.some((p) => footprintsOverlap(fp, p.fp));
  for (const s of stands) {
    if (placed.length >= target) break;
    const h = standHeading(airport, s, aprons);
    const r0 = R(), r1 = R(), r2 = R();
    // Widebodies at about half of Incheon's stands that are big enough; else a narrowbody.
    const tries = wide && r0 < 0.5 ? [1, 0] : [0];
    for (const type of tries) {
      const T = AIRLINER_TYPES[type];
      const lenScale = type === 0 ? (r1 < 0.45 ? T.shortScale : 1) : 1;
      // The stand point is the nose's stop mark; back off up to 12 m if the nose would
      // touch a building (some OSM stop marks sit right at the terminal wall).
      let ok = null;
      for (let back = 0; back <= 12; back += 3) {
        const x = s.x - Math.sin(h) * back, y = s.y - Math.cos(h) * back;
        const fp = footprint(T, x, y, h, lenScale, CLEAR);
        if (fits(fp)) { ok = { x, y, fp }; break; }
      }
      if (!ok) continue;
      const z = heightAt ? heightAt(ok.x - Math.sin(h) * T.length * 0.4, ok.y - Math.cos(h) * T.length * 0.4) : (airport.elevM || 0);
      placed.push({ stand: s.ref, type, livery: pick(weights, r2), x: ok.x, y: ok.y, z, hdg: h, lenScale, fp: ok.fp });
      break;
    }
  }
  return placed;
}

// Which parked aircraft must go for the player's aircraft at this stand: the one at the
// stand itself and any whose footprint overlaps a narrowbody's there.
export function blockedByPlayer(airport, parked, ref) {
  const s = (airport.stands || []).find((t) => t.ref === ref);
  if (!s) return new Set();
  const h = standHeading(airport, s);
  // The player's nose is on the stand point (gate-flow.js), the same convention as the
  // parked aircraft, so the footprint goes on the stand itself.
  const T = AIRLINER_TYPES[0];
  const fp = footprint(T, s.x, s.y, h, 1, 1);
  const out = new Set();
  parked.forEach((p, i) => { if (p.stand === ref || footprintsOverlap(fp, p.fp)) out.add(i); });
  return out;
}

// ------------------------------------------------------------------ service roads

// Join the service-road pieces that meet end to end into longer chains, so vehicles
// drive whole roads rather than 20 m stubs. Returns [{ points, closed }].
export function chainRoads(roads, tol = 1.5) {
  const lines = (roads || []).map((r) => r.points.slice()).filter((p) => p.length >= 2);
  const key = (p) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  const ends = new Map();     // key → [line index, which end]
  const add = (k, v) => { if (!ends.has(k)) ends.set(k, []); ends.get(k).push(v); };
  lines.forEach((p, i) => { add(key(p[0]), [i, 0]); add(key(p[p.length - 1]), [i, 1]); });
  const used = new Uint8Array(lines.length);
  const out = [];
  // Extend `chain` from its tail through junctions where exactly two pieces meet.
  const extend = (chain) => {
    for (;;) {
      const tail = chain[chain.length - 1];
      const list = ends.get(key(tail)) || [];
      if (list.length !== 2) return;
      const next = list.find(([i]) => !used[i]);
      if (!next) return;
      const [i, end] = next;
      used[i] = 1;
      const p = end === 0 ? lines[i] : lines[i].slice().reverse();
      for (let k = 1; k < p.length; k++) chain.push(p[k]);
    }
  };
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let chain = lines[i].slice();
    extend(chain);
    chain.reverse();
    extend(chain);
    const a = chain[0], b = chain[chain.length - 1];
    const closed = chain.length > 3 && Math.hypot(a[0] - b[0], a[1] - b[1]) < tol;
    if (closed) chain = chain.slice(0, -1);
    out.push({ points: chain, closed });
  }
  return out;
}

// A polyline with its cumulative lengths, for walking along it.
export function makePath(points, closed, side = 0) {
  let pts = points;
  // Drive on the right: offset the centreline by `side` metres to the right of travel.
  if (side) {
    pts = points.map((p, i) => {
      const a = points[Math.max(i - 1, 0)], b = points[Math.min(i + 1, points.length - 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      if (closed && (i === 0 || i === points.length - 1)) {
        const pa = points[(i - 1 + points.length) % points.length], pb = points[(i + 1) % points.length];
        dx = pb[0] - pa[0]; dy = pb[1] - pa[1];
      }
      const l = Math.hypot(dx, dy) || 1;
      return [p[0] + (dy / l) * side, p[1] - (dx / l) * side];
    });
  }
  if (closed) pts = pts.concat([pts[0]]);
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return { pts, cum, length: cum[cum.length - 1], closed };
}

// Position and heading at distance s along a path (s is clamped; `seg` is a cursor hint).
export function pathAt(path, s, out, hint = 0) {
  const { pts, cum } = path;
  let i = Math.min(Math.max(hint, 0), pts.length - 2);
  while (i > 0 && cum[i] > s) i--;
  while (i < pts.length - 2 && cum[i + 1] < s) i++;
  const l = cum[i + 1] - cum[i] || 1;
  const t = Math.min(Math.max((s - cum[i]) / l, 0), 1);
  const a = pts[i], b = pts[i + 1];
  out.x = a[0] + (b[0] - a[0]) * t;
  out.y = a[1] + (b[1] - a[1]) * t;
  out.hdg = Math.atan2(b[0] - a[0], b[1] - a[1]);
  out.seg = i;
  return out;
}

// ------------------------------------------------------------------ vehicles

export const VEHICLE_KINDS = ['tug', 'bus', 'cart', 'fuel'];
const CART_GAP = 3.6;     // m between a baggage train's hitch points

// Seeded vehicles on an airport's service roads. Kinds: tug, bus, baggage train (a tug
// pulling 3 carts) and fuel truck. Each drives one chained road: round and round if it's
// closed, back and forth if not, at 5–10 m/s, keeping to the right.
export function createVehicles(airport, { heightAt = null, count = null } = {}) {
  const R = rng(hashString(`vehicles:${airport.icao}`));
  // Prefer the roads on the aprons (a third of their points on one), then those within
  // 250 m of a stand, and the landside and perimeter roads only if there aren't enough.
  const stands = airport.stands || [];
  const aprons = apronIndex(airport);
  const onApron = (c) => {
    let n = 0;
    for (const [x, y] of c.points) if (aprons.some((a) => x >= a.bb[0] && x <= a.bb[2] && y >= a.bb[1] && y <= a.bb[3] && pointInPoly(x, y, a.P))) n++;
    return n >= c.points.length / 3;
  };
  const nearStand = (c) => c.points.some(([x, y]) => stands.some((s) => Math.abs(s.x - x) < 250 && Math.abs(s.y - y) < 250));
  let chains = chainRoads(airport.serviceRoads).map((c) => ({ ...c, len: makePath(c.points, c.closed).length }))
    .filter((c) => c.len > 150)
    .sort((a, b) => b.len - a.len);
  const apron = chains.filter(onApron), near = chains.filter(nearStand);
  if (apron.length >= 20) chains = apron;
  else if (near.length >= 20) chains = [...apron, ...near.filter((c) => !apron.includes(c))];
  const n = Math.min(count ?? Math.round(20 + Math.min(20, chains.length / 6)), chains.length);
  const elev = airport.elevM || 0;
  const vehicles = [];   // what gets drawn: { kind, x, y, z, hdg }
  const drivers = [];    // what moves:  { path, speed, s, dir, units: [{ v, lag }] }
  // Longer roads get more traffic, but each road at most one driver (they never meet).
  const pool = chains.slice(0, Math.max(n * 2, n));
  for (let k = 0; k < n && pool.length; k++) {
    const total = pool.reduce((a, c) => a + Math.sqrt(c.len), 0);
    let r = R() * total, idx = 0;
    for (; idx < pool.length - 1; idx++) { r -= Math.sqrt(pool[idx].len); if (r <= 0) break; }
    const c = pool.splice(idx, 1)[0];
    const path = makePath(c.points, c.closed, 2.2);
    const roll = R();
    const kind = roll < 0.25 ? 'tug' : roll < 0.45 ? 'bus' : roll < 0.75 ? 'train' : 'fuel';
    const speed = 5 + 5 * R();
    const d = { path, speed, s: R() * path.length * (c.closed ? 1 : 2), units: [], hint: [] };
    const unit = (kind, lag) => {
      const v = { kind, x: 0, y: 0, z: elev, hdg: 0 };
      vehicles.push(v); d.units.push({ v, lag }); d.hint.push(0);
    };
    if (kind === 'train') {
      unit('tug', 0);
      for (let j = 1; j <= 3; j++) unit('cart', 2.6 + CART_GAP * j);
    } else unit(kind, 0);
    drivers.push(d);
  }
  // Heights: the airfield is flat, so one sample per road is plenty.
  for (const d of drivers) {
    const p = d.path.pts[Math.floor(d.path.pts.length / 2)];
    d.z = heightAt ? heightAt(p[0], p[1]) : elev;
  }
  const tmp = { x: 0, y: 0, hdg: 0, seg: 0 };
  const fleet = {
    vehicles,
    drivers,
    // Move everything on by dt seconds (deterministic: no clocks).
    step(dt) {
      for (const d of drivers) {
        const L = d.path.length, period = d.path.closed ? L : 2 * L;
        d.s = (d.s + d.speed * dt) % period;
        for (let j = 0; j < d.units.length; j++) {
          const u = d.units[j];
          let s = (d.s - u.lag + period) % period, back = false;
          if (!d.path.closed && s > L) { s = 2 * L - s; back = true; }
          // An open road is driven back on its other side: mirror the offset by
          // walking the reversed path (approximated by flipping the heading and
          // shifting 4.4 m across).
          pathAt(d.path, s, tmp, d.hint[j]);
          d.hint[j] = tmp.seg;
          let x = tmp.x, y = tmp.y, hdg = tmp.hdg;
          if (back) {
            hdg += Math.PI;
            x += -Math.cos(tmp.hdg) * 4.4; y += Math.sin(tmp.hdg) * 4.4;
          }
          u.v.x = x; u.v.y = y; u.v.z = d.z; u.v.hdg = hdg;
        }
      }
    },
  };
  fleet.step(0);
  return fleet;
}
