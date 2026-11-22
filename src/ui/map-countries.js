// v0.7.4 (Shane's item 10: "Country names are visible when you zoom out far enough. Also, add the country borders in
// their own distinct line style."): the path map's land borders and country names, from the region's
// country-lines.json (tools/bake_country_lines.py: Natural Earth's shared land borders, simplified at three
// tolerances, and NAME_EN at its label points). No DOM; map.js draws with these.
//
// buildCountries(doc) -> { lines, names, lod(mPerPx) } or null for a missing or empty file
// traceBorders(ctx, C, lod, box, tf)       the borders touching `box` (map metres) into the current path
// nameAlpha(name, mPerPx)                   0..1: how far a name has faded in at this zoom (0: not shown)
// layoutNames(C, opts) -> [{ name, x, y, alpha, w, h }]   names placed in screen px, never over a taken box (the
//   airports' labels and dots, the cities' names, the map's own panels) or a line (the route, the predicted path),
//   nor over each other; the larger countries first.

import { traceClipped } from './map-outline.js';

export function buildCountries(doc) {
  if (!doc || !Array.isArray(doc.lines)) return null;
  const tols = doc.tols || [200, 1200, 5000];
  const lines = [];
  for (const ln of doc.lines) {
    for (let li = 0; li < tols.length; li++) {
      for (const f of ln.levels[li] || []) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < f.length; i += 2) { const x = f[i], y = f[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        lines.push({ level: li, f, x0, y0, x1, y1, a: ln.a, b: ln.b });
      }
    }
  }
  const names = (doc.names || []).slice().sort((p, q) => p.rank - q.rank || p.minLabel - q.minLabel);
  return {
    lines, names, tols,
    lod(mPerPx) { const want = mPerPx * 1.5; let l = 0; for (let i = 0; i < tols.length; i++) if (tols[i] <= want) l = i; return l; },
  };
}

export function traceBorders(ctx, C, lod, box, tf, sbox = null) {
  const p = [0, 0];
  for (const ln of C.lines) {
    if (ln.level !== lod || ln.x1 < box.x0 || ln.x0 > box.x1 || ln.y1 < box.y0 || ln.y0 > box.y1) continue;
    const f = ln.f;
    if (sbox) {   // cut to the screen (a dashed line's cost runs with its whole length): map-outline.js traceClipped()
      const flat = new Array(f.length);
      for (let i = 0; i < f.length; i += 2) { tf(f[i], f[i + 1], p); flat[i] = p[0]; flat[i + 1] = p[1]; }
      traceClipped(ctx, flat, false, sbox);
      continue;
    }
    tf(f[0], f[1], p); ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < f.length; i += 2) { tf(f[i], f[i + 1], p); ctx.lineTo(p[0], p[1]); }
  }
}

// The zooms (metres a pixel) a name fades in over, by Natural Earth's LABELRANK: the large countries from about
// 650 m a pixel (Korea whole on the screen), the small ones (Luxembourg, Andorra...) a little closer in and gone
// again when the whole region is shown, where they would sit on their neighbours.
// (second pass: the large countries from 300 m a pixel, full by 500, so that zoomed out over the Alps or the Pyrenees
// France, Italy, Spain and Germany are named; a small country's name is drawn smaller and paler than any large one's.)
const FADE = [[0, 300, 500, Infinity], [5, 300, 500, Infinity], [6, 300, 450, 720]];   // (rank 5 kept at the region's zoom: Czechia and the Netherlands have airports)
export const SMALL_RANK = 5;           // LABELRANK from which a name is a small country's
const SMALL_ALPHA = 0.6;
export function nameAlpha(n, mPerPx) {
  let row = FADE[0];
  for (const r of FADE) if (n.rank >= r[0]) row = r;
  const [, a, b, hide] = row;
  if (mPerPx < a || mPerPx > hide) return 0;
  return Math.min(1, (mPerPx - a) / (b - a)) * (n.rank >= SMALL_RANK ? SMALL_ALPHA : 1);
}

