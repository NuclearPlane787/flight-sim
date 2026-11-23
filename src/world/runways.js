// Airports and runways on the CPU: lookups for the sim, the screens and the renderer.
// Pure: no DOM, no three.js (runs in the page, in workers and in node).
//
//   const ap = await loadAirports('data/', { heightfield });
//   ap.airports                       the airport JSONs (data/airports/<ICAO>.json), normalised
//   ap.findRunwayEnd('RKSS', '14R')   that end: threshold, heading, elevation, its runway
//   ap.onRunway(x, y)                 the runway under a map point, or null
//   ap.groundKind(x, y)               'runway' | 'water' | 'ground'
//
// Until the bake has written data/airports/, a built-in fallback from OurAirports
// (rounded to ~0.001°, so up to ~45 m off) keeps Gimpo, Jeju and Incheon usable.

import { toMap, toGeo, convergence, magVar } from './frame.js';
import { REGION_ID } from './regions.js';
import { terrainSpec } from './region.js';

const DEG = Math.PI / 180;

// OurAirports runways.csv (public domain): [ident, lat, lon, elevFt, displacedFt] pairs.
const FALLBACK = [
  { icao: 'RKSS', name: 'Gimpo International', lat: 37.5583, lon: 126.791, elevFt: 59, runways: [
    { widthFt: 197, ends: [['14R', 37.56800, 126.77600, 34, 0], ['32L', 37.54760, 126.80100, 41, 0]] },
    { widthFt: 148, ends: [['14L', 37.57030, 126.77800, 38, 0], ['32R', 37.54740, 126.80700, 42, 0]] },
  ] },
  { icao: 'RKPC', name: 'Jeju International', lat: 33.512058, lon: 126.492548, elevFt: 118, runways: [
    { widthFt: 148, ends: [['07', 33.50040, 126.46900, 86, 0], ['25', 33.51450, 126.49700, 76, 0]] },
    { widthFt: 148, ends: [['13', 33.51550, 126.48700, 67, 0], ['31', 33.50550, 126.50400, 105, 1350]] },
  ] },
  { icao: 'RKSI', name: 'Incheon International', lat: 37.469101, lon: 126.450996, elevFt: 23, runways: [
    { widthFt: 197, ends: [['15L', 37.48390, 126.44000, 23, 0], ['33R', 37.45640, 126.46500, 23, 0]] },
    { widthFt: 197, ends: [['15R', 37.48180, 126.43600, 23, 0], ['33L', 37.45420, 126.46100, 23, 0]] },
    { widthFt: 197, ends: [['16L', 37.47274, 126.415631, 23, 0], ['34R', 37.443432, 126.441697, 23, 0]] },
    { widthFt: 197, ends: [['16R', 37.468746, 126.413446, 23, 0], ['34L', 37.441272, 126.437882, 23, 0]] },
  ] },
];

const FT = 0.3048;

// Build airport JSONs (the bake's format) from the fallback table.
export function fallbackAirports() {
  return FALLBACK.map((a) => {
    const origin = toMap(a.lat, a.lon);
    const runways = a.runways.map((r) => {
      const ends = r.ends.map(([ident, lat, lon, elevFt, dispFt]) => {
        const [x, y] = toMap(lat, lon);
        return { ident, lat, lon, x, y, elevM: elevFt * FT, displacedM: dispFt * FT, papi: 'left', approachLights: 'ALSF-II' };
      });
      for (let k = 0; k < 2; k++) {
        const a0 = ends[k], b0 = ends[1 - k];
        const grid = Math.atan2(b0.x - a0.x, b0.y - a0.y) / DEG;
        a0.hdgGridDeg = (grid + 360) % 360;
        a0.hdgTrueDeg = (grid + convergence(a0.lon) / DEG + 360) % 360;
      }
      const lengthM = Math.hypot(ends[1].x - ends[0].x, ends[1].y - ends[0].y);
      // As in the bake: x, y is the landing threshold, pavementEnd the physical end.
      for (let k = 0; k < 2; k++) {
        const e = ends[k], o = ends[1 - k];
        e.pavementEnd = [e.x, e.y];
        e.x += (o.x - e.x) / lengthM * e.displacedM;
        e.y += (o.y - e.y) / lengthM * e.displacedM;
      }
      return { id: `${ends[0].ident}/${ends[1].ident}`, widthM: r.widthFt * FT, lengthM, surface: 'asphalt', ends };
    });
    return { icao: a.icao, name: a.name, lat: a.lat, lon: a.lon, elevM: a.elevFt * FT, origin, magVarDeg: magVar(a.lat, a.lon),
      runways, taxiways: [], aprons: [], stands: [], holdingPositions: [], buildings: [], serviceRoads: [], fallback: true };
  });
}

// The physical (pavement) end of a runway end: the bake gives it as pavementEnd; x, y is
// the landing threshold.
export function pavementEnd(e) {
  return e.pavementEnd ? { x: e.pavementEnd[0], y: e.pavementEnd[1] } : { x: e.x, y: e.y };
}

