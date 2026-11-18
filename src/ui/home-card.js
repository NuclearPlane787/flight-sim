// v0.5.7: what the home page's saved-flight card says (the main menu's Continue, ui/menu.js), from a scenario's index
// entry. Pure (no DOM): tests/home-card.test.mjs checks every case.
//
//   flightCard(entry, { place }) → null | { id, kicker, title, sub, stats: [{ value, label }], action }
//     entry: a ScenarioStore index entry ({ id, name, type, summary }); place(icao) → a short place name, or null for
//     an airport it doesn't know (the card then shows the code)
//   readFlight(summary) → { phase, origin, dest, at, stand, alt, distNm, landed, final }: the summary's own fields (from
//     v0.5.7, scenarios.js's flightFields()), else read from its `where` and `route` texts (older saves)
//   shortPlace(name) → "Jeju" for "Jeju International Airport", "Gimpo" for "Seoul Gimpo International Airport"
//
// Phases: fresh (not flown yet), air, parked, pushback, taxi, runway (lined up, or landed and rolling), crashed (never
// saved today: a crash keeps the last good save; here for completeness).

import { typeName, altText, PHASES } from '../scenarios.js';

const str = (v) => (v == null || v === '' ? null : String(v));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// "FL350" → 35000, "8,500 ft" → 8500
function altFrom(text) {
  const fl = /^FL(\d{2,3})$/.exec(text);
  if (fl) return Number(fl[1]) * 100;
  const ft = /^([\d,]+) ft$/.exec(text);
  return ft ? Number(ft[1].replace(/,/g, '')) : null;
}

// The texts scenarios.js's whereText() writes (and the two others older code wrote: "Not flown yet" for a new
// scenario, "On final to RKPC" for Scenario 1 made from v0.1.4's last flight).
const CODE = '([A-Z0-9]{3,4})';
const WHERE = [
  [/^Not flown yet$/i, () => ({ phase: 'fresh' })],
  [new RegExp(`^Parked at ${CODE}(?: stand (.+))?$`), (m) => ({ phase: 'parked', at: m[1], stand: m[2] ?? null })],
  [new RegExp(`^Pushing back at ${CODE}$`), (m) => ({ phase: 'pushback', at: m[1] })],
  [new RegExp(`^Taxiing at ${CODE}$`), (m) => ({ phase: 'taxi', at: m[1] })],
  [new RegExp(`^On the runway at ${CODE}$`), (m) => ({ phase: 'runway', at: m[1] })],
  [new RegExp(`^On final to ${CODE}$`), (m) => ({ phase: 'air', dest: m[1], final: true })],
  [new RegExp(`^(FL\\d{2,3}|[\\d,]+ ft)(?:, ([\\d,]+(?:\\.\\d+)?) nm to ${CODE})?$`),
    (m) => ({ phase: 'air', alt: altFrom(m[1]), distNm: m[2] != null ? Number(m[2].replace(/,/g, '')) : null, dest: m[3] ?? null })],
];
export function parseWhere(where) {
  const w = String(where ?? '').trim();
  for (const [re, f] of WHERE) { const m = re.exec(w); if (m) return f(m); }
  return { phase: null };
}

// "RKSS–RKPC" (summaryNow()), "RKSS 14R → RKPC 07" (routeText()) → { origin, dest }
export function parseRoute(route) {
  const m = /^\s*([A-Z0-9]{3,4})\b[^–→>]*?\s*(?:–|—|→|->|>|-)\s*([A-Z0-9]{3,4})\b/.exec(String(route ?? ''));
  return m ? { origin: m[1], dest: m[2] } : { origin: null, dest: null };
}

export function readFlight(summary) {
  const s = summary && typeof summary === 'object' ? summary : {};
  const r = parseRoute(s.route);
  const f = PHASES.has(s.phase)
    ? { phase: s.phase, at: str(s.at), stand: str(s.stand), alt: num(s.alt), distNm: num(s.distNm), dest: str(s.dest), landed: s.landed === true, final: false }
    : { at: null, stand: null, alt: null, distNm: null, dest: null, landed: false, final: false, ...parseWhere(s.where) };
  return { ...f, origin: str(s.origin) || r.origin, dest: f.dest || str(s.dest) || r.dest };
}

// A place's short name, from the airport data's `name`. A leading city or country is dropped where the airport has a
// name of its own after it ("Seoul Gimpo", "Tokyo Haneda", "Taiwan Taoyuan"); a `shortName` in the data wins (main.js).
const LEADS = new Set(['Seoul', 'Tokyo', 'Taipei', 'Taiwan', 'Shanghai']);
export function shortPlace(name) {
  let s = String(name ?? '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) s = s.replace(/\s+(airport|international|intl\.?|air base|airfield|aerodrome)$/i, '').trim();
  const w = s.split(' ');
  if (w.length > 1 && LEADS.has(w[0])) s = w.slice(1).join(' ');
  return s || null;
}

const nmText = (nm) => `${Math.round(nm).toLocaleString('en-US')} nm`;

export function flightCard(entry, { place } = {}) {
  if (!entry || typeof entry !== 'object' || !entry.id) return null;
  const s = entry.summary && typeof entry.summary === 'object' ? entry.summary : {};
  const f = readFlight(s);
  const named = (code) => { let n = null; try { n = place?.(code) || null; } catch { n = null; } return n || code; };
  const at = f.at ? ` at ${named(f.at)}` : '';
  const route = [f.origin && { value: f.origin, label: 'From' }, f.dest && { value: f.dest, label: 'To' }].filter(Boolean);
  const aircraft = s.design ? String(s.design) : typeName(entry.type);
  const card = { id: entry.id, kicker: 'Saved flight', title: '', sub: [str(entry.name), aircraft].filter(Boolean).join(' · '), stats: route, action: 'Resume flight' };
  switch (f.phase) {
    case 'fresh':
      card.kicker = 'Not flown yet';
      card.action = 'Start flight';
      card.title = f.origin && f.dest ? `${named(f.origin)} to ${named(f.dest)}` : 'A new flight';
      break;
    case 'air': {
      card.title = f.final && f.dest ? `On final to ${named(f.dest)}` : f.dest ? `En route to ${named(f.dest)}` : 'In the air';
      const alt = f.alt != null ? { value: altText(f.alt), label: f.alt >= 18000 ? 'Flight level' : 'Altitude' } : null;
      const far = f.distNm != null ? { value: nmText(f.distNm), label: 'Remaining' } : null;
      if (alt || far) card.stats = [alt || (f.origin && { value: f.origin, label: 'From' }), far || (f.dest && { value: f.dest, label: 'To' })].filter(Boolean);
      break;
    }
    case 'parked': card.title = f.at ? `At ${named(f.at)}${f.stand ? `, stand ${f.stand}` : ''}` : 'Parked'; break;
    case 'pushback': card.title = `Pushing back${at}`; break;
    case 'taxi': card.title = `Taxiing${at}`; break;
    case 'runway': card.title = f.landed ? `Landed${at}` : `On the runway${at}`; break;
    case 'crashed': card.title = f.at ? `Crashed near ${named(f.at)}` : 'Crashed'; break;
    default: card.title = str(s.where) || (f.origin && f.dest ? `${named(f.origin)} to ${named(f.dest)}` : 'Saved flight');
  }
  card.stats = card.stats.slice(0, 2);
  return card;
}
