// The Sky window (L, or Cmd/Ctrl+L): the time of day, like Satisfactory's Sky window.
// createSkyWindow(root, { clock, place: () => ({ lat, lon }) })
//   -> { open(), close(), toggle(), isOpen, update(), onclose }
// clock is createClock() from src/clock.js. In the window: a little sky (the sun's and the
// Moon's paths over the KST day at the aircraft's position, the horizon, the twilight bands,
// the Moon's phase), the time, the date with a day back, a day forward and Today, a 24-hour
// track to click or drag, play and pause, the clock's speed, and jumps to sunrise, noon,
// sunset, midnight and now. It stands aside at the bottom-left, under the PFD, and never
// takes the flight's keys: only Esc (which closes it, before the pause menu sees it).
// The lead calls update() every few frames while it's open; it redraws only when the minute,
// the place, or the clock's running or speed change. Styles: sky-window.css (fssw-*), which
// this module links itself if the page hasn't. The pure helpers below are tested in Node.

import { startOfKstDay, kstParts, kstMs, fmtKst, fmtKstDate } from '../clock.js';
import { sunHorizontal, moonHorizontal, moonPhase, sunEvents, moonEvents } from '../astro.js';

const DAY_MS = 86400e3;
const MIN_MS = 60e3;
const pad = (n) => String(n).padStart(2, '0');
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

// ---- pure helpers ----

// The sky's colours (0..1 rgb) at the zenith and on the horizon for a sun altitude (degrees):
// day blue, golden hour, sunset orange, the twilights, and night (never pure black).
const SKY_KEYS = [
  // [alt, zenith, horizon]
  [-90, [0.012, 0.018, 0.045], [0.025, 0.035, 0.075]],
  [-18, [0.012, 0.018, 0.045], [0.025, 0.035, 0.075]],
  [-12, [0.03, 0.05, 0.12], [0.07, 0.08, 0.17]],
  [-6, [0.07, 0.11, 0.25], [0.3, 0.2, 0.3]],
  [-2, [0.13, 0.2, 0.4], [0.78, 0.4, 0.3]],
  [2, [0.2, 0.33, 0.58], [0.98, 0.6, 0.36]],
  [8, [0.2, 0.42, 0.72], [0.85, 0.78, 0.66]],
  [20, [0.16, 0.42, 0.78], [0.63, 0.79, 0.93]],
  [90, [0.12, 0.38, 0.76], [0.6, 0.78, 0.94]],
];
export function skyColors(sunAltDeg) {
  const a = clamp(Number.isFinite(sunAltDeg) ? sunAltDeg : -90, -90, 90);
  let i = 0;
  while (i < SKY_KEYS.length - 2 && a > SKY_KEYS[i + 1][0]) i++;
  const [a0, z0, h0] = SKY_KEYS[i], [a1, z1, h1] = SKY_KEYS[i + 1];
  const t = clamp((a - a0) / (a1 - a0), 0, 1);
  return { zenith: z0.map((v, k) => lerp(v, z1[k], t)), horizon: h0.map((v, k) => lerp(v, h1[k], t)) };
}
export const rgb = (c) => `rgb(${c.map((v) => Math.round(clamp(v, 0, 1) * 255)).join(',')})`;

// The light's name for a sun altitude; rising picks dawn over dusk. -> { name, cls }
export function phaseOf(sunAltDeg, rising) {
  const a = sunAltDeg, dd = rising ? 'dawn' : 'dusk';
  if (a >= 6) return { name: 'Day', cls: 'day' };
  if (a >= -50 / 60) return { name: 'Golden hour', cls: 'golden' };
  if (a >= -6) return { name: rising ? 'Dawn' : 'Dusk', cls: dd };
  if (a >= -12) return { name: 'Nautical twilight', cls: 'twilight' };
  if (a >= -18) return { name: 'Astronomical twilight', cls: 'twilight' };
  return { name: 'Night', cls: 'night' };
}

// The time a point on the 24-hour track picks: the KST day starting at dayStart, f in 0..1,
// snapped to the minute and kept inside the day (00:00 to 23:59).
export function trackTime(dayStart, f) {
  const min = clamp(Math.round(clamp(f, 0, 1) * 1440), 0, 1439);
  return dayStart + min * MIN_MS;
}
// Where ms sits on its day's track, 0..1.
export const trackFraction = (ms) => (ms - startOfKstDay(ms)) / DAY_MS;

