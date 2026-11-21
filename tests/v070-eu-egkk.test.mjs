// v0.7.0: London Gatwick (EGKK), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v070-eu-egkk.test.mjs). Against the UK's NATS eAIP (EG AD 2 EGKK, AIRAC
// 29 OCT 2026): AD 2.12 08R/26L 3,317 x 45 m and 08L/26R 2,561 x 45 m, their landing thresholds' coordinates (08R
// displaced 395 m, 26L 425 m, 08L 321 m, 26R 415 m), elevations and true bearings; AD 2.14 08R and 26L the coded
// centreline with five crossbars 914 m (the game's ALSF-II), PAPI 3 deg (08R right; 26L's side not stated: left [EST]),
// TDZ and centreline lights; 08L and 26R a centreline with one crossbar 420 m (SSALF), PAPI 3 deg (side not stated:
// left [EST]), no TDZ, no centreline lights; AD 2.19 ILS CAT III to 08R and 26L, none to 08L/26R (a non-instrument
// runway, the standby: AD 2.20). Magnetic bearings are AD 2.12's true less AD 2.19's 1.34 E (2027).
//   python3 tools/cpu-guard.py -- node --test tests/v070-eu-egkk.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const MAIN = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1, tdz: true, papiDeg: 3, ils: 'III', approachLights: 'ALSF-II', approachLightsM: 914 };
  const STANDBY = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1, tdz: false, centreline: false, papiDeg: 3, ils: null, approachLights: 'SSALF', approachLightsM: 420 };
  airportSuite({
    icao: 'EGKK', patch: 'gatwick', coast: false,
    shortName: 'Gatwick', name: 'London Gatwick Airport',
    latLon: [51.148744, -0.185739], elevM: 61.6, pubVar: 1.33,
    runways: [
      { id: '08R/26L', lengthM: 3317, widthM: 45, source: "the UK's NATS eAIP" },
      { id: '08L/26R', lengthM: 2561, widthM: 45, source: "the UK's NATS eAIP" },
    ],
    ends: {
      '08R': { ...MAIN, papi: 'right', elevFt: 196.2, displacedM: 395, pubMag: 76.29, trueBrg: 77.63, thr: ['510845.12N', '0001224.52W'] },
      '26L': { ...MAIN, elevFt: 195.9, displacedM: 425, pubMag: 256.31, trueBrg: 257.65, thr: ['510902.42N', '0001019.00W'] },
      '08L': { ...STANDBY, elevFt: 194.8, displacedM: 321, pubMag: 76.29, trueBrg: 77.63, thr: ['510851.04N', '0001229.17W'] },
      '26R': { ...STANDBY, elevFt: 194.8, displacedM: 415, pubMag: 256.31, trueBrg: 257.65, thr: ['510903.69N', '0001057.40W'] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // The route to 08R's hold H1 runs over 08L/26R's west end (inside 08L's 321 m displaced threshold) for 184 m: OSM's
    // taxiway there lies on the standby runway's pavement (08L/26R is shut while 08R/26L is in use: AD 2.20).
    alongRunway: { byEnd: { '08R': 190 }, reason: "the taxiway to 08R's hold H1 over 08L/26R's displaced west end (the standby runway)" },
    // OSM's stands (the MARS stands' L and R positions as their own); which take a widebody is the geometry's (no AIP_STANDS:
    // AD 2.20 publishes no stand-by-stand size list in its text)
    stands: { min: 189, max: 189, refs: ['1M', '13L', '33R', '54', '130', '143R', '160L', '170', '230', '552', '574', '689'], gates: 92,
      e787: { min: 159, max: 159, include: ['36L', '170'] }, e777: { min: 152, max: 152, include: ['170', '130'] } },
    countries: ['GB'],
    routes: [['EGKK', 'EGLL', 21.9], ['EGKK', 'LFPG', 166.3], ['EGKK', 'EDDF', 339.8]],
  });
}
