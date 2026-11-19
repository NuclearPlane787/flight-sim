// v0.6.0 Part 1 step 3: the GPU's clip window (src/world/clipwindow.js) against Korea's national
// grid, the textures v0.5.8 uploaded. Korea fits, so its window is the extent itself (3200²,
// fixed): every texel the national grid's height, water and (masked) cover, and normalsRG() over
// the whole national grid. A smaller toroidal window that has to follow the camera, refilled a
// tile at a time, holds for every cell of the window the national cell clamped to the extent.
// Skipped while the national files or the tiles are missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createClipWindow, CLIP_N } from '../src/world/clipwindow.js';
import { normalsRG } from '../src/world/glsl.js';
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

// Compare every texel of window cw with the national grid g (and its normals nrm).
function compare(cw, g, nrm) {
  const { oi, oj } = cw.win;
  const cl = (v, n) => (v < 0 ? 0 : v >= n ? n - 1 : v);
  let bad = 0;
  const seen = new Uint8Array(cw.nx * cw.ny);
  for (let gj = oj; gj < oj + cw.ny; gj++) {
    const cj = cl(gj, g.ny);
    for (let gi = oi; gi < oi + cw.nx; gi++) {
      const ci = cl(gi, g.nx);
      const o = cw.texel(gi, gj), s = cj * g.nx + ci, p = gi, q = gj;
      seen[o]++;
      if (cw.h[o] !== g.height[s] || cw.n[o * 2] !== nrm[s * 2] || cw.n[o * 2 + 1] !== nrm[s * 2 + 1]
        || cw.w[o * 2] !== g.water[s * 2] || cw.w[o * 2 + 1] !== g.water[s * 2 + 1]
        || cw.c[o * 4] !== g.cover[s * 4] || cw.c[o * 4 + 1] !== g.cover[s * 4 + 1] || cw.c[o * 4 + 2] !== g.cover[s * 4 + 2] || cw.c[o * 4 + 3] !== g.cover[s * 4 + 3]) {
        if (bad++ < 5) console.log('texel', p, q, 'cell', gi, gj);
      }
    }
  }
  if (seen.some((v) => v !== 1)) bad += 1e9;   // every texel exactly one cell of the window
  return bad;
}

test('clip window: the window over Korea is the national textures, cell for cell', { skip: !HAVE }, async () => {
  const g = national();
  const nrm = normalsRG(g.height, g.nx, g.ny, g.cell, m.heightScale || 0.25);
  const st = await store();
  const cw = createClipWindow(st);
  assert.ok(cw.fit && CLIP_N >= 3200);
  // Korea fits: the window is the extent, fixed, global cell 0 at texel 0.
  assert.deepEqual([cw.win.oi, cw.win.oj, cw.nx, cw.ny], [0, 0, 3200, 3200]);
  assert.deepEqual(cw.valid(), [0, 0, 3200, 3200]);
  assert.equal(cw.texel(0, 0), 0);
  assert.equal(cw.queue.length, 0);
  assert.equal(compare(cw, g, nrm), 0);
  // The national texture's texels at their own positions (the extent's part of the window).
  assert.deepEqual(cw.h, g.height); assert.deepEqual(cw.w, g.water); assert.deepEqual(cw.c, g.cover); assert.deepEqual(cw.n, nrm);
  // Moving the camera anywhere doesn't move a window that holds the whole extent.
  for (const [x, y] of [[0, 0], [-390000, -390000], [399000, 399000], [2e6, -2e6]]) assert.equal(cw.moveTo(x, y), false);
  assert.equal(st.misses, 0);
});

test('clip window: a window smaller than the extent follows the camera a tile at a time', { skip: !HAVE }, async () => {
  const g = national();
  const nrm = normalsRG(g.height, g.nx, g.ny, g.cell, m.heightScale || 0.25);
  const st = await store();
  const cw = createClipWindow(st, { N: 1024 });
  assert.ok(!cw.fit);
  // A flight from the south-west corner across to the north-east, refilling as it goes.
  let moves = 0, steps = 0, maxRects = 0;
  for (let s = 0; s <= 40; s++) {
    const x = -390000 + s * 19500, y = -390000 + s * 19500;
    if (cw.moveTo(x, y)) moves++;
    let r;
    while ((r = cw.step())) { steps++; maxRects = Math.max(maxRects, r.length); }   // each step is one tile's cells
    assert.equal(compare(cw, g, nrm), 0, `after step ${s}`);
  }
  assert.ok(moves >= 3, `moved ${moves} times`);
  assert.ok(steps > 0 && maxRects <= 4);
  // The window keeps the camera inside, at least a tile from its edges.
  const cx = Math.floor((380000 + 400000) / 250);
  assert.ok(cx >= cw.win.oi + 512 - 512 && cx < cw.win.oi + 1024);
  assert.equal(st.misses, 0);
});

test('clip window: texel rectangles split where the window wraps', () => {
  const fake = { lattice: { x0: 0, y0: 0, cell: 250, tile: 512, border: 2, extent: { i0: 0, j0: 0, i1: 512, j1: 512 } }, spec: { levels: [{ tiles: [] }], sea: { h: -160, w: [0, 255], c: [0, 0, 0, 0] } }, has: { h: true, w: true, c: true }, tileGrid: () => null };
  const cw = createClipWindow(fake, { N: 256 });
  assert.ok(!cw.fit);
  assert.deepEqual(cw.texelRects(232, 0, 332, 10), [{ x: 232, y: 0, w: 24, h: 10 }, { x: 0, y: 0, w: 76, h: 10 }]);
  assert.deepEqual(cw.texelRects(-10, -10, 10, 10).length, 4);
  // Open sea everywhere: heights -160, flat normals, sea water, no cover.
  assert.equal(cw.h[cw.texel(5, 5)], -160);
  assert.deepEqual([...cw.n.subarray(0, 2)], [128, 128]);
  assert.deepEqual([...cw.w.subarray(0, 2)], [0, 255]);
});
