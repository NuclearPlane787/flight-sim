// The main menu (shown on load), its Load scenario page, and the Settings and Controls pages
// (usable over the main menu and over the pause menu). Styles in menu.css (fsm-*); buttons
// reuse ui.css's .fsui-b. Modelled on Satisfactory's title screen: the title and version on
// the left, the buttons on the right, a gradient over a still picked at random per visit.
//
//   const menu = createMenu(root, { version, backdrops, scenarios, onContinue(id), onNew(), onLoad(id),
//                                   onLogbook(), onSettings(), onControls(), onExit? });
//   menu.show(); menu.hide(); menu.refresh(); menu.isOpen
//   const settings = createSettingsPage(root, { get, onVolume, onCallouts, onPerf, onSky? });
//   const controls = createControlsPage(root, { sky? });   controls.setFamily(def.family) for the type flown
//   page.open(); page.close(); page.isOpen; page.onclose = () => {}
//
// `scenarios` is the ScenarioStore (list, rename, remove). Nothing renders behind the menu:
// it's plain DOM over a still.

import { cleanName, nameOk, NAME_MIN, NAME_MAX, savedText, typeName } from '../scenarios.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// One of the stills, a different one per visit (Satisfactory's pickBackdrop()).
export function pickBackdrop(list) {
  return list && list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

// Pointer and wheel events stay in a panel (the camera listens on the page).
function keepPointer(el) {
  for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel']) {
    el.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
  }
}

// Arrow up/down moves the focus through a list of elements.
function arrowNav(e, items) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return false;
  const list = items.filter((b) => !b.hidden && b.offsetParent !== null);
  if (!list.length) return false;
  const i = list.indexOf(document.activeElement);
  const n = e.key === 'ArrowDown' ? (i < 0 ? 0 : (i + 1) % list.length) : (i <= 0 ? list.length - 1 : i - 1);
  list[n].focus();
  e.preventDefault();
  return true;
}

