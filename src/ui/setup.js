// Flight setup: a modal for origin and runway, destination and runway, the start
// (runway, 15 nm final, or a gate with pushback and taxi), passengers, cargo and fuel, with weight checks.
// createSetup(root, { airports, coast?, limits? }) -> { show(defaults) -> Promise<plan>, hide() }
// plan = { origin, depRunway, dest, arrRunway, start, stand?, pax, cargoKg, fuelKg, waypoints, payloadKg }
// (stand: the origin stand's ref, for start 'gate')
// The last plan is kept in localStorage['gamedump:flight-sim:settings'].lastPlan.

import { C, font, NM, airportList, thresholdOf, buildCoast, traceRings, setWaypoints } from './common.js';

const KEY = 'gamedump:flight-sim:settings';

// A321neo weights (kg). Max fuel: standard tanks, 23,580 L at 0.8 kg/L, until the sim says otherwise.
export const LIMITS = { OEW: 50100, MTOW: 97000, MLW: 79200, MZFW: 75600, FUEL_MAX: Math.round(23580 * 0.8), PAX_MAX: 244, PAX_KG: 84, CARGO_MAX: 9000 };

// Fuel for the trip, as a rough A321neo block-fuel rule:
//   trip    = 1,100 kg (climb and descent) + 6.2 kg per nm along the route
//             (≈ 2.4 t/h at a 390 kt average ground speed),
//   reserve = 30 min holding at ≈ 2,000 kg/h = 1,000 kg, plus 5 % of the trip as contingency,
//   taxi    = 200 kg.
// Rounded up to 100 kg. Gimpo–Jeju (243 nm) gives about 4,000 kg.
export function fuelEstimate(distNm) {
  const trip = 1100 + 6.2 * distNm;
  const total = trip * 1.05 + 1000 + 200;
  return { trip: Math.round(trip), total: Math.ceil(total / 100) * 100 };
}

const BASE = { origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'runway', pax: 190, cargoKg: 1500, fuelKg: 0, waypoints: [] };

function loadStored() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
function saveStored(plan) {
  try { const o = loadStored(); o.lastPlan = plan; localStorage.setItem(KEY, JSON.stringify(o)); } catch {}
}

