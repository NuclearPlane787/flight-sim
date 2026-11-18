// v0.5.6: the keys (src/keys.js), engine groups in the input (src/input.js) and the sim's split levers
// (controls.thrustEng). Shane, 2026-11-18: "A keybindings selection per plane instead of general rule. That is, you can
// give each engine or two their own keybinding for powering up and down, or change the default key settings like
// ailerons, elevators, rudder, flaps." And: "change the default key bindings for flaps from 67890 to just -/=". Then:
// "Move the keybinding settings thing to the warehouse, where you can attach keybindings by selecting plane parts like
// the engines ... an engine would have r/f as the controls. This is similar to Besiege." The parts' keys are each
// aircraft's (the warehouse); the rest are global (the Controls page).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BINDINGS, GLOBAL_BINDINGS, PART_BINDINGS, KEYS_STORE, resolveKeys, keymapOf, bindKey, clearKeys, resetKeys, addGroup,
  setGroupEngines, bindGroupKey, removeGroup, chordFor, keyLabel, loadKeys, saveKeys, emptyStore, scopeOf, enginesOf,
  groupLabel, keysFrom, engineKeys, bindEngineKey, engineAsOthers, setEngineTwin, partBindings, movedText, clash,
  isModifier } from '../src/keys.js';
import { airborne, run, KT } from './sim-helpers.mjs';
import { resolveDef } from '../src/sim/designs.js';

const A321 = { scope: 'type:a321neo' }, B777 = { scope: 'type:b777-300er' };
const DESIGN = { scope: 'design:d1', base: 'type:a321neo' };
const G = {};   // the global keys' scope (any: they're every aircraft's)

test('the defaults: flaps on − and = a step a press, 6 to 0 free, time compression on [ and ], the tanks’ drop unbound', () => {
  const r = resolveKeys(null, A321);
  assert.deepEqual(r.bind.flapUp, ['Minus']);
  assert.deepEqual(r.bind.flapDown, ['Equal']);
  for (const id of ['flap0', 'flap1', 'flap2', 'flap3', 'flap4', 'dropTanks']) assert.deepEqual(r.bind[id], []);
  assert.deepEqual(r.bind.faster, ['BracketRight', 'NumpadAdd']);
  assert.deepEqual(r.bind.slower, ['BracketLeft', 'NumpadSubtract']);
  const m = keymapOf(r);
  assert.deepEqual(m.get('Minus'), { kind: 'action', id: 'flapUp' });
  assert.deepEqual(m.get('Equal'), { kind: 'action', id: 'flapDown' });
  assert.deepEqual(m.get('BracketRight'), { kind: 'action', id: 'faster' });
  assert.equal(m.get('Digit6'), undefined);
  assert.equal(m.get('Escape'), undefined);   // the menu's, outside the bindings
  assert.equal(m.get('KeyL'), undefined);     // the Sky window's
  assert.deepEqual(m.get('KeyW'), { kind: 'held', id: 'pitchDown' });
  assert.deepEqual(m.get('Shift+KeyC'), { kind: 'action', id: 'spoilersArm' });
  assert.deepEqual(m.get('KeyC'), { kind: 'action', id: 'speedbrake' });
  // Every key appears once: the defaults don't clash.
  const all = BINDINGS.flatMap((b) => b.keys);
  assert.equal(new Set(all).size, all.length);
  assert.equal(r.groups.length, 0);
  // The global keys are the Controls page's: the views, time, the AP, A/THR and TO/GA, map, pushback, rewind, QNH and the readout.
  assert.deepEqual(GLOBAL_BINDINGS.map((b) => b.id).sort(), ['ap', 'athr', 'faster', 'localQnh', 'map', 'perf', 'pushback', 'rewind', 'slower', 'toga', 'view', 'viewCockpit', 'viewNose', 'viewOrbit'].sort());
  // The parts': an engine R/F; the wing A/D, −/=, the detents, C, Shift+C; the tailplane W/S, Y/H; the fin Q/E; the
  // fuselage G, Space, B; a wing tank its drop.
  const of = (part) => partBindings(part).map((b) => b.id);
  assert.deepEqual(of('engine'), ['thrustUp', 'thrustDown']);
  assert.deepEqual(of('wing'), ['rollLeft', 'rollRight', 'flapUp', 'flapDown', 'flap0', 'flap1', 'flap2', 'flap3', 'flap4', 'speedbrake', 'spoilersArm']);
  assert.deepEqual(of('tailplane'), ['pitchDown', 'pitchUp', 'trimDown', 'trimUp']);
  assert.deepEqual(partBindings('tailplane', 'airbus').map((b) => b.id), ['pitchDown', 'pitchUp'], 'the trim rows are the Boeings’');
  assert.deepEqual(of('fin'), ['yawLeft', 'yawRight']);
  assert.deepEqual(of('fuselage'), ['gear', 'brakes', 'parkingBrake']);
  assert.deepEqual(of('tank'), ['dropTanks']);
  assert.equal(GLOBAL_BINDINGS.length + PART_BINDINGS.length, BINDINGS.length);
});

