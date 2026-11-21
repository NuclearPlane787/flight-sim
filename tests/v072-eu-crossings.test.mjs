// v0.7.2 (the review's finding, 19:50): no runway in Europe has a step in it. Prague's 12/30 had a 7.2 m ramp in its
// first 19 m, where it bent up to the straight line between 06/24's ends (runways.js's CROSSING_LEVEL mends it), and
// no test could see it: the airports' suite compares the ground with the game's own profile. Every runway of every
// European airport, listed or pending: its profile's grade over any 5 m is under 3 % (Dublin's 16/34 has 2.6 %).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { runwayCrossings, profileAt, CROSSING_LEVEL } = await import('../src/world/runways.js');
  const D = new URL('../data/europe/', import.meta.url);
  const man = JSON.parse(readFileSync(new URL('manifest.json', D)));
  const files = [...(man.airportsRegion || []), ...(man.airportsPending || [])];
  const grades = (ap) => ap.runways.map((r) => {
    const len = Math.hypot(...[0, 1].map((k) => (r.ends[1].pavementEnd || [r.ends[1].x, r.ends[1].y])[k] - (r.ends[0].pavementEnd || [r.ends[0].x, r.ends[0].y])[k]));
    let worst = 0, at = 0;
    for (let s = 0; s + 5 <= len; s += 1) { const g = Math.abs(profileAt(r, s + 5, ap.elevM) - profileAt(r, s, ap.elevM)) / 5; if (g > worst) { worst = g; at = s; } }
    return { id: r.id, worst, at };
  });

  test("Europe's runways: no profile steeper than 3 % over 5 m, crossings included", () => {
    assert.ok(files.length >= 29, `${files.length} airports`);
    let top = { worst: 0 };
    for (const f of files) {
      const ap = JSON.parse(readFileSync(new URL(f, D)));
      runwayCrossings(ap);
      for (const g of grades(ap)) {
        assert.ok(g.worst < 0.03, `${ap.icao} ${g.id}: ${(g.worst * 100).toFixed(1)} % at ${g.at} m`);
        if (g.worst > top.worst) top = { ...g, icao: ap.icao };
      }
    }
    console.log(`  the steepest: ${top.icao} ${top.id}, ${(top.worst * 100).toFixed(2)} % at ${top.at} m`);
  });

  test("Prague: 06/24 takes 12's threshold's level where 12/30 crosses it, and without that 12/30 has the 7 m ramp", () => {
    const load = () => JSON.parse(readFileSync(new URL('airports/LKPR.json', D)));
    const ap = load(); runwayCrossings(ap);
    const long = ap.runways.find((r) => r.id === '06/24'), short = ap.runways.find((r) => r.id === '12/30');
    assert.equal(long.knots.length, 1); assert.equal(long.knots[0][1], CROSSING_LEVEL.LKPR['06/24'][1]);
    assert.ok(Math.abs(long.knots[0][1] - short.ends[0].elevM) < 0.01);
    assert.equal(short.knots.length, 2);
    for (const [, h] of short.knots) assert.ok(Math.abs(h - 353.6) < 0.3, `12/30's knot at ${h.toFixed(2)} m`);
    assert.ok(Math.max(...grades(ap).map((g) => g.worst)) < 0.009);
    // the same airport under another name has no entry: the straight line, and the ramp the review found
    const bare = { ...load(), icao: 'XXXX' }; runwayCrossings(bare);
    const g = grades(bare).find((q) => q.id === '12/30');
    assert.ok(g.worst > 0.3 && g.at < 19, `${(g.worst * 100).toFixed(1)} % at ${g.at} m`);
  });
}
