// The logbook: a full-window panel listing the flights saved under gamedump:flight-sim:logbook
// (newest first). Totals at the top, one row per flight, a click on a row opens that landing's
// score breakdown, and Clear asks first inside the panel. Esc or Close closes it.
//
//   const logbook = createLogbook(root, { load, save, onclose });
//   logbook.open(opts?); logbook.close(); logbook.isOpen
//
// Since v0.2.0 there is one logbook for every scenario, each entry tagged with its scenario:
//   open({ scenarioId, scenarios, legacyId }) from the pause menu: that scenario's flights only,
//     titled "Logbook · <name>", the totals over those flights;
//   open({ scenarios, legacyId }) from the main menu: every flight, a filter by scenario, and the
//     scenario's name on each row; the totals follow the filter;
//   open() as in v0.1.x: every flight, no names known (untagged ones show as "Scenario 1").
// `scenarios` is [{ id, name }] (the live ones). Entries without a scenarioId (v0.1.x flights)
// belong to `legacyId`, the migrated "Scenario 1". A deleted scenario's flights stay, filtered by
// their id and named by the scenarioName they carry.
// Clear removes everything only while all scenarios are shown; filtered to one, it becomes
// "Clear these flights" and removes only that scenario's entries.
//
// A log entry (main.js → showScore): { date (ISO), route 'RKSS–RKPC', depRunway, arrRunway,
//   gate, airTimeS, fuelUsedKg, score: { points, grade, parts }, scenarioId, scenarioName, type }.
//   Any field may be missing. `type` (v0.3.0) is the aircraft's id; without one it was the A321neo.
// The pure helpers are exported for the node tests.

import { esc, gradeColor, partsHtml, verdict } from './score-panel.js';
import { typeName } from '../scenarios.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');

