// The FCU strip at the top: SPD, HDG, ALT and V/S windows, AP1 and A/THR, and a small
// LAW switch. Scroll over a window to turn its knob (or click a window, then scroll
// anywhere on the strip); click = push. It calls the `ap` methods from the interface.
// Swiping up (deltaY > 0 with macOS natural scrolling) turns a knob up.
// Plain divs, never focusable, so the keyboard stays with the game.

import { clamp, wrap360 } from './common.js';

const WINDOWS = [
  { k: 'spd', label: 'SPD', step: 1, min: 100, max: 399 },
  { k: 'hdg', label: 'HDG', step: 1 },
  { k: 'alt', label: 'ALT', step: 100, min: 100, max: 39800 },
  { k: 'vs', label: 'V/S', step: 100, min: -6000, max: 6000 },
];

export function createFcu(root, hud) {
  const el = document.createElement('div');
  el.className = 'fsui-fcu fsui-panel';
  root.appendChild(el);
  const parts = {};
  for (const w of WINDOWS) {
    const d = document.createElement('div');
    d.className = 'fsui-win';
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

  const call = (name, ...args) => { const ap = view?.ap; if (ap && typeof ap[name] === 'function') ap[name](...args); };
  const vsMode = () => view?.ap?.vertical === 'V/S';

  function turn(k, steps) {
    const ap = view?.ap; if (!ap) return;
    if (k === 'spd') call('setSpd', clamp(Math.round(ap.spdKt ?? 250) + steps, 100, 399));
    else if (k === 'hdg') { let v = wrap360(Math.round(ap.hdgDeg ?? 0) + steps); call('setHdg', v === 0 ? 360 : v); }
    else if (k === 'alt') {
      // Fast scrolling (more than 6 steps in 0.3 s) moves 1,000 ft a step.
      const now = performance.now();
      recent = recent.filter((t) => now - t < 300); recent.push(now);
      const big = recent.length > 6;
      const st = big ? 1000 : 100;
      const base = Math.round((ap.altFt ?? 5000) / st) * st;
      call('setAlt', clamp(base + Math.sign(steps) * st * (big ? 1 : Math.abs(steps)), 100, 39800));
    } else if (k === 'vs') {
      const cur = vsMode() ? ap.vsFpm ?? 0 : vsPreset ?? Math.round((view.state?.vs ?? 0) * 196.85 / 100) * 100;
      const v = clamp(Math.round(cur / 100) * 100 + steps * 100, -6000, 6000);
      if (vsMode()) call('setVs', v); else { vsPreset = v; vsPresetAt = performance.now(); }
    }
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

  el.addEventListener('wheel', (e) => {
    e.preventDefault(); e.stopPropagation();
    const w = e.target.closest('.fsui-win');
    if (w) selected = w.dataset.k;
    if (!selected) return;
    // Mouse wheels send ~100 per notch (one step); trackpads many small deltas.
    const notch = e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
    if (notch) { turn(selected, Math.sign(e.deltaY)); return; }
    acc += e.deltaY;
    const n = Math.trunc(acc / 25);
    if (n) { acc -= n * 25; turn(selected, Math.sign(n) * Math.min(Math.abs(n), 4)); }
  }, { passive: false });
  el.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('dblclick', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const w = e.target.closest('.fsui-win');
    if (w) { selected = w.dataset.k; push(selected); refresh(); return; }
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
    set(parts.spd, String(Math.round(ap.spdKt ?? 0)).padStart(3, '0'), (ap.athr ? ' lit' : '') + sel('spd'));
    set(parts.hdg, String(Math.round(ap.hdgDeg ?? 0) || 360).padStart(3, '0'), (on && ap.lateral === 'HDG' ? ' lit' : '') + sel('hdg'));
    set(parts.alt, String(Math.round(ap.altFt ?? 0)).padStart(5, '0'), (on && /ALT/.test(ap.vertical || '') ? ' lit' : on && /OP/.test(ap.vertical || '') ? ' arm' : '') + sel('alt'));
    if (vsPreset !== null && performance.now() - vsPresetAt > 10000 && !vsMode()) vsPreset = null;
    const vsv = vsMode() ? ap.vsFpm ?? 0 : vsPreset;
    const vsText = vsv === null || vsv === undefined ? '-----' : (vsv >= 0 ? '+' : '−') + String(Math.abs(Math.round(vsv / 100) * 100)).padStart(4, '0');
    set(parts.vs, vsText, (on && vsMode() ? ' lit' : '') + (vsPreset !== null && !vsMode() ? ' pre' : '') + sel('vs'));
    const light = (b, isOn) => { if (b.on !== isOn) { b.el.classList.toggle('on', isOn); b.on = isOn; } };
    light(apBtn, on); light(athrBtn, !!ap.athr);
    const lawT = (v.state?.law || 'normal') === 'normal' ? 'LAW NORM' : 'LAW ALTN';
    if (law.textContent !== lawT) { law.textContent = lawT; law.classList.toggle('altn', lawT === 'LAW ALTN'); }
  }

  return { el, update };
}
