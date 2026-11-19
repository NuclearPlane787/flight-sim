// v0.5.8: v057-home.cjs's checks of the home page, with v0.5.8's: the ground band's top on the skyline's ground line
// (within 1 px, every size), the suitcase left of (above) the path with the boarding pass, the prints (2 or 3, loaded,
// tilted each its own way, overlapping a little, clear of the path, the plane's route, the dots, the title and the
// skyline), the stars (some twinkling) and the aurora, and all of it stopped with the menu covered or hidden and with
// reduced motion. v0.5.7's header follows.
// v0.5.7: the home page (the main menu) through the real game (main.js) in headless Chromium, in the cloud container:
// no scenario, then a seeded saved flight, at 1440×900, 1280×720 and 1920×1080 (and 1100×700 and 2560×1440, the
// range it's made for). Checks: no page errors and no
// "Airliners over South Korea"; the plane flies the path, shrinks into a dot and comes back the other way (time sped
// up through the scene's hook); the skyline moves left to right and spans the scene; the card's text; nothing
// overlapping; the keys through the rows; Load scenario opens and closes; a page over the menu, a hidden page and
// reduced motion stop it; Resume flight loads the scenario, nothing of the menu runs in flight (the scene's frames and,
// with the flight paused, the page's requestAnimationFrame count stay put), and it runs again back at the menu, whose
// card then reads what summaryNow() saved. Pictures (each size, the three backgrounds) go to outDir.
//   node tests/cloud/v058-home.cjs [outDir]       (FS_BASE as in weight-copy.cjs; a few minutes with SwiftShader)
const { chromium } = require('playwright');
const fs = require('fs');
const snap = require('./snap.cjs');
const BASE = process.env.FS_BASE || 'http://127.0.0.1:8765/games/flight-sim/';
const out = process.argv[2] || '/tmp/v058/shots-h';
fs.mkdirSync(out, { recursive: true });
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const SIZES = [[1440, 900], [1280, 720], [1920, 1080], [1100, 700], [2560, 1440]];   // the three asked for, and the range's ends

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Every requestAnimationFrame the page asks for.
  await ctx.addInitScript(() => {
    window.__raf = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (f) => { window.__raf++; return raf(f); };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const wait = (ms) => page.waitForTimeout(ms);
  const boot = async () => {
    await page.goto(BASE);
    await page.waitForSelector('.fsm:not([hidden])', { timeout: 240000 });
    await page.evaluate(() => document.fonts.ready);
    await wait(700);
  };
  const shot = async (name, vp) => {
    const path = `${out}/${name}.png`;
    try { await page.screenshot({ path, timeout: 30000 }); }
    catch (e) {
      try { await snap(page, browser, path, BASE, vp || page.viewportSize()); } catch (e2) { console.log('no picture:', String(e2).split('\n')[0]); return; }
    }
    console.log('shot', name);
  };
  const scene = () => page.evaluate(() => window.__fs.menu.scene.state());
  const focused = () => page.evaluate(() => document.activeElement?.dataset?.k || document.activeElement?.className || document.activeElement?.tagName);
  const noSubtitle = async (where) => ok(!(await page.evaluate(() => document.body.innerText.includes('Airliners over South Korea'))), `${where}: no "Airliners over South Korea"`);
  // The plane in the page, sampled at 40 Hz for `ms` (the DOM's transform and opacity, and the scene's own state).
  const samplePlane = (ms) => page.evaluate((ms) => new Promise((res) => {
    const g = document.querySelector('.fsh-plane'), s = window.__fs.menu.scene, rows = [];
    const id = setInterval(() => {
      const m = /translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\) scale\(([-\d.]+)\)/.exec(g.getAttribute('transform') || '');
      const st = s.state().plane;
      rows.push({ shown: g.getAttribute('opacity') === '1', x: m ? +m[1] : null, y: m ? +m[2] : null, rot: m ? +m[3] : null, k: m ? +m[4] : null, dir: st?.dir, u: st?.u, scale: st?.scale, visible: st?.visible });
    }, 25);
    setTimeout(() => { clearInterval(id); res(rows); }, ms);
  }), ms);
  // What's where, in page px: the title, the path's box and points, the dots, the floaters, the skyline, the version, the panel.
  const layout = () => page.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    const scene = r('.fsm-left'), path = document.querySelector('.fsh-path');
    const pts = []; const L = path.getTotalLength();
    for (let i = 0; i <= 80; i++) { const p = path.getPointAtLength((L * i) / 80); pts.push([p.x + scene.l, p.y + scene.t]); }
    const bb = path.getBBox();
    const panel = document.querySelector('.fsm-right');
    return {
      vw: innerWidth, vh: innerHeight, scene, head: r('.fsm-head'), title: r('.fsm-title'), path: { l: bb.x + scene.l, t: bb.y + scene.t, r: bb.x + bb.width + scene.l, b: bb.y + bb.height + scene.t }, pts,
      pass: r('.fsh-pass'), case: r('.fsh-case'), ground: r('.fsh-ground'), version: r('.fsm-version'), panel: r('.fsm-right'), nav: r('.fsm-nav'),
      panelScroll: panel.scrollHeight - panel.clientHeight, card: r('.fsh-card'),
      // v0.5.8: the ground line's y (the skyline's baseline through the tape's own transform) and the band's top
      lineY: (() => { const t = document.querySelector('.fsh-tape'), m = t.getScreenCTM(); return m.d * window.__fs.menu.scene.state().lineBase + m.f; })(),
      earthTop: r('.fsh-earth').t,
      dots: [...document.querySelectorAll('.fsh-ring')].map((d) => { const b = d.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; }),
      prints: [...document.querySelectorAll('.fsh-print:not([hidden]) .fsh-print-card')].map((e) => {
        const b = e.getBoundingClientRect(), m = new DOMMatrixReadOnly(getComputedStyle(e).transform), img = e.querySelector('img');
        return { l: b.left, t: b.top, r: b.right, b: b.bottom, rot: (Math.atan2(m.b, m.a) * 180) / Math.PI, loaded: img.complete && img.naturalWidth > 0, src: img.currentSrc.split('/').pop(), nw: img.naturalWidth, shown: getComputedStyle(e).visibility !== 'hidden' };
      }),
      planePx: Math.max(34, Math.min(64, 0.042 * document.querySelector('.fsm-left').clientWidth)),   // the plane's size (home-scene.js)
    };
  });
  // The planned prints' overlap (rotated rectangles, sampled): as home-scene.js's printOverlap().
  const window_overlap = (a, b, n = 24) => {
    const inside = (p, q) => { const r = (-q.rot * Math.PI) / 180, dx = p.x - q.cx, dy = p.y - q.cy; const lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r); return Math.abs(lx) <= q.w / 2 && Math.abs(ly) <= q.h / 2; };
    let hit = 0; const r = (a.rot * Math.PI) / 180;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const lx = ((i + 0.5) / n - 0.5) * a.w, ly = ((j + 0.5) / n - 0.5) * a.h; if (inside({ x: a.cx + lx * Math.cos(r) - ly * Math.sin(r), y: a.cy + lx * Math.sin(r) + ly * Math.cos(r) }, b)) hit++; }
    return hit / (n * n);
  };
  const overlap = (a, b, pad = 0) => a && b && a.l < b.r + pad && b.l < a.r + pad && a.t < b.b + pad && b.t < a.b + pad;
  const curveYAt = (pts, x) => { for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; if ((x0 - x) * (x1 - x) <= 0 && x1 !== x0) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0); } return null; };
  const checkLayout = async (tag) => {
    const L = await layout();
    const ratio = L.panel.w / L.vw;
    ok((ratio >= 0.36 && ratio <= 0.40) || Math.abs(L.panel.w - 420) < 1 || Math.abs(L.panel.w - 1000) < 1, `${tag}: the panel ${Math.round(L.panel.w)} px, ${(ratio * 100).toFixed(1)} % of the width`);
    ok(L.nav.t >= 0 && L.nav.b <= L.vh && L.panelScroll <= 1, `${tag}: the panel's menu fits (${Math.round(L.nav.t)}–${Math.round(L.nav.b)} of ${L.vh}, overflow ${L.panelScroll})`);
    ok(L.title.r <= L.scene.r && L.title.l >= L.scene.l, `${tag}: the title inside the scene (${Math.round(L.title.l)}–${Math.round(L.title.r)} of ${Math.round(L.scene.r)})`);
    ok(L.path.t > L.head.b && L.path.b < L.ground.t, `${tag}: the path between the title (to ${Math.round(L.head.b)}) and the skyline (from ${Math.round(L.ground.t)}): ${Math.round(L.path.t)}–${Math.round(L.path.b)}`);
    const bob = 18;   // the floaters' drift and bob
    for (const k of ['pass', 'case']) {
      const f = L[k];
      ok(!overlap(f, L.head, bob) && f.b + bob < L.ground.t && f.l >= L.scene.l && f.r <= L.scene.r, `${tag}: the ${k === 'pass' ? 'boarding pass' : 'suitcase'} clear of the title and the skyline`);
      ok(!L.pts.some(([x, y]) => x > f.l - 6 && x < f.r + 6 && y > f.t - 6 && y < f.b + 6), `${tag}: the ${k === 'pass' ? 'boarding pass' : 'suitcase'} clear of the path`);
    }
    ok(!overlap(L.pass, L.case, bob), `${tag}: the boarding pass and the suitcase apart`);
    const yp = curveYAt(L.pts, (L.pass.l + L.pass.r) / 2), yc = curveYAt(L.pts, (L.case.l + L.case.r) / 2);
    ok(yp == null || L.pass.b < yp, `${tag}: the boarding pass to the left of (above) the path`);
    ok(yc != null && L.case.b < yc, `${tag}: the suitcase to the left of (above) the path, with the boarding pass`);
    const ycr = curveYAt(L.pts, L.case.r);
    ok(ycr == null || L.case.b + bob < ycr, `${tag}: the suitcase's lower right corner above the path too`);
    // v0.5.8: the ground band's top edge on the ground line.
    ok(Math.abs(L.earthTop - L.lineY) <= 1, `${tag}: the ground band's top ${L.earthTop.toFixed(2)} on the ground line ${L.lineY.toFixed(2)} (±1 px)`);
    // v0.5.8: the prints.
    const P = L.prints;
    ok(P.length >= (L.vw >= 1280 ? 3 : 2) && P.length <= 3, `${tag}: ${P.length} prints (${P.map((p) => p.src).join(', ')})`);
    ok(P.every((p) => p.loaded && p.nw >= 800), `${tag}: their photos loaded (${P.map((p) => p.nw).join(', ')} px wide)`);
    const rots = P.map((p) => p.rot);
    ok(rots.every((r) => Math.abs(r) >= 1.5 && Math.abs(r) <= 9) && new Set(rots.map((r) => r.toFixed(1))).size === rots.length && rots.some((r) => r > 0) && rots.some((r) => r < 0),
      `${tag}: tilted each its own way (${rots.map((r) => r.toFixed(1)).join('°, ')}°)`);
    const box = (p) => ({ l: p.l, t: p.t, r: p.r, b: p.b });
    const ov = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
    const plan = (await scene()).prints;
    ok(P.every((p, i) => P.some((q, j) => j !== i && ov(box(p), box(q)) > 0)), `${tag}: each print overlaps another`);
    ok(plan.length === P.length && plan.every((p) => { const o = plan.filter((q) => q !== p).map((q) => window_overlap(p, q)); return Math.max(...o) >= 0.03 && Math.max(...o) <= 0.26; }),
      `${tag}: by a little (${plan.map((p) => (Math.max(...plan.filter((q) => q !== p).map((q) => window_overlap(p, q))) * 100).toFixed(0) + ' %').join(', ')})`);
    const half = L.planePx / 2;
    for (const [i, p] of P.entries()) {
      const gap = Math.min(...L.pts.map(([x, y]) => Math.hypot(Math.max(0, p.l - x, x - p.r), Math.max(0, p.t - y, y - p.b))));
      ok(gap >= half + 4, `${tag}: print ${i} clear of the path and the plane's route (${gap.toFixed(0)} px, the plane ${L.planePx.toFixed(0)} px)`);
      ok(L.dots.every((d) => !overlap(p, d, 6)), `${tag}: print ${i} clear of the dots`);
      ok(!overlap(p, L.head, 12) && !overlap(p, L.title, 12), `${tag}: print ${i} clear of the title`);
      ok(p.b + 8 < L.ground.t, `${tag}: print ${i} clear of the skyline (${Math.round(p.b)} above ${Math.round(L.ground.t)})`);
      ok(p.l >= L.scene.l && p.r <= L.scene.r, `${tag}: print ${i} inside the scene`);
      const yc2 = curveYAt(L.pts, (p.l + p.r) / 2);
      ok(yc2 == null || (p.t + p.b) / 2 > yc2, `${tag}: print ${i} below (right of) the path`);
      for (const k of ['pass', 'case']) ok(!overlap(p, L[k], 4), `${tag}: print ${i} apart from the ${k === 'pass' ? 'boarding pass' : 'suitcase'}`);
    }
    ok(L.ground.l <= L.scene.l + 0.5 && L.ground.r >= L.scene.r - 0.5, `${tag}: the skyline's strip spans the scene (${Math.round(L.ground.l)}–${Math.round(L.ground.r)})`);
    ok(L.version.t >= L.ground.b - 1 && L.version.l < L.scene.l + 140, `${tag}: the version at the bottom left, under the ground line`);
    const st = await scene();
    ok(st.tape.left <= 0.5 && st.tape.right >= st.tape.width - 0.5, `${tag}: the skyline's copies cover the scene end to end (${Math.round(st.tape.left)}–${Math.round(st.tape.right)} of ${Math.round(st.tape.width)})`);
    ok(st.tape.height >= 100 && st.tape.height <= 210 && Math.abs(st.tape.height - Math.min(210, Math.max(80, 0.2 * L.vh))) < 1.5, `${tag}: the skyline ${st.tape.height} px high (a fifth of ${L.vh}, capped)`);
  };

  // ---- No scenario (a fresh profile) ----
  await boot();
  await noSubtitle('no scenario');
  ok(await page.$eval('[data-k="continue"]', (b) => b.hidden), 'no scenario: no card');
  ok(await page.$eval('[data-k="new"]', (b) => b.classList.contains('primary')), 'no scenario: New scenario is the primary button');
  ok(await focused() === 'new', 'no scenario: New scenario has the focus');
  let st = await scene();
  ok(st.running && !st.still && st.backdrop === 'dusk', `the scene runs (backdrop ${st.backdrop})`);
  await shot('home-empty-1440x900');
  // v0.5.8: the stars (some twinkling) and the aurora, behind the title.
  const sky = async () => page.evaluate(() => {
    const vis = (e) => { const s = getComputedStyle(e); return s.display !== 'none' && e.getBoundingClientRect().width > 0; };
    const au = document.querySelector('.fsh-aurora'), head = document.querySelector('.fsm-head');
    const curtains = [...document.querySelectorAll('.fsh-au')].filter(vis).map((e) => { const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, h: b.height, w: b.width }; });
    const stars = [...document.querySelectorAll('.fsh-stars')].filter(vis).reduce((n, s) => n + [...s.querySelectorAll('circle')].filter((c) => getComputedStyle(c).display !== 'none').length, 0);
    const tw = [...document.querySelectorAll('.fsh-tw')].filter(vis).length;
    const anims = document.querySelector('.fsm-left').getAnimations({ subtree: true }).map((a) => a.animationName);
    return { auOpacity: +getComputedStyle(au).opacity, curtains, stars, tw, anims, behind: +getComputedStyle(head).zIndex > 0 && au.compareDocumentPosition(head) & Node.DOCUMENT_POSITION_FOLLOWING, sceneH: document.querySelector('.fsm-left').clientHeight };
  });
  let sk = await sky();
  ok(sk.auOpacity > 0.5 && sk.curtains.length === 3 && sk.curtains.every((c) => c.b < 0.5 * sk.sceneH && c.h > 0.2 * sk.sceneH), `dusk: the aurora, three curtains in the upper part (opacity ${sk.auOpacity}, bottoms ${sk.curtains.map((c) => Math.round(c.b)).join(', ')} of ${sk.sceneH})`);
  ok(sk.behind, 'the aurora behind the title');
  ok(sk.stars >= 30 && sk.tw === 3, `dusk: ${sk.stars} stars shown, 3 twinkling groups`);
  ok(['fsh-tw', 'fsh-au-drift-a', 'fsh-au-drift-b', 'fsh-au-shimmer', 'fsh-print-a'].every((n) => sk.anims.includes(n)), `the twinkling, the aurora's drift and shimmer and the prints' drift run (${[...new Set(sk.anims)].join(', ')})`);
  // Only transforms and opacity are animated (the compositor's): every keyframe in the scene.
  const props = await page.evaluate(() => [...new Set(document.querySelector('.fsm-left').getAnimations({ subtree: true }).flatMap((a) => a.effect.getKeyframes().flatMap((k) => Object.keys(k).filter((x) => !['offset', 'easing', 'composite', 'computedOffset'].includes(x)))))]);
  ok(props.length > 0 && props.every((p) => p === 'transform' || p === 'opacity'), `the animations change only ${props.join(' and ')}`);

  // The plane's frames: at most 30 a second, from requestAnimationFrame; nothing else asks for frames in the menu.
  const f0 = await page.evaluate(() => ({ f: window.__fs.menu.scene.frames, r: window.__raf, t: performance.now() }));
  await wait(2000);
  const f1 = await page.evaluate(() => ({ f: window.__fs.menu.scene.frames, r: window.__raf, t: performance.now() }));
  const fps = ((f1.f - f0.f) * 1000) / (f1.t - f0.t), rps = ((f1.r - f0.r) * 1000) / (f1.t - f0.t);
  ok(fps > 5 && fps <= 31, `the plane is drawn ${fps.toFixed(1)} times a second (at most 30)`);
  ok(rps <= 31.5, `the page asks for ${rps.toFixed(1)} frames a second in the menu`);

  // The plane along the path, sped up 6×: out, shrinking into the upper-right dot, gone, back the other way.
  await page.evaluate(() => window.__fs.menu.scene.setTimeScale(6));
  const rows = await samplePlane(7000);
  await page.evaluate(() => window.__fs.menu.scene.setTimeScale(1));
  const path = (await scene()).path;
  const outb = rows.filter((r) => r.shown && r.dir === 1), back = rows.filter((r) => r.shown && r.dir === -1);
  ok(outb.length > 5 && back.length > 5, `samples out and back: ${outb.length} out, ${back.length} back, ${rows.filter((r) => !r.shown).length} unseen`);
  const mono = (list, sign) => list.slice(1).every((r, i) => sign * (r.x - list[i].x) >= -0.5);
  // One leg's samples: the run of shown samples with one direction.
  const runs = []; let cur = null;
  for (const r of rows) { if (r.shown && cur && cur.dir === r.dir) cur.rows.push(r); else if (r.shown) { cur = { dir: r.dir, rows: [r] }; runs.push(cur); } else cur = null; }
  const runOut = runs.find((g) => g.dir === 1 && g.rows.length > 5), runBack = runs.find((g) => g.dir === -1 && g.rows.length > 5);
  ok(runOut && mono(runOut.rows, 1), 'out: the plane moves right along the path');
  ok(runBack && mono(runBack.rows, -1), 'back: the plane moves left along the path');
  const head = (g) => g.rows.filter((r) => r.scale > 0.95);
  ok(runOut && head(runOut).every((r) => r.rot > -90 && r.rot < 10), `out: it heads up and to the right (${runOut ? head(runOut).slice(0, 3).map((r) => r.rot.toFixed(0)).join(', ') : '—'}°)`);
  ok(runBack && head(runBack).every((r) => r.rot > 90 && r.rot < 190), `back: turned to face the other way (${runBack ? head(runBack).slice(0, 3).map((r) => r.rot.toFixed(0)).join(', ') : '—'}°)`);
  // Into the upper-right dot: smaller and smaller, the last one tiny and at the dot; then unseen; then back from it.
  const endOut = runs.findIndex((g) => g.dir === 1 && g.rows.length > 5 && g.rows[g.rows.length - 1].u > 0.97);
  if (endOut >= 0) {
    const g = runs[endOut].rows, tail = g.filter((r) => r.u > 0.84);
    ok(tail.length >= 3 && tail.slice(1).every((r, i) => r.k <= tail[i].k + 1e-6), `into the dot it shrinks: ${tail.map((r) => r.k.toFixed(3)).join(' → ')}`);
    // (A frame is a fifth of a second of the plane's time here: the last one seen is within a frame of the dot.)
    const last = g[g.length - 1], d = Math.hypot(last.x - path.to.x, last.y - path.to.y);
    ok(last.scale < 0.2 && d < 30, `it vanishes at the dot (last seen at scale ${last.scale.toFixed(3)}, ${d.toFixed(1)} px from it)`);
    const iUnseen = rows.indexOf(g[g.length - 1]) + 1;
    ok(rows[iUnseen] && !rows[iUnseen].shown, 'then it is gone for a moment');
    const nxt = runs[endOut + 1];
    ok(nxt && nxt.dir === -1, 'then it comes back the other way');
    if (nxt) {
      const first = nxt.rows[0], d1 = Math.hypot(first.x - path.to.x, first.y - path.to.y);
      ok(first.scale < 0.5 && d1 < 40, `from the same dot, growing (first seen at scale ${first.scale.toFixed(2)}, ${d1.toFixed(1)} px from it)`);
      const grow = nxt.rows.filter((r) => r.u > 0.84);
      ok(grow.slice(1).every((r, i) => r.k >= grow[i].k - 1e-6), 'growing as it leaves');
    }
  } else ok(false, 'a leg ending at the upper-right dot was sampled');
  // The dashes flow with it: their offset moves one way out and the other way back.
  // (2.5×, so a frame moves them less than half a dash period, and 8 s: both ways.)
  const dash = await page.evaluate(() => new Promise((res) => {
    const s = window.__fs.menu.scene; s.setTimeScale(2.5);
    const out = []; const id = setInterval(() => { const p = s.state(); out.push({ o: p.dashOffset, t: p.time, dir: p.plane?.dir, shown: p.plane?.visible }); }, 30);
    setTimeout(() => { clearInterval(id); s.setTimeScale(1); res(out); }, 8000);
  }));
  // The flow's speed (the offset's change per second of scene time), unwrapped over the dash period.
  const rates = { 1: [], [-1]: [] };
  for (let i = 1; i < dash.length; i++) {
    const a = dash[i - 1], b = dash[i];
    if (!a.shown || !b.shown || a.dir !== b.dir || b.t <= a.t) continue;
    let d = b.o - a.o; while (d > 6) d -= 12; while (d < -6) d += 12;
    rates[a.dir].push(d / (b.t - a.t));
  }
  const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
  ok(rates[1].length > 3 && mean(rates[1]) < -5, `the dashes flow towards the upper right while the plane flies out (${mean(rates[1]).toFixed(1)} px/s of offset)`);
  ok(rates[-1].length > 3 && mean(rates[-1]) > 5, `and the other way while it flies back (${mean(rates[-1]).toFixed(1)} px/s)`);

  // The skyline: left to right, a seamless loop of whole tiles.
  const t0 = await scene();
  await wait(1500);
  const t1 = await scene();
  let dx = t1.tape.x - t0.tape.x; if (dx < -t0.tape.tile / 2) dx += t0.tape.tile;
  ok(dx > 5 && dx < 80, `the skyline moves left to right: ${t0.tape.x.toFixed(1)} → ${t1.tape.x.toFixed(1)} px in 1.5 s`);
  ok(t0.tape.x <= 0.5 && t0.tape.x >= -t0.tape.tile - 0.5, `its offset stays within one tile (${t0.tape.x.toFixed(0)} of ${t0.tape.tile.toFixed(0)})`);
  await checkLayout('no scenario 1440×900');

  // ---- A saved flight: seeded (in the air, the summary's fields), and an older one (its text only) ----
  await page.evaluate(() => {
    const now = Date.now(), P = 'gamedump:flight-sim:';
    const plan = { origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'runway', pax: 190, cargoKg: 1500, fuelKg: 6000, waypoints: [] };
    const idx = [
      { id: 'home6', name: 'Scenario 6', created: now - 5e5, savedAt: now - 6e4, type: 'a321neo',
        summary: { route: 'RKSS–RKPC', where: 'FL350, 225 nm to RKPC', phase: 'air', origin: 'RKSS', dest: 'RKPC', alt: 35000, distNm: 225 } },
      { id: 'home2', name: 'Gimpo hop', created: now - 9e6, savedAt: now - 8e6, type: 'b787-9', summary: { route: 'RKPC 07 → RKSS 14R', where: 'Parked at RKPC stand 12' } },
    ];
    localStorage.setItem(P + 'scenarios', JSON.stringify(idx));
    for (const e of idx) localStorage.setItem(P + 'scenario:' + e.id, JSON.stringify({ v: 1, id: e.id, name: e.name, savedAt: e.savedAt, state: { v: 1, fresh: true, plan } }));
  });
  await boot();
  const cardText = () => page.evaluate(() => {
    const q = (k) => document.querySelector(`[data-o="${k}"]`)?.textContent.trim();
    return { shown: !document.querySelector('[data-k="continue"]').hidden, kicker: q('cardKicker'), title: q('cardTitle'), sub: q('cardSub'), action: q('cardAction'),
      stats: [...document.querySelectorAll('.fsh-stat')].map((s) => `${s.querySelector('b').textContent} / ${s.querySelector('small').textContent}`) };
  });
  let c = await cardText();
  ok(c.shown && c.kicker === 'Saved flight' && c.title === 'En route to Jeju' && c.sub === 'Scenario 6 · A321neo', `the card: ${c.kicker} | ${c.title} | ${c.sub}`);
  ok(c.stats.join(' | ') === 'FL350 / Flight level | 225 nm / Remaining' && c.action === 'Resume flight', `its stats and button: ${c.stats.join(' | ')} | ${c.action}`);
  ok(!(await page.$eval('[data-k="new"]', (b) => b.classList.contains('primary'))), 'with a card, New scenario is a row');
  ok(await focused() === 'continue', 'the card (Resume flight) has the focus');
  await noSubtitle('with a saved flight');
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await wait(600);
    await checkLayout(`${w}×${h}`);
    await shot(`home-card-${w}x${h}`, { width: w, height: h });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await wait(500);

  // The three backgrounds, at 1440×900.
  for (const b of ['night', 'dusk', 'blueprint']) {
    const got = await page.evaluate((b) => { window.__fs.menu.setBackdrop(b); return window.__fs.menu.backdrop; }, b);
    await wait(300);
    const cls = await page.$eval('.fsm-left', (e) => e.className);
    ok(got === b && cls.includes(`bg-${b}`), `backdrop ${b}: ${cls}`);
    sk = await sky();
    const want = { night: [0.8, 1], dusk: [0.5, 0.8], blueprint: [0.15, 0.35] }[b];
    ok(sk.auOpacity >= want[0] && sk.auOpacity <= want[1] && sk.stars >= 20, `${b}: the aurora at ${sk.auOpacity} (subtle on blueprint), ${sk.stars} stars`);
    await shot(`home-bg-${b}-1440x900`);
  }
  await page.evaluate(() => window.__fs.menu.setBackdrop('dusk'));

  // ---- The keys: down through the card and the rows, left and right on Settings | Controls ----
  await page.evaluate(() => window.__fs.menu.showPage('main'));
  const order = [];
  for (let i = 0; i < 8; i++) { order.push(await focused()); await page.keyboard.press('ArrowDown'); }
  ok(order.join(',') === 'continue,new,load,warehouse,logbook,settings,controls,exit', `ArrowDown: ${order.join(', ')}`);
  ok(await focused() === 'continue', 'and round to the card again');
  await page.keyboard.press('ArrowUp');
  ok(await focused() === 'exit', 'ArrowUp from the card: Exit to Game Dump');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  ok(await focused() === 'settings', 'up to Settings');
  await page.keyboard.press('ArrowRight');
  ok(await focused() === 'controls', 'ArrowRight: Controls');
  await page.keyboard.press('ArrowLeft');
  ok(await focused() === 'settings', 'ArrowLeft: Settings');
  const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; });
  ok(ring, 'a focus ring on the focused row');
  await page.keyboard.press('ArrowUp');
  ok(await focused() === 'logbook', 'ArrowUp: Logbook');
  await shot('home-keys-1440x900');

  // ---- Load scenario: in the panel; Esc back ----
  await page.evaluate(() => window.__fs.menu.showPage('main'));
  await page.click('[data-k="load"]');
  await wait(300);
  const lp = await page.evaluate(() => { const l = document.querySelector('.fsm-load'), b = l.getBoundingClientRect(), p = document.querySelector('.fsm-right').getBoundingClientRect();
    return { shown: !l.hidden, inPanel: b.left >= p.left - 0.5 && b.right <= p.right + 0.5 && b.top >= 0 && b.bottom <= innerHeight, rows: [...document.querySelectorAll('.fsm-load .fsm-row b')].map((x) => x.textContent), focus: document.activeElement?.classList.contains('fsm-row'), nav: !document.querySelector('.fsm-nav').hidden }; });
  ok(lp.shown && lp.inPanel && !lp.nav, 'Load scenario opens in the panel, in the window');
  ok(lp.rows.join(',') === 'Scenario 6,Gimpo hop' && lp.focus, `its rows, newest first, the first focused: ${lp.rows.join(', ')}`);
  ok((await scene()).running, 'the scene keeps moving beside it');
  await shot('home-load-1440x900');
  await page.keyboard.press('Escape');
  await wait(200);
  ok(await page.$eval('.fsm-load', (l) => l.hidden) && await focused() === 'continue', 'Esc: back to the menu, the card focused');

  // ---- A page over the menu stops it; closing it starts it again ----
  await page.click('[data-k="settings"]');
  await wait(300);
  st = await scene();
  const fA = st.frames;
  await wait(600);
  st = await scene();
  ok(!st.running && st.still && st.frames === fA, `Settings over the menu: the scene stops (frames ${fA} → ${st.frames})`);
  ok(st.animations.length > 0 && st.animations.every((a) => a.state === 'paused'), `and its CSS animations pause (${st.animations.map((a) => a.state).join(', ')})`);
  await page.keyboard.press('Escape');
  await wait(400);
  st = await scene();
  ok(st.running && !st.still && st.animations.every((a) => a.state === 'running'), 'Settings closed: it moves again');
  await page.click('[data-k="logbook"]');
  await wait(300);
  ok(!(await scene()).running, 'the logbook over the menu: stopped');
  await page.keyboard.press('Escape');
  await wait(400);
  ok((await scene()).running, 'the logbook closed: moving');

  // ---- The page hidden (as when the player switches away) ----
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await wait(300);
  st = await scene();
  ok(!st.running && st.still, 'the page hidden: the scene stops');
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await wait(300);
  ok((await scene()).running, 'shown again: it moves');

  // ---- Reduced motion: a still, the plane mid-path ----
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await wait(400);
  st = await scene();
  const fR = st.frames;
  await wait(500);
  st = await scene();
  ok(!st.running && st.frames === fR && st.animations.length === 0, `reduced motion: nothing moves (frames ${fR} → ${st.frames}, ${st.animations.length} animations)`);
  ok(st.plane && st.plane.visible && Math.abs(st.plane.u - 0.5) < 0.01 && st.plane.dir === 1 && st.plane.scale === 1, `the plane shown mid-path (u ${st.plane?.u?.toFixed(3)})`);
  await shot('home-still-1440x900');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await wait(400);
  ok((await scene()).running, 'motion back: it moves again');

  // ---- Resume flight: the scenario loads; nothing of the menu runs in flight ----
  await page.evaluate(() => window.__fs.menu.showPage('main'));
  // (The click's handler loads the flight, building the aircraft in SwiftShader: slow on a busy machine.)
  await page.click('[data-k="continue"]', { timeout: 240000 });
  await page.waitForFunction(() => !window.__fs.inMenu && window.__fs.current, null, { timeout: 120000 });
  const flying = await page.evaluate(() => ({ id: window.__fs.current?.id, name: window.__fs.current?.name, menu: window.__fs.menu.isOpen }));
  ok(flying.id === 'home6' && !flying.menu, `Resume flight loads Scenario 6 (${JSON.stringify(flying)})`);
  // Nothing drawn in 3D (SwiftShader's too slow), then paused: no frames from the game either.
  await page.evaluate(() => { const f = window.__fs; f.renderer.render = () => {}; f.setPaused(true); });
  await wait(800);
  const g0 = await page.evaluate(() => ({ f: window.__fs.menu.scene.frames, r: window.__raf, running: window.__fs.menu.scene.running, anims: window.__fs.menu.scene.state().animations.length }));
  await wait(1500);
  const g1 = await page.evaluate(() => ({ f: window.__fs.menu.scene.frames, r: window.__raf }));
  ok(!g0.running && g1.f === g0.f && g0.anims === 0, `in flight the scene is stopped (frames ${g0.f} → ${g1.f}, ${g0.anims} animations)`);
  ok(g1.r === g0.r, `the flight paused, the page asks for no frames at all (rAF ${g0.r} → ${g1.r})`);
  // Its save writes the card's fields (summaryNow()), and back at the menu the card reads them.
  const sum = await page.evaluate(() => { window.__fs.saveNow('test'); return window.__fs.scenarios.entry('home6').summary; });
  ok(sum.phase && sum.origin === 'RKSS' && sum.dest === 'RKPC' && typeof sum.where === 'string', `the save's summary: ${JSON.stringify(sum)}`);
  await page.evaluate(() => window.__fs.exitToMenu());
  await page.waitForFunction(() => window.__fs.inMenu && window.__fs.menu.isOpen, null, { timeout: 30000 });
  await wait(800);
  const h0 = await page.evaluate(() => window.__fs.menu.scene.frames);
  await wait(1000);
  const h1 = await page.evaluate(() => ({ f: window.__fs.menu.scene.frames, running: window.__fs.menu.scene.running }));
  ok(h1.running && h1.f > h0 + 5, `back at the menu it runs again (frames ${h0} → ${h1.f})`);
  c = await cardText();
  const expect = { runway: 'On the runway at Gimpo', taxi: 'Taxiing at Gimpo', parked: 'At Gimpo', air: 'En route to Jeju' }[sum.phase];
  ok(c.shown && c.title.startsWith(expect || '?') && c.sub === 'Scenario 6 · A321neo', `the card reads the save: ${c.title} | ${c.sub} | ${c.stats.join(' | ')}`);
  if (sum.phase !== 'air') ok(c.stats.join(' | ') === 'RKSS / From | RKPC / To', `on the ground, the route: ${c.stats.join(' | ')}`);
  await shot('home-after-flight-1440x900');

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