// Where two runways of an airport cross (Jeju's 07/25 and 13/31), one surface has to win.
// The longer runway (the primary, the higher `rank`) keeps its straight profile and is drawn
// whole through the crossing. The shorter one bends to meet it: two `knots` where its
// centreline reaches the primary's drawn edges, at the primary's height there. It's cut away
// on the primary's pavement (`cutBy`, in airports.js), with its lights. Before v0.1.4 both kept
// straight profiles, so they cut through each other along a diagonal seam, and the ground near
// the crossing followed whichever runway came last in the file (07/25's wheels ran up to
// 0.69 m under its surface, 200 m before the crossing).
export const RUNWAY_SHOULDER_M = 7.5;   // m of paved shoulder each side, beyond the edge lines (as drawn)

function runwayAxis(r, elev = 0) {
  const p0 = pavementEnd(r.ends[0]), p1 = pavementEnd(r.ends[1]);
  const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
  return { p0, len, ux: (p1.x - p0.x) / len, uy: (p1.y - p0.y) / len,
    e0: r.ends[0].elevM ?? elev, e1: r.ends[1].elevM ?? elev };
}

// Runway r's surface height (m) at s metres from end 0's pavement end, clamped to the runway.
export function profileAt(r, s, elev = 0) {
  const ax = runwayAxis(r, elev);
  const pts = [[0, ax.e0], ...(r.knots || []), [ax.len, ax.e1]];
  if (s <= 0) return ax.e0;
  for (let i = 1; i < pts.length; i++) {
    const [s0, h0] = pts[i - 1], [s1, h1] = pts[i];
    if (s <= s1) return s1 > s0 ? h0 + ((h1 - h0) * (s - s0)) / (s1 - s0) : h1;
  }
  return ax.e1;
}

// v0.7.2: the longer runway's own level where a shorter one crosses it, where the straight line between its ends is
// far from the truth: { ICAO: { 'the longer': ['the shorter', level in m] } }. Prague's 06/24 falls 12.8 m in its first
// 1.5 km and 1 m in the rest: the straight line stood 7.2 m above 12's published threshold (353.6 m, 46 m from 06/24's
// centreline, 24 m from its edge), which left 12/30 a 7 m ramp in its first 19 m. The level is 12's threshold's [EST].
export const CROSSING_LEVEL = { LKPR: { '06/24': ['12/30', 353.6] } };

