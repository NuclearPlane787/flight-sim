// v0.4.2: the predictive windshear warning (sim.js pwsScan): the weather radar's, ahead along the track. It comes on
// for a microburst on the path from 0.5 to 1.5 nm ahead, below 1,200 ft, well before the reactive one, and says so
// ("windshear ahead"; a Boeing on an approach: "go around, windshear ahead"). Not for a gusty day, nor for a
// microburst off to the side.
//   node --test tests/windshear-ahead.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { calmWeather } from '../src/sim/weather.js';
import { createCallouts } from '../src/audio/callouts.js';
import { approachPilot } from './sim-helpers.mjs';

const KT = 0.514444, FT = 0.3048, DEG = Math.PI / 180, ELEV = 20, DT = 1 / 120;
const BURST = { x: 0, y: -1600, radiusM: 800, dvKt: 45 };   // on the final to a north-going runway at the origin

function approach(type, wx) {
  const sim = createSim({ type, ground: () => ({ h: ELEV, kind: 'runway' }) });
  sim.setWeather({ ...calmWeather(), preset: 'x', seed: 3, ...wx });
  const d = 4 * 1852, A = sim.type.data;
  sim.reset({ x: 0, y: -d, z: ELEV + sim.type.geo.GROUND_Z + Math.tan(3 * DEG) * d, hdg: 0, onGround: false, iasMs: 150 * KT,
    flapLever: A.FLAP_LEVER.length - 1, gearDown: true, fuelKg: 8000, payloadKg: 15000, ap: { ap: false, athr: true, spdKt: 150 } });
  const S = sim.state, calls = createCallouts();
  calls.setType(sim.type);
  const out = { ahead: null, reactive: null, ever: false, heard: [] };
  for (let i = 0; i < 200 / DT && !S.onGround && !S.crashed; i++) {
    approachPilot(sim);
    sim.step(DT);
    sim.events.length = 0;
    calls.update(S, i * DT);
    out.ever ||= S.warnings.windshearAhead;
    if (S.warnings.windshearAhead && !out.ahead) out.ahead = { t: S.t, y: S.pos.y, ft: S.agl / FT };
    if (S.warnings.windshear && !out.reactive) out.reactive = { t: S.t, y: S.pos.y };
  }
  out.heard = calls.heard;
  return out;
}

for (const type of ['a321neo', 'b787-9']) {
  test(`${type}: a microburst on the final: WINDSHEAR AHEAD well before the reactive warning, and said`, () => {
    const r = approach(type, { microbursts: [BURST] });
    assert.ok(r.ahead, 'the predictive warning came on');
    assert.ok(r.ahead.ft < 1200 && r.ahead.ft > 50, `at ${r.ahead.ft.toFixed(0)} ft`);
    assert.ok(r.reactive && r.reactive.t - r.ahead.t > 20, `${r.reactive ? (r.reactive.t - r.ahead.t).toFixed(0) + ' s' : 'no reactive warning'} before the reactive one`);
    const want = type === 'a321neo' ? 'windshear ahead, windshear ahead' : 'go around, windshear ahead';
    assert.ok(r.heard.includes(want), r.heard.join(' | '));
  });
}

test('none on a gusty, bumpy day, nor for a microburst 3 km off to the side', () => {
  const gusty = approach('b777-300er', { wind: { fromDeg: 90, kt: 20, gustKt: 30 }, turbulence: 'moderate' });
  assert.equal(gusty.ever, false);
  const aside = approach('b777-300er', { microbursts: [{ ...BURST, x: 3000 }] });
  assert.equal(aside.ever, false);
});

test('on the take-off roll, a microburst on the departure path: WINDSHEAR AHEAD before 100 kt', () => {
  const sim = createSim({ type: 'a321neo', ground: () => ({ h: ELEV, kind: 'runway' }) });
  sim.setWeather({ ...calmWeather(), preset: 'x', seed: 3, microbursts: [{ x: 0, y: 2500, radiusM: 800, dvKt: 45 }] });
  const A = sim.type.data;
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: true, flapLever: 1, fuelKg: 8000, payloadKg: 15000 });
  sim.controls.thrust = 1;
  sim.controls.parkingBrake = false;
  const S = sim.state;
  let at = null;
  for (let i = 0; i < 60 / DT && !at; i++) { sim.step(DT); sim.events.length = 0; if (S.warnings.windshearAhead) at = S.gs / KT; }
  assert.ok(at !== null && at < 100, `came on at ${at?.toFixed(0)} kt`);
  void A;
});
