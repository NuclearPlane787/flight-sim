// v0.6.0 Part 5 step 8: local time. The clock shown in the zone where you are (clock.js's zoneAt(), from region.js's
// rulesAt(): Asia/Seoul, Asia/Pyongyang, Asia/Tokyo, Asia/Shanghai through Intl, no fixed offsets), at each airport and
// at sea between them; the 15:00 default at the departure; with the region off, KST everywhere and v0.5.8's strings.
//   node --test tests/v060-localtime.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toMap } from '../src/world/frame.js';
import { loadNodeRules, uninstallNodeRules } from './v060-rules-helpers.mjs';
import {
  kstMs, fmtKst, fmtKstDate, startOfKstDay, KST_ZONE, zoneAt, zoneOfIcao, zoneLabel, zoneParts, zoneOffsetMs, zoneMs,
  startOfZoneDay, afternoonIn, fmtZone, fmtZoneDate, zoneFieldValues, zoneFromFields, localTimeOn,
} from '../src/clock.js';
import { afternoonKst, afternoonAt, ScenarioStore, LASTFLIGHT_KEY } from '../src/scenarios.js';
import { kstFieldValues, kstFromFields } from '../src/ui/sky-window.js';

const ICAOS = ['RKSS', 'RKPC', 'RKSI', 'RKPK', 'RJTT', 'RJAA', 'RJBB', 'RJFF', 'ZSPD', 'ZSSS', 'ZSQD', 'ZSYN'];   // (ZSYN: v0.6.1)
const AIRPORTS = ICAOS.map((id) => JSON.parse(readFileSync(new URL(`../data/airports/${id}.json`, import.meta.url), 'utf8')));
// (v0.7.0: v0.6.0's region flag is gone; withRegion() installs the local rules alone.)
const withRegion = (fn) => { loadNodeRules(); try { return fn(); } finally { uninstallNodeRules(); } };
const T = kstMs(2026, 11, 19, 15, 0);   // 15:00 KST, Thursday 19 November 2026

// (v0.7.0: the flag-off half of this test went with the flag: localTimeOn() false, KST at every airport and
// for ZSPD, afternoonAt(ZSPD) = afternoonKst. The KST functions' own checks stay.)
test('the KST functions as v0.5.8, and the zone functions agree with them in Seoul', () => {
  assert.equal(localTimeOn(), true);   // (v0.7.0: always)
  assert.equal(fmtKst(T), '15:00');
  assert.equal(fmtKstDate(T), 'Thu 19 Nov 2026');
  // the zone functions agree with the KST ones in Seoul, minute by minute through a day
  for (let t = startOfKstDay(T); t < startOfKstDay(T) + 86400e3; t += 7 * 60e3 + 13e3) {
    assert.equal(fmtZone(t, KST_ZONE), fmtKst(t));
    assert.equal(fmtZoneDate(t, KST_ZONE), fmtKstDate(t));
    assert.equal(startOfZoneDay(t, KST_ZONE), startOfKstDay(t));
    assert.deepEqual(zoneFieldValues(t, KST_ZONE), kstFieldValues(t));
  }
  assert.equal(zoneFromFields('2026-11-19', '15:00', KST_ZONE), kstFromFields('2026-11-19', '15:00'));
});

test('flag on: each airport\'s zone and its label (KST, JST, CST)', () => withRegion(() => {
  const want = { RK: ['Asia/Seoul', 'KST'], RJ: ['Asia/Tokyo', 'JST'], ZS: ['Asia/Shanghai', 'CST'] };
  for (const a of AIRPORTS) {
    const z = zoneAt(a.origin[0], a.origin[1]), [tz, name] = want[a.icao.slice(0, 2)];
    assert.deepEqual(z, { timeZone: tz, zoneName: name }, a.icao);
    assert.deepEqual(zoneOfIcao(a.icao), z, `${a.icao} by its code`);
    assert.equal(zoneLabel(z), name);
  }
  // 15:00 KST is 15:00 JST and 14:00 CST, the same instant
  const at = (id) => { const a = AIRPORTS.find((x) => x.icao === id); return zoneAt(a.origin[0], a.origin[1]); };
  assert.equal(fmtZone(T, at('RJTT')), '15:00');
  assert.equal(fmtZone(T, at('ZSPD')), '14:00');
  assert.equal(fmtZoneDate(kstMs(2026, 11, 20, 0, 30), at('ZSPD')), 'Thu 19 Nov 2026');   // 23:30 CST the day before
  assert.equal(fmtZoneDate(kstMs(2026, 11, 20, 0, 30), at('RJTT')), 'Fri 20 Nov 2026');
}));

