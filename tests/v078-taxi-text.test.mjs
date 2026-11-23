// v0.7.8 part 6, item 2 (briefs/V0-7-8.md; "Found while building v0.7.5"): the taxi instructions. Madrid's taxi-in ran to
// thirty names over two lines and named OSM's "GATE-5" and "GATE-13" as taxiways. gate-flow.js's taxiRefs(), fitLine()
// and taxiText(): no stand or gate ref as a taxiway, a numbered piece read as its taxiway, no name twice in a row, a
// name back after one short link merged, the line at most TAXI_LINE_MAX characters. The whole check, every stand of
// every airport to every runway end and back, is tests/v078-taxi-text-measure.mjs --check (both regions); here every
// fourth stand of every airport, so the suite stays quick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { taxiRefs, fitLine, fitTaxi, taxiText, taxiLine, TAXI_LINE_MAX, TAXI_SHORT_M, TAXI_STAND_LINK_M } from '../src/ground/gate-flow.js';
import { buildTaxiGraph, routeFromStand } from '../src/ground/taxi.js';
import { measure } from './v078-taxi-text-measure.mjs';

test('v0.7.8 taxi text: the refs\' rules', () => {
  const ap = { stands: [{ ref: '7' }, { ref: 'T6' }] };
  assert.deepEqual(taxiRefs(['A', 'B', 'A', 'B'], [500, 500, 500, 500]), ['A', 'B', 'A', 'B'], 'long runs stay as they are');
  assert.deepEqual(taxiRefs(['A', 'B', 'A'], [300, TAXI_SHORT_M - 1, 300]), ['A'], 'back after one short link: merged');
  assert.deepEqual(taxiRefs(['A', 'RWY 14L/32R', 'A'], [300, 50, 300]), ['A', 'RWY 14L/32R', 'A'], 'a runway is never merged away');
  assert.deepEqual(taxiRefs(['GATE-5', 'A', 'gate 13', '7', 'T6', 'B'], null, ap), ['A', 'B'], 'no stand or gate ref');
  assert.deepEqual(taxiRefs(['KA-7', 'KA-6', 'KA-5', 'M-27', 'M11']), ['KA', 'M', 'M11'], 'numbered pieces read as their taxiway');
  assert.deepEqual(taxiRefs(['A', 'GATE-2', 'A']), ['A'], 'a dropped gate between two runs of the same name: one name');
  assert.deepEqual(taxiRefs(['A', '', 'A', 'B']), ['A', 'B']);
});

test('v0.7.8 taxi text: one line, cut at a name with "…"', () => {
  const long = 'Taxi to stand 7 via ' + Array.from({ length: 40 }, (_, i) => 'T' + i).join(', ');
  const s = fitLine(long);
  assert.ok(s.length <= TAXI_LINE_MAX && s.endsWith('…'), s);
  assert.ok(/T\d+…$/.test(s), 'cut after a whole name');
  assert.equal(fitLine('Taxi to stand 7 via A'), 'Taxi to stand 7 via A');
  const t = taxiText({ refs: ['RWY 14L/32R', 'K-8', 'KA-7', 'KA-6', 'GATE-2', 'M-8', 'M-7'], refLens: [100, 50, 80, 80, 20, 90, 90], crossings: ['14L/32R'] }, 'stand 134', { stands: [] });
  assert.equal(t, 'Taxi to stand 134 via runway 14L/32R, K, KA, M');
});