// Seconds as h:mm ('—' when unknown).
export function fmtDuration(s) {
  if (!Number.isFinite(s) || s < 0) return '—';
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)}:${pad2(m % 60)}`;
}

// An ISO date as local "Sat 31 Oct 2026" and "14:05".
export function fmtDate(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return { day: '—', time: '' };
  return { day: `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`, time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };
}

export function fmtKg(kg) {
  return Number.isFinite(kg) ? `${Math.round(kg).toLocaleString('en-US')} kg` : '—';
}

// The entries newest first, each with its index in the stored array (for the detail view).
export function newestFirst(log) {
  const t = (e) => { const v = Date.parse(e?.date); return Number.isNaN(v) ? -Infinity : v; };
  return (Array.isArray(log) ? log : []).map((e, i) => ({ e, i })).sort((a, b) => (t(b.e) - t(a.e)) || (b.i - a.i));
}

// Flights, hours in the air, the average points over scored flights and the best landing
// (highest points; the newer one on a tie).
export function totals(log) {
  const list = Array.isArray(log) ? log.filter(Boolean) : [];
  let airS = 0, sum = 0, n = 0, best = null;
  for (const e of list) {
    if (Number.isFinite(e.airTimeS) && e.airTimeS > 0) airS += e.airTimeS;
    const p = e.score?.points;
    if (Number.isFinite(p)) {
      sum += p; n++;
      if (!best || p > best.score.points || (p === best.score.points && Date.parse(e.date) >= Date.parse(best.date))) best = e;
    }
  }
  return { flights: list.length, airS, avgPoints: n ? Math.round(sum / n) : null, scored: n, best };
}

export function badgeHtml(score) {
  if (!score || !score.grade) return '<span class="fslb-badge none">—</span>';
  const c = gradeColor(score.grade);
  return `<span class="fslb-badge" style="color:${c};border-color:${c}"><b>${esc(score.grade)}</b>${Number.isFinite(score.points) ? ' ' + score.points : ''}</span>`;
}

// ---- Scenarios (v0.2.0) ----

// The id that untagged (v0.1.x) flights get when no legacy scenario is known.
export const UNTAGGED = '(untagged)';
export const LEGACY_NAME = 'Scenario 1';

// The scenario id an entry belongs to: its scenarioId, or the legacy scenario's for v0.1.x flights.
export function scenarioOf(entry, legacyId = null) {
  const id = entry?.scenarioId;
  if (id != null && id !== '') return id;
  return legacyId ?? UNTAGGED;
}

// The entries of one scenario (all of them for a null or empty id), in stored order.
export function filterByScenario(log, id, legacyId = null) {
  const list = Array.isArray(log) ? log.filter(Boolean) : [];
  if (id == null || id === '') return list;
  return list.filter((e) => scenarioOf(e, legacyId) === id);
}

// The log without one scenario's entries (what "Clear these flights" saves). Anything that isn't
// a matching entry is kept as it was.
export function removeScenario(log, id, legacyId = null) {
  const list = Array.isArray(log) ? log : [];
  if (id == null || id === '') return list.slice();
  return list.filter((e) => !(e && scenarioOf(e, legacyId) === id));
}

// The filter's choices after "All scenarios": every live scenario in the order given, then the
// deleted ones found only in entries, newest first, each named by the newest scenarioName its
// entries carry ("Scenario 1" for untagged flights). → [{ id, name, count, deleted }]
// `deleted` is only set when a scenarios list was given (open() with no args knows no names).
export function scenarioOptions(log, scenarios, legacyId = null) {
  const known = Array.isArray(scenarios);
  const out = [];
  const byId = new Map();
  for (const s of known ? scenarios : []) {
    if (!s || s.id == null || byId.has(s.id)) continue;
    const o = { id: s.id, name: String(s.name || LEGACY_NAME), count: 0, deleted: false };
    byId.set(s.id, o);
    out.push(o);
  }
  const newest = newestFirst(log).map((x) => x.e).filter(Boolean);
  // The names entries carry, newest first wins.
  const carried = new Map();
  for (const e of newest) {
    if (e.scenarioId != null && e.scenarioId !== '' && e.scenarioName && !carried.has(e.scenarioId)) carried.set(e.scenarioId, String(e.scenarioName));
  }
  for (const e of newest) {
    const id = scenarioOf(e, legacyId);
    let o = byId.get(id);
    if (!o) {
      const legacy = id === UNTAGGED || id === legacyId;
      o = { id, name: carried.get(id) || (legacy ? LEGACY_NAME : 'Deleted scenario'), count: 0, deleted: known && id !== UNTAGGED && id !== 'unsaved' };   // 'unsaved': flights flown without a scenario (main.js)
      byId.set(id, o);
      out.push(o);
    }
    o.count++;
  }
  return out;
}

// v0.4.0: the wind at touchdown, with its crosswind and head or tailwind parts. A flight from before v0.4.0, or a calm one: —.
function windCell(w) {
  if (!w || !(w.kt >= 1)) return '—';
  const dir = String(Math.round(w.fromDeg) % 360 || 360).padStart(3, '0');
  const bits = [];
  if (w.cross >= 1) bits.push(`${Math.round(w.cross)} kt X-wind ${esc(w.side || '')}`.trim());
  if (Math.abs(w.head) >= 1) bits.push(`${Math.round(Math.abs(w.head))} kt ${w.head > 0 ? 'head' : 'tail'}`);
  const gust = Math.round(w.gustKt || 0) > Math.round(w.kt) ? `G${Math.round(w.gustKt)}` : '';
  return `${dir}°/${Math.round(w.kt)}${gust} kt${bits.length ? `<small>${bits.join(' · ')}</small>` : ''}`;
}

export function createLogbook(root, { load, save, onclose } = {}) {
  const el = document.createElement('div');
  el.className = 'fslb';
  el.hidden = true;
  el.tabIndex = -1;
  el.innerHTML = `
    <div class="fslb-dlg" role="dialog" aria-label="Logbook">
      <div class="fslb-bar">
        <h2 data-o="title">Logbook</h2>
        <label class="fslb-filter" hidden><span>Scenario</span><select data-o="filter" aria-label="Show flights from"></select></label>
        <button class="fsui-b" data-k="clear">Clear logbook</button>
        <button class="fsui-b primary" data-k="close">Close</button>
      </div>
      <div class="fslb-confirm" hidden>
        <span data-o="confirmText"></span>
        <button class="fsui-b" data-k="cancel">Cancel</button>
        <button class="fsui-b danger" data-k="really">Clear</button>
      </div>
      <div class="fslb-totals" data-o="totals"></div>
      <div class="fslb-list" data-o="list"></div>
      <div class="fslb-help">Click a flight for its landing score. Esc closes.</div>
    </div>`;
  root.appendChild(el);
  const $ = (k) => el.querySelector(`[data-o="${k}"]`);
  const confirmEl = el.querySelector('.fslb-confirm');
  const filterEl = el.querySelector('.fslb-filter');
  const clearBtn = el.querySelector('[data-k="clear"]');
  const reallyBtn = el.querySelector('[data-k="really"]');
  let log = [];
  let openIdx = null; // the stored index of the expanded row
  let legacyId = null;
  let scoped = false; // opened for one scenario (the pause menu): no filter, no names on rows
  let options = []; // scenarioOptions()
  let sel = null; // the scenario id shown, or null for all
  let lastScenarios; // the scenarios given to open(), or undefined

  // Pointer and wheel events stay in the panel (the camera listens on the page).
  for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel']) {
    el.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
  }
  el.addEventListener('click', (e) => { if (e.target === el) close(); }); // the backdrop

  const nameOf = (id) => options.find((o) => o.id === id)?.name ?? LEGACY_NAME;
  const shownRows = () => newestFirst(log).filter(({ e }) => e && (sel == null || scenarioOf(e, legacyId) === sel));

  function renderTotals() {
    const t = totals(filterByScenario(log, sel, legacyId));
    const best = t.best;
    const bestHtml = best
      ? `${badgeHtml(best.score)}<small>${esc(best.route || '')} · ${esc(fmtDate(best.date).day)}</small>`
      : '<b>—</b>';
    $('totals').innerHTML = `
      <div><small>Flights</small><b>${t.flights}</b></div>
      <div><small>Hours</small><b>${fmtDuration(t.airS)}</b></div>
      <div><small>Average points</small><b>${t.avgPoints ?? '—'}</b></div>
      <div class="best"><small>Best landing</small>${bestHtml}</div>`;
  }

  function detailHtml(e) {
    const s = e.score;
    if (!s || !s.parts) return '<div class="fslb-detail"><p class="fslb-none">No landing score for this flight.</p></div>';
    return `<div class="fslb-detail"><div class="fslb-verdict" style="color:${gradeColor(s.grade)}">${esc(verdict(s))}</div>${partsHtml(s.parts)}</div>`;
  }

  function renderList() {
    const rows = shownRows();
    if (!rows.length) {
      $('list').innerHTML = `<div class="fslb-empty">${log.length && sel != null
        ? 'No flights in this scenario yet.' : 'No flights yet. Land somewhere and it will be written here.'}</div>`;
      return;
    }
    // The scenario's name on each row while all are shown (not for a bare open(), as in v0.1.x).
    const names = !scoped && sel == null && lastScenarios !== undefined;
    const html = rows.map(({ e, i }) => {
      const d = fmtDate(e.date);
      const rwys = [e.depRunway, e.arrRunway].map((r) => (r ? esc(r) : '—')).join(' → ');
      const on = i === openIdx;
      return `<div class="fslb-row${on ? ' on' : ''}" data-i="${i}">
          <span class="date">${esc(d.day)}<small>${esc(d.time)}</small></span>
          <span class="route">${esc(e.route || '—')}${names ? `<small class="sc">${esc(nameOf(scenarioOf(e, legacyId)))}</small>` : ''}</span>
          <span class="type">${esc(typeName(e.type))}${e.indestructible ? '<small>Indestructible</small>' : ''}</span>
          <span class="rwy">${rwys}${e.gate ? `<small>Gate ${esc(e.gate)}</small>` : ''}</span>
          <span class="num">${fmtDuration(e.airTimeS)}</span>
          <span class="num">${fmtKg(e.fuelUsedKg)}</span>
          <span class="num">${windCell(e.wind)}</span>
          <span class="grade">${badgeHtml(e.score)}</span>
        </div>${on ? detailHtml(e) : ''}`;
    }).join('');
    $('list').innerHTML = `<div class="fslb-row head"><span>Date</span><span>Route${names ? ' · Scenario' : ''}</span><span>Aircraft</span><span>Runways</span>`
      + `<span class="num">Air time</span><span class="num">Fuel used</span><span class="num">Wind at landing</span><span class="grade">Landing</span></div>${html}`;
  }

  function renderBar() {
    $('title').textContent = scoped ? `Logbook · ${nameOf(sel)}` : 'Logbook';
    clearBtn.textContent = sel == null ? 'Clear logbook' : 'Clear these flights';
    clearBtn.disabled = !filterByScenario(log, sel, legacyId).length;
  }

  function render() { renderBar(); renderTotals(); renderList(); }

  function fillFilter() {
    // Values are indices into `options` (ids may not be strings); '' is all.
    const opt = (v, text) => `<option value="${v}">${esc(text)}</option>`;
    $('filter').innerHTML = opt('', `All scenarios (${log.filter(Boolean).length})`)
      + options.map((o, k) => opt(k, `${o.name}${o.deleted ? ' (deleted)' : ''} (${o.count})`)).join('');
    $('filter').value = sel == null ? '' : String(options.findIndex((o) => o.id === sel));
  }

  $('filter').addEventListener('change', () => {
    const v = $('filter').value;
    sel = v === '' ? null : options[Number(v)]?.id ?? null;
    openIdx = null;
    confirmEl.hidden = true;
    render();
    $('list').scrollTop = 0;
  });

  $('list').addEventListener('click', (ev) => {
    const row = ev.target.closest('.fslb-row[data-i]');
    if (!row) return;
    const i = Number(row.dataset.i);
    openIdx = openIdx === i ? null : i;
    renderList();
  });

  el.querySelector('[data-k="close"]').onclick = () => close();
  clearBtn.onclick = () => {
    const n = filterByScenario(log, sel, legacyId).length;
    if (!n) return;
    const fl = `${n} flight${n === 1 ? '' : 's'}`;
    $('confirmText').textContent = sel == null
      ? `Clear all ${fl} from the logbook? This can't be undone.`
      : `Clear the ${fl} of “${nameOf(sel)}”? Other scenarios' flights stay. This can't be undone.`;
    reallyBtn.textContent = sel == null ? 'Clear' : `Clear ${fl}`;
    confirmEl.hidden = false;
  };
  el.querySelector('[data-k="cancel"]').onclick = () => { confirmEl.hidden = true; };
  reallyBtn.onclick = () => {
    // Re-read the stored log, so a flight written since the panel opened isn't lost.
    let cur = load ? load('logbook', []) : log;
    if (!Array.isArray(cur)) cur = log;
    const next = sel == null ? [] : removeScenario(cur, sel, legacyId);
    if (save?.('logbook', next) === false) {
      $('confirmText').textContent = "Couldn't save the logbook, so nothing was cleared.";
      return;
    }
    log = next;
    options = scenarioOptions(log, lastScenarios, legacyId);
    if (!scoped) fillFilter();
    openIdx = null;
    confirmEl.hidden = true;
    render();
  };

  // While open, keys stay out of the game; Esc closes (the confirm first, if it's up).
  // Captured on window, so it runs before the game's own window listener; the filter's own
  // keys (arrows, letters) still work, since only propagation is stopped.
  function onKey(e) {
    if (el.hidden) return;
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!confirmEl.hidden) confirmEl.hidden = true; else close();
    }
  }

  // opts: { scenarioId?, scenarios?: [{ id, name }], legacyId? } (all optional; see the header).
  function open(opts = {}) {
    if (!el.hidden) return;
    const o = opts || {};
    log = (load ? load('logbook', []) : []) || [];
    if (!Array.isArray(log)) log = [];
    legacyId = o.legacyId == null || o.legacyId === '' ? null : o.legacyId;
    lastScenarios = Array.isArray(o.scenarios) ? o.scenarios : undefined;
    scoped = o.scenarioId != null && o.scenarioId !== '';
    sel = scoped ? o.scenarioId : null;
    options = scenarioOptions(log, lastScenarios, legacyId);
    // The filter shows only when there's something to choose between.
    filterEl.hidden = scoped || !options.length;
    if (!scoped) fillFilter();
    openIdx = null;
    confirmEl.hidden = true;
    render();
    el.hidden = false;
    $('list').scrollTop = 0;
    window.addEventListener('keydown', onKey, true);
    el.focus({ preventScroll: true });
  }

  function close() {
    if (el.hidden) return;
    window.removeEventListener('keydown', onKey, true);
    if (el.contains(document.activeElement)) document.activeElement.blur(); // give the keys back to the game
    el.hidden = true;
    onclose?.();
  }

  return { open, close, get isOpen() { return !el.hidden; } };
}
