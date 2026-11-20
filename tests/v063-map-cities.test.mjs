// v0.6.3 Part 4 (briefs/V0-6-3.md): the path map's city areas and names. Shane, 2026-11-20: "Major cities show as
// distinct urban regions with their English names appearing in that area, like google maps."
// The data (data/urban-region.json, tools/bake_region_urban.py) and the picking of names (src/ui/common.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildUrban, pickPlaces, placePopMin, placeStyle } from '../src/ui/common.js';
import { REGION_EXTENT } from '../src/world/region.js';
import { toMap } from '../src/world/frame.js';

const doc = JSON.parse(fs.readFileSync(new URL('../data/urban-region.json', import.meta.url), 'utf8'));
const U = buildUrban(doc);
const inRing = (f, x, y) => { let c = false; for (let i = 0, n = f.length >> 1, j = n - 1; i < n; j = i++) { const xi = f[2 * i], yi = f[2 * i + 1], xj = f[2 * j], yj = f[2 * j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
// Even-odd over every ring, as the map fills them.
const inCity = (x, y) => U.rings.reduce((c, r) => (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1 && inRing(r.levels[0], x, y) ? !c : c), false);

test('the file: the region\'s extent, rings inside it, under a megabyte', () => {
  assert.deepEqual(doc.extent, [REGION_EXTENT.x0, REGION_EXTENT.y0, REGION_EXTENT.x1, REGION_EXTENT.y1]);
  assert.ok(fs.statSync(new URL('../data/urban-region.json', import.meta.url)).size < 1e6);
  assert.ok(U.rings.length > 500 && U.rings.length < 4000, String(U.rings.length));
  for (const r of U.rings) {
    assert.ok(r.x0 >= REGION_EXTENT.x0 - 1000 && r.x1 <= REGION_EXTENT.x1 + 1000 && r.y0 >= REGION_EXTENT.y0 - 1000 && r.y1 <= REGION_EXTENT.y1 + 1000);
    assert.ok(r.levels[0].length >= 6);
    for (let l = 1; l < r.levels.length; l++) assert.ok(r.levels[l].length <= r.levels[l - 1].length, 'a coarser level has no more points');
  }
});

test('the great cities\' centres lie in a city area, the open country and the sea don\'t', () => {
  // (lat, lon) of each centre: Seoul's City Hall, Tokyo Station, People's Square, Osaka's Umeda, Busan's Seomyeon, Fukuoka's Tenjin.
  for (const [name, lat, lon] of [['Seoul', 37.566, 126.978], ['Tokyo', 35.681, 139.767], ['Shanghai', 31.232, 121.475], ['Osaka', 34.702, 135.496], ['Busan', 35.158, 129.059], ['Fukuoka', 33.590, 130.399]]) {
    const [x, y] = toMap(lat, lon);
    assert.ok(inCity(x, y), `${name}'s centre is in a city area`);
  }
  for (const [name, lat, lon] of [['Jirisan', 35.337, 127.731], ['the Yellow Sea', 35.5, 124.0], ['Mount Fuji', 35.361, 138.727], ['the Sea of Japan', 38.5, 134.0]]) {
    const [x, y] = toMap(lat, lon);
    assert.ok(!inCity(x, y), `${name} is not a city`);
  }
});

test('the names: English, by population, each at its city', () => {
  const P = U.places;
  assert.ok(P.length > 300);
  for (let i = 1; i < P.length; i++) assert.ok(P[i].pop <= P[i - 1].pop, 'largest first');
  for (const p of P) assert.ok(/^[A-Za-z' .-]+$/.test(p.name), `${p.name} is written in plain Latin letters`);
  const at = (name) => P.find((p) => p.name === name);
  for (const [name, lat, lon] of [['Seoul', 37.566, 126.978], ['Tokyo', 35.681, 139.767], ['Beijing', 39.905, 116.397], ['Shenyang', 41.80, 123.43], ['Vladivostok', 43.12, 131.89], ['Pyongyang', 39.03, 125.75], ['Sapporo', 43.06, 141.35]]) {
    const p = at(name), [x, y] = toMap(lat, lon);
    assert.ok(p, `${name} is in the list`);
    assert.ok(Math.hypot(p.x - x, p.y - y) < 25000, `${name} is within 25 km of its centre (${Math.round(Math.hypot(p.x - x, p.y - y) / 1000)} km)`);
  }
  for (const wrong of ['Shenyeng', 'Songnam', "Puch'on", 'Osakā', 'Ōsaka']) assert.ok(!at(wrong), `${wrong} is spelt right`);
});

test('more names as the map zooms in', () => {
  assert.ok(placePopMin(0.0003) > 3e6 && placePopMin(0.0003) < 8e6);
  assert.ok(placePopMin(0.0012) < placePopMin(0.0006) && placePopMin(0.0006) < placePopMin(0.0003));
  assert.equal(placePopMin(0.004), 0);
  assert.ok(placeStyle(1e7).px > placeStyle(1e5).px);
  const measure = (name, st) => name.length * st.px * 0.55;
  const view = (k, cx, cy, taken = []) => pickPlaces(U.places, { k, W: 1440, H: 900, taken, measure, toScreen: (x, y, o) => { o[0] = 720 + (x - cx) * k; o[1] = 450 - (y - cy) * k; return o; } });
  const region = view(1 / 2650, 255000, -27000), korea = view(1 / 520, 0, -20000);
  const names = (l) => l.map((p) => p.name);
  for (const n of ['Tokyo', 'Seoul', 'Shanghai', 'Beijing', 'Osaka']) assert.ok(names(region).includes(n), `${n} at the region's scale`);
  assert.ok(region.length <= 30, `the region isn't crowded (${region.length})`);
  for (const n of ['Seoul', 'Busan', 'Daegu', 'Daejeon', 'Gwangju']) assert.ok(names(korea).includes(n), `${n} over Korea`);
  assert.ok(!names(region).includes('Daejeon'), 'Daejeon waits for a closer view');
  // No two names touch, and none touches a box that is taken.
  const box = (p) => { const w = measure(p.name, p); return { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y - p.px / 2, y1: p.y + p.px / 2 }; };
  const apart = (a, b) => a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1;
  for (const list of [region, korea]) for (let i = 0; i < list.length; i++) for (let j = 0; j < i; j++) assert.ok(apart(box(list[i]), box(list[j])), `${list[i].name} and ${list[j].name}`);
  const seoul = korea.find((p) => p.name === 'Seoul'), taken = [{ x0: seoul.x - 40, y0: seoul.y - 12, x1: seoul.x + 40, y1: seoul.y + 12 }];
  const again = view(1 / 520, 0, -20000, taken).find((p) => p.name === 'Seoul');
  assert.ok(again && apart(box(again), taken[0]), 'Seoul moves off a taken box and is still written');
});

// v0.6.3: the 250 m data's outline on the map is its tiles' outer sides, not a rectangle.
import { tileOutline, FINE_EXTENT } from '../src/world/region.js';
test('the 250 m data\'s outline: closed, inside its bounding rectangle, and not that rectangle', () => {
  const m = JSON.parse(fs.readFileSync(new URL('../data/manifest.json', import.meta.url), 'utf8'));
  const E = tileOutline(m.tilesRegion);
  assert.ok(E.length > 20);
  const ends = new Map();
  for (const [x0, y0, x1, y1] of E) {
    assert.ok(x0 === x1 || y0 === y1, 'each side runs along the lattice');
    assert.ok(Math.min(x0, x1) >= FINE_EXTENT.x0 && Math.max(x0, x1) <= FINE_EXTENT.x1 && Math.min(y0, y1) >= FINE_EXTENT.y0 && Math.max(y0, y1) <= FINE_EXTENT.y1);
    for (const k of [`${x0},${y0}`, `${x1},${y1}`]) ends.set(k, (ends.get(k) || 0) + 1);
  }
  for (const [k, n] of ends) assert.ok(n % 2 === 0, `the outline closes at ${k}`);
  const len = E.reduce((s, [x0, y0, x1, y1]) => s + Math.abs(x1 - x0) + Math.abs(y1 - y0), 0);
  assert.ok(len > 2 * (FINE_EXTENT.x1 - FINE_EXTENT.x0 + FINE_EXTENT.y1 - FINE_EXTENT.y0) - 1, 'at least the rectangle\'s length: a stepped edge is longer');
  assert.equal(tileOutline({ levels: [{}] }), null);
});
