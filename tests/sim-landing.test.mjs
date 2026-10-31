// Landing distance against Airbus's landing field length chart (A321 AC, fig. 3-4-1-991-009,
// LEAP, ISA, sea level, PDF p.195): about 1,580 m at 79.2 t and 1,340 m at 60 t. The chart
// is the certified field length = actual distance from 50 ft with maximum manual braking
// and no reverse, divided by 0.6. So the sim's distance from 50 ft to a stop, braking hard
// without reverse, should be ≈ 0.6 × LFL. Tolerance ±20%: the air distance depends on the
// flare (pilot technique, here a scripted controller) and the chart is read to ±5%.
// Reverse then shortens the roll; reverse alone (no brakes) gives a much longer roll.
import test from 'node:test';
import assert from 'node:assert/strict';
import { airborne, run, KT, FT, FPM, DEG, clamp } from './sim-helpers.mjs';

function land(massKg, { brakes = 1, reverse = false } = {}) {
  // CONF FULL, gear down, Vapp = VLS + 5, level at 150 ft over a runway at h = 0.
  const probe = airborne({ massKg, fuelKg: 6000, altFt: 1000, iasKt: 140, flapLever: 4, gearDown: true });
  const vapp = probe.state.vls / KT + 5;
  const sim = airborne({ massKg, fuelKg: 6000, altFt: (150 * FT + 4.12) / FT, iasKt: vapp, flapLever: 4, gearDown: true });
  const s = sim.state, c = sim.controls;
  c.spoilersArmed = true;
  // Hold Vapp with thrust until the retard at 20 ft.
  let y50 = null, yTd = null, td = null, phase = 'app';
  run(sim, 120, () => {
    const agl = s.agl / FT;
    if (phase === 'app') {
      // −720 fpm (3° at Vapp) until 35 ft, then a flare to about −180 fpm at the wheels.
      // In the flare law the stick asks for pitch, so the gain differs.
      const vsTarget = agl < 35 ? -720 + (35 - agl) * 15.5 : -720;
      c.pitch = s.flare ? clamp(0.0025 * (vsTarget - s.vs / FPM), -0.5, 1) : clamp(0.0006 * (vsTarget - s.vs / FPM), -0.6, 0.6);
      c.thrust = agl < 20 ? 0 : clamp(c.thrust + 0.002 * (vapp - s.ias / KT), 0, 0.8);
      if (y50 === null && agl <= 50) y50 = s.pos.y;
      if (s.wow.left || s.wow.right) { phase = 'roll'; yTd = s.pos.y; td = s.vs / FPM; }
    } else {
      c.pitch = s.wow.nose ? 0 : -0.3;
      c.brakeL = c.brakeR = brakes;
      c.thrust = reverse && s.gs > 60 * KT ? -1 : 0;
      if (s.gs < 0.3) return true;
    }
  });
  const bounced = sim.events.some((e) => e.type === 'bounce');
  return { air: yTd - y50, total: s.pos.y - y50, roll: s.pos.y - yTd, tdFpm: td, vapp, crashed: s.crashed, gsp: s.groundSpoilers, bounced };
}

for (const [mass, lfl] of [[79200, 1580], [60000, 1340]]) {
  test(`landing at ${mass / 1000} t: max braking, no reverse ≈ 0.6 × ${lfl} m from 50 ft`, () => {
    const r = land(mass, { brakes: 1 });
    if (process.env.SIM_DEBUG) console.log(r);
    assert.equal(r.crashed, null);
    assert.equal(r.bounced, false, 'no bounce with the ground spoilers armed');
    assert.ok(r.tdFpm > -400 && r.tdFpm < -30, `touchdown ${r.tdFpm.toFixed(0)} fpm`);
    const ratio = r.total / (0.6 * lfl);
    assert.ok(ratio > 0.8 && ratio < 1.2, `${r.total.toFixed(0)} m = ${(ratio * 100).toFixed(0)}% of 0.6·LFL`);
  });
}

test('reverse thrust shortens the roll; reverse alone is far longer than braking', () => {
  const brk = land(79200, { brakes: 1 });
  const both = land(79200, { brakes: 1, reverse: true });
  const rev = land(79200, { brakes: 0, reverse: true });
  if (process.env.SIM_DEBUG) console.log({ brk: brk.roll, both: both.roll, rev: rev.roll });
  assert.ok(both.roll < brk.roll * 0.97, `with reverse ${both.roll.toFixed(0)} vs ${brk.roll.toFixed(0)} m`);
  assert.ok(both.roll > brk.roll * 0.6);
  assert.ok(rev.roll > brk.roll * 1.4 && rev.roll < 4000, `reverse only ${rev.roll.toFixed(0)} m`);
  assert.ok(brk.gsp > 0.9, 'ground spoilers deployed');
});

test('ground spoilers not armed: they extend when reverse is selected', () => {
  const sim = airborne({ massKg: 70000, fuelKg: 6000, altFt: (40 * FT + 4.12) / FT, iasKt: 135, flapLever: 4, gearDown: true });
  const s = sim.state, c = sim.controls;
  c.spoilersArmed = false; c.thrust = 0;
  let maxBefore = 0;
  run(sim, 60, () => {
    c.pitch = s.onGround ? 0 : s.flare ? clamp(0.0025 * (-200 - s.vs / FPM), -0.5, 1) : clamp(0.0006 * (-300 - s.vs / FPM), -0.6, 0.6);
    if (s.onGround && s.t > 2) {
      if (!s.wow.nose) return;
      if (s.gs > 90 * KT) { maxBefore = Math.max(maxBefore, s.groundSpoilers); }
      if (s.gs < 88 * KT) c.thrust = -1;
      if (s.gs < 60 * KT) return true;
    }
  });
  assert.ok(maxBefore < 0.05, 'not extended before reverse');
  assert.ok(s.groundSpoilers > 0.9, 'extended with reverse');
  assert.ok(s.engines[0].rev > 0.99, 'reversers deployed');
});

test('approach attitude: CONF FULL on a 3° path at VLS + 5 flies at +2 to +4.5° pitch', () => {
  for (const mass of [79200, 70000, 62000]) {
    const probe = airborne({ massKg: mass, fuelKg: 6000, altFt: 3000, iasKt: 140, flapLever: 4, gearDown: true });
    const vapp = probe.state.vls / KT + 5;
    const sim = airborne({ massKg: mass, fuelKg: 6000, altFt: 3000, iasKt: vapp, flapLever: 4, gearDown: true,
      ap: { ap: true, athr: true, spdKt: vapp, hdgDeg: 0, altFt: 0 } });
    sim.controls.thrust = 25 / 45;
    // 3° at Vapp: V/S = −GS·tan 3° (≈ −700 to −720 ft/min).
    sim.ap.setVs(-Math.round(vapp * 101.27 * Math.tan(3 * DEG) / 100) * 100);
    run(sim, 60);
    const s = sim.state;
    if (process.env.SIM_DEBUG) console.log({ mass, vapp, pitch: s.pitch / DEG, alpha: s.alpha / DEG, n1: s.engines[0].n1 });
    assert.ok(Math.abs(s.ias / KT - vapp) < 2);
    assert.ok(s.pitch > 2 * DEG && s.pitch < 4.5 * DEG, `pitch ${(s.pitch / DEG).toFixed(2)}° at ${mass / 1000} t`);
    assert.ok(s.engines[0].n1 > 45 && s.engines[0].n1 < 75, `N1 ${s.engines[0].n1.toFixed(0)}%`);
  }
});
