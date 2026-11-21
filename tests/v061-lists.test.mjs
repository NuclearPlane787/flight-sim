// v0.6.1: the CPU's lists of the cells that can hold a house (rural.js candidateCells) or a tree
// (detail.js treeCells). The shaders still decide what stands; the lists must never be short of
// them, which the pictures prove on the GPU (STATUS.md: the same views before and after). Here:
// the hash is the shader's integer hash, and the rules list what they must and drop what they can.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ihash, FINE_PX } from '../src/world/finecover.js';
import { candidateCells } from '../src/world/rural.js';
import { treeCells, TREE_SNAP } from '../src/world/detail.js';

// glsl.js's ihash(ivec2, uint) written out with BigInt (uint32 wrap by hand).
function ref(cx, cy, s) {
  const M = 0xffffffffn, u = (v) => BigInt.asUintN(32, BigInt(v));
  let h = (u(cx) * 374761393n + u(cy) * 668265263n + u(s) * 2246822519n) & M;
  h = ((h ^ (h >> 13n)) * 1274126177n) & M;
  h ^= h >> 16n;
  return Number(h & 0xffffffn) / 16777216;
}

test('ihash is the shader\'s integer hash, negative cells too', () => {
  for (const [x, y, s] of [[0, 0, 71], [1, 2, 73], [-5, 7, 75], [-12800, 9000, 1], [38400, -25088, 3], [2147483, -2147483, 5]]) {
    assert.equal(ihash(x, y, s), ref(x, y, s));
    assert.ok(ihash(x, y, s) >= 0 && ihash(x, y, s) < 1);
  }
});

const HALF = 64, SNAP = 16, SPAN = 2 * HALF + SNAP - 1;
const listOf = (n, out) => { const set = new Set(); for (let k = 0; k < n; k++) set.add(out[2 * k] + ',' + out[2 * k + 1]); return set; };

test('houses: nothing without fine cover, a superset of the shader\'s rule with it', () => {
  const out = new Float32Array(SPAN * SPAN * 2);
  const ai = 1024, aj = -2048;
  const low = (x, y, lohi) => { lohi[0] = 0.05; lohi[1] = 0.08; };
  assert.equal(candidateCells(ai, aj, () => 0, low, out), 0, 'no data: no house');
  assert.equal(candidateCells(ai, aj, () => 2, low, out), 0, 'woods: no house');
  // Built-up everywhere, hardly any 250 m built-up share: a village house where h2 <= 0.82.
  let n = candidateCells(ai, aj, () => 6, low, out);
  let set = listOf(n, out), want = 0;
  for (let j = -HALF; j < -HALF + SPAN; j++) for (let i = -HALF; i < -HALF + SPAN; i++) {
    const keep = ihash(ai + i, aj + j, 73) <= 0.82;
    if (keep) { want++; assert.ok(set.has(i + ',' + j), `cell ${i},${j} is listed`); }
  }
  assert.ok(n >= want && n <= want + 2, `${n} listed for ${want} kept`);
  assert.ok(n / (SPAN * SPAN) > 0.78 && n / (SPAN * SPAN) < 0.86);
  // Crop everywhere: a farmhouse in about one cell in 45.
  n = candidateCells(ai, aj, () => 5, low, out);
  assert.ok(n / (SPAN * SPAN) > 0.015 && n / (SPAN * SPAN) < 0.03, `${n} farmhouses`);
  // Built-up inside a city (the blocks take over): only the sheds' hash, and none where the share is past them.
  n = candidateCells(ai, aj, () => 6, (x, y, lohi) => { lohi[0] = 0.5; lohi[1] = 0.55; }, out);
  assert.ok(n / (SPAN * SPAN) > 0.11 && n / (SPAN * SPAN) < 0.17, `${n} sheds`);
  assert.equal(candidateCells(ai, aj, () => 6, (x, y, lohi) => { lohi[0] = 0.8; lohi[1] = 0.9; }, out), 0, 'a dense city: none');
});

test('houses: the list asks for the building\'s own pixel and the cover at its place', () => {
  const out = new Float32Array(SPAN * SPAN * 2);
  const ai = 0, aj = 0;
  let asked = 0, bad = 0;
  const texel = (P, Q) => { asked++; if (P < (ai - HALF) * 2 || P >= (ai - HALF + SPAN) * 2 || Q < (aj - HALF) * 2 || Q >= (aj - HALF + SPAN) * 2) bad++; return 6; };
  let far = 0;
  const urban = (x, y, lohi) => {
    const cx = (x + 400000) / (2 * FINE_PX), cy = (y + 400000) / (2 * FINE_PX);
    if (cx < ai - HALF || cx > ai - HALF + SPAN || cy < aj - HALF || cy > aj - HALF + SPAN) far++;
    lohi[0] = lohi[1] = 0;
  };
  candidateCells(ai, aj, texel, urban, out);
  assert.equal(bad, 0); assert.equal(far, 0);
  assert.ok(asked >= SPAN * SPAN && asked < SPAN * SPAN + 8, 'one pixel a cell (two only on a hash\'s edge)');
});

