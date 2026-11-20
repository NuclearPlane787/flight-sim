// v0.6.4: Niigata (RJSN), pending: the checks in tests/v063-ne-airport.mjs (two runways). Against AIP Japan (RJSN AD 2.8,
// 2.12 to 2.14 and 2.19): 10/28 2,500 x 45 m and 04/22 1,314 x 45 m, no displacements, the thresholds' coordinates
// (THR_AT in tools/bake_region_airports.py), elevations and true bearings; 10 SALS 420 m (the game's SSALF), no ILS;
// 28 PALS CAT I 660 m with TDZ lights and the ILS (beam 281.26 M); 04 no PAPI, no approach lights; 22 PAPI left 3.0;
// no centreline lights on 04/22. 04/22 crosses 10/28 near the 28 end. The stands OSM's, spots 1 to 10 numbered at the
// AIP's INS checkpoint positions (AD 2.20: a 747-8 parks only at spot 9).
//   python3 tools/cpu-guard.py -- node --test tests/v064-rjsn.test.mjs
import { airportSuite } from './v063-ne-airport.mjs';

const AIP = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1, displacedM: 0, pubMag: null };
airportSuite({
  icao: 'RJSN', patch: 'niigata', coast: true,
  shortName: 'Niigata', name: 'Niigata Airport',
  latLon: [37.954166, 139.112189], elevM: 8.8, pubVar: -9,
  runways: [
    { id: '10/28', lengthM: 2500, widthM: 45, source: 'AIP Japan' },
    { id: '04/22', lengthM: 1314, widthM: 45, source: 'AIP Japan' },
  ],
  ends: {
    '10': { ...AIP, elevFt: 27.1, ils: null, approachLights: 'SSALF', approachLightsM: 420, tdz: false, papiDeg: 3, trueBrg: 92.69, thr: ['375724.71N', '1390541.78E'] },
    '28': { ...AIP, elevFt: 10.1, ils: 'I', approachLights: 'ALSF-I', approachLightsM: 660, tdz: true, papiDeg: 3, pubMag: 281.26, trueBrg: 272.69, thr: ['375720.91N', '1390724.09E'] },
    '04': { ...AIP, elevFt: 22.7, ils: null, approachLights: null, approachLightsM: 0, tdz: false, centreline: false, papi: null, papiDeg: null, trueBrg: 31.91, thr: ['375653.73N', '1390652.82E'] },
    '22': { ...AIP, elevFt: 5.9, ils: null, approachLights: null, approachLightsM: 0, tdz: false, centreline: false, papiDeg: 3, trueBrg: 211.91, thr: ['375729.96N', '1390721.31E'] },
  },
  // OSM's 53 less the S apron's (AUW 11 t; STAND_EXCLUDE): spots 1 to 10 on the terminal's row, the rest R..
  stands: { min: 39, max: 39, refs: ['1', '2', '5', '8', '9', '10'], gates: 4,
    e787: { min: 1, max: 8, include: ['9'], only: ['3', '4', '5', '6', '7', '8', '9', '10'] }, e777: { min: 1, max: 8, include: ['9'], only: ['3', '4', '5', '6', '7', '8', '9', '10'] } },   // AIP_STANDS.RJSN [EST]
  // 04/22 has no parallel taxiway (AD 2.8: only A1, A3 and P4 join it): a departure from 04 backtracks along it (649 m).
  // KNOWN FAULT, not the real airport's: stand 10's routes start on 04/22 (its pushback snaps to the runway, 158 m from
  // C3), so they run 285 to 816 m along a runway; logged here until the taxi graph's join is looked at.
  alongRunway: { byEnd: { '04': 660 }, byStand: { 10: 850 }, reason: '04/22 has no parallel taxiway: a departure from 04 backtracks 649 m along it; stand 10\'s pushback snaps to 04/22, so its routes run 285 to 816 m along a runway (known fault)' },
  knownTaxiIn: Object.fromEntries([0.45, 0.6, 0.75, 0.9].map((f) => [`22@${f}`, '04/22 has no parallel taxiway: past its middle the way in is back along it'])),
  crossingProfile: true,   // 04/22 crosses 10/28 ~240 m in from 28: it takes 10/28's level there (runwayCrossings())
  fieldSurface: 'runways',   // FIELD_RUNWAYS in tools/bake_region_patches.py: its four ends lie on no one plane
  countries: ['JP'],
  routes: [['RKSS', 'RJSN', 584.9], ['RJSN', 'UHWW', 455.0], ['RJSS', 'RJSN', 86.1]],
});
