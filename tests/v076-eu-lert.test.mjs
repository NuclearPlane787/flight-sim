// v0.7.6: Rota (LERT), Naval Station Rota, pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in
// Europe (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v076-eu-lert.test.mjs). Against Spain's ENAIRE AIP (AD 2-LERT, "Spain-USA
// joint use aerodrome. Military use only."): AD 2.12 10/28 3,690 x 61 m, true 096.87 / 276.90 (MAG 098 / 278), the
// thresholds (none displaced: AD 2.13's LDA is the TORA) and their elevations 64 / 62 ft. AD 2.14: no approach lights,
// PAPI 3 deg north of the runway at 10 and 2.75 deg south of it at 28 (both on the left as flown), no TDZ or centreline
// lights. AD 2.19: ILS CAT I to 10, none to 28. The whole base is military: its only stands are the player's five ramp
// spots on the main apron, placed by the bake [EST]. A 10 m coast patch: the Bay of Cádiz.
//   python3 tools/cpu-guard.py -- node --test tests/v076-eu-lert.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1, displacedM: 0, approachLights: null, approachLightsM: 0, tdz: false, centreline: false };
  airportSuite({
    icao: 'LERT', patch: 'rota', coast: true,
    shortName: 'Rota', name: 'Naval Station Rota',
    latLon: [36.645198, -6.34946], elevM: 26.2, pubVar: -1,
    runways: [
      { id: '10/28', lengthM: 3690, widthM: 61, source: "Spain's ENAIRE AIP" },
    ],
    ends: {
      '10': { ...E, ils: 'I', papiDeg: 3, elevFt: 64, pubMag: 98, trueBrg: 96.87, thr: ['363849.93N', '0062211.86W'] },
      '28': { ...E, ils: null, papiDeg: 2.75, elevFt: 62, pubMag: 278, trueBrg: 276.90, thr: ['363835.58N', '0061944.40W'] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // the player's five ramp spots (STAND_POINTS, STAND_POINTS_ONLY), each with room for the 777-300ER
    stands: { min: 5, max: 5, refs: ['1', '2', '3', '4', '5'], gates: 0, e787: { min: 5, max: 5 }, e777: { min: 5, max: 5, include: ['1', '2', '3', '4', '5'] } },
    countries: ['ES'],
    routes: [['LERT', 'LXGB', 56.7], ['LERT', 'LEMD', 265.3], ['LERT', 'LEST', 387.2]],
  });
}
