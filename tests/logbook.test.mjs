// The logbook's and score card's pure helpers: formatting, totals, ordering, the verdict.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtDuration, fmtDate, fmtKg, totals, newestFirst, scenarioOf, filterByScenario, removeScenario, scenarioOptions, UNTAGGED } from '../src/ui/logbook.js';
import { typeName } from '../src/scenarios.js';
import { verdict, penaltyFrac, touchdownText, gradeColor, esc, runwaySvg } from '../src/ui/score-panel.js';

const parts = (vs, g, bounces = 0) => [
  { name: 'Vertical speed', value: vs, unit: 'ft/min', penalty: 0 },
  { name: 'Peak g', value: g, unit: 'g', penalty: 0 },
  { name: 'Bounces', value: bounces, unit: '', penalty: bounces * 12 },
];

test('durations as h:mm', () => {
  assert.equal(fmtDuration(0), '0:00');
  assert.equal(fmtDuration(3420), '0:57');
  assert.equal(fmtDuration(3600), '1:00');
  assert.equal(fmtDuration(3629), '1:00');
  assert.equal(fmtDuration(3631), '1:01');
  assert.equal(fmtDuration(36000 + 59 * 60), '10:59');
  assert.equal(fmtDuration(null), '—');
  assert.equal(fmtDuration(NaN), '—');
});

test('dates in local time', () => {
  const d = fmtDate(new Date(2026, 9, 31, 7, 5).toISOString());
  assert.equal(d.day, 'Sat 31 Oct 2026');
  assert.equal(d.time, '07:05');
  assert.equal(fmtDate('nonsense').day, '—');
  assert.equal(fmtDate(undefined).day, '—');
});

test('kilograms', () => {
  assert.equal(fmtKg(3612.4), '3,612 kg');
  assert.equal(fmtKg(undefined), '—');
});

test('totals: flights, hours, average and best', () => {
  const log = [
    { date: '2026-10-01T00:00:00Z', airTimeS: 3600, score: { points: 80, grade: 'B' } },
    { date: '2026-10-02T00:00:00Z', airTimeS: 1800, score: { points: 96, grade: 'A' } },
    { date: '2026-10-03T00:00:00Z', airTimeS: null, score: null },
    { date: '2026-10-04T00:00:00Z', airTimeS: 600, score: { points: 96, grade: 'A' } },
  ];
  const t = totals(log);
  assert.equal(t.flights, 4);
  assert.equal(t.airS, 6000);
  assert.equal(t.avgPoints, 91); // (80 + 96 + 96) / 3
  assert.equal(t.best, log[3]); // the newer of the two 96s
  const e = totals([]);
  assert.deepEqual([e.flights, e.airS, e.avgPoints, e.best], [0, 0, null, null]);
  assert.equal(totals(null).flights, 0);
});

test('newest first, keeping stored indices', () => {
  const log = [{ date: '2026-10-02T00:00:00Z' }, { date: '2026-10-05T00:00:00Z' }, { date: 'bad' }, { date: '2026-10-01T00:00:00Z' }];
  assert.deepEqual(newestFirst(log).map((x) => x.i), [1, 0, 3, 2]);
});

test('verdict thresholds', () => {
  assert.equal(verdict({ points: 97, parts: parts(140, 1.15) }), 'Butter.');
  assert.match(verdict({ points: 92, parts: parts(200, 1.2) }), /^Smooth/);
  assert.equal(verdict({ points: 82, parts: parts(300, 1.3) }), 'Fine, with a few things to tidy.');
  // Since v0.1.3 the biggest flaw, when one stands out (3 points or more), says what to fix.
  const flawed = [...parts(237, 1.47), { name: 'Touchdown vs aiming point', value: 140, unit: 'm', penalty: 4 },
    { name: 'Approach path', value: 0.4, unit: 'dots', note: 'high', penalty: 2 }];
  assert.equal(verdict({ points: 89, parts: flawed }), 'Long. Put it down at the aiming point.');
  flawed[4].penalty = 7; // the approach now costs the most
  assert.equal(verdict({ points: 82, parts: flawed }), 'Off the path on final (high). Get on it early and stay there.');
  assert.match(verdict({ points: 93, parts: flawed }), /^Smooth/); // 90 and up: no advice
  assert.match(verdict({ points: 70, parts: parts(350, 1.4) }), /^Safe/);
  assert.match(verdict({ points: 55, parts: parts(420, 1.5) }), /cabin crew/);
  assert.match(verdict({ points: 30, parts: parts(450, 1.6) }), /inspection/);
  // a hard landing is an inspection whatever the points
  assert.match(verdict({ points: 80, parts: parts(650, 1.5) }), /inspection/);
  assert.match(verdict({ points: 80, parts: parts(300, 2.4) }), /inspection/); // 2.3 g and up (Airbus inspects at 2.6 g)
  assert.match(verdict({ points: 70, parts: parts(200, 1.2, 2) }), /Kangaroo/);
  assert.match(verdict({ points: 70, parts: parts(200, 1.2), touchdown: { along: -20 } }), /Short/);
  assert.match(verdict({ points: 70, parts: parts(200, 1.2, 1) }), /bounce/);
});

