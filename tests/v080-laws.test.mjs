// v0.8.0, part 7: the degraded control laws. The A321's alternate law (as before) and direct law; the Boeings'
// secondary and direct modes; the law that flies being the worse of the pilot's choice (controls.law) and the one the
// hydraulics leave (E.hydLaw); the autopilot's disconnect; the stall warning; a hand-flown level flight, turn and
// landing in direct law on the A321 and the 787-9; a save in direct law. (The normal law's arithmetic to the bit:
// tests/golden-*.test.mjs and tests/scenario-state.test.mjs, unchanged.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { typeById } from '../src/sim/types.js';
import { lawLevel, lawName, directGearing, createFbw } from '../src/sim/fbw.js';
import { createFbwBoeing } from '../src/sim/fbw-boeing.js';
import { armed } from '../src/sim/failures.js';
import * as A321 from '../src/sim/a321neo.js';

const KT = 0.514444, FT = 0.3048, FPM = FT / 60, DEG = Math.PI / 180, DT = 1 / 120;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function mk(type, { law, iasKt = 250, altFt = 10000, flapLever = 0, gearDown = false, x = 0, y = 0, hdg = 0, ap } = {}) {
  const sim = createSim(type ? { type } : {});
  let pay;
  if (type) {
    const A = typeById(type).data;
    const mass = A.OEW + 0.75 * (A.MLW - A.OEW), fuelKg = Math.min(30000, (mass - A.OEW) / 2);
    pay = { fuelKg, payloadKg: mass - A.OEW - fuelKg };
  } else pay = { fuelKg: 8000, payloadKg: 65000 - A321.OEW - 8000 };
  sim.reset({ x, y, hdg, onGround: false, z: altFt * FT, iasMs: iasKt * KT, flapLever, gearDown, ...pay, law, ap });
  return sim;
}
function run(sim, sec, fn) {
  const n = Math.round(sec / DT);
  for (let i = 0; i < n; i++) {
    if (fn && fn(sim) === true) return true;
    sim.step(DT);
    if (sim.state.crashed) return false;
  }
  return false;
}
const arm = (sim, target, seed = 5) => sim.setFailures(armed(sim.failures, { kind: 'hyd-sys', target, when: { type: 'now' } }, sim.state.t, seed));

// ---- the helper ----
test('lawLevel(): the worse of the pilot\'s choice and the hydraulics\'; lawName() for each family', () => {
  assert.equal(lawLevel('normal', 0, false), 0);
  assert.equal(lawLevel('normal', undefined, false), 0, 'an absent hydLaw is 0');
  assert.equal(lawLevel('alternate', 0, false), 1);
  assert.equal(lawLevel('direct', 0, false), 2);
  assert.equal(lawLevel('secondary', 0, false), 0, 'the A321 has no secondary mode');
  assert.equal(lawLevel('alternate', 0, true), 0, 'a Boeing ignores alternate, as before');
  assert.equal(lawLevel('secondary', 0, true), 1);
  assert.equal(lawLevel('direct', 0, true), 2);
  assert.equal(lawLevel('normal', 1, false), 1); assert.equal(lawLevel('normal', 2, true), 2);
  assert.equal(lawLevel('alternate', 2, false), 2); assert.equal(lawLevel('direct', 1, false), 2);
  assert.equal(lawLevel(undefined, 7, false), 2);
  assert.deepEqual([0, 1, 2].map((l) => lawName(l, false)), ['normal', 'alternate', 'direct']);
  assert.deepEqual([0, 1, 2].map((l) => lawName(l, true)), ['normal', 'secondary', 'direct']);
  assert.equal(directGearing(150 * KT), 1); assert.ok(Math.abs(directGearing(250 * KT) - (180 / 250) ** 2) < 1e-12);
  assert.equal(directGearing(500 * KT), 0.3);
});

