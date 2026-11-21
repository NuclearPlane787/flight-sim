// v0.7.1: Copenhagen Airport, Kastrup (EKCH), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in
// Europe (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v071-eu-ekch.test.mjs). Against Denmark's Naviair AIP (AD 2 EKCH,
// AIRAC AMDT 03/26): AD 2.12 04L/22R 3,571 m (04L 3,001 m and its 570 m stopway: 22R's threshold 570 m in), 04R/22L
// 3,302 m, 12/30 2,800 m (12's threshold 435 m in, 30's 270 m: AD 2.13's LDAs and AD 2.14's red edge lights), all 45 m
// wide; true (mag) 041.2 (037.2) / 221.2 (217.2) / 123.2 (119.2) / 303.2 (299.2); the landing thresholds' coordinates and
// elevations. AD 2.14: 04L CAT II 900 m (the game's ALSF-II), 22L CAT II/III 840 m (ALSF-II), 22R 900 m, 04R 720 m, 12 and
// 30 900 m (ALSF-I); PAPI 3 deg at all six (side not stated: left [EST]); TDZ at 04L and 22L; centreline lights on
// 04L/22R and 04R/22L only. AD 2.19: ILS CAT II 04L, CAT III 22L, CAT I 04R, 22R, 12, 30.
//   python3 tools/cpu-guard.py -- node --test tests/v071-eu-ekch.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1.5, displacedM: 0, papiDeg: 3, tdz: false };
  const C1 = { ils: 'I', approachLights: 'ALSF-I' };
  airportSuite({
    icao: 'EKCH', patch: 'copenhagen', coast: true,
    shortName: 'Copenhagen', name: 'Copenhagen Airport, Kastrup',
    latLon: [55.617900848389, 12.656000137329], elevM: 5.2,
    runways: [
      { id: '04L/22R', lengthM: 3571, widthM: 45, source: "Denmark's Naviair AIP" },
      { id: '04R/22L', lengthM: 3302, widthM: 45, source: "Denmark's Naviair AIP" },
      { id: '12/30', lengthM: 2800, widthM: 45, source: "Denmark's Naviair AIP" },
    ],
    ends: {
      '04L': { ...E, tdz: true, ils: 'II', approachLights: 'ALSF-II', elevFt: 13, pubMag: 37.2, trueBrg: 41.2, thr: ['553531.92N', '0123612.73E'] },
      '22R': { ...E, ...C1, displacedM: 570, elevFt: 14, pubMag: 217.2, trueBrg: 221.2, thr: ['553644.92N', '0123805.61E'] },
      '04R': { ...E, ...C1, approachLightsM: 720, elevFt: 12, pubMag: 37.2, trueBrg: 41.2, thr: ['553611.16N', '0123758.97E'] },
      '22L': { ...E, tdz: true, ils: 'III', approachLights: 'ALSF-II', approachLightsM: 840, elevFt: 8, pubMag: 217.2, trueBrg: 221.2, thr: ['553731.48N', '0124003.29E'] },
      '12': { ...E, ...C1, centreline: false, displacedM: 435, elevFt: 13, pubMag: 119.2, trueBrg: 123.2, thr: ['553726.94N', '0123820.82E'] },
      '30': { ...E, ...C1, centreline: false, displacedM: 270, elevFt: 8, pubMag: 299.2, trueBrg: 303.2, thr: ['553649.87N', '0124001.01E'] },
    },
    crossingProfile: true,
    fieldSurface: 'runways', fieldPavement: true,
    // AD 2.12's MAG is 4 deg less than true (an older variation: AD 2.19's VOR/DME 4E 2022); WMM2025 at 2026.0 reads 5.2 E,
    // so the magnetic bearings sit ~1.2 deg under the published ones (pubMagTol 1.5)
    // 22R [EST]: 22R's runway end is 570 m beyond its threshold (04L's stopway); OSM's taxiways meet it at the threshold
    // 12 [EST, not examined]: routes to 12's hold run 876 m along 12/30 in OSM's taxiways (12's threshold is 435 m in);
    // W1's routes 94-104 m along a runway
    alongRunway: { byEnd: { '12': 900 }, byStand: { W1: 250 }, reason: "OSM's routes to 12's hold run 876 m along 12/30; stand W1's routes cross a runway at a slant for ~100 m [EST]" },
    farHolds: { '22R': { m: 800, reason: "22R's end lies 570 m beyond its threshold (04L's stopway): OSM's taxiways join at the threshold" },
      // 22L [EST, not examined]: the nearest hold the graph reaches is 628 m in from 22L's end (OSM's taxiway at the end not joined)
      '22L': { m: 700, reason: "the nearest hold in OSM's taxiways that a route reaches is 628 m in from 22L's end [EST]" } },
    // OSM's stands; which take a widebody is the geometry's (no AIP_STANDS entry: no parking chart read)
    stands: { min: 140, max: 140, refs: ['110', '124', '133', 'A17', 'A28', 'A7', 'B8', 'C35', 'E22', 'E71', 'F4', 'G15', 'H105', 'W1', 'R1'], gates: 56,
      e787: { min: 105, max: 105 }, e777: { min: 88, max: 88 } },
    countries: ['DK'],
    routes: [['EKCH', 'EDDB', 197.8], ['EKCH', 'EHAM', 342.0], ['EKCH', 'EDDF', 367.0]],
  });
}
