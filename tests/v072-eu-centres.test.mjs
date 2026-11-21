// v0.7.2: Europe's nine more real centres (briefs/V0-7-2.md part 4: Duesseldorf, Cologne, Prague, Geneva, Nice,
// Edinburgh, Glasgow, Nantes, Santiago de Compostela), each a tight core of at most 55,000 vertices (about 100,000
// triangles), as installed in data/europe/centres/ beside the eighteen of v0.7.0 and v0.7.1. Runs in a process opened in Europe (tests/region-run.mjs). Skips while
// none of the nine is in the index. FS_EU_CENTRES_DIR points it at another folder (a staging bake) instead:
//   FS_REGION=europe FS_EU_CENTRES_DIR=<staging> node --test tests/v072-eu-centres.test.mjs
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

  // Each city's place (lat, lon) and the landmark each core is round.
  const PLACES = {
    duesseldorf: [51.2254, 6.7763], cologne: [50.9413, 6.9583], prague: [50.0870, 14.4208], geneva: [46.2017, 6.1466],
    nice: [43.6961, 7.2760], edinburgh: [55.9500, -3.1900], glasgow: [55.8609, -4.2502], nantes: [47.2161, -1.5500],
    santiago: [42.8806, -8.5446],
  };
  const NEW = INDEX.centres.filter((c) => c.id in PLACES);
  const have = NEW.length > 0;
  const MAX_TRIS = 160000, MAX_VERTS = 56100, MAX_BYTES = 250000;

  test("Europe's v0.7.2 centres: all nine, each round its city, inside the core budget", { skip: !have && 'none of the nine installed yet' }, () => {
    assert.deepEqual(NEW.map((c) => c.id).sort(), Object.keys(PLACES).sort());
    const ids = INDEX.centres.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, 'one entry per id');
    assert.ok(ids.length >= 27, `${ids.length} centres: the eighteen and the nine`);
    for (const c of NEW) {
      const [x, y] = toMap(...PLACES[c.id]);
      const [x0, y0, x1, y1] = c.box;
      assert.ok(x0 <= x && x <= x1 && y0 <= y && y <= y1, `${c.id}: the place (${x.toFixed(0)}, ${y.toFixed(0)}) outside its box ${c.box}`);
      assert.ok(x1 - x0 <= 6000 && y1 - y0 <= 6000, `${c.id}: box ${x1 - x0} x ${y1 - y0} m, not a tight core`);
      assert.ok(x0 <= c.origin[0] && c.origin[0] <= x1 && y0 <= c.origin[1] && c.origin[1] <= y1, c.id);
      assert.ok(c.count > 1000 && c.count <= 40000, `${c.id}: ${c.count} buildings`);
      assert.ok(c.vertices <= MAX_VERTS, `${c.id}: ${c.vertices} vertices`);
      assert.ok(c.bytes <= MAX_BYTES, `${c.id}: ${c.bytes} bytes`);
      assert.equal(statSync(new URL(c.file, DATA)).size, c.bytes, `${c.id}: file size`);
    }
  });

  test("Europe's v0.7.2 centres parse to the index and build under 160,000 triangles each", { skip: !have && 'none installed yet' }, () => {
    for (const c of NEW) {
      const p = parseCentre(gunzipSync(readFileSync(new URL(c.file, DATA))));
      assert.equal(p.count, c.count, c.id);
      assert.equal(p.vertexCount, c.vertices, c.id);
      let maxH = 0, low = 0;
      for (let i = 0; i < p.count; i++) {
        assert.ok(p.nVerts[i] >= 3, `${c.id} ${i}`);
        maxH = Math.max(maxH, p.height[i] / 10);
        if (p.height[i] / 10 < c.minKeepHeightM) low++;
      }
      assert.ok(Math.abs(maxH - c.maxHeightM) < 0.11, `${c.id}: max ${maxH} vs ${c.maxHeightM}`);
      assert.ok(low / p.count < 0.08, `${c.id}: ${low} of ${p.count} under the keep height (only the area floor's)`);
      const r = buildCentre(p, c, { exclude: [], runways: [] });
      const tris = r.tall.tris + r.low.tris;
      assert.ok(tris > 0 && tris <= MAX_TRIS, `${c.id}: ${tris} triangles`);
    }
  });
}