test('global keys are every aircraft’s; part keys each aircraft’s; a design flies its base type’s until it has its own', () => {
  let st = emptyStore();
  st = bindKey(st, G, 'map', 'KeyN').store;
  for (const sc of [A321, B777, DESIGN]) assert.deepEqual(resolveKeys(st, sc).bind.map, ['KeyN']);
  assert.deepEqual(st.global.bind, { map: ['KeyN'] }, 'only what differs is stored');
  assert.deepEqual(st.scopes, {});
  st = bindKey(st, B777, 'gear', 'KeyU').store;
  assert.deepEqual(resolveKeys(st, B777).bind.gear, ['KeyU']);
  assert.deepEqual(resolveKeys(st, A321).bind.gear, ['KeyG']);
  assert.deepEqual(st.scopes['type:b777-300er'].bind, { gear: ['KeyU'] });
  // The A321neo's part key shows on its design, until the design has its own.
  st = bindKey(st, A321, 'flapUp', 'KeyJ').store;
  let d = resolveKeys(st, DESIGN);
  assert.deepEqual(d.bind.flapUp, ['KeyJ']);
  assert.equal(d.own, false);
  assert.equal(d.from, 'type:a321neo');
  st = bindKey(st, DESIGN, 'yawLeft', 'KeyI').store;
  d = resolveKeys(st, DESIGN);
  assert.equal(d.own, true);
  assert.deepEqual(d.bind.flapUp, ['KeyJ'], 'its own set starts from the base type’s');
  assert.deepEqual(d.bind.yawLeft, ['KeyI']);
  assert.deepEqual(d.bind.map, ['KeyN'], 'with the global keys');
  assert.deepEqual(resolveKeys(st, A321).bind.yawLeft, ['KeyQ'], 'the type is untouched');
  // Reset: the design goes back to its base type's; the type back to the defaults; 'global' the Controls page's.
  st = resetKeys(st, DESIGN).store;
  assert.deepEqual(resolveKeys(st, DESIGN).bind.yawLeft, ['KeyQ']);
  assert.deepEqual(resolveKeys(st, DESIGN).bind.flapUp, ['KeyJ']);
  st = resetKeys(st, A321).store;
  assert.deepEqual(resolveKeys(st, A321).bind.flapUp, ['Minus']);
  st = resetKeys(st, { scope: 'global' }).store;
  assert.deepEqual(resolveKeys(st, A321).bind.map, ['KeyM']);
  assert.deepEqual(resolveKeys(st, B777).bind.gear, ['KeyU'], 'the parts’ keys stay');
});

