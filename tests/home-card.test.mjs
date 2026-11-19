// v0.5.7: the home page's saved-flight card (src/ui/home-card.js) for every phase, from the summary's fields
// (scenarios.js's flightFields(), saved by main.js's summaryNow()) and from older saves' `where` text; the store
// keeping those fields (create, write, duplicate); place names from the airports' data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { flightCard, readFlight, parseWhere, parseRoute, shortPlace } from '../src/ui/home-card.js';
import { ScenarioStore, flightFields, whereText, altText } from '../src/scenarios.js';
import { setEastAsia } from '../src/world/region.js';
// v0.6.0: this file checks v0.5.8's behaviour, which the game keeps with the region off: so the
// flag is set off here whatever the shipped default (the region's own behaviour is checked in
// tests/v060-*.test.mjs). No assertion below changed.
setEastAsia(false);

const NAMES = { RKSS: 'Gimpo', RKPC: 'Jeju', RKSI: 'Incheon' };
const place = (icao) => NAMES[icao] || null;
const entry = (summary, extra = {}) => ({ id: 'a1', name: 'Scenario 6', type: 'a321neo', summary, ...extra });
// A summary as summaryNow() makes it: the texts and the fields from the same facts.
const saved = (facts, route = 'RKSS–RKPC') => ({ route, where: whereText({ ...facts, destIcao: facts.dest }), ...flightFields(facts) });
const card = (summary, opts = { place }, extra) => flightCard(entry(summary, extra), opts);

test('in the air: en route, the flight level or feet, and the distance left', () => {
  const c = card(saved({ onGround: false, altFt: 35020, distNm: 224.6, origin: 'RKSS', dest: 'RKPC' }));
  assert.equal(c.kicker, 'Saved flight');
  assert.equal(c.title, 'En route to Jeju');
  assert.equal(c.sub, 'Scenario 6 · A321neo');
  assert.deepEqual(c.stats, [{ value: 'FL350', label: 'Flight level' }, { value: '225 nm', label: 'Remaining' }]);
  assert.equal(c.action, 'Resume flight');
  assert.equal(c.id, 'a1');
  const low = card(saved({ onGround: false, altFt: 8480, distNm: 31, origin: 'RKPC', dest: 'RKSS' }, 'RKPC–RKSS'));
  assert.equal(low.title, 'En route to Gimpo');
  assert.deepEqual(low.stats, [{ value: '8,500 ft', label: 'Altitude' }, { value: '31 nm', label: 'Remaining' }]);
  // Just under 18,000 ft is still feet; a long leg gets a thousands separator.
  assert.equal(card(saved({ onGround: false, altFt: 17900, distNm: 1234.4, dest: 'RKPC' })).stats[0].value, '17,900 ft');
  assert.equal(card(saved({ onGround: false, altFt: 17900, distNm: 1234.4, dest: 'RKPC' })).stats[1].value, '1,234 nm');
});

test('on the ground: parked at a stand, pushing back, taxiing, on the runway, landed', () => {
  const parked = card(saved({ onGround: true, phase: 'parked', icao: 'RKSS', stand: '12', origin: 'RKSS', dest: 'RKPC' }));
  assert.equal(parked.title, 'At Gimpo, stand 12');
  assert.deepEqual(parked.stats, [{ value: 'RKSS', label: 'From' }, { value: 'RKPC', label: 'To' }]);
  assert.equal(card(saved({ onGround: true, phase: 'parked', icao: 'RKSS', origin: 'RKSS', dest: 'RKPC' })).title, 'At Gimpo');
  assert.equal(card(saved({ onGround: true, phase: 'pushback', icao: 'RKSS', origin: 'RKSS', dest: 'RKPC' })).title, 'Pushing back at Gimpo');
  assert.equal(card(saved({ onGround: true, phase: 'taxi', icao: 'RKSS', origin: 'RKSS', dest: 'RKPC' })).title, 'Taxiing at Gimpo');
  assert.equal(card(saved({ onGround: true, phase: 'departed', icao: 'RKSS', origin: 'RKSS', dest: 'RKPC' })).title, 'On the runway at Gimpo');
  assert.equal(card(saved({ onGround: true, phase: 'none', icao: 'RKSS', origin: 'RKSS', dest: 'RKPC' })).title, 'On the runway at Gimpo');
  // After the landing: on the runway it says so; the gate flow's arrived and taxi-in read as parked and taxiing.
  assert.equal(card(saved({ onGround: true, phase: 'none', icao: 'RKPC', origin: 'RKSS', dest: 'RKPC', landed: true })).title, 'Landed at Jeju');
  assert.equal(card(saved({ onGround: true, phase: 'taxi-in', icao: 'RKPC', origin: 'RKSS', dest: 'RKPC', landed: true })).title, 'Taxiing at Jeju');
  const arrived = card(saved({ onGround: true, phase: 'arrived', icao: 'RKPC', stand: '5', origin: 'RKSS', dest: 'RKPC', landed: true }));
  assert.equal(arrived.title, 'At Jeju, stand 5');
  assert.equal(arrived.action, 'Resume flight');
});

