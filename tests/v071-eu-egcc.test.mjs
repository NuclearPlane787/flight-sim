// v0.7.1: Manchester Airport (EGCC), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v071-eu-egcc.test.mjs). Against the UK's NATS eAIP (EG AD 2 EGCC,
// AIRAC 29 OCT 2026): AD 2.12 05L/23R 3,048 x 45 m and 05R/23L 3,050 x 45 m, true 051.06 / 231.09 and 051.04 / 231.07,
// the landing thresholds' coordinates and elevations, 05L's threshold displaced 427 m, 23R's 183 m and 23L's 186 m.
// AD 2.14: 05L and 23R coded centre-line with five crossbars 914 m (the game's ALSF-II) with TDZ, 05R and 23L 900 m
// (ALSF-I) without; PAPI 3 deg (05L right, the others left); centreline lights at all four. AD 2.19: ILS CAT III to 05L
// and 23R, CAT I to 05R, none to 23L. Magnetic bearings are AD 2.12's true less AD 2.2's variation (0.45 E, 2027).
//   python3 tools/cpu-guard.py -- node --test tests/v071-eu-egcc.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1.0, papiDeg: 3 };
  const C3 = { tdz: true, ils: 'III', approachLights: 'ALSF-II', approachLightsM: 914 };
  const C1 = { tdz: false, approachLights: 'ALSF-I', approachLightsM: 900 };
  airportSuite({
    icao: 'EGCC', patch: 'manchester', coast: false,
    shortName: 'Manchester', name: 'Manchester Airport',
    latLon: [53.349375, -2.279521], elevM: 78.3, pubVar: 0.45,
    runways: [
      { id: '05R/23L', lengthM: 3050, widthM: 45, source: "the UK's NATS eAIP" },
      { id: '05L/23R', lengthM: 3048, widthM: 45, source: "the UK's NATS eAIP" },
    ],
    ends: {
      '05L': { ...E, ...C3, papi: 'right', displacedM: 427, elevFt: 211.8, pubMag: 50.61, trueBrg: 51.06, thr: ['532051.20N', '0021715.95W'] },
      '23R': { ...E, ...C3, displacedM: 183, elevFt: 249.1, pubMag: 230.64, trueBrg: 231.09, thr: ['532140.75N', '0021533.41W'] },
      '05R': { ...E, ...C1, ils: 'I', displacedM: 0, elevFt: 186.3, pubMag: 50.59, trueBrg: 51.04, thr: ['531955.11N', '0021838.38W'] },
      '23L': { ...E, ...C1, ils: null, displacedM: 186, elevFt: 227.0, pubMag: 230.62, trueBrg: 231.07, thr: ['532053.35N', '0021637.94W'] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // 05R [EST]: OSM's only hold at 05R's end sits on the taxiway stub that enters the runway's end, inside its edge
    // 05R [EST, not examined]: the nearest hold a route reaches is 946 m in from 05R's end in OSM's taxiways
    farHolds: { '05R': { m: 1000, reason: "the nearest hold in OSM's taxiways that a route reaches is 946 m in from 05R's end [EST]" } },
    // 05R [EST, not examined]: routes to 05R's hold run 2,091 m along 05R/23L in OSM's taxiways; 23L's landing at 30 % turns
    // back 1,098 m to its exit
    alongRunway: { byEnd: { '05R': 2100 }, reason: "OSM's routes to 05R's hold run 2,091 m along 05R/23L [EST]" },
    knownTaxiIn: { '23L@0.3': "the nearest exit ahead in OSM's taxiways is missing: back along 05R/23L [EST]", '23L@0.45': "the nearest exit ahead in OSM's taxiways is missing: back along 05R/23L [EST]", '23L@0.6': "the nearest exit ahead in OSM's taxiways is missing: back along 05R/23L [EST]", '23L@0.75': "the nearest exit ahead in OSM's taxiways is missing: back along 05R/23L [EST]", '23L@0.9': "the nearest exit ahead in OSM's taxiways is missing: back along 05R/23L [EST]" },
    closeHolds: { '05R': { m: 15, reason: "OSM's hold on the taxiway stub entering 05R's end, 18 m from the centreline" } },
    // OSM's stands; which take a widebody is the geometry's (no AIP_STANDS entry: no parking chart read)
    stands: { min: 125, max: 125, refs: ['1', '109', '113R', '17', '208', '214L', '25', '304', '32', '47', '55', '7', '80L', '911'], gates: 70,
      e787: { min: 111, max: 111 }, e777: { min: 111, max: 111 } },
    countries: ['GB'],
    routes: [['EGCC', 'EGLL', 131.0], ['EGCC', 'EHAM', 262.9], ['EGCC', 'EGKK', 152.9]],
  });
}
