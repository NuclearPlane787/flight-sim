// The ND: an ARC-mode moving map, heading up. Coastline, airports and runways, the
// magenta line to the destination through any waypoints, the heading bug, track,
// GS/TAS, the wind and the destination's bearing, distance and time. Range 10…160 nm.

import { C, font, KT, NM, DEG, clamp, wrap360, angDiff, magDeg, airportList, thresholdOf, traceRings, route } from './common.js';

export const ND_RANGES = [10, 20, 40, 80, 160];

// The wind as the pilot reads it, from the sim's state.wind (map axes, m/s, the direction the air is
// GOING), using its mean part so the readout doesn't jitter with the gusts and the turbulence:
// { dirDeg (magnetic, FROM, whole degrees 0-359), kt (whole), goingRad (grid, the way the arrow points) }.
// Null if there's no wind data.
export function windReadout(wind, x, y) {
  if (!wind) return null;
  const mx = wind.meanX ?? wind.x ?? 0, my = wind.meanY ?? wind.y ?? 0;
  const kt = Math.round(Math.hypot(mx, my) * KT);
  const dirDeg = kt > 0 ? Math.round(magDeg(Math.atan2(-mx, -my), x, y)) % 360 : 0;
  return { dirDeg, kt, goingRad: Math.atan2(mx, my) };
}

// The wind only reads above 100 kt of true airspeed, on both makers' NDs (the air data can't tell it
// below that, and it's dashes or blank).
export const WIND_MIN_TAS_KT = 100;
const AIRBUS_ARROW_MIN_KT = 2;

// The Airbus ND's text: "270/25", dashes below 100 kt TAS, "000/0" in calm air. Its arrow goes under 2 kt.
export function airbusWindText(w, tasKt) {
  if (!w || tasKt < WIND_MIN_TAS_KT) return '---/---';
  return `${String(w.dirDeg).padStart(3, '0')}/${w.kt}`;
}
export const airbusWindArrow = (w, tasKt) => !!w && tasKt >= WIND_MIN_TAS_KT && w.kt >= AIRBUS_ARROW_MIN_KT;

// A wind arrow: a shaft and head centred on (x, y), pointing where the air is going, on a heading-up
// map (`a` is that direction less the heading, clockwise from up). `len` is the whole length in px.
export function drawWindArrow(ctx, x, y, a, len, col, lineW) {
  const sx = Math.sin(a), sy = -Math.cos(a), h = len / 2, hd = len * 0.36;
  const tipX = x + sx * h, tipY = y + sy * h;
  ctx.strokeStyle = col; ctx.lineWidth = lineW; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - sx * h, y - sy * h); ctx.lineTo(tipX, tipY);
  ctx.moveTo(tipX - hd * (sx * 0.82 + sy * 0.57), tipY - hd * (sy * 0.82 - sx * 0.57)); ctx.lineTo(tipX, tipY);
  ctx.lineTo(tipX - hd * (sx * 0.82 - sy * 0.57), tipY - hd * (sy * 0.82 + sx * 0.57));
  ctx.stroke();
  ctx.lineCap = 'butt';
}

