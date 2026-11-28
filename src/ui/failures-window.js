// The Failures window (v0.8.0, part 4): the L window's fourth tab, in the Sky window's frame, made as the Weather tab.
//   createFailuresWindow(root, { get, onapply })
//     get() → failuresView(sim, …): { plan, active, t, nEngines, off, crashed, paused }
//              plan: sim.failures (null: nothing armed); active: sim.state.failures (what is failed now);
//              off: per engine, torn off its pylon (state.engines[i].off: not a failure this tab repairs)
//     onapply(action) → { ok, text } or nothing (nothing counts as ok); main.js hands it to applyFailAction(sim, …).
//       { type: 'arm', spec: { kind, target, when }, seed }       when: { type: 'now' | 'after' (seconds) | 'moment' (moment) }
//       { type: 'armRandom', kinds, windowS, seed }               a random failure: the tab shows its window alone
//       { type: 'disarm', id } | { type: 'disarmAll' }            out of the plan, not yet fired
//       { type: 'repair', id } | { type: 'repairAll' }            sim.repair(id | 'all')
//   -> { el, open(), close(), toggle(), isOpen, update(), onclose, ontab }
// The seed is drawn here, in the page, when the player arms (never in the sim). A random failure's kind, target and time
// never reach the DOM: its row is built from its window alone (randomRow()), and has no title or data but its id.
// The pure parts (the rows, the words, the plan an action makes) are exported for node (tests/v080-failures-tab.test.mjs).
// Styles: sky-window.css (fssw-* for the frame, fslw-* shared with the Weight tab, fsfw-* for this).

import { KINDS, SYSTEMS, LEGS, MOMENTS, armed, armedRandom, without, planItems, describe, HYD_NAMES } from '../sim/failures.js';
import { TAB_ICONS } from './load-window.js';

const ICON = {
  // A warning triangle with its bar and dot.
  failures: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M12 3.5L22 20.5H2z"/><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M12 9.5v5.2M12 17.6v.1"/></svg>',
  weather: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.5 15.5a4.5 4.5 0 0 1-.7-8.95A5.5 5.5 0 0 1 17.3 7.6a4 4 0 0 1-.3 7.9z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M8 18.5l-1 3M12.5 18.5l-1 3M17 18.5l-1 3"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>',
};
// The tab, for createSkyWindow({ tabs }).
export const FAILURES_TAB = { id: 'failures', label: 'Failures', icon: ICON.failures, title: 'Engine and gear failures' };

// The Weight and Weather windows draw their own tabs: this adds the Failures one to them. Its click reaches their ontab('failures').
export function addFailuresTab(el) {
  const tabs = el?.querySelector('.fssw-tabs');
  if (!tabs || tabs.querySelector('[data-tab="failures"]')) return;
  const b = document.createElement('button');
  b.className = 'fssw-tab'; b.dataset.tab = 'failures';
  b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', 'false'); b.title = FAILURES_TAB.title;
  b.innerHTML = `<span class="fssw-ico">${ICON.failures}</span>${FAILURES_TAB.label}`;
  tabs.appendChild(b);
}

// ---- the pure parts ----

// The systems and their kinds, from failures.js's KINDS (a later sub-update's system shows by adding to KINDS and SYSTEMS).
export function kindsBySystem() {
  const out = [];
  for (const sys of Object.keys(SYSTEMS)) {
    const kinds = Object.keys(KINDS).filter((k) => KINDS[k].system === sys).map((k) => ({ kind: k, label: KINDS[k].label, target: KINDS[k].target, random: !!KINDS[k].random }));
    if (kinds.length) out.push({ system: sys, label: SYSTEMS[sys], kinds });
  }
  return out;
}
// The kinds a random failure may be.
export const randomKinds = () => Object.keys(KINDS).filter((k) => KINDS[k].random);

