// Boeing's C*U law (src/sim/fbw-boeing.js), on the 787-9 through the registry. Numbers come from the
// type's module, and the tolerances are wide on purpose: the type's data may be tuned under these.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { typeById } from '../src/sim/types.js';

const TYPE = process.env.BOEING_TYPE || 'b787-9';
const A = typeById(TYPE).data;
const KT = A.KT, FT = A.FT, FPM = A.FPM, DEG = A.DEG, DT = 1 / 120;
const lastFlap = A.FLAP_LEVER.length - 1;

function air({ frac = 0.75, altFt = 10000, iasKt = 250, flapLever = 0, gearDown = false, ap, ground } = {}) {
  const sim = createSim({ type: TYPE, ...(ground ? { ground } : {}) });
  const mass = A.OEW + frac * (A.MLW - A.OEW);
  const fuelKg = Math.min(30000, (mass - A.OEW) / 2);
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: altFt * FT, iasMs: iasKt * KT, flapLever, gearDown, fuelKg, payloadKg: mass - A.OEW - fuelKg, ap });
  return sim;
}
function run(sim, seconds, fn) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    if (fn && fn(sim) === true) return true;
    sim.step(DT);
    if (sim.state.crashed) return false;
  }
  return false;
}

test('trimmed at 250 kt and released: it settles back to 250 kt after a pull, with no lasting phugoid', () => {
  const sim = air();
  const s = sim.state;
  run(sim, 10);
  sim.controls.pitch = 0.3;
  run(sim, 8);
  assert.ok(s.ias < 249 * KT, `the pull slowed it (${(s.ias / KT).toFixed(1)} kt)`);
  assert.ok(s.vs > 500 * FPM, 'the pull made it climb');
  sim.controls.pitch = 0;
  run(sim, 120);
  assert.ok(Math.abs(s.ias - 250 * KT) < 3 * KT, `IAS ${(s.ias / KT).toFixed(1)} kt`);
  // No phugoid left: over the next minute, speed and sink stay put.
  let lo = 1e9, hi = -1e9, vsMax = 0;
  run(sim, 60, () => { lo = Math.min(lo, s.ias); hi = Math.max(hi, s.ias); vsMax = Math.max(vsMax, Math.abs(s.vs)); });
  assert.ok(hi - lo < 2 * KT, `speed band ${((hi - lo) / KT).toFixed(1)} kt`);
  assert.ok(vsMax < 200 * FPM, `V/S ${(vsMax / FPM).toFixed(0)} fpm`);
});

test('a steady pull is a steady off-trim condition: it keeps asking while held', () => {
  const sim = air();
  const s = sim.state;
  run(sim, 2);
  sim.controls.pitch = 0.08;
  run(sim, 90);
  const off = 250 * KT - s.ias;
  assert.ok(off > 3 * KT, `${(off / KT).toFixed(1)} kt below the reference while held`);
  assert.ok(Math.abs(s.vRef - 250 * KT) < 0.5 * KT, 'and the reference has not moved');
});

test('the trim moves the reference speed, and the aircraft follows', () => {
  const sim = air();
  const s = sim.state;
  sim.controls.trim = -1;                // Y: nose down, a higher reference
  run(sim, 2);
  sim.controls.trim = 0;
  const up = s.vRef;
  assert.ok(up > 255 * KT && up < 290 * KT, `reference ${(up / KT).toFixed(1)} kt`);
  run(sim, 150);
  assert.ok(Math.abs(s.ias - up) < 4 * KT, `IAS ${(s.ias / KT).toFixed(1)} kt, reference ${(up / KT).toFixed(1)}`);
  assert.ok(s.pos.z < 10000 * FT, 'with the thrust left alone, it went downhill to get there');
  sim.controls.trim = 1;                 // H: nose up, a lower one
  run(sim, 1);
  sim.controls.trim = 0;
  assert.ok(s.vRef < up - 3 * KT, 'H lowers it');
});

