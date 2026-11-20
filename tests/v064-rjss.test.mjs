// v0.6.4: Sendai (RJSS), pending: the checks in tests/v063-ne-airport.mjs (two runways). Against AIP Japan (RJSS AD 2.8,
// 2.12 to 2.14 and 2.19, as Haneda's were read in v0.6.0): 09/27 3,000 x 45 m and 12/30 1,200 x 45 m, no displacements,
// the thresholds' coordinates (THR_AT in tools/bake_region_airports.py), elevations and true bearings; 09 SALS 420 m (the
// game's SSALF), no ILS; 27 PALS CAT I 900 m with TDZ lights and the ILS (beam 270 M); 12 and 30 no approach lights and
// no centreline lights, PAPIs 3.0 and 3.1 (the side not published: left [EST]). 12/30 doesn't cross 09/27 (12's threshold
// ~105 m south of its centreline). The stands OSM's, spots 1 to 14 numbered at the AIP's INS checkpoint positions.
//   python3 tools/cpu-guard.py -- node --test tests/v064-rjss.test.mjs
import { airportSuite } from './v063-ne-airport.mjs';

const AIP = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1.5, displacedM: 0, pubMag: null };
airportSuite({
  icao: 'RJSS', patch: 'sendai', coast: true,
  shortName: 'Sendai', name: 'Sendai Airport',
  latLon: [38.139702, 140.917007], elevM: 4.6, pubVar: -9,
  runways: [
    { id: '09/27', lengthM: 3000, widthM: 45, source: 'AIP Japan' },
    { id: '12/30', lengthM: 1200, widthM: 45, source: 'AIP Japan' },
  ],
  ends: {
    '09': { ...AIP, elevFt: 11.5, ils: null, approachLights: 'SSALF', approachLightsM: 420, tdz: false, papiDeg: 3, trueBrg: 82.56, thr: ['380819.58N', '1405355.40E'] },
    '27': { ...AIP, elevFt: 15.1, ils: 'I', approachLights: 'ALSF-I', tdz: true, papiDeg: 3, pubMag: 270, trueBrg: 262.56, thr: ['380832.18N', '1405557.56E'] },
    '12': { ...AIP, elevFt: 6, ils: null, approachLights: null, approachLightsM: 0, tdz: false, centreline: false, papiDeg: 3, trueBrg: 117.70, thr: ['380822.05N', '1405453.09E'] },
    '30': { ...AIP, elevFt: 5, ils: null, approachLights: null, approachLightsM: 0, tdz: false, centreline: false, papiDeg: 3.1, trueBrg: 297.70, thr: ['380803.96N', '1405536.72E'] },
  },
  // OSM's 83 less the light aircraft's south and run-up aprons (STAND_EXCLUDE): spots 1 to 14 on the terminal's row, the rest R..
  stands: { min: 28, max: 28, refs: ['1', '2', '5', '9', '10', '11', '14'], gates: 10,
    e787: { min: 1, max: 28, include: ['5'] }, e777: { min: 1, max: 28, include: ['5'] } },
  alongRunway: { m: 25, reason: 'every route to 09 crosses 12/30 at a slant by its 12 end, about 20 m on it' },
  farHolds: { '30': { m: 720, reason: 'from the terminal side 30 is reached only from D1\'s hold, 696 m in: OSM\'s A3 and A4 on the south side meet D1 only across 12/30' } },
  knownTaxiIn: Object.fromEntries([0.6, 0.75, 0.9].map((f) => [`12@${f}`, '12/30\'s exits past 60 % lead only to the light aircraft\'s south aprons, joined to the terminal across 12/30 itself'])),
  fieldSurface: 'runways',   // FIELD_RUNWAYS in tools/bake_region_patches.py: its four ends lie on no one plane
  countries: ['JP'],
  identTolDeg: 7,   // 12/30 reads 126 / 306 M today (AIP: true 117.70, MAG VAR 9 deg W): named for an older variation
  routes: [['RJTT', 'RJSS', 164.7], ['RJSS', 'RJCC', 280.5], ['RJSS', 'RJSN', 86.1]],
});
