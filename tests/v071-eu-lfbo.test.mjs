// v0.7.1: Toulouse–Blagnac (LFBO), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v071-eu-lfbo.test.mjs). Against France's SIA eAIP (AD 2 LFBO, AIRAC
// 29 OCT 2026): AD 2.12 14L/32R 3,025 x 45 m, 14R/32L 3,503 x 45 m, true (mag) 142.91 (141) / 322.91 (321) and 142.90
// (141) / 322.90 (321), the thresholds' coordinates and elevations, no displacement (AD 2.13). AD 2.14: 14L approach
// lights 900 m (the game's ALSF-I), 14R 870 m (ALSF-II), none at 32R and 32L; PAPI 3.0 deg at all four (side not stated:
// left [EST]); TDZ at 14R only; centreline lights on 14R/32L only. AD 2.19: ILS CAT III to 14R, CAT I to 14L, 32R, 32L.
// The Airbus sites' halls (west, inside OSM's aerodrome; north, the Lagardere plant, added by the bake's AREA_EXTRA).
//   python3 tools/cpu-guard.py -- node --test tests/v071-eu-lfbo.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1.0, displacedM: 0, papiDeg: 3 };
  const NOAPP = { approachLights: null, approachLightsM: 0 };
  airportSuite({
    icao: 'LFBO', patch: 'toulouse', coast: false,
    shortName: 'Toulouse', name: 'Toulouse–Blagnac Airport',
    latLon: [43.629101, 1.36382], elevM: 152.1,
    runways: [
      { id: '14L/32R', lengthM: 3025, widthM: 45, source: "France's SIA eAIP" },
      { id: '14R/32L', lengthM: 3503, widthM: 45, source: "France's SIA eAIP" },
    ],
    ends: {
      '14L': { ...E, tdz: false, centreline: false, ils: 'I', approachLights: 'ALSF-I', approachLightsM: 900, elevFt: 489, pubMag: 141, trueBrg: 142.91, thr: ['433814.51N', '0012127.45E'] },
      '32R': { ...E, ...NOAPP, tdz: false, centreline: false, ils: 'I', elevFt: 497, pubMag: 321, trueBrg: 322.91, thr: ['433656.29N', '0012248.85E'] },
      '14R': { ...E, tdz: true, ils: 'III', approachLights: 'ALSF-II', approachLightsM: 870, elevFt: 488, pubMag: 141, trueBrg: 142.90, thr: ['433838.81N', '0012045.36E'] },
      '32L': { ...E, ...NOAPP, tdz: false, ils: 'I', elevFt: 497, pubMag: 321, trueBrg: 322.90, thr: ['433708.27N', '0012219.62E'] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // The lead, 13:28: from the factory's flight line west of 14R/32L (the bake's R12 to R36, 25 stands) the way to 32R
    // crosses 14R/32L and joins 14L/32R at an intersection whose hold is 703 m from 32R's end (2,320 m of runway left):
    // an intersection departure, allowed for those stands only. Every other stand's hold for 32R is within 600 m.
    farHolds: { '32R': { m: 750, stands: ['R12', 'R13', 'R14', 'R15', 'R16', 'R17', 'R18', 'R19', 'R20', 'R21', 'R22', 'R23', 'R24', 'R25', 'R26', 'R27', 'R28', 'R29', 'R30', 'R31', 'R32', 'R33', 'R34', 'R35', 'R36'], reason: "the factory's west-side stands join 14L/32R at an intersection" } },
    // OSM's stands (39 unnumbered ones R1..R39 by the bake); which take a widebody is the geometry's (no parking chart read)
    stands: { min: 107, max: 107, refs: ['A10', 'B25', 'C4', 'D31', 'E62', 'F40', 'G22', 'K32', 'M2', 'U42', 'V12', 'R1'], gates: 22,
      e787: { min: 62, max: 62 }, e777: { min: 62, max: 62 } },
    countries: ['FR'],
    routes: [['LFBO', 'LFPG', 326.7], ['LFBO', 'LEBL', 143.5], ['LFBO', 'LFPO', 309.0]],
  });
}
