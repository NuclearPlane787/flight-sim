// v0.5.6: the keys (Shane, 2026-11-18: "A keybindings selection per plane instead of general rule. That is, you can
// give each engine or two their own keybinding for powering up and down, or change the default key settings like
// ailerons, elevators, rudder, flaps"; then: "Move the keybinding settings thing to the warehouse, where you can attach
// keybindings by selecting plane parts like the engines ... This is similar to Besiege").
//
// BINDINGS is every control a key can have, with its defaults. A part's controls (`part`: the engines' thrust, the
// wing's ailerons, flaps and spoilers, the tailplane's elevator and trim, the fin's rudder, the fuselage's gear and
// brakes, a wing tank's drop) are each aircraft's own, set in the warehouse by clicking that part: each type and each
// saved design has its own set, and a design flies its base type's until one is changed for the design itself. The
// rest (the views, time, the autopilot and autothrust, the map, pushback, rewind, QNH, the readout) are the same for
// every aircraft: the Controls page's. Only what differs from the defaults is stored, under one key
// (`gamedump:flight-sim:keys`):
//   { v: 2, global: { bind: { map: ['KeyN'] } },
//     scopes: { 'type:a321neo': { bind: { flapUp: ['KeyJ'] }, groups: [...] }, 'design:<id>': { ... } } }
// An engine group is { engines: [0, 1], up: 'KeyU' | null, down: 'KeyJ' | null }: its keys move only those engines'
// thrust levers (input.js; the sim's controls.thrustEng). The warehouse makes one when an engine's key is changed.
// v0.5.6's first shape (every key per aircraft) reads as this one: a scope's non-part keys are dropped.
//
// A key is a "chord": its e.code, or 'Shift+' and the code for a tap (Shift+C arms the ground spoilers). Held
// controls take plain keys only. No Ctrl, Cmd or Alt (the game's standing rule: Ctrl+W closes the tab). Escape (the
// menu) and L (the Sky window) are reserved, and so are the modifier keys, Tab and the browser's F5, F11 and F12.
// Within an aircraft's part keys (or within the global ones), binding a key another control has moves it: that
// control loses it (and shows unbound if it had no other). Between the two a key is refused: a part can't take a
// global key, nor the Controls page a key any aircraft's parts use (by default or as stored).

export const KEYS_STORE = 'gamedump:flight-sim:keys';