test('within a side a key moves: that control loses it (and has none left if it was its only one)', () => {
  let st = emptyStore();
  const r = bindKey(st, A321, 'flapUp', 'KeyG');
  assert.deepEqual(r.moved, [{ id: 'gear', chord: 'KeyG', left: 0 }]);
  assert.match(movedText(r.moved, 'KeyG'), /^G was the gear’s: now it has no key\.$/);
  st = r.store;
  const k = resolveKeys(st, A321);
  assert.deepEqual(k.bind.flapUp, ['KeyG']);
  assert.deepEqual(k.bind.gear, []);
  assert.deepEqual(keymapOf(k).get('KeyG'), { kind: 'action', id: 'flapUp' });
  // A second key (add, or an index past the end), one key replaced (index), one cleared.
  st = bindKey(st, A321, 'flapUp', 'Minus', { add: true }).store;
  assert.deepEqual(resolveKeys(st, A321).bind.flapUp, ['KeyG', 'Minus']);
  st = bindKey(st, A321, 'flapUp', 'KeyJ', { index: 0 }).store;
  assert.deepEqual(resolveKeys(st, A321).bind.flapUp, ['KeyJ', 'Minus']);
  st = bindKey(st, A321, 'flapUp', 'KeyU', { index: 2 }).store;
  assert.deepEqual(resolveKeys(st, A321).bind.flapUp, ['KeyJ', 'Minus', 'KeyU']);
  st = clearKeys(st, A321, 'flapUp', { index: 1 }).store;
  assert.deepEqual(resolveKeys(st, A321).bind.flapUp, ['KeyJ', 'KeyU']);
  st = clearKeys(st, A321, 'flapUp').store;
  assert.deepEqual(resolveKeys(st, A321).bind.flapUp, []);
  // The global side: a global key moves among the global ones.
  const m2 = bindKey(emptyStore(), G, 'map', 'NumpadAdd');
  assert.deepEqual(m2.moved, [{ id: 'faster', chord: 'NumpadAdd', left: 1 }]);
  assert.deepEqual(resolveKeys(m2.store, A321).bind.faster, ['BracketRight']);
  st = clearKeys(emptyStore(), G, 'ap').store;
  assert.deepEqual(resolveKeys(st, B777).bind.ap, []);
  assert.equal(keymapOf(resolveKeys(st, A321)).get('KeyZ'), undefined);
});

test('between the sides a key is refused, naming its control: a part can’t take a global key, nor the Controls page a part’s', () => {
  // A part's key wanting a global one.
  let r = bindKey(emptyStore(), A321, 'gear', 'KeyM');
  assert.equal(r.store, undefined);
  assert.equal(r.error, 'M is the key for the map: change it on the Controls page');
  r = bindEngineKey(emptyStore(), A321, [0, 1], 1, 'KeyT');
  assert.match(r.error, /^T is the key for rewind: change it on the Controls page$/);
  r = bindGroupKey(addGroup(emptyStore(), A321, [0]).store, A321, 0, 1, 'KeyZ');
  assert.match(r.error, /the autopilot/);
  // A global key wanting a part's: by default ...
  r = bindKey(emptyStore(), G, 'map', 'KeyR');
  assert.match(r.error, /^R is the key for thrust up \(all engines\), on an engine: change it in the warehouse first/);
  r = bindKey(emptyStore(), G, 'map', 'Shift+KeyW');   // W is held (the elevator): Shift+W would press it too
  assert.match(r.error, /pitch down, on the tailplane/);
  // ... or as stored (an aircraft's own key, an engine's group), named.
  let st = bindKey(emptyStore(), B777, 'flapUp', 'KeyJ').store;
  r = bindKey(st, G, 'map', 'KeyJ', { nameOf: (sc) => (sc === 'type:b777-300er' ? 'the 777-300ER' : null) });
  assert.match(r.error, /^J is the key for flaps up a step, on the wing on the 777-300ER: change it in the warehouse first/);
  st = bindEngineKey(emptyStore(), DESIGN, [0], 1, 'KeyU').store;
  r = bindKey(st, G, 'perf', 'KeyU');
  assert.match(r.error, /^U is an engine’s own thrust key on one of your aircraft/);
  // A free key is fine both ways (and Shift+ a part's tapped key is free for a global tap).
  assert.ok(bindKey(emptyStore(), G, 'map', 'KeyN').store);
  assert.ok(bindKey(emptyStore(), G, 'map', 'Shift+KeyG').store);
  assert.ok(bindKey(emptyStore(), A321, 'gear', 'Shift+KeyM').store);
  assert.equal(clash('Shift+KeyG', 'action', 'KeyG', 'action'), false);
  assert.equal(clash('Shift+KeyW', 'action', 'KeyW', 'held'), true);
});

