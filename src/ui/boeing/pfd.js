// The Boeings' PFD: the FMA across the top (autothrottle, roll, pitch), the attitude with its pitch
// limit indicator and bank pointer, the speed tape with its limit bands, the altitude tape, V/S and
// the compass arc at the bottom. Boeing's colours: selected values in magenta, the present ones in
// white, active modes in green, armed ones in white.
//
// Same interface as ../pfd.js: createBoeingPfd(cv) -> { update(view, now), draw(view, now), setType(def) }.
// One square Canvas 2D, all lengths are fractions of `s`. B612's digits are wide: anything in a fixed
// window goes through fitSize. Check at FL350 and on final after a change (tests/dev-ui-boeing.html).

import { C, font, KT, FT, FPM, DEG, clamp, wrap360, angDiff, magDeg, ilsDeviation } from '../common.js';
import { fmaModes, createBoxes, altAlert, speedLow, speedText, machText } from './logic.js';
import { shownAltFt, shownGroundFt, baroLabel } from '../pfd.js';

const TAPE = 'rgba(70,76,82,0.92)';
const SKY = '#1b6fc0', GROUND = '#7a4a24';
const BLACK = '#000';

export function createBoeingPfd(cv) {
  const { ctx } = cv;
  let A = null;              // the type's data (def.data): the flap limit speeds
  let boxes = createBoxes();
  let trend = 0, lastIas = null, lastT = null;   // filtered speed trend (kt per 10 s)
  const modes = {};

  function setType(def) { A = def?.data || null; boxes = createBoxes(); }

  // The speed trend: as ../pfd.js does, the IAS 10 s from now at the present acceleration.
  function update(view) {
    const st = view.state, ias = st.ias * KT;
    if (lastT !== null && st.t > lastT) {
      const a = (ias - lastIas) / (st.t - lastT);
      trend += (a * 10 - trend) * clamp((st.t - lastT) / 0.6, 0, 1);
    } else if (lastT !== null && st.t < lastT) trend = 0;
    lastIas = ias; lastT = st.t;
  }

  // The largest font size up to `size` at which `text` fits in `maxW`.
  function fit(text, size, maxW, bold) {
    ctx.font = font(size, bold);
    const w = ctx.measureText(text).width;
    if (w > maxW) ctx.font = font(size * maxW / w, bold);
  }

  function draw(view, now) {
    const s = cv.w, st = view.state, ap = view.ap || {};
    cv.begin();
    ctx.lineJoin = 'round';
    ctx.textBaseline = 'middle';
    const yc = 0.44 * s, cx = 0.455 * s;
    const ils = view.dest ? ilsDeviation(st, view.destInfo) : null;
    attitude(s, st, cx, yc);
    if (ils && ils.visible) ilsScales(s, cx, yc, ils);
    speedTape(s, st, ap, yc);
    altTape(s, st, ap, yc, view);
    vsScale(s, st, ap, yc);
    compass(s, st, ap, cx, ils);
    fma(s, st, ap, cx, now);
    warnings(s, st, cx, yc);
    destination(s, ils);
  }

  // ---- attitude ----
  function adiPath(s, cx, yc) {
    const hw = 0.235 * s, t = yc - 0.29 * s, b = yc + 0.275 * s, c = 0.05 * s;
    ctx.beginPath();
    ctx.moveTo(cx - hw + c, t); ctx.lineTo(cx + hw - c, t); ctx.lineTo(cx + hw, t + c);
    ctx.lineTo(cx + hw, b - c); ctx.lineTo(cx + hw - c, b); ctx.lineTo(cx - hw + c, b); ctx.lineTo(cx - hw, b - c);
    ctx.lineTo(cx - hw, t + c); ctx.closePath();
  }

  function attitude(s, st, cx, yc) {
    const pp = s * 0.0155; // px per degree of pitch
    const pitch = st.pitch / DEG, roll = st.roll / DEG;
    ctx.save();
    adiPath(s, cx, yc); ctx.clip();
    ctx.translate(cx, yc); ctx.rotate(-roll * DEG);
    ctx.save();
    ctx.translate(0, pitch * pp);
    const big = s * 1.5;
    ctx.fillStyle = SKY; ctx.fillRect(-big, -big * 2, big * 2, big * 2);
    ctx.fillStyle = GROUND; ctx.fillRect(-big, 0, big * 2, big * 2);
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.5, s * 0.004);
    ctx.beginPath(); ctx.moveTo(-big, 0); ctx.lineTo(big, 0); ctx.stroke();
    // The ladder: every 2.5°, numbered every 10°, within ±20° of the present pitch.
    ctx.lineWidth = Math.max(1, s * 0.0028);
    ctx.fillStyle = C.white; ctx.font = font(s * 0.032); ctx.textAlign = 'center';
    for (let d = -80; d <= 80; d += 2.5) {
      if (d === 0 || Math.abs(d - pitch) > 20) continue;
      const y = -d * pp;
      const w = d % 10 === 0 ? 0.085 * s : d % 5 === 0 ? 0.045 * s : 0.018 * s;
      ctx.beginPath(); ctx.moveTo(-w, y); ctx.lineTo(w, y); ctx.stroke();
      if (d % 10 === 0) {
        const lab = String(Math.abs(d));
        ctx.fillText(lab, -w - 0.03 * s, y); ctx.fillText(lab, w + 0.03 * s, y);
      }
    }
    ctx.restore();
    pli(s, st, pp);
    ctx.restore();

    // The bank scale: fixed ticks, the pointer turns with the sky.
    const R = 0.255 * s;
    ctx.save(); ctx.translate(cx, yc);
    ctx.strokeStyle = C.white; ctx.fillStyle = C.white; ctx.lineWidth = Math.max(1.3, s * 0.0035);
    for (const b of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
      const a = (b - 90) * DEG, l = Math.abs(b) === 30 || Math.abs(b) === 60 ? 0.03 * s : 0.017 * s;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R); ctx.lineTo(Math.cos(a) * (R + l), Math.sin(a) * (R + l)); ctx.stroke();
    }
    tri(0, -R, 0.014 * s, 0.022 * s, -1);   // zero, above the pointer
    ctx.rotate(-roll * DEG);
    // Past 35° the pointer goes amber: where the bank protection starts pushing.
    const col = Math.abs(roll) > 35 ? C.amber : C.white;
    ctx.fillStyle = col; ctx.strokeStyle = col;
    tri(0, -R + 0.002 * s, 0.017 * s, 0.027 * s, 1);
    const slip = clamp((st.beta || 0) / DEG * 0.012 * s, -0.04 * s, 0.04 * s);
    ctx.lineWidth = Math.max(1.2, s * 0.003);
    ctx.beginPath(); ctx.rect(-0.02 * s + slip, -R + 0.034 * s, 0.04 * s, 0.011 * s); ctx.stroke();
    ctx.restore();

    // The aircraft symbol: black with a white outline.
    ctx.save(); ctx.translate(cx, yc);
    ctx.lineWidth = Math.max(1.5, s * 0.004); ctx.strokeStyle = C.white; ctx.fillStyle = BLACK;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(dir * 0.055 * s, -0.008 * s); ctx.lineTo(dir * 0.165 * s, -0.008 * s);
      ctx.lineTo(dir * 0.165 * s, 0.008 * s); ctx.lineTo(dir * 0.072 * s, 0.008 * s);
      ctx.lineTo(dir * 0.072 * s, 0.036 * s); ctx.lineTo(dir * 0.055 * s, 0.036 * s); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.fillRect(-0.009 * s, -0.009 * s, 0.018 * s, 0.018 * s); ctx.strokeRect(-0.009 * s, -0.009 * s, 0.018 * s, 0.018 * s);
    ctx.restore();

    // Radio altitude under 2,500 ft, at the foot of the attitude.
    const ra = st.agl * FT;
    if (ra < 2500) {
      const v = ra < 100 ? Math.round(ra) : ra < 500 ? Math.round(ra / 10) * 10 : Math.round(ra / 20) * 20;
      const y = yc + 0.235 * s, t = String(Math.max(0, v));
      ctx.font = font(s * 0.046, true); ctx.textAlign = 'center';
      const tw = ctx.measureText(t).width + 0.016 * s;
      ctx.fillStyle = BLACK; ctx.fillRect(cx - tw / 2, y - 0.026 * s, tw, 0.052 * s);
      ctx.fillStyle = C.white; ctx.fillText(t, cx, y);
    }
  }

  // The pitch limit indicator, in the roll-turned frame: as far above the aircraft symbol as the
  // pitch the aircraft can take before the shaker (state.pliDeg). It shows with the flaps out and
  // whenever the margin gets small; at or below the symbol it goes amber.
  function pli(s, st, pp) {
    const d = st.pliDeg;
    if (d === undefined || st.onGround) return;
    if (!(st.flapDeg > 0.5 || st.slatDeg > 0.5 || d < 8)) return;
    const y = -clamp(d, -8, 18) * pp;
    ctx.strokeStyle = d <= 1 ? C.amber : C.green;
    ctx.lineWidth = Math.max(1.8, s * 0.0045);
    ctx.beginPath();
    for (const dir of [-1, 1]) {
      // The arched brow, with its whiskers up.
      ctx.moveTo(dir * 0.03 * s, y); ctx.lineTo(dir * 0.1 * s, y); ctx.lineTo(dir * 0.116 * s, y + 0.018 * s);
      ctx.moveTo(dir * 0.05 * s, y); ctx.lineTo(dir * 0.062 * s, y - 0.018 * s);
      ctx.moveTo(dir * 0.076 * s, y); ctx.lineTo(dir * 0.088 * s, y - 0.018 * s);
    }
    ctx.moveTo(0, y - 0.012 * s); ctx.lineTo(0, y - 0.03 * s);
    ctx.stroke();
  }

  // A small triangle with its tip at (x, y); dir -1 has its base above the tip, 1 below.
  function tri(x, y, hw, h, dir) {
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x - hw, y + dir * h); ctx.lineTo(x + hw, y + dir * h); ctx.closePath(); ctx.fill();
  }

  // A red-and-black (or amber-and-black) striped strip.
  function barber(x, y, w, h, col) {
    if (h <= 0) return;
    ctx.fillStyle = BLACK; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = col;
    const step = w * 1.6;
    for (let yy = y; yy < y + h; yy += step) ctx.fillRect(x, yy, w, Math.min(step / 2, y + h - yy));
  }

  // ---- speed ----
  function speedTape(s, st, ap, yc) {
    const x0 = 0.018 * s, x1 = 0.15 * s, top = 0.135 * s, bot = 0.75 * s;
    const ias = st.ias * KT, ref = Math.max(30, ias);
    const pk = (bot - top) / 84;
    const Y = (v) => yc - (v - ref) * pk;
    ctx.save();
    ctx.fillStyle = TAPE; ctx.fillRect(x0, top, x1 - x0, bot - top);
    ctx.beginPath(); ctx.rect(x0 - 2, top, x1 - x0 + 0.1 * s, bot - top); ctx.clip();
    ctx.strokeStyle = C.white; ctx.fillStyle = C.white; ctx.lineWidth = Math.max(1.2, s * 0.003);
    ctx.font = font(s * 0.04); ctx.textAlign = 'right';
    for (let v = Math.max(30, Math.floor((ref - 50) / 10) * 10); v <= ref + 50; v += 10) {
      const y = Y(v);
      ctx.beginPath(); ctx.moveTo(x1 - 0.02 * s, y); ctx.lineTo(x1, y); ctx.stroke();
      if (v % 20 === 0) ctx.fillText(String(v), x1 - 0.028 * s, y);
    }
    const bx = x1 - 0.002 * s, bw = 0.014 * s;
    // The maximum speed's barber pole, shown on the ground too, as on the aircraft.
    const vmax = (st.vmax || 0) * KT;
    if (vmax > 0) barber(bx, Y(vmax + 200), bw, Y(vmax) - Y(vmax + 200), C.red);
    if (!st.onGround) {
      // Minimum manoeuvring speed: an amber bar down to the shaker, the barber pole below it.
      const vmm = (st.vmm || 0) * KT, vst = (st.vStick || 0) * KT;
      if (vmm > 0) { ctx.fillStyle = C.amber; ctx.fillRect(bx + bw * 0.1, Y(vmm), bw * 0.3, Math.max(0, Y(vst || vmm - 10) - Y(vmm))); }
      if (vst > 0) barber(bx, Y(vst), bw, bot - Y(vst) + 10, C.red);
      // The next flap detent's limit: an amber tick with the detent's number.
      const vfe = (st.vfeNext || 0) * KT;
      if (vfe > 0 && Math.abs(vfe - ref) < 44) {
        const y = Y(vfe), next = A?.NEXT_CONFIG?.[st.config];
        ctx.strokeStyle = C.amber; ctx.fillStyle = C.amber; ctx.lineWidth = Math.max(1.5, s * 0.004);
        ctx.beginPath(); ctx.moveTo(x1 - 0.014 * s, y); ctx.lineTo(x1 + 0.002 * s, y); ctx.stroke();
        if (next !== undefined && next !== null) {
          ctx.font = font(s * 0.024); ctx.textAlign = 'right';
          ctx.fillText(String(next), x1 - 0.016 * s, y + 0.017 * s);
        }
      }
      // The trim reference speed: the speed the aircraft will settle to when released.
      const vr = (st.vRef || 0) * KT;
      if (vr > 0) {
        const y = clamp(Y(vr), top + 0.034 * s, bot - 0.012 * s), off = y !== Y(vr);
        ctx.fillStyle = C.green; ctx.strokeStyle = C.green; ctx.lineWidth = Math.max(1.2, s * 0.003);
        // Right of the selected speed's bug, as the two often sit at one speed; the word above it.
        ctx.beginPath(); ctx.moveTo(x1 + 0.03 * s, y); ctx.lineTo(x1 + 0.046 * s, y - 0.011 * s); ctx.lineTo(x1 + 0.046 * s, y + 0.011 * s); ctx.closePath();
        off ? ctx.stroke() : ctx.fill();
        ctx.font = font(s * 0.019, true); ctx.textAlign = 'left'; ctx.fillText('TRIM', x1 + 0.028 * s, y - 0.021 * s);
      }
    }
    // The selected speed's bug: Boeing's magenta double triangle.
    // In VNAV the speed is the FMC's, not the MCP window's (the sim's apSpdCmd).
    const tgt = /^VNAV/.test(ap.vertical || '') && st.apSpdCmd ? st.apSpdCmd * KT : ap.spdKt;
    if (tgt) {
      const y = clamp(Y(tgt), top + 0.018 * s, bot - 0.018 * s), off = y !== Y(tgt);
      ctx.strokeStyle = C.magenta; ctx.fillStyle = C.magenta; ctx.lineWidth = Math.max(1.5, s * 0.004);
      const a = x1 + 0.004 * s, b = a + 0.022 * s, c = 0.016 * s;
      ctx.beginPath();
      ctx.moveTo(a, y - c); ctx.lineTo(b, y - c); ctx.lineTo(b, y + c); ctx.lineTo(a, y + c); ctx.lineTo(a + 0.011 * s, y); ctx.closePath();
      off ? ctx.stroke() : ctx.fill();
    }
    ctx.restore();

    // The speed trend vector (green), over 2 kt, in the air or rolling.
    if (Math.abs(trend) > 2 && (!st.onGround || ias > 30)) {
      const y2 = clamp(yc - trend * pk, top + 4, bot - 4), ax = x1 + 0.003 * s, d = trend > 0 ? 1 : -1;
      ctx.strokeStyle = C.green; ctx.lineWidth = Math.max(1.5, s * 0.004);
      ctx.beginPath(); ctx.moveTo(ax, yc); ctx.lineTo(ax, y2);
      ctx.moveTo(ax - 0.008 * s, y2 + d * 0.013 * s); ctx.lineTo(ax, y2); ctx.lineTo(ax + 0.008 * s, y2 + d * 0.013 * s); ctx.stroke();
    }

    // The present speed: a black pointer, tens fixed, units on a drum.
    const bw2 = 0.108 * s, bh = 0.07 * s, px = x0 + 0.004 * s;
    ctx.beginPath();
    ctx.moveTo(px, yc - bh / 2); ctx.lineTo(px + bw2, yc - bh / 2); ctx.lineTo(px + bw2, yc - 0.012 * s); ctx.lineTo(px + bw2 + 0.016 * s, yc);
    ctx.lineTo(px + bw2, yc + 0.012 * s); ctx.lineTo(px + bw2, yc + bh / 2); ctx.lineTo(px, yc + bh / 2); ctx.closePath();
    ctx.fillStyle = BLACK; ctx.fill(); ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.5, s * 0.004); ctx.stroke();
    const dw = 0.036 * s, v = Math.max(0, ias);
    ctx.fillStyle = speedLow(st) ? C.amber : C.white; ctx.textAlign = 'right';
    fit('00', s * 0.052, bw2 - dw - 0.008 * s, true);
    ctx.fillText(ias < 30 ? '' : String(Math.floor(v / 10)), px + bw2 - dw, yc);
    if (ias >= 30) drum(px + bw2 - dw, yc, dw, bh, v, 1, 1, s * 0.05, 1.4);

    // The selected speed, above the tape; the Mach or the ground speed, below it.
    ctx.fillStyle = C.magenta; ctx.textAlign = 'center';
    fit('000', s * 0.044, x1 - x0, true);
    if (tgt) ctx.fillText(speedText(tgt, st), (x0 + x1) / 2, top - 0.022 * s);
    const by = bot + 0.03 * s;
    if (st.mach >= 0.4) {
      ctx.fillStyle = C.white; fit('.00', s * 0.04, x1 - x0, true); ctx.fillText(machText(st.mach), (x0 + x1) / 2, by);
    } else {
      ctx.fillStyle = C.white; ctx.font = font(s * 0.024); ctx.textAlign = 'left'; ctx.fillText('GS', x0, by);
      ctx.font = font(s * 0.036, true); ctx.textAlign = 'right'; ctx.fillText(String(Math.round((st.gs || 0) * KT)), x1, by);
    }
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.2, s * 0.003);
    ctx.beginPath(); ctx.moveTo(x0, top); ctx.lineTo(x1, top); ctx.moveTo(x0, bot); ctx.lineTo(x1, bot); ctx.stroke();
  }

  // A rolling drum in [x, x + w]: `step` units a row, showing `digits` digits, the row at `value`.
  function drum(x, y, w, h, value, step, digits, size, rowK) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y - h / 2 + 1, w, h - 2); ctx.clip();
    fit('0'.repeat(digits), size, w - 0.002 * cv.w, true);
    ctx.textAlign = 'center';
    const f = value / step, base = Math.floor(f), frac = f - base, mod = Math.pow(10, digits), row = size * rowK;
    for (let k = -2; k <= 2; k++) {
      const n = (((base + k) * step) % mod + mod) % mod;
      ctx.fillText(String(n).padStart(digits, '0'), x + w / 2, y - (k - frac) * row);
    }
    ctx.restore();
  }

  // ---- altitude ----
  function altTape(s, st, ap, yc, view) {
    const x0 = 0.742 * s, x1 = 0.868 * s, top = 0.135 * s, bot = 0.75 * s;
    const alt = shownAltFt(st), pf = (bot - top) / 1150;
    const Y = (a) => yc - (a - alt) * pf;
    ctx.save();
    ctx.fillStyle = TAPE; ctx.fillRect(x0, top, x1 - x0, bot - top);
    ctx.beginPath(); ctx.rect(x0 - 0.014 * s, top, x1 - x0 + 0.014 * s, bot - top); ctx.clip();
    // The ground: an amber strip below the terrain or the runway's height.
    if (st.groundH !== undefined) {
      const gy = Y(shownGroundFt(st));
      if (gy < bot) { ctx.fillStyle = C.amber; ctx.fillRect(x0, gy, 0.012 * s, bot - gy); }
    }
    ctx.strokeStyle = C.white; ctx.fillStyle = C.white; ctx.lineWidth = Math.max(1.2, s * 0.003);
    ctx.textAlign = 'right';
    fit('00000', s * 0.034, x1 - x0 - 0.03 * s);
    for (let a = Math.floor((alt - 700) / 100) * 100; a <= alt + 700; a += 100) {
      const y = Y(a);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + 0.014 * s, y); ctx.stroke();
      if (a % 200 === 0) ctx.fillText(String(a), x1 - 0.006 * s, y);
      // Boeing's double lines at the thousands.
      if (a % 1000 === 0) { ctx.beginPath(); ctx.moveTo(x0 + 0.018 * s, y - 0.016 * s); ctx.lineTo(x1, y - 0.016 * s); ctx.moveTo(x0 + 0.018 * s, y + 0.016 * s); ctx.lineTo(x1, y + 0.016 * s); ctx.stroke(); }
    }
    // The selected altitude's bug.
    const sel = ap.altFt;
    if (sel !== undefined) {
      const y = clamp(Y(sel), top + 0.03 * s, bot - 0.03 * s), off = y !== Y(sel), w = 0.022 * s, h = 0.03 * s;
      ctx.strokeStyle = C.magenta; ctx.fillStyle = C.magenta; ctx.lineWidth = Math.max(1.5, s * 0.004);
      ctx.beginPath();
      ctx.moveTo(x0, y - h); ctx.lineTo(x0 + w, y - h); ctx.lineTo(x0 + w, y + h); ctx.lineTo(x0, y + h); ctx.lineTo(x0 + w * 0.5, y); ctx.closePath();
      off ? ctx.stroke() : ctx.fill();
    }
    ctx.restore();

    // The selected altitude above the tape, in a white box near the capture (the altitude alert).
    if (sel !== undefined) {
      const t = String(Math.round(sel)), cx = (x0 + x1) / 2, y = top - 0.022 * s;
      ctx.fillStyle = C.magenta; ctx.textAlign = 'center';
      fit('00000', s * 0.042, x1 - x0 - 0.008 * s, true);
      ctx.fillText(t, cx, y);
      if (altAlert(alt, sel)) {
        ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.5, s * 0.004);
        ctx.strokeRect(x0, y - 0.02 * s, x1 - x0, 0.04 * s);
      }
    }
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.2, s * 0.003);
    ctx.beginPath(); ctx.moveTo(x0, top); ctx.lineTo(x1, top); ctx.moveTo(x0, bot); ctx.lineTo(x1, bot); ctx.stroke();

    // The present altitude: thousands big, hundreds smaller, tens on a drum in 20 ft rows.
    const bx = x0 - 0.002 * s, bw = 0.128 * s, bh = 0.07 * s, dw = 0.044 * s, A0 = Math.abs(alt), neg = alt < 0;
    ctx.beginPath();
    ctx.moveTo(bx, yc - bh / 2); ctx.lineTo(bx + bw - dw, yc - bh / 2); ctx.lineTo(bx + bw - dw, yc - bh * 0.72); ctx.lineTo(bx + bw, yc - bh * 0.72);
    ctx.lineTo(bx + bw, yc + bh * 0.72); ctx.lineTo(bx + bw - dw, yc + bh * 0.72); ctx.lineTo(bx + bw - dw, yc + bh / 2); ctx.lineTo(bx, yc + bh / 2);
    ctx.lineTo(bx, yc + 0.012 * s); ctx.lineTo(bx - 0.012 * s, yc); ctx.lineTo(bx, yc - 0.012 * s); ctx.closePath();
    ctx.fillStyle = BLACK; ctx.fill(); ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.5, s * 0.004); ctx.stroke();
    // From the drum's nearest row, so 34,999 reads 35,000 and not 34,900 with 00 on the drum.
    const Ar = Math.round(A0 / 20) * 20, th = Math.floor(Ar / 1000), hu = Math.floor(Ar / 100) % 10;
    const hw = 0.025 * s, tx = bx + bw - dw - hw;
    ctx.fillStyle = C.white; ctx.textAlign = 'right';
    fit('0', s * 0.04, hw - 0.002 * s, true); ctx.fillText(String(hu), bx + bw - dw - 0.002 * s, yc);
    fit('00', s * 0.05, tx - bx - 0.004 * s, true);
    ctx.fillText((neg ? '-' : '') + (th > 0 ? String(th) : ''), tx - 0.001 * s, yc);
    drum(bx + bw - dw, yc, dw, bh * 1.44, A0, 20, 2, s * 0.033, 1.05);

    // The altimeter setting, Boeing's way: green, "1013 HPA", or STD.
    const baro = baroLabel(view), baroT = baro.std ? 'STD' : `${baro.hpa} HPA`;
    ctx.fillStyle = C.green; ctx.textAlign = 'center';
    fit('1013 HPA', s * 0.03, x1 - x0, false);
    ctx.fillText(baroT, (x0 + x1) / 2, bot + 0.03 * s);
    // The transition reminder: Boeing's amber box around the setting.
    if (st.baroAlert) {
      const w = ctx.measureText(baroT).width + 0.016 * s;
      ctx.strokeStyle = C.amber; ctx.lineWidth = Math.max(1.5, s * 0.004);
      ctx.strokeRect((x0 + x1) / 2 - w / 2, bot + 0.008 * s, w, 0.044 * s);
    }
  }

  // ---- vertical speed ----
  function vsScale(s, st, ap, yc) {
    const x0 = 0.884 * s, x1 = 0.955 * s, half = 0.24 * s;
    const vs = st.vs * FPM;
    const map = (v) => {
      const a = Math.abs(v);
      const f = a <= 1000 ? 0.45 * a / 1000 : a <= 2000 ? 0.45 + 0.25 * (a - 1000) / 1000 : 0.7 + 0.3 * Math.min(1, (a - 2000) / 4000);
      return Math.sign(v) * f * half;
    };
    ctx.fillStyle = TAPE;
    ctx.beginPath();
    ctx.moveTo(x0, yc - half - 0.015 * s); ctx.lineTo(x0 + 0.03 * s, yc - half - 0.015 * s); ctx.lineTo(x1, yc - 0.08 * s);
    ctx.lineTo(x1, yc + 0.08 * s); ctx.lineTo(x0 + 0.03 * s, yc + half + 0.015 * s); ctx.lineTo(x0, yc + half + 0.015 * s); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C.white; ctx.fillStyle = C.white; ctx.lineWidth = Math.max(1.2, s * 0.003);
    ctx.font = font(s * 0.03); ctx.textAlign = 'left';
    for (const v of [-6000, -2000, -1000, -500, 0, 500, 1000, 2000, 6000]) {
      const y = yc - map(v), major = Math.abs(v) >= 1000;
      ctx.beginPath(); ctx.moveTo(x0 + 0.018 * s, y); ctx.lineTo(x0 + (v === 0 ? 0.042 : major ? 0.03 : 0.024) * s, y); ctx.stroke();
      if (major) ctx.fillText(String(Math.abs(v / 1000)), x0 + 0.002 * s, y);
    }
    // The selected V/S's bug.
    if (ap.vertical === 'V/S' && ap.vsFpm !== undefined) {
      ctx.strokeStyle = C.magenta; ctx.lineWidth = Math.max(2, s * 0.005);
      const y = yc - map(clamp(ap.vsFpm, -6000, 6000));
      ctx.beginPath(); ctx.moveTo(x0 + 0.016 * s, y); ctx.lineTo(x0 + 0.046 * s, y); ctx.stroke();
    }
    // The needle, from a pivot off the panel's right edge.
    const yt = yc - map(clamp(vs, -6500, 6500));
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(2, s * 0.005);
    ctx.beginPath(); ctx.moveTo(x1 + 0.05 * s, yc); ctx.lineTo(x0 + 0.022 * s, yt); ctx.stroke();
    // The value in figures past 400 ft/min, above the scale climbing and below it descending.
    if (Math.abs(vs) >= 400) {
      const t = String(Math.round(Math.abs(vs) / 50) * 50);
      ctx.fillStyle = C.white; ctx.textAlign = 'center';
      fit('0000', s * 0.032, 0.105 * s, true);
      ctx.fillText(t, (x0 + 0.99 * s) / 2, vs > 0 ? yc - half - 0.036 * s : yc + half + 0.036 * s);
    }
  }

  // ---- the compass arc ----
  function compass(s, st, ap, cx, ils) {
    const R = 0.29 * s, top = 0.812 * s, cyc = top + R, hdg = magDeg(st.hdg, st.pos.x, st.pos.y);
    const A_ = (d) => angDiff(d, hdg) * DEG;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cyc, R, 0, Math.PI * 2); ctx.fillStyle = TAPE; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cyc, R, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = C.white; ctx.fillStyle = C.white; ctx.lineWidth = Math.max(1.2, s * 0.003); ctx.textAlign = 'center';
    for (let d = Math.ceil((hdg - 60) / 5) * 5; d <= hdg + 60; d += 5) {
      const a = (d - hdg) * DEG, major = d % 10 === 0;
      ctx.save(); ctx.translate(cx, cyc); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(0, -R); ctx.lineTo(0, -R + (major ? 0.02 : 0.011) * s); ctx.stroke();
      if (major) {
        const n = Math.round(wrap360(d) / 10);
        ctx.font = font(n % 3 === 0 ? s * 0.032 : s * 0.025);
        ctx.fillText(String(n), 0, -R + 0.038 * s);
      }
      ctx.restore();
    }
    ctx.restore();
    // The ILS course (magenta), the track (a white line), the selected heading (magenta, Boeing's bug).
    const mark = (a, r0, r1, col, w) => {
      const sx = Math.sin(a), cy_ = -Math.cos(a);
      ctx.strokeStyle = col; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(cx + sx * r0, cyc + cy_ * r0); ctx.lineTo(cx + sx * r1, cyc + cy_ * r1); ctx.stroke();
    };
    if (ils && ils.visible) mark(A_(ils.courseMag), R - 0.012 * s, R + 0.012 * s, C.magenta, Math.max(2, s * 0.005));
    if (st.gs > 5) mark(A_(magDeg(Math.atan2(st.vel.x, st.vel.y), st.pos.x, st.pos.y)), R - 0.075 * s, R, C.white, Math.max(1.2, s * 0.003));
    const sel = ap.hdgDeg;
    if (sel !== undefined) {
      const a = clamp(A_(sel), -50 * DEG, 50 * DEG);
      ctx.save(); ctx.translate(cx, cyc); ctx.rotate(a);
      ctx.strokeStyle = C.magenta; ctx.fillStyle = C.magenta; ctx.lineWidth = Math.max(1.5, s * 0.004);
      const w = 0.018 * s, h = 0.018 * s, y0 = -R - 0.002 * s;
      ctx.beginPath(); ctx.moveTo(-w, y0 - h); ctx.lineTo(-w, y0); ctx.lineTo(w, y0); ctx.lineTo(w, y0 - h); ctx.lineTo(0, y0 - h * 0.45); ctx.closePath();
      Math.abs(A_(sel)) <= 50 * DEG ? ctx.fill() : ctx.stroke();
      ctx.restore();
      // In figures to the left of the arc.
      ctx.fillStyle = C.magenta; ctx.textAlign = 'right';
      fit('000 H', s * 0.032, 0.09 * s, true);
      ctx.fillText(String(Math.round(wrap360(sel)) || 360).padStart(3, '0') + ' H', cx - 0.135 * s, top + 0.012 * s);
    }
    // The present heading in a box at the top, with the lubber pointer under it.
    const t = String(Math.round(hdg) || 360).padStart(3, '0'), bw = 0.086 * s, bh = 0.044 * s, by = top - bh - 0.002 * s;
    ctx.fillStyle = BLACK; ctx.fillRect(cx - bw / 2, by, bw, bh);
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.3, s * 0.003); ctx.strokeRect(cx - bw / 2, by, bw, bh);
    ctx.fillStyle = C.white; ctx.textAlign = 'center';
    fit('000', s * 0.038, bw - 0.008 * s, true);
    ctx.fillText(t, cx, by + bh / 2);
    tri(cx, top + 0.012 * s, 0.009 * s, 0.012 * s, -1);
    ctx.fillStyle = C.green; ctx.textAlign = 'left'; ctx.font = font(s * 0.026);
    ctx.fillText('MAG', cx + 0.135 * s, top + 0.012 * s);
  }

  // ---- the FMA ----
  function fma(s, st, ap, cx, now) {
    const x0 = 0.12 * s, w = 0.253 * s, h = 0.084 * s;
    fmaModes(ap, st, modes);
    boxes.track('thr', modes.thr, now); boxes.track('roll', modes.roll, now); boxes.track('pitch', modes.pitch, now); boxes.track('status', modes.status, now);
    ctx.fillStyle = BLACK; ctx.fillRect(x0, 0, w * 3, h);
    ctx.strokeStyle = '#9aa3aa'; ctx.lineWidth = Math.max(1, s * 0.0025);
    ctx.beginPath();
    for (let i = 0; i <= 3; i++) { ctx.moveTo(x0 + i * w, 0); ctx.lineTo(x0 + i * w, h); }
    ctx.stroke();
    ctx.textAlign = 'center';
    const active = (i, t, key) => {
      if (!t) return;
      const x = x0 + i * w + w / 2, y = 0.026 * s;
      ctx.fillStyle = C.green; fit(t, s * 0.038, w - 0.024 * s, true);
      ctx.fillText(t, x, y);
      if (boxes.boxed(key, now)) {
        const tw = Math.min(ctx.measureText(t).width + 0.016 * s, w - 0.006 * s);
        ctx.strokeStyle = C.green; ctx.lineWidth = Math.max(1, s * 0.003);
        ctx.strokeRect(x - tw / 2, y - 0.02 * s, tw, 0.04 * s);
      }
    };
    const armed = (i, t) => {
      if (!t) return;
      ctx.fillStyle = C.white; fit(t, s * 0.03, w - 0.024 * s);
      ctx.fillText(t, x0 + i * w + w / 2, 0.064 * s);
    };
    active(0, modes.thr, 'thr'); active(1, modes.roll, 'roll'); active(2, modes.pitch, 'pitch');
    armed(1, modes.armRoll); armed(2, modes.armPitch);

    // The status, centred above the attitude. A red flash for the autopilot's disconnect.
    const y = 0.116 * s;
    const disc = !ap.ap && st.warnings?.apDisc;
    if (disc) {
      if (Math.floor(now / 400) % 2) { ctx.fillStyle = C.red; ctx.font = font(s * 0.034, true); ctx.fillText('A/P', cx, y); }
    } else if (modes.status) {
      ctx.fillStyle = C.green; ctx.font = font(s * 0.036, true);
      ctx.fillText(modes.status, cx, y);
      if (boxes.boxed('status', now)) {
        const tw = ctx.measureText(modes.status).width + 0.018 * s;
        ctx.strokeStyle = C.green; ctx.lineWidth = Math.max(1, s * 0.003);
        ctx.strokeRect(cx - tw / 2, y - 0.02 * s, tw, 0.04 * s);
      }
    }
  }

  // ---- warnings ----
  function warnings(s, st, cx, yc) {
    const w = st.warnings || {};
    let n = 0;
    const word = (t, col) => {
      if (n >= 2) return;
      const y = yc + 0.1 * s + n * 0.05 * s; n++;
      ctx.font = font(s * 0.042, true); ctx.textAlign = 'center';
      const tw = ctx.measureText(t).width + 0.03 * s;
      ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(cx - tw / 2, y - 0.024 * s, tw, 0.048 * s);
      ctx.fillStyle = col; ctx.fillText(t, cx, y);
    };
    if (st.crashed) word('CRASH', C.red);
    if (w.windshear) word('WINDSHEAR', C.red);   // v0.4.0
    if (w.pullUp) word('PULL UP', C.red);
    if (w.stall || st.shaker) word('STALL', C.red);
    if (w.overspeed) word('OVERSPEED', C.red);
    if (w.sinkRate) word('SINK RATE', C.amber);
    if (w.tooLowGear) word('TOO LOW GEAR', C.amber);
    if (speedLow(st)) word('AIRSPEED LOW', C.amber);
    if (!st.onGround && Math.abs(st.roll) > 35 * DEG) word('BANK ANGLE', C.amber);
  }

  // ---- the ILS ----
  function ilsScales(s, cx, yc, ils) {
    const dot = 0.044 * s, ly = yc + 0.295 * s, gx = cx + 0.258 * s;
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.2, s * 0.003);
    for (const k of [-2, -1, 1, 2]) {
      ctx.beginPath(); ctx.arc(cx + k * dot, ly, 0.007 * s, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(gx, yc + k * dot, 0.007 * s, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = C.white; ctx.fillRect(cx - 1, ly - 0.015 * s, 2, 0.03 * s); ctx.fillRect(gx - 0.015 * s, yc - 1, 0.03 * s, 2);
    const diamond = (x, y, a, b) => { ctx.beginPath(); ctx.moveTo(x - a, y); ctx.lineTo(x, y - b); ctx.lineTo(x + a, y); ctx.lineTo(x, y + b); ctx.closePath(); };
    const lx = clamp(ils.locDots, -2.3, 2.3), gy = clamp(ils.gsDots, -2.3, 2.3);
    ctx.lineWidth = Math.max(1.5, s * 0.004); ctx.strokeStyle = C.magenta; ctx.fillStyle = C.magenta;
    diamond(cx + lx * dot, ly, 0.016 * s, 0.011 * s); Math.abs(ils.locDots) > 2.3 ? ctx.stroke() : ctx.fill();
    diamond(gx, yc + gy * dot, 0.011 * s, 0.016 * s); Math.abs(ils.gsDots) > 2.3 ? ctx.stroke() : ctx.fill();
  }

  // Bottom left: the destination's runway, its course and the distance, as the A321's PFD has.
  function destination(s, ils) {
    if (!ils) return;
    ctx.fillStyle = C.white; ctx.textAlign = 'left'; ctx.font = font(s * 0.028);
    ctx.fillText(`${ils.icao} ${ils.ident}`.trim(), 0.012 * s, 0.84 * s);
    ctx.fillText(`${String(Math.round(ils.courseMag) || 360).padStart(3, '0')}°`, 0.012 * s, 0.88 * s);
    ctx.fillStyle = C.magenta; ctx.fillText(`${ils.distNm < 100 ? ils.distNm.toFixed(1) : Math.round(ils.distNm)} NM`, 0.012 * s, 0.92 * s);
  }

  return { update, draw, setType };
}