// A day back or forward, the same time of day (KST has no daylight saving).
export const shiftDays = (ms, n) => ms + n * DAY_MS;
// Today's date in KST (from nowMs), keeping ms's time of day.
export const todayKeepingTime = (ms, nowMs) => startOfKstDay(nowMs) + (ms - startOfKstDay(ms));

// "1×", "600×"
export const fmtSpeed = (s) => `${s}×`;

// "2 h 5 min", "12 min"
export function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / MIN_MS));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

// The KST values for <input type=date> and <input type=time>: { date: '2026-11-01', time: '21:34' }.
export function kstFieldValues(ms) {
  const p = kstParts(ms);
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}
// Back from those fields to epoch ms (the fields are KST whatever the Mac's timezone); null if malformed.
export function kstFromFields(date, time) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const t = /^(\d{1,2}):(\d{2})/.exec(String(time || ''));
  if (!d || !t) return null;
  const [y, mo, dd, h, mi] = [d[1], d[2], d[3], t[1], t[2]].map(Number);
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31 || h > 23 || mi > 59) return null;
  const ms = kstMs(y, mo, dd, h, mi);
  const back = kstParts(ms);
  return back.mo === mo && back.d === dd ? ms : null;   // 31 Feb doesn't roll into March
}

// The little sky's frame: azimuth across (N on both edges, E, S in the middle, W), the
// altitude up from the horizon at horizonY, and down to -30 degrees in the ground band.
export const SKY_BELOW_DEG = 30;
export function chartFrame(w, h) {
  const hy = Math.round(h * 0.72), top = 8;
  return {
    w, h, hy,
    x: (az) => (((az % 360) + 360) % 360) / 360 * w,
    y: (alt) => (alt >= 0 ? hy - (Math.min(alt, 90) / 90) * (hy - top) : hy + (Math.min(-alt, SKY_BELOW_DEG) / SKY_BELOW_DEG) * (h - hy)),
    pxPerDegX: w / 360, pxPerDegY: (hy - top) / 90,
  };
}

// The Moon's phase in words.
export function moonName(illum, waxing) {
  if (illum < 0.03) return 'New moon';
  if (illum > 0.97) return 'Full moon';
  const side = waxing ? 'waxing' : 'waning';
  if (illum < 0.45) return `${waxing ? 'Waxing' : 'Waning'} crescent`;
  if (illum <= 0.55) return waxing ? 'First quarter' : 'Last quarter';
  return `${side[0].toUpperCase() + side.slice(1)} gibbous`;
}

// ---- the window ----

const ICON = {
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="12" cy="12" r="4.6"/><path d="M11 1.5h2v4h-2zM11 18.5h2v4h-2zM1.5 11h4v2h-4zM18.5 11h4v2h-4zM4.1 5.5l1.4-1.4 2.8 2.8-1.4 1.4zM15.7 17.1l1.4-1.4 2.8 2.8-1.4 1.4zM4.1 18.5l2.8-2.8 1.4 1.4-2.8 2.8zM15.7 6.9l2.8-2.8 1.4 1.4-2.8 2.8z"/></g></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15.5 3.2a9 9 0 1 0 5.3 13.6A7.5 7.5 0 0 1 15.5 3.2z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 4.5h4.2v15H6zM13.8 4.5H18v15h-4.2z"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>',
};

// A fixed scatter of stars for the little sky (x, y in 0..1 of the sky above the horizon).
const STARS = (() => {
  let s = 20261101;
  const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  return Array.from({ length: 70 }, () => [r(), r() * 0.95, 0.4 + r() * 0.9, r()]);
})();

function linkCss() {
  if (typeof document === 'undefined') return;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => /sky-window\.css(\?|$)/.test(l.href))) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./sky-window.css', import.meta.url).href;
  document.head.appendChild(l);
}