// Ranks, knots and cuts for an airport's runways (once; the airport keeps them). A runway bends to every longer
// runway it crosses and is cut by each (v0.7.4; until then to one at most, a second crossing left as it was with a
// warning: Brussels's 01/19 crosses 07R/25L and 07L/25R).
// - A runway that crosses ONE longer runway keeps v0.1.4's shape exactly: two bends, where its centreline meets the
//   longer one's two drawn edges. (Off its centreline such a crossing has a step where the two meet at an angle: the
//   shorter runway's height is a function of the distance along it alone, and the longer one's edge crosses its width
//   askew. Up to 0.3 m at 20 m off the centreline at Dublin and Prague, under 1.5 cm on every centreline: ROADMAP.md,
//   "Found while building v0.7.4". Shaping them as below would move ground already flown.)
// - A runway that crosses TWO or more (v0.7.4: Brussels's 01/19 alone) gets four bends a crossing: where each of the
//   longer runway's drawn edges meets each of its own two sides, at the longer runway's height there. Between an
//   edge's two bends its surface is then the longer runway's height all along that edge, across its whole width, so
//   the two meet without a lip wherever the wheels are.
// Its knots end sorted along it. The runway's own shader carries up to MAX_KNOTS of them (knotPairs(), in a variant of
// its text that only such a runway takes: airports.js); the heightfield and the terrain shader get the runway as
// several rects of two bends each (runwayRects()), so their arithmetic and text are v0.1.4's for every runway.
// v0.7.8 (part 2, Shane: it "changes ground already flown"): every runway that crosses a longer one gets the four
// bends a crossing, not only one that crosses two, so the step off the centreline at an oblique crossing goes (33 cm
// at 20 m off at Dublin, 27 cm at Prague, 24 cm at Lossiemouth, 12 cm at Cologne Bonn, 8 cm at Jeju: ROADMAP.md,
// "Found while building v0.7.4"). And where the longer runway has a bend of its own inside the crossing (Prague's
// CROSSING_LEVEL), the shorter one bends there too, on each edge. ?crossings78=0 (node FS_CROSSINGS78=0) gives the
// pushed v0.7.7's shapes back: two bends for a single crossing.
export const END_LEVEL_M = 10, END_LEVEL_MAX = 1;   // (an end more than 1 m off its bend is a fault in the data, not a lip: left to show)
export const CROSSINGS78 = (() => {
  const q = typeof location !== 'undefined' && location && /[?&]crossings78=0(&|$)/.test(location.search || '');
  const e = typeof process !== 'undefined' && process.env && process.env.FS_CROSSINGS78 === '0';
  return !(q || e);
})();
export function runwayCrossings(airport) {
  const rws = (airport?.runways || []).filter((r) => r.ends && r.ends.length === 2);
  if (!rws.length || rws.every((r) => r.rank !== undefined)) return;
  const elev = airport.elevM ?? 0;
  const ax = new Map(rws.map((r) => [r, runwayAxis(r, elev)]));
  const order = rws.slice().sort((p, q) => (ax.get(p).len - ax.get(q).len) || ((p.widthM || 45) - (q.widthM || 45))
    || String(p.id).localeCompare(String(q.id)));
  order.forEach((r, i) => { r.rank = i; r.knots = []; r.cutBy = []; });
  // (v0.7.2) A longer runway whose real surface isn't the straight line between its ends where a shorter one crosses it
  // (CROSSING_LEVEL): one knot at the crossing, at the level given. The shorter then bends to that as to any other.
  const lv = CROSSING_LEVEL[airport.icao];
  if (lv) for (const P of order) {
    const set = lv[P.id], S = set && order.find((r) => r.id === set[0]);
    if (!S) continue;
    const a = ax.get(P), b = ax.get(S), den = a.ux * b.uy - a.uy * b.ux;
    if (Math.abs(den) < 0.05) continue;
    const s = ((b.p0.x - a.p0.x) * b.uy - (b.p0.y - a.p0.y) * b.ux) / den;
    if (s > 1 && s < a.len - 1) P.knots.push([s, set[1]]);
  }
  for (const S of order.slice().reverse()) {      // the longer ones first: their profiles are final
    const own = S.knots.length;                   // (v0.7.4: a CROSSING_LEVEL knot of its own, kept below)
    for (const P of order) {
      if (P.rank <= S.rank) continue;
      const a = ax.get(S), b = ax.get(P);
      const den = a.ux * b.uy - a.uy * b.ux;      // the sine of the angle between them
      if (Math.abs(den) < 0.05) continue;         // parallel
      const dx = b.p0.x - a.p0.x, dy = b.p0.y - a.p0.y;
      const sS = (dx * b.uy - dy * b.ux) / den, sP = (dx * a.uy - dy * a.ux) / den;
      if (sS < 0 || sS > a.len || sP < 0 || sP > b.len) continue;   // the centrelines don't cross on both
      const d = ((P.widthM || 45) / 2 + RUNWAY_SHOULDER_M) / Math.abs(den);   // along S, crossing to P's drawn edge
      const onP = (s) => { const x = a.p0.x + a.ux * s, y = a.p0.y + a.uy * s; return profileAt(P, (x - b.p0.x) * b.ux + (y - b.p0.y) * b.uy, elev); };
      for (const s of [sS - d, sS + d]) if (s > 1 && s < a.len - 1) S.knots.push([s, onP(s)]);
      S.cutBy.push(P);
    }
    if (S.cutBy.length > 1 || (CROSSINGS78 && S.cutBy.length === 1)) {
      // v0.7.4: two or more crossings: four bends a crossing (above), in place of the two each just got. A point of
      // S is (s along its axis, v to its left); across P it is linear in s, so each meeting is one division.
      const a = ax.get(S), hwS = (S.widthM || 45) / 2 + RUNWAY_SHOULDER_M;
      S.knots = S.knots.slice(0, own);
      for (const P of S.cutBy) {
        const b = ax.get(P), hwP = (P.widthM || 45) / 2 + RUNWAY_SHOULDER_M;
        for (const edge of [-hwP, hwP]) for (const v of [-hwS, hwS]) {
          const at = (s) => [a.p0.x + a.ux * s - a.uy * v, a.p0.y + a.uy * s + a.ux * v];
          const across = (s) => { const [x, y] = at(s); return -(x - b.p0.x) * b.uy + (y - b.p0.y) * b.ux; };
          const f0 = across(0), f1 = across(1), s = (edge - f0) / (f1 - f0), [x, y] = at(s);
          if (s > 1 && s < a.len - 1) S.knots.push([s, profileAt(P, (x - b.p0.x) * b.ux + (y - b.p0.y) * b.uy, elev)]);
        }
        // v0.7.8: a bend of P's own (its CROSSING_LEVEL knot) that lies on one of its edges within S's width: S bends
        // there too, so that along that edge S's height is P's on both sides of P's bend.
        if (CROSSINGS78) for (const [t, h] of P.knots || []) for (const edge of [-hwP, hwP]) {
          const x = b.p0.x + b.ux * t - b.uy * edge, y = b.p0.y + b.uy * t + b.ux * edge;
          const s = (x - a.p0.x) * a.ux + (y - a.p0.y) * a.uy, v = -(x - a.p0.x) * a.uy + (y - a.p0.y) * a.ux;
          if (Math.abs(v) < hwS && s > 1 && s < a.len - 1) S.knots.push([s, h]);
        }
      }
      S.knots.sort((p, q) => p[0] - q[0]);
      // v0.7.8: a crossing at the runway's very end (Prague's 12/30: 06/24's edge meets its side 2.6 m from its
      // pavement end, 0.42 m above 12's published 353.6 m): a bend within END_LEVEL_M of an end that would leave a
      // ramp over 2 % to it takes the end to the bend's height, level, if that is under END_LEVEL_MAX away. The published
      // figure is kept as elevAipM.
      if (CROSSINGS78 && S.knots.length) {
        const a = ax.get(S), ends = [[0, S.knots[0], S.knots[0][0]], [1, S.knots[S.knots.length - 1], a.len - S.knots[S.knots.length - 1][0]]];
        for (const [i, k, d] of ends) {
          const e = i ? a.e1 : a.e0;
          if (d < END_LEVEL_M && Math.abs(k[1] - e) > 0.02 * d && Math.abs(k[1] - e) < END_LEVEL_MAX) {
            S.ends[i].elevAipM = S.ends[i].elevM; S.ends[i].elevM = k[1];
            if (i) a.e1 = k[1]; else a.e0 = k[1];
          }
        }
      }
    }
    if (S.knots.length > MAX_KNOTS) console.warn(`Runway ${S.id} has ${S.knots.length} bends; the shaders draw the first ${MAX_KNOTS}`);
  }
}

