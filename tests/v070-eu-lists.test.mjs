// v0.7.0: Europe's lists from a page opened in Europe (tests/region-run.mjs): the setup's groups by country and its
// order, the region's first flight, the taxi rules, the plan check, and each baked airport's place in them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { REGION, REGION_ID, AIRPORT_INDEX, defaultPlan, planInRegion, airportShortName } = await import('../src/world/regions.js');
  const { airportGroups, airportCountry, airportShort, AIRPORT_ORDER, COUNTRY_LABEL } = await import('../src/ui/setup.js');
  const { regionRules } = await import('../src/ground/taxi.js');
  const { terrainSpec, regionQuery } = await import('../src/world/region.js');
  const { EUROPE_RULES, EUROPE_AIRPORT_TRANSITIONS, EUROPE_COUNTRY_ORDER, EUROPE_AIRPORT_ORDER } = await import('../src/world/rules-europe.js');
  const DATA = new URL('../' + REGION.data, import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', DATA), 'utf8'));
  const baked = terrainSpec(manifest).airports.map((f) => JSON.parse(readFileSync(new URL(f, DATA), 'utf8')));

  test("Europe's tables: the eleven in the build order's countries, every country with a zone and a rule", () => {
    assert.equal(REGION_ID, 'europe');
    assert.deepEqual(AIRPORT_ORDER, EUROPE_AIRPORT_ORDER);
    assert.deepEqual([...AIRPORT_ORDER].sort(), Object.keys(AIRPORT_INDEX).filter((i) => AIRPORT_INDEX[i][1] === 'europe').sort());
    for (const c of EUROPE_COUNTRY_ORDER) if (c !== 'other') { assert.ok(EUROPE_RULES[c], c); assert.ok(COUNTRY_LABEL[c], c); }
    for (const r of Object.values(EUROPE_RULES)) {
      assert.equal(r.baroUnit, 'hPa'); assert.equal(r.metricAlt, false); assert.equal(r.metar, 'eu');     // hectopascals and feet everywhere
      assert.ok(r.timeZone && r.zoneName && r.zoneNameSummer, r.country);
      assert.ok(r.transLevelM >= r.transAltM + 300, `${r.country}: the level at least 1,000 ft over the altitude`);
      assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', { timeZone: r.timeZone }));
    }
    // v0.7.0's seven countries, and the airports that set their own transition altitude, are all among the eleven's.
    for (const c of ['GB', 'FR', 'DE', 'ES', 'CH', 'NL', 'IT']) assert.ok(EUROPE_RULES[c]);
    for (const i of Object.keys(EUROPE_AIRPORT_TRANSITIONS)) assert.ok(AIRPORT_ORDER.includes(i), i);
    assert.deepEqual(['EGLL', 'LFPG', 'EDDF', 'LEMD', 'LSZH', 'EGKK', 'LFPO', 'EHAM', 'EDDM', 'LEBL', 'LIRF'].map((i) => airportCountry({ icao: i })),
      ['GB', 'FR', 'DE', 'ES', 'CH', 'GB', 'FR', 'NL', 'DE', 'ES', 'IT']);
    assert.equal(regionQuery().includes('region=europe'), true);                  // a worker opens in the page's region
  });

  test("the region's first flight, and a plan from another region doesn't count here", () => {
    assert.deepEqual(defaultPlan(), { origin: 'EGLL', depRunway: '27R', dest: 'LFPG', arrRunway: '26L', start: 'runway' });
    assert.equal(planInRegion({ origin: 'EGLL', dest: 'LEMD' }), true);
    assert.equal(planInRegion({ origin: 'RKSS', dest: 'RKPC' }), false);
    assert.equal(planInRegion({ origin: 'EGLL', dest: 'RJTT' }), false);
    assert.equal(planInRegion(null), false);
    assert.equal(airportShortName('LFPG'), 'Charles de Gaulle'); assert.equal(airportShortName('RKSS'), 'Gimpo');   // the other region's, by the index
  });

  test('every baked airport: in the index under its short name, in its country\'s group in order, on the region\'s taxi rules', { skip: !baked.length }, () => {
    for (const a of baked) {
      assert.ok(AIRPORT_INDEX[a.icao], a.icao); assert.equal(AIRPORT_INDEX[a.icao][1], 'europe');
      assert.equal(a.shortName, AIRPORT_INDEX[a.icao][0], a.icao); assert.equal(airportShort(a), a.shortName);
      assert.equal(regionRules(a), true, a.icao);
      assert.ok(Array.isArray(a.origin) && Math.abs(a.origin[0]) < 1.4e6 && Math.abs(a.origin[1]) < 1.5e6, `${a.icao} in Europe's frame`);
    }
    const groups = airportGroups(baked);
    const flat = groups.flatMap((g) => g.airports.map((a) => a.icao));
    assert.deepEqual(flat, AIRPORT_ORDER.filter((i) => flat.includes(i)));        // the lists' order is the table's
    assert.deepEqual(groups.map((g) => g.country), EUROPE_COUNTRY_ORDER.filter((c) => groups.some((g) => g.country === c)));
    for (const g of groups) { assert.equal(g.label, COUNTRY_LABEL[g.country]); for (const a of g.airports) assert.equal(airportCountry(a), g.country); }
    // The first flight's runways exist once its airports are baked.
    const d = defaultPlan(), end = (i, e) => baked.find((a) => a.icao === i)?.runways.some((r) => r.ends.some((x) => x.ident === e));
    if (baked.some((a) => a.icao === d.origin)) assert.ok(end(d.origin, d.depRunway), `${d.origin} ${d.depRunway}`);
    if (baked.some((a) => a.icao === d.dest)) assert.ok(end(d.dest, d.arrRunway), `${d.dest} ${d.arrRunway}`);
  });
}
