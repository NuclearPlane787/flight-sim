// The FCU strip at the top: SPD, HDG, ALT and V/S windows, AP1 and A/THR, and a small
// LAW switch. It calls the `ap` methods from the interface.
//
// - Scroll over a window to turn its knob; scroll fast and it turns in big steps (10 kt, 10°,
//   1,000 ft, 500 ft/min). Swiping up (deltaY > 0 with macOS natural scrolling) turns it up.
//   Click a window, then scroll anywhere on the strip.
// - Click a window to type a value: digits, then Enter (or a second click) sets it and pushes
//   the knob (ALT starts a level change, V/S engages V/S); Enter alone just pushes. Esc, a
//   click elsewhere or any flying key closes it unchanged; ↑ ↓ turn it (Shift: big steps).
//   An ALT under 1,000 is a flight level (350 = 35,000 ft); a V/S of 60 or less is in
//   hundreds (−15 = −1,500 ft/min).
//
// Until v0.1.4 a click only pushed the knob, and a trackpad turned it 1 step per 25 px, with
// nothing on screen saying so (Shane: "I can't change the autopilot's heading from 066").
// Plain divs, never focusable: the keyboard stays with the game, except that while a window
// is open the FCU reads the keys first.

import { clamp, wrap360 } from './common.js';

const WINDOWS = [
  { k: 'spd', label: 'SPD', step: 1, big: 10, tip: 'Speed (kt)' },
  { k: 'hdg', label: 'HDG', step: 1, big: 10, tip: 'Heading' },
  { k: 'alt', label: 'ALT', step: 100, big: 1000, tip: 'Altitude (ft; 350 = FL350)' },
  { k: 'vs', label: 'V/S', step: 100, big: 500, tip: 'Vertical speed (ft/min; −15 = −1,500)' },
];
const W = Object.fromEntries(WINDOWS.map((w) => [w.k, w]));
const PX_PER_STEP = 12;   // trackpad scrolling per step