// v0.7.4: a runway's bends for the shaders, as KNOT_VECS vec4s' worth of (position, height) pairs: [p0, h0, p1, h1],
// [p2, h2, p3, h3] and so on, a position of 1e9 where there is none. One or two bends pack as v0.1.4's did (a single
// bend twice); an odd count repeats its last. `knots` are [position, height] in the caller's own measure along the
// runway, in order.
export const MAX_KNOTS = 8, KNOT_VECS = MAX_KNOTS / 2;
export function knotPairs(knots) {
  const k = knots || [], n = Math.min(k.length, MAX_KNOTS), out = [];
  for (let v = 0; v < KNOT_VECS; v++) {
    const q = [1e9, 0, 1e9, 0], i = 2 * v;
    if (n > i) { const k1 = k[n > i + 1 ? i + 1 : i]; q[0] = k[i][0]; q[1] = k[i][1]; q[2] = k1[0]; q[3] = k1[1]; }
    out.push(q);
  }
  return out;
}
// The shaders' height along a runway through those vec4s, as GLSL: `h = …;` chained over KNOT_VECS vectors. `pos` is
// the position's expression, `k` the vectors' names, `first` and `last` the two end segments' text as functions of a
// vector's name (the runway shader measures from end 0, the terrain shader from the centre: each keeps its own
// arithmetic, so a runway with no bend or two is computed exactly as before v0.7.4).
export function knotChainGlsl({ pos, k, set, none, first, last }) {
  let g = `if (${k[0]}.x > 1e8) ${set(none)}\n    else if (${pos} < ${k[0]}.x) ${set(first(k[0]))}\n`;
  for (let i = 0; i < k.length; i++) {
    const K = k[i], N = k[i + 1];
    g += `    else if (${pos} < ${K}.z) ${set(`mix(${K}.y, ${K}.w, (${pos} - ${K}.x) / max(${K}.z - ${K}.x, 1e-3))`)}\n`;
    if (N) {
      g += `    else if (${N}.x > 1e8) ${set(last(K))}\n`;
      g += `    else if (${pos} < ${N}.x) ${set(`mix(${K}.w, ${N}.y, (${pos} - ${K}.z) / max(${N}.x - ${K}.z, 1e-3))`)}\n`;
    } else g += `    else ${set(last(K))}\n`;
  }
  return g;
}

// A runway rect's surface height at u metres along from its centre (as profileAt).
export function rectElev(r, u) {
  let u0 = -r.halfLen, h0 = r.e0;
  if (u <= u0) return h0;
  const k = r.knots, n = k ? k.length : 0;
  for (let i = 0; i <= n; i++) {
    const u1 = i < n ? k[i][0] : r.halfLen, h1 = i < n ? k[i][1] : r.e1;
    if (u <= u1) return u1 > u0 ? h0 + ((h1 - h0) * (u - u0)) / (u1 - u0) : h1;
    u0 = u1; h0 = h1;
  }
  return r.e1;
}

