// v0.8.0, the failure model (src/sim/failures.js and the sim's core): the plan is the world's and the state the
// aircraft's, so a run with a snapshot taken and restored in the middle equals a straight run for every kind, a
// rewind to before a fired failure fires it again at its moment, a save's JSON carries both, a hidden failure is
// absent from the predictor's snapshot and a jump past it ends before it, and a save from before v0.8.0 loads with
// nothing failed. Then the engines (part 5): a flameout, a seizure, a fire and its bottles, the switch and the
// start envelope, the asymmetry with one engine out of two and two out of six.
//   node --test tests/v080-failures.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { predictSync } from '../src/sim/predict-core.js';
import { newDesign } from '../src/sim/designs.js';
import {
  KINDS, MOMENTS, armed, armedRandom, without, visiblePlan, snapshotForPrediction, jumpIndex, normalizePlan, fireNeeds, rand01,
  momentNow, startBlock, RELIGHT, DEAD_ENGINE, FIRE_ODDS, E_FIRE, E_PUSHED, E_FIRE_OUT, E_SEIZED, E_FLAMEOUT, G_NOEXT, G_GRAV, L_GONE, describe,
} from '../src/sim/failures.js';
import { airborne, onRunway, run, approachPilot, KT, FT, DEG, DT } from './sim-helpers.mjs';

const viaJson = (o) => JSON.parse(JSON.stringify(o));
const cruiser = (o = {}) => {
  const sim = airborne({ massKg: 72000, fuelKg: 9000, altFt: 9000, iasKt: 250, ap: { ap: true, athr: true, hdgDeg: 0, altFt: o.altFt || 9000 }, ...o });
  sim.ap.setSpd(o.iasKt || 250);
  return sim;
};
const arm = (sim, kind, target, when = { type: 'now' }, seed = 4242) => sim.setFailures(armed(sim.failures, { kind, target, when }, sim.state.t, seed));
const core = (sim) => viaJson(sim.snapshot().core);

// ---- the plan (pure) ----

test('the plan: armed() numbers the items, never changes a plan in place, and normalizePlan() round-trips JSON', () => {
  const p1 = armed(null, { kind: 'eng-fire', target: 1, when: { type: 'now' } }, 100, 7);
  const p2 = armed(p1, { kind: 'gear-collapse', target: 2, when: { type: 'moment', moment: 'final500' } }, 100, 8);
  const p3 = armed(p2, { kind: 'gear-noext', target: 5, when: { type: 'after', seconds: 90 } }, 100, 9);
  assert.equal(p1.items.length, 1, 'the first plan is untouched');
  assert.deepEqual(p3.items.map((i) => i.id), [1, 2, 3]);
  assert.equal(p3.items[0].at, 100); assert.equal(p3.items[1].moment, 'final500'); assert.equal(p3.items[2].at, 190);
  assert.equal(p3.items[2].target, 0, 'a whole-gear failure has no target');
  assert.deepEqual(normalizePlan(viaJson(p3)), p3);
  assert.equal(without(without(without(p3, 1), 2), 3), null, 'an empty plan is null');
  assert.equal(normalizePlan({ items: [{ id: 1, kind: 'nonsense', at: 0 }] }), null);
  assert.throws(() => armed(null, { kind: 'nope' }, 0, 1));
  for (const k in KINDS) assert.ok(describe({ kind: k, target: 0 }).length > 5, k);
});

test('a random failure is drawn from its seed when armed, the same every time, and is hidden', () => {
  const kinds = Object.keys(KINDS).filter((k) => KINDS[k].random);
  const a = armedRandom(null, { kinds, windowS: 600, nEngines: 2 }, 1000, 31337), b = armedRandom(null, { kinds, windowS: 600, nEngines: 2 }, 1000, 31337);
  assert.deepEqual(a, b);
  const it = a.items[0];
  assert.equal(it.hidden, true); assert.deepEqual(it.win, [1000, 1600]);
  assert.ok(it.at >= 1000 && it.at < 1600 && kinds.includes(it.kind));
  // Over many seeds every ticked kind comes up, on every engine of four, and the times fill the window.
  const seen = new Set(), eng = new Set(); let lo = Infinity, hi = -Infinity;
  for (let s = 1; s <= 400; s++) {
    const i = armedRandom(null, { kinds, windowS: 600, nEngines: 4 }, 0, s).items[0];
    seen.add(i.kind); if (KINDS[i.kind].target === 'engine') eng.add(i.target); lo = Math.min(lo, i.at); hi = Math.max(hi, i.at);
  }
  assert.equal(seen.size, kinds.length); assert.equal(eng.size, 4); assert.ok(lo < 30 && hi > 570, `${lo} to ${hi}`);
  assert.equal(visiblePlan(a), null, 'nothing of it for the predictor');
  const mixed = armed(a, { kind: 'eng-fire', target: 0 }, 1000, 1);
  assert.deepEqual(visiblePlan(mixed).items.map((i) => i.id), [2]);
  assert.equal(visiblePlan(mixed, [1]), mixed, 'once it has fired it is no secret: the same plan back');
});

