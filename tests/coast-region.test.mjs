// v0.6.0: the region's coast file (data/coast-region.json, tools/bake_region_coast.py) and its
// reading and tracing in ui/common.js (buildCoast's region branch, traceLand, traceCoastLines).
//   node --test tests/coast-region.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { buildCoast, traceRings, traceLand, traceCoastLines, onCellEdge, screenBox } from '../src/ui/common.js';
import { REGION_EXTENT, FINE_EXTENT } from '../src/world/region.js';
import { toMap } from '../src/world/frame.js';

const DATA = new URL('../data/', import.meta.url);
const file = new URL('coast-region.json', DATA);
const raw = JSON.parse(readFileSync(file, 'utf8'));
// (v0.7.0: Korea's own coast.json retired with v0.6.0's flags, and the two tests that read it.)

// A canvas context that records the path.
function pathCtx() {
  const subs = []; let cur = null;
  return {
    subs,
    moveTo(x, y) { cur = [[x, y]]; subs.push(cur); },
    lineTo(x, y) { cur.push([x, y]); },
    closePath() { if (cur) cur.closed = true; },
    get points() { return subs.reduce((n, s) => n + s.length, 0); },
  };
}
const ident = (x, y, o) => { o[0] = x; o[1] = y; return o; };

// Even-odd point in polygon over a list of rings ([x, y] arrays).
function inside(rings, x, y) {
  let c = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}
function landAt(b, lod, x, y) {
  const ctx = pathCtx();
  traceLand(ctx, b, lod, { x0: x - 1, y0: y - 1, x1: x + 1, y1: y + 1 }, ident);
  return inside(ctx.subs, x, y);
}

test('the file: under 5 MB, the region extent, six levels from 80 m to 6 km', () => {
  const mb = statSync(file).size / 1e6;
  assert.ok(mb < 5, `${mb.toFixed(2)} MB`);
  assert.equal(raw.v, 2);
  assert.deepEqual(raw.extent, [REGION_EXTENT.x0, REGION_EXTENT.y0, REGION_EXTENT.x1, REGION_EXTENT.y1]);
  assert.deepEqual(raw.levels.map((L) => L.tol), [80, 200, 400, 800, 1500, 6000]);
  for (const L of raw.levels) {
    assert.ok(L.rings.length > 50);
    for (const r of L.rings) assert.ok(r.length >= 9 && (r.length - 3) % 2 === 0 && Number.isInteger(r[3]));
  }
  assert.ok(raw.water.length > 100);
});

test('buildCoast: the region file built once, its pieces inside their cells and the extent', () => {
  const b = buildCoast(raw);
  assert.equal(b, buildCoast(raw), 'the same object for the same file (HUD, map and setup share it)');
  assert.ok(b.region);
  const E = REGION_EXTENT;
  for (const L of b.levels) {
    for (const cell of L.cells) {
      for (const r of cell) {
        assert.ok(r.x0 >= r.cx0 - 1 && r.x1 <= r.cx1 + 1 && r.y0 >= r.cy0 - 1 && r.y1 <= r.cy1 + 1);
        assert.ok(r.x0 >= E.x0 && r.x1 <= E.x1 && r.y0 >= E.y0 && r.y1 <= E.y1);
      }
    }
  }
  assert.equal(b.land.length, raw.levels.reduce((n, L) => n + L.rings.length, 0));
  // lod as Korea's: the coarsest level whose tolerance is at most 1.5 px.
  const want = { 10: 0, 50: 0, 100: 0, 150: 1, 300: 2, 600: 3, 1000: 4, 2000: 4, 4000: 5, 20000: 5 };
  for (const [m, l] of Object.entries(want)) assert.equal(b.lod(Number(m)), l, `at ${m} m/px`);
  assert.equal(b.water[0].levels.length, 6);
});

