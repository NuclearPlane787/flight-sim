// The keys. v0.5.6 (Shane, 2026-11-18: "A keybindings selection per plane instead of general rule ... you can give each
// engine or two their own keybinding for powering up and down"; then "Move the keybinding settings thing to the
// warehouse ... similar to Besiege") gave each aircraft its parts' keys. v0.5.7 (Shane's decisions, final): a block of
// 16 keys under the right hand is the warehouse's, each aircraft's own; every other key is the Controls page's, the same
// for every aircraft.
//
// - The block: 7 8 9 0 / U I O P / J K L ; / M , . /, and Shift with any of them. Only the warehouse sets block keys,
//   and the warehouse sets only block keys: each engine its own thrust up and down (held: the plain key), a wing tank
//   the aircraft's Drop (an action: the key or Shift+ it). Engines start with none. A design's are stored by the
//   engine's part id (sim/designs.js: each mirror twin is its own part), a stock type's by engine index.
// - The Controls page: BINDINGS, every other control (the sticks, rudder, trim, thrust for all the engines, flaps,
//   spoilers, gear, brakes, the autopilot, the views, time, the map, pushback, rewind, QNH, the readout).
// - Keys that do nothing on their own and can't be bound: ` Tab Caps Lock Return delete (Backspace, Delete) and both
//   Shifts; Esc (the menu), \ (the Sky window, fixed; Cmd/Ctrl+L opens it too), the modifiers, F5, F11 and F12, and
//   anything with Ctrl, Cmd or Alt (the game's standing rule: Ctrl+W closes the tab).
//
// A key is a "chord": its e.code, or 'Shift+' and the code for a tap (Shift+C arms the ground spoilers). Held controls
// take plain keys only, and read their key with or without Shift. A key does one thing: binding a key another control
// has (on the Controls page), or that another part of the same aircraft has (in the warehouse), moves it, and the one
// that lost it says so. Only what differs from the defaults is stored, under one key (`gamedump:flight-sim:keys`):
//   { v: 3, global: { bind: { map: ['KeyM'] } },
//     aircraft: { 'type:a321neo': { engines: { '0': { up: 'KeyU', down: 'KeyJ' } } },
//                 'design:<id>': { engines: { p3: { up: 'KeyI', down: 'KeyK' } }, drop: 'Shift+KeyP' } } }
// v0.5.6's stores (v: 2, { global, scopes }, and its first shape, v: 1) read as this one: the global changes that are
// still valid stay (not a block key, not reserved); the per-aircraft part keys and engine groups are dropped.

export const KEYS_STORE = 'gamedump:flight-sim:keys';

// ---- the warehouse's block ----
export const BLOCK = ['Digit7', 'Digit8', 'Digit9', 'Digit0', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon',
  'KeyM', 'Comma', 'Period', 'Slash'];
const BLOCK_SET = new Set(BLOCK);
export const BLOCK_TEXT = '7–0, U–P, J–; and M–/';
const plainOf = (c) => String(c).replace(/^Shift\+/, '');
// A block key, or Shift with one.
export const isBlockKey = (chord) => !!chord && BLOCK_SET.has(plainOf(chord));
export const BLOCK_ONLY = `Only the block’s keys here: ${BLOCK_TEXT}`;