test('thrust up pitches up, thrust down pitches down, with the speed about the same', () => {
  const sim = air();
  const s = sim.state, c = sim.controls;
  run(sim, 5);
  const th0 = s.pitch, lever0 = c.thrust;
  c.thrust = Math.min(1, lever0 + 0.25);
  run(sim, 40);
  assert.ok(s.pitch > th0 + 1 * DEG, `pitch ${(th0 / DEG).toFixed(1)} → ${(s.pitch / DEG).toFixed(1)}°`);
  assert.ok(s.vs > 500 * FPM, 'and climbs');
  assert.ok(Math.abs(s.ias - 250 * KT) < 8 * KT, `IAS ${(s.ias / KT).toFixed(1)} kt`);
  c.thrust = 0;
  run(sim, 60);
  assert.ok(s.pitch < th0 - 0.5 * DEG, `pitch ${(s.pitch / DEG).toFixed(1)}°`);
  assert.ok(s.vs < -300 * FPM, 'and descends');
  assert.ok(Math.abs(s.ias - 250 * KT) < 8 * KT, `IAS ${(s.ias / KT).toFixed(1)} kt`);
});

test('bank: holds within 30°, past 35° rolls back to 30° on release; a held full wheel stays past it', () => {
  const sim = air();
  const s = sim.state, c = sim.controls;
  c.roll = 0.5;
  run(sim, 40, () => s.roll > 25 * DEG);
  c.roll = 0;
  run(sim, 15);
  assert.ok(s.roll > 22 * DEG && s.roll < 33 * DEG, `held at ${(s.roll / DEG).toFixed(1)}°`);

  c.roll = 1;
  run(sim, 40, () => s.roll > 45 * DEG);
  assert.ok(s.roll > 45 * DEG, `full wheel reached ${(s.roll / DEG).toFixed(1)}°`);
  assert.ok(s.protBank, 'protection acting');
  run(sim, 15);
  assert.ok(s.roll > 40 * DEG, `held full wheel stays past: ${(s.roll / DEG).toFixed(1)}°`);
  c.roll = 0;
  run(sim, 30);
  assert.ok(Math.abs(s.roll - 30 * DEG) < 2.5 * DEG, `released: ${(s.roll / DEG).toFixed(1)}°`);
  assert.equal(s.protBank, false);
  run(sim, 15);
  assert.ok(Math.abs(s.roll - 30 * DEG) < 2.5 * DEG, `and stays: ${(s.roll / DEG).toFixed(1)}°`);
});

test('the wheel is weaker past 35°: half wheel settles short of where full wheel goes', () => {
  const sim = air();
  const s = sim.state, c = sim.controls;
  c.roll = 0.5;
  run(sim, 60);
  const half = s.roll;
  c.roll = 1;
  run(sim, 30);
  assert.ok(half > 35 * DEG, `half wheel ${(half / DEG).toFixed(1)}°`);
  assert.ok(s.roll > half + 5 * DEG, `full wheel ${(s.roll / DEG).toFixed(1)}°`);
});

test('the trim stops at the minimum manoeuvring speed; the law holds it there at idle, hands off', () => {
  const sim = air({ iasKt: 240 });
  const s = sim.state, c = sim.controls;
  c.trim = 1;
  run(sim, 40);
  assert.ok(Math.abs(s.vRef - s.vmm) < 1.5 * KT, `reference ${(s.vRef / KT).toFixed(1)}, vmm ${(s.vmm / KT).toFixed(1)}`);
  c.trim = 0;
  c.thrust = 0;
  run(sim, 120);
  assert.ok(s.ias > s.vmm - 8 * KT, `IAS ${(s.ias / KT).toFixed(1)}, vmm ${(s.vmm / KT).toFixed(1)}`);
  assert.equal(s.shaker, false);
});

