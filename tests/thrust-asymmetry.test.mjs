// v0.5.8: a thrust asymmetry yaws the aircraft towards the low-thrust side, and the pilot holds it with the rudder
// (Shane, v0.5.7: "the roll and yaw deviation when I remove thrust from one side is too low"). Engine 1 (left) at idle,
// engine 2 at climb thrust (controls.thrustEng), hands off, the AP off, at 250 kt and 10,000 ft clean and at 150 kt and
// 3,000 ft with landing flaps and the gear down.
//
// Measured over 20 s (v0.5.7 → v0.5.8; heading change, bank, sideslip, rudder):
//   A321neo cruise    −7.0°, 0.0°, 1.8°, 1.5°  →  −10.4°, 0.0°, 3.1°, 0.0°
//           approach −24.3°, 0.0°, 8.3°, 7.2°  →  −39.7°, −0.1°, 16.5°, 0.2°
//   787-9   cruise    −7.1°, 0.0°, 1.7°, 1.4°  →  −37.2°, −34.1°, 2.1°, 0.0°
//           approach −22.1°, −0.1°, 6.4°, 5.5° →  −93.1°, −33.8°, 8.2°, 0.1°
//   777-300ER cruise  −7.8°, 0.0°, 2.0°, 1.7°  →  −39.7°, −34.2°, 2.6°, 0.0°
//           approach −24.8°, −0.1°, 7.8°, 6.7° →  −96.4°, −33.6°, 10.5°, 0.1°
// The yaw damper and the turn coordination used to take about half the sideslip away and hold it there (the rudder
// column); now the sideslip is the one that balances the engines' yaw moment with the rudder centred (fbw.js's
// asymmetryInto()). The A321's normal law holds the bank, so only the Boeings roll (their wheel commands the roll
// surfaces, so the dihedral effect rolls them on to 34°, inside the bank protection). The limits below sit between
// the two versions, with room on the new side: each fails on v0.5.7's laws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { typeById } from '../src/sim/types.js';

const DT = 1 / 120, DEG = Math.PI / 180, KT = 0.514444, FT = 0.3048;
const COND = {
  cruise: { altFt: 10000, kt: 250, landing: false },
  approach: { altFt: 3000, kt: 150, landing: true },
};
// min |heading change|, min sideslip, the bank (min for the Boeings' roll towards the low side, max |bank| for the A321)
const LIMITS = {
  'a321neo': { cruise: { dHdg: 9, beta: 2.6, bankMax: 2 }, approach: { dHdg: 32, beta: 12, bankMax: 2 } },
  'b787-9': { cruise: { dHdg: 25, beta: 1.5, bankMin: 20 }, approach: { dHdg: 60, beta: 5, bankMin: 25 } },
  'b777-300er': { cruise: { dHdg: 25, beta: 1.5, bankMin: 20 }, approach: { dHdg: 60, beta: 5, bankMin: 25 } },
};
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function make(type, cond) {
  const A = typeById(type).data, C = COND[cond];
  const sim = createSim({ type });
  const mass = A.OEW + 0.6 * (A.MLW - A.OEW), fuelKg = 10000;
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: C.altFt * FT, iasMs: C.kt * KT,
    flapLever: C.landing ? A.FLAP_LEVER.length - 1 : 0, gearDown: C.landing,
    fuelKg, payloadKg: Math.max(0, mass - A.OEW - fuelKg), ap: { ap: false, athr: false } });
  return { sim, A };
}
const climbLever = (A) => (A.LEVER_LAW === 'boeing' ? Math.sqrt(A.RATING.CL) : 25 / 45);

