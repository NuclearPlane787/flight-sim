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
import { rulesAt } from '../world/region.js';
import { inHgToHpa, hpaToInHg } from '../sim/atmosphere.js';
import { hdg1000 } from '../sim/autopilot.js';

const WINDOWS = [
  { k: 'spd', label: 'SPD', step: 1, big: 10, tip: 'Speed (kt)' },
  { k: 'hdg', label: 'HDG', step: 1, big: 10, tip: 'Heading (decimals to 0.001°: 071.466)', decimal: true, maxLen: 7 },
  { k: 'alt', label: 'ALT', step: 100, big: 1000, tip: 'Altitude (ft; 350 = FL350)' },
  // v0.7.4: in TRK-FPA the V/S window is a flight path angle, in tenths of a degree (fpaMode below).
  { k: 'vs', label: 'V/S', get step() { return fpaMode ? 0.1 : 100; }, get big() { return fpaMode ? 1 : 500; }, tip: 'Vertical speed (ft/min; −15 = −1,500), or in TRK-FPA a flight path angle (−9.9° to +9.9°)', maxLen: 5 },
  { k: 'baro', label: 'BARO', step: 1, big: 5, tip: 'Altimeter setting (hPa)' },
];
let fpaMode = false;   // v0.7.4: the strip's TRK-FPA, as the last update saw it
const W = Object.fromEntries(WINDOWS.map((w) => [w.k, w]));

// v0.7.4 (Shane's item 9): headings with decimals, on both families' strips. The window shows the whole degree (as
// before); what's set keeps 0.001°. A typed '.' is taken once in the heading window.
export const hdgSetting = (v) => hdg1000(v) || 360;
export const hdgWindowText = (deg) => String(Math.round(wrap360(deg ?? 0)) || 360).padStart(3, '0');
export const acceptHdgPoint = (edit, key) => key === '.' && edit.k === 'hdg' && !edit.text.includes('.');

// v0.7.4: TRK-FPA's flight path angle in the V/S window: a sign and tenths (+0.0, −3.0). A typed angle is degrees
// (−3, −3.5); past 9.9 it's tenths (−35 = −3.5°). Returns degrees, or null.
export const fpaText = (deg) => (deg >= 0 ? '+' : '−') + Math.abs(Math.round((deg || 0) * 10) / 10).toFixed(1);
export function typedFpa(text) {
  if (text === '' || text === '-' || text === '.') return null;
  let v = Number(text);
  if (!Number.isFinite(v)) return null;
  if (Math.abs(v) > 9.95 && !text.includes('.')) v /= 10;
  return clamp(Math.round(v * 10) / 10, -9.9, 9.9);
}
// The FCU's LOC and APPR lights (as the Boeings' MCP's: APPR lit when the glideslope is armed or flown, LOC alone
// otherwise): 2 lit, 0 dark. The light shows armed and engaged alike, as the real FCU's does.
export function fcuLights(ap, out = {}) {
  const lat = ap.lateral || '', ver = ap.vertical || '';
  const gs = ver === 'G/S*' || ver === 'G/S' || ap.armedVertical === 'G/S';
  const loc = lat === 'LOC*' || lat === 'LOC' || ap.armedLateral === 'LOC';
  out.appr = gs ? 2 : 0;
  out.loc = !gs && loc ? 2 : 0;
  return out;
}

