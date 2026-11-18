// v0.5.7: the keys (src/keys.js), the engines' own keys in the input (src/input.js) and the sim's split levers
// (controls.thrustEng). Shane's decisions: a block of 16 keys under the right hand (7–0, U–P, J–;, M–/, and Shift with
// them) is the warehouse's, each aircraft's own: each engine its own thrust up and down, a wing tank the drop; every
// other key is the Controls page's, the same for every aircraft. Keys that do nothing on their own (` tab caps return
// delete and the Shifts) can't be bound. The store is v3; v0.5.6's keeps its valid global changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BINDINGS, SECTIONS, BLOCK, KEYS_STORE, RESERVED, resolveKeys, keymapOf, bindKey, clearKeys, resetKeys, chordFor,
  checkChord, keyLabel, loadKeys, saveKeys, emptyStore, scopeOf, keysFrom, isModifier, isBlockKey, clash, movedText,
  bindEngineKey, clearEngineKey, bindDropKey, clearDropKey, engineKeysOf, aircraftKeys, keepEngineKeys, dropEngineKeys,
  copyKeys, engineSlots, enginesOf, keyNamesOf } from '../src/keys.js';
import { airborne, run, KT } from './sim-helpers.mjs';
import { resolveDef, designDef, newDesign, addPart, removePart } from '../src/sim/designs.js';

const A321 = 'type:a321neo', B777 = 'type:b777-300er';
const BLOCK_WHY = (k) => `${k} is in the warehouse’s block (7–0, U–P, J–;, M–/): set it on a part`;
const ONLY_BLOCK = 'Only the block’s keys here: 7–0, U–P, J–; and M–/';

test('the defaults: every control on the Controls page, the moved keys, nothing in the block, every key once', () => {
  const r = resolveKeys(null);
  assert.equal(BINDINGS.length, 36);
  assert.deepEqual(SECTIONS.map((s) => s.id), ['fly', 'thrust', 'wing', 'ground', 'auto', 'views', 'time']);
  for (const b of BINDINGS) assert.ok(SECTIONS.some((s) => s.id === b.section), b.id);
  const k = (id) => r.bind[id];
  assert.deepEqual([k('pitchDown'), k('pitchUp'), k('rollLeft'), k('rollRight'), k('yawLeft'), k('yawRight'), k('trimDown'), k('trimUp')],
    [['KeyW'], ['KeyS'], ['KeyA'], ['KeyD'], ['KeyQ'], ['KeyE'], ['KeyY'], ['KeyH']]);
  assert.deepEqual([k('thrustUp'), k('thrustDown'), k('flapUp'), k('flapDown')], [['KeyR'], ['KeyF'], ['Minus'], ['Equal']]);
  for (const id of ['flap0', 'flap1', 'flap2', 'flap3', 'flap4']) assert.deepEqual(k(id), []);
  assert.deepEqual([k('speedbrake'), k('spoilersArm'), k('gear'), k('brakes'), k('parkingBrake')], [['KeyC'], ['Shift+KeyC'], ['KeyG'], ['Space'], ['KeyB']]);
  assert.deepEqual([k('ap'), k('athr'), k('toga'), k('localQnh')], [['KeyZ'], ['KeyX'], ['Shift+KeyT'], ['Shift+KeyB']]);
  assert.deepEqual([k('viewCockpit'), k('viewNose'), k('viewOrbit'), k('view')], [['Digit1'], ['Digit2'], ['Digit3'], ['KeyV']]);
  assert.deepEqual([k('faster'), k('slower'), k('rewind'), k('map'), k('pushback'), k('perf')],
    [['BracketRight', 'NumpadAdd'], ['BracketLeft', 'NumpadSubtract'], ['KeyT'], ['KeyN'], ['Shift+KeyG'], ['F3']]);
  // No default is the block's (or Shift with one), and every key appears once.
  const all = BINDINGS.flatMap((b) => b.keys);
  assert.ok(all.every((c) => !isBlockKey(c)), all.filter(isBlockKey).join());
  assert.equal(new Set(all).size, all.length);
  for (const b of BINDINGS) for (const c of b.keys) assert.equal(checkChord(c, b.kind, 'global').chord, c, `${b.id} ${c}`);
  // The key map: the moved keys and the dead ones map to nothing; the new ones are there.
  const m = keymapOf(r);
  for (const c of ['KeyL', 'KeyM', 'KeyP', 'KeyO', 'KeyK', 'Backquote', 'Backslash', 'Tab', 'Enter', 'Backspace', 'Digit7', 'Escape']) assert.equal(m.get(c), undefined, c);
  assert.deepEqual(m.get('KeyN'), { kind: 'action', id: 'map' });
  assert.deepEqual(m.get('Shift+KeyG'), { kind: 'action', id: 'pushback' });
  assert.deepEqual(m.get('KeyG'), { kind: 'action', id: 'gear' });
  assert.deepEqual(m.get('Shift+KeyT'), { kind: 'action', id: 'toga' });
  assert.deepEqual(m.get('KeyT'), { kind: 'action', id: 'rewind' });
  assert.deepEqual(m.get('Shift+KeyB'), { kind: 'action', id: 'localQnh' });
  assert.deepEqual(m.get('F3'), { kind: 'action', id: 'perf' });
  assert.deepEqual(m.get('KeyW'), { kind: 'held', id: 'pitchDown' });
  assert.deepEqual(m.get('KeyR'), { kind: 'held', id: 'thrustUp' });
  assert.deepEqual(r.engines, []);
  assert.equal(r.drop, null);
  // The labels the notes use.
  assert.equal(keyNamesOf(r)('pushback'), 'Shift+G');
  assert.equal(keyNamesOf(r)('flap0'), '');
});