test('an engine fire\'s odds by seed: about 70 % out with the first bottle, 22 % with the second, 8 % with neither', () => {
  const n = [0, 0, 0, 0];
  for (let s = 1; s <= 4000; s++) n[fireNeeds(s)]++;
  assert.ok(Math.abs(n[1] / 4000 - FIRE_ODDS[0]) < 0.03, `first ${n[1]}`);
  assert.ok(Math.abs(n[2] / 4000 - (FIRE_ODDS[1] - FIRE_ODDS[0])) < 0.03, `second ${n[2]}`);
  assert.ok(Math.abs(n[3] / 4000 - (1 - FIRE_ODDS[1])) < 0.02, `neither ${n[3]}`);
  assert.equal(fireNeeds(77), fireNeeds(77));
  assert.ok(rand01(5, 1) !== rand01(5, 2) && rand01(5, 1) >= 0 && rand01(5, 1) < 1);
});

test('the moments read the flight: each is true where it says and false elsewhere', () => {
  const m = { ias: 0, onGround: true, wowNose: true, wowMain: true, agl: 0, alt: 0, vs: 0, lever: 0, airTime: 0, everAirborne: false };
  const at = (o) => ({ ...m, ...o });
  for (const k in MOMENTS) assert.equal(momentNow(k, m), false, `${k} at the gate`);
  assert.ok(momentNow('roll100', at({ ias: 101 * KT, lever: 1 })));
  assert.ok(!momentNow('roll100', at({ ias: 120 * KT, lever: 0 })), 'a landing roll is not the take-off roll');
  assert.ok(momentNow('rotate', at({ ias: 140 * KT, lever: 1, wowNose: false })));
  const air = { onGround: false, wowNose: false, wowMain: false, everAirborne: true };
  assert.ok(momentNow('liftoff', at({ ...air, airTime: 4, agl: 30, vs: 8, lever: 1 })));
  assert.ok(momentNow('climb10k', at({ ...air, airTime: 300, alt: 10050 * FT, vs: 9 })));
  assert.ok(!momentNow('climb10k', at({ ...air, airTime: 300, alt: 10050 * FT, vs: -9 })), 'descending through it');
  assert.ok(momentNow('cruise', at({ ...air, airTime: 900, alt: 35000 * FT, vs: 0.2 })));
  assert.ok(momentNow('app3000', at({ ...air, airTime: 900, agl: 2500 * FT, alt: 2600 * FT, vs: -4 })));
  assert.ok(momentNow('final500', at({ ...air, airTime: 900, agl: 400 * FT, alt: 450 * FT, vs: -3.5 })));
  assert.ok(!momentNow('final500', at({ ...air, airTime: 4, agl: 400 * FT, vs: 9, lever: 1 })), 'the climb-out is not short final');
});

// ---- the sim: the plan is the world's, the state the aircraft's ----

const EACH = [['eng-flameout', 0], ['eng-seize', 1], ['eng-fire', 0], ['gear-noext', 0], ['gear-nograv', 0], ['gear-nolock', 1], ['gear-collapse', 2],
  // v0.8.0 (part 7): the hydraulics and the flaps
  ['hyd-pump', 0], ['hyd-elec', 1], ['hyd-sys', 0], ['flaps-jam', 0], ['slats-jam', 0]];
for (const [kind, target] of EACH) {
  test(`${kind} set for a time: a run with a snapshot taken and restored in the middle equals the straight run, sample for sample`, () => {
    // The pilot of both: the gear selected down at 30 s, the gravity extension at 45 s, an engine's switch and fire handle on the way.
    const pilot = (sim) => {
      const t = sim.state.t;
      if (t >= 30) sim.controls.gearDown = true;
      if (t >= 45 && !(sim.state.gearSys & G_GRAV) && sim.state.gearSys & G_NOEXT) sim.gravityGear();
      if (kind === 'eng-fire' && t >= 35 && !sim.state.engines[0].pushed) { sim.engineSwitch(0, false); sim.firePush(0); sim.fireAgent(0); }
      if (kind === 'eng-flameout' && t >= 35 && t < 36) sim.engineSwitch(0, false);
      if (kind === 'eng-flameout' && t >= 40) sim.engineSwitch(0, true);
    };
    const mk = () => { const s = cruiser(); s.setFailures(armed(null, { kind, target, when: { type: 'after', seconds: 20 } }, 0, 99)); return s; };
    const a = mk(), b0 = mk();
    const A = [], B = [];
    const sample = (sim, out) => out.push(viaJson({ t: sim.state.t, pos: sim.state.pos, hdg: sim.state.hdg, pitch: sim.state.pitch, roll: sim.state.roll, ias: sim.state.ias, core: sim.snapshot().core }));
    for (let i = 0; i < 80; i++) { run(a, 1, pilot); sample(a, A); }
    for (let i = 0; i < 10; i++) { run(b0, 1, pilot); sample(b0, B); }
    const snap = viaJson(b0.snapshot());
    const b = createSim(); b.restore(snap);
    assert.deepEqual(b.failures, a.failures, 'the plan came through the save');
    for (let i = 10; i < 80; i++) { run(b, 1, pilot); sample(b, B); }
    assert.ok(a.state.failures.some((f) => f.kind === kind), 'it fired');
    assert.ok(Math.abs(a.state.failures[0].t - 20) < 2 * DT, `at its time (${a.state.failures[0].t})`);
    for (let i = 0; i < 80; i++) assert.deepEqual(B[i], A[i], `sample ${i + 1} s`);
  });
}

