// v0.5.0: the warehouse's designs, kept in the browser's localStorage as one JSON list under
// "gamedump:flight-sim:designs" (newest first). Each entry is a whole design (src/sim/designs.js's shape),
// normalized on the way in and on the way out, so a hand-edited or older entry can't fly out of range.
// Pure logic over a Storage-like object (getItem / setItem), so the tests can use a Map; every access is
// wrapped, and a refused write (storage full or blocked) leaves the list as it was.
//
//   const store = new DesignStore(localStorage)      or designStore() (null-safe: no storage, an empty store)
//   store.list()                 → [design] newest first (malformed entries dropped)
//   store.get(id)                → design | null
//   store.save(d)                → { ok, design } | { ok: false, error: 'quota' }  (replaces by id in place, else adds at the top)
//   store.draft(base)            → a new design (not saved) with a free id and name ("My A321neo", "My A321neo 2" …)
//   store.create(base, extra?)   → save(draft(base) + extra)
//   store.duplicate(id)          → { ok, design } named "Name (copy)" (scenarios.js's copyName) | { ok: false, error: 'missing' | 'quota' }
//   store.rename(id, name)       → { ok, design } | { ok: false, error: 'name' | 'missing' | 'quota' }
//   store.remove(id)             → true if it was there and the list was rewritten without it
//   onDesignRename(fn)           → off()   v0.5.4: fn(id, name, store) after a saved design's name changes (rename(), or
//                                          a save() of it under a new name: the editor's name then Save)
//   store.names()                → Map id → name (v0.5.8; read again only when the stored list changes)
//   store.nameOf(id, fallback?)  → the design's name now, by its id; `fallback` (the name a scenario, a log entry or a
//                                  saved copy carries) only when no stored design has that id (deleted, or storage off)
//   designName(id, fallback?)    → the same, from the page's store
//
// v0.5.8 (Shane: "when I change the name in the warehouse, all appearances of that name in the game should
// automatically update"): a design's name is a live reference. Everything that shows one (the home page's card, Load
// scenario, the logbook, the setup's cards, the flight's saves and log entries) asks designName() by the design's id
// at the moment it's shown, and the name stored beside the id is only what shows once the design is deleted.

import { normalizeDesign, newDesign, isDesign } from './sim/designs.js';
import { TYPES } from './sim/types.js';
import { cleanName, nameOk, copyName, newId } from './scenarios.js';

export const DESIGNS_KEY = 'gamedump:flight-sim:designs';

// v0.5.4: told when a saved design is renamed, whichever store did it (the warehouse makes its own); menu.js
// passes it on to the scenarios that fly it (scenarios.js's renameDesign). A listener that throws is skipped.
const renameListeners = new Set();
export function onDesignRename(fn) {
  if (typeof fn !== 'function') return () => {};
  renameListeners.add(fn);
  return () => { renameListeners.delete(fn); };
}
function told(id, name, store) {
  for (const fn of [...renameListeners]) { try { fn(id, name, store); } catch (err) { console.error(err); } }
}
let namesMemo = { raw: undefined, names: new Map() };   // v0.5.8: names()'s, by the stored text

export class DesignStore {
  constructor(storage) { this.s = storage || null; }

  raw() { try { return this.s ? this.s.getItem(DESIGNS_KEY) : null; } catch { return null; } }
  put(list) { try { if (!this.s) return false; this.s.setItem(DESIGNS_KEY, JSON.stringify(list)); return true; } catch { return false; } }

  // The stored list, normalized; anything that isn't a design (or repeats an id) is dropped.
  list(raw = this.raw()) {
    let a;
    try { a = JSON.parse(raw || '[]'); } catch { a = []; }
    if (!Array.isArray(a)) return [];
    const seen = new Set(), out = [];
    for (const d of a) {
      if (!isDesign(d) || typeof d.id !== 'string' || !d.id || seen.has(d.id)) continue;
      seen.add(d.id);
      out.push(normalizeDesign(d));
    }
    return out;
  }
  get(id) { return this.list().find((d) => d.id === id) || null; }

  // v0.5.8: the names by id, as list() normalizes them. A pure function of the stored text, so it's kept while that
  // text stays the same (any store's: the same text gives the same names), and a list of rows asks it cheaply.
  names() {
    const raw = this.raw();
    if (raw !== namesMemo.raw) namesMemo = { raw, names: new Map(this.list(raw).map((d) => [d.id, d.name])) };
    return namesMemo.names;
  }
  nameOf(id, fallback = null) {
    const n = id != null && id !== '' ? this.names().get(String(id)) : undefined;
    return n ?? (fallback == null || fallback === '' ? null : String(fallback));
  }

  save(design) {
    const d = normalizeDesign(design);
    const list = this.list(), i = list.findIndex((e) => e.id === d.id);
    const was = i >= 0 ? list[i].name : null;   // v0.5.4: a new name for a saved design is a rename
    if (i >= 0) list[i] = d; else list.unshift(d);
    if (!this.put(list)) return { ok: false, error: 'quota' };
    if (was != null && was !== d.name) told(d.id, d.name, this);
    return { ok: true, design: d };
  }

  freeId() {
    const ids = new Set(this.list().map((d) => d.id));
    let id;
    do id = 'd' + newId(); while (ids.has(id));
    return id;
  }
  freeName(base) {
    const names = new Set(this.list().map((d) => d.name));
    const stem = `My ${(TYPES[base] || TYPES.a321neo).name}`;
    if (!names.has(stem)) return stem;
    let n = 2;
    while (names.has(`${stem} ${n}`)) n++;
    return `${stem} ${n}`;
  }
  draft(base = 'a321neo') {
    const b = TYPES[base] ? base : 'a321neo';
    return newDesign(b, { id: this.freeId(), name: this.freeName(b) });
  }
  create(base, extra = {}) { const d = this.draft(base); return this.save({ ...d, ...extra, base: d.base, id: d.id }); }

  duplicate(id) {
    const d = this.get(id);
    if (!d) return { ok: false, error: 'missing' };
    const taken = new Set(this.list().map((e) => e.name));
    const copy = { ...d, id: this.freeId(), name: copyName(d.name, taken) };
    return this.save(copy);
  }

  rename(id, name) {
    if (!nameOk(name)) return { ok: false, error: 'name' };
    const d = this.get(id);
    if (!d) return { ok: false, error: 'missing' };
    return this.save({ ...d, name: cleanName(name) });
  }

  remove(id) {
    const list = this.list();
    if (!list.some((d) => d.id === id)) return false;
    return this.put(list.filter((d) => d.id !== id));
  }
}

// The page's store: localStorage, or an empty one where storage is off.
export function designStore() {
  let s = null;
  try { s = globalThis.localStorage || null; } catch { s = null; }
  return new DesignStore(s);
}

// v0.5.8: a design's name now, from the page's store (see the header): the stored design's with id `id`, else
// `fallback`, else null.
export const designName = (id, fallback = null) => designStore().nameOf(id, fallback);
