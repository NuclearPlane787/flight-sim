// v0.8.0, the failure warnings on the screens' side: MASTER WARN (red) and MASTER CAUT (amber) by the PFD (the
// Boeings' WARNING and CAUTION), the aurals (src/audio/alerts.js) and the clickable checklist panel by the engine
// display. The alerts and their steps are src/sim/checklists.js's (pure); what is here is the page's own: which
// alerts the pilot has acknowledged (a light's click, the SILENCE button, its key), which alert the panel shows, and
// whether the panel is folded.
//
//   const alerts = createAlerts({ sim, hud, synth, input });   // hud: hud.js's (its el, poke(), engineSwitchAt())
//   alerts.update()        // every frame (and while paused, from renderOnce's render): cheap when nothing changed
//   alerts.silence()       // acknowledge everything (the SILENCE button and its key call it too, on their own)
//   alerts.list            // the alerts now (checklists.js's), for the engine screens
//
// - A light is lit while an unacknowledged alert of its level is active; a click on it acknowledges that level's
//   alerts: its aural stops and the light goes out, the messages and the checklist stay, as in the aircraft. A new
//   alert lights it again and sounds again.
// - The aural: the most urgent unacknowledged warning's loop (CRC, fire bell, siren); a new caution's one-shot
//   (single chime, beeper) once when it appears.
// - The panel exists only while an alert does (no DOM otherwise); it is rebuilt only when the list, a step's state, the
//   selection or the fold changes; placed left of the engine display (or at the right edge with the panels hidden),
//   never over the PFD or the engine display. Every button keeps the keyboard on the flight (mousedown → preventDefault).
// Its styles are alerts.css, linked from here once (so the dev pages get them too).

import { alertsOf, alertsKey, runStep, nextStep } from '../sim/checklists.js';
import { createAlertAurals } from '../audio/alerts.js';
import { shield } from './common.js';

const EMPTY = Object.freeze([]);
const NO_ONCE = Object.freeze([]);