test('a held control reads its key with or without Shift: X held and Shift+X tapped can’t both be bound', () => {
  let r = bindKey(emptyStore(), A321, 'gear', 'Shift+KeyW');
  assert.deepEqual(r.moved, [{ id: 'pitchDown', chord: 'Shift+KeyW', left: 0 }]);
  r = bindKey(emptyStore(), A321, 'pitchUp', 'Shift+KeyC');   // a held control takes the plain key
  const k = resolveKeys(r.store, A321);
  assert.deepEqual(k.bind.pitchUp, ['KeyC']);
  assert.deepEqual(k.bind.speedbrake, []);
  assert.deepEqual(k.bind.spoilersArm, []);
});

test('Esc, L, Tab and the modifiers are refused, and so is anything with Ctrl, Cmd or Alt', () => {
  assert.ok(chordFor({ code: 'Escape' }).refused);
  assert.ok(chordFor({ code: 'KeyL' }).refused);
  assert.ok(chordFor({ code: 'Tab' }).refused);
  assert.ok(chordFor({ code: 'ShiftLeft', shiftKey: true }).refused);
  assert.ok(isModifier('ShiftLeft') && !isModifier('KeyS'));
  assert.ok(chordFor({ code: 'KeyW', ctrlKey: true }).refused);
  assert.ok(chordFor({ code: 'KeyW', metaKey: true }).refused);
  assert.ok(chordFor({ code: 'KeyW', altKey: true }).refused);
  assert.deepEqual(chordFor({ code: 'KeyC', shiftKey: true }, 'action'), { chord: 'Shift+KeyC' });
  assert.deepEqual(chordFor({ code: 'KeyC', shiftKey: true }, 'held'), { chord: 'KeyC' });
  assert.ok(bindKey(emptyStore(), A321, 'gear', 'KeyL').error);
  assert.ok(bindKey(emptyStore(), A321, 'gear', 'Escape').error);
  assert.ok(bindKey(emptyStore(), G, 'map', 'KeyL').error);
  assert.ok(bindEngineKey(emptyStore(), A321, [0], 1, 'Escape').error);
  assert.equal(keyLabel('Shift+KeyC'), 'Shift+C');
  assert.equal(keyLabel('Minus'), '−');
  assert.equal(keyLabel('BracketLeft'), '[');
  assert.equal(keyLabel('Digit6'), '6');
  assert.equal(keyLabel('NumpadAdd'), 'Num +');
});

test('the store round-trips under gamedump:flight-sim:keys; a bad one reads as empty; v0.5.6’s first shape reads leniently', () => {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); } };
  let st = bindKey(emptyStore(), B777, 'gear', 'KeyJ').store;
  st = bindEngineKey(st, B777, [0], 1, 'KeyU').store;
  st = bindKey(st, G, 'toga', 'KeyN').store;
  assert.equal(saveKeys(storage, st), true);
  assert.ok(KEYS_STORE.startsWith('gamedump:flight-sim:'));
  assert.deepEqual(loadKeys(storage), st);
  mem.set(KEYS_STORE, '{not json');
  assert.deepEqual(loadKeys(storage), emptyStore());
  assert.deepEqual(loadKeys(null), emptyStore());
  // v0.5.6's first shape: every key per aircraft, the Controls page's `last`. The non-part keys in a scope are dropped.
  mem.set(KEYS_STORE, JSON.stringify({ v: 1, last: 'type:a321neo', scopes: {
    'type:a321neo': { bind: { map: ['KeyR'], ap: ['KeyU'], flapUp: ['KeyJ'] }, groups: [{ engines: [0], up: 'KeyI', down: null }, { engines: [], up: 'KeyO', down: null }] },
    junk: { bind: { gear: ['KeyN'] } },
  } }));
  const old = loadKeys(storage);
  assert.deepEqual(old, { v: 2, global: { bind: {} }, scopes: { 'type:a321neo': { bind: { flapUp: ['KeyJ'] }, groups: [{ engines: [0], up: 'KeyI', down: null }] } } });
  const k = resolveKeys(old, A321);
  assert.deepEqual(k.bind.map, ['KeyM']);
  assert.deepEqual(k.bind.ap, ['KeyZ']);
  assert.deepEqual(k.bind.flapUp, ['KeyJ']);
  // keysFrom() reads a given store the same way (window.__fs.setKeys()).
  assert.deepEqual(keysFrom(JSON.parse(mem.get(KEYS_STORE))), old);
  assert.deepEqual(keysFrom(null), emptyStore());
  // A store edited by hand with a part's key on a global one: the global key wins (the part's is left out).
  const hand = keysFrom({ global: { bind: { map: ['KeyG'] } }, scopes: { 'type:a321neo': { groups: [{ engines: [1], up: 'KeyG', down: 'KeyJ' }] } } });
  const h = resolveKeys(hand, A321);
  assert.deepEqual(h.bind.gear, []);
  assert.deepEqual(h.groups, [{ engines: [1], up: null, down: 'KeyJ' }]);
  assert.deepEqual(keymapOf(h).get('KeyG'), { kind: 'action', id: 'map' });
});

