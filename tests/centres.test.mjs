// The dense centres (src/world/centres.js, centres-worker.js): the nine baked files against
// centres.json, their order and rings, the triangulation, the geometry builder on a small synthetic
// centre, the mask rule, the landmark exclusion and the tiers' helpers. Node only, no WebGL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
  parseCentre, recordMean, cellOf, ringArea2, triangulate, buildCentre, maskRule, onRunwayZone,
  MAGIC, CELL_M, TALL_M, AVIATION_M, MASK_MIN_COUNT, MASK_MIN_COVER, MASK_BIG_COVER,
} from '../src/world/centres-worker.js';
import { tallCut, CUT_KNOTS, countAtLeast, rowRange, boxDistance, landmarkExclusions, centreAllowed, createCentres } from '../src/world/centres.js';
import { toMap } from '../src/world/frame.js';
import { CITIES_ON, setCities } from '../src/world/region.js';

const DATA = new URL('../data/centres/', import.meta.url);
const INDEX = JSON.parse(readFileSync(new URL('centres.json', DATA)));
const load = (c) => parseCentre(gunzipSync(readFileSync(new URL(c.file, DATA))));
const parsed = new Map(INDEX.centres.map((c) => [c.id, load(c)]));

// The triangles' areas (twice, signed) of a triangulation of ring (xs, ys).
function triAreas(xs, ys, tri) {
  const a = [];
  for (let t = 0; t < tri.length; t += 3) {
    const [i, j, k] = [tri[t], tri[t + 1], tri[t + 2]];
    a.push((xs[j] - xs[i]) * (ys[k] - ys[i]) - (ys[j] - ys[i]) * (xs[k] - xs[i]));
  }
  return a;
}
const ringOf = (p, i) => {
  const s = p.vstart[i], n = p.nVerts[i], xs = [], ys = [];
  for (let k = 0; k < n; k++) { xs.push(p.xy[(s + k) * 2] / 2); ys.push(p.xy[(s + k) * 2 + 1] / 2); }
  return [xs, ys];
};

test('the nine centres parse to centres.json\'s counts', () => {
  assert.equal(INDEX.centres.length, 9);
  for (const c of INDEX.centres) {
    const p = parsed.get(c.id);
    assert.equal(p.count, c.count, c.id);
    assert.equal(p.vertexCount, c.vertices, c.id);
    assert.equal(p.vstart[p.count], c.vertices, c.id);
    let maxH = 0;
    for (let i = 0; i < p.count; i++) {
      assert.ok(p.nVerts[i] >= 3, `${c.id} ${i}: ${p.nVerts[i]} vertices`);
      maxH = Math.max(maxH, p.height[i] / 10);
    }
    assert.ok(Math.abs(maxH - c.maxHeightM) < 0.11, `${c.id}: max ${maxH} vs ${c.maxHeightM}`);
  }
  const bad = new Uint8Array(16);
  assert.throws(() => parseCentre(bad.buffer), /magic/);
  const hdr = new DataView(new ArrayBuffer(12));
  hdr.setUint32(0, MAGIC, true); hdr.setUint32(4, 1, true);
  assert.throws(() => parseCentre(hdr.buffer), /size/);
});

test('records are in cell order, tallest first inside a cell', () => {
  for (const c of INDEX.centres) {
    const p = parsed.get(c.id);
    let lastCell = -1, lastH = Infinity, outOfOrder = 0;
    for (let i = 0; i < p.count; i++) {
      const [mx, my] = recordMean(p, i);
      const [ci, cj] = cellOf(c, mx, my);
      const cell = cj * c.cols + ci;
      assert.ok(cell >= lastCell, `${c.id} record ${i}: cell ${cell} after ${lastCell}`);
      if (cell === lastCell && p.height[i] > lastH) outOfOrder++;
      if (cell !== lastCell) lastH = Infinity;
      lastCell = cell; lastH = p.height[i];
    }
    assert.equal(outOfOrder, 0, `${c.id}: heights out of order inside a cell`);
  }
});

