// 1 g stall speeds per configuration, flown in Alternate law (no alpha protection) with a
// slow (1 kt/s) deceleration holding altitude, at 79.2 t (MLW). VS1g is taken where the lift
// coefficient peaks: VS1g = IAS/√nz at that point. Expected values: the CLmax calibration
// (Airbus AC p.197 for FULL: Vapp 136 kt = 1.23·VS1g + 5; the others from
// reference/notes/a321neo-performance.md §3). Tolerance ±4 kt: the speeds are estimates to
// about ±6 kt, and the manoeuvre (slightly above 1 g, tail download, CG) shifts them ~1–2 kt.
// Also checks the stall warning comes before the break, and that Normal law stops at α max.
import test from 'node:test';
import assert from 'node:assert/strict';
import { airborne, run, KT, FT, DEG, clamp } from './sim-helpers.mjs';

// [lever, start IAS (kt)]. An airborne start with lever 1 is CONF 1 (slats only); 1+F in
// flight comes from moving the lever from 2 back to 1 below 210 kt (lever 1.5 below).
const CASES = [[0, 200, '0', 161.5], [1, 175, '1', 139], [1.5, 175, '1+F', 126.5], [2, 160, '2', 123], [3, 150, '3', 118.5], [4, 140, 'FULL', 106.5]];

function stall(lever, startKt, law = 'alternate') {
  const sim = airborne({ massKg: 79200, fuelKg: 8000, altFt: 10000, iasKt: startKt, flapLever: Math.ceil(lever), gearDown: lever === 4, law });
  const s = sim.state, c = sim.controls;
  if (lever === 1.5) { c.flapLever = 1; run(sim, 6); }
  const h0 = s.pos.z;
  let best = { cl: 0, vs1g: 0 }, warnAt = null, maxAlpha = 0, floor = false;
  run(sim, 200, () => {
    // Thrust: decelerate at 1 kt/s. Stick: hold altitude.
    const target = -1 * KT; // m/s²
    c.thrust = clamp(c.thrust + 0.02 * (target - sim._core.iasDot), 0, 0.6) ;
    const vsWant = clamp(0.1 * (h0 - s.pos.z), -3, 3);
    c.pitch = clamp(0.08 * (vsWant - s.vs) + 0.01 * (h0 - s.pos.z), -1, 1);
    if (s.cl > best.cl) best = { cl: s.cl, vs1g: s.ias / KT / Math.sqrt(Math.max(0.5, s.nz)), ias: s.ias / KT, alpha: s.alpha / DEG, config: s.config };
    if (s.warnings.stall && warnAt === null) warnAt = s.ias / KT;
    maxAlpha = Math.max(maxAlpha, s.alpha / DEG);
    if (s.alphaFloor) floor = true;
    // Stop once well past the break (CL fallen 8% below its peak) or sinking hard.
    if (s.cl < best.cl * 0.92 || s.vs < -25) return true;
  });
  return { ...best, warnAt, maxAlpha, floor, crashed: s.crashed };
}

for (const [lever, startKt, cfg, vs] of CASES) {
  test(`VS1g CONF ${cfg} at 79.2 t ≈ ${vs} kt (Alternate law)`, () => {
    const r = stall(lever, startKt);
    if (process.env.SIM_DEBUG) console.log(cfg, JSON.stringify(r));
    assert.equal(r.crashed, null);
    assert.ok(Math.abs(r.vs1g - vs) < 4, `VS1g ${r.vs1g.toFixed(1)} kt`);
    assert.equal(r.config, cfg);
    // The warning sounds before the lift peaks (VSW above the stall).
    assert.ok(r.warnAt !== null && r.warnAt > r.ias + 3, `stall warning at ${r.warnAt} kt, peak at ${r.ias} kt`);
  });
}

test('Normal law: full back stick at idle holds α at α max, alpha floor gives TOGA', () => {
  const sim = airborne({ massKg: 79200, fuelKg: 8000, altFt: 10000, iasKt: 150, flapLever: 3, law: 'normal' });
  const s = sim.state, c = sim.controls;
  c.thrust = 0;
  let maxA = 0, floor = false, minIas = 1e9;
  run(sim, 60, () => {
    c.pitch = 1;
    maxA = Math.max(maxA, s.alpha / DEG);
    minIas = Math.min(minIas, s.ias / KT);
    if (s.alphaFloor) floor = true;
  });
  // α max for CONF 3 here is 16.8°: α must stay below it (and the aircraft never stalls).
  if (process.env.SIM_DEBUG) console.log({ maxA, floor, minIas, thr: s.engines[0].n1 });
  assert.ok(maxA < 16.8, `max α ${maxA.toFixed(1)}°`);
  assert.ok(floor, 'alpha floor triggered');
  assert.equal(sim.ap.thrustMode === 'A.FLOOR' || sim.ap.thrustMode === 'TOGA LK', true);
  assert.ok(s.engines[0].n1 > 85, 'TOGA thrust');
  assert.equal(s.crashed, null);
});