test('a rewind to before a fired failure fires it again at its moment; a repair takes it out of the plan for good', () => {
  const sim = cruiser();
  arm(sim, 'eng-flameout', 1, { type: 'after', seconds: 20 });
  run(sim, 10);
  const snap = sim.snapshot();
  run(sim, 20);
  assert.equal(sim.state.failures.length, 1); assert.equal(sim.state.engines[1].lit, false);
  const tFired = sim.state.failures[0].t;
  // The rewind (main.js's rewindNow()): the core goes back, the plan armed now stays.
  sim.restore(snap, { keepWeather: true });
  assert.equal(sim.state.failures.length, 0); assert.equal(sim.state.engines[1].lit, true);
  assert.equal(sim.failures.items.length, 1, 'still armed');
  run(sim, 20);
  assert.equal(sim.state.failures.length, 1);
  assert.equal(sim.state.failures[0].t, tFired, 'at the same step');
  // Repaired: gone from the state and from the plan, so the next rewind doesn't bring it back.
  assert.equal(sim.repair(sim.state.failures[0].id), true);
  assert.equal(sim.state.failures.length, 0); assert.equal(sim.failures, null);
  sim.restore(snap, { keepWeather: true });
  run(sim, 30);
  assert.equal(sim.state.failures.length, 0); assert.equal(sim.state.engines[1].lit, true);
  // A scenario's load (no keepWeather) takes the save's plan instead: the save was made with it armed.
  sim.restore(snap);
  assert.equal(sim.failures.items.length, 1);
});

test('a save\'s JSON round-trips the plan and the state, and the restored sim flies on identically', () => {
  const a = cruiser();
  arm(a, 'eng-fire', 0, { type: 'now' }, 3);
  arm(a, 'gear-collapse', 1, { type: 'moment', moment: 'final500' }, 4);
  a.setFailures(armedRandom(a.failures, { kinds: ['eng-seize'], windowS: 900, nEngines: 2 }, a.state.t, 5));
  run(a, 5);
  a.engineSwitch(0, false); a.firePush(0); a.fireAgent(0);
  run(a, 5);
  const snap = viaJson(a.snapshot());
  assert.equal(snap.failures.items.length, 3);
  assert.deepEqual(snap.core.fDone, [1]); assert.equal(snap.core.fActive[0].kind, 'eng-fire'); assert.equal(snap.core.eAg[0], 1);
  const b = createSim(); b.restore(snap);
  assert.deepEqual(viaJson(b.snapshot()), snap);
  assert.deepEqual(b.failures, a.failures); assert.deepEqual(viaJson(b.state.failures), viaJson(a.state.failures));
  run(a, 60); run(b, 60);
  assert.deepEqual(viaJson(b.snapshot()), viaJson(a.snapshot()));
});

test('a hidden failure is absent from the predictor\'s snapshot, the predicted path doesn\'t show it, and a jump past its moment ends before it', () => {
  const sim = cruiser();
  sim.setFailures(armedRandom(null, { kinds: ['eng-seize'], windowS: 300, nEngines: 2 }, sim.state.t, 2024));
  arm(sim, 'eng-flameout', 0, { type: 'after', seconds: 400 });
  const tHidden = sim.failures.items[0].at;
  const snap = sim.snapshot();
  const ps = snapshotForPrediction(snap);
  assert.notEqual(ps, snap);
  assert.deepEqual(ps.failures.items.map((i) => i.kind), ['eng-flameout'], 'the armed one that is no secret stays');
  assert.equal(snap.failures.items.length, 2, 'the live snapshot keeps both');
  const pred = predictSync(ps, { maxMinutes: 9 });
  const after = pred.samples.filter((s) => s.t > tHidden + 10 && s.t < 395);
  assert.ok(after.length > 5 && after.every((s) => s.snap.core.fActive.length === 0), 'no seizure on the predicted path');
  assert.ok(pred.samples[pred.samples.length - 1].snap.core.fActive.some((f) => f.kind === 'eng-flameout'), 'the flameout at 400 s is on it');
  // The jump: a target past the hidden failure's time ends at the last sample before it.
  const far = pred.samples.length - 1;
  const j = jumpIndex(sim.failures, sim._core.fDone, pred.samples, far);
  assert.ok(j < far && pred.samples[j].t <= tHidden && pred.samples[j + 1].t > tHidden, `ends at ${pred.samples[j].t} before ${tHidden}`);
  assert.equal(jumpIndex(sim.failures, sim._core.fDone, pred.samples, 2), 2, 'a target before it is its own');
  // And the failure fires there: restore that sample keeping the plan armed now, fly on.
  sim.restore(pred.samples[j].snap, { keepWeather: true });
  assert.equal(sim.failures.items.length, 2);
  run(sim, tHidden - sim.state.t + 1);
  assert.ok(sim.state.failures.some((f) => f.kind === 'eng-seize'), 'the hidden failure fired after the jump');
  // With nothing hidden the snapshot is the same object (no copy a request).
  const plain = cruiser(); arm(plain, 'eng-fire', 0);
  const s2 = plain.snapshot();
  assert.equal(snapshotForPrediction(s2), s2);
});

