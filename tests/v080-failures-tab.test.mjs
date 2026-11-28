// v0.8.0, part 4: the Failures tab's pure parts (src/ui/failures-window.js) on a real sim.
//   node --test tests/v080-failures-tab.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, SYSTEMS, MOMENTS, armed, armedRandom, describe } from '../src/sim/failures.js';
import {
  FAILURES_TAB, kindsBySystem, randomKinds, durationWords, minutesLeft, randomWords, whenWords, agoWords,
  armedRows, activeRows, failuresView, planAfter, applyFailAction, specOf, listsHtml,
} from '../src/ui/failures-window.js';
import { airborne, onRunway, run } from './sim-helpers.mjs';

test('the tab and the systems come from KINDS and SYSTEMS', () => {
  assert.equal(FAILURES_TAB.id, 'failures');
  const s = kindsBySystem();
  assert.deepEqual(s.map((x) => x.system), Object.keys(SYSTEMS));
  assert.deepEqual(s.flatMap((x) => x.kinds.map((k) => k.kind)).sort(), Object.keys(KINDS).sort());
  assert.ok(s.every((x) => x.kinds.every((k) => KINDS[k.kind].system === x.system)));
  assert.deepEqual(randomKinds(), Object.keys(KINDS).filter((k) => KINDS[k].random));
  assert.ok(!randomKinds().includes('gear-nograv'));
});

test('the words: durations, the minutes left, when, ago', () => {
  assert.equal(durationWords(130), '2 min 10 s');
  assert.equal(durationWords(45), '45 s');
  assert.equal(durationWords(180), '3 min');
  assert.equal(minutesLeft([0, 600], 0), 10);
  assert.equal(minutesLeft([0, 600], 61), 9);       // 539 s left: within 9 minutes
  assert.equal(minutesLeft([0, 600], 599), 1);
  assert.equal(minutesLeft([0, 600], 700), 0);      // never negative
  assert.equal(randomWords([0, 600], 0), 'A random failure armed, within 10 minutes');
  assert.equal(randomWords([0, 600], 560), 'A random failure armed, within 1 minute');
  assert.equal(randomWords([0, 600], 650), 'A random failure armed, any moment now');
  assert.equal(whenWords({ at: 230 }, 100), 'in 2 min 10 s');
  assert.equal(whenWords({ at: 100 }, 100), 'now');
  assert.equal(whenWords({ moment: 'cruise' }, 0), MOMENTS.cruise);
  assert.equal(agoWords(0.2), 'just now');
  assert.equal(agoWords(40), '40 s ago');
  assert.equal(agoWords(200), '3 min ago');
});

test('the form makes the spec armed() takes', () => {
  assert.deepEqual(specOf({ kind: 'eng-fire', engine: 3, when: 'now' }), { kind: 'eng-fire', target: 3, when: { type: 'now' } });
  assert.deepEqual(specOf({ kind: 'gear-nolock', leg: 2, engine: 5, when: 'after', min: 2, sec: 10 }), { kind: 'gear-nolock', target: 2, when: { type: 'after', seconds: 130 } });
  assert.deepEqual(specOf({ kind: 'gear-noext', leg: 2, engine: 1, when: 'moment', moment: 'app3000' }), { kind: 'gear-noext', target: 0, when: { type: 'moment', moment: 'app3000' } });
});

test('a random failure\'s row and HTML tell nothing but its window', () => {
  // Every kind and target it might be: none of their words may show.
  for (const seed of [1, 77, 123456, 2 ** 30 + 5]) {
    const plan = armedRandom(null, { kinds: randomKinds(), windowS: 900, nEngines: 8 }, 100, seed);
    const it = plan.items[0];
    const rows = armedRows(plan, [], 100);
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['id', 'random', 'text', 'when']);
    assert.equal(rows[0].text, 'A random failure armed, within 15 minutes');
    assert.equal(rows[0].when, '');
    const html = listsHtml({ plan, active: [], t: 100, off: [] });
    const secrets = [describe(it), KINDS[it.kind].label, it.kind, String(it.at), it.at.toFixed(1), String(it.seed).length > 3 ? String(it.seed) : 'seed', 'Engine', 'gear', 'Nose', 'main', ...Object.values(MOMENTS)];
    for (const s of secrets) assert.ok(!html.includes(s), `the HTML holds "${s}": ${html}`);
    assert.ok(!/title=|data-(?!a=|id=)/.test(html), 'no title, no data but the action and the id: ' + html);
    assert.ok(html.includes(`data-id="${it.id}"`));
    // Two minutes on, the window counts down, and the time it fires still shows nowhere.
    assert.ok(listsHtml({ plan, active: [], t: 220, off: [] }).includes('within 13 minutes'));
  }
});