test('the block: 16 keys under the right hand, Shift with them too', () => {
  assert.deepEqual(BLOCK, ['Digit7', 'Digit8', 'Digit9', 'Digit0', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon',
    'KeyM', 'Comma', 'Period', 'Slash']);
  assert.ok(isBlockKey('KeyU') && isBlockKey('Shift+KeyU') && isBlockKey('Slash') && isBlockKey('Digit0'));
  assert.ok(!isBlockKey('Digit6') && !isBlockKey('KeyY') && !isBlockKey('Quote') && !isBlockKey('BracketLeft') && !isBlockKey('KeyN'));
});

test('the block refused on the Controls page, anything else refused in the warehouse, naming the rule', () => {
  // The Controls page: a block key, or Shift with one, is the warehouse's.
  assert.equal(bindKey(emptyStore(), 'map', 'KeyU').error, BLOCK_WHY('U'));
  assert.equal(bindKey(emptyStore(), 'gear', 'Shift+KeyL').error, BLOCK_WHY('Shift+L'));
  assert.equal(bindKey(emptyStore(), 'pitchDown', 'Semicolon').error, BLOCK_WHY(';'));
  assert.deepEqual(chordFor({ code: 'KeyU' }, 'action', 'global'), { refused: BLOCK_WHY('U') });
  assert.deepEqual(chordFor({ code: 'Slash', shiftKey: true }, 'action', 'global'), { refused: BLOCK_WHY('Shift+/') });
  // The warehouse: only the block.
  assert.equal(bindEngineKey(emptyStore(), A321, '0', 1, 'KeyR').error, ONLY_BLOCK);
  assert.equal(bindEngineKey(emptyStore(), A321, '0', 1, 'Digit6').error, ONLY_BLOCK);
  assert.equal(bindDropKey(emptyStore(), 'design:d1', 'KeyN').error, ONLY_BLOCK);
  assert.deepEqual(chordFor({ code: 'KeyW' }, 'held', 'block'), { refused: ONLY_BLOCK });
  // Free keys are fine where they belong.
  assert.ok(bindKey(emptyStore(), 'map', 'Digit4').store);
  assert.ok(bindEngineKey(emptyStore(), A321, '0', 1, 'KeyU').store);
});

test('Shift with a block key: an action takes it (the drop); a held one (an engine’s thrust) takes the plain key', () => {
  assert.deepEqual(chordFor({ code: 'KeyP', shiftKey: true }, 'action', 'block'), { chord: 'Shift+KeyP' });
  assert.deepEqual(chordFor({ code: 'KeyU', shiftKey: true }, 'held', 'block'), { chord: 'KeyU' });
  let st = bindDropKey(emptyStore(), 'design:d1', 'Shift+KeyP').store;
  assert.equal(aircraftKeys(st, 'design:d1').drop, 'Shift+KeyP');
  st = bindEngineKey(st, 'design:d1', 'p1', 1, 'Shift+KeyU').store;
  assert.deepEqual(engineKeysOf(st, 'design:d1', 'p1'), { up: 'KeyU', down: null });
  // A held engine key and the drop on Shift with it would take one press: the drop moves it.
  const r = bindDropKey(st, 'design:d1', 'Shift+KeyU');
  assert.deepEqual(r.moved, [{ eng: 'p1', dir: 1, chord: 'KeyU' }]);   // the key it lost
  assert.deepEqual(engineKeysOf(r.store, 'design:d1', 'p1'), { up: null, down: null });
  assert.equal(clash('Shift+KeyU', 'action', 'KeyU', 'held'), true);
  assert.equal(clash('Shift+KeyG', 'action', 'KeyG', 'action'), false);
});

