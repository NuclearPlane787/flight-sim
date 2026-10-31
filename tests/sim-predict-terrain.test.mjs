// The predicted path over the real terrain (the heights the worker loads, read here from
// data/ with fs): it ends at the ground with reason 'terrain', keeps clear of it, is the
// same as before over the sea, and a jump still lands exactly on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createSim } from '../src/sim/sim.js';
import { predictSync, createPredictionRun, terrainGround, TERRAIN_CLEAR_M } from '../src/sim/predict-core.js';
import { createHeightfield } from '../src/world/heightfield.js';
import { toMap } from '../src/world/frame.js';
import { airborne, run, KT } from './sim-helpers.mjs';

const DATA = new URL('../data/', import.meta.url);
const HAVE = existsSync(new URL('terrain/height.i16.gz', DATA));

// The worker's layers: national heights, the 30 m patches, the runway flattening.
function loadHf() {
  const m = JSON.parse(readFileSync(new URL('manifest.json', DATA), 'utf8'));
  const i16 = (f) => { const b = gunzipSync(readFileSync(new URL(f, DATA))); return new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2); };
  const n = m.national;
  const patches = (m.patches || []).map((p) => ({ id: p.id, x0: p.x0, y0: p.y0, cell: p.cell, nx: p.nx, ny: p.ny, height: i16(p.height) }));
  const airports = (m.airports || []).map((f) => JSON.parse(readFileSync(new URL(f, DATA), 'utf8')));
  return createHeightfield({ heightScale: m.heightScale, national: { ...n, height: i16(n.height), water: null, cover: null }, patches, coastPatches: [] }, { airports });
}
const hf = HAVE ? loadHf() : null;

// Level at altFt with the AP in ALT and HDG, at (x, y).
function cruise(x, y, { altFt, hdg, hdgDeg, iasKt = 250 }) {
  const sim = airborne({ massKg: 70000, fuelKg: 8000, altFt, iasKt, hdg, ap: { ap: true, athr: true, spdKt: iasKt, hdgDeg, altFt } });
  sim.controls.thrust = 25 / 45;
  const snap = sim.snapshot();
  snap.core.px += x; snap.core.py += y;
  return snap;
}

const [HX, HY] = toMap(33.3617, 126.5331); // Hallasan's summit (1,947 m)

test('a path at 4,000 ft heading north at Hallasan ends at the terrain, clear of it', { skip: !HAVE }, () => {
  assert.ok(hf.heightAt(HX, HY) > 1800, `summit ${hf.heightAt(HX, HY)}`);
  const snap = cruise(HX, HY - 30000, { altFt: 4000, hdg: 0, hdgDeg: 0 });
  const t0 = performance.now();
  const r = predictSync(snap, {}, hf);
  const ms = performance.now() - t0;
  const last = r.samples[r.samples.length - 1];
  console.log(`Hallasan: ${r.reason}, ${r.samples.length} samples, last ${((HY - last.y) / 1000).toFixed(1)} km south of the summit, ` +
    `${(last.z - hf.heightAt(last.x, last.y)).toFixed(0)} m AGL; impact ${((HY - last.impact.y) / 1000).toFixed(1)} km south at ${last.impact.z.toFixed(0)} m; ${ms.toFixed(0)} ms`);
  assert.equal(r.reason, 'terrain');
  assert.equal(last.terrain, true);
  assert.ok(last.impact && last.impact.y < HY, 'the impact is before the summit');
  assert.ok(last.y < last.impact.y, 'the last sample is before the impact');
  assert.ok(last.t <= last.impact.t - 15 + 1e-9);
  // Every sample is clear of the ground, the last by at least TERRAIN_CLEAR_M.
  for (const s of r.samples) assert.ok(s.z > hf.heightAt(s.x, s.y), `sample at t=${s.t} below the ground`);
  assert.ok(last.z - hf.heightAt(last.x, last.y) >= TERRAIN_CLEAR_M);
  // Only the last sample is marked.
  assert.equal(r.samples.filter((s) => s.terrain).length, 1);
});

test('over the sea the path is the same as with flat ground', { skip: !HAVE }, () => {
  // FL100 south-west of Jeju, heading west over the open sea for 20 minutes.
  const snap = cruise(-150000, -360000, { altFt: 10000, hdg: 3 * Math.PI / 2, hdgDeg: 270, iasKt: 280 });
  const flat = predictSync(snap, { maxMinutes: 20 });
  const real = predictSync(snap, { maxMinutes: 20 }, hf);
  for (const s of real.samples) assert.equal(hf.heightAt(s.x, s.y), 0, 'all over the sea');
  assert.equal(real.reason, flat.reason);
  assert.equal(real.samples.length, flat.samples.length);
  assert.deepEqual(real.samples.map((s) => [s.t, s.x, s.y, s.z]), flat.samples.map((s) => [s.t, s.x, s.y, s.z]));
});

test('a jump onto the terrain-ended path lands exactly on it, and flies on safely', { skip: !HAVE }, () => {
  const snap = cruise(HX, HY - 30000, { altFt: 4000, hdg: 0, hdgDeg: 0 });
  const r = predictSync(snap, {}, hf);
  const last = r.samples[r.samples.length - 1];
  const mid = r.samples[Math.floor(r.samples.length / 2)];
  for (const target of [mid, last]) {
    const live = createSim({ ground: terrainGround(hf) });
    live.restore(target.snap);
    assert.ok(Math.abs(live.state.pos.x - target.x) < 1e-6 && Math.abs(live.state.pos.y - target.y) < 1e-6 && Math.abs(live.state.pos.z - target.z) < 1e-6);
    assert.equal(live.state.t, target.t);
    live.step(1 / 120);
    assert.equal(live.state.crashed, null);
    assert.ok(live.state.agl > 100, `AGL ${live.state.agl}`);
  }
  // From the last sample there are at least ~10 s to react before the impact.
  const live = createSim({ ground: terrainGround(hf) });
  live.restore(last.snap);
  run(live, 10);
  assert.equal(live.state.crashed, null);
});

test('the terrain costs little: a 90-minute prediction over land within ~2 s CPU', { skip: !HAVE }, () => {
  // FL150 north up the length of the peninsula (mountains below, never reached).
  const sim = airborne({ massKg: 70000, fuelKg: 15000, altFt: 15000, iasKt: 300, hdg: 0, ap: { ap: true, athr: true, spdKt: 300, hdgDeg: 0, altFt: 15000 } });
  const snap = sim.snapshot();
  snap.core.px = 60000; snap.core.py = -250000;
  const time = (h) => {
    const t0 = performance.now();
    const run = createPredictionRun(snap, { maxMinutes: 90 }, h);
    while (!run.advance(3000));
    const ms = performance.now() - t0;
    const simMin = (run.samples[run.samples.length - 1].t - run.samples[0].t) / 60;
    return { ms, per90: ms * 90 / simMin, reason: run.reason, simMin };
  };
  time(hf); // warm up
  const flat = time(null), real = time(hf);
  console.log(`90-min prediction: flat ${flat.per90.toFixed(0)} ms, terrain ${real.per90.toFixed(0)} ms (${real.reason} after ${real.simMin.toFixed(1)} min)`);
  assert.notEqual(real.reason, 'terrain');
  assert.ok(real.per90 < 2000, `${real.per90.toFixed(0)} ms per 90 sim-minutes`);
});