test('a save from before v0.8.0 (no failure fields, no plan) loads with nothing failed and flies as a new one', () => {
  const a = cruiser();
  run(a, 20);
  const old = viaJson(a.snapshot());
  for (const k of ['fDone', 'fActive', 'gOn', 'gSys', 'eSw', 'eLit', 'eSt', 'eFl', 'eAg', 'eAgT', 'eNeed', 'gLeg', 'gFl', 'gColT']) { assert.ok(k in old.core, k); delete old.core[k]; }
  assert.ok(!('failures' in old), 'with nothing armed a snapshot has no plan');
  const b = createSim(); b.restore(old);
  assert.equal(b.failures, null); assert.equal(b.state.failures.length, 0);
  assert.ok(b.state.engines.every((e) => e.sw && e.lit && !e.fire && e.block === ''));
  assert.deepEqual(b.state.gearLegs, [0, 0, 0]); assert.equal(b.state.gearSys, 0);
  run(a, 60); run(b, 60);
  assert.deepEqual(viaJson(b.snapshot()), viaJson(a.snapshot()));
});

test('with nothing armed the new state never moves: every failure field is as a fresh core\'s after a flight', () => {
  const sim = cruiser();
  const before = core(sim);
  run(sim, 30, (s) => { if (s.state.t > 10) s.controls.gearDown = true; });
  const after = core(sim);
  for (const k of ['fDone', 'fActive', 'gOn', 'gSys', 'eSw', 'eLit', 'eSt', 'eFl', 'eAg', 'eAgT', 'eNeed', 'gFl', 'gColT']) assert.deepEqual(after[k], before[k], k);
  assert.equal(sim.state.gearPos, 1); assert.deepEqual(sim.state.gearLegs, [1, 1, 1]);
});

test('a moment: an engine failure on the take-off roll above 100 kt fires there, and at rotation at rotation', () => {
  const pilot = (sim) => { const s = sim.state, c = sim.controls; c.thrust = 1; c.pitch = s.ias > 145 * KT ? (s.pitch < 12 * DEG ? 0.6 : 0) : 0; };
  const a = onRunway({ massKg: 78000 });
  arm(a, 'eng-flameout', 1, { type: 'moment', moment: 'roll100' });
  run(a, 60, (s) => { pilot(s); return s.state.failures.length > 0; });
  assert.equal(a.state.failures.length, 1);
  assert.ok(a.state.ias >= 100 * KT && a.state.ias < 103 * KT && a.state.onGround, `fired at ${(a.state.ias / KT).toFixed(1)} kt on the ground`);
  const b = onRunway({ massKg: 78000 });
  arm(b, 'eng-fire', 0, { type: 'moment', moment: 'rotate' });
  run(b, 60, (s) => { pilot(s); return s.state.failures.length > 0; });
  assert.equal(b.state.failures.length, 1);
  assert.ok(b.state.ias > 140 * KT && !b.state.wow.nose && (b.state.wow.left || b.state.wow.right), `the nose wheel up at ${(b.state.ias / KT).toFixed(1)} kt`);
});

// ---- part 5: the engines ----

test('a flameout: N1 falls to the windmill\'s, no thrust but its drag, no fuel flow; the other engine carries on and the asymmetry is the pilot\'s', () => {
  const sim = cruiser();
  run(sim, 10);
  const before = sim.state.engines.map((e) => ({ ...e }));
  arm(sim, 'eng-flameout', 1);
  run(sim, 40);
  const [e1, e2] = sim.state.engines;
  assert.equal(e2.lit, false); assert.ok(e2.flags & E_FLAMEOUT);
  const wm = 4 + 20 * sim.state.mach;
  assert.ok(Math.abs(e2.n1 - wm) < 1.5, `N1 ${e2.n1.toFixed(1)} at the windmill's ${wm.toFixed(1)}`);
  assert.equal(e2.ffKgS, 0);
  assert.ok(e2.thrustN < -1500 && e2.thrustN > -8000, `its drag ${e2.thrustN.toFixed(0)} N`);
  assert.ok(e1.lit && e1.n1 > before[0].n1 + 5, `the A/THR asks the live engine for more (${before[0].n1.toFixed(1)} to ${e1.n1.toFixed(1)})`);
  assert.equal(e2.block, 'cycle', 'its switch must go off and on again');
  assert.equal(sim.state.fuelFlowKgS, e1.ffKgS);
});

