// v0.5.7: the home page's scene, the main menu's left side (ui/menu.js makes the title and the version; this adds the
// art behind them). White line art over a calm sky: a dashed flight path from a dot near the lower left to a dot near
// the upper right with an airliner flying it, shrinking into each dot and coming back the other way, its dashes flowing
// with it; a boarding pass and a suitcase floating; a skyline of the world's landmarks (ui/line-art.js) along the
// bottom, end to end, scrolling slowly from left to right as a loop. Styles in home.css (fsh-*).
// v0.5.8: the darker ground band starts exactly on the skyline's ground line (groundLineUp(), home.css's --line-up);
// the suitcase floats with the boarding pass on the path's upper-left side (floaterSpots()); 2 or 3 prints of the
// game's photos (PHOTOS, in assets/menu/) lie below and right of the path, tilted and overlapping a little, kept off
// the path, the dots, the title and the skyline (printSpots(), PRINT_SLOTS); more stars, some twinkling (TWINKLE), and
// an aurora of static gradients across the upper sky (AURORA curtains), drifting and shimmering.
//
//   const scene = createHomeScene(el, { head, backdrop });   el: the scene's box; head: the title's box, kept clear
//   scene.setActive(on)       on while the menu shows and nothing covers it (with the page visible, it moves)
//   scene.setBackdrop(name)   'night' | 'dusk' | 'blueprint' (BACKDROPS); scene.backdrop
//   scene.setTimeScale(k)     checks only: the plane and the CSS animations k times as fast
//   scene.state()             checks only: { running, frames, time, plane, tape, backdrop, … }
//
// The CPU rules (PLAN.md → CPU at runtime): the floating and the skyline are CSS animations of transforms (the
// compositor's); the plane and the dashes are drawn by requestAnimationFrame at most 30 times a second. Everything
// stops while the scene isn't active or the page is hidden. With prefers-reduced-motion it's a still: the plane
// mid-path, nothing moving. v0.5.8's twinkling, aurora and prints are CSS animations of transform and opacity only
// (no animated filters; the gradients, masks, borders and shadows are painted once into their layers), the photos
// decoded once and never reloaded, and they pause and stop with the rest (home.css's is-still and reduced-motion rules).

import { SKYLINE, ICONS } from './line-art.js';

export const BACKDROPS = ['night', 'dusk', 'blueprint'];
export const DEFAULT_BACKDROP = 'dusk';
// The plane: a leg of `leg` s each way, a `pause` s at each dot unseen, growing and shrinking over the first and last
// `grow` of a leg. The dashes flow at DASH px/s with it (DASH_PERIOD: their dash and gap), easing round at each dot.
export const PLANE = { leg: 14, pause: 1.6, grow: 0.16 };
export const DASH = 26, DASH_PERIOD = 12;
export const FPS = 30;
export const STROKE = 1.75;     // px, every line
export const TAPE_PX_S = 16;    // the skyline's speed

const smooth = (x) => x * x * (3 - 2 * x);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---- The geometry (pure, CSS px with y down; tests/home-scene.test.mjs) ----

// The skyline's height (about a fifth of the scene's, capped), its scale from SKYLINE's units, one tile's width, and
// the copies that cover the width with a tile to spare (the loop slides one tile).
export function skylineFit(w, h, { share = 0.2, min = 80, max = 210 } = {}) {
  const height = Math.round(clamp(h * share, min, max));
  const scale = height / SKYLINE.height;
  const tileW = SKYLINE.width * scale;
  return { height, scale, tileW, copies: Math.max(2, Math.ceil(w / tileW) + 1) };
}