test('every ring is counter-clockwise', () => {
  for (const c of INDEX.centres) {
    const p = parsed.get(c.id);
    for (let i = 0; i < p.count; i++) {
      const [xs, ys] = ringOf(p, i);
      assert.ok(ringArea2(xs, ys) > 0, `${c.id} record ${i} is clockwise or empty`);
    }
  }
});

test('concave rings triangulate into positive triangles that sum to the ring', () => {
  const rings = {
    square: [[0, 10, 10, 0], [0, 0, 10, 10]],
    L: [[0, 30, 30, 10, 10, 0], [0, 0, 10, 10, 30, 30]],
    U: [[0, 30, 30, 20, 20, 10, 10, 0], [0, 0, 30, 30, 10, 10, 30, 30]],
    comb: [[0, 50, 50, 40, 40, 30, 30, 20, 20, 10, 10, 0], [0, 0, 20, 20, 5, 5, 20, 20, 5, 5, 20, 20]],
    star: (() => {
      const xs = [], ys = [];
      for (let k = 0; k < 10; k++) { const r = k % 2 ? 4 : 10, a = (k / 10) * 2 * Math.PI; xs.push(r * Math.cos(a)); ys.push(r * Math.sin(a)); }
      return [xs, ys];
    })(),
    collinear: [[0, 5, 10, 10, 10, 0], [0, 0, 0, 5, 10, 10]],
  };
  for (const [name, [xs, ys]] of Object.entries(rings)) {
    const tri = triangulate(xs, ys);
    const a = triAreas(xs, ys, tri);
    assert.ok(a.every((v) => v > 0), `${name}: a triangle is not counter-clockwise`);
    const sum = a.reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - ringArea2(xs, ys)) < 1e-9 * Math.abs(sum) + 1e-9, `${name}: ${sum} vs ${ringArea2(xs, ys)}`);
  }
  // Every real ring: no triangle clockwise; the areas sum to the ring's for the simple ones (all but
  // a handful in the data: OSM's few self-touching outlines).
  let rings2 = 0, mismatched = 0, concave = 0;
  for (const c of INDEX.centres) {
    const p = parsed.get(c.id);
    for (let i = 0; i < p.count; i++) {
      const [xs, ys] = ringOf(p, i);
      const tri = triangulate(xs, ys);
      const a = triAreas(xs, ys, tri);
      assert.ok(a.every((v) => v > 0), `${c.id} ${i}`);
      const want = ringArea2(xs, ys), sum = a.reduce((s, v) => s + v, 0);
      rings2++;
      if (Math.abs(sum - want) > 1e-6 * want) mismatched++;
      for (let k = 0; k < xs.length; k++) {
        const n = xs.length, a0 = (k + n - 1) % n, a1 = (k + 1) % n;
        if ((xs[k] - xs[a0]) * (ys[a1] - ys[a0]) - (ys[k] - ys[a0]) * (xs[a1] - xs[a0]) < 0) { concave++; break; }
      }
    }
  }
  assert.ok(concave > 10000, `concave rings: ${concave}`);
  assert.ok(mismatched <= rings2 * 0.002, `${mismatched} of ${rings2} rings don't sum to their area`);
});

// A synthetic centre: four buildings in a 2 x 2 km box of 4 x 4 cells, origin at the box's middle.
function synthetic(extra = []) {
  const recs = [
    // [height m, minHeight m, flags, ring (m from the origin)]
    [200, 0, 0, [[-500, -500], [-470, -500], [-470, -470], [-500, -470]]],            // a 200 m tower (square): tall, aviation lights
    [40, 0, 1, [[-300, -500], [-260, -500], [-260, -480], [-280, -480], [-280, -460], [-300, -460]]],   // 40 m L, estimated
    [20, 0, 0, [[300, 300], [320, 300], [320, 320]]],                                    // a 20 m triangle: low
    [30, 12, 2, [[600, 600], [640, 600], [640, 640], [600, 640]]],                       // a raised part, 12 to 30 m
    ...extra,
  ];
  const nv = recs.reduce((s, r) => s + r[3].length, 0);
  const buf = new ArrayBuffer(12 + recs.length * 8 + nv * 4), dv = new DataView(buf);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, recs.length, true); dv.setUint32(8, nv, true);
  let v = 12 + recs.length * 8;
  recs.forEach(([h, mh, fl, ring], i) => {
    const o = 12 + i * 8;
    dv.setUint16(o, h * 10, true); dv.setUint16(o + 2, mh * 10, true); dv.setUint8(o + 4, ring.length); dv.setUint8(o + 5, fl);
    for (const [x, y] of ring) { dv.setInt16(v, x * 2, true); dv.setInt16(v + 2, y * 2, true); v += 4; }
  });
  const info = { id: 'syn', origin: [10000, 20000], box: [9000, 19000, 11000, 21000], cols: 4, rows: 4 };
  return { buf, info, recs };
}

