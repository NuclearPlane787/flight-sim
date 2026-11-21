// v0.7.1: Malpensa (LIMC), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v071-eu-limc.test.mjs). Italy's AIP (ENAV's eAIP) asks for a login, so
// nothing here is the AIP's [EST]: the runways are OSM's (17L/35R and 17R/35L 3,920 x 60 m, OSM's length and width tags
// and OurAirports'), the thresholds' elevations and the displacements (17L 941 m, 35L 400 m) OurAirports', the lights
// and ILS general knowledge of the field: ILS CAT III to 35L and 35R, CAT I to 17L and 17R; PAPI left 3 deg at every end;
// TDZ at the CAT III ends; centreline lights everywhere.
//   python3 tools/cpu-guard.py -- node --test tests/v071-eu-limc.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const CAT3 = { tdz: true, papiDeg: 3, ils: 'III', approachLights: 'ALSF-II' };
  const CAT1 = { tdz: false, papiDeg: 3, ils: 'I', approachLights: 'ALSF-I' };
  const OA = { thrSource: 'OurAirports', thrTolM: 25, displacedM: 0 };
  airportSuite({
    icao: 'LIMC', patch: 'malpensa', coast: false,
    shortName: 'Malpensa', name: 'Milan Malpensa Airport',
    latLon: [45.6306, 8.72811], elevM: 234.1,
    runways: [
      { id: '17L/35R', lengthM: 3920, widthM: 60, source: "OSM's length tag and OurAirports [EST]" },
      { id: '17R/35L', lengthM: 3920, widthM: 60, source: "OSM's length tag and OurAirports [EST]" },
    ],
    ends: {
      // 17L's and 35L's thresholds: OSM's nodes where their displaced-threshold ways meet the runways'
      '17L': { ...CAT1, ...OA, thrSource: 'OSM', thrTolM: 15, displacedM: 941, elevFt: 745, thr: [45.642021, 8.7302195] },
      '35R': { ...CAT3, ...OA, elevFt: 691, thr: [45.615741, 8.737507] },
      '17R': { ...CAT1, ...OA, elevFt: 764, thr: [45.645449, 8.718736] },
      '35L': { ...CAT3, ...OA, thrSource: 'OSM', thrTolM: 15, displacedM: 400, elevFt: 696, thr: [45.6143921, 8.7273] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // 17L [EST]: OSM's taxiways reach 17L only at its displaced threshold (941 m in): its hold 833 m from the pavement's end
    farHolds: { '17L': { m: 1000, reason: "OSM's taxiways meet 17L only at its displaced threshold, 941 m in" } },
    // OSM's stands (33 unnumbered ones R1..R33 by the bake); which take a widebody is the geometry's (no parking chart read)
    stands: { min: 81, max: 81, refs: ['509', '413', '701', '724', 'A10', 'B59', '451', '661', 'A71-B71', 'R1'], gates: 17,
      e787: { min: 75, max: 75 }, e777: { min: 69, max: 69 } },
    countries: ['IT'],
    routes: [['LIMC', 'LSZH', 110.0], ['LIMC', 'LIRF', 275.9], ['LIMC', 'EDDM', 205.9]],
  });
}
