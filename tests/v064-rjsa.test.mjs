// v0.6.4: Aomori (RJSA), pending: the checks in tests/v063-ne-airport.mjs. Against AIP Japan (RJSA AD 2.8, 2.12 to 2.14
// and 2.19): 06/24 3,000 x 60 m on the plateau (thresholds 647 and 664 ft), no displacements; 06 SALS 420 m (the game's
// SSALF), no TDZ, no ILS; 24 PALS CAT III 900 m with TDZ and the ILS (beam 240.93 M); PAPIs left 3.0. Its six stands at
// the AIP's published spot positions; code D at most (AD 2.20's pushback rules stop at the B767-300): no 787 or 777.
//   python3 tools/cpu-guard.py -- node --test tests/v064-rjsa.test.mjs
import { airportSuite } from './v063-ne-airport.mjs';

const AIP = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1, displacedM: 0, papiDeg: 3 };
airportSuite({
  icao: 'RJSA', patch: 'aomori', coast: false,
  shortName: 'Aomori', name: 'Aomori Airport',
  latLon: [40.733777, 140.689477], elevM: 202.4, pubVar: -9,
  runway: { id: '06/24', lengthM: 3000, widthM: 60, source: 'AIP Japan' },
  ends: {
    // OSM's runway lies 60 m north-east of the AIP's along its axis (06's end 68 m in from the AIP threshold, 24's 58 m
    // past it, 0.6 m across), while its apron and taxiways fit the AIP's published stand positions: OSM's kept, the
    // offset logged (thrTolM 75), not hidden
    '06': { ...AIP, thrTolM: 75, elevFt: 647, ils: null, approachLights: 'SSALF', approachLightsM: 420, tdz: false, pubMag: 60.91, trueBrg: 51.91, thr: ['404329.77N', '1404028.61E'] },
    '24': { ...AIP, thrTolM: 75, elevFt: 664, ils: 'III', approachLights: 'ALSF-II', tdz: true, pubMag: 240.93, trueBrg: 231.91, thr: ['404429.79N', '1404209.27E'] },
  },
  stands: { min: 6, max: 6, refs: ['1', '2', '3', '4', '5', '6'], gates: 0,
    e787: { min: 0, max: 0 }, e777: { min: 0, max: 0 } },
  countries: ['JP'],
  routes: [['RJCC', 'RJSA', 130.5], ['RJTT', 'RJSA', 314.2]],
});