// ---- the normal law to the bit with E.hydLaw absent, 0, or a field that's there ----
test('the normal law: the same bits with E.hydLaw absent or 0 (A321 and 787-9 steps from the same state)', () => {
  for (const type of [null, 'b787-9']) {
    const a = mk(type), b = mk(type);
    run(a, 2); run(b, 2);
    for (const sim of [a, b]) { sim.controls.pitch = 0.3; sim.controls.roll = -0.2; }
    run(a, 3); run(b, 3);
    assert.deepEqual(a.snapshot().core, b.snapshot().core);
    assert.equal(a.state.law, 'normal');
  }
  // fbwStep itself, with and without the field.
  const { fbwStep } = createFbw(A321);
  const sim = mk(null); run(sim, 1);
  const snap = sim.snapshot();
  const E = { tas: 130, ias: 128, mach: 0.39, qbar: 1e4, alpha: 0.04, beta: 0, gamma: 0, phi: 0.1, theta: 0.04, psi: 0, p: 0, q: 0.01, r: 0,
    nz: 1, vs: 0, gs: 130, aglFt: 10000, onGround: false, gearDown: false, slat: 0, flap: 0, Ixx: 3e6, Iyy: 7e6, Izz: 9e6, Ixz: 0,
    mass: 65000, fAlong: 0, alphaMax: 0.25, vls: 70, vsw: 60, iasDot: 0, elevScale: 2e7, rollScale: 3e7, myOther: 1e5, lOther: 0, rudLim: 0.3, nThrust: 0 };
  const X1 = structuredClone(snap.core), X2 = structuredClone(snap.core);
  const c = { pitch: 0.2, roll: 0.1, yaw: 0, thrust: 0.5, law: 'normal', trim: 1 };
  fbwStep(X1, c, E, DT); fbwStep(X2, c, { ...E, hydLaw: 0 }, DT);
  assert.deepEqual(X1, X2);
});

// ---- A321 direct law ----
test('A321 direct law: the stick moves the elevator, geared with speed; released it goes to neutral (no path hold)', () => {
  const { fbwStep } = createFbw(A321);
  const sim = mk(null); run(sim, 1);
  const X = structuredClone(sim.snapshot().core);
  X.flt = 1;
  const E = { tas: 140, ias: 250 * KT, mach: 0.4, qbar: 1e4, alpha: 0.04, beta: 0, gamma: 0.05, phi: 0, theta: 0.09, psi: 0, p: 0, q: 0.02, r: 0,
    nz: 1.1, vs: 6, gs: 140, aglFt: 10000, onGround: false, gearDown: false, slat: 0, flap: 0, Ixx: 3e6, Iyy: 7e6, Izz: 9e6, Ixz: 0,
    mass: 65000, fAlong: 0, alphaMax: 0.25, vls: 70, vsw: 60, iasDot: 0, elevScale: 2e7, rollScale: 3e7, myOther: 1e5, lOther: 0, rudLim: 0.3, nThrust: 0 };
  fbwStep(X, { pitch: 0.5, roll: 0, yaw: 0, thrust: 0.5, law: 'direct', trim: 0 }, E, DT);
  assert.ok(Math.abs(X.elevCmd - 0.5 * A321.ELEV_UP * directGearing(250 * KT)) < 1e-12, `elev ${X.elevCmd}`);
  assert.equal(X.thsRate, 0, 'no auto-trim');
  fbwStep(X, { pitch: 0, roll: 0.4, yaw: 0, thrust: 0.5, law: 'direct', trim: 0 }, E, DT);
  assert.equal(X.elevCmd, 0, 'released: neutral elevator, whatever the pitch rate');
  assert.equal(X.uRoll, 0.4, 'roll direct');
  fbwStep(X, { pitch: 0, roll: 0, yaw: 0, thrust: 0.5, law: 'direct', trim: 1 }, E, DT);
  assert.equal(X.thsRate, A321.THS_RATE, 'the manual trim moves the stabiliser');
  // The same moment in alternate law: the law answers the pitch rate even hands off.
  fbwStep(X, { pitch: 0, roll: 0, yaw: 0, thrust: 0.5, law: 'alternate', trim: 0 }, E, DT);
  assert.notEqual(X.elevCmd, 0);
});