const overlaps = (b, q) => !(b.x1 < q.x0 || b.x0 > q.x1 || b.y1 < q.y0 || b.y0 > q.y1);
// Does the segment (ax, ay)-(bx, by) cross the box (screen px)? Liang-Barsky.
export function segHitsBox(ax, ay, bx, by, b) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax - b.x0], [dx, b.x1 - ax], [-dy, ay - b.y0], [dy, b.y1 - ay]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}
const lineHits = (b, pl) => { for (let i = 0; i + 3 < pl.length; i += 2) if (segHitsBox(pl[i], pl[i + 1], pl[i + 2], pl[i + 3], b)) return true; return false; };

// opts: { mPerPx, W, H, toScreen(x, y, o) -> o, measure(text) -> px, px (font size), taken: [boxes], polylines:
// [[sx0, sy0, sx1, sy1, ...]] (screen px), pad }
export function layoutNames(C, { mPerPx, W, H, toScreen, measure, px = 13, smallPx = 11, taken = [], polylines = [], pad = 6 }) {
  const out = [], o = [0, 0];
  if (!C) return out;
  // the large countries first (by rank, then by how much land: their number of candidate points)
  const order = C.names.slice().sort((p, q) => p.rank - q.rank || (q.cand?.length || 0) - (p.cand?.length || 0));
  for (const n of order) {
    const alpha = nameAlpha(n, mPerPx);
    if (alpha <= 0) continue;
    toScreen(n.x, n.y, o);
    const text = n.name.toUpperCase();
    const h0 = n.rank >= SMALL_RANK ? smallPx : px;
    let got = null;
    // (second pass) at its own size, then, if nowhere is free, a size smaller
    for (const h of h0 > smallPx - 1 ? [h0, smallPx - 1] : [h0]) {
    if (got) break;
    const w = measure(text, h);
    // Natural Earth's point, then a little above, below or to either side of it if that is taken; then (second pass)
    // the baked points inside the country on the screen, nearest the label point first, or nearest the screen's
    // middle when the label point is off the screen (a country filling the view is named where it is seen).
    const tries = [];
    const onScreen = o[0] > 0 && o[0] < W && o[1] > 0 && o[1] < H;
    if (onScreen) for (const [dx, dy] of [[0, 0], [0, -1.6 * h], [0, 1.6 * h], [-0.4 * w, 0], [0.4 * w, 0], [0, -3.2 * h], [0, 3.2 * h], [-0.4 * w, -1.6 * h], [0.4 * w, 1.6 * h]]) tries.push([o[0] + dx, o[1] + dy]);
    const cand = n.cand || [], cs = [];
    for (let i = 0; i < cand.length; i += 2) { const q = toScreen(cand[i], cand[i + 1], [0, 0]); if (q[0] > 0 && q[0] < W && q[1] > 0 && q[1] < H) cs.push(q); }
    const ref = onScreen ? [o[0], o[1]] : [W / 2, H / 2];
    cs.sort((p, q) => Math.hypot(p[0] - ref[0], p[1] - ref[1]) - Math.hypot(q[0] - ref[0], q[1] - ref[1]));
    tries.push(...cs);
    for (const [cx, cy] of tries) {
      const b = { x0: cx - w / 2 - pad, x1: cx + w / 2 + pad, y0: cy - h / 2 - pad, y1: cy + h / 2 + pad };
      if (b.x0 < 0 || b.y0 < 0 || b.x1 > W || b.y1 > H) continue;
      if (taken.some((q) => overlaps(b, q)) || out.some((q) => overlaps(b, q.box))) continue;
      if (polylines.some((pl) => lineHits(b, pl))) continue;
      got = { name: text, x: cx, y: cy, alpha, w, h, px: h, box: b, a3: n.a3 };
      break;
    }
    }
    if (got) out.push(got);
  }
  return out;
}
