// v0.7.2: Edinburgh (EGPH), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v072-eu-egph.test.mjs). Against the UK's NATS eAIP (EG AD 2 EGPH,
// AIRAC 29 OCT 2026): AD 2.12 06/24 2,558 x 45 m, true 058.85 / 238.88, the thresholds (inset 214 m at 06, 211 m at 24)
// and their elevations; 12/30 is no longer published. AD 2.14: coded centre-line with five crossbars 870 m at 06, 914 m
// at 24 (CAT III: the game's ALSF-II), PAPI left 3 deg, TDZ and centreline lights at both. AD 2.19: ILS CAT III to 06
// and 24; MAG VAR 0.24 / 0.25 W (2027): the published magnetic is true plus that.
//   python3 tools/cpu-guard.py -- node --test tests/v072-eu-egph.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1, papiDeg: 3, approachLights: 'ALSF-II', ils: 'III', tdz: true };
  airportSuite({
    icao: 'EGPH', patch: 'edinburgh', coast: true,
    shortName: "Edinburgh", name: "Edinburgh Airport",
    latLon: [55.950145, -3.372288], elevM: 41.1,
    runways: [
      { id: '06/24', lengthM: 2558, widthM: 45, source: "the UK's NATS eAIP" },
    ],
    ends: {
      '06': { ...E, displacedM: 214, approachLightsM: 870, elevFt: 110.1, pubMag: 59.09, trueBrg: 58.85, thr: ['555641.99N', '0032313.90W'] },
      '24': { ...E, displacedM: 211, approachLightsM: 914, elevFt: 99.8, pubMag: 239.13, trueBrg: 238.88, thr: ['555717.66N', '0032128.66W'] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // OSM's stands; which take a widebody is the geometry's (the parking list not read for code letters)
    stands: { min: 76, max: 76, refs: ['1', '16A', '201', '310R'], gates: 17, e787: { min: 72, max: 72 }, e777: { min: 63, max: 63 } },
    countries: ["GB"],
    routes: [['EGPH', 'EGLL', 288.1], ['EGPH', 'EGCC', 160.7], ['EGPH', 'EHAM', 359.8]],
  });
}
