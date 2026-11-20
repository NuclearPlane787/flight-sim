// v0.6.3: Shenyang Taoxian (ZYTX), pending: the checks in tests/v063-ne-airport.mjs. China's AIP can't be read: the
// runway against OurAirports (public domain), the ILS and lights from open secondary sources (X-Plane 12's nav data
// on airports4xp.info, the X-Plane Scenery Gateway's scenery), the stands OSM's own numbers.
//   python3 tools/cpu-guard.py -- node --test tests/v063-zytx.test.mjs
import { airportSuite } from './v063-ne-airport.mjs';

airportSuite({
  icao: 'ZYTX', patch: 'shenyang', coast: false,
  shortName: 'Shenyang', name: 'Shenyang Taoxian International Airport',
  latLon: [41.6398, 123.4837], elevM: 60.4,
  runway: { id: '06/24', lengthM: 3200, widthM: 45, source: 'OurAirports, open secondary' },
  ends: {
    '06': { elevFt: 171, displacedM: 0, ils: 'I', approachLights: 'ALSF-I', tdz: false, papiDeg: 3, pubMag: null,
      thr: [41.630402, 123.469002], thrTolM: 60, thrSource: 'OurAirports' },
    '24': { elevFt: 197, displacedM: 0, ils: 'I', approachLights: 'ALSF-I', tdz: false, papiDeg: 3, pubMag: null,
      thr: [41.6493, 123.498001], thrTolM: 60, thrSource: 'OurAirports' },
  },
  stands: { min: 87, max: 87, refs: ['101', '110', '122', '140', 'A01', 'A04', 'Y06', 'Y21', 'Y34'], gates: 0,
    e787: { min: 1, max: 87 }, e777: { min: 1, max: 87 } },
  countries: ['CN'],
  routes: [['RKSI', 'ZYTX', 285.6], ['ZYTX', 'ZYTL', 183.6]],
});