// ---- the Controls page's keys ----
// kind: 'held' (read while down: the sticks, the levers, the brakes) or 'action' (once per press). section: the
// Controls page's. family: the 787 and 777 only ('boeing'). short: how a note names it.
// Shane's rule of thumb for the defaults: keys you press more than once per flight in the air shouldn't need Shift;
// rare ones, about once per flight (TO/GA, the local QNH, pushback, arming the ground spoilers), may.
export const SECTIONS = [
  { id: 'fly', title: 'Flying' },
  { id: 'thrust', title: 'Thrust' },
  { id: 'wing', title: 'Flaps and spoilers' },
  { id: 'ground', title: 'Gear and brakes' },
  { id: 'auto', title: 'Autopilot and autothrust' },
  { id: 'views', title: 'Views' },
  { id: 'time', title: 'Time and the rest' },
];
export const BINDINGS = [
  { id: 'pitchDown', section: 'fly', kind: 'held', label: 'Pitch down (elevator)', short: 'pitch down', keys: ['KeyW'] },
  { id: 'pitchUp', section: 'fly', kind: 'held', label: 'Pitch up (elevator)', short: 'pitch up', keys: ['KeyS'] },
  { id: 'rollLeft', section: 'fly', kind: 'held', label: 'Roll left (ailerons)', short: 'roll left', keys: ['KeyA'] },
  { id: 'rollRight', section: 'fly', kind: 'held', label: 'Roll right (ailerons)', short: 'roll right', keys: ['KeyD'] },
  { id: 'yawLeft', section: 'fly', kind: 'held', label: 'Rudder left (and nose wheel)', short: 'rudder left', keys: ['KeyQ'] },
  { id: 'yawRight', section: 'fly', kind: 'held', label: 'Rudder right (and nose wheel)', short: 'rudder right', keys: ['KeyE'] },
  { id: 'trimDown', section: 'fly', kind: 'held', label: 'Trim nose down (the 787 and 777; with auto-trim: the path down)', short: 'trim nose down', keys: ['KeyY'], family: 'boeing' },
  { id: 'trimUp', section: 'fly', kind: 'held', label: 'Trim nose up (the 787 and 777; with auto-trim: the path up)', short: 'trim nose up', keys: ['KeyH'], family: 'boeing' },
  { id: 'thrustUp', section: 'thrust', kind: 'held', label: 'Thrust levers up (all engines)', short: 'thrust up (all engines)', keys: ['KeyR'] },
  { id: 'thrustDown', section: 'thrust', kind: 'held', label: 'Thrust levers down (all; hold at idle on the ground: reverse)', short: 'thrust down (all engines)', keys: ['KeyF'] },
  { id: 'flapUp', section: 'wing', kind: 'action', label: 'Flaps up a step', short: 'flaps up a step', keys: ['Minus'] },
  { id: 'flapDown', section: 'wing', kind: 'action', label: 'Flaps down a step', short: 'flaps down a step', keys: ['Equal'] },
  { id: 'flap0', section: 'wing', kind: 'action', label: 'Flaps to 0 (the Boeings: UP)', short: 'flaps to 0', keys: [], flap: 0 },
  { id: 'flap1', section: 'wing', kind: 'action', label: 'Flaps to 1 (the Boeings: 5)', short: 'flaps to 1', keys: [], flap: 1 },
  { id: 'flap2', section: 'wing', kind: 'action', label: 'Flaps to 2 (the Boeings: 15)', short: 'flaps to 2', keys: [], flap: 2 },
  { id: 'flap3', section: 'wing', kind: 'action', label: 'Flaps to 3 (the Boeings: 20)', short: 'flaps to 3', keys: [], flap: 3 },
  { id: 'flap4', section: 'wing', kind: 'action', label: 'Flaps to FULL (the Boeings: 30)', short: 'flaps to FULL', keys: [], flap: 4 },
  { id: 'speedbrake', section: 'wing', kind: 'action', label: 'Speed brakes', short: 'the speed brakes', keys: ['KeyC'] },
  { id: 'spoilersArm', section: 'wing', kind: 'action', label: 'Arm the ground spoilers', short: 'arming the ground spoilers', tip: 'arm the ground spoilers', keys: ['Shift+KeyC'] },
  { id: 'gear', section: 'ground', kind: 'action', label: 'Gear up or down', short: 'the gear', keys: ['KeyG'] },
  { id: 'brakes', section: 'ground', kind: 'held', label: 'Wheel brakes (hold)', short: 'the wheel brakes', keys: ['Space'] },
  { id: 'parkingBrake', section: 'ground', kind: 'action', label: 'Parking brake', short: 'the parking brake', keys: ['KeyB'] },
  { id: 'ap', section: 'auto', kind: 'action', label: 'Autopilot', short: 'the autopilot', keys: ['KeyZ'] },
  { id: 'athr', section: 'auto', kind: 'action', label: 'Autothrust', short: 'the autothrust', keys: ['KeyX'] },
  { id: 'toga', section: 'auto', kind: 'action', label: 'TO/GA switches (the 787 and 777)', short: 'the TO/GA switches', keys: ['Shift+KeyT'] },
  { id: 'localQnh', section: 'auto', kind: 'action', label: 'Altimeter to the local QNH', short: 'the local QNH', keys: ['Shift+KeyB'] },
  { id: 'viewCockpit', section: 'views', kind: 'action', label: 'Cockpit (again: the other seat)', short: 'the cockpit view', keys: ['Digit1'] },
  { id: 'viewNose', section: 'views', kind: 'action', label: 'Nose', short: 'the nose view', keys: ['Digit2'] },
  { id: 'viewOrbit', section: 'views', kind: 'action', label: 'Outside (3rd person)', short: 'the outside view', keys: ['Digit3'] },
  { id: 'view', section: 'views', kind: 'action', label: 'Next view', short: 'the next view', keys: ['KeyV'] },
  { id: 'faster', section: 'time', kind: 'action', label: 'Time faster', short: 'time faster', keys: ['BracketRight', 'NumpadAdd'] },
  { id: 'slower', section: 'time', kind: 'action', label: 'Time slower', short: 'time slower', keys: ['BracketLeft', 'NumpadSubtract'] },
  { id: 'rewind', section: 'time', kind: 'action', label: 'Rewind 30 s (paused, crashed or with the menu open)', short: 'rewind', keys: ['KeyT'] },
  { id: 'map', section: 'time', kind: 'action', label: 'Map', short: 'the map', keys: ['KeyN'] },
  { id: 'pushback', section: 'time', kind: 'action', label: 'Pushback start or stop', short: 'the pushback', keys: ['Shift+KeyG'] },
  { id: 'perf', section: 'time', kind: 'action', label: 'Performance readout', short: 'the performance readout', keys: ['F3'] },
  // v0.7.4 (Shane's item 12): the left panel's SILENCE button's key: ' (free, outside the block, no Shift).
  { id: 'silenceWarnings', section: 'time', kind: 'action', label: 'Silence the warnings sounding now (the PFD’s SILENCE button)', short: 'silencing the warnings', keys: ['Quote'] },
];
const BY_ID = new Map(BINDINGS.map((b) => [b.id, b]));
export const bindingOf = (id) => BY_ID.get(id) || null;
export const GLOBAL_BINDINGS = BINDINGS;   // v0.5.6's name: every binding is the Controls page's now
// The block's controls, each aircraft's own (the warehouse), as a note names them.
export const AIRCRAFT_CONTROLS = {
  engine: { label: 'Its own thrust (up and down)', short: 'thrust' },
  dropTanks: { label: 'Drop the wing tanks (in the air)', short: 'dropping the wing tanks' },
};

