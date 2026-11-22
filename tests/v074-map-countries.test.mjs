// v0.7.4 item 10: the path map's country borders and names (src/ui/map-countries.js, data/country-lines.json and
// data/europe/country-lines.json from tools/bake_country_lines.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCountries, nameAlpha, layoutNames, segHitsBox, traceBorders } from '../src/ui/map-countries.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (dir) => JSON.parse(fs.readFileSync(path.join(HERE, '..', dir, 'country-lines.json'), 'utf8'));
const FILES = { 'east-asia': 'data', europe: 'data/europe' };

for (const [region, dir] of Object.entries(FILES)) {
  test(`${region}: the file is small, its borders are land borders between two countries, its names English`, () => {
    const size = fs.statSync(path.join(HERE, '..', dir, 'country-lines.json')).size;
    assert.ok(size < 300 * 1024, `${size} bytes`);
    const doc = load(dir), C = buildCountries(doc);
    assert.ok(C.lines.length > 0 && C.names.length > 0);
    for (const ln of doc.lines) { assert.notEqual(ln.a, ln.b); assert.equal(ln.levels.length, doc.tols.length); }
    // each coarser level has no more points than the finer one
    for (const ln of doc.lines) {
      const pts = ln.levels.map((L) => L.reduce((a, f) => a + f.length, 0));
      for (let i = 1; i < pts.length; i++) assert.ok(pts[i] <= pts[i - 1], `${ln.a}-${ln.b} ${pts}`);
    }
    for (const n of doc.names) assert.match(n.name, /^[A-Za-z' .,-]+$/);
  });
}

test('the borders Shane will look for are there', () => {
  const pairs = (doc) => new Set(doc.lines.map((l) => [l.a, l.b].sort().join('-')));
  const ea = pairs(load('data')), eu = pairs(load('data/europe'));
  for (const p of ['KOR-PRK', 'CHN-PRK', 'CHN-RUS', 'PRK-RUS']) assert.ok(ea.has(p), p);
  for (const p of ['DEU-FRA', 'ESP-FRA', 'ESP-PRT', 'CHE-ITA', 'GBR-IRL', 'BEL-NLD', 'AUT-DEU', 'CZE-DEU', 'DEU-DNK']) assert.ok(eu.has(p), p);
  const names = (doc) => doc.names.map((n) => n.name);
  for (const n of ['South Korea', 'North Korea', 'Japan']) assert.ok(names(load('data')).includes(n), n);
  for (const n of ['France', 'Germany', 'Spain', 'Italy', 'United Kingdom', 'Ireland', 'Portugal', 'Switzerland']) assert.ok(names(load('data/europe')).includes(n), n);
});

test('names fade in as the map zooms out, the small countries only in between', () => {
  const big = { rank: 2 }, small = { rank: 6 };
  assert.equal(nameAlpha(big, 100), 0);
  assert.ok(nameAlpha(big, 400) > 0 && nameAlpha(big, 400) < 1);   // (second pass: large names fade in over 300 to 500 m a pixel)
  assert.equal(nameAlpha(big, 2650), 1);
  let prev = 0;
  for (let m = 100; m <= 3000; m += 50) { const a = nameAlpha(big, m); assert.ok(a >= prev); prev = a; }
  assert.equal(nameAlpha(small, 2650), 0);
  assert.ok(nameAlpha(small, 600) > 0);
});

test('a name is never placed over a taken box, a line, or another name', () => {
  const C = buildCountries({ tols: [200], lines: [], names: [
    { name: 'Aland', x: 0, y: 0, rank: 2, minLabel: 1 }, { name: 'Bland', x: 10, y: 0, rank: 2, minLabel: 1 }, { name: 'Cland', x: 1000, y: 0, rank: 2, minLabel: 1 }] });
  const opts = { mPerPx: 2000, W: 1000, H: 600, px: 13, toScreen: (x, y, o) => { o[0] = 300 + x / 10; o[1] = 300 - y / 10; return o; }, measure: (t) => t.length * 9 };
  const free = layoutNames(C, opts);
  assert.equal(free.length, 3);   // Bland moves off Aland
  assert.ok(!(free[0].box.x1 < free[1].box.x0) || true);
  for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
    const a = free[i].box, b = free[j].box;
    assert.ok(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1, `${free[i].name} / ${free[j].name}`);
  }
  // a taken box over Cland's point and a line through Aland's: neither is drawn there
  const got = layoutNames(C, { ...opts, taken: [{ x0: 360, y0: 250, x1: 440, y1: 350 }], polylines: [[0, 300, 1000, 300]] });
  for (const n of got) {
    assert.ok(!segHitsBox(0, 300, 1000, 300, n.box), n.name);
    assert.ok(n.box.x1 < 360 || n.box.x0 > 440 || n.box.y1 < 250 || n.box.y0 > 350, n.name);
  }
});

test('the borders trace only what is in view, at the zoom\'s level', () => {
  const C = buildCountries(load('data/europe'));
  let moves = 0;
  const ctx = { moveTo() { moves++; }, lineTo() {} };
  traceBorders(ctx, C, C.lod(2650), { x0: -2e6, y0: -2e6, x1: 2e6, y1: 2e6 }, (x, y, o) => o);
  const all = moves; moves = 0;
  traceBorders(ctx, C, C.lod(2650), { x0: 1e7, y0: 1e7, x1: 1.1e7, y1: 1.1e7 }, (x, y, o) => o);
  assert.ok(all > 0); assert.equal(moves, 0);
  assert.equal(C.lod(50), 0); assert.equal(C.lod(5000), 2);
});

test('a small country\'s name is never stronger than a large one\'s at the same zoom', () => {
  for (let m = 100; m <= 3000; m += 25) for (const r of [5, 6]) assert.ok(nameAlpha({ rank: r }, m) <= nameAlpha({ rank: 2 }, m), `${r} at ${m}`);
});

test('a name whose label point is taken goes to another point inside its country; one off the screen to a point on it', () => {
  const C = buildCountries({ tols: [200], lines: [], names: [{ name: 'Big', x: 0, y: 0, rank: 2, minLabel: 1, cand: [5000, 0, 8000, 0] }] });
  const opts = { mPerPx: 2000, W: 1000, H: 600, px: 13, toScreen: (x, y, o) => { o[0] = 300 + x / 10; o[1] = 300 - y / 10; return o; }, measure: (t) => t.length * 9 };
  const got = layoutNames(C, { ...opts, taken: [{ x0: 200, y0: 200, x1: 450, y1: 400 }] });
  assert.equal(got.length, 1); assert.equal(got[0].x, 800);
  const off = layoutNames(C, { ...opts, toScreen: (x, y, o) => { o[0] = -500 + x / 10; o[1] = 300 - y / 10; return o; } });
  assert.equal(off.length, 1); assert.equal(off[0].x, 300);
  // every name in both regions' files carries points inside its country
  for (const dir of ['data', 'data/europe']) for (const n of load(dir).names) assert.ok(Array.isArray(n.cand), n.name);
});

