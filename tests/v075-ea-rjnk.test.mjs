// v0.7.5: Komatsu (RJNK), pending: the checks in tests/v063-ne-airport.mjs (one runway). Against AIP Japan (RJNK AD 2.8,
// 2.12 to 2.14 and 2.19): 06/24 2,700 x 45 m, no displacements, the thresholds' coordinates (THR_AT in
// tools/bake_region_airports.py) and elevations; 06 PALS CAT I 839 m with the ILS (beam 063 M), 24 PALS CAT I 597 m and
// no ILS (an RNP approach); PAPI left 3.0 and centreline lights at both, no TDZ lights. A joint field with the JASDF:
// the stands are the civil spots 2 to 8 at the AIP's INS checkpoint positions, none on the military side (Shane's
// "Empty"); code E at the bridge spots 5 to 8 (AIP_STANDS.RJNK [EST]).
//   FS_PENDING=1 python3 tools/cpu-guard.py -- node --test tests/v075-ea-rjnk.test.mjs
import { airportSuite } from './v063-ne-airport.mjs';

// (pubMagTol 1.5: AD 2.19's 063 M is the true 055 less AD 2.2's MAG VAR 8 W of 2006; WMM2025 gives 8.57 W now, so the
// game's 064.0 M. AD 2.12's true bearings are rounded to the degree (055 / 235), so trueBrg isn't checked: the
// thresholds' coordinates are, within 15 m.)
const AIP = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1.5, displacedM: 0, pubMag: null };
airportSuite({
  icao: 'RJNK', patch: 'komatsu', coast: true,
  shortName: 'Komatsu', name: 'Komatsu Airport',
  latLon: [36.393407, 136.406895], elevM: 11.0, pubVar: -8,
  runways: [{ id: '06/24', lengthM: 2700, widthM: 45, source: 'AIP Japan' }],
  ends: {
    '06': { ...AIP, elevFt: 38.1, ils: 'I', approachLights: 'ALSF-I', approachLightsM: 839, tdz: false, papiDeg: 3, pubMag: 63, thr: ['362312.93N', '1362342.53E'] },
    '24': { ...AIP, elevFt: 18.4, ils: null, approachLights: 'ALSF-I', approachLightsM: 597, tdz: false, papiDeg: 3, thr: ['362403.07N', '1362511.48E'] },
  },
  // AD 2.8's spots 2 to 8 (STAND_POINTS), the four with jet bridges (gate nodes in OSM) 5 to 8
  stands: { min: 7, max: 7, refs: ['2', '3', '4', '5', '6', '7', '8'], gates: 4,
    e787: { min: 1, max: 4, only: ['5', '6', '7', '8'] }, e777: { min: 1, max: 4, only: ['5', '6', '7', '8'] } },   // AIP_STANDS.RJNK [EST]
  countries: ['JP'],
  routes: [['RJNK', 'RJBB', 131.0], ['RJNK', 'RJTT', 171.9], ['RJSN', 'RJNK', 159.8]],
});
