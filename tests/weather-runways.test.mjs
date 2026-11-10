// v0.4.0, Part 3: wet, snowy and icy runways.
//   node --test tests/weather-runways.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { calmWeather, runwayStateOf, RUNWAY_TYRES } from '../src/sim/weather.js';

const wx = (o) => ({ ...calmWeather(), preset: 'x', ...o });

// A landing roll: rolling at 70 m/s with the spoilers out, the brakes on, no reverse. Metres to 5 m/s.
function roll(weather, type = 'a321neo', kind = 'runway', speed = 70) {
  const sim = createSim({ type, ground: () => ({ h: 0, kind }) });
  if (weather) sim.setWeather(weather);
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: true, fuelKg: 6000, payloadKg: 15000, parkingBrake: false });
  sim.setGroundPose(0, 0, 0, speed);
  sim.controls.speedbrake = 1;
  sim.controls.thrust = 0;
  let n = 0;
  while (sim.state.gs > Math.min(5, speed / 4) && n++ < 200 * 120) { sim.controls.brakeL = sim.controls.brakeR = 1; sim.step(1 / 120); sim.events.length = 0; }
  assert.equal(sim.state.crashed, null);
  return sim.state.pos.y;
}

test('the runway\'s state: automatic from the precipitation and the temperature, or as set', () => {
  assert.equal(runwayStateOf(null), 'dry');
  assert.equal(runwayStateOf(wx({})), 'dry');
  assert.equal(runwayStateOf(wx({ precip: { kind: 'rain', rate: 0.5 }, tempC: 12 })), 'wet');
  assert.equal(runwayStateOf(wx({ precip: { kind: 'rain', rate: 0.5 }, tempC: -2 })), 'ice');
  assert.equal(runwayStateOf(wx({ precip: { kind: 'snow', rate: 0.5 }, tempC: -2 })), 'snow');
  assert.equal(runwayStateOf(wx({ precip: { kind: 'snow', rate: 0.5 }, tempC: 3 })), 'wet');
  assert.equal(runwayStateOf(wx({ runway: 'ice' })), 'ice');
  assert.equal(runwayStateOf(wx({ runway: 'dry', precip: { kind: 'rain', rate: 1 } })), 'dry');
});

test('a wet runway\'s roll is longer by the friction\'s share, a snowy and an icy one longer again', () => {
  const d = roll(null), w = roll(wx({ runway: 'wet' })), s = roll(wx({ runway: 'snow' })), i = roll(wx({ runway: 'ice' }));
  console.log(`rolls: dry ${d.toFixed(0)} m, wet ${w.toFixed(0)} m, snow ${s.toFixed(0)} m, ice ${i.toFixed(0)} m`);
  assert.ok(w > d * 1.25 && w < d * 1.75, `wet ${w / d}× dry`);
  assert.ok(s > w * 1.2, `snow ${s / w}× wet`);
  assert.ok(i > s * 1.5, `ice ${i / s}× snow`);
});

test('a state only changes the pavement; the default weather changes nothing', () => {
  assert.ok(!RUNWAY_TYRES.dry, 'dry has no factors');
  const dry = roll(null), same = roll(wx({ runway: 'dry' }));
  assert.equal(same, dry, 'a dry runway set by hand is exactly the dry roll');
  // Slowly, or the fast run across the grass takes the gear.
  const grass = roll(null, 'a321neo', 'ground', 12), icyGrass = roll(wx({ runway: 'ice' }), 'a321neo', 'ground', 12);
  assert.equal(icyGrass, grass, 'off the pavement the runway\'s state changes nothing');
});
