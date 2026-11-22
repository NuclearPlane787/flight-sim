// v0.7.6 part 5 (briefs/V0-7-6.md): Zaragoza's real centre, a tight core of at most 55,000 vertices (about 100,000
// triangles), installed in data/europe/centres/ beside the thirty-three of v0.7.0 to v0.7.3. The box round the old town
// between the Ebro and the Paseo de la Independencia (the Plaza del Pilar, La Seo, the stone bridge's two banks), the
// counts and sizes, the Pilar's own building in the file and left out round the landmark, the triangles it builds to, and
// the thirty-three older files byte-identical to the pushed v0.7.5 (their SHA-256, first 16 hex digits).
// Runs in a process opened in Europe (tests/region-run.mjs). FS_EU_CENTRES_DIR points it at a staging folder instead:
//   FS_REGION=europe FS_EU_CENTRES_DIR=<staging> node --test tests/v076-eu-centres.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { inRegion } from './region-run.mjs';

const OLD = {
  amsterdam: '55dce9d034355120', barcelona: '5cb2ef005af70dd8', berlin: 'f55ca40fe565ddc9', brussels: '972634ae789c16c5', cologne: '6e3cc89ff1f62838',
  copenhagen: '4287d406a0bead22', dublin: '814b20ecf5f68778', duesseldorf: '0482f726ae3943c2', edinburgh: 'ee1288bbdcb468bb', frankfurt: '0a95d615dafea5f1',
  geneva: 'bf23ec1f0fd62000', glasgow: 'b11bdbef3ee23aef', hamburg: '8fcafd5aa00c4259', lisbon: 'e7342ae2cef90e3c', london: '5201f7692c3d0d29',
  lyon: '33ae263480bc838a', madrid: 'fe7a32e0c241bcd8', manchester: 'aded6f5adb4dba1a', marseille: 'c2edb25958666656', milan: '7c7ba38fd3eb0e31',
  munich: 'bda986ee253c2e58', nantes: '47531130271e7745', naples: 'e0f8d36b88be7194', nice: 'a94450779167ad09', paris: '82a5747565d4faa9',
  porto: '5d4300e246ce5cd9', prague: 'b403772c6ab378ac', rome: '818204b55abfea98', santiago: '851d90cd6426852b', toulouse: '8c9f845ded07e3ab',
  venice: '60256b1875da0a43', vienna: 'f95e6e591802b83d', zurich: 'c1c25b902d192476',
};
// The places the box must take in (lat, lon): the Pilar (OSM's outline), La Seo, the stone bridge's two ends, the Paseo de
// la Independencia at the Plaza de España and at the Plaza de Aragón, the Mercado Central.
const PLACES = {
  pilar: [41.656771, -0.878523], seo: [41.6545, -0.8760], bridgeSouth: [41.6567, -0.8762], bridgeNorth: [41.6597, -0.8752],
  plazaEspana: [41.6513, -0.8800], plazaAragon: [41.6458, -0.8833], mercado: [41.6553, -0.8826],
};

