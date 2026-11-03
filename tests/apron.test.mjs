// Pure geometry for the airport ground (src/world/apron-geom.js).
//   node --test games/flight-sim/tests/apron.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../src/world/apron-geom.js';

const soupArea = (s) => {
  let a = 0;
  for (let i = 0; i < s.length; i += 6) a += Math.abs((s[i + 2] - s[i]) * (s[i + 5] - s[i + 1]) - (s[i + 4] - s[i]) * (s[i + 3] - s[i + 1])) / 2;
  return a;
};

// A made-up airport: one runway along +x through the origin, a taxiway coming in from the north.
const runway = { id: '09/27', widthM: 45, ends: [{ ident: '09', x: -1500, y: 0 }, { ident: '27', x: 1500, y: 0 }] };
const fake = (extra = {}) => ({
  icao: 'TEST', runways: [runway],
  taxiways: [{ ref: 'A', widthM: 23, points: [[0, 400], [0, 200], [0, 0]] }],
  holdingPositions: [], stands: [], buildings: [], aprons: [], ...extra,
});

test('a straight stroke covers its rectangle plus two round caps', () => {
  const s = G.strokeTriangles([[0, 0], [100, 0]], 10, [], 32);
  const want = 100 * 20 + Math.PI * 100;
  assert.ok(Math.abs(soupArea(s) - want) / want < 0.01, `area ${soupArea(s)} vs ${want}`);
});

test('a slight bend leaves no gap on the outside of the stroke', () => {
  // 0.86° to the left at (100, 0): the outer side is the right (-y).
  const s = G.strokeTriangles([[0, 0], [100, 0], [200, 1.5]], 10, [], 8);
  const inside = (px, py) => {
    for (let i = 0; i < s.length; i += 6) {
      const [x0, y0, x1, y1, x2, y2] = s.slice(i, i + 6);
      const d0 = (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0);
      const d1 = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
      const d2 = (x0 - x2) * (py - y2) - (y0 - y2) * (px - x2);
      if ((d0 >= 0 && d1 >= 0 && d2 >= 0) || (d0 <= 0 && d1 <= 0 && d2 <= 0)) return true;
    }
    return false;
  };
  const half = Math.atan2(1.5, 100) / 2;
  for (const r of [3, 6, 9.5]) {
    assert.ok(inside(100 + r * Math.sin(half), -r * Math.cos(half)), `gap at ${r} m from the centreline`);
  }
});

test('subdividing keeps the area and shortens every edge', () => {
  const tri = [0, 0, 500, 0, 0, 300];
  const out = G.subdivideSoup(tri, 60);
  assert.ok(Math.abs(soupArea(out) - soupArea(tri)) < 1e-6);
  for (let i = 0; i < out.length; i += 6) {
    for (const [a, b] of [[0, 2], [2, 4], [4, 0]]) assert.ok(Math.hypot(out[i + a] - out[i + b], out[i + a + 1] - out[i + b + 1]) <= 60 + 1e-9);
  }
});

test('a synthetic hold-short goes 90 m from the centreline, facing the runway', () => {
  const h = G.holdShortSites(fake());
  assert.equal(h.length, 1);
  assert.ok(h[0].synthetic);
  assert.ok(Math.abs(h[0].y - G.HOLD_DIST) < 1e-6 && Math.abs(h[0].x) < 1e-6);
  assert.deepEqual([h[0].dx, Math.round(h[0].dy)], [0, -1]);
  assert.equal(h[0].pattern, 'A');
});

test('a mapped holding position replaces the synthetic one', () => {
  const h = G.holdShortSites(fake({ holdingPositions: [{ ref: '', x: 0.5, y: 107 }] }));
  assert.equal(h.length, 1);
  assert.equal(h[0].synthetic, false);
  assert.ok(Math.abs(h[0].y - 107) < 1e-6 && Math.abs(h[0].x) < 1e-6, 'snapped onto the taxiway');
  assert.ok(h[0].dy < 0);
});

test('taxiways running alongside a runway get no hold-short', () => {
  const a = fake({ taxiways: [{ widthM: 23, points: [[-1000, 95], [0, 85], [1000, 95]] }] });
  assert.equal(G.holdShortSites(a).length, 0);
});

test('edge lines stop where the taxiway meets the runway', () => {
  const a = fake();
  const e = G.taxiwayEdges(a, G.segmentIndex(a.taxiways), []);
  assert.equal(e.length, 2);
  for (const p of e) for (const [, y] of p) assert.ok(y > 22.5 + 9 - 4.1, `edge point at y ${y}`);
});