test('an engine’s keys: the all-engines keys until one is changed; then a group of its own, with its twin', () => {
  let st = emptyStore();
  assert.deepEqual(engineKeys(st, A321, 0), { own: false, gi: -1, engines: [0], up: ['KeyR'], down: ['KeyF'] });
  // Changing its up key (with its mirror twin): the two become a group; the down key stays unbound until set.
  let r = bindEngineKey(st, A321, [0, 1], 1, 'KeyU');
  st = r.store;
  assert.deepEqual(engineKeys(st, A321, 1), { own: true, gi: 0, engines: [0, 1], up: ['KeyU'], down: [] });
  assert.deepEqual(resolveKeys(st, { ...A321, nEngines: 2 }).groups, [{ engines: [0, 1], up: 'KeyU', down: null }]);
  st = bindEngineKey(st, A321, [0, 1], -1, 'KeyJ').store;
  assert.deepEqual(st.scopes['type:a321neo'].groups, [{ engines: [0, 1], up: 'KeyU', down: 'KeyJ' }]);
  // Mirror off: engine 0 alone leaves the pair's group for one of its own (its other key unbound).
  st = bindEngineKey(st, A321, [0], 1, 'KeyI').store;
  assert.deepEqual(st.scopes['type:a321neo'].groups, [{ engines: [1], up: 'KeyU', down: 'KeyJ' }, { engines: [0], up: 'KeyI', down: null }]);
  // A key another part has moves here (the all-engines up key).
  r = bindEngineKey(st, A321, [0], -1, 'KeyR');
  assert.deepEqual(r.moved, [{ id: 'thrustUp', chord: 'KeyR', left: 0 }]);
  assert.match(movedText(r.moved, 'KeyR'), /^R was thrust up \(all engines\)’s: now it has no key\.$/);
  // ... and a group's key taken by another moves off it.
  r = bindEngineKey(st, A321, [1], 1, 'KeyI');
  assert.deepEqual(r.moved, [{ g: 1, engines: [0], dir: 1, chord: 'KeyI', left: 0 }]);
  assert.match(movedText(r.moved, 'KeyI'), /^I was thrust up for engine 1’s/);
  // Cleared: no key there (the group stays); As the others: back on the all-engines keys.
  st = bindEngineKey(st, A321, [1], -1, null).store;
  assert.deepEqual(engineKeys(st, A321, 1).down, []);
  st = engineAsOthers(st, A321, [1]).store;
  assert.equal(engineKeys(st, A321, 1).own, false);
  assert.deepEqual(st.scopes['type:a321neo'].groups, [{ engines: [0], up: 'KeyI', down: null }]);
  // Clearing an engine with no keys of its own does nothing.
  assert.deepEqual(bindEngineKey(st, A321, [1], 1, null).store, st);
  // A type's Mirror: its twin joins its group, or leaves it.
  st = setEngineTwin(st, A321, 0, 1, true).store;
  assert.deepEqual(engineKeys(st, A321, 1).engines, [0, 1]);
  st = setEngineTwin(st, A321, 0, 1, false).store;
  assert.deepEqual(engineKeys(st, A321, 1).own, false);
  // A design flies its base type's engine keys until it has its own.
  assert.deepEqual(engineKeys(st, DESIGN, 0).up, ['KeyI']);
  st = engineAsOthers(st, DESIGN, [0]).store;
  assert.equal(engineKeys(st, DESIGN, 0).own, false);
  assert.equal(engineKeys(st, A321, 0).own, true, 'the type keeps its');
});

