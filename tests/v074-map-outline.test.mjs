// v0.7.4 items 2 and 3: the 250 m data's outline as the map draws it (src/ui/map-outline.js): staircases cut
// diagonally, single corners square, as much cut off as added, and both regions' real outlines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { outlineRings, cutStaircases, smoothOutline, ringArea } from '../src/ui/map-outline.js';
import { tileOutline } from '../src/world/region.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const S = 1000;
// region.js's tileOutline() over a set of covered tiles given as "i_j" names.
const edgesOf = (names) => tileOutline({ x0: 0, y0: 0, levels: [{ tile: 1, cell: S, covered: names }] });
const cells = (list) => list.map(([i, j]) => `${i}_${j}`);
const areaOfCells = (names) => names.length * S * S;
const total = (rings) => rings.reduce((a, r) => a + Math.abs(ringArea(r)), 0);
const hasDiagonal = (r) => r.some((p, i) => { const q = r[(i + 1) % r.length]; return p[0] !== q[0] && p[1] !== q[1]; });

test('a rectangle stays a rectangle', () => {
  const names = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) names.push(`${i}_${j}`);
  const rings = smoothOutline(edgesOf(names));
  assert.equal(rings.length, 1);
  assert.equal(rings[0].length, 4);
  assert.equal(total(rings), areaOfCells(names));
});

test('a single corner between longer sides stays square (an L)', () => {
  const names = cells([[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [0, 2], [0, 3], [1, 1], [2, 1], [3, 1], [1, 2], [1, 3]]);
  const rings = smoothOutline(edgesOf(names));
  assert.equal(rings.length, 1);
  assert.ok(!hasDiagonal(rings[0]), JSON.stringify(rings[0]));
  assert.equal(total(rings), areaOfCells(names));
});

test('a one-tile notch (a single step down and back) stays square', () => {
  // a 4x3 block with one tile missing from the top edge's middle
  const names = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) if (!(i === 2 && j === 2)) names.push(`${i}_${j}`);
  const rings = smoothOutline(edgesOf(names));
  assert.ok(!hasDiagonal(rings[0]));
});

test('a 1:1 staircase becomes one straight line through the steps\' midpoints, cutting off as much as it adds', () => {
  // A triangle-ish block: column i has height 6 - i for i < 4, so its top-right side is a staircase of one-tile steps.
  const names = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < Math.max(1, 6 - i); j++) names.push(`${i}_${j}`);
  const edges = edgesOf(names);
  const rings = smoothOutline(edges);
  assert.equal(rings.length, 1);
  const r = rings[0];
  assert.ok(hasDiagonal(r), JSON.stringify(r));
  // every diagonal side has slope ±1
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length];
    if (p[0] !== q[0] && p[1] !== q[1]) assert.equal(Math.abs((q[1] - p[1]) / (q[0] - p[0])), 1);
  }
  // the diagonal's ends are midpoints of tile sides (a half tile off the grid in one axis)
  const diag = r.filter((p) => (p[0] / S) % 1 !== 0 || (p[1] / S) % 1 !== 0);
  assert.ok(diag.length >= 2);
  assert.equal(total(rings), areaOfCells(names));
});

test('a 2:1 staircase is cut at its own slope, area kept', () => {
  // rows step back two tiles every row: row j covers i < 10 - 2j
  const names = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 10 - 2 * j; i++) names.push(`${i}_${j}`);
  const rings = smoothOutline(edgesOf(names));
  const r = rings[0];
  assert.ok(hasDiagonal(r));
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length];
    if (p[0] !== q[0] && p[1] !== q[1]) assert.equal(Math.abs((q[1] - p[1]) / (q[0] - p[0])), 0.5);
  }
  assert.equal(total(rings), areaOfCells(names));
});

test('a mixed run keeps its area', () => {
  const ring = [[0, 0], [10, 0], [10, 1], [9, 1], [9, 2], [6, 2], [6, 3], [0, 3]];
  const out = cutStaircases(ring);
  assert.equal(total([out]), total([ring]));
});

test('two tiles touching at a corner make two rings, each kept whole', () => {
  const names = cells([[0, 0], [1, 1]]);
  const { rings } = outlineRings(edgesOf(names));
  assert.equal(rings.length, 2);
  assert.equal(total(smoothOutline(edgesOf(names))), areaOfCells(names));
});

for (const [region, dir] of [['east-asia', 'data'], ['europe', 'data/europe']]) {
  test(`${region}'s real outline: closed rings, area kept to the square metre, and staircases cut`, () => {
    const m = JSON.parse(fs.readFileSync(path.join(HERE, '..', dir, 'manifest.json'), 'utf8'));
    const spec = m.tilesRegion, L = spec.levels[0];
    const edges = tileOutline(spec);
    const rings = smoothOutline(edges);
    const size = L.tile * L.cell;
    // the rings' area (outer minus holes) is the covered tiles' area
    const signed = rings.reduce((a, r) => a + ringArea(r), 0);
    const raw = outlineRings(edges).rings.reduce((a, r) => a + ringArea(r), 0) * size * size;
    assert.ok(Math.abs(Math.abs(signed) - Math.abs(raw)) < 1, `${signed} vs ${raw}`);
    assert.ok(Math.abs(Math.abs(raw) - L.covered.length * size * size) < 1);
    assert.ok(rings.some(hasDiagonal), 'some staircase is cut');
    // every point is on the tile grid or a half tile off it
    for (const r of rings) for (const [x, y] of r) {
      for (const [v, o] of [[x, spec.x0], [y, spec.y0]]) assert.ok(Math.abs(((v - o) / size) * 2 - Math.round(((v - o) / size) * 2)) < 1e-9);
    }
  });
}

test('traceClipped keeps only what is on the screen, joined where it runs on', async () => {
  const { traceClipped } = await import('../src/ui/map-outline.js');
  const ops = [];
  const ctx = { moveTo: (x, y) => ops.push(['M', x, y]), lineTo: (x, y) => ops.push(['L', x, y]) };
  const box = { x0: 0, y0: 0, x1: 100, y1: 100 };
  // a long horizontal line far past both sides, then down and back inside
  traceClipped(ctx, [-1e6, 50, 1e6, 50, 1e6, 60, 50, 60], false, box);
  assert.deepEqual(ops[0], ['M', 0, 50]);
  assert.deepEqual(ops[1], ['L', 100, 50]);
  // the last leg enters at x = 100 and ends inside
  assert.deepEqual(ops.at(-1), ['L', 50, 60]);
  assert.ok(ops.every(([, x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100));
  ops.length = 0;
  traceClipped(ctx, [10, 10, 90, 10, 90, 90, 10, 90], true, box);   // a square inside: one subpath, four sides
  assert.equal(ops.filter((o) => o[0] === 'M').length, 1);
  assert.equal(ops.filter((o) => o[0] === 'L').length, 4);
  ops.length = 0;
  traceClipped(ctx, [-500, -500, -400, -500], false, box);
  assert.equal(ops.length, 0);
});

test('a single one-tile jog between longer sides running the same way is cut 1:1, area kept', () => {
  const ring = [[0, 0], [6, 0], [6, 2], [3, 2], [3, 3], [0, 3]];
  const out = cutStaircases(ring);
  assert.ok(hasDiagonal(out), JSON.stringify(out));
  assert.equal(Math.abs(ringArea(out)), Math.abs(ringArea(ring)));
  assert.ok(out.some(([x, y]) => x === 3.5 && y === 2) && out.some(([x, y]) => x === 2.5 && y === 3));
});
