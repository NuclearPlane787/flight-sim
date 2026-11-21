// v0.7.2: Geneva (LSGG), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v072-eu-lsgg.test.mjs). No AIP (skyguide's eAIP asks for a login):
// every value [EST]: OSM's runway 04/22, OurAirports' 3,900 x 50 m (12,795 x 164 ft), elevations 1,411 / 1,365 ft and 04's
// displacement 330 m (1,082 ft); the lights and ILS general knowledge of the field (CAT III to 22, CAT I to 04).
//   python3 tools/cpu-guard.py -- node --test tests/v072-eu-lsgg.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { papiDeg: 3, thrSource: 'OSM', thrTolM: 15 };
  airportSuite({
    icao: 'LSGG', patch: 'geneva', coast: false,
    shortName: "Geneva", name: "Geneva Airport",
    latLon: [46.238098, 6.10895], elevM: 430.1,
    runways: [
      { id: '04/22', lengthM: 3900, widthM: 50, source: "OurAirports [EST]" },
    ],
    ends: {
      '04': { ...E, ils: 'I', approachLights: 'ALSF-I', tdz: false, displacedM: 330, elevFt: 1411, thr: [46.22783, 6.093929] },
      '22': { ...E, ils: 'III', approachLights: 'ALSF-II', tdz: true, displacedM: 0, elevFt: 1365, thr: [46.250405, 6.127082] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // The north-west aprons (L, G, F, E and the unnamed R stands): OSM's way across 04/22 to the main side crosses at a slant,
    // 42 m of it within 20 deg of the runway's axis
    alongRunway: { byStand: { '2-2': 50, '11-2': 50, '12': 50, 'L0': 50, 'L1': 50, 'L2': 50, 'L3': 50, 'L4': 50, 'L5': 50, 'L6': 50, 'L7': 50, 'L8': 50, 'L9': 50, 'L10': 50, 'G4': 50, 'G3': 50, 'G2': 50, 'G1': 50, 'F4': 50, 'F3': 50, 'F2': 50, 'F1': 50, 'F5': 50, 'F6': 50, 'F4-2': 50, 'E7': 50, 'E6': 50, 'E3': 50, 'E4': 50, 'E2': 50, 'R2': 50, 'R3': 50, 'R4': 50, 'R5': 50, 'R7': 50, 'R6': 50, 'R8': 50, 'R9': 50, 'R10': 50 }, reason: "the north-west aprons' slanting crossing of 04/22" },
    // OSM's stands; which take a widebody is the geometry's (the parking list not read for code letters)
    stands: { min: 138, max: 138, refs: ['19', '17', '44', '16'], gates: 24, e787: { min: 71, max: 71 }, e777: { min: 66, max: 66 } },
    countries: ["CH"],
    routes: [['LSGG', 'LSZH', 124.1], ['LSGG', 'LFPG', 219.9], ['LSGG', 'LIMC', 115.3]],
  });
}
