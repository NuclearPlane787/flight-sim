// Shared helpers for the screens: colours, units, HiDPI canvases, airport lookup,
// the route (waypoints) shared by the map and the ND, coastline levels of detail,
// and the raw ILS-style deviations. DOM only where a function says so.

import { gridToMag, magToGrid } from '../world/frame.js';

export const DEG = Math.PI / 180;
export const KT = 1 / 0.514444;   // m/s -> kt
export const FT = 1 / 0.3048;     // m -> ft
export const FPM = FT * 60;       // m/s -> ft/min
export const NM = 1852;           // m per nm

// Airbus display colours.
export const C = {
  green: '#3cff4e', cyan: '#2fe3ff', magenta: '#ff4cf2', amber: '#ffa515',
  white: '#f2f2f2', red: '#ff2b2b', yellow: '#ffe838', grey: '#8a9097',
  sky: '#1876c9', ground: '#7a4a24', bg: 'rgba(4,6,8,0.86)',
  frame: '#4b5157', dim: '#5d6c78',
};
export const FONT = 'B612, "Helvetica Neue", Arial, sans-serif';   // vendor/fonts (style.css); main.js loads it before the first draw
export const font = (px, bold = false) => `${bold ? '600 ' : ''}${Math.round(px * 10) / 10}px ${FONT}`;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const wrap360 = (d) => ((d % 360) + 360) % 360;
export const angDiff = (a, b) => ((a - b + 540) % 360) - 180; // a - b in -180..180, degrees

// Magnetic heading (deg) from a grid heading (rad) at a map point.
export const magDeg = (hdgGrid, x, y) => wrap360(gridToMag(hdgGrid, x, y) / DEG);
export const magToGridRad = (deg, x, y) => magToGrid(deg * DEG, x, y);

// A canvas sized in CSS pixels, drawn at devicePixelRatio. Returns { canvas, ctx, w, h, size(w, h) }.
export function hidpiCanvas(parent, cls) {
  const canvas = document.createElement('canvas');
  if (cls) canvas.className = cls;
  parent.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const o = { canvas, ctx, w: 0, h: 0 };
  o.size = (w, h) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (w === o.w && h === o.h && o.dpr === dpr) return false;
    o.w = w; o.h = h; o.dpr = dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    return true;
  };
  o.begin = () => { ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0); ctx.clearRect(0, 0, o.w, o.h); };
  return o;
}

// Stop pointer and wheel events on the screens from reaching the camera handlers.
export function shield(el, { wheel = true } = {}) {
  for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'touchstart']) {
    el.addEventListener(t, (e) => e.stopPropagation());
  }
  if (wheel) el.addEventListener('wheel', (e) => { e.stopPropagation(); e.preventDefault(); }, { passive: false });
}

// Accept the airports as an array, an object keyed by ICAO, or loadAirports()'s result.
export function airportList(a) {
  if (!a) return [];
  if (Array.isArray(a)) return a;
  if (Array.isArray(a.airports)) return a.airports;
  if (a.airports && typeof a.airports === 'object') return Object.values(a.airports);
  return Object.values(a).filter((v) => v && v.icao);
}

// Find a runway end by airport and ident; returns { airport, runway, end, other } or null.
export function findEnd(airports, icao, ident) {
  for (const ap of airportList(airports)) {
    if (icao && ap.icao !== icao) continue;
    for (const rw of ap.runways || []) {
      const i = rw.ends.findIndex((e) => e.ident === ident);
      if (i >= 0) return { airport: ap, runway: rw, end: rw.ends[i], other: rw.ends[1 - i] };
    }
  }
  return null;
}

// Locate an end object (as passed in view.dest) among the airports.
export function locateEnd(airports, end) {
  if (!end) return null;
  for (const ap of airportList(airports)) {
    for (const rw of ap.runways || []) {
      const i = rw.ends.indexOf(end);
      const j = i >= 0 ? i : rw.ends.findIndex((e) => e.ident === end.ident && Math.hypot(e.x - end.x, e.y - end.y) < 50);
      if (j >= 0) return { airport: ap, runway: rw, end: rw.ends[j], other: rw.ends[1 - j] };
    }
  }
  return { airport: null, runway: null, end, other: null };
}