test('arm, disarm and disarm all make the plans failures.js makes', () => {
  const a = planAfter(null, { type: 'arm', spec: { kind: 'eng-flameout', target: 1, when: { type: 'after', seconds: 60 } }, seed: 9 }, 10, 2);
  assert.deepEqual(a, armed(null, { kind: 'eng-flameout', target: 1, when: { type: 'after', seconds: 60 } }, 10, 9));
  const b = planAfter(a, { type: 'armRandom', kinds: ['eng-fire'], windowS: 300, seed: 5 }, 10, 2);
  assert.deepEqual(b, armedRandom(a, { kinds: ['eng-fire'], windowS: 300, nEngines: 2 }, 10, 5));
  const c = planAfter(b, { type: 'disarm', id: 1 }, 10, 2);
  assert.deepEqual(c.items.map((x) => x.id), [2]);
  assert.equal(planAfter(c, { type: 'disarm', id: 2 }, 10, 2), null);
  // disarm all keeps the ones that fired (the active list's)
  const d = planAfter(b, { type: 'disarmAll', active: [{ id: 2, kind: 'eng-fire', target: 0, t: 11 }] }, 12, 2);
  assert.deepEqual(d.items.map((x) => x.id), [2]);
  assert.equal(planAfter(b, { type: 'disarmAll', active: [] }, 12, 2), null);
  assert.equal(planAfter(b, { type: 'repair', id: 1 }, 12, 2), undefined);
});

test('the lists from a plan and a state: armed, active, an engine torn off left out', () => {
  let p = armed(null, { kind: 'eng-fire', target: 0, when: { type: 'now' } }, 0, 1);
  p = armed(p, { kind: 'gear-nolock', target: 1, when: { type: 'moment', moment: 'final500' } }, 0, 2);
  p = armed(p, { kind: 'eng-seize', target: 1, when: { type: 'after', seconds: 130 } }, 0, 3);
  const active = [{ id: 1, kind: 'eng-fire', target: 0, t: 0 }];
  const arm = armedRows(p, active, 0);
  assert.deepEqual(arm.map((r) => [r.id, r.text, r.when]), [[2, 'Left main gear: won’t lock down', MOMENTS.final500], [3, 'Engine 2: seizure', 'in 2 min 10 s']]);
  assert.deepEqual(activeRows(active, 185).map((r) => [r.id, r.text, r.when]), [[1, 'Engine 1: fire', '3 min ago']]);
  assert.deepEqual(activeRows(active, 185, [true, false]), []);
});

test('a real sim: arm an engine fire now, step, it is active; repair it and it is gone from both lists', () => {
  const sim = airborne({ altFt: 10000, iasKt: 280 });
  const v0 = failuresView(sim);
  assert.equal(v0.plan, null); assert.deepEqual(v0.active, []); assert.equal(v0.nEngines, sim.state.engines.length);
  let r = applyFailAction(sim, { type: 'arm', spec: { kind: 'eng-fire', target: 1, when: { type: 'now' } }, seed: 42 });
  assert.deepEqual(r, { ok: true, text: 'Armed: Engine 2: fire.' });
  let v = failuresView(sim);
  assert.equal(armedRows(v.plan, v.active, v.t).length, 1);
  assert.equal(armedRows(v.plan, v.active, v.t)[0].when, 'now');
  run(sim, 0.5);
  v = failuresView(sim);
  assert.deepEqual(armedRows(v.plan, v.active, v.t), []);
  const act = activeRows(v.active, v.t, v.off);
  assert.deepEqual(act.map((x) => x.text), ['Engine 2: fire']);
  assert.ok(sim.state.engines[1].fire);
  // the view's lists are copies: changing them leaves the sim's alone
  v.active.length = 0; assert.equal(sim.state.failures.length, 1);
  r = applyFailAction(sim, { type: 'repair', id: act[0].id });
  assert.equal(r.ok, true);
  v = failuresView(sim);
  assert.deepEqual(activeRows(v.active, v.t, v.off), []);
  assert.deepEqual(armedRows(v.plan, v.active, v.t), []);
  assert.equal(sim.failures, null);
  assert.equal(applyFailAction(sim, { type: 'repairAll' }).ok, false);
});

