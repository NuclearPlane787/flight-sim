// The Weather window (v0.4.0, Part 6): the L window's third tab, in the Sky window's frame.
//   createWeatherWindow(root, { get, onapply })
//     get() → { settings, ctx, crashed }    settings: sim.weather (null is the default weather);
//                                           ctx: weatherContext() of src/sim/weather-presets.js
//     onapply(settings) → { ok, text } or nothing   (sets the weather now; nothing returned counts as ok)
//   -> { el, open(), close(), toggle(), isOpen, update(), onclose, ontab }
// A preset applies at once. The fields are the form of weather-presets.js: Apply (or Enter in a field) sets
// them, until then the METAR line shows what they'd give. Changing any setting makes it Custom. A field with
// the cursor takes the keys (Enter applies, Esc closes); Apply, a click outside or Esc gives them back to the
// flight. Clicks and the wheel stay in the window; the settings scroll.
// Styles: sky-window.css (fssw-* for the frame, fslw-* shared with the Weight tab, fswx-* for this).

import { PRESETS, presetWeather, weatherForm, weatherFromForm, weatherCheck, metarOf, canPlaceOnFinal, COVERS, coverOf, oktaOf } from '../sim/weather-presets.js';
import { normalizeWeather, runwayStateOf } from '../sim/weather.js';
import { TAB_ICONS } from './load-window.js';

const ICON = {
  // A cloud with three drops.
  weather: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.5 15.5a4.5 4.5 0 0 1-.7-8.95A5.5 5.5 0 0 1 17.3 7.6a4 4 0 0 1-.3 7.9z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M8 18.5l-1 3M12.5 18.5l-1 3M17 18.5l-1 3"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>',
};
// The tab, for createSkyWindow({ tabs }).
export const WEATHER_TAB = { id: 'weather', label: 'Weather', icon: ICON.weather, title: 'Wind, cloud, rain and snow' };

// The Weight window draws its own tabs: this adds the Weather one to them. Its click reaches its ontab('weather').
export function addWeatherTab(el) {
  const tabs = el?.querySelector('.fssw-tabs');
  if (!tabs || tabs.querySelector('[data-tab="weather"]')) return;
  const b = document.createElement('button');
  b.className = 'fssw-tab'; b.dataset.tab = 'weather';
  b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', 'false'); b.title = WEATHER_TAB.title;
  b.innerHTML = `<span class="fssw-ico">${ICON.weather}</span>${WEATHER_TAB.label}`;
  tabs.appendChild(b);
}

function linkCss() {
  if (typeof document === 'undefined') return;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => /sky-window\.css(\?|$)/.test(l.href))) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./sky-window.css', import.meta.url).href;
  document.head.appendChild(l);
}

// How much of a 0..1 setting a button stands for: the value it sets, and the band it lights for any value.
const RATE = [['light', 'Light', 0.25], ['moderate', 'Moderate', 0.5], ['heavy', 'Heavy', 0.85]];
const rateBand = (r) => (r < 0.33 ? 'light' : r < 0.66 ? 'moderate' : 'heavy');
const LIGHTNING = [['none', 'None', 0], ['occasional', 'Occasional', 0.35], ['frequent', 'Frequent', 0.8]];
const lightningBand = (v) => (v <= 0 ? 'none' : v < 0.5 ? 'occasional' : 'frequent');

const shown = (k, v) => {
  if (!Number.isFinite(v)) return '';
  if (k === 'mbNm') return String(+v.toFixed(1));
  return String(+v.toFixed(2));
};
// A field's place in the form: 'wind.kt', 'clouds.1.baseFt'.
const getPath = (o, p) => p.split('.').reduce((a, k) => a[k], o);
function setPath(o, p, v) {
  const keys = p.split('.'), last = keys.pop();
  keys.reduce((a, k) => a[k], o)[last] = v;
}