test('trees: a tree pixel lists the cell; with no data or in an airfield, the 250 m forest share decides', () => {
  const half = 40, span = 2 * half + TREE_SNAP - 1, out = new Float32Array(span * span * 2);
  const cover = (mark, forest) => (x, y, o) => { o.mark = mark; o.forest = forest; };
  const sstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
  for (const spacing of [7, 28, 112]) {
    const ai = Math.floor(-300000 / spacing / TREE_SNAP) * TREE_SNAP, aj = Math.floor(120000 / spacing / TREE_SNAP) * TREE_SNAP;
    assert.equal(treeCells(ai, aj, half, spacing, () => 5, cover(0, 1), out), 0, 'crop: no tree, whatever the 250 m cover says');
    assert.equal(treeCells(ai, aj, half, spacing, () => 1, cover(0, 1), out), 0, 'water: no tree');
    const count = (lim) => { let k = 0; for (let j = -half; j < -half + span; j++) for (let i = -half; i < -half + span; i++) if (ihash(ai + i, aj + j, 3) <= lim) k++; return k; };
    const all = count(0.92);
    const near = (n, want, what) => assert.ok(n >= want && n <= want + 3, `${what} at ${spacing} m: ${n} listed, ${want} by the rule`);
    near(treeCells(ai, aj, half, spacing, () => 2, cover(0, 0), out), all, 'woods');
    near(treeCells(ai, aj, half, spacing, () => 0, cover(0, 1), out), all, 'no data, forest all round');
    near(treeCells(ai, aj, half, spacing, () => 5, cover(1, 1), out), all, 'an airfield\'s edge with forest beside it');
    // No forest in the 250 m cover: only what the noise alone could grow (under 2 % of the cells).
    const bare = count(0.92 * sstep(0.35, 0.65, 0.375));
    near(treeCells(ai, aj, half, spacing, () => 0, cover(0, 0), out), bare, 'no data, no forest');
    near(treeCells(ai, aj, half, spacing, () => 5, cover(1, 0), out), bare, 'an airfield');
    assert.ok(bare < 0.02 * span * span);
  }
});

test('trees: the pixel asked is the tree\'s own (its jittered place in the cell)', () => {
  const half = 40, spacing = 14, span = 2 * half + TREE_SNAP - 1, out = new Float32Array(span * span * 2);
  const ai = 1600, aj = -3200;
  // Trees only in the pixels of one column band: listed cells are the ones whose tree stands in it (or a pixel's edge next to it).
  const P0 = Math.floor((ai * spacing + 400000) / FINE_PX) + 3;
  const n = treeCells(ai, aj, half, spacing, (P) => (P === P0 ? 2 : 5), (x, y, o) => { o.mark = 0; o.forest = 0; }, out);
  assert.ok(n > 0);
  for (let k = 0; k < n; k++) {
    const cx = ai + out[2 * k], cy = aj + out[2 * k + 1];
    const px = ((cx + 0.15 + 0.7 * ihash(cx, cy, 1)) * spacing + 400000) / FINE_PX;
    assert.ok(px > P0 - 0.03 && px < P0 + 1.03, `cell ${cx}: its tree at pixel ${px.toFixed(2)}, the band ${P0}`);
  }
});

// v0.6.1: the airfield's mark has two levels, so the terrain can keep fields off the cells inside the
// fence without taking the paddies beside it: 255 where the cell's own centre is inside the boundary,
// 200 where only a neighbour's is. Every older rule (more than 0.2, or 0.25 to 0.75) reads both as marked.
test('the airport mask: 255 inside the fence, 200 in the ring of neighbours, nothing beyond', async () => {
  const { maskAirportCover } = await import('../src/world/airport-mask.js');
  {   // (v0.7.0: v0.6.0's ground flag is gone; this ran with it on)
    const g = { layers: { national: { x0: 0, y0: 0, cell: 250, nx: 20, ny: 20, cover: new Uint8Array(20 * 20 * 4) } } };
    g.layers.national.cover.fill(90);
    for (let k = 3; k < 1600; k += 4) g.layers.national.cover[k] = 0;
    maskAirportCover(g, [{ boundary: [[1000, 1000], [3000, 1000], [3000, 3000], [1000, 3000]] }]);
    const c = g.layers.national.cover, at = (i, j) => [...c.slice((j * 20 + i) * 4, (j * 20 + i) * 4 + 4)];
    assert.deepEqual(at(8, 8), [0, 90, 0, 255], 'a cell inside: cleared and marked 255 (its farm share untouched)');
    assert.deepEqual(at(4, 4), [0, 90, 0, 255], 'the corner cell inside (centre 1125, 1125)');
    assert.deepEqual(at(3, 8), [0, 90, 0, 200], 'the neighbour of an inside cell: cleared as before, marked 200');
    assert.deepEqual(at(12, 8), [0, 90, 0, 200]);
    assert.deepEqual(at(2, 8), [90, 90, 90, 0], 'two cells out: untouched');
    assert.deepEqual(at(17, 17), [90, 90, 90, 0]);
    // A second airport's ring over the first's inside doesn't lower it.
    maskAirportCover(g, [{ boundary: [[3050, 1000], [4000, 1000], [4000, 3000], [3050, 3000]] }]);
    assert.equal(at(11, 8)[3], 255, 'still 255 where the first airport\'s cell is inside');
    // The shader's rules on the two levels: both over 0.75 (the fine cover off, no houses or woodlots);
    // only 255 over the terrain's 0.86 to 0.98 (no fields).
    const sst = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
    assert.equal(sst(0.25, 0.75, 200 / 255), 1); assert.equal(sst(0.25, 0.75, 1), 1);
    assert.equal(sst(0.86, 0.98, 200 / 255), 0); assert.equal(sst(0.86, 0.98, 1), 1);
  }
});
