// v0.6.4: Wonsan Kalma (ZKWS), pending: the checks in tests/v063-ne-airport.mjs. North Korea publishes no AIP online and
// no open nav data lists the rebuilt field's ILS: the runways' lights from the X-Plane Scenery Gateway's scenery 93376
// (2022-12, open secondary), the ILS and approach lights at 15R and 33L the ICAO default [EST], 15L/33R unlit as the
// scenery draws it, every threshold at the field's 7 ft [EST]. The stands are the scenery's six gates.
//   python3 tools/cpu-guard.py -- node --test tests/v064-zkws.test.mjs
import { airportSuite } from './v063-ne-airport.mjs';

const UNLIT = { ils: null, approachLights: null, approachLightsM: 0, papi: null, papiDeg: null, tdz: false, centreline: false };
airportSuite({
  icao: 'ZKWS', patch: 'wonsan', coast: true,
  shortName: 'Wonsan', name: 'Wonsan Kalma International Airport',
  latLon: [39.1652, 127.4879], elevM: 2.1,
  runways: [
    { id: '15R/33L', lengthM: 3125, widthM: 50, source: 'OSM\'s length tag, the Scenery Gateway (open secondary)' },
    { id: '15L/33R', lengthM: 3500, widthM: 60, source: 'OurAirports' },
  ],
  // the idents are 6.8 deg off WMM2025's magnetic headings (156.8 / 336.8): kept as published
  identTolDeg: 7,
  ends: {
    '15R': { elevFt: 7, displacedM: 0, ils: 'I', approachLights: 'ALSF-I', tdz: false, papiDeg: 3,
      thr: [39.17609444, 127.47638056], thrTolM: 15, thrSource: 'Scenery Gateway' },
    // (33L is circling-only since v0.6.4's review of its final: createAirports() shows no ILS on such an end; the
    // baked file's [EST] 'I' there is unused.)
    '33L': { elevFt: 7, displacedM: 0, ils: null, approachLights: 'SSALF', approachLightsM: 420, tdz: false, papiDeg: 3,
      thr: [39.15243347, 127.49594279], thrTolM: 15, thrSource: 'Scenery Gateway' },
    '15L': { elevFt: 7, displacedM: 0, ...UNLIT, thr: [39.17853954, 127.47723276], thrTolM: 15, thrSource: 'Scenery Gateway' },
    '33R': { elevFt: 7, displacedM: 0, ...UNLIT, thr: [39.15204270, 127.49913907], thrTolM: 15, thrSource: 'Scenery Gateway' },
  },
  stands: { min: 6, max: 6, refs: ['1', '2', '3', '4', '5', '6'], gates: 2,
    e787: { min: 0, max: 0 }, e777: { min: 0, max: 0 } },
  // Logged, not hidden: the straight-in 3° finals to 33L and 33R pass over the mountains south-south-east of the bay
  // (the ridge above Anbyon), under 60 m from the ground about 11 nm out. A real approach there would be offset or steeper.
  lowFinals: { '33L': 'the ridge south-south-east of the bay, ~11.5 nm out', '33R': 'the ridge south-south-east of the bay, ~11.5 nm out' },
  // Logged, not hidden: OSM maps no link at either end of the new 15L/33R, only angled exits 684 m from the 15L end and
  // 63 m from the 33R end (that one turning back towards 15L): a landing on 15L rolled to 90 % backtracks ~700 m, and one on
  // 33R rolled to 90 % (350 m from the end) has no exit ahead at all.
  knownTaxiIn: { '15L@0.9': 'no end link at 33R in OSM: backtracks ~700 m', '33R@0.9': 'no exit ahead in OSM: no route' },
  countries: ['KP'],
  routes: [['RKSS', 'ZKWS', 101.9], ['ZKWS', 'UHWW', 329.6], ['ZKPY', 'ZKWS', 84.7]],
});
