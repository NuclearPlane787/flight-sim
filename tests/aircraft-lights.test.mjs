// The A321's exterior lights by phase (src/aircraft-lights.js), and their flash timing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lightsFor, flashAt } from '../src/aircraft-lights.js';

const on = (l) => Object.keys(l).filter((k) => l[k] > 0).sort();
const ground = { onGround: true, agl: 0, altFt: 60, gearDown: true };
const air = (altFt, extra = {}) => ({ onGround: false, gs: 140, agl: altFt * 0.3, altFt, enginesRunning: true, gatePhase: 'departed', onRunway: false, gearDown: false, ...extra });

test('parked cold at the gate: nav only (and the logo light, on at night at the gate)', () => {
  const l = lightsFor({ ...ground, gs: 0, enginesRunning: false, gatePhase: 'parked', onRunway: false });
  assert.deepEqual(on(l), ['logo', 'nav']);
});

test('pushback: nav and beacon, no taxi light behind the tug', () => {
  const l = lightsFor({ ...ground, gs: 1.2, enginesRunning: false, gatePhase: 'pushback', onRunway: false });
  assert.deepEqual(on(l), ['beacon', 'logo', 'nav']);
});

test('taxi: the taxi light too, no strobes or landing lights', () => {
  const l = lightsFor({ ...ground, gs: 7, enginesRunning: true, gatePhase: 'taxi', onRunway: false });
  assert.deepEqual(on(l), ['beacon', 'logo', 'nav', 'taxi']);
});

test('lined up and on the take-off roll: everything, strobes and landing lights included', () => {
  for (const gs of [0, 40]) {
    const l = lightsFor({ ...ground, gs, enginesRunning: true, gatePhase: 'departed', onRunway: true });
    assert.deepEqual(on(l), ['beacon', 'landing', 'logo', 'nav', 'strobe', 'taxi']);
  }
});

test('after gear up the nose light goes out; landing lights stay on below 10,000 ft', () => {
  const l = lightsFor(air(3000));
  assert.equal(l.taxi, 0);
  assert.equal(l.landing, 1);
  assert.equal(l.strobe, 1);
  assert.equal(l.beacon, 1);
});

test('climbing through 12,000 ft: no landing or logo light', () => {
  const l = lightsFor(air(12000));
  assert.deepEqual(on(l), ['beacon', 'nav', 'strobe']);
});

test('descending below 10,000 ft: landing lights on; gear down brings the nose light', () => {
  assert.equal(lightsFor(air(9500)).landing, 1);
  const fin = lightsFor(air(1500, { gearDown: true }));
  assert.deepEqual(on(fin), ['beacon', 'landing', 'logo', 'nav', 'strobe', 'taxi']);
});

test('landing rollout on the runway: strobes and landing lights still on', () => {
  const l = lightsFor({ ...ground, gs: 50, enginesRunning: true, gatePhase: 'departed', onRunway: true });
  assert.equal(l.strobe, 1);
  assert.equal(l.landing, 1);
});

test('taxi-in after vacating: strobes off, landing off, taxi on', () => {
  for (const gatePhase of ['taxi-in', 'departed', 'none']) {
    const l = lightsFor({ ...ground, gs: 8, enginesRunning: true, gatePhase, onRunway: false });
    assert.deepEqual(on(l), ['beacon', 'logo', 'nav', 'taxi'], gatePhase);
  }
});

test('arrived at the stand: taxi light off; beacon until the engines are shut down', () => {
  const running = lightsFor({ ...ground, gs: 0, enginesRunning: true, gatePhase: 'arrived', onRunway: false });
  assert.deepEqual(on(running), ['beacon', 'logo', 'nav']);
  const shut = lightsFor({ ...ground, gs: 0, enginesRunning: false, gatePhase: 'arrived', onRunway: false });
  assert.deepEqual(on(shut), ['logo', 'nav']);
});

test('flash timing: beacons ~1 Hz alternating, strobes a double flash every 1.2 s', () => {
  let top = 0, bottom = 0, strobe = 0, both = 0;
  const N = 12000, dt = 0.001; // 12 s
  let prevS = 0, flashes = 0;
  for (let i = 0; i < N; i++) {
    const f = flashAt(i * dt);
    top += f.beaconTop; bottom += f.beaconBottom; strobe += f.strobe;
    if (f.beaconTop && f.beaconBottom) both++;
    if (f.strobe && !prevS) flashes++;
    prevS = f.strobe;
  }
  assert.equal(both, 0);
  assert.ok(Math.abs(top * dt - 12 * 0.12) < 0.02 && Math.abs(bottom * dt - 12 * 0.12) < 0.02);
  assert.equal(flashes, 20);  // 10 periods × 2 flashes
  assert.ok(strobe * dt < 1.3);
});

test('at a stand the runway lights stay off even if the caller says "on the runway" (paved)', () => {
  for (const gatePhase of ['parked', 'pushback', 'arrived']) {
    const l = lightsFor({ ...ground, gs: 0, enginesRunning: true, gatePhase, onRunway: true });
    assert.equal(l.strobe, 0, gatePhase);
    assert.equal(l.landing, 0, gatePhase);
  }
});