// The altimeter setting on the strips (here and on the Boeings' MCP). `sim` is view.sim: its baro and
// setters are the sim's (sim.js, v0.4.0). A typed setting has to be a real one: out of range it's ignored.
export const BARO_MIN = 900, BARO_MAX = 1100;
export const baroOf = (view) => view?.sim?.baro ?? null;
// v0.6.0: the setting in inches of mercury when the BARO's unit is IN (sim.baro.inHg: Japan's, behind the
// region's flag; with it off the unit is never IN, and everything below is v0.5.8's). Inches show as 29.92.
export const inchesOf = (hpa) => Math.round(hpaToInHg(hpa) * 100) / 100;
export const baroValueText = (b) => (!b ? '1013' : b.inHg ? inchesOf(b.hpa).toFixed(2) : String(Math.round(b.hpa)));
export const baroText = (b) => (!b ? '1013' : b.std ? 'STD' : baroValueText(b));
// A typed setting: hPa as before (a whole number, returned rounded), or with inHg, inches: 29.92, or 2992 for
// short (no point and 1,000 or more: hundredths). Inches come back as the exact hPa of the nearest 0.01 inHg.
export function typedBaro(text, inHg = false) {
  if (text === '') return null;
  let v = Number(text);
  if (!inHg) return Number.isFinite(v) && v >= BARO_MIN && v <= BARO_MAX ? Math.round(v) : null;
  if (!Number.isFinite(v)) return null;
  if (!text.includes('.') && Math.abs(v) >= 1000) v /= 100;
  const hpa = inHgToHpa(Math.round(v * 100) / 100);
  return hpa >= BARO_MIN && hpa <= BARO_MAX ? hpa : null;
}
// What the BARO window's knob holds: whole hPa, or hundredths of an inch (2992), so one step is 1 hPa or 0.01 inHg.
export function baroKnobValue(view) {
  const b = baroOf(view);
  return b?.inHg ? Math.round(hpaToInHg(b.hpa) * 100) : Math.round(b?.hpa ?? 1013);
}
export function turnBaro(view, v) {
  if (baroOf(view)?.inHg) view.sim.setBaro?.(clamp(inHgToHpa(Math.round(v) / 100), BARO_MIN, BARO_MAX));
  else view?.sim?.setBaro?.(clamp(Math.round(v), BARO_MIN, BARO_MAX));
}
// Enter on the BARO window: what typedBaro() read, in the window's unit (hPa: as v0.5.8's turnBaro of it).
export function commitBaro(view, text) {
  const inHg = !!baroOf(view)?.inHg, v = typedBaro(text, inHg);
  if (v === null) return;
  if (inHg) view.sim.setBaro?.(v); else turnBaro(view, v);
}
export function toggleStd(view) { const s = view?.sim; if (s?.baro && s.setBaroStd) s.setBaroStd(!s.baro.std); }
// The BARO's unit, IN or HPA: the FCU's outer ring, the Boeings' EFIS selector. A click target, not a key.
export function toggleBaroUnit(view) { const s = view?.sim; if (s?.baro && s.setBaroUnit) s.setBaroUnit(!s.baro.inHg); }