// Runway rectangles (the pavement): centre, unit direction (end 0 -> end 1), half sizes,
// end elevations.
export function runwayRects(airports) {
  const out = [];
  for (const a of airports || []) {
    runwayCrossings(a);
    for (const r of a.runways || []) {
      const e0 = pavementEnd(r.ends[0]), e1 = pavementEnd(r.ends[1]);
      const len = Math.hypot(e1.x - e0.x, e1.y - e0.y) || 1;
      const dx = (e1.x - e0.x) / len, dy = (e1.y - e0.y) / len;
      const halfLen = len / 2, halfWid = (r.widthM || 45) / 2;
      const reach = halfLen + halfWid + 800;
      const kn = r.knots || [];
      if (kn.length > 2) {
        // v0.7.4: more than two bends (a runway that crosses two longer ones: Brussels's 01/19). The heightfield and
        // the terrain shader take two bends a rect (v0.1.4's rwyElev(), kept character for character), so the runway
        // comes as several rects end to end, each with two bends inside it and the next bend's height at its end:
        // together they are the same profile (profileAt()). Same rank, so the heightfield runs them in this order.
        const E0 = r.ends[0].elevM ?? a.elevM ?? 0, E1 = r.ends[1].elevM ?? a.elevM ?? 0;
        for (let i = 0, s0 = 0, h0 = E0; i < kn.length || s0 < len; i += 3) {
          const cut = kn[i + 2], s1 = cut ? cut[0] : len, h1 = cut ? cut[1] : E1, hl = (s1 - s0) / 2, sc = (s0 + s1) / 2, rch = hl + halfWid + 800;
          out.push({ icao: a.icao, runway: r, part: i / 3, cx: e0.x + dx * sc, cy: e0.y + dy * sc, dx, dy, halfLen: hl, halfWid,
            e0: h0, e1: h1, reach2: rch * rch, rank: r.rank ?? 0, knots: kn.slice(i, i + 2).map(([s, h]) => [s - sc, h]) });
          s0 = s1; h0 = h1;
          if (!cut) break;
        }
        continue;
      }
      out.push({ icao: a.icao, runway: r, cx: (e0.x + e1.x) / 2, cy: (e0.y + e1.y) / 2, dx, dy, halfLen, halfWid,
        e0: r.ends[0].elevM ?? a.elevM ?? 0, e1: r.ends[1].elevM ?? a.elevM ?? 0, reach2: reach * reach,
        rank: r.rank ?? 0, knots: (r.knots || []).map(([s, h]) => [s - halfLen, h]) });
    }
  }
  return out;
}

// Taxiways and aprons as paved ground, so the sim can taxi on them (M2). A 50 m hash grid
// per airport holds the taxiway segments (with half their width plus a 4 m margin) and the
// apron polygons that touch each cell; a lookup tests only the few items in one cell.
const PAVE_CELL = 50;
function pointInRing(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function pavedIndex(airports) {
  const out = [];
  for (const a of airports || []) {
    const cells = new Map();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (cx, cy, item) => {
      const k = cx * 100003 + cy;
      let l = cells.get(k);
      if (!l) cells.set(k, (l = []));
      if (l[l.length - 1] !== item) l.push(item);
    };
    const box = (bx0, by0, bx1, by1, item) => {
      for (let cx = Math.floor(bx0 / PAVE_CELL); cx <= Math.floor(bx1 / PAVE_CELL); cx++)
        for (let cy = Math.floor(by0 / PAVE_CELL); cy <= Math.floor(by1 / PAVE_CELL); cy++) add(cx, cy, item);
      x0 = Math.min(x0, bx0); y0 = Math.min(y0, by0); x1 = Math.max(x1, bx1); y1 = Math.max(y1, by1);
    };
    for (const t of a.taxiways || []) {
      const hw = (t.widthM || 23) / 2 + 4, pts = t.points || [];
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
        const seg = { ax, ay, bx, by, r2: hw * hw };
        box(Math.min(ax, bx) - hw, Math.min(ay, by) - hw, Math.max(ax, bx) + hw, Math.max(ay, by) + hw, seg);
      }
    }
    for (const ap of a.aprons || []) {
      const pts = ap.points || [];
      if (pts.length < 3) continue;
      const poly = { poly: pts };
      let px0 = Infinity, py0 = Infinity, px1 = -Infinity, py1 = -Infinity;
      for (const [x, y] of pts) { px0 = Math.min(px0, x); py0 = Math.min(py0, y); px1 = Math.max(px1, x); py1 = Math.max(py1, y); }
      box(px0, py0, px1, py1, poly);
    }
    // Stands: a capsule from the stop point 60 m back along the stand's heading (where a
    // pushback goes; 25 m radius), and the lead-in line, as OSM's aprons don't always reach.
    for (const st of a.stands || []) {
      const h = ((st.hdgGridDeg || 0) * Math.PI) / 180;
      const bx = st.x - Math.sin(h) * 60, by = st.y - Math.cos(h) * 60;
      box(Math.min(st.x, bx) - 25, Math.min(st.y, by) - 25, Math.max(st.x, bx) + 25, Math.max(st.y, by) + 25, { ax: st.x, ay: st.y, bx, by, r2: 625 });
      const L = st.leadIn || [];
      for (let i = 1; i < L.length; i++) {
        const [ax, ay] = L[i - 1], [cx, cy] = L[i];
        box(Math.min(ax, cx) - 15, Math.min(ay, cy) - 15, Math.max(ax, cx) + 15, Math.max(ay, cy) + 15, { ax, ay, bx: cx, by: cy, r2: 225 });
      }
    }
    if (cells.size) out.push({ icao: a.icao, x0, y0, x1, y1, cells });
  }
  return out;
}
export function onPaved(index, x, y) {
  for (let i = 0; i < index.length; i++) {
    const a = index[i];
    if (x < a.x0 || x > a.x1 || y < a.y0 || y > a.y1) continue;
    const l = a.cells.get(Math.floor(x / PAVE_CELL) * 100003 + Math.floor(y / PAVE_CELL));
    if (!l) return false;
    for (let k = 0; k < l.length; k++) {
      const it = l[k];
      if (it.poly) { if (pointInRing(x, y, it.poly)) return true; continue; }
      const vx = it.bx - it.ax, vy = it.by - it.ay, len2 = vx * vx + vy * vy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - it.ax) * vx + (y - it.ay) * vy) / len2)) : 0;
      const dx = x - (it.ax + vx * t), dy = y - (it.ay + vy * t);
      if (dx * dx + dy * dy <= it.r2) return true;
    }
    return false;
  }
  return false;
}