test('stall protection: a nose-down demand below vmm, and a held pull beats it into a real stall', () => {
  const sim = air({ altFt: 15000, iasKt: 230 });
  const s = sim.state, c = sim.controls;
  sim.ap.setAthrArm(false);              // no wake-up in this one
  c.thrust = 0;
  c.pitch = 0.4;
  let sawProt = false, sawShaker = false, shakerIas = 0, minPli = 99, pliAtStart = s.pliDeg;
  const stalled = run(sim, 240, () => {
    if (s.protStall) sawProt = true;
    if (s.shaker && !sawShaker) { sawShaker = true; shakerIas = s.ias; }
    minPli = Math.min(minPli, s.pliDeg);
    c.pitch = s.ias < s.vmm + 5 * KT ? 1 : 0.4;
    return s.alpha > A.ALPHA_MAX_CLEAN + 1 * DEG;
  });
  assert.ok(sawProt, 'protStall came on');
  assert.ok(sawShaker, 'the shaker fired');
  assert.ok(shakerIas > 0, 'before the stall');
  assert.ok(s.warnings.stall === s.shaker);
  assert.ok(pliAtStart > 3, `the PLI started ${pliAtStart.toFixed(1)}° above`);
  assert.ok(minPli <= 0, 'and came down to nothing at the shaker');
  assert.ok(stalled, `a held pull stalled it: α ${(s.alpha / DEG).toFixed(1)}°`);
});

test('overspeed: the trim stops at VMO; past it a nose-up push; holding forward overrides', () => {
  const sim = air({ altFt: 12000, iasKt: A.VMO_KT - 15 });
  const s = sim.state, c = sim.controls;
  c.trim = -1;
  run(sim, 20);
  assert.ok(s.vRef <= A.VMO_KT * KT + 0.5 * KT, `reference ${(s.vRef / KT).toFixed(1)} kt`);
  assert.ok(s.vRef > (A.VMO_KT - 2) * KT);
  c.trim = 0;
  // Full thrust, hands off: it climbs rather than going far past VMO.
  c.thrust = 1;
  let peak = 0;
  run(sim, 90, () => { peak = Math.max(peak, s.ias); });
  assert.ok(peak < (A.VMO_KT + 15) * KT, `peak ${(peak / KT).toFixed(1)} kt`);
  assert.ok(s.vs > 500 * FPM, 'by climbing');
  // A dive past VMO, then released: the push.
  const dive = air({ altFt: 18000, iasKt: A.VMO_KT - 10 });
  const d = dive.state;
  dive.controls.pitch = -1;
  let sawOver = false;
  run(dive, 20, () => { if (d.protOver) sawOver = true; if (d.vs < -6000 * FPM) dive.controls.pitch = -0.72; });
  assert.ok(sawOver && d.ias > (A.VMO_KT + 5) * KT, `a held push overrode it: ${(d.ias / KT).toFixed(1)} kt`);
  const q0 = d.vs;
  dive.controls.pitch = 0;
  dive.controls.thrust = 0;
  run(dive, 8);
  assert.ok(d.vs > q0 + 1000 * FPM, `released, it pulled up: V/S ${(q0 / FPM).toFixed(0)} → ${(d.vs / FPM).toFixed(0)} fpm`);
  run(dive, 60);
  assert.ok(d.ias < (A.VMO_KT + 1) * KT, `and back under VMO: ${(d.ias / KT).toFixed(1)} kt`);
  assert.equal(d.protOver, false);
});

