// v0.7.4, Shane's item 7 ("Autopilot only brings engines to a strange TO/GA setting like 96% instead of the full
// 100%, so the automatic low speed activation actually slows the plane sometimes. Can we give autopilot the full
// range?"): the Boeings' A/T wake-up goes to full thrust and never below the levers it woke with; once the speed is
// back, the reference returns. And "full" reads as full: the thrust limit above the dials on every type, the lever's
// ring at it (the A321's full is 96.5 % N1, real).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { typeById } from '../src/sim/types.js';
import { thrustLimit } from '../src/ui/engines-panel.js';
import { thrustRefMode, refPhi } from '../src/ui/boeing/logic.js';
import { createEngines } from '../src/sim/engines.js';

const DT = 1 / 120;

function air(type, { altFt = 8000, iasKt = 230, ap } = {}) {
  const A = typeById(type).data;
  const sim = createSim({ type });
  const mass = A.OEW + 0.75 * (A.MLW - A.OEW);
  const fuelKg = Math.min(30000, (mass - A.OEW) / 2);
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: altFt * A.FT, iasMs: iasKt * A.KT, flapLever: 0, gearDown: false, fuelKg, payloadKg: mass - A.OEW - fuelKg, ap });
  return { sim, A };
}
function run(sim, seconds, fn) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    if (fn && fn(sim) === true) return true;
    sim.step(DT);
  }
  return false;
}
// A pilot holding the altitude by hand, as the speed runs off (tests/boeing-ap.test.mjs's).
const holdLevel = (sim, A) => { sim.controls.pitch = Math.max(-0.3, Math.min(0.5, -0.0015 * sim.state.vs / A.FPM + 0.02)); };

for (const type of ['b787-9', 'b777-300er']) {
  test(`${type}: a wake-up from idle reaches full thrust (TOGA), and the reference reads it`, () => {
    const { sim, A } = air(type);
    const s = sim.state, c = sim.controls;
    c.thrust = 0;
    let wokeAt = -1, maxLever = 0, refAwake = '';
    run(sim, 240, () => {
      holdLevel(sim, A);
      if (sim.ap.athr && wokeAt < 0) wokeAt = s.t;
      if (wokeAt > 0) {
        maxLever = Math.max(maxLever, c.thrust);
        if (sim.ap.athrWake && !refAwake) refAwake = thrustRefMode(s, sim.ap);
      }
      return wokeAt > 0 && s.t > wokeAt + 12;
    });
    assert.ok(wokeAt > 0, 'it woke');
    assert.ok(maxLever > 0.999, `the levers went to ${maxLever.toFixed(3)}`);
    assert.equal(refAwake, 'G/A', 'the EICAS reference reads the full rating while awake');
    assert.equal(refPhi('G/A', A), A.RATING.TOGA);
  });

  test(`${type}: a wake-up with the levers at full doesn't take thrust away`, () => {
    // Full thrust by hand in a steep climb, the speed running off: the wake-up must leave the levers at full
    // (before v0.7.4 it pulled them back to max continuous).
    const { sim, A } = air(type, { altFt: 8000, iasKt: 200 });
    const s = sim.state, c = sim.controls;
    c.thrust = 1;
    let wokeAt = -1, minAwake = 9;
    run(sim, 300, () => {
      // Pitch for a climb steep enough that full thrust can't hold the speed.
      sim.controls.pitch = s.ias > sim.state.vmm - 25 * A.KT ? 0.6 : Math.max(-0.3, Math.min(0.5, -0.0015 * (s.vs / A.FPM - 1500) + 0.02));
      if (sim.ap.athr && wokeAt < 0) wokeAt = s.t;
      if (wokeAt > 0 && sim.ap.athrWake) minAwake = Math.min(minAwake, c.thrust);
      return wokeAt > 0 && s.t > wokeAt + 5;
    });
    assert.ok(wokeAt > 0, 'it woke');
    assert.ok(minAwake >= 0.999, `the levers stayed at full (lowest ${minAwake.toFixed(3)} while awake)`);
  });

  test(`${type}: once the speed has recovered, the SPD loop and its reference return`, () => {
    const { sim, A } = air(type);
    const s = sim.state, c = sim.controls;
    c.thrust = 0;
    let wokeAt = -1, exitAt = -1;
    run(sim, 400, () => {
      holdLevel(sim, A);
      if (sim.ap.athr && wokeAt < 0) wokeAt = s.t;
      if (wokeAt > 0 && exitAt < 0 && !sim.ap.athrWake && s.t > wokeAt + 1) exitAt = s.t;
      return exitAt > 0 && s.t > exitAt + 90;
    });
    assert.ok(exitAt > 0, 'the wake-up ended');
    assert.equal(sim.ap.thrustMode, 'SPD');
    assert.ok(c.thrust < 0.99, `the levers came back from full (${c.thrust.toFixed(3)})`);
    // The speed ends near the speed asked for, the shaker's margin above, not run away at full thrust.
    assert.ok(s.ias < sim.ap.spdKt * A.KT + 60 * A.KT, `IAS ${(s.ias / A.KT).toFixed(0)} kt`);
    assert.notEqual(thrustRefMode(s, sim.ap), 'G/A');
  });

  test(`${type}: at full the lever's ring sits on the thrust reference`, () => {
    const { sim, A } = air(type, { altFt: 3000, iasKt: 200 });
    sim.controls.thrust = 1;
    run(sim, 2);
    const eng = createEngines(A);
    const ref = eng.n1ForPhi(A.RATING.TOGA, sim.state.n1Idle);
    assert.ok(Math.abs(ref - sim.state.leverN1) < 1e-9, `ring ${sim.state.leverN1} against ${ref}`);
  });
}

