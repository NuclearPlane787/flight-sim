// v0.7.0: Madrid (LEMD), Europe's fourth airport, pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in
// Europe (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v070-eu-lemd.test.mjs). Against Spain's ENAIRE AIP (AD 2-LEMD, WEF
// 29-OCT-26, AIRAC AMDT 10/26): AD 2.12 14L/32R 3,500 x 60 m, 14R/32L 3,988 x 60, 18L/36R 3,500 x 60, 18R/36L 4,179 x 60,
// the thresholds' coordinates (the displaced ones where displaced), elevations and true bearings; 32R's threshold
// displaced 500 m, 32L's 928 m, 18L's 500 m, 18R's 814 m; 14L, 14R, 36R and 36L not available for landing, 32R, 32L, 18L
// and 18R not available for take-off (every runway one way). AD 2.14: CAT II/III approach lights 900 m (the game's
// ALSF-II), PAPI 3 deg (side not stated: left [EST]), TDZ and centreline lights at 32R, 32L, 18L, 18R; centreline lights
// only at 14L, 14R, 36R, 36L. AD 2.19: ILS CAT III to 32L, 18L, 18R, 32R; the localizers' declination 0 deg.
//   python3 tools/cpu-guard.py -- node --test tests/v070-eu-lemd.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  // AD 2.12's MAG bearings (143 / 323 / 180 / 360) carry an older variation: WMM2025 gives 0.58 deg E there, so true
  // 142.21 reads 141.6 M today, 1.4 deg off the published 143
  const LDG = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1.5, tdz: true, papiDeg: 3, ils: 'III', approachLights: 'ALSF-II' };
  const TKO = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1.5, displacedM: 0, tdz: false, papi: null, papiDeg: null, ils: null, approachLights: null, approachLightsM: 0 };
  airportSuite({
    icao: 'LEMD', patch: 'madrid', coast: false,
    shortName: 'Madrid', name: 'Adolfo Suárez Madrid–Barajas Airport',
    latLon: [40.493407, -3.572249], elevM: 609.0, pubVar: 0,
    runways: [
      { id: '18R/36L', lengthM: 4179, widthM: 60, source: "Spain's ENAIRE AIP" },
      { id: '18L/36R', lengthM: 3500, widthM: 60, source: "Spain's ENAIRE AIP" },
      { id: '14R/32L', lengthM: 3988, widthM: 60, source: "Spain's ENAIRE AIP" },
      { id: '14L/32R', lengthM: 3500, widthM: 60, source: "Spain's ENAIRE AIP" },
    ],
    ends: {
      '14L': { ...TKO, elevFt: 1942, pubMag: 143, trueBrg: 142.21, thr: ['402941.71N', '0033328.33W'] },
      '32R': { ...LDG, elevFt: 1886, displacedM: 500, pubMag: 323, trueBrg: 322.22, thr: ['402824.85N', '0033210.30W'] },
      '14R': { ...TKO, elevFt: 1995, pubMag: 143, trueBrg: 142.20, thr: ['402905.50N', '0033433.64W'] },
      '32L': { ...LDG, elevFt: 1933, displacedM: 928, pubMag: 323, trueBrg: 322.21, thr: ['402747.10N', '0033314.02W'] },
      '18L': { ...LDG, elevFt: 1922, displacedM: 500, pubMag: 180, trueBrg: 179.76, thr: ['403141.22N', '0033333.68W'] },
      '36R': { ...TKO, elevFt: 1942, pubMag: 360, trueBrg: 359.76, thr: ['403003.97N', '0033333.15W'] },
      '18R': { ...LDG, elevFt: 1991, displacedM: 814, pubMag: 180, trueBrg: 179.76, thr: ['403122.40N', '0033429.27W'] },
      '36L': { ...TKO, elevFt: 1985, pubMag: 360, trueBrg: 359.76, thr: ['402933.32N', '0033428.64W'] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // 18L is landing only (AD 2.12 remark 7: not available for take-off). OSM's taxiways at its north end (Y7 and its
    // neighbours, ~400 m of them) join nothing but the runway: no stand reaches a hold there. Logged; it must stay so.
    knownNoRoute: { '18L': "landing only (AD 2.12); OSM's taxiways at the north end (Y7) join only the runway" },
    // 32L's threshold is displaced 928 m: its nearest hold is at the pavement's end, ~1,010 m from the threshold.
    farHolds: { '32L': { m: 1100, reason: 'the threshold displaced 928 m: the hold is at the pavement\'s end' } },
    // Landings on the take-off-only ends (AD 2.12 remark 8): 36R past 45 % has no exit ahead to the north in OSM (its
    // exits face 18L's landings), and 14R at 30 % turns back 220 m to the exit behind. Logged, as OSM maps them.
    knownTaxiIn: {
      '36R@0.45': 'take-off only (AD 2.12): no exit ahead in OSM, the exits face 18L landings',
      '36R@0.6': 'take-off only (AD 2.12): no exit ahead in OSM, the exits face 18L landings',
      '36R@0.75': 'take-off only (AD 2.12): no exit ahead in OSM, the exits face 18L landings',
      '36R@0.9': 'take-off only (AD 2.12): no exit ahead in OSM, the exits face 18L landings',
      '14R@0.3': 'take-off only (AD 2.12): the route turns back 220 m along the runway to the exit behind',
    },
    stands: { min: 381, max: 381, refs: ['T6', '32', '40', '175', 'R1'], gates: 105,
      e787: { min: 300, max: 340 }, e777: { min: 290, max: 330 } },
    countries: ['ES'],
    routes: [['EGLL', 'LEMD', 671.6], ['LFPG', 'LEMD', 573.7], ['EDDF', 'LEMD', 766.5]],
  });
}
