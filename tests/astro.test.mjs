// The sun, the Moon and sidereal time (src/astro.js), against PyEphem and Meeus's examples,
// and the baked star catalogue (data/stars.json).
//   node --test games/flight-sim/tests/astro.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  julianDay, gmstDeg, lstDeg, sunEquatorial, sunHorizontal, sunEvents, sunCrossing,
  moonEquatorial, moonHorizontal, moonPhase, moonEvents, equatorialToHorizontal,
  precessFromJ2000, j2000ToEnuMatrix, galacticToEquatorial,
} from '../src/astro.js';
import { kstMs, startOfKstDay } from '../src/clock.js';

const SEOUL = [37.5665, 126.9780];
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tolerance ${tol})`);
const angNear = (a, b, tol, what) => near(((a - b + 540) % 360) - 180, 0, tol, what);
const MIN = 60e3;

test('the Julian day and sidereal time match Meeus (examples 7.a, 12.a, 12.b)', () => {
  near(julianDay(Date.UTC(1957, 9, 4, 19, 26, 24)), 2436116.31, 1e-6, 'JD of Sputnik');
  near(gmstDeg(Date.UTC(1987, 3, 10)), 197.693195, 1e-5, 'GMST 1987 Apr 10 0h');
  near(gmstDeg(Date.UTC(1987, 3, 10, 19, 21)), 128.7378734, 1e-5, 'GMST 1987 Apr 10 19:21');
  near(lstDeg(Date.UTC(1987, 3, 10), 77.0656), (197.693195 + 77.0656) % 360, 1e-5, 'LST east of Greenwich');
});

test('the sun matches Meeus example 25.a', () => {
  const s = sunEquatorial(Date.UTC(1992, 9, 13));
  near(s.raDeg, 198.38083, 0.001, 'RA');
  near(s.decDeg, -7.78507, 0.001, 'Dec');
  near(s.distAu, 0.99766, 1e-4, 'distance');
});

test('Seoul, 21 June 2026: sunrise 05:11, sunset 19:57 KST, 75.9 degrees up at noon (PyEphem)', () => {
  const e = sunEvents(kstMs(2026, 6, 21, 12), ...SEOUL);
  near(e.rise, kstMs(2026, 6, 21, 5, 11), 2 * MIN, 'sunrise');
  near(e.set, kstMs(2026, 6, 21, 19, 57), 2 * MIN, 'sunset');
  near(e.noonAltDeg, 75.9, 0.3, 'noon altitude');
  near(e.noon, (e.rise + e.set) / 2, 2 * MIN, 'noon halfway between');
});

test('Seoul, 21 December 2026: sunrise 07:43, sunset 17:17 KST, 29.0 degrees up at noon (PyEphem)', () => {
  const e = sunEvents(kstMs(2026, 12, 21, 3), ...SEOUL);
  near(e.rise, kstMs(2026, 12, 21, 7, 43), 2 * MIN, 'sunrise');
  near(e.set, kstMs(2026, 12, 21, 17, 17), 2 * MIN, 'sunset');
  near(e.noonAltDeg, 29.0, 0.3, 'noon altitude');
});

test('the events belong to the KST day asked for, and the twilights nest around them', () => {
  const ms = kstMs(2026, 11, 1, 23, 59);
  const e = sunEvents(ms, ...SEOUL);
  const t0 = startOfKstDay(ms);
  for (const t of [e.rise, e.set, e.noon]) assert.ok(t >= t0 && t < t0 + 86400e3);
  const { civil, nautical, astronomical } = e.twilight;
  assert.ok(astronomical.dawn < nautical.dawn && nautical.dawn < civil.dawn && civil.dawn < e.rise);
  assert.ok(e.set < civil.dusk && civil.dusk < nautical.dusk && nautical.dusk < astronomical.dusk);
  near(sunHorizontal(civil.dusk, ...SEOUL).altDeg, -6, 0.01, 'the sun at civil dusk');
  // the sun is due south at noon, and highest then
  angNear(sunHorizontal(e.noon, ...SEOUL).azDeg, 180, 0.1, 'azimuth at noon');
  assert.ok(sunHorizontal(e.noon + 20 * MIN, ...SEOUL).altDeg < e.noonAltDeg);
  // in the morning the sun is in the east, in the evening in the west
  assert.ok(sunHorizontal(e.rise, ...SEOUL).azDeg < 180 && sunHorizontal(e.set, ...SEOUL).azDeg > 180);
});

test('a crossing that never happens is null (midsummer far north)', () => {
  const c = sunCrossing(kstMs(2026, 6, 21, 12), 78, 15, -18);
  assert.equal(c.rise, null);
  assert.equal(c.set, null);
});

test('the Moon matches Meeus example 47.a (main terms only: within 0.01 degree)', () => {
  const m = moonEquatorial(Date.UTC(1992, 3, 12));
  near(m.lamDeg, 133.167265, 0.01, 'longitude');
  near(m.betaDeg, -3.229126, 0.01, 'latitude');
  near(m.distKm, 368409.7, 50, 'distance');
  near(m.raDeg, 134.688470, 0.01, 'RA');
  near(m.decDeg, 13.768368, 0.01, 'Dec');
});

test('the Moon: full at 23:53 KST on 24 November 2026, new at 16:02 KST on 9 November 2026', () => {
  const full = moonPhase(kstMs(2026, 11, 24, 23, 53));
  assert.ok(full.illum > 0.97, `full: ${full.illum}`);
  near(full.elongDeg, 180, 6, 'elongation at full');
  const fresh = moonPhase(kstMs(2026, 11, 9, 16, 2));
  assert.ok(fresh.illum < 0.03, `new: ${fresh.illum}`);
  // a week after new it waxes, about half lit; a week after full it wanes
  const firstQ = moonPhase(kstMs(2026, 11, 17, 0));
  assert.ok(firstQ.waxing && firstQ.illum > 0.3 && firstQ.illum < 0.7, JSON.stringify(firstQ));
  near(firstQ.ageDays, 7.3, 1, 'age at first quarter');
  const lastQ = moonPhase(kstMs(2026, 12, 2, 12));
  assert.ok(!lastQ.waxing && lastQ.illum > 0.3 && lastQ.illum < 0.7, JSON.stringify(lastQ));
});

test("the Moon's parallax lowers it by about its horizontal parallax near the horizon", () => {
  const ms = kstMs(2026, 11, 24, 23, 53);
  const geo = moonEquatorial(ms);
  const geoH = equatorialToHorizontal(geo.raDeg, geo.decDeg, ms, ...SEOUL);
  const top = moonHorizontal(ms, ...SEOUL);
  const drop = geoH.altDeg - top.altDeg, parallax = Math.asin(6378.14 / geo.distKm) * 180 / Math.PI;
  assert.ok(drop > 0 && drop <= parallax + 1e-6, `${drop} vs ${parallax}`);
  near(drop, parallax * Math.cos(top.altDeg * Math.PI / 180), 0.05, 'drop ~ parallax cos(alt)');
});

test('moonrise and moonset come out on the horizon, inside the day', () => {
  const ms = kstMs(2026, 11, 24, 12);
  const e = moonEvents(ms, ...SEOUL);
  const t0 = startOfKstDay(ms);
  // near full the Moon rises around sunset and sets around sunrise
  assert.ok(e.rise > t0 + 15 * 3600e3 && e.rise < t0 + 19 * 3600e3, new Date(e.rise).toISOString());
  assert.ok(e.set > t0 + 4 * 3600e3 && e.set < t0 + 9 * 3600e3, new Date(e.set).toISOString());
  const h = moonHorizontal(e.rise, ...SEOUL);
  near(h.altDeg, -34 / 60 - h.semiDiameterDeg, 0.01, 'altitude at moonrise');
});

test('stars: one matrix (precession and sidereal time) agrees with the step-by-step path', () => {
  const ms = kstMs(2026, 11, 1, 22), [lat, lon] = SEOUL;
  const M = j2000ToEnuMatrix(ms, lat, lon);
  for (const [ra, dec] of [[101.29, -16.72], [279.23, 38.78], [37.95, 89.26], [213.92, 19.18]]) {
    const d = precessFromJ2000(ra, dec, ms);
    const h = equatorialToHorizontal(d.raDeg, d.decDeg, ms, lat, lon);
    const r = Math.PI / 180, v = [Math.cos(dec * r) * Math.cos(ra * r), Math.cos(dec * r) * Math.sin(ra * r), Math.sin(dec * r)];
    const [e, n, u] = [0, 3, 6].map((i) => M[i] * v[0] + M[i + 1] * v[1] + M[i + 2] * v[2]);
    near(Math.asin(u) / r, h.altDeg, 1e-6, 'altitude');
    if (h.altDeg < 89) angNear(Math.atan2(e, n) / r, h.azDeg, 1e-6, 'azimuth');
  }
  // Polaris stays within a degree of the pole's altitude (the latitude), due north
  const pol = precessFromJ2000(37.95, 89.26, ms);
  const ph = equatorialToHorizontal(pol.raDeg, pol.decDeg, ms, lat, lon);
  near(ph.altDeg, lat, 1, "Polaris's altitude");
  // 26 years of precession move a star by about 0.36 degrees
  const vega = precessFromJ2000(279.23, 38.78, ms);
  near(vega.raDeg - 279.23, 0.26, 0.05, "Vega's RA, J2000 to 2026");
});

test('the galactic centre and pole land where they should (J2000)', () => {
  const gc = galacticToEquatorial(0, 0);
  near(gc.raDeg, 266.405, 0.01, 'centre RA');
  near(gc.decDeg, -28.936, 0.01, 'centre Dec');
  const ngp = galacticToEquatorial(0, 90);
  near(ngp.decDeg, 27.128, 0.01, 'north galactic pole');
});

test('the star catalogue: bright stars, brightest first, compact, in range', () => {
  const url = new URL('../data/stars.json', import.meta.url);
  const raw = readFileSync(url, 'utf8');
  assert.ok(raw.length < 250e3, `${raw.length} bytes`);
  const d = JSON.parse(raw);
  assert.equal(d.stars.length, d.count * 4);
  assert.ok(d.count > 8000);
  let prev = -Infinity;
  for (let i = 0; i < d.stars.length; i += 4) {
    const [ra, dec, mag, bv] = d.stars.slice(i, i + 4);
    assert.ok(ra >= 0 && ra < 360 && dec >= -90 && dec <= 90 && mag <= 6.5 && mag >= prev);
    assert.ok(bv === null || (bv > -0.5 && bv < 4), `B-V ${bv}`); // carbon stars reach 3.9
    prev = mag;
  }
  // Sirius first, where it is
  assert.equal(d.names['0'], 'Sirius');
  near(d.stars[0], 101.29, 0.02, "Sirius's RA");
  near(d.stars[1], -16.72, 0.02, "Sirius's Dec");
});