// ---- keys nothing can take ----
// The menu, the Sky window, the keys that do nothing on their own (Shane: "Grey out the ` tab caps return delete and
// the two shift keys, since their single shouldn't result in anything"), and the browser's.
export const RESERVED = new Map([
  ['Escape', 'Esc opens the menu'],
  ['Backslash', '\\ opens the Sky window'],
  ['Backquote', '` does nothing on its own: it can’t be a key'],
  ['Tab', 'Tab does nothing on its own (it moves between buttons): it can’t be a key'],
  ['CapsLock', 'Caps Lock does nothing on its own: it can’t be a key'],
  ['Enter', 'Return does nothing on its own: it can’t be a key'],
  ['Backspace', 'Delete does nothing on its own: it can’t be a key'],
  ['Delete', 'Delete does nothing on its own: it can’t be a key'],
  ['F5', 'F5 reloads the page'], ['F11', 'F11 is the browser’s full screen'], ['F12', 'F12 is the browser’s tools'],
]);
// The keys that do nothing on their own (the Controls page's drawing greys them).
export const DEAD_KEYS = ['Backquote', 'Tab', 'CapsLock', 'Enter', 'Backspace', 'ShiftLeft', 'ShiftRight'];
const MODIFIERS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'Fn', 'FnLock', 'ContextMenu', 'OSLeft', 'OSRight']);
// A modifier pressed on its own (a capture waits for the key with it: Shift, then C).
export const isModifier = (code) => MODIFIERS.has(code);