test('the builder\'s vertex and triangle counts for a small centre', () => {
  const { buf, info } = synthetic();
  const p = parseCentre(buf);
  assert.equal(p.count, 4);
  const r = buildCentre(p, info);
  assert.equal(r.kept, 4);
  // Per building: 5 n vertices (4 a wall quad, 1 the roof's), 2 n wall triangles and n - 2 roof ones.
  const tallN = [4, 6], lowN = [3, 4];
  const v = (ns) => ns.reduce((s, n) => s + 5 * n, 0), t = (ns) => ns.reduce((s, n) => s + 3 * n - 2, 0);
  assert.equal(r.tall.count, 2); assert.equal(r.low.count, 2);
  assert.equal(r.tall.verts, v(tallN)); assert.equal(r.low.verts, v(lowN));
  assert.equal(r.tall.tris, t(tallN)); assert.equal(r.low.tris, t(lowN));
  assert.equal(r.tall.aP.length, v(tallN) * 4);
  // Tall: sorted by height, the index prefix per building.
  assert.deepEqual([...r.tall.top], [200, 40]);
  assert.equal(r.tall.end[0], 3 * t([4])); assert.equal(r.tall.end[1], r.tall.index.length);
  // The raised part's walls start at 12 m; the roofs are at the top, flagged, facing up.
  const P = r.low.aP, N = r.low.aN;
  const hs = new Set(); for (let k = 0; k < r.low.verts; k++) if (N[k * 4 + 3] === 0) hs.add(P[k * 4 + 2]);
  assert.ok(hs.has(120) && hs.has(300) && hs.has(0) && hs.has(200));
  for (let k = 0; k < r.low.verts; k++) if (N[k * 4 + 3] === 127) assert.equal(N[k * 4 + 2], 127);
  // Walls face outward: the first wall of the 200 m square runs east along its south side: normal south.
  assert.deepEqual([...r.tall.aN.slice(0, 4)], [0, -127, 0, 0]);
  // Every index in range; the chunks cover the low tier's indices in order.
  for (const T of [r.tall, r.low]) for (const i of T.index) assert.ok(i < T.verts);
  assert.equal(r.low.chunkCols, 1); assert.equal(r.low.chunkRows, 1);
  assert.equal(r.low.chunkStart[0], 0); assert.equal(r.low.chunkStart[1], r.low.index.length);
  // Aviation lights only on the 200 m tower: its four corners, 0.6 m above its top.
  assert.equal(r.lights.length / 5, 4);
  for (let k = 0; k < 4; k++) assert.equal(r.lights[k * 5 + 2], Math.fround(200.6));
  // Packed: radius and flags (the L is estimated).
  const packedL = r.tall.aB[r.tall.verts * 4 - 1];   // the last vertex is the L's roof
  assert.equal(Math.floor(packedL / 4096), 1);
  assert.equal(TALL_M, 35); assert.ok(AVIATION_M <= 200);
});