// v0.6.2: runway ends with no straight-in approach, only a circle to land from the approach to the other end. Gimhae's
// 18L and 18R (Korea's AIP, RKPK AD 2: its ILS is on 36L and 36R; 18L and 18R are the circling ends): the 3° path
// from 15 nm out runs into the hills north of the field (18R's 46 m under the ground 4.8 nm out, 18L's 20 m at 4.5 nm). No final start, Skip to
// final or 15 nm final line is offered for them (createAirports marks the ends `circling`); tests/v062-finals.test.mjs
// checks every other end's straight-in final clears the terrain.
// v0.6.4: Wonsan's 33L and 33R too. A ridge stands south-south-east of the bay under their straight-in paths (33L's
// 17 m under the ground 11.5 nm out, 33R's only 49 m clear at 9.9 nm; no approach to either is published anywhere
// open, [EST]): they are flown by a circle from the approach to 15R, over the sea.
// v0.7.3: Innsbruck's 08. Its straight 3° line from 15 nm meets the mountains 4.8 nm out (1,044 m under the ground at
// 8.3 nm; clear by 60 m only inside 4.6 nm), and Austro Control's AD 2.22 publishes no straight-in instrument final to
// it: 08 is reached from the approach to 26 "on to a right-hand traffic circuit to RWY 08", or by a visual segment. 26's
// line is clear for the whole 15 nm (lowest 119 m over the ground, 1 nm out).
// v0.7.5: Itami's 14R and 14L. Their straight 3° lines from 15 nm come over the Hokusetsu hills north-west of the field
// (14R 33 m over the ground 4.7 nm out, 14L 47 m at 4.3 nm: under the 60 m the game asks), and AIP Japan gives them no
// straight-in approach: RJOO AD 2.21 1.5 "For circling approach to Runway 14 ...", AD 2.22 "JET circling to West
// only". They are flown by a circle from the approach to 32L, over the city. 32L and 32R clear by 119 m and 117 m.
export const CIRCLING_ONLY = { RKPK: ['18L', '18R'], ZKWS: ['33L', '33R'], LOWI: ['08'], RJOO: ['14R', '14L'] };
export const circlingOnly = (icao, ident) => !!CIRCLING_ONLY[icao]?.includes(String(ident).toUpperCase());
// The end a circling-only end is circled from (v0.6.4, the review): its runway's other end when that one has an
// ILS (Gimhae's 18L from 36R), else the airport's first end with an ILS that isn't circling-only itself (Wonsan's
// 33R: its own other end, 15L, is unlit, so 15R), else the other end.
export function circleFrom(airport, ident) {
  const rws = airport?.runways || [], id = String(ident).toUpperCase();
  const rw = rws.find((r) => r.ends.some((e) => String(e.ident).toUpperCase() === id));
  const other = rw?.ends.find((e) => String(e.ident).toUpperCase() !== id) || null;
  const usable = (e) => !!e && !!e.ils && !circlingOnly(airport.icao, e.ident);
  if (usable(other)) return other;
  for (const r of rws) for (const e of r.ends) if (usable(e)) return e;
  return other;
}

