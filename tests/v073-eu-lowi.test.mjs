// v0.7.3: Innsbruck (LOWI), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v073-eu-lowi.test.mjs). Against Austro Control's eAIP (AD 2 LOWI,
// effective 30 OCT 2026): AD 2.12 08/26 2,000 x 45 m, true 080.97 / 260.99, the thresholds (08's 60 m displaced; AD 2.13
// LDA 1,940 at both) and elevations 581 / 577 m; both non-precision approach runways. AD 2.14: 08 no approach lights,
// PAPI 3.5 deg on both sides; 26 PALS CAT I 600 m (ALSF-I), PAPI 3.5 deg left; simple touchdown zone lights only (no TDZ);
// centreline lights on both. AD 2.19: no ILS (the LOC/DME East's localizer is 3.5 deg off the centreline). The patch runs
// ~45 km along the Inn valley (about 21 km beyond 08's end, 20 km beyond 26's).
//   python3 tools/cpu-guard.py -- node --test tests/v073-eu-lowi.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1, papiDeg: 3.5, ils: null, tdz: false };
  airportSuite({
    icao: 'LOWI', patch: 'innsbruck', coast: false,
    shortName: "Innsbruck", name: "Innsbruck Airport",
    latLon: [47.260201, 11.344], elevM: 581.3, pubVar: 4,
    runways: [
      { id: '08/26', lengthM: 2000, widthM: 45, source: "Austro Control's eAIP" },
    ],
    ends: {
      '08': { ...E, approachLights: null, approachLightsM: 0, papi: 'both', displacedM: 60, elevFt: 1906.2, pubMag: 76.97, trueBrg: 80.97, thr: ['471531.97N', '0111954.11E'] },
      '26': { ...E, approachLights: 'ALSF-I', approachLightsM: 600, displacedM: 0, elevFt: 1893.0, pubMag: 256.99, trueBrg: 260.99, thr: ['471541.82N', '0112125.24E'] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // 08's straight 3° final from 15 nm meets the mountains west of the field (Martinswand and the Zirl narrows) at 4.8 nm
    // and is 1,044 m under the ground 8.3 nm out: 08 is reached only by circling or a visual segment (AD 2.22 3.4.6:
    // the LOC/DME East's visual segment "either straight - in to RWY 26 ... or on to a right-hand traffic circuit to RWY
    // 08"; RNP VISUAL V RWY 08: "a visual part along a defined trajectory")
    circlingFinals: { '08': "the 3° line meets the mountains 4.8 nm out: 08 is circled or flown visually (AD 2.22 3.4.6, 3.7)" },
    knownTaxiIn: { '08@0.9': "no exit ahead of 90 % along 08 in OSM's taxiways (B is behind, at 83 %): the route turns back along the runway" },
    // OSM's stands; which take a widebody is the geometry's (the parking list not read for code letters)
    stands: { min: 8, max: 8, refs: ['R1', 'R8'], gates: 0, e787: { min: 0, max: 0 }, e777: { min: 0, max: 0 } },   // (the review: pinned; no stand takes a widebody)
    countries: ["AT"],
    routes: [['LOWI', 'LOWW', 217.3], ['LOWI', 'EDDM', 68.0], ['LOWI', 'LSZH', 114.3]],
  });
}
