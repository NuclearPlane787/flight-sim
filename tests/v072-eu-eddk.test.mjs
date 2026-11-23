// v0.7.2: Cologne Bonn (EDDK), pending: the checks in tests/v063-ne-airport.mjs, run in a page opened in Europe
// (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe; directly:
// FS_REGION=europe FS_PENDING=1 node --test tests/v072-eu-eddk.test.mjs). Against Germany's DFS AIP IFR (AD 2 EDDK,
// effective 29 OCT 2026; the designators there and in OSM are still 13L/31R and 13R/31L): AD 2.12 06/24 2,459 x 45 m,
// 13L/31R 3,815 x 60 m, 13R/31L 1,863 x 45 m, true 064.40 / 244.40 and 137.50 / 317.50, the thresholds' coordinates and
// elevations; AD 2.13 no displacement. AD 2.14: SALS at 06, 13R, 31L (the game's SSALF; 420 m [EST]), ALSAF at 24, 13L,
// 31R (ALSF-II; 900 m [EST]); PAPI 3.0 deg (left [EST]); TDZ at 24, 13L, 31R; centreline lights at all six. AD 2.19: ILS
// CAT III to 13L and 31R, CAT I to 24 (none listed for 06, 13R, 31L); MAG VAR 3 deg E (2024).
// 06/24 crosses both 13L/31R and 13R/31L.
//   python3 tools/cpu-guard.py -- node --test tests/v072-eu-eddk.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 0.5, displacedM: 0, papiDeg: 3 };
  airportSuite({
    icao: 'EDDK', patch: 'cologne-bonn', coast: false,
    shortName: "Cologne Bonn", name: "Cologne Bonn Airport",
    latLon: [50.865898, 7.14274], elevM: 92.0, pubVar: 3,
    runways: [
      { id: '06/24', lengthM: 2459, widthM: 45, source: "Germany's DFS AIP" },
      { id: '13L/31R', lengthM: 3815, widthM: 60, source: "Germany's DFS AIP" },
      { id: '13R/31L', lengthM: 1863, widthM: 45, source: "Germany's DFS AIP" },
    ],
    ends: {
      '06': { ...E, ils: null, approachLights: 'SSALF', approachLightsM: 420, tdz: false, elevFt: 229.1, pubMag: 61.40, trueBrg: 64.40, thr: ['505136.438N', '0070725.605E'] },
      '24': { ...E, ils: 'I', approachLights: 'ALSF-II', tdz: true, elevFt: 270.7, pubMag: 241.40, trueBrg: 244.40, thr: ['505210.811N', '0070918.976E'] },
      '13L': { ...E, ils: 'III', approachLights: 'ALSF-II', tdz: true, elevFt: 228.8, pubMag: 134.50, trueBrg: 137.50, thr: ['505249.688N', '0070744.668E'] },
      '31R': { ...E, ils: 'III', approachLights: 'ALSF-II', tdz: true, elevFt: 300.3, pubMag: 314.50, trueBrg: 317.50, thr: ['505118.699N', '0070956.491E'] },
      '13R': { ...E, ils: null, approachLights: 'SSALF', approachLightsM: 420, tdz: false, elevFt: 219.9, pubMag: 134.50, trueBrg: 137.50, thr: ['505215.043N', '0070715.101E'] },
      '31L': { ...E, ils: null, approachLights: 'SSALF', approachLightsM: 420, tdz: false, elevFt: 257.9, pubMag: 314.50, trueBrg: 317.50, thr: ['505130.615N', '0070819.468E'] },
    },
    fieldSurface: 'runways', fieldPavement: true, crossingProfile: true,
    // The south-west apron (stands R13 to R41, unnamed in OSM, south of 06/24's west end): OSM's taxiways join it to the
    // field only at 06/24's west end, so the way to 24's holds runs along 06/24 (2,378 m from R13 to R29, 898 m from R30 to R41)
    alongRunway: { byStand: { R13: 2400, R14: 2400, R15: 2400, R16: 2400, R17: 2400, R18: 2400, R19: 2400, R20: 2400, R21: 2400, R22: 2400, R23: 2400, R24: 2400, R25: 2400, R26: 2400, R27: 2400, R28: 2400, R29: 2400, R30: 900, R31: 900, R32: 900, R33: 900, R34: 900, R35: 900, R36: 900, R37: 900, R38: 900, R39: 900, R40: 900, R41: 900 }, reason: "the south-west apron joins the field only at 06/24's west end" },
    // F24-2 stands between 06/24 and 13R/31L, where the field's surface blends the runways' profiles: 0.7 m off it
    standGround: { byStand: { 'F24-2': 1.0, W28: 1.0 /* v0.7.8: 0.61 m with the four bends a crossing, under 0.6 m with two */ }, reason: 'between 06/24 and 13R/31L, where the runways\' profiles blend' },
    // OSM's stands; which take a widebody is the geometry's (the parking list not read for code letters)
    stands: { min: 184, max: 184, refs: ['D10', 'D12', 'D14', 'D16'], gates: 29, e787: { min: 118, max: 118 }, e777: { min: 106, max: 106 } },
    countries: ["DE"],
    routes: [['EDDK', 'EDDF', 73.9], ['EDDK', 'EDDM', 235.3], ['EDDK', 'EBBR', 100.7]],
  });
}
