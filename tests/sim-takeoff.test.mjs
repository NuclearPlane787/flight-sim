// Take-off roll and rotation against Airbus's take-off field length chart
// (A321 AC, fig. 3-3-1-991-010, LEAP-1A, ISA, sea level, PDF p.184).
//
// The chart gives the take-off field length (TOFL): the longest of 1.15 × the all-engines
// distance to 35 ft, the one-engine-out distance to 35 ft and the accelerate-stop distance.
// The sim flies all engines, so 1.15 × its distance to 35 ft must not exceed the TOFL
// (+5% for reading the chart) and should not fall far below it: at these weights the
// all-engines case is close to governing, so ≥ 0.80 × TOFL. That 25% band is the
// tolerance: it covers the chart reading (±5%) and the unknown share of the OEI case.
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRunway, run, KT, FT, DEG, clamp } from './sim-helpers.mjs';

// CONF 1+F, TOGA, rotate at VR at ~3°/s to ~8°, then 15° once airborne. VR per weight from
// A321neo 1+F speed tables (reference/notes: 146 kt at 80 t, 158 kt at 93.5 t).
function takeoff(massKg, vrKt) {
  const sim = onRunway({ massKg, fuelKg: 10000, flapLever: 1 });
  const s = sim.state, c = sim.controls;
  const y0 = s.pos.y;
  c.thrust = 1;
  let rotating = false, liftoff = null, d35 = null, tailstrike = false, maxPitchGround = 0;
  run(sim, 80, () => {
    if (s.ias > vrKt * KT) rotating = true;
    if (rotating) {
      const target = s.onGround ? 8.5 : 15;
      const th = s.pitch / DEG;
      // Ground mode damps pitch rate (fbw.js), so the pilot pulls harder for the same ~3°/s.
      c.pitch = clamp(0.3 * (target - th) - 0.1 * s.q / DEG, -1, 1);
    }
    if (s.onGround) maxPitchGround = Math.max(maxPitchGround, s.pitch / DEG);
    // Lift-off: the first frame with no wheel on the ground (the event comes 0.5 s later).
    if (!liftoff && rotating && !s.onGround) liftoff = { d: s.pos.y - y0, ias: s.ias / KT, pitch: s.pitch / DEG };
    for (const e of sim.events.splice(0)) if (e.type === 'tailstrike') tailstrike = true;
    if (!d35 && s.agl > 35 * FT) { d35 = s.pos.y - y0; return true; }
  });
  return { liftoff, d35, tailstrike, crashed: s.crashed, maxPitchGround };
}

for (const [mass, vr, tofl] of [[80000, 146, 1630], [93500, 158, 2250]]) {
  test(`take-off at ${mass / 1000} t: VR ${vr} kt, TOFL ${tofl} m`, () => {
    const r = takeoff(mass, vr);
    if (process.env.SIM_DEBUG) console.log(JSON.stringify(r));
    assert.equal(r.crashed, null);
    assert.equal(r.tailstrike, false);
    assert.ok(r.liftoff, 'lifted off');
    assert.ok(r.liftoff.ias > vr + 2 && r.liftoff.ias < vr + 15, `liftoff at ${r.liftoff.ias.toFixed(1)} kt`);
    assert.ok(r.liftoff.pitch < 10, `liftoff pitch ${r.liftoff.pitch.toFixed(1)}°`);
    const ratio = 1.15 * r.d35 / tofl;
    assert.ok(ratio > 0.80 && ratio < 1.05, `1.15 × ${r.d35.toFixed(0)} m = ${(ratio * 100).toFixed(0)}% of TOFL`);
  });
}

test('without rotation the aircraft stays on the ground (no self-rotation below VR)', () => {
  const sim = onRunway({ massKg: 80000, fuelKg: 10000, flapLever: 1 });
  sim.controls.thrust = 1;
  run(sim, 120, () => sim.state.ias > 140 * KT);
  assert.ok(sim.state.onGround && sim.state.wow.nose, 'nose wheel still down at 140 kt');
});
