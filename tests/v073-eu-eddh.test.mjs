// v0.7.3: Hamburg (EDDH), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v073-eu-eddh.test.mjs). Against Germany's DFS AIP IFR (AD 2 EDDH,
// effective 29 OCT 2026): AD 2.12 05/23 3,250 x 46 m, 15/33 3,666 x 46 m, true 050.30 / 230.30 and 152.80 / 332.80, the
// landing thresholds' coordinates and elevations; AD 2.13 LDA 2,952 at 05 (298 m displaced), 3,094 at 23 (156 m), 3,220
// at 33 (446 m), 3,666 at 15. AD 2.14: ALSAF at all four (the game's ALSF-II; 900 m [EST]), PAPI 3.0 deg (left [EST]),
// TDZ at 23 only, centreline lights at all four. AD 2.19: ILS CAT I to 05 and 15, CAT III to 23, none to 33; MAG VAR
// 4 deg E (2025). 05/23 crosses 15/33.
//   python3 tools/cpu-guard.py -- node --test tests/v073-eu-eddh.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1, papiDeg: 3, approachLights: 'ALSF-II' };
  airportSuite({
    icao: 'EDDH', patch: 'hamburg', coast: false,
    shortName: "Hamburg", name: "Hamburg Airport",
    latLon: [53.630402, 9.98823], elevM: 16.2, pubVar: 4,
    runways: [
      { id: '15/33', lengthM: 3666, widthM: 46, source: "Germany's DFS AIP" },
      { id: '05/23', lengthM: 3250, widthM: 46, source: "Germany's DFS AIP" },
    ],
    ends: {
      '15': { ...E, ils: 'I', tdz: false, displacedM: 0, elevFt: 53.0, pubMag: 148.80, trueBrg: 152.80, thr: ['533915.880N', '0095830.759E'] },
      '33': { ...E, ils: null, tdz: false, displacedM: 446, elevFt: 35.4, pubMag: 328.80, trueBrg: 332.80, thr: ['533743.248N', '0095950.814E'] },
      '05': { ...E, ils: 'I', tdz: false, displacedM: 298, elevFt: 31.9, pubMag: 46.30, trueBrg: 50.30, thr: ['533711.851N', '0095801.795E'] },
      '23': { ...E, ils: 'III', tdz: true, displacedM: 156, elevFt: 43.2, pubMag: 226.30, trueBrg: 230.30, thr: ['533809.638N', '0095958.755E'] },
    },
    fieldSurface: 'runways', fieldPavement: true, crossingProfile: true,
    // OSM's taxiways meet 15 23 m in from its end: every stand's way to 15's hold runs 23 m along 15/33
    alongRunway: { byEnd: { '15': 30 }, reason: "OSM's taxiways meet 15 23 m from its end" },
    // OSM's stands; which take a widebody is the geometry's (the parking list not read for code letters)
    stands: { min: 89, max: 89, refs: ['05A', '42', '12', '59'], gates: 9, e787: { min: 69, max: 69 }, e777: { min: 68, max: 68 } },
    countries: ["DE"],
    routes: [['EDDH', 'EDDF', 222.8], ['EDDH', 'EKCH', 151.1], ['EDDH', 'EDDM', 324.0]],
  });
}
