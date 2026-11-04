// The type registry (V030.md, Part 1): a v0.2.2 save is the A321neo, a type round-trips through
// the snapshot and the prediction, and sim.setType() really changes the numbers. A mock second
// type (the A321's numbers with a heavier empty weight) stands in, so this doesn't lean on any
// real type's tuning.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as a321 from '../src/sim/a321neo.js';
import * as geo from '../src/geometry.js';
import { createSim } from '../src/sim/sim.js';
import { predictSync } from '../src/sim/predict-core.js';
import { TYPES, TYPE_LIST, typeById, DEFAULT_TYPE } from '../src/sim/types.js';

TYPES.mockliner = { ...TYPES.a321neo, id: 'mockliner', name: 'Mock', ready: false, data: { ...a321, ID: 'mockliner', OEW: a321.OEW + 8000 }, geo };
const KT = 0.514444, FT = 0.3048;
const air = (type) => {
  const sim = createSim({ type });
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 3000, iasMs: 250 * KT, flapLever: 0, gearDown: false, fuelKg: 6000, payloadKg: 12000, ap: { ap: true, athr: true, spdKt: 250, hdgDeg: 0, altFt: 9843 } });
  return sim;
};

test('the default type is the A321neo; an unknown id reads as it', () => {
  assert.equal(DEFAULT_TYPE, 'a321neo');
  assert.equal(createSim().type.id, 'a321neo');
  assert.equal(typeById('no-such-type').id, 'a321neo');
  assert.equal(typeById(undefined).id, 'a321neo');
});

test('a type that is not ready stays out of the picker', () => {
  assert.ok(!TYPE_LIST().some((t) => t.id === 'mockliner'));
  assert.ok(TYPE_LIST().some((t) => t.id === 'a321neo'));
});

test('a snapshot carries its type, and restoring it sets the type', () => {
  const a = air('mockliner');
  const snap = JSON.parse(JSON.stringify(a.snapshot()));
  assert.equal(snap.type, 'mockliner');
  const b = createSim();
  b.restore(snap);
  assert.equal(b.type.id, 'mockliner');
  assert.equal(b.state.type, 'mockliner');
  for (let i = 0; i < 1200; i++) { a.step(1 / 120); b.step(1 / 120); }
  assert.ok(Math.hypot(a.state.pos.x - b.state.pos.x, a.state.pos.y - b.state.pos.y, a.state.pos.z - b.state.pos.z) < 1e-6);
});

test('a save from before v0.3.0 (no type) loads as the A321neo, whatever the sim was', () => {
  const a = air('a321neo');
  const snap = JSON.parse(JSON.stringify(a.snapshot()));
  delete snap.type;
  const b = createSim({ type: 'mockliner' });
  b.restore(snap);
  assert.equal(b.type.id, 'a321neo');
  assert.equal(b.state.mass, a.state.mass);
});

test('the type changes the numbers, and setType keeps the sim\'s objects', () => {
  const sim = air('a321neo');
  const { ap, state, controls } = sim;
  const m0 = state.mass;
  sim.setType('mockliner');
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 3000, iasMs: 250 * KT, flapLever: 0, gearDown: false, fuelKg: 6000, payloadKg: 12000 });
  assert.equal(state.mass, m0 + 8000);
  assert.equal(sim.ap, ap); assert.equal(sim.state, state); assert.equal(sim.controls, controls);
  assert.equal(typeof ap.engageAp, 'function');
  sim.step(1 / 120);
  assert.equal(state.crashed, null);
});

test('the prediction flies the snapshot\'s type, and a jump lands on it', () => {
  const sim = air('mockliner');
  sim.controls.thrust = sim.leverClimb;
  const snap = sim.snapshot();
  const { samples } = predictSync(snap, { maxMinutes: 2 });
  assert.equal(samples[samples.length - 1].snap.type, 'mockliner');
  // The same flight in the same steps, flown by a plain sim of that type.
  const same = createSim({ type: 'mockliner' });
  same.restore(JSON.parse(JSON.stringify(snap)));
  const last = samples[samples.length - 1];
  while (same.state.t < last.t - 1e-9) same.step(1 / 30);
  assert.ok(Math.hypot(same.state.pos.x - last.x, same.state.pos.y - last.y, same.state.pos.z - last.z) < 1e-6);
  // And it isn't the A321's path: it's heavier.
  const other = { ...JSON.parse(JSON.stringify(snap)), type: 'a321neo' };
  const b = predictSync(other, { maxMinutes: 2 }).samples;
  assert.ok(Math.abs(b[b.length - 1].z - last.z) > 0.01);
});
