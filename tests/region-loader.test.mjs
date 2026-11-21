// v0.6.0: the terrain loader's waits (src/world/region.js): a frame's steps
// wait while a tile they could reach isn't in, and go once it is; over Korea fully loaded it
// never holds a step; with no tiles it does nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrainLoader, terrainSpec } from '../src/world/region.js';
import { createTileStore } from '../src/world/tilestore.js';
import { createHeightfield } from '../src/world/heightfield.js';
import { readGz, manifest, tiledTerrain } from './tile-terrain.mjs';

const m = manifest();

// (v0.7.0: the test of EAST_ASIA_ON's default went with the flag.)

test('the loader holds the steps until the tiles are in, then lets them go', { skip: !m.tilesRegion }, async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const store = createTileStore(m.tilesRegion, { layers: ['h'], readGz: async (rel) => { await gate; return readGz(rel); } });
  const hf = createHeightfield({ heightScale: 0.25, tiles: store, patches: [], coastPatches: [] });
  const L = createTerrainLoader(hf);
  const state = { pos: { x: -60000, y: 180000, z: 1000 }, vel: { x: 200, y: 0, z: 0 } };
  L.update(state, null, []);
  assert.equal(L.ready(state, 1 / 60), false, 'not before the tiles');
  release();
  await store.whenReady(state.pos.x, state.pos.y, 40000);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(L.ready(state, 1 / 60), true, 'once they are in');
  assert.equal(store.misses, 0);
});

test('over Korea fully loaded it never holds a step; without tiles it does nothing', { skip: !m.tilesRegion }, async () => {
  const { hf } = await tiledTerrain({ layers: ['h'] });
  const L = createTerrainLoader(hf);
  for (const [x, y] of [[-60000, 180000], [-100000, -300000], [399000, 399000], [-399000, -399000]]) {
    const st = { pos: { x, y, z: 3000 }, vel: { x: 250, y: 50, z: 0 } };
    L.update(st, null, [], true);
    assert.equal(L.ready(st, 0.1), true);
  }
  const N = createTerrainLoader(createHeightfield({}));
  assert.equal(N.ready({ pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } }, 1), true);
});

// (v0.7.0: the flag-off half went with the flag: Korea's `tiles` and lists, the default following
// EAST_ASIA_ON, and Korea's terrain from a manifest without the region's sections.)
test("terrainSpec: the region's terrain (when the manifest has it)", () => {
  const man = { tiles: { k: 'korea' }, patches: [{ id: 'jeju' }], coastPatches: [{ id: 'RKSS' }],
    tilesRegion: { k: 'region' }, patchesRegion: [{ id: 'fuji' }], coastPatchesRegion: [{ id: 'RJTT' }] };
  const on = terrainSpec(man);
  assert.equal(on.region, true); assert.equal(on.tiles.k, 'region');
  assert.deepEqual(on.patches.map((p) => p.id), ['jeju', 'fuji']); assert.deepEqual(on.coastPatches.map((p) => p.id), ['RKSS', 'RJTT']);
});
