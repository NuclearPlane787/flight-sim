// v0.7.0: Paris Charles de Gaulle (LFPG), Europe's second airport, pending: the checks in tests/v063-ne-airport.mjs, run
// in a page opened in Europe (tests/region-run.mjs: the default run re-runs this file in a child process with
// FS_REGION=europe; directly: FS_REGION=europe FS_PENDING=1 node --test tests/v070-eu-lfpg.test.mjs). Against France's SIA
// eAIP (AD 2 LFPG, AIRAC 29 OCT 2026): AD 2.12 08L/26R 4,142 x 45 m, 08R/26L 2,700 x 60, 09L/27R 2,700 x 60, 09R/27L
// 4,200 x 45, the runway ends' and the DTHRs' coordinates, elevations, true and magnetic bearings (084 / 264); AD 2.13
// 26R's threshold displaced 526 m (LDA 3,616) and 27L's 600 m (LDA 3,600); AD 2.14 CAT III approach lights 900 m (the
// game's ALSF-II), PAPI 3.0 deg (side not stated: left [EST]), TDZ and centreline lights at all eight; AD 2.19 ILS CAT
// III at all eight. OSM's 08L/26R and 09R/27L stop at the DTHRs: the bake puts each end at AD 2.12's (THR_AT, THR_LEN).
//   python3 tools/cpu-guard.py -- node --test tests/v070-eu-lfpg.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const AIP = { thrSource: 'AIP', thrTolM: 15, pubMagTol: 1, tdz: true, papiDeg: 3, ils: 'III', approachLights: 'ALSF-II', displacedM: 0 };
  airportSuite({
    icao: 'LFPG', patch: 'charles-de-gaulle', coast: false,
    shortName: 'Charles de Gaulle', name: 'Paris Charles de Gaulle Airport',
    latLon: [49.00896, 2.554117], elevM: 119.5, pubVar: 1.85,
    runways: [
      { id: '09L/27R', lengthM: 2700, widthM: 60, source: "France's SIA eAIP" },
      { id: '09R/27L', lengthM: 4200, widthM: 45, source: "France's SIA eAIP" },
      { id: '08L/26R', lengthM: 4142, widthM: 45, source: "France's SIA eAIP" },
      { id: '08R/26L', lengthM: 2700, widthM: 60, source: "France's SIA eAIP" },
    ],
    ends: {
      '08L': { ...AIP, elevFt: 338, pubMag: 84, trueBrg: 85.34, thr: ['485944.47N', '0023309.88E'] },
      '26R': { ...AIP, elevFt: 318, displacedM: 526, pubMag: 264, trueBrg: 265.38, thr: ['485953.95N', '0023607.24E'] },   // the DTHR
      '08R': { ...AIP, elevFt: 337, pubMag: 84, trueBrg: 85.35, thr: ['485934.49N', '0023356.38E'] },
      '26L': { ...AIP, elevFt: 317, pubMag: 264, trueBrg: 265.37, thr: ['485941.56N', '0023608.77E'] },
      '09L': { ...AIP, elevFt: 378, pubMag: 84, trueBrg: 85.32, thr: ['490128.99N', '0023129.62E'] },
      '27R': { ...AIP, elevFt: 391, pubMag: 264, trueBrg: 265.35, thr: ['490136.10N', '0023342.09E'] },
      '09R': { ...AIP, elevFt: 371, pubMag: 84, trueBrg: 85.31, thr: ['490114.22N', '0023047.01E'] },
      '27L': { ...AIP, elevFt: 388, displacedM: 600, pubMag: 264, trueBrg: 265.35, thr: ['490123.71N', '0023343.62E'] },   // the DTHR
    },
    // 08/26 and 09/27 are parallel (true 085.3 / 265.4): the two pairs' idents differ to tell them apart, so 09L/27R and
    // 09R/27L read 083 / 263 M against their 09 / 27, 6.7 deg off (AD 2.12's own magnetic bearing is 084 / 264)
    identTolDeg: 8,
    fieldSurface: 'runways', fieldPavement: true,
    // 26R's and 27L's thresholds are displaced 526 and 600 m (AD 2.13): their take-offs start from the pavement's end, so
    // the holds there (OSM's at the runway's end, by R1 and Q1) are that far from the landing threshold
    farHolds: { '26R': { m: 750, reason: "AD 2.13's DTHR 526 m: the hold at the runway's end" }, '27L': { m: 750, reason: "AD 2.13's DTHR 600 m: the hold at the runway's end" } },
    // OSM's stands, PH1 and PH2 left out (EU_STAND_DROP: no taxiway reaches them); which take a widebody is the geometry's
    // (no AIP_STANDS entry: AD 2.20 publishes no stand-by-stand size list in text)
    stands: { min: 446, max: 446, refs: ['A10', 'B16', 'D08', 'F84', 'H10', 'I24', 'J33', 'K26', 'N04', 'P80', 'Q04', 'S06'], gates: 164,
      e787: { min: 346, max: 346, include: ['J04', 'K09'] }, e777: { min: 336, max: 336, include: ['J04', 'K09'] } },
    countries: ['FR'],
    routes: [['EGLL', 'LFPG', 187.7]],
  });
}
