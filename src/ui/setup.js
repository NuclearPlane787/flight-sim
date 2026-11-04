// Flight setup: a modal for origin and runway, destination and runway, the start
// (runway, 15 nm final, or a gate with pushback and taxi), passengers, cargo and fuel, with weight checks.
// createSetup(root, { airports, coast?, types? }) -> { show(defaults, opts?) -> Promise<plan | null>, hide(), setTypes(list) }
// plan = { origin, depRunway, dest, arrRunway, start, stand?, type, pax, cargoKg, fuelKg, waypoints, payloadKg, name? }
// (stand: the origin stand's ref, for start 'gate'; type: the aircraft's id in src/sim/types.js)
// `types`: the picker's list, TYPE_LIST() unless given (the tests pass a list to see three cards).
// defaults.type sets the aircraft at the start (missing: the A321neo).
// plan.time = { mode: 'now' } (the real time in Korea, the default) | { mode: 'set', ms } (a date and a
// KST time picked here, KST whatever the Mac's timezone); defaults.time sets the start.
// opts = { title, name, nameField, cancel, lockType }: the dialog's title ("New scenario", "New flight"),
// a Name field at the top (3–40 characters; the plan gets `name`, cleaned), a Cancel button (resolves null),
// and lockType: a scenario keeps its aircraft, so a New flight inside one shows only defaults.type's card.
// The last plan is kept in localStorage['gamedump:flight-sim:settings'].lastPlan.

import { C, font, NM, airportList, thresholdOf, buildCoast, traceRings, setWaypoints } from './common.js';
import { cleanName, nameOk, NAME_MIN, NAME_MAX } from '../scenarios.js';
import { fmtKst, fmtKstDate } from '../clock.js';
import { kstFieldValues, kstFromFields } from './sky-window.js';
import { esc } from './score-panel.js';
import { standList } from '../ground/gate-flow.js';
import { TYPE_LIST, typeById, DEFAULT_TYPE } from '../sim/types.js';

const KEY = 'gamedump:flight-sim:settings';

// The A321neo's weights (kg), for what imports them. The dialog uses the selected type's.
export const LIMITS = typeById(DEFAULT_TYPE).limits;

// Fuel for the trip, as a rough block-fuel rule from the type's `fuel` numbers. The A321neo's:
//   trip    = 1,100 kg (climb and descent) + 6.2 kg per nm along the route
//             (≈ 2.4 t/h at a 390 kt average ground speed),
//   reserve = 30 min holding at ≈ 2,000 kg/h = 1,000 kg, plus 5 % of the trip as contingency,
//   taxi    = 200 kg.
// Rounded up to 100 kg. Gimpo–Jeju (243 nm) gives about 4,000 kg.
// `type`: a registry entry or an id; without one, the A321neo.
export function fuelEstimate(distNm, type) {
  const r = (type && typeof type === 'object' ? type : typeById(type)).fuel;
  const trip = r.climbKg + r.perNm * distNm;
  const total = trip * 1.05 + r.holdKg + r.taxiKg;
  return { trip: Math.round(trip), total: Math.ceil(total / 100) * 100 };
}

// The load after a change of type: what fits stays, what doesn't goes to the type's default. A payload
// that fits the seats and the hold can still be over a smaller type's MZFW, so that resets both.
export function fitLoad({ pax, cargoKg }, type) {
  const l = type.limits, d = type.defaults;
  let p = pax > l.PAX_MAX ? d.pax : pax, c = cargoKg > l.CARGO_MAX ? d.cargoKg : cargoKg;
  if (l.OEW + p * l.PAX_KG + c > l.MZFW) { p = d.pax; c = d.cargoKg; }
  return { pax: p, cargoKg: c };
}

// The picture's URL: picker.picture is relative to the game's root, this file two folders below it.
const pictureUrl = (type) => (type.picker?.picture ? new URL('../../' + type.picker.picture, import.meta.url).href : '');