// A key as printed: 'Shift+KeyC' → 'Shift+C'.
const NAMED = {
  Minus: '−', Equal: '=', BracketLeft: '[', BracketRight: ']', Backquote: '`', Backslash: '\\', Semicolon: ';',
  Quote: '\'', Comma: ',', Period: '.', Slash: '/', Space: 'Space', Enter: 'Return', Backspace: 'Delete',
  Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', IntlBackslash: '§', Tab: 'Tab', CapsLock: 'Caps Lock',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadMultiply: 'Num ×', NumpadDivide: 'Num ÷',
  NumpadDecimal: 'Num .', NumpadEnter: 'Num Enter', NumpadEqual: 'Num =',
};
export function keyLabel(chord) {
  if (!chord) return '';
  if (chord.startsWith('Shift+')) return 'Shift+' + keyLabel(chord.slice(6));
  let m;
  if ((m = /^Key([A-Z])$/.exec(chord))) return m[1];
  if ((m = /^Digit(\d)$/.exec(chord))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(chord))) return 'Num ' + m[1];
  return NAMED[chord] || chord;
}

// A chord for a control of `kind` where it's set ('global': the Controls page; 'block': the warehouse): { chord } (a
// held control's without Shift) or { refused: why }.
export function checkChord(chord, kind = 'action', where = 'global') {
  if (typeof chord !== 'string' || !chord) return { refused: 'No key' };
  const code = plainOf(chord);
  if (!code || code.includes('+')) return { refused: 'No Ctrl, Cmd or Alt keys: the browser keeps those (Ctrl+W closes the tab)' };
  if (MODIFIERS.has(code)) return { refused: 'Shift, Ctrl, Alt and Cmd can’t be keys on their own' };
  if (RESERVED.has(code)) return { refused: RESERVED.get(code) };
  const c = kind === 'held' ? code : chord;
  if (where === 'block') { if (!BLOCK_SET.has(code)) return { refused: BLOCK_ONLY }; }
  else if (BLOCK_SET.has(code)) return { refused: `${keyLabel(c)} is in the warehouse’s block (7–0, U–P, J–;, M–/): set it on a part` };
  return { chord: c };
}
// The chord a key press makes for a control of `kind` (whether Shift counts) where it's set: { chord } or { refused }.
export function chordFor(e, kind = 'action', where = 'global') {
  const code = e?.code || '';
  if (!code) return { refused: 'That key has no code the browser reports' };
  if (MODIFIERS.has(code)) return { refused: 'Shift, Ctrl, Alt and Cmd can’t be keys on their own' };
  if (e.ctrlKey || e.metaKey || e.altKey) return { refused: 'No Ctrl, Cmd or Alt keys: the browser keeps those (Ctrl+W closes the tab)' };
  return checkChord(e.shiftKey && kind === 'action' ? `Shift+${code}` : code, kind, where);
}

// Two chords that would both take one key press: the same, or either read held (a held control reads its key with or
// without Shift: X held and Shift+X tapped can't both be bound).
const split = (c) => (c.startsWith('Shift+') ? [c.slice(6), true] : [c, false]);
export function clash(a, ka, b, kb) {
  if (!a || !b) return false;
  const [ca, sa] = split(a), [cb, sb] = split(b);
  return ca === cb && (sa === sb || ka === 'held' || kb === 'held');
}