// Landing threshold of a runway end (map metres). The airport data already puts an end's
// x, y at the landing threshold, past any displaced part (pavementEnd is the physical end);
// until v0.1.3 this added the displacement again, which put Jeju 31's glideslope, localizer
// and route end 411 m too far down the runway.
export function thresholdOf(end) {
  return [end.x, end.y];
}

// The route shared by the map (which edits it) and the ND (which draws it).
// Waypoints are [x, y] map metres. view.waypoints, when given, wins over this.
export const route = { waypoints: [], version: 0 };
export function setWaypoints(list) { route.waypoints = (list || []).map((p) => [p[0], p[1]]); route.version++; }

// Raw ILS-style deviations for a runway end, from its geometry.
// Glideslope: 3° from a point 300 m past the threshold. Localizer: angle from the far
// end of the runway (where a real antenna sits). Airbus scales: LOC 1 dot = 0.8°,
// G/S 1 dot = 0.4°, two dots each side. Shown only in front of the runway within ±35°.
export function ilsDeviation(state, endInfo) {
  if (!endInfo || !endInfo.end || !state) return null;
  const end = endInfo.end;
  const h = (end.hdgGridDeg ?? 0) * DEG;
  const ux = Math.sin(h), uy = Math.cos(h);           // landing direction (grid)
  const [tx, ty] = thresholdOf(end);
  const len = endInfo.runway?.lengthM || (endInfo.other ? Math.hypot(endInfo.other.x - end.x, endInfo.other.y - end.y) : 3000);
  const px = state.pos.x, py = state.pos.y;
  // Along-track distance before the threshold (positive on the approach side).
  const before = -((px - tx) * ux + (py - ty) * uy);
  const cross = (px - tx) * uy - (py - ty) * ux;        // + = right of the centreline, looking along the landing direction
  // Localizer: from the far end.
  const lx = end.x + ux * len, ly = end.y + uy * len;
  const dAnt = -((px - lx) * ux + (py - ly) * uy);
  const locDeg = Math.atan2(cross, Math.max(1, dAnt)) / DEG;   // + = aircraft right of course
  // Bearing from the threshold to the aircraft against the approach course.
  const offDeg = Math.abs(Math.atan2(cross, before) / DEG);
  const visible = before > -200 && offDeg <= 35 && before < 30 * NM;
  const elev = end.elevM ?? endInfo.airport?.elevM ?? 0;
  const gx = tx + ux * 300, gy = ty + uy * 300;
  const dGs = -((px - gx) * ux + (py - gy) * uy);
  const gsDeg = Math.atan2((state.pos.z - elev), Math.max(1, dGs)) / DEG - 3; // + = above the path
  const courseMag = wrap360(gridToMag(h, end.x, end.y) / DEG);
  return {
    visible,
    locDots: -locDeg / 0.8,       // + = the diamond sits right (fly right)
    gsDots: gsDeg / 0.4,          // + = the diamond sits below centre (aircraft above the path)
    aboveDeg: gsDeg,
    courseMag,
    distNm: Math.hypot(px - tx, py - ty) / NM,
    ident: end.ident,
    icao: endInfo.airport?.icao || '',
  };
}

// Douglas-Peucker on a closed or open ring of [x, y]. Tolerance in map metres.
function simplify(pts, tol) {
  if (pts.length < 4) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1e-9;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i];
      let t = ((x - ax) * dx + (y - ay) * dy) / L;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + t * dx - x, ey = ay + t * dy - y, d = ex * ex + ey * ey;
      if (d > best) { best = d; bi = i; }
    }
    if (best > t2 && bi > 0) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

