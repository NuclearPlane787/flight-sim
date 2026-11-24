// v0.7.9 (map), part 2 (Shane: "having taxiways and an appropriate 'minimum' level of detail to fully see the airport
// on the map would be better"): an airport's ground on the path map, as it zooms in. Built once an airport, the first
// time it is drawn close enough, in map metres relative to the airport's origin, and kept (a WeakMap on the airport):
//   - the aprons and the taxiways as pavement at their widths (Path2D, one for the aprons, one a width for the
//     taxiways, the same paths stroked thin for their centrelines);
//   - the hold-short bars (apron-geom.js holdShortSites(), the sites the 3D world paints: each mapped holding
//     position, and a synthetic one where a taxiway crosses 90 m from a runway's centreline);
//   - the named taxiways' lines (for their names) and the stands (for their numbers).
// Laying out the names is map.js's (by view); this module also places names along polylines without overlaps
// (placeAlong()), pure, so node can test it.
import { holdShortSites } from '../world/apron-geom.js';

// The layers by zoom, in metres a pixel (map.js draws a layer when 1/k is at most its value).
export const GROUND_MPP = {
  pave: 40,        // the aprons and taxiways (a 23 m taxiway is about half a pixel: drawn at least 1 px wide)
  centre: 4,       // the taxiways' yellow centrelines
  holds: 9,        // the runways' hold-short bars (pattern A)
  holdsB: 3.5,     // the intermediate holding positions (pattern B: Heathrow maps about 300 of them, dots further out)
  taxi: 60,        // the assigned taxi route (further out it is under a pixel or two, beside the airport's dot)
  names: 9,        // the taxiways' names
  rwyNums: 5,      // the runways' numbers painted at their ends
  stands: 2.6,     // the stands' numbers
};
export const GROUND = {
  pave: '#4a525d',                     // the pavement (the runways' #d8d8d8 stays the brightest grey)
  centre: 'rgba(240,206,60,0.62)',     // the taxiways' centrelines
  hold: '#ffd23a',                     // the hold-short bars
  nameBox: 'rgba(12,14,18,0.9)', nameText: '#ffd23a', nameEdge: 'rgba(255,210,58,0.75)',   // a location sign's colours
  standText: 'rgba(236,240,246,0.95)', standDot: 'rgba(236,240,246,0.7)',
  rwyNum: 'rgba(16,22,32,0.92)',
};
export const NAME_SPACING_PX = 240;    // one name a taxiway every so many screen pixels along it

const cache = new WeakMap();
const P2D = () => (typeof Path2D !== 'undefined' ? new Path2D() : null);

// The airport's shapes (null if it has none or Path2D is missing).
export function groundShapes(apt) {
  let s = cache.get(apt);
  if (s !== undefined) return s;
  s = build(apt);
  cache.set(apt, s);
  return s;
}

function build(apt) {
  if (typeof Path2D === 'undefined') return null;
  const tws = apt.taxiways || [], aps = apt.aprons || [];
  if (!tws.length && !aps.length) return null;
  const o = apt.origin || [apt.runways?.[0]?.ends[0].x || 0, apt.runways?.[0]?.ends[0].y || 0];
  const ox = o[0], oy = o[1];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  const aprons = P2D();
  for (const a of aps) {
    const pts = a.points || a;
    if (!pts || pts.length < 3) continue;
    pts.forEach(([x, y], i) => { grow(x, y); i ? aprons.lineTo(x - ox, y - oy) : aprons.moveTo(x - ox, y - oy); });
    aprons.closePath();
  }
  const byW = new Map(), names = [];
  for (const t of tws) {
    const pts = t.points;
    if (!pts || pts.length < 2) continue;
    const w = t.widthM || 23;
    let p = byW.get(w); if (!p) { p = P2D(); byW.set(w, p); }
    pts.forEach(([x, y], i) => { grow(x, y); i ? p.lineTo(x - ox, y - oy) : p.moveTo(x - ox, y - oy); });
    if (t.ref) names.push({ ref: String(t.ref), pts });
  }
  for (const rw of apt.runways || []) for (const e of rw.ends) grow(e.x, e.y);
  const taxi = [...byW.entries()].sort((a, b) => b[0] - a[0]).map(([w, path]) => ({ w, path }));
  // the hold-short bars: a line across the taxiway at each site, the runway's pattern solid, an intermediate one dashed
  const holdsA = P2D(), holdsB = P2D();
  let nA = 0, nB = 0;
  for (const h of holdShortSites(apt)) {
    const half = (h.w || 23) / 2, px = -h.dy * half, py = h.dx * half;
    const p = h.pattern === 'B' ? holdsB : holdsA;
    p.moveTo(h.x - px - ox, h.y - py - oy); p.lineTo(h.x + px - ox, h.y + py - oy);
    if (h.pattern === 'B') nB++; else nA++;
  }
  const stands = (apt.stands || []).filter((s) => s.ref && Number.isFinite(s.x) && Number.isFinite(s.y)).map((s) => ({ ref: String(s.ref), x: s.x, y: s.y }));
  return { ox, oy, box: { x0, y0, x1, y1 }, aprons, taxi, holdsA: nA ? holdsA : null, holdsB: nB ? holdsB : null, names, stands, holds: nA + nB };
}