test('A321 direct law in flight: a pull and release leaves the path to the airframe; the stabiliser moves only by hand', () => {
  for (const law of ['alternate', 'direct']) {
    const sim = mk(null, { law, iasKt: 250 }); const s = sim.state;
    run(sim, 5);
    const ths0 = sim.snapshot().core.ths;
    sim.controls.pitch = 0.15; run(sim, 3); sim.controls.pitch = 0;
    run(sim, 5); const g1 = s.gamma; run(sim, 25); const g2 = s.gamma;   // the phugoid's half period, about
    const ths1 = sim.snapshot().core.ths;
    if (law === 'alternate') {
      assert.ok(Math.abs(g2 - g1) < 0.3 * DEG, `alternate holds the path: ${(g1 / DEG).toFixed(2)}° → ${(g2 / DEG).toFixed(2)}°`);
      assert.notEqual(ths1, ths0, 'alternate trims');
    } else {
      assert.ok(Math.abs(g2 - g1) > 1 * DEG, `direct doesn't hold it: ${(g1 / DEG).toFixed(2)}° → ${(g2 / DEG).toFixed(2)}°`);
      assert.equal(ths1, ths0, 'direct: the stabiliser still');
      sim.controls.trim = 1; run(sim, 2); sim.controls.trim = 0;
      assert.ok(sim.snapshot().core.ths > ths0 + 1 * DEG, 'trimmed by hand');
    }
    assert.equal(s.law, law);
  }
});

// ---- the Boeings' secondary and direct modes ----
test('787-9 secondary and direct: no auto-trim, no path hold, no protections, the wheel direct; the trim switches move the stabiliser', () => {
  for (const law of ['secondary', 'direct']) {
    for (const autoTrim of [false, true]) {
      const sim = mk('b787-9', { law }); const s = sim.state;
      sim.setAutoTrim(autoTrim);
      run(sim, 5);
      assert.equal(s.law, law);
      const ths0 = sim.snapshot().core.ths;
      sim.controls.pitch = 0.15; run(sim, 3); sim.controls.pitch = 0;
      assert.equal(sim.snapshot().core.ths, ths0, `${law}${autoTrim ? ' (auto-trim on)' : ''}: the stabiliser still`);
      run(sim, 5); const g1 = s.gamma; run(sim, 25);
      assert.ok(Math.abs(s.gamma - g1) > 1 * DEG, `${law}: the path not held (${(g1 / DEG).toFixed(2)}° → ${(s.gamma / DEG).toFixed(2)}°)`);
      sim.controls.trim = 1; run(sim, 2); sim.controls.trim = 0;
      assert.ok(sim.snapshot().core.ths > ths0 + 1 * DEG, 'trimmed by hand');
      // Bank: past 35° the normal mode rolls it back; here a released wheel leaves the bank (no protection).
      sim.controls.roll = 1; run(sim, 40, () => s.roll > 45 * DEG); sim.controls.roll = 0;
      run(sim, 1); const b = s.roll; run(sim, 4);
      assert.ok(s.roll > 40 * DEG && s.roll >= b - 8 * DEG, `${law}: bank ${(b / DEG).toFixed(1)}° → ${(s.roll / DEG).toFixed(1)}°`);   // the normal mode's roll back is 0.5 rad/s per rad past 30°: tens of degrees in 4 s
      assert.equal(s.protBank, false);
    }
  }
  // The secondary mode damps the pitch rate; the direct mode doesn't.
  const { fbwStep } = createFbwBoeing(typeById('b787-9').data);
  const sim = mk('b787-9'); run(sim, 1);
  const X = structuredClone(sim.snapshot().core); X.flt = 1;
  const E = { tas: 140, ias: 250 * KT, mach: 0.4, qbar: 1e4, alpha: 0.04, beta: 0, gamma: 0.05, phi: 0, theta: 0.09, psi: 0, p: 0, q: 0.02, r: 0,
    nz: 1.1, vs: 6, gs: 140, aglFt: 10000, onGround: false, gearDown: false, slat: 0, flap: 0, Ixx: 3e7, Iyy: 7e7, Izz: 9e7, Ixz: 0,
    mass: 200000, fAlong: 0, alphaMax: 0.25, vls: 70, vsw: 60, iasDot: 0, elevScale: 2e8, rollScale: 3e8, myOther: 1e5, lOther: 0, rudLim: 0.3, nThrust: 0 };
  fbwStep(X, { pitch: 0, roll: 0, yaw: 0, thrust: 0.5, law: 'direct', trim: 0 }, E, DT); assert.equal(X.elevCmd, 0);
  fbwStep(X, { pitch: 0, roll: 0, yaw: 0, thrust: 0.5, law: 'secondary', trim: 0 }, E, DT); assert.ok(X.elevCmd < 0, 'the damper');
});