test('a seizure: N1 to 0 within seconds, no windmilling, more drag than a windmilling engine, and no restart', () => {
  const a = cruiser(), b = cruiser();
  run(a, 10); run(b, 10);
  arm(a, 'eng-seize', 0); arm(b, 'eng-flameout', 0);
  run(a, 5); run(b, 5);
  assert.equal(a.state.engines[0].n1, 0, 'stopped inside 5 s');
  assert.ok(a.state.engines[0].flags & E_SEIZED);
  run(a, 25); run(b, 25);
  assert.equal(a.state.engines[0].n1, 0);
  assert.ok(a.state.engines[0].thrustN < 2 * b.state.engines[0].thrustN, `${a.state.engines[0].thrustN.toFixed(0)} N against the windmill's ${b.state.engines[0].thrustN.toFixed(0)} N`);
  a.engineSwitch(0, false); a.engineSwitch(0, true);
  run(a, 90);
  assert.equal(a.state.engines[0].lit, false); assert.equal(a.state.engines[0].block, 'seized'); assert.equal(a.state.engines[0].start, 0);
  // Repaired, it starts by its switch (on already): about 45 s with the starter's help at 250 kt.
  a.repair('all');
  assert.equal(a.state.engines[0].block, '');
  run(a, 60);
  assert.equal(a.state.engines[0].lit, true);
});

test('a fire: the engine runs until it is shut down; the handle arms the bottles; the fire is out by its seed\'s odds or stays a warning', () => {
  const seedFor = (need) => { for (let s = 1; s < 500; s++) if (fireNeeds(s) === need) return s; };
  // Out with the first bottle.
  const a = cruiser(); run(a, 5);
  arm(a, 'eng-fire', 0, { type: 'now' }, seedFor(1));
  run(a, 20);
  const e = a.state.engines[0];
  assert.ok(e.fire && e.lit && e.n1 > 40, 'burning, and still running');
  assert.equal(a.fireAgent(0), false, 'no bottle before the fire handle');
  assert.equal(a.engineSwitch(0, false), true);
  assert.equal(a.firePush(0), true); assert.equal(a.firePush(0), false);
  assert.ok(e.pushed && !e.lit);
  assert.equal(a.fireAgent(0), true);
  run(a, DEAD_ENGINE.fireOutS - 1); assert.ok(e.fire, 'still burning a second before');
  run(a, 2);
  assert.ok(!e.fire && e.flags & E_FIRE_OUT, 'out');
  assert.ok(a.events.some((v) => v.type === 'fireOut'));
  a.engineSwitch(0, true); run(a, 80);
  assert.equal(e.lit, false); assert.equal(e.block, 'fire', 'its fire handle is out: no restart');
  // Needs both.
  const b = cruiser(); run(b, 5);
  arm(b, 'eng-fire', 1, { type: 'now' }, seedFor(2));
  run(b, 3); b.engineSwitch(1, false); b.firePush(1); b.fireAgent(1);
  run(b, 35); assert.ok(b.state.engines[1].fire, 'still burning 35 s after the first bottle');
  assert.equal(b.fireAgent(1), true); assert.equal(b.fireAgent(1), false, 'two bottles an engine');
  run(b, DEAD_ENGINE.fireOutS + 1); assert.ok(!b.state.engines[1].fire);
  // Neither puts it out: it stays a warning.
  const c = cruiser(); run(c, 5);
  arm(c, 'eng-fire', 0, { type: 'now' }, seedFor(3));
  run(c, 3); c.engineSwitch(0, false); c.firePush(0); c.fireAgent(0); run(c, 31); c.fireAgent(0);
  run(c, 300);
  assert.ok(c.state.engines[0].fire && c.state.engines[0].agents === 2);
  assert.equal(c.state.crashed, null, 'no damage from it in v0.8.0');
  c.repair('all');
  assert.ok(!c.state.engines[0].fire && !c.state.engines[0].pushed && c.state.engines[0].agents === 0);
});

test('the switch: off cuts the engine, on relights it inside the envelope in 30 to 50 s and not outside it, with the reason', () => {
  // Inside, fast enough to windmill: about 30 s.
  const a = cruiser({ altFt: 15000, iasKt: 280 }); run(a, 5);
  assert.equal(a.engineSwitch(1), true);
  assert.equal(a.state.engines[1].sw, false); assert.equal(a.state.engines[1].lit, false);
  run(a, 20);
  assert.ok(a.state.engines[1].n1 < 25 && a.state.engines[1].ffKgS === 0);
  assert.equal(a.engineSwitch(1), true);
  let t = 0;
  while (!a.state.engines[1].lit && t < 120) { run(a, 1); t++; if (t === 10) assert.ok(a.state.engines[1].start > 5 && a.state.engines[1].startS === RELIGHT.airbus.windmillS); }
  assert.ok(t >= 28 && t <= 32, `lit after ${t} s`);
  assert.ok(a.events.some((v) => v.type === 'engineStart' && v.engine === 1));
  run(a, 30);
  assert.ok(a.state.engines[1].thrustN > 0 && Math.abs(a.state.engines[1].n1 - a.state.engines[0].n1) < 3, 'back with the other engine');
  // Slower, low down: the starter helps, about 45 s.
  const b = cruiser({ altFt: 9000, iasKt: 220 }); run(b, 5);
  b.engineSwitch(0, false); run(b, 10); b.engineSwitch(0, true);
  t = 0; while (!b.state.engines[0].lit && t < 120) { run(b, 1); t++; }
  assert.ok(t >= 43 && t <= 47, `lit after ${t} s`);
  // Above the envelope: no start, and the reason.
  const c = airborne({ massKg: 68000, fuelKg: 9000, altFt: 35000, mach: 0.78, ap: { ap: true, athr: true, hdgDeg: 0, altFt: 35000 } }); run(c, 5);
  c.engineSwitch(0, false); run(c, 5); c.engineSwitch(0, true); run(c, 90);
  assert.equal(c.state.engines[0].lit, false); assert.equal(c.state.engines[0].block, 'altitude'); assert.equal(c.state.engines[0].start, 0);
  // Too slow to windmill, too high for the starter.
  assert.equal(startBlock({ flags: 0, off: false, fuelKg: 1, altFt: 24000, iasKt: 230, onGround: false }, RELIGHT.airbus), 'speed');
  assert.equal(startBlock({ flags: 0, off: false, fuelKg: 1, altFt: 24000, iasKt: 265, onGround: false }, RELIGHT.airbus), '');
  assert.equal(startBlock({ flags: 0, off: false, fuelKg: 0, altFt: 5000, iasKt: 250, onGround: false }, RELIGHT.airbus), 'fuel');
  assert.equal(startBlock({ flags: 0, off: true, fuelKg: 1, altFt: 5000, iasKt: 250, onGround: false }, RELIGHT.airbus), 'gone');
});

