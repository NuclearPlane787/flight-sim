// v0.4.3: how the Boeings stop after a pitch input, with auto-trim on, hand flown on final (Shane, v0.4.2: "The 787
// seems to stabilise itself well when I pitch, but the 777's pitch stabilisation only improved by a little"). At v0.4.2
// a 1 s press of the key left the 777's nose going on 2.8° after the key came up and swinging 2.7° back over 3.7 s (the
// 787: 1.2° and 1.1°). The 777's elevator and stabiliser now have its own tail volume's power (src/sim/b777-300er.js),
// and the path mode caps the pitch rate (PATH_Q_MAX in src/sim/fbw-boeing.js): both stop within about 1° and settle
// in under a second, the 777 as the 787.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { typeById } from '../src/sim/types.js';

const DT = 1 / 120;
// input.js's ramps: full in about 0.3 s, back in about 0.17 s.
const ramp = (v, goal) => { const st = (goal === 0 ? 6 : 3.5) * DT; return Math.abs(goal - v) <= st ? goal : v + Math.sign(goal - v) * st; };
const path = (s) => Math.asin(Math.max(-1, Math.min(1, s.vs / Math.max(1, s.tas))));

function onFinal(type) {
  const A = typeById(type).data;
  const sim = createSim({ type });
  const mass = A.OEW + 0.6 * (A.MLW - A.OEW), fuelKg = 20000;
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 3000 * A.FT, iasMs: 150 * A.KT, flapLever: A.FLAP_LEVER.length - 1, gearDown: true,
    fuelKg, payloadKg: mass - A.OEW - fuelKg, ap: { ap: false, athr: true, spdKt: 150 } });
  sim.setAutoTrim(true);
  for (let i = 0; i < 15 / DT; i++) { sim.step(DT); sim.events.length = 0; }
  return { sim, A };
}

// Hold the pitch key (+1 back, −1 forward) for holdS, let go, and watch 12 s. In degrees: how far the nose went on after
// the key came up, how far it swung back past where it ended, the path's overshoot, and when the pitch rate last
// exceeded 0.15°/s (s after the release).
function press(type, holdS, dir = 1) {
  const { sim, A } = onFinal(type);
  const s = sim.state, DEG = A.DEG;
  const th0 = s.pitch, g0 = path(s);
  let axis = 0, t = 0, prev = s.pitch, relT = null, thRel = 0, thPeak = -1e9, gPeak = -1e9, last = 0;
  while (t < holdS + 12) {
    axis = ramp(axis, t < holdS ? dir : 0);
    sim.controls.pitch = axis;
    sim.step(DT); sim.events.length = 0; t += DT;
    const q = (s.pitch - prev) / DT; prev = s.pitch;
    if (relT === null && t >= holdS && axis === 0) { relT = t; thRel = dir * (s.pitch - th0); }
    if (relT !== null) {
      thPeak = Math.max(thPeak, dir * (s.pitch - th0));
      gPeak = Math.max(gPeak, dir * (path(s) - g0));
      if (Math.abs(q) > 0.15 * DEG) last = t;
    }
  }
  const thEnd = dir * (s.pitch - th0), gEnd = dir * (path(s) - g0);
  return { past: (thPeak - thRel) / DEG, swing: (thPeak - thEnd) / DEG, gOver: (gPeak - gEnd) / DEG, gEnd: gEnd / DEG, settle: last - relT };
}

test('a press of the pitch key stops within about a degree and settles in under a second and a half, on both Boeings', () => {
  for (const type of ['b787-9', 'b777-300er']) {
    for (const [hold, dir] of [[0.4, 1], [1.0, 1], [1.0, -1]]) {
      const r = press(type, hold, dir);
      const what = `${type}, ${hold} s ${dir > 0 ? 'back' : 'forward'}: on ${r.past.toFixed(2)}°, back ${r.swing.toFixed(2)}°, path over ${r.gOver.toFixed(2)}°, settled ${r.settle.toFixed(1)} s`;
      assert.ok(r.past < 1.3, what);
      assert.ok(r.swing < 0.3, what);
      assert.ok(r.gOver < 0.2, what);
      assert.ok(r.settle < 1.5, what);
      assert.ok(r.gEnd > 0.9 * hold, `${what}; the path moved ${r.gEnd.toFixed(2)}°`);
    }
  }
});

test('the 777 stops like the 787', () => {
  for (const hold of [0.4, 1.0]) {
    const a = press('b787-9', hold), b = press('b777-300er', hold);
    assert.ok(Math.abs(a.past - b.past) < 0.3 && Math.abs(a.swing - b.swing) < 0.3,
      `${hold} s: 787 ${a.past.toFixed(2)}°/${a.swing.toFixed(2)}°, 777 ${b.past.toFixed(2)}°/${b.swing.toFixed(2)}°`);
  }
});

test('a tap still moves the path a little, and the cap is off in a go-around', () => {
  for (const type of ['b787-9', 'b777-300er']) {
    const tap = press(type, 0.15);
    assert.ok(tap.gEnd > 0.1 && tap.gEnd < 0.5, `${type}: a tap moves the path ${tap.gEnd.toFixed(2)}°`);
    // TO/GA thrust and a full pull: the nose comes up faster than the path mode's cap.
    const { sim, A } = onFinal(type);
    const s = sim.state;
    sim.controls.thrust = 1;
    let axis = 0, prev = s.pitch, qMax = 0;
    for (let i = 0; i < 3 / DT; i++) {
      axis = ramp(axis, 1); sim.controls.pitch = axis;
      sim.step(DT); sim.events.length = 0;
      qMax = Math.max(qMax, (s.pitch - prev) / DT); prev = s.pitch;
    }
    assert.ok(qMax > 2.6 * A.DEG, `${type}: a go-around's pull pitches at ${(qMax / A.DEG).toFixed(2)}°/s`);
  }
});
