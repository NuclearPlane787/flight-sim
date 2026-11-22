// v0.7.6, part 6 (Shane, 2026-11-22, after v0.7.5's pictures: "Band it"): East Asia's aurora by latitude, as Europe's
// has been since v0.7.4: full at 44 N and north of it, nothing at 40 N and south of it, smooth between. Until v0.7.5
// East Asia's showed on every clear night, over Tokyo, Nagoya and Osaka too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auroraByLatitude } from '../src/world/sky.js';
import { REGIONS } from '../src/world/regions.js';

const EA = REGIONS['east-asia'], EU = REGIONS.europe;
const f = (lat) => auroraByLatitude(lat, EA.aurora);
const latOf = (icao) => JSON.parse(readFileSync(new URL(`../data/airports/${icao}.json`, import.meta.url), 'utf8')).lat;

test("East Asia's band is 40 to 44 N; Europe's is as v0.7.4 left it", () => {
  assert.deepEqual(EA.aurora, { fadeLat: 40, fullLat: 44 });
  assert.deepEqual(EU.aurora, { fadeLat: 50, fullLat: 56 });
});

test('none at 40 N and south: Sendai, Tokyo, Nagoya, Osaka, Seoul, Jeju', () => {
  for (const icao of ['RJSS', 'RJTT', 'RJGG', 'RJOO', 'RKSS', 'RKPC', 'ZBAA']) {
    const lat = latOf(icao);
    assert.ok(lat <= 40.2, `${icao} ${lat}`);
    assert.ok(f(lat) < 0.002, `${icao} at ${lat}: ${f(lat)}`);
  }
  for (const icao of ['RJSS', 'RJTT', 'RJGG', 'RJOO', 'RKSS', 'RKPC']) assert.equal(f(latOf(icao)), 0, icao);
  assert.equal(f(40), 0); assert.equal(f(29), 0);
});

test('faint at Aomori (about 40.7 N), strong over Hokkaido and at Vladivostok, full at 44 N and north', () => {
  const aomori = f(latOf('RJSA')), chitose = f(latOf('RJCC')), vlad = f(latOf('UHWW'));
  assert.ok(aomori > 0.03 && aomori < 0.2, `Aomori ${aomori}`);
  assert.ok(chitose > 0.7 && chitose < 0.9, `New Chitose ${chitose}`);       // 42.78 N: about 0.78
  assert.ok(vlad > 0.9 && vlad < 1, `Vladivostok ${vlad}`);                 // 43.40 N: about 0.94
  assert.equal(f(44), 1); assert.equal(f(45.4), 1);                         // Wakkanai's latitude
  assert.ok(aomori < chitose && chitose < vlad);
});

test('smooth and rising between', () => {
  let last = 0;
  for (let lat = 39; lat <= 45; lat += 0.05) { const v = f(lat); assert.ok(v >= last - 1e-12 && v - last < 0.03, `${lat}`); last = v; }
});
