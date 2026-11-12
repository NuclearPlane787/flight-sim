// The PFD: attitude with pitch ladder and bank scale (no flight directors), the speed
// tape with its limit bands, the altitude tape and vertical speed, the heading tape,
// the flight mode annunciator, raw ILS-style deviations and the radio altitude.
// Drawn on one square Canvas 2D, sized by the HUD; all lengths are fractions of `s`.

import { C, font, KT, FT, FPM, DEG, clamp, wrap360, angDiff, magDeg, ilsDeviation } from './common.js';

// The altitude the tapes show, ft: the altimeter's reading (state.altInd), which depends on the setting.
export const shownAltFt = (st) => (st.altInd ?? st.pos.z) * FT;
// The ground's place on a tape, ft, in the altimeter's terms: the true height above it, under the reading.
export const shownGroundFt = (st) => shownAltFt(st) - (st.pos.z - st.groundH) * FT;
// The altimeter setting from the view (main.js's view.sim). With no sim attached it's the old fixed 1013.
export function baroLabel(view) {
  const b = view?.sim?.baro;
  if (b?.std) return { std: true, hpa: Math.round(b.hpa) };
  return { std: false, hpa: Math.round(b?.hpa ?? 1013.25) };
}

export function createPfd(cv) {
  const { ctx } = cv;
  let trend = 0, lastIas = null, lastT = null; // filtered speed trend (kt per 10 s)
  const boxes = {}; // FMA mode -> time it last changed (for the 10 s box)
  let lastModes = {};

  // Keep a white box round a mode for 10 s after it changes.
  function trackModes(modes, now) {
    for (const k in modes) {
      if (modes[k] !== lastModes[k]) boxes[k] = modes[k] ? now : 0;
    }
    lastModes = modes;
  }
  const boxed = (k, now) => boxes[k] && now - boxes[k] < 10000;

  function update(view, now) {
    const st = view.state;
    // Speed trend: the IAS 10 s from now at the current acceleration (filtered).
    const ias = st.ias * KT;
    if (lastT !== null && st.t > lastT) {
      const a = (ias - lastIas) / (st.t - lastT);
      const k = clamp((st.t - lastT) / 0.6, 0, 1);
      trend += (a * 10 - trend) * k;
    } else if (lastT !== null && st.t < lastT) trend = 0;
    lastIas = ias; lastT = st.t;
  }

  function draw(view, now) {
    const s = cv.w, st = view.state, ap = view.ap || {};
    cv.begin();
    ctx.lineJoin = 'round';
    ctx.textBaseline = 'middle';
    const yc = 0.48 * s;
    const ils = view.dest ? ilsDeviation(st, view.destInfo) : null;

    drawAttitude(s, st, yc, now);
    drawSpeed(s, st, ap, yc, view);
    drawAlt(s, st, ap, yc, view);
    drawVs(s, st, yc);
    drawHeading(s, st, ap, ils);
    drawFma(s, st, ap, now);
    if (ils && ils.visible) drawIls(s, yc, ils);
    drawIlsInfo(s, ils);
  }

  // ---- attitude ----
  function drawAttitude(s, st, yc, now) {
    const cx = 0.43 * s, hw = 0.215 * s, hh = 0.265 * s;
    const pp = s * 0.0155; // px per degree of pitch
    const pitch = st.pitch / DEG, roll = st.roll / DEG;
    ctx.save();
    // Clip: a rectangle with rounded top and bottom, like the Airbus sphere window.
    ctx.beginPath();
    ctx.moveTo(cx - hw, yc - hh * 0.82);
    ctx.quadraticCurveTo(cx, yc - hh * 1.18, cx + hw, yc - hh * 0.82);
    ctx.lineTo(cx + hw, yc + hh * 0.82);
    ctx.quadraticCurveTo(cx, yc + hh * 1.18, cx - hw, yc + hh * 0.82);
    ctx.closePath();
    ctx.clip();
    ctx.translate(cx, yc);
    ctx.rotate(-roll * DEG);
    ctx.translate(0, pitch * pp);
    const big = s * 1.5;
    ctx.fillStyle = C.sky; ctx.fillRect(-big, -big * 2, big * 2, big * 2);
    ctx.fillStyle = C.ground; ctx.fillRect(-big, 0, big * 2, big * 2);
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.5, s * 0.004);
    ctx.beginPath(); ctx.moveTo(-big, 0); ctx.lineTo(big, 0); ctx.stroke();
    // Pitch ladder, every 2.5°, labels every 10°, within ±22° of the current pitch.
    ctx.lineWidth = Math.max(1, s * 0.0028);
    ctx.fillStyle = C.white; ctx.font = font(s * 0.033); ctx.textAlign = 'center';
    for (let d = -80; d <= 80; d += 2.5) {
      if (d === 0 || Math.abs(d - pitch) > 22) continue;
      const y = -d * pp;
      const w = d % 10 === 0 ? 0.09 * s : d % 5 === 0 ? 0.045 * s : 0.02 * s;
      ctx.beginPath(); ctx.moveTo(-w, y); ctx.lineTo(w, y); ctx.stroke();
      if (d % 10 === 0) {
        const lab = String(Math.abs(d));
        ctx.fillText(lab, -w - s * 0.03, y); ctx.fillText(lab, w + s * 0.03, y);
      }
    }
    // Heading marks on the horizon are left out: the heading tape is right below.
    ctx.restore();

    // Bank scale: fixed ticks at 0, 10, 20, 30, 45; the pointer turns with the sky.
    const R = 0.235 * s;
    ctx.save(); ctx.translate(cx, yc);
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.5, s * 0.004);
    ctx.beginPath(); ctx.arc(0, 0, R, (-90 - 45) * DEG, (-90 + 45) * DEG); ctx.stroke();
    for (const b of [-45, -30, -20, -10, 10, 20, 30, 45]) {
      const a = (b - 90) * DEG, l = Math.abs(b) % 30 === 0 || b === 45 || b === -45 ? 0.035 * s : 0.02 * s;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R); ctx.lineTo(Math.cos(a) * (R + l), Math.sin(a) * (R + l)); ctx.stroke();
    }
    // Fixed zero index (yellow, above the arc).
    ctx.fillStyle = C.yellow;
    tri(0, -R - 0.002 * s, 0.018 * s, 0.03 * s, -1);
    // Normal law bank limit marks at ±67° (green "=").
    if ((st.law || 'normal') === 'normal') {
      ctx.strokeStyle = C.green; ctx.lineWidth = Math.max(1.2, s * 0.003);
      for (const b of [-67, 67]) {
        const a = (b - 90) * DEG;
        for (const o of [-0.006, 0.006]) {
          ctx.save(); ctx.rotate(a + Math.PI / 2); ctx.beginPath();
          ctx.moveTo(o * s * 2, -R * 0.98); ctx.lineTo(o * s * 2, -R * 1.07); ctx.restore(); ctx.stroke();
        }
      }
    }
    // Roll pointer and the sideslip index under it.
    ctx.rotate(-roll * DEG);
    const amberRoll = Math.abs(roll) > 45;
    ctx.fillStyle = amberRoll ? C.amber : C.yellow; ctx.strokeStyle = ctx.fillStyle;
    tri(0, -R + 0.002 * s, 0.02 * s, 0.03 * s, 1);
    const slip = clamp((st.beta || 0) / DEG * 0.012 * s, -0.04 * s, 0.04 * s);
    ctx.beginPath();
    ctx.rect(-0.022 * s + slip, -R + 0.038 * s, 0.044 * s, 0.012 * s);
    ctx.lineWidth = Math.max(1.2, s * 0.003); ctx.stroke();
    ctx.restore();

    // Fixed aircraft symbol: yellow wings with black outlines and a centre square.
    ctx.save(); ctx.translate(cx, yc);
    const wing = (dir) => {
      ctx.beginPath();
      ctx.moveTo(dir * 0.06 * s, -0.007 * s); ctx.lineTo(dir * 0.17 * s, -0.007 * s);
      ctx.lineTo(dir * 0.17 * s, 0.007 * s); ctx.lineTo(dir * 0.075 * s, 0.007 * s);
      ctx.lineTo(dir * 0.075 * s, 0.035 * s); ctx.lineTo(dir * 0.06 * s, 0.035 * s); ctx.closePath();
      ctx.fillStyle = '#000'; ctx.fill(); ctx.lineWidth = Math.max(1.5, s * 0.004); ctx.strokeStyle = C.yellow; ctx.stroke();
    };
    wing(-1); wing(1);
    ctx.fillStyle = '#000'; ctx.fillRect(-0.008 * s, -0.008 * s, 0.016 * s, 0.016 * s);
    ctx.strokeRect(-0.008 * s, -0.008 * s, 0.016 * s, 0.016 * s);
    ctx.restore();

    // Radio altitude below 2,500 ft, at the bottom of the sphere.
    const ra = st.agl * FT;
    if (ra < 2500) {
      const v = ra < 5 ? Math.round(ra) : ra < 50 ? Math.round(ra) : ra < 500 ? Math.round(ra / 5) * 5 : Math.round(ra / 10) * 10;
      ctx.font = font(s * 0.048, true); ctx.textAlign = 'center';
      ctx.fillStyle = ra < 400 && !st.onGround ? C.amber : C.green;
      ctx.fillText(String(Math.max(0, v)), cx, yc + 0.228 * s);
    }

    // Warnings: red words across the sphere.
    const w = st.warnings || {};
    const words = [];
    if (w.windshear) words.push(['WINDSHEAR', C.red]);   // v0.4.0
    if (w.windshearAhead) words.push(['W/S AHEAD', C.red]);   // v0.4.2: the predictive warning
    if (w.pullUp) words.push(['PULL UP', C.red]);
    if (w.stall) words.push(['STALL', C.red]);
    if (w.overspeed) words.push(['OVERSPEED', C.red]);
    if (w.sinkRate) words.push(['SINK RATE', C.amber]);
    if (w.tooLowGear) words.push(['TOO LOW GEAR', C.amber]);
    if (st.crashed) words.unshift(['CRASH', C.red]);
    if (words.length) {
      ctx.font = font(s * 0.045, true); ctx.textAlign = 'center';
      words.slice(0, 2).forEach(([t, col], i) => {
        const y = yc + 0.13 * s + i * 0.05 * s;
        const tw = ctx.measureText(t).width + 0.03 * s;
        ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(cx - tw / 2, y - 0.025 * s, tw, 0.05 * s);
        ctx.fillStyle = col; ctx.fillText(t, cx, y);
      });
    }
  }

  // A small triangle with its tip at (x, y); dir -1 points down (tip at the bottom), 1 points up.
  function tri(x, y, hw, h, dir) {
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x - hw, y + dir * h); ctx.lineTo(x + hw, y + dir * h); ctx.closePath(); ctx.fill();
  }

  // ---- speed tape ----
  function drawSpeed(s, st, ap, yc, view) {
    const x0 = 0.035 * s, x1 = 0.165 * s, top = 0.17 * s, bot = 0.79 * s;
    const ias = st.ias * KT;
    const pk = (bot - top) / 84; // px per kt
    const ref = Math.max(30, ias);
    const Y = (v) => yc - (v - ref) * pk;
    ctx.save();
    ctx.fillStyle = 'rgba(70,76,82,0.9)'; ctx.fillRect(x0, top, x1 - x0, bot - top);
    ctx.beginPath(); ctx.rect(x0 - 2, top, x1 - x0 + 0.04 * s, bot - top); ctx.clip();
    ctx.strokeStyle = C.white; ctx.fillStyle = C.white; ctx.lineWidth = Math.max(1.2, s * 0.003);
    ctx.font = font(s * 0.042); ctx.textAlign = 'right';
    for (let v = Math.max(30, Math.floor((ref - 50) / 10) * 10); v <= ref + 50; v += 10) {
      const y = Y(v);
      ctx.beginPath(); ctx.moveTo(x1 - 0.022 * s, y); ctx.lineTo(x1, y); ctx.stroke();
      if (v % 20 === 0) ctx.fillText(String(v).padStart(3, '0'), x1 - 0.03 * s, y);
    }
    // Limit bands (on the right edge), hidden on the ground like the real ones.
    const bx = x1, bw = 0.016 * s;
    const vmax = st.vmax * KT;
    if (vmax > 0) barber(bx, Y(vmax + 200), bw, Y(vmax) - Y(vmax + 200), C.red);
    if (!st.onGround) {
      const law = st.law || 'normal';
      if (law === 'normal') {
        const vls = st.vls * KT, vap = st.valphaProt * KT, vam = st.valphaMax * KT;
        if (vls > 0) { ctx.fillStyle = C.amber; ctx.fillRect(bx + bw * 0.25, Y(vls), bw * 0.25, Math.max(0, Y(vap || vls - 10) - Y(vls))); }
        if (vap > 0) barber(bx, Y(vap), bw, Math.max(0, Y(vam || vap - 10) - Y(vap)), C.amber);
        if (vam > 0) { ctx.fillStyle = C.red; ctx.fillRect(bx, Y(vam), bw, bot - Y(vam) + 10); }
      } else {
        const vsw = st.vsw * KT, vls = st.vls * KT;
        if (vls > 0) { ctx.fillStyle = C.amber; ctx.fillRect(bx + bw * 0.25, Y(vls), bw * 0.25, Math.max(0, Y(vsw || vls - 10) - Y(vls))); }
        if (vsw > 0) barber(bx, Y(vsw), bw, bot - Y(vsw) + 10, C.red);
      }
      const vfe = st.vfeNext * KT;
      if (vfe > 0 && (st.flapLever ?? 0) < 4) {
        ctx.strokeStyle = C.amber; ctx.lineWidth = Math.max(1.5, s * 0.004);
        for (const o of [-0.005, 0.005]) { ctx.beginPath(); ctx.moveTo(x1 - 0.012 * s, Y(vfe) + o * s); ctx.lineTo(x1 + 0.004 * s, Y(vfe) + o * s); ctx.stroke(); }
      }
    }
    // Selected speed (cyan triangle), clipped to the tape.
    const tgt = ap.spdKt;
    const tgtOn = tgt && Math.abs(tgt - ref) < 42;
    if (tgtOn) {
      ctx.fillStyle = C.cyan; ctx.beginPath();
      const y = Y(tgt);
      ctx.moveTo(x1 + 0.002 * s, y); ctx.lineTo(x1 + 0.03 * s, y - 0.014 * s); ctx.lineTo(x1 + 0.03 * s, y + 0.014 * s); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    if (tgt && !tgtOn) {
      ctx.fillStyle = C.cyan; ctx.font = font(s * 0.04); ctx.textAlign = 'center';
      ctx.fillText(String(Math.round(tgt)), (x0 + x1) / 2, tgt > ref ? top - 0.022 * s : bot + 0.022 * s);
    }
    // Speed trend arrow (yellow), when it's more than 2 kt.
    if (Math.abs(trend) > 2 && !st.onGround || (st.onGround && Math.abs(trend) > 2 && ias > 30)) {
      const y2 = clamp(yc - trend * pk, top + 4, bot - 4);
      const ax = x1 + 0.006 * s;
      ctx.strokeStyle = C.yellow; ctx.fillStyle = C.yellow; ctx.lineWidth = Math.max(1.5, s * 0.004);
      ctx.beginPath(); ctx.moveTo(ax, yc); ctx.lineTo(ax, y2); ctx.stroke();
      const d = trend > 0 ? 1 : -1;
      ctx.beginPath(); ctx.moveTo(ax - 0.009 * s, y2 + d * 0.014 * s); ctx.lineTo(ax, y2); ctx.lineTo(ax + 0.009 * s, y2 + d * 0.014 * s); ctx.stroke();
    }
    // Reference line and pointer (yellow).
    ctx.strokeStyle = C.yellow; ctx.fillStyle = C.yellow; ctx.lineWidth = Math.max(2, s * 0.005);
    ctx.beginPath(); ctx.moveTo(x0 - 0.008 * s, yc); ctx.lineTo(x1 - 0.004 * s, yc); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1 - 0.004 * s, yc); ctx.lineTo(x1 + 0.02 * s, yc - 0.013 * s); ctx.lineTo(x1 + 0.02 * s, yc + 0.013 * s); ctx.closePath(); ctx.fill();
    // Frame lines.
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.2, s * 0.003);
    ctx.beginPath(); ctx.moveTo(x0, top); ctx.lineTo(x1 + 0.018 * s, top); ctx.moveTo(x0, bot); ctx.lineTo(x1 + 0.018 * s, bot); ctx.stroke();
    // Mach above 0.50, under the tape.
    if (st.mach > 0.5) {
      ctx.fillStyle = C.green; ctx.font = font(s * 0.045); ctx.textAlign = 'center';
      ctx.fillText('.' + String(Math.round(st.mach * 100)).padStart(2, '0'), (x0 + x1) / 2, bot + 0.06 * s);
    }
  }

  // A red/black (or amber/black) striped strip.
  function barber(x, y, w, h, col) {
    if (h <= 0) return;
    ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = col;
    const step = w * 1.6;
    for (let yy = y; yy < y + h; yy += step) ctx.fillRect(x, yy, w, Math.min(step / 2, y + h - yy));
  }

  // The largest font size up to `size` at which `text` fits in `maxW` px. The altitude windows
  // were sized for Helvetica; B612's digits (v0.1.4) are wider.
  function fitSize(text, size, maxW) {
    ctx.font = font(size);
    const w = ctx.measureText(text).width;
    return w > maxW ? (size * maxW) / w : size;
  }

  // ---- altitude tape ----
  function drawAlt(s, st, ap, yc, view) {
    const x0 = 0.715 * s, x1 = 0.81 * s, top = 0.17 * s, bot = 0.79 * s;
    const alt = shownAltFt(st);
    const pf = (bot - top) / 1150; // px per ft
    const Y = (a) => yc - (a - alt) * pf;
    ctx.save();
    ctx.fillStyle = 'rgba(70,76,82,0.9)'; ctx.fillRect(x0, top, x1 - x0, bot - top);
    ctx.beginPath(); ctx.rect(x0, top, x1 - x0 + 0.02 * s, bot - top); ctx.clip();
    // Ground (red ribbon below the terrain or runway height).
    if (st.groundH !== undefined) {
      const gy = Y(shownGroundFt(st));
      if (gy < bot) { ctx.fillStyle = C.red; ctx.fillRect(x0, gy, 0.012 * s, bot - gy); }
    }
    ctx.strokeStyle = C.white; ctx.fillStyle = C.white; ctx.lineWidth = Math.max(1.2, s * 0.003);
    ctx.font = font(fitSize('000', s * 0.04, x1 - x0 - 0.034 * s)); ctx.textAlign = 'left';
    for (let a = Math.floor((alt - 700) / 100) * 100; a <= alt + 700; a += 100) {
      const y = Y(a);
      ctx.beginPath(); ctx.moveTo(x1 - 0.016 * s, y); ctx.lineTo(x1, y); ctx.stroke();
      if (a % 500 === 0) ctx.fillText(String(Math.round(a / 100)), x0 + 0.012 * s, y);
    }
    // Selected altitude marker on the tape.
    const sel = ap.altFt;
    if (sel !== undefined && Math.abs(sel - alt) < 560) {
      const y = Y(sel);
      ctx.strokeStyle = C.cyan; ctx.lineWidth = Math.max(1.5, s * 0.004);
      ctx.strokeRect(x0 + 0.004 * s, y - 0.03 * s, x1 - x0 - 0.008 * s, 0.06 * s);
    }
    ctx.restore();
    if (sel !== undefined && Math.abs(sel - alt) >= 560) {
      ctx.fillStyle = C.cyan; ctx.font = font(s * 0.042); ctx.textAlign = 'center';
      const txt = sel >= 14000 ? 'FL' + String(Math.round(sel / 100)).padStart(3, '0') : String(Math.round(sel));
      ctx.fillText(txt, (x0 + x1) / 2 + 0.01 * s, sel > alt ? top - 0.022 * s : bot + 0.022 * s);
    }
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.2, s * 0.003);
    ctx.beginPath(); ctx.moveTo(x0, top); ctx.lineTo(x1, top); ctx.moveTo(x0, bot); ctx.lineTo(x1, bot); ctx.stroke();

    // Readout: hundreds in a black window, tens on a rolling drum.
    const by = yc, bh = 0.075 * s, bx = x0 - 0.002 * s, bw = 0.085 * s, dw = 0.055 * s;
    const neg = alt < 0, A = Math.abs(alt);
    ctx.fillStyle = '#000';
    ctx.fillRect(bx, by - bh / 2, bw, bh);
    ctx.fillRect(bx + bw, by - bh * 0.85, dw, bh * 1.7);
    ctx.strokeStyle = C.yellow; ctx.lineWidth = Math.max(1.8, s * 0.0045);
    ctx.beginPath();
    ctx.moveTo(bx, by - bh / 2); ctx.lineTo(bx + bw, by - bh / 2); ctx.lineTo(bx + bw, by - bh * 0.85);
    ctx.lineTo(bx + bw + dw, by - bh * 0.85); ctx.lineTo(bx + bw + dw, by + bh * 0.85); ctx.lineTo(bx + bw, by + bh * 0.85);
    ctx.lineTo(bx + bw, by + bh / 2); ctx.lineTo(bx, by + bh / 2); ctx.closePath(); ctx.stroke();
    // Drum: steps of 20 ft; the hundreds move when the drum rolls past 80.
    const step = 20, f = A / step, base = Math.floor(f), frac = f - base;
    const hund = Math.floor(A / 100);
    ctx.fillStyle = C.green; ctx.textAlign = 'right';
    ctx.font = font(fitSize('000', s * 0.06, bw - 0.01 * s));
    ctx.fillText((neg ? '-' : '') + String(hund), bx + bw - 0.004 * s, by);
    ctx.save();
    ctx.beginPath(); ctx.rect(bx + bw, by - bh * 0.85, dw, bh * 1.7); ctx.clip();
    ctx.font = font(fitSize('00', s * 0.044, dw - 0.01 * s)); ctx.textAlign = 'center';
    const rowH = bh * 0.62;
    for (let k = -2; k <= 2; k++) {
      const v = ((base + k) * step) % 100;
      ctx.fillText(String((v + 100) % 100).padStart(2, '0'), bx + bw + dw / 2, by - (k - frac) * rowH);
    }
    ctx.restore();

    // The altimeter setting, Airbus's way: QNH in white and its value in cyan, or STD in a yellow box.
    const baro = baroLabel(view), mid = (x0 + x1) / 2 + 0.01 * s, by2 = bot + 0.06 * s;
    // The transition reminder: Airbus's setting pulses.
    const pulse = !!view?.state?.baroAlert && Math.floor(performance.now() / 400) % 2 === 0;
    ctx.font = font(s * 0.036);
    if (baro.std) {
      ctx.fillStyle = C.cyan; ctx.textAlign = 'center';
      if (!pulse) ctx.fillText('STD', mid, by2);
      const w = ctx.measureText('STD').width + 0.02 * s;
      ctx.strokeStyle = C.yellow; ctx.lineWidth = Math.max(1.5, s * 0.004);
      ctx.strokeRect(mid - w / 2, by2 - 0.026 * s, w, 0.052 * s);
    } else {
      const lab = 'QNH ', val = String(baro.hpa), lw = ctx.measureText(lab).width, x = mid - (lw + ctx.measureText(val).width) / 2;
      ctx.textAlign = 'left';
      ctx.fillStyle = C.white; ctx.fillText(lab, x, by2);
      ctx.fillStyle = C.cyan; if (!pulse) ctx.fillText(val, x + lw, by2);
    }
  }

  // ---- vertical speed (needle on a non-linear scale, ±6,000 ft/min) ----
  function drawVs(s, st, yc) {
    const x0 = 0.855 * s, x1 = 0.93 * s, half = 0.25 * s;
    const vs = st.vs * FPM;
    const map = (v) => {
      const a = Math.abs(v), sg = Math.sign(v);
      const f = a <= 1000 ? 0.45 * a / 1000 : a <= 2000 ? 0.45 + 0.25 * (a - 1000) / 1000 : 0.7 + 0.3 * Math.min(1, (a - 2000) / 4000);
      return sg * f * half;
    };
    ctx.fillStyle = 'rgba(70,76,82,0.9)';
    ctx.beginPath();
    ctx.moveTo(x0, yc - half - 0.02 * s); ctx.lineTo(x0 + 0.03 * s, yc - half - 0.02 * s); ctx.lineTo(x1, yc - 0.08 * s);
    ctx.lineTo(x1, yc + 0.08 * s); ctx.lineTo(x0 + 0.03 * s, yc + half + 0.02 * s); ctx.lineTo(x0, yc + half + 0.02 * s); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C.white; ctx.fillStyle = C.white; ctx.lineWidth = Math.max(1.2, s * 0.003);
    ctx.font = font(s * 0.032); ctx.textAlign = 'left';
    for (const v of [-6000, -2000, -1500, -1000, -500, 0, 500, 1000, 1500, 2000, 6000]) {
      const y = yc - map(v), major = v % 1000 === 0;
      ctx.beginPath(); ctx.moveTo(x0 + 0.012 * s, y); ctx.lineTo(x0 + (major ? 0.028 : 0.02) * s, y); ctx.stroke();
      if (major && v !== 0) ctx.fillText(String(Math.abs(v / 1000)), x0 + 0.001 * s, y);
    }
    ctx.fillStyle = C.yellow; ctx.fillRect(x0 + 0.012 * s, yc - 1.5, 0.02 * s, 3);
    const warn = Math.abs(vs) > 6000 || (st.agl * FT < 2500 && vs < -2000 && !st.onGround) || (st.agl * FT < 1000 && vs < -1200 && !st.onGround);
    const col = warn ? C.amber : C.green;
    const yt = yc - map(clamp(vs, -6500, 6500));
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, s * 0.006);
    ctx.beginPath(); ctx.moveTo(x1 + 0.05 * s, yc); ctx.lineTo(x0 + 0.02 * s, yt); ctx.stroke();
    if (Math.abs(vs) >= 200) {
      const txt = String(Math.round(Math.abs(vs) / 100)).padStart(2, '0');
      ctx.font = font(s * 0.036, true);
      const tw = ctx.measureText(txt).width + 0.008 * s;
      const ty = clamp(yt + (vs > 0 ? -0.03 : 0.03) * s, yc - half, yc + half);
      ctx.fillStyle = '#000'; ctx.fillRect(x0 + 0.03 * s, ty - 0.02 * s, tw, 0.04 * s);
      ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.fillText(txt, x0 + 0.034 * s, ty);
    }
  }

  // ---- heading tape ----
  function drawHeading(s, st, ap, ils) {
    const cx = 0.43 * s, hw = 0.2 * s, y0 = 0.835 * s, h = 0.065 * s;
    const hdg = magDeg(st.hdg, st.pos.x, st.pos.y);
    const pd = (hw * 2) / 50; // px per degree
    const X = (d) => cx + angDiff(d, hdg) * pd;
    ctx.save();
    ctx.fillStyle = 'rgba(70,76,82,0.9)'; ctx.fillRect(cx - hw, y0, hw * 2, h);
    ctx.beginPath(); ctx.rect(cx - hw, y0 - 0.03 * s, hw * 2, h + 0.06 * s); ctx.clip();
    ctx.strokeStyle = C.white; ctx.fillStyle = C.white; ctx.lineWidth = Math.max(1.2, s * 0.003);
    ctx.textAlign = 'center';
    for (let d = Math.floor((hdg - 30) / 5) * 5; d <= hdg + 30; d += 5) {
      const x = X(wrap360(d)), major = d % 10 === 0;
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + (major ? 0.02 : 0.011) * s); ctx.stroke();
      if (major) {
        const n = Math.round(wrap360(d) / 10);
        ctx.font = font(n % 3 === 0 ? s * 0.042 : s * 0.034);
        ctx.fillText(String(n), x, y0 + 0.042 * s);
      }
    }
    // ILS course (magenta), track diamond (green), selected heading (cyan).
    if (ils && ils.visible) {
      const x = X(ils.courseMag);
      ctx.strokeStyle = C.magenta; ctx.lineWidth = Math.max(2, s * 0.005);
      ctx.beginPath(); ctx.moveTo(x, y0 - 0.025 * s); ctx.lineTo(x, y0 + 0.012 * s); ctx.stroke();
    }
    if (st.gs > 5) {
      const trk = magDeg(Math.atan2(st.vel.x, st.vel.y), st.pos.x, st.pos.y);
      const x = X(trk);
      ctx.strokeStyle = C.green; ctx.lineWidth = Math.max(1.5, s * 0.004);
      ctx.beginPath(); ctx.moveTo(x, y0 + 0.002 * s); ctx.lineTo(x + 0.01 * s, y0 + 0.015 * s); ctx.lineTo(x, y0 + 0.028 * s); ctx.lineTo(x - 0.01 * s, y0 + 0.015 * s); ctx.closePath(); ctx.stroke();
    }
    const sel = ap.hdgDeg;
    const selOn = sel !== undefined && Math.abs(angDiff(sel, hdg)) < 24;
    if (selOn) {
      const x = X(sel);
      ctx.fillStyle = C.cyan; ctx.beginPath();
      ctx.moveTo(x, y0 + 0.002 * s); ctx.lineTo(x - 0.013 * s, y0 - 0.022 * s); ctx.lineTo(x + 0.013 * s, y0 - 0.022 * s); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    if (sel !== undefined && !selOn) {
      ctx.fillStyle = C.cyan; ctx.font = font(s * 0.04); ctx.textAlign = 'center';
      const right = angDiff(sel, hdg) > 0;
      ctx.fillText(String(Math.round(wrap360(sel)) || 360).padStart(3, '0'), right ? cx + hw - 0.03 * s : cx - hw + 0.03 * s, y0 - 0.02 * s);
    }
    ctx.strokeStyle = C.yellow; ctx.lineWidth = Math.max(2, s * 0.005);
    ctx.beginPath(); ctx.moveTo(cx, y0 - 0.02 * s); ctx.lineTo(cx, y0 + 0.03 * s); ctx.stroke();
  }

  // ---- flight mode annunciator ----
  function drawFma(s, st, ap, now) {
    const h = 0.118 * s, cw = s / 5;
    const athr = !!ap.athr, apOn = !!ap.ap;
    let thr = '', athrArmed = false;
    // A/THR is active only with the levers at or below CL; beyond it, it's armed (cyan) and thrust is manual.
    if (athr && (st.detent === 'TOGA' || st.detent === 'FLX/MCT') && !/TOGA LK|A\.FLOOR/.test(ap.thrustMode || '')) {
      athrArmed = true; thr = st.detent === 'TOGA' ? 'MAN TOGA' : st.onGround ? 'MAN FLX' : 'MAN MCT';
    } else if (athr) thr = ap.thrustMode || 'SPEED';
    else if (st.detent === 'TOGA') thr = 'MAN TOGA';
    else if (st.detent === 'FLX/MCT' && !st.onGround) thr = 'MAN MCT';
    else if (st.detent === 'FLX/MCT') thr = 'MAN FLX';
    const vert = apOn ? ap.vertical || '' : '';
    const lat = apOn ? ap.lateral || 'HDG' : '';
    trackModes({ thr, vert, lat, ap: apOn ? 'AP1' : '', athr: athr ? 'A/THR' : '' }, now);

    ctx.strokeStyle = '#9aa3aa'; ctx.lineWidth = Math.max(1, s * 0.0025);
    ctx.beginPath();
    for (let i = 1; i < 5; i++) { ctx.moveTo(i * cw, 0.01 * s); ctx.lineTo(i * cw, h); }
    ctx.stroke();
    const row = (i) => 0.024 * s + i * 0.038 * s;
    ctx.textAlign = 'center';
    const text = (col, r, t, color, key) => {
      if (!t) return;
      ctx.font = font(s * 0.033, true); ctx.fillStyle = color;
      const x = col * cw + cw / 2, y = row(r);
      ctx.fillText(t, x, y);
      if (key && boxed(key, now)) {
        const tw = ctx.measureText(t).width + 0.016 * s;
        ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1, s * 0.0028);
        ctx.strokeRect(x - tw / 2, y - 0.017 * s, tw, 0.034 * s);
      }
    };
    text(0, 0, thr, thr.startsWith('MAN') ? C.white : C.green, 'thr');
    if (vert === 'V/S') {
      ctx.font = font(s * 0.033, true);
      const v = Math.round(ap.vsFpm || 0), vt = (v >= 0 ? '+' : '') + v;
      const w1 = ctx.measureText('V/S ').width, w2 = ctx.measureText(vt).width, x = cw + cw / 2 - (w1 + w2) / 2;
      ctx.textAlign = 'left';
      ctx.fillStyle = C.green; ctx.fillText('V/S ', x, row(0));
      ctx.fillStyle = C.cyan; ctx.fillText(vt, x + w1, row(0));
      ctx.textAlign = 'center';
      if (boxed('vert', now)) { ctx.strokeStyle = C.white; ctx.strokeRect(x - 0.008 * s, row(0) - 0.017 * s, w1 + w2 + 0.016 * s, 0.034 * s); }
    } else text(1, 0, vert, C.green, 'vert');
    // Armed altitude capture (cyan, row 2) while climbing or descending to the FCU altitude.
    if (apOn && /OP CLB|OP DES|V\/S/.test(vert)) text(1, 1, 'ALT', C.cyan);
    text(2, 0, lat, C.green, 'lat');
    if ((st.law || 'normal') !== 'normal') text(3, 2, 'ALTN LAW', C.amber);
    text(4, 0, apOn ? 'AP1' : '', C.white, 'ap');
    text(4, 2, athr ? 'A/THR' : '', athrArmed ? C.cyan : C.white, 'athr');
    if (!apOn && st.warnings?.apDisc && Math.floor(now / 400) % 2) text(4, 0, 'AP OFF', C.red);
  }

  // ---- raw ILS deviation scales ----
  function drawIls(s, yc, ils) {
    const cx = 0.43 * s, dot = 0.045 * s;
    // Localizer (horizontal, under the sphere).
    const ly = 0.785 * s, gx = 0.68 * s;
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.2, s * 0.003);
    for (const k of [-2, -1, 1, 2]) {
      ctx.beginPath(); ctx.arc(cx + k * dot, ly, 0.0075 * s, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(gx, yc + k * dot, 0.0075 * s, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = C.yellow; ctx.fillRect(cx - 1.5, ly - 0.016 * s, 3, 0.032 * s); ctx.fillRect(gx - 0.016 * s, yc - 1.5, 0.032 * s, 3);
    const diamond = (x, y, half) => {
      ctx.beginPath(); ctx.moveTo(x - half, y); ctx.lineTo(x, y - half * 0.7); ctx.lineTo(x + half, y); ctx.lineTo(x, y + half * 0.7); ctx.closePath();
    };
    const lx = clamp(ils.locDots, -2.3, 2.3), gy = clamp(ils.gsDots, -2.3, 2.3);
    ctx.lineWidth = Math.max(1.5, s * 0.004);
    ctx.strokeStyle = C.magenta; ctx.fillStyle = C.magenta;
    diamond(cx + lx * dot, ly, 0.016 * s); Math.abs(ils.locDots) > 2.3 ? ctx.stroke() : ctx.fill();
    ctx.save(); ctx.translate(gx, yc + gy * dot); ctx.rotate(Math.PI / 2); diamond(0, 0, 0.016 * s); ctx.restore();
    Math.abs(ils.gsDots) > 2.3 ? ctx.stroke() : ctx.fill();
  }

  // Bottom-left: the destination runway, its course and the distance (magenta).
  function drawIlsInfo(s, ils) {
    if (!ils) return;
    ctx.fillStyle = C.magenta; ctx.font = font(s * 0.034); ctx.textAlign = 'left';
    ctx.fillText(`${ils.icao} ${ils.ident}`.trim(), 0.012 * s, 0.9 * s);
    ctx.fillText(`${String(Math.round(ils.courseMag) || 360).padStart(3, '0')}°  ${ils.distNm < 100 ? ils.distNm.toFixed(1) : Math.round(ils.distNm)}NM`, 0.012 * s, 0.94 * s);
  }

  return { update, draw };
}
