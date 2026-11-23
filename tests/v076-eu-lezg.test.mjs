// v0.7.6: Zaragoza (LEZG), a joint civil and air force field, pending: the checks in tests/v063-ne-airport.mjs, run in a
// page opened in Europe (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe;
// directly: FS_REGION=europe FS_PENDING=1 node --test tests/v076-eu-lezg.test.mjs). Against Spain's ENAIRE AIP (AD 2-LEZG,
// WEF 01-OCT-26): AD 2.12 12L/30R 3,032 x 45 m and 12R/30L 3,718 x 45 m, true 120.03 / 300.05 and 120.00 / 300.03 (MAG
// 119 / 299), the thresholds (none displaced: AD 2.13's LDA is the TORA at all four) and their elevations. AD 2.14: 12L
// simple approach lights 427 m (the game's SSALF), PAPI 2.5 deg; 30R precision CAT II/III 600 m (ALSF-II), TDZ 900 m;
// centreline lights on 12L/30R; 12R precision CAT I 581 m (ALSF-I); 30L none; PAPI 3 deg but at 12L (side not stated:
// left [EST]); no TDZ or centreline lights on 12R/30L. AD 2.19: the one ILS, CAT II/III to 30R. The civil apron's
// stands are OSM's (1 to 16 with their A halves; AD 2.8's general aviation 20 to 23 and the hangar apron's 30 to 34 left
// out); the air force's side (OSM's landuse=military "Base Aérea de Zaragoza": the east, south and west aprons) has none.
//   python3 tools/cpu-guard.py -- node --test tests/v076-eu-lezg.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1, displacedM: 0, papiDeg: 3 };
  airportSuite({
    icao: 'LEZG', patch: 'zaragoza', coast: false,
    shortName: 'Zaragoza', name: 'Zaragoza Airport',
    latLon: [41.666199, -1.04155], elevM: 263.0, pubVar: 1,
    runways: [
      { id: '12L/30R', lengthM: 3032, widthM: 45, source: "Spain's ENAIRE AIP" },
      { id: '12R/30L', lengthM: 3718, widthM: 45, source: "Spain's ENAIRE AIP" },
    ],
    ends: {
      '12L': { ...E, ils: null, approachLights: 'SSALF', approachLightsM: 427, papiDeg: 2.5, tdz: false, elevFt: 823, pubMag: 119, trueBrg: 120.03, thr: ['414008.62N', '0010223.40W'] },
      '30R': { ...E, ils: 'III', approachLights: 'ALSF-II', approachLightsM: 600, tdz: true, elevFt: 834, pubMag: 299, trueBrg: 300.05, thr: ['413919.42N', '0010029.94W'] },
      '12R': { ...E, ils: null, approachLights: 'ALSF-I', approachLightsM: 581, tdz: false, centreline: false, elevFt: 834, pubMag: 119, trueBrg: 120.00, thr: ['414048.74N', '0010456.54W'] },
      '30L': { ...E, ils: null, approachLights: null, approachLightsM: 0, tdz: false, centreline: false, elevFt: 862, pubMag: 299, trueBrg: 300.03, thr: ['413948.46N', '0010237.37W'] },
    },
    fieldSurface: 'runways', fieldPavement: true,
    // OSM's stands on the civil apron, less AD 2.8's 20 to 23 and 30 to 34 (STAND_EXCLUDE); no jet bridges
    // (v0.7.8, part 3's item 6: OSM's stand 2 overlaps stand 1 and is left out, STAND_DROP: 21 from the v0.7.8 bake on)
    stands: { min: 21, max: 21, refs: ['1', '9', '12', '13', '16', '5A', '10B'], gates: 0,
      // AIP_STANDS.LEZG: code E only at 6 to 9A, 12 and 13 [EST]; the geometry keeps nine of them (9A isn't mapped)
      e787: { min: 9, max: 9, include: ['12', '13', '9'], only: ['6', '6A', '7', '7A', '8', '8A', '9', '9A', '12', '13'] },
      e777: { min: 9, max: 9, include: ['12', '13', '9'], only: ['6', '6A', '7', '7A', '8', '8A', '9', '9A', '12', '13'] } },
    countries: ['ES'],
    routes: [['LEZG', 'LEMD', 134.4], ['LEZG', 'LEBL', 142.1], ['LEZG', 'LEST', 335.6]],
  });
}