// ---- the store (plain JSON) ----
export const emptyStore = () => ({ v: 3, global: { bind: {} }, aircraft: {} });
const clone = (o) => JSON.parse(JSON.stringify(o));
const uniq = (l) => l.filter((x, i) => l.indexOf(x) === i);
// A stored list for binding b: its valid chords (null: not a list, so the defaults).
function cleanList(l, b) {
  if (!Array.isArray(l)) return null;
  return uniq(l.map((c) => checkChord(c, b.kind, 'global').chord).filter(Boolean));
}
const blockChord = (c, kind) => (typeof c === 'string' && c ? checkChord(c, kind, 'block').chord || null : null);
// An aircraft's entry: its engines' keys (by slot: a design's part id, a type's index) and the drop; null if empty.
function cleanAircraft(e) {
  if (!e || typeof e !== 'object') return null;
  const engines = {};
  for (const [slot, k] of Object.entries(e.engines && typeof e.engines === 'object' ? e.engines : {})) {
    if (!slot || !k || typeof k !== 'object') continue;
    const up = blockChord(k.up, 'held'), down = blockChord(k.down, 'held');
    if (up || down) engines[slot] = { up, down };
  }
  const drop = blockChord(e.drop, 'action');
  if (!Object.keys(engines).length && !drop) return null;
  return drop ? { engines, drop } : { engines };
}
function cleanStore(o) {
  if (!o || typeof o !== 'object') return emptyStore();
  if (!(o.v === 3 || (o.aircraft && typeof o.aircraft === 'object' && !o.scopes))) return migrate(o);
  const out = emptyStore();
  const g = o.global?.bind && typeof o.global.bind === 'object' ? o.global.bind : {};
  for (const b of BINDINGS) { const l = cleanList(g[b.id], b); if (l) out.global.bind[b.id] = l; }
  compact(out.global);
  for (const [k, e] of Object.entries(o.aircraft && typeof o.aircraft === 'object' ? o.aircraft : {})) {
    if (!/^(type|design):./.test(k)) continue;
    const c = cleanAircraft(e);
    if (c) out.aircraft[k] = c;
  }
  return out;
}
// v0.5.6's stores: the global changes still valid (each as the Controls page would make it: a key another control has
// by default moves); a change whose every key is the block's or reserved now goes back to the default. The
// per-aircraft part keys and engine groups (`scopes`) are dropped.
// v0.5.7's moved controls (TO/GA, the QNH, pushback, the map) keep their new keys against an old change that had
// taken one of them (legal in v0.5.6: say next view on N), unless the old store had changed that control itself (review).
const MOVED_IDS = ['toga', 'localQnh', 'pushback', 'map'];
function migrate(o) {
  let st = emptyStore();
  const g = o.global?.bind && typeof o.global.bind === 'object' ? o.global.bind : {};
  const keepNew = new Map(MOVED_IDS.filter((id) => !Array.isArray(g[id])).flatMap((id) => (bindingOf(id)?.keys || []).map((c) => [c, id])));
  for (const b of BINDINGS) {
    if (!Array.isArray(g[b.id])) continue;
    const raw = g[b.id].filter((c) => typeof c === 'string' && c);
    const ok = (cleanList(raw, b) || []).filter((c) => !keepNew.has(c) || keepNew.get(c) === b.id);
    if (raw.length && !ok.length) continue;
    st = assign(st, b.id, ok).store;
  }
  return st;
}
// A store as given (window.__fs.setKeys(), a test): read as loadKeys() reads the saved one.
export const keysFrom = (o) => cleanStore(o ? clone(o) : null);
export function loadKeys(storage) {
  try {
    const raw = storage?.getItem(KEYS_STORE);
    return raw ? cleanStore(JSON.parse(raw)) : emptyStore();
  } catch { return emptyStore(); }
}
export function saveKeys(storage, store) {
  try { storage?.setItem(KEYS_STORE, JSON.stringify(store)); return true; } catch { return false; }
}

