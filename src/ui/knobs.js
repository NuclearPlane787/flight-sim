// The knob windows' input, shared by the A321's FCU (fcu.js) and the Boeings' MCP (boeing/mcp.js):
// scrolling a window turns its knob, clicking one types a value. fcu.js's header says how each
// behaves for the player. What a window holds and what setting it does belongs to the strip that
// calls this; only the handling of the wheel, the clicks and the keys lives here.
//
//   bindKnobs(el, {
//     windows,          { k: { step, big } }: read on every turn, so `big` can be a getter
//     getView,          () => the HUD's view (nothing turns without view.ap)
//     current(k),       what the window holds now, in its own units
//     setValue(k, v),   turn the window to v
//     commit(k, text),  Enter or a second click, with what was typed ('' for nothing)
//     acceptKey(edit, key), true if a key other than a digit belongs in the text (it adds it)
//     refresh(),        redraw the strip
//     poke(),           ask the HUD to redraw soon
//     onClick(e),       a click that wasn't on a window
//   }) -> { selected, edit, close() }

const PX_PER_STEP = 12;   // trackpad scrolling per step
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

export function bindKnobs(el, { windows, getView, current, setValue, commit, acceptKey, refresh, poke, onClick }) {
  let selected = null, acc = 0, recent = [];
  let edit = null;   // the window being typed into: { k, text }

  function turn(k, steps) {
    if (!getView()?.ap) return;
    // Fast turning (more than 6 steps in 0.3 s) moves in big steps.
    const now = performance.now();
    recent = recent.filter((t) => now - t < 300); recent.push(now);
    const W = windows[k], big = recent.length > 6, st = big ? W.big : W.step;
    const base = Math.round(current(k) / st) * st;
    setValue(k, base + Math.sign(steps) * st * (big ? 1 : Math.abs(steps)));
    poke();
  }

  // ---- typing a value ----
  function openEdit(k) { edit = { k, text: '' }; selected = k; refresh(); }
  function closeEdit(apply) {
    if (!edit) return;
    const { k, text } = edit;
    edit = null;
    if (apply) commit(k, text);
    refresh();
  }
  // While a window is open the strip reads the keys first (capture phase, before the game).
  window.addEventListener('keydown', (e) => {
    if (!edit || MODIFIERS.has(e.key)) return;
    const key = e.key, k = edit.k, W = windows[k];
    let used = true;
    if (/^[0-9]$/.test(key)) { if (edit.text.replace('-', '').length < 5) edit.text += key; }
    else if (acceptKey(edit, key)) { /* it added the key */ }
    else if (key === 'Backspace') edit.text = edit.text.slice(0, -1);
    else if (key === 'Enter') closeEdit(true);
    else if (key === 'Escape') closeEdit(false);
    else if (key === 'ArrowUp' || key === 'ArrowDown') { edit.text = ''; turn(k, (key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? W.big / W.step : 1)); }
    else used = false;
    if (used) { e.preventDefault(); e.stopImmediatePropagation(); refresh(); }
    else closeEdit(false);   // a flying key: the window closes and the key goes on to the game
  }, true);
  // A click anywhere else closes it unchanged.
  window.addEventListener('pointerdown', (e) => { if (edit && !el.contains(e.target)) closeEdit(false); }, true);

  el.addEventListener('wheel', (e) => {
    e.preventDefault(); e.stopPropagation();
    const w = e.target.closest('.fsui-win');
    if (w) selected = w.dataset.k;
    if (!selected) return;
    if (edit) { edit = null; refresh(); }
    // Mouse wheels send ~100 per notch (one step); trackpads many small deltas.
    const notch = e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
    if (notch) { turn(selected, Math.sign(e.deltaY)); return; }
    acc += e.deltaY;
    const n = Math.trunc(acc / PX_PER_STEP);
    if (n) { acc -= n * PX_PER_STEP; turn(selected, Math.sign(n) * Math.min(Math.abs(n), 4)); }
  }, { passive: false });
  el.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('dblclick', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const w = e.target.closest('.fsui-win');
    if (w) {
      if (edit && edit.k === w.dataset.k) closeEdit(true);   // a second click sets it, like Enter
      else openEdit(w.dataset.k);
      return;
    }
    onClick(e);
  });

  return { get selected() { return selected; }, get edit() { return edit; }, close() { closeEdit(false); } };
}
