// v0.7.0: Europe's nine real centres (briefs/V0-7-0.md Part 6) as installed in data/europe/centres/, from a process
// opened in Europe (tests/region-run.mjs runs this file in one from the default suite). Skips while the index is empty
// (it is until the bake is installed). FS_EU_CENTRES_DIR points it at another folder (a staging bake) instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url)) {
  const { toMap } = await import('../src/world/frame.js');
  const { parseCentre, buildCentre } = await import('../src/world/centres-worker.js');
  const dir = process.env.FS_EU_CENTRES_DIR;
  const DATA = dir ? pathToFileURL(dir.endsWith('/') ? dir : dir + '/') : new URL('../data/europe/centres/', import.meta.url);
  const idxUrl = new URL('centres.json', DATA);
  const INDEX = existsSync(idxUrl) ? JSON.parse(readFileSync(idxUrl, 'utf8')) : { centres: [] };
  const have = INDEX.centres.length > 0;

  // Each city's place (lat, lon: what the box is round) and the brief's budget (Tokyo's: 39,911 buildings,
  // 271,578 vertices, 979 KB; all nine under about 6 MB).
  const PLACES = {
    london: [51.5072, -0.1276], paris: [48.8566, 2.3522], frankfurt: [50.1109, 8.6821], madrid: [40.4168, -3.7038],
    zurich: [47.3769, 8.5417], amsterdam: [52.3730, 4.8924], munich: [48.1374, 11.5755], barcelona: [41.3874, 2.1686],
    rome: [41.8967, 12.4822],
  };
  const TOWERS = ['london', 'paris', 'frankfurt', 'madrid'];
  const MAX_COUNT = 40000, MAX_VERTS = 271578 * 1.02, MAX_BYTES = 1000000, MAX_TOTAL = 6000000;

  test("Europe's centres: the nine, each round its city, inside the budget", { skip: !have && 'data/europe/centres/centres.json is empty until the bake is installed' }, () => {
    assert.deepEqual(INDEX.centres.map((c) => c.id).sort(), Object.keys(PLACES).sort());
    let total = 0;
    for (const c of INDEX.centres) {
      const [x, y] = toMap(...PLACES[c.id]);
      const [x0, y0, x1, y1] = c.box;
      assert.ok(x0 <= x && x <= x1 && y0 <= y && y <= y1, `${c.id}: the city's place (${x.toFixed(0)}, ${y.toFixed(0)}) outside its box ${c.box}`);
      assert.ok(x1 - x0 <= 12000 && y1 - y0 <= 12000, `${c.id}: box ${x1 - x0} x ${y1 - y0} m, too big for one centre`);
      // the origin inside the box, and every stored vertex within i16 half-metres of it
      assert.ok(x0 <= c.origin[0] && c.origin[0] <= x1 && y0 <= c.origin[1] && c.origin[1] <= y1, c.id);
      const [S, W, N, E] = c.latlon;
      assert.ok(S < PLACES[c.id][0] + 0.06 && N > PLACES[c.id][0] - 0.06 && W < PLACES[c.id][1] + 0.1 && E > PLACES[c.id][1] - 0.1, `${c.id}: latlon ${c.latlon}`);
      assert.ok(c.count > 3000 && c.count <= MAX_COUNT, `${c.id}: ${c.count} buildings`);
      assert.ok(c.vertices <= MAX_VERTS, `${c.id}: ${c.vertices} vertices`);
      assert.ok(c.bytes <= MAX_BYTES, `${c.id}: ${c.bytes} bytes`);
      const size = statSync(new URL(c.file, DATA)).size;
      assert.equal(size, c.bytes, `${c.id}: file size`);
      total += size;
    }
    assert.ok(total <= MAX_TOTAL, `the nine: ${total} bytes`);
  });

  test("Europe's centres parse to the index, and the tower clusters stand over 150 m", { skip: !have && 'no centres installed yet' }, () => {
    for (const c of INDEX.centres) {
      const p = parseCentre(gunzipSync(readFileSync(new URL(c.file, DATA))));
      assert.equal(p.count, c.count, c.id);
      assert.equal(p.vertexCount, c.vertices, c.id);
      let maxH = 0, lowH = 0;
      for (let i = 0; i < p.count; i++) {
        assert.ok(p.nVerts[i] >= 3, `${c.id} ${i}`);
        maxH = Math.max(maxH, p.height[i] / 10);
        if (p.height[i] / 10 < 9) lowH++;
      }
      assert.ok(Math.abs(maxH - c.maxHeightM) < 0.11, `${c.id}: max ${maxH} vs ${c.maxHeightM}`);
      if (TOWERS.includes(c.id)) assert.ok(maxH > 150, `${c.id}: tallest ${maxH} m`);
      // The keep rule: under its height threshold only the big (area floor) are kept, a few percent at most.
      assert.ok(lowH / p.count < 0.05, `${c.id}: ${lowH} of ${p.count} under 9 m`);
    }
  });

  test("Europe's centres build in the worker's builder, each under 800,000 triangles", { skip: !have && 'no centres installed yet' }, () => {
    for (const c of INDEX.centres) {
      const p = parseCentre(gunzipSync(readFileSync(new URL(c.file, DATA))));
      const r = buildCentre(p, c, { exclude: [], runways: [] });
      const tris = r.tall.tris + r.low.tris;
      assert.ok(tris > 0 && tris < 800000, `${c.id}: ${tris} triangles`);
    }
  });
}
