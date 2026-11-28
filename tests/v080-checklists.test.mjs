// v0.8.0: the alert model (src/sim/checklists.js) on real sims: each failure raises its alert with its level, aural
// and message, and clears with its repair (or its procedure); the checklists' steps in order, each switch step doing
// its action; the 30 s rule for agent 2; a design's four engines numbered.
//   node --test tests/v080-checklists.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim.js';
import { armed, fireNeeds, L_GONE } from '../src/sim/failures.js';
import { newDesign } from '../src/sim/designs.js';
import { alertsOf, runStep, nextStep, alertsKey, engineName } from '../src/sim/checklists.js';
import { airborne, run, KT, FT } from './sim-helpers.mjs';

// Seeds by what the fire needs (failures.js's fireNeeds: 1 bottle, 2, or 3 for neither).
const SEED = { one: 1, two: 4, none: 8 };
for (const [k, n] of [['one', 1], ['two', 2], ['none', 3]]) assert.equal(fireNeeds(SEED[k]), n);

const fail = (sim, kind, target = 0, seed = 12345) => sim.setFailures(armed(sim.failures, { kind, target, when: { type: 'now' } }, sim.state.t, seed));
const byId = (sim, id) => alertsOf(sim).find((a) => a.id === id);
function cruise(type) {
  const sim = type ? createSim({ type }) : createSim();
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 12000 * FT, iasMs: 290 * KT, flapLever: 0, gearDown: false, fuelKg: 9000, payloadKg: 12000 });
  return sim;
}

test('nothing failed: no alerts, on each type and a design', () => {
  for (const t of [undefined, 'b787-9', 'b777-300er', newDesign('b777-300er', { id: 'x4', count: 4 })]) {
    const sim = cruise(t);
    run(sim, 2);
    assert.deepEqual(alertsOf(sim), []);
  }
  const g = createSim(); g.reset({ x: 0, y: 0, hdg: 0, onGround: true, flapLever: 1, gearDown: true, fuelKg: 8000, payloadKg: 10000 });
  run(g, 1);
  assert.deepEqual(alertsOf(g), []);
  // On the ground an engine shut down by its switch is no alert (a normal shutdown).
  g.engineSwitch(1, false); run(g, 1);
  assert.deepEqual(alertsOf(g), []);
});

test('A321 engine fire: ENG 1 FIRE, a warning with the CRC, its steps in order, each switch doing its action', () => {
  const sim = cruise();
  sim.controls.thrust = 0.6;
  fail(sim, 'eng-fire', 0, SEED.one);
  run(sim, 0.5);
  const a = alertsOf(sim);
  assert.equal(a.length, 1);
  assert.equal(a[0].id, 'fire-0'); assert.equal(a[0].level, 'warning'); assert.equal(a[0].aural, 'crc'); assert.equal(a[0].title, 'ENG 1 FIRE');
  assert.deepEqual(a[0].steps.map((s) => s.kind), ['fly', 'switch', 'switch', 'switch', 'note', 'switch', 'note']);
  assert.match(a[0].steps[0].text, /^THR LEVER 1/); assert.match(a[0].steps[1].text, /^ENG MASTER 1 .* OFF$/);
  assert.match(a[0].steps[2].text, /FIRE P\/B .* PUSH/); assert.match(a[0].steps[3].text, /^AGENT 1/);
  assert.match(a[0].steps[5].text, /^IF FIRE AFTER 30 S: AGENT 2/); assert.equal(a[0].steps[6].text, 'LAND ASAP');
  assert.equal(nextStep(a[0]), 0);
  // The fly step ticks itself when the lever is at idle.
  sim.controls.thrust = 0; run(sim, 0.1);
  let f = byId(sim, 'fire-0');
  assert.equal(f.steps[0].done, true); assert.equal(nextStep(f), 1);
  // AGENT 1 before the fire handle: not ready, and runStep does nothing.
  assert.equal(f.steps[3].ready, false); assert.equal(runStep(sim, f.steps[3]), false);
  assert.equal(runStep(sim, f.steps[1]), true); assert.equal(sim.state.engines[0].sw, false);
  f = byId(sim, 'fire-0'); assert.equal(f.steps[1].done, true); assert.equal(nextStep(f), 2);
  assert.equal(runStep(sim, f.steps[2]), true); assert.equal(sim.state.engines[0].pushed, true);
  f = byId(sim, 'fire-0'); assert.equal(f.steps[2].done, true); assert.equal(f.steps[3].ready, true);
  assert.equal(runStep(sim, f.steps[3]), true); assert.equal(sim.state.engines[0].agents, 1);
  f = byId(sim, 'fire-0'); assert.equal(f.steps[3].done, true);
  // One bottle is enough for this seed: out 10 s later (DEAD_ENGINE.fireOutS); the warning goes and, in flight, the
  // engine shut down is ENG 1 SHUT DOWN's caution.
  run(sim, 11);
  assert.equal(sim.state.engines[0].fire, false);
  const after = alertsOf(sim);
  assert.equal(after.length, 1); assert.equal(after[0].id, 'eng-0'); assert.equal(after[0].title, 'ENG 1 SHUT DOWN'); assert.equal(after[0].level, 'caution'); assert.equal(after[0].aural, 'sc');
});

