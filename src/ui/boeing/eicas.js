// The Boeings' EICAS in the engine panel's place: N1 dials with the thrust reference and the lever's
// ring, EGT (an estimate: the sim has no turbine temperature), N2 (also an estimate), fuel flow; total
// fuel and gross weight, gear, speedbrake, stab trim, parking brake and the flap indicator, with the
// detents from the type's data (A.FLAP_LEVER, A.CONFIGS). And the time-compression note the engine
// panel has. Canvas 2D, width s, height 0.62 s, same as ../engines-panel.js.
//
// v0.5.0: a design's 3, 4 or 6 engines in one row (../engine-row.js: the labels between the wings'
// engines as on a 747's, at the left with three), the dials smaller and the readouts under them; two
// engines draw exactly as before. An engine torn off its pylon (state.engines[i].off): its dials amber
// with no needle, OFF in the N1 dial, its readouts blank in amber boxes, and an amber "ENG n OFF" under
// the systems on the right.
//
// createEicas(cv) -> { draw(view), setType(def) }

import { C, font, DEG, clamp } from '../common.js';
import { createEngines } from '../../sim/engines.js';
import { engineRow, engineCountOf } from '../engine-row.js';
import { isa, RHO0 } from '../../sim/atmosphere.js';
import { thrustRefMode, refPhi, flapFraction, leverFraction, flapLabel, egtEstimate, EGT_RED, n2Estimate } from './logic.js';

// N1's arc: Boeing's, 210° from the lower left round to just past the right.
const A0 = 150 * DEG, A1 = 360 * DEG;
const N1_MAX = 110, N1_RED = 104;