test('keys that do nothing on their own, and the fixed ones, can’t be bound anywhere', () => {
  for (const code of ['Backquote', 'Tab', 'CapsLock', 'Enter', 'Backspace', 'Delete', 'Escape', 'Backslash', 'F5', 'F11', 'F12']) {
    assert.ok(RESERVED.has(code), code);
    for (const where of ['global', 'block']) {
      const r = chordFor({ code }, 'action', where);
      assert.ok(r.refused, `${code} ${where}`);
      assert.equal(r.refused, RESERVED.get(code));
    }
    assert.ok(bindKey(emptyStore(), 'map', code).error, code);
  }
  assert.match(RESERVED.get('Backquote'), /^` does nothing on its own/);
  assert.match(RESERVED.get('Backslash'), /Sky window/);
  assert.match(RESERVED.get('Escape'), /menu/);
  for (const code of ['ShiftLeft', 'ShiftRight']) { assert.ok(isModifier(code)); assert.ok(chordFor({ code, shiftKey: true }).refused); }
  assert.ok(!isModifier('KeyS'));
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
    assert.ok(chordFor({ code: 'KeyW', [mod]: true }).refused);
    assert.ok(chordFor({ code: 'KeyU', [mod]: true }, 'held', 'block').refused);
  }
  assert.ok(checkChord('Ctrl+KeyW', 'action').refused);
  assert.deepEqual(chordFor({ code: 'KeyC', shiftKey: true }, 'action'), { chord: 'Shift+KeyC' });
  assert.deepEqual(chordFor({ code: 'KeyC', shiftKey: true }, 'held'), { chord: 'KeyC' });
  assert.equal(keyLabel('Shift+KeyC'), 'Shift+C');
  assert.equal(keyLabel('Minus'), '−');
  assert.equal(keyLabel('Backslash'), '\\');
  assert.equal(keyLabel('Semicolon'), ';');
  assert.equal(keyLabel('NumpadAdd'), 'Num +');
});

test('on the Controls page a key another control had moves, and says so; keys added, replaced, cleared', () => {
  let r = bindKey(emptyStore(), 'flapUp', 'KeyG');
  assert.deepEqual(r.moved, [{ id: 'gear', chord: 'KeyG', left: 0 }]);
  assert.equal(movedText(r.moved, 'KeyG'), 'G was the key for the gear, which has none now.');
  let st = r.store;
  let k = resolveKeys(st);
  assert.deepEqual(k.bind.flapUp, ['KeyG']);
  assert.deepEqual(k.bind.gear, []);
  assert.deepEqual(keymapOf(k).get('KeyG'), { kind: 'action', id: 'flapUp' });
  assert.deepEqual(st.global.bind, { gear: [], flapUp: ['KeyG'] }, 'only what differs is stored');
  // add (an index past the end), replace one, clear one, clear all
  st = bindKey(st, 'flapUp', 'Digit4', { index: 1 }).store;
  assert.deepEqual(resolveKeys(st).bind.flapUp, ['KeyG', 'Digit4']);
  st = bindKey(st, 'flapUp', 'Digit5', { index: 0 }).store;
  assert.deepEqual(resolveKeys(st).bind.flapUp, ['Digit5', 'Digit4']);
  st = clearKeys(st, 'flapUp', { index: 1 }).store;
  assert.deepEqual(resolveKeys(st).bind.flapUp, ['Digit5']);
  st = clearKeys(st, 'flapUp').store;
  assert.deepEqual(resolveKeys(st).bind.flapUp, []);
  // a second key moving from another that keeps one: no "none now"
  r = bindKey(emptyStore(), 'map', 'NumpadAdd');
  assert.deepEqual(r.moved, [{ id: 'faster', chord: 'NumpadAdd', left: 1 }]);
  assert.equal(movedText(r.moved, 'NumpadAdd'), 'Num + was the key for time faster.');
  // a held control reads its key with or without Shift: Shift+W tapped takes W from pitch down
  r = bindKey(emptyStore(), 'gear', 'Shift+KeyW');
  assert.deepEqual(r.moved, [{ id: 'pitchDown', chord: 'KeyW', left: 0 }]);
  assert.equal(movedText(r.moved, 'Shift+KeyW'), 'W was the key for pitch down, which has none now.', 'naming the key it lost');
  k = resolveKeys(bindKey(emptyStore(), 'pitchUp', 'Shift+KeyC').store);
  assert.deepEqual(k.bind.pitchUp, ['KeyC']);
  assert.deepEqual(k.bind.speedbrake, []);
  assert.deepEqual(k.bind.spoilersArm, []);
  // Reset: the Controls page's defaults back; the block's keys stay.
  st = bindEngineKey(bindKey(emptyStore(), 'map', 'Digit4').store, A321, '0', 1, 'KeyU').store;
  st = resetKeys(st, { scope: 'global' }).store;
  assert.deepEqual(resolveKeys(st).bind.map, ['KeyN']);
  assert.deepEqual(engineKeysOf(st, A321, '0'), { up: 'KeyU', down: null });
});

test('the store: v3 round-trips under gamedump:flight-sim:keys; a bad one reads as empty; a hand-edited one is cleaned', () => {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); } };
  let st = bindKey(emptyStore(), 'map', 'Digit4').store;
  st = bindEngineKey(st, B777, '1', -1, 'KeyJ').store;
  st = bindDropKey(st, 'design:d9', 'Shift+KeyP').store;
  assert.deepEqual(st, { v: 3, global: { bind: { map: ['Digit4'] } }, aircraft: { [B777]: { engines: { 1: { up: null, down: 'KeyJ' } } }, 'design:d9': { engines: {}, drop: 'Shift+KeyP' } } });
  assert.equal(saveKeys(storage, st), true);
  assert.ok(KEYS_STORE === 'gamedump:flight-sim:keys');
  assert.deepEqual(loadKeys(storage), st);
  mem.set(KEYS_STORE, '{not json');
  assert.deepEqual(loadKeys(storage), emptyStore());
  assert.deepEqual(loadKeys(null), emptyStore());
  assert.deepEqual(keysFrom(null), emptyStore());
  // By hand: a block key on the Controls page's side, a global key on an engine, a junk scope: dropped.
  const hand = keysFrom({ v: 3, global: { bind: { map: ['KeyM'], ap: ['KeyZ', 'Digit4'] } },
    aircraft: { [A321]: { engines: { 0: { up: 'KeyR', down: 'KeyJ' } }, drop: 'KeyN' }, junk: { engines: { 0: { up: 'KeyU' } } } } });
  assert.deepEqual(hand, { v: 3, global: { bind: { map: [], ap: ['KeyZ', 'Digit4'] } }, aircraft: { [A321]: { engines: { 0: { up: null, down: 'KeyJ' } } } } });
});

test('v0.5.6’s stores migrate: the global changes still valid stay; the parts’ keys and engine groups go', () => {
  const v2 = { v: 2,
    global: { bind: {
      ap: ['KeyU'],                 // a block key now: back to its default (Z)
      map: ['KeyJ', 'F4'],          // J is the block's: F4 stays
      perf: ['Backquote'],          // ` does nothing now: back to F3
      toga: [],                     // cleared: still cleared
      view: ['KeyN'],               // N is the map's new default: the map loses it, as the Controls page would do
    } },
    scopes: { [A321]: { bind: { flapUp: ['KeyJ'], gear: ['KeyU'] }, groups: [{ engines: [0], up: 'KeyI', down: null }] } } };
  const st = keysFrom(v2);
  assert.deepEqual(st, { v: 3, global: { bind: { toga: [], view: ['KeyN'], map: ['F4'] } }, aircraft: {} });
  const r = resolveKeys(st, { scope: A321, slots: ['0', '1'] });
  assert.deepEqual([r.bind.ap, r.bind.map, r.bind.perf, r.bind.toga, r.bind.view, r.bind.flapUp, r.bind.gear],
    [['KeyZ'], ['F4'], ['F3'], [], ['KeyN'], ['Minus'], ['KeyG']]);
  assert.deepEqual(r.engines, []);
  // Without the map's own change, the map keeps N, its new default, and the view goes back to V (review).
  const r2 = resolveKeys(keysFrom({ v: 2, global: { bind: { view: ['KeyN'] } }, scopes: {} }));
  assert.deepEqual([r2.bind.map, r2.bind.view], [['KeyN'], ['KeyV']]);
  // The same for the others that moved: next view onto Shift+T or Shift+G gives way to TO/GA and pushback; an old
  // change keeping another key keeps that one.
  const r3 = resolveKeys(keysFrom({ v: 2, global: { bind: { faster: ['Shift+KeyT'], localQnh: ['Shift+KeyG', 'F6'] } }, scopes: {} }));
  assert.deepEqual([r3.bind.toga, r3.bind.faster, r3.bind.pushback, r3.bind.localQnh], [['Shift+KeyT'], ['BracketRight', 'NumpadAdd'], ['Shift+KeyG'], ['F6']]);
  // The same from localStorage.
  const mem = new Map([[KEYS_STORE, JSON.stringify(v2)]]);
  assert.deepEqual(loadKeys({ getItem: (k) => mem.get(k) ?? null }), st);
  // v0.5.6's first shape (every key per aircraft, no global): nothing to keep.
  assert.deepEqual(keysFrom({ v: 1, last: A321, scopes: { [A321]: { bind: { map: ['KeyR'], ap: ['KeyU'] }, groups: [] } } }), emptyStore());
});

