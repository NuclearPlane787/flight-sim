// The logbook's and score card's pure helpers: formatting, totals, ordering, the verdict.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtDuration, fmtDate, fmtKg, totals, newestFirst } from '../src/ui/logbook.js';
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
  assert.equal(verdict({ points: 82, parts: parts(300, 1.3) }), 'Firm but fine.');
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