test('A321: the E/WD reads TOGA 96.5 at full on the ground at sea level, and the ring is there', () => {
  const A = typeById('a321neo').data;
  const sim = createSim({ type: 'a321neo', ground: () => ({ h: 0, kind: 'runway' }) });
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: true, flapLever: 1, gearDown: true, fuelKg: 8000, payloadKg: 15000 });
  sim.controls.thrust = 1;
  run(sim, 1);
  const lim = thrustLimit(sim.state, sim.ap, A);
  assert.equal(lim.mode, 'TOGA');
  assert.equal(lim.n1.toFixed(1), '96.5');
  assert.ok(Math.abs(lim.n1 - sim.state.leverN1) < 1e-9, `ring ${sim.state.leverN1}`);
});

test('A321: CLB in the CL detent in flight, MCT above it, TOGA at full and in alpha floor', () => {
  const A = typeById('a321neo').data;
  const { sim } = air('a321neo', { altFt: 10000, iasKt: 250 });
  const st = sim.state;
  sim.controls.thrust = 25 / 45; run(sim, 0.5);
  let lim = thrustLimit(st, sim.ap, A);
  assert.equal(lim.mode, 'CLB');
  assert.ok(Math.abs(lim.n1 - st.leverN1) < 1e-9, 'the ring in CL sits on the CLB limit');
  sim.controls.thrust = 35 / 45; run(sim, 0.5);
  assert.equal(thrustLimit(st, sim.ap, A).mode, 'MCT');
  sim.controls.thrust = 1; run(sim, 0.5);
  lim = thrustLimit(st, sim.ap, A);
  assert.equal(lim.mode, 'TOGA');
  assert.ok(Math.abs(lim.n1 - st.leverN1) < 1e-9);
  assert.equal(thrustLimit({ ...st, thrustLever: 0.3, alphaFloor: true }, sim.ap, A).mode, 'TOGA');
});

test('A321: A/THR SPEED with the levers in CL keeps the CL limit (as the real one), alpha floor TOGA LK', () => {
  const A = typeById('a321neo').data;
  const { sim } = air('a321neo', { altFt: 10000, iasKt: 250, ap: { ap: true, athr: true, spdKt: 340, hdgDeg: 0, altFt: 10000 } });
  sim.controls.thrust = 25 / 45;
  run(sim, 60);
  assert.equal(sim.ap.thrustMode, 'SPEED');
  // Asked for far more speed than CL gives at 10,000 ft level: the A/THR stops at the CL limit.
  assert.ok(sim.controls.thrust <= 25 / 45 + 1e-9, `lever ${sim.controls.thrust}`);
  assert.equal(thrustLimit(sim.state, sim.ap, A).mode, 'CLB');
});
