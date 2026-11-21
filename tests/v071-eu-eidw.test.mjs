// v0.7.1: Dublin (EIDW), pending, west of Greenwich: the checks in tests/v063-ne-airport.mjs, run in a page opened in
// Europe (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v071-eu-eidw.test.mjs). Against Ireland's eAIP (AirNav Ireland, AD 2
// EIDW, AIRAC 29 OCT 2026): AD 2.12 10R/28L 2,637 x 45 m, 10L/28R 3,109 x 45 m, 16/34 2,072 x 45 m, true 095.24 / 275.27,
// 095.25 / 275.28 and 156.59 / 336.60, the landing thresholds' coordinates and elevations; AD 2.13 10L displaced 280 m,
// 28R 450 m. AD 2.14: 900 m CAT II/III approach lights, TDZ and centreline lights at the four parallel ends; 910 m at
// 16, SALS 426 m at 34 (the game's SSALF); PAPI 3 deg both sides (28R right only). AD 2.19: ILS CAT III to the four
// parallel ends, CAT I to 16, none to 34; MAG VAR 1 deg W (2025).
//   python3 tools/cpu-guard.py -- node --test tests/v071-eu-eidw.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  // AD 2.2's 1 deg W (2025) against WMM2025's ~1.3 W there: the published magnetic is the true plus 1
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 0.5, displacedM: 0, papiDeg: 3, papi: 'both' };
  const P = { ils: 'III', approachLights: 'ALSF-II', approachLightsM: 900, tdz: true };
  const X = { tdz: false, centreline: false };
  airportSuite({
    icao: 'EIDW', patch: 'dublin', coast: true,
    shortName: 'Dublin', name: 'Dublin Airport',
    latLon: [53.428713, -6.262121], elevM: 73.8, pubVar: -1,
    runways: [
      { id: '10R/28L', lengthM: 2637, widthM: 45, source: "Ireland's eAIP" },
      { id: '16/34', lengthM: 2072, widthM: 45, source: "Ireland's eAIP" },
      { id: '10L/28R', lengthM: 3109, widthM: 45, source: "Ireland's eAIP" },
    ],
    ends: {
      '10R': { ...E, ...P, elevFt: 243, pubMag: 96.24, trueBrg: 95.24, thr: ['532520.75N', '0061724.27W'] },
      '28L': { ...E, ...P, elevFt: 203, pubMag: 276.27, trueBrg: 275.27, thr: ['532512.94N', '0061502.08W'] },
      '10L': { ...E, ...P, displacedM: 280, elevFt: 235, pubMag: 96.25, trueBrg: 95.25, thr: ['532613.79N', '0061650.22W'] },
      '28R': { ...E, ...P, papi: 'right', displacedM: 450, elevFt: 213, pubMag: 276.28, trueBrg: 275.28, thr: ['532606.73N', '0061441.87W'] },
      '16': { ...E, ...X, ils: 'I', approachLights: 'ALSF-I', approachLightsM: 910, elevFt: 218, pubMag: 157.59, trueBrg: 156.59, thr: ['532613.16N', '0061543.12W'] },
      '34': { ...E, ...X, ils: null, approachLights: 'SSALF', approachLightsM: 426, elevFt: 202, pubMag: 337.60, trueBrg: 336.60, thr: ['532511.66N', '0061458.54W'] },
    },
    fieldSurface: 'runways', fieldPavement: true, crossingProfile: true,
    // OSM's stand-to-hold links meet the runway a metre or two along it
    alongRunway: { m: 5, byEnd: { '10L': 700 }, reason: "OSM's taxiway joins a metre or two along the runway; to 10L the way runs along the runway from OSM's link near the displaced threshold" },
    knownTaxiIn: { '28L@0.9': "OSM maps no exit ahead of 28L's last 10 %" },
    farHolds: { '34': { m: 750, reason: "OSM's nearest hold for 34 is at an intersection ~700 m in (AD 2.13 lists 34's intersection take-offs)" } },
    // OSM's stands; which take a widebody is the geometry's (the stand list not read)
    stands: { min: 138, max: 138, refs: ['317R', '402L', '621C'], gates: 59, e787: { min: 107, max: 107 }, e777: { min: 99, max: 99 } },
    countries: ['IE'],
    routes: [['EIDW', 'EGLL', 242.6], ['EIDW', 'EHAM', 404.8], ['EIDW', 'LFPG', 424.1]],
  });
}
