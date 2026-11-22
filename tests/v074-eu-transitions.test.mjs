// v0.7.4, fix 3: an airport's own transition altitude stops at its country's border ("Found while building v0.7.1":
// Malpensa's 6,000 ft reached Lugano, where Switzerland's 7,000 ft applies), unless its entry lists more countries;
// and Gibraltar's own ground reads Gibraltar, not Spain ("Found while building v0.7.3": the 2 km raster). From a
// process opened in Europe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url)) {
  const { toMap } = await import('../src/world/frame.js');
  const { setGeoRules, rulesAt, countryAt } = await import('../src/world/region.js');
  const { createGeoRules } = await import('../src/world/geo-rules.js');
  const { EUROPE_AIRPORT_TRANSITIONS, EUROPE_ICAO_COUNTRY, EUROPE_RULES, airportCountries } = await import('../src/world/rules-europe.js');
  const { DATA } = await import('./tile-terrain.mjs');
  const have = existsSync(new URL('country.json', DATA));
  const part = (name) => {
    const header = JSON.parse(readFileSync(new URL(name + '.json', DATA), 'utf8'));
    const buf = gunzipSync(readFileSync(new URL(header.file, DATA)));
    return { header, values: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
  if (have) setGeoRules(createGeoRules({ magvar: part('magvar'), country: part('country') }));      // no krmask in Europe
  const FT = 0.3048;
  const R = (la, lo) => rulesAt(...toMap(la, lo));
  const C = (la, lo) => countryAt(...toMap(la, lo));
  const ta = (la, lo) => Math.round(R(la, lo).transAltM / FT);

  test('every airport with its own transition altitude has a country by its prefix', () => {
    for (const [icao, t] of Object.entries(EUROPE_AIRPORT_TRANSITIONS)) {
      const cs = airportCountries(icao, t);
      assert.ok(EUROPE_ICAO_COUNTRY[icao.slice(0, 2)], icao);
      for (const c of cs) assert.ok(EUROPE_RULES[c], `${icao}: ${c}`);
    }
    assert.deepEqual(airportCountries('LFMN', EUROPE_AIRPORT_TRANSITIONS.LFMN), ['FR', 'MC']);
  });

  test("each such airport's own altitude at its own reference point", { skip: !have }, () => {
    for (const [icao, t] of Object.entries(EUROPE_AIRPORT_TRANSITIONS)) {
      assert.equal(C(t.at[0], t.at[1]), EUROPE_ICAO_COUNTRY[icao.slice(0, 2)], `${icao}'s country`);
      assert.equal(ta(t.at[0], t.at[1]), t.taFt, icao);
    }
  });

  test("Malpensa's 6,000 ft stops at the Swiss border: Lugano, 44 km off, has Switzerland's 7,000 ft", { skip: !have }, () => {
    assert.equal(C(46.004, 8.951), 'CH'); assert.equal(ta(46.004, 8.951), 7000);
    assert.equal(R(46.004, 8.951).transAt, undefined);
    assert.equal(ta(45.6306, 8.7281), 6000);                    // Malpensa itself
    assert.equal(ta(45.80, 8.83), 6000);                        // Varese, in Italy, 20 km off: still Malpensa's (Italy's own is 6,000 too)
  });

  test('Geneva and Lyon each hold on their own side of the border; Zurich stops at Germany', { skip: !have }, () => {
    assert.equal(ta(46.2381, 6.1089), 7000);                    // Geneva
    assert.equal(C(46.19, 6.24), 'FR'); assert.equal(ta(46.19, 6.24), 5000);   // Annemasse, France, 11 km from Geneva: France's (it was Geneva's 7,000)
    assert.equal(C(46.07, 6.40), 'FR'); assert.equal(ta(46.07, 6.40), 5000);   // Bonneville, France
    assert.equal(C(46.52, 6.63), 'CH'); assert.equal(ta(46.52, 6.63), 7000);   // Lausanne
    assert.equal(ta(45.726, 5.0901), 5000);                     // Lyon
    assert.equal(C(47.76, 8.84), 'DE'); assert.equal(ta(47.76, 8.84), 5000);   // Singen, Germany, 39 km from Zurich: Germany's (it was Zurich's 7,000)
    assert.equal(ta(47.4647, 8.5492), 7000);
  });

  test("Nice's reaches Monaco (its entry lists it) and not Italy; Copenhagen's stops at Sweden", { skip: !have }, () => {
    assert.equal(C(43.7384, 7.4246), 'MC'); assert.equal(R(43.7384, 7.4246).transAt, undefined);   // Monaco's own 5,000 is Nice's value: the same rule object
    assert.equal(ta(43.7384, 7.4246), 5000);
    assert.equal(C(43.79, 7.61), 'IT'); assert.equal(ta(43.79, 7.61), 6000);   // Ventimiglia, Italy, 35 km from Nice: Italy's 6,000 (it was Nice's 5,000)
    assert.equal(ta(55.6180, 12.6560), 5000);                   // Copenhagen
    assert.equal(C(55.60, 13.00), 'SE'); assert.equal(R(55.60, 13.00).transAt, undefined);   // Malmö: Sweden's own, not Copenhagen's by reach
    assert.equal(C(55.70, 12.30), 'DK'); assert.equal(ta(55.70, 12.30), 5000); // west of Copenhagen, in Denmark: the Copenhagen Area's, not Denmark's 3,000
  });

  test("Gibraltar's own ground is Gibraltar: the airport, the Rock, Europa Point; La Línea and Algeciras are Spain", { skip: !have }, () => {
    for (const [la, lo, what] of [[36.1512, -5.3497, 'the runway'], [36.1512, -5.3655, "09's end"], [36.1512, -5.3362, "27's end"],
      [36.1440, -5.3440, 'the Rock'], [36.1095, -5.3455, 'Europa Point'], [36.1380, -5.3560, 'the town']]) assert.equal(C(la, lo), 'GI', what);
    assert.equal(R(36.1512, -5.3497).timeZone, 'Europe/Gibraltar');
    assert.equal(ta(36.1512, -5.3497), 6000);
    for (const [la, lo, what] of [[36.1640, -5.3490, 'La Línea'], [36.1300, -5.4500, 'Algeciras'], [36.2800, -5.2800, 'San Roque\'s hills']]) assert.equal(C(la, lo), 'ES', what);
  });
}
