// v0.7.5: Cheongju (RKTU), pending: the checks in tests/v063-ne-airport.mjs (two parallel runways). Against Korea's eAIP
// (KR-AD-2.RKTU, the 2026-11-12 package: AD 2.12 to 2.14 and 2.19): 06L/24R 2,744 x 60 m and 06R/24L 2,744 x 45 m, no
// displacements, the thresholds' coordinates (THR_AT in tools/bake_region_airports.py), elevations and true bearings;
// 06L SSALR 717 m and 06R SALS 291 m (the game's SSALF), 24R and 24L ALSF-I 900 m, TDZ lights at 24L only, PAPI on both
// sides at all four, centreline lights on 06R/24L only; an ILS to every end (category not stated: I [EST]). The stands
// OSM's, 1 to 13 at the terminal (71 to 78, a light aircraft's spacing, left out); the ROKAF's side has none.
//   python3 tools/cpu-guard.py -- env FS_PENDING=1 node --test tests/v075-ea-rktu.test.mjs
import { airportSuite } from './v063-ne-airport.mjs';

const AIP = { thrSource: "Korea's eAIP", thrTolM: 15, pubMagTol: 1, displacedM: 0, ils: 'I', papi: 'both', papiDeg: 3 };
airportSuite({
  icao: 'RKTU', patch: 'cheongju', coast: false,
  koreaPlane: true,   // inside south-korea.poly: the game's variation is frame.js's plane, as Gimhae's (the lead, at the promotion)
  shortName: 'Cheongju', name: 'Cheongju International Airport',
  latLon: [36.71556, 127.500289], elevM: 58.2, pubVar: -9,
  runways: [
    { id: '06R/24L', lengthM: 2744, widthM: 45, source: "Korea's eAIP" },
    { id: '06L/24R', lengthM: 2744, widthM: 60, source: "Korea's eAIP" },
  ],
  ends: {
    // (pubMag: AD 2.12's true bearing less the AIP's 9 deg W of 2025)
    '06L': { ...AIP, elevFt: 166.0, approachLights: 'SSALF', approachLightsM: 717, tdz: false, centreline: false, pubMag: 61.42, trueBrg: 52.42, thr: ['364236.10N', '1272912.46E'] },
    '24R': { ...AIP, elevFt: 185.4, approachLights: 'ALSF-I', approachLightsM: 900, tdz: false, centreline: false, pubMag: 241.43, trueBrg: 232.43, thr: ['364330.38N', '1273040.05E'] },
    '06R': { ...AIP, elevFt: 171.27, approachLights: 'SSALF', approachLightsM: 291, tdz: false, pubMag: 61.43, trueBrg: 52.43, thr: ['364228.26N', '1272914.84E'] },
    '24L': { ...AIP, elevFt: 191.46, approachLights: 'ALSF-I', approachLightsM: 900, tdz: true, pubMag: 241.43, trueBrg: 232.43, thr: ['364322.53N', '1273042.46E'] },
  },
  // OSM's 25 less 71 to 78 (STAND_EXCLUDE): 1 to 13 with the MARS halves 6L/6R and 7L/7R
  stands: { min: 17, max: 17, refs: ['1', '6L', '6R', '7', '7R', '13'], gates: 11,
    // AIP_STANDS.RKTU: code E at 7 and 13 only. The geometry's check then keeps 7 for the 777 alone (its pushback ends off
    // the graph for the 787) and 13 for neither (no taxi line 62 to 250 m behind it): logged, not hidden.
    e787: { min: 0, max: 0 }, e777: { min: 1, max: 1, include: ['7'], only: ['7', '13'] } },
  // 06R/24L is the ROKAF's runway (AD 2.20 1.3: airliners use 06L/24R). Landed on it, from these points the way in turns
  // back along it to C2/C3, where OSM's links cross 06L/24R to the civil side (OSM's B2 meets 06L/24R some 180 m from where B3 leaves it).
  knownTaxiIn: Object.fromEntries(['06R@0.45', '06R@0.6', '24L@0.3'].map((k) => [k, "06R/24L, the ROKAF's runway: the way in turns back along it to C2/C3 (OSM's B2 and B3 meet 06L/24R apart)"])),
  countries: ['KR'],
  routes: [['RKPC', 'RKTU', 198.6], ['RKTU', 'RKSS', 60.9], ['RKTU', 'RJTT', 599.5]],
});
