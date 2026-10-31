// The logbook: a full-window panel, opened from the pause menu, listing the flights saved
// under gamedump:flight-sim:logbook (newest first). Totals at the top, one row per flight,
// a click on a row opens that landing's score breakdown, and "Clear logbook" asks first
// inside the panel. Esc or Close closes it.
//
//   const logbook = createLogbook(root, { load, save, onclose });
//   logbook.open(); logbook.close(); logbook.isOpen
//
// A log entry (main.js → showScore): { date (ISO), route 'RKSS–RKPC', depRunway, arrRunway,
//   gate, airTimeS, fuelUsedKg, score: { points, grade, parts } }. Any field may be missing.
// The pure helpers are exported for the node tests.

import { esc, gradeColor, partsHtml, verdict } from './score-panel.js';

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

export function createLogbook(root, { load, save, onclose } = {}) {
  const el = document.createElement('div');
  el.className = 'fslb';
  el.hidden = true;
  el.tabIndex = -1;
  el.innerHTML = `
    <div class="fslb-dlg" role="dialog" aria-label="Logbook">
      <div class="fslb-bar">
        <h2>Logbook</h2>
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
  let log = [];
  let openIdx = null; // the stored index of the expanded row

  // Pointer and wheel events stay in the panel (the camera listens on the page).
  for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel']) {
    el.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
  }
  el.addEventListener('click', (e) => { if (e.target === el) close(); }); // the backdrop

  function renderTotals() {
    const t = totals(log);
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
    if (!log.length) {
      $('list').innerHTML = '<div class="fslb-empty">No flights yet. Land somewhere and it will be written here.</div>';
      return;
    }
    const rows = newestFirst(log).map(({ e, i }) => {
      const d = fmtDate(e.date);
      const rwys = [e.depRunway, e.arrRunway].map((r) => (r ? esc(r) : '—')).join(' → ');
      const on = i === openIdx;
      return `<div class="fslb-row${on ? ' on' : ''}" data-i="${i}">
          <span class="date">${esc(d.day)}<small>${esc(d.time)}</small></span>
          <span class="route">${esc(e.route || '—')}</span>
          <span class="rwy">${rwys}${e.gate ? `<small>Gate ${esc(e.gate)}</small>` : ''}</span>
          <span class="num">${fmtDuration(e.airTimeS)}</span>
          <span class="num">${fmtKg(e.fuelUsedKg)}</span>
          <span class="grade">${badgeHtml(e.score)}</span>
        </div>${on ? detailHtml(e) : ''}`;
    }).join('');
    $('list').innerHTML = `<div class="fslb-row head"><span>Date</span><span>Route</span><span>Runways</span>`
      + `<span class="num">Air time</span><span class="num">Fuel used</span><span class="grade">Landing</span></div>${rows}`;
  }

  function render() { renderTotals(); renderList(); }

  $('list').addEventListener('click', (ev) => {
    const row = ev.target.closest('.fslb-row[data-i]');
    if (!row) return;
    const i = Number(row.dataset.i);
    openIdx = openIdx === i ? null : i;
    renderList();
  });

  el.querySelector('[data-k="close"]').onclick = () => close();
  el.querySelector('[data-k="clear"]').onclick = () => {
    if (!log.length) return;
    $('confirmText').textContent = `Clear all ${log.length} flight${log.length === 1 ? '' : 's'} from the logbook? This can't be undone.`;
    confirmEl.hidden = false;
  };
  el.querySelector('[data-k="cancel"]').onclick = () => { confirmEl.hidden = true; };
  el.querySelector('[data-k="really"]').onclick = () => {
    log = [];
    save?.('logbook', []);
    openIdx = null;
    confirmEl.hidden = true;
    render();
  };

  // While open, keys stay out of the game; Esc closes (the confirm first, if it's up).
  // Captured on window, so it runs before the game's own window listener.
  function onKey(e) {
    if (el.hidden) return;
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!confirmEl.hidden) confirmEl.hidden = true; else close();
    }
  }

  function open() {
    if (!el.hidden) return;
    log = (load ? load('logbook', []) : []) || [];
    if (!Array.isArray(log)) log = [];
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