// v0.7.0: runway ends used one way, from each AIP (briefs/V0-7-0.md's pitfall), as CIRCLING_ONLY is a table:
//   'takeoff'  departures only in the AIP;
//   'landing'  arrivals only in the AIP;
//   'closed'   neither (the other end of a one-way runway);
//   (v0.7.0 to v0.7.4 hid these ends from the lists they weren't used for; since v0.7.5 they are offered last, with a note)
//   'standby'  usable both ways but only when the main runway is shut: listed last, never picked by default.
// Frankfurt (AIP Germany, EDDF AD 2.13, read 2026-11-21: 07L/25R's TORA is "-", landings only; 18 has no LDA and
// there is no row for 36: take-offs only, southward, and 36 never used). Madrid (AIP Spain, LEMD AD 2.12, read
// 2026-11-21: 32R, 32L, 18L and 18R "not available for take-off"; 14L, 14R, 36R and 36L "not available for landing":
// arrivals 32 and departures 36 in the north configuration, arrivals 18 and departures 14 in the south). Gatwick (UK
// AIP, EGKK AD 2.20, read 2026-11-21: "Runway 08L/26R is a non-instrument runway and will only be used when Runway
// 08R/26L is temporarily non-operational due to maintenance or incident"; "not available on request by pilots").
// Orly (AIP France, LFPO AD 2.21, read 2026-11-21: "The RWY 02/20 is exceptionally used in case of: unavailability of
// a main runway ...; strong Northbound or Southbound winds": a standby here. Its main runways have a preferred
// direction each (west: take-offs 24, landings 25; east: take-offs 07, landings 06) but an ILS at all four ends, so
// they stay both ways).
export const ONE_WAY = {
  EDDF: { 18: 'takeoff', 36: 'closed', '07L': 'landing', '25R': 'landing' },
  LEMD: { '32R': 'landing', '32L': 'landing', '18L': 'landing', '18R': 'landing', '14L': 'takeoff', '14R': 'takeoff', '36L': 'takeoff', '36R': 'takeoff' },
  EGKK: { '08L': 'standby', '26R': 'standby' },
  LFPO: { '02': 'standby', 20: 'standby' },
  // Barcelona (AIP Spain, LEBL AD 2.12 remark 1, read 2026-11-21: 20 "Not available for landing").
  LEBL: { 20: 'takeoff' },
  // Schiphol, [EST]: the Dutch eAIP couldn't be read in this run (it answers automated readers with a challenge).
  // From general knowledge of its published use: 18R/36L (the Polderbaan) is landed on southward and taken off from
  // northward only; 18L/36R (the Aalsmeerbaan) is taken off from southward and landed on northward only.
  EHAM: { '18R': 'landing', '36L': 'takeoff', '18L': 'takeoff', '36R': 'landing' },
  // (v0.7.1 to v0.7.3 had Brussels's 19 here as landing-only, the game's own limit: runwayCrossings() shaped one
  // crossing a runway, and 01/19 crosses two. v0.7.4 shapes both, so 01/19 is used both ways.)
  // v0.7.3, Hamburg (Germany's AIP, EDDH AD 2.20 2.2, read 2026-11-21: "Take-offs from RWY 15 and landings on RWY 33 are
  // permitted only if required for reasons of air traffic safety"; 33 has no ILS).
  EDDH: { 15: 'landing', 33: 'takeoff' },
  // v0.7.3, Venice, [EST]: Italy's eAIP asks for a login. From general knowledge of its use: 04L/22R, 180 m beside the main
  // runway, serves as its taxiway and is a runway only when 04R/22L is closed.
  LIPZ: { '04L': 'standby', '22R': 'standby' },
  // v0.7.5, Cheongju (Korea's eAIP, RKTU AD 2.20 1.3: "It is mandatory for all airliners to use RWY 06L/24R except for
  // emergency situations. Usage of RWY 06R/24L for airliners are also allowed when RWY 06L/24R is closed due to RWY
  // maintenance ..."): the air force's runway is a standby here, offered after the civil one and never the default.
  RKTU: { '06R': 'standby', '24L': 'standby' },
};
export const runwayUse = (icao, ident) => ONE_WAY[icao]?.[String(ident).toUpperCase()] || null;
// v0.7.5 (Shane, 2026-11-22, of Barcelona's 20 missing from the map's Change the route: "I can't select all the
// runways for landing"): the table no longer hides an end. Every end is offered for a take-off and for a landing in
// every list, with a final and Skip to final if it isn't circling-only; the AIP's use stays as the default and as a
// note. aipTakesOff() and aipLands() say what the AIP uses an end for (v0.7.0's canTakeOff() and canLand(), which
// filtered the lists); useRank() orders a list: the ends the AIP uses that way, then a standby runway's, then the
// ends it doesn't use that way (`what`: 'dep' or 'arr').
export const aipTakesOff = (icao, ident) => { const u = runwayUse(icao, ident); return u !== 'landing' && u !== 'closed'; };
export const aipLands = (icao, ident) => { const u = runwayUse(icao, ident); return u !== 'takeoff' && u !== 'closed'; };
export const useRank = (icao, ident, what) => {
  const u = runwayUse(icao, ident);
  if (u === 'standby') return 1;
  return (what === 'dep' ? aipTakesOff(icao, ident) : what === 'arr' ? aipLands(icao, ident) : u !== 'closed') ? 0 : 2;
};
const USE_NOTE = { takeoff: 'take-offs only in the AIP', landing: 'landings only in the AIP', closed: 'not in use in the AIP', standby: 'standby' };
export const runwayUseNote = (icao, ident) => USE_NOTE[runwayUse(icao, ident)] || '';

