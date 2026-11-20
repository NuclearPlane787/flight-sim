// v0.6.3: Dalian Zhoushuizi (ZYTL), pending: the checks in tests/v063-ne-airport.mjs. China's AIP can't be read: the
// runway against OurAirports (public domain), its displacements OSM's (200 m at 10, 300 m at 28; the X-Plane Scenery
// Gateway's scenery the same), the ILS and lights from open secondary sources (X-Plane 12's nav data on
// airports4xp.info: 10's glide path 3.3 deg; the Gateway's scenery), the stands OSM's (gate numbers where it has them).
//   python3 tools/cpu-guard.py -- node --test tests/v063-zytl.test.mjs
import { airportSuite } from './v063-ne-airport.mjs';

airportSuite({
  icao: 'ZYTL', patch: 'dalian', coast: true,
  shortName: 'Dalian', name: 'Dalian Zhoushuizi International Airport',
  latLon: [38.9657, 121.5385], elevM: 32.6,
  runway: { id: '10/28', lengthM: 3300, widthM: 45, source: 'OurAirports, OSM, open secondary' },
  ends: {
    '10': { elevFt: 105, displacedM: 200, ils: 'I', approachLights: 'ALSF-I', tdz: false, papiDeg: 3.3, pubMag: null,
      thr: [38.967098, 121.52], thrTolM: 260, thrSource: 'OurAirports' },
    '28': { elevFt: 85, displacedM: 300, ils: 'I', approachLights: 'ALSF-I', tdz: false, papiDeg: 3, pubMag: null,
      thr: [38.964199, 121.558], thrTolM: 360, thrSource: 'OurAirports' },
  },
  stands: { min: 46, max: 46, refs: ['11', '16', '20', '26', '145', '147'], gates: 21,
    e787: { min: 1, max: 46 }, e777: { min: 1, max: 46 } },
  countries: ['CN'],
  routes: [['RKSI', 'ZYTL', 248.5]],
});