// v0.6.0: the PFDs' metric altitude (Airbus's METRIC ALT, Boeing's MTRS). On by itself where the country's rules
// say so (China), off elsewhere; a click on the button flips it, and the pilot's choice then holds until the
// country under the aircraft changes, when it goes back to that country's default. A display choice only: it
// isn't saved (a loaded flight starts from its place's default).
const metric = { pick: null, country: null };
export function metricAltOn(view) {
  const p = view?.state?.pos;
  if (!p) return false;
  const r = rulesAt(p.x, p.y);
  if (r.country !== metric.country) { metric.country = r.country; metric.pick = null; }
  return metric.pick ?? r.metricAlt;
}
export function toggleMetricAlt(view) { if (view?.state?.pos) metric.pick = !metricAltOn(view); }
export const metricUnitShown = () => true;   // the IN/HPA and METRIC ALT / MTRS buttons (v0.6.0's region only; always since v0.7.0)

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
  // v0.6.0 (the region's flag on): the BARO's outer ring, IN or HPA, beside the window; METRIC ALT beside ALT.
  let unitBtn = null, metricBtn = null;
  // v0.7.4: LOC under the HDG window and APPR under the V/S window, as the real FCU has them (in the strip: after
  // each), and the HDG-V/S / TRK-FPA button between the HDG and ALT windows.
  const locBtn = mkBtn('loc', 'LOC'), trkBtn = mkBtn('trkfpa', '<b class="fsui-u-in">HDG V/S</b><b class="fsui-u-hpa">TRK FPA</b>'), apprBtn = mkBtn('appr', 'APPR');
  locBtn.el.classList.add('fsui-metric'); apprBtn.el.classList.add('fsui-metric');
  trkBtn.el.classList.add('fsui-unit', 'fsui-metric');
  locBtn.el.title = 'Localizer: arm and fly the runway’s centreline (an ILS end only)';
  apprBtn.el.title = 'Approach: arm and fly the localizer and the glideslope (an ILS end only; the AP lets go at 80 ft)';
  trkBtn.el.title = 'HDG-V/S or TRK-FPA: the HDG window a heading or a track over the ground, the V/S window a vertical speed or a flight path angle';
  el.insertBefore(locBtn.el, parts.alt.el); el.insertBefore(trkBtn.el, parts.alt.el);
  el.insertBefore(apprBtn.el, parts.baro.el);
  const labHdg = parts.hdg.el.querySelector('.fsui-lab'), labVs = parts.vs.el.querySelector('.fsui-lab');
  let labFpa = null;
  const lights = {};
  if (metricUnitShown()) {
    unitBtn = mkBtn('unit', '<b class="fsui-u-in">IN</b><b class="fsui-u-hpa">HPA</b>');
    unitBtn.el.classList.add('fsui-unit');
    unitBtn.el.title = 'Altimeter setting in inches of mercury (IN) or hectopascals (HPA): click to change';
    el.insertBefore(unitBtn.el, stdBtn.el);
    metricBtn = mkBtn('metric', 'METRIC<br>ALT');
    metricBtn.el.classList.add('fsui-metric');
    metricBtn.el.title = 'The altitude in metres on the PFD as well (on by itself in China)';
    el.insertBefore(metricBtn.el, parts.vs.el);
  }
  const law = document.createElement('div');
  law.className = 'fsui-law'; law.title = 'Flight control law (Alternate: no stall protection)';
  el.appendChild(law);

  let view = null;
  let vsPreset = null, vsPresetAt = 0;

  const call = (name, ...args) => { const ap = view?.ap; if (ap && typeof ap[name] === 'function') ap[name](...args); };
  const vsMode = () => view?.ap?.vertical === 'V/S';
  const fpa = () => !!view?.ap?.trkFpa;   // v0.7.4
  const fpaNow = () => { const st = view?.state; return st ? clamp(Math.round(Math.atan2(st.vs, Math.max(st.gs || 0, 30)) * 1800 / Math.PI) / 10, -9.9, 9.9) : 0; };

  // What a window holds now (V/S outside V/S mode: the preset, else the current vertical speed).
  function current(k) {
    const ap = view?.ap || {};
    if (k === 'spd') return Math.round(ap.spdKt ?? 250);
    if (k === 'hdg') return ap.hdgDeg ?? 0;   // v0.7.4: the exact value, so the knob steps to the next whole degree
    if (k === 'alt') return Math.round(ap.altFt ?? 5000);
    if (k === 'baro') return baroKnobValue(view);
    if (fpa()) return vsMode() ? ap.fpaDeg ?? 0 : vsPreset ?? fpaNow();   // v0.7.4: degrees
    return vsMode() ? ap.vsFpm ?? 0 : vsPreset ?? Math.round((view?.state?.vs ?? 0) * 196.85 / 100) * 100;
  }

  function setValue(k, v) {
    if (k === 'spd') call('setSpd', clamp(Math.round(v), 100, 399));
    else if (k === 'hdg') call('setHdg', hdgSetting(v));
    else if (k === 'alt') call('setAlt', clamp(Math.round(v / 100) * 100, 100, 39800));
    else if (k === 'baro') turnBaro(view, v);
    else if (k === 'vs' && fpa()) {
      const a = clamp(Math.round(v * 10) / 10, -9.9, 9.9);
      if (vsMode()) call('setFpa', a); else { vsPreset = a; vsPresetAt = performance.now(); }
    } else if (k === 'vs') {
      const s = clamp(Math.round(v / 100) * 100, -6000, 6000);
      if (vsMode()) call('setVs', s); else { vsPreset = s; vsPresetAt = performance.now(); }
    }
  }

  function push(k) {
    const ap = view?.ap; if (!ap) return;
    if (k === 'spd') call('setSpd', Math.round(ap.spdKt ?? 250));
    else if (k === 'hdg') call('setHdg', ap.hdgDeg ?? 0);   // v0.7.4: pushed, it keeps its decimals
    else if (k === 'alt') call('levelChange');
    else if (k === 'vs' && fpa()) { call('setFpa', vsPreset ?? (vsMode() ? ap.fpaDeg ?? 0 : fpaNow())); vsPreset = null; }
    else if (k === 'vs') {
      const v = vsPreset ?? (vsMode() ? ap.vsFpm : Math.round((view.state?.vs ?? 0) * 196.85 / 100) * 100);
      call('setVs', clamp(v, -6000, 6000)); vsPreset = null;
    }
    hud.poke();
  }

  // What was typed: Enter or a second click sets it and pushes the knob.
  function commit(k, text) {
    if (k === 'baro') { commitBaro(view, text); hud.poke(); return; }
    if (k === 'vs' && fpa()) { const a = typedFpa(text); if (a !== null) setValue('vs', a); push('vs'); return; }   // v0.7.4
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
      if (key === '.' && edit.k === 'baro' && baroOf(view)?.inHg && !edit.text.includes('.')) { edit.text += '.'; return true; }
      if (acceptHdgPoint(edit, key)) { edit.text += '.'; return true; }
      if (key === '.' && edit.k === 'vs' && fpa() && !edit.text.includes('.')) { edit.text += '.'; return true; }   // v0.7.4
      return false;
    },
    onClick(e) {
      const b = e.target.closest('.fsui-btn');
      if (b && (b.dataset.k === 'loc' || b.dataset.k === 'appr')) { call(b.dataset.k); hud.poke(); }   // v0.7.4
      else if (b && b.dataset.k === 'trkfpa') { call('toggleTrkFpa'); vsPreset = null; hud.poke(); }
      else if (b && b.dataset.k === 'unit') { toggleBaroUnit(view); hud.poke(); }
      else if (b && b.dataset.k === 'metric') { toggleMetricAlt(view); hud.poke(); }
      else if (b && b.dataset.k === 'ap') { if (view?.ap?.ap) call('disconnectAp', 'fcu'); else call('engageAp'); hud.poke(); }
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
    set(parts.hdg, shown('hdg', hdgWindowText(ap.hdgDeg)), (on && ap.lateral === 'HDG' ? ' lit' : '') + sel('hdg') + ed('hdg'));
    set(parts.alt, shown('alt', String(Math.round(ap.altFt ?? 0)).padStart(5, '0')), (on && /ALT/.test(ap.vertical || '') ? ' lit' : on && /OP/.test(ap.vertical || '') ? ' arm' : '') + sel('alt') + ed('alt'));
    if (vsPreset !== null && performance.now() - vsPresetAt > 10000 && !vsMode()) vsPreset = null;
    const fp = !!ap.trkFpa;
    fpaMode = fp;
    if (labFpa !== fp) { labHdg.textContent = fp ? 'TRK' : 'HDG'; labVs.textContent = fp ? 'FPA' : 'V/S'; labFpa = fp; trkBtn.el.dataset.u = fp ? 'hpa' : 'in'; }
    const vsv = vsMode() ? (fp ? ap.fpaDeg ?? 0 : ap.vsFpm ?? 0) : vsPreset;
    const vsText = vsv === null || vsv === undefined ? (fp ? '-.-' : '-----') : fp ? fpaText(vsv) : (vsv >= 0 ? '+' : '−') + String(Math.abs(Math.round(vsv / 100) * 100)).padStart(4, '0');
    set(parts.vs, shown('vs', vsText), (on && vsMode() ? ' lit' : '') + (vsPreset !== null && !vsMode() ? ' pre' : '') + sel('vs') + ed('vs'));
    const baro = baroOf(v);
    set(parts.baro, shown('baro', baroText(baro)), (baro?.std ? ' lit' : '') + sel('baro') + ed('baro'));
    const light = (b, isOn) => { if (b.on !== isOn) { b.el.classList.toggle('on', isOn); b.on = isOn; } };
    light(apBtn, on); light(athrBtn, !!ap.athr); light(stdBtn, !!baro?.std);
    fcuLights(ap, lights); light(locBtn, lights.loc === 2); light(apprBtn, lights.appr === 2);   // v0.7.4
    if (unitBtn) { const u = baro?.inHg ? 'in' : 'hpa'; if (unitBtn.on !== u) { unitBtn.el.dataset.u = u; unitBtn.on = u; } }
    if (metricBtn) light(metricBtn, metricAltOn(v));
    const lawS = v.state?.law || 'normal';   // v0.8.0 (part 7): the law that flies (the hydraulics' too), LAW DIR in direct
    const lawT = lawS === 'normal' ? 'LAW NORM' : lawS === 'direct' ? 'LAW DIR' : 'LAW ALTN';
    if (law.textContent !== lawT) { law.textContent = lawT; law.classList.toggle('altn', lawT !== 'LAW NORM'); }
  }

  return { el, update, close: knobs.close, get editing() { return knobs.edit ? knobs.edit.k : null; } };
}
