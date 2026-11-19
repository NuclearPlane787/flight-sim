// v0.6.0 Part 1 step 4: the CPU's built-up cover reader (clipwindow.js's coverReader), which
// cities.js's and citylights.js's block tests read. Over Korea (fit) it is the cover grid
// indexed directly, so the block lists are v0.5.8's; in a following window (N = 1024 here)
// every cell the GPU holds (uNatExt) reads the national cover, every other cell 0, and its
// version changes when the valid rectangle does. Skipped while the national files or the tiles
// are missing (the last test runs on a fake store).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createClipWindow, coverReader, coverGrid } from '../src/world/clipwindow.js';
import { makeBlockTest } from '../src/world/citylights.js';
import { maskAirportCover } from '../src/world/airport-mask.js';
import { tiledTerrain, manifest, DATA } from './tile-terrain.mjs';

const m = manifest();
const HAVE = !!(m.national && m.tiles && existsSync(new URL(m.national.height, DATA)));
const airports = (m.airports || []).map((f) => JSON.parse(readFileSync(new URL(f, DATA), 'utf8')));

function national() {
  const n = m.national;
  const raw = (f) => { const b = gunzipSync(readFileSync(new URL(f, DATA))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const g = { x0: n.x0, y0: n.y0, cell: n.cell, nx: n.nx, ny: n.ny, height: new Int16Array(raw(n.height)), water: new Uint8Array(raw(n.water)), cover: new Uint8Array(raw(n.cover)) };
  maskAirportCover({ layers: { national: g } }, airports);
  return g;
}

async function store() {
  const { hf } = await tiledTerrain({ layers: ['h', 'w', 'c'], onTile: (g) => maskAirportCover({ layers: { national: g } }, airports) });
  return hf.layers.tiles;
}

// The uniforms glsl.js builds round a clip window (only what coverReader reads), uNatExt set as
// attachClip's setExt does.
function uniformsFor(cw) {
  const W = cw.win, v = cw.valid();
  const u = {
    uCover: { value: { image: { data: cw.c } } }, uHasCover: { value: 1 },
    uNat: { value: { x: W.x0 + W.bi * W.cell, y: W.y0 + W.bj * W.cell, z: W.cell, w: 0 } },
    uNatSize: { value: { x: cw.nx, y: cw.ny } },
    uNatExt: { value: { x: 0, y: 0, z: 0, w: 0 } },
  };
  u.setExt = (a) => Object.assign(u.uNatExt.value, { x: a[0] - W.bi, y: a[1] - W.bj, z: a[2] - 1 - W.bi, w: a[3] - 1 - W.bj });
  u.setExt(v);
  Object.defineProperty(u, '__clip', { value: { window: cw }, enumerable: false });
  return u;
}

test('cover reader: over Korea (fit) the cover grid itself, and the block tests unchanged', { skip: !HAVE }, async () => {
  const g = national();
  const cw = createClipWindow(await store());
  assert.ok(cw.fit);
  const u = uniformsFor(cw);
  const R = coverReader(u);
  assert.ok(R.fit);
  assert.deepEqual([R.lo, R.hi], [[0, 0], [g.nx - 1, g.ny - 1]]);
  let bad = 0;
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) if (R.at(i, j) !== g.cover[(j * g.nx + i) * 4 + 2]) bad++;
  assert.equal(bad, 0);
  assert.equal(R.version(), R.version());
  // The lights' block test through the reader and through the bare grid (v0.5.8's call) agree at
  // every level, including blocks off the map's edges.
  const nat = u.uNat.value, size = { x: g.nx, y: g.ny };
  const a = makeBlockTest(R, nat, size), b = makeBlockTest(g.cover, nat, size);
  let n = 0, built = 0;
  for (let lv = 0; lv < 5; lv++) {
    const B = 400 * 2 ** lv, s = Math.max(1, Math.round(80 / 2 ** lv));
    for (let by = Math.floor(nat.y / B) - 3; by < Math.ceil((nat.y + g.ny * 250) / B) + 3; by += s)
      for (let bx = Math.floor(nat.x / B) - 3; bx < Math.ceil((nat.x + g.nx * 250) / B) + 3; bx += s) {
        const va = a(lv, bx, by);
        assert.equal(va, b(lv, bx, by), `level ${lv} block ${bx},${by}`);
        n++; if (va) built++;
      }
  }
  assert.ok(n > 1000 && built > 50, `${n} blocks, ${built} built`);
});

test('cover reader: a following window reads the national cover where it is valid, 0 elsewhere', { skip: !HAVE }, async () => {
  const g = national();
  const cw = createClipWindow(await store(), { N: 1024 });
  assert.ok(!cw.fit);
  const u = uniformsFor(cw);
  const R = coverReader(u);
  assert.ok(!R.fit);
  const nat = u.uNat.value;
  const grid = makeBlockTest(g.cover, { x: g.x0, y: g.y0, z: g.cell }, { x: g.nx, y: g.ny });
  let v0 = R.version(), blocksChecked = 0, built = 0, moved = 0;
  for (const [x, y] of [[-300000, -300000], [-60000, -40000], [250000, -200000], [-200000, 250000], [-10000, 30000], [200000, 300000]]) {
    const before = cw.valid().join();
    cw.moveTo(x, y);
    while (cw.step()) {}
    u.setExt(cw.valid());
    const v = R.version();
    if (cw.valid().join() !== before) { assert.notEqual(v, v0, 'the version changes with the valid rectangle'); moved++; }
    else assert.equal(v, v0);
    v0 = v;
    assert.equal(R.version(), v);
    const [i0, j0, i1, j1] = cw.valid();
    let bad = 0;
    for (let j = j0 - 64; j < j1 + 64; j++) for (let i = i0 - 64; i < i1 + 64; i++) {
      const inside = i >= i0 && i < i1 && j >= j0 && j < j1;
      const want = inside ? g.cover[(j * g.nx + i) * 4 + 2] : 0;
      if (R.at(i - cw.win.bi, j - cw.win.bj) !== want) bad++;
    }
    assert.equal(bad, 0, `window at ${cw.win.oi}, ${cw.win.oj}`);
    // The lights' block test: the national answer for every level-0..2 block well inside the window.
    const t = makeBlockTest(R, nat, u.uNatSize.value);
    for (let lv = 0; lv < 3; lv++) {
      const B = 400 * 2 ** lv, rC = Math.ceil((B * 0.72 + 250) / 250) + 2;
      for (let by = Math.ceil((nat.y + (j0 + rC) * 250) / B); (by + 1) * B < nat.y + (j1 - rC) * 250; by += 3)
        for (let bx = Math.ceil((nat.x + (i0 + rC) * 250) / B); (bx + 1) * B < nat.x + (i1 - rC) * 250; bx += 3) {
          const va = t(lv, bx, by);
          assert.equal(va, grid(lv, bx, by), `level ${lv} block ${bx},${by}`);
          blocksChecked++; if (va) built++;
        }
    }
  }
  assert.ok(moved >= 3, `moved ${moved}`);
  assert.ok(blocksChecked > 1000 && built > 50, `${blocksChecked} blocks, ${built} built`);
});

test('cover reader: none without cover; a bare grid reads as itself', () => {
  assert.equal(coverReader({ uCover: { value: { image: { data: new Uint8Array(4) } } }, uHasCover: { value: 0 }, uNatSize: { value: { x: 1, y: 1 } } }), null);
  const d = new Uint8Array(3 * 2 * 4).map((_, k) => k);
  const R = coverReader({ uCover: { value: { image: { data: d } } }, uHasCover: { value: 1 }, uNatSize: { value: { x: 3, y: 2 } } });
  assert.ok(R.fit);
  assert.equal(R.at(2, 1), d[(1 * 3 + 2) * 4 + 2]);
  assert.equal(coverGrid(d, 3, 2).at(1, 0), 6);
});
