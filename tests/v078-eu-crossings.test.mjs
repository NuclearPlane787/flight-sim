// v0.7.8, part 2: Europe's runway crossings measured (see v078-crossings.test.mjs): the ground along every runway's
// centreline and tracks at every airport with a crossing, every 0.5 m, to 20 m off the centreline: no step over 2 cm
// (Dublin's 16/34 had 33 cm, Prague's 12/30 27 cm, Lossiemouth's 10/28 24 cm, Cologne Bonn's two 12 cm). From a
// process opened in Europe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url)) {
  const { CROSSINGS78 } = await import('../src/world/runways.js');
  const { measure } = await import('./v078-crossings-measure.mjs');
  test("Europe: the ground along every crossing runway's tracks: no step over 2 cm", async () => {
    const rows = await measure();
    for (const icao of ['EIDW', 'LKPR', 'EDDK', 'EGQS', 'LSZH', 'LFPO', 'EDDH', 'EBBR']) assert.ok(rows.some((r) => r.icao === icao), icao);
    const crossing = rows.filter((r) => r.cutBy.length);
    assert.ok(crossing.length >= 13, `${crossing.length} crossing runways`);
    for (const r of crossing) console.log(`# ${r.icao} ${r.id}: ${r.cm.toFixed(2)} cm (${r.knots} bends)`);
    if (!CROSSINGS78) return;
    for (const r of rows) assert.ok(r.cm <= 2, `${r.icao} ${r.id}: ${r.cm.toFixed(2)} cm at ${r.s} m along, ${r.v} m off`);
  });
}
