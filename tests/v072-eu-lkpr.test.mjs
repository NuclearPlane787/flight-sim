// v0.7.2: Prague (LKPR), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v072-eu-lkpr.test.mjs). Against Czechia's AIP (ANS CR, AD 2 LKPR):
// AD 2.12 06/24 3,715 x 45 m, 12/30 3,250 x 45 m, true 065 / 245 and 127 / 307 (MAG 060 / 240, 122 / 302), the thresholds'
// coordinates and elevations; AD 2.13 no displacement. AD 2.14: 06 CAT I 480 m (ALSF-I), 24 CAT II/III 900 m (ALSF-II)
// with TDZ, 12 SALS 420 m (SSALF), 30 CAT I 900 m (ALSF-I); PAPI left 3 deg; centreline lights on 06/24 only. AD 2.19: ILS
// CAT I to 06, 12 and 30, CAT III to 24. The closed 04/22 is no runway; OSM's grass 05/23 is left out (RUNWAY_SKIP).
//   python3 tools/cpu-guard.py -- node --test tests/v072-eu-lkpr.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1, displacedM: 0, papiDeg: 3 };
  airportSuite({
    icao: 'LKPR', patch: 'prague', coast: false,
    shortName: "Prague", name: "Václav Havel Airport Prague",
    latLon: [50.100874, 14.259911], elevM: 380.1,
    runways: [
      { id: '12/30', lengthM: 3250, widthM: 45, source: "Czechia's AIP" },
      { id: '06/24', lengthM: 3715, widthM: 45, source: "Czechia's AIP" },
    ],
    ends: {
      '12': { ...E, ils: 'I', approachLights: 'SSALF', approachLightsM: 420, tdz: false, centreline: false, elevFt: 1160.1, pubMag: 122, trueBrg: 127, thr: ['500628.84N', '0141443.32E'] },
      '30': { ...E, ils: 'I', approachLights: 'ALSF-I', tdz: false, centreline: false, elevFt: 1231.9, pubMag: 302, trueBrg: 307, thr: ['500525.68N', '0141654.02E'] },
      '06': { ...E, ils: 'I', approachLights: 'ALSF-I', approachLightsM: 480, tdz: false, elevFt: 1202.1, pubMag: 60, trueBrg: 65, thr: ['500606.61N', '0141334.68E'] },
      '24': { ...E, ils: 'III', approachLights: 'ALSF-II', tdz: true, elevFt: 1157.5, pubMag: 240, trueBrg: 245, thr: ['500657.42N', '0141624.12E'] },
    },
    fieldSurface: 'runways', fieldPavement: true, crossingProfile: true,
    // (v0.7.4: the 30 m patch baked to the runways' profiles as runwayCrossings() bends them, 06/24 at its own level where
    // 12/30 crosses it (runways.js's CROSSING_LEVEL; bake_region_patches.py's FIELD_BENT), and every stand checked against
    // that surface within the suite's 0.6 m. v0.7.2's patch was flattened to the straight profiles: nine stands beside the
    // crossing then needed allowances of 1.2 to 4.2 m (standGround), gone now.)
    fieldBent: true,
    knownTaxiIn: { '30@0.9': "no exit ahead of 90 % along 30 in OSM's taxiways" },
    // OSM's stands; which take a widebody is the geometry's (the parking list not read for code letters)
    stands: { min: 103, max: 103, refs: ['V72', 'V71', '5', '28'], gates: 28, e787: { min: 63, max: 63 }, e777: { min: 58, max: 58 } },
    countries: ["CZ"],
    routes: [['LKPR', 'EDDM', 142.9], ['LKPR', 'LOWW', 150.1], ['LKPR', 'EDDB', 138.7]],
  });
}
