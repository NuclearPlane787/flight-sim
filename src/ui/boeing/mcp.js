// The Boeings' mode control panel, in the FCU's strip at the top. The order is the aircraft's, left
// to right: A/T, IAS/MACH, LNAV, VNAV, FLCH, HDG, HDG SEL, HDG HOLD, V/S, ALT, ALT HOLD, LOC, APP,
// A/P, TO/GA. It calls the methods of sim.ap (src/sim/autopilot-boeing.js; STATUS.md, "v0.3.0
// interfaces"). The windows turn and type as the FCU's do (knobs.js, the same code), with these
// differences: a speed can be typed as a Mach (84, .84 or 0.84) as well as in knots, and above
// FL260 the IAS/MACH window shows and turns in Mach. Enter pushes the knob: HDG goes to HDG SEL,
// ALT to FLCH, V/S to V/S. Plain divs, never focusable, like the FCU.

import { clamp, wrap360 } from '../common.js';
import { bindKnobs } from '../knobs.js';
import { baroOf, baroText, typedBaro, turnBaro, toggleStd } from '../fcu.js';
import { mcpLights, usesMach, machOfKt, ktOfMach, machText, typedSpeedKt } from './logic.js';

const FPM = 196.85;     // ft/min per m/s
// The ALT window's top, ft: past both Boeings' certified ceiling (43,100 ft) on purpose, so you can
// see what happens up there (Shane, v0.3.2). setAlt() in autopilot-boeing.js has the same top.
const ALT_TOP = 45000;

// [kind, key, label, tooltip, ap method]. A label's <br> makes the button two lines tall.
const STRIP = [
  // The EFIS panel's altimeter setting, outboard of the MCP, as on the aircraft.
  ['w', 'baro', 'BARO'],
  ['b', 'std', 'STD', 'Altimeter: standard (1013) or back to the setting in the BARO window', null],
  ['b', 'at', 'A/T', 'Autothrottle: arm or off (X). Pushing the levers past it overrides it', 'toggleAthr'],
  ['w', 'spd', 'IAS/MACH'],
  ['b', 'lnav', 'LNAV', 'Lateral navigation: follow the route', 'lnav'],
  ['b', 'vnav', 'VNAV', 'Vertical navigation: climb and descend for the route', 'vnav'],
  ['b', 'flch', 'FLCH', 'Flight level change: the elevators hold the speed, the thrust does the climb or descent', 'levelChange'],
  ['w', 'hdg', 'HDG'],
  ['b', 'hdgsel', 'HDG<br>SEL', 'Heading select: fly the HDG window', 'hdgSel'],
  ['b', 'hdghold', 'HDG<br>HOLD', 'Heading hold: fly the present heading', 'hdgHold'],
  ['w', 'vs', 'V/S'],
  ['b', 'vs', 'V/S', 'Vertical speed: fly the V/S window', null],
  ['w', 'alt', 'ALT'],
  ['b', 'althold', 'ALT<br>HOLD', 'Altitude hold: level off at the present altitude', 'altHold'],
  ['b', 'loc', 'LOC', 'Localizer: arm and fly the runway’s centreline', 'loc'],
  ['b', 'app', 'APP', 'Approach: arm and fly the localizer and the glideslope, and land', 'app'],
  ['b', 'ap', 'A/P', 'Autopilot (Z)', null],
  ['b', 'toga', 'TO/<br>GA', 'Take-off or go-around thrust and guidance (O)', 'toga'],
];
const TIPS = {
  spd: 'Speed (kt, or Mach above FL260; 84 or .84 is a Mach)',
  hdg: 'Heading',
  alt: 'Altitude (ft; 350 = FL350)',
  vs: 'Vertical speed (ft/min; −15 = −1,500)',
  baro: 'Altimeter setting (hPa)',
};

