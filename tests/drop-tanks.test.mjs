// v0.5.4, item 5: a design's wing tanks dropped in flight (sim.dropTanks()). Their empty mass goes from where they
// hung, the fuel still in them (the centre tank's above the airframe's own, up to what they hold), their drag and their
// strike points; the hold tanks stay. In the core: a snapshot, a rewind and the prediction carry it. Only in the air,
// once, and only with wing tanks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { predictSync } from '../src/sim/predict-core.js';
import { newDesign, designDef, addPart } from '../src/sim/designs.js';

const KT = 0.514444, DT = 1 / 120;
const WING = { kind: 'tank', mount: 'wing', side: 1, s: 10, kg: 3000 }, HOLD = { kind: 'tank', mount: 'hold', x: 0, kg: 2500 };
const both = addPart(addPart(newDesign('a321neo'), WING), HOLD);   // two wing tanks (mirrored) and a hold tank
const holdOnly = addPart(newDesign('a321neo'), HOLD);
function cruising(design, { fuelKg, z = 3000, kt = 250, thrust = 0.7 } = {}) {
  const sim = createSim({ type: design });
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z, iasMs: kt * KT, flapLever: 0, gearDown: false, fuelKg: fuelKg ?? designDef(design).data.FUEL_MAX, payloadKg: 15000 });
  sim.controls.thrust = thrust;
  return sim;
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${what}: ${a} vs ${b}`);

test('the data: the wing tanks\' fuel, the airframe\'s own centre tank, the centre fuel\'s CG without them; pods\' drag marked', () => {
  const D = designDef(both).data, H = designDef(holdOnly).data;
  assert.equal(D.DROP_TANKS.kg, 6000);
  assert.equal(D.DROP_TANKS.centreOwnKg, H.FUEL_CENTER - 2500);
  assert.equal(D.DROP_TANKS.pm.length, 2);
  near(D.DROP_TANKS.pm[0].m, 300, 1e-12, 'an empty tank: 10 % of its fuel');
  near(D.DROP_TANKS.cgCentreX, H.CG_CENTER_FUEL_X, 1e-12, 'the centre fuel without them: the hold tank kept');
  assert.equal(D.DRAG_PARTS.filter((p) => p.pod).length, 2);
  assert.equal(H.DROP_TANKS, undefined);
  assert.equal(designDef(newDesign('a321neo')).data.DROP_TANKS, undefined);
});

test('dropping them: their mass and fuel go, the CG and inertias as without them; once only', () => {
  const sim = cruising(both), D = designDef(both).data;   // just reset in the air, so nothing burned yet
  const m0 = sim.massProps, f0 = sim.state.fuelKg, fc0 = sim.state.fuel.center, added0 = sim.state.fuelAddedKg;
  assert.equal(fc0, D.FUEL_CENTER, 'full');
  assert.equal(sim.state.tanksDropped, false);
  assert.equal(sim.dropTanks(), true);
  const m1 = sim.massProps;
  assert.equal(sim.state.tanksDropped, true);
  assert.equal(sim._core.tanksDropped, true);
  near(sim.state.fuelKg, f0 - 6000, 1e-12, 'their fuel');
  near(sim.state.fuel.center, fc0 - 6000, 1e-12, 'from the centre tank');
  near(sim.state.fuelAddedKg, added0 - 6000, 1e-12, 'taken off, not burned');
  near(m1.mass, m0.mass - 6000 - 600, 1e-12, 'fuel and empty tanks');
  near(sim.state.mass, m1.mass, 1e-12, 'the state');
  // the same as the design built without them, with the same fuel and load
  const ref = cruising(holdOnly, { fuelKg: sim.state.fuelKg });
  const m2 = ref.massProps;
  near(m1.mass, m2.mass, 1e-12, 'mass');
  near(m1.cgX, m2.cgX, 1e-9, 'CG');
  near(m1.Ixx, m2.Ixx, 1e-9, 'Ixx');
  near(m1.Iyy, m2.Iyy, 1e-6, 'Iyy');   // the other parts' terms are about the empty CG with the tanks: within 1e-6
  near(m1.Izz, m2.Izz, 1e-6, 'Izz');
  assert.ok(m1.Ixx < m0.Ixx - 1000, 'the roll inertia falls');
  // once
  const again = sim.massProps;
  assert.equal(sim.dropTanks(), false);
  assert.equal(sim.massProps.mass, again.mass);
  // the room they took goes with them
  sim.setLoad({ fuelKg: 1e9 });
  near(sim.state.fuelKg, D.FUEL_MAX - 6000, 1e-12, 'the most it takes now');
});

test('only the fuel still in them: part-filled tanks, or none left above the centre tank\'s own', () => {
  const D = designDef(both).data, own = D.DROP_TANKS.centreOwnKg, wings = 2 * D.FUEL_WING_EACH;
  for (const [fuel, gone] of [[wings + own + 4000, 4000], [wings + own, 0], [wings + 0.5 * own, 0], [wings + own + 8500, 6000]]) {
    const sim = cruising(both, { fuelKg: fuel });
    const f0 = sim.state.fuelKg, m0 = sim.massProps.mass;
    assert.equal(sim.dropTanks(), true);
    near(sim.state.fuelKg, f0 - gone, 1e-12, `fuel ${fuel}`);
    near(sim.massProps.mass, m0 - gone - 600, 1e-12, `mass ${fuel}`);
  }
});

test('their drag goes: it flies on as the design without them, and the tanks\' drag would have shown', () => {
  const a = cruising(both);
  for (let i = 0; i < 120; i++) a.step(DT);
  const kept = createSim(); kept.restore(JSON.parse(JSON.stringify(a.snapshot())));
  assert.equal(a.dropTanks(), true);
  // the same state flown by the design without the wing tanks
  const snap = JSON.parse(JSON.stringify(a.snapshot()));
  const plain = createSim(); plain.restore({ ...snap, design: designDef(holdOnly).design, core: { ...snap.core, tanksDropped: false } });
  near(plain.massProps.mass, a.massProps.mass, 1e-12, 'the same mass');
  // the copy that kept them, their fuel taken out: their drag (and their empty mass) still on
  kept._core.fuelC -= 6000;
  for (let i = 0; i < 1200; i++) { a.step(DT); plain.step(DT); kept.step(DT); }
  const dPlain = Math.abs(a.state.ias - plain.state.ias), dKept = kept.state.ias - a.state.ias;
  assert.ok(dPlain < 0.01, `as without them: ${dPlain} m/s`);
  assert.ok(dKept < -0.05, `with their drag it would be slower: ${dKept} m/s`);
});

test('a snapshot carries it: restore, a rewind before the drop, the prediction', () => {
  const a = cruising(both);
  for (let i = 0; i < 60; i++) a.step(DT);
  const before = JSON.parse(JSON.stringify(a.snapshot()));
  assert.equal(before.core.tanksDropped, false);
  a.dropTanks();
  for (let i = 0; i < 60; i++) a.step(DT);
  const snap = JSON.parse(JSON.stringify(a.snapshot()));
  assert.equal(snap.core.tanksDropped, true);
  const b = createSim(); b.restore(snap);
  assert.equal(b.state.tanksDropped, true);
  assert.equal(b.massProps.mass, a.massProps.mass);
  assert.equal(b.dropTanks(), false, 'already gone');
  for (let i = 0; i < 1200; i++) { a.step(DT); b.step(DT); }
  for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(a.state.pos[k] - b.state.pos[k]) < 1e-9, k);
  // a rewind to before the drop brings them back
  b.restore(before);
  assert.equal(b.state.tanksDropped, false);
  assert.ok(b.massProps.mass > a.massProps.mass + 6000);
  assert.equal(b.dropTanks(), true);
  // a save from before v0.5.4 (no field): not dropped
  const old = JSON.parse(JSON.stringify(before)); delete old.core.tanksDropped;
  const c = createSim(); c.restore(old);
  assert.equal(c._core.tanksDropped, false);
  // the prediction flies the dropped state
  const s2 = a.snapshot();
  const { samples } = predictSync(s2, { maxMinutes: 0.5 });
  const last = samples[samples.length - 1];
  const same = createSim(); same.restore(JSON.parse(JSON.stringify(s2)));
  while (same.state.t < last.t - 1e-9) same.step(1 / 30);
  assert.ok(Math.hypot(same.state.pos.x - last.x, same.state.pos.y - last.y, same.state.pos.z - last.z) < 1e-6);
});

test('false on the ground, with no wing tanks, or crashed; nothing changes', () => {
  const g = createSim({ type: both });
  g.reset({ x: 0, y: 0, hdg: 0, onGround: true, fuelKg: 20000, payloadKg: 15000 });
  g.step(DT);
  const m = g.massProps.mass;
  assert.equal(g.dropTanks(), false);
  assert.equal(g.massProps.mass, m);
  assert.equal(g.state.tanksDropped, false);
  assert.equal(cruising(holdOnly).dropTanks(), false, 'hold tanks only');
  assert.equal(cruising(newDesign('a321neo')).dropTanks(), false, 'no tanks');
  assert.equal(cruising('a321neo', { fuelKg: 10000 }).dropTanks(), false, 'a type');
  const c = cruising(both); c._core.crashed = 'test';
  assert.equal(c.dropTanks(), false, 'crashed');
});