// A type's card: its picture, name and key numbers. A button in the picker; a plain block when `locked`
// (nothing to choose). A missing picture leaves the empty panel behind it (the error listener in createSetup).
export function typeCardHtml(type, pictureSrc = '', locked = false) {
  const k = type.picker || {};
  const cell = (label, value) => `<div><small>${label}</small>${esc(value)}</div>`;
  const tag = locked ? 'div' : 'button';
  return `<${tag} class="fsui-tc"${locked ? '' : ` type="button" data-type="${esc(type.id)}" aria-pressed="false"`}>
      <span class="fsui-tc-pic">${pictureSrc ? `<img src="${esc(pictureSrc)}" alt="">` : ''}</span>
      <span class="fsui-tc-head"><b>${esc(type.name)}</b><small>${esc(type.maker)}</small></span>
      <div class="fsui-tc-nums">
        ${cell('Length', `${k.lengthM?.toFixed(1)} m`)}${cell('Span', `${k.spanM?.toFixed(1)} m`)}${cell('MTOW', `${k.mtowT?.toLocaleString('en-US')} t`)}
        ${cell('Range', `${k.rangeNm?.toLocaleString('en-US')} nm`)}${cell('Seats', k.seats ?? '—')}${cell('Engines', type.engineName ?? '—')}
      </div>
    </${tag}>`;
}

const BASE = { origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'runway', pax: 190, cargoKg: 1500, fuelKg: 0, waypoints: [] };

function loadStored() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
function saveStored(plan) {
  try { const o = loadStored(); o.lastPlan = plan; localStorage.setItem(KEY, JSON.stringify(o)); } catch {}
}