test('engine groups (the v0.5.6 helpers): their keys, conflicts with the other keys, engines the aircraft hasn’t dropped', () => {
  let st = addGroup(emptyStore(), A321, [0]).store;
  st = bindGroupKey(st, A321, 0, 1, 'KeyU').store;
  const r = bindGroupKey(st, A321, 0, -1, 'KeyR');   // the all-engines up key
  assert.deepEqual(r.moved, [{ id: 'thrustUp', chord: 'KeyR', left: 0 }]);
  st = r.store;
  let k = resolveKeys(st, { ...A321, nEngines: 2 });
  assert.deepEqual(k.groups, [{ engines: [0], up: 'KeyU', down: 'KeyR' }]);
  const m = keymapOf(k);
  assert.deepEqual(m.get('KeyU'), { kind: 'group', g: 0, dir: 1 });
  assert.deepEqual(m.get('KeyR'), { kind: 'group', g: 0, dir: -1 });
  // A key taken by a control comes off the group.
  st = bindKey(st, A321, 'gear', 'KeyU').store;
  assert.equal(resolveKeys(st, A321).groups[0].up, null);
  // Engines past the aircraft's count go; a group left with none is dropped.
  st = setGroupEngines(st, A321, 0, [1, 5]).store;
  assert.deepEqual(resolveKeys(st, { ...A321, nEngines: 2 }).groups[0].engines, [1]);
  assert.equal(resolveKeys(st, { ...A321, nEngines: 1 }).groups.length, 0);
  st = removeGroup(st, A321, 0).store;
  assert.equal(resolveKeys(st, A321).groups.length, 0);
  // Names from the geometry (y to the left).
  const def = resolveDef('b777-300er');
  assert.equal(enginesOf(def).length, 2);
  assert.deepEqual(enginesOf(def).map((e) => e.side).sort(), ['left', 'right']);
  assert.match(groupLabel(def, [0, 1]), /^Engines 1 and 2$/);
  assert.match(groupLabel(def, [enginesOf(def).find((e) => e.side === 'left').i]), /\(left\)$/);
  assert.deepEqual(scopeOf(def), { scope: 'type:b777-300er', base: null });
  assert.deepEqual(scopeOf({ id: 'x', design: { id: 'd9', base: 'b787-9' } }), { scope: 'design:d9', base: 'type:b787-9' });
});

// ---- the input, driven by fake key events ----
function fakeInput() {
  const handlers = {};
  globalThis.window ??= { addEventListener() {} };
  globalThis.document ??= { addEventListener() {} };
  const target = { addEventListener: (t, fn) => { handlers[t] = fn; } };
  return import('../src/input.js').then(({ createInput }) => {
    const input = createInput(target);
    const ev = (code, extra = {}) => ({ code, key: code, repeat: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, target: {}, preventDefault() {}, ...extra });
    return { input, down: (c, x) => handlers.keydown(ev(c, x)), up: (c) => handlers.keyup(ev(c)) };
  });
}
const controls0 = () => ({ pitch: 0, roll: 0, yaw: 0, thrust: 0, trim: 0, brakeL: 0, brakeR: 0, thrustEng: null });

