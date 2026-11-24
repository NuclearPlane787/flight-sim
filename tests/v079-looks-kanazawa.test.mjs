// v0.7.9 part 8, item 3 (briefs/V0-7-9.md; data with no switch): Kanazawa's centre told from its town. v0.7.8 kept only
// the buildings of 12 m or more (965 of the 7,115 OSM maps in its box) and the generated town is left out inside a real
// centre's box, so the centre stood sparser than the town round it. tools/bake_region_buildings.py's MIN_THR keeps every
// building for Kanazawa (OSM's heights and levels where tagged, 4,777 of them; the bake's [EST] by footprint and the
// neighbourhood's median for the rest). Here: the index's other twenty entries v0.7.8's, Kanazawa's entry against its
// file, the centre about seven times as dense as before round its middle, within a triangle budget. Node only.
// FS_V079_CENTRES=<folder> reads the index and file from a staging folder instead of data/centres/ (the bake's proof
// before the install). Skipped while the installed file is still v0.7.8's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { parseCentre, recordMean, buildCentre, MAGIC } from '../src/world/centres-worker.js';
import { toMap } from '../src/world/frame.js';

const DATA = process.env.FS_V079_CENTRES ? pathToFileURL(process.env.FS_V079_CENTRES.replace(/\/?$/, '/')) : new URL('../data/centres/', import.meta.url);
const INDEX = JSON.parse(readFileSync(new URL('centres.json', DATA)));
const c = INDEX.centres.find((e) => e.id === 'kanazawa');
const OTHERS_V078 = '2259f45263733ee4a3016a6432160f34b757cb1ca85e849400fae660db4a351f';   // the twenty others' entries, v0.7.8's
const FILE_V079 = 'af60b34ef37bbf7457b60284cd91c3cc7ee424af9656e16af0d4f113760c7286';
const old = c && c.minKeepHeightM === 12;

test('v0.7.9 looks, Kanazawa: the other twenty centres\' entries are v0.7.8\'s, in the same order', () => {
  assert.equal(INDEX.centres.length, 21);
  const o = INDEX.centres.filter((e) => e.id !== 'kanazawa');
  assert.equal(createHash('sha256').update(JSON.stringify(o)).digest('hex'), OTHERS_V078);
  assert.equal(INDEX.centres[20].id, 'kanazawa');
});

test('v0.7.9 looks, Kanazawa: every building kept, the file against its entry, dense round the middle, in budget', { skip: old ? 'the installed Kanazawa is still v0.7.8\'s (the lead installs v0.7.9\'s)' : false }, () => {
  const buf = readFileSync(new URL(c.file, DATA));
  assert.equal(createHash('sha256').update(buf).digest('hex'), FILE_V079);
  const raw = gunzipSync(buf);
  assert.equal(new DataView(raw.buffer, raw.byteOffset).getUint32(0, true), MAGIC, 'FSB1, as East Asia\'s other centres');
  const p = parseCentre(raw);
  assert.equal(p.count, c.count); assert.equal(p.vertexCount, c.vertices);
  assert.equal(c.minKeepHeightM, 0);
  assert.equal(c.bytes, statSync(new URL(c.file, DATA)).size);
  assert.ok(c.maxHeightM >= 100 && c.maxHeightM <= 140, `tallest ${c.maxHeightM} m (Porte Kanazawa, 131 m)`);
  const [cx, cy] = toMap(36.567, 136.656);
  let near = 0;
  for (let i = 0; i < p.count; i++) {
    const [mx, my] = recordMean(p, i);
    if (Math.hypot(c.origin[0] + mx / 2 - cx, c.origin[1] + my / 2 - cy) < 1000) near++;
  }
  assert.ok(near > 4 * 516, `${near} buildings within 1 km of the middle (v0.7.8: 516)`);
  const r = buildCentre(p, c, {});
  assert.ok(r.tall.tris + r.low.tris < 260000, `${r.tall.tris + r.low.tris} triangles`);
});
