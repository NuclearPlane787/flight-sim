// v0.7.3: Lyon (LFLL), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v073-eu-lfll.test.mjs). Against France's SIA eAIP (AD 2 LFLL, AIRAC
// 29 OCT 2026): AD 2.12 17L/35R 2,670 x 45 m, 17R/35L 4,000 x 45 m, true 175.13 / 355.13 and 175.28 / 355.28 (MAG 173 /
// 353), the thresholds (the runway ends: no displacement, AD 2.13 LDA = TORA) and elevations. AD 2.14: 17L CAT I 900 m
// (ALSF-I), 35R and 35L CAT III 900 m (ALSF-II) with TDZ 900 m, 17R none; PAPI 3.0 deg (left [EST]); centreline lights at
// all four. AD 2.19: LOC 35R and 35L III.E.4, LOC 17L CAT I, none to 17R. AD 2.12's TRUE BRG (175.13, 175.28) is not
// checked: its own THR co-ordinates lie on 175.14 and 175.15, and the runways on OSM's axes (175.15, 175.07).
//   python3 tools/cpu-guard.py -- node --test tests/v073-eu-lfll.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1, displacedM: 0, papiDeg: 3 };
  airportSuite({
    icao: 'LFLL', patch: 'lyon', coast: false,
    shortName: "Lyon", name: "Lyon-Saint-Exupéry Airport",
    latLon: [45.725996, 5.090139], elevM: 250.2,
    runways: [
      { id: '17R/35L', lengthM: 4000, widthM: 45, source: "France's SIA eAIP" },
      { id: '17L/35R', lengthM: 2670, widthM: 45, source: "France's SIA eAIP" },
    ],
    ends: {
      '17R': { ...E, ils: null, approachLights: null, approachLightsM: 0, tdz: false, elevFt: 757.8, pubMag: 173, thr: ['454447.72N', '0050509.38E'] },
      '35L': { ...E, ils: 'III', approachLights: 'ALSF-II', approachLightsM: 900, tdz: true, elevFt: 813.6, pubMag: 353, thr: ['454238.69N', '0050525.08E'] },
      '17L': { ...E, ils: 'I', approachLights: 'ALSF-I', approachLightsM: 900, tdz: false, elevFt: 779.9, pubMag: 173, thr: ['454405.79N', '0050530.73E'] },
      '35R': { ...E, ils: 'III', approachLights: 'ALSF-II', approachLightsM: 900, tdz: true, elevFt: 820.6, pubMag: 353, thr: ['454239.62N', '0050541.21E'] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // OSM's stands; which take a widebody is the geometry's (the parking list not read for code letters)
    stands: { min: 76, max: 76, refs: ['M11', 'J41', 'B10', 'C83'], gates: 18, e787: { min: 60, max: 60 }, e777: { min: 59, max: 59 } },
    countries: ["FR"],
    routes: [['LFLL', 'LFPG', 222.4], ['LFLL', 'LFMN', 153.7], ['LFLL', 'LSGG', 52.5]],
  });
}
