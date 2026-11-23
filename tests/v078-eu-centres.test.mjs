// v0.7.8, part 6's last item (v0.7.6's "if time is left"): Kaiserslautern's real centre, the thirty-fifth in Europe, a
// tight core by Ramstein's finals. Geofabrik's Rhineland-Palatinate extract, which gave v0.7.6 a 404, could be had
// (europe/germany/rheinland-pfalz/). FSB2, as Europe's others since v0.7.7. Runs in a process opened in Europe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url)) {
  const { toMap } = await import('../src/world/frame.js');
  const { parseCentre, buildCentre } = await import('../src/world/centres-worker.js');
  const DATA = new URL('../data/europe/centres/', import.meta.url);
  const INDEX = JSON.parse(readFileSync(new URL('centres.json', DATA), 'utf8'));
  const c = INDEX.centres.find((e) => e.id === 'kaiserslautern');
  // (lat, lon): the town hall's tower, the Stiftskirche, the main station, the stadium on the Betzenberg
  const PLACES = { rathaus: [49.4459, 7.7672], stiftskirche: [49.4447, 7.7700], station: [49.4360, 7.7690], stadium: [49.4346, 7.7767] };

  test('thirty-five centres, Kaiserslautern last; its box takes in the old town, the station and the Betzenberg', () => {
    assert.equal(INDEX.centres.length, 35);
    assert.equal(INDEX.centres.at(-1).id, 'kaiserslautern');
    assert.ok(c.count > 2500 && c.count < 5000 && c.vertices <= 55000 && c.bytes < 120000, JSON.stringify(c));
    for (const [k, [la, lo]] of Object.entries(PLACES)) {
      const [x, y] = toMap(la, lo);
      assert.ok(x > c.box[0] && x < c.box[2] && y > c.box[1] && y < c.box[3], k);
    }
    assert.ok((c.box[2] - c.box[0]) < 3200 && (c.box[3] - c.box[1]) < 3200, 'a tight box');
    assert.ok(c.maxHeightM >= 75 && c.maxHeightM <= 90, `the town hall's tower: ${c.maxHeightM} m`);   // 84 m, OSM's 80
  });

  test('the file is FSB2, parses with its courtyards and builds within the core\'s budget', () => {
    const b = gunzipSync(readFileSync(new URL(c.file, DATA)));
    assert.equal(b.subarray(0, 4).toString('latin1'), 'FSB2');
    const p = parseCentre(b, { holes: true });
    assert.equal(p.count, c.count);
    assert.equal(c.holes, 9);
    const r = buildCentre(p, c, { holes: true });
    const tris = (r.tall.index.length + r.low.index.length) / 3;
    assert.ok(tris > 20000 && tris < 150000, `${tris} triangles`);
    const off = buildCentre(parseCentre(b), c);
    assert.ok((off.tall.index.length + off.low.index.length) / 3 <= tris, 'the courtyards add triangles, never take them');
  });

  test('its look is Germany\'s stone and plaster under grey roofs (centres.js COUNTRY)', async () => {
    const src = readFileSync(new URL('../src/world/centres.js', import.meta.url), 'utf8');
    assert.match(src, /kaiserslautern: 3,/);
    assert.match(src, /frankfurt: 3,/);
  });
}