// The route in the free area { x0, y0, x1, y1 } (left, top, right, bottom): a cubic Bézier from the lower left to the
// upper right, a gentle climb that leaves and arrives flatter than it climbs.
export function routeCurve({ x0, y0, x1, y1 }) {
  const w = x1 - x0, h = y1 - y0;
  const a = { x: x0 + 0.05 * w, y: y1 - 0.08 * h }, b = { x: x1 - 0.05 * w, y: y0 + 0.1 * h };
  const dx = b.x - a.x, dy = a.y - b.y;
  return [a, { x: a.x + 0.38 * dx, y: a.y - 0.08 * dy }, { x: a.x + 0.6 * dx, y: b.y + 0.12 * dy }, b];
}
export function bezier(c, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return { x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x, y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y };
}
function tangent(c, t) {
  const u = 1 - t;
  const x = 3 * u * u * (c[1].x - c[0].x) + 6 * u * t * (c[2].x - c[1].x) + 3 * t * t * (c[3].x - c[2].x);
  const y = 3 * u * u * (c[1].y - c[0].y) + 6 * u * t * (c[2].y - c[1].y) + 3 * t * t * (c[3].y - c[2].y);
  return Math.atan2(y, x);
}
export const curvePath = (c) => `M${c[0].x.toFixed(1)} ${c[0].y.toFixed(1)}C${c.slice(1).map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')}`;
// By arc length: at(u) for u from 0 (the lower-left dot) to 1 (the upper-right one) → { x, y, angle } (radians, the
// way from the lower left), so the plane flies at an even speed.
export function curveTable(c, n = 160) {
  const s = [0];
  let prev = c[0], len = 0;
  for (let i = 1; i <= n; i++) { const p = bezier(c, i / n); len += Math.hypot(p.x - prev.x, p.y - prev.y); s.push(len); prev = p; }
  return {
    length: len,
    at(u) {
      const want = clamp(u, 0, 1) * len;
      let lo = 0, hi = n;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] < want) lo = m; else hi = m; }
      const f = s[hi] > s[lo] ? (want - s[lo]) / (s[hi] - s[lo]) : 0;
      const t = (lo + f) / n;
      return { ...bezier(c, t), angle: tangent(c, t) };
    },
  };
}

// Where the plane is at `time` s: leg 0 from the lower-left dot, leg 1 back, and so on; `u` along the path from the
// lower-left dot, `dir` +1 outbound and −1 back, `scale` 0 at a dot (it vanishes there) to 1 clear of them.
export function planeAt(time, { leg, pause, grow } = PLANE) {
  const cycle = leg + pause, k = Math.floor(Math.max(0, time) / cycle), r = Math.max(0, time) - k * cycle;
  const dir = k % 2 === 0 ? 1 : -1;
  if (r >= leg) return { visible: false, dir, u: dir > 0 ? 1 : 0, scale: 0 };
  const p = r / leg, edge = Math.min(p, 1 - p) / grow;
  return { visible: true, dir, u: dir > 0 ? p : 1 - p, scale: edge >= 1 ? 1 : smooth(edge) };
}
// How far the dashes have flowed by `time` (in seconds of flow at full speed): forward on leg 0, back on leg 1, easing
// to a stop and round at each dot while the plane is unseen. Smooth, and back to 0 after every two legs.
export function dashTravel(time, { leg, pause } = PLANE) {
  const cycle = leg + pause, period = 2 * cycle, r = ((time % period) + period) % period;
  if (r < leg) return r;
  if (r < cycle) return leg + (pause * Math.sin((Math.PI * (r - leg)) / pause)) / Math.PI;
  if (r < cycle + leg) return leg - (r - cycle);
  return -(pause * Math.sin((Math.PI * (r - cycle - leg)) / pause)) / Math.PI;
}

// The free area, between the title and the skyline, inside the side margins: the route goes there, and the floaters
// around it: v0.5.8, the boarding pass and the suitcase both to the left of the path (above it), the prints below and
// to the right of it.
export function freeArea({ w, h, headBottom, groundTop, padX }) {
  return { x0: padX, y0: headBottom + Math.max(24, 0.05 * h), x1: w - padX * 0.9, y1: groundTop - Math.max(18, 0.035 * h) };
}
export function floaterSpots(box, c, { passW, caseH }) {
  const passH = passW * (ICONS.boardingPass.h / ICONS.boardingPass.w), caseW = caseH * (ICONS.suitcase.w / ICONS.suitcase.h);
  const fit = (x, y, w, hh) => ({ x: clamp(x, box.x0, box.x1 - w), y: clamp(y, box.y0, box.y1 - hh), w, h: hh });
  const t = curveTable(c, 60);
  const left = t.at(0.3), mid = t.at(0.62);
  // The normal to the left of the way (y down): (sin, −cos) of the angle. v0.5.8: the suitcase on the same side as the
  // pass, further along (up and to the right of it), where the climb leaves room under the title.
  const hh = box.y1 - box.y0;
  const nx = (q) => Math.sin(q.angle), ny = (q) => -Math.cos(q.angle);
  return {
    pass: fit(left.x + nx(left) * 0.3 * hh - passW / 2, left.y + ny(left) * 0.3 * hh - passH / 2, passW, passH),
    case: fit(mid.x + nx(mid) * 0.27 * hh - caseW / 2, mid.y + ny(mid) * 0.27 * hh - caseH / 2, caseW, caseH),
  };
}