// The code review's two findings (04:53), mended by the lead.
test('v0.7.8 taxi text: a real taxiway that shares a stand\'s name is kept; a stand\'s own lead-in is not named', () => {
  const ap = { stands: [{ ref: 'N' }, { ref: 'R4' }, { ref: '7' }] };
  assert.deepEqual(taxiRefs(['L', 'N', 'S'], [300, 3000, 400], ap), ['L', 'N', 'S'], "Frankfurt's N, 3 km of it");
  assert.deepEqual(taxiRefs(['L', 'N', 'S'], [300, TAXI_STAND_LINK_M - 1, 400], ap), ['L', 'S'], 'a link under 100 m with a stand\'s ref: the lead-in');
  assert.deepEqual(taxiRefs(['R4', 'A', '7'], [4400, 500, 60], ap), ['R4', 'A']);
  assert.deepEqual(taxiRefs(['A', '7', 'B'], null, ap), ['A', 'B'], 'no lengths: a stand\'s ref is dropped as before');
  // at Frankfurt itself: no route loses a run of N over 300 m
  const eddf = JSON.parse(readFileSync(new URL('../data/europe/airports/EDDF.json', import.meta.url), 'utf8'));
  assert.ok(eddf.stands.some((s) => String(s.ref) === 'N') && eddf.taxiways.some((t) => t.ref === 'N'), 'Frankfurt has a stand N and a taxiway N');
  assert.deepEqual(taxiRefs(['N15', 'N', 'S'], [200, 2919, 300], eddf), ['N15', 'N', 'S']);
});

test('v0.7.8 taxi text: the crossings are never cut: the middle of the list goes first', () => {
  const refs = ['P1', 'A', 'A10', 'B', 'E1', 'E10', 'H', 'G', 'Q', 'R', 'S1', 'S2', 'V', 'W1', 'W2', 'Z'];
  const t = fitTaxi('Taxi to holding point for 36R', refs, ', crossing 18L/36R, 09/27');
  assert.ok(t.length <= TAXI_LINE_MAX, t);
  assert.ok(t.endsWith(', …, Z, crossing 18L/36R, 09/27'), t);
  assert.ok(t.startsWith('Taxi to holding point for 36R via P1, A, '), t);
  assert.equal(fitTaxi('Taxi to stand 7', ['A', 'B'], ', crossing 07/25'), 'Taxi to stand 7 via A, B, crossing 07/25');   // fits: whole
  // with a prefix the route is fitted in what is left, and still names its crossings
  const r = { refs: refs, refLens: refs.map(() => 400), crossings: ['18L/36R', '09/27'], textTo: 'holding point for 36R' };
  const line = taxiLine('Pushback complete. ', r, { stands: [] });
  assert.ok(line.length <= TAXI_LINE_MAX && line.startsWith('Pushback complete. Taxi to holding point for 36R via ') && line.endsWith(', Z, crossing 18L/36R, 09/27'), line);
  // a runway taxied along is kept too
  const u = fitTaxi('Taxi to stand 981', ['D1', 'D2', 'D', 'S3', 'S', 'R', 'A', 'W', 'B', 'J1', 'B11', 'runway 04/22', 'T11', 'A16', 'L16', 'T', 'T2', 'N1', 'N'], ', crossing 05/23');
  assert.ok(u.length <= TAXI_LINE_MAX && u.includes('runway 04/22') && u.endsWith(', N, crossing 05/23') && u.includes('…'), u);
  assert.equal(taxiLine('Rewound. ', null, null, 'No taxi route found'), 'Rewound. No taxi route found');
  // four runways crossed (Pudong's M3 for 15): the taxiway list goes before a crossing does
  assert.equal(fitTaxi('Taxi to holding point M3 for 15', ['L15', 'Q5', 'C6', 'K', 'M3'], ', crossing 17R/35L, 17L/35R, 16R/34L, 16L/34R'),
    'Taxi to holding point M3 for 15 via …, crossing 17R/35L, 17L/35R, 16R/34L, 16L/34R');
  assert.equal(fitTaxi('Taxi to holding point M3 for 15', ['L15', 'M3'], ', crossing 17R/35L, 17L/35R, 16R/34L, 16L/34R, 09/27'), 'Taxi to holding point M3 for 15, crossing 17R/35L, 17L/35R, 16R/34L, 16L/34R, 09/27');
  assert.equal(fitTaxi('Taxi to holding point for 25L', ['A', 'runway 01/19', 'B', 'C', 'runway 07R/25L', 'D', 'E1'], ', crossing 07L/25R', 80),
    'Taxi to holding point for 25L via runway 01/19, runway 07R/25L, crossing 07L/25R');
  // every airport: an instruction names every runway its route crosses (every fourth stand, in the tests below)
});