// ---- the autopilot ----
test('the autopilot disconnects on entering direct law (a Boeing\'s secondary) and won\'t engage; alternate keeps it', () => {
  for (const [type, law, drops] of [[null, 'alternate', false], [null, 'direct', true], ['b787-9', 'secondary', true], ['b787-9', 'direct', true]]) {
    const sim = mk(type, { ap: { ap: true } }); const s = sim.state;
    run(sim, 6);
    assert.equal(sim.ap.ap, true, 'engaged to start');
    sim.controls.law = law; run(sim, 0.1);
    assert.equal(sim.ap.ap, !drops, `${type || 'a321'} ${law}`);
    if (drops) {
      assert.equal(s.warnings.apDisc, true, 'the disconnect warning');
      assert.equal(sim.ap.engageAp(), false, 'won\'t engage');
      run(sim, 0.1); assert.equal(sim.ap.ap, false);
    }
    sim.controls.law = 'normal'; run(sim, 1);
    if (drops) assert.equal(sim.ap.engageAp(), true, 'engages again in the normal law');
  }
});

// ---- the stall warning ----
test('a pull to the stop in direct law stalls it, and the stall warning sounds (A321 alternate and direct; 787-9 secondary and direct)', () => {
  for (const [type, law] of [[null, 'normal'], [null, 'alternate'], [null, 'direct'], ['b787-9', 'secondary'], ['b787-9', 'direct']]) {
    const sim = mk(type, { law, iasKt: 220 }); const s = sim.state;
    let warn = false, aMax = 0;
    sim.controls.thrust = 0;
    run(sim, 40, () => { sim.controls.pitch = 1; warn ||= s.warnings.stall; aMax = Math.max(aMax, s.alpha); });
    if (law === 'normal') assert.equal(warn, false, 'the normal law protects');
    else assert.equal(warn, true, `${type || 'a321'} ${law}: the warning (α max ${(aMax / DEG).toFixed(1)}°)`);
  }
});

// ---- the hydraulics force the law ----
test('E.hydLaw forces the law with controls.law at normal: two A321 systems lost → alternate; with the gear down → direct; three 787 systems → direct', () => {
  const a = mk(null); run(a, 2);
  arm(a, 0); arm(a, 1); run(a, 3);   // green and blue
  assert.equal(a.controls.law, 'normal');
  assert.equal(a.state.hyd.law, 1); assert.equal(a.state.law, 'alternate');
  const d = mk(null, { gearDown: true, flapLever: 1, iasKt: 180 }); run(d, 2);
  arm(d, 0); arm(d, 1); run(d, 3);
  assert.equal(d.state.hyd.law, 2); assert.equal(d.state.law, 'direct');
  // In direct law forced so, the stabiliser stays put hands off (no auto-trim) unless it's frozen anyway.
  const b = mk('b787-9'); run(b, 2);
  arm(b, 0); arm(b, 1); run(b, 3);
  assert.equal(b.state.law, 'secondary');
  arm(b, 2); run(b, 3);
  assert.equal(b.state.law, 'direct');
  assert.equal(b.controls.law, 'normal');
});