export function createSetup(root, { airports, coast, types } = {}) {
  let typeList = types || null;
  const typesNow = () => typeList || TYPE_LIST();
  let type = typeById(DEFAULT_TYPE);   // the selected type
  let L = type.limits;
  const list = () => airportList(airports);
  let coastL = coast ? buildCoast(coast) : null;
  const el = document.createElement('div');
  el.className = 'fsui-setup'; el.hidden = true;
  el.innerHTML = `
  <div class="fsui-dlg" role="dialog" aria-label="Flight setup">
    <h2 data-o="title">Flight setup</h2>
    <p class="sub" data-o="sub"></p>
    <div class="fsui-sec"><h3>Aircraft</h3>
      <div class="fsui-types" data-o="types" role="group" aria-label="Aircraft type"></div>
      <div class="fsui-note fsui-types-note" data-o="typeNote"></div>
    </div>
    <div class="fsui-sec" data-o="nameRow" hidden><div class="fsui-row"><label for="fsui-setup-name">Name</label>
      <input type="text" id="fsui-setup-name" class="fsui-name" data-f="name" maxlength="${NAME_MAX + 10}" spellcheck="false" autocomplete="off">
      <span class="fsui-note">${NAME_MIN}–${NAME_MAX} characters</span></div></div>
    <div class="fsui-grid">
      <div>
        <div class="fsui-sec"><h3>Route</h3>
          <div class="fsui-row"><label>From</label><select data-f="origin"></select><select data-f="depRunway"></select></div>
          <div class="fsui-row"><label>To</label><select data-f="dest"></select><select data-f="arrRunway"></select></div>
          <div class="fsui-row"><label>Distance</label><span data-o="dist"></span></div>
        </div>
        <div class="fsui-sec"><h3>Start</h3>
          <div class="fsui-row"><div class="fsui-seg" data-seg="start">
            <button data-v="runway">On the runway</button><button data-v="final">On a 15 nm final</button><button data-v="gate" title="At a stand, with pushback (P) and a taxi route to the runway">At the gate</button>
          </div></div>
          <div class="fsui-row" data-o="standRow" style="display:none"><label>Stand</label><select data-f="stand"></select><span class="fsui-note" data-o="standNote"></span></div>
        </div>
        <div class="fsui-sec"><h3>Load</h3>
          <div class="fsui-row"><label>Passengers</label><input type="range" min="0" step="1" data-f="paxR"><input type="number" min="0" step="1" data-f="pax"><span class="fsui-note" data-o="paxNote"></span></div>
          <div class="fsui-row"><label>Cargo</label><input type="number" min="0" step="100" data-f="cargoKg"><span class="fsui-note">kg</span></div>
          <div class="fsui-row"><label>Fuel</label><input type="number" min="0" step="100" data-f="fuelKg"><span class="fsui-note">kg</span>
            <button class="fsui-b" data-a="enough">Enough for the trip + reserve</button></div>
          <div class="fsui-weights" data-o="weights"></div>
        </div>
      </div>
      <div>
        <div class="fsui-sec"><h3>Pick on the map</h3>
          <div class="fsui-row"><div class="fsui-seg" data-seg="pick"><button data-v="origin">Set origin</button><button data-v="dest">Set destination</button></div></div>
          <canvas class="fsui-mini"></canvas>
          <div class="fsui-mini-help">Click an airport to set it. Runways are listed on the left.</div>
        </div>
        <div class="fsui-sec"><h3>Time</h3>
          <div class="fsui-row"><div class="fsui-seg" data-seg="time">
            <button data-v="now" title="The real time in Korea">Now</button><button data-v="set" title="A date and a time (KST)">Set</button>
          </div><span class="fsui-note" data-o="timeNote"></span></div>
          <div class="fsui-row" data-o="timeRow" hidden><input type="date" data-t="date" class="fsui-date"><input type="time" data-t="time" step="60" class="fsui-time"><span class="fsui-note">KST</span></div>
        </div>
      </div>
    </div>
    <div class="fsui-foot"><span class="msg" data-o="msg"></span><button class="fsui-b" data-a="cancel" hidden>Cancel</button><button class="fsui-b primary" data-a="fly">Fly</button></div>
  </div>`;
  root.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const f = (n) => el.querySelector(`[data-f="${n}"]`);
  const o = (n) => el.querySelector(`[data-o="${n}"]`);
  const mini = $('.fsui-mini');
  // A card's picture that isn't there: the panel behind it stays. (error doesn't bubble, so captured.)
  o('types').addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
  let plan = null, pick = 'dest', resolver = null, opts = {};
  // The start time: 'now' or 'set' (from the date and time fields, read as KST).
  let timeMode = 'now';
  const tf = (n) => el.querySelector(`[data-t="${n}"]`);
  function setTimeMode(mode, ms) {
    timeMode = mode === 'set' ? 'set' : 'now';
    if (Number.isFinite(ms) || (timeMode === 'set' && !tf('date').value)) {
      const v = kstFieldValues(Number.isFinite(ms) ? ms : Date.now());
      tf('date').value = v.date; tf('time').value = v.time;
    }
    seg('time', timeMode);
    o('timeRow').hidden = timeMode !== 'set';
    const now = Date.now();
    o('timeNote').textContent = timeMode === 'now' ? `${fmtKst(now)} KST, ${fmtKstDate(now)}` : '';
  }

  // Keys typed here never reach the game (the name field included); Enter flies, Esc cancels.
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); fly(); }
    else if (e.key === 'Escape' && opts.cancel) { e.preventDefault(); cancel(); }
  });
  // The name field stops its keys itself (so no game key fires while typing), with the same Enter and Esc.
  f('name').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); fly(); }
    else if (e.key === 'Escape' && opts.cancel) { e.preventDefault(); cancel(); }
  });
  el.addEventListener('keyup', (e) => e.stopPropagation());
  for (const t of ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu']) el.addEventListener(t, (e) => e.stopPropagation());
  el.addEventListener('wheel', (e) => { e.stopPropagation(); if (!e.target.closest('.fsui-dlg')) e.preventDefault(); }, { passive: false });

  const opt = (sel, items, val) => {
    sel.innerHTML = items.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    sel.value = items.some(([v]) => v === val) ? val : items[0]?.[0] ?? '';
    return sel.value;
  };
  const ends = (icao) => (list().find((a) => a.icao === icao)?.runways || []).flatMap((r) => r.ends.map((e) => [e.ident, `RWY ${e.ident}  (${Math.round(r.lengthM || 0).toLocaleString()} m)`]));
  const endObj = (icao, ident) => {
    for (const r of list().find((a) => a.icao === icao)?.runways || []) for (const e of r.ends) if (e.ident === ident) return e;
    return null;
  };
  // The stands this type can use at an airport: gates first, then the rest, numbers in number order.
  const standsAt = (icao) => standList(list().find((a) => a.icao === icao), type);
  const stands = (icao) => standsAt(icao).map((s) => [s.ref, `${s.gate ? 'Gate' : 'Stand'} ${s.ref}`]);
  const distNm = () => {
    const a = endObj(plan.origin, plan.depRunway), b = endObj(plan.dest, plan.arrRunway);
    if (!a || !b) return 0;
    const pts = [thresholdOf(a), ...(plan.waypoints || []), thresholdOf(b)];
    let d = 0; for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return d / NM;
  };

  function fill() {
    const aps = list().map((a) => [a.icao, `${a.icao} · ${a.name || ''}`]);
    plan.origin = opt(f('origin'), aps, plan.origin);
    plan.depRunway = opt(f('depRunway'), ends(plan.origin), plan.depRunway);
    plan.dest = opt(f('dest'), aps, plan.dest);
    plan.arrRunway = opt(f('arrRunway'), ends(plan.dest), plan.arrRunway);
    const st = stands(plan.origin);
    plan.stand = st.length ? opt(f('stand'), st, plan.stand) : '';
    if (!st.length) f('stand').innerHTML = '';
    f('pax').value = f('paxR').value = plan.pax;
    f('cargoKg').value = plan.cargoKg;
    f('fuelKg').value = plan.fuelKg;
    seg('start', plan.start); seg('pick', pick);
    refresh();
  }
  function seg(name, v) {
    for (const b of el.querySelectorAll(`[data-seg="${name}"] button`)) b.classList.toggle('on', b.dataset.v === v);
    if (name === 'start') {
      o('standRow').style.display = v === 'gate' ? '' : 'none';
      const all = standsAt(plan.origin), n = all.length, g = all.filter((s) => s.gate).length;
      o('standNote').textContent = n ? `${g} gates, ${n - g} remote stands · P pushes back` : noStands();
    }
  }

  // Whether the airport has no stands at all, or none for this aircraft.
  const noStands = () => ((list().find((a) => a.icao === plan.origin)?.stands || []).some((s) => s.ref) ? `No stand here for the ${type.name}` : 'No stands mapped here');

  // ---- The aircraft ----
  const enoughFuel = (t, d) => Math.min(t.limits.FUEL_MAX, fuelEstimate(d, t).total);
  // An id to a type: from the list, else (a locked scenario's type, which may not be on it) the registry.
  const findType = (id, locked) => typesNow().find((t) => t.id === id) || (locked ? typeById(id) : typesNow()[0] || typeById(id));
  function setType(t) {
    type = t; L = t.limits;
    f('paxR').max = f('pax').max = L.PAX_MAX;
    f('cargoKg').max = L.CARGO_MAX;
    f('fuelKg').max = L.FUEL_MAX;
    o('paxNote').textContent = `× ${L.PAX_KG} kg incl. bags`;
    o('sub').textContent = `${t.name} · Nuclear Airlines · ${t.registration}`;
    for (const c of o('types').querySelectorAll('button.fsui-tc')) {
      const on = c.dataset.type === t.id;
      c.classList.toggle('on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    o('typeNote').textContent = opts.lockType ? 'A scenario keeps its aircraft. New scenario to fly another.' : (t.picker?.note || '');
  }
  function renderTypes() {
    const shown = opts.lockType ? [type] : typesNow();
    o('types').className = `fsui-types n${shown.length}`;
    o('types').innerHTML = shown.map((t) => typeCardHtml(t, pictureUrl(t), !!opts.lockType)).join('');
    if (opts.lockType) o('types').firstElementChild?.classList.add('on');
    setType(type);
  }
  // The player picks another type: the limits, the fuel rule and the stands follow. The load stays if it
  // fits; the fuel follows too if it was the old type's "enough", and is cut if it won't fit the tanks.
  function chooseType(id) {
    const next = findType(id);
    if (next.id === type.id) return;
    readInputs();
    const d = distNm(), wasEnough = plan.fuelKg === enoughFuel(type, d);
    setType(next);
    plan.type = next.id;
    Object.assign(plan, fitLoad(plan, next));
    if (wasEnough || plan.fuelKg > L.FUEL_MAX) plan.fuelKg = enoughFuel(next, d);
    fill();
  }

  const num = (v, lo, hi) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo; };
  function readInputs(src) {
    if (src === f('paxR')) f('pax').value = f('paxR').value;
    if (src === f('pax')) f('paxR').value = f('pax').value;
    plan.pax = num(f('pax').value, 0, L.PAX_MAX);
    plan.cargoKg = num(f('cargoKg').value, 0, 100000);
    plan.fuelKg = num(f('fuelKg').value, 0, Math.max(100000, L.FUEL_MAX * 2)); // room above the tanks, so the "tanks hold" message can fire
  }

  // Weights and the checks; returns the first blocking problem, or ''.
  function refresh() {
    const d = distNm(), est = fuelEstimate(d, type);
    o('dist').textContent = d ? `${Math.round(d)} nm` + (plan.origin === plan.dest ? ' (same airport: a circuit)' : '') : '–';
    const payload = plan.pax * L.PAX_KG + plan.cargoKg;
    const zfw = L.OEW + payload, tow = zfw + plan.fuelKg, lw = Math.round((tow - Math.min(plan.fuelKg, est.trip + 200)) / 10) * 10;
    const problems = [];
    let warn = '';
    if (plan.cargoKg > L.CARGO_MAX) problems.push(`Cargo is over the hold's ${L.CARGO_MAX.toLocaleString()} kg.`);
    if (plan.fuelKg > L.FUEL_MAX) problems.push(`The tanks hold ${L.FUEL_MAX.toLocaleString()} kg.`);
    if (zfw > L.MZFW) problems.push(`Zero-fuel weight is over the ${L.MZFW.toLocaleString()} kg limit.`);
    if (tow > L.MTOW) problems.push(`Take-off weight is over MTOW (${L.MTOW.toLocaleString()} kg).`);
    if (plan.fuelKg < 600) problems.push('Load some fuel.');
    if (!problems.length && plan.fuelKg < est.total) warn = 'Less fuel than the trip + reserve estimate.';
    if (!problems.length && lw > L.MLW) warn = 'Landing weight will be over MLW: burn fuel first or expect a heavy landing.';
    const row = (t, v, lim, cls = '') => `${t} <b class="${cls}">${Math.round(v).toLocaleString()}</b> kg${lim ? ` / ${lim.toLocaleString()}` : ''}`;
    o('weights').innerHTML = [
      `Payload <b>${payload.toLocaleString()}</b> kg · ZFW ${row('', zfw, L.MZFW, zfw > L.MZFW ? 'bad' : '').trim()}`,
      `${row('Take-off', tow, L.MTOW, tow > L.MTOW ? 'bad' : '')} · ${row('Landing (est.)', lw, L.MLW, lw > L.MLW ? 'warn' : '')}`,
      `Trip fuel ≈ <b>${est.trip.toLocaleString()}</b> kg · with 30 min reserve, 5 % and taxi: <b>${est.total.toLocaleString()}</b> kg`,
    ].join('<br>');
    o('msg').textContent = problems[0] || warn;
    o('msg').style.color = problems.length ? C.red : C.amber;
    $('[data-a="fly"]').disabled = problems.length > 0;
    drawMini();
    return problems[0] || '';
  }

  el.addEventListener('input', (e) => {
    if (e.target === f('name')) { refresh(); return; }
    if (e.target.dataset.t) return;   // the start time's fields are read on Fly
    if (e.target.matches('input')) { readInputs(e.target); refresh(); }
  });
  el.addEventListener('change', (e) => {
    const n = e.target.dataset.f;
    if (n === 'origin') { plan.origin = e.target.value; plan.depRunway = ''; plan.stand = ''; fill(); }
    else if (n === 'stand') { plan.stand = e.target.value; }
    else if (n === 'dest') { plan.dest = e.target.value; plan.arrRunway = ''; fill(); }
    else if (n === 'depRunway' || n === 'arrRunway') { plan[n] = e.target.value; refresh(); }
    else if (e.target === f('name') || e.target.dataset.t) { /* read on Fly */ }
    else if (e.target.matches('input')) { readInputs(e.target); fill(); }
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.type) { chooseType(b.dataset.type); return; }
    const sg = b.closest('[data-seg]');
    if (sg && !b.disabled) {
      if (sg.dataset.seg === 'time') { setTimeMode(b.dataset.v); return; }
      if (sg.dataset.seg === 'start') plan.start = b.dataset.v; else pick = b.dataset.v;
      seg(sg.dataset.seg, b.dataset.v); refresh();
    } else if (b.dataset.a === 'enough') {
      plan.fuelKg = enoughFuel(type, distNm()); f('fuelKg').value = plan.fuelKg; refresh();
    } else if (b.dataset.a === 'fly') fly();
    else if (b.dataset.a === 'cancel') cancel();
  });

  // The small map: airports, the route line, click an airport to pick it.
  const miniState = { k: 1, cx: 0, cy: 0, pts: [] };
  function drawMini() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3), W = 300, H = 300;
    if (mini.width !== W * dpr) { mini.width = W * dpr; mini.height = H * dpr; }
    const ctx = mini.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#06101c'; ctx.fillRect(0, 0, W, H);
    const aps = list();
    if (!aps.length) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const a of aps) { const [x, y] = a.origin; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const span = Math.max(x1 - x0, y1 - y0) * 1.35 || 100000;
    const k = W / span, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    Object.assign(miniState, { k, cx, cy });
    const X = (x) => W / 2 + (x - cx) * k, Y = (y) => H / 2 - (y - cy) * k;
    if (coastL) {
      ctx.beginPath();
      traceRings(ctx, coastL.land, coastL.lod(1 / k), { x0: cx - span, x1: cx + span, y0: cy - span, y1: cy + span }, (x, y, p) => { p[0] = X(x); p[1] = Y(y); return p; }, 2 / k);
      ctx.fillStyle = '#1c2a22'; ctx.fill('evenodd'); ctx.strokeStyle = '#46775a'; ctx.lineWidth = 1; ctx.stroke();
    }
    const a = endObj(plan.origin, plan.depRunway), b = endObj(plan.dest, plan.arrRunway);
    if (a && b) {
      ctx.strokeStyle = C.magenta; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); for (const [x, y] of plan.waypoints || []) ctx.lineTo(X(x), Y(y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke();
    }
    miniState.pts = [];
    for (const ap of aps) {
      const [x, y] = ap.origin, sx = X(x), sy = Y(y);
      miniState.pts.push([ap.icao, sx, sy]);
      const col = ap.icao === plan.origin ? C.green : ap.icao === plan.dest ? C.magenta : C.white;
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.fill();
      ctx.font = font(13, true); ctx.textBaseline = 'middle';
      const near = aps.some((b) => b !== ap && b.origin[0] > x && Math.hypot(b.origin[0] - x, b.origin[1] - y) * k < 60);
      const right = sx < W - 80 && !near;
      ctx.textAlign = right ? 'left' : 'right';
      ctx.fillText(ap.icao, sx + (right ? 10 : -10), sy);
    }
  }
  mini.addEventListener('click', (e) => {
    const r = mini.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    let best = null, bd = 28;
    for (const [icao, x, y] of miniState.pts) { const d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = icao; } }
    if (!best) return;
    if (pick === 'origin') { plan.origin = best; plan.depRunway = ''; plan.stand = ''; pick = 'dest'; }
    else { plan.dest = best; plan.arrRunway = ''; }
    fill();
  });

  function fly() {
    readInputs();
    if (refresh()) return;
    if (opts.nameField && !nameOk(f('name').value)) {
      o('msg').textContent = `Give the scenario a name of ${NAME_MIN}–${NAME_MAX} characters.`; o('msg').style.color = C.red;
      f('name').focus(); return;
    }
    let startMs = null;
    if (timeMode === 'set') {
      startMs = kstFromFields(tf('date').value, tf('time').value);
      if (startMs === null) { o('msg').textContent = 'Pick a date and a time for the start, or choose Now.'; o('msg').style.color = C.red; tf('date').focus(); return; }
    }
    if (plan.start === 'gate' && !plan.stand) { o('msg').textContent = `${noStands()}: start on the runway.`; o('msg').style.color = C.red; return; }
    const out = { origin: plan.origin, depRunway: plan.depRunway, dest: plan.dest, arrRunway: plan.arrRunway, start: plan.start, type: type.id,
      pax: plan.pax, cargoKg: plan.cargoKg, fuelKg: plan.fuelKg, waypoints: (plan.waypoints || []).map((p) => [p[0], p[1]]),
      payloadKg: plan.pax * L.PAX_KG + plan.cargoKg };
    if (plan.start === 'gate') out.stand = plan.stand;
    saveStored(out);
    if (opts.nameField) out.name = cleanName(f('name').value);
    out.time = timeMode === 'set' ? { mode: 'set', ms: startMs } : { mode: 'now' };
    setWaypoints(out.waypoints);
    hide();
    const r = resolver; resolver = null; r?.(out);
  }
  function cancel() {
    hide();
    const r = resolver; resolver = null; r?.(null);
  }
  function hide() { if (el.contains(document.activeElement)) document.activeElement.blur(); el.hidden = true; }

  // show(defaults, opts): the built-in plan, then the last plan, then the given defaults.
  function show(defaults = {}, options = {}) {
    opts = options || {};
    type = findType(defaults?.type ?? DEFAULT_TYPE, !!opts.lockType);
    // The last plan's load and stand belong to its own type: they don't carry over to another.
    const last = { ...(loadStored().lastPlan || {}) };
    if ((last.type || DEFAULT_TYPE) !== type.id) { delete last.pax; delete last.cargoKg; delete last.fuelKg; delete last.stand; }
    plan = { ...BASE, ...type.defaults, ...last, ...(defaults || {}), type: type.id };
    delete plan.name;
    const t = defaults?.time;
    delete plan.time;
    tf('date').value = ''; tf('time').value = '';
    setTimeMode(t?.mode === 'set' && Number.isFinite(t.ms) ? 'set' : 'now', t?.mode === 'set' ? t.ms : undefined);
    if (!plan.fuelKg) { plan.fuelKg = 0; }
    $('[data-o="title"]').textContent = opts.title || 'Flight setup';
    el.querySelector('.fsui-dlg').setAttribute('aria-label', opts.title || 'Flight setup');
    o('nameRow').hidden = !opts.nameField;
    f('name').value = opts.nameField ? (opts.name || '') : '';
    $('[data-a="cancel"]').hidden = !opts.cancel;
    renderTypes();
    el.hidden = false;
    fill();
    if (!plan.fuelKg) { plan.fuelKg = enoughFuel(type, distNm()); f('fuelKg').value = plan.fuelKg; refresh(); }
    if (opts.nameField) { f('name').focus({ preventScroll: true }); f('name').select(); }
    else $('[data-a="fly"]').focus({ preventScroll: true });
    return new Promise((res) => { resolver = res; });
  }

  // A new list for the picker (the tests' three-type list). Applies at once if the dialog is open.
  function setTypes(l) {
    typeList = l || null;
    if (el.hidden) return;
    const stay = typesNow().find((t) => t.id === type.id);
    if (stay) { type = stay; renderTypes(); fill(); }
    else { renderTypes(); chooseType(typesNow()[0]?.id); }
  }

  return { show, hide, setTypes, setCoast(c) { coastL = c ? buildCoast(c) : null; if (!el.hidden) drawMini(); }, get isOpen() { return !el.hidden; } };
}
