// v0.6.4: Pyongyang Sunan (ZKPY), pending: the checks in tests/v063-ne-airport.mjs. North Korea publishes no AIP
// online: the runway, lights and ILS from open secondary sources (X-Plane 12's nav data; the X-Plane Scenery Gateway's
// scenery 112628, 2026-10), the thresholds' elevations from OurAirports. 01/19, which OSM still draws, is left out
// (RUNWAY_SKIP in tools/bake_region_airports.py: OurAirports closed, unlit and without an ILS in the open sources).
//   python3 tools/cpu-guard.py -- node --test tests/v064-zkpy.test.mjs
import { airportSuite } from './v063-ne-airport.mjs';

const E = ['21', '22', '23', '24', '25', '33', '35', '36', '37'];   // AIP_STANDS.ZKPY in src/ground/taxi.js [EST]

airportSuite({
  icao: 'ZKPY', patch: 'pyongyang', coast: false,
  shortName: 'Pyongyang', name: 'Pyongyang Sunan International Airport',
  latLon: [39.2241, 125.67], elevM: 35.7,
  runway: { id: '17/35', lengthM: 3440, widthM: 60, source: 'X-Plane 12 nav data and the Scenery Gateway (open secondary)' },
  ends: {
    '17': { elevFt: 96, displacedM: 0, ils: 'I', approachLights: 'ALSF-I', papi: 'right', tdz: false, papiDeg: 3,
      thr: [39.22042153, 125.66435683], thrTolM: 15, thrSource: 'Scenery Gateway' },
    '35': { elevFt: 86, displacedM: 0, ils: 'I', approachLights: 'SSALF', approachLightsM: 420, tdz: false, papiDeg: 3,
      thr: [39.19086089, 125.67608620], thrTolM: 15, thrSource: 'Scenery Gateway' },
  },
  stands: { min: 24, max: 24, refs: ['1', '2', '3', '4', '5', '11', '17', '21', '25', '31', '37'], gates: 4,
    e787: { min: 1, max: 9, only: E }, e777: { min: 1, max: 9, only: E } },
  // The west apron (31 to 37) is across the runway from the terminal, and OSM's K and D meet the runway ~90 m apart:
  // every route from there crosses with a ~93 m stagger along the runway.
  alongRunway: { m: 100, reason: 'the west apron\'s staggered crossing, K to D (OSM)' },
  countries: ['KP'],
  routes: [['RKSI', 'ZKPY', 111.6], ['RKSS', 'ZKPY', 113.1], ['ZKPY', 'ZYTX', 176.1], ['ZKPY', 'ZBAA', 422.4]],
});