export function createMenu(root, { version = '', backdrops = [], scenarios, onContinue, onNew, onLoad, onLogbook, onSettings, onControls, onExit } = {}) {
  const el = document.createElement('div');
  el.className = 'fsm';
  el.hidden = true;
  el.tabIndex = -1;
  el.innerHTML = `
    <div class="fsm-left">
      <p class="fsm-eyebrow">Game Dump presents</p>
      <h1 class="fsm-title">Flight Sim</h1>
      <p class="fsm-sub">Airliners over South Korea</p>
    </div>
    <div class="fsm-right">
      <nav class="fsm-nav" data-o="nav" aria-label="Main menu">
        <button class="primary" data-k="continue" hidden>Continue<small data-o="contSub"></small></button>
        <button data-k="new">New scenario</button>
        <button data-k="load">Load scenario</button>
        <button data-k="logbook">Logbook</button>
        <button data-k="settings">Settings</button>
        <button data-k="controls">Controls</button>
        <a href="../../index.html" target="_top" data-k="exit">Exit to Game Dump</a>
      </nav>
      <section class="fsm-load" data-o="load" hidden aria-label="Load scenario">
        <div class="fsm-load-bar"><h2>Load scenario</h2><button class="fsui-b" data-k="back">Back</button></div>
        <div class="fsm-list" data-o="list"></div>
        <p class="fsm-help">Click a scenario or press Enter to fly it. Esc goes back.</p>
      </section>
    </div>
    <p class="fsm-version" data-o="version"></p>`;
  root.appendChild(el);
  const $ = (k) => el.querySelector(`[data-o="${k}"]`);
  const btn = (k) => el.querySelector(`[data-k="${k}"]`);
  const navItems = () => [...$('nav').children];
  let page = 'main';
  let editing = null;   // the id being renamed
  let confirming = null; // the id asking to be deleted
  let renameMsg = '';

  $('version').textContent = version;
  keepPointer(el);

  function setBackdrop() {
    const bg = pickBackdrop(backdrops);
    // Made absolute against the page: a relative url() in a custom property would resolve
    // against menu.css (src/ui/) instead.
    if (bg) el.style.setProperty('--backdrop', `url("${new URL(bg, document.baseURI).href}")`); else el.style.removeProperty('--backdrop');
  }

  // ---- The main page ----
  function renderMain() {
    const top = scenarios?.newest?.() || scenarios?.list?.()[0] || null;
    const c = btn('continue');
    c.hidden = !top;
    c.dataset.id = top?.id || '';
    $('contSub').textContent = top ? [top.name, top.summary?.where].filter(Boolean).join(' · ') : '';
    // With nothing to continue, New scenario is the primary button.
    btn('new').classList.toggle('primary', !top);
  }

  // ---- Load scenario ----
  function rowHtml(e) {
    const s = e.summary || {};
    const id = esc(e.id);
    let main;
    if (editing === e.id) {
      main = `<div class="fsm-rename">
          <input type="text" class="fsm-input" data-r="name" maxlength="${NAME_MAX + 10}" value="${esc(e.name)}" aria-label="Scenario name" spellcheck="false" autocomplete="off">
          <button class="fsui-b primary" data-r="save">Save</button><button class="fsui-b" data-r="cancel">Cancel</button>
          <span class="fsm-err" data-o="renameMsg">${esc(renameMsg)}</span>
        </div>`;
    } else {
      main = `<div class="fsm-row-main">
          <b>${esc(e.name)}</b>
          <small>${esc(typeName(e.type))} · ${esc(s.route || '—')}${s.where ? ` · ${esc(s.where)}` : ''}</small>
        </div>
        <span class="fsm-when">${esc(savedText(e.savedAt))}</span>`;
    }
    const act = confirming === e.id
      ? `<div class="fsm-confirm"><span>Delete “${esc(e.name)}”? Its flights stay in the logbook.</span>
          <button class="fsui-b" data-r="no">Cancel</button><button class="fsui-b danger" data-r="yes">Delete</button></div>`
      : editing === e.id ? ''
      : `<div class="fsm-row-act"><button class="fsui-b primary" data-r="load">Load</button><button class="fsui-b" data-r="rename">Rename</button><button class="fsui-b" data-r="delete">Delete</button></div>`;
    return `<div class="fsm-row${confirming === e.id ? ' asking' : ''}" data-id="${id}" tabindex="0">${main}${act}</div>`;
  }

  function renderLoad(focusId) {
    const list = scenarios?.list?.() || [];
    $('list').innerHTML = list.length ? list.map(rowHtml).join('')
      : '<div class="fsm-empty">No scenarios yet. Start one with New scenario.</div>';
    if (editing) {
      const inp = $('list').querySelector('[data-r="name"]');
      if (inp) { inp.focus(); if (!renameMsg) inp.select(); }
    } else if (confirming) {
      $('list').querySelector(`.fsm-row[data-id="${CSS.escape(confirming)}"] [data-r="no"]`)?.focus();
    } else if (focusId !== undefined) {
      const row = focusId && $('list').querySelector(`.fsm-row[data-id="${CSS.escape(focusId)}"]`);
      (row || $('list').querySelector('.fsm-row') || btn('back')).focus({ preventScroll: !row });
    }
  }

  function showPage(p) {
    page = p;
    editing = confirming = null; renameMsg = '';
    $('nav').hidden = p !== 'main';
    $('load').hidden = p !== 'load';
    el.classList.toggle('on-load', p === 'load');
    if (p === 'load') { renderLoad(null); $('list').scrollTop = 0; }
    else { renderMain(); (btn('continue').hidden ? btn('new') : btn('continue')).focus(); }
  }

  function commitRename(id) {
    const inp = $('list').querySelector('[data-r="name"]');
    const name = inp ? inp.value : '';
    if (!nameOk(name)) { renameMsg = `A name needs ${NAME_MIN}–${NAME_MAX} characters.`; showRenameMsg(); return; }
    const r = scenarios?.rename?.(id, cleanName(name)) || { ok: false };
    if (!r.ok) {
      renameMsg = r.error === 'quota' ? 'Browser storage is full: the name was not saved.' : r.error === 'name' ? `A name needs ${NAME_MIN}–${NAME_MAX} characters.` : 'That scenario is gone.';
      showRenameMsg(); return;
    }
    editing = null; renameMsg = '';
    renderLoad(id);
  }
  function showRenameMsg() { const m = $('renameMsg'); if (m) m.textContent = renameMsg; }

  $('list').addEventListener('click', (ev) => {
    const row = ev.target.closest('.fsm-row[data-id]');
    if (!row) return;
    const id = row.dataset.id;
    const r = ev.target.closest('[data-r]')?.dataset.r;
    if (r === 'name') return; // a click in the text field
    if (r === 'rename') { editing = id; confirming = null; renameMsg = ''; renderLoad(); return; }
    if (r === 'save') { commitRename(id); return; }
    if (r === 'cancel') { editing = null; renameMsg = ''; renderLoad(id); return; }
    if (r === 'delete') { confirming = id; editing = null; renderLoad(); return; }
    if (r === 'no') { confirming = null; renderLoad(id); return; }
    if (r === 'yes') {
      const list = scenarios?.list?.() || [];
      const i = list.findIndex((e) => e.id === id);
      scenarios?.remove?.(id);
      confirming = null;
      const next = scenarios?.list?.() || [];
      renderLoad(next[Math.min(i, next.length - 1)]?.id || null);
      return;
    }
    if (editing === id || confirming === id) return;
    onLoad?.(id); // a click on the row, or its Load button
  });
  $('list').addEventListener('input', (ev) => {
    if (ev.target.dataset.r === 'name' && renameMsg) { renameMsg = ''; showRenameMsg(); }
  });

  // ---- The buttons ----
  btn('continue').onclick = () => { const id = btn('continue').dataset.id; if (id) onContinue?.(id); };
  btn('new').onclick = () => onNew?.();
  btn('load').onclick = () => showPage('load');
  btn('logbook').onclick = () => onLogbook?.();
  btn('settings').onclick = () => onSettings?.();
  btn('controls').onclick = () => onControls?.();
  btn('back').onclick = () => showPage('main');
  if (onExit) btn('exit').addEventListener('click', (e) => { if (onExit() === false) e.preventDefault(); });

  // ---- Keys: none reach the game while the menu is up ----
  el.addEventListener('keyup', (e) => e.stopPropagation());
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (page === 'main') { arrowNav(e, navItems()); return; }
    // Load scenario
    const row = e.target.closest?.('.fsm-row[data-id]');
    if (e.target.dataset?.r === 'name') {
      if (e.key === 'Enter') { e.preventDefault(); commitRename(row.dataset.id); }
      else if (e.key === 'Escape') { e.preventDefault(); const id = editing; editing = null; renameMsg = ''; renderLoad(id); }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (confirming) { const id = confirming; confirming = null; renderLoad(id); }
      else showPage('main');
      return;
    }
    if (e.target === row && !confirming) {
      if (e.key === 'Enter') { e.preventDefault(); onLoad?.(row.dataset.id); return; }
      if (e.key === 'F2') { e.preventDefault(); editing = row.dataset.id; renderLoad(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); confirming = row.dataset.id; renderLoad(); return; }
    }
    if (e.target.closest?.('.fsm-row') || e.target === btn('back')) arrowNav(e, [...$('list').querySelectorAll('.fsm-row')]);
  });
  // A key typed with the focus on the page itself (after a click on nothing) stays here too.
  function onWindowKey(e) {
    if (el.hidden || (e.target !== document.body && e.target !== document.documentElement)) return;
    e.stopPropagation();
    if (e.key === 'Escape' && page === 'load') { e.preventDefault(); showPage('main'); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') { e.preventDefault(); showPage(page); }
  }

  function show() {
    setBackdrop();
    const was = el.hidden;
    el.hidden = false;
    if (was) window.addEventListener('keydown', onWindowKey, true);
    showPage('main');
  }
  function hide() {
    if (el.hidden) return;
    window.removeEventListener('keydown', onWindowKey, true);
    if (el.contains(document.activeElement)) document.activeElement.blur();
    el.hidden = true;
  }
  // The list changed elsewhere (a save, a rename): redraw what's showing, keeping the page.
  function refresh() {
    if (page === 'load') renderLoad(); else renderMain();
  }

  return { show, hide, refresh, get isOpen() { return !el.hidden; }, get page() { return page; }, showPage };
}

