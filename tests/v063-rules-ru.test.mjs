// v0.6.3 Part 3 (briefs/V0-6-3.md): Russia's rules, as AIP Russia gives them for Vladivostok (read 2026-11-20:
// UHWW AD 2.17 and the ILS Z 25L chart, ENR 1.7, GEN 2.1), and the country raster's Russia.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createGeoRules, COUNTRY_NAMES } from '../src/world/geo-rules.js';
import { setEastAsia, setGeoRules, rulesAt, countryAt, COUNTRY_RULES } from '../src/world/region.js';
import { toMap } from '../src/world/frame.js';
import { metarOf, metarFormOf, presetWeather } from '../src/sim/weather-presets.js';
import { zoneOfIcao, zoneAt } from '../src/clock.js';
import { airportCountry, airportGroups, AIRPORT_ORDER, COUNTRY_LABEL } from '../src/ui/setup.js';

const D = new URL('../data/', import.meta.url);
const gz = (n) => { const b = zlib.gunzipSync(fs.readFileSync(new URL(n, D))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const json = (n) => JSON.parse(fs.readFileSync(new URL(n, D), 'utf8'));
const geo = createGeoRules({ magvar: { header: json('magvar.json'), values: gz('magvar.i16.gz') }, country: { header: json('country.json'), values: gz('country.u8.gz') }, krmask: { header: json('krmask.json'), values: gz('krmask.u8.gz') } });
const FT = 0.3048;
const on = (fn) => { const was = [setEastAsia(true), setGeoRules(geo)]; try { return fn(); } finally { void was; } };

test('the raster: Russia is its own country (code 6), and nothing else moved', () => on(() => {
  assert.equal(COUNTRY_NAMES[6], 'RU');
  for (const [name, lat, lon, c] of [['Vladivostok', 43.1155, 131.8855, 'RU'], ['Vladivostok\'s airport', 43.396, 132.148, 'RU'], ['Ussuriysk', 43.80, 131.95, 'RU'],
    ['Seoul', 37.5665, 126.978, 'KR'], ['Pyongyang', 39.03, 125.75, 'KP'], ['Tokyo', 35.68, 139.77, 'JP'], ['Beijing', 39.905, 116.397, 'CN'], ['Shenyang', 41.80, 123.43, 'CN'],
    ['Yanji', 42.89, 129.50, 'CN'], ['Sapporo', 43.06, 141.35, 'JP'], ['Ulaanbaatar\'s side of the border', 45.5, 113.5, 'other']]) {
    const [x, y] = toMap(lat, lon);
    assert.equal(countryAt(x, y), c, name);
  }
  // The sea off Vladivostok is Russia's (its nearest land), the sea off Sokcho Korea's.
  assert.equal(countryAt(...toMap(42.7, 132.2)), 'RU');
  assert.equal(countryAt(...toMap(38.2, 128.9)), 'KR');
}));

test('Russia\'s rules at Vladivostok: hPa and feet, 8,000 ft / FL090, UTC+10, the wind in metres per second', () => on(() => {
  const r = rulesAt(...toMap(43.396, 132.148));
  assert.equal(r.country, 'RU');
  assert.equal(r.baroUnit, 'hPa');
  assert.equal(r.metricAlt, false);
  assert.ok(Math.abs(r.transAltM - 8000 * FT) < 1e-9 && Math.abs(r.transLevelM - 9000 * FT) < 1e-9);
  assert.equal(r.timeZone, 'Asia/Vladivostok');
  assert.equal(r.zoneName, 'VLAT');
  assert.equal(r.metar, 'ru');
  // UTC+10 the year round, by the browser's own zone data.
  for (const ms of [Date.UTC(2026, 0, 15, 2, 0), Date.UTC(2026, 6, 15, 2, 0)]) {
    assert.equal(new Intl.DateTimeFormat('en-GB', { timeZone: r.timeZone, hour: '2-digit', hour12: false }).format(ms), '12');
  }
  assert.deepEqual(zoneOfIcao('UHWW'), { timeZone: 'Asia/Vladivostok', zoneName: 'VLAT' });
  assert.equal(zoneAt(...toMap(43.396, 132.148)).zoneName, 'VLAT');
  // The other countries' rules are as they were.
  assert.equal(COUNTRY_RULES.KR.transAltM, 14000 * FT); assert.equal(COUNTRY_RULES.JP.baroUnit, 'inHg'); assert.equal(COUNTRY_RULES.CN.transAltM, 3000);
}));

test('a Russian METAR: metres per second, Q in hPa', () => on(() => {
  assert.equal(metarFormOf('UHWW'), 'ru');
  assert.equal(metarFormOf('ZBAA'), 'cn'); assert.equal(metarFormOf('RKSS'), 'kr'); assert.equal(metarFormOf('RJCC'), 'jp');
  const line = metarOf(presetWeather('rain', { refX: 0, refY: 0 }), 'UHWW');
  assert.match(line, /^UHWW \d{5}(G\d{2})?MPS /, line);
  assert.match(line, / Q\d{4}/, line);
  assert.ok(!/RMK A\d{4}/.test(line), 'no inches');
  assert.match(metarOf(presetWeather('rain', { refX: 0, refY: 0 }), 'RKSS'), /KT /);
}));

test('the setup\'s lists: Russia after North Korea, Beijing\'s two first in China', () => on(() => {
  // (v0.6.4 added Japan's northern four and North Korea's two to AIRPORT_ORDER: tests/v064-*.test.mjs has theirs.)
  assert.equal(airportCountry({ icao: 'UHWW' }), 'RU');
  assert.equal(COUNTRY_LABEL.RU, 'Russia');
  const groups = airportGroups(AIRPORT_ORDER.map((icao) => ({ icao })));
  assert.deepEqual(groups.map((g) => g.country), ['KR', 'JP', 'CN', 'KP', 'RU']);   // (KP: v0.6.4's Pyongyang and Wonsan)
  assert.deepEqual(groups.find((g) => g.country === 'CN').airports.map((a) => a.icao), ['ZBAA', 'ZBAD', 'ZSPD', 'ZSSS', 'ZSYN', 'ZSQD', 'ZYTL', 'ZYTX']);
  assert.deepEqual(groups.find((g) => g.country === 'RU').airports.map((a) => a.icao), ['UHWW']);
}));

// The review (2026-11-20): with the region's flag off none of this may show. The tests above switch the region
// on, so the flags-off run never looked: here it is switched off on purpose, and back.
import { fineOutline, terrainSpec } from '../src/world/region.js';
import { standsFor } from '../src/ground/taxi.js';
import { typeById } from '../src/sim/types.js';
import { standHeading } from '../src/world/traffic-layout.js';
test('with the region off: Korea\'s zone, Korea\'s METAR, no outline, Korea everywhere', () => {
  setGeoRules(geo); setEastAsia(false);
  try {
    assert.equal(zoneOfIcao('UHWW').zoneName, 'KST');
    assert.equal(metarFormOf('UHWW'), 'kr');
    assert.match(metarOf(presetWeather('rain', { refX: 0, refY: 0 }), 'UHWW'), /KT /);
    terrainSpec(json('manifest.json'), false);
    assert.equal(fineOutline(), null);
    assert.equal(countryAt(...toMap(43.396, 132.148)), 'KR');
    assert.equal(rulesAt(...toMap(43.396, 132.148)).country, 'KR');
  } finally { setEastAsia(true); }
  terrainSpec(json('manifest.json'), true);
  assert.ok(fineOutline().length > 20, 'and with it on the outline is there');
});

test('Vladivostok\'s widebody stands are the AIP\'s six; a design the A321\'s size keeps the A321\'s stands', () => on(() => {
  const ap = json('airports/UHWW.json');
  for (const st of ap.stands) if (!(st.leadIn && st.leadIn.length > 1)) { st.hdgGridDeg = ((standHeading(ap, st) * 180) / Math.PI + 360) % 360; st.hdgFixed = true; }
  const a321 = typeById('a321neo'), g = a321.geo;
  const all = standsFor(ap, a321).map((s) => s.ref);
  assert.equal(all.length, 23);
  const wide = ['1A', '4', '5A', '6A', '10', '11'];
  for (const id of ['b787-9', 'b777-300er']) {
    const refs = standsFor(ap, typeById(id)).map((s) => s.ref);
    assert.ok(refs.length >= 4 && refs.every((r) => wide.includes(r)), `${id}: ${refs.join(' ')}`);
  }
  const design = { ...a321, base: a321, geo: { ...g, DESIGN_SHAPE: { noseX: g.NOSE_X, lengthM: g.LENGTH, spanM: g.SPAN } } };
  const refs = standsFor(ap, design).map((s) => s.ref);
  assert.ok(refs.length > 12, `an A321-sized design gets ${refs.length} stands, not the widebodies' six`);
  assert.ok(refs.some((r) => !wide.includes(r)));
}));
