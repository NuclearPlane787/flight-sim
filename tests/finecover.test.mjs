// v0.6.0 Part 7: the fine land cover's data (data/terrain/fine/) and its window round the camera
// (src/world/finecover.js, the pure part). Skipped while the data isn't there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createFineWindow, subName, FINE_SUB, FINE_N, FINE_PX, FINE_CLASSES } from '../src/world/finecover.js';
import { toMap } from '../src/world/frame.js';

const DIR = new URL('../data/terrain/fine/', import.meta.url);
const HAVE = existsSync(new URL('fine.json', DIR));
const index = HAVE ? JSON.parse(readFileSync(new URL('fine.json', DIR), 'utf8')) : null;
const read = (si, sj) => new Uint8Array(gunzipSync(readFileSync(new URL(subName(si, sj) + '.u8.gz', DIR))));
const classAt = (fw, lat, lon) => {
  const [x, y] = toMap(lat, lon), [P, Q] = fw.pixelOf(x, y);
  const si = Math.floor(P / FINE_SUB), sj = Math.floor(Q / FINE_SUB), k = fw.kind(si, sj);
  if (k !== 'file') return k;
  return read(si, sj)[(Q - sj * FINE_SUB) * FINE_SUB + (P - si * FINE_SUB)];
};

test('fine cover: the index and the files agree; the classes are where the places are', { skip: !HAVE }, () => {
  assert.equal(index.px, FINE_PX); assert.equal(index.sub, FINE_SUB); assert.deepEqual(index.classes, FINE_CLASSES);
  // (1,110 files in v0.6.0; v0.6.3's 26 tiles add 394 and v0.6.4's ten add 108, each after the older ones, whose names and order stay.)
  assert.equal(index.files.length, 1612);
  for (const n of index.files.slice(0, 40).concat(index.files.slice(1110, 1150), index.files.slice(1504, 1544))) assert.ok(existsSync(new URL(n + '.u8.gz', DIR)), n);
  assert.equal(subName(-7, 5), '-2_1_1_1'); assert.equal(subName(8, -1), '2_-1_0_3');
  const fw = createFineWindow(index);
  const name = (c) => (c === null ? 'none' : FINE_CLASSES[c]);
  assert.equal(name(classAt(fw, 35.681, 139.767)), 'built', 'Tokyo Station');
  assert.equal(name(classAt(fw, 31.235, 121.475)), 'built', 'People\'s Square, Shanghai');
  assert.equal(name(classAt(fw, 37.5665, 126.978)), 'built', 'Seoul City Hall');
  assert.equal(name(classAt(fw, 35.25, 139.85)), 'water', 'Tokyo Bay\'s mouth');
  assert.equal(name(classAt(fw, 35.36, 138.73)), 'bare', 'Fuji\'s summit');
  assert.equal(name(classAt(fw, 33.36, 126.53)), 'tree', 'Hallasan\'s forest belt');
  assert.equal(name(classAt(fw, 31.0, 131.0)), 'water', 'open sea: a uniform sub-tile');
  assert.equal(name(classAt(fw, 45.3, 142.0)), 'none', 'Hokkaido\'s far north: outside the fine data (44.0 N 143.0 E until v0.6.4 took it in)');
  assert.equal(name(classAt(fw, 43.062, 141.354)), 'built', 'Sapporo\'s centre (v0.6.4)');
  // v0.6.3's tiles: Beijing, Paektu's crater lake, Vladivostok's centre.
  assert.equal(name(classAt(fw, 39.915, 116.44)), 'built', 'Beijing, east of the centre');
  assert.equal(name(classAt(fw, 42.006, 128.057)), 'water', 'Paektu\'s crater lake');
  assert.equal(name(classAt(fw, 43.118, 131.89)), 'built', 'Vladivostok\'s centre');
  // Every file is a megabyte of classes 0..7.
  const a = read(...fw.pixelOf(...toMap(35.681, 139.767)).map((v) => Math.floor(v / FINE_SUB)));
  assert.equal(a.length, FINE_SUB * FINE_SUB);
  assert.ok(a.every((v) => v <= 7));
});

test('fine cover: the window keeps 4 x 4 sub-tiles round the camera, nearest first, and says what is valid', { skip: !HAVE }, () => {
  const fw = createFineWindow(index);
  const [x, y] = toMap(35.55, 139.78);
  assert.equal(fw.moveTo(x, y), true);
  assert.equal(fw.moveTo(x, y), false);
  let miss = fw.missing();
  assert.equal(miss.length, 16);
  assert.deepEqual(miss[0], [fw.win.ci, fw.win.cj], 'the camera\'s own first');
  assert.ok(fw.win.ci >= fw.win.oi + 1 && fw.win.ci <= fw.win.oi + 2 && fw.win.cj >= fw.win.oj + 1 && fw.win.cj <= fw.win.oj + 2, 'the camera in the middle four');
  let v = fw.valid();
  assert.equal((v[2] - v[0]) * (v[3] - v[1]), 0, 'nothing valid yet');
  // Fill in order: the valid rectangle grows from the camera's sub-tile to the whole window.
  let last = 0;
  for (const [si, sj] of miss) {
    fw.filled.add(si + '_' + sj);
    v = fw.valid();
    const area = (v[2] - v[0]) * (v[3] - v[1]);
    assert.ok(area >= last); last = area;
  }
  assert.deepEqual([v[2] - v[0], v[3] - v[1]], [FINE_N, FINE_N]);
  const [P, Q] = fw.pixelOf(x, y);
  assert.ok(P - v[0] >= FINE_SUB && v[2] - P >= FINE_SUB && Q - v[1] >= FINE_SUB && v[3] - Q >= FINE_SUB, 'at least 32 km of fine cover every way');
  // Texels wrap: every sub-tile of the window has its own 1024-aligned texel.
  const seen = new Set();
  for (let sj = fw.win.oj; sj < fw.win.oj + 4; sj++) for (let si = fw.win.oi; si < fw.win.oi + 4; si++) {
    const [tx, ty] = fw.texelOf(si, sj);
    assert.ok(tx % FINE_SUB === 0 && ty % FINE_SUB === 0 && tx >= 0 && tx < FINE_N && ty >= 0 && ty < FINE_N);
    seen.add(tx + ',' + ty);
  }
  assert.equal(seen.size, 16);
  // Flying west: the window shifts a column at a time, keeps what it had, and never thrashes.
  let moves = 0;
  for (let s = 1; s <= 400; s++) {
    if (fw.moveTo(x - s * 500, y + Math.sin(s / 3) * 300)) {
      moves++;
      assert.ok(fw.missing().length <= 4, 'a column of four to load');
      for (const [si, sj] of fw.missing()) fw.filled.add(si + '_' + sj);
    }
    const w = fw.valid(), [p] = fw.pixelOf(x - s * 500, y);
    assert.ok(p - w[0] >= FINE_SUB / 2 && w[2] - p >= FINE_SUB / 2, 'the camera stays well inside');
  }
  assert.ok(moves >= 5 && moves <= 7, `200 km west: ${moves} moves`);
});
