// v0.7.0: Paris Orly (LFPO), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v070-eu-lfpo.test.mjs). Against France's SIA eAIP (AD 2 LFPO, AIRAC
// 29 OCT 2026): AD 2.12 02/20 2,400 x 45 m, 06/24 3,650 x 45, 07/25 3,320 x 45, the runway ends' coordinates (06's and 25's
// DTHRs listed apart: 300 m and 435 m), elevations (the DTHR's where displaced), true and magnetic bearings; AD 2.14
// 06 CAT III 720 m, 24 CAT III 740 m, 07 and 25 CAT III 900 m (the game's ALSF-II), TDZ 900 m and centreline lights at
// the four; 02 CAT I 420 m (SSALF), 20 no approach lights (PAPI 3.4 deg), neither TDZ nor centreline lights on 02/20;
// PAPI sides not stated: left [EST]. AD 2.19 ILS CAT III (III.E.4) to 06, 24, 07, 25; CAT I to 02; none to 20.
// 02/20 is live in OSM and the AIP ("exceptionally used", AD 2.21.2.1): baked as the others.
//   python3 tools/cpu-guard.py -- node --test tests/v070-eu-lfpo.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const MAIN = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1.5, tdz: true, papiDeg: 3, ils: 'III', approachLights: 'ALSF-II', displacedM: 0 };
  const CROSS = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1.5, tdz: false, centreline: false, displacedM: 0 };
  airportSuite({
    icao: 'LFPO', patch: 'orly', coast: false,
    shortName: 'Orly', name: 'Paris Orly Airport',
    latLon: [48.729499, 2.358963], elevM: 88.7, pubVar: 1.8153,
    runways: [
      { id: '06/24', lengthM: 3650, widthM: 45, source: "France's SIA eAIP" },
      { id: '02/20', lengthM: 2400, widthM: 45, source: "France's SIA eAIP" },
      { id: '07/25', lengthM: 3320, widthM: 45, source: "France's SIA eAIP" },
    ],
    ends: {
      '02': { ...CROSS, elevFt: 287, papiDeg: 3, ils: 'I', approachLights: 'SSALF', approachLightsM: 420, pubMag: 17, trueBrg: 18.35, thr: ['484303.15N', '0022236.11E'] },
      '20': { ...CROSS, elevFt: 288, papiDeg: 3.4, ils: null, approachLights: null, approachLightsM: 0, pubMag: 197, trueBrg: 198.35, thr: ['484416.88N', '0022313.09E'] },
      // 06's and 25's DTHRs (AD 2.12's bracketed co-ordinates)
      '06': { ...MAIN, elevFt: 283, displacedM: 300, approachLightsM: 720, pubMag: 61, trueBrg: 61.85, thr: ['484316.49N', '0021913.85E'] },
      '24': { ...MAIN, elevFt: 285, approachLightsM: 740, pubMag: 241, trueBrg: 241.85, thr: ['484407.64N', '0022138.44E'] },
      '07': { ...MAIN, elevFt: 277, pubMag: 73, trueBrg: 74.40, thr: ['484309.87N', '0022130.93E'] },
      '25': { ...MAIN, elevFt: 288, displacedM: 435, pubMag: 253, trueBrg: 254.40, thr: ['484334.98N', '0022347.01E'] },
    },
    fieldSurface: 'runways', fieldPavement: true, crossingProfile: true,
    // OSM's stands; which take a widebody is the geometry's (no AIP_STANDS entry)
    stands: { min: 155, max: 155, refs: ['A01', 'B01', 'E01', 'G02', 'J01', 'K30', 'M01', 'N01', 'P42', 'Q21', 'S24', 'U04'], gates: 24,
      e787: { min: 131, max: 131, include: ['K21', 'K30'] }, e777: { min: 124, max: 124, include: ['K30', 'J01'] } },
    countries: ['FR'],
    routes: [['LFPO', 'LFPG', 18.5], ['LFPO', 'EGLL', 197.1], ['LFPO', 'LEMD', 555.3], ['LFPO', 'LSZH', 259.6], ['EGKK', 'LFPO', 175.4]],
  });
}
