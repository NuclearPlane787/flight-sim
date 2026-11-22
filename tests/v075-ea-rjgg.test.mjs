// v0.7.5: Nagoya Chubu Centrair (RJGG), pending: the checks in tests/v063-ne-airport.mjs (one runway). Against AIP Japan
// (RJGG AD 2.8, 2.12 to 2.14 and 2.19, as Sendai's were read in v0.6.4): 18/36 3,500 x 60 m, the one runway the AIP has
// in use (the replacement runway being built isn't in it), no displacements, the thresholds' coordinates (THR_AT in
// tools/bake_region_airports.py), elevations (15 ft both) and true bearings (AD 2.12 prints 169.00 / 349.00; its two THR coordinates
// give 168.84 / 348.84, the figure checked); PALS 900 m with TDZ lights,
// centreline lights and PAPI 3.0 left at both ends; ILS CAT II to 18 (beam 177 M) and CAT III to 36 (357 M). The stands
// at the AIP's INS checkpoint positions (AD 2.8: Terminal 1's 1 to 25, Terminal 2's 71 to 80, the remote and cargo rows;
// STAND_POINTS); AD 2.20 parks an A380 only at 15, 20, 117, 118 and 119 (AIP_STANDS.RJGG in src/ground/taxi.js).
//   FS_PENDING=1 python3 tools/cpu-guard.py -- node --test tests/v075-ea-rjgg.test.mjs
import { airportSuite } from './v063-ne-airport.mjs';

const AIP = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1, displacedM: 0, pubMag: null };
airportSuite({
  icao: 'RJGG', patch: 'centrair', coast: true,
  shortName: 'Centrair', name: 'Chubu Centrair International Airport',
  latLon: [34.858398, 136.804993], elevM: 4.6, pubVar: -7.35,   // AD 2.2: 7 deg W (2021), annual change 4.2' W: 7.35 W in 2026
  runway: { id: '18/36', lengthM: 3500, widthM: 60, source: 'AIP Japan' },
  ends: {
    '18': { ...AIP, elevFt: 15, ils: 'II', approachLights: 'ALSF-II', tdz: true, papiDeg: 3, pubMag: 177, trueBrg: 168.84, thr: ['345226.01N', '1364806.03E'] },
    '36': { ...AIP, elevFt: 15, ils: 'III', approachLights: 'ALSF-II', tdz: true, papiDeg: 3, pubMag: 357, trueBrg: 348.84, thr: ['345034.59N', '1364832.81E'] },
  },
  // AD 2.8's 99 INS checkpoints less the letter variants (72A, 74A, 400D-F, 500A-F), the small aircraft's N1-N6 and 601W/E
  stands: { min: 80, max: 80, refs: ['1', '15', '20', '25', '71', '80', '101', '119', '201', '306', '408', '508'], gates: 31,
    e787: { min: 1, max: 80, include: ['15', '20'] }, e777: { min: 1, max: 80, include: ['15', '20'] } },
  fieldSurface: 'runways',   // FIELD_RUNWAYS in tools/bake_region_patches.py: one runway's two ends make no plane
  countries: ['JP'],
  routes: [['RJGG', 'RJTT', 152.1], ['RJGG', 'RJBB', 81.3], ['RJGG', 'RJOO', 67.4]],
});