test('on the ground: an engine cut by its switch runs down to a stop and starts again in about a minute', () => {
  const sim = onRunway({ massKg: 70000 });
  sim.controls.parkingBrake = true;
  run(sim, 2);
  sim.engineSwitch(0, false); sim.engineSwitch(1, false);
  run(sim, 40);
  assert.ok(sim.state.engines.every((e) => !e.lit && e.n1 < 1 && e.thrustN === 0 || Math.abs(e.thrustN) < 1), 'both stopped');
  sim.engineSwitch(1, true);
  let t = 0; while (!sim.state.engines[1].lit && t < 200) { run(sim, 1); t++; }
  assert.ok(t >= 58 && t <= 62, `engine 2 lit after ${t} s`);
  run(sim, 20);
  assert.ok(Math.abs(sim.state.engines[1].n1 - sim.state.n1Idle) < 1.5, `at idle (${sim.state.engines[1].n1.toFixed(1)})`);
  assert.equal(sim.state.engines[0].lit, false);
});

test('one engine out of two under the autopilot and A/THR: the flight goes on, the dead side\'s yaw is left to the pilot\'s feet', () => {
  const sim = cruiser({ altFt: 8000, iasKt: 230 });
  run(sim, 20);
  arm(sim, 'eng-flameout', 1);
  run(sim, 90);
  assert.equal(sim.state.crashed, null);
  assert.ok(Math.abs(sim.state.pos.z - 8000 * FT) < 150, `the altitude held (${(sim.state.pos.z / FT).toFixed(0)} ft)`);
  assert.ok(Math.abs(sim.state.ias / KT - 230) < 12, `the speed held (${(sim.state.ias / KT).toFixed(0)} kt)`);
  assert.ok(Math.abs(sim.state.beta) > 0.2 * DEG || Math.abs(sim.state.roll) > 0.5 * DEG, 'it flies with a sideslip or a bank: nobody trims the yaw away');
});

test('two engines out of a design\'s six: the four left fly it, each failed one windmilling with its own drag', () => {
  const design = newDesign('b777-300er', { id: 'v080-six', count: 6 });
  const sim = createSim({ type: design });
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 8000 * FT, iasMs: 250 * KT, fuelKg: 60000, payloadKg: 30000, ap: { ap: true, athr: true, hdgDeg: 0, altFt: 8000 } });
  sim.ap.setSpd(250);
  assert.equal(sim.state.engines.length, 6);
  run(sim, 20);
  arm(sim, 'eng-flameout', 0); arm(sim, 'eng-seize', 5);
  run(sim, 60);
  const E = sim.state.engines;
  assert.ok(!E[0].lit && !E[5].lit && [1, 2, 3, 4].every((i) => E[i].lit && E[i].thrustN > 0));
  assert.ok(E[0].thrustN < 0 && E[5].thrustN < E[0].thrustN && E[5].n1 === 0);
  assert.equal(sim.state.crashed, null);
  assert.ok(Math.abs(sim.state.pos.z - 8000 * FT) < 200 && Math.abs(sim.state.ias / KT - 250) < 15, `${(sim.state.pos.z / FT).toFixed(0)} ft, ${(sim.state.ias / KT).toFixed(0)} kt`);
  // A failure aimed at an engine this aircraft doesn't have does nothing.
  const two = cruiser(); arm(two, 'eng-fire', 5); run(two, 2);
  assert.equal(two.state.failures.length, 0); assert.ok(two.state.engines.every((e) => !e.fire));
  assert.equal(two.failures, null, 'and it leaves the plan');
});