test('the 30 s rule: agent 2 offered only 30 s after agent 1 and while the fire still burns', () => {
  const sim = cruise();
  sim.controls.thrust = 0;
  fail(sim, 'eng-fire', 1, SEED.none);
  run(sim, 0.2);
  for (const k of [1, 2, 3]) runStep(sim, byId(sim, 'fire-1').steps[k]);
  assert.equal(sim.state.engines[1].agents, 1);
  run(sim, 10);
  let f = byId(sim, 'fire-1');
  assert.equal(f.steps[5].ready, false); assert.match(f.steps[5].info, /^IN 2\d S$/);
  assert.equal(runStep(sim, f.steps[5]), false); assert.equal(sim.state.engines[1].agents, 1);
  run(sim, 20.5);
  f = byId(sim, 'fire-1');
  assert.equal(f.steps[5].ready, true);
  assert.equal(runStep(sim, f.steps[5]), true); assert.equal(sim.state.engines[1].agents, 2);
  // Neither bottle puts this one out: a fire not put out stays a warning.
  run(sim, 30);
  f = byId(sim, 'fire-1');
  assert.ok(f, 'still burning'); assert.equal(f.level, 'warning'); assert.equal(f.steps[5].done, true);
  assert.equal(nextStep(f), -1);
  // And it clears with its repair.
  assert.equal(sim.repair('all'), true);
  assert.equal(byId(sim, 'fire-1'), undefined);
});

test('a fire the second bottle puts out', () => {
  const sim = cruise();
  sim.controls.thrust = 0;
  fail(sim, 'eng-fire', 0, SEED.two);
  run(sim, 0.2);
  for (const k of [1, 2, 3]) runStep(sim, byId(sim, 'fire-0').steps[k]);
  run(sim, 30.5);
  assert.ok(byId(sim, 'fire-0'));
  runStep(sim, byId(sim, 'fire-0').steps[5]);
  run(sim, 11);
  assert.equal(byId(sim, 'fire-0'), undefined);
  assert.equal(byId(sim, 'eng-0').title, 'ENG 1 SHUT DOWN');
});

test('the fire clears with its repair', () => {
  const sim = cruise();
  fail(sim, 'eng-fire', 0, SEED.none);
  run(sim, 0.2);
  assert.ok(byId(sim, 'fire-0'));
  const id = sim.state.failures[0].id;
  assert.equal(sim.repair(id), true);
  assert.deepEqual(alertsOf(sim), [], 'the switch still on, the engine still running: nothing');
});

test('A321 flameout: ENG 2 FAIL, a caution with the single chime; the relight by its switch clears it', () => {
  const sim = cruise();
  sim.controls.thrust = 0.5;
  fail(sim, 'eng-flameout', 1);
  run(sim, 0.5);
  let a = byId(sim, 'eng-1');
  assert.equal(a.level, 'caution'); assert.equal(a.aural, 'sc'); assert.equal(a.title, 'ENG 2 FAIL');
  assert.deepEqual(a.steps.map((s) => s.text.split(' .....')[0]), ['THR LEVER 2', 'ENG MASTER 2', 'RELIGHT: ENG MASTER 2', 'IF NO RELIGHT: ENG MASTER 2', 'LAND ASAP']);
  assert.equal(nextStep(a), 0);
  sim.controls.thrust = 0; run(sim, 0.1);
  a = byId(sim, 'eng-1'); assert.equal(nextStep(a), 1);
  // The relight with the switch still on (the flameout): not done; off first.
  assert.equal(a.steps[2].done, false);
  assert.equal(runStep(sim, a.steps[1]), true); assert.equal(sim.state.engines[1].sw, false);
  a = byId(sim, 'eng-1'); assert.equal(a.steps[1].done, true); assert.equal(nextStep(a), 2);
  assert.equal(runStep(sim, a.steps[2]), true); assert.equal(sim.state.engines[1].sw, true);
  run(sim, 2);
  a = byId(sim, 'eng-1');
  assert.equal(a.title, 'ENG 2 FAIL', 'the failure stays named while it starts');
  assert.equal(a.steps[1].done, true); assert.equal(a.steps[2].done, true);
  assert.match(a.steps[2].info, /^STARTING \d+ %$/);
  run(sim, 60);
  assert.equal(sim.state.engines[1].lit, true);
  assert.equal(byId(sim, 'eng-1'), undefined, 'relit: the caution clears');
});

