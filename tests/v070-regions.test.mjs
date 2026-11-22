// v0.7.0: the region registry, Europe's frame, and saves across regions (briefs/V0-7-0.md Part 2).
//   node --test tests/v070-regions.test.mjs          (FS_REGION=europe runs the registry's side for Europe too)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { REGIONS, REGION_ORDER, DEFAULT_REGION, REGION_ID, REGION, EUROPE_ON, regionOffered, regionsOffered, regionOfSave, regionName,
  AIRPORT_INDEX, airportShortName, airportRegion, dataUrl } from '../src/world/regions.js';
import { ScenarioStore, regionOf, INDEX_KEY, SCEN_PREFIX } from '../src/scenarios.js';
import { greatCircle } from '../src/world/frame.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const game = path.resolve(here, '..');
const child = (region, what = 'frame') => JSON.parse(execFileSync(process.execPath, [path.join(here, 'v070-region-child.mjs'), what],
  { env: { ...process.env, FS_REGION: region }, encoding: 'utf8' }));
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };

test('the registry: two regions, East Asia the default, each with its frame and its folder', () => {
  assert.deepEqual(REGION_ORDER, ['east-asia', 'europe']);
  assert.equal(DEFAULT_REGION, 'east-asia');
  assert.equal(REGION_ID, process.env.FS_REGION === 'europe' ? 'europe' : 'east-asia');
  assert.equal(REGION, REGIONS[REGION_ID]);
  assert.deepEqual(REGIONS['east-asia'].frame, { lat0: 36, lon0: 127.5, lat1: 33, lat2: 38 });   // Korea's cone since v0.1.0
  assert.deepEqual(REGIONS.europe.frame, { lat0: 47, lon0: 4, lat1: 39, lat2: 54 });
  assert.equal(REGIONS['east-asia'].data, 'data/');            // East Asia's files don't move
  assert.equal(REGIONS.europe.data, 'data/europe/');
  assert.equal(regionName('europe'), 'Europe');
  assert.equal(REGIONS.europe.outlineGeo.length, 10);
  assert.equal(REGIONS['east-asia'].outlineGeo, null);         // its outline is its rectangle
  assert.equal(dataUrl('file:///g/src/main.js', '../'), 'file:///g/' + REGION.data);
});

test('Europe waits behind EUROPE_ON: not offered while it is off, East Asia always', () => {
  assert.equal(regionOffered('east-asia'), true);
  assert.equal(regionOffered('europe'), EUROPE_ON);
  assert.equal(regionOffered('atlantis'), false);
  assert.deepEqual(regionsOffered(), EUROPE_ON ? ['east-asia', 'europe'] : ['east-asia']);
});

test("a child process opened in Europe gets Europe's frame, and one opened in East Asia Korea's", () => {
  const eu = child('europe'), ea = child('east-asia');
  assert.equal(eu.region, 'europe'); assert.equal(ea.region, 'east-asia');
  assert.equal(eu.lat0, 47); assert.equal(eu.lon0, 4);
  assert.equal(ea.lat0, 36); assert.equal(ea.lon0, 127.5);
  assert.ok(Math.hypot(...eu.origin) < 1e-6, 'the origin maps to (0, 0)');
  assert.equal(eu.data, 'data/europe/'); assert.equal(eu.dataUrl, 'file:///game/data/europe/');
  assert.equal(ea.data, 'data/'); assert.equal(ea.dataUrl, 'file:///game/data/');
});

test("Europe's frame round-trips to 1e-9 degrees and has the brief's scales and convergence", () => {
  const eu = child('europe');
  assert.ok(eu.roundTripDeg < 1e-9, `round trip ${eu.roundTripDeg}`);
  const pc = (s) => (s - 1) * 100;
  // briefs/V0-7-0.md: +0.74 % at Gibraltar, -0.85 % at 47 N, -0.13 % at Dublin, +0.54 % at Edinburgh, +1.7 % at 59 N.
  assert.ok(Math.abs(pc(eu.scale.gibraltar) - 0.74) < 0.01, String(pc(eu.scale.gibraltar)));
  assert.ok(Math.abs(pc(eu.scale.at47) + 0.85) < 0.01, String(pc(eu.scale.at47)));
  assert.ok(Math.abs(pc(eu.scale.dublin) + 0.13) < 0.01, String(pc(eu.scale.dublin)));
  assert.ok(Math.abs(pc(eu.scale.edinburgh) - 0.54) < 0.01, String(pc(eu.scale.edinburgh)));
  assert.ok(Math.abs(pc(eu.scale.north) - 1.70) < 0.01, String(pc(eu.scale.north)));
  // Lisbon about -9.6 degrees, Vienna about +9.2 (the cone's constant, about 0.7275, times the longitude from 4 E).
  assert.ok(Math.abs(eu.convergenceDeg.lisbon + 9.56) < 0.05, String(eu.convergenceDeg.lisbon));
  assert.ok(Math.abs(eu.convergenceDeg.vienna - 9.14) < 0.05, String(eu.convergenceDeg.vienna));
  assert.equal(eu.convergenceAtMatches, true);
  // Heathrow to Charles de Gaulle: the map's length over the mean scale of its two ends is the great circle's
  // within 0.3 % (the great circle is the mean sphere's, the frame the ellipsoid's).
  const map = Math.hypot(eu.heathrow[0] - eu.cdg[0], eu.heathrow[1] - eu.cdg[1]);
  const gc = greatCircle(51.4706, -0.4619, 49.0097, 2.5479);
  const scale = (eu.scaleHeathrow + eu.scaleCdg) / 2;
  assert.ok(scale < 0.996 && scale > 0.992, `the scale between London and Paris, ${scale}`);
  assert.ok(Math.abs(map / scale / gc - 1) < 3e-3, `${map} m on the map (scale ${scale}), ${gc} m on the sphere`);
  assert.ok(Math.abs(eu.magPlaneLondon - 0.8) < 0.5, 'the fallback plane near London');
});