test('the low tier\'s chunks keep row-major order', () => {
  // Many small buildings over a 4 x 4 km box of 8 x 8 cells: two chunks a side.
  const extra = [];
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    const x = -2000 + i * 500 + 200, y = -2000 + j * 500 + 200;
    extra.push([15, 0, 0, [[x, y], [x + 20, y], [x + 20, y + 20], [x, y + 20]]]);
  }
  const recs = extra;
  const nv = recs.length * 4, buf = new ArrayBuffer(12 + recs.length * 8 + nv * 4), dv = new DataView(buf);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, recs.length, true); dv.setUint32(8, nv, true);
  let v = 12 + recs.length * 8;
  recs.forEach(([h, mh, fl, ring], i) => {
    dv.setUint16(12 + i * 8, h * 10, true); dv.setUint8(12 + i * 8 + 4, 4);
    for (const [x, y] of ring) { dv.setInt16(v, x * 2, true); dv.setInt16(v + 2, y * 2, true); v += 4; }
  });
  const info = { id: 'grid', origin: [0, 0], box: [-2000, -2000, 2000, 2000], cols: 8, rows: 8 };
  const r = buildCentre(parseCentre(buf), info);
  assert.equal(r.low.chunkCols, 2); assert.equal(r.low.chunkRows, 2);
  const per = (4 * 6 + 2 * 3) * 16;   // 16 buildings a chunk, 30 indices each
  assert.deepEqual([...r.low.chunkStart], [0, per, 2 * per, 3 * per, 4 * per]);
  // The first chunk's vertices are all in the south-west 2 km.
  for (let k = r.low.chunkStart[0]; k < r.low.chunkStart[1]; k++) {
    const vi = r.low.index[k];
    assert.ok(r.low.aP[vi * 4] / 2 < 0 && r.low.aP[vi * 4 + 1] / 2 < 0);
  }
  // rowRange: from the middle of the box with r = 1.5 km, both chunks of the lower row.
  assert.deepEqual(rowRange(info.box, 2000, 2, 0, 0, -100, 1500), [0, 1]);
  assert.deepEqual(rowRange(info.box, 2000, 2, 0, -1500, -1000, 400), [0, 0]);
  assert.equal(rowRange(info.box, 2000, 2, 1, 0, -1000, 900), null);
});

test('the mask rule, per 500 m cell', () => {
  assert.equal(maskRule(MASK_MIN_COUNT, MASK_MIN_COVER), true);
  assert.equal(maskRule(MASK_MIN_COUNT - 1, MASK_MIN_COVER), false);
  assert.equal(maskRule(50, MASK_MIN_COVER - 0.01), false);
  assert.equal(maskRule(2, MASK_BIG_COVER), true);
  // Twelve 23 x 23 m buildings in one cell (12 x 529 = 6,348 m², 2.5 %): not masked; twelve of
  // 46 x 46 m (25,392 m², 10.2 %): masked. One 230 x 230 m block (21 %) is masked alone.
  const mk = (side, n, x0, y0) => Array.from({ length: n }, (_, k) => {
    const x = x0 + (k % 4) * 110, y = y0 + Math.floor(k / 4) * 110;
    return [20, 0, 0, [[x, y], [x + side, y], [x + side, y + side], [x, y + side]]];
  });
  const recs = [...mk(23, 12, -990, -990), ...mk(46, 12, 10, -990), [20, 0, 0, [[-990, 10], [-760, 10], [-760, 240], [-990, 240]]]];
  const nv = recs.length * 4, buf = new ArrayBuffer(12 + recs.length * 8 + nv * 4), dv = new DataView(buf);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, recs.length, true); dv.setUint32(8, nv, true);
  let v = 12 + recs.length * 8;
  recs.forEach(([h, , , ring], i) => {
    dv.setUint16(12 + i * 8, h * 10, true); dv.setUint8(12 + i * 8 + 4, 4);
    for (const [x, y] of ring) { dv.setInt16(v, x * 2, true); dv.setInt16(v + 2, y * 2, true); v += 4; }
  });
  const info = { id: 'm', origin: [0, 0], box: [-1000, -1000, 1000, 1000], cols: 4, rows: 4 };
  const r = buildCentre(parseCentre(buf), info);
  // Cells: (0, 0) the small ones; (2, 0) the bigger ones; (0, 2) the block.
  assert.equal(r.cellCount[0], 12); assert.equal(r.mask[0], 0);
  assert.equal(r.cellCount[2], 12); assert.equal(r.mask[2], 1);
  assert.equal(r.mask[2 * 4], 1);
  assert.equal(r.masked, 2);
  assert.ok(Math.abs(r.cellCover[2] - 12 * 46 * 46 / (CELL_M * CELL_M)) < 1e-6);
});