test('an engine’s own keys, one engine at a time: a key another part of the aircraft has moves, with a note', () => {
  let st = bindEngineKey(emptyStore(), A321, '0', 1, 'KeyU').store;
  st = bindEngineKey(st, A321, '0', -1, 'KeyJ').store;
  assert.deepEqual(engineKeysOf(st, A321, '0'), { up: 'KeyU', down: 'KeyJ' });
  assert.deepEqual(engineKeysOf(st, A321, '1'), { up: null, down: null }, 'its twin has none: engines start with none');
  // U on engine 2's up: it moves from engine 1.
  const r = bindEngineKey(st, A321, '1', 1, 'KeyU');
  assert.deepEqual(r.moved, [{ eng: '0', dir: 1, chord: 'KeyU' }]);
  assert.equal(movedText(r.moved, 'KeyU'), 'U was the key for engine 1’s thrust up, which has none now.');
  assert.equal(movedText(r.moved, 'KeyU', { engine: () => null }), '', 'an engine not shown goes quietly');
  st = r.store;
  assert.deepEqual(engineKeysOf(st, A321, '0'), { up: null, down: 'KeyJ' });
  assert.deepEqual(engineKeysOf(st, A321, '1'), { up: 'KeyU', down: null });
  // Each aircraft its own: the 777 has none.
  assert.deepEqual(resolveKeys(st, { scope: B777, slots: ['0', '1'] }).engines, []);
  // Cleared; an aircraft left with nothing isn't stored.
  st = clearEngineKey(st, A321, '0', -1).store;
  st = clearEngineKey(st, A321, '1', 1).store;
  assert.deepEqual(st.aircraft, {});
  // The drop and an engine on one aircraft: the drop takes U from the engine.
  st = bindEngineKey(emptyStore(), 'design:d1', 'p2', 1, 'KeyU').store;
  const d = bindDropKey(st, 'design:d1', 'KeyU');
  assert.equal(movedText(d.moved, 'KeyU', { engine: (s) => (s === 'p2' ? 'engine 2' : null) }), 'U was the key for engine 2’s thrust up, which has none now.');
  assert.equal(clearDropKey(d.store, 'design:d1').store.aircraft['design:d1'], undefined);
});

