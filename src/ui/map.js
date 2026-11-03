// The path map (M): a full-window overlay with the coastline, the airports and runways,
// the aircraft, the line to the destination through dragged waypoints, and, with the
// autopilot on, the predicted path in a bright colour. Click the path to jump there,
// or skip to a 15 nm final. North up. Nothing here ever says you're off course.
// v0.2.1: Change route (or a click on an airport) picks a new destination and runway in flight.
//
// createMap(root, { airports, coast }) -> { open(), close(), toggle(), isOpen, update(view),
//   setPrediction(samples), onjump(sample), onskipfinal(), onroute(icao, ident) -> { ok, error? },
//   openRoute(icao?), setCoast(coast), waypoints, setWaypoints(list) }

import { C, font, KT, FT, NM, DEG, clamp, airportList, thresholdOf, buildCoast, traceRings, route, setWaypoints, altLabel, magDeg } from './common.js';
import { MAP_EXTENT } from '../world/frame.js';
import { fuelEstimate } from './setup.js';

const PRED = '#c6ff2e';      // the predicted path: bright lime
const PRED_GLOW = 'rgba(198,255,46,0.55)';

export function createMap(root, { airports, coast } = {}) {
  const el = document.createElement('div');
  el.className = 'fsui-map';
  el.hidden = true;
  el.innerHTML = `
    <canvas></canvas>
    <div class="fsui-map-bar">
      <div class="fsui-map-title">MAP</div>
      <button class="fsui-b" data-a="centre" tabindex="-1">Centre</button>
      <button class="fsui-b" data-a="clear" tabindex="-1">Clear waypoints</button>
      <button class="fsui-b" data-a="route" tabindex="-1">Change route</button>
      <button class="fsui-b primary" data-a="final" tabindex="-1">Skip to 15 nm final</button>
      <button class="fsui-b" data-a="close" tabindex="-1">Close (M)</button>
    </div>
    <div class="fsui-map-info"></div>
    <div class="fsui-map-help">Drag to pan · pinch or wheel to zoom<br>Drag the magenta line to add a waypoint · double-click a waypoint to remove it<br>Click the bright path to jump there · click an airport to fly there instead</div>
    <div class="fsui-tip" hidden></div>
    <div class="fsui-confirm" hidden><div class="q"></div><div class="row">
      <button class="fsui-b" data-a="no" tabindex="-1">Cancel</button><button class="fsui-b primary" data-a="yes" tabindex="-1">Jump</button></div></div>
    <div class="fsui-route" hidden>
      <div class="fsui-route-h">Change the route</div>
      <div class="fsui-route-row"><span class="lab">To</span><div class="fsui-seg" data-r="apt"></div></div>
      <div class="fsui-route-row"><span class="lab">Runway</span><div class="fsui-seg" data-r="rwy"></div></div>
      <div class="fsui-route-note"></div>
      <div class="row"><button class="fsui-b" data-a="rcancel" tabindex="-1">Cancel</button><button class="fsui-b primary" data-a="rset" tabindex="-1">Fly there</button></div>
    </div>`;
  root.appendChild(el);
  const canvas = el.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const info = el.querySelector('.fsui-map-info');
  const tip = el.querySelector('.fsui-tip');
  const confirmEl = el.querySelector('.fsui-confirm');
  const routeEl = el.querySelector('.fsui-route');
  let coastL = coast ? buildCoast(coast) : null;

  let W = 0, H = 0, dpr = 1;
  let cx = 0, cy = 0, k = 1 / 1000;      // view centre (map m) and px per metre
  let view = null, samples = [], pending = null, hover = null, dirty = true, raf = 0, lastDraw = 0;
  let isOpen = false, lastSig = '';

  const api = {
    open, close, toggle, update, setPrediction, setCoast,
    get isOpen() { return isOpen; },
    get waypoints() { return route.waypoints; },
    setWaypoints(list) { setWaypoints(list); redraw(); },
    onjump: null, onskipfinal: null, onroute: null,
    openRoute: (icao) => openRoute(icao),
    get routeOpen() { return !routeEl.hidden; },
    // Dev hook: open the jump confirm at a fraction along the path.
    _devScreen(x, y) { const r = canvas.getBoundingClientRect(); return [r.left + X(x), r.top + Y(y)]; },
    _devConfirm(f) { const i = Math.floor(clamp(f, 0, 1) * (ahead().length - 1)); const s = ahead()[i]; if (s) showConfirm(s); },
    // Dev hook: a point on an airport's label (its ICAO code), in page px.
    _devLabel(icao) {
      const a = airportList(airports).find((x) => x.icao === icao), L = a && labelOf(a), r = canvas.getBoundingClientRect();
      return L ? [r.left + L.x + (L.left ? -12 : 12), r.top + L.y] : null;
    },
  };

  const X = (x) => W / 2 + (x - cx) * k, Y = (y) => H / 2 - (y - cy) * k;
  const toMapXY = (sx, sy) => [cx + (sx - W / 2) / k, cy - (sy - H / 2) / k];

  function sizeCanvas() {
    const r = el.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  }

  function routePts() {
    if (!view?.state) return [];
    const st = view.state, pts = [[st.pos.x, st.pos.y], ...(view.waypoints || route.waypoints)];
    if (view.dest) pts.push(thresholdOf(view.dest));
    return pts;
  }
  const ahead = () => (view?.state ? samples.filter((s) => s.t >= view.state.t - 0.01) : samples);

  function fit() {
    const pts = routePts();
    if (!pts.length) { cx = 0; cy = 0; k = Math.min(W, H) / 800000; return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts.concat(ahead().map((s) => [s.x, s.y]))) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const span = Math.max(x1 - x0, y1 - y0, 60000);
    cx = (x0 + x1) / 2; cy = (y0 + y1) / 2;
    k = Math.min((W - 160) / Math.max(x1 - x0, 30000), (H - 200) / Math.max(y1 - y0, 30000), Math.min(W, H) / span);
  }

  function open() {
    if (isOpen) return;
    isOpen = true; el.hidden = false; sizeCanvas(); fit(); hideConfirm(); redraw();
  }
  function close() { if (!isOpen) return; isOpen = false; el.hidden = true; hideConfirm(); closeRoute(); tip.hidden = true; }
  function toggle() { isOpen ? close() : open(); }
  function setCoast(c) { coastL = c ? buildCoast(c) : null; redraw(); }
  function setPrediction(list) { samples = Array.isArray(list) ? list : []; hover = null; redraw(); }

  function update(v) {
    view = v;
    if (!isOpen || !v?.state) return;
    const st = v.state, ap = v.ap || {};
    const sig = [Math.round(X(st.pos.x)), Math.round(Y(st.pos.y)), Math.round(st.hdg * 50), ap.ap, ap.hdgDeg, ap.altFt, v.timeScale,
      Math.round((v.timeScaleActual || 0) * 10), v.paused, Math.round(st.t / 2), v.dest?.ident].join();
    if (sig !== lastSig) { lastSig = sig; redraw(); }
  }

  function redraw() {
    dirty = true;
    if (!isOpen || raf) return;
    const wait = Math.max(0, 1000 / 30 - (performance.now() - lastDraw));
    raf = setTimeout(() => requestAnimationFrame(() => { raf = 0; if (dirty && isOpen) draw(); }), wait);
  }

  // ---- drawing ----
  function draw() {
    dirty = false; lastDraw = performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#06101c'; ctx.fillRect(0, 0, W, H);
    const box = { x0: cx - W / 2 / k, x1: cx + W / 2 / k, y0: cy - H / 2 / k, y1: cy + H / 2 / k };
    const tf = (x, y, o) => { o[0] = X(x); o[1] = Y(y); return o; };
    if (coastL) {
      const lod = coastL.lod(1 / k);
      ctx.beginPath(); traceRings(ctx, coastL.land, lod, box, tf, 1.5 / k);
      ctx.fillStyle = '#1c2a22'; ctx.fill('evenodd');
      ctx.strokeStyle = '#46775a'; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); traceRings(ctx, coastL.water, lod, box, tf, 2 / k);
      ctx.fillStyle = '#0b2236'; ctx.fill('evenodd');
    }
    // The edge of the world data.
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.setLineDash([6, 6]);
    ctx.strokeRect(X(MAP_EXTENT.x0), Y(MAP_EXTENT.y1), (MAP_EXTENT.x1 - MAP_EXTENT.x0) * k, (MAP_EXTENT.y1 - MAP_EXTENT.y0) * k);
    ctx.setLineDash([]);

    drawAirports();
    const st = view?.state;
    // The line to the destination (magenta), with its waypoints.
    const pts = routePts();
    if (pts.length > 1 && view?.dest) {
      ctx.strokeStyle = C.magenta; ctx.lineWidth = 2.5;
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.stroke();
      // 15 nm final fix on the extended centreline.
      const h = (view.dest.hdgGridDeg || 0) * DEG, [tx, ty] = pts[pts.length - 1];
      const fx = tx - Math.sin(h) * 15 * NM, fy = ty - Math.cos(h) * 15 * NM;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.2; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(X(tx), Y(ty)); ctx.lineTo(X(fx), Y(fy)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.white; ctx.beginPath(); ctx.arc(X(fx), Y(fy), 3, 0, Math.PI * 2); ctx.fill();
      ctx.font = font(11); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('15 NM FINAL', X(fx) + 6, Y(fy));
      const wps = view.waypoints || route.waypoints;
      wps.forEach(([x, y], i) => {
        ctx.fillStyle = '#000'; ctx.strokeStyle = C.magenta; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(X(x), Y(y), 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = C.white; ctx.font = font(10, true); ctx.textAlign = 'center'; ctx.fillText(String(i + 1), X(x), Y(y) + 0.5);
      });
    }
    // The predicted path (bright), with a time mark every 5 minutes.
    const ah = ahead();
    if (ah.length > 1 && st) {
      ctx.save();
      ctx.shadowColor = PRED_GLOW; ctx.shadowBlur = 10;
      ctx.strokeStyle = PRED; ctx.lineWidth = 3.5; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(X(st.pos.x), Y(st.pos.y)); for (const s of ah) ctx.lineTo(X(s.x), Y(s.y)); ctx.stroke();
      ctx.restore();
      ctx.font = font(11, true); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      let nextMark = 5;
      for (const s of ah) {
        const m = (s.t - st.t) / 60;
        if (m >= nextMark) {
          ctx.fillStyle = PRED; ctx.beginPath(); ctx.arc(X(s.x), Y(s.y), 4, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(0,0,0,0.65)'; const t = `+${nextMark}`; const tw = ctx.measureText(t).width;
          ctx.fillRect(X(s.x) + 7, Y(s.y) - 8, tw + 6, 16);
          ctx.fillStyle = PRED; ctx.fillText(t, X(s.x) + 10, Y(s.y));
          nextMark += m > 30 ? 10 : 5;
        }
      }
      if (hover) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.fillStyle = PRED;
        ctx.beginPath(); ctx.arc(X(hover.x), Y(hover.y), 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      if (pending?.jump) {
        const s = pending.jump;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.fillStyle = PRED;
        ctx.beginPath(); ctx.arc(X(s.x), Y(s.y), 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      // The path ends in the terrain: a red cross at the impact, dashed from the last sample.
      const end = ah[ah.length - 1];
      if (end.terrain) {
        const p = end.impact || end, ix = X(p.x), iy = Y(p.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(X(end.x), Y(end.y)); ctx.lineTo(ix, iy); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(ix - 7, iy - 7); ctx.lineTo(ix + 7, iy + 7); ctx.moveTo(ix + 7, iy - 7); ctx.lineTo(ix - 7, iy + 7); ctx.stroke();
      }
    }
    if (st) drawAircraft(st);
    drawScale();
    drawInfo();
  }

  function drawAirports() {
    for (const apt of airportList(airports)) {
      const rws = apt.runways || [];
      ctx.lineCap = 'butt';
      for (const rw of rws) {
        const [a, b] = rw.ends;
        ctx.strokeStyle = '#d8d8d8'; ctx.lineWidth = Math.max(2.5, (rw.widthM || 45) * k);
        ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke();
        if (k > 0.004) { // close in: runway end idents
          ctx.fillStyle = C.white; ctx.font = font(11); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          for (const [e, o] of [[a, b], [b, a]]) {
            const L = Math.hypot(o.x - e.x, o.y - e.y) || 1, d = 14 / k;
            ctx.fillText(e.ident, X(e.x - (o.x - e.x) / L * d), Y(e.y - (o.y - e.y) / L * d));
          }
        }
      }
      const isDest = view?.dest && rws.some((r) => r.ends.includes(view.dest));
      const L = labelOf(apt);
      ctx.font = font(13, true); ctx.textAlign = L.left ? 'right' : 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = isDest ? C.magenta : C.cyan;
      ctx.fillText(apt.icao, L.x, L.y);
      ctx.font = font(11); ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillText(apt.name || '', L.x, L.y + 14);
    }
  }
  // Where an airport's label goes (screen px): to the right, or to the left when a neighbour
  // lies close to the east (Incheon by Gimpo).
  function labelOf(apt) {
    const rws = apt.runways || [];
    const [ox, oy] = apt.origin || [rws[0]?.ends[0].x || 0, rws[0]?.ends[0].y || 0];
    const left = airportList(airports).some((b) => b !== apt && b.origin && b.origin[0] > ox && Math.hypot(b.origin[0] - ox, b.origin[1] - oy) * k < 260);
    const off = Math.max(12, 2200 * k);
    return { x: X(ox) + (left ? -off : off), y: Y(oy) - off, left };
  }
  // The airport whose label is under the pointer. Labels come first, ahead of the lines over
  // them: they're what you aim at to pick an airport.
  function hitLabel(sx, sy) {
    for (const apt of airportList(airports)) {
      const L = labelOf(apt);
      ctx.font = font(13, true);
      const w = Math.max(ctx.measureText(apt.icao).width, (ctx.font = font(11), ctx.measureText(apt.name || '').width));
      const x0 = L.left ? L.x - w : L.x, x1 = L.left ? L.x : L.x + w;
      if (sx >= x0 - 4 && sx <= x1 + 4 && sy >= L.y - 10 && sy <= L.y + 22) return apt;
    }
    return null;
  }
  // The airport one of whose runways is under the pointer (after the paths, which go first).
  function hitRunway(sx, sy) {
    for (const apt of airportList(airports)) {
      for (const rw of apt.runways || []) {
        const [a, b] = rw.ends;
        const ax = X(a.x), ay = Y(a.y), dx = X(b.x) - ax, dy = Y(b.y) - ay, L2 = dx * dx + dy * dy || 1;
        const t = clamp(((sx - ax) * dx + (sy - ay) * dy) / L2, 0, 1);
        if (Math.hypot(ax + t * dx - sx, ay + t * dy - sy) < Math.max(9, (rw.widthM || 45) * k / 2 + 5)) return apt;
      }
    }
    return null;
  }

  function drawAircraft(st) {
    ctx.save(); ctx.translate(X(st.pos.x), Y(st.pos.y)); ctx.rotate(st.hdg);
    ctx.fillStyle = C.yellow; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.lineTo(2, -6); ctx.lineTo(11, 1); ctx.lineTo(11, 4); ctx.lineTo(2, 1); ctx.lineTo(1.5, 8);
    ctx.lineTo(5, 11); ctx.lineTo(5, 13); ctx.lineTo(0, 11.5); ctx.lineTo(-5, 13); ctx.lineTo(-5, 11); ctx.lineTo(-1.5, 8);
    ctx.lineTo(-2, 1); ctx.lineTo(-11, 4); ctx.lineTo(-11, 1); ctx.lineTo(-2, -6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function drawScale() {
    const targetPx = 120, nmPx = NM * k;
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200];
    let n = steps[0]; for (const s of steps) if (s * nmPx <= targetPx) n = s;
    const w = n * nmPx, x = W - 24 - w, y = H - 74;
    ctx.strokeStyle = C.white; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y - 5); ctx.stroke();
    ctx.fillStyle = C.white; ctx.font = font(12); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${n} nm`, x + w / 2, y - 3);
  }

  function drawInfo() {
    const st = view?.state; if (!st) { info.innerHTML = ''; return; }
    const ap = view.ap || {};
    const lines = [];
    const pts = routePts();
    if (view.dest && pts.length > 1) {
      let d = 0; for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const icao = airportList(airports).find((a) => a.runways?.some((r) => r.ends.includes(view.dest)))?.icao || '';
      const ete = st.gs > 20 && !st.onGround ? ` · ETE <b>${fmtMin(d / st.gs / 60)}</b>` : '';
      lines.push(`To <b>${icao} ${view.dest.ident}</b>: <b>${Math.round(d / NM)}</b> nm${ete}`);
    }
    lines.push(`<b>${altLabel(st.pos.z * FT)}</b> · <b>${Math.round(st.ias * KT)}</b> kt IAS · GS <b>${Math.round(st.gs * KT)}</b> kt`);
    const ts = view.timeScale || 1, ta = view.timeScaleActual ?? ts;
    const rate = view.paused ? '<span class="amber">PAUSED</span>' : Math.abs(ta - ts) > 0.05 * ts ? `Sim rate <span class="amber">${ts}× (reaching ${ta.toFixed(1)}×)</span>` : `Sim rate <b>${ts}×</b>`;
    lines.push(rate);
    if (!ap.ap) lines.push('<span class="amber">Engage the autopilot to see the predicted path</span>');
    else if (!ahead().length) lines.push('Predicting the path…');
    const html = lines.join('<br>');
    if (info.innerHTML !== html) info.innerHTML = html;
  }
  const fmtMin = (m) => `${Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, '0')}`;

  // ---- interaction ----
  function hitWaypoint(sx, sy) {
    const wps = route.waypoints;
    for (let i = wps.length - 1; i >= 0; i--) if (Math.hypot(X(wps[i][0]) - sx, Y(wps[i][1]) - sy) < 10) return i;
    return -1;
  }
  function hitSegment(sx, sy) {
    const pts = routePts();
    if (!view?.dest) return -1;
    let best = -1, bd = 8;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = X(pts[i][0]), ay = Y(pts[i][1]), bx = X(pts[i + 1][0]), by = Y(pts[i + 1][1]);
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
      const t = clamp(((sx - ax) * dx + (sy - ay) * dy) / L, 0, 1);
      const d = Math.hypot(ax + t * dx - sx, ay + t * dy - sy);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  // The sample a click on the bright path picks: within 12 px of the line between two samples
  // (5 s of flight apart, so zoomed in they're far apart), the nearer of the two.
  function hitSample(sx, sy) {
    const a = ahead();
    let best = null, bd = 12;
    for (let i = 0; i < a.length; i++) {
      const px = X(a[i].x), py = Y(a[i].y);
      let d = Math.hypot(px - sx, py - sy), s = a[i];
      if (i + 1 < a.length) {
        const dx = X(a[i + 1].x) - px, dy = Y(a[i + 1].y) - py, L2 = dx * dx + dy * dy;
        if (L2 > 0) {
          const t = clamp(((sx - px) * dx + (sy - py) * dy) / L2, 0, 1);
          const ds = Math.hypot(px + t * dx - sx, py + t * dy - sy);
          if (ds < d) { d = ds; s = t < 0.5 ? a[i] : a[i + 1]; }
        }
      }
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  // A short note by the pointer, for a click that can't jump.
  let hintTimer = 0;
  function hint(text, sx, sy) {
    tip.textContent = text; tip.hidden = false;
    tip.style.left = Math.max(8, Math.min(sx + 14, W - 340)) + 'px'; tip.style.top = sy + 12 + 'px';
    clearTimeout(hintTimer); hintTimer = setTimeout(() => { tip.hidden = true; }, 4000);
  }

  let drag = null;
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault();
    if (e.button !== 0) return;
    const [sx, sy] = local(e);
    canvas.setPointerCapture(e.pointerId);
    const wi = hitWaypoint(sx, sy);
    if (wi >= 0) { drag = { kind: 'wp', i: wi, sx, sy, moved: false }; return; }
    // On an airport's label (or, below the paths, its runways): a click offers it as the new
    // destination; a drag still pans.
    const label = hitLabel(sx, sy);
    if (!label) {
      const sample = hitSample(sx, sy), seg = hitSegment(sx, sy);
      if (seg >= 0) { drag = { kind: 'seg', seg, sx, sy, moved: false, sample }; return; }
      if (sample) { drag = { kind: 'sample', sample, sx, sy, moved: false }; return; }
    }
    drag = { kind: 'pan', sx, sy, cx0: cx, cy0: cy, moved: false, airport: label || hitRunway(sx, sy) };
    canvas.classList.add('drag');
  });
  canvas.addEventListener('pointermove', (e) => {
    const [sx, sy] = local(e);
    if (!drag) {
      const label = hitLabel(sx, sy);
      const s = label ? null : hitSample(sx, sy), wp = hitWaypoint(sx, sy) >= 0 || (!label && hitSegment(sx, sy) >= 0);
      const apt = label || (s || wp ? null : hitRunway(sx, sy));
      canvas.classList.toggle('hot', !!(s || wp || apt));
      if (s !== hover) { hover = s; showTip(s, sx, sy); redraw(); } else if (s) showTip(s, sx, sy);
      if (!s && apt) {
        const isDest = apt.runways?.some((r) => r.ends.includes(view?.dest));
        tip.textContent = isDest ? `${apt.icao}: click to change the runway` : `${apt.icao}: click to fly there instead`;
        tip.hidden = false; tip.style.left = sx + 14 + 'px'; tip.style.top = sy + 12 + 'px';
        tipAirport = true;
      } else if (!s && tipAirport) { tip.hidden = true; tipAirport = false; }
      return;
    }
    if (Math.hypot(sx - drag.sx, sy - drag.sy) > 4) drag.moved = true;
    if (!drag.moved) return;
    if (drag.kind === 'pan') { cx = drag.cx0 - (sx - drag.sx) / k; cy = drag.cy0 + (sy - drag.sy) / k; redraw(); }
    else if (drag.kind === 'seg') {
      const wps = route.waypoints.slice(); wps.splice(drag.seg, 0, toMapXY(sx, sy)); setWaypoints(wps);
      drag = { kind: 'wp', i: drag.seg, sx, sy, moved: true }; redraw();
    } else if (drag.kind === 'wp') {
      const wps = route.waypoints.slice(); wps[drag.i] = toMapXY(sx, sy); setWaypoints(wps); redraw();
    }
  });
  const endDrag = (e) => {
    if (!drag) return;
    e.stopPropagation();
    const d = drag; drag = null; canvas.classList.remove('drag');
    if (!d.moved && (d.kind === 'sample' || (d.kind === 'seg' && d.sample))) showConfirm(d.sample);
    else if (!d.moved && d.kind === 'seg') hint(ahead().length
      ? 'Jumps go along the bright path. To jump along this line, turn the HDG towards it first.'
      : 'Turn the autopilot on (Z): its bright path is where you can jump to.', d.sx, d.sy);
    else if (!d.moved && d.kind === 'pan' && d.airport) openRoute(d.airport.icao);
    else if (!d.moved && d.kind === 'pan') hideConfirm();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { drag = null; canvas.classList.remove('drag'); });
  canvas.addEventListener('dblclick', (e) => {
    e.stopPropagation(); e.preventDefault();
    const [sx, sy] = local(e), wi = hitWaypoint(sx, sy);
    if (wi >= 0) { const wps = route.waypoints.slice(); wps.splice(wi, 1); setWaypoints(wps); redraw(); }
  });
  // Pinch (ctrlKey) or a mouse wheel zooms around the pointer; a two-finger swipe pans.
  el.addEventListener('wheel', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.target.closest('.fsui-confirm, .fsui-map-bar, .fsui-route')) return;
    const [sx, sy] = local(e);
    const mouse = !e.ctrlKey && e.deltaX === 0 && (e.deltaMode !== 0 || (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50));
    if (e.ctrlKey || mouse) {
      const before = toMapXY(sx, sy);
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0025) * (e.deltaMode === 1 ? 33 : 1));
      k = clamp(k * f, 1 / 4000, 1 / 2);
      const after = toMapXY(sx, sy);
      cx += before[0] - after[0]; cy += before[1] - after[1];
    } else { cx += e.deltaX / k; cy -= e.deltaY / k; }
    hideConfirm(); redraw();
  }, { passive: false });
  for (const t of ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'touchstart']) el.addEventListener(t, (e) => e.stopPropagation());
  el.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); }); // buttons never take focus

  el.querySelector('.fsui-map-bar').addEventListener('click', (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'close') close();
    else if (a === 'centre') { fit(); redraw(); }
    else if (a === 'clear') { setWaypoints([]); redraw(); }
    else if (a === 'route') { if (routeEl.hidden) openRoute(); else closeRoute(); }
    else if (a === 'final') { close(); api.onskipfinal?.(); }
  });
  confirmEl.addEventListener('click', (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'yes' && pending?.jump) { const s = pending.jump; hideConfirm(); close(); api.onjump?.(s); }
    else if (a === 'no') { hideConfirm(); }
  });

  function describe(s) {
    const m = Math.max(0, Math.round((s.t - (view?.state?.t ?? s.t)) / 60));
    return { time: `+${m} min`, alt: altLabel(s.z * FT) };
  }
  function showTip(s, sx, sy) {
    if (!s) { tip.hidden = true; return; }
    const d = describe(s);
    tip.textContent = `${d.time} · ${d.alt} · click to jump`;
    tip.hidden = false; tip.style.left = sx + 14 + 'px'; tip.style.top = sy + 12 + 'px';
  }
  function showConfirm(s) {
    pending = { jump: s };
    const d = describe(s);
    confirmEl.querySelector('.q').textContent = `Jump to ${d.time}, ${d.alt}?`;
    confirmEl.hidden = false; tip.hidden = true;
    const bw = 230, bh = 80;
    confirmEl.style.left = clamp(X(s.x) + 14, 8, W - bw - 8) + 'px';
    confirmEl.style.top = clamp(Y(s.y) - bh - 14, 60, H - bh - 8) + 'px';
    redraw();
  }
  function hideConfirm() { if (pending) { pending = null; redraw(); } confirmEl.hidden = true; }

  // ---- Changing the route (v0.2.1) ----
  // The panel under the bar: the destination, its runway, and what flying there takes. Fly
  // there hands it to main.js (onroute), which may say no (after landing, say).
  let pick = null;            // { icao, ident } chosen in the panel
  let tipAirport = false;     // the tip is showing an airport's hint
  const destAirport = () => airportList(airports).find((a) => a.runways?.some((r) => r.ends.includes(view?.dest))) || null;
  const shortName = (a) => (a.name || '').replace(/ International Airport$| Airport$/, '').replace(/^Seoul /, '');
  const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  // The runway end you'd fly straight in to from here: the one whose landing direction is
  // nearest the bearing from the aircraft to its threshold.
  function straightIn(apt) {
    const st = view?.state;
    let best = null, bd = Infinity;
    for (const r of apt.runways || []) {
      for (const [e, o] of [[r.ends[0], r.ends[1]], [r.ends[1], r.ends[0]]]) {
        const [tx, ty] = thresholdOf(e), land = Math.atan2(o.x - e.x, o.y - e.y);
        const d = st ? Math.abs(wrapPi(land - Math.atan2(tx - st.pos.x, ty - st.pos.y))) : 0;
        if (d < bd) { bd = d; best = e.ident; }
      }
    }
    return best;
  }
  function openRoute(icao) {
    const list = airportList(airports), cur = destAirport();
    const apt = list.find((a) => a.icao === (icao || cur?.icao)) || list[0];
    if (!apt) return;
    pick = { icao: apt.icao, ident: apt === cur && view?.dest ? view.dest.ident : straightIn(apt) };
    hideConfirm(); tip.hidden = true; tipAirport = false;
    routeEl.hidden = false;
    fillRoute();
  }
  function closeRoute() { routeEl.hidden = true; pick = null; }
  function fillRoute(error = '') {
    if (!pick) return;
    const list = airportList(airports), apt = list.find((a) => a.icao === pick.icao);
    routeEl.querySelector('[data-r="apt"]').innerHTML = list.map((a) =>
      `<button data-icao="${a.icao}" class="${a.icao === pick.icao ? 'on' : ''}" tabindex="-1">${a.icao}<small>${shortName(a)}</small></button>`).join('');
    const ends = (apt.runways || []).flatMap((r) => r.ends.map((e) => ({ e, r })));
    routeEl.querySelector('[data-r="rwy"]').innerHTML = ends.map(({ e, r }) =>
      `<button data-ident="${e.ident}" class="${e.ident === pick.ident ? 'on' : ''}" title="${Math.round(r.lengthM || 0).toLocaleString()} m${e.ils ? ', ILS' : ''}" tabindex="-1">${e.ident}</button>`).join('');
    const sel = ends.find((x) => x.e.ident === pick.ident);
    const st = view?.state, lines = [];
    if (sel) {
      const same = view?.dest === sel.e;
      lines.push(`<b>${apt.icao} ${sel.e.ident}</b> · ${Math.round(sel.r.lengthM || 0).toLocaleString()} m${sel.e.ils ? ` · ILS CAT ${sel.e.ils}` : ''}${same ? ' · <span class="dim">your destination now</span>' : ''}`);
      if (st) {
        const [tx, ty] = thresholdOf(sel.e), nm = Math.hypot(tx - st.pos.x, ty - st.pos.y) / NM;
        const brg = Math.round(magDeg(Math.atan2(tx - st.pos.x, ty - st.pos.y), st.pos.x, st.pos.y)) || 360;
        lines.push(`<b>${Math.round(nm)}</b> nm direct, bearing <b>${String(brg).padStart(3, '0')}°</b>`);
        // Fuel: the setup's estimate for the trip, allowance for a climb included (on the safe
        // side from cruise), against what's on board.
        const need = Math.round(fuelEstimate(nm).trip / 100) * 100;
        const fob = Math.round(st.fuelKg / 100) * 100;
        const cls = fob < need ? 'bad' : fob < need + 1200 ? 'warn' : '';
        const what = cls === 'bad' ? 'not enough' : cls === 'warn' ? 'under the 1,200 kg reserve' : 'enough';
        lines.push(`Fuel <b>${fob.toLocaleString()}</b> kg; the trip takes about ${need.toLocaleString()} kg: <span class="${cls}">${what}</span>`);
      }
    }
    if (error) lines.push(`<span class="bad">${error}</span>`);
    routeEl.querySelector('.fsui-route-note').innerHTML = lines.join('<br>');
  }
  routeEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !pick) return;
    if (b.dataset.icao) {
      const apt = airportList(airports).find((a) => a.icao === b.dataset.icao), cur = destAirport();
      pick = { icao: apt.icao, ident: apt === cur && view?.dest ? view.dest.ident : straightIn(apt) };
      fillRoute();
    } else if (b.dataset.ident) { pick.ident = b.dataset.ident; fillRoute(); }
    else if (b.dataset.a === 'rcancel') closeRoute();
    else if (b.dataset.a === 'rset') {
      const res = api.onroute ? api.onroute(pick.icao, pick.ident) : { ok: false, error: 'Not available' };
      if (res && res.ok === false) fillRoute(res.error || 'That route can’t be set');
      else { closeRoute(); lastSig = ''; redraw(); }
    }
  });

  window.addEventListener('resize', () => { if (isOpen) { sizeCanvas(); redraw(); } });
  return api;
}
