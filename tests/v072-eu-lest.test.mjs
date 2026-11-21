// v0.7.2: Santiago (LEST), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v072-eu-lest.test.mjs). Against Spain's ENAIRE AIP (AD 2-LEST,
// WEF 29-OCT-26): AD 2.12 17/35, TORA 3,140 / 3,170 x 45 m, true 166.15 (MAG 167) / 346.16 (347), the thresholds (DTHR
// 17 120 m and 35 150 m from AD 2.13's beginnings of the take-off runs, which bound the 3,200 m pavement) and their
// elevations. AD 2.14: 17 precision CAT II/III 900 m (ALSF-II) with TDZ 900 m; 35 precision CAT I 420 m (ALSF-I,
// provisional), no TDZ; PAPI 3 deg (side not stated: left [EST]); centreline lights on both. AD 2.19: ILS CAT III to 17,
// CAT I to 35.
//   python3 tools/cpu-guard.py -- node --test tests/v072-eu-lest.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1, papiDeg: 3 };
  airportSuite({
    icao: 'LEST', patch: 'santiago', coast: false,
    shortName: "Santiago", name: "Santiago–Rosalía de Castro Airport",
    latLon: [42.896301, -8.41514], elevM: 369.7,
    runways: [
      { id: '17/35', lengthM: 3200, widthM: 45, source: "Spain's ENAIRE AIP (the pavement between AD 2.13's take-off starts)" },
    ],
    ends: {
      '17': { ...E, ils: 'III', approachLights: 'ALSF-II', approachLightsM: 900, tdz: true, displacedM: 120, elevFt: 1170, pubMag: 167, trueBrg: 166.15, thr: ['425438.731N', '0082511.90W'] },
      '35': { ...E, ils: 'I', approachLights: 'ALSF-I', approachLightsM: 420, tdz: false, displacedM: 150, elevFt: 1200, pubMag: 347, trueBrg: 346.16, thr: ['425306.51N', '0082440.98W'] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // OSM's stands; which take a widebody is the geometry's (the parking list not read for code letters)
    stands: { min: 57, max: 57, refs: ['01', '26', 'A6', '44'], gates: 13, e787: { min: 21, max: 21 }, e777: { min: 18, max: 18 } },
    countries: ["ES"],
    routes: [['LEST', 'LEMD', 260.6], ['LEST', 'LEBL', 476.9], ['LEST', 'LPPT', 249.2]],
  });
}
