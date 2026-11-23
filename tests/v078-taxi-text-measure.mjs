// v0.7.8 (part 6, item 2): the longest taxi instruction at every airport of a region, before (v0.7.7's text rule) and
// after (gate-flow.js's taxiText()). Every stand to a hold of every runway end, and from every runway end's threshold
// to every stand (the taxi-in's route from where a landing leaves the runway, approximated by the far threshold).
// Run from GameDump: node games/flight-sim/tests/v078-taxi-text-measure.mjs [ea|europe] [ICAO ...]  (prints one line an
// airport and a last line "done N airports"). With --check it exits 1 if any text is over TAXI_LINE_MAX or names a gate.
import { readFileSync, readdirSync } from 'node:fs';
import { buildTaxiGraph, routeFromStand, routeToStand } from '../src/ground/taxi.js';
import { taxiText, TAXI_LINE_MAX } from '../src/ground/gate-flow.js';

const args = process.argv.slice(2), check = args.includes('--check');
const region = args.find((a) => a === 'ea' || a === 'europe') || 'ea';
const only = args.filter((a) => /^[A-Z]{4}$/.test(a));
const DIR = new URL(region === 'europe' ? '../data/europe/airports/' : '../data/airports/', import.meta.url);
// v0.7.7's rule, as the pushed gate-flow.js has it
const oldText = (r, to) => {
  const refs = r.refs.map((x) => (x.startsWith('RWY ') ? 'runway ' + x.slice(4) : x)).filter(Boolean);
  const cross = (r.crossings || []).filter((c) => !refs.includes('runway ' + c));
  return `Taxi to ${to}` + (refs.length ? ` via ${refs.join(', ')}` : '') + (cross.length ? `, crossing ${cross.join(', ')}` : '');
};
export function measure(ap, step = 1) {
  const g = buildTaxiGraph(ap), ends = (ap.runways || []).flatMap((r) => r.ends);
  const stands = (ap.stands || []).filter((_, i) => i % step === 0);
  let worstOld = '', worstNew = '', n = 0, bad = [];
  const see = (r, to) => {
    if (!r) return;
    n++;
    const a = oldText(r, to), b = taxiText(r, to, ap);
    if (a.length > worstOld.length) worstOld = a;
    if (b.length > worstNew.length) worstNew = b;
    if (b.length > TAXI_LINE_MAX || /\bGATE/i.test(b.replace(/^Taxi to (stand|holding point) \S+/, ''))) bad.push(b);
    // (the code review, mended: every runway the route crosses is named, as a crossing or as a runway taxied along)
    else if ((r.crossings || []).some((c) => !b.includes(c))) bad.push('a crossing cut: ' + b);
  };
  for (const st of stands) for (const e of ends) {
    const r = routeFromStand(g, st, e);
    if (r) see(r, `holding point${r.hold && r.hold.ref ? ' ' + r.hold.ref : ''} for ${e.ident}`);
    see(routeToStand(g, [e.x, e.y], st), `stand ${st.ref}`);
  }
  return { n, worstOld, worstNew, bad };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const files = readdirSync(DIR).filter((f) => /^[A-Z]{4}\.json$/.test(f)).filter((f) => !only.length || only.includes(f.slice(0, 4))).sort();
  let bad = 0;
  for (const f of files) {
    const ap = JSON.parse(readFileSync(new URL(f, DIR), 'utf8'));
    const t0 = Date.now(), m = measure(ap);
    bad += m.bad.length;
    console.log(`${f.slice(0, 4)} routes ${m.n} ${Date.now() - t0} ms | before ${m.worstOld.length}: ${m.worstOld} | after ${m.worstNew.length}: ${m.worstNew}${m.bad.length ? ` | BAD ${m.bad.length}: ${m.bad[0]}` : ''}`);
  }
  console.log(`done ${files.length} airports, ${bad} over the line or naming a gate`);
  process.exit(check && bad ? 1 : 0);
}
