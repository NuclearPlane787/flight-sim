// The engine panel (an E/WD and wheel page in one): N1 dials with the thrust lever
// marker, fuel flow, fuel on board and per tank, flaps and slats with the config,
// gear, speed brakes and ground spoilers, brakes, and the time-compression rate.
// Canvas 2D, width s, height 0.62 s.
//
// The lever marker (the cyan ring) is at the N1 the lever asks for here and now (the sim's
// state.leverN1), so the needle settles on it. Since v0.2.2 the A/THR moves the lever, and the
// ring with it; "A/THR" shows between the dials while it does.
//
// v0.5.0: a design's 3, 4 or 6 engines in one row (engine-row.js: the labels between the wings'
// engines, or at the left with three), each dial smaller with its readout under it; two engines draw
// exactly as before. An engine torn off its pylon (state.engines[i].off) shows amber: the dial with no
// needle, OFF in it, XX for its readouts.
//
// createEnginesPanel(cv) -> { draw(view), setType(def) }

import { C, font, DEG, clamp } from './common.js';
import { engineRow, engineCountOf } from './engine-row.js';

// Thrust lever position (−1…1) to the N1 it commands at take-off conditions, for a state
// without leverN1 (the dev pages' mocks). Rough LEAP-1A values: IDLE ~20 %, CL ~89 %,
// FLX/MCT ~95 %, TOGA ~101 %.
function tlaN1(l) {
  if (l <= 0) return 20;
  const pts = [[0, 20], [25 / 45, 89], [35 / 45, 95], [1, 101]];
  for (let i = 1; i < pts.length; i++) {
    if (l <= pts[i][0]) { const [a, na] = pts[i - 1], [b, nb] = pts[i]; return na + (nb - na) * (l - a) / (b - a); }
  }
  return 101;
}

const SLATS = [0, 18, 22, 27];        // A321: slats 0, 1, 2/3, FULL (deg)
const FLAPS = [0, 10, 14, 21, 25];    // A321: flaps 0, 1+F, 2, 3, FULL (deg)
const CONF_TARGET = { '0': [0, 0], '1': [18, 0], '1+F': [18, 10], '2': [22, 14], '3': [22, 21], FULL: [27, 25] };