if (inRegion('europe', import.meta.url)) {
  const { toMap } = await import('../src/world/frame.js');
  const { parseCentre, recordMean, buildCentre } = await import('../src/world/centres-worker.js');
  const { landmarkExclusions } = await import('../src/world/centres.js');
  const { EUROPE_LANDMARKS } = await import('../src/world/landmarks.js');
  const dir = process.env.FS_EU_CENTRES_DIR;
  const DATA = dir ? pathToFileURL(dir.endsWith('/') ? dir : dir + '/') : new URL('../data/europe/centres/', import.meta.url);
  const idxUrl = new URL('centres.json', DATA);
  const INDEX = existsSync(idxUrl) ? JSON.parse(readFileSync(idxUrl, 'utf8')) : { centres: [] };
  const c = INDEX.centres.find((e) => e.id === 'zaragoza');
  const load = () => parseCentre(gunzipSync(readFileSync(new URL(c.file, DATA))));
  const skip = !c && 'Zaragoza not installed yet';

  test("v0.7.6: thirty-four centres, Zaragoza last, Spain's look", { skip }, () => {
    assert.equal(INDEX.centres.length, 34);
    assert.equal(INDEX.centres.at(-1).id, 'zaragoza');
    const ids = INDEX.centres.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, 'one entry per id');
    assert.deepEqual(ids.slice(0, 33).sort(), Object.keys(OLD).sort());
    const src = readFileSync(new URL('../src/world/centres.js', import.meta.url), 'utf8');
    assert.match(src, /zaragoza: 4,/, "Zaragoza takes the south's look (4) in COUNTRY");
  });

  test('v0.7.6: the thirty-three older centres byte-identical to the pushed v0.7.5', { skip: dir ? 'a staging folder' : false }, () => {
    for (const [id, h] of Object.entries(OLD)) {
      const got = createHash('sha256').update(readFileSync(new URL(`${id}.bin.gz`, DATA))).digest('hex').slice(0, 16);
      assert.equal(got, h, id);
    }
  });

  test("v0.7.6: Zaragoza's box tight round the old town and the Paseo, inside the core budget", { skip }, () => {
    const [x0, y0, x1, y1] = c.box;
    for (const [k, [la, lo]] of Object.entries(PLACES)) {
      const [x, y] = toMap(la, lo);
      assert.ok(x > x0 && x < x1 && y > y0 && y < y1, `${k}: (${x.toFixed(0)}, ${y.toFixed(0)}) outside ${c.box}`);
    }
    assert.ok(x1 - x0 <= 3200 && y1 - y0 <= 3200, `box ${x1 - x0} x ${y1 - y0} m, not a tight core`);
    assert.ok(c.count > 3000 && c.count < 8000, `${c.count} buildings`);
    assert.ok(c.vertices <= 55000, `${c.vertices} vertices`);
    assert.ok(c.bytes <= 200000, `${c.bytes} bytes`);
    assert.equal(statSync(new URL(c.file, DATA)).size, c.bytes, 'file size');
    assert.ok(c.maxHeightM > 90 && c.maxHeightM < 100, `tallest ${c.maxHeightM} m (the Pilar's towers, OSM)`);
  });

  test("v0.7.6: Zaragoza parses to the index; the Pilar's own building in the file and left out round the landmark", { skip }, () => {
    const p = load();
    assert.equal(p.count, c.count);
    assert.equal(p.vertexCount, c.vertices);
    let maxH = 0;
    for (let i = 0; i < p.count; i++) { assert.ok(p.nVerts[i] >= 3, `${i}`); maxH = Math.max(maxH, p.height[i] / 10); }
    assert.ok(Math.abs(maxH - c.maxHeightM) < 0.11);
    const L = EUROPE_LANDMARKS.find((l) => l.id === 'pilar');
    const e = landmarkExclusions(EUROPE_LANDMARKS).find((q) => Math.hypot(q.x - L.x, q.y - L.y) < 1);
    assert.ok(e && e.r === L.footprintM, 'the Pilar\'s exclusion disc');
    let inside = 0, tall = 0;
    for (let i = 0; i < p.count; i++) {
      const [mx, my] = recordMean(p, i);
      if (Math.hypot(c.origin[0] + mx / 2 - L.x, c.origin[1] + my / 2 - L.y) < e.r) { inside++; if (p.height[i] / 10 > 80) tall++; }
    }
    assert.ok(inside > 0 && tall > 0, `the basilica's parts in the file (${inside}, ${tall} over 80 m)`);
    const r0 = buildCentre(p, c, { exclude: [], runways: [] }), r1 = buildCentre(p, c, { exclude: [e], runways: [] });
    assert.equal(r0.kept - r1.kept, inside, 'every record inside the disc left out');
  });

  test("v0.7.6: Zaragoza's triangles (well inside the scene's million)", { skip }, () => {
    const r = buildCentre(load(), c, { exclude: [], runways: [] });
    const tris = r.tall.tris + r.low.tris;
    const full = 3 * c.vertices - 2 * c.count;
    assert.ok(tris <= full && tris > 0.98 * full, `${tris} of ${full}`);
    assert.ok(tris > 50000 && tris < 120000, `${tris} triangles`);
    console.log('# zaragoza triangles', tris);
  });
}
