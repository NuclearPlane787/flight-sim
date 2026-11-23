// v0.7.8, part 2: one SHA-256 over every runway's bends, cuts and end elevations at every airport of both regions, as
// runwayCrossings() shapes them now. Run with FS_CROSSINGS78=0 it must print what the pushed v0.7.7 printed
// (tests/v078-crossings.test.mjs holds that hash). Prints the hash and the counts.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { runwayCrossings } from '../src/world/runways.js';

const h = createHash('sha256');
let crossing = 0, bends = 0, runways = 0;
for (const dir of ['../data/airports/', '../data/europe/airports/']) {
  const base = new URL(dir, import.meta.url);
  // (Zaragoza's, Lossiemouth's and Fairford's files may be baked again in v0.7.8's part 3: left out, so the hash holds.)
  for (const f of readdirSync(base).filter((n) => /^[A-Z]{4}\.json$/.test(n) && !/^(LEZG|EGQS|EGVA)\./.test(n)).sort()) {
    const a = JSON.parse(readFileSync(new URL(f, base), 'utf8'));
    runwayCrossings(a);
    for (const r of a.runways || []) {
      runways++; bends += (r.knots || []).length; if ((r.cutBy || []).length) crossing++;
      h.update(JSON.stringify([a.icao, r.id, r.rank, r.knots, (r.cutBy || []).map((p) => p.id), r.ends.map((e) => e.elevM)]));
    }
  }
}
console.log(`${h.digest('hex')} runways ${runways} crossing ${crossing} bends ${bends}`);
