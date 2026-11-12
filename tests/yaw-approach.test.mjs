// v0.4.2: the 777's yaw on the approach (Shane, v0.4.1: "the nose swings far too much"), measured against
// the other two: hands off at 1,500 ft in the moderate storm, and the Dutch roll after a rudder pulse. At
// v0.4.2 the 777 is the calmest of the three (yaw rate σ about 1.2°/s against the A321's 1.5°/s) and its
// Dutch roll is damped about as well as theirs (ζ about 0.3), so nothing was changed; this keeps it so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { typeById } from '../src/sim/types.js';
import { presetWeather } from '../src/sim/weather-presets.js';

const DT = 1 / 120;
const SPEED = { 'a321neo': 140, 'b787-9': 145, 'b777-300er': 150 };
const CTX = { airports: [], refX: 0, refY: 0, arrival: { icao: 'TEST', x: 0, y: 10000, hdgMagDeg: 0, hdgGridDeg: 0 } };

function onFinal(type, wx) {
  const A = typeById(type).data;
  const sim = createSim({ type });
  const mass = A.OEW + 0.6 * (A.MLW - A.OEW), fuelKg = 8000;
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 1500 * A.FT, iasMs: SPEED[type] * A.KT, flapLever: A.FLAP_LEVER.length - 1, gearDown: true,
    fuelKg, payloadKg: Math.max(0, mass - A.OEW - fuelKg), ap: { ap: false, athr: true, spdKt: SPEED[type] } });
  if (wx) sim.setWeather(wx);
  return { sim, A };
}
function stormYaw(type) {
  const { sim, A } = onFinal(type, presetWeather('thunderstorm', CTX));
  let n = 0, sum = 0;
  for (let i = 0; i < 65 / DT; i++) { sim.step(DT); sim.events.length = 0; if (i > 5 / DT) { n++; sum += sim.state.r * sim.state.r; } }
  return Math.sqrt(sum / n) / A.DEG;
}
function dutchRollZeta(type) {
  const { sim } = onFinal(type);
  const s = sim.state;
  for (let i = 0; i < 3 / DT; i++) { sim.step(DT); sim.events.length = 0; }
  const peaks = []; let p1 = 0, p2 = 0, t = 0;
  for (let i = 0; i < 20 / DT; i++) {
    sim.controls.yaw = t < 0.5 ? -1 : 0; t += DT;
    sim.step(DT); sim.events.length = 0;
    if (t > 0.6 && Math.abs(p1) > Math.abs(p2) && Math.abs(p1) >= Math.abs(s.beta)) peaks.push(Math.abs(p1));
    p2 = p1; p1 = s.beta;
  }
  const d = 2 * Math.log(peaks[0] / peaks[1]);   // successive peaks are half a cycle apart
  return d / Math.sqrt(4 * Math.PI * Math.PI + d * d);
}

test('the Boeings yaw no more than the A321 in the moderate storm, hands off on final', () => {
  const a321 = stormYaw('a321neo'), b787 = stormYaw('b787-9'), b777 = stormYaw('b777-300er');
  assert.ok(b777 <= a321 && b787 <= a321, `yaw rate σ: A321 ${a321.toFixed(2)}, 787 ${b787.toFixed(2)}, 777 ${b777.toFixed(2)} °/s`);
  assert.ok(b777 < 1.6, `777 ${b777.toFixed(2)} °/s`);
});

test('the Dutch roll is well damped on all three (ζ over 0.2 on final)', () => {
  for (const type of ['a321neo', 'b787-9', 'b777-300er']) {
    const z = dutchRollZeta(type);
    assert.ok(z > 0.2, `${type}: ζ ${z.toFixed(2)}`);
  }
});
