// v0.5.6: a design's take-off trim (sim.js takeoffThs()) lifts the nose by itself at its base's speed. v0.5.3's trim
// matched the base's pitching moment about the reference point, so a 1.5 tailplane (its heavier structure moves the
// CG aft) lifted the nose 6 to 8 % earlier on a hands-off take-off run, and a 0.6 one later; the trim now takes the
// weight's arm about the main wheels at the base's lift-off speed (ROADMAP, "Found while building v0.5.3").
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { newDesign, defaultAirframe, designDef } from '../src/sim/designs.js';

const KT = 0.514444, DT = 1 / 120;
const MASS = { 'a321neo': 80000, 'b787-9': 230000, 'b777-300er': 300000 };
const FLAP = { 'a321neo': 1, 'b787-9': 2, 'b777-300er': 2 };

// TOGA from a standstill with the take-off flaps, hands off: the IAS (kt) at which the nose wheel leaves the runway.
function lift(base, airframe) {
  const des = { ...newDesign(base, { id: 'tt' }), airframe };
  const A = designDef(des).data, sim = createSim({ type: des });
  const fuel = Math.min(A.FUEL_MAX * 0.3, MASS[base] * 0.25), payload = Math.max(0, MASS[base] - A.OEW - fuel);
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: true, flapLever: FLAP[base], gearDown: true, fuelKg: fuel, payloadKg: payload });
  sim.controls.parkingBrake = false; sim.controls.thrust = 1;
  for (let t = 0; t < 90; t += DT) {
    sim.step(DT);
    const s = sim.state;
    assert.ok(!s.crashed, `${base}: ${s.crashed}`);
    if (s.ias > 40 * KT && !s.wow.nose) return s.ias / KT;
  }
  return assert.fail(`${base}: the nose never lifted`);
}

for (const base of ['a321neo', 'b787-9', 'b777-300er']) {
  test(`${base}: the 1.5 and 0.6 tailplanes and a 3 m aft plug lift the nose within 2 % of the base's speed`, () => {
    const af = defaultAirframe(base), v0 = lift(base, af);
    for (const [what, a] of [['tail 1.5', { ...af, tail: 1.5 }], ['tail 0.6', { ...af, tail: 0.6 }], ['aft plug 3 m', { ...af, plugAft: 3 }]]) {
      const v = lift(base, a);
      assert.ok(Math.abs(v / v0 - 1) < 0.02, `${base} ${what}: ${v.toFixed(1)} kt against the base's ${v0.toFixed(1)}`);
    }
  });
}