export function createEnginesPanel(cv) {
  const { ctx } = cv;
  let def = null;
  function setType(d) { def = d || null; }

  function draw(view) {
    const s = cv.w, st = view.state;
    cv.begin();
    ctx.textBaseline = 'middle';
    const eng = st.engines || [], n = engineCountOf(st, def);
    if (n !== 2) engineRowBlock(s, st, eng, n);
    else {
    // N1 dials.
    for (let i = 0; i < 2; i++) dial(s, 0.135 * s + i * 0.25 * s, 0.135 * s, 0.095 * s, eng[i] || {}, st, i);
    ctx.fillStyle = C.white; ctx.font = font(s * 0.032); ctx.textAlign = 'center';
    ctx.fillText('N1', 0.26 * s, 0.13 * s); ctx.fillStyle = C.cyan; ctx.font = font(s * 0.026); ctx.fillText('%', 0.26 * s, 0.165 * s);
    // Thrust lever detent (cyan) between the dials, or A/THR while it moves the lever.
    ctx.fillStyle = C.cyan; ctx.font = font(s * 0.034, true);
    ctx.fillText(st.athrActive ? 'A/THR' : st.detent || '', 0.26 * s, 0.03 * s);
    // Fuel flow under the dials.
    ctx.font = font(s * 0.04); ctx.fillStyle = C.green;
    for (let i = 0; i < 2; i++) {
      if (eng[i]?.off) { ctx.fillStyle = C.amber; ctx.fillText('XX', 0.135 * s + i * 0.25 * s, 0.29 * s); ctx.fillStyle = C.green; continue; }
      ctx.fillText(String(Math.round(((eng[i]?.ffKgS) || 0) * 3600 / 20) * 20), 0.135 * s + i * 0.25 * s, 0.29 * s);
    }
    ctx.fillStyle = C.white; ctx.font = font(s * 0.028); ctx.fillText('FF', 0.26 * s, 0.278 * s);
    ctx.fillStyle = C.cyan; ctx.font = font(s * 0.022); ctx.fillText('KG/H', 0.26 * s, 0.305 * s);
    }

    // Fuel on board and per tank.
    const fx = 0.56 * s;
    ctx.textAlign = 'left'; ctx.fillStyle = C.white; ctx.font = font(s * 0.032);
    ctx.fillText('FOB', fx, 0.04 * s);
    ctx.fillStyle = C.green; ctx.font = font(s * 0.046);
    ctx.fillText(fmt(st.fuelKg), fx + 0.08 * s, 0.04 * s);
    ctx.fillStyle = C.cyan; ctx.font = font(s * 0.026); ctx.fillText('KG', fx + 0.27 * s, 0.045 * s);
    const f = st.fuel || {};
    const tank = (t, v, x) => {
      ctx.textAlign = 'center'; ctx.fillStyle = C.white; ctx.font = font(s * 0.026); ctx.fillText(t, x, 0.085 * s);
      ctx.fillStyle = C.green; ctx.font = font(s * 0.034); ctx.fillText(fmt(v), x, 0.115 * s);
    };
    tank('L', f.left, fx + 0.05 * s); tank('CTR', f.center, fx + 0.2 * s); tank('R', f.right, fx + 0.35 * s);
    ctx.textAlign = 'left'; ctx.fillStyle = C.white; ctx.font = font(s * 0.028);
    ctx.fillText('GW', fx, 0.16 * s); ctx.fillStyle = C.green; ctx.font = font(s * 0.034);
    ctx.fillText(fmt(st.mass), fx + 0.07 * s, 0.16 * s);
    ctx.fillStyle = C.white; ctx.font = font(s * 0.028); ctx.fillText('CG', fx + 0.25 * s, 0.16 * s);
    ctx.fillStyle = C.green; ctx.font = font(s * 0.034);
    ctx.fillText(st.cgMac !== undefined ? (st.cgMac * (st.cgMac < 1 ? 100 : 1)).toFixed(1) + '%' : '--', fx + 0.31 * s, 0.16 * s);

    flaps(s, st, fx, 0.235 * s);
    gear(s, st, 0.03 * s, 0.4 * s);
    spoilers(s, st, view, 0.34 * s, 0.4 * s);
    brakes(s, st, 0.72 * s, 0.4 * s);
    simRate(s, view, 0.97 * s, 0.595 * s);
  }

  const fmt = (v) => (v === undefined || v === null || !isFinite(v) ? '--' : String(Math.round(v / 10) * 10).replace(/\B(?=(\d{3})+(?!\d))/g, ','));

  function dial(s, x, y, r, e, st, i) {
    const a0 = 135 * DEG, a1 = 360 * DEG;
    const A = (n) => a0 + clamp(n, 0, 110) / 110 * (a1 - a0);
    if (e.off) { offDial(s, x, y, r, 1, { x: x - 0.005 * s, y: y + 0.02 * s, w: 0.1 * s, h: 0.05 * s, size: s * 0.04 }); return; }
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.5, s * 0.004);
    ctx.beginPath(); ctx.arc(x, y, r, a0, A(104)); ctx.stroke();
    ctx.strokeStyle = C.red; ctx.beginPath(); ctx.arc(x, y, r, A(104), a1); ctx.stroke();
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1, s * 0.003);
    ctx.fillStyle = C.white; ctx.font = font(s * 0.024); ctx.textAlign = 'center';
    for (const n of [20, 40, 60, 80, 100]) {
      const a = A(n);
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.86, y + Math.sin(a) * r * 0.86); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.stroke();
      if (n === 50 || n === 100 || n === 20 || n === 60) ctx.fillText(String(n / 10), x + Math.cos(a) * r * 0.68, y + Math.sin(a) * r * 0.68);
    }
    const n1 = e.n1 || 0;
    // Commanded N1 (cyan arc from actual to target), while they differ.
    if (e.n1Target !== undefined && Math.abs(e.n1Target - n1) > 1) {
      ctx.strokeStyle = C.cyan; ctx.lineWidth = Math.max(2, s * 0.006);
      ctx.beginPath(); ctx.arc(x, y, r * 0.93, Math.min(A(n1), A(e.n1Target)), Math.max(A(n1), A(e.n1Target))); ctx.stroke();
    }
    // Thrust lever marker: a cyan ring on the scale, at the N1 the lever asks for.
    const tl = A(st.leverN1 > 0 ? st.leverN1 : tlaN1(st.thrustLever ?? 0));
    ctx.strokeStyle = C.cyan; ctx.lineWidth = Math.max(1.5, s * 0.004);
    ctx.beginPath(); ctx.arc(x + Math.cos(tl) * r * 1.09, y + Math.sin(tl) * r * 1.09, s * 0.009, 0, Math.PI * 2); ctx.stroke();
    // Needle and readout.
    ctx.strokeStyle = C.green; ctx.lineWidth = Math.max(2.5, s * 0.007);
    const a = A(n1);
    ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.2, y + Math.sin(a) * r * 0.2); ctx.lineTo(x + Math.cos(a) * r * 1.02, y + Math.sin(a) * r * 1.02); ctx.stroke();
    ctx.strokeStyle = C.frame; ctx.lineWidth = Math.max(1, s * 0.003);
    ctx.strokeRect(x - 0.005 * s, y + 0.02 * s, 0.1 * s, 0.05 * s);
    ctx.fillStyle = n1 > 104 ? C.red : C.green; ctx.font = font(s * 0.04, true); ctx.textAlign = 'right';
    ctx.fillText(n1.toFixed(1), x + 0.09 * s, y + 0.046 * s);
    // Reverser: amber while moving, green when deployed.
    if ((e.rev || 0) > 0.02) {
      ctx.fillStyle = e.rev > 0.98 ? C.green : C.amber; ctx.font = font(s * 0.034, true); ctx.textAlign = 'center';
      ctx.fillText('REV', x, y - r * 0.35);
    }
  }

  // Text at `size`, made smaller to fit maxW down to minSize, and squeezed sideways past that.
  function fitText(t, x, y, size, maxW, minSize, bold) {
    ctx.font = font(size, bold);
    const w = ctx.measureText(t).width;
    if (w <= maxW) { ctx.fillText(t, x, y); return; }
    const fs = Math.max(minSize, size * maxW / w);
    ctx.font = font(fs, bold);
    ctx.fillText(t, x, y, maxW);
  }

  // 3, 4 or 6 engines: the dials in a row, each readout under its dial, the fuel flows at the same
  // height as two engines' (0.29 s), and the labels between the wings' engines (engine-row.js).
  function engineRowBlock(s, st, eng, n) {
    const x0 = 0.005 * s, x1 = 0.545 * s, gap = (n >= 6 ? 0.06 : 0.075) * s;
    const row = engineRow(n, { x0, x1, gap }), w = row.w, lx = row.labelX;
    const r = Math.min(0.095 * s, 0.42 * w), k = r / (0.095 * s), kk = Math.max(0.6, k);
    // The readout: as big as two engines' (0.04 s) when it fits the slot, never under 0.022 s.
    const bw = Math.min(0.105 * s, 0.9 * w);
    ctx.font = font(s * 0.04, true);
    const rs = Math.max(0.022 * s, Math.min(0.04 * s, 0.04 * s * (bw - 0.012 * s) / ctx.measureText('100.0').width));
    const bh = Math.max(0.034 * s, rs * 1.25);
    // The dial and its readout, centred between the detent line and the fuel flows.
    const hb = 1.1 * r + 0.009 * s + 0.707 * r + 0.008 * s + bh;
    const y = 0.15 * s - hb / 2 + 1.1 * r + 0.009 * s, by = y + 0.707 * r + 0.008 * s;
    for (let i = 0; i < n; i++) {
      const x = row.xs[i], e = eng[i] || {};
      const box = { x: x - bw / 2, y: by, w: bw, h: bh, size: rs };
      if (e.off) offDial(s, x, y, r, kk, box);
      else dialN(s, x, y, r, kk, e, st, box);
      // The engine's number, small, in the dial's open quarter.
      ctx.fillStyle = e.off ? C.amber : C.white; ctx.font = font(s * 0.022); ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), x + 0.6 * r, y + 0.42 * r);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = C.white; fitText('N1', lx, y - 0.005 * s, s * 0.032, gap - 0.008 * s, s * 0.02);
    ctx.fillStyle = C.cyan; fitText('%', lx, y + 0.03 * s, s * 0.026, gap - 0.008 * s, s * 0.018);
    ctx.fillStyle = C.cyan; ctx.font = font(s * 0.034, true);
    ctx.fillText(st.athrActive ? 'A/THR' : st.detent || '', (x0 + x1) / 2, 0.03 * s);
    // Fuel flow, at two engines' height, all at one size: four figures' fitted to the slot (more shrink further).
    ctx.font = font(s * 0.04);
    const fs = Math.max(0.022 * s, Math.min(0.04 * s, 0.04 * s * (w - 0.01 * s) / ctx.measureText('0000').width));
    for (let i = 0; i < n; i++) {
      const off = eng[i]?.off;
      ctx.fillStyle = off ? C.amber : C.green;
      fitText(off ? 'XX' : String(Math.round(((eng[i]?.ffKgS) || 0) * 3600 / 20) * 20), row.xs[i], 0.29 * s, fs, w - 0.01 * s, fs);
    }
    ctx.fillStyle = C.white; fitText('FF', lx, 0.278 * s, s * 0.028, gap - 0.008 * s, s * 0.018);
    ctx.fillStyle = C.cyan; fitText('KG/H', lx, 0.305 * s, s * 0.022, gap - 0.008 * s, s * 0.016);
  }

  // One of 3, 4 or 6 dials: two engines' dial at radius r, its lines and marks scaled by kk, the
  // readout in `box` under it. The scale's figures only while there's room for them.
  function dialN(s, x, y, r, kk, e, st, box) {
    const a0 = 135 * DEG, a1 = 360 * DEG;
    const A = (n) => a0 + clamp(n, 0, 110) / 110 * (a1 - a0);
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.5, s * 0.004 * kk);
    ctx.beginPath(); ctx.arc(x, y, r, a0, A(104)); ctx.stroke();
    ctx.strokeStyle = C.red; ctx.beginPath(); ctx.arc(x, y, r, A(104), a1); ctx.stroke();
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1, s * 0.003 * kk);
    ctx.fillStyle = C.white; ctx.font = font(s * 0.024 * kk); ctx.textAlign = 'center';
    const figures = r >= 0.055 * s;
    for (const n of [20, 40, 60, 80, 100]) {
      const a = A(n);
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.86, y + Math.sin(a) * r * 0.86); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.stroke();
      if (figures && (n === 100 || n === 20 || n === 60)) ctx.fillText(String(n / 10), x + Math.cos(a) * r * 0.66, y + Math.sin(a) * r * 0.66);
    }
    const n1 = e.n1 || 0;
    if (e.n1Target !== undefined && Math.abs(e.n1Target - n1) > 1) {
      ctx.strokeStyle = C.cyan; ctx.lineWidth = Math.max(2, s * 0.006 * kk);
      ctx.beginPath(); ctx.arc(x, y, r * 0.93, Math.min(A(n1), A(e.n1Target)), Math.max(A(n1), A(e.n1Target))); ctx.stroke();
    }
    const tl = A(st.leverN1 > 0 ? st.leverN1 : tlaN1(st.thrustLever ?? 0));
    ctx.strokeStyle = C.cyan; ctx.lineWidth = Math.max(1.5, s * 0.004 * kk);
    ctx.beginPath(); ctx.arc(x + Math.cos(tl) * r * 1.09, y + Math.sin(tl) * r * 1.09, s * 0.009 * kk, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = C.green; ctx.lineWidth = Math.max(2.5, s * 0.007 * kk);
    const a = A(n1);
    ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.2, y + Math.sin(a) * r * 0.2); ctx.lineTo(x + Math.cos(a) * r * 1.02, y + Math.sin(a) * r * 1.02); ctx.stroke();
    ctx.strokeStyle = C.frame; ctx.lineWidth = Math.max(1, s * 0.003);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = n1 > 104 ? C.red : C.green; ctx.textAlign = 'right';
    fitText(n1.toFixed(1), box.x + box.w - 0.006 * s, box.y + box.h * 0.52, box.size, box.w - 0.012 * s, box.size, true);
    if ((e.rev || 0) > 0.02) {
      ctx.fillStyle = e.rev > 0.98 ? C.green : C.amber; ctx.textAlign = 'center';
      fitText('REV', x, y - r * 0.35, s * 0.034 * kk, 1.5 * r, s * 0.018, true);
    }
  }

  // An engine torn off its pylon: the scale amber with no needle and no markers, OFF in it, XX for
  // its readout (an Airbus's crosses for a figure it hasn't got).
  function offDial(s, x, y, r, kk, box) {
    const a0 = 135 * DEG, a1 = 360 * DEG;
    const A = (n) => a0 + clamp(n, 0, 110) / 110 * (a1 - a0);
    ctx.strokeStyle = C.amber; ctx.lineWidth = Math.max(1.5, s * 0.004 * kk);
    ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.stroke();
    ctx.lineWidth = Math.max(1, s * 0.003 * kk);
    for (const n of [20, 40, 60, 80, 100]) {
      const a = A(n);
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.86, y + Math.sin(a) * r * 0.86); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.stroke();
    }
    ctx.fillStyle = C.amber; ctx.textAlign = 'center';
    fitText('OFF', x, y - r * 0.2, s * 0.036 * kk, 1.4 * r, s * 0.018, true);
    ctx.strokeStyle = C.frame; ctx.lineWidth = Math.max(1, s * 0.003);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = C.amber;
    fitText('XX', box.x + box.w / 2, box.y + box.h * 0.52, box.size, box.w - 0.012 * s, box.size, true);
  }

  // Flaps and slats: S on the left, F on the right, the positions as dots, the config label.
  function flaps(s, st, x0, y0) {
    const slat = st.slatDeg || 0, flap = st.flapDeg || 0, conf = st.config || '0';
    const cxm = x0 + 0.19 * s, base = y0 + 0.01 * s;
    // The fixed wing stub.
    ctx.fillStyle = C.white;
    ctx.beginPath(); ctx.moveTo(cxm - 0.06 * s, base); ctx.lineTo(cxm + 0.06 * s, base); ctx.lineTo(cxm + 0.04 * s, base + 0.014 * s); ctx.lineTo(cxm - 0.05 * s, base + 0.014 * s); ctx.closePath(); ctx.fill();
    const slatP = (d) => [cxm - 0.07 * s - d / 27 * 0.09 * s, base + d / 27 * 0.05 * s];
    const flapP = (d) => [cxm + 0.07 * s + d / 25 * 0.12 * s, base + d / 25 * 0.06 * s];
    ctx.fillStyle = C.white;
    for (const d of SLATS.slice(1)) { const [x, y] = slatP(d); ctx.beginPath(); ctx.arc(x, y, s * 0.005, 0, Math.PI * 2); ctx.fill(); }
    for (const d of FLAPS.slice(1)) { const [x, y] = flapP(d); ctx.beginPath(); ctx.arc(x, y, s * 0.005, 0, Math.PI * 2); ctx.fill(); }
    const [tS, tF] = CONF_TARGET[conf] || [slat, flap];
    const moving = Math.abs(slat - tS) > 0.5 || Math.abs(flap - tF) > 0.5;
    ctx.strokeStyle = C.green; ctx.lineWidth = Math.max(2.5, s * 0.007);
    const [sx, sy] = slatP(slat), [fx, fy] = flapP(flap);
    ctx.beginPath(); ctx.moveTo(cxm - 0.06 * s, base + 0.004 * s); ctx.lineTo(sx, sy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cxm + 0.05 * s, base + 0.008 * s); ctx.lineTo(fx, fy); ctx.stroke();
    ctx.font = font(s * 0.03); ctx.textAlign = 'center';
    ctx.fillStyle = moving ? C.cyan : C.white;
    ctx.fillText('S', cxm - 0.175 * s, base + 0.03 * s); ctx.fillText('F', cxm + 0.215 * s, base + 0.045 * s);
    ctx.font = font(s * 0.044, true);
    ctx.fillStyle = moving ? C.cyan : C.green;
    if (conf !== '0' || moving) ctx.fillText(conf === 'FULL' ? 'FULL' : conf, cxm, base + 0.075 * s);
  }

  // Gear: three triangles; green down and locked, red in transit, nothing when up.
  function gear(s, st, x0, y0) {
    ctx.fillStyle = C.white; ctx.font = font(s * 0.026); ctx.textAlign = 'left';
    ctx.fillText('LDG GEAR', x0, y0);
    const g = st.gearPos ?? 1;
    const pos = [[x0 + 0.13 * s, y0 + 0.06 * s], [x0 + 0.05 * s, y0 + 0.14 * s], [x0 + 0.21 * s, y0 + 0.14 * s]];
    for (const [x, y] of pos) {
      ctx.strokeStyle = C.frame; ctx.lineWidth = Math.max(1, s * 0.003);
      ctx.strokeRect(x - 0.035 * s, y - 0.028 * s, 0.07 * s, 0.056 * s);
      if (g < 0.01) { ctx.fillStyle = C.dim; ctx.font = font(s * 0.024); ctx.textAlign = 'center'; ctx.fillText('UP', x, y); continue; }
      const col = g > 0.99 ? C.green : C.red;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(x - 0.024 * s, y - 0.018 * s); ctx.lineTo(x + 0.024 * s, y - 0.018 * s); ctx.lineTo(x, y + 0.02 * s); ctx.closePath();
      g > 0.99 ? ctx.fill() : (ctx.strokeStyle = col, ctx.lineWidth = Math.max(1.5, s * 0.004), ctx.stroke());
    }
  }

  // Spoilers: five panels per wing, plus SPD BRK and GND SPLR words.
  function spoilers(s, st, view, x0, y0) {
    ctx.fillStyle = C.white; ctx.font = font(s * 0.026); ctx.textAlign = 'left';
    ctx.fillText('SPOILERS', x0, y0);
    const sp = st.surfaces || {};
    const L = sp.spoilersL || [0, 0, 0, 0, 0], R = sp.spoilersR || [0, 0, 0, 0, 0];
    const cx = x0 + 0.17 * s, y = y0 + 0.075 * s, w = 0.022 * s, gap = 0.006 * s;
    ctx.lineWidth = Math.max(1.2, s * 0.003);
    const panel = (x, v) => {
      ctx.strokeStyle = C.green; ctx.fillStyle = C.green;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke();
      if (v > 0.03) { const h = v * 0.04 * s; ctx.fillRect(x + w * 0.3, y - h, w * 0.4, h); ctx.beginPath(); ctx.moveTo(x + w * 0.1, y - h); ctx.lineTo(x + w / 2, y - h - 0.01 * s); ctx.lineTo(x + w * 0.9, y - h); ctx.fill(); }
    };
    for (let i = 0; i < 5; i++) { panel(cx - (i + 1) * (w + gap) - 0.01 * s, L[i] || 0); panel(cx + i * (w + gap) + 0.01 * s, R[i] || 0); }
    ctx.font = font(s * 0.032, true); ctx.textAlign = 'center';
    const flapsFull = st.config === 'FULL';
    if ((st.groundSpoilers || 0) > 0.05) { ctx.fillStyle = C.green; ctx.fillText('GND SPLR', cx, y0 + 0.13 * s); }
    else if ((st.speedbrake || 0) > 0.02) { ctx.fillStyle = flapsFull ? C.amber : C.green; ctx.fillText('SPD BRK', cx, y0 + 0.13 * s); }
    else if (view.controls?.spoilersArmed) { ctx.fillStyle = C.cyan; ctx.font = font(s * 0.028); ctx.fillText('GND SPLR ARMED', cx, y0 + 0.13 * s); }
  }

  // Brakes: per side bars and the parking brake.
  function brakes(s, st, x0, y0) {
    ctx.fillStyle = C.white; ctx.font = font(s * 0.026); ctx.textAlign = 'left';
    ctx.fillText('BRAKES', x0, y0);
    const b = st.brakes || {};
    const bar = (t, v, x) => {
      ctx.strokeStyle = C.frame; ctx.lineWidth = Math.max(1, s * 0.003);
      ctx.strokeRect(x, y0 + 0.03 * s, 0.035 * s, 0.09 * s);
      const h = clamp(v || 0, 0, 1) * 0.09 * s;
      ctx.fillStyle = C.green; ctx.fillRect(x + 1, y0 + 0.12 * s - h, 0.035 * s - 2, h);
      ctx.fillStyle = C.white; ctx.font = font(s * 0.024); ctx.textAlign = 'center'; ctx.fillText(t, x + 0.0175 * s, y0 + 0.14 * s);
    };
    bar('L', b.left, x0 + 0.01 * s); bar('R', b.right, x0 + 0.08 * s);
    if (st.parkingBrake) {
      ctx.fillStyle = C.amber; ctx.font = font(s * 0.03, true); ctx.textAlign = 'left';
      ctx.fillText('PARK', x0 + 0.14 * s, y0 + 0.06 * s); ctx.fillText('BRK', x0 + 0.14 * s, y0 + 0.095 * s);
    }
  }

  // Time compression: the asked rate, and the rate reached when it's lower.
  function simRate(s, view, x, y) {
    ctx.textAlign = 'right'; ctx.font = font(s * 0.032, true);
    if (view.paused) { ctx.fillStyle = C.amber; ctx.fillText('PAUSED', x, y); return; }
    const ts = view.timeScale || 1, ta = view.timeScaleActual ?? ts;
    if (ts === 1 && Math.abs(ta - 1) < 0.05) return;
    const short = Math.abs(ta - ts) > 0.05 * ts;
    ctx.fillStyle = short ? C.amber : C.green;
    ctx.fillText(short ? `SIM RATE ${ts}× (${ta.toFixed(1)}×)` : `SIM RATE ${ts}×`, x, y);
  }

  return { draw, setType };
}
