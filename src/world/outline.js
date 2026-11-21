// A region's outline in map metres (v0.7.0): the edge of its 1 km land, of the path map, and where a
// predicted path ends. East Asia's is its rectangle (regions.js's `extent`); Europe's is a polygon given in
// latitude and longitude, its edges straight in those, densified every 0.25 degrees and projected here
// (Shane, 2026-11-20: "we don't have to keep every region a perfect rectangle"). Pure: no DOM; the page,
// the prediction worker and node all get the same doubles.
import { REGION } from './regions.js';
import { toMap } from './frame.js';

const STEP_DEG = 0.25;

function densify(geo) {
  const out = [];
  for (let k = 0; k < geo.length; k++) {
    const [la0, lo0] = geo[k], [la1, lo1] = geo[(k + 1) % geo.length];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(la1 - la0), Math.abs(lo1 - lo0)) / STEP_DEG));
    for (let i = 0; i < n; i++) out.push(toMap(la0 + ((la1 - la0) * i) / n, lo0 + ((lo1 - lo0) * i) / n));
  }
  return out;
}

// The outline as [[x, y], ...] (closed: the last point joins the first), and its bounding rectangle.
function build(region) {
  if (!region.outlineGeo) {
    const e = region.extent;
    return { poly: [[e.x0, e.y0], [e.x1, e.y0], [e.x1, e.y1], [e.x0, e.y1]], extent: { x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1 }, rect: true };
  }
  const poly = densify(region.outlineGeo);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  // The rectangle is rounded out to whole kilometres, so it reads the same in the bake and here.
  return { poly, extent: { x0: Math.floor(x0 / 1000) * 1000, y0: Math.floor(y0 / 1000) * 1000, x1: Math.ceil(x1 / 1000) * 1000, y1: Math.ceil(y1 / 1000) * 1000 }, rect: false };
}

const O = build(REGION);
// Flat copies for the point test (no garbage a call).
const N = O.poly.length, PX = new Float64Array(N), PY = new Float64Array(N);
O.poly.forEach(([x, y], i) => { PX[i] = x; PY[i] = y; });

export const regionOutline = () => O.poly;
export const regionExtent = () => O.extent;
export const outlineIsRect = () => O.rect;

// Is the map point inside the region? East Asia: inside its rectangle, edges included (the test the code made
// before v0.7.0: x0 <= x <= x1 and y0 <= y <= y1). A polygon region: inside the polygon (even-odd).
export function insideRegion(x, y) {
  const e = O.extent;
  if (x < e.x0 || x > e.x1 || y < e.y0 || y > e.y1) return false;
  if (O.rect) return true;
  let inside = false;
  for (let i = 0, j = N - 1; i < N; j = i++) {
    if ((PY[i] > y) !== (PY[j] > y) && x < ((PX[j] - PX[i]) * (y - PY[i])) / (PY[j] - PY[i]) + PX[i]) inside = !inside;
  }
  return inside;
}

// How far inside the outline a point is (m; negative outside): the distance to the nearest edge, signed.
// For a margin test ("within 20 km of the map's edge"). O(N): not for every frame's every point.
export function insideBy(x, y) {
  let best = Infinity;
  for (let i = 0, j = N - 1; i < N; j = i++) {
    const ax = PX[j], ay = PY[j], dx = PX[i] - ax, dy = PY[i] - ay, L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
    if (d < best) best = d;
  }
  return insideRegion(x, y) ? best : -best;
}