// "2 min 10 s", "45 s", "3 min".
export function durationWords(s) {
  const n = Math.max(0, Math.round(s));
  const m = Math.floor(n / 60), r = n % 60;
  return m ? (r ? `${m} min ${r} s` : `${m} min`) : `${r} s`;
}
// The minutes left of a random failure's window (whole minutes, rounded up; never negative).
export function minutesLeft(win, t) {
  if (!Array.isArray(win) || !Number.isFinite(win[1])) return 0;
  return Math.max(0, Math.ceil((win[1] - t) / 60 - 1e-9));
}
// A random failure's words: its window, nothing else.
export function randomWords(win, t) {
  const n = minutesLeft(win, t);
  return n <= 0 ? 'A random failure armed, any moment now' : `A random failure armed, within ${n} minute${n === 1 ? '' : 's'}`;
}
// When an armed item fires, in words: the moment's, "in 2 min 10 s", or "now".
export function whenWords(it, t) {
  if (it.moment !== undefined) return MOMENTS[it.moment] || '';
  const d = it.at - t;
  return d > 0.5 ? 'in ' + durationWords(d) : 'now';
}
// How long ago an active failure fired.
export function agoWords(dt) {
  if (!(dt >= 1)) return 'just now';
  return durationWords(dt < 60 ? dt : Math.floor(dt / 60) * 60) + ' ago';
}
// The armed list: the plan's items that haven't become active. A random one is { id, random: true, text } and nothing more.
export function armedRows(plan, active, t, family) {   // v0.8.0 (part 7): family, for the hydraulic systems' names
  const fired = new Set((active || []).map((a) => a.id));
  const rows = [];
  for (const it of planItems(plan)) {
    if (fired.has(it.id)) continue;
    if (it.hidden) rows.push({ id: it.id, random: true, text: randomWords(it.win, t), when: '' });
    else rows.push({ id: it.id, random: false, text: describe(it, 2, family), when: whenWords(it, t) });
  }
  return rows;
}
// The active list: what is failed now, an engine torn off its pylon left out (off[i]: true).
export function activeRows(active, t, off = [], family) {
  const rows = [];
  for (const a of active || []) {
    if (KINDS[a.kind]?.target === 'engine' && off[a.target]) continue;
    rows.push({ id: a.id, text: describe(a, 2, family), when: agoWords(t - a.t) });
  }
  return rows;
}
// What the window shows, read from a sim (a copy of the lists: the sim's objects may be reused).
export function failuresView(sim, extra = {}) {
  const s = sim.state;
  return {
    plan: sim.failures || null,
    active: (s.failures || []).map((a) => ({ ...a })),
    t: s.t,
    nEngines: s.engines.length,
    off: s.engines.map((e) => !!e.off),
    family: sim.type.family === 'boeing' ? 'boeing' : 'airbus',   // v0.8.0 (part 7)
    hydNames: HYD_NAMES[sim.type.family === 'boeing' ? 'boeing' : 'airbus'].slice(),
    ...extra,
  };
}
// The plan an action makes (arm, armRandom, disarm, disarmAll), from the plan now; undefined for the sim's own (repair).
export function planAfter(plan, a, t, nEngines) {
  switch (a.type) {
    case 'arm': return armed(plan, a.spec, t, a.seed);
    case 'armRandom': return armedRandom(plan, { kinds: a.kinds, windowS: a.windowS, nEngines }, t, a.seed);
    case 'disarm': return without(plan, a.id);
    case 'disarmAll': {   // the fired ones stay: they are the active list's, repaired there
      let p = plan;
      for (const it of planItems(plan)) if (!(a.active || []).some((x) => x.id === it.id)) p = without(p, it.id);
      return p;
    }
    default: return undefined;
  }
}
// The action done on a sim (main.js's onapply): → { ok, text }.
export function applyFailAction(sim, a) {
  const s = sim.state, n = s.engines.length;
  try {
    switch (a.type) {
      case 'arm': case 'armRandom': case 'disarm': case 'disarmAll': {
        if (a.type === 'armRandom' && !(a.kinds || []).some((k) => KINDS[k]?.random)) return { ok: false, text: 'Tick at least one kind.' };
        if (a.type === 'arm' && KINDS[a.spec?.kind]?.target === 'engine' && !((a.spec.target | 0) >= 0 && (a.spec.target | 0) < n)) return { ok: false, text: 'No such engine.' };
        if (a.type === 'arm' && KINDS[a.spec?.kind]?.target === 'system' && !((a.spec.target | 0) >= 0 && (a.spec.target | 0) < 3)) return { ok: false, text: 'No such system.' };
        const p = planAfter(sim.failures, { ...a, active: s.failures }, s.t, n);
        sim.setFailures(p);
        const text = a.type === 'arm' ? 'Armed: ' + describe({ kind: a.spec.kind, target: KINDS[a.spec.kind].target === 'none' ? 0 : a.spec.target | 0 }, n, sim.type.family === 'boeing' ? 'boeing' : 'airbus') + '.'
          : a.type === 'armRandom' ? 'A random failure armed.' : a.type === 'disarm' ? 'Disarmed.' : 'All disarmed.';
        return { ok: true, text };
      }
      case 'repair': return sim.repair(a.id) ? { ok: true, text: 'Repaired.' } : { ok: false, text: 'Nothing to repair.' };
      case 'repairAll': return sim.repair('all') ? { ok: true, text: 'All repaired.' } : { ok: false, text: 'Nothing to repair.' };
    }
  } catch (e) { return { ok: false, text: 'Not armed: ' + e.message }; }
  return { ok: false, text: 'Unknown action.' };
}
// The form's spec for an armed failure: { kind, target, when }; when from the window's choice.
export function specOf(f) {
  const K = KINDS[f.kind];
  const when = f.when === 'moment' ? { type: 'moment', moment: f.moment }
    : f.when === 'after' ? { type: 'after', seconds: Math.max(0, (+f.min || 0) * 60 + (+f.sec || 0)) } : { type: 'now' };
  return { kind: f.kind, target: K && K.target === 'engine' ? f.engine | 0 : K && K.target === 'leg' ? f.leg | 0 : K && K.target === 'system' ? f.hsys | 0 : 0, when };
}

