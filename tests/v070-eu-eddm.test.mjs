// v0.7.0: Munich (EDDM), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v070-eu-eddm.test.mjs). Against Germany's DFS AIP IFR (AD 2 EDDM,
// effective 29 OCT 2026): AD 2.12 08L/26R and 08R/26L 4,000 x 60 m, true 083.40 / 263.40, the thresholds' coordinates and
// elevations, no displacement. AD 2.14: ALSAF (the game's ALSF-II; 900 m [EST]), PAPI 3.0 deg (side not stated: left
// [EST]), TDZ and centreline lights at all four. AD 2.19: ILS CAT III to all four; MAG VAR 4 deg E (2026).
//   python3 tools/cpu-guard.py -- node --test tests/v070-eu-eddm.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  // AD 2.19's MAG VAR 4 deg E (2026) against WMM2025's ~3.9 E there: the published magnetic is the true less 4
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 0.5, displacedM: 0, tdz: true, papiDeg: 3, ils: 'III', approachLights: 'ALSF-II' };
  airportSuite({
    icao: 'EDDM', patch: 'munich', coast: false,
    shortName: 'Munich', name: 'Munich Airport',
    latLon: [48.353802, 11.7861], elevM: 453.2, pubVar: 4,
    runways: [
      { id: '08R/26L', lengthM: 4000, widthM: 60, source: "Germany's DFS AIP" },
      { id: '08L/26R', lengthM: 4000, widthM: 60, source: "Germany's DFS AIP" },
    ],
    ends: {
      '08L': { ...E, elevFt: 1467.2, pubMag: 79.4, trueBrg: 83.40, thr: ['482145.960N', '0114603.178E'] },
      '26R': { ...E, elevFt: 1448.6, pubMag: 259.4, trueBrg: 263.40, thr: ['482200.793N', '0114916.222E'] },
      '08R': { ...E, elevFt: 1485.5, pubMag: 79.4, trueBrg: 83.40, thr: ['482026.413N', '0114503.655E'] },
      '26L': { ...E, elevFt: 1469.7, pubMag: 259.4, trueBrg: 263.40, thr: ['482041.274N', '0114816.612E'] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // OSM's stands (41 unnumbered ones R1..R41 by the bake); which take a widebody is the geometry's (the parking chart not read)
    stands: { min: 209, max: 209, refs: ['121', '155', '903', '345', '301B', '606', '202A', '218', 'R1'], gates: 73,
      e787: { min: 181, max: 181 }, e777: { min: 177, max: 177 } },
    countries: ['DE'],
    routes: [['EDDM', 'EDDF', 161.6], ['EDDM', 'LSZH', 141.0], ['EDDM', 'LFPG', 367.8]],
  });
}
