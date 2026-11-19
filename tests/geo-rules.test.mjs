// The local rules' data (src/world/geo-rules.js): WMM2025's variation grid and the country raster
// (tools/bake_wmm.py, tools/bake_country.py; V060.md Part 2 step 8, Part 5 steps 1 and 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createGeoRules, loadGeoRules } from '../src/world/geo-rules.js';
import { toMap } from '../src/world/frame.js';

const DATA = fileURLToPath(new URL('../data/', import.meta.url));
const part = (name) => {
  const header = JSON.parse(readFileSync(DATA + name + '.json', 'utf8'));
  const buf = gunzipSync(readFileSync(DATA + header.file));
  return { header, values: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
const geo = createGeoRules({ magvar: part('magvar'), country: part('country') });
const at = (fn, lat, lon) => fn(...toMap(lat, lon));

// None of NOAA's 12 WMM2025 test points (0°, ±80°) falls in the box, so the grid is checked
// against tools/bake_wmm.py's routine at these points (2026.0, sea level); that routine
// reproduces every NOAA test row's declination to 0.005° (its check table).
const WMM_2026 = [
  ['RJTT', 35.5523, 139.7798, -7.8513],
  ['RJAA', 35.7647, 140.3864, -7.8165],
  ['ZSPD', 31.1434, 121.8052, -6.5592],
  ['RKSS', 37.5583, 126.7906, -8.9698],
  ['RKPC', 33.5113, 126.493, -7.7844],
  ['Pyongyang', 39.0392, 125.7625, -9.2837],
  ['Qingdao', 36.0671, 120.3826, -7.5581],
  ['Fukuoka', 33.5859, 130.45, -7.9969],
  ['Sapporo', 43.0621, 141.3544, -9.9161],
  ['Taipei', 25.033, 121.5654, -5.0332],
  ['Vladivostok', 43.1155, 131.8855, -10.8628],
  ['SW corner', 24, 112, -3.1928],
  ['NE corner', 46, 148, -9.2027],
  ['Fuji', 35.3606, 138.7274, -7.9544],
];

test('WMM grid: bilinear values match the WMM2025 routine to 0.05° over the margin box', () => {
  for (const [name, lat, lon, ref] of WMM_2026) {
    const v = at(geo.wmmVar, lat, lon);
    assert.ok(Math.abs(v - ref) < 0.05, `${name}: grid ${v.toFixed(3)} vs ${ref}`);
  }
});

test('WMM grid: near the AIPs (Haneda and Narita 8° W; Pudong 5°47′ W in 2017, drifting west)', () => {
  assert.ok(Math.abs(at(geo.wmmVar, 35.5523, 139.7798) + 8) < 0.5);
  assert.ok(Math.abs(at(geo.wmmVar, 35.7647, 140.3864) + 8) < 0.5);
  const pvg = at(geo.wmmVar, 31.1434, 121.8052);
  assert.ok(pvg < -5.78 && pvg > -7.0, `Pudong ${pvg}`);
});

test('WMM grid: continuous and clamped at the edges', () => {
  const h = geo.magvarHeader;
  const a = geo.wmmVar(h.x0 - 1e6, h.y0 - 1e6), b = geo.wmmVar(h.x0, h.y0);
  assert.equal(a, b);
  let worst = 0;
  for (let x = -1e6; x < 1.5e6; x += 3333) worst = Math.max(worst, Math.abs(geo.wmmVar(x + 100, 0) - geo.wmmVar(x, 0)));
  assert.ok(worst < 0.01, `step ${worst}`);
});

const PLACES = [
  ['Gimpo', 37.5583, 126.7906, 'KR'],
  ['Seoul', 37.5665, 126.978, 'KR'],
  ['Jeju', 33.3617, 126.5292, 'KR'],
  ['Jeju airport', 33.5113, 126.493, 'KR'],
  ['Busan', 35.1796, 129.0756, 'KR'],
  ['Pyongyang', 39.0392, 125.7625, 'KP'],
  ['Haneda', 35.5523, 139.7798, 'JP'],
  ['Narita', 35.7647, 140.3864, 'JP'],
  ['Fukuoka', 33.5859, 130.45, 'JP'],
  ['Tsushima', 34.4, 129.3, 'JP'],
  ['Pudong', 31.1434, 121.8052, 'CN'],
  ['Qingdao', 36.0671, 120.3826, 'CN'],
  ['Taipei', 25.033, 121.5654, 'other'],
  ['Vladivostok', 43.1155, 131.8855, 'other'],
];

test('countryAt: cities and airports', () => {
  for (const [name, lat, lon, want] of PLACES) assert.equal(at(geo.countryAt, lat, lon), want, name);
});

test('countryAt: the sea takes its nearest land country', () => {
  // the Korea Strait's western channel, between Busan and Tsushima: nearer Korea at 34.9 N
  // 129.0 E, nearer Tsushima at 34.5 N 129.45 E (its east coast side)
  assert.equal(at(geo.countryAt, 34.9, 129.0), 'KR');
  assert.ok(at(geo.seaAt, 34.9, 129.0));
  assert.equal(at(geo.countryAt, 34.0, 129.9), 'JP');   // the eastern channel, by Iki
  // mid-strait points go to one of the two, never anything else
  for (let t = 0; t <= 1; t += 0.1) {
    const c = at(geo.countryAt, 35.1 - 1.0 * t, 129.1 + 0.9 * t);
    assert.ok(c === 'KR' || c === 'JP', c);
  }
  assert.equal(at(geo.countryAt, 35.5, 124.0), 'KR');   // the Yellow Sea, Korea's side
  assert.equal(at(geo.countryAt, 35.5, 122.0), 'CN');   // the Yellow Sea, China's side
  assert.equal(at(geo.countryAt, 37.5, 134.0), 'JP');   // the East Sea / Sea of Japan, east
  assert.equal(at(geo.countryAt, 30, 145), 'JP');       // the Pacific
  assert.ok(!at(geo.seaAt, 37.5665, 126.978));
});

test('countryAt never says sea, and clamps outside the raster', () => {
  const h = geo.countryHeader;
  for (let x = h.x0 - 5e4; x < h.x0 + h.nx * h.cell + 5e4; x += 37000) {
    for (let y = h.y0 - 5e4; y < h.y0 + h.ny * h.cell + 5e4; y += 37000) {
      assert.notEqual(geo.countryAt(x, y), 'sea');
    }
  }
});

test('loadGeoRules takes the data directly too', async () => {
  const g = await loadGeoRules({ magvar: part('magvar'), country: part('country') });
  assert.equal(at(g.countryAt, 35.5523, 139.7798), 'JP');
});