export function createWeatherWindow(root, { get, onapply } = {}) {
  linkCss();
  const el = document.createElement('div');
  el.className = 'fssw fswx';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Weather');

  const input = (k, step, wide) => `<input type="number" step="${step}" data-f="${k}" inputmode="decimal" autocomplete="off"${wide ? ' class="wide"' : ''}>`;
  const unit = (t) => `<span class="fswx-u">${t}</span>`;
  const seg = (name, items) => `<div class="fswx-seg" data-seg="${name}">${items.map(([v, t]) => `<button data-v="${v}">${t}</button>`).join('')}</div>`;
  const cloudRow = (i) => `<label>${i === 0 ? 'Clouds' : ''}</label><div class="fswx-v">
    <select data-cover="${i}" aria-label="Layer ${i + 1} cover">${COVERS.map(([n]) => `<option value="${n}">${n === 'none' ? '—' : n}</option>`).join('')}</select>
    ${input(`clouds.${i}.baseFt`, 100)}${unit('to')}${input(`clouds.${i}.topFt`, 100)}${unit('ft')}</div>`;

  el.innerHTML = `
    <div class="fssw-head">
      <div class="fssw-tabs" role="tablist">
        <button class="fssw-tab" data-tab="sky" role="tab" aria-selected="false" title="The time of day"><span class="fssw-ico">${TAB_ICONS.sky}</span>Sky</button>
        <button class="fssw-tab" data-tab="load" role="tab" aria-selected="false" title="Fuel and payload"><span class="fssw-ico">${TAB_ICONS.load}</span>Weight</button>
        <button class="fssw-tab on" data-tab="weather" role="tab" aria-selected="true"><span class="fssw-ico fswx-ico">${ICON.weather}</span>Weather</button>
      </div>
      <span class="fssw-sub" data-o="name"></span>
      <button class="fssw-x" data-a="close" title="Close (L or Esc)">${ICON.x}</button></div>
    <div class="fssw-body fswx-body">
      <div class="fswx-metar" data-o="metar"></div>
      <div class="fswx-presets">${PRESETS.map((p) => `<button class="fssw-b" data-p="${p.id}" title="${p.name}: ${p.note}">${p.short}</button>`).join('')}</div>
      <div class="fswx-scroll">
        <div class="fswx-grid">
          <label>Surface wind</label><div class="fswx-v">${input('wind.fromDeg', 10)}${unit('°')}${input('wind.kt', 1)}${unit('kt G')}${input('wind.gustKt', 1)}${unit('kt')}</div>
          <label>Wind aloft</label><div class="fswx-v">${input('aloft.fromDeg', 10)}${unit('°')}${input('aloft.kt', 1)}${unit('kt')}</div>
          <label>Turbulence</label><div class="fswx-v">${seg('turbulence', [['none', 'None'], ['light', 'Light'], ['moderate', 'Moderate'], ['severe', 'Severe']])}</div>
          <label>Low-level shear</label><div class="fswx-v">${input('shear.ftAgl', 100)}${unit('ft')}${input('shear.fromDeg', 10)}${unit('°')}${input('shear.kt', 1)}${unit('kt')}</div>
          <label>Microburst</label><div class="fswx-v">${input('mbNm', 0.5)}${unit('nm out')}${input('mbKt', 5)}${unit('kt')}<span class="fswx-u fswx-dim" data-o="cells"></span></div>
          <label>Visibility</label><div class="fswx-v">${input('visM', 100, true)}${unit('m, fog top')}${input('fogTopFt', 50)}${unit('ft')}</div>
          ${cloudRow(0)}${cloudRow(1)}${cloudRow(2)}
          <label>Precipitation</label><div class="fswx-v">${seg('precipKind', [['none', 'None'], ['rain', 'Rain'], ['snow', 'Snow']])}${seg('rate', RATE.map(([v, t]) => [v, t]))}</div>
          <label>Lightning</label><div class="fswx-v">${seg('lightning', LIGHTNING.map(([v, t]) => [v, t]))}</div>
          <label>Runway</label><div class="fswx-v">${seg('runway', [['auto', 'Auto'], ['dry', 'Dry'], ['wet', 'Wet'], ['snow', 'Snow'], ['ice', 'Ice']])}<span class="fswx-u fswx-dim" data-o="rwyNote"></span></div>
          <label>Temperature</label><div class="fswx-v">${input('tempC', 1)}${unit('°C, QNH')}${input('qnh', 1, true)}${unit('hPa')}</div>
        </div>
      </div>
      <div class="fslw-msg" data-o="msg" aria-live="polite"></div>
      <div class="fssw-row fslw-act">
        <button class="fssw-b" data-a="revert" title="Back to the weather set now">Undo edits</button>
        <button class="fssw-b fslw-apply" data-a="apply">Apply</button>
      </div>
    </div>
    <div class="fssw-foot"><span class="fssw-key">Enter</span> Apply · <span class="fssw-key">L</span><span class="fssw-key">Esc</span> Close</div>`;
  root.appendChild(el);

  const o = (n) => el.querySelector(`[data-o="${n}"]`);
  const btn = (a) => el.querySelector(`[data-a="${a}"]`);
  const fields = [...el.querySelectorAll('input[data-f]')];
  const covers = [...el.querySelectorAll('select[data-cover]')];
  const segOf = (n) => el.querySelector(`[data-seg="${n}"]`);

  let open = false, base = normalizeWeather(null), form = weatherForm(base, null), ctx = null, crashed = false;
  let lastSettings, lastCtxKey = '', msg = '', msgCls = '', filled = {}, lastMetar = '', current = base;
  const ctxKey = (c) => JSON.stringify(c?.arrival || null);

  const now = () => get?.() || { settings: null, ctx: null, crashed: false };
  const setMsg = (text, cls = '') => { msg = text; msgCls = cls; };
  function rebase(n) {
    ctx = n.ctx || null; crashed = !!n.crashed; lastSettings = n.settings; lastCtxKey = ctxKey(ctx);
    base = current = normalizeWeather(n.settings);
    form = weatherForm(base, ctx);
    fill();
  }

  // The fields from the form.
  function fill() {
    filled = {};
    for (const f of fields) { const v = shown(f.dataset.f, getPath(form, f.dataset.f)); f.value = v; filled[f.dataset.f] = v; }
    covers.forEach((s, i) => { s.value = coverOf(form.clouds[i].okta); });
  }

  function paintSeg(name, value) {
    const s = segOf(name);
    for (const b of s.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === value);
  }

  function render() {
    const problems = weatherCheck(form, ctx);
    if (!problems.length) current = weatherFromForm(form, base, ctx);
    const edited = JSON.stringify(current) !== JSON.stringify(base) || problems.length > 0;
    paintSeg('turbulence', form.turbulence);
    paintSeg('precipKind', form.precipKind);
    paintSeg('rate', form.precipKind === 'none' ? '' : rateBand(form.precipRate));
    paintSeg('lightning', lightningBand(form.lightning));
    paintSeg('runway', form.runway);
    for (const b of segOf('rate').querySelectorAll('button')) b.disabled = form.precipKind === 'none';
    const canFinal = canPlaceOnFinal(ctx);
    for (const k of ['mbNm', 'mbKt']) el.querySelector(`[data-f="${k}"]`).disabled = !canFinal;
    covers.forEach((s, i) => {
      const off = form.clouds[i].okta <= 0;
      for (const k of ['baseFt', 'topFt']) el.querySelector(`[data-f="clouds.${i}.${k}"]`).disabled = off;
    });
    for (const f of fields) f.classList.toggle('edited', f.value !== filled[f.dataset.f]);
    const others = current.microbursts.length - (form.mbKt > 0 && canFinal ? 1 : 0);
    o('cells').textContent = others > 0 ? `+ ${others} cell${others > 1 ? 's' : ''}` : '';
    o('rwyNote').textContent = form.runway === 'auto' && !problems.length ? `now ${runwayStateOf(current)}` : '';

    const metar = metarOf(current, ctx?.arrival?.icao, ctx);
    if (metar !== lastMetar) { o('metar').textContent = metar; lastMetar = metar; }
    const p = PRESETS.find((x) => x.id === current.preset);
    o('name').textContent = edited && !problems.length && current.preset !== 'custom' ? 'Custom' : p ? p.short : 'Custom';
    for (const b of el.querySelectorAll('[data-p]')) b.classList.toggle('on', b.dataset.p === current.preset && !problems.length);

    let text = msg, cls = msgCls;
    if (crashed) { text = 'Crashed: rewind or restart to change the weather.'; cls = 'bad'; }
    else if (problems.length) { text = problems[0]; cls = 'bad'; }
    else if (edited && !msg) { text = 'Apply to set it.'; cls = ''; }
    const m = o('msg');
    if (m.textContent !== text) m.textContent = text;
    m.className = 'fslw-msg' + (cls ? ' ' + cls : '');
    btn('apply').disabled = crashed || !edited || problems.length > 0;
    btn('revert').disabled = !edited;
    for (const b of el.querySelectorAll('[data-p]')) b.disabled = crashed;
  }

  function send(settings, text) {
    const r = onapply?.(settings) || { ok: true }, ok = r.ok !== false;
    if (ok) {
      const n = now();
      ctx = n.ctx || null; lastSettings = n.settings; lastCtxKey = ctxKey(ctx);
      base = current = normalizeWeather(settings); form = weatherForm(base, ctx); fill();
    }
    setMsg(r.text || (ok ? text : 'Not applied.'), ok ? 'ok' : 'bad');
    if (el.contains(document.activeElement)) document.activeElement.blur();   // the keys go back to the flight
    render();
  }

  function apply() {
    if (crashed || weatherCheck(form, ctx).length) { render(); return; }
    const s = weatherFromForm(form, base, ctx);
    if (JSON.stringify(s) === JSON.stringify(base)) { render(); return; }
    send(s, 'Weather set.');
  }

  function choosePreset(id) {
    if (crashed) return;
    const p = PRESETS.find((x) => x.id === id);
    send(presetWeather(id, ctx), `${p.name}: set.`);
  }

  const win = {
    el,
    onclose: null,
    ontab: null,
    get isOpen() { return open; },
    open() {
      if (open) return;
      open = true; el.hidden = false; setMsg('');
      rebase(now()); lastMetar = ''; render();
    },
    close() {
      if (!open) return;
      open = false; el.hidden = true;
      if (el.contains(document.activeElement)) document.activeElement.blur();
      win.onclose?.();
    },
    toggle() { if (open) win.close(); else win.open(); },
    // Every few frames while open: a weather set elsewhere (a loaded save) refills an unedited form.
    update() {
      if (!open) return;
      const n = now();
      crashed = !!n.crashed;
      const edited = JSON.stringify(current) !== JSON.stringify(base) || weatherCheck(form, ctx).length > 0;
      if (!edited && (n.settings !== lastSettings || ctxKey(n.ctx) !== lastCtxKey)) rebase(n);
      render();
    },
  };

  el.addEventListener('input', (e) => {
    const k = e.target.dataset?.f;
    if (!k) return;
    const raw = e.target.value.trim();
    setPath(form, k, raw === '' ? NaN : Number(raw));
    setMsg('');
    render();
  });
  el.addEventListener('change', (e) => {
    const i = e.target.dataset?.cover;
    if (i === undefined) return;
    form.clouds[+i].okta = oktaOf(e.target.value);
    setMsg('');
    e.target.blur();     // a chosen cover gives the keys back
    render();
  });
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    if (t.dataset.tab) { if (t.dataset.tab !== 'weather') win.ontab?.(t.dataset.tab); return; }
    if (t.dataset.p) { choosePreset(t.dataset.p); return; }
    const sg = t.closest('[data-seg]');
    if (sg) {
      const v = t.dataset.v;
      switch (sg.dataset.seg) {
        case 'turbulence': form.turbulence = v; break;
        case 'precipKind': form.precipKind = v; if (v !== 'none' && !(form.precipRate > 0)) form.precipRate = 0.5; break;
        case 'rate': form.precipRate = RATE.find((r) => r[0] === v)[2]; break;
        case 'lightning': form.lightning = LIGHTNING.find((r) => r[0] === v)[2]; break;
        case 'runway': form.runway = v; break;
      }
      setMsg('');
      render();
      return;
    }
    switch (t.dataset.a) {
      case 'close': win.close(); break;
      case 'apply': apply(); break;
      case 'revert': setMsg(''); form = weatherForm(base, ctx); fill(); render(); break;
    }
  });
  el.addEventListener('keydown', (e) => {
    if (!e.target.dataset?.f) return;
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
  });
  // Clicks and the wheel stay in the window. Buttons never take the focus (Space and Enter keep going to
  // the game); the fields and the covers do, to be typed in or opened. The wheel scrolls the settings.
  el.addEventListener('mousedown', (e) => { if (!e.target.closest('input, select')) e.preventDefault(); e.stopPropagation(); });
  for (const t of ['pointerdown', 'dblclick', 'contextmenu']) el.addEventListener(t, (e) => e.stopPropagation());
  el.addEventListener('wheel', (e) => { e.stopPropagation(); if (!e.target.closest('.fswx-scroll')) e.preventDefault(); }, { passive: false });
  // A click anywhere else gives the keys back to the flight.
  window.addEventListener('pointerdown', (e) => { if (open && !el.contains(e.target) && el.contains(document.activeElement)) document.activeElement.blur(); }, true);

  // Esc closes the window first (also from a field): only that Esc stops here, so the pause menu doesn't
  // open. Every other key goes on (L is the lead's toggle).
  window.addEventListener('keydown', (e) => {
    if (!open || e.key !== 'Escape' || document.body.classList.contains('in-menu')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable) && !el.contains(t)) return;
    e.preventDefault(); e.stopPropagation();
    win.close();
  }, true);

  return win;
}
