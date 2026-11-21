// v0.6.0 Part 1 step 4: the CPU's built-up cover reader (clipwindow.js's coverReader), which
// cities.js's and citylights.js's block tests read. Over Korea (fit) it is the cover grid
// indexed directly, so the block lists are v0.5.8's; in a following window (N = 1024 here)
// every cell the GPU holds (uNatExt) reads the national cover, every other cell 0, and its
// version changes when the valid rectangle does. Skipped while the national files or the tiles
// are missing (the last test runs on a fake store).
// (v0.7.0: the national grid went with v0.6.0's flags, and the two tests against it.)
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

test('cover reader: none without cover; a bare grid reads as itself', () => {
  assert.equal(coverReader({ uCover: { value: { image: { data: new Uint8Array(4) } } }, uHasCover: { value: 0 }, uNatSize: { value: { x: 1, y: 1 } } }), null);
  const d = new Uint8Array(3 * 2 * 4).map((_, k) => k);
  const R = coverReader({ uCover: { value: { image: { data: d } } }, uHasCover: { value: 1 }, uNatSize: { value: { x: 3, y: 2 } } });
  assert.ok(R.fit);
  assert.equal(R.at(2, 1), d[(1 * 3 + 2) * 4 + 2]);
  assert.equal(coverGrid(d, 3, 2).at(1, 0), 6);
});
