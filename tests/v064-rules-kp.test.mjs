// v0.6.4 (briefs/V0-6-4.md): North Korea's rules, as open secondary sources give them (no AIP is online: [EST];
// read 2026-11-21), and the setup's lists with the six new airports.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createGeoRules } from '../src/world/geo-rules.js';
import { setEastAsia, setGeoRules, rulesAt, countryAt, COUNTRY_RULES } from '../src/world/region.js';
import { toMap } from '../src/world/frame.js';
import { metarOf, metarFormOf, presetWeather } from '../src/sim/weather-presets.js';
import { zoneOfIcao } from '../src/clock.js';
import { airportCountry, airportGroups, AIRPORT_ORDER, COUNTRY_LABEL } from '../src/ui/setup.js';

const D = new URL('../data/', import.meta.url);
const gz = (n) => { const b = zlib.gunzipSync(fs.readFileSync(new URL(n, D))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const json = (n) => JSON.parse(fs.readFileSync(new URL(n, D), 'utf8'));
const geo = createGeoRules({ magvar: { header: json('magvar.json'), values: gz('magvar.i16.gz') }, country: { header: json('country.json'), values: gz('country.u8.gz') }, krmask: { header: json('krmask.json'), values: gz('krmask.u8.gz') } });
const FT = 0.3048;
const on = (fn) => { setGeoRules(geo); setEastAsia(true); return fn(); };

test('North Korea\'s rules at Pyongyang and Wonsan: hPa and feet, 12,000 ft / FL130, UTC+9, metres per second', () => on(() => {
  for (const [name, lat, lon] of [['Pyongyang Sunan', 39.224, 125.67], ['Wonsan Kalma', 39.165, 127.488]]) {
    const [x, y] = toMap(lat, lon);
    assert.equal(countryAt(x, y), 'KP', name);
    const r = rulesAt(x, y);
    assert.equal(r.country, 'KP');
    assert.equal(r.baroUnit, 'hPa');
    assert.equal(r.metricAlt, false);
    assert.ok(Math.abs(r.transAltM - 12000 * FT) < 1e-9 && Math.abs(r.transLevelM - 13000 * FT) < 1e-9, name);
    assert.equal(r.timeZone, 'Asia/Pyongyang');
    assert.equal(r.metar, 'kp');
  }
  assert.equal(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Pyongyang', hour: '2-digit', hour12: false }).format(Date.UTC(2026, 6, 15, 3, 0)), '12');
  assert.equal(zoneOfIcao('ZKPY').timeZone, 'Asia/Pyongyang');
  // South of the line Korea's rules stand as they were, and the others'.
  assert.equal(rulesAt(...toMap(37.56, 126.8)).transAltM, 14000 * FT);
  assert.equal(COUNTRY_RULES.KR.metar, 'kr'); assert.equal(COUNTRY_RULES.CN.transAltM, 3000); assert.equal(COUNTRY_RULES.JP.baroUnit, 'inHg');
}));

test('a North Korean weather line: metres per second, Q in hPa; China\'s and Korea\'s forms as they were', () => on(() => {
  assert.equal(metarFormOf('ZKPY'), 'kp'); assert.equal(metarFormOf('ZKWS'), 'kp');
  assert.equal(metarFormOf('ZBAA'), 'cn'); assert.equal(metarFormOf('ZSPD'), 'cn'); assert.equal(metarFormOf('RKSS'), 'kr'); assert.equal(metarFormOf('RJCC'), 'jp'); assert.equal(metarFormOf('UHWW'), 'ru');
  const line = metarOf(presetWeather('rain', { refX: 0, refY: 0 }), 'ZKPY');
  assert.match(line, /^ZKPY \d{5}(G\d{2})?MPS /, line);
  assert.match(line, / Q\d{4}/, line);
  assert.ok(!/RMK A\d{4}/.test(line));
  setEastAsia(false);
  try { assert.equal(metarFormOf('ZKPY'), 'kr'); assert.equal(zoneOfIcao('ZKPY').timeZone, 'Asia/Seoul'); assert.equal(rulesAt(...toMap(39.224, 125.67)).country, 'KR'); } finally { setEastAsia(true); }
}));

test('the setup\'s lists: Japan\'s northern four after Fukuoka, North Korea between China and Russia', () => on(() => {
  assert.equal(airportCountry({ icao: 'ZKPY' }), 'KP'); assert.equal(airportCountry({ icao: 'RJCC' }), 'JP');
  assert.equal(COUNTRY_LABEL.KP, 'North Korea');
  const groups = airportGroups(AIRPORT_ORDER.map((icao) => ({ icao })));
  assert.deepEqual(groups.map((g) => g.country), ['KR', 'JP', 'CN', 'KP', 'RU']);
  assert.deepEqual(groups.find((g) => g.country === 'JP').airports.map((a) => a.icao), ['RJTT', 'RJAA', 'RJBB', 'RJFF', 'RJSN', 'RJSS', 'RJSA', 'RJCC']);
  assert.deepEqual(groups.find((g) => g.country === 'KP').airports.map((a) => a.icao), ['ZKPY', 'ZKWS']);
  assert.equal(AIRPORT_ORDER.length, 23);
  assert.equal(new Set(AIRPORT_ORDER).size, 23);
}));

// The review (2026-11-21): which end a circling-only end is circled from, and no ILS on such an end.
import { createAirports, circleFrom, circlingOnly } from '../src/world/runways.js';
import { standsFor } from '../src/ground/taxi.js';
import { typeById } from '../src/sim/types.js';
import { standHeading } from '../src/world/traffic-layout.js';
test('circling-only ends: Wonsan\'s 33L and 33R are circled from 15R, Gimhae\'s 18L and 18R from 36R and 36L; none shows an ILS', () => on(() => {
  const zkws = json('airports/ZKWS.json'), rkpk = json('airports/RKPK.json');
  createAirports([zkws, rkpk]);
  assert.equal(circleFrom(zkws, '33L').ident, '15R');
  assert.equal(circleFrom(zkws, '33R').ident, '15R', 'not 15L, which is unlit');
  assert.equal(circleFrom(rkpk, '18L').ident, '36R');
  assert.equal(circleFrom(rkpk, '18R').ident, '36L');
  for (const a of [zkws, rkpk]) for (const r of a.runways) for (const e of r.ends) {
    if (circlingOnly(a.icao, e.ident)) { assert.equal(e.circling, true); assert.equal(e.ils, null, `${a.icao} ${e.ident} shows no ILS`); }
  }
  assert.equal(zkws.runways.flatMap((r) => r.ends).find((e) => e.ident === '15R').ils, 'I');
}));

test('the largest aircraft are held to the stands the AIP gives them: New Chitose\'s six, Niigata\'s spot 9', () => on(() => {
  const prep = (icao) => { const ap = json(`airports/${icao}.json`); for (const st of ap.stands) if (!(st.leadIn && st.leadIn.length > 1)) { st.hdgGridDeg = ((standHeading(ap, st) * 180) / Math.PI + 360) % 360; st.hdgFixed = true; } return ap; };
  const b777 = typeById('b777-300er'), g = b777.geo;
  const wide = { ...b777, base: b777, geo: { ...g, SPAN: 72, DESIGN_SHAPE: { noseX: g.NOSE_X, lengthM: g.LENGTH, spanM: 72 } } };   // a code F span
  const cc = standsFor(prep('RJCC'), wide).map((s) => s.ref), sn = standsFor(prep('RJSN'), wide).map((s) => s.ref);
  assert.ok(cc.every((r) => ['27', '47', '48', '49', '57', '58'].includes(r)), `New Chitose, a 72 m span: ${cc.join(' ') || 'none'}`);
  assert.ok(sn.every((r) => r === '9'), `Niigata, a 72 m span: ${sn.join(' ') || 'none'}`);
  // The 777 itself (code E) keeps what it had.
  assert.ok(standsFor(prep('RJCC'), b777).length > 50);
  assert.equal(standsFor(prep('RJSN'), b777).length, 8);
}));