test('a design’s engines by part id: the sim’s order isn’t the parts’, and deleting one engine shifts no other’s keys', () => {
  // Four engines: p1/p2 the base pair, p3/p4 outboard. The sim orders them left outboard to right outboard.
  let d = newDesign('a321neo', { id: 'dk' });
  d = addPart(d, { kind: 'engine', engine: d.parts[0].engine, mount: 'wing', side: 1, s: 10 }, { mirror: true });
  const def = designDef(d);
  assert.deepEqual(d.parts.map((p) => p.id), ['p1', 'p2', 'p3', 'p4']);
  const slots = engineSlots(def);
  assert.deepEqual(slots, ['p3', 'p1', 'p2', 'p4']);
  assert.deepEqual(engineSlots(resolveDef('a321neo')), ['0', '1'], 'a type’s by index');
  assert.deepEqual(scopeOf(def), { scope: 'design:dk', base: 'type:a321neo' });
  let st = bindEngineKey(emptyStore(), 'design:dk', 'p3', 1, 'KeyI').store;
  st = bindEngineKey(st, 'design:dk', 'p4', 1, 'KeyO').store;
  st = bindEngineKey(st, 'design:dk', 'p1', 1, 'KeyU').store;
  let r = resolveKeys(st, { scope: 'design:dk', slots });
  assert.deepEqual(r.engines.map((e) => [e.i, e.slot, e.up]), [[0, 'p3', 'KeyI'], [1, 'p1', 'KeyU'], [3, 'p4', 'KeyO']]);
  // p1 removed (and its twin p2): saved, its keys go (keepEngineKeys with the engines left); p3's and p4's stay theirs.
  const d2 = removePart(d, 'p1');
  assert.deepEqual(d2.parts.map((p) => p.id), ['p3', 'p4']);
  st = keepEngineKeys(st, 'design:dk', d2.parts.map((p) => p.id)).store;
  assert.deepEqual(Object.keys(aircraftKeys(st, 'design:dk').engines).sort(), ['p3', 'p4']);
  r = resolveKeys(st, { scope: 'design:dk', slots: engineSlots(designDef(d2)) });
  assert.deepEqual(r.engines.map((e) => [e.i, e.slot, e.up]), [[0, 'p3', 'KeyI'], [1, 'p4', 'KeyO']]);
  // A new part with a removed one's id starts with none (the warehouse drops the stale keys: dropEngineKeys).
  st = dropEngineKeys(st, 'design:dk', ['p4']).store;
  assert.deepEqual(engineKeysOf(st, 'design:dk', 'p4'), { up: null, down: null });
  assert.deepEqual(engineKeysOf(st, 'design:dk', 'p3'), { up: 'KeyI', down: null });
});

