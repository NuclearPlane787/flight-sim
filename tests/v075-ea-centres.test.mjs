// v0.7.5 part 6 (briefs/V0-7-5.md): Nagoya's and Hiroshima's real centres, and Osaka's box widened north over Itami's
// 32L final. Node only: the files against centres.json, their boxes round what they are for, their sizes, the
// published heights of Nagoya station's towers, the landmarks' exclusion, the triangles they build to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseCentre, recordMean, buildCentre } from '../src/world/centres-worker.js';
import { landmarkExclusions } from '../src/world/centres.js';
import { LANDMARKS } from '../src/world/landmarks.js';
import { toMap } from '../src/world/frame.js';

const DATA = new URL('../data/centres/', import.meta.url);
const INDEX = JSON.parse(readFileSync(new URL('centres.json', DATA)));
const byId = (id) => INDEX.centres.find((c) => c.id === id);
const load = (c) => parseCentre(gunzipSync(readFileSync(new URL(c.file, DATA))));
const inBox = (b, lat, lon) => { const [x, y] = toMap(lat, lon); return x > b[0] && x < b[2] && y > b[1] && y < b[3]; };

// [id, buildings (range), vertices (range), tallest m (range), KB at most, the places the box must take in]
const NEW = {
  nagoya: { count: [2000, 4000], verts: [12000, 30000], top: [240, 250], kb: 100,
    places: { castle: [35.185582, 136.899086], tvtower: [35.172298, 136.90834], station: [35.1709, 136.8815], midland: [35.1705, 136.8848] } },
  hiroshima: { count: [2000, 4000], verts: [10000, 30000], top: [150, 210], kb: 100,
    places: { dome: [34.395468, 132.45347], castle: [34.402681, 132.459033], station: [34.3976, 132.4753], peacepark: [34.3920, 132.4527] } },
};

test('v0.7.5: twenty centres, the two new ones last, Japan\'s', () => {
  assert.equal(INDEX.centres.length, 20);
  assert.deepEqual(INDEX.centres.slice(-2).map((c) => c.id), ['nagoya', 'hiroshima']);
  const src = readFileSync(new URL('../src/world/centres.js', import.meta.url), 'utf8');
  assert.match(src, /nagoya: 1, hiroshima: 1/, 'Japan\'s look (COUNTRY 1)');
});

for (const [id, w] of Object.entries(NEW)) {
  test(`v0.7.5: ${id}: the file against its entry, its box tight round the core, its size`, () => {
    const c = byId(id), p = load(c);
    assert.equal(p.count, c.count); assert.equal(p.vertexCount, c.vertices);
    assert.ok(c.count >= w.count[0] && c.count <= w.count[1], `${id}: ${c.count} buildings`);
    assert.ok(c.vertices >= w.verts[0] && c.vertices <= w.verts[1], `${id}: ${c.vertices} vertices`);
    assert.ok(c.maxHeightM >= w.top[0] && c.maxHeightM <= w.top[1], `${id}: tallest ${c.maxHeightM} m`);
    assert.equal(c.bytes, statSync(new URL(c.file, DATA)).size);
    assert.ok(c.bytes <= w.kb * 1024, `${id}: ${c.bytes} bytes`);
    assert.equal(c.minKeepHeightM, 12);
    // tight: under 4 x 4 km, every place inside
    assert.ok(c.box[2] - c.box[0] < 4000 && c.box[3] - c.box[1] < 4000, `${id}: box ${c.box}`);
    for (const [k, [la, lo]] of Object.entries(w.places)) assert.ok(inBox(c.box, la, lo), `${id}: ${k} outside the box`);
    // every record inside the box (its mean), heights sane
    let maxH = 0;
    for (let i = 0; i < p.count; i++) {
      const [mx, my] = recordMean(p, i), X = c.origin[0] + mx / 2, Y = c.origin[1] + my / 2;
      assert.ok(X >= c.box[0] - 30 && X <= c.box[2] + 30 && Y >= c.box[1] - 30 && Y <= c.box[3] + 30, `${id} ${i} outside`);   // (kept by the raw outline's centroid)
      maxH = Math.max(maxH, p.height[i] / 10);
    }
    assert.ok(Math.abs(maxH - c.maxHeightM) < 0.11);
  });
}

