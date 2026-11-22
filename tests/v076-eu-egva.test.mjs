// v0.7.6 (airports subagent apa): RAF Fairford (EGVA), pending: the checks in tests/v063-ne-airport.mjs, run in a page
// opened in Europe (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe;
// directly: FS_REGION=europe FS_PENDING=1 node --test tests/v076-eu-egva.test.mjs). The UK Military AIP's site did not
// answer this run: every published value [EST]. 09/27 3,046 x 61 m at OurAirports' ends (OSM's length tag 3,046 m too),
// no displacements, the elevations OurAirports' (09 286, 27 255 ft). An ILS (CAT I) and about 900 m of approach lights at
// both ends (as OSM maps them), PAPI left 3 deg, centreline lights (61 m wide), no TDZ lights. The whole base is military
// in OSM: three ramp spots for the player alone on the north-east apron, placed by the bake [EST]; no other stand. Inland.
//   python3 tools/cpu-guard.py -- node --test tests/v076-eu-egva.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'OurAirports', thrTolM: 15, papiDeg: 3, tdz: false, centreline: true, ils: 'I', approachLights: 'ALSF-I', approachLightsM: 900, displacedM: 0 };
  airportSuite({
    icao: 'EGVA', patch: 'fairford', coast: false,
    shortName: 'Fairford', name: 'RAF Fairford',
    latLon: [51.683568, -1.789172], elevM: 87.2,
    runways: [
      { id: '09/27', lengthM: 3046, widthM: 61, source: "OurAirports' ends, length and width [EST]" },
    ],
    ends: {
      '09': { ...E, elevFt: 286, thr: [51.682999, -1.812000] },
      '27': { ...E, elevFt: 255, thr: [51.683998, -1.768000] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // the player's three ramp spots, placed by the bake on the north-east apron [EST]: each takes the 777-300ER (AIP_STANDS.EGVA)
    stands: { min: 3, max: 3, refs: ['1', '2', '3'], gates: 0, e787: { min: 3, max: 3 }, e777: { min: 3, max: 3 } },
    countries: ['GB'],
    routes: [['EGVA', 'EGLL', 51.1], ['EGVA', 'EGKK', 68.0]],
  });
}