test('penalty bars, touchdown text, colours, escaping', () => {
  assert.equal(penaltyFrac(0), 0);
  assert.equal(penaltyFrac(15), 0.5);
  assert.equal(penaltyFrac(99), 1);
  assert.equal(touchdownText(438, 1.4, 400), '38 m past the aiming point, 1.4 m right of the centreline');
  assert.equal(touchdownText(190, -6.8, 400), '210 m before the aiming point, 6.8 m left of the centreline');
  assert.equal(touchdownText(-30, 0.2, 400), '30 m short of the threshold, on the centreline');
  assert.equal(gradeColor('A'), '#3cff4e');
  assert.equal(gradeColor('F'), '#ff3b3b');
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
  assert.match(runwaySvg({ along: 400, cross: 0 }), /^<svg[\s\S]*<circle[\s\S]*<\/svg>$/);
  assert.doesNotMatch(runwaySvg({ along: NaN, cross: 0 }), /<circle/);
});

// ---- v0.2.0: one logbook, tagged by scenario ----
const D = (d) => `2026-10-${String(d).padStart(2, '0')}T00:00:00Z`;
const LOG = [
  { date: D(1), route: 'RKSS–RKPC' }, // v0.1.x: untagged, Scenario 1's
  { date: D(2), route: 'RKPC–RKSS' }, // v0.1.x
  { date: D(3), scenarioId: 's1', scenarioName: 'Scenario 1' }, // the migrated scenario, tagged
  { date: D(4), scenarioId: 'a', scenarioName: 'Test A' },
  { date: D(5), scenarioId: 'gone', scenarioName: 'Old name' }, // deleted later
  { date: D(6), scenarioId: 'gone', scenarioName: 'Renamed then deleted' },
  { date: D(7), scenarioId: 'a', scenarioName: 'Test A' },
];
const SC = [{ id: 's1', name: 'Scenario 1' }, { id: 'a', name: 'Test A' }, { id: 'b', name: 'Empty one' }];

test('scenarioOf: the tag, or the legacy scenario for untagged flights', () => {
  assert.equal(scenarioOf(LOG[3], 's1'), 'a');
  assert.equal(scenarioOf(LOG[0], 's1'), 's1');
  assert.equal(scenarioOf(LOG[0], null), UNTAGGED);
  assert.equal(scenarioOf(LOG[0]), UNTAGGED);
  assert.equal(scenarioOf({ scenarioId: '' }, 's1'), 's1');
  assert.equal(scenarioOf(null, 's1'), 's1');
});

test('filterByScenario: one scenario, all, untagged counted as the legacy one', () => {
  assert.equal(filterByScenario(LOG, null, 's1').length, 7);
  assert.equal(filterByScenario(LOG, '', 's1').length, 7);
  assert.deepEqual(filterByScenario(LOG, 's1', 's1'), [LOG[0], LOG[1], LOG[2]]);
  assert.deepEqual(filterByScenario(LOG, 'a', 's1'), [LOG[3], LOG[6]]);
  assert.deepEqual(filterByScenario(LOG, 'gone', 's1'), [LOG[4], LOG[5]]); // a deleted scenario still filters by id
  assert.deepEqual(filterByScenario(LOG, UNTAGGED, null), [LOG[0], LOG[1]]);
  assert.deepEqual(filterByScenario(LOG, 'b', 's1'), []);
  assert.deepEqual(filterByScenario([null, LOG[3]], 'a'), [LOG[3]]);
  assert.deepEqual(filterByScenario(undefined, 'a'), []);
  // the totals follow the filter
  assert.equal(totals(filterByScenario(LOG, 'a', 's1')).flights, 2);
});

