// v0.7.3: Gibraltar (LXGB), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v073-eu-lxgb.test.mjs). The UK Military AIP's site did not answer when
// this was baked: every published value [EST]. 09/27 on OSM's pavement (1,755 m end to end; OurAirports' 6,000 ft and
// OSM's length tag 1,798 m are longer than the mapped pavement), the thresholds at OSM's threshold nodes (09 132 m in,
// 27 97 m), the elevations OurAirports' 10 / 11 ft. No ILS, no approach lights (the sea at both ends), PAPI left 3 deg,
// no centreline or TDZ lights. The patch takes in the whole Rock and the bay; a 10 m coast patch: both ends are the shore.
//   python3 tools/cpu-guard.py -- node --test tests/v073-eu-lxgb.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'OSM', thrTolM: 20, papiDeg: 3, ils: null, approachLights: null, approachLightsM: 0, tdz: false, centreline: false };
  airportSuite({
    icao: 'LXGB', patch: 'gibraltar', coast: true,
    shortName: "Gibraltar", name: "Gibraltar International Airport",
    latLon: [36.151679, -5.34978], elevM: 3.7,
    runways: [
      { id: '09/27', lengthM: 1755, widthM: 45, source: "OSM's pavement [EST]" },
    ],
    ends: {
      '09': { ...E, displacedM: 132, elevFt: 10, thr: [36.1508756, -5.3581423] },
      '27': { ...E, displacedM: 97, elevFt: 11, thr: [36.1514729, -5.3411565] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // the game's country raster reads ES at Gibraltar (the lead's raster; the game's country there is GI): both allowed, logged
    // OSM's only way to 09 is the runway itself west of the civil apron: every stand's route to 09's hold back-tracks 1,178 m
    // along 09/27, and a landing on 27 past 45 % turns back along the runway to the apron's exits
    alongRunway: { byEnd: { '09': 1200 }, reason: "OSM maps no taxiway to 09's end: the route back-tracks along the runway" },
    closeHolds: { '09': { m: 24, reason: "OSM's hold for 09 sits 25 m from the centreline at the apron's link" } },
    knownTaxiIn: Object.fromEntries([0.45, 0.6, 0.75, 0.9].map((f) => [`27@${f}`, "no exit ahead in OSM's taxiways west of the civil apron: the taxi-in turns back along the runway"])),
    // OSM's stands; which take a widebody is the geometry's (the parking list not read for code letters)
    stands: { min: 9, max: 9, refs: ['1', '5', 'A'], gates: 3, e787: { min: 3, max: 3 }, e777: { min: 2, max: 2 } },
    countries: ["GI", "ES"],
    routes: [['LXGB', 'LEMD', 273.8], ['LXGB', 'LPPT', 239.7], ['LXGB', 'EGLL', 943.3]],
  });
}
