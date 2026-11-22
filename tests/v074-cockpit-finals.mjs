// v0.7.4: finals to real runway ends for the cockpit's tests (tests/v074-hdg-course.test.mjs, v074-loc-*.test.mjs),
// in whichever region the process was opened in (tests/region-run.mjs). Not a test file itself.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NM = 1852, KT = 0.514444, FT = 0.3048, DEG = Math.PI / 180;

// The airport file and the end, from the region's data folder.
export async function endOf(icao, ident) {
  const { REGION } = await import('../src/world/regions.js');
  const ap = JSON.parse(readFileSync(path.join(ROOT, REGION.data, 'airports', `${icao}.json`), 'utf8'));
  for (const r of ap.runways) for (const e of r.ends) if (e.ident === ident) return { airport: ap, runway: r, end: e };
  throw new Error(`no ${icao} ${ident}`);
}

// Where a point is against an end's extended centreline: along (< 0 before the threshold) and xte (> 0 right).
export function against(end, x, y) {
  const h = end.hdgGridDeg * DEG, ux = Math.sin(h), uy = Math.cos(h);
  const rx = x - end.x, ry = y - end.y;
  return { along: rx * ux + ry * uy, xte: rx * uy - ry * ux };
}

// A point `nm` before the threshold, `offM` to the right of the centreline.
export function onFinal(end, nm, offM = 0) {
  const h = end.hdgGridDeg * DEG, ux = Math.sin(h), uy = Math.cos(h), d = nm * NM;
  return { x: end.x - ux * d + uy * offM, y: end.y - uy * d - ux * offM, hdg: h };
}

// The ILS as sim.ap.setIls() takes it (main.js's: the threshold, the grid course, the elevation, the PAPI's angle).
export const ilsOf = (end) => ({ x: end.x, y: end.y, hdgGrid: end.hdgGridDeg * DEG, elev: end.elevM, gsDeg: end.papiDeg ?? 3 });