// v0.5.8: the skyline's ground line (SKYLINE.baseline) sits this far above the tape's bottom, in CSS px: the darker
// ground band under it starts exactly there (home.css's --line-up).
export const groundLineUp = (fit) => (SKYLINE.height - SKYLINE.baseline) * fit.scale;

// v0.5.8: the prints, the old menu stills' successors: snapshots tossed on the table below and to the right of the path.
// Each is a 3:2 photo in a white border, the bottom edge thicker (PRINT, in shares of the print's width).
export const PRINT = { aspect: 3 / 2, side: 0.05, bottom: 0.15 };
export const printHeight = (w) => w * (PRINT.side + (1 - 2 * PRINT.side) / PRINT.aspect + PRINT.bottom);
// Where each lands, from the free area's lower-right corner: its centre in print widths (dx) and heights (dy), its tilt
// in degrees. The first two along the bottom, overlapping a little; the third above, overlapping both, dropped first
// when the space under the path is too small for it.
export const PRINT_SLOTS = [
  { dx: -0.6, dy: -0.58, rot: 4.5 },
  { dx: -1.42, dy: -0.5, rot: -6 },
  { dx: -0.92, dy: -1.46, rot: -2.2 },
];
// The prints' places in the free area `box` beside the route `c`: { slot, x, y, w, h, cx, cy, rot, aabb: { l, t, r, b } }
// for each slot that fits (aabb: the tilted print's box, grown by `drift`, its slight float), kept `clear` px off the
// path (the plane flies on it) and inside the box, and covering no more than `maxOverlap` of another print. A slot
// that can't moves down and right as far as the box lets it, then tries again a size smaller (SIZES: real prints
// differ too); failing that it's left out.
export const PRINT_SIZES = [1, 0.86];
export function printSpots(box, c, { w, clear = 28, drift = 5, max = PRINT_SLOTS.length, maxOverlap = 0.25 } = {}) {
  const t = curveTable(c, 120), pts = [];
  for (let i = 0; i <= 120; i++) pts.push(t.at(i / 120));
  const out = [];
  for (const [i, s] of PRINT_SLOTS.slice(0, max).entries()) {
    for (const k of PRINT_SIZES) {
      const pw = w * k, ph = printHeight(pw);
      const r = (s.rot * Math.PI) / 180, co = Math.abs(Math.cos(r)), si = Math.abs(Math.sin(r));
      const hw = (co * pw + si * ph) / 2 + drift, hh = (si * pw + co * ph) / 2 + drift;
      if (2 * hw > box.x1 - box.x0 || 2 * hh > box.y1 - box.y0) continue;
      const gap = (cx, cy) => Math.min(...pts.map((p) => Math.hypot(Math.max(0, Math.abs(p.x - cx) - hw), Math.max(0, Math.abs(p.y - cy) - hh))));
      // (The slot's place in full-size prints: a smaller one is centred where the full-size one would have been.)
      let cx = clamp(box.x1 + s.dx * w, box.x0 + hw, box.x1 - hw);
      let cy = clamp(box.y1 + s.dy * printHeight(w), box.y0 + hh, box.y1 - hh);
      for (let n = 0; n < 40 && gap(cx, cy) < clear; n++) {
        const nx = Math.min(cx + 0.04 * pw, box.x1 - hw), ny = Math.min(cy + 0.04 * ph, box.y1 - hh);
        if (nx === cx && ny === cy) break;
        cx = nx; cy = ny;
      }
      if (gap(cx, cy) < clear) continue;
      const place = { slot: i, x: cx - pw / 2, y: cy - ph / 2, w: pw, h: ph, cx, cy, rot: s.rot, aabb: { l: cx - hw, t: cy - hh, r: cx + hw, b: cy + hh } };
      if (out.some((q) => printOverlap(place, q) > maxOverlap || printOverlap(q, place) > maxOverlap)) continue;
      out.push(place);
      break;
    }
  }
  return out;
}
// The rotated rectangles' overlap test (separating axes), for the checks: do prints a and b overlap, and by how much
// of the smaller one's area (sampled)?
export function printOverlap(a, b, n = 24) {
  const inside = (p, q) => {
    const r = (-q.rot * Math.PI) / 180, dx = p.x - q.cx, dy = p.y - q.cy;
    const lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r);
    return Math.abs(lx) <= q.w / 2 && Math.abs(ly) <= q.h / 2;
  };
  let hit = 0;
  const r = (a.rot * Math.PI) / 180;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const lx = ((i + 0.5) / n - 0.5) * a.w, ly = ((j + 0.5) / n - 0.5) * a.h;
    const p = { x: a.cx + lx * Math.cos(r) - ly * Math.sin(r), y: a.cy + lx * Math.sin(r) + ly * Math.cos(r) };
    if (inside(p, b)) hit++;
  }
  return hit / (n * n);
}