// Which aircraft keys an aircraft (a registry entry or designDef(): sim/designs.js) flies with. base: its base type's
// (v0.5.6's fallback; v0.5.7's block keys are each aircraft's own, so nothing reads it).
export function scopeOf(def) {
  if (!def) return { scope: 'type:a321neo', base: null };
  if (def.design) return { scope: `design:${def.design.id}`, base: `type:${def.design.base || def.id}` };
  return { scope: `type:${def.id}`, base: null };
}
// The aircraft's engines in the sim's order, each as its keys are stored: a design's by part id (geo.NACELLES[i].part:
// designDef() orders the engines left outboard to right outboard, so an index isn't a part), a type's by index.
export function engineSlots(def) {
  const E = def?.geo?.ENGINES || [], N = def?.geo?.NACELLES || [];
  return E.map((_, i) => (def?.design && N[i]?.part ? String(N[i].part) : String(i)));
}

// The global keys, as every aircraft flies them: { id: [chords] }. A hand-edited store's clash goes to the first.
function globalBind(store) {
  const g = store?.global?.bind || {};
  const out = {}, taken = [];
  for (const b of BINDINGS) {
    const l = (cleanList(g[b.id], b) ?? b.keys.slice()).filter((c) => !taken.some(([t, k]) => clash(t, k, c, b.kind)));
    for (const c of l) taken.push([c, b.kind]);
    out[b.id] = l;
  }
  return out;
}
const aircraftOf = (store, scope) => (scope ? cleanAircraft(store?.aircraft?.[scope]) : null);

// The keys for an aircraft: { bind: { id: [chords] } (the global ones, every aircraft's), engines: [{ i, slot, up, down }]
// (the engines with keys of their own, by index in the sim; slots: engineSlots(def)), drop (a chord or null), own
// (whether it has block keys of its own) }. A store edited by hand with a key twice keeps the first.
export function resolveKeys(store, { scope = null, slots = null } = {}) {
  const bind = globalBind(store);
  const e = aircraftOf(store, scope);
  const taken = [];
  const take = (c, kind) => { if (!c || taken.some(([t, k]) => clash(t, k, c, kind))) return null; taken.push([c, kind]); return c; };
  const engines = [];
  (slots || []).forEach((slot, i) => {
    const k = e?.engines?.[slot];
    if (!k) return;
    const up = take(k.up, 'held'), down = take(k.down, 'held');
    if (up || down) engines.push({ i, slot: String(slot), up, down });
  });
  const drop = take(e?.drop || null, 'action');
  return { bind, engines, drop, own: !!e };
}

// chord → { kind: 'action' | 'held', id } or { kind: 'engine', i, dir: +1 | -1 }, the first claim winning.
export function keymapOf(resolved) {
  const map = new Map();
  for (const b of BINDINGS) {
    for (const c of resolved?.bind?.[b.id] || []) {
      const chord = b.kind === 'held' ? plainOf(c) : c;
      if (!map.has(chord) && !RESERVED.has(plainOf(chord))) map.set(chord, { kind: b.kind, id: b.id });
    }
  }
  for (const e of resolved?.engines || []) {
    for (const [dir, c] of [[1, e.up], [-1, e.down]]) if (c && !map.has(c) && !RESERVED.has(c)) map.set(c, { kind: 'engine', i: e.i, dir });
  }
  const d = resolved?.drop;
  if (d && !map.has(d) && !RESERVED.has(plainOf(d))) map.set(d, { kind: 'action', id: 'dropTanks' });
  return map;
}

