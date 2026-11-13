// The HUD: PFD (left), ND and engine panel (right), FCU (top), drawn over the 3D view, and
// the view switch (top right).
// createHud(root, { airports, coast? }) -> { update(view), resize(), setCoast(coast), setType(def), onlaw, onview }.
// setType(def) swaps the four panels for the type's family: the Boeings' (src/ui/boeing/) in the same
// places and on the same 30 Hz redraw, or the Airbus's, which are what the HUD starts with. Only one
// set draws; the Boeing set is made the first time a Boeing is flown.
// view = { state, ap, dest: runwayEnd, timeScale, timeScaleActual, paused, waypoints?, controls?, viewId? }.
// Panels redraw only when what they show changed, and at most 30 times a second.

import { hidpiCanvas, shield, locateEnd, buildCoast, changed, KT, FT, FPM, DEG, route } from './common.js';
import { createPfd } from './pfd.js';
import { createNd } from './nd.js';
import { createEnginesPanel } from './engines-panel.js';
import { createFcu } from './fcu.js';
import { createBoeingPfd } from './boeing/pfd.js';
import { createBoeingNd } from './boeing/nd.js';
import { createEicas } from './boeing/eicas.js';
import { createMcp } from './boeing/mcp.js';
import * as store from '../store.js';

const MIN_DT = 1000 / 30;

// The view switch (v0.2.1). Shane: "Have an easy way to transfer between a cockpit view, a
// nose view, and a third person view, maybe a switch somewhere." [view, key, label, tooltip]
const VIEW_BUTTONS = [
  ['cockpit', '1', 'Cockpit', "Cockpit (1): the captain's seat. Press it again for the first officer's, and again to swap back"],
  ['nose', '2', 'Nose', 'Nose (2)'],
  ['orbit', '3', '3rd person', '3rd person (3): drag to orbit, pinch to zoom'],
];