test('scenarioOptions: live ones in order, then deleted ones by their newest carried name', () => {
  const o = scenarioOptions(LOG, SC, 's1');
  assert.deepEqual(o.map((x) => [x.id, x.name, x.count, x.deleted]), [
    ['s1', 'Scenario 1', 3, false],
    ['a', 'Test A', 2, false],
    ['b', 'Empty one', 0, false],
    ['gone', 'Renamed then deleted', 2, true],
  ]);
  // A renamed legacy scenario takes its live name, untagged flights included.
  assert.equal(scenarioOptions(LOG, [{ id: 's1', name: 'Jeju runs' }], 's1')[0].name, 'Jeju runs');
  // No legacy scenario (deleted, or never made): the untagged flights still show, as "Scenario 1".
  const n = scenarioOptions(LOG, SC.slice(1), null);
  const u = n.find((x) => x.id === UNTAGGED);
  assert.deepEqual([u.name, u.count, u.deleted], ['Scenario 1', 2, false]);
  assert.deepEqual(n.find((x) => x.id === 's1'), { id: 's1', name: 'Scenario 1', count: 1, deleted: true });
  // The legacy scenario deleted but its id given: tagged and untagged flights stay together.
  const d = scenarioOptions(LOG, SC.slice(1), 's1').find((x) => x.id === 's1');
  assert.deepEqual([d.name, d.count, d.deleted], ['Scenario 1', 3, true]);
  // open() with no args: names from the entries, nothing marked deleted.
  const bare = scenarioOptions(LOG, undefined, null);
  assert.deepEqual(bare.map((x) => [x.name, x.count, x.deleted]), [
    ['Test A', 2, false], ['Renamed then deleted', 2, false], ['Scenario 1', 1, false], ['Scenario 1', 2, false]]);
  assert.deepEqual(scenarioOptions([], SC, 's1').map((x) => x.count), [0, 0, 0]);
  assert.deepEqual(scenarioOptions(null, null, null), []);
  // An entry tagged with no name, for a scenario that's gone.
  assert.equal(scenarioOptions([{ scenarioId: 'x' }], [], null)[0].name, 'Deleted scenario');
});

test('removeScenario: only that scenario\'s entries go', () => {
  assert.deepEqual(removeScenario(LOG, 'a', 's1'), [LOG[0], LOG[1], LOG[2], LOG[4], LOG[5]]);
  assert.deepEqual(removeScenario(LOG, 's1', 's1'), [LOG[3], LOG[4], LOG[5], LOG[6]]); // untagged go with the legacy one
  assert.deepEqual(removeScenario(LOG, 'b', 's1'), LOG);
  assert.notEqual(removeScenario(LOG, 'b', 's1'), LOG); // a copy, never the stored array
  // A null or empty id removes nothing (clearing everything is the caller's explicit choice).
  assert.deepEqual(removeScenario(LOG, null, 's1'), LOG);
  assert.deepEqual(removeScenario(LOG, '', 's1'), LOG);
  assert.deepEqual(removeScenario([null, LOG[3]], 'a'), [null]);
  assert.deepEqual(removeScenario(undefined, 'a'), []);
});

// ---- The aircraft type (v0.3.0) ----

test('type: an entry keeps its type through the store\'s JSON, and one without it is the A321neo', () => {
  const log = JSON.parse(JSON.stringify([{ date: '2026-11-01T00:00:00Z', route: 'RKSS–RKPC', type: 'b789' }, { date: '2026-10-01T00:00:00Z', route: 'RKSS–RKPC' }]));
  assert.equal(log[0].type, 'b789');
  assert.equal(typeName(log[1].type), 'A321neo');
  assert.deepEqual(newestFirst(log).map((x) => x.e.type), ['b789', undefined]);
  assert.equal(totals(log).flights, 2, 'the totals count every type');
});