test('the flare takes back pressure: hands off at 50 ft it does not flare, and a pull does', () => {
  const ground = () => ({ h: 0, kind: 'runway' });
  // Down a 3° path on the AP to 60 ft, then it's the pilot's, with the thrust left where it is.
  const to60 = () => {
    const probe = air({ altFt: 500, iasKt: 200, flapLever: lastFlap, gearDown: true, ground });
    const vapp = Math.round(probe.state.vmm / KT + 6);
    const sim = air({ altFt: 500, iasKt: vapp, flapLever: lastFlap, gearDown: true, ground, ap: { ap: true, athr: true, spdKt: vapp, altFt: 5000 } });
    sim.ap.setVs(-Math.round(sim.state.gs * Math.tan(3 * DEG) / FPM));
    run(sim, 80, () => sim.state.agl < 60 * FT);
    sim.ap.disconnectAp();
    sim.ap.setAthrArm(false);
    return sim;
  };
  const a = to60();
  const sink = a.state.vs, pitch0 = a.state.pitch;
  assert.ok(sink < -400 * FPM, `sinking ${(sink / FPM).toFixed(0)} fpm`);
  run(a, 20, () => a.state.onGround);
  const handsOff = a.state.vs;
  assert.ok(a.state.onGround);
  assert.ok(handsOff < 0.45 * sink, `hands off: ${(handsOff / FPM).toFixed(0)} fpm at the wheels (ground effect only), from ${(sink / FPM).toFixed(0)}`);
  assert.ok(Math.abs(a.state.pitch - pitch0) < 2 * DEG, `and the nose didn't come up by itself: ${(pitch0 / DEG).toFixed(1)} → ${(a.state.pitch / DEG).toFixed(1)}°`);

  const b = to60();
  run(b, 20, () => {
    if (b.state.agl < 35 * FT) b.controls.pitch = 0.25;
    return b.state.onGround;
  });
  assert.ok(b.state.vs > handsOff * 0.6, `a pull from 35 ft: ${(b.state.vs / FPM).toFixed(0)} fpm, against ${(handsOff / FPM).toFixed(0)} hands off`);
  assert.equal(b.state.crashed, null);
});

test('the ground: a held pull rotates at about 3°/s, and the lift-off gets a take-off trim', () => {
  const sim = createSim({ type: TYPE });
  const mass = A.OEW + 0.8 * (A.MTOW - A.OEW);
  const fuelKg = 50000;
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: true, flapLever: A.TAKEOFF_FLAP_LEVER, gearDown: true, fuelKg, payloadKg: Math.min(A.MAX_PAYLOAD, mass - A.OEW - fuelKg) });
  const s = sim.state, c = sim.controls;
  c.thrust = 1;
  const vr = 1.12 * (s.vmm / 1.3) / KT + 12;
  run(sim, 90, () => s.ias > vr * KT);
  c.pitch = 1;
  let peak = 0;
  const up = run(sim, 15, () => {
    if (s.wow.nose) return false;
    if (s.pitch < 9 * DEG) peak = Math.max(peak, s.q);
    return !s.wow.left;
  });
  assert.ok(up, 'it lifted off');
  assert.ok(peak > 2 * DEG && peak < 4 * DEG, `rotated at ${(peak / DEG).toFixed(2)}°/s`);
  assert.ok(s.vRef > s.vmm - 1 * KT && s.vRef < s.vmm + 60 * KT, `take-off trim ${(s.vRef / KT).toFixed(0)} kt, vmm ${(s.vmm / KT).toFixed(0)} kt`);
  c.pitch = 0.25;
  run(sim, 8);
  c.pitch = 0;
  run(sim, 30);
  assert.ok(!s.crashed && s.vs > 0, `climbing away, V/S ${(s.vs / FPM).toFixed(0)} fpm`);
});

test('the AP self-trims: the reference follows the speed, and on AP off the speed flown is the reference', () => {
  const sim = air({ ap: { ap: true, athr: true, spdKt: 250, hdgDeg: 0, altFt: 10000 } });
  const s = sim.state;
  sim.ap.setSpd(280);
  run(sim, 90);
  assert.ok(Math.abs(s.ias - 280 * KT) < 5 * KT, `IAS ${(s.ias / KT).toFixed(1)}`);
  assert.ok(Math.abs(s.vRef - s.ias) < 0.1 * KT, 'reference follows the speed');
  const at = s.ias;
  sim.ap.disconnectAp();
  sim.ap.toggleAthr();
  run(sim, 40);
  assert.ok(Math.abs(s.vRef - at) < 1 * KT);
  assert.ok(Math.abs(s.ias - at) < 5 * KT, `IAS ${(s.ias / KT).toFixed(1)} after the hand-over`);
  assert.ok(Math.abs(s.vs) < 800 * FPM, 'no pitch jump');
});
