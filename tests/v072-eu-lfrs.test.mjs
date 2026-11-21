// v0.7.2: Nantes (LFRS), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v072-eu-lfrs.test.mjs). Against France's SIA eAIP (AD 2 LFRS,
// AIRAC 29 OCT 2026): AD 2.12 03/21 2,853 x 45 m, true 027.44 (MAG 028) / 207.44 (208), 03's threshold at the runway end,
// 21's DTHR (AD 2.13 LDA 2,591: 262 m in) and the elevations. AD 2.14: 03 CAT I-II-III 900 m (ALSF-II) with TDZ 900 m;
// 21 420 m (the game's SSALF), no TDZ; PAPI 3.0 deg at 03, 3.1 at 21 (side not stated: left [EST]); centreline lights on
// both. AD 2.19: LOC 03 III.E.4; none to 21. AD 2.12's MAG 028 / 208 against AD 2.2's 0.72 E (true less it: 026.72):
// the published magnetic is checked to 2 deg.
//   python3 tools/cpu-guard.py -- node --test tests/v072-eu-lfrs.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 2 };
  airportSuite({
    icao: 'LFRS', patch: 'nantes', coast: false,
    shortName: "Nantes", name: "Nantes Atlantique Airport",
    latLon: [47.153198, -1.61073], elevM: 27.4,
    runways: [
      { id: '03/21', lengthM: 2853, widthM: 45, source: "France's SIA eAIP" },
    ],
    ends: {
      '03': { ...E, ils: 'III', approachLights: 'ALSF-II', approachLightsM: 900, tdz: true, papiDeg: 3, displacedM: 0, elevFt: 73, pubMag: 28, trueBrg: 27.44, thr: ['470829.77N', '0013710.36W'] },
      '21': { ...E, ils: null, approachLights: 'SSALF', approachLightsM: 420, tdz: false, papiDeg: 3.1, displacedM: 262, elevFt: 83, pubMag: 208, trueBrg: 207.44, thr: ['470944.24N', '0013613.66W'] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // OSM's stands; which take a widebody is the geometry's (the parking list not read for code letters)
    stands: { min: 33, max: 33, refs: ['L2', '5A', 'M1', 'Porte 3'], gates: 0, e787: { min: 15, max: 15 }, e777: { min: 19, max: 19 } },
    countries: ["FR"],
    routes: [['LFRS', 'LFPG', 200.8], ['LFRS', 'LFPO', 185.6], ['LFRS', 'LFBO', 245.9]],
  });
}
