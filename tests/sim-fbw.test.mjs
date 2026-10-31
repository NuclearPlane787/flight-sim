// Fly-by-wire Normal law: hands-off flight-path and bank hold, the bank, load-factor and
// pitch limits, and the roll rate (A320-family FCOM values via reference/notes/airbus-fbw-ap.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { airborne, run, KT, FT, DEG } from './sim-helpers.mjs';

for (const dt of [1 / 120, 1 / 30]) {
  test(`hands off for 60 s holds attitude, path and heading (dt = 1/${Math.round(1 / dt)} s)`, () => {
    const sim = airborne({ massKg: 75000, altFt: 10000, iasKt: 280 });
    const s = sim.state;
    const p0 = s.pitch, z0 = s.pos.z, h0 = s.hdg;
    let maxDp = 0, maxRoll = 0;
    run(sim, 60, () => {
      maxDp = Math.max(maxDp, Math.abs(s.pitch - p0));
      maxRoll = Math.max(maxRoll, Math.abs(s.roll));
    }, dt);
    assert.ok(maxDp < 0.5 * DEG, `pitch moved ${(maxDp / DEG).toFixed(2)}°`);
    assert.ok(Math.abs(s.pos.z - z0) < 30 * FT, `altitude moved ${((s.pos.z - z0) / FT).toFixed(0)} ft`);
    assert.ok(maxRoll < 0.5 * DEG, `roll ${(maxRoll / DEG).toFixed(2)}°`);
    assert.ok(Math.abs(s.hdg - h0) < 0.5 * DEG);
  });
}

test('a 20° bank set with the stick holds hands off, with no height loss (pitch compensation)', () => {
  const sim = airborne({ massKg: 75000, altFt: 10000, iasKt: 250 });
  const s = sim.state, c = sim.controls;
  run(sim, 10, () => { c.roll = s.roll < 19.5 * DEG ? 0.5 : 0; });
  c.roll = 0;
  run(sim, 3);
  const phi0 = s.roll, z0 = s.pos.z;
  let maxErr = 0;
  run(sim, 30, () => { maxErr = Math.max(maxErr, Math.abs(s.roll - phi0)); });
  assert.ok(Math.abs(phi0 / DEG - 20) < 2.5, `bank ${(phi0 / DEG).toFixed(1)}°`);
  assert.ok(maxErr < 1 * DEG, `bank wandered ${(maxErr / DEG).toFixed(2)}°`);
  assert.ok(Math.abs(s.pos.z - z0) < 100 * FT, `height change ${((s.pos.z - z0) / FT).toFixed(0)} ft`);
});

test('bank beyond 33° returns to 33° when released; full stick stops at 67°; roll rate ≈ 15°/s', () => {
  const sim = airborne({ massKg: 75000, altFt: 10000, iasKt: 250 });
  const s = sim.state, c = sim.controls;
  let maxRate = 0, maxBank = 0;
  run(sim, 12, () => { c.roll = 1; maxRate = Math.max(maxRate, s.p); maxBank = Math.max(maxBank, s.roll); });
  assert.ok(maxBank < 68 * DEG && maxBank > 60 * DEG, `max bank ${(maxBank / DEG).toFixed(1)}°`);
  assert.ok(maxRate > 13 * DEG && maxRate < 17.5 * DEG, `roll rate ${(maxRate / DEG).toFixed(1)}°/s`);
  c.roll = 0;
  run(sim, 25, () => { c.pitch = 0; });
  assert.ok(Math.abs(s.roll / DEG - 33) < 2, `bank after release ${(s.roll / DEG).toFixed(1)}°`);
});

test('load factor limits: +2.5 / −1 g clean', () => {
  const up = airborne({ massKg: 70000, altFt: 15000, iasKt: 300 });
  let maxNz = 0;
  run(up, 4, () => { up.controls.pitch = 1; maxNz = Math.max(maxNz, up.state.nz); });
  assert.ok(maxNz < 2.6 && maxNz > 2.2, `max nz ${maxNz.toFixed(2)}`);
  // Pull up to +15° first so the −15° pitch limit doesn't cut the push short.
  const dn = airborne({ massKg: 70000, altFt: 15000, iasKt: 300 });
  run(dn, 15, () => { dn.controls.pitch = dn.state.pitch < 15 * DEG ? 0.3 : 0; return dn.state.pitch > 15 * DEG; });
  let minNz = 9;
  run(dn, 4, () => { dn.controls.pitch = -1; minNz = Math.min(minNz, dn.state.nz); });
  assert.ok(minNz > -1.1 && minNz < -0.6, `min nz ${minNz.toFixed(2)}`);
});

test('pitch attitude stops at 30° nose up and 15° nose down', () => {
  const up = airborne({ massKg: 70000, altFt: 10000, iasKt: 300 });
  up.controls.thrust = 1;
  let maxP = 0;
  run(up, 25, () => { up.controls.pitch = 0.6; maxP = Math.max(maxP, up.state.pitch); });
  assert.ok(maxP < 31 * DEG, `max pitch ${(maxP / DEG).toFixed(1)}°`);
  const dn = airborne({ massKg: 70000, altFt: 20000, iasKt: 250 });
  dn.controls.thrust = 0;
  let minP = 0;
  run(dn, 15, () => { dn.controls.pitch = -0.5; minP = Math.min(minP, dn.state.pitch); });
  assert.ok(minP > -16 * DEG, `min pitch ${(minP / DEG).toFixed(1)}°`);
});

test('high-speed protection holds the speed near VMO + 6–16 kt in a dive', () => {
  const sim = airborne({ massKg: 70000, altFt: 20000, iasKt: 330 });
  sim.controls.thrust = 1;
  let maxIas = 0, prot = false;
  run(sim, 60, () => {
    sim.controls.pitch = -0.3;
    maxIas = Math.max(maxIas, sim.state.ias / KT);
    if (sim.state.protSpeed) prot = true;
  });
  assert.ok(prot, 'protection engaged');
  assert.ok(maxIas < 350 + 20, `max ${maxIas.toFixed(0)} kt`);
  assert.ok(sim.state.warnings.overspeed || maxIas > 354, 'overspeed warning reached');
});

test('Alternate law: roll is direct (no bank hold beyond 33°)', () => {
  const sim = airborne({ massKg: 75000, altFt: 10000, iasKt: 250, law: 'alternate' });
  const s = sim.state;
  run(sim, 8, () => { sim.controls.roll = 0.5; });
  sim.controls.roll = 0;
  const b = s.roll;
  run(sim, 10);
  assert.ok(b > 40 * DEG, `banked ${(b / DEG).toFixed(0)}°`);
  assert.ok(s.roll > 35 * DEG, 'no return to 33° in Alternate law');
});