test('input: the bindings decide the actions; Esc is always the menu; 6 is nothing by default', async () => {
  const { input, down } = await fakeInput();
  const seen = [];
  input.onAction((a) => seen.push(a));
  down('Minus'); down('Equal'); down('Digit6'); down('BracketRight'); down('Escape'); down('KeyC', { shiftKey: true }); down('KeyC');
  assert.deepEqual(seen, ['flapUp', 'flapDown', 'faster', 'pause', 'spoilersArm', 'speedbrake']);
  // Rebound: G is flaps up a step, Escape still the menu.
  input.setBindings(resolveKeys(bindKey(emptyStore(), A321, 'flapUp', 'KeyG').store, A321));
  seen.length = 0;
  down('KeyG'); down('Escape'); down('Minus');
  assert.deepEqual(seen, ['flapUp', 'pause']);
  // v0.5.6: a wing tank's key is the drop action (main.js: dropWingTanks()); a global key changed is every aircraft's.
  let st = bindKey(emptyStore(), DESIGN, 'dropTanks', 'KeyU').store;
  st = bindKey(st, G, 'map', 'KeyN').store;
  input.setBindings(resolveKeys(st, DESIGN));
  seen.length = 0;
  down('KeyU'); down('KeyN'); down('KeyM');
  assert.deepEqual(seen, ['dropTanks', 'map']);
  input.setBindings(resolveKeys(st, A321));
  seen.length = 0;
  down('KeyU'); down('KeyN');
  assert.deepEqual(seen, ['map'], 'the drop key is the design’s');
});

test('input: an engine group’s keys move only its engines’ levers; the all-engines keys move them all alike', async () => {
  const { input, down, up } = await fakeInput();
  let st = addGroup(emptyStore(), A321, [0]).store;
  st = bindGroupKey(st, A321, 0, 1, 'KeyU').store;
  st = bindGroupKey(st, A321, 0, -1, 'KeyJ').store;
  input.setEngineCount(2);
  input.setBindings(resolveKeys(st, { ...A321, nEngines: 2 }));
  const c = controls0();
  down('KeyU');
  for (let i = 0; i < 30; i++) input.update(1 / 30, c, false, false);
  up('KeyU');
  assert.ok(Array.isArray(c.thrustEng) && c.thrustEng.length === 2, JSON.stringify(c));
  // v0.5.6 (review): apart, the all-engines lever reads the highest of them (the A/THR's modes and MAN TOGA go by it).
  assert.ok(c.thrustEng[0] > 0.3 && c.thrustEng[1] === 0 && c.thrust === c.thrustEng[0], JSON.stringify(c));
  assert.ok(input.leverHeld() === false);
  // The all-engines key: both by the same amount.
  const before = c.thrustEng.slice();
  // (From the highest lever, which the group left at a detent: past its pause, then on.)
  down('KeyR');
  for (let i = 0; i < 24; i++) input.update(1 / 30, c, false, false);
  up('KeyR');
  const d0 = c.thrustEng[0] - before[0], d1 = c.thrustEng[1] - before[1];
  assert.ok(d1 > 0.05 && Math.abs(d0 - d1) < 1e-9, `${d0} ${d1}`);
  // The group's down key stops at idle (reverse is the all-engines keys').
  down('KeyJ');
  for (let i = 0; i < 120; i++) input.update(1 / 30, c, true, false);
  up('KeyJ');
  assert.equal(c.thrustEng[0], 0);
  // The A/THR driving: the levers follow it, together.
  c.thrust = 0.5;
  input.update(1 / 30, c, false, true);
  assert.equal(c.thrustEng, null);
  assert.equal(c.thrust, 0.5);
  // A group key while it drives takes the levers from where they are (the sim then hands them over).
  down('KeyU');
  input.update(0.2, c, false, true);
  up('KeyU');
  assert.ok(Array.isArray(c.thrustEng) && c.thrustEng[1] === 0.5 && c.thrustEng[0] > 0.5, JSON.stringify(c));
  // Setting the lever (a new flight, a skip to final) brings them together.
  input.lever = 0;
  assert.equal(input.levers, null);
});

