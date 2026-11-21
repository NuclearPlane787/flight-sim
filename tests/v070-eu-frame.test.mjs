// v0.7.0: Europe's frame, outline and rules from inside a page opened in Europe (FS_REGION=europe; the default
// run re-runs this file in a child process: tests/region-run.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url)) {
  const { toMap, toGeo, scaleFactor, LAT0, LON0 } = await import('../src/world/frame.js');
  const { regionOutline, regionExtent, insideRegion, insideBy, outlineIsRect } = await import('../src/world/outline.js');
  const { REGION, REGION_ID } = await import('../src/world/regions.js');

  test("the page's region is Europe: its origin, its cone", () => {
    assert.equal(REGION_ID, 'europe'); assert.equal(LAT0, 47); assert.equal(LON0, 4);
    const [x, y] = toMap(47, 4);
    assert.ok(Math.hypot(x, y) < 1e-6);
    // West of Greenwich maps west of the origin, and comes back.
    const [hx, hy] = toMap(51.4706, -0.4619);
    assert.ok(hx < -300000 && hx > -320000 && hy > 480000 && hy < 520000, `Heathrow at ${hx}, ${hy}`);
    const [la, lo] = toGeo(hx, hy);
    assert.ok(Math.abs(la - 51.4706) < 1e-9 && Math.abs(lo + 0.4619) < 1e-9);
    assert.ok(Math.abs(scaleFactor(47) - 0.9915) < 2e-4);
  });

  test('the outline: ten points densified every quarter degree, its rectangle, who is inside', () => {
    assert.equal(outlineIsRect(), false);
    const poly = regionOutline(), e = regionExtent();
    assert.equal(REGION.outlineGeo.length, 10);
    assert.equal(poly.length, 420);
    // Every densified step is at most a quarter degree each way: under 40 km on the map (a diagonal edge's are the longest).
    for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 40000, `edge ${i}`); }
    assert.deepEqual(e, { x0: -1377000, y0: -1306000, x1: 1259000, y1: 1425000 });
    for (const [x, y] of poly) assert.ok(x >= e.x0 && x <= e.x1 && y >= e.y0 && y <= e.y1);
    const inside = (la, lo) => insideRegion(...toMap(la, lo));
    for (const [n, la, lo] of [['Heathrow', 51.47, -0.46], ['Charles de Gaulle', 49.01, 2.55], ['Frankfurt', 50.03, 8.57], ['Madrid', 40.47, -3.56], ['Zurich', 47.46, 8.55],
      ['Rome', 41.8, 12.24], ['Lisbon', 38.77, -9.13], ['Gibraltar', 36.15, -5.35], ['Tangier', 35.77, -5.8], ['Palermo', 38.1, 13.4], ['Copenhagen', 55.62, 12.65],
      ['Edinburgh', 55.95, -3.37], ['Vienna', 48.11, 16.57], ['Naples', 40.88, 14.29]]) assert.ok(inside(la, lo), `${n} is inside`);
    for (const [n, la, lo] of [['Tunis', 36.8, 10.2], ['Algiers', 36.75, 3.06], ['Oslo', 59.9, 10.75], ['Warsaw', 52.2, 21.0], ['Athens', 37.98, 23.7], ['Belgrade', 44.8, 20.45]]) assert.ok(!inside(la, lo), `${n} is outside`);
    // The brief's room: Vienna about 220 km from the east edge, Budapest at the edge.
    const vienna = insideBy(...toMap(48.11, 16.57)) / 1000, budapest = insideBy(...toMap(47.44, 19.26)) / 1000;
    assert.ok(vienna > 200 && vienna < 240, `Vienna ${vienna} km inside`);
    assert.ok(budapest > 0 && budapest < 40, `Budapest ${budapest} km inside`);
    assert.ok(insideBy(...toMap(36.8, 10.2)) < 0);
  });
}
