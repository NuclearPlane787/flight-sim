// v0.7.3: Venice (LIPZ), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v073-eu-lipz.test.mjs). Italy's ENAV eAIP asks for a login: every
// published value [EST]. 04R/22L 3,300 x 45 m and 04L/22R 2,780 x 45 m (OurAirports' 10,827 and 9,121 ft) on OSM's ways,
// 04L's threshold 94 m in (OurAirports' 308 ft), the elevations 7 ft. ILS CAT III to 04R (900 m, TDZ), 420 m approach
// lights and no ILS at 22L, nothing at 04L/22R (the standby runway); PAPI left 3 deg. On the lagoon: a 10 m coast patch.
//   python3 tools/cpu-guard.py -- node --test tests/v073-eu-lipz.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'OSM', thrTolM: 20, papiDeg: 3 };
  airportSuite({
    icao: 'LIPZ', patch: 'venice', coast: true,
    shortName: "Venice", name: "Venice Marco Polo Airport",
    latLon: [45.505299, 12.3519], elevM: 2.1,
    runways: [
      { id: '04R/22L', lengthM: 3300, widthM: 45, source: "OurAirports [EST]" },
      { id: '04L/22R', lengthM: 2780, widthM: 45, source: "OurAirports [EST]" },
    ],
    ends: {
      '04R': { ...E, ils: 'III', approachLights: 'ALSF-II', tdz: true, displacedM: 0, elevFt: 7, thr: [45.493999, 12.337549] },
      '22L': { ...E, ils: null, approachLights: 'SSALF', approachLightsM: 420, tdz: false, displacedM: 0, elevFt: 7, thr: [45.51617, 12.366072] },
      '04L': { ...E, ils: null, approachLights: null, approachLightsM: 0, tdz: false, centreline: false, displacedM: 94, elevFt: 7, thr: [45.495778, 12.336375] },
      '22R': { ...E, ils: null, approachLights: null, approachLightsM: 0, tdz: false, centreline: false, displacedM: 0, elevFt: 7, thr: [45.513707, 12.359428] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // OSM's taxiways meet 22R ~690 m from its end; stands' routes to 22L run ~560 m along 04R/22L; landings far along 04R
    // and 04L find their exits behind them in OSM's taxiways
    farHolds: { '22R': { m: 700, reason: "OSM's nearest hold for 22R is 688 m from its end" } },
    alongRunway: { byEnd: { '22L': 600 }, reason: "OSM's taxi route to 22L's hold runs ~560 m along the runway" },
    // (the review, 00:34: these three were routed 500 m BACK along 04R until the standby runway stopped counting as a back-track)
    knownTaxiIn: { '04R@0.6': "the exit ahead (H) leads off along 04L/22R, the standby runway that serves as the taxiway: about 500 m of it, not a back-track (gate-flow.js's RUNWAY_AS_TAXIWAY)", '04R@0.75': "the exit ahead (H) leads off along 04L/22R, the standby runway that serves as the taxiway: about 500 m of it, not a back-track (gate-flow.js's RUNWAY_AS_TAXIWAY)",
      '04R@0.9': "the exit ahead (J, T) leads off along 04L/22R, the standby runway that serves as the taxiway: about 560 m of it, not a back-track", '04L@0.9': "the nearest exit in OSM's taxiways lies ~500 m behind" },
    // OSM's stands; which take a widebody is the geometry's (the parking list not read for code letters)
    stands: { min: 60, max: 60, refs: ['432', '110', '217', '362'], gates: 8, e787: { min: 46, max: 46 }, e777: { min: 42, max: 42 } },
    countries: ["IT"],
    routes: [['LIPZ', 'LIMC', 152.5], ['LIPZ', 'LIRF', 222.2], ['LIPZ', 'LOWW', 233.4]],
  });
}