// ---- The DOM ----

let seq = 0;
const icon = (art, cls, stroke = STROKE) => `<svg class="${cls}" viewBox="0 0 ${art.w} ${art.h}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${art.paths.map((d) => `<path d="${d}" vector-effect="non-scaling-stroke"/>`).join('')}</svg>`;
// A few faint stars (night, and the darkest of dusk), the same every visit.
// v0.5.8: more of them, and TWINKLE groups of a few each, every group its own <svg> whose opacity pulses (the
// compositor's), out of step.
export const STARS = 64, TWINKLE = [7, 7, 6];
function starsSvg(n = STARS, seed = 7) {
  let s = seed, out = '';
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n; i++) {
    const x = rnd() * 100, y = Math.pow(rnd(), 1.5) * 62, r = 0.5 + rnd() * rnd() * 1.2, o = 0.2 + rnd() * 0.55;
    out += `<circle cx="${x.toFixed(2)}%" cy="${y.toFixed(2)}%" r="${r.toFixed(2)}" opacity="${o.toFixed(2)}"${y < 30 ? '' : ' class="low"'}/>`;
  }
  return out;
}
// The twinkling ones: a little brighter, in the upper half (each group's <svg> covers only TW_H % of the scene's
// height, to keep its layer small; y below is in the scene's %).
const TW_H = 50;
function twinkleSvg(n, seed) {
  let s = seed, out = '';
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n; i++) {
    const x = 3 + rnd() * 94, y = 2 + Math.pow(rnd(), 1.3) * 46, r = 0.8 + rnd() * 0.8;
    out += `<circle cx="${x.toFixed(2)}%" cy="${((100 * y) / TW_H).toFixed(2)}%" r="${r.toFixed(2)}"${y < 30 ? '' : ' class="low"'}/>`;
  }
  return out;
}
// v0.5.8: the aurora, like the game's own (world/sky.js's aurora(): green curtains, red tops, a violet fringe at the
// sharp lower edge): AURORA curtains of static gradients (home.css), each drifting and shimmering by its transform and
// opacity only.
export const AURORA = 3;
// v0.5.8: the photos on the prints, in their slots' order (PRINT_SLOTS): what each shows, and the file in assets/menu/.
// caption: written on the print's bottom edge (short: a small print is about 100 px wide).
export const PHOTOS = [
  { file: 'b777-landing-day.jpg', what: 'A 777 landing in the day', caption: '777 · landing at Incheon' },
  { file: 'a321-pushback-sunset.jpg', what: 'An A321 pushing back at sunset', caption: 'A321 · Gimpo at sunset' },
  { file: 'b787-cruise-night.jpg', what: 'A 787 cruising at night', caption: '787 · Seoul by night' },
];
const photoUrl = (f) => new URL(`../../assets/menu/${f}`, import.meta.url).href;

function linkCss() {
  if (typeof document === 'undefined') return;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => /home\.css(\?|$)/.test(l.href))) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./home.css', import.meta.url).href;
  document.head.appendChild(l);
}

