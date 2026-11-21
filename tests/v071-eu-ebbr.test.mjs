// v0.7.1: Brussels (EBBR), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v071-eu-ebbr.test.mjs). Belgium's eAIP (skeyes) refused the automated
// fetch (HTTP 403): every value [EST]. The runways OSM's; lengths and widths OurAirports' (07L/25R 3,638 x 45 m, 07R/25L
// 3,211 x 45 m, 01/19 2,987 x 50 m); the thresholds' elevations OurAirports', the displacements OSM's displaced-threshold
// ways (07L 287, 25R 297, 07R 117, 01 44, 19 218 m); lights and ILS general knowledge: CAT III to 25L and 25R, CAT I to
// 07L, 07R and 01, none to 19; 900 m approach lights but at 19; PAPI left 3 deg; TDZ at 25L and 25R.
//   python3 tools/cpu-guard.py -- node --test tests/v071-eu-ebbr.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  // No AIP: the thresholds are OSM's (no published co-ordinates or magnetic bearings to check against)
  const E = { papiDeg: 3, displacedM: 0, thrSource: 'OSM', thrTolM: 15 };
  const C1 = { ils: 'I', approachLights: 'ALSF-I', tdz: false }, C3 = { ils: 'III', approachLights: 'ALSF-II', tdz: true };
  airportSuite({
    icao: 'EBBR', patch: 'brussels', coast: false,
    shortName: 'Brussels', name: 'Brussels Airport',
    latLon: [50.901402, 4.48444], elevM: 53.3,
    runways: [
      { id: '07L/25R', lengthM: 3638, widthM: 45, source: 'OurAirports [EST]' },
      { id: '01/19', lengthM: 2987, widthM: 50, source: 'OurAirports [EST]' },
      { id: '07R/25L', lengthM: 3211, widthM: 45, source: 'OurAirports [EST]' },
    ],
    ends: {
      '07L': { ...E, ...C1, displacedM: 287, elevFt: 129, thr: [50.9001414, 4.4599413] },
      '25R': { ...E, ...C3, displacedM: 297, elevFt: 110, thr: [50.9115456, 4.4994032] },
      '07R': { ...E, ...C1, displacedM: 117, elevFt: 175, thr: [50.8894083, 4.48203] },
      '25L': { ...E, ...C3, elevFt: 159, thr: [50.898926, 4.5232505] },
      '01': { ...E, ...C1, displacedM: 44, elevFt: 183, thr: [50.8873182, 4.4915718] },
      // 19's elevation [EST], the lead's: 108.4 ft, not OurAirports' 113 ft, so that 01/19's surface meets 07L/25R's where its
      // north end crosses it (the game shapes one crossing a runway; tools/bake_region_airports.py says why). The game takes 19
      // for landings only (ONE_WAY), its own limit.
      '19': { ...E, ils: null, approachLights: null, approachLightsM: 0, tdz: false, displacedM: 218, elevFt: 108.4, thr: [50.9110179, 4.5012443] },
    },
    fieldSurface: 'runways', fieldPavement: true, crossingProfile: true,
    // 07L/25R reads 063/243 M against its ident 07/25 (WMM2025's 2.5 E; the runway kept its name): 8 deg allowed
    identTolDeg: 8,
    // 19's threshold is 218 m in and OSM's taxiways meet 01/19 only at 01's end and the crossings: the way to 19 runs along it
    alongRunway: { byEnd: { '19': 1200, '25L': 1000, '25R': 60 }, reason: "OSM's taxiways reach 19 only along the runway" },
    knownTaxiIn: { '07R@0.75': "OSM's exits from 07R past 75 % lead back along the runway", '07R@0.9': "OSM's exits from 07R past 75 % lead back along the runway" },
    closeHolds: { '25L': { m: 20, reason: "OSM's hold for 25L sits 24 m from the centreline" } },
    // OSM's stands; which take a widebody is the geometry's (no parking chart read)
    stands: { min: 166, max: 166, refs: ['973', '510', '955'], gates: 62, e787: { min: 146, max: 146 }, e777: { min: 137, max: 137 } },
    countries: ['BE'],
    routes: [['EBBR', 'EHAM', 85.1], ['EBBR', 'EGLL', 189.1], ['EBBR', 'LFPG', 135.9]],
  });
}