// ---- the sim's split levers ----
test('sim: levers apart but equal fly exactly as together; apart, the engines and the yaw follow their own', () => {
  const a = airborne({ altFt: 8000, iasKt: 250 }), b = airborne({ altFt: 8000, iasKt: 250 });
  const lever = 0.45;
  run(a, 20, (s) => { s.controls.thrust = lever; s.controls.thrustEng = null; });
  run(b, 20, (s) => { s.controls.thrust = lever; s.controls.thrustEng = [lever, lever]; });
  assert.deepEqual(JSON.parse(JSON.stringify(b.state)), JSON.parse(JSON.stringify(a.state)));
  // Apart: engine 1 full, engine 2 at idle.
  const c = airborne({ altFt: 8000, iasKt: 250 });
  run(c, 15, (s) => { s.controls.thrust = 0.3; s.controls.thrustEng = [1, 0]; });
  const [e0, e1] = c.state.engines;
  assert.ok(e0.n1 > e1.n1 + 15 && e0.thrustN > 2 * e1.thrustN, `${e0.n1} ${e1.n1}`);
  assert.ok(e0.leverN1 > e1.leverN1 + 15 && c.state.engines.every((e) => Number.isFinite(e.leverN1)), `${e0.leverN1} ${e1.leverN1}`);
  // The yaw: towards the idle engine's side (engine 1's y to the left: positive N, the nose right).
  const y0 = c.type.geo.ENGINES[0].y;
  assert.ok(Math.sign(c.state.r) === Math.sign(y0) || Math.sign(c.state.beta) === -Math.sign(y0), `r ${c.state.r} beta ${c.state.beta} y0 ${y0}`);
  // Together, each engine's ring is the lever's.
  const d = airborne({ altFt: 8000, iasKt: 250 });
  run(d, 2, (s) => { s.controls.thrust = 0.5; });
  for (const e of d.state.engines) assert.equal(e.leverN1, d.state.leverN1);
});

test('sim: a snapshot carries the levers apart; a reset and an old save bring them together', () => {
  const s = airborne({ altFt: 8000, iasKt: 250 });
  run(s, 1, (x) => { x.controls.thrust = 0.4; x.controls.thrustEng = [0.6, 0.2]; });
  const snap = s.snapshot();
  assert.deepEqual(snap.controls.thrustEng, [0.6, 0.2]);
  s.controls.thrustEng[0] = 0.9;
  assert.deepEqual(snap.controls.thrustEng, [0.6, 0.2], 'a copy');
  const t = airborne({ altFt: 8000, iasKt: 250 });
  t.restore(JSON.parse(JSON.stringify(snap)));
  assert.deepEqual(t.controls.thrustEng, [0.6, 0.2]);
  const old = JSON.parse(JSON.stringify(snap)); delete old.controls.thrustEng;
  t.restore(old);
  assert.equal(t.controls.thrustEng, null);
  t.reset({ x: 0, y: 0, hdg: 0, onGround: false, z: 2000, iasMs: 130, flapLever: 0, gearDown: false, fuelKg: 8000, payloadKg: 10000 });
  assert.equal(t.controls.thrustEng, null);
  // previewControls (paused): each engine's ring from its own lever, nothing stepped.
  t.controls.thrust = 0.3; t.controls.thrustEng = [1, 0];
  const n1 = t.state.engines.map((e) => e.n1), time = t.state.t;
  t.previewControls();
  assert.ok(t.state.engines[0].leverN1 > t.state.engines[1].leverN1 + 15);
  assert.deepEqual(t.state.engines.map((e) => e.n1), n1);
  assert.equal(t.state.t, time);
});

test('sim: the A/THR driving brings the levers together; a hand on one of them takes it off (A321)', () => {
  const s = airborne({ altFt: 10000, iasKt: 250, ap: { ap: true, athr: true, spdKt: 250 } });
  run(s, 2, () => {});
  assert.equal(s.state.athrActive, true);
  // Levers apart, equal to the A/THR's: they go back together.
  s.controls.thrustEng = [s.controls.thrust, s.controls.thrust];
  s.step(1 / 120);
  assert.equal(s.controls.thrustEng, null);
  assert.equal(s.state.athrActive, true);
  // One moved: a hand on the levers. The A321's A/THR disconnects and each engine flies its own.
  const evs = [];
  s.controls.thrustEng = [1, s.controls.thrust];
  s.step(1 / 120);
  evs.push(...s.events.splice(0));
  assert.equal(s.state.athrActive, false);
  assert.ok(Array.isArray(s.controls.thrustEng));
  assert.ok(evs.some((e) => e.type === 'athrDisconnect'), JSON.stringify(evs));
  run(s, 8, () => {});
  assert.ok(s.state.engines[0].n1 > s.state.engines[1].n1 + 5, `${s.state.engines[0].n1} ${s.state.engines[1].n1}`);
  void KT;
});
