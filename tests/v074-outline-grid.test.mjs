// v0.7.4, fix 5: insideRegion()'s coarse grid ("Found while building v0.7.0": the predicted path tested Europe's
// 420-odd edges at every step). The grid must give the polygon's own answer everywhere: a million random points over
// the outline's rectangle and a margin round it, and points on the cells' own lines. From a process opened in Europe
// (East Asia's outline is its rectangle: no grid, the same test as before).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url)) {
  const { insideRegion, insidePolygon, regionExtent, regionOutline, outlineIsRect, outlineGridStats } = await import('../src/world/outline.js');
  const e = regionExtent();
  const ref = (x, y) => !(x < e.x0 || x > e.x1 || y < e.y0 || y > e.y1) && insidePolygon(x, y);
  // a small seeded generator, so a failure can be found again
  let seed = 20261122;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  test('Europe: a polygon, with a grid that answers most cells at once', () => {
    assert.equal(outlineIsRect(), false);
    const g = outlineGridStats();
    assert.ok(g.cells > 5000 && (g.inside + g.outside) / g.cells > 0.85, JSON.stringify(g));
    console.log(`# grid: ${g.cells} cells of ${g.cellM / 1000} km, ${g.inside} inside, ${g.outside} outside, ${g.cells - g.inside - g.outside} near an edge`);
  });

  test('a million random points: the same answer as the polygon alone', () => {
    const W = e.x1 - e.x0, H = e.y1 - e.y0;
    let diff = 0, inside = 0;
    for (let i = 0; i < 1e6; i++) {
      const x = e.x0 - 50000 + rnd() * (W + 100000), y = e.y0 - 50000 + rnd() * (H + 100000);
      const a = insideRegion(x, y), b = ref(x, y);
      if (a !== b) diff++;
      if (a) inside++;
    }
    assert.equal(diff, 0);
    assert.ok(inside > 300000 && inside < 800000, `${inside}`);
  });

  test('on the cells\' lines, at the rectangle\'s corners and edges, and beside every outline point: the same', () => {
    const g = outlineGridStats();
    let n = 0;
    for (let x = e.x0; x <= e.x1; x += g.cellM) for (let y = e.y0; y <= e.y1; y += 3777) { assert.equal(insideRegion(x, y), ref(x, y), `${x}, ${y}`); n++; }
    for (let y = e.y0; y <= e.y1; y += g.cellM) for (let x = e.x0; x <= e.x1; x += 3777) { assert.equal(insideRegion(x, y), ref(x, y), `${x}, ${y}`); n++; }
    for (const [x, y] of [[e.x0, e.y0], [e.x1, e.y0], [e.x1, e.y1], [e.x0, e.y1], [e.x1, (e.y0 + e.y1) / 2], [(e.x0 + e.x1) / 2, e.y1]]) assert.equal(insideRegion(x, y), ref(x, y));
    for (const [px, py] of regionOutline()) for (const [dx, dy] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5], [900, 900], [-900, -900], [15999, 0], [0, -15999]]) {
      assert.equal(insideRegion(px + dx, py + dy), ref(px + dx, py + dy), `${px + dx}, ${py + dy}`); n++;
    }
    assert.ok(n > 5000);
  });

  test('the time: the grid against the polygon alone, a path\'s worth of points', () => {
    const pts = [];
    for (let i = 0; i < 200000; i++) pts.push(e.x0 + rnd() * (e.x1 - e.x0), e.y0 + rnd() * (e.y1 - e.y0));
    let a = 0, b = 0;
    let t0 = performance.now();
    for (let k = 0; k < pts.length; k += 2) a += ref(pts[k], pts[k + 1]) ? 1 : 0;
    const tPoly = performance.now() - t0;
    t0 = performance.now();
    for (let k = 0; k < pts.length; k += 2) b += insideRegion(pts[k], pts[k + 1]) ? 1 : 0;
    const tGrid = performance.now() - t0;
    assert.equal(a, b);
    console.log(`# 200,000 points: the polygon alone ${tPoly.toFixed(1)} ms, with the grid ${tGrid.toFixed(1)} ms (${(tPoly / tGrid).toFixed(1)}x)`);
    // (logged, not asserted: a wall-clock comparison can fail when the suite shares the CPU; the code review, 05:54)
  });
}
