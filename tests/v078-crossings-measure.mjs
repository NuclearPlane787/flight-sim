// v0.7.8, part 2: the step at every runway crossing in the run's region (FS_REGION), measured as v0.7.4 measured
// Brussels's: the ground from the game's own heightfield every 0.5 m along each runway's centreline and tracks beside
// it (the three types' main wheels at 3.8, 4.9 and 5.5 m, and 12 and 20 m), the largest change between neighbours.
// Prints a line per runway of every airport that has a crossing, and "worst <cm> <where>" last.
//   FS_REGION=europe node tests/v078-crossings-measure.mjs [ICAO ...]      (FS_CROSSINGS78=0 for v0.7.7's shapes)
import { readFileSync } from 'node:fs';
import { runwayCrossings, pavementEnd } from '../src/world/runways.js';
import { createTiledHeightfield } from '../src/world/heightfield.js';
import { DATA, readGz, readJson, manifest } from './tile-terrain.mjs';

export const TRACKS = [0, 3.8, -3.8, 4.9, -4.9, 5.5, -5.5, 12, -12, 20, -20];
export async function measure(only = null) {
  const man = manifest(), rows = [];
  for (const f of [...(man.airports || []), ...(man.airportsRegion || [])]) {
    const ap = JSON.parse(readFileSync(new URL(f, DATA)));
    if (only && only.length && !only.includes(ap.icao)) continue;
    runwayCrossings(ap);
    if (!ap.runways.some((r) => r.cutBy && r.cutBy.length)) continue;
    const hf = await createTiledHeightfield(man, DATA.href, { region: true, airports: [ap], readGz, readJson, layers: ['h'], maxTiles: 60 });
    for (const rw of ap.runways) {
      const p0 = pavementEnd(rw.ends[0]), p1 = pavementEnd(rw.ends[1]), len = Math.hypot(p1.x - p0.x, p1.y - p0.y), ux = (p1.x - p0.x) / len, uy = (p1.y - p0.y) / len;
      const worst = { d: 0, s: 0, v: 0 }, by = { 0: 0, 5.5: 0, 20: 0 };
      let n = 0;
      for (const v of TRACKS) {
        let last = null;
        for (let s = 1; s <= len - 1; s += 0.5) {
          const h = hf.heightAt(p0.x + ux * s - uy * v, p0.y + uy * s + ux * v);
          if (last !== null) { const d = Math.abs(h - last); n++; if (d > worst.d) Object.assign(worst, { d, s, v }); const k = Math.abs(v) <= 0 ? 0 : Math.abs(v) <= 5.5 ? 5.5 : 20; if (d > by[k]) by[k] = d; }
          last = h;
        }
      }
      rows.push({ icao: ap.icao, id: rw.id, cutBy: rw.cutBy.map((p) => p.id), knots: rw.knots.length, n, cm: worst.d * 100, s: worst.s, v: worst.v, c0: by[0] * 100, c5: by[5.5] * 100, c20: by[20] * 100 });
    }
  }
  return rows;
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const rows = await measure(process.argv.slice(2).map((s) => s.toUpperCase()));
  let w = null;
  for (const r of rows) {
    console.log(`${r.icao} ${r.id}${r.cutBy.length ? ' (crosses ' + r.cutBy.join(', ') + ', ' + r.knots + ' bends)' : ''}: ${r.cm.toFixed(2)} cm at ${r.s} m along, ${r.v} m off; centreline ${r.c0.toFixed(2)}, to 5.5 m ${r.c5.toFixed(2)}, to 20 m ${r.c20.toFixed(2)} cm; ${r.n} steps`);
    if (!w || r.cm > w.cm) w = r;
  }
  console.log(w ? `worst ${w.cm.toFixed(2)} cm ${w.icao} ${w.id}` : 'worst none');
}
