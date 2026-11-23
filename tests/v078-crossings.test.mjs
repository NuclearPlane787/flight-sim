// v0.7.8, part 2: the oblique runway crossings smoothed ("Found while building v0.7.4"). Every runway that crosses a
// longer one gets the four bends a crossing that v0.7.4 gave Brussels's 01/19 (runways.js CROSSINGS78), so no step
// over 2 cm is left along any runway's tracks at any crossing. ?crossings78=0 (FS_CROSSINGS78=0) gives the pushed
// v0.7.7's shapes back. East Asia's crossings are measured here, Europe's in v078-eu-crossings.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { runwayCrossings, profileAt, pavementEnd, CROSSINGS78, END_LEVEL_M, END_LEVEL_MAX, RUNWAY_SHOULDER_M, MAX_KNOTS } from '../src/world/runways.js';
import { measure } from './v078-crossings-measure.mjs';

const HASH = fileURLToPath(new URL('./v078-crossings-hash.mjs', import.meta.url));
const run = (env) => execFileSync(process.execPath, [HASH], { env: { ...process.env, ...env }, encoding: 'utf8' }).trim();
// The frozen v0.7.7's answer from the same script (every runway's rank, bends, cuts and end elevations, both regions,
// but the three airports part 3 may bake again), taken from the pushed tree at the start of v0.7.8's run.
const V077 = '513a7cbf06af3a45bed513fafa22e3d23a3bd3e5a08c02e55798745bd33da54d runways 144 crossing 15 bends 37';
const load = (dir, icao) => JSON.parse(readFileSync(new URL(`../data/${dir}airports/${icao}.json`, import.meta.url), 'utf8'));

test('switched off (FS_CROSSINGS78=0), every runway\'s bends, cuts and ends are the pushed v0.7.7\'s', () => {
  assert.equal(run({ FS_CROSSINGS78: '0' }), V077);
});

test('on by default: four bends a crossing, each on the longer runway\'s edge at one of the shorter one\'s sides, at its height', () => {
  assert.equal(CROSSINGS78, process.env.FS_CROSSINGS78 !== '0');
  if (!CROSSINGS78) return;
  assert.notEqual(run({ FS_CROSSINGS78: '' }), V077);
  let n = 0;
  for (const [dir, icao] of [['', 'RKPC'], ['', 'RJTT'], ['', 'RJSN'], ['europe/', 'EIDW'], ['europe/', 'EDDK'], ['europe/', 'LSZH'], ['europe/', 'LFPO'], ['europe/', 'EDDH']]) {
    const ap = load(dir, icao); runwayCrossings(ap);
    for (const S of ap.runways.filter((r) => r.cutBy.length === 1)) {
      const P = S.cutBy[0];
      assert.equal(S.knots.length, 4, `${icao} ${S.id}`);
      assert.ok(S.knots.length <= MAX_KNOTS);
      for (let i = 1; i < 4; i++) assert.ok(S.knots[i][0] > S.knots[i - 1][0], 'sorted along the runway');
      const p0 = pavementEnd(S.ends[0]), p1 = pavementEnd(S.ends[1]), sl = Math.hypot(p1.x - p0.x, p1.y - p0.y), ux = (p1.x - p0.x) / sl, uy = (p1.y - p0.y) / sl;
      const q0 = pavementEnd(P.ends[0]), q1 = pavementEnd(P.ends[1]), pl = Math.hypot(q1.x - q0.x, q1.y - q0.y), px = (q1.x - q0.x) / pl, py = (q1.y - q0.y) / pl;
      const hwS = (S.widthM || 45) / 2 + RUNWAY_SHOULDER_M, hwP = (P.widthM || 45) / 2 + RUNWAY_SHOULDER_M;
      for (const [ks, kh] of S.knots) {
        const hit = [-hwS, hwS].map((v) => {
          const x = p0.x + ux * ks - uy * v, y = p0.y + uy * ks + ux * v;
          return { along: (x - q0.x) * px + (y - q0.y) * py, across: Math.abs(-(x - q0.x) * py + (y - q0.y) * px) };
        }).find((q) => Math.abs(q.across - hwP) < 1e-6);
        assert.ok(hit, `${icao} ${S.id}: a bend at ${ks.toFixed(1)} m on ${P.id}'s edge`);
        assert.ok(Math.abs(kh - profileAt(P, hit.along, ap.elevM)) < 1e-9);
        n++;
      }
      assert.ok(P.rank > S.rank, 'the longer runway ranks higher');
    }
  }
  assert.ok(n >= 36, `${n} bends checked`);
});

test('Prague: 12/30 bends where 06/24 bends too, and its end 2.6 m from the crossing is level with it', () => {
  if (!CROSSINGS78) return;
  const ap = load('europe/', 'LKPR'); runwayCrossings(ap);
  const S = ap.runways.find((r) => r.id === '12/30'), P = ap.runways.find((r) => r.id === '06/24');
  assert.equal(P.knots.length, 1); assert.equal(P.knots[0][1], 353.6);          // CROSSING_LEVEL's own bend
  assert.equal(S.knots.length, 6);                                              // four, and one on each edge at 06/24's bend
  assert.equal(S.knots.filter((k) => k[1] === 353.6).length, 2);
  const e12 = S.ends.find((e) => e.ident === '12');
  assert.equal(e12.elevAipM, 353.6);                                            // the published figure kept
  assert.ok(S.knots[0][0] < END_LEVEL_M && e12.elevM === S.knots[0][1] && Math.abs(e12.elevM - 353.6) < 0.5 && END_LEVEL_MAX === 1, `${e12.elevM}`);
  // no other end in either region is moved
  let moved = 0;
  for (const [dir, list] of [['', ['RKPC', 'RJTT', 'RJSN']], ['europe/', ['EIDW', 'EDDK', 'LSZH', 'LFPO', 'EDDH', 'EGQS', 'EHAM', 'LEBL', 'LIRF', 'EKCH', 'EBBR']]]) for (const icao of list) {
    const a = load(dir, icao); runwayCrossings(a);
    for (const r of a.runways) for (const e of r.ends) if (e.elevAipM !== undefined) moved++;
  }
  assert.equal(moved, 0);
});

test('East Asia: the ground along every crossing runway\'s tracks, every 0.5 m to 20 m off the centreline: no step over 2 cm', async () => {
  const rows = await measure();
  assert.ok(rows.some((r) => r.icao === 'RKPC') && rows.some((r) => r.icao === 'RJTT') && rows.some((r) => r.icao === 'RJSN'));
  for (const r of rows) console.log(`# ${r.icao} ${r.id}: ${r.cm.toFixed(2)} cm (${r.n} steps)`);
  if (!CROSSINGS78) return;                                                      // (off, Jeju's 13/31 has its 8.3 cm again)
  for (const r of rows) assert.ok(r.cm <= 2, `${r.icao} ${r.id}: ${r.cm.toFixed(2)} cm at ${r.s} m along, ${r.v} m off`);
});
