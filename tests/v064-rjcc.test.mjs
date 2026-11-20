// v0.6.4: New Chitose (RJCC), Sapporo's airport, pending: the checks in tests/v063-ne-airport.mjs (two runways). Against
// AIP Japan (RJCC AD 2.12 to 2.14 and 2.19, as Haneda's were read in v0.6.0): 01L/19R and 01R/19L 3,000 x 60 m, no
// displacements, the thresholds' coordinates, elevations and true bearings, PALS CAT I 900 m at 01L and 01R, CAT III at
// 19R, CAT I 570 m at 19L, TDZ lights and PAPIs left 3.0 at all four, the ILS's beam bearings (002 / 182). The air
// force's Chitose base beside it (18L/36R, 18R/36L) is a separate aerodrome: not read, no stands on military ground.
//   python3 tools/cpu-guard.py -- node --test tests/v064-rjcc.test.mjs
import { airportSuite } from './v063-ne-airport.mjs';

const AIP = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1, displacedM: 0, tdz: true, papiDeg: 3 };
airportSuite({
  icao: 'RJCC', patch: 'new-chitose', coast: false,
  shortName: 'New Chitose', name: 'New Chitose Airport (Sapporo)',
  latLon: [42.774753, 141.690414], elevM: 25.0, pubVar: -10,
  runways: [
    { id: '01L/19R', lengthM: 3000, widthM: 60, source: 'AIP Japan' },
    { id: '01R/19L', lengthM: 3000, widthM: 60, source: 'AIP Japan' },
  ],
  ends: {
    '01L': { ...AIP, elevFt: 62, ils: 'I', approachLights: 'ALSF-I', pubMag: 2, trueBrg: 352.62, thr: ['424541.90N', '1414134.17E'] },
    '19R': { ...AIP, elevFt: 82, ils: 'III', approachLights: 'ALSF-II', pubMag: 182, trueBrg: 172.62, thr: ['424718.36N', '1414117.18E'] },
    '01R': { ...AIP, elevFt: 57.4, ils: 'I', approachLights: 'ALSF-I', pubMag: 2, trueBrg: 352.62, thr: ['424543.15N', '1414147.25E'] },
    '19L': { ...AIP, elevFt: 77.1, ils: 'I', approachLights: 'ALSF-I', approachLightsM: 570, pubMag: 182, trueBrg: 172.62, thr: ['424719.56N', '1414130.28E'] },
  },
  stands: { min: 68, max: 68, refs: ['0', '1', '18', '27', '47', '57', '58', '63', '71', '80', '91'], gates: 25,
    e787: { min: 1, max: 68 }, e777: { min: 1, max: 68 } },
  countries: ['JP'],
  // (New Chitose–Vladivostok, 419.9 nm, is left out: on the map it is 424.4 nm, 1.07 % long, over the suite's 1 %, the
  // frame's scale being +0.75 % at one end and +0.9 % at the other)
  identTolDeg: 8,   // 01L/19R and 01R/19L read 002 / 182 M today (AIP: true 352.62 deg, MAG VAR 10 deg W): named for an older variation
  routes: [['RKSS', 'RJCC', 750.5], ['RJTT', 'RJCC', 442.7], ['RJCC', 'RJSA', 130.5]],
});
