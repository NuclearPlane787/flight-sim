// v0.6.3: Vladivostok (UHWW), pending: the checks in tests/v063-ne-airport.mjs with AIP Russia's published values
// (AD 2.1 UHWW, AIRAC AMDT 11/24: AD 2.12 to 2.14, 2.19; the stands' list for the widebodies from the parking chart).
// The stands are the X-Plane Scenery Gateway's (open secondary), numbered as the AIP's chart.
//   python3 tools/cpu-guard.py -- node --test tests/v063-uhww.test.mjs
import { airportSuite } from './v063-ne-airport.mjs';

const E = ['1A', '4', '5A', '6A', '10', '11'];   // AIP Russia UHWW-40.1, the B777-300ER's stands that the game has
airportSuite({
  icao: 'UHWW', patch: 'vladivostok', coast: true,
  shortName: 'Vladivostok', name: 'Vladivostok International Airport',
  latLon: [43.396, 132.148], elevM: 18.0, pubVar: -11,
  runway: { id: '07R/25L', lengthM: 3502, widthM: 60, source: 'AIP Russia' },
  ends: {
    '07R': { elevFt: 32, displacedM: 0, ils: 'I', approachLights: 'ALSF-I', tdz: false, papiDeg: 3, pubMag: 72, pubMagTol: 1,
      trueBrg: 61.0128, thr: ['432321.37N', '1320750.32E'], thrTolM: 30, thrSource: 'AIP' },
    '25L': { elevFt: 44, displacedM: 0, ils: 'II', approachLights: 'ALSF-II', tdz: true, papiDeg: 3, pubMag: 252, pubMagTol: 1,
      trueBrg: 241.0389, thr: ['432416.34N', '1321006.48E'], thrTolM: 30, thrSource: 'AIP' },
  },
  stands: { min: 23, max: 23, refs: ['1A', '2', '3', '4', '5A', '6A', '11', '12', '23'], gates: 4,
    e787: { min: 1, max: 6, include: ['1A'], only: E }, e777: { min: 1, max: 6, include: ['1A'], only: E } },
  countries: ['RU'],
  routes: [['RKSS', 'UHWW', 427.2], ['ZYTX', 'UHWW', 397.5]],
});