test('a stand without a lead-in gets a straight one to the nose-wheel stop', () => {
  const m = G.standMarks({ ref: '1', x: 0, y: 0, hdgGridDeg: 90 });
  assert.equal(m.lead.length, 2);
  assert.ok(Math.abs(m.lead[0][0] + 60) < 1e-9 && Math.abs(m.lead[0][1]) < 1e-9);
  assert.ok(Math.abs(m.stop.x - G.NOSE_WHEEL) < 1e-9 && Math.abs(m.stop.y) < 1e-9);
  assert.ok(m.label.x < 0, 'the number is painted before the stand');
});

test('the jet bridge cab meets the L1 door; no bridge to a terminal behind the aircraft', () => {
  // Facing north (hdg 0): left is west. A terminal wall 40 m to the west.
  const term = [[-60, -20], [-40, -20], [-40, 60], [-60, 60]];
  const jb = G.jetBridge({ x: 0, y: 0, hdgGridDeg: 0 }, [term]);
  assert.ok(jb);
  assert.ok(Math.abs(jb.door.x + G.FUSE_HALF) < 1e-9 && Math.abs(jb.door.y - G.DOOR_FWD) < 1e-9);
  assert.ok(Math.abs(jb.root.x + 40) < 1e-9, 'rooted on the wall');
  assert.ok(jb.cab.x < jb.door.x, 'the cab is outboard of the door');
  const behind = [[-20, -80], [20, -80], [20, -60], [-20, -60]];
  assert.equal(G.jetBridge({ x: 0, y: 0, hdgGridDeg: 0 }, [behind]), null);
});

test('real data: every airport gets hold-shorts; Jeju\'s are all synthetic at 90 m', () => {
  for (const id of ['RKSS', 'RKPC', 'RKSI']) {
    const a = JSON.parse(readFileSync(new URL(`../data/airports/${id}.json`, import.meta.url)));
    const h = G.holdShortSites(a);
    assert.ok(h.length >= 10, `${id}: ${h.length} hold-shorts`);
    if (id === 'RKPC') {
      const lines = G.runwayLines(a);
      for (const s of h) {
        assert.ok(s.synthetic);
        assert.ok(Math.abs(G.nearestRunway(lines, s.x, s.y).d - G.HOLD_DIST) < 1);
      }
    }
    assert.ok(G.dedupePolys(a.aprons).length <= a.aprons.length);
  }
});

// v0.2.1: Shane, 2026-11-03: "Some taxiways at Jeju airport still clip strangely with the
// runway." The taxiways' pavement lay 8 cm over the runways and was drawn over them from low
// angles; now it stops at the runway's drawn edge (its shoulders included: 22.5 + 7.5 m).
test('a taxiway joining a runway loses exactly the part on the runway', () => {
  const a = fake();
  const rects = G.drawnRunwayRects(a);
  assert.equal(rects[0].hw, 30);
  const soup = G.strokeTriangles(a.taxiways[0].points, 11.5, [], 4);
  const capArea = (soupArea(soup) - 23 * 400) / 2;            // each round cap
  const clipped = G.clipSoupOutside(soup, rects);
  assert.ok(Math.abs(soupArea(clipped) - (23 * 370 + capArea)) < 0.01, `left ${soupArea(clipped)}`);
  for (let i = 0; i < clipped.length; i += 2) assert.ok(clipped[i + 1] >= 30 - 1e-9, `a vertex at y ${clipped[i + 1]}`);
  // Away from the runway, triangles pass through untouched.
  const far = G.strokeTriangles([[0, 100], [0, 300]], 11.5, [], 4);
  assert.deepEqual(G.clipSoupOutside(far, rects), far);
});

test('a taxiway crossing a runway at an angle keeps both sides, and nothing in between', () => {
  const a = fake();
  const rects = G.drawnRunwayRects(a);
  const soup = G.strokeTriangles([[-300, 300], [300, -300]], 11.5, [], 4);
  const clipped = G.clipSoupOutside(soup, rects);
  let north = 0, south = 0;
  for (let i = 0; i < clipped.length; i += 6) {
    const cy = (clipped[i + 1] + clipped[i + 3] + clipped[i + 5]) / 3;
    assert.ok(Math.abs(cy) > 30, `a piece centred at y ${cy.toFixed(2)}`);
    if (cy > 0) north++; else south++;
  }
  assert.ok(north > 0 && south > 0);
  // The band |y| <= 30 across a 23 m wide stroke at 45°: 60 m tall, 23·√2 wide.
  const removed = soupArea(soup) - soupArea(clipped);
  assert.ok(Math.abs(removed - 60 * 23 * Math.SQRT2) < 0.5, `removed ${removed.toFixed(1)} m²`);
});

