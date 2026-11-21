// v0.7.1: Europe's nine more real centres (briefs/V0-7-1.md part 5: Toulouse, Berlin, Milan, Vienna, Brussels, Dublin,
// Lisbon, Copenhagen, Manchester), each a tight core of about 150,000 triangles at most, as installed in
// data/europe/centres/ beside v0.7.0's nine. Runs in a process opened in Europe (tests/region-run.mjs). Skips while
// none of the nine is in the index. FS_EU_CENTRES_DIR points it at another folder (a staging bake) instead:
//   FS_REGION=europe FS_EU_CENTRES_DIR=<staging> node --test tests/v071-eu-centres.test.mjs
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
    toulouse: [43.6045, 1.4440], berlin: [52.5163, 13.3777], milan: [45.4642, 9.1900], vienna: [48.2085, 16.3731],
    brussels: [50.8467, 4.3525], dublin: [53.3498, -6.2603], lisbon: [38.7139, -9.1394], copenhagen: [55.6761, 12.5683],
    manchester: [53.4794, -2.2453],
  };
  const NEW = INDEX.centres.filter((c) => c.id in PLACES);
  const have = NEW.length > 0;
  const MAX_TRIS = 160000, MAX_VERTS = 56100, MAX_BYTES = 250000;

  test("Europe's v0.7.1 centres: all nine, each round its city, inside the core budget", { skip: !have && 'none of the nine installed yet' }, () => {
    assert.deepEqual(NEW.map((c) => c.id).sort(), Object.keys(PLACES).sort());
    const ids = INDEX.centres.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, 'one entry per id');
    for (const c of NEW) {
      const [x, y] = toMap(...PLACES[c.id]);
      const [x0, y0, x1, y1] = c.box;
      assert.ok(x0 <= x && x <= x1 && y0 <= y && y <= y1, `${c.id}: the place (${x.toFixed(0)}, ${y.toFixed(0)}) outside its box ${c.box}`);
      assert.ok(x1 - x0 <= 6000 && y1 - y0 <= 6000, `${c.id}: box ${x1 - x0} x ${y1 - y0} m, not a tight core`);
      assert.ok(x0 <= c.origin[0] && c.origin[0] <= x1 && y0 <= c.origin[1] && c.origin[1] <= y1, c.id);
      assert.ok(c.count > 1500 && c.count <= 40000, `${c.id}: ${c.count} buildings`);
      assert.ok(c.vertices <= MAX_VERTS, `${c.id}: ${c.vertices} vertices`);
      assert.ok(c.bytes <= MAX_BYTES, `${c.id}: ${c.bytes} bytes`);
      assert.equal(statSync(new URL(c.file, DATA)).size, c.bytes, `${c.id}: file size`);
    }
  });

  test("Europe's v0.7.1 centres parse to the index and build under about 150,000 triangles each", { skip: !have && 'none installed yet' }, () => {
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
