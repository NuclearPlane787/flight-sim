// Scenarios: save slots with the whole state, kept in the browser's localStorage
// under "gamedump:flight-sim:" (v0.2.0). Modelled on Satisfactory's src/saves.js:
// an index lists every scenario (name, times, a short summary) so the menu can show
// them without reading each one, and each scenario's record has its own key.
// Pure logic over a Storage-like object (getItem / setItem / removeItem), so the
// tests can use a Map. Every storage access is wrapped: storage can be blocked or
// full, and the game goes on without it.

import { TYPES, DEFAULT_TYPE } from './sim/types.js';

export const PREFIX = 'gamedump:flight-sim:';
export const INDEX_KEY = PREFIX + 'scenarios';     // [{ id, name, created, savedAt, type, summary: { route, where }, legacy? }]
export const SCEN_PREFIX = PREFIX + 'scenario:';   // + id → { v: 1, id, name, savedAt, state }
export const LASTFLIGHT_KEY = PREFIX + 'lastflight'; // v0.1.x's last plan (read, never changed)
export const LOGBOOK_KEY = PREFIX + 'logbook';       // the one logbook (read, never changed here)

// A scenario's name, as Satisfactory's: control characters dropped, runs of spaces
// made one, the ends trimmed; NAME_MIN to NAME_MAX characters.
export const NAME_MIN = 3, NAME_MAX = 40;
export const cleanName = (name) => String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
export const nameOk = (name) => cleanName(name).length >= NAME_MIN;

// v0.1.x's default flight, for a player who has a logbook but no lastflight.
export const DEFAULT_PLAN = { origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'runway', pax: 190, cargoKg: 1500, fuelKg: 4000, waypoints: [] };

// A scenario keeps its aircraft (v0.3.0). The index entry says which, so the menu can show it without
// reading the record: from the summary if it carries one, else from the state's plan. Saves from before
// v0.3.0 have neither, and read as the A321neo.
const typeFrom = (summary, state) => summary?.type || state?.plan?.type || null;

// A type's name for the screens. No id: the A321neo. An id the registry doesn't know: the id itself,
// rather than a wrong name.
export const typeName = (id) => TYPES[id || DEFAULT_TYPE]?.name ?? String(id);

// Short, unique, url-safe: base36 time plus six random base36 characters (four collided ~7% of
// the time across 500 ids made in one millisecond, in the test).
let lastId = '';
export function newId(now = Date.now()) {
  let id;
  do id = now.toString(36) + Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0');
  while (id === lastId);
  lastId = id;
  return id;
}

// 15:00 KST (UTC+9, no summer time) on the KST day that holds `now`, as epoch ms.
export function afternoonKst(now = Date.now()) {
  const k = new Date(now + 9 * 3600e3);
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), 15 - 9);
}

export class ScenarioStore {
  // storage: anything with getItem / setItem / removeItem (localStorage)
  constructor(storage) { this.s = storage; }