export function createEicas(cv) {
  const { ctx } = cv;
  let A = null, eng = null, tdef = null;

  function setType(def) {
    tdef = def || null;
    A = def?.data || null;
    eng = A ? createEngines(A) : null;
  }

  const fmt = (v) => (v === undefined || v === null || !isFinite(v) ? '--' : String(Math.round(v / 10) * 10).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  const fit = (text, size, maxW, bold) => {
    ctx.font = font(size, bold);
    const w = ctx.measureText(text).width;
    if (w > maxW) ctx.font = font(size * maxW / w, bold);
  };
  // fit(), but never under minSize: past that, fillText squeezes the text sideways (squeezeW).
  let squeezeW = 0;
  const fitMin = (text, size, maxW, bold, minSize) => {
    ctx.font = font(size, bold);
    const w = ctx.measureText(text).width;
    squeezeW = 0;
    if (w > maxW) { const f = size * maxW / w; ctx.font = font(Math.max(minSize, f), bold); if (f < minSize) squeezeW = maxW; }
  };
  const fill = (t, x, y) => (squeezeW ? ctx.fillText(t, x, y, squeezeW) : ctx.fillText(t, x, y));

  function draw(view) {
    const s = cv.w, st = view.state, ap = view.ap || {};
    cv.begin();
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const e = st.engines || [], xL = 0.095 * s, xR = 0.335 * s, mid = 0.215 * s;
    const ambient = st.sat ?? isa(st.pos?.z || 0).T - 273.15;   // v0.4.0: the day's air

    // The thrust reference: its rating and N1 here and now, cyan, above the dials.
    const ref = refN1(st, ap);
    ctx.textAlign = 'center';
    ctx.fillStyle = C.cyan; fit(`${ref.mode} ${ref.n1.toFixed(1)}`, s * 0.034, 0.3 * s, true);
    ctx.fillText(`${ref.mode} ${ref.n1.toFixed(1)}`, mid, 0.024 * s);

    const n = engineCountOf(st, tdef);
    if (n !== 2) engineRowBlock(s, st, e, n, ref, ambient);
    else {   // two engines: v0.4.4's layout, unchanged

    // N1.
    for (let i = 0; i < 2; i++) n1Dial(s, i ? xR : xL, 0.14 * s, 0.08 * s, e[i] || {}, st, ref.n1);
    ctx.fillStyle = C.white; ctx.font = font(s * 0.03); ctx.textAlign = 'center';
    ctx.fillText('N1', mid, 0.115 * s);
    if (st.athrActive) { ctx.fillStyle = C.green; ctx.font = font(s * 0.024, true); ctx.fillText('A/T', mid, 0.15 * s); }

    // EGT, smaller.
    for (let i = 0; i < 2; i++) egtDial(s, i ? xR : xL, 0.335 * s, 0.062 * s, e[i] || {}, ambient);
    ctx.fillStyle = C.white; ctx.font = font(s * 0.026); ctx.fillText('EGT', mid, 0.325 * s);
    ctx.fillStyle = C.grey; ctx.font = font(s * 0.02); ctx.fillText('EST', mid, 0.35 * s);

    // N2 and fuel flow, in figures.
    const rowY = 0.475 * s, row2 = 0.54 * s;
    ctx.fillStyle = C.white; ctx.font = font(s * 0.026); ctx.textAlign = 'center';
    ctx.fillText('N2', mid, rowY);
    ctx.fillText('FF', mid, row2);
    ctx.fillStyle = C.grey; ctx.font = font(s * 0.018); ctx.fillText('EST', mid, rowY + 0.024 * s); ctx.fillText('KG/H', mid, row2 + 0.024 * s);
    for (let i = 0; i < 2; i++) {
      const x = i ? xR : xL, en = e[i] || {};
      const n2 = en.n2 !== undefined ? en.n2 : n2Estimate(en.n1 || 0);
      box(s, x, rowY, 0.11 * s, en.off ? '' : n2.toFixed(1), s * 0.032, C.white, en.off ? C.amber : C.frame);
      box(s, x, row2, 0.11 * s, en.off ? '' : String(Math.round(((en.ffKgS) || 0) * 3600 / 10) * 10), s * 0.032, C.white, en.off ? C.amber : C.frame);
    }
    }

    // The right-hand side: the totals, then the systems.
    const x0 = 0.455 * s, valX = 0.82 * s;
    label(s, 'TOTAL FUEL', x0, 0.03 * s); value(s, fmt(st.fuelKg), valX, 0.03 * s); units(s, 'KG', valX, 0.03 * s);
    label(s, 'GROSS WT', x0, 0.075 * s); value(s, fmt(st.mass), valX, 0.075 * s); units(s, 'KG', valX, 0.075 * s);
    gear(s, st, x0, 0.14 * s);
    speedbrake(s, st, view, x0, 0.22 * s);
    trim(s, st, x0, 0.305 * s);
    if (st.parkingBrake) {
      ctx.fillStyle = C.amber; ctx.font = font(s * 0.03, true); ctx.textAlign = 'left';
      ctx.fillText('PARKING BRAKE', x0, 0.39 * s);
    }
    flaps(s, st, 0.885 * s, 0.045 * s, 0.49 * s);
    simRate(s, view, 0.97 * s, 0.585 * s);
    // Engines torn off their pylons: an amber line each under the systems (Boeing's caution colour).
    const offs = []; e.forEach((en, i) => { if (en?.off) offs.push(i + 1); });
    if (offs.length) {
      ctx.fillStyle = C.amber; ctx.textAlign = 'left';
      const lines = offs.length > 4 ? [offs.slice(0, 3).map((i) => `ENG ${i}`).join(' ') + ' OFF', offs.slice(3).map((i) => `ENG ${i}`).join(' ') + ' OFF'] : offs.map((i) => `ENG ${i} OFF`);
      lines.forEach((t, k) => { fit(t, s * 0.03, 0.4 * s, true); ctx.fillText(t, x0, 0.435 * s + k * 0.04 * s); });
    }
  }

  // 3, 4 or 6 engines in a row (engine-row.js), each dial smaller and its readout under it, the rows
  // at two engines' heights; the labels between the wings' engines, or at the left with three.
  function engineRowBlock(s, st, e, n, ref, ambient) {
    const x0 = 0.005 * s, x1 = 0.435 * s, gap = (n >= 6 ? 0.052 : 0.07) * s;
    const row = engineRow(n, { x0, x1, gap }), w = row.w, lx = row.labelX, lw = gap - 0.006 * s;
    const r = Math.min(0.08 * s, 0.4 * w), k = r / (0.08 * s), kk = Math.max(0.6, k), rE = 0.775 * r;
    const bw = Math.min(0.11 * s, 0.9 * w), MIN = 0.022 * s;
    // The N1 dials centred where two engines' are (0.14 s), the EGT's at 0.332 s, rings and boxes included.
    // Small dials' boxes a little lower, clear of the engine's number in the dial's open quarter.
    const dropN = (1 - k) * 0.014 * s;
    const yN = 0.1325 * s + (1.16 * r + 0.008 * s * kk - (0.55 * r + 0.042 * s + dropN)) / 2;
    const yE = 0.332 * s + (1.1 * rE - (0.55 * rE + 0.042 * s)) / 2;
    const rowY = 0.475 * s, row2 = 0.54 * s;
    for (let i = 0; i < n; i++) {
      const x = row.xs[i], en = e[i] || {};
      n1Dial(s, x, yN, r, en, st, ref.n1, { kk, bx: x, by: yN + 0.55 * r + 0.022 * s + dropN, bw, min: MIN, num: i + 1 });
      egtDial(s, x, yE, rE, en, ambient, { kk, bx: x, by: yE + 0.55 * rE + 0.022 * s, bw, min: MIN });
      const n2 = en.n2 !== undefined ? en.n2 : n2Estimate(en.n1 || 0);
      box(s, x, rowY, bw, en.off ? '' : n2.toFixed(1), s * 0.032, C.white, en.off ? C.amber : C.frame, MIN);
      box(s, x, row2, bw, en.off ? '' : String(Math.round(((en.ffKgS) || 0) * 3600 / 10) * 10), s * 0.032, C.white, en.off ? C.amber : C.frame, MIN);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = C.white; fit('N1', s * 0.03, lw); ctx.fillText('N1', lx, 0.115 * s);
    if (st.athrActive) { ctx.fillStyle = C.green; fit('A/T', s * 0.024, lw, true); ctx.fillText('A/T', lx, 0.15 * s); }
    ctx.fillStyle = C.white; fit('EGT', s * 0.026, lw); ctx.fillText('EGT', lx, 0.325 * s);
    ctx.fillStyle = C.grey; fit('EST', s * 0.02, lw); ctx.fillText('EST', lx, 0.35 * s);
    ctx.fillStyle = C.white; fit('N2', s * 0.026, lw); ctx.fillText('N2', lx, rowY); fit('FF', s * 0.026, lw); ctx.fillText('FF', lx, row2);
    ctx.fillStyle = C.grey; fit('EST', s * 0.018, lw); ctx.fillText('EST', lx, rowY + 0.024 * s); fit('KG/H', s * 0.018, lw); ctx.fillText('KG/H', lx, row2 + 0.024 * s);
  }

  // The rated N1 at this altitude and Mach, from the type's engine law. Before setType there's no
  // type yet: the lever's figure stands in.
  function refN1(st, ap) {
    const mode = thrustRefMode(st, ap);
    if (!eng) return { mode, n1: st.leverN1 || 0 };
    const sigma = st.airSigma || isa(st.pos?.z || 0).rho / RHO0;
    return { mode, n1: eng.n1ForPhi(refPhi(mode, A), eng.idleN1(sigma, st.mach || 0)) };
  }

  function label(s, t, x, y) { ctx.fillStyle = C.white; ctx.font = font(s * 0.026); ctx.textAlign = 'left'; ctx.fillText(t, x, y); }
  function value(s, t, x, y) { ctx.fillStyle = C.white; ctx.font = font(s * 0.034, true); ctx.textAlign = 'right'; ctx.fillText(t, x, y); }
  function units(s, t, x, y) { ctx.fillStyle = C.grey; ctx.font = font(s * 0.02); ctx.textAlign = 'left'; ctx.fillText(t, x + 0.006 * s, y + 0.002 * s); }

  // A value in a thin box, Boeing's digital readout.
  // minSize (v0.5.0's smaller boxes): the text no smaller than that, squeezed sideways instead.
  function box(s, x, y, w, t, size, col = C.white, border = C.frame, minSize) {
    const h = 0.04 * s;
    ctx.strokeStyle = border; ctx.lineWidth = Math.max(1, s * 0.0028);
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = col; ctx.textAlign = 'center';
    if (minSize === undefined) {
      fit(t, size, w - 0.008 * s, true);
      ctx.fillText(t, x, y);
    } else { fitMin(t, size, w - 0.008 * s, true, minSize); fill(t, x, y); }
  }

  // A dial: the white arc, the filled sector up to the value, the needle, the red line.
  function arcDial(s, x, y, r, frac, redFrac, needleCol) {
    const a = (f) => A0 + clamp(f, 0, 1) * (A1 - A0);
    ctx.fillStyle = 'rgba(190,200,210,0.26)';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, A0, a(frac)); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.3, s * 0.0035);
    ctx.beginPath(); ctx.arc(x, y, r, A0, a(redFrac)); ctx.stroke();
    ctx.strokeStyle = C.red; ctx.beginPath(); ctx.arc(x, y, r, a(redFrac), A1); ctx.stroke();
    const ar = a(redFrac);
    ctx.lineWidth = Math.max(1.8, s * 0.005);
    ctx.beginPath(); ctx.moveTo(x + Math.cos(ar) * r * 0.86, y + Math.sin(ar) * r * 0.86); ctx.lineTo(x + Math.cos(ar) * r * 1.1, y + Math.sin(ar) * r * 1.1); ctx.stroke();
    ctx.strokeStyle = needleCol; ctx.lineWidth = Math.max(2, s * 0.006);
    const an = a(frac);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(an) * r * 1.02, y + Math.sin(an) * r * 1.02); ctx.stroke();
  }

  // L (3, 4 or 6 engines): { kk, the marks' scale; bx, by, bw, the readout box; min, its least text
  // size; num, the engine's number }. Without it, two engines' dial exactly as before.
  function n1Dial(s, x, y, r, e, st, refN, L) {
    const F = (n) => clamp(n, 0, N1_MAX) / N1_MAX;
    const a = (n) => A0 + F(n) * (A1 - A0);
    const n1 = e.n1 || 0;
    if (L?.num) { ctx.fillStyle = e.off ? C.amber : C.grey; ctx.font = font(s * 0.02); ctx.textAlign = 'center'; ctx.fillText(String(L.num), x + 0.62 * r, y + 0.3 * r); }
    if (e.off) { offDial(s, x, y, r, L, true); return; }
    arcDial(s, x, y, r, F(n1), F(N1_RED), C.white);
    // The scale's marks, numbered at 0 and 10 (×10 %), as on the real one.
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1, s * 0.0028);
    for (const n of [0, 20, 40, 60, 80, 100]) {
      const an = a(n);
      ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * r * 0.88, y + Math.sin(an) * r * 0.88); ctx.lineTo(x + Math.cos(an) * r, y + Math.sin(an) * r); ctx.stroke();
    }
    // The commanded N1: a white arc outside the scale, from the present to the target, while they differ.
    if (e.n1Target !== undefined && Math.abs(e.n1Target - n1) > 1) {
      ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.5, s * 0.004);
      ctx.beginPath(); ctx.arc(x, y, r * 1.08, Math.min(a(n1), a(e.n1Target)), Math.max(a(n1), a(e.n1Target))); ctx.stroke();
    }
    // The thrust reference: a cyan bar across the scale.
    const ar = a(refN);
    ctx.strokeStyle = C.cyan; ctx.lineWidth = Math.max(2, s * 0.006);
    ctx.beginPath(); ctx.moveTo(x + Math.cos(ar) * r * 0.82, y + Math.sin(ar) * r * 0.82); ctx.lineTo(x + Math.cos(ar) * r * 1.1, y + Math.sin(ar) * r * 1.1); ctx.stroke();
    // The lever's target: v0.2.2's cyan ring, at the N1 the lever asks for here and now.
    if (st.leverN1 > 0) {
      const tl = a(st.leverN1);
      ctx.lineWidth = Math.max(1.5, s * 0.004);
      ctx.beginPath(); ctx.arc(x + Math.cos(tl) * r * 1.16, y + Math.sin(tl) * r * 1.16, L ? s * 0.008 * L.kk : s * 0.008, 0, Math.PI * 2); ctx.stroke();
    }
    if (L) box(s, L.bx, L.by, L.bw, n1.toFixed(1), s * 0.034, n1 > N1_RED ? C.red : C.white, C.frame, L.min);
    else box(s, x + 0.012 * s, y + 0.054 * s, 0.09 * s, n1.toFixed(1), s * 0.034, n1 > N1_RED ? C.red : C.white);
    // The reversers: amber while they move, green when they're out.
    if ((e.rev || 0) > 0.02) {
      ctx.fillStyle = e.rev > 0.98 ? C.green : C.amber; ctx.font = font(s * 0.028, true); ctx.textAlign = 'center';
      if (L) fit('REV', s * 0.028 * L.kk, 1.6 * r, true);
      ctx.fillText('REV', x, y - r * 0.45);
    }
  }

  // An engine torn off: the scale amber, no sector, needle or markers; OFF in the N1 dial; the
  // readout box blank in amber.
  function offDial(s, x, y, r, L, isN1) {
    const kk = L?.kk ?? 1;
    ctx.strokeStyle = C.amber; ctx.lineWidth = Math.max(1.3, s * 0.0035);
    ctx.beginPath(); ctx.arc(x, y, r, A0, A1); ctx.stroke();
    if (isN1) {
      ctx.fillStyle = C.amber; ctx.textAlign = 'center';
      fit('OFF', s * 0.032 * kk, 1.5 * r, true); ctx.fillText('OFF', x, y - r * 0.25);
    }
    if (L) box(s, L.bx, L.by, L.bw, '', s * 0.03, C.white, C.amber, L.min);
    else if (isN1) box(s, x + 0.012 * s, y + 0.054 * s, 0.09 * s, '', s * 0.034, C.white, C.amber);
    else box(s, x + 0.012 * s, y + 0.042 * s, 0.075 * s, '', s * 0.03, C.white, C.amber);
  }

  function egtDial(s, x, y, r, e, ambient, L) {
    if (e.off) { offDial(s, x, y, r, L, false); return; }
    const egt = egtEstimate(e.n1 || 0, ambient), MAX = 1100;
    arcDial(s, x, y, r, clamp(egt, 0, MAX) / MAX, EGT_RED / MAX, C.white);
    if (L) box(s, L.bx, L.by, L.bw, String(Math.round(egt)), s * 0.03, C.white, C.frame, L.min);
    else box(s, x + 0.012 * s, y + 0.042 * s, 0.075 * s, String(Math.round(egt)), s * 0.03);
  }

  // The gear: Boeing's three words in one, DOWN in a green box, UP in white, slashes in transit.
  function gear(s, st, x0, y) {
    label(s, 'GEAR', x0, y);
    const g = st.gearPos ?? 1, x = x0 + 0.18 * s, w = 0.13 * s, h = 0.042 * s;
    if (g > 0.99) box(s, x, y, w, 'DOWN', s * 0.032, C.green, C.green);
    else if (g < 0.01) box(s, x, y, w, 'UP', s * 0.032, C.white, C.frame);
    else {
      ctx.save(); ctx.beginPath(); ctx.rect(x - w / 2, y - h / 2, w, h); ctx.clip();
      ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.2, s * 0.003); ctx.beginPath();
      for (let k = -h; k < w + h; k += 0.02 * s) { ctx.moveTo(x - w / 2 + k, y + h / 2); ctx.lineTo(x - w / 2 + k + h, y - h / 2); }
      ctx.stroke(); ctx.restore();
      ctx.strokeStyle = C.white; ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    }
  }

  function speedbrake(s, st, view, x0, y) {
    label(s, 'SPD BRK', x0, y);
    const gsp = st.groundSpoilers || 0, sb = st.speedbrake || 0, v = Math.max(gsp, sb);
    const x = x0 + 0.115 * s, w = 0.13 * s, h = 0.022 * s;
    ctx.strokeStyle = C.frame; ctx.lineWidth = Math.max(1, s * 0.0028); ctx.strokeRect(x, y - h / 2, w, h);
    if (v > 0.01) { ctx.fillStyle = gsp > 0.05 ? C.green : C.amber; ctx.fillRect(x + 1, y - h / 2 + 1, (w - 2) * clamp(v, 0, 1), h - 2); }
    ctx.textAlign = 'left'; ctx.font = font(s * 0.024, true);
    if (gsp > 0.05) { ctx.fillStyle = C.green; ctx.fillText('UP', x + w + 0.012 * s, y); }
    else if (view.controls?.spoilersArmed) { ctx.fillStyle = C.green; ctx.fillText('ARM', x + w + 0.012 * s, y); }
  }

  // The stab trim, on a scale from the type's limits, in degrees: nose down to the left.
  function trim(s, st, x0, y) {
    label(s, 'STAB', x0, y);
    const x = x0 + 0.115 * s, w = 0.13 * s;
    const stab = (st.surfaces?.stab || 0) / DEG;
    const lo = A ? -A.THS_DN / DEG : -4, hi = A ? A.THS_UP / DEG : 13.5;
    const px = x + (clamp(stab, lo, hi) - lo) / (hi - lo) * w;
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.2, s * 0.003);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y);
    const z = x + (0 - lo) / (hi - lo) * w;
    ctx.moveTo(z, y - 0.01 * s); ctx.lineTo(z, y + 0.01 * s); ctx.stroke();
    ctx.fillStyle = C.green; ctx.beginPath(); ctx.moveTo(px, y - 0.002 * s); ctx.lineTo(px - 0.012 * s, y - 0.02 * s); ctx.lineTo(px + 0.012 * s, y - 0.02 * s); ctx.closePath(); ctx.fill();
    ctx.font = font(s * 0.018); ctx.fillStyle = C.grey;
    ctx.textAlign = 'left'; ctx.fillText('DN', x, y + 0.019 * s);
    ctx.textAlign = 'right'; ctx.fillText('UP', x + w, y + 0.019 * s);
    ctx.fillStyle = C.white; ctx.font = font(s * 0.026, true); ctx.textAlign = 'left';
    ctx.fillText(Math.abs(stab).toFixed(1), x + w + 0.012 * s, y);
  }

  // The flap indicator: a vertical scale, UP at the top, one tick per detent of the type's lever,
  // numbered at those the 6–0 keys reach. The white bar is the surfaces; the magenta line, the lever.
  function flaps(s, st, x, top, h) {
    if (!A || !A.FLAP_LEVER || !A.CONFIGS) return;
    const w = 0.03 * s, L = A.FLAP_LEVER, n = L.length - 1;
    ctx.fillStyle = C.white; ctx.font = font(s * 0.022); ctx.textAlign = 'center';
    ctx.fillText('FLAPS', x + 0.02 * s, top - 0.018 * s);
    const y0 = top + 0.016 * s, H = h - 0.05 * s;
    const f = flapFraction(A, st), lv = leverFraction(A, st);
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.1, s * 0.0028);
    ctx.strokeRect(x - w / 2, y0, w, H);
    if (f > 0.002) { ctx.fillStyle = C.white; ctx.fillRect(x - w / 2, y0, w, H * f); }
    const keys = new Set(A.FLAP_KEYS || []);
    ctx.font = font(s * 0.021); ctx.textAlign = 'left';
    for (let i = 0; i <= n; i++) {
      const y = y0 + H * i / n, named = keys.has(i);
      ctx.strokeStyle = C.white;
      ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2 + (named ? 0.012 : 0.006) * s, y); ctx.stroke();
      if (named) { ctx.fillStyle = C.white; ctx.fillText(L[i], x + w / 2 + 0.016 * s, y); }
    }
    ctx.strokeStyle = C.magenta; ctx.lineWidth = Math.max(2, s * 0.005);
    const yl = y0 + H * lv;
    ctx.beginPath(); ctx.moveTo(x - w / 2 - 0.008 * s, yl); ctx.lineTo(x + w / 2, yl); ctx.stroke();
    const lab = flapLabel(A, st);
    ctx.fillStyle = lab.moving ? C.magenta : C.green; ctx.font = font(s * 0.034, true); ctx.textAlign = 'center';
    ctx.fillText(lab.text, x + 0.012 * s, y0 + H + 0.028 * s);
  }

  // Time compression, as the engine panel shows it.
  function simRate(s, view, x, y) {
    ctx.textAlign = 'right'; ctx.font = font(s * 0.03, true);
    if (view.paused) { ctx.fillStyle = C.amber; ctx.fillText('PAUSED', x, y); return; }
    const ts = view.timeScale || 1, ta = view.timeScaleActual ?? ts;
    if (ts === 1 && Math.abs(ta - 1) < 0.05) return;
    const short = Math.abs(ta - ts) > 0.05 * ts;
    ctx.fillStyle = short ? C.amber : C.green;
    ctx.fillText(short ? `SIM RATE ${ts}× (${ta.toFixed(1)}×)` : `SIM RATE ${ts}×`, x, y);
  }

  return { draw, setType };
}
