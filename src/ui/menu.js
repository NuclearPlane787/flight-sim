// The main menu (shown on load), its Load scenario page, and the Settings and Controls pages
// (usable over the main menu and over the pause menu). Styles in menu.css (fsm-*); buttons
// reuse ui.css's .fsui-b. v0.5.7, the home page: the scene on the left (the title, the version and
// ui/home-scene.js's line art), the panel on the right (the saved-flight card, ui/home-card.js, and the rows);
// its styles in home.css.
//
//   const menu = createMenu(root, { version, scenarios, place?(icao), backdrop?, onContinue(id), onNew(), onLoad(id),
//                                   onLogbook(), onSettings(), onControls(), onExit?, onWarehouseClose? });
//   menu.show(); menu.hide(); menu.refresh(); menu.isOpen
//   menu.setBackdrop(name): 'night' | 'dusk' | 'blueprint' (the URL's ?backdrop= picks one too); menu.scene for checks
//   place(icao) → the airport's short name for the card ("Jeju"), or null (the card shows the code)
//   menu.openWarehouse() → Promise (v0.5.0: the Warehouse page, ui/warehouse.js, loaded on first use; the menu
//   opens and closes it itself, behind WAREHOUSE_ON or the URL's ?warehouse=1; onWarehouseClose() after it closes)
//   const settings = createSettingsPage(root, { get, onVolume, onCallouts, onPerf, onSky?, onIndestructible?, onAutoTrim?, onPanelScale?, keyName? });
//   const controls = createControlsPage(root, { sky?, keys? });   controls.setFamily(def.family) for the type flown
//     v0.5.7: keys: { load(), save(store) → ok }: the page edits every key but the warehouse's block (src/keys.js), with
//     the keyboard drawn over them (ui/keyboard-map.js: controls.board)
//   page.open(); page.close(); page.isOpen; page.onclose = () => {}
//
// `scenarios` is the ScenarioStore (list, rename, duplicate, remove). Nothing renders behind the
// menu: it's plain DOM and line art.

import { cleanName, nameOk, NAME_MIN, NAME_MAX, savedText, typeName } from '../scenarios.js';
import { onDesignRename, designName } from '../designs-store.js';   // v0.5.8: designName, the Load list's live names
import { createHomeScene, BACKDROPS, DEFAULT_BACKDROP } from './home-scene.js';   // v0.5.7: the home page
import { flightCard, placeText } from './home-card.js';
import { ICONS } from './line-art.js';
import { BINDINGS, SECTIONS, BLOCK_TEXT, keyLabel, chordFor, resolveKeys, bindKey, clearKeys, resetKeys, bindingOf, isModifier,
  movedText } from '../keys.js';
import { renderKeyboard, codesOf } from './keyboard-map.js';   // v0.5.7: the Controls page's keyboard

