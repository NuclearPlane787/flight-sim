// v0.7.3: Naples (LIRN), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v073-eu-lirn.test.mjs). Italy's ENAV eAIP asks for a login: every
// published value [EST]. 06/24 2,628 x 45 m (OurAirports' 8,622 ft), its ends at the outer ends of OSM's unnamed runway
// ways, the thresholds at OSM's threshold nodes (06 398 m in, 24 196 m), the elevations OurAirports' 284 / 223 ft. ILS
// CAT I to 24 (900 m), nothing at 06; PAPI left 3 deg; centreline lights. The patch takes in Vesuvius.
//   python3 tools/cpu-guard.py -- node --test tests/v073-eu-lirn.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'OSM', thrTolM: 20, papiDeg: 3, tdz: false };
  airportSuite({
    icao: 'LIRN', patch: 'naples', coast: true,
    shortName: "Naples", name: "Naples International Airport",
    latLon: [40.886002, 14.2908], elevM: 89.6,
    runways: [
      { id: '06/24', lengthM: 2628, widthM: 45, source: "OurAirports [EST]" },
    ],
    ends: {
      '06': { ...E, ils: null, approachLights: null, approachLightsM: 0, displacedM: 398, elevFt: 284, thr: [40.8816791, 14.281547] },
      '24': { ...E, ils: 'I', approachLights: 'ALSF-I', displacedM: 196, elevFt: 223, thr: [40.8913884, 14.302134] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // the runway's true bearing 058.1 less WMM2025's 4.2 E is 053.9 M, 6.1 deg from its designator 06/24 (OurAirports' 058.1 true)
    identTolDeg: 6.5,
    // OSM's stands; which take a widebody is the geometry's (the parking list not read for code letters)
    stands: { min: 43, max: 43, refs: ['11', '45', '75', 'SC1'], gates: 0, e787: { min: 37, max: 37 }, e777: { min: 29, max: 29 } },
    countries: ["IT"],
    routes: [['LIRN', 'LIRF', 107.2], ['LIRN', 'LIMC', 374.4], ['LIRN', 'LIPZ', 290.0]],
  });
}
