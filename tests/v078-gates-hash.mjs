// v0.7.8, part 1: one SHA-256 over every stand's paint and every gate's jet bridge at every airport of both regions, as
// the tree lays them out now (apron-geom.js's standMarks() and jetBridge() with gateFit(icao)). Run with FS_GATES78=0
// it must print what the pushed v0.7.7 printed (tests/v078-gates.test.mjs holds that hash). Prints the hash and counts.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import * as G from '../src/world/apron-geom.js';

const h = createHash('sha256');
let stands = 0, gates = 0, bridges = 0;
for (const dir of ['../data/airports/', '../data/europe/airports/']) {
  const base = new URL(dir, import.meta.url);
  // (Zaragoza's, Lossiemouth's and Fairford's files may be baked again in v0.7.8's part 3: left out, so the hash holds.)
  for (const f of readdirSync(base).filter((n) => /^[A-Z]{4}\.json$/.test(n) && !/^(LEZG|EGQS|EGVA)\./.test(n)).sort()) {
    const a = JSON.parse(readFileSync(new URL(f, base), 'utf8'));
    const T = (a.buildings || []).filter((b) => b.kind === 'terminal').map((b) => G.openRing(b.points));
    const fit = G.gateFit(a.icao);
    for (const s of a.stands || []) {
      stands++;
      h.update(JSON.stringify([a.icao, s.ref, G.standMarks(s, fit), s.gate ? G.jetBridge(s, T, 80, fit) : 0]));
      if (s.gate) { gates++; if (G.jetBridge(s, T, 80, fit)) bridges++; }
    }
  }
}
console.log(`${h.digest('hex')} stands ${stands} gates ${gates} bridges ${bridges}`);
