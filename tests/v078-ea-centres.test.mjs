// v0.7.8 part 5, item 3 (briefs/V0-7-8.md): Kanazawa's real centre, boxed tightly round the station, the castle, Kenrokuen
// and Korinbo (tools/bake_region_buildings.py's CENTRES; FSB1 as East Asia's others). Cheongju was baked and left out: the
// Korea extract on disk maps too few buildings there (164 kept, nearly all estimated 12 m blocks). Node only.
// FS_V078_CENTRES=<folder> reads the index and file from a staging folder instead of data/centres/ (the bake's proof
// before the install).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parseCentre, recordMean, buildCentre, MAGIC } from '../src/world/centres-worker.js';
import { toMap } from '../src/world/frame.js';

const DATA = process.env.FS_V078_CENTRES ? pathToFileURL(process.env.FS_V078_CENTRES.replace(/\/?$/, '/')) : new URL('../data/centres/', import.meta.url);
const INDEX = JSON.parse(readFileSync(new URL('centres.json', DATA)));
const c = INDEX.centres.find((e) => e.id === 'kanazawa');
const raw = c ? gunzipSync(readFileSync(new URL(c.file, DATA))) : null;
const inBox = (b, lat, lon) => { const [x, y] = toMap(lat, lon); return x > b[0] && x < b[2] && y > b[1] && y < b[3]; };

test('v0.7.8: twenty-one centres, Kanazawa last, Japan\'s look; no Cheongju', () => {
  assert.equal(INDEX.centres.length, 21);
  assert.deepEqual(INDEX.centres.slice(-3).map((e) => e.id), ['nagoya', 'hiroshima', 'kanazawa']);
  assert.ok(!INDEX.centres.some((e) => e.id === 'cheongju'));
  const src = readFileSync(new URL('../src/world/centres.js', import.meta.url), 'utf8');
  assert.match(src, /kanazawa: 1,/);
});

test('v0.7.8: Kanazawa: FSB1, the file against its entry, a tight box round its places, a small file', () => {
  assert.ok(c, 'kanazawa in centres.json');
  assert.equal(new DataView(raw.buffer, raw.byteOffset).getUint32(0, true), MAGIC, 'FSB1, as East Asia\'s other centres');
  const p = parseCentre(raw);
  assert.equal(p.count, c.count); assert.equal(p.vertexCount, c.vertices);
  // (v0.7.9 looks: every building kept for Kanazawa, minKeepHeightM 0, 7,115 buildings in about 160 KB and 128k
  // triangles; tests/v079-looks-kanazawa.test.mjs holds that file. v0.7.8's own limits for its 12 m file.)
  const v079 = c.minKeepHeightM === 0;
  assert.ok(v079 ? c.count >= 6000 && c.count <= 8000 : c.count >= 600 && c.count <= 2000, `${c.count} buildings`);
  assert.ok(c.maxHeightM >= 100 && c.maxHeightM <= 140, `tallest ${c.maxHeightM} m (Porte Kanazawa, 131 m)`);
  assert.equal(c.bytes, statSync(new URL(c.file, DATA)).size);
  assert.ok(c.bytes <= (v079 ? 200 : 60) * 1024, `${c.bytes} bytes`);
  if (!v079) assert.equal(c.minKeepHeightM, 12);
  assert.ok(c.box[2] - c.box[0] < 3500 && c.box[3] - c.box[1] < 3500, `box ${c.box}`);
  const places = { station: [36.5781, 136.6480], castle: [36.5653, 136.6596], kenrokuen: [36.5621, 136.6626], korinbo: [36.5619, 136.6556] };
  for (const [k, [la, lo]] of Object.entries(places)) assert.ok(inBox(c.box, la, lo), `${k} outside the box`);
  let maxH = 0;
  for (let i = 0; i < p.count; i++) {
    const [mx, my] = recordMean(p, i), X = c.origin[0] + mx / 2, Y = c.origin[1] + my / 2;
    assert.ok(X >= c.box[0] - 30 && X <= c.box[2] + 30 && Y >= c.box[1] - 30 && Y <= c.box[3] + 30, `${i} outside`);
    maxH = Math.max(maxH, p.height[i] / 10);
  }
  assert.ok(Math.abs(maxH - c.maxHeightM) < 0.11);
});

test('v0.7.8: Kanazawa builds, within a small budget of triangles', () => {
  const r = buildCentre(parseCentre(raw), c, {});
  assert.equal(r.kept, c.count - r.skipped.degenerate);
  assert.ok(r.tall.tris + r.low.tris < 150000, `${r.tall.tris + r.low.tris} triangles`);
});