export function createHud(root, { airports, coast } = {}) {
  const el = document.createElement('div');
  el.className = 'fsui-hud';
  root.appendChild(el);

  const mkPanel = (cls) => {
    const p = document.createElement('div');
    p.className = 'fsui-panel fsui-screen ' + cls;
    el.appendChild(p);
    shield(p);
    p.addEventListener('mousedown', (e) => e.preventDefault()); // keep keyboard focus where it is
    return p;
  };
  const pfdEl = mkPanel('fsui-pfd'), ndEl = mkPanel('fsui-nd'), engEl = mkPanel('fsui-eng');
  ndEl.title = 'Scroll or click to change the range';
  const pfdCv = hidpiCanvas(pfdEl), ndCv = hidpiCanvas(ndEl), engCv = hidpiCanvas(engEl);
  const builtCoast = coast ? buildCoast(coast) : null;
  const hud = { update, resize, setCoast, setTopInset, setType, onlaw: null, onview: null, poke, el };
  const airbus = {
    pfd: createPfd(pfdCv),
    nd: createNd(ndCv, { airports, coast: builtCoast }),
    eng: createEnginesPanel(engCv),
    fcu: createFcu(el, hud),
  };
  let boeing = null;      // made on the first setType to a Boeing
  let pfd = airbus.pfd, nd = airbus.nd, eng = airbus.eng, fcu = airbus.fcu, isBoeing = false;

  // The view switch, level with the FCU at the top right. In a seat, Cockpit shows which one
  // (CPT or F/O), and pressing it again swaps seats. Clicks go to main.js → selectView.
  const views = document.createElement('div');
  views.className = 'fsui-views fsui-panel';
  views.innerHTML = VIEW_BUTTONS.map(([v, key, label, tip]) =>
    `<button data-v="${v}" title="${tip}" tabindex="-1"><kbd>${key}</kbd><span class="fsui-vl">${label}</span><span class="fsui-seat"></span></button>`).join('');
  el.appendChild(views);
  shield(views);
  views.addEventListener('mousedown', (e) => e.preventDefault()); // keep keyboard focus where it is
  views.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && hud.onview) hud.onview(b.dataset.v); });
  // v0.4.4 (Shane: "a switch on screen ... that hides the left and right big panels, but not the top
  // panels"): top left, level with the FCU. Hides the PFD, the ND and the engine panel (EICAS), not the
  // FCU (MCP) or the view switch; kept in the settings, so a reload keeps the wide view.
  const panelsBox = document.createElement('div');
  panelsBox.className = 'fsui-panels-box fsui-panel';
  panelsBox.innerHTML = '<button class="fsui-panels-btn" tabindex="-1"></button>';
  el.appendChild(panelsBox);
  shield(panelsBox);
  const panelsBtn = panelsBox.firstChild;
  let panelsHidden = !!(store.load('settings', {}) || {}).hidePanels;
  function showPanels() {
    for (const p of [pfdEl, ndEl, engEl]) p.style.visibility = panelsHidden ? 'hidden' : '';
    panelsBtn.classList.toggle('on', !panelsHidden);
    panelsBtn.textContent = panelsHidden ? 'Show panels' : 'Hide panels';
    panelsBtn.title = panelsHidden ? 'Show the PFD, the ND and the engine panel again'
      : 'Hide the PFD, the ND and the engine panel for a wide view (the top panels stay)';
  }
  panelsBox.addEventListener('mousedown', (e) => e.preventDefault()); // keep keyboard focus where it is
  panelsBtn.addEventListener('click', () => {
    panelsHidden = !panelsHidden;
    store.save('settings', { ...(store.load('settings', {}) || {}), hidePanels: panelsHidden });
    showPanels();
    poke();
  });
  showPanels();

  let shownView = '';
  function showView(id) {
    if (!id || id === shownView) return;
    shownView = id;
    const seat = id === 'captain' || id === 'fo';
    for (const b of views.children) b.classList.toggle('on', b.dataset.v === (seat ? 'cockpit' : id));
    views.querySelector('[data-v="cockpit"] .fsui-seat').textContent = seat ? (id === 'fo' ? 'F/O' : 'CPT') : '';
    placeViews();     // the seat's label makes it wider
  }

  // ND range: scroll or click.
  let wheelAcc = 0;
  ndEl.addEventListener('wheel', (e) => {
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) > 40) { nd.zoom(wheelAcc > 0 ? 1 : -1); wheelAcc = 0; poke(); }
  }, { passive: false });
  ndEl.addEventListener('click', () => { nd.cycle(); poke(); });

  let view = null, last = 0, timer = 0, force = true;
  let sigP = null, sigN = null, sigE = null, destRef = null, destInfo = null;

  function setCoast(c) {
    const b = c ? buildCoast(c) : null;
    airbus.nd.coast = b; if (boeing) boeing.nd.coast = b;
    force = true; schedule();
  }

  // Swap the panels for a type's family (a registry entry; null or an unknown family is the Airbus's).
  function setType(def) {
    const toBoeing = def?.family === 'boeing';
    if (toBoeing && !boeing) {
      boeing = {
        pfd: createBoeingPfd(pfdCv),
        nd: createBoeingNd(ndCv, { airports, coast: airbus.nd.coast }),
        eng: createEicas(engCv),
        fcu: createMcp(el, hud),
      };
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => placeViews()).observe(boeing.fcu.el);
    }
    if (toBoeing) { boeing.pfd.setType(def); boeing.eng.setType(def); } else airbus.eng.setType(def);
    if (toBoeing === isBoeing) { poke(); return; }
    const next = toBoeing ? boeing : airbus, was = fcu;
    next.nd.setRange(nd.range);        // the range the pilot chose stays
    was.close();                       // a window being typed into closes unchanged
    was.el.style.display = 'none'; next.fcu.el.style.display = '';
    pfd = next.pfd; nd = next.nd; eng = next.eng; fcu = next.fcu; isBoeing = toBoeing;
    sigP = sigN = sigE = null;
    resize();
  }
  function poke() { force = true; schedule(); }
  function schedule() { if (!timer) timer = setTimeout(() => { timer = 0; if (view) draw(performance.now()); }, MIN_DT); }

  function update(v) {
    view = v;
    if (!v || !v.state) return;
    showView(v.viewId);
    const now = performance.now();
    pfd.update(v, now);
    if (now - last < MIN_DT) { schedule(); return; }
    draw(now);
  }

  function draw(now) {
    last = now;
    const v = view, st = v.state, ap = v.ap || {};
    if (v.dest !== destRef) { destRef = v.dest; destInfo = locateEnd(airports, v.dest); }
    const dv = { ...v, destInfo };
    const r = (x, k = 1) => Math.round((x || 0) * k);
    const w = st.warnings || {};
    const sp = st.surfaces || {};
    const boxTick = Math.floor(now / 400); // the FMA's 10 s boxes and the AP OFF flash
    const sP = [
      r(st.ias * KT, 10), r(st.pos.z * FT), r(st.pitch / DEG, 20), r(st.roll / DEG, 10), r(st.hdg / DEG, 10), r(st.vs * FPM, 0.1),
      r(st.agl * FT), r(st.beta / DEG, 5), r(st.mach, 100), r(st.vls), r(st.vmax), r(st.valphaProt), r(st.valphaMax), r(st.vsw), r(st.vfeNext),
      st.onGround ? 1 : 0, st.law === 'normal' || !st.law ? 0 : 1, r(st.pos.x, 0.05), r(st.pos.y, 0.05), r(st.vel.x), r(st.vel.y),
      ap.ap ? 1 : 0, ap.athr ? 1 : 0, ap.spdKt, ap.hdgDeg, ap.altFt, ap.vsFpm, ap.vertical, ap.lateral, ap.thrustMode, st.detent, st.flapLever,
      w.stall, w.overspeed, w.pullUp, w.sinkRate, w.tooLowGear, w.apDisc, st.crashed, v.dest, boxTick, r(st.groundH),
    ];
    const sN = [r(st.pos.x, 0.02), r(st.pos.y, 0.02), r(st.hdg / DEG, 5), r(st.gs * KT), r(st.tas * KT), r(st.vel.x), r(st.vel.y),
      ap.ap ? 1 : 0, ap.hdgDeg, v.dest, route.version, v.waypoints, st.onGround ? 1 : 0, Math.floor(now / 2000),
      v.taxiRoute ? v.taxiRoute.length : 0];
    const e0 = st.engines?.[0] || {}, e1 = st.engines?.[1] || {};
    const sE = [r(e0.n1, 10), r(e1.n1, 10), r(e0.n1Target), r(e1.n1Target), r(e0.ffKgS, 360), r(e1.ffKgS, 360), r(e0.rev, 50), r(e1.rev, 50),
      r(st.fuelKg, 0.1), r(st.mass, 0.1), r(st.cgMac, 1000), r(st.thrustLever, 100), st.detent, st.config, r(st.slatDeg, 2), r(st.flapDeg, 2),
      st.athrActive ? 1 : 0, r(st.leverN1, 5),
      r(st.gearPos, 50), r(st.speedbrake, 50), r(st.groundSpoilers, 50), r(st.brakes?.left, 20), r(st.brakes?.right, 20), st.parkingBrake,
      (sp.spoilersL || []).map((x) => r(x, 20)).join(), (sp.spoilersR || []).map((x) => r(x, 20)).join(),
      v.timeScale, r(v.timeScaleActual, 10), v.paused, v.controls?.spoilersArmed];
    // v0.5.0: engines 3 to 6, and any engine torn off (a design's): their changes redraw the panel too.
    const en = st.engines || [];
    if (en.length !== 2 || en.some((e) => e.off)) sE.push(en.map((e) => `${r(e.n1, 10)},${r(e.n1Target)},${r(e.ffKgS, 360)},${r(e.rev, 50)},${e.off ? 1 : 0}`).join('|'));
    // What only the Boeing screens show (their FMA's armed modes, the tape's speeds, the stab trim).
    if (isBoeing) {
      sP.push(st.autoTrim ? 0 : r(st.vRef), r(st.vmm), r(st.vStick), r(st.pliDeg, 5), st.shaker, ap.armedLateral, ap.armedVertical, r(st.flapDeg), r(st.slatDeg));
      sE.push(r(sp.stab, 500), ap.thrustMode, ap.lateral, ap.vertical, st.onGround ? 1 : 0, r(st.vs * FPM, 0.01), st.flapLever, r(st.pos.z, 0.01), r(st.mach, 100));
    }
    if (!panelsHidden) {          // hidden, they aren't drawn; showing them again pokes a full draw
      if (force || changed(sigP, sP)) { pfd.draw(dv, now); sigP = sP; }
      if (force || changed(sigN, sN)) { nd.draw(dv); sigN = sN; }
      if (force || changed(sigE, sE)) { eng.draw(dv); sigE = sE; }
    }
    fcu.update(v);
    force = false;
  }

  // The top `inset` px belong to the performance readout while it shows (main.js).
  let inset = 0;
  function setTopInset(px) { if (px !== inset) { inset = px; resize(); } }

  // Layout: panel size s from the window, PFD left, ND and engine panel right, FCU top.
  function resize() {
    const W = window.innerWidth, H = window.innerHeight - inset;
    const fcuH = Math.max(38, Math.min(56, H * 0.052));
    const pad = 12;
    Object.assign(fcu.el.style, { top: (8 + inset) + 'px', height: fcuH + 'px', fontSize: (fcuH * 0.36) + 'px' });
    // The MCP has more on it than the FCU: on a narrow window its text comes down until it fits. It's
    // also wide enough to reach over the panels, so they start under it, its padding included.
    if (isBoeing) {
      const room = W - 2 * pad, w = fcu.el.scrollWidth;
      if (w > room) fcu.el.style.fontSize = (fcuH * 0.36 * room / w) + 'px';
    }
    const top = isBoeing ? inset + 8 + fcu.el.offsetHeight + 6 : inset + fcuH + 16;
    const s = Math.max(200, Math.min(H * 0.43, W * 0.27, 560));
    lay = { W, H, s, top, pad, fcuH };
    // The view switch and the panels switch: the same box as the FCU's (fcuH inside, the FCU's 0.35em above and below).
    const padY = 0.35 * fcuH * 0.36;
    const box = { top: (8 + inset) + 'px', height: fcuH + 'px', padding: `${padY}px 0.45em`, fontSize: (fcuH * 0.33) + 'px' };
    Object.assign(views.style, box, { right: pad + 'px' });
    Object.assign(panelsBox.style, box, { left: pad + 'px' });
    placeViews();
  }
  const place = (p, cv, x, y, w, h) => {
    const k = [x, y, w, h].map(Math.round).join();
    if (p._at === k) return;
    p._at = k;
    Object.assign(p.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }); cv.size(w, h);
  };
  // The corners, level with the FCU: the view switch right of it, without its key caps if that's too
  // tight; the panels switch left of it. One that still runs into the FCU (the MCP on a narrow window,
  // or the seat's label in the cockpit) goes just under the top row in its own corner, and the panels
  // on that side start under it: v0.4.4, Shane: "When in cockpit view, still keep the view change
  // panel in the top right instead of bottom center." Again whenever the FCU's width changes (its LAW
  // label fills in after the first frame), a font arrives, or the seat's label changes.
  let lay = null;
  function placeViews() {
    if (!lay) return;
    const { W, H, s, top, pad } = lay;
    const fr = fcu.el.getBoundingClientRect();
    views.classList.remove('compact', 'under'); panelsBox.classList.remove('under');
    views.style.top = panelsBox.style.top = (8 + inset) + 'px';
    const clearR = () => views.getBoundingClientRect().left >= fr.right + 10;
    const clearL = () => panelsBox.getBoundingClientRect().right <= fr.left - 10;
    const vFont = lay.fcuH * 0.33, below = Math.max(top, fr.bottom + 6);
    views.style.fontSize = vFont + 'px';
    if (!clearR()) {
      views.classList.add('compact');
      if (!clearR()) {   // a smaller font first (to 72%), so it stays in the top row
        const k = ((W - pad) - (fr.right + 10)) / views.getBoundingClientRect().width;
        if (k >= 0.72) views.style.fontSize = (vFont * k * 0.97) + 'px';
        if (!clearR()) { views.style.fontSize = vFont + 'px'; views.classList.add('under'); views.style.top = below + 'px'; }
      }
    }
    if (!clearL()) { panelsBox.classList.add('under'); panelsBox.style.top = below + 'px'; }
    // The side panels start under their corner's switch (the A321's used to tuck 6 px under the view switch).
    const rTop = Math.max(top, views.getBoundingClientRect().bottom + 6), lTop = Math.max(top, panelsBox.getBoundingClientRect().bottom + 6);
    const sr = Math.min(s, (H - (rTop - inset) - pad * 2 - 8) / 1.62);
    place(pfdEl, pfdCv, pad, lTop, s, s);
    place(ndEl, ndCv, W - sr - pad, rTop, sr, sr);
    place(engEl, engCv, W - sr - pad, rTop + sr + 8, sr, sr * 0.62);
    force = true;
    if (view) draw(performance.now());
  }

  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => placeViews()).observe(airbus.fcu.el);
  document.fonts?.addEventListener?.('loadingdone', () => placeViews());
  resize();
  return hud;
}