test('not flown yet: the route as the title, Start flight', () => {
  const c = card({ route: 'RKSS–RKPC', where: 'Not flown yet' });
  assert.equal(c.kicker, 'Not flown yet');
  assert.equal(c.title, 'Gimpo to Jeju');
  assert.deepEqual(c.stats, [{ value: 'RKSS', label: 'From' }, { value: 'RKPC', label: 'To' }]);
  assert.equal(c.action, 'Start flight');
  assert.equal(card({ route: 'RKSI 33L → RKPC 07', phase: 'fresh' }).title, 'Incheon to Jeju');
  assert.equal(card({ where: 'Not flown yet' }).title, 'A new flight');
});

test('crashed (never saved today, a crash keeps the last good save): said plainly', () => {
  const c = card(saved({ onGround: true, crashed: true, icao: 'RKPC', origin: 'RKSS', dest: 'RKPC' }));
  assert.equal(c.title, 'Crashed near Jeju');
  assert.equal(card(saved({ onGround: false, crashed: true, origin: 'RKSS', dest: 'RKPC' })).title, 'Crashed');
});

test('older saves (no fields): read from the where and route texts', () => {
  const air = card({ route: 'RKSS–RKPC', where: 'FL350, 120 nm to RKPC' });
  assert.equal(air.title, 'En route to Jeju');
  assert.deepEqual(air.stats, [{ value: 'FL350', label: 'Flight level' }, { value: '120 nm', label: 'Remaining' }]);
  const low = card({ route: 'RKPC 25 → RKSS 32L', where: '4,500 ft, 30 nm to RKSS' });
  assert.equal(low.title, 'En route to Gimpo');
  assert.deepEqual(low.stats, [{ value: '4,500 ft', label: 'Altitude' }, { value: '30 nm', label: 'Remaining' }]);
  // No distance (no destination known when it was saved): the altitude and where it's going.
  assert.deepEqual(card({ route: 'RKSS–RKPC', where: 'FL350' }).stats, [{ value: 'FL350', label: 'Flight level' }, { value: 'RKPC', label: 'To' }]);
  assert.equal(card({ route: 'RKSS 14R → RKPC 07', where: 'Parked at RKPC stand 12' }).title, 'At Jeju, stand 12');
  assert.equal(card({ route: 'RKSS 14R → RKPC 07', where: 'Parked at RKSS' }).title, 'At Gimpo');
  assert.equal(card({ route: 'RKSS 14R → RKPC 07', where: 'Pushing back at RKSS' }).title, 'Pushing back at Gimpo');
  assert.equal(card({ route: 'RKSI 33L → RKPC 07', where: 'Taxiing at RKSI' }).title, 'Taxiing at Incheon');
  assert.equal(card({ route: 'RKPC 07 → RKSS 14R', where: 'On the runway at RKPC' }).title, 'On the runway at Jeju');
  assert.equal(card({ route: 'RKSS 14R → RKPC 07', where: 'On final to RKPC' }).title, 'On final to Jeju');   // Scenario 1, from v0.1.4
  // Text it doesn't know is shown as it is.
  assert.equal(card({ route: 'RKSS 14R → RKPC 07', where: 'On final' }).title, 'On final');
  assert.deepEqual(card({ route: 'RKSS 14R → RKPC 07', where: 'On final' }).stats, [{ value: 'RKSS', label: 'From' }, { value: 'RKPC', label: 'To' }]);
  // Nothing at all.
  const bare = card(undefined);
  assert.equal(bare.title, 'Saved flight');
  assert.deepEqual(bare.stats, []);
  assert.equal(bare.sub, 'Scenario 6 · A321neo');
});