// kind: 'held' (read while down: the sticks, the levers, the brakes) or 'action' (once per press).
// part: the part whose keys tab has it in the warehouse (none: a global key, the Controls page's, in `section`).
// family: shown for that family only ('boeing': the 787 and 777). short: how a refusal names it.
export const PARTS = [
  { id: 'engine', title: 'Engine', the: 'an engine' },
  { id: 'wing', title: 'Wing', the: 'the wing' },
  { id: 'tailplane', title: 'Tailplane', the: 'the tailplane' },
  { id: 'fin', title: 'Fin', the: 'the fin' },
  { id: 'fuselage', title: 'Fuselage', the: 'the fuselage' },
  { id: 'tank', title: 'Wing tank', the: 'a wing tank' },
];
export const SECTIONS = [
  { id: 'auto', title: 'Autopilot and autothrust' },
  { id: 'views', title: 'Views' },
  { id: 'time', title: 'Time and the rest' },
];
export const BINDINGS = [
  { id: 'pitchDown', part: 'tailplane', kind: 'held', label: 'Pitch down (elevator)', short: 'pitch down', keys: ['KeyW'] },
  { id: 'pitchUp', part: 'tailplane', kind: 'held', label: 'Pitch up (elevator)', short: 'pitch up', keys: ['KeyS'] },
  { id: 'trimDown', part: 'tailplane', kind: 'held', label: 'Trim nose down (with auto-trim: the path down)', short: 'trim down', keys: ['KeyY'], family: 'boeing' },
  { id: 'trimUp', part: 'tailplane', kind: 'held', label: 'Trim nose up (with auto-trim: the path up)', short: 'trim up', keys: ['KeyH'], family: 'boeing' },
  { id: 'rollLeft', part: 'wing', kind: 'held', label: 'Roll left (ailerons)', short: 'roll left', keys: ['KeyA'] },
  { id: 'rollRight', part: 'wing', kind: 'held', label: 'Roll right (ailerons)', short: 'roll right', keys: ['KeyD'] },
  { id: 'yawLeft', part: 'fin', kind: 'held', label: 'Rudder left (and nose wheel)', short: 'rudder left', keys: ['KeyQ'] },
  { id: 'yawRight', part: 'fin', kind: 'held', label: 'Rudder right (and nose wheel)', short: 'rudder right', keys: ['KeyE'] },
  { id: 'thrustUp', part: 'engine', kind: 'held', label: 'Thrust levers up (all engines)', short: 'thrust up (all engines)', keys: ['KeyR'] },
  { id: 'thrustDown', part: 'engine', kind: 'held', label: 'Thrust levers down (all; hold at idle on the ground: reverse)', short: 'thrust down (all engines)', keys: ['KeyF'] },
  { id: 'flapUp', part: 'wing', kind: 'action', label: 'Flaps up a step', short: 'flaps up a step', keys: ['Minus'] },
  { id: 'flapDown', part: 'wing', kind: 'action', label: 'Flaps down a step', short: 'flaps down a step', keys: ['Equal'] },
  { id: 'flap0', part: 'wing', kind: 'action', label: 'Flaps to detent 1', short: 'flap detent 1', keys: [], flap: 0 },
  { id: 'flap1', part: 'wing', kind: 'action', label: 'Flaps to detent 2', short: 'flap detent 2', keys: [], flap: 1 },
  { id: 'flap2', part: 'wing', kind: 'action', label: 'Flaps to detent 3', short: 'flap detent 3', keys: [], flap: 2 },
  { id: 'flap3', part: 'wing', kind: 'action', label: 'Flaps to detent 4', short: 'flap detent 4', keys: [], flap: 3 },
  { id: 'flap4', part: 'wing', kind: 'action', label: 'Flaps to detent 5', short: 'flap detent 5', keys: [], flap: 4 },
  { id: 'speedbrake', part: 'wing', kind: 'action', label: 'Speed brakes', short: 'the speed brakes', keys: ['KeyC'] },
  { id: 'spoilersArm', part: 'wing', kind: 'action', label: 'Arm the ground spoilers', short: 'the ground spoilers', keys: ['Shift+KeyC'] },
  { id: 'gear', part: 'fuselage', kind: 'action', label: 'Gear up or down', short: 'the gear', keys: ['KeyG'] },
  { id: 'brakes', part: 'fuselage', kind: 'held', label: 'Wheel brakes (hold)', short: 'the wheel brakes', keys: ['Space'] },
  { id: 'parkingBrake', part: 'fuselage', kind: 'action', label: 'Parking brake', short: 'the parking brake', keys: ['KeyB'] },
  // v0.5.6: a wing tank's key drops the wing tanks in the air (main.js dropWingTanks(), as the Weight tab's button)
  { id: 'dropTanks', part: 'tank', kind: 'action', label: 'Drop the wing tanks (in the air)', short: 'dropping the wing tanks', keys: [] },
  { id: 'ap', section: 'auto', kind: 'action', label: 'Autopilot', short: 'the autopilot', keys: ['KeyZ'] },
  { id: 'athr', section: 'auto', kind: 'action', label: 'Autothrust', short: 'the autothrust', keys: ['KeyX'] },
  { id: 'toga', section: 'auto', kind: 'action', label: 'TO/GA switches (the 787 and 777)', short: 'the TO/GA switches', keys: ['KeyO'] },
  { id: 'localQnh', section: 'auto', kind: 'action', label: 'Altimeter to the local QNH', short: 'the local QNH', keys: ['KeyK'] },
  { id: 'viewCockpit', section: 'views', kind: 'action', label: 'Cockpit (again: the other seat)', short: 'the cockpit view', keys: ['Digit1'] },
  { id: 'viewNose', section: 'views', kind: 'action', label: 'Nose', short: 'the nose view', keys: ['Digit2'] },
  { id: 'viewOrbit', section: 'views', kind: 'action', label: 'Outside (3rd person)', short: 'the outside view', keys: ['Digit3'] },
  { id: 'view', section: 'views', kind: 'action', label: 'Next view', short: 'the next view', keys: ['KeyV'] },
  { id: 'faster', section: 'time', kind: 'action', label: 'Time faster', short: 'time faster', keys: ['BracketRight', 'NumpadAdd'] },
  { id: 'slower', section: 'time', kind: 'action', label: 'Time slower', short: 'time slower', keys: ['BracketLeft', 'NumpadSubtract'] },
  { id: 'rewind', section: 'time', kind: 'action', label: 'Rewind 30 s (paused, crashed or with the menu open)', short: 'rewind', keys: ['KeyT'] },
  { id: 'map', section: 'time', kind: 'action', label: 'Map', short: 'the map', keys: ['KeyM'] },
  { id: 'pushback', section: 'time', kind: 'action', label: 'Pushback start or stop', short: 'the pushback', keys: ['KeyP'] },
  { id: 'perf', section: 'time', kind: 'action', label: 'Performance readout', short: 'the performance readout', keys: ['F3', 'Backquote'] },
];
const BY_ID = new Map(BINDINGS.map((b) => [b.id, b]));
export const bindingOf = (id) => BY_ID.get(id) || null;
export const GLOBAL_BINDINGS = BINDINGS.filter((b) => !b.part);
export const PART_BINDINGS = BINDINGS.filter((b) => b.part);
export const isPartKey = (id) => !!BY_ID.get(id)?.part;
// A part's controls, in its keys tab (family: the aircraft's; a family's own rows show for it only).
export const partBindings = (part, family = null) => PART_BINDINGS.filter((b) => b.part === part && (!b.family || !family || b.family === family));
export const partOf = (id) => PARTS.find((p) => p.id === id) || null;

