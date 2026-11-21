// v0.7.2: Düsseldorf (EDDL), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v072-eu-eddl.test.mjs). Against Germany's DFS AIP IFR (AD 2 EDDL,
// effective 29 OCT 2026): AD 2.12 05L/23R 2,700 x 45 m, 05R/23L 2,997 x 45 m, true 052.80 / 232.80, the landing thresholds'
// coordinates and elevations; AD 2.13 LDA 2,400 at 05L and 23R (300 m displaced), 2,696 at 05R and 23L (301 m). AD 2.14:
// ALSAF at all four (the game's ALSF-II; 900 m [EST]), PAPI 3.0 deg (side not stated: left [EST]), TDZ at 23R, 05R and 23L,
// centreline lights at all four. AD 2.19: ILS CAT I to 05L, CAT III to 05R, 23L, 23R; MAG VAR 3 deg E (2024).
//   python3 tools/cpu-guard.py -- node --test tests/v072-eu-eddl.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 0.5, papiDeg: 3, approachLights: 'ALSF-II' };
  airportSuite({
    icao: 'EDDL', patch: 'duesseldorf', coast: false,
    shortName: "Düsseldorf", name: "Düsseldorf Airport",
    latLon: [51.289501, 6.76678], elevM: 44.8, pubVar: 3,
    runways: [
      { id: '05L/23R', lengthM: 2700, widthM: 45, source: "Germany's DFS AIP" },
      { id: '05R/23L', lengthM: 2997, widthM: 45, source: "Germany's DFS AIP" },
    ],
    ends: {
      '05L': { ...E, ils: 'I', tdz: false, displacedM: 300, elevFt: 115.7, pubMag: 49.80, trueBrg: 52.80, thr: ['511707.132N', '0064507.643E'] },
      '23R': { ...E, ils: 'III', tdz: true, displacedM: 300, elevFt: 123.2, pubMag: 229.80, trueBrg: 232.80, thr: ['511748.248N', '0064633.931E'] },
      '05R': { ...E, ils: 'III', tdz: true, displacedM: 301, elevFt: 119.9, pubMag: 49.80, trueBrg: 52.80, thr: ['511652.445N', '0064519.467E'] },
      '23L': { ...E, ils: 'III', tdz: true, displacedM: 301, elevFt: 137.7, pubMag: 229.80, trueBrg: 232.80, thr: ['511739.431N', '0064658.073E'] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // OSM's stands; which take a widebody is the geometry's (the parking list not read for code letters)
    stands: { min: 176, max: 176, refs: ['V94', 'V97', 'C07', 'C37'], gates: 45, e787: { min: 126, max: 126 }, e777: { min: 118, max: 118 } },
    countries: ["DE"],
    routes: [['EDDL', 'EDDF', 102.0], ['EDDL', 'EHAM', 96.3], ['EDDL', 'EDDM', 262.3]],
  });
}
