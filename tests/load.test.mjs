// Changing the load during a flight (v0.3.2: sim.setLoad(), the Weight window): the mass, the
// tanks and the CG follow, the airframe stays where it is, the flight goes on, and a save, a
// rewind and a copy carry the load's parts and the fuel added.
//   node --test tests/load.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { typeById } from '../src/sim/types.js';
import { loadCheck, maxFuel } from '../src/ui/load-window.js';

const DT = 1 / 120;
const viaJson = (o) => JSON.parse(JSON.stringify(o));
function run(sim, seconds) {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) { sim.step(DT); if (sim.state.crashed) return false; }
  return true;
}
function cruise(type, { altFt = 30000, fuelKg, payloadKg } = {}) {
  const sim = createSim({ type }), A = sim.type.data, L = sim.type.limits;
  const fuel = fuelKg ?? Math.round(L.FUEL_MAX * 0.4), payload = payloadKg ?? Math.round((L.MZFW - L.OEW) * 0.5);
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: altFt * A.FT, iasMs: 280 * A.KT, flapLever: 0, gearDown: false,
    fuelKg: fuel, payloadKg: payload, pax: 0, cargoKg: payload, ap: { ap: true, athr: true, spdKt: 280, hdgDeg: 0, altFt } });
  return sim;
}

for (const type of ['a321neo', 'b787-9', 'b777-300er']) {
  test(`${type}: in cruise on the AP, more payload and fuel: the mass and the tanks follow, the airframe stays put, the AP flies on`, () => {
    const sim = cruise(type), A = sim.type.data, L = sim.type.limits;
    assert.ok(run(sim, 30));
    const s = sim.state;
    const pos0 = { ...s.pos }, vel0 = { ...s.vel }, pitch0 = s.pitch, mass0 = s.mass, fuel0 = s.fuelKg, cg0 = s.cgMac, vmin0 = s.vls || s.vmm;
    const more = Math.min(20000, A.MAX_PAYLOAD - s.payloadKg - 500);   // the A321's room is about 12 t
    const payload = s.payloadKg + more, fuel = Math.min(L.FUEL_MAX, fuel0 + 10000);
    assert.equal(sim.setLoad({ payloadKg: payload, fuelKg: fuel, pax: 100, cargoKg: payload - 100 * L.PAX_KG }), true);
    // At once: the mass and the tanks; the reference point, the velocity and the attitude as they were.
    assert.ok(Math.abs(s.mass - (mass0 + more + (fuel - fuel0))) < 1, `mass ${s.mass}`);
    assert.ok(Math.abs(s.fuelKg - fuel) < 1e-6);
    assert.ok(Math.abs(s.fuel.left + s.fuel.right + s.fuel.center - fuel) < 1e-6);
    assert.equal(s.fuel.left, s.fuel.right, 'the wings even');
    if (fuel > 2 * A.FUEL_WING_EACH) assert.ok(Math.abs(s.fuel.left - A.FUEL_WING_EACH) < 1e-6 && s.fuel.center > 0, 'the wings full first');
    for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(s.pos[k] - pos0[k]) < 1e-9, `pos.${k} moved ${s.pos[k] - pos0[k]}`);
    for (const k of ['x', 'y', 'z']) assert.equal(s.vel[k], vel0[k]);
    assert.equal(s.pitch, pitch0);
    assert.notEqual(s.cgMac, cg0, 'the CG moved');
    assert.equal(s.payloadKg, payload); assert.equal(s.paxN, 100); assert.equal(s.cargoKg, payload - 100 * L.PAX_KG);
    assert.ok(Math.abs(s.fuelAddedKg - (fuel - fuel0)) < 1e-6);
    // Then two minutes on: still on the AP at its altitude, and the minimum speed is up with the weight.
    assert.ok(run(sim, 120), 'no crash');
    assert.ok(sim.ap.ap, 'the AP is still on');
    assert.ok(Math.abs(s.pos.z / A.FT - 30000) < 150, `altitude ${(s.pos.z / A.FT).toFixed(0)} ft`);
    assert.ok((s.vls || s.vmm) > vmin0, `the minimum speed went up: ${vmin0} → ${s.vls || s.vmm}`);
  });
}