// Names along polylines, in screen pixels, with no two overlapping and none on a box in `taken`:
//   lines: [{ text, pts: [[x, y] map m] }], toScreen(x, y, out), measure(text) -> px wide, h: the box's height,
//   spacing: px along a line between its names (the first half that in), view: { x0, y0, x1, y1 } on the screen.
// The same text isn't placed again within `spacing` px of itself (OSM splits a taxiway into many ways).
// Returns [{ text, x, y, box }] (x, y the name's centre). `taken` is added to.
export function placeAlong(lines, { toScreen, measure, h = 15, spacing = NAME_SPACING_PX, view, taken = [], pad = 8 }) {
  const out = [], seen = new Map(), P = [0, 0], Q = [0, 0];
  const free = (b) => {
    for (const q of taken) if (!(b.x1 < q.x0 || b.x0 > q.x1 || b.y1 < q.y0 || b.y0 > q.y1)) return false;
    return true;
  };
  for (const L of lines) {
    const pts = L.pts;
    if (!pts || pts.length < 2) continue;
    // (a way shorter than the spacing gets one try, at its middle: OSM cuts a taxiway into short ways at its junctions)
    let total = 0;
    toScreen(pts[0][0], pts[0][1], P);
    for (let i = 1; i < pts.length; i++) { toScreen(pts[i][0], pts[i][1], Q); total += Math.hypot(Q[0] - P[0], Q[1] - P[1]); P[0] = Q[0]; P[1] = Q[1]; }
    if (total < 20) continue;
    let w = -1, next = Math.min(spacing / 2, total / 2);
    let run = 0;
    toScreen(pts[0][0], pts[0][1], P);
    for (let i = 1; i < pts.length; i++) {
      toScreen(pts[i][0], pts[i][1], Q);
      const dx = Q[0] - P[0], dy = Q[1] - P[1], seg = Math.hypot(dx, dy);
      while (seg > 0 && run + seg >= next) {
        const f = (next - run) / seg, x = P[0] + dx * f, y = P[1] + dy * f;
        next += spacing;
        if (x < view.x0 + pad || x > view.x1 - pad || y < view.y0 + pad || y > view.y1 - pad) continue;
        const near = seen.get(L.text);
        if (near && near.some(([sx, sy]) => Math.hypot(sx - x, sy - y) < spacing)) continue;
        if (w < 0) w = measure(L.text) + 8;
        const b = { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
        if (!free(b)) continue;
        taken.push(b); out.push({ text: L.text, x, y, box: b });
        if (near) near.push([x, y]); else seen.set(L.text, [[x, y]]);
      }
      run += seg; P[0] = Q[0]; P[1] = Q[1];
    }
  }
  return out;
}

// Labels at points (the stands' numbers): each where it is, if it overlaps nothing placed. Returns [{ text, x, y }].
export function placeAt(items, { toScreen, measure, h = 12, view, taken = [] }) {
  const out = [], P = [0, 0];
  for (const it of items) {
    toScreen(it.x, it.y, P);
    const x = P[0], y = P[1];
    if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
    const w = measure(it.text) + 4;
    const b = { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
    let ok = true;
    for (const q of taken) if (!(b.x1 < q.x0 || b.x0 > q.x1 || b.y1 < q.y0 || b.y0 > q.y1)) { ok = false; break; }
    if (!ok) continue;
    taken.push(b); out.push({ text: it.text, x, y });
  }
  return out;
}