test('flag on: at sea between them, the nearest land\'s zone; North Korea is Pyongyang\'s', () => withRegion(() => {
  const z = (lat, lon) => zoneAt(...toMap(lat, lon)).zoneName;
  assert.equal(z(30, 125), 'CST');      // the East China Sea, off Shanghai
  assert.equal(z(33.5, 126.0), 'KST');  // off Jeju
  assert.equal(z(37, 133), 'JST');      // the Sea of Japan
  assert.equal(zoneAt(...toMap(39.03, 125.75)).timeZone, 'Asia/Pyongyang');
  // the line between Korea and Japan lies in the Korea Strait: Busan's side Korea's, Tsushima's Japan's
  assert.equal(z(35.0, 129.0), 'KST');
  assert.equal(z(34.4, 129.3), 'JST');
}));

test('the offsets come from Intl, so a zone with summer time works too (no fixed offsets)', () => {
  assert.equal(zoneOffsetMs(T, 'Asia/Seoul'), 9 * 3600e3);
  assert.equal(zoneOffsetMs(T, 'Asia/Shanghai'), 8 * 3600e3);
  assert.equal(zoneOffsetMs(Date.UTC(2026, 6, 1, 12), 'America/New_York'), -4 * 3600e3);
  assert.equal(zoneOffsetMs(Date.UTC(2026, 0, 1, 12), 'America/New_York'), -5 * 3600e3);
  // 02:30 on the spring-forward night doesn't exist: the later reading; and a wall time round-trips through its fields
  assert.equal(fmtZone(zoneMs(2026, 7, 1, 9, 15, 0, 'America/New_York'), 'America/New_York'), '09:15');
  for (const tz of ['Asia/Tokyo', 'Asia/Shanghai', 'Europe/London']) {
    const ms = zoneFromFields('2026-08-02', '06:45', tz);
    assert.deepEqual(zoneFieldValues(ms, tz), { date: '2026-08-02', time: '06:45' }, tz);
    assert.deepEqual(zoneParts(ms, tz), { y: 2026, mo: 8, d: 2, h: 6, mi: 45, s: 0, dow: 0 });
  }
  assert.equal(zoneFromFields('2026-02-31', '10:00', 'Asia/Tokyo'), null);
  assert.equal(zoneFromFields('', '10:00', 'Asia/Tokyo'), null);
});

test('flag on: the 15:00 default is at the departure (Scenario 1 made from a Pudong last flight starts at 15:00 CST)', () => withRegion(() => {
  assert.equal(afternoonIn(T, 'Asia/Shanghai'), Date.UTC(2026, 10, 19, 7));
  assert.equal(afternoonAt(T, 'ZSPD'), Date.UTC(2026, 10, 19, 7));
  assert.equal(afternoonAt(T, 'RJTT'), afternoonKst(T));
  assert.equal(afternoonAt(T, 'RKSS'), afternoonKst(T));
  const m = new Map(), st = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  st.setItem(LASTFLIGHT_KEY, JSON.stringify({ origin: 'ZSPD', depRunway: '34L', dest: 'RJTT', arrRunway: '34R', start: 'runway', pax: 190, cargoKg: 1500, fuelKg: 6000, waypoints: [] }));
  const s = new ScenarioStore(st), e = s.migrate(T);
  assert.equal(fmtZone(s.get(e.id).state.clock.ms, 'Asia/Shanghai'), '15:00');
}));

test('the epoch ms never change: only what is shown', () => withRegion(() => {
  const a = AIRPORTS.find((x) => x.icao === 'ZSPD'), z = zoneAt(a.origin[0], a.origin[1]);
  const v = zoneFieldValues(T, z);
  assert.equal(zoneFromFields(v.date, v.time, z), T);
  assert.equal(startOfZoneDay(T, z), Date.UTC(2026, 10, 18, 16));
}));