// The code review's second look (05:39): the line after a pushback, with the parking brake's hint before the route.
test('v0.7.8 taxi text: after the long parking-brake prefix the route keeps its own full line; no prefix ever costs a runway', () => {
  const BRAKE = 'Pushback complete. Release the parking brake (B). ';
  for (const [dir, icao] of [['../data/airports/', 'RKSI'], ['../data/airports/', 'RKSS'], ['../data/europe/airports/', 'EHAM'], ['../data/europe/airports/', 'EDDF'], ['../data/airports/', 'ZSPD']]) {
    const ap = JSON.parse(readFileSync(new URL(dir + icao + '.json', import.meta.url), 'utf8'));
    const g = buildTaxiGraph(ap), ends = ap.runways.flatMap((r) => r.ends);
    let n = 0, crossed = 0;
    ap.stands.forEach((st, i) => {
      if (i % 6) return;
      for (const e of ends) {
        const r = routeFromStand(g, st, e);
        if (!r) continue;
        r.textTo = `holding point${r.hold && r.hold.ref ? ' ' + r.hold.ref : ''} for ${e.ident}`;
        const own = taxiText(r, r.textTo, ap);
        n++;
        if ((r.crossings || []).length) crossed++;
        for (const prefix of [BRAKE, 'Pushback complete. ', 'Rewound. ']) {
          const line = taxiLine(prefix, r, ap);
          assert.ok(line.startsWith(prefix + 'Taxi to '), line);
          for (const c of r.crossings || []) assert.ok(line.includes(c), `${icao}: ${c} lost in: ${line}`);
          assert.ok(!line.endsWith('…'), `${icao}: cut: ${line}`);
          if (prefix === BRAKE) assert.equal(line, prefix + own, 'the route as it is said alone');
          else assert.ok(line.length <= TAXI_LINE_MAX || line === prefix + own, `${icao}: ${line.length}: ${line}`);
        }
      }
    });
    assert.ok(n > 50 && crossed > 0, `${icao}: ${n} routes, ${crossed} with crossings`);
  }
  // a route from a save made before v0.7.8: no textTo, its text v0.7.7's unfitted one
  const old = { refs: ['A', 'GATE-2', 'A', 'B'], refLens: [300, 20, 300, 400], crossings: ['07/25'], text: 'Taxi to stand 12 via A, GATE-2, A, B, crossing 07/25' };
  assert.equal(taxiLine('Rewound. ', old, { stands: [] }), 'Rewound. Taxi to stand 12 via A, B, crossing 07/25');
  assert.equal(taxiLine('Rewound. ', { text: 'Taxi to stand 12 via A' }), 'Rewound. Taxi to stand 12 via A');   // nothing to rebuild from: as saved
});

for (const [region, dir] of [['ea', '../data/airports/'], ['europe', '../data/europe/airports/']]) {
  test(`v0.7.8 taxi text: ${region}: no instruction over the line or naming a gate (every fourth stand, every runway end, both ways)`, () => {
    const D = new URL(dir, import.meta.url);
    const files = readdirSync(D).filter((f) => /^[A-Z]{4}\.json$/.test(f));
    assert.ok(files.length >= (region === 'ea' ? 29 : 43));
    let n = 0;
    for (const f of files) {
      const m = measure(JSON.parse(readFileSync(new URL(f, D), 'utf8')), 4);
      n += m.n;
      assert.deepEqual(m.bad, [], f);
    }
    assert.ok(n > 1000, `${n} routes`);
  });
}
