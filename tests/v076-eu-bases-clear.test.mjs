// v0.7.6 (after the pictures-only review: "airliner wing inside a building" at Lakenheath): at Europe's six bases no
// taxi route from a stand to a runway end's hold passes within an A321's half span of a building, and none within a
// 777's (the spots take code E), but for Lossiemouth's routes to its short runway's 28 end, which run between the
// hangars' corners (18.3 and 19.7 m off: clear for an A321 by 0.4 m, not for a widebody; logged in ROADMAP).
// Lakenheath's five buildings in the way are left out by the bake's BUILDING_SKIP_AT. Run in a process opened in
// Europe (tests/region-run.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inRegion } from './region-run.mjs';

const A321_HALF = 17.9, B777_HALF = 32.4;
const KNOWN_WIDE = { EGQS: ['28'] };
const segD = (px, py, ax, ay, bx, by) => { const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy; let t = L2 ? ((px - ax) * vx + (py - ay) * vy) / L2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - ax - t * vx, py - ay - t * vy); };
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { if ((P[i][1] > y) !== (P[j][1] > y) && x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; } return c; };

if (inRegion('europe', import.meta.url)) {
  const { buildTaxiGraph, routeFromStand } = await import('../src/ground/taxi.js');
  for (const icao of ['ETAR', 'EGQS', 'EGUL', 'EGVA', 'LEZG', 'LERT']) {
    test(`${icao}: every stand's routes to the holds clear the buildings by a wing`, () => {
      const a = JSON.parse(readFileSync(new URL(`../data/europe/airports/${icao}.json`, import.meta.url), 'utf8'));
      const g = buildTaxiGraph(a);
      const boxes = a.buildings.map((b) => { const xs = b.points.map((p) => p[0]), ys = b.points.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; });
      let routes = 0, worstNarrow = Infinity, worstWide = Infinity;
      for (const s of a.stands) for (const r of a.runways) for (const e of r.ends) {
        const rt = routeFromStand(g, s, e);
        assert.ok(rt && rt.points.length >= 2, `${icao} ${s.ref} to ${e.ident}: no route`);
        routes++;
        const known = (KNOWN_WIDE[icao] || []).includes(e.ident);
        for (let i = 0; i + 1 < rt.points.length; i++) {
          const [ax, ay] = rt.points[i], [bx, by] = rt.points[i + 1];
          const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
          for (let k = 0; k <= n; k++) {
            const x = ax + (bx - ax) * k / n, y = ay + (by - ay) * k / n;
            for (let bi = 0; bi < boxes.length; bi++) {
              const B = boxes[bi];
              if (x < B[0] - 40 || x > B[2] + 40 || y < B[1] - 40 || y > B[3] + 40) continue;
              const P = a.buildings[bi].points;
              let d = inPoly(x, y, P) ? 0 : Infinity;
              if (d) for (let q = 0; q < P.length; q++) { const p0 = P[q], p1 = P[(q + 1) % P.length]; d = Math.min(d, segD(x, y, p0[0], p0[1], p1[0], p1[1])); }
              worstNarrow = Math.min(worstNarrow, d);
              if (!known) worstWide = Math.min(worstWide, d);
            }
          }
        }
      }
      assert.ok(routes >= 6, `${routes} routes`);
      assert.ok(worstNarrow > A321_HALF + 0.3, `${icao}: a building ${worstNarrow.toFixed(1)} m from a route's centreline`);
      assert.ok(worstWide > B777_HALF + 0.5, `${icao}: a building ${worstWide.toFixed(1)} m from a route's centreline (a 777's half span is ${B777_HALF})`);
    });
  }
}