export function createMcp(root, hud) {
  const el = document.createElement('div');
  el.className = 'fsui-fcu fsui-mcp fsui-panel';
  root.appendChild(el);
  const parts = {}, btns = {}, methods = {};
  for (const [kind, k, label, tip, method] of STRIP) {
    const d = document.createElement('div');
    d.dataset.k = k;
    if (kind === 'w') {
      d.className = 'fsui-win';
      d.title = `${TIPS[k]}: scroll to turn (fast for big steps), or click, type a value and press Enter`;
      d.innerHTML = `<span class="fsui-lab">${label}</span><span class="fsui-val"></span><span class="fsui-mode"></span>`;
      parts[k] = { el: d, lab: d.querySelector('.fsui-lab'), val: d.querySelector('.fsui-val'), text: null, cls: null };
    } else {
      d.className = 'fsui-btn';
      d.title = tip;
      d.innerHTML = `<span>${label}</span><i class="fsui-light"></i>`;
      btns[k] = { el: d, lit: -1 };
      methods[k] = method;
    }
    el.appendChild(d);
  }

  let view = null, vsPreset = null, vsPresetAt = 0;
  const lights = {};
  const call = (name, ...args) => { const ap = view?.ap; if (ap && typeof ap[name] === 'function') ap[name](...args); };
  const vsMode = () => view?.ap?.vertical === 'V/S';
  const mach = () => usesMach(view?.state);
  const presentVs = () => Math.round((view?.state?.vs ?? 0) * FPM / 100) * 100;

  // The speed window's units change with height, so its steps do: 1 kt or 0.01, and big steps of
  // 10 kt or 0.05 (10 × 0.01 would be a jump from cruise to the buffet).
  const windows = {
    spd: { step: 1, get big() { return mach() ? 5 : 10; } },
    hdg: { step: 1, big: 10 },
    alt: { step: 100, big: 1000 },
    vs: { step: 100, big: 500 },
    baro: { step: 1, big: 5 },
  };

  function current(k) {
    const ap = view?.ap || {};
    if (k === 'spd') {
      const kt = ap.spdKt ?? 250;
      return mach() ? Math.round(machOfKt(kt, view.state.pos.z, view.state) * 100) : Math.round(kt);
    }
    if (k === 'hdg') return Math.round(ap.hdgDeg ?? 0);
    if (k === 'alt') return Math.round(ap.altFt ?? 5000);
    if (k === 'baro') return Math.round(baroOf(view)?.hpa ?? 1013);
    return vsMode() ? ap.vsFpm ?? 0 : vsPreset ?? presentVs();
  }

  function setValue(k, v) {
    if (k === 'spd') {
      const kt = mach() ? ktOfMach(v / 100, view.state.pos.z, view.state) : v;
      call('setSpd', clamp(Math.round(kt), 100, 399));
    } else if (k === 'hdg') { const h = wrap360(Math.round(v)); call('setHdg', h === 0 ? 360 : h); }
    else if (k === 'alt') call('setAlt', clamp(Math.round(v / 100) * 100, 100, ALT_TOP));
    else if (k === 'baro') turnBaro(view, v);
    else if (k === 'vs') {
      const s = clamp(Math.round(v / 100) * 100, -6000, 6000);
      if (vsMode()) call('setVs', s); else { vsPreset = s; vsPresetAt = performance.now(); }
    }
  }

  function engageVs() {
    const v = vsPreset ?? (vsMode() ? view?.ap?.vsFpm ?? 0 : presentVs());
    call('setVs', clamp(v, -6000, 6000)); vsPreset = null;
  }

  function commit(k, text) {
    if (k === 'baro') {
      const v = typedBaro(text);
      if (v !== null) turnBaro(view, v);
    } else if (k === 'spd') {
      const kt = typedSpeedKt(text, view?.state?.pos?.z ?? 0);
      if (kt !== null) call('setSpd', clamp(Math.round(kt), 100, 399));
    } else {
      let v = text === '' || text === '-' ? null : Number(text);
      if (v !== null && Number.isFinite(v)) {
        if (k === 'alt' && Math.abs(v) < 1000) v *= 100;   // a flight level
        if (k === 'vs' && Math.abs(v) <= 60) v *= 100;     // hundreds of ft/min
        setValue(k, v);
      }
      if (k === 'hdg') call('hdgSel');
      else if (k === 'alt') call('levelChange');
      else if (k === 'vs') engageVs();
    }
    hud.poke();
  }

  const knobs = bindKnobs(el, {
    windows, getView: () => view, current, setValue, commit, refresh: () => refresh(), poke: () => hud.poke(),
    acceptKey(edit, key) {
      if ((key === '-' || key === '−') && edit.k === 'vs' && edit.text === '') { edit.text = '-'; return true; }
      if (key === '.' && edit.k === 'spd' && !edit.text.includes('.')) { edit.text += '.'; return true; }
      return false;
    },
    onClick(e) {
      const b = e.target.closest('.fsui-btn');
      if (!b) return;
      const k = b.dataset.k;
      if (k === 'ap') { if (view?.ap?.ap) call('disconnectAp', 'mcp'); else call('engageAp'); }
      else if (k === 'std') toggleStd(view);
      else if (k === 'vs') engageVs();
      else if (methods[k]) call(methods[k]);
      hud.poke();
    },
  });

  const set = (p, text, cls) => {
    if (p.text !== text) { p.val.textContent = text; p.text = text; }
    if (p.cls !== cls) { p.el.className = 'fsui-win' + cls; p.cls = cls; }
  };
  function refresh() { for (const k in parts) parts[k].cls = null; update(view); }

  let labMach = null;
  function update(v) {
    view = v; if (!v) return;
    const ap = v.ap || {}, on = !!ap.ap, edit = knobs.edit, selected = knobs.selected;
    const sel = (k) => (selected === k ? ' sel' : '');
    const ed = (k) => (edit && edit.k === k ? (edit.text ? ' edit typed' : ' edit') : '');
    const shown = (k, text) => (edit && edit.k === k && edit.text ? edit.text : text);
    const m = usesMach(v.state);
    if (m !== labMach) { parts.spd.lab.textContent = m ? 'MACH' : 'IAS'; labMach = m; }
    const spdText = m ? machText(machOfKt(ap.spdKt ?? 0, v.state.pos.z, v.state)) : String(Math.round(ap.spdKt ?? 0)).padStart(3, '0');
    // In VNAV the MCP's window is blank: the FMC has the speed.
    const fmcSpeed = /^VNAV/.test(ap.vertical || '');
    set(parts.spd, shown('spd', fmcSpeed ? '' : spdText), (ap.athr ? ' lit' : '') + sel('spd') + ed('spd'));
    set(parts.hdg, shown('hdg', String(Math.round(ap.hdgDeg ?? 0) || 360).padStart(3, '0')), (on && ap.lateral === 'HDG SEL' ? ' lit' : '') + sel('hdg') + ed('hdg'));
    set(parts.alt, shown('alt', String(Math.round(ap.altFt ?? 0)).padStart(5, '0')), (on && ap.vertical === 'ALT' ? ' lit' : on && ap.vertical === 'FLCH SPD' ? ' arm' : '') + sel('alt') + ed('alt'));
    if (vsPreset !== null && performance.now() - vsPresetAt > 10000 && !vsMode()) vsPreset = null;
    const vsv = vsMode() ? ap.vsFpm ?? 0 : vsPreset;
    const vsText = vsv === null || vsv === undefined ? '-----' : (vsv >= 0 ? '+' : '−') + String(Math.abs(Math.round(vsv / 100) * 100)).padStart(4, '0');
    set(parts.vs, shown('vs', vsText), (on && vsMode() ? ' lit' : '') + (vsPreset !== null && !vsMode() ? ' pre' : '') + sel('vs') + ed('vs'));
    const baro = baroOf(v);
    set(parts.baro, shown('baro', baroText(baro)), (baro?.std ? ' lit' : '') + sel('baro') + ed('baro'));
    mcpLights(ap, lights);
    lights.std = baro?.std ? 2 : 0;
    for (const k in btns) {
      const b = btns[k], lit = lights[k];
      if (b.lit !== lit) { b.el.classList.toggle('on', lit === 2); b.el.classList.toggle('arm', lit === 1); b.lit = lit; }
    }
  }

  return { el, update, close: knobs.close, get editing() { return knobs.edit ? knobs.edit.k : null; } };
}
