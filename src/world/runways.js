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

// Ranks, knots and cuts for an airport's runways (once; the airport keeps them). A runway
// bends to one longer runway at most: a second crossing is left as it was, with a warning.
export function runwayCrossings(airport) {
  const rws = (airport?.runways || []).filter((r) => r.ends && r.ends.length === 2);
  if (!rws.length || rws.every((r) => r.rank !== undefined)) return;
  const elev = airport.elevM ?? 0;
  const ax = new Map(rws.map((r) => [r, runwayAxis(r, elev)]));
  const order = rws.slice().sort((p, q) => (ax.get(p).len - ax.get(q).len) || ((p.widthM || 45) - (q.widthM || 45))
    || String(p.id).localeCompare(String(q.id)));
  order.forEach((r, i) => { r.rank = i; r.knots = []; r.cutBy = []; });
  for (const S of order.slice().reverse()) {      // the longer ones first: their profiles are final
    for (const P of order) {
      if (P.rank <= S.rank) continue;
      const a = ax.get(S), b = ax.get(P);
      const den = a.ux * b.uy - a.uy * b.ux;      // the sine of the angle between them
      if (Math.abs(den) < 0.05) continue;         // parallel
      const dx = b.p0.x - a.p0.x, dy = b.p0.y - a.p0.y;
      const sS = (dx * b.uy - dy * b.ux) / den, sP = (dx * a.uy - dy * a.ux) / den;
      if (sS < 0 || sS > a.len || sP < 0 || sP > b.len) continue;   // the centrelines don't cross on both
      if (S.cutBy.length) { console.warn(`Runway ${S.id} crosses more than one longer runway; only ${S.cutBy[0].id} is handled`); continue; }
      const d = ((P.widthM || 45) / 2 + RUNWAY_SHOULDER_M) / Math.abs(den);   // along S, crossing to P's drawn edge
      const onP = (s) => { const x = a.p0.x + a.ux * s, y = a.p0.y + a.uy * s; return profileAt(P, (x - b.p0.x) * b.ux + (y - b.p0.y) * b.uy, elev); };
      for (const s of [sS - d, sS + d]) if (s > 1 && s < a.len - 1) S.knots.push([s, onP(s)]);
      S.cutBy.push(P);
    }
  }
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

// Normalise and index a list of airport JSONs.
export function createAirports(list, opts = {}) {
  const airports = list || [];
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
  const loaded = (await Promise.all((manifest.airports || []).map(get))).filter((a) => a && a.runways && a.runways.length);
  const have = new Set(loaded.map((a) => a.icao));
  const list = loaded.concat(fallbackAirports().filter((a) => !have.has(a.icao)));
  return createAirports(list, opts);
}

// Geographic helper for the screens: an airport's lat/lon from its map origin.
export const airportGeo = (a) => (a.lat != null ? [a.lat, a.lon] : toGeo(a.origin[0], a.origin[1]));
