// A child of tests/v070-regions.test.mjs (and of anything else that needs a second region in one test run):
// frame.js binds its region once, at import, so another region's numbers come from another process.
//   FS_REGION=europe node tests/v070-region-child.mjs <what>     -> one line of JSON
import { REGION_ID, REGION, dataUrl } from '../src/world/regions.js';
import { toMap, toGeo, scaleFactor, convergence, convergenceAt, magVar, LAT0, LON0 } from '../src/world/frame.js';

const what = process.argv[2] || 'frame';
const out = { region: REGION_ID };
if (what === 'frame') {
  let worst = 0;
  for (let la = 34; la <= 60; la += 0.37) for (let lo = -12; lo <= 21; lo += 0.41) {
    const [x, y] = toMap(la, lo), [a, b] = toGeo(x, y);
    worst = Math.max(worst, Math.abs(a - la), Math.abs(b - lo));
  }
  const DEG = 180 / Math.PI, pt = (la, lo) => toMap(la, lo);
  Object.assign(out, {
    lat0: LAT0, lon0: LON0, origin: pt(REGION.frame.lat0, REGION.frame.lon0), roundTripDeg: worst,
    scale: { gibraltar: scaleFactor(36.15), at47: scaleFactor(47), dublin: scaleFactor(53.43), edinburgh: scaleFactor(55.95), north: scaleFactor(59) },
    convergenceDeg: { lisbon: convergence(-9.14) * DEG, vienna: convergence(16.57) * DEG },
    convergenceAtMatches: Math.abs(convergenceAt(...pt(48.1, 16.57)) - convergence(16.57)) < 1e-12,
    // London to Paris on the map against the great circle (344 km), each end's scale taken out.
    heathrow: pt(51.4706, -0.4619), cdg: pt(49.0097, 2.5479), scaleHeathrow: scaleFactor(51.4706), scaleCdg: scaleFactor(49.0097),
    magPlaneLondon: magVar(51.47, -0.46), data: REGION.data, dataUrl: dataUrl('file:///game/src/main.js', '../'),
  });
}
console.log(JSON.stringify(out));
