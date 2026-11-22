// v0.7.4 item 11: the path map's colour by height (src/ui/map-relief.js; data/map-relief.u8.gz and
// data/europe/map-relief.u8.gz from tools/bake_map_relief.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { heightOf, bandOf, reliefPixels, RELIEF_BANDS, POLDER_RGB, FT } from '../src/ui/map-relief.js';
import { toMap } from '../src/world/frame.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'data');

test('the byte code: sea, below sea level, and heights by the square root', () => {
  assert.equal(heightOf(0), null);
  assert.equal(heightOf(1), -1);
  assert.equal(heightOf(2, 5000), 0);
  assert.equal(heightOf(255, 5000), 5000);
  assert.ok(heightOf(100) < heightOf(101));
});

test('the bands go up in feet, from the land\'s own colour, deeper with height', () => {
  assert.equal(RELIEF_BANDS[0].ft, 0);
  assert.deepEqual(RELIEF_BANDS[0].rgb, [28, 42, 34]);
  for (let i = 1; i < RELIEF_BANDS.length; i++) {
    assert.ok(RELIEF_BANDS[i].ft > RELIEF_BANDS[i - 1].ft);
    const lum = (c) => c[0] + c[1] + c[2];
    assert.ok(lum(RELIEF_BANDS[i].rgb) > lum(RELIEF_BANDS[i - 1].rgb));
  }
  assert.equal(bandOf(0), 0);
  assert.equal(bandOf(499 / FT), 0);
  assert.equal(bandOf(501 / FT), 1);
  assert.equal(bandOf(4000), RELIEF_BANDS.length - 1);
  assert.notDeepEqual(POLDER_RGB, [11, 34, 54]);   // not the sea's colour
});

test('the image: the sea transparent, the polders their own tone, flat land its band\'s colour, a north-west slope lit', () => {
  const nx = 6, ny = 5, head = { nx, ny, cell: 2000, hmax: 5000 };
  const u8 = new Uint8Array(nx * ny).fill(120);
  u8[0] = 0; u8[1] = 1;
  const px = reliefPixels(head, u8);
  const at = (i, j) => { const o = ((ny - 1 - j) * nx + i) * 4; return [...px.slice(o, o + 4)]; };
  assert.equal(at(0, 0)[3], 0);
  assert.deepEqual(at(1, 0), [...POLDER_RGB, 255]);
  const c = RELIEF_BANDS[bandOf(heightOf(120))].rgb;
  assert.deepEqual(at(3, 2), [...c, 255]);
  // a ridge running north-east: its north-west face lit, its south-east face in shade
  const ridge = new Uint8Array(9 * 9);
  for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) ridge[j * 9 + i] = Math.max(2, 200 - 40 * Math.abs(i - j));
  const p2 = reliefPixels({ nx: 9, ny: 9, cell: 2000, hmax: 5000 }, ridge);
  const lum = (i, j) => { const o = ((8 - j) * 9 + i) * 4; return p2[o] + p2[o + 1] + p2[o + 2]; };
  // cell (3, 5) is north-west of the ridge line i = j; (5, 3) south-east of it, at the same height
  assert.equal(ridge[5 * 9 + 3], ridge[3 * 9 + 5]);
  assert.ok(lum(3, 5) > lum(5, 3), `${lum(3, 5)} vs ${lum(5, 3)}`);
});

for (const [region, dir, peaks] of [
  ['east-asia', DATA, [['Fuji', 35.36, 138.73, 2000], ['Hallasan', 33.36, 126.53, 800], ['the Seoul plain', 37.55, 126.95, -1]]],
  ['europe', path.join(DATA, 'europe'), [['Mont Blanc', 45.83, 6.86, 2500], ['the Pyrenees', 42.63, 0.66, 1500], ['Flevoland', 52.45, 5.5, 'polder']]],
]) {
  test(`${region}: the file is small, and its heights are where the mountains are`, () => {
    const head = JSON.parse(fs.readFileSync(path.join(dir, 'map-relief.json'), 'utf8'));
    const gz = fs.readFileSync(path.join(dir, head.file));
    assert.ok(gz.length < 2 * 1024 * 1024, `${gz.length} bytes`);
    const u8 = zlib.gunzipSync(gz);
    assert.equal(u8.length, head.nx * head.ny * (head.planes || 1));   // (second pass: a fade weight plane after the heights)
    // frame.js is East Asia's here (node's region): Europe's points by its own frame, euMap() below
    for (const [name, lat, lon, want] of peaks) {
      const [x, y] = region === 'europe' ? euMap(lat, lon) : toMap(lat, lon);
      const i = Math.floor((x - head.x0) / head.cell), j = Math.floor((y - head.y0) / head.cell);
      const v = u8[j * head.nx + i];
      if (want === 'polder') assert.equal(v, 1, name);
      else if (want < 0) assert.ok(v >= 2 && heightOf(v, head.hmax) < 200, `${name}: ${heightOf(v, head.hmax)}`);
      else assert.ok(heightOf(v, head.hmax) > want, `${name}: ${heightOf(v, head.hmax)} m`);
    }
  });
}

// Europe's frame (LCC 47 N 4 E, parallels 39 and 54, WGS84), as tools/bake_common.py's to_map with FS_REGION=europe.
function euMap(lat, lon) {
  const D = Math.PI / 180, A = 6378137, F = 1 / 298.257223563, E = Math.sqrt(2 * F - F * F);
  const m = (p) => Math.cos(p) / Math.sqrt(1 - E * E * Math.sin(p) ** 2);
  const t = (p) => { const es = E * Math.sin(p); return Math.tan(Math.PI / 4 - p / 2) / ((1 - es) / (1 + es)) ** (E / 2); };
  const m1 = m(39 * D), m2 = m(54 * D), t0 = t(47 * D), t1 = t(39 * D), t2 = t(54 * D);
  const n = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2)), FF = m1 / (n * t1 ** n), rho0 = A * FF * t0 ** n;
  const rho = A * FF * t(lat * D) ** n, th = n * (lon - 4) * D;
  return [rho * Math.sin(th), rho0 - rho * Math.cos(th)];
}