// Keys nothing can take: the menu, the Sky window, the modifiers, and keys the browser keeps.
export const RESERVED = new Map([
  ['Escape', 'Esc opens the menu'], ['KeyL', 'L opens the Sky window'], ['Tab', 'Tab moves between buttons'],
  ['F5', 'F5 reloads the page'], ['F11', 'F11 is the browser’s full screen'], ['F12', 'F12 is the browser’s tools'],
]);
const MODIFIERS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock', 'Fn', 'FnLock', 'ContextMenu', 'OSLeft', 'OSRight']);
// A modifier pressed on its own (a capture waits for the key with it: Shift, then C).
export const isModifier = (code) => MODIFIERS.has(code);

// The chord a key press makes for binding id (kind decides whether Shift counts): { chord } or { refused: why }.
export function chordFor(e, kind = 'action') {
  const code = e?.code || '';
  if (!code) return { refused: 'That key has no code the browser reports' };
  if (MODIFIERS.has(code)) return { refused: 'Shift, Ctrl, Alt and Cmd can’t be keys on their own' };
  if (e.ctrlKey || e.metaKey || e.altKey) return { refused: 'No Ctrl, Cmd or Alt keys: the browser keeps those (Ctrl+W closes the tab)' };
  if (RESERVED.has(code)) return { refused: RESERVED.get(code) };
  return { chord: e.shiftKey && kind === 'action' ? `Shift+${code}` : code };
}

