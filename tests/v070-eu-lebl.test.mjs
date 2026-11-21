// v0.7.0: Barcelona (LEBL), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v070-eu-lebl.test.mjs). Against Spain's ENAIRE AIP (AD 2-LEBL, WEF
// 01-OCT-26, AIRAC AMDT 09/26): AD 2.12 02/20 2,528 x 45 m, 06L/24R 3,352 x 60, 06R/24L 2,660 x 60, the thresholds'
// coordinates, elevations, true and magnetic bearings; 06L's threshold displaced 430 m; 20 not available for landing.
// AD 2.14: 02 CAT I approach lights 720 m (the game's ALSF-I); CAT II/III 720 m at 06L and 24R, 900 m at 06R, 420 m at
// 24L (ALSF-II); PAPI 3 deg (side not stated: left [EST]) at all but 20; TDZ at 06L, 24R, 06R, 24L; centreline lights on
// every runway. AD 2.19: ILS CAT I to 02, CAT III to 06L, 24R, 06R, 24L; the localizers' declination 1 deg E.
//   python3 tools/cpu-guard.py -- node --test tests/v070-eu-lebl.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const AIP = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1.5, displacedM: 0 };
  const CAT3 = { ...AIP, tdz: true, papiDeg: 3, ils: 'III', approachLights: 'ALSF-II' };
  airportSuite({
    icao: 'LEBL', patch: 'barcelona', coast: true,
    shortName: 'Barcelona', name: 'Josep Tarradellas Barcelona–El Prat Airport',
    latLon: [41.2971, 2.07846], elevM: 3.7,
    runways: [
      { id: '02/20', lengthM: 2528, widthM: 45, source: "Spain's ENAIRE AIP" },
      { id: '06R/24L', lengthM: 2660, widthM: 60, source: "Spain's ENAIRE AIP" },
      { id: '06L/24R', lengthM: 3352, widthM: 60, source: "Spain's ENAIRE AIP" },
    ],
    ends: {
      '02': { ...AIP, tdz: false, papiDeg: 3, ils: 'I', approachLights: 'ALSF-I', approachLightsM: 720, elevFt: 7, pubMag: 18, trueBrg: 18.98, thr: ['411715.93N', '0020505.38E'] },
      '20': { ...AIP, tdz: false, papi: null, papiDeg: null, ils: null, approachLights: null, approachLightsM: 0, elevFt: 12, pubMag: 198, trueBrg: 198.99, thr: ['411833.46N', '0020540.75E'] },
      '06L': { ...CAT3, approachLightsM: 720, displacedM: 430, elevFt: 8, pubMag: 64, trueBrg: 65.57, thr: ['411741.44N', '0020419.00E'] },
      '24R': { ...CAT3, approachLightsM: 720, elevFt: 10, pubMag: 244, trueBrg: 245.59, thr: ['411820.61N', '0020613.40E'] },
      '06R': { ...CAT3, elevFt: 8, pubMag: 64, trueBrg: 65.57, thr: ['411656.32N', '0020427.63E'] },
      '24L': { ...CAT3, approachLightsM: 420, elevFt: 8, pubMag: 244, trueBrg: 245.59, thr: ['411731.99N', '0020611.78E'] },
    },
    fieldSurface: 'runways', fieldPavement: true, crossingProfile: true,
    // R7, an unnumbered OSM stand by 24L's end: its route to 24L runs 585 m along 06R/24L in OSM. Logged.
    alongRunway: { m: 1, byStand: { R7: 600 }, reason: "R7 (unnumbered in OSM) by 24L's end reaches 24L only along 06R/24L" },
    stands: { min: 209, max: 209, refs: ['123', '105', '113A', '204', '252', '312', '340', '15', '153', 'R3'], gates: 35,
      e787: { min: 142, max: 142 }, e777: { min: 136, max: 136 } },
    countries: ['ES'],
    routes: [['LEBL', 'LEMD', 260.9], ['LEBL', 'LFPG', 463.5], ['LEBL', 'EGLL', 619.7]],
  });
}
