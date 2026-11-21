// v0.7.0: Zurich (LSZH), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v070-eu-lszh.test.mjs). Switzerland's AIP (skyguide's eAIP) asks for a
// login, so nothing here is the AIP's: the runways are OSM's (10/28 2,500 m, 14/32 3,300 m, 16/34 3,700 m, all 60 m wide,
// the lengths OurAirports' and OSM's length tags), the thresholds' elevations and displacements (14 150 m, 34 470 m)
// OurAirports', the lights and ILS general knowledge of the field [EST]: ILS CAT III to 14 and 16, CAT I to 28 and 34,
// none to 10 and 32; PAPI left 3 deg everywhere; TDZ at 14 and 16. Zurich's runway names are older than today's
// variation: 16 reads 151 M, 10 092 M (identTolDeg 9).
//   python3 tools/cpu-guard.py -- node --test tests/v070-eu-lszh.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const CAT3 = { tdz: true, papiDeg: 3, ils: 'III', approachLights: 'ALSF-II' };
  const CAT1 = { tdz: false, papiDeg: 3, ils: 'I', approachLights: 'ALSF-I' };
  const NONE = { tdz: false, papiDeg: 3, ils: null, approachLights: null, approachLightsM: 0 };
  const OA = { thrSource: 'OurAirports', thrTolM: 25, displacedM: 0 };
  // a displaced threshold: OSM's node where its displaced-threshold way meets the runway's
  const OSM = { thrSource: 'OSM', thrTolM: 15 };
  airportSuite({
    icao: 'LSZH', patch: 'zurich', coast: false,
    shortName: 'Zurich', name: 'Zurich Airport',
    latLon: [47.458056, 8.548056], elevM: 431.9,
    identTolDeg: 9,
    runways: [
      { id: '14/32', lengthM: 3300, widthM: 60, source: 'OurAirports and OSM [EST]' },
      { id: '10/28', lengthM: 2500, widthM: 60, source: 'OurAirports and OSM [EST]' },
      { id: '16/34', lengthM: 3700, widthM: 60, source: 'OurAirports and OSM [EST]' },
    ],
    ends: {
      '10': { ...NONE, ...OA, elevFt: 1391, thr: [47.4589004, 8.5374698] },
      '28': { ...CAT1, ...OA, elevFt: 1416, thr: [47.4566, 8.57045] },
      '14': { ...CAT3, ...OSM, displacedM: 150, elevFt: 1402, thr: [47.482092, 8.536074] },
      '32': { ...NONE, ...OA, elevFt: 1402, thr: [47.4613, 8.56446] },
      '16': { ...CAT3, ...OA, elevFt: 1390, thr: [47.475601, 8.53595] },
      '34': { ...CAT1, ...OSM, thrTolM: 25, displacedM: 470, elevFt: 1388, thr: [47.449276, 8.554143] },
    },
    fieldSurface: 'runways', fieldPavement: true, crossingProfile: true,
    // OSM maps taxiway B on 16/34's centreline for ~600 m north of the 10/28 crossing (2,287 to 2,928 m from 16's end): the
    // western and southern aprons' routes to 14 and 16 (and seven stands' to 10) run along it; elsewhere the crossings of
    // 10/28, 14/32 and 16/34 at a shallow angle, 23 to 29 m. Logged as OSM maps it, for the lead's look in Chrome.
    alongRunway: { m: 30, byEnd: { '14': 610, '16': 610 }, byStand: Object.fromEntries(['801', '802', '803', '804', '805', '712', 'W33'].map((r) => [r, 660])),
      reason: "OSM's taxiway B along 16/34's centreline for ~600 m north of the 10/28 crossing; elsewhere shallow crossings (23-29 m)" },
    // 32 is a take-off runway (landings on 14): 90 % along it, by 14's threshold, no exit ahead
    // Nine stands by 10/28 (H11-H14, I01-I05) stand on the game's 10/28, which bends to 16/34's level across the crossing
    // (runwayCrossings(): OurAirports' elevations put 10/28's straight line ~2 m above 16/34 there [EST]), so the ground
    // is 0.9-1.5 m off the straight profiles the patch is flattened to. Logged until the AIP's elevations are read.
    standGround: { byStand: Object.fromEntries(['H11', 'H12', 'H13', 'H14', 'I01', 'I02', 'I03', 'I04', 'I05'].map((r) => [r, 1.6])),
      reason: "by 10/28, whose game surface bends to 16/34's level across the crossing (OurAirports' elevations [EST])" },
    knownTaxiIn: { '32@0.9': "90 % along 32 lies past every exit OSM maps toward 14's end (32 is used for take-offs)" },
    // OSM's stands (H14's second stand renamed H14-2); which take a widebody is the geometry's (no AIP read)
    stands: { min: 218, max: 218, refs: ['W01', 'P35', 'F70', 'G01', 'T63', 'C60', 'D17', 'A13', 'E19', 'H11', '301', 'V07'], gates: 50,
      e787: { min: 134, max: 134, include: ['T42', 'G01'] }, e777: { min: 130, max: 130, include: ['F70', 'G01'] } },
    countries: ['CH'],
    routes: [['LSZH', 'EDDF', 154.2], ['LSZH', 'LFPG', 257.1], ['LSZH', 'EGLL', 425.7]],
  });
}