export function createSkyWindow(root, { clock, place } = {}) {
  linkCss();
  const getPlace = () => {
    const p = place?.() || {};
    return { lat: Number.isFinite(p.lat) ? p.lat : 37.5665, lon: Number.isFinite(p.lon) ? p.lon : 126.978 };
  };
  const el = document.createElement('div');
  el.className = 'fssw';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Sky: time of day');
  const ticks = [0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => `<span style="left:${(h / 24) * 100}%">${pad(h)}</span>`).join('');
  el.innerHTML = `
    <div class="fssw-head"><span class="fssw-ico">${ICON.sun}</span><h2>Sky</h2><span class="fssw-sub">Time of day · KST</span>
      <button class="fssw-x" data-a="close" title="Close (L or Esc)">${ICON.x}</button></div>
    <div class="fssw-body">
      <canvas class="fssw-view"></canvas>
      <div class="fssw-clock">
        <div class="fssw-time"><b data-o="time">00:00</b><small>KST</small></div>
        <div class="fssw-phase"><span class="fssw-tag" data-o="tag">Day</span><em data-o="next"></em></div>
      </div>
      <div class="fssw-date">
        <button class="fssw-b fssw-b--icon" data-a="dayback" title="A day back (same time)">‹</button>
        <span data-o="date"></span>
        <button class="fssw-b fssw-b--icon" data-a="dayfwd" title="A day forward (same time)">›</button>
        <button class="fssw-b" data-a="today" title="Today's date in Korea, same time of day">Today</button>
      </div>
      <div class="fssw-track" data-o="track" title="Click or drag to set the time">
        <i class="fssw-mark fssw-mark--sun" data-o="noonMark">${ICON.sun}</i><i class="fssw-mark fssw-mark--moon" style="left:0%">${ICON.moon}</i><i class="fssw-mark fssw-mark--moon" style="left:100%">${ICON.moon}</i>
        <i class="fssw-now" data-o="now"></i>
      </div>
      <div class="fssw-ticks">${ticks}</div>
      <div class="fssw-row fssw-ctl">
        <button class="fssw-b fssw-play" data-a="play"></button>
        <div class="fssw-speed"><button class="fssw-b" data-a="slower" title="Slower">−</button><b data-o="speed" title="How fast the clock runs: 1× is real time, with the sim (time compression speeds it too)">1×</b><button class="fssw-b" data-a="faster" title="Faster">+</button></div>
      </div>
      <div class="fssw-row fssw-jump">
        <button class="fssw-b" data-a="sunrise">Sunrise<small data-o="tRise"></small></button>
        <button class="fssw-b" data-a="noon">Noon<small data-o="tNoon"></small></button>
        <button class="fssw-b" data-a="sunset">Sunset<small data-o="tSet"></small></button>
        <button class="fssw-b" data-a="midnight">Midnight<small>00:00</small></button>
        <button class="fssw-b" data-a="now" title="The real time in Korea">Now<small data-o="tNow"></small></button>
      </div>
    </div>
    <div class="fssw-foot"><span class="fssw-key">L</span><span class="fssw-key">Esc</span> Close · the flight's keys still work</div>`;
  root.appendChild(el);
  const o = (n) => el.querySelector(`[data-o="${n}"]`);
  const btn = (a) => el.querySelector(`[data-a="${a}"]`);
  const canvas = el.querySelector('.fssw-view');
  const track = o('track');

  let open = false, lastKey = '', lastCtl = '';
  const win = {
    onclose: null,
    get isOpen() { return open; },
    open() {
      if (open) return;
      open = true; el.hidden = false; lastKey = ''; lastCtl = '';
      update();
    },
    close() {
      if (!open) return;
      open = false; el.hidden = true; drag = null;
      if (el.contains(document.activeElement)) document.activeElement.blur();
      win.onclose?.();
    },
    toggle() { if (open) win.close(); else win.open(); },
    update: () => update(),
  };

  // ---- the day's sky, cached per KST day and place (0.1 degree) ----
  let day = null;
  function dayData(ms, p) {
    const t0 = startOfKstDay(ms);
    const key = `${t0}|${p.lat.toFixed(1)}|${p.lon.toFixed(1)}`;
    if (day?.key === key) return day;
    const sun = [], moon = [];
    for (let i = 0; i <= 144; i++) {
      const t = t0 + i * 600e3;
      const s = sunHorizontal(t, p.lat, p.lon), m = moonHorizontal(t, p.lat, p.lon);
      sun.push([s.azDeg, s.altRefractedDeg]); moon.push([m.azDeg, m.altRefractedDeg]);
    }
    // the track: the sky's colour through the day, every 15 minutes
    const stops = [];
    for (let i = 0; i <= 96; i++) {
      const c = skyColors(sun[Math.round(i * 1.5)][1]);
      const mid = c.zenith.map((v, k) => (v + c.horizon[k]) / 2);
      stops.push(`${rgb(mid)} ${((i / 96) * 100).toFixed(2)}%`);
    }
    day = { key, t0, sun, moon, ev: sunEvents(t0, p.lat, p.lon), moonEv: moonEvents(t0, p.lat, p.lon), next: null,
      trackBg: `linear-gradient(90deg, ${stops.join(', ')})` };
    return day;
  }
  // tomorrow's sunrise, for "Sunrise at ... in ..." after today's sunset
  let tomorrow = null;
  function tomorrowEvents(d, p) {
    const key = d.key;
    if (tomorrow?.key !== key) tomorrow = { key, ev: sunEvents(d.t0 + DAY_MS, p.lat, p.lon) };
    return tomorrow.ev;
  }

  // ---- drawing ----
  function update(force = false) {
    if (!open || !clock) return;
    const p = getPlace();
    const ms = clock.ms;
    const minute = Math.floor(ms / MIN_MS);
    const key = `${minute}|${p.lat.toFixed(2)}|${p.lon.toFixed(2)}|${canvas.clientWidth}x${canvas.clientHeight}`;
    const ctl = `${clock.running}|${clock.speed}`;
    if (ctl !== lastCtl || force) {
      lastCtl = ctl;
      const b = btn('play');
      b.innerHTML = clock.running ? `${ICON.pause}<span>Pause</span>` : `${ICON.play}<span>Play</span>`;
      b.classList.toggle('on', clock.running);
      b.title = clock.running ? 'Stop the clock' : 'Start the clock';
      o('speed').textContent = fmtSpeed(clock.speed);
      btn('slower').disabled = clock.speed <= 1;
      btn('faster').disabled = clock.speed >= 600;
    }
    if (key === lastKey && !force) return;
    lastKey = key;
    const d = dayData(ms, p);
    const sunNow = sunHorizontal(ms, p.lat, p.lon), moonNow = moonHorizontal(ms, p.lat, p.lon), ph = moonPhase(ms);
    const sunLater = sunHorizontal(ms + 10 * MIN_MS, p.lat, p.lon);
    const rising = sunLater.altDeg > sunNow.altDeg;

    // text
    o('time').textContent = fmtKst(ms);
    o('date').textContent = fmtKstDate(ms);
    const phase = phaseOf(sunNow.altRefractedDeg, rising);
    const tag = o('tag');
    tag.textContent = phase.name; tag.className = `fssw-tag fssw-tag--${phase.cls}`;
    const evs = [['Sunrise', d.ev.rise], ['Sunset', d.ev.set]].filter(([, t]) => t !== null && t > ms);
    if (!evs.length) { const tm = tomorrowEvents(d, p); if (tm.rise !== null) evs.push(['Sunrise tomorrow', tm.rise]); }
    o('next').textContent = evs.length ? `${evs[0][0]} ${fmtKst(evs[0][1])} · in ${fmtDur(evs[0][1] - ms)}` + (clock.running ? '' : ' · stopped') : '';
    const hm = (t) => (t === null ? '–' : fmtKst(t));
    o('tRise').textContent = hm(d.ev.rise); o('tNoon').textContent = hm(d.ev.noon); o('tSet').textContent = hm(d.ev.set);
    o('tNow').textContent = fmtKst(Date.now());
    btn('sunrise').disabled = d.ev.rise === null; btn('sunset').disabled = d.ev.set === null; btn('noon').disabled = d.ev.noon === null;
    if (track.dataset.bg !== d.key) { track.style.background = d.trackBg; track.dataset.bg = d.key; }
    o('now').style.left = `${(trackFraction(ms) * 100).toFixed(2)}%`;
    o('noonMark').style.left = `${(((d.ev.noon ?? d.t0 + DAY_MS / 2) - d.t0) / DAY_MS * 100).toFixed(2)}%`;
    o('noonMark').title = d.ev.noon ? `Noon ${fmtKst(d.ev.noon)}` : '';

    drawSky(d, sunNow, moonNow, ph);
  }

  function drawSky(d, sunNow, moonNow, ph) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const F = chartFrame(w, h), sAlt = sunNow.altRefractedDeg;

    // the sky, coloured for the sun's height now
    const col = skyColors(sAlt);
    let g = ctx.createLinearGradient(0, 0, 0, F.hy);
    g.addColorStop(0, rgb(col.zenith)); g.addColorStop(1, rgb(col.horizon));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, F.hy);
    // a warm glow on the horizon under the sun near sunrise and sunset
    if (sAlt > -12 && sAlt < 12) {
      const k = 1 - Math.abs(sAlt) / 12, sx = F.x(sunNow.azDeg);
      for (const off of [-w, 0, w]) {
        const rg = ctx.createRadialGradient(sx + off, F.hy, 0, sx + off, F.hy, w * 0.32);
        rg.addColorStop(0, `rgba(255,150,80,${(0.55 * k).toFixed(3)})`); rg.addColorStop(1, 'rgba(255,150,80,0)');
        ctx.fillStyle = rg; ctx.fillRect(0, 0, w, F.hy);
      }
    }
    // stars, fading in as the sun goes below -6
    const starA = clamp((-sAlt - 4) / 10, 0, 1);
    if (starA > 0) {
      for (const [sx, sy, r, tw] of STARS) {
        ctx.fillStyle = `rgba(235,240,255,${(starA * (0.45 + 0.55 * tw)).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(sx * w, 6 + sy * (F.hy - 12), r * 0.8, 0, Math.PI * 2); ctx.fill();
      }
    }

    // the ground band below the horizon, with the twilight bands (-6, -12, -18) marked in it
    g = ctx.createLinearGradient(0, F.hy, 0, h);
    g.addColorStop(0, '#1b2620'); g.addColorStop(1, '#0b100d');
    ctx.fillStyle = g; ctx.fillRect(0, F.hy, w, h - F.hy);
    const bands = [[0, -6, 'rgba(240,140,90,0.16)'], [-6, -12, 'rgba(120,110,190,0.13)'], [-12, -18, 'rgba(70,80,170,0.10)']];
    for (const [a, b, c] of bands) { ctx.fillStyle = c; ctx.fillRect(0, F.y(a), w, F.y(b) - F.y(a)); }
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    for (const a of [-6, -12, -18]) { ctx.beginPath(); ctx.moveTo(0, F.y(a) + 0.5); ctx.lineTo(w, F.y(a) + 0.5); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.moveTo(0, F.hy + 0.5); ctx.lineTo(w, F.hy + 0.5); ctx.stroke();

    // the paths across the day: dashed, dim below the horizon, broken where they wrap past north
    const path = (pts, rgbStr) => {
      for (const above of [true, false]) {
        ctx.strokeStyle = `rgba(${rgbStr},${above ? 0.75 : 0.28})`;
        ctx.lineWidth = above ? 1.6 : 1.2; ctx.setLineDash(above ? [5, 4] : [2, 4]);
        ctx.beginPath();
        let prev = null;
        for (const [az, alt] of pts) {
          const x = F.x(az), y = F.y(alt), up = alt >= 0;
          if (prev && Math.abs(x - prev[0]) < w / 2 && (up === above || prev[2] === above)) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          prev = [x, y, up];
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    };
    path(d.moon, '200,214,255');
    path(d.sun, '255,212,90');

    // the directions
    ctx.font = '600 10.5px Barlow, sans-serif'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    for (const [az, t] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W'], [360, 'N']]) {
      ctx.textAlign = az === 0 ? 'left' : az === 360 ? 'right' : 'center';
      ctx.fillText(t, F.x(az) + (az === 0 ? 4 : az === 360 ? -4 : 0) - (az === 360 ? 0 : 0), h - 2);
    }
    // sunrise and sunset as text, and the Moon's phase
    ctx.font = '600 11px Barlow, sans-serif'; ctx.textBaseline = 'top';
    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const hm = (t) => (t === null ? '–' : fmtKst(t));
    ctx.fillText(`↑ ${hm(d.ev.rise)}  ↓ ${hm(d.ev.set)}`, w - 6, 5);
    ctx.textAlign = 'left';
    ctx.fillText(`${moonName(ph.illum, ph.waxing)} · ${Math.round(ph.illum * 100)}%`, 6, 5);

    // the Moon: a disc lit on the side towards the sun
    const mx = F.x(moonNow.azDeg), my = F.y(moonNow.altRefractedDeg), sx = F.x(sunNow.azDeg), sy = F.y(sAlt);
    const dAz = wrap180(sunNow.azDeg - moonNow.azDeg) * F.pxPerDegX, dAlt = (sAlt - moonNow.altRefractedDeg) * F.pxPerDegY;
    drawMoon(ctx, mx, my, 7.5, ph.illum, Math.atan2(-dAlt, dAz), moonNow.altRefractedDeg >= 0);
    // the sun, with its glow
    const up = sAlt >= 0;
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 22);
    sg.addColorStop(0, `rgba(255,214,110,${up ? 0.9 : 0.35})`); sg.addColorStop(1, 'rgba(255,190,80,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = up ? '#ffe9a8' : 'rgba(255,214,120,0.55)';
    ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.fill();
  }

  // A Moon disc of radius r at (x, y): dark, lit fraction k on the side at screen angle a.
  function drawMoon(ctx, x, y, r, k, a, up) {
    ctx.save();
    ctx.translate(x, y);
    const glow = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 3);
    glow.addColorStop(0, `rgba(200,215,255,${(up ? 0.45 : 0.15) * (0.3 + 0.7 * k)})`); glow.addColorStop(1, 'rgba(200,215,255,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, r * 3, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(a);
    ctx.fillStyle = up ? '#2a3142' : 'rgba(42,49,66,0.6)';
    ctx.strokeStyle = 'rgba(220,228,255,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (k > 0.005) {
      const rx = r * Math.abs(1 - 2 * k);
      ctx.fillStyle = up ? '#f2f4ff' : 'rgba(242,244,255,0.5)';
      ctx.beginPath();
      ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);                     // the lit limb
      if (k < 0.5) ctx.ellipse(0, 0, rx, r, 0, Math.PI / 2, -Math.PI / 2, true);    // crescent
      else ctx.ellipse(0, 0, rx, r, 0, Math.PI / 2, Math.PI * 1.5, false);         // gibbous
      ctx.fill();
    }
    ctx.restore();
  }

  // ---- input ----
  // Any change to the clock tells the lead (win.onchange), so the 3D view follows at once,
  // also while the game is paused and draws only on demand.
  const changed = () => { update(true); win.onchange?.(); };
  const set = (ms) => { clock.set(ms); changed(); };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const p = getPlace(), d = dayData(clock.ms, p);
    switch (b.dataset.a) {
      case 'close': win.close(); break;
      case 'play': clock.setRunning(!clock.running); changed(); break;
      case 'slower': clock.slower(); changed(); break;
      case 'faster': clock.faster(); changed(); break;
      case 'dayback': set(shiftDays(clock.ms, -1)); break;
      case 'dayfwd': set(shiftDays(clock.ms, 1)); break;
      case 'today': set(todayKeepingTime(clock.ms, Date.now())); break;
      case 'sunrise': if (d.ev.rise !== null) set(d.ev.rise); break;
      case 'noon': if (d.ev.noon !== null) set(d.ev.noon); break;
      case 'sunset': if (d.ev.set !== null) set(d.ev.set); break;
      case 'midnight': set(d.t0); break;
      case 'now': set(Date.now()); break;
    }
  });
  // Drag along the track: the day stays the one the drag started on.
  let drag = null;
  const seek = (e) => {
    const r = track.getBoundingClientRect();
    set(trackTime(drag.t0, (e.clientX - r.left) / r.width));
  };
  track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { t0: startOfKstDay(clock.ms), id: e.pointerId };
    try { track.setPointerCapture(e.pointerId); } catch {}
    seek(e);
  });
  track.addEventListener('pointermove', (e) => { if (drag && e.pointerId === drag.id) seek(e); });
  const endDrag = () => { drag = null; };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);

  // Clicks and the wheel stay in the window; buttons never take the focus (so Space and
  // Enter keep going to the game, not to the last button clicked).
  el.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  for (const t of ['pointerdown', 'dblclick', 'contextmenu']) el.addEventListener(t, (e) => e.stopPropagation());
  el.addEventListener('wheel', (e) => { e.stopPropagation(); e.preventDefault(); }, { passive: false });

  // Esc closes the window first: only that Esc stops here, so the pause menu doesn't open.
  // Every other key goes on to the game. (L is the lead's toggle.)
  window.addEventListener('keydown', (e) => {
    if (!open || e.key !== 'Escape' || document.body.classList.contains('in-menu')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable) && !el.contains(t)) return;
    e.preventDefault(); e.stopPropagation();
    win.close();
  }, true);
  window.addEventListener('resize', () => { if (open) update(); });

  return win;
}