test('v0.7.5: Nagoya station\'s towers at their published heights (HEIGHT_FIX), not levels x 3.2 m', () => {
  const c = byId('nagoya'), p = load(c);
  const near = (x, y, r) => {   // map metres (the OSM outlines' centroids)
    let top = 0;
    for (let i = 0; i < p.count; i++) { const [mx, my] = recordMean(p, i); if (Math.hypot(c.origin[0] + mx / 2 - x, c.origin[1] + my / 2 - y) < r) top = Math.max(top, p.height[i] / 10); }
    return top;
  };
  assert.equal(near(852896, -51387, 60), 247, 'Midland Square (its part, OSM way 501414893)');
  assert.equal(near(852668, -51276, 25), 245, 'JR Central Towers, the office tower (OSM way 501412688)');
  assert.equal(near(852698, -51362, 20), 226, 'JR Central Towers, the hotel tower (OSM way 501412689)');
});

test('v0.7.5: the landmarks inside the new centres replace their buildings there', () => {
  const ex = landmarkExclusions(LANDMARKS);
  for (const [cid, lid, minH] of [['nagoya', 'nagoyatv', 170], ['nagoya', 'nagoyacastle', 12], ['hiroshima', 'abombdome', 12]]) {
    const c = byId(cid), p = load(c), L = LANDMARKS.find((l) => l.id === lid);
    const e = ex.find((q) => Math.hypot(q.x - L.x, q.y - L.y) < 1);
    assert.ok(e && e.r === L.footprintM, `${lid}: an exclusion of its footprint`);
    // the building the landmark stands for is in the file and inside the exclusion
    let found = false;
    for (let i = 0; i < p.count; i++) {
      const [mx, my] = recordMean(p, i);
      if (Math.hypot(c.origin[0] + mx / 2 - L.x, c.origin[1] + my / 2 - L.y) < 15 && p.height[i] / 10 >= minH) found = true;
    }
    assert.ok(found, `${lid}: its OSM building in ${cid}'s file`);
    const r0 = buildCentre(p, c), r1 = buildCentre(p, c, { exclude: [e] });
    assert.ok(r1.kept < r0.kept, `${lid}: buildings left out`);
  }
});

test('v0.7.5: the triangles the new centres build to (all of them: well inside the scene\'s million)', () => {
  for (const id of ['nagoya', 'hiroshima']) {
    const c = byId(id), r = buildCentre(load(c), c);
    const tris = r.tall.tris + r.low.tris;
    const full = 3 * c.vertices - 2 * c.count;   // 2 n walls and n - 2 roof triangles a building
    assert.ok(tris <= full && tris > 0.98 * full, `${id}: ${tris} of ${full}`);   // (degenerate rings aside)
    assert.ok(tris > 20000 && tris < 80000, `${id}: ${tris} triangles`);
  }
});

test('v0.7.5: Osaka\'s box takes in Itami\'s 32L final from 1.5 to 6 nm (Umeda, Shin-Osaka, Juso, Toyonaka\'s south)', () => {
  const c = byId('osaka');
  // the threshold (OurAirports: 34.7722 N, 135.4520 E), the final on 135 true
  const [tx, ty] = toMap(34.7722, 135.4520);
  const NM = 1852, dlat = Math.cos(135 * Math.PI / 180) / 111194, dlon = Math.sin(135 * Math.PI / 180) / (111194 * Math.cos(34.75 * Math.PI / 180));
  for (const nm of [1.5, 2, 3, 4, 5, 6]) assert.ok(inBox(c.box, 34.7722 + nm * NM * dlat, 135.4520 + nm * NM * dlon), `${nm} nm out is outside Osaka's box`);
  assert.ok(ty > c.box[3] && !(tx > c.box[0] && tx < c.box[2] && ty < c.box[3]), 'the threshold itself outside');
  for (const [k, la, lo] of [['Umeda', 34.7025, 135.4959], ['Shin-Osaka', 34.7335, 135.5003], ['Juso', 34.7206, 135.4826], ['Namba', 34.6660, 135.5013], ['Abeno', 34.6460, 135.5135]]) assert.ok(inBox(c.box, la, lo), k);
  assert.ok(c.count > 30000 && c.count < 45000 && c.vertices < 260000, `${c.count} buildings, ${c.vertices} vertices`);
});
