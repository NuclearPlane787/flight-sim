// v0.7.0: Fiumicino (LIRF), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v070-eu-lirf.test.mjs). Italy's AIP (ENAV's eAIP) asks for a login, so
// nothing here is the AIP's [EST]: the runways are OSM's (16R/34L and 16L/34R 3,900 x 60 m, 07/25 3,300 x 45, OSM's
// length tags and OurAirports'), the thresholds' elevations and 07's displacement (411 m) OurAirports', the lights and
// ILS general knowledge of the field: ILS CAT III to 16L, 16R, 34R, CAT I to 34L and 25, none to 07; PAPI left 3 deg at
// every end but 07; TDZ at the CAT III ends. 16C/34C, closed, is a taxiway in OSM.
//   python3 tools/cpu-guard.py -- node --test tests/v070-eu-lirf.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const CAT3 = { tdz: true, papiDeg: 3, ils: 'III', approachLights: 'ALSF-II' };
  const CAT1 = { tdz: false, papiDeg: 3, ils: 'I', approachLights: 'ALSF-I' };
  const OA = { thrSource: 'OurAirports', thrTolM: 25, displacedM: 0 };
  airportSuite({
    icao: 'LIRF', patch: 'fiumicino', coast: true,
    shortName: 'Fiumicino', name: 'Rome Fiumicino Leonardo da Vinci Airport',
    latLon: [41.804532, 12.251998], elevM: 4.0,
    runways: [
      { id: '16R/34L', lengthM: 3900, widthM: 60, source: "OSM's length tag and OurAirports [EST]" },
      { id: '16L/34R', lengthM: 3900, widthM: 60, source: "OSM's length tag and OurAirports [EST]" },
      { id: '07/25', lengthM: 3300, widthM: 45, source: "OSM's length tag and OurAirports [EST]" },
    ],
    ends: {
      '16L': { ...CAT3, ...OA, elevFt: 14, thr: [41.84600068, 12.26150036] },
      '34R': { ...CAT3, ...OA, elevFt: 6, thr: [41.8124003, 12.2755003] },
      '16R': { ...CAT3, ...OA, elevFt: 7, thr: [41.815498, 12.2264] },
      '34L': { ...CAT1, ...OA, elevFt: 8, thr: [41.782001, 12.2404] },
      // 07's threshold: OSM's node where its displaced-threshold way meets the runway's
      '07': { ...OA, thrSource: 'OSM', thrTolM: 15, displacedM: 411, tdz: false, papi: null, papiDeg: null, ils: null, approachLights: null, approachLightsM: 0, centreline: false, elevFt: 7, thr: [41.800608, 12.236793] },
      '25': { ...CAT1, ...OA, centreline: false, elevFt: 5, thr: [41.809631, 12.269483] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // 07 [EST: take-offs mostly]: landing on it, past 60 % there is no exit ahead in OSM (the exits face 25's landings)
    knownTaxiIn: Object.fromEntries([0.6, 0.75, 0.9].map((f) => [`07@${f}`, "no exit ahead in OSM past 60 % (the exits face 25's landings)"])),
    stands: { min: 144, max: 144, refs: ['101', '502', '604', '806', '843', '904', '209', '318', '410'], gates: 34,
      e787: { min: 96, max: 96 }, e777: { min: 85, max: 85 } },
    countries: ['IT'],
    routes: [['LIRF', 'LSZH', 374.4], ['LIRF', 'LEBL', 457.9], ['LIRF', 'EDDM', 393.7]],
  });
}
