// v0.7.1: Vienna (LOWW), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v071-eu-loww.test.mjs). Against Austria's eAIP (Austro Control, AD 2
// LOWW, AMDT 358 of 02 OCT 2026): AD 2.12 11/29 3,500 x 45 m, 16/34 3,600 x 45 m, true 115.92 / 295.95 and 164.18 /
// 344.19, the thresholds' coordinates and elevations (175 / 183 / 182 / 179 m); AD 2.13 no displacement. AD 2.14: PALS
// CAT I at 11 and 34 (the game's ALSF-I), CAT II/III at 29 and 16 (ALSF-II), 900 m; PAPI 3.1 deg at 11, 3.0 deg at the
// others (side not stated: left [EST]); TDZ at 29 and 16; centreline lights at all four. RWY types: 29 and 16 CAT III,
// 11 and 34 CAT I. AD 2.2: MAG VAR 5 deg E (JAN 2022, +0.1 a year).
//   python3 tools/cpu-guard.py -- node --test tests/v071-eu-loww.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  // AD 2.2's 5 deg E is of JAN 2022; WMM2025 reads ~5.3 E there in 2026: the published magnetic (true less 5) is ~0.3 off
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 0.5, displacedM: 0, papiDeg: 3, approachLightsM: 900 };
  const C1 = { ils: 'I', approachLights: 'ALSF-I', tdz: false }, C3 = { ils: 'III', approachLights: 'ALSF-II', tdz: true };
  airportSuite({
    icao: 'LOWW', patch: 'vienna', coast: false,
    shortName: 'Vienna', name: 'Vienna International Airport',
    latLon: [48.110298, 16.5697], elevM: 182.9, pubVar: 5,
    runways: [
      { id: '11/29', lengthM: 3500, widthM: 45, source: "Austria's eAIP" },
      { id: '16/34', lengthM: 3600, widthM: 45, source: "Austria's eAIP" },
    ],
    ends: {
      '11': { ...E, ...C1, papiDeg: 3.1, elevFt: 574.1, pubMag: 110.92, trueBrg: 115.92, thr: ['480722.13N', '0163200.09E'] },
      '29': { ...E, ...C3, elevFt: 600.4, pubMag: 290.95, trueBrg: 295.95, thr: ['480632.57N', '0163432.27E'] },
      '16': { ...E, ...C3, elevFt: 597.1, pubMag: 159.18, trueBrg: 164.18, thr: ['480711.22N', '0163441.40E'] },
      '34': { ...E, ...C1, elevFt: 587.3, pubMag: 339.19, trueBrg: 344.19, thr: ['480519.07N', '0163528.82E'] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // OSM's stands; which take a widebody is the geometry's (AD 2.8's parking list not read for code letters)
    stands: { min: 169, max: 169, refs: ['C39', 'A96', 'D29', 'C36'], gates: 17, e787: { min: 127, max: 127 }, e777: { min: 120, max: 120 } },
    countries: ['AT'],
    routes: [['LOWW', 'EDDM', 191.8], ['LOWW', 'EDDF', 335.3], ['LOWW', 'LSZH', 325.8]],
  });
}
