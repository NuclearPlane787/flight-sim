// v0.7.1: Lisbon Humberto Delgado Airport (LPPT), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened
// in Europe (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v071-eu-lppt.test.mjs). NAV Portugal's eAIP was under maintenance (HTTP
// 503) when this was baked: every published value [EST]. 02/20 (17/35 closed for good: no runway) 3,810 x 45 m
// (OurAirports' 12,500 ft), its ends at the outer ends of OSM's displaced-threshold ways; 02's threshold displaced 88 m,
// 20's 597 m, the elevations 331 / 347 ft (OurAirports'). The lights and ILS general knowledge of the field: ILS CAT III
// to 02 (900 m approach lights, TDZ), CAT I to 20 (900 m); PAPI left 3 deg; centreline lights.
//   python3 tools/cpu-guard.py -- node --test tests/v071-eu-lppt.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  // the thresholds: OSM's nodes where its displaced-threshold ways meet the runway (the bake's ends moved ~11 m out each)
  const E = { thrSource: 'OSM', thrTolM: 20, papiDeg: 3 };
  airportSuite({
    icao: 'LPPT', patch: 'lisbon', coast: true,
    shortName: 'Lisbon', name: 'Humberto Delgado Airport',
    latLon: [38.7813, -9.13592], elevM: 114.0,
    runways: [
      { id: '02/20', lengthM: 3810, widthM: 45, source: 'OurAirports [EST]' },
    ],
    ends: {
      '02': { ...E, tdz: true, ils: 'III', approachLights: 'ALSF-II', displacedM: 88, elevFt: 331, thr: [38.7664223, -9.1438872] },
      '20': { ...E, tdz: false, ils: 'I', approachLights: 'ALSF-I', displacedM: 597, elevFt: 347, thr: [38.7923236, -9.1300393] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // [EST] OSM's way to 20's hold runs 232 m along the runway's end (20's threshold is ~600 m in), and a landing on 02 at
    // 75 % turns back 232 m to that exit
    alongRunway: { byEnd: { '20': 250 }, reason: "OSM's taxi route to 20's hold runs 232 m along the pavement before 20's displaced threshold" },
    knownTaxiIn: { '02@0.75': "the nearest exit in OSM's taxiways lies 232 m behind, at the pavement before 20's displaced threshold",
      '02@0.9': "the nearest exit in OSM's taxiways lies 232 m behind, at the pavement before 20's displaced threshold" },
    // OSM's stands; which take a widebody is the geometry's (no AIP_STANDS entry: no parking chart read)
    stands: { min: 93, max: 93, refs: ['101', '107-2', '125', '200', '209', '301', '413', '426', '602', '702', '805', 'N26'], gates: 25,
      e787: { min: 67, max: 67 }, e777: { min: 61, max: 61 } },
    countries: ['PT'],
    routes: [['LPPT', 'LEMD', 277.0], ['LPPT', 'LEBL', 536.7]],
  });
}
