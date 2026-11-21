// v0.7.0: Frankfurt (EDDF), Europe's third airport, pending: the checks in tests/v063-ne-airport.mjs, run in a page opened
// in Europe (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v070-eu-eddf.test.mjs). Against Germany's DFS AIP IFR (AD 2 EDDF,
// effective 29 OCT 2026): AD 2.12 07C/25C 4,000 x 60 m, 07L/25R 2,800 x 45, 07R/25L 4,000 x 45, 18 4,000 x 45, the
// thresholds' coordinates, elevations and true bearings; AD 2.13 no displacement anywhere, 07L/25R landing only (TORA
// "-"), 18 take-off only (LDA "-", TORA 3,970: no 36 row at all); AD 2.14 ALSAF (the game's ALSF-II; its 900 m [EST]),
// PAPI 3.0 deg (side not stated: left [EST]), TDZ and centreline lights at the six ends of 07/25; 18 centreline and edge
// lights only; AD 2.19 ILS CAT III at all six ends of 07/25, none for 18/36, MAG VAR 4 deg E (2026). The magnetic
// bearings are AD 2.12's true less that 4 deg: the AIP gives none.
//   python3 tools/cpu-guard.py -- node --test tests/v070-eu-eddf.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const AIP = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1, tdz: true, papiDeg: 3, ils: 'III', approachLights: 'ALSF-II', displacedM: 0 };
  // 18/36: a one-way runway (take-off southward only): no approach lights, no PAPI, no TDZ, no ILS, centreline lights.
  const ONE_WAY = { pubMagTol: 1, displacedM: 0, tdz: false, papi: null, papiDeg: null, ils: null, approachLights: null, approachLightsM: 0 };
  airportSuite({
    icao: 'EDDF', patch: 'frankfurt', coast: false,
    shortName: 'Frankfurt', name: 'Frankfurt Airport',
    latLon: [50.026706, 8.55835], elevM: 110.9, pubVar: 4,
    runways: [
      // (18/36: OSM's way, its south end 1 m from OurAirports' 36 end, runs 3,969 m after the frame's scale: AD 2.13's
      // TORA for 18, 3,970 m, against AD 2.12's 4,000 m)
      { id: '18/36', lengthM: 3970, widthM: 45, source: "Germany's DFS AIP" },
      { id: '07R/25L', lengthM: 4000, widthM: 45, source: "Germany's DFS AIP" },
      { id: '07L/25R', lengthM: 2800, widthM: 45, source: "Germany's DFS AIP" },
      { id: '07C/25C', lengthM: 4000, widthM: 60, source: "Germany's DFS AIP" },
    ],
    ends: {
      '07C': { ...AIP, elevFt: 328.0, pubMag: 65.64, trueBrg: 69.64, thr: ['500157.421N', '0083204.667E'] },
      '25C': { ...AIP, elevFt: 362.5, pubMag: 245.64, trueBrg: 249.64, thr: ['500242.456N', '0083513.131E'] },
      '07L': { ...AIP, elevFt: 304.0, pubMag: 65.60, trueBrg: 69.60, thr: ['500213.396N', '0082949.481E'] },
      '25R': { ...AIP, elevFt: 351.4, pubMag: 245.60, trueBrg: 249.60, thr: ['500244.971N', '0083201.377E'] },
      '07R': { ...AIP, elevFt: 326.8, pubMag: 65.65, trueBrg: 69.65, thr: ['500139.151N', '0083203.025E'] },
      '25L': { ...AIP, elevFt: 360.5, pubMag: 245.65, trueBrg: 249.65, thr: ['500224.187N', '0083511.505E'] },
      '18': { ...ONE_WAY, thrSource: 'AIP', thrTolM: 15, elevFt: 325.3, pubMag: 175.63, trueBrg: 179.63, thr: ['500203.010N', '0083133.350E'] },
      // 36: no AD 2.12 row; OurAirports' end and elevation [EST]
      '36': { ...ONE_WAY, thrSource: 'OurAirports', thrTolM: 15, elevFt: 316.0, thr: [49.998493, 8.526297] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // Terminal 3's stands (G, H, J, K: south of 07R/25L) to 07C and 25R: OSM's taxiway across 07R/25L, 1,660 m from 07R,
    // runs within 20 deg of the runway for 34 m of the crossing; the rest of every route stays off the runways.
    alongRunway: { byEnd: { '07C': 40, '25R': 40 }, reason: "crossing 07R/25L 1,660 m from 07R, OSM's taxiway within 20 deg of the runway for 34 m" },
    // A landing on 25L slowed 30 % along it (1,200 m in): the exit just ahead leads north; the route to Terminal 3's
    // stands (south) turns back 226 m along the runway to the south exit behind. Logged, as OSM maps it.
    knownTaxiIn: { '25L@0.3': "the exit 113 m ahead leads north only; Terminal 3's stands are reached by the south exit 226 m behind" },
    stands: { min: 366, max: 366, refs: ['A26', 'A58A', 'B44', 'E5', 'Z50', 'V117', 'G5', 'J12', 'R1'], gates: 91,
      e787: { min: 190, max: 210, include: ['A58A', 'B44', 'E5'] }, e777: { min: 180, max: 200, include: ['A62A', 'B46', 'E9'] } },
    countries: ['DE'],
    routes: [['EGLL', 'EDDF', 353.1], ['LFPG', 'EDDF', 241.8]],
  });
}