// v0.5.0: the Warehouse button, off until a design flies end to end. `?warehouse=1` in the page's URL shows it
// anyway (the tests and the dev checks).
export const WAREHOUSE_ON = true;
export function warehouseEnabled(search) {
  if (WAREHOUSE_ON) return true;
  try { return new URLSearchParams(search ?? globalThis.location?.search ?? '').get('warehouse') === '1'; } catch { return false; }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// v0.5.7: the home page's backdrop: the URL's ?backdrop=night|dusk|blueprint (to compare them), else the one given.
export function backdropFrom(search, given = DEFAULT_BACKDROP) {
  let q = null;
  try { q = new URLSearchParams(search ?? globalThis.location?.search ?? '').get('backdrop'); } catch { q = null; }
  return BACKDROPS.includes(q) ? q : BACKDROPS.includes(given) ? given : DEFAULT_BACKDROP;
}
// The panel's small line icons: the rows' chevron, the Resume button's arrow, the card's airliner.
const CHEVRON = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.2 2 8.2 6 4.2 10"/></svg>';
const ARROW = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 8h11M9 3.5 13.5 8 9 12.5"/></svg>';
const planeSide = () => `<svg class="fsh-card-plane" viewBox="0 0 ${ICONS.planeSide.w} ${ICONS.planeSide.h}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS.planeSide.paths.map((d) => `<path d="${d}" vector-effect="non-scaling-stroke"/>`).join('')}</svg>`;

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

export function createMenu(root, { version = '', scenarios, place = null, backdrop = DEFAULT_BACKDROP, onContinue, onNew, onLoad, onLogbook, onSettings, onControls, onExit, onWarehouseClose, onFlyDesign, keys = null } = {}) {
  const el = document.createElement('div');
  el.className = 'fsm';
  el.hidden = true;
  el.tabIndex = -1;
  // A row: its chevron, and the arrow it shows instead as the primary button (New scenario, with no saved flight).
  const row = (k, html, attrs = '') => `<button class="fsh-row" data-k="${k}"${attrs}><span>${html}</span>${CHEVRON.replace('<svg', '<svg class="chev"')}${ARROW.replace('<svg', '<svg class="arrow"')}</button>`;
  // v0.5.7: the scene (the title, the version, home-scene.js's art behind them), and the panel: the card for the
  // newest scenario (the whole card is Continue), the rows, Settings | Controls, Exit; Load scenario takes the panel.
  el.innerHTML = `
    <div class="fsm-left" data-o="scene">
      <div class="fsm-head" data-o="head">
        <p class="fsm-eyebrow">Game Dump presents</p>
        <h1 class="fsm-title">Flight Sim</h1>
      </div>
      <p class="fsm-version" data-o="version"></p>
    </div>
    <div class="fsm-right">
      <nav class="fsm-nav" data-o="nav" aria-label="Main menu">
        <button class="fsh-card" data-k="continue" hidden>
          <span class="fsh-card-top">
            <span class="fsh-kick"><span class="fsh-kicker" data-o="cardKicker">Saved flight</span>${planeSide()}</span>
            <span class="fsh-card-title" data-o="cardTitle"></span>
            <span class="fsh-card-sub" data-o="cardSub"></span>
            <span class="fsh-stats" data-o="cardStats"></span>
          </span>
          <span class="fsh-card-stub"><span class="fsh-go"><span data-o="cardAction">Resume flight</span>${ARROW}</span></span>
        </button>
        <div class="fsh-rows">
          ${row('new', 'New scenario')}
          ${row('load', 'Load scenario')}
          ${row('warehouse', 'Warehouse', ' hidden')}
          ${row('logbook', 'Logbook')}
        </div>
        <div class="fsh-pair"><button data-k="settings">Settings</button><span class="fsh-sep" aria-hidden="true"></span><button data-k="controls">Controls</button></div>
        <a class="fsh-exit" href="../../index.html" target="_top" data-k="exit">Exit to Game Dump</a>
      </nav>
      <section class="fsm-load" data-o="load" hidden aria-label="Load scenario">
        <div class="fsm-load-bar"><h2>Load scenario</h2><button class="fsui-b" data-k="back">Back</button></div>
        <p class="fsm-note" data-o="loadMsg" aria-live="polite"></p>
        <div class="fsm-list" data-o="list"></div>
        <p class="fsm-help">Click a scenario or press Enter to fly it. Duplicate copies one, so you can fly on from the same point again. Esc goes back.</p>
      </section>
    </div>`;
  root.appendChild(el);
  const $ = (k) => el.querySelector(`[data-o="${k}"]`);
  const btn = (k) => el.querySelector(`[data-k="${k}"]`);
  const navItems = () => [...$('nav').querySelectorAll('button, a')];
  let page = 'main';
  let editing = null;   // the id being renamed
  let confirming = null; // the id asking to be deleted
  let renameMsg = '';
  let loadMsg = '', loadMsgBad = false; // a Duplicate's result, over the list

  $('version').textContent = version;
  btn('warehouse').hidden = !warehouseEnabled();
  keepPointer(el);
  const scene = createHomeScene($('scene'), { head: $('head'), backdrop: backdropFrom(undefined, backdrop) });

  // v0.5.7: the scene moves only while the menu shows with nothing over it (Settings, Controls, the logbook, the
  // warehouse): what's on top of the scene says so, so any page shown over the whole window counts. Checked when the
  // menu changes page and, while it shows, whenever something outside it is shown or hidden (a MutationObserver: no
  // polling).
  function onTop() {
    const r = $('scene').getBoundingClientRect();
    if (!r.width || !r.height) return false;
    return [[0.5, 0.5], [0.2, 0.25], [0.8, 0.8]].some(([fx, fy]) => {
      const hit = document.elementFromPoint(r.left + fx * r.width, r.top + fy * r.height);
      return !hit || el.contains(hit);
    });
  }
  const syncScene = () => scene.setActive(!el.hidden && page !== 'warehouse' && onTop());
  const watcher = typeof MutationObserver === 'function'
    ? new MutationObserver((list) => { if (!el.hidden && list.some((m) => !el.contains(m.target))) syncScene(); }) : null;

  // ---- The main page ----
  function renderMain() {
    const top = scenarios?.newest?.() || scenarios?.list?.()[0] || null;
    const card = top ? flightCard(top, { place }) : null;
    const c = btn('continue');
    c.hidden = !card;
    c.dataset.id = card?.id || '';
    if (card) {
      $('cardKicker').textContent = card.kicker;
      $('cardTitle').textContent = card.title;
      $('cardTitle').title = card.title;
      $('cardSub').textContent = card.sub;
      $('cardStats').innerHTML = card.stats.map((s) => `<span class="fsh-stat"><b>${esc(s.value)}</b><small>${esc(s.label)}</small></span>`).join('');
      $('cardAction').textContent = card.action;
      c.setAttribute('aria-label', `${card.action}: ${card.title}, ${card.sub}${card.stats.length ? `, ${card.stats.map((s) => `${s.label} ${s.value}`).join(', ')}` : ''}`);
    }
    // With nothing to continue, New scenario is the primary button.
    btn('new').classList.toggle('primary', !card);
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
          <small>${s.design ? `${esc(designName(s.designId, s.design))} (${esc(typeName(e.type))})` : esc(typeName(e.type))} · ${esc(s.route || '—')}${s.where ? ` · ${esc(placeText(s.where, place))}` : ''}</small>
        </div>
        <span class="fsm-when">${esc(savedText(e.savedAt))}</span>`;
    }
    const act = confirming === e.id
      ? `<div class="fsm-confirm"><span>Delete “${esc(e.name)}”? Its flights stay in the logbook.</span>
          <button class="fsui-b" data-r="no">Cancel</button><button class="fsui-b danger" data-r="yes">Delete</button></div>`
      : editing === e.id ? ''
      : `<div class="fsm-row-act"><button class="fsui-b primary" data-r="load">Load</button><button class="fsui-b" data-r="rename">Rename</button><button class="fsui-b" data-r="duplicate" title="A copy with the same state: fly on from this point again">Duplicate</button><button class="fsui-b" data-r="delete">Delete</button></div>`;
    return `<div class="fsm-row${confirming === e.id ? ' asking' : ''}" data-id="${id}" tabindex="0">${main}${act}</div>`;
  }

  function renderLoad(focusId) {
    const m = $('loadMsg');
    m.textContent = loadMsg; m.classList.toggle('bad', loadMsgBad);
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
    editing = confirming = null; renameMsg = ''; loadMsg = ''; loadMsgBad = false;
    $('nav').hidden = p !== 'main';
    $('load').hidden = p !== 'load';
    el.classList.toggle('on-load', p === 'load');
    if (p === 'load') { renderLoad(null); $('list').scrollTop = 0; }
    else { renderMain(); (btn('continue').hidden ? btn('new') : btn('continue')).focus(); }
    syncScene();
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
    if (r && r !== 'duplicate') { loadMsg = ''; loadMsgBad = false; }
    if (r === 'duplicate') {
      const res = scenarios?.duplicate?.(id) || { ok: false, error: 'storage' };
      editing = confirming = null;
      loadMsgBad = !res.ok;
      loadMsg = res.ok ? `Copied as “${res.entry.name}”: at the top, ready to fly or rename.`
        : res.error === 'quota' ? 'Browser storage is full: no copy was made.'
        : res.error === 'missing' ? 'That scenario is gone.' : 'Browser storage is off: no copy was made.';
      renderLoad(res.ok ? res.id : id);
      if (res.ok) $('list').scrollTop = 0;
      return;
    }
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
  btn('warehouse').onclick = () => openWarehouse();
  btn('logbook').onclick = () => onLogbook?.();
  btn('settings').onclick = () => onSettings?.();
  btn('controls').onclick = () => onControls?.();
  btn('back').onclick = () => showPage('main');
  if (onExit) btn('exit').addEventListener('click', (e) => { if (onExit() === false) e.preventDefault(); });

  // ---- Keys: none reach the game while the menu is up ----
  el.addEventListener('keyup', (e) => e.stopPropagation());
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (page === 'warehouse') return;   // the Warehouse page keeps its own keys
    if (page === 'main') {
      // v0.5.7: Settings | Controls share a line: left and right go between them.
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target.closest?.('.fsh-pair')) {
        e.preventDefault(); btn(e.key === 'ArrowLeft' ? 'settings' : 'controls').focus(); return;
      }
      arrowNav(e, navItems()); return;
    }
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
    if (page === 'warehouse') { if (e.key === 'Escape') { e.preventDefault(); warehouse?.back(); } return; }
    if (e.key === 'Escape' && page === 'load') { e.preventDefault(); showPage('main'); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') { e.preventDefault(); showPage(page); }
  }

  // ---- The Warehouse (v0.5.0): a page of its own over the menu, loaded the first time ----
  let warehouse = null, warehouseLoad = null;
  // v0.5.4 (Shane: "When you rename a plane in the warehouse, it doesn't update it in the load scenario boxes"): a
  // design renamed there (its list's Rename, or the editor's name then Save) is renamed in the scenarios that fly
  // it, their Load scenario rows and their saved copies of it (scenarios.js's renameDesign); the logbook keeps its.
  // v0.5.8: the rows name it live (designName() by summary.designId), so this only keeps the stored names, which show
  // once the design is deleted, up to date.
  onDesignRename((id, name) => { if (scenarios?.renameDesign?.(id, name) && !el.hidden && page === 'load') renderLoad(null); });
  function openWarehouse() {
    if (!warehouseLoad) {
      warehouseLoad = import('./warehouse.js').then((m) => {
        warehouse = m.createWarehouse(root, keys ? { keys } : {});   // v0.5.6: the parts' keys are set there
        warehouse.onclose = () => {
          if (el.hidden) return;
          showPage('main');
          btn('warehouse').focus({ preventScroll: true });
          onWarehouseClose?.();
        };
        // v0.5.2: the warehouse's Fly it: the warehouse closes, and New scenario opens with the design picked.
        if (onFlyDesign) warehouse.onfly = (d) => { warehouse.close(); onFlyDesign(d); };
        return warehouse;
      }).catch((err) => { warehouseLoad = null; throw err; });
    }
    return warehouseLoad.then((w) => {
      if (el.hidden) return w;
      page = 'warehouse';
      editing = confirming = null;
      $('nav').hidden = true; $('load').hidden = true;
      w.open();
      syncScene();
      return w;
    });
  }

  function show() {
    const was = el.hidden;
    el.hidden = false;
    if (was) {
      window.addEventListener('keydown', onWindowKey, true);
      watcher?.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
    }
    showPage('main');
  }
  function hide() {
    if (el.hidden) return;
    window.removeEventListener('keydown', onWindowKey, true);
    watcher?.disconnect();
    if (el.contains(document.activeElement)) document.activeElement.blur();
    el.hidden = true;
    if (warehouse?.isOpen) warehouse.close();   // its onclose sees the menu hidden and does nothing more
    if (page === 'warehouse') page = 'main';
    scene.setActive(false);
  }
  // The list changed elsewhere (a save, a rename): redraw what's showing, keeping the page.
  function refresh() {
    if (page === 'load') renderLoad(); else renderMain();
  }

  return {
    show, hide, refresh, openWarehouse, get isOpen() { return !el.hidden; }, get page() { return page; }, showPage, get warehouse() { return warehouse; },
    // v0.5.7: the home page's backdrop (Shane picks one: the checks show all three), and its scene for the checks
    setBackdrop: (name) => scene.setBackdrop(name), get backdrop() { return scene.backdrop; }, scene,
  };
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

export function createSettingsPage(root, { get, onVolume, onCallouts, onPerf, onSky, onIndestructible, onAutoTrim, onPanelScale, keyName = null } = {}) {
  const seg = (k) => `<div class="fsui-seg" data-seg="${k}"><button data-v="on">On</button><button data-v="off">Off</button></div>`;
  const page = createPage(root, 'fsm-settings', 'Settings', `
    <div class="fsm-set">
      <label class="fsm-set-row"><span class="lab">Master volume</span>
        <span class="ctl"><input type="range" min="0" max="100" step="5" data-s="volume"><output data-s="volOut">100%</output></span></label>
      ${onPanelScale ? `<label class="fsm-set-row"><span class="lab">Panel size<small>The PFD, the ND and the engine panel, from half their size to 120 %</small></span>
        <span class="ctl"><input type="range" min="50" max="120" step="5" data-s="panelScale"><output data-s="panelOut">100%</output></span></label>` : ''}
      <div class="fsm-set-row"><span class="lab">Callouts<small>The radio-altitude calls on final, “retard” and the ground-proximity warnings</small></span><span class="ctl">${seg('callouts')}</span></div>
      <div class="fsm-set-row"><span class="lab">Performance readout<small data-s="perfNote">Frame rate, triangles and draw calls along the top (F3)</small></span><span class="ctl">${seg('perf')}</span></div>
      ${onIndestructible ? `<div class="fsm-set-row"><span class="lab">Indestructible<small>No crash ends the flight: the gear holds, the aircraft scrapes and slides instead. The landing card says what would have crashed</small></span><span class="ctl">${seg('indestructible')}</span></div>` : ''}
      ${onAutoTrim ? `<div class="fsm-set-row"><span class="lab">Boeing auto-trim<small>The 787 and 777 hold their flight path when you let go, as the A321 does, and with the flaps for landing W and S nudge the path. Below 50 ft on a landing it holds the attitude and the nose sinks a little, so you flare, as in the A321. Y and H nudge the path held</small></span><span class="ctl">${seg('autoTrim')}</span></div>` : ''}
      ${onSky ? `<div class="fsm-set-row"><span class="lab">Time of day<small>The clock, the date and the sun and Moon</small></span><span class="ctl"><button class="fsui-b" data-s="sky">Open the Sky window (\\)</button></span></div>` : ''}
    </div>`);
  const el = page.el;
  const q = (k) => el.querySelector(`[data-s="${k}"]`);
  const setSeg = (k, on) => { for (const b of el.querySelectorAll(`[data-seg="${k}"] button`)) b.classList.toggle('on', (b.dataset.v === 'on') === !!on); };
  const showVol = (v) => { q('volume').value = Math.round(v * 100); q('volOut').textContent = `${Math.round(v * 100)}%`; };
  // v0.6.2: the side panels' size (Shane: "an option to the settings that scales up or down the size of the two side panels")
  const showPanel = (k) => { q('panelScale').value = Math.round(k * 100); q('panelOut').textContent = `${Math.round(k * 100)}%`; };

  page.render = () => {
    const s = get?.() || {};
    showVol(Number.isFinite(s.volume) ? s.volume : 1);
    if (onPanelScale) showPanel(Number.isFinite(s.panelScale) ? s.panelScale : 1);
    setSeg('callouts', s.callouts !== false);
    setSeg('perf', !!s.showPerf);
    if (onIndestructible) setSeg('indestructible', !!s.indestructible);
    if (onAutoTrim) setSeg('autoTrim', !!s.autoTrim);
    // v0.5.7: the readout's key as bound (the Controls page's; F3 by default)
    if (keyName) { const k = keyName('perf'); q('perfNote').textContent = `Frame rate, triangles and draw calls along the top${k ? ` (${k})` : ''}`; }
  };
  q('volume').addEventListener('input', () => { const v = Number(q('volume').value) / 100; showVol(v); onVolume?.(v); });
  if (onPanelScale) q('panelScale').addEventListener('input', () => { const k = Number(q('panelScale').value) / 100; showPanel(k); onPanelScale(k); });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-seg] button');
    if (b) {
      const k = b.closest('[data-seg]').dataset.seg, on = b.dataset.v === 'on';
      setSeg(k, on);
      if (k === 'callouts') onCallouts?.(on); else if (k === 'indestructible') onIndestructible?.(on);
      else if (k === 'autoTrim') onAutoTrim?.(on); else onPerf?.(on);
      return;
    }
    // The Sky window stands aside over the flight, so Settings closes first.
    if (e.target.closest('[data-s="sky"]')) { page.close(); onSky?.(); }
  });
  return page;
}

// v0.5.6: the notes under the keys (the FCU, the map, the views), and the Boeings' own (their trim and MCP).
const NOTES = `
      <p data-note="fcu"><b>The FCU</b> along the top sets SPD, HDG, ALT and V/S. Scroll over a window to turn it (a quick flick turns it in big steps),
        or click it, type a value and press Enter, which also pushes the knob: ALT starts a level change, V/S engages V/S.
        An ALT under 1,000 is a flight level (350 = FL350); a V/S of 60 or less is in hundreds (−15 = −1,500 ft/min).
        Esc, a click elsewhere or a flying key closes it unchanged.</p>
      <p><b>The map:</b> with the AP on, the bright line is where the aircraft will go: click a point on it to jump there.
        The magenta line is the route to your destination and doesn't jump, so point the HDG along it first: hover over it for the heading to set.
        A red cross means the path meets the terrain. “Skip to 15 nm final” puts you on the 3° path to the destination runway.
        Drag the magenta line to add a waypoint. “Change route”, or a click on an airport, picks a new destination and runway;
        the line then goes direct from where you are.</p>
      <p><b>Views:</b> the switch at the top right (or the view keys) picks the cockpit (the captain's seat), the nose or the 3rd person view.
        In the cockpit, Cockpit again swaps to the first officer's seat and back. Next view steps through all four.
        Press and drag on the view (one finger) to look around, or in 3rd person to go round the aircraft; a two-finger swipe does the same;
        pinch or scroll to zoom, double-click to recentre.</p>`;
export const FAMILY_NOTES = {
  boeing: `<p>The trim sets the speed the aircraft holds: let go of the controls and it settles back to the green TRIM mark on the speed tape.
    With the A/P on, it trims itself. With <b>Boeing auto-trim</b> on (Settings) it always does: let go and the flight path holds, as the A321's does,
    and with the flaps for landing the pitch keys nudge the path; the trim keys then nudge the path held, more finely. Below 50 ft on a landing it holds the attitude
    and the nose sinks a little, so you flare, as in the A321.</p>
    <p><b>The MCP</b> along the top sets the speed, HDG, ALT and V/S. Scroll over a window to turn it (a quick flick turns it in big steps), or click it, type a value and press Enter.
    Enter on HDG goes to HDG SEL, on ALT to FLCH, on V/S to V/S. An ALT under 1,000 is a flight level (350 = FL350); a V/S of 60 or less is in hundreds (−15 = −1,500 ft/min).
    Above FL260 the speed window is in Mach, and a typed 84 or .84 is a Mach at any height. Its buttons light green when active and white when armed.
    Esc, a click elsewhere or a flying key closes a window unchanged.</p>`,
};

// v0.5.7: the Controls page has every key that isn't the warehouse's block, the same for every aircraft (Shane's
// decisions: the sticks, rudder, trim, the thrust for all the engines, flaps and spoilers, gear and brakes, the
// autopilot and autothrust, the views, time, the map, pushback, rewind, QNH, the readout). The block (7–0, U–P, J–; and
// M–/, and Shift with them) is each aircraft's own, set in the warehouse by clicking a part: an engine's own thrust, a
// wing tank's drop. Over the list, the keyboard (keyboard-map.js) shades each key by who sets it; a row hovered or
// focused lights its keys. Each key is a keycap: click it, then press the new key (Esc cancels, Backspace or Delete
// clears it); + adds another. A key another control had moves, and that control says so; a block key is refused,
// naming the rule. Without `keys` (the dev pages) it shows the defaults, read-only.
export function createControlsPage(root, { sky = false, keys = null } = {}) {
  const fixedL = sky ? '\\ or Cmd/Ctrl+L: the Sky window (time of day), and its Weight tab (passengers, cargo and fuel)'
    : '\\ or Cmd/Ctrl+L: the Weight window (passengers, cargo and fuel)';
  const page = createPage(root, 'fsm-controls', 'Controls', `
    <div class="fsk">
      <div class="fsk-board" data-o="board"></div>
      <p class="fsk-part" data-o="part">The block, ${esc(BLOCK_TEXT)} (and Shift with them), is the warehouse’s: each aircraft’s own keys for its engines’ thrust and its wing tanks’ drop, set by clicking the part there. Every other key is set here, the same for every aircraft.</p>
      <div class="fsk-top">
        <p class="fsk-from" data-o="from"></p>
        <button class="fsui-b" data-k="reset">Reset</button>
      </div>
      <p class="fsk-msg" data-o="msg" aria-live="polite"></p>
      <div class="fsk-cols" data-o="rows"></div>
      <p class="fsk-fixed">Esc: the menu. ${esc(fixedL)}. These two can’t be changed; \`, tab, caps lock, return, delete and shift do nothing on their own.</p>
    </div>
    <div class="fsm-notes">${NOTES}<div data-family-keys></div></div>`);
  const el = page.el;
  const o = (k) => el.querySelector(`[data-o="${k}"]`);
  const board = renderKeyboard(o('board'), { sky });
  let flownFamily = null;    // setFamily(): the family flown (its notes)
  let capturing = null;      // { id, i }: the keycap waiting for a key (i: its index; past the last: one more)
  let msg = '', msgBad = false;
  let res = resolveKeys(null);
  let hoverRow = null;       // the row lit on the keyboard (hovered; else the one with the focus)

  const store = () => keys?.load?.() || null;
  const setMsg = (text, bad = false) => { msg = text || ''; msgBad = bad; const m = o('msg'); m.textContent = msg; m.classList.toggle('bad', !!bad); };

  function commit(next, okText = '') {
    const ok = keys?.save ? keys.save(next) !== false : false;
    if (!ok) setMsg('Couldn’t save the keys: the browser’s storage is off or full', true);
    else setMsg(okText);
    render();
  }

  // A row's keycaps: each key, then + for another (one empty cap if it has none). Read-only: plain keys.
  function capsHtml(b) {
    const chords = res.bind[b.id] || [];
    if (!keys) return chords.length ? chords.map((c) => `<kbd>${esc(keyLabel(c))}</kbd>`).join(' ') : '<span class="none">no key</span>';
    const cap = (i, text, cls, title) => {
      const on = capturing?.id === b.id && capturing.i === i;
      return `<button type="button" class="fsk-cap${cls}${on ? ' on' : ''}" data-cap="${b.id}:${i}" title="${esc(on ? 'Press a key: Esc cancels, Backspace or Delete clears it' : title)}">${on ? 'Press a key' : esc(text)}</button>`;
    };
    if (!chords.length) return cap(0, '·', ' empty', 'No key: click, then press one');
    return chords.map((c, i) => cap(i, keyLabel(c), '', 'Click, then press the new key')).join('') + cap(chords.length, '+', ' add', 'Add another key');
  }

  function render() {
    const st = store();
    res = resolveKeys(st);
    const own = !!keys && BINDINGS.some((b) => st?.global?.bind?.[b.id]);
    o('from').textContent = !keys ? 'The default keys.' : own ? 'Changed from the defaults. Reset puts the defaults back (the block’s keys stay: they’re the warehouse’s).' : 'The default keys, the same for every aircraft.';
    const reset = el.querySelector('[data-k="reset"]');
    reset.disabled = !keys || !own || !!capturing;
    reset.hidden = !keys;
    const family = flownFamily || 'airbus';
    let html = '';
    for (const sec of SECTIONS) {
      const rows = BINDINGS.filter((b) => b.section === sec.id);
      html += `<section class="fsk-sec"><h3 class="fsm-keys-h">${esc(sec.title)}</h3><table class="fsk-table">${rows.map((b) => `<tr data-row="${b.id}"><td class="lab">${esc(b.label)}</td><td class="keys">${capsHtml(b)}</td></tr>`).join('')}</table></section>`;
    }
    o('rows').innerHTML = html;
    board.update(res);
    light();
    el.querySelector('[data-family-keys]').innerHTML = FAMILY_NOTES[family] || '';
    for (const n of el.querySelectorAll('[data-note]')) n.hidden = family === 'boeing' && n.dataset.note === 'fcu';
    const m = o('msg'); m.textContent = msg; m.classList.toggle('bad', !!msgBad);
    // The keys stay the page's (a button it drew again had the focus): else they'd reach the flight under it.
    if (!el.hidden && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }
  page.render = () => { capturing = null; stopCapture(); setMsg(''); hoverRow = null; render(); };

  // The keyboard lights the keys of the row hovered, else of the row with the focus, else of the keycap waiting.
  function light() {
    const focused = el.contains(document.activeElement) ? document.activeElement.closest?.('tr[data-row]')?.dataset.row : null;
    const id = hoverRow || focused || capturing?.id || null;
    board.highlight(id ? codesOf(res.bind[id]) : []);
  }
  o('rows').addEventListener('pointerover', (e) => { const r = e.target.closest?.('tr[data-row]'); const id = r ? r.dataset.row : null; if (id !== hoverRow) { hoverRow = id; light(); } });
  o('rows').addEventListener('pointerleave', () => { hoverRow = null; light(); });
  o('rows').addEventListener('focusin', () => light());
  o('rows').addEventListener('focusout', () => setTimeout(light, 0));

  // Capturing a key: everything goes to the page until a key is taken, cleared or Esc cancels.
  function onCapture(e) {
    if (!capturing || el.hidden) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if (e.repeat || isModifier(e.code)) return;   // Shift (or the rest) alone: the key comes with it
    const c = capturing, b = bindingOf(c.id);
    if (e.code === 'Escape') { capturing = null; stopCapture(); setMsg(''); render(); return; }
    if (e.code === 'Backspace' || e.code === 'Delete') {
      capturing = null; stopCapture();
      if (c.i < (res.bind[c.id] || []).length) commit(clearKeys(store(), c.id, { index: c.i }).store, 'Cleared.');
      else { setMsg(''); render(); }
      return;
    }
    const r = chordFor(e, b?.kind || 'action', 'global');
    if (r.refused) { setMsg(`${r.refused}. Press another key, or Esc.`, true); return; }
    const out = bindKey(store(), c.id, r.chord, { index: c.i });
    if (out.error) { setMsg(`${out.error}. Press another key, or Esc.`, true); return; }
    capturing = null; stopCapture();
    commit(out.store, movedText(out.moved, r.chord) || `${keyLabel(r.chord)} set.`);
  }
  const swallowUp = (e) => { if (capturing) { e.stopPropagation(); e.stopImmediatePropagation(); } };
  function startCapture(c) {
    capturing = c;
    document.addEventListener('keydown', onCapture, true);
    document.addEventListener('keyup', swallowUp, true);
    const label = bindingOf(c.id)?.label;
    const more = c.i > 0 && c.i >= (res.bind[c.id] || []).length;
    setMsg(more ? `Press another key for “${label}”: Esc cancels.` : `Press the key for “${label}”: Esc cancels, Backspace or Delete clears it.`);
    render();
    el.querySelector(`[data-cap="${c.id}:${c.i}"]`)?.focus({ preventScroll: true });
  }
  function stopCapture() {
    document.removeEventListener('keydown', onCapture, true);
    document.removeEventListener('keyup', swallowUp, true);
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !keys) return;
    if (b.dataset.cap) {
      const [id, i] = b.dataset.cap.split(':');
      const again = capturing && capturing.id === id && capturing.i === Number(i);
      capturing = null; stopCapture();
      if (again) { setMsg(''); render(); return; }   // the keycap waiting, clicked again: cancelled
      startCapture({ id, i: Number(i) || 0 });
      return;
    }
    if (capturing) return;
    if (b.dataset.k === 'reset') commit(resetKeys(store(), { scope: 'global' }).store, 'Back to the defaults.');
  });
  // The family flown (its notes).
  page.setFamily = (family) => { flownFamily = family || null; if (!el.hidden) render(); };
  page.setAircraft = () => { if (!el.hidden && !capturing) render(); };
  const close0 = page.close;
  page.close = () => { capturing = null; stopCapture(); close0(); };
  page.board = board;   // v0.5.7: the keyboard (keyboard-map.js), for the checks
  render();
  return page;
}
