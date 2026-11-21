// v0.7.2: Glasgow (EGPF), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v072-eu-egpf.test.mjs). Against the UK's NATS eAIP (EG AD 2 EGPF,
// AIRAC 29 OCT 2026): AD 2.12 05/23 2,661 x 45 m, true 046.40 / 226.42, the thresholds (23's displaced 304 m) and their
// elevations. AD 2.14: coded centre-line with five crossbars 914 m at both (CAT III: ALSF-II), PAPI left 3 deg, TDZ and
// centreline lights at both. AD 2.19: ILS CAT III to 05 and 23; MAG VAR 0.65 / 0.66 W (2027). AD 2.20: a full-length
// take-off on 23 back-tracks the runway (no taxiway to 23's end).
//   python3 tools/cpu-guard.py -- node --test tests/v072-eu-egpf.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1, papiDeg: 3, approachLights: 'ALSF-II', approachLightsM: 914, ils: 'III', tdz: true };
  airportSuite({
    icao: 'EGPF', patch: 'glasgow', coast: true,
    shortName: "Glasgow", name: "Glasgow Airport",
    latLon: [55.871899, -4.43306], elevM: 7.9,
    runways: [
      { id: '05/23', lengthM: 2661, widthM: 45, source: "the UK's NATS eAIP" },
    ],
    ends: {
      '05': { ...E, displacedM: 0, elevFt: 26.1, pubMag: 47.05, trueBrg: 46.40, thr: ['555148.53N', '0042656.59W'] },
      '23': { ...E, displacedM: 304, elevFt: 20.8, pubMag: 227.08, trueBrg: 226.42, thr: ['555241.07N', '0042518.43W'] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // OSM's stands; which take a widebody is the geometry's (the parking list not read for code letters)
    stands: { min: 53, max: 53, refs: ['1A', '30L', '37R', '61'], gates: 39, e787: { min: 40, max: 40 }, e777: { min: 25, max: 25 } },
    countries: ["GB"],
    routes: [['EGPF', 'EGLL', 299.5], ['EGPF', 'EGCC', 168.9], ['EGPF', 'EIDW', 159.8]],
  });
}