test('v0.5.7 review: the Drop key goes with the last wing tank; it stays while one is left', () => {
  let st = bindDropKey(emptyStore(), 'design:dt', 'KeyP').store;
  st = bindEngineKey(st, 'design:dt', 'p1', 1, 'KeyU').store;
  // Saved with a wing tank still on: the Drop key stays.
  assert.equal(aircraftKeys(keepEngineKeys(st, 'design:dt', ['p1'], { drop: true }).store, 'design:dt').drop, 'KeyP');
  // Saved with none: it goes, the engine's keys stay.
  const left = keepEngineKeys(st, 'design:dt', ['p1'], { drop: false }).store;
  assert.equal(aircraftKeys(left, 'design:dt').drop ?? null, null);
  assert.deepEqual(engineKeysOf(left, 'design:dt', 'p1'), { up: 'KeyU', down: null });
  // With nothing left at all, the aircraft's entry goes.
  assert.equal(keepEngineKeys(bindDropKey(emptyStore(), 'design:dz', 'KeyP').store, 'design:dz', [], { drop: false }).store.aircraft['design:dz'], undefined);
});

test('a design duplicated takes its keys; deleted, they go', () => {
  let st = bindEngineKey(emptyStore(), 'design:a', 'p1', 1, 'KeyU').store;
  st = bindDropKey(st, 'design:a', 'Shift+KeyP').store;
  st = copyKeys(st, 'design:a', 'design:b').store;
  assert.deepEqual(aircraftKeys(st, 'design:b'), aircraftKeys(st, 'design:a'));
  st = resetKeys(st, { scope: 'design:a' }).store;
  assert.equal(st.aircraft['design:a'], undefined);
  assert.deepEqual(engineKeysOf(st, 'design:b', 'p1'), { up: 'KeyU', down: null });
  // the engines' names for a stock type's tabs
  assert.deepEqual(enginesOf(resolveDef('b777-300er')).map((e) => e.side).sort(), ['left', 'right']);
});

