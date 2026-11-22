// v0.7.6 (airports subagent apb): RAF Lakenheath (EGUL), pending: the checks in tests/v063-ne-airport.mjs, run in a page
// opened in Europe (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe;
// directly: FS_REGION=europe FS_PENDING=1 node --test tests/v076-eu-egul.test.mjs). The UK Military AIP's site did not
// answer when this was baked: every published value [EST]. One runway, 05/23 (OSM's main way and OurAirports; OSM's
// 17 m piece tagged 06/24 left out), 2,743 m x 46 m, the ends at OurAirports', no displacement, elevations 27 / 28 ft.
// An ILS (CAT I) and 900 m approach lights at both ends, PAPI left 3 deg, no TDZ or centreline lights. The whole base is
// military in OSM: three ramp spots for the player alone on Victor Ramp, placed by the bake [EST]; no other stand. RAF
// Mildenhall, 8 km south-west, is not built.
//   python3 tools/cpu-guard.py -- node --test tests/v076-eu-egul.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'OurAirports', thrTolM: 15, papiDeg: 3, tdz: false, centreline: false, ils: 'I', approachLights: 'ALSF-I', approachLightsM: 900 };
  airportSuite({
    icao: 'EGUL', patch: 'lakenheath', coast: false,
    shortName: 'Lakenheath', name: 'RAF Lakenheath',
    latLon: [52.40954, 0.561161], elevM: 9.8,
    runways: [
      { id: '05/23', lengthM: 2743, widthM: 46, source: "OurAirports' ends and length [EST]" },
    ],
    ends: {
      '05': { ...E, displacedM: 0, elevFt: 27, thr: [52.4025, 0.544383] },
      '23': { ...E, displacedM: 0, elevFt: 28, thr: [52.416401, 0.577647] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // the player's three ramp spots, placed by the bake on Victor Ramp [EST]: each takes the 777-300ER (AIP_STANDS.EGUL)
    stands: { min: 3, max: 3, refs: ['1', '2', '3'], gates: 0, e787: { min: 3, max: 3 }, e777: { min: 3, max: 3 } },
    countries: ['GB'],
    routes: [['EGUL', 'EGLL', 67.5], ['EGUL', 'EGKK', 80.5]],
  });
}
