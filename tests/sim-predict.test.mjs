// The predicted path, jumps onto it, determinism, and the CPU budgets (16× time
// compression = 32 steps per 60 Hz frame; a 90-minute prediction within ~2 s).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { predictSync, createPredictionRun } from '../src/sim/predict-core.js';
import { airborne, run, KT, FT, DEG } from './sim-helpers.mjs';

function cruiseStart() {
  // 3,000 ft over the sea west of Seoul, AP climbing to FL330 and turning toward Jeju.
  const sim = airborne({ massKg: 78000, fuelKg: 9000, altFt: 3000, iasKt: 250, hdg: 3.4,
    ap: { ap: true, athr: true, spdKt: 280, hdgDeg: 190, altFt: 3000 } });
  sim.controls.thrust = 25 / 45;
  sim.ap.setAlt(33000); sim.ap.levelChange();
  return sim;
}

test('prediction: samples every 5 s, ends at the map edge or 90 min, within 2 s CPU', () => {
  const sim = cruiseStart();
  const t0 = performance.now();
  const r = predictSync(sim.snapshot());
  const ms = performance.now() - t0;
  if (process.env.SIM_DEBUG) console.log({ n: r.samples.length, reason: r.reason, ms });
  assert.ok(['map', 'time', 'fuel'].includes(r.reason));
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
  for (let i = 1; i < r.samples.length - 1; i++) assert.ok(Math.abs(r.samples[i].t - r.samples[i - 1].t - 5) < 1e-6);
  assert.ok(r.samples.length > 100);
});

test('a 90-minute prediction fits in ~2 s CPU', () => {
  const sim = airborne({ massKg: 70000, fuelKg: 15000, altFt: 30000, mach: 0.7, hdg: 0,
    ap: { ap: true, athr: true, hdgDeg: 0, altFt: 30000 } });
  sim.ap.setSpd(sim.state.ias / KT);
  const snap = sim.snapshot();
  snap.core.px = -300000; snap.core.py = -390000; // start at the south edge, flying north
  // It may reach the north edge before 90 min; the cost is scaled to 90 sim-minutes.
  const t0 = performance.now();
  const r = createPredictionRun(snap, { maxMinutes: 90 });
  let steps = 0;
  while (!r.advance(3000)) steps += 3000;
  const ms = performance.now() - t0;
  const simMin = (r.samples[r.samples.length - 1].t - r.samples[0].t) / 60;
  const per90 = ms * 90 / simMin;
  if (process.env.SIM_DEBUG) console.log({ simMin, ms, per90, reason: r.reason });
  assert.ok(per90 < 2000, `${per90.toFixed(0)} ms per 90 sim-minutes`);
});

test('the jump lands exactly on the predicted path, and the path matches play at 1/120 s', () => {
  const sim = cruiseStart();
  const snap = sim.snapshot();
  const r = predictSync(snap);
  const target = r.samples.find((s) => Math.abs(s.t - 600) < 1e-6);
  assert.ok(target, 'sample at 10 min');
  // Jump: restore the sample's snapshot in a live sim.
  const live = createSim();
  live.restore(target.snap);
  assert.ok(Math.abs(live.state.pos.x - target.x) < 1e-6 && Math.abs(live.state.pos.y - target.y) < 1e-6 && Math.abs(live.state.pos.z - target.z) < 1e-6);
  assert.equal(live.state.t, target.t);
  // Fuel and weight carry over.
  assert.equal(live.state.fuelKg, target.snap.core.fuelL + target.snap.core.fuelR + target.snap.core.fuelC);
  // It keeps flying from there (AP still holding).
  run(live, 30);
  assert.equal(live.state.crashed, null);
  assert.equal(live.ap.ap, true);
  // The same 10 minutes flown at the play step (1/120 s) end within 0.2% of the distance.
  const play = createSim();
  play.restore(snap);
  run(play, 600);
  const d = Math.hypot(play.state.pos.x - target.x, play.state.pos.y - target.y, play.state.pos.z - target.z);
  const flown = Math.hypot(target.x - r.samples[0].x, target.y - r.samples[0].y);
  if (process.env.SIM_DEBUG) console.log({ d, flown });
  assert.ok(d < 0.002 * flown, `play vs prediction differ by ${d.toFixed(1)} m over ${(flown / 1000).toFixed(1)} km`);
});

test('determinism: identical runs give identical states', () => {
  const runOnce = () => {
    const sim = createSim();
    sim.reset({ x: 1000, y: 2000, hdg: 1.0, onGround: true, flapLever: 1, fuelKg: 9000, payloadKg: 18000 });
    const s = sim.state, c = sim.controls;
    c.thrust = 1;
    run(sim, 90, () => {
      if (s.ias > 150 * KT) c.pitch = Math.max(-1, Math.min(1, 0.15 * (12 - s.pitch / DEG)));
      if (s.agl > 100) { c.gearDown = false; c.flapLever = 0; }
      c.roll = Math.sin(s.t * 0.3) * 0.2;
    });
    return sim.snapshot();
  };
  assert.deepEqual(runOnce(), runOnce());
});

test('snapshot/restore round trip continues identically', () => {
  const a = cruiseStart();
  run(a, 20);
  const snap = structuredClone(a.snapshot());
  const b = createSim();
  b.restore(snap);
  run(a, 30); run(b, 30);
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('16× time compression: 32 steps per frame well within budget (< 20 µs per step)', () => {
  const sim = cruiseStart();
  run(sim, 5); // warm up
  const frames = 600; // 10 s at 60 fps, 16×
  const t0 = performance.now();
  for (let f = 0; f < frames; f++) for (let i = 0; i < 32; i++) sim.step(1 / 120);
  const ms = performance.now() - t0;
  const usPerStep = ms * 1000 / (frames * 32);
  // Near the ground too (gear contact and terrain queries).
  const g = createSim();
  g.reset({ x: 0, y: 0, hdg: 0, onGround: true, flapLever: 1, fuelKg: 8000, payloadKg: 18000 });
  g.controls.thrust = 0.3;
  const t1 = performance.now();
  for (let i = 0; i < 19200; i++) g.step(1 / 120);
  const usGround = (performance.now() - t1) * 1000 / 19200;
  if (process.env.SIM_DEBUG || true) console.log(`step: ${usPerStep.toFixed(2)} µs airborne, ${usGround.toFixed(2)} µs on the ground; 32 steps = ${(usPerStep * 32 / 1000).toFixed(3)} ms per frame`);
  assert.ok(usPerStep < 20, `${usPerStep.toFixed(1)} µs per step`);
  assert.ok(usGround < 20, `${usGround.toFixed(1)} µs per step on the ground`);
});