// levers(A) → controls.thrustEng; pilot(sim) each step (hands off if none). 20 s; the worst |β| and |bank| after 5 s.
function fly(type, cond, levers, pilot) {
  const { sim, A } = make(type, cond);
  const s = sim.state, c = sim.controls, h0 = s.hdg;
  c.thrustEng = levers(A);
  let betaMax = 0, bankMax = 0;
  for (let i = 1; i <= 20 / DT; i++) {
    if (pilot) pilot(sim);
    sim.step(DT); sim.events.length = 0;
    if (i * DT > 5) { betaMax = Math.max(betaMax, Math.abs(s.beta)); bankMax = Math.max(bankMax, Math.abs(s.roll)); }
  }
  return { dHdg: wrap(s.hdg - h0) / DEG, bank: s.roll / DEG, beta: s.beta / DEG, rud: s.surfaces.rudder / DEG,
    betaMax: betaMax / DEG, bankMax: bankMax / DEG, crashed: s.crashed };
}
const fmt = (r) => `heading ${r.dHdg.toFixed(1)}°, bank ${r.bank.toFixed(1)}°, β ${r.beta.toFixed(2)}°, rudder ${r.rud.toFixed(2)}°`;

for (const type of Object.keys(LIMITS)) for (const cond of Object.keys(COND)) {
  const L = LIMITS[type][cond];
  test(`${type}, ${cond}: the left engine at idle yaws it left and holds a sideslip, hands off${L.bankMin ? ', and it rolls left' : ''}`, () => {
    const r = fly(type, cond, (A) => [0, climbLever(A)]);
    assert.ok(!r.crashed);
    assert.ok(r.dHdg < -L.dHdg, `yaw towards the idle engine: ${fmt(r)}`);
    assert.ok(r.beta > L.beta, `sideslip (wind from the right): ${fmt(r)}`);
    // the automatic rudder leaves the steady asymmetry alone (v0.5.7 held 1.4–7.2° against it)
    assert.ok(Math.abs(r.rud) < 0.75, `rudder left to the pilot: ${fmt(r)}`);
    if (L.bankMax) assert.ok(r.bankMax < L.bankMax, `the A321's law holds the bank: ${fmt(r)}`);
    if (L.bankMin) assert.ok(r.bank < -L.bankMin && r.bank > -35, `the Boeings roll towards it, held inside the bank protection: ${fmt(r)}`);
    // and the mirror image: the right engine at idle
    const m = fly(type, cond, (A) => [climbLever(A), 0]);
    assert.ok(Math.abs(m.dHdg + r.dHdg) < 0.05 * Math.abs(r.dHdg) && Math.abs(m.beta + r.beta) < 0.05 * r.beta, `mirrored: ${fmt(m)} against ${fmt(r)}`);
  });

  test(`${type}, ${cond}: the pilot's rudder holds it, and the automatic rudder doesn't fight the feet`, () => {
    let I = 0;
    // pedals to centre the sideslip (β > 0 wants right rudder), the wheel neutral
    const r = fly(type, cond, (A) => [0, climbLever(A)], (sim) => { I += sim.state.beta * DT; sim.controls.yaw = clamp(8 * sim.state.beta + 4 * I, -1, 1); });
    assert.ok(r.betaMax < 1.5, `sideslip centred: worst ${r.betaMax.toFixed(2)}° after 5 s, ${fmt(r)}`);
    assert.ok(r.bankMax < 7, `no roll to speak of: worst ${r.bankMax.toFixed(1)}° after 5 s, ${fmt(r)}`);
    assert.ok(r.rud > 2, `with the rudder towards the live engine: ${fmt(r)}`);
    const hands = fly(type, cond, (A) => [0, climbLever(A)]);
    assert.ok(Math.abs(r.dHdg) < 0.5 * Math.abs(hands.dHdg), `heading ${r.dHdg.toFixed(1)}° against ${hands.dHdg.toFixed(1)}° hands off`);
  });

  test(`${type}, ${cond}: symmetric thrust, levers apart or together, gives no yaw`, () => {
    for (const levers of [(A) => [climbLever(A), climbLever(A)], () => null]) {
      const r = fly(type, cond, levers);
      assert.ok(Math.abs(r.dHdg) < 0.01 && Math.abs(r.beta) < 0.01 && r.bankMax < 0.01 && Math.abs(r.rud) < 0.01, fmt(r));
    }
  });
}
