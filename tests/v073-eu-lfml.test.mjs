// v0.7.3: Marseille (LFML), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v073-eu-lfml.test.mjs). Against France's SIA eAIP (AD 2 LFML, AIRAC
// 29 OCT 2026): AD 2.12 13L/31R 3,500 x 45 m, 13R/31L 2,370 x 45 m, true 134.47 (MAG 132) / 314.47 (312) and 135.47 (133)
// / 315.47 (313); the pavement's ends with the DTHRs beside them (AD 2.13: 13L 340 m in, LDA 3,160; 31R 660 m, LDA 2,780;
// 31L 105 m, LDA 2,265) and the landing thresholds' elevations. AD 2.14: 13L a CAT I light system of 420 m (ALSF-I) with
// TDZ 900 m; 31R CAT I 900 m (ALSF-I); 13R and 31L none (runway flashing lights); PAPI 3.0 deg at 13L and 13R, 4.0 deg at
// 31R and 31L (left [EST]); centreline lights on 13L/31R only. AD 2.19: LOC 13L III.E.4, 13R I.E.1, 31R I.E.1 (GP 4 deg);
// none to 31L. The Etang de Berre beside 31's ends is inland water (the coast check: the 16 km square all land).
// AD 2.12's TRUE BRG (134.47, 135.47) is not checked: its own co-ordinates lie on 134.05 and 134.90, OSM's axes on
// 133.92 and 134.82 (the published magnetic, 132 and 133, is checked to 1.5 deg).
//   python3 tools/cpu-guard.py -- node --test tests/v073-eu-lfml.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1.5 };
  airportSuite({
    icao: 'LFML', patch: 'marseille', coast: false,
    shortName: "Marseille", name: "Marseille Provence Airport",
    latLon: [43.438088, 5.2125], elevM: 22.6,
    runways: [
      { id: '13L/31R', lengthM: 3500, widthM: 45, source: "France's SIA eAIP" },
      { id: '13R/31L', lengthM: 2370, widthM: 45, source: "France's SIA eAIP" },
    ],
    ends: {
      '13L': { ...E, ils: 'III', approachLights: 'ALSF-I', approachLightsM: 420, tdz: true, papiDeg: 3, displacedM: 340, elevFt: 8, pubMag: 132, thr: ['432649.25N', '0051201.22E'] },
      '31R': { ...E, ils: 'I', approachLights: 'ALSF-I', approachLightsM: 900, tdz: false, papiDeg: 4, displacedM: 660, elevFt: 52, pubMag: 312, thr: ['432552.98N', '0051321.32E'] },
      '13R': { ...E, ils: 'I', approachLights: null, approachLightsM: 0, tdz: false, centreline: false, papiDeg: 3, displacedM: 0, elevFt: 8, pubMag: 133, thr: ['432627.32N', '0051212.77E'] },
      '31L': { ...E, ils: null, approachLights: null, approachLightsM: 0, tdz: false, centreline: false, papiDeg: 4, displacedM: 105, elevFt: 61, pubMag: 313, thr: ['432535.51N', '0051324.36E'] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // OSM's taxiways meet 13R 237 m in from its end (no taxiway to the end itself): every stand's way to 13R's hold runs
    // 237 m along 13R/31L; 94 and 95 (the north-west apron) reach 13L's hold 16 m along 13L/31R
    alongRunway: { byEnd: { '13R': 240 }, byStand: { '94': 20, '95': 20 }, reason: "OSM's taxiways meet 13R 237 m from its end" },
    // OSM's stands; which take a widebody is the geometry's (the parking list not read for code letters)
    stands: { min: 99, max: 99, refs: ['5C', '25E', '47A', '94'], gates: 15, e787: { min: 60, max: 60 }, e777: { min: 54, max: 54 } },
    countries: ["FR"],
    routes: [['LFML', 'LFPG', 352.2], ['LFML', 'LFPO', 339.1], ['LFML', 'LFMN', 88.2]],
  });
}
