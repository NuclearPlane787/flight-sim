// Taxiway signs (v0.4.1): where they stand and what they say. Pure: no DOM, no three.js; apron.js draws them, and
// tests/taxisigns.test.mjs checks them.
//
// Shane: "After I land I get things like 'taxi to stand 252 using K, B, A, ...' but the taxiways don't have any
// markings on them, or signals for that matter in the grass." So, from the taxi graph (src/ground/taxi.js), as ICAO
// Annex 14 lays them out, simplified:
//   - an array where named taxiways meet: on each named way in, in the grass on its left (its right where the left
//     is pavement), SIGN.back before the junction, a location sign (yellow on black: the taxiway you're on) between
//     direction signs (black on yellow, with an arrow: the other named taxiways, those to the left on its left);
//   - a mandatory sign at each runway holding position: white on red, the runway with the end to the left first,
//     on the left of the hold line;
//   - and, painted on the taxiway before each array, its location again (apron.js, yellow on black).
// Taxiways with no name in the data (most of them: OpenStreetMap's) get no sign and send no direction.
//
//   taxiSignSites(airport) → { arrays: [array], mandatory: [sign], painted: [{ x, y, tx, ty, text }] }
//   array: { x, y, tx, ty, panels: [{ kind: 'dir' | 'loc', text, arrow? }] }   (x, y: the middle of its foot;
//     tx, ty: the way the traffic it faces is going; panels left to right as that traffic sees them; arrow: 0..7,
//     eighths of a turn clockwise from straight ahead)
//   sign: { x, y, tx, ty, panels: [{ kind: 'mand', text }] }
//   panelWidth(panel), arrayWidth(array): m, as apron.js builds them.

import { buildTaxiGraph } from '../ground/taxi.js';
import { holdShortSites, runwayLines, nearestRunway, segmentIndex, segDist, pointInRing, openRing, TAXI_W } from './apron-geom.js';

export const SIGN = {
  back: 32,          // m before the junction (along the taxiway) for an array
  minBack: 14,       // nearer than this to the junction there's no room: no array
  set: 11,           // m from the taxiway's edge to the array's near end (ICAO: 11 to 21 m for code E and F)
  clear: 5,          // m: no part of an array nearer other pavement than this
  runwayClear: 75,   // m from a runway's centreline: no arrays in the runway strip
  spacing: 22,       // m: of two arrays this close, only the first stays
  faceH: 1.0,        // m: the face's height; its foot is SIGN.base above the ground
  base: 0.45,
  glyphH: 0.6, glyphW: 0.5, glyphGap: 0.06, arrowW: 0.6, pad: 0.22, gap: 0.06, depth: 0.22, border: 0.06,
};

export const panelWidth = (p) => {
  const n = p.text.length, txt = n * SIGN.glyphW + Math.max(0, n - 1) * SIGN.glyphGap;
  return txt + (p.arrow !== undefined ? SIGN.arrowW + SIGN.glyphGap * 2 : 0) + 2 * SIGN.pad;
};
export const arrayWidth = (a) => a.panels.reduce((s, p) => s + panelWidth(p), 0) + SIGN.gap * (a.panels.length - 1);

const usable = (e) => e && !e.runway && !e.axis && !e.dead;
const other = (e, id) => (e.a === id ? e.b : e.a);

// Along edge e away from node n, through the nodes that only join two edges of the same name, for up to dist metres:
// { x, y, len } of the point reached (len < dist where a junction or an end comes first), and the way back towards n
// there (bx, by: unit).
function walk(g, n, e, dist) {
  let at = n, edge = e, len = 0;
  for (let guard = 0; guard < 200; guard++) {
    const A = g.nodes[at], bId = other(edge, at), B = g.nodes[bId];
    const l = Math.hypot(B.x - A.x, B.y - A.y) || 1e-9;
    if (len + l >= dist) {
      const k = (dist - len) / l;
      return { x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k, len: dist, bx: (A.x - B.x) / l, by: (A.y - B.y) / l };
    }
    len += l;
    const next = B.edges.filter(usable);
    const on = next.length === 2 ? next.find((q) => q !== edge) : null;
    if (!on || on.ref !== edge.ref) return { x: B.x, y: B.y, len, bx: (A.x - B.x) / l, by: (A.y - B.y) / l };
    at = bId; edge = on;
  }
  return null;
}