test('a hydraulic law drops the autopilot (A321 direct, Boeing secondary)', () => {
  const b = mk('b787-9', { ap: { ap: true } }); run(b, 6);
  assert.equal(b.ap.ap, true);
  arm(b, 0); arm(b, 1); run(b, 3);
  assert.equal(b.ap.ap, false); assert.equal(b.state.law, 'secondary');
});

// ---- a save ----
test('a save in direct law restores into direct law', () => {
  for (const [type, law] of [[null, 'direct'], ['b787-9', 'secondary'], ['b787-9', 'direct']]) {
    const sim = mk(type, { law }); run(sim, 2);
    const snap = JSON.parse(JSON.stringify(sim.snapshot()));
    const other = mk(type); run(other, 1);
    assert.equal(other.state.law, 'normal');
    other.restore(snap);
    assert.equal(other.controls.law, law); assert.equal(other.state.law, law);
    run(other, 1); assert.equal(other.state.law, law);
  }
});

// ---- hand flown ----
// A test pilot: a bank and pitch attitude flown with the stick (proportional and rate damped, as a hand does), the
// stabiliser trimmed by hand to take the stick's steady share away, the thrust by hand on the speed.
function pilot(sim, { vsCmd, hdgCmd, iasKt, idle = false }) {
  const s = sim.state, c = sim.controls, P = pilot.st.get(sim) || { stick: 0, ti: 0, bias: 0 };
  pilot.st.set(sim, P);
  const V = Math.max(s.tas, 40);
  // Pitch: the flight path asked for, flown with the stick against the pitch rate; no integral in the hand, the trim's.
  const e = Math.asin(clamp(vsCmd / V, -0.15, 0.15)) - s.gamma;
  let st = 6 * e - 4 * s.q;
  if (s.pitch > 15 * DEG) st = Math.min(st, -0.05);
  c.pitch = clamp(st, -0.6, 0.6);
  // The trim: the stick's steady share (3 s mean), slowly away, as a pilot keeps the column light.
  P.stick += (c.pitch - P.stick) * DT / 3;
  c.trim = Math.abs(P.stick) > 0.01 ? clamp(P.stick * 3, -1, 1) : 0;
  // Roll: a bank for the heading, flown against the roll rate.
  const dh = ((hdgCmd - s.hdg) / DEG + 540) % 360 - 180;
  const phiCmd = clamp(dh * 0.9 * DEG, -25 * DEG, 25 * DEG);
  c.roll = clamp(2 * (phiCmd - s.roll) - 0.6 * s.p, -1, 1);
  c.yaw = 0;
  // Thrust: on the speed.
  P.ti = clamp(P.ti + 0.004 * (iasKt * KT - s.ias) * DT, -0.3, 0.3);
  c.thrust = idle ? 0 : clamp(0.35 + 0.01 * (iasKt * KT - s.ias) + P.ti, 0, 0.55);
}
pilot.st = new WeakMap();

