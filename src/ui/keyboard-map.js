// v0.5.7: the keyboard on the Controls page (Shane: "put something similar in the controls tab of the game"). A Mac
// keyboard without its F-row and arrows, each key shaded by who sets it: the warehouse's block (each aircraft's own),
// the Controls page (the same for every aircraft, the free keys too), or nothing (Shane: "Grey out the ` tab caps
// return delete and the two shift keys, since their single shouldn't result in anything"). Hovering a key says what it
// does; a row of the page's list lights its keys (highlight()). The layout and the words are pure (tested in node:
// tests/keyboard-map.test.mjs); renderKeyboard() draws them as SVG, scaled to the page's width. Its styles are
// menu.css's "Controls page: the keyboard" block (fskb-*).
//
//   const kb = renderKeyboard(el, { sky });   kb.update(resolved)   kb.highlight([codes])   kb.el

import { BINDINGS, BLOCK, DEAD_KEYS, keyLabel } from '../keys.js';

// Key pitch 40 px, keys 36 px; x and widths in key units. Rows of [code, label, width].
export const PITCH = 40, KEY = 36;
export const ROWS = [
  [['Backquote', '`'], ['Digit1', '1'], ['Digit2', '2'], ['Digit3', '3'], ['Digit4', '4'], ['Digit5', '5'], ['Digit6', '6'],
    ['Digit7', '7'], ['Digit8', '8'], ['Digit9', '9'], ['Digit0', '0'], ['Minus', '−'], ['Equal', '='], ['Backspace', 'delete', 2]],
  [['Tab', 'tab', 1.5], ['KeyQ', 'Q'], ['KeyW', 'W'], ['KeyE', 'E'], ['KeyR', 'R'], ['KeyT', 'T'], ['KeyY', 'Y'], ['KeyU', 'U'],
    ['KeyI', 'I'], ['KeyO', 'O'], ['KeyP', 'P'], ['BracketLeft', '['], ['BracketRight', ']'], ['Backslash', '\\', 1.5]],
  [['CapsLock', 'caps lock', 1.75], ['KeyA', 'A'], ['KeyS', 'S'], ['KeyD', 'D'], ['KeyF', 'F'], ['KeyG', 'G'], ['KeyH', 'H'],
    ['KeyJ', 'J'], ['KeyK', 'K'], ['KeyL', 'L'], ['Semicolon', ';'], ['Quote', '\''], ['Enter', 'return', 2.25]],
  [['ShiftLeft', 'shift', 2.25], ['KeyZ', 'Z'], ['KeyX', 'X'], ['KeyC', 'C'], ['KeyV', 'V'], ['KeyB', 'B'], ['KeyN', 'N'],
    ['KeyM', 'M'], ['Comma', ','], ['Period', '.'], ['Slash', '/'], ['ShiftRight', 'shift', 2.75]],
];
// The space bar, under them: about 6 units from unit 4.
export const SPACE = { code: 'Space', label: '', x: 4, w: 6, row: 4 };

// Every key: { code, label, x, w, row } in key units.
export function layout() {
  const out = [];
  ROWS.forEach((row, r) => {
    let x = 0;
    for (const [code, label, w = 1] of row) { out.push({ code, label, x, w, row: r }); x += w; }
  });
  out.push({ ...SPACE });
  return out;
}
export const UNITS_WIDE = 15, ROWS_HIGH = 5;
export const WIDTH = UNITS_WIDE * PITCH - (PITCH - KEY), HEIGHT = ROWS_HIGH * PITCH - (PITCH - KEY);

const BLOCK_SET = new Set(BLOCK), GREY_SET = new Set(DEAD_KEYS);
// Who sets a key: 'block' (the warehouse, each aircraft's own), 'grey' (nothing: it does nothing on its own) or
// 'global' (the Controls page, the same for every aircraft; free keys and the space bar too).
export const toneOf = (code) => (BLOCK_SET.has(code) ? 'block' : GREY_SET.has(code) ? 'grey' : 'global');
export const TONES = {
  block: 'Set in the warehouse, each aircraft’s own',
  global: 'Set here, the same for every aircraft',
  grey: 'Does nothing on its own',
};

// A key's own name in a tooltip: the drawing's for the Mac's named keys, else as the game prints it.
const NAMES = { Backquote: '`', Tab: 'tab', CapsLock: 'caps lock', Enter: 'return', Backspace: 'delete', ShiftLeft: 'shift', ShiftRight: 'shift', Space: 'Space' };
const nameOf = (code) => NAMES[code] || keyLabel(code);
const what = (b) => (b.tip || b.short || b.label).replace(/^the /, '');

