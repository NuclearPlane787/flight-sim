// v0.7.0: Schiphol (EHAM), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v070-eu-eham.test.mjs). The Netherlands' eAIP (LVNL) refuses automated
// fetches, so nothing here is the AIP's [EST]: the runways are OSM's (18R/36L 3,800 x 60 m, 18C/36C 3,300 x 45,
// 18L/36R 3,400 x 45, 09/27 3,453 x 45, 04/22 2,014 x 45, OSM's length tags; 06/24 3,439 x 45, OurAirports', OSM's tag
// 3,500), the thresholds' elevations (-11 to -14 ft: the field lies below sea level) and displacements OurAirports', the
// lights and ILS general knowledge of the field: ILS CAT III to 18R, 18C, 36R, 06 and 27, CAT I to 36C, 24, 09 and 22,
// none to 04; 36L and 18L are take-off only (18R/36L lands 18R, 18L/36R lands 36R): no approach lights, PAPI or ILS.
//   python3 tools/cpu-guard.py -- node --test tests/v070-eu-eham.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const CAT3 = { tdz: true, papiDeg: 3, ils: 'III', approachLights: 'ALSF-II' };
  const CAT1 = { tdz: false, papiDeg: 3, ils: 'I', approachLights: 'ALSF-I' };
  const TKO = { tdz: false, papi: null, papiDeg: null, ils: null, approachLights: null, approachLightsM: 0 };
  const OA = { thrSource: 'OurAirports', thrTolM: 25, displacedM: 0 };
  // a displaced threshold: OSM's node where its displaced-threshold way meets the runway's
  const OSM = { thrSource: 'OSM', thrTolM: 15 };
  airportSuite({
    icao: 'EHAM', patch: 'schiphol', coast: false,
    shortName: 'Schiphol', name: 'Amsterdam Airport Schiphol',
    latLon: [52.308601, 4.76389], elevM: -3.4,
    identTolDeg: 6,
    runways: [
      { id: '18L/36R', lengthM: 3400, widthM: 45, source: "OSM's length tag [EST]" },
      { id: '04/22', lengthM: 2014, widthM: 45, source: "OSM's length tag [EST]" },
      { id: '18C/36C', lengthM: 3300, widthM: 45, source: "OSM's length tag [EST]" },
      { id: '09/27', lengthM: 3453, widthM: 45, source: "OSM's length tag [EST]" },
      { id: '18R/36L', lengthM: 3800, widthM: 60, source: "OSM's length tag [EST]" },
      { id: '06/24', lengthM: 3439, widthM: 45, source: "OurAirports (OSM's tag 3500) [EST]" },
    ],
    ends: {
      '18R': { ...CAT3, ...OSM, displacedM: 270, elevFt: -13, thr: [52.36025, 4.711723] },
      '36L': { ...TKO, ...OA, elevFt: -12, thr: [52.32860184, 4.70883989] },
      '18C': { ...CAT3, ...OA, elevFt: -13, thr: [52.33140183, 4.74002981] },
      '36C': { ...CAT1, ...OSM, displacedM: 450, elevFt: -12, thr: [52.305822, 4.737682] },
      '18L': { ...TKO, ...OSM, displacedM: 575, elevFt: -12, thr: [52.31614, 4.779691] },
      '36R': { ...CAT3, ...OA, elevFt: -11, thr: [52.29079818, 4.77734995] },
      '09': { ...CAT1, ...OSM, displacedM: 90, elevFt: -12, thr: [52.316689, 4.747716] },
      '27': { ...CAT3, ...OA, elevFt: -13, thr: [52.31840134, 4.79688978] },
      '06': { ...CAT3, ...OSM, thrTolM: 25, displacedM: 250, elevFt: -11, thr: [52.289117, 4.737248] },
      '24': { ...CAT1, ...OSM, displacedM: 0, elevFt: -12, thr: [52.304375, 4.776973] },
      '04': { ...CAT1, ...OA, ils: null, approachLights: null, approachLightsM: 0, centreline: false, elevFt: -13, thr: [52.30039978, 4.78348017] },
      '22': { ...CAT1, ...OA, centreline: false, elevFt: -14, thr: [52.31399918, 4.80302012] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // 18R is landing only (18R/36L: landings 18R, take-offs 36L [EST]): OSM's taxiways at the Polderbaan's north end join
    // nothing a stand reaches. Logged; it must stay so.
    knownNoRoute: { '18R': "landing only [EST]; OSM's taxiways at the Polderbaan's north end reach no hold from a stand" },
    // 06: OSM's taxiways S1 and S10 meet 06/24 850 m from its pavement end (past the 250 m displaced threshold); the routes
    // backtrack along the runway to an unnamed stub OSM maps on its first 140 m, whose end is the hold, 26 m off the
    // centreline. Logged as OSM maps it, for the lead's look in Chrome.
    closeHolds: { '06': { m: 20, reason: "OSM's only way onto 06's first 850 m is an unnamed stub on the runway's start" } },
    alongRunway: { m: 1, byEnd: { '06': 830 }, byStand: Object.fromEntries(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'R9', 'R10', 'R11', 'R12'].map((r) => [r, 900])),
      reason: "06: S1/S10 meet the runway 850 m in (the backtrack); stands L1-L6 and R9-R12 by 04/22's end reach 04 only along 04/22 in OSM" },
    // 36L and 18L are take-off only [EST]: landings on them have no exit ahead in OSM (the exits face 18R's and 36R's
    // landings); 24 at 90 % runs to 06's end and back along the runway (the S1/S10 entry above)
    knownTaxiIn: {
      ...Object.fromEntries([0.3, 0.45, 0.6, 0.75, 0.9].map((f) => [`36L@${f}`, "take-off only [EST]: no exit ahead in OSM, the Polderbaan's exits face 18R landings"])),
      ...Object.fromEntries([0.6, 0.75, 0.9].map((f) => [`18L@${f}`, 'take-off only [EST]: no exit ahead in OSM, the exits face 36R landings'])),
      '24@0.9': "90 % along 24 lies past S1/S10: the route runs on to 06's end and back along the runway",
    },
    stands: { min: 293, max: 293, refs: ['D53', 'E22', 'F6', 'G6', 'B28', 'C16', 'M59', 'S77', 'R1', 'PA'], gates: 81,
      e787: { min: 202, max: 202 }, e777: { min: 184, max: 184 } },
    countries: ['NL'],
    routes: [['EHAM', 'EGLL', 200.0], ['EHAM', 'LFPG', 215.2], ['EHAM', 'EDDF', 197.9]],
  });
}
