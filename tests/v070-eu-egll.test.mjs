// v0.7.0: London Heathrow (EGLL), Europe's first airport, pending: the checks in tests/v063-ne-airport.mjs, run in a page
// opened in Europe (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe;
// directly: FS_REGION=europe FS_PENDING=1 node --test tests/v070-eu-egll.test.mjs). Against the UK's NATS eAIP
// (EG AD 2 EGLL, AIRAC 29 OCT 2026): AD 2.12 09L/27R 3,901 x 50 m and 09R/27L 3,658 x 50 m with their landing thresholds'
// coordinates, elevations and true bearings; AD 2.13 09L's threshold displaced 309 m and 09R's 308 m; AD 2.14 the coded
// centreline approach lights with five crossbars (860 to 939 m: the game's ALSF-II), PAPI 3 deg (its side not stated:
// left [EST]), TDZ and centreline lights at all four; AD 2.19 ILS CAT III at all four. Magnetic bearings are AD 2.12's
// true less AD 2.2's variation (1.23 E, 2027): the AIP gives no magnetic bearing.
//   python3 tools/cpu-guard.py -- node --test tests/v070-eu-egll.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const AIP = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1, tdz: true, papiDeg: 3, ils: 'III', approachLights: 'ALSF-II' };
  airportSuite({
    icao: 'EGLL', patch: 'heathrow', coast: false,
    shortName: 'Heathrow', name: 'London Heathrow Airport',
    latLon: [51.470748, -0.459909], elevM: 25.3, pubVar: 1.23,
    runways: [
      { id: '09R/27L', lengthM: 3658, widthM: 50, source: "the UK's NATS eAIP" },
      { id: '09L/27R', lengthM: 3901, widthM: 50, source: "the UK's NATS eAIP" },
    ],
    ends: {
      '09L': { ...AIP, elevFt: 78.6, displacedM: 309, approachLightsM: 860, pubMag: 88.44, trueBrg: 89.67, thr: ['512839.00N', '0002905.97W'] },
      '27R': { ...AIP, elevFt: 78.1, displacedM: 0, approachLightsM: 905, pubMag: 268.48, trueBrg: 269.71, thr: ['512839.63N', '0002559.82W'] },
      '09R': { ...AIP, elevFt: 75.3, displacedM: 308, approachLightsM: 939, pubMag: 88.45, trueBrg: 89.68, thr: ['512753.25N', '0002856.33W'] },
      '27L': { ...AIP, elevFt: 76.8, displacedM: 0, approachLightsM: 922, pubMag: 268.49, trueBrg: 269.72, thr: ['512753.82N', '0002602.76W'] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // The 400s (Terminal 4's stands, south of 09R/27L) to 27R: OSM's taxiway across 09R/27L's east end runs within 20 deg of
    // the runway for 7 m of the crossing; the rest of every route stays off the runways.
    alongRunway: { byEnd: { '27R': 10 }, reason: "crossing 09R/27L at its east end, OSM's taxiway within 20 deg of the runway for 7 m" },
    // OSM's stands (MARS stands' L and R positions as their own), 'TBA South Pen' outside the aerodrome left out; which take
    // a widebody is the geometry's (no AIP_STANDS entry: AD 2.20 publishes no stand-by-stand size list in text)
    stands: { min: 288, max: 288, refs: ['209', '209L', '209R', '326', '363', '417', '501', '527', '548L', '581', '607', 'TA3'], gates: 156,
      e787: { min: 253, max: 253, include: ['501', '503'] }, e777: { min: 244, max: 244, include: ['501', '503'] } },
    countries: ['GB'],
    routes: [['EGLL', 'LFPG', 187.7]],
  });
}
