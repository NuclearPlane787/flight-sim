// v0.7.6 (airports subagent apb): RAF Lossiemouth (EGQS), pending: the checks in tests/v063-ne-airport.mjs, run in a page
// opened in Europe (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe;
// directly: FS_REGION=europe FS_PENDING=1 node --test tests/v076-eu-egqs.test.mjs). The UK Military AIP's site did not
// answer when this was baked: every published value [EST]. 05/23 2,764 m and 10/28 1,850 m (the UK Military AIP's as
// published secondhand; 10/28 baked at 1,845 m, see the bake tool), 46 m wide (OSM), the ends at OurAirports' (23 displaced 93 m, 10 98 m), the elevations
// OurAirports' (05 20, 23 24, 10 39, 28 37 ft). An ILS (CAT I) and 900 m approach lights to 05 and 23, none to 10/28;
// PAPI left 3 deg; no TDZ or centreline lights. 10/28 crosses 05/23 (the game bends 10/28 to 05/23's level there; the
// patch follows the bends, FIELD_BENT). The whole base is military in OSM: four ramp spots for the player alone on D Apron,
// placed by the bake [EST]; no other stand. A 10 m coast patch (the Moray Firth 2 km north).
//   python3 tools/cpu-guard.py -- node --test tests/v076-eu-egqs.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'OurAirports', thrTolM: 15, papiDeg: 3, tdz: false, centreline: false };
  const ILS = { ...E, ils: 'I', approachLights: 'ALSF-I', approachLightsM: 900 };
  const VIS = { ...E, ils: null, approachLights: null, approachLightsM: 0 };
  airportSuite({
    icao: 'EGQS', patch: 'lossiemouth', coast: true,
    shortName: 'Lossiemouth', name: 'RAF Lossiemouth',
    latLon: [57.7052, -3.33917], elevM: 12.8,
    // 05/23's magnetic heading is 044.5 M (WMM2025, 0.8 W): 5.5 deg off its ident
    identTolDeg: 6,
    runways: [
      { id: '10/28', lengthM: 1845, widthM: 46, source: "OurAirports' ends, the UK Military AIP's length [EST]" },
      { id: '05/23', lengthM: 2764, widthM: 46, source: "OurAirports' ends, the UK Military AIP's length [EST]" },
    ],
    ends: {
      '05': { ...ILS, displacedM: 0, elevFt: 20, thr: [57.698002, -3.353420] },
      '23': { ...ILS, displacedM: 93, elevFt: 24, thr: [57.715365, -3.322395] },
      '10': { ...VIS, displacedM: 98, elevFt: 39, thr: [57.707170, -3.342189] },
      '28': { ...VIS, displacedM: 0, elevFt: 37, thr: [57.705399, -3.313010] },
    },
    fieldSurface: 'runways', fieldPavement: true, fieldBent: true, crossingProfile: true,
    // the player's four ramp spots, placed by the bake on D Apron [EST]: each takes the 777-300ER (AIP_STANDS.EGQS)
    stands: { min: 4, max: 4, refs: ['1', '2', '3', '4'], gates: 0, e787: { min: 4, max: 4 }, e777: { min: 4, max: 4 } },
    countries: ['GB'],
    routes: [['EGQS', 'EGPH', 105.4], ['EGQS', 'EGLL', 387.4]],
  });
}