for (const type of [null, 'b787-9']) {
  const name = type || 'A321';
  test(`${name} direct law by hand: level flight, then a turn to a heading`, () => {
    const sim = mk(type, { law: 'direct', iasKt: 250, altFt: 8000 }); const s = sim.state;
    const z0 = s.pos.z;
    let dz = 0;
    run(sim, 60, () => { pilot(sim, { vsCmd: 0.1 * (z0 - s.pos.z), hdgCmd: 0, iasKt: 250 }); dz = Math.max(dz, Math.abs(s.pos.z - z0)); if (process.env.LAWDBG && Math.round(s.t * 120) % 600 === 0) console.log(name, s.t.toFixed(0), 'dz', ((s.pos.z - z0) / FT).toFixed(0), 'vs', (s.vs / FPM).toFixed(0), 'ias', (s.ias / KT).toFixed(0), 'th', (s.pitch / DEG).toFixed(1), 'c', sim.controls.pitch.toFixed(3), sim.controls.thrust.toFixed(2), sim.controls.trim.toFixed(2)); });
    assert.equal(s.law, 'direct');
    assert.ok(dz < 150 * FT, `level: ${(dz / FT).toFixed(0)} ft off`);
    run(sim, 90, () => { pilot(sim, { vsCmd: 0.1 * (z0 - s.pos.z), hdgCmd: 90 * DEG, iasKt: 250 }); dz = Math.max(dz, Math.abs(s.pos.z - z0)); });
    const dh = Math.abs(((s.hdg / DEG - 90) + 540) % 360 - 180);
    assert.ok(dh < 3, `heading ${(s.hdg / DEG).toFixed(1)}°`);
    assert.ok(dz < 250 * FT, `through the turn: ${(dz / FT).toFixed(0)} ft off`);
    assert.ok(!s.crashed);
  });

  test(`${name} direct law by hand: an approach from 5 nm and a landing`, () => {
    const A = typeById(type || 'a321neo')?.data || A321;
    const lastFlap = A.FLAP_LEVER ? A.FLAP_LEVER.length - 1 : 4;
    const y0 = -5 * 1852, gs = 3 * DEG;
    const vapp = type ? 150 : 140;
    const sim = mk(type, { law: 'direct', iasKt: vapp, altFt: (-y0 * Math.tan(gs)) / FT, flapLever: lastFlap, gearDown: true, y: y0, x: 120 });
    const s = sim.state;
    let td = null, seen = 0;
    run(sim, 200, () => {
      const ev = sim.events;
      for (let k = seen; k < ev.length; k++) if (ev[k].type === 'touchdown' && !td) td = { ...ev[k] };
      seen = ev.length;
      if (process.env.LAWDBG && Math.round(s.t * 120) % 600 === 0) console.log(name, s.t.toFixed(0), 'y', s.pos.y.toFixed(0), 'x', s.pos.x.toFixed(1), 'z', (s.pos.z / FT).toFixed(0), 'vs', (s.vs / FPM).toFixed(0), 'ias', (s.ias / KT).toFixed(0), 'th', (s.pitch / DEG).toFixed(1), 'phi', (s.roll / DEG).toFixed(1), 'c', sim.controls.pitch.toFixed(2), sim.controls.thrust.toFixed(2), s.crashed);
      if (td && s.onGround && s.gs < 60 * KT) return true;
      const agl = s.agl, aglFt = agl / FT;
      const hT = Math.max(0, -s.pos.y * Math.tan(gs));
      let vs = -s.gs * Math.tan(gs) + 0.15 * (hT - s.pos.z);
      if (aglFt < 50) vs = -Math.max(0.6, Math.min(-vs, 0.6 + agl * 0.1));
      // Track the centreline: the heading towards it.
      const hdgCmd = clamp(-s.pos.x * 0.004, -15 * DEG, 15 * DEG);
      if (s.onGround) { sim.controls.pitch = 0; sim.controls.roll = 0; sim.controls.thrust = 0; sim.controls.brakeL = sim.controls.brakeR = 0.5; return; }
      pilot(sim, { vsCmd: vs, hdgCmd, iasKt: vapp, idle: aglFt < 30 });
    });
    assert.ok(td, 'touched down');
    assert.ok(!s.crashed, 'no crash');
    assert.ok(td.vsMs > -600 * FPM, `touchdown ${(td.vsMs / FPM).toFixed(0)} fpm`);
    if (process.env.LAWDBG) console.log(name, 'touchdown', (td.vsMs / FPM).toFixed(0), 'fpm', td.x.toFixed(1), 'm off,', td.y.toFixed(0), 'm past the aim point, g', td.g.toFixed(2));
    assert.ok(Math.abs(td.x) < 30, `${td.x.toFixed(1)} m off the centreline`);
    assert.equal(s.law, 'direct');
  });
}
