// The Weight window (v0.3.2): the flight's passengers, cargo and fuel, changed during the flight,
// in the air or on the ground. It's the Sky window's second tab: the same frame at the bottom-left,
// under the PFD, with the tabs (Sky · Weight) in the title bar; L opens whichever was last.
//   createLoadWindow(root, { get, onapply })
//     get() → { limits, pax, cargoKg, fuelKg, gross, cgMac, crashed }   (the type's limits as the setup's)
//     onapply({ pax, cargoKg, fuelKg }) → { ok, text }   (fuelKg undefined: the fuel wasn't edited)
//   -> { open(), close(), toggle(), isOpen, update(), onclose, ontab }
// The checks are the setup's: the seats, the hold, the tanks, MZFW and MTOW stop it; over MLW and
// low fuel only warn. Apply (or Enter in a field) sets the load; until the fuel field is edited it
// follows the burn. A field with the cursor takes the keys (Enter applies, Esc closes); Apply, a
// click outside or Esc gives them back to the flight. Clicks and the wheel stay in the window.
// Styles: sky-window.css (fssw-* for the frame, fslw-* for this), linked here if the page hasn't.

const ICON = {
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="12" cy="12" r="4.6"/><path d="M11 1.5h2v4h-2zM11 18.5h2v4h-2zM1.5 11h4v2h-4zM18.5 11h4v2h-4zM4.1 5.5l1.4-1.4 2.8 2.8-1.4 1.4zM15.7 17.1l1.4-1.4 2.8 2.8-1.4 1.4zM4.1 18.5l2.8-2.8 1.4 1.4-2.8 2.8zM15.7 6.9l2.8-2.8 1.4 1.4-2.8 2.8z"/></g></svg>',
  // A weight: a ring on a trapezoid.
  weight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5a3.5 3.5 0 0 1 2.9 5.5h2.6a1.5 1.5 0 0 1 1.46 1.16l2.3 10A1.5 1.5 0 0 1 19.8 21H4.2a1.5 1.5 0 0 1-1.46-1.84l2.3-10A1.5 1.5 0 0 1 6.5 8h2.6A3.5 3.5 0 0 1 12 2.5zm0 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>',
};
export const TAB_ICONS = { sky: ICON.sun, load: ICON.weight };

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const whole = (v) => Number.isFinite(v) && v >= 0 && Math.floor(v) === v;

// ---- pure helpers (tests/load.test.mjs) ----

// The load against the type's limits, with the setup's words. → { payload, zfw, gross, problems, warn }
export function loadCheck(L, { pax, cargoKg, fuelKg }) {
  const problems = [];
  if (!whole(pax) || pax > L.PAX_MAX) problems.push(`Passengers: a whole number from 0 to ${fmt(L.PAX_MAX)}.`);
  if (!Number.isFinite(cargoKg) || cargoKg < 0) problems.push('Cargo: a number of kg, 0 or more.');
  else if (cargoKg > L.CARGO_MAX) problems.push(`Cargo is over the hold's ${fmt(L.CARGO_MAX)} kg.`);
  if (!Number.isFinite(fuelKg) || fuelKg < 0) problems.push('Fuel: a number of kg, 0 or more.');
  else if (fuelKg > L.FUEL_MAX) problems.push(`The tanks hold ${fmt(L.FUEL_MAX)} kg.`);
  const payload = (whole(pax) ? pax : 0) * L.PAX_KG + (Number.isFinite(cargoKg) ? Math.max(0, cargoKg) : 0);
  const zfw = L.OEW + payload, gross = zfw + (Number.isFinite(fuelKg) ? Math.max(0, fuelKg) : 0);
  if (zfw > L.MZFW) problems.push(`Zero-fuel weight is over the ${fmt(L.MZFW)} kg limit.`);
  if (gross > L.MTOW) problems.push(`The weight is over MTOW (${fmt(L.MTOW)} kg).`);
  let warn = '';
  if (!problems.length && gross > L.MLW) warn = `Over MLW (${fmt(L.MLW)} kg): burn fuel before landing, or expect a heavy landing.`;
  else if (!problems.length && fuelKg < 600) warn = 'Under 600 kg of fuel: the engines won’t run for long.';
  return { payload, zfw, gross, problems, warn };
}

// The Max button: as much as the tanks hold, up to MTOW with this payload.
export const maxFuel = (L, payloadKg) => Math.max(0, Math.min(L.FUEL_MAX, L.MTOW - L.OEW - payloadKg));