test('a relight outside the envelope says why', () => {
  const sim = createSim();
  sim.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 35000 * FT, iasMs: 250 * KT, flapLever: 0, gearDown: false, fuelKg: 9000, payloadKg: 12000 });
  fail(sim, 'eng-flameout', 0);
  run(sim, 0.3);
  runStep(sim, byId(sim, 'eng-0').steps[1]);
  runStep(sim, byId(sim, 'eng-0').steps[2]);
  run(sim, 0.3);
  const a = byId(sim, 'eng-0');
  assert.equal(a.steps[2].info, 'ABOVE THE START ENVELOPE: DESCEND');
});

test('A321 seizure: its own list (no relight) and it clears with its repair', () => {
  const sim = cruise();
  fail(sim, 'eng-seize', 0);
  run(sim, 0.5);
  let a = byId(sim, 'eng-0');
  assert.equal(a.title, 'ENG 1 FAIL'); assert.equal(a.level, 'caution');
  assert.ok(!a.steps.some((s) => /RELIGHT|\bON$/.test(s.text)), 'no relight');
  assert.ok(a.steps.some((s) => s.kind === 'note' && /SEIZED/.test(s.text)));
  runStep(sim, a.steps.find((s) => s.act?.name === 'engineSwitch'));
  assert.equal(sim.state.engines[0].sw, false);
  assert.equal(sim.repair('all'), true);
  // Repaired with its switch off: no longer failed, an engine shut down in flight (SHUT DOWN, the relight offered).
  a = byId(sim, 'eng-0');
  assert.equal(a.title, 'ENG 1 SHUT DOWN');
  const on = a.steps.find((s) => s.act?.name === 'engineSwitch');
  assert.equal(runStep(sim, on), true);
  // (The lead, 21:12: the caution used to go the moment the switch went on. It now stays while the engine starts, so
  // the relight line shows the start's progress, or why it can't start, and goes when the engine burns.)
  run(sim, 5);
  a = byId(sim, 'eng-0');
  assert.equal(a.title, 'ENG 1 SHUT DOWN');
  assert.match(a.steps.find((s) => s.act?.name === 'engineSwitch').info, /^STARTING \d+ %$/);
  run(sim, 60);
  assert.equal(sim.state.engines[0].lit, true);
  assert.equal(byId(sim, 'eng-0'), undefined, 'burning again: no caution');
});

test('a seized engine whose fire handle is out: no restart while it is seized, and the step says why; repaired, the handle is in again and it starts', () => {
  const sim = cruise();
  fail(sim, 'eng-seize', 0);
  fail(sim, 'eng-fire', 0, SEED.one);
  run(sim, 0.5);
  // (With a fire as well, so that the handle stays out when the seizure alone is repaired: the lead's mend after the
  // code review resets the handle and the bottles once no fire and no engine failure is left on that engine; before
  // it a repaired engine never ran again, which is what this test used to hold it to.)
  sim.firePush(0);
  assert.equal(sim.state.engines[0].pushed, true);
  sim.repair(sim.state.failures.find((f) => f.kind === 'eng-seize').id);
  assert.equal(sim.state.engines[0].pushed, true, 'the fire still burns: its handle stays out');
  sim.repair('all');
  assert.equal(sim.state.engines[0].pushed, false, 'nothing left on this engine: the handle is in again');
  const on = byId(sim, 'eng-0').steps.find((s) => s.act?.name === 'engineSwitch');
  assert.notEqual(on.info, 'FIRE HANDLE OUT: NO RESTART');
  // The reason still shows where the handle really is out: a fire put out, the engine shut down in flight.
  const b = cruise();
  fail(b, 'eng-fire', 1, SEED.one);
  run(b, 0.5);
  b.engineSwitch(1, false); b.firePush(1); b.fireAgent(1);
  run(b, 12);
  const on2 = byId(b, 'eng-1').steps.find((s) => s.act?.name === 'engineSwitch');
  assert.equal(on2.ready, false); assert.equal(on2.info, 'FIRE HANDLE OUT: NO RESTART');
  assert.equal(runStep(b, on2), false);
});

