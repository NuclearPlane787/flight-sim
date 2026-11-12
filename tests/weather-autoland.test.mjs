// v0.4.0, Part 2: the Boeings fly the track, and the autoland decrabs.
//   node --test tests/weather-autoland.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { calmWeather } from '../src/sim/weather.js';

const KT = 0.514444, FT = 0.3048, DEG = Math.PI / 180;
const ELEV = 20;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// An ILS approach to a north-going runway at the origin, flown by the autopilot to a stop.
function autoland(type, fromDeg, kt, { gustKt = 0, turbulence = 'none', seed = 1 } = {}) {
  const sim = createSim({ type, ground: () => ({ h: ELEV, kind: 'runway' }) });
  sim.setWeather({ ...calmWeather(), preset: 'x', seed, turbulence, wind: { fromDeg, kt, gustKt }, aloft: { fromDeg, kt: kt * 1.3 } });
  const d = 8 * 1852;
  const A = sim.type.data;
  sim.reset({ x: 0, y: -d, z: ELEV + 15 + Math.tan(3 * DEG) * d, hdg: 0, onGround: false, iasMs: 170 * KT, flapLever: A.FLAP_LEVER.indexOf('30'), gearDown: true, fuelKg: 15000, payloadKg: 25000, ap: { ap: true, athr: true, spdKt: 170, hdgDeg: 0, altFt: 3000 } });
  sim.controls.gearDown = true;
  sim.ap.setIls({ x: 0, y: 0, hdgGrid: 0, elev: ELEV, gsDeg: 3 });
  sim.ap.setSpd(Math.round(sim.state.vmm / KT + 8));
  sim.ap.app();
  const S = sim.state;
  const out = { maxXteOn: 0, at500: null, at200: null, td: null, crashed: null, stopX: 0, rolloutMax: 0 };
  let touched = false;
  for (let i = 0; i < 400 * 120; i++) {
    sim.step(1 / 120);
    const crab = wrap(S.hdg) / DEG;
    const agl = S.agl / FT;
    if (agl < 1500 && !touched && Math.abs(S.pos.x) > out.maxXteOn) out.maxXteOn = Math.abs(S.pos.x);
    if (!out.at500 && agl < 500) out.at500 = { crab, roll: S.roll / DEG, x: S.pos.x, drift: S.drift / DEG };
    if (!out.at200 && agl < 200) out.at200 = { crab, roll: S.roll / DEG, x: S.pos.x, beta: S.beta / DEG };
    for (const e of sim.events) if (e.type === 'touchdown') { touched = true; out.td = { crab, vs: e.vsMs / FT * 60, g: e.g, x: e.x, y: e.y, bank: e.bank / DEG, surface: e.surface }; }
    sim.events.length = 0;
    if (touched) out.rolloutMax = Math.max(out.rolloutMax, Math.abs(S.pos.x));
    if (S.crashed || (touched && S.gs < 15)) break;
  }
  out.crashed = S.crashed; out.stopX = S.pos.x; out.ap = sim.ap.ap;
  return out;
}

const fmt = (r) => `xte ${r.maxXteOn.toFixed(1)} m; at 500: crab ${r.at500?.crab.toFixed(1)} drift ${r.at500?.drift.toFixed(1)}; at 200: crab ${r.at200?.crab.toFixed(1)} roll ${r.at200?.roll.toFixed(1)} β ${r.at200?.beta.toFixed(1)}; td ${JSON.stringify(r.td)}; rollout max ${r.rolloutMax.toFixed(1)} m; stop x ${r.stopX.toFixed(1)}; crashed ${r.crashed}`;

for (const type of ['b787-9', 'b777-300er']) {
  test(`${type}: a 20 kt crosswind autoland ends on the centreline, decrabbed`, () => {
    for (const from of [90, 270]) {
      const r = autoland(type, from, 20);
      console.log(`${type} from ${from}: ${fmt(r)}`);
      assert.equal(r.crashed, null);
      assert.ok(r.maxXteOn < 15, `LOC tracking: ${r.maxXteOn} m`);
      assert.ok(r.td, 'touched down');
      assert.ok(Math.abs(r.at200.crab) < Math.abs(r.at500.crab) - 1, `the alignment has begun by 200 ft: ${r.at500.crab}° to ${r.at200.crab}°`);
      assert.ok(Math.abs(r.td.crab) < 4, `decrabbed: ${r.td.crab}°`);
      assert.ok(Math.abs(r.td.x) < 12, `on the centreline at the wheels: ${r.td.x} m`);
      assert.ok(Math.abs(r.stopX) < 10, `on the centreline at the end: ${r.stopX} m`);
      // v0.4.2: the alignment's and the rollout's integrals and gains. At v0.4.1: 6.4–6.6° of crab at 200 ft,
      // about 3° and 5–6 m off the centreline at the wheels, and the rollout up to 19 m off.
      assert.ok(Math.abs(r.at200.crab) < 5.5, `at 200 ft, ${r.at200.crab.toFixed(1)}° of crab (the target: 5°)`);
      assert.ok(Math.abs(r.td.crab) < 2.5 && Math.abs(r.td.x) < 4, `at the wheels: ${r.td.crab.toFixed(1)}°, ${r.td.x.toFixed(1)} m`);
      assert.ok(r.rolloutMax < 9 && Math.abs(r.stopX) < 4, `the rollout: ${r.rolloutMax.toFixed(1)} m at most, ${r.stopX.toFixed(1)} m at the end`);
    }
  });
  test(`${type}: it always tries, in an extreme wind`, () => {
    const r = autoland(type, 90, 40, { gustKt: 55, turbulence: 'moderate' });
    console.log(`${type} extreme: ${fmt(r)}`);
    assert.ok(r.td, 'it flew the approach to the ground, not away from it');
  });
}

test('a go-around in a crosswind holds the track it had, not the nose', () => {
  const sim = createSim({ type: 'b787-9', ground: () => ({ h: ELEV, kind: 'runway' }) });
  sim.setWeather({ ...calmWeather(), preset: 'x', wind: { fromDeg: 90, kt: 30, gustKt: 0 }, aloft: { fromDeg: 90, kt: 30 } });
  sim.reset({ x: 0, y: 0, z: 400, hdg: 0, onGround: false, iasMs: 170 * KT, flapLever: sim.type.data.FLAP_LEVER.indexOf('30'), gearDown: true, fuelKg: 15000, payloadKg: 25000, ap: { ap: true, athr: true, spdKt: 170, hdgDeg: 0, altFt: 5000 } });
  for (let i = 0; i < 120; i++) sim.step(1 / 120);
  const t0 = Math.atan2(sim.state.vel.x, sim.state.vel.y);
  sim.ap.toga();
  assert.equal(sim.ap.lateral, 'TO/GA');
  for (let i = 0; i < 30 * 120; i++) sim.step(1 / 120);
  const t1 = Math.atan2(sim.state.vel.x, sim.state.vel.y);
  assert.ok(Math.abs(wrap(t1 - t0)) < 2 * DEG, `track moved ${wrap(t1 - t0) / DEG}°`);
});