test('a real sim: a timed one and a random one count down, disarm, repair all', () => {
  const sim = onRunway();
  applyFailAction(sim, { type: 'arm', spec: { kind: 'gear-noext', target: 0, when: { type: 'after', seconds: 30 } }, seed: 3 });
  applyFailAction(sim, { type: 'armRandom', kinds: ['eng-flameout', 'eng-seize'], windowS: 600, seed: 11 });
  assert.equal(applyFailAction(sim, { type: 'armRandom', kinds: [], windowS: 600, seed: 1 }).ok, false);
  assert.equal(applyFailAction(sim, { type: 'arm', spec: { kind: 'eng-fire', target: 7, when: { type: 'now' } }, seed: 1 }).ok, false, 'no engine 8 on a twin');
  let v = failuresView(sim);
  let rows = armedRows(v.plan, v.active, v.t);
  assert.deepEqual(rows.map((x) => x.text), ['Gear: normal extension fails', 'A random failure armed, within 10 minutes']);
  assert.equal(rows[0].when, 'in 30 s');
  run(sim, 10);
  v = failuresView(sim);
  assert.equal(armedRows(v.plan, v.active, v.t)[0].when, 'in 20 s');
  applyFailAction(sim, { type: 'disarm', id: rows[1].id });
  v = failuresView(sim);
  assert.deepEqual(armedRows(v.plan, v.active, v.t).map((x) => x.id), [rows[0].id]);
  run(sim, 23);
  v = failuresView(sim);
  assert.deepEqual(activeRows(v.active, v.t).map((x) => x.text), ['Gear: normal extension fails']);
  assert.match(activeRows(v.active, v.t)[0].when, /^[23] s ago$/);
  assert.deepEqual(armedRows(v.plan, v.active, v.t), []);
  // disarm all leaves what fired; repair all mends it
  applyFailAction(sim, { type: 'disarmAll' });
  assert.equal(failuresView(sim).active.length, 1);
  assert.deepEqual(applyFailAction(sim, { type: 'repairAll' }), { ok: true, text: 'All repaired.' });
  v = failuresView(sim);
  assert.deepEqual(v.active, []); assert.equal(v.plan, null);
});

// v0.8.0 (part 7): the hydraulics' target, a system, by the family's names.
test('the hydraulics in the tab: a system target, the family\'s names in the view, the words and the spec', async () => {
  const { createSim } = await import('../src/sim/sim.js');
  assert.ok(kindsBySystem().some((s) => s.system === 'hydraulics' && s.kinds.some((k) => k.target === 'system')));
  assert.deepEqual(specOf({ kind: 'hyd-sys', hsys: 2, leg: 1, engine: 1, when: 'now' }), { kind: 'hyd-sys', target: 2, when: { type: 'now' } });
  assert.deepEqual(specOf({ kind: 'flaps-jam', hsys: 2, when: 'now' }).target, 0);
  const sim = airborne({ altFt: 10000, iasKt: 280 });
  let v = failuresView(sim);
  assert.equal(v.family, 'airbus'); assert.deepEqual(v.hydNames, ['Green', 'Blue', 'Yellow']);
  assert.deepEqual(applyFailAction(sim, { type: 'arm', spec: { kind: 'hyd-sys', target: 0, when: { type: 'now' } }, seed: 1 }), { ok: true, text: 'Armed: Green hydraulic system lost.' });
  assert.equal(applyFailAction(sim, { type: 'arm', spec: { kind: 'hyd-sys', target: 5, when: { type: 'now' } }, seed: 1 }).ok, false);
  run(sim, 0.5);
  v = failuresView(sim);
  assert.deepEqual(activeRows(v.active, v.t, v.off, v.family).map((r) => r.text), ['Green hydraulic system lost']);
  assert.ok(listsHtml(v).includes('Green hydraulic system lost'));
  const b = createSim({ type: 'b787-9' });
  assert.deepEqual(failuresView(b).hydNames, ['Left', 'Centre', 'Right']);
});
