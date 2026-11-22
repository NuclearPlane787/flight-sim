// v0.7.5: Hiroshima (RJOA), pending: the checks in tests/v063-ne-airport.mjs (one runway, on its plateau ~330 m up).
// Against AIP Japan (RJOA AD 2.8, 2.12 to 2.14 and 2.19): 10/28 3,000 x 60 m, no displacements, the thresholds'
// coordinates (THR_AT in tools/bake_region_airports.py), elevations and true bearings (090 / 270); 10 PALS CAT III 900 m
// (the game's ALSF-II) with TDZ lights and the ILS CAT III (beam 097.93 M); 28 SALS 420 m (SSALF), no ILS; PAPI left
// 3.0 and centreline lights at both. OSM maps no stand: spots 1 to 10 (no 4) at the AIP's INS checkpoint positions.
//   FS_PENDING=1 python3 tools/cpu-guard.py -- node --test tests/v075-ea-rjoa.test.mjs
import { airportSuite } from './v063-ne-airport.mjs';

const AIP = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1, displacedM: 0, pubMag: null };
airportSuite({
  icao: 'RJOA', patch: 'hiroshima', coast: false,   // (its 16 km square is all land: seaFraction 0)
  shortName: 'Hiroshima', name: 'Hiroshima Airport',
  latLon: [34.4361, 132.919006], elevM: 331.6, pubVar: -8,
  runways: [{ id: '10/28', lengthM: 3000, widthM: 60, source: 'AIP Japan' }],
  ends: {
    '10': { ...AIP, elevFt: 1071.7, ils: 'III', approachLights: 'ALSF-II', approachLightsM: 900, tdz: true, papiDeg: 3, pubMag: 97.93, trueBrg: 90.0, thr: ['342609.69N', '1325411.25E'] },
    '28': { ...AIP, elevFt: 1067.2, ils: null, approachLights: 'SSALF', approachLightsM: 420, tdz: false, papiDeg: 3, trueBrg: 270.0, thr: ['342609.69N', '1325608.75E'] },
  },
  // AD 2.8's spots 1 to 10 (no 4; STAND_POINTS), seven by OSM's jet bridges
  stands: { min: 9, max: 9, refs: ['1', '2', '3', '5', '6', '7', '8', '9', '10'], gates: 7,
    e787: { min: 1, max: 7, only: ['1', '2', '3', '5', '6', '7', '8'] }, e777: { min: 1, max: 7, only: ['1', '2', '3', '5', '6', '7', '8'] } },   // AIP_STANDS.RJOA [EST]
  countries: ['JP'],
  routes: [['RJOA', 'RJTT', 344.3], ['RJBB', 'RJOA', 115.1], ['RJFF', 'RJOA', 133.0]],
});
