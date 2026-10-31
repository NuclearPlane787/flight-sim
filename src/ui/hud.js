// The HUD: PFD (left), ND and engine panel (right), FCU (top), drawn over the 3D view.
// createHud(root, { airports, coast? }) -> { update(view), resize(), setCoast(coast), onlaw }.
// view = { state, ap, dest: runwayEnd, timeScale, timeScaleActual, paused, waypoints?, controls? }.
// Panels redraw only when what they show changed, and at most 30 times a second.

import { hidpiCanvas, shield, locateEnd, buildCoast, changed, KT, FT, FPM, DEG, route } from './common.js';
import { createPfd } from './pfd.js';
import { createNd } from './nd.js';
import { createEnginesPanel } from './engines-panel.js';
import { createFcu } from './fcu.js';

const MIN_DT = 1000 / 30;

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
  const pfd = createPfd(pfdCv);
  const nd = createNd(ndCv, { airports, coast: coast ? buildCoast(coast) : null });
  const eng = createEnginesPanel(engCv);
  const hud = { update, resize, setCoast, setTopInset, onlaw: null, poke, el };
  const fcu = createFcu(el, hud);

  // ND range: scroll or click.
  let wheelAcc = 0;
  ndEl.addEventListener('wheel', (e) => {
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) > 40) { nd.zoom(wheelAcc > 0 ? 1 : -1); wheelAcc = 0; poke(); }
  }, { passive: false });
  ndEl.addEventListener('click', () => { nd.cycle(); poke(); });

  let view = null, last = 0, timer = 0, force = true;
  let sigP = null, sigN = null, sigE = null, destRef = null, destInfo = null;

  function setCoast(c) { nd.coast = c ? buildCoast(c) : null; force = true; schedule(); }
  function poke() { force = true; schedule(); }
  function schedule() { if (!timer) timer = setTimeout(() => { timer = 0; if (view) draw(performance.now()); }, MIN_DT); }

  function update(v) {
    view = v;
    if (!v || !v.state) return;
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
      r(st.gearPos, 50), r(st.speedbrake, 50), r(st.groundSpoilers, 50), r(st.brakes?.left, 20), r(st.brakes?.right, 20), st.parkingBrake,
      (sp.spoilersL || []).map((x) => r(x, 20)).join(), (sp.spoilersR || []).map((x) => r(x, 20)).join(),
      v.timeScale, r(v.timeScaleActual, 10), v.paused, v.controls?.spoilersArmed];
    if (force || changed(sigP, sP)) { pfd.draw(dv, now); sigP = sP; }
    if (force || changed(sigN, sN)) { nd.draw(dv); sigN = sN; }
    if (force || changed(sigE, sE)) { eng.draw(dv); sigE = sE; }
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
    const top = inset + fcuH + 16, pad = 12;
    let s = Math.max(200, Math.min(H * 0.43, W * 0.27, 560));
    const sr = Math.min(s, (H - fcuH - 16 - pad * 2 - 8) / 1.62);
    const place = (p, cv, x, y, w, h) => { Object.assign(p.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }); cv.size(w, h); };
    place(pfdEl, pfdCv, pad, top, s, s);
    place(ndEl, ndCv, W - sr - pad, top, sr, sr);
    place(engEl, engCv, W - sr - pad, top + sr + 8, sr, sr * 0.62);
    Object.assign(fcu.el.style, { top: (8 + inset) + 'px', height: fcuH + 'px', fontSize: (fcuH * 0.36) + 'px' });
    force = true;
    if (view) draw(performance.now());
  }

  window.addEventListener('resize', resize);
  resize();
  return hud;
}
