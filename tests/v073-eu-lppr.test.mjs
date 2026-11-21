// v0.7.3: Porto (LPPR), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v073-eu-lppr.test.mjs). NAV Portugal's eAIP answered 503 when this was
// baked: every published value [EST]. 17/35 3,480 x 45 m (OurAirports' 11,417 ft), its ends at the outer ends of OSM's
// unnamed runway ways, the thresholds at OSM's threshold nodes (17 297 m in, 35 151 m), the elevations OurAirports'
// 151 / 226 ft. ILS CAT III to 17 (900 m, TDZ), CAT I to 35 (900 m); PAPI left 3 deg; centreline lights.
//   python3 tools/cpu-guard.py -- node --test tests/v073-eu-lppr.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'OSM', thrTolM: 20, papiDeg: 3 };
  airportSuite({
    icao: 'LPPR', patch: 'porto', coast: true,
    shortName: "Porto", name: "Francisco Sá Carneiro Airport",
    latLon: [41.2481002808, -8.68138980865], elevM: 69.5,
    runways: [
      { id: '17/35', lengthM: 3480, widthM: 45, source: "OurAirports [EST]" },
    ],
    ends: {
      '17': { ...E, ils: 'III', approachLights: 'ALSF-II', tdz: true, displacedM: 297, elevFt: 151, thr: [41.2606548, -8.6845552] },
      '35': { ...E, ils: 'I', approachLights: 'ALSF-I', tdz: false, displacedM: 151, elevFt: 226, thr: [41.2338845, -8.6775346] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    knownTaxiIn: { '35@0.9': "no exit ahead in OSM's taxiways at 17's end" },
    // OSM's stands; which take a widebody is the geometry's (the parking list not read for code letters)
    stands: { min: 44, max: 44, refs: ['S10', 'S73', 'T01'], gates: 3, e787: { min: 40, max: 42 }, e777: { min: 39, max: 41 } },
    countries: ["PT"],
    routes: [['LPPR', 'LPPT', 149.6], ['LPPR', 'LEMD', 236.3], ['LPPR', 'LEST', 99.7]],
  });
}