test('land and sea where they are, at every level (Seoul, Tokyo, Shanghai, Fukuoka; the seas)', () => {
  const b = buildCoast(raw);
  const land = { Seoul: [37.55, 126.98], Tokyo: [35.68, 139.69], Shanghai: [31.23, 121.47], Fukuoka: [33.59, 130.40], Osaka: [34.69, 135.50], Qingdao: [36.07, 120.38] };
  const sea = { 'Tokyo Bay': [35.50, 139.85], 'Yellow Sea': [35.5, 124.0], 'Korea Strait': [34.5, 129.0], 'Seto Inland Sea': [34.2, 133.5], 'East China Sea': [30.0, 125.0] };
  for (let lod = 0; lod < 5; lod++) {
    for (const [n, [la, lo]] of Object.entries(land)) { const [x, y] = toMap(la, lo); assert.ok(landAt(b, lod, x, y), `${n} land at level ${lod}`); }
    for (const [n, [la, lo]] of Object.entries(sea)) { const [x, y] = toMap(la, lo); assert.ok(!landAt(b, lod, x, y), `${n} sea at level ${lod}`); }
  }
});

test('traceCoastLines leaves out the cells\' cut edges, keeps the coast', () => {
  const b = buildCoast(raw);
  const L = b.levels[0];
  let cut = 0, coast = 0;
  for (const cell of L.cells) for (const r of cell) {
    const f = r.f, n = f.length / 2;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; onCellEdge(r, f[2 * i], f[2 * i + 1], f[2 * j], f[2 * j + 1]) ? cut++ : coast++; }
  }
  assert.ok(cut > 100 && coast > 50 * cut / 10, `${cut} cut, ${coast} coast`);
  // No stroked segment runs along a cell edge.
  const box = { x0: 900000, y0: -100000, x1: 1300000, y1: 200000 };   // round Tokyo
  const ctx = pathCtx();
  traceCoastLines(ctx, b, 0, box, ident);
  const edgesX = new Set(), edgesY = new Set();
  for (let x = REGION_EXTENT.x0; x <= REGION_EXTENT.x1; x += L.cell) edgesX.add(x);
  for (let y = REGION_EXTENT.y0; y <= REGION_EXTENT.y1; y += L.cell) edgesY.add(y);
  for (const s of ctx.subs) for (let i = 1; i < s.length; i++) {
    const [ax, ay] = s[i - 1], [bx, by] = s[i];
    assert.ok(!(ax === bx && edgesX.has(ax)) && !(ay === by && edgesY.has(ay)), `segment on a cell edge ${ax},${ay} ${bx},${by}`);
  }
  assert.ok(ctx.points > 500);
});

test('a frame traces only its cells: few points at 10 nm near Tokyo Bay, bounded at 160 nm', () => {
  const b = buildCoast(raw);
  const [x, y] = toMap(35.55, 139.8);
  const count = (rangeNm, mPerPx) => {
    const reach = rangeNm * 1852 * 1.4, ctx = pathCtx();
    traceLand(ctx, b, b.lod(mPerPx), { x0: x - reach, y0: y - reach, x1: x + reach, y1: y + reach }, ident, 2 * mPerPx);
    return ctx.points;
  };
  const p10 = count(10, 10 * 1852 / 200), p160 = count(160, 160 * 1852 / 200);
  assert.ok(p10 < 15000, `10 nm: ${p10}`);
  assert.ok(p160 < 15000, `160 nm: ${p160}`);
});

test('screenBox: the map box of the screen round the aircraft, heading up', () => {
  const k = 0.01;   // px per m
  assert.deepEqual(screenBox(1000, 2000, 1, 0, k, -100, 100, -20, 130), { x0: -9000, y0: 0, x1: 11000, y1: 15000 });
  // Heading east (h = 90°): up on the screen is +x on the map.
  const b = screenBox(0, 0, Math.cos(Math.PI / 2), Math.sin(Math.PI / 2), k, -100, 100, -20, 130);
  assert.ok(Math.abs(b.x0 + 2000) < 1e-6 && Math.abs(b.x1 - 13000) < 1e-6 && Math.abs(b.y0 + 10000) < 1e-6 && Math.abs(b.y1 - 10000) < 1e-6, JSON.stringify(b));
});