export function createSetup(root, { airports, coast, limits } = {}) {
  const L = { ...LIMITS, ...(limits || {}) };
  const list = () => airportList(airports);
  let coastL = coast ? buildCoast(coast) : null;
  const el = document.createElement('div');
  el.className = 'fsui-setup'; el.hidden = true;
  el.innerHTML = `
  <div class="fsui-dlg" role="dialog" aria-label="Flight setup">
    <h2>Flight setup</h2>
    <p class="sub">A321neo · Nuclear Airlines · HL8787</p>
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
          <div class="fsui-row"><label>Passengers</label><input type="range" min="0" max="${L.PAX_MAX}" step="1" data-f="paxR"><input type="number" min="0" max="${L.PAX_MAX}" step="1" data-f="pax"><span class="fsui-note">× ${L.PAX_KG} kg incl. bags</span></div>
          <div class="fsui-row"><label>Cargo</label><input type="number" min="0" max="${L.CARGO_MAX}" step="100" data-f="cargoKg"><span class="fsui-note">kg</span></div>
          <div class="fsui-row"><label>Fuel</label><input type="number" min="0" max="${L.FUEL_MAX}" step="100" data-f="fuelKg"><span class="fsui-note">kg</span>
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
      </div>
    </div>
    <div class="fsui-foot"><span class="msg" data-o="msg"></span><button class="fsui-b primary" data-a="fly">Fly</button></div>
  </div>`;
  root.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const f = (n) => el.querySelector(`[data-f="${n}"]`);
  const o = (n) => el.querySelector(`[data-o="${n}"]`);
  const mini = $('.fsui-mini');
  let plan = null, pick = 'dest', resolver = null;

  // Keys typed here never reach the game; Enter flies.
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); fly(); }
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
  // Stands at an airport: gates first, then the rest, numbers in number order.
  const stands = (icao) => {
    const num = (r) => { const m = String(r).match(/\d+/); return m ? Number(m[0]) : 1e9; };
    return (list().find((a) => a.icao === icao)?.stands || []).filter((s) => s.ref)
      .sort((a, b) => (b.gate - a.gate) || (num(a.ref) - num(b.ref)) || String(a.ref).localeCompare(String(b.ref)))
      .map((s) => [s.ref, `${s.gate ? 'Gate' : 'Stand'} ${s.ref}`]);
  };
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
      const n = stands(plan.origin).length, g = (list().find((a) => a.icao === plan.origin)?.stands || []).filter((s) => s.gate).length;
      o('standNote').textContent = n ? `${g} gates, ${n - g} remote stands · P pushes back` : 'No stands mapped here';
    }
  }

  const num = (v, lo, hi) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo; };
  function readInputs(src) {
    if (src === f('paxR')) f('pax').value = f('paxR').value;
    if (src === f('pax')) f('paxR').value = f('pax').value;
    plan.pax = num(f('pax').value, 0, L.PAX_MAX);
    plan.cargoKg = num(f('cargoKg').value, 0, 100000);
    plan.fuelKg = num(f('fuelKg').value, 0, 100000);
  }

  // Weights and the checks; returns the first blocking problem, or ''.
  function refresh() {
    const d = distNm(), est = fuelEstimate(d);
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
    if (e.target.matches('input')) { readInputs(e.target); refresh(); }
  });
  el.addEventListener('change', (e) => {
    const n = e.target.dataset.f;
    if (n === 'origin') { plan.origin = e.target.value; plan.depRunway = ''; plan.stand = ''; fill(); }
    else if (n === 'stand') { plan.stand = e.target.value; }
    else if (n === 'dest') { plan.dest = e.target.value; plan.arrRunway = ''; fill(); }
    else if (n === 'depRunway' || n === 'arrRunway') { plan[n] = e.target.value; refresh(); }
    else if (e.target.matches('input')) { readInputs(e.target); fill(); }
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const sg = b.closest('[data-seg]');
    if (sg && !b.disabled) {
      if (sg.dataset.seg === 'start') plan.start = b.dataset.v; else pick = b.dataset.v;
      seg(sg.dataset.seg, b.dataset.v); refresh();
    } else if (b.dataset.a === 'enough') {
      plan.fuelKg = Math.min(L.FUEL_MAX, fuelEstimate(distNm()).total); f('fuelKg').value = plan.fuelKg; refresh();
    } else if (b.dataset.a === 'fly') fly();
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
    if (plan.start === 'gate' && !plan.stand) { o('msg').textContent = 'No stands mapped at this airport: start on the runway.'; o('msg').style.color = C.red; return; }
    const out = { origin: plan.origin, depRunway: plan.depRunway, dest: plan.dest, arrRunway: plan.arrRunway, start: plan.start,
      pax: plan.pax, cargoKg: plan.cargoKg, fuelKg: plan.fuelKg, waypoints: (plan.waypoints || []).map((p) => [p[0], p[1]]),
      payloadKg: plan.pax * L.PAX_KG + plan.cargoKg };
    if (plan.start === 'gate') out.stand = plan.stand;
    saveStored(out);
    setWaypoints(out.waypoints);
    hide();
    const r = resolver; resolver = null; r?.(out);
  }
  function hide() { el.hidden = true; }

  // show(defaults): the built-in plan, then the last plan, then the given defaults.
  function show(defaults = {}) {
    plan = { ...BASE, ...(loadStored().lastPlan || {}), ...(defaults || {}) };
    if (!plan.fuelKg) { plan.fuelKg = 0; }
    el.hidden = false;
    fill();
    if (!plan.fuelKg) { plan.fuelKg = Math.min(L.FUEL_MAX, fuelEstimate(distNm()).total); f('fuelKg').value = plan.fuelKg; refresh(); }
    $('[data-a="fly"]').focus({ preventScroll: true });
    return new Promise((res) => { resolver = res; });
  }

  return { show, hide, setCoast(c) { coastL = c ? buildCoast(c) : null; if (!el.hidden) drawMini(); }, get isOpen() { return !el.hidden; } };
}