test('the landmarks and the runways leave their records out', () => {
  const { buf, info } = synthetic();
  const p = parseCentre(buf);
  // A fake landmark list: one on the 200 m tower (map: origin + (-485, -485)), one far away.
  const [lat, lon] = [0, 0];
  const ex = landmarkExclusions([{ id: 'a', lat, lon, footprintM: 60 }, { id: 'bad' }]);
  assert.equal(ex.length, 1);
  const [lx, ly] = toMap(lat, lon);
  assert.equal(ex[0].x, lx); assert.equal(ex[0].y, ly); assert.equal(ex[0].r, 60);
  const r = buildCentre(p, info, { exclude: [{ x: 10000 - 485, y: 20000 - 485, r: 60 }, { x: 0, y: 0, r: 100 }] });
  assert.equal(r.skipped.landmark, 1);
  assert.equal(r.kept, 3);
  assert.equal(r.tall.count, 1);
  assert.equal(r.lights.length, 0);
  // With no list, nothing is left out.
  assert.equal(buildCentre(p, info, { exclude: landmarkExclusions(null) }).kept, 4);
  // A runway through the triangle (map 10,310, 20,310) heading east, 1,000 m long.
  const rwy = { cx: 10310, cy: 20000, dx: 1, dy: 0, halfLen: 500, halfWid: 30 };
  assert.equal(onRunwayZone([rwy], 10310, 20000 + 30 + 389), true);
  assert.equal(onRunwayZone([rwy], 10310, 20000 + 30 + 391), false);
  const r2 = buildCentre(p, info, { runways: [rwy] });
  assert.equal(r2.skipped.runway, 1);   // the triangle at y = +310 (within 420 m of the centreline)
});

test('the tiers\' helpers', () => {
  // The cut rises with distance, passes 35 m at about 12.5 km, 60 m at 27 km, 100 m at 55 km, and
  // hides everything beyond 60 km.
  let last = -1;
  for (let d = 0; d <= 70000; d += 500) { const c = tallCut(d); assert.ok(c >= last); last = c; }
  assert.ok(tallCut(11000) * 1.25 <= 35, 'every tall building full within 11 km');
  assert.ok(tallCut(27000) * 1.25 <= 60);
  assert.ok(tallCut(55000) * 1.25 <= 100);
  assert.ok(tallCut(60001) > 1000);
  assert.equal(CUT_KNOTS[0][1], 0);
  const top = [600, 300, 120, 60, 60, 36];
  assert.equal(countAtLeast(top, 60), 5); assert.equal(countAtLeast(top, 61), 3); assert.equal(countAtLeast(top, 0), 6); assert.equal(countAtLeast(top, 700), 0);
  assert.equal(boxDistance([0, 0, 10, 10], 5, 5), 0);
  assert.equal(boxDistance([0, 0, 10, 10], 13, 14), 5);
  // The flags: Korea's three with CITIES_ON alone, the six others with the region too.
  assert.equal(centreAllowed('seoul', true, false), true);
  assert.equal(centreAllowed('tokyo', true, false), false);
  assert.equal(centreAllowed('tokyo', true, true), true);
  assert.equal(centreAllowed('busan', false, true), false);
});

test('with CITIES_ON off nothing exists', () => {
  const was = CITIES_ON;
  setCities(false);                              // whatever the shipped default
  const added = [];
  const c = createCentres({ add: (o) => added.push(o), remove() {} }, {}, {}, {});
  assert.equal(added.length, 0);
  assert.equal(c.group, null);
  c.update({ camMap: { x: -43294, y: 170336 }, origin: { x: 0, y: 0 }, agl: 900 });
  assert.equal(c.stats.drawCalls, 0);
  assert.equal(c.maskAt(-43294, 170336), false);
  assert.equal(c.maskVersion(), 0);
  setCities(was);
});
