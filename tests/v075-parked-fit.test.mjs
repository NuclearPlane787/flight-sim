// v0.7.5, part 7: the parked aircraft beside the player's, and the short stands (src/world/traffic-layout.js).
//   - none within 4.5 m of the player's narrowbody, wingtip to wingtip (PLAYER_CLEAR; the findings at Vienna's F31 and Orly's A1);
//   - no two parked aircraft overlapping, at any airport;
//   - none with its tail over a taxiway that runs behind it (tailOverLine(); the finding at Naples's stand 45).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { placeParked, blockedByPlayer, footprint, rectsOverlap, standHeading, tailOverLine, PLAYER_CLEAR, TAIL_TAXIWAY_M, TAIL_FIT, CLEAR } from '../src/world/traffic-layout.js';
import { AIRLINER_TYPES } from '../src/world/traffic-models.js';

const dir = (f) => new URL('../data/' + f, import.meta.url);
const load = (folder) => {
  const m = JSON.parse(readFileSync(dir(folder + 'manifest.json'), 'utf8'));
  return [...(m.airports || []), ...(m.airportsRegion || []), ...(m.airportsPending || [])].map((f) => JSON.parse(readFileSync(dir(folder + f), 'utf8')));
};
const ALL = [...load(''), ...load('europe/')], BY = Object.fromEntries(ALL.map((a) => [a.icao, a]));
const PARKED = new Map(ALL.map((a) => [a.icao, placeParked(a, { wide: a.icao === 'RKSI' })]));
const raw = (p, margin = 0) => footprint(AIRLINER_TYPES[p.type], p.x, p.y, p.hdg, p.lenScale, margin);
const hit = (A, B) => A.some((a) => B.some((b) => rectsOverlap(a, b)));
// The true distance between two footprints (lists of oriented rectangles), 0 if they overlap.
const corners = (r) => [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([s, t]) => [r.cx + r.ux * r.hl * s - r.uy * r.hw * t, r.cy + r.uy * r.hl * s + r.ux * r.hw * t]);
const pSeg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0; return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t); };
const rectGap = (a, b) => { if (rectsOverlap(a, b)) return 0; const A = corners(a), B = corners(b); let m = Infinity; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) m = Math.min(m, pSeg(A[i], B[j], B[(j + 1) % 4]), pSeg(B[j], A[i], A[(i + 1) % 4])); return m; };
const gap = (A, B) => Math.min(...A.flatMap((a) => B.map((b) => rectGap(a, b))));

test('the switch is on, and the figures are the brief\'s', () => {
  assert.equal(TAIL_FIT, true); assert.equal(PLAYER_CLEAR, 4.5); assert.equal(TAIL_TAXIWAY_M, 15); assert.equal(CLEAR, 2);
});

test('no two parked aircraft overlap, or stand within 4 m of each other, at any airport', () => {
  let n = 0;
  for (const [icao, P] of PARKED) for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    if (Math.hypot(P[i].x - P[j].x, P[i].y - P[j].y) > 160) continue;
    assert.ok(!hit(raw(P[i], 1.99), raw(P[j], 1.99)), `${icao}: ${P[i].stand} and ${P[j].stand}`); n++;
  }
  assert.ok(n > 10000, `${n} pairs`);
});

test('with the player at a stand, no parked aircraft left within 4.5 m of its wingtips: Vienna\'s F31 to F33, Orly\'s A1, and every stand of six airports', () => {
  const check = (icao, ref) => {
    const a = BY[icao], P = PARKED.get(icao), s = a.stands.find((t) => t.ref === ref);
    assert.ok(s, `${icao} has stand ${ref}`);
    const gone = blockedByPlayer(a, P, ref), me = footprint(AIRLINER_TYPES[0], s.x, s.y, standHeading(a, s), 1, 0);
    P.forEach((p, i) => { if (!gone.has(i) && Math.hypot(p.x - s.x, p.y - s.y) < 150) { const g = gap(me, raw(p)); assert.ok(g >= PLAYER_CLEAR - 1e-6, `${icao} ${ref}: ${p.stand} is ${g.toFixed(2)} m away`); } });
    return gone.size;
  };
  for (const ref of ['F31', 'F32', 'F33']) check('LOWW', ref);
  check('LFPO', 'A01'); check('LFPO', 'A02'); check('LFPO', 'A03');
  let freed = 0, stands = 0;
  for (const icao of ['LOWW', 'LFPO', 'LIRN', 'RKSS', 'RJTT', 'EGLL']) for (const ref of new Set(BY[icao].stands.map((s) => s.ref))) { freed += check(icao, ref); stands++; }
  assert.ok(stands > 900 && freed / stands < 2.5, `${freed} aircraft freed over ${stands} stands`);   // it frees the neighbours it must, not the apron
});

test('no parked aircraft has its tail within 15 m of a taxiway that runs behind it; Naples\'s stand 45 is empty', () => {
  const lines = (a) => {
    const box = (pts) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return { pts, bb: [x0, y0, x1, y1] }; };
    return { taxi: (a.taxiways || []).filter((t) => t.ref && t.points?.length > 1).map((t) => box(t.points)), roads: [] };
  };
  let n = 0;
  for (const [icao, P] of PARKED) { const L = lines(BY[icao]); for (const p of P) { assert.equal(tailOverLine(p.x, p.y, p.hdg, AIRLINER_TYPES[p.type].length * p.lenScale, L), null, `${icao} ${p.stand}`); n++; } }
  assert.ok(n > 6000 && n < 6804, `${n} parked aircraft (v0.7.4 placed 6,804 at the same sixty airports)`);
  assert.ok(!PARKED.get('LIRN').some((p) => p.stand === '45'), 'Naples 45');
  assert.ok(PARKED.get('LIRN').length >= 28, `Naples keeps ${PARKED.get('LIRN').length} of its 30`);
});

test('the rule itself: a taxiway 14 m behind the tail is over it, 16 m is not; a line through the stand or along the aircraft is left alone', () => {
  const L = 44.5, line = (pts) => ({ taxi: [{ pts, bb: [-1e6, -1e6, 1e6, 1e6] }], roads: [] });
  // the aircraft's nose at the origin, heading north (h = 0): its tail is at y = -44.5
  assert.equal(tailOverLine(0, 0, 0, L, line([[-200, -58.5], [200, -58.5]])), 'taxiway');
  assert.equal(tailOverLine(0, 0, 0, L, line([[-200, -60.5], [200, -60.5]])), null);
  assert.equal(tailOverLine(0, 0, 0, L, line([[-200, -30], [200, -30]])), null, 'under the aircraft: OSM\'s own lane through the stand');
  assert.equal(tailOverLine(0, 0, 0, L, line([[0, -200], [1, 200]])), null, 'along the axis: its lead-in');
  assert.equal(tailOverLine(0, 0, 0, L, line([[-8, -50], [8, -50]])), null, 'a stub, not a through line');
  assert.equal(tailOverLine(0, 0, 0, L * 37.6 / 44.5, line([[-200, -58.5], [200, -58.5]])), null, 'the shorter narrowbody fits there');
});
