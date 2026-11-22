// v0.7.1: Berlin Brandenburg (EDDB), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v071-eu-eddb.test.mjs). Against Germany's DFS AIP IFR (AD 2 EDDB,
// effective 29 OCT 2026): AD 2.12 06L/24R 3,600 x 45 m, 06R/24L 4,000 x 60 m, true 068.80 / 248.84 and 068.79 / 248.83,
// the thresholds' coordinates (the landing thresholds) and elevations; AD 2.13 06L and 24R LDA 3,300 (each displaced
// 300 m). AD 2.14: ALSAF (the game's ALSF-II; 900 m [EST]), PAPI 3.0 deg (side not stated: left [EST]), TDZ and
// centreline lights at all four. AD 2.19: ILS CAT III to all four; MAG VAR 5 deg E (2025).
//   python3 tools/cpu-guard.py -- node --test tests/v071-eu-eddb.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  // AD 2.19's MAG VAR 5 deg E (2025) against WMM2025's ~5.0 E there: the published magnetic is the true less 5
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 0.5, displacedM: 0, tdz: true, papiDeg: 3, ils: 'III', approachLights: 'ALSF-II' };
  airportSuite({
    icao: 'EDDB', patch: 'berlin', coast: false,
    shortName: 'Berlin', name: 'Berlin Brandenburg Airport',
    latLon: [52.361738, 13.502341], elevM: 47.9, pubVar: 5,
    runways: [
      { id: '06L/24R', lengthM: 3600, widthM: 45, source: "Germany's DFS AIP" },
      { id: '06R/24L', lengthM: 4000, widthM: 60, source: "Germany's DFS AIP" },
    ],
    ends: {
      '06L': { ...E, displacedM: 300, elevFt: 144.1, pubMag: 63.80, trueBrg: 68.80, thr: ['522203.683N', '0132906.088E'] },
      '24R': { ...E, displacedM: 300, elevFt: 153.6, pubMag: 243.84, trueBrg: 248.84, thr: ['522238.749N', '0133133.951E'] },
      '06R': { ...E, elevFt: 152.4, pubMag: 63.79, trueBrg: 68.79, thr: ['522043.560N', '0132806.336E'] },
      '24L': { ...E, elevFt: 149.1, pubMag: 243.83, trueBrg: 248.83, thr: ['522130.330N', '0133123.383E'] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // The lead, 13:28: from the north apron (the old Schoenefeld side: stands 19, 21, 22, 24 and OSM's B, C, P1, P2 and,
    // until v0.7.4 took the de-icing pads out of the stands, PADEAST) the way to 06R/24L crosses 06L/24R where OSM's two
    // taxiway stubs meet the runway 43 and 89 m apart, so the route runs that far along it. Allowed for those eight stands
    // only; every other route is under 1 m.
    alongRunway: { byStand: { 19: 100, 21: 100, 22: 100, 24: 100, B: 100, C: 100, P1: 100, P2: 100 }, reason: 'crossing 06L/24R between two offset stubs' },
    // OSM's stands; which take a widebody is the geometry's (the parking chart not read). v0.7.4: 156, not 173: OSM's
    // fourteen de-icing pad positions (PAD1 to PADEAST) and three unnamed ones on the east pad are no stands (the bake's
    // STAND_EXCLUDE by refs and STAND_DROP_NUMBERED); their pavement stays.
    stands: { min: 156, max: 156, refs: ['R1', '19', '21', '34', '60'], gates: 5, e787: { min: 97, max: 97 }, e777: { min: 75, max: 75 } },   // (v0.7.4: 108 and 86 with the pads)
    countries: ['DE'],
    routes: [['EDDB', 'EDDM', 249.4], ['EDDB', 'EDDF', 232.9], ['EDDB', 'EHAM', 320.4]],
  });
}
