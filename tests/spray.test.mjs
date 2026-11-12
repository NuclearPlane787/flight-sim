// v0.4.2: the wheels' spray (src/world/spray.js): how much a runway's state and the roll's speed make, and the mesh.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sprayAmount, createSpray } from '../src/world/spray.js';
import { typeById } from '../src/sim/types.js';

const KT = 0.514444;

test('spray: none dry, in the air or slow; more the wetter and faster', () => {
  assert.equal(sprayAmount('dry', 1, 120 * KT, true), 0);
  assert.equal(sprayAmount('wet', 1, 120 * KT, false), 0);
  assert.equal(sprayAmount('wet', 1, 15 * KT, true), 0);
  const light = sprayAmount('wet', 0.2, 120 * KT, true), heavy = sprayAmount('wet', 1, 120 * KT, true);
  assert.ok(light > 0.5 && heavy > light && heavy <= 1, `${light} ${heavy}`);
  assert.ok(sprayAmount('wet', 1, 50 * KT, true) < heavy, 'less at 50 kt');
  assert.ok(sprayAmount('snow', 0, 120 * KT, true) > 0.5 && sprayAmount('ice', 0, 120 * KT, true) < 0.2);
});

test('spray: a sprite cloud per leg, shown only when there is spray', () => {
  const s = createSpray(typeById('b777-300er').geo.GEAR);
  assert.equal(s.object.geometry.instanceCount, 3 * 140);
  s.update({ gs: 120 * KT, onGround: true, runway: 'dry' });
  assert.equal(s.object.visible, false);
  s.update({ gs: 120 * KT, onGround: true, runway: 'wet', rain: 0.8, dt: 0.016 });
  assert.equal(s.object.visible, true);
});