// ---- changes (each returns a new store and what moved, or { error }) ----
const fresh = (store) => cleanStore(clone(store || emptyStore()));
// Only what differs from the defaults is kept.
function compact(e) {
  for (const b of BINDINGS) {
    const l = e.bind[b.id];
    if (!Array.isArray(l) || (l.length === b.keys.length && l.every((c, i) => c === b.keys[i]))) delete e.bind[b.id];
  }
  return e;
}
// Control id's keys become `list`; the other controls lose any key that would take the same press. → { store, moved }
// (moved: [{ id, chord: the key it lost, left: how many it has now }])
function assign(store, id, list) {
  const b = BY_ID.get(id);
  const out = fresh(store), cur = globalBind(out), moved = [];
  for (const o of BINDINGS) {
    if (o.id === id) continue;
    const lost = cur[o.id].filter((c) => list.some((x) => clash(c, o.kind, x, b.kind)));
    if (!lost.length) continue;
    const next = cur[o.id].filter((c) => !lost.includes(c));
    out.global.bind[o.id] = next;
    for (const c of lost) moved.push({ id: o.id, chord: c, left: next.length });
  }
  out.global.bind[id] = list.slice();
  compact(out.global);
  return { store: out, moved };
}
// Bind a chord to control id (a Controls page key, every aircraft's): its keys replaced (index: that one only; add, or
// an index past the end: one more). A block key is refused (the warehouse's). → { store, moved } or { error }.
export function bindKey(store, id, chord, { add = false, index = null } = {}) {
  const b = BY_ID.get(id);
  if (!b) return { error: `No control "${id}"` };
  const r = checkChord(chord, b.kind, 'global');
  if (r.refused) return { error: r.refused };
  const c = r.chord;
  let cur = globalBind(store)[id];
  if (add || (index != null && index >= cur.length)) cur = cur.includes(c) ? cur : [...cur, c];
  else if (index != null) { cur = cur.slice(); cur[index] = c; cur = uniq(cur); }
  else cur = [c];
  return assign(store, id, cur);
}
// Unbind control id (index: that key only).
export function clearKeys(store, id, { index = null } = {}) {
  const b = BY_ID.get(id);
  if (!b) return { error: `No control "${id}"` };
  const cur = globalBind(store)[id];
  return assign(store, id, index == null ? [] : cur.filter((x, i) => i !== index));
}
// Back to the defaults: 'global' (the Controls page's), or an aircraft's block keys (none). A deleted design's keys
// go the same way.
export function resetKeys(store, { scope }) {
  const out = fresh(store);
  if (scope === 'global') out.global = { bind: {} };
  else delete out.aircraft[scope];
  return { store: out, moved: [] };
}