// opts: { index, holds }, the segment index and hold-short sites apron.js has already made.
export function taxiSignSites(airport, opts = {}) {
  const out = { arrays: [], mandatory: [], painted: [] };
  if (!airport || !(airport.taxiways || []).length) return out;
  const lines = runwayLines(airport);
  const index = opts.index || segmentIndex(airport.taxiways || []);
  const aprons = (airport.aprons || []).map((a) => openRing(a.points || a)).filter((r) => r.length >= 3);
  // Is (x, y) within m of pavement (a taxiway, an apron), or inside a runway's strip?
  const paved = (x, y, m, strip = SIGN.runwayClear) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const s of index.near(x + dx * 50, y + dy * 50)) if (segDist(x, y, s.ax, s.ay, s.bx, s.by).d < s.hw + m) return true;
    }
    for (const r of aprons) if (pointInRing(x, y, r)) return true;
    return nearestRunway(lines, x, y).d < strip;
  };
  // An array's foot: its near end SIGN.set from the taxiway's edge, on the left of the traffic if there's room, else
  // the right. Every point of the foot clear of pavement. → { x, y } of its middle, or null.
  const place = (wx, wy, tx, ty, hw, width, strip) => {
    for (const side of [1, -1]) {
      const lx = -ty * side, ly = tx * side, d = hw + SIGN.set + width / 2;
      const x = wx + lx * d, y = wy + ly * d;
      let ok = true;
      for (let k = -1; k <= 1 && ok; k += 0.5) if (paved(x + lx * k * width / 2, y + ly * k * width / 2, SIGN.clear, strip)) ok = false;
      if (ok) return { x, y };
    }
    return null;
  };

  let g = null;
  try { g = buildTaxiGraph(airport); } catch { g = null; }
  if (g) {
    for (const node of g.nodes) {
      const named = node.edges.filter((e) => usable(e) && e.ref);
      if (new Set(named.map((e) => e.ref)).size < 2) continue;
      if (nearestRunway(lines, node.x, node.y).d < SIGN.runwayClear) continue;
      for (const e of named) {
        const w = walk(g, node.id, e, SIGN.back);
        if (!w || w.len < SIGN.minBack) continue;
        // The traffic's way at the sign and at the junction, and where each other name leads from the junction.
        const tx = w.bx, ty = w.by;
        const o = g.nodes[other(e, node.id)], la = Math.hypot(node.x - o.x, node.y - o.y) || 1;
        const ax = (node.x - o.x) / la, ay = (node.y - o.y) / la;
        const dirs = new Map();
        for (const f of named) {
          if (f === e || f.ref === e.ref) continue;
          const p = walk(g, node.id, f, 30);
          if (!p) continue;
          const lx = p.x - node.x, ly = p.y - node.y, l = Math.hypot(lx, ly) || 1;
          // The turn: + to the right (clockwise, seen from above), in eighths, 0 straight on.
          const turn = Math.atan2(ax * ly - ay * lx, ax * lx + ay * ly);   // + left (counter-clockwise)
          let arrow = ((Math.round(-turn / (Math.PI / 4)) % 8) + 8) % 8;
          if (arrow === 4) arrow = turn > 0 ? 5 : 3;   // no sign points straight back: a sharp turn is 135°
          const key = f.ref + ':' + arrow;
          if (!dirs.has(key)) dirs.set(key, { kind: 'dir', text: f.ref, arrow, turn });
        }
        if (!dirs.size) continue;
        const list = [...dirs.values()];
        // Left of the location sign: the turns to the left, the sharpest leftmost; right of it the rest.
        const left = list.filter((d) => d.arrow >= 5 && d.arrow <= 7).sort((p, q) => q.turn - p.turn);
        const right = list.filter((d) => !(d.arrow >= 5 && d.arrow <= 7)).sort((p, q) => q.turn - p.turn);
        const panels = [...left, { kind: 'loc', text: e.ref }, ...right].map(({ kind, text, arrow }) => (arrow === undefined ? { kind, text } : { kind, text, arrow }));
        const width = panels.reduce((s, p) => s + panelWidth(p), 0) + SIGN.gap * (panels.length - 1);
        const at = place(w.x, w.y, tx, ty, (e.widthM || TAXI_W) / 2, width);
        if (!at) continue;
        if (out.arrays.some((q) => Math.hypot(q.x - at.x, q.y - at.y) < SIGN.spacing)) continue;
        out.arrays.push({ x: at.x, y: at.y, tx, ty, panels });
        out.painted.push({ x: w.x, y: w.y, tx, ty, text: e.ref });
      }
    }
  }

  // Mandatory signs at the runways' holding positions (pattern A: the runway's own, not an ILS hold).
  for (const h of opts.holds || holdShortSites(airport, index)) {
    if (h.pattern !== 'A') continue;
    const r = nearestRunway(lines, h.x, h.y), i = lines.indexOf(r.line), rw = (airport.runways || [])[i];
    if (!rw || !rw.ends || rw.ends.length !== 2) continue;
    // Facing the runway (dx, dy), the end on the left first.
    const [e0, e1] = rw.ends, lx = -h.dy, ly = h.dx;
    const s0 = (e0.x - h.x) * lx + (e0.y - h.y) * ly, s1 = (e1.x - h.x) * lx + (e1.y - h.y) * ly;
    const text = s0 >= s1 ? `${e0.ident}-${e1.ident}` : `${e1.ident}-${e0.ident}`;
    const panels = [{ kind: 'mand', text }];
    const width = panelWidth(panels[0]);
    // At the hold line, just on its holding side; it's in the strip by nature, so only other pavement counts.
    const at = place(h.x - h.dx * 1.5, h.y - h.dy * 1.5, h.dx, h.dy, (h.w || TAXI_W) / 2, width, 0);
    if (!at) continue;
    if (out.mandatory.some((q) => Math.hypot(q.x - at.x, q.y - at.y) < 10)) continue;
    out.mandatory.push({ x: at.x, y: at.y, tx: h.dx, ty: h.dy, panels });
  }
  return out;
}