test('a skip to final (reset with keepFailures) keeps what has failed and what is armed, on the clock that starts again', () => {
  const sim = cruiser();
  arm(sim, 'eng-flameout', 1);
  arm(sim, 'eng-fire', 0, { type: 'after', seconds: 100 }, 5);
  arm(sim, 'gear-nolock', 2);
  arm(sim, 'gear-collapse', 1, { type: 'moment', moment: 'final500' });
  run(sim, 40);
  assert.equal(sim.state.failures.length, 2);
  const ic = { x: 0, y: 0, hdg: 0, onGround: false, z: 900, iasMs: 180 * KT, flapLever: 1, gearDown: false, fuelKg: 6000, payloadKg: 12000 };
  sim.reset({ ...ic, keepFailures: true });
  assert.ok(sim.state.t < 1e-9);
  assert.deepEqual(sim.state.failures.map((f) => f.kind), ['eng-flameout', 'gear-nolock']);
  assert.ok(Math.abs(sim.state.failures[0].t + 40) < 0.02, 'it failed 40 s before this clock began');
  assert.equal(sim.state.engines[1].lit, false); assert.equal(sim.state.engines[0].lit, true);
  assert.ok(Math.abs(sim.failures.items.find((i) => i.kind === 'eng-fire').at - 60) < 0.02, 'the fire is still 60 s away');
  sim.controls.gearDown = true;
  run(sim, 62);
  assert.ok(sim.state.engines[0].fire, 'and it comes');
  assert.deepEqual(sim.state.gearLegs.map((v) => Math.round(v)), [1, 1, 0], 'the right main leg still won\'t lock');
  assert.equal(sim.state.failures.length, 3);
  // Without the flag a reset is a sound aircraft, and nothing armed fires while it settles on the ground.
  sim.setFailures(armed(null, { kind: 'eng-seize', target: 0 }, 0, 1));
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: true, fuelKg: 6000, payloadKg: 12000 });
  assert.equal(sim.state.failures.length, 0); assert.ok(sim.state.engines.every((e) => e.lit && !e.fire));
  assert.equal(sim.failures.items.length, 1, 'the plan is the caller\'s to clear');
});

test('an id is never used twice in a flight: a failure armed after a repair fires, also after a rewind to while the first stood (the 777\'s check in Chrome, then the code review)', () => {
  const sim = cruiser();
  arm(sim, 'eng-flameout', 0, { type: 'after', seconds: 2 });
  run(sim, 3);
  const snapA = sim.snapshot();   // while A stands
  assert.equal(sim.state.failures.length, 1);
  const idA = sim.state.failures[0].id;
  sim.repair('all');
  assert.equal(sim.failures, null);
  // The plan is empty again, so armed() numbers from 1 again; the sim gives the new item an id of its own.
  sim.setFailures(armedRandom(sim.failures, { kinds: ['gear-noext'], windowS: 10, nEngines: 2 }, sim.state.t, 77));
  const idB = sim.failures.items[0].id;
  assert.notEqual(idB, idA);
  run(sim, 11);
  assert.deepEqual(sim.state.failures.map((f) => f.kind), ['gear-noext'], 'it fired inside its window');
  // The rewind to while A stood: A is back (its item left the plan with its repair, so it stays as it was), B is
  // armed and not yet fired, and fires again; repairing A then leaves B alone.
  sim.restore(snapA, { keepWeather: true });
  assert.deepEqual(sim.state.failures.map((f) => f.kind), ['eng-flameout']);
  assert.equal(sim.failures.items.length, 1);
  assert.equal(sim.repair(idA), true);
  assert.equal(sim.failures.items.length, 1, 'B is still armed');
  run(sim, 20);
  assert.deepEqual(sim.state.failures.map((f) => f.kind), ['gear-noext'], 'and B fires after the rewind too');
  // A save and its load keep the ids apart as well.
  const b = createSim(); b.restore(viaJson(sim.snapshot()));
  b.setFailures(armed(b.failures, { kind: 'eng-fire', target: 0, when: { type: 'after', seconds: 1 } }, b.state.t, 5));
  assert.equal(new Set(b.failures.items.map((i) => i.id)).size, b.failures.items.length);
  run(b, 2);
  assert.ok(b.state.engines[0].fire && b.state.failures.length === 2, 'both stand');
});

test('a repair leaves no latch behind: a seized engine whose fire handle was pushed runs again, and a gravity extension is reset with the last gear failure (the code review)', () => {
  const sim = cruiser();
  arm(sim, 'eng-seize', 0);
  run(sim, 2);
  sim.engineSwitch(0, false); sim.firePush(0);
  assert.equal(sim.repair(sim.state.failures[0].id), true);
  assert.ok(!sim.state.engines[0].pushed, 'the fire handle is in again');
  sim.engineSwitch(0, true);
  run(sim, 60);
  assert.equal(sim.state.engines[0].lit, true, 'and the engine starts by its switch');
  // A fire handle on an engine whose fire still burns stays out when its flameout is repaired.
  arm(sim, 'eng-fire', 1, { type: 'now' }, 9); arm(sim, 'eng-flameout', 1);
  run(sim, 1);
  sim.firePush(1);
  sim.repair(sim.state.failures.find((f) => f.kind === 'eng-flameout').id);
  assert.ok(sim.state.engines[1].pushed && sim.state.engines[1].fire);
  sim.repair('all');
  assert.ok(!sim.state.engines[1].pushed && !sim.state.engines[1].fire);
  // The gear: a leg that won't lock, the gravity extension tried, then the leg repaired by its own row.
  arm(sim, 'gear-nolock', 1);
  run(sim, 1);
  sim.controls.gearDown = true; sim.gravityGear();
  run(sim, 40);
  assert.equal(sim.state.gearSys & G_GRAV, G_GRAV);
  sim.repair(sim.state.failures[0].id);
  assert.equal(sim.state.gearSys, 0, 'the gravity extension is reset');
  run(sim, 20);
  assert.deepEqual(sim.state.gearLegs, [1, 1, 1]);
  sim.controls.gearDown = false;
  run(sim, 30);
  assert.deepEqual(sim.state.gearLegs, [0, 0, 0], 'the gear goes up again');
  assert.equal(sim._core.gOn, 0);
  // "Repair all" with nothing failed still resets what a checklist's switch left (a gravity extension tried for nothing).
  sim.gravityGear();
  assert.equal(sim.repair('all'), true);
  assert.equal(sim.state.gearSys, 0);
  assert.equal(sim.repair('all'), false);
});