function linkCss() {
  if (typeof document === 'undefined') return;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => /sky-window\.css(\?|$)/.test(l.href))) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./sky-window.css', import.meta.url).href;
  document.head.appendChild(l);
}

export function createLoadWindow(root, { get, onapply } = {}) {
  linkCss();
  const el = document.createElement('div');
  el.className = 'fssw fslw';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Weight: fuel and payload');
  el.innerHTML = `
    <div class="fssw-head">
      <div class="fssw-tabs" role="tablist">
        <button class="fssw-tab" data-tab="sky" role="tab" aria-selected="false" title="The time of day"><span class="fssw-ico">${ICON.sun}</span>Sky</button>
        <button class="fssw-tab on" data-tab="load" role="tab" aria-selected="true"><span class="fssw-ico fssw-ico--load">${ICON.weight}</span>Weight</button>
      </div>
      <span class="fssw-sub">Fuel and payload</span>
      <button class="fssw-x" data-a="close" title="Close (L or Esc)">${ICON.x}</button></div>
    <div class="fssw-body fslw-body">
      <div class="fslw-now" data-o="loadNow"></div>
      <div class="fslw-grid">
        <label for="fslw-pax">Passengers</label><input id="fslw-pax" type="number" min="0" step="1" data-f="pax" inputmode="numeric" autocomplete="off"><span class="fslw-unit" data-o="paxNote"></span>
        <label for="fslw-cargo">Cargo</label><input id="fslw-cargo" type="number" min="0" step="100" data-f="cargoKg" inputmode="numeric" autocomplete="off"><span class="fslw-unit" data-o="cargoNote"></span>
        <label for="fslw-fuel">Fuel</label><input id="fslw-fuel" type="number" min="0" step="100" data-f="fuelKg" inputmode="numeric" autocomplete="off"><span class="fslw-unit"><span data-o="fuelNote"></span><button class="fssw-b" data-a="max" title="As much as the tanks hold, up to MTOW">Max</button></span>
      </div>
      <div class="fslw-sum" data-o="sum"></div>
      <div class="fslw-msg" data-o="msg" aria-live="polite"></div>
      <div class="fssw-row fslw-act">
        <button class="fssw-b" data-a="revert" title="Back to the load the aircraft has">Undo edits</button>
        <button class="fssw-b fslw-apply" data-a="apply">Apply</button>
      </div>
    </div>
    <div class="fssw-foot"><span class="fssw-key">Enter</span> Apply · <span class="fssw-key">L</span><span class="fssw-key">Esc</span> Close</div>`;
  root.appendChild(el);
  const o = (n) => el.querySelector(`[data-o="${n}"]`);
  const f = (n) => el.querySelector(`[data-f="${n}"]`);
  const btn = (a) => el.querySelector(`[data-a="${a}"]`);
  const FIELDS = ['pax', 'cargoKg', 'fuelKg'];

  let open = false, dirty = {}, msg = '', msgCls = '', lastNow = '';
  const now = () => get?.() || null;
  const num = (k) => { const v = f(k).value.trim(); return v === '' ? NaN : Number(v); };
  const fieldsLoad = () => ({ pax: num('pax'), cargoKg: num('cargoKg'), fuelKg: num('fuelKg') });

  // Fill the fields from the aircraft: all of them, or only those not being edited.
  function fill(all) {
    const n = now();
    if (!n) return;
    if (all || !dirty.pax) f('pax').value = Math.round(n.pax);
    if (all || !dirty.cargoKg) f('cargoKg').value = Math.round(n.cargoKg);
    if (all || !dirty.fuelKg) f('fuelKg').value = Math.round(n.fuelKg);
  }
  function setMsg(text, cls = '') { msg = text; msgCls = cls; }

  function render() {
    const n = now();
    if (!n) return;
    const L = n.limits;
    o('paxNote').textContent = `× ${L.PAX_KG} kg incl. bags · seats ${fmt(L.PAX_MAX)}`;
    o('cargoNote').textContent = `kg · hold ${fmt(L.CARGO_MAX)}`;
    o('fuelNote').textContent = `kg · tanks ${fmt(L.FUEL_MAX)}`;
    const nowText = `Now <b>${fmt(n.gross)}</b> kg · ${fmt(n.fuelKg)} kg of fuel · CG ${(n.cgMac * 100).toFixed(1)} % MAC`;
    if (nowText !== lastNow) { o('loadNow').innerHTML = nowText; lastNow = nowText; }
    const want = fieldsLoad(), c = loadCheck(L, want);
    o('sum').innerHTML = `<span>Payload <b>${fmt(c.payload)}</b> kg · zero-fuel <span class="${c.zfw > L.MZFW ? 'bad' : ''}">${fmt(c.zfw)}</span> of ${fmt(L.MZFW)}</span>`
      + `<span>Weight <b class="${c.gross > L.MTOW ? 'bad' : c.gross > L.MLW ? 'warn' : ''}">${fmt(c.gross)}</b> kg of ${fmt(L.MTOW)} (MTOW) · MLW ${fmt(L.MLW)}</span>`;
    const edited = FIELDS.some((k) => dirty[k]);
    let text = msg, cls = msgCls;
    if (n.crashed) { text = 'Crashed: rewind or restart to change the load.'; cls = 'bad'; }
    else if (c.problems.length) { text = c.problems[0]; cls = 'bad'; }
    else if (edited && c.warn) { text = c.warn; cls = 'warn'; }
    else if (edited && !msg) { text = 'Apply to load it.'; cls = ''; }
    const m = o('msg');
    if (m.textContent !== text) m.textContent = text;
    m.className = 'fslw-msg' + (cls ? ' ' + cls : '');
    btn('apply').disabled = !!n.crashed || !edited || c.problems.length > 0;
    btn('revert').disabled = !edited;
    for (const k of FIELDS) f(k).classList.toggle('edited', !!dirty[k]);
  }

  function apply() {
    const n = now();
    if (!n || n.crashed) return;
    const want = fieldsLoad(), c = loadCheck(n.limits, want);
    if (c.problems.length || !FIELDS.some((k) => dirty[k])) { render(); return; }
    const r = onapply?.({ pax: want.pax, cargoKg: want.cargoKg, fuelKg: dirty.fuelKg ? want.fuelKg : undefined }) || { ok: false, text: 'Not applied.' };
    if (r.ok) { dirty = {}; fill(true); }
    setMsg(r.text || '', r.ok ? 'ok' : 'bad');
    if (el.contains(document.activeElement)) document.activeElement.blur();   // the keys go back to the flight
    render();
  }

  const win = {
    el,
    onclose: null,
    ontab: null,
    get isOpen() { return open; },
    open() {
      if (open) return;
      open = true; el.hidden = false; dirty = {}; setMsg(''); lastNow = '';
      fill(true); render();
    },
    close() {
      if (!open) return;
      open = false; el.hidden = true;
      if (el.contains(document.activeElement)) document.activeElement.blur();
      win.onclose?.();
    },
    toggle() { if (open) win.close(); else win.open(); },
    // Every few frames while open: the live fuel (until edited) and the totals.
    update() { if (open) { fill(false); render(); } },
  };

  el.addEventListener('input', (e) => {
    const k = e.target.dataset?.f;
    if (!k) return;
    dirty[k] = true; setMsg('');
    render();
  });
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    if (t.dataset.tab) { if (t.dataset.tab !== 'load') win.ontab?.(t.dataset.tab); return; }
    switch (t.dataset.a) {
      case 'close': win.close(); break;
      case 'apply': apply(); break;
      case 'revert': dirty = {}; setMsg(''); fill(true); render(); break;
      case 'max': {
        const n = now();
        if (!n) break;
        const w = fieldsLoad(), c = loadCheck(n.limits, { ...w, fuelKg: 0 });
        f('fuelKg').value = Math.round(maxFuel(n.limits, c.payload));
        dirty.fuelKg = true; setMsg(''); render();
        break;
      }
    }
  });
  el.addEventListener('keydown', (e) => {
    if (!e.target.dataset?.f) return;
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
  });
  // Clicks and the wheel stay in the window. Buttons never take the focus (Space and Enter keep
  // going to the game); the fields do, to be typed in.
  el.addEventListener('mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault(); e.stopPropagation(); });
  for (const t of ['pointerdown', 'dblclick', 'contextmenu']) el.addEventListener(t, (e) => e.stopPropagation());
  el.addEventListener('wheel', (e) => { e.stopPropagation(); e.preventDefault(); }, { passive: false });
  // A click anywhere else gives the keys back to the flight.
  window.addEventListener('pointerdown', (e) => { if (open && !el.contains(e.target) && el.contains(document.activeElement)) document.activeElement.blur(); }, true);

  // Esc closes the window first (also from a field): only that Esc stops here, so the pause menu
  // doesn't open. Every other key goes on (L is the lead's toggle).
  window.addEventListener('keydown', (e) => {
    if (!open || e.key !== 'Escape' || document.body.classList.contains('in-menu')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable) && !el.contains(t)) return;
    e.preventDefault(); e.stopPropagation();
    win.close();
  }, true);

  return win;
}
