// v0.5.0, Part 1: the engines as a list in the sim's core. A snapshot carries the list and round-trips through JSON;
// a save from before v0.5.0 (the two engines by name: n1L, n1R, …) restores into it and flies on exactly as the sim
// it came from.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, ENGINE_FIELDS } from '../src/sim/sim.js';

const KT = 0.514444;
const OLD = { eN1: ['n1L', 'n1R'], eN1t: ['n1tL', 'n1tR'], eRev: ['revL', 'revR'], eThr: ['thrL', 'thrR'], eFf: ['ffL', 'ffR'] };

function flying(type) {
  const sim = createSim({ type });
  sim.reset({ x: 0, y: 0, hdg: 0.5, onGround: false, z: 3000, iasMs: 230 * KT, flapLever: 0, gearDown: false, fuelKg: 12000, payloadKg: 15000 });
  sim.controls.thrust = 0.7;
  for (let i = 0; i < 1200; i++) sim.step(1 / 120);
  return sim;
}
const flyOn = (sim, n) => { for (let i = 0; i < n; i++) { sim.controls.roll = i < 600 ? 0.2 : 0; sim.step(1 / 120); } return sim.state; };

for (const type of ['a321neo', 'b787-9', 'b777-300er']) {
  test(`${type}: the snapshot carries every engine, and a restored sim flies on to 1e-9`, () => {
    const a = flying(type);
    const snap = JSON.parse(JSON.stringify(a.snapshot()));
    for (const k of ENGINE_FIELDS) assert.equal(snap.core[k].length, 2, k);
    assert.equal(a.state.engines.length, 2);
    const b = createSim({ type: 'a321neo' });
    b.restore(snap);
    // The snapshot's arrays are its own: flying the restored sim doesn't change them.
    const n1Before = snap.core.eN1.slice();
    const sa = flyOn(a, 2400), sb = flyOn(b, 2400);
    assert.deepEqual(snap.core.eN1, n1Before);
    for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(sa.pos[k] - sb.pos[k]) < 1e-9, k);
    assert.ok(Math.abs(sa.engines[1].thrustN - sb.engines[1].thrustN) < 1e-9);
  });

  test(`${type}: a save from before v0.5.0 (n1L, n1R, …) restores into the list and flies on exactly`, () => {
    const a = flying(type);
    const snap = JSON.parse(JSON.stringify(a.snapshot()));
    for (const k of ENGINE_FIELDS) { OLD[k].forEach((o, i) => { snap.core[o] = snap.core[k][i]; }); delete snap.core[k]; }
    const b = createSim();
    b.restore(snap);
    for (const k of ENGINE_FIELDS) assert.ok(Array.isArray(b._core[k]) && b._core[k].length === 2, k);
    for (const o of Object.values(OLD).flat()) assert.ok(!(o in b._core), o);
    const sa = flyOn(a, 2400), sb = flyOn(b, 2400);
    for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(sa.pos[k] - sb.pos[k]) < 1e-9, k);
    assert.ok(Math.abs(sa.fuelKg - sb.fuelKg) < 1e-9);
    // and its new snapshot has the list, not the names
    const s2 = b.snapshot();
    assert.ok(!('n1L' in s2.core) && s2.core.eN1.length === 2);
  });
}

test('the reversers and the levers command every engine', () => {
  const sim = createSim({ type: 'b777-300er' });
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: true, flapLever: 4, fuelKg: 30000, payloadKg: 20000 });
  sim.controls.thrust = 1;
  for (let i = 0; i < 1200; i++) sim.step(1 / 120);
  const e = sim.state.engines;
  assert.ok(e[0].n1 > 90 && Math.abs(e[0].n1 - e[1].n1) < 1e-12);
  sim.controls.thrust = -1;
  for (let i = 0; i < 600; i++) sim.step(1 / 120);
  assert.ok(e[0].rev === 1 && e[1].rev === 1 && e[0].thrustN < 0 && e[1].thrustN < 0);
});