  // Raw access. raw() → string or null; put() → true, or false if storage refused.
  raw(k) { try { return this.s.getItem(k); } catch { return null; } }
  read(k, fb) { const v = this.raw(k); if (v == null) return fb; try { return JSON.parse(v); } catch { return fb; } }
  put(k, v) { try { this.s.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); return true; } catch { return false; } }
  drop(k) { try { this.s.removeItem(k); } catch { /* blocked: nothing to remove */ } }
  // Put back what a key held before a failed two-step write (null: it held nothing).
  undo(k, old) { if (old == null) this.drop(k); else this.put(k, old); }

  // The index in its stored order, dropping anything malformed; an entry without a type is the A321neo.
  index() {
    const idx = this.read(INDEX_KEY, []);
    return (Array.isArray(idx) ? idx : []).filter((e) => e && typeof e.id === 'string').map((e) => (e.type ? e : { ...e, type: DEFAULT_TYPE }));
  }

  // Newest savedAt first.
  list() { return this.index().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)); }
  newest() { return this.list()[0] || null; }
  entry(id) { return this.index().find((e) => e.id === id) || null; }
  get(id) { const r = this.read(SCEN_PREFIX + id, null); return r && typeof r === 'object' ? r : null; }

  // "Scenario N", the lowest N not taken.
  defaultName() {
    const names = new Set(this.index().map((e) => e.name));
    let n = 1;
    while (names.has(`Scenario ${n}`)) n++;
    return `Scenario ${n}`;
  }

  // A new scenario with its first state. Duplicate names are allowed (as in
  // Satisfactory). → { ok, id, entry } or { ok: false, error: 'name' | 'quota' }.
  create(name, state, summary = {}, { now = Date.now(), legacy = false } = {}) {
    const clean = cleanName(name);
    if (clean.length < NAME_MIN) return { ok: false, error: 'name' };
    const idx = this.index();
    let id = newId(now);
    while (idx.some((e) => e.id === id)) id = newId(now);
    const entry = { id, name: clean, created: now, savedAt: now, type: typeFrom(summary, state) || DEFAULT_TYPE, summary: { route: summary.route || '', where: summary.where || '' } };
    if (legacy) entry.legacy = true;
    // The record first, then the index; if the index is refused, take the record back.
    if (!this.put(SCEN_PREFIX + id, { v: 1, id, name: clean, savedAt: now, state })) return { ok: false, error: 'quota' };
    if (!this.put(INDEX_KEY, [entry, ...idx])) { this.drop(SCEN_PREFIX + id); return { ok: false, error: 'quota' }; }
    return { ok: true, id, entry };
  }

  // Save a scenario's state (autosave, Save). A refused write leaves the index and
  // the previous record as they were. → { ok } or { ok: false, error: 'missing' | 'quota' }.
  write(id, state, summary, now = Date.now()) {
    const idx = this.index();
    const i = idx.findIndex((e) => e.id === id);
    if (i < 0) return { ok: false, error: 'missing' };
    const e = idx[i], k = SCEN_PREFIX + id, old = this.raw(k);
    if (!this.put(k, { v: 1, id, name: e.name, savedAt: now, state })) { this.undo(k, old); return { ok: false, error: 'quota' }; }
    idx[i] = { ...e, savedAt: now, type: typeFrom(summary, state) || e.type, summary: summary ? { route: summary.route ?? e.summary?.route ?? '', where: summary.where ?? e.summary?.where ?? '' } : e.summary };
    if (!this.put(INDEX_KEY, idx)) { this.undo(k, old); return { ok: false, error: 'quota' }; }
    return { ok: true };
  }

  // Rename (Load scenario → Rename). savedAt stays, so the list keeps its order.
  // → { ok } or { ok: false, error: 'name' | 'missing' | 'quota' }.
  rename(id, name) {
    const clean = cleanName(name);
    if (clean.length < NAME_MIN) return { ok: false, error: 'name' };
    const idx = this.index();
    const i = idx.findIndex((e) => e.id === id);
    if (i < 0) return { ok: false, error: 'missing' };
    const k = SCEN_PREFIX + id, old = this.raw(k), rec = this.get(id);
    // The record carries the name too; it's small to rewrite only if present.
    if (rec && !this.put(k, { ...rec, name: clean })) { this.undo(k, old); return { ok: false, error: 'quota' }; }
    idx[i] = { ...idx[i], name: clean };
    if (!this.put(INDEX_KEY, idx)) { this.undo(k, old); return { ok: false, error: 'quota' }; }
    return { ok: true };
  }

  // Delete a scenario (its logbook entries stay, under the name they carry).
  // → true if it was in the index and the index was rewritten without it.
  remove(id) {
    const idx = this.index();
    if (!idx.some((e) => e.id === id)) return false;
    if (!this.put(INDEX_KEY, idx.filter((e) => e.id !== id))) return false;
    this.drop(SCEN_PREFIX + id);
    return true;
  }

  // From v0.1.4: with no index yet (never written) and a lastflight, or a logbook,
  // make "Scenario 1" (legacy: true), starting fresh at its route's start, so the
  // old flights have a home. Writes the index either way (maybe []), so this runs
  // once only, even after Scenario 1 is deleted. Never deletes or rewrites
  // lastflight, logbook or settings. → the new entry, or null.
  migrate(now = Date.now()) {
    if (this.raw(INDEX_KEY) != null) return null;
    const last = this.read(LASTFLIGHT_KEY, null);
    const hasLog = this.raw(LOGBOOK_KEY) != null;
    if ((!last || typeof last !== 'object') && !hasLog) { this.put(INDEX_KEY, []); return null; }
    const plan = last && typeof last === 'object' ? last : { ...DEFAULT_PLAN, waypoints: [] };
    const state = { v: 1, fresh: true, plan, clock: { ms: afternoonKst(now), running: true, speed: 1 } };
    const where = plan.start === 'gate' ? whereText({ onGround: true, phase: 'parked', icao: plan.origin, stand: plan.stand })
      : plan.start === 'final' ? `On final to ${plan.dest}` : whereText({ onGround: true, icao: plan.origin });
    const r = this.create('Scenario 1', state, { route: routeText(plan), where }, { now, legacy: true });
    if (!r.ok) { this.put(INDEX_KEY, []); return null; }
    return r.entry;
  }

  // Characters held under our keys (index + records); JS strings are UTF-16, so
  // the bytes are about twice this. For a check against the origin's ~5 MB.
  approxBytes() {
    let n = 0;
    const add = (k) => { const v = this.raw(k); if (v != null) n += k.length + v.length; };
    add(INDEX_KEY);
    for (const e of this.index()) add(SCEN_PREFIX + e.id);
    return n;
  }
}