// ---- Settings and Controls: a centred card over whatever is showing ----

function createPage(root, cls, title, bodyHtml) {
  const el = document.createElement('div');
  el.className = `fsm-page ${cls}`;
  el.hidden = true;
  el.tabIndex = -1;
  el.innerHTML = `
    <div class="fsm-card" role="dialog" aria-label="${esc(title)}">
      <div class="fsm-card-bar"><h2>${esc(title)}</h2><button class="fsui-b primary" data-k="close">Close</button></div>
      ${bodyHtml}
      <p class="fsm-help">Esc closes.</p>
    </div>`;
  root.appendChild(el);
  keepPointer(el);
  let returnTo = null;
  const api = {
    el,
    onclose: null,
    open() {
      if (!el.hidden) return;
      returnTo = document.activeElement;
      api.render?.();
      el.hidden = false;
      el.focus({ preventScroll: true });
    },
    close() {
      if (el.hidden) return;
      if (el.contains(document.activeElement)) document.activeElement.blur(); // the keys go back
      el.hidden = true;
      // Back to the button that opened it (a menu button), if it's still there.
      if (returnTo && returnTo !== document.body && returnTo.isConnected && returnTo.offsetParent !== null) returnTo.focus({ preventScroll: true });
      returnTo = null;
      api.onclose?.();
    },
    get isOpen() { return !el.hidden; },
  };
  el.querySelector('[data-k="close"]').onclick = () => api.close();
  el.addEventListener('click', (e) => { if (e.target === el) api.close(); }); // the backdrop
  // Keys typed here never reach the game (nor the menu under it); Esc closes.
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); api.close(); }
  });
  el.addEventListener('keyup', (e) => e.stopPropagation());
  return api;
}