test('a centreline is split where it crosses the runway: outside, on it, outside', () => {
  const rects = G.drawnRunwayRects(fake());
  const runs = G.splitPolyline([[0, 400], [0, 100], [0, -100], [0, -400]], rects);
  assert.deepEqual(runs.map((r) => r.inside), [false, true, false]);
  assert.deepEqual(runs[0].pts, [[0, 400], [0, 100], [0, 30]]);
  assert.deepEqual(runs[1].pts, [[0, 30], [0, -30]]);
  assert.deepEqual(runs[2].pts, [[0, -30], [0, -100], [0, -400]]);
  // One that ends on the centreline ends inside; one that never reaches it is one run.
  assert.deepEqual(G.splitPolyline([[0, 400], [0, 0]], rects).map((r) => r.inside), [false, true]);
  assert.deepEqual(G.splitPolyline([[0, 400], [0, 31]], rects).map((r) => r.inside), [false]);
});

test("real data: no taxiway pavement is left on a runway, and the lead lines are on them", () => {
  for (const id of ['RKSS', 'RKPC', 'RKSI']) {
    const a = JSON.parse(readFileSync(new URL(`../data/airports/${id}.json`, import.meta.url)));
    const rects = G.drawnRunwayRects(a, 0.05), exact = G.drawnRunwayRects(a);
    let pieces = 0, onRunway = 0, lead = 0;
    for (const tw of a.taxiways) {
      const c = G.clipSoupOutside(G.strokeTriangles(G.densify(tw.points, 50), (tw.widthM || 23) / 2, [], 4), rects);
      for (let i = 0; i < c.length; i += 6) {
        pieces++;
        const cx = (c[i] + c[i + 2] + c[i + 4]) / 3, cy = (c[i + 1] + c[i + 3] + c[i + 5]) / 3;
        if (rects.some((r) => G.inRect(r, cx, cy))) onRunway++;
      }
      for (const run of G.splitPolyline(tw.points, exact)) {
        if (!run.inside) continue;
        lead++;
        for (const [x, y] of run.pts) assert.ok(exact.some((r) => G.inRect({ ...r, u0: r.u0 - 1e-6, u1: r.u1 + 1e-6, hw: r.hw + 1e-6 }, x, y)));
      }
    }
    assert.ok(pieces > 4000, `${id}: ${pieces} pieces`);
    assert.equal(onRunway, 0, `${id}: ${onRunway} pieces of taxiway on a runway`);
    assert.ok(lead >= 30, `${id}: ${lead} lead lines`);
  }
});

// v0.2.1: pavement only 8 cm up has to follow curving ground, or the terrain shows through it.
test('refineSoup splits only where the ground curves away from a flat triangle', () => {
  const tri = [0, 0, 60, 0, 0, 60];
  // Planar ground: nothing to split.
  assert.deepEqual(G.refineSoup(tri, (x, y) => 3 + 0.01 * x - 0.02 * y), tri);
  // A bowl: split until the flat pieces stay within 3 cm, or the edges reach 3 m.
  const bowl = (x, y) => ((x - 20) ** 2 + (y - 20) ** 2) / 400;
  const out = G.refineSoup(tri, bowl);
  assert.ok(out.length / 6 > 8, `${out.length / 6} triangles`);
  assert.ok(Math.abs(soupArea(out) - soupArea(tri)) < 1e-6, 'the same area');
  let worst = 0;
  for (let i = 0; i < out.length; i += 6) {
    const P = [[out[i], out[i + 1]], [out[i + 2], out[i + 3]], [out[i + 4], out[i + 5]]], H = P.map(([x, y]) => bowl(x, y));
    const big = Math.max(...[0, 1, 2].map((k) => Math.hypot(P[k][0] - P[(k + 1) % 3][0], P[k][1] - P[(k + 1) % 3][1])));
    if (big <= 3) continue;
    for (let u = 0; u <= 4; u++) for (let v = 0; v <= 4 - u; v++) {
      const w = 4 - u - v, x = (P[0][0] * u + P[1][0] * v + P[2][0] * w) / 4, y = (P[0][1] * u + P[1][1] * v + P[2][1] * w) / 4;
      worst = Math.max(worst, Math.abs((H[0] * u + H[1] * v + H[2] * w) / 4 - bowl(x, y)));
    }
  }
  // A bowl's flat triangle is furthest off inside it, where it isn't tested; a little over tol is fine.
  assert.ok(worst < 0.06, `worst ${worst.toFixed(3)} m off`);
});

test('refineLine adds points only where the ground bends under the line', () => {
  assert.deepEqual(G.refineLine([[0, 0], [100, 0]], (x) => 2 + 0.05 * x), [[0, 0], [100, 0]]);
  const hump = (x) => 3 * Math.sin((x / 100) * Math.PI);
  const pts = G.refineLine([[0, 0], [100, 0]], hump);
  assert.ok(pts.length > 5, `${pts.length} points`);
  for (let i = 1; i < pts.length; i++) {
    const m = (pts[i - 1][0] + pts[i][0]) / 2;
    if (pts[i][0] - pts[i - 1][0] > 3) assert.ok(Math.abs((hump(pts[i - 1][0]) + hump(pts[i][0])) / 2 - hump(m)) <= 0.03 + 1e-9);
  }
});