// Normalise and index a list of airport JSONs.
export function createAirports(list, opts = {}) {
  const airports = list || [];
  for (const a of airports) if (ONE_WAY[a.icao]) for (const r of a.runways || []) for (const e of r.ends) { const u = runwayUse(a.icao, e.ident); if (u) e.use = u; }   // (v0.7.0 cleared the ILS of an end the AIP doesn't land on; v0.7.5 offers every end and shows the file's ILS: none of those ends has one in its file)
  for (const a of airports) for (const r of a.runways || []) for (const e of r.ends) if (circlingOnly(a.icao, e.ident)) { e.circling = true; e.ils = null; }   // (v0.6.4: no ILS shown or tuned to an end with no straight-in path: Wonsan 33L's was an estimate; Gimhae's two have none)
  const rects = runwayRects(airports);
  const byIcao = new Map(airports.map((a) => [a.icao, a]));
  let hf = opts.heightfield || null;

  function findRunwayEnd(icao, ident) {
    const a = byIcao.get(icao);
    if (!a) return null;
    for (const r of a.runways) {
      for (let k = 0; k < 2; k++) {
        const e = r.ends[k];
        if (String(e.ident).toUpperCase() !== String(ident).toUpperCase()) continue;
        const o = r.ends[1 - k];
        const pe = pavementEnd(e), po = pavementEnd(o);
        const len = Math.hypot(po.x - pe.x, po.y - pe.y);
        const ux = (po.x - pe.x) / len, uy = (po.y - pe.y) / len;
        const disp = Math.hypot(e.x - pe.x, e.y - pe.y);
        const hdgGrid = Math.atan2(ux, uy);
        return {
          icao, ident: e.ident, airport: a, runway: r, end: e, opposite: o,
          x: pe.x, y: pe.y,                                 // physical end of the pavement
          thrX: e.x, thrY: e.y,                             // landing threshold
          ux, uy,                                           // unit vector down the runway
          hdgGrid: (hdgGrid + 2 * Math.PI) % (2 * Math.PI), // rad, grid
          hdgGridDeg: ((hdgGrid / DEG) + 360) % 360,
          hdgTrueDeg: e.hdgTrueDeg,
          elevM: e.elevM ?? a.elevM ?? 0,
          lengthM: len, widthM: r.widthM, displacedM: disp,
          ldaM: len - disp,
          circling: !!e.circling,                           // v0.6.2: no straight-in approach (CIRCLING_ONLY)
          use: e.use || null,                               // v0.7.0: 'takeoff' | 'landing' | 'closed' | 'standby' (ONE_WAY)
        };
      }
    }
    return null;
  }

  // The runway under (x, y), or null. Includes 1.5 m of paved shoulder each side.
  function onRunway(x, y) {
    for (let k = 0; k < rects.length; k++) {
      const r = rects[k];
      const dx = x - r.cx, dy = y - r.cy;
      if (dx * dx + dy * dy > r.reach2) continue;
      const u = dx * r.dx + dy * r.dy, v = -dx * r.dy + dy * r.dx;
      if (Math.abs(u) <= r.halfLen && Math.abs(v) <= r.halfWid + 1.5) return r.runway;
    }
    return null;
  }

  let paved = pavedIndex(airports);
  // 'runway' means any paved surface to the sim: runways, taxiways, aprons and stands.
  function groundKind(x, y) {
    if (onRunway(x, y) || onPaved(paved, x, y)) return 'runway';
    if (hf && hf.waterAt(x, y)) return 'water';
    return 'ground';
  }

  return { airports, rects, findRunwayEnd, onRunway, groundKind, onPaved: (x, y) => onPaved(paved, x, y),
    rebuildPaved() { paved = pavedIndex(airports); }, // after stand headings change
    setHeightfield(h) { hf = h; } };
}

// Fetch data/manifest.json's airports; any that are missing come from the fallback table.
export async function loadAirports(baseUrl, opts = {}) {
  let b = baseUrl || 'data/';
  if (!b.endsWith('/')) b += '/';
  const here = (typeof location !== 'undefined') ? location.href : 'file:///';
  const base = new URL(b, here).href;
  const get = async (rel) => {
    try { const r = await fetch(new URL(rel, base).href); return r.ok ? await r.json() : null; } catch (e) { return null; }
  };
  const manifest = (await get('manifest.json')) || {};
  // v0.6.0: Korea's three, and the region's (region.js's terrainSpec()).
  const loaded = (await Promise.all(terrainSpec(manifest).airports.map(get))).filter((a) => a && a.runways && a.runways.length);
  const have = new Set(loaded.map((a) => a.icao));
  // (v0.7.0: the fallback is Korea's three, so only in East Asia: found in Chrome, where Europe's lists showed Gimpo, Jeju and Incheon under "Elsewhere".)
  const list = loaded.concat(REGION_ID === 'east-asia' ? fallbackAirports().filter((a) => !have.has(a.icao)) : []);
  return createAirports(list, opts);
}

// Geographic helper for the screens: an airport's lat/lon from its map origin.
export const airportGeo = (a) => (a.lat != null ? [a.lat, a.lon] : toGeo(a.origin[0], a.origin[1]));