test('the fields win over the text; a summary with an unknown phase falls back to the text', () => {
  const f = readFlight({ route: 'RKSS–RKPC', where: 'FL350, 120 nm to RKPC', phase: 'air', alt: 12000, distNm: 50.4, origin: 'RKSS', dest: 'RKPC' });
  assert.equal(f.alt, 12000);
  assert.equal(f.distNm, 50.4);
  const g = readFlight({ route: 'RKSS–RKPC', where: 'FL350, 120 nm to RKPC', phase: 'hovering' });
  assert.equal(g.phase, 'air');
  assert.equal(g.alt, 35000);
  assert.equal(g.distNm, 120);
});

test('missing names: the code stands in; the design or the type; a place lookup that throws', () => {
  const c = flightCard(entry(saved({ onGround: false, altFt: 30000, distNm: 80, origin: 'RKSS', dest: 'ZZZZ' }, 'RKSS–ZZZZ')), { place });
  assert.equal(c.title, 'En route to ZZZZ');
  assert.equal(flightCard(entry({ route: 'RKSS–RKPC', where: 'Taxiing at RKSS' })).title, 'Taxiing at RKSS', 'no lookup at all');
  assert.equal(flightCard(entry({ route: 'RKSS–RKPC', where: 'Taxiing at RKSS' }), { place: () => { throw new Error('x'); } }).title, 'Taxiing at RKSS');
  assert.equal(card({ route: 'RKSS–RKPC', where: 'FL350', design: 'Longer legs', designId: 'd1' }).sub, 'Scenario 6 · Longer legs');
  assert.equal(card({ route: 'RKSS–RKPC', where: 'FL350' }, { place }, { type: 'b777-300er' }).sub, 'Scenario 6 · 777-300ER');
  assert.equal(card({ route: 'RKSS–RKPC', where: 'FL350' }, { place }, { type: undefined }).sub, 'Scenario 6 · A321neo', 'no type: the A321neo, as the Load list');
  assert.equal(card({ route: 'RKSS–RKPC', where: 'FL350' }, { place }, { name: '' }).sub, 'A321neo');
  assert.equal(flightCard(null), null);
  assert.equal(flightCard({ name: 'no id' }), null);
});

test('the texts it reads', () => {
  assert.deepEqual(parseWhere('Parked at RKSI stand 511-2'), { phase: 'parked', at: 'RKSI', stand: '511-2' });
  assert.deepEqual(parseWhere('FL410, 1,040 nm to RJTT'), { phase: 'air', alt: 41000, distNm: 1040, dest: 'RJTT' });
  assert.deepEqual(parseWhere('12,300 ft'), { phase: 'air', alt: 12300, distNm: null, dest: null });
  assert.deepEqual(parseWhere(''), { phase: null });
  assert.deepEqual(parseRoute('RKSS–RKPC'), { origin: 'RKSS', dest: 'RKPC' });
  assert.deepEqual(parseRoute('RKSS 14R → RKPC 07'), { origin: 'RKSS', dest: 'RKPC' });
  assert.deepEqual(parseRoute(''), { origin: null, dest: null });
  assert.equal(altText(35020), 'FL350');
  assert.equal(altText(8480), '8,500 ft');
  assert.equal(altText(-20), '0 ft');
});

test('place names from the airports\' data', () => {
  assert.equal(shortPlace('Jeju International Airport'), 'Jeju');
  assert.equal(shortPlace('Seoul Gimpo International Airport'), 'Gimpo');
  assert.equal(shortPlace('Incheon International Airport'), 'Incheon');
  assert.equal(shortPlace('Gimpo International'), 'Gimpo');   // the built-in fallback's names
  // v0.6.0's kind of names
  assert.equal(shortPlace('Tokyo Haneda International Airport'), 'Haneda');
  assert.equal(shortPlace('Hong Kong International Airport'), 'Hong Kong');
  assert.equal(shortPlace('New Chitose Airport'), 'New Chitose');
  assert.equal(shortPlace('Osaka International Airport (Itami)'), 'Osaka');
  assert.equal(shortPlace('Beijing Capital International Airport'), 'Beijing Capital');
  assert.equal(shortPlace(''), null);
  assert.equal(shortPlace(undefined), null);
});

