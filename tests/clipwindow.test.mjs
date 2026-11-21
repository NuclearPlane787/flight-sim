// v0.6.0 Part 1 step 3: the GPU's clip window (src/world/clipwindow.js) against Korea's national
// grid, the textures v0.5.8 uploaded. Korea fits, so its window is the extent itself (3200²,
// fixed): every texel the national grid's height, water and (masked) cover, and normalsRG() over
// the whole national grid. A smaller toroidal window that has to follow the camera, refilled a
// tile at a time, holds for every cell of the window the national cell clamped to the extent.
// Skipped while the national files or the tiles are missing. (v0.7.0: they went with v0.6.0's flags, and with them the
// two tests against the national grid; the window's own arithmetic is still checked below.)
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
