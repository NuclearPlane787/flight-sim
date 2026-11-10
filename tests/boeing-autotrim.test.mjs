// v0.4.1: the Boeings' auto-trim setting (src/sim/fbw-boeing.js, E.autoTrim). On, the flight path holds
// itself hands off, as the A321's does, and in the landing configuration the stick asks for a rate of
// change of the path, so a keyboard's taps make small, lasting changes. Off (the default), the law is the
// speed-stable one boeing-law.test.mjs checks, unchanged.
//   node --test tests/boeing-autotrim.test.mjs        (BOEING_TYPE=b787-9 for the 787)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { typeById } from '../src/sim/types.js';

const TYPE = process.env.BOEING_TYPE || 'b777-300er';
const A = typeById(TYPE).data, GZ = typeById(TYPE).geo.GROUND_Z;
const KT = A.KT, FT = A.FT, FPM = A.FPM, DEG = A.DEG, DT = 1 / 120;
const lastFlap = A.FLAP_LEVER.length - 1;
const TAN3 = Math.tan(3 * DEG);

function air({ altFt = 3000, iasKt = 150, flapLever = lastFlap, gearDown = true, athr = true, autoTrim = true, y = 0 } = {}) {
  const sim = createSim({ type: TYPE });
  const mass = A.OEW + 0.6 * (A.MLW - A.OEW), fuelKg = 20000;
  sim.reset({ x: 0, y, hdg: 0, onGround: false, z: altFt * FT, iasMs: iasKt * KT, flapLever, gearDown, fuelKg, payloadKg: mass - A.OEW - fuelKg,
    ap: { ap: false, athr, spdKt: iasKt } });
  sim.setAutoTrim(autoTrim);
  return sim;
}
function run(sim, seconds, fn) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    if (fn && fn(sim) === true) return true;
    sim.step(DT);
    sim.events.length = 0;
    if (sim.state.crashed) return false;
  }
  return false;
}
const path = (s) => Math.asin(Math.max(-1, Math.min(1, s.vs / Math.max(1, s.tas))));
// input.js's ramps: full in about 0.3 s, back in about 0.17 s.
const ramp = (v, goal) => { const st = (goal === 0 ? 6 : 3.5) * DT; return Math.abs(goal - v) <= st ? goal : v + Math.sign(goal - v) * st; };

test('hands off, the path holds: a 3° descent stays a 3° descent for a minute', () => {
  for (const autoTrim of [true, false]) {
    const sim = air({ autoTrim });
    const s = sim.state;
    run(sim, 20, () => { sim.controls.pitch = Math.max(-0.4, Math.min(0.4, 0.4 * (-3 * DEG - path(s)) / DEG)); });
    sim.controls.pitch = 0;
    const g0 = path(s);
    let lo = 1, hi = -1;
    run(sim, 60, () => { lo = Math.min(lo, path(s)); hi = Math.max(hi, path(s)); });
    if (autoTrim) {
      assert.ok(Math.abs(g0 + 3 * DEG) < 0.3 * DEG, `on the path at release (${(g0 / DEG).toFixed(2)}°)`);
      assert.ok(hi - lo < 0.4 * DEG && Math.abs(path(s) - g0) < 0.2 * DEG, `${TYPE}: ${(lo / DEG).toFixed(2)}…${(hi / DEG).toFixed(2)}°`);
    } else {
      // Without it the speed-stable law takes the path where the speed wants it: not where it was left.
      assert.ok(Math.abs(path(s) - g0) > 1 * DEG, `${TYPE} without: ${(g0 / DEG).toFixed(2)}° → ${(path(s) / DEG).toFixed(2)}°`);
    }
  }
});

test('with the flaps for landing a tap moves the path a little, and it stays moved', () => {
  const sim = air();
  const s = sim.state;
  run(sim, 15);
  const g0 = path(s);
  let axis = 0;
  const tap = (dir) => {
    let t = 0;
    run(sim, 6, () => { axis = ramp(axis, t < 0.15 ? dir : 0); sim.controls.pitch = axis; t += DT; });
  };
  tap(-1);
  const g1 = path(s);
  tap(-1);
  const g2 = path(s);
  run(sim, 20);
  assert.ok(g0 - g1 > 0.1 * DEG && g0 - g1 < 0.8 * DEG, `one tap: ${((g1 - g0) / DEG).toFixed(2)}°`);
  assert.ok(g1 - g2 > 0.1 * DEG, `a second: ${((g2 - g1) / DEG).toFixed(2)}° more`);
  assert.ok(Math.abs(path(s) - g2) < 0.15 * DEG, `and it stays: ${(g2 / DEG).toFixed(2)}° → ${(path(s) / DEG).toFixed(2)}°`);
});

