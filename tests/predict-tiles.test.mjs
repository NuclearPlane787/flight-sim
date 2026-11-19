// v0.6.0: the prediction over tiles loaded as the run reaches them (the worker's way,
// tilesForChunk) gives the same samples as over every tile loaded at once, with no sample
// ever read from a tile that wasn't in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPredictionRun, tilesForChunk, tilesForSnap } from '../src/sim/predict-core.js';
import { createTiledHeightfield } from '../src/world/heightfield.js';
import { airborne, KT } from './sim-helpers.mjs';
import { tiledTerrain, manifest, readGz, readJson, DATA } from './tile-terrain.mjs';

const m = manifest();

test('a path from near Gimpo: tiles by chunk = every tile at once, 0 misses', { skip: !m.tiles }, async () => {
  const { hf: full, airports } = await tiledTerrain({ layers: ['h'] });
  // Slow reads, so the chunks really wait.
  const slow = async (rel) => { await new Promise((r) => setTimeout(r, 2)); return readGz(rel); };
  const lazy = await createTiledHeightfield(m, DATA.href, { layers: ['h'], coasts: false, airports, readGz: slow, readJson, maxTiles: 6 });
  // Over Gimpo, south-east at 4,000 ft towards the hills (the path meets or skims the terrain).
  const sim = airborne({ massKg: 70000, fuelKg: 8000, altFt: 4000, iasKt: 250, hdg: 2.4, ap: { ap: true, athr: true, spdKt: 250, hdgDeg: 135, altFt: 4000 } });
  sim.controls.thrust = 25 / 45;
  const snap = sim.snapshot();
  snap.core.px += -60000; snap.core.py += 180000;
  const a = createPredictionRun(snap, { maxMinutes: 20 }, full);
  while (!a.advance(3000));
  await tilesForSnap(snap, lazy);
  const b = createPredictionRun(snap, { maxMinutes: 20 }, lazy);
  let waits = 0;
  while (true) {
    const w = tilesForChunk(b, lazy, 3000);
    if (w) { waits++; await w; }
    if (b.advance(3000)) break;
  }
  assert.ok(waits >= 1, 'the lazy run waited for tiles');
  assert.equal(lazy.tiles.misses, 0);
  assert.equal(b.reason, a.reason);
  assert.equal(b.samples.length, a.samples.length);
  for (let k = 0; k < a.samples.length; k++) {
    assert.equal(b.samples[k].x, a.samples[k].x); assert.equal(b.samples[k].y, a.samples[k].y); assert.equal(b.samples[k].z, a.samples[k].z);
  }
});
