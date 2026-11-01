// The KST clock (src/clock.js): stop, set, speed, time compression, save and restore, formatting.
//   node --test games/flight-sim/tests/clock.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createClock, SPEEDS, snapSpeed, kstParts, kstMs, nowKstMs, fmtKst, fmtKstDate,
  afternoonOf, startOfKstDay,
} from '../src/clock.js';

const T0 = kstMs(2026, 11, 1, 14, 5);

test('it runs with the sim, and stops', () => {
  const c = createClock({ ms: T0 });
  assert.equal(c.running, true);
  assert.equal(c.speed, 1);
  c.step(1.5);
  assert.equal(c.ms, T0 + 1500);
  c.setRunning(false);
  c.step(100);
  assert.equal(c.ms, T0 + 1500);
  c.setRunning(true);
  c.step(0.5);
  assert.equal(c.ms, T0 + 2000);
  c.step(-5); // never backwards
  assert.equal(c.ms, T0 + 2000);
});

test('set jumps anywhere; bad values are ignored', () => {
  const c = createClock({ ms: T0, running: false });
  c.set(kstMs(2026, 12, 21, 7, 43));
  assert.equal(fmtKst(c.ms), '07:43');
  c.set(NaN);
  assert.equal(fmtKst(c.ms), '07:43');
});

test('its speed multiplies, steps through the allowed list, and snaps to it', () => {
  const c = createClock({ ms: T0, speed: 60 });
  c.step(1);
  assert.equal(c.ms, T0 + 60e3);
  assert.equal(c.faster(), 120);
  assert.equal(c.slower(), 60);
  assert.equal(c.slower(), 30);
  c.setSpeed(SPEEDS[0]);
  assert.equal(c.slower(), 1, 'stops at the slowest');
  c.setSpeed(600);
  assert.equal(c.faster(), 600, 'stops at the fastest');
  assert.equal(c.setSpeed(250), 300);
  assert.equal(snapSpeed(0), 1);
  assert.equal(snapSpeed(-3), 1);
  assert.equal(snapSpeed(7), 5);
  assert.equal(createClock({ ms: T0, speed: 1e6 }).speed, 600);
});

test('time compression speeds it up too: main.js passes the sim time it stepped', () => {
  const c = createClock({ ms: T0, speed: 10 });
  const dt = 1 / 60;
  for (let i = 0; i < 60; i++) c.step(dt * 16); // a second of frames at 16x compression
  assert.ok(Math.abs(c.ms - (T0 + 16 * 10 * 1000)) < 0.1, `${c.ms - T0}`);
});

test('serialize and load round-trip, and a bad save changes nothing', () => {
  const a = createClock({ ms: T0 + 0.4, running: false, speed: 30 });
  const saved = JSON.parse(JSON.stringify(a.serialize()));
  assert.deepEqual(saved, { ms: T0, running: false, speed: 30 });
  const b = createClock({ ms: 0 }).load(saved);
  assert.deepEqual(b.serialize(), saved);
  b.load(null);
  b.load({ ms: 'x', running: 1 });
  assert.deepEqual(b.serialize(), saved);
});

test('KST parts, wall-clock ms and formatting (UTC+9, no daylight saving)', () => {
  assert.equal(T0, Date.UTC(2026, 10, 1, 5, 5));
  assert.deepEqual(kstParts(T0), { y: 2026, mo: 11, d: 1, h: 14, mi: 5, s: 0, dow: 0 });
  assert.equal(fmtKst(T0), '14:05');
  assert.equal(fmtKstDate(T0), 'Sun 1 Nov 2026');
  // 23:30 UTC is already the next day in Korea
  const late = Date.UTC(2026, 11, 31, 23, 30);
  assert.equal(fmtKstDate(late), 'Fri 1 Jan 2027');
  assert.equal(fmtKst(late), '08:30');
  // July: still +9 (no DST)
  assert.equal(fmtKst(Date.UTC(2026, 6, 1, 0, 0)), '09:00');
});

test('the day helpers', () => {
  const start = startOfKstDay(T0);
  assert.equal(start, kstMs(2026, 11, 1));
  assert.equal(startOfKstDay(start), start);
  assert.equal(startOfKstDay(start - 1), kstMs(2026, 10, 31));
  assert.equal(afternoonOf(T0), kstMs(2026, 11, 1, 15));
  assert.equal(fmtKst(afternoonOf(kstMs(2026, 11, 1, 23, 59))), '15:00');
  const now = nowKstMs();
  assert.ok(Math.abs(now - Date.now()) < 1000);
  assert.ok(Math.abs(createClock().ms - now) < 1000, 'defaults to now');
});