// Coastline with levels of detail: rings as Float64Arrays plus bounding boxes,
// at tolerances 0, 400 m, 1.5 km and 6 km. Pick with lod(metresPerPixel).
const TOLS = [0, 400, 1500, 6000];
// The HUD (both NDs), the path map and the setup each build the same file: built once (v0.6.0).
const built = new WeakMap();
export function buildCoast(coast) {
  if (coast && typeof coast === 'object') {
    let b = built.get(coast);
    if (!b) { b = coast.v === 2 ? buildRegionCoast(coast) : buildKoreaCoast(coast); built.set(coast, b); }
    return b;
  }
  return buildKoreaCoast(coast);
}
function buildKoreaCoast(coast, tols = TOLS) {
  const prep = (rings) => (rings || []).map((r) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const levels = tols.map((t) => {
      const s = t ? simplify(r, t) : r;
      const f = new Float64Array(s.length * 2);
      s.forEach((p, i) => { f[2 * i] = p[0]; f[2 * i + 1] = p[1]; });
      return f;
    });
    return { x0, y0, x1, y1, size: Math.max(x1 - x0, y1 - y0), levels };
  });
  return {
    land: prep(coast?.land), water: prep(coast?.water),
    // Detail level for a scale: aim for vertices about 2 px apart or more.
    lod(mPerPx) { const want = mPerPx * 1.5; let l = 0; for (let i = 0; i < TOLS.length; i++) if (TOLS[i] <= want) l = i; return l; },
  };
}

// Trace the rings that touch a box into the current path, with a transform fn(x, y) -> [sx, sy].
export function traceRings(ctx, rings, lod, box, tf, minSize = 0) {
  const p = [0, 0];
  for (const r of rings) {
    if (r.x1 < box.x0 || r.x0 > box.x1 || r.y1 < box.y0 || r.y0 > box.y1 || r.size < minSize) continue;
    const f = r.levels[lod];
    if (f.length < 6) continue;
    tf(f[0], f[1], p); ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < f.length; i += 2) { tf(f[i], f[i + 1], p); ctx.lineTo(p[0], p[1]); }
    ctx.closePath();
  }
}

// ---- v0.6.0: the region's coast (data/coast-region.json, tools/bake_region_coast.py) ----
// Six levels baked at 80 m, 200 m, 400 m, 800 m, 1.5 km and 6 km, each cut into square cells
// (64, 64, 128, 128 and 256 km; the last whole) so a frame traces only the cells in its box and
// never all of Honshu. The pieces are exact cuts: the land fills even-odd without seams (traceLand), and the
// coastline is every edge of a piece except those on its cell's edge (traceCoastLines).
// `land` keeps traceRings() working (the setup's mini map): each piece carries only its own
// level's points, so traceRings(land, lod) draws that level alone.
const NONE = new Float64Array(0);
function buildRegionCoast(coast) {
  const [ex0, ey0, ex1, ey1] = coast.extent;
  const land = [], nl = (coast.levels || []).length;
  const levels = (coast.levels || []).map((L, li) => {
    const cell = L.cell, nx = Math.max(1, Math.ceil((ex1 - ex0) / cell)), ny = Math.max(1, Math.ceil((ey1 - ey0) / cell));
    const cells = Array.from({ length: nx * ny }, () => []);
    for (const r of L.rings) {
      const ci = r[0], cj = r[1], n = (r.length - 3) >> 1;
      if (n < 3 || ci < 0 || cj < 0 || ci >= nx || cj >= ny) continue;
      const f = new Float64Array(n * 2);
      let x = 0, y = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i++) {
        x += r[3 + 2 * i]; y += r[4 + 2 * i]; f[2 * i] = x; f[2 * i + 1] = y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      const levelsOf = new Array(nl).fill(NONE); levelsOf[li] = f;
      const ring = {
        x0, y0, x1, y1, size: r[2], levels: levelsOf, f,
        cx0: Math.max(ex0, ex0 + ci * cell), cy0: Math.max(ey0, ey0 + cj * cell),
        cx1: Math.min(ex1, ex0 + (ci + 1) * cell), cy1: Math.min(ey1, ey0 + (cj + 1) * cell),
      };
      cells[cj * nx + ci].push(ring);
      land.push(ring);
    }
    return { tol: L.tol, cell, nx, ny, cells };
  });
  const tols = levels.map((L) => L.tol);
  // The inland water, delta coded, at the same levels (simplified here, as Korea's).
  const rings = (coast.water || []).map((r) => {
    const out = []; let x = 0, y = 0;
    for (let i = 0; i + 1 < r.length; i += 2) { x += r[i]; y += r[i + 1]; out.push([x, y]); }
    return out;
  });
  const water = buildKoreaCoast({ water: rings }, tols.map((t, i) => (i ? t : 0))).water;
  return {
    region: true, extent: { x0: ex0, y0: ey0, x1: ex1, y1: ey1 }, levels, land, water,
    // As Korea's: the coarsest level whose tolerance is at most 1.5 px.
    lod(mPerPx) { const want = mPerPx * 1.5; let l = 0; for (let i = 0; i < tols.length; i++) if (tols[i] <= want) l = i; return l; },
  };
}

