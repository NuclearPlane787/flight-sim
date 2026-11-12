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

test('auto-trim: a held trim switch moves the path held, and turned off it carries on from the speed flown', () => {
  // v0.4.2: H/Y move the path held at 0.5°/s (they did nothing at v0.4.1).
  const a = air({ altFt: 8000, iasKt: 240, flapLever: 0, gearDown: false });
  const s = a.state;
  run(a, 10);
  const g0 = path(s);
  run(a, 2, () => { a.controls.trim = 1; });
  a.controls.trim = 0;
  run(a, 8);
  const g1 = path(s);
  assert.ok(g1 - g0 > 0.6 * DEG && g1 - g0 < 1.4 * DEG, `nose-up trim for 2 s: ${((g1 - g0) / DEG).toFixed(2)}°`);
  run(a, 10);
  assert.ok(Math.abs(path(s) - g1) < 0.2 * DEG, `and it stays (${(g1 / DEG).toFixed(2)}° → ${(path(s) / DEG).toFixed(2)}°)`);
  // With the flaps for landing too: nose-down trim for 2 s steepens the path about 1°.
  const l = air();
  run(l, 15);
  const h0 = path(l.state);
  run(l, 2, () => { l.controls.trim = -1; });
  l.controls.trim = 0;
  run(l, 8);
  const dh = path(l.state) - h0;
  assert.ok(dh < -0.6 * DEG && dh > -1.4 * DEG, `landing flaps, nose-down trim for 2 s: ${(dh / DEG).toFixed(2)}°`);
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

// v0.4.2: auto-trim's flare law, as the A321's (fbw.js), with a gentler sink that stops at +0.5°. Down a
// 3° path hands off to the runway (the A/T idles at 25 ft), with a pull of full back stick from a height.
function landing(pullFt, pullS = 1) {
  const sim = air({ altFt: 450 + GZ / FT, iasKt: 150 });
  const s = sim.state;
  run(sim, 12, () => { sim.controls.pitch = Math.max(-0.4, Math.min(0.4, 0.4 * (-3 * DEG - path(s)) / DEG)); });
  sim.controls.pitch = 0;
  let axis = 0, pulled = 0, th50 = null, y50 = null, flare = false, td = null, thMin = 1;
  for (let i = 0; i < 90 / DT && !td && !s.crashed; i++) {
    const ft = s.agl / FT;
    if (th50 === null && ft < 50) { th50 = s.pitch; y50 = s.pos.y; }
    if (s.flare) { flare = true; thMin = Math.min(thMin, s.pitch); }
    let key = 0;
    if (pullFt && ft < pullFt && pulled < pullS) { key = 1; pulled += DT; }
    axis = ramp(axis, key); sim.controls.pitch = axis;
    sim.step(DT);
    for (const e of sim.events) if (e.type === 'touchdown' && !td) td = e;
    sim.events.length = 0;
  }
  return { flare, th50, thMin, thTd: td ? td.pitch : NaN, sinkFpm: td ? -td.vsMs / FPM : NaN, dist: td ? td.y - y50 : NaN, crashed: s.crashed };
}

test('auto-trim flare law: hands off it lands firmly on the mains; a short pull flares it; a long one breaks nothing', () => {
  const off = landing(0);
  assert.ok(off.flare, 'the flare law engaged');
  assert.ok(!off.crashed && off.sinkFpm < 850, `hands off: ${off.sinkFpm.toFixed(0)} ft/min`);
  assert.ok(off.thTd > 0.3 * DEG && off.thTd <= Math.max(off.th50, 0.5 * DEG) + 0.1 * DEG,
    `hands off the nose stays up (mains first): ${(off.th50 / DEG).toFixed(2)}° at 50 ft, ${(off.thTd / DEG).toFixed(2)}° at the wheels`);
  const fl = landing(30, 0.6);
  assert.ok(!fl.crashed && fl.sinkFpm > 100 && fl.sinkFpm < 450 && fl.dist < 650,
    `a 0.6 s pull at 30 ft: ${fl.sinkFpm.toFixed(0)} ft/min, ${fl.dist.toFixed(0)} m from 50 ft`);
  // v0.4.1's path law ballooned on a 2 s pull and dropped the 777 on its nose wheel; the attitude is held now.
  const big = landing(30, 2);
  assert.ok(!big.crashed && big.sinkFpm < 850, `a 2 s pull: ${big.crashed || big.sinkFpm.toFixed(0) + ' ft/min'}`);
  assert.ok(big.thTd < (A.PITCH_TAILSTRIKE_DEG - 1.5) * DEG, `pitch at the wheels ${(big.thTd / DEG).toFixed(2)}°, the tail strikes at ${A.PITCH_TAILSTRIKE_DEG}°`);
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
