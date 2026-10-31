// Keyboard landing feel: a keyboard pilot (keys turned into stick through input.js's ramp,
// with human timing) flies the flare law and the landing-configuration path law.
// The flare: from 30 ft a hold or a few taps of S give a 100–350 ft/min touchdown at
// +3–8° pitch with no balloon; hands off, the nose sinks (Airbus flare law) and it lands firm.
// The path: a tap of W moves the vertical speed a little and it stays there; a hold moves
// it more, without overshooting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { airborne, FT, FPM, DEG, KT, DT } from './sim-helpers.mjs';

const AXIS_IN = 3.5, AXIS_OUT = 6; // input.js's key ramps
const RT = 0.2;                    // reaction time

function keyboard() {
  const down = new Set(), queue = [];
  let pitch = 0;
  return {
    press(t, key, ms) { queue.push({ t, key, d: true }, { t: t + ms / 1000, key, d: false }); },
    busy: (key, t) => down.has(key) || queue.some((e) => e.key === key && e.t >= t),
    step(t) {
      queue.sort((a, b) => a.t - b.t);
      while (queue.length && queue[0].t <= t) { const e = queue.shift(); if (e.d) down.add(e.key); else down.delete(e.key); }
      const goal = (down.has('S') ? 1 : 0) - (down.has('W') ? 1 : 0);
      const step = (goal === 0 ? AXIS_OUT : AXIS_IN) * DT;
      pitch = Math.abs(goal - pitch) <= step ? goal : pitch + Math.sign(goal - pitch) * step;
      return pitch;
    },
  };
}

// CONF FULL at Vapp on a 3° path by the AP (A/THR on), AP off at 400 ft, RETARD at 20 ft.
function approach(massKg, startFt) {
  const probe = airborne({ massKg, fuelKg: 6000, altFt: 1000, iasKt: 140, flapLever: 4, gearDown: true });
  const vapp = probe.state.vls / KT + 5;
  const sim = airborne({ massKg, fuelKg: 6000, altFt: (startFt * FT + 4.12) / FT, iasKt: vapp, flapLever: 4, gearDown: true,
    ap: { ap: true, athr: true, spdKt: vapp, hdgDeg: 0, altFt: 0 } });
  sim.controls.thrust = 25 / 45;
  sim.controls.spoilersArmed = true;
  sim.ap.setVs(-Math.round(vapp * 101.27 * Math.tan(3 * DEG) / 100) * 100);
  return sim;
}

function flare(massKg, pilot) {
  const sim = approach(massKg, 600);
  const s = sim.state, c = sim.controls, kb = keyboard(), m = {};
  let t = 0, apOff = false, td = null, minAgl = 1e9, balloon = 0, maxPitch = -90;
  for (let i = 0; i < 90 / DT && !td && !s.crashed; i++) {
    const agl = s.agl / FT;
    if (!apOff && agl < 400) { sim.ap.disconnectAp('manual'); apOff = true; }
    if (agl < 20) c.thrust = 0;
    if (agl < 30) { minAgl = Math.min(minAgl, agl); balloon = Math.max(balloon, agl - minAgl); maxPitch = Math.max(maxPitch, s.pitch / DEG); }
    if (apOff) pilot({ kb, t, agl, vsF: s.vs / FPM, m });
    c.pitch = kb.step(t);
    sim.step(DT); t += DT;
    for (const e of sim.events.splice(0)) if (e.type === 'touchdown') td = { fpm: e.vsMs / FPM, pitch: e.pitch / DEG };
  }
  return { td, balloon, maxPitch, crashed: s.crashed };
}