test('flightFields: the gate flow\'s phases folded as whereText folds them', () => {
  assert.deepEqual(flightFields({ onGround: false, altFt: 35012.4, distNm: 120.44, origin: 'RKSS', dest: 'RKPC', icao: 'RKSS', phase: 'departed' }),
    { phase: 'air', origin: 'RKSS', dest: 'RKPC', alt: 35012, distNm: 120.4 });
  assert.deepEqual(flightFields({ onGround: true, phase: 'parked', icao: 'RKSS', stand: 7, origin: 'RKSS', dest: 'RKPC', altFt: 50 }),
    { phase: 'parked', origin: 'RKSS', dest: 'RKPC', at: 'RKSS', stand: '7' });
  assert.equal(flightFields({ onGround: true, phase: 'arrived' }).phase, 'parked');
  assert.equal(flightFields({ onGround: true, phase: 'taxi-in' }).phase, 'taxi');
  assert.equal(flightFields({ onGround: true, phase: 'pushback' }).phase, 'pushback');
  assert.equal(flightFields({ onGround: true, phase: 'departed' }).phase, 'runway');
  assert.equal(flightFields({ onGround: true }).phase, 'runway');
  assert.equal(flightFields({ onGround: true, phase: 'taxi', stand: '3' }).stand, undefined, 'a stand only when parked');
  assert.equal(flightFields({ onGround: false, altFt: 9000, distNm: 12 }).distNm, undefined, 'no destination, no distance');
  assert.equal(flightFields({ onGround: true, landed: true }).landed, true);
  assert.equal(flightFields({ onGround: true, crashed: true, icao: 'RKPC' }).phase, 'crashed');
});

// A Storage-like Map.
function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}

test('the store keeps the fields: create, write (the new summary\'s only), duplicate', () => {
  const s = new ScenarioStore(mem());
  const air = saved({ onGround: false, altFt: 35000, distNm: 225, origin: 'RKSS', dest: 'RKPC' });
  const c = s.create('Scenario 6', { v: 1 }, air, { now: 1000 });
  assert.deepEqual(c.entry.summary, { route: 'RKSS–RKPC', where: 'FL350, 225 nm to RKPC', phase: 'air', origin: 'RKSS', dest: 'RKPC', alt: 35000, distNm: 225 });
  // Parked: the air's fields go (the new summary's fields only), the texts come with it.
  s.write(c.id, { v: 1 }, saved({ onGround: true, phase: 'arrived', icao: 'RKPC', stand: '5', origin: 'RKSS', dest: 'RKPC', landed: true }), 2000);
  assert.deepEqual(s.entry(c.id).summary, { route: 'RKSS–RKPC', where: 'Parked at RKPC stand 5', phase: 'parked', origin: 'RKSS', dest: 'RKPC', at: 'RKPC', stand: '5', landed: true });
  // A summary with only texts (an older caller): no fields, and the card reads the text.
  s.write(c.id, { v: 1 }, { route: 'RKSS–RKPC', where: 'Taxiing at RKPC' }, 3000);
  assert.deepEqual(s.entry(c.id).summary, { route: 'RKSS–RKPC', where: 'Taxiing at RKPC' });
  assert.equal(flightCard(s.entry(c.id), { place }).title, 'Taxiing at Jeju');
  // Junk is dropped: a phase it doesn't know, numbers that aren't.
  const j = s.create('Junk', { v: 1 }, { route: 'r', where: 'w', phase: 'warp', alt: 5 }, { now: 4000 });
  assert.deepEqual(j.entry.summary, { route: 'r', where: 'w' });
  const k = s.create('Junk 2', { v: 1 }, { route: 'r', where: 'w', phase: 'air', alt: 'high', distNm: NaN, landed: 'yes' }, { now: 5000 });
  assert.deepEqual(k.entry.summary, { route: 'r', where: 'w', phase: 'air' });
  // Duplicate carries them.
  s.write(c.id, { v: 1 }, air, 6000);
  const d = s.duplicate(c.id, { now: 7000 });
  assert.deepEqual(d.entry.summary, s.entry(c.id).summary);
  assert.equal(flightCard(s.newest(), { place }).title, 'En route to Jeju');
});
