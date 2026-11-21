// v0.7.2: Nice (LFMN), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v072-eu-lfmn.test.mjs). Against France's SIA eAIP (AD 2 LFMN, AIRAC
// 29 OCT 2026): AD 2.12 04L/22R 2,628 x 45 m, 04R/22L 2,963 x 45 m, true 044.95 (MAG 042) / 224.96 (222), 044.95 / 224.97,
// the thresholds (04L's and 22R's DTHR, 90 m and 58 m in) and elevations; AD 2.13 LDA 2,538 at 04L, 2,480 at 22R.
// AD 2.14: no approach lights; PAPI 3.0 deg at 04L and 04R, 3.2 deg at 22R and 22L (left [EST]); no TDZ lights; centreline
// lights on both. AD 2.19: LOC 04L CAT I (offset); 04R's LOC has no category (the game: none).
//   python3 tools/cpu-guard.py -- node --test tests/v072-eu-lfmn.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1, displacedM: 0, approachLights: null, approachLightsM: 0, tdz: false };
  airportSuite({
    icao: 'LFMN', patch: 'nice', coast: true,
    shortName: "Nice", name: "Nice Côte d'Azur Airport",
    latLon: [43.658401, 7.21587], elevM: 3.7,
    runways: [
      { id: '04R/22L', lengthM: 2963, widthM: 45, source: "France's SIA eAIP" },
      { id: '04L/22R', lengthM: 2628, widthM: 45, source: "France's SIA eAIP" },
    ],
    ends: {
      '04R': { ...E, ils: null, papiDeg: 3, elevFt: 9.8, pubMag: 42, trueBrg: 44.95, thr: ['433848.26N', '0071208.97E'] },
      '22L': { ...E, ils: null, papiDeg: 3.2, elevFt: 11.4, pubMag: 222, trueBrg: 224.97, thr: ['433956.19N', '0071342.40E'] },
      '04L': { ...E, ils: 'I', papiDeg: 3, displacedM: 90, elevFt: 9.7, pubMag: 42, trueBrg: 44.95, thr: ['433908.57N', '0071217.38E'] },
      '22R': { ...E, ils: null, papiDeg: 3.2, displacedM: 58, elevFt: 9.7, pubMag: 222, trueBrg: 224.96, thr: ['434005.44N', '0071335.60E'] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // 22L's straight-in 3 deg line crosses the coastal hills ~12 nm north-east (38 m over them): logged, not hidden
    lowFinals: { '22L': 'the coastal hills ~12 nm north-east of the field' },
    knownTaxiIn: { '22L@0.9': "no exit ahead of 90 % along 22L in OSM's taxiways" },

    // OSM's stands; which take a widebody is the geometry's (the parking list not read for code letters)
    stands: { min: 178, max: 178, refs: ['54C', '54B', '52C', '52B'], gates: 27, e787: { min: 134, max: 134 }, e777: { min: 136, max: 136 } },
    countries: ["FR"],
    routes: [['LFMN', 'LFPG', 374.7], ['LFMN', 'LIMC', 134.9], ['LFMN', 'LSGG', 161.9]],
  });
}