function linkStyles() {
  if (typeof document === 'undefined' || document.querySelector('link[data-fs-alerts]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('./alerts.css', import.meta.url).href; l.dataset.fsAlerts = '1';
  document.head.appendChild(l);
}

export function createAlerts({ sim, hud = null, hudEl = hud?.el, synth = null, input = null, poke = () => hud?.poke?.() } = {}) {
  linkStyles();
  const keep = (el) => { shield(el); el.addEventListener('mousedown', (e) => e.preventDefault()); return el; };
  const au = createAlertAurals();
  let list = EMPTY, key = '', family = 'airbus';
  const acked = new Map();          // id -> true once acknowledged (forgotten when the alert clears)
  let selected = null, folded = false, built = '';
  let warnLit = false, cautLit = false, lightsFamily = '';

  // ---- the lights ----
  const lights = keep(document.createElement('div'));
  lights.className = 'fsal-lights fsui-panel';
  const lightBtn = (cls, hook) => { const b = document.createElement('button'); b.className = 'fsal-light ' + cls; b.dataset.alert = hook; b.tabIndex = -1; lights.appendChild(b); return b; };
  const warnBtn = lightBtn('fsal-warn', 'warn'), cautBtn = lightBtn('fsal-caut', 'caut');
  hudEl.appendChild(lights);
  warnBtn.addEventListener('click', () => { ack('warning'); refresh(true); });
  cautBtn.addEventListener('click', () => { ack('caution'); refresh(true); });

  // ---- the panel (made on the first alert, removed with the last) ----
  let panel = null, tab = null;
  function makePanel() {
    panel = keep(document.createElement('div'));
    panel.className = 'fsal-panel fsui-panel';
    panel.addEventListener('click', onPanelClick);
    tab = keep(document.createElement('button'));
    tab.className = 'fsal-tab fsui-panel'; tab.tabIndex = -1; tab.dataset.fold = 'open';
    tab.addEventListener('click', () => { folded = false; built = ''; refresh(true); });
    hudEl.appendChild(panel); hudEl.appendChild(tab);
    placed = '';
  }
  function dropPanel() { panel?.remove(); tab?.remove(); panel = tab = null; built = ''; }

  function onPanelClick(e) {
    const b = e.target.closest('button');
    if (!b || !panel.contains(b)) return;
    if (b.dataset.fold === 'fold') { folded = true; built = ''; refresh(true); return; }
    if (b.dataset.sel) { selected = b.dataset.sel; built = ''; refresh(true); return; }
    if (b.dataset.step !== undefined) {
      const a = list.find((x) => x.id === b.dataset.for), st = a?.steps[+b.dataset.step];
      if (st && runStep(sim, st)) { refresh(true); poke?.(); }
    }
  }

  function ack(level) { for (const a of list) if (!level || a.level === level) acked.set(a.id, true); }

  // ---- placing ----
  let placed = '', lastPlaceCheck = 0;
  const px = (v) => parseFloat(v) || 0;
  function place(force) {
    const pfd = hudEl.querySelector('.fsui-pfd'), eng = hudEl.querySelector('.fsui-eng');
    if (!pfd || !eng) return;
    const ps = pfd.style, es = eng.style;
    const hidden = ps.visibility === 'hidden';
    const k = [ps.left, ps.top, ps.width, es.left, es.top, es.width, es.height, hidden, panel ? 1 : 0, folded, window.innerWidth, window.innerHeight, panel ? panel.scrollHeight : 0].join();
    if (!force && k === placed) return;
    placed = k;
    const pl = px(ps.left), pt = px(ps.top), pw = px(ps.width), el = px(es.left), et = px(es.top), ew = px(es.width);
    // The lights: right of the PFD's top corner (at the left edge with the panels hidden), sized by the PFD.
    const lw = Math.max(54, pw * 0.17), lh = Math.max(22, pw * 0.07);
    Object.assign(lights.style, { left: (hidden ? pl : pl + pw + 6) + 'px', top: pt + 'px', width: lw + 'px', fontSize: Math.max(9, lh * 0.36) + 'px' });
    for (const b of [warnBtn, cautBtn]) b.style.height = lh + 'px';
    if (!panel) return;
    const W = window.innerWidth, H = window.innerHeight, gap = 8;
    const fs = Math.max(10.5, Math.min(15, ew * 0.034));
    const right = hidden ? W - 12 : el - gap;
    const minLeft = hidden ? 12 : pl + pw + gap;
    const width = Math.max(150, Math.min(fs * 27, right - minLeft));
    // A list longer than the room under the engine display's top (the two-systems hydraulics', sixteen lines) starts
    // higher, in the free view between the PFD and the ND, as far up as the PFD's top: the pictures reader found its
    // last line cut at the screen's foot. Past that it scrolls.
    let top = et, maxH = Math.max(80, H - top - 12);
    const need = panel.scrollHeight + 2;
    if (need > maxH) { top = Math.max(pt, H - 12 - need); maxH = Math.max(80, H - top - 12); }
    Object.assign(panel.style, { left: (right - width) + 'px', top: top + 'px', width: width + 'px', maxHeight: maxH + 'px', fontSize: fs + 'px' });
    Object.assign(tab.style, { right: (W - right) + 'px', top: top + 'px', fontSize: fs + 'px' });
  }

  // ---- drawing ----
  function setLights() {
    let w = false, c = false;
    for (const a of list) if (!acked.get(a.id)) { if (a.level === 'warning') w = true; else c = true; }
    if (lightsFamily !== family) {
      lightsFamily = family;
      const boeing = family === 'boeing';
      warnBtn.innerHTML = boeing ? 'WARNING' : 'MASTER<br>WARN';
      cautBtn.innerHTML = boeing ? 'CAUTION' : 'MASTER<br>CAUT';
      warnBtn.title = 'Master warning: lit with a new red warning; click to silence its aural and put the light out (the message and the checklist stay)';
      cautBtn.title = 'Master caution: lit with a new amber caution; click to put it out (the message and the checklist stay)';
      lights.classList.toggle('boeing', boeing);
    }
    if (w !== warnLit) { warnLit = w; warnBtn.classList.toggle('on', w); }
    if (c !== cautLit) { cautLit = c; cautBtn.classList.toggle('on', c); }
  }

  const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  function build() {
    const sel = list.find((a) => a.id === selected) || list[0];
    selected = sel.id;
    const b = key + '|' + selected + '|' + folded;
    if (b === built) return;
    built = b;
    panel.hidden = folded; tab.hidden = !folded;
    tab.innerHTML = `<span class="fsal-dot ${list[0].level}"></span>CHECKLIST <b>${list.length}</b>`;
    tab.title = 'Open the checklist';
    if (folded) return;
    const nx = nextStep(sel);
    let h = `<div class="fsal-head"><span>${family === 'boeing' ? 'CHECKLIST' : 'ECAM'}</span><button data-fold="fold" tabindex="-1" title="Fold the checklist away (a tab stays)">–</button></div>`;
    h += '<div class="fsal-list">';
    for (const a of list) h += `<button class="fsal-title ${a.level}${a.id === selected ? ' sel' : ''}" data-sel="${esc(a.id)}" tabindex="-1">${esc(a.title)}</button>`;
    h += '</div><ol class="fsal-steps">';
    sel.steps.forEach((s, k) => {
      const cls = [s.kind, s.done ? 'done' : '', k === nx ? 'next' : '', s.ready === false ? 'wait' : ''].filter(Boolean).join(' ');
      const [lhs, rhs] = s.text.split(' ..... ');
      const text = rhs !== undefined ? `<span class="l">${esc(lhs)}</span><span class="dots"></span><span class="r">${esc(rhs)}</span>` : `<span class="l">${esc(lhs)}</span>`;
      const info = s.info ? `<div class="info">${esc(s.info)}</div>` : '';
      const mark = s.kind === 'note' ? '' : `<span class="tick">${s.done ? '✓' : ''}</span>`;
      const hook = `data-step="${k}" data-act="${s.act ? esc(s.act.name) : s.kind}"`;
      if (s.kind === 'switch' && !s.done) h += `<li class="${cls}" ${hook}><button data-for="${esc(sel.id)}" ${hook} tabindex="-1"${s.ready === false ? ' disabled' : ''}>${mark}<span class="t">${text}</span></button>${info}</li>`;
      else h += `<li class="${cls}" ${hook}><div class="row">${mark}<span class="t">${text}</span></div>${info}</li>`;
    });
    h += '</ol>';
    panel.innerHTML = h;
  }

  // ---- the frame ----
  let onceList = [];
  function refresh(force = false) {
    family = sim.type?.family === 'boeing' ? 'boeing' : 'airbus';
    const next = alertsOf(sim);
    const nk = next.length ? alertsKey(next) + family : '';
    if (!force && nk === key) {
      if (list.length && performance.now() - lastPlaceCheck > 400) { lastPlaceCheck = performance.now(); place(false); }
      return;
    }
    // New alerts: unacknowledged; a new caution sounds its one-shot; cleared ones forgotten.
    const ids = new Set(next.map((a) => a.id));
    for (const id of [...acked.keys()]) if (!ids.has(id)) acked.delete(id);
    for (const a of next) if (!list.some((p) => p.id === a.id)) {
      acked.delete(a.id);
      if (a.level === 'caution') onceList.push(a.aural);
      folded = false;   // the panel opens with a new alert
      if (a.level === 'warning' || !list.length) selected = null;   // a new warning goes on top and shows
    }
    list = next.length ? next : EMPTY; key = nk;
    setLights();
    if (!list.length) { if (panel) dropPanel(); place(false); return; }
    if (!panel) makePanel();
    if (!list.some((a) => a.id === selected)) selected = null;
    build();
    place(false);
  }

  function update() {
    refresh(false);
    // The aural: the most urgent unacknowledged warning's loop; the new cautions' one-shots.
    let loop = null;
    for (const a of list) if (a.level === 'warning' && !acked.get(a.id)) { loop = a.aural; break; }
    const out = synth?.alertOut || null;
    if (out || loop) au.update(out, { loop, once: onceList.length ? onceList : NO_ONCE });
    if (onceList.length) onceList = [];
  }

  function silence() {
    let k = 0;
    for (const a of list) if (!acked.get(a.id)) { acked.set(a.id, true); k++; }
    au.stop();
    if (k) setLights();
    return k;
  }
  // The SILENCE button (hud.js's, in the PFD) and its key cancel the lights and the aurals too.
  hudEl.querySelector('.fsui-silence')?.addEventListener('click', () => silence());
  input?.onAction?.((a) => { if (a === 'silenceWarnings') silence(); });
  window.addEventListener('resize', () => { placed = ''; place(false); });
  // The engine screens' switches (part 5): a click on one flips that engine's ENG MASTER / FUEL CONTROL. The screens
  // draw them and know where (hud.engineSwitchAt(x, y) in the canvas's CSS pixels: the engine's index, or -1).
  const engEl = hudEl.querySelector('.fsui-eng');
  if (engEl && hud?.engineSwitchAt) {
    const at = (e) => { const r = (engEl.querySelector('canvas') || engEl).getBoundingClientRect(); return hud.engineSwitchAt(e.clientX - r.left, e.clientY - r.top); };
    engEl.addEventListener('click', (e) => {
      const i = at(e);
      if (i >= 0 && sim.engineSwitch(i)) { refresh(true); poke?.(); }
    });
    engEl.addEventListener('pointermove', (e) => { const on = at(e) >= 0; if (on !== engEl.classList.contains('fsal-hot')) engEl.classList.toggle('fsal-hot', on); });
  }
  setLights(); place(true);

  return {
    update, silence,
    // For the browser checks: engine i's switch on the engine display, in page (client) px, or null when hidden.
    switchPoint(i) {
      const r = hud?.engineSwitchRect?.(i), el = hudEl.querySelector('.fsui-eng');
      if (!r || !el || el.style.visibility === 'hidden') return null;
      const b = (el.querySelector('canvas') || el).getBoundingClientRect();
      return { x: b.left + r.x + r.w / 2, y: b.top + r.y + r.h / 2 };
    },
    get list() { return list; },
    get lit() { return { warning: warnLit, caution: cautLit }; },
    get panel() { return panel; },
    get folded() { return folded; },
    get aural() { return au.playing; },   // the loop sounding now (crc, bell, siren) or null
    reset() { acked.clear(); au.stop(); list = EMPTY; key = ''; onceList = []; if (panel) dropPanel(); setLights(); },
  };
}