test('Boeing 787: FIRE ENG L with the fire bell; ENG FAIL R with the beeper; ENG SHUTDOWN', () => {
  const sim = cruise('b787-9');
  sim.controls.thrust = 0;
  fail(sim, 'eng-fire', 0, SEED.one);
  fail(sim, 'eng-flameout', 1);
  run(sim, 0.5);
  const a = alertsOf(sim);
  assert.deepEqual(a.map((x) => [x.title, x.level, x.aural]), [['FIRE ENG L', 'warning', 'bell'], ['ENG FAIL R', 'caution', 'beeper']]);
  assert.match(a[0].steps[1].text, /^FUEL CONTROL L .* CUTOFF$/); assert.match(a[0].steps[2].text, /PULL$/);
  assert.match(a[0].steps[3].text, /ROTATE/); assert.match(a[0].steps.at(-1).text, /NEAREST SUITABLE AIRPORT/);
  assert.match(a[1].steps[2].text, /^RELIGHT: FUEL CONTROL R .* RUN$/);
  for (const k of [1, 2, 3]) assert.equal(runStep(sim, byId(sim, 'fire-0').steps[k]), true);
  run(sim, 11);
  assert.equal(byId(sim, 'eng-0').title, 'ENG SHUTDOWN L');
  assert.equal(engineName(0, 2, 'boeing'), 'L'); assert.equal(engineName(1, 2, 'airbus'), '2');
});

test('a four-engine design numbers its engines 1 to 4, and its steps act on that engine', () => {
  const sim = cruise(newDesign('b777-300er', { id: 'x4', count: 4 }));
  sim.controls.thrust = 0;
  fail(sim, 'eng-fire', 2, SEED.one);
  fail(sim, 'eng-flameout', 3);
  run(sim, 0.5);
  const a = alertsOf(sim);
  assert.deepEqual(a.map((x) => x.title), ['FIRE ENG 3', 'ENG FAIL 4']);
  runStep(sim, a[0].steps[1]);
  assert.deepEqual(sim.state.engines.map((e) => e.sw), [true, true, false, true]);
});

test('gear: the normal extension fails: L/G GEAR NOT DOWNLOCKED; the gravity extension clears it', () => {
  const sim = cruise();
  fail(sim, 'gear-noext');
  run(sim, 0.2);
  assert.deepEqual(alertsOf(sim), [], 'the lever still up: nothing');
  sim.controls.gearDown = true;
  run(sim, 5);
  let a = byId(sim, 'gear');
  assert.equal(a.level, 'caution'); assert.equal(a.aural, 'sc'); assert.equal(a.title, 'L/G GEAR NOT DOWNLOCKED');
  assert.equal(a.steps[0].kind, 'fly'); assert.match(a.steps[1].text, /GRAVITY EXTN HANDCRANK/);
  assert.equal(nextStep(a), 0);
  assert.equal(runStep(sim, a.steps[1]), true);
  run(sim, 5);
  a = byId(sim, 'gear');
  assert.equal(a.steps[0].done, true); assert.equal(a.steps[1].done, true); assert.match(a.steps[1].info, /^GEAR FALLING \d+ %$/);
  run(sim, 35);
  assert.equal(byId(sim, 'gear'), undefined);
  assert.ok(sim.state.gearLegs.every((p) => p >= 0.999));
});

test('gear: the gravity extension fails too: the abnormal landing notes; the repair clears it', () => {
  const sim = cruise('b787-9');
  fail(sim, 'gear-noext'); fail(sim, 'gear-nograv');
  sim.controls.gearDown = true;
  run(sim, 4);
  let a = byId(sim, 'gear');
  assert.equal(a.title, 'GEAR DISAGREE'); assert.equal(a.aural, 'beeper'); assert.match(a.steps[1].text, /^ALTN GEAR SWITCH/);
  runStep(sim, a.steps[1]);
  run(sim, 40);
  a = byId(sim, 'gear');
  assert.ok(a.steps.some((s) => /PARTIAL OR GEAR UP LANDING: NOSE, LEFT, RIGHT NOT DOWN/.test(s.text)));
  sim.repair('all');
  run(sim, 12);
  assert.equal(byId(sim, 'gear'), undefined);
});