test('the flight’s key map: the aircraft’s engines and drop with the Controls page’s keys', () => {
  let st = bindEngineKey(emptyStore(), A321, '1', 1, 'KeyU').store;
  st = bindEngineKey(st, A321, '1', -1, 'KeyJ').store;
  st = bindKey(st, 'map', 'Digit4').store;
  const m = keymapOf(resolveKeys(st, { scope: A321, slots: ['0', '1'] }));
  assert.deepEqual(m.get('KeyU'), { kind: 'engine', i: 1, dir: 1 });
  assert.deepEqual(m.get('KeyJ'), { kind: 'engine', i: 1, dir: -1 });
  assert.deepEqual(m.get('Digit4'), { kind: 'action', id: 'map' });
  assert.equal(m.get('KeyN'), undefined);
  // An engine the aircraft doesn't have (slots) has no keys in flight.
  assert.equal(keymapOf(resolveKeys(st, { scope: A321, slots: ['0'] })).get('KeyU'), undefined);
  // The drop is the design's.
  const sd = bindDropKey(emptyStore(), 'design:d1', 'Shift+KeyP').store;
  assert.deepEqual(keymapOf(resolveKeys(sd, { scope: 'design:d1', slots: [] })).get('Shift+KeyP'), { kind: 'action', id: 'dropTanks' });
  assert.equal(keymapOf(resolveKeys(sd, { scope: A321, slots: ['0', '1'] })).get('Shift+KeyP'), undefined);
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
const hold = (input, c, secs, onGround = false, athr = false) => { for (let i = 0; i < Math.round(secs * 30); i++) input.update(1 / 30, c, onGround, athr); };

test('input: the moved keys; Esc is always the menu; L, M, P, O, K and ` do nothing by default', async () => {
  const { input, down } = await fakeInput();
  const seen = [];
  input.onAction((a) => seen.push(a));
  for (const c of ['KeyL', 'KeyM', 'KeyP', 'KeyO', 'KeyK', 'Backquote', 'Backslash', 'Digit7']) down(c);
  assert.deepEqual(seen, []);
  down('KeyN'); down('KeyG', { shiftKey: true }); down('KeyG'); down('KeyT', { shiftKey: true }); down('KeyT'); down('KeyB', { shiftKey: true }); down('F3'); down('Escape');
  assert.deepEqual(seen, ['map', 'pushback', 'gear', 'toga', 'rewind', 'localQnh', 'perf', 'pause']);
  // Rebound (a Controls page key): Digit4 is the map, N nothing.
  input.setBindings(resolveKeys(bindKey(emptyStore(), 'map', 'Digit4').store, { scope: A321, slots: ['0', '1'] }));
  seen.length = 0;
  down('Digit4'); down('KeyN');
  assert.deepEqual(seen, ['map']);
  // A design's drop key (main.js: dropWingTanks()).
  input.setBindings(resolveKeys(bindDropKey(emptyStore(), 'design:d1', 'Shift+KeyP').store, { scope: 'design:d1', slots: ['p1', 'p2'] }));
  seen.length = 0;
  down('KeyP', { shiftKey: true }); down('KeyP');
  assert.deepEqual(seen, ['dropTanks']);
});

test('input: with no engine keys used, the lever takes the single-lever path exactly (thrustEng stays null)', async () => {
  const a = await fakeInput(), b = await fakeInput();
  b.input.setEngineCount(2);
  b.input.setBindings(resolveKeys(bindEngineKey(emptyStore(), A321, '0', 1, 'KeyU').store, { scope: A321, slots: ['0', '1'] }));
  const ca = controls0(), cb = controls0();
  const seq = [['KeyR', 1.4, false], [null, 0.3, false], ['KeyF', 2.5, true], [null, 0.2, true], ['KeyR', 0.5, true]];
  for (const [k, secs, ground] of seq) {
    if (k) { a.down(k); b.down(k); }
    hold(a.input, ca, secs, ground); hold(b.input, cb, secs, ground);
    if (k) { a.up(k); b.up(k); }
    assert.equal(cb.thrustEng, null);
    assert.equal(cb.thrust, ca.thrust);
  }
  assert.ok(ca.thrust !== 0);
});

test('input: R and F move every lever, the keyed engine’s too; an engine’s own keys move its lever alone', async () => {
  const { input, down, up } = await fakeInput();
  const st = bindEngineKey(bindEngineKey(emptyStore(), A321, '0', 1, 'KeyU').store, A321, '0', -1, 'KeyJ').store;
  input.setEngineCount(2);
  input.setBindings(resolveKeys(st, { scope: A321, slots: ['0', '1'] }));
  assert.deepEqual(input.engines, [{ i: 0, up: ['KeyU'], down: ['KeyJ'] }]);
  const c = controls0();
  down('KeyU'); hold(input, c, 0.8); up('KeyU');
  assert.ok(Array.isArray(c.thrustEng) && c.thrustEng.length === 2, JSON.stringify(c));
  assert.ok(c.thrustEng[0] > 0.3 && c.thrustEng[1] === 0, JSON.stringify(c.thrustEng));
  assert.equal(c.thrust, c.thrustEng[0], 'apart, the all-engines lever is the highest');
  assert.equal(input.leverHeld(), false);
  // R: both (engine 1 too), at the same rate while no detent stops one.
  const before = c.thrustEng.slice();
  down('KeyR'); hold(input, c, 0.1); up('KeyR');
  const d0 = c.thrustEng[0] - before[0], d1 = c.thrustEng[1] - before[1];
  assert.ok(d1 > 0.04 && Math.abs(d0 - d1) < 1e-9, `${d0} ${d1}`);
  // Engine 1 at full: R still lifts engine 2 (each lever moves on its own, pausing at its own detents).
  down('KeyU'); hold(input, c, 3); up('KeyU');
  assert.equal(c.thrustEng[0], 1);
  const e1 = c.thrustEng[1];
  down('KeyR'); hold(input, c, 0.3); up('KeyR');
  assert.ok(c.thrustEng[0] === 1 && c.thrustEng[1] > e1 + 0.1, JSON.stringify(c.thrustEng));
  assert.equal(c.thrust, 1);
  // Holding R and engine 1's own down key: engine 1 goes down (its own keys first), engine 2 up.
  const both = c.thrustEng.slice();
  down('KeyR'); down('KeyJ'); hold(input, c, 0.1); up('KeyJ'); up('KeyR');
  assert.ok(c.thrustEng[0] < both[0] && c.thrustEng[1] > both[1], JSON.stringify([both, c.thrustEng]));
  // F in the air: every lever down to idle; none below it.
  down('KeyF'); hold(input, c, 5); up('KeyF');
  assert.deepEqual(c.thrustEng, [0, 0]);
  // Engine 1's own up key again, then its down key: its lever alone, back to idle.
  down('KeyU'); hold(input, c, 0.6); up('KeyU');
  const e0 = c.thrustEng[0];
  assert.ok(e0 > 0.2 && c.thrustEng[1] === 0);
  down('KeyJ'); hold(input, c, 0.2); up('KeyJ');
  assert.ok(c.thrustEng[0] < e0 && c.thrustEng[1] === 0);
  // Setting the lever (a new flight, a skip to final) brings them together.
  input.lever = 0;
  assert.equal(input.levers, null);
});

test('input: an engine’s own down key held at idle on the ground holds its reverse; F the reverse of all; not in the air', async () => {
  const { input, down, up } = await fakeInput();
  input.setEngineCount(2);
  input.setBindings(resolveKeys(bindEngineKey(emptyStore(), A321, '1', -1, 'KeyJ').store, { scope: A321, slots: ['0', '1'] }));
  const c = controls0();
  // In the air: it stops at idle.
  down('KeyJ'); hold(input, c, 1.5, false); up('KeyJ');
  assert.ok(c.thrustEng === null || c.thrustEng.every((x) => x === 0), JSON.stringify(c.thrustEng));
  // On the ground, held at idle: after the reverse delay, engine 2's lever alone into reverse.
  down('KeyJ'); hold(input, c, 0.2, true);
  assert.ok(!c.thrustEng || c.thrustEng[1] === 0, 'not before the delay');
  hold(input, c, 1.5, true); up('KeyJ');
  assert.ok(c.thrustEng[1] < -0.5 && c.thrustEng[0] === 0, JSON.stringify(c.thrustEng));
  assert.equal(c.thrust, 0, 'the all-engines lever (the highest) at idle');
  // F held at idle on the ground: every lever into reverse.
  down('KeyF'); hold(input, c, 2, true); up('KeyF');
  assert.ok(c.thrustEng.every((x) => x < -0.5), JSON.stringify(c.thrustEng));
  // R: out of reverse, each stopping at idle.
  down('KeyR'); hold(input, c, 3, true); up('KeyR');
  assert.ok(c.thrustEng.every((x) => x >= 0), JSON.stringify(c.thrustEng));
});

test('input: the A/THR driving; an engine’s own key takes the levers (engineTook: main.js disconnects a Boeing’s A/T), R/F don’t flag it', async () => {
  const { input, down, up } = await fakeInput();
  input.setEngineCount(2);
  input.setBindings(resolveKeys(bindEngineKey(emptyStore(), A321, '0', 1, 'KeyU').store, { scope: A321, slots: ['0', '1'] }));
  const c = controls0();
  c.thrust = 0.5;
  input.update(1 / 30, c, false, true);
  assert.equal(c.thrustEng, null);
  assert.equal(c.thrust, 0.5);
  assert.equal(input.engineTook, false);
  down('KeyU');
  input.update(0.2, c, false, true);
  assert.equal(input.engineTook, true);
  assert.equal(input.groupTook, true, 'v0.5.6’s name');
  up('KeyU');
  assert.ok(Array.isArray(c.thrustEng) && c.thrustEng[1] === 0.5 && c.thrustEng[0] > 0.5, JSON.stringify(c));
  input.update(1 / 30, c, false, false);
  assert.equal(input.engineTook, false);
  // R while it drives: the lever is taken (the sim disconnects the A/THR), but not as an engine's key.
  c.thrustEng = null; c.thrust = 0.5;
  down('KeyR'); input.update(0.2, c, false, true); up('KeyR');
  assert.equal(input.engineTook, false);
  assert.ok(c.thrust > 0.5);
});

// ---- the sim's split levers ----
test('sim: levers apart but equal fly exactly as together; apart, the engines and the yaw follow their own', () => {
  const a = airborne({ altFt: 8000, iasKt: 250 }), b = airborne({ altFt: 8000, iasKt: 250 });
  const lever = 0.45;
  run(a, 20, (s) => { s.controls.thrust = lever; s.controls.thrustEng = null; });
  run(b, 20, (s) => { s.controls.thrust = lever; s.controls.thrustEng = [lever, lever]; });
  assert.deepEqual(JSON.parse(JSON.stringify(b.state)), JSON.parse(JSON.stringify(a.state)));
  const c = airborne({ altFt: 8000, iasKt: 250 });
  run(c, 15, (s) => { s.controls.thrust = 0.3; s.controls.thrustEng = [1, 0]; });
  const [e0, e1] = c.state.engines;
  assert.ok(e0.n1 > e1.n1 + 15 && e0.thrustN > 2 * e1.thrustN, `${e0.n1} ${e1.n1}`);
  assert.ok(e0.leverN1 > e1.leverN1 + 15 && c.state.engines.every((e) => Number.isFinite(e.leverN1)), `${e0.leverN1} ${e1.leverN1}`);
  const y0 = c.type.geo.ENGINES[0].y;
  assert.ok(Math.sign(c.state.r) === Math.sign(y0) || Math.sign(c.state.beta) === -Math.sign(y0), `r ${c.state.r} beta ${c.state.beta} y0 ${y0}`);
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
  s.controls.thrustEng = [s.controls.thrust, s.controls.thrust];
  s.step(1 / 120);
  assert.equal(s.controls.thrustEng, null);
  assert.equal(s.state.athrActive, true);
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

test('sim: one engine in its own reverse on the ground, the other at idle: only that one reverses', () => {
  const s = airborne({ altFt: 8000, iasKt: 250 });
  // on the runway, rolling: a reset on the ground
  s.reset({ x: 0, y: 0, hdg: 0, onGround: true, iasMs: 60, flapLever: 0, gearDown: true, fuelKg: 8000, payloadKg: 10000 });
  run(s, 3, (x) => { x.controls.thrust = 0; x.controls.thrustEng = [-1, 0]; });
  const [e0, e1] = s.state.engines;
  assert.ok(e0.rev > 0.5 && !(e1.rev > 0.05), `${e0.rev} ${e1.rev}`);
});