export function createHomeScene(el, { head = null, backdrop = DEFAULT_BACKDROP } = {}) {
  linkCss();
  const id = `fsh-sky-${++seq}`;
  const art = document.createElement('div');
  art.className = 'fsh-art';
  art.setAttribute('aria-hidden', 'true');
  art.innerHTML = `
    <svg class="fsh-stars" width="100%" height="100%" fill="#fff">${starsSvg()}</svg>
    ${TWINKLE.map((n, i) => `<svg class="fsh-stars fsh-tw fsh-anim t${i}" width="100%" height="${TW_H}%" fill="#fff">${twinkleSvg(n, 101 + 37 * i)}</svg>`).join('')}
    <div class="fsh-aurora">${Array.from({ length: AURORA }, (_, i) => `<div class="fsh-au a${i}"><div class="fsh-au-drift fsh-anim"><div class="fsh-au-in fsh-anim"></div></div></div>`).join('')}</div>
    <div class="fsh-earth"></div>
    ${PHOTOS.map((p, i) => `<div class="fsh-print p${i}" data-i="${i}" hidden><div class="fsh-print-drift fsh-anim"><div class="fsh-print-card"><img alt="" decoding="async" draggable="false" src="${photoUrl(p.file)}"><p class="fsh-print-cap">${p.caption}</p></div></div></div>`).join('')}
    <svg class="fsh-route" width="100%" height="100%">
      <path class="fsh-path" fill="none" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-dasharray="2.5 ${DASH_PERIOD - 2.5}"/>
      <circle class="fsh-ring" r="9" fill="none" stroke="currentColor" stroke-width="1.25"/><circle class="fsh-ring" r="9" fill="none" stroke="currentColor" stroke-width="1.25"/>
      <circle class="fsh-dot" r="4.5" fill="currentColor"/><circle class="fsh-dot" r="4.5" fill="currentColor"/>
      <g class="fsh-plane" opacity="0"><g transform="translate(${-ICONS.planeTop.w / 2} ${-ICONS.planeTop.h / 2})" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${ICONS.planeTop.paths.map((d) => `<path d="${d}"/>`).join('')}</g></g>
    </svg>
    <div class="fsh-float fsh-pass"><div class="fsh-drift fsh-anim"><div class="fsh-bob fsh-anim">${icon(ICONS.boardingPass, 'fsh-icon')}</div></div></div>
    <div class="fsh-float fsh-case"><div class="fsh-drift fsh-anim"><div class="fsh-bob fsh-anim">${icon(ICONS.suitcase, 'fsh-icon')}</div></div></div>
    <div class="fsh-ground"><svg class="fsh-tape fsh-anim" preserveAspectRatio="xMinYMax meet">
      <defs><g id="${id}" fill="none" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">${SKYLINE.paths.map((d) => `<path d="${d}" vector-effect="non-scaling-stroke"/>`).join('')}</g></defs>
      <g data-copies></g>
    </svg></div>`;
  el.prepend(art);
  el.classList.add('fsh', 'is-still');
  const q = (s) => art.querySelector(s);
  const path = q('.fsh-path'), plane = q('.fsh-plane'), planeArt = plane.firstElementChild;
  const dots = [...art.querySelectorAll('.fsh-dot')], rings = [...art.querySelectorAll('.fsh-ring')];
  const tape = q('.fsh-tape'), copiesEl = q('[data-copies]'), ground = q('.fsh-ground');
  const pass = q('.fsh-pass'), suitcase = q('.fsh-case');
  const prints = [...art.querySelectorAll('.fsh-print')];
  let printPlaces = [];
  // The photos are decoded once, up front; their <img>s stay (layout only moves and sizes the prints).
  for (const img of art.querySelectorAll('.fsh-print img')) img.decode?.().catch(() => {});

  let active = false, running = false, raf = 0, timer = 0, last = 0, time = 0, timeScale = 1, frames = 0;
  let table = null, planePx = 40, fit = null, bg = null;
  const reducedQ = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => !!reducedQ?.matches;

  function setBackdrop(name) {
    const n = BACKDROPS.includes(name) ? name : DEFAULT_BACKDROP;
    if (bg) el.classList.remove(`bg-${bg}`);
    bg = n;
    el.classList.add(`bg-${bg}`);
    return bg;
  }
  setBackdrop(backdrop);

  // ---- Sizes, on every resize of the scene (a ResizeObserver: nothing runs between) ----
  function layout() {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    const box = el.getBoundingClientRect();
    fit = skylineFit(w, h);
    el.style.setProperty('--sky-h', `${fit.height}px`);
    el.style.setProperty('--tile', `${fit.tileW.toFixed(2)}px`);
    el.style.setProperty('--tape-dur', `${(fit.tileW / TAPE_PX_S).toFixed(1)}s`);
    tape.setAttribute('viewBox', `0 0 ${SKYLINE.width * fit.copies} ${SKYLINE.height}`);
    tape.style.width = `${(fit.tileW * fit.copies).toFixed(2)}px`;
    tape.style.height = `${fit.height}px`;
    if (copiesEl.childElementCount !== fit.copies) {
      copiesEl.innerHTML = Array.from({ length: fit.copies }, (_, i) => `<use href="#${id}" x="${i * SKYLINE.width}"/>`).join('');
    }
    const headBottom = head ? head.getBoundingClientRect().bottom - box.top : 0.3 * h;
    const groundTop = ground.getBoundingClientRect().top - box.top;
    const padX = head ? head.getBoundingClientRect().left - box.left : 0.065 * w;
    const free = freeArea({ w, h, headBottom, groundTop, padX });
    const c = routeCurve(free);
    table = curveTable(c);
    path.setAttribute('d', curvePath(c));
    for (const [i, p] of [[0, c[0]], [1, c[3]]]) {
      dots[i].setAttribute('cx', p.x.toFixed(1)); dots[i].setAttribute('cy', p.y.toFixed(1));
      rings[i].setAttribute('cx', p.x.toFixed(1)); rings[i].setAttribute('cy', p.y.toFixed(1));
    }
    planePx = clamp(0.042 * w, 34, 64);
    planeArt.setAttribute('stroke-width', ((STROKE * ICONS.planeTop.w) / planePx).toFixed(2));
    const spots = floaterSpots(free, c, { passW: clamp(0.15 * w, 120, 230), caseH: clamp(0.09 * w, 64, 120) });
    for (const [node, s] of [[pass, spots.pass], [suitcase, spots.case]]) {
      node.style.left = `${s.x.toFixed(1)}px`; node.style.top = `${s.y.toFixed(1)}px`;
      node.style.width = `${s.w.toFixed(1)}px`; node.style.height = `${s.h.toFixed(1)}px`;
    }
    // v0.5.8: the ground band's top on the skyline's ground line, and the prints below and right of the path.
    el.style.setProperty('--line-up', `${groundLineUp(fit).toFixed(3)}px`);
    const printW = clamp(0.17 * w, 120, 290);
    printPlaces = printSpots(free, c, { w: printW, clear: planePx * 0.5 + 12 });
    const placed = new Map(printPlaces.map((p) => [p.slot, p]));
    for (const [i, node] of prints.entries()) {
      const p = placed.get(i);
      if (node.hidden !== !p) node.hidden = !p;   // (only on a change: a print that stays keeps its drift's phase)
      if (!p) continue;
      node.style.left = `${p.x.toFixed(1)}px`; node.style.top = `${p.y.toFixed(1)}px`;
      node.style.width = `${p.w.toFixed(1)}px`; node.style.height = `${p.h.toFixed(1)}px`;
      node.style.setProperty('--rot', `${p.rot}deg`);
      node.style.setProperty('--edge', `${(PRINT.side * p.w).toFixed(2)}px`);
      node.style.setProperty('--edge-b', `${(PRINT.bottom * p.w).toFixed(2)}px`);
    }
    draw(running ? time : stillTime());
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => layout()) : null;
  ro?.observe(el);

  // ---- The plane and the dashes ----
  // The still (reduced motion, and before the first frame): the plane mid-path on its way out.
  const stillTime = () => (reduced() ? PLANE.leg / 2 : time);
  let shown = null;   // the plane's last transform, for the checks
  function draw(t) {
    if (!table) return;
    const p = planeAt(t);
    if (!p.visible || p.scale <= 0.001) { plane.setAttribute('opacity', '0'); shown = { ...p, x: null, y: null, angle: null, scale: 0 }; }
    else {
      const at = table.at(p.u);
      const deg = (at.angle * 180) / Math.PI + (p.dir < 0 ? 180 : 0);
      const k = (planePx / ICONS.planeTop.w) * p.scale;
      plane.setAttribute('opacity', '1');
      plane.setAttribute('transform', `translate(${at.x.toFixed(2)} ${at.y.toFixed(2)}) rotate(${deg.toFixed(2)}) scale(${k.toFixed(4)})`);
      shown = { ...p, x: at.x, y: at.y, angle: deg, scale: p.scale };
    }
    path.style.strokeDashoffset = `${((-DASH * dashTravel(reduced() ? 0 : t)) % DASH_PERIOD).toFixed(2)}`;
  }
  function frame(now) {
    raf = 0;
    if (!running) return;
    // Never more than FPS a second, whatever the display's rate (the timer below lands on the right frame at 60 and 120 Hz).
    if (last && now - last < 1000 / FPS - 1) { raf = requestAnimationFrame(frame); return; }
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    time += dt * timeScale;
    draw(time);
    frames++;
    // The next frame in a thirtieth of a second: a timer, then the display's next frame.
    const wait = Math.max(0, 1000 / FPS - (performance.now() - now) - 4);
    timer = setTimeout(() => { timer = 0; if (running && !raf) raf = requestAnimationFrame(frame); }, wait);
  }

  // ---- Running or still ----
  function update() {
    const moving = active && !(typeof document !== 'undefined' && document.hidden);
    el.classList.toggle('is-still', !moving);
    const fly = moving && !reduced();
    if (fly && !running) {
      running = true; last = 0;
      if (fit === null) layout();
      raf = requestAnimationFrame(frame);
    } else if (!fly && running) {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(timer);
      raf = timer = 0;
    }
    if (!running) draw(stillTime());
  }
  const onVisibility = () => update();
  document.addEventListener('visibilitychange', onVisibility);
  reducedQ?.addEventListener?.('change', () => update());

  function setActive(on) {
    active = !!on;
    if (active) layout();
    update();
  }

  function setTimeScale(k) {
    timeScale = Number.isFinite(k) && k > 0 ? k : 1;
    for (const a of el.getAnimations?.({ subtree: true }) || []) a.playbackRate = timeScale;
  }

  function state() {
    const m = getComputedStyle(tape).transform;
    const tx = m && m !== 'none' ? new DOMMatrixReadOnly(m).m41 : 0;
    const r = tape.getBoundingClientRect(), g = ground.getBoundingClientRect(), b = el.getBoundingClientRect();
    return {
      running, active, frames, time, reduced: reduced(), backdrop: bg, still: el.classList.contains('is-still'),
      plane: shown ? { ...shown } : null, dashOffset: Number.parseFloat(path.style.strokeDashoffset) || 0,
      tape: { x: tx, tile: fit?.tileW ?? 0, copies: fit?.copies ?? 0, left: r.left - b.left, right: r.right - b.left, width: b.width, groundLeft: g.left - b.left, groundRight: g.right - b.left, height: fit?.height ?? 0 },
      animations: (el.getAnimations?.({ subtree: true }) || []).map((a) => ({ name: a.animationName || a.id || '', state: a.playState, rate: a.playbackRate })),
      path: { length: table?.length ?? 0, from: table?.at(0) ?? null, to: table?.at(1) ?? null },
      // v0.5.8: the prints' planned places (scene px) and their photos, the ground line's offset
      prints: printPlaces.map((p) => ({ ...p, file: PHOTOS[p.slot].file, src: prints[p.slot].querySelector('img').currentSrc, loaded: prints[p.slot].querySelector('img').complete && prints[p.slot].querySelector('img').naturalWidth > 0 })),
      lineUp: fit ? groundLineUp(fit) : 0, lineBase: SKYLINE.baseline,
    };
  }

  return {
    el, setActive, setBackdrop, setTimeScale, layout, state,
    get backdrop() { return bg; }, get running() { return running; }, get frames() { return frames; },
  };
}
