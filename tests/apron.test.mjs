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
