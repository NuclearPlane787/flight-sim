// v0.7.5: Kunsan (RKJK), pending: the checks in tests/v063-ne-airport.mjs (one runway). Against Korea's eAIP (KR-AD-2.RKJK,
// the 2026-11-12 package: AD 2.12 to 2.14 and 2.19): 18/36 9,008 x 150 ft (2,746 x 45 m), no displacements, the
// thresholds' coordinates (THR_AT in tools/bake_region_airports.py), elevations (5.3 and 8.2 m) and true bearings; ALSF-I
// at both ends (900 m [EST]: the length isn't stated), PAPI left 3 deg, no TDZ, no centreline lights; an ILS to both ends
// (category not stated: I [EST]). A USAF and ROKAF base: the stands only the civil ramp's two, placed by the bake
// (STAND_POINTS [EST]: OSM maps no stand there), code C (AIP_STANDS.RKJK); a 10 m coast patch (the Yellow Sea).
//   python3 tools/cpu-guard.py -- env FS_PENDING=1 node --test tests/v075-ea-rkjk.test.mjs
import { airportSuite } from './v063-ne-airport.mjs';

const AIP = { thrSource: "Korea's eAIP", thrTolM: 15, displacedM: 0, ils: 'I', approachLights: 'ALSF-I', approachLightsM: 900, tdz: false, centreline: false, papiDeg: 3, pubMag: null };
airportSuite({
  icao: 'RKJK', patch: 'kunsan', coast: true,
  koreaPlane: true,   // inside south-korea.poly: the game's variation is frame.js's plane, as Gimhae's (the lead, at the promotion)
  shortName: 'Kunsan', name: 'Gunsan Airport (Kunsan Air Base)',
  latLon: [35.903801, 126.615997], elevM: 8.8, pubVar: -8,
  runway: { id: '18/36', lengthM: 2746, widthM: 45, source: "Korea's eAIP" },
  ends: {
    // (AD 2.19's LOC inbound headings, 176 and 356, carry an older variation than WMM2025's 8.5 W: not asserted)
    '18': { ...AIP, elevFt: 17.39, trueBrg: 169.04, thr: ['355457.29N', '1263646.82E'] },
    '36': { ...AIP, elevFt: 26.90, trueBrg: 349.05, thr: ['355329.83N', '1263707.63E'] },
  },
  stands: { min: 2, max: 2, refs: ['1', '2'], gates: 0, e787: { min: 0, max: 0 }, e777: { min: 0, max: 0 } },
  countries: ['KR'],
  routes: [['RKPC', 'RKJK', 143.7], ['RKJK', 'RKSI', 94.3], ['RKTU', 'RKJK', 64.9]],
});
