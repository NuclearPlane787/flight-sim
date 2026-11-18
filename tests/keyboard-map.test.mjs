// v0.5.7: the Controls page's keyboard (src/ui/keyboard-map.js): a Mac keyboard without its F-row and arrows, each key
// shaded by who sets it (Shane: "Grey out the ` tab caps return delete and the two shift keys, since their single
// shouldn't result in anything. Everything else is shaded one of two colours"): the block's 16 keys (the warehouse's,
// each aircraft's own), every other key (the Controls page's, the same for every aircraft, the free ones and the space
// bar too). Hovering a key says what it does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { layout, ROWS, SPACE, PITCH, KEY, WIDTH, HEIGHT, toneOf, keyTip, usesOf, codesOf, TONES } from '../src/ui/keyboard-map.js';
import { BLOCK, BINDINGS, resolveKeys, bindKey, emptyStore } from '../src/keys.js';

test('the layout: four rows 15 units wide, the space bar under them, every key once', () => {
  const keys = layout();
  assert.equal(PITCH, 40); assert.equal(KEY, 36);
  for (const [r, row] of ROWS.entries()) {
    const w = row.reduce((s, [, , u = 1]) => s + u, 0);
    assert.equal(w, 15, `row ${r}`);
  }
  assert.deepEqual(ROWS[0].map(([c]) => c).slice(-3), ['Minus', 'Equal', 'Backspace']);
  assert.deepEqual(ROWS[1][0], ['Tab', 'tab', 1.5]); assert.deepEqual(ROWS[1].at(-1), ['Backslash', '\\', 1.5]);
  assert.deepEqual(ROWS[2][0], ['CapsLock', 'caps lock', 1.75]); assert.deepEqual(ROWS[2].at(-1), ['Enter', 'return', 2.25]);
  assert.deepEqual(ROWS[3][0], ['ShiftLeft', 'shift', 2.25]); assert.deepEqual(ROWS[3].at(-1), ['ShiftRight', 'shift', 2.75]);
  assert.deepEqual(ROWS[0][13], ['Backspace', 'delete', 2]);
  assert.deepEqual(keys.find((k) => k.code === 'Space'), { code: 'Space', label: '', x: 4, w: 6, row: 4 });
  assert.equal(SPACE.x + SPACE.w <= 15, true);
  const codes = keys.map((k) => k.code);
  assert.equal(new Set(codes).size, codes.length, 'every key once');
  assert.equal(keys.length, 14 + 14 + 13 + 12 + 1);
  // No F-row, no arrows.
  assert.ok(!codes.some((c) => /^F\d|^Arrow|^Escape$/.test(c)));
  // Its size: 40 px a key, so it fits the page's usual widths (the SVG scales down below them).
  assert.equal(WIDTH, 596); assert.equal(HEIGHT, 196);
});

test('the shading: the block’s 16, the grey set, every other key the Controls page’s; no key in two colours', () => {
  const keys = layout(), codes = keys.map((k) => k.code);
  const of = (tone) => codes.filter((c) => toneOf(c) === tone);
  assert.deepEqual(of('block').sort(), BLOCK.slice().sort());
  assert.equal(of('block').length, 16);
  assert.deepEqual(of('grey').sort(), ['Backquote', 'Backspace', 'CapsLock', 'Enter', 'ShiftLeft', 'ShiftRight', 'Tab']);
  // Each key one tone; the three cover the keyboard.
  for (const c of codes) assert.equal(['block', 'grey', 'global'].filter((t) => toneOf(c) === t).length, 1, c);
  assert.equal(of('block').length + of('grey').length + of('global').length, codes.length);
  // The space bar, the free keys, \ and every default key are the Controls page's.
  for (const c of ['Space', 'Digit4', 'Quote', 'Backslash', 'BracketLeft', 'KeyN']) assert.equal(toneOf(c), 'global', c);
  for (const b of BINDINGS) for (const c of b.keys) if (codes.includes(c.replace(/^Shift\+/, ''))) assert.equal(toneOf(c.replace(/^Shift\+/, '')), 'global', `${b.id} ${c}`);
  assert.deepEqual(Object.keys(TONES).sort(), ['block', 'global', 'grey']);
});

test('the tooltips: what a key does, the block’s, the free ones, the grey ones; they follow a change', () => {
  let uses = usesOf(resolveKeys(null));
  assert.equal(keyTip('KeyW', uses), 'W: pitch down');
  assert.equal(keyTip('KeyN', uses), 'N: map');
  assert.equal(keyTip('KeyU', uses), 'U: in the warehouse’s block');
  assert.equal(keyTip('Digit4', uses), '4: free');
  assert.equal(keyTip('KeyT', uses), 'T: rewind · Shift+T: TO/GA switches');
  assert.equal(keyTip('KeyG', uses), 'G: gear · Shift+G: pushback');
  assert.equal(keyTip('KeyC', uses), 'C: speed brakes · Shift+C: arm the ground spoilers');
  assert.equal(keyTip('Space', uses), 'Space: wheel brakes');
  assert.equal(keyTip('Tab', uses), 'tab: does nothing on its own');
  assert.equal(keyTip('Backquote', uses), '`: does nothing on its own');
  assert.match(keyTip('ShiftLeft', uses), /^shift: nothing on its own/);
  assert.equal(keyTip('Backslash', uses), '\\: the Sky window (it can’t be changed)');
  assert.equal(keyTip('Backslash', uses, { sky: false }), '\\: the Weight window (it can’t be changed)');
  // The map moved to 4: 4 says so, N is free.
  uses = usesOf(resolveKeys(bindKey(emptyStore(), 'map', 'Digit4').store));
  assert.equal(keyTip('Digit4', uses), '4: map');
  assert.equal(keyTip('KeyN', uses), 'N: free');
  // A row lights its keys, and both Shifts for a Shift+ key.
  assert.deepEqual(codesOf(['KeyG']), ['KeyG']);
  assert.deepEqual(codesOf(['Shift+KeyT']).sort(), ['KeyT', 'ShiftLeft', 'ShiftRight']);
  assert.deepEqual(codesOf([]), []);
});
