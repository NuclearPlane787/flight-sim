// v0.7.7 part 3 (briefs/V0-7-7.md, "The ground's data"): lakes at their own level in Europe's 250 m tiles
// (tools/bake_region_lakes.py), Schiphol's 30 m patch with nothing under -7 m (DEM_FLOOR in
// tools/bake_region_patches.py) and Almada's cliff under Cristo Rei left as the elevation model has it (URBAN_KEEP).
// Read straight from the installed files, so it runs in either region's process.
//   node --test tests/v077-ground-data.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const EU = new URL('../data/europe/', import.meta.url);
const have = existsSync(new URL('manifest.json', EU));
const S = 516, B = 2, TILE = 512, CELL = 250, STEP = 0.25;
const gz = (rel) => gunzipSync(readFileSync(new URL(rel, EU)));
const i16 = (buf) => new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
const tileH = (name) => i16(gz(`terrain/r0/${name}.h.i16.gz`));
const tileW = (name) => gz(`terrain/r0/${name}.w.rg8.gz`);
const isWater = (w, k) => w[2 * k + 1] < 128 && w[2 * k] > 128;      // inland water on land, as the bake has it

// A lake's water cells within 30 cells of a map point (x, y in Europe's map metres), in metres, sorted.
function lake(x, y) {
  const ti = Math.floor(x / (TILE * CELL)), tj = Math.floor(y / (TILE * CELL)), name = `${ti}_${tj}`;
  const h = tileH(name), w = tileW(name);
  const ci = Math.floor((x - ti * TILE * CELL) / CELL) + B, cj = Math.floor((y - tj * TILE * CELL) / CELL) + B;
  const v = [];
  for (let j = Math.max(B, cj - 30); j < Math.min(S - B, cj + 30); j++) {
    for (let i = Math.max(B, ci - 30); i < Math.min(S - B, ci + 30); i++) if (isWater(w, j * S + i)) v.push(h[j * S + i] * STEP);
  }
  v.sort((a, b) => a - b);
  return { name, v, min: v[0], max: v[v.length - 1], median: v[v.length >> 1] };
}

// name: [x, y, the level the elevation model's flattened surface gives (m), the lake's mapped level (m)]
const LAKES = {
  IJsselmeer: [94172, 641765, -0.25, -0.2], Markermeer: [82529, 611609, -0.25, -0.2], 'Lake Geneva': [194217, -57474, 368.0, 372.0],
  'Lake Constance': [402198, 82139, 394.0, 395.0], 'Lake Garda': [514460, -130328, 64.5, 65.0], 'Lough Neagh': [-672197, 887897, 10.5, 12.5],
  'Loch Ness': [-516915, 1167970, 16.0, 15.8], 'Lago Maggiore': [355734, -105264, 193.0, 193.0], 'Lake Lucerne': [333001, 11551, 433.5, 433.6],
  'Lake Zurich': [348814, 37857, 404.5, 406.0], 'Lake Bolsena': [645736, -452619, 304.5, 305.0],
};

test("Europe's lakes lie flat at their own level (v0.7.6 drew each cell 2 m under its nearest bank)", { skip: !have }, () => {
  for (const [name, [x, y, level, mapped]] of Object.entries(LAKES)) {
    const L = lake(x, y);
    assert.ok(L.v.length > 400, `${name}: water cells round the point`);
    assert.equal(L.median, level, `${name}: its median`);
    assert.ok(Math.abs(level - mapped) <= 4.01, `${name}: within 4 m of its mapped level`);
    // at least nine cells in ten of the window at the level exactly (the rest: other, smaller waters nearby)
    const at = L.v.filter((h) => h === level).length;
    assert.ok(at >= 0.9 * L.v.length, `${name}: ${at} of ${L.v.length} cells at ${level} m`);
  }
  // v0.7.6: the IJsselmeer -2.75 to 0.75 m here, Loch Ness 19 to 484 m up its banks, Lake Lucerne 412 to 620 m
  assert.equal(lake(...LAKES.IJsselmeer).max, -0.25);
  assert.equal(lake(...LAKES['Lake Garda']).max, 64.5);
});

test('the floor: no inland water cell stores 0 (0 is the sea), and the polder lakes are land below the sea', { skip: !have }, () => {
  for (const name of ['0_5', '0_4', '0_3', '5_-1', '-5_9']) {
    const h = tileH(name), w = tileW(name);
    let zero = 0, water = 0;
    for (let k = 0; k < S * S; k++) if (isWater(w, k)) { water++; if (h[k] === 0) zero++; }
    assert.ok(water > 0, name);
    assert.equal(zero, 0, `${name}: water cells at exactly 0`);
  }
  assert.ok(lake(...LAKES.IJsselmeer).median < 0);
});

