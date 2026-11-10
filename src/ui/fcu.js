// The FCU strip at the top: SPD, HDG, ALT, V/S and BARO windows, STD, AP1 and A/THR, and a small
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
import { bindKnobs } from './knobs.js';

const WINDOWS = [
  { k: 'spd', label: 'SPD', step: 1, big: 10, tip: 'Speed (kt)' },
  { k: 'hdg', label: 'HDG', step: 1, big: 10, tip: 'Heading' },
  { k: 'alt', label: 'ALT', step: 100, big: 1000, tip: 'Altitude (ft; 350 = FL350)' },
  { k: 'vs', label: 'V/S', step: 100, big: 500, tip: 'Vertical speed (ft/min; −15 = −1,500)' },
  { k: 'baro', label: 'BARO', step: 1, big: 5, tip: 'Altimeter setting (hPa)' },
];
const W = Object.fromEntries(WINDOWS.map((w) => [w.k, w]));

// The altimeter setting on the strips (here and on the Boeings' MCP). `sim` is view.sim: its baro and
// setters are the sim's (sim.js, v0.4.0). A typed setting has to be a real one: out of range it's ignored.
export const BARO_MIN = 900, BARO_MAX = 1100;
export const baroOf = (view) => view?.sim?.baro ?? null;
export const baroText = (b) => (!b ? '1013' : b.std ? 'STD' : String(Math.round(b.hpa)));
export function typedBaro(text) {
  if (text === '') return null;
  const v = Number(text);
  return Number.isFinite(v) && v >= BARO_MIN && v <= BARO_MAX ? Math.round(v) : null;
}
export function turnBaro(view, v) { view?.sim?.setBaro?.(clamp(Math.round(v), BARO_MIN, BARO_MAX)); }
export function toggleStd(view) { const s = view?.sim; if (s?.baro && s.setBaroStd) s.setBaroStd(!s.baro.std); }

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
  const stdBtn = mkBtn('std', 'STD'), apBtn = mkBtn('ap', 'AP1'), athrBtn = mkBtn('athr', 'A/THR');
  stdBtn.el.title = 'Altimeter: standard (1013) or back to the setting in the BARO window';
  const law = document.createElement('div');
  law.className = 'fsui-law'; law.title = 'Flight control law (Alternate: no stall protection)';
  el.appendChild(law);

  let view = null;
  let vsPreset = null, vsPresetAt = 0;

  const call = (name, ...args) => { const ap = view?.ap; if (ap && typeof ap[name] === 'function') ap[name](...args); };
  const vsMode = () => view?.ap?.vertical === 'V/S';

  // What a window holds now (V/S outside V/S mode: the preset, else the current vertical speed).
  function current(k) {
    const ap = view?.ap || {};
    if (k === 'spd') return Math.round(ap.spdKt ?? 250);
    if (k === 'hdg') return Math.round(ap.hdgDeg ?? 0);
    if (k === 'alt') return Math.round(ap.altFt ?? 5000);
    if (k === 'baro') return Math.round(baroOf(view)?.hpa ?? 1013);
    return vsMode() ? ap.vsFpm ?? 0 : vsPreset ?? Math.round((view?.state?.vs ?? 0) * 196.85 / 100) * 100;
  }

  function setValue(k, v) {
    if (k === 'spd') call('setSpd', clamp(Math.round(v), 100, 399));
    else if (k === 'hdg') { const h = wrap360(Math.round(v)); call('setHdg', h === 0 ? 360 : h); }
    else if (k === 'alt') call('setAlt', clamp(Math.round(v / 100) * 100, 100, 39800));
    else if (k === 'baro') turnBaro(view, v);
    else if (k === 'vs') {
      const s = clamp(Math.round(v / 100) * 100, -6000, 6000);
      if (vsMode()) call('setVs', s); else { vsPreset = s; vsPresetAt = performance.now(); }
    }
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

  // What was typed: Enter or a second click sets it and pushes the knob.
  function commit(k, text) {
    if (k === 'baro') { const v = typedBaro(text); if (v !== null) turnBaro(view, v); hud.poke(); return; }
    let v = text === '' || text === '-' ? null : Number(text);
    if (v !== null && Number.isFinite(v)) {
      if (k === 'alt' && Math.abs(v) < 1000) v *= 100;   // a flight level
      if (k === 'vs' && Math.abs(v) <= 60) v *= 100;     // hundreds of ft/min
      setValue(k, v);
    }
    push(k);
  }
  const knobs = bindKnobs(el, {
    windows: W, getView: () => view, current, setValue, commit, refresh: () => refresh(), poke: () => hud.poke(),
    acceptKey(edit, key) {
      if ((key === '-' || key === '−') && edit.k === 'vs' && edit.text === '') { edit.text = '-'; return true; }
      return false;
    },
    onClick(e) {
      const b = e.target.closest('.fsui-btn');
      if (b && b.dataset.k === 'ap') { if (view?.ap?.ap) call('disconnectAp', 'fcu'); else call('engageAp'); hud.poke(); }
      else if (b && b.dataset.k === 'athr') { call('toggleAthr'); hud.poke(); }
      else if (b && b.dataset.k === 'std') { toggleStd(view); hud.poke(); }
      else if (e.target.closest('.fsui-law')) {
        const next = (view?.state?.law || 'normal') === 'normal' ? 'alternate' : 'normal';
        if (view?.controls) view.controls.law = next;
        if (hud.onlaw) hud.onlaw(next);
        hud.poke();
      }
    },
  });

  const set = (p, text, cls) => {
    if (p.text !== text) { p.val.textContent = text; p.text = text; }
    if (p.cls !== cls) { p.el.className = 'fsui-win' + cls; p.cls = cls; }
  };

  function refresh() { for (const k in parts) parts[k].cls = null; update(view); }

  function update(v) {
    view = v; if (!v) return;
    const ap = v.ap || {}, on = !!ap.ap;
    const selected = knobs.selected, edit = knobs.edit;
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
    const baro = baroOf(v);
    set(parts.baro, shown('baro', baroText(baro)), (baro?.std ? ' lit' : '') + sel('baro') + ed('baro'));
    const light = (b, isOn) => { if (b.on !== isOn) { b.el.classList.toggle('on', isOn); b.on = isOn; } };
    light(apBtn, on); light(athrBtn, !!ap.athr); light(stdBtn, !!baro?.std);
    const lawT = (v.state?.law || 'normal') === 'normal' ? 'LAW NORM' : 'LAW ALTN';
    if (law.textContent !== lawT) { law.textContent = lawT; law.classList.toggle('altn', lawT === 'LAW ALTN'); }
  }

  return { el, update, close: knobs.close, get editing() { return knobs.edit ? knobs.edit.k : null; } };
}