// The region's pieces of level `lod` in the cells under `box`, as fn(ring) calls.
function eachPiece(b, lod, box, minSize, fn) {
  const L = b.levels[Math.min(lod, b.levels.length - 1)];
  if (!L) return;
  const e = b.extent;
  const i0 = Math.max(0, Math.floor((box.x0 - e.x0) / L.cell)), i1 = Math.min(L.nx - 1, Math.floor((box.x1 - e.x0) / L.cell));
  const j0 = Math.max(0, Math.floor((box.y0 - e.y0) / L.cell)), j1 = Math.min(L.ny - 1, Math.floor((box.y1 - e.y0) / L.cell));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      for (const r of L.cells[j * L.nx + i]) {
        if (r.x1 < box.x0 || r.x0 > box.x1 || r.y1 < box.y0 || r.y0 > box.y1 || r.size < minSize) continue;
        fn(r);
      }
    }
  }
}

// The map box (AABB) of a screen rectangle round the aircraft on a heading-up display: u right and
// w up of the aircraft's symbol, in px; k px per metre; (ch, sh) the heading's cos and sin. The
// region's NDs draw only what this box holds, the part of the arc on the screen.
export function screenBox(px, py, ch, sh, k, u0, u1, w0, w1) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const u of [u0, u1]) for (const w of [w0, w1]) {
    const x = px + (u * ch + w * sh) / k, y = py + (-u * sh + w * ch) / k;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

// The land to fill (even-odd) into the current path: the region's cells in view, or Korea's rings.
export function traceLand(ctx, b, lod, box, tf, minSize = 0) {
  if (!b.region) { traceRings(ctx, b.land, lod, box, tf, minSize); return; }
  const p = [0, 0];
  eachPiece(b, lod, box, minSize, (r) => {
    const f = r.f;
    tf(f[0], f[1], p); ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < f.length; i += 2) { tf(f[i], f[i + 1], p); ctx.lineTo(p[0], p[1]); }
    ctx.closePath();
  });
}

// True when the edge (ax, ay)-(bx, by) lies on its piece's cell edge (a cut, not the coast).
export const onCellEdge = (r, ax, ay, bx, by) =>
  (ax === bx && (ax === r.cx0 || ax === r.cx1)) || (ay === by && (ay === r.cy0 || ay === r.cy1));

// The coastline to stroke into the current path: the region's pieces less their cut edges, or,
// for Korea's file, its rings as traceRings draws them.
export function traceCoastLines(ctx, b, lod, box, tf, minSize = 0) {
  if (!b.region) { traceRings(ctx, b.land, lod, box, tf, minSize); return; }
  const p = [0, 0];
  eachPiece(b, lod, box, minSize, (r) => {
    const f = r.f, n = f.length >> 1;
    let pen = false;
    for (let i = 0; i < n; i++) {
      const j = i + 1 < n ? i + 1 : 0;
      const ax = f[2 * i], ay = f[2 * i + 1], bx = f[2 * j], by = f[2 * j + 1];
      if (onCellEdge(r, ax, ay, bx, by)) { pen = false; continue; }
      if (!pen) { tf(ax, ay, p); ctx.moveTo(p[0], p[1]); pen = true; }
      tf(bx, by, p); ctx.lineTo(p[0], p[1]);
    }
  });
}

// Change detection: returns true when any number differs by more than its epsilon.
export function changed(prev, next) {
  if (!prev || prev.length !== next.length) return true;
  for (let i = 0; i < next.length; i++) if (prev[i] !== next[i]) return true;
  return false;
}

// Altitude as a flight level or feet (transition altitude 14,000 ft in Korea).
export const altLabel = (ft) => (ft >= 14000 ? 'FL' + String(Math.round(ft / 100)).padStart(3, '0') : Math.round(ft / 100) * 100 + ' ft');