const PILOTS = {
  'hold S 1 s from 30 ft': ({ kb, t, agl, m }) => { if (!m.a && agl < 30) { m.a = 1; kb.press(t + RT, 'S', 1000); } },
  'hold S 1.5 s from 30 ft': ({ kb, t, agl, m }) => { if (!m.a && agl < 30) { m.a = 1; kb.press(t + RT, 'S', 1500); } },
  'hold S from 30 ft to touchdown': ({ kb, t, agl, m }) => { if (!m.a && agl < 30) { m.a = 1; kb.press(t + RT, 'S', 30000); } },
  'four 180 ms taps of S in 1 s': ({ kb, t, agl, m }) => { if (!m.a && agl < 30) { m.a = 1; for (let i = 0; i < 4; i++) kb.press(t + RT + i * 0.27, 'S', 180); } },
  'taps of S while sinking > 300 ft/min': ({ kb, t, agl, vsF, m }) => {
    if (agl < 30 && (m.next ?? 0) <= t) { m.next = t + 0.25; if (vsF < -300 && !kb.busy('S', t)) kb.press(t + RT, 'S', 250); }
  },
};

for (const massKg of [70000, 79000]) {
  for (const [name, pilot] of Object.entries(PILOTS)) {
    test(`flare at ${massKg / 1000} t, ${name}: soft touchdown, nose up, no balloon`, () => {
      const r = flare(massKg, pilot);
      if (process.env.SIM_DEBUG) console.log(name, r);
      assert.equal(r.crashed, null);
      assert.ok(r.td, 'touched down');
      assert.ok(r.td.fpm < -60 && r.td.fpm > -400, `touchdown ${r.td.fpm.toFixed(0)} ft/min`);
      assert.ok(r.td.pitch > 3 && r.td.pitch < 8, `pitch ${r.td.pitch.toFixed(1)}° at touchdown`);
      assert.ok(r.maxPitch < 8.5, `max pitch ${r.maxPitch.toFixed(1)}° (tail strike ≈ 9.7°)`);
      assert.ok(r.balloon < 5, `balloon ${r.balloon.toFixed(1)} ft`);
    });
  }
}

test('flare law: hands off the nose sinks below the memorised attitude and the landing is firm', () => {
  const r = flare(70000, () => {});
  assert.equal(r.crashed, null);
  assert.ok(r.td.fpm < -600, `touchdown ${r.td.fpm.toFixed(0)} ft/min`);
  assert.ok(r.td.pitch < 2.5, `pitch ${r.td.pitch.toFixed(1)}°`);
});

// Hands-off on the 3° path in CONF FULL, then one key input; the change in V/S 5 s after.
function pathInput(key, ms, n = 1, gap = 0.6) {
  const sim = approach(70000, 1500);
  const s = sim.state, c = sim.controls, kb = keyboard();
  let t = 0;
  const step = () => { c.pitch = kb.step(t); sim.step(DT); t += DT; };
  for (let i = 0; i < 4 / DT; i++) step();
  sim.ap.disconnectAp('manual');
  for (let i = 0; i < 4 / DT; i++) step();
  const vs0 = s.vs / FPM;
  for (let k = 0; k < n; k++) kb.press(t + k * gap, key, ms);
  const end = t + (n - 1) * gap + ms / 1000 + 5;
  let peak = 0;
  while (t < end) { step(); peak = Math.max(peak, Math.abs(s.vs / FPM - vs0)); }
  return { dvs: s.vs / FPM - vs0, peak };
}

test('approach path: a 150 ms tap of W moves the V/S by about 50 ft/min and it stays', () => {
  const r = pathInput('W', 150);
  assert.ok(r.dvs < -25 && r.dvs > -120, `ΔV/S ${r.dvs.toFixed(0)}`);
  const up = pathInput('S', 150);
  assert.ok(up.dvs > 25 && up.dvs < 120, `ΔV/S ${up.dvs.toFixed(0)}`);
});

test('approach path: five taps add up; a 1 s hold moves it more without overshoot', () => {
  const five = pathInput('W', 150, 5);
  assert.ok(five.dvs < -150 && five.dvs > -400, `5 taps ΔV/S ${five.dvs.toFixed(0)}`);
  const hold = pathInput('W', 1000);
  assert.ok(hold.dvs < -400 && hold.dvs > -900, `1 s hold ΔV/S ${hold.dvs.toFixed(0)}`);
  assert.ok(hold.peak < 1.2 * Math.abs(hold.dvs), `peak ${hold.peak.toFixed(0)} vs ${hold.dvs.toFixed(0)}`);
});