// ---- the window ----

function linkCss() {
  if (typeof document === 'undefined') return;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => /sky-window\.css(\?|$)/.test(l.href))) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./sky-window.css', import.meta.url).href;
  document.head.appendChild(l);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const newSeed = () => (Math.random() * 0x7fffffff) | 0;   // the page's, once per arming (never the sim's)

// The two lists' HTML (pure: the node test reads it for a random failure's secrets).
export function listsHtml(view) {
  const act = activeRows(view.active, view.t, view.off, view.family), arm = armedRows(view.plan, view.active, view.t, view.family);
  const row = (r, a, label) => `<div class="fsfw-row${r.random ? ' fsfw-rand' : ''}"><span class="fsfw-what">${esc(r.text)}</span>`
    + `<span class="fsfw-when">${esc(r.when)}</span><button class="fssw-b fsfw-rb" data-a="${a}" data-id="${r.id | 0}">${label}</button></div>`;
  return `<div class="fsfw-h"><span>Active</span><button class="fssw-b fsfw-rb" data-a="repairAll"${act.length ? '' : ' disabled'}>Repair all</button></div>`
    + (act.length ? act.map((r) => row(r, 'repair', 'Repair')).join('') : '<div class="fsfw-none">Nothing has failed.</div>')
    + `<div class="fsfw-h"><span>Armed</span><button class="fssw-b fsfw-rb" data-a="disarmAll"${arm.length ? '' : ' disabled'}>Disarm all</button></div>`
    + (arm.length ? arm.map((r) => row(r, 'disarm', 'Disarm')).join('') : '<div class="fsfw-none">Nothing armed.</div>');
}

