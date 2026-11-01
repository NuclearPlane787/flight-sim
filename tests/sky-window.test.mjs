// The Sky window's pure helpers (src/ui/sky-window.js): the track, the day jumps, the KST
// fields of the setup's start time, the sky's colours and the light's names.
//   node --test games/flight-sim/tests/sky-window.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  trackTime, trackFraction, shiftDays, todayKeepingTime, kstFieldValues, kstFromFields,
  skyColors, phaseOf, chartFrame, fmtSpeed, fmtDur, moonName,
} from '../src/ui/sky-window.js';
import { kstMs, startOfKstDay, fmtKst, fmtKstDate } from '../src/clock.js';
import { sunEvents, moonPhase } from '../src/astro.js';

const SEOUL = [37.5665, 126.978];

test('the track picks a time of the day, to the minute, inside the day', () => {
  const t0 = kstMs(2026, 11, 1);
  assert.equal(fmtKst(trackTime(t0, 0.5)), '12:00');
  assert.equal(fmtKst(trackTime(t0, 0)), '00:00');
  assert.equal(fmtKst(trackTime(t0, 1)), '23:59');
  assert.equal(fmtKst(trackTime(t0, 1.4)), '23:59');
  assert.equal(fmtKst(trackTime(t0, -0.2)), '00:00');
  assert.equal(fmtKst(trackTime(t0, 21.5 / 24)), '21:30');
  assert.equal(startOfKstDay(trackTime(t0, 0.99)), t0);
  assert.ok(Math.abs(trackFraction(kstMs(2026, 11, 1, 18)) - 0.75) < 1e-12);
});

test('a day back, a day forward and Today keep the time of day', () => {
  const t = kstMs(2026, 11, 1, 21, 34);
  assert.equal(fmtKstDate(shiftDays(t, -1)), 'Sat 31 Oct 2026');
  assert.equal(fmtKstDate(shiftDays(t, 1)), 'Mon 2 Nov 2026');
  assert.equal(fmtKst(shiftDays(t, 1)), '21:34');
  // Today: the date of now in KST (01:10 KST on 24 Nov is still 23 Nov in UTC)
  const now = kstMs(2026, 11, 24, 1, 10);
  const r = todayKeepingTime(t, now);
  assert.equal(fmtKstDate(r), 'Tue 24 Nov 2026');
  assert.equal(fmtKst(r), '21:34');
});

test('the start time fields are KST, whatever the timezone', () => {
  const t = kstMs(2026, 12, 21, 7, 5);
  assert.deepEqual(kstFieldValues(t), { date: '2026-12-21', time: '07:05' });
  assert.equal(kstFromFields('2026-12-21', '07:05'), t);
  assert.equal(kstFromFields('2026-01-01', '00:00'), kstMs(2026, 1, 1));
  assert.equal(kstFromFields('2026-02-31', '12:00'), null);
  assert.equal(kstFromFields('', '12:00'), null);
  assert.equal(kstFromFields('2026-11-01', ''), null);
  assert.equal(kstFromFields('2026-11-01', '24:00'), null);
  for (const ms of [Date.UTC(2026, 5, 1, 15, 0), Date.UTC(2026, 10, 30, 23, 59)]) {
    const v = kstFieldValues(ms);
    assert.equal(kstFromFields(v.date, v.time), Math.floor(ms / 60e3) * 60e3);
  }
});

test('the jumps land on the right times (Seoul, 21 Dec 2026)', () => {
  const ev = sunEvents(kstMs(2026, 12, 21, 15), ...SEOUL);
  assert.equal(fmtKst(ev.set), '17:17');
  assert.ok(['07:42', '07:43', '07:44'].includes(fmtKst(ev.rise)), fmtKst(ev.rise));
  assert.equal(fmtKst(ev.noon).slice(0, 3), '12:');
});

test('the sky darkens with the sun and never goes pure black', () => {
  const day = skyColors(35), dusk = skyColors(-3), night = skyColors(-30);
  const lum = (c) => c[0] + c[1] + c[2];
  assert.ok(lum(day.zenith) > lum(dusk.zenith) && lum(dusk.zenith) > lum(night.zenith));
  assert.ok(dusk.horizon[0] > dusk.horizon[2], 'an orange horizon at dusk');
  assert.ok(day.zenith[2] > day.zenith[0], 'a blue sky by day');
  assert.ok(lum(night.zenith) > 0);
  assert.deepEqual(skyColors(NaN), skyColors(-90));
});

test('the light has a name', () => {
  assert.equal(phaseOf(30, false).name, 'Day');
  assert.equal(phaseOf(3, false).name, 'Golden hour');
  assert.equal(phaseOf(-3, false).name, 'Dusk');
  assert.equal(phaseOf(-3, true).name, 'Dawn');
  assert.equal(phaseOf(-9, true).name, 'Nautical twilight');
  assert.equal(phaseOf(-15, true).name, 'Astronomical twilight');
  assert.equal(phaseOf(-40, true).name, 'Night');
});

test('the little sky: south in the middle, the horizon, the ground band', () => {
  const F = chartFrame(360, 100);
  assert.equal(F.x(180), 180); assert.equal(F.x(90), 90); assert.equal(F.x(-90), 270);
  assert.equal(F.y(0), F.hy);
  assert.ok(F.y(80) < F.y(10) && F.y(10) < F.hy);
  assert.equal(F.y(-30), 100); assert.equal(F.y(-60), 100);
  assert.ok(F.y(-6) > F.hy && F.y(-6) < F.y(-12));
});

test('the Moon phase in words, the speed and durations', () => {
  const full = moonPhase(kstMs(2026, 11, 24, 23, 53)), nu = moonPhase(kstMs(2026, 11, 9, 16, 2));
  assert.equal(moonName(full.illum, full.waxing), 'Full moon');
  assert.equal(moonName(nu.illum, nu.waxing), 'New moon');
  assert.equal(moonName(0.2, true), 'Waxing crescent');
  assert.equal(moonName(0.5, false), 'Last quarter');
  assert.equal(moonName(0.8, false), 'Waning gibbous');
  assert.equal(fmtSpeed(600), '600×');
  assert.equal(fmtDur(125 * 60e3), '2 h 5 min');
  assert.equal(fmtDur(12 * 60e3), '12 min');
});