test('taking fuel off counts too: the fuel added goes negative, and a fuel within 0.5 kg leaves the tanks alone', () => {
  const sim = cruise('b787-9');
  assert.ok(run(sim, 5));
  const s = sim.state, f0 = s.fuelKg;
  sim.setLoad({ fuelKg: f0 - 5000 });
  assert.ok(Math.abs(s.fuelAddedKg + 5000) < 1e-6);
  const tanks = { ...s.fuel };
  sim.setLoad({ fuelKg: s.fuelKg + 0.3, payloadKg: s.payloadKg + 100 });
  assert.deepEqual({ ...s.fuel }, tanks, 'the tanks untouched');
  assert.ok(Math.abs(s.fuelAddedKg + 5000) < 1e-6);
  // The logbook's fuel used (main.js): at the start + added − now is the burn alone.
  const atStart = f0;
  assert.ok(run(sim, 60));
  const burn = atStart + s.fuelAddedKg - s.fuelKg;
  assert.ok(burn > 0 && burn < 2000, `burn ${burn}`);
});

test('within the limits: the sim clamps to its tanks and its payload', () => {
  const sim = cruise('a321neo'), A = sim.type.data;
  sim.setLoad({ fuelKg: 1e6, payloadKg: 1e6 });
  assert.equal(sim.state.fuelKg, A.FUEL_MAX);
  assert.equal(sim.state.payloadKg, A.MAX_PAYLOAD);
  sim.setLoad({ fuelKg: -5, payloadKg: -5 });
  assert.equal(sim.state.fuelKg, 0);
  assert.equal(sim.state.payloadKg, 0);
});

for (const type of ['a321neo', 'b777-300er']) {
  test(`${type}: parked with the parking brake, 40 t more: it settles where it stands, no crash, no touchdown`, () => {
    const sim = createSim({ type }), L = sim.type.limits;
    sim.reset({ x: 100, y: 200, hdg: 1, onGround: true, flapLever: 0, gearDown: true, parkingBrake: true, fuelKg: 6000, payloadKg: 5000 });
    sim.controls.parkingBrake = true;
    assert.ok(run(sim, 10));
    const s = sim.state, p0 = { ...s.pos }, c0 = s.gearCompression.left, ths0 = sim._core.thsTakeoff;
    sim.events.length = 0;
    const more = Math.min(40000, L.MZFW - L.OEW - 5000);
    sim.setLoad({ payloadKg: 5000 + more, fuelKg: 6000 });
    assert.ok(run(sim, 10), 'no crash');
    assert.ok(Math.hypot(s.pos.x - p0.x, s.pos.y - p0.y) < 0.05, `moved ${Math.hypot(s.pos.x - p0.x, s.pos.y - p0.y)} m`);
    assert.ok(s.onGround && s.gearCompression.left > c0, 'the struts take the weight');
    assert.ok(!sim.events.some((e) => e.type === 'touchdown' || e.type === 'crash'), sim.events.map((e) => e.type).join(','));
    assert.notEqual(sim._core.thsTakeoff, ths0, 'the take-off trim follows the CG');
  });
}

