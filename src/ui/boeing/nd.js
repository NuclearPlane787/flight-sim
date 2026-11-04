// The Boeings' ND, MAP mode: the compass arc across the top with the heading in a box, a white
// aircraft triangle with its track line, dashed range arcs, the magenta route, airports as cyan
// circles. Heading up, as the A321's (a real one is track up by default; with no wind they're the same).
//
// Same interface as ../nd.js: createBoeingNd(cv, { airports, coast }) -> { range, setRange, zoom,
// cycle, coast, draw(view) }, and it reads the same view (waypoints, dest, taxiRoute).

import { C, font, KT, NM, DEG, clamp, wrap360, angDiff, magDeg, airportList, thresholdOf, traceRings, route } from '../common.js';
import { ND_RANGES } from '../nd.js';

export function createBoeingNd(cv, { airports, coast }) {
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
  const ARC = 50 * DEG;    // how far either side of the heading the arc is drawn

  function draw(view) {
    const s = cv.w, st = view.state, ap = view.ap || {};
    cv.begin();
    ctx.textBaseline = 'middle';
    const cx = 0.5 * s, cy = 0.86 * s, R = 0.7 * s;
    const range = ND_RANGES[rangeIdx];
    const k = R / (range * NM);
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
    const wps = view.waypoints || route.waypoints;

    // Everything on the map, inside the arc.
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    if (nd.coast) {
      const lod = nd.coast.lod(1 / k);
      ctx.beginPath(); traceRings(ctx, nd.coast.land, lod, box, tf, 2 / k);
      ctx.fillStyle = '#10201a'; ctx.fill('evenodd');
      ctx.strokeStyle = '#35604a'; ctx.lineWidth = Math.max(1, s * 0.0025); ctx.stroke();
      ctx.beginPath(); traceRings(ctx, nd.coast.water, lod, box, tf, 3 / k);
      ctx.fillStyle = '#0a1622'; ctx.fill('evenodd');
    }
    // The range arcs, dashed, at each quarter.
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1, s * 0.0022);
    ctx.setLineDash([s * 0.01, s * 0.014]);
    for (const f of [0.25, 0.5, 0.75]) { ctx.beginPath(); ctx.arc(cx, cy, R * f, -Math.PI / 2 - ARC, -Math.PI / 2 + ARC); ctx.stroke(); }
    ctx.setLineDash([]);

    // Airports: cyan circles, with their runways in white when close enough.
    for (const apt of airportList(airports)) {
      const [ax, ay] = apt.origin || [apt.runways?.[0]?.ends[0].x, apt.runways?.[0]?.ends[0].y];
      if (Math.abs(ax - px) > reach || Math.abs(ay - py) > reach) continue;
      if (range <= 40) {
        ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.2, s * 0.003);
        for (const rw of apt.runways || []) {
          const [a, b] = rw.ends, ang = Math.atan2(b.x - a.x, b.y - a.y), w = Math.max(rw.widthM || 45, 3.5 / k);
          const ox = Math.cos(ang) * w / 2, oy = -Math.sin(ang) * w / 2;
          ctx.beginPath();
          tf(a.x + ox, a.y + oy, P); ctx.moveTo(P[0], P[1]);
          tf(b.x + ox, b.y + oy, P); ctx.lineTo(P[0], P[1]);
          tf(b.x - ox, b.y - oy, P); ctx.lineTo(P[0], P[1]);
          tf(a.x - ox, a.y - oy, P); ctx.lineTo(P[0], P[1]);
          ctx.closePath(); ctx.stroke();
          if (range <= 20) {
            ctx.fillStyle = C.white; ctx.font = font(s * 0.026); ctx.textAlign = 'center';
            for (const e of rw.ends) {
              const o = rw.ends[0] === e ? rw.ends[1] : rw.ends[0];
              const L = Math.hypot(o.x - e.x, o.y - e.y) || 1, ux = (o.x - e.x) / L, uy = (o.y - e.y) / L;
              const side = /L$/.test(e.ident) ? 1 : /R$/.test(e.ident) ? -1 : 0, off = side * 0.03 * s / k;
              tf(e.x - ux * 0.035 * s / k - uy * off, e.y - uy * 0.035 * s / k + ux * off, P);
              ctx.fillText(e.ident, P[0], P[1]);
            }
          }
        }
      }
      tf(ax, ay, P);
      const r = s * 0.013;
      ctx.strokeStyle = C.cyan; ctx.lineWidth = Math.max(1.5, s * 0.0035);
      ctx.beginPath(); ctx.arc(P[0], P[1], r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = C.cyan; ctx.font = font(s * 0.032); ctx.textAlign = 'left';
      ctx.fillText(apt.icao, P[0] + r * 1.5, P[1] + r * 1.2);
    }

    // The route, magenta to the destination, through the waypoints.
    let dest = null;
    if (view.dest) {
      dest = thresholdOf(view.dest);
      ctx.strokeStyle = C.magenta; ctx.lineWidth = Math.max(2, s * 0.005);
      ctx.beginPath(); tf(px, py, P); ctx.moveTo(P[0], P[1]);
      for (const w of wps) { tf(w[0], w[1], P); ctx.lineTo(P[0], P[1]); }
      tf(dest[0], dest[1], P); ctx.lineTo(P[0], P[1]);
      ctx.stroke();
      // The extended centreline, 10 nm, dashed white.
      const hd = (view.dest.hdgGridDeg || 0) * DEG;
      ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1, s * 0.0025); ctx.setLineDash([s * 0.01, s * 0.01]);
      tf(dest[0], dest[1], P); ctx.beginPath(); ctx.moveTo(P[0], P[1]);
      tf(dest[0] - Math.sin(hd) * 10 * NM, dest[1] - Math.cos(hd) * 10 * NM, P); ctx.lineTo(P[0], P[1]); ctx.stroke();
      ctx.setLineDash([]);
      // Waypoints: four-pointed stars, the next in magenta and the others in white.
      for (let i = 0; i < wps.length; i++) { tf(wps[i][0], wps[i][1], P); star(P[0], P[1], s * 0.016, i === 0 ? C.magenta : C.white, s); }
    }
    const tr = view.taxiRoute;
    if (tr && tr.length > 1) {
      ctx.strokeStyle = '#c8ff2a'; ctx.lineWidth = Math.max(2, s * 0.005);
      ctx.beginPath();
      for (let i = 0; i < tr.length; i++) { tf(tr[i][0], tr[i][1], P); i ? ctx.lineTo(P[0], P[1]) : ctx.moveTo(P[0], P[1]); }
      ctx.stroke();
    }
    // The selected heading line, magenta dashed, while the autopilot flies HDG SEL.
    if (ap.ap && ap.lateral === 'HDG SEL' && ap.hdgDeg !== undefined) {
      const a = angDiff(ap.hdgDeg, hm) * DEG;
      ctx.strokeStyle = C.magenta; ctx.lineWidth = Math.max(1.5, s * 0.0035); ctx.setLineDash([s * 0.015, s * 0.012]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R); ctx.stroke();
      ctx.setLineDash([]);
    }
    // The track line, from the aircraft to the arc, with a tick at half range.
    const trk = st.gs > 5 ? angDiff(magDeg(Math.atan2(st.vel.x, st.vel.y), px, py), hm) * DEG : 0;
    {
      const sx = Math.sin(trk), sy = -Math.cos(trk), m = R * 0.5, l = 0.012 * s;
      ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.3, s * 0.003);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + sx * R, cy + sy * R);
      ctx.moveTo(cx + sx * m - sy * l, cy + sy * m + sx * l); ctx.lineTo(cx + sx * m + sy * l, cy + sy * m - sx * l);
      ctx.stroke();
    }
    ctx.restore();

    // The compass arc: every 5°, numbered every 10°, inside the arc as Boeing's is.
    ctx.strokeStyle = C.white; ctx.fillStyle = C.white; ctx.lineWidth = Math.max(1.5, s * 0.0035);
    ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2 - ARC, -Math.PI / 2 + ARC); ctx.stroke();
    ctx.lineWidth = Math.max(1.2, s * 0.003); ctx.textAlign = 'center';
    for (let d = Math.ceil((hm - 50) / 5) * 5; d <= hm + 50; d += 5) {
      const a = (d - hm) * DEG;
      if (Math.abs(a) > ARC) continue;
      const major = d % 10 === 0, l = major ? 0.024 * s : 0.013 * s, sx = Math.sin(a), sy = -Math.cos(a);
      ctx.beginPath(); ctx.moveTo(cx + sx * R, cy + sy * R); ctx.lineTo(cx + sx * (R - l), cy + sy * (R - l)); ctx.stroke();
      if (major) {
        const n = Math.round(wrap360(d) / 10);
        ctx.font = font(n % 3 === 0 ? s * 0.038 : s * 0.029);
        ctx.save(); ctx.translate(cx + sx * (R - 0.05 * s), cy + sy * (R - 0.05 * s)); ctx.rotate(a);
        ctx.fillText(String(n), 0, 0); ctx.restore();
      }
    }
    // The selected heading's bug, on the arc or parked at its end.
    if (ap.hdgDeg !== undefined) {
      const raw = angDiff(ap.hdgDeg, hm) * DEG, a = clamp(raw, -ARC, ARC), w = 0.02 * s, H = 0.02 * s, y0 = -R - 0.002 * s;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
      ctx.strokeStyle = C.magenta; ctx.fillStyle = C.magenta; ctx.lineWidth = Math.max(1.5, s * 0.004);
      ctx.beginPath(); ctx.moveTo(-w, y0 - H); ctx.lineTo(-w, y0); ctx.lineTo(w, y0); ctx.lineTo(w, y0 - H); ctx.lineTo(0, y0 - H * 0.45); ctx.closePath();
      Math.abs(raw) <= ARC ? ctx.fill() : ctx.stroke();
      ctx.restore();
    }
    // The present heading in a box at the top, with the pointer down to the arc.
    {
      const t = String(Math.round(hm) || 360).padStart(3, '0'), bw = 0.1 * s, bh = 0.05 * s, by = 0.05 * s;
      ctx.fillStyle = '#000'; ctx.fillRect(cx - bw / 2, by, bw, bh);
      ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(1.3, s * 0.003); ctx.strokeRect(cx - bw / 2, by, bw, bh);
      ctx.fillStyle = C.white; ctx.font = font(s * 0.04, true); ctx.textAlign = 'center';
      ctx.fillText(t, cx, by + bh / 2);
      ctx.beginPath(); ctx.moveTo(cx, cy - R + 0.002 * s); ctx.lineTo(cx - 0.011 * s, by + bh + 0.002 * s); ctx.lineTo(cx + 0.011 * s, by + bh + 0.002 * s); ctx.closePath(); ctx.fill();
      ctx.font = font(s * 0.027); ctx.textAlign = 'right'; ctx.fillStyle = C.green; ctx.fillText('MAG', cx - bw / 2 - 0.012 * s, by + bh / 2);
      ctx.textAlign = 'left'; ctx.fillStyle = C.white; ctx.fillText('HDG', cx + bw / 2 + 0.012 * s, by + bh / 2);
    }
    // The range labels, on the half range's arc and the quarter's.
    ctx.fillStyle = C.white; ctx.font = font(s * 0.03); ctx.textAlign = 'center';
    ctx.save(); ctx.fillStyle = '#000';
    const lab = (txt, f) => {
      const a = -30 * DEG, x = cx + Math.sin(a) * R * f, y = cy - Math.cos(a) * R * f, w = ctx.measureText(txt).width + 0.01 * s;
      ctx.fillStyle = '#000'; ctx.fillRect(x - w / 2, y - 0.018 * s, w, 0.036 * s);
      ctx.fillStyle = C.white; ctx.fillText(txt, x, y);
    };
    lab(String(range / 2), 0.5);
    ctx.restore();

    // The aircraft: a white triangle at the arcs' centre, its tip on the map's position.
    ctx.strokeStyle = C.white; ctx.lineWidth = Math.max(2, s * 0.005);
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.moveTo(cx, cy - 0.006 * s); ctx.lineTo(cx - 0.024 * s, cy + 0.052 * s); ctx.lineTo(cx + 0.024 * s, cy + 0.052 * s); ctx.closePath(); ctx.fill(); ctx.stroke();

    // Top left: GS and TAS (no wind is modelled, so no wind readout).
    ctx.textAlign = 'left';
    const row = (t, v, x, y) => {
      ctx.fillStyle = C.white; ctx.font = font(s * 0.028); ctx.fillText(t, x, y);
      const w = ctx.measureText(t + ' ').width;
      ctx.font = font(s * 0.036); ctx.fillText(v, x + w, y);
    };
    row('GS', String(Math.round(st.gs * KT)), 0.022 * s, 0.04 * s);
    row('TAS', String(Math.round(st.tas * KT)), 0.022 * s, 0.085 * s);
    // Top right: the next point, its distance and the time to the destination.
    if (dest) {
      let dist = 0, ax = px, ay = py;
      for (const w of wps) { dist += Math.hypot(w[0] - ax, w[1] - ay); ax = w[0]; ay = w[1]; }
      dist += Math.hypot(dest[0] - ax, dest[1] - ay);
      const nm = dist / NM;
      ctx.textAlign = 'right';
      ctx.fillStyle = C.magenta; ctx.font = font(s * 0.032);
      ctx.fillText((view.destInfo?.airport?.icao || '') + ' ' + view.dest.ident, 0.978 * s, 0.04 * s);
      ctx.fillStyle = C.white; ctx.font = font(s * 0.034);
      ctx.fillText(`${nm < 100 ? nm.toFixed(1) : Math.round(nm)} NM`, 0.978 * s, 0.085 * s);
      if (st.gs > 20 && !st.onGround) {
        const min = dist / st.gs / 60;
        ctx.fillText(`${Math.floor(min / 60)}:${String(Math.floor(min % 60)).padStart(2, '0')} ETE`, 0.978 * s, 0.13 * s);
      }
    }
    ctx.textAlign = 'left'; ctx.fillStyle = C.white; ctx.font = font(s * 0.028);
    ctx.fillText(`RNG ${range}`, 0.022 * s, 0.965 * s);
  }

  function star(x, y, r, col, s) {
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, s * 0.0035);
    const q = r * 0.28;
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + q, y - q); ctx.lineTo(x + r, y); ctx.lineTo(x + q, y + q);
    ctx.lineTo(x, y + r); ctx.lineTo(x - q, y + q); ctx.lineTo(x - r, y); ctx.lineTo(x - q, y - q); ctx.closePath();
    ctx.stroke();
  }

  return nd;
}
