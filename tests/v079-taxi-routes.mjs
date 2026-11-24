// v0.7.9 (subagent taxi, part 4): the taxi routes measured, airport by airport. For each airport, the route from every
// stand to every runway end (routeFromStand) and the taxi-in after a landing at 30, 45, 60, 75 and 90 % along every end
// (the gate flow's afterLanding, as tests/v063-ne-airport.mjs runs it): the longest route, the most metres along a
// runway, the farthest hold from its end, the sharpest turn. Not a test: a table to compare before and after.
//
//   FS_REGION=europe node games/flight-sim/tests/v079-taxi-routes.mjs [--dir <airports folder>] [--only ETAR,LXGB]
//        [--json <file>] [--routes ICAO] [--quiet]
// --dir defaults to the region's own data/…/airports; --json writes every route's points (rounded to 0.1 m) for an
// equality check of two trees; --routes ICAO prints that airport's routes one by one.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildTaxiGraph, routeFromStand } from '../src/ground/taxi.js';
import { createGateFlow, alongRunwayM } from '../src/ground/gate-flow.js';
import { dataUrl, REGION_ID } from '../src/world/regions.js';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const dir = arg('--dir') || fileURLToPath(new URL('airports/', dataUrl(import.meta.url, '../')));
const only = arg('--only') ? arg('--only').split(',') : null;
const detail = arg('--routes');
const quiet = process.argv.includes('--quiet');
const DEG = 180 / Math.PI;

// The sharpest turn along a polyline: the heading change between legs at least 4 m long, measured over the vertices
// between them (so a turn made of many short legs counts whole, up to 40 m of path).
function sharpest(P) {
  const legs = [];
  for (let k = 1; k < P.length; k++) {
    const dx = P[k][0] - P[k - 1][0], dy = P[k][1] - P[k - 1][1], L = Math.hypot(dx, dy);
    if (L >= 0.5) legs.push({ h: Math.atan2(dx, dy), L, k });
  }
  let worst = 0, at = null;
  for (let i = 0; i < legs.length; i++) {
    if (legs[i].L < 4) continue;
    let gap = 0;
    for (let j = i + 1; j < legs.length && gap <= 40; j++) {
      if (legs[j].L >= 4) {
        const d = Math.abs(((legs[j].h - legs[i].h) * DEG + 540) % 360 - 180);
        if (d > worst) { worst = d; at = P[legs[j].k - 1]; }
        break;
      }
      gap += legs[j].L;
    }
  }
  return { deg: worst, at };
}
const r1 = (v) => Math.round(v * 10) / 10;

const files = readdirSync(dir).filter((f) => /^[A-Z0-9]{4}\.json$/.test(f)).sort();
const dump = {};
for (const f of files) {
  const icao = f.slice(0, 4);
  if (only && !only.includes(icao)) continue;
  const ap = JSON.parse(readFileSync(dir + '/' + f, 'utf8'));
  if (!ap.runways?.length || !ap.taxiways?.length) continue;
  const g = buildTaxiGraph(ap), ENDS = ap.runways.flatMap((q) => q.ends);
  const out = { routes: {}, taxiIn: {} };
  const byEnd = {};
  for (const st of ap.stands) for (const end of ENDS) {
    const r = routeFromStand(g, st, end);
    const key = `${st.ref}>${end.ident}`;
    if (!r) { out.routes[key] = null; (byEnd[end.ident] ||= { n: 0, none: 0, len: 0, along: 0, hold: 0, turn: 0 }).none++; continue; }
    const P = r.points.map((p) => [p[0], p[1]]);
    const along = alongRunwayM(g, P), h = P.at(-1), dEnd = Math.hypot(h[0] - end.x, h[1] - end.y), t = sharpest(P);
    out.routes[key] = { len: r1(r.lengthM), along: r1(along), hold: r1(dEnd), turn: r1(t.deg), refs: r.refs || [], pts: P.map((p) => [r1(p[0]), r1(p[1])]) };
    const b = (byEnd[end.ident] ||= { n: 0, none: 0, len: 0, along: 0, hold: 0, turn: 0 });
    b.n++; b.len = Math.max(b.len, r.lengthM); b.along = Math.max(b.along, along); b.hold = Math.max(b.hold, dEnd); b.turn = Math.max(b.turn, t.deg);
    if (detail === icao) console.log(`  ${key}: ${r.lengthM.toFixed(0)} m, ${along.toFixed(0)} m along a runway, hold ${dEnd.toFixed(0)} m from the end (${r.hold?.ref || ''}), sharpest ${t.deg.toFixed(0)}° via ${(r.refs || []).join(' ')}`);
  }
  const tin = { n: 0, none: 0, along: 0, turn: 0 };
  for (const [e, o] of ap.runways.flatMap((rw) => [[rw.ends[0], rw.ends[1]], [rw.ends[1], rw.ends[0]]])) {
    const L = Math.hypot(o.x - e.x, o.y - e.y), ux = (o.x - e.x) / L, uy = (o.y - e.y) / L;
    for (const frac of [0.3, 0.45, 0.6, 0.75, 0.9]) {
      const state = { onGround: true, gs: 10, hdg: Math.atan2(ux, uy), pos: { x: e.x + ux * L * frac, y: e.y + uy * L * frac, z: 0 } };
      const gate = createGateFlow({ sim: { state, type: null }, airports: [ap] });
      const r = gate.afterLanding(state);
      const key = `${e.ident}@${frac}`;
      if (!r) { out.taxiIn[key] = null; tin.none++; continue; }
      const P = r.points.map((p) => [p[0], p[1]]);
      const al = alongRunwayM(gate.graphFor(icao), P.slice(2)), t = sharpest(P.slice(2));
      out.taxiIn[key] = { stand: r.stand, len: r1(r.lengthM), along: r1(al), turn: r1(t.deg), pts: P.map((p) => [r1(p[0]), r1(p[1])]) };
      tin.n++; tin.along = Math.max(tin.along, al); tin.turn = Math.max(tin.turn, t.deg);
      if (detail === icao) console.log(`  in ${key}: to ${r.stand}, ${r.lengthM.toFixed(0)} m, ${al.toFixed(0)} m back along a runway, sharpest ${t.deg.toFixed(0)}°${t.at ? ` at ${t.at.map((v) => v.toFixed(0)).join(', ')}` : ''}`);
    }
  }
  dump[icao] = out;
  if (!quiet) {
    const ends = Object.entries(byEnd).map(([id, b]) => `${id}: ${b.n}${b.none ? `+${b.none} none` : ''} longest ${b.len.toFixed(0)} along ${b.along.toFixed(0)} hold ${b.hold.toFixed(0)} turn ${b.turn.toFixed(0)}`).join(' | ');
    console.log(`${icao} (${ap.stands.length} stands) ${ends} || in ${tin.n}${tin.none ? `+${tin.none} none` : ''} back ${tin.along.toFixed(0)} turn ${tin.turn.toFixed(0)}`);
  }
}
if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify(dump));
console.log(`done ${Object.keys(dump).length} airports (${REGION_ID}, ${dir})`);