export function createFailuresWindow(root, { get, onapply } = {}) {
  linkCss();
  const el = document.createElement('div');
  el.className = 'fssw fsfw';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Failures');
  const systems = kindsBySystem();
  const seg = (name, items) => `<div class="fswx-seg fsfw-seg" data-seg="${name}">${items.map(([v, t]) => `<button data-v="${v}">${esc(t)}</button>`).join('')}</div>`;
  const num = (k, step) => `<input type="number" step="${step}" min="0" data-f="${k}" inputmode="numeric" autocomplete="off">`;

  el.innerHTML = `
    <div class="fssw-head">
      <div class="fssw-tabs" role="tablist">
        <button class="fssw-tab" data-tab="sky" role="tab" aria-selected="false" title="The time of day"><span class="fssw-ico">${TAB_ICONS.sky}</span>Sky</button>
        <button class="fssw-tab" data-tab="load" role="tab" aria-selected="false" title="Fuel and payload"><span class="fssw-ico">${TAB_ICONS.load}</span>Weight</button>
        <button class="fssw-tab" data-tab="weather" role="tab" aria-selected="false" title="Wind, cloud, rain and snow"><span class="fssw-ico">${ICON.weather}</span>Weather</button>
        <button class="fssw-tab on" data-tab="failures" role="tab" aria-selected="true"><span class="fssw-ico fsfw-ico">${ICON.failures}</span>Failures</button>
      </div>
      <span class="fssw-sub" data-o="sub"></span>
      <button class="fssw-x" data-a="close" title="Close (\\ or Esc)">${ICON.x}</button></div>
    <div class="fssw-body fsfw-body">
      <div class="fsfw-scroll">
        <div class="fsfw-lists" data-o="lists"></div>
        <div class="fsfw-h fsfw-h2"><span>Arm a failure</span></div>
        <div class="fsfw-grid">
          <label>When</label><div class="fswx-v">${seg('when', [['now', 'Now'], ['moment', 'At a moment'], ['after', 'After'], ['random', 'Random']])}</div>
          <label data-r="moment">Moment</label><div class="fswx-v" data-r="moment"><select data-sel="moment" aria-label="The moment">${Object.entries(MOMENTS).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></div>
          <label data-r="after">After</label><div class="fswx-v" data-r="after">${num('min', 1)}<span class="fswx-u">min</span>${num('sec', 5)}<span class="fswx-u">s</span></div>
          <label data-r="random">Within</label><div class="fswx-v" data-r="random">${num('win', 1)}<span class="fswx-u">minutes, one of:</span></div>
          <label data-r="random"></label><div class="fswx-v fsfw-ticks" data-r="random">${randomKinds().map((k) => `<button class="fssw-b fsfw-tick" data-tick="${k}">${esc(KINDS[k].system === 'engines' ? 'Engine ' + KINDS[k].label.toLowerCase() : KINDS[k].label)}</button>`).join('')}</div>
          <label data-r="pick">System</label><div class="fswx-v" data-r="pick">${seg('system', systems.map((s) => [s.system, s.label]))}</div>
          <label data-r="pick">Failure</label><div class="fswx-v" data-r="pick"><select data-sel="kind" aria-label="The failure"></select></div>
          <label data-r="engine">Engine</label><div class="fswx-v fsfw-engs" data-r="engine"></div>
          <label data-r="leg">Leg</label><div class="fswx-v" data-r="leg">${seg('leg', LEGS.map((n, i) => [String(i), n]))}</div>
          <label data-r="hsys">Hydraulics</label><div class="fswx-v" data-r="hsys">${seg('hsys', HYD_NAMES.airbus.map((n, i) => [String(i), n]))}</div>
        </div>
      </div>
      <div class="fslw-msg" data-o="msg" aria-live="polite"></div>
      <div class="fssw-row fslw-act"><button class="fssw-b fslw-apply" data-a="arm">Arm</button></div>
    </div>
    <div class="fssw-foot"><span class="fssw-key">Enter</span> Arm · <span class="fssw-key">\\</span><span class="fssw-key">Esc</span> Close</div>`;
  root.appendChild(el);

  const o = (n) => el.querySelector(`[data-o="${n}"]`);
  const segOf = (n) => el.querySelector(`[data-seg="${n}"]`);
  const sel = (n) => el.querySelector(`[data-sel="${n}"]`);
  const field = (n) => el.querySelector(`[data-f="${n}"]`);
  const ticks = new Set(randomKinds());
  // The form: what Arm arms.
  const f = { when: 'now', moment: Object.keys(MOMENTS)[0], min: 2, sec: 0, win: 10, system: systems[0]?.system, kind: systems[0]?.kinds[0]?.kind, engine: 0, leg: 0, hsys: 0 };
  field('min').value = f.min; field('sec').value = f.sec; field('win').value = f.win;
  let open = false, view = null, lastLists = '', lastNe = -1, msg = '', msgCls = '';
  const now = () => get?.() || { plan: null, active: [], t: 0, nEngines: 2, off: [] };

  function fillKinds() {
    const s = systems.find((x) => x.system === f.system) || systems[0];
    const k = sel('kind');
    k.innerHTML = s.kinds.map((x) => `<option value="${x.kind}">${esc(x.label)}</option>`).join('');
    if (!s.kinds.some((x) => x.kind === f.kind)) f.kind = s.kinds[0].kind;
    k.value = f.kind;
  }
  function fillEngines(n) {
    if (n === lastNe) return;
    lastNe = n;
    el.querySelector('.fsfw-engs').innerHTML = Array.from({ length: n }, (_, i) => `<button class="fssw-b fsfw-eng" data-eng="${i}">${i + 1}</button>`).join('');
    if (f.engine >= n) f.engine = 0;
  }
  const paint = (name, v) => { for (const b of segOf(name).querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === v); };
  const show = (r, on) => { for (const e of el.querySelectorAll(`[data-r="${r}"]`)) if (e.hidden === on) e.hidden = !on; };

  function render() {
    view = now();
    fillEngines(Math.max(1, view.nEngines | 0));
    // The lists are rebuilt only when their rows change; a countdown alone is written into its row in place (so a
    // click is never lost to a row rebuilt under the mouse).
    const act = activeRows(view.active, view.t, view.off, view.family), arm = armedRows(view.plan, view.active, view.t, view.family);
    const key = JSON.stringify([act.map((r) => [r.id, r.text]), arm.map((r) => [r.id, r.text])]);
    if (key !== lastLists) { o('lists').innerHTML = listsHtml(view); lastLists = key; }
    else {
      const whens = o('lists').querySelectorAll('.fsfw-when'), all = act.concat(arm);
      whens.forEach((w, i) => { if (all[i] && w.textContent !== all[i].when) w.textContent = all[i].when; });
    }
    const random = f.when === 'random', tgt = KINDS[f.kind]?.target;
    paint('when', f.when); paint('system', f.system); paint('leg', String(f.leg));
    show('moment', f.when === 'moment'); show('after', f.when === 'after'); show('random', random);
    show('pick', !random); show('engine', !random && tgt === 'engine'); show('leg', !random && tgt === 'leg');
    show('hsys', !random && tgt === 'system'); paint('hsys', String(f.hsys));   // v0.8.0 (part 7): the family's names
    const hn = view.hydNames || HYD_NAMES.airbus;
    segOf('hsys').querySelectorAll('button').forEach((b, i) => { if (hn[i] && b.textContent !== hn[i]) b.textContent = hn[i]; });
    for (const b of el.querySelectorAll('[data-eng]')) b.classList.toggle('on', +b.dataset.eng === f.engine);
    for (const b of el.querySelectorAll('[data-tick]')) b.classList.toggle('on', ticks.has(b.dataset.tick));
    const nArmed = arm.length, nAct = act.length;
    const sub = nAct ? `${nAct} failed` : nArmed ? `${nArmed} armed` : '';
    if (o('sub').textContent !== sub) o('sub').textContent = sub;
    let text = msg, cls = msgCls;
    if (view.crashed) { text = 'Crashed: rewind or restart to arm a failure.'; cls = 'bad'; }
    else if (random && !ticks.size) { text = 'Tick at least one kind.'; cls = 'bad'; }
    const m = o('msg');
    if (m.textContent !== text) m.textContent = text;
    m.className = 'fslw-msg' + (cls ? ' ' + cls : '');
    el.querySelector('[data-a="arm"]').disabled = !!view.crashed || (random && !ticks.size);
    el.querySelector('[data-a="arm"]').textContent = random ? 'Arm random' : f.when === 'now' ? 'Fail now' : 'Arm';
  }
  function send(a) {
    const r = onapply?.(a) || { ok: true }, ok = r.ok !== false;
    msg = r.text || (ok ? 'Done.' : 'Not done.'); msgCls = ok ? 'ok' : 'bad';
    if (el.contains(document.activeElement)) document.activeElement.blur();   // the keys go back to the flight
    render();
  }
  function arm() {
    if (view?.crashed) return;
    const read = (k, d) => { const v = Number(field(k).value); return Number.isFinite(v) && v >= 0 ? v : d; };
    f.min = read('min', 0); f.sec = read('sec', 0); f.win = Math.max(1, read('win', 10));
    if (f.when === 'random') {
      if (!ticks.size) { render(); return; }
      send({ type: 'armRandom', kinds: randomKinds().filter((k) => ticks.has(k)), windowS: f.win * 60, seed: newSeed() });
    } else send({ type: 'arm', spec: specOf(f), seed: newSeed() });
  }

  const win = {
    el,
    onclose: null,
    ontab: null,
    get isOpen() { return open; },
    open() {
      if (open) return;
      open = true; el.hidden = false; msg = ''; msgCls = '';
      render();
    },
    close() {
      if (!open) return;
      open = false; el.hidden = true;
      if (el.contains(document.activeElement)) document.activeElement.blur();
      win.onclose?.();
    },
    toggle() { if (open) win.close(); else win.open(); },
    // A few times a second while open: the countdowns, and what fired.
    update() { if (open) render(); },
  };
  fillKinds();

  el.addEventListener('change', (e) => {
    const s = e.target.dataset?.sel;
    if (!s) return;
    if (s === 'kind') f.kind = e.target.value;
    if (s === 'moment') f.moment = e.target.value;
    msg = '';
    e.target.blur();   // a choice gives the keys back
    render();
  });
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    if (t.dataset.tab) { if (t.dataset.tab !== 'failures') win.ontab?.(t.dataset.tab); return; }
    if (t.dataset.eng !== undefined) { f.engine = +t.dataset.eng; msg = ''; render(); return; }
    if (t.dataset.tick) { if (ticks.has(t.dataset.tick)) ticks.delete(t.dataset.tick); else ticks.add(t.dataset.tick); msg = ''; render(); return; }
    const sg = t.closest('[data-seg]');
    if (sg) {
      const v = t.dataset.v;
      if (sg.dataset.seg === 'when') f.when = v;
      else if (sg.dataset.seg === 'system') { f.system = v; fillKinds(); }
      else if (sg.dataset.seg === 'leg') f.leg = +v;
      else if (sg.dataset.seg === 'hsys') f.hsys = +v;
      msg = ''; render(); return;
    }
    const id = Number(t.dataset.id);
    switch (t.dataset.a) {
      case 'close': win.close(); break;
      case 'arm': arm(); break;
      case 'disarm': send({ type: 'disarm', id }); break;
      case 'repair': send({ type: 'repair', id }); break;
      case 'repairAll': send({ type: 'repairAll' }); break;
      case 'disarmAll': send({ type: 'disarmAll' }); break;
    }
  });
  el.addEventListener('keydown', (e) => {
    if (!e.target.dataset?.f) return;
    if (e.key === 'Enter') { e.preventDefault(); arm(); }
  });
  // Clicks and the wheel stay in the window; buttons never take the focus (the keys stay on the flight), the fields and
  // the selects do while used. The wheel scrolls the settings.
  el.addEventListener('mousedown', (e) => { if (!e.target.closest('input, select')) e.preventDefault(); e.stopPropagation(); });
  for (const t of ['pointerdown', 'dblclick', 'contextmenu']) el.addEventListener(t, (e) => e.stopPropagation());
  el.addEventListener('wheel', (e) => { e.stopPropagation(); if (!e.target.closest('.fsfw-scroll')) e.preventDefault(); }, { passive: false });
  window.addEventListener('pointerdown', (e) => { if (open && !el.contains(e.target) && el.contains(document.activeElement)) document.activeElement.blur(); }, true);
  // Esc closes the window first (also from a field), as the Weather tab's does.
  window.addEventListener('keydown', (e) => {
    if (!open || e.key !== 'Escape' || document.body.classList.contains('in-menu')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable) && !el.contains(t)) return;
    e.preventDefault(); e.stopPropagation();
    win.close();
  }, true);

  return win;
}