test('a moment fires at the same step after a save in the middle of the take-off roll as in the straight run (the code review)', () => {
  const pilot = (s) => { s.controls.thrust = 1; };
  const mk = () => { const s = onRunway({ massKg: 78000 }); arm(s, 'eng-flameout', 1, { type: 'moment', moment: 'roll100' }); return s; };
  const a = mk(), b0 = mk();
  run(a, 60, (s) => { pilot(s); return s.state.failures.length > 0; });
  run(b0, 12, pilot);
  const b = createSim(); b.restore(viaJson(b0.snapshot()));
  run(b, 60, (s) => { pilot(s); return s.state.failures.length > 0; });
  assert.equal(b.state.failures[0].t, a.state.failures[0].t);
});

test('within 15 s of the wheels leaving the ground a gear-up touch is still the crash it was, not a belly landing; later it is one (the code review)', () => {
  // tests/sim-ground.test.mjs's gentle gear-up arrival (it touches about 16 s in, at about 130 ft/min), flown twice:
  // as it is (no wheel has stood on the ground: a belly landing), and with the core told that the wheels were on the
  // ground until 6 s in, as on a take-off whose gear is on its way up (10 s before the touch: the crash of v0.7.9).
  const fly = (wheelsUntil) => {
    const sim = airborne({ massKg: 70000, altFt: (150 * FT + 4.12) / FT, iasKt: 140, flapLever: 4, gearDown: false });
    const ev = [];
    run(sim, 40, (s) => {
      approachPilot(s); s.controls.thrust = 0.2;
      if (s.state.t < wheelsUntil) s._core.wowT = s.state.t;
      for (const e of s.events) ev.push(e.type);
      s.events.length = 0;
    });
    return { crashed: sim.state.crashed, ev };
  };
  const belly = fly(0), takeoff = fly(6);
  assert.equal(belly.crashed, null); assert.ok(belly.ev.includes('scrape'));
  assert.match(String(takeoff.crashed), /impact|strike/); assert.ok(!takeoff.ev.includes('scrape'));
});

test('a single repair resets only what belongs to it: an engine\'s fire handle stays when a gear failure is repaired, the gravity extension when an engine is (the code review\'s second round)', () => {
  const sim = cruiser();
  arm(sim, 'eng-seize', 0); arm(sim, 'gear-noext', 0); arm(sim, 'gear-nolock', 2);
  run(sim, 1);
  sim.engineSwitch(0, false); sim.firePush(0);
  sim.controls.gearDown = true; sim.gravityGear();
  run(sim, 10);
  // One gear failure repaired: engine 1's handle stays out, and the gravity extension goes on while the other stands.
  sim.repair(sim.state.failures.find((f) => f.kind === 'gear-nolock').id);
  assert.ok(sim.state.engines[0].pushed, 'engine 1\'s handle is still out');
  assert.equal(sim.state.gearSys & G_GRAV, G_GRAV, 'the gravity extension goes on');
  run(sim, 30);
  assert.deepEqual(sim.state.gearLegs, [1, 1, 1], 'and the legs came all the way down');
  // The seizure repaired: its engine's handle goes in; the gravity extension, which belongs to the gear, stays.
  sim.repair(sim.state.failures.find((f) => f.kind === 'eng-seize').id);
  assert.ok(!sim.state.engines[0].pushed);
  assert.equal(sim.state.gearSys & G_GRAV, G_GRAV);
  // The last gear failure repaired: the gravity extension is reset.
  sim.repair(sim.state.failures.find((f) => f.kind === 'gear-noext').id);
  assert.equal(sim.state.gearSys & G_GRAV, 0);
});

test('a save from before v0.8.0 taken just after lift-off keeps the take-off\'s rule (no wowT in it: the wheels left when its air time began)', () => {
  const a = onRunway({ massKg: 70000 });
  run(a, 60, (s) => { const st = s.state, c = s.controls; c.thrust = 1; if (st.ias > 140 * KT && st.onGround) c.pitch = 0.5; return !st.onGround && st.agl > 3; });
  const old = viaJson(a.snapshot());
  const t = old.core.t, air = old.core.airTime;
  delete old.core.wowT;
  const b = createSim(); b.restore(old);
  assert.ok(Math.abs(b._core.wowT - (t - air)) < 1e-9 && t - b._core.wowT < 15, `wowT ${b._core.wowT} at t ${t}`);
});