// The same, as a function: migrate(localStorage).
export const migrate = (storage, now) => new ScenarioStore(storage).migrate(now);

// The id of the scenario made from v0.1.4's keys (Scenario 1), or null.
export const legacyId = (list) => (list || []).find((e) => e && e.legacy)?.id ?? null;

// "RKSS 14R → RKPC 07"
export function routeText(plan) {
  if (!plan) return '';
  const a = [plan.origin, plan.depRunway].filter(Boolean).join(' ');
  const b = [plan.dest, plan.arrRunway].filter(Boolean).join(' ');
  return `${a} → ${b}`;
}

// Where the aircraft is, for Continue and Load scenario:
// "FL350, 120 nm to RKPC", "4,500 ft, 30 nm to RKPC", "Parked at RKPC stand 12",
// "Taxiing at RKSS", "Pushing back at RKSS", "On the runway at RKSS".
// (Crashed states are never saved, so there's no wording for one.)
export function whereText({ onGround, altFt, distNm, destIcao, phase, icao, stand } = {}) {
  if (onGround) {
    const at = icao || '';
    if (phase === 'parked' || phase === 'arrived') return stand != null && stand !== '' ? `Parked at ${at} stand ${stand}` : `Parked at ${at}`;
    if (phase === 'pushback') return `Pushing back at ${at}`;
    if (phase === 'taxi' || phase === 'taxi-in') return `Taxiing at ${at}`;
    return `On the runway at ${at}`;
  }
  const ft = Math.max(0, Number(altFt) || 0);
  const alt = ft >= 18000 ? `FL${Math.round(ft / 1000) * 10}` : `${(Math.round(ft / 100) * 100).toLocaleString('en-US')} ft`;
  return Number.isFinite(distNm) && destIcao ? `${alt}, ${Math.round(distNm)} nm to ${destIcao}` : alt;
}

// When it was saved, in local time: "just now", "5 min ago", "Sun 1 Nov 14:05".
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function savedText(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '—';
  const dt = (now - ms) / 1000;
  if (dt < 60) return 'just now';
  if (dt < 3600) return `${Math.floor(dt / 60)} min ago`;
  const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
