// v0.7.5: Osaka Itami (RJOO), pending: the checks in tests/v063-ne-airport.mjs (two parallel runways). Against AIP Japan
// (RJOO AD 2.8, 2.12 to 2.14, 2.19 and 2.20): 14R/32L 3,000 x 60 m and 14L/32R 1,828 x 45 m, no displacements, the
// thresholds' coordinates (THR_AT in tools/bake_region_airports.py), elevations and true bearings (135 / 315); 32L PALS
// CAT I 450 m with TDZ lights and the one ILS (beam 322 M); 14R and 14L "AGL" 422 and 597 m and 32R SALS 600 m (drawn as
// the game's SSALF); centreline lights and PAPI 3.0 left at all four. The two runways don't cross. The stands at the AIP's
// INS checkpoint positions (AD 2.8; STAND_POINTS).
//   FS_PENDING=1 python3 tools/cpu-guard.py -- node --test tests/v075-ea-rjoo.test.mjs
import { airportSuite } from './v063-ne-airport.mjs';

const AIP = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1.5, displacedM: 0, pubMag: null };
airportSuite({
  icao: 'RJOO', patch: 'itami', coast: true,
  shortName: 'Itami', name: 'Osaka International Airport',
  latLon: [34.780853, 135.440829], elevM: 15.2, pubVar: -8,
  runways: [
    { id: '14R/32L', lengthM: 3000, widthM: 60, source: 'AIP Japan' },
    { id: '14L/32R', lengthM: 1828, widthM: 45, source: 'AIP Japan' },
  ],
  ends: {
    '14R': { ...AIP, elevFt: 46, ils: null, approachLights: 'SSALF', approachLightsM: 422, tdz: false, papiDeg: 3, trueBrg: 135, thr: ['344728.77N', '1352543.34E'] },
    '32L': { ...AIP, elevFt: 31.2, ils: 'I', approachLights: 'ALSF-I', approachLightsM: 450, tdz: true, papiDeg: 3, pubMag: 322, trueBrg: 315, thr: ['344619.92N', '1352706.76E'] },
    '14L': { ...AIP, elevFt: 50, ils: null, approachLights: 'SSALF', approachLightsM: 597, tdz: false, papiDeg: 3, trueBrg: 135, thr: ['344742.97N', '1352543.27E'] },
    '32R': { ...AIP, elevFt: 34, ils: null, approachLights: 'SSALF', approachLightsM: 600, tdz: false, papiDeg: 3, trueBrg: 315, thr: ['344701.02N', '1352634.11E'] },
  },
  // AD 2.8's 60 INS checkpoints less the letter variants (1A, 1B, 2A, 3A, 3B, 4A, 4B, 45W) and spot 0 (32 m from spot 1)
  stands: { min: 51, max: 51, refs: ['1', '10', '18', '27', '41', '53', '70', '84'], gates: 19,
    e787: { min: 1, max: 10, include: [], only: ['7', '8', '9', '10', '11', '12', '13', '14', '16', '18'] }, e777: { min: 1, max: 10, include: [], only: ['7', '8', '9', '10', '11', '12', '13', '14', '16', '18'] } },   // (the code review: pinned to AIP_STANDS.RJOO's ten)
  // Every route from the terminal to 14R crosses 14L/32R on W10 at a slant by its 14L end, about 20 m on it.
  alongRunway: { byEnd: { '14R': 25 }, reason: 'every route to 14R crosses 14L/32R at a slant on W10 by its 14L end, about 20 m on it' },
  // OSM's C7 meets 14L/32R's line ~70 m past the AIP's 14L threshold, where OSM's way runs on over the overrun (2,220 m
  // drawn against the published 1,828 m; THR_AT puts the end at the AIP's): beyond the pavement, so no exit ahead there.
  knownTaxiIn: { '32R@0.9': 'past 90 % of 32R the only way off is C7, which OSM joins ~70 m beyond the AIP\'s 14L threshold (the pavement\'s end): back along the runway to C6' },
  // AIP Japan RJOO AD 2.22 and 2.20 1.5: runway 14 is landed on by a circling approach (the one ILS is to 32L); AD 2.14:
  // 14L's and 14R's PAPIs are usable only within ~2.4 and 2.6 nm "due to obstruction (mountain)". The straight 3 deg
  // final from 15 nm meets the Hokusetsu hills (CIRCLING_ONLY.RJOO in src/world/runways.js, the lead's table).
  circlingFinals: {
    '14R': 'AD 2.20 1.5 "For circling approach to Runway 14"; its 3 deg line passes ~33 m over the hills 4.7 nm out',
    '14L': 'as 14R, a circling approach only; its 3 deg line passes ~47 m over the same hills 4.3 nm out',
  },
  fieldSurface: 'runways',   // FIELD_RUNWAYS in tools/bake_region_patches.py
  countries: ['JP'],
  routes: [['RJOO', 'RJBB', 23.4], ['RJOO', 'RJTT', 218.2], ['RJOO', 'RJFF', 258.0], ['RJGG', 'RJOO', 67.4]],
});