export function createFcu(root, hud) {
  const el = document.createElement('div');
  el.className = 'fsui-fcu fsui-panel';
  root.appendChild(el);
  const parts = {};
  for (const w of WINDOWS) {
    const d = document.createElement('div');
    d.className = 'fsui-win';
    d.title = `${w.tip}: scroll to turn (fast for big steps), or click, type a value and press Enter`;
    d.innerHTML = `<span class="fsui-lab">${w.label}</span><span class="fsui-val"></span><span class="fsui-mode"></span>`;
    d.dataset.k = w.k;
    el.appendChild(d);
    parts[w.k] = { el: d, val: d.querySelector('.fsui-val'), mode: d.querySelector('.fsui-mode'), text: null, cls: null };
  }
  const mkBtn = (k, label) => {
    const d = document.createElement('div');
    d.className = 'fsui-btn'; d.dataset.k = k;
    d.innerHTML = `<span>${label}</span><i class="fsui-light"></i>`;
    el.appendChild(d);
    return { el: d, on: null };
  };
  const apBtn = mkBtn('ap', 'AP1'), athrBtn = mkBtn('athr', 'A/THR');
  const law = document.createElement('div');
  law.className = 'fsui-law'; law.title = 'Flight control law (Alternate: no stall protection)';
  el.appendChild(law);

  let view = null, selected = null, acc = 0, recent = [];
  let vsPreset = null, vsPresetAt = 0;
  let edit = null;   // the window being typed into: { k, text }

  const call = (name, ...args) => { const ap = view?.ap; if (ap && typeof ap[name] === 'function') ap[name](...args); };
  const vsMode = () => view?.ap?.vertical === 'V/S';

  // What a window holds now (V/S outside V/S mode: the preset, else the current vertical speed).
  function current(k) {
    const ap = view?.ap || {};
    if (k === 'spd') return Math.round(ap.spdKt ?? 250);
    if (k === 'hdg') return Math.round(ap.hdgDeg ?? 0);
    if (k === 'alt') return Math.round(ap.altFt ?? 5000);
    return vsMode() ? ap.vsFpm ?? 0 : vsPreset ?? Math.round((view?.state?.vs ?? 0) * 196.85 / 100) * 100;
  }

  function setValue(k, v) {
    if (k === 'spd') call('setSpd', clamp(Math.round(v), 100, 399));
    else if (k === 'hdg') { const h = wrap360(Math.round(v)); call('setHdg', h === 0 ? 360 : h); }
    else if (k === 'alt') call('setAlt', clamp(Math.round(v / 100) * 100, 100, 39800));
    else if (k === 'vs') {
      const s = clamp(Math.round(v / 100) * 100, -6000, 6000);
      if (vsMode()) call('setVs', s); else { vsPreset = s; vsPresetAt = performance.now(); }
    }
  }

  function turn(k, steps) {
    if (!view?.ap) return;
    // Fast turning (more than 6 steps in 0.3 s) moves in big steps.
    const now = performance.now();
    recent = recent.filter((t) => now - t < 300); recent.push(now);
    const big = recent.length > 6, st = big ? W[k].big : W[k].step;
    const base = Math.round(current(k) / st) * st;
    setValue(k, base + Math.sign(steps) * st * (big ? 1 : Math.abs(steps)));
    hud.poke();
  }

  function push(k) {
    const ap = view?.ap; if (!ap) return;
    if (k === 'spd') call('setSpd', Math.round(ap.spdKt ?? 250));
    else if (k === 'hdg') call('setHdg', Math.round(ap.hdgDeg ?? 0));
    else if (k === 'alt') call('levelChange');
    else if (k === 'vs') {
      const v = vsPreset ?? (vsMode() ? ap.vsFpm : Math.round((view.state?.vs ?? 0) * 196.85 / 100) * 100);
      call('setVs', clamp(v, -6000, 6000)); vsPreset = null;
    }
    hud.poke();
  }

  // ---- typing a value ----
  function openEdit(k) { edit = { k, text: '' }; selected = k; refresh(); }
  function closeEdit(apply) {
    if (!edit) return;
    const { k, text } = edit;
    edit = null;
    if (apply) {
      let v = text === '' || text === '-' ? null : Number(text);
      if (v !== null && Number.isFinite(v)) {
        if (k === 'alt' && Math.abs(v) < 1000) v *= 100;   // a flight level
        if (k === 'vs' && Math.abs(v) <= 60) v *= 100;     // hundreds of ft/min
        setValue(k, v);
      }
      push(k);
    }
    refresh();
  }
  const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);
  // While a window is open the FCU reads the keys first (capture phase, before the game).
  window.addEventListener('keydown', (e) => {
    if (!edit || MODIFIERS.has(e.key)) return;
    const key = e.key, k = edit.k;
    let used = true;
    if (/^[0-9]$/.test(key)) { if (edit.text.replace('-', '').length < 5) edit.text += key; }
    else if ((key === '-' || key === '−') && k === 'vs' && edit.text === '') edit.text = '-';
    else if (key === 'Backspace') edit.text = edit.text.slice(0, -1);
    else if (key === 'Enter') closeEdit(true);
    else if (key === 'Escape') closeEdit(false);
    else if (key === 'ArrowUp' || key === 'ArrowDown') { edit.text = ''; turn(k, (key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? W[k].big / W[k].step : 1)); }
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
    const b = e.target.closest('.fsui-btn');
    if (b && b.dataset.k === 'ap') { if (view?.ap?.ap) call('disconnectAp', 'fcu'); else call('engageAp'); hud.poke(); }
    else if (b && b.dataset.k === 'athr') { call('toggleAthr'); hud.poke(); }
    else if (e.target.closest('.fsui-law')) {
      const next = (view?.state?.law || 'normal') === 'normal' ? 'alternate' : 'normal';
      if (view?.controls) view.controls.law = next;
      if (hud.onlaw) hud.onlaw(next);
      hud.poke();
    }
  });

  const set = (p, text, cls) => {
    if (p.text !== text) { p.val.textContent = text; p.text = text; }
    if (p.cls !== cls) { p.el.className = 'fsui-win' + cls; p.cls = cls; }
  };

  function refresh() { for (const k in parts) parts[k].cls = null; update(view); }

  function update(v) {
    view = v; if (!v) return;
    const ap = v.ap || {}, on = !!ap.ap;
    const sel = (k) => (selected === k ? ' sel' : '');
    // An open window shows what's typed so far (or its value, dimmed, until a digit comes).
    const ed = (k) => (edit && edit.k === k ? (edit.text ? ' edit typed' : ' edit') : '');
    const shown = (k, text) => (edit && edit.k === k && edit.text ? edit.text : text);
    set(parts.spd, shown('spd', String(Math.round(ap.spdKt ?? 0)).padStart(3, '0')), (ap.athr ? ' lit' : '') + sel('spd') + ed('spd'));
    set(parts.hdg, shown('hdg', String(Math.round(ap.hdgDeg ?? 0) || 360).padStart(3, '0')), (on && ap.lateral === 'HDG' ? ' lit' : '') + sel('hdg') + ed('hdg'));
    set(parts.alt, shown('alt', String(Math.round(ap.altFt ?? 0)).padStart(5, '0')), (on && /ALT/.test(ap.vertical || '') ? ' lit' : on && /OP/.test(ap.vertical || '') ? ' arm' : '') + sel('alt') + ed('alt'));
    if (vsPreset !== null && performance.now() - vsPresetAt > 10000 && !vsMode()) vsPreset = null;
    const vsv = vsMode() ? ap.vsFpm ?? 0 : vsPreset;
    const vsText = vsv === null || vsv === undefined ? '-----' : (vsv >= 0 ? '+' : '−') + String(Math.abs(Math.round(vsv / 100) * 100)).padStart(4, '0');
    set(parts.vs, shown('vs', vsText), (on && vsMode() ? ' lit' : '') + (vsPreset !== null && !vsMode() ? ' pre' : '') + sel('vs') + ed('vs'));
    const light = (b, isOn) => { if (b.on !== isOn) { b.el.classList.toggle('on', isOn); b.on = isOn; } };
    light(apBtn, on); light(athrBtn, !!ap.athr);
    const lawT = (v.state?.law || 'normal') === 'normal' ? 'LAW NORM' : 'LAW ALTN';
    if (law.textContent !== lawT) { law.textContent = lawT; law.classList.toggle('altn', lawT === 'LAW ALTN'); }
  }

  return { el, update, get editing() { return edit ? edit.k : null; } };
}