export function createSettingsPage(root, { get, onVolume, onCallouts, onPerf, onSky } = {}) {
  const seg = (k) => `<div class="fsui-seg" data-seg="${k}"><button data-v="on">On</button><button data-v="off">Off</button></div>`;
  const page = createPage(root, 'fsm-settings', 'Settings', `
    <div class="fsm-set">
      <label class="fsm-set-row"><span class="lab">Master volume</span>
        <span class="ctl"><input type="range" min="0" max="100" step="5" data-s="volume"><output data-s="volOut">100%</output></span></label>
      <div class="fsm-set-row"><span class="lab">Callouts<small>The radio-altitude calls on final, “retard” and the ground-proximity warnings</small></span><span class="ctl">${seg('callouts')}</span></div>
      <div class="fsm-set-row"><span class="lab">Performance readout<small>Frame rate, triangles and draw calls along the top (F3 or \`)</small></span><span class="ctl">${seg('perf')}</span></div>
      ${onSky ? `<div class="fsm-set-row"><span class="lab">Time of day<small>The clock, the date and the sun and Moon</small></span><span class="ctl"><button class="fsui-b" data-s="sky">Open the Sky window (L)</button></span></div>` : ''}
    </div>`);
  const el = page.el;
  const q = (k) => el.querySelector(`[data-s="${k}"]`);
  const setSeg = (k, on) => { for (const b of el.querySelectorAll(`[data-seg="${k}"] button`)) b.classList.toggle('on', (b.dataset.v === 'on') === !!on); };
  const showVol = (v) => { q('volume').value = Math.round(v * 100); q('volOut').textContent = `${Math.round(v * 100)}%`; };

  page.render = () => {
    const s = get?.() || {};
    showVol(Number.isFinite(s.volume) ? s.volume : 1);
    setSeg('callouts', s.callouts !== false);
    setSeg('perf', !!s.showPerf);
  };
  q('volume').addEventListener('input', () => { const v = Number(q('volume').value) / 100; showVol(v); onVolume?.(v); });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-seg] button');
    if (b) {
      const k = b.closest('[data-seg]').dataset.seg, on = b.dataset.v === 'on';
      setSeg(k, on);
      if (k === 'callouts') onCallouts?.(on); else onPerf?.(on);
      return;
    }
    // The Sky window stands aside over the flight, so Settings closes first.
    if (e.target.closest('[data-s="sky"]')) { page.close(); onSky?.(); }
  });
  return page;
}

// The keys table (from v0.1.4's pause menu), then the FCU and map notes.
const KEYS = [
  ['W / S', 'pitch down / up', 'R / F', 'thrust levers (hold F at idle on the ground: reverse)'],
  ['A / D', 'roll left / right', 'Space', 'wheel brakes (hold)'],
  ['Q / E', 'yaw / steer', 'B', 'parking brake'],
  ['6 7 8 9 0', 'flaps 0, 1, 2, 3, FULL', 'G', 'gear'],
  ['C / Shift+C', 'speed brakes / arm ground spoilers', 'Z / X', 'autopilot / autothrust'],
  ['= / −', 'time compression', 'M', 'map, jumps, skip to final'],
  ['1 2 3', 'cockpit, nose, 3rd person', 'F3 or `', 'performance readout'],
  ['drag / pinch', 'look or orbit / zoom', 'double-click', 'recentre'],
  ['T', 'rewind 30 s (paused or crashed)', 'P', 'pushback (= speeds it up)'],
  ['FCU window', 'scroll it, or click, type, Enter', 'map', 'click the bright path (AP on) to jump'],
  ['V', 'next view', 'Esc', 'pause menu'],
];

