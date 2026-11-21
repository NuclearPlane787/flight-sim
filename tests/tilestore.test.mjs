// v0.6.0 Part 1: the terrain in tiles (src/world/tilestore.js) against Korea's national grid.
// Bit-exact: every sampler of heightfield.js returns the same doubles from the tiles as from
// the one national grid, everywhere (cell centres, cell corners, tile seams, the extent's edges
// and beyond); the borders hold the neighbours' cells; a tile that isn't resident is waited
// for and counted as a miss if sampled; far tiles are released, pinned ones never.
// Skipped while the tiles are missing. (v0.7.0: the national grid and Korea's own tiles went with v0.6.0's flags, and
// the three tests that compared the tiles with the grid; the rest run over the region's tiles.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHeightfield } from '../src/world/heightfield.js';
import { createTileStore } from '../src/world/tilestore.js';
import { maskAirportCover } from '../src/world/airport-mask.js';
import { tiledTerrain, readGz, manifest, DATA } from './tile-terrain.mjs';

const m = manifest();
const HAVE = !!m.tilesRegion;   // (v0.7.0: the region's tiles; Korea's own and the national grid went)
const airports = (m.airports || []).map((f) => JSON.parse(readFileSync(new URL(f, DATA), 'utf8')));

function nationalHf({ mask = false } = {}) {
  const n = m.national;
  const raw = (f) => { const b = gunzipSync(readFileSync(new URL(f, DATA))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const nat = { x0: n.x0, y0: n.y0, cell: n.cell, nx: n.nx, ny: n.ny, height: new Int16Array(raw(n.height)), water: new Uint8Array(raw(n.water)), cover: new Uint8Array(raw(n.cover)) };
  const g = (p, k) => ({ id: p.id, x0: p.x0, y0: p.y0, cell: p.cell, nx: p.nx, ny: p.ny, [k]: k === 'height' ? new Int16Array(raw(p.height)) : new Uint8Array(raw(p.coast)) });
  const patches = (m.patches || []).map((p) => g(p, 'height')).sort((a, b) => a.id.localeCompare(b.id));
  const coastPatches = (m.coastPatches || []).map((p) => g(p, 'coast')).sort((a, b) => a.id.localeCompare(b.id));
  const hf = createHeightfield({ heightScale: m.heightScale, national: nat, patches, coastPatches }, { airports });
  if (mask) maskAirportCover(hf, airports);
  return hf;
}

// A deterministic generator (no Math.random in tests that must repeat).
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function samplePoints() {
  const pts = [];
  const r = rng(6060);
  // Random over the square and a little beyond (the clamp).
  for (let k = 0; k < 200000; k++) pts.push([-420000 + r() * 840000, -420000 + r() * 840000]);
  // Cell centres and corners along every tile seam (x = −400 km + 128 km·n), both axes.
  for (let n = 0; n <= 7; n++) {
    const s = -400000 + n * 128000;
    for (let t = -400000; t <= 400000; t += 997) {
      for (const d of [-250, -125, -0.001, 0, 0.001, 125, 250]) { pts.push([s + d, t]); pts.push([t, s + d]); }
    }
  }
  // Around the airports (the patches, coasts and runway flattening).
  for (const a of airports) {
    const e = a.runways[0].ends[0];
    for (let k = 0; k < 20000; k++) pts.push([e.x + (r() - 0.5) * 20000, e.y + (r() - 0.5) * 20000]);
  }
  // Exactly the corners and far outside.
  for (const x of [-400000, -399875, 399875, 400000, -1e6, 1e6]) for (const y of [-400000, -399875, 399875, 400000, -1e6, 1e6]) pts.push([x, y]);
  return pts;
}

test('tiles: a tile that is not resident is waited for; sampling it counts a miss', { skip: !HAVE }, async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const store = createTileStore(m.tilesRegion, { layers: ['h'], readGz: async (rel) => { await gate; return readGz(rel); } });
  // Gimpo, in tile 2_4 or so.
  const x = -60000, y = 180000;
  assert.equal(store.isReady(x, y, 1000), false);
  const p = store.whenReady(x, y, 1000, 'aircraft');
  let done = false; p.then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(done, false, 'still waiting for the file');
  store.height(x, y);
  assert.equal(store.misses, 1, 'a sample before the tile is in is counted');
  release();
  await p;
  assert.equal(store.isReady(x, y, 1000), true);
  const before = store.misses;
  store.height(x, y);
  assert.equal(store.misses, before);
  // Open sea tiles need no file and are ready at once.
  const s = m.tilesRegion.levels[0];
  const seaKey = (() => { for (let tj = 0; tj < 7; tj++) for (let ti = 0; ti < 7; ti++) if (!s.tiles.includes(`${ti}_${tj}`)) return [ti, tj]; return null; })();
  if (seaKey) {
    const sx = m.tilesRegion.x0 + (seaKey[0] * 512 + 256) * 250, sy = m.tilesRegion.y0 + (seaKey[1] * 512 + 256) * 250;
    await store.whenReady(sx, sy, 0);
    const mm = store.misses;
    assert.equal(store.height(sx, sy), m.tilesRegion.sea.h);
    assert.equal(store.misses, mm);
  }
});

test('tiles: far tiles are released beyond maxTiles, pinned ones never', { skip: !HAVE }, async () => {
  const store = createTileStore(m.tilesRegion, { layers: ['h'], readGz, maxTiles: 4 });
  const gimpo = [-60000, 180000];
  await store.whenReady(gimpo[0], gimpo[1], 0, 'aircraft');
  const pinnedKeys = store.resident();
  // Walk across the land tiles.
  for (const k of m.tilesRegion.levels[0].tiles) {
    const [ti, tj] = k.split('_').map(Number);
    await store.whenReady(m.tilesRegion.x0 + (ti * 512 + 256) * 250, m.tilesRegion.y0 + (tj * 512 + 256) * 250, 0);
  }
  const res = store.resident();
  assert.ok(res.length <= 4, `resident ${res.length}`);
  for (const k of pinnedKeys) assert.ok(res.includes(k), `pinned ${k} kept`);
  assert.ok(store.evictions > 0);
  store.release('aircraft');
});

test('tiles: beyond the 250 m extent the 1 km level is read (the margin), waited for like l0', async () => {
  // Synthetic: l0 is one 4 x 4 tile of 250 m cells at h 100; l1 (1 km) reaches 4 km beyond it at h 40.
  const files = new Map();
  const tileOf = (n, v) => { const a = new Int16Array(n * n).fill(v); return a.buffer; };
  files.set('l0/0_0.h.i16.gz', tileOf(8, 100));
  for (const k of ['-1_-1', '0_-1', '-1_0', '0_0']) files.set(`l1/${k}.h.i16.gz`, tileOf(8, 40));
  const spec = { x0: 0, y0: 0, extent: { i0: 0, j0: 0, i1: 4, j1: 4 }, sea: { h: -160, w: [0, 255], c: [0, 0, 0, 0] },
    levels: [{ id: 'l0', cell: 250, tile: 4, border: 2, dir: 'l0/', extent: { i0: 0, j0: 0, i1: 4, j1: 4 }, tiles: ['0_0'] },
      { id: 'l1', cell: 1000, tile: 4, border: 2, dir: 'l1/', extent: { i0: -4, j0: -4, i1: 4, j1: 4 }, tiles: ['-1_-1', '0_-1', '-1_0', '0_0'] }] };
  const store = createTileStore(spec, { layers: ['h'], readGz: async (rel) => files.get(rel) || null });
  assert.equal(store.isReady(500, 500, 0), false);
  await store.whenReady(500, 500, 100);
  assert.equal(store.height(500, 500), 100, 'inside: the 250 m level');
  assert.equal(store.isReady(-2000, -2000, 0), false, 'the margin needs its l1 tile');
  await store.whenReady(-2000, -2000, 0);
  assert.equal(store.height(-2000, -2000), 40, 'beyond: the 1 km level');
  assert.equal(store.misses, 0);
  // (v0.7.0: the assertion that Korea's own manifest has no l1 beyond its l0 went with Korea's tiles.)
});

test('tiles: an unbaked l0 tile inside the extent reads the 1 km level, a baked sea tile reads sea', async () => {
  const files = new Map();
  const tileOf = (n, v) => new Int16Array(n * n).fill(v).buffer;
  files.set('l0/0_0.h.i16.gz', tileOf(8, 100));
  for (const k of ['0_0', '1_0']) files.set(`l1/${k}.h.i16.gz`, tileOf(8, 40));
  // l0: three tiles of 4 cells across; 0_0 has a file, 1_0 is baked open sea, 2_0 isn't baked.
  const spec = { x0: 0, y0: 0, extent: { i0: 0, j0: 0, i1: 12, j1: 4 }, sea: { h: -160, w: [0, 255], c: [0, 0, 0, 0] },
    levels: [{ id: 'l0', cell: 250, tile: 4, border: 2, dir: 'l0/', extent: { i0: 0, j0: 0, i1: 12, j1: 4 }, tiles: ['0_0'], covered: ['0_0', '1_0'] },
      { id: 'l1', cell: 1000, tile: 4, border: 2, dir: 'l1/', extent: { i0: 0, j0: 0, i1: 8, j1: 4 }, tiles: ['0_0', '1_0'] }] };
  const store = createTileStore(spec, { layers: ['h'], readGz: async (rel) => files.get(rel) || null });
  await store.whenReady(1500, 500, 0);   // in the baked sea tile
  assert.equal(store.height(1500, 500), -160);
  assert.equal(store.isReady(2500, 500, 0), false, 'the unbaked tile needs its l1 tile');
  await store.whenReady(2500, 500, 0);
  assert.equal(store.height(2500, 500), 40);
  assert.equal(store.misses, 0);
});

// v0.6.0 (the reviewer's finding): a listed tile whose file doesn't arrive must not become
// 'ready' reading open sea. It stays unready and is asked for again until it is whole.
test('tiles: a tile whose fetch fails is not ready, is retried, and then reads its real heights', async () => {
  const { createTileStore } = await import('../src/world/tilestore.js');
  const { manifest, readGz } = await import('./tile-terrain.mjs');
  const spec = manifest().tilesRegion;   // (v0.7.0: the region's tiles; Korea's own went)
  let fails = 2, asked = 0;
  const flaky = async (rel) => { if (rel.endsWith('h.i16.gz')) { asked++; if (fails > 0) { fails--; return null; } } return readGz(rel); };
  const A = createTileStore(spec, { layers: ['h', 'w'], readGz: flaky, retryMs: 20 });
  const B = createTileStore(spec, { layers: ['h', 'w'], readGz });
  const x = -40000, y = -20000;                    // Seoul's tile
  const wait = A.whenReady(x, y, 0, 'aircraft');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(A.isReady(x, y, 0), false, 'not ready while its height file has failed');
  assert.ok(A.failures >= 1, 'the failure is counted');
  // The store unrefs its retry timer (so a process can exit with a tile still failing); keep the
  // event loop alive here while we wait for the retries, or node may end the test first (Linux).
  const keepAlive = setInterval(() => {}, 10);
  try { await wait; } finally { clearInterval(keepAlive); }   // resolves only once the retries got the file
  await B.whenReady(x, y, 0, 'aircraft');
  assert.equal(A.isReady(x, y, 0), true);
  assert.equal(asked, 3, 'asked three times: two failures, then the file');
  assert.equal(A.height(x, y), B.height(x, y));
  assert.equal(A.misses, 0, 'and no sample read open sea in between');
});