export function createNd(cv, { airports, coast }) {
  const { ctx } = cv;
  let rangeIdx = 2;
  const nd = {
    get range() { return ND_RANGES[rangeIdx]; },
    setRange(nm) { const i = ND_RANGES.indexOf(nm); if (i >= 0) rangeIdx = i; },
    zoom(dir) { rangeIdx = clamp(rangeIdx + dir, 0, ND_RANGES.length - 1); },
    cycle() { rangeIdx = (rangeIdx + 1) % ND_RANGES.length; },
    coast,
    draw,
  };

  function draw(view) {
    const s = cv.w, st = view.state, ap = view.ap || {};
    cv.begin();
    ctx.textBaseline = 'middle';
    const cx = 0.5 * s, cy = 0.78 * s, R = 0.6 * s;
    const range = ND_RANGES[rangeIdx];
    const k = R / (range * NM);                  // px per map metre
    const h = st.hdg, ch = Math.cos(h), sh = Math.sin(h);
    const px = st.pos.x, py = st.pos.y;
    const tf = (x, y, out) => {
      const dx = x - px, dy = y - py;
      out[0] = cx + (dx * ch - dy * sh) * k;
      out[1] = cy - (dx * sh + dy * ch) * k;
      return out;
    };
    const P = [0, 0];
    const reach = range * NM * 1.4;
    const box = { x0: px - reach, y0: py - reach, x1: px + reach, y1: py + reach };
    const hm = magDeg(h, px, py);

    // Everything on the map, clipped to the arc's area.
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.04, 0, Math.PI * 2); ctx.clip();
    ctx.beginPath(); ctx.rect(0, 0, s, cy + 0.2 * s); ctx.clip();
    if (nd.coast) {
      const lod = nd.coast.lod(1 / k);
      ctx.beginPath(); traceRings(ctx, nd.coast.land, lod, box, tf, 2 / k);
      ctx.fillStyle = '#16231c'; ctx.fill('evenodd');
      ctx.strokeStyle = '#3e6b4f'; ctx.lineWidth = Math.max(1, s * 0.0025); ctx.stroke();
      ctx.beginPath(); traceRings(ctx, nd.coast.water, lod, box, tf, 3 / k);
      ctx.fillStyle = '#0d1a2a'; ctx.fill('evenodd');
    }
    // Range rings: half range dashed.
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1, s * 0.0025);
    ctx.setLineDash([s * 0.012, s * 0.012]);
    ctx.beginPath(); ctx.arc(cx, cy, R / 2, Math.PI, 2 * Math.PI); ctx.stroke();
    ctx.setLineDash([]);

    // Airports and runways.
    for (const apt of airportList(airports)) {
      const [ax, ay] = apt.origin || [apt.runways?.[0]?.ends[0].x, apt.runways?.[0]?.ends[0].y];
      if (Math.abs(ax - px) > reach || Math.abs(ay - py) > reach) continue;
      tf(ax, ay, P);
      if (range <= 40) {
        ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.2, s * 0.003);
        for (const rw of apt.runways || []) {
          const [a, b] = rw.ends;
          const ang = Math.atan2(b.x - a.x, b.y - a.y), w = Math.max(rw.widthM || 45, 3.5 / k);
          const ox = Math.cos(ang) * w / 2, oy = -Math.sin(ang) * w / 2;
          const q = [[a.x + ox, a.y + oy], [b.x + ox, b.y + oy], [b.x - ox, b.y - oy], [a.x - ox, a.y - oy]].map(([x, y]) => tf(x, y, [0, 0]));
          ctx.beginPath(); q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
          if (range <= 20) {
            ctx.fillStyle = C.white; ctx.font = font(s * 0.028); ctx.textAlign = 'center';
            for (const e of rw.ends) {
              const o = rw.ends[0] === e ? rw.ends[1] : rw.ends[0];
              const L = Math.hypot(o.x - e.x, o.y - e.y) || 1, ux = (o.x - e.x) / L, uy = (o.y - e.y) / L;
              // Parallel runways: push L idents to the left and R idents to the right of the end.
              const side = /L$/.test(e.ident) ? 1 : /R$/.test(e.ident) ? -1 : 0, off = side * 0.03 * s / k;
              tf(e.x - ux * 0.035 * s / k - uy * off, e.y - uy * 0.035 * s / k + ux * off, P);
              ctx.fillText(e.ident, P[0], P[1]);
            }
          }
        }
        tf(ax, ay, P);
      }
      // Airport star symbol (magenta) and ident.
      ctx.strokeStyle = C.magenta; ctx.lineWidth = Math.max(1.5, s * 0.004);
      const r = s * 0.014;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 4; ctx.moveTo(P[0] - Math.cos(a) * r, P[1] - Math.sin(a) * r); ctx.lineTo(P[0] + Math.cos(a) * r, P[1] + Math.sin(a) * r); }
      ctx.stroke();
      ctx.fillStyle = C.magenta; ctx.font = font(s * 0.034); ctx.textAlign = 'left';
      ctx.fillText(apt.icao, P[0] + r * 1.4, P[1] + r * 1.2);
    }

    // The line to the destination, through the waypoints.
    const wps = view.waypoints || route.waypoints;
    let dest = null;
    if (view.dest) {
      dest = thresholdOf(view.dest);
      const pts = [[px, py], ...wps, dest];
      ctx.strokeStyle = C.magenta; ctx.lineWidth = Math.max(2, s * 0.005);
      ctx.beginPath();
      pts.forEach(([x, y], i) => { tf(x, y, P); i ? ctx.lineTo(P[0], P[1]) : ctx.moveTo(P[0], P[1]); });
      ctx.stroke();
      // Extended centreline, 10 nm, dashed white.
      const hd = (view.dest.hdgGridDeg || 0) * DEG;
      ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1, s * 0.0025); ctx.setLineDash([s * 0.01, s * 0.01]);
      tf(dest[0], dest[1], P); ctx.beginPath(); ctx.moveTo(P[0], P[1]);
      tf(dest[0] - Math.sin(hd) * 10 * NM, dest[1] - Math.cos(hd) * 10 * NM, P); ctx.lineTo(P[0], P[1]); ctx.stroke();
      ctx.setLineDash([]);
      // Waypoints: green diamonds.
      ctx.strokeStyle = C.green; ctx.lineWidth = Math.max(1.5, s * 0.004);
      for (const [x, y] of wps) {
        tf(x, y, P); const r = s * 0.012;
        ctx.beginPath(); ctx.moveTo(P[0], P[1] - r); ctx.lineTo(P[0] + r, P[1]); ctx.lineTo(P[0], P[1] + r); ctx.lineTo(P[0] - r, P[1]); ctx.closePath(); ctx.stroke();
      }
    }
    // The taxi route (gate starts and after landing), in the ground line's green-yellow.
    const tr = view.taxiRoute;
    if (tr && tr.length > 1) {
      ctx.strokeStyle = '#c8ff2a'; ctx.lineWidth = Math.max(2, s * 0.005);
      ctx.beginPath();
      tr.forEach(([x, y], i) => { tf(x, y, P); i ? ctx.lineTo(P[0], P[1]) : ctx.moveTo(P[0], P[1]); });
      ctx.stroke();
    }
    // Selected heading line (cyan dashed) while the autopilot flies HDG.
    if (ap.ap && ap.hdgDeg !== undefined) {
      const a = angDiff(ap.hdgDeg, hm) * DEG;
      ctx.strokeStyle = C.cyan; ctx.lineWidth = Math.max(1.5, s * 0.004); ctx.setLineDash([s * 0.015, s * 0.012]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // Compass arc with magnetic headings, every 5° ticks, labels every 10°.
    ctx.strokeStyle = C.white; ctx.fillStyle = C.white; ctx.lineWidth = Math.max(1.5, s * 0.004);
    ctx.beginPath(); ctx.arc(cx, cy, R, (-90 - 48) * DEG, (-90 + 48) * DEG); ctx.stroke();
    ctx.lineWidth = Math.max(1.2, s * 0.003); ctx.textAlign = 'center';
    for (let d = Math.ceil((hm - 50) / 5) * 5; d <= hm + 50; d += 5) {
      const a = (d - hm) * DEG;
      if (Math.abs(a) > 48 * DEG) continue;
      const major = d % 10 === 0, l = major ? 0.03 * s : 0.016 * s;
      const sx = Math.sin(a), sy = -Math.cos(a);
      ctx.beginPath(); ctx.moveTo(cx + sx * R, cy + sy * R); ctx.lineTo(cx + sx * (R + l), cy + sy * (R + l)); ctx.stroke();
      if (major) {
        const n = Math.round(wrap360(d) / 10);
        ctx.font = font(n % 3 === 0 ? s * 0.042 : s * 0.032);
        ctx.save(); ctx.translate(cx + sx * (R + 0.055 * s), cy + sy * (R + 0.055 * s)); ctx.rotate(a);
        ctx.fillText(String(n), 0, 0); ctx.restore();
      }
    }
    // Lubber line (yellow) at the top.
    ctx.strokeStyle = C.yellow; ctx.lineWidth = Math.max(2.5, s * 0.006);
    ctx.beginPath(); ctx.moveTo(cx, cy - R - 0.005 * s); ctx.lineTo(cx, cy - R - 0.045 * s); ctx.stroke();
    // Track diamond (green).
    if (st.gs > 5) {
      const trk = magDeg(Math.atan2(st.vel.x, st.vel.y), px, py);
      const a = angDiff(trk, hm) * DEG;
      if (Math.abs(a) < 48 * DEG) {
        ctx.save(); ctx.translate(cx + Math.sin(a) * (R - 0.012 * s), cy - Math.cos(a) * (R - 0.012 * s)); ctx.rotate(a);
        ctx.strokeStyle = C.green; ctx.lineWidth = Math.max(1.5, s * 0.004);
        ctx.beginPath(); ctx.moveTo(0, -0.014 * s); ctx.lineTo(0.01 * s, 0); ctx.lineTo(0, 0.014 * s); ctx.lineTo(-0.01 * s, 0); ctx.closePath(); ctx.stroke();
        ctx.restore();
      }
    }
    // Heading bug (cyan), or its value at the edge when it's off the arc.
    if (ap.hdgDeg !== undefined) {
      const a = angDiff(ap.hdgDeg, hm) * DEG;
      if (Math.abs(a) <= 48 * DEG) {
        ctx.save(); ctx.translate(cx + Math.sin(a) * R, cy - Math.cos(a) * R); ctx.rotate(a);
        ctx.fillStyle = C.cyan; ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(-0.014 * s, -0.03 * s); ctx.lineTo(0.014 * s, -0.03 * s); ctx.closePath(); ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = C.cyan; ctx.font = font(s * 0.038); ctx.textAlign = a > 0 ? 'right' : 'left';
        ctx.fillText(String(Math.round(wrap360(ap.hdgDeg)) || 360).padStart(3, '0'), a > 0 ? s * 0.975 : s * 0.025, a > 0 ? 0.18 * s : 0.1 * s);
      }
    }
    // Ring labels (cyan).
    ctx.fillStyle = C.cyan; ctx.font = font(s * 0.032); ctx.textAlign = 'center';
    ctx.fillText(String(range / 2), cx - R / 2 * 0.73, cy - R / 2 * 0.68);
    ctx.fillText(String(range), cx - R * 0.6, cy - R * 0.62);

    // Own aircraft (yellow), at the centre of the arc.
    ctx.strokeStyle = C.yellow; ctx.lineWidth = Math.max(2.5, s * 0.006);
    ctx.beginPath();
    ctx.moveTo(cx, cy - 0.035 * s); ctx.lineTo(cx, cy + 0.045 * s);
    ctx.moveTo(cx - 0.04 * s, cy - 0.005 * s); ctx.lineTo(cx + 0.04 * s, cy - 0.005 * s);
    ctx.moveTo(cx - 0.015 * s, cy + 0.035 * s); ctx.lineTo(cx + 0.015 * s, cy + 0.035 * s);
    ctx.stroke();

    // Top left: GS and TAS, and under them the wind: direction/speed and its arrow (Airbus's way).
    ctx.textAlign = 'left'; ctx.font = font(s * 0.036);
    const lab = (t, v, x, y) => {
      ctx.fillStyle = C.white; ctx.fillText(t, x, y);
      const w = ctx.measureText(t + ' ').width;
      ctx.fillStyle = C.green; ctx.font = font(s * 0.042); ctx.fillText(v, x + w, y); ctx.font = font(s * 0.036);
      return w + ctx.measureText(v).width * 1.2;
    };
    const w1 = lab('GS', String(Math.round(st.gs * KT)), 0.025 * s, 0.04 * s);
    lab('TAS', String(Math.round(st.tas * KT)), 0.025 * s + w1 + 0.03 * s, 0.04 * s);
    const wind = windReadout(st.wind, px, py), tasKt = st.tas * KT;
    ctx.fillStyle = C.green; ctx.font = font(s * 0.04); ctx.textAlign = 'left';
    ctx.fillText(airbusWindText(wind, tasKt), 0.025 * s, 0.09 * s);
    if (airbusWindArrow(wind, tasKt)) drawWindArrow(ctx, 0.06 * s, 0.15 * s, wind.goingRad - h, 0.06 * s, C.green, Math.max(1.5, s * 0.004));
    // Top right: destination, bearing/distance, time.
    if (dest) {
      const pts = [[px, py], ...wps, dest];
      let dist = 0; for (let i = 1; i < pts.length; i++) dist += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const nx = wps.length ? wps[0] : dest;
      const brg = magDeg(Math.atan2(nx[0] - px, nx[1] - py), px, py);
      const nm = dist / NM;
      ctx.textAlign = 'right';
      ctx.fillStyle = C.white; ctx.font = font(s * 0.038);
      ctx.fillText((view.destInfo?.airport?.icao || '') + view.dest.ident, 0.975 * s, 0.04 * s);
      ctx.fillStyle = C.green; ctx.fillText(`${String(Math.round(brg) || 360).padStart(3, '0')}°  ${nm < 100 ? nm.toFixed(1) : Math.round(nm)} NM`, 0.975 * s, 0.085 * s);
      if (st.gs > 20 && !st.onGround) {
        const min = dist / st.gs / 60;
        ctx.fillText(`ETE ${Math.floor(min / 60)}:${String(Math.floor(min % 60)).padStart(2, '0')}`, 0.975 * s, 0.13 * s);
      }
    }
    // Bottom: the selected range and how to change it.
    ctx.textAlign = 'left'; ctx.fillStyle = C.cyan; ctx.font = font(s * 0.032);
    ctx.fillText(`RNG ${range}`, 0.025 * s, 0.96 * s);
  }

  return nd;
}