// Keys only one family of aircraft has (types.js `family`), in the same four cells as KEYS, under its own
// heading after the common table, with its own notes. `replace` rewords the common table's cells that
// differ, and `hideNote` drops a note that doesn't apply. The page shows a family's once main.js says
// which family is being flown (setFamily), so the A321's page stays as it has always been.
export const FAMILY_KEYS = [
  { family: 'boeing', title: 'Boeing 787 and 777', rows: [
    ['Y', 'trim nose down', 'H', 'trim nose up'],
    ['[ / ]', 'flaps one step up / down', 'O', 'TO/GA'],
  ], replace: {
    'flaps 0, 1, 2, 3, FULL': 'flaps UP, 5, 15, 20, 30',
    'autopilot / autothrust': 'autopilot / A/T arm',
    'FCU window': 'MCP window',
  }, hideNote: 'fcu', notes: `<p>The trim sets the speed the aircraft holds: let go of the controls and it settles back to the green TRIM mark on the speed tape.
    With the A/P on, it trims itself.</p>
    <p><b>The MCP</b> along the top sets the speed, HDG, ALT and V/S. Scroll over a window to turn it (a quick flick turns it in big steps), or click it, type a value and press Enter.
    Enter on HDG goes to HDG SEL, on ALT to FLCH, on V/S to V/S. An ALT under 1,000 is a flight level (350 = FL350); a V/S of 60 or less is in hundreds (−15 = −1,500 ft/min).
    Above FL260 the speed window is in Mach, and a typed 84 or .84 is a Mach at any height. Its buttons light green when active and white when armed.
    Esc, a click elsewhere or a flying key closes a window unchanged.</p>` },
];

const keyRows = (rows) => rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');

export function createControlsPage(root, { sky = false } = {}) {
  const rows = keyRows(KEYS)
    + (sky ? `<tr><td>L or Cmd/Ctrl+L</td><td colspan="3">the Sky window (time of day)</td></tr>` : '');
  const page = createPage(root, 'fsm-controls', 'Controls', `
    <table class="keys fsm-keys">${rows}</table><div data-family-keys></div>
    <div class="fsm-notes">
      <p data-note="fcu"><b>The FCU</b> along the top sets SPD, HDG, ALT and V/S. Scroll over a window to turn it (a quick flick turns it in big steps),
        or click it, type a value and press Enter, which also pushes the knob: ALT starts a level change, V/S engages V/S.
        An ALT under 1,000 is a flight level (350 = FL350); a V/S of 60 or less is in hundreds (−15 = −1,500 ft/min).
        Esc, a click elsewhere or a flying key closes it unchanged.</p>
      <p><b>The map (M):</b> with the AP on, the bright line is where the aircraft will go: click a point on it to jump there.
        The magenta line is the route to your destination and doesn't jump, so point the HDG along it first.
        A red cross means the path meets the terrain. “Skip to 15 nm final” puts you on the 3° path to the destination runway.
        Drag the magenta line to add a waypoint. “Change route”, or a click on an airport, picks a new destination and runway;
        the line then goes direct from where you are.</p>
      <p><b>Views:</b> the switch at the top right (or 1, 2, 3) picks the cockpit (the captain's seat), the nose or the 3rd person view.
        V steps through all four, the first officer's seat too.
        Press and drag on the view (one finger) to look around, or in 3rd person to go round the aircraft; a two-finger swipe does the same.</p>
    </div>`);
  // The keys of the family being flown (a registry entry's `family`); any other is the common page.
  const cells = [...page.el.querySelectorAll('.fsm-keys td')].map((td) => [td, td.textContent]);
  page.setFamily = (family) => {
    const g = FAMILY_KEYS.find((f) => f.family === family);
    for (const [td, text] of cells) td.textContent = g?.replace?.[text] ?? text;
    page.el.querySelector('[data-family-keys]').innerHTML = g ? `
      <h3 class="fsm-keys-h" data-family="${esc(g.family)}">${esc(g.title)}</h3>
      <table class="keys fsm-keys">${keyRows(g.rows)}</table>${g.notes ? `<div class="fsm-notes">${g.notes}</div>` : ''}` : '';
    for (const n of page.el.querySelectorAll('[data-note]')) n.hidden = !!g && g.hideNote === n.dataset.note;
  };
  return page;
}