test('every listed airport is in the index of all regions, under its file\'s short name', () => {
  for (const [id, r] of Object.entries(REGIONS)) {
    const mf = path.join(game, r.data, 'manifest.json');
    if (!existsSync(mf)) continue;                                   // (Europe's manifest arrives with its bake)
    const m = JSON.parse(readFileSync(mf, 'utf8'));
    for (const f of [...(m.airports || []), ...(m.airportsRegion || []), ...(m.airportsPending || [])]) {
      const a = JSON.parse(readFileSync(path.join(game, r.data, f), 'utf8'));
      assert.ok(AIRPORT_INDEX[a.icao], `${a.icao} is not in AIRPORT_INDEX`);
      assert.equal(airportRegion(a.icao), id, a.icao);
      if (a.shortName) assert.equal(airportShortName(a.icao), a.shortName, a.icao);
    }
  }
  assert.equal(Object.values(AIRPORT_INDEX).filter(([, r]) => r === 'east-asia').length, 29);   // v0.7.5: Cheongju, Kunsan, Itami, Centrair, Hiroshima, Komatsu
  assert.equal(Object.values(AIRPORT_INDEX).filter(([, r]) => r === 'europe').length, 37);   // v0.7.0: Heathrow to Fiumicino, 11; v0.7.1: Toulouse to Manchester, 20; v0.7.2: Düsseldorf to Santiago, 29
  assert.equal(airportShortName('EGLL'), 'Heathrow'); assert.equal(airportRegion('RKSS'), 'east-asia');
  assert.equal(airportShortName('XXXX'), 'XXXX'); assert.equal(airportRegion('XXXX'), null);
});

test('a save without a region is East Asia\'s; a save made in Europe says so, in its entry and its record', () => {
  assert.equal(regionOfSave({}), 'east-asia'); assert.equal(regionOfSave(null), 'east-asia');
  assert.equal(regionOfSave({ region: 'europe' }), 'europe');
  assert.equal(regionOfSave({ region: 'nowhere' }), 'nowhere');     // a region this build doesn't know keeps its tag (never loaded into another's frame)
  assert.equal(regionOfSave({ region: '' }), 'east-asia'); assert.equal(regionOfSave({ region: 7 }), 'east-asia');
  const st = mem(), s = new ScenarioStore(st);
  const a = s.create('An old flight', { v: 1, fresh: true }, { route: 'RKSS 14R → RKPC 07' }, { now: 1000, region: 'east-asia' });
  const b = s.create('To Paris', { v: 1, fresh: true }, { route: 'EGLL 27R → LFPG 26L' }, { now: 2000, region: 'europe' });
  assert.ok(a.ok && b.ok);
  // East Asia's entry and record are written exactly as before v0.7.0: no field.
  assert.equal('region' in a.entry, false); assert.equal('region' in s.get(a.id), false);
  assert.equal(b.entry.region, 'europe'); assert.equal(s.get(b.id).region, 'europe');
  assert.equal(regionOf(s.entry(a.id)), 'east-asia'); assert.equal(regionOf(s.entry(b.id)), 'europe');
  // A write keeps the region; so does a copy.
  assert.ok(s.write(b.id, { v: 1, x: 1 }, { route: 'r', where: 'w' }, 3000).ok);
  assert.equal(s.entry(b.id).region, 'europe'); assert.equal(s.get(b.id).region, 'europe');
  const c = s.duplicate(b.id, { now: 4000 });
  assert.ok(c.ok); assert.equal(regionOf(c.entry), 'europe');
  const d = s.duplicate(a.id, { now: 5000 });
  assert.equal(regionOf(d.entry), 'east-asia'); assert.equal('region' in d.entry, false);
  // The Load list by region: the page's region first, each newest first, an empty region left out.
  const g = s.byRegion('europe');
  assert.deepEqual(g.map((x) => x.region), ['europe', 'east-asia']);
  assert.deepEqual(g[0].entries.map((e) => e.id), [c.id, b.id]);
  assert.deepEqual(g[1].entries.map((e) => e.id), [d.id, a.id]);
  assert.deepEqual(s.byRegion('east-asia').map((x) => x.region), ['east-asia', 'europe']);
  s.remove(b.id); s.remove(c.id);
  assert.deepEqual(s.byRegion('europe').map((x) => x.region), ['east-asia']);
});

test('a v0.6.4 index reads as it was written, every entry East Asia\'s', () => {
  const st = mem(), s = new ScenarioStore(st);
  const old = [{ id: 'abc', name: 'Scenario 1', created: 1, savedAt: 2, type: 'a321neo', summary: { route: 'RKSS 14R → RJTT 34L', where: 'FL350, 120 nm to RJTT' } }];
  st.setItem(INDEX_KEY, JSON.stringify(old));
  st.setItem(SCEN_PREFIX + 'abc', JSON.stringify({ v: 1, id: 'abc', name: 'Scenario 1', savedAt: 2, state: { v: 1 } }));
  assert.deepEqual(s.index(), old);
  assert.equal(regionOf(s.entry('abc')), 'east-asia');
  assert.ok(s.write('abc', { v: 1, y: 2 }, null, 9).ok);
  assert.equal('region' in s.get('abc'), false);            // not rewritten just to say so
  // The legacy scenario from v0.1.4's keys is East Asia's whatever region the page is in.
  const st2 = mem(); st2.setItem('gamedump:flight-sim:logbook', '[]');
  const e = new ScenarioStore(st2).migrate(1234);
  assert.ok(e && e.legacy); assert.equal(regionOf(e), 'east-asia');
});
