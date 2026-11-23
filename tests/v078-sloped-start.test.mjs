// v0.7.8: a start on steep ground. Found by the airports' day run at Jeju's stand 1 (the ground there falls 1.95 m from
// nose to tail, 4.4 %): the sim's reset() stood the aircraft level and let the struts settle, the nose gear began 0.6 m
// in the ground, and the settling threw the aircraft into the air at 10.8 degrees of pitch: "not on the ground" at the
// gate, then a tail strike. The pushed v0.7.7 did the same. reset() now starts at the ground's own pitch where the
// ground slopes more than START_SLOPE_MIN along the aircraft; below it nothing changes (the golden flights are exact).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim, START_SLOPE_MIN } from '../src/sim/sim.js';

const DEG = 180 / Math.PI;
const slopeGround = (sl, hdg) => (x, y) => ({ h: 30 + sl * (x * Math.sin(hdg) + y * Math.cos(hdg)), kind: 'paved' });

test('on ground of 4.4 % up or down the nose, each type starts on its wheels at the ground\'s pitch and stays there', () => {
  assert.equal(START_SLOPE_MIN, 0.02);
  for (const type of ['a321neo', 'b787-9', 'b777-300er']) for (const sl of [0.044, -0.044, 0.03, 0.08]) for (const hdg of [0, 193.3 / DEG]) {
    const sim = createSim({ ground: slopeGround(sl, hdg), type });
    sim.reset({ x: 0, y: 0, hdg, onGround: true, parkingBrake: true });
    const s = sim.state, flat = createSim({ ground: slopeGround(0, hdg), type });
    flat.reset({ x: 0, y: 0, hdg, onGround: true, parkingBrake: true });
    for (let i = 0; i < 600; i++) sim.step(1 / 120);
    assert.equal(s.onGround, true, `${type} ${sl}`);
    assert.ok(!s.crashed, `${type} ${sl}: ${s.crashed}`);
    // the pitch is the ground's and the type's own level stance together (the Boeings sit 0.47 degrees nose down)
    assert.ok(Math.abs(s.pitch * DEG - (Math.atan(sl) * DEG + flat.state.pitch * DEG)) < 0.3, `${type} ${sl}: ${(s.pitch * DEG).toFixed(2)} deg`);
    assert.ok(Math.abs(s.agl) < 0.05 && Math.hypot(s.vel?.x ?? 0, s.vel?.y ?? 0) < 0.05, `${type} ${sl}: standing still`);
  }
});

test('a slope under the limit starts level as it always has (bit for bit against a sim built before the reset)', () => {
  // 1.5 %: under START_SLOPE_MIN. The state after reset is what the level start and its settling give.
  for (const type of ['a321neo', 'b777-300er']) {
    const sim = createSim({ ground: slopeGround(0.015, 0), type });
    sim.reset({ x: 0, y: 0, hdg: 0, onGround: true, parkingBrake: true });
    assert.equal(sim.state.onGround, true);
    assert.ok(Math.abs(sim.state.pitch * DEG - Math.atan(0.015) * DEG) < 0.6);
  }
});

test('Jeju\'s stand 1 is such a place, and reset() reads the wheels\' ground before the reference point\'s', () => {
  const ap = JSON.parse(readFileSync(new URL('../data/airports/RKPC.json', import.meta.url), 'utf8'));
  assert.ok(ap.stands.some((s) => String(s.ref) === '1' && s.gate));
  // a ground function that hands back one object it reuses (as the game's does): the reference point's values must be the last read
  const one = { h: 0, kind: 'paved' }; const seen = [];
  const sim = createSim({ ground: (x, y) => { one.h = 30 + 0.01 * y; seen.push([x, y]); return one; } });
  seen.length = 0;
  sim.reset({ x: 5, y: 7, hdg: 0, onGround: true, parkingBrake: true });
  assert.deepEqual(seen[2], [5, 7], 'the third lookup is the reference point');
  assert.ok(seen[0][1] > seen[1][1], 'the nose wheel, then the main wheels');
});