// A chord as printed: 'Shift+KeyC' → 'Shift+C'.
const NAMED = {
  Minus: '−', Equal: '=', BracketLeft: '[', BracketRight: ']', Backquote: '`', Backslash: '\\', Semicolon: ';',
  Quote: '\'', Comma: ',', Period: '.', Slash: '/', Space: 'Space', Enter: 'Enter', Backspace: 'Backspace',
  Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', IntlBackslash: '§',
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

// ---- the store (plain JSON) ----
export const emptyStore = () => ({ v: 2, global: { bind: {} }, scopes: {} });
const cleanList = (l) => (Array.isArray(l) ? l.filter((c) => typeof c === 'string' && c) : null);
const cleanGroups = (gs, nEngines) => (Array.isArray(gs) ? gs : [])
  .map((g) => ({
    engines: [...new Set((Array.isArray(g?.engines) ? g.engines : []).filter((i) => Number.isInteger(i) && i >= 0 && (nEngines == null || i < nEngines)))].sort((a, b) => a - b),
    up: typeof g?.up === 'string' && g.up ? g.up : null,
    down: typeof g?.down === 'string' && g.down ? g.down : null,
  }));
// Only the ids of one side (the part keys in a scope, the global keys in `global`): anything else is dropped (v0.5.6's
// first shape kept every key per aircraft).
function cleanBind(bind, part) {
  const out = {};
  if (!bind || typeof bind !== 'object') return out;
  for (const b of BINDINGS) {
    if (!!b.part !== part) continue;
    const l = cleanList(bind[b.id]);
    if (l) out[b.id] = l;
  }
  return out;
}
function cleanStore(o) {
  if (!o || typeof o !== 'object') return emptyStore();
  const scopes = {};
  for (const [k, e] of Object.entries(o.scopes && typeof o.scopes === 'object' ? o.scopes : {})) {
    if (!/^(type|design):/.test(k) || !e || typeof e !== 'object') continue;
    scopes[k] = { bind: cleanBind(e.bind, true), groups: cleanGroups(e.groups, null).filter((g) => g.engines.length) };
  }
  return { v: 2, global: { bind: cleanBind(o.global?.bind, false) }, scopes };
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

// Which set an aircraft (a registry entry or designDef(): sim/designs.js) flies with: its own, and its base type's.
export function scopeOf(def) {
  if (!def) return { scope: 'type:a321neo', base: null };
  if (def.design) return { scope: `design:${def.design.id}`, base: `type:${def.design.base || def.id}` };
  return { scope: `type:${def.id}`, base: null };
}

// The entry an aircraft's part keys come from: its own, else its base type's (a design's), else none (the defaults).
function entryOf(store, scope, base) {
  const s = store?.scopes || {};
  return s[scope] || (base ? s[base] : null) || null;
}
// Two chords that would both take one key press: the same, or either read held (a held control and an engine group
// read their key with or without Shift: X held and Shift+X tapped can't both be bound).
const split = (c) => (c.startsWith('Shift+') ? [c.slice(6), true] : [c, false]);
export function clash(a, ka, b, kb) {
  if (!a || !b) return false;
  const [ca, sa] = split(a), [cb, sb] = split(b);
  return ca === cb && (sa === sb || ka === 'held' || kb === 'held');
}
const globalBind = (store) => {
  const g = store?.global?.bind || {};
  const out = {};
  for (const b of GLOBAL_BINDINGS) out[b.id] = cleanList(g[b.id]) || b.keys.slice();
  return out;
};
// The global control a chord would collide with: { id } or null.
function globalUse(store, chord, kind) {
  const g = globalBind(store);
  for (const b of GLOBAL_BINDINGS) if (g[b.id].some((c) => clash(c, b.kind, chord, kind))) return { id: b.id };
  return null;
}
// The part control (any aircraft's: the defaults, or as stored) a chord would collide with: { id, scope? } or
// { g, scope } or null.
function partUse(store, chord, kind) {
  for (const b of PART_BINDINGS) if (b.keys.some((c) => clash(c, b.kind, chord, kind))) return { id: b.id };
  for (const [scope, e] of Object.entries(store?.scopes || {})) {
    for (const b of PART_BINDINGS) if ((cleanList(e?.bind?.[b.id]) || []).some((c) => clash(c, b.kind, chord, kind))) return { id: b.id, scope };
    for (const g of cleanGroups(e?.groups, null)) if ([g.up, g.down].some((c) => clash(c, 'held', chord, kind))) return { g: true, scope };
  }
  return null;
}
const partWhy = (u, chord, nameOf) => {
  const where = u.scope ? ` on ${nameOf?.(u.scope) || 'one of your aircraft'}` : '';
  if (u.g) return `${keyLabel(chord)} is an engine’s own thrust key${where}: change it in the warehouse first (click the engine)`;
  const b = BY_ID.get(u.id), part = partOf(b.part);
  return `${keyLabel(chord)} is the key for ${b.short}, on ${part.the}${where}: change it in the warehouse first (click ${part.the})`;
};
const globalWhy = (u, chord) => `${keyLabel(chord)} is the key for ${BY_ID.get(u.id).short}: change it on the Controls page`;

// The keys for an aircraft: { bind: { id: [chords] }, groups: [{ engines, up, down }], own: whether the aircraft has
// its own part keys (else its base type's or the defaults), from: the scope they come from }. The global keys are
// every aircraft's. nEngines drops the groups' engines it doesn't have. A part's key that collides with a global one
// is left out (the refusals keep them apart; a store edited by hand may not).
export function resolveKeys(store, { scope, base = null, nEngines = null } = {}) {
  const e = entryOf(store, scope, base);
  const bind = globalBind(store);
  const taken = GLOBAL_BINDINGS.flatMap((b) => bind[b.id].map((c) => [c, b.kind]));
  const free = (c, kind) => !taken.some(([t, k]) => clash(t, k, c, kind));
  for (const b of PART_BINDINGS) bind[b.id] = ((e && cleanList(e.bind?.[b.id])) || b.keys.slice()).filter((c) => free(c, b.kind));
  const groups = cleanGroups(e?.groups, nEngines).filter((g) => g.engines.length > 0)
    .map((g) => ({ ...g, up: g.up && free(g.up, 'held') ? g.up : null, down: g.down && free(g.down, 'held') ? g.down : null }));
  const s = store?.scopes || {};
  return { bind, groups, own: !!s[scope], from: s[scope] ? scope : base && s[base] ? base : null };
}

// chord → { kind: 'action' | 'held', id } or { kind: 'group', g, dir: +1 | -1 }, the first claim winning (the store
// keeps keys unique anyway).
export function keymapOf(resolved) {
  const map = new Map();
  for (const b of BINDINGS) {
    for (const c of resolved.bind[b.id] || []) {
      const chord = b.kind === 'held' ? c.replace(/^Shift\+/, '') : c;
      if (!map.has(chord) && !RESERVED.has(chord.replace(/^Shift\+/, ''))) map.set(chord, { kind: b.kind, id: b.id });
    }
  }
  resolved.groups.forEach((g, gi) => {
    for (const [dir, c] of [[1, g.up], [-1, g.down]]) {
      if (c && !map.has(c) && !RESERVED.has(c)) map.set(c, { kind: 'group', g: gi, dir });
    }
  });
  return map;
}

// ---- changes (each returns a new store and what moved, or { error }) ----
const clone = (o) => JSON.parse(JSON.stringify(o));
const fresh = (store) => cleanStore(clone(store || emptyStore()));
// The aircraft's own entry, made from the set it flies with now (its base type's, for a design) if it has none.
function own(store, scope, base) {
  const out = fresh(store);
  if (!out.scopes[scope]) {
    const from = base ? out.scopes[base] : null;
    out.scopes[scope] = from ? clone(from) : { bind: {}, groups: [] };
  }
  return { out, e: out.scopes[scope] };
}
// The global entry.
function glob(store) {
  const out = fresh(store);
  return { out, e: out.global };
}
// Only what differs from the defaults is kept.
function compact(e) {
  for (const b of BINDINGS) {
    const l = cleanList(e.bind[b.id]);
    if (!l || (l.length === b.keys.length && l.every((c, i) => c === b.keys[i]))) delete e.bind[b.id];
  }
  if (e.groups) e.groups = e.groups.filter((g) => g.engines.length);
  return e;
}
// Take a chord away from everything in the entry (one side's controls: `list`) but `keep` ({ id } or { g, dir });
// → what lost it.
function takeAway(e, chord, keep, list) {
  const moved = [];
  const kind = keep.g !== undefined ? 'held' : BY_ID.get(keep.id)?.kind || 'action';
  for (const b of list) {
    if (keep.id === b.id) continue;
    const cur = cleanList(e.bind[b.id]) || b.keys.slice();
    const next = cur.filter((c) => !clash(c, b.kind, chord, kind));
    if (next.length !== cur.length) { e.bind[b.id] = next; moved.push({ id: b.id, chord, left: next.length }); }
  }
  (e.groups || []).forEach((g, gi) => {
    for (const k of ['up', 'down']) {
      const dir = k === 'up' ? 1 : -1;
      if (g[k] && clash(g[k], 'held', chord, kind) && !(keep.g === gi && keep.dir === dir)) {
        g[k] = null; moved.push({ g: gi, engines: g.engines.slice(), dir, chord, left: 0 });
      }
    }
  });
  return moved;
}
const plainOf = (c) => c.replace(/^Shift\+/, '');

// Bind a chord to control id: its keys replaced (index: that one only; add, or an index past the end: one more).
// A part's control changes the aircraft's ({ scope, base }); a global one, every aircraft's. nameOf(scope) names an
// aircraft in a refusal. → { store, moved } or { error }.
export function bindKey(store, { scope = null, base = null } = {}, id, chord, { add = false, index = null, nameOf = null } = {}) {
  const b = BY_ID.get(id);
  if (!b) return { error: `No control "${id}"` };
  if (!chord) return { error: 'No key' };
  const c = b.kind === 'held' ? plainOf(chord) : chord;
  if (RESERVED.has(plainOf(c))) return { error: RESERVED.get(plainOf(c)) };
  let out, e, moved;
  if (b.part) {
    const u = globalUse(store, c, b.kind);
    if (u) return { error: globalWhy(u, c) };
    ({ out, e } = own(store, scope, base));
    moved = takeAway(e, c, { id }, PART_BINDINGS);
  } else {
    const u = partUse(store, c, b.kind);
    if (u) return { error: partWhy(u, c, nameOf) };
    ({ out, e } = glob(store));
    moved = takeAway(e, c, { id }, GLOBAL_BINDINGS);
  }
  let cur = cleanList(e.bind[id]) || b.keys.slice();
  if (add || (index != null && index >= cur.length)) cur = cur.includes(c) ? cur : [...cur, c];
  else if (index != null) { cur = cur.slice(); cur[index] = c; cur = cur.filter((x, i) => cur.indexOf(x) === i); }
  else cur = [c];
  e.bind[id] = cur;
  compact(e);
  return { store: out, moved };
}
// Unbind control id (index: that key only).
export function clearKeys(store, { scope = null, base = null } = {}, id, { index = null } = {}) {
  const b = BY_ID.get(id);
  if (!b) return { error: `No control "${id}"` };
  const { out, e } = b.part ? own(store, scope, base) : glob(store);
  const cur = cleanList(e.bind[id]) || b.keys.slice();
  e.bind[id] = index == null ? [] : cur.filter((x, i) => i !== index);
  compact(e);
  return { store: out, moved: [] };
}
// Back to the defaults: 'global' (the Controls page's), or an aircraft's part keys (a design: its base type's again).
// A deleted design's keys go the same way.
export function resetKeys(store, { scope }) {
  const out = fresh(store);
  if (scope === 'global') out.global = { bind: {} };
  else delete out.scopes[scope];
  return { store: out, moved: [] };
}
export function addGroup(store, { scope, base = null }, engines = []) {
  const { out, e } = own(store, scope, base);
  e.groups.push({ engines: [...new Set(engines)].filter((i) => Number.isInteger(i) && i >= 0).sort((a, b) => a - b), up: null, down: null });
  return { store: out, moved: [], index: e.groups.length - 1 };
}
export function setGroupEngines(store, { scope, base = null }, gi, engines) {
  const { out, e } = own(store, scope, base);
  if (!e.groups[gi]) return { error: 'No such group' };
  e.groups[gi].engines = [...new Set(engines)].filter((i) => Number.isInteger(i) && i >= 0).sort((a, b) => a - b);
  compact(e);
  return { store: out, moved: [] };
}
export function bindGroupKey(store, { scope, base = null }, gi, dir, chord) {
  const plain = chord ? plainOf(chord) : null;
  if (plain && RESERVED.has(plain)) return { error: RESERVED.get(plain) };
  if (plain) { const u = globalUse(store, plain, 'held'); if (u) return { error: globalWhy(u, plain) }; }
  const { out, e } = own(store, scope, base);
  if (!e.groups[gi]) return { error: 'No such group' };
  const moved = plain ? takeAway(e, plain, { g: gi, dir }, PART_BINDINGS) : [];
  e.groups[gi][dir > 0 ? 'up' : 'down'] = plain;
  return { store: out, moved };
}
export function removeGroup(store, { scope, base = null }, gi) {
  const { out, e } = own(store, scope, base);
  if (!e.groups[gi]) return { error: 'No such group' };
  e.groups.splice(gi, 1);
  compact(e);
  return { store: out, moved: [] };
}

// ---- v0.5.6: an engine's keys, as its keys tab in the warehouse shows and changes them ----
// Engine i's thrust keys: its group's ({ own: true, gi, engines }), else the all-engines keys it moves with
// (own: false). up and down are lists of chords.
export function engineKeys(store, { scope, base = null } = {}, i) {
  const e = entryOf(store, scope, base);
  const gs = cleanGroups(e?.groups, null);
  const gi = gs.findIndex((g) => g.engines.includes(i));
  const res = resolveKeys(store, { scope, base });
  if (gi < 0) return { own: false, gi: -1, engines: [i], up: res.bind.thrustUp, down: res.bind.thrustDown };
  const g = gs[gi];
  const free = (c) => (c && !globalUse(store, c, 'held') ? [c] : []);
  return { own: true, gi, engines: g.engines.slice(), up: free(g.up), down: free(g.down) };
}
// Engine i's key changed (dir: +1 up, -1 down; chord null clears it): engines (i first, and its mirror twin) become a
// group of their own if they aren't one (the other key unbound until set), or keep theirs (a twin joining it).
export function bindEngineKey(store, { scope, base = null } = {}, engines, dir, chord) {
  const E = [...new Set(engines)].filter((i) => Number.isInteger(i) && i >= 0);
  if (!E.length) return { error: 'No engine' };
  const plain = chord ? plainOf(chord) : null;
  if (plain && RESERVED.has(plain)) return { error: RESERVED.get(plain) };
  if (plain) { const u = globalUse(store, plain, 'held'); if (u) return { error: globalWhy(u, plain) }; }
  const { out, e } = own(store, scope, base);
  let gi = e.groups.findIndex((g) => g.engines.includes(E[0]));
  if (gi >= 0 && e.groups[gi].engines.some((i) => !E.includes(i))) {
    // it shares a group with engines that aren't its twin (Mirror turned off since): it leaves it for one of its own
    for (const g of e.groups) g.engines = g.engines.filter((i) => !E.includes(i));
    gi = -1;
  }
  if (gi < 0) {
    if (!plain) return { store: out, moved: [] };   // nothing to clear: it moves with the all-engines keys
    for (const g of e.groups) g.engines = g.engines.filter((i) => !E.includes(i));
    e.groups.push({ engines: [], up: null, down: null });
    gi = e.groups.length - 1;
  } else for (const [hi, g] of e.groups.entries()) if (hi !== gi) g.engines = g.engines.filter((i) => !E.includes(i));
  e.groups[gi].engines = [...new Set([...e.groups[gi].engines, ...E])].sort((a, b) => a - b);
  const moved = plain ? takeAway(e, plain, { g: gi, dir }, PART_BINDINGS) : [];
  e.groups[gi][dir > 0 ? 'up' : 'down'] = plain;
  compact(e);
  return { store: out, moved };
}
// "As the others": the engines leave their groups, back on the all-engines keys.
export function engineAsOthers(store, { scope, base = null } = {}, engines) {
  const { out, e } = own(store, scope, base);
  for (const g of e.groups) g.engines = g.engines.filter((i) => !engines.includes(i));
  compact(e);
  return { store: out, moved: [] };
}
// Mirror for a type's engines (the keys-only editor): the twin joins engine i's group (on), or leaves it (off: back
// on the all-engines keys).
export function setEngineTwin(store, { scope, base = null } = {}, i, twin, on) {
  const { out, e } = own(store, scope, base);
  const g = e.groups.find((x) => x.engines.includes(i));
  if (g) {
    if (on) { for (const h of e.groups) if (h !== g) h.engines = h.engines.filter((x) => x !== twin); if (!g.engines.includes(twin)) g.engines = [...g.engines, twin].sort((a, b) => a - b); }
    else g.engines = g.engines.filter((x) => x !== twin);
  }
  compact(e);
  return { store: out, moved: [] };
}
// What lost a key, as a sentence ('R was thrust up (all engines)'s: now it has no key.'). label(id) names a control.
export function movedText(moved, chord, label = (id) => BY_ID.get(id)?.short || id) {
  if (!moved?.length) return '';
  return moved.map((m) => `${keyLabel(chord)} was ${m.id ? label(m.id) : `thrust ${m.dir > 0 ? 'up' : 'down'} for engine${m.engines?.length === 1 ? '' : 's'} ${(m.engines || []).map((i) => i + 1).join(' and ')}`}’s${m.left === 0 ? ': now it has no key' : ''}`).join('. ') + '.';
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
export function groupLabel(def, engines) {
  const list = enginesOf(def), picked = (engines || []).filter((i) => list[i]);
  if (!picked.length) return 'No engines';
  const sides = [...new Set(picked.map((i) => list[i].side))];
  const nums = picked.map((i) => String(i + 1));
  const joined = nums.length === 1 ? nums[0] : `${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]}`;
  return `${picked.length === 1 ? 'Engine' : 'Engines'} ${joined}${sides.length === 1 ? ` (${sides[0]})` : ''}`;
}