test('a keyboard final: taps keep the 777 on the glide path with auto-trim, and not without it', () => {
  // A scripted pilot with the keys only: every 1.2 s at most, a 0.12 s tap towards the sink rate that
  // closes the height error in 10 s. The autothrottle holds 150 kt.
  const fly = (autoTrim) => {
    const sim = air({ altFt: 1500 + GZ / FT, autoTrim, y: -1500 * FT / TAN3 });
    const s = sim.state;
    let axis = 0, key = 0, keyT = 0, wait = 0, sum = 0, n = 0;
    run(sim, 100, () => {
      const err = s.pos.z - GZ - Math.max(0, -s.pos.y + 300) * TAN3;
      if (keyT > 0) keyT -= DT; else key = 0;
      if (wait > 0) wait -= DT;
      if (s.t > 3 && wait <= 0) {
        const dv = s.vs - (-s.gs * TAN3 - err / 10);
        if (Math.abs(dv) > 0.4) { key = dv > 0 ? -1 : 1; keyT = 0.12; wait = 1.2; }
      }
      axis = ramp(axis, key); sim.controls.pitch = axis;
      if (s.t > 10) { sum += err * err; n++; }
      return s.agl < 150 * FT;
    });
    return Math.sqrt(sum / n);
  };
  const on = fly(true), off = fly(false);
  assert.ok(on < 30, `with auto-trim: ${on.toFixed(1)} m RMS off the path`);
  assert.ok(off > 3 * on, `without: ${off.toFixed(1)} m RMS`);
});

test('auto-trim: the trim switches have nothing to do, and turned off it carries on from the speed flown', () => {
  const a = air({ altFt: 8000, iasKt: 240, flapLever: 0, gearDown: false });
  const b = air({ altFt: 8000, iasKt: 240, flapLever: 0, gearDown: false });
  run(a, 10); run(b, 10, () => { b.controls.trim = 1; });
  assert.ok(Math.abs(a.state.pos.z - b.state.pos.z) < 0.01 && Math.abs(a.state.ias - b.state.ias) < 0.01, 'the same with or without the trim switch held');
  // Slower now (thrust back, A/T off): auto-trim off, the reference is the speed of the moment.
  const c = air({ altFt: 8000, iasKt: 240, flapLever: 0, gearDown: false, athr: false });
  c.controls.thrust = 0.2;
  run(c, 30);
  const v = c.state.ias;
  c.setAutoTrim(false);
  assert.ok(Math.abs(c.state.vRef - v) < 3 * KT, `vRef ${(c.state.vRef / KT).toFixed(1)} vs ${(v / KT).toFixed(1)} kt`);
  run(c, 3);
  assert.ok(Math.abs(c.state.ias - v) < 3 * KT, 'no lurch');
});

test('auto-trim at idle, hands off: the stall protection lowers the nose before the stall', () => {
  const sim = air({ athr: false });
  sim.controls.thrust = 0;
  const s = sim.state;
  let shook = false;
  run(sim, 90, () => { shook ||= s.shaker; });
  assert.ok(!shook, 'never at the shaker');
  assert.ok(!s.shaker && s.pliDeg > -1, `PLI ${s.pliDeg.toFixed(1)}° from the shaker`);
  assert.ok(s.ias > s.vmm - 8 * KT, `${(s.ias / KT).toFixed(0)} kt against vmm ${(s.vmm / KT).toFixed(0)}`);
  assert.ok(s.vs < -300 * FPM, 'descending');
});

test('auto-trim is in a snapshot only when on', () => {
  const a = air({ autoTrim: false });
  assert.equal(a.snapshot().options, undefined);
  a.setAutoTrim(true);
  assert.deepEqual(a.snapshot().options, { autoTrim: true });
  const b = createSim({ type: TYPE });
  b.restore(a.snapshot());
  assert.equal(b.state.autoTrim, true);
});