test("water at a dam's foot is not lifted to the reservoir above it: five cells as v0.7.6 had them", { skip: !have }, () => {
  // The 250 m water mask joins the river below a dam to the reservoir. The rule's first bake gave these cells the
  // reservoir's level (the code review, 2026-11-22: 140 cells 5 to 31 m over their own ground); a cell is now never
  // lifted more than 5 m above its own raw height (LIFT_MAX in tools/bake_region_lakes.py) and is left as installed.
  // [name, tile, i, j (with the 2-cell border), v0.7.6's stored height in 0.25 m steps]
  const FEET = [
    ['Zujar', '-7_-7', 327, 209, 1316],    // v0.7.6 329.0 m; the first bake 341.5 m; raw 312.1 m
    ['Mohne', '2_3', 98, 478, 803],        // 200.75 m; 213.0 m; raw 183.1 m
    ['Gabcikovo', '7_1', 416, 222, 455],   // 113.75 m; 126.0 m; raw 110.2 m
    ['Staines', '-3_3', 284, 466, 64],     // 16.0 m; 29.0 m; raw 15.6 m
    ['Biesbosch', '0_4', 214, 39, -5],     // -1.25 m; 7.0 m; raw 0.2 m
  ];
  for (const [name, tile, i, j, want] of FEET) {
    const h = tileH(tile), w = tileW(tile);
    assert.ok(isWater(w, j * S + i), `${name}: a water cell`);
    assert.equal(h[j * S + i], want, `${name}: as v0.7.6 had it`);
  }
});

test('only water moved: the land and the sea of three tiles are v0.7.6\'s, by hash', { skip: !have }, () => {
  // SHA-256 (first 16 hex digits) of each tile's core heights with every inland water cell set to 0, taken from the pushed v0.7.6.
  const OLD = { '0_5': 'f4234c38b863c141', '-5_9': '1fdf58eed624e1e3', '2_0': 'afa7d45489671391' };
  for (const [name, want] of Object.entries(OLD)) {
    const h = tileH(name), w = tileW(name), out = new Int16Array(TILE * TILE);
    for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) { const k = (j + B) * S + i + B; out[j * TILE + i] = isWater(w, k) ? 0 : h[k]; }
    assert.equal(createHash('sha256').update(Buffer.from(out.buffer)).digest('hex').slice(0, 16), want, name);
  }
});

const patches = () => Object.fromEntries(JSON.parse(readFileSync(new URL('manifest.json', EU), 'utf8')).patchesRegion.map((p) => [p.id, p]));

test("Schiphol's patch: nothing under -7 m (the radar noise at Amsterdam's stadium was -19.5 m), the field as it was", { skip: !have }, () => {
  const p = patches().schiphol, h = i16(gz(p.height));
  assert.equal(h.length, p.nx * p.ny);
  let min = Infinity, under5 = 0;
  for (let k = 0; k < h.length; k++) { if (h[k] < min) min = h[k]; if (h[k] < -20) under5++; }
  assert.equal(min * STEP, -7);
  assert.ok(under5 > 50000, 'the polders are still there (cells under -5 m)');
  // the stadium (map 64004, 587431): v0.7.6 had -10.5 m here and -19.5 m within 600 m
  const i = Math.floor((64004 - p.x0) / p.cell), j = Math.floor((587431 - p.y0) / p.cell);
  let lo = Infinity;
  for (let dj = -20; dj <= 20; dj++) for (let di = -20; di <= 20; di++) lo = Math.min(lo, h[(j + dj) * p.nx + i + di] * STEP);
  assert.ok(lo >= -7, `round the stadium the lowest is ${lo} m`);
  // 18L's threshold end (map 52980, 587519; -3.7 m in the AIP): the flattened field
  const fi = Math.floor((52980 - p.x0) / p.cell), fj = Math.floor((587519 - p.y0) / p.cell);
  assert.ok(Math.abs(h[fj * p.nx + fi] * STEP + 3.7) < 1.0, `the field at ${h[fj * p.nx + fi] * STEP} m`);
});

test("Cristo Rei stands on its cliff: Lisbon's patch has the hilltop at about 110 m and the Tagus at 0 beside it", { skip: !have }, () => {
  const p = patches().lisbon, h = i16(gz(p.height));
  const at = (x, y) => {   // cell-centred bilinear, as heightfield.js reads a patch
    const fx = (x - p.x0) / p.cell - 0.5, fy = (y - p.y0) / p.cell - 0.5, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const g = (a, b) => h[b * p.nx + a] * STEP;
    return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v;
  };
  const x = -1141615.7, y = -823602.1;    // the statue (38.67861 N, 9.17134 W), footprint 27 m: landmarks.js's baseHeight() takes the lowest of nine points
  let lo = at(x, y);
  for (let k = 0; k < 8; k++) lo = Math.min(lo, at(x + 0.8 * 27 * Math.cos(k / 8 * 2 * Math.PI), y + 0.8 * 27 * Math.sin(k / 8 * 2 * Math.PI)));
  assert.ok(lo > 108 && lo < 125, `the ground under the statue ${lo.toFixed(1)} m (v0.7.6: 87.5 m)`);
  let river = Infinity;
  for (let d = 150; d <= 600; d += 30) river = Math.min(river, at(x, y + d));
  assert.equal(river, 0, 'the Tagus within 600 m north of it');
});