test('gear: a leg that won\'t lock stays named after the gravity extension', () => {
  const sim = cruise();
  fail(sim, 'gear-nolock', 1);
  sim.controls.gearDown = true;
  run(sim, 12);
  const a = byId(sim, 'gear');
  assert.ok(a);
  runStep(sim, a.steps[1]);
  run(sim, 35);
  const b = byId(sim, 'gear');
  assert.ok(b.steps.some((s) => /LDG WITH ABNORMAL L\/G: LEFT NOT DOWN/.test(s.text)), b.steps.map((s) => s.text).join('|'));
  // On the ground the gear caution goes (the landing's lists take over).
  assert.equal(alertsOf({ ...sim.state, onGround: true }, sim.controls, 'airbus').find((x) => x.id === 'gear'), undefined);
});

test('a leg collapsed: a warning, its steps; all-engines switch step shuts every engine', () => {
  const sim = createSim(); sim.reset({ x: 0, y: 0, hdg: 0, onGround: true, flapLever: 1, gearDown: true, fuelKg: 8000, payloadKg: 10000 });
  run(sim, 0.5);
  const st = { ...sim.state, gearLegFlags: [0, 0, L_GONE], failures: [{ id: 9, kind: 'gear-collapse', target: 2, t: 0 }] };
  const a = alertsOf(st, sim.controls, 'airbus');
  assert.equal(a.length, 1); assert.equal(a[0].title, 'L/G COLLAPSE RIGHT'); assert.equal(a[0].level, 'warning'); assert.equal(a[0].aural, 'crc');
  const off = a[0].steps.find((s) => s.kind === 'switch');
  assert.equal(runStep(sim, off), true);
  assert.deepEqual(sim.state.engines.map((e) => e.sw), [false, false]);
  assert.equal(alertsOf(st, sim.controls, 'boeing')[0].aural, 'siren');
});

test('warnings come before cautions; the key changes with a step\'s state', () => {
  const sim = cruise();
  sim.controls.thrust = 0.5;
  fail(sim, 'eng-flameout', 0);
  fail(sim, 'eng-fire', 1, SEED.none);
  run(sim, 0.3);
  const a = alertsOf(sim);
  assert.deepEqual(a.map((x) => x.level), ['warning', 'caution']);
  const k1 = alertsKey(a);
  assert.equal(alertsKey(alertsOf(sim)), k1, 'the same state, the same key');
  sim.controls.thrust = 0; run(sim, 0.05);
  assert.notEqual(alertsKey(alertsOf(sim)), k1);
});

test('the fire\'s checklist done with the lever never touched: the lever step ticks once the engine is cut off', () => {
  const sim = cruise();
  sim.controls.thrust = 0.7;
  fail(sim, 'eng-fire', 0, SEED.one);
  run(sim, 0.3);
  let f = byId(sim, 'fire-0');
  assert.equal(f.steps[0].done, false);
  // Every switch step is clickable on its own precondition, whatever is ticked above it: the fire handle first.
  assert.equal(runStep(sim, f.steps[2]), true);
  f = byId(sim, 'fire-0');
  assert.equal(f.steps[0].done, true, 'the handle out: the lever no longer matters');
  assert.equal(runStep(sim, f.steps[1]), true);
  assert.equal(runStep(sim, byId(sim, 'fire-0').steps[3]), true);
  assert.equal(sim.controls.thrust, 0.7);
  run(sim, 11);
  assert.equal(byId(sim, 'fire-0'), undefined);
  // And with only the switch off (no handle), the lever step is ticked too.
  const b = cruise('b787-9'); b.controls.thrust = 0.7;
  fail(b, 'eng-fire', 1, SEED.none); run(b, 0.3);
  runStep(b, byId(b, 'fire-1').steps[1]);
  assert.equal(byId(b, 'fire-1').steps[0].done, true);
});

test('lying on its belly after a gear-up landing the aircraft is on the ground for the alerts: engines shut down there raise nothing', () => {
  const sim = cruise();
  run(sim, 1);
  const st = { ...sim.state, onGround: false, scraping: true, engines: sim.state.engines.map((e) => ({ ...e, sw: false, lit: false })) };
  assert.equal(alertsOf(st, sim.controls, 'airbus').length, 0, 'no ENG SHUT DOWN, no LAND ASAP, on the belly');
  assert.ok(alertsOf({ ...st, scraping: false }, sim.controls, 'airbus').length > 0, 'the same in the air is two cautions');
});