test('a snapshot carries the load parts and the fuel added; an older one restores them as unknown and none', () => {
  const a = cruise('b777-300er');
  a.setLoad({ payloadKg: 30000, fuelKg: a.state.fuelKg + 1234, pax: 250, cargoKg: 9000 });
  const snap = viaJson(a.snapshot());
  const b = createSim({ type: 'b777-300er' });
  b.restore(snap);
  assert.equal(b.state.paxN, 250); assert.equal(b.state.cargoKg, 9000); assert.equal(b.state.payloadKg, 30000);
  assert.ok(Math.abs(b.state.fuelAddedKg - 1234) < 1e-6);
  // A save from v0.3.1 has none of them; restored into a sim that had them, they're cleared.
  const old = viaJson(snap);
  delete old.core.paxN; delete old.core.cargoKg; delete old.core.fuelAddedKg;
  b.restore(old);
  assert.equal(b.state.paxN, null); assert.equal(b.state.cargoKg, null); assert.equal(b.state.fuelAddedKg, 0);
  // A reset takes them from the start's numbers.
  b.reset({ onGround: true, fuelKg: 9000, payloadKg: 20000, pax: 200, cargoKg: 3200 });
  assert.equal(b.state.paxN, 200); assert.equal(b.state.cargoKg, 3200); assert.equal(b.state.fuelAddedKg, 0);
});

test('crashed: no change', () => {
  const sim = cruise('a321neo');
  sim._core.crashed = 'test';
  const m = sim.state.mass;
  assert.equal(sim.setLoad({ payloadKg: 1 }), false);
  assert.equal(sim.state.mass, m);
});

// ---- the Weight window's checks (src/ui/load-window.js), the same as the setup's ----
test('the checks: the seats, the hold, the tanks, MZFW and MTOW stop it; over MLW and low fuel only warn', () => {
  for (const id of ['a321neo', 'b787-9', 'b777-300er']) {
    const L = typeById(id).limits;
    const ok = loadCheck(L, { pax: 100, cargoKg: 1000, fuelKg: 5000 });
    assert.deepEqual(ok.problems, [], id);
    assert.equal(ok.payload, 100 * L.PAX_KG + 1000);
    assert.equal(ok.zfw, L.OEW + ok.payload);
    assert.equal(ok.gross, ok.zfw + 5000);
    assert.ok(loadCheck(L, { pax: L.PAX_MAX + 1, cargoKg: 0, fuelKg: 5000 }).problems.length, `${id} seats`);
    assert.ok(loadCheck(L, { pax: 0, cargoKg: L.CARGO_MAX + 1, fuelKg: 5000 }).problems.length, `${id} hold`);
    assert.ok(loadCheck(L, { pax: 0, cargoKg: 0, fuelKg: L.FUEL_MAX + 1 }).problems.length, `${id} tanks`);
    assert.ok(loadCheck(L, { pax: L.PAX_MAX, cargoKg: L.CARGO_MAX, fuelKg: 5000 }).problems.some((p) => /Zero-fuel/.test(p)), `${id} MZFW`);
    const heavy = loadCheck(L, { pax: 0, cargoKg: Math.min(L.CARGO_MAX, L.MZFW - L.OEW), fuelKg: L.FUEL_MAX });
    if (L.MZFW + L.FUEL_MAX > L.MTOW) assert.ok(heavy.problems.some((p) => /MTOW/.test(p)), `${id} MTOW`);
    assert.ok(/MLW/.test(loadCheck(L, { pax: 0, cargoKg: 0, fuelKg: Math.min(L.FUEL_MAX, L.MLW - L.OEW + 100) }).warn) || L.FUEL_MAX < L.MLW - L.OEW + 100, `${id} MLW`);
    assert.ok(/fuel/i.test(loadCheck(L, { pax: 0, cargoKg: 0, fuelKg: 300 }).warn), `${id} low fuel`);
    for (const bad of [NaN, -1, 1.5]) assert.ok(loadCheck(L, { pax: bad, cargoKg: 0, fuelKg: 5000 }).problems.length, `${id} pax ${bad}`);
    // Max: the tanks, or MTOW, whichever comes first.
    assert.equal(maxFuel(L, 0), Math.min(L.FUEL_MAX, L.MTOW - L.OEW));
    assert.equal(maxFuel(L, L.MZFW - L.OEW), Math.min(L.FUEL_MAX, L.MTOW - L.MZFW));
  }
});