// What each key does with the keys as resolved (keys.js resolveKeys(); the global ones): code → [{ chord, id }].
export function usesOf(resolved) {
  const out = new Map();
  for (const b of BINDINGS) {
    for (const c of resolved?.bind?.[b.id] || []) {
      const code = c.replace(/^Shift\+/, '');
      if (!out.has(code)) out.set(code, []);
      out.get(code).push({ chord: c, id: b.id });
    }
  }
  return out;
}
// A key's tooltip: "W: pitch down", "T: rewind · Shift+T: the TO/GA switches", "U: in the warehouse’s block",
// "4: free", "tab: does nothing on its own".
export function keyTip(code, uses, { sky = true } = {}) {
  const n = nameOf(code);
  const tone = toneOf(code);
  if (tone === 'block') return `${n}: in the warehouse’s block`;
  if (tone === 'grey') return code.startsWith('Shift') ? `${n}: nothing on its own (with a key it makes Shift+ that key)` : `${n}: does nothing on its own`;
  if (code === 'Backslash') return `${n}: the ${sky ? 'Sky' : 'Weight'} window (it can’t be changed)`;
  const list = (uses?.get(code) || []).slice().sort((a, b) => a.chord.length - b.chord.length);
  if (!list.length) return `${n}: free`;
  return list.map((u) => `${keyLabel(u.chord)}: ${what(BINDINGS.find((b) => b.id === u.id))}`).join(' · ');
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The drawing, in `root`: the keys, a legend under them, a tooltip. update(resolved) shades the bound keys and
// rewrites the tooltips; highlight(codes) lights keys (a row of the list hovered or focused).
export function renderKeyboard(root, { sky = true } = {}) {
  const el = document.createElement('div');
  el.className = 'fskb';
  const keys = layout();
  const rect = (k) => {
    const x = k.x * PITCH, y = k.row * PITCH, w = k.w * PITCH - (PITCH - KEY);
    const small = k.label.length > 1;
    const label = small
      ? `<text class="fskb-t small" x="${x + 6}" y="${y + KEY - 7}">${esc(k.label)}</text>`
      : `<text class="fskb-t" x="${x + w / 2}" y="${y + KEY / 2 + 5}" text-anchor="middle">${esc(k.label)}</text>`;
    return `<g class="fskb-k ${toneOf(k.code)}" data-code="${k.code}"><rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${KEY - 1}" rx="5" ry="5"/>${label}</g>`;
  };
  el.innerHTML = `
    <svg class="fskb-svg" viewBox="-2 -2 ${WIDTH + 4} ${HEIGHT + 4}" role="img" aria-label="The keyboard: who sets each key">${keys.map(rect).join('')}</svg>
    <p class="fskb-tip" hidden></p>
    <p class="fskb-legend"><span><i class="block"></i>${esc(TONES.block)}</span><span><i class="global"></i>${esc(TONES.global)} (faint: free)</span><span><i class="grey"></i>${esc(TONES.grey)}</span></p>`;
  root.appendChild(el);
  const svg = el.querySelector('svg'), tipEl = el.querySelector('.fskb-tip');
  const byCode = new Map([...el.querySelectorAll('.fskb-k')].map((g) => [g.dataset.code, g]));
  let uses = new Map();

  function update(resolved) {
    uses = usesOf(resolved);
    for (const [code, g] of byCode) {
      g.classList.toggle('free', toneOf(code) === 'global' && code !== 'Backslash' && !uses.has(code));
      g.setAttribute('aria-label', keyTip(code, uses, { sky }));
    }
  }
  function showTip(g) {
    if (!g) { tipEl.hidden = true; return; }
    tipEl.textContent = keyTip(g.dataset.code, uses, { sky });
    tipEl.hidden = false;
    const box = el.getBoundingClientRect(), r = g.getBoundingClientRect();
    const w = tipEl.offsetWidth;
    tipEl.style.left = `${Math.max(0, Math.min(box.width - w, r.left - box.left + r.width / 2 - w / 2))}px`;
    tipEl.style.top = `${Math.max(0, r.top - box.top - tipEl.offsetHeight - 6)}px`;
  }
  svg.addEventListener('pointerover', (e) => showTip(e.target.closest?.('.fskb-k')));
  svg.addEventListener('pointerleave', () => showTip(null));
  function highlight(codes) {
    const on = new Set(codes || []);
    for (const [code, g] of byCode) g.classList.toggle('hl', on.has(code));
    svg.classList.toggle('lit', on.size > 0);
  }
  update(null);
  return { el, update, highlight, keyEl: (code) => byCode.get(code) || null };
}
// The keys a row lights: its chords' keys, and both Shifts for a Shift+ chord.
export function codesOf(chords) {
  const out = new Set();
  for (const c of chords || []) {
    if (!c) continue;
    if (c.startsWith('Shift+')) { out.add('ShiftLeft'); out.add('ShiftRight'); }
    out.add(c.replace(/^Shift\+/, ''));
  }
  return [...out];
}