// ---- the block: each aircraft's engines and its drop (the warehouse) ----
// An aircraft's block keys, as stored: { engines: { slot: { up, down } }, drop }.
export function aircraftKeys(store, scope) {
  const e = aircraftOf(store, scope);
  return { engines: e ? clone(e.engines) : {}, drop: e?.drop || null };
}
// Engine `slot`'s own keys: { up, down } (chords or null).
export function engineKeysOf(store, scope, slot) {
  const k = aircraftOf(store, scope)?.engines?.[String(slot)];
  return { up: k?.up || null, down: k?.down || null };
}
function own(store, scope) {
  const out = fresh(store);
  const e = out.aircraft[scope] || { engines: {} };
  out.aircraft[scope] = e;
  return { out, e };
}
function tidy(out, scope) {
  const c = cleanAircraft(out.aircraft[scope]);
  if (c) out.aircraft[scope] = c; else delete out.aircraft[scope];
  return out;
}
// Take a chord off everything of the aircraft but `keep` ({ eng: slot, dir } or { drop: true }); → what lost it (and
// the key it lost).
function takeAway(e, chord, kind, keep) {
  const moved = [];
  for (const [slot, k] of Object.entries(e.engines || {})) {
    for (const [f, dir] of [['up', 1], ['down', -1]]) {
      if (k[f] && clash(k[f], 'held', chord, kind) && !(keep.eng === slot && keep.dir === dir)) { moved.push({ eng: slot, dir, chord: k[f] }); k[f] = null; }
    }
  }
  if (e.drop && clash(e.drop, 'action', chord, kind) && !keep.drop) { moved.push({ drop: true, chord: e.drop }); e.drop = null; }
  return moved;
}
// Engine `slot`'s up (dir +1) or down (-1) key: a block key (held: the plain key). A key another part of this
// aircraft had moves here. → { store, moved } or { error }.
export function bindEngineKey(store, scope, slot, dir, chord) {
  if (!scope) return { error: 'No aircraft' };
  if (slot == null || slot === '') return { error: 'No engine' };
  const r = checkChord(chord, 'held', 'block');
  if (r.refused) return { error: r.refused };
  const s = String(slot), { out, e } = own(store, scope);
  const moved = takeAway(e, r.chord, 'held', { eng: s, dir: dir > 0 ? 1 : -1 });
  const k = e.engines[s] || { up: null, down: null };
  k[dir > 0 ? 'up' : 'down'] = r.chord;
  e.engines[s] = k;
  return { store: tidy(out, scope), moved };
}
export function clearEngineKey(store, scope, slot, dir) {
  const s = String(slot), { out, e } = own(store, scope);
  if (e.engines[s]) e.engines[s][dir > 0 ? 'up' : 'down'] = null;
  return { store: tidy(out, scope), moved: [] };
}
// The aircraft's Drop (a wing tank's tab): a block key, or Shift with one.
export function bindDropKey(store, scope, chord) {
  if (!scope) return { error: 'No aircraft' };
  const r = checkChord(chord, 'action', 'block');
  if (r.refused) return { error: r.refused };
  const { out, e } = own(store, scope);
  const moved = takeAway(e, r.chord, 'action', { drop: true });
  e.drop = r.chord;
  return { store: tidy(out, scope), moved };
}
export function clearDropKey(store, scope) {
  const { out, e } = own(store, scope);
  e.drop = null;
  return { store: tidy(out, scope), moved: [] };
}
// Engines gone: their keys go (`slots`), or every engine's but those kept (`keep`, a design's engines as saved). The
// others keep theirs: nothing shifts (a design's are by part id).
export function dropEngineKeys(store, scope, slots) {
  const out = fresh(store), e = out.aircraft[scope];
  if (!e) return { store: out, moved: [] };
  for (const s of slots || []) delete e.engines[String(s)];
  return { store: tidy(out, scope), moved: [] };
}
// drop: false when the design has no wing tank left (its Drop key goes with the last one; review, v0.5.7).
export function keepEngineKeys(store, scope, keep, { drop = true } = {}) {
  const out = fresh(store), e = out.aircraft[scope], K = new Set((keep || []).map(String));
  if (!e) return { store: out, moved: [] };
  for (const s of Object.keys(e.engines)) if (!K.has(s)) delete e.engines[s];
  if (!drop) e.drop = null;
  return { store: tidy(out, scope), moved: [] };
}
// A design copied: the copy takes its keys (its parts keep their ids).
export function copyKeys(store, from, to) {
  const out = fresh(store), e = out.aircraft[from];
  if (e) out.aircraft[to] = clone(e); else delete out.aircraft[to];
  return { store: out, moved: [] };
}

// What lost a key, as a sentence ('G was the key for the gear, which has none now.'), naming the key it lost (chord:
// the key pressed, for a note without one). label(id) names a control; engine(slot) names an engine (null: one not
// shown, whose key goes quietly).
export function movedText(moved, chord, { label = (id) => BY_ID.get(id)?.short || id, engine = (slot) => `engine ${Number(slot) + 1}` } = {}) {
  const out = [];
  for (const m of moved || []) {
    const K = keyLabel(m.chord || chord);
    if (m.id) out.push(`${K} was the key for ${label(m.id)}${m.left === 0 ? ', which has none now' : ''}`);
    else if (m.drop) out.push(`${K} was the key for dropping the wing tanks, which has none now`);
    else if (m.eng != null) { const n = engine(m.eng); if (n) out.push(`${K} was the key for ${n}’s thrust ${m.dir > 0 ? 'up' : 'down'}, which has none now`); }
  }
  return out.length ? out.join('. ') + '.' : '';
}

// ---- engines, as the editor names them ----
// def.geo.ENGINES (the geometry frame: y to the left). → [{ i, n, side: 'left' | 'right' | 'centre', label }]
export function enginesOf(def) {
  const E = def?.geo?.ENGINES || [];
  return E.map((e, i) => {
    const side = e.y > 0.5 ? 'left' : e.y < -0.5 ? 'right' : 'centre';
    return { i, n: i + 1, side, label: `Engine ${i + 1} (${side})` };
  });
}
// The first key of each control and the block's (for text that names a key): fn(id) → its label, '' if unbound.
export function keyNamesOf(resolved) {
  return (id) => keyLabel(resolved?.bind?.[id]?.[0] || '');
}
